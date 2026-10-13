<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from "vue";
import type { Catalogs } from "../../../../packages/domain/admin";
import {
  channelEntries,
  projectChannel,
  type Channel,
} from "../../../../packages/domain/channels";
import {
  formatChannelProfile,
  parseChannelProfile,
  blankContactText,
} from "../../../../packages/domain/channel-profile";
import type { Project } from "../../../../packages/domain/types";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { confirmDiscard } from "../composables/unsaved";
import { stageLabels } from "../locales/en";
import ProjectEditor from "./ProjectEditor.vue";
const props = defineProps<{ catalog: Catalogs }>();
const emit = defineEmits<{ saved: [Catalogs]; dirty: [boolean] }>();
const store = useWorkspace();
const selectedId = ref("company"),
  added = ref<Channel | null>(null);
const selected = computed(
  () =>
    added.value ??
    channelEntries(props.catalog).find((c) => c.id === selectedId.value)!,
);
const text = ref(formatChannelProfile(selected.value));
const baseline = ref(text.value);
const dirty = computed(() => !!added.value || text.value !== baseline.value);
watch(dirty, (value) => emit("dirty", value), { immediate: true });
onBeforeUnmount(() => emit("dirty", false));
const textarea = ref<HTMLTextAreaElement>();
const error = ref(""),
  filter = ref(""),
  query = ref(""),
  editing = ref<Project | null>(null);
const preview = computed(() => {
  try {
    return parseChannelProfile(text.value, selected.value);
  } catch {
    return null;
  }
});
const rows = computed(() =>
  store.data.projects.filter(
    (p) =>
      !p.intakeInbox &&
      (!filter.value || projectChannel(p) === filter.value) &&
      `${p.name} ${p.shortName ?? ""} ${p.client} ${p.owner}`
        .toLowerCase()
        .includes(query.value.toLowerCase()),
  ),
);
function count(id: string) {
  return store.data.projects.filter(
    (p) => !p.intakeInbox && projectChannel(p) === id,
  ).length;
}
function channelName(project: Project) {
  return (
    channelEntries(props.catalog).find((c) => c.id === projectChannel(project))
      ?.shortName ?? projectChannel(project)
  );
}
function reset() {
  added.value = null;
  if (!channelEntries(props.catalog).some((c) => c.id === selectedId.value))
    selectedId.value = "company";
  text.value = formatChannelProfile(selected.value);
  baseline.value = text.value;
  error.value = "";
}
watch(() => props.catalog, reset);
function select(id: string) {
  if (id === selectedId.value && !added.value) return;
  if (!confirmDiscard()) return;
  added.value = null;
  selectedId.value = id;
  reset();
}
async function add() {
  if (!confirmDiscard()) return;
  added.value = {
    id: `channel-${crypto.randomUUID().slice(0, 8)}`,
    name: "",
    shortName: "",
    archived: false,
    contacts: [],
  };
  text.value = formatChannelProfile(added.value);
  baseline.value = "";
  error.value = "";
  await nextTick();
  textarea.value?.focus();
}
async function addContact() {
  text.value = text.value.trimEnd() + blankContactText;
  await nextTick();
  textarea.value?.focus();
  const start = text.value.lastIndexOf("姓名：") + 3;
  textarea.value?.setSelectionRange(start, start);
}
async function save() {
  error.value = "";
  try {
    const channel = parseChannelProfile(text.value, selected.value);
    const next = JSON.parse(JSON.stringify(props.catalog)) as Catalogs;
    next.channels = JSON.parse(
      JSON.stringify(channelEntries(props.catalog)),
    ) as Channel[];
    const index = next.channels.findIndex((c) => c.id === channel.id);
    if (index < 0) next.channels.push(channel);
    else next.channels[index] = channel;
    const saved = await store.operation(
      () => api.saveCatalogs(next),
      "渠道资料已保存",
    );
    selectedId.value = channel.id;
    added.value = null;
    text.value = formatChannelProfile(channel);
    baseline.value = text.value;
    emit("saved", saved);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <section class="channel-management">
    <div class="section-heading">
      <div>
        <h2>渠道与项目信息</h2>
        <p class="muted">
          选中渠道，在一个编辑器中维护公司资料和联系人。未设置渠道的项目归入默认渠道。
        </p>
      </div>
    </div>
    <div class="channel-layout">
      <nav class="channel-list" aria-label="选择渠道">
        <button
          v-for="channel in channelEntries(catalog)"
          :key="channel.id"
          type="button"
          :class="{ active: !added && selectedId === channel.id }"
          :aria-pressed="!added && selectedId === channel.id"
          @click="select(channel.id)"
        >
          <strong>{{ channel.shortName }}</strong
          ><small
            >{{ channel.name }}{{ channel.archived ? " · 已停用" : "" }}</small
          ><small
            >{{ count(channel.id) }} 个项目 ·
            {{ channel.contacts?.length ?? 0 }} 位联系人{{
              channel.id === "company" ? " · 默认" : ""
            }}</small
          >
        </button>
        <button type="button" class="text-button" @click="add">
          ＋ 添加渠道
        </button>
      </nav>
      <form
        class="panel profile-editor"
        aria-label="渠道资料编辑器"
        @submit.prevent="save"
      >
        <div class="section-heading">
          <h3>
            {{ added ? "新渠道资料" : selected.shortName + " · 公司资料" }}
          </h3>
          <small class="muted">{{ dirty ? "有修改待保存" : "已保存" }}</small>
        </div>
        <p class="muted editor-help">
          直接修改“字段名：内容”。每位联系人使用一个【联系人】段落；自由文字写在备注下。
        </p>
        <textarea
          ref="textarea"
          v-model="text"
          rows="20"
          maxlength="100000"
          aria-label="公司与联系人资料"
          :disabled="store.busy"
          :spellcheck="false"
        />
        <div class="profile-preview" aria-live="polite">
          <template v-if="preview"
            >{{ preview.name }} · {{ preview.shortName }} ·
            {{ preview.contacts?.length ?? 0 }} 位联系人<span
              v-if="preview.contacts?.find((c) => c.primary)"
            >
              · 主要联系人：{{
                preview.contacts.find((c) => c.primary)!.name
              }}</span
            ></template
          ><template v-else>部分信息待填写，保存时会检查字段格式。</template>
        </div>
        <p v-if="error" class="error-box" role="alert">{{ error }}</p>
        <div class="form-actions">
          <button type="button" :disabled="store.busy" @click="addContact">
            插入联系人</button
          ><button
            type="button"
            :disabled="!dirty || store.busy"
            @click="reset"
          >
            取消修改</button
          ><button
            class="primary"
            type="submit"
            :disabled="!dirty || store.busy"
          >
            保存资料
          </button>
        </div>
      </form>
    </div>
    <div class="section-heading">
      <h3>项目资料 · {{ rows.length }}</h3>
    </div>
    <div class="project-filters">
      <input
        v-model="query"
        placeholder="搜索项目全称、简称、客户或负责人"
        aria-label="搜索项目资料"
      /><select v-model="filter" aria-label="按渠道查看项目">
        <option value="">全部渠道</option>
        <option
          v-for="channel in channelEntries(catalog)"
          :key="channel.id"
          :value="channel.id"
        >
          {{ channel.shortName }}{{ channel.archived ? "（已停用）" : "" }}
        </option>
      </select>
    </div>
    <ProjectEditor
      v-if="editing"
      :key="editing.id"
      :project="editing"
      @close="editing = null"
      @saved="editing = null"
    />
    <div class="channel-project-table">
      <table>
        <thead>
          <tr>
            <th>项目全称</th>
            <th>简称</th>
            <th>渠道</th>
            <th>客户单位</th>
            <th>负责人</th>
            <th>阶段</th>
            <th>资料</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="project in rows" :key="project.id">
            <td>
              <RouterLink :to="`/projects/${project.id}`">{{
                project.name
              }}</RouterLink>
            </td>
            <td>{{ project.shortName || "未设置" }}</td>
            <td>{{ channelName(project) }}</td>
            <td>{{ project.client || "未设置" }}</td>
            <td>{{ project.owner || "未分配" }}</td>
            <td>{{ stageLabels[project.stage] }}</td>
            <td>
              <button
                type="button"
                class="text-button"
                :aria-label="`编辑项目资料 ${project.name}`"
                @click="confirmDiscard() && (editing = project)"
              >
                编辑
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!rows.length" class="muted">暂无匹配项目。</p>
  </section>
</template>
<style scoped>
.channel-layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 16px;
}
.channel-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.channel-list button {
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 4px;
  padding: 10px;
}
.channel-list button.active {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent);
}
.channel-list small {
  font-size: 10px;
  font-weight: 400;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.profile-editor {
  min-width: 0;
  padding: 16px;
}
.editor-help {
  font-size: 12px;
}
.profile-editor textarea {
  width: 100%;
  line-height: 1.85;
  font-size: 13px;
  resize: vertical;
}
.profile-preview {
  font-size: 11px;
  color: var(--muted);
  margin-top: 6px;
}
.project-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.project-filters input {
  flex: 1;
  min-width: 0;
}
.channel-project-table {
  max-width: 100%;
  overflow-x: auto;
}
.channel-project-table table {
  width: 100%;
  min-width: 800px;
  border-collapse: collapse;
  text-align: left;
  font-size: 12px;
}
th,
td {
  padding: 10px;
  border-bottom: 1px solid var(--border);
}
@media (max-width: 600px) {
  .channel-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .channel-list {
    flex-direction: row;
    overflow-x: auto;
  }
  .channel-list button {
    min-width: 140px;
    flex-shrink: 0;
  }
  .project-filters {
    flex-direction: column;
  }
  .profile-editor {
    padding: 12px;
  }
}
</style>
