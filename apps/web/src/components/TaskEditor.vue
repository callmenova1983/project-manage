<script setup lang="ts">
import {
  currentDay,
  currentWeek,
  useCalendarNow,
} from "../composables/calendar";
import {
  weekBounds,
  reminderLocalInput,
  editedReminderInstant,
} from "../../../../packages/domain/time-zone";
import type { TaskDatePrefill } from "../../../../packages/domain/task-calendar";
import {
  moveTaskWorkWeek,
  setTaskWorkDay,
} from "../../../../packages/domain/task-planning";
import { t, formatDate } from "../locales";
import { computed, ref, watch } from "vue";
import {
  taskInput,
  statuses,
  type Task,
  type TaskInput,
} from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { statusLabels } from "../locales/en";
import { useUnsaved } from "../composables/unsaved";
import SaveError from "./SaveError.vue";
import TaskPlanningImpact from "./TaskPlanningImpact.vue";
import { taskPlanningImpact } from "../../../../packages/domain/task-planning-impact";
import MemberAssignment from "./MemberAssignment.vue";
import EditorDraftNotice from "./EditorDraftNotice.vue";
import { useEditorDraft } from "../composables/editor-draft";
import { taskEditorDraft } from "../services/editor-drafts";
import { ApiError } from "../services/api";
const props = withDefaults(
  defineProps<{
    task?: Task;
    projectId: string;
    parentId?: string;
    initialTitle?: string;
    initialDates?: TaskDatePrefill;
    progressive?: boolean;
  }>(),
  {
    task: undefined,
    parentId: undefined,
    initialTitle: undefined,
    initialDates: undefined,
    progressive: false,
  },
);
const emit = defineEmits<{ close: []; saved: [Task] }>();
const store = useWorkspace();
const now = useCalendarNow();
const original = ref(props.task);
const draft = ref<TaskInput>(
  props.task
    ? taskInput.strip().parse(props.task)
    : {
        projectId: props.projectId,
        parentId: props.parentId ?? null,
        title: props.initialTitle ?? "",
        description: "",
        status: "todo",
        assignee: "",
        dueDate: null,
        workWeek: currentWeek(),
        workDates: [],
        ...props.initialDates,
      },
);
const reminderZone = store.timeZone;
const reminderLocal = ref(
  draft.value.reminderAt
    ? reminderLocalInput(draft.value.reminderAt, reminderZone)
    : "",
);
function hasAdvancedValues(value: TaskInput) {
  return !!(
    value.status !== "todo" ||
    value.estimatedDate ||
    value.reminderAt ||
    value.workDates.length ||
    (value.workWeek && value.workWeek !== currentWeek(now.value))
  );
}
const advancedOpen = ref(hasAdvancedValues(draft.value));
const advancedSummary = computed(() => {
  const details: string[] = [];
  if (draft.value.status !== "todo")
    details.push(t(statusLabels[draft.value.status]));
  if (draft.value.estimatedDate)
    details.push(
      `${t("Estimated date")}: ${formatDate(draft.value.estimatedDate)}`,
    );
  if (reminderLocal.value)
    details.push(
      `${t("Reminder")}: ${reminderLocal.value.replace("T", " ")} (${reminderZone})`,
    );
  if (draft.value.workDates.length)
    details.push(
      `${t("Work dates")}: ${draft.value.workDates
        .map((date) => formatDate(date, { month: "short", day: "numeric" }))
        .join(" · ")}`,
    );
  else if (
    draft.value.workWeek &&
    draft.value.workWeek !== currentWeek(now.value)
  )
    details.push(`${t("Work week")}: ${formatDate(draft.value.workWeek)}`);
  return details.join(" / ");
});
watch(
  () => draft.value.reminderAt,
  (value) => {
    reminderLocal.value = value ? reminderLocalInput(value, reminderZone) : "";
  },
);
let baseline = JSON.stringify(draft.value);
const dirty = computed(
  () =>
    JSON.stringify(draft.value) !== baseline ||
    reminderLocal.value !==
      (draft.value.reminderAt
        ? reminderLocalInput(draft.value.reminderAt, reminderZone)
        : ""),
);
const creationVersion = props.parentId
  ? store.data.tasks.find((t) => t.id === props.parentId)?.version
  : store.data.projects.find((p) => p.id === props.projectId)?.version;
const persisted = useEditorDraft({
  kind: "task",
  projectId: props.projectId,
  entityId: props.task?.id ?? "",
  parentId: props.parentId,
  schema: taskEditorDraft,
  value: draft,
  dirty,
  baseVersion: () => original.value?.version ?? creationVersion ?? null,
  currentVersion: () =>
    props.task
      ? store.data.tasks.find((t) => t.id === props.task!.id)?.version
      : props.parentId
        ? store.data.tasks.find(
            (t) => t.id === props.parentId && t.projectId === props.projectId,
          )?.version
        : store.data.projects.find((p) => p.id === props.projectId)?.version,
  restore(value) {
    if (props.task)
      original.value = store.data.tasks.find((t) => t.id === props.task!.id);
    draft.value = value;
    advancedOpen.value = hasAdvancedValues(value);
  },
});
const initial = JSON.stringify(draft.value);
const mayDiscard = useUnsaved(dirty, () =>
  t("Leave this editor? Unsubmitted drafts stay in this tab for recovery."),
);
function cancel() {
  if (persisted.pending.value || (mayDiscard() && persisted.cancel()))
    emit("close");
}
function discardSavedDraft() {
  if (!persisted.discard()) return;
  original.value = props.task
    ? store.data.tasks.find((t) => t.id === props.task!.id)
    : undefined;
  draft.value = original.value
    ? taskInput.strip().parse(original.value)
    : JSON.parse(initial);
  baseline = JSON.stringify(draft.value);
  advancedOpen.value = hasAdvancedValues(draft.value);
  error.value = null;
}
const error = ref<Error | ApiError | null>(null);
const isParent = computed(() =>
  store.data.tasks.some((t) => t.parentId === props.task?.id),
);
const planningBlocked = computed(() =>
  original.value
    ? draft.value.projectId !== original.value.projectId &&
      taskPlanningImpact(store.data.tasks, original.value.id).blocksProjectMove
    : !!draft.value.parentId &&
      taskPlanningImpact(store.data.tasks, draft.value.parentId).blocksParent,
);
const week = computed({
  get: () => draft.value.workWeek === currentWeek(now.value),
  set: (v: boolean) => {
    Object.assign(
      draft.value,
      moveTaskWorkWeek(draft.value, v ? currentWeek(now.value) : null),
    );
  },
});
const today = computed({
  get: () => draft.value.workDates.includes(currentDay(now.value)),
  set: (v: boolean) => {
    Object.assign(
      draft.value,
      setTaskWorkDay(draft.value, currentDay(now.value), v),
    );
  },
});
const workDays = computed(() =>
  draft.value.workWeek
    ? weekBounds(draft.value.workWeek, store.timeZone).days
    : [],
);
function changeWorkWeek(event: Event) {
  const control = event.target as HTMLInputElement;
  try {
    Object.assign(
      draft.value,
      moveTaskWorkWeek(draft.value, control.value || null),
    );
    control.value = draft.value.workWeek ?? "";
  } catch (reason) {
    error.value = reason as Error;
    control.value = draft.value.workWeek ?? "";
  }
}
function changeWorkDay(date: string, event: Event) {
  Object.assign(
    draft.value,
    setTaskWorkDay(
      draft.value,
      date,
      (event.target as HTMLInputElement).checked,
    ),
  );
}
async function save() {
  if (planningBlocked.value) return;
  error.value = null;
  try {
    if (draft.value.dueDate === "") draft.value.dueDate = null;
    if (draft.value.estimatedDate === "") draft.value.estimatedDate = null;
    if (draft.value.reminderAt === "") draft.value.reminderAt = null;
    syncReminder();
    const input = taskInput.parse(draft.value);
    if (!persisted.beforeSave()) return;
    const result = await store.saveTask(input, original.value);
    baseline = JSON.stringify(draft.value);
    persisted.complete();
    emit("saved", result);
  } catch (e) {
    error.value = e as Error;
  }
}
function syncReminder() {
  draft.value.reminderAt = editedReminderInstant(
    reminderLocal.value,
    draft.value.reminderAt,
    reminderZone,
  );
}
function changeReminder() {
  try {
    syncReminder();
    error.value = null;
  } catch (reason) {
    error.value = reason as Error;
  }
}
function reload() {
  const current = (error.value as ApiError).current as Task;
  original.value = current;
  draft.value = taskInput.strip().parse(current);
  advancedOpen.value = hasAdvancedValues(draft.value);
  baseline = JSON.stringify(draft.value);
  error.value = null;
  persisted.discard();
}
</script>
<template>
  <form
    class="editor task-editor"
    :class="{ progressive }"
    :aria-label="t('Task editor')"
    @submit.prevent="save"
  >
    <div v-if="!progressive || dirty" class="section-heading">
      <h3 v-if="!progressive">
        {{ t(task ? "Edit task" : parentId ? "New subtask" : "New task") }}
      </h3>
      <span v-if="dirty" class="muted">{{ t("Unsaved changes") }}</span>
    </div>
    <SaveError :error="error" @reload="reload" />
    <TaskPlanningImpact
      v-if="!original && draft.parentId"
      :task-id="draft.parentId"
      mode="parent"
    />
    <TaskPlanningImpact
      v-if="original && draft.projectId !== original.projectId"
      :task-id="original.id"
      mode="project"
    />
    <EditorDraftNotice
      v-bind="persisted.notice.value"
      @restore="persisted.restore"
      @discard="discardSavedDraft"
    />
    <fieldset
      class="draft-edit-fields"
      :disabled="persisted.pending.value || store.busy"
    >
      <div class="form-grid">
        <label v-if="original && !original.parentId && !isParent" class="full">
          {{ t("Project assignment") }}
          <select
            v-model="draft.projectId"
            :aria-label="t('Project assignment')"
            aria-describedby="task-assignment-help"
          >
            <option
              v-for="project in store.data.projects"
              :key="project.id"
              :value="project.id"
            >
              {{ project.name }}
            </option>
          </select>
          <small id="task-assignment-help">{{
            t("Save now and assign this task to a project later.")
          }}</small>
        </label>
        <label class="full"
          >{{ t("Task title")
          }}<input
            v-model="draft.title"
            required
            maxlength="240"
            autofocus /></label
        ><label v-if="!progressive"
          >{{ t("Status")
          }}<select v-model="draft.status" :disabled="isParent">
            <option v-for="s in statuses" :key="s" :value="s">
              {{ t(statusLabels[s]) }}
            </option></select
          ><small v-if="isParent">{{
            t("Parent completion is calculated from subtasks.")
          }}</small></label
        >
        <MemberAssignment
          label="Assignee"
          :project-id="draft.projectId"
          v-model="draft.assignee"
          v-model:memberId="draft.assigneeId"
        />
        <label
          >{{ t("Due date") }}<input v-model="draft.dueDate" type="date"
        /></label>
        <label v-if="!progressive"
          >{{ t("预计时间")
          }}<input v-model="draft.estimatedDate" type="date" /><small>{{
            t("预估时间，不计入逾期。")
          }}</small></label
        >
        <label v-if="!progressive"
          >{{ t("Reminder") }} ({{ reminderZone }})<input
            v-model="reminderLocal"
            type="datetime-local"
            @change="changeReminder"
          /><small>{{
            t("Reminder time is independent of the due date.")
          }}</small></label
        >
        <div class="planning">
          <span>{{ t("Work scope") }}</span
          ><label class="check-label"
            ><input v-model="week" type="checkbox" />{{ t("This week") }}</label
          ><label class="check-label"
            ><input v-model="today" type="checkbox" />{{ t("Today") }}</label
          >
        </div>
        <fieldset v-if="!progressive" class="full explicit-work-plan">
          <legend>{{ t("Work dates") }}</legend>
          <label
            >{{ t("Work week")
            }}<input
              type="date"
              :value="draft.workWeek ?? ''"
              @change="changeWorkWeek"
          /></label>
          <small>{{
            t(
              "Changing the week keeps the selected weekdays. Review all dates before saving.",
            )
          }}</small>
          <div v-if="workDays.length" class="work-day-options">
            <label v-for="date in workDays" :key="date" class="check-label"
              ><input
                type="checkbox"
                :checked="draft.workDates.includes(date)"
                @change="changeWorkDay(date, $event)"
              />{{
                formatDate(date, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })
              }}</label
            >
          </div>
          <p v-else class="muted">{{ t("Not scheduled") }}</p>
          <p v-if="draft.workWeek && !draft.workDates.length" class="muted">
            {{ t("Work week selected; specific dates are not assigned.") }}
          </p>
        </fieldset>
        <label class="full"
          >{{ t("Description")
          }}<textarea
            v-model="draft.description"
            maxlength="4000"
            rows="3"
          ></textarea>
        </label>
        <details
          v-if="progressive"
          class="full task-options"
          :open="advancedOpen"
          @toggle="advancedOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary>
            {{ t("More task options") }}
            <small
              v-if="!advancedOpen && advancedSummary"
              class="options-summary"
            >
              {{ advancedSummary }}
            </small>
          </summary>
          <div class="form-grid advanced-task-fields">
            <label>
              {{ t("Status") }}
              <select v-model="draft.status" :disabled="isParent">
                <option
                  v-for="status in statuses"
                  :key="status"
                  :value="status"
                >
                  {{ t(statusLabels[status]) }}
                </option>
              </select>
              <small v-if="isParent">{{
                t("Parent completion is calculated from subtasks.")
              }}</small>
            </label>
            <label>
              {{ t("Estimated date") }}
              <input v-model="draft.estimatedDate" type="date" />
              <small>{{ t("预估时间，不计入逾期。") }}</small>
            </label>
            <label class="full">
              {{ t("Reminder") }} ({{ reminderZone }})
              <input
                v-model="reminderLocal"
                type="datetime-local"
                @change="changeReminder"
              />
              <small>{{
                t("Reminder time is independent of the due date.")
              }}</small>
            </label>
            <fieldset class="full explicit-work-plan">
              <legend>{{ t("Work dates") }}</legend>
              <label>
                {{ t("Work week") }}
                <input
                  type="date"
                  :value="draft.workWeek ?? ''"
                  @change="changeWorkWeek"
                />
              </label>
              <small>{{
                t(
                  "Changing the week keeps the selected weekdays. Review all dates before saving.",
                )
              }}</small>
              <div v-if="workDays.length" class="work-day-options">
                <label v-for="date in workDays" :key="date" class="check-label">
                  <input
                    type="checkbox"
                    :checked="draft.workDates.includes(date)"
                    @change="changeWorkDay(date, $event)"
                  />
                  {{
                    formatDate(date, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })
                  }}
                </label>
              </div>
              <p v-else class="muted">{{ t("Not scheduled") }}</p>
              <p v-if="draft.workWeek && !draft.workDates.length" class="muted">
                {{ t("Work week selected; specific dates are not assigned.") }}
              </p>
            </fieldset>
          </div>
        </details>
      </div>
    </fieldset>
    <div class="form-actions">
      <button type="button" :disabled="store.busy" @click="cancel">
        {{ t("Cancel") }}</button
      ><button
        type="submit"
        class="primary"
        :disabled="store.busy || persisted.pending.value || planningBlocked"
      >
        {{ t(store.busy ? "Saving…" : "Save task") }}
      </button>
    </div>
  </form>
</template>
<style scoped>
.progressive .section-heading {
  margin-bottom: 10px;
  font-size: 12px;
}
.progressive .form-grid {
  gap: 14px;
}
.progressive .planning {
  grid-column: 1 / -1;
  gap: 10px 18px;
}
.progressive .planning > span {
  width: auto;
}
.task-options {
  min-width: 0;
  border-top: 1px solid var(--border);
}
.task-options summary {
  padding: 14px 0;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
}
.task-options .options-summary {
  display: block;
  margin: 6px 0 0 16px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.advanced-task-fields {
  padding: 2px 0 8px;
}
.explicit-work-plan {
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 0;
  padding: 12px;
}
.explicit-work-plan > label {
  display: grid;
  gap: 6px;
  max-width: 260px;
}
.explicit-work-plan small {
  display: block;
  color: var(--muted);
  line-height: 1.6;
  margin: 8px 0;
}
.work-day-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.work-day-options label {
  min-height: 44px;
  font-size: 12px;
}
.explicit-work-plan p {
  font-size: 12px;
}
</style>
