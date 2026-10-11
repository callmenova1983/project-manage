<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import {
  PhRocketLaunch,
  PhSidebarSimple,
  PhSquaresFour,
  PhCheckSquare,
  PhClockCounterClockwise,
  PhNotePencil,
  PhGearSix,
  PhSignOut,
  PhArrowClockwise,
  PhArrowRight,
  PhSpinnerGap,
  PhX,
} from "@phosphor-icons/vue";
import { useWorkspace } from "./stores/workspace";
import { embeddedDemo } from "./services/mode";
import { t, formatDate } from "./locales";
import PreferencesControls from "./components/PreferencesControls.vue";
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
  { path: "/tasks", label: "All tasks", icon: PhCheckSquare },
  { path: "/activity", label: "Activity", icon: PhClockCounterClockwise },
  { path: "/meetings", label: "Meeting notes", icon: PhNotePencil },
  { path: "/intake", label: "Quick intake", icon: PhNotePencil },
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
  void store.initialize();
  window.addEventListener("keydown", shortcut);
  interval = setInterval(() => {
    if (store.user && !store.busy && !document.hidden) void store.refresh(true);
  }, 20000);
});
onBeforeUnmount(() => {
  clearInterval(interval);
  document.body.style.overflow = previousOverflow;
  window.removeEventListener("keydown", shortcut);
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
  <div v-if="store.loading && !store.user" class="loading-screen" role="status">
    <PhSpinnerGap :size="28" class="spin" />
    <p>{{ t("Opening your workspace…") }}</p>
  </div>
  <main v-else-if="!store.user" class="login-shell">
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
        >{{ t("Email")
        }}<input
          v-model="email"
          type="email"
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
  <div v-else class="app-shell" :class="{ 'sidebar-expanded': expanded }">
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
    <div class="app-body" :inert="expanded">
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
            v-for="item in nav.slice(0, 3)"
            :key="item.path"
            :to="item.path"
            ><component :is="item.icon" :size="16" />{{
              t(item.label)
            }}</RouterLink
          >
        </nav>
        <div class="topbar-right">
          <PreferencesControls />
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
              store.user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
            }}</RouterLink
          >
        </div>
      </header>
      <div v-if="store.mode === 'local'" class="demo-notice" role="note">
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
      <main id="main-content" tabindex="-1"><RouterView /></main>
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
    <div v-if="store.toast" role="status" class="toast">
      <PhCheckSquare :size="18" />{{ t(store.toast) }}
    </div>
  </div>
</template>

<style scoped>
.login-preferences {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
@media (max-width: 600px) {
  .desktop-refresh,
  .desktop-avatar {
    display: none;
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
