<script setup lang="ts">
import { t } from "../locales";
import type { Task } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { formatDate } from "../locales";
import { statusLabels } from "../locales/en";
import TaskVoidAction from "./TaskVoidAction.vue";
defineProps<{ tasks: Task[] }>();
const store = useWorkspace();
</script>
<template>
  <div class="voided-task-list">
    <p class="muted">
      {{
        t(
          "作废记录保留原任务内容，不计入工作量。同批作废的父子任务将一起恢复。",
        )
      }}
    </p>
    <p v-if="!tasks.length" class="empty compact">
      {{ t("没有已作废的任务") }}
    </p>
    <table v-else :aria-label="t('已作废任务')">
      <thead>
        <tr>
          <th>{{ t("任务") }}</th>
          <th>{{ t("项目") }}</th>
          <th>{{ t("作废原因") }}</th>
          <th>{{ t("操作人 / 时间") }}</th>
          <th>{{ t("操作") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.id">
          <td>
            <details>
              <summary>{{ task.title }}</summary>
              <p>{{ task.description || t("无补充描述") }}</p>
              <small
                >{{ t("原状态：") }}{{ statusLabels[task.status] }}
                {{ t("· 负责人：") }}{{ task.assignee || t("未分配") }}</small
              >
            </details>
          </td>
          <td>
            {{ store.data.projects.find((p) => p.id === task.projectId)?.name }}
          </td>
          <td>{{ task.voided?.reason }}</td>
          <td>
            {{ task.voided?.actor
            }}<small>{{
              task.voided &&
              formatDate(task.voided.at, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            }}</small>
          </td>
          <td><TaskVoidAction :task="task" /></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
<style scoped>
.voided-task-list {
  overflow-x: auto;
}
.voided-task-list > p {
  font-size: 12px;
  margin: 8px 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
}
th,
td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
th {
  color: var(--muted);
  background: var(--surface-raised);
}
th:first-child {
  width: 38%;
}
th:last-child {
  width: 64px;
}
small {
  display: block;
  color: var(--muted);
  margin-top: 3px;
}
summary {
  cursor: pointer;
  overflow-wrap: anywhere;
}
details p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  table {
    min-width: 700px;
  }
}
</style>
