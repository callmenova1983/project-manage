<script setup lang="ts">
import { nextTick, ref, watch, onBeforeUnmount } from "vue";
import {
  PhCheckCircle,
  PhArrowCounterClockwise,
  PhX,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { t } from "../locales";
import { statusLabels } from "../locales/en";
import { memberName } from "../../../../packages/domain/members";
const store = useWorkspace();
const panel = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
function pause() {
  clearTimeout(timer);
}
function resume() {
  pause();
  if (store.taskFeedbackError || !store.taskFeedback) return;
  timer = setTimeout(() => {
    if (!panel.value?.contains(document.activeElement))
      store.dismissTaskFeedback();
  }, 12000);
}
watch(() => [store.taskFeedback, store.taskFeedbackError], resume);
onBeforeUnmount(pause);
async function dismiss() {
  store.dismissTaskFeedback();
  await nextTick();
  document.getElementById("main-content")?.focus({ preventScroll: true });
}
</script>
<template>
  <section
    v-if="store.taskFeedback"
    ref="panel"
    class="task-feedback"
    @mouseenter="pause"
    @mouseleave="resume"
    @focusin="pause"
    @focusout="resume"
    :aria-label="t('Task update feedback')"
  >
    <PhCheckCircle :size="20" class="feedback-icon" />
    <div class="feedback-copy">
      <p role="status" aria-live="polite" aria-atomic="true">
        <strong>{{
          t(
            store.taskFeedback.undone
              ? "Change undone"
              : store.taskFeedback.kind === "assignee"
                ? "Assignee copied"
                : "Task status saved",
          )
        }}</strong>
        <span
          >{{ store.taskFeedback.task.title }} ·
          {{
            store.taskFeedback.kind === "assignee"
              ? memberName(
                  store.taskFeedback.task.assigneeId,
                  store.taskFeedback.task.assignee,
                  store.data.members ?? [],
                )
              : statusLabels[store.taskFeedback.task.status]
          }}</span
        >
      </p>
      <p v-if="store.undoState === 'changed'" class="muted">
        {{
          t(
            "This task changed after your action. Review its current state before editing.",
          )
        }}
      </p>
      <p v-if="store.undoState === 'sync'" class="muted">
        {{
          t(
            store.taskFeedback.kind === "assignee"
              ? "Assignment saved. Refresh history to enable undo."
              : "Status saved. Refresh history to enable undo.",
          )
        }}
      </p>
      <p v-if="store.taskFeedbackError" class="feedback-error" role="alert">
        {{ t(store.taskFeedbackError) }}
      </p>
    </div>
    <button
      v-if="store.undoState === 'ready'"
      :disabled="store.busy"
      @click="store.undoTaskStatus()"
    >
      <PhArrowCounterClockwise :size="16" />{{
        t(
          store.taskFeedback.kind === "assignee"
            ? "Undo assignment"
            : "Undo status change",
        )
      }}
    </button>
    <button
      v-else-if="store.undoState === 'sync'"
      :disabled="store.busy || store.loading"
      @click="store.refresh()"
    >
      {{ t("Refresh history") }}
    </button>
    <button
      class="icon-button"
      :disabled="store.busy"
      :aria-label="t('Dismiss task feedback')"
      @click="dismiss"
    >
      <PhX :size="18" />
    </button>
  </section>
</template>
<style scoped>
.task-feedback {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: min(640px, calc(100vw - 40px));
  box-sizing: border-box;
  border-radius: 10px;
  box-shadow: 0 8px 32px #0002;
  z-index: 35;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  background: var(--surface);
}
.feedback-icon {
  flex: none;
  color: var(--status-done);
}
.feedback-copy {
  flex: 1;
  min-width: 0;
}
p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
p[role="status"] {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.feedback-error {
  color: var(--danger, #ed8c8c);
}
button {
  flex: none;
}
@media (max-width: 760px) {
  .task-feedback {
    right: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    width: calc(100vw - 24px);
    padding: 12px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .feedback-copy {
    flex-basis: calc(100% - 32px);
  }
  .task-feedback > button {
    min-height: 44px;
  }
  .task-feedback > button:last-child {
    margin-left: auto;
  }
}
</style>
