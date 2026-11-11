// tools/photos/fetch-commons.mjs —— 从 Wikimedia Commons 采集真实景点照片（合规 CC 图源）
//
// 用法（需宿主网络，沙盒连不上境外站时用 dangerouslyDisableSandbox:true）：
//   node tools/photos/fetch-commons.mjs --limit 120
//   node tools/photos/fetch-commons.mjs --limit 120 --offset 120     // 分批
//
// 产出：
//   tools/photos/cache/<hash>.jpg        缩略图（宽 640，压缩后由云存储托管）
//   tools/photos/manifest.json           条目清单（含署名 / 许可 / 来源页）
//   tools/photos/skipped.json            搜不到或不合规的景点（诚实记录，绝不伪造）
//
// 合规：
//   · 只收 CC0 / CC BY / CC BY-SA / Public Domain；排除 NC / ND / 未知许可。
//   · 每条保留 Artist + LicenseShortName + DescriptionUrl，展示端必须署名。
//   · Wikimedia 要求有效 User-Agent；请把下方 UA 里的联系信息改成你自己的。
//   · 搜不到就跳过，绝不用相似图 / AI 生成图顶替。

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "tools", "photos");
const CACHE = path.join(OUT, "cache");
const MANIFEST = path.join(OUT, "manifest.json");
const SKIPPED = path.join(OUT, "skipped.json");
const ALIASES = path.join(OUT, "aliases.json");
const NAMES = path.join(OUT, "names.json");

const UA = "TravelGuideMini/1.20 (offline travel guide; contact: set-your-email@example.com)";
const API = "https://commons.wikimedia.org/w/api.php";
const OK_LICENSE = /^(cc0|cc by|cc by-sa|public domain|pd-|pd )/i;
const BAD_LICENSE = /(\bnc\b|\bnd\b|non-?commercial|no-?deriv|all rights reserved|fair use)/i;

function arg(name, def) {
  const eq = process.argv.find(a => a.startsWith("--" + name + "="));
  if (eq) return eq.split("=").slice(1).join("=");
  const i = process.argv.indexOf("--" + name);   // 同时兼容 --limit 5 空格形式
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return def;
}
const LIMIT = Math.max(1, parseInt(arg("limit", "120"), 10) || 120);
const OFFSET = Math.max(0, parseInt(arg("offset", "0"), 10) || 0);
const MAX_MS = Math.max(30, parseInt(arg("max-seconds", "180"), 10) || 180) * 1000;

function readJSON(p, def) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return def; } }
function writeJSON(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); }
function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 160);
}
function sha(s) { return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12); }

// 景点名清单：优先 names.json（人工指定）→ 否则取 utils/data.js 的 SPOT_DETAILS 具名真实景点键
function loadNames() {
  const custom = readJSON(NAMES, null);
  if (Array.isArray(custom) && custom.length) return custom.map(x => (typeof x === "string" ? { name: x, city: "" } : { name: x.name, city: x.city || "" }));
  try {
    const D = require(path.join(ROOT, "utils", "data.js"));
    return Object.keys(D.SPOT_DETAILS || {}).filter(Boolean).map(name => ({ name, city: "" }));
  } catch (e) {
    console.error("无法读取景点清单：请创建 tools/photos/names.json（[{\"name\":\"故宫\",\"city\":\"北京\"}]）");
    return [];
  }
}

function get(url, timeoutMs) {
  const ms = timeoutMs || 20000;
  return new Promise((resolve, reject) => {
    // AbortController 硬超时：DNS 挂起时 https 的 'timeout' 事件不触发，只有 abort 能真正打断。
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("timeout")), ms);
    const cleanup = () => { try { clearTimeout(timer); } catch (e) {} };
    const req = https.get(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: ac.signal, timeout: ms }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); cleanup();
        get(res.headers.location, ms).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        cleanup();
        if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode)); return; }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on("error", (e) => { cleanup(); reject(e); });
    req.on("timeout", () => { cleanup(); req.destroy(new Error("timeout")); });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 前置探测：境外站常被网络环境限制，先花 8 秒确认可达，避免逐条卡死几分钟。
async function probe() {
  const q = new URLSearchParams({ action: "query", format: "json", meta: "siteinfo" });
  try {
    const b = await get(API + "?" + q.toString(), 8000);
    JSON.parse(b.toString("utf8"));
    return true;
  } catch (e) {
    console.error("网络探测失败：" + String((e && e.message) || e));
    console.error("Wikimedia Commons 当前不可达（境外站常被网络环境限制）。");
    console.error("→ 换可访问 Commons 的网络重跑；或先用 --dry-run 离线自检管线。");
    console.error("→ 也可自行准备合规 CC 图片 + 手写 manifest.json，再走 upload-cloud.mjs / build-map.mjs。");
    return false;
  }
}

function searchUrl(term) {
  const q = new URLSearchParams({
    action: "query", format: "json", formatversion: "2",
    generator: "search", gsrsearch: "filetype:bitmap " + term,
    gsrnamespace: "6", gsrlimit: "5",
    prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "640"
  });
  return API + "?" + q.toString();
}

async function findImage(term) {
  const buf = await get(searchUrl(term));
  let j;
  try { j = JSON.parse(buf.toString("utf8")); } catch (e) { return null; }
  const pages = (j && j.query && j.query.pages) || [];
  for (const p of pages) {
    const ii = p && p.imageinfo && p.imageinfo[0];
    if (!ii || !ii.thumburl) continue;
    const em = ii.extmetadata || {};
    const lic = String((em.LicenseShortName && em.LicenseShortName.value) || "").trim();
    if (!lic || !OK_LICENSE.test(lic) || BAD_LICENSE.test(lic)) continue;
    const url = String(ii.thumburl || "");
    if (!/^https:/.test(url)) continue;
    return {
      url,
      credit: stripHtml((em.Artist && em.Artist.value) || "") || "Wikimedia Commons",
      license: lic,
      src: String((em.LicenseUrl && em.LicenseUrl.value) || ii.descriptionurl || ""),
      page: String(ii.descriptionurl || "")
    };
  }
  return null;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const names = loadNames();
  if (!names.length) { console.error("景点清单为空，结束（不伪造）"); process.exit(1); }
  const aliases = readJSON(ALIASES, {});
  const manifest = readJSON(MANIFEST, []);
  const skipped = readJSON(SKIPPED, []);
  const have = new Set(manifest.map(m => m.key));
  const doneSkip = new Set(skipped.map(s => s.name));
  const batch = names.slice(OFFSET, OFFSET + LIMIT);
  if (!batch.length) { console.log("offset 超出清单长度，无新增"); return; }

  // 离线自检：不联网、不耗配额，验证清单/别名/API 配置是否正确。
  if (process.argv.includes("--dry-run")) {
    console.log("离线自检（--dry-run，不联网、不耗配额）：");
    console.log("  景点清单 " + names.length + " 条 | 本批 " + batch.length + " 条（offset=" + OFFSET + "）");
    console.log("  aliases " + Object.keys(aliases).length + " 条 | API " + API);
    console.log("  许可白名单：CC0 / CC BY / CC BY-SA / Public Domain");
    console.log("  搜索词示例：" + batch.slice(0, 5).map(x => x.name + " → " + (aliases[x.name] || (x.city ? x.city + " " + x.name : x.name))).join("；"));
    return;
  }

  if (!(await probe())) process.exit(2);   // 网络不通即明确退出，不逐条卡死
  const killer = setTimeout(() => {
    console.error("总时限到达，安全退出（已写出的 manifest 保留，可加大 --max-seconds 或分批跑）");
    process.exit(2);
  }, MAX_MS);

  let added = 0, miss = 0;
  for (const item of batch) {
    const key = item.name + "|" + (item.city || "");
    if (have.has(key) || doneSkip.has(item.name)) continue;
    const term = aliases[item.name] || (item.city ? item.city + " " + item.name : item.name);
    let info = null;
    try { info = await findImage(term); } catch (e) { info = null; }
    if (!info) { skipped.push({ name: item.name, city: item.city || "", reason: "no-cc-image" }); miss++; await sleep(180); continue; }
    const fname = sha(key) + ".jpg";
    const fp = path.join(CACHE, fname);
    try {
      if (!fs.existsSync(fp)) {
        const b = await get(info.url, 30000);
        if (b.length < 2000) throw new Error("too-small");
        fs.writeFileSync(fp, b);
      }
      manifest.push({
        key, name: item.name, city: item.city || "", file: fname,
        credit: info.credit, license: info.license, src: info.src, page: info.page
      });
      added++;
    } catch (e) {
      skipped.push({ name: item.name, city: item.city || "", reason: "download-failed: " + String(e.message || e) });
      miss++;
    }
    await sleep(180);   // 礼貌限流，不压 Wikimedia
  }
  writeJSON(MANIFEST, manifest);
  writeJSON(SKIPPED, skipped);
  clearTimeout(killer);
  console.log("本批 " + batch.length + " | 新增 " + added + " | 跳过 " + miss);
  console.log("manifest 累计 " + manifest.length + " 条 | 缓存 " + fs.readdirSync(CACHE).length + " 张");
  console.log("下一步：上传 cache 到云存储 → node tools/photos/build-map.mjs --prefix <cloud://前缀> --enable");
}

main().catch(e => { console.error("采集失败：", e && e.message || e); process.exit(1); });
