# 项目定位的数据与精度

核对日期：2026-10-16。区县数据位于 `packages/domain/project-districts.ts`，每条记录保留 `sourceUrl`。这些点用于表示城市或区县的大致位置，不是项目地址，也不是行政区边界的几何重心。

## 数据来源

区县参考点直接取自 GeoNames 地名数据库和 Wikidata 结构化实体的公开发布页面。它们是开放地名数据来源，不是政府测绘成果。GeoNames 的[导出格式说明](https://download.geonames.org/export/dump/readme.txt)明确经纬度使用 WGS84 十进制度，数据按 CC BY 4.0 发布；Wikidata 的 [P625 坐标属性说明](https://www.wikidata.org/wiki/Property:P625)明确地球坐标采用 WGS84，其结构化数据采用 CC0。来源页面可能包含多个点；本表说明实际采用的记录，代码保存原始精度，度分秒只做算术转换。

| 区县          | WGS84 纬度、经度        | 采用的记录与直接来源                                                                                                        |
| ------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 宁波 · 北仑区 | 29°54′26″N，121°49′28″E | [Wikidata Q144879 的坐标属性](https://www.wikidata.org/wiki/Q144879)                                                        |
| 宁波 · 鄞州区 | 29°49′8″N，121°32′36″E  | [Wikidata Q1334217 的坐标属性](https://www.wikidata.org/wiki/Q1334217)                                                      |
| 宁波 · 宁海县 | 29.2891667，121.4247222 | [GeoNames Ninghai，三级行政区驻地记录](https://www.geonames.org/search.html?country=CN&q=Ninghai)                           |
| 宁波 · 慈溪市 | 30°10′11″N，121°15′59″E | [Wikidata Q706161 的第一条坐标](https://www.wikidata.org/wiki/Q706161)                                                      |
| 宁波 · 余姚市 | 30°2′14″N，121°9′17″E   | [Wikidata Q1011201 的坐标属性](https://www.wikidata.org/wiki/Q1011201)                                                      |
| 丽水 · 云和县 | 28.1108333，119.5638889 | [GeoNames Yunhe 居民点记录，第 134 项](https://www.geonames.org/advanced-search.html?q=Ho%2F&startRow=100)                  |
| 丽水 · 龙泉市 | 28.0808333，119.1205556 | [GeoNames Longquan，丽水居民点记录，第 141 项](https://www.geonames.org/search.html?country=CN&q=Li+Xian&startRow=100)      |
| 丽水 · 青田县 | 28°8′20″N，120°17′12″E  | [Wikidata Q1361329 的坐标属性](https://www.wikidata.org/wiki/Q1361329)                                                      |
| 丽水 · 遂昌县 | 28.59709，119.269611    | [GeoNames Miaogao / Suichang 居民点记录，第 140 项](https://www.geonames.org/search.html?country=CN&q=Li+Xian&startRow=100) |
| 丽水 · 松阳县 | 28.4508333，119.4897222 | [GeoNames Xiping / Songyang 居民点记录，第 142 项](https://www.geonames.org/search.html?country=CN&q=Li+Xian&startRow=100)  |
| 丽水 · 庆元县 | 27.611887，119.162844   | [GeoNames Qingyuan Xian 行政区参考点](https://www.geonames.org/search.html?country=CN&q=Li+Xian&startRow=50)                |

现有 74 个城市的粗粒度参考坐标继续保留，以便兼容已保存的 `precision: city` 数据；本次不会把旧城市记录自动改成区县记录。已知县名但尚无核对过的区县参考点时，仍可退回所属城市。例如缙云退回丽水，象山退回宁波。没有可靠地名则保持未定位。后续扩充目录必须补直接来源和对应测试，不以模型生成的数值代替地名数据。

## 识别与手动坐标

- 规则识别从项目名称、简称、描述、客户及别名取地名，优先目录中的区县。父城市名称不会使唯一的区县匹配变成歧义；两个区县或不同城市则保留候选，交给用户选择。
- 模型分析必须由用户主动触发并确认外部处理。发送已有描述字段，模型只能选择目录中的城市或区县 ID，并提供项目原文依据。服务端检查 ID、父城市、依据、字段和格式，不接受模型坐标、不自动保存。模型未配置时使用规则识别；演示模式也只用规则。
- `precision: point` 仅用于用户输入经纬度或手动地图选点。`source` 只能是 `text` / `map`，并分别保存 `coordinateSource: user-coordinates` / `manual-map`。点坐标不猜测所属城市，城市字段留空，用户确认后再保存为确认位置。
- 文字坐标格式为完整的 `121.8,29.9`（经度在前），或 `经度121.8 纬度29.9` / `纬度29.9 经度121.8`，也支持对应英文标签。只接受有限数值及合法范围，不扫描地址内普通数字，也不自动交换经纬度。输入按 WGS84 理解；暂不支持 GCJ-02 / BD-09 转换。
- 手动输入地址进行规则匹配后，仅保存目录位置和匹配地名摘要；用户明确输入的经纬度可保存为点。AI 候选依据保留已有项目描述中的短引证。正在编辑的文本可保留在本机编辑草稿，避免保存失败时丢失。

所有精度类型均可作为 `confirmed: false` 草稿；确认保存与版本检查沿用项目 API。字段可空或缺省，以兼容旧项目、旧编辑器、导入导出和历史恢复。
