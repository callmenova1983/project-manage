<script setup lang="ts">
import { computed } from "vue";
import {
  PhArrowUpRight,
  PhCheckCircle,
  PhListChecks,
} from "@phosphor-icons/vue";
import {
  dayKey,
  weekKey,
  leafTasks,
  type Task,
  type Project,
} from "../../../../packages/domain/types";
import { t, formatDate } from "../locales";
import StatusBadge from "./StatusBadge.vue";
const props = defineProps<{
  tasks: Task[];
  projects: Project[];
  scope: "today" | "week";
}>();
const next = computed(() => {
  const ids = new Set(props.projects.map((project) => project.id));
  return leafTasks(props.tasks)
    .filter(
      (task) =>
        ids.has(task.projectId) &&
        task.status !== "done" &&
        (props.scope === "today"
          ? task.workDates.includes(dayKey())
          : task.workWeek === weekKey()),
    )
    .sort(
      (a, b) =>
        Number(b.workDates.includes(dayKey())) -
          Number(a.workDates.includes(dayKey())) ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        a.title.localeCompare(b.title),
    );
});
</script>
<template>
  <section class="next-work" :aria-label="t('Next up')">
    <header>
      <h2><PhListChecks :size="18" />{{ t("Next up") }}</h2>
      <RouterLink
        :to="{
          path: '/tasks',
          query: {
            scope,
            focus: 'open',
            ...(projects.length === 1 ? { project: projects[0]!.id } : {}),
          },
        }"
        >{{ t("View planned tasks") }}<PhArrowUpRight :size="14"
      /></RouterLink>
    </header>
    <p class="next-count">
      {{ t("{count} open planned tasks", { count: next.length }) }}
    </p>
    <ol v-if="next.length">
      <li v-for="task in next.slice(0, 4)" :key="task.id">
        <StatusBadge :status="task.status" />
        <div>
          <RouterLink
            :to="{
              path: '/tasks',
              query: { project: task.projectId, scope, focus: 'open' },
            }"
            >{{ task.title }}</RouterLink
          ><span
            >{{
              projects.find((project) => project.id === task.projectId)?.name
            }}
            ·
            {{ task.workDates.includes(dayKey()) ? t("Today") : t("This week")
            }}<template v-if="task.dueDate">
              ·
              {{
                t("Due {date}", {
                  date: formatDate(task.dueDate, {
                    month: "short",
                    day: "numeric",
                  }),
                })
              }}</template
            ></span
          >
        </div>
      </li>
    </ol>
    <div v-else class="next-empty">
      <PhCheckCircle :size="24" />
      <p>{{ t("Nothing pending in this scope") }}</p>
    </div>
  </section>
</template>
<style scoped>
.next-work {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 12px 14px;
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  margin: 0;
}
header > a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  min-height: 44px;
  color: var(--accent);
}
.next-count {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px;
}
ol {
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  border-top: 1px solid var(--border);
  padding: 9px 0;
}
li > div {
  min-width: 0;
  display: grid;
  gap: 5px;
}
li a {
  font-size: 12px;
  color: var(--text);
  line-height: 1.4;
}
li > div > span {
  font-size: 10px;
  color: var(--muted);
  line-height: 1.4;
}
li :deep(.badge) {
  font-size: 10px;
  padding: 2px 4px;
  white-space: nowrap;
  margin-top: 1px;
}
.next-empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  color: var(--muted);
  padding: 24px 0;
}
.next-empty p {
  font-size: 12px;
  margin: 0;
}
@media (max-width: 600px) {
  li a {
    display: inline-block;
    min-height: 28px;
  }
  header > a {
    font-size: 12px;
  }
}
</style>
