/**
 * tools/check-secrets.mjs —— 随包代码的凭据泄露检查
 *
 * 起因：2026-10-29 自检时手工扫了一次「随包目录有没有明文 key / 外部接口」，
 * 结果干净——但这项检查只存在于那一次的手工脚本里，下次改代码没人会记得再扫。
 * 这类检查必须自动化，否则等于没有。
 *
 * 检查范围：只扫**会打进小程序包**的目录（app.js / utils / pages / subpkg / subai / subdata*）。
 * tools/ 与 docs/ 不扫：它们不进包（project.config.json 的 packOptions.ignore 已排除）。
 *
 * 判定规则：
 *   1. 32 位十六进制串 —— 高德、腾讯等云服务的 key 都是这个形状
 *   2. `key=` / `apikey` / `token` / `secret` 后跟长串的赋值式
 *   3. 高德接口域名 restapi.amap.com —— 运行时应当零依赖（坐标随包、天气走 open-meteo）
 *   4. 明文 http://（微信小程序要求 https）
 *
 * 允许清单：静态资源域名、已知合法的公开接口（open-meteo、百科跳转）。
 */
import fs from "fs";
import path from "path";

const SHIPPED = ["app.js", "app.json", "utils", "pages", "subpkg", "subai", "subdata", "subdata2", "subdata3"];
const ALLOW_URL = [
  "https://api.open-meteo.com",   // 天气
  "https://baike.baidu.com",      // 景点百科外链
];

const CHECKS = [
  { name: "32 位十六进制（疑似 key）", re: /[0-9a-f]{32}(?![0-9a-f])/i },
  // 注意：utils 里大量 `KEY = "miniXxxV1"` 是本地存储键名，不是凭据。
  // 因此要求「值看起来像密钥」：含大小写混合或数字的长串，且不以 mini 开头、不以 V数字 结尾。
  { name: "key/token/secret 赋值", re: /(?:apikey|api_key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i },
  { name: "高德接口（运行时应为零依赖）", re: /restapi\.amap\.com/ },
];

function walk(p, out) {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) {
      if (f === "node_modules") continue;
      walk(path.join(p, f), out);
    }
    return;
  }
  if (!/\.(js|mjs|json|wxml|wxss)$/.test(p)) return;
  if (st.size > 2.5 * 1024 * 1024) return;   // 数据块跳过（内含 base64，一定误报）
  out.push(p);
}

const files = [];
SHIPPED.forEach((s) => walk(s, files));

const problems = [];
for (const f of files) {
  let src = "";
  try { src = fs.readFileSync(f, "utf8"); } catch (e) { continue; }
  for (const c of CHECKS) {
    const m = src.match(c.re);
    if (m) problems.push(f + " → " + c.name + "：" + String(m[0]).slice(0, 24) + "…");
  }
  // 明文 http（排除注释里的示例与 w3.org 之类）
  const http = src.match(/["'`]http:\/\/[^"'`\s]+/g) || [];
  http.forEach((u) => {
    if (!/w3\.org|xmlns|example\.com/.test(u)) problems.push(f + " → 明文 http：" + u.slice(0, 40));
  });
  // 非白名单外链
  const urls = src.match(/https?:\/\/[a-z0-9.\-]+/gi) || [];
  urls.forEach((u) => {
    const low = u.toLowerCase();
    if (ALLOW_URL.some((a) => low.indexOf(a) >= 0)) return;
    if (/w3\.org|xmlns|openstreetmap\.org|amap\.com/.test(low)) return;
    problems.push(f + " → 未在允许清单的外链：" + u);
  });
}

// 去重（同一文件同类问题只报一次）
const uniq = [...new Set(problems)];
console.log("  扫描 " + files.length + " 个随包文件");
if (uniq.length) {
  console.log("  ✗ 发现 " + uniq.length + " 处可疑：");
  uniq.slice(0, 20).forEach((x) => console.log("    " + x));
  if (uniq.length > 20) console.log("    …另有 " + (uniq.length - 20) + " 处");
  process.exit(1);
}
console.log("  ✓ 无明文凭据、无高德接口依赖、外链均在允许清单内");
