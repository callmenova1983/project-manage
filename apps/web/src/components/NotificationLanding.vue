<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PhArrowClockwise } from "@phosphor-icons/vue";
import { api } from "../services/api";
import { safeNotificationPath } from "../services/contracts";
import { useWorkspace } from "../stores/workspace";
import { t } from "../locales";

const route = useRoute();
const router = useRouter();
const store = useWorkspace();
const loading = ref(false);
const error = ref("");
async function open() {
  loading.value = true;
  error.value = "";
  try {
    const id = typeof route.params.id === "string" ? route.params.id : "";
    const result = await api.openNotification(id);
    const path = safeNotificationPath(result.path);
    // Opening the authenticated resolver is read-only; record the read only
    // through the account's protected mutation endpoint.
    await store.changeNotifications({ ids: [id], action: "read" });
    await router.replace(path);
  } catch (reason) {
    error.value = (reason as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(open);
</script>
<template>
  <section
    class="notification-landing"
    aria-labelledby="notification-opening-title"
  >
    <h1 id="notification-opening-title">
      {{ loading ? t("正在打开事项…") : t("打开消息") }}
    </h1>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <p v-else role="status">{{ t("正在读取最新状态和项目归属。") }}</p>
    <div v-if="error" class="landing-actions">
      <button :disabled="loading" @click="open">
        <PhArrowClockwise :size="16" />{{ t("重试") }}
      </button>
      <RouterLink to="/projects" class="button secondary">{{
        t("返回项目")
      }}</RouterLink>
    </div>
  </section>
</template>
<style scoped>
.notification-landing {
  width: min(560px, calc(100% - 32px));
  margin: 48px auto;
}
.notification-landing h1 {
  font-size: 20px;
}
.notification-landing > p {
  color: var(--muted);
  font-size: 14px;
}
.landing-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
}
</style>
