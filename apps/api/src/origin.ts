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
