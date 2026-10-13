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
import {
  weekKey,
  type Activity,
  type Project,
} from "../../../../packages/domain/types";
import {
  describeActivity,
  type ActivityTone,
} from "../composables/activity-summary";
import { t, formatDate, formatNumber } from "../locales";
import { useActivityHistory } from "../composables/activity-history";
import { useWorkspace } from "../stores/workspace";

const props = defineProps<{
  activities: Activity[];
  projects: Project[];
  /** Omit for all projects; an empty array intentionally selects no projects. */
  projectIds?: string[];
}>();
const expanded = ref(true);
const sectionId = useId();
const store = useWorkspace();
const selectedWeek = ref<string | null>(null);
const week = computed(
  () => selectedWeek.value ?? weekKey(store.lastSynced ?? new Date()),
);
const history = useActivityHistory(() => ({
  weekStart: week.value,
  projectIds: props.projectIds,
  excludeSeed: true,
  limit: 7,
}));
const { page: summary, loading, loadingMore, error } = history;
const maxDaily = computed(() =>
  Math.max(1, ...(summary.value?.days ?? []).map((day) => day.count)),
);
const projectNames = computed(
  () => new Map(props.projects.map((project) => [project.id, project.name])),
);
const hasSampleRecords = computed(() =>
  props.activities.some((event) => event.source === "Synthetic demo seed"),
);
const entries = computed(() =>
  history.events.value.map((event) => ({
    event,
    description: describeActivity(event),
  })),
);
const historyLink = computed(() => ({
  path: "/activity",
  query: { week: week.value, projects: props.projectIds, real: "1" },
}));
function selectWeek(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  selectedWeek.value = value ? weekKey(new Date(value)) : null;
}
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
          <span>{{
            t(week === weekKey() ? "This week's changes" : "Weekly changes")
          }}</span>
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

    <label class="week-selector"
      >{{ t("Week starting (UTC)")
      }}<input type="date" :value="week" @change="selectWeek"
    /></label>
    <p v-if="history.newChanges.value" role="status">
      {{ t("New changes are available. Refresh to include them.") }}
      <button @click="history.refresh()">{{ t("Refresh history") }}</button>
    </p>
    <p v-if="loading" role="status">{{ t("Loading history…") }}</p>
    <p v-if="error" class="error-box" role="alert">
      {{ t(error) }}
      <button @click="history.refresh()">{{ t("Retry") }}</button>
    </p>
    <div v-if="summary" class="change-metrics">
      <div>
        <strong>{{ formatNumber(summary.total) }}</strong>
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

    <div v-if="summary" v-show="expanded" :id="`${sectionId}-details`">
      <ol
        v-if="summary.total"
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
      <div v-if="!summary.total" class="changes-empty">
        <PhClockCounterClockwise :size="21" aria-hidden="true" />
        <p>
          {{
            t(
              week === weekKey()
                ? "No saved changes this week"
                : "No saved changes in the selected week",
            )
          }}
        </p>
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
        v-if="summary.nextCursor"
        class="more-changes"
        type="button"
        :disabled="loadingMore"
        @click="history.more()"
      >
        {{ t(loadingMore ? "Loading history…" : "Load more changes")
        }}<PhCaretDown :size="12" aria-hidden="true" />
      </button>
    </div>
    <p class="history-limit">
      {{ t("Complete selected week · Action counts · UTC") }}
    </p>
  </section>
</template>

<style scoped>
.week-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 11px;
  flex-wrap: wrap;
}
.week-selector input {
  width: auto;
  min-height: 44px;
}
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
