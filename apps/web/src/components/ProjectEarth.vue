<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { t, locale } from "../locales";
import {
  createEarthScene,
  type EarthPoint,
  type EarthScene,
  type EarthFocusOptions,
} from "../services/earth-scene";

const props = withDefaults(
  defineProps<{
    points: EarthPoint[];
    selectedId?: string | null;
    picking?: boolean;
  }>(),
  { selectedId: null, picking: false },
);
const emit = defineEmits<{
  select: [id: string];
  pick: [location: { latitude: number; longitude: number }];
  ready: [];
  error: [message: string];
  interact: [];
}>();
const host = ref<HTMLDivElement>();
const loading = ref(true);
const failure = ref("");
let scene: EarthScene | undefined;
let disposed = false;

onMounted(() => {
  if (!host.value) return;
  try {
    scene = createEarthScene(host.value, {
      onSelect: (id) => emit("select", id),
      onPick: (location) => emit("pick", location),
      onInteract: () => emit("interact"),
      onReady: () => {
        if (disposed) return;
        loading.value = false;
        failure.value = "";
        emit("ready");
      },
      onError: (message) => {
        if (disposed) return;
        loading.value = false;
        failure.value = message;
        emit("error", message);
      },
    });
    scene.setLanguage(locale.value);
    scene.setPoints(props.points);
    scene.setSelected(props.selectedId);
    scene.setPicking(props.picking);
  } catch {
    loading.value = false;
    failure.value =
      "This device cannot start the 3D map. Use a browser with WebGL support.";
    emit("error", failure.value);
  }
});
watch(locale, (value) => scene?.setLanguage(value));
watch(
  () => props.points,
  (points) => scene?.setPoints(points),
  { deep: true },
);
watch(
  () => props.selectedId,
  (id) => scene?.setSelected(id),
);
watch(
  () => props.picking,
  (picking) => scene?.setPicking(picking),
);
onBeforeUnmount(() => {
  disposed = true;
  scene?.dispose();
});
defineExpose({
  overview: (options?: { duration?: number }) => scene?.overview(options),
  startIntro: () => scene?.startIntro(),
  reset: () => scene?.reset(),
  zoomIn: () => scene?.zoomIn(),
  zoomOut: () => scene?.zoomOut(),
  focusPoint: (id: string, options?: EarthFocusOptions) =>
    scene?.focusPoint(id, options),
  highlightPoint: (id: string) => scene?.highlightPoint(id),
});
</script>

<template>
  <div
    ref="host"
    class="project-earth"
    :class="{ 'is-picking': picking }"
    :aria-label="t('Interactive 3D project map')"
  >
    <div v-if="loading" class="earth-feedback" role="status">
      <i />{{ t("Loading Earth imagery") }}
    </div>
    <div
      v-if="failure"
      class="earth-feedback earth-feedback--error"
      role="alert"
    >
      {{ t(failure) }}
    </div>
  </div>
</template>

<style>
.project-earth {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #020b15;
  touch-action: none;
}
.project-earth canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  outline: none;
}
.project-earth canvas:active {
  cursor: grabbing;
}
.project-earth.is-picking canvas {
  cursor: crosshair;
}
.earth-label-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.earth-city-label {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  pointer-events: auto;
  border: 0;
  background: transparent;
  color: #edfaff;
  padding: 7px 10px 7px 0;
  border-radius: 20px;
  white-space: nowrap;
  font:
    500 14px/1.3 Inter,
    "PingFang SC",
    sans-serif;
  text-shadow:
    0 2px 5px #000,
    0 0 14px #000;
  cursor: pointer;
  transition: background 0.2s;
}
.earth-city-label:hover,
.earth-city-label:focus-visible {
  background: #06182dd9;
  outline: 1px solid #7bf5e8;
}
.earth-city-label[hidden] {
  display: none;
}
.earth-hq-label {
  position: absolute;
  top: 0;
  left: 0;
  color: #afffdf;
  font:
    600 12px/1.4 Inter,
    "PingFang SC",
    sans-serif;
  letter-spacing: 1px;
  white-space: nowrap;
  pointer-events: none;
  text-shadow:
    0 1px 5px #000,
    0 0 12px #001d1b;
}
.earth-hq-label[hidden] {
  display: none;
}
.earth-city-dot {
  width: 10px;
  height: 10px;
  display: block;
  flex: 0 0 10px;
  border-radius: 50%;
  background: var(--point-color);
  border: 2px solid #eaffff;
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--point-color) 22%, transparent),
    0 0 20px var(--point-color);
}
.earth-city-label.is-selected {
  color: #fff;
  font-size: 15px;
  font-weight: 650;
}
.earth-city-label.is-selected .earth-city-dot {
  width: 14px;
  height: 14px;
  flex-basis: 14px;
  box-shadow:
    0 0 0 6px color-mix(in srgb, var(--point-color) 22%, transparent),
    0 0 0 15px color-mix(in srgb, var(--point-color) 10%, transparent),
    0 0 30px var(--point-color);
}
.earth-feedback {
  position: absolute;
  top: 48%;
  left: 37%;
  z-index: 2;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  color: #bdd4e1;
  border: 1px solid #254257;
  border-radius: 12px;
  background: #061321e8;
  font-size: 13px;
  pointer-events: none;
}
.earth-feedback i {
  height: 9px;
  width: 9px;
  border-radius: 50%;
  background: #62e7df;
  box-shadow: 0 0 18px #62e7df;
}
.earth-feedback--error {
  max-width: 340px;
  color: #ffd599;
  line-height: 1.7;
}
@media (max-width: 760px) {
  .earth-feedback {
    left: 50%;
    width: max-content;
    max-width: 80%;
  }
  .earth-city-label {
    font-size: 12px;
  }
}
</style>
