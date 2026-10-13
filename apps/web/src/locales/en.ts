import { t } from "./index";
import { catalogLabel } from "../composables/catalogs";
export const stageLabels: Record<string, string> = new Proxy(
  {},
  { get: (_, key) => catalogLabel("stages", String(key)) },
);
export const statusLabels = {
  get todo() {
    return t("To do");
  },
  get in_progress() {
    return t("In progress");
  },
  get done() {
    return t("Done");
  },
  get blocked() {
    return t("Needs coordination");
  },
};
export const navLabels = {
  get projects() {
    return t("Projects");
  },
  get tasks() {
    return t("Tasks");
  },
  get activity() {
    return t("Activity");
  },
  get meetings() {
    return t("Meeting notes");
  },
  get settings() {
    return t("Workspace");
  },
};
