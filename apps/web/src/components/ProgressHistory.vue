<script setup lang="ts">
import ProgressSources from "./ProgressSources.vue";
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../services/api";
import { t, formatDate } from "../locales";
import type { Project } from "../../../../packages/domain/types";
import type { ProgressEntry } from "../../../../packages/domain/progress";
const props = defineProps<{ project: Project }>();
const route = useRoute(),
  open = ref(false),
  loading = ref(false),
  error = ref("");
const entries = ref<ProgressEntry[]>([]);
let request = 0;
watch(
  () => route.hash,
  (hash) => {
    if (hash === "#progress-history") open.value = true;
  },
  { immediate: true },
);
watch(
  () => [open.value, props.project.id, props.project.version],
  async () => {
    if (!open.value) return;
    const current = ++request;
    loading.value = true;
    error.value = "";
    try {
      const result = await api.progressHistory(props.project.id);
      if (current === request) entries.value = result;
    } catch (e) {
      if (current === request)
        error.value = t(
          e instanceof Error ? e.message : "Changes could not be saved",
        );
    } finally {
      if (current === request) loading.value = false;
    }
  },
  { immediate: true },
);
</script>
<template>
  <details
    id="progress-history"
    class="panel progress-history"
    :open="open"
    @toggle="open = ($event.currentTarget as HTMLDetailsElement).open"
  >
    <summary>
      {{ t("Progress history")
      }}<span>{{ t("Every report and correction is retained") }}</span>
    </summary>
    <p v-if="loading" class="muted">{{ t("Loading…") }}</p>
    <p v-if="error" class="error-box" role="alert">{{ error }}</p>
    <ol v-if="!loading" class="progress-timeline">
      <li v-for="entry in entries" :key="entry.id">
        <div class="entry-meta">
          <span class="entry-dot"></span
          ><strong>{{
            t(entry.correction ? "Correction" : "Progress report")
          }}</strong
          ><span>{{ entry.author || t("Reporter unavailable") }}</span
          ><time>{{
            (entry.correction ? entry.recordedAt : entry.reportedAt)
              ? formatDate(
                  (entry.correction ? entry.recordedAt : entry.reportedAt)!,
                  { dateStyle: "medium", timeStyle: "short" },
                )
              : t("Report time unavailable")
          }}</time>
        </div>
        <p>{{ entry.text }}</p>
        <ProgressSources
          v-if="entry.originalSource"
          :source="entry.originalSource"
          :project-id="project.id"
        />
      </li>
    </ol>
    <p v-if="!loading && !entries.length" class="muted">
      {{ t("No update reported yet.") }}
    </p>
  </details>
</template>
<style scoped>
.progress-history {
  scroll-margin-top: 70px;
}
summary {
  cursor: pointer;
  font-size: 13px;
}
summary span {
  color: var(--muted);
  font-size: 11px;
  margin-left: 12px;
}
.progress-timeline {
  list-style: none;
  padding: 0;
  margin: 18px 0 0;
}
.progress-timeline li {
  position: relative;
  padding: 0 0 15px 18px;
  border-left: 1px solid var(--border);
  margin-left: 4px;
}
.entry-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-size: 11px;
}
.entry-dot {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  left: -4px;
  top: 4px;
}
.entry-meta strong {
  color: var(--accent);
  font-weight: 500;
}
.entry-meta time {
  margin-left: auto;
}
.progress-timeline p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.7;
  margin: 8px 0 0;
}
</style>
