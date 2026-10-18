<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  PhBell,
  PhBellSlash,
  PhCheck,
  PhClock,
  PhGearSix,
  PhArrowRight,
  PhArrowClockwise,
  PhWarningCircle,
  PhCheckCircle,
} from "@phosphor-icons/vue";
import type {
  NotificationItem,
  NotificationPreferences,
} from "../../../../packages/domain/notifications";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { safeNotificationPath } from "../services/contracts";
import { formatDate, t } from "../locales";
import WorkspaceDialog from "./WorkspaceDialog.vue";
import TaskDetailPanel from "./TaskDetailPanel.vue";

const store = useWorkspace();
const router = useRouter();
const route = useRoute();
const open = ref(false);
const section = ref<"pending" | "updates" | "handled">("pending");
const settingsOpen = ref(false);
const settingsDraft = ref<NotificationPreferences | null>(null);
const settingsSaved = ref(false);
const openingId = ref("");
const openingError = ref("");
const showSnoozed = ref(false);
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 30000);
onBeforeUnmount(() => clearInterval(clock));

const items = computed(() => store.notifications?.items ?? []);
const pending = computed(() =>
  items.value.filter((item) => !item.resolvedAt && item.actionable),
);
const updates = computed(() =>
  items.value.filter(
    (item) => !item.resolvedAt && !item.actionable && !item.readAt,
  ),
);
const handled = computed(() =>
  items.value.filter(
    (item) => !!item.resolvedAt || (!item.actionable && !!item.readAt),
  ),
);
function snoozed(item: NotificationItem) {
  return !!item.snoozedUntil && Date.parse(item.snoozedUntil) > now.value;
}
const later = computed(() => pending.value.filter(snoozed));
const visible = computed(() => {
  const source =
    section.value === "pending"
      ? pending.value.filter((item) => !snoozed(item) || showSnoozed.value)
      : section.value === "updates"
        ? updates.value
        : handled.value;
  const priority = { critical: 0, warning: 1, info: 2, neutral: 3 };
  return [...source].sort((left, right) => {
    if (section.value === "pending") {
      if (snoozed(left) !== snoozed(right)) return snoozed(left) ? 1 : -1;
      if (priority[left.severity] !== priority[right.severity])
        return priority[left.severity] - priority[right.severity];
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
});
const transientReviews = computed(() =>
  Object.entries(store.taskReviews)
    .filter(
      ([id, review]) =>
        review.status === "ready" &&
        review.result?.questions.length &&
        store.data.tasks.some(
          (task) =>
            task.id === id && task.version === review.version && !task.voided,
        ),
    )
    .map(([id]) => store.data.tasks.find((task) => task.id === id)!),
);
const detailId = computed(() =>
  typeof route.query.task === "string" ? route.query.task : "",
);
const unread = computed(() => store.notifications?.unreadCount ?? 0);
const pendingCount = computed(() => store.notifications?.pendingCount ?? 0);
const busy = computed(() => store.notificationBusy || !!openingId.value);
const bellLabel = computed(() =>
  t("消息提醒{p0}{p1}", {
    p0: unread.value ? t("，{p0} 条未读", { p0: unread.value }) : "",
    p1: pendingCount.value
      ? t("，{p0} 项待处理", { p0: pendingCount.value })
      : "",
  }),
);
watch(open, (value) => {
  if (value) {
    openingError.value = "";
    void store.refreshNotifications();
  } else settingsOpen.value = false;
});
watch(
  () => store.user?.id,
  () => {
    open.value = false;
    openingError.value = "";
    openingId.value = "";
  },
);
function projectName(item: NotificationItem) {
  return (
    store.data.projects.find((project) => project.id === item.projectId)
      ?.name ?? t("工作区")
  );
}
function timestamp(value: string) {
  return formatDate(value, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function stateLabel(item: NotificationItem) {
  if (item.resolvedAt) return item.actionable ? t("已处理") : t("已读");
  if (snoozed(item)) return t("稍后提醒");
  if (item.kind === "project_metadata") return t("资料待补");
  if (item.severity === "critical") return t("需要处理");
  if (item.severity === "warning") return t("需要关注");
  return item.readAt ? t("已读") : t("新动态");
}
function recipientReason(item: NotificationItem) {
  if (item.resolvedAt || item.kind !== "task_risk") return "";
  const task = store.data.tasks.find((task) => task.id === item.taskId);
  if (!task) return "";
  if (task.assigneeId === store.user?.id) return t("你是任务负责人 · ");
  const project = store.data.projects.find(
    (project) => project.id === task.projectId,
  );
  return !task.assigneeId && project?.ownerId === store.user?.id
    ? t("你是项目负责人 · ")
    : "";
}
function actionLabel(item: NotificationItem) {
  if (item.resolvedAt) return t("查看当前状态");
  if (item.kind === "project_metadata") return t("补齐信息");
  if (item.kind === "capture_confirmation") return t("核对内容");
  return item.actionable ? t("查看并处理") : t("查看动态");
}
async function openItem(item: NotificationItem) {
  if (busy.value) return;
  openingId.value = item.id;
  openingError.value = "";
  try {
    const result = await api.openNotification(item.id);
    const path = safeNotificationPath(result.path);
    await store.changeNotifications({ ids: [item.id], action: "read" });
    open.value = false;
    await router.push(path);
  } catch (reason) {
    openingError.value = (reason as Error).message;
  } finally {
    openingId.value = "";
  }
}
async function readAll() {
  let ids = items.value
    .filter((item) => !item.readAt && !item.resolvedAt)
    .map((item) => item.id);
  while (ids.length) {
    if (
      !(await store.changeNotifications({
        ids: ids.slice(0, 500),
        action: "read",
      }))
    )
      return;
    ids = ids.slice(500);
  }
}
async function snooze(item: NotificationItem) {
  await store.changeNotifications({
    ids: [item.id],
    action: "snooze",
    until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
}
function editPreferences() {
  if (!store.notifications) return;
  settingsDraft.value = { ...store.notifications.preferences };
  settingsSaved.value = false;
  settingsOpen.value = true;
}
async function savePreferences() {
  if (!settingsDraft.value) return;
  if (await store.saveNotificationPreferences(settingsDraft.value)) {
    settingsDraft.value = { ...store.notifications!.preferences };
    settingsSaved.value = true;
  }
}
function closeTask() {
  void router.replace({ query: { ...route.query, task: undefined } });
}
async function openReview(id: string, projectId: string) {
  open.value = false;
  await router.push({
    path: `/projects/${encodeURIComponent(projectId)}`,
    query: { task: id },
  });
}
</script>

<template>
  <button
    type="button"
    class="icon-button notification-trigger"
    :aria-label="bellLabel"
    :aria-expanded="open"
    aria-haspopup="dialog"
    :title="store.notificationError ? t('提醒读取失败，点击重试') : bellLabel"
    @click="open = true"
  >
    <PhBell :size="20" />
    <span v-if="unread" class="notification-dot" aria-hidden="true"></span>
    <span
      v-else-if="store.notificationError"
      class="notification-error-dot"
      aria-hidden="true"
      >!</span
    >
  </button>
  <WorkspaceDialog
    :open="open"
    :title="t('消息提醒')"
    variant="drawer"
    @close="open = false"
  >
    <div class="notification-toolbar">
      <p>
        <span class="unread-summary">{{ t("未读") }} {{ unread }}</span
        ><span>{{ t("待处理") }} {{ pendingCount }}</span>
      </p>
      <div>
        <button
          class="icon-button"
          :aria-label="t('刷新提醒')"
          :disabled="store.notificationLoading || busy"
          @click="store.refreshNotifications()"
        >
          <PhArrowClockwise
            :size="17"
            :class="{ spin: store.notificationLoading }"
          />
        </button>
        <button
          class="icon-button"
          :aria-label="t('提醒设置')"
          :disabled="!store.notifications"
          :aria-expanded="settingsOpen"
          @click="settingsOpen ? (settingsOpen = false) : editPreferences()"
        >
          <PhGearSix :size="18" />
        </button>
      </div>
    </div>
    <p
      v-if="store.notificationError || openingError"
      class="error-box notification-error"
      role="alert"
    >
      <span>{{ t(openingError || store.notificationError) }}</span>
      <button
        :disabled="busy"
        @click="
          openingError = '';
          store.refreshNotifications();
        "
      >
        {{ t("重试") }}
      </button>
    </p>
    <form
      v-if="settingsOpen && settingsDraft"
      class="notification-settings"
      @submit.prevent="savePreferences"
    >
      <h3>{{ t("通知方式") }}</h3>
      <label
        >{{ t("企业微信") }}
        <select
          v-model="settingsDraft.delivery"
          :disabled="store.notificationBusy"
          @change="settingsSaved = false"
        >
          <option value="in_app">{{ t("仅站内提醒") }}</option>
          <option value="important">{{ t("关键提醒") }}</option>
          <option value="digest">{{ t("每日摘要") }}</option>
          <option value="muted">{{ t("暂停企业微信通知") }}</option>
        </select>
      </label>
      <p
        v-if="store.notifications?.deliveryStatus?.reason"
        class="delivery-status"
      >
        <PhBellSlash :size="15" />{{
          store.notifications.deliveryStatus.reason
        }}
      </p>
      <div class="quiet-hours">
        <label
          >{{ t("安静时段开始")
          }}<input
            v-model="settingsDraft.quietStart"
            type="time"
            required
            @input="settingsSaved = false"
        /></label>
        <label
          >{{ t("结束")
          }}<input
            v-model="settingsDraft.quietEnd"
            type="time"
            required
            @input="settingsSaved = false"
        /></label>
      </div>
      <label v-if="settingsDraft.delivery === 'digest'"
        >{{ t("摘要时间")
        }}<input
          v-model="settingsDraft.digestTime"
          type="time"
          required
          @input="settingsSaved = false"
      /></label>
      <p class="settings-help">
        {{ t("按") }}
        {{ store.notifications?.timeZone ?? store.timeZone }}
        {{ t("计时；开始与结束相同表示关闭安静时段。站内事项始终保留。") }}
      </p>
      <div class="settings-actions">
        <span v-if="settingsSaved" role="status"
          ><PhCheck :size="15" />{{ t("已保存") }}</span
        ><button
          class="primary"
          type="submit"
          :disabled="store.notificationBusy"
        >
          {{ store.notificationBusy ? t("保存中…") : t("保存设置") }}
        </button>
      </div>
    </form>
    <nav class="notification-tabs" :aria-label="t('提醒分类')">
      <button
        :class="{ active: section === 'pending' }"
        :aria-pressed="section === 'pending'"
        @click="section = 'pending'"
      >
        {{ t("待我处理") }} <span>{{ pendingCount }}</span>
      </button>
      <button
        :class="{ active: section === 'updates' }"
        :aria-pressed="section === 'updates'"
        @click="section = 'updates'"
      >
        {{ t("项目动态") }} <span>{{ updates.length }}</span>
      </button>
      <button
        :class="{ active: section === 'handled' }"
        :aria-pressed="section === 'handled'"
        @click="section = 'handled'"
      >
        {{ t("已处理") }} <span>{{ handled.length }}</span>
      </button>
    </nav>
    <div class="notification-list-toolbar">
      <p>
        {{
          section === "pending"
            ? t("已读后仍保留，处理事项后自动更新。")
            : section === "updates"
              ? t("与你有关的变化，查看后归入已处理。")
              : t("保留处理与阅读记录，可查看当前状态。")
        }}
      </p>
      <button class="text-button" :disabled="!unread || busy" @click="readAll">
        {{ t("全部已读") }}
      </button>
    </div>
    <section
      v-if="section === 'pending' && transientReviews.length"
      class="transient-confirmations"
    >
      <strong>{{ t("本次录入待确认") }} {{ transientReviews.length }}</strong>
      <p>{{ t("核对 AI 提出的负责人或时间；仅当前页面可见。") }}</p>
      <button
        v-for="task in transientReviews"
        :key="task.id"
        class="text-button"
        @click="openReview(task.id, task.projectId)"
      >
        {{ task.title }}<PhArrowRight :size="14" />
      </button>
    </section>
    <button
      v-if="section === 'pending' && later.length"
      class="text-button later-toggle"
      :aria-expanded="showSnoozed"
      @click="showSnoozed = !showSnoozed"
    >
      <PhClock :size="15" />{{ t("稍后提醒") }} {{ later.length }}
      {{ t("项 ·") }}
      {{ showSnoozed ? t("收起") : t("展开") }}
    </button>
    <p
      v-if="store.notificationLoading && !store.notifications"
      class="notification-empty"
      role="status"
    >
      {{ t("正在读取提醒…") }}
    </p>
    <div
      v-else-if="!visible.length && !store.notificationError"
      class="notification-empty"
      role="status"
    >
      <PhCheckCircle v-if="section === 'pending'" :size="30" />
      <PhBell v-else :size="30" />
      <strong>{{
        section === "pending"
          ? t("当前没有需要处理的事项")
          : section === "updates"
            ? t("暂无未读项目动态")
            : t("暂无已处理记录")
      }}</strong>
      <p>
        {{
          section === "pending" && later.length
            ? t("{p0} 项稍后提醒会在到点后重新出现。", { p0: later.length })
            : t("新的提醒会自动出现在这里。")
        }}
      </p>
    </div>
    <ol v-else class="notification-list">
      <li
        v-for="item in visible"
        :key="item.id"
        class="notification-item"
        :class="[
          item.resolvedAt ? 'resolved' : item.severity,
          { unread: !item.readAt && !item.resolvedAt, snoozed: snoozed(item) },
        ]"
      >
        <div class="notification-context">
          <span>{{ projectName(item) }}</span
          ><time :datetime="item.updatedAt">{{
            timestamp(item.updatedAt)
          }}</time>
        </div>
        <div class="notification-title">
          <h3>{{ item.title }}</h3>
          <span class="notification-state"
            ><PhWarningCircle
              v-if="
                !item.resolvedAt &&
                ['critical', 'warning'].includes(item.severity)
              "
              :size="14"
            />{{ stateLabel(item) }}</span
          >
        </div>
        <p class="notification-reason">
          {{ recipientReason(item)
          }}{{
            item.actionable &&
            ["task_risk", "project_metadata"].includes(item.kind)
              ? item.reasons.map((reason) => t(reason)).join("; ")
              : item.actionable
                ? t(item.reason)
                : item.body
          }}
        </p>
        <p v-if="snoozed(item)" class="notification-time">
          <PhClock :size="14" />{{ timestamp(item.snoozedUntil!) }}
          {{ t("再提醒") }}
        </p>
        <p v-if="item.resolvedAt" class="notification-time">
          {{ timestamp(item.resolvedAt) }} ·
          {{ item.actionable ? t("条件已解除") : t("已阅读") }}
        </p>
        <div class="notification-actions">
          <button
            class="text-button open-notification"
            :disabled="busy"
            @click="openItem(item)"
          >
            {{ openingId === item.id ? t("正在打开…") : actionLabel(item)
            }}<PhArrowRight :size="14" />
          </button>
          <div>
            <button
              v-if="!item.resolvedAt && !item.readAt"
              class="text-button"
              :disabled="busy"
              @click="
                store.changeNotifications({ ids: [item.id], action: 'read' })
              "
            >
              {{ t("标为已读") }}
            </button>
            <button
              v-else-if="!item.resolvedAt && item.actionable && item.readAt"
              class="text-button"
              :disabled="busy"
              @click="
                store.changeNotifications({ ids: [item.id], action: 'unread' })
              "
            >
              {{ t("标为未读") }}
            </button>
            <button
              v-if="!item.resolvedAt && item.actionable"
              class="text-button"
              :disabled="busy"
              @click="
                snoozed(item)
                  ? store.changeNotifications({
                      ids: [item.id],
                      action: 'unsnooze',
                    })
                  : snooze(item)
              "
            >
              {{ snoozed(item) ? t("恢复提醒") : t("稍后 1 小时") }}
            </button>
          </div>
        </div>
      </li>
    </ol>
    <p v-if="store.notifications" class="notification-footnote">
      {{ t("个人提醒 ·") }} {{ store.notifications.timeZone }}
      {{ t("· 工作区概览保留团队汇总") }}
    </p>
  </WorkspaceDialog>
  <TaskDetailPanel v-if="detailId" :task-id="detailId" @close="closeTask" />
</template>

<style scoped>
.notification-trigger {
  position: relative;
  flex: none;
}
.notification-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 7px;
  height: 7px;
  background: var(--blue);
  border: 2px solid var(--surface);
  border-radius: 50%;
}
.notification-error-dot {
  position: absolute;
  top: 1px;
  right: 1px;
  color: var(--status-blocked);
  font-size: 11px;
  font-weight: 700;
}
.notification-toolbar,
.notification-toolbar > div,
.notification-toolbar p,
.notification-list-toolbar,
.notification-actions,
.notification-actions > div,
.notification-context,
.notification-title,
.notification-state,
.notification-time,
.settings-actions,
.settings-actions > span {
  display: flex;
  align-items: center;
  gap: 10px;
}
.notification-toolbar {
  justify-content: space-between;
  margin: -4px 0 12px;
}
.notification-toolbar p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.unread-summary {
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 9%, var(--surface));
  border-radius: 5px;
  padding: 3px 7px;
}
.notification-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 12px;
}
.notification-error button {
  flex: none;
}
.notification-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}
.notification-tabs button {
  flex: 1;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  border-radius: 0;
  padding: 10px 4px;
  min-height: 42px;
  font-size: 13px;
  white-space: nowrap;
  color: var(--muted);
}
.notification-tabs button.active {
  border-bottom-color: var(--accent);
  color: var(--accent);
}
.notification-tabs span {
  font-size: 11px;
  margin-left: 3px;
  font-variant-numeric: tabular-nums;
}
.notification-list-toolbar {
  justify-content: space-between;
  margin: 10px 0;
  align-items: flex-start;
}
.notification-list-toolbar p {
  color: var(--muted);
  font-size: 11px;
  margin: 4px 0 0;
  line-height: 1.5;
}
.notification-list-toolbar button {
  white-space: nowrap;
  flex: none;
  font-size: 12px;
  min-height: 30px;
}
.notification-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.notification-item {
  padding: 13px 12px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
  border-radius: 7px;
  margin-bottom: 9px;
  background: var(--surface);
}
.notification-item.warning {
  border-left-color: var(--status-blocked);
}
.notification-item.critical {
  border-left-color: var(--danger);
}
.notification-item.info {
  border-left-color: var(--blue);
}
.notification-context {
  justify-content: space-between;
  color: var(--muted);
  font-size: 11px;
  margin-bottom: 7px;
  align-items: flex-start;
}
.notification-context > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.notification-context time {
  white-space: nowrap;
  flex: none;
}
.notification-title {
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.notification-title h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  min-width: 0;
  overflow-wrap: anywhere;
}
.unread .notification-title h3::before {
  content: "";
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--blue);
  margin: 0 6px 2px 0;
}
.notification-state {
  gap: 3px;
  font-size: 10px;
  color: var(--muted);
  flex: none;
  padding-top: 3px;
}
.critical .notification-state {
  color: var(--danger);
}
.warning .notification-state {
  color: var(--status-blocked);
}
.notification-reason {
  font-size: 12px;
  line-height: 1.6;
  margin: 5px 0 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--muted);
}
.notification-time {
  margin: 5px 0 8px;
  font-size: 11px;
  color: var(--muted);
  gap: 4px;
}
.notification-actions {
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 4px;
}
.notification-actions > div {
  gap: 9px;
  flex-wrap: wrap;
}
.notification-actions button {
  font-size: 11px;
  min-height: 30px;
  padding: 2px 0;
}
.notification-actions > div button {
  color: var(--muted);
}
.notification-actions .open-notification {
  font-weight: 600;
  gap: 4px;
}
.notification-item.resolved,
.notification-item.snoozed {
  background: var(--surface-subtle);
}
.notification-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  text-align: center;
  padding: 40px 12px;
  font-size: 13px;
}
.notification-empty svg {
  color: var(--accent);
}
.notification-empty strong {
  font-weight: 500;
  color: var(--text);
}
.notification-empty p {
  margin: 0;
  font-size: 12px;
}
.notification-footnote {
  text-align: center;
  color: var(--muted);
  font-size: 10px;
  padding: 8px 0 0;
}
.notification-settings {
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 13px;
  margin: 0 0 16px;
}
.notification-settings h3 {
  margin: 0 0 12px;
  font-size: 14px;
}
.notification-settings label {
  font-size: 12px;
  gap: 6px;
}
.notification-settings select,
.notification-settings input {
  min-height: 36px;
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
  box-sizing: border-box;
}
.quiet-hours {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 12px 0;
}
.delivery-status,
.settings-help {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.6;
  margin: 8px 0;
}
.delivery-status {
  display: flex;
  gap: 5px;
  align-items: flex-start;
}
.delivery-status svg {
  flex: none;
  margin-top: 2px;
}
.settings-actions {
  justify-content: flex-end;
}
.settings-actions button {
  min-height: 34px;
  font-size: 12px;
  padding: 6px 10px;
}
.settings-actions > span {
  color: var(--accent);
  font-size: 12px;
  gap: 3px;
}
.later-toggle {
  font-size: 12px;
  margin: 0 0 10px;
}
.transient-confirmations {
  border: 1px solid var(--border);
  background: var(--surface-subtle);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 10px;
  font-size: 12px;
}
.transient-confirmations strong {
  color: var(--stage-lead);
}
.transient-confirmations p {
  margin: 4px 0;
  color: var(--muted);
  font-size: 11px;
}
.transient-confirmations button {
  display: flex;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
  text-align: left;
  min-height: 36px;
}
@media (max-width: 600px) {
  .notification-trigger {
    min-width: 36px;
    width: 36px;
  }
  .notification-tabs button {
    font-size: 13px;
    min-height: 44px;
  }
  .notification-list-toolbar {
    gap: 5px;
  }
  .notification-item {
    padding: 12px 10px;
  }
  .notification-title {
    flex-wrap: wrap;
    gap: 2px 8px;
  }
  .notification-actions {
    gap: 2px 10px;
  }
  .notification-actions button,
  .later-toggle {
    min-height: 40px;
    font-size: 12px;
  }
  .notification-actions > div {
    gap: 14px;
  }
}
</style>
