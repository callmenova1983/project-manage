import { z } from "zod";
export const channelContact = z
  .object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(80),
    position: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(80).optional(),
    email: z.union([z.literal(""), z.string().email().max(200)]).optional(),
    wechat: z.string().trim().max(100).optional(),
    notes: z.string().max(1000).optional(),
    primary: z.boolean().optional(),
  })
  .strict();
export const channelEntry = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/),
    name: z.string().trim().min(1).max(120),
    shortName: z.string().trim().min(1).max(40),
    archived: z.boolean(),
    address: z.string().trim().max(300).optional(),
    phone: z.string().trim().max(80).optional(),
    website: z.string().trim().max(300).optional(),
    creditCode: z.string().trim().max(40).optional(),
    notes: z.string().max(4000).optional(),
    contacts: z.array(channelContact).max(50).optional(),
  })
  .strict()
  .superRefine((channel, ctx) => {
    const contacts = channel.contacts ?? [];
    if (new Set(contacts.map((c) => c.id)).size !== contacts.length)
      ctx.addIssue({ code: "custom", message: "联系人标识不能重复。" });
    if (contacts.filter((c) => c.primary).length > 1)
      ctx.addIssue({
        code: "custom",
        message: "每个渠道只能设置一位主要联系人。",
      });
  });
export type Channel = z.infer<typeof channelEntry>;
export const defaultChannels: Channel[] = [
  ["company", "公司"],
  ["jiangong", "建工"],
  ["meixiang", "美象"],
  ["yecheng", "邺城"],
  ["kaixin", "开芯"],
  ["boyu", "铂宇"],
].map(([id, name]) => ({
  id: id!,
  name: name!,
  shortName: name!,
  archived: false,
}));
export function channelEntries(catalog: { channels?: Channel[] }) {
  return catalog.channels ?? defaultChannels;
}
export function projectChannel(project: { channelId?: string }) {
  return project.channelId ?? "company";
}
export function checkChannels(
  next: Channel[],
  old: Channel[],
  projects: { channelId?: string }[],
) {
  if (
    new Set(next.map((c) => c.id)).size !== next.length ||
    new Set(next.map((c) => c.shortName)).size !== next.length
  )
    throw new Error("渠道标识和简称不能重复。");
  if (!next.some((c) => c.id === "company" && !c.archived))
    throw new Error("公司是默认渠道，不能停用。");
  if (old.some((c) => !next.some((n) => n.id === c.id)))
    throw new Error("已有渠道请停用，不能直接删除。");
  if (projects.some((p) => !next.some((c) => c.id === projectChannel(p))))
    throw new Error("渠道变更会破坏已有项目的归属。");
}
