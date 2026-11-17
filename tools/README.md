# tools/ 目录索引

回归链入口是根目录 `allcheck.sh`（**61 步，口径被考核材料锁定，不要加减 step**）。
需要加断言时，**串进已有 step**（`bash -c 'a.mjs && b.mjs'`），不要新增 step。

```
tools/
├─ check/          门禁（只读检查，失败即红）
├─ test/           单测 / 模糊测试 / 冒烟（vm 沙盒模拟页面）
├─ build/          构建与打包（会写产物）
├─ data/           数据管线（顺序敏感，会改随包数据）
├─ audit/          审计与加固守卫
├─ dev/            开发调试 / E2E / 演示辅助（手工跑）
├─ prompt/         提示词工程（管线 + 真机实测台 + Python 实验室）
├─ lib/            共享库（不是脚本，被其它脚本 import）
├─ web/            网页版构建（与小程序同源编译）
├─ cloud/          云函数源码（llmProxy 等）
├─ team/           分支机协作补丁（team-region-*.json）
├─ photos/         图片来源流水线（下载/本地导入/上传云存储）
├─ official-roster/ 官方名录原始数据
├─ _src-backup/    逻辑真源（build-min 的输入，改这里不要改 utils/）
├─ _archive/       已归档的历史脚本
└─ _bak-*/         备份快照
```

---

## 一、走进回归链的（由 `allcheck.sh` 驱动）

**门禁 `check/`**
`check-deps`（相对引用可解析）·`check-secrets`（全仓无明文 Key）·`check-assets`（图片引用）·
`check-wxml`（结构）·`check-handlers`（页面结构 + 事件配对）·`check-pkgsize`（分包 ≤2MB）·
`check-preload`（预下载 ≤2MB）·`check-demo-quality`（Console 告警防回潮）·`check-health`（全盘体检单一出口）·
`check-observability`（静默失败）·`check-structure`（目录结构契约）·`check-tap-target`（触达尺寸棘轮）·`check-doc-consistency` + `check-doc-numbers`（材料口径）·
`check-ai-scenarios`/`check-ai-fallback`/`check-ai-reach`/`check-lens`（AI 与识物防回潮）·
`check-qa-rails`（**数值/有效性**：对比度、金额口径一致性、测试有效性、主题变量对称性）·
`check-v111`/`check-v112`/`check-new`/`check-more`/`check-boundary`（版本功能单测，历史包袱）

**单测 `test/`**：30+ 个 `_test-*.mjs`，覆盖行程生成、坐标完整性、去重、路线优化、评分、偏好、字号无障碍、
分享图、识物、跨页 AI、云函数滥用防护（`_test-llm-guard.cjs`）等。`_wx-shim.mjs` 是共享垫片（不是测试）。

> 涉存储语义的测试**必须**装 wx 垫片，否则会在空存储上假通过（`check-qa-rails` C 组会判红）。

> **删测试前先查谁在引用它**：`_test-v11977-drag.mjs`（行程页拖拽排序，30 断言）曾因 T4 拆分后
> 仍读单文件 `plan.js` 截取方法体而失效，在「资源管理器轻量化」提交里被当坏文件删除；
> 而 `_test-plan-handlers.mjs` 的注释还写着「拖拽已另有它覆盖」——**拖拽交互零覆盖却无人发现**。
> 现已改为 `pageSrc()` + 逐方法抽取恢复并重新入链。同类「按单文件正则抽取」的测试一律走 `pageSrc()`。

**构建 `build/`**：`build-min.mjs`（真源压缩）、`pack-data.mjs`（数据打包）、`_check-pack-idempotent.mjs`（产物幂等自证）、
`_apply-safe.mjs`（安全写回）。

**共享库 `lib/`**：`page-src.mjs`（把页面 + `p-*`/`m-*` 模块拼成一份源码给门禁用）、`doc-text.mjs`、`deep-auto-out.mjs`。

---

## 二、**故意不进链**的（按需人工跑，各有理由）

| 脚本 | 为什么不进链 |
| --- | --- |
| `check/check-compliance-redline.mjs` | 个人主体合规红线，规则随平台政策变，人会先看一眼再判 |
| `check/check-offline-content.mjs` | 能力宣称属实检查；接进链会动 61 步口径，改成按需跑 |
| `check/release-readiness.mjs` | 发版前最后一公里自检，一天跑一次，不是每次提交都跑 |
| `check/verify-cloud.mjs` | 云部署自检（零网络零凭据），部署前后人工跑 |
| `dev/e2e-smoke.cjs`、`dev/e2e-scenario-nav.cjs` | 需要微信开发者工具（automator），会拉 GUI，不能进无头回归 |
| `dev/capture-shots.cjs`、`dev/mock-review.mjs`、`dev/page-split.mjs`、`dev/_page-members-snapshot.mjs` | 演示截图 / 模拟评分 / 一次性拆分工具 |

E2E 跑法（需 IDE 登录态，**会启动开发者工具窗口**）：

```bash
NODE_PATH=~/wxauto/node_modules node tools/dev/e2e-smoke.cjs
NODE_PATH=~/wxauto/node_modules node tools/dev/e2e-scenario-nav.cjs
```

---

## 三、数据管线（顺序不能换）

```bash
node tools/data/_merge-team-enrich.mjs [--pack]   # ① 合并分支机补丁（预算感知试算）
node tools/build/_apply-safe.mjs                  # ② 安全写回（严禁写纯 JSON 销毁加载器）
node tools/build/pack-data.mjs                     # ③ 紧接打包，否则白屏
```

- `PACK_BASE_ONLY=1`：打包只取基数据，不烘焙主包 enrich 增量（否则撑破 1950KB 且两处各存一份）。
- `PACK_SKIP_TEAM_FOOD=1`：团队美食只住 `subdata3`，不重复进基数据。
- `_merge-team-enrich` 只对主包目标扣预算，`subdata*/` 目标不扣。
- 其它：`scrape-province`、`geocode-runner`、`geocode-official`、`_amap-compliance`、`import-official-list`、
  `_collect-official-roster`、`lib-near-dup`（LIVE 依赖，勿归档）。

---

## 四、一次性 / 低频生成器

| 脚本 | 用途 | 备注 |
| --- | --- | --- |
| `build/add-key.mjs` | 校验收录高德 Web 服务 Key | 需本人执行，Key 不进仓 |
| `build/make-dark-tabicons.mjs` | 生成深色 tabBar 图标 | 产物已入库，除非调色否则不用跑 |
| `build/build-spot-tags.mjs` | 构建期校验景点标签分布 | 不写随包数据，只供人工抽检 |
| `dev/cities-census.mjs` | 行政区覆盖审计 | 生成 `tools/cities-census-report.txt` |
| `photos/*.mjs` | 图片下载 / 本地导入 / 上传云存储 | 素材更新时用 |

---

## 五、提示词工程

```bash
node tools/prompt/engine.mjs                    # 管线：20 变体 → 评分 → 终极提示词（确定性可复现）
node tools/prompt/run10.mjs --offline           # 管线确定性 + 三处落地契约（不联网）
node tools/prompt/run10.mjs --reanalyze=<dir>   # 只重算历史输出，不重新调模型（零成本）
NODE_PATH=~/wxauto/node_modules node tools/prompt/run10.mjs --n=10   # 真机跑 10 遍（会拉 IDE）
```

`tools/prompt/lab/` 是 Python 侧的离线评测实验室（故障注入 / 执行层评测 / runs 留档），
脚本全部用 `__file__` 相对路径，可整目录搬动。

---

## 六、动手前的硬规则

1. **改 `utils/*.js` 一律改 `tools/_src-backup/` 同名文件，再跑 `node tools/build/build-min.mjs`**。
   合并门禁会重跑 build-min 并逐字节比对，手改 `utils/` 必红。`keys.js`/`data.js` 是手写双源，改完要 `cp`。
2. **不要写「先删整个目录再重建」**：宿主有 `node-safe-delete-shim`，一次删 50+ 文件会硬失败，
   且计数按 turn 累积 —— 单跑能过、长回归跑到最后一步炸，堆栈还容易被 `tail` 裁掉。改增量同步。
3. **单文件 800 行是硬线**（`check-health` 第 ⑦ 层棘轮，超标须登记）。页面拆分后门禁要改走 `pageSrc()`，
   否则「读单文件做正则断言」会静默失去覆盖（假绿）。
4. **主包 raw 红线 1536KB**（当前 1418KB）。新增静态数据落 `subdata3`，新增能力放分包。
5. **`require.async` 实参必须是唯一静态字符串字面量**（微信硬约束），`verify-release` 会校验块数。

---

## 七、留根不迁移的资产

`_src-backup/`（逻辑真源）·`_archive/`（历史脚本）·`_bak/`（备份快照，按时间分目录，全目录 gitignore）·
`geocode.key` / `geocode.keys`（外借实名账号，未进 git）·`_hospital-batch4/5/6.json`（1572 条模板名，**禁用负数样本**）·
`_iter_state.json`（自迭代状态）。

**生成物不落根层**：普查 / 体检一类的 `.txt` `.json` 报告统一写 `tools/data/reports/`
（`dev/cities-census.mjs` 已改路径）。`tools/` 根层只允许上面这些共用资产 + 6 个工具子目录，
由 `check/check-structure.mjs` 断言（2026-11-17 整理时加）。

## 八、结构契约（`check-structure` 守着的 7 条）

整理做过两轮，但人工清理总会反弹 —— 现在把「整理后的样子」写成断言，只能保持不能退化：

1. 根目录白名单：只放运行入口与配置（历史上堆过 35 个文档 + `prompt-lab/`）。
2. 包内目录（pages/subpkg/subdata1..3/subai/utils/images）只允许源码与资源 —— `.md/.log/.bak`
   会被打进包（包体预算 1536KB，用户可下载）。
3. 全仓无 `.DS_Store` / `._*` / `*.bak` —— 这些被 gitignore，CI 永远看不见，只能门禁兜。
4. 包内无空目录 —— 空目录是「删了但引用还在」的信号（`components/` 曾空置两个月）。
5. `utils/*.js` 无孤儿 —— 死模块会诱导后来者改错文件（24 个模块当前全部被引用）。
6. `docs/` 根层只放索引，文档必须落到 7 个子目录。
7. `tools/` 根层只放共用资产，报告/脚本进子目录。
