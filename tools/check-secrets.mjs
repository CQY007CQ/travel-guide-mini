/**
 * tools/check-secrets.mjs —— 全仓凭据泄露门禁
 *
 * 起因（两轮，第二轮是真事故）：
 *   ① 2026-10-29 手工扫过「随包目录有没有明文 key」，结果干净，但检查只存在于那次手工脚本里，
 *      下次改代码没人会记得再扫 → 固化进 allcheck。
 *   ② 2026-11-09 深度审计发现：旧版门禁只扫 SHIPPED（会打进包的目录），文件头注释还明确写着
 *      「tools/ 与 docs/ 不扫：它们不进包」。结果公开仓库 HEAD 里的
 *      docs/audit/code-audit-2026-11-08.md 有 2 处和风天气 Key 明文，整整一轮发版都没被拦。
 *      根因是把「泄露面」误当成「包体面」：不进包 ≠ 不进公开 GitHub 仓库。
 *
 * 检查范围（分层，避免为了堵漏把文档里的正常外链全判死）：
 *   L1 全仓文本文件：32 位十六进制凭据、key/token/secret 长串赋值
 *   L2 随包目录额外：高德接口域名、明文 http、未登记外链
 *
 * 误报治理（每一条都是实测踩过的）：
 *   - 64 位 sha256 摘要（tools/_amap-compliance.mjs 的封禁 KEY 黑名单）：
 *     32 位正则必须带前后 hex 边界，否则摘要的后半段会被当成一把 key。
 *   - 政府网站 URL 里的 32 位文件名哈希（tools/province-lists.json）：URL 路径段豁免，
 *     但 `?key=<32hex>` 这类查询参数不豁免。
 *   - 本地凭据池 tools/geocode.keys（gitignore 忽略、未跟踪、不进包）：
 *     允许存在，但必须被 .gitignore 覆盖且未进入 git index；门禁不打印其中任何明文。
 *   - 已脱敏占位符 <REDACTED-...> 本身不含 hex，天然不命中。
 *
 * 输出只报「文件:行号 → 规则名」，不打印匹配到的值 —— 门禁自身不能成为泄露通道。
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

// 会打进小程序包的目录：只有这些需要额外执行「运行时零外部依赖」类规则
const SHIPPED = ["app.js", "app.json", "utils", "pages", "subpkg", "subai", "subdata", "subdata2", "subdata3"];
const SKIP = new Set([".git", "node_modules", ".workbuddy", "coverage", "web/images"]);
const TEXT_EXT = /\.(js|mjs|cjs|json|wxml|wxss|md|html|htm|sh|py|ts|txt|yml|yaml|ini|conf|key|keys|env)$/i;
const MAX_SIZE = 2.5 * 1024 * 1024;   // 数据块跳过（内含 base64，一定误报）

// 本机凭据池：不进包、不进 git。允许存在，但纳入「是否被误提交」的断言。
const LOCAL_POOLS = ["tools/geocode.keys", "tools/geocode.key"];
// 外部官方页面抓取缓存（tools/_collect-official-roster.mjs --fetch 的只读原文）：
// 政府站点 HTML 自带 32 位资源哈希/会话串，不是本仓凭据；但它是外部内容，不能无条件信任，
// 故豁免同时强制「被 .gitignore 覆盖 + 未进入 git index」，且只豁免这一个目录。
const EXTERNAL_CACHE = "tools/official-roster/cache";

// 网页版构建产物（tools/web/build.mjs 由小程序同源源码打包生成，非手写源码、不进 git）：
// 本地用真实 Key 构建时合法地含 Key，属构建产物而非仓库源码，跳过内容扫描避免误报。
// 关键：web/lib/runtime.js 是「手写源码（已提交）」，不在豁免之列，仍会被扫描；
// 真正的泄露面（utils/keys.js / docs/ 等源文件与文档）也照常扫描 —— 本豁免只去掉重复的构建产物噪声。
const GENERATED = new Set([
  "web/lib/modules.js", "web/lib/data.js", "web/lib/tpl.js", "web/lib/app.css", "web/lib/nav.js"
]);

const ALLOW_URL = [
  "https://devapi.qweather.com",  // 和风天气（已备案，request 合法域名可过审）
  "qweatherapi.com",              // 和风自定义域名（部分账号分配 xxx.qweatherapi.com）
  // 2026-11-09：用户要求景点详情弹窗同时复制「景点网址」，故放行百科搜索域名。
  // 仅在 pages/plan/plan.js 的 onBaike 里允许出现（_test-audit-guards 断言全仓仅 1 处）；
  // 其它文件再出现该域名仍会被 _test-audit-guards 拦下。
  "baike.baidu.com",
];

// 前后都要求「非 hex 字符」：64 位 sha256 摘要因此不会被切成两把 32 位 key
const HEX32 = /(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])/g;
// 捕获「值」，用于排除 miniXxxV1 这类本地存储键名（不是凭据）
const ASSIGN = /(?:apikey|api_key|secret|token|password|passwd)\s*[:=]\s*["']([A-Za-z0-9_\-]{16,})["']/gi;
const AMAP_API = /restapi\.amap\.com/;

const isShipped = (rel) => SHIPPED.some((s) => rel === s || rel.startsWith(s + "/"));

function collect(dir, rel, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) {
      if (SKIP.has(e.name) || SKIP.has(r) || r === EXTERNAL_CACHE) continue;
      collect(path.join(dir, e.name), r, out);
    } else if (e.isFile()) {
      if (!TEXT_EXT.test(e.name)) continue;
      out.push(r);
    }
  }
}

/** 该 32hex 是否只是 URL 路径里的文件名哈希（政府公开附件名），而非凭据 */
function isUrlPathHash(line, idx) {
  const httpAt = line.search(/https?:\/\//i);
  if (httpAt < 0 || idx <= httpAt) return false;
  // 查询参数里的 key/token 一律不豁免
  const before = line.slice(Math.max(0, idx - 24), idx);
  if (/(?:key|token|secret|apikey|password)\s*[=:]\s*["']?$/i.test(before)) return false;
  return true;
}

/** 文件是否已被 git 跟踪：直接读 .git/index（不调 git 二进制，避开 Xcode shim 许可问题） */
function trackedInIndex(rel) {
  try {
    const buf = fs.readFileSync(path.join(ROOT, ".git", "index"));
    return buf.indexOf(Buffer.from(rel, "utf8")) >= 0;
  } catch (e) { return false; }
}

const all = [];
collect(ROOT, "", all);
all.sort();

const problems = [];
let shippedCount = 0;
let urlHashSkipped = 0;
const poolNotes = [];

// 外部抓取缓存豁免的双向护栏：必须被忽略、必须未被跟踪，否则立刻判失败。
{
  const gi = fs.existsSync(path.join(ROOT, ".gitignore"))
    ? fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8") : "";
  if (!gi.includes(EXTERNAL_CACHE + "/")) problems.push(EXTERNAL_CACHE + " → 抓取缓存未被 .gitignore 覆盖");
  const dir = path.join(ROOT, EXTERNAL_CACHE);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (trackedInIndex(EXTERNAL_CACHE + "/" + f)) problems.push(EXTERNAL_CACHE + "/" + f + " → 外部抓取原文已被 git 跟踪");
    }
  }
}

for (const rel of all) {
  if (GENERATED.has(rel)) continue;   // 跳过网页版构建产物（见上方说明）
  const abs = path.join(ROOT, rel);
  let src = "";
  try {
    if (fs.statSync(abs).size > MAX_SIZE) continue;
    src = fs.readFileSync(abs, "utf8");
  } catch (e) { continue; }
  const shipped = isShipped(rel);
  if (shipped) shippedCount++;

  // 本地凭据池：跳过内容扫描（不打印明文），但验证它确实没被误提交
  if (LOCAL_POOLS.includes(rel)) {
    const gi = fs.existsSync(path.join(ROOT, ".gitignore"))
      ? fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8") : "";
    const covered = /geocode\.keys/.test(gi) && /geocode\.key(?!s)/.test(gi);
    if (!covered) problems.push(rel + " → 本地凭据池未被 .gitignore 覆盖");
    if (trackedInIndex(rel)) problems.push(rel + " → 本地凭据池已被 git 跟踪（明文将进入公开仓库）");
    const n = (src.match(HEX32) || []).length;
    poolNotes.push("  " + rel + "：已忽略、未跟踪，跳过 " + n + " 行明文");
    continue;
  }

  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    const ln = i + 1;

    HEX32.lastIndex = 0;
    let m;
    while ((m = HEX32.exec(line)) !== null) {
      if (isUrlPathHash(line, m.index)) { urlHashSkipped++; continue; }
      // 不再给 utils/keys.js / weather.js 开例外：v1.20.4 起密钥只经 setKeys() 运行时注入，
      // 随包源码里出现 32hex 一律视为回归。
      problems.push(rel + ":" + ln + " → 32 位十六进制（疑似 key，值已隐藏）");
    }

    ASSIGN.lastIndex = 0;
    let a;
    while ((a = ASSIGN.exec(line)) !== null) {
      const v = a[1];
      if (/^mini/i.test(v) || /V\d+$/.test(v)) continue;   // 本地存储键名
      problems.push(rel + ":" + ln + " → key/token/secret 长串赋值（值已隐藏）");
    }

    if (!shipped) return;   // ↓ 以下规则只约束随包代码

    if (AMAP_API.test(line)) problems.push(rel + ":" + ln + " → 高德接口（运行时应为零依赖）");

    const http = line.match(/["'`]http:\/\/[^"'`\s]+/g) || [];
    http.forEach((u) => {
      if (!/w3\.org|xmlns|example\.com/.test(u)) problems.push(rel + ":" + ln + " → 明文 http");
    });

    const urls = line.match(/https?:\/\/[a-z0-9.\-]+/gi) || [];
    urls.forEach((u) => {
      const low = u.toLowerCase();
      if (ALLOW_URL.some((x) => low.indexOf(x) >= 0)) return;
      if (/w3\.org|xmlns|openstreetmap\.org|amap\.com/.test(low)) return;
      problems.push(rel + ":" + ln + " → 未在允许清单的外链");
    });
  });
}

const uniq = [...new Set(problems)];
console.log("  扫描 " + all.length + " 个全仓文本文件（其中随包 " + shippedCount + " 个）");
if (poolNotes.length) { poolNotes.forEach((x) => console.log(x)); }
if (urlHashSkipped) console.log("  URL 路径文件名哈希豁免 " + urlHashSkipped + " 处（非凭据）");
if (uniq.length) {
  console.log("  ✗ 发现 " + uniq.length + " 处可疑（值已隐藏）：");
  uniq.slice(0, 20).forEach((x) => console.log("    " + x));
  if (uniq.length > 20) console.log("    …另有 " + (uniq.length - 20) + " 处");
  process.exit(1);
}
console.log("  ✓ 全仓无明文凭据；随包无高德接口依赖；外链均在允许清单内");
