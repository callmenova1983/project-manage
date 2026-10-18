<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
} from "vue";
import type { CalendarBasis } from "../../../../packages/domain/task-calendar";
import { calendarTaskDateInput } from "../../../../packages/domain/task-calendar";
import { taskInput, type Task } from "../../../../packages/domain/types";
import {
  editedReminderInstant,
  reminderLocalInput,
  weekBounds,
} from "../../../../packages/domain/time-zone";
import {
  moveTaskWorkWeek,
  setTaskWorkDay,
} from "../../../../packages/domain/task-planning";
import { useWorkspace } from "../stores/workspace";
import { dialogContextKey } from "../composables/dialog-context";
import { useUnsaved } from "../composables/unsaved";
import { t, formatDate } from "../locales";
import SaveError from "./SaveError.vue";
import type { ApiError } from "../services/contracts";
const props = defineProps<{
  task: Task;
  basis: CalendarBasis;
  targetDate?: string;
  inline?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspace();
const dialog = ref<HTMLElement | null>(null);
provide(dialogContextKey, { active: computed(() => true), target: dialog });
const zone = store.timeZone;
const original = ref({ ...props.task });
const date = ref(
  props.targetDate ??
    (props.basis === "estimated"
      ? props.task.estimatedDate
      : props.task.dueDate) ??
    "",
);
const reminder = ref(
  props.task.reminderAt ? reminderLocalInput(props.task.reminderAt, zone) : "",
);
const plan = ref({
  workWeek: props.task.workWeek,
  workDates: [...props.task.workDates],
});
const initial = ref(
  JSON.stringify({
    date:
      props.basis === "estimated"
        ? (props.task.estimatedDate ?? "")
        : (props.task.dueDate ?? ""),
    reminder: reminder.value,
    plan: plan.value,
  }),
);
const dirty = computed(
  () =>
    JSON.stringify({
      date: date.value,
      reminder: reminder.value,
      plan: plan.value,
    }) !== initial.value,
);
const mayDiscard = useUnsaved(dirty);
const error = ref<Error | null>(null);
const days = computed(() =>
  plan.value.workWeek ? weekBounds(plan.value.workWeek, zone).days : [],
);
const labels = {
  due: "Due date",
  work: "Work dates",
  estimated: "Estimated date",
  reminder: "Reminder",
};
function close() {
  if (!store.busy && mayDiscard()) emit("close");
}
function changeWeek(event: Event) {
  try {
    plan.value = moveTaskWorkWeek(
      plan.value,
      (event.target as HTMLInputElement).value || null,
    );
    error.value = null;
  } catch (reason) {
    error.value = reason as Error;
  }
}
function reload() {
  const returned = (error.value as ApiError | null)?.current;
  const task =
    returned &&
    "projectId" in returned &&
    returned.id === original.value.id &&
    returned.projectId === original.value.projectId
      ? returned
      : store.data.tasks.find((task) => task.id === original.value.id);
  if (!task || task.voided) {
    error.value = new Error("Task unavailable. Refresh or return to the list.");
    return;
  }
  original.value = { ...task };
  date.value =
    (props.basis === "estimated" ? task.estimatedDate : task.dueDate) ?? "";
  reminder.value = task.reminderAt
    ? reminderLocalInput(task.reminderAt, zone)
    : "";
  plan.value = { workWeek: task.workWeek, workDates: [...task.workDates] };
  initial.value = JSON.stringify({
    date: date.value,
    reminder: reminder.value,
    plan: plan.value,
  });
  error.value = null;
}
async function save() {
  if (store.busy) return;
  error.value = null;
  try {
    const base = taskInput.strip().parse(original.value);
    const input = calendarTaskDateInput(original.value, props.basis, {
      date: date.value || null,
      workWeek: plan.value.workWeek,
      workDates: plan.value.workDates,
      reminderAt:
        props.basis === "reminder"
          ? editedReminderInstant(
              reminder.value,
              original.value.reminderAt,
              zone,
            )
          : (original.value.reminderAt ?? null),
    });
    if (JSON.stringify(input) !== JSON.stringify(base))
      await store.saveTask(input, original.value);
    emit("close");
  } catch (reason) {
    error.value = reason as Error;
  }
}
watch(
  () => store.user?.id,
  () => emit("close"),
);
let trigger: HTMLElement | null = null;
onMounted(async () => {
  trigger = document.activeElement as HTMLElement | null;
  await nextTick();
  if (props.inline)
    dialog.value
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true });
  else if (dialog.value instanceof HTMLDialogElement) dialog.value.showModal();
});
onBeforeUnmount(() => {
  const restoreFocus =
    !props.inline || !!dialog.value?.contains(document.activeElement);
  if (dialog.value instanceof HTMLDialogElement) dialog.value.close();
  if (restoreFocus && trigger?.isConnected)
    trigger.focus({ preventScroll: true });
  if (props.inline && restoreFocus)
    void nextTick(() => {
      if (document.activeElement === document.body)
        document
          .querySelector<HTMLButtonElement>(".task-feedback button")
          ?.focus({ preventScroll: true });
    });
});
</script>
<template>
  <component
    :is="inline ? 'div' : 'dialog'"
    ref="dialog"
    class="calendar-date-edit"
    :class="{ 'inline-date-edit': inline }"
    :role="inline ? 'group' : undefined"
    :aria-label="t(inline ? 'Work arrangement' : 'Change task date')"
    @cancel.prevent="close"
  >
    <header>
      <h2>{{ t(inline ? "Work arrangement" : "Change task date") }}</h2>
      <button :disabled="store.busy" @click="close">{{ t("Close") }}</button>
    </header>
    <h3 v-if="!inline">{{ task.title }}</h3>
    <p v-if="!inline">
      {{ t("Only the selected date basis will change.") }} ·
      {{ t(labels[basis]) }} · {{ zone }}
    </p>
    <SaveError :error="error" @reload="reload" />
    <form @submit.prevent="save">
      <template v-if="basis === 'work'"
        ><label
          >{{ t("Work week")
          }}<input
            type="date"
            :value="plan.workWeek ?? ''"
            :disabled="store.busy"
            @change="changeWeek"
        /></label>
        <p>
          {{
            t(
              "Changing the week keeps the selected weekdays. Review all dates before saving.",
            )
          }}
        </p>
        <fieldset :disabled="store.busy">
          <legend>{{ t("Work dates") }}</legend>
          <label v-for="day in days" :key="day"
            ><input
              type="checkbox"
              :checked="plan.workDates.includes(day)"
              @change="
                plan = setTaskWorkDay(
                  plan,
                  day,
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />{{ formatDate(day, { dateStyle: "full" }) }}</label
          >
        </fieldset>
        <p v-if="plan.workWeek && !plan.workDates.length">
          {{ t("Work week selected; specific dates are not assigned.") }}
        </p></template
      >
      <label v-else-if="basis === 'reminder'"
        >{{ t("Reminder") }} ({{ zone }})<input
          v-model="reminder"
          type="datetime-local"
          :disabled="store.busy"
      /></label>
      <label v-else
        >{{ t(labels[basis])
        }}<input v-model="date" type="date" :disabled="store.busy"
      /></label>
      <footer>
        <button type="button" :disabled="store.busy" @click="close">
          {{ t("Cancel") }}</button
        ><button type="submit" class="primary" :disabled="store.busy">
          {{ t("Save changes") }}
        </button>
      </footer>
    </form>
  </component>
</template>
<style scoped>
.calendar-date-edit {
  width: min(600px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;
}
.calendar-date-edit::backdrop {
  background: rgb(0 0 0 / 35%);
}
.calendar-date-edit.inline-date-edit {
  width: 100%;
  max-height: none;
  overflow: visible;
  border-radius: 6px;
  padding: 14px;
  background: var(--surface-subtle);
}
.inline-date-edit h2 {
  font-size: 14px;
}
.inline-date-edit form {
  margin-top: 10px;
}
.inline-date-edit fieldset {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 4px 12px;
}
.inline-date-edit fieldset label {
  min-height: 36px;
  margin: 0;
  font-size: 12px;
}
.inline-date-edit footer {
  margin-top: 12px;
}
header,
footer {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
}
h2 {
  font-size: 18px;
  margin: 0;
}
h3,
p {
  overflow-wrap: anywhere;
}
p {
  font-size: 12px;
}
button,
input {
  min-height: 44px;
}
fieldset label {
  display: flex;
  gap: 8px;
  align-items: center;
}
input[type="checkbox"] {
  width: 18px;
  min-height: 18px;
}
footer {
  margin-top: 20px;
  justify-content: flex-end;
}
@media (max-width: 760px), (pointer: coarse) {
  .inline-date-edit fieldset label {
    min-height: 44px;
  }
}
</style>
