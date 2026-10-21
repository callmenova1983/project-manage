<script setup lang="ts">
import { t } from "../locales";
import { ref, onMounted, watch, computed, onBeforeUnmount } from "vue";
import { useWorkspace } from "../stores/workspace";
import {
  wecomLoginInput,
  type WecomLoginState,
} from "../../../../packages/domain/wecom-login";
const emit = defineEmits<{ dirty: [value: boolean] }>();
const store = useWorkspace();
const state = ref<WecomLoginState | null>(null),
  error = ref(""),
  notice = ref(""),
  busy = ref(false);
const draft = ref({
  version: 0,
  enabled: false,
  corpId: "",
  agentId: "",
  secret: "",
  autoProvision: false,
});
const baseline = ref("");
const dirty = computed(
  () => !!baseline.value && JSON.stringify(draft.value) !== baseline.value,
);
watch(dirty, (value) => emit("dirty", value));
onBeforeUnmount(() => {
  draft.value.secret = "";
  emit("dirty", false);
});
async function read(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(t(data.message || "请求失败，请重试。"));
  return data;
}
function apply(value: WecomLoginState) {
  state.value = value;
  draft.value = {
    version: value.version,
    enabled: value.enabled,
    corpId: value.corpId,
    agentId: value.agentId,
    secret: "",
    autoProvision: value.autoProvision,
  };
  baseline.value = JSON.stringify(draft.value);
}
async function load() {
  if (store.mode === "local") return;
  busy.value = true;
  error.value = "";
  try {
    apply(
      await read(
        await fetch("/api/admin/wecom-login", {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        }),
      ),
    );
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function save() {
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const input = wecomLoginInput.safeParse(draft.value);
    if (!input.success)
      throw new Error(t("请填写企业 CorpID 和数字格式的应用 AgentID。"));
    const session = await read(
      await fetch("/api/auth/session", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }),
    );
    apply(
      await read(
        await fetch("/api/admin/wecom-login", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.csrf,
          },
          body: JSON.stringify(input.data),
          signal: AbortSignal.timeout(15000),
        }),
      ),
    );
    notice.value = t(
      "企微免登设置已保存。请在企业微信后台配置下方入口和可信域名，再从企微验证登录。",
    );
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function check() {
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const session = await read(
      await fetch("/api/auth/session", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }),
    );
    const result = await read(
      await fetch("/api/admin/wecom-login/check", {
        method: "POST",
        headers: { "x-csrf-token": session.csrf },
        signal: AbortSignal.timeout(25000),
      }),
    );
    notice.value = result.message;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section class="wecom-login-settings" :aria-busy="busy">
    <h2>{{ t("企业微信免登") }}</h2>
    <p class="muted">
      {{ t("从企业微信工作台打开 PM，自动识别员工并使用现有账号和项目权限。") }}
    </p>
    <p v-if="store.mode === 'local'">
      {{ t("演示模式不连接企业微信，请登录团队工作区后配置。") }}
    </p>
    <form v-else-if="state" @submit.prevent="save">
      <fieldset :disabled="busy">
        <label class="check"
          ><input v-model="draft.enabled" type="checkbox" />{{
            t("启用企微免登")
          }}</label
        >
        <label
          >{{ t("企业 CorpID")
          }}<input v-model="draft.corpId" required autocomplete="off"
        /></label>
        <label
          >{{ t("应用 AgentID")
          }}<input
            v-model="draft.agentId"
            required
            inputmode="numeric"
            pattern="[0-9]+"
            autocomplete="off"
        /></label>
        <label
          >{{ t("应用 Secret")
          }}<input
            v-model="draft.secret"
            type="password"
            autocomplete="new-password"
            :placeholder="
              state.secretConfigured
                ? t('已保存，留空保留原值')
                : t('填写此应用的 Secret')
            "
            :required="!state.secretConfigured"
        /></label>
        <p class="muted">
          {{
            t(
              "填写工作台中 PM 应用的凭据；通讯录同步凭据和通知配置分别管理。更换企业或应用时需要重新填写 Secret。",
            )
          }}
        </p>
        <label class="check"
          ><input v-model="draft.autoProvision" type="checkbox" />{{
            t("首次访问自动开通普通成员")
          }}</label
        >
        <p class="muted">
          {{
            t(
              "默认仅允许已关联、已激活的系统账号登录。自动开通仅面向已同步的有效员工；发现同邮箱账号时仍需管理员确认绑定。",
            )
          }}
        </p>
        <p>
          <a href="/directory">{{ t("前往团队通讯录关联员工账号") }}</a>
        </p>
        <button class="primary" :disabled="busy || !dirty">
          {{ busy ? t("保存中…") : t("保存免登设置") }}
        </button>
      </fieldset>
      <button
        type="button"
        :disabled="busy || dirty || !state.secretConfigured"
        @click="check"
      >
        {{ t("检查已保存的应用凭据") }}
      </button>
      <dl>
        <dt>{{ t("工作台应用入口") }}</dt>
        <dd>
          <input
            :aria-label="t('工作台应用入口')"
            readonly
            :value="state.entryUrl"
          />
        </dd>
        <dt>{{ t("授权回调地址") }}</dt>
        <dd>
          <input
            :aria-label="t('授权回调地址')"
            readonly
            :value="state.callbackUrl"
          />
        </dd>
        <dt>{{ t("网页授权可信域名") }}</dt>
        <dd>{{ state.trustedDomain }}</dd>
      </dl>
      <p class="muted">
        {{
          t(
            "地址由服务器 APP_ORIGIN 生成。请确认它是员工可访问的正式地址，在企微后台设置应用主页、网页授权可信域名、应用可见范围及服务器可信 IP。",
          )
        }}
      </p>
      <p v-if="state.lastEvent">
        {{ t("最近登录结果：") }}{{ state.lastEvent.outcome }}（{{
          state.lastEvent.createdAt
        }}）
      </p>
    </form>
    <p v-if="error" class="error-box" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <button
      v-if="!dirty && store.mode !== 'local'"
      :disabled="busy"
      @click="load"
    >
      {{ t("刷新配置与登录结果") }}
    </button>
  </section>
</template>
<style scoped>
.wecom-login-settings {
  max-width: 800px;
}
fieldset {
  border: 0;
  padding: 0;
  display: grid;
  gap: 16px;
  margin: 24px 0;
}
label {
  display: grid;
  gap: 8px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
}
.check input {
  width: auto;
}
dd {
  margin: 8px 0 16px;
  overflow-wrap: anywhere;
}
dd input {
  width: 100%;
}
.muted {
  font-size: 13px;
  line-height: 1.7;
}
</style>
