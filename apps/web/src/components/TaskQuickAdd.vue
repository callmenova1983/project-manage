<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { PhX } from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { currentWeek, currentDay } from "../composables/calendar";
import { useUnsaved } from "../composables/unsaved";
import { t } from "../locales";
import TaskEditor from "./TaskEditor.vue";
import TaskPlanningImpact from "./TaskPlanningImpact.vue";
import { taskPlanningImpact } from "../../../../packages/domain/task-planning-impact";
const props = defineProps<{
  projectId: string;
  parentId?: string;
  scope?: "week" | "today";
  compact?: boolean;
  unscheduled?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspace();
const planningBlocked = computed(
  () =>
    !!props.parentId &&
    taskPlanningImpact(store.data.tasks, props.parentId).blocksParent,
);
const title = ref(""),
  error = ref(""),
  advanced = ref(false),
  input = ref<HTMLInputElement | null>(null);
useUnsaved(computed(() => !advanced.value && !!title.value.trim()));
onMounted(() => input.value?.focus());
async function add() {
  if (!title.value.trim() || store.busy || planningBlocked.value) return;
  error.value = "";
  try {
    await store.saveTask({
      projectId: props.projectId,
      parentId: props.parentId ?? null,
      title: title.value.trim(),
      description: "",
      status: "todo",
      assignee: "",
      dueDate: null,
      workWeek: props.unscheduled && !props.scope ? null : currentWeek(),
      workDates: props.scope === "today" ? [currentDay()] : [],
    });
    title.value = "";
    if (props.compact) emit("close");
    else input.value?.focus();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <TaskEditor
    v-if="advanced"
    :projectId="projectId"
    :parentId="parentId"
    :initialTitle="title"
    :initial-dates="
      unscheduled ? { dueDate: null, workWeek: null, workDates: [] } : undefined
    "
    @close="advanced = false"
    @saved="
      title = '';
      emit('close');
    "
  />
  <div v-else class="quick-task-add" :class="{ subtask: parentId, compact }">
    <TaskPlanningImpact v-if="parentId" :task-id="parentId" mode="parent" />
    <form
      :aria-label="t(parentId ? 'Quick add subtask' : 'Quick add task')"
      @submit.prevent="add"
      @keydown.esc.stop.prevent="emit('close')"
    >
      <input
        ref="input"
        v-model="title"
        :aria-label="t('Task title')"
        :placeholder="
          t(
            parentId
              ? 'Subtask title · Enter to add'
              : 'Task title · Enter to add',
          )
        "
        maxlength="240"
        required
        :disabled="store.busy"
      />
      <button
        class="primary"
        type="submit"
        :disabled="store.busy || !title.trim() || planningBlocked"
      >
        {{ t("Add") }}
      </button>
      <button
        type="button"
        v-if="!compact"
        class="text-button"
        :disabled="store.busy"
        @click="advanced = true"
      >
        {{ t("More") }}
      </button>
      <button
        type="button"
        class="icon-button"
        :aria-label="t('Cancel')"
        :disabled="store.busy"
        @click="emit('close')"
      >
        <PhX :size="16" />
      </button>
    </form>
    <small v-if="!compact && !unscheduled" class="muted">{{
      t("先保存原文，再后台分析；有必要时提示补全负责人或时间。")
    }}</small>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
  </div>
</template>
<style scoped>
.quick-task-add {
  padding: 12px 0;
}
.quick-task-add.subtask {
  padding-left: 28px;
}
.quick-task-add form {
  display: flex;
  gap: 8px;
  align-items: center;
}
.quick-task-add input {
  min-width: 0;
  flex: 1;
  height: 36px;
}
.quick-task-add small {
  display: block;
  margin-top: 5px;
  font-size: 11px;
}
.quick-task-add .text-button {
  flex-shrink: 0;
}
.quick-task-add.compact {
  padding: 3px 0;
}
.compact form {
  gap: 4px;
  flex-wrap: wrap;
}
.compact input {
  flex: 1 1 110px;
  height: 30px;
  padding: 5px 7px;
  font-size: 12px;
}
.compact button {
  padding: 4px 6px;
  min-height: 30px;
  font-size: 11px;
}
</style>
