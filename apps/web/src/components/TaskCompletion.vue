<script setup lang="ts">
import { nextTick, ref } from "vue";
import { PhSquare, PhCheckSquare, PhSpinnerGap } from "@phosphor-icons/vue";
import type { Task } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { t } from "../locales";
const props = defineProps<{ task: Task; compact?: boolean }>();
const emit = defineEmits<{ error: [message: string] }>();
const store = useWorkspace();
const button = ref<HTMLButtonElement | null>(null);
async function toggle() {
  if (store.busy) return;
  const focused = document.activeElement === button.value;
  emit("error", "");
  try {
    await store.changeTaskStatus(
      props.task,
      props.task.status === "done" ? "todo" : "done",
    );
  } catch (e) {
    emit("error", (e as Error).message);
    await store.refresh(true);
  }
  await nextTick();
  if (focused && document.activeElement === document.body)
    document.querySelector<HTMLButtonElement>(".task-feedback button")?.focus();
}
</script>
<template>
  <button
    ref="button"
    type="button"
    class="completion-toggle"
    role="checkbox"
    :aria-checked="task.status === 'done'"
    :disabled="store.busy"
    :aria-label="t('Complete {title}', { title: task.title })"
    :aria-busy="store.changingTaskId === task.id"
    :class="{ completed: task.status === 'done', compact }"
    @click="toggle"
  >
    <PhSpinnerGap
      v-if="store.changingTaskId === task.id"
      :size="22"
      class="spin"
    />
    <PhCheckSquare
      v-else-if="task.status === 'done'"
      :size="22"
      weight="fill"
    />
    <PhSquare v-else :size="22" />
  </button>
</template>
<style scoped>
.completion-toggle {
  min-width: 36px;
  min-height: 36px;
  padding: 5px;
  border: 0;
  flex: none;
  color: var(--muted);
  background: transparent;
  transition:
    color 0.15s,
    background 0.15s;
}
.completion-toggle.completed {
  color: var(--status-done);
}
.completion-toggle.compact {
  min-width: 26px;
  min-height: 26px;
  width: 26px;
  height: 26px;
  padding: 2px;
}
.completion-toggle:hover {
  background: var(--surface-hover);
}
@media (max-width: 760px) {
  .completion-toggle {
    min-width: 44px;
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .completion-toggle {
    transition: none;
  }
}
@media (pointer: coarse) {
  .completion-toggle.compact {
    min-width: 44px;
    min-height: 44px;
  }
}
</style>
