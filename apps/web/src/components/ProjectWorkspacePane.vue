<script setup lang="ts">
import { computed, provide, ref } from "vue";
import { dialogContextKey } from "../composables/dialog-context";
const props = defineProps<{ active: boolean }>();
// Tabs retain their drafts. Only the visible pane participates in same-page
// discard checks; route departure and reload still protect every draft.
provide(dialogContextKey, {
  active: computed(() => props.active),
  target: ref(null),
});
</script>
<template>
  <section v-show="active"><slot /></section>
</template>
