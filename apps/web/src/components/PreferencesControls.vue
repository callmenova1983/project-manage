<script setup lang="ts">
import { locale, setLocale, t } from "../locales";
import AccentSwitch from "./AccentSwitch.vue";
import ThemeSwitch from "./ThemeSwitch.vue";
</script>
<template>
  <div class="preferences-controls">
    <select
      :value="locale"
      :aria-label="t('Language')"
      class="language-select"
      @change="setLocale(($event.target as HTMLSelectElement).value)"
    >
      <option value="en" lang="en">EN</option>
      <option value="zh-CN" :lang="locale === 'en' ? 'en' : 'zh-CN'">
        {{ locale === "en" ? "Chinese" : t("中文") }}
      </option>
    </select>
    <AccentSwitch />
    <ThemeSwitch />
  </div>
</template>
<style scoped>
.preferences-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.language-select {
  width: 72px;
  min-height: 44px;
  padding: 8px;
  font-size: 12px;
  background: var(--surface);
  color: var(--text);
}
</style>
