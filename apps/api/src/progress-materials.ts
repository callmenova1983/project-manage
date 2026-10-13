import type { Mutate } from "./intake.js";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  MATERIAL_LIMIT,
  materialInput,
  type ProgressMaterial,
} from "../../../packages/domain/progress-material.js";
import type { Actor, Project } from "../../../packages/domain/types.js";
import { HttpError, type Repository } from "./database.js";
const require = createRequire(import.meta.url);
// Fixed worker program: documents are data, never executable HTML/macros/formulas.
const program = String.raw`
const {parentPort,workerData:d} = require('node:worker_threads');
(async()=>{
 const b=Buffer.from(d.bytes), ext=d.name.split('.').pop().toLowerCase();
 const png=Buffer.from('89504e470d0a1a0a','hex'), ole=Buffer.from('d0cf11e0a1b11ae1','hex');
 const mime=(b)=> b.subarray(0,8).equals(png)?'image/png': b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg': b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 let text='',kind='',images=[], warnings=[];
 function image(bytes){const type=mime(bytes);if(!type)return;if(images.length>=6)throw Error('Too many embedded images (maximum 6). Split the document.');if(bytes.length>8*1024*1024)throw Error('An embedded image exceeds 8 MB.');images.push('data:'+type+';base64,'+bytes.toString('base64'));}
 if(['png','jpg','jpeg','webp'].includes(ext)){if(!mime(b))throw Error('The image format does not match its file name.');kind='image';image(b);}
 else if(['xlsx','docx'].includes(ext)){
  if(b[0]!==80||b[1]!==75)throw Error('The Office file is invalid or encrypted.');
  let expanded=0;
  const zip=require(d.fflate).unzipSync(b,{filter:f=>{expanded+=f.originalSize;if(expanded>24*1024*1024)throw Error('The expanded document exceeds 24 MB.');return true;}});
  const required=ext==='xlsx'?'xl/workbook.xml':'word/document.xml';if(!zip[required])throw Error('The Office file does not match its file name.');
  for(const [name,bytes] of Object.entries(zip))if(/^(word|xl)\/media\//.test(name)){if(!mime(Buffer.from(bytes)))throw Error('An embedded picture format is unsupported. Convert it to PNG or JPEG.');image(Buffer.from(bytes));}
  if(ext==='docx'){
   kind='word';const {DOMParser}=require(d.xml);
   const plain=(node)=>{if(node.nodeType===3)return node.data;const local=node.localName||'';if(local==='tab')return '\t';if(local==='br')return '\n';if(local==='tr')return Array.from(node.childNodes).filter(n=>n.localName==='tc').map(plain).join('\t')+'\n';let value=Array.from(node.childNodes||[]).map(plain).join('');return value+(local==='p'?'\n':'');};
   const parts=Object.keys(zip).filter(n=>/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
   for(const part of parts){const xml=Buffer.from(zip[part]).toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Document entity declarations are not supported.');const doc=new DOMParser({onError:(level,message)=>{if(level!=='warning')throw Error('The Word XML is invalid.');}}).parseFromString(xml,'text/xml');text+=plain(doc.documentElement)+'\n';}
  }
  else {kind='excel';const x=require(d.xlsx),book=x.read(b,{type:'buffer',cellFormula:false,cellHTML:false,sheetRows:501});for(const name of book.SheetNames){const sheet=book.Sheets[name];const range=x.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');if(range.e.r>=500||range.e.c>=50)throw Error('A worksheet exceeds 500 rows or 50 columns. Split the workbook.');text+='\n【'+name+'】\n'+x.utils.sheet_to_csv(sheet,{FS:'\t',blankrows:false});}}
 }
 else if(['xls','doc'].includes(ext)){
  if(!b.subarray(0,8).equals(ole))throw Error('The legacy Office file is invalid. Save it as XLSX or DOCX.');
  if(ext==='xls'){kind='excel';const x=require(d.xlsx),book=x.read(b,{type:'buffer',cellFormula:false,cellHTML:false,sheetRows:501});for(const name of book.SheetNames){const s=book.Sheets[name],r=x.utils.decode_range(s['!fullref']||s['!ref']||'A1');if(r.e.r>=500||r.e.c>=50)throw Error('A worksheet exceeds 500 rows or 50 columns. Split the workbook.');text+='\n【'+name+'】\n'+x.utils.sheet_to_csv(s,{FS:'\t',blankrows:false});}}
  else{kind='word';const Word=require(d.word);const doc=await new Word().extract(b);text=[doc.getBody(),doc.getHeaders(),doc.getFootnotes(),doc.getEndnotes()].filter(Boolean).join('\n');}
  // Legacy Office drawings are not safely reconstructable by text parsers.
  warnings.push('Legacy Office text was extracted. To recognize embedded pictures, save as XLSX/DOCX or paste their screenshots.');
 }
 else if(['txt','csv','tsv'].includes(ext)){kind='text';text=new TextDecoder('utf-8',{fatal:true}).decode(b);}
 else throw Error('Use PNG, JPEG, WebP, XLS, XLSX, DOC, DOCX, TXT, CSV or TSV.');
 if(text.length>16000)throw Error('The document exceeds 16000 characters. Split it into smaller files.');
 if(!text.trim()&&!images.length)throw Error('No readable content was found. Paste a screenshot of the document.');
 parentPort.postMessage({text,kind,images,warnings});
})().catch(e=>parentPort.postMessage({error:e.message}));
`;
export interface ParsedMaterial {
  text: string;
  kind: ProgressMaterial["kind"];
  images: string[];
  warnings: string[];
}
export async function parseMaterial(
  name: string,
  bytes: Buffer,
): Promise<ParsedMaterial> {
  if (!bytes.length || bytes.length > MATERIAL_LIMIT)
    throw new HttpError(400, "Each file must be no larger than 8 MB.");
  return new Promise((resolve, reject) => {
    const worker = new Worker(program, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      workerData: {
        name,
        bytes,
        xlsx: require.resolve("xlsx"),
        xml: require.resolve("@xmldom/xmldom"),
        word: require.resolve("word-extractor"),
        fflate: require.resolve("fflate"),
      },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new HttpError(400, "File parsing timed out. Split the document."));
    }, 10000);
    const finish = () => {
      clearTimeout(timer);
      void worker.terminate();
    };
    worker.once("message", (result) => {
      finish();
      if (result.error) reject(new HttpError(400, result.error));
      else resolve(result);
    });
    worker.once("error", () => {
      finish();
      reject(
        new HttpError(
          400,
          "The file could not be read. Save it as XLSX/DOCX or paste a screenshot.",
        ),
      );
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish();
        reject(new HttpError(400, "File parsing stopped. Split the document."));
      }
    });
  });
}
export function readMaterial(
  repo: Repository,
  workspaceId: string,
  projectId: string,
  id: string,
) {
  const row = repo.db
    .prepare(
      "SELECT * FROM progress_materials WHERE workspace_id=? AND project_id=? AND id=?",
    )
    .get(workspaceId, projectId, id);
  if (!row) throw new HttpError(404, "Source file not found");
  return {
    metadata: JSON.parse(String(row.metadata)) as ProgressMaterial,
    bytes: Buffer.from(row.bytes as Uint8Array),
    images: JSON.parse(String(row.images)) as string[],
  };
}
export function registerProgressMaterials(
  app: FastifyInstance,
  repo: Repository,
  actor: (req: FastifyRequest) => Actor,
  mutate: Mutate,
) {
  const project = (req: FastifyRequest) => {
    const a = actor(req),
      id = (req.params as { id: string }).id;
    repo.get<Project>("projects", a.workspaceId, id);
    return { a, id };
  };
  app.post(
    "/api/projects/:id/materials",
    {
      bodyLimit: 12 * 1024 * 1024,
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
    },
    async (req) => {
      const { a, id } = project(req),
        input = materialInput.parse(req.body),
        bytes = Buffer.from(input.data, "base64");
      if (bytes.toString("base64") !== input.data)
        throw new HttpError(400, "Invalid file encoding");
      const result = await parseMaterial(input.name, bytes);
      const meta: ProgressMaterial = {
        id: randomUUID(),
        name: input.name,
        kind: result.kind,
        size: bytes.length,
        text: result.text,
        imageCount: result.images.length,
        warnings: result.warnings,
      };
      return mutate(req, () => {
        repo.get<Project>("projects", a.workspaceId, id);
        const total = Number(
          repo.db
            .prepare(
              "SELECT coalesce(sum(length(bytes)),0) AS total FROM progress_materials WHERE workspace_id=?",
            )
            .get(a.workspaceId)!.total,
        );
        if (total + bytes.length > 256 * 1024 * 1024)
          throw new HttpError(
            400,
            "Workspace source files exceed 256 MB. Ask the administrator to archive old files.",
          );
        repo.db
          .prepare(
            "INSERT INTO progress_materials(id,workspace_id,project_id,created_at,metadata,bytes,images) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            meta.id,
            a.workspaceId,
            id,
            new Date().toISOString(),
            JSON.stringify(meta),
            bytes,
            JSON.stringify(result.images),
          );
        return meta;
      });
    },
  );
  app.post("/api/projects/:id/materials/list", (req) => {
    const { a, id } = project(req);
    return z
      .object({ ids: z.array(z.string().uuid()).max(6) })
      .strict()
      .parse(req.body)
      .ids.map((key) => readMaterial(repo, a.workspaceId, id, key).metadata);
  });
  app.get("/api/projects/:id/materials/:materialId", (req, reply) => {
    const { a, id } = project(req),
      m = readMaterial(
        repo,
        a.workspaceId,
        id,
        z
          .string()
          .uuid()
          .parse((req.params as { materialId: string }).materialId),
      );
    reply.header("Cache-Control", "private, no-store");
    reply
      .type("application/octet-stream")
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(m.metadata.name)}`,
      );
    return reply.send(m.bytes);
  });
  app.get(
    "/api/projects/:id/materials/:materialId/images/:index",
    (req, reply) => {
      const { a, id } = project(req),
        p = req.params as { materialId: string; index: string },
        m = readMaterial(
          repo,
          a.workspaceId,
          id,
          z.string().uuid().parse(p.materialId),
        ),
        image = m.images[z.coerce.number().int().min(0).max(5).parse(p.index)];
      if (!image) throw new HttpError(404, "Image not found");
      const [header, data] = image.split(",");
      reply.header("Cache-Control", "private, no-store");
      return reply
        .type(header!.slice(5, -7))
        .send(Buffer.from(data!, "base64"));
    },
  );
}
