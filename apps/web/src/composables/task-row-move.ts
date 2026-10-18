import { computed, nextTick, ref } from "vue";
import type { Task } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { confirmDiscard } from "./unsaved";
import { t } from "../locales";
import { ApiError } from "../services/contracts";

type Placement = "before" | "after" | "inside";
const dragType = "application/x-project-task-row";

export function useTaskRowMove(
  enabled: () => boolean,
  reveal: (id: string) => void,
  visibleTasks?: () => readonly Task[],
) {
  const store = useWorkspace();
  const dragging = ref<Task | null>(null);
  const target = ref<{
    task: Task;
    placement: Placement;
    invalid: string;
  } | null>(null);
  const error = ref("");
  const notice = ref("");
  const undo = ref<{
    id: string;
    version: number;
    parentId: string | null;
    parentVersion?: number;
    anchorId?: string;
    anchorVersion?: number;
  } | null>(null);
  const taskMap = computed(
    () => new Map(store.data.tasks.map((task) => [task.id, task])),
  );
  function invalid(source: Task, destination: Task) {
    if (source.projectId !== destination.projectId)
      return t("Move tasks within the same project.");
    const seen = new Set<string>();
    let id: string | null = destination.id;
    while (id && !seen.has(id)) {
      if (id === source.id)
        return t("A task cannot be moved into itself or its subtasks.");
      seen.add(id);
      id = taskMap.value.get(id)?.parentId ?? null;
    }
    return "";
  }
  function siblings(task: Task) {
    return store.data.tasks
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          !item.voided &&
          item.projectId === task.projectId &&
          item.parentId === task.parentId,
      )
      .sort(
        (a, b) =>
          (a.item.sortOrder ?? a.index) - (b.item.sortOrder ?? b.index) ||
          a.index - b.index,
      )
      .map(({ item }) => item);
  }
  function clearDrag() {
    dragging.value = null;
    target.value = null;
  }
  function start(task: Task, event: DragEvent) {
    if (!enabled() || store.busy || !confirmDiscard() || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    dragging.value = { ...task };
    error.value = "";
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(dragType, task.id);
    const row = (event.currentTarget as HTMLElement).closest(".task-row");
    if (row) event.dataTransfer.setDragImage(row, 24, 20);
  }
  function over(task: Task, event: DragEvent) {
    if (!dragging.value || !event.dataTransfer?.types.includes(dragType))
      return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - box.top) / box.height;
    const placement: Placement =
      ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
    const reason = invalid(dragging.value, task);
    if (
      target.value?.task.id !== task.id ||
      target.value.placement !== placement
    )
      target.value = { task: { ...task }, placement, invalid: reason };
    event.dataTransfer.dropEffect = reason ? "none" : "move";
  }
  function leave(task: Task, event: DragEvent) {
    if (
      !(event.currentTarget as HTMLElement).contains(
        event.relatedTarget as Node | null,
      ) &&
      target.value?.task.id === task.id
    )
      target.value = null;
  }
  async function focusTask(id: string) {
    await nextTick();
    const row = document.getElementById(`task-${id}`);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      row
        .querySelector<HTMLElement>("[data-task-drag-handle]")
        ?.focus({ preventScroll: true });
    } else
      document
        .querySelector<HTMLElement>("[data-global-search]")
        ?.focus({ preventScroll: true });
  }
  async function move(source: Task, destination: Task, placement: Placement) {
    if (store.busy || !enabled() || !confirmDiscard()) return false;
    error.value = invalid(source, destination);
    if (error.value) return false;
    const rows = siblings(source),
      next = rows[rows.findIndex((task) => task.id === source.id) + 1];
    const originalParent = source.parentId
      ? taskMap.value.get(source.parentId)
      : undefined;
    const parentId =
      placement === "inside" ? destination.id : destination.parentId;
    const parent = parentId ? taskMap.value.get(parentId) : undefined;
    try {
      const saved = await store.moveTask(source, {
        parentId,
        parentVersion:
          placement === "inside" ? destination.version : parent?.version,
        anchorId: placement === "inside" ? undefined : destination.id,
        anchorVersion: placement === "inside" ? undefined : destination.version,
        placement: placement === "inside" ? "last" : placement,
      });
      // Placing a task where it already is must preserve a prior valid undo.
      if (!saved.length) return true;
      const acknowledged = new Map(saved.map((task) => [task.id, task]));
      undo.value = {
        id: source.id,
        version: acknowledged.get(source.id)?.version ?? source.version,
        parentId: source.parentId,
        parentVersion: originalParent
          ? (acknowledged.get(originalParent.id)?.version ??
            originalParent.version)
          : undefined,
        anchorId: next?.id,
        anchorVersion: next
          ? (acknowledged.get(next.id)?.version ?? next.version)
          : undefined,
      };
      notice.value = t("Task moved. Its subtasks stay with it.");
      if (parentId) reveal(parentId);
      await focusTask(source.id);
      return true;
    } catch (reason) {
      error.value = t((reason as Error).message);
      return false;
    }
  }
  async function drop(_task: Task, event: DragEvent) {
    if (
      !dragging.value ||
      !target.value ||
      !event.dataTransfer?.types.includes(dragType)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const source = dragging.value,
      destination = target.value;
    clearDrag();
    await move(source, destination.task, destination.placement);
  }
  async function undoMove() {
    if (!undo.value || store.busy || !confirmDiscard()) return;
    const previous = undo.value,
      source = taskMap.value.get(previous.id);
    const parent = previous.parentId
      ? taskMap.value.get(previous.parentId)
      : undefined;
    const anchor = previous.anchorId
      ? taskMap.value.get(previous.anchorId)
      : undefined;
    error.value = "";
    const unavailable = () => {
      undo.value = null;
      error.value = t(
        "Task move undo is no longer available because tasks changed.",
      );
    };
    if (
      !source ||
      source.voided ||
      source.version !== previous.version ||
      (previous.parentId &&
        (!parent ||
          parent.voided ||
          parent.version !== previous.parentVersion)) ||
      (previous.anchorId &&
        (!anchor ||
          anchor.voided ||
          anchor.version !== previous.anchorVersion ||
          anchor.parentId !== previous.parentId))
    ) {
      unavailable();
      return;
    }
    try {
      await store.moveTask(
        { ...source, version: previous.version },
        {
          parentId: previous.parentId,
          parentVersion: previous.parentVersion,
          anchorId: previous.anchorId,
          anchorVersion: previous.anchorVersion,
          placement: previous.anchorId ? "before" : "last",
        },
      );
      undo.value = null;
      notice.value = t("Task move undone.");
      if (previous.parentId) reveal(previous.parentId);
      await focusTask(source.id);
    } catch (reason) {
      if (reason instanceof ApiError && [400, 404, 409].includes(reason.status))
        unavailable();
      else error.value = t((reason as Error).message);
    }
  }
  async function keyboard(task: Task, event: KeyboardEvent) {
    if (
      !event.altKey ||
      !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
    )
      return;
    event.preventDefault();
    const visible = new Set(
      (visibleTasks?.() ?? store.data.tasks).map((item) => item.id),
    );
    const rows = siblings(task).filter((item) => visible.has(item.id)),
      index = rows.findIndex((item) => item.id === task.id);
    const destination =
      event.key === "ArrowLeft"
        ? taskMap.value.get(task.parentId ?? "")
        : event.key === "ArrowDown"
          ? rows[index + 1]
          : rows[index - 1];
    if (destination)
      await move(
        task,
        destination,
        event.key === "ArrowRight"
          ? "inside"
          : event.key === "ArrowUp"
            ? "before"
            : "after",
      );
  }
  const hint = computed(() =>
    target.value
      ? target.value.invalid ||
        t(
          target.value.placement === "inside"
            ? "Make a subtask of {title}"
            : target.value.placement === "before"
              ? "Move before {title}"
              : "Move after {title}",
          { title: target.value.task.title },
        )
      : "",
  );
  return {
    dragging,
    target,
    error,
    notice,
    undo,
    hint,
    invalid,
    start,
    over,
    leave,
    drop,
    clearDrag,
    move,
    undoMove,
    keyboard,
  };
}
