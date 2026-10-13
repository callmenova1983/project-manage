import { it, expect, vi } from "vitest";
import { checkEntry } from "../../apps/api/src/entry-check";
const html =
  '<div data-pm-entry="1"></div><script src="/assets/app.js"></script><link href="/assets/app.css">';
function healthy(url: URL | RequestInfo) {
  const path = new URL(String(url)).pathname;
  if (path === "/api/health") return Response.json({ status: "ok" });
  if (path.endsWith(".js"))
    return new Response("export const ready=true;", {
      headers: { "content-type": "text/javascript" },
    });
  if (path.endsWith(".css"))
    return new Response("body{}", { headers: { "content-type": "text/css" } });
  return new Response(html, { headers: { "content-type": "text/html" } });
}
it("checks desktop/mobile-agent HTML, health and same-origin bundles with no credentials", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (url) => healthy(url));
  const result = await checkEntry("https://workspace.example.test", fetch);
  expect(result.passed).toBe(true);
  expect(result.realDeviceTested).toBe(false);
  expect(result.authenticatedAccessTested).toBe(false);
  expect(result.checks).toHaveLength(10);
  for (const [, options] of fetch.mock.calls) {
    expect(options?.credentials).toBe("omit");
    expect(options?.redirect).toBe("manual");
  }
});
it("reports zero-body GET, attachment and MIME errors without recording response contents", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/projects")
        return new Response("", {
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": "attachment; filename=private-name",
          },
        });
      return new Response("private proxy body", {
        status: 503,
        headers: { "content-type": "text/html" },
      });
    });
  const result = await checkEntry("https://workspace.example.test", fetch);
  expect(result.passed).toBe(false);
  expect(result.checks[0]!.issues).toEqual(
    expect.arrayContaining([
      "empty-get-response",
      "attachment-instead-of-web-page",
      "unexpected-content-type",
    ]),
  );
  expect(JSON.stringify(result)).not.toContain("private");
});
it("never follows login redirects or fetches foreign assets and omits redirect secrets", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/demo/projects")
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://login.example.test/signin?token=private-token",
          },
        });
      if (path === "/projects")
        return new Response(
          html +
            '<script src="https://foreign.example.test/private.js"></script>',
          { headers: { "content-type": "text/html" } },
        );
      return healthy(url);
    });
  const result = await checkEntry("https://workspace.example.test", fetch);
  expect(result.passed).toBe(false);
  expect(result.checks[1]?.redirectOrigin).toBe("https://login.example.test");
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(
    fetch.mock.calls.every(
      ([url]) =>
        new URL(String(url)).origin === "https://workspace.example.test",
    ),
  ).toBe(true);
});
it("reports stale JavaScript served as HTML and bounded network failures", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith(".js"))
        return new Response(html, { headers: { "content-type": "text/html" } });
      if (path === "/api/health") throw new Error("private network detail");
      return healthy(url);
    });
  const result = await checkEntry("https://workspace.example.test", fetch);
  expect(result.passed).toBe(false);
  expect(result.checks.find((c) => c.path.endsWith(".js"))?.issues).toContain(
    "unexpected-content-type",
  );
  expect(result.checks.find((c) => c.path === "/api/health")?.issues).toContain(
    "network-or-timeout",
  );
  expect(JSON.stringify(result)).not.toContain("private network detail");
});
it("rejects credential-bearing or non-origin inputs before making requests", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const url of [
    "https://user:secret@example.test",
    "https://example.test/projects",
    "https://example.test/?token=secret",
    "file:///tmp/file",
  ]) {
    await expect(checkEntry(url, fetch)).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});
