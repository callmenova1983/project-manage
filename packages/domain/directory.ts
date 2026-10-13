import { z } from "zod";
const id = z.string().trim().min(1).max(100);
export const departmentSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    parentId: id.nullable(),
    wecomId: z.number().int().positive().nullable(),
  })
  .strict();
export const employeeSchema = z
  .object({
    id,
    employeeNo: z.string().trim().max(80),
    name: z.string().trim().min(1).max(80),
    departmentIds: z.array(id).max(30),
    position: z.string().trim().max(120),
    email: z.union([z.literal(""), z.string().email().max(200)]),
    wecomUserId: z.string().trim().max(100),
    userId: id.nullable(),
    active: z.boolean(),
    source: z.enum(["manual", "wecom"]),
  })
  .strict();
export const directorySchema = z
  .object({
    version: z.number().int().positive(),
    companyName: z.string().trim().min(1).max(120),
    departments: z.array(departmentSchema).max(500),
    employees: z.array(employeeSchema).max(5000),
    lastSyncedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const deptIds = new Set(value.departments.map((d) => d.id));
    if (
      deptIds.size !== value.departments.length ||
      new Set(value.employees.map((e) => e.id)).size !== value.employees.length
    )
      error("Directory identifiers must be unique.");
    for (const key of ["employeeNo", "wecomUserId", "userId"] as const) {
      const values = value.employees.map((e) => e[key]).filter(Boolean);
      if (new Set(values).size !== values.length)
        error(
          "Employee numbers, enterprise user IDs and account links must be unique.",
        );
    }
    const remoteIds = value.departments
      .map((d) => d.wecomId)
      .filter((v) => v !== null);
    if (new Set(remoteIds).size !== remoteIds.length)
      error("Enterprise department IDs must be unique.");
    for (const dept of value.departments) {
      const seen = new Set([dept.id]);
      let parentId = dept.parentId;
      while (parentId) {
        if (!deptIds.has(parentId) || seen.has(parentId)) {
          error("Department hierarchy is invalid.");
          break;
        }
        seen.add(parentId);
        parentId = value.departments.find((d) => d.id === parentId)!.parentId;
      }
    }
    if (
      value.employees.some(
        (e) =>
          new Set(e.departmentIds).size !== e.departmentIds.length ||
          e.departmentIds.some((d) => !deptIds.has(d)),
      )
    )
      error("An employee references an invalid department.");
  });
export type CompanyDirectory = z.infer<typeof directorySchema>;
export type Employee = z.infer<typeof employeeSchema>;
export type Department = z.infer<typeof departmentSchema>;
export interface ProjectMember {
  projectId: string;
  userId: string;
  name: string;
  department: string;
  position: string;
  joinedAt: string;
  lastEditedAt: string;
}
export interface WecomSyncState {
  configured: boolean;
  lastSyncedAt: string | null;
  mode: "server" | "local";
}
export function emptyDirectory(): CompanyDirectory {
  return {
    version: 1,
    companyName: "公司",
    departments: [],
    employees: [],
    lastSyncedAt: null,
  };
}
