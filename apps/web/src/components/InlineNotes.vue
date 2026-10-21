<script setup lang="ts">
import { t, formatNumber } from "../locales";
import { computed, ref, watch } from "vue";
import { projectInput, type Project } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved } from "../composables/unsaved";
import { ApiError } from "../services/api";
import SaveError from "./SaveError.vue";
import EditorDraftNotice from "./EditorDraftNotice.vue";
import { useEditorDraft } from "../composables/editor-draft";
import { notesEditorDraft } from "../services/editor-drafts";
import CaptureInput from "./CaptureInput.vue";
const capture = ref<InstanceType<typeof CaptureInput>>();
const sourcesPrepared = ref(false);
const props = defineProps<{ project: Project }>();
const store = useWorkspace();
const editing = ref(false);
const original = ref(props.project),
  draft = ref(props.project.notes),
  error = ref<Error | ApiError | null>(null);
const dirty = computed(
  () => draft.value !== original.value.notes || !!capture.value?.hasFiles,
);
const persisted = useEditorDraft({
  kind: "notes",
  projectId: props.project.id,
  entityId: props.project.id,
  schema: notesEditorDraft,
  value: draft,
  dirty,
  baseVersion: () => original.value.version,
  currentVersion: () =>
    store.data.projects.find((p) => p.id === props.project.id)?.version,
  restore(value) {
    editing.value = true;
    original.value = store.data.projects.find(
      (p) => p.id === props.project.id,
    )!;
    draft.value = value;
  },
});
const discard = useUnsaved(dirty, () =>
  t("Leave this editor? Unsubmitted drafts stay in this tab for recovery."),
);
watch(
  () => props.project,
  (p) => {
    if (!dirty.value) {
      original.value = p;
      draft.value = p.notes;
    }
  },
);
const noteTables = computed(() => {
  const groups: string[][][] = [];
  let rows: string[][] = [];
  for (const line of draft.value.split(/\r?\n/)) {
    if (line.includes("\t")) rows.push(line.split("\t"));
    else if (rows.length) {
      groups.push(rows);
      rows = [];
    }
  }
  if (rows.length) groups.push(rows);
  return groups;
});
function cancel() {
  if (discard() && persisted.discard()) {
    draft.value = original.value.notes;
    error.value = null;
    editing.value = false;
  }
}
function discardSavedDraft() {
  if (!persisted.discard()) return;
  original.value =
    store.data.projects.find((p) => p.id === props.project.id) ?? props.project;
  draft.value = original.value.notes;
  error.value = null;
}
function reload() {
  const current = (error.value as ApiError).current as Project;
  original.value = current;
  draft.value = current.notes;
  error.value = null;
  persisted.discard();
}
async function save() {
  error.value = null;
  try {
    if (capture.value?.hasFiles && !sourcesPrepared.value) {
      draft.value = (await capture.value.resolveSource()).text;
      sourcesPrepared.value = true;
      return;
    }
    if (!persisted.beforeSave()) return;
    const p = await store.saveProject(
      { ...projectInput.strip().parse(original.value), notes: draft.value },
      original.value,
    );
    original.value = p;
    draft.value = p.notes;
    editing.value = false;
    persisted.complete(true);
  } catch (e) {
    error.value = e as Error;
  }
}
</script>
<template>
  <section
    class="inline-notes"
    :class="{ 'has-note-table': noteTables.length }"
  >
    <div class="section-heading">
      <h4>{{ t("Original notes") }}</h4>
      <button v-if="!editing" class="text-button" @click="editing = true">
        {{ t("Edit notes") }}
      </button>
      <span class="muted"
        >{{ t(dirty ? "Unsaved changes" : "Text / table paste") }} · v{{
          formatNumber(original.version)
        }}</span
      >
    </div>
    <SaveError :error="error" @reload="reload" />
    <EditorDraftNotice
      v-bind="persisted.notice.value"
      @restore="persisted.restore"
      @discard="discardSavedDraft"
    />
    <div
      v-for="(rows, index) in noteTables"
      :key="index"
      class="note-table-scroll"
      role="region"
      :aria-label="
        t('Readable original table {count}', { count: formatNumber(index + 1) })
      "
      tabindex="0"
    >
      <table>
        <caption>
          {{
            t("Readable table · original text retained below")
          }}
        </caption>
        <thead>
          <tr>
            <th v-for="(cell, column) in rows[0]" :key="column" scope="col">
              {{
                cell || t("Column {count}", { count: formatNumber(column + 1) })
              }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in rows.slice(1)" :key="rowIndex">
            <td v-for="(cell, column) in row" :key="column">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="!editing" class="notes-reading">
      {{ draft || t("No notes yet") }}
    </div>
    <form v-if="editing" @submit.prevent="save">
      <CaptureInput
        ref="capture"
        v-model="draft"
        :disabled="persisted.pending.value || store.busy"
        :label="t('Original notes for {name}', { name: project.name })"
        :rows="5"
        :maxlength="20000"
        :placeholder="t('Capture what happened. Paste notes or a table here…')"
        @attachments-change="sourcesPrepared = false"
        @submit="save"
      />
      <div class="form-actions">
        <button type="button" :disabled="store.busy" @click="cancel">
          {{ t("Cancel notes") }}</button
        ><button
          class="primary"
          :disabled="
            store.busy || !!capture?.busy || !dirty || persisted.pending.value
          "
        >
          {{
            capture?.hasFiles && !sourcesPrepared
              ? t("读取并预览")
              : t("Save notes")
          }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.notes-reading {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 280px;
  overflow-y: auto;
  line-height: 1.9;
  font-size: 13px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
}
.inline-notes textarea {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  width: 100%;
  min-height: 180px;
  line-height: 1.8;
  height: auto;
  font-family: inherit;
}
</style>
