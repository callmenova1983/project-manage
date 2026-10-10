<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from "vue";
import { useRoute } from "vue-router";
import {
  PhStack,
  PhSidebarSimple,
  PhMagnifyingGlass,
  PhSquaresFour,
  PhCheckSquare,
  PhClockCounterClockwise,
  PhNotePencil,
  PhGearSix,
  PhSignOut,
  PhArrowClockwise,
  PhArrowRight,
  PhSpinnerGap,
} from "@phosphor-icons/vue";
import { useWorkspace } from "./stores/workspace";
const store = useWorkspace(),
  route = useRoute();
const expanded = ref(false),
  email = ref(""),
  password = ref(""),
  loginError = ref(""),
  signingIn = ref(false);
const nav = [
  { path: "/projects", label: "Projects", icon: PhSquaresFour },
  { path: "/tasks", label: "Tasks", icon: PhCheckSquare },
  { path: "/activity", label: "Activity", icon: PhClockCounterClockwise },
  { path: "/meetings", label: "Meeting notes", icon: PhNotePencil },
];
const pageLabel = computed(
  () => nav.find((n) => route.path.startsWith(n.path))?.label ?? "Workspace",
);
let interval: ReturnType<typeof setInterval>;
function shortcut(event: KeyboardEvent) {
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
  if (window.confirm("Sign out? Save any open changes first."))
    await store.logout();
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
      <div class="brand-mark"><PhStack :size="30" weight="duotone" /></div>
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
      <p class="fine-print">
        Use the account provisioned for your workspace.<br />Local setup creates
        credentials in data/local-login.txt.
      </p>
    </form>
  </main>
  <div v-else class="app-shell" :class="{ 'sidebar-expanded': expanded }">
    <aside class="sidebar">
      <RouterLink to="/projects" class="brand" aria-label="Project Manage home"
        ><PhStack :size="25" weight="duotone" /><span v-if="expanded"
          >Project Manage</span
        ></RouterLink
      ><button
        class="nav-item"
        aria-label="Toggle sidebar"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <PhSidebarSimple :size="20" /><span v-if="expanded"
          >Collapse sidebar</span
        ></button
      ><button
        class="nav-item sidebar-search"
        aria-label="Search current view"
        @click="search"
      >
        <PhMagnifyingGlass :size="20" /><span v-if="expanded">Search</span>
      </button>
      <nav aria-label="Main navigation">
        <RouterLink
          v-for="item in nav"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :aria-label="item.label"
          :title="item.label"
          ><component :is="item.icon" :size="21" /><span v-if="expanded">{{
            item.label
          }}</span></RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <RouterLink
          to="/settings"
          class="nav-item"
          aria-label="Workspace settings"
          title="Workspace settings"
          ><PhGearSix :size="21" /><span v-if="expanded"
            >Workspace</span
          ></RouterLink
        ><button
          class="nav-item"
          aria-label="Sign out"
          title="Sign out"
          @click="signOut"
        >
          <PhSignOut :size="20" /><span v-if="expanded">Sign out</span></button
        ><span class="avatar user-avatar" :title="store.user.name">{{
          store.user.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
        }}</span>
      </div>
    </aside>
    <div class="app-body">
      <header class="topbar">
        <div class="breadcrumbs">
          <span>Workspace</span><span class="slash">/</span
          ><span>{{ pageLabel }}</span>
        </div>
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
          ><span class="avatar small">{{
            store.user.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")
          }}</span>
        </div>
      </header>
      <div v-if="store.error" role="alert" class="global-error">
        <span>{{ store.error }}</span
        ><button @click="store.refresh()">Retry</button>
      </div>
      <main id="main-content" tabindex="-1"><RouterView /></main>
      <footer class="app-footer">
        <span>Shared visibility. Shared momentum.</span
        ><span v-if="store.lastSynced"
          >Synced
          {{
            store.lastSynced.toLocaleTimeString("en", {
              hour: "2-digit",
              minute: "2-digit",
            })
          }}
          · updates every 20s</span
        >
      </footer>
    </div>
    <div v-if="store.toast" role="status" class="toast">
      <PhCheckSquare :size="18" />{{ store.toast }}
    </div>
  </div>
</template>
