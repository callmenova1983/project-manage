<script setup lang="ts">
import { t, formatNumber } from "../locales";
import type { ApiError } from "../services/api";
import { useWorkspace } from "../stores/workspace";
const store = useWorkspace();
defineProps<{
  error: Error | ApiError | null;
  taskLabels?: Record<string, string>;
}>();
defineEmits<{ reload: [] }>();
</script>
<template>
  <div v-if="error" class="error-box" role="alert">
    <strong>{{ t("Changes could not be saved") }}</strong>
    <p>{{ t(error.message) }}</p>
    <ul v-if="'issues' in error && error.issues">
      <li v-for="issue in error.issues" :key="issue.path">
        {{ issue.path }}: {{ issue.message }}
      </li>
    </ul>
    <ul v-if="'conflicts' in error && error.conflicts">
      <li v-for="conflict in error.conflicts" :key="conflict.id">
        {{
          taskLabels?.[conflict.id] ??
          store.data.tasks.find((task) => task.id === conflict.id)?.title ??
          t("Task unavailable")
        }}: {{ t(conflict.reason)
        }}<span v-if="conflict.currentVersion !== null">
          ·
          {{
            t("Latest saved version {version}:", {
              version: formatNumber(conflict.currentVersion),
            })
          }}</span
        >
      </li>
    </ul>
    <div v-if="'current' in error && error.current" class="conflict">
      <p>
        {{
          t("Latest saved version {version}:", {
            version: formatNumber(error.current.version),
          })
        }}
      </p>
      <pre>{{ JSON.stringify(error.current, null, 2) }}</pre>
      <p>
        {{
          t(
            "Your unsaved fields remain in the editor below. Copy anything you want to keep, then load the latest version.",
          )
        }}
      </p>
      <button type="button" @click="$emit('reload')">
        {{ t("Load latest version") }}
      </button>
    </div>
  </div>
</template>
