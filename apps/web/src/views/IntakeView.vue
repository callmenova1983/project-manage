<script setup lang="ts">
import { activeStages, catalogs } from "../composables/catalogs";
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import {
  PhUploadSimple,
  PhX,
  PhArrowRight,
  PhCheckCircle,
  PhArrowCounterClockwise,
} from "@phosphor-icons/vue";
import {
  intakeCandidates,
  intakeFields,
  detectColumns,
  parseDelimited,
  intakeInput,
  planIntake,
  normalizeName,
  type IntakeCandidate,
  type IntakeSource,
  type IntakeField,
  type IntakeBatch,
} from "../../../../packages/domain/intake";
import { statuses, projectInput } from "../../../../packages/domain/types";
import { stageLabels, statusLabels } from "../locales/en";
import { t, formatDate, formatNumber } from "../locales";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { readIntakeFile } from "../services/intake-files";
import { useUnsaved } from "../composables/unsaved";
import { useIntakeDraft } from "../composables/intake-draft";
import { intakeDraftKey } from "../services/intake-drafts";
const props = defineProps<{ embedded?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null);
const store = useWorkspace();
const step = ref<"source" | "review" | "done">("source"),
  text = ref(""),
  sources = ref<IntakeSource[]>([]),
  sheetIndex = ref(0),
  mapping = ref<IntakeField[]>([]),
  hasHeader = ref(true),
  candidates = ref<IntakeCandidate[]>([]),
  reading = ref(false),
  error = ref(""),
  confirmed = ref(false),
  history = ref<IntakeBatch[]>([]),
  result = ref<IntakeBatch | null>(null),
  undoId = ref("");
let controller: AbortController | undefined;
const dirty = computed(
  () => step.value !== "done" && !!(text.value || sources.value.length),
);
const askDiscard = useUnsaved(dirty, () => {
  draft.flush();
  return t(
    draft.status.value === "saved"
      ? "Leave intake? Your unsubmitted draft will stay in this tab."
      : "Discard unsaved changes?",
  );
});
const source = computed<IntakeSource>(
  () =>
    sources.value[sheetIndex.value] ?? {
      kind: "text",
      name: "Pasted text",
      sheet: "",
      text: text.value,
    },
);
const draft = useIntakeDraft(intakeDraftKey(store.mode, store.user!), {
  step,
  text,
  sources,
  sheetIndex,
  source,
  mapping,
  hasHeader,
  candidates,
  confirmed,
  dirty,
});
const selected = computed(() => candidates.value.filter((c) => c.selected));
async function restoreDraft() {
  draft.restore();
  await nextTick();
  document
    .querySelector<HTMLElement>(
      ".intake-candidate input, .intake-source textarea, .intake-source select",
    )
    ?.focus();
}
const newProjectCount = computed(
  () =>
    new Set(
      selected.value
        .filter((c) => !c.targetProjectId && !c.project.intakeInbox)
        .map((c) => normalizeName(c.project.name)),
    ).size,
);
const taskCount = computed(() => selected.value.filter((c) => c.task).length);
const fieldLabels: Record<IntakeField, string> = {
  ignore: "Ignore column",
  project: "Project name",
  client: "Client",
  owner: "Project owner",
  stage: "Stage",
  task: "Task title",
  assignee: "Assignee",
  dueDate: "Due date",
  status: "Task status",
  description: "Description",
};
const example =
  "项目：星河客户门户；客户：星河科技；负责人：林晓；阶段：实施中；任务：确认首页文案；截止日期：2026-10-20\n项目：星河客户门户；客户：星河科技；负责人：林晓；阶段：实施中；任务：整理验收清单";
function resetMapping() {
  mapping.value = detectColumns(source.value.rows?.[0] ?? []);
}
async function loadFile(file?: File) {
  if (!file || reading.value) return;
  if (dirty.value && !askDiscard()) return;
  error.value = "";
  controller = new AbortController();
  reading.value = true;
  try {
    const parsed = await readIntakeFile(file, controller.signal);
    sources.value = parsed;
    sheetIndex.value = 0;
    text.value = "";
    step.value = "source";
    resetMapping();
  } catch (e) {
    if ((e as Error).name !== "AbortError") error.value = (e as Error).message;
  } finally {
    reading.value = false;
  }
}
function drop(event: DragEvent) {
  void loadFile(event.dataTransfer?.files[0]);
}
function useExample() {
  if (dirty.value && !askDiscard()) return;
  sources.value = [];
  text.value = example;
  error.value = "";
}
async function preview() {
  error.value = "";
  try {
    if (
      !sources.value.length &&
      /\t|,/.test(text.value.split(/\r?\n/)[0] ?? "")
    ) {
      const rows = parseDelimited(text.value);
      const columns = detectColumns(rows[0] ?? []);
      if (columns.filter((x) => x !== "ignore").length >= 2) {
        sources.value = [
          {
            kind: "csv",
            name: "Pasted table",
            sheet: "",
            text: text.value,
            rows,
          },
        ];
        resetMapping();
      }
    }
    if (
      source.value.rows &&
      !mapping.value.includes("project") &&
      !mapping.value.includes("task")
    )
      throw new Error("Map a project name or task column before continuing");
    candidates.value = intakeCandidates(
      source.value,
      store.data.projects,
      source.value.rows ? mapping.value : undefined,
      hasHeader.value,
      catalogs.value,
    );
    if (!candidates.value.length)
      throw new Error("No candidates found. Add text or choose another sheet.");
    confirmed.value = false;
    step.value = "review";
    const problems = candidates.value.some(
      (c) => issueWarnings(c).length || duplicate(c),
    );
    if (problems) {
      error.value = t("Fix the details below before creating");
      return;
    }
    await apply();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function targetChanged(c: IntakeCandidate) {
  const p = store.data.projects.find((p) => p.id === c.targetProjectId);
  if (p) c.project = projectInput.strip().parse(p);
  c.targetProjectVersion = p?.version ?? null;
  confirmed.value = false;
}
function duplicate(c: IntakeCandidate) {
  return !!(
    (!c.targetProjectId &&
      store.data.projects.some((p) =>
        [p.name, ...p.aliases].some(
          (n) => normalizeName(n) === normalizeName(c.project.name),
        ),
      )) ||
    (c.task &&
      store.data.tasks.some(
        (task) =>
          task.projectId === c.targetProjectId &&
          normalizeName(task.title) === normalizeName(c.task!.title),
      )) ||
    (c.task &&
      selected.value.some(
        (other) =>
          other !== c &&
          other.project.name === c.project.name &&
          other.task?.title === c.task!.title,
      ))
  );
}
function issueWarnings(c: IntakeCandidate) {
  return c.warnings.filter(
    (warning) => warning !== "Rule-assisted draft. Review the project details.",
  );
}
async function apply() {
  if (store.busy) return;
  error.value = "";
  try {
    const input = intakeInput.parse({
      source: source.value,
      rows: selected.value.map((c) => ({
        sourceRow: c.sourceRow,
        sourcePart: c.sourcePart,
        targetProjectId: c.targetProjectId,
        targetProjectVersion: c.targetProjectVersion,
        project: c.project,
        task: c.task,
        duplicateConfirmed: c.duplicateConfirmed,
      })),
      confirmed: true,
    });
    planIntake(input, store.data, store.user!.name, () => crypto.randomUUID());
    result.value = await store.operation(
      () => api.applyIntake(input),
      "Intake created",
    );
    step.value = "done";
    text.value = "";
    sources.value = [];
    draft.flush();
    await loadHistory();
  } catch (e) {
    step.value = "review";
    error.value = (e as Error).message.startsWith("[")
      ? t("Check required project and task fields")
      : (e as Error).message;
  }
}
async function loadHistory() {
  try {
    history.value = await api.intakeHistory();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function undo(batch: IntakeBatch) {
  error.value = "";
  try {
    await store.operation(() => api.undoIntake(batch.id), "Intake undone");
    undoId.value = "";
    if (result.value?.id === batch.id)
      result.value = { ...batch, state: "undone" };
    await loadHistory();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function startAgain() {
  if (!askDiscard()) return;
  step.value = "source";
  sources.value = [];
  text.value = "";
  candidates.value = [];
  result.value = null;
  error.value = "";
  draft.flush();
}
function closePanel() {
  if (store.busy || reading.value) return;
  draft.flush();
  if (dirty.value && draft.status.value !== "saved" && !askDiscard()) return;
  emit("close");
}
onMounted(async () => {
  void loadHistory();
  if (props.embedded) {
    await nextTick();
    panel.value?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }
});
onBeforeUnmount(() => controller?.abort());
</script>
<template>
  <section
    ref="panel"
    class="intake-page"
    :class="{ 'intake-embedded': embedded }"
    :aria-label="t('Quick intake')"
  >
    <div class="intake-heading">
      <div class="intake-heading-title">
        <h2>{{ t("Quick intake") }}</h2>
        <span class="muted">{{ t("Paste text or upload a file") }}</span>
      </div>
      <button
        v-if="embedded"
        type="button"
        class="icon-button"
        :aria-label="t('Close quick intake')"
        :disabled="store.busy || reading"
        @click="closePanel"
      >
        <PhX :size="18" />
      </button>
      <RouterLink v-else class="button" to="/projects">{{
        t("Projects")
      }}</RouterLink>
    </div>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <section
      v-if="draft.pending.value"
      class="panel intake-source"
      aria-labelledby="draft-recovery-title"
    >
      <h2 id="draft-recovery-title">{{ t("Unsubmitted intake draft") }}</h2>
      <p>
        {{
          t(
            "This draft is kept in this browser tab for up to 24 hours. It has not been submitted to the workspace.",
          )
        }}
      </p>
      <template v-if="draft.recovery.value.kind === 'ready'">
        <p>
          {{ t("Draft saved") }} ·
          {{
            formatDate(new Date(draft.recovery.value.draft.savedAt), {
              dateStyle: "medium",
              timeStyle: "short",
            })
          }}
        </p>
        <p class="muted">
          {{
            t(
              "Restore your source and edits, then review and confirm again. Only the selected worksheet is kept; reopen the file for other sheets.",
            )
          }}
        </p>
      </template>
      <p v-else class="error-box" role="alert">
        {{ t("This draft could not be read. Discard it to start again.") }}
      </p>
      <div class="form-actions">
        <button @click="draft.discard()">{{ t("Discard draft") }}</button>
        <button
          v-if="draft.recovery.value.kind === 'ready'"
          class="primary"
          @click="restoreDraft"
        >
          {{ t("Restore draft") }}
        </button>
      </div>
    </section>
    <p
      v-if="draft.status.value === 'unavailable'"
      class="error-box"
      role="alert"
    >
      {{
        t(
          "Temporary draft storage is unavailable or full. Keep this page open and copy your source before leaving; newer edits may not be recoverable.",
        )
      }}
    </p>
    <p v-else-if="draft.status.value === 'saved'" class="muted" role="status">
      {{ t("Draft saved") }}
    </p>
    <p v-else-if="draft.status.value === 'expired'" class="muted" role="status">
      {{ t("The previous temporary draft expired after 24 hours.") }}
    </p>
    <div
      v-if="!draft.pending.value && step === 'source'"
      class="panel intake-source"
      @dragover.prevent
      @drop.prevent="drop"
    >
      <label v-if="!sources.length" class="intake-text-label">
        <span class="sr-only">{{ t("Notes or pasted table") }}</span>
        <textarea
          v-model="text"
          rows="4"
          maxlength="200000"
          :placeholder="
            t(
              'Project: Customer portal; Client: Acme; Owner: Alex; Task: Review the brief; Due: 2026-10-20',
            )
          "
        />
      </label>
      <div class="intake-source-toolbar">
        <div class="intake-source-tools">
          <label class="intake-upload button">
            <PhUploadSimple :size="17" /><span>{{ t("Upload file") }}</span>
            <input
              type="file"
              :aria-label="t('Upload file')"
              accept=".txt,.csv,.tsv,.xlsx"
              :disabled="reading"
              @change="
                loadFile(($event.target as HTMLInputElement).files?.[0]);
                ($event.target as HTMLInputElement).value = '';
              "
            />
          </label>
          <button type="button" class="text-button" @click="useExample">
            {{ t("Try a sample") }}
          </button>
          <span class="intake-file-hint muted"
            >{{ t("Or drop a file") }} · TXT / CSV / XLSX</span
          >
        </div>
        <button
          v-if="!sources.length"
          class="primary"
          :disabled="store.busy || reading || !text.trim()"
          @click="preview"
        >
          {{ t("Create items") }}<PhArrowRight :size="16" />
        </button>
      </div>
      <details class="intake-help">
        <summary>{{ t("Intake help") }}</summary>
        <p>
          {{
            t(
              "Use project/client/owner/task labels for best results. Unclear details stay open for review. You can use your keyboard’s dictation.",
            )
          }}
        </p>
        <p>{{ t("TXT, CSV, TSV, XLSX · 2 MB · 200 rows per sheet") }}</p>
        <p>
          {{ t("Rule-assisted · no AI connection") }} ·
          {{ t("Files are read in your browser. Click Create to save.") }}
        </p>
      </details>
      <div v-if="reading" role="status">
        {{ t("Reading file…") }}
        <button class="text-button" @click="controller?.abort()">
          {{ t("Cancel") }}
        </button>
      </div>
      <template v-if="sources.length">
        <div class="section-heading">
          <strong>{{ source.name }}</strong
          ><button
            class="text-button"
            @click="
              sources = [];
              text = '';
            "
          >
            {{ t("Remove file") }}
          </button>
        </div>
        <label v-if="sources.length > 1"
          >{{ t("Worksheet")
          }}<select v-model="sheetIndex" @change="resetMapping">
            <option
              v-for="(sheet, index) in sources"
              :key="index"
              :value="index"
            >
              {{ sheet.sheet }}
            </option>
          </select></label
        >
        <template v-if="source.rows"
          ><label class="checkbox"
            ><input v-model="hasHeader" type="checkbox" />{{
              t("First row contains column names")
            }}</label
          >
          <div class="intake-mapping">
            <label v-for="(cell, index) in source.rows[0]" :key="index"
              >{{ cell || t("Column {number}", { number: index + 1 })
              }}<select v-model="mapping[index]">
                <option
                  v-for="field in intakeFields"
                  :key="field"
                  :value="field"
                >
                  {{ t(fieldLabels[field]) }}
                </option>
              </select></label
            >
          </div>
          <p class="muted">
            {{
              t(
                "Only mapped columns become fields. All source cells remain visible in review. XLSX formulas are not executed; stored values are used.",
              )
            }}
          </p></template
        >
        <pre v-else class="intake-original">{{ source.text }}</pre>
      </template>
      <div v-if="sources.length" class="form-actions">
        <button
          class="primary"
          :disabled="store.busy || reading || (!text.trim() && !sources.length)"
          @click="preview"
        >
          {{ t("Create items") }}<PhArrowRight :size="16" />
        </button>
      </div>
    </div>
    <form
      v-else-if="!draft.pending.value && step === 'review'"
      @submit.prevent="apply"
    >
      <div class="intake-review-header">
        <div>
          <h2>{{ t("Check these details") }}</h2>
        </div>
        <button
          type="button"
          class="button"
          @click="
            step = 'source';
            confirmed = false;
          "
        >
          {{ t("Back to source") }}
        </button>
      </div>
      <article
        v-for="c in candidates"
        :key="c.id"
        class="panel intake-candidate"
        :class="{ excluded: !c.selected }"
      >
        <div class="section-heading">
          <label class="checkbox"
            ><input
              v-model="c.selected"
              type="checkbox"
              @change="confirmed = false"
            />{{ t("Row {number}", { number: c.sourceRow }) }} ·
            {{ c.project.name || t("Unnamed project") }}</label
          ><span class="muted">{{
            c.task ? t("Project + task") : t("Project only")
          }}</span>
        </div>
        <details open>
          <summary>{{ t("Review details") }}</summary>
          <div class="intake-fields">
            <label
              >{{ t("Target project")
              }}<select
                v-model="c.targetProjectId"
                :disabled="!c.selected"
                @change="targetChanged(c)"
              >
                <option value="">
                  {{
                    t(
                      c.project.intakeInbox
                        ? "Save in Intake inbox"
                        : "Create a new project",
                    )
                  }}
                </option>
                <option
                  v-for="p in store.data.projects"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }} · {{ p.client }}
                </option>
              </select></label
            >
            <label
              >{{ t("Project name")
              }}<input
                v-model="c.project.name"
                :disabled="!c.selected || !!c.targetProjectId"
                required
                maxlength="120"
            /></label>
            <label
              >{{ t("Client")
              }}<input
                v-model="c.project.client"
                :disabled="!c.selected || !!c.targetProjectId"
                maxlength="120"
            /></label>
            <label
              >{{ t("Project owner")
              }}<input
                v-model="c.project.owner"
                :disabled="!c.selected || !!c.targetProjectId"
                maxlength="80"
            /></label>
            <label
              >{{ t("Stage")
              }}<select
                v-model="c.project.stage"
                :disabled="!c.selected || !!c.targetProjectId"
              >
                <option value="unclassified">
                  {{ stageLabels.unclassified }}
                </option>
                <option
                  v-for="stage in activeStages"
                  :key="stage.id"
                  :value="stage.id"
                >
                  {{ stageLabels[stage.id] }}
                </option>
              </select></label
            >
            <label
              >{{ t("Description")
              }}<input
                v-model="c.project.description"
                :disabled="!c.selected || !!c.targetProjectId"
                maxlength="4000"
            /></label>
            <template v-if="c.task"
              ><label
                >{{ t("Task title")
                }}<input
                  v-model="c.task.title"
                  :disabled="!c.selected"
                  required
                  maxlength="240" /></label
              ><label
                >{{ t("Assignee")
                }}<input
                  v-model="c.task.assignee"
                  :disabled="!c.selected"
                  maxlength="80" /></label
              ><label
                >{{ t("Due date")
                }}<input
                  :value="c.task.dueDate ?? ''"
                  type="date"
                  :disabled="!c.selected"
                  @input="
                    c.task.dueDate =
                      ($event.target as HTMLInputElement).value || null
                  " /></label
              ><label
                >{{ t("Task status")
                }}<select v-model="c.task.status" :disabled="!c.selected">
                  <option
                    v-for="status in statuses"
                    :key="status"
                    :value="status"
                  >
                    {{ statusLabels[status] }}
                  </option>
                </select></label
              ></template
            >
          </div>
          <ul v-if="issueWarnings(c).length" class="intake-warnings">
            <li v-for="warning in issueWarnings(c)" :key="warning">
              {{ t(warning) }}
            </li>
          </ul>
          <label v-if="duplicate(c) && c.selected" class="checkbox"
            ><input v-model="c.duplicateConfirmed" type="checkbox" />{{
              t("Allow a new project or task with a matching name")
            }}</label
          >
          <details class="intake-source-proof">
            <summary>
              {{ t("Original source") }} · {{ source.name }}
              {{ source.sheet }} ·
              {{ t("Row {number}", { number: c.sourceRow }) }}
            </summary>
            <pre>{{ c.sourceText }}</pre>
          </details>
        </details>
      </article>
      <div class="panel intake-confirm">
        <p>
          {{
            t("{projects} new projects · {tasks} new tasks", {
              projects: newProjectCount,
              tasks: taskCount,
            })
          }}
        </p>
        <div class="form-actions">
          <button
            type="button"
            class="button"
            :disabled="store.busy"
            @click="startAgain"
          >
            {{ t("Cancel") }}</button
          ><button
            class="primary"
            type="submit"
            :disabled="!selected.length || store.busy"
          >
            {{ store.busy ? t("Saving…") : t("Create items") }}
          </button>
        </div>
      </div>
    </form>
    <div v-else-if="result" class="panel intake-success" role="status">
      <PhCheckCircle :size="36" />
      <h2>
        {{
          t(
            result.state === "undone"
              ? "Intake undone"
              : "Created and recorded",
          )
        }}
      </h2>
      <p>
        {{
          t("{projects} new projects · {tasks} new tasks", {
            projects: result.projects.filter((p) => !p.intakeInbox).length,
            tasks: result.tasks.length,
          })
        }}
      </p>
      <div class="form-actions">
        <button v-if="embedded" class="button" @click="closePanel">
          {{ t("View projects") }}</button
        ><RouterLink v-else class="button" to="/projects">{{
          t("View projects")
        }}</RouterLink
        ><button class="primary" @click="startAgain">
          {{ t("Add more work") }}
        </button>
      </div>
    </div>
    <details v-if="history.length" class="intake-history">
      <summary>{{ t("Recent intakes") }} · {{ history.length }}</summary>
      <article v-for="batch in history" :key="batch.id" class="panel">
        <div class="section-heading">
          <div>
            <strong>{{ batch.source.name }}</strong>
            <p class="muted">
              {{
                formatDate(batch.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              }}
              · {{ batch.actor }} · {{ formatNumber(batch.projects.length) }}
              {{ t("Projects") }} / {{ formatNumber(batch.tasks.length) }}
              {{ t("Tasks") }}
            </p>
          </div>
          <button
            v-if="batch.state === 'applied'"
            class="button"
            :disabled="store.busy"
            @click="undoId = undoId === batch.id ? '' : batch.id"
          >
            <PhArrowCounterClockwise :size="16" />{{ t("Undo intake") }}</button
          ><span v-else class="muted">{{ t("Undone") }}</span>
        </div>
        <div v-if="undoId === batch.id" class="intake-undo">
          <p>
            {{
              t(
                "Remove only items created by this intake? Undo is blocked if they have changed or gained dependent tasks.",
              )
            }}
          </p>
          <button class="button" :disabled="store.busy" @click="undoId = ''">
            {{ t("Cancel") }}</button
          ><button class="danger" :disabled="store.busy" @click="undo(batch)">
            {{ t("Confirm undo") }}
          </button>
        </div>
      </article>
    </details>
  </section>
</template>
<style scoped>
.intake-page {
  max-width: 1200px;
  margin: auto;
  padding: 20px;
}
.intake-source,
.intake-candidate,
.intake-confirm,
.intake-success,
.intake-history .panel {
  padding: 20px;
}
.intake-source textarea {
  width: 100%;
  resize: vertical;
  min-height: 110px;
  max-height: 300px;
}
.intake-source .muted,
.intake-candidate .muted,
.intake-history .muted {
  font-size: 12px;
  line-height: 1.6;
}
.intake-mapping,
.intake-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin: 16px 0;
}
.intake-mapping label,
.intake-fields label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.intake-review-header {
  display: flex;
  justify-content: space-between;
  gap: 15px;
  align-items: center;
  margin: 20px 0;
}
.intake-candidate {
  margin: 10px 0;
}
.intake-candidate.excluded {
  opacity: 0.65;
}
.intake-candidate summary {
  cursor: pointer;
  color: var(--text-secondary);
  padding: 6px 0;
}
.intake-warnings {
  color: var(--status-blocked);
  font-size: 13px;
  padding-left: 20px;
}
.intake-source-proof {
  margin-top: 12px;
}
.intake-source-proof pre,
.intake-original {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
  background: var(--surface-subtle);
  padding: 12px;
  font-size: 12px;
}
.intake-confirm {
  position: static;
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-popover);
  margin-top: 20px;
  z-index: 2;
}
.intake-confirm h2 {
  margin: 0;
}
.intake-confirm p {
  margin: 7px 0;
}
.intake-confirm .form-actions {
  margin-top: 12px;
}
.intake-success {
  text-align: center;
}
.intake-success > svg {
  color: var(--status-done);
}
.intake-success .form-actions {
  justify-content: center;
}
.intake-history {
  margin-top: 32px;
}
.intake-history .panel {
  margin: 8px 0;
}
.intake-undo {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.intake-undo button {
  margin-right: 8px;
}
.checkbox {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.checkbox input {
  width: auto;
  flex-shrink: 0;
}
@media (max-width: 760px) {
  .intake-fields,
  .intake-mapping {
    grid-template-columns: 1fr;
  }
  .intake-page {
    padding: 16px 12px;
  }
  .intake-source,
  .intake-candidate,
  .intake-confirm,
  .intake-history .panel {
    padding: 14px;
  }
  .intake-review-header,
  .intake-history .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .intake-confirm {
    position: static;
  }
  .intake-candidate .section-heading {
    align-items: flex-start;
    gap: 8px;
  }
  .intake-candidate .section-heading > span {
    font-size: 11px;
  }
}

.intake-embedded {
  max-width: none;
  margin: 0 0 20px;
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.intake-heading,
.intake-heading-title,
.intake-source-toolbar,
.intake-source-tools {
  display: flex;
  align-items: center;
  gap: 12px;
}
.intake-heading,
.intake-source-toolbar {
  justify-content: space-between;
}
.intake-heading {
  margin-bottom: 14px;
}
.intake-heading h2 {
  margin: 0;
  font-size: 17px;
}
.intake-heading-title > span {
  font-size: 12px;
}
.intake-source {
  border: 0;
  box-shadow: none;
  padding: 0;
  margin: 0;
  background: transparent;
}
.intake-source textarea {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.6;
}
.intake-text-label {
  display: block;
}
.intake-source-toolbar {
  margin-top: 10px;
  flex-wrap: wrap;
}
.intake-source-tools {
  flex-wrap: wrap;
  gap: 10px;
}
.intake-upload {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  position: relative;
  cursor: pointer;
  overflow: hidden;
}
.intake-upload input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.intake-upload:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.intake-file-hint {
  font-size: 11px;
}
.intake-help {
  margin-top: 12px;
  font-size: 12px;
  color: var(--muted);
}
.intake-help summary,
.intake-history > summary {
  cursor: pointer;
}
.intake-history {
  margin-top: 16px;
  font-size: 13px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 760px) {
  .intake-heading-title {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
  .intake-source-toolbar {
    gap: 12px;
  }
  .intake-source-toolbar > .primary {
    margin-left: auto;
  }
  .intake-file-hint {
    display: none;
  }
  .intake-embedded .intake-source {
    padding: 0;
  }
}
</style>
