<script setup lang="ts">
import { t, formatNumber } from "../locales";
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
    capabilityError.value = t(
      "Could not check Qwen availability. Rule-assisted review is still available.",
    );
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
      t("Reviewed suggestions applied"),
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
        <div class="eyebrow">{{ t("FROM CONVERSATION TO ACTION") }}</div>
        <h1>{{ t("Meeting notes") }}</h1>
        <p class="page-subtitle">
          {{
            t("Review the source. Choose the project. Confirm every change.")
          }}
        </p>
      </div>
      <PhNotePencil :size="28" class="muted" />
    </div>
    <div class="notice">
      <PhWarningCircle :size="20" />
      <div>
        <strong>{{
          t(
            qwenReview
              ? proposal?.generator
                ? "Qwen-generated suggestions · human review required"
                : "Qwen configured · connection not yet verified"
              : "Rule-assisted review · AI is not connected",
          )
        }}</strong>
        <p v-if="qwenReview">
          {{ proposal?.generator?.model ?? capabilities?.model }} ·
          {{ proposal?.generator?.region ?? capabilities?.region }}.
          {{
            t(
              "Suggestions may be wrong. Verify every source, project and change. Generating suggestions does not update projects or tasks.",
            )
          }}
        </p>
        <p v-else>
          {{
            t(
              "Project names and aliases are matched literally. These suggestions are not model-generated. No changes are saved to projects until you confirm them.",
            )
          }}
        </p>
      </div>
    </div>
    <div v-if="proposal?.status === 'applied'" class="success-panel">
      <PhCheckCircle :size="36" />
      <h2>{{ t("Reviewed and recorded") }}</h2>
      <p>
        {{
          t(
            "Your changes are saved with their original source and review history.",
          )
        }}
      </p>
      <div class="heading-actions">
        <RouterLink to="/activity" class="button">{{
          t("View activity")
        }}</RouterLink
        ><button
          class="primary"
          @click="
            source = '';
            proposal = null;
          "
        >
          {{ t("Review more notes") }}
        </button>
      </div>
    </div>
    <template v-else
      ><section v-if="!proposal" class="panel">
        <label v-if="capabilities?.provider === 'qwen'">
          {{ t("Review method") }}
          <select v-model="engine" :disabled="working">
            <option value="rules">
              {{ t("Rule-assisted · no external processing") }}
            </option>
            <option value="qwen" :disabled="!capabilities.enabled">
              {{
                t("Qwen · {count} attempts remaining", {
                  count: formatNumber(capabilities.remainingAttempts),
                })
              }}
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
          {{
            t(
              "Qwen budget is exhausted or expired. Ask the server administrator to review it.",
            )
          }}
        </p>
        <label class="source-label"
          >{{ t("Meeting notes")
          }}<textarea
            v-model="source"
            :disabled="working"
            rows="10"
            maxlength="20000"
            :placeholder="
              t(
                'Paste one action or update per line. Include a project name or alias.\n\nAtlas: confirm acceptance checklist\nMeridian: design review completed\nSchedule a follow-up with the delivery team',
              )
            "
          ></textarea>
        </label>
        <label v-if="engine === 'qwen'" class="check-label">
          <input
            v-model="externalConsent"
            type="checkbox"
            :disabled="working"
          />
          {{
            t(
              "I approve sending these notes and project names, IDs and aliases to Alibaba Cloud using the {region} API region for this review. I have removed secrets and data that should not be sent.",
              { region: capabilities?.region ?? "" },
            )
          }}
        </label>
        <div class="form-actions">
          <span class="muted">{{
            t("Original wording is retained with line numbers.")
          }}</span
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
            {{ t(working ? "Preparing…" : "Review suggestions")
            }}<PhArrowRight :size="16" />
          </button>
        </div>
      </section>
      <template v-else
        ><div class="section-heading">
          <h2>
            {{
              t("{count} suggestions", {
                count: formatNumber(proposal.suggestions.length),
              })
            }}
            <span class="muted"
              >·
              {{
                t("{count} selected", { count: formatNumber(selected.length) })
              }}</span
            >
          </h2>
          <button @click="reset">{{ t("Cancel review") }}</button>
        </div>
        <details class="original-source">
          <summary>{{ t("Original source · version 1") }}</summary>
          <pre>{{ proposal.source }}</pre>
        </details>
        <p v-if="!proposal.suggestions.length" class="notice" role="status">
          {{
            t(
              "No supported actions or updates were found. Cancel review to edit the notes or choose rule-assisted review.",
            )
          }}
        </p>
        <article
          v-for="(s, index) in proposal.suggestions"
          :key="s.id"
          class="suggestion-card"
        >
          <div class="suggestion-source">
            <span class="eyebrow">{{
              t("SOURCE LINE {line} · VERSION 1", {
                line: formatNumber(s.sourceLine),
              })
            }}</span>
            <blockquote>{{ s.sourceText }}</blockquote>
          </div>
          <div class="form-grid">
            <label
              >{{ t("Project")
              }}<select
                v-model="s.selectedProjectId"
                :aria-label="
                  t('Project for suggestion {count}', {
                    count: formatNumber(index + 1),
                  })
                "
                @change="s.overwriteConfirmed = false"
              >
                <option value="">{{ t("Choose a project") }}</option>
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
                    ? t("Model candidate — please verify")
                    : t("Name / alias match — please verify")
                  : s.candidates.length > 1
                    ? t("Ambiguous: ") +
                      s.candidates
                        .map(
                          (c) =>
                            store.data.projects.find(
                              (p) => p.id === c.projectId,
                            )?.name,
                        )
                        .join(", ")
                    : t("No match found. Select the correct project.")
              }}</small
              ><small v-if="proposal.generator" class="muted">{{
                s.candidates.map((c) => c.reason).join(" · ")
              }}</small></label
            ><label
              >{{ t("Proposed change")
              }}<select
                v-model="s.action"
                :aria-label="
                  t('Action for suggestion {count}', {
                    count: formatNumber(index + 1),
                  })
                "
                @change="s.overwriteConfirmed = false"
              >
                <option value="task">{{ t("Create task") }}</option>
                <option value="update">
                  {{ t("Replace latest project update") }}
                </option>
              </select></label
            ><label class="full"
              >{{ t("Reviewed text")
              }}<input
                v-model="s.title"
                maxlength="240"
                :aria-label="
                  t('Text for suggestion {count}', {
                    count: formatNumber(index + 1),
                  })
                " /></label
            ><label v-if="s.action === 'task'"
              >{{ t("Task status")
              }}<select v-model="s.status">
                <option v-for="st in statuses" :key="st" :value="st">
                  {{ statusLabels[st] }}
                </option>
              </select></label
            >
          </div>
          <div v-if="s.action === 'update'" class="overwrite-review">
            <strong>{{ t("Current latest update") }}</strong>
            <p>
              {{
                store.data.projects.find((p) => p.id === s.selectedProjectId)
                  ?.latestUpdate ||
                t("Choose a project to review its current update.")
              }}
            </p>
            <label class="check-label"
              ><input
                v-model="s.overwriteConfirmed"
                type="checkbox"
                :disabled="!s.selectedProjectId"
              />{{ t("I reviewed and confirm replacing this update") }}</label
            >
          </div>
          <label class="check-label confirm-suggestion"
            ><input
              v-model="s.confirmed"
              type="checkbox"
              :aria-label="
                t('Confirm suggestion {count}', {
                  count: formatNumber(index + 1),
                })
              "
            />{{ t("I confirm the project and this proposed change") }}</label
          >
        </article>
        <section
          v-for="update in combinedUpdates"
          :key="update.id"
          class="panel"
        >
          <h3>{{ t("Combined update · {name}", { name: update.name }) }}</h3>
          <p class="muted">
            {{
              t(
                "The confirmed lines replace this project's latest update together, in source order.",
              )
            }}
          </p>
          <pre class="working-notes">{{ update.text }}</pre>
        </section>
        <div class="review-footer">
          <p class="muted">
            {{ t("Unselected items will not change your workspace.") }}
          </p>
          <button
            class="primary"
            :disabled="!valid || store.busy"
            @click="apply"
          >
            {{
              store.busy
                ? t("Applying…")
                : t("Apply {count} confirmed changes", {
                    count: formatNumber(selected.length),
                  })
            }}
          </button>
        </div></template
      ></template
    >
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
  </section>
</template>
