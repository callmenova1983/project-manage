/** Public gazetteer reference points in WGS84, not surveyed project addresses.
 * See docs/project-location-data.md for source records and precision limits. */
export interface ProjectDistrict {
  id: string;
  name: string;
  cityId: string;
  province: string;
  latitude: number;
  longitude: number;
  aliases: readonly string[];
  sourceUrl: string;
}

type DistrictRow = [string, string, string, number, number, string];
const rows: DistrictRow[] = [
  [
    "ningbo-beilun",
    "北仑区",
    "ningbo",
    29 + 54 / 60 + 26 / 3600,
    121 + 49 / 60 + 28 / 3600,
    "https://www.wikidata.org/wiki/Q144879",
  ],
  [
    "ningbo-yinzhou",
    "鄞州区",
    "ningbo",
    29 + 49 / 60 + 8 / 3600,
    121 + 32 / 60 + 36 / 3600,
    "https://www.wikidata.org/wiki/Q1334217",
  ],
  [
    "ningbo-ninghai",
    "宁海县",
    "ningbo",
    29.2891667,
    121.4247222,
    "https://www.geonames.org/search.html?country=CN&q=Ninghai",
  ],
  [
    "ningbo-cixi",
    "慈溪市",
    "ningbo",
    30 + 10 / 60 + 11 / 3600,
    121 + 15 / 60 + 59 / 3600,
    "https://www.wikidata.org/wiki/Q706161",
  ],
  [
    "ningbo-yuyao",
    "余姚市",
    "ningbo",
    30 + 2 / 60 + 14 / 3600,
    121 + 9 / 60 + 17 / 3600,
    "https://www.wikidata.org/wiki/Q1011201",
  ],
  [
    "lishui-yunhe",
    "云和县",
    "lishui",
    28.1108333,
    119.5638889,
    "https://www.geonames.org/advanced-search.html?q=Ho%2F&startRow=100",
  ],
  [
    "lishui-longquan",
    "龙泉市",
    "lishui",
    28.0808333,
    119.1205556,
    "https://www.geonames.org/search.html?country=CN&q=Li+Xian&startRow=100",
  ],
  [
    "lishui-qingtian",
    "青田县",
    "lishui",
    28 + 8 / 60 + 20 / 3600,
    120 + 17 / 60 + 12 / 3600,
    "https://www.wikidata.org/wiki/Q1361329",
  ],
  [
    "lishui-suichang",
    "遂昌县",
    "lishui",
    28.59709,
    119.269611,
    "https://www.geonames.org/search.html?country=CN&q=Li+Xian&startRow=100",
  ],
  [
    "lishui-songyang",
    "松阳县",
    "lishui",
    28.4508333,
    119.4897222,
    "https://www.geonames.org/search.html?country=CN&q=Li+Xian&startRow=100",
  ],
  [
    "lishui-qingyuan",
    "庆元县",
    "lishui",
    27.611887,
    119.162844,
    "https://www.geonames.org/search.html?country=CN&q=Li+Xian&startRow=50",
  ],
];

export const projectDistricts: readonly ProjectDistrict[] = rows.map(
  ([id, name, cityId, latitude, longitude, sourceUrl]) => ({
    id,
    name,
    cityId,
    province: "浙江",
    latitude,
    longitude,
    aliases: [name, name.slice(0, -1), id],
    sourceUrl,
  }),
);
