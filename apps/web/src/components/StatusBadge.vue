<script setup lang="ts">
import {
  PhCircle,
  PhLightbulb,
  PhChatsCircle,
  PhClipboardText,
  PhWrench,
  PhRocketLaunch,
  PhCheckCircle,
  PhCircleHalf,
  PhWarningCircle,
} from "@phosphor-icons/vue";
import { statusLabels, stageLabels } from "../locales/en";
import type { Status, Stage } from "../../../../packages/domain/types";
defineProps<{ status?: Status; stage?: Stage; iconOnly?: boolean }>();
const icons = {
  todo: PhCircle,
  in_progress: PhCircleHalf,
  done: PhCheckCircle,
  blocked: PhWarningCircle,
};
const stageIcons = {
  potential: PhLightbulb,
  proposal: PhChatsCircle,
  approved: PhClipboardText,
  implementation: PhWrench,
  operations: PhRocketLaunch,
};
</script>
<template>
  <span
    v-if="status"
    class="badge"
    :class="status"
    :title="statusLabels[status]"
    ><component :is="icons[status]" :size="14" /><span
      :class="{ 'status-label-hidden': iconOnly }"
      >{{ statusLabels[status] }}</span
    ></span
  ><span v-else-if="stage" class="badge" :class="stage"
    ><component :is="stageIcons[stage]" :size="14" />{{
      stageLabels[stage]
    }}</span
  >
</template>
<style scoped>
.badge {
  position: relative;
}
.status-label-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
