import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, type EffectScope } from "vue";
import { useMapTranslation } from "../../apps/web/src/composables/map-translation";
import { locale } from "../../apps/web/src/locales";
import { api } from "../../apps/web/src/services/api";
vi.mock("../../apps/web/src/services/api", () => ({
  api: { translateMap: vi.fn() },
}));
vi.mock("../../apps/web/src/locales", async () => {
  const { ref } = await import("vue");
  return { locale: ref("en") };
});
let scope: EffectScope;
let serial = 0;
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.translateMap!).mockReset();
  locale.value = "en";
  scope = effectScope();
});
afterEach(() => {
  scope.stop();
  vi.useRealTimers();
});

it("translates once, reuses source-keyed results and restores the untouched Chinese view", async () => {
  const texts = ref(["原项目"]),
    owner = ref(`test-${serial++}`);
  vi.mocked(api.translateMap!).mockResolvedValue({
    translations: ["Original Project"],
  });
  const display = scope.run(() => useMapTranslation(owner, texts, ref(true)))!;
  expect(display.text("原项目")).not.toMatch(/\p{Script=Han}/u);
  await vi.advanceTimersByTimeAsync(300);
  expect(display.text("原项目")).toBe("Original Project");
  locale.value = "zh-CN";
  await nextTick();
  expect(display.text("原项目")).toBe("原项目");
  locale.value = "en";
  await nextTick();
  await vi.advanceTimersByTimeAsync(13000);
  expect(api.translateMap).toHaveBeenCalledTimes(1);
  texts.value = ["新项目"];
  await nextTick();
  vi.mocked(api.translateMap!).mockResolvedValue({
    translations: ["New Project"],
  });
  await vi.advanceTimersByTimeAsync(300);
  expect(display.text("新项目")).toBe("New Project");
  expect(texts.value).toEqual(["新项目"]);
});

it("rejects late results from another workspace and respects the request interval", async () => {
  const owner = ref(`old-${serial++}`),
    texts = ref(["原项目"]);
  let complete!: (value: { translations: string[] }) => void;
  vi.mocked(api.translateMap!).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const display = scope.run(() => useMapTranslation(owner, texts, ref(true)))!;
  await vi.advanceTimersByTimeAsync(300);
  owner.value = `new-${serial++}`;
  await nextTick();
  complete({ translations: ["Private old translation"] });
  await nextTick();
  expect(display.text("原项目")).not.toBe("Private old translation");
  vi.mocked(api.translateMap!).mockResolvedValue({
    translations: ["New workspace project"],
  });
  await vi.advanceTimersByTimeAsync(13000);
  expect(display.text("原项目")).toBe("New workspace project");
});

it("uses honest English-only fallbacks offline and stops automatic retries after failure", async () => {
  const display = scope.run(() =>
    useMapTranslation(
      ref(`offline-${serial++}`),
      ref(["中文进展"]),
      ref(false),
    ),
  )!;
  expect(display.text("中文进展", "text")).toBe(
    "English translation unavailable.",
  );
  await vi.advanceTimersByTimeAsync(300);
  expect(api.translateMap).not.toHaveBeenCalled();
  vi.mocked(api.translateMap!).mockRejectedValue(new Error("offline"));
  const online = scope.run(() =>
    useMapTranslation(ref(`online-${serial++}`), ref(["中文进展"]), ref(true)),
  )!;
  await vi.advanceTimersByTimeAsync(30000);
  expect(api.translateMap).toHaveBeenCalledTimes(1);
  expect(online.failed.value).toBe(true);
  expect(online.text("中文进展", "text")).toBe(
    "English translation unavailable.",
  );
});
