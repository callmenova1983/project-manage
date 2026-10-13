<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { PhCopy, PhX } from "@phosphor-icons/vue";
import type { Task } from "../../../../packages/domain/types";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { confirmDiscard } from "../composables/unsaved";
import { t, formatDate, formatNumber } from "../locales";
const props = defineProps<{
  task: Task;
  field: "assignee" | "dueDate";
  tasks: Task[];
}>();
const store = useWorkspace();
const dialog = ref<HTMLDialogElement | null>(null);
const source = ref<Task | null>(null),
  targets = ref<Task[]>([]);
const selected = ref<string[]>([]),
  query = ref(""),
  error = ref("");
const overwrite = ref(false);
const label = computed(() =>
  t(
    props.field === "assignee"
      ? "Copy assignee to other tasks"
      : "Copy due date to other tasks",
  ),
);
const candidates = computed(() =>
  targets.value.filter((task) =>
    task.title.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const chosen = computed(() =>
  targets.value.filter((task) => selected.value.includes(task.id)),
);
const changed = computed(() =>
  chosen.value.filter(
    (task) => task[props.field] !== source.value?.[props.field],
  ),
);
const replacing = computed(() =>
  changed.value.some((task) => !!task[props.field]),
);
function display(task: Task) {
  return props.field === "assignee"
    ? task.assignee || t("Unassigned")
    : task.dueDate
      ? formatDate(task.dueDate, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : t("No due date");
}
async function open() {
  if (store.busy || !confirmDiscard()) return;
  const current = store.data.tasks.find((task) => task.id === props.task.id);
  if (!current?.[props.field]) return;
  source.value = { ...current };
  targets.value = props.tasks
    .filter(
      (task) => task.projectId === current.projectId && task.id !== current.id,
    )
    .map((task) => ({
      ...store.data.tasks.find((current) => current.id === task.id)!,
    }));
  const next =
    props.tasks[props.tasks.findIndex((task) => task.id === current.id) + 1];
  selected.value =
    next && next.projectId === current.projectId ? [next.id] : [];
  query.value = "";
  error.value = "";
  overwrite.value = false;
  await nextTick();
  dialog.value?.showModal();
  dialog.value
    ?.querySelector<HTMLInputElement>("input[type='search']")
    ?.focus();
}
function close() {
  if (store.busy) return;
  dialog.value?.close();
  source.value = null;
}
async function copy() {
  if (
    !source.value ||
    !changed.value.length ||
    (replacing.value && !overwrite.value)
  )
    return;
  error.value = "";
  try {
    await store.operation(
      () =>
        api.copyTaskField({
          sourceId: source.value!.id,
          sourceVersion: source.value!.version,
          field: props.field,
          targets: chosen.value.map((task) => ({
            id: task.id,
            version: task.version,
          })),
          overwriteConfirmed: overwrite.value,
        }),
      t("Copied to {count} tasks", {
        count: formatNumber(changed.value.length),
      }),
    );
    close();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <button
    class="icon-button copy-field-button"
    type="button"
    :aria-label="`${label}: ${task.title}`"
    :title="label"
    :disabled="
      store.busy ||
      !task[field] ||
      !tasks.some(
        (candidate) =>
          candidate.projectId === task.projectId && candidate.id !== task.id,
      )
    "
    @click="open"
  >
    <PhCopy :size="14" />
  </button>
  <dialog
    ref="dialog"
    class="field-copy-dialog"
    :aria-label="label"
    @cancel.prevent="close"
  >
    <form v-if="source" @submit.prevent="copy">
      <div class="copy-heading">
        <h2>{{ label }}</h2>
        <button
          type="button"
          class="icon-button"
          :aria-label="t('Close')"
          :disabled="store.busy"
          @click="close"
        >
          <PhX :size="18" />
        </button>
      </div>
      <p class="copy-source">
        {{ t("Value to copy") }}：<strong>{{ display(source) }}</strong>
      </p>
      <p class="muted">
        {{
          t(
            "Select one or more tasks. The next visible row is selected by default; only this field will be copied.",
          )
        }}
      </p>
      <input
        v-model="query"
        type="search"
        :aria-label="t('Search target tasks')"
        :placeholder="t('Search target tasks')"
        :disabled="store.busy"
      />
      <div class="copy-targets">
        <label
          v-for="target in candidates"
          :key="target.id"
          class="copy-target"
        >
          <input
            v-model="selected"
            type="checkbox"
            :value="target.id"
            :aria-label="target.title"
            :disabled="store.busy"
          />
          <span
            ><strong>{{ target.title }}</strong
            ><small
              >{{ t("Current value") }}：{{ display(target) }}</small
            ></span
          >
        </label>
        <p v-if="!candidates.length" class="muted">
          {{ t("No matching tasks") }}
        </p>
      </div>
      <label v-if="replacing" class="copy-overwrite"
        ><input v-model="overwrite" type="checkbox" :disabled="store.busy" />{{
          t("Confirm replacing the selected tasks' existing values.")
        }}</label
      >
      <p v-if="chosen.length && !changed.length" class="muted">
        {{ t("Selected tasks already have this value.") }}
      </p>
      <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
      <div class="form-actions">
        <button type="button" :disabled="store.busy" @click="close">
          {{ t("Cancel") }}</button
        ><button
          type="submit"
          class="primary"
          :disabled="
            store.busy ||
            !changed.length ||
            selected.length > 100 ||
            (replacing && !overwrite)
          "
        >
          {{
            t("Copy to {count} tasks", { count: formatNumber(changed.length) })
          }}
        </button>
      </div>
    </form>
  </dialog>
</template>
<style scoped>
.copy-field-button {
  flex-shrink: 0;
  width: 26px;
  min-height: 30px;
  padding: 4px;
  color: var(--muted);
}
.copy-field-button:disabled {
  opacity: 0.25;
}
.field-copy-dialog {
  font-size: 14px;
  white-space: normal;
  text-align: left;
  width: min(560px, calc(100vw - 24px));
  max-height: calc(100dvh - 32px);
  overflow: auto;
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
}
.field-copy-dialog::backdrop {
  background: rgb(0 0 0 / 35%);
}
.copy-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.copy-heading h2 {
  font-size: 18px;
  margin: 0;
}
.copy-source {
  padding: 12px;
  border-radius: 8px;
  background: var(--accent-bg);
}
.field-copy-dialog input[type="search"] {
  width: 100%;
}
.copy-targets {
  max-height: 320px;
  overflow: auto;
  margin: 12px 0;
}
.copy-target {
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: center;
  min-height: 54px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}
.copy-target span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.copy-target strong {
  display: block;
  font-size: 13px;
}
.copy-target small {
  display: block;
  color: var(--muted);
  margin-top: 4px;
}
.copy-overwrite {
  display: flex;
  flex-direction: row;
  gap: 8px;
  align-items: center;
  margin: 12px 0;
}
.field-copy-dialog input[type="checkbox"] {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
}
@media (max-width: 600px) {
  .copy-field-button {
    min-width: 32px;
    min-height: 44px;
  }
  .field-copy-dialog {
    padding: 16px;
  }
}
</style>
