import type { IncomingHttpHeaders } from "node:http";
function originOnly(value: string | string[] | undefined): string {
  if (value === undefined) return "missing";
  if (typeof value !== "string") return "invalid";
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      ? url.origin
      : "invalid";
  } catch {
    return "invalid";
  }
}
function protocolOnly(value: string | string[] | undefined): string {
  return value === undefined
    ? "missing"
    : value === "http" || value === "https"
      ? value
      : "invalid";
}
function hostOnly(value: string | string[] | undefined): string {
  if (value === undefined) return "missing";
  if (typeof value !== "string" || /[\s/@?#,]/.test(value)) return "invalid";
  const parsed = originOnly(`http://${value}`);
  return parsed === "invalid" ? parsed : new URL(parsed).host;
}
/** Explicit allowlist: never include raw headers, body, path, cookie, tokens or IP addresses. */
export function safeOriginDiagnostic(
  headers: IncomingHttpHeaders,
  configuredOrigin: string,
  peerIsLoopback: boolean,
) {
  const forwarded =
    typeof headers.forwarded === "string"
      ? headers.forwarded.split(",")[0]!
      : "";
  const forwardedValue = (key: "host" | "proto") => {
    const part = forwarded
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.toLowerCase().startsWith(key + "="));
    return part?.slice(key.length + 1).replace(/^"|"$/g, "");
  };
  return {
    event: "origin-probe",
    configuredOrigin,
    origin: originOnly(headers.origin),
    host: hostOnly(headers.host),
    forwardedHost: hostOnly(forwardedValue("host")),
    forwardedProto: protocolOnly(forwardedValue("proto")),
    xForwardedHost: hostOnly(headers["x-forwarded-host"]),
    xForwardedProto: protocolOnly(headers["x-forwarded-proto"]),
    refererOrigin: originOnly(headers.referer),
    peerIsLoopback,
  };
}
