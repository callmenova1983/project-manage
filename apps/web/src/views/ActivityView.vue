<script setup lang="ts">
import { calendarWeek } from "../../../../packages/domain/time-zone";
import { t, formatDate, formatNumber } from "../locales";
import { computed, ref, watch, nextTick, onBeforeUnmount } from "vue";
import { useRoute } from "vue-router";
import {
  PhClockCounterClockwise,
  PhMagnifyingGlass,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { type Activity } from "../../../../packages/domain/types";
import { useActivityHistory } from "../composables/activity-history";
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
  query = ref(""),
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
</script>
<template>
  <section class="page activity-page">
    <div class="page-heading">
      <div>
        <div class="eyebrow">{{ t("THE STORY OF YOUR WORK") }}</div>
        <h1>{{ t("Activity") }}</h1>
        <p class="page-subtitle">
          {{ t("What changed, what was completed, and who moved it forward.") }}
        </p>
      </div>
      <PhClockCounterClockwise :size="26" class="muted" />
    </div>
    <div class="filterbar">
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
    </div>
    <div class="history-controls">
      <label
        >{{ t("Week starting ({zone})", { zone: store.timeZone })
        }}<input type="date" :value="week" @change="selectWeek"
      /></label>
      <button
        v-if="week"
        @click="
          week = '';
          linked = null;
        "
      >
        {{ t("All dates") }}
      </button>
      <label class="check-label"
        ><input v-model="excludeSeed" type="checkbox" />{{
          t("Exclude sample history")
        }}</label
      >
      <button :disabled="loading" @click="history.refresh()">
        {{ t("Refresh history") }}
      </button>
      <button
        :disabled="loading || exporting || !page || !!loadError"
        @click="exportHistory"
      >
        {{ t(exporting ? "Exporting…" : "Export filtered history") }}
      </button>
    </div>
    <p v-if="history.newChanges.value" role="status">
      {{ t("New changes are available. Refresh to include them.") }}
      <button @click="history.refresh()">{{ t("Refresh history") }}</button>
    </p>
    <p v-if="loading" role="status">{{ t("Loading history…") }}</p>
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
    <p v-if="page" class="list-footnote">
      {{
        t(
          "Showing {shown} of {total} matching events · Complete history · {zone}",
          {
            zone: page.timeZone,
            shown: formatNumber(history.events.value.length),
            total: formatNumber(page.total),
          },
        )
      }}
    </p>
    <div v-if="!loading && !loadError && !activities.length" class="empty">
      <PhClockCounterClockwise :size="32" />
      <h2>{{ t("No activity found") }}</h2>
      <p>{{ t("Saved updates and completed work will appear here.") }}</p>
    </div>
    <article
      v-for="event in activities"
      :key="event.id"
      :id="`activity-${event.id}`"
      class="activity-event"
    >
      <span class="avatar">{{
        event.actor
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
      }}</span>
      <div class="event-body">
        <div class="section-heading">
          <p>
            <strong>{{ event.actor }}</strong
            >{{ " " }}
            <span class="muted">{{
              activityLabel(event.action).toLocaleLowerCase()
            }}</span>
          </p>
          <time :datetime="event.createdAt">{{
            formatDate(event.createdAt, {
              dateStyle: "medium",
              timeStyle: "short",
            })
          }}</time>
        </div>
        <RouterLink
          v-if="event.projectId"
          :to="`/projects/${event.projectId}`"
          >{{
            store.data.projects.find((p) => p.id === event.projectId)?.name ||
            t("Previous project")
          }}</RouterLink
        >
        <p v-if="event.after" class="event-description">
          {{
            "latestUpdate" in event.after
              ? event.after.latestUpdate
              : event.after.title
          }}
        </p>
        <details>
          <summary>{{ t("Source & change details") }}</summary>
          <p class="source-copy">{{ event.source }}</p>
          <div v-if="event.before" class="change-grid">
            <div>
              <h4>{{ t("Before") }}</h4>
              <pre>{{ JSON.stringify(event.before, null, 2) }}</pre>
            </div>
            <div>
              <h4>{{ t("After") }}</h4>
              <pre>{{ JSON.stringify(event.after, null, 2) }}</pre>
            </div>
          </div>
          <button
            v-if="canRestore(event)"
            :disabled="store.busy"
            @click="restore(event)"
          >
            {{ t("Restore previous version") }}
          </button>
        </details>
      </div>
    </article>
    <button
      v-if="page?.nextCursor"
      :disabled="loadingMore"
      @click="history.more()"
    >
      {{ t(loadingMore ? "Loading history…" : "Load more changes") }}
    </button>
  </section>
</template>

<style scoped>
.history-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin: 12px 0;
}
.history-controls label {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.history-controls input[type="date"] {
  width: auto;
}
.history-controls input[type="checkbox"] {
  width: 18px;
}
</style>
