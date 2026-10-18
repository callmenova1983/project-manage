<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import PersonPicker from "./PersonPicker.vue";
import TaskFieldCopy from "./TaskFieldCopy.vue";
import { PhCheck, PhPencilSimple, PhX } from "@phosphor-icons/vue";
import { memberName } from "../../../../packages/domain/members";
import { taskInput, type Task } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved, confirmDiscard } from "../composables/unsaved";
import { t, formatDate } from "../locales";
import { assigneeDrag, assigneeDragType } from "../services/assignee-drag";
import { hasTaskAssignee } from "../../../../packages/domain/task-field-copy";
const props = defineProps<{
  task: Task;
  field: "title" | "assignee" | "dueDate";
  singleClick?: boolean;
  iconOnly?: boolean;
  tableCell?: boolean;
  compact?: boolean;
  copyTargets?: Task[];
}>();
const emit = defineEmits<{ editing: [value: boolean] }>();
const store = useWorkspace();
const editing = ref(false),
  draft = ref(""),
  error = ref("");
const original = ref<Task | null>(null),
  input = ref<HTMLInputElement | null>(null),
  editor = ref<HTMLFormElement | null>(null),
  trigger = ref<HTMLButtonElement | null>(null);
const titleIcon = computed(() => props.iconOnly && props.field === "title");
const draftMemberId = ref<string | null>(null);
const initialValue = ref("");
const dragOver = ref(false);
let dropVersion: number | undefined;
let suppressClickUntil = 0;
const canDrag = computed(
  () =>
    props.field === "assignee" &&
    !editing.value &&
    !store.busy &&
    !props.task.voided &&
    !!store.user &&
    hasTaskAssignee(props.task) &&
    (!props.task.assigneeId ||
      !store.data.members?.some(
        (member) =>
          member.id === props.task.assigneeId && member.status !== "active",
      )),
);
function canDrop() {
  const drag = assigneeDrag.value;
  return (
    props.field === "assignee" &&
    !editing.value &&
    !store.busy &&
    !props.task.voided &&
    drag &&
    drag.sourceId !== props.task.id &&
    drag.actorId === store.user?.id &&
    drag.workspaceId === store.user.workspaceId
  );
}
function startDrag(event: DragEvent) {
  if (!canDrag.value || !event.dataTransfer || !store.user) {
    event.preventDefault();
    return;
  }
  event.stopPropagation();
  suppressClickUntil = Date.now() + 500;
  assigneeDrag.value = {
    sourceId: props.task.id,
    sourceVersion: props.task.version,
    name: memberName(
      props.task.assigneeId,
      props.task.assignee,
      store.data.members ?? [],
    ),
    actorId: store.user.id,
    workspaceId: store.user.workspaceId,
  };
  event.dataTransfer.setData(assigneeDragType, props.task.id);
  event.dataTransfer.setData("text/plain", assigneeDrag.value.name);
  event.dataTransfer.effectAllowed = "copy";
}
function endDrag() {
  assigneeDrag.value = null;
  suppressClickUntil = Date.now() + 250;
}
function over(event: DragEvent) {
  if (!canDrop() || !event.dataTransfer?.types.includes(assigneeDragType))
    return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "copy";
  if (!dragOver.value) dropVersion = props.task.version;
  dragOver.value = true;
}
function leave(event: DragEvent) {
  if (
    !(event.currentTarget as HTMLElement).contains(
      event.relatedTarget as Node | null,
    )
  ) {
    dragOver.value = false;
    dropVersion = undefined;
  }
}
async function drop(event: DragEvent) {
  if (!canDrop() || !event.dataTransfer?.types.includes(assigneeDragType))
    return;
  event.preventDefault();
  event.stopPropagation();
  const drag = assigneeDrag.value!,
    version = dropVersion ?? props.task.version;
  assigneeDrag.value = null;
  dragOver.value = false;
  dropVersion = undefined;
  error.value = "";
  try {
    await store.copyTaskAssignee(
      drag.sourceId,
      drag.sourceVersion,
      props.task.id,
      version,
    );
  } catch (e) {
    error.value = (e as Error).message;
    await store.refresh(true);
  }
}
const label = computed(() =>
  t(
    props.field === "title"
      ? "Task title"
      : props.field === "assignee"
        ? "Assignee"
        : "Due date",
  ),
);
const dirty = computed(
  () =>
    editing.value &&
    ((props.field === "assignee" &&
      draftMemberId.value !== (original.value?.assigneeId ?? null)) ||
      draft.value !== initialValue.value),
);
useUnsaved(dirty);
onBeforeUnmount(() => {
  if (editing.value) emit("editing", false);
});
async function open() {
  if (Date.now() < suppressClickUntil) return;
  if (store.busy || props.task.voided || !confirmDiscard()) return;
  original.value = { ...props.task };
  draftMemberId.value = props.task.assigneeId ?? null;
  draft.value =
    props.field === "assignee"
      ? memberName(
          props.task.assigneeId,
          props.task.assignee,
          store.data.members ?? [],
        )
      : (props.task[props.field] ?? "");
  error.value = "";
  editing.value = true;
  emit("editing", true);
  initialValue.value = draft.value;
  await nextTick();
  input.value?.focus();
  if (props.field !== "dueDate") input.value?.select();
}
async function finishEditing(restoreFocus: boolean, form = editor.value) {
  editing.value = false;
  emit("editing", false);
  error.value = "";
  await nextTick();
  if (!restoreFocus) return;
  const active = document.activeElement;
  if (
    active !== document.body &&
    active !== document.documentElement &&
    !form?.contains(active)
  )
    return;
  if (trigger.value?.isConnected) trigger.value.focus({ preventScroll: true });
  else
    document
      .querySelector<HTMLButtonElement>(".task-feedback button")
      ?.focus({ preventScroll: true });
}
function cancel() {
  void finishEditing(!!editor.value?.contains(document.activeElement));
}
async function save() {
  if (!dirty.value) {
    cancel();
    return;
  }
  const form = editor.value;
  const restoreFocus = !!form?.contains(document.activeElement);
  error.value = "";
  try {
    await store.saveTask(
      taskInput.parse({
        ...taskInput.strip().parse(original.value!),
        ...(props.field === "assignee"
          ? { assigneeId: draftMemberId.value }
          : {}),
        [props.field]:
          props.field === "dueDate" ? draft.value || null : draft.value,
      }),
      original.value!,
    );
    await finishEditing(restoreFocus, form);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <div
    class="quick-task-field"
    :class="{
      editing,
      compact,
      'task-table-cell': tableCell,
      'task-cell-editing': tableCell && editing,
      'assignee-drop-target': dragOver && !!assigneeDrag,
      'assignee-draggable': canDrag,
    }"
    :data-drop-label="
      assigneeDrag
        ? t('Release to assign {name}', { name: assigneeDrag.name })
        : undefined
    "
    @dragover="over"
    @dragleave="leave"
    @drop="drop"
  >
    <form
      v-if="editing"
      ref="editor"
      @submit.prevent="save"
      @keydown.esc.stop.prevent="cancel"
    >
      <PersonPicker
        v-if="field === 'assignee'"
        v-model="draft"
        link-members
        :member-id="draftMemberId"
        @update:model-value="draftMemberId = null"
        @select-identity="draftMemberId = $event"
        :project-id="task.projectId"
        :label="label"
        :disabled="store.busy"
        auto-open
        compact
        @select="save"
        @cancel="cancel"
      />
      <input
        v-else
        ref="input"
        v-model="draft"
        :type="field === 'dueDate' ? 'date' : 'text'"
        :aria-label="label"
        :maxlength="field === 'title' ? 240 : 80"
        :required="field === 'title'"
        :disabled="store.busy"
      />
      <button
        v-if="field !== 'assignee' || error"
        class="icon-button"
        type="submit"
        :aria-label="t('Save')"
        :disabled="store.busy"
      >
        <PhCheck :size="15" />
      </button>
      <button
        class="icon-button"
        type="button"
        :aria-label="t('Cancel')"
        :disabled="store.busy"
        @click="cancel"
      >
        <PhX :size="15" />
      </button>
    </form>
    <button
      v-else
      ref="trigger"
      class="text-button field-value"
      :class="{ 'icon-button title-edit-trigger': titleIcon }"
      :disabled="store.busy || !!task.voided"
      :draggable="canDrag"
      @dragstart="startDrag"
      @dragend="endDrag"
      :title="
        titleIcon
          ? t('Edit title for {title}', { title: task.title })
          : t(
              canDrag
                ? 'Drag to copy assignee; click to edit'
                : field === 'title' && !singleClick
                  ? 'Double-click to edit task title'
                  : 'Click to edit',
            )
      "
      :aria-label="
        titleIcon || (field === 'title' && singleClick)
          ? t('Edit title for {title}', { title: task.title })
          : field === 'title'
            ? task.title
            : `${label}: ${task[field] || t(field === 'dueDate' ? 'No due date' : 'Unassigned')}`
      "
      @click="(field !== 'title' || singleClick) && open()"
      @dblclick="field === 'title' && !singleClick && open()"
      @keydown.f2.prevent="open"
      @keydown.enter.prevent="open"
    >
      <PhPencilSimple v-if="titleIcon" :size="16" />
      <template v-else>{{
        field === "title"
          ? task.title
          : field === "assignee"
            ? t(
                memberName(
                  task.assigneeId,
                  task.assignee,
                  store.data.members ?? [],
                ),
              )
            : task.dueDate
              ? formatDate(task.dueDate, { month: "short", day: "numeric" })
              : t("No due date")
      }}</template>
    </button>
    <TaskFieldCopy
      v-if="!editing && copyTargets && field !== 'title'"
      :task="task"
      :field="field"
      :tasks="copyTargets"
    />
    <small v-if="error" class="quick-field-error" role="alert">{{
      t(error)
    }}</small>
  </div>
</template>
<style scoped>
.quick-task-field {
  min-width: 0;
  position: relative;
}
.assignee-draggable > .field-value {
  cursor: grab;
}
.assignee-draggable > .field-value:active {
  cursor: grabbing;
}
.assignee-drop-target {
  background: var(--accent-bg);
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  border-radius: 4px;
}
.assignee-drop-target::after {
  content: attr(data-drop-label);
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  z-index: 60;
  background: var(--surface-raised);
  color: var(--accent);
  border: 1px solid var(--accent-border);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
}
.quick-task-field:has(.copy-field-button) {
  display: flex;
  align-items: center;
  gap: 2px;
}
.quick-task-field form {
  display: flex;
  gap: 3px;
  align-items: center;
}
.quick-task-field input {
  min-width: 0;
  width: 100%;
  height: 32px;
  padding: 4px 7px;
}
.quick-task-field .icon-button {
  flex-shrink: 0;
  width: 26px;
  height: 30px;
}
.quick-task-field .title-edit-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  min-width: 32px;
  height: 32px;
  padding: 6px;
  color: var(--muted);
}
.quick-task-field .title-edit-trigger:hover {
  color: var(--accent);
  background: var(--accent-bg);
}
.task-table-cell {
  width: 100%;
}
.task-cell-editing form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  width: 100%;
}
.task-cell-editing input,
.task-cell-editing :deep(.person-picker) {
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
}
.task-cell-editing input {
  box-sizing: border-box;
  padding-inline: 4px;
  font-size: 11px;
}
.task-cell-editing :deep(.person-search input) {
  padding-left: 26px;
  padding-right: 26px;
}
.task-cell-editing form > .icon-button {
  width: 100%;
  min-width: 0;
}
.task-cell-editing form > .icon-button:last-child {
  grid-column: 2;
}
.field-value {
  color: inherit;
  text-align: left;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}
.compact:not(.editing) .field-value {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow-wrap: normal;
}
.quick-field-error {
  display: block;
  color: var(--danger, #e15b68);
  margin-top: 4px;
}
@media (max-width: 760px), (pointer: coarse) {
  .quick-task-field input,
  .quick-task-field .icon-button {
    min-height: 44px;
    height: 44px;
  }
  .quick-task-field .icon-button {
    min-width: 44px;
    width: 44px;
  }
  .quick-task-field form {
    gap: 4px;
  }
  .quick-task-field :deep(.person-search input) {
    min-height: 44px;
    height: 44px;
    padding-right: 44px;
  }
  .quick-task-field :deep(.person-search > svg) {
    top: 14px;
  }
  .quick-task-field :deep(.clear-person) {
    top: 0;
    right: 0;
    min-width: 44px;
    min-height: 44px;
  }
  .task-cell-editing form > .icon-button {
    width: 100%;
    min-width: 44px;
  }
  .task-cell-editing :deep(.person-search input) {
    padding-right: 44px;
  }
}
</style>
