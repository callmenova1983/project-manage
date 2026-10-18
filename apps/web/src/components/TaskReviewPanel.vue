<script setup lang="ts">
import { computed, ref } from "vue";
import { taskInput, type Task } from "../../../../packages/domain/types";
import {
  reviewChoice,
  type ReviewChoice,
} from "../../../../packages/domain/task-review";
import { useWorkspace } from "../stores/workspace";
import { useUnsaved } from "../composables/unsaved";
import { reminderInstant } from "../../../../packages/domain/time-zone";
import { formatDate, t } from "../locales";
const props = withDefaults(defineProps<{ task: Task; showTimes?: boolean }>(), {
  showTimes: true,
});
const store = useWorkspace();
const state = computed(() => {
  const entry = store.taskReviews[props.task.id];
  return entry?.version === props.task.version ? entry : undefined;
});
const question = computed(() => state.value?.result?.questions[0]);
const error = ref("");
const manual = ref(false);
const field = ref<ReviewChoice["field"]>("estimatedDate");
const value = ref("");
const reminderZone = ref(store.timeZone);
const mayDiscard = useUnsaved(
  computed(() => manual.value && !!value.value.trim()),
);
const hasReview = computed(
  () =>
    state.value?.status === "pending" ||
    state.value?.status === "failed" ||
    !!question.value ||
    manual.value ||
    !!error.value,
);
function toggleManual() {
  if (manual.value) {
    if (!mayDiscard()) return;
    manual.value = false;
    value.value = "";
  } else {
    reminderZone.value = store.timeZone;
    manual.value = true;
  }
}
async function apply(choice: ReviewChoice) {
  error.value = "";
  const before = state.value;
  const original = { ...props.task };
  try {
    reviewChoice.parse(choice);
    const saved = await store.saveTask(
      {
        ...taskInput.strip().parse(original),
        ...(choice.field === "assignee" ? { assigneeId: null } : {}),
        [choice.field]: choice.value,
      },
      original,
    );
    if (before?.result) {
      const questions = before.result.questions.slice(1);
      store.taskReviews[saved.id] = {
        version: saved.version,
        status: "ready",
        result: { taskId: saved.id, version: saved.version, questions },
      };
    }
    manual.value = false;
    value.value = "";
  } catch {
    error.value = t("补全未保存，请检查时间或刷新后重试。");
  }
}
function skip() {
  if (!mayDiscard()) return;
  if (state.value?.result) state.value.result.questions.shift();
  manual.value = false;
  value.value = "";
}
function saveManual() {
  error.value = "";
  try {
    const selected =
      field.value === "reminderAt"
        ? reminderInstant(value.value, reminderZone.value)
        : value.value;
    void apply({ label: t("手动补全"), field: field.value, value: selected });
  } catch (reason) {
    error.value = t((reason as Error).message);
  }
}
function reminderLabel(time: string) {
  return formatDate(time, {
    timeZone: store.timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>
<template>
  <div
    v-if="hasReview || (showTimes && (task.estimatedDate || task.reminderAt))"
    class="task-review"
    aria-live="polite"
  >
    <div
      v-if="showTimes && (task.estimatedDate || task.reminderAt)"
      class="time-details"
    >
      <span v-if="task.estimatedDate"
        >{{ t("Estimated date") }} {{ formatDate(task.estimatedDate) }}</span
      >
      <span v-if="task.reminderAt"
        >{{ t("Reminder") }} {{ reminderLabel(task.reminderAt) }} ({{
          store.timeZone
        }})</span
      >
    </div>
    <small v-if="state?.status === 'pending'" class="muted">{{
      t("已保存 · 正在分析是否需要补全…")
    }}</small>
    <div v-else-if="state?.status === 'failed'" class="review-message">
      <small class="muted">{{ t("已保存 · 暂未完成智能分析") }}</small>
      <button
        type="button"
        class="text-button"
        @click="store.queueTaskReview(task)"
      >
        {{ t("重新分析") }}
      </button>
      <button type="button" class="text-button" @click="toggleManual">
        {{ t("手动补全") }}
      </button>
      <button
        type="button"
        class="text-button"
        @click="store.dismissTaskReview(task.id)"
      >
        {{ t("忽略") }}
      </button>
    </div>
    <div v-else-if="question" class="review-message">
      <small>{{ question.question }}</small>
      <span class="muted evidence">{{ t("原文：") }}{{ question.quote }}</span>
      <button
        v-for="(choice, index) in question.choices"
        :key="index"
        type="button"
        :disabled="store.busy"
        @click="apply(choice)"
      >
        {{ choice.label }}
      </button>
      <button type="button" class="text-button" @click="toggleManual">
        {{ t("手动补全") }}
      </button>
      <button type="button" class="text-button" @click="skip">
        {{ t("暂不补全") }}
      </button>
    </div>
    <form v-if="manual" class="manual-details" @submit.prevent="saveManual">
      <select
        v-model="field"
        :aria-label="t('补全信息类型')"
        @change="value = ''"
      >
        <option value="estimatedDate">{{ t("预计时间") }}</option>
        <option value="dueDate">{{ t("任务截止时间") }}</option>
        <option value="reminderAt">
          {{ t("Reminder") }} ({{ reminderZone }})
        </option>
        <option value="assignee">{{ t("负责人") }}</option>
      </select>
      <input
        v-model="value"
        :type="
          field === 'assignee'
            ? 'text'
            : field === 'reminderAt'
              ? 'datetime-local'
              : 'date'
        "
        :aria-label="t('补全信息')"
        required
      />
      <button type="submit" :disabled="store.busy">{{ t("确认补全") }}</button>
      <button type="button" class="text-button" @click="toggleManual">
        {{ t("取消") }}
      </button>
    </form>
    <small v-if="error" class="error-box" role="alert">{{ t(error) }}</small>
  </div>
</template>
<style scoped>
.task-review {
  min-width: 0;
  margin-top: 4px;
  font-size: 11px;
}
.time-details,
.review-message,
.manual-details {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.time-details {
  color: var(--muted);
}
.evidence {
  flex-basis: 100%;
  overflow-wrap: anywhere;
}
.review-message button,
.manual-details button {
  font-size: 11px;
  padding: 3px 6px;
  min-height: 26px;
}
.manual-details {
  margin-top: 5px;
}
.manual-details input,
.manual-details select {
  min-width: 0;
  max-width: 100%;
  font-size: 11px;
  padding: 3px 5px;
  height: 30px;
}
@media (max-width: 600px) {
  .review-message button,
  .manual-details button {
    min-height: 44px;
  }
  .manual-details input,
  .manual-details select {
    min-height: 44px;
    font-size: 16px;
  }
}
</style>
