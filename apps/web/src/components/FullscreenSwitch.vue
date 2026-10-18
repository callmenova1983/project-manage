<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { PhCornersIn, PhCornersOut } from "@phosphor-icons/vue";
import { t } from "../locales";

defineProps<{ labelled?: boolean }>();
const emit = defineEmits<{ change: [] }>();
const active = ref(false);
const supported = ref(false);
const busy = ref(false);
const failed = ref(false);
const label = computed(() =>
  t(
    !supported.value
      ? "Fullscreen is unavailable in this browser"
      : active.value
        ? "Exit fullscreen"
        : "Enter fullscreen",
  ),
);
function sync() {
  active.value = !!document.fullscreenElement;
}
onMounted(() => {
  supported.value =
    !!document.fullscreenEnabled &&
    typeof document.documentElement.requestFullscreen === "function";
  sync();
  document.addEventListener("fullscreenchange", sync);
});
onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", sync);
});
async function toggle() {
  if (busy.value || !supported.value) return;
  busy.value = true;
  failed.value = false;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    emit("change");
  } catch {
    failed.value = true;
  } finally {
    sync();
    busy.value = false;
  }
}
</script>

<template>
  <div class="fullscreen-control" :class="{ 'with-label': labelled }">
    <button
      type="button"
      :class="[labelled ? 'nav-item' : 'icon-button', 'fullscreen-switch']"
      :aria-label="label"
      :title="label"
      :aria-pressed="active"
      :disabled="busy || !supported"
      @click="toggle"
    >
      <PhCornersIn v-if="active" :size="19" aria-hidden="true" />
      <PhCornersOut v-else :size="19" aria-hidden="true" />
      <span v-if="labelled">{{ label }}</span>
    </button>
    <p v-if="failed" role="status" class="fullscreen-error">
      {{ t("Could not enter or exit fullscreen. Try opening in a browser.") }}
    </p>
  </div>
</template>

<style scoped>
.fullscreen-control {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}
.with-label,
.with-label button {
  width: 100%;
}
.fullscreen-error {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 50;
  width: min(280px, calc(100vw - 24px));
  margin: 6px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  box-shadow: var(--shadow-popover);
}
</style>
