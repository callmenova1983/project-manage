<script setup lang="ts">
import { computed, ref } from "vue";
import { PhDownloadSimple, PhUploadSimple } from "@phosphor-icons/vue";
import WorkspaceDialog from "./WorkspaceDialog.vue";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { t, formatNumber } from "../locales";
import { useUnsaved } from "../composables/unsaved";
import { WORKSPACE_IMPORT_LIMIT } from "../../../../packages/domain/progress-material";
import {
  workspaceDataArchive,
  planWorkspaceDataImport,
  type WorkspaceDataArchive,
} from "../../../../packages/domain/workspace-transfer";
const store = useWorkspace();
const fileInput = ref<HTMLInputElement | null>(null);
const pending = ref<WorkspaceDataArchive | null>(null);
const revision = ref(0),
  working = ref(false),
  error = ref("");
const busy = computed(() => working.value || store.busy);
useUnsaved(computed(() => !!pending.value));
const previewState = computed(() => {
  if (!pending.value) return { plan: null, error: "" };
  try {
    return {
      plan: planWorkspaceDataImport(
        store.data,
        pending.value,
        store.mode === "local" || store.user?.role === "admin",
      ),
      error: "",
    };
  } catch (e) {
    return { plan: null, error: (e as Error).message };
  }
});
const preview = computed(() => previewState.value.plan);
async function exportData() {
  if (busy.value) return;
  working.value = true;
  error.value = "";
  try {
    const archive = await api.exportWorkspaceData();
    const blob = new Blob([JSON.stringify(archive, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `project-data-${new Intl.DateTimeFormat("en-CA", { timeZone: store.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    store.notify(t("项目数据已导出，不含附件。"));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    working.value = false;
  }
}
async function choose(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file || busy.value) return;
  working.value = true;
  error.value = "";
  try {
    const limit =
      store.mode === "local" ? 2 * 1024 * 1024 : WORKSPACE_IMPORT_LIMIT;
    if (file.size > limit)
      throw new Error(
        t("Import files must be under {size} MB.", {
          size: limit / 1024 / 1024,
        }),
      );
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error(t("无法读取文件，请选择本系统导出的项目数据文件。"));
    }
    const parsed = workspaceDataArchive.safeParse(data);
    if (!parsed.success)
      throw new Error(
        t("文件格式不正确，请选择「导出数据」生成的 JSON 文件。"),
      );
    if (!(await store.refresh(true)))
      throw new Error(t("无法刷新工作区，请稍后重试。"));
    planWorkspaceDataImport(
      store.data,
      parsed.data,
      store.mode === "local" || store.user?.role === "admin",
    );
    pending.value = parsed.data;
    revision.value = store.data.revision;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    working.value = false;
  }
}
async function importData() {
  if (!pending.value || busy.value) return;
  working.value = true;
  error.value = "";
  try {
    const result = await store.operation(
      () => api.importWorkspaceData(pending.value!, revision.value),
      t("项目数据已导入"),
    );
    pending.value = null;
    store.notify(
      t(
        "导入完成：新增 {projects} 个项目、{tasks} 项任务，补入 {logs} 条历史。",
        {
          projects: result.receipt.projects.added,
          tasks: result.receipt.tasks.added,
          logs: result.receipt.activitiesAdded,
        },
      ) +
        " " +
        t("更新 {projects} 个项目、{tasks} 项任务。", {
          projects: result.receipt.projects.updated,
          tasks: result.receipt.tasks.updated,
        }) +
        (result.receipt.dailyLogsImported ? " " + t("导入 {count} 份工作日志。", { count: result.receipt.dailyLogsImported }) : ""),
    );
  } catch (e) {
    error.value = (e as Error).message;
    if (
      typeof e === "object" &&
      e &&
      "status" in e &&
      e.status === 409 &&
      (await store.refresh(true))
    ) {
      revision.value = store.data.revision;
      error.value = t("数据已变化，已刷新预览，请重新确认导入。");
    }
  } finally {
    working.value = false;
  }
}
</script>
<template>
  <div class="workspace-data-transfer">
    <div class="transfer-actions">
      <button
        type="button"
        :disabled="busy"
        :title="t('导出全部项目、任务、跟进和日志，不含附件')"
        @click="exportData"
      >
        <PhDownloadSimple :size="17" />{{ t("导出数据") }}
      </button>
      <button type="button" :disabled="busy" @click="fileInput?.click()">
        <PhUploadSimple :size="17" />{{ t("导入数据") }}
      </button>
      <input
        ref="fileInput"
        class="transfer-file-input"
        type="file"
        accept=".json,application/json"
        :aria-label="t('导入项目数据')"
        @change="choose"
      />
    </div>
    <p v-if="error && !pending" class="error-box" role="alert">
      {{ t(error) }}
    </p>
    <WorkspaceDialog
      :open="!!pending"
      :title="t('确认导入项目数据')"
      :busy="busy"
      @close="
        pending = null;
        error = '';
      "
    >
      <template v-if="pending && preview">
        <p class="transfer-description">
          {{ t("项目、任务、跟进记录和日志一起导入，不含附件。") }}
        </p>
        <dl class="transfer-summary">
          <div>
            <dt>{{ t("项目") }}</dt>
            <dd>{{ formatNumber(pending.projects.length) }}</dd>
          </div>
          <div>
            <dt>{{ t("任务") }}</dt>
            <dd>{{ formatNumber(pending.tasks.length) }}</dd>
          </div>
          <div>
            <dt>{{ t("历史记录") }}</dt>
            <dd>{{ formatNumber(pending.activities.length) }}</dd>
          </div>
          <div>
            <dt>{{ t("工作日志") }}</dt>
            <dd>{{ formatNumber(pending.dailyLogs.length) }}</dd>
          </div>
        </dl>
        <p>
          {{
            t(
              "将新增 {projects} 个项目、{tasks} 项任务；更新 {updatedProjects} 个项目、{updatedTasks} 项任务。",
              {
                projects: preview.projects.counts.added,
                tasks: preview.tasks.counts.added,
                updatedProjects: preview.projects.counts.updated,
                updatedTasks: preview.tasks.counts.updated,
              },
            )
          }}
        </p>
        <p class="muted">
          {{
            t(
              "保留现有数据；相同编号更新，重复记录不新增。导入后会记录操作历史。",
            )
          }}
        </p>
        <p v-if="preview.unlinkedAssignments" class="muted">
          {{ t("部分人员账号不在当前工作区，将保留姓名，不会自动创建账号。") }}
        </p>
        <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
      </template>
      <p v-if="previewState.error" class="error-box" role="alert">
        {{ t(previewState.error) }}
      </p>
      <template #footer>
        <button
          type="button"
          :disabled="busy"
          @click="
            pending = null;
            error = '';
          "
        >
          {{ t("Cancel") }}
        </button>
        <button
          type="button"
          class="primary"
          :disabled="busy || !preview"
          @click="importData"
        >
          {{ t(busy ? "正在导入…" : "确认导入") }}
        </button>
      </template>
    </WorkspaceDialog>
  </div>
</template>
<style scoped>
.transfer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.transfer-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.transfer-file-input {
  display: none;
}
.transfer-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
  margin: 16px 0;
  background: var(--surface-subtle);
  border-radius: 8px;
}
.transfer-summary dt {
  font-size: 12px;
  color: var(--muted);
}
.transfer-summary dd {
  margin: 6px 0 0;
  font-size: 22px;
  font-weight: 600;
}
.transfer-description {
  margin-top: 0;
}

.workspace-data-transfer > .error-box {
  max-width: 480px;
}
@media (max-width: 480px) {
  .transfer-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
