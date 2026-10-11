<script setup lang="ts">
import { catalogLabel } from "../composables/catalogs";
import { t, formatDate, formatNumber } from "../locales";
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import {
  PhArrowLeft,
  PhPencilSimple,
  PhClipboardText,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { statistics } from "../../../../packages/domain/types";
import ProjectEditor from "../components/ProjectEditor.vue";
import TaskList from "../components/TaskList.vue";
import PasteTasks from "../components/PasteTasks.vue";
import StatusBadge from "../components/StatusBadge.vue";
const store = useWorkspace(),
  route = useRoute();
const editing = ref(false),
  paste = ref(false);
const project = computed(() =>
  store.data.projects.find((p) => p.id === route.params.id),
);
const tasks = computed(() =>
  store.data.tasks.filter((t) => t.projectId === project.value?.id),
);
const counts = computed(() => statistics(tasks.value));
const activity = computed(() =>
  store.data.activities
    .filter((a) => a.projectId === project.value?.id)
    .slice(0, 8),
);

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
  <section v-if="project" class="page detail-page">
    <RouterLink to="/projects" class="back-link"
      ><PhArrowLeft :size="16" />{{ t("All projects") }}</RouterLink
    >
    <p v-if="project.categoryIds?.length" class="muted">
      {{
        project.categoryIds
          .map((id) => catalogLabel("categories", id))
          .join(" · ")
      }}
    </p>
    <div class="page-heading">
      <div>
        <h1>{{ project.name }}</h1>
        <p class="page-subtitle">
          {{ project.client }} <span class="dot-separator">·</span>
          {{ t(project.discipline) }}
        </p>
      </div>
      <button :disabled="editing" @click="editing = true">
        <PhPencilSimple :size="16" />{{ t("Edit project") }}
      </button>
    </div>
    <ProjectEditor
      v-if="editing"
      :project="project"
      @close="editing = false"
      @saved="editing = false"
    /><template v-else
      ><div class="detail-meta">
        <StatusBadge :stage="project.stage" /><span class="muted"
          >{{ t("Owner") }} <strong>{{ project.owner }}</strong></span
        ><span class="muted">{{
          t("{done} of {total} tasks completed", {
            done: formatNumber(counts.done),
            total: formatNumber(counts.total),
          })
        }}</span>
      </div>
      <div class="detail-grid">
        <section class="panel">
          <h3>{{ t("Latest reported update") }}</h3>
          <p class="report-text">
            {{ project.latestUpdate || t("No update reported yet.") }}
          </p>
          <span class="muted"
            >{{
              project.reportedAt
                ? formatDate(project.reportedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : t("Report time unavailable")
            }}
            · {{ project.reportedBy ?? t("Reporter unavailable") }}</span
          >
        </section>
        <section class="panel">
          <h3>{{ t("Project context") }}</h3>
          <p>{{ project.description || t("Add context for the team.") }}</p>
          <p class="muted">
            {{ t("Aliases:") }} {{ project.aliases.join(", ") || t("None") }}
          </p>
        </section>
      </div>
      <section v-if="project.notes" class="panel">
        <h3>{{ t("Working notes") }}</h3>
        <pre class="working-notes">{{ project.notes }}</pre>
      </section></template
    >
    <section class="panel tasks-panel">
      <div class="section-heading">
        <h2>
          {{ t("Tasks") }}
          <span class="title-count">{{ formatNumber(counts.total) }}</span>
        </h2>
        <button :disabled="paste" @click="paste = true">
          <PhClipboardText :size="16" />{{ t("Paste tasks") }}
        </button>
      </div>
      <PasteTasks
        v-if="paste"
        :projectId="project.id"
        @close="paste = false"
      /><TaskList :tasks="tasks" :projectId="project.id" />
    </section>
    <section class="panel">
      <div class="section-heading">
        <h3>{{ t("Recent activity") }}</h3>
        <RouterLink :to="`/activity?project=${project.id}`">{{
          t("View history")
        }}</RouterLink>
      </div>
      <div v-for="event in activity" :key="event.id" class="activity-mini">
        <span class="avatar small">{{
          event.actor
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
        }}</span>
        <div>
          <strong>{{ event.actor }}</strong>
          {{ activityLabel(event.action).toLocaleLowerCase()
          }}<small>{{
            formatDate(event.createdAt, {
              dateStyle: "medium",
              timeStyle: "short",
            })
          }}</small>
        </div>
      </div>
    </section>
  </section>
  <section v-else class="empty">
    <h1>{{ t("Project not found") }}</h1>
    <RouterLink to="/projects" class="button">{{
      t("Return to projects")
    }}</RouterLink>
  </section>
</template>
