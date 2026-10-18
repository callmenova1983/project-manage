<script setup lang="ts">
import {
  useTaskViewMemory,
  useTaskViewScroll,
} from "../composables/task-view-memory";
useTaskViewScroll("gantt:page");
import { computed, inject, nextTick, ref, watch } from "vue";
import { Temporal } from "@js-temporal/polyfill";
import { useRoute, useRouter } from "vue-router";
import type { Task } from "../../../../packages/domain/types";
import {
  ganttWindow,
  ganttBar,
  taskGanttRows,
  visibleGanttRows,
  type GanttRow,
  type GanttScale,
  type GanttGesture,
  adjustGanttSchedule,
} from "../../../../packages/domain/task-gantt";
import { taskDependencyWarnings } from "../../../../packages/domain/task-dependencies";
import { dateSchema } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { currentDay, useCalendarNow } from "../composables/calendar";
import { taskDetailsKey } from "../composables/task-details";
import { t, formatDate, formatNumber } from "../locales";
import TaskPlanningEdit from "./TaskPlanningEdit.vue";

const props = defineProps<{ tasks: Task[]; projectId?: string }>();
const route = useRoute(),
  router = useRouter(),
  store = useWorkspace();
const openTask = inject(taskDetailsKey, undefined);
const now = useCalendarNow();
const today = computed(() => currentDay(now.value));
const scale = computed<GanttScale>(() =>
  route.query.ganttScale === "month"
    ? "month"
    : route.query.ganttScale === "week"
      ? "week"
      : "day",
);
const invalid = computed(
  () =>
    (route.query.ganttDate !== undefined &&
      !dateSchema.safeParse(route.query.ganttDate).success) ||
    (route.query.ganttScale !== undefined &&
      !["day", "week", "month"].includes(String(route.query.ganttScale))),
);
const anchor = computed(() =>
  dateSchema.safeParse(route.query.ganttDate).success
    ? String(route.query.ganttDate)
    : today.value,
);
const window = computed(() => ganttWindow(anchor.value, scale.value));
const collapsed = useTaskViewMemory(
  "gantt:collapsed-parents",
  () => new Set<string>(),
);
const matchedIds = computed(() => new Set(props.tasks.map((task) => task.id)));
const complete = computed(() =>
  taskGanttRows(store.data.tasks, matchedIds.value),
);
const model = computed(() => ({
  ...complete.value,
  rows: visibleGanttRows(complete.value.rows, collapsed.value),
}));
const editing = ref<Task | null>(null);
const proposed = ref<ReturnType<typeof adjustGanttSchedule> | undefined>();
const dragError = ref("");
const drag = ref<{
  task: Task;
  mode: GanttGesture;
  pointerId: number;
  startX: number;
  scroll: number;
  dayWidth: number;
  delta: number;
} | null>(null);
let suppressClick = false;
function beginDrag(event: PointerEvent, task: Task, aggregate: boolean) {
  if (aggregate || store.busy || event.button !== 0) return;
  const element = event.currentTarget as HTMLElement;
  const mode = (event.target as HTMLElement).closest<HTMLElement>("[data-edge]")
    ?.dataset.edge as GanttGesture | undefined;
  drag.value = {
    task: { ...task },
    mode: mode ?? "move",
    pointerId: event.pointerId,
    startX: event.clientX,
    scroll: canvas.value?.scrollLeft ?? 0,
    dayWidth: window.value.dayWidth,
    delta: 0,
  };
  dragError.value = "";
  suppressClick = false;
  element.setPointerCapture(event.pointerId);
}
const dragProposal = computed(() => {
  if (!drag.value || !drag.value.delta) return null;
  try {
    return adjustGanttSchedule(
      drag.value.task,
      drag.value.mode,
      drag.value.delta,
    );
  } catch {
    return null;
  }
});
function moveDrag(event: PointerEvent) {
  if (!drag.value || event.pointerId !== drag.value.pointerId) return;
  const delta = Math.round(
    (event.clientX -
      drag.value.startX +
      (canvas.value?.scrollLeft ?? 0) -
      drag.value.scroll) /
      drag.value.dayWidth,
  );
  drag.value = { ...drag.value, delta };
  if (delta) suppressClick = true;
}
function cancelDrag() {
  if (drag.value) suppressClick = true;
  drag.value = null;
}
function finishDrag(event: PointerEvent) {
  if (!drag.value || event.pointerId !== drag.value.pointerId) return;
  const gesture = drag.value;
  drag.value = null;
  if (!gesture.delta) return;
  suppressClick = true;
  try {
    proposed.value = adjustGanttSchedule(
      gesture.task,
      gesture.mode,
      gesture.delta,
    );
    editing.value = gesture.task;
  } catch (reason) {
    dragError.value = (reason as Error).message;
  }
}
function clickBar(event: MouseEvent, task: Task, aggregate: boolean) {
  if (suppressClick && event.detail !== 0) {
    suppressClick = false;
    return;
  }
  suppressClick = false;
  if (aggregate) openTask?.(task.id);
  else {
    proposed.value = undefined;
    editing.value = task;
  }
}
watch(() => route.fullPath, cancelDrag);
watch(
  () => store.user?.id,
  () => {
    cancelDrag();
    editing.value = null;
    proposed.value = undefined;
  },
);
const lines = ref(true);
const canvas = ref<HTMLElement | null>(null);
useTaskViewScroll("gantt:canvas", canvas);
const locateId = ref("");
const warnings = computed(() =>
  taskDependencyWarnings(store.data.tasks).filter((warning) =>
    matchedIds.value.has(warning.taskId),
  ),
);
const projectName = (id: string) =>
  store.data.projects.find((project) => project.id === id)?.name ??
  t("Previous project");
const bars = computed(
  () =>
    new Map(
      complete.value.rows.map((row) => [
        row.task.id,
        ganttBar(row.start, row.end, window.value),
      ]),
    ),
);
const bar = (row: GanttRow) => bars.value.get(row.task.id) ?? null;
const edges = computed(() => {
  const result: { key: string; path: string }[] = [];
  const positions = new Map(
    model.value.rows.map((row, index) => [row.task.id, { row, index }]),
  );
  for (const [index, row] of model.value.rows.entries()) {
    const target = bar(row);
    if (!target || target.clippedStart) continue;
    for (const edge of row.task.dependencies ?? []) {
      const predecessor = positions.get(edge.taskId);
      const source = predecessor && bar(predecessor.row);
      if (!predecessor || !source || source.clippedEnd) continue;
      const x = source.offset + source.width,
        y = predecessor.index * 48 + 24;
      const tx = target.offset,
        ty = index * 48 + 24;
      result.push({
        key: `${row.task.id}:${edge.taskId}`,
        path: `M ${x} ${y} H ${x + 8} V ${ty} H ${tx}`,
      });
    }
  }
  return result;
});
function toggle(id: string) {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}
async function change(patch: Record<string, string>) {
  await router.push({ query: { ...route.query, ...patch }, hash: route.hash });
}
function page(direction: number) {
  const next = Temporal.PlainDate.from(window.value.start).add(
    scale.value === "month"
      ? { months: direction * 6 }
      : { days: direction * window.value.days },
  );
  void change({ ganttDate: next.toString() });
}
async function locate() {
  const row = complete.value.rows.find((row) => row.task.id === locateId.value);
  if (!row) return;
  collapsed.value = new Set();
  if (row.start) await change({ ganttDate: row.start });
  await nextTick();
  const target = canvas.value?.querySelector(
    `[data-gantt-task="${CSS.escape(row.task.id)}"]`,
  );
  target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  (target?.querySelector("button") as HTMLElement | null)?.focus({
    preventScroll: true,
  });
}
</script>
<template>
  <section class="gantt" :aria-label="t('Gantt view')">
    <p v-if="dragError" class="error-box" role="alert">{{ t(dragError) }}</p>
    <p v-if="drag && drag.delta" role="status">
      {{ drag.task.title }}:
      {{
        dragProposal
          ? formatDate(dragProposal.scheduleStart!) +
            " – " +
            formatDate(dragProposal.scheduleEnd!)
          : t("Invalid schedule interval")
      }}
      · {{ t("Release to review the proposed schedule.") }}
    </p>
    <div class="gantt-toolbar">
      <button @click="page(-1)" :aria-label="t('Previous period')">←</button>
      <strong
        >{{ formatDate(window.start) }} – {{ formatDate(window.end) }}</strong
      >
      <button @click="page(1)" :aria-label="t('Next period')">→</button>
      <button @click="change({ ganttDate: today })">{{ t("Today") }}</button>
      <label
        >{{ t("Timeline scale")
        }}<select
          :value="scale"
          @change="
            change({ ganttScale: ($event.target as HTMLSelectElement).value })
          "
        >
          <option value="day">{{ t("Day") }}</option>
          <option value="week">{{ t("Week") }}</option>
          <option value="month">{{ t("Month") }}</option>
        </select></label
      >
      <label
        >{{ t("Timeline start")
        }}<input
          type="date"
          :value="anchor"
          @change="
            change({ ganttDate: ($event.target as HTMLInputElement).value })
          "
      /></label>
      <label class="line-toggle"
        ><input v-model="lines" type="checkbox" />{{
          t("Show dependency lines")
        }}</label
      >
    </div>
    <p v-if="invalid" class="error-box" role="status">
      {{ t("Invalid timeline settings; showing the default window.") }}
    </p>
    <p class="muted">
      {{
        t("{scheduled} scheduled · {unscheduled} unscheduled", {
          scheduled: formatNumber(model.projection.scheduled.length),
          unscheduled: formatNumber(model.projection.unscheduled.length),
        })
      }}
      · {{ store.timeZone }} ·
      {{ t("Parent bars summarize all active descendants.") }}
    </p>
    <div class="locate">
      <label
        >{{ t("Locate task")
        }}<select v-model="locateId">
          <option value="">{{ t("Choose a task") }}</option>
          <option
            v-for="row in complete.rows"
            :key="row.task.id"
            :value="row.task.id"
          >
            {{ !projectId ? projectName(row.task.projectId) + " / " : ""
            }}{{ row.task.title }}
          </option>
        </select></label
      ><button :disabled="!locateId" @click="locate">{{ t("Locate") }}</button>
    </div>
    <div
      ref="canvas"
      class="gantt-scroll"
      tabindex="0"
      :aria-label="t('Scrollable schedule timeline')"
    >
      <div class="gantt-canvas" :style="{ width: `${240 + window.width}px` }">
        <div class="axis">
          <strong>{{ t("Task") }}</strong>
          <div class="ticks" :style="{ width: `${window.width}px` }">
            <span
              v-for="tick in window.ticks"
              :key="tick.date"
              :style="{ left: `${tick.offset}px`, width: `${tick.width}px` }"
              >{{
                scale === "day" ? tick.date.slice(8) : tick.date.slice(5)
              }}</span
            >
          </div>
        </div>
        <div class="rows">
          <svg
            v-if="lines"
            class="dependency-lines"
            :width="window.width"
            :height="model.rows.length * 48"
            aria-hidden="true"
          >
            <path v-for="edge in edges" :key="edge.key" :d="edge.path" />
          </svg>
          <div
            v-for="row in model.rows"
            :key="row.task.id"
            class="gantt-row"
            :data-gantt-task="row.task.id"
          >
            <div
              class="row-title"
              :style="{ paddingLeft: `${8 + Math.min(row.depth, 8) * 12}px` }"
            >
              <button
                v-if="row.aggregate"
                :aria-expanded="!collapsed.has(row.task.id)"
                :aria-label="
                  t('Toggle subtasks for {title}', { title: row.task.title })
                "
                @click="toggle(row.task.id)"
              >
                {{ collapsed.has(row.task.id) ? "▸" : "▾" }}
              </button>
              <button class="title" @click="openTask?.(row.task.id)">
                {{ !projectId ? projectName(row.task.projectId) + " / " : ""
                }}{{ row.task.title
                }}<small v-if="row.aggregate">
                  · {{ t("Aggregate")
                  }}{{
                    row.incomplete ? " · " + t("Incomplete schedule") : ""
                  }}</small
                >
              </button>
            </div>
            <div
              class="track"
              :style="{
                width: `${window.width}px`,
                backgroundSize: `${window.dayWidth}px 100%`,
              }"
            >
              <button
                v-if="bar(row)"
                class="bar"
                :class="{ aggregate: row.aggregate, milestone: row.milestone }"
                :style="{
                  left: `${bar(row)!.offset}px`,
                  width: `${bar(row)!.width}px`,
                }"
                :aria-label="`${row.task.title}: ${formatDate(row.start!)} – ${formatDate(row.end!)}${row.aggregate ? ' · ' + t('Aggregate') : ''}`"
                @pointerdown="beginDrag($event, row.task, row.aggregate)"
                @pointermove="moveDrag"
                @pointerup="finishDrag"
                @pointercancel="cancelDrag"
                @lostpointercapture="cancelDrag"
                @keydown.esc.prevent="cancelDrag"
                @click="clickBar($event, row.task, row.aggregate)"
              >
                <span
                  v-if="!row.aggregate && !row.milestone"
                  class="resize-handle start"
                  data-edge="start"
                  aria-hidden="true"
                ></span>
                <span>{{
                  row.milestone
                    ? "◆"
                    : formatDate(row.start!) + " – " + formatDate(row.end!)
                }}</span>
                <span
                  v-if="!row.aggregate && !row.milestone"
                  class="resize-handle end"
                  data-edge="end"
                  aria-hidden="true"
                ></span>
              </button>
              <span
                v-if="
                  drag?.task.id === row.task.id &&
                  dragProposal &&
                  ganttBar(
                    dragProposal.scheduleStart,
                    dragProposal.scheduleEnd,
                    window,
                  )
                "
                class="drag-preview"
                :style="{
                  left: `${ganttBar(dragProposal.scheduleStart, dragProposal.scheduleEnd, window)!.offset}px`,
                  width: `${ganttBar(dragProposal.scheduleStart, dragProposal.scheduleEnd, window)!.width}px`,
                }"
              ></span>
              <span v-if="!bar(row)" class="no-bar">{{
                t(row.start ? "Outside timeline window" : "Not scheduled")
              }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <details class="schedule-table">
      <summary>{{ t("Text schedule table") }}</summary>
      <ul>
        <li v-for="row in complete.rows" :key="row.task.id">
          <button @click="openTask?.(row.task.id)">{{ row.task.title }}</button>
          ·
          {{
            row.start && row.end
              ? formatDate(row.start) + " – " + formatDate(row.end)
              : t("Not scheduled")
          }}<span v-if="row.aggregate">
            · {{ t("Aggregate")
            }}{{ row.incomplete ? " · " + t("Incomplete schedule") : "" }}</span
          ><span v-if="row.milestone"> · {{ t("Milestone") }}</span
          ><button v-if="!row.aggregate" @click="editing = row.task">
            {{ t("Edit schedule") }}
          </button>
        </li>
      </ul>
    </details>
    <details v-if="model.projection.unscheduled.length">
      <summary>
        {{ t("Unscheduled tasks") }} ({{
          formatNumber(model.projection.unscheduled.length)
        }})
      </summary>
      <ul>
        <li v-for="row in model.projection.unscheduled" :key="row.task.id">
          {{ row.task.title }}
          <button @click="editing = row.task">{{ t("Edit schedule") }}</button>
        </li>
      </ul>
    </details>
    <p v-if="warnings.length" role="status">
      {{
        t("{count} dependency warnings; open task details to review.", {
          count: formatNumber(warnings.length),
        })
      }}
    </p>
    <TaskPlanningEdit
      v-if="editing"
      :key="editing.id"
      :task="editing"
      mode="schedule"
      :initial-schedule="proposed"
      @close="
        editing = null;
        proposed = undefined;
      "
    />
  </section>
</template>
<style scoped>
.gantt {
  min-width: 0;
}
.gantt-toolbar,
.locate {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px;
  margin-bottom: 12px;
}
.gantt-toolbar label {
  min-width: 100px;
}
.line-toggle {
  flex-direction: row;
  align-items: center;
  min-height: 44px;
}
.locate label {
  min-width: 0;
  max-width: 100%;
}
.locate select {
  max-width: 100%;
}
.gantt-scroll {
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  max-height: 620px;
}
.axis {
  display: flex;
  height: 36px;
  position: sticky;
  top: 0;
  z-index: 4;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.axis > strong {
  width: 240px;
  box-sizing: border-box;
  position: sticky;
  left: 0;
  background: var(--surface);
  padding: 8px;
  flex: none;
  z-index: 2;
}
.ticks {
  position: relative;
  flex: none;
  overflow: hidden;
  font-size: 11px;
}
.ticks span {
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
  white-space: nowrap;
  padding: 10px 2px;
  border-left: 1px solid var(--border);
}
.rows {
  position: relative;
}
.gantt-row {
  height: 48px;
  display: flex;
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
}
.row-title {
  position: sticky;
  left: 0;
  width: 240px;
  box-sizing: border-box;
  flex: none;
  background: var(--surface);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 2px;
  border-right: 1px solid var(--border);
}
.row-title > button {
  padding: 4px;
  min-width: 24px;
  border: 0;
  background: transparent;
}
.row-title .title {
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
}
.track {
  flex: none;
  position: relative;
  background-image: linear-gradient(
    to right,
    var(--border) 1px,
    transparent 1px
  );
}
.bar {
  touch-action: pan-y;
  cursor: grab;
  position: absolute;
  top: 13px;
  height: 22px;
  min-height: 22px;
  box-sizing: border-box;
  padding: 1px 3px;
  overflow: hidden;
  white-space: nowrap;
  font-size: 10px;
  background: var(--primary);
  color: var(--primary-contrast, #fff);
  border: 0;
  z-index: 2;
}
.bar.aggregate {
  cursor: pointer;
  height: 12px;
  top: 18px;
  background: var(--muted);
}
.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
  z-index: 3;
  background: rgb(255 255 255 / 22%);
}
.resize-handle.start {
  left: 0;
}
.resize-handle.end {
  right: 0;
}
.drag-preview {
  position: absolute;
  top: 10px;
  height: 28px;
  border: 2px dashed var(--primary);
  box-sizing: border-box;
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  pointer-events: none;
  z-index: 4;
}
.bar.milestone {
  background: transparent;
  color: var(--primary);
  font-size: 20px;
  overflow: visible;
  padding: 0;
}
.no-bar {
  padding: 15px 8px;
  display: block;
  font-size: 11px;
  color: var(--muted);
}
.dependency-lines {
  position: absolute;
  left: 240px;
  top: 0;
  z-index: 1;
  pointer-events: none;
  overflow: visible;
}
.dependency-lines path {
  stroke: var(--muted);
  stroke-width: 1.5;
  fill: none;
}
details {
  margin-top: 14px;
}
details li {
  padding: 6px 0;
  overflow-wrap: anywhere;
}
.schedule-table button {
  margin: 3px;
}
@media (max-width: 600px) {
  .gantt-toolbar strong {
    width: calc(100% - 104px);
    font-size: 12px;
  }
  .gantt-toolbar input,
  .gantt-toolbar select {
    max-width: 150px;
  }
  .gantt-scroll {
    max-height: 460px;
  }
}
</style>
