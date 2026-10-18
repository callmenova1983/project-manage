<script setup lang="ts">
import { t } from "../locales";
import { PhArrowUpRight, PhCheckCircle, PhClock } from "@phosphor-icons/vue";
import {
  resultLocation,
  type CaptureResult,
} from "../services/capture-results";
import StatusBadge from "./StatusBadge.vue";
defineProps<{ rows: CaptureResult[]; inactive?: boolean }>();
const labels = {
  project: t("新建项目"),
  task: t("新增任务"),
  update: t("进展日志"),
  skipped: t("暂不处理"),
  pending: t("待归类"),
};
</script>

<template>
  <div
    v-if="rows.length"
    class="capture-results"
    role="region"
    :aria-label="t('处理明细')"
    tabindex="0"
  >
    <table>
      <caption>
        {{
          t("处理明细 ·")
        }}
        {{
          rows.length
        }}
        {{
          t("条")
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t("归入项目") }}</th>
          <th scope="col">{{ t("处理内容") }}</th>
          <th scope="col">{{ t("结果") }}</th>
          <th scope="col">
            <span class="sr-only">{{ t("查看记录") }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key">
          <td class="result-project">
            <RouterLink
              v-if="row.projectId && !inactive"
              :to="`/projects/${encodeURIComponent(row.projectId)}`"
              >{{ row.projectName }}</RouterLink
            >
            <span v-else>{{ t(row.projectName) }}</span>
          </td>
          <td>
            <div class="result-content">
              <span class="result-kind" :class="row.kind">{{
                row.linked
                  ? t("关联已有任务")
                  : row.dailyReport && row.kind === "update"
                    ? t("日报进展")
                    : t(labels[row.kind])
              }}</span
              ><span class="result-title">{{ row.title }}</span>
            </div>
            <div v-if="row.dailyReport" class="result-attribution">
              <span v-if="row.assignee"
                >{{ row.kind === "task" ? t("负责人") : t("执行人") }}：{{
                  row.assignee
                }}</span
              >
              <span v-if="row.reporter && row.reporter !== row.assignee"
                >{{ t("汇报人") }}：{{ row.reporter }}</span
              >
              <span v-if="row.workDate"
                >{{ t("日报日期") }}：{{ row.workDate }}</span
              >
            </div>
          </td>
          <td class="result-state">
            <span v-if="inactive" class="muted">{{ t("已撤销") }}</span>
            <span v-else-if="row.linked" class="result-saved"
              ><PhCheckCircle :size="14" />{{ t("已关联") }}</span
            >
            <StatusBadge v-else-if="row.status" :status="row.status" />
            <span
              v-else-if="row.kind === 'skipped' || row.kind === 'pending'"
              class="result-waiting"
              ><PhClock :size="14" />{{
                row.kind === "skipped" ? t("未写入") : t("待归类")
              }}</span
            >
            <span v-else class="result-saved"
              ><PhCheckCircle :size="14" />{{
                row.kind === "project" ? t("已创建") : t("已记录")
              }}</span
            >
          </td>
          <td class="result-action">
            <RouterLink
              v-if="resultLocation(row) && !inactive && row.kind !== 'skipped'"
              :to="resultLocation(row)!"
              :aria-label="
                t('查看{p0}：{p1}', { p0: t(labels[row.kind]), p1: row.title })
              "
              :title="t('查看记录')"
              ><PhArrowUpRight :size="16"
            /></RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.capture-results {
  margin-top: 12px;
  overflow: auto;
  max-height: 360px;
  border: 1px solid var(--border);
  border-radius: 6px;
  text-align: left;
}
table {
  width: 100%;
  min-width: 520px;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 13px;
}
caption {
  text-align: left;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  background: var(--surface);
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface-subtle);
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
}
th,
td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
tr:last-child td {
  border-bottom: 0;
}
.result-project {
  width: 18%;
  min-width: 100px;
  overflow-wrap: anywhere;
}
a {
  color: var(--accent);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
.result-content {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.result-kind {
  flex: none;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
  background: var(--accent-bg);
  color: var(--accent);
}
.result-kind.update {
  color: var(--muted);
  background: var(--surface-subtle);
}
.result-kind.skipped,
.result-kind.pending {
  color: var(--muted);
  background: var(--surface-subtle);
}
.result-title {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
  line-height: 1.5;
}
.result-attribution {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 5px;
  color: var(--muted);
  font-size: 12px;
}
.result-state {
  width: 92px;
  white-space: nowrap;
}
.result-saved,
.result-waiting {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.result-saved {
  color: var(--accent);
}
.result-waiting {
  color: var(--muted);
}
.result-action {
  width: 28px;
}
.result-action a {
  display: inline-flex;
  padding: 2px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
