<script setup lang="ts">
import { calendarWeek, zonedDay } from "../../../../packages/domain/time-zone";
import { t, formatDate, formatNumber } from "../locales";
import { computed, ref, watch, nextTick, onBeforeUnmount } from "vue";
import { useRoute } from "vue-router";
import {
  PhClockCounterClockwise,
  PhMagnifyingGlass,
  PhArrowClockwise,
  PhDownloadSimple,
  PhCalendarBlank,
  PhArrowRight,
  PhCaretDown,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { type Activity } from "../../../../packages/domain/types";
import { useActivityHistory } from "../composables/activity-history";
import { presentActivity } from "../composables/activity-presentation";
const store = useWorkspace(),
  route = useRoute();
const scopedIds = computed(() =>
  route.query.projects
    ? [route.query.projects]
        .flat()
        .filter((id): id is string => typeof id === "string")
    : undefined,
);
const project = ref(
    String(route.query.project ?? (scopedIds.value ? "__scope" : "")),
  ),
  query = ref(typeof route.query.q === "string" ? route.query.q : ""),
  week = ref(String(route.query.week ?? "")),
  excludeSeed = ref(route.query.real === "1"),
  error = ref("");
const history = useActivityHistory(() => ({
  projectIds:
    project.value === "__scope"
      ? scopedIds.value
      : project.value
        ? [project.value]
        : undefined,
  weekStart: week.value || undefined,
  search: query.value,
  excludeSeed: excludeSeed.value,
  limit: 25,
}));
const { page, loading, loadingMore, error: loadError } = history;
const exporting = ref(false);
async function exportHistory() {
  if (!page.value || loading.value || exporting.value) return;
  exporting.value = true;
  error.value = "";
  const query = { ...history.query.value, checkpoint: page.value.checkpoint };
  try {
    const result = await api.exportActivity(query);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `project-history-${result.weekStart ?? "all"}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    store.notify(t("Filtered history exported"));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    exporting.value = false;
  }
}
const linked = ref<Activity | null>(null);
const expanded = ref(new Set<string>());
function toggleDetails(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}
let anchorRequest = 0;
watch(
  () => route.hash,
  async (hash) => {
    const request = ++anchorRequest;
    linked.value = null;
    if (!hash.startsWith("#activity-")) return;
    try {
      const event = await api.activity(decodeURIComponent(hash.slice(10)));
      if (request !== anchorRequest) return;
      linked.value = event;
      expanded.value = new Set([...expanded.value, event.id]);
      await nextTick();
      document
        .getElementById(`activity-${event.id}`)
        ?.scrollIntoView({ block: "center" });
    } catch (e) {
      if (request === anchorRequest) error.value = (e as Error).message;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => anchorRequest++);
const activities = computed(() => {
  const events = history.events.value;
  return linked.value && !events.some((event) => event.id === linked.value!.id)
    ? [linked.value, ...events]
    : events;
});
const activityGroups = computed(() => {
  const groups: {
    date: string;
    entries: {
      event: Activity;
      presentation: ReturnType<typeof presentActivity>;
    }[];
  }[] = [];
  for (const event of activities.value) {
    const date = zonedDay(new Date(event.createdAt), store.timeZone);
    let group = groups.at(-1);
    if (!group || group.date !== date) {
      group = { date, entries: [] };
      groups.push(group);
    }
    group.entries.push({
      event,
      presentation: presentActivity(event, store.data),
    });
  }
  return groups;
});
function projectName(event: Activity) {
  return store.data.projects.find((p) => p.id === event.projectId)?.name;
}
function selectWeek(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  week.value = value ? calendarWeek(value) : "";
  linked.value = null;
}
watch([project, query, excludeSeed], () => (linked.value = null));
async function restore(a: Activity) {
  if (
    !confirm(
      t(
        "Restore the value before this change? A new history entry will preserve the current version.",
      ),
    )
  )
    return;
  error.value = "";
  const current =
    a.kind === "project"
      ? store.data.projects.find((p) => p.id === a.entityId)
      : store.data.tasks.find((t) => t.id === a.entityId);
  if (!current) {
    error.value = t("The record no longer exists.");
    return;
  }
  try {
    await store.operation(
      () => api.restore(a.id, current.version),
      t("Previous version restored"),
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function canRestore(event: Activity) {
  return (
    event.before &&
    !("voided" in event.before && event.before.voided) &&
    !(event.after && "voided" in event.after && event.after.voided) &&
    event.source !== "Project merge" &&
    (event.kind === "project"
      ? store.data.projects.some((p) => p.id === event.entityId)
      : event.kind === "task" &&
        store.data.tasks.some((t) => t.id === event.entityId))
  );
}

function activityLabel(action: string) {
  const imported =
    /^Replaced workspace with (\d+) projects and (\d+) tasks$/.exec(action);
  return imported
    ? t("Replaced workspace with {projects} projects and {tasks} tasks", {
        projects: Number(imported[1]),
        tasks: Number(imported[2]),
      })
    : t(action);
}
function changeSummary(
  event: Activity,
  presentation: ReturnType<typeof presentActivity>,
  compact = true,
) {
  if (presentation.reason) return `${t("Reason")}: ${presentation.reason}`;
  const change = presentation.changes[0];
  if (!change) return "—";
  const value =
    event.before && event.after
      ? `${compact && change.before.length > 32 ? change.before.slice(0, 28) + "…" : change.before} → ${change.after}`
      : event.after
        ? change.after
        : change.before;
  return `${t(change.field)} · ${value}`;
}
</script>
<template>
  <section class="page activity-page">
    <header class="page-heading">
      <div class="activity-heading-copy">
        <h1><PhClockCounterClockwise :size="24" />{{ t("Activity") }}</h1>
      </div>
      <div class="history-actions">
        <button :disabled="loading" @click="history.refresh()">
          <PhArrowClockwise :size="16" :class="{ spinning: loading }" />
          {{ t("Refresh history") }}
        </button>
        <button
          :disabled="loading || exporting || !page || !!loadError"
          @click="exportHistory"
        >
          <PhDownloadSimple :size="16" />
          {{ t(exporting ? "Exporting…" : "Export filtered history") }}
        </button>
      </div>
    </header>
    <div class="activity-filter-panel">
      <div class="filterbar activity-filters">
        <label class="search-field"
          ><PhMagnifyingGlass :size="17" /><input
            v-model="query"
            data-global-search
            :placeholder="t('Search activity')"
            :aria-label="t('Search activity')" /></label
        ><select v-model="project" :aria-label="t('Filter activity project')">
          <option value="">{{ t("All projects") }}</option>
          <option v-if="scopedIds" value="__scope">
            {{ t("Projects from list filters") }}
          </option>
          <option v-for="p in store.data.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
        <label class="week-field">
          <PhCalendarBlank :size="16" />
          <span class="week-caption" aria-hidden="true">{{
            t("Week of")
          }}</span>
          <span class="sr-only">{{
            t("Week starting ({zone})", { zone: store.timeZone })
          }}</span>
          <input type="date" :value="week" @change="selectWeek" />
        </label>
        <button
          v-if="week"
          class="text-button all-dates"
          @click="
            week = '';
            linked = null;
          "
        >
          {{ t("All dates") }}
        </button>
      </div>
      <div class="history-controls">
        <p v-if="page" class="list-footnote" role="status">
          {{
            t("{shown} / {total} events · {zone}", {
              zone: page.timeZone,
              shown: formatNumber(history.events.value.length),
              total: formatNumber(page.total),
            })
          }}
        </p>
        <label class="check-label"
          ><input v-model="excludeSeed" type="checkbox" />{{
            t("Exclude sample history")
          }}</label
        >
      </div>
    </div>
    <p v-if="history.newChanges.value" class="history-notice" role="status">
      {{ t("New changes are available. Refresh to include them.") }}
      <button @click="history.refresh()">{{ t("Refresh history") }}</button>
    </p>
    <p v-if="loading" class="history-notice" role="status">
      {{ t("Loading history…") }}
    </p>
    <p v-if="loadError" class="error-box" role="alert">
      {{ t(loadError) }}
      <button @click="history.refresh()">{{ t("Retry") }}</button>
    </p>
    <p
      v-if="linked && !history.events.value.some((a) => a.id === linked!.id)"
      class="list-footnote"
    >
      {{
        t("Linked history record is shown separately from the current filters.")
      }}
    </p>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <div v-if="!loading && !loadError && !activities.length" class="empty">
      <PhClockCounterClockwise :size="32" />
      <h2>{{ t("No activity found") }}</h2>
      <p>{{ t("Saved updates and completed work will appear here.") }}</p>
    </div>
    <section
      v-for="group in activityGroups"
      :key="group.entries[0]!.event.id"
      class="activity-day"
      :aria-label="formatDate(group.date, { dateStyle: 'full' })"
    >
      <h2 class="day-heading">
        {{
          formatDate(group.date, {
            month: "long",
            day: "numeric",
            weekday: "long",
            year: "numeric",
          })
        }}
        <span>{{
          t("{count} events shown", { count: group.entries.length })
        }}</span>
      </h2>
      <ol class="activity-timeline">
        <li
          v-for="{ event, presentation } in group.entries"
          :key="event.id"
          class="timeline-entry"
        >
          <article
            :id="`activity-${event.id}`"
            class="activity-event"
            :class="{ 'is-expanded': expanded.has(event.id) }"
          >
            <div class="event-time">
              <time
                :datetime="event.createdAt"
                :title="
                  formatDate(event.createdAt, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                "
                >{{
                  formatDate(event.createdAt, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }}</time
              >
            </div>
            <div class="event-actor" :title="event.actor">
              {{ event.actor }}
            </div>
            <div class="event-operation">
              <span class="event-action" :class="`tone-${presentation.tone}`">{{
                activityLabel(presentation.label)
              }}</span>
            </div>
            <div class="event-subject">
              <RouterLink
                v-if="event.kind === 'project' && projectName(event)"
                :to="`/projects/${event.projectId}`"
                :title="presentation.subject || projectName(event)"
                >{{ presentation.subject || projectName(event) }}</RouterLink
              >
              <strong
                v-else-if="presentation.subject"
                :title="presentation.subject"
                >{{ presentation.subject }}</strong
              >
              <RouterLink
                v-if="event.kind !== 'project' && projectName(event)"
                class="event-project"
                :to="`/projects/${event.projectId}`"
                :title="projectName(event)"
                >{{ projectName(event) }}</RouterLink
              >
              <span
                v-else-if="event.projectId && !projectName(event)"
                class="event-project"
                >{{ t("Previous project") }}</span
              >
              <span
                v-if="!presentation.subject && !event.projectId"
                class="muted"
                >—</span
              >
            </div>
            <div class="event-summary">
              <div class="summary-line">
                <span :title="changeSummary(event, presentation, false)">{{
                  changeSummary(event, presentation)
                }}</span>
                <small v-if="presentation.changes.length > 1"
                  >+{{ presentation.changes.length - 1 }}</small
                >
              </div>
            </div>
            <div class="event-toggle">
              <button
                type="button"
                class="icon-button"
                :aria-label="t('Source & change details')"
                :title="t('Source & change details')"
                :aria-expanded="expanded.has(event.id)"
                :aria-controls="`activity-details-${event.id}`"
                @click="toggleDetails(event.id)"
              >
                <PhCaretDown
                  :size="15"
                  :class="{ rotated: expanded.has(event.id) }"
                />
                <span>{{ t("Source & change details") }}</span>
              </button>
            </div>
          </article>
          <section
            v-if="expanded.has(event.id)"
            :id="`activity-details-${event.id}`"
            class="event-details"
            :aria-label="t('Source & change details')"
          >
            <p v-if="presentation.reason" class="event-reason">
              <span>{{ t("Reason") }}</span
              >{{ presentation.reason }}
            </p>
            <dl
              v-if="presentation.changes.length"
              class="event-changes full-changes"
            >
              <div
                v-for="change in presentation.changes"
                :key="change.field"
                class="event-change"
              >
                <dt>{{ t(change.field) }}</dt>
                <dd>
                  <span v-if="event.before" class="change-before"
                    ><span class="sr-only">{{ t("Before") }}: </span
                    >{{ change.before }}</span
                  >
                  <PhArrowRight
                    v-if="event.before && event.after"
                    :size="12"
                    aria-hidden="true"
                  />
                  <span v-if="event.after" class="change-after"
                    ><span class="sr-only">{{ t("After") }}: </span
                    >{{ change.after }}</span
                  >
                </dd>
              </div>
            </dl>
            <h3 class="source-heading">{{ t("Source") }}</h3>
            <p class="source-copy">{{ event.source }}</p>
            <details class="raw-details">
              <summary>{{ t("Original record data") }}</summary>
              <div class="change-grid">
                <div>
                  <h4>{{ t("Before") }}</h4>
                  <pre>{{ JSON.stringify(event.before, null, 2) }}</pre>
                </div>
                <div>
                  <h4>{{ t("After") }}</h4>
                  <pre>{{ JSON.stringify(event.after, null, 2) }}</pre>
                </div>
              </div>
            </details>
            <button
              v-if="canRestore(event)"
              :disabled="store.busy"
              @click="restore(event)"
            >
              {{ t("Restore previous version") }}
            </button>
          </section>
        </li>
      </ol>
    </section>
    <button
      v-if="page?.nextCursor"
      class="load-more"
      :disabled="loadingMore"
      @click="history.more()"
    >
      {{ t(loadingMore ? "Loading history…" : "Load more changes") }}
    </button>
  </section>
</template>

<style scoped>
.activity-page {
  padding-block: 16px 28px;
}
.page-heading {
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
h1 {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 24px;
  line-height: 1.35;
  margin: 0;
}
h1 svg {
  color: var(--accent);
}
.history-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.history-actions button {
  font-size: 12px;
  min-height: 32px;
  padding: 6px 10px;
  background: var(--surface);
}
.activity-filter-panel {
  margin-bottom: 12px;
}
.activity-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0;
  margin: 0;
}
.search-field {
  flex: 1 1 240px;
  max-width: 520px;
  min-width: 180px;
}
.search-field input {
  height: 34px;
  font-size: 13px;
}
.activity-filters > select {
  flex: 0 1 220px;
  height: 34px;
  font-size: 12px;
}
.week-field {
  position: relative;
  flex: 0 0 220px;
  display: flex;
  flex-direction: row;
  align-items: center;
}
.week-field > svg {
  position: absolute;
  left: 10px;
  color: var(--muted);
  pointer-events: none;
}
.week-field input {
  width: 100%;
  height: 34px;
  padding: 6px 9px 6px 84px;
  font-size: 12px;
}
.week-caption {
  position: absolute;
  left: 32px;
  font-size: 11px;
  color: var(--muted);
  pointer-events: none;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.all-dates {
  font-size: 12px;
  color: var(--accent);
}
.history-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  align-items: center;
  padding: 8px 0 0;
}
.history-controls .list-footnote {
  font-size: 11px;
  line-height: 1.5;
  margin: 0;
}
.history-controls .check-label {
  display: flex;
  flex-direction: row;
  gap: 7px;
  align-items: center;
  font-size: 11px;
  font-weight: 400;
  margin-left: auto;
}
.history-controls input[type="checkbox"] {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--accent);
}
.history-notice {
  padding: 10px 12px;
  font-size: 13px;
  background: var(--accent-bg);
  border-radius: 6px;
}
.day-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 16px 0 7px;
}
.day-heading > span {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
}
.activity-timeline {
  list-style: none;
  margin: 0 0 0 12px;
  padding: 0 0 0 24px;
  border-left: 1px solid var(--border);
}
.timeline-entry {
  position: relative;
  min-width: 0;
  padding-bottom: 16px;
}
.timeline-entry::before {
  content: "";
  position: absolute;
  left: -29px;
  top: 18px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px var(--surface);
}
.activity-event {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: "actor operation time" "subject subject toggle" "summary summary toggle";
  gap: 8px 12px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  scroll-margin-top: 76px;
}
.activity-event > div {
  min-width: 0;
}
.event-actor {
  grid-area: actor;
  font-weight: 600;
}
.event-operation {
  grid-area: operation;
}
.event-time {
  grid-area: time;
}
.event-subject {
  grid-area: subject;
}
.event-summary {
  grid-area: summary;
}
.event-toggle {
  grid-area: toggle;
  align-self: center;
}
.activity-event:target,
.activity-event.is-expanded {
  border-color: var(--accent);
}
.event-time {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.event-actor {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.event-action {
  display: inline-block;
  border-radius: 4px;
  padding: 2px 5px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
  background: var(--surface-raised);
}
.tone-project {
  color: var(--accent-text);
  background: var(--accent-bg);
}
.tone-completed,
.tone-restored {
  color: var(--status-done);
  background: var(--status-done-bg);
}
.tone-danger {
  color: var(--danger);
  background: var(--danger-bg);
}
.event-subject > a,
.event-subject > strong,
.event-subject > span {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.event-subject > a:first-child {
  color: var(--text);
}
.event-subject > a:hover {
  color: var(--accent);
}
.event-subject .event-project {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
  margin-top: 3px;
}
.summary-line {
  display: flex;
  gap: 5px;
  align-items: baseline;
  min-width: 0;
  color: var(--text-secondary);
}
.summary-line > span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.summary-line > small {
  flex: none;
  font-size: 10px;
  color: var(--muted);
}
.activity-event .event-toggle {
  padding: 4px;
}
.event-toggle .icon-button {
  width: auto;
  min-height: 44px;
  display: flex;
  gap: 6px;
  padding: 8px;
  font-size: 11px;
  color: var(--muted);
}
.rotated {
  transform: rotate(180deg);
}
.event-details {
  margin-top: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 18px;
  background: var(--surface-subtle);
}
.event-changes {
  display: grid;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}
.event-change {
  display: flex;
  gap: 12px;
  min-width: 0;
}
.event-change dt {
  color: var(--muted);
  flex: 0 0 100px;
  overflow-wrap: anywhere;
}
.event-change dd {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.event-change dd > svg {
  flex-shrink: 0;
  align-self: center;
  color: var(--muted);
}
.event-change dd > span {
  max-width: 100%;
  white-space: pre-wrap;
}
.change-before {
  color: var(--muted);
}
.change-after {
  color: var(--text-secondary);
}
.event-reason {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0 0 10px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.event-reason > span {
  color: var(--muted);
  margin-right: 10px;
}
.source-heading {
  font-size: 11px;
  font-weight: 500;
  margin: 12px 0 4px;
}
.source-copy {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.raw-details {
  margin: 10px 0;
  font-size: 11px;
  color: var(--muted);
}
.raw-details summary {
  cursor: pointer;
  width: fit-content;
  padding: 4px 0;
}
.change-grid > div {
  min-width: 0;
}
.change-grid h4 {
  margin: 10px 0 0;
}
.load-more {
  display: flex;
  margin: 16px auto 0;
  min-width: 180px;
  font-size: 12px;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
@media (max-width: 760px) {
  .activity-page {
    padding-block: 14px 24px;
  }
  .page-heading {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    margin-bottom: 12px;
  }
  h1 {
    font-size: 22px;
  }
  .history-actions {
    justify-content: flex-end;
  }
  .history-actions button {
    min-height: 44px;
  }
  .search-field {
    flex: 1 1 100%;
    min-width: 100%;
    max-width: none;
  }
  .activity-filters > select {
    flex: 1 1 140px;
    max-width: none;
    min-width: 0;
    height: 44px;
    font-size: 16px;
  }
  .week-field {
    flex: 1 1 176px;
    min-width: 0;
  }
  .week-field input {
    height: 44px;
    font-size: 16px;
    padding-left: 54px;
  }
  .week-field > svg {
    display: none;
  }
  .week-caption {
    left: 10px;
  }
  .search-field input {
    height: 44px;
    font-size: 16px;
  }
  .history-controls {
    gap: 4px 12px;
    padding-top: 6px;
  }
  .history-controls .check-label {
    margin-left: 0;
    min-height: 44px;
  }
  .history-controls input[type="checkbox"] {
    width: 18px;
    height: 18px;
    flex-basis: 18px;
  }
  .day-heading {
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 12px;
    margin-top: 10px;
  }
  .activity-timeline {
    margin-left: 5px;
    padding-left: 16px;
  }
  .timeline-entry::before {
    left: -21px;
  }
  .activity-event {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: "actor time" "operation operation" "subject subject" "summary summary" "toggle toggle";
    padding: 12px;
    gap: 7px;
  }
  .event-time {
    font-size: 11px;
  }
  .event-subject {
    font-size: 13px;
  }
  .summary-line > span {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .event-toggle .icon-button {
    width: auto;
    min-height: 44px;
  }
  .event-details {
    padding: 12px;
  }
  .event-change {
    gap: 3px;
    flex-direction: column;
  }
  .event-change dt {
    flex-basis: auto;
    font-size: 11px;
  }
  .event-details button,
  .load-more,
  .raw-details summary {
    min-height: 44px;
  }
  .raw-details summary {
    padding-top: 12px;
  }
  .change-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
