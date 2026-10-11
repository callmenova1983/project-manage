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
    document
      .querySelector<HTMLButtonElement>('[aria-label="Toggle sidebar"]')
      ?.focus();
  }
});
let interval: ReturnType<typeof setInterval>;
function shortcut(event: KeyboardEvent) {
  if (event.key === "Escape" && expanded.value) {
    expanded.value = false;
    document
      .querySelector<HTMLButtonElement>('[aria-label="Toggle sidebar"]')
      ?.focus();
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
  if (window.confirm("Sign out? Save any open changes first.")) {
    expanded.value = false;
    await store.logout();
  }
}
function search() {
  document.querySelector<HTMLInputElement>("[data-global-search]")?.focus();
}
</script>
<template>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div v-if="store.loading && !store.user" class="loading-screen" role="status">
    <PhSpinnerGap :size="28" class="spin" />
    <p>Opening your workspace…</p>
  </div>
  <main v-else-if="!store.user" class="login-shell">
    <form class="login-card" @submit.prevent="signIn">
      <div class="brand-mark">
        <PhRocketLaunch :size="30" weight="duotone" />
      </div>
      <h1>Project Manage</h1>
      <p class="muted">A shared space for work that moves forward.</p>
      <h2>Welcome back</h2>
      <label
        >Email<input
          v-model="email"
          type="email"
          autocomplete="username"
          required
          autofocus /></label
      ><label
        >Password<input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
      /></label>
      <p v-if="loginError || store.error" class="error-box" role="alert">
        {{ loginError || store.error }}
      </p>
      <button class="primary" type="submit" :disabled="signingIn">
        {{ signingIn ? "Signing in…" : "Sign in" }}<PhArrowRight :size="16" />
      </button>
      <p class="fine-print">Use the account provisioned for your workspace.</p>
      <a class="demo-entry" href="/demo/"
        >Try demo · no sign-in required<PhArrowRight :size="16"
      /></a>
      <p class="fine-print">
        Explore synthetic projects. Demo changes stay in this browser.
      </p>
    </form>
  </main>
  <div v-else class="app-shell" :class="{ 'sidebar-expanded': expanded }">
    <button
      v-if="expanded"
      class="menu-scrim"
      aria-label="Close menu"
      @click="expanded = false"
    ></button>
    <aside
      v-if="expanded"
      ref="sidebarPanel"
      class="sidebar"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace menu"
    >
      <div class="section-heading">
        <strong>Workspace</strong
        ><button
          class="icon-button"
          aria-label="Close sidebar"
          @click="expanded = false"
        >
          <PhX :size="20" />
        </button>
      </div>
      <nav aria-label="Main navigation">
        <RouterLink
          v-for="item in nav"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          ><component :is="item.icon" :size="21" /><span>{{
            item.label
          }}</span></RouterLink
        >
      </nav>
      <RouterLink
        to="/settings"
        class="nav-item"
        aria-label="Workspace settings"
        ><PhGearSix :size="21" />Workspace settings</RouterLink
      >
      <a v-if="embeddedDemo" class="nav-item" href="/projects"
        ><PhArrowRight :size="20" />Open shared workspace</a
      >
      <button
        v-else-if="store.mode !== 'local'"
        class="nav-item"
        aria-label="Sign out"
        @click="signOut"
      >
        <PhSignOut :size="20" />Sign out
      </button>
    </aside>
    <div class="app-body" :inert="expanded">
      <header class="topbar">
        <div class="topbar-brand">
          <button
            class="icon-button"
            aria-label="Toggle sidebar"
            :aria-expanded="expanded"
            @click="expanded = !expanded"
          >
            <PhSidebarSimple :size="20" /></button
          ><RouterLink
            to="/projects"
            class="brand"
            aria-label="Project Manage home"
            ><PhRocketLaunch :size="23" weight="duotone" /><span
              >Project Manage</span
            ></RouterLink
          >
        </div>
        <nav class="horizontal-nav" aria-label="Workspace navigation">
          <RouterLink
            v-for="item in nav.slice(0, 3)"
            :key="item.path"
            :to="item.path"
            ><component :is="item.icon" :size="16" />{{
              item.label
            }}</RouterLink
          >
        </nav>
        <div class="topbar-right">
          <span class="sync-label">{{
            store.mode === "local"
              ? "Local demo · browser only"
              : "Team workspace"
          }}</span
          ><button
            class="icon-button"
            aria-label="Refresh workspace"
            :disabled="store.loading"
            @click="store.refresh()"
          >
            <PhArrowClockwise
              :size="17"
              :class="{ spin: store.loading }"
            /></button
          ><RouterLink
            to="/settings"
            class="avatar small"
            aria-label="Workspace settings"
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
        Browser demo · synthetic projects. Changes stay in this browser. No
        shared backend or AI connection.
      </div>
      <div v-if="store.error" role="alert" class="global-error">
        <span>{{ store.error }}</span
        ><button @click="store.refresh()">Retry</button>
      </div>
      <main id="main-content" tabindex="-1"><RouterView /></main>
      <footer class="app-footer">
        <span>{{
          store.mode === "local"
            ? "Your local demo workspace."
            : "Shared visibility. Shared momentum."
        }}</span
        ><span v-if="store.lastSynced"
          >{{ store.mode === "local" ? "Saved locally" : "Synced" }}
          {{
            store.lastSynced.toLocaleTimeString("en", {
              hour: "2-digit",
              minute: "2-digit",
            })
          }}
          <template v-if="store.mode !== 'local'"
            >· updates every 20s</template
          ></span
        >
      </footer>
    </div>
    <div v-if="store.toast" role="status" class="toast">
      <PhCheckSquare :size="18" />{{ store.toast }}
    </div>
  </div>
</template>
