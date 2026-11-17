#!/usr/bin/env node
/**
 * tools/check/check-qa-rails.mjs —— 测控补充护栏（数值型 / 有效性，纯静态可复算）
 *
 * 61 步回归里绝大多数是「结构 / 契约」断言：函数在不在、字段有没有、文案合不合规。
 * 它们拦不住下面三类问题，而这三类恰好是用户真的会撞上的：
 *
 *   A. 对比度数值 —— 变量改了、颜色换了，结构断言全绿，但字看不见了
 *   B. 跨模块口径 —— 一头加严、另一头照常注入，两边打架（本轮 P0 就是这么来的）
 *   C. 测试有效性 —— 测试没装 wx 垫片，静默走默认值，在空数据上"通过"
 *
 * 分组输出，任一失败退出码 1。用法：node tools/check/check-qa-rails.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  ✓ " + name + (extra ? "  " + extra : ""));
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  " + extra : "")); }
};
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/* ══════════════════════ 公共：颜色与 WCAG 对比度 ══════════════════════ */
function parseHex(v) {
  const s = String(v).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return m[1].split("").map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return null;
}
const _lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const relLum = ([r, g, b]) => 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b);
function contrast(a, b) {
  const l1 = relLum(a), l2 = relLum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** 把 wxss 拆成 { selector, decls } 块（够用即可：本项目 wxss 无嵌套 @media 内的嵌套规则） */
function cssBlocks(text) {
  const out = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}
/** 从 `--x: val;` 声明里取变量表 */
function varMap(blocks) {
  const map = {};
  for (const b of blocks) {
    const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let m;
    while ((m = re.exec(b.body))) map[m[1]] = m[2].trim();
  }
  return map;
}
/** 解析一个声明值到 RGB；支持 var(--x, fallback) 与 hex；其余（rgba/渐变/transparent）返回 null */
function toRgb(value, vars) {
  if (!value) return null;
  let v = String(value).trim();
  const varRe = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i;
  let m = varRe.exec(v);
  if (m) {
    const fromVar = vars[m[1]];
    if (fromVar) return toRgb(fromVar, {});
    if (m[2]) return toRgb(m[2].trim(), {});
    return null;
  }
  // 纯 hex
  const hex = parseHex(v);
  if (hex) return hex;
  return null; // rgba() / linear-gradient() / transparent / currentColor → 交给人工判断
}

/* ══════════════════════ A. 对比度门禁 ══════════════════════ */
function checkContrast() {
  console.log("\n[A] 对比度（文字色 × 同规则背景色，WCAG AA 4.5:1）");
  const app = read("app.wxss");
  const appBlocks = cssBlocks(app);
  // 浅色 = 不含 .td 的块；暗色 = 浅色 + .td 块覆盖
  const lightBlocks = appBlocks.filter((b) => !/\.td\b/.test(b.selector));
  const darkExtra = appBlocks.filter((b) => /\.td\b/.test(b.selector));
  const lightVars = varMap(lightBlocks);
  const darkVars = Object.assign({}, lightVars, varMap(darkExtra));

  const files = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n.startsWith(".")) continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".wxss")) files.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, "pages"));
  walk(path.join(ROOT, "subpkg"));

  const hard = [];   // < 4.5
  const soft = [];   // 4.5–5.0 预警
  for (const f of files) {
    for (const b of cssBlocks(read(f))) {
      const decls = {};
      for (const d of b.body.split(";")) {
        const i = d.indexOf(":");
        if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
      }
      const fgRaw = decls["color"];
      const bgRaw = decls["background-color"] || decls["background"];
      if (!fgRaw || !bgRaw) continue;
      const darkOnly = /\.td\b/.test(b.selector);
      const themes = darkOnly ? [["dark", darkVars]] : [["light", lightVars], ["dark", darkVars]];
      for (const [tname, vars] of themes) {
        const fg = toRgb(fgRaw, vars);
        const bg = toRgb(bgRaw, vars);
        if (!fg || !bg) continue;                    // 渐变/半透明底不参与自动判定
        const ratio = contrast(fg, bg);
        const label = `${f}  ${b.selector.slice(0, 46)}  [${tname}]  ${ratio.toFixed(2)}:1`;
        if (ratio < 4.5) hard.push(label);
        else if (ratio < 5.0) soft.push(label);
      }
    }
  }
  ok("同规则内「文字色 × 背景色」全部 ≥ 4.5:1", hard.length === 0,
    hard.length ? `\n      ${hard.join("\n      ")}` : `（扫 ${files.length + 1} 个 wxss）`);
  if (soft.length) console.log("  · 4.5–5.0 预警（合规但余量小）：\n      " + soft.join("\n      "));

  // 语义变量矩阵：只查「真的被当 color 用过」的 token × 四种表面色
  // 两处必须收窄，否则门禁自己就会误报：
  //  ① `--on-*` / `--chip-*` 是「压在某块特定色面上的文字」专用 token（如 --on-gold 配 --gold），
  //     拿它去比页面底色毫无意义 —— 它们的对比度由上面「同规则」检查负责。
  //  ② `.td` 作用域的规则只在暗色生效，不能拿去跟浅色变量表算。
  const EXEMPT = /^--(on|chip)-/;
  const usedLight = new Set(), usedDark = new Set();
  for (const f of ["app.wxss", ...files]) {
    for (const b of cssBlocks(read(f))) {
      const m = /(?:^|;)\s*color\s*:\s*var\(\s*(--[a-z0-9-]+)/i.exec(b.body);
      if (!m) continue;
      usedDark.add(m[1]);
      if (!/\.td\b/.test(b.selector)) usedLight.add(m[1]);
    }
  }
  const surfaces = { bg: "--bg-solid", card: "--card", well: "--well", panel: "--panel" };
  const matrixBad = [];
  const matrixJobs = [["light", lightVars, usedLight], ["dark", darkVars, usedDark]];
  for (const [theme, vars, tokens] of matrixJobs) {
    for (const token of tokens) {
      if (EXEMPT.test(token)) continue;
      const fg = toRgb(`var(${token})`, vars);
      if (!fg) continue;
      let worst = 99, worstOn = "";
      for (const [sname, stoken] of Object.entries(surfaces)) {
        const bg = toRgb(`var(${stoken})`, vars);
        if (!bg) continue;
        const r = contrast(fg, bg);
        if (r < worst) { worst = r; worstOn = sname; }
      }
      if (worst < 4.5) matrixBad.push(`${token} [${theme}] ${worst.toFixed(2)}:1 (对 ${worstOn})`);
    }
  }
  ok("语义色变量被当文字用时，对四种表面色均 ≥ 4.5:1", matrixBad.length === 0,
    matrixBad.length ? `\n      ${matrixBad.join("\n      ")}` : `（浅色 ${usedLight.size} / 暗色 ${usedDark.size} 个 token，已免检 --on-*/--chip-*）`);
}

/* ══════════════════════ B. 金额口径一致性 ══════════════════════ */
function checkMoneyConsistency() {
  console.log("\n[B] 金额口径一致性（上下文注入 vs 提示词约束）");
  let cloud = "";
  try { cloud = read("utils/cloud.js"); } catch (e) { ok("utils/cloud.js 可读", false); return; }

  // ① 上下文是否真的注入金额（若哪天不注入了，提示词里「如实复述」就成了空条款）
  const injectsBudget = /预算[:：]|已花|累计\s*¥|totalSpent|budgetGauge/.test(cloud);
  ok("上下文构造处仍在注入金额（预算/已花/累计）", injectsBudget,
    injectsBudget ? "" : "若已改为不注入，请同步删掉提示词里的「如实复述」条款，否则两处口径漂移");

  // ② 三处提示词必须同时具备「禁编造」与「允许如实复述」
  const jobs = [
    ["主包 utils/ai-agent.js", "utils/ai-agent.js"],
    ["分包 ai-prompts.js", "subpkg/assistant/ai-prompts.js"],
    ["云函数 GUARDRAIL", "tools/cloud/llmProxy/index.js"]
  ];
  for (const [label, rel] of jobs) {
    let txt = "";
    try { txt = read(rel); } catch (e) { ok(label + " 可读", false); continue; }
    const bans = /绝不编造或估算|不编造票价|不编造或估算票价/.test(txt);
    const allows = /如实复述/.test(txt);
    const noGold = /以\s*App\s*内对应页为准/.test(txt);
    ok(label + " 同时具备「禁编造报价 + 允许复述真实金额 + 兜底指引」", bans && allows && noGold,
      `禁编造=${bans ? "有" : "缺"} 允许复述=${allows ? "有" : "缺"} 兜底=${noGold ? "有" : "缺"}`);
  }

  // ③ 防呆：不能再出现「绝不输出任何金额」这种一刀切措辞（本轮 P0 的原句）
  for (const [, rel] of jobs) {
    let txt = "";
    try { txt = read(rel); } catch (e) { continue; }
    ok(path.basename(rel) + " 未回退为一刀切「绝不输出任何金额」", !/绝不输出任何(具体)?金额/.test(txt));
  }
}

/* ══════════════════════ C. 测试有效性 ══════════════════════ */
function checkTestValidity() {
  console.log("\n[C] 测试有效性（涉及存储语义的测试必须装 wx 垫片）");
  const dirs = ["tools/test", "tools/check", "tools/audit"];
  const bad = [], skipped = [];
  let scanned = 0, relevant = 0;
  // 判据（第一版写错过）：不是「凡加载 data.js 就要垫片」—— data.js 在 Node 有正常分支，
  // 实测无 wx 也能加载 751 城 / 438 条坐标，强制要求会制造 21 个假红。
  // 真正会「假通过」的是测存储语义的测试：它们必须读写 storage，没垫片就退化成空存储。
  const TOUCHES_STORAGE = /跨会话|持久化|落盘|getStorageSync|setStorageSync|learnPrefs|saveDraft|getDrafts|记账|草稿/;
  const LOADS_LOGIC = /require\([^)\n]{0,120}utils\/(store|data|travel)\.js["\']?\)|createRequire\([^)]*\)\([^)\n]{0,80}utils\/(store|data|travel)\.js/;
  const HAS_SHIM = /_wx-shim|installWxShim|globalThis\.wx\s*=|global\.wx\s*=|\bwx\s*:\s*wxMock/;

  for (const d of dirs) {
    const dir = path.join(ROOT, d);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir)) {
      if (!n.endsWith(".mjs") && !n.endsWith(".cjs")) continue;
      if (n.startsWith("_wx-shim")) continue;
      const txt = readFileSync(path.join(dir, n), "utf8");
      scanned++;
      const loads = LOADS_LOGIC.test(txt);
      if (!(loads && TOUCHES_STORAGE.test(txt))) { if (loads) skipped.push(n); continue; }
      relevant++;
      if (!HAS_SHIM.test(txt)) bad.push(d + "/" + n);
    }
  }
  ok("涉及存储语义的测试都装了 wx 垫片（否则在空存储上假通过）", bad.length === 0,
    bad.length ? bad.join("、") : `（扫 ${scanned} 个测试文件，其中 ${relevant} 个涉及存储语义）`);
  if (skipped.length) console.log(`  · 仅加载逻辑、不碰存储的 ${skipped.length} 个测试不强制垫片（data.js 在 Node 有正常分支）`);
}

/* ══════════════════════ D. 主题变量对称性 ══════════════════════ */
// 新增一个语义变量时几乎必然只写一套主题。若另一套没定义、使用处又没写兜底，
// 那个 var() 在另一主题下会解析成空 → 颜色/尺寸静默失效，而所有结构断言仍全绿。
// 实测已存在一处不对称（--acc-soft 只在暗色定义），靠调用处写了兜底才没翻车。
function checkThemeSymmetry() {
  console.log("\n[D] 主题变量对称性（浅色/暗色变量表）");
  const app = read("app.wxss");
  const blocks = cssBlocks(app);
  const lightVars = varMap(blocks.filter((b) => !/\.td\b/.test(b.selector)));
  const darkVars = varMap(blocks.filter((b) => /\.td\b/.test(b.selector)));
  // --fs 是页面级字号缩放（挂在 .page / .fz1-3），本就不分局，白名单放行
  const WHITELIST = new Set(["--fs"]);
  const onlyLight = Object.keys(lightVars).filter((k) => !(k in darkVars) && !WHITELIST.has(k));
  const onlyDark = Object.keys(darkVars).filter((k) => !(k in lightVars) && !WHITELIST.has(k));
  ok("两套主题定义同一组变量", onlyLight.length === 0 && onlyDark.length === 0,
    (onlyLight.length ? `仅浅色有：${onlyLight.join(",")}；` : "") + (onlyDark.length ? `仅暗色有：${onlyDark.join(",")}` : ""));

  // 即便不对称，只要所有调用处都写了兜底就不算故障；反之判红
  const files = ["app.wxss"];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n.startsWith(".")) continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".wxss")) files.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, "pages"));
  walk(path.join(ROOT, "subpkg"));

  const naked = [];
  for (const token of [...onlyLight, ...onlyDark]) {
    const re = new RegExp("var\\(\\s*" + token.replace(/-/g, "\\-") + "\\s*\\)");
    for (const f of files) {
      const txt = read(f);
      const hit = re.exec(txt);
      if (hit) naked.push(`${token} @ ${f}（var() 无兜底，另一主题下会失效）`);
    }
  }
  ok("不对称变量若存在，所有调用处都有兜底值", naked.length === 0, naked.join("；"));
}

checkContrast();
checkMoneyConsistency();
checkTestValidity();
checkThemeSymmetry();

console.log(fail === 0 ? "\n✅ 测控补充护栏全部通过" : `\n❌ 测控补充护栏失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
