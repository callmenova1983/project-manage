<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { useUnsaved } from "../composables/unsaved";
import { t } from "../locales";
import {
  defaultWorkspaceSettings,
  timeZoneInput,
} from "../../../../packages/domain/time-zone";
const store = useWorkspace();
const original = ref({ ...(store.data.settings ?? defaultWorkspaceSettings) });
const zone = ref(original.value.timeZone),
  confirmed = ref(false),
  error = ref("");
const dirty = computed(() => zone.value !== original.value.timeZone);
useUnsaved(dirty);
const editable = computed(
  () => store.mode === "local" || store.user?.role === "admin",
);
const zones = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "Australia/Lord_Howe",
];
function reset() {
  original.value = { ...(store.data.settings ?? defaultWorkspaceSettings) };
  zone.value = original.value.timeZone;
  confirmed.value = false;
  error.value = "";
}
watch(
  () => store.data.settings,
  () => {
    if (!dirty.value) reset();
  },
);
watch(zone, () => (confirmed.value = false));
async function cancelOrReload() {
  if (error.value) {
    try {
      await store.refresh(true);
    } catch (e) {
      error.value = (e as Error).message;
      return;
    }
  }
  reset();
}
async function save() {
  error.value = "";
  if (!confirmed.value || !dirty.value || store.busy) return;
  if (!timeZoneInput.safeParse(zone.value).success) {
    error.value = "Choose a valid IANA time zone";
    return;
  }
  try {
    const saved = await store.operation(
      () =>
        api.saveWorkspaceSettings({
          ...original.value,
          timeZone: zone.value,
          confirmed: true,
        }),
      "Workspace time zone updated",
    );
    original.value = saved;
    zone.value = saved.timeZone;
    confirmed.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <section class="panel timezone-panel">
    <h2>{{ t("Workspace time zone") }}</h2>
    <p class="muted">
      {{
        t(
          "Today, weekly work, history and exports use this shared time zone. Existing task dates and recorded timestamps are preserved. Older workspaces keep UTC until explicitly changed.",
        )
      }}
    </p>
    <p>{{ t("Current time zone: {zone}", { zone: store.timeZone }) }}</p>
    <form v-if="editable" @submit.prevent="save">
      <label
        >{{ t("IANA time zone")
        }}<input
          v-model="zone"
          list="workspace-zones"
          autocomplete="off"
          required
          :disabled="store.busy"
      /></label>
      <datalist id="workspace-zones">
        <option v-for="item in zones" :key="item" :value="item" />
      </datalist>
      <p class="muted">
        {{
          t(
            "For Beijing, choose Asia/Shanghai. Daylight saving time follows the selected region's rules.",
          )
        }}
      </p>
      <label v-if="dirty" class="check-label"
        ><input v-model="confirmed" type="checkbox" :disabled="store.busy" />{{
          t(
            "I confirm changing the shared calendar for everyone in this workspace",
          )
        }}</label
      >
      <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
      <div v-if="dirty || error" class="form-actions">
        <button type="button" :disabled="store.busy" @click="cancelOrReload">
          {{ t(error ? "Reload current settings" : "Cancel time zone change") }}
        </button>
        <button class="primary" :disabled="!dirty || !confirmed || store.busy">
          {{ t("Save time zone") }}
        </button>
      </div>
    </form>
    <p v-else class="muted">
      {{ t("An administrator can change the workspace time zone.") }}
    </p>
  </section>
</template>
<style scoped>
.timezone-panel input:not([type="checkbox"]) {
  display: block;
  margin-top: 8px;
  max-width: 420px;
  width: 100%;
}
.timezone-panel .check-label {
  white-space: normal;
  align-items: flex-start;
}
</style>
