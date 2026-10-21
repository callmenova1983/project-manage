import {
  safeWecomReturn,
  wecomLoginErrors,
} from "../../../../packages/domain/wecom-login";
export function enterpriseBrowser(agent: string) {
  return /wxwork/i.test(agent);
}
export function enterpriseLoginUrl(entry: string, returnTo: string) {
  const url = new URL(entry, window.location.origin);
  // The server may use a public origin behind a local development proxy.
  if (
    url.origin !== window.location.origin ||
    url.pathname !== "/api/auth/wecom/start"
  )
    return "";
  url.searchParams.set("returnTo", safeWecomReturn(returnTo));
  return url.pathname + url.search;
}
export function enterpriseLoginError() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("wecom_error");
  if (!code) return "";
  url.searchParams.delete("wecom_error");
  window.history.replaceState(
    window.history.state,
    "",
    url.pathname + url.search + url.hash,
  );
  return wecomLoginErrors[code] || "企微登录未完成，请重新尝试。";
}
