<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, provide, ref, watch } from "vue";
import { PhX } from "@phosphor-icons/vue";
import { dialogContextKey } from "../composables/dialog-context";
import { t } from "../locales";

const props = defineProps<{
  open: boolean;
  title: string;
  variant?: "drawer" | "sheet" | "form";
  busy?: boolean;
  fallbackFocus?: HTMLElement | null;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const viewport = ref<Record<string, string>>({});
provide(dialogContextKey, {
  active: computed(() => props.open),
  target: dialog,
});
let trigger: HTMLElement | null = null;
let unlock: (() => void) | undefined;
let generation = 0;
function resize() {
  viewport.value = {
    "--dialog-height": `${window.visualViewport?.height ?? innerHeight}px`,
    "--dialog-top": `${window.visualViewport?.offsetTop ?? 0}px`,
  };
}
function release() {
  dialog.value?.close();
  unlock?.();
  unlock = undefined;
}
function close() {
  if (!props.busy) emit("close");
}
watch(
  () => props.open,
  async (open) => {
    const current = ++generation;
    if (!open) {
      release();
      await nextTick();
      if (current === generation) {
        const destination = trigger?.isConnected
          ? trigger
          : props.fallbackFocus;
        destination?.focus({ preventScroll: true });
      }
      return;
    }
    trigger = document.activeElement as HTMLElement | null;
    await nextTick();
    if (current !== generation || !dialog.value) return;
    resize();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    unlock = () => {
      document.body.style.overflow = overflow;
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
    };
    dialog.value.showModal();
    // Keep the software keyboard closed until touch users choose an input.
    if (matchMedia("(pointer: coarse)").matches)
      dialog.value.focus({ preventScroll: true });
  },
  { immediate: true, flush: "post" },
);
onBeforeUnmount(() => {
  generation++;
  release();
});
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="workspace-dialog"
      :class="variant ?? 'form'"
      :style="viewport"
      :aria-label="title"
      aria-modal="true"
      tabindex="-1"
      @cancel.prevent="close"
    >
      <header class="workspace-dialog-header">
        <h2>{{ title }}</h2>
        <button
          class="icon-button"
          :aria-label="t('Close') + ' ' + title"
          :disabled="busy"
          @click="close"
        >
          <PhX :size="20" />
        </button>
      </header>
      <div class="workspace-dialog-body"><slot /></div>
      <footer v-if="$slots.footer" class="workspace-dialog-footer">
        <slot name="footer" />
      </footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.workspace-dialog {
  box-sizing: border-box;
  width: min(720px, calc(100vw - 32px));
  max-width: 100vw;
  max-height: calc(var(--dialog-height, 100dvh) - 48px);
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  background: var(--surface);
  overflow: hidden;
}
.workspace-dialog[open] {
  display: flex;
  flex-direction: column;
}
.workspace-dialog::backdrop {
  background: rgb(15 23 42 / 32%);
}
.workspace-dialog.drawer {
  position: fixed;
  inset: var(--dialog-top, 0px) 0 auto auto;
  margin: 0;
  height: var(--dialog-height, 100dvh);
  max-height: var(--dialog-height, 100dvh);
  width: min(560px, 100vw);
  border-radius: 0;
}
.workspace-dialog.sheet {
  width: min(460px, calc(100vw - 32px));
}
.workspace-dialog-header,
.workspace-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  flex: none;
}
.workspace-dialog-header {
  border-bottom: 1px solid var(--border);
}
.workspace-dialog-header h2 {
  font-size: 17px;
  margin: 0;
  overflow-wrap: anywhere;
}
.workspace-dialog-header button {
  width: 44px;
  min-width: 44px;
  height: 44px;
}
.workspace-dialog-body {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 20px;
}
.workspace-dialog-body :deep(.editor) {
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.workspace-dialog-footer {
  border-top: 1px solid var(--border);
  justify-content: flex-end;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
@media (max-width: 600px) {
  .workspace-dialog {
    position: fixed;
    inset: var(--dialog-top, 0px) 0 auto;
    margin: 0;
    width: 100%;
    height: var(--dialog-height, 100dvh);
    max-height: var(--dialog-height, 100dvh);
    border: 0;
    border-radius: 0;
  }
  .workspace-dialog.sheet {
    inset: auto 0
      max(
        0px,
        calc(100dvh - var(--dialog-height, 100dvh) - var(--dialog-top, 0px))
      );
    width: 100%;
    height: auto;
    max-height: calc(var(--dialog-height, 100dvh) - 12px);
    border-radius: 16px 16px 0 0;
  }
  .workspace-dialog-header {
    padding: 8px 12px;
  }
  .workspace-dialog-body {
    padding: 16px;
  }
  .workspace-dialog-body :deep(input:not([type="checkbox"])),
  .workspace-dialog-body :deep(textarea),
  .workspace-dialog-body :deep(select) {
    font-size: 16px;
    min-height: 44px;
  }
  .workspace-dialog-body :deep(.form-actions) {
    position: sticky;
    bottom: -16px;
    background: var(--surface);
    padding: 12px 0 max(12px, env(safe-area-inset-bottom));
    z-index: 1;
  }
}
</style>
