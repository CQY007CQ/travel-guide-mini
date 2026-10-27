// 想玩清单（wish）命中误配：原实现是「任意子串互相包含」，
// 于是勾了「西湖」，北京的「龙潭西湖公园」也被判为命中并排进行程第一天。
// 改为：① 名称相等 ② 一方是另一方的前缀（故宫 → 故宫博物院）
//       ③ 组合名（「天安门广场 + 故宫博物院」）拆分后某一段满足 ①②。
// travel.js 与 planner.js 各自持有一份（两模块不做循环依赖）。
import fs from "fs";

const segFn = ` const _seg = (s) => String(s || "").split(/[+＋/、·,，]/).map(v => v.trim()).filter(v => v.length >= 2);`;

const edits = [
  {
    file: "tools/_src-backup/travel.js",
    from: `function _wishNameHit(n, wn) {
 if (!n || !wn) return false;
 if (n === wn) return true;
 if (wn.length >= 2 && n.indexOf(wn) >= 0) return true;  // wn ⊂ n（勾了故宫 → 命中合并条目）
 if (n.length >= 2 && wn.indexOf(n) >= 0) return true;  // n ⊂ wn（勾了合并整条 → 命中拆分条目）
 return false;
}`,
    to: `function _wishNameHit(n, wn) {
 if (!n || !wn) return false;
 if (n === wn) return true;
 // v1.19.9：不再用「任意子串互相包含」判命中——勾「西湖」会把北京的「龙潭西湖公园」也算命中。
 // 改为：前缀命中（故宫 → 故宫博物院），或组合名拆分后某一段前缀命中（天安门广场 + 故宫博物院 ← 故宫）。
${segFn}
 const ns = _seg(n), ws = _seg(wn);
 for (const x of ns) for (const y of ws) {
  if (x === y) return true;
  if (x.indexOf(y) === 0 || y.indexOf(x) === 0) return true;
 }
 return false;
}`,
  },
  {
    file: "tools/_src-backup/planner.js",
    from: ` return w.some(x => {
  const wn = cleanSpotName(x.name);
  if(!wn) return false;
  if(wn === n) return true;
  if(wn.length >= 2 && n.indexOf(wn) >= 0) return true;
  if(n.length >= 2 && wn.indexOf(n) >= 0) return true;
  return false;
 });`,
    to: ` // 与 travel.js 的 _wishNameHit 同规则：前缀命中 / 组合名分段命中，
 // 不再用「任意子串互相包含」（否则勾「西湖」会命中北京的「龙潭西湖公园」）。
${segFn}
 return w.some(x => {
  const wn = cleanSpotName(x.name);
  if(!wn) return false;
  if(wn === n) return true;
  const ns = _seg(n), ws = _seg(wn);
  for(const a of ns) for(const b of ws){
   if(a === b) return true;
   if(a.indexOf(b) === 0 || b.indexOf(a) === 0) return true;
  }
  return false;
 });`,
  },
];

let ok = true;
const results = [];
for (const [k, ed] of edits.entries()) {
  let s = fs.readFileSync(ed.file, "utf8");
  const n = s.split(ed.from).length - 1;
  if (n !== 1) { console.log("✗ 第" + (k + 1) + " 处（" + ed.file + "）命中 " + n + " 次，放弃"); ok = false; break; }
  results.push([ed.file, s.replace(ed.from, ed.to)]);
}
if (ok) { for (const [f, c] of results) fs.writeFileSync(f, c, "utf8"); console.log("✓ 想玩命中规则已收紧（travel + planner）"); }
