import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import * as XLSX from "xlsx";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { QWEN_MODEL, type QwenConfig } from "../../apps/api/src/ai/config";
import { CAPTURE_SCOPE } from "../../packages/domain/capture";
import { readModelSettings } from "../../apps/api/src/admin";
let ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
const origin = "http://localhost:4173",
  fetchMock = vi.fn<typeof fetch>();
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8WQAAAAASUVORK5CYII=";
const config: QwenConfig = {
  model: QWEN_MODEL,
  region: "cn-beijing",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "synthetic-test-key",
  budgetId: "capture-tests",
  maxRequests: 6,
  expiresAt: Date.parse("2099-01-01"),
  timeoutMs: 1000,
  maxTokens: 2048,
  retries: 0,
};
const request = (
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  key = randomUUID(),
) =>
  ctx.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: { cookie, origin, "x-csrf-token": csrf, "idempotency-key": key },
  });
async function setup(qwen?: QwenConfig) {
  fetchMock.mockReset();
  ctx = await buildApp({
    databasePath: ":memory:",
    origin,
    qwen,
    aiFetch: fetchMock,
  });
  ctx.repo.seed("capture");
  const password = randomBytes(24).toString("hex");
  await createUser(ctx.repo, {
    workspaceId: "capture",
    name: "Capture tester",
    email: "capture@example.test",
    password,
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "capture@example.test", password },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
}
beforeEach(() => setup(config));
afterEach(() => ctx.app.close());
it("still categorizes filenames without spending an exhausted allowance, and does not guess generic photos", async () => {
  const user = ctx.repo.db
    .prepare("SELECT id FROM users WHERE email=?")
    .get("capture@example.test")!;
  for (let i = 0; i < config.maxRequests; i++)
    ctx.repo.db
      .prepare(
        "INSERT INTO ai_attempts(id,budget_id,user_id,created_at) VALUES(?,?,?,?)",
      )
      .run(randomUUID(), config.budgetId, user.id, Date.now());
  const ids: string[] = [];
  for (const name of ["现场勘察.png", "IMG_1234.png"]) {
    const file = await request("POST", "/api/capture/materials", {
      name,
      data: png,
      referenceOnly: true,
    });
    ids.push(file.json().id);
  }
  const result = await request("POST", "/api/capture/classify", {
    materialIds: ids,
    notes: "",
    externalProcessingConfirmed: true,
  });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({
    provider: "rules",
    files: [
      { id: ids[0], category: "site-photo" },
      { id: ids[1], category: "other" },
    ],
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    ctx.repo.db.prepare("SELECT count(*) AS total FROM ai_attempts").get()!
      .total,
  ).toBe(config.maxRequests);
  ctx.repo.seed("foreign");
  ctx.repo.db
    .prepare("UPDATE progress_materials SET workspace_id=? WHERE id=?")
    .run("foreign", ids[0]);
  expect(
    (
      await request("POST", "/api/capture/classify", {
        materialIds: [ids[0]],
        notes: "",
        externalProcessingConfirmed: true,
      })
    ).statusCode,
  ).toBe(404);
});
it("classifies reference titles without parsing or sending quotation contents, then archives without tasks", async () => {
  const before = ctx.repo.snapshot("capture"),
    project = before.projects[0]!;
  const secretBody = "PRIVATE_QUOTE_DETAIL_".repeat(1500);
  const doc = zipSync({
    "word/document.xml": strToU8(
      `<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>${secretBody}</w:t></w:r></w:p></w:body></w:document>`,
    ),
  });
  const upload = await request("POST", "/api/capture/materials", {
    name: "智慧园区报价方案.docx",
    data: Buffer.from(doc).toString("base64"),
    referenceOnly: true,
  });
  expect(upload.statusCode).toBe(200);
  expect(upload.json()).toMatchObject({
    referenceOnly: true,
    text: "",
    imageCount: 0,
  });
  const id = upload.json().id;
  fetchMock.mockResolvedValue(
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              files: [{ id, category: "quote", projectId: project.id }],
            }),
          },
        },
      ],
    }),
  );
  const classified = await request("POST", "/api/capture/classify", {
    materialIds: [id],
    notes: "项目报价资料",
    externalProcessingConfirmed: true,
  });
  expect(classified.statusCode).toBe(200);
  expect(classified.json()).toMatchObject({
    provider: "qwen",
    files: [{ id, category: "quote" }],
  });
  const wire = String(fetchMock.mock.calls[0]![1]!.body);
  expect(wire).toContain("智慧园区报价方案.docx");
  expect(wire).not.toContain("PRIVATE_QUOTE_DETAIL_");
  expect(wire).not.toContain("image_url");
  const key = randomUUID(),
    body = {
      projectId: project.id,
      version: project.version,
      files: [{ id, category: "quote" }],
    };
  const archived = await request("POST", "/api/capture/archive", body, key);
  expect(archived.statusCode).toBe(200);
  expect(
    (await request("POST", "/api/capture/archive", body, key)).json(),
  ).toEqual(archived.json());
  const files = (
    await request("GET", `/api/projects/${project.id}/files`)
  ).json();
  expect(files.find((file: { id: string }) => file.id === id)).toMatchObject({
    category: "quote",
    referenceOnly: true,
  });
  expect(
    (await request("GET", `/api/projects/${project.id}/materials/${id}`))
      .rawPayload,
  ).toEqual(Buffer.from(doc));
  expect(ctx.repo.snapshot("capture").tasks).toEqual(before.tasks);
  expect(ctx.repo.snapshot("capture").projects).toEqual(before.projects);
  expect(
    ctx.repo.db.prepare("SELECT count(*) AS total FROM proposals").get()!.total,
  ).toBe(0);
});
it("archives site photos and task evidence without inferring completion, and validates all task links atomically", async () => {
  const before = ctx.repo.snapshot("capture"),
    task = before.tasks[0]!,
    project = before.projects.find((p) => p.id === task.projectId)!;
  const uploads = [];
  for (const name of ["现场勘察.jpg", "任务执行凭证.png"]) {
    const result = await request("POST", "/api/capture/materials", {
      name,
      data: png,
      referenceOnly: true,
    });
    expect(result.statusCode).toBe(200);
    uploads.push(result.json().id as string);
  }
  const wrongTask = before.tasks.find((t) => t.projectId !== project.id)!;
  const invalid = await request("POST", "/api/capture/archive", {
    projectId: project.id,
    version: project.version,
    files: [
      { id: uploads[0], category: "site-photo" },
      { id: uploads[1], category: "task-evidence", taskId: wrongTask.id },
    ],
  });
  expect(invalid.statusCode).toBe(400);
  expect(
    (await request("GET", `/api/capture/materials/${uploads[0]}`)).statusCode,
  ).toBe(200);
  const saved = await request("POST", "/api/capture/archive", {
    projectId: project.id,
    version: project.version,
    files: [
      { id: uploads[0], category: "site-photo" },
      { id: uploads[1], category: "task-evidence", taskId: task.id },
    ],
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()[1]).toMatchObject({
    taskId: task.id,
    category: "task-evidence",
  });
  expect(ctx.repo.snapshot("capture").tasks).toEqual(before.tasks);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("reads an explicitly selected temporary screenshot and atomically preserves text while discarding raw bytes", async () => {
  const before = ctx.repo.snapshot("capture");
  const uploaded = await request("POST", "/api/capture/materials", {
    name: "会议截图.png",
    data: png,
    referenceOnly: true,
  });
  const id = uploaded.json().id;
  const extracted = await request(
    "POST",
    `/api/capture/materials/${id}/extract`,
    {},
  );
  expect(extracted.statusCode).toBe(200);
  expect(extracted.json()).toMatchObject({
    referenceOnly: false,
    imageCount: 1,
  });
  fetchMock.mockResolvedValue(
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              text: "智慧园区：本周确认设备清单",
              uncertainties: [],
            }),
          },
        },
      ],
    }),
  );
  const analysis = await request("POST", "/api/capture/analyze", {
    text: "会议记录",
    materialIds: [id],
    recognitionDepth: "ocr",
    externalProcessingConfirmed: true,
  });
  expect(analysis.statusCode).toBe(200);
  const invalid = await request("POST", "/api/proposals", {
    source: "",
    temporaryMaterialIds: [id],
  });
  expect(invalid.statusCode).toBe(400);
  expect(
    (await request("GET", `/api/capture/materials/${id}`)).statusCode,
  ).toBe(200);
  const key = randomUUID(),
    input = {
      source: analysis.json().text,
      originalSource: { text: "会议记录", materialIds: [] },
      temporaryMaterialIds: [id],
    };
  const saved = await request("POST", "/api/proposals", input, key);
  expect(saved.statusCode).toBe(200);
  expect(saved.json().source).toContain("本周确认设备清单");
  expect((await request("POST", "/api/proposals", input, key)).json()).toEqual(
    saved.json(),
  );
  expect(
    (await request("GET", `/api/capture/materials/${id}`)).statusCode,
  ).toBe(404);
  expect(ctx.repo.snapshot("capture").tasks).toEqual(before.tasks);
});
it("never discards an already-retained source or another user's temporary file", async () => {
  const upload = await request("POST", "/api/capture/materials", {
    name: "会议.png",
    data: png,
    referenceOnly: true,
  });
  const id = upload.json().id;
  expect(
    (
      await request("POST", "/api/proposals", {
        source: "已保存记录",
        originalSource: { text: "记录", materialIds: [id] },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await request("POST", "/api/proposals", {
        source: "另一条记录",
        temporaryMaterialIds: [id],
      })
    ).statusCode,
  ).toBe(409);
  const privateFile = await request("POST", "/api/capture/materials", {
    name: "私有临时.png",
    data: png,
    referenceOnly: true,
  });
  const password = randomBytes(24).toString("hex");
  await createUser(ctx.repo, {
    workspaceId: "capture",
    name: "Other",
    email: "other-capture@example.test",
    password,
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "other-capture@example.test", password },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
  expect(
    (
      await request("POST", "/api/proposals", {
        source: "记录",
        temporaryMaterialIds: [privateFile.json().id],
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await request("GET", `/api/capture/materials/${privateFile.json().id}`))
      .statusCode,
  ).toBe(200);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("reads a pasted screenshot before a project exists and sends image bytes with notes to the configured model", async () => {
  const before = ctx.repo.snapshot("capture");
  const upload = await request("POST", "/api/capture/materials", {
    name: "clipboard.png",
    data: png,
  });
  expect(upload.statusCode).toBe(200);
  const id = upload.json().id;
  expect(
    ctx.repo.db
      .prepare("SELECT project_id FROM progress_materials WHERE id=?")
      .get(id)!.project_id,
  ).toBe(CAPTURE_SCOPE);
  fetchMock.mockResolvedValue(
    Response.json({
      model: QWEN_MODEL,
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              text: "新建项目：智慧园区；客户：星河科技；任务：确认需求",
              uncertainties: [],
            }),
          },
        },
      ],
    }),
  );
  const key = randomUUID(),
    body = {
      text: "请整理这张截图",
      materialIds: [id],
      recognitionDepth: "ocr",
      externalProcessingConfirmed: true,
    };
  const analysis = await request("POST", "/api/capture/analyze", body, key);
  expect(analysis.statusCode).toBe(200);
  expect(analysis.json().text).toContain("智慧园区");
  const wire = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
  expect(wire.messages[1].content[1].image_url.url).toBe(
    "data:image/png;base64," + png,
  );
  expect(wire.enable_search).toBe(false);
  expect(
    (await request("POST", "/api/capture/analyze", body, key)).json(),
  ).toEqual(analysis.json());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    (
      await request(
        "POST",
        "/api/capture/analyze",
        {
          ...body,
          recognitionDepth: "deep",
        },
        key,
      )
    ).statusCode,
  ).toBe(409);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(ctx.repo.snapshot("capture").projects).toEqual(before.projects);
  expect(ctx.repo.snapshot("capture").tasks).toEqual(before.tasks);
  const saved = await request("POST", "/api/proposals", {
    source: analysis.json().text,
    originalSource: {
      text: body.text,
      materialIds: [id],
      recognitionDepth: "ocr",
    },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().originalSource.materialIds).toEqual([id]);
  const picture = await request("GET", `/api/capture/materials/${id}/images/0`);
  expect(picture.statusCode).toBe(200);
  expect(picture.rawPayload).toEqual(Buffer.from(png, "base64"));
});
it("extracts Word and Excel without AI calls or creating projects", async () => {
  const doc = zipSync({
    "word/document.xml": strToU8(
      '<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>新建项目：智慧园区；客户：星河科技</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  const word = await request("POST", "/api/capture/materials", {
    name: "notes.docx",
    data: Buffer.from(doc).toString("base64"),
  });
  expect(word.statusCode).toBe(200);
  expect(word.json().text).toContain("星河科技");
  for (const type of ["xlsx", "xls"] as const) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["项目", "负责人"],
        ["智慧园区", "李峰"],
      ]),
      "项目",
    );
    const data = XLSX.write(book, { type: "buffer", bookType: type });
    const sheet = await request("POST", "/api/capture/materials", {
      name: "projects." + type,
      data: Buffer.from(data).toString("base64"),
    });
    expect(sheet.statusCode).toBe(200);
    expect(sheet.json().text).toContain("智慧园区\t李峰");
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
it("reads PDF text through capture and retains the exact original file without calling AI", async () => {
  const bytes = readFileSync(
    new URL("../fixtures/file-preview/report.pdf", import.meta.url),
  );
  const before = ctx.repo.snapshot("capture");
  const upload = await request("POST", "/api/capture/materials", {
    name: "report.pdf",
    data: bytes.toString("base64"),
  });
  expect(upload.statusCode).toBe(200);
  expect(upload.json().text).toContain("Project attachment preview");
  expect(upload.json().kind).toBe("file");
  const download = await request(
    "GET",
    `/api/capture/materials/${upload.json().id}`,
  );
  expect(download.statusCode).toBe(200);
  expect(download.rawPayload).toEqual(bytes);
  expect(ctx.repo.snapshot("capture").projects).toEqual(before.projects);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("defaults to local text extraction without credentials or model calls and replays it safely", async () => {
  await ctx.app.close();
  await setup();
  const document = zipSync({
    "word/document.xml": strToU8(
      '<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>项目：智慧园区；渠道：龙赢；负责人：郑元杰</w:t></w:r></w:p></w:body></w:document>',
    ),
    "word/media/logo.png": Buffer.from(png, "base64"),
  });
  const upload = await request("POST", "/api/capture/materials", {
    name: "source.docx",
    data: Buffer.from(document).toString("base64"),
  });
  expect(upload.statusCode).toBe(200);
  expect(upload.json().imageCount).toBe(1);
  const key = randomUUID();
  const body = {
    text: "补充事项：确认需求",
    materialIds: [upload.json().id],
    externalProcessingConfirmed: true,
  };
  const result = await request("POST", "/api/capture/analyze", body, key);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toEqual({
    text: "补充事项：确认需求\n\n【source.docx】\n项目：智慧园区；渠道：龙赢；负责人：郑元杰",
    uncertainties: [expect.stringContaining("图片未识别")],
    model: "local-text",
  });
  expect(
    (await request("POST", "/api/capture/analyze", body, key)).json(),
  ).toEqual(result.json());
  expect(
    (
      await request(
        "POST",
        "/api/capture/analyze",
        { ...body, recognitionDepth: "text" },
        key,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await request(
        "POST",
        "/api/capture/analyze",
        { ...body, recognitionDepth: "ocr" },
        key,
      )
    ).statusCode,
  ).toBe(409);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    ctx.repo.db.prepare("SELECT count(*) AS total FROM ai_attempts").get()!
      .total,
  ).toBe(0);
  expect(
    ctx.repo.db.prepare("SELECT count(*) AS total FROM model_logs").get()!
      .total,
  ).toBe(0);
  const original = await request(
    "GET",
    `/api/capture/materials/${upload.json().id}`,
  );
  expect(original.rawPayload).toEqual(Buffer.from(document));
});
it("local text extraction works with exhausted or disabled AI without consuming attempts", async () => {
  const userId = String(
    ctx.repo.db
      .prepare("SELECT id FROM users WHERE email=?")
      .get("capture@example.test")!.id,
  );
  for (let i = 0; i < config.maxRequests; i++)
    ctx.repo.db
      .prepare(
        "INSERT INTO ai_attempts(id,budget_id,user_id,created_at) VALUES(?,?,?,?)",
      )
      .run(randomUUID(), config.budgetId, userId, Date.now());
  const body = {
    text: "项目：智慧园区",
    materialIds: [],
    externalProcessingConfirmed: true,
  };
  const exhausted = await request("POST", "/api/capture/analyze", body);
  expect(exhausted.statusCode).toBe(200);
  expect(exhausted.json().model).toBe("local-text");
  const settings = readModelSettings(ctx.repo, "capture", config);
  ctx.repo.db
    .prepare("INSERT INTO model_settings(workspace_id,data) VALUES(?,?)")
    .run("capture", JSON.stringify({ ...settings, enabled: false }));
  const disabled = await request("POST", "/api/capture/analyze", body);
  expect(disabled.statusCode).toBe(200);
  expect(disabled.json().text).toBe(body.text);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    ctx.repo.db.prepare("SELECT count(*) AS total FROM ai_attempts").get()!
      .total,
  ).toBe(config.maxRequests);
});
it("asks for image recognition explicitly when a pure image has no extractable text", async () => {
  const upload = await request("POST", "/api/capture/materials", {
    name: "clipboard.png",
    data: png,
  });
  const result = await request("POST", "/api/capture/analyze", {
    text: "",
    materialIds: [upload.json().id],
    externalProcessingConfirmed: true,
  });
  expect(result.statusCode).toBe(400);
  expect(result.json().code).toBe("CAPTURE_TEXT_UNAVAILABLE");
  expect(result.json().message).toContain("切换");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    ctx.repo.db.prepare("SELECT count(*) AS total FROM ai_attempts").get()!
      .total,
  ).toBe(0);
  expect(
    (await request("GET", `/api/capture/materials/${upload.json().id}`))
      .rawPayload,
  ).toEqual(Buffer.from(png, "base64"));
});
it("distinguishes faithful OCR from grounded diagram and chart interpretation", async () => {
  const upload = await request("POST", "/api/capture/materials", {
    name: "diagram.png",
    data: png,
  });
  fetchMock.mockImplementation(async () =>
    Response.json({
      model: QWEN_MODEL,
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({ text: "图中文字", uncertainties: [] }),
          },
        },
      ],
    }),
  );
  for (const recognitionDepth of ["ocr", "deep"])
    expect(
      (
        await request("POST", "/api/capture/analyze", {
          text: "",
          materialIds: [upload.json().id],
          recognitionDepth,
          externalProcessingConfirmed: true,
        })
      ).statusCode,
    ).toBe(200);
  const ocr = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
  const deep = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
  expect(ocr.messages[0].content).toContain(
    "OCR mode: read visible text and table cells only",
  );
  expect(ocr.messages[0].content).toContain("Do not interpret diagrams");
  expect(deep.messages[0].content).toContain(
    "separate clearly labeled section",
  );
  expect(deep.messages[0].content).toContain("graphical evidence");
  expect(deep.messages[0].content).toContain("Never infer project status");
  expect(ocr.messages[1].content[1].type).toBe("image_url");
  expect(deep.messages[1].content[1].type).toBe("image_url");
});
it("protects project and workspace scopes, consent and malformed uploads", async () => {
  const project = ctx.repo.snapshot("capture").projects[0]!;
  const own = await request("POST", `/api/projects/${project.id}/materials`, {
    name: "project.png",
    data: png,
  });
  expect(own.statusCode).toBe(200);
  const illegal = await request("POST", "/api/capture/analyze", {
    text: "read",
    materialIds: [own.json().id],
    externalProcessingConfirmed: true,
  });
  expect(illegal.statusCode).toBe(404);
  expect(
    (await request("GET", `/api/capture/materials/${own.json().id}`))
      .statusCode,
  ).toBe(404);
  const upload = await request("POST", "/api/capture/materials", {
    name: "capture.png",
    data: png,
  });
  expect(
    (
      await request("POST", "/api/capture/analyze", {
        text: "read",
        materialIds: [upload.json().id],
      })
    ).statusCode,
  ).toBe(400);
  ctx.repo.seed("foreign");
  ctx.repo.db
    .prepare("UPDATE progress_materials SET workspace_id=? WHERE id=?")
    .run("foreign", upload.json().id);
  expect(
    (await request("GET", `/api/capture/materials/${upload.json().id}`))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await request("POST", "/api/proposals", {
        source: "保存事项",
        originalSource: { text: "", materialIds: [upload.json().id] },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await request("POST", "/api/capture/materials", {
        name: "bad.docx",
        data: Buffer.from("not office").toString("base64"),
      })
    ).statusCode,
  ).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
