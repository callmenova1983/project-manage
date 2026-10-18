<script setup lang="ts">
import { t } from "../locales";
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { PhCpu, PhArrowClockwise } from "@phosphor-icons/vue";
import type { ModelUsage } from "../../../../packages/domain/admin";
import { api } from "../services/api";
import { formatDate, locale } from "../locales";

const usage = ref<ModelUsage>(),
  error = ref(false),
  busy = ref(false);
const panel = ref<HTMLDetailsElement>();
const count = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString();
const compact = computed(() => {
  const n = usage.value?.totalTokens;
  return n === undefined
    ? "—"
    : n >= 1000000
      ? `${(n / 1000000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : String(n);
});
async function refresh() {
  if (busy.value || document.hidden) return;
  busy.value = true;
  try {
    usage.value = await api.modelUsage();
    error.value = false;
  } catch {
    error.value = true;
  } finally {
    busy.value = false;
  }
}
function outside(event: PointerEvent) {
  if (
    event.target instanceof Node &&
    !panel.value?.contains(event.target) &&
    panel.value
  )
    panel.value.open = false;
}
function escape(event: KeyboardEvent) {
  if (event.key === "Escape" && panel.value?.open) {
    panel.value.open = false;
    panel.value.querySelector("summary")?.focus();
    event.stopPropagation();
  }
}
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 20000);
  window.addEventListener("pm:ai-usage-changed", refresh);
  document.addEventListener("visibilitychange", refresh);
  document.addEventListener("pointerdown", outside);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener("pm:ai-usage-changed", refresh);
  document.removeEventListener("visibilitychange", refresh);
  document.removeEventListener("pointerdown", outside);
});
</script>

<template>
  <details
    ref="panel"
    class="token-usage"
    @keydown="escape"
    @toggle="panel?.open && refresh()"
  >
    <summary
      :aria-label="
        locale === 'en'
          ? `Token usage: ${count(usage?.totalTokens)} tokens recorded`
          : t('Token 用量，已记录 {p0} tokens', {
              p0: count(usage?.totalTokens),
            })
      "
      :title="
        locale === 'en'
          ? `${count(usage?.totalTokens)} tokens recorded in this workspace. Click for details.`
          : t('工作区累计已记录 {p0} tokens，点击查看明细', {
              p0: count(usage?.totalTokens),
            })
      "
    >
      <PhCpu :size="16" /><span>{{ compact }}</span
      ><small>tokens</small
      ><span
        v-if="error"
        class="usage-stale"
        :title="locale === 'en' ? 'Not refreshed yet' : t('暂未刷新')"
        >·</span
      >
    </summary>
    <section class="usage-popover" :aria-label="t('Token 用量明细')">
      <header>
        <strong>{{ t("Token 用量") }}</strong
        ><button
          type="button"
          class="icon-button"
          :aria-label="t('刷新 Token 用量')"
          :disabled="busy"
          @click="refresh"
        >
          <PhArrowClockwise :size="15" />
        </button>
      </header>
      <p class="muted">
        {{
          api.mode === "local"
            ? t("本地演示，未调用模型")
            : t("当前工作区累计 · 模型实际返回的用量")
        }}
      </p>
      <dl v-if="usage">
        <div>
          <dt>{{ t("输入") }}</dt>
          <dd>{{ count(usage.inputTokens) }}</dd>
        </div>
        <div>
          <dt>{{ t("输出") }}</dt>
          <dd>{{ count(usage.outputTokens) }}</dd>
        </div>
        <div class="usage-total">
          <dt>{{ t("已记录合计") }}</dt>
          <dd>{{ count(usage.totalTokens) }} <small>tokens</small></dd>
        </div>
      </dl>
      <p v-if="usage?.speech?.requests" class="muted">
        {{ t("语音识别") }} {{ usage.speech.requests }}
        {{ t("次 · 云端已记录") }} {{ usage.speech.recordedSeconds }}
        {{ t("秒")
        }}<span v-if="usage.speech.unmeasuredRequests"
          >（{{ usage.speech.unmeasuredRequests }}
          {{ t("次时长未返回）") }}</span
        >
      </p>
      <p v-if="error" role="status">
        {{ t("用量暂未刷新，已有数字为上次记录。")
        }}<button type="button" class="text-button" @click="refresh">
          {{ t("重试") }}
        </button>
      </p>
      <div v-if="usage?.last" class="usage-last">
        <strong>{{ t("最近一次") }}</strong
        ><span>{{ formatDate(usage.last.createdAt) }}</span>
        <p>
          {{ t("输入") }} {{ count(usage.last.inputTokens) }} {{ t("· 输出") }}
          {{ count(usage.last.outputTokens) }}
        </p>
      </div>
      <p v-if="usage?.unmeasuredRequests" class="usage-warning">
        {{ usage.unmeasuredRequests }}
        {{ t("次请求未完整返回用量，未估算为 0，实际消耗可能更高。") }}
      </p>
      <p v-if="usage?.pendingRequests" role="status">
        {{ usage.pendingRequests }} {{ t("次请求尚无最终用量。") }}
      </p>
      <small class="muted">{{
        t("文字提取不计模型用量；Token 数量与调用次数分开统计，非账单金额。")
      }}</small>
    </section>
  </details>
</template>

<style scoped>
.token-usage {
  position: relative;
  font-size: 12px;
}
.token-usage summary {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  list-style: none;
  padding: 7px 5px;
  white-space: nowrap;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.token-usage summary::-webkit-details-marker {
  display: none;
}
.token-usage summary:hover,
.token-usage[open] summary {
  color: var(--accent);
}
.token-usage summary:focus-visible {
  outline: 2px solid var(--accent);
  border-radius: 5px;
}
.token-usage summary small {
  font-size: 10px;
}
.usage-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  width: 310px;
  max-width: calc(100vw - 24px);
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 12px 36px rgb(0 0 0 / 16%);
  z-index: 120;
}
.usage-popover header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.usage-popover header button {
  min-height: 26px;
  padding: 4px;
}
.usage-popover p {
  font-size: 11px;
  line-height: 1.6;
  margin: 8px 0;
}
.usage-popover dl {
  margin: 12px 0;
}
.usage-popover dl > div {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
}
.usage-popover dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.usage-total {
  border-top: 1px solid var(--border);
  margin-top: 5px;
  padding-top: 9px !important;
}
.usage-last {
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
.usage-last > span {
  display: block;
  font-size: 10px;
  color: var(--muted);
  margin-top: 4px;
}
.usage-warning,
.usage-stale {
  color: var(--status-blocked);
}
@media (max-width: 600px) {
  .token-usage summary {
    min-height: 40px;
  }
  .token-usage summary small {
    display: none;
  }
  .usage-popover {
    position: fixed;
    right: 12px;
    top: 62px;
  }
}
</style>
