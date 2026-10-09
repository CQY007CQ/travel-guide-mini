// v1.12 全量优化扫描器：在 scan-opt.mjs 基础上扩大覆盖面
// 用法: node tools/scan-v112.mjs
import { readFileSync, readdirSync } from "fs";
const root = process.cwd();
const pages = ["splash", "index", "today", "plan", "more", "map", "food", "ledger", "prep", "assistant", "guide", "toolkit"];
// E2E/自动化辅助方法（automator 通过 page.callMethod("xxx") 外部调用），不算死代码
const TEST_HOOKS = new Set(["setThemeQuiet"]);
const issues = [];
const add = (cat, pri, loc, msg) => issues.push({ cat, pri, loc, msg });

// ============ A. 页面 data 字段未在 wxml/js 使用 ============
for (const p of pages) {
  const jf = `pages/${p}/${p}.js`, wf = `pages/${p}/${p}.wxml`;
  let js = "", wx = "";
  try { js = readFileSync(`${root}/${jf}`, "utf8"); wx = readFileSync(`${root}/${wf}`, "utf8"); } catch { continue; }
  const dm = js.match(/data\s*:\s*\{/);
  if (!dm) continue;
  const st = js.indexOf(dm[0]) + dm[0].length;
  let d = 1, k = st;
  while (k < js.length && d > 0) { if (js[k] === "{") d++; else if (js[k] === "}") d--; k++; }
  const block = js.slice(st, k);
  // 只取顶层键（缩进 4 空格的行首 key:）
  for (const m of block.matchAll(/^\s{4}([A-Za-z_$][\w$]*)\s*:/gm)) {
    const key = m[1];
    if (/^(onLoad|onShow|data)$/.test(key)) continue;
    // data 里初始化的函数对象会被引用为方法，跳过
    if (!new RegExp("\\b" + key + "\\b").test(wx + js.replace(block, ""))) {
      add("未用data字段", "P3", jf, `data.${key} 未在任何 wxml/js 使用`);
    }
  }
  // 未使用的页面方法（Page 对象顶层方法定义，但 wxml 无对应事件、js 内无 this.x 调用）
  const pm = js.match(/Page\(\{([\s\S]*)\}\)/);
  if (pm) {
    const body = pm[1];
    const used = new Set();
    // this.x() 与 self.x()（const self = this 别名）都算被调用
    for (const m of body.matchAll(/(?:this|self)\.([A-Za-z_$][\w$]*)\s*\(/g)) used.add(m[1]);
    const dataEnd = js.indexOf("data:");
    const afterData = body;
    for (const m of afterData.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) {
      const fn = m[1];
      if (["onLoad", "onShow", "onHide", "onUnload", "onPullDownRefresh", "onShareAppMessage", "onReachBottom"].includes(fn)) continue;
      if (["if", "for", "while", "switch", "catch", "function"].includes(fn)) continue;
      // E2E/自动化辅助方法（automator 通过 page.callMethod("xxx") 外部调用），不算死代码
      if (TEST_HOOKS.has(fn)) continue;
      // 事件处理器通常形如 onXxx/bind 对应，检查 wxml 与 this. 调用
      if (!used.has(fn) && !new RegExp('"(?:bind|catch)(?:tap|input|change|confirm|submit|longpress|touchstart|touchmove|touchend|blur|focus)=?"?' + fn).test(wx)) {
        // 更保守：wxml 里出现该名字作为属性值
        if (!new RegExp("([\"'])" + fn + "\\1").test(wx)) {
          add("未用方法", "P3", jf, `方法 ${fn}() 未在 wxml/js 被调用`);
        }
      }
    }
  }
}

// ============ B. 未使用的 require ============
for (const f of [...pages.map(p => `pages/${p}/${p}.js`), "app.js"]) {
  let js = "";
  try { js = readFileSync(`${root}/${f}`, "utf8"); } catch { continue; }
  for (const m of js.matchAll(/const\s+(\w+)\s*=\s*require\(["']([^"']+)["']\)/g)) {
    const [_, name, mod] = m;
    const rest = js.replace(m[0], "");
    if (!new RegExp("\\b" + name + "\\b").test(rest)) {
      add("未用require", "P3", f, `require(${mod}) 赋给 ${name} 但从未使用`);
    }
  }
}

// ============ C. 无 wx:key 的 wx:for ============
for (const p of pages) {
  const wf = `pages/${p}/${p}.wxml`;
  let wx = "";
  try { wx = readFileSync(`${root}/${wf}`, "utf8"); } catch { continue; }
  const lines = wx.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/wx:for=/.test(lines[i]) && !/wx:key/.test(lines[i])) {
      add("for缺key", "P2", `${wf}:${i + 1}`, "wx:for 未带 wx:key（列表渲染警告，且复用错乱）");
    }
  }
}

// ============ D. 静态 style（无 {{}} 的内联）与空 class ============
for (const p of pages) {
  const wf = `pages/${p}/${p}.wxml`;
  let wx = "";
  try { wx = readFileSync(`${root}/${wf}`, "utf8"); } catch { continue; }
  const lines = wx.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const sm = lines[i].match(/style="([^"]*)"/);
    if (sm && !/\{\{/.test(sm[1])) add("静态内联style", "P3", `${wf}:${i + 1}`, `style="${sm[1]}" 无动态值，应抽成 class`);
    const cm = lines[i].match(/class="([^"]*)"/);
    if (cm && cm[1].trim() === "") add("空class", "P3", `${wf}:${i + 1}`, 'class="" 空属性');
  }
}

// ============ E. 文本质量：全角空格/控制字符/重复标点 ============
const badText = [];
for (const f of [...pages.map(p => `pages/${p}/${p}.js`), "utils/travel.js", "utils/planner.js", "app.js"]) {
  let js = "";
  try { js = readFileSync(`${root}/${f}`, "utf8"); } catch { continue; }
  const lines = js.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // 只查非断空格 NBSP 与零宽/控制字符；全角空格 U+3000 常用于中文首行缩进，属有意为之
    if (/[\u00a0\u2000-\u200b]/.test(lines[i]) && !/https?:/.test(lines[i]))
      add("不可见字符", "P3", `${f}:${i + 1}`, "含非断空格/零宽字符");
    if (/([。！？])\1{1,}/.test(lines[i]) && !/\/\//.test(lines[i]))
      add("重复标点", "P3", `${f}:${i + 1}`, "重复标点符号");
  }
}

// ============ F. wx:if 空文本节点 ============
for (const p of pages) {
  const wf = `pages/${p}/${p}.wxml`;
  let wx = "";
  try { wx = readFileSync(`${root}/${wf}`, "utf8"); } catch { continue; }
  const lines = wx.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/wx:if="\{\{!?\w+\}\}"[\s>]/.test(lines[i]) && /wx:else/.test(lines[i + 1] || "")) {
      // wx:if + wx:else 合法，跳过
    }
  }
}

// ============ G. 生成结果 ============
const order = { P1: 0, P2: 1, P3: 2 };
issues.sort((a, b) => order[a.pri] - order[b.pri] || a.loc.localeCompare(b.loc));
let pc = {};
for (const i of issues) pc[i.cat] = (pc[i.cat] || 0) + 1;
console.log("\n══════ v1.12 全量扫描（共 " + issues.length + " 处）══════");
for (const cat of Object.keys(pc)) console.log(`【${cat}】${pc[cat]} 处`);
console.log("\n明细（前 80 条）:");
issues.slice(0, 80).forEach((i, idx) => console.log(`  ${idx + 1}. [${i.pri}] ${i.loc}  ${i.msg}`));
console.log("\n图片数统计略（共 " + issues.length + " 条, 全量见上）");
