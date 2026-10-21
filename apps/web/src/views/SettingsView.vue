<script setup lang="ts">
import { normalizeImportedTaskPlanning } from "../../../../packages/domain/snapshot-schedule";
import WorkspaceTimezone from "../components/WorkspaceTimezone.vue";
import WorkspaceDataTransfer from "../components/WorkspaceDataTransfer.vue";
import { t, formatNumber } from "../locales";
import { ref, computed } from "vue";
import { PhUploadSimple, PhDatabase } from "@phosphor-icons/vue";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import {
  snapshotImport,
  validateGraph,
  leafTasks,
} from "../../../../packages/domain/types";
import { useUnsaved } from "../composables/unsaved";
import { WORKSPACE_IMPORT_LIMIT } from "../../../../packages/domain/progress-material";
import {
  defaultCatalogs,
  importCatalogs,
} from "../../../../packages/domain/admin";
const store = useWorkspace();
const pending = ref<ReturnType<typeof snapshotImport.parse> | null>(null),
  confirmed = ref(false),
  error = ref(""),
  revision = ref(0);
const dirty = computed(() => !!pending.value);
useUnsaved(dirty);
async function choose(e: Event) {
  error.value = "";
  pending.value = null;
  confirmed.value = false;
  const input = e.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    const limit =
      store.mode === "local" ? 2 * 1024 * 1024 : WORKSPACE_IMPORT_LIMIT;
    if (file.size > limit)
      throw new Error(
        t("Import files must be under {size} MB.", {
          size: limit / 1024 / 1024,
        }),
      );
    const raw = JSON.parse(await file.text());
    if (raw?.format === "project-manage-data")
      throw new Error(t("这是新版项目数据，请使用上方的「导入数据」。"));
    const parsed = normalizeImportedTaskPlanning(snapshotImport.parse(raw));
    validateGraph(parsed.projects, parsed.tasks);
    importCatalogs(
      parsed,
      store.data.catalogs ?? defaultCatalogs,
      store.mode === "local" || store.user?.role === "admin",
    );
    pending.value = parsed;
    revision.value = store.data.revision;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    input.value = "";
  }
}
async function importData() {
  if (!pending.value || !confirmed.value) return;
  try {
    await store.operation(
      () => api.importData(pending.value, revision.value),
      t("Workspace imported"),
    );
    pending.value = null;
    confirmed.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <section class="page settings-page">
    <div class="page-heading">
      <div>
        <div class="eyebrow">{{ t("YOUR SHARED SPACE") }}</div>
        <h1>{{ t("Workspace") }}</h1>
        <p class="page-subtitle">
          {{
            t("Portable data, clear boundaries, and a shared source of truth.")
          }}
        </p>
      </div>
      <PhDatabase :size="27" class="muted" />
    </div>
    <WorkspaceTimezone />
    <section class="panel">
      <h2>{{ t("Connection") }}</h2>
      <dl class="settings-list">
        <div>
          <dt>{{ t("Storage") }}</dt>
          <dd>
            {{
              t(
                store.mode === "server"
                  ? "Authenticated server · SQLite"
                  : "Local demo · this browser only",
              )
            }}
          </dd>
        </div>
        <div>
          <dt>{{ t("Access") }}</dt>
          <dd>
            {{
              t(
                "Every member in this workspace can view and edit every project.",
              )
            }}
          </dd>
        </div>
        <div>
          <dt>{{ t("Updates") }}</dt>
          <dd>
            {{
              t(
                store.mode === "local"
                  ? "Saved locally in this browser. No background server connection."
                  : "Background refresh every 20 seconds. Version checks protect concurrent edits.",
              )
            }}
          </dd>
        </div>
        <div>
          <dt>{{ t("AI provider") }}</dt>
          <dd>
            {{
              t(
                store.mode === "local"
                  ? "演示模式未连接 AI。"
                  : "AI 用于理解输入，当前配置和启用状态可在 AI 设置中查看。",
              )
            }}
          </dd>
        </div>
      </dl>
    </section>
    <section class="panel">
      <h2>{{ t("项目数据导入与导出") }}</h2>
      <p class="muted">
        {{ t("项目、任务、跟进记录和日志一起导入，不含附件。") }}
      </p>
      <WorkspaceDataTransfer />
    </section>
    <details class="panel legacy-import">
      <summary>{{ t("旧版 JSON 文件恢复") }}</summary>
      <h2>{{ t("恢复并替换工作区") }}</h2>

      <p class="muted">
        {{
          t(
            "Preview a JSON export before replacing current projects and tasks. Existing audit history is preserved. Export a backup first.",
          )
        }}
      </p>
      <label class="file-button button"
        ><PhUploadSimple :size="17" />{{ t("Choose JSON file")
        }}<input
          type="file"
          accept="application/json,.json"
          :aria-label="t('Import JSON file')"
          @change="choose"
      /></label>
      <div v-if="pending" class="import-preview">
        <h3>{{ t("Review replacement") }}</h3>
        <p v-if="pending.schemaVersion < 3" role="status">
          {{
            t(
              "Legacy imports clear all existing schedule dates, milestones and dependencies.",
            )
          }}
        </p>
        <p>
          {{
            t("{projects} projects · {tasks} leaf tasks", {
              projects: formatNumber(pending.projects.length),
              tasks: formatNumber(leafTasks(pending.tasks).length),
            })
          }}
        </p>
        <p>
          {{
            t(
              "Replacing {projects} projects and {tasks} leaf tasks. Task and project IDs are checked for duplicates and invalid relationships.",
              {
                projects: formatNumber(store.data.projects.length),
                tasks: formatNumber(store.total.total),
              },
            )
          }}
        </p>
        <p v-if="pending.catalogs" class="muted">
          {{
            t(
              "This file includes stage and category definitions. Importing changes to these definitions requires administrator access.",
            )
          }}
        </p>
        <p class="muted">
          {{
            t(
              "Imported files do not change the workspace time zone. Current setting: {zone}",
              { zone: store.timeZone },
            )
          }}
        </p>
        <label class="check-label"
          ><input v-model="confirmed" type="checkbox" />{{
            t(
              "I have exported a backup and confirm replacing the workspace data",
            )
          }}</label
        >
        <div class="form-actions">
          <button
            :disabled="store.busy"
            @click="
              pending = null;
              confirmed = false;
            "
          >
            {{ t("Cancel import") }}</button
          ><button
            class="danger"
            :disabled="!confirmed || store.busy"
            @click="importData"
          >
            {{ t(store.busy ? "Importing…" : "Replace workspace") }}
          </button>
        </div>
      </div>
    </details>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
  </section>
</template>
