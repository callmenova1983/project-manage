import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import {
  earthCoordinates,
  earthPosition,
  EARTH_HEADQUARTERS,
  earthFocusHeight,
  writeEarthArc,
  sampleEarthArc,
  earthLandingPulse,
  earthNorth,
  earthRouteCities,
  earthOverviewView,
  earthScanProgress,
} from "../../apps/web/src/services/earth-scene";
import { projectCities } from "../../packages/domain/project-location";

describe("Earth sphere geography", () => {
  it("matches the equirectangular texture's Greenwich, east, north orientation", () => {
    expect(earthPosition(0, 0).distanceTo(new Vector3(5, 0, 0))).toBeLessThan(
      1e-10,
    );
    expect(earthPosition(0, 90).distanceTo(new Vector3(0, 0, -5))).toBeLessThan(
      1e-10,
    );
    expect(earthPosition(90, 0).distanceTo(new Vector3(0, 5, 0))).toBeLessThan(
      1e-10,
    );
  });
  it.each([
    [31.2304, 121.4737],
    [30.2741, 120.1551],
    [28.4672, 119.9229],
    [-33.8688, 151.2093],
    [37.7749, -122.4194],
    [0, 179.999],
    [0, -179.999],
  ])(
    "round-trips map picks at latitude %s, longitude %s",
    (latitude, longitude) => {
      const location = earthCoordinates(earthPosition(latitude, longitude));
      expect(location.latitude).toBeCloseTo(latitude, 9);
      expect(location.longitude).toBeCloseTo(longitude, 9);
    },
  );
  it("keeps returned locations unchanged at the raised marker radius", () => {
    const surface = earthCoordinates(earthPosition(29.8683, 121.544, 5));
    const marker = earthCoordinates(earthPosition(29.8683, 121.544, 5.009));
    expect(marker.latitude).toBeCloseTo(surface.latitude, 12);
    expect(marker.longitude).toBeCloseTo(surface.longitude, 12);
  });
  it.each([-90, -89.95, 0, 29.87, 89.9, 89.95, 90])(
    "keeps the camera frame finite and orthogonal at latitude %s",
    (latitude) => {
      const longitude = 121.55;
      const normal = earthPosition(latitude, longitude, 1);
      const north = earthNorth(latitude, longitude);
      expect(north.length()).toBeCloseTo(1, 12);
      expect(north.dot(normal)).toBeCloseTo(0, 12);
      const camera = new PerspectiveCamera(48, 2, 0.01, 100);
      camera.position
        .copy(normal)
        .multiplyScalar(5.42)
        .addScaledVector(north, -0.42 * 1.05);
      camera.up.copy(north);
      const location = normal.clone().multiplyScalar(5);
      camera.lookAt(location);
      camera.updateMatrixWorld();
      expect(camera.matrixWorld.elements.every(Number.isFinite)).toBe(true);
      expect(camera.matrixWorld.determinant()).toBeCloseTo(1, 10);
      const projected = location.project(camera);
      expect(projected.x).toBeCloseTo(0, 10);
      expect(projected.y).toBeCloseTo(0, 10);
      expect(projected.z).toBeGreaterThan(-1);
      expect(projected.z).toBeLessThan(1);
    },
  );
});

describe("network overview and headquarters sweep", () => {
  const points = ["ningbo", "shanghai", "lishui"].map((id) => ({
    ...projectCities.find((city) => city.id === id)!,
    color: "#70b6ff",
    cityId: id,
  }));
  it("keeps a regional network regional instead of using a close single-project or global view", () => {
    const view = earthOverviewView(points);
    expect(view.latitude).toBeGreaterThan(28);
    expect(view.latitude).toBeLessThan(32);
    expect(view.longitude).toBeGreaterThan(119);
    expect(view.longitude).toBeLessThan(123);
    expect(view.height).toBeGreaterThanOrEqual(0.55);
    expect(view.height).toBeLessThan(1);
    expect(earthOverviewView([...points, ...points])).toEqual(view);
  });
  it("handles empty, invalid and worldwide distributions with finite bounded views", () => {
    const empty = earthOverviewView([]);
    expect(
      earthOverviewView([
        { ...points[0], id: "invalid", latitude: NaN, cityId: "" },
      ]),
    ).toEqual(empty);
    const worldwide = earthOverviewView([
      ...points,
      {
        ...points[0],
        id: "point:sf",
        cityId: "",
        precision: "point",
        latitude: 37.77,
        longitude: -122.42,
      },
    ]);
    expect(worldwide.height).toBe(10);
    expect(Object.values(worldwide).every(Number.isFinite)).toBe(true);
  });
  it("finishes route reveal before the finite scan settles and skips motion when requested", () => {
    expect(earthScanProgress(0).opacity).toBe(0);
    expect(earthScanProgress(525).opacity).toBeCloseTo(0.2);
    expect(earthScanProgress(650).route).toBe(1);
    expect(earthScanProgress(840).rotation).toBe(1);
    for (const elapsed of [1050, 1200, 2400])
      expect(earthScanProgress(elapsed).opacity).toBe(0);
    for (const elapsed of [0, 525, 840]) {
      expect(earthScanProgress(elapsed, true).opacity).toBe(0);
      expect(earthScanProgress(elapsed, true).route).toBe(1);
    }
  });
});

describe("headquarters routes", () => {
  it("deduplicates districts and city projects by parent city without assigning free points to a city", () => {
    const point = {
      name: "project",
      latitude: 30.2,
      longitude: 120.3,
      color: "#70b6ff",
    };
    const cities = earthRouteCities([
      {
        ...point,
        id: "district:hangzhou-xiaoshan",
        cityId: "hangzhou",
        precision: "district",
      },
      {
        ...point,
        id: "district:hangzhou-fuyang",
        cityId: "hangzhou",
        precision: "district",
      },
      { ...point, id: "city:hangzhou", cityId: "hangzhou", precision: "city" },
      { ...point, id: "city:shanghai", precision: "city" },
      { ...point, id: "ningbo", cityId: "ningbo" },
      { ...point, id: "point:30.200000:120.300000", precision: "point" },
      { ...point, id: "unknown", cityId: "unknown" },
    ]);
    expect(cities.map((city) => city.id)).toEqual(["hangzhou", "shanghai"]);
    expect(cities[0]).toBe(
      projectCities.find((city) => city.id === "hangzhou"),
    );
  });
  it("uses the actual Ningbo city centre as its single headquarters", () => {
    expect(EARTH_HEADQUARTERS).toBe(
      projectCities.find((city) => city.id === "ningbo"),
    );
    expect(EARTH_HEADQUARTERS.latitude).toBe(29.87);
    expect(EARTH_HEADQUARTERS.longitude).toBe(121.55);
  });
  it.each([
    ["nearby district", 29.88, 121.56],
    ["regional city", 30.27, 120.16],
    ["distant city", 37.77, -122.42],
    ["same city", 29.87, 121.55],
    ["antipode", -29.87, -58.45],
  ])(
    "keeps the %s route anchored to real coordinates and above Earth",
    (_, latitude, longitude) => {
      const positions = new Float32Array(81 * 3);
      const target = { latitude, longitude };
      writeEarthArc(positions, EARTH_HEADQUARTERS, target);
      const first = earthCoordinates(new Vector3().fromArray(positions));
      const last = earthCoordinates(
        new Vector3().fromArray(positions, positions.length - 3),
      );
      expect(first.latitude).toBeCloseTo(EARTH_HEADQUARTERS.latitude, 4);
      expect(first.longitude).toBeCloseTo(EARTH_HEADQUARTERS.longitude, 4);
      expect(last.latitude).toBeCloseTo(latitude, 4);
      expect(last.longitude).toBeCloseTo(longitude, 4);
      const sampled = new Vector3();
      for (let i = 0; i <= 320; i++) {
        sampleEarthArc(positions, i / 320, sampled);
        expect(sampled.length()).toBeGreaterThan(5);
        expect(sampled.length()).toBeLessThan(5.75);
      }
    },
  );
  it("reuses the same route and flow buffers when the selected location changes", () => {
    const positions = new Float32Array(81 * 3);
    const buffer = positions.buffer;
    const flow = new Vector3();
    writeEarthArc(positions, EARTH_HEADQUARTERS, {
      latitude: 31.23,
      longitude: 121.47,
    });
    const before = positions.slice();
    writeEarthArc(positions, EARTH_HEADQUARTERS, {
      latitude: 28.47,
      longitude: 119.92,
    });
    expect(positions.buffer).toBe(buffer);
    expect(positions).not.toEqual(before);
    expect(sampleEarthArc(positions, 0.5, flow)).toBe(flow);
    expect(
      sampleEarthArc(positions, -1, flow).distanceTo(
        new Vector3().fromArray(positions),
      ),
    ).toBeLessThan(1e-10);
    expect(
      sampleEarthArc(positions, 2, flow).distanceTo(
        new Vector3().fromArray(positions, positions.length - 3),
      ),
    ).toBeLessThan(1e-10);
  });
  it("rejects malformed route geometry", () => {
    expect(() =>
      writeEarthArc(
        new Float32Array(4),
        EARTH_HEADQUARTERS,
        EARTH_HEADQUARTERS,
      ),
    ).toThrow(RangeError);
  });
  it("uses progressively closer camera heights without changing geographic positions", () => {
    expect(earthFocusHeight()).toBe(0.8);
    expect(earthFocusHeight("city")).toBe(0.8);
    expect(earthFocusHeight("district")).toBe(0.5);
    expect(earthFocusHeight("point")).toBe(0.42);
  });
  it("replays one landing breath and then settles instead of cycling forever", () => {
    expect(earthLandingPulse(0)).toBe(0);
    expect(earthLandingPulse(450)).toBeCloseTo(1);
    for (const elapsed of [900, 1800, 2250, 10000])
      expect(earthLandingPulse(elapsed)).toBe(0);
    // A same-location project switch starts a fresh elapsed clock.
    expect(earthLandingPulse(450)).toBeCloseTo(1);
    for (const elapsed of [0, 200, 450, 900])
      expect(earthLandingPulse(elapsed, true)).toBe(0);
  });
});
