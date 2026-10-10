<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PhMagnifyingGlass, PhPlus } from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import {
  dayKey,
  weekKey,
  leafTasks,
  statuses,
  type Task,
} from "../../../../packages/domain/types";
import { statusLabels } from "../locales/en";
import TaskList from "../components/TaskList.vue";
import TaskEditor from "../components/TaskEditor.vue";
const store = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const scope = ref(String(route.query.scope ?? "week")),
  status = ref(String(route.query.status ?? "")),
  query = ref(""),
  project = ref(String(route.query.project ?? "")),
  creating = ref(false);
watch(
  () => route.query,
  () => {
    scope.value = String(route.query.scope ?? "week");
    status.value = String(route.query.status ?? "");
    project.value = String(route.query.project ?? "");
  },
);
const tasks = computed(() =>
  leafTasks(store.data.tasks).filter(
    (t) =>
      (scope.value === "all" ||
        (scope.value === "today"
          ? t.workDates.includes(dayKey())
          : t.workWeek === weekKey())) &&
      (!status.value || t.status === status.value) &&
      (!project.value || t.projectId === project.value) &&
      (!query.value ||
        `${t.title} ${t.assignee}`
          .toLowerCase()
          .includes(query.value.toLowerCase())),
  ),
);
function changeScope(value: string) {
  void router.replace({ query: { ...route.query, scope: value } });
}
function saved(t: Task) {
  creating.value = false;
  project.value = t.projectId;
}
</script>
<template>
  <section class="page">
    <div class="page-heading">
      <div>
        <div class="eyebrow">MAKE ROOM FOR THE WORK</div>
        <h1>Tasks</h1>
        <p class="page-subtitle">
          Know what is happening today and what comes next.
        </p>
      </div>
      <button
        class="primary"
        :disabled="!store.data.projects.length || creating"
        @click="creating = true"
      >
        <PhPlus :size="16" />New task
      </button>
    </div>
    <div class="scope-tabs">
      <button
        v-for="s in ['today', 'week', 'all']"
        :key="s"
        :class="{ active: scope === s }"
        @click="changeScope(s)"
      >
        {{ s === "today" ? "Today" : s === "week" ? "This week" : "All tasks"
        }}<span>{{
          s === "today"
            ? store.today.total
            : s === "week"
              ? store.week.total
              : store.total.total
        }}</span>
      </button>
    </div>
    <div class="filterbar">
      <label class="search-field"
        ><PhMagnifyingGlass :size="17" /><input
          v-model="query"
          data-global-search
          placeholder="Search tasks or assignees"
          aria-label="Search tasks" /></label
      ><select v-model="status" aria-label="Filter task status">
        <option value="">All statuses</option>
        <option v-for="s in statuses" :key="s" :value="s">
          {{ statusLabels[s] }}
        </option></select
      ><select
        v-model="project"
        aria-label="Filter task project"
        :disabled="creating && !!project"
      >
        <option value="">All projects</option>
        <option v-for="p in store.data.projects" :key="p.id" :value="p.id">
          {{ p.name }}
        </option>
      </select>
    </div>
    <div v-if="creating" class="panel">
      <label
        >Project for new task<select v-model="project" :disabled="!!project">
          <option disabled value="">Choose a project</option>
          <option v-for="p in store.data.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select></label
      ><TaskEditor
        v-if="project"
        :key="project"
        :projectId="project"
        @close="creating = false"
        @saved="saved"
      /><button v-else @click="creating = false">Cancel</button>
    </div>
    <div class="section-heading">
      <h3>
        {{
          scope === "today"
            ? "Today’s work"
            : scope === "week"
              ? "This week's work"
              : "All tasks"
        }}
      </h3>
      <span class="muted">{{ tasks.length }} leaf tasks</span>
    </div>
    <TaskList :tasks="tasks" showProject />
    <p class="list-footnote">
      Work scope is planned explicitly. Due dates do not change which tasks
      appear here. Parent tasks are excluded from counts.
    </p>
  </section>
</template>
