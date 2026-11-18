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

const VOID_TAGS = new Set(["image", "input", "icon", "import", "include", "wxs", "br", "hr"]);
let pass = 0, fail = 0;
const errs = [];

for (const f of files) {
  const src = fs.readFileSync(f, "utf-8");
  const rel = path.relative(ROOT, f);
  // 去注释
  const clean = src.replace(/<!--[\s\S]*?-->/g, "");
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

console.log("\n结果: " + pass + " 个文件通过 / " + fail + " 个文件有问题" + (errs.length ? "（含 " + errs.length + " 条结构问题）" : ""));
if (errs.length) { console.log("问题明细:"); errs.forEach(e => console.log("  - " + e)); process.exit(1); }
console.log("WXML 结构全部正确");
