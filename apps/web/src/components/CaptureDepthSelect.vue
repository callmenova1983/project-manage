<script setup lang="ts">
import { t } from "../locales";
import { computed } from "vue";
import type { CaptureRecognitionDepth } from "../../../../packages/domain/capture";

const props = defineProps<{
  modelValue: CaptureRecognitionDepth;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [CaptureRecognitionDepth];
}>();
const explanation = computed(() =>
  props.modelValue === "text"
    ? t("只读正文和表格文字，跳过图片，减少用量。")
    : props.modelValue === "ocr"
      ? t("识别截图、扫描页和文件内图片中的文字。")
      : t("结合图中文字，分析图表、流程和布局；可能增加用量。"),
);
</script>

<template>
  <div class="capture-depth">
    <label>
      <span>{{ t("识别深度") }}</span>
      <select
        :value="modelValue"
        :aria-label="t('识别深度')"
        :disabled="disabled"
        @change="
          emit(
            'update:modelValue',
            ($event.target as HTMLSelectElement)
              .value as CaptureRecognitionDepth,
          )
        "
      >
        <option value="text">{{ t("仅文字（默认）") }}</option>
        <option value="ocr">{{ t("识别图中文字") }}</option>
        <option value="deep">{{ t("理解图表") }}</option>
      </select>
    </label>
    <small>{{ explanation }}</small>
  </div>
</template>

<style scoped>
.capture-depth,
.capture-depth label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.capture-depth {
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 11px;
  color: var(--muted);
}
.capture-depth label {
  flex-direction: row;
  white-space: nowrap;
  font-size: inherit;
  font-weight: normal;
}
.capture-depth select {
  width: auto;
  min-height: 28px;
  padding: 3px 26px 3px 8px;
  font-size: 12px;
}
.capture-depth small {
  font-size: inherit;
}
@media (max-width: 600px) {
  .capture-depth select {
    min-height: 40px;
    font-size: 14px;
  }
}
</style>
