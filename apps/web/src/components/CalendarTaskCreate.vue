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
import {
  calendarTaskPrefill,
  type CalendarBasis,
} from "../../../../packages/domain/task-calendar";
import { reminderInstant } from "../../../../packages/domain/time-zone";
import { useWorkspace } from "../stores/workspace";
import { dialogContextKey } from "../composables/dialog-context";
import { confirmDiscard } from "../composables/unsaved";
import { t, formatDate } from "../locales";
import TaskEditor from "./TaskEditor.vue";
const props = defineProps<{
  date: string;
  basis: CalendarBasis;
  projectId?: string;
}>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspace();
watch(
  () => store.user?.id,
  () => emit("close"),
);
const dialog = ref<HTMLDialogElement | null>(null);
provide(dialogContextKey, { active: computed(() => true), target: dialog });
const selectedProject = ref(props.projectId ?? "");
const zone = store.timeZone;
const time = ref("");
const confirmedTime = ref("");
const error = ref("");
const dates = computed(() =>
  calendarTaskPrefill(
    props.basis,
    props.date,
    confirmedTime.value || undefined,
  ),
);
const ready = computed(
  () =>
    !!selectedProject.value &&
    (props.basis !== "reminder" || !!confirmedTime.value),
);
const labels = {
  due: "Due date",
  work: "Work dates",
  estimated: "Estimated date",
  reminder: "Reminder",
};
function chooseProject(event: Event) {
  const target = event.target as HTMLSelectElement;
  if (confirmDiscard()) selectedProject.value = target.value;
  else target.value = selectedProject.value;
}
function confirmTime() {
  if (!confirmDiscard()) return;
  error.value = "";
  try {
    confirmedTime.value = reminderInstant(`${props.date}T${time.value}`, zone);
  } catch (reason) {
    error.value = (reason as Error).message;
  }
}
function close() {
  if (confirmDiscard()) emit("close");
}
let trigger: HTMLElement | null = null;
onMounted(async () => {
  trigger = document.activeElement as HTMLElement | null;
  await nextTick();
  dialog.value?.showModal();
});
onBeforeUnmount(() => {
  dialog.value?.close();
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
});
</script>
<template>
  <dialog
    ref="dialog"
    class="calendar-create"
    :aria-label="t('Create task on a date')"
    @cancel.prevent="close"
  >
    <header>
      <h2>{{ t("Create task on a date") }}</h2>
      <button @click="close">{{ t("Close") }}</button>
    </header>
    <p>
      {{ t("Prefilled date field") }}:
      <strong
        >{{ t(labels[basis]) }} ·
        {{ formatDate(date, { dateStyle: "full" }) }}</strong
      >
      · {{ zone }}
    </p>
    <p v-if="basis === 'work'" class="muted">
      {{ t("The selected day and its work week will be prefilled.") }}
    </p>
    <label v-if="!projectId"
      >{{ t("Project for new task")
      }}<select :value="selectedProject" @change="chooseProject">
        <option value="">{{ t("Choose a project") }}</option>
        <option
          v-for="project in store.data.projects"
          :key="project.id"
          :value="project.id"
        >
          {{ project.name }}
        </option>
      </select></label
    >
    <div v-if="basis === 'reminder'" class="reminder-choice">
      <label
        >{{ t("Reminder time") }} ({{ zone }})<input
          v-model="time"
          type="time" /></label
      ><button :disabled="!time" @click="confirmTime">
        {{ t("Use this reminder time") }}
      </button>
      <p>{{ t("Choose an explicit time before opening the task editor.") }}</p>
    </div>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <TaskEditor
      v-if="ready"
      :key="`${selectedProject}:${confirmedTime}`"
      :project-id="selectedProject"
      :initial-dates="dates"
      @close="emit('close')"
      @saved="emit('close')"
    />
  </dialog>
</template>
<style scoped>
.calendar-create {
  width: min(780px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  padding: 20px;
}
.calendar-create::backdrop {
  background: rgb(0 0 0 / 35%);
}
header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}
h2 {
  margin: 0;
  font-size: 18px;
}
button,
select,
input {
  min-height: 44px;
}
p {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.reminder-choice {
  margin: 12px 0;
}
label {
  display: block;
}
</style>
