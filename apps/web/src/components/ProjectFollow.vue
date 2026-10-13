<script setup lang="ts">
import { PhStar } from "@phosphor-icons/vue";
import { computed } from "vue";
import { useWorkspace } from "../stores/workspace";
import { confirmDiscard } from "../composables/unsaved";
import { t } from "../locales";
const props = defineProps<{ id: string; name: string }>();
const store = useWorkspace();
const followed = computed(() => store.following.has(props.id));
const label = computed(() =>
  t(followed.value ? "Unfollow {name}" : "Follow {name}", { name: props.name }),
);
function toggle() {
  if (
    store.projectNavigation.followedOnly &&
    followed.value &&
    !confirmDiscard()
  )
    return;
  store.toggleFollowing(props.id);
}
</script>
<template>
  <button
    type="button"
    class="project-follow icon-button"
    :class="{ followed }"
    :aria-label="label"
    :title="label"
    :aria-pressed="followed"
    @click="toggle"
  >
    <PhStar :size="18" :weight="followed ? 'fill' : 'regular'" />
  </button>
</template>
<style scoped>
.project-follow {
  display: inline-flex;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 3px;
  color: var(--text-secondary);
}
.project-follow.followed {
  color: var(--accent-text);
  background: var(--accent-bg);
}
@media (max-width: 760px) {
  .project-follow {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
  }
}
</style>
