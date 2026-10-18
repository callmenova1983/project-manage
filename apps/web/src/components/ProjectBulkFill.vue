<script setup lang="ts">
import { t } from "../locales";
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  useId,
  watch,
} from "vue";
import {
  PhTable,
  PhX,
  PhArrowCounterClockwise,
  PhArrowClockwise,
  PhMagnifyingGlass,
  PhCheck,
  PhCaretDown,
  PhLockSimple,
  PhClipboardText,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import {
  activeStages,
  catalogLabel,
  stageColors,
} from "../composables/catalogs";
import { missingProjectFields } from "../../../../packages/domain/daily-log";
import {
  planSheetPaste,
  projectSheetFields,
  sheetClipboard,
  type ProjectSheetField,
} from "../services/project-sheet";
import PersonPicker from "./PersonPicker.vue";
import { dialogContextKey } from "../composables/dialog-context";
const parentDialog = inject(dialogContextKey, undefined);
const teleportTarget = computed(() => parentDialog?.target.value ?? "body");
const props = defineProps<{ projectIds?: string[] }>();
const reminderId = useId();
const store = useWorkspace();
type Values = Record<ProjectSheetField, string>;
type Row = Values & {
  id: string;
  version: number;
  name: string;
  selected: boolean;
  original: Values;
};
type Cell = { id: string; col: number };
type Change = {
  id: string;
  field: ProjectSheetField;
  before: string;
  after: string;
};
const open = ref(false),
  saving = ref(false),
  error = ref(""),
  search = ref(""),
  message = ref("");
const rows = ref<Row[]>([]),
  owner = ref(""),
  stage = ref(""),
  client = ref(""),
  emptyOnly = ref(true);
const bulk = ref(false),
  dialog = ref<HTMLElement | null>(null),
  grid = ref<HTMLElement>(),
  trigger = ref<HTMLButtonElement>();
provide(dialogContextKey, {
  active: computed(() => open.value && (parentDialog?.active.value ?? true)),
  target: dialog,
});
const active = ref<Cell>(),
  anchor = ref<Cell>(),
  editing = ref<Cell>(),
  draft = ref("");
const undoStack = ref<Change[][]>([]),
  redoStack = ref<Change[][]>([]);
const labels = [t("负责人"), t("阶段"), t("客户")];
const scope = ref<"missing" | "all">("missing");
const projects = computed(() =>
  store.data.projects.filter(
    (p) =>
      !p.intakeInbox && (!props.projectIds || props.projectIds.includes(p.id)),
  ),
);
const missingCount = computed(
  () => projects.value.filter((p) => missingProjectFields(p).length > 0).length,
);
// Keep rows in place while editing. Completion takes effect after saving.
const missingRows = computed(() =>
  rows.value.filter((row) => missingProjectFields(row.original).length > 0),
);
const visible = computed(() =>
  (scope.value === "missing" ? missingRows.value : rows.value).filter((row) =>
    row.name.toLowerCase().includes(search.value.trim().toLowerCase()),
  ),
);
const selected = computed(() => rows.value.filter((row) => row.selected));
const changed = (row: Row, field?: ProjectSheetField) =>
  field
    ? row[field] !== row.original[field]
    : projectSheetFields.some((key) => row[key] !== row.original[key]);
const pending = computed(() => selected.value.filter((row) => changed(row)));
const allSelected = computed(
  () => visible.value.length > 0 && visible.value.every((row) => row.selected),
);
const someSelected = computed(
  () => !allSelected.value && visible.value.some((row) => row.selected),
);
const bounds = computed(() => {
  const a = visible.value.findIndex((row) => row.id === anchor.value?.id),
    b = visible.value.findIndex((row) => row.id === active.value?.id);
  if (a < 0 || b < 0 || !anchor.value || !active.value) return undefined;
  return {
    top: Math.min(a, b),
    bottom: Math.max(a, b),
    left: Math.min(anchor.value.col, active.value.col),
    right: Math.max(anchor.value.col, active.value.col),
  };
});
const address = computed(() => {
  if (!active.value) return "—";
  const index = visible.value.findIndex((row) => row.id === active.value!.id);
  return `${String.fromCharCode(66 + active.value.col)}${index + 1}`;
});
const rangeCount = computed(() =>
  bounds.value
    ? (bounds.value.bottom - bounds.value.top + 1) *
      (bounds.value.right - bounds.value.left + 1)
    : 0,
);
function isActive(id: string, col: number) {
  return active.value?.id === id && active.value.col === col;
}
function isEditing(id: string, col: number) {
  return editing.value?.id === id && editing.value.col === col;
}
function inRange(index: number, col: number) {
  const b = bounds.value;
  return (
    !!b &&
    index >= b.top &&
    index <= b.bottom &&
    col >= b.left &&
    col <= b.right
  );
}
function valueLabel(row: Row, field: ProjectSheetField) {
  return field === "stage"
    ? catalogLabel("stages", row.stage)
    : row[field] === "Unassigned"
      ? ""
      : row[field];
}
function start() {
  rows.value = projects.value.map((p) => ({
    id: p.id,
    version: p.version,
    name: p.name,
    selected: !!props.projectIds || missingProjectFields(p).length > 0,
    owner: p.owner,
    stage: p.stage,
    client: p.client,
    original: { owner: p.owner, stage: p.stage, client: p.client },
  }));
  scope.value = "missing";
  search.value = "";
  error.value = "";
  message.value = "";
  bulk.value = false;
  undoStack.value = [];
  redoStack.value = [];
  editing.value = undefined;
  active.value = visible.value[0]
    ? { id: visible.value[0].id, col: 0 }
    : undefined;
  anchor.value = active.value;
  open.value = true;
  void nextTick(() => dialog.value?.focus());
}
function close() {
  if (saving.value) return;
  editing.value = undefined;
  open.value = false;
  void nextTick(() => trigger.value?.focus());
}
function record(changes: Change[]) {
  const actual = changes.filter((change) => change.before !== change.after);
  if (!actual.length) return;
  for (const change of actual) {
    const row = rows.value.find((r) => r.id === change.id)!;
    row[change.field] = change.after;
    row.selected = true;
  }
  undoStack.value.push(actual);
  if (undoStack.value.length > 100) undoStack.value.shift();
  redoStack.value = [];
  error.value = "";
}
function commitEdit() {
  const cell = editing.value;
  if (!cell) return;
  const row = rows.value.find((r) => r.id === cell.id)!,
    field = projectSheetFields[cell.col]!;
  const value = draft.value.trim();
  if (value.length > (field === "client" ? 120 : 80)) {
    error.value = t("内容过长，请缩短后再保存。");
    return;
  }
  editing.value = undefined;
  record([{ id: row.id, field, before: row[field], after: value }]);
}
function cancelEdit() {
  editing.value = undefined;
  void focusCell();
}
function setScope(value: "missing" | "all") {
  commitEdit();
  if (!editing.value) scope.value = value;
}
async function focusCell() {
  await nextTick();
  if (active.value)
    grid.value
      ?.querySelector<HTMLElement>(
        `[data-row-id="${CSS.escape(active.value.id)}"][data-col="${active.value.col}"]`,
      )
      ?.focus();
}
async function beginEdit(cell: Cell, initial?: string) {
  if (saving.value) return;
  commitEdit();
  if (editing.value) return;
  active.value = { ...cell };
  anchor.value = { ...cell };
  editing.value = { ...cell };
  const row = rows.value.find((r) => r.id === cell.id)!;
  draft.value =
    initial ??
    (row[projectSheetFields[cell.col]!] === "Unassigned"
      ? ""
      : row[projectSheetFields[cell.col]!]);
  await nextTick();
  const input = grid.value?.querySelector<HTMLInputElement | HTMLSelectElement>(
    '[data-editing="true"] input, [data-editing="true"] select',
  );
  input?.focus();
  if (
    input instanceof HTMLInputElement &&
    cell.col === 2 &&
    initial === undefined
  )
    input.select();
}
function pickCell(row: Row, col: number, event: MouseEvent) {
  if (saving.value || isEditing(row.id, col)) return;
  commitEdit();
  if (editing.value) return;
  active.value = { id: row.id, col };
  if (event.shiftKey) {
    if (!anchor.value) anchor.value = { ...active.value };
    void focusCell();
  } else {
    anchor.value = { ...active.value };
    void beginEdit(active.value);
  }
}
function move(
  rowDelta: number,
  colDelta: number,
  extend = false,
  wrap = false,
) {
  if (!active.value || !visible.value.length) return;
  let row = visible.value.findIndex((r) => r.id === active.value!.id),
    col = active.value.col + colDelta;
  if (wrap && col > 2) {
    col = 0;
    row++;
  } else if (wrap && col < 0) {
    col = 2;
    row--;
  }
  row = Math.max(0, Math.min(visible.value.length - 1, row + rowDelta));
  col = Math.max(0, Math.min(2, col));
  active.value = { id: visible.value[row]!.id, col };
  if (!extend) anchor.value = { ...active.value };
  void focusCell();
}
function history(redo = false) {
  commitEdit();
  const from = redo ? redoStack : undoStack,
    to = redo ? undoStack : redoStack,
    changes = from.value.pop();
  if (!changes) return;
  for (const change of changes) {
    const row = rows.value.find((r) => r.id === change.id)!;
    row[change.field] = redo ? change.after : change.before;
    row.selected = true;
  }
  to.value.push(changes);
  message.value = redo ? t("已重做") : t("已撤销");
  error.value = "";
  void focusCell();
}
function apply() {
  commitEdit();
  const changes: Change[] = [];
  for (const row of selected.value)
    for (const field of projectSheetFields) {
      const value = {
        owner: owner.value,
        stage: stage.value,
        client: client.value,
      }[field].trim();
      const empty =
        field === "stage"
          ? row.stage === "unclassified"
          : !row[field] || row[field] === "Unassigned";
      if (value && (!emptyOnly.value || empty))
        changes.push({ id: row.id, field, before: row[field], after: value });
    }
  record(changes);
  message.value = changes.length
    ? t("已填入 {p0} 个项目，保存后生效", {
        p0: new Set(changes.map((c) => c.id)).size,
      })
    : t("没有需要填入的空缺");
}
function fillDown() {
  commitEdit();
  const b = bounds.value;
  if (!b || b.bottom === b.top) return;
  const changes: Change[] = [];
  for (let col = b.left; col <= b.right; col++) {
    const field = projectSheetFields[col]!,
      value = visible.value[b.top]![field];
    for (let r = b.top + 1; r <= b.bottom; r++) {
      const row = visible.value[r]!;
      changes.push({ id: row.id, field, before: row[field], after: value });
    }
  }
  record(changes);
  message.value = t("已向下填充");
}
function clearRange() {
  const b = bounds.value;
  if (!b) return;
  const changes: Change[] = [];
  for (let r = b.top; r <= b.bottom; r++)
    for (let col = b.left; col <= b.right; col++) {
      const row = visible.value[r]!,
        field = projectSheetFields[col]!;
      changes.push({
        id: row.id,
        field,
        before: row[field],
        after: field === "stage" ? "unclassified" : "",
      });
    }
  record(changes);
}
function copy(event: ClipboardEvent) {
  if (editing.value || !bounds.value) return;
  const b = bounds.value,
    matrix: string[][] = [];
  for (let r = b.top; r <= b.bottom; r++)
    matrix.push(
      projectSheetFields
        .slice(b.left, b.right + 1)
        .map((field) => valueLabel(visible.value[r]!, field)),
    );
  event.preventDefault();
  event.clipboardData?.setData("text/plain", sheetClipboard(matrix));
  message.value = t("已复制 {p0} 个单元格", { p0: rangeCount.value });
}
function paste(event: ClipboardEvent) {
  if (saving.value || !active.value) return;
  const text = event.clipboardData?.getData("text/plain");
  if (text === undefined) return;
  // Native text editing remains available for a single cell.
  if (editing.value && !/[\t\r\n]/.test(text)) return;
  event.preventDefault();
  try {
    const start = visible.value.findIndex((r) => r.id === active.value!.id);
    const plan = planSheetPaste(
      text,
      start,
      active.value.col,
      visible.value.length,
      activeStages.value,
    );
    editing.value = undefined;
    record(
      plan.map((cell) => ({
        id: visible.value[cell.row]!.id,
        field: cell.field,
        before: visible.value[cell.row]![cell.field],
        after: cell.value,
      })),
    );
    anchor.value = { ...active.value };
    const last = plan.at(-1)!;
    active.value = { id: visible.value[last.row]!.id, col: last.column };
    message.value = t("已粘贴 {p0} 个单元格，保存后生效", { p0: plan.length });
    void focusCell();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("粘贴失败，请重新复制。");
  }
}
function key(event: KeyboardEvent) {
  if (saving.value) {
    event.preventDefault();
    return;
  }
  const modifier = event.ctrlKey || event.metaKey;
  if (editing.value) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    } else if (event.key === "Tab") {
      event.preventDefault();
      commitEdit();
      if (!editing.value) move(0, event.shiftKey ? -1 : 1, false, true);
    } else if (event.key === "Enter" && editing.value.col !== 0) {
      event.preventDefault();
      commitEdit();
      if (!editing.value) move(event.shiftKey ? -1 : 1, 0);
    }
    return;
  }
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    history(event.shiftKey);
    return;
  }
  if (modifier && event.key.toLowerCase() === "y") {
    event.preventDefault();
    history(true);
    return;
  }
  if (modifier && event.key.toLowerCase() === "d") {
    event.preventDefault();
    fillDown();
    return;
  }
  if (modifier && event.key.toLowerCase() === "a") {
    event.preventDefault();
    if (visible.value.length) {
      anchor.value = { id: visible.value[0]!.id, col: 0 };
      active.value = { id: visible.value.at(-1)!.id, col: 2 };
    }
    return;
  }
  if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    move(
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0,
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0,
      event.shiftKey,
    );
  } else if (event.key === "Tab") {
    event.preventDefault();
    move(0, event.shiftKey ? -1 : 1, false, true);
  } else if ((event.key === "Enter" || event.key === "F2") && active.value) {
    event.preventDefault();
    void beginEdit(active.value);
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    clearRange();
  } else if (
    event.key.length === 1 &&
    !modifier &&
    !event.altKey &&
    active.value
  ) {
    event.preventDefault();
    void beginEdit(active.value, event.key);
  }
}
function dialogKey(event: KeyboardEvent) {
  if (event.key === "Escape" && !event.defaultPrevented) {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === "Tab" && !event.defaultPrevented) {
    const nodes = Array.from(
      dialog.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ) ?? [],
    ).filter((el) => el.getClientRects().length);
    const first = nodes[0],
      last = nodes.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === dialog.value)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        document.activeElement === dialog.value)
    ) {
      event.preventDefault();
      first?.focus();
    }
  }
}
async function save() {
  commitEdit();
  if (editing.value) return;
  const changes = pending.value.map((row) => ({
    id: row.id,
    version: row.version,
    fields: Object.fromEntries(
      projectSheetFields
        .filter((key) => changed(row, key))
        .map((key) => [key, row[key]]),
    ),
  }));
  if (!changes.length) return;
  if (changes.length > 100) {
    error.value = t("一次最多保存 100 个项目，请减少勾选后分批保存。");
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await api.bulkFillProjects({ rows: changes });
    await store.refresh();
    saving.value = false;
    close();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("保存失败，请重试。");
  } finally {
    saving.value = false;
  }
}
watch([search, scope], () => {
  commitEdit();
  active.value = visible.value[0]
    ? { id: visible.value[0].id, col: 0 }
    : undefined;
  anchor.value = active.value;
});
let originalOverflow = "";
watch(open, (value) => {
  if (parentDialog) return;
  if (value) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  } else document.body.style.overflow = originalOverflow;
});
onBeforeUnmount(() => {
  if (open.value && !parentDialog)
    document.body.style.overflow = originalOverflow;
});
</script>
<template>
  <button
    ref="trigger"
    class="button secondary bulk-fill-trigger"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-describedby="missingCount ? reminderId : undefined"
    :title="
      missingCount
        ? t('{p0} 个项目缺少负责人或阶段，点击补齐', { p0: missingCount })
        : t('项目信息已补齐，可继续编辑')
    "
    @click="start"
  >
    {{ missingCount ? t("批量补齐信息") : t("批量编辑信息") }}
    <span v-if="missingCount" class="bulk-completion-badge" aria-hidden="true"
      >{{ t("待补") }} {{ missingCount > 99 ? "99+" : missingCount }}</span
    >
  </button>
  <span v-if="missingCount" :id="reminderId" hidden
    >{{ missingCount }}
    {{ t("个项目缺少负责人或阶段，点击补齐。客户为选填项。") }}</span
  >
  <Teleport :to="teleportTarget">
    <div v-if="open" class="bulk-overlay">
      <section
        ref="dialog"
        class="bulk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
        tabindex="-1"
        @keydown="dialogKey"
      >
        <header class="sheet-header">
          <div class="sheet-heading">
            <span class="sheet-icon"><PhTable :size="22" /></span>
            <div>
              <h2 id="bulk-title">{{ t("项目信息") }}</h2>
              <p>
                {{ t("补齐负责人和业务阶段即可；客户可选填，支持 Excel 粘贴") }}
              </p>
            </div>
          </div>
          <button
            class="icon-button"
            :disabled="saving"
            :aria-label="t('关闭项目信息')"
            @click="close"
          >
            <PhX :size="20" />
          </button>
        </header>
        <div class="sheet-scope" role="group" :aria-label="t('项目信息范围')">
          <button
            :aria-pressed="scope === 'missing'"
            :disabled="saving"
            @click="setScope('missing')"
          >
            {{ t("待补全") }} {{ missingRows.length }}
          </button>
          <button
            :aria-pressed="scope === 'all'"
            :disabled="saving"
            @click="setScope('all')"
          >
            {{ t("全部项目") }} {{ rows.length }}
          </button>
        </div>
        <div class="sheet-toolbar">
          <div class="sheet-search">
            <PhMagnifyingGlass :size="15" /><input
              v-model="search"
              :disabled="saving"
              :aria-label="t('搜索项目')"
              :placeholder="t('搜索项目')"
            />
          </div>
          <span class="sheet-total"
            >{{ visible.length }} {{ t("个项目") }}</span
          >
          <span class="toolbar-spacer" />
          <button
            class="icon-button"
            :disabled="saving || !undoStack.length"
            :aria-label="t('撤销')"
            :title="t('撤销 Ctrl / ⌘ + Z')"
            @click="history()"
          >
            <PhArrowCounterClockwise :size="18" />
          </button>
          <button
            class="icon-button"
            :disabled="saving || !redoStack.length"
            :aria-label="t('重做')"
            :title="t('重做 Ctrl / ⌘ + Shift + Z')"
            @click="history(true)"
          >
            <PhArrowClockwise :size="18" />
          </button>
          <span class="toolbar-divider" />
          <button
            class="fill-toggle"
            :disabled="saving"
            :aria-expanded="bulk"
            @click="
              commitEdit();
              bulk = !bulk;
            "
          >
            {{ t("统一填入")
            }}<PhCaretDown :size="13" :class="{ rotated: bulk }" />
          </button>
        </div>
        <div v-if="bulk" class="bulk-common">
          <label
            ><span>{{ t("统一负责人") }}</span
            ><PersonPicker
              v-model="owner"
              :label="t('统一负责人')"
              :disabled="saving"
              compact
          /></label>
          <label
            ><span>{{ t("统一阶段") }}</span
            ><select
              v-model="stage"
              :disabled="saving"
              :aria-label="t('统一阶段')"
            >
              <option value="">{{ t("暂不填写") }}</option>
              <option v-for="s in activeStages" :key="s.id" :value="s.id">
                {{ catalogLabel("stages", s.id) }}
              </option>
            </select></label
          >
          <label
            ><span>{{ t("统一客户") }}</span
            ><input
              v-model="client"
              :disabled="saving"
              maxlength="120"
              :aria-label="t('统一客户')"
              :placeholder="t('客户名称')"
          /></label>
          <label class="check"
            ><input v-model="emptyOnly" :disabled="saving" type="checkbox" />{{
              t("仅填空缺")
            }}</label
          >
          <button :disabled="!selected.length || saving" @click="apply">
            {{ t("填入") }} {{ selected.length }} {{ t("个项目") }}
          </button>
        </div>
        <div class="sheet-formula">
          <span class="cell-address">{{ address }}</span
          ><span class="formula-divider" /><PhLockSimple
            v-if="!active"
            :size="13"
          /><span class="formula-value">{{
            editing
              ? draft
              : active
                ? valueLabel(
                    rows.find((r) => r.id === active!.id)!,
                    projectSheetFields[active.col]!,
                  ) || t("点击填写")
                : t("项目名称保留原样，编辑负责人、阶段和客户")
          }}</span
          ><span v-if="rangeCount > 1" class="range-count"
            >{{ t("已选") }} {{ rangeCount }} {{ t("格") }}</span
          >
        </div>
        <div
          ref="grid"
          class="sheet-scroll"
          @keydown.capture="key"
          @copy="copy"
          @paste="paste"
        >
          <table
            role="grid"
            :aria-label="t('项目信息表格')"
            :aria-rowcount="visible.length + 1"
            aria-colcount="5"
            aria-multiselectable="true"
            :aria-busy="saving"
          >
            <colgroup>
              <col class="row-number-col" />
              <col class="project-col" />
              <col class="owner-col" />
              <col class="stage-col" />
              <col class="client-col" />
            </colgroup>
            <thead>
              <tr role="row">
                <th role="columnheader" class="row-gutter">
                  <input
                    type="checkbox"
                    :aria-label="t('选择全部显示项目')"
                    :disabled="saving"
                    :checked="allSelected"
                    :indeterminate="someSelected"
                    @change="
                      visible.forEach(
                        (r) =>
                          (r.selected = (
                            $event.target as HTMLInputElement
                          ).checked),
                      )
                    "
                  />
                </th>
                <th role="columnheader" class="project-header">
                  <span class="column-letter">A</span>{{ t("项目")
                  }}<PhLockSimple :size="12" />
                </th>
                <th
                  v-for="(label, col) in labels"
                  :key="label"
                  role="columnheader"
                >
                  <span class="column-letter">{{
                    String.fromCharCode(66 + col)
                  }}</span
                  >{{ t(label)
                  }}<span class="column-edit">{{ t("可编辑") }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in visible"
                :key="row.id"
                role="row"
                :aria-rowindex="index + 2"
                :class="{ 'row-changed': changed(row) }"
              >
                <th role="rowheader" class="row-gutter">
                  <label class="row-select" :class="{ checked: row.selected }"
                    ><input
                      v-model="row.selected"
                      :disabled="saving"
                      type="checkbox"
                      :aria-label="t('选择') + row.name"
                    /><span>{{ index + 1 }}</span></label
                  >
                </th>
                <td
                  role="gridcell"
                  class="project-cell"
                  :title="
                    row.name +
                    ' · ' +
                    (missingProjectFields(row).length
                      ? t('待补：') +
                        missingProjectFields(row)
                          .map((field) => t(field))
                          .join(', ')
                      : changed(row)
                        ? t('资料齐全，修改待保存')
                        : t('资料齐全'))
                  "
                >
                  <span class="project-name">{{ row.name }}</span
                  ><span
                    v-if="changed(row)"
                    class="row-dot"
                    :title="t('有未保存修改')"
                  />
                </td>
                <td
                  v-for="(field, col) in projectSheetFields"
                  :key="field"
                  role="gridcell"
                  :tabindex="isActive(row.id, col) ? 0 : -1"
                  :data-row-id="row.id"
                  :data-col="col"
                  :data-editing="isEditing(row.id, col)"
                  :aria-label="row.name + ' ' + t(labels[col]!)"
                  :aria-selected="inRange(index, col)"
                  :aria-readonly="saving"
                  :class="[
                    'sheet-cell',
                    {
                      'cell-active': isActive(row.id, col),
                      'cell-range': inRange(index, col),
                      'cell-changed': changed(row, field),
                    },
                  ]"
                  @click="pickCell(row, col, $event)"
                >
                  <template v-if="isEditing(row.id, col)">
                    <PersonPicker
                      v-if="field === 'owner'"
                      v-model="draft"
                      :project-id="row.id"
                      :label="row.name + t('负责人')"
                      :disabled="saving"
                      auto-open
                      compact
                      @select="
                        commitEdit();
                        move(1, 0);
                      "
                      @cancel="commitEdit()"
                    />
                    <select
                      v-else-if="field === 'stage'"
                      v-model="draft"
                      :aria-label="row.name + t('阶段')"
                      :disabled="saving"
                      class="cell-input"
                      @change="
                        commitEdit();
                        move(1, 0);
                      "
                      @blur="commitEdit"
                    >
                      <option value="unclassified">{{ t("阶段待补") }}</option>
                      <option
                        v-for="s in activeStages"
                        :key="s.id"
                        :value="s.id"
                      >
                        {{ catalogLabel("stages", s.id) }}
                      </option>
                      <option
                        v-if="
                          row.stage !== 'unclassified' &&
                          !activeStages.some((s) => s.id === row.stage)
                        "
                        :value="row.stage"
                      >
                        {{ catalogLabel("stages", row.stage) }}
                      </option>
                    </select>
                    <input
                      v-else
                      v-model="draft"
                      class="cell-input"
                      :aria-label="row.name + t('客户')"
                      :disabled="saving"
                      maxlength="120"
                      :placeholder="t('输入客户名称')"
                      @blur="commitEdit"
                    />
                  </template>
                  <template v-else>
                    <span
                      v-if="field === 'stage'"
                      class="stage-value"
                      :style="stageColors(row.stage)"
                      ><i />{{ catalogLabel("stages", row.stage) }}</span
                    >
                    <span
                      v-else-if="valueLabel(row, field)"
                      class="cell-value"
                      :title="valueLabel(row, field)"
                      ><span v-if="field === 'owner'" class="owner-initial">{{
                        row.owner.slice(0, 1)
                      }}</span
                      >{{ valueLabel(row, field) }}</span
                    >
                    <span v-else class="cell-placeholder">{{
                      field === "owner" ? t("待填写") : "—"
                    }}</span>
                  </template>
                </td>
              </tr>
              <tr v-if="!visible.length">
                <td colspan="5" class="sheet-empty">
                  <template v-if="search.trim()">{{
                    t("没有找到项目，请调整搜索内容。")
                  }}</template>
                  <template v-else-if="scope === 'missing' && rows.length">
                    {{ t("项目信息已补齐，可在“全部项目”继续编辑。") }}
                  </template>
                  <template v-else>{{ t("暂无项目。") }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sheet-status">
          <span
            >{{ selected.length }} {{ t("个已勾选")
            }}<span v-if="pending.length">
              · <strong>{{ pending.length }} {{ t("个已修改") }}</strong></span
            ></span
          ><span class="interaction-hint"
            ><PhClipboardText :size="14" />{{
              t("Enter 换行 · Tab 换列 · Shift 选择多格 ·")
            }}
            {{
              rangeCount > 1
                ? t("Ctrl / ⌘ + D 向下填充")
                : t("可直接粘贴 Excel 表格")
            }}</span
          >
        </div>
        <p v-if="error" class="sheet-error" role="alert">{{ t(error) }}</p>
        <p v-else-if="message" class="sheet-message" role="status">
          {{ t(message) }}
        </p>
        <footer class="sheet-footer">
          <span class="footer-note">{{ t("修改会自动勾选，保存后生效") }}</span>
          <div>
            <button :disabled="saving" @click="close">{{ t("取消") }}</button
            ><button
              class="primary"
              :disabled="saving || (!pending.length && !editing)"
              @click="save"
            >
              <PhCheck :size="16" />{{
                saving
                  ? t("保存中…")
                  : pending.length
                    ? t("保存 ") + pending.length + t(" 个项目")
                    : t("保存修改")
              }}
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.bulk-fill-trigger {
  position: relative;
  overflow: visible;
}
.bulk-completion-badge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 6px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-raised);
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.bulk-overlay {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: var(--scrim);
  display: grid;
  place-items: center;
  padding: 24px;
}
.bulk-dialog {
  width: min(1180px, 100%);
  height: min(760px, 90dvh);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
  outline: none;
  color: var(--text);
  font-size: 13px;
}
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 16px;
}
.sheet-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.sheet-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: var(--accent-bg);
  color: var(--accent);
  border-radius: 9px;
}
h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.4;
  font-weight: 650;
}
.sheet-heading p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.sheet-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-top: 1px solid var(--border);
  background: var(--surface-subtle);
}
.sheet-scope {
  display: flex;
  gap: 8px;
  padding: 0 20px 10px;
}
.sheet-scope button {
  min-height: 30px;
  padding: 4px 10px;
  font-size: 12px;
}
.sheet-scope button[aria-pressed="true"] {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-bg);
}
.sheet-search {
  position: relative;
  display: flex;
  align-items: center;
}
.sheet-search svg {
  position: absolute;
  left: 10px;
  color: var(--muted);
  pointer-events: none;
}
.sheet-search input {
  width: 220px;
  height: 30px;
  padding: 4px 10px 4px 32px;
  font-size: 12px;
  background: var(--surface);
}
.sheet-total,
.range-count {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.toolbar-spacer {
  flex: 1;
}
.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.fill-toggle {
  height: 30px;
  min-height: 30px;
  font-size: 12px;
  padding: 4px 10px;
  background: var(--surface);
}
.rotated {
  transform: rotate(180deg);
}
.bulk-common {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 12px 20px;
  background: var(--surface-subtle);
  border-top: 1px solid var(--border);
}
.bulk-common > label:not(.check) {
  flex: 1;
  min-width: 0;
  gap: 4px;
  font-size: 11px;
}
.bulk-common input:not([type="checkbox"]),
.bulk-common select {
  width: 100%;
  height: 32px;
  font-size: 12px;
  padding: 4px 8px;
}
.bulk-common :deep(.person-search input) {
  height: 32px;
  padding-top: 4px;
  padding-bottom: 4px;
}
.bulk-common :deep(.person-search > svg) {
  top: 9px;
}
.bulk-common .check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  height: 32px;
}
.bulk-common button {
  height: 32px;
  min-height: 32px;
  font-size: 12px;
}
.sheet-formula {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 34px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 0 16px 0 0;
  font-size: 12px;
  background: var(--surface);
}
.cell-address {
  min-width: 64px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--accent);
}
.formula-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
}
.formula-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}
.sheet-scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--surface);
}
table {
  width: 100%;
  min-width: 740px;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}
.row-number-col {
  width: 52px;
}
.project-col {
  width: 29%;
}
.owner-col {
  width: 22%;
}
.stage-col {
  width: 21%;
}
.client-col {
  width: 28%;
}
th,
td {
  padding: 0;
  text-align: left;
  height: 36px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
}
th:last-child,
td:last-child {
  border-right: 0;
}
thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--surface-raised);
  height: 36px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.column-letter {
  margin-right: 10px;
  font-size: 10px;
  color: var(--muted);
  font-weight: 400;
}
.column-edit {
  float: right;
  font-size: 10px;
  color: var(--muted);
  font-weight: 400;
}
.project-header > svg {
  margin-left: 8px;
  vertical-align: -2px;
  color: var(--muted);
}
.row-gutter {
  position: sticky;
  left: 0;
  z-index: 2;
  text-align: center;
  background: var(--surface-subtle);
  color: var(--muted);
  padding: 0;
}
thead .row-gutter {
  z-index: 4;
}
.row-select {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  height: 35px;
  gap: 0;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
}
.row-select input {
  position: absolute;
  opacity: 0;
  width: 14px;
  height: 14px;
}
.row-select:hover input,
.row-select:focus-within input,
.row-select.checked input {
  opacity: 1;
}
.row-select:hover span,
.row-select:focus-within span,
.row-select.checked span {
  visibility: hidden;
}
input[type="checkbox"] {
  width: 14px;
  height: 14px;
  min-height: 0;
  padding: 0;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}
.project-cell {
  position: sticky;
  left: 52px;
  z-index: 1;
  background: var(--surface);
  padding: 0 12px;
  border-right: 2px solid var(--border);
}
.project-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 35px;
  max-width: calc(100% - 12px);
  font-weight: 500;
}
.row-dot {
  position: absolute;
  right: 8px;
  top: 15px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}
.sheet-cell {
  position: relative;
  cursor: text;
  outline: 0;
  padding: 0 12px;
  transition: background 0.1s;
}
.sheet-cell:hover {
  background: var(--surface-hover);
}
.sheet-cell.cell-range {
  background: var(--accent-bg);
}
.sheet-cell.cell-active {
  box-shadow: inset 0 0 0 2px var(--primary);
  z-index: 1;
}
.cell-active:after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  width: 5px;
  height: 5px;
  background: var(--primary);
  pointer-events: none;
}
.cell-changed:before {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  border-top: 5px solid var(--accent);
  border-left: 5px solid transparent;
}
.cell-value {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  line-height: 35px;
}
.owner-initial {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  flex: none;
  background: var(--surface-raised);
  color: var(--text-secondary);
  border-radius: 50%;
  font-size: 10px;
  line-height: 1;
}
.cell-placeholder {
  color: var(--placeholder);
  font-size: 11px;
}
.stage-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 18px;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stage-value i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
.sheet-cell[data-editing="true"] {
  padding: 0;
  background: var(--surface);
}
.cell-input {
  width: 100%;
  height: 35px;
  border: 0 !important;
  border-radius: 0;
  padding: 4px 12px;
  font-size: 12px;
  background: transparent;
  outline: 0 !important;
}
.sheet-cell :deep(.person-picker) {
  height: 35px;
}
.sheet-cell :deep(.person-search input) {
  height: 35px;
  min-height: 0;
  font-size: 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  outline: none;
  padding: 4px 28px;
}
.sheet-cell :deep(.person-search > svg) {
  top: 10px;
  left: 8px;
}
.sheet-cell :deep(.clear-person) {
  top: 3px;
  min-height: 28px;
}
.sheet-empty {
  text-align: center;
  height: 100px;
  color: var(--muted);
}
.sheet-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
  background: var(--surface-subtle);
}
.sheet-status strong {
  color: var(--accent);
  font-weight: 500;
}
.interaction-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
}
.sheet-error,
.sheet-message {
  margin: 0;
  padding: 8px 20px;
  font-size: 12px;
  line-height: 1.4;
}
.sheet-error {
  color: var(--danger);
  background: var(--danger-bg);
  border-top: 1px solid var(--danger-border);
}
.sheet-message {
  color: var(--accent);
  background: var(--accent-bg);
}
.sheet-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.footer-note {
  color: var(--muted);
  font-size: 11px;
}
.sheet-footer > div {
  display: flex;
  gap: 8px;
}
.sheet-footer button {
  font-size: 12px;
  min-height: 34px;
}
@media (max-width: 700px) {
  .bulk-overlay {
    padding: 8px;
  }
  .bulk-dialog {
    height: 94dvh;
    border-radius: 9px;
  }
  .sheet-header {
    padding: 14px 12px;
  }
  .sheet-icon {
    display: none;
  }
  h2 {
    font-size: 16px;
  }
  .sheet-toolbar {
    padding: 8px 10px;
    gap: 6px;
  }
  .sheet-search input {
    width: 150px;
  }
  .sheet-total,
  .interaction-hint,
  .footer-note {
    display: none;
  }
  .sheet-footer {
    justify-content: flex-end;
    padding: 10px;
  }
  .sheet-status {
    padding: 8px 10px;
  }
  .bulk-common {
    flex-wrap: wrap;
    padding: 10px;
  }
  .bulk-common > label:not(.check) {
    flex: 1 1 130px;
  }
  .project-col {
    width: 220px;
  }
  .project-cell {
    position: static;
  }
  .owner-col {
    width: 180px;
  }
  .stage-col {
    width: 170px;
  }
  .client-col {
    width: 210px;
  }
}
</style>
