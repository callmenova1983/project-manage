<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount, useId } from "vue";
import {
  PhArrowUpRight,
  PhCheckCircle,
  PhListChecks,
  PhCaretLeft,
  PhCaretRight,
} from "@phosphor-icons/vue";
import {
  dayKey,
  type Task,
  type Project,
} from "../../../../packages/domain/types";
import { t, formatDate, formatNumber } from "../locales";
import {
  plannedWork,
  retainedWorkSelection,
} from "../composables/planned-work";
import StatusBadge from "./StatusBadge.vue";
import TaskCompletion from "./TaskCompletion.vue";
const props = defineProps<{
  tasks: Task[];
  projects: Project[];
  scope: "today" | "week";
}>();
const next = computed(() =>
  plannedWork(props.tasks, props.projects, props.scope),
);
const visibleCount = ref(4),
  selected = ref(""),
  error = ref("");
const visible = computed(() => next.value.slice(0, visibleCount.value));
const position = computed(() =>
  Math.max(
    0,
    visible.value.findIndex(({ task }) => task.id === selected.value),
  ),
);
const rail = ref<HTMLOListElement | null>(null);
const cards = new Map<string, HTMLElement>();
const railId = useId();
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => visible.value.map(({ task }) => task.id),
  (ids, oldIds) => {
    selected.value = retainedWorkSelection(oldIds ?? [], ids, selected.value);
  },
  { immediate: true },
);
function rememberCard(id: string, element: unknown) {
  if (element instanceof HTMLElement) cards.set(id, element);
  else cards.delete(id);
}
async function select(id: string, focus = false) {
  selected.value = id;
  await nextTick();
  const card = cards.get(id),
    list = rail.value;
  if (!card || !list) return;
  if (list.scrollWidth > list.clientWidth) {
    const left =
      list.scrollLeft +
      card.getBoundingClientRect().left -
      list.getBoundingClientRect().left;
    list.scrollTo({
      left,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  if (focus)
    card
      .querySelector<HTMLButtonElement>(".work-select")
      ?.focus({ preventScroll: true });
}
function move(delta: number) {
  const item = visible.value[position.value + delta];
  if (item) void select(item.task.id);
}
function keydown(event: KeyboardEvent) {
  if (event.target !== rail.value) return;
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? visible.value.length - 1
        : event.key === "ArrowLeft"
          ? position.value - 1
          : event.key === "ArrowRight"
            ? position.value + 1
            : -1;
  const item = visible.value[index];
  if (item) {
    event.preventDefault();
    void select(item.task.id);
  }
}
function scrolled() {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const list = rail.value;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const edge = list.getBoundingClientRect().left;
    const closest = [...cards].sort(
      (a, b) =>
        Math.abs(a[1].getBoundingClientRect().left - edge) -
        Math.abs(b[1].getBoundingClientRect().left - edge),
    )[0];
    if (closest) selected.value = closest[0];
  }, 120);
}
async function showMore() {
  const nextItem = next.value[visibleCount.value];
  visibleCount.value += 4;
  if (nextItem) await select(nextItem.task.id, true);
}
onBeforeUnmount(() => clearTimeout(scrollTimer));
function plannedLabel(date: string | null) {
  return date === dayKey()
    ? t("Today")
    : date
      ? t("Planned {date}", {
          date: formatDate(date, { month: "short", day: "numeric" }),
        })
      : t("This week · day not assigned");
}
</script>
<template>
  <section class="next-work" :aria-label="t('Next up')">
    <header>
      <h2><PhListChecks :size="18" />{{ t("Next up") }}</h2>
      <RouterLink
        :to="{
          path: '/tasks',
          query: {
            scope,
            focus: 'open',
            ...(projects.length === 1 ? { project: projects[0]!.id } : {}),
          },
        }"
        >{{ t("View planned tasks") }}<PhArrowUpRight :size="14"
      /></RouterLink>
    </header>
    <p class="next-count">
      {{ t("{count} open planned tasks", { count: next.length }) }}
    </p>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <div
      v-if="visible.length"
      class="work-navigation"
      role="group"
      :aria-label="t('Browse planned work')"
    >
      <button
        class="icon-button"
        :aria-label="t('Previous planned task')"
        :aria-controls="railId"
        :disabled="position === 0"
        @click="move(-1)"
      >
        <PhCaretLeft :size="16" />
      </button>
      <span aria-live="polite">{{
        t("Task {current} of {count}", {
          current: formatNumber(position + 1),
          count: formatNumber(visible.length),
        })
      }}</span>
      <button
        class="icon-button"
        :aria-label="t('Next planned task')"
        :aria-controls="railId"
        :disabled="position === visible.length - 1"
        @click="move(1)"
      >
        <PhCaretRight :size="16" />
      </button>
    </div>
    <ol
      v-if="visible.length"
      :id="railId"
      ref="rail"
      tabindex="0"
      :aria-label="t('Planned task cards')"
      @scroll.passive="scrolled"
      @keydown="keydown"
    >
      <li
        v-for="{ task, date } in visible"
        :key="task.id"
        :ref="(element) => rememberCard(task.id, element)"
        :class="{ selected: selected === task.id }"
      >
        <div class="work-card-heading">
          <button
            class="work-select"
            :aria-pressed="selected === task.id"
            :aria-label="
              t('Select planned task {title}', { title: task.title })
            "
            @click="select(task.id)"
          >
            {{ plannedLabel(date) }}
          </button>
          <StatusBadge :status="task.status" />
        </div>
        <div class="work-card-body">
          <TaskCompletion :task="task" @error="error = $event" />
          <div>
            <RouterLink
              :to="{
                path: '/tasks',
                query: { project: task.projectId, scope, focus: 'open' },
              }"
              >{{ task.title }}</RouterLink
            >
            <span
              >{{
                projects.find((project) => project.id === task.projectId)?.name
              }}<template v-if="task.dueDate">
                ·
                {{
                  t("Due {date}", {
                    date: formatDate(task.dueDate, {
                      month: "short",
                      day: "numeric",
                    }),
                  })
                }}</template
              ></span
            >
          </div>
        </div>
      </li>
    </ol>
    <button
      v-if="next.length > visibleCount"
      class="text-button show-more-work"
      @click="showMore"
    >
      {{
        t("Show {count} more tasks", {
          count: Math.min(4, next.length - visibleCount),
        })
      }}
    </button>
    <div v-if="!next.length" class="next-empty">
      <PhCheckCircle :size="24" />
      <p>{{ t("Nothing pending in this scope") }}</p>
    </div>
  </section>
</template>
<style scoped>
.next-work {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 12px 14px;
  min-width: 0;
}
header,
h2,
.work-navigation,
.work-card-heading,
.work-card-body {
  display: flex;
  align-items: center;
  gap: 8px;
}
header,
.work-card-heading {
  justify-content: space-between;
}
h2 {
  font-size: 14px;
  margin: 0;
}
header > a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  min-height: 44px;
  color: var(--accent);
}
.next-count {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px;
}
.work-navigation {
  justify-content: flex-end;
  margin-bottom: 8px;
}
.work-navigation span {
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
ol {
  list-style: none;
  padding: 2px;
  margin: 0;
  display: grid;
  gap: 8px;
  border-radius: 6px;
}
li {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  transition:
    border-color 0.16s,
    background 0.16s;
}
li.selected {
  border-color: var(--accent);
  background: var(--surface-hover);
}
.work-select {
  padding: 4px 6px;
  min-height: 32px;
  background: transparent;
  border: 0;
  color: var(--muted);
  font-size: 11px;
}
.work-select[aria-pressed="true"] {
  color: var(--accent);
}
.work-card-body {
  align-items: flex-start;
  margin-top: 4px;
}
.work-card-body > div {
  min-width: 0;
  display: grid;
  gap: 5px;
  padding-top: 4px;
}
.work-card-body a {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.work-card-body span {
  font-size: 10px;
  color: var(--muted);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.work-card-heading :deep(.badge) {
  font-size: 10px;
  padding: 2px 4px;
}
.show-more-work {
  margin-top: 8px;
  font-size: 12px;
  min-height: 36px;
}
.next-empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  color: var(--muted);
  padding: 24px 0;
}
.next-empty p {
  font-size: 12px;
  margin: 0;
}
@media (max-width: 760px) {
  ol {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    padding-bottom: 12px;
  }
  li {
    flex: 0 0 calc(100% - 22px);
    scroll-snap-align: start;
    scroll-margin-inline: 2px;
  }
  header > a {
    font-size: 12px;
  }
  .work-select,
  .work-navigation button,
  .show-more-work {
    min-height: 44px;
  }
  .work-card-body a {
    display: inline-block;
    min-height: 28px;
    font-size: 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  li {
    transition: none;
  }
  ol {
    scroll-behavior: auto;
  }
}
</style>
