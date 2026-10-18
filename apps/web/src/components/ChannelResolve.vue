<script setup lang="ts">
import { t } from "../locales";
import { ref } from "vue";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { channelEntries } from "../../../../packages/domain/channels";
import { normalizeName } from "../../../../packages/domain/intake-text";
const props = defineProps<{ name: string }>();
const emit = defineEmits<{ resolved: [string] }>();
const store = useWorkspace(),
  error = ref("");
async function create() {
  error.value = "";
  try {
    const id = await store.operation(async () => {
      const catalog = await api.catalogs(),
        channels = channelEntries(catalog);
      const existing = channels.find(
        (c) =>
          !c.archived &&
          [c.id, c.name, c.shortName].some(
            (n) => normalizeName(n) === normalizeName(props.name),
          ),
      );
      if (existing) return existing.id;
      const id = "channel-" + crypto.randomUUID().slice(0, 8);
      await api.saveCatalogs({
        ...catalog,
        channels: [
          ...channels,
          { id, name: props.name, shortName: props.name, archived: false },
        ],
      });
      return id;
    }, t("渠道已添加"));
    emit("resolved", id);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <div class="channel-resolution">
    <span>{{ t("已识别“") }}{{ name }}{{ t("”，尚未登记。") }}</span>
    <button
      v-if="store.user?.role === 'admin' && name.length <= 40"
      class="text-button"
      type="button"
      :disabled="store.busy"
      @click="create"
    >
      {{ t("新增并选用“") }}{{ name }}”
    </button>
    <span v-else>{{ t("请选择已有渠道，或联系管理员新增。") }}</span>
    <span v-if="error" class="error-text" role="alert">{{ t(error) }}</span>
  </div>
</template>
<style scoped>
.channel-resolution {
  font-size: 11px;
  white-space: normal;
  line-height: 1.5;
  margin-top: 3px;
}
.channel-resolution button {
  font-size: 11px;
  padding: 0;
  min-height: 24px;
}
.error-text {
  display: block;
  color: var(--danger);
}
</style>
