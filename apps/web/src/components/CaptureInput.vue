<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { PhPaperclip, PhX, PhFileText, PhImage } from "@phosphor-icons/vue";
import { api } from "../services/api";
import { clipboardContent, fileBase64 } from "../services/progress-clipboard";
import type { ProgressMaterial } from "../../../../packages/domain/progress-material";
import type {
  CaptureSource,
  CaptureRecognitionDepth,
} from "../../../../packages/domain/capture";
import { assembleCaptureText } from "../../../../packages/domain/capture";
import { inferAttachmentPurpose } from "../../../../packages/domain/capture-reference";
import SpeechInput from "./SpeechInput.vue";
import CaptureDepthSelect from "./CaptureDepthSelect.vue";
import { t } from "../locales";
const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    placeholder?: string;
    rows?: number;
    maxlength?: number;
    disabled?: boolean;
    compact?: boolean;
    referenceMode?: boolean;
    active?: boolean;
  }>(),
  { rows: 5, maxlength: 20000, placeholder: "", active: true },
);
const emit = defineEmits<{
  "update:modelValue": [string];
  submit: [];
  change: [];
  "attachments-change": [];
}>();
const field = ref<HTMLTextAreaElement>(),
  upload = ref<HTMLInputElement>();
const materials = ref<ProgressMaterial[]>([]),
  attachmentPurpose = ref<"reference" | "extract">("reference"),
  retainOriginal = ref(false),
  recognitionDepth = ref<CaptureRecognitionDepth>("text"),
  busy = ref(false),
  error = ref(""),
  warnings = ref<string[]>([]);
const voiceBusy = ref(false);
const hasFiles = computed(() => materials.value.length > 0);
const previews = ref<Record<string, string>>({});
const purposeChosen = ref(false),
  depthChosen = ref(false),
  pastedImages = ref<string[]>([]);
const uncertainPurpose = ref(false);
const purposeFor = (file: ProgressMaterial) =>
  purposeChosen.value
    ? attachmentPurpose.value
    : inferAttachmentPurpose(
        file.name,
        props.modelValue,
        pastedImages.value.includes(file.id),
      );
const referenceMaterials = computed(() =>
  props.referenceMode
    ? materials.value.filter((file) => purposeFor(file) === "reference")
    : [],
);
const mixedFiles = computed(
  () =>
    referenceMaterials.value.length > 0 &&
    referenceMaterials.value.length < materials.value.length,
);
watch(
  () => [
    props.modelValue,
    materials.value.map((file) => file.name).join(" "),
    pastedImages.value.join(","),
    purposeChosen.value,
  ],
  () => {
    if (!props.referenceMode || !hasFiles.value) {
      uncertainPurpose.value = false;
      return;
    }
    const intents = materials.value.map(purposeFor);
    uncertainPurpose.value = intents.includes("unknown");
    if (!depthChosen.value && !purposeChosen.value)
      recognitionDepth.value = materials.value.some(
        (file) =>
          purposeFor(file) === "extract" &&
          /\.(png|jpe?g|webp|pdf)$/i.test(file.name),
      )
        ? "ocr"
        : "text";
  },
);
const referenceFiles = computed(
  () =>
    !!props.referenceMode &&
    hasFiles.value &&
    !uncertainPurpose.value &&
    referenceMaterials.value.length === materials.value.length,
);
let temporaryIds: string[] = [];
const imageCount = computed(() =>
  materials.value.reduce((count, item) => count + item.imageCount, 0),
);
const preparationVersion = ref(0);
let generation = 0;
let prepared:
  { key: string; text: string; uncertainties: string[] } | undefined;
onBeforeUnmount(() => {
  generation++;
  Object.values(previews.value).forEach((url) => URL.revokeObjectURL(url));
});
const materialUrl = (id: string) => `/api/capture/materials/${id}`;
async function addFiles(files: File[]) {
  if (props.disabled || busy.value || !files.length) return;
  if (materials.value.length + files.length > 6) {
    error.value = t("Use up to 6 files per progress entry.");
    return;
  }
  if (files.some((f) => f.size > 8 * 1024 * 1024)) {
    error.value = t("Each file must be no larger than 8 MB.");
    return;
  }
  if (
    files.some(
      (f) => !/\.(png|jpe?g|webp|xlsx?|docx?|pdf|txt|csv|tsv)$/i.test(f.name),
    )
  ) {
    error.value = t(
      "支持截图、Excel、Word、PDF 或文本文件，请粘贴原图或原文件。",
    );
    return;
  }
  const current = generation;
  busy.value = true;
  error.value = "";
  try {
    for (const file of files) {
      const result = await api.captureMaterial(
        file.name,
        await fileBase64(file),
        props.referenceMode,
      );
      if (current !== generation) return;
      materials.value.push(result);
      if (/\.(png|jpe?g|webp)$/i.test(file.name))
        previews.value[result.id] = URL.createObjectURL(file);
      prepared = undefined;
      emit("change");
      emit("attachments-change");
    }
  } catch (e) {
    if (current === generation)
      error.value = t(
        e instanceof Error ? e.message : "The file could not be read",
      );
  } finally {
    if (current === generation) busy.value = false;
    if (upload.value) upload.value.value = "";
  }
}
async function insert(text: string) {
  const start = field.value?.selectionStart ?? props.modelValue.length,
    end = field.value?.selectionEnd ?? start;
  const result =
    props.modelValue.slice(0, start) + text + props.modelValue.slice(end);
  if (result.length > props.maxlength) {
    error.value = t("内容超过 {p0} 字，请分批粘贴。", { p0: props.maxlength });
    return false;
  }
  emit("update:modelValue", result);
  await nextTick();
  field.value?.setSelectionRange(start + text.length, start + text.length);
  return true;
}
async function paste(event: ClipboardEvent) {
  if (!event.clipboardData || props.disabled || busy.value) return;
  const content = clipboardContent(event.clipboardData);
  // Preserve the browser's undo/caret behavior for ordinary text and Excel TSV.
  if (
    !content.files.length &&
    !content.remoteImages &&
    event.clipboardData.getData("text/plain")
  )
    return;
  if (!content.files.length && !content.text && !content.remoteImages) return;
  event.preventDefault();
  error.value = "";
  if (content.text && !(await insert(content.text))) return;
  if (content.remoteImages)
    error.value = t(
      "Linked pictures cannot be copied automatically. Paste a screenshot or attach the original file.",
    );
  if (content.files.length) {
    const before = new Set(materials.value.map((file) => file.id));
    await addFiles(content.files);
    if (props.referenceMode)
      pastedImages.value.push(
        ...materials.value
          .filter(
            (file) =>
              !before.has(file.id) && /\.(png|jpe?g|webp)$/i.test(file.name),
          )
          .map((file) => file.id),
      );
  }
}
async function drop(event: DragEvent) {
  if (props.disabled || busy.value) return;
  if (event.dataTransfer?.files.length)
    await addFiles(Array.from(event.dataTransfer.files));
  else if (event.dataTransfer) {
    const content = clipboardContent(event.dataTransfer);
    if (content.text) await insert(content.text);
  }
}
async function resolveSource(): Promise<{
  text: string;
  originalSource: CaptureSource;
}> {
  if (busy.value) throw new Error(t("正在读取粘贴内容，请稍等。"));
  // Preparation failures belong to the submitting form, which can also offer
  // recovery actions. Showing them here as well produces duplicate alerts.
  error.value = "";
  if (uncertainPurpose.value)
    throw new Error(t("暂时无法判断附件用途，请选择归档资料或识别成事项。"));
  if (referenceFiles.value)
    throw new Error(t("资料附件请直接归档，不需要提取正文事项。"));
  const pendingExtraction = materials.value.filter(
    (item) => item.referenceOnly,
  );
  if (pendingExtraction.length) {
    busy.value = true;
    try {
      for (const item of pendingExtraction) {
        const extracted = await api.extractCaptureMaterial(item.id);
        materials.value = materials.value.map((file) =>
          file.id === item.id ? extracted : file,
        );
      }
    } finally {
      busy.value = false;
    }
  }
  const originalSource = {
    text: props.modelValue,
    materialIds: materials.value.map((m) => m.id),
    recognitionDepth: recognitionDepth.value,
  };
  const key = JSON.stringify(originalSource);
  let text = assembleCaptureText(props.modelValue, materials.value);
  if (recognitionDepth.value !== "text" && imageCount.value > 0) {
    if (prepared?.key === key)
      return prepareResult(prepared.text, originalSource);
    busy.value = true;
    error.value = "";
    const current = generation;
    try {
      const result = await api.analyzeCapture(originalSource);
      if (current !== generation)
        throw new Error(t("输入内容已切换，请重试。"));
      text = result.text;
      warnings.value = result.uncertainties;
      prepared = {
        key,
        text: result.text,
        uncertainties: result.uncertainties,
      };
    } finally {
      if (current === generation) busy.value = false;
    }
  }
  if (text.length > props.maxlength)
    throw new Error(
      t("读取后超过 {p0} 字，请分批录入。", { p0: props.maxlength }),
    );
  if (!text.trim()) {
    if (imageCount.value > 0 && recognitionDepth.value === "text")
      throw new Error(
        t(
          "当前是“仅文字”，图片或扫描页中没有可直接提取的文字。请将识别深度切换为“识别图中文字”或“理解图表”，再整理。",
        ),
      );
    throw new Error(
      hasFiles.value
        ? t("文件中没有可提取的文字，请补充文字或更换文件。")
        : t("请先粘贴内容。"),
    );
  }
  return prepareResult(text, originalSource);
}
function prepareResult(text: string, source: CaptureSource) {
  preparationVersion.value++;
  temporaryIds =
    props.referenceMode && !retainOriginal.value ? [...source.materialIds] : [];
  return {
    text,
    originalSource: temporaryIds.length
      ? { ...source, materialIds: [] }
      : source,
  };
}
function exportState() {
  return {
    materials: materials.value,
    preparationVersion: preparationVersion.value,
    prepared,
    attachmentPurpose: attachmentPurpose.value,
    recognitionDepth: recognitionDepth.value,
    retainOriginal: retainOriginal.value,
    purposeChosen: purposeChosen.value,
    depthChosen: depthChosen.value,
    pastedImages: pastedImages.value,
    uncertainPurpose: uncertainPurpose.value,
  };
}
function restoreState(value: unknown) {
  if (!value || typeof value !== "object") return;
  const state = value as ReturnType<typeof exportState>;
  if (
    !Array.isArray(state.materials) ||
    state.materials.length > 6 ||
    state.materials.some(
      (m) =>
        !m ||
        typeof m.id !== "string" ||
        typeof m.name !== "string" ||
        typeof m.text !== "string" ||
        !Array.isArray(m.warnings),
    )
  )
    return;
  materials.value = state.materials;
  if (
    state.prepared &&
    typeof state.prepared.text === "string" &&
    typeof state.prepared.key === "string" &&
    Array.isArray(state.prepared.uncertainties)
  )
    prepared = state.prepared;
  attachmentPurpose.value =
    state.attachmentPurpose === "extract" ? "extract" : "reference";
  recognitionDepth.value = ["text", "ocr", "deep"].includes(
    state.recognitionDepth,
  )
    ? state.recognitionDepth
    : "text";
  retainOriginal.value = state.retainOriginal === true;
  purposeChosen.value = state.purposeChosen === true;
  depthChosen.value = state.depthChosen === true;
  pastedImages.value = Array.isArray(state.pastedImages)
    ? state.pastedImages.filter((id) => typeof id === "string")
    : [];
  uncertainPurpose.value = state.uncertainPurpose === true;
}
function changePurpose(event: Event) {
  purposeChosen.value = true;
  uncertainPurpose.value = false;
  attachmentPurpose.value = (event.target as HTMLSelectElement).value as
    "reference" | "extract";
  prepared = undefined;
  warnings.value = [];
  if (attachmentPurpose.value === "extract")
    recognitionDepth.value = materials.value.some((file) =>
      /\.(png|jpe?g|webp)$/i.test(file.name),
    )
      ? "ocr"
      : "text";
  emit("change");
}
function clearFiles() {
  generation++;
  materials.value = [];
  error.value = "";
  warnings.value = [];
  busy.value = false;
  prepared = undefined;
  recognitionDepth.value = "text";
  attachmentPurpose.value = "reference";
  retainOriginal.value = false;
  temporaryIds = [];
  purposeChosen.value = false;
  depthChosen.value = false;
  pastedImages.value = [];
  uncertainPurpose.value = false;
  Object.values(previews.value).forEach((url) => URL.revokeObjectURL(url));
  previews.value = {};
}
function changeDepth(value: CaptureRecognitionDepth) {
  depthChosen.value = true;
  recognitionDepth.value = value;
  prepared = undefined;
  warnings.value = [];
  error.value = "";
  emit("change");
}
function remove(id: string) {
  if (previews.value[id]) {
    URL.revokeObjectURL(previews.value[id]);
    delete previews.value[id];
  }
  materials.value = materials.value.filter((m) => m.id !== id);
  prepared = undefined;
  warnings.value = [];
  emit("change");
  emit("attachments-change");
}
function input(event: Event) {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
  error.value = "";
  warnings.value = [];
  emit("change");
}
defineExpose({
  exportState,
  restoreState,
  resolveSource,
  clearFiles,
  hasFiles,
  busy: computed(() => busy.value || voiceBusy.value),
  materials,
  referenceFiles,
  referenceMaterials,
  mixedFiles,
  uncertainPurpose,
  removeArchived: (ids: string[]) => {
    ids.forEach(remove);
  },
  temporaryMaterialIds: () => [...temporaryIds],
  focus: () => field.value?.focus(),
});
</script>
<template>
  <div
    class="capture-input"
    :class="{ compact, 'is-busy': busy }"
    @dragover.prevent
    @drop.prevent="drop"
  >
    <label class="capture-label"
      >{{ label
      }}<textarea
        ref="field"
        :value="modelValue"
        :rows="rows"
        :maxlength="maxlength"
        :aria-label="label"
        :disabled="disabled || busy || voiceBusy"
        :placeholder="
          placeholder ||
          t('直接粘贴文字、截图、Excel、Word 或 PDF 文件，也可以拖入文件')
        "
        @input="input"
        @paste="paste"
        @keydown.enter="
          if (($event.ctrlKey || $event.metaKey) && !$event.isComposing) {
            $event.preventDefault();
            emit('submit');
          }
        "
      />
    </label>
    <div
      v-if="materials.length"
      class="capture-materials"
      :aria-label="t('已粘贴的资料')"
    >
      <div v-for="item in materials" :key="item.id" class="capture-material">
        <img
          v-if="item.imageCount || previews[item.id]"
          :src="previews[item.id] || materialUrl(item.id) + '/images/0'"
          :alt="item.name"
        /><PhFileText v-else :size="20" />
        <a :href="materialUrl(item.id)" :title="item.name">{{ item.name }}</a>
        <button
          type="button"
          class="icon-button"
          :aria-label="t('移除 ') + item.name"
          :disabled="disabled || busy || voiceBusy"
          @click="remove(item.id)"
        >
          <PhX :size="13" />
        </button>
        <small v-for="warning in item.warnings" :key="warning">{{
          t(warning)
        }}</small>
      </div>
    </div>
    <div class="capture-tools">
      <span v-if="busy" role="status">{{ t("正在读取内容…") }}</span>
      <span v-else class="capture-hint"
        ><PhImage :size="14" />{{ t("直接粘贴文字、截图、表格或文件") }}</span
      >
      <SpeechInput
        v-if="referenceMode"
        :active="active"
        :disabled="disabled || busy"
        @busy="voiceBusy = $event"
        @text="insert"
      />
      <input
        ref="upload"
        type="file"
        hidden
        multiple
        accept=".png,.jpg,.jpeg,.webp,.xlsx,.xls,.docx,.doc,.pdf,.txt,.csv,.tsv"
        @change="
          addFiles(Array.from(($event.target as HTMLInputElement).files ?? []))
        "
      />
      <button
        type="button"
        class="text-button"
        :disabled="disabled || busy || voiceBusy"
        @click="upload?.click()"
      >
        <PhPaperclip :size="14" />{{ t("添加附件") }}
      </button>
    </div>
    <p
      v-if="referenceMode && hasFiles && !uncertainPurpose"
      class="capture-hint"
      role="status"
    >
      {{
        mixedFiles
          ? t("将归档 {p0} 份资料，并识别 {p1} 份记录。", {
              p0: referenceMaterials.length,
              p1: materials.length - referenceMaterials.length,
            })
          : referenceFiles
            ? t("将作为资料归档，不拆分任务。")
            : retainOriginal
              ? t("将识别为事项，并保留原附件。")
              : t("将识别为事项，处理后清理临时原件。")
      }}
    </p>
    <details
      v-if="referenceMode && hasFiles"
      :open="uncertainPurpose || undefined"
    >
      <summary>
        {{
          uncertainPurpose ? t("暂时无法判断用途，请选择") : t("调整处理方式")
        }}
      </summary>
      <div class="capture-purpose">
        <label
          >{{ t("附件用途") }}
          <select
            :aria-label="t('附件用途')"
            :value="
              uncertainPurpose || mixedFiles
                ? ''
                : referenceFiles
                  ? 'reference'
                  : 'extract'
            "
            :disabled="disabled || busy || voiceBusy"
            @change="changePurpose"
          >
            <option v-if="uncertainPurpose" value="" disabled>
              {{ t("请选择用途…") }}
            </option>
            <option v-else-if="mixedFiles" value="" disabled>
              {{
                t("将归档 {p0} 份资料，并识别 {p1} 份记录。", {
                  p0: referenceMaterials.length,
                  p1: materials.length - referenceMaterials.length,
                })
              }}
            </option>
            <option value="reference">{{ t("归档资料") }}</option>
            <option value="extract">{{ t("识别成事项") }}</option>
          </select></label
        >
        <small v-if="referenceFiles">{{
          t("只按文件名和说明归类，不读取正文、不拆任务。")
        }}</small>
        <label v-else-if="!uncertainPurpose" class="retain-original"
          ><input
            v-model="retainOriginal"
            type="checkbox"
            :disabled="disabled || busy || voiceBusy"
          />{{ t("保留原附件") }}
          <small>{{
            t("默认处理成功后清理临时原图，保留识别文字。")
          }}</small></label
        >
      </div>
      <CaptureDepthSelect
        v-if="!referenceFiles && !uncertainPurpose"
        :model-value="recognitionDepth"
        :disabled="disabled || busy || voiceBusy"
        @update:model-value="changeDepth"
      />
    </details>
    <CaptureDepthSelect
      v-if="!referenceMode"
      :model-value="recognitionDepth"
      :disabled="disabled || busy || voiceBusy"
      @update:model-value="changeDepth"
    />
    <p
      v-if="!referenceFiles && imageCount && recognitionDepth === 'text'"
      class="capture-skipped-images"
      role="status"
    >
      {{ imageCount }}
      {{
        t("张图片暂不识别，原件保留。需要读取截图或扫描页时，请切换识别深度。")
      }}
    </p>
    <p v-if="error" role="alert" class="error-box">{{ t(error) }}</p>
    <p v-for="warning in warnings" :key="warning" class="capture-warning">
      {{ t(warning) }}
    </p>
  </div>
</template>
<style scoped>
.capture-input {
  min-width: 0;
  width: 100%;
}
.capture-label {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.capture-input textarea {
  width: 100%;
  min-height: 100px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.7;
}
.capture-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}
.capture-hint,
.capture-tools button {
  display: flex;
  align-items: center;
  gap: 5px;
}
.capture-tools button {
  min-height: 26px;
  font-size: 11px;
  color: var(--muted);
}
.capture-materials {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.capture-material {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-subtle);
  flex-wrap: wrap;
  font-size: 12px;
}
.capture-material img {
  width: 44px;
  height: 34px;
  object-fit: contain;
  border-radius: 3px;
}
.capture-material > a {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.capture-material .icon-button {
  min-height: 24px;
  padding: 3px;
}
.capture-material small {
  width: 100%;
  color: var(--muted);
  font-size: 10px;
}
.capture-warning {
  color: var(--status-blocked);
  font-size: 11px;
  margin: 6px 0;
}
.capture-skipped-images {
  color: var(--muted);
  font-size: 11px;
  margin: 6px 0 0;
}
.capture-purpose,
.capture-purpose label {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
}
.capture-purpose {
  margin-top: 8px;
}
.capture-purpose label {
  flex-direction: row;
  font-weight: normal;
}
.capture-purpose select {
  width: auto;
  min-height: 28px;
  padding: 3px 26px 3px 8px;
  font-size: 12px;
}
.retain-original input {
  width: auto;
  min-height: auto;
}
.compact textarea {
  min-height: 90px;
}
.error-box {
  font-size: 12px;
  margin: 7px 0 0;
}
@media (max-width: 600px) {
  .capture-input textarea {
    font-size: 16px;
  }
  .capture-tools button {
    min-height: 44px;
    padding: 8px;
    font-size: 13px;
    white-space: nowrap;
  }
  .capture-material .icon-button {
    min-width: 44px;
    min-height: 44px;
  }
  .capture-hint {
    display: none;
  }
  .capture-tools {
    justify-content: flex-end;
    align-items: flex-start;
    gap: 6px;
  }
  .capture-hint {
    font-size: 10px;
  }
  .capture-material > a {
    max-width: 170px;
  }
}
</style>
