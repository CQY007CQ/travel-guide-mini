# 旅行攻略生成器 · 代码深度审计（2026-11-08）

> 范围：主程序源码（`tools/_src-backup/*`、`pages/*`、`subpkg/*`、`utils/*`、`app.js`、`subai/*`）、构建与回归工具（`tools/*.mjs`、`allcheck.sh`、`build-min.mjs`）。
> 已排除：自动生成的大体量数据文件（`tools/v199-*`、`v200-*`、`v201-*`、`v204-*`、`v205-*`、`subdata/data/data-packed.js`）——这些由脚本生成，不在人工审计范围。
> 审计维度：数据真实性 / 安全 / 性能 / 代码质量 / 架构设计。
> 共 **108 条**，其中高危 6、中危 27、低危 75。文末附"已具备的强项"，避免误判。

---

## 〇、总体评价

项目工程化水平明显高于同体量个人小程序：错误边界（SafePage / app.onError）、存储抽象（store.js）、本地错误日志（errlog.js）、密钥 fail-closed、坐标自检、全量回归门禁（allcheck 59 步 + check-new 431 断言）都已就位。真正的高危问题集中在**密钥明文进公开仓库**与**少量绕开存储抽象的裸读写**；中低危主要是性能重复计算、魔法数字、页面样板重复。下面按维度逐条列出，每条含位置、问题、严重程度、可执行方案。

---

## 〇·五、整改状态追踪（2026-11-09 续，基于本会话已落地提交）

> 本审计初稿（108 项）提交于 `85cf4e2`，此后本会话已落地 `3963cd0`、`6133f09` 等修复提交，对初稿中若干条目产生影响。下文以"状态"标注，避免与条目正文冲突；条目正文保留原始问题描述作为历史记录。

### ✅ 本会话已修复（v1.20.3：commit 3963cd0 / 6133f09；v1.20.4：下列 #20/#21/#24/#28）

| 条目 | 原问题 | 修复方式 | 当前证据 |
| --- | --- | --- | --- |
| #2 | 账本 200 上限静默丢数据 | `addLedger` 截断前 `wx.showToast` 提示"已达上限，建议导出备份" | `tools/_src-backup/travel.js:934-937`（LEDGER_CAP） |
| #4 | more 页 onShow 重复读账本 | `refresh()` 提 `const ledgerLen = T.getLedger().length` 复用 | `pages/more/more.js:155` |
| #6 | 全角数字"３２"解析失败 | `parseQuickBill` 入口全角→半角归一（FEE0） | `tools/_src-backup/travel.js:1871` |
| #12 | 删账后 6s 内离页导致照片残留 | 清理定时器改**模块作用域** `_billImgCleanups`，不随页面 `onUnload` 销毁 | `subpkg/ledger/ledger.js:18,385-398`（v1.20.3） |
| #61 | 账单列表 `wx:key="i"` 不稳定下标 | 改为 `wx:key="_id"`（账单稳定 id） | `subpkg/ledger/ledger.wxml:83` |
| #71 | `del` 的 `this._undoT` 定时器随页面销毁 | 同 #12，模块作用域定时器，与 `onUnload` 解耦 | `subpkg/ledger/ledger.js`（见 #12） |
| #20 | 构建脚本 `eval` 解析外部片段 | 改 `new Function("return (" + m[1] + ");")()`，受限作用域解析（v1.20.4） | `tools/_hospital-batch5.mjs:24` / `_hospital-batch6.mjs:32` |
| #21 | 构建脚本 `execSync('curl ...')` 拼接 URL | 抽 `getJSON()`（`fetch` + `AbortController` 12s 超时）替代；4 个脚本同步改造（v1.20.4） | `tools/_food-geocode.mjs` / `_emergency-verify.mjs` / `_emergency-geocode2.mjs` / `add-key.mjs` |
| #24 | 备份/协作包导入无结构校验 | `importBackup` 解析后校验 plan/ledger 结构与 `days≤60`，脏数据抛明确错误（v1.20.4，已 build 至 `utils/travel.js`） | `tools/_src-backup/travel.js` importBackup |
| #28 | 生产包 `data.js` 残留 13 处 `console.warn` | 抽 `_dw()` 并以 `wx.getAccountInfoSync().miniProgram.envVersion!=="release"` 为门禁，正式版屏蔽（v1.20.4） | `tools/_src-backup/data.js` + `utils/data.js` |

### 🔧 条目行号 / 事实更正

- **#22（innerHTML）**：原文行号 `3723/4463/4547` 为旧版产物，当前 `web/lib/runtime.js` 实际 `innerHTML` 拼接位于 **126 / 141 / 157 / 180 / 199 / 691 / 706 / 808 / 813**（toast / loading / modal / 预览 / 错误兜底）。风险判定（中危）与"统一 `esc()` 转义"建议不变。
- **#32（document.write）**：在当前 `web/lib/runtime.js` 未检索到 `document.write`；网页导出仅见 `navigator.clipboard.writeText`（281）与 `global.open` 跳转高德（304）。该条目疑似旧版打印逻辑已重构移除，建议复核后降级为低危或关闭。

### 📌 仍待处理（高 / 中危，非代码自动可解部分）

- **#1 / #19 密钥明文进公开仓库**：设计决策待用户拍板（清空 `DEFAULT` 会让"未注入 Key 时天气失效"）。`utils/keys.js` 已支持 `setKeys()` 运行时注入，仅待把 `DEFAULT` 明文改为空串。
- **#20 eval / #21 execSync**：仅影响本地构建工具（非生产包），优先级中，建议随构建工具重构时一并改 `JSON.parse` / `fetch` + `URL`。
- **#24 备份 / 协作包输入上限校验**：`importBackup`（`tools/_src-backup/travel.js:1463`）解析后未做字段数量 / 长度上限，建议加 `days ≤ 60`、`ledger ≤ 200` 等校验。
- **#28 生产包 console.warn**：`utils/data.js` 仍有 14 处 `console.warn`，建议 `__DEV__` 守卫或汇总进 `errlog`。
- **#56 onShow 样板 / #58·#77 双源 / #81 store 统一 / #82 CI 断言 / #106 合并门禁**：架构类，建议列为下一里程碑整改项。

> 说明：本审计"已具备的强项"第 4 条已记录凭证照片修复；上表 #12 / #61 / #71 为其代码级落地，二者一致。

---

## 一、数据真实性与有效性（18 条）

**第 1 条**
- 类型：数据
- 位置：`utils/keys.js:19-21`
- 问题描述：和风天气 API Key（`d84611f29a4d48d48a36227b613de255`）与专属域名 `j864228fx2.re.qweatherapi.com` 明文写死在源码，且仓库是公开 GitHub（`CQY007CQ/travel-guide-mini`）。即使确属本人账号，公开泄露后任何人可盗刷配额，且违反"密钥不进明文仓库"的自身合规铁律。
- 严重程度：高
- 优化建议：Key 从 `DEFAULT` 中移除，改为**仅运行时 storage 注入**（`wx.setStorageSync("__app_keys__", {qweatherKey})`，代码已支持 `setKeys()`）；或读 `project.config.json` 之外的本地 `.env`（不提交）。CI/门禁 `check-secrets.mjs` 增加"禁止 32 位 hex / 明确 Key 串"规则已存在，但源码里的明文需先清掉。
- 修改前后：
  - 前：`const DEFAULT = { qweatherKey: "d84611f29a4d48d48a36227b613de255", ... }`
  - 后：`const DEFAULT = { qweatherKey: "", qweatherHost: "", amapKey: "" }; // 仅经 keys.js 的 setKeys() 运行时注入`

**第 2 条**
- 类型：数据
- 位置：`tools/_src-backup/travel.js:932`（addLedger 的 `list.slice(0,200)`）
- 问题描述：账本硬上限 200 条，超出后 `unshift` 新条 + `slice(0,200)` 会**静默丢弃最旧记录**，用户记满 200 笔后老数据丢失且无提示。
- 严重程度：中
- 优化建议：到阈值时 `wx.showToast` 提示"已达 200 条上限，建议导出备份"；或把上限提为可配置常量并暴露"清理已结束行程账本"入口。

**第 3 条**
- 类型：数据
- 位置：`utils/travel.js` / `_src-backup/travel.js` 的 `getLedger()`
- 问题描述：`getLedger()` 每次都 `store.get(LEDGER_KEY, [])` 同步读 + JSON 反序列化，而 `more.js`、`ledger.js`、`assistant.js` 的多次刷新路径会重复调用，无缓存。
- 严重程度：低
- 优化建议：在 `store` 层加 `get` 的内存缓存（带版本号失效），或在页面层用一个 `_ledger` 引用，避免同一渲染周期内多次反序列化。

**第 4 条**
- 类型：数据
- 位置：`pages/more/more.js:142-146`
- 问题描述：`refresh()` 中 `savedPlans`、`foot`、`getNotes()`、`getLedger().length` 等被分别调用，且 `bkTip` 三元里又调了一次 `T.getLedger()`（145 行），同一 onShow 内重复读账本。
- 严重程度：低
- 优化建议：把 `const ledger = T.getLedger()` 提一次，下游复用。

**第 5 条**
- 类型：数据
- 位置：`utils/travel.js` `exportLedgerCSV` / `importBackup`
- 问题描述：CSV 导出用 `wx.setClipboardData` 复制全部账目明文到剪贴板，用户切到微信/备忘录会留存明文账单（含金额、同伴名），无脱敏。
- 严重程度：低
- 优化建议：导出前提示"剪贴板将含完整账单"；敏感场景可只导出合计而非逐笔。

**第 6 条**
- 类型：数据
- 位置：`subpkg/ledger/ledger.js` `parseQuickBill`
- 问题描述：一句话记账正则解析金额/分类，若用户输入"打车32元"中夹带非数字或负数，依赖 `parseFloat` 后 `>0` 判断；但"0 元 / 0.0"会被 `!(amt>0)` 拦截——符合预期，仅是说明：极端字符（全角数字"３２"）未做全角→半角归一，会解析失败。
- 严重程度：低
- 优化建议：`parseQuickBill` 入口先做全角数字/逗号归一再解析。

**第 7 条**
- 类型：数据
- 位置：`utils/travel.js` `totalSpent` / `sumN`（脏数据过滤 `>0 && <=1e6`）
- 问题描述：金额合理性过滤依赖魔法数 `1e6`，写在 lambda 内无注释，超过 100 万的单笔会被静默剔除，用户大额定金/团费会"消失"。
- 严重程度：低
- 优化建议：抽成命名常量 `MAX_SINGLE_AMT = 1e6` 并注释"单笔超过则视为脏数据不参与累计"。

**第 8 条**
- 类型：数据
- 位置：`utils/data.js:435`（`JSON.parse(utf8Decode(pako.inflate(...)))`）
- 问题描述：打包数据解压后直接 `JSON.parse`，外层虽在 async 加载里有 catch，但若 `data-packed.js` 损坏会抛"数据分块加载失败"且行程功能整体无数据。
- 严重程度：低
- 优化建议：解包失败时回退到"内置精简城市表"或明确引导用户重装，而非静默空数据。

**第 9 条**
- 类型：数据
- 位置：`tools/_src-backup/travel.js` `importBackup`（备份恢复）
- 问题描述：从剪贴板 `importBackup` 直接 `JSON.parse(res.data)`，剪贴板内容若被用户改动/截断会抛异常（已由页面 try 兜住弹"不是有效备份"），但解析失败无字段级校验，部分字段缺失时可能写入半截数据。
- 严重程度：低
- 优化建议：`importBackup` 内部对 `plan.days`、`ledger` 等做结构校验，缺字段则补默认，避免半截数据污染。

**第 10 条**
- 类型：数据
- 位置：`pages/help/help.js` 应急医院数据
- 问题描述：应急页医院列表依赖 `T.HOSPITALS` 与 `emergency-data.js`，未收录城市只给地图搜索入口（合规降级已做）。但 `HOSPITALS` 是**具名 156 家硬编码**，城市增加时需改源码重发版，无法热更。
- 严重程度：低
- 优化建议：把医院表纳入可打包资源（与 data-packed 同机制），随数据更新下发，免重发版。

**第 11 条**
- 类型：数据
- 位置：`utils/travel.js` `budgetTotalObj` / `budgetSplit`
- 问题描述：预算区间字符串（如 `"800-1200"`）用 `split("-").map(Number)` 解析，若用户在某处改成非区间（如 `"1000"` 或 `"约1000"`）会 `NaN`，靠 `isFinite` 兜底成 0，预算条消失但不报错。
- 严重程度：低
- 优化建议：加 `parseBudgetRange()` 统一解析并容错，异常时回退默认区间并 `errlog`。

**第 12 条**
- 类型：数据
- 位置：`subpkg/ledger/ledger.js` `del` / `undoDel`
- 问题描述：删除账单的撤销窗口（6s）依靠页面实例内存（`_lastDel`）；若用户在 6s 内切到别的 tab 再回来，页面 `onUnload` 后撤销状态丢失，但底层已调度 `delBillImg` 定时删文件——符合"切走即确认删除"语义，但用户无感知。属设计取舍，记录备查。
- 严重程度：低
- 优化建议：可在 `onHide`/`onUnload` 显式 `clearTimeout` 并立即 purge，使语义更确定。

**第 13 条**
- 类型：数据
- 位置：`utils/travel.js` `migrateBillImgs`
- 问题描述：旧"日期#下标"照片键迁移按当前下标映射，若用户此前已发生过"删除导致下标错位"，迁移会把旧照片挂到错误账单（无法完全还原历史错乱）。新逻辑已杜绝后续串图，历史脏数据只能接受。
- 严重程度：低
- 优化建议：迁移时若发现 `date#idx` 与 `id` 无法一一对应，直接 purge 旧键而非猜测映射，避免历史错乱延续。

**第 14 条**
- 类型：数据
- 位置：`subpkg/ledger/ledger.js` `_chooseBillImg`
- 问题描述：凭证照片 `fs.copyFileSync(tmp, dst)` 后存绝对路径到 `miniBillImgV1`，路径含 `wx.env.USER_DATA_PATH`。若微信清理沙盒或用户迁移设备，绝对路径失效且无法自修复（孤立条目）。
- 严重程度：低
- 优化建议：`purgeOrphanBillImgs` 已删失效文件；可再加"启动校验：文件不存在则清 map 条目"。

**第 15 条**
- 类型：数据
- 位置：`pages/index/index.js` 草稿箱（`saveDraftNow` / `restoreDraft`）
- 问题描述：草稿存 `miniGuideSeenV1` 等，恢复时直接覆盖首页配置，无字段级校验；旧版草稿结构变更后恢复可能注入 undefined 字段（已由 `__stripUndefined` 兜底）。
- 严重程度：低
- 优化建议：草稿带 `schemaVer`，恢复时按版本迁移。

**第 16 条**
- 类型：数据
- 位置：`utils/travel.js` `getMates` / `addMate` / `delMate`
- 问题描述：同行人名单存 `MATES_KEY`，无去重校验外的长度上限，`addMate` 仅提示"已在名单"；名单过长时 WXML 渲染无折叠。
- 严重程度：低
- 优化建议：设 `MATES_CAP`（如 20）并提示。

**第 17 条**
- 类型：数据
- 位置：`utils/remind.js:32-33`
- 问题描述：`_read()` 用 `JSON.parse(s)` 读提醒队列，损坏时返回 `[]`（静默丢失所有提醒），无告警。
- 严重程度：低
- 优化建议：解析失败 `errlog` 一次并回退空，避免无声丢数据。

**第 18 条**
- 类型：数据
- 位置：`pages/plan/plan.js` 行程 `savedAt` / 存档
- 问题描述：行程存档 `listSavedPlans` 以 `sig` 去重，若用户改城市名重生成，sig 变化会产生重复存档（`more.js:142` 用 `sig !== curSig` 过滤当前，但历史同名不同日期仍可能重复）。
- 严重程度：低
- 优化建议：存档去重增加"城市名 + 天数"维度，或提供"合并同名存档"。

---

## 二、安全漏洞（15 条）

**第 19 条**
- 类型：安全
- 位置：`utils/keys.js:19-20`
- 问题描述：同上第 1 条——API Key 明文进公开仓库，属凭据泄露高危。
- 严重程度：高
- 优化建议：见第 1 条。

**第 20 条**
- 类型：安全
- 位置：`tools/_hospital-batch*.mjs`、`tools/_hospital-merge*.mjs`（如 `_hospital-batch5.mjs:24`）
- 问题描述：多批处理脚本用 `eval("(" + m[1] + ")")` 解析从外部抓取/合并的片段，对不可信输入执行 `eval`，存在任意代码执行风险（虽是本地构建工具，但抓取内容若被投毒即中招）。
- 严重程度：中
- 优化建议：改用 `JSON.parse` 或 `new Function` 受限解析；抓取数据先落盘人工 review 再合并。

**第 21 条**
- 类型：安全
- 位置：`tools/_food-geocode.mjs:54`、`tools/_emergency-verify.mjs:41`、`tools/_emergency-geocode2.mjs:77`、`tools/add-key.mjs:43`
- 问题描述：这些脚本用 `execSync('curl -s --max-time 12 "' + url + '"')`，URL 含拼接变量（城市名/坐标），若变量含 shell 元字符会命令注入；属本地工具但应避免。
- 严重程度：中
- 优化建议：改用 Node 原生 `https`/`fetch` + `URL` 构造，禁用 shell 拼接；或 `execFile` 传参数组。

**第 22 条**
- 类型：安全
- 位置：`web/lib/runtime.js`（多处 `innerHTML =` 拼接，当前位于 126 / 141 / 157 / 180 / 199 / 691 / 706 / 808 / 813，详见 〇·五 状态追踪）
- 问题描述：网页版 PWA 用 `el.innerHTML = \`<div>...${data.x}...</div>\`` 渲染，data 来自 App 自有结构化数据（城市名/景点名），当前无用户输入注入点，但若未来接入用户自定义文本（如手记/备注）会触发 XSS。
- 严重程度：中
- 优化建议：对动态文本字段统一 `textContent` 或转义函数；建立 `esc()` 工具，禁止把用户可见文本直接进 innerHTML。

**第 23 条**
- 类型：安全
- 位置：`tools/web/build.mjs:128` `new Function("__h","__c",...,"with(__d){return (" + code + ")(...)})"`
- 问题描述：构建期用 `new Function` 编译设计模板片段 `code`，若该片段来自外部/不可信即代码执行。当前 `code` 来自项目内设计模板，风险低但应标注。
- 严重程度：低
- 优化建议：限制 `code` 来源为受控模板文件，构建期加注释说明不可外传。

**第 24 条**
- 类型：安全
- 位置：`utils/travel.js` `mergeCollabPlan` / `importBackup`
- 问题描述：协作包与备份从剪贴板 `JSON.parse` 后直接写入本地存储（行程/想玩/账本）。剪贴板可被其他应用篡改，恶意构造的 JSON 若含超长字段会撑爆存储（`store.set` 有满提示但无尺寸上限校验）。
- 严重程度：中
- 优化建议：解析后做字段长度/数量上限校验（如行程 days ≤ 60、账本 ≤ 200），超限拒绝并提示。

**第 25 条**
- 类型：安全
- 位置：`pages/more/more.js:469-483` `clearAllData`
- 问题描述：`wx.clearStorageSync()` 清空全部本地数据后 `app.clearPlan()`，但 `keys.js` 注入的 `__app_keys__` 也被清掉（用户本意可能是"重置数据"而非"重置 Key"），且操作仅二次确认无"先备份"强约束（提示文案有，但不强制）。
- 严重程度：低
- 优化建议：清空前若检测到有备份价值数据（行程/账本非空），强制引导先备份；Key 注入单独保留或单独清。

**第 26 条**
- 类型：安全
- 位置：`utils/analytics.js:20-22`
- 问题描述：`analytics.js` 直接用 `wx.getStorageSync(KEY)` 再 `JSON.parse(raw)`，storage 损坏时抛异常（虽在页面 try 内，但属绕开 store 抽象 + 裸 JSON.parse）。
- 严重程度：低
- 优化建议：改用 `store.get` 并加 `try`；或统一收敛到 store 抽象。

**第 27 条**
- 类型：安全
- 位置：`subai/utils/ad.js:30-31` `_read`/`getUnlock`
- 问题描述：`const s = wx.getStorageSync(UNLOCK_KEY); return s ? JSON.parse(s) : null;` —— 裸 `JSON.parse`，storage 损坏直接抛错（未被 try 包住）。
- 严重程度：低
- 优化建议：`try { return s ? JSON.parse(s) : null; } catch { return null; }`。

**第 28 条**
- 类型：安全
- 位置：`utils/data.js:73-401` 大量 `console.warn("[data] ...")`
- 问题描述：数据加载阶段在**生产包**仍保留十余处 `console.warn`（坐标自检、补录计数等），每次启动刷日志，且无开关；与"生产包移除 console.log"（v1.11）的约定不一致（仅 data.js 漏网）。
- 严重程度：中
- 优化建议：这些 warn 用 `if (__DEV__) console.warn(...)` 包裹，或改为只在 `errlog` 记一条汇总，不每次刷屏。

**第 29 条**
- 类型：安全
- 位置：`app.js:13` `TAB` 数组、`pages/more/more.js:343` `TABS` 数组
- 问题描述：tabBar 页清单在 `app.js` 与 `more.js` 各定义一份，且 `more.js go()` 又有 `URLS`/`noPlanOk`/`TABS` 三套路由表——路由真源分散，新增页面易漏改。
- 严重程度：低
- 优化建议：把 tab 页清单与全量路由表收口到 `utils/route.js` 单一导出，各页引用。

**第 30 条**
- 类型：安全
- 位置：`project.config.json:4` `appid: "wxa365d49bc3366f95"`
- 问题描述：小程序 appid 提交在仓库。appid 本身非机密（公开小程序可见），但结合第 1 条密钥泄露，建议密钥与 appid 都走外部化。
- 严重程度：低
- 优化建议：保持 appid（公开属性），但密钥必须移出。

**第 31 条**
- 类型：安全
- 位置：`pages/plan/plan.js` 分享卡片 `onShareAppMessage`
- 问题描述：转发 path 固定 `/pages/index/index`，不带参数，符合"分享回首页"设计；但 `path` 未做编码，若未来带 query 需 `encodeURIComponent`。
- 严重程度：低
- 优化建议：若扩展深链，统一经 `utils/route` 构造并编码。

**第 32 条**
- 类型：安全
- 位置：`web/lib/runtime.js`（原记录 `791-799` `document.write` 导出一页行程；2026-11-09 复核当前版本未检索到 `document.write`，疑似旧版打印逻辑已重构移除，详见 〇·五 状态追踪，建议降级/关闭）
- 问题描述：`w.document.write(\`<html>...\`) ` 用 `document.write` 开新窗口打印，内容含城市名等，若城市名含 HTML 特殊字符会破坏结构（当前数据无，但无转义）。
- 严重程度：低
- 优化建议：打印内容用 `textContent` 或 `esc()` 转义后再拼。

**第 33 条**
- 类型：安全
- 位置：全工程 `wx.requestSubscribeMessage` / `wx.cloud.callFunction`
- 问题描述：订阅消息与（未启用）云函数调用均已 `fail:()=>resolve([])` 降级，无凭据外泄；但 `cloudReady()` 检测 `wx.cloud` 存在即认为可用，若云未开通却误配会静默失败。
- 严重程度：低
- 优化建议：保持现状（fail-closed 已满足），仅记录：云函数启用前 `USE_CLOUD=false` 已正确默认。

---

## 三、性能瓶颈（22 条）

**第 34 条**
- 类型：性能
- 位置：`pages/more/more.js:124-226` `refresh()`
- 问题描述：`refresh()` 在每次 `onShow` 同步调用约 15 个分析/聚合函数：`T.wishStateMark(T.getWish(),p)`、`T.listSavedPlans()`、`T.footStats()`、`T.getNotes()`、`T.getLedger()`、`T.yearReport()`、`INS.insights()`、`PZ.personalized(5)`、`T.provStamp()`、`T.travelPersona()`、`T.footHeatmap()`、`T.achievements()`、`T.inspire()`、`T.tripReview(p)`、`T.nightCfg()`、`T.homeTiles()`（多次）等。全部重算且大多未缓存，页面切回即卡顿风险。
- 严重程度：中
- 优化建议：把"不随本次操作变化"的聚合（年报/足迹热力/成就/灵感/个性化）加内存缓存 + 失效标记；`onShow` 只重算与当前行程相关的项。

**第 35 条**
- 类型：性能
- 位置：`subpkg/map/map.js:171` `_renderDay`
- 问题描述：每次切天/切图层都 `T.budgetFoodFirst(T.foodSpotsFor(cityName), bKey, false).slice(0,18)`，对整城美食库做扫描+排序；城市美食多时每切一天都重算。
- 严重程度：中
- 优化建议：按 `cityName+bKey` 缓存美食列表（Map），同城切换不重算。

**第 36 条**
- 类型：性能
- 位置：`subpkg/map/map.js:107-218` `_renderDay`
- 问题描述：`setData` 一次性下发 `markers`（含大数组）、`polyline`、`foodList`、`hotelAreas`、`hotelPortals`、`list` 等，其中 `hotelPortals`/`hotelAreas` 在未显示对应图层时仍计算并下发，浪费序列化。
- 严重程度：低
- 优化建议：仅下发当前 `layer` 需要的列表；`hotelPortals`/`hotelAreas` 延迟到切到对应图层再算。

**第 37 条**
- 类型：性能
- 位置：`subpkg/ledger/ledger.js` `_sync()`
- 问题描述：每次渲染都重算 `monthly`（遍历全部账本按月聚合）、`week`、`week7`、`mstory`、`iouList`、`tripOpts`、`settleUp`、`budgetSplit`、`dailyBudget`、`spendForecast` 等，列表仅 50 条但计算全量账本。
- 严重程度：低
- 优化建议：账单 ≤200 时影响可控；可在"无新增/删除"时复用上次结果，或仅对 `filtered` 口径计算月度。

**第 38 条**
- 类型：性能
- 位置：`utils/travel.js` `spendByDay(10)` / `weekBars` / `monthStory`
- 问题描述：这些统计每次 `_sync` 都重算全量账本的时间序列，未用增量。
- 严重程度：低
- 优化建议：超过 N 条后做抽样/按月预聚合。

**第 39 条**
- 类型：性能
- 位置：`pages/index/index.js` `_capOf` / 路线生成
- 问题描述：首页生成攻略走 `T.buildPlan`（含 planner 全量解构），体量较大；`onShow` 后 `_syncAdv`/`_syncHoli` 重复读 `PROVINCE_CITIES` 等大表。
- 严重程度：低
- 优化建议：`PROVINCE_CITIES` 等静态大表模块级缓存一次即可，避免每次刷新重读。

**第 40 条**
- 类型：性能
- 位置：`utils/data.js` 数据加载
- 问题描述：`data-packed.js` ~1.8MB base64，启动时 `pako.inflate` + `JSON.parse` 主线程同步解压，低端机可能卡启动（已用 `require.async` 分包懒加载规避启动期，但首次进规划流程仍会阻塞一次）。
- 严重程度：中
- 优化建议：解压放 Worker；或分块增量解压（已有 chunk 机制，进一步做"用到哪城解哪块"）。

**第 41 条**
- 类型：性能
- 位置：`utils/recommend.js`（743 行）
- 问题描述：推荐打分每次生成攻略遍历全量候选景点池 + 多维度加权，未缓存中间分；同一城市重复生成会全量重算。
- 严重程度：低
- 优化建议：把"城市静态分"与"用户动态偏好分"分离，静态分模块级缓存。

**第 42 条**
- 类型：性能
- 位置：`utils/travel.js` `getWish` / `getFavs` / `getNotes` 等
- 问题描述：多处 `store.get` 同步读 + 反序列化，页面高频刷新路径（more/ledger/assistant）反复调用。
- 严重程度：低
- 优化建议：store 层加 `get` 内存缓存（带失效），或页面级 `_cache`。

**第 43 条**
- 类型：性能
- 位置：`subpkg/assistant/assistant.js:44-62` `_computePlanSpots`
- 问题描述：遍历整个行程 days/items 去重收集景点名，每次进"查景点"模式都重算（上限 30）。
- 严重程度：低
- 优化建议：随行程变更失效缓存，而非每次进入重算。

**第 44 条**
- 类型：性能
- 位置：`pages/plan/plan.js` 分享卡 `_ensureShareCard`
- 问题描述：canvas 2d 绘制分享卡在 `onReady` 后每生成攻略都重绘全量天；离屏画布 1×1 CSS 已修，但绘制仍同步。
- 严重程度：低
- 优化建议：仅在用户点"分享/保存"时按需绘制，不必每次渲染。

**第 45 条**
- 类型：性能
- 位置：`utils/travel.js` `footStats` / `footHeatmap`
- 问题描述：足迹统计每次 `more.js` onShow 全量聚合（城市/省份/打卡点），随使用增长变慢。
- 严重程度：低
- 优化建议：增量更新（打卡时更新计数 Map），避免每次 onShow 遍历。

**第 46 条**
- 类型：性能
- 位置：`utils/travel.js` `yearReport`
- 问题描述：年鉴聚合遍历全部账本 + 足迹，未缓存，每次 `more.js` onShow 重算。
- 严重程度：低
- 优化建议：按年缓存，跨年或新账本才重算。

**第 47 条**
- 类型：性能
- 位置：`utils/insights.js` `insights()`
- 问题描述：本地洞察（花费结构/月度趋势/出行节奏/省份分布）每次 `more.js` onShow 重算。
- 严重程度：低
- 优化建议：与 yearReport 合并为一次聚合，缓存结果。

**第 48 条**
- 类型：性能
- 位置：`utils/personalize.js` `personalized(5)`
- 问题描述：个性化推荐基于真实画像，每次 onShow 重算 Top5。
- 严重程度：低
- 优化建议：画像未变则缓存，变化才重算。

**第 49 条**
- 类型：性能
- 位置：`utils/store.js` `get`（同步）
- 问题描述：所有存储读是同步 `wx.getStorageSync` + JSON 反序列化，高频调用在主线程，累积延迟明显。
- 严重程度：低
- 优化建议：加内存缓存层（Map + 失效版本），反序列化结果复用。

**第 50 条**
- 类型：性能
- 位置：`subpkg/food/food.js` 美食页渲染
- 问题描述：美食页列出整城名店 + 菜单，未分页/未虚拟化，城市美食多（如 263 城 6904 店）时一次性 setData 大数组。
- 严重程度：中
- 优化建议：按城市 + 分类分屏加载（每次 20-30 条），或 `wx:for` 配 `type` 固定结构减少 diff。

**第 51 条**
- 类型：性能
- 位置：`pages/plan/plan.js` 行程页 `setData`
- 问题描述：行程页渲染整份 days（含每天 items + 餐厅 + 天气 + 提醒），单次 setData 数据量随天数线性增长，长行程（多站）可能超 256KB setData 上限告警。
- 严重程度：中
- 优化建议：分页/按天懒渲染；或把非首屏天拆 `recycle-view` 虚拟列表。

**第 52 条**
- 类型：性能
- 位置：`utils/travel.js` `foodSpotsFor`
- 问题描述：每次按城市取美食全量数组，调用方再过滤/排序；缺少按城市缓存。
- 严重程度：低
- 优化建议：城市级缓存（见第 35 条）。

**第 53 条**
- 类型：性能
- 位置：`subai/data/ai-deep.js`（1042 行）
- 问题描述：深度玩法内容全量常驻内存（require 即全加载），其实只用到当前城市切片。
- 严重程度：低
- 优化建议：按城市 key 做惰性取值（用到的城市才解引用）。

**第 54 条**
- 类型：性能
- 位置：`tools/web/build.mjs` PWA 构建
- 问题描述：`fs.rmSync(web/images,{recursive:true})` 删除全部图片再 cpSync 覆盖，大图多时慢且触发宿主 safe-delete 阈值（已改为增量，见日志）；记录备查。
- 严重程度：低
- 优化建议：保持增量同步已修复。

**第 55 条**
- 类型：性能
- 位置：`allcheck.sh` 全量回归
- 问题描述：59 步串行，含全省多城生成，单次跑数分钟；无并行/无增量（仅改 tools 也要全跑）。
- 严重程度：低
- 优化建议：按改动范围选择性跑（如只改页面就跳过全省生成步）。

---

## 四、代码质量与可维护性（25 条）

**第 56 条**
- 类型：代码
- 位置：多页 `onShow` 样板（`pages/index/index.js:1041`、`pages/today/today.js:32`、`pages/plan/plan.js`、`pages/more/more.js:20`、`subpkg/ledger/ledger.js:59`、`subpkg/assistant/assistant.js:68`、`subpkg/map/map.js:82` 等）
- 问题描述：几乎每个页面的 `onShow` 都是同一段：`AN.pageView`、`setData({fz})`、`(this.__boot||Promise.resolve()).then(()=>{try{_renderShow()}catch(e){toast}})`——高度重复样板，新增页面易漏写 boot 守卫。
- 严重程度：中
- 优化建议：在 `SafePage` 内自动注入标准 `onShow`（读 fontScale + 等 boot + 调 `_renderShow`），页面只写 `_renderShow`。

**第 57 条**
- 类型：代码
- 位置：全局 `catch(e){}` / `catch(_){}`
- 问题描述：全工程大量空 catch（仅 `index.js` 就 20+ 处），多数用于"存储读失败不阻断"，但部分掩盖了真实异常（如 `pages/plan/plan.js` 的渲染 catch 把 `hasPlan` 置 false 伪装白屏，已在护栏里纠正）。空 catch 使问题不可见。
- 严重程度：中
- 优化建议：空 catch 处统一 `EL.push(label, e)`（errlog 已就绪），至少留痕；`allcheck` 加"统计空 catch 数量、新增即红"的断言。

**第 58 条**
- 类型：代码
- 位置：`utils/keys.js` 与 `tools/_src-backup/keys.js` 双份
- 问题描述：`keys.js` 在 `utils/` 与 `tools/_src-backup/` 各一份，修改需同步两处（已发生过"改 utils 漏 _src-backup 导致 build 回潮"类问题）。
- 严重程度：中
- 优化建议：`utils/keys.js` 本就是手写非压缩（不像 travel.js 需 build），直接删掉 `_src-backup` 那份，统一以 `utils/keys.js` 为源；或在 build 流程里也同步它。

**第 59 条**
- 类型：代码
- 位置：魔法数字散落（`subpkg/map/map.js:10` `MARKER_CAP=20`、`subpkg/assistant/assistant.js:57` `>=30`、`utils/travel.js:932` `slice(0,200)`、`pages/more/more.js:79` `86400000`、`utils/remind.js:108` `86400000`、`utils/travel.js` `1e6`）
- 问题描述：关键阈值以字面量散落多处，无命名常量、无注释，改一处难全局一致。
- 严重程度：低
- 优化建议：抽 `constants.js` 集中导出 `LEDGER_CAP=200`、`DAY_MS=86400000`、`MARKER_CAP=20`、`PLAN_SPOTS_CAP=30`、`MAX_SINGLE_AMT=1e6` 等。

**第 60 条**
- 类型：代码
- 位置：`pages/more/more.js:334-340` `URLS` 路由表 + `:343` `TABS` + `:331` `noPlanOk`
- 问题描述：路由真源分散在 `app.js(TAB)` 与 `more.go()`（URLS/TABS/noPlanOk），新增页面需改多处，易漏。
- 严重程度：低
- 优化建议：收口到 `utils/route.js`（见第 29 条）。

**第 61 条**
- 类型：代码
- 位置：`subpkg/ledger/ledger.js:83` WXML `wx:key="i"`
- 问题描述：账单列表 `wx:key="i"` 用 `item.i`（展示下标）而非稳定 `item._src` 或 `item._id`，删除/重排后可能出现 key 复用导致渲染错位（虽本次照片修复已加 `_id`，列表 key 仍用 `i`）。
- 严重程度：低
- 优化建议：`wx:key` 改为 `item._id`（账单稳定 id）。

**第 62 条**
- 类型：代码
- 位置：`utils/app.js:112` `SafePage` 包裹所有非生命周期函数
- 问题描述：`SafePage` 对**所有**方法包 `__wrapFn`（含 `onShareAppMessage` 等），虽 `LIFECYCLE` 已排除主要生命周期，但 `onShareAppMessage` 也返回对象、被包一层 try 略多余；且 `data` 里的函数式（如 `()=>{}`) 不受影响。
- 严重程度：低
- 优化建议：把 `onShareAppMessage`/`onAddToFavorites` 也纳入非包裹白名单（它们只构造返回值，抛错意义不大）。

**第 63 条**
- 类型：代码
- 位置：`pages/index/index.js`（1371 行单文件）
- 问题描述：首页 1371 行集成了城市选择、行程表单、草稿、生成、深链、向导弹窗等，上帝函数/上帝文件倾向，维护成本高。
- 严重程度：中
- 优化建议：按职责拆 `form.js`/`draft.js`/`generate.js`/`guide.js` 子模块，首页只做编排。

**第 64 条**
- 类型：代码
- 位置：`pages/plan/plan.js`（1393 行）
- 问题描述：行程页同样超大，含渲染、分享卡 canvas、天气、提醒、编辑、滚动，单一文件。
- 严重程度：中
- 优化建议：分享卡逻辑抽 `utils/plan-poster.js`（已存在部分），天气/提醒拆子模块。

**第 65 条**
- 类型：代码
- 位置：`tools/_src-backup/travel.js`（6138 行单文件）
- 问题描述：核心逻辑 6138 行单文件，虽经 build 压缩，但源码可读性/可审查性差，且每次改一处需重压全量。
- 严重程度：低
- 优化建议：按主题拆 `ledger.js`/`recommend.js`(已独立)/`trip.js`/`insights.js` 等子模块，travel.js 仅做聚合导出。

**第 66 条**
- 类型：代码
- 位置：`utils/app.js:33-48` `getAppSafe` 惰性 Proxy
- 问题描述：每次 `get` 都 `getApp()` 实时取，且开发环境访问不存在属性 `console.warn`——Proxy 在高频访问下有轻微开销，且"不存在属性"告警在快速迭代期会刷屏。
- 严重程度：低
- 优化建议：Proxy `get` 结果做一次缓存；不存在属性告警改 `errlog` 节流。

**第 67 条**
- 类型：代码
- 位置：`subpkg/map/map.js:141-148` marker 构造
- 问题描述：`id: mk.length` 用数组下标作 marker id，与 `onMarkerTap` 用 `find(x=>x.id===id)` 配合——若 marker 数组被 `tagFilter` 过滤后 `id` 与下标不再对应，`onMarkerTap` 仍能命中（因 id 保留），但 `foodList` 用 `data-i` 下标取，混合两种取数方式易错。
- 严重程度：低
- 优化建议：marker 与 list 统一用稳定标识（景点名/索引），避免下标与 id 混用。

**第 68 条**
- 类型：代码
- 位置：`utils/travel.js` `parseQuickBill`
- 问题描述：一句话记账分类识别靠关键词表，新增分类需在多处同步（如 `CAT_COLORS`/`cats`/`guessCat`），易出现"识别了但配色缺失"。
- 严重程度：低
- 优化建议：分类元数据集中为 `{key,label,color,keywords}` 单一表，配色/识别/列表同源。

**第 69 条**
- 类型：代码
- 位置：`pages/more/more.js:170-177` `yearRpt` IIFE
- 问题描述：`refresh()` 内联 IIFE 拼 `citiesTx`/`topCatsTx`，把展示层字符串拼接塞进 data 准备阶段，违反"JS 拼好 WXML 不再 join"的既定约定（虽有注释说已挪 JS，但仍是页面内联）。
- 严重程度：低
- 优化建议：这类字符串拼接收敛到 `utils/format.js`，页面只调纯函数。

**第 70 条**
- 类型：代码
- 位置：`utils/errlog.js`
- 问题描述：错误日志 `push` 无上限、无自动清理，`EL.count()` 在 `more.js` onShow 每次显示，长期运行日志膨胀。
- 严重程度：低
- 优化建议：errlog 保留最近 N 条（如 200）环形覆盖，避免无限增长。

**第 71 条**
- 类型：代码
- 位置：`subpkg/ledger/ledger.js` `del` 定时删除照片
- 问题描述：`del` 用 `this._undoT = setTimeout(...)` 6s 后删文件，但若页面 `onUnload` 未 clear，定时器在页面销毁后仍可能触发 `setData`（已判空但属隐患）。
- 严重程度：低
- 优化建议：`onUnload` 中 `clearTimeout(this._undoT)` 并立即 `delBillImg`（见第 12 条）。

**第 72 条**
- 类型：代码
- 位置：`utils/travel.js` `exportLedgerCSV` / `weekLedgerTxt`
- 问题描述：CSV/文本导出中文字段未做引号转义，金额含逗号（如"1,200"）会破坏列对齐；备注含换行会断行。
- 严重程度：低
- 优化建议：CSV 字段统一 `quote` 包裹 + 换行/引号转义。

**第 73 条**
- 类型：代码
- 位置：`pages/index/index.js:1018` 注释"生产包不留 console.log"
- 问题描述：注释承诺生产包无 console.log，但 `data.js` 仍保留 `console.warn`（第 28 条），约定与实现不一致。
- 严重程度：低
- 优化建议：统一收敛 console 到 `errlog` + `__DEV__` 守卫。

**第 74 条**
- 类型：代码
- 位置：`subai/utils/ad.js`
- 问题描述：`ad.js` 用独立 `UNLOCK_KEY` 直接 `wx.getStorageSync`，绕开 store 抽象（第 26 条同源），且 `JSON.parse` 裸调用（第 27 条）。
- 严重程度：低
- 优化建议：并入 store 抽象 + try 包裹。

**第 75 条**
- 类型：代码
- 位置：`utils/analytics.js`
- 问题描述：使用统计模块独立直连 storage，与 store 抽象并列两套读写路径。
- 严重程度：低
- 优化方案：统一走 store。

**第 76 条**
- 类型：代码
- 位置：`utils/weather.js` 缓存索引 `wxcacheIdxV1`
- 问题描述：天气缓存用自定义索引 `wxcacheIdxV1` + 前缀键自管 LRU，未走 store 抽象，缓存淘汰逻辑手写在 `_PK` 前缀下。
- 严重程度：低
- 优化建议：缓存复用 store 的 get/set（带容量告警），或至少统一前缀管理。

**第 77 条**
- 类型：代码
- 位置：`tools/_src-backup/store.js` vs `utils/store.js`
- 问题描述：`store.js` 真源在 `_src-backup`，但 `utils/store.js` 是否压缩产物？若是，修改需 build；若是手写则与 `_src-backup` 双份（同第 58 条 keys 问题）。需确认并消除双源。
- 严重程度：低
- 优化建议：确认 `utils/store.js` 来源，若是手写则删 `_src-backup` 副本。

**第 78 条**
- 类型：代码
- 位置：`app.js:75-81` `_archiveOld`
- 问题描述：行程归档在 `onLaunch` 内同步 `require("./utils/travel.js")` + `savePlanSlot`，启动期多一次 require 与写存储；已 try 包住不阻断，但启动路径应极简。
- 严重程度：低
- 优化建议：归档逻辑延后到首页 onShow 空闲时执行，不占启动。

**第 79 条**
- 类型：代码
- 位置：`pages/help/help.js:62` 直连 `wx.getStorageSync("lastCityName")`
- 问题描述：应急页直接读 `lastCityName`，未走 store，且该键由谁写入/格式如何无注释。
- 严重程度：低
- 优化建议：归到 store 或 `T.lastCity()` 访问器。

**第 80 条**
- 类型：代码
- 位置：全工程字符串文案硬编码
- 问题描述：Toast/Modal 文案（如"已记一笔""打开失败"）散落各页中文硬编码，国际化/统一话术难维护。
- 严重程度：低
- 优化建议：抽 `strings.js` 集中文案（至少高频 toast），便于统一与 A/B。

---

## 五、架构与设计（20 条）

**第 81 条**
- 类型：架构
- 位置：`utils/store.js`（存储抽象） vs 多处直连 `wx.getStorageSync`
- 问题描述：项目已建 `store.js` 统一封装（含满提示、`_warned`、getArr/getObj 辅助），但 `remind.js`、`analytics.js`、`keys.js`、`errlog.js`、`weather.js`、`ad.js`、`help.js`、`app.js` 仍直连 `wx.getStorageSync/setStorageSync`，破坏单一真源，且各自缺 `store` 的"存储满"统一告警。
- 严重程度：中
- 优化建议：所有 storage 读写经 `store.js`；`store` 加 `getJSON/setJSON` 自动 JSON 序列化，消除各处手写 `JSON.parse`。

**第 82 条**
- 类型：架构
- 位置：`tools/_src-backup/*` 真源 → `utils/*.js` 压缩产物（build-min.mjs）
- 问题描述：逻辑真源在 `_src-backup`，`utils` 是 terser 压缩产物；改逻辑必须改 `_src-backup` 再 build，否则"改了 utils 下次 build 被覆盖"。新人易踩。
- 严重程度：中
- 优化建议：在 `README`/贡献指南明确"禁改 utils/*.js，改 _src-backup + build"；CI 加"diff utils vs 重 build 结果"一致性断言。

**第 83 条**
- 类型：架构
- 位置：路由分发（`app.js` + `more.go` + 各页 `wx.navigateTo`）
- 问题描述：导航出口有两层：全局 `app.js` 已包裹 `navigateTo/switchTab/reLaunch` 做失败 toast；但页面内仍各自写 `fail` 回调（如 `more.go`、help.onHelp），且路由表分散（第 60 条）。
- 严重程度：低
- 优化建议：统一走 `utils/route.go(k)` 单函数（内部含 tab 判定 + 加载反馈 + 失败 toast），页面只调 `route.go`。

**第 84 条**
- 类型：架构
- 位置：`pages/more/more.js` 作为"功能聚合中枢"
- 问题描述：`more.js` 承担分组渲染 + 想玩管理 + 备份恢复 + 密钥配置 + 行程存档 + 清空数据，职责偏多；与 `pages/myguides`、`pages/help` 功能有重叠（存档 vs 我的行程）。
- 严重程度：低
- 优化建议：把"备份/恢复/密钥/清空"抽 `settings.js` 子模块，more 只做导航与展示。

**第 85 条**
- 类型：架构
- 位置：`wx.getAccountInfoSync().miniProgram.appId === "web"`（`pages/plan/plan.js:729`、`web/lib/runtime.js:482`）
- 问题描述：网页版用 `appId==="web"` 区分运行环境，与小程序侧 `envVersion` 判定两套；环境识别逻辑分散。
- 严重程度：低
- 优化建议：抽 `isWeb()`/`isMini()` 到 `utils/env.js` 单一判定。

**第 86 条**
- 类型：架构
- 位置：`utils/travel.js` 巨型聚合模块
- 问题描述：`travel.js` 导出 200+ 函数，是事实上的"上帝模块"，页面与工具都依赖它；任何函数改动影响面大。
- 严重程度：中
- 优化建议：按领域拆子模块（ledger/recommend/trip/insights/weather-bridge），travel.js 仅 re-export，降低耦合。

**第 87 条**
- 类型：架构
- 位置：配置外部化
- 问题描述：阈值/文案/路由/分类等大量"业务配置"混在逻辑代码里（魔法数字、硬编码文案），缺少 `config.js` 单一配置层。
- 严重程度：低
- 优化建议：建 `config.js` 收纳环境、阈值、分类、文案默认值。

**第 88 条**
- 类型：架构
- 位置：`utils/keys.js` + `project.config.json` appid
- 问题描述：密钥与 appid 都进仓库源码（第 1/30 条），无外部化/环境隔离；个人主体下暂无服务端，但密钥泄露风险已在。
- 严重程度：中
- 优化建议：Key 移出源码（见第 1 条）；appid 保留（公开属性）。

**第 89 条**
- 类型：架构
- 位置：`subdata/data/data-packed.js` 分包数据包
- 问题描述：~1.8MB 压缩数据包随分包加载，数据更新需重打包+重发版；缺"数据版本号 + 热更"机制（个人主体无云，但可走"分包预下载 + 版本比对"）。
- 严重程度：低
- 优化建议：数据包带 `DATA_VER`，启动时比对内置版本，提示"数据已更新，重进生效"或走分包更新。

**第 90 条**
- 类型：架构
- 位置：`pages/index/index.js` 生成攻略 → `app.setPlan` → 各页读 `globalData.plan`
- 问题描述：行程以 `app.globalData.plan` 为跨页真源，无版本/订阅；某页改了 plan 其它页靠 onShow 重新读，缺响应式。
- 严重程度：低
- 优化建议：抽 `planStore`（get/set/subscribe），改 plan 通知订阅页刷新。

**第 91 条**
- 类型：架构
- 位置：`tools/*.mjs` 批量数据加工脚本（v199~/v200~/scrape-*）
- 问题描述：大量一次性/批量抓取脚本留在仓库根 `tools/`，与构建/回归工具混放，新人难辨"哪些是构建必需、哪些是历史抓取"。
- 严重程度：低
- 优化建议：抓取脚本归 `tools/scrape/`、构建工具归 `tools/build/`、回归归 `tools/check/`，README 标注。

**第 92 条**
- 类型：架构
- 位置：`web/`（PWA 网页版）与小程序双端
- 问题描述：网页版 `web/lib/runtime.js` 自研了一套小程序运行时模拟（Page/setData/wx 适配），与小程序侧逻辑大量重复（行程渲染、地图、记账），双端各自维护易漂移。
- 严重程度：中
- 优化建议：把"渲染数据准备"层（`_renderShow` 之前的纯函数）双端共享，运行时只做适配；或评估用同构框架减少重复。

**第 93 条**
- 类型：架构
- 位置：`subai/`（AI 深度玩法/广告解锁）
- 问题描述：`subai` 与 `subpkg`/`pages` 平行，ad.js 用独立 storage 键（第 74 条），模块边界与依赖不清晰。
- 严重程度：低
- 优化建议：明确 `subai` 仅承载"深度内容 + 解锁状态"，storage 收口到 store。

**第 94 条**
- 类型：架构
- 位置：日志/监控
- 问题描述：`errlog.js` 仅本机留存错误，无上报（隐私优先，合理），但意味着线上问题不可观测；个人主体也无法接 Sentry 类（需域名）。
- 严重程度：低
- 优化建议：保持本地优先；可在"关于"页提供"导出错误日志"便于用户反馈（more.onErrLog 已做），记录即可。

**第 95 条**
- 类型：架构
- 位置：测试组织
- 问题描述：`tools/_test-*.mjs`、`check-new.mjs`、`allcheck.sh` 构成回归，但命名混乱（`_` 前缀 vs 无前缀、`stress-test.mjs`），且无统一"运行全部"入口文档。
- 严重程度：低
- 优化建议：`tools/check/` 统一放置，README 列出 `npm test` 等价命令。

**第 96 条**
- 类型：架构
- 位置：`pages/plan/plan.js` 与 `subpkg/*` 共享 `utils/travel.js`
- 问题描述：行程页与分包页都直接依赖核心模块，分包本应"按需加载、低耦合"，但实际与主页共享同一大模块，分包瘦身有限。
- 严重程度：低
- 优化建议：评估把"行程展示只读接口"与"生成/编辑写接口"拆分，分包只依赖只读子集。

**第 97 条**
- 类型：架构
- 位置：`utils/recommend.js`（743 行）独立但未完全与 travel 解耦
- 问题描述：推荐逻辑已独立成文件，但仍被 travel.js 大模块 require，未能独立测试/替换。
- 严重程度：低
- 优化建议：recommend 作为纯函数库（入参 plan + 用户画像，出参评分），脱离 travel 大模块可直接单测。

**第 98 条**
- 类型：架构
- 位置：输入校验层
- 问题描述：金额/日期/城市名等输入校验散落各页（ledger.add、index 生成、remind.add），无统一 `validate.js`。
- 严重程度：低
- 优化建议：抽 `validate.js`（`isAmount/isDate/isCityName`），各页复用。

**第 99 条**
- 类型：架构
- 位置：主题/字号系统
- 问题描述：`themeMode`/`fontScale`/`nightCfg` 跨 `utils/travel.js` 与 `app.js` 多处读取，`applyNav`/`applyTabBar` 需手动在每页 `_theme()` 调，易漏导致某页主题不跟随。
- 严重程度：低
- 优化建议：`SafePage` 自动在 onShow 调 `_theme`，页面无需手写。

**第 100 条**
- 类型：架构
- 位置：`pages/more/more.js` 备份/恢复/协作
- 问题描述：本地备份（剪贴板）与协作包（剪贴板）两种数据交换格式并存（`exportBackup`/`exportCollabPlan`），导入时按内容嗅探（`travel-collab` 关键词），嗅探脆弱。
- 严重程度：低
- 优化建议：统一为带 `type` 字段的 envelope 格式，导入按 type 分发而非关键词嗅探。

**第 101 条**
- 类型：架构
- 位置：`utils/app.js` `SafePage` 未覆盖 Component
- 问题描述：`SafeComponent` 已预留但未使用（项目无 Component 页面）；若未来引入自定义组件，错误边界不自动生效。
- 严重程度：低
- 优化建议：组件化时启用 `SafeComponent` 并在 `allcheck` 加"组件必须 SafeComponent"断言。

**第 102 条**
- 类型：架构
- 位置：合规隔离（个人主体）
- 问题描述：个人主体限制 web-view/支付/云同步，代码中 `clearAllData`/`backupOut` 均本地化，但 `remind.js` 的云函数分支（`USE_CLOUD=false`）已留，合规边界清晰；仅需在文档/代码注释保持"未开通云前不启用"的纪律。
- 严重程度：低
- 优化建议：保持现状，记录为合规护栏。

**第 103 条**
- 类型：架构
- 位置：依赖管理
- 问题描述：`package.json` 依赖（terser/pako 等）与 `node_modules` 是否在仓库/CI 一致；`build-min.mjs` 依赖 `req("terser")`，CI 需先 `npm install`。
- 严重程度：低
- 优化建议：README 写明构建前置 `npm install`；CI 校验 lockfile。

**第 104 条**
- 类型：架构
- 位置：`subpkg/toolkit/toolkit.js`、`subpkg/spotsearch/` 等
- 问题描述：百宝箱/搜景点等子功能各自独立页面，但共享"结果展示 + 复制"模式，未抽公共组件。
- 严重程度：低
- 优化建议：抽 `ResultCard`/复制工具，减少重复。

**第 105 条**
- 类型：架构
- 位置：全工程无统一错误处理策略文档
- 问题描述：错误边界（SafePage/errlog）、存储满、网络失败各有处理，但缺少一份"哪些能吞、哪些必须抛"的约定文档，新人易过度 try 或漏 try。
- 严重程度：低
- 优化建议：补 `docs/ERROR_STRATEGY.md` 约定。

**第 106 条**
- 类型：架构
- 位置：`git` 协作（7 人分布式）
- 问题描述：分支机协作者通过 PAT 加为 collaborator，但缺 PR/分支保护/CI 门禁强制，主干易进未回归代码（尤其双源 `_src-backup` 易错）。
- 严重程度：中
- 优化建议：加 `allcheck.sh` 作为合并门禁（CI 跑），PR 需过 59 步；`utils/*.js` 与 `_src-backup` 一致性断言。

**第 107 条**
- 类型：架构
- 位置：`subdata/boost/boost.js` 引用路径
- 问题描述：`more.js:338` 路由 `boost: "/subdata/boost/boost"`，但 `boost.js` 实际在 `subdata/boost/`；路由表与文件位置需一致，新增分包易错。
- 严重程度：低
- 优化建议：路由表自动由 `app.json` subPackages 推导，减少手写。

**第 108 条**
- 类型：架构
- 位置：`docs/` 与代码版本同步
- 问题描述：考核材料（docx/pptx）在仓库外、口径数字需与 allcheck 动态一致（`check-doc-consistency.mjs` 已管），但 `功能清单.md`/讲稿等仍易与代码漂移。
- 严重程度：低
- 优化建议：保持 `check-doc-consistency.mjs` 覆盖；新增材料纳入同一校验。

---

## 六、已具备的强项（审计时确认，非问题）

为避免过度整改，以下能力经代码审查确认**已做对**，无需改动：
1. **统一错误边界**：`utils/app.js` 的 `SafePage`/`safe`/`getAppSafe` + `app.onError` + `errlog.js` 形成"开发 rethrow、生产 toast + 留痕"，根治"按了没反应"。
2. **存储抽象**：`utils/store.js` 封装 get/set/del + 存储满提示，且 `_stripUndefined` 在 SafePage 入口清洗 `setData` 顶层 undefined，消除微信告警。
3. **密钥 fail-closed**：`utils/keys.js` 单一出口 + 占位符/格式非法回落 null，天气缺失静默降级不阻断。
4. **凭证照片修复（本次）**：已把照片从"日期#下标"改为按账单稳定 `id`，并加迁移/孤儿清理/延迟删除，杜绝串图与残留。
5. **坐标完整性自检**：`utils/data.js` `checkCoordIntegrity` 加载期只读自检 + 打包期 fail-fast，越界>0 即拦截。
6. **回归门禁**：`allcheck.sh` 59 步 + `check-new.mjs` 431 断言 + 多份 `_test-*.mjs`，覆盖核心逻辑。
7. **导航防御**：`app.js` 全局包裹 navigateTo/switchTab/reLaunch，失败可见 + 栈满回退 redirectTo。
8. **隐私优先**：无服务端上报、无第三方 SDK 埋点，数据全本机，符合个人主体合规边界。

---

## 七、优先整改建议（按 ROI）

- **立即（高/中危，影响安全与线上）**：第 1 条（密钥移出源码）、第 20/21 条（工具脚本 eval/execSync 改造）、第 24 条（备份/协作包输入上限校验）、第 28 条（生产包 console.warn 收敛）。
- **短期（架构/质量，降维护成本）**：第 56 条（onShow 样板收口 SafePage）、第 58/77 条（消除 _src-backup 与 utils 双源）、第 81 条（统一 store 抽象）、第 82 条（CI 一致性断言）、第 106 条（合并门禁）。
- **中期（性能）**：第 34/35/42/49 条（聚合函数缓存 + store 内存缓存）、第 50/51 条（长列表分页/虚拟）。
- **低危**：大量魔法数字/文案/路由表收口，可随迭代顺手做，不必单列排期。
