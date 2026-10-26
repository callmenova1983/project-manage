<script setup lang="ts">
import { PhMoon, PhSun } from "@phosphor-icons/vue";
import { useTheme } from "../composables/theme";
import { t } from "../locales";

const { theme, toggleTheme } = useTheme();
</script>

<template>
  <button
    type="button"
    class="theme-switch icon-button"
    :aria-label="
      t(theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')
    "
    :title="
      t(theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')
    "
    @click="toggleTheme"
  >
    <PhSun v-if="theme === 'dark'" :size="19" aria-hidden="true" />
    <PhMoon v-else :size="19" aria-hidden="true" />
  </button>
</template>
