/**
 * tools/add-key.mjs —— 校验收录高德 Web服务 KEY
 *
 * 用法：node tools/add-key.mjs <32位key> ["备注"]
 *
 * 处理链（顺序不可换）：
 *   1. 格式校验：必须是 28~40 位字母数字（与 geocode.keys 解析规则一致）
 *   2. 查重：已收录则不写入
 *   3. 实调 geocode/geo 验活：只有 infocode=10000 才写入
 *      · 10009 USERKEY_PLAT_NOMATCH → 平台选错（应为「Web服务」），拦下
 *      · 10044 账号日配额用尽 → 次日恢复，先不写
 *      · 10026 账号被封禁 → 拦下
 *   4. 写入 tools/geocode.keys 并 chmod 600（该文件已被 .gitignore 覆盖）
 *
 * ⚠️ 风险提示（写进代码是为了让后来接手的人看得见）：
 *   若这些 KEY 来自**不同实名账号**并汇总轮换，触及高德协议 4.5（禁止转让/出借/披露 KEY）
 *   与 3.7（绕过配额），风控会按出口 IP 与调用特征关联账号，处置落在各账号实名主体身上。
 *   本脚本只做接入与验活，不包含任何规避风控的手段。
 */
import fs from "fs";
// v1.20.4：用原生 fetch 替代 execSync('curl ...')，避免 shell 拼接注入
async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } finally { clearTimeout(timer); }
}

const KEY = (process.argv[2] || "").trim();
const NOTE = (process.argv[3] || "").trim();
const FILE = "tools/geocode.keys";
const PROBE_URL = "https://restapi.amap.com/v3/geocode/geo";

if (!/^[a-zA-Z0-9]{28,40}$/.test(KEY)) {
  console.error("✗ 格式不合法：应为 28~40 位字母数字，实际长度 " + KEY.length);
  process.exit(2);
}
const mask = (k) => k.slice(0, 4) + "****" + k.slice(-4);

let s = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "";
if (s.indexOf(KEY) >= 0) {
  console.log("该 key 已收录：" + mask(KEY) + "（未重复写入）");
  printPool(s);
  process.exit(0);
}

let j = {};
try {
  j = await getJSON(PROBE_URL + "?key=" + KEY + "&address=" + encodeURIComponent("大同"));
} catch (e) {
  console.error("✗ 网络请求失败，未写入");
  process.exit(3);
}

const code = String(j.infocode || "?");
const addr = j.geocodes && j.geocodes[0] ? j.geocodes[0].formatted_address : "";
console.log("验活：" + mask(KEY) + "  infocode=" + code + (addr ? "  → " + addr : ""));

if (code !== "10000") {
  const why = {
    "10009": "平台绑定不符 —— 创建时服务平台须选「Web服务」，不能选微信小程序/JS API",
    "10044": "账号维度日配额用尽 —— 次日 0:00 自动恢复，先不写入",
    "10003": "日访问量超限 —— 同上",
    "10026": "账号处于被封禁状态 —— 需账号主体本人提工单",
    "10001": "KEY 不正确或已过期",
    "10010": "单 IP 超限 —— 不能自动恢复，需提工单",
  }[code] || "未知错误";
  console.error("✗ 未写入：" + code + " " + why);
  process.exit(4);
}

if (!s.endsWith("\n")) s += "\n";
s += "# " + new Date().toISOString().slice(0, 10) + " 新增" + (NOTE ? "（" + NOTE + "）" : "") + "\n" + KEY + "\n";
fs.writeFileSync(FILE, s);
try { fs.chmodSync(FILE, 0o600); } catch (e) {}
console.log("→ 已写入 " + FILE);
printPool(s);

function printPool(text) {
  const keys = text.split(/\r?\n/).map((x) => x.trim()).filter((x) => /^[a-zA-Z0-9]{28,40}$/.test(x));
  console.log("当前可用 key：" + keys.length + " 把");
  keys.forEach((k, i) => console.log("  " + (i + 1) + ". " + mask(k)));
  if (keys.length !== new Set(keys).size) console.log("⚠️ 存在重复 key");
}
