import {
  materialInput,
  projectFileData,
  type ProgressMaterial,
} from "./progress-material.js";

export const projectFileInput = materialInput.extend({
  data: projectFileData,
  name: materialInput.shape.name.refine(
    (name) =>
      !/[\\/]/.test(name) &&
      [...name].every(
        (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
      ),
    "文件名不能包含路径或控制字符。",
  ),
});
export interface ProjectFile extends ProgressMaterial {
  createdAt: string;
}
export function fileExtension(name: string) {
  return name.split(".").at(-1)?.toLowerCase() ?? "";
}
export function filePreviewKind(name: string) {
  const ext = fileExtension(name);
  if (ext === "docx") return "docx";
  if (ext === "xlsx" || ext === "xls") return "excel";
  if (ext === "pdf") return "pdf";
  if (ext === "pptx") return "pptx";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (["txt", "csv", "tsv", "md", "json", "log"].includes(ext)) return "text";
  return "download";
}
export function projectFileUrl(projectId: string, fileId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/materials/${encodeURIComponent(fileId)}`;
}
