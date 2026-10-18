<script setup lang="ts">
import { currentWeek } from "../composables/calendar";
import { t, formatDate, formatNumber } from "../locales";
import { ref, computed } from "vue";
import { parsePaste, taskInput } from "../../../../packages/domain/types";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved } from "../composables/unsaved";
import CaptureInput from "./CaptureInput.vue";
const capture = ref<InstanceType<typeof CaptureInput>>();
const props = defineProps<{ projectId: string; unscheduled?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspace();
const text = ref(""),
  error = ref(""),
  review = ref(false);
const dirty = computed(() => !!text.value || !!capture.value?.hasFiles);
const discard = useUnsaved(dirty);
const rows = computed(() => parsePaste(text.value));
async function preview() {
  error.value = "";
  try {
    if (capture.value) text.value = (await capture.value.resolveSource()).text;
    review.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function save() {
  error.value = "";
  try {
    if (rows.value.length < 1 || rows.value.length > 100)
      throw new Error(t("Paste between 1 and 100 rows."));
    const tasks = rows.value.map((r) =>
      taskInput.parse({
        ...r,
        projectId: props.projectId,
        parentId: null,
        status: "todo",
        description: "",
        workWeek: props.unscheduled ? null : currentWeek(),
        workDates: [],
      }),
    );
    await store.operation(
      () => api.addTasks(tasks),
      t("{count} tasks added", { count: formatNumber(tasks.length) }),
    );
    text.value = "";
    emit("close");
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <section class="editor">
    <h3>{{ t("Paste tasks") }}</h3>
    <p class="muted">
      {{
        t(
          "One task per line, or paste spreadsheet columns: title, assignee, due date (YYYY-MM-DD). Review before saving.",
        )
      }}
    </p>
    <CaptureInput
      ref="capture"
      v-model="text"
      :rows="5"
      :label="t('Source text')"
      :disabled="store.busy"
      :maxlength="20000"
      @update:model-value="review = false"
      @change="review = false"
      @submit="review ? save() : preview()"
    />
    <div v-if="review" class="paste-preview">
      <h4>
        {{ t("{count} tasks to create", { count: formatNumber(rows.length) }) }}
      </h4>
      <table>
        <thead>
          <tr>
            <th>{{ t("Title") }}</th>
            <th>{{ t("Assignee") }}</th>
            <th>{{ t("Due date") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i">
            <td>{{ r.title }}</td>
            <td>{{ r.assignee }}</td>
            <td>{{ r.dueDate ? formatDate(r.dueDate) : t("No date") }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="error" role="alert" class="error-box">{{ t(error) }}</p>
    <div class="form-actions">
      <button :disabled="store.busy" @click="discard() && emit('close')">
        {{ t("Cancel") }}</button
      ><button
        v-if="!review"
        class="primary"
        :disabled="(!rows.length && !capture?.hasFiles) || !!capture?.busy"
        @click="preview"
      >
        {{
          t("Review {count} tasks", { count: formatNumber(rows.length) })
        }}</button
      ><button v-else class="primary" :disabled="store.busy" @click="save">
        {{ t(store.busy ? "Saving…" : "Save tasks") }}
      </button>
    </div>
  </section>
</template>
