import { t } from "./index";
export const stageLabels = {
  get potential() {
    return t("Potential");
  },
  get proposal() {
    return t("Proposal & quote");
  },
  get approved() {
    return t("Ready to start");
  },
  get implementation() {
    return t("In progress");
  },
  get operations() {
    return t("Operations");
  },
};
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
