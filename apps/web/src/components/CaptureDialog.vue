<script setup lang="ts">
import { t } from "../locales";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
} from "vue";
import { dialogContextKey } from "../composables/dialog-context";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
const viewport = ref<Record<string, string>>({});
provide(dialogContextKey, {
  active: computed(() => props.open),
  target: dialog,
});
let unlock: (() => void) | undefined;
let opener: HTMLElement | null = null;

function updateViewport() {
  const view = window.visualViewport;
  viewport.value = {
    "--capture-viewport-height": `${view?.height ?? innerHeight}px`,
    "--capture-viewport-top": `${view?.offsetTop ?? 0}px`,
  };
}
function controls() {
  return Array.from(
    dialog.value?.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex="0"]',
    ) ?? [],
  ).filter(
    (el) =>
      !el.matches(':disabled, [hidden], [tabindex="-1"]') &&
      el.getClientRects().length > 0,
  );
}
function keyboard(event: KeyboardEvent) {
  if (!props.open || event.defaultPrevented) return;
  if (event.key === "Escape" && !event.isComposing) {
    event.preventDefault();
    emit("close");
  } else if (event.key === "Tab") {
    const items = controls(),
      first = items[0],
      last = items.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.value?.focus({ preventScroll: true });
    } else if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === dialog.value)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
function containFocus(event: FocusEvent) {
  if (props.open && !dialog.value?.contains(event.target as Node))
    (controls()[0] ?? dialog.value)?.focus({ preventScroll: true });
}
async function activate() {
  if (unlock) return;
  opener =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const root = document.getElementById("app"),
    wasInert = root?.inert ?? false;
  const body = document.body;
  const saved = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    width: body.style.width,
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
  };
  const x = window.scrollX,
    y = window.scrollY;
  const gutter = innerWidth - document.documentElement.clientWidth;
  Object.assign(body.style, {
    position: "fixed",
    top: `${-y}px`,
    left: `${-x}px`,
    width: "100%",
    overflow: "hidden",
  });
  if (gutter > 0)
    body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gutter}px`;
  if (root) root.inert = true;
  updateViewport();
  window.visualViewport?.addEventListener("resize", updateViewport);
  window.visualViewport?.addEventListener("scroll", updateViewport);
  window.addEventListener("resize", updateViewport);
  document.addEventListener("keydown", keyboard);
  document.addEventListener("focusin", containFocus);
  unlock = () => {
    window.visualViewport?.removeEventListener("resize", updateViewport);
    window.visualViewport?.removeEventListener("scroll", updateViewport);
    window.removeEventListener("resize", updateViewport);
    document.removeEventListener("keydown", keyboard);
    document.removeEventListener("focusin", containFocus);
    if (root) root.inert = wasInert;
    Object.assign(body.style, saved);
    window.scrollTo(x, y);
  };
  await nextTick();
  if (!props.open) return;
  // Touch users open the keyboard themselves, keeping the full panel visible.
  const initial = matchMedia("(pointer: fine)").matches
    ? dialog.value?.querySelector<HTMLElement>("textarea:not(:disabled)")
    : dialog.value;
  (initial ?? dialog.value)?.focus({ preventScroll: true });
}
function deactivate() {
  unlock?.();
  unlock = undefined;
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}
onMounted(() => {
  if (props.open) void activate();
});
watch(
  () => props.open,
  (open) => {
    if (open) void activate();
    else deactivate();
  },
);
onBeforeUnmount(deactivate);
</script>

<template>
  <Teleport to="body">
    <div
      v-show="open"
      class="capture-overlay"
      :style="viewport"
      @click.self="emit('close')"
    >
      <div
        id="project-intake-panel"
        ref="dialog"
        class="capture-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('AI 录入')"
        tabindex="-1"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.capture-overlay {
  position: fixed;
  inset: var(--capture-viewport-top, 0px) 0 auto;
  height: var(--capture-viewport-height, 100dvh);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(15 23 42 / 38%);
  overscroll-behavior: contain;
  touch-action: manipulation;
}
.capture-dialog {
  display: flex;
  flex-direction: column;
  width: min(900px, 100%);
  max-height: min(760px, calc(var(--capture-viewport-height, 100dvh) - 48px));
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 80px rgb(0 0 0 / 24%);
  outline: none;
}
@media (max-width: 600px) {
  .capture-overlay {
    padding: 0;
  }
  .capture-dialog {
    width: 100%;
    height: 100%;
    max-height: 100%;
    border: 0;
    border-radius: 0;
  }
}
</style>
