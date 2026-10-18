import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  randomUuid,
  sha256,
  sha256Fallback,
} from "../../apps/web/src/services/browser-crypto";

afterEach(() => vi.unstubAllGlobals());
it("matches SHA-256 for empty, Unicode and multi-block payloads", async () => {
  for (const text of [
    "",
    "abc",
    "上海工厂项目😀",
    ...[55, 56, 63, 64, 65, 10000].map((n) => "a".repeat(n)),
  ]) {
    const expected = createHash("sha256").update(text).digest("hex");
    expect(sha256Fallback(new TextEncoder().encode(text))).toBe(expected);
    expect(await sha256(text)).toBe(expected);
  }
});
it("supports LAN HTTP without subtle or randomUUID using secure random bytes", async () => {
  const secureRandom = globalThis.crypto.getRandomValues.bind(
    globalThis.crypto,
  );
  vi.stubGlobal("crypto", { getRandomValues: secureRandom });
  expect(await sha256("abc")).toBe(
    createHash("sha256").update("abc").digest("hex"),
  );
  const ids = new Set(Array.from({ length: 100 }, () => randomUuid()));
  expect(ids.size).toBe(100);
  for (const id of ids)
    expect(id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
});
