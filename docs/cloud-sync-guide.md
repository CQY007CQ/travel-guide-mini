# 后端接入与跨端互通指引（CloudBase）

> 适用：小程序「晨的旅行助手」+ 网页版共用同一云后端，实现行程/偏好跨端同步。
> 代码侧（#764/765/766/767）已全部落地；本文件是可执行的「上线清单」。
> 原则：**本地优先 + fail-closed**——云环境未配置时所有云端能力静默降级，绝不崩。

---

## 一、需要你本人做的事（沙盒做不了：需账号 + GUI）

### 1. 开通云环境
- 打开微信开发者工具 → 顶部「云开发」→ 开通 → 新建环境（个人主体可开，约 ¥19.9/月）。
- 记下**环境 ID**（形如 `travel-xxx-abc123`，它是标识符不是密钥，可安全提交/分发）。

### 2. 注入环境 ID（二选一）
- **A. 运行时注入（推荐，零泄露）**：在开发者工具 Console 或真机/浏览器控制台执行一次：
  ```js
  wx.setStorageSync("__app_keys__", { cloudEnv: "你的环境ID" });
  ```
  - 小程序：执行后生效，storage 持久化。
  - 网页版：`cloud-web.js` 在**页面加载时**就读 env 决定是否加载 SDK。若用注入方式，**需先注入再加载页面**（或注入后刷新一次）。
- **B. 烘焙进源码（网页版更稳，免刷新时序问题）**：
  改 `utils/keys.js` 第 28 行 `cloudEnv: ""` → `"你的环境ID"`，并同步改 `tools/_src-backup/keys.js` 同位置，然后 `cp tools/_src-backup/keys.js utils/keys.js`（保持真源一致）。env ID 非密钥，进公开仓库风险低。

### 3. 部署云函数（5 个，逐个右键「上传并部署：云端安装依赖」）
| 函数 | 职责 | 用的集合 |
|------|------|----------|
| `syncPlan`   | 行程跨端同步核心（配对码/匿名 guid/openid 通用归属键） | `plans`    |
| `recommend`  | 偏好画像跨端同步（本地 AI 的个性化底座） | `prefs`    |
| `pullContent`| 全局内容版本号（非用户键） | `meta`     |
| `llmProxy`   | LLM 代理，**Key 只存云函数环境变量** | 无（不发库） |
| `sendRemind` | 订阅消息提醒（微信原生，openid 键） | `reminds`  |

> 每个函数目录已有 `index.js` + `package.json`（依赖 `wx-server-sdk ~2.6.3`）。
> 部署：在 `tools/cloud/<函数名>/` 上右键 → 上传并部署（云端安装依赖）。

### 4. 建集合（云开发控制台 → 数据库 → 新建集合）
- `plans`、`prefs`、`reminds`：权限设为**「仅创建者可读写」**（owner 键隔离）。
- `meta`：权限「所有用户可读，仅创建者可读写」即可（存内容版本号）。

> ⚠️ `llmProxy` 的 Key 配置：云函数 → 环境变量 里加 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`。**绝不**写进前端代码。

### 5. 上传小程序体验版（需本机 + 微信开发者工具已登录）
```bash
cd <仓库根>
./tools/dev/upload.sh 1.20.6 "云同步跨端互通 + 网页版 CloudBase 适配器"
```
脚本会自动清 IDE 缓存、等端口就绪、并断言 subdata ≥ 1MB（防残包）。网页版无需单独上传，构建产物随仓库托管（`web/` 目录静态托管即可）。

---

## 二、怎么用跨端同步（用户视角）
1. 设备 A（小程序或网页版）打开 AI 助手 → 点「复制同步码」，得到一串 `u_xxx`。
2. 设备 B 打开 AI 助手 → 点「输入同步码」粘贴 `u_xxx`。
3. 两端即锁定同一归属键：A 点「上传云端」，B 点「云端恢复」即可拿到同一份行程。
4. 未配对时：小程序用微信 openid、网页版用本机匿名 guid，各自独立；想跨端就必须用同步码关联。

---

## 三、fail-closed 与排查
- `utils/keys.js` 的 `cloudEnv` 为空 → `cloud.js` 判定 `cloudEnabled()=false`，云端能力整体关闭，行程完全本地可用。
- 网页版：若 `cloudEnv` 为空，`cloud-web.js` 连 1.4MB SDK 都不加载（懒加载）。
- 上云失败统一返回 `{ ok:false, reason }`（如 `cloud-off`/`no-owner`/`exception`），由调用方决定是否提示，**不阻断主流程**。
- 排查：确认环境 ID 正确、5 个云函数已部署、集合权限正确、LLM Key 在环境变量。

---

## 四、本次修复记录（2026-11-11）
- 云函数 `syncPlan` / `recommend` 原只用 `context.OPENID` 作归属键，导致**网页版（无微信 openid）与配对同步码两种场景完全失效**。已改为以 `event.uid` 为归属主键（配对码/匿名 guid/openid 一视同仁），仅 uid 缺失时回落 OPENID。
- 凭据门禁误报治理：`web/lib/cloudbase-sdk.js`（esbuild 打包的第三方 CloudBase SDK，gitignored、非我方密钥）已加入 `check-secrets.mjs` 的 GENERATED 豁免，门禁恢复「仅 2 处既存本地 qweatherKey 标记（按既定决策保留、不提交）」。
