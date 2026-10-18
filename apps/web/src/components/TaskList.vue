<script setup lang="ts">
import { useTaskViewMemory } from "../composables/task-view-memory";
import { orderTaskTree } from "../../../../packages/domain/task-list-view";
import { t, formatDate, formatNumber } from "../locales";
import {
  computed,
  defineAsyncComponent,
  inject,
  nextTick,
  ref,
  watch,
} from "vue";
import { useRoute } from "vue-router";
import {
  PhPlus,
  PhPencilSimple,
  PhCheckSquare,
  PhSquaresFour,
  PhCaretRight,
  PhDotsThree,
  PhCalendarBlank,
  PhDotsSixVertical,
  PhInfo,
} from "@phosphor-icons/vue";
import {
  leafTasks,
  statistics,
  statuses,
  type Task,
} from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { statusLabels } from "../locales/en";
import { confirmDiscard } from "../composables/unsaved";
import { taskDetailsKey } from "../composables/task-details";
import { currentDay, useCalendarNow } from "../composables/calendar";
import { taskIsOverdue } from "../../../../packages/domain/task-view";
import { useTaskRowMove } from "../composables/task-row-move";
import TaskEditor from "./TaskEditor.vue";
import TaskQuickField from "./TaskQuickField.vue";
import TaskFieldCopy from "./TaskFieldCopy.vue";
import TaskReviewPanel from "./TaskReviewPanel.vue";
import TaskQuickAdd from "./TaskQuickAdd.vue";
import TaskCompletion from "./TaskCompletion.vue";
import TaskVoidAction from "./TaskVoidAction.vue";
import WorkspaceDialog from "./WorkspaceDialog.vue";
const CalendarDateEdit = defineAsyncComponent(
  () => import("./CalendarDateEdit.vue"),
);
const TaskDetailPanel = defineAsyncComponent(
  () => import("./TaskDetailPanel.vue"),
);
const props = defineProps<{
  tasks: Task[];
  projectId?: string;
  showProject?: boolean;
  showParentPath?: boolean;
  columns?: readonly string[];
  density?: "comfortable" | "compact";
  workspace?: boolean;
  hideAdd?: boolean;
  canMove?: boolean;
}>();
const visibleColumns = computed(
  () => props.columns ?? ["status", "project", "assignee", "dueDate"],
);
const columnTemplate = computed(() =>
  [
    "minmax(220px, 1fr)",
    ...(visibleColumns.value.includes("status") ? ["88px"] : []),
    ...(props.showProject && visibleColumns.value.includes("project")
      ? ["minmax(100px, 140px)"]
      : []),
    ...(visibleColumns.value.includes("assignee") ? ["100px"] : []),
    ...(visibleColumns.value.includes("work") ? ["100px"] : []),
    ...(visibleColumns.value.includes("dueDate") ? ["104px"] : []),
    "32px",
  ].join(" "),
);
const columnCount = computed(
  () =>
    2 +
    visibleColumns.value.filter(
      (column) => column !== "project" || props.showProject,
    ).length,
);
const store = useWorkspace();
const route = useRoute();
const detailId = ref("");
const openCollectionDetails = inject(taskDetailsKey, null);
const now = useCalendarNow();
const today = computed(() => currentDay(now.value));
function dueState(task: Task) {
  if (taskIsOverdue(task, today.value)) return "overdue";
  return task.status !== "done" && task.dueDate === today.value ? "today" : "";
}
const actionTask = ref<Task | null>(null),
  workTask = ref<Task | null>(null);
const collapsedParents = useTaskViewMemory(
  "list:collapsed-parents",
  () => new Set<string>(),
);
const moving = useTaskRowMove(
  () => !!props.canMove,
  (id) => {
    collapsedParents.value = new Set(
      [...collapsedParents.value].filter((parent) => parent !== id),
    );
  },
  () => ordered.value,
);
const moveTask = ref<Task | null>(null);
const moveDestination = ref("");
const movePlacement = ref<"before" | "after" | "inside">("inside");
const moveCandidates = computed(() =>
  moveTask.value
    ? store.data.tasks.filter(
        (task) => !task.voided && !moving.invalid(moveTask.value!, task),
      )
    : [],
);
function startMove(task: Task) {
  if (!props.canMove || !confirmDiscard()) return;
  moveTask.value = task;
  moveDestination.value = "";
  movePlacement.value = "inside";
}
async function submitMove() {
  const destination = taskMap.value.get(moveDestination.value);
  if (
    moveTask.value &&
    destination &&
    (await moving.move(moveTask.value, destination, movePlacement.value))
  )
    moveTask.value = null;
}
function toggleChildren(id: string) {
  const next = new Set(collapsedParents.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedParents.value = next;
}
function openDetails(task: Task) {
  if (!confirmDiscard()) return;
  if (openCollectionDetails) openCollectionDetails(task.id);
  else detailId.value = task.id;
}
async function detailsFromMenu(task: Task) {
  if (!confirmDiscard()) return;
  actionTask.value = null;
  await nextTick();
  openDetails(task);
}
async function editFromMenu(task: Task) {
  if (!confirmDiscard()) return;
  actionTask.value = null;
  await nextTick();
  editing.value = task;
}
async function addChildFromMenu(task: Task) {
  if (!confirmDiscard()) return;
  actionTask.value = null;
  await nextTick();
  parentId.value = task.id;
  adding.value = true;
}
async function planFromMenu(task: Task) {
  if (!confirmDiscard()) return;
  actionTask.value = null;
  await nextTick();
  workTask.value = task;
}

watch(
  () => route.fullPath,
  () => {
    detailId.value = "";
  },
);
const editing = ref<Task | null>(null),
  adding = ref(false),
  parentId = ref<string | undefined>(),
  error = ref("");
const parents = computed(
  () => new Set(store.data.tasks.map((t) => t.parentId).filter(Boolean)),
);
const ordered = computed(() =>
  orderTaskTree(props.tasks).filter((task) => {
    const seen = new Set<string>();
    let parent = task.parentId;
    while (parent && !seen.has(parent)) {
      if (collapsedParents.value.has(parent)) return false;
      seen.add(parent);
      parent =
        store.data.tasks.find((item) => item.id === parent)?.parentId ?? null;
    }
    return true;
  }),
);
const visibleIds = computed(() => new Set(props.tasks.map((item) => item.id)));
function depth(task: Task) {
  const seen = new Set([task.id]);
  let parent = task.parentId,
    level = 0;
  while (
    parent &&
    visibleIds.value.has(parent) &&
    !seen.has(parent) &&
    level < 20
  ) {
    seen.add(parent);
    level++;
    parent = taskMap.value.get(parent)?.parentId ?? null;
  }
  return level;
}
const taskMap = computed(
  () => new Map(store.data.tasks.map((task) => [task.id, task])),
);
watch(taskMap, (tasks) => {
  if (!actionTask.value) return;
  const current = tasks.get(actionTask.value.id);
  actionTask.value = current && !current.voided ? current : null;
});
const childrenByParent = computed(() => {
  const result = new Map<string, Task[]>();
  for (const task of store.data.tasks)
    if (task.parentId) {
      const rows = result.get(task.parentId) ?? [];
      rows.push(task);
      result.set(task.parentId, rows);
    }
  return result;
});
function parentPath(task: Task) {
  const path: string[] = [],
    seen = new Set([task.id]);
  let id = task.parentId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const parent = taskMap.value.get(id);
    if (!parent || parent.projectId !== task.projectId) break;
    path.unshift(parent.title);
    id = parent.parentId;
  }
  return path.join(" / ");
}
function children(task: Task) {
  const rows: Task[] = [],
    stack = [...(childrenByParent.value.get(task.id) ?? [])],
    seen = new Set([task.id]);
  while (stack.length) {
    const child = stack.pop()!;
    if (seen.has(child.id) || child.projectId !== task.projectId) continue;
    seen.add(child.id);
    rows.push(child);
    stack.push(...(childrenByParent.value.get(child.id) ?? []));
  }
  return statistics(leafTasks(rows));
}
async function change(t: Task, e: Event) {
  const control = e.target as HTMLSelectElement;
  const focused = document.activeElement === control;
  const status = control.value as Task["status"];
  control.value = t.status;
  if (store.busy || !confirmDiscard()) return;
  error.value = "";
  try {
    await store.changeTaskStatus(t, status);
  } catch (e) {
    error.value = (e as Error).message;
    await store.refresh(true);
  }
  await nextTick();
  if (focused && document.activeElement === document.body)
    document.querySelector<HTMLButtonElement>(".task-feedback button")?.focus();
}
function close() {
  editing.value = null;
  adding.value = false;
  parentId.value = undefined;
}
</script>
<template>
  <div
    class="task-list"
    role="table"
    :aria-label="t('Tasks')"
    :class="{
      'with-project': showProject,
      'project-work-list': workspace,
      'with-subtasks': projectId,
      comfortable: density !== 'compact',
    }"
    :style="{ '--task-columns': columnTemplate }"
  >
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <p v-if="moving.error.value" class="error-box" role="alert">
      {{ moving.error.value }}
    </p>
    <div v-if="moving.notice.value" class="task-move-notice" role="status">
      {{ moving.notice.value
      }}<button
        v-if="moving.undo.value"
        class="text-button"
        :disabled="store.busy"
        @click="moving.undoMove"
      >
        {{ t("Undo") }}
      </button>
    </div>
    <p v-if="moving.hint.value" class="task-drop-hint" role="status">
      {{ moving.hint.value }}
    </p>
    <div v-if="!ordered.length" class="empty compact">
      <PhCheckSquare :size="28" />
      <h3>{{ t("No tasks here yet") }}</h3>
      <p>{{ t("Add a task or adjust your filters.") }}</p>
    </div>
    <div v-if="ordered.length" class="task-table-head" role="row">
      <span role="columnheader">{{ t("Task title") }}</span>
      <span v-if="visibleColumns.includes('status')" role="columnheader">{{
        t("Status")
      }}</span>
      <span
        v-if="showProject && visibleColumns.includes('project')"
        role="columnheader"
        >{{ t("Project") }}</span
      >
      <span v-if="visibleColumns.includes('assignee')" role="columnheader">{{
        t("Assignee")
      }}</span
      ><span v-if="visibleColumns.includes('work')" role="columnheader">{{
        t("Work arrangement")
      }}</span
      ><span v-if="visibleColumns.includes('dueDate')" role="columnheader">{{
        t("Due date")
      }}</span
      ><span role="columnheader" class="sr-only">{{ t("Task actions") }}</span>
    </div>
    <template v-for="task in ordered" :key="task.id"
      ><div
        :id="`task-${task.id}`"
        class="task-row"
        role="row"
        :data-task-id="task.id"
        @dragover="moving.over(task, $event)"
        @dragleave="moving.leave(task, $event)"
        @drop="moving.drop(task, $event)"
        :class="{
          subtask: task.parentId,
          parent: parents.has(task.id),
          'is-done': !parents.has(task.id) && task.status === 'done',
          'is-overdue': dueState(task) === 'overdue',
          'is-linked': route.hash === `#task-${task.id}`,
          'is-dragging': moving.dragging.value?.id === task.id,
          'drop-before':
            moving.target.value?.task.id === task.id &&
            moving.target.value.placement === 'before' &&
            !moving.target.value.invalid,
          'drop-after':
            moving.target.value?.task.id === task.id &&
            moving.target.value.placement === 'after' &&
            !moving.target.value.invalid,
          'drop-inside':
            moving.target.value?.task.id === task.id &&
            moving.target.value.placement === 'inside' &&
            !moving.target.value.invalid,
          'drop-invalid':
            moving.target.value?.task.id === task.id &&
            !!moving.target.value.invalid,
        }"
        :style="{
          '--task-status-color': `var(--status-${task.status.replace('_', '-')})`,
          '--task-status-bg': `var(--status-${task.status.replace('_', '-')}-bg)`,
          '--task-status-border': `var(--status-${task.status.replace('_', '-')}-border)`,
          '--task-depth': depth(task),
        }"
      >
        <div class="task-name" role="cell">
          <small
            v-if="
              showParentPath && task.parentId && !visibleIds.has(task.parentId)
            "
            class="task-parent-path"
            >{{ parentPath(task) }}</small
          >
          <div class="task-title-line">
            <button
              class="task-drag-handle icon-button"
              data-task-drag-handle
              :aria-label="t('Move {title}', { title: task.title })"
              :title="
                t(
                  canMove
                    ? 'Drag to reorder or make a subtask. Alt + arrows also move tasks.'
                    : 'Choose no grouping and original order to move tasks.',
                )
              "
              :disabled="!canMove || store.busy"
              :draggable="canMove && !store.busy"
              @dragstart="moving.start(task, $event)"
              @dragend="moving.clearDrag"
              @keydown="moving.keyboard(task, $event)"
              @click="startMove(task)"
            >
              <PhDotsSixVertical :size="16" />
            </button>
            <button
              v-if="parents.has(task.id)"
              class="icon-button task-details-toggle"
              :aria-label="
                t(
                  collapsedParents.has(task.id)
                    ? 'Expand subtasks for {title}'
                    : 'Collapse subtasks for {title}',
                  { title: task.title },
                )
              "
              :aria-expanded="!collapsedParents.has(task.id)"
              @click="confirmDiscard() && toggleChildren(task.id)"
            >
              <PhCaretRight :size="18" />
            </button>
            <TaskCompletion
              v-if="!parents.has(task.id)"
              :task="task"
              compact
              @error="error = $event"
            />
            <TaskQuickField
              class="task-title-editor task-title-main"
              :task="task"
              field="title"
              single-click
            />
            <span
              v-if="parents.has(task.id)"
              class="muted task-child-count"
              :title="
                t('{done}/{total} subtasks completed', {
                  done: formatNumber(children(task).done),
                  total: formatNumber(children(task).total),
                })
              "
              :aria-label="
                t('{done}/{total} subtasks completed', {
                  done: formatNumber(children(task).done),
                  total: formatNumber(children(task).total),
                })
              "
              ><PhSquaresFour :size="12" aria-hidden="true" />{{
                formatNumber(children(task).done)
              }}/{{ formatNumber(children(task).total) }}</span
            >
          </div>
          <TaskReviewPanel :task="task" :show-times="false" />
        </div>
        <div
          v-if="visibleColumns.includes('status')"
          class="task-status"
          role="cell"
        >
          <span
            v-if="parents.has(task.id)"
            class="task-parent-summary"
            :title="t('Parent context; excluded from counts')"
            >{{ t("Rollup") }}</span
          ><select
            v-else
            :aria-label="t('Status for {title}', { title: task.title })"
            :value="task.status"
            :disabled="store.busy"
            @change="change(task, $event)"
          >
            <option v-for="s in statuses" :key="s" :value="s">
              {{ t(statusLabels[s]) }}
            </option>
          </select>
        </div>
        <div
          v-if="showProject && visibleColumns.includes('project')"
          class="muted task-project"
          role="cell"
        >
          <RouterLink
            :title="
              store.data.projects.find((p) => p.id === task.projectId)?.name
            "
            :to="`/projects/${task.projectId}`"
            >{{
              store.data.projects.find((p) => p.id === task.projectId)
                ?.shortName ||
              store.data.projects.find((p) => p.id === task.projectId)?.name
            }}</RouterLink
          >
        </div>
        <TaskQuickField
          v-if="visibleColumns.includes('assignee')"
          class="task-assignee muted"
          role="cell"
          :task="task"
          field="assignee"
          compact
          table-cell
          :data-label="t('Assignee')"
        />
        <div
          v-if="visibleColumns.includes('work')"
          class="task-work muted"
          role="cell"
          :data-label="t('Work arrangement')"
        >
          <span v-if="parents.has(task.id)">—</span>
          <button
            v-else
            class="text-button"
            :disabled="store.busy"
            :aria-label="t('Plan work for {title}', { title: task.title })"
            @click="confirmDiscard() && (workTask = task)"
          >
            {{
              task.workDates.length
                ? task.workDates
                    .map((date) =>
                      formatDate(date, { month: "short", day: "numeric" }),
                    )
                    .join(" · ")
                : task.workWeek
                  ? t("Week of {date}", {
                      date: formatDate(task.workWeek, {
                        month: "short",
                        day: "numeric",
                      }),
                    })
                  : t("Not scheduled")
            }}
          </button>
        </div>
        <div
          v-if="visibleColumns.includes('dueDate')"
          class="task-date muted"
          role="cell"
          :class="{
            'due-overdue': dueState(task) === 'overdue',
            'due-today': dueState(task) === 'today',
          }"
        >
          <TaskQuickField
            :task="task"
            field="dueDate"
            compact
            table-cell
            :data-label="t('Due date')"
          />
          <span v-if="dueState(task)" class="due-flag">{{
            t(dueState(task) === "overdue" ? "Overdue" : "Due today")
          }}</span>
        </div>
        <div class="task-actions" role="cell">
          <button
            class="icon-button"
            :aria-label="t('More actions for {title}', { title: task.title })"
            :title="t('Task actions')"
            aria-haspopup="dialog"
            :aria-expanded="actionTask?.id === task.id"
            @click="confirmDiscard() && (actionTask = task)"
          >
            <PhDotsThree :size="20" />
          </button>
        </div>
      </div>
      <div v-if="editing?.id === task.id" class="task-inline-panel" role="row">
        <div role="cell" :aria-colspan="columnCount">
          <TaskEditor
            :task="editing"
            :project-id="task.projectId"
            @close="close"
            @saved="close"
          />
        </div>
      </div>
      <div v-if="workTask?.id === task.id" class="task-inline-panel" role="row">
        <div role="cell" :aria-colspan="columnCount">
          <CalendarDateEdit
            inline
            :task="workTask"
            basis="work"
            @close="workTask = null"
          />
        </div>
      </div>
      <div v-if="moveTask?.id === task.id" class="task-inline-panel" role="row">
        <form
          class="task-inline-move"
          role="cell"
          :aria-colspan="columnCount"
          @submit.prevent="submitMove"
        >
          <label
            >{{ t("Destination task")
            }}<select v-model="moveDestination" required>
              <option disabled value="">{{ t("Choose a task") }}</option>
              <option
                v-for="candidate in moveCandidates"
                :key="candidate.id"
                :value="candidate.id"
              >
                {{ candidate.title }}
              </option>
            </select></label
          ><label
            >{{ t("Position")
            }}<select v-model="movePlacement">
              <option value="before">{{ t("Before this task") }}</option>
              <option value="inside">{{ t("As a subtask") }}</option>
              <option value="after">{{ t("After this task") }}</option>
            </select></label
          ><button class="primary" :disabled="store.busy || !moveDestination">
            {{ t("Move task") }}</button
          ><button type="button" @click="moveTask = null">
            {{ t("Cancel") }}
          </button>
        </form>
      </div>
      <TaskQuickAdd
        v-if="adding && projectId && parentId === task.id"
        :projectId="projectId"
        :parentId="parentId"
        :unscheduled="workspace"
        @close="close" /></template
    ><TaskQuickAdd
      v-if="adding && projectId && !parentId"
      :key="parentId ?? 'root'"
      :projectId="projectId"
      :parentId="parentId"
      :unscheduled="workspace"
      @close="close"
    /><button
      v-if="projectId && !adding && !hideAdd"
      class="text-button add-task"
      @click="confirmDiscard() && (adding = true)"
    >
      <PhPlus :size="16" />{{ t("Add task") }}
    </button>
    <WorkspaceDialog
      :open="!!actionTask"
      :title="t('Task actions')"
      variant="sheet"
      :busy="store.busy"
      @close="confirmDiscard() && (actionTask = null)"
    >
      <div v-if="actionTask" class="task-action-menu">
        <p>{{ actionTask.title }}</p>
        <button :disabled="store.busy" @click="detailsFromMenu(actionTask)">
          <PhInfo :size="17" />{{ t("Task details") }}
        </button>
        <button :disabled="store.busy" @click="editFromMenu(actionTask)">
          <PhPencilSimple :size="17" />{{ t("Edit task") }}
        </button>
        <button
          v-if="!parents.has(actionTask.id)"
          :disabled="store.busy"
          @click="planFromMenu(actionTask)"
        >
          <PhCalendarBlank :size="17" />{{ t("Work arrangement") }}
        </button>
        <button
          v-if="projectId"
          :disabled="store.busy"
          @click="addChildFromMenu(actionTask)"
        >
          <PhPlus :size="17" />{{ t("Add subtask") }}
        </button>
        <div
          v-for="field in ['assignee', 'dueDate'] as const"
          :key="field"
          class="task-copy-action"
        >
          <TaskFieldCopy :task="actionTask" :field="field" :tasks="ordered" />
        </div>
        <TaskVoidAction :task="actionTask" labeled />
      </div>
    </WorkspaceDialog>
    <TaskDetailPanel :task-id="detailId" @close="detailId = ''" />
  </div>
</template>
<style scoped>
.task-list {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow-x: auto;
  max-width: 100%;
}
.task-table-head,
.task-list .task-row {
  display: grid;
  grid-template-columns: var(--task-columns);
  align-items: center;
  gap: 10px;
  padding: 4px 12px;
  box-sizing: border-box;
  min-width: 0;
}
.task-table-head {
  min-height: 36px;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border);
}
.task-list .task-row {
  min-height: 36px;
  padding-block: 2px;
  margin-left: 0;
  border-bottom: 1px solid var(--border);
  box-shadow: inset 3px 0 var(--task-status-color);
}
.task-list.comfortable .task-row {
  min-height: 40px;
  padding-block: 3px;
}
.task-row:last-of-type {
  border-bottom: 0;
}
.task-list .task-row.subtask {
  border-left: 0;
}
.task-list .task-row.subtask .task-name {
  padding-left: min(calc(var(--task-depth, 1) * 24px), 96px);
  position: relative;
}
.task-list .task-row.subtask .task-name::before {
  content: "";
  position: absolute;
  left: calc(min(var(--task-depth, 1) * 24px, 96px) - 12px);
  top: -9px;
  height: calc(50% + 9px);
  width: 10px;
  border-left: 1px solid var(--border-strong);
  border-bottom: 1px solid var(--border-strong);
  border-bottom-left-radius: 3px;
  pointer-events: none;
}
.task-list .task-row.parent {
  background: var(--surface-subtle);
  box-shadow: inset 2px 0 var(--border-strong);
}
.task-row.parent .task-title-main :deep(.field-value) {
  font-weight: 600;
}
.task-parent-summary {
  color: var(--muted);
  font-size: 11px;
}
.task-list .task-child-count {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  margin: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.parent .task-title-main:not(.editing) {
  flex: 0 1 auto;
}
.task-name:has(.task-title-main.editing) .task-child-count {
  display: none;
}
.task-row {
  position: relative;
}
.task-drag-handle {
  flex: none;
  width: 20px;
  min-width: 20px;
  min-height: 28px;
  padding: 0;
  color: var(--muted);
  cursor: grab;
  touch-action: pan-y;
}
.task-drag-handle:active {
  cursor: grabbing;
}
.task-drag-handle:disabled {
  cursor: default;
  opacity: 0.35;
}
.task-row.is-dragging {
  opacity: 0.45;
}
.task-list .task-row.drop-before {
  box-shadow:
    inset 0 3px var(--accent),
    inset 3px 0 var(--task-status-color);
}
.task-list .task-row.drop-after {
  box-shadow:
    inset 0 -3px var(--accent),
    inset 3px 0 var(--task-status-color);
}
.task-list .task-row.drop-inside {
  background: var(--accent-bg);
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.task-list .task-row.drop-invalid {
  background: var(--danger-bg);
  cursor: not-allowed;
}
.task-drop-hint {
  position: fixed;
  z-index: 100;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100vw - 32px);
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--accent);
  box-shadow: 0 4px 20px #0002;
  color: var(--accent);
  pointer-events: none;
  font-size: 13px;
}
.task-move-notice {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent);
  background: var(--accent-bg);
  font-size: 12px;
}
.task-move-notice button {
  min-height: 36px;
}
.task-inline-panel {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  min-width: 0;
}
.task-inline-move {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 10px;
}
.task-inline-move label {
  display: grid;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  font-size: 12px;
}
.task-inline-move select {
  min-height: 44px;
  max-width: 360px;
  width: 100%;
}
.task-inline-move button {
  min-height: 44px;
}
.task-list .task-name,
.task-list .task-status,
.task-work {
  min-width: 0;
}
.task-title-line {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.task-title-editor {
  flex: none;
}
.task-title-editor.task-title-main {
  flex: 1;
  min-width: 0;
}
.task-title-main :deep(.field-value) {
  width: 100%;
  text-align: left;
  padding: 4px 0;
  font-size: 13px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.is-done .task-title-main:not(.editing) :deep(.field-value) {
  text-decoration: line-through;
  color: var(--muted);
}
.task-title-editor.editing {
  flex: 1;
  min-width: 0;
}
.task-list .task-date {
  align-items: center;
  gap: 3px;
  flex-wrap: nowrap;
}
.task-date :deep(.quick-task-field:not(.editing)) {
  flex: 0 1 auto;
  width: auto;
}
.task-date:has(.editing) {
  flex-wrap: wrap;
}
.task-date:has(.editing) .due-flag {
  display: none;
}
.task-date.due-overdue {
  color: var(--danger);
}
.task-date.due-today {
  color: var(--status-blocked);
}
.due-flag {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
}
.due-overdue .due-flag {
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
  border-radius: 3px;
  padding: 1px 3px;
}
.due-today .due-flag {
  background: var(--status-blocked-bg);
  border: 1px solid var(--status-blocked-border);
  border-radius: 3px;
  padding: 1px 3px;
}
.task-list .task-date :deep(.field-value) {
  min-height: 28px;
  padding-inline: 0;
}
.task-list .task-title-button {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 4px 0;
  text-align: left;
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-title-button:hover {
  color: var(--accent);
}
.is-done .task-title-button {
  color: var(--muted);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
.task-parent-path,
.task-child-count {
  display: block;
  margin: 2px 0;
  font-size: 11px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.task-details-toggle {
  width: 24px;
  min-width: 24px;
  height: 28px;
  min-height: 28px;
  padding: 2px;
  flex: none;
  color: var(--muted);
  border: 0;
  background: transparent;
}
.task-details-toggle[aria-expanded="true"] svg {
  transform: rotate(90deg);
}
.task-list .task-status select {
  width: 100%;
  height: 28px;
  min-height: 28px;
  padding: 4px 5px;
  font-size: 12px;
  color: var(--task-status-color);
  background: var(--task-status-bg);
  border-color: var(--task-status-border);
  border-radius: 5px;
}
.task-list .task-status select:hover {
  border-color: var(--task-status-border);
}
.task-list .task-assignee,
.task-list .task-date {
  display: flex;
  min-width: 0;
  font-size: 12px;
}
.task-list :deep(.field-value) {
  min-height: 28px;
}
.task-list .task-project {
  width: 100%;
  min-width: 0;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-decoration: none;
}
.task-project a {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  color: inherit;
  text-decoration: none;
}
.task-project a:hover {
  color: var(--accent);
  text-decoration: underline;
}
.task-work button {
  min-height: 28px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.task-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.task-actions .icon-button {
  width: 30px;
  min-width: 30px;
  height: 30px;
  min-height: 30px;
  padding: 4px;
  color: var(--muted);
}
.task-list .add-task {
  margin: 4px 12px;
  min-height: 36px;
}
.task-row.is-linked {
  background: var(--accent-bg);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
  scroll-margin-top: 80px;
}
.task-action-menu {
  display: grid;
  gap: 8px;
}
.task-action-menu p {
  margin: 0 0 8px;
  overflow-wrap: anywhere;
  font-size: 13px;
  color: var(--muted);
}
.task-action-menu > button,
.task-action-menu :deep(.task-void-action > button),
.task-copy-action :deep(.copy-field-button) {
  min-height: 44px;
  width: 100%;
  justify-content: flex-start;
  padding: 10px 12px;
  gap: 10px;
  font-size: 14px;
}
.task-copy-action :deep(.copy-field-button::after) {
  content: attr(title);
  text-align: left;
  white-space: normal;
}
.task-action-menu :deep(.task-void-action) {
  display: flex;
}
@media (hover: hover) and (pointer: fine) {
  .task-drag-handle,
  .task-actions > .icon-button {
    opacity: 0.4;
  }
  .task-row:hover .task-drag-handle,
  .task-row:focus-within .task-drag-handle,
  .task-row:hover .task-actions > .icon-button,
  .task-row:focus-within .task-actions > .icon-button {
    opacity: 1;
  }
}
@media (min-width: 961px) and (max-width: 1150px) {
  .task-table-head,
  .task-list .task-row {
    gap: 6px;
  }
}
@media (max-width: 960px) {
  .task-list {
    overflow-x: hidden;
  }
  .task-table-head {
    display: none;
  }
  .task-list .task-row,
  .task-list .task-row.subtask,
  .task-list.comfortable .task-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 44px;
    gap: 0 8px;
    padding: 6px 12px;
  }
  .task-list .task-name {
    grid-row: 1;
    grid-column: 1 / 3;
  }
  .task-list .task-title-button {
    min-height: 44px;
    max-height: 48px;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    white-space: normal;
    overflow-wrap: anywhere;
    text-overflow: clip;
    font-size: 14px;
  }
  .task-title-main :deep(.field-value) {
    min-height: 44px;
    max-height: 48px;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    white-space: normal;
    overflow: hidden;
    overflow-wrap: anywhere;
    font-size: 14px;
  }
  .task-list .task-row.subtask .task-name {
    padding-left: min(calc(var(--task-depth, 1) * 20px), 60px);
  }
  .task-list .task-row.subtask .task-name::before {
    left: calc(min(var(--task-depth, 1) * 20px, 60px) - 12px);
    width: 10px;
  }
  .task-drag-handle {
    width: 44px;
    min-width: 44px;
    min-height: 44px;
  }
  .task-row:has(.task-title-editor.editing) .task-name {
    grid-column: 1 / -1;
  }
  .task-row:has(.task-title-editor.editing) .task-actions {
    display: none;
  }
  .task-row:has(.task-assignee.editing) .task-status {
    visibility: hidden;
  }
  .task-list .task-assignee.editing,
  .task-list .task-date:has(.editing) {
    grid-column: 1 / -1;
  }
  .task-date:has(.editing) .due-flag {
    display: none;
  }
  .task-inline-panel {
    padding: 10px;
  }
  .task-inline-move label {
    width: 100%;
  }
  .task-status {
    grid-row: 2;
    grid-column: 1;
    width: min(110px, 100%);
  }
  .task-list .task-status select {
    min-height: 44px;
    height: 44px;
  }
  .task-assignee {
    grid-row: 2;
    grid-column: 2 / 4;
  }
  .task-list .task-date {
    grid-row: 3;
    grid-column: 2 / 4;
    flex-wrap: nowrap;
  }
  .task-date :deep(.quick-task-field:not(.editing)) {
    flex: 1;
  }
  .due-flag {
    white-space: nowrap;
  }
  .task-work {
    display: none;
  }
  .task-list .task-project {
    grid-row: 3;
    grid-column: 1;
    min-height: 44px;
    line-height: 44px;
    white-space: nowrap;
    overflow-wrap: normal;
  }
  .task-actions {
    grid-row: 1;
    grid-column: 3;
    align-self: start;
  }
  .task-actions .icon-button,
  .task-details-toggle,
  .task-title-line :deep(.completion-toggle) {
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
    padding: 8px;
  }
  .task-list :deep(.field-value),
  .task-list .task-date :deep(.field-value),
  .task-work button,
  .task-list .add-task {
    min-height: 44px;
    min-width: 44px;
  }
  .task-list :deep(.field-value) {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .task-assignee::before,
  .task-date::before {
    content: attr(data-label);
    color: var(--muted);
    font-size: 11px;
    align-self: center;
    margin-right: 6px;
    flex: none;
  }
  .task-list .task-name :deep(.task-review) {
    display: none;
  }
}
@media (pointer: coarse) {
  .task-list .task-row {
    min-height: 52px;
  }
  .task-list .task-status select,
  .task-actions .icon-button,
  .task-details-toggle,
  .task-title-line :deep(.completion-toggle),
  .task-list .task-title-button,
  .task-list :deep(.field-value),
  .task-list .task-date :deep(.field-value),
  .task-work button,
  .task-list .add-task {
    min-height: 44px;
  }
  .task-actions .icon-button,
  .task-details-toggle {
    min-width: 44px;
  }
}
</style>
