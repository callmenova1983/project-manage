<script setup lang="ts">
import { ref, computed } from "vue";
import {
  projectInput,
  stages,
  disciplines,
  type Project,
  type ProjectInput,
} from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved } from "../composables/unsaved";
import { stageLabels } from "../locales/en";
import SaveError from "./SaveError.vue";
import { ApiError } from "../services/api";
const props = defineProps<{ project?: Project }>();
const emit = defineEmits<{ close: []; saved: [Project] }>();
const store = useWorkspace();
const original = ref(props.project);
const empty: ProjectInput = {
  name: "",
  client: "",
  description: "",
  stage: "potential",
  owner: store.user?.name ?? "Unassigned",
  discipline: "Delivery",
  latestUpdate: "",
  notes: "",
  aliases: [],
};
const draft = ref<ProjectInput>(
  props.project ? projectInput.strip().parse(props.project) : empty,
);
const aliases = ref(draft.value.aliases.join(", "));
let baseline = JSON.stringify(draft.value);
const dirty = computed(
  () =>
    JSON.stringify(draft.value) !== baseline ||
    aliases.value !== draft.value.aliases.join(", "),
);
const mayDiscard = useUnsaved(dirty);
const error = ref<Error | ApiError | null>(null);
function cancel() {
  if (mayDiscard()) emit("close");
}
async function save() {
  error.value = null;
  try {
    draft.value.aliases = aliases.value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const input = projectInput.parse(draft.value);
    const result = await store.saveProject(input, original.value);
    baseline = JSON.stringify(draft.value);
    emit("saved", result);
  } catch (e) {
    error.value = e as Error;
  }
}
function reload() {
  const current = (error.value as ApiError).current as Project;
  original.value = current;
  draft.value = projectInput.strip().parse(current);
  aliases.value = current.aliases.join(", ");
  baseline = JSON.stringify(draft.value);
  error.value = null;
}
</script>
<template>
  <form class="editor" aria-label="Project editor" @submit.prevent="save">
    <div class="section-heading">
      <h3>{{ project ? "Edit project" : "New project" }}</h3>
      <span v-if="dirty" class="muted">Unsaved changes</span>
    </div>
    <SaveError :error="error" @reload="reload" />
    <div class="form-grid">
      <label
        >Project name<input
          v-model="draft.name"
          required
          maxlength="120"
          autofocus
          placeholder="A clear, memorable name" /></label
      ><label
        >Client / organization<input
          v-model="draft.client"
          required
          maxlength="120"
          placeholder="Organization name" /></label
      ><label
        >Stage<select v-model="draft.stage">
          <option v-for="s in stages" :key="s" :value="s">
            {{ stageLabels[s] }}
          </option>
        </select></label
      ><label
        >Owner<input v-model="draft.owner" required maxlength="80" /></label
      ><label
        >Responsibility<select v-model="draft.discipline">
          <option v-for="d in disciplines" :key="d">{{ d }}</option>
        </select></label
      ><label
        >Aliases, comma separated<input
          v-model="aliases"
          placeholder="Alternative names for matching" /></label
      ><label class="full"
        >Description<textarea
          v-model="draft.description"
          rows="2"
          maxlength="4000"
        ></textarea></label
      ><label class="full"
        >Latest reported update<textarea
          v-model="draft.latestUpdate"
          rows="3"
          maxlength="4000"
          placeholder="What happened? What was completed? What is next?"
        ></textarea></label
      ><label class="full"
        >Working notes — paste free text or a table<textarea
          v-model="draft.notes"
          rows="4"
          maxlength="20000"
          placeholder="Notes stay as editable text. Paste task rows in the task section to create tasks."
        ></textarea>
      </label>
    </div>
    <div class="form-actions">
      <button type="button" :disabled="store.busy" @click="cancel">
        Cancel</button
      ><button class="primary" :disabled="store.busy" type="submit">
        {{ store.busy ? "Saving…" : "Save project" }}
      </button>
    </div>
  </form>
</template>
