<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  PhNotePencil,
  PhArrowRight,
  PhCheckCircle,
  PhWarningCircle,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { api, type ReviewedSuggestion } from "../services/api";
import {
  type Proposal,
  type AiCapabilities,
  statuses,
} from "../../../../packages/domain/types";
import { statusLabels } from "../locales/en";
import { useUnsaved } from "../composables/unsaved";
const store = useWorkspace();
const engine = ref<"rules" | "qwen">("rules");
const externalConsent = ref(false);
const capabilities = ref<AiCapabilities | null>(null);
const capabilityError = ref("");
async function loadCapabilities() {
  try {
    capabilities.value = await api.aiCapabilities();
    capabilityError.value = "";
  } catch {
    capabilityError.value =
      "Could not check Qwen availability. Rule-assisted review is still available.";
  }
}
onMounted(loadCapabilities);
const source = ref(""),
  proposal = ref<Proposal | null>(null),
  error = ref(""),
  working = ref(false),
  versions = ref<Record<string, number>>({});
watch([source, engine], () => {
  externalConsent.value = false;
});
const qwenReview = computed(() =>
  proposal.value ? !!proposal.value.generator : engine.value === "qwen",
);
const dirty = computed(
  () => !!source.value && proposal.value?.status !== "applied",
);
const discard = useUnsaved(dirty);
const selected = computed(
  () => proposal.value?.suggestions.filter((s) => s.confirmed) ?? [],
);
const combinedUpdates = computed(() =>
  store.data.projects.flatMap((p) => {
    const updates = selected.value.filter(
      (s) => s.action === "update" && s.selectedProjectId === p.id,
    );
    return updates.length > 1
      ? [
          {
            id: p.id,
            name: p.name,
            text: updates.map((s) => s.title).join("\n"),
          },
        ]
      : [];
  }),
);
const valid = computed(
  () =>
    selected.value.length > 0 &&
    selected.value.every(
      (s) =>
        s.selectedProjectId &&
        s.title.trim() &&
        (s.action !== "update" || s.overwriteConfirmed),
    ),
);
async function review() {
  working.value = true;
  error.value = "";
  try {
    proposal.value =
      engine.value === "qwen"
        ? await api.proposeQwen(source.value, externalConsent.value)
        : await api.propose(source.value);
    versions.value = Object.fromEntries(
      store.data.projects.map((p) => [p.id, p.version]),
    );
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    working.value = false;
    if (engine.value === "qwen") void loadCapabilities();
  }
}
async function apply() {
  error.value = "";
  const suggestions: ReviewedSuggestion[] = selected.value.map((s) => ({
    id: s.id,
    selectedProjectId: s.selectedProjectId,
    title: s.title,
    action: s.action,
    status: s.status,
    confirmed: s.confirmed,
    overwriteConfirmed: s.overwriteConfirmed,
    projectVersion: versions.value[s.selectedProjectId],
  }));
  try {
    const result = await store.operation(
      () => api.applyProposal(proposal.value!, suggestions),
      "Reviewed suggestions applied",
    );
    proposal.value = result;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function reset() {
  if (discard()) {
    source.value = "";
    proposal.value = null;
    error.value = "";
  }
}
</script>
<template>
  <section class="page meetings-page">
    <div class="page-heading">
      <div>
        <div class="eyebrow">FROM CONVERSATION TO ACTION</div>
        <h1>Meeting notes</h1>
        <p class="page-subtitle">
          Review the source. Choose the project. Confirm every change.
        </p>
      </div>
      <PhNotePencil :size="28" class="muted" />
    </div>
    <div class="notice">
      <PhWarningCircle :size="20" />
      <div>
        <strong>{{
          qwenReview
            ? proposal?.generator
              ? "Qwen-generated suggestions · human review required"
              : "Qwen configured · connection not yet verified"
            : "Rule-assisted review · AI is not connected"
        }}</strong>
        <p v-if="qwenReview">
          {{ proposal?.generator?.model ?? capabilities?.model }} ·
          {{ proposal?.generator?.region ?? capabilities?.region }}. Suggestions
          may be wrong. Verify every source, project and change. Generating
          suggestions does not update projects or tasks.
        </p>
        <p v-else>
          Project names and aliases are matched literally. These suggestions are
          not model-generated. No changes are saved to projects until you
          confirm them.
        </p>
      </div>
    </div>
    <div v-if="proposal?.status === 'applied'" class="success-panel">
      <PhCheckCircle :size="36" />
      <h2>Reviewed and recorded</h2>
      <p>
        Your changes are saved with their original source and review history.
      </p>
      <div class="heading-actions">
        <RouterLink to="/activity" class="button">View activity</RouterLink
        ><button
          class="primary"
          @click="
            source = '';
            proposal = null;
          "
        >
          Review more notes
        </button>
      </div>
    </div>
    <template v-else
      ><section v-if="!proposal" class="panel">
        <label v-if="capabilities?.provider === 'qwen'">
          Review method
          <select v-model="engine" :disabled="working">
            <option value="rules">
              Rule-assisted · no external processing
            </option>
            <option value="qwen" :disabled="!capabilities.enabled">
              Qwen · {{ capabilities.remainingAttempts }} attempts remaining
            </option>
          </select>
        </label>
        <p v-if="capabilityError" role="status" class="muted">
          {{ capabilityError }}
        </p>
        <p
          v-if="capabilities?.provider === 'qwen' && !capabilities.enabled"
          class="muted"
        >
          Qwen budget is exhausted or expired. Ask the server administrator to
          review it.
        </p>
        <label class="source-label"
          >Meeting notes<textarea
            v-model="source"
            :disabled="working"
            rows="10"
            maxlength="20000"
            placeholder="Paste one action or update per line. Include a project name or alias.&#10;&#10;Atlas: confirm acceptance checklist&#10;Meridian: design review completed&#10;Schedule a follow-up with the delivery team"
          ></textarea>
        </label>
        <label v-if="engine === 'qwen'" class="check-label">
          <input
            v-model="externalConsent"
            type="checkbox"
            :disabled="working"
          />
          I approve sending these notes and project names, IDs and aliases to
          Alibaba Cloud using the {{ capabilities?.region }} API region for this
          review. I have removed secrets and data that should not be sent.
        </label>
        <div class="form-actions">
          <span class="muted"
            >Original wording is retained with line numbers.</span
          ><button
            :disabled="
              !source.trim() ||
              working ||
              (engine === 'qwen' &&
                (!externalConsent || !capabilities?.enabled))
            "
            class="primary"
            @click="review"
          >
            {{ working ? "Preparing…" : "Review suggestions"
            }}<PhArrowRight :size="16" />
          </button>
        </div>
      </section>
      <template v-else
        ><div class="section-heading">
          <h2>
            {{ proposal.suggestions.length }} suggestions
            <span class="muted">· {{ selected.length }} selected</span>
          </h2>
          <button @click="reset">Cancel review</button>
        </div>
        <details class="original-source">
          <summary>Original source · version 1</summary>
          <pre>{{ proposal.source }}</pre>
        </details>
        <p v-if="!proposal.suggestions.length" class="notice" role="status">
          No supported actions or updates were found. Cancel review to edit the
          notes or choose rule-assisted review.
        </p>
        <article
          v-for="(s, index) in proposal.suggestions"
          :key="s.id"
          class="suggestion-card"
        >
          <div class="suggestion-source">
            <span class="eyebrow"
              >SOURCE LINE {{ s.sourceLine }} · VERSION 1</span
            >
            <blockquote>{{ s.sourceText }}</blockquote>
          </div>
          <div class="form-grid">
            <label
              >Project<select
                v-model="s.selectedProjectId"
                :aria-label="`Project for suggestion ${index + 1}`"
                @change="s.overwriteConfirmed = false"
              >
                <option value="">Choose a project</option>
                <option
                  v-for="p in store.data.projects"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }}
                </option></select
              ><small :class="s.candidates.length !== 1 ? 'amber' : 'muted'">{{
                s.candidates.length === 1
                  ? proposal.generator
                    ? "Model candidate — please verify"
                    : "Name / alias match — please verify"
                  : s.candidates.length > 1
                    ? "Ambiguous: " +
                      s.candidates
                        .map(
                          (c) =>
                            store.data.projects.find(
                              (p) => p.id === c.projectId,
                            )?.name,
                        )
                        .join(", ")
                    : "No match found. Select the correct project."
              }}</small
              ><small v-if="proposal.generator" class="muted">{{
                s.candidates.map((c) => c.reason).join(" · ")
              }}</small></label
            ><label
              >Proposed change<select
                v-model="s.action"
                :aria-label="`Action for suggestion ${index + 1}`"
                @change="s.overwriteConfirmed = false"
              >
                <option value="task">Create task</option>
                <option value="update">Replace latest project update</option>
              </select></label
            ><label class="full"
              >Reviewed text<input
                v-model="s.title"
                maxlength="240"
                :aria-label="`Text for suggestion ${index + 1}`" /></label
            ><label v-if="s.action === 'task'"
              >Task status<select v-model="s.status">
                <option v-for="st in statuses" :key="st" :value="st">
                  {{ statusLabels[st] }}
                </option>
              </select></label
            >
          </div>
          <div v-if="s.action === 'update'" class="overwrite-review">
            <strong>Current latest update</strong>
            <p>
              {{
                store.data.projects.find((p) => p.id === s.selectedProjectId)
                  ?.latestUpdate ||
                "Choose a project to review its current update."
              }}
            </p>
            <label class="check-label"
              ><input
                v-model="s.overwriteConfirmed"
                type="checkbox"
                :disabled="!s.selectedProjectId"
              />I reviewed and confirm replacing this update</label
            >
          </div>
          <label class="check-label confirm-suggestion"
            ><input
              v-model="s.confirmed"
              type="checkbox"
              :aria-label="`Confirm suggestion ${index + 1}`"
            />I confirm the project and this proposed change</label
          >
        </article>
        <section
          v-for="update in combinedUpdates"
          :key="update.id"
          class="panel"
        >
          <h3>Combined update · {{ update.name }}</h3>
          <p class="muted">
            The confirmed lines replace this project's latest update together,
            in source order.
          </p>
          <pre class="working-notes">{{ update.text }}</pre>
        </section>
        <div class="review-footer">
          <p class="muted">Unselected items will not change your workspace.</p>
          <button
            class="primary"
            :disabled="!valid || store.busy"
            @click="apply"
          >
            {{
              store.busy
                ? "Applying…"
                : `Apply ${selected.length} confirmed changes`
            }}
          </button>
        </div></template
      ></template
    >
    <p v-if="error" class="error-box" role="alert">{{ error }}</p>
  </section>
</template>
