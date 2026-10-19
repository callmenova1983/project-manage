<script setup lang="ts">
import { useAssistantSession } from "../composables/assistant-session";
import { accountStorageKey } from "../services/account-storage";
import type { AssistantAnswer } from "../../../../packages/domain/assistant";
import type { IntakeBatch } from "../../../../packages/domain/intake";
import { intakeResults, dailyLogResults } from "../services/capture-results";
import type { DailyLogBatch } from "../../../../packages/domain/daily-log";
import DailyWorkLog from "../components/DailyWorkLog.vue";
import CaptureInput from "../components/CaptureInput.vue";
import CaptureReferenceReview from "../components/CaptureReferenceReview.vue";
import CaptureResults from "../components/CaptureResults.vue";
import PersonPicker from "../components/PersonPicker.vue";
import {
  meetingResults,
  type CaptureResult,
} from "../services/capture-results";
import IntakeView from "./IntakeView.vue";
import ChannelResolve from "../components/ChannelResolve.vue";
import {
  structuredCapture,
  captureNeedsProjectContext,
  normalizeCreationText,
} from "../services/capture-routing";
import type { CaptureSource } from "../../../../packages/domain/capture";
import { looksLikeDailyLog } from "../../../../packages/domain/daily-log";
import { parseDailyReport } from "../../../../packages/domain/daily-report";
import { captureTextFields } from "../../../../packages/domain/intake-text";
import { t, locale } from "../locales";
import { catalogs, activeStages, catalogLabel } from "../composables/catalogs";
import { channelEntries } from "../../../../packages/domain/channels";
import { computed, nextTick, onMounted, ref, useId, watch } from "vue";
import { PhArrowRight, PhSparkle, PhX } from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { api, type ReviewedSuggestion } from "../services/api";
import {
  captureErrorMessage,
  isCaptureBudgetError,
} from "../services/capture-error";
import type {
  Proposal,
  Suggestion,
  AiCapabilities,
  Project,
} from "../../../../packages/domain/types";
import {
  pendingMeetingItems,
  meetingReplyProjects,
  meetingAutomaticProjects,
  meetingReplyDraft,
  groupMeetingItems,
  type MeetingNewProject,
} from "../../../../packages/domain/meeting-completion";
import { hasUnspecifiedOtherProject } from "../../../../packages/domain/meeting-sections";
import { useUnsaved } from "../composables/unsaved";
const props = withDefaults(
  defineProps<{
    embedded?: boolean;
    modal?: boolean;
    active?: boolean;
    assistant?: boolean;
    contextProjectId?: string;
  }>(),
  { active: true, contextProjectId: undefined },
);
const emit = defineEmits<{
  close: [];
  "busy-change": [boolean];
  result: [];
  "restore-context": [string | null];
}>();
const footer = ref<HTMLElement | null>(null);
const composerId = `capture-form-${useId()}`;
const store = useWorkspace();
const structuredSource = ref<string | null>(null);
const structuredOriginal = ref<CaptureSource>();
const logMode = ref(false),
  dailySource = ref("");
const capabilities = ref<AiCapabilities | null>(null);
let capabilityLoad: Promise<void> | undefined;
onMounted(() => {
  capabilityLoad = (async () => {
    try {
      capabilities.value = await api.aiCapabilities();
    } catch {
      /* Rule capture remains available. */
    }
  })();
});
const composer = ref(""),
  proposal = ref<Proposal | null>(null),
  error = ref(""),
  working = ref(false);
const budgetError = computed(() => isCaptureBudgetError(error.value));
const messages = ref<
  {
    role: "user" | "assistant";
    text: string;
    resultFor?: string;
    results?: CaptureResult[];
    links?: AssistantAnswer["links"];
    intakeId?: string;
    inactive?: boolean;
  }[]
>([]);
const thread = ref<HTMLElement>(),
  input = ref<InstanceType<typeof CaptureInput>>();
const referenceReview = ref<InstanceType<typeof CaptureReferenceReview>>();
const pending = computed(() =>
  proposal.value ? pendingMeetingItems(proposal.value) : [],
);
const current = computed(() => pending.value[0]);
const resolvedPending = computed(() =>
  pending.value.filter(
    (item) =>
      !hasUnspecifiedOtherProject(item.sourceText) &&
      item.sourceHeading !== "其他项目（需明确）" &&
      item.candidates.length === 1 &&
      available.value.some(
        (project) => project.id === item.candidates[0]!.projectId,
      ),
  ),
);
const saveResolvedLabel = computed(() =>
  locale.value === "en"
    ? `Save ${resolvedPending.value.length} matched items`
    : `保存 ${resolvedPending.value.length} 条已明确事项`,
);
const groups = computed(() =>
  groupMeetingItems(pending.value, available.value),
);
const currentGroup = computed(() => groups.value[0]);
const selectedNewIds = ref<string[]>([]);
const projectSearch = ref("");
const showReply = ref(false);
const searchedProjects = computed(() =>
  projectSearch.value.trim()
    ? meetingReplyProjects(projectSearch.value, available.value).slice(0, 8)
    : [],
);
const newProject = ref<ReturnType<typeof meetingReplyDraft> | null>(null);
const channels = computed(() =>
  channelEntries(catalogs.value).filter((channel) => !channel.archived),
);
const draftMatches = computed(() =>
  newProject.value?.name.trim()
    ? meetingReplyProjects(newProject.value.name, available.value)
    : [],
);
const retryItems = ref<ReviewedSuggestion[] | null>(null);
const available = computed(() =>
  store.data.projects.filter((p) => !p.intakeInbox),
);
const choices = computed(() => {
  if (!current.value) return [];
  const ids = new Set(current.value.candidates.map((c) => c.projectId));
  const related = currentGroup.value?.name
    ? meetingReplyProjects(currentGroup.value.name, available.value)
    : [];
  return available.value
    .filter(
      (project) =>
        ids.has(project.id) || related.some((match) => match.id === project.id),
    )
    .slice(0, 6);
});
const discard = useUnsaved(
  computed(
    () =>
      !props.assistant &&
      (!!composer.value.trim() ||
        !!pending.value.length ||
        !!input.value?.hasFiles),
  ),
);
const busy = computed(() => working.value || store.busy || !!input.value?.busy);
const phase = ref("");
watch(
  () => working.value || !!input.value?.busy,
  (value) => emit("busy-change", value),
);
const persistence = useAssistantSession(
  accountStorageKey("assistant-session", store.mode, store.user!),
  !!props.assistant,
  () => ({
    composer: composer.value,
    messages: messages.value.slice(-100),
    proposal: proposal.value,
    newProject: newProject.value,
    selectedNewIds: selectedNewIds.value,
    retryItems: retryItems.value,
    structuredSource: structuredSource.value,
    structuredOriginal: structuredOriginal.value,
    dailySource: dailySource.value,
    logMode: logMode.value,
    contextProjectId:
      composer.value ||
      input.value?.hasFiles ||
      pending.value.length ||
      structuredSource.value !== null ||
      logMode.value
        ? (props.contextProjectId ?? null)
        : undefined,
    attachments: input.value?.exportState(),
    referenceArchive: referenceReview.value?.exportState(),
  }),
  async (state) => {
    if (
      typeof state.contextProjectId === "string" ||
      state.contextProjectId === null
    )
      emit("restore-context", state.contextProjectId);
    composer.value =
      typeof state.composer === "string" ? state.composer.slice(0, 20000) : "";
    messages.value = Array.isArray(state.messages)
      ? state.messages
          .filter(
            (m) =>
              m &&
              ["user", "assistant"].includes(m.role) &&
              typeof m.text === "string",
          )
          .slice(-100)
      : [];
    proposal.value =
      state.proposal &&
      typeof state.proposal === "object" &&
      "id" in state.proposal &&
      Array.isArray((state.proposal as Proposal).suggestions)
        ? (state.proposal as Proposal)
        : null;
    newProject.value =
      state.newProject && typeof state.newProject === "object"
        ? (state.newProject as ReturnType<typeof meetingReplyDraft>)
        : null;
    selectedNewIds.value = Array.isArray(state.selectedNewIds)
      ? state.selectedNewIds.filter((id) => typeof id === "string")
      : [];
    retryItems.value = Array.isArray(state.retryItems)
      ? (state.retryItems as ReviewedSuggestion[])
      : null;
    structuredSource.value =
      typeof state.structuredSource === "string"
        ? state.structuredSource
        : null;
    structuredOriginal.value = state.structuredOriginal as
      CaptureSource | undefined;
    dailySource.value =
      typeof state.dailySource === "string" ? state.dailySource : "";
    logMode.value = state.logMode === true;
    await nextTick();
    input.value?.restoreState(state.attachments);
    await nextTick();
    referenceReview.value?.restoreState(state.referenceArchive);
    if (proposal.value) {
      if (retryItems.value)
        retryItems.value = retryItems.value.filter((item) =>
          pending.value.some((suggestion) => suggestion.id === item.id),
        );
      if (!retryItems.value?.length) retryItems.value = null;
      else
        error.value = t(
          "上次处理尚未确认返回结果，可继续完成；已成功的事项不会重复创建。",
        );
      summarize();
    }
  },
);
async function intakeCompleted(batch: IntakeBatch) {
  messages.value.push({
    role: "assistant",
    text: t("已完成：新建 {p0} 个项目，新增 {p1} 项任务。", {
      p0: batch.projects.filter((p) => !p.intakeInbox).length,
      p1: batch.tasks.length,
    }),
    results: intakeResults(batch, store.data.projects),
    intakeId: batch.id,
  });
  structuredSource.value = null;
  structuredOriginal.value = undefined;
  emit("result");
  await focusReply();
}
async function dailyCompleted(batch: DailyLogBatch) {
  messages.value.push({
    role: "assistant",
    text: t("已记录 {p0} 条进展。", {
      p0: batch.rows.filter((row) => row.status === "recorded").length,
    }),
    results: dailyLogResults(batch, store.data.projects),
  });
  logMode.value = false;
  dailySource.value = "";
  emit("result");
  await focusReply();
}
async function undoIntake(message: (typeof messages.value)[number]) {
  if (!message.intakeId || working.value) return;
  working.value = true;
  error.value = "";
  try {
    await store.operation(
      () => api.undoIntake(message.intakeId!),
      t("已撤销本次录入"),
    );
    message.inactive = true;
  } catch (e) {
    error.value = captureErrorMessage(e);
  } finally {
    working.value = false;
  }
}

const composerVisible = computed(
  () =>
    props.assistant ||
    !current.value ||
    !newProject.value ||
    showReply.value ||
    !!error.value ||
    !!input.value?.referenceFiles,
);
function closePanel() {
  if (!busy.value && (props.modal || discard())) emit("close");
}
defineExpose({
  closePanel,
  busy,
  hasDraft: computed(
    () =>
      !!composer.value.trim() ||
      !!input.value?.hasFiles ||
      !!pending.value.length ||
      structuredSource.value !== null ||
      logMode.value,
  ),
  focusComposer: () => input.value?.focus(),
});
function say(text: string, links?: AssistantAnswer["links"]) {
  messages.value.push({ role: "assistant", text, ...(links ? { links } : {}) });
  if (persistence.ready.value) emit("result");
}
async function focusReply() {
  await nextTick();
  if (!props.active) return;
  if (thread.value) thread.value.scrollTop = thread.value.scrollHeight;
  if (
    !props.assistant &&
    newProject.value &&
    current.value &&
    !showReply.value
  ) {
    const card = document.querySelector<HTMLElement>(".meeting-new-project");
    card?.scrollIntoView({ block: "nearest" });
    card
      ?.querySelector<HTMLHeadingElement>("h2")
      ?.focus({ preventScroll: true });
    return;
  }
  if (
    props.modal &&
    matchMedia("(pointer: coarse)").matches &&
    !pending.value.length &&
    !error.value
  ) {
    (document.activeElement as HTMLElement | null)?.blur();
    thread.value?.focus({ preventScroll: true });
    thread.value?.scrollIntoView({ block: "nearest" });
  } else input.value?.focus();
}
function reviewed(
  suggestion: Suggestion,
  projectId: string,
): ReviewedSuggestion {
  return {
    id: suggestion.id,
    selectedProjectId: projectId,
    title: suggestion.title,
    action: suggestion.action,
    status: suggestion.status,
    confirmed: true,
    overwriteConfirmed: false,
    projectVersion: store.data.projects.find((p) => p.id === projectId)
      ?.version,
  };
}
async function record(
  items: ReviewedSuggestion[],
  skippedIds: string[] = [],
  create?: MeetingNewProject,
) {
  proposal.value = await store.operation(
    () =>
      api.applyProposal(proposal.value!, items, {
        partial: true,
        updateMode: "append",
        ...(skippedIds.length ? { skippedIds } : {}),
        ...(create ? { newProject: create } : {}),
      }),
    t("会议事项已保存"),
  );
  summarize();
}
function summarize(detail = "") {
  if (!proposal.value) return;
  const results = meetingResults(proposal.value, store.data.projects);
  const count = (kind: CaptureResult["kind"]) =>
    results.filter((r) => r.kind === kind).length;
  const daily = proposal.value.suggestions.some((s) => s.dailyReport);
  const createdTasks = results.filter(
    (r) => r.kind === "task" && !r.linked,
  ).length;
  const linkedTasks = results.filter(
    (r) => r.kind === "task" && r.linked,
  ).length;
  const summary =
    [
      count("project") ? `新建 ${count("project")} 个项目` : "",
      createdTasks
        ? t(daily ? "新增 {p0} 项后续任务" : "新增 {p0} 项任务", {
            p0: createdTasks,
          })
        : "",
      linkedTasks ? t("关联 {p0} 项已有任务", { p0: linkedTasks }) : "",
      count("update")
        ? t(daily ? "归档 {p0} 条日报进展" : "记录 {p0} 条进展", {
            p0: count("update"),
          })
        : "",
      count("skipped") ? `${count("skipped")} 项暂不处理` : "",
    ]
      .filter(Boolean)
      .join("，") || t("原文已保存");
  const message = {
    role: "assistant" as const,
    resultFor: proposal.value.id,
    text: t("{p0}：{p1}。{p2}", {
      p0: pending.value.length ? t("已保存") : t("已完成"),
      p1: summary,
      p2: detail,
    }),
    results,
  };
  const index = messages.value.findIndex(
    (m) => m.resultFor === proposal.value!.id,
  );
  if (index < 0) messages.value.push(message);
  else if (
    index < messages.value.length - 1 &&
    JSON.stringify(messages.value[index]?.results) !== JSON.stringify(results)
  ) {
    // Keep a single authoritative receipt, after the reply that completed it.
    // Restoring or rephrasing an unchanged receipt must not reorder history.
    messages.value.splice(index, 1);
    messages.value.push(message);
  } else messages.value[index] = message;
  if (persistence.ready.value) emit("result");
}
function nextQuestion(detail = "") {
  newProject.value = null;
  projectSearch.value = "";
  showReply.value = false;
  if (!current.value) {
    summarize(detail);
    return;
  }
  const group = currentGroup.value!;
  if (group.name && !choices.value.length) {
    newProject.value = meetingReplyDraft(
      group.items.map((item) => item.sourceText).join("\n"),
      channels.value,
      catalogs.value,
    );
    if (!group.items.some((item) => captureTextFields(item.sourceText).project))
      newProject.value.name = group.name;
    selectedNewIds.value = group.items.map((item) => item.id);
    say(
      t(
        "{p0}这 {p1} 条都提到了“{p2}”，但现有项目中没有找到对应项目。下方已整理好，确认名称和渠道后即可一起归入新项目。",
        { p0: detail, p1: group.items.length, p2: group.name },
      ),
    );
    return;
  }
  say(
    t("{p0}{p1}", {
      p0: detail,
      p1: choices.value.length
        ? t("找到可能对应的已有项目，请确认归属。")
        : t("这条事项暂时看不出项目名称。可以填写名称新建，或搜索已有项目。"),
    }),
  );
  if (
    /(?:新建|创建|建立)[^，,；;\n]*项目|项目(?:名称|名)[：:]/.test(
      current.value.sourceText,
    )
  )
    newProject.value = meetingReplyDraft(
      current.value.sourceText,
      channels.value,
      catalogs.value,
    );
  selectedNewIds.value = group.items.map((item) => item.id);
}
async function submitNotes() {
  working.value = true;
  error.value = "";
  const contextProject = available.value.find(
    (p) => p.id === props.contextProjectId,
  );
  phase.value = input.value?.referenceFiles
    ? t("正在分类并归档资料…")
    : input.value?.hasFiles
      ? t("正在读取附件内容…")
      : t("正在整理内容…");
  if (input.value?.referenceMaterials.length && !input.value.uncertainPurpose) {
    try {
      const result = await referenceReview.value!.archive();
      messages.value.push({
        role: "user",
        text: result.files.map((f) => f.name).join("、"),
      });
      say(
        t("已归档 {p0} 份资料到“{p1}”，未新建任务、未改变任务状态。{p2}", {
          p0: result.files.length,
          p1: result.project.shortName || result.project.name,
          p2: result.note,
        }),
        result.files.map((file) => ({
          title: file.name,
          detail: `已归档 · ${result.project.shortName || result.project.name}`,
          path: `/projects/${encodeURIComponent(result.project.id)}#project-files`,
        })),
      );
      input.value.removeArchived(result.files.map((file) => file.id));
      await store.refresh();
      await nextTick();
      if (!input.value.hasFiles) {
        composer.value = "";
        working.value = false;
        return;
      }
    } catch (e) {
      error.value = captureErrorMessage(e);
      working.value = false;
      return;
    } finally {
      working.value = false;
    }
  }
  working.value = true;
  let source: string, originalSource: CaptureSource;
  try {
    const prepared = await input.value!.resolveSource();
    source = prepared.text;
    if (
      props.assistant &&
      contextProject &&
      !available.value.some((p) =>
        [p.name, p.shortName, ...p.aliases].some(
          (name) => name && source.includes(name),
        ),
      ) &&
      captureNeedsProjectContext(source)
    )
      source = parseDailyReport(source)
        ? `项目：${contextProject.name}\n${source}`
        : t("项目：{p0}；{p1}", { p0: contextProject.name, p1: source });
    originalSource = prepared.originalSource;
  } catch (e) {
    error.value = captureErrorMessage(e);
    working.value = false;
    return;
  }
  const dailyReport = parseDailyReport(source);
  if (!dailyReport && !input.value?.hasFiles && structuredCapture(source)) {
    if (props.assistant) messages.value.push({ role: "user", text: source });
    structuredSource.value = normalizeCreationText(source)
      .replace(/^【[^\n]*】\s*$/gm, "")
      .trim();
    structuredOriginal.value = originalSource;
    composer.value = "";
    input.value?.clearFiles();
    working.value = false;
    return;
  }
  if (!dailyReport && !input.value?.hasFiles && looksLikeDailyLog(source)) {
    if (props.assistant) messages.value.push({ role: "user", text: source });
    dailySource.value = source;
    composer.value = "";
    logMode.value = true;
    input.value?.clearFiles();
    working.value = false;
    return;
  }
  working.value = true;
  error.value = "";
  proposal.value = null;
  newProject.value = null;
  retryItems.value = null;
  messages.value.push({ role: "user", text: source });
  try {
    phase.value = t("正在保存原文并匹配项目…");
    // Save the exact original source before attempting external extraction.
    proposal.value = await api.propose(
      source,
      originalSource,
      input.value?.temporaryMaterialIds(),
    );
    composer.value = "";
    input.value?.clearFiles();
    await capabilityLoad;
    if (capabilities.value?.enabled) {
      phase.value = t("AI 正在识别事项与归属…");
      try {
        proposal.value = await api.proposeQwen(source, true, originalSource);
      } catch (failure) {
        if (
          typeof failure === "object" &&
          failure !== null &&
          "code" in failure &&
          failure.code === "AI_CONNECTION"
        )
          say(t(captureErrorMessage(failure)));
        say(
          t(
            "纪要原文已保存。AI 整理未完成，本次采用规则整理；项目不明确的事项只提醒，不创建记录。",
          ),
        );
      }
      try {
        capabilities.value = await api.aiCapabilities();
      } catch {
        /* Preserve saved notes. */
      }
    }
    const unspecified = pending.value.filter(
      (item) =>
        hasUnspecifiedOtherProject(item.sourceText) ||
        item.sourceHeading === "其他项目（需明确）" ||
        (item.candidates.length !== 1 &&
          !(
            item.candidates.length === 0 &&
            meetingAutomaticProjects(item, available.value).length === 1
          )),
    );
    if (unspecified.length) {
      await record(
        [],
        unspecified.map((item) => item.id),
      );
      say(
        locale.value === "en"
          ? "Some project names are unspecified. Those items were skipped; no projects, tasks or progress records were created."
          : "有些事项未明确项目，已跳过，仅保留原文提醒；没有为这些事项创建项目、任务或进展。",
      );
    }
    const ready = pending.value
      .map((s) => ({
        suggestion: s,
        matches: meetingAutomaticProjects(s, available.value),
      }))
      .filter(
        ({ suggestion, matches }) =>
          suggestion.candidates.length === 1 ||
          (!suggestion.candidates.length && matches.length === 1),
      );
    if (ready.length) {
      phase.value = t("正在记录明确事项…");
      retryItems.value = ready.map(({ suggestion, matches }) =>
        reviewed(
          suggestion,
          suggestion.candidates[0]?.projectId ?? matches[0]!.id,
        ),
      );
      await record(retryItems.value);
      retryItems.value = null;
    }
    nextQuestion(
      pending.value.length && ready.length
        ? t("已保存 {p0} 项明确事项。", { p0: ready.length }) + "\n"
        : "",
    );
  } catch (e) {
    error.value = captureErrorMessage(e);
  } finally {
    working.value = false;
    await focusReply();
  }
}
async function retryCompletion() {
  if (!retryItems.value || working.value || store.busy) return;
  working.value = true;
  error.value = "";
  try {
    await record(retryItems.value);
    retryItems.value = null;
    nextQuestion();
  } catch (e) {
    error.value = captureErrorMessage(e);
  } finally {
    working.value = false;
    await focusReply();
  }
}
async function saveResolved() {
  if (
    working.value ||
    store.busy ||
    retryItems.value ||
    !resolvedPending.value.length
  )
    return;
  retryItems.value = resolvedPending.value.map((item) =>
    reviewed(item, item.candidates[0]!.projectId),
  );
  await retryCompletion();
}
async function assign(project: Project) {
  if (!current.value || working.value || store.busy) return;
  const suggestions = currentGroup.value?.items ?? [current.value];
  working.value = true;
  error.value = "";
  try {
    await record(
      suggestions.map((suggestion) => reviewed(suggestion, project.id)),
    );
    nextQuestion(
      pending.value.length
        ? t("已记录到“{p0}”。", { p0: project.shortName || project.name }) +
            "\n"
        : "",
    );
  } catch (e) {
    error.value = captureErrorMessage(e);
  } finally {
    working.value = false;
    await focusReply();
  }
}
async function choose(project: Project) {
  messages.value.push({
    role: "user",
    text: project.shortName || project.name,
  });
  await assign(project);
}
async function prepareNewProject(reply = "") {
  if (!current.value || working.value || store.busy) return;
  showReply.value = false;
  newProject.value = meetingReplyDraft(
    reply ||
      (currentGroup.value?.items ?? [current.value])
        .map((item) => item.sourceText)
        .join("\n"),
    channels.value,
    catalogs.value,
  );
  if (
    !reply &&
    currentGroup.value?.name &&
    !currentGroup.value.items.some(
      (item) => captureTextFields(item.sourceText).project,
    )
  )
    newProject.value.name = currentGroup.value.name;
  selectedNewIds.value = (currentGroup.value?.items ?? [current.value]).map(
    (item) => item.id,
  );
  error.value = "";
  if (props.modal && matchMedia("(pointer: coarse)").matches) {
    await focusReply();
  } else {
    await nextTick();
    if (props.active)
      document
        .querySelector<HTMLInputElement>("[data-meeting-project-name]")
        ?.focus();
  }
}
async function confirmNewProject() {
  if (!current.value || !newProject.value || working.value || store.busy)
    return;
  const suggestions = (currentGroup.value?.items ?? [current.value]).filter(
    (item) => selectedNewIds.value.includes(item.id),
  );
  const name = newProject.value.name.trim(),
    channelId = newProject.value.channelId;
  if (!name || !channelId || !suggestions.length) return;
  working.value = true;
  error.value = "";
  try {
    await record(
      suggestions.map((suggestion) => reviewed(suggestion, "__new_project__")),
      [],
      {
        suggestionId: suggestions[0]!.id,
        suggestionIds: suggestions.map((suggestion) => suggestion.id),
        name,
        channelId,
        details: newProject.value.details,
        confirmed: true,
      },
    );
    nextQuestion(
      t("已新建“{p0}”，并归入 {p1} 条事项。", {
        p0: name,
        p1: suggestions.length,
      }) + "\n",
    );
  } catch (e) {
    error.value = captureErrorMessage(e);
    await store.refresh(true);
  } finally {
    working.value = false;
    await focusReply();
  }
}
async function defer() {
  if (!current.value || working.value || store.busy) return;
  working.value = true;
  error.value = "";
  try {
    let inbox = store.data.projects.find((p) => p.intakeInbox);
    if (!inbox)
      inbox = await store.saveProject({
        name: "未分配工作",
        shortName: "待归类",
        intakeInbox: true,
        channelId: "company",
        client: "",
        description: "待明确项目的事项",
        stage: "unclassified",
        owner: "",
        discipline: "Unassigned",
        latestUpdate: "",
        notes: "",
        aliases: [],
      });
    // Keep the source as a task when its project is not yet known.
    await record([{ ...reviewed(current.value, inbox.id), action: "task" }]);
    nextQuestion(t("事项已保存到未分配工作，之后可补充项目归属。\n"));
  } catch (e) {
    error.value = captureErrorMessage(e);
  } finally {
    working.value = false;
    await focusReply();
  }
}
async function skip() {
  if (!current.value || working.value || store.busy) return;
  working.value = true;
  error.value = "";
  try {
    await record([], [current.value.id]);
    nextQuestion();
  } catch (e) {
    error.value = captureErrorMessage(e);
  } finally {
    working.value = false;
    await focusReply();
  }
}
async function tryChatQuery() {
  const text = composer.value.trim();
  if (!props.assistant || input.value?.hasFiles || text.length > 2000)
    return false;
  let projectId = props.contextProjectId;
  if (!projectId && /这个项目|该项目|它的|上面这个/.test(text)) {
    const previous = messages.value
      .filter(
        (message) => message.role === "assistant" && message.links?.length,
      )
      .at(-1);
    const ids = [
      ...new Set(
        previous?.links
          ?.map((link) => /^\/projects\/([^/?#]+)/.exec(link.path)?.[1])
          .filter(Boolean),
      ),
    ];
    if (ids.length === 1) projectId = decodeURIComponent(ids[0]!);
  }
  phase.value = t("正在查询工作区记录…");
  const answer = await api.queryAssistant({
    text,
    projectId,
    locale: locale.value,
  });
  if (!answer.handled) return false;
  messages.value.push(
    { role: "user", text },
    { role: "assistant", text: answer.text, links: answer.links },
  );
  emit("result");
  composer.value = "";
  await focusReply();
  return true;
}
async function submit() {
  if (
    !persistence.ready.value ||
    persistence.conflict.value ||
    working.value ||
    store.busy ||
    input.value?.busy ||
    (!composer.value.trim() && !input.value?.hasFiles)
  )
    return;
  if (props.assistant && !input.value?.hasFiles) {
    working.value = true;
    error.value = "";
    try {
      if (await tryChatQuery()) return;
    } catch (e) {
      error.value = captureErrorMessage(e);
      return;
    } finally {
      working.value = false;
      phase.value = "";
    }
  }
  if (
    props.assistant &&
    structuredSource.value !== null &&
    !input.value?.hasFiles
  ) {
    const reply = composer.value.trim();
    messages.value.push({ role: "user", text: reply });
    composer.value = "";
    if (/^(取消|不用创建|不创建|算了|取消新建)$/.test(reply)) {
      structuredSource.value = null;
      say(t("已取消本次新建。"));
      return;
    }
    const corrections = reply.replace(
      /(渠道|阶段|负责人|客户|执行人|截止日期)(?:改成|改为|是|为)\s*/g,
      "$1：",
    );
    structuredSource.value += `；${corrections}`;
    return;
  }
  if (input.value?.hasFiles || !current.value) return submitNotes();
  if (input.value?.hasFiles) {
    working.value = true;
    try {
      composer.value = (await input.value.resolveSource()).text;
      input.value.clearFiles();
    } catch (e) {
      error.value = captureErrorMessage(e);
      return;
    } finally {
      working.value = false;
    }
  }
  const reply = composer.value.trim();
  messages.value.push({ role: "user", text: reply });
  composer.value = "";
  if (/^(?:暂不归项目|稍后归类|未分配)$/.test(reply)) return defer();
  if (/^(?:跳过|略过|不用处理)$/.test(reply)) return skip();
  const matches = meetingReplyProjects(reply, available.value);
  if (matches.length === 1) return assign(matches[0]!);
  if (!matches.length) {
    say(
      t(
        "没有找到对应项目。请核对下方的新项目名称和渠道，确认后再创建并记录这条事项。",
      ),
    );
    await prepareNewProject(reply);
    return;
  }
  say(t("这个名称对应多个项目，请回复完整名称或点选项目。"));
  await focusReply();
}
</script>
<template>
  <section
    class="page meetings-page"
    :class="{
      'capture-embedded': props.embedded,
      'capture-modal': props.modal,
      'capture-assistant': props.assistant,
    }"
    :aria-label="t('AI 录入')"
  >
    <div v-if="!assistant" class="page-heading">
      <div>
        <component :is="embedded ? 'h2' : 'h1'">{{ t("AI 录入") }}</component>
        <p class="page-subtitle">{{ t("粘贴文字、截图或文件，一次整理。") }}</p>
      </div>
      <button
        v-if="embedded"
        class="icon-button"
        :aria-label="t('关闭 AI 录入')"
        :disabled="busy"
        @click="closePanel"
      >
        <PhX :size="18" />
      </button>
      <PhSparkle v-else :size="24" class="muted" />
    </div>
    <p
      v-if="assistant && !persistence.ready.value"
      class="assistant-session-notice"
      role="status"
    >
      {{ t("正在恢复对话…") }}
    </p>
    <div
      v-if="assistant && persistence.issue.value"
      class="assistant-session-notice"
      role="status"
    >
      {{ t(persistence.issue.value)
      }}<button
        v-if="persistence.conflict.value"
        type="button"
        class="text-button"
        @click="persistence.recoverRemote"
      >
        {{ t("恢复云端对话") }}
      </button>
    </div>
    <div class="capture-content">
      <button
        v-if="logMode || structuredSource !== null"
        class="text-button capture-back"
        @click="
          logMode = false;
          structuredSource = null;
        "
      >
        {{ t("← 返回对话") }}
      </button>
      <IntakeView
        v-if="structuredSource !== null && !assistant"
        :initial-source="structuredSource"
        :original-source="structuredOriginal"
        compact-review
        auto-review
        embedded
        @close="structuredSource = null"
        @completed="intakeCompleted"
      />
      <KeepAlive
        ><DailyWorkLog
          v-if="logMode && structuredSource === null && !assistant"
          :initial-source="dailySource"
          @completed="dailyCompleted"
      /></KeepAlive>
      <section
        v-if="assistant || (!logMode && structuredSource === null)"
        class="panel meeting-conversation"
        :class="{ 'capture-empty': !messages.length }"
        :aria-label="t('会议纪要对话')"
      >
        <div
          v-if="messages.length || assistant"
          ref="thread"
          tabindex="-1"
          class="meeting-thread"
          role="log"
          aria-live="polite"
        >
          <div v-if="assistant && !messages.length" class="assistant-welcome">
            <PhSparkle :size="28" weight="duotone" />
            <h2>{{ t("把事情交给我") }}</h2>
            <p>
              {{ t("说一句、贴张图，或拖入文件。") }}<br />{{
                t("我来查进展、整理待办和归档资料。")
              }}
            </p>
            <div>
              <button
                type="button"
                @click="
                  composer = t('今天有哪些待办？');
                  input?.focus();
                "
              >
                {{ t("今天有哪些待办？") }}</button
              ><button
                type="button"
                @click="
                  composer = t('本周有哪些逾期任务？');
                  input?.focus();
                "
              >
                {{ t("本周需要关注什么？") }}
              </button>
            </div>
          </div>
          <div
            v-for="(message, index) in messages"
            :key="index"
            class="meeting-message"
            :class="message.role"
            :data-has-results="!!message.results?.length"
          >
            <small>{{
              message.role === "user" ? t("你") : t("AI 工作助手")
            }}</small>
            <p>{{ message.text }}</p>
            <CaptureResults
              v-if="message.results"
              :rows="message.results"
              :inactive="message.inactive"
            />
            <ul v-if="message.links?.length" class="assistant-answer-links">
              <li v-for="link in message.links" :key="link.path">
                <RouterLink :to="link.path"
                  ><strong>{{ link.title }}</strong
                  ><span>{{ link.detail }}</span></RouterLink
                >
              </li>
            </ul>
            <button
              v-if="message.intakeId && !message.inactive"
              type="button"
              class="text-button assistant-undo"
              :disabled="busy"
              @click="undoIntake(message)"
            >
              {{ t("撤销本次录入") }}
            </button>
            <small v-if="message.inactive">{{ t("本次录入已撤销") }}</small>
          </div>
        </div>
        <div
          v-if="assistant && structuredSource !== null"
          class="assistant-inline-review"
        >
          <IntakeView
            :key="structuredSource"
            :initial-source="structuredSource"
            :original-source="structuredOriginal"
            compact-review
            conversational
            auto-review
            embedded
            @close="structuredSource = null"
            @completed="intakeCompleted"
          />
        </div>
        <div
          v-if="assistant && logMode && structuredSource === null"
          class="assistant-inline-review"
        >
          <DailyWorkLog
            :key="dailySource"
            :initial-source="dailySource"
            @completed="dailyCompleted"
          />
        </div>
        <div
          v-if="current && !working && !retryItems && !input?.referenceFiles"
          :class="{ 'assistant-resolution': assistant }"
        >
          <section
            v-if="current && !working && !retryItems && !input?.referenceFiles"
            class="meeting-answer-options"
            :aria-label="t('待确认项目')"
          >
            <div class="pending-heading">
              <strong>{{ groups.length }} {{ t("组项目待确认") }}</strong
              ><span class="muted"
                >{{ t("共") }} {{ pending.length }} {{ t("条事项") }}</span
              >
            </div>
            <div class="pending-groups">
              <span
                v-for="group in groups"
                :key="group.key"
                :class="{ active: group.key === currentGroup?.key }"
                >{{ group.name || t("待明确项目") }} · {{ group.items.length }}
                {{ t("条") }}</span
              >
            </div>
            <button
              v-if="resolvedPending.length"
              type="button"
              :disabled="store.busy"
              @click="saveResolved"
            >
              {{ saveResolvedLabel }}
            </button>
            <div v-if="choices.length" class="project-answers">
              <button
                v-for="project in choices"
                :key="project.id"
                type="button"
                :disabled="store.busy"
                @click="choose(project)"
              >
                {{ t("归入") }} {{ project.shortName || project.name }}（{{
                  currentGroup?.items.length
                }}
                {{ t("条）") }}
              </button>
            </div>
            <ul
              v-if="!newProject && (currentGroup?.items.length ?? 0) > 1"
              class="related-items"
            >
              <li v-for="item in currentGroup?.items" :key="item.id">
                {{ item.sourceText }}
              </li>
            </ul>
            <details class="existing-project-search">
              <summary>{{ t("选择其他已有项目") }}</summary>
              <input
                v-model="projectSearch"
                :aria-label="t('搜索已有项目')"
                :placeholder="t('输入项目名称、简称或别名')"
              />
              <div class="project-answers">
                <button
                  v-for="project in searchedProjects"
                  :key="project.id"
                  type="button"
                  :disabled="store.busy"
                  @click="choose(project)"
                >
                  {{ t("归入") }} {{ project.shortName || project.name }}（{{
                    currentGroup?.items.length
                  }}
                  {{ t("条）") }}</button
                ><span
                  v-if="projectSearch.trim() && !searchedProjects.length"
                  class="muted"
                  >{{ t("没有找到匹配项目，可在下方确认新建。") }}</span
                >
              </div>
            </details>
            <div class="project-answers">
              <button
                v-if="!newProject"
                type="button"
                :disabled="store.busy"
                @click="prepareNewProject()"
              >
                {{ t("填写名称并新建项目") }}</button
              ><button
                type="button"
                class="text-button"
                :disabled="store.busy"
                @click="defer"
              >
                {{ t("这条稍后归类") }}</button
              ><button
                type="button"
                class="text-button"
                :disabled="store.busy"
                @click="skip"
              >
                {{ t("这条不用处理") }}
              </button>
            </div>
          </section>
          <form
            v-if="newProject && current && !input?.referenceFiles"
            class="meeting-new-project"
            :aria-label="t('确认新建项目')"
            @submit.prevent="confirmNewProject"
          >
            <h2 tabindex="-1">
              {{
                currentGroup?.name
                  ? t("未找到“{p0}”，是否新建项目？", { p0: currentGroup.name })
                  : t("确认新建项目")
              }}
            </h2>
            <p class="muted">
              {{
                t(
                  "已将可能属于同一项目的事项放在一起。请核对名称、渠道和下方勾选项，确认后一次保存。",
                )
              }}
            </p>
            <div class="new-project-fields">
              <label
                >{{ t("项目名称")
                }}<input
                  v-model="newProject.name"
                  data-meeting-project-name
                  maxlength="120"
                  required
                  :disabled="working || store.busy"
              /></label>
              <label
                >{{ t("渠道")
                }}<select
                  v-model="newProject.channelId"
                  :aria-label="t('渠道')"
                  required
                  :disabled="working || store.busy"
                >
                  <option value="" disabled>{{ t("请选择渠道") }}</option>
                  <option
                    v-for="channel in channels"
                    :key="channel.id"
                    :value="channel.id"
                  >
                    {{ channel.name }}
                  </option>
                </select></label
              >
            </div>
            <ChannelResolve
              v-if="newProject.unmatchedChannel && !newProject.channelId"
              :name="newProject.unmatchedChannel"
              @resolved="newProject.channelId = $event"
            />
            <div class="new-project-fields">
              <label
                >{{ t("客户")
                }}<input v-model="newProject.details.client" maxlength="120"
              /></label>
              <label
                >{{ t("负责人")
                }}<PersonPicker
                  v-model="newProject.details.owner"
                  :label="t('新项目负责人')"
                  compact
              /></label>
              <label
                >{{ t("阶段")
                }}<select v-model="newProject.details.stage" required>
                  <option value="" disabled>
                    {{ t("未识别，请选择阶段") }}
                  </option>
                  <option value="unclassified">{{ t("阶段待补") }}</option>
                  <option
                    v-for="stage in activeStages"
                    :key="stage.id"
                    :value="stage.id"
                  >
                    {{ catalogLabel("stages", stage.id) }}
                  </option>
                </select></label
              >
              <label
                >{{ t("简称")
                }}<input v-model="newProject.details.shortName" maxlength="80"
              /></label>
            </div>
            <p
              v-if="newProject.unmatchedStage && !newProject.details.stage"
              class="error-box"
            >
              {{ t("未识别阶段“") }}{{ newProject.unmatchedStage
              }}{{ t("”，请选择后保存。") }}
            </p>
            <p v-if="newProject.issues.length" class="error-box">
              {{ newProject.issues.map((issue) => t(issue)).join("；") }}
            </p>
            <fieldset class="meeting-group-items">
              <legend>
                {{ t("归入这个项目的事项（") }}{{ selectedNewIds.length }}
                {{ t("条）") }}
              </legend>
              <label v-for="item in currentGroup?.items" :key="item.id"
                ><input
                  v-model="selectedNewIds"
                  type="checkbox"
                  :value="item.id"
                  :aria-label="item.sourceText"
                  :disabled="working || store.busy"
                /><span>{{ item.sourceText }}</span></label
              >
            </fieldset>
            <div v-if="draftMatches.length" class="project-answers">
              <span>{{ t("可能是已有项目：") }}</span
              ><button
                v-for="project in draftMatches"
                :key="project.id"
                type="button"
                :disabled="working || store.busy"
                @click="choose(project)"
              >
                {{ t("归入") }} {{ project.shortName || project.name }}
              </button>
            </div>
            <div class="form-actions">
              <button
                type="button"
                :disabled="working || store.busy"
                @click="newProject = null"
              >
                {{ t("取消新建") }}</button
              ><button
                type="submit"
                class="primary"
                :disabled="
                  working ||
                  store.busy ||
                  !newProject.name.trim() ||
                  !newProject.channelId ||
                  !selectedNewIds.length
                "
              >
                {{ t("确认新建并记录事项") }}
              </button>
            </div>
          </form>
          <button
            v-if="!assistant && current && newProject && !showReply"
            type="button"
            class="text-button supplementary-reply"
            @click="
              showReply = true;
              focusReply();
            "
          >
            {{ t("需要补充说明或调整归属？") }}
          </button>
        </div>
        <form
          :id="composerId"
          class="capture-composer-form"
          v-show="composerVisible"
          :aria-label="t('会议纪要输入')"
          @submit.prevent="submit"
        >
          <CaptureInput
            ref="input"
            v-model="composer"
            reference-mode
            :active="active"
            :rows="
              assistant
                ? 3
                : input?.referenceFiles
                  ? 2
                  : messages.length
                    ? 3
                    : embedded
                      ? 5
                      : 7
            "
            :maxlength="20000"
            :disabled="
              working ||
              store.busy ||
              !persistence.ready.value ||
              persistence.conflict.value
            "
            :label="current ? t('回复') : t('录入内容')"
            :placeholder="
              assistant && !current
                ? t('告诉我需要做什么，或直接粘贴图片、表格、文件…')
                : input?.referenceFiles
                  ? t(
                      '补充说明（可选），例如：现场照片、报价资料；不用粘贴正文。',
                    )
                  : current
                    ? t(
                        '例如：韵升项目，渠道是浙电，如果没有就新建；也可回复已有项目名称。',
                      )
                    : t(
                        '粘贴文字、截图或表格，也可添加文件。\n例如：项目：智慧园区；渠道：公司；任务：确认现场需求。',
                      )
            "
            @submit="submit"
          />
          <CaptureReferenceReview
            v-if="input?.referenceMaterials.length && !input.uncertainPurpose"
            ref="referenceReview"
            :files="input.referenceMaterials"
            :notes="composer"
            :default-project-id="contextProjectId"
            :disabled="working || store.busy"
          />
          <div v-if="error" class="error-box" role="alert">
            <p>
              {{ t(error)
              }}<span v-if="proposal">
                {{ t("原文已保存，可继续处理。") }}</span
              >
            </p>
            <p v-if="budgetError">
              {{
                t(
                  "Your input and attachments remain here. Retry after the allowance is renewed.",
                )
              }}
              <RouterLink
                v-if="store.mode === 'server' && store.user?.role === 'admin'"
                to="/admin?tab=model"
                target="_blank"
                rel="noopener"
                class="text-button"
                >{{
                  t("Manage AI attempt allowance (opens a new tab)")
                }}</RouterLink
              >
            </p>
            <button
              v-if="retryItems"
              type="button"
              class="text-button"
              :disabled="working || store.busy"
              @click="retryCompletion"
            >
              {{ t("继续完成") }}
            </button>
          </div>
          <p
            v-if="assistant && busy"
            class="assistant-processing"
            role="status"
          >
            <PhSparkle :size="14" />{{
              input?.busy ? t("正在读取内容…") : phase || t("正在保存…")
            }}
          </p>
          <Teleport :to="footer ?? 'body'" :disabled="!modal || !footer">
            <div
              v-show="composerVisible"
              class="form-actions capture-submit-actions"
            >
              <small class="muted capture-keyboard-hint">{{
                input?.referenceFiles
                  ? t("归档资料，不生成任务")
                  : t("Ctrl / ⌘ + Enter 整理")
              }}</small
              ><button
                :form="composerId"
                type="submit"
                class="primary"
                :disabled="
                  (!composer.trim() && !input?.hasFiles) ||
                  !!input?.busy ||
                  working ||
                  (input?.referenceMaterials.length &&
                    !input.uncertainPurpose &&
                    !referenceReview?.ready) ||
                  store.busy ||
                  !persistence.ready.value ||
                  persistence.conflict.value
                "
              >
                {{
                  working
                    ? t("正在处理…")
                    : input?.referenceFiles
                      ? t("归档资料")
                      : current
                        ? t("回复并完成")
                        : assistant
                          ? t("发送")
                          : t("识别并整理")
                }}<PhArrowRight :size="16" />
              </button>
            </div>
          </Teleport>
        </form>
      </section>
    </div>
    <div v-if="modal" ref="footer" class="capture-dialog-footer" />
  </section>
</template>
<style scoped>
.capture-embedded {
  padding: 18px !important;
  margin: 0 0 18px;
  max-width: none;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.capture-embedded .page-heading {
  margin-bottom: 14px;
}
.capture-embedded h2 {
  font-size: 17px;
  margin: 0;
}
.capture-embedded .page-subtitle {
  font-size: 12px;
  margin: 5px 0 0;
}
.capture-embedded .meeting-conversation {
  border: 0;
  padding: 0;
  box-shadow: none;
}
.capture-back {
  margin-bottom: 12px;
  color: var(--accent);
}
.log-mode-switch {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
}
.log-mode-switch [aria-pressed="true"] {
  color: var(--accent);
  border-color: var(--accent);
}
.meeting-conversation {
  padding: 20px;
}
.pending-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.pending-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.pending-groups span {
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 20px;
  background: var(--surface-subtle);
  color: var(--muted);
}
.pending-groups .active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}
.existing-project-search {
  margin: 12px 0;
  font-size: 13px;
}
.existing-project-search summary {
  cursor: pointer;
  color: var(--accent);
}
.existing-project-search input {
  width: 100%;
  margin-top: 10px;
}
.meeting-group-items {
  min-width: 0;
  margin: 14px 0;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.meeting-group-items legend {
  font-size: 12px;
  color: var(--muted);
}
.meeting-group-items label {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  font-size: 13px;
  font-weight: 400;
}
.meeting-group-items input {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-top: 2px;
}
.meeting-group-items span,
.related-items li {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.related-items {
  font-size: 13px;
  padding-left: 20px;
}
.supplementary-reply {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.meeting-new-project {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  margin: 12px 0 20px;
  background: var(--surface-subtle);
}
.meeting-new-project h2 {
  font-size: 16px;
  margin: 0 0 10px;
}
.new-project-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.new-project-fields input,
.new-project-fields select {
  width: 100%;
}
.meeting-new-source {
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.meeting-thread {
  max-height: 520px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 16px;
}
.meeting-message {
  max-width: 90%;
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--surface-subtle);
}
.meeting-message.user {
  align-self: flex-end;
  background: var(--accent-bg);
}
.meeting-message[data-has-results="true"] {
  max-width: 100%;
  width: 100%;
  box-sizing: border-box;
}
.meeting-message small {
  font-size: 10px;
  color: var(--muted);
}
.meeting-message p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 5px 0 0;
  font-size: 13px;
}
.meeting-answer-options {
  margin-bottom: 12px;
}
.project-answers {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.project-answers button {
  font-size: 12px;
  padding: 6px 9px;
}
.meeting-conversation textarea {
  width: 100%;
  line-height: 1.7;
  font-size: 13px;
}
.form-actions {
  justify-content: space-between;
}
.capture-modal {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: inherit;
  margin: 0;
  padding: 0 !important;
  border: 0;
  border-radius: inherit;
  overflow: hidden;
}
.capture-modal > .page-heading {
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  align-items: center;
  margin: 0;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}
.capture-modal .page-heading > .icon-button {
  min-width: 44px;
  min-height: 44px;
}
.capture-modal .capture-content {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px;
}
.capture-modal .meeting-conversation {
  margin: 0;
}
.capture-modal :deep(.intake-embedded) {
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 0;
}
.capture-modal .meeting-thread {
  max-height: none;
  overflow: visible;
}
.capture-modal .capture-submit-actions {
  margin: 0;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.capture-dialog-footer {
  flex: 0 0 auto;
}
.capture-modal .capture-submit-actions > button {
  min-height: 44px;
}
@media (max-width: 600px) {
  .capture-modal {
    flex: 1;
    width: 100%;
    height: 100%;
  }
  .capture-modal > .page-heading {
    padding: max(10px, env(safe-area-inset-top)) 12px 10px;
  }
  .capture-modal .capture-content {
    flex: 1;
    padding: 16px;
  }
  .capture-modal .capture-submit-actions {
    padding: 12px 16px max(12px, env(safe-area-inset-bottom));
  }
  .capture-modal .capture-submit-actions > button {
    width: 100%;
  }
  .capture-modal .capture-empty :deep(textarea) {
    min-height: clamp(
      150px,
      calc(var(--capture-viewport-height, 100dvh) - 260px),
      520px
    );
    resize: none;
  }
  .capture-keyboard-hint {
    display: none;
  }
  .capture-modal :deep(input:not([type="checkbox"])),
  .capture-modal :deep(select),
  .capture-modal :deep(textarea) {
    font-size: 16px;
  }
  .capture-modal :deep(button) {
    min-height: 44px;
  }
  .capture-modal :deep(.icon-button) {
    min-width: 44px;
  }
  .new-project-fields {
    grid-template-columns: 1fr;
  }
  .meeting-conversation {
    padding: 12px;
  }
  .meeting-message {
    max-width: 100%;
  }
}

.capture-assistant {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  padding: 0 !important;
  margin: 0;
  border: 0;
  border-radius: 0;
  overflow: hidden;
}
.capture-assistant .capture-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.capture-assistant .meeting-conversation {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  margin: 0;
}
.capture-assistant .meeting-thread {
  flex: 1;
  min-height: 80px;
  max-height: none;
  padding: 18px 16px;
  gap: 18px;
}
.capture-assistant form.capture-composer-form {
  flex: none;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.capture-assistant .meeting-answer-options,
.capture-assistant .meeting-new-project {
  padding: 12px 14px;
  margin: 0;
  border-radius: 0;
  border-top: 1px solid var(--border);
}
.assistant-resolution {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 42dvh;
  overflow: auto;
  overscroll-behavior: contain;
}
.capture-assistant .meeting-message {
  padding: 0;
  background: transparent;
  border-radius: 0;
  max-width: 100%;
}
.capture-assistant .meeting-message.user {
  background: var(--accent-bg);
  padding: 10px 12px;
  border-radius: 10px;
  max-width: 94%;
}
.capture-assistant .meeting-message p {
  font-size: 14px;
  line-height: 1.65;
}
.capture-assistant .meeting-message > small {
  font-size: 11px;
}
.capture-assistant .capture-submit-actions {
  margin: 8px 0 0;
}
.capture-assistant .capture-submit-actions > button {
  min-height: 36px;
  padding: 7px 13px;
}
.capture-assistant :deep(.capture-label) {
  font-size: 0;
  gap: 0;
}
.capture-assistant :deep(.capture-label textarea) {
  min-height: 84px;
  max-height: 180px;
  font-size: 14px;
  line-height: 1.6;
}
.capture-assistant :deep(.capture-tools) {
  margin-top: 7px;
}
.capture-assistant :deep(.capture-hint) {
  font-size: 11px;
}
.capture-assistant :deep(.capture-results) {
  max-height: 280px;
}
.capture-assistant :deep(.capture-results table) {
  min-width: 0;
  table-layout: fixed;
}
.capture-assistant :deep(.capture-results th),
.capture-assistant :deep(.capture-results td) {
  padding: 6px;
  overflow-wrap: anywhere;
}
.capture-assistant :deep(.result-content) {
  flex-direction: column;
  gap: 3px;
}
.capture-assistant :deep(.result-project) {
  min-width: 0;
  width: 25%;
}
.capture-assistant :deep(.result-state) {
  width: 64px;
}
.assistant-welcome {
  padding: 38px 2px 20px;
  color: var(--muted);
}
.assistant-welcome > svg {
  color: var(--accent);
}
.assistant-welcome h2 {
  font-size: 21px;
  margin: 14px 0 10px;
  color: var(--text);
}
.assistant-welcome p {
  font-size: 14px;
  line-height: 1.8;
}
.assistant-welcome > div {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  margin-top: 22px;
}
.assistant-welcome button {
  background: var(--surface-subtle);
  border-color: var(--border);
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 400;
}
.assistant-answer-links {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
}
.assistant-answer-links li {
  border-bottom: 1px solid var(--border);
}
.assistant-answer-links a {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 0;
  text-decoration: none;
}
.assistant-answer-links strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
}
.assistant-answer-links span {
  font-size: 11px;
  color: var(--muted);
}
.assistant-session-notice {
  flex: none;
  font-size: 11px;
  padding: 8px 14px;
  background: var(--surface-subtle);
  color: var(--muted);
  margin: 0;
}
.assistant-processing {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-size: 11px;
  margin: 8px 0;
}
.assistant-undo {
  margin-top: 8px;
  font-size: 11px;
}
@media (max-width: 760px) {
  .capture-assistant .capture-submit-actions {
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
  }
  .capture-assistant form.capture-composer-form {
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }
  .capture-assistant :deep(.capture-label textarea) {
    font-size: 16px;
    min-height: 78px;
  }
  .capture-assistant .capture-submit-actions > button {
    min-height: 44px;
    width: auto;
  }
  .capture-assistant .capture-keyboard-hint {
    display: none;
  }
}

.assistant-inline-review {
  flex: 0 1 auto;
  max-height: 55dvh;
  overflow: auto;
  border-top: 1px solid var(--border);
}
.capture-assistant .capture-back {
  display: none;
}
.capture-assistant :deep(.intake-embedded) {
  border: 0;
  border-radius: 0;
  margin: 0;
  padding: 12px 14px;
}
.capture-assistant :deep(.intake-review-header) {
  gap: 8px;
}
.capture-assistant :deep(.intake-confirm) {
  padding: 10px 0;
}
</style>
