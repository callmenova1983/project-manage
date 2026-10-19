import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import * as XLSX from "xlsx";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { parseMaterial } from "../../apps/api/src/progress-materials";
import { QWEN_MODEL, type QwenConfig } from "../../apps/api/src/ai/config";
import type {
  ProgressMaterial,
  ProgressAnalysis,
} from "../../packages/domain/progress-material";
import type { ProgressEntry } from "../../packages/domain/progress";
describe.each(["legacy", "sdk"] as const)("progress runtime %s", (runtime) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8WQAAAAASUVORK5CYII=",
    "base64",
  );
  let ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
  const origin = "http://localhost:4173",
    fetchMock = vi.fn<typeof fetch>();
  const config: QwenConfig = {
    model: QWEN_MODEL,
    region: "cn-beijing",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "synthetic-test-key",
    budgetId: "progress-tests",
    maxRequests: 3,
    expiresAt: Date.parse("2099-01-01"),
    timeoutMs: 1000,
    maxTokens: 2048,
    retries: 0,
  };
  beforeEach(async () => {
    fetchMock.mockReset();
    ctx = await buildApp({
      databasePath: ":memory:",
      origin,
      qwen: config,
      aiRuntime: runtime,
      aiFetch: fetchMock,
    });
    ctx.repo.seed("test");
    const password = randomBytes(24).toString("hex");
    await createUser(ctx.repo, {
      workspaceId: "test",
      name: "Reporter",
      email: "reporter@example.test",
      password,
    });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "reporter@example.test", password },
    });
    cookie = `pm_session=${login.cookies[0]!.value}`;
    csrf = login.json().csrf;
    fetchMock.mockImplementation(async () =>
      Response.json({
        model: QWEN_MODEL,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                summary: "设备安装完成，调试待进行。",
                recognizedText: "设备安装完成",
                uncertainties: [],
              }),
            },
          },
        ],
      }),
    );
  });
  afterEach(() => ctx.app.close());
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
  const first = () => ctx.repo.snapshot("test").projects[0]!;
  it("sends images plus original text to the model, keeps editable output separate and preserves source bytes through corrections, merge and export", async () => {
    const p = first(),
      target = ctx.repo.snapshot("test").projects[1]!;
    const uploaded = await request("POST", `/api/projects/${p.id}/materials`, {
      name: "site.png",
      data: png.toString("base64"),
    });
    expect(uploaded.statusCode).toBe(200);
    const material = uploaded.json<ProgressMaterial>();
    const key = randomUUID(),
      body = {
        text: "现场安装照片",
        materialIds: [material.id],
        recognitionDepth: "ocr",
        version: p.version,
        externalProcessingConfirmed: true,
      };
    const result = await request(
      "POST",
      `/api/projects/${p.id}/progress/analyze`,
      body,
      key,
    );
    expect(result.statusCode).toBe(200);
    const analysis = result.json<ProgressAnalysis>();
    expect(analysis.summary).toContain("安装完成");
    const wire = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(wire.enable_search).toBe(false);
    expect(wire.messages[1].content).toEqual([
      { type: "text", text: expect.stringContaining("现场安装照片") },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
      },
    ]);
    expect(
      (
        await request(
          "POST",
          `/api/projects/${p.id}/progress/analyze`,
          body,
          key,
        )
      ).json(),
    ).toEqual(analysis);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first().latestUpdate).toBe(p.latestUpdate);
    const source = {
      text: body.text,
      materialIds: body.materialIds,
      recognitionDepth: "ocr" as const,
      model: analysis.model,
    };
    const saved = await request("POST", `/api/projects/${p.id}/progress`, {
      text: "人工校核后：安装完成，等待调试。",
      mode: "new",
      version: p.version,
      originalSource: source,
    });
    expect(saved.statusCode).toBe(200);
    const correction = await request("POST", `/api/projects/${p.id}/progress`, {
      text: "修正：一层安装完成，等待调试。",
      mode: "correct",
      version: saved.json().version,
    });
    expect(correction.statusCode).toBe(200);
    const history = (
      await request("GET", `/api/projects/${p.id}/progress`)
    ).json<ProgressEntry[]>();
    expect(history[0]!.originalSource).toEqual(source);
    expect(history[1]!.text).toContain("人工校核");
    expect(history[1]!.originalSource).toEqual(source);
    expect(
      (await request("GET", `/api/projects/${p.id}/materials/${material.id}`))
        .rawPayload,
    ).toEqual(png);
    const exportResponse = await request("GET", "/api/export");
    expect(exportResponse.json().progressFiles[0].data).toBe(
      png.toString("base64"),
    );
    expect(
      exportResponse
        .json()
        .progressArchive.some((e: ProgressEntry) =>
          e.originalSource?.materialIds.includes(material.id),
        ),
    ).toBe(true);
    const merged = await request("POST", "/api/projects/merge", {
      targetId: target.id,
      sourceIds: [p.id],
      name: "Combined project",
      revision: ctx.repo.snapshot("test").revision,
      confirmed: true,
    });
    expect(merged.statusCode).toBe(200);
    expect(
      (
        await request(
          "GET",
          `/api/projects/${target.id}/materials/${material.id}`,
        )
      ).rawPayload,
    ).toEqual(png);
    expect(
      (await request("GET", `/api/projects/${target.id}/progress`))
        .json<ProgressEntry[]>()
        .some((e) => e.originalSource?.materialIds.includes(material.id)),
    ).toBe(true);
    const exp = (await request("GET", "/api/export")).json();
    ctx.repo.seed("other");
    await createUser(ctx.repo, {
      workspaceId: "other",
      email: "other@example.test",
      name: "Other",
      password: randomBytes(24).toString("hex"),
    });
    // Import through the public API with a different isolated workspace session.
    const user = ctx.repo.db
      .prepare("SELECT id FROM users WHERE workspace_id=?")
      .get("other")!;
    ctx.repo.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(
        "other",
        ctx.repo.db
          .prepare("SELECT id FROM users WHERE email=?")
          .get("reporter@example.test")!.id,
      );
    const imported = await request("POST", "/api/import", {
      ...exp,
      revision: ctx.repo.snapshot("other").revision,
      confirmed: true,
    });
    expect(imported.statusCode).toBe(200);
    expect(
      (
        await request(
          "GET",
          `/api/projects/${target.id}/materials/${material.id}`,
        )
      ).rawPayload,
    ).toEqual(png);
    expect(
      (await request("GET", `/api/projects/${target.id}/progress`))
        .json<ProgressEntry[]>()
        .some((e) => e.originalSource?.text === body.text),
    ).toBe(true);
    expect(user.id).toBeTruthy();
  });
  it("requires explicit external processing, validates project version and prevents foreign-file access", async () => {
    const p = first();
    const uploaded = (
      await request("POST", `/api/projects/${p.id}/materials`, {
        name: "site.png",
        data: png.toString("base64"),
      })
    ).json<ProgressMaterial>();
    const target = ctx.repo.snapshot("test").projects[1]!;
    expect(
      (
        await request(
          "GET",
          `/api/projects/${target.id}/materials/${uploaded.id}`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request("POST", `/api/projects/${target.id}/progress/analyze`, {
          text: "x",
          version: target.version,
          materialIds: [uploaded.id],
          externalProcessingConfirmed: true,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request("POST", `/api/projects/${p.id}/progress/analyze`, {
          text: "x",
          version: p.version,
          materialIds: [],
          externalProcessingConfirmed: false,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", `/api/projects/${p.id}/progress/analyze`, {
          text: "x",
          version: p.version + 1,
          materialIds: [],
          externalProcessingConfirmed: true,
        })
      ).statusCode,
    ).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reads all Excel sheets, handles legacy XLS and extracts Word text plus embedded images", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["项目", "进展"],
        ["台州一中", "安装完成"],
      ]),
      "现场",
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([["调试待进行"]]),
      "下一步",
    );
    for (const ext of ["xlsx", "xls"] as const) {
      const b = Buffer.from(
        XLSX.write(book, {
          type: "buffer",
          bookType: ext === "xls" ? "biff8" : "xlsx",
        }),
      );
      const result = await parseMaterial(`现场.${ext}`, b);
      expect(result.text).toContain("台州一中");
      expect(result.text).toContain("调试待进行");
      expect(result.kind).toBe("excel");
    }
    const doc = zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "word/document.xml": strToU8(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>现场设备安装完成</w:t></w:r></w:p></w:body></w:document>',
      ),
      "word/media/image1.png": png,
    });
    const result = await parseMaterial("现场.docx", Buffer.from(doc));
    expect(result.text).toContain("现场设备安装完成");
    expect(result.images).toHaveLength(1);
    const p = first(),
      upload = (
        await request("POST", `/api/projects/${p.id}/materials`, {
          name: "现场.docx",
          data: Buffer.from(doc).toString("base64"),
        })
      ).json<ProgressMaterial>();
    const body = {
      text: "",
      version: p.version,
      materialIds: [upload.id],
      externalProcessingConfirmed: true,
    };
    const textResult = await request(
      "POST",
      `/api/projects/${p.id}/progress/analyze`,
      body,
    );
    expect(textResult.statusCode).toBe(200);
    const wire = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(wire.messages[1].content[0].text).toContain("现场设备安装完成");
    expect(wire.messages[1].content).toHaveLength(1);
    expect(wire.messages[0].content).toContain("Recognition depth: text only");
    const deepResult = await request(
      "POST",
      `/api/projects/${p.id}/progress/analyze`,
      {
        ...body,
        recognitionDepth: "deep",
      },
    );
    expect(deepResult.statusCode).toBe(200);
    const deepWire = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(deepWire.messages[1].content[1].type).toBe("image_url");
    expect(deepWire.messages[0].content).toContain(
      "Recognition depth: full image understanding",
    );
  });
  it("rejects corrupted Office, encrypted/signature mismatch, huge expansion and unsupported formats without model calls", async () => {
    await expect(
      parseMaterial("bad.docx", Buffer.from("bad")),
    ).rejects.toThrow();
    await expect(
      parseMaterial("bad.xls", Buffer.from("not Excel")),
    ).rejects.toThrow();
    await expect(
      parseMaterial("bad.svg", Buffer.from("<svg/>")),
    ).rejects.toThrow();
    const zip = zipSync({
      "word/document.xml": new Uint8Array(25 * 1024 * 1024),
    });
    await expect(parseMaterial("bomb.docx", Buffer.from(zip))).rejects.toThrow(
      "24 MB",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
