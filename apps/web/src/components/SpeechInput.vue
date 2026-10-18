<script setup lang="ts">
import { t } from "../locales";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  PhMicrophone,
  PhStop,
  PhX,
  PhArrowClockwise,
  PhSpinnerGap,
} from "@phosphor-icons/vue";
import { api } from "../services/api";
import { VoiceRecorder } from "../services/voice-recorder";
import { fileBase64 } from "../services/progress-clipboard";
import type { SpeechCapabilities } from "../../../../packages/domain/speech";
const props = defineProps<{ disabled?: boolean; active?: boolean }>();
const emit = defineEmits<{ text: [string]; busy: [boolean] }>();
const state = ref<
  "idle" | "permission" | "recording" | "transcribing" | "failed"
>("idle");
const elapsed = ref(0),
  level = ref(0),
  error = ref(""),
  notice = ref("");
const capabilities = ref<SpeechCapabilities>();
let recorder: VoiceRecorder | undefined,
  timer: ReturnType<typeof setInterval> | undefined,
  recording: Blob | undefined;
let disposed = false,
  generation = 0,
  requestId = "";
watch(
  state,
  (value) =>
    emit("busy", ["permission", "recording", "transcribing"].includes(value)),
  { flush: "sync" },
);
async function refresh() {
  try {
    capabilities.value = await api.speechCapabilities();
  } catch {
    /* Opening text chat must not depend on speech connectivity. */
  }
}
onMounted(refresh);
watch(
  () => props.active,
  (value) => {
    if (value === false && ["recording", "permission"].includes(state.value))
      cancel();
  },
);
async function start() {
  if (
    props.disabled ||
    ["permission", "recording", "transcribing"].includes(state.value)
  )
    return;
  error.value = "";
  notice.value = "";
  recording = undefined;
  elapsed.value = 0;
  level.value = 0;
  if (!capabilities.value?.enabled) {
    await refresh();
    if (!capabilities.value?.enabled) {
      error.value =
        capabilities.value?.reason || t("语音服务暂时无法连接，请稍后重试。");
      return;
    }
  }
  state.value = "permission";
  const current = ++generation;
  recorder = new VoiceRecorder();
  try {
    await recorder.start(
      (value) => (level.value = value),
      () => {
        if (state.value === "recording") void stop();
      },
    );
    if (current !== generation || disposed) return;
    state.value = "recording";
    const started = Date.now();
    timer = setInterval(() => {
      elapsed.value = Math.floor((Date.now() - started) / 1000);
      if (elapsed.value >= 120) void stop();
    }, 250);
  } catch (e) {
    if (current !== generation || disposed) return;
    state.value = "idle";
    error.value =
      e instanceof DOMException &&
      ["NotAllowedError", "PermissionDeniedError"].includes(e.name)
        ? t(
            "未获得麦克风权限，可在浏览器设置中允许后重试；也可以直接输入文字。",
          )
        : e instanceof DOMException && e.name === "NotFoundError"
          ? t("没有找到麦克风，请检查设备后重试。")
          : e instanceof Error
            ? e.message
            : t("麦克风暂时无法使用。");
  }
}
async function stop() {
  if (state.value !== "recording" || !recorder) return;
  clearInterval(timer);
  state.value = "transcribing";
  try {
    recording = await recorder.finish();
    recorder = undefined;
    if (recording.size < 6444)
      throw new Error(t("录音太短，请说完一句话后再结束。"));
    requestId = crypto.randomUUID();
    await transcribe();
  } catch (e) {
    if (!disposed) {
      state.value = "failed";
      error.value =
        e instanceof Error ? e.message : t("录音未能识别，请重试。");
    }
  }
}
async function transcribe(retry = false) {
  if (!recording || disposed) return;
  state.value = "transcribing";
  error.value = "";
  if (retry) requestId = crypto.randomUUID();
  const current = generation;
  try {
    const result = await api.transcribeSpeech({
      requestId,
      mime: "audio/wav",
      data: await fileBase64(
        new File([recording], "voice.wav", { type: "audio/wav" }),
      ),
    });
    if (disposed || current !== generation) return;
    emit("text", result.text);
    recording = undefined;
    state.value = "idle";
    notice.value = t("语音已转成文字，可修改后发送。");
  } catch (e) {
    if (disposed || current !== generation) return;
    state.value = "failed";
    error.value =
      e instanceof Error ? e.message : t("识别失败，录音仍在本机，可重试。");
  }
  void refresh();
}
function cancel() {
  generation++;
  clearInterval(timer);
  recorder?.cancel();
  recorder = undefined;
  recording = undefined;
  state.value = "idle";
  error.value = "";
  notice.value = "";
}
function visibility() {
  if (document.hidden && ["recording", "permission"].includes(state.value)) {
    cancel();
    notice.value = t("录音已暂停，请返回后重新录制。");
  }
}
onMounted(() => document.addEventListener("visibilitychange", visibility));
onBeforeUnmount(() => {
  disposed = true;
  cancel();
  document.removeEventListener("visibilitychange", visibility);
});
</script>
<template>
  <div class="speech-input">
    <button
      v-if="state === 'idle' || state === 'failed'"
      type="button"
      class="text-button voice-start"
      :disabled="disabled"
      :aria-label="t('语音录入')"
      :title="
        t('语音转文字 · {p0}', { p0: capabilities?.model || 'qwen3-asr-flash' })
      "
      @click="start"
    >
      <PhMicrophone :size="16" /><span>{{ t("说话") }}</span>
    </button>
    <div v-else class="speech-progress" role="status">
      <PhSpinnerGap
        v-if="state !== 'recording'"
        :size="15"
        class="spin"
      /><PhMicrophone v-else :size="16" />
      <span>{{
        state === "permission"
          ? t("正在打开麦克风…")
          : state === "transcribing"
            ? t("云端识别中…")
            : t("录音 {p0}:{p1}", {
                p0: Math.floor(elapsed / 60),
                p1: String(elapsed % 60).padStart(2, "0"),
              })
      }}</span>
      <meter
        v-if="state === 'recording'"
        :value="level"
        min="0"
        max="1"
        :aria-label="t('麦克风音量')"
      />
      <button
        v-if="state === 'recording'"
        type="button"
        class="text-button"
        :aria-label="t('结束录音并识别')"
        @click="stop"
      >
        <PhStop :size="15" />{{ t("完成") }}
      </button>
      <button
        v-if="state !== 'transcribing'"
        type="button"
        class="icon-button"
        :aria-label="t('取消录音')"
        @click="cancel"
      >
        <PhX :size="14" />
      </button>
    </div>
    <div v-if="error" class="speech-error" role="alert">
      <span>{{ t(error) }}</span
      ><button
        v-if="state === 'failed' && recording"
        type="button"
        class="text-button"
        @click="transcribe(true)"
      >
        <PhArrowClockwise :size="13" />{{ t("重试识别") }}</button
      ><button
        type="button"
        class="icon-button"
        :aria-label="t('关闭语音提示')"
        @click="cancel"
      >
        <PhX :size="13" />
      </button>
    </div>
    <span v-if="notice" class="speech-notice" role="status">{{
      t(notice)
    }}</span>
  </div>
</template>
<style scoped>
.speech-input {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 11px;
}
.voice-start {
  display: inline-flex;
  gap: 5px;
}
.speech-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-size: 11px;
}
.speech-progress meter {
  width: 36px;
  height: 8px;
}
.speech-error {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-basis: 100%;
  padding: 6px 0;
  color: var(--muted);
}
.speech-error > span {
  flex: 1;
  min-width: 0;
}
.speech-notice {
  flex-basis: 100%;
  color: var(--muted);
}
button {
  min-height: 28px;
}
@media (max-width: 760px) {
  button {
    min-height: 40px;
  }
  .speech-progress {
    flex-wrap: wrap;
  }
}
</style>
