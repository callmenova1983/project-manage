<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { PhPalette, PhCheck } from "@phosphor-icons/vue";
import { ACCENTS, useTheme } from "../composables/theme";
import { t } from "../locales";
const { accent, setAccent } = useTheme();
const open = ref(false),
  root = ref<HTMLElement>();
const labels = {
  blue: "Ocean blue",
  teal: "Teal",
  green: "Forest green",
  orange: "Warm orange",
};
const colors = {
  blue: "#409eff",
  teal: "#14b8a6",
  green: "#22c55e",
  orange: "#f59e0b",
};
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener("pointerdown", outside));
onUnmounted(() => document.removeEventListener("pointerdown", outside));
</script>
<template>
  <div ref="root" class="accent-picker" @keydown.esc="open = false">
    <button
      class="icon-button"
      :aria-label="t('Theme color')"
      :title="t('Theme color')"
      :aria-expanded="open"
      @click="open = !open"
    >
      <PhPalette :size="19" />
    </button>
    <div
      v-if="open"
      class="accent-popover"
      role="group"
      :aria-label="t('Theme color')"
    >
      <strong>{{ t("Theme color") }}</strong>
      <button
        v-for="value in ACCENTS"
        :key="value"
        :aria-pressed="accent === value"
        @click="setAccent(value)"
      >
        <span
          class="accent-swatch"
          :style="{ background: colors[value] }"
        ></span
        >{{ t(labels[value]) }}<PhCheck v-if="accent === value" :size="16" />
      </button>
    </div>
  </div>
</template>
<style scoped>
.accent-picker {
  position: relative;
}
.accent-picker > button {
  color: var(--accent);
}
.accent-popover {
  position: absolute;
  top: 46px;
  right: 0;
  z-index: 100;
  min-width: 172px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-popover);
}
.accent-popover strong {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin: 0 8px 8px;
}
.accent-popover button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 38px;
  padding: 8px;
  border: 0;
  background: transparent;
  text-align: left;
}
.accent-popover button[aria-pressed="true"] {
  background: var(--accent-bg);
  color: var(--accent);
}
.accent-swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
}
.accent-popover svg {
  margin-left: auto;
}
</style>
