# 筛选性能：定点优化与明确收口

2026-10-13，针对 `6952c8135cc9510f9d47a93eb24724b28f4300ac` 的 200 项目 / 5000 叶子任务筛选缺口。本批没有削减数据、改统计口径、分页、虚拟化、隐藏现有行或放宽认证/权限；全部项目仍可搜索和编辑。**优化明显，但两轮筛选 p95 为 280.4 / 363.1ms，仍未达到 200ms。** 到此结束本批微优化，后续架构取舍需另定范围。

## 原因与改动

首页概览图在模板内筛选 5000 任务，每次列表搜索更新都重新逐任务计算工作区日期/周。独立构造计数显示，缩小/恢复一次分别创建约 35,002 / 35,234 个 Date 对象。把概览任务移至依赖任务、工作范围和时区的 computed，并在该计算中复用日期边界后，分别为 1 / 233。任务快照、范围和时区仍能使计算失效更新；工作范围与到期日、父子叶子任务口径不变。

每行数字与日期还反复构造 Intl 格式器。为数字和日期各添加最多 64 个条目的配置缓存，按语言和格式选项（包含最终时区）区分，淘汰最早条目。缓存仅持有格式器，不持有项目数据、用户值或输出字符串；独立诊断中筛选恢复的 NumberFormat / DateTimeFormat 构造从 313 / 200 降为 0 / 0。单元测试覆盖切换语言/时区、显式时区、UTC 日期值、可变选项、淘汰和无效选项拒绝。

大数据窄屏检查另发现英文四状态汇总在 390px 溢出 18px（小种子数字未触发）。窄屏汇总允许换行后保持完整文本和计数。这一行 CSS 只在窄屏媒体查询生效；下述 1536px 两轮计时在该修复前取得，桌面适用样式与计时逻辑未变，最终构建再执行完整宽窄屏正确性检查。

## 同一数据和方法

原 `scripts/measure-scale.mjs` 和 `scripts/reliability-fixture.mjs` 与基线完全相同；Git blob 分别为 `1437fffdf9eb1425e98fddff53d482af8d7a6061`、`4393e0624e1ffe886a2f78f2769a5200932b2914`。没有为达标修改采样边界或丢弃慢样本。

- 相同本地编译 HTTP/Fastify/SQLite，200 项目、5000 叶子任务，快照 1,641,075 字节；临时随机合成账号和数据库，结束清理，无真实模型。
- Node 24.19.0、Chromium 154.0.8037.57、Linux 6.18.44、Xeon Platinum 8573C，环境可见 5 CPU / 17.59 GiB，1536×1024、默认浅色；loopback、无 CPU/网络节流。共享运行环境，并非独占硬件。
- 20 次首屏：温热服务端、全新浏览器上下文无 HTTP 缓存、复用认证，从导航至 200 行存在并过两帧，不是 FCP/LCP。
- 40 次筛选：完整唯一名称缩小到一行，再清空恢复全部 200 行；输入事件至正确行数并过两帧，不含 Playwright 输入动作时间；p95 为 nearest-rank。
- 同步 20 个观察＝4 次写入 × 5 个独立可见会话，使用原有 20 秒轮询；同一写入内观察相关。另记录 20 次 HTTP 快照与 JSON 解析。
- 先重新测未优化基线，再顺序执行两轮优化测量；没有同时执行本任务的构建/其他测试。CPU 采样和构造计数另行执行，不混入正式计时。

## 本地完整结果

| p95 | 本次基线 6952c81 | 优化第 1 轮 | 优化第 2 轮 | 预算 |
| --- | ---: | ---: | ---: | ---: |
| 首屏 | 1919.7 ms | 1050.2 ms | 1155.1 ms | 3000 ms |
| 筛选：缩小/恢复合并 | 783.1 ms | **280.4 ms** | **363.1 ms** | **200 ms，未达到** |
| 只看缩小到一行 | 735.1 ms | 53.0 ms | 62.7 ms | 非独立验收预算 |
| 只看恢复 200 行 | 793.7 ms | 280.4 ms | 414.0 ms | 非独立验收预算 |
| 自动同步 | 20033.7 ms | 19967.7 ms | 19958.5 ms | 25000 ms |
| 快照请求和解析 | 61.8 ms | 60.2 ms | 140.6 ms | 未设 |

筛选最大值分别 932.4 / 328.0 / 565.4ms，全部保留。第 2 轮快照最大值也升至 255.3ms，说明主机波动不能忽略。上一批历史值 617ms 和本批同代码重测 783.1ms 均真实保留；不能选择较好一轮宣布稳定达标，也不将 loopback 或 CI 指标当生产 SLA。三次运行意外浏览器错误均为零。

原始样本：[本次基线](evidence/filter-before-6952.json)、[优化第 1 轮](evidence/filter-after-run1.json)、[优化第 2 轮](evidence/filter-after-run2.json)。历史结果仍在 [上一批验收报告](reliability-acceptance.md)。

## 剩余成本与取舍

恢复 200 行仍需 Vue 节点创建/挂载、样式和布局。三次独立 CDP CPU 采样能定位到 Vue patch/mount 和 DOM 属性/样式调用；大量原生 `(program)` 时间没有具体归类，不能武断全算为某个函数，也不能把采样耗时当正式基准。

另用浏览器临时样式做了五次 `contain: layout style` 探针。控制诊断 wall time 330–488ms，试验 218–248ms；不同诊断运行有主机噪声，不构成精确因果收益估计，两组也未稳定进入 200ms。该 CSS **没有加入产品**。CDP TaskDuration、ScriptDuration、LayoutDuration 有包含关系，不能相加。

当前证据支持结束局部热点修复，转入行复用/更新范围、分页或虚拟化等有明确状态与可访问性取舍的方案评估；并非证明不存在任何其他小优化。下一批须先决定是否维持全量 DOM、浏览器页内查找、滚动/焦点恢复与展开编辑器生命周期，再按相同方法验收。真实移动 CPU/慢网仍待测，不为跑分静默改变交互或统计。

诊断证据：[构造计数前](evidence/filter-constructors-before.json)、[构造计数后](evidence/filter-constructors-after.json)、[CPU 采样汇总](evidence/filter-cpu.json)、[布局控制](evidence/filter-layout-control.json)、[临时样式试验](evidence/filter-layout-trial.json)。

## 正确性与重现

新增编译产物检查 `scripts/check-scale-filter.mjs`：EN/中文 × 深/浅色 × 1536/390px，核对全量 ID、部分搜索、阶段+负责人组合、无结果、键盘重置、排序、今天口径、最后一行展开收起焦点、页面溢出、筛选栏/工作范围/末行的 scoped axe，以及意外浏览器错误。自动可访问性扫描不是人工读屏验收；模拟视口不是实际手机。

```bash
npm ci
npm run build
npx playwright install chromium
node scripts/measure-scale.mjs
node scripts/diagnose-filter.mjs
node scripts/profile-filter.mjs
node scripts/check-scale-filter.mjs
# 仅诊断，不用于正式计时
node scripts/profile-filter-cpu.mjs
node scripts/profile-filter.mjs --containment-trial
```

请顺序执行 CPU 密集检查。CI 保留所有样本，不把共享机器预算当功能断言；功能、精确结果集、溢出和可访问性断言失败仍会使 CI 失败。最终执行与截图见 [验证记录](verification.md)，未实现产品项及真实验收依赖见 [计划收口表](plan-closeout.md)。未部署、未合并、未调用付费模型或语音服务；原 Library 参考图未成功取得的边界不变，不能宣称逐像素一致。
