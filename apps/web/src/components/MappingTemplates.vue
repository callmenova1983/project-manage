<script setup lang="ts">
import { ref } from "vue";
import type { IntakeField } from "../../../../packages/domain/intake";
import { useWorkspace } from "../stores/workspace";
import { accountStorageKey } from "../services/account-storage";
import {
  mappingTemplateSchema,
  readMappingTemplates,
  saveMappingTemplates,
  reuseMapping,
  type MappingTemplate,
} from "../services/intake-mappings";
import { t } from "../locales";
const props = defineProps<{
  headers: string[];
  mapping: IntakeField[];
  hasHeader: boolean;
}>();
const emit = defineEmits<{
  reuse: [mapping: IntakeField[], hasHeader: boolean];
}>();
const store = useWorkspace();
const key = accountStorageKey("column-mappings", store.mode, store.user!);
const loaded = readMappingTemplates(key),
  templates = ref(loaded.templates);
const selected = ref(""),
  name = ref(""),
  message = ref(""),
  error = ref(
    loaded.unavailable
      ? "Saved mappings are unavailable. You can still map this file manually."
      : "",
  );
function persist(next: MappingTemplate[]) {
  if (!saveMappingTemplates(key, next)) {
    error.value =
      "Could not save mappings in this browser. Your current mapping is unchanged.";
    return false;
  }
  templates.value = next;
  error.value = "";
  return true;
}
function choose() {
  name.value = templates.value.find((t) => t.id === selected.value)?.name ?? "";
  message.value = "";
}
function save() {
  try {
    const item = mappingTemplateSchema.parse({
      id: selected.value || crypto.randomUUID(),
      name: name.value,
      hasHeader: props.hasHeader,
      columns: props.headers.map((header, index) => ({
        header: props.hasHeader ? header : "",
        field: props.mapping[index] ?? "ignore",
      })),
    });
    if (!item.columns.some((c) => c.field === "project" || c.field === "task"))
      throw new Error();
    if (
      templates.value.some(
        (t) =>
          t.id !== item.id && t.name.toLowerCase() === item.name.toLowerCase(),
      )
    ) {
      error.value = "Choose a unique mapping name.";
      return;
    }
    const next = templates.value.filter((t) => t.id !== item.id).concat(item);
    if (next.length > 20) {
      error.value =
        "Keep at most 20 saved mappings. Delete one before adding another.";
      return;
    }
    if (persist(next)) {
      selected.value = item.id;
      name.value = item.name;
      message.value = "Mapping saved for this account in this browser.";
    }
  } catch {
    error.value =
      "Enter a mapping name (1–60 characters), use short column headers and map a project or task column.";
  }
}
function reuse() {
  const item = templates.value.find((t) => t.id === selected.value);
  if (!item) return;
  try {
    emit("reuse", reuseMapping(item, props.headers), item.hasHeader);
    error.value = "";
    message.value =
      "Mapping applied. Check every column; unmatched or ambiguous headers are ignored.";
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function remove() {
  if (persist(templates.value.filter((t) => t.id !== selected.value))) {
    selected.value = "";
    name.value = "";
    message.value = "Mapping deleted.";
  }
}
</script>
<template>
  <section class="mapping-templates" :aria-label="t('Saved column mappings')">
    <h3>{{ t("Saved column mappings") }}</h3>
    <p class="muted">
      {{
        t(
          "Only column names and field choices are kept for your account in this browser. Source rows are never saved in a template.",
        )
      }}
    </p>
    <div class="mapping-controls">
      <label
        >{{ t("Saved mapping")
        }}<select
          v-model="selected"
          :aria-label="t('Saved mapping')"
          @change="choose"
        >
          <option value="">{{ t("New mapping") }}</option>
          <option v-for="item in templates" :key="item.id" :value="item.id">
            {{ item.name }}
          </option>
        </select></label
      >
      <button type="button" :disabled="!selected" @click="reuse">
        {{ t("Apply mapping") }}
      </button>
      <button type="button" :disabled="!selected" @click="remove">
        {{ t("Delete mapping") }}
      </button>
      <label
        >{{ t("Mapping name") }}<input v-model="name" maxlength="60"
      /></label>
      <button type="button" :disabled="!name.trim()" @click="save">
        {{ t(selected ? "Update mapping" : "Save mapping") }}
      </button>
    </div>
    <p v-if="error" role="alert" class="error-box">{{ t(error) }}</p>
    <p v-else-if="message" role="status" class="muted">{{ t(message) }}</p>
  </section>
</template>
<style scoped>
.mapping-templates {
  border-top: 1px solid var(--border);
  margin-top: 16px;
  padding-top: 12px;
}
.mapping-controls {
  display: flex;
  align-items: end;
  gap: 10px;
  flex-wrap: wrap;
}
.mapping-controls label {
  flex: 1 1 200px;
  min-width: 0;
}
.mapping-controls input,
.mapping-controls select {
  width: 100%;
}
@media (max-width: 600px) {
  .mapping-controls label {
    flex-basis: 100%;
  }
}
</style>
