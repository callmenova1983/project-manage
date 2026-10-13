import { channelEntry, type Channel } from "./channels.js";

const noteText = (value?: string) => (value ?? "").replace(/\n/g, "\n  ");
export function formatChannelProfile(channel: Channel): string {
  const lines = [
    "【公司资料】",
    `公司全称：${channel.name}`,
    `渠道简称：${channel.shortName}`,
    `渠道状态：${channel.archived ? "停用" : "启用"}`,
    `公司地址：${channel.address ?? ""}`,
    `公司电话：${channel.phone ?? ""}`,
    `公司网站：${channel.website ?? ""}`,
    `统一社会信用代码：${channel.creditCode ?? ""}`,
    `合作备注：${noteText(channel.notes)}`,
  ];
  for (const contact of channel.contacts ?? []) {
    lines.push(
      "",
      "【联系人】",
      `姓名：${contact.name}`,
      `职务：${contact.position ?? ""}`,
      `电话：${contact.phone ?? ""}`,
      `邮箱：${contact.email ?? ""}`,
      `微信：${contact.wechat ?? ""}`,
      `主要联系人：${contact.primary ? "是" : "否"}`,
      `备注：${noteText(contact.notes)}`,
    );
  }
  return lines.join("\n");
}
export const blankContactText =
  "\n\n【联系人】\n姓名：\n职务：\n电话：\n邮箱：\n微信：\n主要联系人：否\n备注：";
const companyKeys: Record<string, string> = {
  公司全称: "name",
  公司名称: "name",
  渠道简称: "shortName",
  简称: "shortName",
  渠道状态: "archived",
  公司地址: "address",
  地址: "address",
  公司电话: "phone",
  联系电话: "phone",
  公司网站: "website",
  统一社会信用代码: "creditCode",
  合作备注: "notes",
  备注: "notes",
};
const contactKeys: Record<string, string> = {
  姓名: "name",
  职务: "position",
  电话: "phone",
  联系电话: "phone",
  邮箱: "email",
  微信: "wechat",
  主要联系人: "primary",
  备注: "notes",
};
export function parseChannelProfile(text: string, original: Channel): Channel {
  const company: Record<string, unknown> = {
    id: original.id,
    archived: false,
    contacts: [],
  };
  const contacts: Record<string, unknown>[] = [];
  let contact: Record<string, unknown> | undefined;
  let lastKey = "";
  let seen = new Set<string>();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (raw.startsWith("  ") && lastKey === "notes") {
      const target = contact ?? company;
      target.notes = String(target.notes ?? "") + "\n" + raw.slice(2);
      continue;
    }
    const line = raw.trim();
    if (!line) {
      if (lastKey === "notes") {
        const target = contact ?? company;
        target.notes = String(target.notes ?? "") + "\n";
      }
      continue;
    }
    if (/^[【[]公司资料[】\]]$/.test(line)) {
      if (contact)
        throw new Error(`第${index + 1}行：公司资料应放在联系人之前。`);
      lastKey = "";
      continue;
    }
    if (/^[【[]联系人(?:\s*\d+)?[】\]]$/.test(line)) {
      contact = {};
      contacts.push(contact);
      lastKey = "";
      seen = new Set();
      continue;
    }
    const field = /^([^：:]+)[：:]\s*(.*)$/.exec(line);
    const key = field
      ? (contact ? contactKeys : companyKeys)[field[1]!.trim()]
      : undefined;
    const target = contact ?? company;
    if (!key) {
      if (lastKey === "notes") {
        target.notes = String(target.notes ?? "") + "\n" + raw;
        continue;
      }
      throw new Error(
        `第${index + 1}行：请使用“字段名：内容”，或将自由文字放在备注下。`,
      );
    }
    if (seen.has(key))
      throw new Error(`第${index + 1}行：${field![1]}重复，请合并内容。`);
    seen.add(key);
    lastKey = key;
    const value = field![2]!.trim();
    if (key === "archived") {
      if (!["启用", "停用"].includes(value))
        throw new Error("渠道状态请填写启用或停用。");
      target[key] = value === "停用";
    } else if (key === "primary") {
      if (!["是", "否", ""].includes(value))
        throw new Error("主要联系人请填写是或否。");
      target[key] = value === "是";
    } else target[key] = value;
  }
  const used = new Set<string>();
  company.contacts = contacts.map((entry) => {
    const previous = original.contacts?.find(
      (c) => c.name === entry.name && !used.has(c.id),
    );
    const id = previous?.id ?? crypto.randomUUID();
    used.add(id);
    return {
      ...entry,
      notes:
        typeof entry.notes === "string" ? entry.notes.trimEnd() : undefined,
      id,
    };
  });
  if (typeof company.notes === "string")
    company.notes = company.notes.trimEnd();
  const parsed = channelEntry.safeParse(company);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const label =
      issue.path[0] === "contacts"
        ? `联系人${Number(issue.path[1] ?? 0) + 1}`
        : "公司资料";
    throw new Error(
      `${label}未完整填写或格式不正确，请检查公司全称、简称、联系人姓名、邮箱及主要联系人。`,
    );
  }
  return parsed.data;
}
