<script setup lang="ts">
import {
  computed,
  ref,
  onMounted,
  onBeforeUnmount,
  nextTick,
  watch,
} from "vue";
import { useRoute } from "vue-router";
import {
  PhUsers,
  PhFolders,
  PhCpu,
  PhListBullets,
  PhShieldCheck,
  PhPlus,
  PhArrowClockwise,
  PhBell,
} from "@phosphor-icons/vue";
import ChannelManagement from "../components/ChannelManagement.vue";
import WecomNotificationSettings from "../components/WecomNotificationSettings.vue";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved, confirmDiscard } from "../composables/unsaved";
import { t, formatDate, formatNumber } from "../locales";
import {
  defaultCatalogs,
  defaultModelSettings,
  adminUserInput,
  adminUserUpdate,
  type ManagedUser,
  type Catalogs,
  type ModelAdminState,
  type ModelLog,
  type AdminAudit,
  type CatalogEntry,
} from "../../../../packages/domain/admin";
const store = useWorkspace();
const route = useRoute();
const allowed = computed(
  () => store.mode === "local" || store.user?.role === "admin",
);
const tabs = [
  { id: "users", label: "Users", icon: PhUsers },
  { id: "channels", label: t("渠道与项目信息"), icon: PhFolders },
  { id: "catalogs", label: "Stages & categories", icon: PhFolders },
  { id: "model", label: "Model settings", icon: PhCpu },
  { id: "notifications", label: t("企业微信通知"), icon: PhBell },
  { id: "logs", label: "Call logs", icon: PhListBullets },
  { id: "audit", label: "Admin activity", icon: PhShieldCheck },
] as const;
type Tab = (typeof tabs)[number]["id"];
const requestedTab = () =>
  tabs.find((entry) => entry.id === route.query.tab)?.id;
const tab = ref<Tab>(requestedTab() ?? "users"),
  loading = ref(true),
  error = ref(""),
  users = ref<ManagedUser[]>([]),
  catalog = ref<Catalogs>(structuredClone(defaultCatalogs)),
  model = ref<ModelAdminState>({
    settings: { ...defaultModelSettings },
    credentialAvailable: false,
    runtimeEnabled: false,
    approvedModel: null,
    approvedRegion: null,
    remainingAttempts: 0,
    expiresAt: null,
  }),
  logs = ref<ModelLog[]>([]),
  audit = ref<AdminAudit[]>([]),
  editingId = ref<string | null>(null),
  userDraft = ref({
    name: "",
    username: "",
    useStarterPassword: false,
    email: "",
    role: "member" as ManagedUser["role"],
    status: "pending" as ManagedUser["status"],
    version: 1,
  }),
  userBaseline = ref(""),
  catalogBaseline = ref(""),
  modelBaseline = ref(""),
  catalogKind = ref<"stages" | "categories">("stages"),
  logMode = ref("all"),
  activationLink = ref(""),
  activationExpiry = ref(""),
  copied = ref(false);
const channelDirty = ref(false);
const notificationDirty = ref(false);
const allowanceLimit = ref<number | string>("");
const allowanceUntil = ref("");
const allowanceBaseline = ref("");
const allowanceDirty = computed(
  () =>
    allowanceBaseline.value !== "" &&
    JSON.stringify([allowanceLimit.value, allowanceUntil.value]) !==
      allowanceBaseline.value,
);
const dirty = computed(
  () =>
    channelDirty.value ||
    notificationDirty.value ||
    allowanceDirty.value ||
    !!apiKey.value ||
    (editingId.value !== null &&
      JSON.stringify(userDraft.value) !== userBaseline.value) ||
    (catalogBaseline.value !== "" &&
      JSON.stringify(catalog.value) !== catalogBaseline.value) ||
    (modelBaseline.value !== "" &&
      JSON.stringify(model.value.settings) !== modelBaseline.value),
);
const apiKey = ref("");
const credentialBaseUrl = ref("");
const allowanceAttempts = ref<number | string>("");
const initialExpiry = new Date(Date.now() + 7 * 86400000);
const allowanceExpiry = ref(
  new Date(initialExpiry.getTime() - initialExpiry.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16),
);
onBeforeUnmount(() => {
  apiKey.value = "";
});
const mayDiscard = useUnsaved(dirty);
const filteredLogs = computed(() =>
  logs.value.filter((l) => logMode.value === "all" || l.mode === logMode.value),
);
const starterPasswordConfigured = ref(false);
const currentUser = computed(() =>
  users.value.find((u) => u.id === editingId.value),
);
function resetBaselines() {
  catalogBaseline.value = JSON.stringify(catalog.value);
  modelBaseline.value = JSON.stringify(model.value.settings);
  resetAllowanceDraft();
}
function resetAllowanceDraft() {
  allowanceLimit.value = model.value.maxRequests ?? "";
  const expires = model.value.expiresAt
    ? new Date(model.value.expiresAt)
    : null;
  allowanceUntil.value = expires
    ? new Date(expires.getTime() - expires.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
  allowanceBaseline.value = JSON.stringify([
    allowanceLimit.value,
    allowanceUntil.value,
  ]);
}
async function load() {
  if (!allowed.value) {
    loading.value = false;
    return;
  }
  if (!mayDiscard()) return;
  loading.value = true;
  error.value = "";
  try {
    const result = await Promise.all([
      api.adminUsers(),
      api.catalogs(),
      api.modelAdmin(),
      api.modelLogs(),
      api.adminAudit(),
      api.accountDefaults(),
    ]);
    [users.value, catalog.value, model.value, logs.value, audit.value] = result;
    starterPasswordConfigured.value = result[5].starterPasswordConfigured;
    editingId.value = null;
    resetBaselines();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function chooseTab(value: Tab) {
  if (value === tab.value) return;
  if (!confirmDiscard()) return;
  editingId.value = null;
  catalog.value = JSON.parse(
    catalogBaseline.value || JSON.stringify(defaultCatalogs),
  );
  model.value.settings = JSON.parse(
    modelBaseline.value || JSON.stringify(defaultModelSettings),
  );
  resetAllowanceDraft();
  apiKey.value = "";
  activationLink.value = "";
  tab.value = value;
  error.value = "";
}
watch(
  () => route.query.tab,
  () => {
    const requested = requestedTab();
    if (requested) chooseTab(requested);
  },
);
async function tabKey(event: KeyboardEvent, index: number) {
  let target: number;
  if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
  else if (event.key === "ArrowLeft")
    target = (index + tabs.length - 1) % tabs.length;
  else if (event.key === "Home") target = 0;
  else if (event.key === "End") target = tabs.length - 1;
  else return;
  event.preventDefault();
  chooseTab(tabs[target]!.id);
  await nextTick();
  document.getElementById(`admin-tab-${tab.value}`)?.focus();
}
function editUser(user?: ManagedUser) {
  if (!mayDiscard()) return;
  editingId.value = user?.id ?? "";
  userDraft.value = user
    ? {
        name: user.name,
        username: user.username ?? "",
        useStarterPassword: false,
        email: user.email,
        role: user.role,
        status: user.status,
        version: user.version,
      }
    : {
        name: "",
        username: "",
        useStarterPassword: starterPasswordConfigured.value,
        email: "",
        role: "member",
        status: "pending",
        version: 1,
      };
  userBaseline.value = JSON.stringify(userDraft.value);
  error.value = "";
}
function cancelUser() {
  if (mayDiscard()) editingId.value = null;
}
async function saveUser() {
  error.value = "";
  try {
    const id = editingId.value || undefined;
    const input = id
      ? adminUserUpdate.parse(userDraft.value)
      : adminUserInput.parse({
          name: userDraft.value.name,
          username: userDraft.value.username,
          useStarterPassword: userDraft.value.useStarterPassword,
          email: userDraft.value.email,
          role: userDraft.value.role,
        });
    await store.operation(() => api.saveUser(input, id), "User saved");
    editingId.value = null;
    if (!store.user) return;
    users.value = await api.adminUsers();
    audit.value = await api.adminAudit();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function activate(user: ManagedUser) {
  if (store.busy) return;
  error.value = "";
  activationLink.value = "";
  copied.value = false;
  try {
    const result = await store.operation(
      () => api.userActivation(user.id),
      "Activation link ready",
    );
    if (result.simulated) {
      store.notify("Simulated account activation");
      users.value = await api.adminUsers();
    } else {
      activationLink.value = `${location.origin}/#activate=${result.token}`;
      activationExpiry.value = result.expiresAt;
    }
    audit.value = await api.adminAudit();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function copyActivation() {
  try {
    await navigator.clipboard.writeText(activationLink.value);
    copied.value = true;
  } catch {
    error.value = "Copy is unavailable. Select the link and copy it manually.";
  }
}
function addCatalog() {
  const id = `${catalogKind.value === "stages" ? "stage" : "category"}-${crypto.randomUUID().slice(0, 8)}`;
  catalog.value[catalogKind.value].push({
    id,
    en: "",
    zh: "",
    order: catalog.value[catalogKind.value].length,
    color: "purple",
    archived: false,
  });
}
function discardCatalogNew(entry: CatalogEntry) {
  const original = JSON.parse(catalogBaseline.value) as Catalogs;
  if (!original[catalogKind.value].some((x) => x.id === entry.id))
    catalog.value[catalogKind.value] = catalog.value[catalogKind.value].filter(
      (x) => x.id !== entry.id,
    );
}
function isNewEntry(id: string) {
  return !(
    JSON.parse(
      catalogBaseline.value || JSON.stringify(defaultCatalogs),
    ) as Catalogs
  )[catalogKind.value].some((x) => x.id === id);
}
async function saveCatalog() {
  error.value = "";
  try {
    catalog.value = await store.operation(
      () => api.saveCatalogs(catalog.value),
      "Catalog saved",
    );
    catalogBaseline.value = JSON.stringify(catalog.value);
    audit.value = await api.adminAudit();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function saveModel() {
  if (apiKey.value) return saveCredential();
  error.value = "";
  try {
    model.value = await store.operation(
      () => api.saveModel(model.value.settings),
      "Model settings saved",
    );
    modelBaseline.value = JSON.stringify(model.value.settings);
    audit.value = await api.adminAudit();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function saveCredential() {
  error.value = "";
  const maxRequests = Number(allowanceAttempts.value);
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) {
    error.value = t("请明确填写本次授权的总调用上限（1–1000 次）。");
    return;
  }
  const expiresAt = new Date(allowanceExpiry.value);
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) {
    error.value = t("Choose a future allowance expiry");
    return;
  }
  try {
    model.value = await store.operation(
      () =>
        api.saveModelCredential({
          version: model.value.settings.version,
          apiKey: apiKey.value,
          region: model.value.settings.region,
          baseUrl: credentialBaseUrl.value,
          maxRequests,
          expiresAt: expiresAt.toISOString(),
        }),
      "API key saved. External calls remain disabled.",
    );
    modelBaseline.value = JSON.stringify(model.value.settings);
    resetAllowanceDraft();
    audit.value = await api.adminAudit();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    apiKey.value = "";
  }
}
async function saveAllowance() {
  error.value = "";
  const maxRequests = Number(allowanceLimit.value);
  const expiresAt = new Date(allowanceUntil.value);
  if (
    !Number.isInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 1000 ||
    maxRequests < (model.value.usedAttempts ?? 0)
  ) {
    error.value = t("总调用上限须为 1–1000 的整数，且不能少于已经使用的次数。");
    return;
  }
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) {
    error.value = t("请选择未来的额度有效期。");
    return;
  }
  const draft = { ...model.value.settings };
  const settingsDirty = JSON.stringify(draft) !== modelBaseline.value;
  try {
    model.value = await store.operation(
      () =>
        api.saveModelAllowance({
          version: model.value.settings.version,
          maxRequests,
          expiresAt: expiresAt.toISOString(),
        }),
      store.mode === "local" ? t("已保存模拟调用额度") : t("AI 调用额度已更新"),
    );
    modelBaseline.value = JSON.stringify(model.value.settings);
    if (settingsDirty)
      model.value.settings = {
        ...draft,
        version: model.value.settings.version,
      };
    resetAllowanceDraft();
    audit.value = await api.adminAudit();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
</script>
<template>
  <section class="page admin-page">
    <div class="page-heading">
      <div>
        <h1>{{ t("Administration") }}</h1>
        <p class="muted">
          {{ t("Manage access, shared classifications and model operations.") }}
        </p>
      </div>
      <button
        v-if="allowed"
        class="button"
        :disabled="loading || store.busy"
        @click="load"
      >
        <PhArrowClockwise :size="17" />{{ t("Refresh") }}
      </button>
    </div>
    <div v-if="!allowed" class="empty">
      <PhShieldCheck :size="36" />
      <h2>{{ t("Administrator access is required") }}</h2>
      <p>
        {{
          t(
            "All members can edit projects. Administration is a separate permission.",
          )
        }}
      </p>
      <RouterLink class="button" to="/projects">{{
        t("Return to projects")
      }}</RouterLink>
    </div>
    <template v-else>
      <p v-if="store.mode === 'local'" class="admin-demo" role="note">
        {{
          t(
            "Demo administration · simulated users and logs. No real accounts, credentials or server settings are changed.",
          )
        }}
      </p>
      <nav
        class="admin-tabs"
        role="tablist"
        :aria-label="t('Administration sections')"
      >
        <button
          v-for="(item, index) in tabs"
          :id="`admin-tab-${item.id}`"
          :key="item.id"
          role="tab"
          :aria-selected="tab === item.id"
          :aria-controls="`admin-panel-${item.id}`"
          :tabindex="tab === item.id ? 0 : -1"
          @click="chooseTab(item.id)"
          @keydown="tabKey($event, index)"
        >
          <component :is="item.icon" :size="18" />{{ t(item.label) }}
        </button>
      </nav>
      <p v-if="error" role="alert" class="error-box">
        {{
          t(error.startsWith("[") ? "Please check the submitted values" : error)
        }}
      </p>
      <p v-if="loading" role="status" class="empty">
        {{ t("Loading administration…") }}
      </p>
      <section
        v-else
        :id="`admin-panel-${tab}`"
        role="tabpanel"
        :aria-labelledby="`admin-tab-${tab}`"
      >
        <template v-if="tab === 'users'">
          <div class="section-heading">
            <div>
              <h2>{{ t("Workspace users") }}</h2>
              <p class="muted">
                {{
                  t(
                    "Members share project editing. Administrators also manage workspace settings.",
                  )
                }}
              </p>
            </div>
            <button class="primary" :disabled="store.busy" @click="editUser()">
              <PhPlus :size="17" />{{ t("Add user") }}
            </button>
          </div>
          <form
            v-if="editingId !== null"
            class="panel admin-editor"
            @submit.prevent="saveUser"
          >
            <h3>{{ t(editingId ? "Edit user" : "Add user") }}</h3>
            <div class="admin-fields">
              <label
                >{{ t("Name")
                }}<input
                  v-model="userDraft.name"
                  required
                  maxlength="80"
                  autocomplete="off" /></label
              ><label
                >{{ t("Login name")
                }}<input
                  v-model="userDraft.username"
                  maxlength="64"
                  autocomplete="off"
                  :placeholder="
                    t('Leave blank to generate from name')
                  " /></label
              ><label
                >{{ t("Email")
                }}<input
                  v-model="userDraft.email"
                  required
                  type="email"
                  maxlength="200"
                  autocomplete="off" /></label
              ><label
                >{{ t("Access")
                }}<select v-model="userDraft.role">
                  <option value="member">{{ t("Member") }}</option>
                  <option value="admin">{{ t("Administrator") }}</option>
                </select></label
              ><label v-if="editingId"
                >{{ t("Account status")
                }}<select v-model="userDraft.status">
                  <option
                    v-if="!currentUser?.activationRequired"
                    value="active"
                  >
                    {{ t("Active") }}
                  </option>
                  <option
                    v-if="currentUser?.activationRequired"
                    value="pending"
                  >
                    {{ t("Pending activation") }}
                  </option>
                  <option value="disabled">{{ t("Disabled") }}</option>
                </select></label
              >
            </div>
            <label v-if="editingId === ''" class="check-label"
              ><input
                type="checkbox"
                v-model="userDraft.useStarterPassword"
                :disabled="!starterPasswordConfigured"
              />{{ t("Use configured initial password") }}</label
            >
            <p
              v-if="editingId === '' && userDraft.useStarterPassword"
              class="muted"
            >
              {{
                t(
                  "The new account can sign in with its generated login name and the initial password supplied by the company.",
                )
              }}
            </p>
            <p v-else class="muted">
              {{
                t(
                  editingId
                    ? "Disabling an account or changing access revokes its sessions."
                    : "New users start pending. Generate an activation link after creating the account; no email is sent automatically.",
                )
              }}
            </p>
            <div class="form-actions">
              <button type="button" :disabled="store.busy" @click="cancelUser">
                {{ t("Cancel") }}</button
              ><button class="primary" type="submit" :disabled="store.busy">
                {{ t(store.busy ? "Saving…" : "Save user") }}
              </button>
            </div>
          </form>
          <div v-if="activationLink" class="panel activation-share">
            <h3>{{ t("Activation link · shown once") }}</h3>
            <p>
              {{
                t(
                  "Share privately with this user. This link replaces earlier links and expires at {time}.",
                  {
                    time: formatDate(activationExpiry, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  },
                )
              }}
            </p>
            <label
              >{{ t("Private activation link")
              }}<textarea :value="activationLink" readonly rows="2" />
            </label>
            <div class="form-actions">
              <button class="button" @click="activationLink = ''">
                {{ t("Dismiss") }}</button
              ><button class="primary" @click="copyActivation">
                {{ t(copied ? "Copied" : "Copy link") }}
              </button>
            </div>
          </div>
          <div class="admin-user-list">
            <article
              v-for="user in users"
              :key="user.id"
              class="panel admin-user"
            >
              <div>
                <strong>{{ user.name }}</strong>
                <p>
                  <strong class="account-login-name">{{
                    user.username
                  }}</strong>
                  · {{ user.email }}
                </p>
              </div>
              <div class="admin-user-tags">
                <span>{{
                  t(user.role === "admin" ? "Administrator" : "Member")
                }}</span
                ><span :class="`account-${user.status}`">{{
                  t(
                    user.status === "pending"
                      ? "Pending activation"
                      : user.status === "active"
                        ? "Active"
                        : "Disabled",
                  )
                }}</span>
              </div>
              <div class="admin-user-actions">
                <button
                  v-if="user.status === 'pending'"
                  class="button"
                  :disabled="store.busy"
                  @click="activate(user)"
                >
                  {{
                    t(
                      store.mode === "local"
                        ? "Simulate activation"
                        : "Generate activation link",
                    )
                  }}</button
                ><button
                  class="button"
                  :aria-label="t('Edit user {name}', { name: user.name })"
                  :disabled="store.busy"
                  @click="editUser(user)"
                >
                  {{ t("Edit") }}
                </button>
              </div>
            </article>
          </div>
        </template>
        <ChannelManagement
          v-else-if="tab === 'channels'"
          :catalog="catalog"
          @dirty="channelDirty = $event"
          @saved="
            catalog = $event;
            catalogBaseline = JSON.stringify($event);
          "
        />
        <WecomNotificationSettings
          v-else-if="tab === 'notifications'"
          @dirty="notificationDirty = $event"
        />
        <form v-else-if="tab === 'catalogs'" @submit.prevent="saveCatalog">
          <div class="section-heading">
            <div>
              <h2>{{ t("Stages & categories") }}</h2>
              <p class="muted">
                {{
                  t(
                    "Archive entries to stop new assignments while preserving existing projects and history.",
                  )
                }}
              </p>
            </div>
            <button type="button" class="button" @click="addCatalog">
              <PhPlus :size="17" />{{
                t(catalogKind === "stages" ? "Add stage" : "Add category")
              }}
            </button>
          </div>
          <div class="scope-tabs">
            <button
              type="button"
              :class="{ active: catalogKind === 'stages' }"
              @click="catalogKind = 'stages'"
            >
              {{ t("Project stages") }}</button
            ><button
              type="button"
              :class="{ active: catalogKind === 'categories' }"
              @click="catalogKind = 'categories'"
            >
              {{ t("Business categories") }}
            </button>
          </div>
          <p v-if="!catalog[catalogKind].length" class="empty">
            {{
              t(
                "No business categories yet. Add one to classify projects independently of responsibility.",
              )
            }}
          </p>
          <article
            v-for="entry in catalog[catalogKind]"
            :key="entry.id"
            class="panel admin-catalog-entry"
          >
            <div class="admin-fields">
              <label
                >{{ t("English name")
                }}<input v-model="entry.en" required maxlength="60" /></label
              ><label
                >{{ t("Chinese name")
                }}<input v-model="entry.zh" required maxlength="60" /></label
              ><label
                >{{ t("Order")
                }}<input
                  v-model.number="entry.order"
                  type="number"
                  min="0"
                  max="1000"
                  required /></label
              ><label
                >{{ t("Color")
                }}<select v-model="entry.color">
                  <option
                    v-for="color in [
                      'purple',
                      'blue',
                      'green',
                      'amber',
                      'rose',
                      'neutral',
                    ]"
                    :key="color"
                    :value="color"
                  >
                    {{ t(color) }}
                  </option>
                </select></label
              >
            </div>
            <div class="section-heading">
              <label class="admin-check"
                ><input v-model="entry.archived" type="checkbox" />{{
                  t("Archived")
                }}</label
              ><button
                v-if="isNewEntry(entry.id)"
                type="button"
                class="text-button"
                @click="discardCatalogNew(entry)"
              >
                {{ t("Remove unsaved entry") }}
              </button>
            </div>
          </article>
          <div class="form-actions">
            <button
              type="button"
              :disabled="store.busy"
              @click="catalog = JSON.parse(catalogBaseline)"
            >
              {{ t("Cancel changes") }}</button
            ><button
              class="primary"
              type="submit"
              :disabled="
                store.busy || JSON.stringify(catalog) === catalogBaseline
              "
            >
              {{ t("Save classifications") }}
            </button>
          </div>
        </form>
        <form
          v-else-if="tab === 'model'"
          class="panel admin-editor"
          @submit.prevent="saveModel"
        >
          <h2>{{ t("Model settings") }}</h2>
          <p class="muted">
            {{ t("语音识别：") }}<strong>qwen3-asr-flash</strong>
            {{
              t(
                "· 默认复用百炼凭据、区域和调用额度。文本整理继续使用下方选择的模型。",
              )
            }}
          </p>
          <p class="muted">
            {{
              t(
                "Saving these settings never sends notes or makes a model request. Credentials stay on the server.",
              )
            }}
          </p>
          <div class="model-state">
            <strong>{{
              t(
                model.runtimeEnabled
                  ? "Calls enabled within server allowance"
                  : "External calls disabled",
              )
            }}</strong
            ><span>{{
              t(
                model.credentialAvailable
                  ? "Server credential available"
                  : "Server credential not provisioned",
              )
            }}</span
            ><span>{{
              t("Connection has not been verified by this page.")
            }}</span>
          </div>
          <section class="model-allowance" aria-labelledby="allowance-heading">
            <div class="section-heading">
              <h3 id="allowance-heading">{{ t("AI 调用额度") }}</h3>
              <span v-if="store.mode === 'local'" class="muted">{{
                t("浏览器演示")
              }}</span>
            </div>
            <dl class="allowance-summary">
              <div>
                <dt>{{ t("已使用") }}</dt>
                <dd>{{ model.usedAttempts ?? t("未知") }} {{ t("次") }}</dd>
              </div>
              <div>
                <dt>{{ t("总调用上限") }}</dt>
                <dd>
                  {{ model.maxRequests ?? t("未配置")
                  }}<template
                    v-if="
                      model.maxRequests !== null &&
                      model.maxRequests !== undefined
                    "
                  >
                    {{ t("次") }}</template
                  >
                </dd>
              </div>
              <div>
                <dt>{{ t("剩余调用") }}</dt>
                <dd>{{ model.remainingAttempts }} {{ t("次") }}</dd>
              </div>
              <div>
                <dt>{{ t("有效期至") }}</dt>
                <dd>
                  {{
                    model.expiresAt
                      ? formatDate(model.expiresAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : t("未配置")
                  }}
                </dd>
              </div>
            </dl>
            <fieldset
              v-if="model.allowanceEditable"
              :disabled="store.busy"
              class="allowance-editor"
              @keydown.enter.prevent="saveAllowance"
            >
              <legend>{{ t("调整额度，无需重新填写 API key") }}</legend>
              <div class="allowance-inputs">
                <label
                  >{{ t("总调用上限")
                  }}<input
                    v-model.number="allowanceLimit"
                    type="number"
                    :min="Math.max(1, model.usedAttempts ?? 0)"
                    max="1000"
                    step="1"
                    :placeholder="t('包含已使用次数')"
                /></label>
                <label
                  >{{ t("有效期至（本机时间）")
                  }}<input v-model="allowanceUntil" type="datetime-local"
                /></label>
                <button
                  type="button"
                  class="primary"
                  :disabled="store.busy || !allowanceDirty"
                  @click="saveAllowance"
                >
                  {{ t("保存额度") }}
                </button>
              </div>
              <p class="muted">
                {{
                  t(
                    "这是累计调用总上限，包含已使用次数，不是额外增加的次数。修改只更新额度和有效期，保留原密钥与调用记录，不会自动启用 AI 或发起调用，也不会自动续额。",
                  )
                }}
              </p>
              <p v-if="store.mode === 'local'" class="muted">
                {{ t("演示调整只保存在当前浏览器；不会修改服务器额度。") }}
              </p>
            </fieldset>
            <p v-else-if="model.credentialAvailable" class="muted">
              {{
                t(
                  "当前额度由服务器环境配置管理，请联系部署管理员调整调用上限或有效期；此处只读。",
                )
              }}
            </p>
            <p v-else class="muted">
              {{
                t(
                  "尚未配置服务凭证。先保存下方 API key 与初始额度，之后可在这里单独调整额度。",
                )
              }}
            </p>
          </section>
          <div class="admin-fields">
            <label>{{ t("Provider") }}<input value="Qwen" readonly /></label
            ><label
              >{{ t("模型")
              }}<select v-model="model.settings.model">
                <option value="qwen3.8-max">
                  {{ t("Qwen3.8-Max（默认）") }}
                </option>
                <option value="qwen3.8-flash">Qwen3.8-Flash</option>
                <option value="qwen3.7-plus">Qwen3.7-Plus</option>
                <option value="qwen3.6-35b-a3b">Qwen3.6-35B-A3B</option>
                <option
                  v-if="
                    ![
                      'qwen3.8-max',
                      'qwen3.8-flash',
                      'qwen3.7-plus',
                      'qwen3.6-35b-a3b',
                    ].includes(model.settings.model)
                  "
                  :value="model.settings.model"
                >
                  {{ model.settings.model }}
                </option></select
              ><input
                v-model="model.settings.model"
                :aria-label="t('模型 ID')"
                :placeholder="t('或填写百炼模型 ID')" /></label
            ><label
              >{{ t("Region")
              }}<select v-model="model.settings.region">
                <option
                  v-for="region in [
                    'cn-beijing',
                    'ap-southeast-1',
                    'us-east-1',
                    'eu-central-1',
                  ]"
                  :key="region"
                  :value="region"
                >
                  {{ region }}
                </option>
              </select></label
            ><label
              >{{ t("Credential reference")
              }}<select v-model="model.settings.secretRef">
                <option value="">{{ t("Not selected") }}</option>
                <option
                  value="server-default"
                  :disabled="!model.credentialAvailable"
                >
                  {{ t("Server-provisioned default") }}
                </option>
              </select></label
            ><label
              >{{ t("Timeout (ms)")
              }}<input
                v-model.number="model.settings.timeoutMs"
                type="number"
                min="1000"
                max="30000"
                required /></label
            ><label
              >{{ t("Maximum output tokens")
              }}<input
                v-model.number="model.settings.maxTokens"
                type="number"
                min="512"
                max="4096"
                required
            /></label>
          </div>
          <fieldset
            v-if="model.credentialEditable"
            class="credential-fields"
            :disabled="store.busy"
          >
            <legend>{{ t("Qwen API key") }}</legend>
            <p class="muted">
              {{
                t(
                  "Enter your Model Studio API key. It is saved encrypted on the server and never displayed again. Saving does not call the model.",
                )
              }}
            </p>
            <div class="admin-fields">
              <label
                >{{
                  t(model.credentialAvailable ? "Replace API key" : "API key")
                }}
                <input
                  v-model="apiKey"
                  type="password"
                  autocomplete="new-password"
                  spellcheck="false"
                  maxlength="1024"
                  placeholder="sk-…"
                  :disabled="store.busy"
                />
              </label>
              <label
                >{{ t("API endpoint (optional)") }}
                <input
                  v-model="credentialBaseUrl"
                  type="url"
                  placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  :disabled="store.busy"
                />
              </label>
              <label
                >{{ t("Total allowed attempts") }}
                <input
                  v-model.number="allowanceAttempts"
                  type="number"
                  min="1"
                  max="1000"
                  :placeholder="t('请按使用需求填写')"
                  required
                  :disabled="store.busy"
                />
              </label>
              <label
                >{{ t("Allowance expires") }}
                <input
                  v-model="allowanceExpiry"
                  type="datetime-local"
                  :disabled="store.busy"
                />
              </label>
            </div>
            <p class="muted">
              {{
                t(
                  "Leave the endpoint empty to use the selected region's default. The attempt allowance includes previous calls and is not a monetary billing limit.",
                )
              }}
            </p>
            <button
              type="button"
              class="primary"
              :disabled="store.busy || !apiKey"
              @click="saveCredential"
            >
              {{ t("Save API key") }}
            </button>
          </fieldset>
          <label class="admin-check"
            ><input
              v-model="model.settings.enabled"
              type="checkbox"
              :disabled="!model.credentialAvailable"
            />{{ t("Allow explicitly confirmed external requests") }}</label
          >
          <p class="muted">
            {{
              t(
                "Saving an API key leaves external calls disabled. Enable calls separately when you are ready. Saved keys are never returned to the browser.",
              )
            }}
          </p>
          <div class="form-actions">
            <button
              type="button"
              :disabled="store.busy"
              @click="
                model.settings = JSON.parse(modelBaseline);
                apiKey = '';
                resetAllowanceDraft();
              "
            >
              {{ t("Cancel changes") }}</button
            ><button
              class="primary"
              type="submit"
              :disabled="
                store.busy ||
                !!apiKey ||
                JSON.stringify(model.settings) === modelBaseline
              "
            >
              {{ t("Save model settings") }}
            </button>
          </div>
        </form>
        <template v-else-if="tab === 'logs'"
          ><div class="section-heading">
            <div>
              <h2>{{ t("Call logs") }}</h2>
              <p class="muted">
                {{
                  t(
                    "Latest 100 requests. Logs exclude source notes, generated content and credentials. Unknown usage or cost stays unknown.",
                  )
                }}
              </p>
            </div>
            <label
              >{{ t("Log type")
              }}<select v-model="logMode">
                <option value="all">{{ t("All types") }}</option>
                <option value="real">{{ t("Real provider requests") }}</option>
                <option value="rules">{{ t("Rules") }}</option>
                <option value="simulated">{{ t("Simulated") }}</option>
              </select></label
            >
          </div>
          <div v-if="!filteredLogs.length" class="empty">
            {{ t("No matching model requests") }}
          </div>
          <div
            v-else
            class="admin-table-scroll"
            tabindex="0"
            :aria-label="t('Model request table')"
          >
            <table>
              <thead>
                <tr>
                  <th>{{ t("Time") }}</th>
                  <th>{{ t("User") }}</th>
                  <th>{{ t("Model / type") }}</th>
                  <th>{{ t("Status") }}</th>
                  <th>{{ t("Duration") }}</th>
                  <th>{{ t("Attempts") }}</th>
                  <th>{{ t("Tokens in / out") }}</th>
                  <th>{{ t("Cost") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="log in filteredLogs" :key="log.id">
                  <td>
                    {{
                      formatDate(log.createdAt, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    }}
                  </td>
                  <td>{{ log.actor }}</td>
                  <td>
                    {{ log.model ?? log.provider
                    }}<small>{{
                      t(
                        log.mode === "real"
                          ? "Real provider requests"
                          : log.mode === "simulated"
                            ? "Simulated"
                            : "Rules",
                      )
                    }}</small>
                  </td>
                  <td>
                    {{ t(log.status)
                    }}<small v-if="log.errorCode">{{ t(log.errorCode) }}</small>
                  </td>
                  <td>
                    {{
                      log.durationMs === null
                        ? t("Unknown")
                        : formatNumber(log.durationMs) + " ms"
                    }}
                  </td>
                  <td>{{ formatNumber(log.attempts) }}</td>
                  <td>
                    {{
                      log.inputTokens === null
                        ? "—"
                        : formatNumber(log.inputTokens)
                    }}
                    /
                    {{
                      log.outputTokens === null
                        ? "—"
                        : formatNumber(log.outputTokens)
                    }}
                  </td>
                  <td>
                    {{
                      log.cost === null ? t("Unknown") : formatNumber(log.cost)
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div></template
        >
        <template v-else
          ><h2>{{ t("Admin activity") }}</h2>
          <p class="muted">
            {{
              t(
                "Latest 100 management actions. Activation tokens and credentials are never recorded here.",
              )
            }}
          </p>
          <p v-if="!audit.length" class="empty">
            {{ t("No administration changes yet") }}
          </p>
          <article
            v-for="event in audit"
            :key="event.id"
            class="panel admin-audit"
          >
            <strong>{{ t(event.action) }}</strong>
            <p>
              {{ event.actor }} ·
              {{
                formatDate(event.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              }}
            </p>
            <small>{{ event.target }}</small>
          </article></template
        >
      </section></template
    >
  </section>
</template>
<style scoped>
.credential-fields {
  min-width: 0;
  margin: 20px 0 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-raised);
}
.credential-fields legend {
  padding: 0 6px;
  font-weight: 600;
}
.admin-demo {
  padding: 12px 15px;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}
.admin-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  margin: 24px 0;
}
.admin-tabs button {
  flex: 0 0 auto;
  min-width: max-content;
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 12px 15px;
  background: transparent;
  color: var(--text-secondary);
}
.admin-tabs [aria-selected="true"] {
  color: var(--accent);
  border-color: var(--accent);
}
.admin-page .section-heading .muted {
  margin: 4px 0 12px;
  font-size: 12px;
  line-height: 1.6;
}
.admin-editor,
.activation-share {
  padding: 20px;
  margin: 14px 0;
}
.admin-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 16px 0;
}
.admin-editor .muted {
  font-size: 12px;
  line-height: 1.6;
}
.admin-user {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 20px;
  margin: 8px 0;
}
.admin-user > div:first-child {
  flex: 1;
  min-width: 0;
}
.admin-user p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.admin-user-tags {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
.account-pending {
  color: var(--status-blocked);
}
.account-active {
  color: var(--status-done);
}
.account-disabled {
  color: var(--muted);
}
.admin-user-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.admin-catalog-entry {
  padding: 14px 18px;
  margin: 10px 0;
}
.admin-catalog-entry .admin-fields {
  grid-template-columns: 2fr 2fr 80px 120px;
  margin: 0 0 12px;
}
.admin-check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.admin-check input {
  width: auto;
}
.admin-catalog-entry .section-heading {
  min-height: 24px;
  margin: 0;
}
.model-state {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 15px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}
.model-state span {
  color: var(--muted);
}
.model-allowance {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.model-allowance .section-heading {
  margin: 0 0 12px;
}
.model-allowance h3 {
  margin: 0;
  font-size: 14px;
}
.allowance-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 32px;
  margin: 0;
  font-size: 13px;
}
.allowance-summary dt {
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 12px;
}
.allowance-summary dd {
  margin: 0;
  font-weight: 600;
}
.allowance-editor {
  margin: 16px 0 0;
}
.allowance-inputs {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
}
.allowance-inputs label {
  flex: 1 1 200px;
}
.admin-table-scroll {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.admin-table-scroll table {
  width: 100%;
  border-collapse: collapse;
  min-width: 850px;
  font-size: 13px;
}
.admin-table-scroll th,
.admin-table-scroll td {
  padding: 13px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.admin-table-scroll th {
  background: var(--surface-raised);
  color: var(--text-secondary);
}
.admin-table-scroll small {
  display: block;
  color: var(--muted);
  margin-top: 5px;
}
.admin-audit {
  padding: 16px;
  margin: 8px 0;
}
.admin-audit p,
.admin-audit small {
  color: var(--muted);
  font-size: 12px;
}
.activation-share textarea {
  width: 100%;
  overflow-wrap: anywhere;
}
.admin-page h2 {
  font-size: 18px;
}
@media (max-width: 760px) {
  .admin-page {
    padding: 16px 12px;
  }
  .admin-fields,
  .admin-catalog-entry .admin-fields {
    grid-template-columns: 1fr;
  }
  .admin-tabs {
    margin: 16px 0;
  }
  .admin-tabs button {
    padding: 12px 10px;
  }
  .admin-user {
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px;
  }
  .admin-user > div:first-child {
    flex: 1 0 100%;
  }
  .admin-user-tags {
    flex: 1 0 100%;
  }
  .admin-user-actions {
    width: 100%;
  }
  .admin-page .section-heading {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 10px;
  }
  .admin-editor,
  .activation-share {
    padding: 14px;
  }
  .admin-catalog-entry {
    padding: 14px;
  }
  .admin-page .form-actions {
    flex-wrap: wrap;
  }
}
</style>
