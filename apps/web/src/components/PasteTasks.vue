<script setup lang="ts">
import { ref, computed } from "vue";
import {
  parsePaste,
  taskInput,
  weekKey,
} from "../../../../packages/domain/types";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved } from "../composables/unsaved";
const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspace();
const text = ref(""),
  error = ref(""),
  review = ref(false);
const dirty = computed(() => !!text.value);
const discard = useUnsaved(dirty);
const rows = computed(() => parsePaste(text.value));
async function save() {
  error.value = "";
  try {
    if (rows.value.length < 1 || rows.value.length > 100)
      throw new Error("Paste between 1 and 100 rows.");
    const tasks = rows.value.map((r) =>
      taskInput.parse({
        ...r,
        projectId: props.projectId,
        parentId: null,
        status: "todo",
        description: "",
        workWeek: weekKey(),
        workDates: [],
      }),
    );
    await store.operation(
      () => api.addTasks(tasks),
      `${tasks.length} tasks added`,
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
    <h3>Paste tasks</h3>
    <p class="muted">
      One task per line, or paste spreadsheet columns: title, assignee, due date
      (YYYY-MM-DD). Review before saving.
    </p>
    <label
      >Source text<textarea
        v-model="text"
        rows="5"
        maxlength="20000"
        @input="review = false"
      ></textarea>
    </label>
    <div v-if="review" class="paste-preview">
      <h4>{{ rows.length }} tasks to create</h4>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Assignee</th>
            <th>Due date</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i">
            <td>{{ r.title }}</td>
            <td>{{ r.assignee }}</td>
            <td>{{ r.dueDate || "No date" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="error" role="alert" class="error-box">{{ error }}</p>
    <div class="form-actions">
      <button :disabled="store.busy" @click="discard() && emit('close')">
        Cancel</button
      ><button
        v-if="!review"
        class="primary"
        :disabled="!rows.length"
        @click="review = true"
      >
        Review {{ rows.length }} tasks</button
      ><button v-else class="primary" :disabled="store.busy" @click="save">
        {{ store.busy ? "Saving…" : "Save tasks" }}
      </button>
    </div>
  </section>
</template>
