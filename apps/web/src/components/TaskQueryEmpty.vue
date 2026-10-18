<script setup lang="ts">
import { PhCheckSquare, PhPlus } from "@phosphor-icons/vue";
import { t } from "../locales";
defineProps<{
  title: string;
  description: string;
  unlinkedCount: number;
  hasTasks: boolean;
  hasProjects: boolean;
  hasFilters: boolean;
  mine: boolean;
}>();
defineEmits<{ clear: []; removeAssignee: []; create: [] }>();
</script>
<template>
  <div class="task-empty-state">
    <div class="task-empty-icon"><PhCheckSquare :size="28" /></div>
    <h2>{{ title }}</h2>
    <p>{{ description }}</p>
    <p v-if="unlinkedCount" class="task-identity-note">
      {{
        t("{count} tasks have an assignee name without a linked account.", {
          count: unlinkedCount,
        })
      }}
    </p>
    <div class="task-empty-actions">
      <button
        v-if="hasTasks && mine"
        class="primary"
        @click="$emit('removeAssignee')"
      >
        {{ t("Remove assignee filter") }}
      </button>
      <button
        v-if="hasTasks && hasFilters"
        :class="{ primary: !mine }"
        @click="$emit('clear')"
      >
        {{ t("View all tasks") }}
      </button>
      <button
        v-if="!hasTasks && hasProjects"
        class="primary"
        @click="$emit('create')"
      >
        <PhPlus :size="16" />{{ t("New task") }}
      </button>
      <RouterLink v-if="!hasProjects" to="/projects">{{
        t("Create a project first")
      }}</RouterLink>
    </div>
  </div>
</template>
<style scoped>
.task-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  justify-content: center;
  min-height: 300px;
  padding: 40px 24px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.task-empty-icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  background: var(--accent-bg);
  color: var(--accent);
  border-radius: 14px;
  margin-bottom: 18px;
}
h2 {
  margin: 0 0 10px;
  font-size: 19px;
}
p {
  max-width: 560px;
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.8;
}
.task-identity-note {
  margin-top: 10px;
  font-size: 12px;
}
.task-empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 22px;
}
.task-empty-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
}
@media (max-width: 760px) {
  .task-empty-state {
    padding: 30px 16px;
  }
  h2 {
    font-size: 17px;
  }
  .task-empty-actions button {
    min-height: 44px;
  }
}
</style>
