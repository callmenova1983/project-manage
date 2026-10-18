<script setup lang="ts">
import {
  useTaskViewMemory,
  useTaskViewScroll,
} from "../composables/task-view-memory";
useTaskViewScroll("board:page");
import { computed, inject, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { type Status, type Task } from "../../../../packages/domain/types";
import {
  taskBoardColumns,
  taskBoardRows,
} from "../../../../packages/domain/task-board";
import { memberName } from "../../../../packages/domain/members";
import { useWorkspace } from "../stores/workspace";
import { t, formatDate, formatNumber } from "../locales";
import { statusLabels } from "../locales/en";
import { confirmDiscard } from "../composables/unsaved";
import { taskDetailsKey } from "../composables/task-details";
import StatusBadge from "./StatusBadge.vue";
import TaskDetailPanel from "./TaskDetailPanel.vue";

const props = defineProps<{ tasks: Task[]; showProject?: boolean }>();
const store = useWorkspace();
const columns = taskBoardColumns;
const editing = ref<Task | null>(null);
const openCollectionDetails = inject(taskDetailsKey, null);
const route = useRoute();
watch(
  () => route.fullPath,
  () => {
    editing.value = null;
  },
);
const dragging = ref<Task | null>(null);
const dropColumn = ref<Status | null>(null);
const error = ref("");
const board = ref<HTMLElement | null>(null);
const limits = useTaskViewMemory<Record<Status, number>>(
  "board:limits",
  () => ({
    todo: 30,
    in_progress: 30,
    blocked: 30,
    done: 30,
  }),
);
const collapsed = useTaskViewMemory("board:completed-collapsed", () => false);
let trigger: HTMLElement | null = null;
const taskMap = computed(
  () => new Map(store.data.tasks.map((task) => [task.id, task])),
);
const projectMap = computed(
  () =>
    new Map(store.data.projects.map((project) => [project.id, project.name])),
);
const rows = computed(() => taskBoardRows(props.tasks));
function parentPath(task: Task) {
  const names: string[] = [],
    seen = new Set([task.id]);
  let id = task.parentId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const parent = taskMap.value.get(id);
    if (!parent || parent.projectId !== task.projectId) break;
    names.unshift(parent.title);
    id = parent.parentId;
  }
  return names.join(" / ");
}
function edit(task: Task, event: Event) {
  if (!confirmDiscard()) return;
  if (openCollectionDetails) {
    openCollectionDetails(task.id);
    return;
  }
  trigger = event.currentTarget as HTMLElement;
  editing.value = task;
}
async function close() {
  editing.value = null;
  await nextTick();
  if (trigger?.isConnected) trigger.focus();
  else board.value?.focus();
}
function startDrag(task: Task, event: DragEvent) {
  if (
    store.busy ||
    editing.value ||
    (event.target as HTMLElement).closest("button, select, a, input")
  ) {
    event.preventDefault();
    return;
  }
  dragging.value = { ...task };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-pm-task", task.id);
  }
}
function clearDrag() {
  dragging.value = null;
  dropColumn.value = null;
}
function dragOver(status: Status, event: DragEvent) {
  if (!dragging.value || store.busy) return;
  event.preventDefault();
  dropColumn.value = status;
}
async function change(task: Task, status: Status) {
  if (store.busy || task.status === status) return;
  error.value = "";
  try {
    await store.changeTaskStatus(task, status);
  } catch (reason) {
    error.value = (reason as Error).message;
    await store.refresh(true);
  }
  await nextTick();
  if (document.activeElement === document.body) board.value?.focus();
}
function drop(status: Status, event: DragEvent) {
  if (!dragging.value) return;
  event.preventDefault();
  const task = dragging.value;
  clearDrag();
  const current = taskMap.value.get(task.id);
  if (!current || current.voided || current.version !== task.version) {
    error.value =
      "This task changed after your action. Review its current state before editing.";
    return;
  }
  void change(task, status);
}
function selectStatus(task: Task, event: Event) {
  const control = event.target as HTMLSelectElement;
  const status = control.value as Status;
  control.value = task.status;
  void change(task, status);
}
</script>

<template>
  <div
    ref="board"
    class="task-board"
    tabindex="-1"
    :aria-label="t('Task board')"
  >
    <p v-if="error" role="alert" class="error-box">{{ t(error) }}</p>
    <TaskDetailPanel :task-id="editing?.id ?? ''" @close="close" />
    <p class="board-help muted">
      {{ t("Drag a card or use its status menu to move work.") }}
    </p>
    <div class="board-columns">
      <section
        v-for="status in columns"
        :key="status"
        class="board-column"
        :class="{ 'drop-target': dropColumn === status }"
        :aria-label="t(statusLabels[status])"
        @dragover="dragOver(status, $event)"
        @drop="drop(status, $event)"
      >
        <header class="column-heading">
          <StatusBadge :status="status" />
          <span class="column-count">{{
            formatNumber(rows[status].length)
          }}</span>
          <button
            v-if="status === 'done'"
            class="text-button"
            :aria-expanded="!collapsed"
            @click="collapsed = !collapsed"
          >
            {{
              t(
                collapsed
                  ? "Expand completed tasks"
                  : "Collapse completed tasks",
              )
            }}
          </button>
        </header>
        <template v-if="status !== 'done' || !collapsed">
          <p v-if="!rows[status].length" class="column-empty muted">
            {{ t("No matching tasks") }}
          </p>
          <article
            v-for="task in rows[status].slice(0, limits[status])"
            :key="task.id"
            :id="`task-${task.id}`"
            :data-task-id="task.id"
            class="board-card"
            :class="{ dragging: dragging?.id === task.id }"
            :draggable="!store.busy && !editing"
            @dragstart="startDrag(task, $event)"
            @dragend="clearDrag"
          >
            <p v-if="showProject" class="card-project">
              {{ projectMap.get(task.projectId) }}
            </p>
            <button class="card-title" @click="edit(task, $event)">
              {{ task.title }}
            </button>
            <p v-if="task.parentId" class="card-parent muted">
              {{ parentPath(task) }}
            </p>
            <div class="card-meta">
              <span>{{
                t(
                  memberName(
                    task.assigneeId,
                    task.assignee,
                    store.data.members ?? [],
                  ),
                )
              }}</span>
              <span>{{
                task.dueDate ? formatDate(task.dueDate) : t("No due date")
              }}</span>
            </div>
            <select
              :value="task.status"
              :disabled="store.busy"
              :aria-label="t('Status for {title}', { title: task.title })"
              @change="selectStatus(task, $event)"
            >
              <option
                v-for="destination in columns"
                :key="destination"
                :value="destination"
              >
                {{ t(statusLabels[destination]) }}
              </option>
            </select>
          </article>
          <button
            v-if="rows[status].length > limits[status]"
            class="load-more"
            @click="limits = { ...limits, [status]: limits[status] + 30 }"
          >
            {{
              t("Show {count} more tasks", {
                count: Math.min(30, rows[status].length - limits[status]),
              })
            }}
          </button>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.board-help {
  margin: 8px 0 12px;
  font-size: 12px;
}
.board-columns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
.board-column {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-hover);
}
.board-column.drop-target {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.column-heading {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.column-count {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.column-heading button {
  margin-left: auto;
  font-size: 11px;
}
.column-empty {
  padding: 20px 4px;
  text-align: center;
  font-size: 12px;
}
.board-card {
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 12px;
  background: var(--surface);
  margin-top: 10px;
  overflow-wrap: anywhere;
}
.board-card.dragging {
  opacity: 0.5;
}
.card-project {
  color: var(--accent);
  font-size: 12px;
  margin: 0 0 6px;
}
.card-title {
  display: block;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  text-align: left;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.6;
  width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}
.card-parent {
  margin: 6px 0;
  font-size: 11px;
}
.card-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px;
  margin: 12px 0;
  font-size: 12px;
  color: var(--muted);
}
.board-card select {
  width: 100%;
}
.load-more {
  width: 100%;
  margin-top: 12px;
}
@media (max-width: 1100px) {
  .board-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .board-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .board-card select,
  .card-title,
  .column-heading button,
  .load-more {
    min-height: 44px;
  }
}
</style>
