<script setup lang="ts">
import { computed } from "vue";
import { PhArrowRight, PhCalendarBlank } from "@phosphor-icons/vue";
import type { Project, Task } from "../../../../packages/domain/types";
import { memberName } from "../../../../packages/domain/members";
import { formatDate, t } from "../locales";
import { useWorkspace } from "../stores/workspace";
import TaskCompletion from "./TaskCompletion.vue";
import StatusBadge from "./StatusBadge.vue";

const props = withDefaults(
  defineProps<{
    tasks: Task[];
    projects: Project[];
    today: string;
    variant?: "scheduled" | "undated" | "done" | "risk";
    risk?: "overdue" | "blocked";
  }>(),
  { variant: "scheduled", risk: "overdue" },
);
const emit = defineEmits<{
  inspect: [taskId: string];
  arrange: [taskId: string];
  error: [message: string];
}>();
const store = useWorkspace();

const projectNames = computed(
  () => new Map(props.projects.map((project) => [project.id, project.name])),
);
const isRisk = computed(() => props.variant === "risk");
function projectName(task: Task) {
  return projectNames.value.get(task.projectId) ?? t("Project unavailable");
}
function assigneeName(task: Task) {
  return t(
    memberName(task.assigneeId, task.assignee, store.data.members ?? []),
  );
}
function shortDate(date: string) {
  return formatDate(date, { month: "short", day: "numeric" });
}
function isOverdue(task: Task) {
  return task.status !== "done" && !!task.dueDate && task.dueDate < props.today;
}
function workDates(task: Task, preview = false) {
  const dates = [...task.workDates].sort();
  const visible = preview ? dates.slice(0, 2) : dates;
  return (
    visible.map(shortDate).join(" · ") +
    (preview && dates.length > 2 ? ` +${dates.length - 2}` : "")
  );
}
</script>

<template>
  <div
    class="workspace-task-rows"
    :class="{ 'risk-rows': isRisk, 'done-rows': variant === 'done' }"
  >
    <table>
      <colgroup v-if="isRisk">
        <col class="risk-title-column" />
        <col class="risk-project-column" />
        <col class="risk-detail-column" />
        <col class="risk-action-column" />
      </colgroup>
      <colgroup v-else>
        <col class="completion-column" />
        <col class="title-column" />
        <col class="project-column" />
        <col class="dates-column" />
        <col class="status-column" />
        <col class="action-column" />
      </colgroup>
      <thead
        :class="{ 'sr-only': variant === 'undated' || variant === 'done' }"
      >
        <tr>
          <th v-if="!isRisk" scope="col" class="completion-cell">
            <span class="sr-only">{{ t("Completed") }}</span>
          </th>
          <th scope="col">{{ t("Task title") }}</th>
          <th scope="col">{{ t("Related project") }}</th>
          <th scope="col">
            {{
              isRisk
                ? t(risk === "blocked" ? "Assignee" : "Deadline")
                : t("Dates")
            }}
          </th>
          <th v-if="!isRisk" scope="col">{{ t("Status") }}</th>
          <th scope="col" class="action-cell">{{ t("Actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.id">
          <td v-if="!isRisk" class="completion-cell">
            <TaskCompletion
              :task="task"
              compact
              @error="emit('error', $event)"
            />
          </td>
          <td class="title-cell">
            <button
              type="button"
              class="task-title"
              :title="task.title"
              @click="emit('inspect', task.id)"
            >
              <span class="two-lines">{{ task.title }}</span>
            </button>
          </td>
          <td class="project-cell" :data-label="t('Related project')">
            <RouterLink
              v-if="projectNames.has(task.projectId)"
              class="project-link two-lines"
              :to="`/projects/${encodeURIComponent(task.projectId)}`"
              :title="projectName(task)"
              >{{ projectName(task) }}</RouterLink
            >
            <span
              v-else
              class="unavailable two-lines"
              :title="projectName(task)"
              >{{ projectName(task) }}</span
            >
          </td>
          <td
            v-if="isRisk && risk === 'blocked'"
            class="detail-cell assignee-cell"
            :data-label="t('Assignee')"
          >
            <span class="two-lines" :title="assigneeName(task)">
              {{ assigneeName(task) }}
            </span>
          </td>
          <td
            v-else
            class="detail-cell dates-cell"
            :data-label="isRisk ? t('Deadline') : t('Dates')"
          >
            <div class="date-content">
              <time
                v-if="task.dueDate"
                class="deadline"
                :class="{
                  overdue: isOverdue(task),
                  'due-today': task.dueDate === today && task.status !== 'done',
                }"
                :datetime="task.dueDate"
                :title="`${t('Deadline')}: ${formatDate(task.dueDate)}`"
              >
                <span class="sr-only">{{ t("Deadline") }}: </span>
                {{ shortDate(task.dueDate) }}
              </time>
              <span
                v-if="!isRisk && task.workDates.length"
                class="work-dates"
                :title="`${t('Work dates')}: ${workDates(task)}`"
              >
                <PhCalendarBlank :size="12" aria-hidden="true" />
                <span class="sr-only">{{ t("Work dates") }}: </span>
                <span class="work-date-text">{{ workDates(task, true) }}</span>
              </span>
              <span
                v-if="!task.dueDate && (isRisk || !task.workDates.length)"
                class="no-date"
                >—</span
              >
            </div>
          </td>
          <td v-if="!isRisk" class="status-cell" :data-label="t('Status')">
            <StatusBadge :status="task.status" />
          </td>
          <td class="action-cell">
            <button
              v-if="variant === 'undated'"
              type="button"
              class="row-action"
              @click="emit('arrange', task.id)"
            >
              {{ t("Arrange work dates") }}
            </button>
            <button
              v-else
              type="button"
              class="row-action"
              :aria-label="`${t('View task')}: ${task.title}`"
              @click="emit('inspect', task.id)"
            >
              <span>{{ t("View task") }}</span>
              <PhArrowRight :size="13" aria-hidden="true" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.workspace-task-rows {
  min-width: 0;
  width: 100%;
}
table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  color: var(--text);
  font-size: 14px;
  line-height: 1.4;
}
.completion-column {
  width: 34px;
}
.title-column {
  width: auto;
}
.project-column {
  width: 22%;
}
.dates-column {
  width: 20%;
}
.status-column {
  width: 84px;
}
.action-column {
  width: 90px;
}
th,
td {
  padding: 6px 8px;
  text-align: left;
  vertical-align: middle;
  border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere;
}
th {
  height: 30px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
}
td {
  height: 44px;
}
tbody tr:last-child td {
  border-bottom: 0;
}
tbody tr:hover {
  background: var(--surface-subtle);
}
.completion-cell {
  padding-right: 0;
  padding-left: 2px;
  text-align: center;
}
.task-title,
.row-action {
  border: 0;
  border-radius: 4px;
  background: transparent;
  font-size: inherit;
  line-height: inherit;
  white-space: normal;
}
.task-title {
  width: 100%;
  min-height: 28px;
  justify-content: flex-start;
  padding: 1px 0;
  color: var(--text);
  text-align: left;
  font-weight: 500;
}
.two-lines {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.project-link {
  color: var(--text-secondary);
  text-decoration: none;
}
.project-link:hover {
  color: var(--accent);
  text-decoration: underline;
}
.unavailable,
.no-date {
  color: var(--muted);
}
.date-content {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.deadline {
  display: inline-block;
  max-width: 100%;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 12px;
}
.deadline.overdue {
  color: var(--danger);
  background: var(--danger-bg);
}
.deadline.due-today {
  color: var(--accent);
  background: var(--accent-bg);
}
.work-dates {
  display: flex;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  color: var(--muted);
  font-size: 11px;
}
.work-dates svg {
  flex: none;
}
.work-date-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-cell :deep(.badge) {
  padding: 2px 0;
  border: 0;
  background: transparent;
  font-size: 12px;
  white-space: normal;
}
.status-cell :deep(.badge svg) {
  flex: none;
}
.action-cell {
  padding-right: 2px;
}
.row-action {
  min-height: 28px;
  max-width: 100%;
  justify-content: flex-start;
  gap: 5px;
  padding: 2px 3px;
  color: var(--accent);
  font-size: 12px;
  text-align: left;
}
.row-action svg {
  flex: none;
}
.task-title:hover,
.row-action:hover {
  background: var(--surface-hover);
}
.done-rows .task-title {
  color: var(--muted);
  text-decoration: line-through;
}
.done-rows .project-link {
  color: var(--muted);
}
.risk-rows table {
  font-size: 12px;
}
.risk-title-column {
  width: 34%;
}
.risk-project-column {
  width: 26%;
}
.risk-detail-column {
  width: 20%;
}
.risk-action-column {
  width: 20%;
}
.risk-rows th,
.risk-rows td {
  padding-right: 5px;
  padding-left: 5px;
}
.risk-rows th {
  font-size: 11px;
}
.risk-rows .row-action {
  gap: 2px;
  padding: 2px 0;
  font-size: 11px;
}
.risk-rows .row-action svg {
  display: none;
}
.risk-rows .deadline {
  padding: 1px 3px;
  font-size: 11px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (min-width: 761px) {
  .workspace-task-rows:not(.risk-rows) td {
    height: 42px;
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .workspace-task-rows:not(.risk-rows) .task-title {
    padding-top: 0;
    padding-bottom: 0;
    line-height: 18px;
  }
  .workspace-task-rows:not(.risk-rows) .project-cell {
    line-height: 18px;
  }
  .workspace-task-rows:not(.risk-rows) .date-content {
    gap: 1px;
  }
  .workspace-task-rows:not(.risk-rows) .deadline {
    font-size: 11px;
    line-height: 14px;
  }
  .workspace-task-rows:not(.risk-rows) .work-dates {
    font-size: 10px;
    line-height: 13px;
  }
}
@media (max-width: 760px) {
  table,
  tbody {
    display: block;
  }
  colgroup {
    display: none;
  }
  thead {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  tbody tr {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  tbody tr:last-child {
    border-bottom: 0;
  }
  td,
  .risk-rows td {
    display: block;
    min-width: 0;
    height: auto;
    padding: 3px 4px;
    border: 0;
  }
  .completion-cell {
    grid-column: 1;
    grid-row: 1;
    padding: 0;
  }
  .completion-cell :deep(.completion-toggle.compact) {
    min-width: 44px;
    min-height: 44px;
  }
  .title-cell {
    grid-column: 2 / -1;
    grid-row: 1;
  }
  .task-title {
    min-height: 44px;
    font-size: 14px;
  }
  .project-cell {
    grid-column: 2 / -1;
  }
  .detail-cell {
    grid-column: 2 / -1;
  }
  .project-cell,
  .detail-cell {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12px;
  }
  .project-cell::before,
  .detail-cell::before {
    content: attr(data-label);
    flex: none;
    color: var(--muted);
    font-size: 11px;
  }
  .date-content {
    flex-flow: row wrap;
    align-items: center;
    gap: 5px;
  }
  .work-dates {
    max-width: 100%;
  }
  .status-cell {
    grid-column: 2;
  }
  .action-cell {
    grid-column: 3;
  }
  .row-action,
  .risk-rows .row-action {
    min-height: 44px;
    padding: 6px 4px;
    font-size: 12px;
  }
  .risk-rows tbody tr {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .risk-rows .title-cell {
    grid-column: 1 / -1;
  }
  .risk-rows .project-cell {
    grid-column: 1 / -1;
  }
  .risk-rows .detail-cell {
    grid-column: 1;
  }
  .risk-rows .action-cell {
    grid-column: 2;
  }
}
</style>
