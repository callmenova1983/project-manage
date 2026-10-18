<script setup lang="ts">
import { t } from "../locales";
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { dialogContextKey } from "../composables/dialog-context";
import { PhArchive, PhArrowCounterClockwise, PhX } from "@phosphor-icons/vue";
import { type Task } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { confirmDiscard } from "../composables/unsaved";
const props = defineProps<{ task: Task; labeled?: boolean }>();
const dialogContext = inject(dialogContextKey, undefined);
const store = useWorkspace(),
  open = ref(false),
  reason = ref(""),
  error = ref(""),
  position = ref({}),
  panel = ref<HTMLElement>(),
  button = ref<HTMLElement>();
let version = 0,
  revision = 0;
const childCount = computed(() => {
  const ids = new Set([props.task.id]);
  for (let depth = 0; depth < 20; depth++)
    for (const task of store.data.tasks)
      if (task.parentId && ids.has(task.parentId)) ids.add(task.id);
  return store.data.tasks.filter((t) => ids.has(t.id) && !t.voided).length - 1;
});
function place() {
  const box = button.value?.getBoundingClientRect();
  if (!box) return;
  const width = Math.min(320, innerWidth - 24),
    above = innerHeight - box.bottom < 235 && box.top > 235;
  position.value = {
    position: "fixed",
    width: width + "px",
    left:
      Math.max(12, Math.min(box.right - width, innerWidth - width - 12)) + "px",
    ...(above
      ? { bottom: innerHeight - box.top + 6 + "px" }
      : { top: box.bottom + 6 + "px" }),
  };
}
function show() {
  if (store.busy || !confirmDiscard()) return;
  version = props.task.version;
  revision = store.data.revision;
  error.value = "";
  reason.value = t("误录");
  place();
  open.value = true;
}
async function save(action: "void" | "restore") {
  error.value = "";
  try {
    await store.operation(
      () =>
        api.taskLifecycle(props.task.id, {
          version: action === "void" ? version : props.task.version,
          revision: action === "void" ? revision : store.data.revision,
          action,
          reason: action === "void" ? reason.value : t("恢复误作废的任务"),
        }),
      action === "void"
        ? t("任务已作废，原内容和操作记录已保留")
        : t("任务已恢复"),
    );
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function outside(event: PointerEvent) {
  if (
    open.value &&
    !panel.value?.contains(event.target as Node) &&
    !button.value?.contains(event.target as Node)
  )
    open.value = false;
}
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  window.removeEventListener("resize", place);
  window.removeEventListener("scroll", place, true);
});
</script>
<template>
  <div class="task-void-action">
    <button
      v-if="task.voided"
      class="text-button"
      :disabled="store.busy"
      :aria-label="t('恢复 ') + task.title"
      @click="save('restore')"
    >
      <PhArrowCounterClockwise :size="14" />{{ t("恢复") }}
    </button>
    <button
      v-else
      ref="button"
      class="icon-button"
      :disabled="store.busy"
      :aria-label="t('作废 ') + task.title"
      :title="t('作废误录任务，保留内容和操作记录')"
      :aria-expanded="open"
      @click="show"
    >
      <PhArchive :size="15" /><span v-if="labeled">{{ t("作废任务") }}</span>
    </button>
    <small v-if="error && !open" class="error-text" role="alert">{{
      t(error)
    }}</small>
    <Teleport :to="dialogContext?.target.value ?? 'body'">
      <form
        v-if="open"
        ref="panel"
        class="task-void-panel"
        :style="position"
        :aria-label="t('作废任务')"
        @submit.prevent="save('void')"
        @keydown.esc.stop.prevent="open = false"
      >
        <div class="void-heading">
          <strong>{{ t("作废任务") }}</strong
          ><button
            class="icon-button"
            type="button"
            :aria-label="t('关闭作废任务')"
            @click="open = false"
          >
            <PhX :size="14" />
          </button>
        </div>
        <p class="void-title">{{ task.title }}</p>
        <p class="muted">
          {{ t("从日常列表和统计移出，原内容保留，可恢复。")
          }}<template v-if="childCount > 0"
            >{{ t("同时作废") }} {{ childCount }}
            {{ t("个子任务。") }}</template
          >
        </p>
        <label
          >{{ t("作废原因")
          }}<input
            v-model="reason"
            :aria-label="t('作废原因')"
            required
            maxlength="500"
            :disabled="store.busy"
            :placeholder="t('误录、重复、需求取消…')"
        /></label>
        <p v-if="error" class="error-text" role="alert">{{ t(error) }}</p>
        <div class="void-actions">
          <button type="button" @click="open = false">{{ t("取消") }}</button
          ><button class="primary" :disabled="store.busy || !reason.trim()">
            {{ t("确认作废") }}
          </button>
        </div>
      </form>
    </Teleport>
  </div>
</template>
<style scoped>
.task-void-action {
  position: relative;
  display: inline-flex;
}
.task-void-panel {
  z-index: 3000;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 8px 30px #0002;
  display: grid;
  gap: 8px;
  font-size: 12px;
}
.void-heading,
.void-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.void-title {
  font-weight: 500;
  max-height: 44px;
  overflow: auto;
}
.task-void-panel p {
  margin: 0;
  line-height: 1.5;
}
.task-void-panel label {
  display: grid;
  gap: 4px;
}
.task-void-panel input {
  height: 32px;
  width: 100%;
  box-sizing: border-box;
  font-size: 12px;
}
.void-actions {
  justify-content: flex-end;
}
.void-actions button {
  min-height: 30px;
  padding: 4px 10px;
  font-size: 12px;
}
.error-text {
  color: var(--danger);
}
</style>
