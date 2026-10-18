<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { confirmDiscard } from "../composables/unsaved";
import { t } from "../locales";
const DirectoryView = defineAsyncComponent(() => import("./DirectoryView.vue"));
const PeopleWorkView = defineAsyncComponent(
  () => import("./PeopleWorkView.vue"),
);
const StatisticsView = defineAsyncComponent(
  () => import("./StatisticsView.vue"),
);
const route = useRoute(),
  router = useRouter();
const tab = computed(() =>
  route.query.tab === "work"
    ? "work"
    : route.query.tab === "statistics"
      ? "statistics"
      : "members",
);
onBeforeRouteUpdate(
  (to, from) => to.query.tab === from.query.tab || confirmDiscard(),
);
</script>
<template>
  <nav class="team-tabs page" :aria-label="t('Team sections')">
    <button
      v-for="value in ['members', 'statistics']"
      :key="value"
      :aria-pressed="tab === value"
      :class="{ active: tab === value }"
      @click="router.push({ query: { tab: value } })"
    >
      {{ value === "members" ? t("Directory") : "统计分析" }}
    </button>
  </nav>
  <PeopleWorkView v-if="tab === 'work'" />
  <StatisticsView v-else-if="tab === 'statistics'" />
  <DirectoryView v-else />
</template>
<style scoped>
.team-tabs {
  display: flex;
  gap: 8px;
  padding-bottom: 0;
  padding-top: 16px;
}
.team-tabs button {
  min-height: 44px;
}
.team-tabs .active {
  color: var(--accent);
  border-color: var(--accent-border);
  background: var(--accent-bg);
}
</style>
