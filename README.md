# 旅行攻略生成器 · 微信小程序版

将单文件 HTML 旅游攻略生成器（约 710KB）迁移为微信小程序。**数据与算法自动从 HTML 提取，保证与网页版行为一致**；UI 按小程序技术栈重写，逐期迁移页面。

## 怎么跑起来

1. 打开**微信开发者工具** → 导入项目 → 选择本目录（`miniprogram-travel/`）
2. AppID 填 **测试号**（或在 `project.config.json` 里改 `appid` 为正式小程序 AppID）
3. 编译即可：首页选目的地 → 生成攻略 → 查看每日行程（点条目展开景点介绍）

> 工具为 `touristappid`（游客模式）也可直接预览，无需注册。

## 目录结构

```
miniprogram-travel/
├── project.config.json     小程序配置（AppID: touristappid 测试号）
├── app.js / app.json / app.wxss   全局入口 / 页面注册 / 全局样式
├── sitemap.json
├── utils/
│   ├── data.js             ★ 数据层：46 城 / 景点池 / 美食 232 家 / 坐标 / 详情词条（自动导出，勿手改）
│   ├── planner.js          ★ 算法层：buildPlanDays 及 37 个依赖函数（自动提取，勿手改）
│   ├── travel.js           页面高层接口：查询/生成/导航/今天状态/记账/待办/想玩
│   └── store.js            wx 存储封装 + 日期工具
├── pages/
│   ├── index/              出发：目的地选择 → 生成（tab）
│   ├── today/              今天：行前待办 / 途中速览+快捷记账 / 结束回顾（tab）
│   ├── plan/               行程：条目+详情+导航/百科/想玩/手动调整（tab）
│   ├── more/               更多：地图/美食/记账/日历/准备聚合入口（tab）
│   ├── map/  food/  ledger/  calendar/  prep/   功能页（从「更多」进入）
└── tools/
    ├── export-data.mjs     从 HTML vm 运行时导出数据 → utils/data.js
    ├── extract-planner.mjs 从 HTML 按引用链自动提取算法函数 → utils/planner.js
    └── selfcheck.mjs       共享逻辑单测（node + wx stub，25 项）
```

## 数据与算法怎么同步（网页版仍是唯一事实源时的做法）

HTML 每次改完数据或核心算法后，重跑：

```bash
node tools/export-data.mjs ./utils/data.js
node tools/extract-planner.mjs ./utils/planner.js
```

- `data.js`：56 个数据常量（CITIES / FOOD_SPOTS / SPOT_COORDS / SPOT_DETAILS / CLOTH…），运行时序列化导出，约 198KB
- `planner.js`：`buildPlanDays / countPlanStats / relaxIndex / getSpotCoord` 等 37 个纯函数，按**函数引用链自动闭包收集**，
  内部引用的数据常量自动 `require("./data.js")`

两文件由工具生成、勿手改。已验证：北京/上海/广州/成都/西安等 12 城生成结果与网页版完全一致。

## 迁移进度（勾选已完成）

- [x] 工程骨架（app 三件套 / 全局样式 / 测试号配置）
- [x] 数据导出管线（tools/export-data.mjs → utils/data.js）
- [x] 算法提取管线（tools/extract-planner.mjs → utils/planner.js）
- [x] index：目的地选择 → 生成
- [x] plan：每日行程浏览 + 景点详情（纯文本版）
- [x] 「今天」行程态卡片：行前待办（分组勾选）/ 途中当前时段+快捷记账 / 结束回顾
- [x] 一键导航（真实坐标 `wx.openLocation`；示意坐标提示搜索）＋ 百科（复制链接浏览器打开）
- [x] 手动调整：删除→自由活动 / 上下移动（交换时段）/ 想玩☆（重新生成优先）
- [ ] 美食 Tab（美食店铺卡 + 地图定位）
- [x] 地图页：原生 `<map>` + 真实坐标 marker（示意坐标不画点避免误导）+ 按天切换
- [ ] 记账 · AA（表单 + 列表 + 预算对比）
- [x] 智能日历页：时间轴 + 今天高亮 + 定位此刻
- [x] 出行准备页：票价与预约渠道表 / 酒店比价 / 团队分工（待办在「今天」页）
- [x] 想玩清单（更多页查看）；出行模式（mode 参数已支持，入口后续加）
- [x] tabBar 导航（出发/今天/行程/更多）；计划数据自动落盘，重进即恢复（App 数据即分享载体）
- [ ] 注册正式 AppID → 真机调试 → 域名白名单（天气/后续 AI）→ 审核发布

## 网页版 → 小程序的主要差异（实现时注意）

| 网页版 | 小程序 | 说明 |
|---|---|---|
| `localStorage` | `wx.setStorageSync` | 数据格式不变，`utils/store.js` 已封装 |
| `alert / confirm` | `wx.showToast / showModal` | 全局替换 |
| `window.open`（导航/百科） | `wx.openLocation` / `wx.setClipboardData`+提示 | 高德 URI 个人小程序受限 |
| `fetch`（天气） | `wx.request` | 需在公众平台配 request 合法域名 |
| Leaflet CDN 地图 | 原生 `<map>` | marker/polyline 直接支持，无外链限制 |
| `innerHTML` 模板 | WXML 数据绑定 | **工作量最大**；富文本详情可用 `<rich-text>`（支持有限 HTML 标签） |
| CSS 变量 / 暗色主题 | 固定色值 | app.wxss 已用固定色值移植主色 |

## 已知取舍

- 出行日期晚于 2026-09-03 的历史测试用例不适用小程序侧；小程序内日期校验逻辑与网页版一致（不可早于今天）
- 个人主体小程序**不能用 web-view**（需企业类目 + 备案域名），因此"把网页版整个塞进 web-view"方案已排除，采用原生重构
- 天气 / AI 大模型接口涉及域名白名单，后续接入时按工具提示操作
