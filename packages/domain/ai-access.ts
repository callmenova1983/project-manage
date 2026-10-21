export interface PersonalAccessTokenInfo {
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AiAccessState {
  token: PersonalAccessTokenInfo | null;
}

export interface AiAccessGrant {
  token: string;
  info: PersonalAccessTokenInfo;
}

/** Origin comes from the page the member is actually using, including its proxy. */
export function aiAccessInstructions(origin: string, token: string) {
  const base = new URL(origin).origin;
  return `请接入我们的 PM 项目管理系统。

系统地址：${base}
鉴权请求头：Authorization: Bearer ${token}
接口文档：${base}/api/ai-access/docs
初始化接口：GET ${base}/api/ai-access/context

请携带上述 Authorization 请求头读取接口文档和初始化接口，获取我的身份、所有可访问的项目列表及任务概况，并向我说明连接结果。
接口权限沿用我的成员权限；后续根据我的要求自行使用文档中的接口。
不要在回复或文件中输出接入凭据。`;
}
