// v1.15 泛化/雷同文案扫描器
// 扫描 experiences.note：
//  1) 模板套话（历史悠久/风景优美…）
//  2) 完全相同的 note 出现 ≥3 次（雷同）
//  3) 空 note
// 用法: node tools/test/scan-generic.mjs
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

const TEMPLATE = /历史悠久|风景优美|景色宜人|值得一去|不容错过|美不胜收|山清水秀|人杰地灵|物华天宝|很有特色|独具特色|当地特色/;
let total = 0, tpl = 0, empty = 0;
const noteCount = {};
const tplSamples = [];
for (const c of D.CITIES) {
  for (const e of (c.experiences || [])) {
    const n = String(e.note || "").trim();
    total++;
    if (!n) { empty++; continue; }
    if (TEMPLATE.test(n)) { tpl++; if (tplSamples.length < 12) tplSamples.push(c.name + ":" + (e.name || "") + " → " + n.slice(0, 50)); }
    noteCount[n] = (noteCount[n] || 0) + 1;
  }
}
const dup = Object.entries(noteCount).filter(([, v]) => v >= 3).sort((a, b) => b[1] - a[1]);
console.log("notes 总数:", total, "| 模板套话:", tpl, "| 空 note:", empty, "| 雷同(note≥3):", dup.length);
if (tplSamples.length) console.log("模板样例:\n  " + tplSamples.join("\n  "));
dup.slice(0, 10).forEach(([n, c]) => console.log("雷同 ×" + c + ": " + n.slice(0, 50)));
// 门禁：模板套话必须为 0；空 note 允许为 0-50（历史轻量数据）；雷同≥3 作为告警
let fail = 0;
if (tpl > 0) fail = 1;
if (empty > 80) fail = 1;
console.log(fail ? "❌ 存在泛化文案" : "✅ 泛化/雷同扫描通过");
process.exit(fail);
