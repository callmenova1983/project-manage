import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory, RouterLink } from "vue-router";
import { t } from "./locales";
import { routerBase } from "./services/mode";
import App from "./App.vue";
import ProjectsView from "./views/ProjectsView.vue";
import ProjectDetail from "./views/ProjectDetail.vue";
import TasksView from "./views/TasksView.vue";
import ActivityView from "./views/ActivityView.vue";
import MeetingsView from "./views/MeetingsView.vue";
import SettingsView from "./views/SettingsView.vue";
import IntakeView from "./views/IntakeView.vue";
import AdminView from "./views/AdminView.vue";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./style.css";
const router = createRouter({
  history: createWebHistory(routerBase),
  routes: [
    { path: "/", redirect: "/projects" },
    { path: "/projects", component: ProjectsView },
    { path: "/projects/:id", component: ProjectDetail },
    { path: "/tasks", component: TasksView },
    { path: "/activity", component: ActivityView },
    { path: "/meetings", component: MeetingsView },
    { path: "/settings", component: SettingsView },
    { path: "/intake", component: IntakeView },
    { path: "/admin", component: AdminView },
    {
      path: "/:pathMatch(.*)*",
      component: {
        render: () =>
          h("section", { class: "empty" }, [
            h("h1", t("Page not found")),
            h(RouterLink, { to: "/projects" }, () => t("Return to projects")),
          ]),
      },
    },
  ],
  scrollBehavior: (to, _from, savedPosition) =>
    savedPosition ?? (to.hash ? { el: to.hash, top: 72 } : { top: 0 }),
});
createApp(App).use(createPinia()).use(router).mount("#app");
