import type { NotificationDeliveryConfig } from "../../../packages/domain/notification-delivery.js";
import { createHash } from "node:crypto";
import type { NotificationItem } from "../../../packages/domain/notifications.js";

export function composeNotificationText(
  items: Pick<NotificationItem, "id" | "title" | "reason">[],
  baseUrl: string,
) {
  const blocks = items.map((item) => ({
    id: item.id,
    text: `${item.title.slice(0, 45)}\n${item.reason.slice(0, 70)}\n${baseUrl.replace(/\/$/, "")}/messages/${encodeURIComponent(item.id)}`,
  }));
  const build = () =>
    "项目工作提醒\n\n" + blocks.map((block) => block.text).join("\n\n");
  while (blocks.length && Buffer.byteLength(build(), "utf8") > 2000)
    blocks.pop();
  return { text: build(), ids: blocks.map((block) => block.id) };
}

export interface NotificationSendResult {
  state: "accepted" | "failed" | "unknown" | "cancelled";
  error: string;
  messageId?: string;
  retryable?: boolean;
}
/** Application DM payload verified against WecomTeam's Agent API client.
 * https://github.com/WecomTeam/wecom-openclaw-plugin/blob/main/src/agent/api-client.ts
 * A successful API response is acceptance, never a read or business receipt.
 */
export class NotificationWecomSender {
  private tokens = new Map<string, { token: string; expires: number }>();
  constructor(private fetcher: typeof fetch = fetch) {}
  async send(
    config: NotificationDeliveryConfig,
    version: number,
    userId: string,
    content: string,
    stillValid: () => boolean,
  ): Promise<NotificationSendResult> {
    if (!userId || userId.toLowerCase()==="@all" || /[|\s]/.test(userId))
      return {
        state: "failed",
        error: "接收人绑定无效，请重新核对企业微信成员。",
      };
    if (Buffer.byteLength(content, "utf8") > 2000)
      return {
        state: "failed",
        error: "通知摘要过长，请缩短业务地址或摘要后重试。",
      };
    const key = `${config.corpId}:${config.agentId}:${version}:${createHash("sha256").update(config.secret).digest("hex")}`;
    let token = this.tokens.get(key);
    if (!token || token.expires <= Date.now()) {
      try {
        const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
        url.searchParams.set("corpid", config.corpId);
        url.searchParams.set("corpsecret", config.secret);
        const response = await this.fetcher(url, {
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        });
        const value = (await response.json()) as {
          errcode?: number;
          access_token?: string;
          expires_in?: number;
        };
        if (!response.ok || !value.access_token || value.errcode)
          return {
            state: "failed",
            error: `通知应用授权失败${value.errcode ? `（${value.errcode}）` : ""}，请检查应用配置和服务器可信 IP。`,
            retryable: response.status >= 500 || value.errcode === -1,
          };
        token = {
          token: value.access_token,
          expires:
            Date.now() + Math.max(30, (value.expires_in ?? 7200) - 60) * 1000,
        };
        this.tokens.set(key, token);
      } catch {
        return {
          state: "failed",
          error: "未能连接企业微信获取授权，尚未提交消息。",
          retryable: true,
        };
      }
    }
    if (!stillValid())
      return {
        state: "cancelled",
        error: "发送前事项、接收人或通知设置已变更。",
      };
    try {
      const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/message/send");
      url.searchParams.set("access_token", token.token);
      const response = await this.fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          touser: userId,
          agentid: config.agentId,
          msgtype: "text",
          text: { content },
        }),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      const value = (await response.json()) as {
        errcode?: number;
        msgid?: string;
        invaliduser?: string;
      };
      if (!response.ok && value.errcode===0) return {state:"unknown",error:"HTTP 状态与消息结果不一致，请核查后再决定是否重发。"};
      if (response.ok && value.errcode === 0 && !value.invaliduser)
        return { state: "accepted", error: "", messageId: value.msgid };
      if (typeof value.errcode !== "number")
        return {
          state: "unknown",
          error: "企业微信返回结果无法确认，请核查后再决定是否重发。",
        };
      if ([40014, 42001].includes(value.errcode)) this.tokens.delete(key);
      return {
        state: "failed",
        error: value.invaliduser
          ? "接收人无效或不在通知应用可见范围，请核对绑定。"
          : `企业微信未接受消息（${value.errcode}），请检查应用配置、权限或限流。`,
        retryable: [-1, 45009, 45011, 40014, 42001].includes(value.errcode),
      };
    } catch {
      return {
        state: "unknown",
        error: "消息请求已提交但未获得确定结果，已停止自动重试，请核查。",
      };
    }
  }
}
