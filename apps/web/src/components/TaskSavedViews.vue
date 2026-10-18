<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { readViewPreferences } from "../services/view-preferences";
import { accountStorageKey } from "../services/account-storage";
import {
  captureTaskView,
  readSavedTaskViews,
  savedTaskViewQuery,
  writeSavedTaskViews,
  type SavedTaskView,
} from "../services/saved-task-views";
import { useWorkspace } from "../stores/workspace";
import { confirmDiscard, useUnsaved } from "../composables/unsaved";
import { zonedDay } from "../../../../packages/domain/time-zone";
import { t } from "../locales";
const props = defineProps<{ projectId?: string; layout: string }>();
const store = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const views = ref<SavedTaskView[]>([]),
  error = ref(""),
  notice = ref("");
const selected = ref(""),
  name = ref(""),
  fixedDate = ref(false);
useUnsaved(computed(() => !!name.value.trim()));
const context = computed(() =>
  props.projectId ? ("projectTasks" as const) : ("tasks" as const),
);
const key = computed(() =>
  store.user
    ? accountStorageKey("saved-task-views", store.mode, store.user)
    : "",
);
const entries = computed(() =>
  views.value.filter((view) => view.context === context.value),
);
const current = computed(() =>
  entries.value.find((view) => view.id === selected.value),
);
watch(
  key,
  () => {
    views.value = [];
    selected.value = name.value = error.value = notice.value = "";
    if (!key.value) return;
    try {
      const result = readSavedTaskViews(localStorage, key.value);
      views.value = result.views;
      error.value = result.error;
    } catch {
      error.value = "Saved filters could not be read in this browser.";
    }
  },
  { immediate: true, flush: "sync" },
);
function reloadViews() {
  if (!key.value) return;
  try {
    const result = readSavedTaskViews(localStorage, key.value);
    views.value = result.views;
    error.value = result.error;
    notice.value = "";
    if (!views.value.some((view) => view.id === selected.value))
      selected.value = "";
  } catch {
    error.value = "Saved filters could not be read in this browser.";
  }
}
function mutate(change: (values: SavedTaskView[]) => SavedTaskView[]) {
  if (!key.value) return;
  error.value = notice.value = "";
  try {
    const latest = readSavedTaskViews(localStorage, key.value);
    if (latest.error) throw new Error(latest.error);
    const values = change(latest.views);
    const failure = writeSavedTaskViews(localStorage, key.value, values);
    if (failure) throw new Error(failure);
    views.value = values;
    notice.value = "Saved filters updated in this browser.";
  } catch (reason) {
    error.value = (reason as Error).message;
  }
}
function capture() {
  if (!store.user)
    throw new Error("Saved filters could not be read in this browser.");
  const presentation = readViewPreferences(
    localStorage,
    accountStorageKey("view-preferences", store.mode, store.user),
  );
  if (presentation.error) throw new Error(presentation.error);
  return captureTaskView(
    context.value,
    {
      scope: props.projectId ? "all" : "week",
      ...route.query,
      ...(fixedDate.value
        ? props.layout === "gantt"
          ? {
              ganttDate:
                route.query.ganttDate ?? zonedDay(new Date(), store.timeZone),
            }
          : { date: route.query.date ?? zonedDay(new Date(), store.timeZone) }
        : {}),
    },
    props.layout,
    fixedDate.value,
    presentation.value,
  );
}
function add() {
  mutate((values) => {
    const value = {
      id: crypto.randomUUID(),
      name: name.value.trim(),
      ...capture(),
    };
    return [...values, value];
  });
  if (!error.value) name.value = "";
}
function update(rename = false) {
  if (!current.value) return;
  const id = current.value.id;
  mutate((values) => {
    if (!values.some((value) => value.id === id))
      throw new Error(
        "This saved filter no longer exists. Reload the saved filters.",
      );
    return values.map((value) =>
      value.id === id
        ? rename
          ? { ...value, name: name.value.trim() }
          : { ...value, ...capture() }
        : value,
    );
  });
  if (!error.value && rename) name.value = "";
}
function remove() {
  if (
    !current.value ||
    !confirm(t("Delete this saved filter? Tasks will remain unchanged."))
  )
    return;
  const id = current.value.id;
  mutate((values) => values.filter((value) => value.id !== id));
  if (!error.value) selected.value = "";
}
function move(direction: -1 | 1) {
  if (!current.value) return;
  const id = current.value.id,
    visible = entries.value,
    target = visible.findIndex((value) => value.id === id) + direction;
  if (!visible[target]) return;
  const other = visible[target]!.id;
  mutate((values) => {
    const next = [...values],
      a = next.findIndex((value) => value.id === id),
      b = next.findIndex((value) => value.id === other);
    if (a >= 0 && b >= 0) [next[a], next[b]] = [next[b]!, next[a]!];
    return next;
  });
}
function apply() {
  if (!current.value || !confirmDiscard()) return;
  error.value = notice.value = "";
  try {
    const query = savedTaskViewQuery(current.value, {
      projects: store.data.projects.map((project) => project.id),
      members: (store.data.members ?? []).map((member) => member.id),
    });
    name.value = "";
    void router.push({ query, hash: "" });
  } catch (reason) {
    error.value = (reason as Error).message;
  }
}
function reset() {
  if (
    !key.value ||
    !confirm(
      t(
        "Reset saved filters for this account in this browser? Tasks will remain unchanged.",
      ),
    )
  )
    return;
  try {
    localStorage.setItem(key.value, JSON.stringify({ version: 1, views: [] }));
    views.value = [];
    selected.value = error.value = "";
  } catch {
    error.value = "Saved filters could not be read in this browser.";
  }
}
</script>
<template>
  <details class="saved-task-views">
    <summary>{{ t("Personal saved filters") }} · {{ entries.length }}</summary>
    <p>
      {{ t("Private to this account in this browser.") }}
      {{ t("At most 20 filters; names must be 1–40 characters.")
      }}<span v-if="projectId">
        {{
          t(
            "Project filters are reusable templates applied only to the current project.",
          )
        }}</span
      >
    </p>
    <form @submit.prevent="add">
      <label
        >{{ t("Filter name") }}<input v-model="name" maxlength="40" /></label
      ><label class="fixed-date"
        ><input v-model="fixedDate" type="checkbox" />{{
          t("Pin the current calendar date")
        }}</label
      ><button type="submit" :disabled="!name.trim()">
        {{ t("Save current filter") }}
      </button>
    </form>
    <label
      >{{ t("Saved filter")
      }}<select v-model="selected">
        <option value="">{{ t("Choose a saved filter") }}</option>
        <option v-for="view in entries" :key="view.id" :value="view.id">
          {{ view.name }}
        </option>
      </select></label
    >
    <div class="saved-actions">
      <button :disabled="!current" @click="apply">
        {{ t("Apply filter") }}</button
      ><button :disabled="!current" @click="update()">
        {{ t("Overwrite with current rules") }}</button
      ><button :disabled="!current || !name.trim()" @click="update(true)">
        {{ t("Rename filter") }}</button
      ><button :disabled="!current" @click="move(-1)">{{ t("Move up") }}</button
      ><button :disabled="!current" @click="move(1)">
        {{ t("Move down") }}</button
      ><button :disabled="!current" @click="remove">
        {{ t("Delete saved filter") }}
      </button>
    </div>
    <p v-if="current">
      {{
        current.anchorMode === "relative"
          ? t(
              "Calendar date follows today; relative work scopes stay relative.",
            )
          : t("Calendar date is fixed in this saved filter.")
      }}
    </p>
    <p v-if="notice" role="status">{{ t(notice) }}</p>
    <div v-if="error" class="error-box" role="alert">
      {{ t(error)
      }}<button @click="reloadViews">{{ t("Reload saved filters") }}</button
      ><button
        v-if="
          error ===
          'Saved filters are invalid or use a newer version. Your stored data has been preserved.'
        "
        @click="reset"
      >
        {{ t("Reset saved filters") }}
      </button>
    </div>
  </details>
</template>
<style scoped>
.saved-task-views {
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
summary {
  cursor: pointer;
  min-height: 44px;
  display: flex;
  align-items: center;
}
form,
.saved-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin: 8px 0;
}
label {
  font-size: 12px;
}
input,
select,
button {
  min-height: 44px;
}
input[type="checkbox"] {
  min-height: 18px;
  width: 18px;
}
.fixed-date {
  display: flex;
  gap: 6px;
  align-items: center;
}
p {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}
.saved-actions button {
  font-size: 12px;
}
select {
  max-width: 100%;
}
</style>
