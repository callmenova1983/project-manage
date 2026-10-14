export interface EntryCheck {
  path: string;
  profile: "desktop" | "mobile-agent";
  status: number | null;
  contentType: string;
  bytes: number;
  redirectOrigin?: string;
  issues: string[];
}
const agents = {
  desktop: "ProjectManage-EntryCheck/1.0",
  "mobile-agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
};
export async function checkEntry(
  input: string,
  fetchImpl: typeof fetch = fetch,
) {
  const origin = new URL(input);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error(
      "Supply an HTTP(S) origin without credentials, path, query or fragment",
    );
  const checks: EntryCheck[] = [];
  async function probe(
    path: string,
    profile: keyof typeof agents,
    kind: "html" | "health" | "script" | "style",
  ) {
    const result: EntryCheck = {
      path,
      profile,
      status: null,
      contentType: "",
      bytes: 0,
      issues: [],
    };
    checks.push(result);
    let text = "";
    try {
      const response = await fetchImpl(new URL(path, origin), {
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        headers: {
          "User-Agent": agents[profile],
          Accept: kind === "html" ? "text/html" : "*/*",
        },
        signal: AbortSignal.timeout(10000),
      });
      result.status = response.status;
      result.contentType = (response.headers.get("content-type") ?? "")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      if (response.status >= 300 && response.status < 400) {
        result.issues.push("redirect-requires-operator-review");
        const location = response.headers.get("location");
        if (location) {
          try {
            result.redirectOrigin = new URL(location, origin).origin;
          } catch {
            /* no raw redirect values */
          }
        }
        await response.body?.cancel();
        return text;
      }
      if (response.status !== 200)
        result.issues.push(`http-${response.status}`);
      if (/attachment/i.test(response.headers.get("content-disposition") ?? ""))
        result.issues.push("attachment-instead-of-web-page");
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            result.bytes += part.value.byteLength;
            if (result.bytes > 2 * 1024 * 1024) {
              result.issues.push("response-over-diagnostic-limit");
              await reader.cancel();
              return "";
            }
            text += decoder.decode(part.value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      }
      if (!result.bytes) result.issues.push("empty-get-response");
      const types = {
        html: ["text/html"],
        health: ["application/json"],
        script: ["application/javascript", "text/javascript"],
        style: ["text/css"],
      };
      if (!types[kind].includes(result.contentType))
        result.issues.push("unexpected-content-type");
      if (kind === "html" && !/data-pm-entry=["']1["']/.test(text))
        result.issues.push("project-manage-shell-not-found");
      if (kind === "health") {
        try {
          if (JSON.parse(text).status !== "ok") throw new Error();
        } catch {
          result.issues.push("health-not-ok");
        }
      }
    } catch {
      result.issues.push("network-or-timeout");
    }
    return text;
  }
  for (const profile of Object.keys(agents) as (keyof typeof agents)[]) {
    const html = await probe("/projects", profile, "html");
    await probe("/demo/projects", profile, "html");
    await probe("/api/health", profile, "health");
    const assets = new Map<string, "script" | "style">();
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      try {
        const url = new URL(match[1]!, origin);
        if (
          url.origin !== origin.origin ||
          !url.pathname.startsWith("/assets/") ||
          url.search ||
          url.hash
        )
          continue;
        if (/\.js$/.test(url.pathname)) assets.set(url.pathname, "script");
        if (/\.css$/.test(url.pathname)) assets.set(url.pathname, "style");
      } catch {
        /* inspect same-origin built assets only */
      }
    }
    if (!assets.size)
      checks
        .find((c) => c.profile === profile && c.path === "/projects")!
        .issues.push("built-assets-not-found");
    for (const [path, kind] of [...assets].slice(0, 4))
      await probe(path, profile, kind);
  }
  return {
    origin: origin.origin,
    checkedAt: new Date().toISOString(),
    passed: checks.every((check) => !check.issues.length),
    // A mobile user-agent probe is not a real Safari/device/login test.
    authenticatedAccessTested: false,
    realDeviceTested: false,
    checks,
  };
}
