/**
 * 清洗住宿片区 note 的重复片段（一次性数据修复，保留为可复用工具）
 *
 * 病灶：`subdata/data/data-packed.js` 里西安 3 条片区的 note 被**累积拼接了 19 次**，
 *   从 30 字涨到 597 字 ——
 *   「市中心，夜景壮观；地铁直达、夜游方便，…订。；地铁直达、…订。；…（共 19 遍）」
 *   用户侧表现：「住哪儿」卡片里出现一大段重复的废话。
 *
 * 根因：数据管线某一次把「合并后的 areas（含 subdata3 扩展表）」回写成了基数据，
 *   而当时的合并是**追加**而不是**按名去重替换**，于是每跑一轮就多拼一遍。
 *   现在的合并逻辑（data.js applyStaticTables 的 children 分支）已按 name 去重，
 *   但**已经写进产物的脏数据不会自己好** —— 需要清洗一次。
 *
 * 做法：按 `；` 切段 → trim → 保序去重 → 重新拼接。只动 `*[].areas[].note`，
 *   不碰 name/price 与任何其他字段（改完用「非 note 字段指纹」自证零副作用）。
 *
 * 用法：
 *   node tools/data/fix-dup-note.mjs --dry     # 只报告，不写盘
 *   node tools/data/fix-dup-note.mjs           # 备份后写回
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";

const CWD = process.cwd();
const DRY = process.argv.includes("--dry");
const CHUNKS = ["subdata/data/data-packed.js", "subdata2/data/data-packed2.js"];

// v1.20.31：段内若形如「小写英文单词 + 空格 + 中文」，那个英文基本是分类标签漏进来的脏字符
// （实测：「澳门 / 路环」的 note 是「 beach 渔村安静」）。只在这种明确形态下删英文前缀。
const EN_LEAK = /^\s*[a-z][a-z\s]{1,14}\s(?=[\u4e00-\u9fa5])/;

function cleanNote(note) {
  const raw = String(note || "");
  if (!raw) return raw;
  const parts = raw.split("；");
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    let s = p.trim().replace(EN_LEAK, "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;              // 保序去重：重复片段没有信息价值
    seen.add(s);
    out.push(s);
  }
  return out.join("；");
}

// 递归找出所有「areas 数组里带 note 的对象」，返回引用便于就地改写
function walkAreas(node, visit, depth = 0) {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) {
    for (const x of node) walkAreas(x, visit, depth + 1);
    return;
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (k === "areas" && Array.isArray(v)) {
      for (const a of v) if (a && typeof a === "object" && typeof a.note === "string") visit(a);
    }
    walkAreas(v, visit, depth + 1);
  }
}

// 非 note 字段指纹：证明这次修改只动了 note
function fingerprint(obj) {
  const strip = (n, d = 0) => {
    if (d > 12 || !n || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map((x) => strip(x, d + 1));
    const o = {};
    for (const k of Object.keys(n).sort()) {
      if (k === "note") continue;
      o[k] = strip(n[k], d + 1);
    }
    return o;
  };
  return crypto.createHash("sha1").update(JSON.stringify(strip(obj))).digest("hex").slice(0, 16);
}

let totalFixed = 0;
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const bakDir = path.join(CWD, "tools", "_bak", stamp + "-fix-dup-note");

for (const rel of CHUNKS) {
  const p = path.join(CWD, rel);
  if (!fs.existsSync(p)) { console.log("跳过（不存在）: " + rel); continue; }
  const src = fs.readFileSync(p, "utf8");
  const q1 = src.indexOf('"');
  const q2 = src.lastIndexOf('"');
  const b64 = src.slice(q1 + 1, q2);
  const obj = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
  const fpBefore = fingerprint(obj);

  const changes = [];
  walkAreas(obj, (a) => {
    const before = a.note;
    const after = cleanNote(before);
    if (after !== before) {
      changes.push({ name: a.name, from: before.length, to: after.length, sample: after.slice(0, 60) });
      a.note = after;
      totalFixed++;
    }
  });

  console.log("\n" + rel + "：扫描 " + Object.keys(obj).length + " 个顶层键，命中 " + changes.length + " 条");
  for (const c of changes) console.log("  · " + c.name + "：" + c.from + " → " + c.to + " 字  「" + c.sample + "…」");

  if (!changes.length) continue;
  const fpAfter = fingerprint(obj);
  if (fpBefore !== fpAfter) {
    console.error("❌ 非 note 字段指纹变了（" + fpBefore + " → " + fpAfter + "），中止：这次修复不该碰其他字段");
    process.exit(1);
  }
  console.log("  ✓ 非 note 字段指纹不变：" + fpBefore);

  if (DRY) { console.log("  （--dry：未写盘）"); continue; }

  const json = JSON.stringify(obj);
  const b64new = zlib.deflateSync(Buffer.from(json, "utf8"), { level: 9 }).toString("base64");
  const head = src.slice(0, q1 + 1);
  if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
  fs.copyFileSync(p, path.join(bakDir, path.basename(p)));
  fs.writeFileSync(p, head + b64new + '";\n');
  console.log("  ✓ 已写回（备份在 " + path.relative(CWD, bakDir) + "），新体积 " + (head.length + b64new.length + 3) + " B");
}

console.log("\n合计修复 " + totalFixed + " 条 note" + (DRY ? "（dry-run，未落盘）" : ""));
