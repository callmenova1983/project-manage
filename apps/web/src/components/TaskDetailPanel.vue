<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useWorkspace } from "../stores/workspace";
import { confirmDiscard } from "../composables/unsaved";
import { statuses, type Task } from "../../../../packages/domain/types";
import { statusLabels } from "../locales/en";
import { t, formatDate } from "../locales";
import TaskEditor from "./TaskEditor.vue";
import TaskReviewPanel from "./TaskReviewPanel.vue";
import TaskVoidAction from "./TaskVoidAction.vue";
import StatusBadge from "./StatusBadge.vue";
import WorkspaceDialog from "./WorkspaceDialog.vue";
import TaskQuickField from "./TaskQuickField.vue";
import CalendarDateEdit from "./CalendarDateEdit.vue";
import TaskPlanningEdit from "./TaskPlanningEdit.vue";
import { projectTaskSchedules } from "../../../../packages/domain/task-schedule-projection";
import { taskDependencyWarnings } from "../../../../packages/domain/task-dependencies";

const props = defineProps<{
  taskId: string;
  notice?: string;
  fallbackFocus?: HTMLElement | null;
}>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspace();
const editing = ref<Task | null>(null);
const error = ref("");
const task = computed(() =>
  store.data.tasks.find((task) => task.id === props.taskId),
);
const project = computed(() =>
  store.data.projects.find((project) => project.id === task.value?.projectId),
);
const children = computed(() =>
  store.data.tasks.filter((child) => child.parentId === task.value?.id),
);
const parent = computed(() =>
  store.data.tasks.find(
    (parent) =>
      parent.id === task.value?.parentId &&
      parent.projectId === task.value?.projectId,
  ),
);
const dateEditing = ref<"work" | "estimated" | "reminder" | null>(null);
const scheduleEditing = ref<"schedule" | "dependencies" | null>(null);
const schedule = computed(() =>
  task.value
    ? task.value.voided
      ? {
          start: task.value.scheduleStart,
          end: task.value.scheduleEnd,
          incomplete: false,
        }
      : projectTaskSchedules(
          store.data.tasks,
          new Set([task.value.id]),
        ).summaries.get(task.value.id)
    : undefined,
);
const predecessors = computed(() =>
  (task.value?.dependencies ?? []).map((edge) =>
    store.data.tasks.find((item) => item.id === edge.taskId),
  ),
);
const successors = computed(() =>
  store.data.tasks.filter((item) =>
    item.dependencies?.some((edge) => edge.taskId === task.value?.id),
  ),
);
const dependencyWarnings = computed(() =>
  taskDependencyWarnings(store.data.tasks).filter(
    (warning) => warning.taskId === task.value?.id,
  ),
);
const predecessorTitle = (id: string) =>
  store.data.tasks.find((item) => item.id === id)?.title ?? t("Previous task");
watch(
  () => props.taskId,
  () => {
    editing.value = null;
    error.value = "";
    dateEditing.value = null;
    scheduleEditing.value = null;
  },
);
async function changeStatus(event: Event) {
  if (!task.value) return;
  error.value = "";
  try {
    await store.changeTaskStatus(
      task.value,
      (event.target as HTMLSelectElement).value as Task["status"],
    );
  } catch (reason) {
    error.value = (reason as Error).message;
  }
}
watch(
  () => store.user?.id,
  () => emit("close"),
);
function close() {
  if (confirmDiscard()) emit("close");
}
function edit() {
  if (task.value && !task.value.voided && !store.busy && confirmDiscard())
    editing.value = { ...task.value };
}
function editDate(basis: "work" | "estimated" | "reminder") {
  if (task.value && !task.value.voided && !store.busy && confirmDiscard())
    dateEditing.value = basis;
}
function editSchedule(mode: "schedule" | "dependencies") {
  if (task.value && !task.value.voided && !store.busy && confirmDiscard())
    scheduleEditing.value = mode;
}
</script>
<template>
  <WorkspaceDialog
    :open="!!taskId"
    :title="t('Task details')"
    variant="drawer"
    :busy="store.busy"
    :fallback-focus="fallbackFocus"
    @close="close"
  >
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <p v-if="notice" class="history-notice" role="status">{{ notice }}</p>
    <template v-if="task">
      <p class="task-breadcrumb">
        <RouterLink :to="`/projects/${task.projectId}#task-${task.id}`">{{
          project?.name ?? t("Project unavailable")
        }}</RouterLink
        ><span v-if="parent"> / {{ parent.title }}</span>
      </p>
      <TaskEditor
        v-if="editing && !task.voided"
        :key="`${store.user?.id}:${editing.id}`"
        :task="editing"
        :project-id="editing.projectId"
        @close="editing = null"
        @saved="editing = null"
      />
      <div v-else :key="task.id" class="task-detail-content">
        <div class="task-heading">
          <h3 class="task-title">{{ task.title }}</h3>
          <StatusBadge
            v-if="task.voided || children.length"
            :status="task.status"
          />
          <select
            v-else
            class="detail-status"
            :value="task.status"
            :aria-label="t('Status for {title}', { title: task.title })"
            :disabled="store.busy"
            @change="changeStatus"
          >
            <option v-for="status in statuses" :key="status" :value="status">
              {{ t(statusLabels[status]) }}
            </option>
          </select>
        </div>
        <dl class="task-essential-fields">
          <dt>{{ t("Assignee") }}</dt>
          <dd>
            <TaskQuickField :task="task" field="assignee" />
          </dd>
          <dt>{{ t("Due date") }}</dt>
          <dd>
            <TaskQuickField :task="task" field="dueDate" />
          </dd>
        </dl>
        <p v-if="task.description" class="task-description">
          {{ task.description }}
        </p>
        <section class="work-context">
          <div class="detail-section-heading">
            <h4>{{ t("Work arrangement") }}</h4>
            <button
              v-if="!task.voided"
              type="button"
              class="text-button"
              :disabled="store.busy"
              @click="editDate('work')"
            >
              {{ t("Edit work arrangement") }}
            </button>
          </div>
          <p v-if="task.workDates.length" class="work-dates">
            {{
              task.workDates
                .map((date) =>
                  formatDate(date, {
                    month: "short",
                    day: "numeric",
                    weekday: "short",
                  }),
                )
                .join(" · ")
            }}
          </p>
          <p v-else-if="task.workWeek" class="work-dates">
            {{ t("Work week") }} · {{ formatDate(task.workWeek) }}
            <span class="muted"> · {{ t("No specific work dates") }}</span>
          </p>
          <p v-else class="muted">{{ t("Not scheduled") }}</p>
        </section>
        <TaskReviewPanel v-if="!task.voided" :task="task" :show-times="false" />
        <details class="detail-disclosure">
          <summary>
            {{ t("More dates") }}
            <span
              v-if="task.estimatedDate || task.reminderAt"
              class="summary-value"
            >
              {{
                [
                  task.estimatedDate ? t("Estimated date") : "",
                  task.reminderAt ? t("Reminder") : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              }}
            </span>
          </summary>
          <dl
            v-if="task.estimatedDate || task.reminderAt"
            class="additional-fields"
          >
            <template v-if="task.estimatedDate">
              <dt>{{ t("Estimated date") }}</dt>
              <dd>{{ formatDate(task.estimatedDate) }}</dd>
            </template>
            <template v-if="task.reminderAt">
              <dt>{{ t("Reminder") }}</dt>
              <dd>
                {{
                  formatDate(task.reminderAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                }}
                <small class="muted">{{ store.timeZone }}</small>
              </dd>
            </template>
          </dl>
          <div v-if="!task.voided" class="task-actions">
            <button
              type="button"
              :disabled="store.busy"
              @click="editDate('estimated')"
            >
              {{ t("Edit estimated date") }}
            </button>
            <button
              type="button"
              :disabled="store.busy"
              @click="editDate('reminder')"
            >
              {{ t("Edit reminder") }}
            </button>
          </div>
        </details>
        <details
          class="detail-disclosure schedule-context"
          :open="dependencyWarnings.length > 0"
        >
          <summary>
            {{ t("Schedule and dependencies") }}
            <span v-if="dependencyWarnings.length" class="detail-warning">{{
              t("Review schedule")
            }}</span>
            <span
              v-else-if="schedule?.start && schedule.end"
              class="summary-value"
            >
              {{ formatDate(schedule.start) }} – {{ formatDate(schedule.end) }}
            </span>
          </summary>
          <p v-if="schedule?.start && schedule.end">
            {{ formatDate(schedule.start) }} – {{ formatDate(schedule.end) }}
            <span v-if="task.milestone"> · {{ t("Milestone") }}</span>
          </p>
          <p v-if="children.length">
            {{ t("Parent schedules summarize all active descendant tasks.")
            }}<span v-if="schedule?.incomplete">
              {{ t("Some subtasks are not scheduled.") }}</span
            >
          </p>
          <template v-else>
            <ul v-if="dependencyWarnings.length" class="dependency-warnings">
              <li
                v-for="warning in dependencyWarnings"
                :key="warning.predecessorId"
              >
                {{ predecessorTitle(warning.predecessorId) }}:
                {{
                  t(
                    warning.kind === "voided"
                      ? "Predecessor voided; action required."
                      : warning.kind === "unscheduled"
                        ? "A linked task is not scheduled."
                        : "Schedule conflicts with predecessor.",
                  )
                }}
                <span v-if="warning.earliestStart">{{
                  t("Earliest start: {date}", {
                    date: formatDate(warning.earliestStart),
                  })
                }}</span>
              </li>
            </ul>
            <p v-if="predecessors.length">
              {{ t("Predecessor tasks") }}:
              {{
                predecessors
                  .map((item) => item?.title ?? t("Previous task"))
                  .join(" · ")
              }}
            </p>
            <ul v-if="successors.length">
              <li v-for="successor in successors" :key="successor.id">
                {{ t("Successor task") }}: {{ successor.title
                }}<span v-if="successor.voided"> · {{ t("Voided task") }}</span>
              </li>
            </ul>
            <div v-if="!task.voided" class="task-actions">
              <button :disabled="store.busy" @click="editSchedule('schedule')">
                {{ t("Edit schedule") }}
              </button>
              <button
                :disabled="store.busy"
                @click="editSchedule('dependencies')"
              >
                {{ t("Edit predecessors") }}
              </button>
            </div>
          </template>
        </details>
        <p v-if="task.voided" class="error-box">
          {{ t("Voided task") }} · {{ task.voided.reason }}
        </p>
        <section v-if="children.length" class="child-context">
          <h4>{{ t("Subtasks") }}</h4>
          <p v-if="!task.voided" class="muted">
            {{ t("Complete the subtasks individually.") }}
          </p>
          <ul>
            <li v-for="child in children" :key="child.id">
              <RouterLink
                :to="`/projects/${child.projectId}#task-${child.id}`"
                >{{ child.title }}</RouterLink
              ><span v-if="child.voided"> · {{ t("Voided task") }}</span
              ><StatusBadge v-else :status="child.status" />
            </li>
          </ul>
        </section>
      </div>
    </template>
    <p v-else role="status">
      {{ t("Task unavailable. Refresh or return to the list.") }}
    </p>
    <CalendarDateEdit
      v-if="dateEditing && task"
      :key="`${task.id}:${dateEditing}`"
      :task="task"
      :basis="dateEditing"
      @close="dateEditing = null"
    />
    <TaskPlanningEdit
      v-if="scheduleEditing && task"
      :key="`${task.id}:${scheduleEditing}`"
      :task="task"
      :mode="scheduleEditing"
      @close="scheduleEditing = null"
    />
    <template v-if="task && !editing" #footer>
      <TaskVoidAction :task="task" labeled />
      <button
        v-if="!task.voided"
        type="button"
        class="primary"
        :disabled="store.busy"
        @click="edit"
      >
        {{ t("Edit task") }}
      </button>
    </template>
  </WorkspaceDialog>
</template>
<style scoped>
.detail-status {
  min-height: 36px;
  width: auto;
  min-width: 130px;
}
.task-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}
.task-title,
.task-description,
.task-breadcrumb {
  overflow-wrap: anywhere;
}
.task-description {
  white-space: pre-wrap;
  line-height: 1.7;
  margin: 0 0 24px;
}
.task-title {
  font-size: 22px;
  line-height: 1.45;
  margin: 0;
  flex: 1 1 260px;
}
.task-breadcrumb {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  margin: 0 0 16px;
}
dl {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 10px 12px;
  align-items: baseline;
  margin: 20px 0;
  font-size: 13px;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
dd small {
  display: block;
  margin-top: 4px;
}
.task-essential-fields {
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}
.detail-section-heading {
  display: flex;
  gap: 8px 16px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}
.detail-section-heading h4 {
  margin: 0;
  font-size: 14px;
}
.work-context {
  padding-bottom: 16px;
}
.work-context p {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.7;
}
.detail-disclosure {
  border-top: 1px solid var(--border);
  padding: 4px 0;
  font-size: 13px;
}
.detail-disclosure summary {
  cursor: pointer;
  padding: 12px 0;
  font-weight: 600;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.detail-disclosure .summary-value {
  margin-left: 8px;
  color: var(--muted);
  font-weight: 400;
  font-size: 12px;
}
.detail-warning {
  margin-left: 8px;
  color: var(--warning, var(--text));
  font-size: 12px;
}
.detail-disclosure[open] {
  padding-bottom: 16px;
}
.detail-disclosure .additional-fields {
  margin: 4px 0 16px;
}
.schedule-context p,
.schedule-context li {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.dependency-warnings {
  padding: 12px 12px 12px 28px;
  border-left: 2px solid var(--warning, var(--border));
  background: var(--surface-raised);
}
.task-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.child-context {
  margin-top: 8px;
  border-top: 1px solid var(--border);
}
.child-context li {
  padding: 8px 0;
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .task-title {
    flex-basis: 100%;
    font-size: 20px;
  }
  .detail-status,
  .task-actions button,
  .detail-section-heading button,
  .task-essential-fields :deep(.field-value) {
    min-height: 44px;
  }
  .detail-disclosure .summary-value {
    display: block;
    margin-left: 16px;
  }
}
</style>
