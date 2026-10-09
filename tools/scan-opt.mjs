// v1.11 优化点实证扫描器 v2 —— 只读
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/miniprogram-travel';
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGES = fs.readdirSync(path.join(ROOT, 'pages')).filter(d => !d.startsWith('.'));
const list = (p, ext) => fs.readdirSync(path.join(ROOT, p)).filter(f => f.endsWith(ext)).map(f => p + '/' + f);

const allJs = ['app.js', 'utils/travel.js', 'utils/planner.js', 'utils/store.js', 'utils/weather.js'];
const allWxml = [], allWxss = ['app.wxss'], allJson = [];
for (const p of PAGES) {
  allJs.push(...list('pages/' + p, '.js'));
  allWxml.push(...list('pages/' + p, '.wxml'));
  allWxss.push(...list('pages/' + p, '.wxss'));
  allJson.push(...list('pages/' + p, '.json'));
}
const SRC = {};
for (const f of [...allJs, ...allWxml, ...allWxss, ...allJson]) SRC[f] = R(f);

const issues = [];
const add = (cat, sev, where, what) => issues.push({ cat, sev, where, what });

// ─── A. WXSS 未引用类（精确：解析 wxml class 属性 + js 字符串） ───
const classTokens = new Set();
for (const f of allWxml) {
  for (const m of SRC[f].matchAll(/class="([^"]*)"/g))
    m[1].split(/\s+/).filter(Boolean).forEach(t => { if (!t.includes('{{')) classTokens.add(t); });
}
const jsStrAll = allJs.map(f => SRC[f]).join('\n');
const wxmlAll = allWxml.map(f => SRC[f]).join('\n');
// v1.11 修正：动态拼接的类名（class="band-{{item.bandKey}}" / "fz{{fz}}" / "l{{...}}" / "e{{...}}"）
// 光看静态 token 会误判成死代码并删掉——那是运行期真会用到的样式。
// 收集 class 里形如「前缀{{」的前缀，凡以它开头的类一律视为已引用（宁可少报，不可错删）。
const dynPrefix = [];
for (const m of wxmlAll.matchAll(/class="([^"]*)"/g)) {
  for (const t of m[1].split(/\s+/)) {
    const i = t.indexOf('{{');
    if (i > 0) dynPrefix.push(t.slice(0, i));
  }
}
const isDyn = (c) => dynPrefix.some(p => c.startsWith(p));
for (const f of allWxss) {
  const declared = new Set();
  // v1.11 修正：先剥掉 /* ... */ 注释——注释里写的 ".timeline/.wm-it" 不是真声明，
  // 否则删完样式后注释还在，扫描器会一直误报。
  const css = SRC[f].replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) declared.add(m[1]);
  for (const c of declared) {
    if (['page', 'td', 'before', 'after', 'hover', 'active', 'first', 'last'].includes(c)) continue;
    if (classTokens.has(c)) continue;
    if (isDyn(c)) continue;   // v1.11：动态拼接类名，不能当死代码删
    // 条件类名常写在 {{}} 内，用带边界的全文搜索兜底
    const b = new RegExp('(?<![a-zA-Z0-9_\\-])' + c.replace(/[-]/g, '\\-') + '(?![a-zA-Z0-9_\\-])');
    if (b.test(wxmlAll)) continue;
    if (jsStrAll.includes(`'${c}'`) || jsStrAll.includes(`"${c}"`)) continue;
    // 组合选择器中被引用（如 .a .b）不算孤儿
    const comb = new RegExp(`\\.[\\w-]+\\s+\\.${c.replace(/-/g, '\\-')}[\\s,{:.>]`);
    const combAll = allWxss.map(x => comb.test(SRC[x])).some(Boolean);
    add('死代码', combAll ? 'P3' : 'P2', f, `未引用类 .${c}${combAll ? '（仅组合选择器）' : ''}`);
  }
}

// ─── B. wx:for 缺 wx:key ──────────────────────────────────────
for (const f of allWxml) {
  SRC[f].split('\n').forEach((ln, i) => {
    if (/wx:for=/.test(ln) && !/wx:key=/.test(ln) && !/wx:for-index/.test(ln))
      add('性能', 'P1', `${f}:${i + 1}`, `wx:for 缺 wx:key（列表重渲染全量 diff）: ${ln.trim().slice(0, 70)}`);
  });
}

// ─── C. 同节点 wx:if + wx:for ─────────────────────────────────
for (const f of allWxml) {
  SRC[f].split('\n').forEach((ln, i) => {
    if (/wx:for=/.test(ln) && /wx:if=/.test(ln))
      add('性能', 'P2', `${f}:${i + 1}`, `同节点 wx:for+wx:if，应用 <block> 拆开`);
  });
}

// ─── D. 循环内 storage 读写 / JSON 深拷贝 ──────────────────────
for (const f of allJs) {
  const lines = SRC[f].split('\n');
  let brace = 0, loopStart = -1;
  lines.forEach((ln, i) => {
    if (/(\bfor\s*\(|\.forEach\(|\.map\(|\.filter\()/.test(ln) && loopStart < 0) { loopStart = i; brace = 0; }
    if (loopStart >= 0) {
      brace += (ln.match(/\{/g) || []).length - (ln.match(/\}/g) || []).length;
      if (/(getStorageSync|setStorageSync|JSON\.parse\(JSON\.stringify)/.test(ln) && i > loopStart)
        add('性能', 'P1', `${f}:${i + 1}`, `循环内 storage/深拷贝: ${ln.trim().slice(0, 70)}`);
      if (brace <= 0 && i > loopStart) loopStart = -1;
    }
  });
}

// ─── E. 页面 onShow/onLoad 缺异常防护（精确取函数体） ────────────
for (const f of allJs.filter(x => x.startsWith('pages/'))) {
  const s = SRC[f];
  ['onLoad', 'onShow', 'onReady'].forEach(hk => {
    const re1 = new RegExp('(^|\\n)\\s*' + hk + '\\s*\\([^)]*\\)\\s*\\{', 'm');
    const m = s.match(re1);
    if (!m) return;
    const start = s.indexOf(m[0]) + m[0].length;
    // 括号配平
    let d = 1, i = start;
    while (i < s.length && d > 0) { if (s[i] === '{') d++; else if (s[i] === '}') d--; i++; }
    const body = s.slice(start, i);
    if (body.length > 40 && !/try\s*\{/.test(body))
      add('健壮性', 'P1', f, `${hk} 无 try/catch（${body.split('\n').length} 行，抛错即白屏）`);
  });
}

// ─── F. WXML 内联 style ───────────────────────────────────────
for (const f of allWxml) {
  SRC[f].split('\n').forEach((ln, i) => {
    const m = ln.match(/style="([^"]{10,})"/);
    if (m && !/\{\{/.test(m[1])) add('UI', 'P2', `${f}:${i + 1}`, `内联 style 应抽类: ${m[1].slice(0, 55)}`);
  });
}

// ─── G. WXML 嵌套过深 ─────────────────────────────────────────
for (const f of allWxml) {
  let depth = 0, max = 0, at = 0;
  SRC[f].split('\n').forEach((ln, i) => {
    const o = (ln.match(/<(view|scroll-view|swiper|cover-view)\b/g) || []).length;
    const c = (ln.match(/<\/(view|scroll-view|swiper|cover-view)>/g) || []).length;
    depth += o - c; if (depth < 0) depth = 0;
    if (depth > max) { max = depth; at = i + 1; }
  });
  if (max >= 8) add('UI', 'P1', `${f}:${at}`, `view 嵌套深度 ${max}（>7 难维护/渲染慢）`);
}

// ─── H. 超长函数（顶格 2 空格方法，排除控制流关键字） ─────────────
for (const f of allJs) {
  const s = SRC[f], lines = s.split('\n');
  const CTRL = /^(if|for|while|switch|else|try|catch|function|return|do)\b/;
  let start = -1, name = '', d = 0;
  lines.forEach((ln, i) => {
    if (start < 0) {
      const m = ln.match(/^(\s{2})([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/);
      if (m && !CTRL.test(m[2])) { start = i; name = m[2]; d = 1; }
      return;
    }
    d += (ln.match(/\{/g) || []).length - (ln.match(/\}/g) || []).length;
    if (d <= 0) {
      if (i - start > 110) add('可维护性', 'P2', `${f}:${start + 1}`, `函数 ${name} 长 ${i - start + 1} 行`);
      start = -1;
    }
  });
}

// ─── I. console.* / TODO ─────────────────────────────────────
for (const f of allJs) {
  SRC[f].split('\n').forEach((ln, i) => {
    if (/console\.(log|warn|error|info)/.test(ln) && !/^\s*\/\//.test(ln))
      add('清理', 'P3', `${f}:${i + 1}`, ln.trim().slice(0, 75));
    if (/\/\/\s*(TODO|FIXME|XXX|HACK)/.test(ln)) add('清理', 'P3', `${f}:${i + 1}`, ln.trim().slice(0, 70));
  });
}

// ─── J. 硬编码主题色（浅色写死在共享组件里） ────────────────────
const HARD = /(?:background|background-color|color|border-color)\s*:\s*(?:#(?:fff|f8f8f8|f5f5f5|eee|ddd|000|333)\b|rgba?\(\s*(?:255\s*,\s*255\s*,\s*255|0\s*,\s*0\s*,\s*0))/i;
for (const f of allWxss) {
  SRC[f].split('\n').forEach((ln, i) => {
    if (/--[\w-]+\s*:/.test(ln)) return;
    if (/^\s*(page|\.td)\s*\{/.test(ln)) return;
    if (HARD.test(ln)) add('主题', 'P2', `${f}:${i + 1}`, ln.trim().slice(0, 85));
  });
}

// ─── K. 未被调用的 travel.js 导出 ──────────────────────────────
const tj = R('utils/travel.js');
const expIdx = tj.lastIndexOf('module.exports');
const expBlock = tj.slice(expIdx);
const expNames = [...new Set([...expBlock.matchAll(/(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*(?:,|\s*$|:)/gm)].map(m => m[1]))]
  .filter(n => /^[a-z]/.test(n) && !['module', 'exports', 'require'].includes(n));
const bodyAndCallers = tj.slice(0, expIdx) + '\n' + allJs.filter(x => x !== 'utils/travel.js').map(x => SRC[x]).join('\n');
expNames.forEach(n => {
  const re = new RegExp(`\\b${n}\\s*\\(`);
  if (!(re.test(bodyAndCallers))) add('死代码', 'P3', 'utils/travel.js', `导出未被调用: ${n}()`);
});

// ─── L. 数据层体检 ───────────────────────────────────────────
const mod = await import('file://' + path.join(ROOT, 'utils/data.js'));
const data = mod.default || mod; const data2 = data.D || data;
const CITIES = data2.CITIES || [];
const SC = data2.SPOT_COORDS || {};
CITIES.forEach(c => { if (!SC[c.name]) add('数据', 'P1', 'utils/data.js', `城市「${c.name}」SPOT_COORDS 无条目`); });
if (data2.CITY_COORDS) CITIES.forEach(c => { if (!data2.CITY_COORDS[c.name]) add('数据', 'P1', 'utils/data.js', `城市「${c.name}」缺 CITY_COORDS`); });
if (data2.CITY2PROV) CITIES.forEach(c => { if (!data2.CITY2PROV[c.name]) add('数据', 'P2', 'utils/data.js', `城市「${c.name}」缺 CITY2PROV`); });
const nc = new Map(); CITIES.forEach(c => nc.set(c.name, (nc.get(c.name) || 0) + 1));
[...nc].filter(([, n]) => n > 1).forEach(([n]) => add('数据', 'P0', 'utils/data.js', `重复城市名「${n}」`));
CITIES.forEach(c => {
  const s = new Map(); (c.spots || []).forEach(x => s.set(x, (s.get(x) || 0) + 1));
  [...s].filter(([, n]) => n > 1).forEach(([x]) => add('数据', 'P2', 'utils/data.js', `${c.name} 景点重复「${x}」`));
  if (!(c.experiences || []).length) add('数据', 'P2', 'utils/data.js', `${c.name} experiences 为空`);
});
Object.entries(SC).forEach(([city, arr]) => (arr || []).forEach(([nm, la, lo]) => {
  if (typeof la !== 'number' || typeof lo !== 'number') add('数据', 'P0', 'utils/data.js', `${city}·${nm} 坐标非数字`);
  else if (city === '三沙' ? (la < 15 || la > 18 || lo < 110 || lo > 114) : (la < 17 || la > 54 || lo < 73 || lo > 136)) add('数据', 'P0', 'utils/data.js', `${city}·${nm} 坐标越界 ${la},${lo}`);
}));

// ─── M. 未被引用的图片 ────────────────────────────────────────
const imgs = fs.readdirSync(path.join(ROOT, 'images')).filter(f => /\.(png|jpg|jpeg|svg)$/i.test(f));
const allText = Object.values(SRC).join('\n') + R('app.json');
imgs.forEach(f => {
  const re = new RegExp(`images/${f.replace(/[.[\]]/g, '\\$&')}`);
  if (!re.test(allText)) {
    const base = f.replace(/\.(png|jpg|jpeg)$/i, '');
    const dyn = new RegExp(`['"\`][^'"\`]*${base}[^'"\`]*['"\`]`);
    if (!dyn.test(allText)) add('包体', 'P3', `images/${f}`, `未被引用（可删 ${(fs.statSync(path.join(ROOT, 'images', f)).size / 1024).toFixed(1)}KB）`);
  }
});

// ─── N. WXML 复杂表达式（应在 JS 预计算） ───────────────────────
for (const f of allWxml) {
  SRC[f].split('\n').forEach((ln, i) => {
    for (const m of ln.matchAll(/\{\{([^}]{18,})\}\}/g)) {
      const e = m[1];
      // v1.11 修正：WXML 单层三元（a ? 'x' : 'y'）是框架原生写法，搬到 JS 反而增加 setData
      // 字段与传输量，收益为负。只有「嵌套三元 / 方法调用 / 字符串拼接」才值得预计算。
      const qn = (e.match(/\?/g) || []).length;
      const heavy = /\.toFixed\(|\.split\(|\.slice\(|\.replace\(|\.join\(|\.map\(|\.filter\(/.test(e);
      const concat = /['"][^'"]*['"]\s*\+|\+\s*['"]/.test(e);
      const nested = qn >= 2;
      // 注：循环内（wx:for）每行都要重算一遍，是优先搬走的高价值项；
      // 非循环区的嵌套三元一次渲染只算一次，搬走反而要在多处 setData 同步，需人工判断。
      if (heavy || concat || nested)
        add('性能', nested ? 'P1' : 'P2', `${f}:${i + 1}`,
          `{{}} 内${nested ? '嵌套三元' : heavy ? '方法调用' : '字符串拼接'}（应在 JS 预计算）: ${e.slice(0, 50)}`);
    }
  });
}

// ─── O. 页面 data 字段未在 wxml 使用 ───────────────────────────
for (const p of PAGES) {
  const jf = `pages/${p}/${p}.js`, wf = `pages/${p}/${p}.wxml`;
  if (!SRC[jf] || !SRC[wf]) continue;
  const dm = SRC[jf].match(/\n\s*data\s*:\s*\{/);
  if (!dm) continue;
  const st = SRC[jf].indexOf(dm[0]) + dm[0].length;
  let dd = 1, k = st;
  while (k < SRC[jf].length && dd > 0) { if (SRC[jf][k] === '{') dd++; else if (SRC[jf][k] === '}') dd--; k++; }
  const dataBlock = SRC[jf].slice(st, k);
  const fields = [...dataBlock.matchAll(/^\s{4}([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]);
  const w = SRC[wf];
  fields.forEach(f2 => {
    if (['theme', 'td'].includes(f2)) return;
    const b = new RegExp('(?<![a-zA-Z0-9_$])' + f2 + '(?![a-zA-Z0-9_$])');
    if (!b.test(w) && !b.test(SRC[jf].slice(k))) add('死代码', 'P3', jf, `data 字段 ${f2} 未在 wxml/js 使用`);
  });
}

// ─── P. 跨文件重复 helper（同名单函数实现重复） ──────────────────
const fnSig = {};
for (const f of allJs) {
  for (const m of SRC[f].matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g)) {
    (fnSig[m[1]] = fnSig[m[1]] || []).push(f);
  }
}
Object.entries(fnSig).filter(([, fs2]) => new Set(fs2).size > 1)
  .forEach(([n, fs2]) => add('重复', 'P2', [...new Set(fs2)].join(' + '), `同名函数 ${n}() 在多文件重复定义`));

// ─── Q. app.json 冗余 / 页面 json 空壳 ─────────────────────────
for (const f of allJson) {
  const o = JSON.parse(SRC[f]);
  const keys = Object.keys(o);
  if (keys.length === 0) add('清理', 'P3', f, `页面 json 空壳，可删除文件`);
  if (o.usingComponents && Object.keys(o.usingComponents).length === 0) add('清理', 'P3', f, `usingComponents 为空对象`);
}

// ─── 输出 ────────────────────────────────────────────────────
const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
issues.sort((a, b) => order[a.sev] - order[b.sev] || a.cat.localeCompare(b.cat));
const byCat = {};
issues.forEach(i => (byCat[i.cat] = byCat[i.cat] || []).push(i));
console.log('\n══════ 扫描结果（共 ' + issues.length + ' 处）══════');
let n = 0;
for (const [c, l] of Object.entries(byCat).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n【${c}】${l.length} 处`);
  l.slice(0, 60).forEach(i => { n++; console.log(`  ${String(n).padStart(3)}. [${i.sev}] ${i.where}  ${i.what}`); });
  if (l.length > 60) console.log(`  … 另 ${l.length - 60} 处`);
}
console.log('\n图片数 ' + imgs.length + '，城市 ' + CITIES.length + '，坐标城 ' + Object.keys(SC).length);
