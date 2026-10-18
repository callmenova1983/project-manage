<script setup lang="ts">
import { t } from "../locales";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  type Component,
} from "vue";
import { ElDialog } from "element-plus";
import "element-plus/es/components/dialog/style/css";
import { PhDownloadSimple } from "@phosphor-icons/vue";
import { api } from "../services/api";
import { loadOfficePdf } from "../services/office-pdf";
import {
  fileExtension,
  filePreviewKind,
  projectFileUrl,
  type ProjectFile,
} from "../../../../packages/domain/project-file";
const props = defineProps<{ file: ProjectFile; projectId: string }>();
const emit = defineEmits<{ close: [] }>();
const kind = computed(() => filePreviewKind(props.file.name));
const renderer = shallowRef<Component>(),
  data = shallowRef<ArrayBuffer>();
const text = ref(""),
  imageUrl = ref(""),
  loading = ref(true),
  rendering = ref(false),
  error = ref("");
const abort = new AbortController();
let renderTimer: ReturnType<typeof setTimeout> | undefined;
const staticFileUrl = `${window.location.origin}/office-assets/`;
const options = computed(() =>
  kind.value === "docx"
    ? { ignoreWidth: true, useBase64URL: true, renderAltChunks: false }
    : kind.value === "excel"
      ? {
          minColLength: 0,
          minRowLength: 0,
          showContextmenu: false,
          xls: fileExtension(props.file.name) === "xls",
        }
      : {
          isEvalSupported: false,
          enableXfa: false,
          standardFontDataUrl: `${staticFileUrl}standard_fonts/`,
        },
);
async function officeRenderer() {
  switch (kind.value) {
    case "docx": {
      const [module] = await Promise.all([
        import("@vue-office/docx"),
        import("@vue-office/docx/lib/index.css"),
      ]);
      return module.default;
    }
    case "excel": {
      const [module] = await Promise.all([
        import("@vue-office/excel"),
        import("@vue-office/excel/lib/index.css"),
      ]);
      return module.default;
    }
    case "pdf":
      await loadOfficePdf();
      return (await import("@vue-office/pdf")).default;
    case "pptx":
      return (await import("@vue-office/pptx")).default;
  }
}
function rendered() {
  rendering.value = false;
  clearTimeout(renderTimer);
}
function failed() {
  if (abort.signal.aborted) return;
  rendering.value = false;
  clearTimeout(renderTimer);
  error.value = t(
    "此文件暂时无法在线预览，可能已损坏、加密或包含不支持的内容。可以下载原文件查看。",
  );
}
onMounted(async () => {
  if (kind.value === "download") {
    loading.value = false;
    return;
  }
  try {
    const [bytes, component] = await Promise.all([
      api.projectFileContent(props.projectId, props.file.id, abort.signal),
      officeRenderer(),
    ]);
    if (abort.signal.aborted) return;
    if (kind.value === "text") text.value = new TextDecoder().decode(bytes);
    else if (kind.value === "image") {
      const ext = fileExtension(props.file.name);
      imageUrl.value = URL.createObjectURL(
        new Blob([bytes], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }),
      );
    } else {
      renderer.value = component as unknown as Component;
      data.value = bytes;
      rendering.value = true;
      renderTimer = setTimeout(failed, 30000);
    }
  } catch {
    failed();
  } finally {
    if (!abort.signal.aborted) loading.value = false;
  }
});
onBeforeUnmount(() => {
  clearTimeout(renderTimer);
  abort.abort();
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
});
</script>
<template>
  <ElDialog
    :model-value="true"
    :title="file.name"
    class="project-file-dialog"
    width="min(1200px, calc(100vw - 24px))"
    top="4vh"
    destroy-on-close
    @close="emit('close')"
  >
    <div class="preview-toolbar">
      <span>{{ t("文件预览") }}</span
      ><a
        :href="projectFileUrl(projectId, file.id)"
        :download="file.name"
        class="button secondary"
        ><PhDownloadSimple :size="15" />{{ t("下载原文件") }}</a
      >
    </div>
    <p v-if="loading || rendering" role="status" class="muted">
      {{ t("正在") }}{{ loading ? t("读取文件") : t("生成预览") }}…
    </p>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <div v-if="kind === 'download'" class="preview-empty">
      {{ t("此格式暂不支持在线预览，请下载原文件查看。") }}
    </div>
    <div
      v-else-if="!loading && !error"
      class="preview-content"
      :class="`preview-${kind}`"
    >
      <pre v-if="kind === 'text'">{{ text }}</pre>
      <img
        v-else-if="kind === 'image'"
        :src="imageUrl"
        :alt="file.name"
        @error="failed"
      />
      <component
        v-else-if="renderer && data"
        :is="renderer"
        :src="data"
        :options="options"
        :static-file-url="staticFileUrl"
        class="office-viewer"
        @rendered="rendered"
        @error="failed"
      />
    </div>
  </ElDialog>
</template>
<style scoped>
:global(.project-file-dialog .el-dialog__title) {
  overflow-wrap: anywhere;
}
.preview-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--muted);
  font-size: 12px;
}
.preview-content {
  height: 72dvh;
  min-height: 260px;
  overflow: auto;
  background: #f4f5f7;
  color: #1f2937;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.office-viewer {
  height: 100%;
  width: 100%;
}
pre {
  margin: 0;
  padding: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.7;
}
.preview-image {
  display: grid;
  place-items: center;
}
.preview-image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.preview-empty {
  padding: 64px 20px;
  text-align: center;
  color: var(--muted);
}
.preview-docx :deep(.docx-wrapper) {
  padding: 16px;
}
@media (max-width: 600px) {
  .preview-content {
    height: 68dvh;
  }
  .preview-docx :deep(.docx-wrapper) {
    padding: 6px;
  }
}
</style>
