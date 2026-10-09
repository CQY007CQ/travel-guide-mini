# 旅行攻略生成器 · 微信小程序

一个**全程离线**的行程生成小程序：不调用任何大模型 API，所有行程由端上算法在本地算出。

输入「城市 + 天数 + 预算 + 出行偏好」，输出一份可执行的逐日攻略：每天的时段安排、景点间的
交通动线与步行量、能直接导航的真实坐标、预算拆解、打包清单、逐日天气（联网时才有，
断网自动降级）。城市数据与坐标随分包下发，**装机后完全不需要网络**。

- 版本：`1.19.78`
- AppID：`wxa365d49bc3366f95`（个人主体）
- 基础库：`3.8.12`
- 页面：主包 5 页（含 4 个 tabBar）+ 分包 10 页

---

## 一、它能做什么

| 能力 | 说明 |
|---|---|
| 行程生成 | 751 座城市任选；支持 1–10 天、3 档预算、4 种出行模式（亲子/情侣/独行/带老人）、3 种节奏（休闲/平衡/特种兵） |
| 多站串联 | 一次最多 4 站，自动排跨城顺序与每段天数 |
| 全省精华游 | 34 个省级行政区的省内跨城组合线路 |
| 真实坐标导航 | **90.5% 的景点条目带真实 GCJ-02 坐标**，点「导航」直接调起 `wx.openLocation`；没有精确坐标的自动退到城市锚点，不出现"假点" |
| 手动调整 | 上下移动、**按住手柄拖拽调序**、删除、换同类景点、加自定义景点、标记想玩、打卡打钩 |
| 行程体检 | 超出建议天数、务必预约未订、周一闭馆冲突、转场日无留白、预算偏紧 —— 一次列清，可一键减负 |
| 地图 / 美食 / 账本 | 按天切换的动线地图；404 城的真实名店清单；随手记账 + AA 分账 + CSV 导出 |
| 旅行档案 | 足迹（已去城市 / 打卡景点 / 成就徽章）、多行程存档、城市评分与避坑贴士、旅行排行榜 |
| 离线容错 | 天气取不到会明说"天气暂不可用"并给重试；数据异常有全局兜底，不做沉默失败 |
| 城市深度玩法（1.19.78 新增） | 10 座热门城市的本地节奏 / 避坑清单 / 取景机位 / 顺手加一日，共 121 条人工整理内容 |
| 出发提醒（1.19.78 新增） | 一键写入手机日历（离线可用，到点响铃）；未来接上云开发后可升级为订阅消息推送 |

> 网页版仍然保留在仓库外的 `outputs/旅游攻略生成器.html`（单文件，已 PWA 化，可安装到桌面/手机离线使用）。

---

## 二、快速开始

```bash
git clone <你的仓库地址>
cd miniprogram-travel
```

1. 打开**微信开发者工具** → 导入项目 → 选择本目录
2. AppID：用正式 AppID `wxa365d49bc3366f95`，或改成你自己的测试号
3. 编译运行

**首次修改代码前，请先看这两件事**（都是踩过线上事故的坑，见 `ARCHITECTURE.md` 第七节）：

- 改 `utils/data.js` 无效 —— 它是生成产物，真源在 `tools/_src-backup/data.js`
- 增量改数据只能走 `tools/_apply-safe.mjs`，**禁用 `merge-data-patch.mjs`**

---

## 三、目录结构

```
miniprogram-travel/
├── app.js / app.json / app.wxss      全局入口 / 页面注册 / 双主题变量基座
├── pages/                            主包（5 页，其中 4 个 tabBar）
│   ├── splash/  index/  today/  plan/  more/
├── subpkg/                           功能分包：map food ledger prep assistant guide toolkit rank
├── subdata/ subdata2/ subdata3/      数据分包：deflate+base64 编码的城市数据块 + 占位页
├── subai/                            内容分包：10 城深度玩法（ai-deep.js）+ deep 页
├── utils/                            ⚠️ 多为生成产物
│   ├── data.js          数据 holder（src: tools/_src-backup/data.js）
│   ├── planner.js       行程生成算法（src: tools/_src-backup/planner.js）
│   ├── travel.js        领域层 400+ 接口（src: tools/_src-backup/travel.js）
│   ├── aicontent.js     深玩内容 holder
│   ├── ad.js            激励视频封装（未开通 = 全解锁）
│   ├── remind.js        提醒队列 + 日历 / 订阅双通道
│   └── rank.js / store.js / weather.js / toolkit-groups.js
├── tools/                            数据管道与回归链（不打包，见 project.config.json）
├── images/                           图标与 tabBar 图
└── docs 层：README.md / ARCHITECTURE.md / DATA-REPORT.md / v1.xx-*.md 变更记录
```

代码规模：手写源码约 **2.05 万行**（其中算法/接口层 8,123 行、页面层约 1.25 万行）。

---

## 四、数据管道

数据改动**只能**走这条链，顺序不能颠倒：

```bash
node tools/_apply-safe.mjs        # 1. 以当前 packed 为底，叠加 tools/v19N-*.js 增量补丁
node tools/pack-data.mjs          # 2. 重新打包、分块、写 subdata*/data/data-packed*.js
./allcheck.sh                     # 3. 17 项全量回归
```

| 规则 | 为什么 |
|---|---|
| 补丁文件名必须匹配 `/^v19\d-.*\.js$/` | 管道按此识别增量，避免误把一次性脚本当数据补丁 |
| **`tools/merge-data-patch.mjs` 已禁用** | 它做整体替换，曾把 `CITIES_ADD` 覆盖导致 experiences 塌回 8655 条 |
| 打包器内置"脏键清理" | 自动剔除 `SPOT_COORDS` / `CITY2PROV` 里的非直辖市省名键，否则跨省解析会串城 |
| `require.async()` 实参必须是静态字符串字面量 | 传变量会导致微信解析不到分包 → 数据永不加载 → **首页白屏**（v1.19.6x 线上事故根因） |
| 键别名压缩已停用 | 与 `_apply-safe` 的读写不同源，会互相污染导致键损坏 |

---

## 五、回归链

```bash
./allcheck.sh        # 17 项：语法/JSON/数据健康/重名/7 组单测/泛词扫描/行政区审计/全省生成/压测/WXML 结构/包体
```

专项回归（新增，`v1.19.78` 起常态化）：

```bash
node tools/_test-v11978-deep.mjs     # 24 项：深玩内容加载与 page 逻辑
node tools/_test-v11978-ad.mjs       # 17 项：激励视频 fail-open 与半程退出不给奖励
node tools/_test-v11978-remind.mjs   # 36 项：提醒队列 / 日历兜底 / 云端降级
node tools/_test-wx-async.mjs        # 模拟微信 require.async 分支（Node 默认走不到）
node tools/_test-multichunk.mjs      # 多数据分块合并
```

写回归脚本的约定：**从源码里 `indexOf` 抽出真实 handler 文本，塞进 vm 沙盒跑**，而不是照着逻辑另抄一份 —— 否则源码改了测试照样是绿的，等于没测。

---

## 六、发版

```bash
cli upload --project "$(pwd)" --port 54871 --version 1.19.78 --desc "说明"
```

- **不要传 `--info-output`**（本环境会触发 `二维码输出路径无效 code 17`）
- 上传后**必须核对尺寸表**：`subdata` 应约 1.6–1.8MB。看到 `subdata 10.0 KB` 说明数据没进包，是残包，必须重传
- 审核只能在 mp.weixin.qq.com 后台手动提交

---

## 七、合规

- **无任何第三方 Key 明文入库**：被停用的他人 KEY 在 `_amap-compliance.mjs` 里只存 `sha256` 摘要
- 运行时 App 端零高德依赖：天气走 open-meteo，地图走原生 `<map>`
- 深度玩法内容是**人工整理的离线文本，不是实时 AI 生成**，不适用生成合成内容的标识要求；涉票价班次的信息都标注"以官方当日公告为准"
- 广告、订阅消息均做成**开关式**：未配置即自动隐藏/全解锁，不会出现"点了没反应"的功能

---

## 八、接下来

按性价比排序（详见 `v1.20-云后端与AI行程技术方案.md`）：

1. **扩大深度玩法覆盖**：10 城 → 50 城（纯内容增量，零结构改动）
2. **流量主**：UV ≥ 1000 后开通，把 `utils/ad.js` 的 `AD_UNIT_ID` 填上即可生效
3. **云开发**：免费额度期内把 `tools/cloud/sendRemind` 传上去，订阅消息与多端同步落地
4. **真 AI 行程**：需要先把个人主体升级为个体工商户，并完成类目与算法备案 —— 这是唯一绕不过的门槛

---

## 九、文档索引

| 文件 | 内容 |
|---|---|
| `ARCHITECTURE.md` | 分包设计、数据加载链路、生成算法、交互实现、主题系统、踩过的坑 |
| `DATA-REPORT.md` | 数据规模、来源与清洗、去泛化规则、质量指标与已知缺口 |
| `v1.20-云后端与AI行程技术方案.md` | 云开发 / AI 三条路线、云函数清单、防幻觉设计 |
| `v1.19.77-审核描述.md` | 提审说明模板 |
| `v1.xx-变更清单.md` | 各版本变更记录 |
