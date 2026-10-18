<script setup lang="ts">
import { z } from "zod";
import {
  editorDraftPrefix,
  readEditorDraft,
  writeEditorDraft,
  clearEditorDraft,
} from "../services/editor-drafts";
import { computed, onMounted, ref, watch } from "vue";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { captureErrorMessage } from "../services/capture-error";
import { t } from "../locales";
import { currentDay } from "../composables/calendar";
import {
  parseDailyLog,
  missingProjectFields,
  type DailyLogBatch,
} from "../../../../packages/domain/daily-log";
import { useUnsaved } from "../composables/unsaved";
import PersonPicker from "./PersonPicker.vue";
import ProjectBulkFill from "./ProjectBulkFill.vue";
import CaptureInput from "./CaptureInput.vue";
import CaptureResults from "./CaptureResults.vue";
import { dailyLogResults } from "../services/capture-results";
const capture = ref<InstanceType<typeof CaptureInput>>();
const props = defineProps<{ initialSource?: string }>();
const emit = defineEmits<{ completed: [DailyLogBatch] }>();
const store = useWorkspace(),
  source = ref(props.initialSource ?? ""),
  workDate = ref(currentDay()),
  reporter = ref(store.user?.name ?? ""),
  error = ref(""),
  saving = ref(false),
  batchId = ref<string>(),
  preview = ref(false),
  result = ref<DailyLogBatch>(),
  history = ref<DailyLogBatch[]>([]);
type Row = {
  sourceLine: number;
  text: string;
  name: string;
  choice: string;
  newProjectName: string;
  matches: string[];
};
const rows = ref<Row[]>([]);
const reviewVersions = ref<Record<string, number>>({});
const draftSchema = z.object({
  source: z.string().max(12000),
  workDate: z.string().max(10),
  reporter: z.string().max(80),
});
const draftKey = store.user
  ? editorDraftPrefix(api.mode, store.user) + "daily-work-log"
  : "";
if (draftKey && !source.value) {
  const saved = readEditorDraft(draftKey, draftSchema);
  if (saved.kind === "ready") {
    source.value = saved.draft.value.source;
    workDate.value = saved.draft.value.workDate;
    reporter.value = saved.draft.value.reporter;
  }
}
watch([source, workDate, reporter, result], () => {
  if (!draftKey) return;
  if (result.value || !source.value.trim()) clearEditorDraft(draftKey);
  else
    writeEditorDraft(draftKey, draftSchema, {
      version: 1,
      savedAt: Date.now(),
      baseVersion: null,
      attempted: false,
      value: {
        source: source.value,
        workDate: workDate.value,
        reporter: reporter.value,
      },
    });
});
const projects = computed(() =>
  store.data.projects.filter((p) => !p.intakeInbox),
);
const pendingHistory = computed(() =>
  history.value.filter((b) => b.rows.some((r) => r.status === "pending")),
);
const resultIds = computed(() => [
  ...new Set(
    result.value?.rows
      .filter((r) => r.status === "recorded")
      .map((r) => r.projectId!)
      .filter(Boolean) ?? [],
  ),
]);
const counts = computed(() => ({
  existing: rows.value.filter((r) => r.choice !== "later" && r.choice !== "new")
    .length,
  created: new Set(
    rows.value
      .filter((r) => r.choice === "new")
      .map((r) => r.newProjectName.trim()),
  ).size,
  pending: rows.value.filter((r) => r.choice === "later").length,
}));
useUnsaved(
  computed(
    () => (!!source.value.trim() || !!capture.value?.hasFiles) && !result.value,
  ),
);
watch(
  () => props.initialSource,
  (value) => {
    if (value) {
      source.value = value;
      review();
    }
  },
);
onMounted(async () => {
  if (source.value) review();
  try {
    history.value = await api.dailyLogs();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("日志历史加载失败。");
  }
});
async function review() {
  error.value = "";
  try {
    if (capture.value)
      source.value = (await capture.value.resolveSource()).text;
  } catch (e) {
    error.value = t(captureErrorMessage(e));
    return;
  }
  result.value = undefined;
  batchId.value = undefined;
  reviewVersions.value = Object.fromEntries(
    projects.value.map((p) => [p.id, p.version]),
  );
  rows.value = parseDailyLog(source.value, projects.value).map((r) => ({
    sourceLine: r.sourceLine,
    text: r.text,
    name: r.name,
    choice: r.later ? "later" : r.projectId || "new",
    newProjectName: r.newProjectName,
    matches: r.matches.map((p) => p.id),
  }));
  preview.value = true;
}
function resume(batch: DailyLogBatch) {
  reviewVersions.value = Object.fromEntries(
    projects.value.map((p) => [p.id, p.version]),
  );
  source.value = batch.source;
  workDate.value = batch.workDate;
  reporter.value = batch.reporter;
  batchId.value = batch.id;
  result.value = undefined;
  rows.value = batch.rows
    .filter((r) => r.status === "pending")
    .map((r) => ({
      sourceLine: r.sourceLine,
      text: r.text,
      name: r.newProjectName ?? "",
      choice:
        r.projectId && projects.value.some((p) => p.id === r.projectId)
          ? r.projectId
          : "later",
      newProjectName: r.newProjectName ?? "",
      matches: [],
    }));
  preview.value = true;
  error.value = "";
}
async function save() {
  saving.value = true;
  error.value = "";
  try {
    result.value = await api.saveDailyLog({
      batchId: batchId.value,
      source: source.value,
      workDate: workDate.value,
      reporter: reporter.value,
      confirmed: true,
      rows: rows.value.map((r) => ({
        sourceLine: r.sourceLine,
        text: r.text,
        later: r.choice === "later",
        ...(r.choice === "new"
          ? { newProjectName: r.newProjectName }
          : r.choice === "later"
            ? { newProjectName: r.newProjectName }
            : {
                projectId: r.choice,
                projectVersion: reviewVersions.value[r.choice],
              }),
      })),
    });
    await store.refresh();
    history.value = await api.dailyLogs();
    preview.value = false;
    emit("completed", result.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("归档失败，请重试。");
  } finally {
    saving.value = false;
  }
}
function reset() {
  result.value = undefined;
  source.value = "";
  preview.value = false;
  batchId.value = undefined;
}
</script>
<template>
  <section class="panel daily-log" :aria-label="t('当日工作日志')">
    <h2>{{ t("一次归档当天的多项目工作") }}</h2>
    <p class="muted">
      {{
        t("每行写“项目简称 + 工作内容”，归入项目进展；日期和日志人统一填写。")
      }}
    </p>
    <template v-if="!result">
      <div class="daily-meta">
        <label
          >{{ t("工作日期")
          }}<input
            v-model="workDate"
            type="date"
            :disabled="!!batchId || saving"
        /></label>
        <div class="daily-reporter">
          <span>{{ t("日志人（工作由谁完成）") }}</span
          ><PersonPicker
            v-model="reporter"
            :label="t('日志人')"
            :disabled="!!batchId || saving"
          /><small
            >{{
              t(
                "默认本人；帮同事录入时，在这里换成同事，整份日志统一生效。实际录入人：",
              )
            }}{{ store.user?.name }}</small
          >
        </div>
      </div>
      <CaptureInput
        ref="capture"
        v-if="!preview"
        v-model="source"
        :rows="8"
        :label="t('工作日志原文')"
        :maxlength="12000"
        :disabled="saving"
        @submit="review"
        :placeholder="
          t(
            '1. 国鑫 协议判定优化更新\n2. 重儿 车位协议增加车牌联系人信息采集\n3) 大榭 集卡历史数据拉取沟通，xml对接跟进',
          )
        "
      />
      <template v-else
        ><div class="daily-summary">
          {{ rows.length }} {{ t("条日志 ·") }} {{ counts.existing }}
          {{ t("条归入已有项目 ·") }} {{ counts.created }}
          {{ t("个新项目待创建 ·") }} {{ counts.pending }} {{ t("条稍后归类") }}
        </div>
        <div class="daily-rows">
          <article
            v-for="(row, index) in rows"
            :key="row.sourceLine"
            class="daily-row"
          >
            <div>
              <small>{{ t("第") }} {{ index + 1 }} {{ t("条") }}</small>
              <p>{{ row.text }}</p>
            </div>
            <div class="daily-target">
              <label
                >{{ t("归入项目")
                }}<select
                  v-model="row.choice"
                  :aria-label="t('第') + (index + 1) + t('条归属')"
                >
                  <option value="later">{{ t("稍后归类") }}</option>
                  <option value="new">{{ t("新建项目…") }}</option>
                  <option v-for="p in projects" :key="p.id" :value="p.id">
                    {{ p.name }}
                  </option>
                </select></label
              ><template v-if="row.choice === 'new'"
                ><label
                  >{{ t("新项目名称")
                  }}<input
                    v-model="row.newProjectName"
                    :aria-label="
                      t('第') + (index + 1) + t('条新项目名称')
                    " /></label
                ><small>{{
                  t(
                    "未找到对应项目，将在本次确认时创建；负责人和阶段可稍后批量补齐。",
                  )
                }}</small></template
              ><small v-else-if="row.choice === 'later'">{{
                t("原文会保存到待归类列表，之后可集中处理。")
              }}</small
              ><small
                v-else-if="
                  missingProjectFields(
                    projects.find((p) => p.id === row.choice)!,
                  ).length
                "
                >{{ t("待补：")
                }}{{
                  missingProjectFields(
                    projects.find((p) => p.id === row.choice)!,
                  ).join("、")
                }}{{ t("，不影响保存日志。") }}</small
              >
            </div>
          </article>
        </div>
        <details>
          <summary>{{ t("查看完整原文") }}</summary>
          <pre>{{ source }}</pre>
        </details></template
      >
      <footer>
        <button
          v-if="preview && !batchId"
          :disabled="saving"
          @click="preview = false"
        >
          {{ t("返回编辑") }}</button
        ><button
          v-if="!preview"
          class="primary"
          :disabled="(!source.trim() && !capture?.hasFiles) || !!capture?.busy"
          @click="review"
        >
          {{ t("批量预览归属") }}</button
        ><button
          v-else
          class="primary"
          :disabled="
            saving ||
            !rows.length ||
            !reporter.trim() ||
            !workDate ||
            rows.some((r) => r.choice === 'new' && !r.newProjectName.trim())
          "
          @click="save"
        >
          {{
            saving
              ? t("归档中…")
              : counts.created
                ? t("确认归档并新建 {p0} 个项目", { p0: counts.created })
                : t("确认批量归档")
          }}
        </button>
      </footer>
    </template>
    <div v-else class="daily-result" role="status">
      <h3>{{ t("工作日志已保存") }}</h3>
      <p>
        {{ result.workDate }} · {{ result.reporter }} ·
        {{ result.rows.filter((r) => r.status === "recorded").length }}
        {{ t("条已归档，")
        }}{{ result.rows.filter((r) => r.status === "pending").length }}
        {{ t("条待归类。") }}
      </p>
      <p class="muted">
        {{ t("可以在对应项目的进展历史查看原文和工作日期。") }}
      </p>
      <CaptureResults :rows="dailyLogResults(result, store.data.projects)" />
      <div class="result-actions">
        <ProjectBulkFill
          v-if="resultIds.length"
          :project-ids="resultIds"
        /><button
          v-if="result.rows.some((r) => r.status === 'pending')"
          @click="resume(result)"
        >
          {{ t("继续批量归类") }}</button
        ><button @click="reset">{{ t("录入下一份") }}</button>
      </div>
    </div>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <details v-if="pendingHistory.length" class="daily-pending">
      <summary>
        {{ t("待归类工作日志 ·") }} {{ pendingHistory.length }} {{ t("份") }}
      </summary>
      <div v-for="batch in pendingHistory" :key="batch.id">
        <span
          >{{ batch.workDate }} · {{ batch.reporter }} ·
          {{ batch.rows.filter((r) => r.status === "pending").length }}
          {{ t("条待归类") }}</span
        ><button :disabled="saving" @click="resume(batch)">
          {{ t("批量补齐归属") }}
        </button>
      </div>
    </details>
  </section>
</template>
<style scoped>
.daily-log {
  padding: 24px;
}
.daily-log h2 {
  font-size: 18px;
  margin: 0 0 8px;
}
.daily-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 20px 0;
}
.daily-reporter {
  display: grid;
  gap: 7px;
  min-width: 260px;
  flex: 1;
}
.daily-meta > label,
.daily-target label {
  display: grid;
  gap: 7px;
}
textarea {
  width: 100%;
  resize: vertical;
}
.daily-summary {
  padding: 14px;
  background: var(--surface-alt, var(--background));
  border-radius: 8px;
}
.daily-row {
  display: grid;
  grid-template-columns: 1fr minmax(240px, 35%);
  gap: 24px;
  padding: 18px 0;
  border-bottom: 1px solid var(--border);
}
.daily-row p {
  white-space: pre-wrap;
  line-height: 1.7;
  margin: 6px 0;
}
.daily-target {
  display: grid;
  gap: 8px;
}
.daily-target small {
  color: var(--muted);
  line-height: 1.6;
}
.daily-target select,
.daily-target input {
  width: 100%;
}
footer,
.result-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-top: 20px;
}
.daily-pending {
  margin-top: 24px;
}
.daily-pending > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
}
.daily-log details {
  margin-top: 16px;
}
pre {
  white-space: pre-wrap;
}
small {
  color: var(--muted);
}
@media (max-width: 650px) {
  .daily-log {
    padding: 16px;
  }
  .daily-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .daily-meta > * {
    flex: 1 1 150px;
  }
  .daily-pending > div {
    flex-wrap: wrap;
  }
}
</style>
