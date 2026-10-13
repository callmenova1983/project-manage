<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { PhPencilSimple, PhGitMerge, PhX } from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { t, formatNumber } from "../locales";
import { catalogs } from "../composables/catalogs";
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

const props = defineProps<{ project: Project; showName?: boolean }>();
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
      `${p.name} ${p.shortName ?? ""}`
        .toLowerCase()
        .includes(query.value.toLowerCase()),
  ),
);
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
  const input =
    dialog.value?.querySelector<HTMLInputElement>("input[type='text']");
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
  <div class="project-quick-actions">
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
      <PhPencilSimple :size="15" />
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
      <PhGitMerge :size="15" />
    </button>
    <dialog
      v-if="mode"
      ref="dialog"
      class="project-action-dialog"
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
        <label
          >{{ t("Project name")
          }}<input v-model="name" type="text" required maxlength="120"
        /></label>
        <label
          >{{ t("Short name (optional)")
          }}<input
            v-model="shortName"
            type="text"
            maxlength="80"
            :placeholder="t('Shown in the project list')"
        /></label>
        <label v-if="mode === 'rename'">
          渠道
          <select v-model="channelId" aria-label="渠道">
            <option
              v-for="channel in channels"
              :key="channel.id"
              :value="channel.id"
            >
              {{ channel.shortName
              }}{{ channel.id === "company" ? "（默认）" : ""
              }}{{ channel.archived ? "（已停用）" : "" }}
            </option>
          </select>
        </label>
        <template v-if="mode === 'merge'">
          <label
            >{{ t("Retained project")
            }}<select v-model="targetId">
              <option v-for="p in eligible" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select></label
          >
          <fieldset>
            <legend>{{ t("Projects to merge into it") }}</legend>
            <input
              v-model="query"
              type="search"
              :aria-label="t('Search source projects')"
              :placeholder="t('Search projects')"
            />
            <div class="merge-project-options">
              <label v-for="p in candidates" :key="p.id"
                ><input v-model="sourceIds" type="checkbox" :value="p.id" />{{
                  p.name
                }}</label
              >
              <p v-if="!candidates.length" class="muted">
                {{ t("No projects match") }}
              </p>
            </div>
          </fieldset>
          <p class="merge-preview" aria-live="polite">
            {{
              t("{projects} projects → 1 project · {tasks} tasks retained", {
                projects: formatNumber(sourceIds.length + 1),
                tasks: formatNumber(taskCount),
              })
            }}
          </p>
          <p class="muted">
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
.project-action-dialog label {
  display: grid;
  gap: 6px;
}
.project-action-dialog fieldset {
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 12px;
  min-width: 0;
}
.merge-project-options {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  max-height: 200px;
  overflow: auto;
}
.merge-project-options label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}
.merge-project-options input {
  width: 17px;
  height: 17px;
}
.merge-preview {
  padding: 10px;
  background: var(--surface-raised);
  border-radius: 6px;
  margin: 0;
}
@media (pointer: coarse) {
  .quick-action {
    width: 32px;
    height: 32px;
  }
}
</style>
