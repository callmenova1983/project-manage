import { z } from "zod";
export const wecomLoginInput = z
  .object({
    version: z.number().int().nonnegative(),
    enabled: z.boolean(),
    corpId: z.string().trim().min(1).max(128),
    agentId: z.string().trim().regex(/^\d+$/),
    secret: z.string().trim().max(512),
    autoProvision: z.boolean(),
  })
  .strict();
export type WecomLoginConfig = Omit<z.infer<typeof wecomLoginInput>, "version">;
export interface WecomLoginState {
  version: number;
  enabled: boolean;
  corpId: string;
  agentId: string;
  secretConfigured: boolean;
  autoProvision: boolean;
  entryUrl: string;
  callbackUrl: string;
  trustedDomain: string;
  lastEvent: { createdAt: string; outcome: string } | null;
}
export const wecomLoginErrors: Record<string, string> = {
  expired: "企微授权已过期或已使用，请重新登录。",
  unavailable: "企微免登尚未启用或配置已变更，请联系管理员。",
  upstream:
    "企微身份验证失败，请重试；管理员可检查应用凭据、可信域名和服务器可信 IP。",
  member:
    "未找到有效的企微成员身份，请使用公司企业微信，并联系管理员检查应用可见范围。",
  directory: "尚未同步该企微成员，或成员已停用，请联系管理员。",
  unlinked: "尚未关联系统账号，请联系管理员在团队通讯录中绑定账号。",
  disabled: "系统账号尚未激活或已停用，请联系管理员。",
};
export function safeWecomReturn(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2000 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    Array.from(value).some((char) => char.charCodeAt(0) <= 32)
  )
    return "/projects";
  try {
    const url = new URL(value, "https://pm.invalid");
    if (
      url.origin !== "https://pm.invalid" ||
      /^\/(api|demo)(\/|$)/.test(decodeURIComponent(url.pathname))
    )
      return "/projects";
    url.searchParams.delete("wecom_error");
    return url.pathname + url.search + url.hash;
  } catch {
    return "/projects";
  }
}
