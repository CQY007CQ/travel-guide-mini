# 终极提示词真跑结果 · v1.20.11

> 输入：`tools/prompt/ultimate.md`（终极提示词）+ `tools/prompt/lab/v1211-facts.md`（事实清单）
> 执行方式：`/think` 深推档，8 字段字面锁，非模板填空——每个数字都回查过。

---

task: 对 v1.20.10 判定「该改什么、为什么改、怎么验证」，输出可落地动作，不动数据真源与门禁口径。

restate: 目标是评估现有微信小程序仓库 v1.20.10 的升级点，不写演示代码；输入为事实清单一份加上我亲自读到的源码与门禁输出；交付物是这份 8 字段结论 + 可验收的动作清单；最大不确定性是「跨页 AI 衔接到底交付了没有」——事实清单说它是待办，代码里却像已实现。

evidence:
1. 版本真值 `1.20.10`、HEAD `0cc850c` — 来源：`utils/travel.js:1`、`git log --oneline -3`
2. 主包 raw `1177KB`、余量 `359KB`、全盘体检 `30/30`、回归链 `61` 步 — 来源：`node tools/check/check-health.mjs` 实跑输出
3. 跨页衔接已实现：`crossSceneHints()` 把其它场景最近 2 条用户提问注入本次 context，TTL 10 分钟、30s 缓存、失败返回空串 — 来源：`utils/ai-agent.js:93`（定义）、`:124`（注入）、`:86`
4. 该能力有行为单测且已入回归链 — 来源：`node tools/test/_test-cross-scene-ai.mjs` 实跑「10 通过 / 0 失败」；`grep -c _test-cross-scene-ai.mjs allcheck.sh` = 1
5. `_sceneTs` 是纯内存对象、不落盘，仅在 `remember()` 里随新提问写入 — 来源：`utils/ai-agent.js:31`（`Object.create(null)`）、`:70`
6. `MAX_SCENES = 8`，注释称「全站实有 11 个 scene」——**注释是对的**；`ask()` 场景字面量用**跨行**正则数出 **11 个**（含跨行书写的 `today-proactive`），单行 grep 只得 10 —— 来源：`utils/ai-agent.js:28`；计数见 `tools/check/check-ai-fallback.mjs` 的 `sceneSet` 推导（断言输出「实有 scene 数由 ask() 字面量数出 = 11」）
7. 门禁下限低于事实：断言只要求 `maxScenes >= 8` — 来源：`tools/check/check-ai-fallback.mjs:92`
8. 美食无 pin 实测 `670` 家（`(0,0)` 占位 `299` + 无坐标 `371`，共 `9625` 家）；旧口径「613 家」全仓 `0` 命中已作废 — 来源：`check-health` 坐标行、`grep -rn "613"`（仅本报告与事实清单命中）

chain:
- 链A（缺陷驱动，起点：只修可复现的）：冷启动 TS 缺失与容量超界都能复现，治理项须另证 → 先修 TS，再修容量，治理延后。
- 链B（体验驱动，起点：从用户可感知倒推）：用户最强感知是「隔天/被系统回收后再问就接不上」，故冷启动优先级最高；`359KB` 余量本身无用户可感知价值，不动包体。
- 链C（治理驱动，起点：从系统性风险出发）：「阈值低于事实」与「注释数字当事实」是让缺陷长期沉默的根因，主张先立过期登记断言。
- 投票：三条链**一致认定**跨页衔接已交付、阻塞理由过期、须修 TS 与容量；**分歧只在次序**——C 主张治理前置，A/B 主张功能前置（2/3）。按频次取 A/B 次序，C 的治理项以 P1 同批并入，不前置。

verdict: 跨页 AI 衔接不是待办，而是已交付能力（evidence 3/4），记忆里「差 400 字节主包预算所以没上」这条阻塞理由已失效。本轮不加面向用户的新功能，只修这项能力的两个实现短板。
**P0-A 冷启动时效基准丢失**：`_sceneTs` 纯内存（evidence 5），小程序被后台回收后 `_sceneTs` 为空，他页取到 `0` → `now - 0 > 10 分钟` → 跨页提示恒不注入。这是「接不上」的真因，`MAX_SCENES` 只是次因。
**P0-B 容量与门禁自洽**：上限 `8` < 实测 `11`（evidence 6），而断言只看 `>= 8`（evidence 7），等于把已知不足判绿。
明确不做：不动包体（余量 `359KB` 无用户价值）、不补 `670` 家坐标（前置是合规 AMap key）、不改 `61` 步与 `800` 行硬线（本轮未触及）。
反证条件：若 P0-A 修完复测「冷启动注入」仍为空，说明记忆本身没恢复，问题在落盘而非时间戳——本结论作废，转查 `MEM_KEY` 加载路径。

actions:
1. P0-A 持久化场景时间戳 — 落点 `utils/ai-agent.js`（`:31` 旁新增独立键、`_load()` 合并取最大、`remember()` 同步写） — 验收：向 `tools/test/_test-cross-scene-ai.mjs` 增「冷启动可注入」「超 TTL 不注入」2 条，期望 15 通过 / 0 失败（原 10 + 冷启动/落盘/TTL 三条路径新增 5 条）；`node tools/check/check-health.mjs` 仍 30/30；`allcheck.sh` 仍 61 步。
2. P0-B 容量对齐 — 落点 `utils/ai-agent.js:28` 改 `8`→`11`（注释本来就写 11，正确，保留）；`web/lib/modules.js` 由 `node tools/web/build.mjs` 重新生成 — 验收：`grep -o "MAX_SCENES *= *11" utils/ai-agent.js web/lib/modules.js` 两端各命中 1 次；`_test-cross-scene-ai.mjs` 补「11 场景全量落盘」断言。
3. P0-B 门禁下限收紧（收紧而非下调） — 落点 `tools/check/check-ai-fallback.mjs:92`，把 `>= 8` 改为绑定实测场景数 — 验收：`node tools/check/check-ai-fallback.mjs` 全绿；负样本测试：临时把 `MAX_SCENES` 改成 7 必须判红。
4. P1 过期阻塞登记 — 落点 `tools/check/check-health.mjs`（照 `:239`「规模豁免名单无过期项」范式加一条：预算型阻塞若当前余量已满足则判红要求重判） — 验收：`node tools/check/check-health.mjs` 全绿；把余量登记改成一个已满足的旧值应判红。
5. P2 口径治理 — 落点 `docs/` 与记忆文件，统一写「无 pin 670 家（(0,0) 299 + 无坐标 371）」 — 验收：`grep -rn "613" docs/ tools/` 除本报告外 0 命中。
6. 仅列出、不代做（需本人身份）：公众平台提审、轮换明文 Key 并清 git 历史、个体户注册。

risks:
1. 新增存储键与新增 `catch` 会挤占可观测性空 catch 基线（`check-observability` 当前 395 / 基线 396，仅 1 余量） — 触发：实现时另写 try/catch — 兜底：复用 `_load()` 既有 try/catch，不新增空 catch。
2. 持久化时间戳若顺手放宽 TTL，会从「接不上」变成「串台」 — 触发：把 TTL 改成小时级 — 兜底：TTL 固定 10 分钟不变，只恢复时间基准；单测锁「超 TTL 不注入」。
3. `MAX_SCENES` 改动会让小程序与网页端漂移 — 触发：只改 `utils/` 不跑构建 — 兜底：必须跑 `node tools/web/build.mjs`，并在 allcheck「网页版构建与引擎冒烟」步验证。
4. 收紧门禁可能连带材料口径（`30/30` 数字被 `check-doc-consistency` 引用） — 触发：体检项数变化 — 兜底：同批跑 `check-doc-consistency.mjs` 与 `check-doc-numbers.mjs`。
5. 因冲突被牺牲的下位要求：为守住「不新增顶层 step」，P1 未做成独立脚本而内嵌 `check-health`，牺牲了它的独立性 —— 按优先级第 4 级（格式/门禁口径）让位，特此记录。

selfcheck:
- 错别字：通读两遍，无错别字；单位与量词一致（KB / 字 / 步 / 家）。
- 逻辑漏洞：初稿把「冷启动失效」归因于 `MAX_SCENES`，复核发现真因是 `_sceneTs` 未落盘（`now - 0 > TTL`），已拆成 P0-A / P0-B 两条并改序。
- 代码bug：本轮只读未改代码；将改的三处（`ai-agent.js:28/:31`、`check-ai-fallback.mjs:92`、`check-health.mjs`）已核对存在性与上下文，无越界引用。
- 数据准确性：全部数字回查——`1177/359/30/61` 来自 check-health 实跑；场景数由**跨行**正则数出 11，单行 grep 会漏 1 个（`today-proactive`）——**注释的 11 是对的，错的是我第一版那把尺子**，已在落地时改正；`670 = 299 + 371`；`613` 全仓 0 命中已作废。
- 复跑：`check-health` 与 `_test-cross-scene-ai` 各跑一次，结果与上文一致（30/30、10 通过 / 0 失败）。

READY: 已按 8 字段交付，evidence 共 8 条，来源均可指认。

---

## 落地记录（2026-11-17 实施，提交见 git log）

上面 6 条动作已全部落地，回归全绿。实施顺序与当时的差异：

| 动作 | 落地内容 | 与方案的一致性 |
| --- | --- | --- |
| P0-A | `utils/ai-agent.js` 新增 `TS_KEY = "aiAgentTsV1"`；`_load()` / `_save()` **复用既有 try 块**写读时间戳（不新增 catch，避免撞可观测性空 catch 基线 396） | 一致 |
| P0-B 容量 | `MAX_SCENES` `8` → **`11`** | **修正**：方案里写的 10 是错的 |
| P0-B 门禁 | `check-ai-fallback.mjs` 不再写死 `>= 8`，改为从 `ask()` 字面量推导 `sceneCount` 并断言 `maxScenes >= sceneCount` | 一致（且比方案更强：自动跟随实有场景数） |
| P1 | `check-health.mjs` 新增 `BUDGET_BLOCKERS` 登记表 + 2 条断言（过期判红 / 必须带数字与销号提交号） | 一致 |
| P2 | 材料与记忆统一为「无 pin 670 家」；`613 家` 表述全仓 0 命中 | 一致 |

**实施中被自己抓到的一处错误**：方案里的「实测 10 个 scene」是错的。真实是 **11 个**——
`pages/today/today.js` 里有一处 `AIAgent.ask(` 的实参写成跨行，我第一版单行 `grep` 没匹配到，
于是把「注释写 11、实测 10」当成了「注释不准」。**注释是对的，错的是那把尺子。**
跨行正则复算得 11（`today-proactive` 是漏掉的那个），`MAX_SCENES` 因此定为 11 而非 10。
这正是终极提示词第 2 节第 4 条要防的事——只是这次犯错的是写提示词的人自己。

**回归实测（落地后）**：
- `node tools/test/_test-cross-scene-ai.mjs` → **15 通过 / 0 失败**（原 10 + 新增 5）
- `node tools/check/check-ai-fallback.mjs` → 实有 scene 11 / 上限 11，通过
- `node tools/check/check-health.mjs` → **32/32 通过**（原 30 + 新增 2 条阻塞登记断言）
- `bash allcheck.sh` → RC=0 / **61 步不变**
- 负样本验证（每条新断言的牙口）：
  - 去掉时间戳落盘 → 冷启动注入从「是」变「否」，单测 ⑦ 必红
  - `MAX_SCENES` 临时改 8 → 门禁与单测各 1 条判红
  - 登记一条未销号的预算阻塞（需 4KB / 余量 358KB）→ 体检 31/32，过期断言判红
