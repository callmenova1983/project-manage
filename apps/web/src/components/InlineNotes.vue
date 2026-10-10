<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  projectInput,
  noteDateCandidates,
  type Project,
} from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved } from "../composables/unsaved";
import { api, ApiError } from "../services/api";
import SaveError from "./SaveError.vue";
const props = defineProps<{ project: Project }>();
const store = useWorkspace();
const original = ref(props.project),
  draft = ref(props.project.notes),
  error = ref<Error | ApiError | null>(null);
const dirty = computed(() => draft.value !== original.value.notes);
const discard = useUnsaved(dirty);
watch(
  () => props.project,
  (p) => {
    if (!dirty.value) {
      original.value = p;
      draft.value = p.notes;
    }
  },
);
const candidates = computed(() => noteDateCandidates(draft.value));
const review = ref<number | null>(null),
  taskId = ref(""),
  dueDate = ref(""),
  confirmed = ref(false),
  overwrite = ref(false);
const selected = computed(() =>
  store.data.tasks.find((t) => t.id === taskId.value),
);
const tasks = computed(() =>
  store.data.tasks.filter((t) => t.projectId === props.project.id),
);
function resetReview() {
  review.value = null;
  confirmed.value = false;
  overwrite.value = false;
}
function cancel() {
  if (discard()) {
    draft.value = original.value.notes;
    error.value = null;
    resetReview();
  }
}
function reload() {
  const current = (error.value as ApiError).current as Project;
  original.value = current;
  draft.value = current.notes;
  error.value = null;
  resetReview();
}
async function save() {
  error.value = null;
  try {
    const p = await store.saveProject(
      { ...projectInput.strip().parse(original.value), notes: draft.value },
      original.value,
    );
    original.value = p;
    draft.value = p.notes;
    resetReview();
  } catch (e) {
    error.value = e as Error;
  }
}
async function applyDate(line: number) {
  if (!selected.value) return;
  error.value = null;
  try {
    await store.operation(
      () =>
        api.confirmNoteDate(props.project.id, {
          projectVersion: original.value.version,
          sourceLine: line,
          taskId: taskId.value,
          taskVersion: selected.value!.version,
          dueDate: dueDate.value,
          confirmed: true,
          overwriteConfirmed: overwrite.value,
        }),
      "Reviewed date saved",
    );
    resetReview();
  } catch (e) {
    error.value = new Error((e as Error).message);
  }
}
</script>
<template>
  <section class="inline-notes">
    <div class="section-heading">
      <h4>Original notes</h4>
      <span class="muted"
        >{{ dirty ? "Unsaved changes" : "Text / table paste" }} · v{{
          original.version
        }}</span
      >
    </div>
    <SaveError :error="error" @reload="reload" />
    <form @submit.prevent="save">
      <textarea
        v-model="draft"
        :aria-label="`Original notes for ${project.name}`"
        rows="5"
        maxlength="20000"
        placeholder="Capture what happened. Paste notes or a table here…"
        @input="resetReview"
      ></textarea>
      <div v-if="dirty" class="form-actions">
        <button type="button" :disabled="store.busy" @click="cancel">
          Cancel notes</button
        ><button class="primary" :disabled="store.busy">Save notes</button>
      </div>
    </form>
    <div v-for="c in candidates" :key="c.sourceLine" class="date-candidate">
      <button
        class="text-button amber"
        :disabled="dirty"
        @click="
          review = review === c.sourceLine ? null : c.sourceLine;
          dueDate = c.proposedDate;
          confirmed = false;
          overwrite = false;
        "
      >
        Review date · “{{ c.phrase }}” · line {{ c.sourceLine }}
      </button>
      <span v-if="dirty" class="muted">Save notes to review dates</span>
      <form
        v-if="review === c.sourceLine && !dirty"
        class="date-review"
        @submit.prevent="applyDate(c.sourceLine)"
      >
        <p class="muted">
          Rule-assisted candidate. Read the neighboring lines and choose the
          intended date.
        </p>
        <pre>{{ c.context }}</pre>
        <label
          >Apply to task<select
            v-model="taskId"
            required
            @change="
              confirmed = false;
              overwrite = false;
            "
          >
            <option value="">Choose a task</option>
            <option v-for="t in tasks" :key="t.id" :value="t.id">
              {{ t.title }}
            </option>
          </select></label
        >
        <label
          >Confirmed due date<input
            v-model="dueDate"
            type="date"
            required
            @input="
              confirmed = false;
              overwrite = false;
            "
        /></label>
        <p v-if="selected" class="muted">
          Current due date: {{ selected.dueDate ?? "None" }}
        </p>
        <label class="check-label"
          ><input v-model="confirmed" type="checkbox" />I checked the source,
          task and date</label
        >
        <label
          v-if="selected?.dueDate && selected.dueDate !== dueDate"
          class="check-label"
          ><input v-model="overwrite" type="checkbox" />Replace the existing due
          date</label
        >
        <div class="form-actions">
          <button type="button" @click="resetReview">Cancel review</button
          ><button
            class="primary"
            :disabled="
              !selected ||
              !dueDate ||
              !confirmed ||
              (!!selected.dueDate &&
                selected.dueDate !== dueDate &&
                !overwrite) ||
              store.busy
            "
          >
            Apply reviewed date
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
