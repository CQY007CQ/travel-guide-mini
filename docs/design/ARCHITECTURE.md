# 架构说明

这份文档回答的是「为什么这么设计」，以及「哪些地方改了会出事」。
接口清单请直接看代码，这里不复述。

---

## 一、设计取舍

### 1. 为什么坚持「端上离线生成」

不是因为技术上做不到云端 —— 恰恰相反，接个大模型 API 比写这套算法省事得多。坚持离线是三笔账算下来的结果：

| 维度 | 云端生成 | 端上生成 |
|---|---|---|
| 主体门槛 | 「深度合成 - AI 问答」类目**仅企业主体可申请**，个人主体上不了实时生成式对话 | 无门槛 |
| 内容可信度 | 大模型会编出不存在的景点、错的开放时间 | 全部来自本地知识库，编不出来 |
| 响应速度 | 整份行程要等 10–30 秒流式输出 | 本地毫秒级 |
| 运行成本 | token 费用随用户量线性增长 | 零 |

代价是：内容必须人工沉淀，覆盖速度慢。所以这个项目的护城河是**数据质量**而不是模型能力。

> 补充合规背景：《人工智能生成合成内容标识办法》2025-09-01 施行，AI 内容须显式 + 隐式双重标识。
> 本项目所有文本均为人工整理或模板生成，**不属于生成合成内容**。

### 2. 为什么不用 web-view 把网页版塞进去

个人主体小程序不支持 web-view（需企业类目 + 备案域名）。这条路在立项时就排除了，
所以全面重写为原生小程序。网页版作为独立产物保留，两条线共用同一套数据与算法。

### 3. 为什么数据和算法分成三个源目录

`utils/` 下的 `data.js` / `planner.js` / `travel.js` 都是**生成产物**（部分经 terser 压缩），
真源在 `tools/_src-backup/`。这样分是为了让 `pack-data.mjs` 能无损覆盖产物而不担心手改被吃掉。
代价是"改了 utils/data.js 没效果"这个坑 —— 已在 `pack-data.mjs` 里加了断言与注释守卫。

---

## 二、分包结构与容量预算

微信小程序单个分包有 **2MB 硬上限**，这是整个架构最大的约束。

```
主包    635.9 KB   splash + 4 个 tabBar 页 + 全部 utils
subdata  1.7 MB    ★ 城市数据块（deflate + base64）+ boost 占位页
subdata2 257.9 KB  数据第 2 块（体积超单块阈值时自动启用）
subdata3  91 B     占位（cleanStale 会清空，随时可能被自动启用）
subpkg  150.8 KB   map / food / ledger / prep / assistant / guide / toolkit / rank
subai      ~60 KB  1.19.78 新增：深玩内容 + deep 页
────────────────
合计      2.7 MB
```

设计要点：

- **数据与页面分离**。数据块单独放在 `subdata*`，是为了让它独占一个 2MB 配额，不被页面代码挤占。
- **分块数自动切换**。数据量超过单块上限（约 1.95MB）时 `pack-data.mjs` 自动拆第二块；
   `_src-backup/data.js` 里必须同步写上与分块数**一一对应**的静态 `require.async` 字面量，
   少一条就 fail-fast（防止又退化成变量拼接）。
- **每个数据分包都要有一个占位页**。`subdata/boost/boost` 之类就是为满足"WeChat 分包 pages 非空"而存在。
- **`subai` 单独开包而不是塞进 `subpkg`**：内容会持续膨胀（Top10 → Top50 → Top100），
  给它一个干净的独立配额，`require.async` 时也只拉内容不连带 8 个页面代码。

### `ignoreUploadUnusedFiles: true` 的暗坑

开启这个选项后，微信上传分包器做**静态分析**，凡 traced 不到的文件都会被当成"未使用"剥离。
`subai/data/ai-deep.js` 是靠三条显式静态字面量保住的：

1. `utils/aicontent.js` → `require.async("../subai/data/ai-deep.js")`
2. `subai/deep/deep.js` → `require("../data/ai-deep.js")`（同分包，同步 require）
3. `app.json` 里声明 `subai/deep/deep` 页面

任何一条被改成变量拼接，内容就会在上传时被静默剔除 —— 用户端表现为"页面打开了但内容是空的"。

---

## 三、数据加载链路

```
页面 onLoad
  └─ T.ready()                        ← travel.js 暴露的统一就绪门
       └─ data.initData()             ← utils/data.js（holder）
            ├─ 微信端：require.async(静态字面量) × N → applyPacked()
            └─ Node 端：同步 require()  × N → applyPacked()
                 └─ base64 → pako.inflate → JSON → mergeInto(DATA)
```

几个关键决策：

- **holder 模式**：`utils/data.js` 本身不含数据（只有 162 行），主包因此不背那个 1.7MB。
  所有消费方通过 `DATA.xxx` 访问，加载完成后值自然填进来。
- **`planner.js` 在模块顶层解构 data.js**，所以必须由 `travel.js` **惰性 require** ——
  数据就绪之后才加载，否则顶层解构拿到的是空数组。
- **限时推进**：`Promise.race([Promise.all(jobs), sleep(9000)])`。
  分包下载卡住时不让 `ready()` 永远挂起；晚到的分块到达后仍会自行 `applyPacked`，不丢数据。
- **失败可重试**：错误状态记在 `_loadErr`，首页有「重试加载」入口，不做沉默失败。

`utils/aicontent.js` 是完全同构的一份迷你实现（深玩内容用），规则一致：
增强能力、加载失败不影响主流程 —— `deepOf()` 取不到就返回 `null`，UI 自动不渲染那张卡。

---

## 四、行程生成算法

`tools/_src-backup/planner.js`（2,180 行）+ `travel.js`（5,484 行）是算法与领域层，
`pages/index` 调 `T.buildPlan(...)`，`pages/plan` 只负责渲染与编辑。

关键路径：

1. **候选筛选**：按城市取 `experiences` 池，结合景点标签、出行模式（亲子 / 情侣 / 独行 / 带老人）与预算档位分层过滤
2. **每日锚点 `anchorForDay`**：前 `min(days, 4)` 名经典景点按**离城距离升序**分配为每日主锚点
   - ⚠️ 历史上曾改成"距离折扣"（`d -= 300`），结果把西安排成了秦岭登山游。
     **不要引入距离权重**，就近靠锚点 + 后续排序实现。
3. **填充**：每个时段槽位从候选池取距离锚点最近的未使用项，`mealTail` 16 条 + 索引
   `(城市奇偶) + 天*2 + seq` 保证同日/跨天餐饮文案不重复
4. **去重 `spotOverlap`**：语义相似度去重，**用户勾选的必玩景点不参与去重**
5. **大景点整日**：`BIG_SPOT_DAYS` 里的 55 个大景点单独成天（全省游则单独成组）
6. **坐标绑定**：`getSpotCity(spot, prov)` 三级规则（相等/前缀/后缀） + `_spotCityFuzzy` 模糊兜底，
   再用 `SPOT_COORDS[city]` 精确匹配；取不到才退到 `CITY_COORDS[city]` 城市锚点

> `bestMatch` / `isWished` + `_wishNameHit` / `getSpotCity` 三处必须**同规则**，
> 改一处要同步另外两处，否则会出现"想玩的故宫排不进去"这类诡异问题。

### 编辑的稳定性

行程是**可持久编辑**的（拖拽 / 上下移 / 删除 / 换同类 / 加自定义 / 打卡），因此引入了几条约束：

- **时段属于"坑位"不属于景点**：permute 之后把原 `periods[]` 数组**原样贴回去**，而不是重新排序。
  否则用户拖一次，整天的时间安排就乱了。
- **`_edRank` 在 splice 之前取**：取 `experiences` 里的原始序号做局部 Map，不往源数据写 `_rank`（污染）。
- **每次编辑后立即 `normalizeDayItems`**，保证 begin/end 时间与相邻点位一致。

---

## 五、交互实现要点

### 拖拽排序（`pages/plan`）

- `catchtouchmove` **只挂在六点手柄上，绝不挂 `.tl-item`**。
  挂整条会吃掉页面滚动手势 —— 手指按在行程上就滑不动页面了，这是最容易做坏的一处。
- 起始 Y 优先取 `onDragStart` 的 `e.touches[0].clientY`。早期版本只在首次 `touchmove` 确定，
  导致**首帧位移恒为 0**，看起来像"拖动有延迟"。这个 bug 是 vm 单测抓出来的。
- 让位位移用精确值 `rects[j±1].top - rects[j].top`，不是估算的固定行高。
- 拖完 400ms 内屏蔽 `onToggle`，避免抬手时被当成点击展开详情。

### 模板路线（`pages/index`）

`onTplPick` **必须先 `setData days` 再 `_fillProv`**。顺序反了，天数会被 `_applyCity` 里的
`cityDayCap` 收敛掉，表现为"选了 5 天的模板结果只有 3 天"。

### 入场动效

`__animOn` 由 `_renderShow` 置位、`_render` 消费掉 → 只在**进页那一次**放错落入场动效。
早期版本每次 save 都整页闪一下，就是因为渲染没有消费这个标记。

### 主题系统

`app.wxss` 在 `page` 上定义全部 token（浅色为默认），`.td` 类上重定义同一批 token（深色）。
页面根结点挂 `{{td ? 'td' : ''}}`。

- ⚠️ **CSS 变量必须同时在 `page` 和 `.td` 两个作用域都定义**，只在 `page` 定义的话暗色下会发黑。
- ⚠️ **WXSS 禁中文选择器**，这是压缩器会炸的限制。
- 页面里硬编码的深色需要用 `app.wxss` 的 `.td` 覆盖（靠特异性压制页面规则）。
- 字号缩放统一走 `--fs`：`font-size: calc(28rpx * var(--fs, 1))`。
  批量替换脚本的匹配串**必须带 `font-size:` 前缀**，漏写会把一堆裸 `calc()` 写到属性外被丢弃。

---

## 六、容错与全局兜底

| 层 | 措施 |
|---|---|
| `app.js` | `onError` / `onPageNotFound` 全局安全网，异常不扩散到白屏 |
| `pages/index` | 数据就绪自愈 + 加载失败重试 UI（`dataFailed` 卡片） |
| `pages/plan` | `onShow` 是唯一入口，任何异常都不得白屏；无行程时**说清原因**再切回出发页 |
| `pages/prep` | `onShow` 加异常防护（历史上白屏过） |
| 天气 | 取不到时显式提示 + 重试按钮，并说明"攻略/地图/清单不受影响" |
| 广告 / 提醒 / 深玩 | 全部 **fail-open / fail-silent**，故障时不弹错、不阻塞主流程 |

---

## 七、踩过的坑（按代价排序）

### ★★★★★ require.async 传变量 → 首页白屏

微信「分包异步化」要求实参是唯一的静态字符串字面量。传变量时微信**编译期解析不到目标分包**，
数据块永远不加载，`CITIES` 是空的，首页拿不到城市数据 → 白屏 / "无法加载完整数据内容"。

防护：`pack-data.mjs` 内置静态字面量断言 + `tools/_test-wx-async.mjs` 模拟微信异步分支
（Node 常规 `require` 没有 `.async`，这条分支平时根本走不到，是历史漏测点）。

### ★★★★★ `ignoreUploadUnusedFiles` 把数据分包剥成 10KB

见第二节。每次上传后**必须核对尺寸表**，看到 `subdata 10.0KB` 就是残包。

### ★★★★☆ WXML mustache 未闭合 → 上线才发现

`lazyCodeLoading: requiredComponents` 下，开发者工具 `open` **只编译主包页**，分包页延迟编译。
所以分包页写了 `wx:if="{{noData">`（漏 `}}`），开发态零报错，而 `cli upload` 全量编译时必炸，
报 `74:1:unexpected end` —— 报错行号 = 文件行数 + 1，因为 mustache 一直吃到文件 EOF。

排查一招：统计每个 `.wxml` 的 `{{` 与 `}}` 数量是否相等，秒定位。
**铁律：开发态零报错 ≠ 能上传，发包前必须真跑一次 `cli upload`。**

### ★★★★☆ 键别名压缩 `pack-data` 与 `_apply-safe` 不同源

压缩工具写别名、`_apply-safe` 读原始长键 → 持续污染 → 键损坏 → `CITIES[i].name` undefined。
**已停用**，数据一律长键。`_KEYMAP` 恒为 `{}`，不要重新启用。

### ★★★☆☆ `merge-data-patch.mjs` 整体替换

会把 `CITIES_ADD` 整体替换，导致 `experiences` 塌回 8655 条。已禁用，统一走 `_apply-safe.mjs`。

### ★★★☆☆ 同一文件同一批多 Edit 只留最后一个

实测会静默回滚。多改同一文件必须分批，或写成带"恰好命中 1 次"断言的脚本（现有 `tools/_v11978-*.mjs` 一批）。

### ★★☆☆☆ 省名被当成城市键

`SPOT_COORDS["吉林"]` 这种脏键会让 `getSpotCoord` 跳过全省扫描，导致省域解析串城。
`pack-data.mjs` 每次打包自动清理（非直辖市的省名键），不要把这条只写在一次性脚本里 ——
`_apply-safe` / geocode 自动化会反复把它引进来。

### ★★☆☆☆ 外借第三方 API Key

他人实名账号的 Key 一旦被封，处置落在对方账号上，你无法替他解封。
现已全部停用，并在 `_amap-compliance.mjs` 里只保留 sha256 摘要用于失败拦截。

---

## 八、测试策略

三层：

1. **`./allcheck.sh`（17 项）** —— 语法、JSON、数据健康、重名定义防覆盖、7 组单测、
   泛词/雷同扫描、行政区覆盖审计、全省生成回归、高强度压测、WXML 结构、页面结构与事件配对、包体预警
2. **专项 vm 回归** —— 从源码 `indexOf` 抽真实 handler 文本进沙盒跑（拖拽 26 项、模板 12 项、
   深玩 24 项、广告 17 项、提醒 36 项），测试与源码不漂移
3. **模糊测试** —— `tools/_fuzz-999999.mjs` 跑满 999,999 次随机迭代，
   计数全 0（crash / 重复 / return 后仍变更 / 非法接受 / 占位符泄漏 / 长度不符 / 空日）
4. **上传前必跑 `cli upload` 全量编译** —— 这条放在最后但最重要，它是唯一能提前抓到分包页编译错误的方式
