<script setup lang="ts">
import { t } from "../locales";
import { computed, ref } from "vue";
import {
  taskInput,
  statuses,
  dayKey,
  weekKey,
  type Task,
  type TaskInput,
} from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { statusLabels } from "../locales/en";
import { useUnsaved } from "../composables/unsaved";
import SaveError from "./SaveError.vue";
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
        workWeek: weekKey(),
        workDates: [],
      },
);
let baseline = JSON.stringify(draft.value);
const dirty = computed(() => JSON.stringify(draft.value) !== baseline);
const mayDiscard = useUnsaved(dirty);
const error = ref<Error | ApiError | null>(null);
const isParent = computed(() =>
  store.data.tasks.some((t) => t.parentId === props.task?.id),
);
const week = computed({
  get: () => draft.value.workWeek === weekKey(),
  set: (v: boolean) => {
    draft.value.workWeek = v ? weekKey() : null;
    draft.value.workDates = v
      ? draft.value.workDates.filter(
          (date) => weekKey(new Date(date)) === weekKey(),
        )
      : [];
  },
});
const today = computed({
  get: () => draft.value.workDates.includes(dayKey()),
  set: (v: boolean) => {
    draft.value.workDates = v ? [dayKey()] : [];
    if (v) draft.value.workWeek = weekKey();
  },
});
async function save() {
  error.value = null;
  try {
    if (draft.value.dueDate === "") draft.value.dueDate = null;
    const result = await store.saveTask(
      taskInput.parse(draft.value),
      original.value,
    );
    baseline = JSON.stringify(draft.value);
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
      ><label
        >{{ t("Assignee")
        }}<input v-model="draft.assignee" maxlength="80" /></label
      ><label
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
    <div class="form-actions">
      <button
        type="button"
        :disabled="store.busy"
        @click="mayDiscard() && emit('close')"
      >
        {{ t("Cancel") }}</button
      ><button type="submit" class="primary" :disabled="store.busy">
        {{ t(store.busy ? "Saving…" : "Save task") }}
      </button>
    </div>
  </form>
</template>
