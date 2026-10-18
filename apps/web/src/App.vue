<script setup lang="ts">
import AssistantDock from "./components/AssistantDock.vue";
import {
  assistantPanel,
  openAssistant,
  collapseAssistant,
} from "./composables/assistant-panel";
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import {
  PhSparkle,
  PhRocketLaunch,
  PhSidebarSimple,
  PhSquaresFour,
  PhCheckSquare,
  PhClockCounterClockwise,
  PhGearSix,
  PhSignOut,
  PhArrowClockwise,
  PhArrowRight,
  PhSpinnerGap,
  PhX,
  PhUsers,
  PhGlobeHemisphereEast,
} from "@phosphor-icons/vue";
import { useWorkspace } from "./stores/workspace";
import { embeddedDemo } from "./services/mode";
import { t, locale, formatDate } from "./locales";
import { romanizeName } from "./services/map-english";
import PreferencesControls from "./components/PreferencesControls.vue";
import FullscreenSwitch from "./components/FullscreenSwitch.vue";
import ActivateAccount from "./components/ActivateAccount.vue";
import TaskFeedback from "./components/TaskFeedback.vue";
import NotificationCenter from "./components/NotificationCenter.vue";
import TokenUsage from "./components/TokenUsage.vue";
import { initialActivationToken } from "./services/activation";
import { createClickThroughGuard } from "./services/click-through-guard";
const activationToken = ref(initialActivationToken);
const store = useWorkspace(),
  router = useRouter();
const sidebarPanel = ref<HTMLElement | null>(null);
let previousOverflow = "";
const expanded = ref(false),
  email = ref(""),
  password = ref(""),
  loginError = ref(""),
  signingIn = ref(false);
const nav = [
  { path: "/projects", label: "Projects", icon: PhSquaresFour },
  { path: "/tasks", label: "Tasks", icon: PhCheckSquare },
  { path: "/directory", label: "Team", icon: PhUsers },
  { path: "/activity", label: "Activity", icon: PhClockCounterClockwise },
  { path: "/project-map", label: "Project map", icon: PhGlobeHemisphereEast },
  { path: "/intake", label: t("AI 工作助手"), icon: PhSparkle },
];
watch(
  () => router.currentRoute.value.path,
  () => {
    expanded.value = false;
  },
);
watch(expanded, async (open) => {
  if (open) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    await nextTick();
    sidebarPanel.value?.querySelector<HTMLButtonElement>("button")?.focus();
  } else {
    document.body.style.overflow = previousOverflow;
    await nextTick();
    document.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")?.focus();
  }
});
let interval: ReturnType<typeof setInterval>;
function resumeSync() {
  if (store.mode === "server" && store.user && !store.busy && !document.hidden)
    void store.refresh(true);
}
const clickThroughGuard = createClickThroughGuard<Element>();
function guardRepeatedActivation(event: MouseEvent) {
  const target =
    event.target instanceof Element
      ? event.target.closest("button, a[href]")
      : null;
  if (
    target &&
    clickThroughGuard({
      target,
      detail: event.detail,
      timeStamp: event.timeStamp,
      clientX: event.clientX,
      clientY: event.clientY,
    })
  ) {
    event.preventDefault();
    event.stopPropagation();
  }
}
function shortcut(event: KeyboardEvent) {
  if (event.key === "Escape" && expanded.value) {
    expanded.value = false;
    document.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")?.focus();
  }
  if (expanded.value && event.key === "Tab") {
    const controls = sidebarPanel.value?.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    if (controls?.length) {
      const first = controls[0]!,
        last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  if (expanded.value) return;
  if (
    event.key === "/" &&
    !(event.target instanceof HTMLInputElement) &&
    !(event.target instanceof HTMLTextAreaElement) &&
    !(event.target instanceof HTMLSelectElement)
  ) {
    event.preventDefault();
    search();
  }
}
onMounted(() => {
  if (!activationToken.value) void store.initialize();
  window.addEventListener("keydown", shortcut);
  window.addEventListener("click", guardRepeatedActivation, true);
  window.addEventListener("online", resumeSync);
  document.addEventListener("visibilitychange", resumeSync);
  interval = setInterval(() => {
    if (store.user && !store.busy && !document.hidden) void store.refresh(true);
  }, 20000);
});
onBeforeUnmount(() => {
  clearInterval(interval);
  document.body.style.overflow = previousOverflow;
  window.removeEventListener("keydown", shortcut);
  window.removeEventListener("click", guardRepeatedActivation, true);
  window.removeEventListener("online", resumeSync);
  document.removeEventListener("visibilitychange", resumeSync);
});
async function signIn() {
  signingIn.value = true;
  loginError.value = "";
  try {
    await store.login(email.value, password.value);
    password.value = "";
  } catch (e) {
    loginError.value = (e as Error).message;
  } finally {
    signingIn.value = false;
  }
}
async function signOut() {
  if (window.confirm(t("Sign out? Save any open changes first."))) {
    expanded.value = false;
    await store.logout();
  }
}
function search() {
  document.querySelector<HTMLInputElement>("[data-global-search]")?.focus();
}
</script>
<template>
  <a class="skip-link" href="#main-content">{{ t("Skip to content") }}</a>
  <ActivateAccount
    v-if="activationToken"
    :token="activationToken"
    @done="
      activationToken = '';
      store.initialize();
    "
  />
  <div
    v-else-if="store.loading && !store.user"
    class="loading-screen"
    role="status"
  >
    <PhSpinnerGap :size="28" class="spin" />
    <p>{{ t("Opening your workspace…") }}</p>
  </div>
  <main
    v-else-if="store.sessionState === 'unavailable'"
    id="main-content"
    class="login-shell"
  >
    <section class="login-card" aria-labelledby="connection-title">
      <div class="login-preferences"><PreferencesControls /></div>
      <div class="brand-mark">
        <PhArrowClockwise :size="30" />
      </div>
      <h1 id="connection-title">{{ t("Workspace connection interrupted") }}</h1>
      <p>
        {{
          t(
            "We could not check your session. Retry when the service is available.",
          )
        }}
      </p>
      <p class="error-box" role="alert">{{ t(store.error) }}</p>
      <button class="primary" @click="store.initialize()">
        {{ t("Retry connection") }}<PhArrowClockwise :size="18" />
      </button>
      <p class="fine-print">
        {{
          t(
            "If your workspace is hosted in Codespaces, its owner may need to wake it first.",
          )
        }}
      </p>
      <a class="demo-entry" href="/demo/"
        >{{ t("Try demo · no sign-in required") }}<PhArrowRight :size="16"
      /></a>
      <p class="fine-print">
        {{
          t("Explore synthetic projects. Demo changes stay in this browser.")
        }}
      </p>
    </section>
  </main>
  <main v-else-if="!store.user" id="main-content" class="login-shell">
    <form class="login-card" @submit.prevent="signIn">
      <div class="login-preferences"><PreferencesControls /></div>
      <div class="brand-mark">
        <PhRocketLaunch :size="30" weight="duotone" />
      </div>
      <h1>{{ t("Project Manage") }}</h1>
      <p class="muted">
        {{ t("A shared space for work that moves forward.") }}
      </p>
      <h2>{{ t("Welcome back") }}</h2>
      <label
        >{{ t("Login name or email")
        }}<input
          v-model="email"
          type="text"
          autocapitalize="none"
          :spellcheck="false"
          autocomplete="username"
          required
          autofocus /></label
      ><label
        >{{ t("Password")
        }}<input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
      /></label>
      <p v-if="loginError || store.error" class="error-box" role="alert">
        {{ t(loginError || store.error) }}
      </p>
      <button class="primary" type="submit" :disabled="signingIn">
        {{ t(signingIn ? "Signing in…" : "Sign in")
        }}<PhArrowRight :size="16" />
      </button>
      <p class="fine-print">
        {{ t("Use the account provisioned for your workspace.") }}
      </p>
      <a class="demo-entry" href="/demo/"
        >{{ t("Try demo · no sign-in required") }}<PhArrowRight :size="16"
      /></a>
      <p class="fine-print">
        {{
          t("Explore synthetic projects. Demo changes stay in this browser.")
        }}
      </p>
    </form>
  </main>
  <div
    v-else
    class="app-shell"
    :class="{
      'sidebar-expanded': expanded,
      'atlas-shell': router.currentRoute.value.path === '/project-map',
    }"
  >
    <button
      v-if="expanded"
      class="menu-scrim"
      :aria-label="t('Close menu')"
      @click="expanded = false"
    ></button>
    <aside
      v-if="expanded"
      ref="sidebarPanel"
      class="sidebar"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Workspace menu')"
    >
      <div class="section-heading">
        <strong>{{ t("Workspace") }}</strong
        ><button
          class="icon-button"
          :aria-label="t('Close sidebar')"
          @click="expanded = false"
        >
          <PhX :size="20" />
        </button>
      </div>
      <nav :aria-label="t('Main navigation')">
        <RouterLink
          v-for="item in nav"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          ><component :is="item.icon" :size="21" /><span>{{
            t(item.label)
          }}</span></RouterLink
        >
      </nav>
      <RouterLink
        v-if="store.mode === 'local' || store.user?.role === 'admin'"
        to="/admin"
        class="nav-item"
        ><PhGearSix :size="21" />{{ t("Administration") }}</RouterLink
      >
      <RouterLink
        to="/settings"
        class="nav-item"
        :aria-label="t('Workspace settings')"
        ><PhGearSix :size="21" />{{ t("Workspace settings") }}</RouterLink
      >
      <button
        class="nav-item"
        :disabled="store.loading"
        @click="store.refresh()"
      >
        <PhArrowClockwise :size="20" />{{ t("Refresh workspace") }}
      </button>
      <FullscreenSwitch
        labelled
        class="mobile-fullscreen"
        @change="expanded = false"
      />
      <a v-if="embeddedDemo" class="nav-item" href="/projects"
        ><PhArrowRight :size="20" />{{ t("Open shared workspace") }}</a
      >
      <button
        v-else-if="store.mode !== 'local'"
        class="nav-item"
        :aria-label="t('Sign out')"
        @click="signOut"
      >
        <PhSignOut :size="20" />{{ t("Sign out") }}
      </button>
    </aside>
    <div
      class="app-body"
      :inert="expanded || (assistantPanel.open && assistantPanel.mobile)"
    >
      <header class="topbar">
        <div class="topbar-brand">
          <button
            class="icon-button"
            data-sidebar-toggle
            :aria-label="t('Toggle sidebar')"
            :aria-expanded="expanded"
            @click="expanded = !expanded"
          >
            <PhSidebarSimple :size="20" /></button
          ><RouterLink
            to="/projects"
            class="brand"
            :aria-label="t('Project Manage home')"
            ><PhRocketLaunch :size="23" weight="duotone" /><span>{{
              t("Project Manage")
            }}</span></RouterLink
          >
        </div>
        <nav class="horizontal-nav" :aria-label="t('Workspace navigation')">
          <RouterLink
            v-for="item in nav.slice(0, 5)"
            :key="item.path"
            :to="item.path"
            :draggable="false"
            ><component :is="item.icon" :size="16" /><span>{{
              t(item.label)
            }}</span></RouterLink
          >
        </nav>
        <div class="topbar-right">
          <button
            type="button"
            class="assistant-launch"
            :class="{ active: assistantPanel.open }"
            :aria-label="t('AI work assistant')"
            aria-controls="global-ai-assistant"
            :aria-expanded="assistantPanel.open"
            @click="assistantPanel.open ? collapseAssistant() : openAssistant()"
          >
            <PhSparkle :size="18" /><span>{{ t("AI assistant") }}</span
            ><i
              v-if="assistantPanel.busy || assistantPanel.unread"
              :class="{ working: assistantPanel.busy }"
            />
          </button>
          <TokenUsage />
          <NotificationCenter />
          <PreferencesControls />
          <FullscreenSwitch class="desktop-fullscreen" />
          <span class="sync-label">{{
            t(
              store.mode === "local"
                ? "Local demo · browser only"
                : "Team workspace",
            )
          }}</span
          ><button
            class="icon-button desktop-refresh"
            :aria-label="t('Refresh workspace')"
            :disabled="store.loading"
            @click="store.refresh()"
          >
            <PhArrowClockwise
              :size="17"
              :class="{ spin: store.loading }"
            /></button
          ><RouterLink
            to="/settings"
            class="avatar small desktop-avatar"
            :aria-label="t('Workspace settings')"
            >{{
              (locale === "en"
                ? romanizeName(store.user.name)
                : store.user.name
              )
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
            }}</RouterLink
          >
        </div>
      </header>
      <div
        v-if="store.mode === 'local'"
        class="demo-notice"
        role="region"
        :aria-label="t('Local demo · browser only')"
      >
        {{
          t(
            "Browser demo · synthetic projects. Changes stay in this browser. No shared backend or AI connection.",
          )
        }}
      </div>
      <div v-if="store.error" role="alert" class="global-error">
        <span>{{ t(store.error) }}</span
        ><button @click="store.refresh()">{{ t("Retry") }}</button>
      </div>
      <TaskFeedback />
      <div v-if="store.preferenceError" role="alert" class="global-error">
        <span>{{ t(store.preferenceError) }}</span
        ><button @click="store.preferenceError = ''">
          {{ t("Dismiss preference notice") }}
        </button>
      </div>
      <main id="main-content" tabindex="-1">
        <RouterView
          :key="
            JSON.stringify([store.mode, store.user.workspaceId, store.user.id])
          "
        />
      </main>
      <footer class="app-footer">
        <span>{{
          t(
            store.mode === "local"
              ? "Your local demo workspace."
              : "Shared visibility. Shared momentum.",
          )
        }}</span
        ><span v-if="store.lastSynced"
          >{{ t(store.mode === "local" ? "Saved locally" : "Synced") }}
          {{
            formatDate(store.lastSynced, {
              hour: "2-digit",
              minute: "2-digit",
            })
          }}
          <template v-if="store.mode !== 'local'">{{
            t("· updates every 20s")
          }}</template></span
        >
      </footer>
    </div>
    <AssistantDock
      :key="JSON.stringify([store.mode, store.user.workspaceId, store.user.id])"
    />
    <div v-if="store.toast" role="status" class="toast">
      <PhCheckSquare :size="18" />{{ t(store.toast) }}
    </div>
  </div>
</template>

<style scoped>
.assistant-launch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  position: relative;
  padding: 6px 9px;
  min-height: 34px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  white-space: nowrap;
}
.assistant-launch.active {
  background: var(--accent-bg);
  border-color: var(--border);
}
.assistant-launch i {
  position: absolute;
  top: 3px;
  right: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.assistant-launch i.working {
  animation: pulse 1.4s ease-in-out infinite;
}
@media (min-width: 761px) and (max-width: 900px) {
  .assistant-launch span {
    display: none;
  }
  .assistant-launch {
    min-width: 44px;
    min-height: 44px;
    padding: 6px;
  }
}
@media (max-width: 760px) {
  .assistant-launch span {
    display: none;
  }
  .assistant-launch {
    min-width: 36px;
    min-height: 36px;
    padding: 6px;
  }
}

.atlas-shell {
  --surface-subtle: #0b1726;
  --surface: #101e2f;
  --surface-raised: #15283a;
  --border: #273d50;
  --text: #edf4fa;
  --muted: #a5b9ca;
  --accent: #68ded3;
  --accent-bg: #17363d;
  --accent-border: #34726f;
  background: #07121f;
  color: var(--text);
}
.atlas-shell .app-footer {
  display: none;
}
.atlas-shell .demo-notice {
  background: #102237;
  color: #b3c7d8;
  border-color: #273d50;
}
.login-preferences {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.mobile-fullscreen {
  display: none;
}
@media (max-width: 600px) {
  .desktop-refresh,
  .desktop-avatar,
  .desktop-fullscreen {
    display: none;
  }
  .mobile-fullscreen {
    display: inline-flex;
  }
  .topbar {
    gap: 8px;
  }
  .topbar-brand {
    gap: 4px;
  }
  .topbar .brand {
    gap: 6px;
  }
  .topbar .brand span {
    font-size: 12px;
  }
  .topbar-right {
    gap: 0;
  }
}
</style>
