<script setup lang="ts">
import { useTaskViewScroll } from "../composables/task-view-memory";
useTaskViewScroll("calendar:page");
import { computed, defineAsyncComponent, inject, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  PhCaretLeft,
  PhCaretRight,
  PhPlus,
  PhCalendarBlank,
} from "@phosphor-icons/vue";
import {
  calendarBases,
  calendarWindow,
  projectTaskCalendar,
  shiftCalendarAnchor,
  type CalendarBasis,
  type CalendarLayout,
} from "../../../../packages/domain/task-calendar";
import { dateSchema, type Task } from "../../../../packages/domain/types";
import { zonedDay } from "../../../../packages/domain/time-zone";
import { useCalendarNow } from "../composables/calendar";
import { useWorkspace } from "../stores/workspace";
import { confirmDiscard } from "../composables/unsaved";
import { taskDetailsKey } from "../composables/task-details";
import { t, formatDate, formatNumber } from "../locales";
import TaskDetailPanel from "./TaskDetailPanel.vue";
const CalendarDateEdit = defineAsyncComponent(
  () => import("./CalendarDateEdit.vue"),
);
const editingDate = ref<{
  task: Task;
  basis: CalendarBasis;
  targetDate?: string;
} | null>(null);
const dragging = ref<Task | null>(null);
const dropDay = ref("");
const dragError = ref("");
const CalendarTaskCreate = defineAsyncComponent(
  () => import("./CalendarTaskCreate.vue"),
);
const props = defineProps<{
  tasks: Task[];
  workScope: string;
  projectId?: string;
}>();
const creating = ref<{ date: string; basis: CalendarBasis } | null>(null);
function createOn(date: string) {
  if (confirmDiscard()) creating.value = { date, basis: basis.value };
}
const route = useRoute(),
  router = useRouter(),
  store = useWorkspace();
const now = useCalendarNow();
const today = computed(() => zonedDay(now.value, store.timeZone));
const basis = computed(() =>
  calendarBases.includes(route.query.dateBasis as CalendarBasis)
    ? (route.query.dateBasis as CalendarBasis)
    : "due",
);
const mobileDefault = window.matchMedia("(max-width: 760px)").matches
  ? "agenda"
  : "month";
const mode = computed<CalendarLayout>(() =>
  ["month", "week", "agenda"].includes(String(route.query.calendarMode))
    ? (route.query.calendarMode as CalendarLayout)
    : mobileDefault,
);
const anchor = computed(() =>
  dateSchema.safeParse(route.query.date).success
    ? (route.query.date as string)
    : today.value,
);
const windowRange = computed(() => calendarWindow(anchor.value, mode.value));
const projection = computed(() =>
  projectTaskCalendar(
    props.tasks,
    basis.value,
    windowRange.value,
    store.timeZone,
  ),
);
const taskMap = computed(
  () => new Map(props.tasks.map((task) => [task.id, task])),
);
const eventsByDay = computed(() => {
  const days = new Map(
    windowRange.value.days.map((day) => [
      day,
      [] as typeof projection.value.events,
    ]),
  );
  for (const event of projection.value.events)
    days.get(event.date)?.push(event);
  return days;
});
const expandedDays = ref(new Set<string>());
const detailId = ref("");
const openCollectionDetails = inject(taskDetailsKey, null);
watch(
  () => route.fullPath,
  () => {
    detailId.value = "";
    creating.value = null;
    editingDate.value = null;
    dragging.value = null;
    dropDay.value = "";
    expandedDays.value = new Set();
  },
);
function change(patch: Record<string, string | undefined>) {
  void router.push({ query: { ...route.query, ...patch } });
}
function open(id: string) {
  if (!confirmDiscard()) return;
  if (openCollectionDetails) openCollectionDetails(id);
  else detailId.value = id;
}
function editDate(task: Task) {
  if (store.busy || task.voided || !confirmDiscard()) return;
  editingDate.value = { task: { ...task }, basis: basis.value };
}
function dragStart(taskId: string, event: DragEvent) {
  if (basis.value !== "due" || store.busy || !confirmDiscard()) {
    event.preventDefault();
    return;
  }
  const task = taskMap.value.get(taskId);
  if (!task || task.voided) {
    event.preventDefault();
    return;
  }
  dragging.value = { ...task };
  dragError.value = "";
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
  }
}
function dropDate(day: string, event: DragEvent) {
  if (!dragging.value || basis.value !== "due" || store.busy) return;
  event.preventDefault();
  const captured = dragging.value;
  dragging.value = null;
  dropDay.value = "";
  const current = store.data.tasks.find((task) => task.id === captured.id);
  if (!current || current.voided || current.version !== captured.version) {
    dragError.value = t(
      "The task changed while dragging. Open it again before changing its date.",
    );
    return;
  }
  if (captured.dueDate === day) return;
  editingDate.value = { task: captured, basis: "due", targetDate: day };
}
function expand(day: string) {
  expandedDays.value = new Set([...expandedDays.value, day]);
}
const labels = {
  due: "Due date",
  work: "Work dates",
  estimated: "Estimated date",
  reminder: "Reminder",
};
const layouts = { month: "Month", week: "Week", agenda: "Agenda" };
const windowTitle = computed(() =>
  mode.value === "month"
    ? formatDate(anchor.value, { year: "numeric", month: "long" })
    : `${formatDate(windowRange.value.start, { year: "numeric", month: "short", day: "numeric" })} – ${formatDate(windowRange.value.days.at(-1)!, { month: "short", day: "numeric" })}`,
);
const outsideMonth = (day: string) =>
  mode.value === "month" && day.slice(0, 7) !== anchor.value.slice(0, 7);
</script>
<template>
  <section class="task-calendar" :aria-label="t('Task calendar')">
    <div class="calendar-toolbar">
      <div class="calendar-navigation">
        <h2>{{ windowTitle }}</h2>
        <div
          class="calendar-window-controls"
          role="group"
          :aria-label="t('Calendar date')"
        >
          <button
            class="icon-button"
            @click="change({ date: shiftCalendarAnchor(anchor, mode, -1) })"
            :aria-label="t('Previous date window')"
          >
            <PhCaretLeft :size="17" />
          </button>
          <button @click="change({ date: undefined })">{{ t("Today") }}</button>
          <button
            class="icon-button"
            @click="change({ date: shiftCalendarAnchor(anchor, mode, 1) })"
            :aria-label="t('Next date window')"
          >
            <PhCaretRight :size="17" />
          </button>
        </div>
      </div>
      <div class="calendar-options">
        <label class="calendar-basis"
          >{{ t("Date basis")
          }}<select
            :value="basis"
            @change="
              change({ dateBasis: ($event.target as HTMLSelectElement).value })
            "
          >
            <option v-for="value in calendarBases" :key="value" :value="value">
              {{ t(labels[value]) }}
            </option>
          </select></label
        >
        <div
          class="calendar-layout-switch"
          role="group"
          :aria-label="t('Calendar layout')"
        >
          <button
            v-for="layout in ['month', 'week', 'agenda'] as const"
            :key="layout"
            :aria-pressed="mode === layout"
            @click="change({ calendarMode: layout })"
          >
            {{ t(layouts[layout]) }}
          </button>
        </div>
        <label class="calendar-jump"
          ><span>{{ t("Calendar date") }}</span
          ><input
            type="date"
            :value="anchor"
            @change="
              change({
                date: ($event.target as HTMLInputElement).value || undefined,
              })
            "
        /></label>
      </div>
    </div>
    <div class="calendar-meta">
      <p class="calendar-context" role="status">
        {{
          t("{events} events / {tasks} tasks in this window", {
            events: formatNumber(projection.events.length),
            tasks: formatNumber(projection.visibleTaskCount),
          })
        }}
        · {{ store.timeZone }}
      </p>
      <span
        v-if="basis === 'due'"
        class="calendar-drag-hint"
        :title="t('Drag a due-date event to preview a new date, then confirm.')"
        >{{ t("Drag to reschedule") }}</span
      >
      <p
        v-if="workScope !== 'all'"
        class="calendar-notice"
        :title="t('The current work scope still applies while browsing dates.')"
      >
        {{ t("Work scope") }}:
        {{ t(workScope === "week" ? "This week" : "Today") }}
        <button class="text-button" @click="change({ scope: 'all' })">
          {{ t("Clear work scope limit") }}
        </button>
      </p>
    </div>
    <p
      v-if="route.query.date && !dateSchema.safeParse(route.query.date).success"
      role="alert"
    >
      {{ t("Invalid calendar date; showing today.") }}
    </p>
    <p v-if="dragError" class="error-box" role="alert">{{ dragError }}</p>
    <div v-if="mode !== 'agenda'" class="calendar-weekdays" aria-hidden="true">
      <span v-for="day in windowRange.days.slice(0, 7)" :key="day">{{
        formatDate(day, { weekday: "short" })
      }}</span>
    </div>
    <div class="calendar-days" :class="`layout-${mode}`">
      <section
        v-for="day in windowRange.days"
        :key="day"
        class="calendar-day"
        :class="{
          'is-today': day === today,
          'is-drop-target': dropDay === day,
          'outside-month': outsideMonth(day),
        }"
        @dragover="
          if (dragging && basis === 'due') {
            $event.preventDefault();
            dropDay = day;
          }
        "
        @drop="dropDate(day, $event)"
        :aria-label="formatDate(day, { dateStyle: 'full' })"
      >
        <div class="calendar-day-heading">
          <h3>
            <time :datetime="day">{{
              mode === "agenda"
                ? formatDate(day, {
                    month: "short",
                    day: "numeric",
                    weekday: "short",
                  })
                : formatDate(
                    day,
                    outsideMonth(day)
                      ? { month: "short", day: "numeric" }
                      : { day: "numeric" },
                  )
            }}</time
            ><span v-if="day === today"> · {{ t("Today") }}</span>
          </h3>
          <button
            class="icon-button create-on-day"
            :aria-label="t('Create task on {date}', { date: formatDate(day) })"
            :title="t('New task')"
            @click="createOn(day)"
          >
            <PhPlus :size="15" />
          </button>
        </div>
        <ul>
          <li
            v-for="event in expandedDays.has(day) || mode === 'agenda'
              ? eventsByDay.get(day)
              : eventsByDay.get(day)?.slice(0, 3)"
            :key="event.id"
            class="calendar-event-row"
            :style="{
              '--event-color': `var(--status-${taskMap.get(event.taskId)?.status.replace('_', '-')})`,
              '--event-bg': `var(--status-${taskMap.get(event.taskId)?.status.replace('_', '-')}-bg)`,
            }"
          >
            <button
              class="calendar-event"
              :draggable="basis === 'due' && !store.busy"
              @dragstart="dragStart(event.taskId, $event)"
              @dragend="
                dragging = null;
                dropDay = '';
              "
              @click="open(event.taskId)"
            >
              <span v-if="event.instant" class="event-clock">{{
                formatDate(event.instant, {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }}</span
              ><span class="event-title">{{
                taskMap.get(event.taskId)?.title
              }}</span>
            </button>
            <button
              v-if="taskMap.get(event.taskId)"
              class="text-button edit-date"
              :title="t('Change task date')"
              :aria-label="
                t('Change date for {title}', {
                  title: taskMap.get(event.taskId)!.title,
                })
              "
              @click="editDate(taskMap.get(event.taskId)!)"
            >
              <PhCalendarBlank :size="15" />
            </button>
          </li>
        </ul>
        <button
          v-if="
            mode !== 'agenda' &&
            !expandedDays.has(day) &&
            (eventsByDay.get(day)?.length ?? 0) > 3
          "
          class="text-button"
          @click="expand(day)"
        >
          {{
            t("Show {count} more events", {
              count: (eventsByDay.get(day)?.length ?? 0) - 3,
            })
          }}
        </button>
        <p
          v-if="mode === 'agenda' && !eventsByDay.get(day)?.length"
          class="muted empty-day"
        >
          {{ t("No events") }}
        </p>
      </section>
    </div>
    <p v-if="projection.outsideTaskCount" class="calendar-context">
      {{
        t("{count} dated tasks outside this window", {
          count: projection.outsideTaskCount,
        })
      }}
    </p>
    <section
      v-for="group in projection.undatedWeeks"
      :key="group.week"
      class="calendar-unplanned"
    >
      <h3>
        {{ t("Week of {date}", { date: formatDate(group.week) }) }} ·
        {{ t("Day not assigned") }}
        <span v-if="!group.inWindow">({{ t("Outside date window") }})</span> ·
        {{ group.tasks.length }}
      </h3>
      <ul>
        <li v-for="task in group.tasks" :key="task.id">
          <button class="text-button" @click="open(task.id)">
            {{ task.title }}
          </button>
        </li>
      </ul>
    </section>
    <section v-if="projection.missing.length" class="calendar-unplanned">
      <h3>
        {{ t("No date for this basis") }} · {{ projection.missing.length }}
      </h3>
      <ul>
        <li v-for="task in projection.missing" :key="task.id">
          <button class="text-button" @click="open(task.id)">
            {{ task.title }}
          </button>
        </li>
      </ul>
    </section>
    <CalendarDateEdit
      v-if="editingDate"
      :task="editingDate.task"
      :basis="editingDate.basis"
      :target-date="editingDate.targetDate"
      @close="editingDate = null"
    />
    <CalendarTaskCreate
      v-if="creating"
      :date="creating.date"
      :basis="creating.basis"
      :project-id="projectId"
      @close="creating = null"
    />
    <TaskDetailPanel :task-id="detailId" @close="detailId = ''" />
  </section>
</template>
<style scoped>
.task-calendar {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  overflow: hidden;
}
.calendar-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px 8px;
}
.calendar-navigation,
.calendar-options,
.calendar-window-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.calendar-navigation {
  gap: 18px;
  flex-wrap: wrap;
}
.calendar-navigation h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.3px;
}
.calendar-options {
  margin-left: auto;
  flex-wrap: wrap;
  gap: 12px;
}
.calendar-toolbar label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  white-space: nowrap;
}
.calendar-toolbar select,
.calendar-toolbar input {
  min-height: 36px;
  width: auto;
  padding: 5px 8px;
  font-size: 12px;
  background: var(--surface);
}
.calendar-toolbar button {
  min-height: 36px;
  background: var(--surface);
  font-size: 12px;
  padding: 5px 10px;
}
.calendar-window-controls {
  gap: 3px;
}
.calendar-window-controls .icon-button {
  width: 34px;
  padding: 6px;
}
.calendar-layout-switch {
  display: flex;
  padding: 3px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 7px;
}
.calendar-layout-switch button {
  border: 0;
  background: transparent;
  min-height: 30px;
  padding: 4px 12px;
}
.calendar-layout-switch button[aria-pressed="true"] {
  background: var(--accent-bg);
  color: var(--accent);
  box-shadow: 0 1px 3px #0001;
}
.calendar-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  padding: 0 16px 12px;
  min-height: 28px;
}
.calendar-context,
.calendar-notice {
  font-size: 11px;
  color: var(--muted);
  margin: 0;
}
.calendar-drag-hint {
  color: var(--muted);
  font-size: 11px;
  border-left: 1px solid var(--border);
  padding-left: 16px;
}
.calendar-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  background: var(--accent-bg);
  color: var(--accent);
  border-radius: 5px;
  padding: 0 8px;
}
.calendar-notice button {
  min-height: 28px;
  color: var(--accent);
  font-size: 11px;
  padding: 2px;
}
.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-top: 1px solid var(--border);
  background: var(--surface-subtle);
  color: var(--muted);
  font-size: 11px;
}
.calendar-weekdays span {
  padding: 8px 12px;
}
.calendar-days {
  display: grid;
  gap: 1px;
  background: var(--border);
  border-top: 1px solid var(--border);
}
.layout-month,
.layout-week {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.calendar-day {
  background: var(--surface);
  min-width: 0;
  padding: 7px 8px 10px;
  min-height: 116px;
}
.layout-week .calendar-day {
  min-height: 280px;
}
.calendar-day-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-bottom: 5px;
}
h3 {
  font-size: 12px;
  margin: 0;
  font-weight: 550;
  overflow-wrap: anywhere;
}
.calendar-day-heading h3 {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 28px;
}
.calendar-day.is-today {
  background: color-mix(in srgb, var(--accent-bg) 30%, var(--surface));
}
.is-today h3 time {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary);
  color: var(--on-primary);
}
.is-today h3 > span {
  font-size: 10px;
  color: var(--accent);
}
.outside-month {
  background: var(--surface-subtle);
}
.outside-month h3 {
  color: var(--muted);
}
.calendar-day.is-drop-target {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--accent-bg);
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.calendar-event-row {
  display: flex;
  align-items: stretch;
  gap: 2px;
  margin: 4px 0;
  border-radius: 5px;
  border-left: 3px solid var(--event-color);
  background: var(--event-bg);
}
.calendar-event {
  flex: 1;
  min-width: 0;
  min-height: 32px;
  width: 100%;
  text-align: left;
  padding: 5px 6px;
  font-size: 12px;
  background: transparent;
  border: 0;
  border-radius: 0;
  color: var(--text);
}
.event-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  line-height: 1.45;
}
.edit-date {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  width: 28px;
  flex: none;
  padding: 4px;
  color: var(--event-color);
}
.create-on-day {
  width: 28px;
  min-width: 28px;
  min-height: 28px;
  height: 28px;
  padding: 4px;
  color: var(--muted);
  border: 0;
  background: transparent;
}
.calendar-day:hover .create-on-day,
.calendar-day:focus-within .create-on-day {
  color: var(--accent);
  background: var(--accent-bg);
}
.event-clock {
  display: block;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.empty-day {
  font-size: 11px;
  color: var(--muted);
  margin: 8px 0;
}
.layout-agenda .calendar-day {
  min-height: 80px;
  padding: 12px 16px;
}
.layout-agenda .calendar-event-row {
  max-width: 800px;
}
.layout-agenda .calendar-event,
.calendar-unplanned button {
  min-height: 44px;
}
.calendar-unplanned {
  padding: 14px 16px;
  border-top: 1px solid var(--border);
}
.calendar-unplanned h3 {
  margin-bottom: 6px;
}
.calendar-unplanned button {
  text-align: left;
  overflow-wrap: anywhere;
}
@media (max-width: 1100px) {
  .calendar-navigation {
    width: 100%;
    justify-content: space-between;
  }
  .calendar-options {
    margin-left: 0;
    width: 100%;
    justify-content: space-between;
  }
}
@media (max-width: 760px) {
  .calendar-toolbar {
    padding: 12px;
    gap: 10px;
  }
  .calendar-navigation h2 {
    font-size: 16px;
  }
  .calendar-navigation {
    gap: 6px;
  }
  .calendar-toolbar button,
  .calendar-toolbar select,
  .calendar-toolbar input {
    min-height: 44px;
  }
  .calendar-window-controls .icon-button {
    width: 44px;
  }
  .calendar-options {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }
  .calendar-basis {
    grid-column: 1 / -1;
  }
  .calendar-basis select {
    flex: 1;
  }
  .calendar-layout-switch button {
    min-height: 38px;
    padding-inline: 10px;
  }
  .calendar-jump input {
    width: 100%;
  }
  .calendar-jump {
    min-width: 0;
  }
  .calendar-meta {
    padding: 0 12px 10px;
    gap: 6px 10px;
  }
  .calendar-drag-hint {
    padding-left: 10px;
  }
  .calendar-notice {
    width: 100%;
    margin-left: 0;
    justify-content: space-between;
  }
  .calendar-notice button {
    min-height: 44px;
  }
  .calendar-weekdays {
    display: none;
  }
  .layout-month,
  .layout-week {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .layout-agenda {
    grid-template-columns: minmax(0, 1fr);
  }
  .calendar-day-heading h3 {
    flex-wrap: wrap;
  }
  .calendar-day,
  .layout-week .calendar-day {
    min-height: 120px;
  }
  .calendar-event,
  .edit-date,
  .create-on-day {
    min-height: 44px;
  }
  .create-on-day {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }
  .edit-date {
    width: 44px;
    min-width: 44px;
  }
  .calendar-event-row {
    gap: 0;
  }
}
</style>
