<script setup lang="ts">
import {
  stageIds,
  stageColors,
  catalogs,
  catalogLabel,
} from "../composables/catalogs";
import { computed, ref, watch } from "vue";
import {
  type Project,
  type Stage,
  type Task,
} from "../../../../packages/domain/types";
import { workspaceTimeZone } from "../composables/calendar";
import { stageSummaries } from "../../../../packages/domain/stage-summary";
import { stageLabels } from "../locales/en";
import { t, formatNumber } from "../locales";
import StatusBadge from "./StatusBadge.vue";
const props = defineProps<{
  projects: Project[];
  tasks: Task[];
  selected: string;
  dragProject?: Project;
  busy?: boolean;
}>();
const emit = defineEmits<{
  select: [stage: Stage | ""];
  move: [stage: string, event: DragEvent];
}>();
const hovered = ref("");
watch(
  () => props.dragProject?.id,
  () => (hovered.value = ""),
);
function accepts(stage: string) {
  return (
    !!props.dragProject &&
    !props.busy &&
    props.dragProject.stage !== stage &&
    (stage === "unclassified" ||
      catalogs.value.stages.some((s) => s.id === stage && !s.archived))
  );
}
function over(stage: string, event: DragEvent) {
  if (!accepts(stage)) return;
  event.preventDefault();
  hovered.value = stage;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}
function leave(event: DragEvent) {
  if (
    !(event.currentTarget as HTMLElement).contains(
      event.relatedTarget as Node | null,
    )
  )
    hovered.value = "";
}
function drop(stage: string, event: DragEvent) {
  if (!accepts(stage)) return;
  event.preventDefault();
  event.stopPropagation();
  hovered.value = "";
  emit("move", stage, event);
}

const stages = computed(() =>
  props.projects.some((p) => p.stage === "unclassified")
    ? [...stageIds.value, "unclassified"]
    : stageIds.value,
);
const summaries = computed(() =>
  stageSummaries(
    props.projects,
    props.tasks,
    new Date(),
    workspaceTimeZone.value,
  ),
);
const empty = {
  projects: 0,
  open: 0,
  planned: 0,
  blocked: 0,
  overdue: 0,
  unplanned: 0,
};
function summary(stage: string) {
  return summaries.value[stage] ?? empty;
}
</script>
<template>
  <div
    class="stage-overview"
    :style="{ '--stage-columns': stages.length }"
    role="group"
    :aria-label="t('Project stages')"
  >
    <button
      v-for="stage in stages"
      :key="stage"
      :class="[
        'stage-tile',
        stage,
        {
          selected: selected === stage,
          'drop-ready': accepts(stage),
          'drop-active': hovered === stage,
        },
      ]"
      :data-stage="stage"
      :title="
        accepts(stage)
          ? t('Release to move {name} to {stage}', {
              name: dragProject!.shortName || dragProject!.name,
              stage: catalogLabel('stages', stage),
            })
          : undefined
      "
      @dragenter="over(stage, $event)"
      @dragover="over(stage, $event)"
      @dragleave="leave"
      @drop="drop(stage, $event)"
      :style="{ '--stage-color': stageColors(stage).color }"
      :aria-pressed="selected === stage"
      :aria-label="
        t('{count} projects in {stage}', {
          count: summary(stage).projects,
          stage: stageLabels[stage],
        })
      "
      @click="emit('select', selected === stage ? '' : stage)"
    >
      <span v-if="hovered === stage" class="stage-drop-label">{{
        t("Release to change stage")
      }}</span>
      <span class="stage-tile-heading"
        ><StatusBadge :stage="stage" /><strong>{{
          formatNumber(summary(stage).projects)
        }}</strong></span
      >
      <span class="stage-work-metrics">
        <span :title="t('Unfinished tasks across this stage')"
          ><span>{{ t("Unfinished") }}</span
          ><strong>{{ formatNumber(summary(stage).open) }}</strong></span
        >
        <span :title="t('Tasks planned this week, including completed work')"
          ><span>{{ t("This week") }}</span
          ><strong class="planned" :class="{ zero: !summary(stage).planned }">{{
            formatNumber(summary(stage).planned)
          }}</strong></span
        >
        <span :title="t('Blocked tasks that need coordination')"
          ><span>{{ t("Blocked") }}</span
          ><strong class="blocked" :class="{ zero: !summary(stage).blocked }">{{
            formatNumber(summary(stage).blocked)
          }}</strong></span
        >
        <span
          v-if="summary(stage).overdue"
          :title="t('Unfinished tasks past an explicit due date')"
          ><span>{{ t("Overdue") }}</span
          ><strong class="overdue">{{
            formatNumber(summary(stage).overdue)
          }}</strong></span
        >
        <span
          v-else
          :title="t('Unfinished tasks with no planned week or work day')"
          ><span>{{ t("Unscheduled") }}</span
          ><strong :class="{ zero: !summary(stage).unplanned }">{{
            formatNumber(summary(stage).unplanned)
          }}</strong></span
        >
      </span>
    </button>
  </div>
</template>
<style scoped>
.stage-overview {
  display: grid;
  grid-template-columns: repeat(var(--stage-columns), minmax(0, 1fr));
  gap: 8px;
}
.stage-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  min-width: 0;
  min-height: 56px;
  padding: 9px 10px;
  background: color-mix(in srgb, var(--stage-color) 7%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--stage-color) 25%, var(--border));
  border-radius: 8px;
}
.stage-tile:hover {
  background: var(--surface-hover, var(--surface));
}
.stage-tile.selected {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.stage-tile-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.stage-tile-heading :deep(.badge) {
  flex: 1;
}
.stage-tile-heading :deep(.badge) {
  font-size: 11px;
  padding: 0;
  background: none;
  border: 0;
  min-width: 0;
  white-space: normal;
  text-align: left;
}
.stage-tile-heading strong {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--stage-color);
}
.potential {
  --stage-color: var(--stage-potential, #d3b864);
}
.proposal {
  --stage-color: var(--stage-proposal, #c59cd3);
}
.approved {
  --stage-color: var(--stage-approved, #90b4d7);
}
.implementation {
  --stage-color: var(--stage-implementation, #a99aff);
}
.operations {
  --stage-color: var(--stage-operations, #6bcba0);
}
@media (max-width: 600px) {
  .stage-overview {
    display: flex;
    overflow-x: auto;
    gap: 6px;
    padding: 2px 1px 4px;
    scroll-snap-type: x proximity;
  }
  .stage-tile {
    flex: 0 0 138px;
    scroll-snap-align: start;
  }
}

.stage-work-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px 18px;
  border-top: 1px solid
    color-mix(in srgb, var(--stage-color) 18%, var(--border));
  padding-top: 8px;
}
.stage-work-metrics > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  font-size: 10px;
  color: var(--muted);
}
.stage-work-metrics strong {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.stage-work-metrics strong.planned {
  color: var(--status-in-progress);
}
.stage-work-metrics strong.blocked {
  color: var(--status-blocked);
}
.stage-work-metrics strong.overdue {
  color: var(--danger);
}
.stage-work-metrics strong.zero {
  color: var(--muted);
  font-weight: 400;
  opacity: 0.75;
}
</style>

<style scoped>
.stage-tile.drop-ready {
  border-style: dashed;
  border-color: var(--stage-color);
}
.stage-tile.drop-active {
  outline: 2px solid var(--stage-color);
  outline-offset: -2px;
  background: color-mix(in srgb, var(--stage-color) 15%, var(--surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--stage-color) 15%, transparent);
}
.stage-drop-label {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 5px);
  transform: translateX(-50%);
  white-space: nowrap;
  background: var(--stage-color);
  color: var(--surface);
  padding: 4px 7px;
  border-radius: 4px;
  font-size: 11px;
  pointer-events: none;
}
</style>
