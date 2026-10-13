<script setup lang="ts">
import { ref } from "vue";
import type {
  ProgressSource,
  ProgressMaterial,
} from "../../../../packages/domain/progress-material";
import { api } from "../services/api";
import { t } from "../locales";
const props = defineProps<{ source: ProgressSource; projectId: string }>();
const items = ref<ProgressMaterial[]>([]),
  loaded = ref(false),
  error = ref("");
const url = (id: string) => `/api/projects/${props.projectId}/materials/${id}`;
async function load(event: Event) {
  if (!(event.target as HTMLDetailsElement).open || loaded.value) return;
  try {
    items.value = await api.progressMaterials(
      props.projectId,
      props.source.materialIds,
    );
    loaded.value = true;
  } catch (e) {
    error.value = t((e as Error).message);
  }
}
</script>
<template>
  <details class="progress-sources" @toggle="load">
    <summary>
      {{ t("Original sources")
      }}<span v-if="source.materialIds.length">
        · {{ source.materialIds.length }}</span
      >
    </summary>
    <p v-if="source.text">{{ source.text }}</p>
    <p v-if="source.recognizedText">{{ source.recognizedText }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-for="item in items" :key="item.id" class="source-file">
      <a :href="url(item.id)">{{ item.name }}</a>
      <div class="source-pictures">
        <img
          v-for="index in item.imageCount"
          :key="index"
          :src="`${url(item.id)}/images/${index - 1}`"
          :alt="`${item.name} ${index}`"
          loading="lazy"
        />
      </div>
      <details v-if="item.text">
        <summary>{{ t("Original text and image transcription") }}</summary>
        <p>{{ item.text }}</p>
      </details>
    </div>
  </details>
</template>
<style scoped>
.progress-sources {
  margin-top: 8px;
  font-size: 11px;
  color: var(--muted);
}
summary {
  cursor: pointer;
}
.progress-sources p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow: auto;
}
.source-file {
  margin: 8px 0;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
}
.source-pictures {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.source-pictures img {
  margin-top: 7px;
  max-width: 100%;
  width: 260px;
  max-height: 180px;
  object-fit: contain;
  object-position: left top;
}
</style>
