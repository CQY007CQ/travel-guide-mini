# 代码审计报告 · 旅行攻略生成器小程序（晨的旅行助手）

> 审计目标：`outputs/miniprogram-travel/`（微信小程序，纯前端 JS，**无后端、无 SQL 数据库**）
> 版本真值：APP_VER = `1.20.8`（含 2026-11-09 晚新增网页版全屏自适应 + 内置 AI 助手）；真实逻辑源 `tools/_src-backup/*.js`；`utils/*.js` 为 terser 压缩产物；`utils/data.js`、`utils/keys.js` 为手写、`cp` 同步。
> 说明：本栈没有数据库层，**「SQL 注入 / N+1 / 索引缺失」** 类条目已**如实映射为内存数据访问（Object/Set/数组遍历）的等价问题**，不虚构数据库结论。

---

## 审计概览索引（压缩导航：126 条 → 速查）

- **条目总数**：126（维度一～五 + 网页版 109–126）。
- **严重度分布**：高 8（含 1 已修复 / 1 业务约束）· 中 57 · 低 61。
- **高严重度速查**：#12 #73 #77 #79 #91 #92 #95 #117（#117 和风 Key 为合规红线；#12 坐标基线）。
- **已闭环**：7 条（#109/#110/#111/#113/#114/#118/#119，见各条 ✅ 标注）。
- **未闭环中危（建议优先）**：#112 内联 HTML 习惯 · #115 出站 safeFetch（本轮 CSP connect-src 已收敛策略层）· #116 全量数据前端暴露 · #121 两端能力对齐（抽 utils/ai-core）· #122 双构建单改动 · #123 缺单测 · #124 美食 price 类型 · #125 SPOT_COORDS 置信度标注。
- 详细条目见下文各维度。

---

## 维度一 · 数据真实性与有效性（第 1–28 条）

**第 1 条**
- 类型：数据
- 位置：`tools/_src-backup/data.js` · `SPOT_COORD_FIX`（7 条硬编码纠偏）/ `utils/data.js` `applyCoordFix`(L44)
- 问题描述：7 个景点坐标靠手写修正表覆盖，基数据更新后修正表不会自动跟随，存在坐标漂移回归风险。
- 严重程度：中
- 优化建议：把纠偏来源从「手填」改为「带版本号的权威坐标源 + 自动比对脚本」，打包期若基数据与该源偏差 >50m 即报警，而非仅静默覆盖。
- 修改前后对比：前 `SPOT_COORD_FIX` 纯手填、无校验；后 引入 `coords-canon-source.json` + `pack-data` 比对断言。

**第 2 条**
- 类型：数据
- 位置：`tools/_src-backup/data.js` · `SPOT_COORD_ADD`（6 条）/ `utils/data.js` `applySpotCoordAdd`(L72)
- 问题描述：6 条新增坐标手写追加，当前幂等，但无来源标注，长期会变成「幽灵坐标」。
- 严重程度：低
- 优化建议：每条补 `src`/`collectedAt` 字段，打包期生成来源清单，便于回溯。

**第 3 条**
- 类型：数据
- 位置：`tools/_src-backup/data.js` · `FOOD_COORDS_V206`（11 家 (0,0) 回填）/ `utils/data.js` `applyFoodCoordBackfill`(L186)
- 问题描述：11 家美食店坐标为 (0,0) 占位回填，地图上会落到一个错误点（几内亚湾/本初子午线）。
- 严重程度：中
- 优化建议：对 (0,0) 坐标在渲染端显式降级为「无坐标，仅列表展示」，禁止地图 pin；并在 `checkCoordIntegrity` 增加 (0,0) 专项计数。
- 修改前后对比：前 11 家店在地图上错点；后 标记 `noCoord:true`，地图跳过、列表保留。

**第 4 条**
- 类型：数据
- 位置：`tools/pack-data.mjs` L141–143（备注上限 26 字）
- 问题描述：景点备注超 26 字被截断，采集截断类长文案被一刀切，真实短介绍也可能被切掉尾句。
- 严重程度：中
- 优化建议：截断前先按句末标点（`。！？`）就近截断，优先保留完整句子而非硬切 26 字。
- 修改前后对比：前 `note.slice(0,26)` 可能断句；后 取最后一个句末标点 ≤26 字子串。

**第 5 条**
- 类型：数据
- 位置：`tools/pack-data.mjs` L76（`if (v.rating && Number(v.rating) >= 4.0)`）
- 问题描述：瘦身期只保留评分 ≥4.0 的 `SPOT_INFO`，把真实存在的 3.x 分景点从结构化信息里删除（属**数据丢失**，不止体积优化）。
- 严重程度：中
- 优化建议：把「评分过滤」与「体积瘦身」解耦：低分景点的 `rating` 仍保留（≤1 字节/条），仅砍掉非刚需的开放时间/人均/地址大字段。
- 修改前后对比：前 3.x 分景点 `SPOT_INFO` 整条消失；后 仅保留 `{rating}` 最小字段。

**第 6 条**
- 类型：数据
- 位置：`tools/_apply-safe.mjs` §9.10（6000 条 `SPOT_CARDS_BY_CITY`）
- 问题描述：6000 条资料卡是「把散在 6 张表的真实字段聚合」，**并非新增 6000 条百科/美食/医院**；用户诉求「百科+5000 / 美食+1000 / 医院+1000」实际未达标。
- 严重程度：中
- 优化建议：如要继续补足计数，必须走合规外源（高德搜索配额 key 或官方名录导出），逐条地址核验后入包；禁止模板拼接凑数。
- 修改前后对比：前 资料卡=聚合视图、计数未增；后 明确「聚合≠新增」口径，补数走红线管线。

**第 7 条**
- 类型：数据
- 位置：`tools/official-roster/candidates.json`（95 条具名医院 `verified:false`）
- 问题描述：美食+1000 / 医院+1000 仍缺口；候选池 95 条 `coord:null` 未入包（设计正确），但补数管线尚未闭合。
- 严重程度：中
- 优化建议：提供合规 AMap key 后跑 `_collect-official-roster.mjs --fetch`，通过「公文词+模板名校验+坐标非空」三关才允许并入 `HOSPITALS`/`FOOD_SPOTS`。
- 修改前后对比：前 候选池孤立；后 源注册表驱动 `--fetch` → 校验 → 入包。

**第 8 条**
- 类型：数据
- 位置：`utils/data.js` `baikeInfo` 覆盖统计（26343/26357）
- 问题描述：14 个地点 `baikeInfo.has=false`，用户点「百科」会收到「该地点暂未收录」——内容完整度缺口。
- 严重程度：低
- 优化建议：对这 14 个点补充 `SPOT_DETAILS` 或 `experiences.note`，或在 `spotNoteInCity` 兜底文案里明确「同城参考」来源。

**第 9 条**
- 类型：数据
- 位置：`utils/data.js` `mergeInto`(L415) / `applyPacked`(L447)
- 问题描述：`mergeInto` 对对象递归合并、对数组去重拼接、其它类型**直接覆盖（last-wins）**。多个数据分块若对同一城市同一字段给出不同值，后者静默胜出，可能丢字段。
- 严重程度：中
- 优化建议：覆盖写时若两侧都是非数组对象且 key 集合不同，记录 `mergeConflict` 日志（开发期断言），至少暴露而非静默。
- 修改前后对比：前 冲突字段静默覆盖；后 开发构建打印冲突清单。

**第 10 条**
- 类型：数据
- 位置：`tools/pack-data.mjs` L117–136（`CITY_LANDMARKS_EXTRA` 去重）
- 问题描述：当城市地标名恰好等于某 `SPOT_COORDS` 已解析名时整条删除，可能把「同名但不同实体」的地标误删。
- 严重程度：低
- 优化建议：去重时比对的不只是名字，还比对坐标是否一致；坐标不一致则保留地标条目。
- 修改前后对比：前 同名即删；后 名同+坐标同才删。

**第 11 条**
- 类型：数据
- 位置：`tools/pack-data.mjs` L186–199（脏省名键清理）
- 问题描述：以省名当城市键的项被整条剔除；若某城市恰与省同名（如「北京」在 `CITY2PROV` 被当键），存在误删风险。
- 严重程度：低
- 优化建议：清理前先排除「直辖市/特别行政区」白名单，仅清理真正非城市的省名键。
- 修改前后对比：前 省名键一律删；后 直辖市白名单豁免。

**第 12 条**
- 类型：数据（合规红线）
- 位置：`tools/_hospital-batch4/5/6.json`（1572 行模板拼接）/ `tools/_test-roster-integrity.mjs`（指纹锁）
- 问题描述：1572 行「城名+人民医院/中医院」模板拼接且坐标为城心固定网格，属**禁止入包**负样本，靠指纹集合门禁锁死。
- 严重程度：高
- 优化建议：维持指纹门禁；并在 `pack-data` 打包期再次扫描 `HOSPITALS` 是否命中任一指纹，双保险。
- 修改前后对比：前 仅单测门禁；后 单测 + 打包期双重校验。

**第 13 条**
- 类型：数据
- 位置：`utils/emergency-data.js`（APPROX 317 城）
- 问题描述：317 城医院坐标用「城心 ±近似」存储，精度仅到城市级，导航误差可达数公里，却被当医院坐标用。
- 严重程度：中
- 优化建议：渲染端对 `APPROX` 来源显式标注「approximate · 仅供区域参考」，地图 pin 文本加「≈」。
- 修改前后对比：前 近似坐标与普通坐标无区分；后 UI 标注近似来源。

**第 14 条**
- 类型：数据
- 位置：`tools/pack-data.mjs` L90/L98/L110（`toFixed(3)` 坐标截断）
- 问题描述：坐标从 6 位小数降到 3 位，精度约 100m；城市级 POI 可接受，但精确到门牌的景点被统一降精度。
- 严重程度：低
- 优化建议：按数据类型分精度：景点/美食保留 4–5 位（~10m），城市级行政点可用 3 位。
- 修改前后对比：前 一律 3 位；后 景点 5 位 / 行政 3 位。

**第 15 条**
- 类型：数据
- 位置：`utils/data.js` `dedupeSpots`(L211)（按 `[name,lat,lon]` 去重）
- 问题描述：去重键为「名称+坐标」，两个不同景点若恰好同名同坐标不会被去重（安全），但两个**同名不同实体**不会被识别——也可能把合法异名同点误留。
- 严重程度：低
- 优化建议：增加「坐标聚类」去重：同坐标 ±0.0005 内的不同名点提示人工复核。

**第 16 条**
- 类型：数据
- 位置：`pages/index/index.js` `onShowRender` / `tools/_src-backup/travel.js` 城市解析
- 问题描述：用户手输出发城市/目的地、出发日期缺乏严格校验；非法日期（如 2 月 30 日）或空城市会进入推荐链。
- 严重程度：中
- 优化建议：在输入入口统一做 `canonCityName` + 日期范围校验，非法值即时 toast，不进入推荐。
- 修改前后对比：前 弱校验；后 入口强校验 + 友好提示。

**第 17 条**
- 类型：数据
- 位置：`tools/_src-backup/travel.js` `holidayHint(depart)`(L~156)
- 问题描述：节假日提示依赖出发日期解析，若日期格式异常会返回 null 或错误提示。
- 严重程度：低
- 优化建议：封装 `parseDepartDate()` 单一入口，返回 `{ok,date,err}`，所有调用方统一消费。

**第 18 条**
- 类型：数据
- 位置：`tools/_src-backup/weather.js` `coordOf(cityName)`(L61)
- 问题描述：多中心城市的天气坐标取城市中心，跨区天气差异大时不准。
- 严重程度：低
- 优化建议：对多中心城市（如「重庆」「舟山」）维护分区坐标表，按用户选定区县就近取。

**第 19 条**
- 类型：数据
- 位置：`utils/corpus.js` `corpusStats`(L28) / `utils/emergency-data.js`
- 问题描述：统计医院数从 `emergency-data.js` 取而非 `D.HOSPITALS`（已修复一致性，但双源并存是隐患）。
- 严重程度：低
- 优化建议：将医院统计收敛到单一真源函数 `countHospitals()`，消除 `D.HOSPITALS` 与 `emergency-data` 双口径。
- 修改前后对比：前 两处口径可能分歧；后 单一 `countHospitals()`。

**第 20 条**
- 类型：数据
- 位置：`tools/_apply-safe.mjs` §9.10（每轮重建 `SPOT_CARDS_BY_CITY`）
- 问题描述：`apply` 每轮从零重建 6000 条，依赖「聚合」而非增量，apply→pack 重跑成本高、且可重复。
- 严重程度：低
- 优化建议：加内容哈希缓存，仅当源表变更才重建，否则复用上次产物。

**第 21 条**
- 类型：数据
- 位置：`tools/_src-backup/data.js` `SPOT_ENRICH`(12 条稀疏县)/ `FOOD_ENRICH`(11 条)
- 问题描述：富集数据为手填补丁，缺 `collectedAt`/来源，长期维护难追溯。
- 严重程度：低
- 优化建议：补丁统一加元数据头（`{src,collectedAt,note}`）。

**第 22 条**
- 类型：数据
- 位置：`tools/pack-data.mjs` L110（`price: x.price || ""`）
- 问题描述：美食价格以字符串存储（含「¥」「元」等混杂），类型不一致，排序/区间筛选困难。
- 严重程度：低
- 优化建议：价格存数值 `priceNum` + 单位分离，渲染端再格式化。
- 修改前后对比：前 `"¥35/人"`；后 `{priceNum:35,unit:"人"}`。

**第 23 条**
- 类型：数据
- 位置：`utils/data.js` `applyPacked`(L441) / 加载期无 schema 校验
- 问题描述：打包数据仅 `checkCoordIntegrity` 校验坐标越界，**不校验数据结构形状**；若某分块字段形状漂移，消费方可能 `undefined` 崩溃。
- 严重程度：中
- 优化建议：加载期对 `CITIES/SPOT_COORDS/FOOD_SPOTS` 做轻量 shape 断言（数组/对象/必填子字段），失败即 errlog + 降级。
- 修改前后对比：前 仅坐标门禁；后 坐标 + shape 双门禁。

**第 24 条**
- 类型：数据
- 位置：`utils/data.js` `__A` 空占位(L23 注释) / `tools/pack-data.mjs` L34 停用说明
- 问题描述：`__A` 仅留空占位供「兼容解析」，但别名压缩已于 2026-10-02 停用，加载器已不消费——属死契约。
- 严重程度：低
- 优化建议：在下个大版本清理 `__A` 字段及对应读取分支，减少误导。
- 修改前后对比：前 留空 `__A`；后 删除 `__A` 读写。

**第 25 条**
- 类型：数据
- 位置：`utils/emergency-data.js`（220 家真实 + APPROX 317）/ 覆盖缺口
- 问题描述：134 城有具名医院，其余城市仅 APPROX；全国 751 城覆盖不均，偏远目的地应急参考弱。
- 严重程度：中
- 优化建议：优先补齐旅游热门偏远目的地（西藏/青海/新疆景点周边）的具名医院，而非均摊。

**第 26 条**
- 位置：`tools/pack-data.mjs` L252–266（分块上限 2 块）
- 问题描述：分块逻辑只支持 2 块（`subdata`/`subdata2`）；若数据继续增长突破 2×~2MB，会溢出未处理。
- 严重程度：中
- 优化建议：分块改为通用 N 块 + `app.json` 动态注册占位，避免硬编码 2 块上限。
- 修改前后对比：前 固定 2 块；后 N 块自适应 + 注册表生成。

**第 27 条**
- 类型：数据
- 位置：`tools/_src-backup/data.js` `dedupeSpots` 仅运行时 / 打包期护栏刚加
- 问题描述：运行时 `dedupeSpots` 每次加载都全量跑（见性能维度），而打包期去重护栏是新加的——两套去重逻辑并存易分歧。
- 严重程度：低
- 优化建议：以打包期去重为准，运行时去重降为「兜底且仅首块」，避免重复成本。

**第 28 条**
- 类型：数据
- 位置：`tools/_apply-safe.mjs` §9.9（模板套话剔除）/ `experiences.note`
- 问题描述：「已收录」「可一键导航」等功能性占位文案在部分路径未被统一剥离，可能进入展示。
- 严重程度：低
- 优化建议：集中 `stripPlaceholder(note)` 工具，在 `applySpotEnrich`/`applyFoodEnrich` 统一调用，单测覆盖。

---

## 维度二 · 安全漏洞（第 29–50 条）

**第 29 条**
- 类型：安全
- 位置：`utils/keys.js` `amapKey()`(L49) / `utils/geo.js`（高德调用）
- 问题描述：高德 key 必须随前端包下发（小程序架构使然），**技术上可被反编译提取**——属平台级固有风险，非代码缺陷。
- 严重程度：中
- 优化建议：个人主体无法做服务端代理（需认证）；升个体户后把 key 调用收口到云函数/自有后端，前端只拿临时 token。
- 修改前后对比：前 key 直发前端；后（认证后）前端持短期 token，key 留服务端。

**第 30 条**
- 类型：安全
- 位置：`utils/keys.js` `setKeys`(L55) / `_resolve`(L39)
- 问题描述：`setKeys` 从 `storage` 注入 key，若设备被恶意篡改 storage，key 可被替换（虽不影响他人 key，但可让本机调用失败或被审计误判）。
- 严重程度：低
- 优化建议：`setKeys` 增加格式校验（`/^[a-zA-Z0-9]{28,40}$/`），非法注入直接拒绝并 errlog。

**第 31 条**
- 类型：安全
- 位置：`web/lib/runtime.js` `fetch`(L358)
- 问题描述：`wx.request` 适配到 `fetch(o.url,…)`，若 `o.url` 来自不可信输入（如用户导入配置里的接口地址），可能发起任意域请求（SSRF 等价，客户端侧）。
- 严重程度：中
- 优化建议：对 `o.url` 做白名单域校验（仅 `api.qweather.com`/`restapi.amap.com`），非白名单直接拒绝。
- 修改前后对比：前 任意 url 可请求；后 域白名单拦截。

**第 32 条**
- 类型：安全
- 位置：`web/lib/runtime.js` `escHtml`(L24) 覆盖 innerHTML
- 问题描述：所有动态 `innerHTML` 已走 `escHtml`，但需确认**无一遗漏**（如 `web/app.js:65` 的 bootMsg 拼装）。
- 严重程度：中
- 优化建议：对 `web/lib/*.js` 全量 grep `innerHTML`/`outerHTML`，逐处确认转义；引入 eslint 规则禁止未转义赋值。
- 修改前后对比：前 手工保证；后 静态扫描 + lint 规则兜底。

**第 33 条**
- 类型：安全
- 位置：`tools/_src-backup/travel.js` `importBackup` / CSV 解析（审计 #16 已修公式注入）
- 问题描述：用户导入备份 JSON/CSV 已做公式注入净化，但导入文本里的 HTML/`<script>` 片段在网页版渲染端若未转义仍可能 XSS。
- 严重程度：中
- 优化建议：导入净化层统一 `stripTags()` + `escHtml()` 双保险，覆盖 note/title/自定义字段全部用户文本。
- 修改前后对比：前 仅 CSV 公式净化；后 公式 + 标签双净化。

**第 34 条**
- 类型：安全
- 位置：`utils/errlog.js` `push`(L22, msg.slice(0,600))
- 问题描述：错误日志截 600 字存本地，可能捕获含用户私人行程/搜索词的 `errMsg`，本地明文存储。
- 严重程度：低
- 优化建议：日志只存 `label`+`error.code` 类结构化字段，不存原始 `errMsg` 全文；对外分享前自动脱敏。
- 修改前后对比：前 存 message 全文；后 仅结构化 code + label。

**第 35 条**
- 类型：安全
- 位置：`utils/store.js` `set`(L29) / 草稿 `saveDraft`(L82)
- 问题描述：用户行程草稿以明文存 `wx.storage`/localStorage，设备被物理访问即泄露。
- 严重程度：低
- 优化建议：本地仅存必要性数据；敏感行程字段可在存储层做轻量混淆（非加密，仅提高门槛）。

**第 36 条**
- 类型：安全
- 位置：`web/index.html`（内联脚本）
- 问题描述：网页版未设 CSP（Content-Security-Policy），配合内联脚本，XSS 影响面更大。
- 严重程度：中
- 优化建议：在 `web/index.html` 加 `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">`，外链资源收口。
- 修改前后对比：前 无 CSP；后 限定 self 源。

**第 37 条**
- 类型：安全
- 位置：`web/lib/runtime.js` `LS = global.localStorage`(L19)
- 问题描述：网页版用 localStorage 承载 wx 存储适配，XSS 一旦得手可读取全部本地态（含草稿/errlog）。
- 严重程度：低
- 优化建议：CSP + 敏感字段混淆 + 缩短存储 TTL。

**第 38 条**
- 类型：安全
- 位置：`tools/check-secrets.mjs`（全仓扫描）
- 问题描述：本地 `geocode.keys` 不进 git 是正确做法，但 9 个读 key 池脚本若某处误把 key 当说明文字发出，仍会泄露。
- 严重程度：中
- 优化建议：维持 `check-secrets` L1 全仓扫描 + 32hex 前后边界，并把「说明文字误当 key 发出」的失败模式加入回归用例（已部分覆盖）。
- 修改前后对比：前 注释行可能误发；后 输出不打印值 + fail-closed。

**第 39 条**
- 类型：安全
- 位置：`project.private.config.json`（上传凭证）
- 问题描述：微信开发者工具私有配置可能含上传私钥/AppID 关联信息，需确认未被提交。
- 严重程度：中
- 优化建议：`.gitignore` 显式覆盖 `project.private.config.json`；`check-secrets` 增该项扫描。
- 修改前后对比：前 未显式忽略；后 加入忽略 + 扫描。

**第 40 条**
- 类型：安全
- 位置：`utils/keys.js` `_resolve`(L39) 返回 `""`
- 问题描述：`_resolve` 在未配置时返回 `""`（而非 null），`amapKey()` 返回空串 → API 调用带空 key，平台返回鉴权错，可能被当成「key 失效」误判。
- 严重程度：低
- 优化建议：未配置返回 `null`，调用方对 `null` 做「功能降级 + 提示配置」而非发起空 key 请求。
- 修改前后对比：前 `""`；后 `null` + 降级提示。

**第 41 条**
- 类型：安全
- 位置：`web/lib/runtime.js`（无 `eval`/`new Function` 已确认）
- 问题描述：已 grep 确认无 `eval`/`new Function`，但 `web/lib/modules.js` 为 13200 行压缩产物，需保证其源码侧也无动态执行。
- 严重程度：低
- 优化建议：源码构建链加 `eslint no-eval` + 压缩配置 `compress: {evaluate:false}`，防止压缩器生成 `eval`。

**第 42 条**
- 类型：安全
- 位置：`pages/index/index.js` 多处 `catch(e){}`(L149/L239)
- 问题描述：静默吞异常会掩盖数据完整性/安全校验失败（如 `setData` 失败、`_syncAdv` 异常）。
- 严重程度：中
- 优化建议：至少 `errlog.push(label,e)` 记录；禁止空 `catch`。在 `allcheck` 增加「空 catch 扫描」（已有护栏方向）。
- 修改前后对比：前 `catch(e){}`；后 `catch(e){ errlog.push("x",e); }`。

**第 43 条**
- 类型：安全
- 位置：`web/lib/runtime.js` L704/719/821（错误页 `escHtml`）
- 问题描述：渲染异常页已用 `escHtml`，但若异常 message 含 `%`/`{` 等模板字符，旧模板引擎可能二次解析——需确认无模板引擎介入。
- 严重程度：低
- 优化建议：错误页采用纯文本节点赋值（`textContent`），彻底规避 HTML 解析。

**第 44 条**
- 类型：安全
- 位置：`tools/_amap-compliance.mjs`（`REVOKED_KEYS` 摘要）
- 问题描述：审计报告曾误判该文件含明文 key；实际为 64 位 sha256 摘要（边界复核命中 0），但扫描脚本正则需带边界避免误报。
- 严重程度：低
- 优化建议：维持带前后 hex 边界的 32hex 匹配；`check-secrets` 输出不打印疑似值。

**第 45 条**
- 类型：安全
- 位置：`web` 构建产物（`web/lib/data.js` 含 2347KB 数据 base64）
- 问题描述：网页版把全量数据塞进前端 bundle，任何人都可拉取完整 POI/医院库——数据资产暴露。
- 严重程度：中
- 优化建议：网页版对数据做按需懒加载/分片，热门城市优先，避免一次性下发全量。

**第 46 条**
- 类型：安全
- 位置：`utils/weather.js` `classifyApiError`(L148) / 配额
- 问题描述：前端无调用频率限制，用户高频刷新天气可耗尽 QWeather 个人配额（搜索类 100/日），且无防滥用。
- 严重程度：低
- 优化建议：客户端做调用节流（同城市 10 分钟内复用 `_diskGet` 缓存，已有 L79/L88），并加全局日调用上限计数。

**第 47 条**
- 类型：安全
- 位置：`web` 服务端（`sharecode` cookie 校验）
- 问题描述：网页版线上 403 因缺 `sharecode` cookie，服务端校验逻辑需确认不能被空/伪造 cookie 绕过。
- 严重程度：中
- 优化建议：服务端对 `sharecode` 做签名校验（HMAC），而非仅存在性判断；本地 dev 跳过该校验已确认。

**第 48 条**
- 类型：安全
- 位置：`tools/build-min.mjs` / `tools/pack-data.mjs`（构建期 `console.log`）
- 问题描述：构建脚本 `console.log` 打印的是计数/路径，**不含 key**；但需保证未来不误加 `console.log(key)`。
- 严重程度：低
- 优化建议：`check-secrets` 增加「构建脚本 `console.log` 含 key 变量名」扫描（如 `log(.*key)`）。

**第 49 条**
- 类型：安全
- 位置：`packages`/分包 `subdata/data/data-packed*.js`（平台签名）
- 问题描述：分包数据随包下发、由微信平台签名，篡改风险低；但本地调试包无签名，理论上可被注入。
- 严重程度：低
- 优化建议：加载期对 `_manifest` 做轻量完整性校验（如字段计数/size 断言），异常即降级。

**第 50 条**
- 类型：安全
- 位置：`utils/keys.js` `DEFAULT`(L19) 全空
- 问题描述：明文 key 已移出仓库（审计 #1/#19 修复），但需在发布流程确认 `setKeys` 注入路径不被 CI 日志回显。
- 严重程度：低
- 优化建议：CI/上传脚本禁用 `setKeys` 参数打印；`upload.sh` 日志脱敏。

---

## 维度三 · 性能瓶颈（第 51–72 条）

**第 51 条**
- 类型：性能
- 位置：`utils/data.js` `dedupeSpots`(L211)（`JSON.stringify([row[0],row[1],row[2]])` 每行）
- 问题描述：2.4 万行坐标逐行 `JSON.stringify`，O(n·平均长度)，且每次启动都跑（打包期已去重仍重复）。
- 严重程度：中
- 优化建议：运行时去重改为仅在多分块合并时跑一次；或改用数值键 `(lat*1e5<<21)^lon*1e5` 位运算，免字符串分配。
- 修改前后对比：前 每行 stringify；后 数值位键 + 仅首块。

**第 52 条**
- 类型：性能
- 位置：`utils/data.js` `checkCoordIntegrity`(L378) / `_hav`(L371)
- 问题描述：越界检测对每点遍历若干「中心基准」做 haversine，O(n·centers)；2.4 万点 × 基准数，启动期同步计算阻塞。
- 严重程度：中
- 优化建议：基准中心预计算到局部变量；或仅在打包期做（运行时仅抽样 1% 自检），异常再全量。
- 修改前后对比：前 全量 haversine；后 打包期全量 + 运行时抽样。

**第 53 条**
- 类型：性能
- 位置：`tools/_src-backup/travel.js` `citiesOf(prov)`(L76)
- 问题描述：每次调用都扫全 `CITIES`（751）+ 省内城市列表，渲染期高频调用却无缓存。
- 严重程度：中
- 优化建议：按 `prov` 做 `Map` 缓存（类似 `namedCities` 的 `_namedCitiesCache`）。
- 修改前后对比：前 每次全扫；后 `provCache.get(prov)`。

**第 54 条**
- 类型：性能
- 位置：`utils/data.js` `applyPacked` → `mergeInto`(L447) 递归深合并 5MB 数据
- 问题描述：启动时对 5MB 数据做递归深合并，阻塞主线程，低配机首屏卡顿。
- 严重程度：中
- 优化建议：分块数据预合并（构建期），运行时仅做轻量 `Object.assign` 顶层 + 必要 enrich，避免整树递归。

**第 55 条**
- 类型：性能
- 位置：`utils/data.js` `initData`(L499) 两 `require.async` 顺序 await(L511–512)
- 问题描述：两块数据并行拉取但都在主线程 inflate+merge，启动期 CPU 尖峰，首屏 ready 延迟。
- 严重程度：中
- 优化建议：inflate 放 Web Worker（小程序 `Worker`/网页 `Web Worker`），主线程只收结果 `postMessage`。

**第 56 条**
- 类型：性能
- 位置：`tools/pack-data.mjs` L204/L219/L301（`zlib.deflateSync` 同步，level:9）
- 问题描述：构建期同步最高压缩，单次阻塞数秒（可接受于构建，但大文件易 OOM）。
- 严重程度：低
- 优化建议：构建脚本改用流式 `zlib.createDeflate` 或 level:6 折中，避免大 JSON 一次性入内存。

**第 57 条**
- 类型：性能
- 位置：`web` 初始下载（代码 1.5MB + 数据 2347KB）
- 问题描述：网页版首屏需下载 ~3.8MB（未 Gzip 时），移动端弱网体验差。
- 严重程度：中
- 优化建议：数据分片懒加载 + Brotli/Gzip 服务端压缩 + `index.html` 资源 `preload` 仅首屏必需。

**第 58 条**
- 类型：性能
- 位置：`tools/_src-backup/planner.js` `buildPlanDays`(L395) 嵌套循环
- 问题描述：行程生成对景点/酒店做多层嵌套遍历（N+1 等价：每个候选日对全量景点重算），随城市景点数平方增长。
- 严重程度：中
- 优化建议：预计算「城市→候选景点索引」与「景点间距离矩阵」并缓存，避免重复线性扫描。

**第 59 条**
- 类型：性能
- 位置：`utils/geo.js` `haversine`(L11) 在热循环未近似
- 问题描述：短距离（同城景点）也用完整 haversine（含 `sin/cos/atan2`），热路径可近似。
- 严重程度：低
- 优化建议：<50km 用等距矩形近似（`dx*cos(lat),dy`），误差 <0.1%，省三角函数。
- 修改前后对比：前 全程 haversine；后 按距离阈值切换近似。

**第 60 条**
- 类型：性能
- 位置：`tools/_src-backup/travel.js` `routeScore`(L3386)/`tripScoreOf`(L4538)/`photoScoreOf`(L4823)/`valueScoreOf`(L5620)
- 问题描述：推荐对同一对景点距离反复计算（换一批/排序/去重各算一次），无记忆化。
- 严重程度：中
- 优化建议：用 `Map<pairKey,dist>` 记忆化 pairwise 距离，首次算后复用。

**第 61 条**
- 类型：性能
- 位置：`tools/_src-backup/weather.js` `mergeWeatherByDay`(L129)
- 问题描述：按天聚合天气对 plan 每天 × 景点数遍历，长行程（15 天+）重复分组。
- 严重程度：低
- 优化建议：按 `dayIndex` 建索引一次分组，下游直接取。

**第 62 条**
- 类型：性能
- 位置：`utils/corpus.js` `corpusStats`(L43/L50) 两次全扫 `CITIES`
- 问题描述：气候分布、区域分布分别扫一遍 `CITIES`，可一次循环出全部统计。
- 严重程度：低
- 优化建议：合并为单遍 `for` 同时累加 clim/reg。
- 修改前后对比：前 两遍；后 一遍。

**第 63 条**
- 类型：性能
- 位置：`utils/store.js` `usage`(L47)/`sizeOf`(L60)
- 问题描述：计算存储占用需遍历全部 key 取 size，若在渲染期调用会卡。
- 严重程度：低
- 优化建议：仅在「设置/关于」页调用，并缓存结果 5s。

**第 64 条**
- 类型：性能
- 位置：`tools/_src-backup/planner.js` `showListOf`(L391)
- 问题描述：每次切 tab 重算完整列表，未做列表级缓存。
- 严重程度：低
- 优化建议：列表结果按 `(city,days,budget,mode)` 做缓存键，参数不变直接复用。

**第 65 条**
- 类型：性能
- 位置：`tools/_apply-safe.mjs` §9.10 每轮重建 6000 卡（见数据维度 #20）
- 问题描述：重复计算，apply→pack 重跑成本高。
- 严重程度：低
- 优化建议：内容哈希缓存。

**第 66 条**
- 类型：性能
- 位置：`web` 图片预加载
- 问题描述：images 共 292K（小），但网页版是否懒加载未确认；全量 `<img>` 可能阻塞首屏。
- 严重程度：低
- 优化建议：非首屏图标用 `loading="lazy"` 或按需创建。

**第 67 条**
- 类型：性能
- 位置：`utils/data.js` `initData` `_sleep`/超时(L495)
- 问题描述：分包下载卡住时靠超时兜底（到点先返回），但超时阈值若过短会丢数据。
- 严重程度：低
- 优化建议：超时阈值按数据块大小动态设定（如 200KB/100ms），并后台继续 apply。

**第 68 条**
- 类型：性能
- 位置：`tools/_src-backup/planner.js` `GEN_HOTELS`(L446 兜底)
- 问题描述：无酒店数据时生成兜底列表，可能每调用重算模板。
- 严重程度：低
- 优化建议：兜底列表构建一次后缓存为模块级常量。

**第 69 条**
- 类型：性能
- 位置：`web/lib/runtime.js` DOM 操作（toast/modal 每次 innerHTML 重建）
- 问题描述：toast/loading/modal 每次调用重建 DOM 树，高频提示（如输入校验）会频繁重排。
- 严重程度：低
- 优化建议：组件单例化，复用同一节点，仅更新文本子节点。

**第 70 条**
- 类型：性能
- 位置：`tools/_src-backup/travel.js` `_cityIdx` 懒建（城市名索引）
- 问题描述：城市名→对象索引懒建是好的，但字符串 `canonCityName` 在热路径重复调用未缓存。
- 严重程度：低
- 优化建议：`canonCityName` 结果按原始串 `Map` 缓存。

**第 71 条**
- 类型：性能
- 位置：`web/lib/modules.js`（13200 行单文件）
- 问题描述：单文件过大，解析编译时间随体积线性增长，首屏 JS 执行慢。
- 严重程度：中
- 优化建议：按页面做代码分割（dynamic import），首屏仅加载 splash/index 必要模块。

**第 72 条**
- 类型：性能
- 位置：`utils/data.js` 数据 inflate 在主线程
- 问题描述：2347KB base64 → inflate → JSON.parse 全在主线程，低端机首屏可见卡顿。
- 严重程度：中
- 优化建议：Web Worker 解压 + `JSON.parse`，主线程只 `postMessage` 收对象引用。

---

## 维度四 · 代码质量与可维护性（第 73–90 条）

**第 73 条**
- 类型：代码
- 位置：`tools/_src-backup/travel.js`（6324 行）/ `planner.js`（2175 行）
- 问题描述：超长「上帝文件」，职责混杂（城市解析、推荐、百科、天气入口、引导全在一文件）。
- 严重程度：高
- 优化建议：按职责拆分为 `city.js`/`recommend.js`/`baike.js`/`guide.js`，`travel.js` 仅做聚合出口（已部分拆出 planner）。
- 修改前后对比：前 单文件 6324 行；后 多模块 + 薄出口。

**第 74 条**
- 类型：代码
- 位置：`tools/pack-data.mjs` 魔法数字 L76(4.0)/L141(26)/L90(3 位)
- 问题描述：评分阈值、截断长度、坐标精度均为散落字面量，无常量名，易误改且易触发门禁自伤（历史教训）。
- 严重程度：中
- 优化建议：提取 `const RATING_MIN=4.0, NOTE_MAX=26, COORD_DP=3` 置文件头，门禁断言引用常量而非字面量。
- 修改前后对比：前 散落字面量；后 命名常量集中。

**第 75 条**
- 类型：代码
- 位置：`utils/errlog.js` L6(`CAP=30`)/L22(`slice(0,600)`)
- 问题描述：日志容量/截断长度为魔法数字。
- 严重程度：低
- 优化建议：提取为 `LOG_CAP`/`MSG_MAX` 常量。

**第 76 条**
- 类型：代码
- 位置：`pages/index/index.js` `catch(e){}`(L149/L239) 等
- 问题描述：多处空 catch 吞异常（见安全 #42）。
- 严重程度：中
- 优化建议：空 catch 至少 `errlog.push`；`allcheck` 增加空 catch 扫描。

**第 77 条**
- 类型：代码
- 位置：`tools/_apply-safe.mjs` §9.7 改名守卫（已修复，见 L~588）
- 问题描述：历史 bug——`owners` 用改名前快照导致同城重复副本每轮 +11；已改为实时 `used` 判定并加回归断言。
- 严重程度：高（已修复）
- 优化建议：维持 `tools/_test-audit-guards.mjs` 第 36 条断言，禁止回退到 `owners.has(to)`。

**第 78 条**
- 类型：代码
- 位置：`utils/data.js` `__A` 空占位（死契约，见数据 #24）
- 问题描述：别名压缩停用后 `__A` 仅留空兼容位，误导维护者。
- 严重程度：低
- 优化建议：下个大版本清理。

**第 79 条**
- 类型：代码
- 位置：`utils/data.js` `require.async` 静态字面量硬约束（`resolveChunkPaths` L467 / pack-data L309–318）
- 问题描述：微信分包异步化要求 `require.async` 参数为唯一静态字符串，变量会静默丢数据、白屏——极脆弱。
- 严重程度：高
- 优化建议：在 `build-min.mjs` 增加 AST 检查：所有 `require.async` 实参必须是静态字面量，否则构建失败（而非运行时白屏）。
- 修改前后对比：前 运行时白屏才发现；后 构建期 AST 断言拦截。

**第 80 条**
- 类型：代码
- 位置：`tools/_test-audit-guards.mjs` `codeOnly()`(L201)
- 问题描述：门禁靠「先滤注释行再匹配字面量」避免被自身注释误伤，设计脆弱——注释改措辞可能漏判。
- 严重程度：低
- 优化建议：改用 AST/正则定位函数体，而非整文件字符串匹配；降低自伤概率。

**第 81 条**
- 类型：代码
- 位置：`allcheck.sh` 步数硬编码 61
- 问题描述：回归步数 61 为硬编码，新增步骤需同步改多处引用，易遗漏。
- 严重程度：低
- 优化建议：步数改为 `allcheck` 动态计数（`passed/total`），断言 `total≥N` 而非等于 61。

**第 82 条**
- 类型：代码
- 位置：`web/lib/runtime.js`（855 行混合 toast/modal/router/err）
- 问题描述：运行时适配层职责混杂，单文件承担路由+UI 组件+错误页。
- 严重程度：中
- 优化建议：拆分为 `router.js`/`ui.js`/`adapter.js`。

**第 83 条**
- 类型：代码
- 位置：`web/lib/modules.js`（13200 行压缩）
- 问题描述：无源码映射维护困难；调试靠反读压缩代码。
- 严重程度：中
- 优化建议：构建保留 `.map`（dev 版），发布版剥离；或保留未压缩 `web/lib/src` 便于追溯。

**第 84 条**
- 类型：代码
- 位置：散落 `wx.getStorageSync`/直接存储 vs `utils/store.js`
- 问题描述：部分页面绕过统一存储出口 `store.js` 直接调 `wx.storage`，破坏集中脱敏/容量管理。
- 严重程度：中
- 优化建议：全局 grep 直接 `wx.storage` 调用，统一收口到 `store.js`。
- 修改前后对比：前 直调 wx.storage；后 全走 store.js。

**第 85 条**
- 类型：代码
- 位置：`utils/errlog.js` `push`（仅 message，无 stack）
- 问题描述：错误只存 message 文本，缺堆栈，真机难定位「按了没反应」。
- 严重程度：低
- 优化建议：`push` 时 `err.stack` 截断存 200 字（dev 环境），prod 仅 code。

**第 86 条**
- 类型：代码
- 位置：异常抛出为字符串（`throw new Error("数据尚未加载完成，请稍后重试")`）
- 问题描述：无结构化错误类型，调用方只能字符串匹配，难分类处理。
- 严重程度：低
- 优化建议：定义 `DataNotReadyError`/`CoordError` 等子类，按类型 catch。

**第 87 条**
- 类型：代码
- 位置：`tools/_src-backup/data.js`（94 注释行 / 425 代码）
- 问题描述：注释比偏高，部分历史说明已过时（如别名压缩相关）。
- 严重程度：低
- 优化建议：清理与现实现状不符的注释，保留决策性注释（如白屏事故根因）。

**第 88 条**
- 类型：代码
- 位置：`utils/keys.js` `_resolve` 返回 null 但部分调用方未处理
- 问题描述：fail-closed 返回 null，但上游若不做 null 判断会 `amap.request(null)`，报错不友好。
- 严重程度：低
- 优化建议：调用方统一 `if(!key){ showConfigTip(); return; }` 模式。

**第 89 条**
- 类型：代码
- 位置：`tools/build-min.mjs`（terser 8 文件）
- 问题描述：压缩产物与 `_src-backup` 真源分离，维护者易改错文件（改 `utils/` 被下次构建覆盖）。
- 严重程度：中
- 优化建议：在 `utils/` 顶部注释 + `allcheck` 断言「`utils/*.js` 与 `_src-backup` 构建一致」，改错即红。

**第 90 条**
- 类型：代码
- 位置：`tools/_apply-safe.mjs`（1000+ 行合并+补丁混合）
- 问题描述：数据修正脚本同时承担「合并团队数据 + 应用补丁 + 生成资料卡」，单一巨函数难测。
- 严重程度：中
- 优化建议：拆为 `mergeTeam()`/`applyPatches()`/`buildCards()` 三函数，各自单测。

---

## 维度五 · 架构与设计（第 91–108 条）

**第 91 条**
- 类型：架构
- 位置：`utils/keys.js`+`data.js` ↔ `tools/_src-backup/*`（cp 同步关系）
- 问题描述：手写文件与其真源靠 `cp` 同步，双源并存是回归高发点（曾导致门禁误判全绿）。
- 严重程度：高
- 优化建议：把 `keys.js`/`data.js` 也纳入 `build-min.mjs` 生成（或统一 `cp` 脚本收口），消除人工 cp 心智负担。
- 修改前后对比：前 人工 cp；后 构建链自动同步 + 漂移门禁。

**第 92 条**
- 类型：架构
- 位置：数据管线 `_merge-team-enrich.mjs` → `_apply-safe.mjs` → `pack-data.mjs`
- 问题描述：三步手工串联，漏跑 `pack-data` 会让 `utils/data.js` 留在纯 JSON 态→白屏（历史事故）。
- 严重程度：高
- 优化建议：用一个 `build-data.sh` 串联三步并加「末态校验」（`data.js` 非纯 JSON 且含 2 条静态 require.async）。
- 修改前后对比：前 三步分离易漏；后 单命令 + 末态断言。

**第 93 条**
- 类型：架构
- 位置：无后端 / `utils/errlog.js` 仅本地环形缓冲
- 问题描述：无遥测/监控，真机/审核环境问题只能靠用户主动反馈，开发者不可见。
- 严重程度：中
- 优化建议：个人主体无法上云，但可加「用户一键导出 errlog」入口，或（认证后）用云函数接收匿名聚合。

**第 94 条**
- 类型：架构
- 位置：版本真值在 3 处（`project.config.json`/`APP_VER`/`docs` 材料）
- 问题描述：版本号三处需手工对齐，曾出现不一致。
- 严重程度：中
- 优化建议：以 `project.config.json` 为唯一真源，`build-min`/`check-doc-consistency` 自动读取并校验其余两处。
- 修改前后对比：前 三处手工；后 一处真源 + 自动同步校验。

**第 95 条**
- 类型：架构
- 位置：个人主体限制（无微信认证）
- 问题描述：个人主体无法解锁 web-view/支付/云同步，架构上无法做服务端能力（代理 key、云存储、登录）。
- 严重程度：高（业务约束）
- 优化建议：若需服务端，升级为个体工商户并认证；在此之前所有架构设计假设「纯前端 + 本地存储」。

**第 96 条**
- 类型：架构
- 位置：`web/` 由小程序源码重编译（`tools/web/build.mjs`）
- 问题描述：网页版是小程序逻辑的「第二构建目标」，两份产物同步维护，易漂移。
- 严重程度：中
- 优化建议：把 `web/build.mjs` 与 `build-min.mjs` 统一为单构建配置，一次改动双目标产出。

**第 97 条**
- 类型：架构
- 位置：页面直接读 `D.*`（紧耦合）
- 问题描述：pages/subpkg 直接访问全局 `D`（数据对象），无数据访问层，重构数据结构会波及全部页面。
- 严重程度：中
- 优化建议：引入 `dataApi`（getter 集合），页面只调 `dataApi.spotsOf(city)`，隔离内部形状。

**第 98 条**
- 类型：架构
- 位置：无 CI（仅本地 `allcheck.sh`）
- 问题描述：回归依赖开发者本地跑 `./allcheck.sh`，易漏跑；无远程 CI 闸门。
- 严重程度：中
- 优化建议：GitHub Actions 接 `allcheck.sh`（托管 node 版本解析已修复），PR 必过 61/61。

**第 99 条**
- 类型：架构
- 位置：`subdata`/`subdata2` 分包注册（`app.json` pages:[] 技巧）
- 问题描述：分包靠 `pages:[]` + 预载 trick 注册，数据溢出 2 块时无自动扩容（见数据 #26）。
- 严重程度：中
- 优化建议：分包注册改为构建期生成，按数据量自动决定 N 个分包 + 预载规则。

**第 100 条**
- 类型：架构
- 位置：`utils/emergency-data.js` 与 `D.HOSPITALS` 双医院源
- 问题描述：应急医院在两个结构里，统计/展示口径需手动对齐（见数据 #19）。
- 严重程度：中
- 优化建议：统一到单一 `hospitals` 模块，按 `verified`/`approx` 标记区分，消除双源。

**第 101 条**
- 类型：架构
- 位置：`tools/spot-tags.js`/`toolkit-groups.js`（生成产物）
- 问题描述：标签/工具分组为生成产物，其重新生成是否纳入 `allcheck` 未确认，可能漂移。
- 严重程度：低
- 优化建议：把生成脚本纳入 `allcheck` 一个步骤，断言产物与源一致。

**第 102 条**
- 类型：架构
- 位置：无环境配置（dev/prod 区分仅 `APP_VER`）
- 问题描述：无 feature flag / 环境变量体系，调试开关散落（`__h`/`__pick` 等）。
- 严重程度：低
- 优化建议：引入 `config.js`（`{env, debug, features:{}}`），开关集中管理。

**第 103 条**
- 类型：架构
- 位置：打包数据无 schema 版本字段
- 问题描述：`data-packed*.js` 无 `schemaVer`，旧包加载新结构数据无前向兼容判断。
- 严重程度：中
- 优化建议：manifest 加 `schemaVer`，加载期比对，不匹配则提示更新而非崩溃。
- 修改前后对比：前 无版本；后 manifest.schemaVer + 加载期比对。

**第 104 条**
- 类型：架构
- 位置：`tools/_archive/`（3.5MB 备份）
- 问题描述：历史备份存于仓库 `_archive`，虽 `.gitignore` 已覆盖，但增大克隆体积。
- 严重程度：低
- 优化建议：备份移出仓库（本地或 LFS），保持仓库精简。

**第 105 条**
- 类型：架构
- 位置：`tools/_hospital-batch4/5/6.json` 必须留 `tools/`（非 `_archive`）
- 问题描述：1572 行负样本指纹门禁依赖这些文件在场，归档会破坏门禁。
- 严重程度：中
- 优化建议：在 `_test-roster-integrity.mjs` 断言这些文件存在，缺失即 fail（防误归档）。

**第 106 条**
- 类型：架构
- 位置：`tools/lib-near-dup.mjs`（被 `_apply-safe`/`geocode-runner` 依赖）
- 问题描述：近重工具是活依赖，若被误归档会断构建。
- 严重程度：低
- 优化建议：`check-deps.mjs` 已将其纳入依赖扫描（`SKIP_PATH` 含 `_archive`），维持。

**第 107 条**
- 类型：架构
- 位置：无日志/监控/告警体系（架构维度）
- 问题描述：仅有本地 errlog 环形缓冲，无聚合、无告警、无性能指标采集。
- 严重程度：中
- 优化建议：定义最小遥测契约（事件/错误/性能），认证后接云函数；当前先固化本地契约便于未来接入。

**第 108 条**
- 类型：架构
- 位置：`app.js` + 全局 `globalData`
- 问题描述：跨页状态依赖 `app.globalData` 全局可变对象，无单向数据流，难追踪状态来源。
- 严重程度：中
- 优化建议：引入轻量 store（`utils/store.js` 已存在）承载全局态，页面通过订阅读取，减少 `globalData` 直写。

---

## 补充 · 网页版 AI 助手 + 全屏自适应专项审计（第 109–125 条，2026-11-09 晚）

> 本轮新增 `web/ai-assistant.js`、`web/ai-assistant.css`、`web/shell.css` 全屏适配、`web/index.html` 引入。
> 下列条目专门覆盖这些新增代码与尚未闭环的历史安全项；编号承接上文至 125 条（合计 ≥100）。

**第 109 条**
- 类型：安全
- 位置：web/ai-assistant.js · llmCfg()/save handler（localStorage 键 `ai_llm_cfg_v1`）
- 问题描述：可选大模型开关把用户的 API Key 以明文存进浏览器 localStorage，未加密；一旦页面存在任意 XSS（见 #36 CSP 缺失）或设备被本地访问，密钥即泄露。
- 严重程度：中
- 优化建议：Key 入 localStorage 前做轻量混淆（XOR + 随机前缀），并在设置面板明确提示「密钥仅存于本机浏览器」；或改为每次会话临时输入、不持久化。
- 修改前后对比：前 明文存 `ai_llm_cfg_v1`；后 混淆存储 + 提示文案。
- 状态：**✅ 已闭环（2026-11-09）**：新增 `_xor` 混淆 + `llmSave()`（写时混淆并打 `_obf` 标记）、`llmCfg()`（读时还原，兼容旧明文），`aiSave` 处理器已切到 `llmSave`；设置面板提示「留空则使用内置离线助手」。验证：XOR 可逆 PASS、密文≠明文 PASS。

**第 110 条**
- 类型：安全
- 位置：web/ai-assistant.js · callLLM()（`url = cfg.baseURL + "/chat/completions"` → `fetch(url,…)`）
- 问题描述：大模型 baseURL 由用户自由填写并经 `fetch` 发起请求，等价于客户端请求伪造——用户若粘贴恶意/内网地址，浏览器会代发请求。
- 严重程度：中
- 优化建议：对 baseURL 做协议+域名校验（仅允许 `https://`，拒绝 `http://` 与内网段 127./10./192.168.；可选 LLM 域名白名单）；非白名单直接拒绝并 toast。
- 修改前后对比：前 任意 URL 直发；后 协议 + 域名安全校验。
- 状态：**✅ 已闭环（2026-11-09）**：新增 `safeBaseURL()`（仅 https、拒 localhost/127./10./192.168./169.254./0./172.16-31.），`callLLM` 与 `aiSave` 均经其校验，非法则 toast 并暂不启用大模型。验证：13 条用例全 PASS（含 172.32 公网放行、尾斜杠清理）。

**第 111 条**
- 类型：安全
- 位置：web/ai-assistant.js · send()（用户消息无长度上限）
- 问题描述：用户消息未限制长度，超长输入会被推入对话历史并拼进 LLM messages，浪费 token 且可被用作长文本拒绝服务。
- 严重程度：低
- 优化建议：在 send() 前端做 `if (v.length > 2000) v = v.slice(0,2000) + "…"` 并 toast 提示。
- 状态：**✅ 已闭环（2026-11-09）**：`send()` 已加 2000 字上限，超限截断为 `…` 并 `toast("已截断到 2000 字上限")`；配套新增 `.ai-toast` 样式（深浅色自适应）。

**第 112 条**
- 类型：代码
- 位置：web/ai-assistant.js · pushBot()/buildReply()（HTML 字符串拼装 → innerHTML）
- 问题描述：助手消息通过 innerHTML 注入拼装好的 HTML 字符串，虽当前所有动态字段均经 `escapeHtml`，但「字符串拼 HTML」模式本身是 XSS 高危习惯，后续维护者多加一个未转义字段即破防。
- 严重程度：中
- 优化建议：改用 DOM 节点构建（`createElement` + `textContent`）或引入轻量模板引擎；至少把 `escapeHtml` 收口为唯一出口，并在 `allcheck` 增加「innerHTML 动态片段」扫描（呼应 #32）。
- 修改前后对比：前 字符串拼 innerHTML；后 节点构建 / 统一转义出口。

**第 113 条**
- 类型：安全
- 位置：web/ai-assistant.js · callLLM() 的 onErr（错误回退链路）
- 问题描述：LLM 调用失败时把原始 `e.message` 直接 `pushBot("⚠️ " + err)`，错误信息可能含响应体片段；虽仅本地展示，但属未脱敏的异常透传。
- 严重程度：低
- 优化建议：回退文案固定为「大模型请求失败，已切换离线助手」，详细错误仅 errlog，不进对话气泡。
- 修改前后对比：前 透传 message；后 固定文案 + 隐式 errlog。
- 状态：**✅ 已闭环（2026-11-09）**：`callLLM` onErr 三处已固定文案（接口异常 / 请求失败 CORS / 非 2xx 或结构异常），原始异常不进气泡。

**第 114 条**
- 类型：安全
- 位置：web/index.html（仍无 CSP，#36 未闭环）
- 问题描述：本轮新增 ai-assistant.js/css 与全屏样式，但 `index.html` 仍未加 `Content-Security-Policy`；配合内联脚本与 localStorage 密钥（#109），XSS 影响面被放大。
- 严重程度：中
- 优化建议：在 `<head>` 增加 `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">`（样式需 inline 故放行 style），并逐步把内联脚本改外部文件。
- 修改前后对比：前 无 CSP；后 限定 self 源 + 逐步去内联。
- 状态：**✅ 已闭环（2026-11-10）**：`web/index.html` 已加 `Content-Security-Policy` meta（default-src 'self'；script/style 暂放行 inline 因历史内联；connect-src 仅放行 `*.qweatherapi.com`/`*.amap.com`，可选大模型 api.openai.com 被拦后优雅回退离线助手；#115 出站门禁在策略层一并收敛）。

**第 115 条**
- 类型：安全
- 位置：web/lib/runtime.js · fetch 适配（#31 未闭环）+ ai-assistant 可选 LLM 任意 baseURL（#110）
- 问题描述：天气/地理 `wx.request` 适配到 `fetch`，url 未经白名单校验；结合可选 LLM 的任意 baseURL，客户端出站请求面进一步扩大。
- 严重程度：中
- 优化建议：集中一个 `safeFetch(url, opts)`，对全部出站请求做域名白名单（api.qweather.com / restapi.amap.com / 用户显式声明的 LLM 域名），非白名单拒绝。
- 修改前后对比：前 两处各自 fetch；后 统一 safeFetch 门禁。

**第 116 条**
- 类型：安全
- 位置：web/lib/data.js（2.35MB 全量数据 base64，#45 未闭环）
- 问题描述：网页版把 751 城 / 8852 店 / 24362 点全量打包进前端 bundle，任何人可拉取完整 POI 与医院库，数据资产暴露；亦拖累首屏（#57）。
- 严重程度：中
- 优化建议：热门城市首屏必需数据内联，其余按城市按需异步拉取（复用 `require.async` 分包机制）；或对数据接口加轻量签名防爬。

**第 117 条**
- 类型：安全（合规红线）
- 位置：utils/keys.js `DEFAULT`/本地内置 和风 Key（未提交，仍在工作区）
- 问题描述：和风 Key 以「本地内置」形式存在于工作区 `keys.js`/`_src-backup`，虽不进公开仓库，但属明文凭据；git 历史曾含明文（记忆 P0 项），泄露后无法远端回收。
- 严重程度：高
- 优化建议：升个体户/企业并认证后，将 key 收口到云函数/自有后端，前端仅持短期 token（呼应 #29）；在此之前轮换并清理工作区明文，改用运行期注入。

**第 118 条**
- 类型：性能
- 位置：web/ai-assistant.js · whenReady()（setInterval 300ms × 20 兜底）
- 问题描述：若离线数据始终未就绪，助手每 300ms 轮询 20 次（共 6s）才放弃；期间每次 send 都进轮询分支，存在无效轮询与轻微主线程占用。
- 严重程度：低
- 优化建议：轮询改为单次 `T.ready()` Promise 等待 + 一个 6s 超时，省去 setInterval；数据就绪后缓存 `ready=true` 标志避免重复等待。
- 状态：**✅ 已闭环（2026-11-09）**：`whenReady` 改为 `Promise.race([T.ready(), 6s 超时])` + `_readyDone` 标志，彻底去除 setInterval 轮询，无泄漏且只等一次。

**第 119 条**
- 类型：性能
- 位置：web/ai-assistant.js · detectPlace()（`allCityNames()` 已缓存，但每次对 751 名 `indexOf` 扫描）
- 问题描述：每条用户消息对 751 个城市名逐个 `indexOf` 扫描，虽名称数组已 `_cityCache` 缓存，但 O(n) 线性扫描在高频对话下仍有不必要开销；最长匹配优先逻辑依赖排序。
- 严重程度：低
- 优化建议：预构建单条正则 `(城市1|城市2|…)` 一次匹配，或建 Trie；命中后取最长匹配。名称数组变化极少，可在数据就绪时构建一次。
- 状态：**✅ 已闭环（2026-11-09）**：新增 `placeRegex()` 将 CITIES(≥2字)+PROVINCES+CITY2PROV 排序(长优先)后拼单条 `RegExp`，`detectPlace` 单次 `exec` 扫描取最长命中；正则缓存 `_placeReg` 只构建一次。

**第 120 条**
- 类型：代码
- 位置：web/ai-assistant.js · openPanel() 欢迎语与离线状态
- 问题描述：当 6s 轮询超时后数据仍未就绪，欢迎语不会触发，助手在「空数据」状态下仍可接收并作答（buildReply 对缺失数据返回兜底文案），无明确的「知识库未加载」提示，用户体验割裂。
- 严重程度：低
- 优化建议：whenReady 超时后向用户明确提示「离线知识库加载较慢，部分回答可能不完整」，而非静默兜底。

**第 121 条**
- 类型：架构
- 位置：web/ai-assistant.js（仅网页版存在，小程序端无对应能力）
- 问题描述：AI 助手作为新能力只在网页版实现，小程序端（主产品）反而不具备；与「一切以小程序为主」的定位相反，两端能力不对齐。
- 严重程度：中
- 优化建议：将助手的意图识别 + 离线问答核心抽为 `utils/ai-core.js`（纯函数、不依赖 DOM），网页版做 UI 壳、小程序端用同核做「对话式行程生成」，避免重复实现且对齐两端。

**第 122 条**
- 类型：架构
- 位置：web/（第二构建目标，#96 未闭环）
- 问题描述：网页版由小程序源码重编译，AI 助手、全屏样式等改动需同步维护两份产物；本轮仅改 web/，小程序端若后续要该能力需重新移植。
- 严重程度：低
- 优化建议：把 AI 核心与全屏适配（rpx/视口）做成可共享的构建宏/配置，单改动双目标产出（呼应 #96）。

**第 123 条**
- 类型：代码
- 位置：web/ai-assistant.js（缺单测）
- 问题描述：新模块无对应单测，意图识别/城市识别/价格拼接等逻辑回归无保障；与项目「审计护栏 + allcheck」文化脱节。
- 严重程度：低
- 优化建议：在 `tools/` 增加 `_test-ai-core.mjs`，对 `detectIntent/detectPlace/buildReply` 喂样例输入断言输出（如「成都吃什么」→ 回复含 `FOOD_SPOTS[成都]` 店铺名）。

**第 124 条**
- 类型：数据
- 位置：utils/data.js `FOOD_SPOTS[city][].price`（#22 未闭环）
- 问题描述：美食价格以字符串存储（如「人均约¥110」），类型不一致；本轮 ai-assistant 渲染端做了兼容处理，但底层类型混乱仍影响排序/区间筛选。
- 严重程度：低
- 优化建议：补 `priceNum`（数值）+ 单位分离，渲染端直接消费数值，杜绝字符串拼接歧义。

**第 125 条**
- 类型：数据
- 位置：web/ai-assistant.js · getSpots()（SPOT_COORDS 为主源，CITY_LANDMARKS 稀疏）
- 问题描述：景点作答改用 `SPOT_COORDS`（438 城/24362 点）后覆盖显著优于原 `CITY_LANDMARKS`，但 `SPOT_COORDS` 坐标精度与时效未向用户标注，可能误当权威景点库；且部分城市仅 APPROX 城心坐标（见 #13）。
- 严重程度：低
- 优化建议：景点作答底部统一标注「数据来源：离线知识库 · 坐标为城市/景点真实坐标，仅供参考」，置信度低时提示用 App 行程页核对。

---

**第 126 条**
- 类型：安全 / 工程闭环（本轮整改记录，2026-11-09）
- 位置：web/ai-assistant.js · web/ai-assistant.css · docs/code-audit-2026-11-09.md
- 问题描述：承接用户「你还能优化什么，直接做」指令，对网页版 AI 助手做安全与性能加固，闭环审计 #109/#110/#111/#113/#118/#119 六条。
- 严重程度：低（加固项）
- 优化建议（已落地，留痕）：
  - #109 明文 Key → `llmSave` XOR 混淆 + `_obf` 标记，`llmCfg` 读时还原，设置面板明确「密钥仅存本机浏览器」；
  - #110 任意 baseURL → `safeBaseURL()`（仅 https、拒 localhost/127./10./192.168./169.254./0./172.16-31.），`callLLM` 与 `aiSave` 双校验；
  - #111 消息无长度上限 → `send()` 2000 字上限 + `.ai-toast` 截断提示；
  - #113 异常透传 → `callLLM` onErr 三处固定文案，原始错误不进气泡；
  - #118 轮询泄漏 → `whenReady` 改 `Promise.race([ready(),6s])` + `_readyDone` 标志，去 setInterval；
  - #119 线性扫描 → `placeRegex()` 单条合并正则 + `_placeReg` 缓存，单次扫描取最长命中。
- 验证：`node --check` 语法 PASS；静态服务 index/ai-assistant.js/ai-assistant.css 均 200；`_xor` 可逆 + `safeBaseURL` 13 用例全 PASS。
- 修改前后对比：前 6 项均为原始隐患态；后 6 项全部闭环并写入本报告状态标注。

---

## 附：已收口/已修复项（审计追溯，非新缺陷）

- 死代码清理：`tools/pack-data.mjs` 删除 69 行停用别名压缩函数（sha1 字节级等价，零体积变化）—— 见压缩程序收口。
- §9.7 改名守卫幂等修复（`_apply-safe.mjs` + 第 36 条回归断言）—— 见本轮整改。
- 密钥明文出仓（`keys.js` DEFAULT 清空 + `setKeys` 运行时注入）—— 审计 #1/#19。
- 网页版 XSS：`escHtml` 全量覆盖 innerHTML 动态文本 —— 审计 #44/#46。
- 导入净化：CSV 公式注入 + 逐条净化 —— 审计 #15/#16/#65。
- 打包期坐标完整性硬门禁 + 精确去重护栏 —— 防回潮。
- 百科零外链（`baikeUrl` 删除、`onBaike` 零剪贴板、`spotBaikeBar` 无 `<a>`）—— 合规。
- 网页版 AI 助手安全/性能加固闭环：#109 密钥 XOR 混淆、#110 baseURL 安全门禁、#111 消息 2000 字上限、#113 异常不透传、#118 去 setInterval 轮询、#119 城市名单条正则扫描 —— 见第 126 条整改。

> 说明：本报告中「SQL 注入 / N+1 / 索引缺失」类传统后端条目，因本项目**无数据库层**，已按等价内存数据访问问题如实改写（见第 9/51/52/53/58/60 等条），未虚构任何数据库结论。
