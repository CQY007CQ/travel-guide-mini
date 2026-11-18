// WXML 静态校验：标签闭合 / 属性引号 / wx:for 与 wx:key 配对
// 用途：IDE 登录态失效跑不了 preview 时，用它兜底确认模板结构没写坏
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (f !== "node_modules" && f !== ".git") walk(p); }
    else if (f.endsWith(".wxml")) files.push(p);
  }
})(ROOT);

// v1.20.32：br/hr 从 VOID_TAGS 里移除并改为「出现即判红」——WXML 里 <br/> 不是有效标签，
// 会被静默忽略（只有 rich-text 的 nodes 才认）。想主动断行必须拆成相邻 <view>。
const VOID_TAGS = new Set(["image", "input", "icon", "import", "include", "wxs"]);
let pass = 0, fail = 0;
const errs = [];

for (const f of files) {
  const src = fs.readFileSync(f, "utf-8");
  const rel = path.relative(ROOT, f);
  // 去注释
  const clean = src.replace(/<!--[\s\S]*?-->/g, "");
  // WXML 里 <br/> / <hr/> 是无效标签，会被静默忽略 → 换行不生效，靠容器宽度自然折行，
  // 结果是本该整句的文案被折出「孤字成行」。要主动断行必须拆相邻 <view>。
  if (/<(?:br|hr)\b/i.test(clean)) {
    errs.push(rel + ": 用了 WXML 不支持的 <br>/<hr>（会被忽略，换行不生效）—— 请拆成相邻 <view> 或用 rich-text");
    fail++; continue;
  }
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m, bad = 0;
  while ((m = re.exec(clean))) {
    const closing = m[1] === "/";
    const tag = m[2];
    const attrs = m[3] || "";
    const selfClose = m[4] === "/";
    // 属性引号配对
    const q = (attrs.match(/"/g) || []).length;
    if (q % 2 !== 0) { errs.push(rel + ": 属性引号不闭合 <" + tag + " …>"); bad++; }
    if (selfClose || VOID_TAGS.has(tag) || tag === "block" && false) continue;
    if (closing) {
      const top = stack.pop();
      if (top !== tag) {
        errs.push(rel + ": 标签错配，期望 </" + top + "> 实际 </" + tag + ">");
        bad++;
        // 尝试恢复
        if (top) stack.push(top);
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length) { errs.push(rel + ": 未闭合标签 " + stack.join(",")); bad++; }
  if (bad) fail++; else pass++;
  console.log((bad ? "  ✗ " : "  ✓ ") + rel + (bad ? " (" + bad + " 处)" : ""));

  // wx:for 必须有 wx:key（除 wx:for-item 显式指定且数据简单外，仅提示）
  const forRe = /wx:for="\{\{([^}]+)\}\}"/g;
  let fm;
  while ((fm = forRe.exec(clean))) {
    const seg = clean.slice(fm.index, fm.index + 220);
    if (seg.indexOf("wx:key") < 0) errs.push(rel + ": wx:for 缺 wx:key → " + fm[1]);
  }
}

// 检查引用的图标文件是否存在
const iconRe = /\/images\/icons\/([a-zA-Z0-9_-]+)\.png/g;
const missing = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, "utf-8");
  let m;
  while ((m = iconRe.exec(src))) {
    const p = path.join(ROOT, "images/icons", m[1] + ".png");
    if (!fs.existsSync(p)) missing.add(m[1]);
  }
}
// 动态图标（{{}} 拼接）需人工确认
if (missing.size) errs.push("缺失图标: " + Array.from(missing).join(", "));

/* v1.20.29：全宽提示块不得作为「不换行 flex 行」的直接子节点。
 * 真实故障（2026-11-18 真机截图）：`.limited-notice` 被放在 `.sum-row`（display:flex，
 * 无 flex-wrap）里，它按 max-content 占宽，而 `.sum-main` 是 flex:1（basis 0）——
 * 于是标题/统计被挤成「一列一个汉字」，整个 hero 看起来塌了。
 * 这类塌陷不报错、不白屏、Console 也没有告警，只能靠断言结构挡住。 */
{
  const wxssFiles = [];
  (function walkCss(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) { if (f !== "node_modules" && f !== ".git") walkCss(p); }
      else if (f.endsWith(".wxss")) wxssFiles.push(p);
    }
  })(ROOT);

  const flexRows = new Set();      // 会「横向排布且不换行」的容器类
  for (const f of wxssFiles) {
    const css = fs.readFileSync(f, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2];
      if (!/display\s*:\s*flex\b/.test(body)) continue;
      if (/flex-wrap\s*:\s*wrap\b/.test(body)) continue;   // 换行的行内放全宽块是合法的
      for (const sel of m[1].split(",")) {
        const s = sel.trim();
        if (/^\.[A-Za-z0-9_-]+$/.test(s)) flexRows.add(s.slice(1));
      }
    }
  }

  const clashes = [];
  let noticeCount = 0;
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const clean = fs.readFileSync(f, "utf-8").replace(/<!--[\s\S]*?-->/g, "");
    const stack = [];   // { tag, cls[] }
    const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
    let m;
    while ((m = re.exec(clean))) {
      const closing = m[1] === "/", tag = m[2], attrs = m[3] || "", selfClose = m[4] === "/";
      if (closing) { stack.pop(); continue; }
      const cm = /(?<![-\w])class\s*=\s*"([^"]*)"/.exec(attrs);
      const cls = cm ? cm[1].split(/\s+/).filter((c) => c && !c.includes("{{")) : [];
      if (cls.some((c) => /notice/i.test(c))) noticeCount++;
      const parent = stack[stack.length - 1];
      if (parent) {
        const prow = parent.cls.find((c) => flexRows.has(c));
        if (prow) for (const c of cls) if (/notice/i.test(c)) clashes.push(rel + ": ." + prow + " > ." + c);
      }
      if (!selfClose && !VOID_TAGS.has(tag)) stack.push({ tag, cls });
    }
  }
  // 下限防「扫描范围塌缩成空集」的假绿（判据自己也要有护栏）
  if (flexRows.size < 5 || noticeCount < 1) {
    errs.push("提示类布局扫描范围异常（flex 行 " + flexRows.size + " 个 / 提示类 " + noticeCount +
      " 个）—— 判据可能已失效，别当通过");
  }
  if (clashes.length) errs.push("全宽提示块被塞进 flex 行（会把同排内容挤成一列汉字）: " + clashes.join(" / "));
  console.log("  " + (clashes.length ? "✗" : "✓") + " 提示块布局：" + flexRows.size + " 个不换行 flex 行 / " +
    noticeCount + " 个提示类" + (clashes.length ? "，" + clashes.length + " 处混排" : "，未混排"));
}

// ═══ 悬浮 AI 入口（fab 形态）必须有足够的页面底部留白 ═══
// v1.20.32 真机复核发现：.ai-fab 是 position:fixed bottom:40rpx，自身高约 58rpx
// （字号放大档 --fs:1.35 时约 99rpx）→ 占位 100~140rpx。各页 .page 的 padding-bottom
// 原先是 40/60/80rpx 三种，都小于占位 → 滚到最底部时最后一块内容被按钮永久压住，
// 且「滚不动也看不见」，用户无法自救。这里按 FAB 最大占位 + 呼吸量取 180rpx 硬线。
{
  const FAB_MIN_PAD = 180;
  const fabPages = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf-8");
    if (!/<ai-entry\b/.test(src)) continue;
    // inline 形态是流内胶囊，不悬浮、不需要留白
    if (/<ai-entry\b[^>]*\binline\b/.test(src)) continue;
    fabPages.push(f);
  }
  const bad = [];
  for (const f of fabPages) {
    const rel = path.relative(ROOT, f);
    const wxss = f.replace(/\.wxml$/, ".wxss");
    if (!fs.existsSync(wxss)) { bad.push(rel + ": 缺少同名 wxss，无法核对底部留白"); continue; }
    const css = fs.readFileSync(wxss, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    const m = /(?<![-\w.])\.page\s*\{([^}]*)\}/.exec(css);
    if (!m) { bad.push(rel + ": wxss 里找不到 .page 规则"); continue; }
    const body = m[1];
    let pad = null;
    const pb = /(?<![-\w])padding-bottom\s*:\s*([\d.]+)rpx/.exec(body);
    if (pb) pad = Number(pb[1]);
    if (pad === null) {
      const sh = /(?<![-\w])padding\s*:\s*([^;]+)/.exec(body);
      if (sh) {
        const v = sh[1].trim().split(/\s+/);
        const last = v[v.length - 1];
        const rm = /^([\d.]+)rpx$/.exec(last);
        if (rm) pad = Number(rm[1]);
      }
    }
    if (pad === null) { bad.push(rel + ": .page 未声明可解析的 padding-bottom"); continue; }
    if (pad < FAB_MIN_PAD) bad.push(rel + ": .page padding-bottom=" + pad + "rpx < " + FAB_MIN_PAD + "rpx（底部内容会被 AI 悬浮按钮压住）");
  }
  // 判据下限护栏：扫描范围塌缩成空集时必须判红，不能静默通过
  if (fabPages.length < 5) {
    errs.push("AI 悬浮入口扫描范围异常（只找到 " + fabPages.length + " 个 fab 形态页面）—— 判据可能已失效，别当通过");
  }
  if (bad.length) errs.push("AI 悬浮入口压住页面底部内容: " + bad.join(" / "));
  console.log("  " + (bad.length ? "✗" : "✓") + " AI 悬浮入口留白：" + fabPages.length + " 个 fab 页面，底部留白下限 " +
    FAB_MIN_PAD + "rpx" + (bad.length ? "，" + bad.length + " 处不足" : "，全部达标"));
}

console.log("\n结果: " + pass + " 个文件通过 / " + fail + " 个文件有问题" + (errs.length ? "（含 " + errs.length + " 条结构问题）" : ""));
if (errs.length) { console.log("问题明细:"); errs.forEach(e => console.log("  - " + e)); process.exit(1); }
console.log("WXML 结构全部正确");
