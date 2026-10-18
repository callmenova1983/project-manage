<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Task } from "../../../../packages/domain/types";
import { planTaskSchedules } from "../../../../packages/domain/task-schedule-write";
import { validateTaskSchedule } from "../../../../packages/domain/task-schedule";
import {
  planTaskDependencies,
  taskDependencyWarnings,
} from "../../../../packages/domain/task-dependencies";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved } from "../composables/unsaved";
import { t, formatDate, formatNumber } from "../locales";
import type { ApiError } from "../services/contracts";
import WorkspaceDialog from "./WorkspaceDialog.vue";
import SaveError from "./SaveError.vue";

const props = defineProps<{
  task: Task;
  mode: "schedule" | "dependencies";
  initialSchedule?: {
    scheduleStart: string | null;
    scheduleEnd: string | null;
    milestone: boolean;
  };
}>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspace();
const original = ref({ ...props.task });
const start = ref(
  (props.initialSchedule
    ? props.initialSchedule.scheduleStart
    : original.value.scheduleStart) ?? "",
);
const end = ref(
  (props.initialSchedule
    ? props.initialSchedule.scheduleEnd
    : original.value.scheduleEnd) ?? "",
);
const milestone = ref(
  props.initialSchedule
    ? props.initialSchedule.milestone
    : !!original.value.milestone,
);
const selected = ref(
  (original.value.dependencies ?? []).map((edge) => edge.taskId),
);
const search = ref("");
const error = ref<Error | null>(null);
const title = computed(() =>
  t(props.mode === "schedule" ? "Edit schedule" : "Edit predecessors"),
);
const key = () =>
  JSON.stringify(
    props.mode === "schedule"
      ? [start.value, end.value, milestone.value]
      : [...selected.value].sort(),
  );
const initial = ref(
  props.mode === "schedule"
    ? JSON.stringify([
        original.value.scheduleStart ?? "",
        original.value.scheduleEnd ?? "",
        !!original.value.milestone,
      ])
    : key(),
);
const dirty = computed(() => initial.value !== key());
const mayDiscard = useUnsaved(dirty);
const parents = computed(
  () => new Set(store.data.tasks.map((task) => task.parentId).filter(Boolean)),
);
const candidates = computed(() =>
  store.data.tasks.filter(
    (task) =>
      task.projectId === original.value.projectId &&
      task.id !== original.value.id &&
      !parents.value.has(task.id) &&
      (!task.voided || selected.value.includes(task.id)) &&
      (!search.value.trim() ||
        task.title
          .toLocaleLowerCase()
          .includes(search.value.trim().toLocaleLowerCase())),
  ),
);
const selectedTasks = computed(() =>
  selected.value.map((id) => store.data.tasks.find((task) => task.id === id)),
);
const preview = computed(() => {
  const patch = {
    scheduleStart: start.value || null,
    scheduleEnd: end.value || null,
    milestone: milestone.value,
  };
  const dependencies = selected.value.map((taskId) => ({
    taskId,
    type: "finish_to_start" as const,
  }));
  const tasks = store.data.tasks.map((task) =>
    task.id === original.value.id
      ? { ...task, ...(props.mode === "schedule" ? patch : { dependencies }) }
      : task,
  );
  try {
    if (props.mode === "schedule") validateTaskSchedule(patch);
    return {
      warnings: taskDependencyWarnings(tasks).filter(
        (warning) =>
          warning.taskId === original.value.id ||
          warning.predecessorId === original.value.id,
      ),
      error: "",
    };
  } catch (reason) {
    return { warnings: [], error: (reason as Error).message };
  }
});
const taskTitle = (id: string) =>
  store.data.tasks.find((task) => task.id === id)?.title ?? t("Previous task");
function close() {
  if (!store.busy && mayDiscard()) emit("close");
}
function clearSchedule() {
  start.value = "";
  end.value = "";
  milestone.value = false;
}
function remove(id: string) {
  selected.value = selected.value.filter((value) => value !== id);
}
async function reload() {
  if (store.busy || !mayDiscard()) return;
  const returned = (error.value as ApiError | null)?.current;
  const task =
    returned && "projectId" in returned && returned.id === original.value.id
      ? returned
      : store.data.tasks.find((task) => task.id === original.value.id);
  if (!task || task.voided || task.projectId !== original.value.projectId) {
    error.value = new Error("Task unavailable. Refresh or return to the list.");
    return;
  }
  original.value = { ...task };
  start.value = task.scheduleStart ?? "";
  end.value = task.scheduleEnd ?? "";
  milestone.value = !!task.milestone;
  selected.value = (task.dependencies ?? []).map((edge) => edge.taskId);
  initial.value = key();
  error.value = null;
}
async function save() {
  if (store.busy) return;
  error.value = null;
  try {
    if (props.mode === "schedule") {
      const patch = {
        scheduleStart: start.value || null,
        scheduleEnd: end.value || null,
        milestone: milestone.value,
      };
      planTaskSchedules(store.data.tasks, [
        { id: original.value.id, version: original.value.version, ...patch },
      ]);
      await store.saveTaskSchedule(original.value, patch);
    } else {
      const dependencies = selected.value.map((taskId) => ({
        taskId,
        type: "finish_to_start" as const,
      }));
      planTaskDependencies(store.data.tasks, original.value.id, {
        version: original.value.version,
        dependencies,
      });
      await store.saveTaskDependencies(original.value, dependencies);
    }
    initial.value = key();
    emit("close");
  } catch (reason) {
    error.value = reason as Error;
  }
}
watch(
  () => store.user?.id,
  () => emit("close"),
);
</script>
<template>
  <WorkspaceDialog open :title="title" :busy="store.busy" @close="close">
    <h3>{{ original.title }}</h3>
    <p v-if="initialSchedule">
      {{
        t("Previous schedule: {start} – {end}", {
          start: original.scheduleStart
            ? formatDate(original.scheduleStart)
            : "—",
          end: original.scheduleEnd ? formatDate(original.scheduleEnd) : "—",
        })
      }}
    </p>
    <p>
      {{
        t(
          "Schedule and dependencies do not change due dates, work arrangements or task status.",
        )
      }}
    </p>
    <SaveError :error="error" @reload="reload" />
    <form @submit.prevent="save">
      <fieldset :disabled="store.busy">
        <template v-if="mode === 'schedule'">
          <label
            >{{ t("Schedule start")
            }}<input
              v-model="start"
              type="date"
              :required="!!start || !!end || milestone"
          /></label>
          <label
            >{{ t("Schedule end")
            }}<input
              v-model="end"
              type="date"
              :required="!!start || !!end || milestone"
          /></label>
          <label class="check"
            ><input v-model="milestone" type="checkbox" />{{
              t("Milestone")
            }}</label
          >
          <p>{{ t("Milestones require matching start and end dates.") }}</p>
          <button type="button" @click="clearSchedule">
            {{ t("Clear schedule") }}
          </button>
        </template>
        <template v-else>
          <p>
            {{
              t(
                "Finish-to-start: the successor starts on the day after its predecessor ends.",
              )
            }}
          </p>
          <h4>
            {{
              t("Selected predecessors ({count})", {
                count: formatNumber(selected.length),
              })
            }}
          </h4>
          <ul class="selected">
            <li
              v-for="(selectedTask, index) in selectedTasks"
              :key="selected[index]"
            >
              <span
                >{{ selectedTask?.title ?? t("Previous task")
                }}<small v-if="selectedTask?.voided">
                  · {{ t("Voided task") }}</small
                ></span
              >
              <button
                type="button"
                :aria-label="
                  t('Remove predecessor {title}', {
                    title: selectedTask?.title ?? t('Previous task'),
                  })
                "
                @click="remove(selected[index]!)"
              >
                {{ t("Remove predecessor") }}
              </button>
            </li>
          </ul>
          <button v-if="selected.length" type="button" @click="selected = []">
            {{ t("Clear predecessors") }}
          </button>
          <label
            >{{ t("Search tasks") }}<input v-model="search" type="search"
          /></label>
          <div class="candidates">
            <label
              v-for="candidate in candidates"
              :key="candidate.id"
              class="check"
            >
              <input
                v-model="selected"
                type="checkbox"
                :value="candidate.id"
                :disabled="
                  (!selected.includes(candidate.id) &&
                    selected.length >= 100) ||
                  !!candidate.voided
                "
              />
              <span
                >{{ candidate.title
                }}<small v-if="candidate.voided">
                  · {{ t("Voided task") }}</small
                ></span
              >
            </label>
          </div>
          <p v-if="!candidates.length">{{ t("No matching tasks") }}</p>
        </template>
      </fieldset>
      <p v-if="preview.error" class="error-box" role="alert">
        {{ t(preview.error) }}
      </p>
      <ul v-if="preview.warnings.length" class="warnings" aria-live="polite">
        <li
          v-for="warning in preview.warnings"
          :key="`${warning.taskId}:${warning.predecessorId}`"
        >
          {{ taskTitle(warning.taskId) }} ←
          {{ taskTitle(warning.predecessorId) }}:
          {{
            t(
              warning.kind === "voided"
                ? "Predecessor voided; action required."
                : warning.kind === "unscheduled"
                  ? "A linked task is not scheduled."
                  : "Schedule conflicts with predecessor.",
            )
          }}
          <span v-if="warning.earliestStart">{{
            t("Earliest start: {date}", {
              date: formatDate(warning.earliestStart),
            })
          }}</span>
        </li>
      </ul>
      <div class="form-actions">
        <button type="button" :disabled="store.busy" @click="close">
          {{ t("Cancel") }}
        </button>
        <button
          type="submit"
          class="primary"
          :disabled="store.busy || !dirty || !!preview.error"
        >
          {{ t(store.busy ? "Saving…" : "Save") }}
        </button>
      </div>
    </form>
  </WorkspaceDialog>
</template>
<style scoped>
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
  display: grid;
  gap: 12px;
}
fieldset > label:not(.check) {
  display: grid;
  gap: 6px;
}
.check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  overflow-wrap: anywhere;
}
.check input {
  flex: none;
}
.candidates {
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--border);
  padding: 8px;
  border-radius: 8px;
}
.selected {
  padding: 0;
  list-style: none;
}
.selected li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}
.selected span,
h3,
.warnings {
  overflow-wrap: anywhere;
}
.warnings {
  padding: 12px 12px 12px 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
</style>
