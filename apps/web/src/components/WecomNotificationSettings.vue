<script setup lang="ts">
import { t } from "../locales";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  PhArrowClockwise,
  PhCheckCircle,
  PhWarningCircle,
  PhBell,
} from "@phosphor-icons/vue";
import {
  notificationConfigInput,
  type NotificationAdminState,
  type NotificationConfigInput,
} from "../../../../packages/domain/notification-delivery";
import { useWorkspace } from "../stores/workspace";
import { createNotificationAdminApi } from "../services/notification-admin";
import { formatDate, formatNumber } from "../locales";

const store = useWorkspace();
const emit = defineEmits<{ dirty: [boolean] }>();
const demo = store.mode === "local";
const service = createNotificationAdminApi(store.mode);
const state = ref<NotificationAdminState | null>(null);
const loading = ref(false),
  busy = ref(false),
  error = ref("");
const baseline = ref("");
const draft = ref<NotificationConfigInput>({
  version: 0,
  enabled: false,
  corpId: "",
  agentId: 0,
  baseUrl: "",
  secret: "",
});
const dirty = computed(
  () =>
    !demo &&
    baseline.value !== "" &&
    JSON.stringify(draft.value) !== baseline.value,
);
watch(dirty, (value) => emit("dirty", value), { immediate: true });
const selected = ref<string[]>([]),
  memberQuery = ref("");
const unknownRetryId = ref("");
const bindings = computed(() =>
  (state.value?.bindings ?? []).filter((member) =>
    `${member.name} ${member.wecomUserId}`
      .toLowerCase()
      .includes(memberQuery.value.trim().toLowerCase()),
  ),
);
function canConfirm(member: NotificationAdminState["bindings"][number]) {
  return (
    !demo &&
    !dirty.value &&
    !!state.value?.directoryVerified &&
    member.active &&
    !!member.userId &&
    !!member.wecomUserId &&
    !member.confirmed
  );
}
const selectable = computed(() => bindings.value.filter(canConfirm));
const allSelected = computed(
  () =>
    selectable.value.length > 0 &&
    selectable.value.every((m) => selected.value.includes(m.employeeId)),
);
function toggleAll() {
  const ids = new Set(selectable.value.map((m) => m.employeeId));
  selected.value = allSelected.value
    ? selected.value.filter((id) => !ids.has(id))
    : [...new Set([...selected.value, ...ids])];
}
function accept(value: NotificationAdminState) {
  state.value = value;
  draft.value = {
    version: value.config.version,
    enabled: value.config.enabled,
    corpId: value.config.corpId,
    agentId: value.config.agentId,
    baseUrl: value.config.baseUrl,
    secret: "",
  };
  baseline.value = JSON.stringify(draft.value);
  selected.value = [];
}
async function load() {
  if (demo || loading.value || busy.value || dirty.value) return;
  loading.value = true;
  error.value = "";
  try {
    accept(await service.state());
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    loading.value = false;
  }
}
async function perform(
  action: () => Promise<NotificationAdminState>,
  message: string,
) {
  if (demo || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await action();
    if (dirty.value) state.value = result;
    else accept(result);
    unknownRetryId.value = "";
    store.notify(message);
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
async function save() {
  const parsed = notificationConfigInput.safeParse(draft.value);
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? t("请检查通知应用配置。");
    return;
  }
  if (
    parsed.data.enabled &&
    !parsed.data.secret &&
    !state.value?.config.secretConfigured
  ) {
    error.value = t("请填写通知应用密钥后再开启企业微信通知。");
    return;
  }
  await perform(async () => {
    const value = await service.saveConfig(parsed.data);
    accept(value);
    return value;
  }, t("企业微信通知设置已保存"));
}
async function confirmBindings() {
  if (!state.value || !selected.value.length || dirty.value) return;
  await perform(
    () => service.confirmBindings(selected.value, state.value!.config.version),
    t("成员接收关联已确认"),
  );
}
async function retry(id: string, confirmUnknown = false) {
  if (dirty.value) return;
  await perform(
    () => service.retry(id, confirmUnknown),
    t("已重新排队，结果请查看投递记录"),
  );
}
function deliveryLabel(value: string) {
  return (
    (
      {
        queued: t("等待发送"),
        pending: t("等待发送"),
        processing: t("发送中"),
        sending: t("发送中"),
        retry: t("等待重试"),
        accepted: t("企微已接受"),
        blocked: t("待核验"),
        failed: t("发送失败"),
        unknown: t("结果待核查"),
        cancelled: t("已停止"),
        skipped: t("未发送"),
      } as Record<string, string>
    )[value] ?? value
  );
}
function deliveryTone(value: string) {
  if (value === "accepted") return "success";
  if (["unknown", "blocked"].includes(value)) return "warning";
  if (value === "failed") return "danger";
  if (["queued", "pending", "processing", "sending", "retry"].includes(value))
    return "info";
  return "neutral";
}
function time(value: string) {
  return formatDate(value, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
onMounted(load);
onBeforeUnmount(() => {
  draft.value.secret = "";
  emit("dirty", false);
});
</script>

<template>
  <section class="wecom-notification-settings" :aria-busy="loading || busy">
    <div class="notification-heading">
      <div>
        <h2><PhBell :size="20" />{{ t("企业微信通知") }}</h2>
        <p class="muted">
          {{ t("共用站内提醒与处理状态，按成员偏好定向投递。") }}
        </p>
      </div>
      <button
        class="button"
        :disabled="demo || loading || busy || dirty"
        @click="load"
      >
        <PhArrowClockwise :size="16" />{{ t("刷新") }}
      </button>
    </div>
    <p v-if="demo" class="notice" role="note">
      {{ t("演示模式 · 此处只展示设置，不连接企业微信或服务端。") }}
    </p>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <p v-if="loading" class="muted" role="status">
      {{ t("正在读取通知配置…") }}
    </p>
    <template v-if="state || demo">
      <form class="panel notification-config" @submit.prevent="save">
        <div class="notification-heading">
          <h3>{{ t("通知应用") }}</h3>
          <label class="notification-check">
            <input
              v-model="draft.enabled"
              type="checkbox"
              :disabled="demo || busy"
            />{{ t("开启企业微信通知") }}
          </label>
        </div>
        <p class="muted">
          {{
            t(
              "使用独立的通知应用凭据，通讯录同步 Secret 不等于通知应用 Secret。开启后仅向已确认关联的成员发送。",
            )
          }}
        </p>
        <fieldset :disabled="demo || busy" class="notification-fields">
          <label
            >{{ t("企业 ID（CorpID）")
            }}<input
              v-model.trim="draft.corpId"
              autocomplete="off"
              maxlength="128"
              :placeholder="t('通知应用所属企业')"
          /></label>
          <label
            >{{ t("应用 AgentID")
            }}<input
              v-model.number="draft.agentId"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              :placeholder="t('通知应用 AgentID')"
          /></label>
          <label class="full-width"
            >{{ t("业务地址")
            }}<input
              v-model.trim="draft.baseUrl"
              type="url"
              maxlength="500"
              :placeholder="t('https://项目管理域名')"
            /><small>{{
              t("填写手机可访问的 HTTPS 地址，通知链接将直接打开对应事项。")
            }}</small></label
          >
          <label class="full-width"
            >{{ t("通知应用 Secret") }}
            <input
              v-model="draft.secret"
              type="password"
              autocomplete="new-password"
              maxlength="512"
              :placeholder="
                state?.config.secretConfigured
                  ? t('已保存，留空沿用；输入新密钥可替换')
                  : t('填写通知应用的 Secret')
              "
            />
            <small>{{
              t("密钥仅保存于服务端，不回显，不进入项目数据。")
            }}</small>
          </label>
        </fieldset>
        <div class="notification-footer">
          <span v-if="state?.config.secretConfigured" class="status success"
            ><PhCheckCircle :size="15" />{{ t("密钥已保存") }}</span
          >
          <span v-else class="status neutral">{{ t("尚未配置密钥") }}</span>
          <div class="inline-actions">
            <button
              type="button"
              :disabled="demo || busy || !dirty"
              @click="state && accept(state)"
            >
              {{ t("取消修改") }}
            </button>
            <button
              class="primary"
              type="submit"
              :disabled="demo || busy || !dirty"
            >
              {{ t("保存配置") }}
            </button>
          </div>
        </div>
      </form>

      <section class="panel notification-members">
        <div class="notification-heading">
          <div>
            <h3>{{ t("成员接收关联") }}</h3>
            <p class="muted">
              {{
                t("登录账号、通讯录成员和企业微信 UserID 确认对应后才投递。")
              }}
            </p>
          </div>
          <button
            class="button"
            :disabled="
              demo ||
              busy ||
              dirty ||
              !state?.directoryVerified ||
              !selected.length
            "
            @click="confirmBindings"
          >
            {{ t("确认选中") }} {{ formatNumber(selected.length) }}
            {{ t("人") }}
          </button>
        </div>
        <p v-if="!state?.directoryVerified" class="notice warning" role="note">
          <PhWarningCircle :size="17" />{{
            t(
              "请先在团队通讯录完成企业微信同步，并确保同步企业与此处 CorpID 一致。",
            )
          }}<RouterLink to="/team">{{ t("前往团队") }}</RouterLink>
        </p>
        <p v-if="dirty" class="muted">
          {{ t("请先保存应用配置，再确认成员关联或重试投递。") }}
        </p>
        <input
          v-model="memberQuery"
          class="member-search"
          type="search"
          :aria-label="t('搜索接收成员')"
          :placeholder="t('搜索姓名或企业微信 UserID')"
        />
        <div class="notification-table-scroll">
          <table class="notification-table">
            <thead>
              <tr>
                <th class="check-column">
                  <input
                    type="checkbox"
                    :checked="allSelected"
                    :disabled="busy || !selectable.length"
                    :aria-label="t('选择当前可确认成员')"
                    @change="toggleAll"
                  />
                </th>
                <th>{{ t("成员") }}</th>
                <th>{{ t("企业微信 UserID") }}</th>
                <th>{{ t("账号") }}</th>
                <th>{{ t("接收状态") }}</th>
                <th>{{ t("关联确认") }}</th>
                <th>{{ t("说明") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="member in bindings" :key="member.employeeId">
                <td class="check-column">
                  <input
                    v-model="selected"
                    type="checkbox"
                    :value="member.employeeId"
                    :disabled="busy || !canConfirm(member)"
                    :aria-label="t('确认 {p0} 的接收关联', { p0: member.name })"
                  />
                </td>
                <th scope="row">{{ member.name }}</th>
                <td>{{ member.wecomUserId || t("未关联") }}</td>
                <td>
                  <span
                    :class="['status', member.userId ? 'neutral' : 'warning']"
                    >{{
                      member.userId ? t("已关联登录账号") : t("未关联登录账号")
                    }}</span
                  >
                </td>
                <td>
                  <span
                    :class="['status', member.active ? 'neutral' : 'warning']"
                    >{{ member.active ? t("可接收") : t("不可接收") }}</span
                  >
                </td>
                <td>
                  <span
                    :class="[
                      'status',
                      member.confirmed ? 'success' : 'neutral',
                    ]"
                    >{{ member.confirmed ? t("已确认") : t("待确认") }}</span
                  >
                </td>
                <td class="reason-cell">{{ member.reason || "—" }}</td>
              </tr>
              <tr v-if="!bindings.length">
                <td colspan="7" class="empty-row">
                  {{
                    demo
                      ? t("演示模式不读取真实成员关联。")
                      : t("暂无匹配成员，请先同步通讯录并关联登录账号。")
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel notification-deliveries">
        <div class="notification-heading">
          <div>
            <h3>{{ t("投递记录") }}</h3>
            <p class="muted">
              {{
                t(
                  "“企微已接受”只表示接口接受消息，已读和业务处理状态分别记录。",
                )
              }}
            </p>
          </div>
        </div>
        <div class="notification-table-scroll">
          <table class="notification-table delivery-table">
            <thead>
              <tr>
                <th>{{ t("提醒事项") }}</th>
                <th>{{ t("接收人") }}</th>
                <th>{{ t("状态") }}</th>
                <th>{{ t("尝试") }}</th>
                <th>{{ t("更新时间") }}</th>
                <th>{{ t("说明与操作") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="delivery in state?.deliveries ?? []"
                :key="delivery.id"
              >
                <th scope="row" class="delivery-title" :title="delivery.title">
                  {{ delivery.title }}
                </th>
                <td>{{ delivery.recipient }}</td>
                <td>
                  <span :class="['status', deliveryTone(delivery.state)]">{{
                    deliveryLabel(delivery.state)
                  }}</span>
                </td>
                <td>{{ formatNumber(delivery.attempts) }}</td>
                <td class="time-cell">{{ time(delivery.updatedAt) }}</td>
                <td class="reason-cell">
                  <span>{{ delivery.error || "—" }}</span>
                  <button
                    v-if="['failed', 'blocked'].includes(delivery.state)"
                    class="text-button"
                    :disabled="demo || busy || dirty"
                    @click="retry(delivery.id)"
                  >
                    {{
                      delivery.state === "blocked" ? t("重新检查") : t("重试")
                    }}
                  </button>
                  <button
                    v-else-if="
                      delivery.state === 'unknown' &&
                      unknownRetryId !== delivery.id
                    "
                    class="text-button"
                    :disabled="demo || busy || dirty"
                    @click="unknownRetryId = delivery.id"
                  >
                    {{ t("核查后重发") }}
                  </button>
                  <div
                    v-if="unknownRetryId === delivery.id"
                    class="unknown-confirm"
                    role="alert"
                  >
                    <p>
                      {{
                        t(
                          "上次发送结果不确定，重发可能产生重复消息。请核查企业微信后再确认。",
                        )
                      }}
                    </p>
                    <div class="inline-actions">
                      <button :disabled="busy" @click="unknownRetryId = ''">
                        {{ t("取消") }}</button
                      ><button
                        :disabled="demo || busy || dirty"
                        @click="retry(delivery.id, true)"
                      >
                        {{ t("确认重发") }}
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
              <tr v-if="!state?.deliveries.length">
                <td colspan="6" class="empty-row">{{ t("暂无投递记录。") }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.wecom-notification-settings {
  display: grid;
  gap: 16px;
}
.notification-heading,
.notification-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.notification-heading h2,
.notification-heading h3 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
}
.notification-heading p {
  margin: 5px 0 0;
  font-size: 13px;
}
.notification-config,
.notification-members,
.notification-deliveries {
  padding: 18px;
  min-width: 0;
}
.notification-config > .muted {
  margin: 10px 0 15px;
  font-size: 13px;
}
.notification-check {
  display: inline-flex;
  align-items: center;
  flex-direction: row;
  gap: 7px;
  font-size: 13px;
}
.notification-check input,
.check-column input {
  width: 15px;
  height: 15px;
  margin: 0;
}
.notification-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 0;
  margin: 0;
  border: 0;
}
.notification-fields label {
  display: grid;
  gap: 5px;
  font-size: 13px;
  min-width: 0;
}
.notification-fields input {
  width: 100%;
  min-height: 34px;
}
.notification-fields small {
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}
.full-width {
  grid-column: 1 / -1;
}
.notification-footer {
  margin-top: 14px;
}
.inline-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.inline-actions button,
.notification-heading > button {
  min-height: 32px;
  font-size: 13px;
  white-space: nowrap;
}
.notice {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 9px 11px;
  margin: 0;
  font-size: 13px;
  background: var(--surface-raised);
}
.notification-members > .notice {
  margin-top: 12px;
}
.member-search {
  width: min(100%, 340px);
  margin: 12px 0 8px;
  min-height: 32px;
  font-size: 13px;
}
.notification-table-scroll {
  max-width: 100%;
  overflow-x: auto;
}
.notification-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 13px;
}
.notification-table th,
.notification-table td {
  text-align: left;
  padding: 8px 9px;
  vertical-align: top;
  border-bottom: 1px solid var(--border);
}
.notification-table thead th {
  color: var(--muted);
  background: var(--surface-subtle);
  font-weight: 500;
  white-space: nowrap;
}
.notification-table tbody th {
  font-weight: 500;
}
.notification-table tbody tr:last-child > * {
  border-bottom: 0;
}
.notification-table .check-column {
  width: 30px;
  padding-left: 4px;
  padding-right: 4px;
  text-align: center;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  font-size: 12px;
}
.status.neutral {
  color: var(--muted);
}
.status.success {
  color: var(--status-done);
}
.status.warning,
.notice.warning {
  color: var(--status-blocked);
}
.status.danger {
  color: var(--danger);
}
.status.info {
  color: var(--status-in-progress);
}
.notification-table .reason-cell {
  min-width: 180px;
  max-width: 340px;
  overflow-wrap: anywhere;
}
.reason-cell > .text-button {
  padding: 0 0 0 8px;
  font-size: 12px;
  min-height: 0;
}
.notification-table .empty-row {
  padding: 22px 10px;
  color: var(--muted);
  text-align: center;
}
.notification-deliveries .notification-heading {
  margin-bottom: 12px;
}
.delivery-title {
  max-width: 240px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.time-cell {
  white-space: nowrap;
  color: var(--muted);
}
.unknown-confirm {
  margin-top: 8px;
  border: 1px solid var(--status-blocked-border);
  background: var(--status-blocked-bg);
  border-radius: 6px;
  padding: 9px;
}
.unknown-confirm p {
  font-size: 12px;
  margin: 0 0 8px;
}
@media (max-width: 720px) {
  .notification-heading {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .notification-fields {
    grid-template-columns: 1fr;
  }
  .notification-config,
  .notification-members,
  .notification-deliveries {
    padding: 12px;
  }
  .notification-footer {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .notification-table {
    min-width: 720px;
  }
}
</style>
