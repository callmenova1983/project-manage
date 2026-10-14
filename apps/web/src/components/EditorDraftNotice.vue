<script setup lang="ts">
import { t } from "../locales";
defineProps<{
  pending: boolean;
  status: string;
  checking: boolean;
  problem: string;
  preview: string;
}>();
defineEmits<{ restore: []; discard: [] }>();
</script>
<template>
  <section
    v-if="pending"
    class="editor-draft-notice"
    :aria-label="t('Unsubmitted editor draft')"
  >
    <p>
      <strong>{{ t("Unsubmitted editor draft") }}</strong>
    </p>
    <p>
      {{
        t(
          "Kept for this account and item in this tab for up to 24 hours. Nothing is restored until you choose it and the latest version is checked.",
        )
      }}
    </p>
    <p v-if="problem" role="alert">{{ t(problem) }}</p>
    <details v-if="preview">
      <summary>{{ t("View saved draft contents") }}</summary>
      <pre tabindex="0">{{ preview }}</pre>
    </details>
    <p v-else>
      {{ t("This draft could not be read. Discard it to start again.") }}
    </p>
    <div class="form-actions">
      <button type="button" :disabled="checking" @click="$emit('discard')">
        {{ t("Discard draft") }}</button
      ><button
        v-if="preview"
        type="button"
        :disabled="checking"
        @click="$emit('restore')"
      >
        {{
          t(checking ? "Checking latest version…" : "Check and restore draft")
        }}
      </button>
    </div>
  </section>
  <p v-if="status === 'unavailable'" class="error-box" role="alert">
    {{
      t(
        "Editor draft storage is unavailable. Keep this editor open and copy your changes; they may not survive a refresh.",
      )
    }}
  </p>
  <p v-else-if="status === 'saved'" class="muted" role="status">
    {{
      t(
        "Unsubmitted edits kept in this tab for 24 hours. Reopen this editor after refreshing to recover them.",
      )
    }}
  </p>
  <p v-else-if="status === 'expired'" class="muted" role="status">
    {{ t("The previous temporary draft expired after 24 hours.") }}
  </p>
</template>
<style scoped>
.editor-draft-notice {
  border: 1px solid var(--border-strong);
  padding: 12px;
  border-radius: 8px;
  margin: 12px 0;
}
.editor-draft-notice p {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.editor-draft-notice pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
  font-size: 12px;
}
</style>
