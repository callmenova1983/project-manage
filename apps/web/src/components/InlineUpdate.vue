<script setup lang="ts">
import { computed, nextTick, ref, onBeforeUnmount } from "vue";
import { PhCheck, PhX, PhPlus } from "@phosphor-icons/vue";
import { type Project } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved } from "../composables/unsaved";
import { api, ApiError } from "../services/api";
import { clipboardContent, fileBase64 } from "../services/progress-clipboard";
import type {
  ProgressMaterial,
  ProgressAnalysis,
} from "../../../../packages/domain/progress-material";
import {
  assembleCaptureText,
  type CaptureRecognitionDepth,
} from "../../../../packages/domain/capture";
import CaptureDepthSelect from "./CaptureDepthSelect.vue";
import { captureErrorMessage } from "../services/capture-error";
import { t } from "../locales";
const props = defineProps<{ project: Project; compact?: boolean }>();
const store = useWorkspace();
const mode = ref<"new" | "correct">("new");
const editing = ref(false),
  draft = ref(""),
  original = ref(props.project);
const field = ref<HTMLTextAreaElement>();
const error = ref("");
const originalMaterialIds = ref<string[]>([]);
const recognitionDepth = ref<CaptureRecognitionDepth>("text");
const actualRecognitionDepth = ref<CaptureRecognitionDepth>();
const recognitionCache = new Map<string, ProgressAnalysis>();
const materials = ref<ProgressMaterial[]>([]),
  rawText = ref(""),
  recognizedText = ref(""),
  model = ref(""),
  uncertainties = ref<string[]>([]);
const sourceReady = ref(true);
const imageCount = computed(() =>
  materials.value.reduce((count, item) => count + item.imageCount, 0),
);
function updateSourceNotes() {
  if (model.value) return;
  let notes = draft.value;
  for (const material of materials.value) {
    if (!material.text.trim()) continue;
    notes = notes.replace(assembleCaptureText("", [material]), "");
  }
  rawText.value = notes.trim();
}
const processing = ref(false),
  capabilities = ref<{ enabled: boolean; model: string | null } | null>(null),
  upload = ref<HTMLInputElement>();
let generation = 0;
onBeforeUnmount(() => generation++);
const materialUrl = (id: string) =>
  `/api/projects/${props.project.id}/materials/${id}`;
function applyRecognition(
  result: ProgressAnalysis,
  depth: CaptureRecognitionDepth,
) {
  draft.value = result.summary;
  model.value = result.model;
  actualRecognitionDepth.value = depth;
  recognizedText.value = result.recognizedText;
  uncertainties.value = [...result.uncertainties];
}
async function recognize() {
  if (processing.value || (!draft.value.trim() && !materials.value.length))
    return false;
  updateSourceNotes();
  if (
    recognitionDepth.value === "text" &&
    !assembleCaptureText(rawText.value, materials.value).trim()
  ) {
    error.value = t(
      "附件暂未提取到文字，请切换为“识别图中文字”后点击识别，或直接填写进展。",
    );
    return false;
  }
  const requestedDepth = recognitionDepth.value;
  const request = {
    text: rawText.value,
    materialIds: materials.value.map((m) => m.id),
    version: original.value.version,
    recognitionDepth: requestedDepth,
    externalProcessingConfirmed: true as const,
  };
  const key = JSON.stringify(request);
  const cached = recognitionCache.get(key);
  if (cached) {
    error.value = "";
    applyRecognition(cached, requestedDepth);
    return true;
  }
  if (!capabilities.value?.enabled) {
    error.value = t(
      "AI is not enabled. Configure the model in workspace settings.",
    );
    return false;
  }
  const current = generation;
  processing.value = true;
  error.value = "";
  try {
    const result = await api.analyzeProgress(props.project.id, request);
    if (current !== generation) return false;
    if (recognitionCache.size >= 12)
      recognitionCache.delete(recognitionCache.keys().next().value!);
    recognitionCache.set(key, result);
    applyRecognition(result, requestedDepth);
    return true;
  } catch (e) {
    if (current === generation) error.value = t(captureErrorMessage(e));
    return false;
  } finally {
    if (current === generation) processing.value = false;
  }
}
async function addFiles(files: File[]) {
  if (processing.value) return;
  if (materials.value.length + files.length > 6) {
    error.value = t("Use up to 6 files per progress entry.");
    return;
  }
  if (files.some((f) => f.size > 8 * 1024 * 1024)) {
    error.value = t("Each file must be no larger than 8 MB.");
    return;
  }
  const current = generation;
  updateSourceNotes();
  processing.value = true;
  error.value = "";
  try {
    for (const file of files) {
      const result = await api.progressMaterial(
        props.project.id,
        file.name,
        await fileBase64(file),
      );
      if (current !== generation) return;
      materials.value.push(result);
      draft.value = assembleCaptureText(draft.value, [result]);
      model.value = "";
      actualRecognitionDepth.value = undefined;
      recognizedText.value = "";
      uncertainties.value = [];
    }
  } catch (e) {
    if (current === generation)
      error.value = t(
        e instanceof Error ? e.message : "Changes could not be saved",
      );
  } finally {
    if (current === generation) processing.value = false;
    if (upload.value) upload.value.value = "";
  }
}
async function paste(event: ClipboardEvent) {
  if (!event.clipboardData || processing.value) return;
  const content = clipboardContent(event.clipboardData);
  if (!content.files.length && !content.text && !content.remoteImages) return;
  event.preventDefault();
  const input = field.value;
  const start = input?.selectionStart ?? draft.value.length,
    end = input?.selectionEnd ?? start;
  draft.value =
    draft.value.slice(0, start) + content.text + draft.value.slice(end);
  model.value = "";
  actualRecognitionDepth.value = undefined;
  updateSourceNotes();
  if (content.remoteImages)
    error.value = t(
      "Linked pictures cannot be copied automatically. Paste a screenshot or attach the original file.",
    );
  if (content.files.length) await addFiles(content.files);
}
function removeFile(id: string) {
  const material = materials.value.find((item) => item.id === id);
  if (!model.value && material?.text.trim())
    draft.value = draft.value
      .replace(assembleCaptureText("", [material]), "")
      .trim();
  materials.value = materials.value.filter((m) => m.id !== id);
  model.value = "";
  actualRecognitionDepth.value = undefined;
  recognizedText.value = "";
  uncertainties.value = [];
  updateSourceNotes();
}

const dirty = computed(
  () =>
    editing.value &&
    (mode.value === "new"
      ? !!draft.value.trim() || materials.value.length > 0
      : draft.value !== original.value.latestUpdate ||
        materials.value.map((m) => m.id).join(",") !==
          originalMaterialIds.value.join(",")),
);
useUnsaved(dirty);
async function edit(value: "new" | "correct" = "new") {
  if (store.busy || processing.value) return;
  generation++;
  sourceReady.value = value !== "correct";
  materials.value = [];
  originalMaterialIds.value = [];
  model.value = "";
  rawText.value = "";
  actualRecognitionDepth.value = undefined;
  recognitionCache.clear();
  recognitionDepth.value = "text";
  recognizedText.value = "";
  uncertainties.value = [];
  original.value = props.project;
  mode.value = value;
  draft.value = value === "new" ? "" : props.project.latestUpdate;
  error.value = "";
  editing.value = true;
  const current = generation;
  api
    .aiCapabilities()
    .then((value) => {
      if (current === generation) capabilities.value = value;
    })
    .catch(() => {});
  if (value === "correct") {
    processing.value = true;
    try {
      const entries = await api.progressHistory(props.project.id);
      const source = entries[0]?.originalSource;
      if (source && current === generation) {
        rawText.value = source.text;
        recognitionDepth.value = source.recognitionDepth ?? "text";
        actualRecognitionDepth.value = source.recognitionDepth;
        model.value = source.model ?? "";
        recognizedText.value = source.recognizedText ?? "";
        uncertainties.value = source.uncertainties ?? [];
        const files = await api.progressMaterials(
          props.project.id,
          source.materialIds,
        );
        if (current === generation) {
          materials.value = files;
          originalMaterialIds.value = source.materialIds;
        }
      }
      sourceReady.value = true;
    } catch (e) {
      error.value = t(
        e instanceof Error ? e.message : "Changes could not be saved",
      );
    } finally {
      if (current === generation) processing.value = false;
    }
  }
  await nextTick();
  field.value?.focus();
  field.value?.setSelectionRange(draft.value.length, draft.value.length);
}
function cancel() {
  if (!store.busy && !processing.value) {
    generation++;
    editing.value = false;
    error.value = "";
  }
}
async function save() {
  if (store.busy || processing.value || !sourceReady.value) return;
  updateSourceNotes();
  if (!dirty.value) {
    cancel();
    return;
  }
  if (!draft.value.trim()) {
    error.value =
      imageCount.value && recognitionDepth.value === "text"
        ? t(
            "附件暂未提取到文字，请切换为“识别图中文字”后点击识别，或直接填写进展。",
          )
        : t("Recognize the source or enter a progress summary before saving.");
    return;
  }
  if (draft.value.length > 4000) {
    error.value = t(
      "进展内容最多 4000 字。请精简内容，或点击“AI 识别并整理”生成摘要；原始附件会保留。",
    );
    return;
  }
  error.value = "";
  try {
    await store.operation(
      () =>
        api.addProgress(props.project.id, {
          text: draft.value,
          version: original.value.version,
          mode: mode.value,
          originalSource: {
            text: materials.value.length
              ? rawText.value
              : rawText.value || draft.value,
            materialIds: materials.value.map((m) => m.id),
            ...(model.value
              ? actualRecognitionDepth.value
                ? { recognitionDepth: actualRecognitionDepth.value }
                : {}
              : { recognitionDepth: "text" as const }),
            ...(model.value
              ? {
                  model: model.value,
                  recognizedText: recognizedText.value,
                  uncertainties: uncertainties.value,
                }
              : {}),
          },
        }),
      t(mode.value === "new" ? "Progress log added" : "Progress log corrected"),
    );
    editing.value = false;
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 409
        ? t(
            "This project changed while you were editing. Your text is kept; copy it and reopen the latest update.",
          )
        : t(e instanceof Error ? e.message : "Changes could not be saved");
  }
}
defineExpose({ edit });
</script>
<template>
  <div class="inline-update" :class="{ compact, editing }">
    <button
      v-if="!editing"
      class="update-read"
      :aria-label="t('Add progress for {name}', { name: project.name })"
      :title="project.latestUpdate || t('Click to report progress')"
      @click="edit()"
    >
      <span>{{ project.latestUpdate || t("Click to report progress") }}</span
      ><PhPlus :size="13" aria-hidden="true" />
    </button>
    <form
      v-else
      class="update-editor"
      :aria-label="t('Latest update editor')"
      @submit.prevent="save"
      @dragover.prevent
      @drop.prevent="addFiles(Array.from($event.dataTransfer?.files ?? []))"
      @keydown.esc.stop.prevent="cancel"
    >
      <div class="progress-entry-heading">
        <strong>{{
          t(mode === "new" ? "New progress entry" : "Correct last entry")
        }}</strong
        ><button
          v-if="mode === 'new' && project.latestUpdate"
          type="button"
          class="text-button"
          @click="edit('correct')"
        >
          {{ t("Correct last entry") }}</button
        ><button
          v-else-if="mode === 'correct'"
          type="button"
          class="text-button"
          @click="edit()"
        >
          {{ t("New progress entry") }}
        </button>
      </div>
      <textarea
        ref="field"
        v-model="draft"
        rows="3"
        maxlength="12000"
        :aria-label="t('Latest reported update')"
        :placeholder="
          t(
            'Paste text, pictures or attach Excel / Word / PDF. Files are read as text by default; AI recognition is optional.',
          )
        "
        :disabled="store.busy || processing"
        @paste="paste"
        @input="updateSourceNotes"
        @keydown.enter="
          if ($event.ctrlKey || $event.metaKey) {
            $event.preventDefault();
            save();
          }
        "
      />
      <div v-if="materials.length" class="progress-materials">
        <div v-for="item in materials" :key="item.id" class="progress-material">
          <img
            v-if="item.imageCount"
            :src="`${materialUrl(item.id)}/images/0`"
            :alt="item.name"
          />
          <a :href="materialUrl(item.id)" :title="item.name">{{ item.name }}</a>
          <button
            type="button"
            :aria-label="t('Remove {name}', { name: item.name })"
            :disabled="processing || store.busy"
            @click="removeFile(item.id)"
          >
            <PhX :size="12" />
          </button>
          <small v-for="warning in item.warnings" :key="warning">{{
            t(warning)
          }}</small>
        </div>
      </div>
      <div class="source-tools">
        <CaptureDepthSelect
          v-model="recognitionDepth"
          :disabled="processing || store.busy"
        />
        <input
          ref="upload"
          type="file"
          hidden
          multiple
          accept=".png,.jpg,.jpeg,.webp,.xlsx,.xls,.docx,.doc,.pdf,.txt,.csv,.tsv"
          @change="
            addFiles(
              Array.from(($event.target as HTMLInputElement).files ?? []),
            )
          "
        />
        <button
          type="button"
          :disabled="processing || store.busy"
          @click="upload?.click()"
        >
          {{ t("添加附件") }}
        </button>
        <button
          type="button"
          :disabled="
            processing || store.busy || (!draft.trim() && !materials.length)
          "
          @click="recognize"
        >
          {{
            t(
              processing
                ? "Reading and organizing…"
                : "AI recognize and organize",
            )
          }}
        </button>
      </div>
      <small v-if="model" class="ai-result-note">{{
        t("AI result is editable. Original sources are retained with the log.")
      }}</small>
      <small v-else class="ai-result-note">{{
        recognitionDepth === "text"
          ? t(
              "默认只读取文件文字，图片原件保留。点击 AI 识别并整理才会调用模型。",
            )
          : t("点击 AI 识别并整理后，才会将文字及图片发送给已配置的模型。")
      }}</small>
      <small
        v-if="imageCount && recognitionDepth === 'text'"
        class="ai-result-note"
        >{{ imageCount }}
        {{ t("张图片暂不识别；需要读取图片时可切换识别深度。") }}</small
      >
      <p v-if="capabilities && !capabilities.enabled" class="ai-result-note">
        {{ t("AI is not enabled. Configure the model in workspace settings.") }}
      </p>
      <ul v-if="uncertainties.length" class="ai-uncertainties">
        <li v-for="item in uncertainties" :key="item">{{ item }}</li>
      </ul>
      <details
        v-if="model && (rawText || recognizedText)"
        class="recognized-source"
      >
        <summary>{{ t("Original text and image transcription") }}</summary>
        <p>{{ rawText }}</p>
        <p>{{ recognizedText }}</p>
      </details>
      <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
      <div class="update-actions">
        <small>{{ t("Ctrl / ⌘ + Enter to save") }}</small
        ><button
          type="button"
          :disabled="store.busy || processing"
          @click="cancel"
        >
          <PhX :size="13" />{{ t("Cancel") }}</button
        ><button
          class="primary"
          type="submit"
          :disabled="store.busy || processing || !sourceReady || !dirty"
        >
          <PhCheck :size="13" />{{ t(store.busy ? "Saving…" : "Save") }}
        </button>
      </div>
    </form>
    <RouterLink
      v-if="!editing"
      class="progress-history-link"
      :to="`/projects/${project.id}#progress-history`"
      >{{ t("Progress history") }}</RouterLink
    >
  </div>
</template>
<style scoped>
.inline-update {
  min-width: 0;
  width: 100%;
}
.update-read {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  color: var(--text);
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.8;
}
.update-read:hover {
  color: var(--accent);
}
.update-read > span {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.update-read svg {
  opacity: 0;
  margin-top: 5px;
  flex: none;
  color: var(--accent);
}
.update-read:hover svg,
.update-read:focus-visible svg {
  opacity: 1;
}
.compact .update-read {
  font-size: 13px;
  min-height: 22px;
  line-height: 1.6;
}
.compact .update-read > span {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
.update-editor textarea {
  width: 100%;
  min-height: 90px;
  padding: 10px;
  resize: vertical;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.update-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding-top: 6px;
}
.update-actions small {
  margin-right: auto;
  color: var(--muted);
  font-size: 10px;
}
.update-actions button {
  min-height: 28px;
  padding: 4px 8px;
  font-size: 11px;
}
@media (max-width: 600px) {
  .update-actions {
    flex-wrap: wrap;
  }
  .update-actions small {
    width: 100%;
  }
}
.progress-entry-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--muted);
}
.progress-entry-heading button {
  padding: 2px 0;
  font-size: 10px;
}
.progress-history-link {
  display: block;
  font-size: 10px;
  color: var(--muted);
  line-height: 16px;
}
.compact .progress-history-link {
  display: none;
}
.compact:hover .progress-history-link,
.compact:focus-within .progress-history-link {
  display: block;
}
</style>

<style scoped>
.progress-materials {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 7px;
}
.progress-material {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 5px;
  max-width: 100%;
  flex-wrap: wrap;
}
.progress-material img {
  width: 44px;
  height: 34px;
  object-fit: contain;
  border-radius: 3px;
}
.progress-material a {
  font-size: 11px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.progress-material button {
  padding: 2px;
  border: 0;
  background: transparent;
}
.progress-material small {
  width: 100%;
  font-size: 10px;
  color: var(--warning);
}
.source-tools {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.source-tools button {
  font-size: 10px;
  padding: 4px 6px;
  min-height: 26px;
}
.ai-result-note {
  display: block;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.6;
  margin: 5px 0;
}
.ai-uncertainties {
  font-size: 11px;
  color: var(--warning);
  padding-left: 16px;
}
.recognized-source {
  font-size: 11px;
  margin-top: 6px;
}
.recognized-source p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 180px;
  overflow: auto;
}
</style>
