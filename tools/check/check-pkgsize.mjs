// 分包体积体检：按微信「每个分包独立 2MB 红线」逐包核算 gzip 体积。
// 旧版 allcheck 把全项目（含 1.7MB 数据分包）累加成一个数去比对 2MB，
// 必然误报；真实约束是【主包 + 每个分包各自 ≤ 2MB 压缩后】，总包体可超 20MB。
// 用法：node tools/check/check-pkgsize.mjs
import fs from "fs";
import path from "path";
import zlib from "zlib";

// web/ 是网页版产物（v1.20.0），已在 project.config.json 的 packOptions.ignore 排除，不进小程序包
// v1.20.6 迭代 #9：门禁改为直接读取 project.config.json 的 packOptions.ignore（权威排除清单），
// 避免「真包已排除、门禁却仍计入」的漂移（如 prompt-lab/、package-lock.json 这类纯开发/Node 产物）。
const EXC = new Set(["tools", "shots", ".qr", "outputs", "node_modules", ".git", ".workbuddy", "web", "docs"]);
const FILE_IGNORE = new Set();
const SUFFIX_IGNORE = new Set();
try {
  const po = (JSON.parse(fs.readFileSync("project.config.json", "utf8")).packOptions || {}).ignore || [];
  for (const it of po) {
    if (!it || !it.value) continue;
    if (it.type === "folder") EXC.add(it.value);
    else if (it.type === "file") FILE_IGNORE.add(it.value);
    else if (it.type === "suffix") SUFFIX_IGNORE.add(it.value);
  }
} catch (e) { /* project.config.json 缺失则回退硬编码 EXC */ }
// 真正会进微信包的源码扩展名（文档/脚本/配置不计入包体）
const SRC_EXT = /\.(js|wxml|wxss|json|wxs|png|jpe?g|gif|svg|ttf|woff2?)$/i;

const app = JSON.parse(fs.readFileSync("app.json", "utf8"));
const subs = (app.subPackages || app.subpackages || []).map((s) => s.root.replace(/\/+$/, ""));
const isSub = (p) => subs.some((r) => p === r || p.startsWith(r + "/"));
const subOf = (p) => subs.find((r) => p === r || p.startsWith(r + "/"));

const pkgs = { __main__: { raw: 0, gzip: 0 } };
subs.forEach((r) => (pkgs[r] = { raw: 0, gzip: 0 }));

// v1.19.206：同时收集「图片 + 音频」总量。微信开发者工具「代码质量」面板里
// 「图片和音频资源大小应不超过 200K」按合计算，光看单个文件永远发现不了。
let imgBytes = 0;
const IMG_EXT = /\.(png|jpe?g|gif|mp3|wav|m4a)$/i;

function walk(d, rel) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "." || e.name === "..") continue;
    if (EXC.has(e.name)) continue;
    const p = path.join(d, e.name);
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) { walk(p, r); continue; }
    // packOptions.ignore 的 file / suffix 规则同样不进包（如 package-lock.json / .md 等）
    if (FILE_IGNORE.has(e.name)) continue;
    if (SUFFIX_IGNORE.size && SUFFIX_IGNORE.has(e.name.slice(e.name.lastIndexOf(".")))) continue;
    // 图片/音频先累加（音频不在 SRC_EXT 白名单里，但同样计入微信 200K 口径）
    if (IMG_EXT.test(e.name)) imgBytes += fs.statSync(p).size;
    if (!SRC_EXT.test(e.name)) continue; // 只统计真正进包的源码
    if (e.name === "project.config.json") continue; // 不上传进包
    const b = fs.statSync(p).size;
    const g = zlib.gzipSync(fs.readFileSync(p)).length;
    const key = isSub(r) ? subOf(r) : "__main__";
    pkgs[key].raw += b;
    pkgs[key].gzip += g;
  }
}
walk(process.cwd(), "");

const HARD = 2048; // 微信每包压缩后 2MB 硬上限
const WARN = 1850; // 黄色预警区
let bad = 0;
const order = ["__main__", ...subs];
for (const k of order) {
  const g = Math.round(pkgs[k].gzip / 1024);
  const raw = Math.round(pkgs[k].raw / 1024);
  const tag = k === "__main__" ? "主包" : "分包 " + k;
  if (g > HARD) {
    console.log(`  [fail] ${tag} gzip=${g}KB / raw=${raw}KB 超 ${HARD}KB 红线!`);
    bad++;
  } else if (g > WARN) {
    console.log(`  [warn] ${tag} gzip=${g}KB / raw=${raw}KB 进入黄色区(> ${WARN}KB)`);
  } else {
    console.log(`  [ok]   ${tag} gzip=${g}KB / raw=${raw}KB`);
  }
}
if (bad) {
  console.log(`  ✗ ${bad} 个包超红线`);
  process.exit(2);
}
console.log("  ✓ 全部包体在 2MB 红线内");

// ────────────────────────────────────────────────────────────────
// v1.19.206：复刻微信开发者工具「代码质量」面板的三项硬指标
//
// 背景：2026-11-07 用户截图显示面板有「主包大小 / 图片和音频资源」两项未通过，
//   而 allcheck 此前只盯「每包 2MB 压缩后」，完全看不到这两条 —— 面板是评审会
//   当场会点开的页面，必须在本门禁里提前 fail-fast。
//   同日实测根因：① 主包 raw 1.68MB 超 1.5M 线（README/讲稿/allcheck.sh 等
//   .md/.sh/.txt 被原样打进包，已用 packOptions.ignore 的 suffix 规则排除）；
//   ② tabBar 图标做成 243×243（官方建议 81×81），图片合计 217KB > 200K，
//   已统一重采样到 120×120（原图备份在 tools/_src-backup/tab-icons-243/）。
// ────────────────────────────────────────────────────────────────
let qbad = 0;

// 1) 主包尺寸：raw ≤ 1.5MB（面板原文「主包尺寸（不包含插件）应小于 1.5M」）
const MAIN_LIMIT = 1536;
const mainRawKB = Math.round(pkgs["__main__"].raw / 1024);
if (mainRawKB > MAIN_LIMIT) {
  console.log(`  [fail] 主包 raw=${mainRawKB}KB 超「代码质量」1.5M 线`);
  qbad++;
} else {
  console.log(`  [ok]   主包 raw=${mainRawKB}KB（代码质量线 ${MAIN_LIMIT}KB）`);
}

// 2) 图片 + 音频合计 ≤ 200K（面板按合计算，看单个文件永远发现不了）
const IMG_LIMIT = 200;
const imgKB = Math.round(imgBytes / 1024);
if (imgKB > IMG_LIMIT) {
  console.log(`  [fail] 图片/音频合计 ${imgKB}KB 超 ${IMG_LIMIT}K 线`);
  qbad++;
} else {
  console.log(`  [ok]   图片/音频合计 ${imgKB}KB（代码质量线 ${IMG_LIMIT}K）`);
}

// 3) tabBar 图标尺寸：官方建议 81×81，超过 200×200 属纯冗余（再大也不会更清晰）
const ICON_MAX = 200;
const pngSize = (file) => {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const tabs = ((app.tabBar && app.tabBar.list) || []);
const icons = new Set();
tabs.forEach((t) => {
  if (t.iconPath) icons.add(t.iconPath);
  if (t.selectedIconPath) icons.add(t.selectedIconPath);
});
let iconBad = 0;
for (const ic of icons) {
  const p = ic.replace(/^\//, "");
  if (!fs.existsSync(p)) { console.log(`  [fail] tabBar 图标缺失：${ic}`); iconBad++; continue; }
  const s = pngSize(p);
  if (!s) continue;
  if (s.w > ICON_MAX || s.h > ICON_MAX) {
    console.log(`  [fail] tabBar 图标过大：${ic} ${s.w}×${s.h}（上限 ${ICON_MAX}）`);
    iconBad++;
  }
}
// 浅色/选中变体由运行时 setTabBarItem 切换，不在 app.json 静态列表里，一并校验
for (const f of fs.readdirSync("images").filter((x) => /^tab-.*\.png$/i.test(x))) {
  const rel = "images/" + f;
  if (icons.has("/" + rel) || icons.has(rel)) continue;
  const s = pngSize(rel);
  if (!s) continue;
  if (s.w > ICON_MAX || s.h > ICON_MAX) {
    console.log(`  [fail] tabBar 变体图标过大：${rel} ${s.w}×${s.h}（上限 ${ICON_MAX}）`);
    iconBad++;
  }
}
if (iconBad) qbad += iconBad;
else console.log(`  [ok]   ${icons.size} 个 tabBar 图标尺寸合规（≤ ${ICON_MAX}×${ICON_MAX}）`);

if (qbad) {
  console.log(`  ✗ 代码质量面板指标未通过 ${qbad} 项`);
  process.exit(3);
}
console.log("  ✓ 代码质量面板三项指标均达标（主包 1.5M / 图片 200K / 图标尺寸）");

// ────────────────────────────────────────────────────────────────
// v1.20.8（T5）：把体积数字输出成机器可读行，供 check-doc-numbers.mjs 断言文档口径。
//
// 动机：README / 功能清单 / 讲稿 / 计划书 / PPT 里手写的「主包 660KB」「data-packed 约 1828KB」
//   这类数字写死就必然漂移（实测已发生两轮：主包 660→1418KB、data-packed 1828→1924KB）。
//   本脚本是体积的唯一计算者，因此也由它输出真值；文档与门禁都只消费这里的 [fig] 行，
//   任何人想改口径都只能改这一处，不会再出现「脚本一个数、文档一个数」。
// 格式固定 `[fig] key=value`，value 一律纯数字（KB 取整），便于正则直接解析。
// ────────────────────────────────────────────────────────────────
const figs = [
  ["main_raw_kb", mainRawKB],
  ["main_gzip_kb", Math.round(pkgs["__main__"].gzip / 1024)],
  ["img_kb", imgKB],
  // 分包 gzip 合计 + 总包体：交付材料里「四个分包合计约 2.1MB / 总包体约 2.8M」说的就是这个口径，
  // 但它一直靠人手加，主包瘦身 227KB 之后没人重算 —— 典型的手写漂移。由脚本算。
  // 总包体刻意用「已取整的两项相加」，不用原始字节再取整：否则文档里 561 + 2,160 会算出 2,721，
  // 而门禁报 2,722，差 1KB 的舍入差会变成「材料自相矛盾」的假 bug。
  ["sub_gzip_total_kb", Math.round(subs.reduce((s, r) => s + pkgs[r].gzip, 0) / 1024)],
  ["total_gzip_kb", Math.round(pkgs["__main__"].gzip / 1024) + Math.round(subs.reduce((s, r) => s + pkgs[r].gzip, 0) / 1024)],
];
subs.forEach((r) => figs.push(["pkg_" + r.replace(/[^a-z0-9]/gi, "_") + "_raw_kb", Math.round(pkgs[r].raw / 1024)]));
// data-packed 系列单独报：它是「数据分包被撑爆」的盯防对象，也是文档最常引用的体积数字。
for (const dp of ["subdata/data/data-packed.js", "subdata2/data/data-packed2.js", "subdata3/data/team-food3.js"]) {
  if (!fs.existsSync(dp)) continue;
  const key = dp.split("/").pop().replace(/\.js$/, "").replace(/-/g, "_");
  figs.push([key + "_kb", Math.round(fs.statSync(dp).size / 1024)]);
}
for (const [k, v] of figs) console.log(`[fig] ${k}=${v}`);
