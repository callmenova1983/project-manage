<script setup lang="ts">
import { computed } from "vue";
import {
  statistics,
  statuses,
  type Task,
} from "../../../../packages/domain/types";
import { statusLabels } from "../locales/en";
import { t, formatNumber } from "../locales";
import StatusBadge from "./StatusBadge.vue";
const props = withDefaults(
  defineProps<{ tasks: Task[]; compact?: boolean; showLegend?: boolean }>(),
  { compact: false, showLegend: true },
);
const stats = computed(() => statistics(props.tasks));
const label = computed(() =>
  statuses
    .map((status) =>
      t("{status}: {count}", {
        status: statusLabels[status],
        count: stats.value[status],
      }),
    )
    .join(" · "),
);
</script>
<template>
  <div class="task-distribution" :class="{ compact }">
    <div
      class="distribution-track"
      role="img"
      :aria-label="`${t('Task status distribution')}: ${label}`"
      :title="label"
    >
      <span
        v-for="status in statuses"
        :key="status"
        :class="status"
        :style="{ flexGrow: stats[status] }"
        aria-hidden="true"
      ></span>
    </div>
    <div v-if="showLegend" class="distribution-legend">
      <span v-for="status in statuses" :key="status"
        ><StatusBadge :status="status" /><strong>{{
          formatNumber(stats[status])
        }}</strong></span
      >
    </div>
    <span v-if="!stats.total && !compact" class="muted">{{
      t("No tasks in this scope")
    }}</span>
  </div>
</template>
<style scoped>
.task-distribution {
  min-width: 0;
}
.distribution-track {
  display: flex;
  gap: 2px;
  height: 7px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--surface-subtle, var(--surface));
}
.distribution-track > span {
  flex-basis: 0;
  min-width: 0;
}
.todo {
  background: var(--status-todo, #94a3b8);
}
.in_progress {
  background: var(--status-in-progress, #a99aff);
}
.done {
  background: var(--status-done, #63cba0);
}
.blocked {
  background: var(--status-blocked, #e8b34c);
}
.distribution-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 9px;
}
.distribution-legend > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}
.distribution-legend :deep(.badge) {
  padding: 0;
  border: 0;
  background: none;
}
.distribution-legend strong {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--text);
}
.compact .distribution-track {
  height: 5px;
}
.compact .distribution-legend {
  gap: 3px 8px;
  margin-top: 5px;
}
</style>
