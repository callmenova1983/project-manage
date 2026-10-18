<script setup lang="ts">
import { computed } from "vue";
import PersonPicker from "./PersonPicker.vue";
import { useWorkspace } from "../stores/workspace";
import { t } from "../locales";
const props = defineProps<{
  label: string;
  modelValue: string;
  memberId?: string | null;
  projectId?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [string];
  "update:memberId": [string | null];
}>();
const store = useWorkspace();
const members = computed(() => store.data.members ?? []);
const member = computed(() =>
  members.value.find((m) => m.id === props.memberId),
);
const available = computed(() =>
  members.value.filter((m) => m.status === "active" || m.id === props.memberId),
);
function updateName(value: string) {
  if (value !== (member.value?.name ?? props.modelValue))
    emit("update:memberId", null);
  emit("update:modelValue", value);
}
function select(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const selected = members.value.find((m) => m.id === id);
  emit("update:memberId", selected?.id ?? null);
  emit(
    "update:modelValue",
    selected?.name ??
      (id === "__unassigned" ? "" : (member.value?.name ?? props.modelValue)),
  );
}
</script>
<template>
  <div class="member-assignment">
    <label
      >{{ t(label)
      }}<PersonPicker
        :model-value="member?.name ?? modelValue"
        :project-id="projectId"
        :label="t(label)"
        :disabled="store.busy"
        link-members
        :member-id="memberId"
        @update:model-value="updateName"
        @select-identity="emit('update:memberId', $event)"
    /></label>
    <details class="member-link-options">
      <summary>{{ t("{field} member", { field: t(label) }) }}</summary>
      <label
        >{{ t("{field} member", { field: t(label) })
        }}<select
          :value="memberId ?? ''"
          :aria-label="t('{field} member', { field: t(label) })"
          @change="select"
        >
          <option value="">{{ t("Keep name as text") }}</option>
          <option value="__unassigned">{{ t("Unassigned") }}</option>
          <option v-if="memberId && !member" :value="memberId" disabled>
            {{ t("Member unavailable") }}
          </option>
          <option
            v-for="person in available"
            :key="person.id"
            :value="person.id"
          >
            {{ person.name }} · {{ person.email
            }}{{ person.status !== "active" ? ` · ${t(person.status)}` : "" }}
          </option>
        </select></label
      >
      <small>{{
        t(
          memberId
            ? "Linked member; renames keep this assignment."
            : "Text only; no member is linked.",
        )
      }}</small>
    </details>
  </div>
</template>
<style scoped>
.member-assignment {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.member-assignment label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.member-assignment select {
  max-width: 100%;
}
.member-assignment small {
  color: var(--muted);
  font-size: 11px;
}
</style>

<style scoped>
.member-link-options {
  color: var(--muted);
  font-size: 11px;
}
.member-link-options summary {
  cursor: pointer;
}
.member-link-options[open] {
  display: grid;
  gap: 6px;
}
</style>
