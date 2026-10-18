import { z } from "zod";
import {
  directorySchema,
  type CompanyDirectory,
} from "../../../packages/domain/directory.js";
export interface WecomConfig {
  corpId: string;
  secret: string;
  workspaceId: string;
}
export function readWecomConfig(
  env: NodeJS.ProcessEnv,
): WecomConfig | undefined {
  if (
    !env.WECOM_CORP_ID ||
    !env.WECOM_CONTACT_SECRET ||
    !env.WECOM_WORKSPACE_ID
  )
    return;
  return {
    corpId: env.WECOM_CORP_ID,
    secret: env.WECOM_CONTACT_SECRET,
    workspaceId: env.WECOM_WORKSPACE_ID,
  };
}
export class WecomError extends Error {}
const responseSchema = z
  .object({ errcode: z.number().optional(), errmsg: z.string().optional() })
  .passthrough();
const departmentsSchema = z.object({
  department: z
    .array(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(120),
        parentid: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});
const membersSchema = z.object({
  userlist: z
    .array(
      z.object({
        userid: z.string().min(1).max(100),
        name: z.string().min(1).max(80),
        department: z.array(z.number().int().positive()).max(30),
        position: z.string().max(120).optional(),
        email: z.string().optional(),
        biz_mail: z.string().optional(),
        status: z.number().optional(),
      }),
    )
    .max(5000),
});

/** Fetch only the app-visible roster; never write back to the enterprise. */
export async function syncWecomDirectory(
  current: CompanyDirectory,
  config: WecomConfig,
  fetcher: typeof fetch = fetch,
): Promise<CompanyDirectory> {
  const budget = AbortSignal.timeout(60000);
  const get = async (path: string, params: Record<string, string>) => {
    const url = new URL(`https://qyapi.weixin.qq.com/cgi-bin/${path}`);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetcher(url, {
        signal: AbortSignal.any([budget, AbortSignal.timeout(15000)]),
        redirect: "error",
      });
    } catch {
      throw new WecomError(
        "Unable to reach the enterprise directory. No local data was changed.",
      );
    }
    if (!response.ok)
      throw new WecomError(
        `Enterprise directory request failed (HTTP ${response.status}).`,
      );
    let result;
    try {
      result = responseSchema.parse(await response.json());
    } catch {
      throw new WecomError(
        "Enterprise directory returned an invalid response.",
      );
    }
    if (path === "gettoken" && result.errcode === 40001)
      throw new WecomError(
        "Enterprise WeChat rejected the CorpID and Secret when obtaining an access token (40001). Check the Secret for this CorpID in the enterprise admin console; enter the Secret, not an access_token. No local data was changed.",
      );
    if (result.errcode === 60020)
      throw new WecomError(
        "Enterprise WeChat rejected the server IP (60020). Add the server's public outbound IP to the application's trusted IP list, then sync again. No local data was changed.",
      );
    if (result.errcode)
      throw new WecomError(
        `Enterprise directory returned error ${result.errcode}. Check permissions and configuration.`,
      );
    return result;
  };
  const auth = z.object({ access_token: z.string().min(1) }).parse(
    await get("gettoken", {
      corpid: config.corpId,
      corpsecret: config.secret,
    }),
  );
  const remoteDepartments = departmentsSchema.parse(
    await get("department/list", { access_token: auth.access_token }),
  ).department;
  const departments = structuredClone(current.departments);
  const remoteToLocal = new Map<number, string>();
  for (const remote of remoteDepartments) {
    let local = departments.find((d) => d.wecomId === remote.id);
    if (!local) {
      const matches = departments.filter(
        (d) => d.name === remote.name && d.wecomId === null,
      );
      if (matches.length === 1) local = matches[0];
    }
    if (!local) {
      local = {
        id: `wecom-dept-${remote.id}`,
        name: remote.name,
        parentId: null,
        wecomId: remote.id,
      };
      departments.push(local);
    }
    local.name = remote.name;
    local.wecomId = remote.id;
    remoteToLocal.set(remote.id, local.id);
  }
  for (const remote of remoteDepartments)
    departments.find((d) => d.id === remoteToLocal.get(remote.id))!.parentId =
      remoteToLocal.get(remote.parentid) ?? null;
  const remoteUsers = new Map<
    string,
    z.infer<typeof membersSchema>["userlist"][number]
  >();
  // Explicitly traverse visible departments; do not rely on fetch_child.
  for (const department of remoteDepartments) {
    const users = membersSchema.parse(
      await get("user/list", {
        access_token: auth.access_token,
        department_id: String(department.id),
      }),
    ).userlist;
    for (const user of users) remoteUsers.set(user.userid, user);
    if (remoteUsers.size > 5000)
      throw new WecomError(
        "Enterprise directory exceeds the supported roster size.",
      );
  }
  const employees = structuredClone(current.employees);
  const syncedAt = new Date().toISOString();
  for (const remote of remoteUsers.values()) {
    const email = remote.biz_mail || remote.email || "";
    let local = employees.find((e) => e.wecomUserId === remote.userid);
    if (!local && email) {
      const matches = employees.filter(
        (e) => e.email.toLowerCase() === email.toLowerCase() && !e.wecomUserId,
      );
      if (matches.length === 1) local = matches[0];
    }
    if (!local) {
      local = {
        id: `wecom-user-${remote.userid}`,
        name: remote.name,
        employeeNo: "",
        departmentIds: [],
        position: "",
        email: "",
        wecomUserId: remote.userid,
        userId: null,
        active: true,
        source: "wecom",
      };
      employees.push(local);
    }
    local.name = remote.name;
    local.wecomUserId = remote.userid;
    local.wecomCorpId = config.corpId;
    local.wecomSeenAt = syncedAt;
    local.email = email;
    local.departmentIds = remote.department
      .map((id) => remoteToLocal.get(id))
      .filter((id): id is string => !!id);
    local.position = remote.position ?? local.position;
    local.active = remote.status !== 2 && remote.status !== 5;
    local.source = "wecom";
  }
  return directorySchema.parse({
    ...current,
    departments,
    employees,
    version: current.version + 1,
    lastSyncedAt: syncedAt,
  });
}
