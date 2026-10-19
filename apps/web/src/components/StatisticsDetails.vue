<script setup lang="ts">
import { t } from "../locales";
import { computed, ref, watch } from "vue";
import {
  ElTable,
  ElTableColumn,
  ElPagination,
  ElSelect,
  ElOption,
} from "element-plus";
import type { StatisticsGroup } from "../../../../packages/domain/people-project-statistics";
import { statisticsTasks } from "../../../../packages/domain/people-project-statistics";
import { taskIsOverdue } from "../../../../packages/domain/task-view";
const props = defineProps<{
  group: StatisticsGroup;
  kind: string;
  mobile?: boolean;
  today: string;
  stages: Record<string, string>;
}>();
const emit = defineEmits<{
  task: [id: string];
  project: [id: string];
  back: [];
}>();
const statusNames: Record<string, string> = {
  todo: "待办",
  in_progress: "进行中",
  blocked: "待协调",
  done: "已完成",
};
const page = ref(1),
  sort = ref("open");
watch(
  () => [props.group.key, props.kind],
  () => {
    page.value = 1;
    sort.value = "open";
  },
);
const labels: Record<string, string> = {
  total: "全部任务",
  open: "未完成",
  done: "已完成",
  blocked: "待协调",
  overdue: "明确逾期",
};
const projects = computed(() =>
  props.group.projects
    .map((p) => {
      const tasks = props.group.tasks.filter((t) => t.projectId === p.id);
      return {
        ...p,
        total: tasks.length,
        open: tasks.filter((t) => t.status !== "done").length,
        blocked: tasks.filter((t) => t.status === "blocked").length,
        overdue: tasks.filter((t) => taskIsOverdue(t, props.today)).length,
      };
    })
    .sort((a, b) =>
      sort.value === "stage"
        ? (props.stages[a.stage] || a.stage).localeCompare(
            props.stages[b.stage] || b.stage,
            "zh-CN",
          )
        : b[sort.value as "open"] - a[sort.value as "open"] ||
          a.name.localeCompare(b.name, "zh-CN"),
    ),
);
const tasks = computed(() =>
  statisticsTasks(props.group, props.kind as "open", props.today),
);
const count = computed(() =>
  props.kind === "projects" ? projects.value.length : tasks.value.length,
);
watch(count, (n) => {
  page.value = Math.min(page.value, Math.max(1, Math.ceil(n / 25)));
});
</script>
<template>
  <section class="statistics-detail">
    <h2>
      {{ group.name }} · {{ kind === "projects" ? "项目明细" : labels[kind] }}
    </h2>
    <p>
      {{
        kind === "projects" ? "当前筛选范围内的项目" : "与所点击数量对应的任务"
      }}
      · {{ count }} {{ t("项") }}
    </p>
    <ElSelect
      v-if="kind === 'projects'"
      v-model="sort"
      :aria-label="t('明细排序')"
      style="width: 180px"
    >
      <ElOption
        v-for="item in [
          ['open', '未完成最多'],
          ['total', '任务最多'],
          ['blocked', '待协调最多'],
          ['overdue', '逾期最多'],
          ['stage', '按阶段'],
        ]"
        :key="item[0]"
        :value="item[0]!"
        :label="item[1]"
      />
    </ElSelect>
    <button v-else @click="emit('back')">{{ t("返回项目明细") }}</button>
    <div v-if="mobile" class="mobile-detail-list">
      <template v-if="kind === 'projects'">
        <article
          v-for="p in projects.slice((page - 1) * 25, page * 25)"
          :key="p.id"
        >
          <button class="detail-link" @click="emit('project', p.id)">
            {{ p.name }}
          </button>
          <p>{{ stages[p.stage] || p.stage || "阶段待补" }}</p>
          <p>
            {{
              p.total
                ? "任务 " +
                  p.total +
                  " · 未完成 " +
                  p.open +
                  " · 待协调 " +
                  p.blocked +
                  " · 逾期 " +
                  p.overdue
                : "暂无任务记录"
            }}
          </p>
        </article>
      </template>
      <template v-else>
        <article
          v-for="task in tasks.slice((page - 1) * 25, page * 25)"
          :key="task.id"
        >
          <button class="detail-link" @click="emit('task', task.id)">
            {{ task.title }}
          </button>
          <p>
            {{ statusNames[task.status] }} ·
            {{ task.dueDate ? "截止 " + task.dueDate : "未设截止日期" }}
          </p>
        </article>
      </template>
    </div>
    <ElTable
      v-if="!mobile && kind === 'projects'"
      :data="projects.slice((page - 1) * 25, page * 25)"
      row-key="id"
      max-height="520"
      :empty-text="t('暂无项目')"
    >
      <ElTableColumn :label="t('项目')" min-width="160"
        ><template #default="{ row }"
          ><button class="detail-link" @click="emit('project', row.id)">
            {{ row.name }}</button
          ><small v-if="!row.total"> {{ t("暂无任务记录") }} </small></template
        ></ElTableColumn
      >
      <ElTableColumn :label="t('阶段')" width="100"
        ><template #default="{ row }">{{
          stages[row.stage] || row.stage || "阶段待补"
        }}</template></ElTableColumn
      >
      <ElTableColumn
        prop="total"
        :label="t('任务')"
        width="65"
        align="right"
      /><ElTableColumn
        prop="open"
        :label="t('未完成')"
        width="80"
        align="right"
      /><ElTableColumn
        prop="blocked"
        :label="t('待协调')"
        width="80"
        align="right"
      /><ElTableColumn
        prop="overdue"
        :label="t('逾期')"
        width="65"
        align="right"
      />
    </ElTable>
    <ElTable
      v-else-if="!mobile"
      :data="tasks.slice((page - 1) * 25, page * 25)"
      row-key="id"
      max-height="520"
      :empty-text="t('暂无对应任务')"
    >
      <ElTableColumn :label="t('任务')" min-width="180"
        ><template #default="{ row }"
          ><button class="detail-link" @click="emit('task', row.id)">
            {{ row.title }}
          </button></template
        ></ElTableColumn
      >
      <ElTableColumn :label="t('状态')" width="90"
        ><template #default="{ row }">{{
          statusNames[row.status]
        }}</template></ElTableColumn
      >
      <ElTableColumn prop="dueDate" :label="t('截止日期')" width="120" />
    </ElTable>
    <ElPagination
      v-model:current-page="page"
      :total="count"
      :page-size="25"
      layout="prev, pager, next"
      small
    />
    <small>
      {{ t("当前展示") }} {{ count ? (page - 1) * 25 + 1 : 0 }}–{{
        Math.min(page * 25, count)
      }}
      / {{ count }} {{ t("项") }}
    </small>
  </section>
</template>
<style scoped>
.detail-link {
  border: 0;
  background: transparent;
  color: var(--accent);
  padding: 4px 0;
  text-align: left;
  white-space: normal;
}
small {
  display: block;
  color: var(--muted);
}
h2 {
  font-size: 18px;
}
.statistics-detail {
  min-width: 0;
}
.el-pagination {
  margin-top: 12px;
}

h2 {
  font-size: 16px;
  margin: 0 0 6px;
}
p {
  font-size: 12px;
  color: var(--muted);
  margin: 4px 0 8px;
}
:deep(.el-table .el-table__cell) {
  padding: 3px 0;
}
.detail-link {
  min-height: 28px;
}
@media (max-width: 600px) {
  :deep(.el-table .cell) {
    padding: 0 4px;
    font-size: 12px;
  }
  .detail-link {
    min-height: 44px;
  }
  .el-pagination {
    margin-top: 8px;
  }
}
.mobile-detail-list article {
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.mobile-detail-list .detail-link {
  display: block;
  width: 100%;
  text-align: left;
  overflow-wrap: anywhere;
}
.mobile-detail-list p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  white-space: normal;
}
</style>
