<script setup lang="ts">
import { computed } from "vue";
import { PhBuildings } from "@phosphor-icons/vue";
import { t } from "../locales";
const props = defineProps<{ client: string }>();
const name = computed(() => {
  const value = props.client.trim();
  return ["客户待补", "Client to complete"].includes(value) ? "" : value;
});
</script>
<template>
  <span v-if="name" class="client-label" :title="t('Client') + '：' + name"
    ><PhBuildings :size="12" aria-hidden="true" /><span>{{ name }}</span></span
  >
</template>
<style scoped>
.client-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  margin-top: 3px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
  vertical-align: middle;
}
.client-label > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.client-label svg {
  flex: none;
  color: var(--accent);
}
</style>
