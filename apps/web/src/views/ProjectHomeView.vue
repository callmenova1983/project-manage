<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from "vue";
import { onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import {
  projectViewQuery,
  readProjectViewQuery,
  type ProjectViewFilters,
} from "../../../../packages/domain/project-view";
import { useWorkspace } from "../stores/workspace";
import { confirmDiscard } from "../composables/unsaved";
import { t } from "../locales";
import ProjectsView from "./ProjectsView.vue";
const WorkspaceOverview = defineAsyncComponent(
  () => import("./WorkspaceOverview.vue"),
);
const store = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const tab = computed(() =>
  route.query.tab === "overview" ? "overview" : "projects",
);
const invalid = computed(() => readProjectViewQuery(route.query).invalid);
let hydrating = false;
let filterRequest = 0;
function hydrate(query: Record<string, unknown>) {
  if (route.path !== "/projects") return;
  const filters = readProjectViewQuery(query);
  if (filters.invalid) return;
  hydrating = true;
  Object.assign(store.projectNavigation, {
    query: filters.query ?? "",
    stage: filters.stage ?? "",
    owner: filters.owner ?? "",
    discipline: filters.discipline ?? "",
    category: filters.category ?? "",
    channel: filters.channel ?? "",
    followedOnly: !!filters.followedOnly,
    sort: filters.sort ?? "manual",
  });
  hydrating = false;
}
watch(() => route.query, hydrate, { immediate: true, flush: "sync" });
watch(
  () =>
    JSON.stringify(
      projectViewQuery(store.projectNavigation as ProjectViewFilters),
    ),
  () => {
    if (
      route.path !== "/projects" ||
      hydrating ||
      tab.value !== "projects" ||
      invalid.value
    )
      return;
    const next = projectViewQuery(
      store.projectNavigation as ProjectViewFilters,
    );
    if (
      JSON.stringify(next) ===
      JSON.stringify(projectViewQuery(readProjectViewQuery(route.query)))
    )
      return;
    const request = ++filterRequest;
    if (!confirmDiscard()) {
      hydrate(route.query);
      return;
    }
    void router
      .replace({ query: { ...route.query, ...next } })
      .then((failure) => {
        if (failure && request === filterRequest) hydrate(route.query);
      });
  },
  { flush: "sync" },
);
function navigate(value: string) {
  void router.push({
    query: {
      ...route.query,
      ...projectViewQuery(store.projectNavigation as ProjectViewFilters),
      tab: value,
    },
  });
}
function clear() {
  Object.assign(store.projectNavigation, {
    query: "",
    stage: "",
    owner: "",
    discipline: "",
    category: "",
    channel: "",
    followedOnly: false,
    sort: "manual",
  });
  void router.replace({ query: { tab: tab.value } });
}
onBeforeRouteUpdate(
  (to, from) => to.query.tab === from.query.tab || confirmDiscard(),
);
</script>
<template>
  <nav class="project-home-tabs page" :aria-label="t('Project sections')">
    <button
      v-for="value in ['projects', 'overview']"
      :key="value"
      :aria-pressed="tab === value"
      :class="{ active: tab === value }"
      @click="navigate(value)"
    >
      {{ t(value === "projects" ? "Projects" : "Workspace overview") }}
    </button>
  </nav>
  <div v-if="invalid" class="page">
    <p class="error-box" role="alert">
      {{ t("The project filters in this link are invalid.") }}
    </p>
    <button @click="clear">{{ t("Clear filters") }}</button>
  </div>
  <WorkspaceOverview v-else-if="tab === 'overview'" />
  <ProjectsView v-else />
</template>
<style scoped>
.project-home-tabs {
  display: flex;
  gap: 8px;
  padding-bottom: 0;
  padding-top: 16px;
}
.project-home-tabs button {
  min-height: 44px;
}
.project-home-tabs .active {
  color: var(--accent);
  border-color: var(--accent-border);
  background: var(--accent-bg);
}
</style>
