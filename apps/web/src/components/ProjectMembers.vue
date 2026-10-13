<script setup lang="ts">
import { computed } from "vue";
import { useWorkspace } from "../stores/workspace";
import { t, formatNumber } from "../locales";
const props = defineProps<{ projectId: string }>();
const store = useWorkspace();
const members = computed(
  () =>
    store.data.projectMembers?.filter((m) => m.projectId === props.projectId) ??
    [],
);
</script>
<template>
  <details class="panel project-team">
    <summary>
      {{ t("Project team") }} · {{ formatNumber(members.length) }}
      <span class="muted">{{ t("Editors join automatically") }}</span>
    </summary>
    <div class="member-list">
      <div v-for="member in members" :key="member.userId" class="member">
        <span class="avatar small">{{ member.name.slice(0, 1) }}</span>
        <div>
          <strong>{{ member.name }}</strong
          ><small class="muted">{{
            [member.department, member.position].filter(Boolean).join(" · ")
          }}</small>
        </div>
      </div>
      <p v-if="!members.length" class="muted">
        {{
          t(
            "No editors yet. The first saved edit adds its author to this project team.",
          )
        }}
      </p>
    </div>
  </details>
</template>
<style scoped>
.project-team {
  margin-bottom: 18px;
}
.project-team summary {
  cursor: pointer;
}
.project-team summary .muted {
  margin-left: 10px;
  font-size: 12px;
}
.member-list {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.member {
  display: flex;
  align-items: center;
  gap: 8px;
}
.member small {
  display: block;
}
</style>
