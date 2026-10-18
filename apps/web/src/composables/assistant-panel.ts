import { reactive } from "vue";

export const assistantPanel = reactive({
  open: false,
  mounted: false,
  width: 460,
  busy: false,
  unread: false,
  projectId: undefined as string | null | undefined,
  mobile: false,
});
export function openAssistant(projectId?: string | null) {
  if (projectId !== undefined) assistantPanel.projectId = projectId;
  assistantPanel.mounted = true;
  assistantPanel.open = true;
  assistantPanel.unread = false;
}
export function collapseAssistant() {
  assistantPanel.open = false;
}
