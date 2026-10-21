<script setup lang="ts">
import { t } from "../locales";
import { computed, ref, watch } from "vue";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import type { ProgressMaterial } from "../../../../packages/domain/progress-material";
import {
  referenceCategories,
  referenceLabels,
  type ReferenceArchiveInput,
  type ReferenceClassification,
} from "../../../../packages/domain/capture-reference";
const props = defineProps<{
  files: ProgressMaterial[];
  classification?: ReferenceClassification;
  notes: string;
  disabled?: boolean;
  defaultProjectId?: string;
}>();
const store = useWorkspace();
const projectId = ref(""),
  taskId = ref("");
const categories = ref<
  Record<string, ReferenceArchiveInput["files"][number]["category"]>
>({});
const edited = new Set<string>();
const changeProject = ref(false);
const projects = computed(() =>
  store.data.projects.filter((p) => !p.intakeInbox),
);
const project = computed(() =>
  projects.value.find((p) => p.id === projectId.value),
);
const tasks = computed(() =>
  store.data.tasks.filter((t) => t.projectId === projectId.value && !t.voided),
);
const hasEvidence = computed(() =>
  props.files.some((f) => categories.value[f.id] === "task-evidence"),
);
const ready = computed(() => !!project.value && !!props.files.length);
const categorySummary = computed(() =>
  [
    ...new Set(
      props.files.map((file) =>
        t(referenceLabels[categories.value[file.id] ?? "other"]),
      ),
    ),
  ].join(", "),
);
watch(
  () => [props.files.map((f) => f.id).join(","), props.classification],
  () => {
    for (const file of props.files)
      if (!edited.has(file.id))
        categories.value[file.id] =
          props.classification?.files.find((f) => f.id === file.id)?.category ??
          "other";
    if (!projectId.value) {
      const ids = [
        ...new Set(
          props.classification?.files
            .filter((f) => props.files.some((file) => file.id === f.id))
            .map((f) => f.projectId)
            .filter(Boolean),
        ),
      ];
      if (ids.length === 1 && projects.value.some((p) => p.id === ids[0]))
        projectId.value = ids[0]!;
    }
  },
  { immediate: true },
);
watch(projectId, () => (taskId.value = ""), { flush: "sync" });
let classified = "",
  classificationNote = "";
async function archive() {
  if (!project.value) throw Error(t("请选择资料归属的项目。"));
  const target = project.value;
  const key = JSON.stringify([
    props.files.map((f) => f.id),
    props.notes,
    target.id,
  ]);
  if (classified !== key) {
    const result =
      props.classification ??
      (await api.classifyCaptureReferences(
        props.files.map((f) => f.id),
        props.notes.slice(0, 2000),
      ));
    if (result.provider !== "qwen")
      throw Error(t("AI 分类未完成，请重试或手动确认附件。"));
    for (const file of result.files)
      if (!edited.has(file.id)) categories.value[file.id] = file.category;
    classificationNote = t("仅按文件名和说明分类，未读取正文。");
    classified = key;
  }
  const saved = await api.archiveCaptureReferences({
    projectId: target.id,
    version: target.version,
    files: props.files.map((file) => ({
      id: file.id,
      category: categories.value[file.id] ?? "other",
      ...(categories.value[file.id] === "task-evidence" && taskId.value
        ? { taskId: taskId.value }
        : {}),
    })),
  });
  return { files: saved, project: target, note: classificationNote };
}
function exportState() {
  return {
    projectId: projectId.value,
    taskId: taskId.value,
    categories: { ...categories.value },
    edited: [...edited],
  };
}
function restoreState(value: unknown) {
  if (!value || typeof value !== "object") return;
  const saved = value as ReturnType<typeof exportState>;
  if (projects.value.some((p) => p.id === saved.projectId))
    projectId.value = saved.projectId;
  if (tasks.value.some((task) => task.id === saved.taskId))
    taskId.value = saved.taskId;
  for (const file of props.files) {
    const category = saved.categories?.[file.id];
    if (category && referenceCategories.includes(category)) {
      categories.value[file.id] = category;
      if (Array.isArray(saved.edited) && saved.edited.includes(file.id))
        edited.add(file.id);
    }
  }
}
defineExpose({ ready, archive, exportState, restoreState });
</script>
<template>
  <div class="reference-review" :aria-label="t('资料归档')">
    <p v-if="project && !changeProject" class="archive-target">
      {{ t("归到") }} {{ project.shortName || project.name }}
      <button
        type="button"
        class="text-button"
        :disabled="disabled"
        @click="changeProject = true"
      >
        {{ t("更改") }}
      </button>
    </p>
    <label v-else class="archive-target"
      >{{ t("无法确定归属，请选择项目") }}
      <select
        v-model="projectId"
        :aria-label="t('归档项目')"
        :disabled="disabled"
        @change="changeProject = false"
      >
        <option value="">{{ t("选择项目…") }}</option>
        <option v-for="item in projects" :key="item.id" :value="item.id">
          {{ item.shortName || item.name }}
        </option>
      </select>
    </label>
    <details class="archive-categories">
      <summary>
        {{ t("资料分类：") }}{{ categorySummary }}
        <small>{{ t("可调整") }}</small>
      </summary>
      <div class="archive-tags">
        <label v-for="file in files" :key="file.id" :title="file.name">
          <span>{{ file.name }}</span>
          <select
            v-model="categories[file.id]"
            :aria-label="t('{p0} 的资料类别', { p0: file.name })"
            :disabled="disabled"
            @change="edited.add(file.id)"
          >
            <option
              v-for="kind in referenceCategories"
              :key="kind"
              :value="kind"
            >
              {{ t(referenceLabels[kind]) }}
            </option>
          </select>
        </label>
      </div>
    </details>
    <details v-if="hasEvidence && project" class="archive-task">
      <summary>{{ t("关联已有任务（可选）") }}</summary>
      <select
        v-model="taskId"
        :aria-label="t('执行凭证关联任务')"
        :disabled="disabled"
      >
        <option value="">{{ t("不关联任务") }}</option>
        <option v-for="task in tasks" :key="task.id" :value="task.id">
          {{ task.title }}
        </option>
      </select>
      <small>{{ t("仅保存凭证，不改变任务状态。") }}</small>
    </details>
  </div>
</template>
<style scoped>
.reference-review {
  margin-top: 10px;
  font-size: 12px;
}
.archive-target {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.archive-target select {
  flex: 1;
  min-width: 0;
}
.reference-review select {
  min-height: 30px;
  padding: 4px 25px 4px 8px;
  font-size: 12px;
}
.archive-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.archive-tags label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-weight: normal;
}
.archive-tags label > span {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.archive-tags select {
  width: auto;
  max-width: 150px;
  border: 0;
  background: transparent;
  color: var(--accent);
}
.archive-categories {
  margin-top: 8px;
  color: var(--muted);
}
.archive-categories summary {
  cursor: pointer;
  font-size: 11px;
}
.archive-task {
  margin-top: 8px;
  color: var(--muted);
}
.archive-task select {
  display: block;
  width: 100%;
  margin: 6px 0;
}
@media (max-width: 600px) {
  .reference-review select {
    min-height: 40px;
  }
}
</style>
