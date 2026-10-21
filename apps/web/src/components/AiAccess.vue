<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from "vue";
import { PhPlugsConnected, PhCopy, PhKey, PhTrash } from "@phosphor-icons/vue";
import WorkspaceDialog from "./WorkspaceDialog.vue";
import { api, HttpApi } from "../services/api";
import { t, formatDate } from "../locales";
import { useWorkspace } from "../stores/workspace";
import {
  aiAccessInstructions,
  type PersonalAccessTokenInfo,
} from "../../../../packages/domain/ai-access";

const store = useWorkspace();
const client = api instanceof HttpApi ? api : null;
const open = ref(false),
  loading = ref(false),
  busy = ref(false),
  ready = ref(false);
const token = ref<PersonalAccessTokenInfo | null>(null);
const instructions = ref(""),
  error = ref(""),
  message = ref("");
const text = ref<HTMLTextAreaElement | null>(null);
let active = true;
onBeforeUnmount(() => {
  active = false;
  instructions.value = "";
});

async function show() {
  if (!client) return;
  open.value = true;
  loading.value = true;
  ready.value = false;
  error.value = "";
  message.value = "";
  try {
    const result = await client.aiAccessState();
    if (!active) return;
    token.value = result.token;
    ready.value = true;
  } catch (e) {
    if (active) error.value = (e as Error).message;
  } finally {
    if (active) loading.value = false;
  }
}
function close() {
  open.value = false;
  instructions.value = "";
  message.value = "";
}
async function copy() {
  message.value = "";
  error.value = "";
  try {
    await navigator.clipboard.writeText(instructions.value);
    if (active)
      message.value = t("接入说明已复制，粘贴给 WorkBuddy 或 Codex 即可。");
  } catch {
    if (!active) return;
    await nextTick();
    text.value?.focus();
    text.value?.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      /* Keep the selected text available for manual copying. */
    }
    if (copied) {
      message.value = t("接入说明已复制，粘贴给 WorkBuddy 或 Codex 即可。");
    } else {
      error.value = t("浏览器无法自动复制，请复制下方已选中的完整说明。");
    }
  }
}
async function generate() {
  if (!client) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    const result = await client.generateAiAccessToken();
    if (!active) return;
    token.value = result.info;
    instructions.value = aiAccessInstructions(
      window.location.origin,
      result.token,
    );
    await nextTick();
    await copy();
  } catch (e) {
    if (active) error.value = (e as Error).message;
  } finally {
    if (active) busy.value = false;
  }
}
async function revoke() {
  if (!client) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await client.revokeAiAccessToken();
    if (!active) return;
    token.value = null;
    instructions.value = "";
    message.value = t("接入凭据已撤销。");
  } catch (e) {
    if (active) error.value = (e as Error).message;
  } finally {
    if (active) busy.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    class="ai-access-launch"
    :aria-label="t('AI 接入')"
    :title="t('AI 接入')"
    @click="show"
  >
    <PhPlugsConnected :size="19" /><span>{{ t("AI 接入") }}</span>
  </button>
  <WorkspaceDialog
    :open="open"
    :title="t('AI 接入')"
    variant="drawer"
    :busy="busy || loading"
    @close="close"
  >
    <div class="ai-access-content">
      <p class="intro">
        {{
          t(
            "复制接入说明给 WorkBuddy 或 Codex，即可连接 PM，读取你的身份、所有可访问项目和任务概况。",
          )
        }}
      </p>
      <div class="identity">
        <PhKey :size="20" />
        <div>
          <strong>{{ store.user?.name }}</strong>
          <p>{{ t("沿用你的成员权限") }}</p>
        </div>
      </div>
      <p v-if="loading" role="status">{{ t("Loading…") }}</p>
      <template v-else-if="ready">
        <section
          v-if="token"
          class="token-state"
          :aria-label="t('个人接入凭据')"
        >
          <div class="token-heading">
            <strong>{{ t("个人接入凭据") }}</strong
            ><span class="active-label">{{ t("已启用") }}</span>
          </div>
          <code>{{ token.prefix }}…</code>
          <p>{{ t("Created") }}：{{ formatDate(token.createdAt) }}</p>
          <p>
            {{ t("最近访问") }}：{{
              token.lastUsedAt ? formatDate(token.lastUsedAt) : t("暂无访问")
            }}
          </p>
          <p>{{ t("持续有效，直到撤销或重新生成。") }}</p>
        </section>
        <p v-if="token && !instructions" class="renew-note">
          {{
            t(
              "为保护凭据，旧 Token 无法再次显示。重新生成后，旧 Token 立即失效。",
            )
          }}
        </p>
        <button
          type="button"
          class="primary connect-button"
          :disabled="busy"
          @click="instructions ? copy() : generate()"
        >
          <PhCopy :size="18" />{{
            busy
              ? t("Processing…")
              : instructions
                ? t("复制接入说明")
                : token
                  ? t("重新生成并复制接入指令")
                  : t("生成并复制接入指令")
          }}
        </button>
        <div v-if="instructions" class="instruction-field">
          <label for="ai-access-instructions">{{ t("接入说明") }}</label>
          <textarea
            id="ai-access-instructions"
            ref="text"
            :value="instructions"
            readonly
            spellcheck="false"
            @focus="text?.select()"
          />
        </div>
        <div class="access-actions">
          <a href="/api/ai-access/docs" target="_blank" rel="noopener">{{
            t("查看接口文档")
          }}</a>
          <button
            v-if="token"
            type="button"
            class="revoke"
            :disabled="busy"
            @click="revoke"
          >
            <PhTrash :size="16" />{{ t("撤销接入") }}
          </button>
        </div>
      </template>
      <p v-if="message" class="success-message" role="status">{{ message }}</p>
      <p v-if="error" class="error" role="alert">{{ t(error) }}</p>
      <button v-if="!loading && !ready" type="button" @click="show">
        {{ t("Retry") }}
      </button>
    </div>
  </WorkspaceDialog>
</template>

<style scoped>
.ai-access-launch {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 10px;
  white-space: nowrap;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
}
.ai-access-content {
  display: grid;
  gap: 20px;
}
.ai-access-content p {
  margin: 0;
  line-height: 1.65;
}
.intro,
.renew-note,
.identity p,
.token-state p {
  color: var(--muted);
  font-size: 13px;
}
.identity {
  display: flex;
  gap: 12px;
  align-items: center;
}
.token-state {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-raised);
}
.token-heading,
.access-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.active-label {
  color: var(--accent);
  font-size: 12px;
}
.connect-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  width: 100%;
}
.instruction-field {
  display: grid;
  gap: 8px;
}
.instruction-field textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 240px;
  resize: vertical;
  font: 12px/1.6 monospace;
  overflow-wrap: anywhere;
}
.access-actions {
  flex-wrap: wrap;
  font-size: 13px;
}
.revoke {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
}
.success-message {
  color: var(--accent);
  font-size: 13px;
}
@media (max-width: 600px) {
  .ai-access-launch {
    min-height: 44px;
  }
}
</style>
