<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from "vue";
import { PhMagnifyingGlass, PhCheck, PhX, PhUser } from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import {
  peopleChoices,
  searchPeople,
} from "../../../../packages/domain/people-search";
import { t } from "../locales";
const props = defineProps<{
  modelValue: string;
  projectId?: string;
  label?: string;
  disabled?: boolean;
  autoOpen?: boolean;
  compact?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [string];
  select: [string];
  cancel: [];
}>();
const store = useWorkspace(),
  id = useId();
const search = ref<HTMLInputElement>();
const normalized = (value: string) => (value === "Unassigned" ? "" : value);
const query = ref(normalized(props.modelValue)),
  active = ref(0);
watch(
  () => props.modelValue,
  (value) => {
    if (normalized(value) !== query.value) query.value = normalized(value);
  },
);
const matches = computed(() =>
  searchPeople(peopleChoices(store.data, props.projectId), query.value),
);
const ordered = computed(() => matches.value.slice(0, props.compact ? 4 : 6));
const custom = computed(
  () =>
    !!query.value.trim() &&
    !matches.value.some((p) => p.name === query.value.trim()),
);
const count = computed(() => ordered.value.length + (custom.value ? 1 : 0));
function choose(name: string) {
  if (props.disabled) return;
  query.value = name;
  emit("update:modelValue", name);
  emit("select", name);
}
function input() {
  active.value = 0;
  // This is also the editable name field: typed names can be saved directly.
  emit("update:modelValue", query.value);
}
async function key(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("cancel");
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (count.value)
      active.value =
        (active.value + (event.key === "ArrowDown" ? 1 : -1) + count.value) %
        count.value;
    await nextTick();
    document
      .getElementById(`${id}-option-${active.value}`)
      ?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    choose(ordered.value[active.value]?.name ?? query.value.trim());
  }
}
onMounted(() => {
  if (props.autoOpen) search.value?.focus();
});
defineExpose({ focus: () => search.value?.focus() });
</script>
<template>
  <div class="person-picker" :class="{ compact }">
    <div class="person-search">
      <PhMagnifyingGlass :size="15" />
      <input
        ref="search"
        v-model="query"
        :aria-label="label || t('Assignee')"
        :placeholder="t('Name, pinyin, initials or employee number')"
        :disabled="disabled"
        autocomplete="off"
        autocapitalize="none"
        :spellcheck="false"
        maxlength="80"
        role="combobox"
        :aria-controls="`${id}-list`"
        :aria-expanded="count > 0"
        aria-autocomplete="list"
        :aria-activedescendant="count ? `${id}-option-${active}` : undefined"
        @input="input"
        @keydown="key"
      />
      <button
        v-if="query"
        type="button"
        class="clear-person"
        :aria-label="t('Unassigned')"
        :disabled="disabled"
        @click="choose('')"
      >
        <PhX :size="13" />
      </button>
    </div>
    <div
      :id="`${id}-list`"
      class="person-results"
      role="listbox"
      :aria-label="label || t('Assignee')"
    >
      <button
        v-for="(person, index) in ordered"
        :id="`${id}-option-${index}`"
        :key="person.name"
        type="button"
        class="person-option"
        role="option"
        :disabled="disabled"
        :aria-selected="modelValue === person.name"
        :class="{ highlight: active === index }"
        @pointerdown.prevent
        @mouseenter="active = index"
        @click="choose(person.name)"
      >
        <span class="person-initial">{{ person.name.slice(0, 1) }}</span>
        <span class="person-info"
          ><strong>{{ person.name }}</strong
          ><small>{{
            [person.department, person.position, person.employeeNo]
              .filter(Boolean)
              .join(" · ") || t("Existing project participant")
          }}</small></span
        >
        <span v-if="person.reasons.length" class="person-reason">{{
          t(person.reasons[0]!)
        }}</span>
        <PhCheck v-if="modelValue === person.name" :size="14" />
      </button>
      <button
        v-if="custom"
        :id="`${id}-option-${ordered.length}`"
        type="button"
        class="person-option custom-person"
        role="option"
        aria-selected="false"
        :disabled="disabled"
        :class="{ highlight: active === ordered.length }"
        @pointerdown.prevent
        @mouseenter="active = ordered.length"
        @click="choose(query.trim())"
      >
        <PhUser :size="16" />{{ t("Use “{name}”", { name: query.trim() }) }}
        <small>{{ t("Person outside the directory") }}</small>
      </button>
    </div>
    <small v-if="matches.length > ordered.length" class="person-hint"
      >输入姓名、拼音或工号缩小范围</small
    >
  </div>
</template>
<style scoped>
.person-picker {
  min-width: 0;
  width: 100%;
}
.person-search {
  position: relative;
}
.person-search > svg {
  position: absolute;
  left: 9px;
  top: 12px;
  color: var(--muted);
  pointer-events: none;
}
.person-search input {
  width: 100%;
  height: 38px;
  padding: 8px 30px;
  font-size: 12px;
  background: var(--surface-subtle);
  border-radius: 6px;
}
.clear-person {
  position: absolute;
  right: 4px;
  top: 4px;
  border: 0;
  background: transparent;
  padding: 4px;
  min-height: 30px;
  color: var(--muted);
}
.person-results {
  max-height: 150px;
  overflow-y: auto;
  overscroll-behavior: contain;
  margin-top: 4px;
}
.person-option {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  padding: 6px;
  min-height: 40px;
  background: transparent;
  border: 0;
  border-radius: 5px;
  text-align: left;
  color: var(--text);
  font-weight: 400;
}
.person-option.highlight {
  background: var(--accent-bg);
}
.person-initial {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  flex: none;
  border-radius: 50%;
  background: var(--surface-raised);
  color: var(--accent);
  font-size: 12px;
}
.person-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.person-info strong {
  font-size: 12px;
  font-weight: 500;
}
.person-info small {
  font-size: 10px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.person-reason {
  font-size: 9px;
  color: var(--accent);
  max-width: 75px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.person-option > svg {
  flex: none;
  color: var(--accent);
}
.custom-person {
  flex-wrap: wrap;
  font-size: 11px;
  white-space: normal;
}
.custom-person small {
  width: 100%;
  padding-left: 23px;
  font-size: 10px;
  color: var(--muted);
}
.person-hint {
  display: block;
  color: var(--muted);
  font-size: 10px;
  margin-top: 3px;
}
.compact .person-search input {
  height: 30px;
  font-size: 11px;
}
.compact .person-search > svg {
  top: 8px;
}
.compact .clear-person {
  top: 0;
}
.compact .person-results {
  max-height: 120px;
}
</style>
