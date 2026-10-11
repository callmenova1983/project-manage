<script setup lang="ts">
import { t, formatDate, formatNumber } from "../locales";
import { computed, ref } from "vue";
import {
  PhPlus,
  PhPencilSimple,
  PhCheckSquare,
  PhSquaresFour,
} from "@phosphor-icons/vue";
import {
  taskInput,
  leafTasks,
  statistics,
  statuses,
  type Task,
} from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { statusLabels } from "../locales/en";
import { confirmDiscard } from "../composables/unsaved";
import TaskEditor from "./TaskEditor.vue";
import StatusBadge from "./StatusBadge.vue";
const props = defineProps<{
  tasks: Task[];
  projectId?: string;
  showProject?: boolean;
}>();
const store = useWorkspace();
const editing = ref<Task | null>(null),
  adding = ref(false),
  parentId = ref<string | undefined>(),
  error = ref("");
const parents = computed(
  () => new Set(store.data.tasks.map((t) => t.parentId).filter(Boolean)),
);
const ordered = computed(() => {
  const ids = new Set(props.tasks.map((t) => t.id));
  const result: Task[] = [];
  const visit = (t: Task) => {
    result.push(t);
    props.tasks.filter((x) => x.parentId === t.id).forEach(visit);
  };
  props.tasks.filter((t) => !t.parentId || !ids.has(t.parentId)).forEach(visit);
  return result;
});
function children(t: Task) {
  const descend = (id: string): Task[] =>
    store.data.tasks
      .filter((x) => x.parentId === id)
      .flatMap((x) => [x, ...descend(x.id)]);
  return statistics(leafTasks(descend(t.id)));
}
async function change(t: Task, e: Event) {
  error.value = "";
  try {
    await store.saveTask(
      {
        ...taskInput.strip().parse(t),
        status: (e.target as HTMLSelectElement).value as Task["status"],
      },
      t,
    );
  } catch (e) {
    error.value = (e as Error).message;
    await store.refresh(true);
  }
}
function close() {
  editing.value = null;
  adding.value = false;
  parentId.value = undefined;
}
</script>
<template>
  <div class="task-list">
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <div v-if="!tasks.length" class="empty compact">
      <PhCheckSquare :size="28" />
      <h3>{{ t("No tasks here yet") }}</h3>
      <p>{{ t("Add a task or adjust your filters.") }}</p>
    </div>
    <template v-for="task in ordered" :key="task.id"
      ><TaskEditor
        v-if="editing?.id === task.id"
        :task="editing"
        :projectId="task.projectId"
        @close="close"
        @saved="close" />
      <div
        v-else
        class="task-row"
        :class="{ subtask: task.parentId, parent: parents.has(task.id) }"
      >
        <div class="task-status">
          <span v-if="parents.has(task.id)" class="muted"
            ><PhSquaresFour :size="18" /></span
          ><select
            v-else
            :aria-label="t('Status for {title}', { title: task.title })"
            :value="task.status"
            :disabled="store.busy"
            @change="change(task, $event)"
          >
            <option v-for="s in statuses" :key="s" :value="s">
              {{ statusLabels[s] }}
            </option>
          </select>
        </div>
        <div class="task-name">
          <button
            class="text-button"
            @click="confirmDiscard() && (editing = task)"
          >
            {{ task.title }}</button
          ><RouterLink
            v-if="showProject"
            class="muted task-project"
            :to="`/projects/${task.projectId}`"
            >{{
              store.data.projects.find((p) => p.id === task.projectId)?.name
            }}</RouterLink
          ><span v-if="parents.has(task.id)" class="muted">{{
            t("{done}/{total} subtasks completed", {
              done: formatNumber(children(task).done),
              total: formatNumber(children(task).total),
            })
          }}</span>
        </div>
        <StatusBadge v-if="!parents.has(task.id)" :status="task.status" /><span
          class="task-assignee muted"
          >{{ task.assignee }}</span
        ><span class="task-date muted">{{
          task.dueDate
            ? formatDate(task.dueDate, { month: "short", day: "numeric" })
            : t("No due date")
        }}</span
        ><button
          v-if="projectId"
          class="icon-button"
          :aria-label="t('Add subtask to {title}', { title: task.title })"
          @click="
            if (confirmDiscard()) {
              parentId = task.id;
              adding = true;
            }
          "
        >
          <PhPlus :size="15" /></button
        ><button
          class="icon-button"
          :aria-label="t('Edit {title}', { title: task.title })"
          @click="confirmDiscard() && (editing = task)"
        >
          <PhPencilSimple :size="15" />
        </button></div></template
    ><TaskEditor
      v-if="adding && projectId"
      :key="parentId ?? 'root'"
      :projectId="projectId"
      :parentId="parentId"
      @close="close"
      @saved="close"
    /><button
      v-if="projectId && !adding"
      class="text-button add-task"
      @click="adding = true"
    >
      <PhPlus :size="16" />{{ t("Add task") }}
    </button>
  </div>
</template>
