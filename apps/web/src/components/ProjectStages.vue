<script setup lang="ts">
import { computed } from "vue";
import {
  stages,
  type Project,
  type Stage,
} from "../../../../packages/domain/types";
import { stageLabels } from "../locales/en";
import { t, formatNumber } from "../locales";
import StatusBadge from "./StatusBadge.vue";
const props = defineProps<{ projects: Project[]; selected: string }>();
const emit = defineEmits<{ select: [stage: Stage | ""] }>();
const counts = computed(
  () =>
    Object.fromEntries(
      stages.map((stage) => [
        stage,
        props.projects.filter((project) => project.stage === stage).length,
      ]),
    ) as Record<Stage, number>,
);
const maximum = computed(() => Math.max(1, ...Object.values(counts.value)));
</script>
<template>
  <div class="stage-overview" role="group" :aria-label="t('Project stages')">
    <button
      v-for="stage in stages"
      :key="stage"
      :class="['stage-tile', stage, { selected: selected === stage }]"
      :aria-pressed="selected === stage"
      :aria-label="
        t('{count} projects in {stage}', {
          count: counts[stage],
          stage: stageLabels[stage],
        })
      "
      @click="emit('select', selected === stage ? '' : stage)"
    >
      <span class="stage-tile-heading"
        ><StatusBadge :stage="stage" /><strong>{{
          formatNumber(counts[stage])
        }}</strong></span
      >
      <span class="stage-column-track" aria-hidden="true"
        ><span :style="{ width: `${(100 * counts[stage]) / maximum}%` }"></span
      ></span>
    </button>
  </div>
</template>
<style scoped>
.stage-overview {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
.stage-tile {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 9px;
  min-width: 0;
  min-height: 56px;
  padding: 9px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
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
  color: var(--text);
}
.stage-column-track {
  height: 4px;
  border-radius: 4px;
  background: var(--surface-subtle, var(--surface));
  overflow: hidden;
}
.stage-column-track > span {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--stage-color);
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
</style>
