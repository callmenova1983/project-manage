import { ref, onBeforeUnmount, onMounted, watch } from "vue";
import { api, ApiError } from "../services/api";
import type { AssistantSession } from "../../../../packages/domain/assistant";

type Backup = {
  version: number;
  dirty: boolean;
  state: Record<string, unknown>;
};
/** Persist the exact unfinished interaction; never replay writes while restoring. */
export function useAssistantSession(
  key: string,
  enabled: boolean,
  snapshot: () => Record<string, unknown>,
  restore: (state: Record<string, unknown>) => Promise<void>,
) {
  const ready = ref(!enabled),
    saving = ref(false),
    issue = ref(""),
    conflict = ref(false);
  let version = 0,
    dirty = false,
    generation = 0,
    disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remote: AssistantSession | undefined;
  function backup() {
    if (!enabled || !ready.value) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ version, dirty, state: snapshot() } satisfies Backup),
      );
    } catch {
      issue.value = "当前浏览器无法暂存草稿，正在尝试保存到工作区。";
    }
  }
  async function flush() {
    if (
      !enabled ||
      !ready.value ||
      saving.value ||
      !dirty ||
      conflict.value ||
      disposed
    )
      return;
    clearTimeout(timer);
    saving.value = true;
    const current = generation;
    try {
      remote = await api.saveAssistantSession({ version, state: snapshot() });
      version = remote.version;
      if (current === generation) dirty = false;
      issue.value = "";
      backup();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        conflict.value = true;
        issue.value =
          "另一端更新了对话。当前内容已暂存，请选择恢复云端对话后继续。";
      } else
        issue.value =
          "暂未同步到工作区，草稿已保存在当前浏览器。联网后自动重试。";
      backup();
    } finally {
      saving.value = false;
      if (dirty && current !== generation && !conflict.value && !disposed)
        timer = setTimeout(() => void flush(), 350);
    }
  }
  async function recoverRemote() {
    if (saving.value) return;
    ready.value = false;
    try {
      remote = await api.assistantSession();
      await restore(remote.state);
      version = remote.version;
      dirty = false;
      conflict.value = false;
      issue.value = "";
    } catch {
      issue.value = "云端对话暂时无法恢复，当前草稿仍保留。";
    } finally {
      ready.value = true;
      backup();
    }
  }
  onMounted(async () => {
    if (!enabled) return;
    let local: Backup | undefined;
    try {
      local = JSON.parse(localStorage.getItem(key) || "null") ?? undefined;
    } catch {
      /* A malformed backup cannot block a fresh session. */
    }
    try {
      remote = await api.assistantSession();
      version = remote.version;
      if (local?.dirty && local.version === remote.version) {
        await restore(local.state);
        dirty = true;
      } else if (local?.dirty && local.version !== remote.version) {
        await restore(local.state);
        conflict.value = true;
        issue.value = "另一端更新了对话。当前草稿已保留，可恢复云端对话。";
      } else await restore(remote.state);
    } catch {
      if (local?.state) {
        await restore(local.state);
        version = local.version;
        dirty = true;
      }
      issue.value = "暂未连接工作区，当前浏览器草稿已恢复。";
    }
    if (disposed) return;
    ready.value = true;
    backup();
    if (dirty && !conflict.value) void flush();
  });
  watch(
    snapshot,
    () => {
      if (!enabled || !ready.value) return;
      generation++;
      dirty = true;
      backup();
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 500);
    },
    { deep: true, flush: "sync" },
  );
  const resume = () => {
    if (!document.hidden) void flush();
  };
  const leave = () => backup();
  if (enabled) {
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pagehide", leave);
  }
  onBeforeUnmount(() => {
    backup();
    disposed = true;
    clearTimeout(timer);
    window.removeEventListener("online", resume);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pagehide", leave);
  });
  return { ready, saving, issue, conflict, flush, recoverRemote };
}
