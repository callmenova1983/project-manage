<script setup lang="ts">
import {
  useTaskViewMemory,
  useTaskViewScroll,
} from "../composables/task-view-memory";
useTaskViewScroll("list:page");
import { computed, ref, watch } from "vue";
import { isNavigationFailure, useRoute, useRouter } from "vue-router";
import {
  readTaskListPresentation,
  taskListPresentationQuery,
  type TaskListPresentation,
} from "../services/task-list-presentation";
import {
  taskListGroups,
  type TaskListGroup,
  type TaskListSort,
} from "../../../../packages/domain/task-list-view";
import type { Task } from "../../../../packages/domain/types";
import { useViewPreferences } from "../composables/view-preferences";
import { confirmDiscard } from "../composables/unsaved";
import { useWorkspace } from "../stores/workspace";
import { statusLabels } from "../locales/en";
import { t, formatNumber } from "../locales";
import TaskList from "./TaskList.vue";
import TaskQuickAdd from "./TaskQuickAdd.vue";
const props = defineProps<{
  tasks: Task[];
  contextTasks?: Task[];
  projectId?: string;
  showProject?: boolean;
  compactControls?: boolean;
  settingsTarget?: HTMLElement | null;
}>();
const store = useWorkspace();
const route = useRoute(),
  router = useRouter();
const { preferences, error, save } = useViewPreferences();
const presentation = computed(() =>
  readTaskListPresentation(route.query, preferences.value),
);
const group = computed(() => presentation.value.value.taskGroup);
const sort = computed(() => presentation.value.value.taskSort);
const columns = computed(() => presentation.value.value.taskColumns);
const density = computed(() => presentation.value.value.density);
const navigationError = ref("");
async function updatePresentation(patch: Partial<TaskListPresentation>) {
  navigationError.value = "";
  try {
    const owner = JSON.stringify([
      store.mode,
      store.user?.workspaceId,
      store.user?.id,
    ]);
    const next = { ...presentation.value.value, ...patch };
    const failure = await router.replace({
      query: { ...route.query, ...taskListPresentationQuery(next) },
      hash: route.hash,
    });
    if (isNavigationFailure(failure)) return false;
    if (
      owner !==
      JSON.stringify([store.mode, store.user?.workspaceId, store.user?.id])
    )
      return false;
    save(patch);
    return true;
  } catch {
    navigationError.value = "List display settings could not be applied.";
    return false;
  }
}
const columnLabels = {
  status: "Status",
  project: "Project",
  assignee: "Assignee",
  dueDate: "Due date",
  work: "Work arrangement",
};
async function changeColumn(column: keyof typeof columnLabels, event: Event) {
  const input = event.target as HTMLInputElement;
  const next = input.checked
    ? [...new Set([...columns.value, column])]
    : columns.value.filter((value) => value !== column);
  if (!(await updatePresentation({ taskColumns: next })))
    input.checked = columns.value.includes(column);
}
async function changeDensity(event: Event) {
  const input = event.target as HTMLSelectElement;
  if (
    !(await updatePresentation({
      density: input.value === "compact" ? "compact" : "comfortable",
    }))
  )
    input.value = density.value;
}
const collapsed = useTaskViewMemory(
  "list:collapsed-groups",
  () => new Set<string>(),
);
const adding = ref(false);
watch(group, () => {
  collapsed.value = new Set();
});
const groups = computed(() =>
  taskListGroups(props.tasks, group.value, sort.value),
);
const treeRows = computed(
  () =>
    taskListGroups(
      [...(props.contextTasks ?? []), ...props.tasks],
      "none",
      sort.value,
    )[0]?.tasks ?? [],
);
function groupLabel(key: string) {
  if (group.value === "project")
    return (
      store.data.projects.find((project) => project.id === key)?.name ??
      t("Project unavailable")
    );
  if (group.value === "status")
    return t(statusLabels[key as keyof typeof statusLabels] ?? key);
  if (key === "none") return t("Unassigned");
  if (key.startsWith("member:")) {
    const member = store.data.members?.find(
      (member) => member.id === key.slice(7),
    );
    return member
      ? `${member.name} · ${member.email}`
      : t("Unavailable assignee filter");
  }
  return key.startsWith("text:")
    ? `${key.slice(5)} · ${t("Unlinked identity")}`
    : key;
}
async function change(event: Event, field: "taskGroup" | "taskSort") {
  const input = event.target as HTMLSelectElement;
  const patch =
    field === "taskGroup"
      ? { taskGroup: input.value as TaskListGroup }
      : { taskSort: input.value as TaskListSort };
  if (!(await updatePresentation(patch)))
    input.value = field === "taskGroup" ? group.value : sort.value;
}
function toggle(key: string) {
  if (!confirmDiscard()) return;
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsed.value = next;
}
</script>
<template>
  <div class="task-collection-list">
    <Teleport
      v-if="!compactControls || settingsTarget"
      :to="settingsTarget || 'body'"
      :disabled="!settingsTarget"
    >
      <div class="collection-settings" :class="{ compact: compactControls }">
        <div class="list-options">
          <label
            >{{ t("Group tasks")
            }}<select
              :value="group"
              :aria-label="t('Group tasks')"
              @change="change($event, 'taskGroup')"
            >
              <option value="none">{{ t("No grouping") }}</option>
              <option value="project">{{ t("Project") }}</option>
              <option value="assignee">{{ t("Assignee") }}</option>
              <option value="status">{{ t("Status") }}</option>
            </select></label
          ><label
            >{{ t("Sort tasks")
            }}<select
              :value="sort"
              :aria-label="t('Sort tasks')"
              @change="change($event, 'taskSort')"
            >
              <option value="manual">{{ t("Original order") }}</option>
              <option value="due">{{ t("Due date") }}</option>
              <option value="updated">{{ t("Recently updated") }}</option>
              <option value="title">{{ t("Task title") }}</option>
            </select></label
          >
        </div>
        <details class="column-options" :open="compactControls">
          <summary>{{ t("Columns and density") }}</summary>
          <label
            >{{ t("Row density")
            }}<select :value="density" @change="changeDensity">
              <option value="comfortable">{{ t("Comfortable") }}</option>
              <option value="compact">{{ t("Compact") }}</option>
            </select></label
          ><label
            v-for="(label, column) in columnLabels"
            :key="column"
            v-show="column !== 'project' || showProject"
            class="column-toggle"
            ><input
              type="checkbox"
              :checked="columns.includes(column)"
              @change="changeColumn(column, $event)"
            />{{ t(label) }}</label
          >
          <p>{{ t("Task title and detail actions always remain visible.") }}</p>
        </details>
      </div>
    </Teleport>
    <button
      v-if="!compactControls && projectId && group !== 'none' && !adding"
      @click="confirmDiscard() && (adding = true)"
    >
      {{ t("New task") }}
    </button>
    <TaskQuickAdd
      v-if="projectId && adding"
      :project-id="projectId"
      @close="adding = false"
    />
    <p
      v-if="error || presentation.error || navigationError"
      class="error-box"
      role="alert"
    >
      {{ t(error || presentation.error || navigationError) }}
    </p>
    <slot v-if="!tasks.length && $slots.empty" name="empty" />
    <p
      v-if="tasks.length && (sort !== 'manual' || group !== 'none')"
      class="drag-mode-hint"
    >
      <button
        class="text-button"
        @click="
          confirmDiscard() &&
          updatePresentation({ taskGroup: 'none', taskSort: 'manual' })
        "
      >
        {{ t("Enable task dragging") }}
      </button>
      <span>{{ t("Dragging uses no grouping and original order.") }}</span>
    </p>
    <TaskList
      v-if="group === 'none' && (tasks.length || !$slots.empty)"
      :tasks="treeRows"
      :workspace="compactControls"
      :can-move="sort === 'manual' && group === 'none'"
      :columns="columns"
      :density="density"
      :project-id="projectId"
      :show-project="showProject"
      :show-parent-path="!projectId"
    />
    <template v-else-if="tasks.length"
      ><section v-for="entry in groups" :key="entry.key" class="task-group">
        <h3>
          <button
            :aria-expanded="!collapsed.has(entry.key)"
            @click="toggle(entry.key)"
          >
            {{ groupLabel(entry.key) }} · {{ formatNumber(entry.tasks.length) }}
          </button>
        </h3>
        <TaskList
          v-if="!collapsed.has(entry.key)"
          :tasks="entry.tasks"
          :workspace="compactControls"
          :can-move="false"
          :project-id="projectId"
          :hide-add="compactControls"
          :columns="columns"
          :density="density"
          :show-project="showProject"
          show-parent-path
        />
      </section>
      <p v-if="!groups.length" class="empty compact">
        {{ t("No tasks here yet") }}
      </p></template
    >
  </div>
</template>
<style scoped>
.drag-mode-hint {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 12px;
  color: var(--muted);
}
.collection-settings {
  display: grid;
  gap: 12px;
}
.collection-settings.compact .list-options {
  display: grid;
  gap: 12px;
  margin-top: 0;
}
.collection-settings.compact .list-options label {
  display: grid;
  gap: 6px;
}
.column-options {
  margin: 8px 0;
  font-size: 12px;
}
.column-options summary,
.column-toggle {
  flex-direction: row;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.column-options summary {
  cursor: pointer;
}
.column-options select {
  min-height: 44px;
  width: auto;
}
.column-options .column-toggle {
  display: inline-flex;
  width: 48%;
  min-height: 44px;
  vertical-align: top;
}
.column-toggle input {
  width: 18px;
  height: 18px;
}
.list-options,
.list-options label {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
}
.list-options {
  margin: 12px 0;
}
.list-options select,
.task-group h3 button {
  min-height: 44px;
}
.task-group {
  margin: 16px 0;
}
.task-group h3 {
  font-size: 14px;
  margin: 0 0 6px;
}
</style>
