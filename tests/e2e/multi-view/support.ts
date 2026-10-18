import {
  expect,
  request,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Snapshot } from "../../../packages/domain/types";

export const runDirectory = process.env.PM_MULTI_VIEW_TEST_DIR!;
export const origin = `http://127.0.0.1:${process.env.PM_MULTI_VIEW_E2E_PORT ?? 4189}`;
export type Session = {
  csrf: string;
  state: Awaited<ReturnType<APIRequestContext["storageState"]>>;
};
let cached: Session[] | undefined;
export async function sessions(): Promise<Session[]> {
  if (cached) return cached;
  const saved = resolve(runDirectory, "test-session-state.json");
  if (existsSync(saved)) {
    cached = JSON.parse(readFileSync(saved, "utf8")) as Session[];
    return cached;
  }
  const credentials = JSON.parse(
    readFileSync(resolve(runDirectory, "credentials.json"), "utf8"),
  ) as { email: string; password: string }[];
  const result: Session[] = [];
  for (const credential of credentials) {
    const api = await request.newContext({ baseURL: origin });
    let login = await api.post("/api/auth/login", { data: credential });
    if (login.status() === 429) {
      const seconds = Number(login.headers()["retry-after"]);
      expect(seconds > 0 && seconds <= 60).toBe(true);
      await new Promise((done) => setTimeout(done, seconds * 1000 + 100));
      login = await api.post("/api/auth/login", { data: credential });
    }
    expect(login.status()).toBe(200);
    result.push({
      csrf: (await login.json()).csrf,
      state: await api.storageState(),
    });
    await api.dispose();
  }
  cached = result;
  writeFileSync(saved, JSON.stringify(result), { mode: 0o600 });
  return result;
}
export async function snapshot(page: Page): Promise<Snapshot> {
  const response = await page.request.get("/api/workspace");
  expect(response.status()).toBe(200);
  return response.json();
}
export async function resetWorkspace(
  page: Page,
  preferences: { language: "en" | "zh"; theme: "light" | "dark" } = {
    language: "en",
    theme: "light",
  },
) {
  const [session] = await sessions();
  await page.context().addCookies(session!.state.cookies);
  await page.addInitScript((value) => {
    localStorage.setItem("project-manage-locale", value.language);
    localStorage.setItem("project-manage-theme", value.theme);
  }, preferences);
  const current = await snapshot(page);
  const fixture = JSON.parse(
    readFileSync(resolve(runDirectory, "snapshot.json"), "utf8"),
  );
  const response = await page.request.post("/api/import", {
    headers: { "x-csrf-token": session!.csrf, "idempotency-key": randomUUID() },
    data: { ...fixture, revision: current.revision, confirmed: true },
  });
  expect(response.status(), await response.text()).toBe(200);
}
export const mutationHeaders = (session: Session) => ({
  "x-csrf-token": session.csrf,
  "idempotency-key": randomUUID(),
});
