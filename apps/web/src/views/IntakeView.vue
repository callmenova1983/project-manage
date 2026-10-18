<script setup lang="ts">
import { activeStages, catalogs } from "../composables/catalogs";
import {
  computed,
  ref,
  onMounted,
  onBeforeUnmount,
  nextTick,
  watch,
} from "vue";
import MappingTemplates from "../components/MappingTemplates.vue";
import CaptureInput from "../components/CaptureInput.vue";
import CaptureResults from "../components/CaptureResults.vue";
import { intakeResults } from "../services/capture-results";
import PersonPicker from "../components/PersonPicker.vue";
import ChannelResolve from "../components/ChannelResolve.vue";
import { catalogLabel, stageColors } from "../composables/catalogs";
import { channelEntries } from "../../../../packages/domain/channels";
import type { CaptureSource } from "../../../../packages/domain/capture";
import {
  groupIntakeCandidates,
  needsIntakeDecision,
} from "../composables/intake-review";
import {
  PhUploadSimple,
  PhX,
  PhArrowRight,
  PhCheckCircle,
  PhArrowCounterClockwise,
} from "@phosphor-icons/vue";
import {
  intakeCandidates,
  sourceAt,
  intakeFields,
  detectColumns,
  parseDelimited,
  intakeInput,
  normalizeName,
  type IntakeCandidate,
  type IntakeSource,
  type IntakeField,
  type IntakeBatch,
} from "../../../../packages/domain/intake";
import { statuses, projectInput } from "../../../../packages/domain/types";
import { stageLabels, statusLabels } from "../locales/en";
import { t, formatDate, formatNumber } from "../locales";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { readIntakeFile } from "../services/intake-files";
import { useUnsaved } from "../composables/unsaved";
import { useIntakeDraft } from "../composables/intake-draft";
import { intakeDraftKey } from "../services/intake-drafts";
const props = defineProps<{
  embedded?: boolean;
  initialSource?: string;
  autoReview?: boolean;
  originalSource?: CaptureSource;
  compactReview?: boolean;
  conversational?: boolean;
}>();
const expandedRow = ref("");
const capture = ref<InstanceType<typeof CaptureInput>>();
const emit = defineEmits<{ close: []; completed: [IntakeBatch] }>();
const panel = ref<HTMLElement | null>(null);
const store = useWorkspace();
const step = ref<"source" | "review" | "done">("source"),
  text = ref(props.initialSource ?? ""),
  sources = ref<IntakeSource[]>([]),
  sheetIndex = ref(0),
  mapping = ref<IntakeField[]>([]),
  hasHeader = ref(true),
  candidates = ref<IntakeCandidate[]>([]),
  reading = ref(false),
  error = ref(""),
  confirmed = ref(false),
  history = ref<IntakeBatch[]>([]),
  result = ref<IntakeBatch | null>(null),
  undoId = ref("");
let controller: AbortController | undefined;
const dirty = computed(
  () => step.value !== "done" && !!(text.value || sources.value.length),
);
const askDiscard = useUnsaved(dirty, () => {
  draft.flush();
  return t(
    draft.status.value === "saved"
      ? "Leave intake? Your unsubmitted draft will stay in this tab."
      : "Discard unsaved changes?",
  );
});
const source = computed<IntakeSource>(() => {
  const value = sources.value[sheetIndex.value] ?? {
    kind: "text",
    name: "Pasted text",
    sheet: "",
    text: text.value,
  };
  return {
    ...value,
    ...(props.originalSource && !value.originalSource
      ? { originalSource: props.originalSource }
      : {}),
  };
});
const draft = useIntakeDraft(intakeDraftKey(store.mode, store.user!), {
  step,
  text,
  sources,
  sheetIndex,
  source,
  mapping,
  hasHeader,
  candidates,
  confirmed,
  dirty,
});
const selected = computed(() => candidates.value.filter((c) => c.selected));
const reviewMode = ref("all");
const groups = ref<ReturnType<typeof groupIntakeCandidates>>([]);
watch(candidates, (rows) => {
  groups.value = groupIntakeCandidates(rows);
  reviewMode.value = "all";
});
const reviewGroups = computed(() =>
  groups.value
    .map((group) => ({
      ...group,
      rows: group.rows.filter(
        (c) =>
          reviewMode.value === "all" || needsIntakeDecision(c, duplicate(c)),
      ),
    }))
    .filter((group) => group.rows.length),
);
const decisionCount = computed(
  () =>
    candidates.value.filter((c) => needsIntakeDecision(c, duplicate(c))).length,
);
watch(reviewGroups, async () => {
  const focused = document.activeElement;
  await nextTick();
  if (
    reviewMode.value === "decisions" &&
    focused instanceof HTMLElement &&
    !focused.isConnected
  )
    document
      .querySelector<HTMLSelectElement>(".review-options select")
      ?.focus();
});
async function restoreDraft() {
  draft.restore();
  await nextTick();
  document
    .querySelector<HTMLElement>(
      ".intake-candidate input, .intake-source textarea, .intake-source select",
    )
    ?.focus();
}
const newProjectCount = computed(
  () =>
    new Set(
      selected.value
        .filter((c) => !c.targetProjectId && !c.project.intakeInbox)
        .map((c) => normalizeName(c.project.name)),
    ).size,
);
const taskCount = computed(() => selected.value.filter((c) => c.task).length);
const missingProjectFields = computed(() =>
  selected.value
    .filter((c) => !c.targetProjectId)
    .flatMap((c) => {
      const missing = [
        !c.project.name.trim() && t("项目名"),
        !c.project.channelId && t("渠道"),
        !c.project.stage && t("阶段"),
      ].filter(Boolean);
      return missing.length
        ? [
            t("{p0}：请确认{p1}", {
              p0: c.project.name || t("第") + c.sourceRow + t("行"),
              p1: missing.join("、"),
            }),
          ]
        : [];
    }),
);
const fieldLabels: Record<IntakeField, string> = {
  ignore: "Ignore column",
  project: "Project name",
  channel: t("渠道"),
  shortName: t("简称"),
  aliases: t("别名"),
  client: "Client",
  owner: "Project owner",
  stage: "Stage",
  task: "Task title",
  assignee: "Assignee",
  dueDate: "Due date",
  status: "Task status",
  description: "Description",
};
const example = t(
  "项目：星河客户门户；客户：星河科技；负责人：林晓；阶段：实施中；任务：确认首页文案；截止日期：2026-10-20\n项目：星河客户门户；客户：星河科技；负责人：林晓；阶段：实施中；任务：整理验收清单",
);
function resetMapping() {
  mapping.value = detectColumns(source.value.rows?.[0] ?? []);
}
async function loadFile(file?: File) {
  if (!file || reading.value) return;
  if (dirty.value && !askDiscard()) return;
  error.value = "";
  controller = new AbortController();
  reading.value = true;
  try {
    const parsed = await readIntakeFile(file, controller.signal);
    sources.value = parsed;
    sheetIndex.value = 0;
    text.value = "";
    step.value = "source";
    resetMapping();
  } catch (e) {
    if ((e as Error).name !== "AbortError") error.value = (e as Error).message;
  } finally {
    reading.value = false;
  }
}
function drop(event: DragEvent) {
  void loadFile(event.dataTransfer?.files[0]);
}
function useExample() {
  if (dirty.value && !askDiscard()) return;
  sources.value = [];
  text.value = example;
  error.value = "";
}
async function preview(reviewOnly = false) {
  error.value = "";
  try {
    if (capture.value?.hasFiles)
      text.value = (await capture.value.resolveSource()).text;
    if (
      !sources.value.length &&
      /\t|,/.test(text.value.split(/\r?\n/)[0] ?? "")
    ) {
      const rows = parseDelimited(text.value);
      const columns = detectColumns(rows[0] ?? []);
      if (columns.filter((x) => x !== "ignore").length >= 2) {
        sources.value = [
          {
            kind: "csv",
            name: "Pasted table",
            sheet: "",
            text: text.value,
            rows,
          },
        ];
        resetMapping();
      }
    }
    if (
      source.value.rows &&
      !mapping.value.includes("project") &&
      !mapping.value.includes("task")
    )
      throw new Error("Map a project name or task column before continuing");
    candidates.value = intakeCandidates(
      source.value,
      store.data.projects,
      source.value.rows ? mapping.value : undefined,
      hasHeader.value,
      catalogs.value,
    );
    if (!candidates.value.length)
      throw new Error("No candidates found. Add text or choose another sheet.");
    confirmed.value = false;
    step.value = "review";
    const problems = candidates.value.some(
      (c) =>
        reviewWarnings(c).some(
          (w) => w !== "Rule-assisted draft. Review the project details.",
        ) ||
        duplicate(c) ||
        needsIntakeDecision(c, false),
    );
    if (
      !problems &&
      !missingProjectFields.value.length &&
      (!reviewOnly || props.conversational)
    ) {
      confirmed.value = true;
      await apply();
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function targetChanged(c: IntakeCandidate) {
  const p = store.data.projects.find((p) => p.id === c.targetProjectId);
  if (p) c.project = projectInput.strip().parse(p);
  c.targetProjectVersion = p?.version ?? null;
  confirmed.value = false;
  c.matchConfirmed = false;
}
function reviewWarnings(c: IntakeCandidate) {
  const assigned = !!c.targetProjectId && !c.project.intakeInbox;
  return c.warnings
    .filter(
      (w) =>
        !(
          assigned &&
          w === "Unresolved project. Save in Intake inbox and assign it later."
        ),
    )
    .map((w) => {
      if (assigned && w === "Several projects match. Choose the target.")
        return "The source references several projects. Review your selected target.";
      if (
        assigned &&
        w ===
          "Partial project match. Confirm the target or keep it in Intake inbox."
      )
        return "The source has a partial name match. Review your selected target.";
      return w;
    });
}
function duplicate(c: IntakeCandidate) {
  return !!(
    (!c.targetProjectId &&
      store.data.projects.some((p) =>
        [p.name, ...p.aliases].some(
          (n) => normalizeName(n) === normalizeName(c.project.name),
        ),
      )) ||
    (c.task &&
      store.data.tasks.some(
        (task) =>
          task.projectId === c.targetProjectId &&
          normalizeName(task.title) === normalizeName(c.task!.title),
      )) ||
    (c.task &&
      selected.value.some(
        (other) =>
          other !== c &&
          other.project.name === c.project.name &&
          other.task?.title === c.task!.title,
      ))
  );
}
async function apply() {
  if (store.busy) return;
  error.value = "";
  try {
    const input = intakeInput.parse({
      source: {
        ...source.value,
        ...(!source.value.originalSource && props.originalSource
          ? { originalSource: props.originalSource }
          : {}),
      },
      rows: selected.value.map((c) => ({
        sourceRow: c.sourceRow,
        sourcePart: c.sourcePart,
        contextRows: c.contextRows,
        matchConfirmed: c.matchConfirmed,
        targetProjectId: c.targetProjectId,
        targetProjectVersion: c.targetProjectVersion,
        project: c.project,
        task: c.task,
        duplicateConfirmed: c.duplicateConfirmed,
      })),
      confirmed: confirmed.value,
    });
    result.value = await store.operation(
      () => api.applyIntake(input),
      "Intake created",
    );
    step.value = "done";
    text.value = "";
    sources.value = [];
    draft.flush();
    await loadHistory();
    emit("completed", result.value);
  } catch (e) {
    reviewMode.value = "all";
    error.value = (e as Error).message.startsWith("[")
      ? t("Check required project and task fields")
      : (e as Error).message;
  }
}
async function loadHistory() {
  try {
    history.value = await api.intakeHistory();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function undo(batch: IntakeBatch) {
  error.value = "";
  try {
    await store.operation(() => api.undoIntake(batch.id), "Intake undone");
    undoId.value = "";
    if (result.value?.id === batch.id)
      result.value = { ...batch, state: "undone" };
    await loadHistory();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function startAgain() {
  if (!askDiscard()) return;
  step.value = "source";
  sources.value = [];
  text.value = "";
  candidates.value = [];
  result.value = null;
  error.value = "";
  draft.flush();
}
function closePanel() {
  if (dirty.value && !askDiscard()) return;
  draft.flush();
  emit("close");
}
onMounted(async () => {
  void loadHistory();
  if (props.initialSource && props.autoReview && !draft.pending.value)
    await preview(!props.conversational);
  if (props.embedded) {
    await nextTick();
    panel.value?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }
});
onBeforeUnmount(() => controller?.abort());
</script>
<template>
  <section
    ref="panel"
    class="page intake-page"
    :class="{
      'intake-embedded': embedded,
      'capture-review': compactReview,
      'conversation-review': conversational,
    }"
    :aria-label="compactReview ? t('录入预览') : t('Quick intake')"
  >
    <div v-if="!compactReview" class="intake-heading">
      <div class="intake-heading-title">
        <h2>{{ t("Quick intake") }}</h2>
        <span class="muted">{{ t("直接粘贴文字、截图、Excel 或 Word") }}</span>
      </div>
      <button
        v-if="embedded"
        class="icon-button"
        :aria-label="t('Close quick intake')"
        @click="closePanel"
      >
        <PhX :size="18" />
      </button>
      <RouterLink v-else class="button" to="/projects">{{
        t("Projects")
      }}</RouterLink>
    </div>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <section
      v-if="draft.pending.value"
      class="panel intake-source"
      aria-labelledby="draft-recovery-title"
    >
      <h2 id="draft-recovery-title">{{ t("Unsubmitted intake draft") }}</h2>
      <p>
        {{
          compactReview
            ? t("有一份未提交草稿，可继续编辑。")
            : t(
                "This draft is kept in this browser tab for up to 24 hours. It has not been submitted to the workspace.",
              )
        }}
      </p>
      <template v-if="draft.recovery.value.kind === 'ready'">
        <p>
          {{ t("Draft saved") }} ·
          {{
            formatDate(new Date(draft.recovery.value.draft.savedAt), {
              dateStyle: "medium",
              timeStyle: "short",
            })
          }}
        </p>
        <p v-if="!compactReview" class="muted">
          {{
            t(
              "Restore your source and edits, then review and confirm again. Only the selected worksheet is kept; reopen the file for other sheets.",
            )
          }}
        </p>
      </template>
      <p v-else class="error-box" role="alert">
        {{ t("This draft could not be read. Discard it to start again.") }}
      </p>
      <div class="form-actions">
        <button @click="draft.discard()">{{ t("Discard draft") }}</button>
        <button
          v-if="draft.recovery.value.kind === 'ready'"
          class="primary"
          @click="restoreDraft"
        >
          {{ t("Restore draft") }}
        </button>
      </div>
    </section>
    <p
      v-if="draft.status.value === 'unavailable'"
      class="error-box"
      role="alert"
    >
      {{
        t(
          "Temporary draft storage is unavailable or full. Keep this page open and copy your source before leaving; newer edits may not be recoverable.",
        )
      }}
    </p>
    <p
      v-else-if="draft.status.value === 'saved' && !compactReview"
      class="muted"
      role="status"
    >
      {{
        t(
          "Unsubmitted draft kept in this tab · up to 24 hours · review before saving to the workspace.",
        )
      }}
    </p>
    <p v-else-if="draft.status.value === 'expired'" class="muted" role="status">
      {{ t("The previous temporary draft expired after 24 hours.") }}
    </p>
    <div
      v-if="!draft.pending.value && step === 'source'"
      class="panel intake-source"
      @dragover.prevent
      @drop.prevent="drop"
    >
      <div class="section-heading">
        <h2>{{ t("Paste anything to get started") }}</h2>
        <button class="text-button" @click="useExample">
          {{ t("Try a sample") }}
        </button>
      </div>
      <CaptureInput
        v-if="!sources.length"
        ref="capture"
        v-model="text"
        :rows="3"
        :label="t('Notes or pasted table')"
        :maxlength="200000"
        :placeholder="
          t(
            'Project: Customer portal; Client: Acme; Owner: Alex; Task: Review the brief; Due: 2026-10-20',
          )
        "
      />
      <details class="intake-source-help">
        <summary>{{ t("录入提示") }}</summary>
        <p class="muted">
          {{
            t(
              "Use project headings followed by bullet tasks, or project/client/owner/task labels. Aliases and multiple matches stay visible for review. Relative dates remain unset. This is rule assistance; no model is called.",
            )
          }}
        </p>
      </details>
      <div class="intake-source-tools">
        <label class="intake-upload button">
          <PhUploadSimple :size="15" /><span>{{
            t("打开表格文件（可选）")
          }}</span>
          <input
            type="file"
            :aria-label="t('Upload file')"
            accept=".txt,.csv,.tsv,.xlsx"
            :disabled="reading"
            @change="
              loadFile(($event.target as HTMLInputElement).files?.[0]);
              ($event.target as HTMLInputElement).value = '';
            "
          />
        </label>
        <span class="muted">{{
          t("可直接粘贴；只有需要切换工作表时才打开文件")
        }}</span>
      </div>
      <div v-if="reading" role="status">
        {{ t("Reading file…") }}
        <button class="text-button" @click="controller?.abort()">
          {{ t("Cancel") }}
        </button>
      </div>
      <template v-if="sources.length">
        <div class="section-heading">
          <strong>{{ source.name }}</strong
          ><button
            class="text-button"
            @click="
              sources = [];
              text = '';
            "
          >
            {{ t("Remove file") }}
          </button>
        </div>
        <label v-if="sources.length > 1"
          >{{ t("Worksheet")
          }}<select v-model="sheetIndex" @change="resetMapping">
            <option
              v-for="(sheet, index) in sources"
              :key="index"
              :value="index"
            >
              {{ sheet.sheet }}
            </option>
          </select></label
        >
        <template v-if="source.rows"
          ><label class="checkbox"
            ><input v-model="hasHeader" type="checkbox" />{{
              t("First row contains column names")
            }}</label
          >
          <div class="intake-mapping">
            <label v-for="(cell, index) in source.rows[0]" :key="index"
              >{{ cell || t("Column {number}", { number: index + 1 })
              }}<select v-model="mapping[index]">
                <option
                  v-for="field in intakeFields"
                  :key="field"
                  :value="field"
                >
                  {{ t(fieldLabels[field]) }}
                </option>
              </select></label
            >
          </div>
          <p class="muted">
            {{
              t(
                "Only mapped columns become fields. All source cells remain visible in review. XLSX formulas are not executed; stored values are used.",
              )
            }}
          </p>
          <MappingTemplates
            :headers="source.rows[0] ?? []"
            :mapping="mapping"
            :has-header="hasHeader"
            @reuse="
              (fields, header) => {
                mapping = fields;
                hasHeader = header;
              }
            "
        /></template>
        <pre v-else class="intake-original">{{ source.text }}</pre>
      </template>
      <div class="form-actions">
        <button
          class="text-button"
          :disabled="reading || (!text.trim() && !sources.length)"
          @click="preview(true)"
        >
          {{ t("Review candidates") }}
        </button>
        <button
          class="primary"
          :disabled="reading || (!text.trim() && !sources.length)"
          @click="preview(false)"
        >
          {{ t("Create items") }}<PhArrowRight :size="16" />
        </button>
      </div>
    </div>
    <form
      v-else-if="!draft.pending.value && step === 'review'"
      @submit.prevent="
        if (compactReview) confirmed = true;
        apply();
      "
    >
      <div class="intake-review-header">
        <div>
          <h2>
            {{
              compactReview
                ? t("已整理 ") + candidates.length + t(" 项")
                : t("{count} candidates", { count: candidates.length })
            }}
          </h2>
          <p v-if="!compactReview" class="muted">
            {{
              t(
                "Keep the rows you want. Existing project details will not be overwritten.",
              )
            }}
          </p>
        </div>
        <button
          type="button"
          class="button"
          @click="
            step = 'source';
            confirmed = false;
          "
        >
          {{ t("Back to source") }}
        </button>
      </div>
      <div v-if="!compactReview || decisionCount" class="review-options">
        <label
          >{{ t("Review view")
          }}<select v-model="reviewMode" :aria-label="t('Review view')">
            <option value="all">
              {{ t("All rows, grouped by source project") }}
            </option>
            <option value="decisions">
              {{ t("Needs decisions ({count})", { count: decisionCount }) }}
            </option>
          </select></label
        >
        <p v-if="!compactReview" class="muted">
          {{
            t(
              "Filtering changes this view only. All selected rows are included; ambiguity and duplicate confirmations still apply.",
            )
          }}
        </p>
      </div>
      <p v-if="!reviewGroups.length" role="status">
        {{
          t(
            "No rows need a decision. Review all rows before creating the selected items.",
          )
        }}
      </p>
      <div v-if="compactReview" class="capture-preview-scroll">
        <table class="capture-preview" :aria-label="t('待创建的项目与任务')">
          <thead>
            <tr>
              <th class="preview-check">{{ t("选中") }}</th>
              <th>{{ t("项目") }}</th>
              <th>{{ t("客户") }}</th>
              <th>{{ t("渠道") }}</th>
              <th>{{ t("项目负责人") }}</th>
              <th>{{ t("阶段") }}</th>
              <th>{{ t("任务") }}</th>
              <th class="preview-more">{{ t("详情") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in candidates"
              :key="c.id"
              :class="{ excluded: !c.selected }"
            >
              <td class="preview-check">
                <label class="preview-selection">
                  <input
                    v-model="c.selected"
                    type="checkbox"
                    :aria-label="t('选中 ') + (c.task?.title || c.project.name)"
                  />
                  <span class="preview-selection-text" aria-hidden="true">{{
                    t("选中此项")
                  }}</span>
                </label>
              </td>
              <td :data-label="t('项目')">
                <input
                  v-if="!c.targetProjectId"
                  v-model="c.project.name"
                  :disabled="!c.selected"
                  :aria-label="t('项目名称 第') + c.sourceRow + t('行')"
                  maxlength="120"
                /><span v-else>{{ c.project.name }}</span>
              </td>
              <td :data-label="t('客户')">
                <input
                  v-model="c.project.client"
                  :disabled="!c.selected || !!c.targetProjectId"
                  :aria-label="t('客户 第') + c.sourceRow + t('行')"
                  maxlength="120"
                  placeholder="—"
                />
              </td>
              <td :data-label="t('渠道')">
                <select
                  v-model="c.project.channelId"
                  :disabled="!c.selected || !!c.targetProjectId"
                  :aria-label="t('渠道 第') + c.sourceRow + t('行')"
                >
                  <option value="" disabled>
                    {{
                      c.requestedChannel
                        ? c.requestedChannel + t("（未登记）")
                        : t("未识别，请选择渠道")
                    }}
                  </option>
                  <option
                    v-for="channel in channelEntries(catalogs).filter(
                      (channel) => !channel.archived,
                    )"
                    :key="channel.id"
                    :value="channel.id"
                  >
                    {{ channel.name }}
                  </option>
                </select>
                <ChannelResolve
                  v-if="!c.project.channelId && c.requestedChannel"
                  :name="c.requestedChannel"
                  @resolved="c.project.channelId = $event"
                />
              </td>
              <td :data-label="t('项目负责人')">
                <PersonPicker
                  v-model="c.project.owner"
                  :label="t('项目负责人 第') + c.sourceRow + t('行')"
                  :project-id="c.targetProjectId || undefined"
                  :disabled="!c.selected || !!c.targetProjectId"
                  compact
                />
              </td>
              <td :data-label="t('阶段')">
                <select
                  v-model="c.project.stage"
                  :disabled="!c.selected || !!c.targetProjectId"
                  :aria-label="t('阶段 第') + c.sourceRow + t('行')"
                  :style="stageColors(c.project.stage)"
                >
                  <option value="" disabled>
                    {{ t("未识别，请选择阶段") }}
                  </option>
                  <option value="unclassified">{{ t("阶段待补") }}</option>
                  <option v-for="s in activeStages" :key="s.id" :value="s.id">
                    {{ catalogLabel("stages", s.id) }}
                  </option>
                </select>
              </td>
              <td :data-label="t('任务')">
                <input
                  v-if="c.task"
                  v-model="c.task.title"
                  :disabled="!c.selected"
                  :aria-label="t('任务 第') + c.sourceRow + t('行')"
                  maxlength="240"
                /><span v-else class="muted">{{ t("仅新建项目") }}</span>
              </td>
              <td class="preview-details">
                <button
                  type="button"
                  class="text-button"
                  :class="{ amber: needsIntakeDecision(c, duplicate(c)) }"
                  @click="expandedRow = expandedRow === c.id ? '' : c.id"
                >
                  {{
                    needsIntakeDecision(c, duplicate(c))
                      ? t("需确认")
                      : expandedRow === c.id
                        ? t("收起")
                        : t("更多")
                  }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section
        v-for="group in reviewGroups"
        :key="group.id"
        class="intake-project-group"
        :aria-label="t('Source project: {name}', { name: group.name })"
      >
        <h3 v-if="!compactReview">
          {{ t("Source project: {name}", { name: group.name }) }}
          <span class="muted"
            >· {{ t("{count} rows", { count: group.rows.length }) }}</span
          >
        </h3>
        <article
          v-for="(c, index) in group.rows"
          :key="c.id"
          class="panel intake-candidate"
          :class="{ excluded: !c.selected }"
          v-show="!compactReview || expandedRow === c.id"
        >
          <div class="section-heading">
            <label class="checkbox"
              ><input
                v-model="c.selected"
                type="checkbox"
                @change="confirmed = false"
              />{{ t("Row {number}", { number: c.sourceRow }) }} ·
              {{ c.project.name || t("Unnamed project") }}</label
            ><span class="muted">{{
              c.task ? t("Project + task") : t("Project only")
            }}</span>
          </div>
          <details
            :open="compactReview || index === 0 || c.warnings.length > 0"
          >
            <summary>{{ t("Review details") }}</summary>
            <div v-if="c.matchEvidence?.length" class="intake-matches">
              <p class="muted">{{ t("Suggested project matches") }}</p>
              <ul>
                <li v-for="match in c.matchEvidence" :key="match.projectId">
                  <button
                    type="button"
                    :disabled="!c.selected"
                    @click="
                      c.targetProjectId = match.projectId;
                      targetChanged(c);
                    "
                  >
                    {{
                      store.data.projects.find((p) => p.id === match.projectId)
                        ?.name ?? match.projectId
                    }}
                  </button>
                  <span
                    >{{
                      t(
                        {
                          name: "Exact project name",
                          alias: "Exact alias",
                          partial: "Partial name",
                          mention: "Mention in source",
                        }[match.kind],
                      )
                    }}
                    · {{ match.value }}</span
                  >
                </li>
              </ul>
            </div>
            <div class="intake-fields">
              <label
                >{{ t("Target project")
                }}<select
                  v-model="c.targetProjectId"
                  :disabled="!c.selected"
                  @change="targetChanged(c)"
                >
                  <option value="">
                    {{
                      t(
                        c.project.intakeInbox
                          ? "Save in Intake inbox"
                          : "Create a new project",
                      )
                    }}
                  </option>
                  <option
                    v-for="p in store.data.projects"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }} · {{ p.client }}
                  </option>
                </select></label
              >
              <label
                >{{ t("Project name")
                }}<input
                  v-model="c.project.name"
                  :disabled="!c.selected || !!c.targetProjectId"
                  required
                  maxlength="120"
              /></label>
              <label
                >{{ t("Client")
                }}<input
                  v-model="c.project.client"
                  :disabled="!c.selected || !!c.targetProjectId"
                  maxlength="120"
              /></label>
              <label
                >{{ t("Project owner")
                }}<input
                  v-model="c.project.owner"
                  :disabled="!c.selected || !!c.targetProjectId"
                  maxlength="80"
              /></label>
              <label
                >{{ t("渠道")
                }}<select
                  v-model="c.project.channelId"
                  :disabled="!c.selected || !!c.targetProjectId"
                >
                  <option value="" disabled>
                    {{ t("未识别，请选择渠道") }}
                  </option>
                  <option
                    v-for="channel in channelEntries(catalogs).filter(
                      (channel) => !channel.archived,
                    )"
                    :key="channel.id"
                    :value="channel.id"
                  >
                    {{ channel.name }}
                  </option>
                </select></label
              >
              <label v-if="c.project.shortName"
                >{{ t("简称")
                }}<input
                  v-model="c.project.shortName"
                  maxlength="80"
                  :disabled="!c.selected || !!c.targetProjectId"
              /></label>
              <label v-if="c.project.aliases.length"
                >{{ t("别名")
                }}<input
                  :value="c.project.aliases.join('、')"
                  @input="
                    c.project.aliases = (
                      $event.target as HTMLInputElement
                    ).value
                      .split(/[、，,|]/)
                      .map((name) => name.trim())
                      .filter(Boolean)
                  "
                  :disabled="!c.selected || !!c.targetProjectId"
              /></label>
              <label
                >{{ t("Stage")
                }}<select
                  v-model="c.project.stage"
                  :disabled="!c.selected || !!c.targetProjectId"
                >
                  <option value="" disabled>
                    {{ t("未识别，请选择阶段") }}
                  </option>
                  <option value="unclassified">
                    {{ stageLabels.unclassified }}
                  </option>
                  <option
                    v-for="stage in activeStages"
                    :key="stage.id"
                    :value="stage.id"
                  >
                    {{ stageLabels[stage.id] }}
                  </option>
                </select></label
              >
              <label
                >{{ t("Description")
                }}<input
                  v-model="c.project.description"
                  :disabled="!c.selected || !!c.targetProjectId"
                  maxlength="4000"
              /></label>
              <template v-if="c.task"
                ><label
                  >{{ t("Task title")
                  }}<input
                    v-model="c.task.title"
                    :disabled="!c.selected"
                    required
                    maxlength="240" /></label
                ><label
                  >{{ t("Assignee")
                  }}<input
                    v-model="c.task.assignee"
                    :disabled="!c.selected"
                    maxlength="80" /></label
                ><label
                  >{{ t("Due date")
                  }}<input
                    :value="c.task.dueDate ?? ''"
                    type="date"
                    :disabled="!c.selected"
                    @input="
                      c.task.dueDate =
                        ($event.target as HTMLInputElement).value || null
                    " /></label
                ><label
                  >{{ t("Task status")
                  }}<select v-model="c.task.status" :disabled="!c.selected">
                    <option
                      v-for="status in statuses"
                      :key="status"
                      :value="status"
                    >
                      {{ statusLabels[status] }}
                    </option>
                  </select></label
                ></template
              >
            </div>
            <p v-if="c.task" class="muted">
              {{
                t(
                  "New tasks start without a work-week assignment. A due date does not assign weekly work.",
                )
              }}
            </p>
            <ul v-if="reviewWarnings(c).length" class="intake-warnings">
              <li v-for="warning in reviewWarnings(c)" :key="warning">
                {{ t(warning) }}
              </li>
            </ul>
            <label
              v-if="
                c.matches.length > 1 &&
                c.targetProjectId &&
                !c.project.intakeInbox &&
                c.selected
              "
              class="checkbox ambiguity-confirm"
            >
              <input
                v-model="c.matchConfirmed"
                type="checkbox"
                @change="confirmed = false"
              />{{
                t("I confirm this target despite multiple project matches")
              }}
            </label>
            <label v-if="duplicate(c) && c.selected" class="checkbox"
              ><input v-model="c.duplicateConfirmed" type="checkbox" />{{
                t("Allow a new project or task with a matching name")
              }}</label
            >
            <details class="intake-source-proof">
              <summary>
                {{ t("Original source") }} · {{ source.name }}
                {{ source.sheet }} ·
                {{ t("Row {number}", { number: c.sourceRow }) }}
              </summary>
              <div v-for="row in c.contextRows ?? []" :key="row">
                <small>{{ t("Context row {number}", { number: row }) }}</small>
                <pre>{{ sourceAt(source, row) }}</pre>
              </div>
              <pre>{{ c.sourceText }}</pre>
            </details>
          </details>
        </article>
      </section>
      <div class="panel intake-confirm">
        <h2>{{ t("Ready to create") }}</h2>
        <p v-if="!compactReview" class="muted">
          {{
            t(
              "Missing details do not block saving. Unresolved work stays in Intake inbox; owners, dates and stages can be completed later. Review warnings once before confirming.",
            )
          }}
        </p>
        <p v-if="!compactReview">
          {{
            t("{projects} new projects · {tasks} new tasks", {
              projects: newProjectCount,
              tasks: taskCount,
            })
          }}
        </p>
        <label v-if="!compactReview" class="checkbox"
          ><input
            v-model="confirmed"
            type="checkbox"
            :disabled="!selected.length"
          />{{
            t("I reviewed the selected rows and their target projects")
          }}</label
        >
        <div class="form-actions">
          <button
            type="button"
            class="button"
            :disabled="store.busy"
            @click="startAgain"
          >
            {{ t("Cancel") }}</button
          ><button
            class="primary"
            type="submit"
            :disabled="
              (!compactReview && !confirmed) ||
              !selected.length ||
              !!missingProjectFields.length ||
              store.busy ||
              selected.some(
                (c) =>
                  c.matches.length > 1 &&
                  c.targetProjectId &&
                  !c.project.intakeInbox &&
                  !c.matchConfirmed,
              )
            "
          >
            {{
              store.busy
                ? t("Saving…")
                : compactReview
                  ? t("确认创建 ") +
                    newProjectCount +
                    t(" 个项目 · ") +
                    taskCount +
                    t(" 个任务")
                  : t("Create confirmed items")
            }}
          </button>
        </div>
        <p v-if="missingProjectFields.length" role="status" class="amber">
          {{ missingProjectFields.join("；") }}
        </p>
      </div>
    </form>
    <div v-else-if="result" class="panel intake-success" role="status">
      <PhCheckCircle :size="36" />
      <h2>
        {{
          t(
            result.state === "undone"
              ? "Intake undone"
              : "Created and recorded",
          )
        }}
      </h2>
      <p>
        {{
          t("{projects} new projects · {tasks} new tasks", {
            projects: result.projects.filter((p) => !p.intakeInbox).length,
            tasks: result.tasks.length,
          })
        }}
      </p>
      <CaptureResults
        :rows="intakeResults(result, store.data.projects)"
        :inactive="result.state === 'undone'"
      />
      <div class="form-actions">
        <RouterLink class="button" to="/projects">{{
          t("View projects")
        }}</RouterLink
        ><button class="primary" @click="startAgain">
          {{ t("Add more work") }}
        </button>
      </div>
    </div>
    <details
      v-if="history.length"
      class="intake-history"
      :open="!compactReview"
    >
      <summary>{{ t("Recent intakes") }} · {{ history.length }}</summary>
      <article v-for="batch in history" :key="batch.id" class="panel">
        <div class="section-heading">
          <div>
            <strong>{{ batch.source.name }}</strong>
            <p class="muted">
              {{
                formatDate(batch.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              }}
              · {{ batch.actor }} · {{ formatNumber(batch.projects.length) }}
              {{ t("Projects") }} / {{ formatNumber(batch.tasks.length) }}
              {{ t("Tasks") }}
            </p>
          </div>
          <button
            v-if="batch.state === 'applied'"
            class="button"
            :disabled="store.busy"
            @click="undoId = undoId === batch.id ? '' : batch.id"
          >
            <PhArrowCounterClockwise :size="16" />{{ t("Undo intake") }}</button
          ><span v-else class="muted">{{ t("Undone") }}</span>
        </div>
        <div v-if="undoId === batch.id" class="intake-undo">
          <p>
            {{
              t(
                "Remove only items created by this intake? Undo is blocked if they have changed or gained dependent tasks.",
              )
            }}
          </p>
          <button class="button" :disabled="store.busy" @click="undoId = ''">
            {{ t("Cancel") }}</button
          ><button class="danger" :disabled="store.busy" @click="undo(batch)">
            {{ t("Confirm undo") }}
          </button>
        </div>
      </article>
    </details>
  </section>
</template>
<style scoped>
.capture-review .intake-confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0 0;
  box-shadow: none;
  border: 0;
  border-top: 1px solid var(--border);
  border-radius: 0;
}
.capture-review .intake-confirm h2 {
  display: none;
}
.capture-review .intake-confirm .form-actions {
  margin-top: 0;
  margin-left: auto;
}
.capture-review .intake-history {
  margin-top: 16px;
  font-size: 12px;
  color: var(--muted);
}
.capture-preview-scroll {
  overflow: auto;
  margin: 14px 0;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.capture-preview {
  width: 100%;
  min-width: 850px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}
.capture-preview th,
.capture-preview td {
  height: 38px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 0 8px;
  text-align: left;
}
.capture-preview th {
  background: var(--surface-raised);
  font-weight: 500;
  color: var(--muted);
}
.capture-preview td:last-child,
.capture-preview th:last-child {
  border-right: 0;
}
.capture-preview tr:last-child td {
  border-bottom: 0;
}
.capture-preview .preview-check {
  width: 50px;
  text-align: center;
}
.capture-preview .preview-check input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--primary);
}
.preview-selection {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
}
.preview-selection-text {
  display: none;
}
.capture-preview .preview-more {
  width: 65px;
}
.capture-preview input:not([type="checkbox"]),
.capture-preview select {
  width: 100%;
  height: 32px;
  background: transparent;
  border: 1px solid transparent;
  padding: 3px 5px;
  font-size: 12px;
}
.capture-preview input:hover,
.capture-preview input:focus,
.capture-preview select:focus {
  border-color: var(--accent-border);
  background: var(--surface-subtle);
}
.capture-preview :deep(.person-search input) {
  height: 32px;
  border-color: transparent;
  background: transparent;
}
.capture-preview :deep(.person-search > svg) {
  top: 9px;
}
.capture-preview select {
  font-size: 11px;
}
.capture-preview button {
  font-size: 11px;
}
.intake-project-group h3 {
  overflow-wrap: anywhere;
}
.review-options select {
  max-width: 100%;
}
.intake-matches ul {
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}
.intake-matches li {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.intake-matches span {
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.intake-matches button {
  white-space: normal;
  text-align: left;
}

.intake-steps {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 20px 0;
  color: var(--muted);
  font-size: 13px;
}
.intake-steps .active {
  color: var(--accent);
  font-weight: 600;
}
.intake-method {
  display: flex;
  gap: 10px;
  padding: 15px 0;
  color: var(--text-secondary);
}
.intake-method p {
  font-size: 12px;
  margin: 4px 0 0;
}
.intake-source,
.intake-candidate,
.intake-confirm,
.intake-success,
.intake-history .panel {
  padding: 20px;
}
.intake-source textarea {
  width: 100%;
  resize: vertical;
  min-height: 150px;
}
.intake-source .muted,
.intake-candidate .muted,
.intake-history .muted {
  font-size: 12px;
  line-height: 1.6;
}
.intake-drop {
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  margin: 18px 0;
  flex-wrap: wrap;
}
.intake-drop input {
  max-width: 100%;
  flex: 1;
  min-width: 190px;
}
.intake-drop small {
  width: 100%;
  color: var(--muted);
}
.intake-mapping,
.intake-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin: 16px 0;
}
.intake-mapping label,
.intake-fields label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.intake-review-header {
  display: flex;
  justify-content: space-between;
  gap: 15px;
  align-items: center;
  margin: 20px 0;
}
.intake-candidate {
  margin: 10px 0;
}
.intake-candidate.excluded {
  opacity: 0.65;
}
.intake-candidate summary {
  cursor: pointer;
  color: var(--text-secondary);
  padding: 6px 0;
}
.intake-warnings {
  color: var(--status-blocked);
  font-size: 13px;
  padding-left: 20px;
}
.intake-source-proof {
  margin-top: 12px;
}
.intake-source-proof pre,
.intake-original {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
  background: var(--surface-subtle);
  padding: 12px;
  font-size: 12px;
}
.intake-confirm {
  position: static;
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-popover);
  margin-top: 20px;
  z-index: 2;
}
.intake-confirm h2 {
  margin: 0;
}
.intake-confirm p {
  margin: 7px 0;
}
.intake-confirm .form-actions {
  margin-top: 12px;
}
.intake-success {
  text-align: center;
}
.intake-success > svg {
  color: var(--status-done);
}
.intake-success .form-actions {
  justify-content: center;
}
.intake-history {
  margin-top: 32px;
}
.intake-history .panel {
  margin: 8px 0;
}
.intake-undo {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.intake-undo button {
  margin-right: 8px;
}
.checkbox {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.checkbox input {
  width: auto;
  flex-shrink: 0;
}
.intake-steps span {
  white-space: nowrap;
}
@media (max-width: 760px) {
  .intake-fields,
  .intake-mapping {
    grid-template-columns: 1fr;
  }
  .intake-page {
    padding-block: 16px;
  }
  .intake-steps {
    gap: 6px;
    font-size: 11px;
  }
  .intake-source,
  .intake-candidate,
  .intake-confirm,
  .intake-history .panel {
    padding: 14px;
  }
  .intake-review-header,
  .intake-history .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .intake-confirm {
    position: static;
  }
  .intake-candidate .section-heading {
    align-items: flex-start;
    gap: 8px;
  }
  .intake-candidate .section-heading > span {
    font-size: 11px;
  }
}
.intake-embedded {
  max-width: none;
  margin: 0 0 20px;
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.intake-heading,
.intake-heading-title,
.intake-source-toolbar,
.intake-source-tools {
  display: flex;
  align-items: center;
  gap: 12px;
}
.intake-heading,
.intake-source-toolbar {
  justify-content: space-between;
}
.intake-heading {
  margin-bottom: 14px;
}
.intake-heading h2 {
  margin: 0;
  font-size: 17px;
}
.intake-heading-title > span {
  font-size: 12px;
}
.intake-source {
  border: 0;
  box-shadow: none;
  padding: 0;
  margin: 0;
  background: transparent;
}
.intake-source textarea {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.6;
}
.intake-text-label {
  display: block;
}
.intake-source-toolbar {
  margin-top: 10px;
  flex-wrap: wrap;
}
.intake-source-tools {
  flex-wrap: wrap;
  gap: 10px;
}
.intake-upload {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  position: relative;
  cursor: pointer;
  overflow: hidden;
}
.intake-upload input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.intake-upload:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.intake-file-hint {
  font-size: 11px;
}
.intake-help {
  margin-top: 12px;
  font-size: 12px;
  color: var(--muted);
}
.intake-help summary,
.intake-history > summary {
  cursor: pointer;
}
.intake-history {
  margin-top: 16px;
  font-size: 13px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 760px) {
  .intake-heading-title {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
  .intake-source-toolbar {
    gap: 12px;
  }
  .intake-source-toolbar > .primary {
    margin-left: auto;
  }
  .intake-file-hint {
    display: none;
  }
  .intake-embedded .intake-source {
    padding: 0;
  }
}
@media (max-width: 600px) {
  .capture-review.intake-embedded {
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
  }
  .capture-review .intake-review-header {
    flex-direction: row;
    align-items: center;
    gap: 12px;
  }
  .capture-review .intake-review-header h2 {
    margin: 0;
    font-size: 16px;
  }
  .capture-review .intake-review-header > button {
    flex-shrink: 0;
  }
  .capture-preview-scroll {
    overflow: visible;
    border: 0;
    border-radius: 0;
    margin: 12px 0;
  }
  .capture-preview,
  .capture-preview tbody {
    display: block;
    width: 100%;
    min-width: 0;
  }
  .capture-preview thead {
    display: none;
  }
  .capture-preview tbody {
    display: grid;
    gap: 12px;
  }
  .capture-preview tbody tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .capture-preview td {
    display: grid;
    gap: 6px;
    min-width: 0;
    height: auto;
    border: 0;
    padding: 0;
    overflow-wrap: anywhere;
  }
  .capture-preview td[data-label]::before {
    content: attr(data-label);
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
  }
  .capture-preview .preview-check {
    width: auto;
    text-align: left;
  }
  .capture-preview .preview-selection {
    min-height: 44px;
    flex-direction: row;
    justify-content: flex-start;
    gap: 10px;
  }
  .capture-preview .preview-selection-text {
    display: inline;
    font-size: 13px;
    font-weight: 500;
  }
  .capture-preview .preview-check input {
    width: 20px;
    height: 20px;
  }
  .capture-preview input:not([type="checkbox"]),
  .capture-preview select,
  .capture-preview :deep(.person-search input) {
    width: 100%;
    min-width: 0;
    height: 44px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-subtle);
    font-size: 16px;
  }
  .capture-preview :deep(.person-search input) {
    padding-inline: 30px;
  }
  .capture-preview :deep(.person-search > svg) {
    top: 14px;
  }
  .capture-preview .preview-details > button {
    justify-self: start;
    min-height: 44px;
    padding: 8px 0;
    font-size: 13px;
  }
  .capture-review .intake-confirm {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .capture-review .intake-confirm .form-actions {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    width: 100%;
    margin: 0;
  }
  .capture-review .intake-confirm button {
    min-height: 44px;
    min-width: 0;
    padding-inline: 12px;
    white-space: normal;
  }
}

.conversation-review {
  padding: 12px 14px;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.conversation-review .capture-preview-scroll {
  overflow: visible;
  border: 0;
  border-radius: 0;
}
.conversation-review .capture-preview,
.conversation-review .capture-preview tbody {
  display: block;
  width: 100%;
  min-width: 0;
}
.conversation-review .capture-preview thead {
  display: none;
}
.conversation-review .capture-preview tr {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.conversation-review .capture-preview td {
  display: block;
  width: auto;
  height: auto;
  border: 0;
  padding: 0;
  min-width: 0;
}
.conversation-review .capture-preview td[data-label]::before {
  display: block;
  content: attr(data-label);
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 4px;
}
.conversation-review .capture-preview td[data-label="项目"],
.conversation-review .capture-preview td[data-label="任务"],
.conversation-review .preview-check,
.conversation-review .preview-details {
  grid-column: 1 / -1;
}
.conversation-review .preview-selection {
  justify-content: flex-start;
  gap: 8px;
}
.conversation-review .preview-selection-text {
  display: inline;
  font-size: 11px;
  color: var(--muted);
}
.conversation-review .capture-preview input:not([type="checkbox"]),
.conversation-review .capture-preview select {
  min-height: 36px;
  border-color: var(--border);
  background: var(--surface-subtle);
  font-size: 13px;
}
.conversation-review .intake-review-header h2 {
  font-size: 14px;
}
.conversation-review .intake-confirm .form-actions {
  flex-wrap: wrap;
}
@media (max-width: 760px) {
  .conversation-review .capture-preview input:not([type="checkbox"]),
  .conversation-review .capture-preview select {
    min-height: 44px;
    font-size: 16px;
  }
}
</style>
