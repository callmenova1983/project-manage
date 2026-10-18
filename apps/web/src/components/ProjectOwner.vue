<script setup lang="ts">
import { t } from "../locales";
import { computed, ref } from "vue";
import { PhUser, PhX } from "@phosphor-icons/vue";
import PersonPicker from "./PersonPicker.vue";
import { useWorkspace } from "../stores/workspace";
import { memberName } from "../../../../packages/domain/members";
import { projectInput, type Project } from "../../../../packages/domain/types";
import { confirmDiscard, useUnsaved } from "../composables/unsaved";
const props = defineProps<{ project: Project; compact?: boolean }>();
const store = useWorkspace(),
  editing = ref(false),
  draft = ref(""),
  error = ref("");
const name = computed(() =>
  memberName(
    props.project.ownerId,
    props.project.owner,
    store.data.members ?? [],
  ),
);
const assigned = computed(
  () => !!name.value && !["Unassigned", "未分配", "待补"].includes(name.value),
);
const original = ref<Project>();
const draftMemberId = ref<string | null>(null);
const baseline = ref("");
const dirty = computed(
  () =>
    editing.value &&
    (draft.value !== baseline.value ||
      draftMemberId.value !== (original.value?.ownerId ?? null)),
);
useUnsaved(dirty);
function open() {
  if (store.busy || !confirmDiscard()) return;
  original.value = { ...props.project };
  draftMemberId.value = props.project.ownerId ?? null;
  draft.value = assigned.value ? name.value : "";
  baseline.value = draft.value;
  error.value = "";
  editing.value = true;
}
async function save() {
  if (!dirty.value) {
    editing.value = false;
    return;
  }
  try {
    const before = original.value!;
    await store.saveProject(
      {
        ...projectInput.strip().parse(before),
        owner: draft.value,
        ownerId: draftMemberId.value,
      },
      before,
    );
    editing.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <div class="project-owner-cell" :class="{ compact }">
    <div v-if="editing" class="owner-editor">
      <PersonPicker
        v-model="draft"
        link-members
        :member-id="draftMemberId"
        @update:model-value="draftMemberId = null"
        @select-identity="draftMemberId = $event"
        :label="t('项目负责人：') + project.name"
        :project-id="project.id"
        :disabled="store.busy"
        auto-open
        compact
        @select="save"
        @cancel="editing = false"
      />
      <button
        class="icon-button"
        :aria-label="t('取消修改负责人')"
        @click="editing = false"
      >
        <PhX :size="14" />
      </button>
    </div>
    <button
      v-else
      class="owner-value text-button"
      :class="{ unassigned: !assigned }"
      :aria-label="
        t('项目负责人：') +
        (assigned ? name : t('未分配')) +
        '，' +
        project.name
      "
      :title="
        (assigned ? name : t('未分配')) +
        ' · ' +
        t('点击更换项目负责人，支持拼音搜索')
      "
      @click="open"
    >
      <span class="owner-avatar" aria-hidden="true"
        ><span v-if="assigned">{{ name.slice(0, 1) }}</span
        ><PhUser v-else :size="13"
      /></span>
      <span v-if="!compact" class="owner-name">{{
        assigned ? name : t("未分配")
      }}</span>
    </button>
    <small v-if="error" role="alert" class="error-text">{{ t(error) }}</small>
  </div>
</template>
<style scoped>
.project-owner-cell {
  min-width: 0;
  position: relative;
}
.owner-value {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-height: 30px;
  font-size: 12px;
}
.owner-avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border);
}
.owner-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.compact {
  min-height: 32px;
}
.compact .owner-value {
  justify-content: center;
  width: 32px;
  min-height: 32px;
  padding: 0;
}
.compact .owner-editor {
  position: relative;
  z-index: 2;
  width: 220px;
  max-width: calc(100vw - 48px);
  background: var(--surface);
  border-radius: 6px;
}
.unassigned {
  color: var(--muted);
}
.unassigned .owner-avatar {
  background: var(--surface-raised);
  color: var(--muted);
}
.owner-editor {
  display: flex;
  align-items: center;
  gap: 2px;
}
.owner-editor :deep(.person-picker) {
  min-width: 0;
  flex: 1;
}
.error-text {
  display: block;
  white-space: normal;
  color: var(--danger);
}
@media (max-width: 760px) {
  .compact .owner-value {
    width: 44px;
    min-height: 44px;
  }
  .owner-value {
    min-height: 36px;
  }
  .project-owner-cell {
    grid-column: 1;
    grid-row: 4;
  }
}
</style>
