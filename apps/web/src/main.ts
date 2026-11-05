import "./services/browser-crypto";
import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory, RouterLink } from "vue-router";
import { t } from "./locales";
import { routerBase } from "./services/mode";
import App from "./App.vue";
import ProjectHomeView from "./views/ProjectHomeView.vue";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./style.css";
const router = createRouter({
  history: createWebHistory(routerBase),
  routes: [
    { path: "/", redirect: "/projects" },
    { path: "/projects", component: ProjectHomeView },
    {
      path: "/project-map",
      component: () => import("./views/ProjectMapView.vue"),
    },
    {
      path: "/projects/:id",
      component: () => import("./views/ProjectDetail.vue"),
    },
    { path: "/tasks", component: () => import("./views/TasksView.vue") },
    {
      path: "/messages/:id",
      component: () => import("./components/NotificationLanding.vue"),
    },
    { path: "/activity", component: () => import("./views/ActivityView.vue") },
    {
      path: "/meetings",
      redirect: { path: "/projects", query: { intake: "1" } },
    },
    { path: "/settings", component: () => import("./views/SettingsView.vue") },
    {
      path: "/intake",
      redirect: { path: "/projects", query: { intake: "1" } },
    },
    { path: "/admin", component: () => import("./views/AdminView.vue") },
    {
      path: "/directory",
      component: () => import("./views/TeamView.vue"),
    },
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
  scrollBehavior: (to, from, savedPosition) =>
    to.path === from.path && to.query.intake !== from.query.intake
      ? false
      : (savedPosition ??
        (to.hash.startsWith("#activity-")
          ? false
          : to.hash
            ? { el: to.hash, top: 72 }
            : { top: 0 })),
});
createApp(App).use(createPinia()).use(router).mount("#app");
