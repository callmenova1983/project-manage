<script setup lang="ts">
import { ref, computed } from "vue";
import {
  PhDownloadSimple,
  PhUploadSimple,
  PhDatabase,
} from "@phosphor-icons/vue";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import {
  snapshotImport,
  validateGraph,
  leafTasks,
} from "../../../../packages/domain/types";
import { useUnsaved } from "../composables/unsaved";
const store = useWorkspace();
const pending = ref<ReturnType<typeof snapshotImport.parse> | null>(null),
  confirmed = ref(false),
  error = ref(""),
  revision = ref(0);
const dirty = computed(() => !!pending.value);
useUnsaved(dirty);
async function exportData() {
  error.value = "";
  try {
    const data = await api.exportData();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `project-manage-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    store.notify("Workspace exported");
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function choose(e: Event) {
  error.value = "";
  pending.value = null;
  confirmed.value = false;
  const input = e.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024)
      throw new Error("Import files must be under 2 MB.");
    const parsed = snapshotImport.parse(JSON.parse(await file.text()));
    validateGraph(parsed.projects, parsed.tasks);
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
      "Workspace imported",
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
        <div class="eyebrow">YOUR SHARED SPACE</div>
        <h1>Workspace</h1>
        <p class="page-subtitle">
          Portable data, clear boundaries, and a shared source of truth.
        </p>
      </div>
      <PhDatabase :size="27" class="muted" />
    </div>
    <section class="panel">
      <h2>Connection</h2>
      <dl class="settings-list">
        <div>
          <dt>Storage</dt>
          <dd>
            {{
              store.mode === "server"
                ? "Authenticated server · SQLite"
                : "Local demo · this browser only"
            }}
          </dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>
            Every member in this workspace can view and edit every project.
          </dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd>
            Background refresh every 20 seconds. Version checks protect
            concurrent edits.
          </dd>
        </div>
        <div>
          <dt>AI provider</dt>
          <dd>
            Not connected. Meeting notes use rule-assisted suggestions and
            explicit review.
          </dd>
        </div>
      </dl>
    </section>
    <section class="panel">
      <h2>Export workspace</h2>
      <p class="muted">
        Download projects, tasks, and the latest activity records as JSON. Store
        exports securely; they can include notes and names.
      </p>
      <button @click="exportData">
        <PhDownloadSimple :size="17" />Export JSON
      </button>
    </section>
    <section class="panel">
      <h2>Import workspace</h2>
      <p class="muted">
        Preview a JSON export before replacing current projects and tasks.
        Existing audit history is preserved. Export a backup first.
      </p>
      <label class="file-button button"
        ><PhUploadSimple :size="17" />Choose JSON file<input
          type="file"
          accept="application/json,.json"
          aria-label="Import JSON file"
          @change="choose"
      /></label>
      <div v-if="pending" class="import-preview">
        <h3>Review replacement</h3>
        <p>
          {{ pending.projects.length }} projects ·
          {{ leafTasks(pending.tasks).length }} leaf tasks
        </p>
        <p>
          Replacing {{ store.data.projects.length }} projects and
          {{ store.total.total }} leaf tasks. Task and project IDs are checked
          for duplicates and invalid relationships.
        </p>
        <label class="check-label"
          ><input v-model="confirmed" type="checkbox" />I have exported a backup
          and confirm replacing the workspace data</label
        >
        <div class="form-actions">
          <button
            :disabled="store.busy"
            @click="
              pending = null;
              confirmed = false;
            "
          >
            Cancel import</button
          ><button
            class="danger"
            :disabled="!confirmed || store.busy"
            @click="importData"
          >
            {{ store.busy ? "Importing…" : "Replace workspace" }}
          </button>
        </div>
      </div>
    </section>
    <p v-if="error" class="error-box" role="alert">{{ error }}</p>
  </section>
</template>
