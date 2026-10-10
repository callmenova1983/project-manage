<script setup lang="ts">
import {
  PhCircle,
  PhCheckCircle,
  PhCircleHalf,
  PhWarningCircle,
} from "@phosphor-icons/vue";
import { statusLabels, stageLabels } from "../locales/en";
import type { Status, Stage } from "../../../../packages/domain/types";
defineProps<{ status?: Status; stage?: Stage }>();
const icons = {
  todo: PhCircle,
  in_progress: PhCircleHalf,
  done: PhCheckCircle,
  blocked: PhWarningCircle,
};
</script>
<template>
  <span v-if="status" class="badge" :class="status"
    ><component :is="icons[status]" :size="14" />{{
      statusLabels[status]
    }}</span
  ><span v-else-if="stage" class="badge" :class="stage"
    ><PhCircleHalf :size="13" />{{ stageLabels[stage] }}</span
  >
</template>
