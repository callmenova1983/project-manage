import {
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  shallowRef,
  watch,
  type InjectionKey,
  type Ref,
  type ShallowRef,
} from "vue";
import { createTaskViewMemory } from "../services/task-view-memory";
import { useRoute } from "vue-router";
import { dialogContextKey } from "./dialog-context";
const key: InjectionKey<ReturnType<typeof createTaskViewMemory>> =
  Symbol("task-view-memory");

export function provideTaskViewMemory(identity: () => string) {
  const memory = createTaskViewMemory();
  provide(key, memory);
  watch(identity, () => memory.reset(), { flush: "sync" });
}
export function useTaskViewMemory<T>(
  name: string,
  initial: () => T,
): ShallowRef<T> {
  return inject(key, null)?.value(name, initial) ?? shallowRef(initial());
}

/** Restore after router scrolling; inactive layouts retain no DOM or task graph. */
export function useTaskViewScroll(
  name: string,
  element?: Ref<HTMLElement | null>,
) {
  const route = useRoute();
  const pane = inject(dialogContextKey, undefined);
  const position = useTaskViewMemory(`scroll:${name}`, () => ({
    left: 0,
    top: 0,
    saved: false,
  }));
  let frame = 0,
    listening = false,
    disposed = false;
  const target = () => element?.value ?? window;
  function record() {
    if (!listening || (pane && !pane.active.value)) return;
    const node = element?.value;
    position.value = {
      left: node ? node.scrollLeft : window.scrollX,
      top: node ? node.scrollTop : window.scrollY,
      saved: true,
    };
  }
  onMounted(async () => {
    await nextTick();
    if (disposed) return;
    frame = requestAnimationFrame(() => {
      if (position.value.saved && !route.hash && (!pane || pane.active.value))
        target().scrollTo({
          left: position.value.left,
          top: position.value.top,
          behavior: "instant",
        });
      listening = true;
      target().addEventListener("scroll", record, { passive: true });
    });
  });
  onBeforeUnmount(() => {
    disposed = true;
    cancelAnimationFrame(frame);
    target().removeEventListener("scroll", record);
    listening = false;
  });
}
