<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  ElAvatar,
  ElButton,
  ElConfigProvider,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTree,
  type TreeNodeData,
} from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import en from "element-plus/es/locale/lang/en";
import "element-plus/es/components/avatar/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/form/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/select/style/css";
import "element-plus/es/components/switch/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/tag/style/css";
import "element-plus/es/components/tree/style/css";
import "element-plus/theme-chalk/dark/css-vars.css";
import {
  PhArrowClockwise,
  PhBuildings,
  PhCheckCircle,
  PhLink,
  PhMagnifyingGlass,
  PhPlus,
  PhSlidersHorizontal,
  PhUsers,
  PhUsersThree,
} from "@phosphor-icons/vue";
import {
  suggestedLoginName,
  availableLoginName,
} from "../../../../packages/domain/login-name";
import { ZodError } from "zod";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import {
  directorySchema,
  emptyDirectory,
  type CompanyDirectory,
  type Department,
  type Employee,
  type WecomSyncState,
} from "../../../../packages/domain/directory";
import { useUnsaved } from "../composables/unsaved";
import { useTheme } from "../composables/theme";
import { t, locale, formatDate, formatNumber } from "../locales";

const store = useWorkspace();
const { theme } = useTheme();
const directory = ref<CompanyDirectory>(emptyDirectory());
const sync = ref<WecomSyncState>({
  configured: false,
  lastSyncedAt: null,
  mode: store.mode,
});
const accounts = ref<
  {
    id: string;
    name: string;
    email: string;
    username?: string;
    status?: string;
  }[]
>([]);
const loading = ref(true),
  error = ref(""),
  query = ref(""),
  department = ref(""),
  treeSearch = ref("");
const availability = ref("all"),
  association = ref("all"),
  organizationExpanded = ref(false);
const tree = ref<InstanceType<typeof ElTree> | null>(null);
const employeeOpen = ref(false),
  organizationOpen = ref(false),
  employeeDraft = ref<Employee | null>(null);
const orgDraft = ref<CompanyDirectory>(emptyDirectory()),
  newDepartment = ref("");
let employeeBaseline = "",
  organizationBaseline = "";
const canManage = computed(
  () => store.mode === "local" || store.user?.role === "admin",
);
const dirty = computed(
  () =>
    (employeeOpen.value &&
      JSON.stringify(employeeDraft.value) !== employeeBaseline) ||
    (organizationOpen.value &&
      JSON.stringify(orgDraft.value) !== organizationBaseline),
);
const discard = useUnsaved(dirty);
const loginNames = computed(() => {
  const used = new Set(
    accounts.value.map((a) => a.username?.toLowerCase()).filter(Boolean),
  );
  const result = new Map<string, string>();
  for (const person of directory.value.employees) {
    const account = accounts.value.find((a) => a.id === person.userId);
    if (account?.username) {
      result.set(person.id, account.username);
      continue;
    }
    const suggested = availableLoginName(
      suggestedLoginName(person.name),
      (value) => used.has(value),
    );
    used.add(suggested);
    result.set(person.id, suggested);
  }
  return result;
});
const linkedCount = computed(
  () => directory.value.employees.filter((e) => e.wecomUserId).length,
);
const activeCount = computed(
  () => directory.value.employees.filter((e) => e.active).length,
);
function descendants(id: string) {
  const ids = new Set([id]),
    queue = [id];
  while (queue.length) {
    const next = queue.pop();
    for (const d of directory.value.departments) {
      if (d.parentId === next && !ids.has(d.id)) {
        ids.add(d.id);
        queue.push(d.id);
      }
    }
  }
  return ids;
}
const departmentScope = computed(() =>
  department.value ? descendants(department.value) : null,
);
const employees = computed(() =>
  directory.value.employees.filter(
    (e) =>
      (!departmentScope.value ||
        e.departmentIds.some((id) => departmentScope.value!.has(id))) &&
      (!query.value ||
        (e.name + " " + e.employeeNo + " " + e.position + " " + e.wecomUserId)
          .toLowerCase()
          .includes(query.value.toLowerCase())) &&
      (availability.value === "all" ||
        e.active === (availability.value === "active")) &&
      (association.value === "all" ||
        !!e.wecomUserId === (association.value === "linked")),
  ),
);
const selectedName = computed(
  () =>
    directory.value.departments.find((d) => d.id === department.value)?.name ??
    t("All people"),
);
interface DepartmentNode {
  id: string;
  name: string;
  count: number;
  children: DepartmentNode[];
}
const organization = computed<DepartmentNode[]>(() => {
  const build = (d: Department): DepartmentNode => {
    const scope = descendants(d.id);
    return {
      id: d.id,
      name: d.name,
      count: directory.value.employees.filter((e) =>
        e.departmentIds.some((id) => scope.has(id)),
      ).length,
      children: directory.value.departments
        .filter((child) => child.parentId === d.id)
        .map(build),
    };
  };
  return [
    {
      id: "__company__",
      name: directory.value.companyName,
      count: directory.value.employees.length,
      children: directory.value.departments
        .filter((d) => !d.parentId)
        .map(build),
    },
  ];
});
watch(treeSearch, (value) => tree.value?.filter(value));
const treeFilter = (value: string, data: TreeNodeData) =>
  !value || String(data.name).toLowerCase().includes(value.toLowerCase());
function selectDepartment(data: DepartmentNode) {
  department.value = data.id === "__company__" ? "" : data.id;
}
const tones = ["blue", "amber", "teal", "blue", "rose"];
function tone(id: string) {
  return tones[
    Math.max(
      0,
      directory.value.departments.findIndex((d) => d.id === id),
    ) % tones.length
  ];
}
function departmentLabel(id: string) {
  return directory.value.departments.find((d) => d.id === id)?.name ?? id;
}
function message(e: unknown) {
  return e instanceof ZodError
    ? t("Check names, employee numbers, departments and account links.")
    : e instanceof Error
      ? t(e.message)
      : t("Changes could not be saved");
}
async function load() {
  if (!discard()) return;
  loading.value = true;
  error.value = "";
  try {
    const [data, state, users] = await Promise.all([
      api.companyDirectory(),
      api.wecomSyncState(),
      api.directoryAccounts(),
    ]);
    directory.value = data;
    sync.value = state;
    accounts.value = users;
  } catch (e) {
    error.value = message(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
async function persist(data: CompanyDirectory) {
  error.value = "";
  const input = directorySchema.parse(data);
  const result = await store.operation(
    () => api.saveCompanyDirectory(input),
    t("Company directory saved"),
  );
  directory.value = result;
  return result;
}
function editEmployee(person?: Employee) {
  if (!canManage.value || store.busy || !discard()) return;
  employeeDraft.value = person
    ? JSON.parse(JSON.stringify(person))
    : {
        id: crypto.randomUUID(),
        name: "",
        employeeNo: "",
        position: "",
        departmentIds: department.value ? [department.value] : [],
        email: "",
        userId: null,
        wecomUserId: "",
        active: true,
        source: "manual",
      };
  employeeBaseline = JSON.stringify(employeeDraft.value);
  error.value = "";
  employeeOpen.value = true;
}
function cancelEmployee() {
  employeeOpen.value = false;
  error.value = "";
}
async function saveEmployee() {
  if (!employeeDraft.value || store.busy) return;
  try {
    const person = employeeDraft.value;
    const existing = directory.value.employees.some((e) => e.id === person.id);
    await persist({
      ...directory.value,
      employees: existing
        ? directory.value.employees.map((e) =>
            e.id === person.id ? person : e,
          )
        : [...directory.value.employees, person],
    });
    employeeOpen.value = false;
  } catch (e) {
    error.value = message(e);
  }
}
function editOrganization() {
  if (!canManage.value || store.busy || !discard()) return;
  orgDraft.value = JSON.parse(JSON.stringify(directory.value));
  organizationBaseline = JSON.stringify(orgDraft.value);
  error.value = "";
  organizationOpen.value = true;
}
function addDepartment() {
  if (!newDepartment.value.trim()) return;
  orgDraft.value.departments.push({
    id: crypto.randomUUID(),
    name: newDepartment.value.trim(),
    parentId: null,
    wecomId: null,
  });
  newDepartment.value = "";
}
function possibleParents(id: string) {
  const excluded = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of orgDraft.value.departments)
      if (d.parentId && excluded.has(d.parentId) && !excluded.has(d.id)) {
        excluded.add(d.id);
        changed = true;
      }
  }
  return orgDraft.value.departments.filter((d) => !excluded.has(d.id));
}
async function saveOrganization() {
  try {
    await persist(orgDraft.value);
    organizationOpen.value = false;
  } catch (e) {
    error.value = message(e);
  }
}
async function synchronize() {
  if (dirty.value) {
    error.value = t("Save directory changes before syncing.");
    return;
  }
  error.value = "";
  try {
    directory.value = await store.operation(
      () => api.syncWecom(directory.value.version),
      t("Company directory synced"),
    );
    sync.value = await api.wecomSyncState();
  } catch (e) {
    error.value = message(e);
  }
}
</script>

<template>
  <ElConfigProvider :locale="locale === 'zh-CN' ? zhCn : en" size="small">
    <section class="page directory-page" :class="{ dark: theme === 'dark' }">
      <div class="directory-heading">
        <div>
          <div class="directory-eyebrow">{{ t("WORKSPACE / TEAM") }}</div>
          <h1>{{ t("Team") }}</h1>
          <p>
            {{
              t(
                "Manage team members and departments. Editing a project or task automatically joins its project team.",
              )
            }}
          </p>
        </div>
        <div class="directory-actions">
          <ElButton :disabled="loading || store.busy" @click="load"
            ><PhArrowClockwise :size="15" />{{ t("Refresh") }}</ElButton
          >
          <ElButton
            v-if="canManage"
            type="primary"
            :disabled="loading || store.busy"
            @click="editEmployee()"
            ><PhPlus :size="15" />{{ t("Add person") }}</ElButton
          >
        </div>
      </div>
      <div class="company-strip">
        <div class="company-identity">
          <span class="company-icon"
            ><PhBuildings :size="22" weight="duotone" /></span
          ><strong>{{ directory.companyName }}</strong
          ><span class="company-divider"></span
          ><span
            ><PhUsers :size="15" />{{
              t("{count} people", {
                count: formatNumber(directory.employees.length),
              })
            }}</span
          ><span>{{
            t("{count} departments", {
              count: formatNumber(directory.departments.length),
            })
          }}</span>
        </div>
        <div class="company-connection">
          <ElTag :type="sync.configured ? 'success' : 'info'" effect="plain"
            ><PhLink :size="13" />{{
              t(
                sync.configured
                  ? "Enterprise connection configured"
                  : "Enterprise connection not configured",
              )
            }}</ElTag
          ><span>{{
            t("{count} linked", { count: formatNumber(linkedCount) })
          }}</span
          ><ElButton
            v-if="canManage"
            link
            type="primary"
            :disabled="!sync.configured || store.busy || dirty"
            @click="synchronize"
            >{{
              t(store.busy ? "Syncing…" : "Sync enterprise directory")
            }}</ElButton
          >
        </div>
      </div>
      <p
        v-if="error && !employeeOpen && !organizationOpen"
        class="error-box"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="directory-layout">
        <aside
          class="organization-panel"
          :class="{ 'mobile-expanded': organizationExpanded }"
        >
          <div class="organization-heading">
            <h2>{{ t("Organization") }}</h2>
            <ElButton
              v-if="canManage"
              link
              :aria-label="t('Manage organization')"
              @click="editOrganization"
              ><PhSlidersHorizontal :size="17" /></ElButton
            ><button
              class="organization-toggle"
              type="button"
              :aria-expanded="organizationExpanded"
              @click="organizationExpanded = !organizationExpanded"
            >
              {{ t("Expand departments") }}
            </button>
          </div>
          <div class="organization-content">
            <ElInput
              v-model="treeSearch"
              clearable
              :aria-label="t('Search departments')"
              :placeholder="t('Search departments')"
              ><template #prefix><PhMagnifyingGlass :size="14" /></template
            ></ElInput>
            <ElTree
              ref="tree"
              class="organization-tree"
              :data="organization"
              :props="{ label: 'name', children: 'children' }"
              node-key="id"
              default-expand-all
              highlight-current
              :current-node-key="department || '__company__'"
              :filter-node-method="treeFilter"
              @node-click="selectDepartment"
            >
              <template #default="{ data }"
                ><div class="department-node" :data-department="data.id">
                  <component
                    :is="data.id === '__company__' ? PhBuildings : PhUsersThree"
                    :size="15"
                    class="department-icon"
                    :class="
                      data.id === '__company__'
                        ? 'tone-purple'
                        : 'tone-' + tone(data.id)
                    "
                  /><span class="department-label">{{ data.name }}</span
                  ><span class="department-count">{{
                    formatNumber(data.count)
                  }}</span>
                </div></template
              >
            </ElTree>
            <div class="organization-foot">
              <PhCheckCircle :size="14" /><span>{{
                t("{count} enabled people", {
                  count: formatNumber(activeCount),
                })
              }}</span>
            </div>
          </div>
        </aside>
        <div class="directory-table-panel">
          <div class="people-toolbar">
            <div class="people-title">
              <h2>{{ selectedName }}</h2>
              <span>{{ formatNumber(employees.length) }}</span>
            </div>
            <div class="people-filters">
              <ElInput
                v-model="query"
                class="people-search"
                clearable
                :aria-label="t('Search people')"
                :placeholder="t('Search name, employee number or position')"
                ><template #prefix
                  ><PhMagnifyingGlass :size="15" /></template></ElInput
              ><ElSelect
                v-model="availability"
                :aria-label="t('Filter availability')"
                ><ElOption :label="t('All statuses')" value="all" /><ElOption
                  :label="t('Enabled')"
                  value="active" /><ElOption
                  :label="t('Disabled')"
                  value="inactive" /></ElSelect
              ><ElSelect
                v-model="association"
                :aria-label="t('Filter enterprise association')"
                ><ElOption
                  :label="t('All associations')"
                  value="all" /><ElOption
                  :label="t('Linked')"
                  value="linked" /><ElOption
                  :label="t('Not linked')"
                  value="unlinked"
              /></ElSelect>
            </div>
          </div>
          <ElTable
            class="directory-data-table"
            :data="employees"
            row-key="id"
            :max-height="'calc(100dvh - 286px)'"
            :empty-text="t(loading ? 'Loading…' : 'No people match')"
            @row-dblclick="editEmployee"
          >
            <ElTableColumn
              type="index"
              width="44"
              align="center"
              fixed="left"
            />
            <ElTableColumn
              prop="name"
              :label="t('Name')"
              min-width="160"
              fixed="left"
              sortable
              ><template #default="{ row }"
                ><div
                  class="person-identity"
                  :title="
                    canManage ? t('Double-click to edit person') : row.name
                  "
                >
                  <ElAvatar
                    :size="26"
                    class="person-avatar"
                    :class="'tone-' + tone(row.departmentIds[0] ?? '')"
                    >{{ row.name.slice(0, 1) }}</ElAvatar
                  ><strong>{{ row.name }}</strong>
                </div></template
              ></ElTableColumn
            >
            <ElTableColumn :label="t('Login name')" min-width="140"
              ><template #default="{ row }"
                ><div
                  class="directory-login-name"
                  :title="
                    t(
                      row.userId
                        ? 'Linked login account'
                        : 'Suggested only. Create and activate an account before signing in.',
                    )
                  "
                >
                  <code>{{ loginNames.get(row.id) }}</code
                  ><small v-if="!row.userId">{{ t("Suggested") }}</small>
                </div></template
              ></ElTableColumn
            >
            <ElTableColumn
              prop="employeeNo"
              :label="t('Employee number')"
              width="112"
              sortable
              ><template #default="{ row }"
                ><span class="employee-number">{{
                  row.employeeNo || "—"
                }}</span></template
              ></ElTableColumn
            >
            <ElTableColumn
              :label="t('Department')"
              min-width="148"
              show-overflow-tooltip
              ><template #default="{ row }"
                ><div class="department-tags">
                  <ElTag
                    v-for="id in row.departmentIds"
                    :key="id"
                    class="department-tag"
                    :class="'tone-' + tone(id)"
                    effect="plain"
                    >{{ departmentLabel(id) }}</ElTag
                  ><span v-if="!row.departmentIds.length" class="muted">{{
                    t("Unassigned")
                  }}</span>
                </div></template
              ></ElTableColumn
            >
            <ElTableColumn
              prop="position"
              :label="t('Position')"
              min-width="180"
              show-overflow-tooltip
            />
            <ElTableColumn prop="active" :label="t('Status')" width="90"
              ><template #default="{ row }"
                ><ElTag
                  :type="row.active ? 'success' : 'info'"
                  effect="light"
                  class="availability-tag"
                  ><PhCheckCircle v-if="row.active" :size="12" />{{
                    t(row.active ? "Enabled" : "Disabled")
                  }}</ElTag
                ></template
              ></ElTableColumn
            >
            <ElTableColumn
              prop="wecomUserId"
              :label="t('Enterprise association')"
              min-width="128"
              ><template #default="{ row }"
                ><span
                  class="enterprise-association"
                  :class="{ linked: !!row.wecomUserId }"
                  :title="row.wecomUserId"
                  ><PhLink :size="14" />{{
                    t(row.wecomUserId ? "Linked" : "Not linked")
                  }}</span
                ></template
              ></ElTableColumn
            >
            <ElTableColumn
              v-if="canManage"
              :label="t('Actions')"
              width="72"
              fixed="right"
              ><template #default="{ row }"
                ><ElButton
                  link
                  type="primary"
                  @click="editEmployee(row as Employee)"
                  >{{ t("Edit") }}</ElButton
                ></template
              ></ElTableColumn
            >
          </ElTable>
          <div class="directory-table-foot">
            <span>{{
              t("Showing {count} people", {
                count: formatNumber(employees.length),
              })
            }}</span
            ><span>{{ t("Editors join project teams automatically") }}</span
            ><span v-if="sync.lastSyncedAt" class="last-sync"
              >{{ t("Last sync") }}
              {{
                formatDate(sync.lastSyncedAt, {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              }}</span
            >
          </div>
        </div>
      </div>
      <ElDialog
        v-model="employeeOpen"
        class="directory-person-dialog"
        :title="
          t(
            employeeDraft &&
              directory.employees.some((e) => e.id === employeeDraft?.id)
              ? 'Edit person'
              : 'Add person',
          )
        "
        width="min(580px, calc(100vw - 28px))"
        :close-on-click-modal="false"
        :close-on-press-escape="!store.busy"
        :show-close="!store.busy"
        destroy-on-close
      >
        <ElForm
          v-if="employeeDraft"
          :model="employeeDraft"
          label-position="top"
          :disabled="store.busy"
          class="person-form"
          @submit.prevent="saveEmployee"
        >
          <div class="person-form-grid">
            <ElFormItem :label="t('Name')" required
              ><ElInput
                v-model="employeeDraft.name"
                :aria-label="t('Name')"
                maxlength="80"
                autofocus /></ElFormItem
            ><ElFormItem :label="t('Employee number')"
              ><ElInput
                v-model="employeeDraft.employeeNo"
                :aria-label="t('Employee number')"
                maxlength="80" /></ElFormItem
            ><ElFormItem :label="t('Department')"
              ><ElSelect
                v-model="employeeDraft.departmentIds"
                multiple
                filterable
                :aria-label="t('Department')"
                ><ElOption
                  v-for="d in directory.departments"
                  :key="d.id"
                  :label="d.name"
                  :value="d.id" /></ElSelect></ElFormItem
            ><ElFormItem :label="t('Position')"
              ><ElInput
                v-model="employeeDraft.position"
                :aria-label="t('Position')"
                maxlength="120"
            /></ElFormItem>
          </div>
          <ElFormItem :label="t('Enterprise user ID')"
            ><ElInput
              v-model="employeeDraft.wecomUserId"
              :aria-label="t('Enterprise user ID')"
              maxlength="100"
              :placeholder="t('Optional enterprise identity')"
          /></ElFormItem>
          <details class="person-extra">
            <summary>{{ t("Account & email settings") }}</summary>
            <ElFormItem :label="t('Email')"
              ><ElInput
                v-model="employeeDraft.email"
                type="email"
                :aria-label="t('Email')" /></ElFormItem
            ><ElFormItem :label="t('Login account')"
              ><ElSelect
                v-model="employeeDraft.userId"
                clearable
                :aria-label="t('Login account')"
                @change="
                  (value) => {
                    if (employeeDraft) employeeDraft.userId = value || null;
                  }
                "
                ><ElOption :label="t('Not linked')" :value="''" /><ElOption
                  v-for="account in accounts"
                  :key="account.id"
                  :label="
                    account.name + ' · ' + (account.username || account.email)
                  "
                  :value="account.id" /></ElSelect
            ></ElFormItem>
          </details>
          <ElFormItem :label="t('Availability')"
            ><ElSwitch
              v-model="employeeDraft.active"
              :active-text="t('Enabled')"
              :inactive-text="t('Disabled')"
          /></ElFormItem>
          <p v-if="error" class="error-box" role="alert">{{ error }}</p>
          <div class="directory-dialog-actions">
            <ElButton :disabled="store.busy" @click="cancelEmployee">{{
              t("Cancel")
            }}</ElButton
            ><ElButton
              type="primary"
              native-type="submit"
              :disabled="store.busy || !employeeDraft.name.trim()"
              >{{ t(store.busy ? "Saving…" : "Save") }}</ElButton
            >
          </div>
        </ElForm>
      </ElDialog>
      <ElDialog
        v-model="organizationOpen"
        class="directory-org-dialog"
        :title="t('Manage organization')"
        width="min(760px, calc(100vw - 28px))"
        :close-on-click-modal="false"
        :close-on-press-escape="!store.busy"
        :show-close="!store.busy"
        destroy-on-close
      >
        <ElForm
          label-position="top"
          :disabled="store.busy"
          @submit.prevent="saveOrganization"
          ><ElFormItem :label="t('Company name')"
            ><ElInput
              v-model="orgDraft.companyName"
              :aria-label="t('Company name')"
              maxlength="120" /></ElFormItem
          ><ElTable :data="orgDraft.departments" row-key="id" max-height="380"
            ><ElTableColumn :label="t('Department name')" min-width="150"
              ><template #default="{ row }"
                ><ElInput
                  v-model="row.name"
                  :aria-label="t('Department name')"
                  maxlength="120" /></template></ElTableColumn
            ><ElTableColumn :label="t('Parent department')" min-width="155"
              ><template #default="{ row }"
                ><ElSelect
                  v-model="row.parentId"
                  :aria-label="t('Parent department')"
                  @change="(value) => (row.parentId = value || null)"
                  ><ElOption :value="''" :label="t('Company root')" /><ElOption
                    v-for="parent in possibleParents(row.id)"
                    :key="parent.id"
                    :value="parent.id"
                    :label="parent.name" /></ElSelect></template></ElTableColumn
            ><ElTableColumn
              :label="t('Enterprise department ID')"
              min-width="160"
              ><template #default="{ row }"
                ><ElInput
                  :model-value="row.wecomId == null ? '' : String(row.wecomId)"
                  :aria-label="t('Enterprise department ID')"
                  @update:model-value="
                    (value) =>
                      (row.wecomId = value.trim() ? Number(value) : null)
                  " /></template></ElTableColumn
          ></ElTable>
          <div class="new-department">
            <ElInput
              v-model="newDepartment"
              :aria-label="t('New department name')"
              :placeholder="t('New department name')"
              maxlength="120"
              @keydown.enter.prevent="addDepartment"
            /><ElButton :disabled="!newDepartment.trim()" @click="addDepartment"
              ><PhPlus :size="14" />{{ t("Add department") }}</ElButton
            >
          </div>
          <p v-if="error" class="error-box" role="alert">{{ error }}</p>
          <div class="directory-dialog-actions">
            <ElButton
              :disabled="store.busy"
              @click="
                organizationOpen = false;
                error = '';
              "
              >{{ t("Cancel") }}</ElButton
            ><ElButton
              type="primary"
              native-type="submit"
              :disabled="store.busy"
              >{{ t(store.busy ? "Saving…" : "Save") }}</ElButton
            >
          </div>
        </ElForm>
      </ElDialog>
    </section>
  </ElConfigProvider>
</template>

<style scoped>
.directory-page {
  --el-color-primary: var(--primary);
  --el-color-primary-light-9: color-mix(
    in srgb,
    var(--accent) 12%,
    var(--surface)
  );
  --el-color-primary-light-8: color-mix(
    in srgb,
    var(--accent) 20%,
    var(--surface)
  );
  --el-bg-color: var(--surface);
  --el-bg-color-overlay: var(--surface);
  --el-fill-color-blank: var(--surface);
  --el-fill-color-light: var(--surface-raised);
  --el-fill-color-lighter: var(--surface-subtle);
  --el-text-color-primary: var(--text);
  --el-text-color-regular: var(--text-secondary);
  --el-text-color-secondary: var(--muted);
  --el-border-color: var(--border);
  --el-border-color-light: var(--border);
  --el-border-color-lighter: var(--border);
  padding: 22px 24px;
}
.directory-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
}
.directory-eyebrow {
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.08em;
  margin-bottom: 5px;
}
.directory-heading h1 {
  font-size: 23px;
  margin: 0;
  line-height: 1.35;
}
.directory-heading p {
  margin: 7px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.directory-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.directory-page :deep(.el-button) {
  min-height: unset;
  gap: 6px;
}
.directory-page :deep(.el-button > span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.company-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  margin-bottom: 16px;
}
.company-identity,
.company-connection {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
}
.company-identity strong {
  font-size: 14px;
  color: var(--text);
}
.company-identity > span:not(.company-icon):not(.company-divider) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
}
.company-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}
.company-divider {
  height: 17px;
  width: 1px;
  background: var(--border);
}
.company-connection {
  color: var(--muted);
  gap: 10px;
}
.company-connection :deep(.el-tag__content) {
  display: flex;
  align-items: center;
  gap: 5px;
}
.directory-layout {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.organization-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
}
.organization-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 14px 10px;
}
.organization-heading h2,
.people-title h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.organization-content {
  padding: 0 12px;
}
.organization-tree {
  margin: 13px -3px 16px;
  background: transparent;
}
.organization-tree :deep(.el-tree-node__content) {
  height: 36px;
  border-radius: 5px;
  padding-right: 9px;
}
.organization-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: var(--el-color-primary-light-9);
}
.department-node {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  font-size: 12px;
}
.department-icon {
  flex-shrink: 0;
}
.department-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.department-count {
  color: var(--muted);
  font-size: 11px;
}
.organization-foot {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--muted);
  font-size: 11px;
  border-top: 1px solid var(--border);
  padding: 14px 0;
}
.organization-foot svg {
  color: var(--status-done);
}
.organization-toggle {
  display: none;
}
.directory-table-panel {
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
}
.people-toolbar {
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
}
.people-title {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.people-title > span {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  color: var(--accent);
  background: var(--el-color-primary-light-9);
}
.people-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.people-search {
  width: 260px;
}
.people-filters :deep(.el-select) {
  width: 114px;
}
.directory-data-table {
  --el-table-bg-color: var(--surface);
  --el-table-tr-bg-color: var(--surface);
  --el-table-header-bg-color: var(--surface-raised);
  --el-table-row-hover-bg-color: var(--surface-hover);
  --el-table-current-row-bg-color: var(--surface-selected);
  --el-table-header-text-color: var(--muted);
  --el-table-text-color: var(--text);
  --el-table-border-color: var(--border);
}
.directory-data-table :deep(.el-table__cell) {
  padding: 7px 0;
}
.directory-data-table :deep(th.el-table__cell) {
  font-size: 11px;
  font-weight: 500;
  padding: 9px 0;
}
.directory-data-table :deep(.cell) {
  padding: 0 14px;
  line-height: 20px;
  font-size: 12px;
}
.directory-data-table :deep(.el-table__inner-wrapper::before) {
  height: 0;
}
.person-identity {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.person-identity strong {
  font-weight: 500;
  font-size: 13px;
  white-space: nowrap;
}
.person-avatar {
  color: var(--tone, var(--accent));
  background: color-mix(
    in srgb,
    var(--tone, var(--accent)) 13%,
    var(--surface)
  );
  font-size: 12px;
  flex-shrink: 0;
}
.employee-number {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--text-secondary);
}
.department-tags {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: nowrap;
}
.department-tag {
  --el-tag-text-color: var(--tone, var(--accent));
  --el-tag-border-color: color-mix(
    in srgb,
    var(--tone, var(--accent)) 24%,
    transparent
  );
  --el-tag-bg-color: color-mix(
    in srgb,
    var(--tone, var(--accent)) 7%,
    transparent
  );
  font-size: 10px;
}
.tone-purple {
  --tone: var(--status-in-progress);
  color: var(--tone);
}
.tone-amber {
  --tone: var(--status-blocked);
  color: var(--tone);
}
.tone-teal {
  --tone: var(--status-done);
  color: var(--tone);
}
.tone-blue {
  --tone: var(--stage-approved);
  color: var(--tone);
}
.tone-rose {
  --tone: var(--stage-proposal);
  color: var(--tone);
}
.availability-tag {
  font-size: 10px;
}
.availability-tag :deep(.el-tag__content) {
  display: flex;
  gap: 4px;
  align-items: center;
}
.enterprise-association {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--muted);
}
.enterprise-association.linked {
  color: var(--status-done);
}
.directory-table-foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
}
.last-sync {
  margin-left: auto;
}
.person-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.person-form :deep(.el-select),
.person-form :deep(.el-input) {
  width: 100%;
}
.person-form :deep(.el-form-item) {
  margin-bottom: 15px;
}
.person-extra {
  border-top: 1px solid var(--border);
  margin: 2px 0 15px;
  padding-top: 12px;
}
.person-extra summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 10px;
}
.directory-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.new-department {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}
@media (max-width: 1100px) {
  .people-search {
    width: 210px;
  }
  .people-filters :deep(.el-select) {
    width: 100px;
  }
  .directory-layout {
    grid-template-columns: 200px minmax(0, 1fr);
  }
}
@media (max-width: 800px) {
  .directory-page {
    padding: 18px 14px;
  }
  .directory-heading {
    align-items: start;
    gap: 10px;
  }
  .directory-heading h1 {
    font-size: 20px;
  }
  .directory-heading p {
    max-width: 280px;
    font-size: 11px;
  }
  .company-strip {
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px;
  }
  .company-identity,
  .company-connection {
    gap: 9px;
    flex-wrap: wrap;
  }
  .directory-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .organization-heading {
    padding: 10px 12px;
  }
  .organization-toggle {
    display: inline-flex;
    background: none;
    border: 0;
    min-height: 28px;
    padding: 2px 0;
    color: var(--muted);
    font-size: 11px;
  }
  .organization-content {
    display: none;
  }
  .organization-panel.mobile-expanded .organization-content {
    display: block;
  }
  .people-toolbar {
    align-items: start;
    flex-direction: column;
    padding: 12px;
  }
  .people-filters {
    width: 100%;
    flex-wrap: wrap;
  }
  .people-search {
    width: 100%;
  }
  .people-filters :deep(.el-select) {
    flex: 1;
    width: 120px;
  }
  .directory-table-foot {
    padding: 10px 12px;
    flex-wrap: wrap;
  }
  .directory-table-foot > span:nth-child(2) {
    display: none;
  }
  .person-form-grid {
    grid-template-columns: 1fr;
  }
}
.directory-login-name {
  display: flex;
  align-items: center;
  gap: 7px;
}
.directory-login-name code {
  font-size: 12px;
  color: var(--text-secondary);
}
.directory-login-name small {
  font-size: 9px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 3px;
}
</style>
