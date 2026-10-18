<script setup lang="ts">
import { t, formatDate, formatNumber } from "../locales";
import { computed, ref, watch } from "vue";
import {
  projectInput,
  noteDateCandidates,
  type Project,
} from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved } from "../composables/unsaved";
import { api, ApiError } from "../services/api";
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
    resetReview();
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
const candidates = computed(() => noteDateCandidates(draft.value));
const review = ref<number | null>(null),
  taskId = ref(""),
  dueDate = ref(""),
  confirmed = ref(false),
  overwrite = ref(false);
const selected = computed(() =>
  store.data.tasks.find((t) => t.id === taskId.value),
);
const tasks = computed(() =>
  store.data.tasks.filter((t) => t.projectId === props.project.id),
);
function resetReview() {
  review.value = null;
  confirmed.value = false;
  overwrite.value = false;
}
function cancel() {
  if (discard() && persisted.discard()) {
    draft.value = original.value.notes;
    error.value = null;
    resetReview();
    editing.value = false;
  }
}
function discardSavedDraft() {
  if (!persisted.discard()) return;
  original.value =
    store.data.projects.find((p) => p.id === props.project.id) ?? props.project;
  draft.value = original.value.notes;
  error.value = null;
  resetReview();
}
function reload() {
  const current = (error.value as ApiError).current as Project;
  original.value = current;
  draft.value = current.notes;
  error.value = null;
  resetReview();
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
    resetReview();
    persisted.complete(true);
  } catch (e) {
    error.value = e as Error;
  }
}
async function applyDate(line: number) {
  if (!selected.value) return;
  error.value = null;
  try {
    await store.operation(
      () =>
        api.confirmNoteDate(props.project.id, {
          projectVersion: original.value.version,
          sourceLine: line,
          taskId: taskId.value,
          taskVersion: selected.value!.version,
          dueDate: dueDate.value,
          confirmed: true,
          overwriteConfirmed: overwrite.value,
        }),
      t("Reviewed date saved"),
    );
    resetReview();
  } catch (e) {
    error.value = new Error((e as Error).message);
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
        @update:model-value="resetReview"
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
    <div v-for="c in candidates" :key="c.sourceLine" class="date-candidate">
      <button
        class="text-button amber"
        :disabled="dirty || persisted.pending.value"
        @click="
          review = review === c.sourceLine ? null : c.sourceLine;
          dueDate = c.proposedDate;
          confirmed = false;
          overwrite = false;
        "
      >
        {{
          t("Review date · “{phrase}” · line {line}", {
            phrase: c.phrase,
            line: formatNumber(c.sourceLine),
          })
        }}
      </button>
      <span v-if="dirty" class="muted">{{
        t("Save notes to review dates")
      }}</span>
      <form
        v-if="review === c.sourceLine && !dirty"
        class="date-review"
        @submit.prevent="applyDate(c.sourceLine)"
      >
        <p class="muted">
          {{
            t(
              "Rule-assisted candidate. Read the neighboring lines and choose the intended date.",
            )
          }}
        </p>
        <pre>{{ c.context }}</pre>
        <label
          >{{ t("Apply to task")
          }}<select
            v-model="taskId"
            required
            @change="
              confirmed = false;
              overwrite = false;
            "
          >
            <option value="">{{ t("Choose a task") }}</option>
            <option v-for="task in tasks" :key="task.id" :value="task.id">
              {{ task.title }}
            </option>
          </select></label
        >
        <label
          >{{ t("Confirmed due date")
          }}<input
            v-model="dueDate"
            type="date"
            required
            @input="
              confirmed = false;
              overwrite = false;
            "
        /></label>
        <p v-if="selected" class="muted">
          {{ t("Current due date:") }}
          {{ selected.dueDate ? formatDate(selected.dueDate) : t("None") }}
        </p>
        <label class="check-label"
          ><input v-model="confirmed" type="checkbox" />{{
            t("I checked the source, task and date")
          }}</label
        >
        <label
          v-if="selected?.dueDate && selected.dueDate !== dueDate"
          class="check-label"
          ><input v-model="overwrite" type="checkbox" />{{
            t("Replace the existing due date")
          }}</label
        >
        <div class="form-actions">
          <button type="button" @click="resetReview">
            {{ t("Cancel review") }}</button
          ><button
            class="primary"
            :disabled="
              !selected ||
              !dueDate ||
              !confirmed ||
              (!!selected.dueDate &&
                selected.dueDate !== dueDate &&
                !overwrite) ||
              store.busy
            "
          >
            {{ t("Apply reviewed date") }}
          </button>
        </div>
      </form>
    </div>
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
