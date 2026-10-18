import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  createEarthScene,
  EARTH_HEADQUARTERS,
  earthCoordinates,
  earthPosition,
  type EarthScene,
} from "../../apps/web/src/services/earth-scene";
import { projectCities } from "../../packages/domain/project-location";

const rendering = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("three", async (original) => {
  const actual = await original<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      capabilities = { getMaxAnisotropy: () => 1 };
      setPixelRatio() {}
      getPixelRatio() {
        return 1;
      }
      setClearColor() {}
      setSize() {}
      render = rendering.render;
      dispose() {}
    },
    TextureLoader: class {
      load() {}
    },
  };
});

// The state test uses actual Three geometry/material/camera objects, mocking only
// the GPU and minimal DOM surface. No browser or WebGL installation is needed.
class ElementStub {
  children: ElementStub[] = [];
  parent?: ElementStub;
  className = "";
  hidden = false;
  textContent = "";
  clientWidth = 1743;
  clientHeight = 798;
  properties = new Map<string, string>();
  attributes = new Map<string, string>();
  style = {
    setProperty: (key: string, value: string) =>
      this.properties.set(key, value),
  };
  classList = { toggle: vi.fn() };
  get lastElementChild() {
    return this.children.at(-1);
  }
  append(...items: ElementStub[]) {
    for (const item of items) {
      item.parent = this;
      this.children.push(item);
    }
  }
  prepend(item: ElementStub) {
    item.parent = this;
    this.children.unshift(item);
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (item) => item !== this,
      );
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  addEventListener() {}
  removeEventListener() {}
}

describe("Earth selection rendering state", () => {
  let controller: EarthScene;
  let host: ElementStub;
  let queued: FrameRequestCallback | undefined;
  let resizeHost: () => void;
  let now = 0;
  let motionChanged: () => void;
  let media: {
    matches: boolean;
    addEventListener(event: string, callback: () => void): void;
    removeEventListener(): void;
  };
  function frame(time: number) {
    now = time;
    const callback = queued;
    queued = undefined;
    callback?.(time);
  }
  function objects() {
    const [scene, camera] = rendering.render.mock.lastCall as [
      THREE.Scene,
      THREE.PerspectiveCamera,
    ];
    return {
      camera,
      headquarters: scene.getObjectByName("headquarters-marker") as THREE.Mesh<
        THREE.SphereGeometry,
        THREE.MeshBasicMaterial
      >,
      scan: scene.getObjectByName("headquarters-scan") as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.ShaderMaterial
      >,
      cityRoutes: scene.getObjectByName(
        "headquarters-city-routes",
      ) as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>,
      arc: scene.children.find((item) => item.type === "Line") as THREE.Line<
        THREE.BufferGeometry,
        THREE.LineBasicMaterial
      >,
      flow: scene.children.find(
        (item) => item.type === "Points",
      ) as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>,
      selection: scene.children.find(
        (item) =>
          item instanceof THREE.Mesh && item.geometry.type === "RingGeometry",
      ) as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>,
    };
  }
  const city = {
    id: "city:hangzhou",
    name: "杭州",
    latitude: 30.27,
    longitude: 120.16,
    color: "#70b6ff",
  };
  function mountScene(focus = true) {
    controller = createEarthScene(host as unknown as HTMLElement, {
      onSelect() {},
      onPick() {},
      onReady() {},
      onError() {},
    });
    controller.setPoints([city]);
    controller.setSelected(city.id);
    if (focus) controller.focusPoint(city.id, { duration: 0 });
    frame(now);
  }
  function freshEntry() {
    controller.dispose();
    mountScene(false);
  }
  function screenRadius(mesh: THREE.Mesh, camera: THREE.PerspectiveCamera) {
    mesh.updateMatrixWorld();
    const center = mesh.position.clone().project(camera);
    const vertex = new THREE.Vector3();
    const positions = mesh.geometry.getAttribute("position");
    let radius = 0;
    for (let index = 0; index < positions.count; index++) {
      vertex
        .fromBufferAttribute(positions, index)
        .applyMatrix4(mesh.matrixWorld)
        .project(camera);
      radius = Math.max(
        radius,
        Math.hypot(
          ((vertex.x - center.x) * host.clientWidth) / 2,
          ((vertex.y - center.y) * host.clientHeight) / 2,
        ),
      );
    }
    return radius;
  }

  beforeEach(() => {
    rendering.render.mockClear();
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    queued = undefined;
    host = new ElementStub();
    vi.stubGlobal("document", {
      hidden: false,
      createElement: () => new ElementStub(),
      addEventListener() {},
      removeEventListener() {},
    });
    media = {
      matches: false,
      addEventListener(_event, callback) {
        motionChanged = callback;
      },
      removeEventListener() {},
    };
    vi.stubGlobal("matchMedia", () => media);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeHost = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queued = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      queued = undefined;
    });
    mountScene();
  });
  afterEach(() => {
    controller.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("updates line, light, ring and label color before replaying a same-location project", () => {
    const { arc, flow, selection, camera } = objects();
    const positions = arc.geometry.getAttribute("position").array;
    const cameraPosition = camera.position.clone();
    frame(450);
    controller.setPoints([{ ...city, color: "#e9bd72" }]);
    controller.highlightPoint(city.id);
    frame(450);
    expect(arc.material.color.getHexString()).toBe("e9bd72");
    expect(
      (flow.material.uniforms.color.value as THREE.Color).getHexString(),
    ).toBe("e9bd72");
    expect(selection.material.color.getHexString()).toBe("e9bd72");
    const labelLayer = host.children.find(
      (item) => item.className === "earth-label-layer",
    )!;
    const label = labelLayer.children.find(
      (item) => item.className === "earth-city-label",
    )!;
    expect(label.properties.get("--point-color")).toBe("#e9bd72");
    expect(arc.geometry.getAttribute("position").array).toBe(positions);
    expect(camera.position.distanceTo(cameraPosition)).toBeLessThan(1e-12);
    const flowStart = new THREE.Vector3().fromBufferAttribute(
      flow.geometry.getAttribute("position"),
      0,
    );
    const routeStart = new THREE.Vector3().fromBufferAttribute(
      arc.geometry.getAttribute("position"),
      0,
    );
    expect(flowStart.distanceTo(routeStart)).toBeLessThan(1e-6);
    expect(flow.material.fragmentShader).toContain(
      "#include <colorspace_fragment>",
    );
    frame(900);
    expect(screenRadius(selection, camera)).toBeGreaterThan(20);
    expect(screenRadius(selection, camera)).toBeLessThan(23);
  });

  it("replays a same-color project without allocating another line or moving the camera", () => {
    const { arc, flow, camera } = objects();
    const cameraPosition = camera.position.clone();
    frame(1100);
    controller.highlightPoint(city.id);
    frame(1100);
    expect(objects().arc).toBe(arc);
    expect(objects().flow).toBe(flow);
    expect(camera.position.distanceTo(cameraPosition)).toBeLessThan(1e-12);
    const light = new THREE.Vector3().fromBufferAttribute(
      flow.geometry.getAttribute("position"),
      0,
    );
    const start = new THREE.Vector3().fromBufferAttribute(
      arc.geometry.getAttribute("position"),
      0,
    );
    expect(light.distanceTo(start)).toBeLessThan(1e-6);
  });

  it("keeps the headquarters landing pulse even when the route has zero length", () => {
    const hq = {
      ...city,
      id: "city:ningbo",
      latitude: EARTH_HEADQUARTERS.latitude,
      longitude: EARTH_HEADQUARTERS.longitude,
    };
    controller.setPoints([hq]);
    controller.highlightPoint(hq.id);
    frame(450);
    const { arc, flow, selection } = objects();
    expect(arc.visible).toBe(false);
    expect(flow.visible).toBe(false);
    expect(selection.visible).toBe(true);
    expect(screenRadius(selection, objects().camera)).toBeGreaterThan(20);
    expect(screenRadius(selection, objects().camera)).toBeLessThan(23);
    frame(950);
    expect(screenRadius(selection, objects().camera)).toBeGreaterThan(15);
    expect(screenRadius(selection, objects().camera)).toBeLessThan(17);
  });

  it("keeps one static city route for multiple districts while the selected route reaches the precise district", () => {
    const district = {
      ...city,
      id: "district:hangzhou-xiaoshan",
      cityId: "hangzhou",
      precision: "district" as const,
      latitude: 30.18,
      longitude: 120.27,
    };
    controller.setPoints([
      city,
      district,
      {
        ...district,
        id: "district:hangzhou-fuyang",
        latitude: 30.05,
        longitude: 119.95,
      },
      {
        ...district,
        id: "district:ningbo-beilun",
        cityId: "ningbo",
        latitude: 29.9,
        longitude: 121.84,
      },
    ]);
    controller.highlightPoint(district.id);
    frame(450);
    const { cityRoutes, arc, flow } = objects();
    expect(cityRoutes.visible).toBe(true);
    expect(cityRoutes.geometry.drawRange.count).toBe(64 * 2);
    expect(cityRoutes.material.opacity).toBeLessThan(arc.material.opacity);
    expect(flow.visible).toBe(true);
    const cityEnd = earthCoordinates(
      new THREE.Vector3().fromBufferAttribute(
        cityRoutes.geometry.getAttribute("position"),
        64 * 2 - 1,
      ),
    );
    const hangzhou = projectCities.find((p) => p.id === "hangzhou")!;
    expect(cityEnd.latitude).toBeCloseTo(hangzhou.latitude, 4);
    expect(cityEnd.longitude).toBeCloseTo(hangzhou.longitude, 4);
    const pointEnd = earthCoordinates(
      new THREE.Vector3().fromBufferAttribute(
        arc.geometry.getAttribute("position"),
        80,
      ),
    );
    expect(pointEnd.latitude).toBeCloseTo(district.latitude, 4);
    expect(pointEnd.longitude).toBeCloseTo(district.longitude, 4);
  });

  it("does not rebuild or animate base routes on selection or color changes, and updates the same buffer when filters change", () => {
    const shanghai = {
      ...city,
      id: "city:shanghai",
      cityId: "shanghai",
      latitude: 31.23,
      longitude: 121.47,
    };
    controller.setPoints([city, shanghai]);
    frame(100);
    const { cityRoutes } = objects();
    const geometry = cityRoutes.geometry;
    const attribute = geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const buffer = attribute.array;
    const version = attribute.version;
    expect(geometry.drawRange.count).toBe(2 * 64 * 2);
    controller.setSelected(null);
    frame(200);
    expect(cityRoutes.visible).toBe(true);
    expect(objects().arc.visible).toBe(false);
    expect(objects().flow.visible).toBe(false);
    controller.highlightPoint(shanghai.id);
    controller.setPoints([shanghai, { ...city, color: "#e9bd72" }]);
    frame(600);
    expect(objects().cityRoutes).toBe(cityRoutes);
    expect(cityRoutes.geometry).toBe(geometry);
    expect(attribute.version).toBe(version);
    expect(cityRoutes.material.color.getHexString()).toBe("709ba6");
    controller.setPoints([shanghai]);
    frame(700);
    expect(geometry.getAttribute("position").array).toBe(buffer);
    expect(attribute.version).toBe(version + 1);
    expect(geometry.drawRange.count).toBe(64 * 2);
    controller.setPoints([]);
    frame(800);
    expect(cityRoutes.visible).toBe(false);
    expect(geometry.drawRange.count).toBe(0);
  });

  it("releases base-route GPU resources on disposal", () => {
    const { cityRoutes } = objects();
    const geometryDisposed = vi.fn();
    const materialDisposed = vi.fn();
    cityRoutes.geometry.addEventListener("dispose", geometryDisposed);
    cityRoutes.material.addEventListener("dispose", materialDisposed);
    controller.dispose();
    controller.dispose();
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
  });

  it("fits the regional network and headquarters outside the project card and toolbar", () => {
    const locations = ["ningbo", "shanghai", "lishui"].map((id) => ({
      ...projectCities.find((point) => point.id === id)!,
      color: "#70b6ff",
      cityId: id,
    }));
    controller.setPoints(locations);
    controller.overview({ duration: 0 });
    frame(50);
    const { camera } = objects();
    for (const location of locations) {
      const projected = earthPosition(
        location.latitude,
        location.longitude,
        5.014,
      ).project(camera);
      const x = (projected.x * 0.5 + 0.5) * host.clientWidth;
      const y = (-projected.y * 0.5 + 0.5) * host.clientHeight;
      expect(x).toBeGreaterThan(40);
      expect(x).toBeLessThan(host.clientWidth - 430);
      expect(y).toBeGreaterThan(200);
      expect(y).toBeLessThan(host.clientHeight - 150);
    }
  });

  it("refits late network data only while the camera is in overview mode", () => {
    controller.overview({ duration: 0 });
    frame(50);
    const before = objects().camera.position.clone();
    const beijing = {
      ...projectCities.find((point) => point.id === "beijing")!,
      color: "#70b6ff",
      cityId: "beijing",
    };
    controller.setPoints([city, beijing]);
    frame(100);
    expect(objects().camera.position.distanceTo(before)).toBeGreaterThan(0.1);
    controller.focusPoint(city.id, { duration: 0 });
    frame(150);
    const focused = objects().camera.position.clone();
    controller.setPoints([city]);
    frame(200);
    expect(objects().camera.position.distanceTo(focused)).toBeLessThan(1e-12);
  });

  it("keeps the small-screen network below the heading and above the project card", () => {
    host.clientWidth = 425;
    host.clientHeight = 480;
    resizeHost();
    const locations = ["ningbo", "shanghai", "lishui"].map((id) => ({
      ...projectCities.find((point) => point.id === id)!,
      color: "#70b6ff",
      cityId: id,
    }));
    controller.setPoints(locations);
    controller.overview({ duration: 0 });
    frame(100);
    for (const location of locations) {
      const projected = earthPosition(
        location.latitude,
        location.longitude,
        5.014,
      ).project(objects().camera);
      const x = (projected.x * 0.5 + 0.5) * host.clientWidth;
      const y = (-projected.y * 0.5 + 0.5) * host.clientHeight;
      expect(x).toBeGreaterThan(40);
      expect(x).toBeLessThan(385);
      expect(y).toBeGreaterThan(249);
      expect(y).toBeLessThan(375);
    }
  });

  it("advances from the globe to headquarters before one scan and route reveal", () => {
    freshEntry();
    controller.startIntro();
    frame(0);
    const { scan, cityRoutes } = objects();
    const far = objects().camera.position.clone();
    expect(far.length()).toBeGreaterThan(10);
    const positions = scan.geometry.getAttribute("position").array;
    expect(cityRoutes.material.opacity).toBe(0);
    frame(100);
    expect(objects().camera.position.distanceTo(far)).toBeLessThan(1e-12);
    frame(900);
    expect(objects().camera.position.length()).toBeLessThan(far.length());
    expect(scan.visible).toBe(false);
    expect(cityRoutes.material.opacity).toBe(0);
    expect(objects().arc.material.visible).toBe(false);
    frame(1680);
    expect(objects().camera.position.length()).toBeLessThan(6);
    frame(2080);
    expect(scan.visible).toBe(true);
    expect(scan.material.uniforms.opacity.value).toBeGreaterThan(0);
    expect(cityRoutes.material.opacity).toBeGreaterThan(0);
    expect(cityRoutes.material.opacity).toBeLessThan(0.6);
    for (let index = 0; index < positions.length; index += 3)
      expect(
        new THREE.Vector3().fromArray(positions, index).length(),
      ).toBeCloseTo(5.012, 5);
    const rotation = scan.quaternion.clone();
    frame(2480);
    expect(scan.quaternion.angleTo(rotation)).toBeGreaterThan(0.1);
    frame(2880);
    expect(scan.visible).toBe(false);
    expect(cityRoutes.material.opacity).toBe(0.6);
    const cameraPosition = objects().camera.position.clone();
    controller.highlightPoint(city.id);
    frame(3280);
    expect(scan.visible).toBe(true);
    expect(scan.geometry.getAttribute("position").array).toBe(positions);
    expect(objects().camera.position.distanceTo(cameraPosition)).toBeLessThan(
      1e-12,
    );
  });

  it("shows settled routes immediately and omits the sweep for reduced motion", () => {
    freshEntry();
    media.matches = true;
    controller.startIntro();
    controller.highlightPoint(city.id);
    frame(100);
    expect(objects().scan.visible).toBe(false);
    expect(objects().cityRoutes.material.opacity).toBe(0.6);
    expect(objects().arc.geometry.drawRange.count).toBe(81);
    expect(objects().camera.position.length()).toBeLessThan(6);
  });

  it("keeps the entry flight through data and viewport updates and never replays it", () => {
    freshEntry();
    controller.startIntro();
    frame(700);
    const inFlight = objects().camera.position.clone();
    controller.setPoints([{ ...city, color: "#e9bd72" }]);
    host.clientWidth = 1400;
    resizeHost();
    frame(700);
    expect(objects().camera.position.distanceTo(inFlight)).toBeLessThan(1e-12);
    frame(1680);
    const landed = objects().camera.position.clone();
    controller.setPoints([city]);
    controller.startIntro();
    frame(3500);
    expect(objects().camera.position.distanceTo(landed)).toBeLessThan(1e-12);
    expect(objects().scan.visible).toBe(false);
  });

  it("cancels the entry on manual zoom without a delayed landing or scan", () => {
    freshEntry();
    controller.startIntro();
    frame(700);
    controller.zoomOut();
    frame(1200);
    const manual = objects().camera.position.clone();
    controller.startIntro();
    frame(3000);
    expect(objects().camera.position.distanceTo(manual)).toBeLessThan(1e-12);
    expect(objects().scan.visible).toBe(false);
    expect(objects().cityRoutes.material.opacity).toBe(0.6);
    expect(objects().arc.material.visible).toBe(true);
  });

  it("does not override an overview or project selected before the texture is ready", () => {
    freshEntry();
    controller.overview({ duration: 0 });
    frame(0);
    const manual = objects().camera.position.clone();
    controller.startIntro();
    frame(3000);
    expect(objects().camera.position.distanceTo(manual)).toBeLessThan(1e-12);
    freshEntry();
    controller.focusPoint(city.id, { duration: 0 });
    frame(3000);
    const focused = objects().camera.position.clone();
    controller.startIntro();
    frame(6000);
    expect(objects().camera.position.distanceTo(focused)).toBeLessThan(1e-12);
  });

  it("settles immediately if reduced motion is enabled during entry", () => {
    freshEntry();
    controller.startIntro();
    frame(700);
    media.matches = true;
    motionChanged();
    frame(700);
    expect(objects().camera.position.length()).toBeLessThan(6);
    expect(objects().scan.visible).toBe(false);
    expect(objects().cityRoutes.material.opacity).toBe(0.6);
    expect(objects().arc.material.visible).toBe(true);
  });

  it("keeps headquarters and landing decorations within screen-sized bounds across zoom and viewport changes", () => {
    let time = 0;
    for (const [width, height] of [
      [1920, 1000],
      [425, 480],
    ]) {
      host.clientWidth = width;
      host.clientHeight = height;
      resizeHost();
      for (const precision of ["city", "district", "point"] as const) {
        controller.focusPoint(city.id, { duration: 0, precision });
        frame(time);
        time += 450;
        frame(time);
        const { headquarters, selection, camera } = objects();
        expect(screenRadius(headquarters, camera)).toBeGreaterThan(6);
        expect(screenRadius(headquarters, camera)).toBeLessThan(8);
        expect(screenRadius(selection, camera)).toBeGreaterThan(15);
        expect(screenRadius(selection, camera)).toBeLessThan(22.5);
      }
    }
    media.matches = true;
    controller.reset();
    frame(time + 500);
    const { headquarters, selection, camera } = objects();
    expect(screenRadius(headquarters, camera)).toBeGreaterThan(6);
    expect(screenRadius(headquarters, camera)).toBeLessThan(8);
    expect(screenRadius(selection, camera)).toBeLessThan(17);
  });

  it("disposes the transient scan geometry and material exactly once", () => {
    const { scan } = objects();
    const geometryDisposed = vi.fn(),
      materialDisposed = vi.fn();
    scan.geometry.addEventListener("dispose", geometryDisposed);
    scan.material.addEventListener("dispose", materialDisposed);
    controller.dispose();
    controller.dispose();
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
  });

  it("switches headquarters and point accessibility labels without moving the camera", () => {
    const position = objects().camera.position.clone();
    controller.setLanguage("zh-CN");
    const layer = host.children.find(
      (item) => item.className === "earth-label-layer",
    )!;
    const hq = layer.children.find(
      (item) => item.className === "earth-hq-label",
    )!;
    expect(hq.textContent).toContain("宁波");
    controller.setLanguage("en");
    controller.setPoints([{ ...city, name: "Hangzhou" }]);
    frame(100);
    expect(hq.textContent).toBe("Ningbo HQ · BASE");
    for (const item of layer.children) {
      expect(item.attributes.get("aria-label") ?? "").not.toMatch(
        /\p{Script=Han}/u,
      );
      expect(item.lastElementChild?.textContent ?? "").not.toMatch(
        /\p{Script=Han}/u,
      );
    }
    expect(objects().camera.position.distanceTo(position)).toBeLessThan(1e-12);
  });
});
