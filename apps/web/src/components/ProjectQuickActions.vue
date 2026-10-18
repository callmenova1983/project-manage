<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  PhPencilSimple,
  PhGitMerge,
  PhX,
  PhMagnifyingGlass,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { t, formatNumber } from "../locales";
import { catalogs, catalogLabel } from "../composables/catalogs";
import { memberName } from "../../../../packages/domain/members";
import {
  channelEntries,
  projectChannel,
} from "../../../../packages/domain/channels";
import { confirmDiscard, useUnsaved } from "../composables/unsaved";
import {
  leafTasks,
  projectInput,
  type Project,
  type Snapshot,
} from "../../../../packages/domain/types";
import {
  planProjectMerge,
  projectRenameInput,
} from "../../../../packages/domain/project-merge";

const props = defineProps<{
  project: Project;
  showName?: boolean;
  labeled?: boolean;
}>();
const emit = defineEmits<{ merged: [Project] }>();
const store = useWorkspace(),
  router = useRouter();
const dialog = ref<HTMLDialogElement | null>(null);
const mode = ref<"rename" | "merge" | null>(null);
const preview = ref<Snapshot | null>(null);
const targetId = ref(""),
  sourceIds = ref<string[]>([]),
  name = ref(""),
  shortName = ref(""),
  channelId = ref("company"),
  query = ref(""),
  error = ref("");
let baseline = "";
let navigationTimer: ReturnType<typeof setTimeout> | undefined;
const dirty = computed(
  () =>
    !!mode.value &&
    JSON.stringify([
      name.value,
      shortName.value,
      channelId.value,
      targetId.value,
      sourceIds.value,
    ]) !== baseline,
);
useUnsaved(dirty);
const channels = computed(() => {
  const original =
    preview.value?.projects.find((p) => p.id === props.project.id) ??
    props.project;
  return channelEntries(catalogs.value).filter(
    (channel) => !channel.archived || channel.id === projectChannel(original),
  );
});
const eligible = computed(
  () => preview.value?.projects.filter((p) => !p.intakeInbox) ?? [],
);
const candidates = computed(() =>
  eligible.value.filter(
    (p) =>
      p.id !== targetId.value &&
      `${p.name} ${p.shortName ?? ""} ${p.client} ${p.aliases.join(" ")} ${channelName(p)}`
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
  ),
);
const target = computed(() =>
  eligible.value.find((p) => p.id === targetId.value),
);
const sources = computed(() =>
  eligible.value.filter((p) => sourceIds.value.includes(p.id)),
);
const projectTaskCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const task of leafTasks(preview.value?.tasks ?? []))
    counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
  return counts;
});
function channelName(project: Project) {
  return (
    channelEntries(catalogs.value).find((c) => c.id === projectChannel(project))
      ?.shortName ?? projectChannel(project)
  );
}
function removeSource(id: string) {
  sourceIds.value = sourceIds.value.filter((value) => value !== id);
}
const selectedIds = computed(
  () => new Set([targetId.value, ...sourceIds.value]),
);
const taskCount = computed(
  () =>
    leafTasks(preview.value?.tasks ?? []).filter((task) =>
      selectedIds.value.has(task.projectId),
    ).length,
);
const mergeInput = computed(() => ({
  targetId: targetId.value,
  sourceIds: sourceIds.value,
  name: name.value,
  shortName: shortName.value,
  revision: preview.value?.revision ?? 0,
  confirmed: true as const,
}));
const previewError = computed(() => {
  if (mode.value !== "merge" || !sourceIds.value.length) return "";
  try {
    planProjectMerge(preview.value!, mergeInput.value);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
});
watch(targetId, (id) => {
  if (mode.value !== "merge") return;
  sourceIds.value = sourceIds.value.filter((sourceId) => sourceId !== id);
  if (id !== props.project.id && !sourceIds.value.includes(props.project.id))
    sourceIds.value.push(props.project.id);
  const target = eligible.value.find((p) => p.id === id);
  if (target) {
    name.value = target.name;
    shortName.value = target.shortName ?? "";
  }
});
async function open(value: "rename" | "merge") {
  clearTimeout(navigationTimer);
  if (!confirmDiscard() || store.busy) return;
  preview.value = JSON.parse(JSON.stringify(store.data));
  const current = preview.value!.projects.find(
    (p) => p.id === props.project.id,
  );
  if (!current) return;
  mode.value = value;
  targetId.value = current.id;
  sourceIds.value = [];
  name.value = current.name;
  shortName.value = current.shortName ?? "";
  channelId.value = projectChannel(current);
  query.value = "";
  error.value = "";
  baseline = JSON.stringify([
    name.value,
    shortName.value,
    channelId.value,
    targetId.value,
    sourceIds.value,
  ]);
  await nextTick();
  dialog.value?.showModal();
  const input = dialog.value?.querySelector<HTMLInputElement>(
    value === "merge" ? "input[type='search']" : "input[type='text']",
  );
  input?.focus();
  input?.select();
}
function close() {
  if (store.busy) return;
  dialog.value?.close();
  mode.value = null;
  error.value = "";
}
function nameClick(event: MouseEvent) {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  )
    return;
  event.preventDefault();
  clearTimeout(navigationTimer);
  if (event.detail > 1) return;
  if (event.detail === 0) void router.push(`/projects/${props.project.id}`);
  else
    navigationTimer = setTimeout(
      () => void router.push(`/projects/${props.project.id}`),
      400,
    );
}
onBeforeUnmount(() => clearTimeout(navigationTimer));
async function mergeFrom(id: string) {
  await open("merge");
  if (mode.value === "merge" && id !== targetId.value) sourceIds.value = [id];
}
const rename = () => open("rename");
defineExpose({ mergeFrom, rename });
async function save() {
  error.value = "";
  try {
    if (mode.value === "rename") {
      const original = preview.value!.projects.find(
        (p) => p.id === props.project.id,
      )!;
      const input = projectRenameInput.parse({
        name: name.value,
        shortName: shortName.value,
        version: original.version,
      });
      if (channelId.value !== projectChannel(original)) {
        await store.saveProject(
          projectInput.parse({
            ...projectInput.strip().parse(original),
            name: input.name,
            shortName: input.shortName,
            channelId: channelId.value,
          }),
          original,
        );
      } else
        await store.operation(
          () =>
            api.renameProject(
              original.id,
              input.name,
              input.version,
              input.shortName,
            ),
          t("Project name saved"),
        );
    } else {
      const result = await store.operation(
        () => api.mergeProjects(mergeInput.value),
        t("Projects merged"),
      );
      emit("merged", result);
    }
    close();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="project-quick-actions" :class="{ labeled }">
    <a
      v-if="showName"
      :href="router.resolve(`/projects/${project.id}`).href"
      class="quick-project-name"
      :title="t('Double-click to edit name, short name and channel')"
      @click="nameClick"
      @dblclick.prevent="open('rename')"
      @keydown.f2.prevent="open('rename')"
      >{{ project.shortName || project.name }}</a
    >
    <button
      class="icon-button quick-action"
      :aria-label="t('Rename {name}', { name: project.name })"
      :title="t('Edit name, short name and channel')"
      :disabled="store.busy"
      @click="open('rename')"
    >
      <PhPencilSimple :size="15" /><span v-if="labeled">{{
        t("Edit name, short name and channel")
      }}</span>
    </button>
    <button
      v-if="!project.intakeInbox"
      class="icon-button quick-action"
      :aria-label="t('Merge {name}', { name: project.name })"
      :title="t('Merge projects')"
      :disabled="
        store.busy ||
        store.data.projects.filter((p) => !p.intakeInbox).length < 2
      "
      @click="open('merge')"
    >
      <PhGitMerge :size="15" /><span v-if="labeled">{{
        t("Merge projects")
      }}</span>
    </button>
    <dialog
      v-if="mode"
      ref="dialog"
      class="project-action-dialog"
      :class="{ 'merge-dialog': mode === 'merge' }"
      :aria-labelledby="`project-action-title-${project.id}`"
      @cancel.prevent="close"
    >
      <form @submit.prevent="save">
        <div class="section-heading">
          <h2 :id="`project-action-title-${project.id}`">
            {{
              t(
                mode === "rename"
                  ? "Edit name, short name and channel"
                  : "Merge projects",
              )
            }}
          </h2>
          <button
            type="button"
            class="icon-button"
            :aria-label="t('Close')"
            :disabled="store.busy"
            @click="close"
          >
            <PhX :size="20" />
          </button>
        </div>
        <p v-if="mode === 'merge'" class="merge-intro muted">
          {{
            t(
              "Select duplicate projects to combine. All work and history will be kept.",
            )
          }}
        </p>
        <label v-if="mode === 'rename'" class="form-field"
          >{{ t("Project name")
          }}<input v-model="name" type="text" required maxlength="120"
        /></label>
        <label v-if="mode === 'rename'" class="form-field"
          >{{ t("Short name (optional)")
          }}<input
            v-model="shortName"
            type="text"
            maxlength="80"
            :placeholder="t('Shown in the project list')"
        /></label>
        <label v-if="mode === 'rename'" class="form-field">
          {{ t("渠道") }}
          <select v-model="channelId" :aria-label="t('渠道')">
            <option
              v-for="channel in channels"
              :key="channel.id"
              :value="channel.id"
            >
              {{ channel.shortName
              }}{{ channel.id === "company" ? t("（默认）") : ""
              }}{{ channel.archived ? t("（已停用）") : "" }}
            </option>
          </select>
        </label>
        <template v-if="mode === 'merge'">
          <label class="form-field merge-target"
            >{{ t("Retained project")
            }}<select v-model="targetId" :aria-label="t('Retained project')">
              <option v-for="p in eligible" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select></label
          >
          <p v-if="target" class="target-context muted">
            <span>{{ channelName(target) }}</span
            ><span>{{ catalogLabel("stages", target.stage) }}</span
            ><span
              >{{ t("Project owner") }}：{{
                t(
                  memberName(
                    target.ownerId,
                    target.owner,
                    store.data.members ?? [],
                  ),
                )
              }}</span
            >
          </p>
          <fieldset class="merge-selection">
            <legend>
              {{ t("Projects to merge into it")
              }}<span class="muted">
                · {{ t("{count} selected", { count: sourceIds.length }) }}</span
              >
            </legend>
            <div class="merge-search">
              <PhMagnifyingGlass :size="16" aria-hidden="true" /><input
                v-model="query"
                type="search"
                :aria-label="t('Search source projects')"
                :placeholder="t('Search project, client or channel')"
              />
            </div>
            <div
              v-if="sources.length"
              class="merge-selected"
              :aria-label="t('Selected projects')"
            >
              <button
                v-for="p in sources"
                :key="p.id"
                class="selected-project"
                type="button"
                :aria-label="t('Deselect {name}', { name: p.name })"
                :disabled="store.busy"
                @click="removeSource(p.id)"
              >
                <span>{{ p.shortName || p.name }}</span
                ><PhX :size="12" aria-hidden="true" />
              </button>
            </div>
            <div class="merge-project-options">
              <label
                v-for="p in candidates"
                :key="p.id"
                class="merge-project-option"
                :class="{ selected: sourceIds.includes(p.id) }"
                ><input
                  v-model="sourceIds"
                  type="checkbox"
                  :value="p.id"
                  :aria-label="p.name"
                  :disabled="store.busy"
                /><span class="merge-option-name" :title="p.name">{{
                  p.shortName || p.name
                }}</span
                ><span class="merge-option-channel">{{ channelName(p) }}</span
                ><span class="merge-option-count">{{
                  t("{count} tasks", {
                    count: projectTaskCounts.get(p.id) ?? 0,
                  })
                }}</span></label
              >
              <p v-if="!candidates.length" class="muted">
                {{ t("No projects match") }}
              </p>
            </div>
          </fieldset>
          <details class="merge-name-options">
            <summary>
              {{ t("Name after merging") }}：<strong>{{
                shortName || name
              }}</strong
              ><span class="muted">{{ t("Change (optional)") }}</span>
            </summary>
            <div class="merge-name-fields">
              <label class="form-field"
                >{{ t("Project name")
                }}<input
                  v-model="name"
                  type="text"
                  required
                  maxlength="120"
                  :disabled="store.busy"
              /></label>
              <label class="form-field"
                >{{ t("Short name (optional)")
                }}<input
                  v-model="shortName"
                  type="text"
                  maxlength="80"
                  :disabled="store.busy"
              /></label>
            </div>
          </details>
          <p class="merge-preview" aria-live="polite">
            <span v-if="!sourceIds.length" class="muted">{{
              t("Select at least one project above to merge.")
            }}</span>
            <template v-else>
              <PhGitMerge :size="17" aria-hidden="true" />
              <strong>
                {{
                  t(
                    "{projects} projects → 1 project · {tasks} tasks retained",
                    {
                      projects: formatNumber(sourceIds.length + 1),
                      tasks: formatNumber(taskCount),
                    },
                  )
                }}
              </strong>
              <span class="merge-destination">{{
                t("Merge into {name}", {
                  name: target?.shortName || target?.name || "",
                })
              }}</span>
            </template>
          </p>
          <p class="muted merge-explanation">
            {{
              t(
                "All tasks, dates, notes and history are retained. The retained project keeps its stage, client and owner. Source projects leave the list after merging.",
              )
            }}
          </p>
        </template>
        <p v-if="error || previewError" class="error-box" role="alert">
          {{ t(error || previewError) }}
        </p>
        <div class="form-actions">
          <button type="button" :disabled="store.busy" @click="close">
            {{ t("Cancel") }}</button
          ><button
            class="primary"
            type="submit"
            :disabled="
              store.busy ||
              (mode === 'merge' && (!sourceIds.length || !!previewError))
            "
          >
            {{
              t(
                store.busy
                  ? "Saving…"
                  : mode === "merge"
                    ? "Confirm merge"
                    : "Save",
              )
            }}
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.project-quick-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}
.labeled {
  display: grid;
  gap: 6px;
}
.labeled .quick-action {
  width: 100%;
  height: auto;
  min-height: 44px;
  justify-content: flex-start;
  gap: 10px;
  padding: 10px 12px;
  font-size: 14px;
  color: var(--text);
}
.quick-project-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-action {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  color: var(--muted);
}
.project-action-dialog {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: min(560px, calc(100vw - 24px));
  max-height: calc(100dvh - 32px);
  padding: 22px;
  overflow: auto;
}
.project-action-dialog::backdrop {
  background: rgb(0 0 0 / 55%);
}
.project-action-dialog form {
  display: grid;
  gap: 14px;
}
.project-action-dialog h2 {
  margin: 0;
  font-size: 19px;
}
.project-action-dialog .form-field {
  display: grid;
  gap: 6px;
}
.project-action-dialog .merge-selection {
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 10px;
  min-width: 0;
}
.merge-project-options {
  display: grid;
  gap: 0;
  margin-top: 8px;
  max-height: 224px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.merge-project-options .merge-project-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) minmax(40px, 80px) 64px;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 2px 8px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 400;
}
.merge-project-option:hover {
  background: var(--surface-raised);
}
.merge-project-option.selected {
  background: var(--accent-bg);
  color: var(--accent-text);
}
.merge-project-option:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
.merge-option-name,
.merge-option-channel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.merge-option-channel,
.merge-option-count {
  font-size: 11px;
  color: var(--muted);
}
.merge-option-count {
  text-align: right;
  white-space: nowrap;
}
.merge-dialog {
  width: min(620px, calc(100vw - 24px));
  box-sizing: border-box;
  padding: 18px;
}
.merge-dialog form {
  gap: 10px;
}
.merge-dialog .section-heading {
  margin: 0;
}
.merge-intro {
  font-size: 12px;
  margin: 0;
}
.target-context {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: -4px 0 0;
  font-size: 11px;
}
.merge-selection legend {
  font-size: 12px;
  font-weight: 500;
}
.merge-search {
  position: relative;
  display: flex;
  align-items: center;
}
.merge-search svg {
  position: absolute;
  left: 10px;
  color: var(--muted);
  pointer-events: none;
}
.merge-search input {
  width: 100%;
  height: 32px;
  padding-left: 32px;
  font-size: 12px;
}
.merge-selected {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  max-height: 76px;
  overflow: auto;
}
.selected-project {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  max-width: 100%;
  padding: 2px 7px;
  border: 1px solid var(--accent-border);
  border-radius: 4px;
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 11px;
}
.selected-project span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.merge-name-options {
  font-size: 12px;
}
.merge-name-options summary {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  list-style: revert;
}
.merge-name-options summary::before {
  content: "›";
  font-size: 16px;
  line-height: 1;
}
.merge-name-options[open] summary::before {
  transform: rotate(90deg);
}
.merge-name-options summary strong {
  max-width: 65%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.merge-name-options summary .muted {
  margin-left: auto;
  font-size: 11px;
}
.merge-name-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 8px;
}
.merge-explanation {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
}
.merge-dialog .form-actions {
  margin-top: 2px;
}
.merge-destination {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 600px) {
  .merge-dialog {
    padding: 14px;
  }
  .merge-name-fields {
    grid-template-columns: 1fr;
  }
  .merge-project-options .merge-project-option {
    grid-template-columns: 18px minmax(0, 1fr) 50px;
    gap: 8px;
    min-height: 44px;
    padding: 2px 4px;
  }
  .merge-option-channel {
    display: none;
  }
  .merge-project-options {
    max-height: 220px;
  }
  .merge-preview {
    flex-wrap: wrap;
  }
  .merge-destination {
    flex-basis: 100%;
  }
}
.merge-project-options input[type="checkbox"] {
  width: 17px;
  height: 17px;
  margin: 0;
  min-width: 17px;
  padding: 0;
  accent-color: var(--accent);
}
.merge-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: var(--surface-raised);
  border-radius: 6px;
  margin: 0;
  font-size: 12px;
}
@media (pointer: coarse) {
  .quick-action {
    width: 32px;
    height: 32px;
  }
}
</style>
