<script setup lang="ts">
import {
  channelEntries,
  projectChannel,
} from "../../../../packages/domain/channels";
import { catalogs, catalogLabel } from "../composables/catalogs";
import { t } from "../locales";
import { ref, computed, useId } from "vue";
import {
  locationKey,
  locationLabel,
  locationPrecisionLabel,
  resolveLocationText,
  type ProjectLocation,
} from "../../../../packages/domain/project-location";
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
import MemberAssignment from "./MemberAssignment.vue";
import EditorDraftNotice from "./EditorDraftNotice.vue";
import { useEditorDraft } from "../composables/editor-draft";
import { projectEditorDraft } from "../services/editor-drafts";
import { ApiError } from "../services/api";
const props = defineProps<{ project?: Project }>();
const emit = defineEmits<{ close: []; saved: [Project] }>();
const store = useWorkspace();
const original = ref(props.project);
const empty: ProjectInput = {
  name: "",
  client: "",
  channelId: "company",
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
draft.value.participantIds ??= [];
draft.value.channelId ??= "company";
const locationInputId = useId();
const locationInput = ref<HTMLInputElement>();
const locationTextValue = (location: ProjectInput["location"]) =>
  !location
    ? ""
    : location.precision === "point"
      ? `${location.longitude}, ${location.latitude}`
      : locationLabel(location);
const locationText = ref(locationTextValue(draft.value.location));
const locationPending = ref(false);
const locationMatches = computed(() => resolveLocationText(locationText.value));
function chooseLocation(location: ProjectLocation) {
  draft.value.location = { ...location, confirmed: true };
  locationText.value = locationTextValue(draft.value.location);
  locationPending.value = false;
  error.value = null;
}
function clearLocation() {
  draft.value.location = null;
  locationText.value = "";
  locationPending.value = false;
  error.value = null;
}
const channels = computed(() =>
  channelEntries(catalogs.value).filter(
    (c) =>
      !c.archived ||
      (original.value && projectChannel(original.value) === c.id),
  ),
);
const participantOptions = computed(() =>
  (store.data.members ?? []).filter(
    (m) => m.status === "active" || draft.value.participantIds?.includes(m.id),
  ),
);
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
    aliases.value !== draft.value.aliases.join(", ") ||
    locationPending.value,
);
const persisted = useEditorDraft({
  kind: "project",
  projectId: props.project?.id ?? "",
  entityId: props.project?.id ?? "",
  schema: projectEditorDraft,
  value: computed(() => ({
    fields: draft.value,
    aliases: aliases.value,
    locationText: locationText.value,
    locationPending: locationPending.value,
  })),
  dirty,
  baseVersion: () => original.value?.version ?? null,
  currentVersion: () =>
    props.project
      ? store.data.projects.find((p) => p.id === props.project!.id)?.version
      : null,
  restore(value) {
    if (props.project)
      original.value = store.data.projects.find(
        (p) => p.id === props.project!.id,
      );
    draft.value = value.fields;
    aliases.value = value.aliases;
    locationText.value =
      value.locationText ?? locationTextValue(value.fields.location);
    locationPending.value = value.locationPending ?? false;
  },
});
const mayDiscard = useUnsaved(dirty, () =>
  t("Leave this editor? Unsubmitted drafts stay in this tab for recovery."),
);
const error = ref<Error | ApiError | null>(null);
function cancel() {
  if (persisted.pending.value || (mayDiscard() && persisted.cancel()))
    emit("close");
}
function discardSavedDraft() {
  if (!persisted.discard()) return;
  original.value = props.project
    ? store.data.projects.find((p) => p.id === props.project!.id)
    : undefined;
  draft.value = original.value
    ? projectInput.strip().parse(original.value)
    : structuredClone(empty);
  draft.value.categoryIds ??= [];
  draft.value.participantIds ??= [];
  draft.value.channelId ??= "company";
  aliases.value = draft.value.aliases.join(", ");
  locationText.value = locationTextValue(draft.value.location);
  locationPending.value = false;
  baseline = JSON.stringify(draft.value);
  error.value = null;
}
async function save() {
  error.value = null;
  try {
    if (locationPending.value) {
      const match = locationMatches.value;
      if (match.status !== "matched" || !match.location) {
        locationInput.value?.focus();
        throw new Error(
          t(
            locationText.value.trim()
              ? "Choose a supported location or enter coordinates before saving. The existing location has not changed."
              : "Use Clear location to remove the existing location, or enter an address.",
          ),
        );
      }
      chooseLocation(match.location);
    }
    draft.value.aliases = aliases.value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const input = projectInput.parse(draft.value);
    if (!persisted.beforeSave()) return;
    const result = await store.saveProject(input, original.value);
    baseline = JSON.stringify(draft.value);
    persisted.complete();
    emit("saved", result);
  } catch (e) {
    error.value = e as Error;
  }
}
function reload() {
  const current = (error.value as ApiError).current as Project;
  original.value = current;
  draft.value = projectInput.strip().parse(current);
  draft.value.participantIds ??= [];
  draft.value.channelId ??= "company";
  aliases.value = current.aliases.join(", ");
  locationText.value = locationTextValue(draft.value.location);
  locationPending.value = false;
  baseline = JSON.stringify(draft.value);
  error.value = null;
  persisted.discard();
}
</script>
<template>
  <form class="editor" :aria-label="t('Project editor')" @submit.prevent="save">
    <div class="section-heading">
      <h2>{{ t(project ? "Edit project" : "New project") }}</h2>
      <span v-if="dirty" class="muted">{{ t("Unsaved changes") }}</span>
    </div>
    <SaveError :error="error" @reload="reload" />
    <EditorDraftNotice
      v-bind="persisted.notice.value"
      @restore="persisted.restore"
      @discard="discardSavedDraft"
    />
    <fieldset
      class="draft-edit-fields"
      :disabled="persisted.pending.value || store.busy"
    >
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
          >{{ t("Short name (optional)")
          }}<input v-model="draft.shortName" maxlength="80"
        /></label>
        <label
          >{{ t("渠道")
          }}<select v-model="draft.channelId" :aria-label="t('渠道')">
            <option
              v-for="channel in channels"
              :key="channel.id"
              :value="channel.id"
            >
              {{ channel.shortName
              }}{{ channel.id === "company" ? t("（默认）") : ""
              }}{{ channel.archived ? t("（已停用）") : "" }}
            </option>
          </select></label
        >
        <label
          >{{ t("Client / organization")
          }}<input
            v-model="draft.client"
            maxlength="120"
            :placeholder="t('Organization name')"
        /></label>
        <div class="full project-city-field">
          <label :for="locationInputId">{{
            t("Address / city / district")
          }}</label>
          <div class="project-city-input">
            <input
              :id="locationInputId"
              ref="locationInput"
              v-model="locationText"
              name="project-city"
              maxlength="400"
              autocomplete="off"
              :placeholder="
                t(
                  'For example: Ningbo Beilun District, Yunhe County, or 121.8, 29.9',
                )
              "
              :aria-describedby="`${locationInputId}-help`"
              :aria-invalid="
                locationPending && locationMatches.status !== 'matched'
              "
              @input="
                locationPending = true;
                error = null;
              "
            />
            <button
              v-if="draft.location || locationText || locationPending"
              type="button"
              @click="clearLocation"
            >
              {{ t("Clear location") }}
            </button>
          </div>
          <small :id="`${locationInputId}-help`" class="muted">{{
            t(
              "Districts take priority over cities. Area matches use their centres; enter longitude, latitude to save a coordinate point. Its accuracy depends on the coordinates you provide.",
            )
          }}</small>
          <div
            v-if="locationPending"
            class="project-city-candidates"
            aria-live="polite"
          >
            <p v-if="locationMatches.status === 'matched'" class="muted">
              {{
                t(
                  "Location identified. Saving confirms the location and precision shown below.",
                )
              }}
            </p>
            <p
              v-else-if="locationMatches.status === 'ambiguous'"
              class="city-warning"
            >
              {{
                t("Several locations matched. Choose the project's location.")
              }}
            </p>
            <p v-else class="city-warning">
              {{
                t(
                  "No reliable location matched. Enter a city, district or coordinates. The existing location is retained.",
                )
              }}
            </p>
            <p v-if="locationMatches.location" class="project-city-current">
              {{ locationLabel(locationMatches.location) }} ·
              {{ t(locationPrecisionLabel(locationMatches.location)) }}
            </p>
            <div v-if="locationMatches.candidates.length" class="city-choices">
              <button
                v-for="candidate in locationMatches.candidates"
                :key="locationKey(candidate.location)"
                type="button"
                @click="chooseLocation(candidate.location)"
              >
                {{
                  t("Use {location}", {
                    location: locationLabel(candidate.location),
                  })
                }}
                · {{ t(locationPrecisionLabel(candidate.location)) }}
              </button>
            </div>
          </div>
          <p v-else-if="draft.location" class="project-city-current">
            <span
              >{{
                t(
                  draft.location.confirmed
                    ? "Location confirmed"
                    : "Location confirmation pending",
                )
              }}
              · {{ locationLabel(draft.location) }} ·
              {{ t(locationPrecisionLabel(draft.location)) }}</span
            >
            <button
              v-if="!draft.location.confirmed"
              type="button"
              class="text-button"
              @click="chooseLocation(draft.location)"
            >
              {{ t("Confirm this location") }}
            </button>
          </p>
          <small v-else class="muted">{{ t("No location set") }}</small>
        </div>
        <label
          >{{ t("Stage")
          }}<select v-model="draft.stage">
            <option value="unclassified">{{ stageLabels.unclassified }}</option>
            <option v-for="s in stages" :key="s" :value="s">
              {{ stageLabels[s] }}
            </option>
          </select></label
        >
        <MemberAssignment
          label="Owner"
          :project-id="project?.id"
          v-model="draft.owner"
          v-model:memberId="draft.ownerId"
        />
        <label
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
        <fieldset
          v-if="participantOptions.length"
          class="full category-options"
        >
          <legend>{{ t("Project participants") }}</legend>
          <label v-for="member in participantOptions" :key="member.id"
            ><input
              v-model="draft.participantIds"
              type="checkbox"
              :value="member.id"
            />{{ member.name }} · {{ member.email
            }}<small v-if="member.status !== 'active'">{{
              t(member.status)
            }}</small></label
          >
          <small>{{
            t(
              "Participants describe the team; everyone can still view and edit.",
            )
          }}</small>
        </fieldset>
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
    </fieldset>
    <div class="form-actions">
      <button type="button" :disabled="store.busy" @click="cancel">
        {{ t("Cancel") }}</button
      ><button
        class="primary"
        :disabled="store.busy || persisted.pending.value"
        type="submit"
      >
        {{ t(store.busy ? "Saving…" : "Save project") }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.section-heading h2 {
  font-size: 14px;
}
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
.project-city-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.project-city-input,
.city-choices,
.project-city-current {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.project-city-input input {
  flex: 1 1 240px;
  min-width: 0;
}
.project-city-input button,
.city-choices button {
  flex: none;
}
.project-city-candidates p,
.project-city-current {
  margin: 0;
  font-size: 12px;
}
.city-choices {
  margin-top: 6px;
}
.city-warning {
  color: var(--warning, #956819);
}
</style>
