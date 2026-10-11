<script setup lang="ts">
import { ref } from "vue";
import { api } from "../services/api";
import { t } from "../locales";
import PreferencesControls from "./PreferencesControls.vue";
const props = defineProps<{ token: string }>();
const emit = defineEmits<{ done: [] }>();
const password = ref(""),
  repeat = ref(""),
  error = ref(""),
  busy = ref(false),
  complete = ref(false);
async function activate() {
  error.value = "";
  if (password.value !== repeat.value) {
    error.value = "Passwords do not match";
    return;
  }
  busy.value = true;
  try {
    await api.activateAccount(props.token, password.value);
    password.value = "";
    repeat.value = "";
    complete.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="login-shell">
    <form class="login-card" @submit.prevent="activate">
      <PreferencesControls />
      <h1>{{ t("Activate your account") }}</h1>
      <template v-if="!complete"
        ><p class="muted">
          {{
            t(
              "Set your own password. Activation links expire after 24 hours and can be used once.",
            )
          }}
        </p>
        <label
          >{{ t("New password")
          }}<input
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
            minlength="14"
            maxlength="500" /></label
        ><label
          >{{ t("Repeat password")
          }}<input
            v-model="repeat"
            type="password"
            autocomplete="new-password"
            required
            minlength="14"
            maxlength="500"
        /></label>
        <p class="muted">{{ t("Use at least 14 characters.") }}</p>
        <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
        <button class="primary" :disabled="busy" type="submit">
          {{ t(busy ? "Saving…" : "Activate account") }}
        </button></template
      ><template v-else
        ><p role="status">
          {{ t("Account activated. Sign in with your new password.") }}
        </p>
        <button class="primary" type="button" @click="emit('done')">
          {{ t("Continue to sign in") }}
        </button></template
      >
    </form>
  </main>
</template>
