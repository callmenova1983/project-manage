import { z } from "zod";
import { projectDistricts, type ProjectDistrict } from "./project-districts.js";
export { projectDistricts, type ProjectDistrict } from "./project-districts.js";

/** Approximate WGS84 city centres, never a building or project address. */
export interface ProjectCity {
  id: string;
  name: string;
  province: string;
  latitude: number;
  longitude: number;
  aliases: readonly string[];
}

type CityRow = [string, string, string, number, number, ...string[]];
const cityRows: CityRow[] = [
  [
    "hangzhou",
    "杭州",
    "浙江",
    30.27,
    120.16,
    "临安",
    "富阳",
    "桐庐",
    "淳安",
    "建德",
    "萧山",
    "余杭",
  ],
  [
    "ningbo",
    "宁波",
    "浙江",
    29.87,
    121.55,
    "宁海",
    "象山",
    "余姚",
    "慈溪",
    "奉化",
    "北仑",
    "鄞州",
    "镇海",
  ],
  [
    "wenzhou",
    "温州",
    "浙江",
    28.0,
    120.7,
    "乐清",
    "瑞安",
    "永嘉",
    "平阳",
    "苍南",
    "文成",
    "泰顺",
    "龙港",
  ],
  [
    "jiaxing",
    "嘉兴",
    "浙江",
    30.75,
    120.76,
    "海宁",
    "海盐",
    "桐乡",
    "平湖",
    "嘉善",
  ],
  ["huzhou", "湖州", "浙江", 30.87, 120.1, "德清", "长兴", "安吉"],
  [
    "shaoxing",
    "绍兴",
    "浙江",
    30.0,
    120.58,
    "诸暨",
    "嵊州",
    "新昌",
    "上虞",
    "柯桥",
  ],
  [
    "jinhua",
    "金华",
    "浙江",
    29.08,
    119.65,
    "义乌",
    "东阳",
    "永康",
    "兰溪",
    "武义",
    "浦江",
    "磐安",
  ],
  ["quzhou", "衢州", "浙江", 28.97, 118.87, "江山", "常山", "开化", "龙游"],
  ["zhoushan", "舟山", "浙江", 29.99, 122.21, "岱山", "嵊泗"],
  [
    "taizhou-zj",
    "台州",
    "浙江",
    28.66,
    121.43,
    "临海",
    "温岭",
    "玉环",
    "天台",
    "仙居",
    "三门",
    "黄岩",
    "椒江",
    "路桥",
  ],
  [
    "lishui",
    "丽水",
    "浙江",
    28.47,
    119.92,
    "云和",
    "青田",
    "缙云",
    "遂昌",
    "松阳",
    "庆元",
    "景宁",
    "龙泉",
  ],
  ["shanghai", "上海", "上海", 31.23, 121.47],
  ["beijing", "北京", "北京", 39.9, 116.4],
  ["tianjin", "天津", "天津", 39.13, 117.2],
  ["chongqing", "重庆", "重庆", 29.56, 106.55],
  ["nanjing", "南京", "江苏", 32.06, 118.8],
  ["suzhou", "苏州", "江苏", 31.3, 120.59, "昆山", "太仓", "常熟", "张家港"],
  ["wuxi", "无锡", "江苏", 31.57, 120.3, "江阴", "宜兴"],
  ["changzhou", "常州", "江苏", 31.78, 119.97, "溧阳"],
  ["nantong", "南通", "江苏", 32.02, 120.86],
  ["yangzhou", "扬州", "江苏", 32.39, 119.41],
  ["zhenjiang", "镇江", "江苏", 32.2, 119.45],
  ["taizhou-js", "泰州", "江苏", 32.46, 119.93],
  ["xuzhou", "徐州", "江苏", 34.26, 117.19],
  ["hefei", "合肥", "安徽", 31.82, 117.23],
  ["wuhu", "芜湖", "安徽", 31.35, 118.43],
  ["huangshan", "黄山", "安徽", 29.71, 118.34],
  ["fuzhou", "福州", "福建", 26.07, 119.3],
  ["xiamen", "厦门", "福建", 24.48, 118.09],
  ["quanzhou", "泉州", "福建", 24.87, 118.68],
  ["nanchang", "南昌", "江西", 28.68, 115.86],
  ["ganzhou", "赣州", "江西", 25.83, 114.93],
  ["jinan", "济南", "山东", 36.65, 117.12],
  ["qingdao", "青岛", "山东", 36.07, 120.38],
  ["yantai", "烟台", "山东", 37.46, 121.45],
  ["weifang", "潍坊", "山东", 36.71, 119.16],
  ["zhengzhou", "郑州", "河南", 34.75, 113.63],
  ["luoyang", "洛阳", "河南", 34.62, 112.45],
  ["wuhan", "武汉", "湖北", 30.59, 114.31],
  ["yichang", "宜昌", "湖北", 30.69, 111.29],
  ["changsha", "长沙", "湖南", 28.23, 112.94],
  ["guangzhou", "广州", "广东", 23.13, 113.26],
  ["shenzhen", "深圳", "广东", 22.54, 114.06],
  ["foshan", "佛山", "广东", 23.02, 113.12],
  ["dongguan", "东莞", "广东", 23.02, 113.75],
  ["zhuhai", "珠海", "广东", 22.27, 113.58],
  ["huizhou", "惠州", "广东", 23.11, 114.42],
  ["zhongshan", "中山", "广东", 22.52, 113.39],
  ["nanning", "南宁", "广西", 22.82, 108.37],
  ["guilin", "桂林", "广西", 25.27, 110.29],
  ["haikou", "海口", "海南", 20.04, 110.2],
  ["sanya", "三亚", "海南", 18.25, 109.51],
  ["chengdu", "成都", "四川", 30.57, 104.07],
  ["yibin", "宜宾", "四川", 28.75, 104.64],
  ["mianyang", "绵阳", "四川", 31.47, 104.68],
  ["guiyang", "贵阳", "贵州", 26.65, 106.63],
  ["kunming", "昆明", "云南", 24.88, 102.83],
  ["xian", "西安", "陕西", 34.34, 108.94, "xi'an"],
  ["lanzhou", "兰州", "甘肃", 36.06, 103.83],
  ["xining", "西宁", "青海", 36.62, 101.78],
  ["yinchuan", "银川", "宁夏", 38.49, 106.23],
  ["urumqi", "乌鲁木齐", "新疆", 43.83, 87.62, "wulumuqi"],
  ["lhasa", "拉萨", "西藏", 29.65, 91.17, "lasa"],
  ["shijiazhuang", "石家庄", "河北", 38.04, 114.51],
  ["tangshan", "唐山", "河北", 39.63, 118.18],
  ["taiyuan", "太原", "山西", 37.87, 112.55],
  ["hohhot", "呼和浩特", "内蒙古", 40.84, 111.75, "huhehaote"],
  ["shenyang", "沈阳", "辽宁", 41.81, 123.43],
  ["dalian", "大连", "辽宁", 38.91, 121.61],
  ["changchun", "长春", "吉林", 43.82, 125.32],
  ["harbin", "哈尔滨", "黑龙江", 45.8, 126.54, "haerbin"],
  ["hong-kong", "香港", "香港", 22.32, 114.17, "hong kong"],
  ["macao", "澳门", "澳门", 22.2, 113.54, "macau"],
  ["taipei", "台北", "台湾", 25.03, 121.57],
];

export const projectCities: readonly ProjectCity[] = cityRows.map(
  ([id, name, province, latitude, longitude, ...aliases]) => ({
    id,
    name,
    province,
    latitude,
    longitude,
    aliases: [name, `${name}市`, id, ...aliases],
  }),
);

export const projectLocationSchema = z
  .object({
    precision: z.enum(["city", "district", "point"]),
    cityId: z.string().max(60),
    city: z.string().max(60),
    province: z.string().max(60),
    districtId: z.string().min(1).max(60).optional(),
    district: z.string().min(1).max(60).optional(),
    coordinateSource: z.enum(["user-coordinates", "manual-map"]).optional(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    source: z.enum(["name", "text", "map", "ai"]),
    confirmed: z.boolean(),
    evidence: z.string().trim().max(500),
  })
  .strict()
  .superRefine((location, ctx) => {
    if (location.precision === "point") {
      if (
        location.cityId !== "" ||
        location.city !== "" ||
        location.province !== "" ||
        location.districtId !== undefined ||
        location.district !== undefined ||
        !location.evidence ||
        !(
          (location.source === "text" &&
            location.coordinateSource === "user-coordinates") ||
          (location.source === "map" &&
            location.coordinateSource === "manual-map")
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "精确坐标必须来自用户输入或地图选点，并明确坐标来源。",
        });
      return;
    }
    const city = projectCities.find((item) => item.id === location.cityId);
    const district =
      location.precision === "district"
        ? projectDistricts.find((item) => item.id === location.districtId)
        : undefined;
    const centre = location.precision === "district" ? district : city;
    if (
      !city ||
      city.name !== location.city ||
      city.province !== location.province ||
      !centre ||
      centre.latitude !== location.latitude ||
      centre.longitude !== location.longitude ||
      location.coordinateSource !== undefined ||
      (location.precision === "district"
        ? !district ||
          district.cityId !== city.id ||
          district.name !== location.district
        : location.districtId !== undefined || location.district !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "请选择受支持的城市或区县，坐标必须匹配对应的参考中心。",
      });
  });

export type ProjectLocation = z.infer<typeof projectLocationSchema>;
export type LocationSource = ProjectLocation["source"];
export interface CityCandidate {
  city: ProjectCity;
  district?: ProjectDistrict;
  location: ProjectLocation;
  evidence: string;
}
export interface CityResolution {
  status: "matched" | "ambiguous" | "unmatched";
  candidates: CityCandidate[];
  location: ProjectLocation | null;
}
export interface ProjectLocationAnalysis extends CityResolution {
  provider: "qwen" | "rules";
  model: string | null;
}
export const projectLocationAnalysisInput = z
  .object({
    version: z.number().int().positive(),
    externalProcessingConfirmed: z.literal(true),
  })
  .strict();

export function cityLocation(
  cityId: string,
  source: LocationSource,
  confirmed = false,
  evidence = "",
): ProjectLocation {
  const city = projectCities.find((item) => item.id === cityId);
  if (!city) throw new Error("请选择受支持的城市。");
  return projectLocationSchema.parse({
    precision: "city",
    cityId: city.id,
    city: city.name,
    province: city.province,
    latitude: city.latitude,
    longitude: city.longitude,
    source,
    confirmed,
    evidence: evidence.slice(0, 500),
  });
}

export function districtLocation(
  districtId: string,
  source: LocationSource,
  confirmed = false,
  evidence = "",
): ProjectLocation {
  const district = projectDistricts.find((item) => item.id === districtId);
  if (!district) throw new Error("请选择受支持的区县。");
  return projectLocationSchema.parse({
    ...cityLocation(district.cityId, source, confirmed, evidence),
    precision: "district",
    districtId: district.id,
    district: district.name,
    latitude: district.latitude,
    longitude: district.longitude,
  });
}

export function pointLocation(
  latitude: number,
  longitude: number,
  source: "text" | "map",
  evidence = "",
  confirmed = false,
): ProjectLocation {
  return projectLocationSchema.parse({
    precision: "point",
    cityId: "",
    city: "",
    province: "",
    latitude,
    longitude,
    source,
    confirmed,
    coordinateSource: source === "text" ? "user-coordinates" : "manual-map",
    evidence: (
      evidence ||
      (source === "text"
        ? "用户输入经纬度（WGS84）"
        : "用户在地图上选点（WGS84）")
    ).slice(0, 500),
  });
}

export function locationKey(location: ProjectLocation): string {
  return location.precision === "point"
    ? `point:${location.latitude.toFixed(6)}:${location.longitude.toFixed(6)}`
    : `${location.precision}:${location.districtId ?? location.cityId}`;
}

export function locationLabel(location: ProjectLocation): string {
  if (location.precision === "district")
    return `${location.city} · ${location.district}`;
  if (location.precision === "point")
    return `${Math.abs(location.latitude).toFixed(5)}°${location.latitude < 0 ? "S" : "N"}, ${Math.abs(location.longitude).toFixed(5)}°${location.longitude < 0 ? "W" : "E"}`;
  return location.city;
}

/** Translation key, to be passed through the caller's locale function. */
export function locationPrecisionLabel(location: ProjectLocation): string {
  return location.precision === "district"
    ? "District centre"
    : location.precision === "point"
      ? "Exact coordinates"
      : "City centre";
}

function matches(text: string, alias: string) {
  if (/^[a-z0-9' -]+$/i.test(alias)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}($|[^a-z])`, "i").test(text);
  }
  return text.includes(alias);
}

function resolveFields(
  fields: { name: string; text: string }[],
  source: LocationSource,
): CityResolution {
  const candidates: CityCandidate[] = [];
  for (const district of projectDistricts) {
    for (const field of fields) {
      const alias = [...district.aliases]
        .sort((a, b) => b.length - a.length)
        .find((value) => matches(field.text, value));
      if (!alias) continue;
      const city = projectCities.find((item) => item.id === district.cityId)!;
      const evidence = `${field.name}包含“${alias}”，匹配${city.name}${district.name}`;
      candidates.push({
        city,
        district,
        evidence,
        location: districtLocation(district.id, source, false, evidence),
      });
      break;
    }
  }
  for (const city of projectCities) {
    const finer = candidates.filter(
      (candidate) => candidate.city.id === city.id && candidate.district,
    );
    for (const field of fields) {
      const alias = [...city.aliases]
        .sort((a, b) => b.length - a.length)
        .find(
          (value) =>
            matches(field.text, value) &&
            (!finer.length ||
              // A parent name is context, but an additional unsupported county
              // must retain ambiguity instead of silently selecting a known district.
              (![city.name, `${city.name}市`, city.id].includes(value) &&
                !finer.some((candidate) =>
                  candidate.district!.aliases.includes(value),
                ))),
        );
      if (alias) {
        const evidence = `${field.name}包含“${alias}”${alias.startsWith(city.name) ? "" : `，按城市归入${city.name}`}`;
        candidates.push({
          city,
          evidence,
          location: cityLocation(city.id, source, false, evidence),
        });
        break;
      }
    }
  }
  return {
    status:
      candidates.length === 1
        ? "matched"
        : candidates.length > 1
          ? "ambiguous"
          : "unmatched",
    candidates,
    location: candidates.length === 1 ? candidates[0]!.location : null,
  };
}

export function resolveLocationText(text: string): CityResolution {
  const value = text.trim().slice(0, 4000);
  const number = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))";
  const pair = new RegExp(`^${number}\\s*[,，]\\s*${number}$`).exec(value);
  const longitudeLabel = "(?:经度|longitude|lon|lng)";
  const latitudeLabel = "(?:纬度|latitude|lat)";
  const separator = "\\s*[:：=]?\\s*";
  const between = "\\s*[,，;；]?\\s*";
  const lonFirst = new RegExp(
    `^${longitudeLabel}${separator}${number}${between}${latitudeLabel}${separator}${number}$`,
    "i",
  ).exec(value);
  const latFirst = new RegExp(
    `^${latitudeLabel}${separator}${number}${between}${longitudeLabel}${separator}${number}$`,
    "i",
  ).exec(value);
  if (pair || lonFirst || latFirst) {
    const match = pair ?? lonFirst ?? latFirst!;
    const longitude = Number(match[latFirst ? 2 : 1]);
    const latitude = Number(match[latFirst ? 1 : 2]);
    try {
      return {
        status: "matched",
        candidates: [],
        location: pointLocation(latitude, longitude, "text"),
      };
    } catch {
      return { status: "unmatched", candidates: [], location: null };
    }
  }
  // Do not discard invalid coordinate input and accidentally save a city instead.
  if (/(?:经度|纬度|latitude|longitude|\blat\b|\blon\b|\blng\b)/i.test(value))
    return { status: "unmatched", candidates: [], location: null };
  return resolveFields([{ name: "输入文字", text: value }], "text");
}

/** Kept for callers created when only city-level suggestions were available. */
export const resolveCityText = resolveLocationText;

export function inferProjectLocation(project: {
  name: string;
  shortName?: string;
  description?: string;
  client?: string;
  aliases?: readonly string[];
}): CityResolution {
  return resolveFields(
    [
      { name: "项目名称", text: project.name },
      { name: "项目简称", text: project.shortName ?? "" },
      { name: "项目描述", text: project.description ?? "" },
      { name: "客户", text: project.client ?? "" },
      ...(project.aliases ?? []).map((text) => ({ name: "项目别名", text })),
    ],
    "name",
  );
}

/** Snap to a supported city only within the threshold; ocean/remote clicks stay unset. */
export function nearestCity(
  latitude: number,
  longitude: number,
  maxDistanceKm = 100,
): ProjectCity | null {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(maxDistanceKm) ||
    maxDistanceKm <= 0
  )
    return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  let nearest: ProjectCity | null = null,
    distance = Math.min(maxDistanceKm, 200);
  for (const city of projectCities) {
    const a =
      Math.sin(radians(city.latitude - latitude) / 2) ** 2 +
      Math.cos(radians(latitude)) *
        Math.cos(radians(city.latitude)) *
        Math.sin(radians(city.longitude - longitude) / 2) ** 2;
    const km =
      6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    if (km <= distance) {
      nearest = city;
      distance = km;
    }
  }
  return nearest;
}
