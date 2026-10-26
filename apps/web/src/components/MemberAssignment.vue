<script setup lang="ts">
import { computed } from "vue";
import { useWorkspace } from "../stores/workspace";
import { t } from "../locales";
const props = defineProps<{
  label: string;
  modelValue: string;
  memberId?: string | null;
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
function select(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const selected = members.value.find((m) => m.id === id);
  emit("update:memberId", selected?.id ?? null);
  emit(
    "update:modelValue",
    selected?.name ??
      (id === "__unassigned"
        ? "Unassigned"
        : (member.value?.name ?? props.modelValue)),
  );
}
</script>
<template>
  <div class="member-assignment">
    <label
      >{{ t(label)
      }}<input
        :value="member?.name ?? modelValue"
        :readonly="!!memberId"
        maxlength="80"
        @input="
          emit('update:modelValue', ($event.target as HTMLInputElement).value)
        "
    /></label>
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
        <option v-for="person in available" :key="person.id" :value="person.id">
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
