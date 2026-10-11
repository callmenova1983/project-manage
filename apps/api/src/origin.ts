import type { IncomingHttpHeaders } from "node:http";

/** Validate operator configuration, never derive trusted origins from request headers. */
export function validateAppOrigin(value: string, production = false): string {
  const invalid = () =>
    new Error(
      "APP_ORIGIN must be one explicit http(s) browser origin, without a page path, credentials, query, fragment or wildcard.",
    );
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid();
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname.includes("*") ||
    url.hostname.includes(",")
  )
    throw invalid();
  if (production && url.protocol !== "https:")
    throw new Error("Production requires an explicit HTTPS APP_ORIGIN");
  // Browser Origin excludes a trailing slash and default port and normalizes host case.
  return url.origin;
}
export function configuredAppOrigin(
  env: Record<string, string | undefined>,
): string {
  const production = env.NODE_ENV === "production";
  if (production && !env.APP_ORIGIN)
    throw new Error("Production requires an explicit HTTPS APP_ORIGIN");
  return validateAppOrigin(
    env.APP_ORIGIN ?? "http://localhost:4173",
    production,
  );
}

export interface CodespacesOriginRewrite {
  internalOrigin: string;
  internalHost: string;
  publicOrigin: string;
  publicHost: string;
}

/** Opt in only on an identified Codespace bound to loopback, with its exact port URL. */
export function configuredCodespacesRewrite(
  env: Record<string, string | undefined>,
  publicOrigin: string,
): CodespacesOriginRewrite | undefined {
  if (!env.CODESPACES_ORIGIN_REWRITE || env.CODESPACES_ORIGIN_REWRITE === "0")
    return undefined;
  const port = Number(env.PORT ?? 3001);
  const name = env.CODESPACE_NAME;
  if (
    env.CODESPACES_ORIGIN_REWRITE !== "1" ||
    env.CODESPACES !== "true" ||
    !name ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !["127.0.0.1", "::1"].includes(env.HOST ?? "127.0.0.1") ||
    publicOrigin !== `https://${name}-${port}.app.github.dev`
  )
    throw new Error(
      "CODESPACES_ORIGIN_REWRITE requires CODESPACES=true, the matching CODESPACE_NAME/PORT HTTPS APP_ORIGIN, and a loopback HOST.",
    );
  return {
    internalOrigin: `http://localhost:${port}`,
    internalHost: `localhost:${port}`,
    publicOrigin,
    publicHost: new URL(publicOrigin).host,
  };
}

export function isLoopback(peer: string | undefined): boolean {
  return peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
}

function refererOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

export function allowedMutationOrigin(
  headers: IncomingHttpHeaders,
  peer: string | undefined,
  allowedOrigin: string,
  rewrite?: CodespacesOriginRewrite,
): boolean {
  // A supplied Referer must never contradict the trusted browser origin.
  const referer = refererOrigin(headers.referer);
  if (headers.referer !== undefined && referer !== allowedOrigin) return false;
  // Preserve non-browser clients; authenticated mutations still require CSRF.
  if (headers.origin === undefined || headers.origin === allowedOrigin)
    return true;
  // Codespaces rewrites Origin and Host. Forwarding headers alone are untrusted:
  // require the explicit deployment opt-in, loopback peer, browser Referer and
  // every observed proxy field to match the operator's exact configuration.
  return (
    !!rewrite &&
    rewrite.publicOrigin === allowedOrigin &&
    isLoopback(peer) &&
    headers.origin === rewrite.internalOrigin &&
    headers.host === rewrite.internalHost &&
    headers["x-forwarded-host"] === rewrite.publicHost &&
    headers["x-forwarded-proto"] === "https" &&
    headers.forwarded === undefined &&
    referer === allowedOrigin &&
    (headers["sec-fetch-site"] === undefined ||
      headers["sec-fetch-site"] === "same-origin")
  );
}
