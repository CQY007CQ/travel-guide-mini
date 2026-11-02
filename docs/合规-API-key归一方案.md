# 合规 · API Key 归一方案（v1.19.184）

> 目标：把小程序所有第三方 Key 收敛到**单一 fail-closed 出口**，并明确「主体一致」合规红线，
> 让办下个体户执照 / 微信认证后，把合规 Key 一填即生效、不回潮、不散落。

---

## 1. 背景与风险

- **历史事故**：早期采集 / 数据侧曾**借用他人高德 Key**，导致 Key 被封禁，且上线版本存在
  **主体不一致**的合规风险（Key 登记在他人账号下，与小程序主体不符）。
- **配额常识（高德）**：个人认证开发者搜索类仅 100 次/日；更关键的是**配额按账号维度共享**——
  同一账号下多把 Key 共享同一份配额池，**轮换 Key 不增容量、反增封禁风险**。`10026` 为账号级封禁码须提工单申诉。
- **现状盘点（v1.19.184）**：
  | Key | 用途 | 状态 | 归属待确认 |
  |---|---|---|---|
  | 和风 `QW_KEY` | 行程天气（7d 预报） | 在用，v1.19.157 接入免费 Key | 须确认在**本人和风账号**下 |
  | 和风 `QW_API_HOST` | 和风专属域名 | 在用 `j864228fx2.re.qweatherapi.com` | 同上 |
  | 高德 Key | 地图 / 地理编码 | **当前未用**（小程序地图用微信内置腾讯地图 `<map>` 组件，无需 Key） | 未来若用须本人申请 |

---

## 2. 技术归一方案（已落地）

新增 **`utils/keys.js`**（真源 `tools/_src-backup/keys.js`，与 `data.js` 同模式 cp 到 `utils/`）：

- **唯一出口**：`weather.js` 不再硬编码 Key，改为 `require("./keys.js")`，经
  `KEYS.qweatherKey()` / `KEYS.qweatherHost()` / `KEYS.amapKey()` 读取。
- **Fail-closed**：Key 缺失 / 占位符（`在此填写`/`xxxx`/`placeholder` 等）/ 格式非法 → 返回 `null`，
  天气功能静默降级（天气卡隐藏 / 提示），**绝不抛错阻断行程主流程**。
- **双通道接入合规 Key**：
  1. 编译期：改 `keys.js` 的 `DEFAULT`（推荐，一行搞定、最稳）；
  2. 运行时：`wx.setStorageSync("__app_keys__", { qweatherKey, qweatherHost, amapKey })` 注入，
     便于不重新发版临时换 Key（Key 仍须本人账号、勿外泄明文）。
- **`utils/keys.js` 不在 `build-min.mjs` 压缩目标内**，作为普通模块随包，Node 侧（allcheck）与小程序侧
  均经 `./keys.js` 解析，两侧一致。

> 红线：禁止在 `weather.js` / 任意页面再散落硬编码 Key；新增第三方服务 Key 一律走 `keys.js`。

---

## 3. 用户待办（外部动作，AI 无法代办）

1. **办个体户执照 + 微信认证**：个人主体无微信认证，无法合规登记 Key；
   路线：升个体户（办执照）→ 重注册 / 变更小程序主体 → 微信认证。
2. **确认和风 Key 归属**：登录和风控制台，确认当前 `QW_KEY` 在**本人账号**下；
   若为他人 / 共享 Key，立即在本人账号重建项目拿 Key，填入 `keys.js` 的 `DEFAULT.qweatherKey`。
3. **未来高德需求**：若要做地图标注 / 地理编码等需高德的服务，必须在**本人高德账号**申请 Key 填入
   `DEFAULT.amapKey`，严禁借用 / 轮换他人 Key。

---

## 4. 工程护栏（防回潮）

- `tools/check-secrets`：禁 32 位 hex / key / http；运行时只许和风 `qweather` + `baike` 域名。
- `allcheck.sh`：回归门禁，key 归一改动后须 49 步全绿、无脏值、无散落硬编码。
- 代码评审 Checklist：搜 `QW_KEY` / 直接 `https://` 调用第三方 → 一律改为 `keys.js` 出口。
