import { z } from "zod";

export const notificationConfigInput = z
  .object({
    version: z.number().int().nonnegative(),
    enabled: z.boolean(),
    corpId: z.string().trim().max(128).regex(/^\S*$/),
    agentId: z.number().int().nonnegative(),
    baseUrl: z.string().trim().max(500),
    secret: z.string().trim().max(512),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (!input.enabled) return;
    if (!input.corpId || !input.agentId)
      ctx.addIssue({
        code: "custom",
        message: "请填写通知应用的企业 ID 和 AgentID。",
      });
    try {
      const url = new URL(input.baseUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())
      )
        throw Error();
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "请填写手机可访问的 HTTPS 业务地址，不使用 localhost。",
      });
    }
  });
export type NotificationConfigInput = z.infer<typeof notificationConfigInput>;
export interface NotificationDeliveryConfig {
  enabled: boolean;
  corpId: string;
  agentId: number;
  baseUrl: string;
  secret: string;
}
export interface NotificationAdminState {
  config: Omit<NotificationConfigInput, "secret"> & {
    secretConfigured: boolean;
  };
  bindings: {
    employeeId: string;
    userId: string;
    name: string;
    wecomUserId: string;
    active: boolean;
    confirmed: boolean;
    reason: string;
  }[];
  deliveries: {
    id: string;
    recipient: string;
    title: string;
    state: string;
    attempts: number;
    error: string;
    createdAt: string;
    updatedAt: string;
    externalId: string | null;
  }[];
  directoryCorpId: string;
  directoryVerified: boolean;
}
