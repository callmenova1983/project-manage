import * as THREE from "three";
import { projectCities } from "../../../../packages/domain/project-location";

export type EarthPrecision = "city" | "district" | "point";
export interface EarthFocusOptions {
  duration?: number;
  precision?: EarthPrecision;
}

export interface EarthPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color: string;
  confirmed?: boolean;
  precision?: EarthPrecision;
  /** Parent city for persistent city-level routes; exact project coordinates stay independent. */
  cityId?: string;
}
interface Callbacks {
  onSelect: (id: string) => void;
  onPick: (location: { latitude: number; longitude: number }) => void;
  onReady: () => void;
  onError: (message: string) => void;
  onInteract?: () => void;
}
export interface EarthScene {
  setLanguage(language: "en" | "zh-CN"): void;
  setPoints(points: EarthPoint[]): void;
  setSelected(id: string | null): void;
  setPicking(picking: boolean): void;
  overview(options?: { duration?: number }): void;
  startIntro(): void;
  reset(): void;
  zoomIn(): void;
  zoomOut(): void;
  focusPoint(id: string, options?: EarthFocusOptions): void;
  highlightPoint(id: string): void;
  dispose(): void;
}
type View = {
  latitude: number;
  longitude: number;
  height: number;
  tilt?: number;
};
const RADIUS = 5;
const DEFAULT_VIEW: View = { latitude: 29.8, longitude: 120.6, height: 1.1 };
const ENTRY_VIEW: View = { latitude: 23, longitude: 115, height: 6.5 };
const DEG = Math.PI / 180;
const ARC_SEGMENTS = 80;
const CITY_ARC_SEGMENTS = 64;
const SCAN_ANGLES = 24;
const SCAN_RINGS = 8;
export const EARTH_HEADQUARTERS = projectCities.find(
  (city) => city.id === "ningbo",
)!;

/** Never infer a free map point's city from its coordinates. */
export function earthRouteCities(points: readonly EarthPoint[]) {
  const ids = new Set(
    points.map(
      (point) =>
        point.cityId ||
        (point.id.startsWith("city:")
          ? point.id.slice(5)
          : point.precision !== "district" && point.precision !== "point"
            ? point.id
            : ""),
    ),
  );
  return projectCities
    .filter((city) => city.id !== EARTH_HEADQUARTERS.id && ids.has(city.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function earthFocusHeight(precision: EarthPrecision = "city") {
  return precision === "point" ? 0.42 : precision === "district" ? 0.5 : 0.8;
}

/** A replayable, single breath that settles; reduced motion has no pulse. */
export function earthLandingPulse(elapsed: number, reducedMotion = false) {
  if (reducedMotion || elapsed < 0 || elapsed >= 900) return 0;
  return Math.sin((elapsed / 900) * Math.PI);
}

/** A finite sweep, followed by a settled route; never a continuously spinning radar. */
export function earthScanProgress(elapsed: number, reducedMotion = false) {
  const progress = THREE.MathUtils.clamp(elapsed / 1050, 0, 1);
  return {
    rotation: THREE.MathUtils.smoothstep(progress, 0, 0.8),
    opacity:
      reducedMotion || elapsed < 0 || elapsed >= 1050
        ? 0
        : Math.sin(progress * Math.PI) * 0.2,
    route: reducedMotion ? 1 : THREE.MathUtils.clamp(elapsed / 650, 0, 1),
  };
}

function placeEarthCamera(camera: THREE.PerspectiveCamera, view: View) {
  const normal = earthPosition(view.latitude, view.longitude, 1);
  const north = earthNorth(view.latitude, view.longitude);
  const regional = 1 - THREE.MathUtils.smoothstep(view.height, 2.3, 8);
  camera.position
    .copy(normal)
    .multiplyScalar(RADIUS + view.height)
    .addScaledVector(north, -view.height * (view.tilt ?? 1.05) * regional);
  camera.up.copy(north);
  camera.lookAt(normal.multiplyScalar(RADIUS * regional));
  camera.updateMatrixWorld();
  return regional;
}

function setEarthViewport(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
) {
  camera.aspect = width / height;
  camera.setViewOffset(
    width,
    height,
    width >= 900 ? width * 0.105 : 0,
    -height * (width < 700 ? 0.14 : 0.01),
    width,
    height,
  );
  camera.updateProjectionMatrix();
}

/** Fit the real network including its headquarters, leaving room for the title/card/rail. */
export function earthOverviewView(
  points: readonly EarthPoint[],
  width = 1440,
  height = 900,
): View {
  const locations = [
    EARTH_HEADQUARTERS,
    ...points.filter(
      (point) =>
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude) &&
        Math.abs(point.latitude) <= 90 &&
        Math.abs(point.longitude) <= 180,
    ),
    ...earthRouteCities(points),
  ];
  if (locations.length === 1) return { ...DEFAULT_VIEW };
  const longitudes = locations.map(
    (point) =>
      EARTH_HEADQUARTERS.longitude +
      THREE.MathUtils.euclideanModulo(
        point.longitude - EARTH_HEADQUARTERS.longitude + 180,
        360,
      ) -
      180,
  );
  const minLat = Math.min(...locations.map((point) => point.latitude));
  const maxLat = Math.max(...locations.map((point) => point.latitude));
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  // A network covering opposite hemispheres cannot all face the camera at once.
  if (maxLon - minLon > 110 || maxLat - minLat > 85)
    return { latitude: 23, longitude: 115, height: 10 };
  const view = {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    height: 0.55,
    tilt: 0.72,
  };
  const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
  width = Math.max(1, width);
  height = Math.max(1, height);
  setEarthViewport(camera, width, height);
  const positions = locations.map((point) =>
    earthPosition(point.latitude, point.longitude, RADIUS + 0.014),
  );
  const projected = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const right = width >= 1100 ? width - 430 : width - 40;
  const top =
    width < 700 ? Math.min(250, height * 0.52) : Math.min(200, height * 0.26);
  const bottom =
    width < 700 ? height * 0.78 : height - Math.min(150, height * 0.2);
  for (; view.height < 10; view.height *= 1.12) {
    placeEarthCamera(camera, view);
    if (
      positions.every((position) => {
        projected.copy(position).project(camera);
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        return (
          toCamera.copy(camera.position).sub(position).dot(position) > 0.004 &&
          projected.z > -1 &&
          projected.z < 1 &&
          x > 40 &&
          x < right &&
          y > top &&
          y < bottom
        );
      })
    )
      return view;
  }
  return { ...view, height: 10 };
}

/** Keep geographic decorations legible without allowing close zooms to inflate them. */
export function earthScreenScale(
  camera: THREE.PerspectiveCamera,
  position: THREE.Vector3,
  worldRadius: number,
  pixelRadius: number,
  viewportHeight: number,
) {
  const inverse = camera.matrixWorldInverse.elements;
  const depth = Math.max(
    0.001,
    -(
      inverse[2] * position.x +
      inverse[6] * position.y +
      inverse[10] * position.z +
      inverse[14]
    ),
  );
  return (
    (pixelRadius * 2 * depth * Math.tan((camera.fov * DEG) / 2)) /
    (Math.max(1, viewportHeight) * worldRadius)
  );
}

/** Matches SphereGeometry's equirectangular UVs: Greenwich +X, east toward -Z. */
export function earthPosition(
  latitude: number,
  longitude: number,
  radius = RADIUS,
) {
  const lat = latitude * DEG;
  const lon = longitude * DEG;
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon),
  );
}
export function earthCoordinates(point: THREE.Vector3) {
  return {
    latitude:
      Math.asin(THREE.MathUtils.clamp(point.y / point.length(), -1, 1)) / DEG,
    longitude: Math.atan2(-point.z, point.x) / DEG,
  };
}

/** Analytic local north remains orthogonal and nonzero at either pole. */
export function earthNorth(latitude: number, longitude: number) {
  return earthPosition(latitude + 90, longitude, 1);
}

/** Writes an elevated great-circle arc in place; close points never pass under the surface. */
export function writeEarthArc(
  positions: Float32Array,
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  if (positions.length < 6 || positions.length % 3 !== 0)
    throw new RangeError(
      "An Earth arc needs at least two three-dimensional vertices.",
    );
  const start = earthPosition(from.latitude, from.longitude, 1);
  const end = earthPosition(to.latitude, to.longitude, 1);
  const angle = start.angleTo(end);
  const rotation = new THREE.Quaternion().setFromUnitVectors(start, end);
  const step = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const lift = Math.min(0.72, angle * RADIUS * 0.18);
  const count = positions.length / 3;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    step.identity().slerp(rotation, t);
    position
      .copy(start)
      .applyQuaternion(step)
      .multiplyScalar(RADIUS + 0.014 + Math.sin(Math.PI * t) * lift)
      .toArray(positions, i * 3);
  }
  return angle;
}

/** Samples the reused polyline buffer without allocating per animation frame. */
export function sampleEarthArc(
  positions: Float32Array,
  progress: number,
  target: THREE.Vector3,
) {
  const index =
    THREE.MathUtils.clamp(progress, 0, 1) * (positions.length / 3 - 1);
  const left = Math.floor(index) * 3;
  const right = Math.min(left + 3, positions.length - 3);
  const t = index - Math.floor(index);
  return target.set(
    THREE.MathUtils.lerp(positions[left], positions[right], t),
    THREE.MathUtils.lerp(positions[left + 1], positions[right + 1], t),
    THREE.MathUtils.lerp(positions[left + 2], positions[right + 2], t),
  );
}

export function createEarthScene(
  host: HTMLElement,
  callbacks: Callbacks,
): EarthScene {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x020b15, 1);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    "aria-label",
    "Drag to rotate the globe; scroll or use plus/minus to zoom; use arrow keys to move",
  );
  host.prepend(renderer.domElement);
  const labels = document.createElement("div");
  labels.className = "earth-label-layer";
  host.append(labels);
  const geometry = new THREE.SphereGeometry(RADIUS, 192, 128);
  const material = new THREE.ShaderMaterial({
    uniforms: { earthMap: { value: null }, loaded: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main(){ vUv=uv; vec4 p=modelViewMatrix*vec4(position,1.); vNormal=normalize(normalMatrix*normal); vView=normalize(-p.xyz); gl_Position=projectionMatrix*p; }`,
    fragmentShader: `uniform sampler2D earthMap; uniform float loaded; varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main(){ vec3 tex=texture2D(earthMap,vUv).rgb; float brightness=max(tex.r,max(tex.g,tex.b));
      vec3 land=tex*(.72-.2*smoothstep(.2,.8,brightness)) + vec3(.008,.024,.045)*(1.-smoothstep(.1,.55,brightness));
      float rim=pow(1.-max(dot(normalize(vNormal),normalize(vView)),0.),3.);
      vec3 color=mix(vec3(.004,.012,.025),land,loaded)+vec3(.015,.18,.31)*rim*.46;
      gl_FragColor=vec4(color,1.);\n #include <tonemapping_fragment>\n #include <colorspace_fragment>\n }`,
  });
  const earth = new THREE.Mesh(geometry, material);
  scene.add(earth);
  const atmosphereMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vNormal; varying vec3 vView; void main(){ vec4 p=modelViewMatrix*vec4(position,1.); vNormal=normalize(normalMatrix*normal); vView=normalize(-p.xyz); gl_Position=projectionMatrix*p; }`,
    fragmentShader: `varying vec3 vNormal; varying vec3 vView; void main(){ float rim=pow(max(0.,1.+dot(normalize(vNormal),normalize(vView))),4.); gl_FragColor=vec4(.08,.48,1.,rim*.5); }`,
  });
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 1.012, 128, 96),
    atmosphereMaterial,
  );
  scene.add(atmosphere);
  let disposed = false;
  let lost = false;
  let frame = 0;
  let hiddenAt = document.hidden ? performance.now() : undefined;
  let lastFrameTime: number | undefined;
  let animationTime = 0;
  let routeStartedAt = 0;
  let landingStartedAt = -900;
  let scanStartedAt = -1200;
  let introStartedAt = -1200;
  let overviewActive = false;
  let introPlayed = false;
  let language: "en" | "zh-CN" = "en";
  let texture: THREE.Texture | undefined;
  let selectedId: string | null = null;
  let picking = false;
  let width = 1;
  let height = 1;
  let view: View = { ...ENTRY_VIEW };
  let transition:
    | {
        from: View;
        to: View;
        started: number;
        duration: number;
        intro?: boolean;
      }
    | undefined;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const visibleLocations = new Map<string, { x: number; y: number }>();
  const pointObjects = new Map<
    string,
    { point: EarthPoint; position: THREE.Vector3; button: HTMLButtonElement }
  >();
  const vector = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const lineGeometry = new THREE.BufferGeometry();
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x54c4d5,
    opacity: 0.12,
    transparent: true,
    depthWrite: false,
  });
  // Geographic grid is real longitude/latitude geometry, kept deliberately subtle.
  const gridCoordinates: number[] = [];
  for (let lat = -60; lat <= 60; lat += 15)
    for (let lon = -180; lon < 180; lon += 2) {
      gridCoordinates.push(
        ...earthPosition(lat, lon, 5.003).toArray(),
        ...earthPosition(lat, lon + 2, 5.003).toArray(),
      );
    }
  for (let lon = -180; lon < 180; lon += 15)
    for (let lat = -88; lat < 88; lat += 2) {
      gridCoordinates.push(
        ...earthPosition(lat, lon, 5.003).toArray(),
        ...earthPosition(lat + 2, lon, 5.003).toArray(),
      );
    }
  lineGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(gridCoordinates, 3),
  );
  scene.add(new THREE.LineSegments(lineGeometry, lineMaterial));

  const selectionGeometry = new THREE.RingGeometry(0.018, 0.022, 64);
  const selectionMaterial = new THREE.MeshBasicMaterial({
    color: 0x6aeee0,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const selection = new THREE.Mesh(selectionGeometry, selectionMaterial);
  selection.visible = false;
  scene.add(selection);

  const headquartersPosition = earthPosition(
    EARTH_HEADQUARTERS.latitude,
    EARTH_HEADQUARTERS.longitude,
    RADIUS + 0.014,
  );
  const headquartersGeometry = new THREE.SphereGeometry(0.011, 12, 8);
  const headquartersMaterial = new THREE.MeshBasicMaterial({ color: 0x9affdf });
  const headquarters = new THREE.Mesh(
    headquartersGeometry,
    headquartersMaterial,
  );
  headquarters.name = "headquarters-marker";
  headquarters.position.copy(headquartersPosition);
  scene.add(headquarters);
  const headquartersLabel = document.createElement("div");
  headquartersLabel.className = "earth-hq-label";
  headquartersLabel.textContent = "Ningbo HQ · BASE";
  headquartersLabel.setAttribute(
    "aria-label",
    "Ningbo headquarters, city centre",
  );
  labels.append(headquartersLabel);

  // One reusable surface sector: the only extra draw call, visible for 1.05 seconds.
  const scanPositions = new Float32Array(SCAN_ANGLES * SCAN_RINGS * 6 * 3);
  const scanAlphas = new Float32Array(SCAN_ANGLES * SCAN_RINGS * 6);
  const scanGeometry = new THREE.BufferGeometry();
  const scanPositionAttribute = new THREE.BufferAttribute(
    scanPositions,
    3,
  ).setUsage(THREE.DynamicDrawUsage);
  scanGeometry.setAttribute("position", scanPositionAttribute);
  scanGeometry.setAttribute("alpha", new THREE.BufferAttribute(scanAlphas, 1));
  const scanMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      color: { value: new THREE.Color(0x79e9d7) },
      opacity: { value: 0 },
    },
    vertexShader: `attribute float alpha; varying float vAlpha; void main(){vAlpha=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform vec3 color; uniform float opacity; varying float vAlpha; void main(){gl_FragColor=vec4(color,vAlpha*opacity);\n #include <colorspace_fragment>\n }`,
  });
  const scan = new THREE.Mesh(scanGeometry, scanMaterial);
  scan.name = "headquarters-scan";
  scan.frustumCulled = false;
  scan.visible = false;
  scene.add(scan);
  const headquartersNormal = headquartersPosition.clone().normalize();
  const headquartersNorth = earthNorth(
    EARTH_HEADQUARTERS.latitude,
    EARTH_HEADQUARTERS.longitude,
  );
  const headquartersEast = new THREE.Vector3()
    .crossVectors(headquartersNorth, headquartersNormal)
    .normalize();
  const scanVertex = new THREE.Vector3();
  const scanTarget = new THREE.Vector3();
  let scanBearing = 0;
  function startScan(point?: EarthPoint) {
    if (reduced.matches) {
      scan.visible = false;
      return;
    }
    let extent = 0.055;
    if (point) {
      scanTarget.copy(earthPosition(point.latitude, point.longitude, 1));
      extent = headquartersNormal.angleTo(scanTarget) * 1.16;
      scanBearing = Math.atan2(
        scanTarget.dot(headquartersEast),
        scanTarget.dot(headquartersNorth),
      );
      scanMaterial.uniforms.color.value.set(point.color);
    } else {
      scanBearing = -0.4;
      for (const { point: location } of pointObjects.values())
        extent = Math.max(
          extent,
          headquartersNormal.angleTo(
            earthPosition(location.latitude, location.longitude, 1),
          ) * 1.16,
        );
      scanMaterial.uniforms.color.value.set(0x79e9d7);
    }
    extent = THREE.MathUtils.clamp(extent, 0.018, 0.45);
    let vertexIndex = 0;
    function writeVertex(radial: number, angular: number) {
      const angle = (angular - 0.5) * 0.52;
      const distance = radial * extent;
      scanVertex
        .copy(headquartersNormal)
        .multiplyScalar(Math.cos(distance))
        .addScaledVector(
          headquartersNorth,
          Math.sin(distance) * Math.cos(angle),
        )
        .addScaledVector(headquartersEast, Math.sin(distance) * Math.sin(angle))
        .multiplyScalar(RADIUS + 0.012);
      scanVertex.toArray(scanPositions, vertexIndex * 3);
      scanAlphas[vertexIndex++] =
        Math.pow(1 - radial, 0.65) * Math.sin(angular * Math.PI);
    }
    for (let ring = 0; ring < SCAN_RINGS; ring++)
      for (let angle = 0; angle < SCAN_ANGLES; angle++) {
        const r0 = ring / SCAN_RINGS,
          r1 = (ring + 1) / SCAN_RINGS;
        const a0 = angle / SCAN_ANGLES,
          a1 = (angle + 1) / SCAN_ANGLES;
        writeVertex(r0, a0);
        writeVertex(r1, a0);
        writeVertex(r1, a1);
        writeVertex(r0, a0);
        writeVertex(r1, a1);
        writeVertex(r0, a1);
      }
    scanPositionAttribute.needsUpdate = true;
    scanGeometry.getAttribute("alpha").needsUpdate = true;
    scanStartedAt = animationTime;
    scan.visible = true;
  }

  // Persistent, city-deduplicated routes share one static draw call and one buffer.
  // District/project markers retain their exact coordinates in the active route below.
  const cityRoutePositions = new Float32Array(
    projectCities.length * CITY_ARC_SEGMENTS * 2 * 3,
  );
  const cityRouteScratch = new Float32Array((CITY_ARC_SEGMENTS + 1) * 3);
  const cityRouteGeometry = new THREE.BufferGeometry();
  const cityRouteAttribute = new THREE.BufferAttribute(
    cityRoutePositions,
    3,
  ).setUsage(THREE.DynamicDrawUsage);
  cityRouteGeometry.setAttribute("position", cityRouteAttribute);
  cityRouteGeometry.setDrawRange(0, 0);
  const cityRouteMaterial = new THREE.LineBasicMaterial({
    color: 0x709ba6,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const cityRoutes = new THREE.LineSegments(
    cityRouteGeometry,
    cityRouteMaterial,
  );
  cityRoutes.name = "headquarters-city-routes";
  cityRoutes.frustumCulled = false;
  cityRoutes.visible = false;
  scene.add(cityRoutes);
  let cityRouteKey = "";
  function updateCityRoutes(points: EarthPoint[]) {
    const cities = earthRouteCities(points);
    const key = cities.map((city) => city.id).join("|");
    if (key === cityRouteKey) return;
    cityRouteKey = key;
    let cursor = 0;
    for (const city of cities) {
      writeEarthArc(cityRouteScratch, EARTH_HEADQUARTERS, city);
      for (let i = 0; i < CITY_ARC_SEGMENTS; i++) {
        for (let axis = 0; axis < 3; axis++)
          cityRoutePositions[cursor++] = cityRouteScratch[i * 3 + axis];
        for (let axis = 0; axis < 3; axis++)
          cityRoutePositions[cursor++] = cityRouteScratch[(i + 1) * 3 + axis];
      }
    }
    cityRouteGeometry.setDrawRange(0, cursor / 3);
    cityRouteAttribute.needsUpdate = true;
    cityRoutes.visible = cities.length > 0;
  }

  // Only the current precise project connection has a stage color and moving light.
  const arcPositions = new Float32Array((ARC_SEGMENTS + 1) * 3);
  const arcGeometry = new THREE.BufferGeometry();
  const arcAttribute = new THREE.BufferAttribute(arcPositions, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  arcGeometry.setAttribute("position", arcAttribute);
  const arcMaterial = new THREE.LineBasicMaterial({
    color: 0x74e9dc,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  const arc = new THREE.Line(arcGeometry, arcMaterial);
  arc.name = "headquarters-project-route";
  arc.visible = false;
  scene.add(arc);
  const flowGeometry = new THREE.BufferGeometry();
  const flowAttribute = new THREE.BufferAttribute(
    new Float32Array(3),
    3,
  ).setUsage(THREE.DynamicDrawUsage);
  flowGeometry.setAttribute("position", flowAttribute);
  const flowMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      color: { value: new THREE.Color(0x9affdf) },
      pointSize: { value: 14 * renderer.getPixelRatio() },
    },
    vertexShader: `uniform float pointSize; void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize=pointSize; }`,
    fragmentShader: `uniform vec3 color; void main(){ float d=length(gl_PointCoord-vec2(.5)); float a=pow(max(0.,1.-d*2.),2.); gl_FragColor=vec4(mix(color,vec3(1.),1.-smoothstep(.0,.16,d)),a*.9);\n #include <colorspace_fragment>\n }`,
  });
  const flow = new THREE.Points(flowGeometry, flowMaterial);
  // One moving vertex changes every frame; avoid recomputing its bounds on the CPU.
  flow.frustumCulled = false;
  flow.visible = false;
  scene.add(flow);
  const flowPosition = new THREE.Vector3();
  let routeKey = "";

  function updateRoute(point?: EarthPoint) {
    const nextKey = point
      ? `${point.id}:${point.latitude}:${point.longitude}:${point.color}`
      : "";
    if (nextKey === routeKey) return;
    routeKey = nextKey;
    if (!point) {
      arc.visible = false;
      flow.visible = false;
      return;
    }
    const angle = writeEarthArc(arcPositions, EARTH_HEADQUARTERS, point);
    arc.visible = flow.visible = angle > 1e-7;
    arcAttribute.needsUpdate = true;
    arcGeometry.computeBoundingSphere();
    arcMaterial.color.set(point.color);
    flowMaterial.uniforms.color.value.set(point.color);
    routeStartedAt = animationTime;
  }

  function cancelIntro() {
    introPlayed = true;
    if (!transition?.intro) return;
    transition = undefined;
    introStartedAt = animationTime - 1200;
    scanStartedAt = animationTime - 1200;
  }
  function revealIntro() {
    introStartedAt = animationTime;
    routeStartedAt = animationTime;
    startScan();
  }
  function move(to: View, duration = 700) {
    cancelIntro();
    // Shortest longitude path when crossing the date line.
    to.longitude =
      view.longitude +
      THREE.MathUtils.euclideanModulo(
        to.longitude - view.longitude + 180,
        360,
      ) -
      180;
    if (reduced.matches || duration <= 0) {
      view = { ...to };
      transition = undefined;
    } else
      transition = {
        from: { ...view },
        to,
        started: performance.now(),
        duration,
      };
  }
  function updateCamera() {
    const regional = placeEarthCamera(camera, view);
    lineMaterial.opacity = 0.055 + (1 - regional) * 0.08;
  }
  function overview(options?: { duration?: number }) {
    overviewActive = true;
    move(
      earthOverviewView(
        [...pointObjects.values()].map(({ point }) => point),
        width,
        height,
      ),
      options?.duration ?? 650,
    );
  }
  function resize() {
    width = Math.max(host.clientWidth, 1);
    height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    setEarthViewport(camera, width, height);
    if (overviewActive) overview({ duration: 0 });
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  function updateLabels() {
    visibleLocations.clear();
    const occupied: { x: number; y: number; w: number }[] = [];
    projected.copy(headquartersPosition).project(camera);
    vector.copy(camera.position).sub(headquartersPosition);
    const hqX = (projected.x * 0.5 + 0.5) * width;
    const hqY = (-projected.y * 0.5 + 0.5) * height;
    headquartersLabel.hidden =
      vector.dot(headquartersPosition) <= 0.004 ||
      projected.z < -1 ||
      projected.z > 1 ||
      hqX < 20 ||
      hqX > width - 120 ||
      hqY < 60 ||
      hqY > height - 65;
    if (!headquartersLabel.hidden) {
      headquartersLabel.style.transform = `translate3d(${hqX - 6}px,${hqY - 38}px,0)`;
      occupied.push({ x: hqX, y: hqY - 25, w: 105 });
    }
    const entries = [...pointObjects.values()].sort(
      (a, b) =>
        Number(b.point.id === selectedId) - Number(a.point.id === selectedId),
    );
    for (const { point, position, button } of entries) {
      vector.copy(camera.position).sub(position);
      const front = vector.dot(position) > 0.004;
      projected.copy(position).project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      const visible =
        front &&
        projected.z > -1 &&
        projected.z < 1 &&
        x > 20 &&
        x < width - 30 &&
        y > 30 &&
        y < height - 65;
      if (visible) visibleLocations.set(point.id, { x, y });
      const labelWidth = Math.min(180, 34 + point.name.length * 13);
      const inspectorCovered =
        width >= 1100 && x > width - 395 && y > 100 && y < height - 100;
      const collision = occupied.some(
        (p) =>
          Math.abs(p.y - y) < 35 &&
          x < p.x + p.w + 10 &&
          x + labelWidth > p.x - 10,
      );
      button.hidden = !visible || inspectorCovered;
      // Nearby cities retain their actual marker even when their label would overlap.
      // Never spread coordinates merely to improve composition.
      const text = button.lastElementChild as HTMLElement;
      text.hidden = collision && point.id !== selectedId;
      button.title = point.name;
      if (!button.hidden) {
        button.style.transform = `translate3d(${x - 6}px,${y - 14}px,0)`;
        occupied.push({ x, y, w: text.hidden ? 14 : labelWidth });
      }
    }
  }
  function render(time: number) {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    if (lastFrameTime !== undefined)
      animationTime += Math.max(0, time - lastFrameTime);
    lastFrameTime = time;
    if (transition) {
      const t = THREE.MathUtils.clamp(
        (time - transition.started) / transition.duration,
        0,
        1,
      );
      const eased = t * t * (3 - 2 * t);
      view = {
        latitude: THREE.MathUtils.lerp(
          transition.from.latitude,
          transition.to.latitude,
          eased,
        ),
        longitude: THREE.MathUtils.lerp(
          transition.from.longitude,
          transition.to.longitude,
          eased,
        ),
        height: THREE.MathUtils.lerp(
          transition.from.height,
          transition.to.height,
          eased,
        ),
        tilt: THREE.MathUtils.lerp(
          transition.from.tilt ?? 1.05,
          transition.to.tilt ?? 1.05,
          eased,
        ),
      };
      if (t === 1) {
        const arrived = transition.intro;
        transition = undefined;
        if (arrived) revealIntro();
      }
    }
    updateCamera();
    headquarters.scale.setScalar(
      earthScreenScale(camera, headquartersPosition, 0.011, 7, height),
    );
    const sweep = earthScanProgress(
      animationTime - scanStartedAt,
      reduced.matches,
    );
    scan.visible = sweep.opacity > 0;
    if (scan.visible) {
      scan.quaternion.setFromAxisAngle(
        headquartersNormal,
        -(scanBearing - (1 - sweep.rotation) * 100 * DEG),
      );
      scanMaterial.uniforms.opacity.value = sweep.opacity;
    }
    const introProgress = reduced.matches
      ? 1
      : THREE.MathUtils.smoothstep(animationTime - introStartedAt, 180, 1000);
    cityRouteMaterial.opacity = 0.6 * introProgress;
    arcMaterial.visible = flowMaterial.visible = !transition?.intro;
    if (arc.visible) {
      const routeProgress = earthScanProgress(
        animationTime - routeStartedAt,
        reduced.matches,
      ).route;
      arcGeometry.setDrawRange(
        0,
        Math.max(2, Math.ceil(routeProgress * ARC_SEGMENTS) + 1),
      );
    }
    if (selection.visible) {
      const pulse = earthLandingPulse(
        animationTime - landingStartedAt,
        reduced.matches,
      );
      selection.scale.setScalar(
        earthScreenScale(
          camera,
          selection.position,
          0.022,
          16 + pulse * 6,
          height,
        ),
      );
      selectionMaterial.opacity = 0.32 + pulse * 0.24;
    }
    if (flow.visible) {
      const progress = reduced.matches
        ? 0.65
        : Math.min(1, ((animationTime - routeStartedAt) % 1900) / 1600);
      sampleEarthArc(arcPositions, progress, flowPosition);
      flowAttribute.setXYZ(0, flowPosition.x, flowPosition.y, flowPosition.z);
      flowAttribute.needsUpdate = true;
    }
    updateLabels();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  }
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}earth/black-marble-2016.jpg`,
    (loaded) => {
      if (disposed) {
        loaded.dispose();
        return;
      }
      texture = loaded;
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      material.uniforms.earthMap.value = loaded;
      material.uniforms.loaded.value = 1;
      callbacks.onReady();
    },
    undefined,
    () => {
      if (!disposed)
        callbacks.onError(
          "Earth imagery failed to load. Refresh to retry; project locations remain available in the list.",
        );
    },
  );

  let drag:
    | {
        id: number;
        x: number;
        y: number;
        lastX: number;
        lastY: number;
        moved: boolean;
      }
    | undefined;
  function down(event: PointerEvent) {
    if (event.button !== 0) return;
    callbacks.onInteract?.();
    overviewActive = false;
    cancelIntro();
    transition = undefined;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
    renderer.domElement.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    drag.moved ||=
      Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5;
    if (drag.moved) {
      const speed = 0.025 * Math.max(0.6, view.height);
      view.longitude -= (event.clientX - drag.lastX) * speed;
      view.latitude = THREE.MathUtils.clamp(
        view.latitude + (event.clientY - drag.lastY) * speed,
        -78,
        78,
      );
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  }
  function up(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    const clicked = !drag.moved;
    drag = undefined;
    if (renderer.domElement.hasPointerCapture(event.pointerId))
      renderer.domElement.releasePointerCapture(event.pointerId);
    if (!clicked) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (!picking) {
      let nearest: { id: string; distance: number } | undefined;
      for (const [id, position] of visibleLocations) {
        const distance = Math.hypot(position.x - x, position.y - y);
        if (distance < 24 && (!nearest || nearest.distance > distance))
          nearest = { id, distance };
      }
      if (nearest) {
        callbacks.onSelect(nearest.id);
        return;
      }
    }
    if (!picking) return;
    pointer.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(earth)[0];
    if (hit) callbacks.onPick(earthCoordinates(hit.point));
  }
  function cancel() {
    drag = undefined;
  }
  function zoom(multiplier: number) {
    overviewActive = false;
    move(
      {
        ...view,
        height: THREE.MathUtils.clamp(view.height * multiplier, 0.2, 15),
      },
      450,
    );
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    callbacks.onInteract?.();
    zoom(event.deltaY > 0 ? 1.12 : 0.89);
  }
  function key(event: KeyboardEvent) {
    if (event.key === "+" || event.key === "=") zoom(0.75);
    else if (event.key === "-") zoom(1.3);
    else if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      overviewActive = false;
      const delta = Math.max(view.height, 1) * 0.8;
      move(
        {
          ...view,
          longitude:
            view.longitude +
            (event.key === "ArrowLeft"
              ? -delta
              : event.key === "ArrowRight"
                ? delta
                : 0),
          latitude: THREE.MathUtils.clamp(
            view.latitude +
              (event.key === "ArrowUp"
                ? delta
                : event.key === "ArrowDown"
                  ? -delta
                  : 0),
            -78,
            78,
          ),
        },
        180,
      );
    } else return;
    callbacks.onInteract?.();
    event.preventDefault();
  }
  function visibilityChanged() {
    if (document.hidden) {
      hiddenAt = performance.now();
      lastFrameTime = undefined;
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      const now = performance.now();
      if (hiddenAt !== undefined && transition)
        transition.started += now - Math.max(hiddenAt, transition.started);
      hiddenAt = undefined;
      if (!disposed && !lost && !frame) frame = requestAnimationFrame(render);
    }
  }
  function motionPreferenceChanged() {
    if (reduced.matches && transition) {
      const arrived = transition.intro;
      view = { ...transition.to };
      transition = undefined;
      if (arrived) revealIntro();
    }
  }
  function contextLost(event: Event) {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frame);
    callbacks.onError(
      "The 3D graphics connection was interrupted. Refresh to restore the map.",
    );
  }
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("keydown", key);
  canvas.addEventListener("webglcontextlost", contextLost);
  document.addEventListener("visibilitychange", visibilityChanged);
  reduced.addEventListener("change", motionPreferenceChanged);
  if (!document.hidden) frame = requestAnimationFrame(render);

  function setSelected(id: string | null) {
    selectedId = id;
    for (const { point, button } of pointObjects.values()) {
      button.classList.toggle("is-selected", point.id === id);
      button.setAttribute("aria-pressed", String(point.id === id));
    }
    const selected = id ? pointObjects.get(id) : undefined;
    updateRoute(selected?.point);
    selection.visible = Boolean(selected);
    if (selected) {
      selection.position.copy(selected.position).multiplyScalar(1.0004);
      selection.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        selected.position.clone().normalize(),
      );
      selectionMaterial.color.set(selected.point.color);
    }
  }
  function highlightPoint(id: string) {
    if (!pointObjects.has(id)) return;
    cancelIntro();
    setSelected(id);
    // Replay even when two projects share the same exact location and color.
    // Camera and geographic position intentionally stay unchanged.
    routeStartedAt = animationTime;
    landingStartedAt = animationTime;
    startScan(pointObjects.get(id)!.point);
  }
  function pointLabel(point: EarthPoint) {
    return language === "en"
      ? `${point.name}, ${point.confirmed ? "confirmed" : "unconfirmed"} location`
      : `${point.name}，${point.confirmed ? "已确认" : "待确认"}位置`;
  }
  return {
    setLanguage(value) {
      language = value;
      headquartersLabel.textContent =
        value === "en" ? "Ningbo HQ · BASE" : "宁波总部 · BASE";
      headquartersLabel.setAttribute(
        "aria-label",
        value === "en"
          ? "Ningbo headquarters, city centre"
          : "宁波总部，城市中心位置",
      );
      canvas.setAttribute(
        "aria-label",
        value === "en"
          ? "Drag to rotate the globe; scroll or use plus/minus to zoom; use arrow keys to move"
          : "拖动旋转地球，滚轮缩放，方向键移动，加减键缩放",
      );
      for (const { point, button } of pointObjects.values())
        button.setAttribute("aria-label", pointLabel(point));
    },
    setPoints(points) {
      const validPoints = points.filter(
        (point) =>
          Number.isFinite(point.latitude) &&
          Number.isFinite(point.longitude) &&
          Math.abs(point.latitude) <= 90 &&
          Math.abs(point.longitude) <= 180,
      );
      const nextIds = new Set(validPoints.map((point) => point.id));
      updateCityRoutes(validPoints);
      for (const [id, object] of pointObjects)
        if (!nextIds.has(id)) {
          object.button.remove();
          pointObjects.delete(id);
        }
      for (const point of validPoints) {
        let entry = pointObjects.get(point.id);
        if (!entry) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "earth-city-label";
          const dot = document.createElement("i");
          dot.className = "earth-city-dot";
          dot.setAttribute("aria-hidden", "true");
          button.append(dot, document.createElement("span"));
          button.addEventListener("click", () => {
            if (!picking) {
              callbacks.onInteract?.();
              callbacks.onSelect(point.id);
            }
          });
          labels.append(button);
          entry = {
            point,
            position: earthPosition(
              point.latitude,
              point.longitude,
              RADIUS + 0.009,
            ),
            button,
          };
          pointObjects.set(point.id, entry);
        }
        entry.point = point;
        entry.position.copy(
          earthPosition(point.latitude, point.longitude, RADIUS + 0.009),
        );
        entry.button.style.setProperty("--point-color", point.color);
        entry.button.style.pointerEvents = picking ? "none" : "auto";
        entry.button.tabIndex = picking ? -1 : 0;
        entry.button.lastElementChild!.textContent = point.name;
        entry.button.setAttribute("aria-label", pointLabel(point));
      }
      setSelected(selectedId);
      if (overviewActive) overview({ duration: 0 });
    },
    setSelected,
    overview,
    startIntro() {
      if (introPlayed) return;
      overviewActive = false;
      move({ ...ENTRY_VIEW }, 0);
      move(
        {
          latitude: EARTH_HEADQUARTERS.latitude,
          longitude: EARTH_HEADQUARTERS.longitude,
          height: earthFocusHeight("city"),
        },
        1500,
      );
      if (transition) {
        transition.intro = true;
        // Briefly establish the globe, then advance using the existing RAF.
        transition.started += 180;
        introStartedAt = Infinity;
        scanStartedAt = animationTime - 1200;
      } else revealIntro();
    },
    setPicking(value) {
      picking = value;
      labels.style.pointerEvents = value ? "none" : "";
      for (const { button } of pointObjects.values()) {
        button.style.pointerEvents = value ? "none" : "auto";
        button.tabIndex = value ? -1 : 0;
      }
    },
    reset() {
      callbacks.onInteract?.();
      overviewActive = false;
      move({ latitude: 23, longitude: 115, height: 10 }, 1800);
    },
    zoomIn() {
      callbacks.onInteract?.();
      zoom(0.75);
    },
    zoomOut() {
      callbacks.onInteract?.();
      zoom(1.3);
    },
    focusPoint(id, options) {
      const point = pointObjects.get(id)?.point;
      if (point) {
        overviewActive = false;
        highlightPoint(id);
        move(
          {
            latitude: point.latitude,
            longitude: point.longitude,
            height: earthFocusHeight(options?.precision ?? point.precision),
          },
          options?.duration ?? 700,
        );
      }
    },
    highlightPoint,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
      reduced.removeEventListener("change", motionPreferenceChanged);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("keydown", key);
      canvas.removeEventListener("webglcontextlost", contextLost);
      labels.remove();
      geometry.dispose();
      material.dispose();
      atmosphere.geometry.dispose();
      atmosphereMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      selectionGeometry.dispose();
      selectionMaterial.dispose();
      headquartersGeometry.dispose();
      headquartersMaterial.dispose();
      scanGeometry.dispose();
      scanMaterial.dispose();
      cityRouteGeometry.dispose();
      cityRouteMaterial.dispose();
      arcGeometry.dispose();
      arcMaterial.dispose();
      flowGeometry.dispose();
      flowMaterial.dispose();
      texture?.dispose();
      renderer.dispose();
      canvas.remove();
      pointObjects.clear();
    },
  };
}
