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
import { useRoute, useRouter } from "vue-router";
import {
  PhSparkle,
  PhSidebarSimple,
  PhX,
  PhArrowsOutSimple,
  PhArrowsInSimple,
} from "@phosphor-icons/vue";
import MeetingsView from "../views/MeetingsView.vue";
import {
  assistantPanel,
  openAssistant,
  collapseAssistant,
} from "../composables/assistant-panel";
import { dialogContextKey } from "../composables/dialog-context";
import { useWorkspace } from "../stores/workspace";
import { accountStorageKey } from "../services/account-storage";
const route = useRoute(),
  router = useRouter(),
  store = useWorkspace();
const pane = ref<HTMLElement | null>(null),
  body = ref<InstanceType<typeof MeetingsView>>();
const viewport = ref<Record<string, string>>({});
const wide = ref(false);
let returnFocus: HTMLElement | null = null;
const key = accountStorageKey("assistant-layout", store.mode, store.user!);
try {
  const saved = JSON.parse(localStorage.getItem(key) || "null");
  if (saved) {
    assistantPanel.width = Math.max(
      380,
      Math.min(760, Number(saved.width) || 460),
    );
    if (typeof saved.projectId === "string" || saved.projectId === null)
      assistantPanel.projectId = saved.projectId;
    if (saved.open) openAssistant();
    else if (saved.mounted) assistantPanel.mounted = true;
  }
} catch {
  /* Use the default layout when browser storage is unavailable. */
}
const contextId = computed(() =>
  assistantPanel.projectId !== undefined
    ? assistantPanel.projectId
    : /^\/projects\/[^/]+$/.test(route.path)
      ? String(route.params.id)
      : null,
);
const project = computed(() =>
  store.data.projects.find((p) => p.id === contextId.value),
);
const contextLabel = computed(() =>
  project.value
    ? t("当前项目：{p0}", { p0: project.value.shortName || project.value.name })
    : t("全工作区"),
);
const width = computed(() =>
  wide.value
    ? Math.max(460, Math.min(760, innerWidth * 0.65))
    : assistantPanel.width,
);
provide(dialogContextKey, {
  persistent: true,
  active: computed(() => assistantPanel.open),
  target: pane,
});
function resizeViewport() {
  assistantPanel.mobile = innerWidth <= 760;
  viewport.value = {
    "--assistant-height": `${window.visualViewport?.height ?? innerHeight}px`,
    "--assistant-top": `${window.visualViewport?.offsetTop ?? 0}px`,
  };
}
let mobileOverflow: string | undefined;
watch(
  [() => assistantPanel.open, () => assistantPanel.mobile],
  ([open, mobile]) => {
    if (open && mobile && mobileOverflow === undefined) {
      mobileOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    } else if ((!open || !mobile) && mobileOverflow !== undefined) {
      document.body.style.overflow = mobileOverflow;
      mobileOverflow = undefined;
    }
  },
  { immediate: true },
);
let endDrag: (() => void) | undefined;
function drag(event: PointerEvent) {
  if (matchMedia("(max-width: 760px)").matches) return;
  event.preventDefault();
  const start = event.clientX,
    initial = width.value;
  wide.value = false;
  const move = (e: PointerEvent) => {
    assistantPanel.width = Math.max(
      380,
      Math.min(760, innerWidth - 320, initial + start - e.clientX),
    );
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    endDrag = undefined;
  };
  endDrag?.();
  endDrag = end;
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
function adjust(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  assistantPanel.width = Math.max(
    380,
    Math.min(
      760,
      innerWidth - 320,
      assistantPanel.width + (event.key === "ArrowLeft" ? 20 : -20),
    ),
  );
}
function shortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
    event.preventDefault();
    if (assistantPanel.open) collapseAssistant();
    else openAssistant();
  } else if (
    event.key === "Tab" &&
    assistantPanel.mobile &&
    assistantPanel.open &&
    pane.value
  ) {
    const controls = Array.from(
      pane.value.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ),
    ).filter((element) => element.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === pane.value)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  } else if (
    event.key === "Escape" &&
    pane.value?.contains(document.activeElement) &&
    !event.defaultPrevented
  )
    collapseAssistant();
}
watch(
  () => route.path,
  (_path, before) => {
    if (body.value?.hasDraft && assistantPanel.projectId === undefined) {
      const previous = /^\/projects\/([^/]+)$/.exec(before);
      assistantPanel.projectId = previous
        ? decodeURIComponent(previous[1]!)
        : null;
    }
  },
);
watch(
  () => route.query.intake,
  async (value) => {
    if (value !== "1") return;
    openAssistant();
    const query = { ...route.query };
    delete query.intake;
    await router.replace({ query });
  },
  { immediate: true },
);
watch(
  [
    () => assistantPanel.open,
    () => assistantPanel.width,
    () => assistantPanel.mounted,
    () => assistantPanel.projectId,
  ],
  async () => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          open: assistantPanel.open,
          mounted: assistantPanel.mounted,
          width: assistantPanel.width,
          projectId: assistantPanel.projectId,
        }),
      );
    } catch {
      /* Session state has its own recovery path. */
    }
    document.documentElement.style.setProperty(
      "--assistant-dock-width",
      assistantPanel.open ? `${width.value}px` : "0px",
    );
    document.documentElement.classList.toggle(
      "assistant-is-open",
      assistantPanel.open,
    );
  },
  { immediate: true },
);
watch(
  () => assistantPanel.open,
  async (open) => {
    if (open) {
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      resizeViewport();
      await nextTick();
      if (matchMedia("(pointer: fine)").matches) body.value?.focusComposer();
      else pane.value?.focus({ preventScroll: true });
    } else {
      await nextTick();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }
  },
  { immediate: true },
);
watch(width, (value) =>
  document.documentElement.style.setProperty(
    "--assistant-dock-width",
    assistantPanel.open ? `${value}px` : "0px",
  ),
);
onMounted(() => {
  resizeViewport();
  window.addEventListener("keydown", shortcut);
  window.addEventListener("resize", resizeViewport);
  visualViewport?.addEventListener("resize", resizeViewport);
  visualViewport?.addEventListener("scroll", resizeViewport);
});
onBeforeUnmount(() => {
  endDrag?.();
  if (mobileOverflow !== undefined)
    document.body.style.overflow = mobileOverflow;
  window.removeEventListener("keydown", shortcut);
  window.removeEventListener("resize", resizeViewport);
  visualViewport?.removeEventListener("resize", resizeViewport);
  visualViewport?.removeEventListener("scroll", resizeViewport);
  document.documentElement.classList.remove("assistant-is-open");
  document.documentElement.style.removeProperty("--assistant-dock-width");
  assistantPanel.open = false;
  assistantPanel.mounted = false;
  assistantPanel.busy = false;
  assistantPanel.projectId = undefined;
});
</script>
<template>
  <aside
    v-if="assistantPanel.mounted"
    v-show="assistantPanel.open"
    id="global-ai-assistant"
    ref="pane"
    class="assistant-dock"
    :style="{ ...viewport, width: `${width}px` }"
    :aria-label="t('AI 工作助手')"
    tabindex="-1"
  >
    <div
      class="assistant-resize"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('调整 AI 侧边栏宽度')"
      :aria-valuenow="Math.round(width)"
      :aria-valuemin="380"
      :aria-valuemax="760"
      tabindex="0"
      @pointerdown="drag"
      @keydown="adjust"
    />
    <header class="assistant-header">
      <PhSparkle :size="22" weight="duotone" class="assistant-symbol" />
      <div class="assistant-heading">
        <strong>{{ t("AI 工作助手") }}</strong
        ><span
          >{{ contextLabel
          }}<button
            v-if="project"
            type="button"
            class="icon-button"
            :aria-label="t('切换到全工作区')"
            @click="assistantPanel.projectId = null"
          >
            <PhX :size="12" /></button
        ></span>
      </div>
      <button
        type="button"
        class="icon-button assistant-expand"
        :aria-label="wide ? t('恢复侧栏宽度') : t('展开助手宽度')"
        @click="wide = !wide"
      >
        <PhArrowsInSimple v-if="wide" :size="17" /><PhArrowsOutSimple
          v-else
          :size="17"
        />
      </button>
      <button
        type="button"
        class="icon-button"
        :aria-label="t('收起 AI 助手')"
        :title="t('收起，保留对话')"
        @click="collapseAssistant"
      >
        <PhSidebarSimple :size="19" />
      </button>
    </header>
    <MeetingsView
      ref="body"
      assistant
      embedded
      :active="assistantPanel.open"
      :context-project-id="project?.id"
      @busy-change="assistantPanel.busy = $event"
      @restore-context="assistantPanel.projectId = $event"
      @result="!assistantPanel.open && (assistantPanel.unread = true)"
    />
  </aside>
</template>
<style scoped>
.assistant-dock {
  position: fixed;
  z-index: 80;
  right: 0;
  top: 52px;
  height: calc(100dvh - 52px);
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--surface);
  box-shadow: -6px 0 24px rgb(15 23 42 / 4%);
  outline: none;
}
.assistant-header {
  display: flex;
  align-items: center;
  gap: 11px;
  flex: none;
  min-height: 78px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.assistant-symbol {
  color: var(--accent);
  flex: none;
}
.assistant-heading {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.assistant-heading strong {
  font-size: 16px;
}
.assistant-heading span {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--muted);
}
.assistant-heading span button {
  padding: 1px;
  min-height: 20px;
  min-width: 20px;
  margin-left: 5px;
}
.assistant-resize {
  position: absolute;
  left: -4px;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}
.assistant-resize:focus-visible {
  outline: 2px solid var(--accent);
}
.assistant-header > button {
  min-height: 36px;
  min-width: 36px;
}
@media (max-width: 760px) {
  .assistant-dock {
    inset: var(--assistant-top, 0px) 0 auto;
    width: 100% !important;
    height: var(--assistant-height, 100dvh);
    z-index: 300;
    border: 0;
  }
  .assistant-header {
    padding: max(10px, env(safe-area-inset-top)) 12px 10px;
    min-height: 68px;
  }
  .assistant-resize,
  .assistant-expand {
    display: none;
  }
  .assistant-header > button {
    min-height: 44px;
    min-width: 44px;
  }
}
</style>
