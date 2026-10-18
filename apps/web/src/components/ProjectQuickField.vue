<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { projectInput, type Project } from "../../../../packages/domain/types";
import {
  channelEntries,
  projectChannel,
} from "../../../../packages/domain/channels";
import { catalogs, catalogLabel } from "../composables/catalogs";
import { confirmDiscard, useUnsaved } from "../composables/unsaved";
import { useWorkspace } from "../stores/workspace";
import { t } from "../locales";
import StatusBadge from "./StatusBadge.vue";
const props = defineProps<{
  project: Project;
  field: "stage" | "client" | "channelId";
}>();
const store = useWorkspace();
const editing = ref(false),
  draft = ref(""),
  error = ref("");
const original = ref(props.project);
const input = ref<HTMLInputElement | HTMLSelectElement>();
const value = (project: Project) =>
  props.field === "channelId" ? projectChannel(project) : project[props.field];
const label = computed(() =>
  t(
    props.field === "stage"
      ? "Stage"
      : props.field === "client"
        ? "Client"
        : "Channel",
  ),
);
const channels = computed(() =>
  channelEntries(catalogs.value).filter(
    (c) => !c.archived || c.id === projectChannel(props.project),
  ),
);
const stages = computed(() =>
  catalogs.value.stages
    .filter((s) => !s.archived || s.id === props.project.stage)
    .sort((a, b) => a.order - b.order),
);
const dirty = computed(
  () => editing.value && draft.value !== value(original.value),
);
useUnsaved(dirty);
async function open() {
  if (store.busy || !confirmDiscard()) return;
  original.value = { ...props.project };
  draft.value = value(props.project);
  error.value = "";
  editing.value = true;
  await nextTick();
  input.value?.focus();
}
async function save() {
  if (!dirty.value) {
    editing.value = false;
    return;
  }
  try {
    await store.saveProject(
      {
        ...projectInput.strip().parse(original.value),
        [props.field]: draft.value,
      },
      original.value,
    );
    editing.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <div class="project-quick-field">
    <form
      v-if="editing"
      @submit.prevent="save"
      @keydown.esc.stop.prevent="editing = false"
    >
      <input
        v-if="field === 'client'"
        ref="input"
        v-model="draft"
        :aria-label="label"
        maxlength="120"
        :disabled="store.busy"
      />
      <select
        v-else
        ref="input"
        v-model="draft"
        :aria-label="label"
        :disabled="store.busy"
        @change="save"
      >
        <template v-if="field === 'stage'">
          <option
            v-if="!stages.some((s) => s.id === project.stage)"
            :value="project.stage"
          >
            {{ catalogLabel("stages", project.stage) }}
          </option>
          <option v-for="stage in stages" :key="stage.id" :value="stage.id">
            {{ catalogLabel("stages", stage.id) }}
          </option>
        </template>
        <option
          v-for="channel in field === 'channelId' ? channels : []"
          :key="channel.id"
          :value="channel.id"
        >
          {{ channel.shortName }}
        </option>
      </select>
      <button
        v-if="field === 'client' || error"
        :disabled="store.busy"
        type="submit"
      >
        {{ t("Save") }}
      </button>
      <button type="button" :disabled="store.busy" @click="editing = false">
        {{ t("Cancel") }}
      </button>
    </form>
    <button
      v-else
      class="text-button metadata-value"
      :disabled="store.busy"
      :aria-label="t('Edit') + ' ' + label"
      @click="open"
    >
      <StatusBadge v-if="field === 'stage'" :stage="project.stage" />
      <template v-else
        ><span class="metadata-label">{{ label }}</span
        >{{
          field === "client"
            ? project.client || t("Add client")
            : channels.find((c) => c.id === projectChannel(project))
                ?.shortName || projectChannel(project)
        }}</template
      >
    </button>
    <small v-if="error" role="alert" class="error-text">{{ t(error) }}</small>
  </div>
</template>
<style scoped>
.project-quick-field {
  min-width: 0;
}
form,
.metadata-value {
  display: flex;
  align-items: center;
  gap: 8px;
}
.metadata-value {
  min-height: 36px;
  padding: 4px 6px;
  font-size: 13px;
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: left;
}
.metadata-label {
  color: var(--muted);
  flex: none;
}
form {
  flex-wrap: wrap;
}
form input,
form select {
  min-height: 40px;
  max-width: 220px;
}
.error-text {
  color: var(--danger);
}
@media (max-width: 600px) {
  .metadata-value,
  form button {
    min-height: 44px;
  }
  form input,
  form select {
    font-size: 16px;
    min-height: 44px;
  }
}
</style>
