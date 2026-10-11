<script setup lang="ts">
import { catalogs, catalogLabel } from "../composables/catalogs";
import { t } from "../locales";
import { ref, computed } from "vue";
import {
  projectInput,
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
  stage: "unclassified",
  categoryIds: [],
  owner: "Unassigned",
  discipline: "Unassigned",
  latestUpdate: "",
  notes: "",
  aliases: [],
};
const draft = ref<ProjectInput>(
  props.project ? projectInput.strip().parse(props.project) : empty,
);
draft.value.categoryIds ??= [];
const stages = computed(() =>
  catalogs.value.stages
    .filter((s) => !s.archived || s.id === original.value?.stage)
    .sort((a, b) => a.order - b.order)
    .map((s) => s.id),
);
const categories = computed(() =>
  catalogs.value.categories
    .filter((c) => !c.archived || original.value?.categoryIds?.includes(c.id))
    .sort((a, b) => a.order - b.order),
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
  <form class="editor" :aria-label="t('Project editor')" @submit.prevent="save">
    <div class="section-heading">
      <h3>{{ t(project ? "Edit project" : "New project") }}</h3>
      <span v-if="dirty" class="muted">{{ t("Unsaved changes") }}</span>
    </div>
    <SaveError :error="error" @reload="reload" />
    <div class="form-grid">
      <label
        >{{ t("Project name")
        }}<input
          v-model="draft.name"
          required
          maxlength="120"
          autofocus
          :placeholder="t('A clear, memorable name')" /></label
      ><label
        >{{ t("Client / organization")
        }}<input
          v-model="draft.client"
          maxlength="120"
          :placeholder="t('Organization name')" /></label
      ><label
        >{{ t("Stage")
        }}<select v-model="draft.stage">
          <option value="unclassified">{{ stageLabels.unclassified }}</option>
          <option v-for="s in stages" :key="s" :value="s">
            {{ stageLabels[s] }}
          </option>
        </select></label
      ><label
        >{{ t("Owner") }}<input v-model="draft.owner" maxlength="80" /></label
      ><label
        >{{ t("Responsibility")
        }}<select v-model="draft.discipline">
          <option v-for="d in disciplines" :key="d" :value="d">
            {{ t(d) }}
          </option>
        </select></label
      ><label
        >{{ t("Aliases, comma separated")
        }}<input
          v-model="aliases"
          :placeholder="t('Alternative names for matching')"
      /></label>
      <fieldset v-if="categories.length" class="full category-options">
        <legend>{{ t("Business categories") }}</legend>
        <label v-for="category in categories" :key="category.id"
          ><input
            v-model="draft.categoryIds"
            type="checkbox"
            :value="category.id"
          />{{ catalogLabel("categories", category.id)
          }}<small v-if="category.archived">{{ t("Archived") }}</small></label
        >
      </fieldset>
      <label class="full"
        >{{ t("Description")
        }}<textarea
          v-model="draft.description"
          rows="2"
          maxlength="4000"
        ></textarea></label
      ><label class="full"
        >{{ t("Latest reported update")
        }}<textarea
          v-model="draft.latestUpdate"
          rows="3"
          maxlength="4000"
          :placeholder="t('What happened? What was completed? What is next?')"
        ></textarea></label
      ><label class="full"
        >{{ t("Working notes — paste free text or a table")
        }}<textarea
          v-model="draft.notes"
          rows="4"
          maxlength="20000"
          :placeholder="
            t(
              'Notes stay as editable text. Paste task rows in the task section to create tasks.',
            )
          "
        ></textarea>
      </label>
    </div>
    <div class="form-actions">
      <button type="button" :disabled="store.busy" @click="cancel">
        {{ t("Cancel") }}</button
      ><button class="primary" :disabled="store.busy" type="submit">
        {{ t(store.busy ? "Saving…" : "Save project") }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.category-options {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.category-options label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.category-options input {
  width: auto;
}
.category-options small {
  color: var(--muted);
}
</style>
