<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  taskBulkUpdateInput,
  planTaskBulkUpdate,
  TaskBulkConflict,
  type TaskBulkUpdate,
} from "../../../../packages/domain/task-bulk-update";
import { statuses, type Task } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved } from "../composables/unsaved";
import { ApiError } from "../services/contracts";
import { t, formatDate, formatNumber } from "../locales";
import { statusLabels } from "../locales/en";
import WorkspaceDialog from "./WorkspaceDialog.vue";
import MemberAssignment from "./MemberAssignment.vue";
import SaveError from "./SaveError.vue";
import { selectBulkPage } from "../services/task-bulk-selection";
const props = defineProps<{
  tasks: Task[];
  initialField?: "status" | "assignee" | "dueDate";
}>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspace();
const parentIds = new Set(
  store.data.tasks.map((task) => task.parentId).filter(Boolean),
);
const scope = ref(
  props.tasks
    .filter((task) => !task.voided && !parentIds.has(task.id))
    .map((task) => ({ ...task })),
);
const selected = ref<Task[]>([]),
  search = ref(""),
  page = ref(0);
const field = ref<"status" | "assignee" | "dueDate">(
    props.initialField ?? "status",
  ),
  status = ref<Task["status"] | "">("");
const assignee = ref(""),
  assigneeId = ref<string | null>(null),
  date = ref(""),
  clearAssignee = ref(false),
  clearDate = ref(false);
const confirmed = ref(false),
  error = ref<Error | null>(null),
  result = ref<Task[] | null>(null),
  reloading = ref(false);
const filtered = computed(() =>
  scope.value.filter(
    (task) =>
      !search.value.trim() ||
      task.title
        .toLocaleLowerCase()
        .includes(search.value.trim().toLocaleLowerCase()),
  ),
);
const pages = computed(() =>
  Math.max(1, Math.ceil(filtered.value.length / 25)),
);
const rows = computed(() =>
  filtered.value.slice(page.value * 25, (page.value + 1) * 25),
);
const selectedIds = computed(
  () => new Set(selected.value.map((task) => task.id)),
);
const pageExtra = computed(
  () => rows.value.filter((task) => !selectedIds.value.has(task.id)).length,
);
function toggle(task: Task, checked: boolean) {
  if (checked && !selectedIds.value.has(task.id) && selected.value.length < 100)
    selected.value = selectBulkPage(selected.value, [task]);
  else if (!checked)
    selected.value = selected.value.filter((row) => row.id !== task.id);
}
function selectPage() {
  if (selected.value.length + pageExtra.value <= 100)
    selected.value = selectBulkPage(selected.value, rows.value);
}
const input = computed<TaskBulkUpdate | null>(() => {
  if (!selected.value.length) return null;
  let change: TaskBulkUpdate["change"];
  if (field.value === "status") {
    if (!status.value) return null;
    change = { field: "status", value: status.value };
  } else if (field.value === "assignee") {
    if (!clearAssignee.value && !assigneeId.value && !assignee.value.trim())
      return null;
    change = {
      field: "assignee",
      value: clearAssignee.value
        ? { assigneeId: null, assignee: "" }
        : { assigneeId: assigneeId.value, assignee: assignee.value },
    };
  } else {
    if (!clearDate.value && !date.value) return null;
    change = { field: "dueDate", value: clearDate.value ? null : date.value };
  }
  return {
    targets: selected.value.map((task) => ({
      id: task.id,
      version: task.version,
    })),
    change,
  };
});
const preview = computed(() => {
  if (!input.value) return { changes: [], error: null };
  const parsed = taskBulkUpdateInput.safeParse(input.value);
  if (!parsed.success)
    return { changes: [], error: new Error("Choose a valid bulk value.") };
  try {
    return {
      ...planTaskBulkUpdate(
        store.data.tasks,
        store.data.members ?? [],
        parsed.data,
      ),
      error: null,
    };
  } catch (reason) {
    return {
      changes: [],
      error:
        reason instanceof TaskBulkConflict
          ? new ApiError(
              reason.message,
              409,
              undefined,
              undefined,
              undefined,
              reason.conflicts,
            )
          : (reason as Error),
    };
  }
});
const dirty = computed(() => !result.value && selected.value.length > 0);
const mayDiscard = useUnsaved(dirty);
watch(search, () => (page.value = 0));
watch(
  () => JSON.stringify(input.value),
  () => {
    confirmed.value = false;
    error.value = null;
  },
);
watch(
  () => store.user?.id,
  () => emit("close"),
);
function close() {
  if (!store.busy && !reloading.value && mayDiscard()) emit("close");
}
async function reloadSelected() {
  reloading.value = true;
  try {
    if (!(await store.refresh()))
      throw new Error("Could not reload tasks. Please retry.");
    const current = new Map(store.data.tasks.map((task) => [task.id, task]));
    selected.value = selected.value.map((task) => ({
      ...(current.get(task.id) ?? task),
    }));
    scope.value = scope.value.map((task) => ({
      ...(current.get(task.id) ?? task),
    }));
    confirmed.value = false;
    error.value = null;
  } catch (reason) {
    error.value = reason as Error;
  } finally {
    reloading.value = false;
  }
}
async function save() {
  if (
    !input.value ||
    !confirmed.value ||
    preview.value.error ||
    store.busy ||
    reloading.value
  )
    return;
  try {
    result.value = await store.bulkUpdateTasks(input.value);
    error.value = null;
  } catch (reason) {
    error.value = reason as Error;
  }
}
const projectName = (id: string) =>
  store.data.projects.find((project) => project.id === id)?.name ??
  t("Previous project");
function valueFor(task: Task) {
  return field.value === "status"
    ? t(statusLabels[task.status])
    : field.value === "assignee"
      ? task.assignee || t("Unassigned")
      : task.dueDate
        ? formatDate(task.dueDate)
        : t("No due date");
}
function historyLink(task: Task) {
  const activity = store.data.activities.find(
    (activity) =>
      activity.entityId === task.id &&
      activity.after?.version === task.version &&
      activity.action === "Bulk updated task",
  );
  return {
    path: "/activity",
    query: {
      project: task.projectId,
      q: Array.from(task.title).slice(0, 100).join(""),
      real: "1",
    },
    hash: activity ? `#activity-${activity.id}` : undefined,
  };
}
</script>
<template>
  <WorkspaceDialog
    open
    :title="t('Bulk edit tasks')"
    :busy="store.busy || reloading"
    @close="close"
  >
    <template v-if="result">
      <p role="status">
        {{
          t("Confirmed {count} selected tasks.", {
            count: formatNumber(result.length),
          })
        }}
      </p>
      <p>
        {{
          t(
            "Restore items individually from activity; this is not an atomic batch undo.",
          )
        }}
      </p>
      <ul class="bulk-results">
        <li v-for="task in result" :key="task.id" class="bulk-result">
          <span>{{ task.title }} · {{ valueFor(task) }}</span>
          <span
            v-if="
              task.version ===
              selected.find((row) => row.id === task.id)?.version
            "
            >{{ t("Unchanged") }}</span
          >
          <RouterLink :to="historyLink(task)">{{
            t("Review item history")
          }}</RouterLink>
        </li>
      </ul>
      <button type="button" class="primary" @click="close">
        {{ t("Close") }}
      </button>
    </template>
    <template v-else>
      <p>
        {{
          t(
            "Select up to 100 active leaf tasks. Page selection never selects the whole query.",
          )
        }}
      </p>
      <p role="status">
        {{
          t("{count} tasks in opening scope · {selected} selected", {
            count: formatNumber(scope.length),
            selected: formatNumber(selected.length),
          })
        }}
      </p>
      <SaveError
        :error="error ?? preview.error"
        :task-labels="
          Object.fromEntries(selected.map((task) => [task.id, task.title]))
        "
      />
      <button
        v-if="error || preview.error"
        type="button"
        :disabled="store.busy || reloading"
        @click="reloadSelected"
      >
        {{ t("Reload selected task versions") }}
      </button>
      <fieldset :disabled="store.busy || reloading">
        <label
          >{{ t("Search tasks") }}<input v-model="search" type="search"
        /></label>
        <div class="bulk-page-actions">
          <button
            type="button"
            :disabled="selected.length + pageExtra > 100"
            @click="selectPage"
          >
            {{ t("Select this page") }} ({{
              formatNumber(rows.length)
            }})</button
          ><button type="button" @click="selected = []">
            {{ t("Clear selection") }}</button
          ><button
            type="button"
            :aria-label="t('Previous page')"
            :disabled="page === 0"
            @click="page--"
          >
            ←</button
          ><span>{{ formatNumber(page + 1) }}/{{ formatNumber(pages) }}</span
          ><button
            type="button"
            :aria-label="t('Next page')"
            :disabled="page + 1 >= pages"
            @click="page++"
          >
            →
          </button>
        </div>
        <div class="bulk-task-options">
          <label v-for="task in rows" :key="task.id" class="bulk-check"
            ><input
              type="checkbox"
              :checked="selectedIds.has(task.id)"
              :disabled="!selectedIds.has(task.id) && selected.length >= 100"
              @change="
                toggle(task, ($event.target as HTMLInputElement).checked)
              "
            /><span
              >{{ task.title
              }}<small
                >{{ projectName(task.projectId) }} · {{ valueFor(task) }}</small
              ></span
            ></label
          >
        </div>
        <p v-if="!rows.length">{{ t("No matching tasks") }}</p>
        <details v-if="selected.length">
          <summary>
            {{ t("Review selected tasks") }} ({{
              formatNumber(selected.length)
            }})
          </summary>
          <ul>
            <li v-for="task in selected" :key="task.id">
              {{ task.title }}
              <button type="button" @click="toggle(task, false)">
                {{ t("Remove from selection") }}
              </button>
            </li>
          </ul>
        </details>
        <label
          >{{ t("Field to replace")
          }}<select v-model="field">
            <option value="status">{{ t("Status") }}</option>
            <option value="assignee">{{ t("Assignee") }}</option>
            <option value="dueDate">{{ t("Due date") }}</option>
          </select></label
        >
        <label v-if="field === 'status'"
          >{{ t("New status")
          }}<select v-model="status">
            <option value="" disabled>{{ t("Choose a new status") }}</option>
            <option v-for="value in statuses" :key="value" :value="value">
              {{ t(statusLabels[value]) }}
            </option>
          </select></label
        >
        <template v-else-if="field === 'assignee'"
          ><label class="bulk-check"
            ><input v-model="clearAssignee" type="checkbox" />{{
              t("Explicitly clear assignees and account links")
            }}</label
          ><MemberAssignment
            v-if="!clearAssignee"
            v-model="assignee"
            v-model:member-id="assigneeId"
            label="Assignee"
        /></template>
        <template v-else
          ><label class="bulk-check"
            ><input v-model="clearDate" type="checkbox" />{{
              t("Explicitly clear due dates")
            }}</label
          ><label v-if="!clearDate"
            >{{ t("New due date") }}<input v-model="date" type="date" /></label
        ></template>
        <p>
          {{
            t(
              "{count} tasks will change; other selected tasks keep their saved versions.",
              { count: formatNumber(preview.changes.length) },
            )
          }}
        </p>
        <label class="bulk-check"
          ><input v-model="confirmed" type="checkbox" />{{
            t("I confirm replacing this field on the selected tasks.")
          }}</label
        >
      </fieldset>
      <div class="form-actions">
        <button
          type="button"
          :disabled="store.busy || reloading"
          @click="close"
        >
          {{ t("Cancel") }}</button
        ><button
          type="button"
          class="primary"
          :disabled="
            !confirmed ||
            !input ||
            !!preview.error ||
            !preview.changes.length ||
            store.busy ||
            reloading
          "
          @click="save"
        >
          {{ t(store.busy ? "Saving…" : "Apply selected changes") }}
        </button>
      </div>
    </template>
  </WorkspaceDialog>
</template>
<style scoped>
fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
  display: grid;
  gap: 12px;
}
.bulk-check {
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: center;
  min-height: 44px;
  overflow-wrap: anywhere;
}
.bulk-check input {
  flex: none;
}
.bulk-task-options {
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
}
small {
  display: block;
  color: var(--muted);
}
.bulk-page-actions,
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.form-actions {
  justify-content: flex-end;
  margin-top: 16px;
}
li {
  padding: 6px 0;
  overflow-wrap: anywhere;
}
.bulk-results {
  list-style: none;
  padding: 0;
}
.bulk-result {
  display: grid;
  gap: 6px;
  border-bottom: 1px solid var(--border);
  padding: 12px 0;
}
</style>
