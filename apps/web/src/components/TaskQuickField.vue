<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import PersonPicker from "./PersonPicker.vue";
import TaskFieldCopy from "./TaskFieldCopy.vue";
import { PhCheck, PhX } from "@phosphor-icons/vue";
import { taskInput, type Task } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved, confirmDiscard } from "../composables/unsaved";
import { t, formatDate } from "../locales";
const props = defineProps<{
  task: Task;
  field: "title" | "assignee" | "dueDate";
  singleClick?: boolean;
  copyTargets?: Task[];
}>();
const store = useWorkspace();
const editing = ref(false),
  draft = ref(""),
  error = ref("");
const original = ref<Task | null>(null),
  input = ref<HTMLInputElement | null>(null);
const label = computed(() =>
  t(
    props.field === "title"
      ? "Task title"
      : props.field === "assignee"
        ? "Assignee"
        : "Due date",
  ),
);
const dirty = computed(
  () => editing.value && draft.value !== (original.value?.[props.field] ?? ""),
);
useUnsaved(dirty);
async function open() {
  if (store.busy || !confirmDiscard()) return;
  original.value = { ...props.task };
  draft.value = props.task[props.field] ?? "";
  error.value = "";
  editing.value = true;
  await nextTick();
  input.value?.focus();
  if (props.field !== "dueDate") input.value?.select();
}
function cancel() {
  editing.value = false;
  error.value = "";
}
async function save() {
  if (!dirty.value) {
    cancel();
    return;
  }
  error.value = "";
  try {
    await store.saveTask(
      taskInput.parse({
        ...taskInput.strip().parse(original.value!),
        [props.field]:
          props.field === "dueDate" ? draft.value || null : draft.value,
      }),
      original.value!,
    );
    cancel();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <div class="quick-task-field" :class="{ editing }">
    <form
      v-if="editing"
      @submit.prevent="save"
      @keydown.esc.stop.prevent="cancel"
    >
      <PersonPicker
        v-if="field === 'assignee'"
        v-model="draft"
        :project-id="task.projectId"
        :label="label"
        :disabled="store.busy"
        auto-open
        compact
        @select="save"
        @cancel="cancel"
      />
      <input
        v-else
        ref="input"
        v-model="draft"
        :type="field === 'dueDate' ? 'date' : 'text'"
        :aria-label="label"
        :maxlength="field === 'title' ? 240 : 80"
        :required="field === 'title'"
        :disabled="store.busy"
      />
      <button
        v-if="field !== 'assignee' || error"
        class="icon-button"
        type="submit"
        :aria-label="t('Save')"
        :disabled="store.busy"
      >
        <PhCheck :size="15" />
      </button>
      <button
        class="icon-button"
        type="button"
        :aria-label="t('Cancel')"
        :disabled="store.busy"
        @click="cancel"
      >
        <PhX :size="15" />
      </button>
    </form>
    <button
      v-else
      class="text-button field-value"
      :title="
        t(
          field === 'title' && !singleClick
            ? 'Double-click to edit task title'
            : 'Click to edit',
        )
      "
      :aria-label="
        field === 'title'
          ? task.title
          : `${label}: ${task[field] || t('Unassigned')}`
      "
      @click="(field !== 'title' || singleClick) && open()"
      @dblclick="field === 'title' && !singleClick && open()"
      @keydown.f2.prevent="open"
      @keydown.enter.prevent="open"
    >
      {{
        field === "title"
          ? task.title
          : field === "assignee"
            ? t(task.assignee || "Unassigned")
            : task.dueDate
              ? formatDate(task.dueDate, { month: "short", day: "numeric" })
              : t("No due date")
      }}
    </button>
    <TaskFieldCopy
      v-if="!editing && copyTargets && field !== 'title'"
      :task="task"
      :field="field"
      :tasks="copyTargets"
    />
    <small v-if="error" class="quick-field-error" role="alert">{{
      t(error)
    }}</small>
  </div>
</template>
<style scoped>
.quick-task-field {
  min-width: 0;
}
.quick-task-field:has(.copy-field-button) {
  display: flex;
  align-items: center;
  gap: 2px;
}
.quick-task-field form {
  display: flex;
  gap: 3px;
  align-items: center;
}
.quick-task-field input {
  min-width: 0;
  width: 100%;
  height: 32px;
  padding: 4px 7px;
}
.quick-task-field .icon-button {
  flex-shrink: 0;
  width: 26px;
  height: 30px;
}
.field-value {
  color: inherit;
  text-align: left;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}
.quick-field-error {
  display: block;
  color: var(--danger, #e15b68);
  margin-top: 4px;
}
</style>
