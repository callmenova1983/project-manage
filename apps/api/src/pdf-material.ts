import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { HttpError } from "./database.js";

const require = createRequire(import.meta.url);
const FILE_LIMIT = 8 * 1024 * 1024;

export interface ParsedPdfMaterial {
  text: string;
  kind: "file";
  images: string[];
  warnings: string[];
}

// Run the library and native canvas work away from the API event loop. The
// program is fixed; document JavaScript, actions and embedded files never run.
const program = String.raw`
const { parentPort, workerData: d } = require('node:worker_threads');
let loadingTask;
(async () => {
  const pdfjs = await import(d.pdfjs);
  const { createCanvas } = require(d.canvas);
  class BoundedCanvasFactory {
    create(width, height) {
      this.check(width, height);
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext('2d') };
    }
    check(width, height) {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > 16 * 1024 * 1024) {
        throw Error('PDF 页面或图片尺寸过大，请降低分辨率后重新添加。');
      }
    }
    reset(target, width, height) {
      this.check(width, height);
      target.canvas.width = width;
      target.canvas.height = height;
    }
    destroy(target) {
      target.canvas.width = target.canvas.height = 0;
      target.canvas = target.context = null;
    }
  }
  let oversizedImage = false;
  const log = console.log;
  const warn = console.warn;
  console.log = console.warn = (...args) => {
    if (args.some(value => String(value).includes('Image exceeded maximum allowed size'))) oversizedImage = true;
  };
  loadingTask = pdfjs.getDocument({
    data: new Uint8Array(d.bytes),
    cMapUrl: d.cmaps,
    cMapPacked: true,
    standardFontDataUrl: d.fonts,
    wasmUrl: d.wasm,
    useWorkerFetch: false,
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: true,
    CanvasFactory: BoundedCanvasFactory,
    maxImageSize: 16 * 1024 * 1024,
    verbosity: 1,
  });
  try {
    const pdf = await loadingTask.promise;
    if (await pdf.getPermissions() !== null) throw Error('PDF 已加密，请先解除密码和权限保护后重新添加。');
    const parts = [], images = [], imagePages = [], skippedImagePages = [];
    const imageOps = new Set([
      pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintInlineImageXObjectGroup,
      pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageMaskXObjectGroup,
      pdfjs.OPS.paintImageMaskXObjectRepeat, pdfjs.OPS.paintSolidColorImageMask,
    ]);
    let characters = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        if (text) {
          const part = '【第 ' + number + ' 页】\n' + text;
          characters += part.length + (parts.length ? 2 : 0);
          if (characters > 16000) throw Error('PDF 文字超过 16000 字，请拆分文件后重新添加。');
          parts.push(part);
        }
        // A scanned page may also have selectable page numbers or a header.
        // Inspect actual drawing operations so those words cannot hide its scan.
        const needsImage = !text || (await page.getOperatorList()).fnArray.some(op => imageOps.has(op));
        if (needsImage) {
          if (images.length >= 6) {
            if (!text) throw Error('PDF 中需要图片识别的页面超过 6 页，请拆分文件后重新添加。');
            skippedImagePages.push(number);
            continue;
          }
          const base = page.getViewport({ scale: 1 });
          if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0) throw Error('PDF 页面尺寸无效，请重新导出 PDF。');
          const scale = Math.min(2, 1600 / Math.max(base.width, base.height), Math.sqrt(2 * 1024 * 1024 / (base.width * base.height)));
          const viewport = page.getViewport({ scale });
          const canvas = pdf.canvasFactory.create(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
          try {
            await page.render({ canvasContext: canvas.context, viewport }).promise;
            if (oversizedImage) throw Error('PDF 中的图片像素过大，无法完整识别，请降低图片分辨率后重新添加。');
            const image = canvas.canvas.toBuffer('image/png');
            if (image.length > 8 * 1024 * 1024) throw Error('PDF 页面图片超过 8 MB，请降低分辨率后重新添加。');
            images.push('data:image/png;base64,' + image.toString('base64'));
            imagePages.push(number);
          } finally {
            pdf.canvasFactory.destroy(canvas);
          }
        }
      } finally {
        page.cleanup();
      }
    }
    const warnings = [];
    if (imagePages.length) warnings.push('PDF 第 ' + imagePages.join('、') + ' 页已转为图片供 AI 识别，请核对识别结果。');
    if (skippedImagePages.length) warnings.push('PDF 最多识别 6 页图片；第 ' + skippedImagePages.slice(0, 20).join('、') + (skippedImagePages.length > 20 ? ' 等共 ' + skippedImagePages.length : '') + ' 页的文字和原始附件已保留，额外图片内容尚未识别，请拆分文件后补充。');
    parentPort.postMessage({ text: parts.join('\n\n'), kind: 'file', images, warnings });
  } finally {
    await loadingTask.destroy();
    console.log = log;
    console.warn = warn;
  }
})().catch(error => {
  const message = (error.message || '').includes('Image exceeded maximum allowed size')
    ? 'PDF 中的图片像素过大，无法完整识别，请降低图片分辨率后重新添加。'
    : error.name === 'PasswordException'
    ? 'PDF 已加密，请先解除密码和权限保护后重新添加。'
    : /^PDF /u.test(error.message || '') ? error.message
    : 'PDF 文件损坏或无法解析，请重新导出 PDF 后添加。';
  parentPort.postMessage({ error: message });
});
`;

export async function parsePdfMaterial(
  bytes: Buffer,
): Promise<ParsedPdfMaterial> {
  if (!bytes.length || bytes.length > FILE_LIMIT)
    throw new HttpError(400, "每个 PDF 文件大小须在 0 到 8 MB 之间。");
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
    throw new HttpError(
      400,
      "PDF 文件格式无效，请确认文件内容或重新导出 PDF。",
    );

  const root = dirname(require.resolve("pdfjs-dist/package.json"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(program, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      workerData: {
        bytes,
        pdfjs: pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"))
          .href,
        canvas: require.resolve("@napi-rs/canvas"),
        cmaps: join(root, "cmaps") + sep,
        fonts: join(root, "standard_fonts") + sep,
        wasm: join(root, "wasm") + sep,
      },
    });
    let settled = false;
    const finish = (error?: string, result?: ParsedPdfMaterial) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(new HttpError(400, error));
      else resolve(result!);
    };
    const timer = setTimeout(
      () => finish("PDF 解析超时，请拆分文件后重新添加。"),
      10000,
    );
    worker.once("message", (result: ParsedPdfMaterial & { error?: string }) =>
      finish(result.error, result),
    );
    worker.once("error", () =>
      finish("PDF 解析失败或超出内存限制，请拆分文件或重新导出 PDF。"),
    );
    worker.once("exit", () =>
      finish("PDF 解析意外停止，请拆分文件或重新导出 PDF。"),
    );
  });
}
