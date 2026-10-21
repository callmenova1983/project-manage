<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { selectProjects } from "../../../../packages/domain/project-view";
import WeeklyChanges from "../components/WeeklyChanges.vue";
import NextWork from "../components/NextWork.vue";
import { useWorkspace } from "../stores/workspace";
import { t } from "../locales";

const store = useWorkspace();
const router = useRouter();
const route = useRoute();
const portfolioProjects = computed(() =>
  store.data.projects.filter((project) => !project.intakeInbox),
);
const projects = computed(() =>
  selectProjects(
    store.data.projects,
    store.data.members,
    {
      ...store.projectNavigation,
      sort: store.projectNavigation.sort as "manual" | "updated" | "name",
    },
    store.following,
    store.data.projectOrder,
  ),
);
const filtered = computed(() => {
  const { query, followedOnly, stage, owner, discipline, category, channel } =
    store.projectNavigation;
  return !!(
    query ||
    followedOnly ||
    stage ||
    owner ||
    discipline ||
    category ||
    channel
  );
});
</script>

<template>
  <section class="page project-updates-page">
    <header class="page-heading">
      <div>
        <h1>{{ t("Changes & next work") }}</h1>
        <p class="muted">{{ t("Saved history · upcoming tasks") }}</p>
      </div>
      <button
        v-if="filtered"
        @click="
          router.push({
            query: { ...route.query, tab: 'projects' },
          })
        "
      >
        {{ t("Filters") }} ·
        {{ t("{count} projects", { count: projects.length }) }}
      </button>
    </header>
    <div class="portfolio-insights">
      <WeeklyChanges
        :activities="store.data.activities"
        :projects="portfolioProjects"
        :projectIds="
          filtered ? projects.map((project) => project.id) : undefined
        "
      />
      <div class="upcoming-work">
        <div class="scope-switch" :aria-label="t('Project work scope')">
          <button
            :aria-pressed="store.projectNavigation.scope === 'today'"
            :class="{ active: store.projectNavigation.scope === 'today' }"
            @click="store.projectNavigation.scope = 'today'"
          >
            {{ t("Today") }}
          </button>
          <button
            :aria-pressed="store.projectNavigation.scope === 'week'"
            :class="{ active: store.projectNavigation.scope === 'week' }"
            @click="store.projectNavigation.scope = 'week'"
          >
            {{ t("This week") }}
          </button>
        </div>
        <NextWork
          :tasks="store.data.tasks"
          :projects="projects"
          :scope="store.projectNavigation.scope"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.page-heading p {
  margin: 8px 0 0;
}
.portfolio-insights {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.upcoming-work {
  min-width: 0;
}
.scope-switch {
  margin-bottom: 10px;
}
@media (max-width: 900px) {
  .portfolio-insights {
    grid-template-columns: 1fr;
  }
}
</style>
