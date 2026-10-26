<script setup lang="ts">
import { currentDay, currentWeek } from "../composables/calendar";
import { calendarWeek } from "../../../../packages/domain/time-zone";
import { t } from "../locales";
import { computed, ref } from "vue";
import {
  taskInput,
  statuses,
  type Task,
  type TaskInput,
} from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { statusLabels } from "../locales/en";
import { useUnsaved } from "../composables/unsaved";
import SaveError from "./SaveError.vue";
import MemberAssignment from "./MemberAssignment.vue";
import EditorDraftNotice from "./EditorDraftNotice.vue";
import { useEditorDraft } from "../composables/editor-draft";
import { taskEditorDraft } from "../services/editor-drafts";
import { ApiError } from "../services/api";
const props = defineProps<{
  task?: Task;
  projectId: string;
  parentId?: string;
}>();
const emit = defineEmits<{ close: []; saved: [Task] }>();
const store = useWorkspace();
const original = ref(props.task);
const draft = ref<TaskInput>(
  props.task
    ? taskInput.strip().parse(props.task)
    : {
        projectId: props.projectId,
        parentId: props.parentId ?? null,
        title: "",
        description: "",
        status: "todo",
        assignee: "Unassigned",
        dueDate: null,
        workWeek: currentWeek(),
        workDates: [],
      },
);
let baseline = JSON.stringify(draft.value);
const dirty = computed(() => JSON.stringify(draft.value) !== baseline);
const creationVersion = props.parentId
  ? store.data.tasks.find((t) => t.id === props.parentId)?.version
  : store.data.projects.find((p) => p.id === props.projectId)?.version;
const persisted = useEditorDraft({
  kind: "task",
  projectId: props.projectId,
  entityId: props.task?.id ?? "",
  parentId: props.parentId,
  schema: taskEditorDraft,
  value: draft,
  dirty,
  baseVersion: () => original.value?.version ?? creationVersion ?? null,
  currentVersion: () =>
    props.task
      ? store.data.tasks.find((t) => t.id === props.task!.id)?.version
      : props.parentId
        ? store.data.tasks.find(
            (t) => t.id === props.parentId && t.projectId === props.projectId,
          )?.version
        : store.data.projects.find((p) => p.id === props.projectId)?.version,
  restore(value) {
    if (props.task)
      original.value = store.data.tasks.find((t) => t.id === props.task!.id);
    draft.value = value;
  },
});
const initial = JSON.stringify(draft.value);
const mayDiscard = useUnsaved(dirty, () =>
  t("Leave this editor? Unsubmitted drafts stay in this tab for recovery."),
);
function cancel() {
  if (persisted.pending.value || (mayDiscard() && persisted.cancel()))
    emit("close");
}
function discardSavedDraft() {
  if (!persisted.discard()) return;
  original.value = props.task
    ? store.data.tasks.find((t) => t.id === props.task!.id)
    : undefined;
  draft.value = original.value
    ? taskInput.strip().parse(original.value)
    : JSON.parse(initial);
  baseline = JSON.stringify(draft.value);
  error.value = null;
}
const error = ref<Error | ApiError | null>(null);
const isParent = computed(() =>
  store.data.tasks.some((t) => t.parentId === props.task?.id),
);
const week = computed({
  get: () => draft.value.workWeek === currentWeek(),
  set: (v: boolean) => {
    draft.value.workWeek = v ? currentWeek() : null;
    draft.value.workDates = v
      ? draft.value.workDates.filter(
          (date) => calendarWeek(date) === currentWeek(),
        )
      : [];
  },
});
const today = computed({
  get: () => draft.value.workDates.includes(currentDay()),
  set: (v: boolean) => {
    draft.value.workDates = v ? [currentDay()] : [];
    if (v) draft.value.workWeek = currentWeek();
  },
});
async function save() {
  error.value = null;
  try {
    if (draft.value.dueDate === "") draft.value.dueDate = null;
    const input = taskInput.parse(draft.value);
    if (!persisted.beforeSave()) return;
    const result = await store.saveTask(input, original.value);
    baseline = JSON.stringify(draft.value);
    persisted.complete();
    emit("saved", result);
  } catch (e) {
    error.value = e as Error;
  }
}
function reload() {
  const current = (error.value as ApiError).current as Task;
  original.value = current;
  draft.value = taskInput.strip().parse(current);
  baseline = JSON.stringify(draft.value);
  error.value = null;
  persisted.discard();
}
</script>
<template>
  <form
    class="editor task-editor"
    :aria-label="t('Task editor')"
    @submit.prevent="save"
  >
    <div class="section-heading">
      <h3>
        {{ t(task ? "Edit task" : parentId ? "New subtask" : "New task") }}
      </h3>
      <span v-if="dirty" class="muted">{{ t("Unsaved changes") }}</span>
    </div>
    <SaveError :error="error" @reload="reload" />
    <EditorDraftNotice
      v-bind="persisted.notice.value"
      @restore="persisted.restore"
      @discard="discardSavedDraft"
    />
    <fieldset
      class="draft-edit-fields"
      :disabled="persisted.pending.value || store.busy"
    >
      <div class="form-grid">
        <label v-if="original && !original.parentId && !isParent" class="full">
          {{ t("Project assignment") }}
          <select
            v-model="draft.projectId"
            :aria-label="t('Project assignment')"
            aria-describedby="task-assignment-help"
          >
            <option
              v-for="project in store.data.projects"
              :key="project.id"
              :value="project.id"
            >
              {{ project.name }}
            </option>
          </select>
          <small id="task-assignment-help">{{
            t("Save now and assign this task to a project later.")
          }}</small>
        </label>
        <label class="full"
          >{{ t("Task title")
          }}<input
            v-model="draft.title"
            required
            maxlength="240"
            autofocus /></label
        ><label
          >{{ t("Status")
          }}<select v-model="draft.status" :disabled="isParent">
            <option v-for="s in statuses" :key="s" :value="s">
              {{ statusLabels[s] }}
            </option></select
          ><small v-if="isParent">{{
            t("Parent completion is calculated from subtasks.")
          }}</small></label
        >
        <MemberAssignment
          label="Assignee"
          v-model="draft.assignee"
          v-model:memberId="draft.assigneeId"
        />
        <label
          >{{ t("Due date") }}<input v-model="draft.dueDate" type="date"
        /></label>
        <div class="planning">
          <span>{{ t("Work scope") }}</span
          ><label class="check-label"
            ><input v-model="week" type="checkbox" />{{ t("This week") }}</label
          ><label class="check-label"
            ><input v-model="today" type="checkbox" />{{ t("Today") }}</label
          >
        </div>
        <label class="full"
          >{{ t("Description")
          }}<textarea
            v-model="draft.description"
            maxlength="4000"
            rows="3"
          ></textarea>
        </label>
      </div>
    </fieldset>
    <div class="form-actions">
      <button type="button" :disabled="store.busy" @click="cancel">
        {{ t("Cancel") }}</button
      ><button
        type="submit"
        class="primary"
        :disabled="store.busy || persisted.pending.value"
      >
        {{ t(store.busy ? "Saving…" : "Save task") }}
      </button>
    </div>
  </form>
</template>
