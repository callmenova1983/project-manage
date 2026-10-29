<script setup lang="ts">
import { computed, ref } from "vue";
import { PhArchive } from "@phosphor-icons/vue";
import type { Project } from "../../../../packages/domain/types";
import {
  projectLifecycle,
  projectLifecycleLabels,
  projectOpenTasks,
  type ProjectLifecycle,
} from "../../../../packages/domain/project-lifecycle";
import { useWorkspace } from "../stores/workspace";
import { confirmDiscard } from "../composables/unsaved";
import { t } from "../locales";
import WorkspaceDialog from "./WorkspaceDialog.vue";

const props = defineProps<{ project: Project; compact?: boolean }>();
const store = useWorkspace();
const open = ref(false),
  confirmed = ref(false),
  error = ref("");
const original = ref(props.project);
const target = ref<ProjectLifecycle>("closed");
const unfinished = computed(() =>
  projectOpenTasks(props.project.id, store.data.tasks),
);
const needsConfirmation = computed(
  () => target.value !== "active" && unfinished.value.length > 0,
);
const actionLabel = computed(() =>
  target.value === "active"
    ? "Reactivate project"
    : target.value === "archived"
      ? "Archive project"
      : projectLifecycle(original.value) === "archived"
        ? "Restore as closed"
        : "End project",
);
function show() {
  if (store.busy || !confirmDiscard()) return;
  original.value = { ...props.project };
  target.value =
    projectLifecycle(props.project) === "closed" ? "active" : "closed";
  confirmed.value = false;
  error.value = "";
  open.value = true;
}
async function save() {
  error.value = "";
  try {
    await store.changeProjectLifecycle(original.value, {
      lifecycle: target.value,
      confirmOpenTasks: confirmed.value,
    });
    open.value = false;
  } catch (reason) {
    error.value = (reason as Error).message;
    // Preserve the preview and require the user to review a changed version.
    await store.refresh(true);
  }
}
</script>
<template>
  <template v-if="!project.intakeInbox">
    <button
      :class="
        compact
          ? 'icon-button quick-action lifecycle-control'
          : 'lifecycle-control'
      "
      :aria-label="t('Manage project status: {name}', { name: project.name })"
      :title="t('Manage project status')"
      :disabled="store.busy"
      @click="show"
    >
      <PhArchive :size="17" /><span v-if="!compact">{{
        t("Manage project status")
      }}</span>
    </button>
    <WorkspaceDialog
      :open="open"
      :title="t('Manage project status')"
      variant="form"
      :busy="store.busy"
      @close="open = false"
    >
      <form class="lifecycle-form" @submit.prevent="save">
        <p>
          <strong>{{ project.name }}</strong> ·
          {{ t(projectLifecycleLabels[projectLifecycle(project)]) }}
        </p>
        <label
          >{{ t("Change project status") }}
          <select
            v-model="target"
            :disabled="store.busy"
            @change="confirmed = false"
          >
            <option
              v-if="projectLifecycle(original) !== 'active'"
              value="active"
            >
              {{ t("Reactivate project") }}
            </option>
            <option
              v-if="projectLifecycle(original) !== 'closed'"
              value="closed"
            >
              {{
                t(
                  projectLifecycle(original) === "archived"
                    ? "Restore as closed"
                    : "End project",
                )
              }}
            </option>
            <option
              v-if="projectLifecycle(original) !== 'archived'"
              value="archived"
            >
              {{ t("Archive project") }}
            </option>
          </select>
        </label>
        <p class="muted">
          {{
            t(
              target === "active"
                ? "The project will return to daily work. Its stage and history are preserved."
                : target === "closed"
                  ? "The project will leave daily work. Keep its history and reactivate it when maintenance is needed."
                  : "Archived projects are read-only. Files and history remain available; restore the project before editing.",
            )
          }}
        </p>
        <div v-if="needsConfirmation" class="lifecycle-unfinished">
          <p>
            {{
              t("This project still has {count} unfinished tasks.", {
                count: unfinished.length,
              })
            }}
          </p>
          <ul>
            <li v-for="task in unfinished" :key="task.id">{{ task.title }}</li>
          </ul>
          <label class="lifecycle-confirm"
            ><input
              v-model="confirmed"
              type="checkbox"
              :disabled="store.busy"
            />{{
              t(
                "I have reviewed these tasks. Keep their current status and continue.",
              )
            }}</label
          >
        </div>
        <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
        <p v-if="project.version !== original.version" role="alert">
          {{
            t(
              "This project changed. Close this dialog and review the latest version.",
            )
          }}
        </p>
        <div class="lifecycle-buttons">
          <button type="button" :disabled="store.busy" @click="open = false">
            {{ t("Cancel") }}
          </button>
          <button
            type="submit"
            class="primary"
            :disabled="
              store.busy ||
              (needsConfirmation && !confirmed) ||
              project.version !== original.version
            "
          >
            {{ t(actionLabel) }}
          </button>
        </div>
      </form>
    </WorkspaceDialog>
  </template>
</template>
<style scoped>
.lifecycle-form {
  display: grid;
  gap: 16px;
}
.lifecycle-form p {
  margin: 0;
}
.lifecycle-form label:not(.lifecycle-confirm) {
  display: grid;
  gap: 8px;
}
.lifecycle-unfinished {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.lifecycle-unfinished ul {
  max-height: 180px;
  overflow: auto;
  padding-left: 20px;
}
.lifecycle-confirm {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.lifecycle-confirm input {
  flex: 0 0 auto;
  margin-top: 3px;
}
.lifecycle-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
