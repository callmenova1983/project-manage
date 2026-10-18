import { sha256 } from "./browser-crypto";
import type {
  NotificationAdminState,
  NotificationConfigInput,
} from "../../../../packages/domain/notification-delivery";
import { ApiError } from "./contracts";

/** Kept separate from the workspace adapter so notification credentials never
 * enter the workspace snapshot or the browser's demo storage. */
export function createNotificationAdminApi(
  mode: "server" | "local",
  fetcher: typeof fetch = fetch,
) {
  const pending = new Map<string, string>();
  async function readResponse<T>(response: Response): Promise<T> {
    let value: {
      message?: string;
      issues?: { path: string; message: string }[];
    };
    try {
      value = await response.json();
      if (!value || typeof value !== "object") throw new Error();
    } catch {
      throw new ApiError(
        "服务返回了无法读取的响应，请稍后重试。",
        response.status,
      );
    }
    if (!response.ok)
      throw new ApiError(
        value.message ?? "通知设置请求未成功，请重试。",
        response.status,
        undefined,
        value.issues,
      );
    return value as T;
  }
  async function request<T>(
    path: string,
    method: "GET" | "PUT" | "POST" = "GET",
    body?: unknown,
  ): Promise<T> {
    if (mode === "local")
      throw new ApiError("演示模式只展示通知设置，不连接企业微信或服务端。");
    let fingerprint = "";
    let key = "";
    let csrf = "";
    if (method !== "GET") {
      // Hash the payload rather than retaining plaintext notification secrets.
      fingerprint = await sha256(method + path + JSON.stringify(body));
      key = pending.get(fingerprint) ?? crypto.randomUUID();
      pending.set(fingerprint, key);
      try {
        const session = await readResponse<{ csrf: string }>(
          await fetcher("/api/auth/session", {
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.timeout(15000),
          }),
        );
        if (!session.csrf || typeof session.csrf !== "string")
          throw new ApiError("登录会话已失效，请刷新页面后重试。", 401);
        csrf = session.csrf;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError("无法读取登录会话，请检查连接后重试。");
      }
    }
    let response: Response;
    try {
      response = await fetcher(`/api/admin/notifications${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers:
          method === "GET"
            ? undefined
            : {
                "Content-Type": "application/json",
                "x-csrf-token": csrf,
                "idempotency-key": key,
              },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiError("无法连接服务，请检查网络后重试，当前输入仍然保留。");
    }
    // Unknown/5xx outcomes retain the same key, preventing accidental duplicate
    // changes when the user retries after an interrupted response.
    const result = await readResponse<T>(response).catch((error) => {
      if (response.status >= 400 && response.status < 500)
        pending.delete(fingerprint);
      throw error;
    });
    pending.delete(fingerprint);
    return result;
  }
  return {
    state: () => request<NotificationAdminState>(""),
    saveConfig: (input: NotificationConfigInput) =>
      request<NotificationAdminState>("/config", "PUT", input),
    confirmBindings: (employeeIds: string[], configVersion: number) =>
      request<NotificationAdminState>("/bindings", "POST", {
        employeeIds,
        configVersion,
      }),
    retry: (id: string, confirmUnknown = false) =>
      request<NotificationAdminState>("/retry", "POST", {
        id,
        ...(confirmUnknown ? { confirmUnknown: true } : {}),
      }),
  };
}
