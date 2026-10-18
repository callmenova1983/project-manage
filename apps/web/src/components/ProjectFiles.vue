<script setup lang="ts">
import { t } from "../locales";
import { onBeforeUnmount, ref, watch } from "vue";
import {
  PhPaperclip,
  PhUploadSimple,
  PhDownloadSimple,
  PhFile,
} from "@phosphor-icons/vue";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { formatDate } from "../locales";
import { PROJECT_FILE_LIMIT } from "../../../../packages/domain/progress-material";
import {
  filePreviewKind,
  projectFileUrl,
  type ProjectFile,
} from "../../../../packages/domain/project-file";
import ProjectFilePreview from "./ProjectFilePreview.vue";
import { referenceLabels } from "../../../../packages/domain/capture-reference";

const props = defineProps<{ projectId: string }>();
const store = useWorkspace();
const files = ref<ProjectFile[]>([]),
  loading = ref(false),
  uploading = ref(false);
const error = ref(""),
  notice = ref(""),
  uploadLabel = ref(""),
  dragging = ref(false);
const picker = ref<HTMLInputElement>(),
  preview = ref<ProjectFile>();
let generation = 0;
onBeforeUnmount(() => {
  generation++;
});
const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  files.value = [];
  preview.value = undefined;
  try {
    const result = await api.projectFiles(props.projectId);
    if (current === generation) files.value = result;
  } catch (e) {
    if (current === generation)
      error.value = e instanceof Error ? e.message : t("文件列表读取失败。");
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(() => props.projectId, load, { immediate: true });
async function upload(selected: File[]) {
  dragging.value = false;
  if (
    uploading.value ||
    loading.value ||
    store.mode === "local" ||
    !selected.length
  )
    return;
  const projectId = props.projectId,
    current = generation;
  uploading.value = true;
  error.value = notice.value = "";
  const failures: string[] = [];
  let count = 0;
  for (const [index, file] of selected.entries()) {
    if (current !== generation) break;
    uploadLabel.value = t("正在上传 {p0}/{p1} · {p2}", {
      p0: index + 1,
      p1: selected.length,
      p2: file.name,
    });
    try {
      if (!file.size || file.size > PROJECT_FILE_LIMIT)
        throw Error(t("文件为空或超过 50 MB"));
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]!);
        reader.onerror = () => reject(Error(t("文件读取失败")));
        reader.readAsDataURL(file);
      });
      const saved = await api.uploadProjectFile(projectId, file.name, data);
      if (current === generation) {
        files.value = [
          saved,
          ...files.value.filter((old) => old.id !== saved.id),
        ];
        count++;
      }
    } catch (e) {
      failures.push(
        t("{p0}：{p1}", {
          p0: file.name,
          p1: e instanceof Error ? e.message : t("上传失败"),
        }),
      );
    }
  }
  if (current === generation) {
    uploading.value = false;
    uploadLabel.value = "";
    error.value = failures.join("\n");
    notice.value = count ? t("已保存 {p0} 个文件", { p0: count }) : "";
  }
}
function choose(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = Array.from(input.files ?? []);
  input.value = "";
  void upload(selected);
}
</script>
<template>
  <section
    id="project-files"
    class="panel project-files"
    :class="{ dragging }"
    aria-labelledby="project-files-title"
    @dragover.prevent="dragging = store.mode !== 'local' && !uploading"
    @dragleave.self="dragging = false"
    @drop.prevent="upload(Array.from($event.dataTransfer?.files ?? []))"
  >
    <div class="files-heading">
      <h2 id="project-files-title">
        <PhPaperclip :size="19" />{{ t("项目文件") }}
        <span>{{ files.length }}</span>
      </h2>
      <button
        :disabled="uploading || loading || store.mode === 'local'"
        @click="picker?.click()"
      >
        <PhUploadSimple :size="16" />{{
          uploading ? t("上传中…") : t("上传文件")
        }}
      </button>
      <input
        ref="picker"
        type="file"
        multiple
        hidden
        :aria-label="t('选择项目文件')"
        @change="choose"
      />
    </div>
    <p class="files-hint">
      {{
        t(
          "合同、方案、图纸和交付资料统一保存在这里，也会显示已有进展附件。单文件最大 50 MB。",
        )
      }}
    </p>
    <p v-if="store.mode === 'local'" class="muted">
      {{ t("本地演示不上传文件，请在团队工作区使用。") }}
    </p>
    <p v-if="loading" role="status" class="muted">{{ t("正在读取文件…") }}</p>
    <p v-if="uploading" role="status" class="muted">{{ uploadLabel }}</p>
    <p v-if="notice" role="status" class="file-notice">{{ t(notice) }}</p>
    <p v-if="error" class="error-box" role="alert">
      {{ t(error) }}
      <button v-if="!uploading" class="text-button" @click="load">
        {{ t("刷新列表") }}
      </button>
    </p>
    <ul v-if="files.length" class="file-list">
      <li v-for="file in files" :key="file.id">
        <PhFile :size="23" class="file-icon" />
        <div class="file-description">
          <button
            class="file-name text-button"
            :title="file.name"
            @click="preview = file"
          >
            {{ file.name }}
          </button>
          <small
            ><span v-if="file.category"
              >{{ t(referenceLabels[file.category]) }} · </span
            ><span v-if="file.taskId">{{ t("已关联任务 ·") }} </span
            >{{ size(file.size) }} ·
            {{
              file.uploadedBy ||
              (file.kind === "file" ? t("项目文件") : t("进展附件"))
            }}
            ·
            {{
              formatDate(file.createdAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })
            }}</small
          >
        </div>
        <button
          class="text-button"
          :aria-label="t('查看 {p0}', { p0: file.name })"
          @click="preview = file"
        >
          {{
            filePreviewKind(file.name) === "download" ? t("查看") : t("预览")
          }}
        </button>
        <a
          class="file-download"
          :href="projectFileUrl(projectId, file.id)"
          :aria-label="t('下载 {p0}', { p0: file.name })"
          :download="file.name"
          ><PhDownloadSimple :size="17"
        /></a>
      </li>
    </ul>
    <button
      v-else-if="!loading && !error && store.mode !== 'local'"
      class="file-drop"
      :disabled="uploading"
      @click="picker?.click()"
    >
      <PhUploadSimple :size="25" /><strong>{{
        t("拖拽文件到这里，或点击上传")
      }}</strong
      ><span>{{
        t("DOCX、Excel、PDF、PPTX、图片和文本可在线预览，其他格式可下载。")
      }}</span>
    </button>
    <ProjectFilePreview
      v-if="preview"
      :key="preview.id"
      :file="preview"
      :project-id="projectId"
      @close="preview = undefined"
    />
  </section>
</template>
<style scoped>
.project-files {
  scroll-margin-top: 80px;
}
.project-files.dragging {
  outline: 2px solid var(--accent);
  background: var(--accent-bg);
}
.files-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}
h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 17px;
}
h2 span {
  font-size: 12px;
  color: var(--muted);
  font-weight: 400;
}
.files-hint {
  margin: 12px 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}
.file-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.file-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.file-list li:last-child {
  border-bottom: 0;
}
.file-icon {
  flex: none;
  color: var(--accent);
}
.file-description {
  flex: 1;
  min-width: 0;
}
.file-name {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-weight: 550;
  text-align: left;
}
small {
  display: block;
  color: var(--muted);
  font-size: 11px;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.file-download {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--muted);
  border-radius: 6px;
}
.file-download:hover {
  color: var(--accent);
  background: var(--accent-bg);
}
.file-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 12px;
  width: 100%;
  border: 1px dashed var(--border);
  background: var(--surface-subtle);
  color: var(--muted);
  text-align: center;
}
.file-drop strong {
  color: var(--text);
  font-size: 13px;
}
.file-drop span {
  font-size: 11px;
  line-height: 1.6;
}
.file-notice {
  color: var(--accent);
  font-size: 12px;
}
.error-box {
  white-space: pre-wrap;
}
@media (max-width: 600px) {
  .file-list li {
    gap: 8px;
  }
  .file-icon {
    display: none;
  }
}
</style>
