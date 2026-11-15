// tools/check/check-offline-content.mjs —— 离线优先 / 零外链 内容守卫（独立脚本，零包体影响）
//
// 目的：小程序是离线优先产品，且「百科零外链」是项目铁律。两条结构性红线：
//   ① 任何 wxml 不得出现 <a> 标签（小程序应用 <navigator>，<a> 是外链/网页泄漏的结构破口）；
//   ② 主包 pages/ 的首屏不得引用远程图片 src="http(s)://"（断网首屏必须本地可绘，不依赖网络）。
// 把红线做成 fail-fast，命中即拦截，防回潮。
//
// 不接入 allcheck.sh（避免改动回归步数触发材料口径门禁），由自我迭代循环 / CI 按需调用。
import { createRequire } from "module";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const require = createRequire(import.meta.url);
const ROOT = resolve("utils/..");
let fail = 0;
const log = (ok, msg) => { console.log((ok ? "  [ok]   " : "  [fail] ") + msg); if (!ok) fail++; };

function walk(dir, out) {
  let ents = [];
  try { ents = readdirSync(dir); } catch (e) { return out; }
  for (const name of ents) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".wxml")) out.push(p);
  }
  return out;
}

const allWxml = [];
for (const d of [resolve(ROOT, "pages"), resolve(ROOT, "subpkg")]) walk(d, allWxml);
const pageWxml = allWxml.filter(f => f.replace(ROOT + "/", "").startsWith("pages/"));

let aHits = 0, remoteHits = 0;
for (const f of allWxml) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch (e) { continue; }
  // 红线①：<a 标签（排除 <!-- 注释 --> 内的误报：简单抠掉注释块）
  const noComment = text.replace(/<!--[\s\S]*?-->/g, "");
  if (/<a[\s>]/i.test(noComment)) { aHits++; log(false, f.replace(ROOT + "/", "") + " 出现 <a> 标签（应改用 <navigator>，零外链红线）"); }
}

for (const f of pageWxml) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch (e) { continue; }
  const noComment = text.replace(/<!--[\s\S]*?-->/g, "");
  // 红线②：首屏远程图片（src="http）。本地图标 /images/icons 与 data: 不受影响。
  if (/src\s*=\s*["']https?:\/\//i.test(noComment)) { remoteHits++; log(false, f.replace(ROOT + "/", "") + " 首屏引用远程图片 src（离线优先：首屏须本地可绘）"); }
}

log(aHits === 0, "全量 wxml 无 <a> 外链标签（" + allWxml.length + " 个文件）");
log(remoteHits === 0, "主包 pages/ 首屏无远程图片 src（" + pageWxml.length + " 个文件）");

/* ── 能力宣称真实性：用户可见文案不得夸大联网/离线能力 ──
   已连续两轮发现此类错误：识物「离线识别无需联网」（实走云端）、指南「天气已内置免配置」（需本人 Key）。
   这些是用户直接可见的能力承诺，与实现相反会误导预期，故做成 fail-fast。仅扫用户可见数据，不扫注释。 */
const code = (p) => readFileSync(resolve(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/<!--[\s\S]*?-->/g, "");
const guideSrc = code("subpkg/guide/guide.js");
const moreSrc = code("pages/more/more.js");
const aiBrainSrc = code("subpkg/assistant/ai-brain.js");
const lensSrc = code("subpkg/lens/lens.wxml");
const mapSrc = code("subpkg/map/map.js");
log(!/天气已内置|免配置/.test(guideSrc), "使用指南不宣称天气「已内置/免配置」（实需本人和风 Key + 联网）");
log(!/离线速查天气/.test(moreSrc), "更多页不宣称「离线速查天气」（实为联网 + Key）");
log(!/离线识别，无需联网|离线识别无需联网/.test(aiBrainSrc + lensSrc), "识物文案不宣称「离线识别无需联网」（实走云端多模态）");
log(!/直接导航（离线可用）/.test(mapSrc), "地图分享卡不宣称导航「离线可用」（导航需联网底图）");
console.log(fail === 0
  ? "\n✓ 离线优先 / 零外链 内容守卫通过（无 <a> 外链、主包首屏无远程图、能力宣称属实）"
  : "\n✗ 命中离线优先 / 零外链 红线，请移除外链标签或远程首屏图");
process.exit(fail === 0 ? 0 : 1);
