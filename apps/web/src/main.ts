import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import ProjectsView from "./views/ProjectsView.vue";
import ProjectDetail from "./views/ProjectDetail.vue";
import TasksView from "./views/TasksView.vue";
import ActivityView from "./views/ActivityView.vue";
import MeetingsView from "./views/MeetingsView.vue";
import SettingsView from "./views/SettingsView.vue";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./style.css";
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/projects" },
    { path: "/projects", component: ProjectsView },
    { path: "/projects/:id", component: ProjectDetail },
    { path: "/tasks", component: TasksView },
    { path: "/activity", component: ActivityView },
    { path: "/meetings", component: MeetingsView },
    { path: "/settings", component: SettingsView },
    {
      path: "/:pathMatch(.*)*",
      component: {
        template:
          '<section class="empty"><h1>Page not found</h1><a href="/projects">Return to projects</a></section>',
      },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
createApp(App).use(createPinia()).use(router).mount("#app");
