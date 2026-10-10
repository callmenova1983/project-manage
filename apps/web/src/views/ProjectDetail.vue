<script setup lang="ts">
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
</script>
<template>
  <section v-if="project" class="page detail-page">
    <RouterLink to="/projects" class="back-link"
      ><PhArrowLeft :size="16" />All projects</RouterLink
    >
    <div class="page-heading">
      <div>
        <h1>{{ project.name }}</h1>
        <p class="page-subtitle">
          {{ project.client }} <span class="dot-separator">·</span>
          {{ project.discipline }}
        </p>
      </div>
      <button :disabled="editing" @click="editing = true">
        <PhPencilSimple :size="16" />Edit project
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
          >Owner <strong>{{ project.owner }}</strong></span
        ><span class="muted"
          >{{ counts.done }} of {{ counts.total }} tasks completed</span
        >
      </div>
      <div class="detail-grid">
        <section class="panel">
          <h3>Latest reported update</h3>
          <p class="report-text">
            {{ project.latestUpdate || "No update reported yet." }}
          </p>
          <span class="muted"
            >{{
              project.reportedAt
                ? new Date(project.reportedAt).toLocaleString()
                : "Report time unavailable"
            }}
            · {{ project.reportedBy ?? "Reporter unavailable" }}</span
          >
        </section>
        <section class="panel">
          <h3>Project context</h3>
          <p>{{ project.description || "Add context for the team." }}</p>
          <p class="muted">
            Aliases: {{ project.aliases.join(", ") || "None" }}
          </p>
        </section>
      </div>
      <section v-if="project.notes" class="panel">
        <h3>Working notes</h3>
        <pre class="working-notes">{{ project.notes }}</pre>
      </section></template
    >
    <section class="panel tasks-panel">
      <div class="section-heading">
        <h2>
          Tasks <span class="title-count">{{ counts.total }}</span>
        </h2>
        <button :disabled="paste" @click="paste = true">
          <PhClipboardText :size="16" />Paste tasks
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
        <h3>Recent activity</h3>
        <RouterLink :to="`/activity?project=${project.id}`"
          >View history</RouterLink
        >
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
          <strong>{{ event.actor }}</strong> {{ event.action.toLowerCase()
          }}<small>{{ new Date(event.createdAt).toLocaleString() }}</small>
        </div>
      </div>
    </section>
  </section>
  <section v-else class="empty">
    <h1>Project not found</h1>
    <RouterLink to="/projects" class="button">Return to projects</RouterLink>
  </section>
</template>
