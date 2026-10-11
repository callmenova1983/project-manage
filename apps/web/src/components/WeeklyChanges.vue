<script setup lang="ts">
import { computed, ref, useId } from "vue";
import {
  PhArrowUpRight,
  PhCaretDown,
  PhCheckCircle,
  PhClockCounterClockwise,
  PhGitBranch,
  PhListChecks,
  PhNotePencil,
  PhTray,
} from "@phosphor-icons/vue";
import type { Activity, Project } from "../../../../packages/domain/types";
import {
  describeActivity,
  summarizeWeeklyActivity,
  type ActivityTone,
} from "../composables/activity-summary";
import { t, formatDate, formatNumber } from "../locales";

const props = defineProps<{
  activities: Activity[];
  projects: Project[];
  /** Omit for all projects; an empty array intentionally selects no projects. */
  projectIds?: string[];
}>();
const expanded = ref(true);
const visibleCount = ref(3);
const sectionId = useId();
const summary = computed(() =>
  summarizeWeeklyActivity(props.activities, { projectIds: props.projectIds }),
);
const maxDaily = computed(() =>
  Math.max(1, ...summary.value.days.map((day) => day.count)),
);
const projectNames = computed(
  () => new Map(props.projects.map((project) => [project.id, project.name])),
);
const hasSampleRecords = computed(() =>
  props.activities.some((event) => event.source === "Synthetic demo seed"),
);
const entries = computed(() =>
  summary.value.events.slice(0, visibleCount.value).map((event) => ({
    event,
    description: describeActivity(event),
  })),
);
const historyLink = computed(() =>
  props.projectIds?.length === 1
    ? { path: "/activity", query: { project: props.projectIds[0] } }
    : { path: "/activity" },
);
const icons = {
  completed: PhCheckCircle,
  task: PhListChecks,
  project: PhNotePencil,
  stage: PhGitBranch,
  import: PhTray,
  restored: PhClockCounterClockwise,
  proposal: PhNotePencil,
} satisfies Record<ActivityTone, unknown>;
function actionText(description: ReturnType<typeof describeActivity>) {
  return t(
    description.key,
    description.params
      ? Object.fromEntries(
          Object.entries(description.params).map(([key, value]) => [
            key,
            t(value),
          ]),
        )
      : undefined,
  );
}
function dayLabel(day: { date: string; count: number }) {
  return t("{day}: {count} saved changes", {
    day: formatDate(day.date, {
      weekday: "long",
      month: "short",
      day: "numeric",
    }),
    count: formatNumber(day.count),
  });
}
</script>

<template>
  <section class="weekly-changes" :aria-labelledby="`${sectionId}-title`">
    <header class="changes-heading">
      <h2 :id="`${sectionId}-title`">
        <button
          class="changes-toggle"
          type="button"
          :aria-expanded="expanded"
          :aria-controls="`${sectionId}-details`"
          @click="expanded = !expanded"
        >
          <PhClockCounterClockwise :size="17" aria-hidden="true" />
          <span>{{ t("This week's changes") }}</span>
          <PhCaretDown
            :size="12"
            class="disclosure"
            :class="{ collapsed: !expanded }"
            aria-hidden="true"
          />
        </button>
      </h2>
      <RouterLink class="history-link" :to="historyLink">
        {{ t("History") }}<PhArrowUpRight :size="13" aria-hidden="true" />
      </RouterLink>
    </header>

    <div class="change-metrics">
      <div>
        <strong>{{ formatNumber(summary.changeCount) }}</strong>
        <span>{{ t("Saved changes") }}</span>
      </div>
      <div>
        <strong>{{ formatNumber(summary.projectCount) }}</strong>
        <span>{{ t("Projects touched") }}</span>
      </div>
      <div class="completed-metric">
        <strong>{{ formatNumber(summary.completionActions) }}</strong>
        <span
          :title="
            t(
              'Saved status changes to done; not a count of completed tasks. Imports and restores are excluded.',
            )
          "
          >{{ t("Marked done") }}</span
        >
      </div>
    </div>

    <div v-show="expanded" :id="`${sectionId}-details`">
      <ol
        v-if="summary.changeCount"
        class="week-pulse"
        :aria-label="t('Saved changes by day, UTC')"
      >
        <li
          v-for="day in summary.days"
          :key="day.date"
          :title="dayLabel(day)"
          :aria-label="dayLabel(day)"
        >
          <span class="pulse-track" aria-hidden="true">
            <span
              class="pulse-bar"
              :style="{ height: `${(day.count / maxDaily) * 100}%` }"
            />
          </span>
          <span aria-hidden="true">{{
            formatDate(day.date, { weekday: "short" })
          }}</span>
        </li>
      </ol>
      <div v-if="!summary.changeCount" class="changes-empty">
        <PhClockCounterClockwise :size="21" aria-hidden="true" />
        <p>{{ t("No saved changes this week") }}</p>
        <span>{{ t("Project edits and task updates will appear here.") }}</span>
        <span v-if="hasSampleRecords">{{
          t("Initial sample records are excluded.")
        }}</span>
      </div>
      <ol v-else class="change-timeline">
        <li v-for="{ event, description } in entries" :key="event.id">
          <span class="event-symbol" :class="description.tone">
            <component
              :is="icons[description.tone]"
              :size="15"
              aria-hidden="true"
            />
          </span>
          <div class="event-copy">
            <div class="event-topline">
              <strong>{{ actionText(description) }}</strong>
              <time
                :datetime="event.createdAt"
                :title="
                  formatDate(event.createdAt, {
                    dateStyle: 'full',
                    timeStyle: 'short',
                  })
                "
                >{{
                  formatDate(event.createdAt, {
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }}</time
              >
            </div>
            <RouterLink
              class="event-subject"
              :to="
                event.projectId
                  ? {
                      path: '/activity',
                      query: { project: event.projectId },
                      hash: '#activity-' + event.id,
                    }
                  : { path: '/activity', hash: '#activity-' + event.id }
              "
              :title="description.subject ?? actionText(description)"
              >{{ description.subject ?? t("Workspace change") }}</RouterLink
            >
            <p class="event-context">
              <span v-if="event.projectId && event.kind !== 'project'"
                >{{ projectNames.get(event.projectId) ?? t("Previous project")
                }}<span aria-hidden="true"> · </span></span
              >
              {{ event.actor }}
            </p>
          </div>
        </li>
      </ol>
      <button
        v-if="summary.events.length > visibleCount"
        class="more-changes"
        type="button"
        @click="visibleCount += 4"
      >
        {{
          t("Show {count} more changes", {
            count: formatNumber(
              Math.min(4, summary.events.length - visibleCount),
            ),
          })
        }}
        <PhCaretDown :size="12" aria-hidden="true" />
      </button>
      <button
        v-else-if="visibleCount > 3 && summary.events.length > 3"
        class="more-changes"
        type="button"
        @click="visibleCount = 3"
      >
        {{ t("Show fewer changes") }}
      </button>
    </div>
    <p class="history-limit">
      {{
        t("Action counts · Up to {count} recent records · UTC week", {
          count: formatNumber(summary.historyLimit),
        })
      }}
    </p>
  </section>
</template>

<style scoped>
.weekly-changes {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface, var(--panel));
  padding: 15px 17px 11px;
  color: var(--text);
}
.changes-heading,
.changes-toggle,
.history-link,
.event-topline {
  display: flex;
  align-items: center;
}
.changes-heading {
  justify-content: space-between;
  gap: 12px;
}
.changes-toggle {
  min-width: 0;
  min-height: 32px;
  border: 0;
  padding: 0;
  gap: 8px;
  background: transparent;
  color: var(--text);
}
.changes-toggle:hover {
  color: var(--accent);
  background: transparent;
}
.changes-heading h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.changes-toggle {
  font-size: inherit;
  font-weight: inherit;
}
.disclosure {
  flex: none;
  transition: transform 0.15s;
}
.disclosure.collapsed {
  transform: rotate(-90deg);
}
.history-link {
  flex: none;
  gap: 3px;
  min-height: 32px;
  color: var(--muted);
  text-decoration: none;
  font-size: 11px;
}
.history-link:hover,
.event-subject:hover {
  color: var(--accent);
  text-decoration: underline;
}
.change-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 13px 0 10px;
}
.change-metrics > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.change-metrics strong {
  font-size: 24px;
  line-height: 1.2;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.change-metrics span {
  font-size: 10px;
  color: var(--muted);
}
.completed-metric strong {
  color: var(--status-done, var(--green));
}
.week-pulse {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 9px;
  margin: 15px 0 18px;
  padding: 0;
  list-style: none;
}
.week-pulse li {
  min-width: 0;
  text-align: center;
  color: var(--muted);
  font-size: 9px;
}
.pulse-track {
  position: relative;
  display: block;
  height: 26px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.pulse-bar {
  display: block;
  position: absolute;
  bottom: 0;
  width: 100%;
  max-height: 100%;
  border-radius: 3px 3px 0 0;
  background: var(--accent);
  opacity: 0.65;
}
.change-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.change-timeline li {
  display: flex;
  gap: 10px;
  position: relative;
  padding: 0 0 16px;
}
.change-timeline li:not(:last-child)::before {
  content: "";
  position: absolute;
  top: 26px;
  bottom: 2px;
  left: 12px;
  width: 1px;
  background: var(--border);
}
.event-symbol {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  border: 1px solid var(--border);
  border-radius: 50%;
  color: var(--muted);
}
.event-symbol.completed {
  color: var(--status-done, var(--green));
}
.event-symbol.task {
  color: var(--status-progress, var(--blue));
}
.event-symbol.project,
.event-symbol.stage {
  color: var(--accent);
}
.event-copy {
  flex: 1;
  min-width: 0;
}
.event-topline {
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 3px 8px;
  margin: 1px 0 3px;
}
.event-topline strong {
  font-size: 11px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.event-topline time {
  flex: none;
  font-size: 9px;
  color: var(--muted);
}
.event-subject {
  display: block;
  color: var(--text);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  text-decoration: none;
  font-size: 11px;
}
.event-context {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 10px;
  overflow-wrap: anywhere;
}
.changes-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  padding: 13px 0;
  color: var(--muted);
  font-size: 11px;
}
.changes-empty p {
  margin: 2px 0;
  color: var(--text);
  font-weight: 500;
}
.more-changes {
  min-height: 34px;
  margin: -4px 0 4px 35px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  white-space: normal;
  text-align: left;
}
.more-changes:hover {
  background: transparent;
  text-decoration: underline;
}
.history-limit {
  border-top: 1px solid var(--border);
  margin: 6px 0 0;
  padding-top: 9px;
  color: var(--muted);
  font-size: 9px;
  line-height: 1.6;
}
@media (max-width: 420px) {
  .weekly-changes {
    padding: 12px;
  }
  .changes-heading {
    gap: 6px;
  }
  .changes-toggle {
    gap: 6px;
    white-space: normal;
    text-align: left;
  }
  .changes-heading h2 {
    font-size: 12px;
  }
  .week-pulse {
    gap: 6px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .disclosure {
    transition: none;
  }
}
</style>
