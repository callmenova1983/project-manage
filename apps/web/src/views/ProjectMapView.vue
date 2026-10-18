<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute } from "vue-router";
import {
  PhArrowRight,
  PhCaretLeft,
  PhCaretRight,
  PhCaretDown,
  PhCheckCircle,
  PhCrosshair,
  PhGlobeHemisphereEast,
  PhMagnifyingGlass,
  PhMapPin,
  PhMinus,
  PhPause,
  PhPencilSimple,
  PhPlay,
  PhPlus,
  PhSparkle,
  PhSpinnerGap,
  PhTextT,
  PhWarningCircle,
  PhX,
} from "@phosphor-icons/vue";
import ProjectEarth from "../components/ProjectEarth.vue";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import { catalogLabel, catalogs } from "../composables/catalogs";
import { useUnsaved } from "../composables/unsaved";
import { t, locale } from "../locales";
import { useMapTranslation } from "../composables/map-translation";
import {
  englishPlace,
  romanizeName,
  englishNameFallback,
} from "../services/map-english";
import { projectInput, type Project } from "../../../../packages/domain/types";
import { memberName } from "../../../../packages/domain/members";
import {
  buildProjectMapTour,
  nextProjectMapTourId,
} from "../../../../packages/domain/project-map-tour";
import {
  inferProjectLocation,
  pointLocation,
  locationKey,
  locationLabel,
  locationPrecisionLabel,
  resolveLocationText,
  type ProjectLocation,
  type CityCandidate,
} from "../../../../packages/domain/project-location";

const store = useWorkspace();
const route = useRoute();
const earth = ref<InstanceType<typeof ProjectEarth> | null>(null);
const selectedId = ref(
  typeof route.query.project === "string" ? route.query.project : "",
);
const viewMode = ref<"overview" | "project" | "explore">(
  selectedId.value ? "project" : "overview",
);
const sceneReady = ref(false);
let needsProjectFocus = false;
const editingLocation = ref(false);
const tourInterval = ref(5000);
const search = ref("");
const stage = ref("");
const showSearch = ref(false);
const picking = ref(false);
const touring = ref(false);
let tourOrder: string[] = [];
let tourTimer: ReturnType<typeof setTimeout> | undefined;
function pauseTour() {
  touring.value = false;
  if (tourTimer) clearTimeout(tourTimer);
  tourTimer = undefined;
}
function onVisibilityChange() {
  if (document.hidden) pauseTour();
}
const saving = ref(false);
const recognizing = ref(false);
const aiEnabled = ref(false);
const aiProjectId = ref("");
const notice = ref("");
const error = ref("");
const globeError = ref("");
const pendingLocations = ref<Record<string, ProjectLocation>>({});
const textDrafts = ref<Record<string, string>>({});
const dirtyText = ref<Record<string, boolean>>({});
const alternatives = ref<Record<string, CityCandidate[]>>({});
const candidateSources = ref<Record<string, ProjectLocation["source"]>>({});
let alive = true;
onBeforeUnmount(() => {
  alive = false;
  pauseTour();
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
onMounted(async () => {
  document.addEventListener("visibilitychange", onVisibilityChange);
  try {
    const capabilities = await api.aiCapabilities();
    if (alive) aiEnabled.value = capabilities.enabled;
  } catch {
    // Local name matching and manual location remain available offline.
  }
});

const projects = computed(() =>
  store.data.projects.filter((p) => !p.intakeInbox),
);
const mapStages = computed(() => [
  ...catalogs.value.stages,
  ...(!catalogs.value.stages.some((s) => s.id === "unclassified")
    ? [{ id: "unclassified" }]
    : []),
]);
const inferred = computed(
  () => new Map(projects.value.map((p) => [p.id, inferProjectLocation(p)])),
);
function locationFor(p: Project): ProjectLocation | null {
  const matched = inferred.value.get(p.id)?.location;
  const saved = p.location;
  return (
    pendingLocations.value[p.id] ??
    (saved?.confirmed
      ? saved
      : saved?.precision === "city" && matched?.precision === "district"
        ? matched
        : saved) ??
    matched ??
    null
  );
}
const filtered = computed(() =>
  projects.value.filter((p) => {
    if (stage.value && p.stage !== stage.value) return false;
    const query = search.value.trim().toLocaleLowerCase();
    const location = locationFor(p);
    return (
      !query ||
      [
        p.name,
        p.shortName,
        p.client,
        englishNameFallback(p.name),
        englishNameFallback(p.shortName ?? ""),
        englishNameFallback(p.client),
        mapText(p.name),
        mapText(p.shortName ?? ""),
        mapText(p.client),
        location ? placeLabel(location) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(query)
    );
  }),
);
const selected = computed(
  () => filtered.value.find((p) => p.id === selectedId.value) ?? null,
);
const currentLocation = computed(() =>
  selected.value ? locationFor(selected.value) : null,
);
const tourEntries = computed(() =>
  filtered.value.map((p) => ({ id: p.id, location: locationFor(p) })),
);
const tourProjects = computed(() => buildProjectMapTour(tourEntries.value));
const orderedProjects = computed(() => {
  const byId = new Map(filtered.value.map((p) => [p.id, p]));
  return [
    ...tourProjects.value.map((id) => byId.get(id)!),
    ...filtered.value.filter((p) => !locationFor(p)),
  ];
});
// Keep a running tour stable. Changes to membership or location require a fresh
// round, rather than silently skipping or repeating projects midway through it.
watch(() => JSON.stringify(tourEntries.value), pauseTour);
function scheduleTour() {
  if (!touring.value) return;
  tourTimer = setTimeout(() => {
    if (
      document.hidden ||
      locationBusy.value ||
      hasDraft.value ||
      tourProjects.value.length < 2
    ) {
      pauseTour();
      return;
    }
    const nextId = nextProjectMapTourId(tourOrder, selectedId.value);
    if (!nextId) return pauseTour();
    chooseProject(nextId, true);
    scheduleTour();
  }, tourInterval.value);
}
watch(tourInterval, () => {
  if (!touring.value) return;
  if (tourTimer) clearTimeout(tourTimer);
  scheduleTour();
});
function toggleTour() {
  if (touring.value) return pauseTour();
  if (hasDraft.value || locationBusy.value || tourProjects.value.length < 2)
    return;
  picking.value = false;
  editingLocation.value = false;
  tourOrder = buildProjectMapTour(tourEntries.value, selectedId.value);
  touring.value = true;
  if (!currentLocation.value) chooseProject(tourOrder[0]!, true);
  else {
    viewMode.value = "project";
    void focusSelectedCity();
  }
  scheduleTour();
}
watch([search, stage], pauseTour);
const counts = computed(() => {
  let confirmed = 0,
    pending = 0;
  for (const p of projects.value) {
    const loc = locationFor(p);
    if (loc?.confirmed) confirmed++;
    else if (loc) pending++;
  }
  return {
    confirmed,
    pending,
    missing: projects.value.length - confirmed - pending,
  };
});
const coverage = computed(() => {
  const cities = new Set<string>();
  for (const p of projects.value) {
    const location = locationFor(p);
    if (location?.cityId) cities.add(location.cityId);
  }
  return {
    cities: cities.size,
    implementation: projects.value.filter((p) => p.stage === "implementation")
      .length,
    operations: projects.value.filter((p) => p.stage === "operations").length,
  };
});
const selectedOwner = computed(() =>
  selected.value
    ? memberName(
        selected.value.ownerId,
        selected.value.owner,
        store.data.members ?? [],
      )
    : "",
);
const translationSources = computed(() =>
  [
    ...(selected.value
      ? [
          selected.value.name,
          selected.value.shortName ?? "",
          selected.value.client,
          selected.value.latestUpdate ?? "",
        ]
      : []),
    currentLocation.value?.evidence ?? "",
    ...projects.value.flatMap((p) => [
      p.name,
      p.shortName ?? "",
      p.client,
      p.latestUpdate ?? "",
    ]),
    ...mapStages.value.map((s) => catalogLabel("stages", s.id)),
    error.value,
    notice.value,
  ].filter(Boolean),
);
const translation = useMapTranslation(
  computed(
    () =>
      `${store.user?.workspaceId ?? "local"}:${store.user?.id ?? "anonymous"}`,
  ),
  translationSources,
  aiEnabled,
);
const mapText = translation.text;
function placeLabel(location: ProjectLocation) {
  if (locale.value !== "en" || location.precision === "point")
    return locationLabel(location);
  return location.precision === "district"
    ? `${englishPlace(location.city)} · ${englishPlace(location.district ?? "")}`
    : englishPlace(location.city);
}
function stageLabel(id: string) {
  return mapText(catalogLabel("stages", id));
}
const selectedHasDraft = computed(
  () =>
    !!selected.value &&
    (!!pendingLocations.value[selected.value.id] ||
      !!dirtyText.value[selected.value.id]),
);
const candidates = computed(() =>
  selected.value
    ? (alternatives.value[selected.value.id] ??
      inferred.value.get(selected.value.id)?.candidates ??
      [])
    : [],
);
const hasDraft = computed(
  () =>
    Object.keys(pendingLocations.value).length > 0 ||
    Object.entries(dirtyText.value).some(
      ([id, dirty]) => dirty && !!textDrafts.value[id]?.trim(),
    ),
);
useUnsaved(hasDraft);
watch(
  filtered,
  (items) => {
    if (!items.length && !store.data.projects.length) return;
    if (!items.some((p) => p.id === selectedId.value)) {
      selectedId.value = orderedProjects.value[0]?.id ?? "";
      if (!sceneReady.value) viewMode.value = "overview";
    }
  },
  { immediate: true },
);
watch(selectedId, () => {
  picking.value = false;
  error.value = "";
  notice.value = "";
});
async function focusSelectedCity() {
  await nextTick();
  if (sceneReady.value && currentLocation.value)
    earth.value?.focusPoint(locationKey(currentLocation.value), {
      duration: 700,
      precision: currentLocation.value.precision,
    });
}
watch(
  [
    selectedId,
    () => (currentLocation.value ? locationKey(currentLocation.value) : null),
  ],
  async ([id, key], [previousId, previousKey]) => {
    if (!key || !sceneReady.value || viewMode.value !== "project") return;
    await nextTick();
    if (viewMode.value !== "project" || selectedId.value !== id) return;
    if (
      !needsProjectFocus &&
      previousId &&
      id !== previousId &&
      key === previousKey
    )
      earth.value?.highlightPoint(key);
    else await focusSelectedCity();
    needsProjectFocus = false;
  },
);
function earthReady() {
  globeError.value = "";
  sceneReady.value = true;
  if (viewMode.value === "project") void focusSelectedCity();
  else if (viewMode.value === "overview") {
    earth.value?.startIntro();
  }
}
function showOverview() {
  pauseTour();
  viewMode.value = "overview";
  earth.value?.overview();
}
function exploreMap() {
  pauseTour();
  viewMode.value = "explore";
}
function editLocation() {
  pauseTour();
  editingLocation.value = !editingLocation.value;
  if (!editingLocation.value) picking.value = false;
}
const locationBusy = computed(() => saving.value || !!aiProjectId.value);
const palette: Record<string, string> = {
  purple: "#70b6ff",
  blue: "#b5a2f5",
  green: "#82cda8",
  amber: "#e9bd72",
  rose: "#66d9ce",
  neutral: "#aab9cc",
};
function stageColor(id: string) {
  return (
    palette[
      catalogs.value.stages.find((s) => s.id === id)?.color ?? "neutral"
    ] ?? palette.neutral!
  );
}
const cityGroups = computed(() => {
  const groups = new Map<
    string,
    { location: ProjectLocation; projects: Project[] }
  >();
  for (const p of filtered.value) {
    const location = locationFor(p);
    if (!location) continue;
    const key = locationKey(location);
    const group = groups.get(key);
    if (group) group.projects.push(p);
    else groups.set(key, { location, projects: [p] });
  }
  return groups;
});
const mapPoints = computed(() =>
  [...cityGroups.value.values()].map(({ location, projects: items }) => {
    const active = items.find((p) => p.id === selectedId.value) ?? items[0]!;
    return {
      id: locationKey(location),
      name:
        (locale.value === "en"
          ? englishPlace(location.district || location.city || "Selected point")
          : location.district || location.city || t("Selected point")) +
        (items.length > 1 ? ` · ${items.length}` : ""),
      precision: location.precision,
      cityId: location.cityId,
      latitude: location.latitude,
      longitude: location.longitude,
      color: stageColor(active.stage),
      confirmed: locationFor(active)?.confirmed ?? false,
    };
  }),
);
const cityProjects = computed(() =>
  currentLocation.value
    ? (cityGroups.value.get(locationKey(currentLocation.value))?.projects ?? [])
    : [],
);
const canSave = computed(
  () =>
    !!currentLocation.value &&
    !!selected.value &&
    !dirtyText.value[selected.value.id] &&
    !aiProjectId.value &&
    !saving.value &&
    !store.busy &&
    (!currentLocation.value.confirmed ||
      !!pendingLocations.value[selected.value.id]),
);
const sourceLabel = computed(
  () =>
    ({
      name: "Name matching",
      text: "Text matching",
      map: "Map selection",
      ai: "AI suggestion",
    })[currentLocation.value?.source ?? "name"],
);

function chooseProject(id: string, fromTour = false) {
  if (!fromTour) pauseTour();
  needsProjectFocus = viewMode.value !== "project";
  viewMode.value = "project";
  editingLocation.value = !!pendingLocations.value[id] || !!dirtyText.value[id];
  if (selectedId.value === id) {
    needsProjectFocus = false;
    void focusSelectedCity();
  }
  selectedId.value = id;
}
function chooseCityMarker(id: string) {
  const group = cityGroups.value.get(id);
  if (!group) return;
  const activeIndex = group.projects.findIndex(
    (p) => p.id === selectedId.value,
  );
  chooseProject(group.projects[(activeIndex + 1) % group.projects.length]!.id);
}
function stepProject(direction: number) {
  if (!orderedProjects.value.length) return;
  const index = orderedProjects.value.findIndex(
    (p) => p.id === selectedId.value,
  );
  chooseProject(
    orderedProjects.value[
      (index + direction + orderedProjects.value.length) %
        orderedProjects.value.length
    ]!.id,
  );
}
function chooseCity(candidate: CityCandidate) {
  if (!selected.value || locationBusy.value) return;
  pauseTour();
  viewMode.value = "project";
  pendingLocations.value[selected.value.id] = {
    ...candidate.location,
    source: candidateSources.value[selected.value.id] ?? "name",
    confirmed: false,
  };
  dirtyText.value[selected.value.id] = false;
  error.value = "";
  notice.value = t("Location is unsaved");
}
function locateText() {
  const project = selected.value;
  if (!project || locationBusy.value) return;
  pauseTour();
  const result = resolveLocationText(textDrafts.value[project.id] ?? "");
  alternatives.value[project.id] = result.candidates;
  candidateSources.value[project.id] = "text";
  error.value = "";
  if (result.status === "matched" && result.location) {
    viewMode.value = "project";
    pendingLocations.value[project.id] = result.location;
    dirtyText.value[project.id] = false;
    notice.value = t("Location is unsaved");
  } else {
    notice.value = "";
    error.value = t(
      result.status === "ambiguous"
        ? "More than one location found. Choose the project location."
        : "No reliable location found. Enter an address, district or city, or pick a point on the globe.",
    );
  }
}
function pickLocation(position: { latitude: number; longitude: number }) {
  if (!picking.value || !selected.value || locationBusy.value) return;
  pauseTour();
  pendingLocations.value[selected.value.id] = pointLocation(
    position.latitude,
    position.longitude,
    "map",
    t("Manually selected map coordinates"),
  );
  dirtyText.value[selected.value.id] = false;
  alternatives.value[selected.value.id] = [];
  picking.value = false;
  error.value = "";
  notice.value = t("Location is unsaved");
}
async function saveCity() {
  const p = selected.value;
  const location = currentLocation.value;
  if (!p || !location || !canSave.value) return;
  pauseTour();
  saving.value = true;
  error.value = "";
  try {
    const fields = Object.fromEntries(
      Object.keys(projectInput.shape).map((key) => [
        key,
        key === "location"
          ? { ...location, confirmed: true }
          : p[key as keyof Project],
      ]),
    );
    await store.saveProject(projectInput.parse(fields), p);
    if (!alive) return;
    delete pendingLocations.value[p.id];
    delete textDrafts.value[p.id];
    delete dirtyText.value[p.id];
    delete alternatives.value[p.id];
    if (selectedId.value === p.id)
      notice.value = t("Location saved for {name}", { name: mapText(p.name) });
  } catch (e) {
    if (alive && selectedId.value === p.id)
      error.value =
        e instanceof Error
          ? t(e.message)
          : t("Location could not be saved. Your selection is still here.");
  } finally {
    saving.value = false;
  }
}
async function recognizeWithAi() {
  const p = selected.value;
  if (!p || locationBusy.value || !aiEnabled.value) return;
  pauseTour();
  aiProjectId.value = p.id;
  picking.value = false;
  error.value = "";
  notice.value = "";
  try {
    const result = await api.analyzeProjectLocation(p.id, p.version, true);
    if (!alive) return;
    if (projects.value.find((item) => item.id === p.id)?.version !== p.version)
      throw new Error("Project changed during recognition. Please try again.");
    alternatives.value[p.id] = result.candidates;
    candidateSources.value[p.id] = result.provider === "qwen" ? "ai" : "name";
    if (result.location) pendingLocations.value[p.id] = result.location;
    if (selectedId.value === p.id)
      notice.value = t(
        result.status === "matched"
          ? "Location is unsaved"
          : result.status === "ambiguous"
            ? "More than one location found. Choose the project location."
            : "No reliable location found. Enter an address, district or city, or pick a point on the globe.",
      );
  } catch (e) {
    if (alive && selectedId.value === p.id)
      error.value =
        e instanceof Error
          ? t(e.message)
          : t("AI location recognition failed. You can enter a city manually.");
  } finally {
    aiProjectId.value = "";
  }
}
async function recognizeCities() {
  pauseTour();
  recognizing.value = true;
  try {
    const matches = projects.value.filter((p) => {
      const candidate = inferred.value.get(p.id)?.location;
      return (
        !!candidate &&
        (!p.location?.confirmed ||
          (p.location.precision === "city" &&
            candidate.precision === "district"))
      );
    });
    if (matches[0]) {
      search.value = "";
      stage.value = "";
      chooseProject(matches[0].id);
      editingLocation.value = true;
      const first = matches[0];
      const finer = inferred.value.get(first.id)?.location;
      if (
        finer?.precision === "district" &&
        first.location?.precision === "city" &&
        !pendingLocations.value[first.id] &&
        !dirtyText.value[first.id]
      )
        pendingLocations.value[first.id] = finer;
    }
    notice.value = t(
      "{count} location candidates found. Confirm each project before saving.",
      { count: matches.length },
    );
  } finally {
    recognizing.value = false;
  }
}
</script>

<template>
  <section
    class="project-atlas"
    :class="{ 'is-ready': sceneReady }"
    :style="{ '--atlas-offset': store.mode === 'local' ? '84px' : '52px' }"
    aria-labelledby="atlas-title"
  >
    <div class="atlas-earth">
      <ProjectEarth
        ref="earth"
        :points="mapPoints"
        :selected-id="currentLocation ? locationKey(currentLocation) : null"
        :picking="picking"
        @select="chooseCityMarker"
        @pick="pickLocation"
        @error="globeError = $event"
        @ready="earthReady"
        @interact="exploreMap"
      />
    </div>
    <header class="atlas-heading">
      <p class="atlas-eyebrow">PROJECT ATLAS</p>
      <h1 id="atlas-title">{{ t("Project atlas") }}</h1>
      <div class="atlas-breadcrumb">
        <span>{{ t("Headquarters · Ningbo") }}</span
        ><span>/</span
        ><span>{{
          viewMode === "overview"
            ? t("Project network")
            : viewMode === "project" && currentLocation
              ? placeLabel(currentLocation)
              : t("Explore the map")
        }}</span>
      </div>
      <div class="atlas-base">
        {{ t("Connected from Ningbo. Built together.") }}
      </div>
      <div class="atlas-counts">
        <span
          ><strong>{{ projects.length }}</strong
          >{{ t("Projects") }}</span
        >
        <span
          :title="
            t('Includes location candidates; review in location management.')
          "
          ><strong>{{ coverage.cities }}</strong
          >{{ t("Cities covered") }}</span
        >
        <span
          ><strong>{{ coverage.implementation }}</strong
          >{{ stageLabel("implementation") }}</span
        >
        <span
          ><strong>{{ coverage.operations }}</strong
          >{{ stageLabel("operations") }}</span
        >
      </div>
    </header>

    <div class="atlas-actions">
      <button
        class="atlas-icon"
        :aria-label="t('Show project search')"
        :aria-expanded="showSearch"
        @click="showSearch = !showSearch"
      >
        <PhMagnifyingGlass :size="19" />
      </button>
      <button
        class="atlas-location-toggle"
        :aria-expanded="editingLocation"
        :disabled="!selected"
        @click="editLocation"
      >
        <PhMapPin :size="17" />{{ t("Location management") }}
        <span
          v-if="counts.pending + counts.missing"
          class="atlas-location-count"
          >{{ counts.pending + counts.missing }}</span
        >
      </button>
      <button
        class="atlas-primary atlas-tour"
        :class="{ active: touring }"
        :aria-pressed="touring"
        :disabled="
          !touring && (tourProjects.length < 2 || hasDraft || locationBusy)
        "
        :title="
          hasDraft
            ? t('Save location changes before starting the tour.')
            : t('Tours alternate cities. Editing or dragging pauses the tour.')
        "
        @click="toggleTour"
      >
        <PhPause v-if="touring" :size="18" /><PhPlay v-else :size="18" />
        {{ t(touring ? "Pause tour" : "Start project tour") }}
      </button>
    </div>
    <div v-if="showSearch" class="atlas-search">
      <PhMagnifyingGlass :size="18" />
      <input
        v-model="search"
        data-global-search
        :aria-label="t('Search projects or cities')"
        :placeholder="t('Search projects or cities')"
      />
      <select v-model="stage" :aria-label="t('Filter by stage')">
        <option value="">{{ t("All stages") }}</option>
        <option v-for="s in mapStages" :key="s.id" :value="s.id">
          {{ stageLabel(s.id) }}
        </option>
      </select>
      <button
        class="atlas-icon"
        :aria-label="t('Clear project search')"
        @click="
          search = '';
          stage = '';
          showSearch = false;
        "
      >
        <PhX :size="16" />
      </button>
    </div>

    <div v-if="picking" class="atlas-pick-hint" role="status">
      <PhCrosshair :size="19" />
      <div>
        <strong>{{ t("Select the project location on the globe") }}</strong
        ><small>{{
          t(
            "Map clicks preserve the selected coordinates. Zoom in and verify before saving.",
          )
        }}</small>
      </div>
      <button
        class="atlas-icon"
        :aria-label="t('Cancel map selection')"
        @click="picking = false"
      >
        <PhX :size="18" />
      </button>
    </div>

    <div
      v-if="selected"
      class="atlas-card-stack"
      :class="{ 'is-picking': picking }"
      :style="{ '--card-accent': stageColor(selected.stage) }"
    >
      <div class="atlas-card-back atlas-card-back--far" aria-hidden="true" />
      <div class="atlas-card-back atlas-card-back--near" aria-hidden="true" />
      <Transition name="atlas-detail" mode="out-in">
        <aside
          :key="selected.id"
          class="atlas-inspector"
          :class="{ 'is-picking': picking }"
          :aria-label="mapText(selected.name)"
          @pointerdown="pauseTour"
          @focusin="pauseTour"
        >
          <div class="inspector-navigation">
            <span
              >{{ t("Project") }}
              {{ orderedProjects.findIndex((p) => p.id === selectedId) + 1 }} /
              {{ orderedProjects.length }}</span
            >
            <div>
              <button
                class="atlas-icon"
                :aria-label="t('Previous project')"
                @click="stepProject(-1)"
              >
                <PhCaretLeft :size="16" /></button
              ><button
                class="atlas-icon"
                :aria-label="t('Next project')"
                @click="stepProject(1)"
              >
                <PhCaretRight :size="16" />
              </button>
            </div>
          </div>
          <div class="atlas-project-title">
            <h2>{{ mapText(selected.name) }}</h2>
            <span
              class="atlas-stage"
              :style="{
                color: stageColor(selected.stage),
                borderColor: stageColor(selected.stage) + '70',
              }"
              >{{ stageLabel(selected.stage) }}</span
            >
          </div>
          <p class="atlas-address">
            <PhMapPin :size="16" />{{
              currentLocation
                ? placeLabel(currentLocation)
                : t("Choose a location for this project")
            }}
          </p>
          <p v-if="cityProjects.length > 1" class="atlas-place-index">
            {{
              t("Project {index} / {count} at this location", {
                index: cityProjects.findIndex((p) => p.id === selectedId) + 1,
                count: cityProjects.length,
              })
            }}
          </p>
          <dl class="atlas-project-facts">
            <div>
              <dt>{{ t("Project owner") }}</dt>
              <dd>
                {{
                  locale === "en"
                    ? romanizeName(t(selectedOwner))
                    : t(selectedOwner)
                }}
              </dd>
            </div>
            <div v-if="selected.client">
              <dt>{{ t("Client") }}</dt>
              <dd>{{ mapText(selected.client) }}</dd>
            </div>
          </dl>
          <p
            v-if="locale === 'en' && translation.pending.value.length"
            class="atlas-translation-status"
            role="status"
          >
            {{
              translation.busy.value || (aiEnabled && !translation.failed.value)
                ? "Translating project content… Names may temporarily use romanization."
                : "English translation unavailable. Names use romanization."
            }}
            <button
              v-if="aiEnabled && translation.failed.value"
              type="button"
              @click="translation.retry"
            >
              Retry translation
            </button>
          </p>
          <div class="atlas-progress-summary">
            <p class="atlas-summary-label">{{ t("Latest project update") }}</p>
            <p>
              {{
                selected.latestUpdate
                  ? mapText(selected.latestUpdate, "text")
                  : t("No update reported yet.")
              }}
            </p>
          </div>
          <div class="atlas-location-summary">
            <span
              :class="{
                'needs-review': !currentLocation?.confirmed || selectedHasDraft,
              }"
            >
              <PhMapPin :size="14" />
              {{
                selectedHasDraft
                  ? t("Location is unsaved")
                  : currentLocation
                    ? t(locationPrecisionLabel(currentLocation)) +
                      " · " +
                      t(
                        currentLocation.confirmed
                          ? "Confirmed"
                          : "Awaiting confirmation",
                      )
                    : t("Not located")
              }}
            </span>
            <button
              :aria-expanded="editingLocation"
              :aria-controls="`location-editor-${selected.id}`"
              @click="editLocation"
            >
              <PhPencilSimple :size="14" />{{ t("Edit location")
              }}<PhCaretDown :size="12" :class="{ rotated: editingLocation }" />
            </button>
          </div>
          <div
            v-if="editingLocation"
            :id="`location-editor-${selected.id}`"
            class="atlas-recognition"
          >
            <div class="atlas-location-management">
              <p>{{ t("Location management") }}</p>
              <span
                >{{ counts.confirmed }} {{ t("Confirmed") }} ·
                {{ counts.pending }} {{ t("Location candidates") }} ·
                {{ counts.missing }} {{ t("Not located") }}</span
              >
              <button
                :disabled="recognizing || !projects.length"
                @click="recognizeCities"
              >
                <PhSpinnerGap
                  v-if="recognizing"
                  :size="16"
                  class="spin"
                /><PhSparkle v-else :size="16" />{{
                  t(
                    recognizing
                      ? "Recognizing locations…"
                      : "Recognize locations",
                  )
                }}
              </button>
            </div>
            <div class="recognition-label">
              <PhSparkle :size="17" />{{
                t(
                  currentLocation?.source === "ai"
                    ? "AI location recognition"
                    : "Location recognition",
                )
              }}
            </div>
            <p
              v-if="currentLocation"
              class="location-state"
              :class="{ confirmed: currentLocation.confirmed }"
            >
              <PhCheckCircle
                v-if="currentLocation.confirmed"
                :size="18"
              /><PhWarningCircle v-else :size="18" />{{
                t(locationPrecisionLabel(currentLocation)) +
                " · " +
                t(
                  currentLocation.confirmed
                    ? "Confirmed"
                    : "Awaiting confirmation",
                )
              }}
            </p>
            <p v-else class="atlas-unlocated">
              {{
                t(
                  "No reliable location found. Enter an address, district or city, or pick a point on the globe.",
                )
              }}
            </p>
            <p v-if="currentLocation" class="atlas-evidence">
              <span>{{ t(sourceLabel) }}</span
              ><span :title="mapText(currentLocation.evidence, 'text')">{{
                currentLocation.evidence
                  ? mapText(currentLocation.evidence, "text")
                  : t("Project information")
              }}</span>
            </p>
            <form @submit.prevent="locateText">
              <label class="sr-only" :for="`city-${selected.id}`">{{
                t("Address, district or city")
              }}</label>
              <input
                :id="`city-${selected.id}`"
                v-model="textDrafts[selected.id]"
                :placeholder="t('Enter a city, district or address…')"
                autocomplete="off"
                :disabled="locationBusy"
                @input="
                  dirtyText[selected.id] = !!textDrafts[selected.id]?.trim()
                "
              />
              <div class="atlas-locate-actions">
                <button
                  type="submit"
                  :disabled="locationBusy || !textDrafts[selected.id]?.trim()"
                >
                  <PhTextT :size="19" />{{ t("Locate from text") }}</button
                ><button
                  type="button"
                  :class="{ active: picking }"
                  :aria-pressed="picking"
                  :disabled="locationBusy || !!globeError"
                  @click="
                    picking = !picking;
                    error = '';
                  "
                >
                  <PhCrosshair :size="18" />{{
                    t(picking ? "Cancel map selection" : "Pick on globe")
                  }}
                </button>
              </div>
            </form>
            <div
              v-if="candidates.length > 1"
              class="atlas-candidates"
              :aria-label="t('Project location candidates')"
            >
              <button
                v-for="candidate in candidates"
                :key="locationKey(candidate.location)"
                :disabled="locationBusy"
                :class="{
                  active:
                    currentLocation &&
                    locationKey(currentLocation) ===
                      locationKey(candidate.location),
                }"
                @click="chooseCity(candidate)"
              >
                <PhMapPin :size="15" /><span>{{
                  placeLabel(candidate.location)
                }}</span
                ><PhCheckCircle
                  v-if="
                    currentLocation &&
                    locationKey(currentLocation) ===
                      locationKey(candidate.location)
                  "
                  :size="16"
                />
              </button>
            </div>
            <div v-if="aiEnabled" class="atlas-ai-option">
              <button
                type="button"
                :disabled="locationBusy || !!dirtyText[selected.id]"
                @click="recognizeWithAi"
              >
                <PhSpinnerGap
                  v-if="aiProjectId === selected.id"
                  :size="17"
                  class="spin"
                />
                <PhSparkle v-else :size="17" />
                {{
                  t(
                    aiProjectId === selected.id
                      ? "Recognizing locations…"
                      : "AI locate this project",
                  )
                }}
              </button>
              <p class="atlas-precision">
                {{
                  t(
                    "Sends this project's name, customer and description to the configured AI model. Confirm the result before saving.",
                  )
                }}
              </p>
            </div>
            <button
              class="atlas-primary atlas-confirm"
              :disabled="!canSave"
              @click="saveCity"
            >
              <PhSpinnerGap
                v-if="saving"
                :size="18"
                class="spin"
              /><PhCheckCircle
                v-else-if="
                  currentLocation?.confirmed && !pendingLocations[selected.id]
                "
                :size="18"
              />{{
                t(
                  saving
                    ? "Saving location…"
                    : currentLocation?.confirmed &&
                        !pendingLocations[selected.id]
                      ? "Location confirmed"
                      : "Confirm location",
                )
              }}
            </button>
            <p class="atlas-precision">
              {{
                t(
                  currentLocation?.precision === "point"
                    ? "User-selected coordinates. Accuracy depends on the selected point; zoom in and verify before saving."
                    : currentLocation?.precision === "district"
                      ? "District reference point, not the precise project address."
                      : "City center, not the project address.",
                )
              }}
            </p>
            <p v-if="error" class="atlas-message error" role="alert">
              {{ mapText(error, "text") }}
            </p>
            <p v-else-if="notice" class="atlas-message" role="status">
              {{ mapText(notice, "text") }}
            </p>
          </div>
          <div v-if="cityProjects.length > 1" class="atlas-same-city">
            <small>{{
              t("{count} projects at this location", {
                count: cityProjects.length,
              })
            }}</small>
            <div>
              <button
                v-for="p in cityProjects"
                :key="p.id"
                :class="{ active: p.id === selected.id }"
                @click="chooseProject(p.id)"
              >
                {{ mapText(p.name) }}
              </button>
            </div>
          </div>
          <RouterLink
            class="atlas-project-link"
            :to="`/projects/${selected.id}`"
            >{{ t("Open project details") }}<PhArrowRight :size="16"
          /></RouterLink>
        </aside>
      </Transition>
    </div>
    <div v-else class="atlas-empty">
      <PhGlobeHemisphereEast :size="36" />
      <h2>
        {{
          t(
            projects.length
              ? "No matching projects"
              : "No projects on the map yet",
          )
        }}
      </h2>
      <p>
        {{
          t(
            projects.length
              ? "Try a different search or clear your filters."
              : "Projects with a city will appear here. Add a project to get started.",
          )
        }}
      </p>
      <button
        v-if="projects.length"
        @click="
          search = '';
          stage = '';
        "
      >
        {{ t("Clear filters") }}</button
      ><RouterLink v-else to="/projects"
        >{{ t("Projects") }}<PhArrowRight :size="16"
      /></RouterLink>
    </div>

    <nav
      v-if="filtered.length"
      class="atlas-project-rail"
      :aria-label="t('Projects list')"
    >
      <button
        v-for="p in orderedProjects"
        :key="p.id"
        :style="{ '--project-color': stageColor(p.stage) }"
        :class="{ selected: p.id === selectedId }"
        :aria-current="p.id === selectedId ? 'true' : undefined"
        @click="chooseProject(p.id)"
      >
        <strong>{{ mapText(p.shortName || p.name) }}</strong
        ><span
          ><i :style="{ background: stageColor(p.stage) }"></i
          >{{ locationFor(p) ? placeLabel(locationFor(p)!) : t("Not located")
          }}<span class="rail-status">{{
            t(
              locationFor(p)?.confirmed
                ? "Confirmed cities"
                : locationFor(p)
                  ? "Location candidates"
                  : "",
            )
          }}</span></span
        >
      </button>
    </nav>
    <footer class="atlas-footer">
      <div
        class="atlas-legend"
        :aria-label="t('Colors show project stages')"
        :title="t('Markers and connections follow the current project stage.')"
      >
        <span class="atlas-legend-label">{{ t("Stage colors") }}</span>
        <button
          v-for="s in mapStages"
          :key="s.id"
          :class="{ active: stage === s.id }"
          :aria-pressed="stage === s.id"
          @click="stage = stage === s.id ? '' : s.id"
        >
          <i :style="{ background: stageColor(s.id) }"></i
          >{{ stageLabel(s.id) }}
        </button>
      </div>
      <div class="atlas-map-controls">
        <select
          v-model="tourInterval"
          class="atlas-tour-speed"
          :aria-label="t('Tour speed')"
        >
          <option :value="5000">{{ t("Presentation · 5s") }}</option>
          <option :value="2000">{{ t("Quick tour · 2s") }}</option>
        </select>
        <button
          :class="{ active: viewMode === 'overview' }"
          @click="showOverview"
        >
          <PhMapPin :size="18" /><span>{{ t("Project overview") }}</span>
        </button>
        <button
          class="atlas-icon"
          :aria-label="t('Back to globe')"
          :title="t('Back to globe')"
          @click="
            exploreMap();
            earth?.reset();
          "
        >
          <PhGlobeHemisphereEast :size="20" /></button
        ><button
          class="atlas-icon"
          :aria-label="t('Zoom out on globe')"
          @click="
            exploreMap();
            earth?.zoomOut();
          "
        >
          <PhMinus :size="18" /></button
        ><button
          class="atlas-icon"
          :aria-label="t('Zoom in on globe')"
          @click="
            exploreMap();
            earth?.zoomIn();
          "
        >
          <PhPlus :size="18" /></button
        ><button
          v-if="currentLocation"
          class="atlas-icon"
          :aria-label="t('Focus on project location')"
          @click="
            pauseTour();
            viewMode = 'project';
            focusSelectedCity();
          "
        >
          <PhCrosshair :size="19" />
        </button>
      </div>
      <span class="atlas-coordinates">{{
        t("Location coordinates · WGS84")
      }}</span>
    </footer>
  </section>
</template>

<style scoped>
.atlas-translation-status {
  color: var(--atlas-muted, #a8bdcc);
  font-size: 12px;
  line-height: 1.6;
}
.atlas-translation-status button {
  color: #79e9d7;
  margin-left: 6px;
}
.project-atlas {
  --atlas-text: #edf4fa;
  --atlas-muted: #a9bdd0;
  --atlas-mint: #71e2d5;
  position: relative;
  isolation: isolate;
  height: calc(100dvh - var(--atlas-offset));
  min-height: 680px;
  overflow: hidden;
  background: #07121f;
  color: var(--atlas-text);
  font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.atlas-earth {
  position: absolute;
  inset: 0 0 52px;
  z-index: -1;
}
.atlas-heading {
  position: absolute;
  left: 36px;
  top: 30px;
  pointer-events: none;
  text-shadow: 0 2px 18px #020d1b;
}
.project-atlas.is-ready .atlas-card-stack {
  animation: atlas-summary-arrive 0.4s 0.65s both;
}
@keyframes atlas-summary-arrive {
  from {
    transform: translateY(10px);
  }
  to {
    transform: translateY(0);
  }
}
.atlas-eyebrow {
  color: #94b5ce;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 3px;
  margin: 0 0 9px;
}
.atlas-heading h1 {
  font-size: clamp(28px, 2.6vw, 43px);
  letter-spacing: 1px;
  line-height: 1.15;
  margin: 0 0 13px;
  font-weight: 700;
}
.atlas-breadcrumb {
  display: flex;
  align-items: center;
  gap: 13px;
  font-size: 12px;
  color: #d2dfeb;
}
.atlas-breadcrumb > span:nth-child(even) {
  color: #859cb0;
}
.atlas-counts {
  display: flex;
  gap: 18px;
  align-items: baseline;
  margin-top: 22px;
}
.atlas-counts > span {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: #c3d1de;
}
.atlas-counts strong {
  font-size: 24px;
  line-height: 1;
  font-weight: 600;
  color: #f1f7ff;
  font-variant-numeric: tabular-nums;
}
.atlas-counts > span:first-child strong {
  color: var(--atlas-mint);
}
.atlas-counts .pending-count strong {
  color: #f0c673;
}
.project-atlas button,
.project-atlas input,
.project-atlas select {
  font-family: inherit;
  font-size: 13px;
}
.project-atlas button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  border: 1px solid #3d5870;
  border-radius: 5px;
  color: #e6f0fa;
  background: #102236e6;
  cursor: pointer;
  transition:
    border-color 0.16s,
    background 0.16s,
    color 0.16s;
}
.project-atlas button:hover:not(:disabled) {
  border-color: #7ed4d2;
  background: #1b354a;
}
.project-atlas button:focus-visible,
.project-atlas a:focus-visible,
.project-atlas input:focus-visible,
.project-atlas select:focus-visible {
  outline: 2px solid var(--atlas-mint);
  outline-offset: 3px;
}
.project-atlas button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.project-atlas .atlas-primary {
  border-color: #6bddcf;
  background: #6bddcf;
  color: #07282d;
  font-weight: 650;
  padding: 10px 17px;
  min-height: 42px;
}
.project-atlas .atlas-primary:hover:not(:disabled) {
  background: #9cebdd;
  border-color: #9cebdd;
}
.project-atlas .atlas-icon {
  padding: 7px;
  min-width: 34px;
  min-height: 34px;
}
.atlas-actions {
  position: absolute;
  top: 32px;
  right: 32px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.atlas-location-toggle {
  min-height: 42px;
  font-size: 12px;
}
.atlas-location-count {
  color: #f0cd91;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.atlas-project-facts {
  display: grid;
  gap: 10px;
  margin: 22px 0;
  font-size: 13px;
}
.atlas-project-facts > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.atlas-project-facts dt {
  color: #9fb4c8;
  flex-shrink: 0;
}
.atlas-project-facts dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}
.atlas-progress-summary {
  border-top: 1px solid #354d62;
  padding-top: 20px;
  margin-bottom: 24px;
}
.atlas-summary-label {
  margin: 0 0 10px;
  font-size: 11px;
  color: #94dbd0;
}
.atlas-progress-summary > p:last-child {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: #e1eaf4;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
}
.atlas-location-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid #354d62;
}
.atlas-location-summary > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #a9c6d0;
  font-size: 11px;
}
.atlas-location-summary > .needs-review {
  color: #edc37c;
}
.project-atlas .atlas-location-summary button {
  min-height: 36px;
  padding: 6px 8px;
  font-size: 11px;
  border-color: transparent;
  background: transparent;
}
.atlas-location-summary .rotated {
  transform: rotate(180deg);
}
.atlas-location-management {
  margin-bottom: 22px;
  padding: 12px;
  border-radius: 6px;
  background: #152b3d;
}
.atlas-location-management p {
  margin: 0 0 7px;
  font-size: 12px;
  color: #e2edf8;
}
.atlas-location-management > span {
  display: block;
  font-size: 11px;
  color: #b5c9dc;
}
.atlas-location-management button {
  margin-top: 12px;
  width: 100%;
  font-size: 12px;
}
.atlas-search {
  position: absolute;
  top: 206px;
  left: 36px;
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: calc(100% - 450px);
  padding: 7px 10px;
  border: 1px solid #365269;
  border-radius: 6px;
  background: #0d1b2eeb;
  color: #afc6d8;
}
.project-atlas input,
.project-atlas select {
  background: #15273a;
  border: 1px solid #3e556b;
  color: #e7f0f9;
  border-radius: 5px;
  box-shadow: none;
}
.project-atlas input::placeholder {
  color: #9eafbf;
}
.atlas-search input {
  min-width: 80px;
  width: 210px;
  padding: 7px;
  border: 0;
  background: transparent;
}
.atlas-search select {
  width: auto;
  max-width: 150px;
  padding: 7px 24px 7px 8px;
}
.atlas-search .atlas-icon {
  border: 0;
  background: transparent;
}
.atlas-card-stack {
  position: absolute;
  top: 108px;
  right: 32px;
  width: 342px;
  max-height: calc(max(680px, 100dvh - var(--atlas-offset)) - 254px);
  isolation: isolate;
}
.atlas-card-back {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border: 1px solid #3c596c;
  border-radius: 9px;
  background: #0b1c2c;
  transform-origin: 50% 95%;
}
.atlas-card-back--near {
  transform: translate(-7px, -5px) rotate(-1deg);
  opacity: 0.7;
}
.atlas-card-back--far {
  transform: translate(-14px, -10px) rotate(-2deg);
  opacity: 0.35;
}
.atlas-inspector {
  position: relative;
  max-height: inherit;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid #476076;
  border-top-color: var(--card-accent, #476076);
  border-radius: 9px;
  background: #0d1b2ef5;
  box-shadow: 0 12px 40px #0003;
  padding: 20px 23px;
  scrollbar-width: thin;
  scrollbar-color: #476076 transparent;
  backface-visibility: hidden;
  transform-origin: 50% 90%;
}
.inspector-navigation {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #9eb4c7;
  font-size: 10px;
  margin-bottom: 14px;
}
.inspector-navigation > div {
  display: flex;
  gap: 4px;
}
.inspector-navigation .atlas-icon {
  background: transparent;
  border-color: transparent;
  min-height: 26px;
  padding: 3px;
}
.atlas-project-title {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.atlas-project-title h2 {
  font-size: 23px;
  line-height: 1.4;
  margin: 0;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.atlas-stage {
  display: inline-flex;
  border: 1px solid;
  border-radius: 4px;
  font-size: 10px;
  line-height: 18px;
  padding: 1px 7px;
  margin-top: 5px;
  white-space: nowrap;
}
.atlas-address {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: 13px;
  color: #c2d2e1;
  margin: 14px 0 22px;
  line-height: 1.5;
}
.atlas-address svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.atlas-place-index {
  margin: -10px 0 18px;
  color: #94dbd0;
  font-size: 11px;
}
.atlas-base {
  color: #a8dcd3;
  font-size: 10px;
  letter-spacing: 0.08em;
  margin-top: 12px;
}
.atlas-ai-option {
  margin-top: 12px;
}
.atlas-ai-option button {
  width: 100%;
  min-height: 38px;
}
.atlas-ai-option .atlas-precision {
  margin-top: 8px;
}
.atlas-recognition {
  padding-top: 20px;
}
.recognition-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #cad8e6;
}
.recognition-label svg {
  color: #87e0d7;
}
.location-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #f0c471;
  font-size: 14px;
  font-weight: 600;
  margin: 13px 0 10px;
}
.location-state.confirmed {
  color: #8bdcc0;
}
.atlas-evidence {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #9fb4c8;
  font-size: 11px;
  line-height: 1.6;
  margin: 0 0 19px;
}
.atlas-evidence span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.atlas-unlocated {
  font-size: 12px;
  color: #b6c6d8;
  line-height: 1.8;
  margin: 12px 0 20px;
}
.atlas-recognition input {
  width: 100%;
  height: 46px;
  padding: 12px;
}
.atlas-locate-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}
.atlas-locate-actions button {
  min-height: 43px;
  padding: 6px;
}
.atlas-locate-actions button.active {
  color: #8aede2;
  border-color: #75e4d7;
  background: #153c45;
}
.project-atlas .atlas-confirm {
  width: 100%;
  min-height: 44px;
  margin-top: 12px;
  font-size: 14px;
}
.atlas-precision {
  font-size: 11px;
  color: #a9bbcc;
  line-height: 1.7;
  margin: 16px 0 0;
}
.atlas-message {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: #9be3d0;
}
.atlas-message.error {
  color: #ffbfac;
}
.atlas-candidates {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.atlas-candidates button {
  justify-content: flex-start;
  padding: 8px;
}
.atlas-candidates button.active {
  border-color: #75e4d7;
  color: #8aede2;
}
.atlas-same-city {
  padding-top: 16px;
  margin-top: 16px;
  border-top: 1px solid #354d62;
}
.atlas-same-city small {
  font-size: 11px;
  color: #9fb4c8;
}
.atlas-same-city > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.atlas-same-city button {
  min-height: 28px;
  padding: 4px 7px;
  font-size: 10px;
}
.atlas-same-city button.active {
  border-color: #78ded4;
  color: #85e5da;
}
.atlas-project-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
  color: #8ac5ef;
  font-size: 11px;
  text-decoration: none;
}
.atlas-pick-hint {
  position: absolute;
  top: 215px;
  left: 36px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 15px;
  max-width: min(540px, calc(100% - 460px));
  border: 1px solid #71e2d5;
  border-radius: 8px;
  background: #0d2336ef;
  color: #bcf1e8;
}
.atlas-pick-hint strong {
  font-size: 13px;
  font-weight: 500;
}
.atlas-pick-hint small {
  display: block;
  color: #b4c8d8;
  margin-top: 5px;
  font-size: 11px;
}
.atlas-empty {
  position: absolute;
  top: 240px;
  right: 36px;
  max-width: 340px;
  padding: 25px;
  border: 1px solid #34536c;
  border-radius: 8px;
  background: #0e1f32e8;
}
.atlas-empty svg {
  color: #70ddd0;
}
.atlas-empty h2 {
  font-size: 21px;
  line-height: 1.5;
}
.atlas-empty p {
  color: #a9bdd0;
  font-size: 13px;
  line-height: 1.8;
}
.atlas-empty a {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #84dfd4;
}
.atlas-project-rail {
  position: absolute;
  bottom: 52px;
  left: 0;
  right: 0;
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: #37546b transparent;
  padding: 0 22px;
  height: 88px;
  background: #0b1b2cdc;
  border-top: 1px solid #3c566870;
}
.project-atlas .atlas-project-rail button {
  flex: 0 0 230px;
  max-width: 280px;
  flex-direction: column;
  align-items: flex-start;
  gap: 9px;
  border: 0;
  border-top: 2px solid transparent;
  border-right: 1px solid #30485b;
  padding: 15px 22px;
  border-radius: 0;
  background: transparent;
  text-align: left;
}
.atlas-project-rail button.selected {
  border-top-color: var(--project-color);
  background: #19344966;
}
.atlas-project-rail button strong {
  width: 100%;
  font-size: 13px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.atlas-project-rail button > span {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #b4c7d7;
}
.atlas-project-rail i,
.atlas-legend i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.rail-status {
  color: #92aabd;
  padding-left: 3px;
}
.atlas-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 0 28px;
  background: #0a1727;
  border-top: 1px solid #30475b;
}
.atlas-legend {
  display: flex;
  align-items: center;
  gap: 15px;
  min-width: 0;
}
.atlas-legend-label {
  font-size: 10px;
  color: #91a8bd;
  white-space: nowrap;
}
.project-atlas .atlas-legend button {
  min-height: 30px;
  padding: 0;
  gap: 7px;
  border: 0;
  background: transparent;
  font-size: 10px;
  color: #b9cbdc;
  white-space: nowrap;
}
.atlas-legend button.active {
  color: #fff;
  text-decoration: underline;
  text-underline-offset: 5px;
}
.atlas-map-controls {
  display: flex;
  gap: 6px;
  margin-left: auto;
  align-items: center;
  flex-shrink: 0;
}
.atlas-map-controls button {
  min-height: 33px;
  padding: 5px 10px;
  border-radius: 18px;
  font-size: 11px;
}
.atlas-map-controls > .active {
  border-color: #71e2d5;
  color: #a1eee2;
}
.project-atlas .atlas-tour-speed {
  min-height: 33px;
  width: auto;
  max-width: 145px;
  padding: 4px 24px 4px 10px;
  font-size: 11px;
  border-radius: 18px;
}
.atlas-map-controls .atlas-tour.active {
  border-color: #71e2d5;
  color: #a1eee2;
  background: #16423f;
}
.atlas-coordinates {
  font-size: 10px;
  color: #92a9be;
  white-space: nowrap;
}
.atlas-detail-enter-active {
  transition:
    opacity 0.24s ease,
    transform 0.38s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform, opacity;
}
.atlas-detail-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.18s cubic-bezier(0.4, 0, 1, 1);
  pointer-events: none;
  will-change: transform, opacity;
}
.atlas-detail-enter-from {
  opacity: 0;
  transform: perspective(1200px) translate3d(-15px, 8px, -35px) rotateY(-13deg)
    rotateZ(-2deg);
}
.atlas-detail-leave-to {
  opacity: 0;
  transform: perspective(1200px) translate3d(22px, -5px, 10px) rotateY(12deg)
    rotateZ(2deg);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (min-width: 1700px) {
  .atlas-card-stack {
    width: 390px;
    top: 110px;
  }
  .atlas-inspector {
    padding: 24px 28px;
  }
  .atlas-project-title h2 {
    font-size: 26px;
  }
  .atlas-recognition {
    padding-top: 25px;
  }
  .atlas-address {
    margin-bottom: 25px;
  }
}
@media (max-width: 1100px) {
  .atlas-heading {
    left: 24px;
  }
  .atlas-actions,
  .atlas-card-stack {
    right: 22px;
  }
  .atlas-card-stack {
    width: 316px;
  }
  .atlas-inspector {
    padding: 17px 20px;
  }
  .atlas-project-title h2 {
    font-size: 21px;
  }
  .atlas-coordinates {
    display: none;
  }
  .atlas-footer {
    padding: 0 20px;
    gap: 12px;
  }
  .atlas-legend {
    gap: 10px;
  }
  .atlas-legend-label {
    display: none;
  }
}
@media (min-width: 761px) and (max-width: 900px) {
  .atlas-footer {
    height: 86px;
    flex-wrap: wrap;
    gap: 0;
    align-content: center;
  }
  .atlas-map-controls {
    width: 100%;
    justify-content: flex-end;
  }
  .atlas-legend {
    order: 2;
    width: 100%;
  }
  .atlas-project-rail {
    bottom: 86px;
  }
  .atlas-earth {
    bottom: 86px;
  }
  .atlas-card-stack {
    max-height: calc(max(680px, 100dvh - var(--atlas-offset)) - 288px);
  }
}
@media (max-width: 760px) {
  .atlas-map-controls {
    flex-wrap: wrap;
  }
  .project-atlas {
    height: auto;
    min-height: calc(100dvh - var(--atlas-offset));
    overflow: visible;
    display: flex;
    flex-direction: column;
    padding-top: 390px;
  }
  .atlas-earth {
    height: 480px;
    bottom: auto;
  }
  .atlas-heading {
    top: 24px;
    left: 20px;
  }
  .atlas-heading h1 {
    font-size: 28px;
  }
  .atlas-eyebrow {
    font-size: 8px;
  }
  .atlas-breadcrumb {
    font-size: 10px;
    gap: 8px;
  }
  .atlas-counts {
    gap: 11px;
    margin-top: 17px;
  }
  .atlas-counts > span {
    font-size: 10px;
    gap: 5px;
  }
  .atlas-counts strong {
    font-size: 19px;
  }
  .atlas-actions {
    top: 190px;
    left: 20px;
    right: 20px;
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .atlas-actions .atlas-primary {
    margin-left: auto;
  }
  .atlas-actions .atlas-location-toggle {
    min-height: 34px;
    font-size: 11px;
    padding: 6px 9px;
  }
  .atlas-actions .atlas-primary {
    padding: 8px 10px;
    font-size: 11px;
    min-height: 34px;
  }
  .atlas-actions .atlas-primary svg {
    width: 15px;
  }
  .atlas-search {
    top: 235px;
    left: 14px;
    right: 14px;
    max-width: none;
  }
  .atlas-search input {
    width: 100%;
  }
  .atlas-search select {
    max-width: 115px;
  }
  .atlas-card-stack {
    position: relative;
    top: auto;
    right: auto;
    width: auto;
    max-height: none;
    margin: 0 14px 16px;
  }
  .atlas-card-back--near {
    transform: translate(-3px, -4px) rotate(-0.5deg);
  }
  .atlas-card-back--far {
    transform: translate(-6px, -8px) rotate(-1deg);
  }
  .atlas-inspector {
    padding: 17px 20px;
    backdrop-filter: none;
    background: #0d1c2ff5;
  }
  .atlas-card-stack.is-picking {
    margin-top: 60px;
  }
  .atlas-project-title h2 {
    font-size: 22px;
  }
  .atlas-pick-hint {
    top: 235px;
    left: 14px;
    right: 14px;
    max-width: none;
    z-index: 2;
  }
  .atlas-empty {
    position: relative;
    top: auto;
    right: auto;
    margin: 0 14px 20px;
    max-width: none;
  }
  .atlas-project-rail {
    position: relative;
    bottom: auto;
    height: 79px;
    flex-shrink: 0;
    padding: 0 7px;
  }
  .project-atlas .atlas-project-rail button {
    flex-basis: 192px;
    padding: 12px 15px;
  }
  .atlas-footer {
    position: relative;
    height: auto;
    padding: 13px 16px;
    flex-wrap: wrap;
    gap: 12px;
  }
  .atlas-legend {
    order: 2;
    width: 100%;
    flex-wrap: wrap;
    column-gap: 13px;
    row-gap: 0;
  }
  .atlas-map-controls {
    margin-left: 0;
  }
  .atlas-coordinates {
    display: block;
    margin-left: auto;
    font-size: 9px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .project-atlas.is-ready .atlas-card-stack {
    animation: none;
  }
  .atlas-detail-enter-active,
  .atlas-detail-leave-active,
  .project-atlas button {
    transition: none;
  }
  .atlas-detail-enter-from,
  .atlas-detail-leave-to {
    transform: none;
  }
}
</style>
