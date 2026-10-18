import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { api } from "../services/api";
import { locale } from "../locales";
import { englishNameFallback, hasHan } from "../services/map-english";

// Session-only, scoped to the signed-in workspace/user. Source text is the key,
// so edits invalidate their own translations without changing project records.
const caches = new Map<string, Map<string, string>>();
export function useMapTranslation(
  scope: Ref<string>,
  sources: Ref<string[]>,
  enabled: Ref<boolean>,
) {
  const revision = ref(0),
    busy = ref(false),
    failed = ref(false);
  let alive = true,
    timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let nextRequestAt = 0;
  const attempted = new Set<string>();
  function cache() {
    let value = caches.get(scope.value);
    if (!value) {
      if (caches.size >= 4) caches.delete(caches.keys().next().value!);
      caches.set(scope.value, (value = new Map()));
    }
    return value;
  }
  const pending = computed(() => {
    void revision.value;
    return [
      ...new Set(
        sources.value.filter(
          (text) => hasHan(text) && text.length <= 4000 && !cache().has(text),
        ),
      ),
    ];
  });
  async function run() {
    if (
      !alive ||
      busy.value ||
      failed.value ||
      locale.value !== "en" ||
      !enabled.value ||
      !api.translateMap
    )
      return;
    if (Date.now() < nextRequestAt) {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), nextRequestAt - Date.now());
      return;
    }
    const batch: string[] = [];
    let size = 0;
    for (const text of pending.value) {
      if (attempted.has(text)) continue;
      if (batch.length >= 12 || size + text.length + 1 > 8000) break;
      batch.push(text);
      size += text.length + 1;
    }
    if (!batch.length) return;
    const target = cache(),
      ticket = generation;
    batch.forEach((text) => attempted.add(text));
    busy.value = true;
    nextRequestAt = Date.now() + 12500;
    try {
      const result = await api.translateMap(batch);
      if (!alive || ticket !== generation) return;
      result.translations.forEach((translated, index) => {
        if (!translated || hasHan(translated) || !batch[index]) return;
        if (target.size >= 1000) target.delete(target.keys().next().value!);
        target.set(batch[index]!, translated);
      });
      revision.value++;
    } catch {
      if (alive && ticket === generation) failed.value = true;
    } finally {
      busy.value = false;
      if (alive) schedule();
    }
  }
  function schedule() {
    clearTimeout(timer);
    // Stay below the existing AI route's five requests/minute limit.
    timer = setTimeout(() => void run(), 12500);
  }
  watch(
    [locale, sources, enabled, scope],
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 250);
    },
    { immediate: true },
  );
  watch(scope, () => {
    generation++;
    attempted.clear();
    failed.value = false;
  });
  onScopeDispose(() => {
    alive = false;
    generation++;
    clearTimeout(timer);
  });
  function text(value: string, kind: "name" | "text" = "name") {
    if (locale.value !== "en" || !hasHan(value)) return value;
    void revision.value;
    return (
      cache().get(value) ??
      (kind === "name"
        ? englishNameFallback(value)
        : value.length <= 4000 &&
            (busy.value || (enabled.value && !failed.value))
          ? "Translating into English…"
          : "English translation unavailable.")
    );
  }
  function retry() {
    attempted.clear();
    failed.value = false;
    void run();
  }
  return { text, busy, failed, pending, retry };
}
