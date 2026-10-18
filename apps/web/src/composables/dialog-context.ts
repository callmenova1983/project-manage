import type { ComputedRef, InjectionKey, Ref } from "vue";

export const dialogContextKey: InjectionKey<{
  active: ComputedRef<boolean>;
  persistent?: boolean;
  target: Ref<HTMLElement | null>;
}> = Symbol("dialog-context");
