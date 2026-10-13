<script setup lang="ts">
import { t, formatDate, formatNumber } from "../locales";
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import {
  PhClockCounterClockwise,
  PhMagnifyingGlass,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import type { Activity } from "../../../../packages/domain/types";
const store = useWorkspace(),
  route = useRoute();
const project = ref(String(route.query.project ?? "")),
  query = ref(""),
  error = ref("");
const activities = computed(() =>
  store.data.activities.filter(
    (a) =>
      (!project.value || a.projectId === project.value) &&
      (!query.value ||
        `${a.actor} ${a.action} ${activityLabel(a.action)} ${a.source}`
          .toLowerCase()
          .includes(query.value.toLowerCase())),
  ),
);
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
        <option v-for="p in store.data.projects" :key="p.id" :value="p.id">
          {{ p.name }}
        </option>
      </select>
    </div>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <div v-if="!activities.length" class="empty">
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
            <strong>{{ event.actor }}</strong>
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
    <p class="list-footnote">
      {{
        t(
          store.mode === "local"
            ? "Showing the latest {count} matching events stored in this browser."
            : "Showing the latest {count} matching events (up to 500). Full history remains in the database.",
          { count: formatNumber(activities.length) },
        )
      }}
    </p>
  </section>
</template>
