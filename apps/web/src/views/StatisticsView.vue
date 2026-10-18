<script setup lang="ts">
import {
  computed,
  ref,
  shallowRef,
  watch,
  onBeforeUnmount,
  onMounted,
  nextTick,
  watchPostEffect,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ElTable,
  ElTableColumn,
  ElInput,
  ElSelect,
  ElOption,
  ElTag,
  ElPagination,
  ElCheckbox,
  ElDrawer,
  ElConfigProvider,
} from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/select/style/css";
import "element-plus/es/components/tag/style/css";
import "element-plus/es/components/pagination/style/css";
import "element-plus/es/components/checkbox/style/css";
import "element-plus/es/components/drawer/style/css";
import {
  projectStatistics,
  type StatisticsGroup,
} from "../../../../packages/domain/people-project-statistics";
import {
  defaultStatisticsQuery,
  type StatisticsQuery,
} from "../../../../packages/domain/statistics-query";
import {
  defaultStatisticsPreferences,
  readStatisticsPreferences,
  writeStatisticsPreferences,
  parseStatisticsLink,
  statisticsLinkQuery,
} from "../services/statistics-preferences";
import { accountStorageKey } from "../services/account-storage";
import { useWorkspace } from "../stores/workspace";
import { dayKey } from "../../../../packages/domain/types";
import { useCalendarNow } from "../composables/calendar";
import StatisticsDetails from "../components/StatisticsDetails.vue";
import TaskDetailPanel from "../components/TaskDetailPanel.vue";
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
const store = useWorkspace(),
  route = useRoute(),
  router = useRouter(),
  now = useCalendarNow();
const preferences = ref(defaultStatisticsPreferences()),
  storageError = ref(""),
  queryError = ref("");
const query = ref(defaultStatisticsQuery()),
  search = ref(""),
  composing = ref(false);
const page = ref(1),
  selected = ref(""),
  detailKind = ref("projects"),
  taskId = ref(""),
  notice = ref("");
const mobileFilters = ref(false);
const viewName = ref(""),
  small = ref(false),
  drawer = ref(false),
  root = ref<HTMLElement>();
const acceptedAt = ref(store.lastSynced),
  acceptedNow = ref(now.value);
const accepted = shallowRef(store.data),
  pending = shallowRef<typeof store.data | null>(null);
const keyboardMode = ref(false);
const interacting = ref(false),
  menus = ref(false),
  focusInside = ref(false),
  selecting = ref(false);
const storageKey = computed(() =>
  store.user ? accountStorageKey("statistics", store.mode, store.user) : "",
);
let pointerTimer: ReturnType<typeof setTimeout> | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let restoring = false;
let pushNext = false;
function readStored() {
  preferences.value = defaultStatisticsPreferences();
  storageError.value = "";
  if (storageKey.value) {
    try {
      const result = readStatisticsPreferences(localStorage, storageKey.value);
      preferences.value = result.value;
      storageError.value = result.error;
    } catch {
      storageError.value = "浏览器设置存储不可用。";
    }
  }
}
function restore() {
  restoring = true;
  const raw = route.query.statistics;
  if (raw !== undefined) {
    const result = parseStatisticsLink(raw);
    queryError.value = result.error;
    if (result.query) query.value = result.query;
  } else {
    query.value = clone(preferences.value[preferences.value.lastView]);
    queryError.value = "";
  }
  search.value = query.value.search;
  selected.value =
    typeof route.query.group === "string" ? route.query.group : "";
  page.value = Math.max(
    1,
    Math.min(1000000, Math.floor(Number(route.query.statsPage)) || 1),
  );
  detailKind.value =
    typeof route.query.detail === "string" &&
    ["projects", "total", "open", "done", "blocked", "overdue"].includes(
      route.query.detail,
    )
      ? route.query.detail
      : "projects";
  restoring = false;
}
watch(
  storageKey,
  () => {
    readStored();
    restore();
    accepted.value = store.data;
    pending.value = null;
  },
  { immediate: true },
);
watch(
  () => route.query.statistics,
  () => {
    if (route.query.statistics !== JSON.stringify(query.value)) restore();
  },
);
function persist() {
  preferences.value[query.value.view] = clone(query.value);
  preferences.value.lastView = query.value.view;
  if (storageKey.value && !storageError.value) {
    try {
      storageError.value = writeStatisticsPreferences(
        localStorage,
        storageKey.value,
        preferences.value,
      );
    } catch {
      storageError.value = "设置无法保存。";
    }
  }
}
function linkState() {
  return {
    ...statisticsLinkQuery(query.value),
    ...(selected.value ? { group: selected.value } : {}),
    statsPage: String(page.value),
    detail: detailKind.value,
  };
}
function syncUrl() {
  if (!restoring) {
    const push = pushNext;
    pushNext = false;
    return push
      ? router.push({ query: linkState() })
      : router.replace({ query: linkState() });
  }
}
watch(
  query,
  () => {
    if (restoring) return;
    page.value = 1;
    persist();
    syncUrl();
  },
  { deep: true, flush: "sync" },
);
function switchView(view: "projects" | "tasks") {
  clearTimeout(searchTimer);
  queryError.value = "";
  selected.value = "";
  detailKind.value = "projects";
  pushNext = true;
  query.value = clone(preferences.value[view]);
  search.value = query.value.search;
  detailKind.value = "projects";
}
function choosePreset(preset: StatisticsQuery["preset"]) {
  pushNext = true;
  query.value = { ...query.value, preset, sort: "" };
}
function clearFilters() {
  queryError.value = "";
  query.value = {
    ...query.value,
    search: "",
    projects: [],
    stages: [],
    attention: "all",
    unassigned: false,
  };
  search.value = "";
}
function reset() {
  queryError.value = "";
  query.value = { ...defaultStatisticsQuery(), view: query.value.view };
  search.value = "";
}
function submitSearch() {
  if (composing.value) return;
  clearTimeout(searchTimer);
  query.value.search = search.value;
}
function queueSearch() {
  if (composing.value) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(submitSearch, 200);
}
function applySnapshot() {
  if (pending.value) {
    accepted.value = pending.value;
    acceptedAt.value = store.lastSynced;
    acceptedNow.value = now.value;
    pending.value = null;
  }
}
function maybeApply() {
  if (
    !interacting.value &&
    !menus.value &&
    !(
      focusInside.value &&
      (keyboardMode.value ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName || "",
        ))
    ) &&
    !selecting.value &&
    !taskId.value &&
    !drawer.value
  )
    applySnapshot();
}
watch(
  () => store.data,
  (data) => {
    if (data.revision === accepted.value.revision && !pending.value) {
      acceptedAt.value = store.lastSynced;
      return;
    }
    pending.value = data;
    maybeApply();
  },
);
function blur() {
  nextTick(() => {
    focusInside.value = !!root.value?.contains(document.activeElement);
    maybeApply();
  });
}
function pointerEnd() {
  // pointerup precedes click. Applying a queued snapshot here can move/remove
  // the target before its click handler receives the activation.
  clearTimeout(pointerTimer);
  pointerTimer = setTimeout(() => {
    interacting.value = false;
    selecting.value = !!window.getSelection()?.toString();
    maybeApply();
  }, 0);
}
function selectionChanged() {
  selecting.value = !!window.getSelection()?.toString();
  maybeApply();
}
const scopeError = computed(() => {
  const projects = new Set(accepted.value.projects.map((p) => p.id));
  const stages = new Set(
    accepted.value.projects.map((p) => p.stage || "missing"),
  );
  return query.value.projects.some((id) => !projects.has(id)) ||
    query.value.stages.some((id) => !stages.has(id))
    ? "筛选中包含已失效的项目或阶段，请移除对应条件。"
    : "";
});
const projection = computed(() =>
  queryError.value || scopeError.value
    ? {
        rows: [] as StatisticsGroup[],
        totals: {
          projects: 0,
          total: 0,
          open: 0,
          done: 0,
          blocked: 0,
          overdue: 0,
        },
        today: "",
      }
    : projectStatistics(accepted.value, query.value, {
        now: acceptedNow.value,
        timeZone: store.timeZone,
      }),
);
const selectedGroup = computed(() =>
  projection.value.rows.find((r) => r.key === selected.value),
);
watch(selectedGroup, (value) => {
  if (selected.value && !value) {
    selected.value = "";
    notice.value = "原选中责任组已不在当前结果中，请重新选择。";
    drawer.value = false;
    syncUrl();
  }
});
const visible = computed(() =>
  projection.value.rows.slice(
    (page.value - 1) * query.value.pageSize,
    page.value * query.value.pageSize,
  ),
);
watch(
  () => projection.value.rows.length,
  (n) => {
    page.value = Math.min(
      page.value,
      Math.max(1, Math.ceil(n / query.value.pageSize)),
    );
  },
);
const stageLabels = computed(() =>
  Object.fromEntries(
    (accepted.value.catalogs?.stages ?? []).map((s) => [s.id, s.zh]),
  ),
);
const stages = computed(() => [
  ...new Set(accepted.value.projects.map((p) => p.stage || "missing")),
]);
const columns = [
  { key: "projects", label: "项目数" },
  { key: "total", label: "任务总数" },
  { key: "open", label: "未完成" },
  { key: "done", label: "已完成" },
  { key: "blocked", label: "待协调" },
  { key: "overdue", label: "明确逾期" },
] as const;
const displayColumns = computed(() =>
  small.value
    ? [...columns].sort(
        (a, b) =>
          ["projects", "open", "blocked", "overdue", "total", "done"].indexOf(
            a.key,
          ) -
          ["projects", "open", "blocked", "overdue", "total", "done"].indexOf(
            b.key,
          ),
      )
    : columns,
);
const presets = [
  ["attention", "关注优先"],
  ["projects", "项目最多"],
  ["open", "未完成最多"],
  ["blocked", "待协调最多"],
  ["overdue", "明确逾期最多"],
  ["name", "姓名顺序"],
];
function headerSort(key: StatisticsQuery["sort"]) {
  const first = key === "name" ? "asc" : "desc";
  if (query.value.sort !== key) {
    query.value = { ...query.value, sort: key, direction: first };
  } else if (query.value.direction === first) {
    query.value.direction = first === "asc" ? "desc" : "asc";
  } else query.value.sort = "";
}
function arrow(key: string) {
  return query.value.sort === key
    ? query.value.direction === "asc"
      ? " ↑"
      : " ↓"
    : "";
}
function selectRow(row: StatisticsGroup, kind = "projects") {
  selected.value = row.key;
  detailKind.value = kind;
  notice.value = "";
  drawer.value = small.value;
  syncUrl();
}
function saveView() {
  const name = viewName.value.trim();
  if (!name) return;
  const list = preferences.value.views;
  const found = list.findIndex((v) => v.name === name);
  if (found < 0 && list.length >= 10) {
    notice.value = "最多保存10个常用视图，请先删除一个。";
    return;
  }
  const item = { name, query: clone(query.value) };
  if (found >= 0) list[found] = item;
  else list.push(item);
  persist();
  viewName.value = "";
  notice.value = "常用视图已保存。";
}
function removeView(name: string) {
  preferences.value.views = preferences.value.views.filter(
    (v) => v.name !== name,
  );
  persist();
}
async function share() {
  try {
    await navigator.clipboard.writeText(
      new URL(
        router.resolve({ path: route.path, query: linkState() }).href,
        location.origin,
      ).href,
    );
    notice.value = "分享链接已复制。";
  } catch {
    notice.value = "无法复制，请复制浏览器地址栏链接。";
  }
}
async function projectOpen(id: string) {
  await syncUrl();
  try {
    sessionStorage.setItem(
      storageKey.value + ":return",
      JSON.stringify({ url: route.fullPath, y: window.scrollY }),
    );
  } catch {
    /* Navigation remains available without storage. */
  }
  await router.push(`/projects/${encodeURIComponent(id)}`);
}
watchPostEffect(() => {
  const active =
    query.value.sort ||
    (query.value.preset === "attention" ? "overdue" : query.value.preset);
  const direction = query.value.sort
    ? query.value.direction
    : active === "name"
      ? "asc"
      : "desc";
  for (const cell of root.value?.querySelectorAll<HTMLElement>(
    "th:has([data-stat-column])",
  ) ?? [])
    cell.setAttribute(
      "aria-sort",
      cell.querySelector<HTMLElement>("[data-stat-column]")?.dataset
        .statColumn === active
        ? direction === "asc"
          ? "ascending"
          : "descending"
        : "none",
    );
});
watch(now, () => {
  if (
    dayKey(now.value, store.timeZone) !==
    dayKey(
      acceptedNow.value,
      accepted.value.settings?.timeZone || store.timeZone,
    )
  ) {
    pending.value = store.data;
    maybeApply();
  }
});
function resize() {
  small.value = window.innerWidth < 1000;
}
onMounted(() => {
  if (route.query.statistics === undefined) void syncUrl();
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointerup", pointerEnd);
  document.addEventListener("selectionchange", selectionChanged);
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(storageKey.value + ":return") || "null",
    );
    if (saved?.url === route.fullPath && Number.isFinite(saved.y))
      requestAnimationFrame(() => window.scrollTo(0, saved.y));
  } catch {
    /* Optional return-position memory. */
  }
  if (selected.value && !selectedGroup.value) {
    selected.value = "";
    notice.value = "链接中的责任组已不存在或不符合当前条件。";
  }
});
onBeforeUnmount(() => {
  clearTimeout(pointerTimer);
  clearTimeout(searchTimer);
  window.removeEventListener("resize", resize);
  window.removeEventListener("pointerup", pointerEnd);
  document.removeEventListener("selectionchange", selectionChanged);
});
</script>
<template>
  <ElConfigProvider :locale="zhCn">
    <main
      ref="root"
      class="page statistics-page"
      @pointerdown="
        interacting = true;
        keyboardMode = false;
      "
      @keydown="keyboardMode = true"
      @focusin="focusInside = true"
      @focusout="blur"
    >
      <header>
        <h1>人员与项目统计</h1>
        <p>
          {{
            query.view === "projects"
              ? "按项目负责人查看项目及项目内任务分布。"
              : "按任务负责人查看直接分派的任务。"
          }}
          数量不代表工时或人员忙闲。
        </p>
      </header>
      <p v-if="store.error" class="error-box" role="alert">
        {{ store.error }} · 保留上次成功数据
        <button @click="store.refresh()">重试</button>
      </p>
      <p
        v-if="queryError || scopeError || storageError"
        role="alert"
        class="error-box"
      >
        {{ queryError || scopeError || storageError }}
        <button v-if="queryError || scopeError" @click="clearFilters">
          清除无效条件
        </button>
      </p>
      <div class="stats-summary">
        <div
          v-for="item in [
            ['projects', '项目'],
            ['total', '任务'],
            ['open', '未完成'],
            ['blocked', '待协调'],
            ['overdue', '明确逾期'],
          ]"
          :key="item[0]"
        >
          <strong>{{
            projection.totals[item[0] as keyof typeof projection.totals]
          }}</strong
          ><span>{{ item[1] }}</span>
        </div>
      </div>
      <p class="background-count">
        组织背景：{{
          accepted.directory?.employees.filter((e) => e.active).length ?? 0
        }}
        名在职人员 · {{ accepted.directory?.departments.length ?? 0 }} 个部门
      </p>
      <div class="view-tabs">
        <button
          v-for="item in [
            ['projects', '项目负责人'],
            ['tasks', '任务负责人'],
          ]"
          :key="item[0]"
          :aria-pressed="query.view === item[0]"
          @click="switchView(item[0] as 'projects' | 'tasks')"
        >
          {{ item[1] }}
        </button>
      </div>
      <button
        v-if="small"
        class="mobile-filter-toggle"
        :aria-expanded="mobileFilters"
        @click="mobileFilters = !mobileFilters"
      >
        {{ mobileFilters ? "收起筛选" : "筛选与排序" }}
      </button>
      <div v-show="!small || mobileFilters" class="statistics-toolbar">
        <ElInput
          v-model="search"
          clearable
          placeholder="姓名 / 拼音 / 首字母"
          aria-label="搜索负责人"
          @input="queueSearch"
          @keydown.enter="submitSearch"
          @compositionstart="composing = true"
          @compositionend="
            composing = false;
            queueSearch();
          "
        />
        <ElSelect
          v-model="query.projects"
          multiple
          filterable
          clearable
          collapse-tags
          placeholder="全部项目"
          aria-label="筛选项目"
          @visible-change="
            (v) => {
              menus = v;
              maybeApply();
            }
          "
          ><ElOption
            v-for="p in accepted.projects"
            :key="p.id"
            :value="p.id"
            :label="p.name"
        /></ElSelect>
        <ElSelect
          v-model="query.stages"
          multiple
          filterable
          clearable
          collapse-tags
          placeholder="全部阶段"
          aria-label="筛选阶段"
          @visible-change="
            (v) => {
              menus = v;
              maybeApply();
            }
          "
          ><ElOption
            v-for="s in stages"
            :key="s"
            :value="s"
            :label="stageLabels[s] || s || '阶段待补'"
        /></ElSelect>
        <ElSelect
          :model-value="query.preset"
          aria-label="排序预设"
          @change="choosePreset"
          @visible-change="
            (v) => {
              menus = v;
              maybeApply();
            }
          "
          ><ElOption
            v-for="p in presets"
            :key="p[0]"
            :value="p[0]!"
            :label="p[1]"
        /></ElSelect>
      </div>
      <div class="quick-filters">
        <button
          v-for="item in [
            ['all', '全部'],
            ['blocked', '有待协调'],
            ['overdue', '有明确逾期'],
          ]"
          :key="item[0]"
          :aria-pressed="query.attention === item[0]"
          @click="query.attention = item[0] as StatisticsQuery['attention']"
        >
          {{ item[1] }}</button
        ><ElCheckbox v-model="query.unassigned">只看未填写责任人</ElCheckbox
        ><button @click="clearFilters">清除筛选</button
        ><button @click="share">复制分享链接</button
        ><button v-if="pending" @click="applySnapshot">有新数据 · 更新</button>
      </div>
      <div class="condition-tags" aria-live="polite">
        <span>{{ projection.rows.length }} 个责任组</span
        ><ElTag
          v-if="query.search"
          closable
          @close="
            query.search = '';
            search = '';
          "
          >姓名：{{ query.search }}</ElTag
        ><ElTag
          v-for="id in query.projects"
          :key="id"
          closable
          @close="query.projects = query.projects.filter((v) => v !== id)"
          >项目：{{
            accepted.projects.find((p) => p.id === id)?.name || "已失效：" + id
          }}</ElTag
        ><ElTag
          v-for="id in query.stages"
          :key="id"
          closable
          @close="query.stages = query.stages.filter((v) => v !== id)"
          >阶段：{{ stageLabels[id] || id }}</ElTag
        ><ElTag
          v-if="query.attention !== 'all'"
          closable
          @close="query.attention = 'all'"
          >仅显示有{{
            query.attention === "blocked" ? "待协调" : "明确逾期"
          }}的责任组</ElTag
        ><ElTag
          v-if="query.unassigned"
          closable
          @close="query.unassigned = false"
          >只看未填写</ElTag
        ><span v-if="query.sort"
          >当前排序：{{
            query.sort === "name"
              ? "姓名"
              : columns.find((c) => c.key === query.sort)?.label
          }}{{ query.direction === "asc" ? "升序" : "降序" }}</span
        >
      </div>
      <details class="display-settings">
        <summary>常用视图与显示设置</summary>
        <div class="quick-filters">
          <ElCheckbox v-model="query.compact">紧凑行距</ElCheckbox
          ><ElCheckbox
            v-for="c in displayColumns.filter(
              (c) => !['projects', 'open'].includes(c.key),
            )"
            :key="c.key"
            :model-value="query.columns.includes(c.key as 'total')"
            @change="
              (v) =>
                (query.columns = v
                  ? [...query.columns, c.key as 'total']
                  : query.columns.filter((k) => k !== c.key))
            "
            >{{ c.label }}</ElCheckbox
          ><button @click="reset">恢复默认</button>
        </div>
        <div class="quick-filters">
          <ElInput
            v-model="viewName"
            maxlength="40"
            placeholder="常用视图名称，同名将覆盖"
            aria-label="常用视图名称"
            style="max-width: 280px"
          /><button @click="saveView">保存当前视图</button>
        </div>
        <div v-for="v in preferences.views" :key="v.name" class="saved-view">
          <button
            @click="
              query = clone(v.query);
              search = query.search;
            "
          >
            {{ v.name }}</button
          ><button
            :aria-label="'删除视图 ' + v.name"
            @click="removeView(v.name)"
          >
            删除
          </button>
        </div>
      </details>
      <p v-if="notice" role="status">{{ notice }}</p>
      <div
        class="statistics-columns"
        :class="{ 'has-detail': selectedGroup && !small }"
      >
        <section class="statistics-card">
          <h2>责任分布</h2>
          <p class="scope-note">
            {{
              query.view === "projects"
                ? "任务数包含该负责人项目内的全部有效末级任务，不等于本人执行数量。"
                : "只统计直接分派给该责任组的有效末级任务。"
            }}
            未填写组固定在末尾。
          </p>
          <div v-if="small" class="mobile-people">
            <article
              v-for="row in visible"
              :key="row.key"
              :class="{ selected: selected === row.key }"
            >
              <button class="person-name" @click="selectRow(row)">
                {{ row.name }} <span>查看项目 ›</span>
              </button>
              <div class="mobile-metrics">
                <button
                  v-for="c in displayColumns"
                  :key="c.key"
                  @click="selectRow(row, c.key)"
                  :aria-label="
                    row.name +
                    ' ' +
                    c.label +
                    ' ' +
                    (c.key === 'projects' ? row.projects.length : row[c.key])
                  "
                >
                  <span>{{ c.label }}</span
                  ><strong>{{
                    c.key === "projects" ? row.projects.length : row[c.key]
                  }}</strong>
                </button>
              </div>
            </article>
          </div>
          <ElTable
            v-else
            :data="visible"
            row-key="key"
            :size="query.compact ? 'small' : 'default'"
            max-height="560"
            highlight-current-row
            :current-row-key="selected"
            empty-text="没有符合条件的责任组，可清除筛选后重试"
            :row-class-name="
              ({ row }) => (row.key === 'none' ? 'unassigned-row' : '')
            "
          >
            <ElTableColumn prop="name" label="负责人" fixed min-width="150"
              ><template #header
                ><button
                  class="sort-button"
                  data-stat-column="name"
                  :aria-label="'按姓名排序' + arrow('name')"
                  @click="headerSort('name')"
                >
                  负责人{{ arrow("name") }}
                </button></template
              ><template #default="{ row }"
                ><button
                  class="cell-link"
                  @click="selectRow(row as StatisticsGroup)"
                >
                  {{ row.name }}
                </button></template
              ></ElTableColumn
            >
            <ElTableColumn
              v-for="c in displayColumns.filter(
                (c) =>
                  ['projects', 'open'].includes(c.key) ||
                  query.columns.includes(c.key as 'total'),
              )"
              :key="c.key"
              :prop="c.key"
              :label="c.label"
              :min-width="small ? 80 : 100"
              align="right"
              ><template #header
                ><button
                  class="sort-button"
                  :data-stat-column="c.key"
                  :aria-label="'按' + c.label + '排序' + arrow(c.key)"
                  @click="headerSort(c.key)"
                >
                  {{ c.label }}{{ arrow(c.key) }}
                </button></template
              ><template #default="{ row }"
                ><button
                  class="cell-link"
                  :aria-label="
                    row.name +
                    ' ' +
                    c.label +
                    ' ' +
                    (c.key === 'projects' ? row.projects.length : row[c.key])
                  "
                  @click="selectRow(row as StatisticsGroup, c.key)"
                >
                  {{ c.key === "projects" ? row.projects.length : row[c.key] }}
                </button></template
              ></ElTableColumn
            >
          </ElTable>
          <div class="totals-line">
            <strong>全部筛选结果合计</strong
            ><span v-for="c in columns" :key="c.key"
              >{{ c.label }} {{ projection.totals[c.key] }}</span
            >
          </div>
          <ElPagination
            v-model:current-page="page"
            v-model:page-size="query.pageSize"
            :page-sizes="[25, 50, 100]"
            :total="projection.rows.length"
            layout="total, sizes, prev, pager, next"
            :small="small"
            @current-change="syncUrl"
          />
        </section>
        <section
          v-if="!small && selectedGroup"
          class="statistics-card detail-card"
        >
          <StatisticsDetails
            v-if="selectedGroup"
            :group="selectedGroup"
            :mobile="small"
            :kind="detailKind"
            :today="projection.today"
            :stages="stageLabels"
            @back="
              detailKind = 'projects';
              syncUrl();
            "
            @project="projectOpen"
            @task="(id) => (taskId = id)"
          />
          <div v-else class="detail-empty">
            点击负责人或数量，查看对应项目和任务。
          </div>
        </section>
      </div>
      <footer>
        数据更新时间：{{
          acceptedAt ? new Date(acceptedAt).toLocaleTimeString() : "尚未同步"
        }}
        · 统计时区：{{ store.timeZone }} · {{ projection.today }} ·
        排除父任务与作废任务；只读统计，不修改业务顺序。
      </footer>
    </main>
    <ElDrawer
      v-model="drawer"
      title="统计明细"
      @closed="maybeApply"
      size="95%"
      :destroy-on-close="true"
      ><StatisticsDetails
        v-if="selectedGroup"
        :group="selectedGroup"
        :mobile="small"
        :kind="detailKind"
        :today="projection.today"
        :stages="stageLabels"
        @back="detailKind = 'projects'"
        @project="projectOpen"
        @task="(id) => (taskId = id)"
    /></ElDrawer>
    <TaskDetailPanel v-if="taskId" :task-id="taskId" @close="taskId = ''" />
  </ElConfigProvider>
</template>
<style scoped>
.statistics-page {
  --el-color-primary: var(--accent);
  --el-font-family: inherit;
}
.statistics-page header p,
.scope-note,
.background-count,
footer {
  color: var(--muted);
  font-size: 13px;
}
.stats-summary {
  display: flex;
  gap: 12px;
  margin: 24px 0 8px;
}
.stats-summary > div {
  flex: 1;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stats-summary strong {
  font-size: 28px;
}
.stats-summary span {
  font-size: 13px;
}
.view-tabs,
.quick-filters,
.condition-tags {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 12px 0;
}
.view-tabs button[aria-pressed="true"],
.quick-filters button[aria-pressed="true"] {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent-border);
}
.statistics-toolbar {
  display: grid;
  grid-template-columns: 1fr 1.4fr 1fr 1fr;
  gap: 12px;
}
.statistics-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  margin-top: 16px;
}
.statistics-card {
  min-width: 0;
  background: var(--surface, #fff);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}
.statistics-card h2 {
  font-size: 18px;
  margin-top: 0;
}
.cell-link,
.sort-button {
  border: 0;
  background: transparent;
  padding: 4px;
  color: var(--accent);
  min-height: 32px;
}
.sort-button {
  color: inherit;
  font-weight: 600;
}
.cell-link:focus-visible,
.sort-button:focus-visible {
  outline: 2px solid var(--accent);
}
small {
  display: block;
  font-size: 11px;
  color: var(--muted);
}
.totals-line {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 0;
  font-size: 12px;
  border-top: 1px solid var(--border);
}
.detail-empty {
  padding: 80px 16px;
  text-align: center;
  color: var(--muted);
}
.display-settings {
  font-size: 13px;
}
.saved-view {
  display: inline-flex;
  gap: 4px;
  margin: 8px;
}
.el-pagination {
  flex-wrap: wrap;
  gap: 4px;
}
footer {
  margin-top: 20px;
}
:deep(.unassigned-row) {
  --el-table-tr-bg-color: var(--accent-bg);
}
@media (max-width: 999px) {
  .statistics-columns {
    grid-template-columns: 1fr;
  }
  .statistics-toolbar {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 480px) {
  .statistics-toolbar {
    grid-template-columns: 1fr;
  }
  .stats-summary {
    flex-wrap: wrap;
  }
  .stats-summary > div {
    flex-basis: 28%;
  }
  .statistics-card {
    padding: 10px;
  }
}

.statistics-page {
  padding-top: 12px;
}
.statistics-page h1 {
  font-size: 24px;
  margin: 0 0 6px;
}
.statistics-page header p {
  margin: 0;
}
.stats-summary {
  margin: 12px 0 6px;
  max-width: 900px;
}
.stats-summary strong {
  font-size: 22px;
}
.stats-summary > div {
  flex-direction: row;
  align-items: baseline;
  gap: 8px;
}
.view-tabs,
.quick-filters,
.condition-tags {
  margin: 8px 0;
  gap: 6px;
}
.background-count {
  margin: 4px 0;
}
.statistics-toolbar {
  grid-template-columns:
    minmax(160px, 240px) minmax(200px, 320px) minmax(160px, 240px)
    minmax(150px, 200px);
  gap: 8px;
}
.statistics-columns {
  margin-top: 10px;
  gap: 12px;
  align-items: start;
}
.statistics-columns.has-detail {
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
}
.statistics-card {
  padding: 12px;
}
.statistics-card h2 {
  font-size: 16px;
  margin: 0 0 6px;
}
.scope-note {
  margin: 0 0 8px;
  font-size: 12px;
}
.cell-link,
.sort-button {
  min-height: 28px;
  padding: 2px 4px;
}
.cell-link {
  width: 100%;
  justify-content: flex-end;
}
:deep(.el-table__row td:first-child .cell-link) {
  justify-content: flex-start;
}
:deep(.el-table .el-table__cell) {
  padding: 3px 0;
}
:deep(.el-table .cell) {
  line-height: 24px;
  padding: 0 8px;
}
:deep(.el-checkbox) {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin: 0;
  height: 32px;
}
:deep(.el-checkbox__label) {
  padding-left: 0;
}
.mobile-people article {
  border-bottom: 1px solid var(--border);
  padding: 10px 0;
}
.mobile-people article.selected {
  background: var(--accent-bg);
}
.person-name {
  border: 0;
  background: none;
  width: 100%;
  justify-content: space-between;
  white-space: normal;
  text-align: left;
  color: var(--accent);
  padding: 0 4px;
}
.person-name span {
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}
.mobile-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.mobile-metrics button {
  border: 0;
  background: none;
  min-height: 44px;
  justify-content: space-between;
  padding: 4px 8px;
  gap: 4px;
}
.mobile-metrics span {
  font-size: 12px;
  color: var(--muted);
}
.mobile-metrics strong {
  color: var(--accent);
  font-size: 15px;
}
@media (max-width: 999px) {
  .statistics-columns.has-detail {
    grid-template-columns: 1fr;
  }
  .statistics-toolbar {
    grid-template-columns: 1fr 1fr;
  }
  .statistics-page h1 {
    font-size: 22px;
  }
  .stats-summary {
    flex-wrap: wrap;
    gap: 8px;
  }
  .stats-summary > div {
    flex: 1 0 25%;
  }
  .mobile-filter-toggle {
    margin: 4px 0;
  }
  .stats-summary strong {
    font-size: 20px;
  }
}
@media (max-width: 480px) {
  .statistics-toolbar {
    grid-template-columns: 1fr 1fr;
  }
  .statistics-toolbar > :first-child {
    grid-column: 1/-1;
  }
  .stats-summary > div {
    flex-direction: row;
  }
  .statistics-card {
    padding: 8px;
  }
  .totals-line {
    gap: 6px;
  }
  .quick-filters {
    gap: 4px;
  }
  .quick-filters button {
    padding: 6px 8px;
    font-size: 12px;
  }
}
</style>
