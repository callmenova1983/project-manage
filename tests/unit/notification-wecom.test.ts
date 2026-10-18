import { expect, it, vi } from "vitest";
import {
  NotificationWecomSender,
  composeNotificationText,
} from "../../apps/api/src/notification-wecom";
const config = {
  enabled: true,
  corpId: "synthetic-corp",
  agentId: 1000001,
  baseUrl: "https://pm.example.test",
  secret: "synthetic-one",
};
it("does not reuse a token across different credential identities with equal version", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("gettoken")
      ? Response.json({
          access_token: `synthetic-token-${String(url).includes("synthetic-one") ? "one" : "two"}`,
        })
      : Response.json({ errcode: 0 }),
  );
  const sender = new NotificationWecomSender(fetcher);
  await sender.send(config, 1, "user.one", "synthetic message", () => true);
  await sender.send(
    { ...config, secret: "synthetic-two" },
    1,
    "user.two",
    "synthetic message",
    () => true,
  );
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("gettoken")),
  ).toHaveLength(2);
  const sends = fetcher.mock.calls.filter(([url]) =>
    String(url).includes("message/send"),
  );
  expect(String(sends[0]![0])).toContain("synthetic-token-one");
  expect(String(sends[1]![0])).toContain("synthetic-token-two");
});
it("rejects broadcast or delimited recipients before contacting the platform", async () => {
  const fetcher = vi.fn<typeof fetch>(),
    sender = new NotificationWecomSender(fetcher);
  for (const user of ["@all", "one|two", ""])
    expect(
      (await sender.send(config, 1, user, "synthetic", () => true)).state,
    ).toBe("failed");
  expect(fetcher).not.toHaveBeenCalled();
});
it("trims complete structured blocks even when user titles contain blank lines", () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: `notification-${index}`,
    title: `任务${index}\n\n补充内容`,
    reason: "请查看当前安排",
  }));
  const result = composeNotificationText(
    items,
    "https://pm.example.test/" + "路径".repeat(220),
  );
  expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(2000);
  expect(result.ids.length).toBeGreaterThan(0);
  expect(result.ids.length).toBeLessThan(6);
  for (const item of items)
    expect(result.text.includes(`/messages/${item.id}`)).toBe(
      result.ids.includes(item.id),
    );
});
it("allows an explicitly bound single identifier containing at-sign and does not mistake it for broadcast",async()=>{
  const fetcher=vi.fn<typeof fetch>(async(url)=>String(url).includes("gettoken")?Response.json({access_token:"synthetic"}):Response.json({errcode:0}));
  const result=await new NotificationWecomSender(fetcher).send(config,1,"member@example.test","synthetic",()=>true);
  expect(result.state).toBe("accepted");
  const body=JSON.parse(String(fetcher.mock.calls[1]![1]!.body));
  expect(body.touser).toBe("member@example.test");
});
it("records a contradictory HTTP success payload as unknown instead of accepted",async()=>{
  const fetcher=vi.fn<typeof fetch>(async(url)=>String(url).includes("gettoken")?Response.json({access_token:"synthetic"}):Response.json({errcode:0},{status:503}));
  expect((await new NotificationWecomSender(fetcher).send(config,1,"user","synthetic",()=>true)).state).toBe("unknown");
});
