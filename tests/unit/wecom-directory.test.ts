import { expect, it, vi } from "vitest";
import { emptyDirectory } from "../../packages/domain/directory";
import { readWecomConfig, syncWecomDirectory } from "../../apps/api/src/wecom";
const config = {
  corpId: "test-corp",
  secret: "test-secret",
  workspaceId: "test",
};
it("requires an explicit workspace and keeps tokens and secrets out of returned contacts", async () => {
  expect(
    readWecomConfig({ WECOM_CORP_ID: "corp", WECOM_CONTACT_SECRET: "secret" }),
  ).toBeUndefined();
  const original = {
    ...emptyDirectory(),
    departments: [
      { id: "tech", name: "技术部", parentId: null, wecomId: null },
    ],
    employees: [
      {
        id: "person",
        name: "Person",
        employeeNo: "NGB004",
        departmentIds: ["tech"],
        position: "Engineer",
        email: "",
        wecomUserId: "staff004",
        userId: "account",
        active: true,
        source: "manual" as const,
      },
    ],
  };
  const fetcher = vi.fn(async (url: URL | RequestInfo) => {
    const path = new URL(String(url)).pathname;
    return Response.json(
      path.endsWith("gettoken")
        ? { access_token: "test-token" }
        : path.endsWith("department/list")
          ? {
              errcode: 0,
              department: [
                { id: 1, name: "Company", parentid: 0 },
                { id: 2, name: "技术部", parentid: 1 },
              ],
            }
          : {
              errcode: 0,
              userlist: [
                {
                  userid: "staff004",
                  name: "Updated",
                  department: [2],
                  position: "Senior Engineer",
                  status: 1,
                },
              ],
            },
    );
  });
  const result = await syncWecomDirectory(
    original,
    config,
    fetcher as typeof fetch,
  );
  expect(result.employees).toHaveLength(1);
  expect(result.employees[0]).toMatchObject({
    id: "person",
    employeeNo: "NGB004",
    name: "Updated",
    userId: "account",
    departmentIds: ["tech"],
  });
  expect(result.departments.find((d) => d.id === "tech")!.parentId).toBe(
    "wecom-dept-1",
  );
  expect(result.version).toBe(2);
  expect(JSON.stringify(result)).not.toContain("test-token");
  expect(JSON.stringify(result)).not.toContain("test-secret");
  expect(original.employees[0]!.name).toBe("Person");
});
it("leaves the original directory intact when a remote API fails", async () => {
  const original = emptyDirectory();
  await expect(
    syncWecomDirectory(
      original,
      config,
      vi.fn(async () =>
        Response.json({ errcode: 40013, errmsg: "token secret" }),
      ) as typeof fetch,
    ),
  ).rejects.toThrow("40013");
  expect(original).toEqual(emptyDirectory());
});
