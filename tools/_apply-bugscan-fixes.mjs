// v1.19.22 全盘大扫描修复：
// 1) ledger.js 三类 picker 取值（分类 / 外币 from / 外币 to）按 Number(e.detail.value)
//    直接取下标，越界会写 undefined → addLedger 分类为 undefined。加边界守卫。
// 2) index.js generate() 加生成中锁，避免 loading 态下重复点按叠加生成。
// 3) index.js onBudgetChange 加档位边界守卫。
// 每条替换必须恰好命中 1 次，否则整体放弃写入（原子）。
import fs from "fs";

const edits = [
  {
    file: "subpkg/ledger/ledger.js",
    from: "  onCatChange(e) { this.setData({ cat: this.data.cats[Number(e.detail.value)] }); },",
    to: "  onCatChange(e) { const i = Number(e.detail.value); if (i >= 0 && i < this.data.cats.length) this.setData({ cat: this.data.cats[i] }); },",
    why: "分类 picker 越界守卫：避免 cat 被置为 undefined"
  },
  {
    file: "subpkg/ledger/ledger.js",
    from: "  onFxFrom(e) { this.setData({ fxFrom: this.data.fxList[Number(e.detail.value)] }); this._calcFx(); },",
    to: "  onFxFrom(e) { const i = Number(e.detail.value); if (i >= 0 && i < this.data.fxList.length) { this.setData({ fxFrom: this.data.fxList[i] }); this._calcFx(); } },",
    why: "外币 from picker 越界守卫"
  },
  {
    file: "subpkg/ledger/ledger.js",
    from: "  onFxTo(e) { this.setData({ fxTo: this.data.fxList[Number(e.detail.value)] }); this._calcFx(); }",
    to: "  onFxTo(e) { const i = Number(e.detail.value); if (i >= 0 && i < this.data.fxList.length) { this.setData({ fxTo: this.data.fxList[i] }); this._calcFx(); } }",
    why: "外币 to picker 越界守卫"
  },
  {
    file: "pages/index/index.js",
    from: "  generate() {\n    if (!this.data.depart || this.data.depart < this.data.departMin) {",
    to: "  generate() {\n    if (this.data.loading) return;\n    if (!this.data.depart || this.data.depart < this.data.departMin) {",
    why: "生成中锁：loading 态禁止重复点按叠加生成"
  },
  {
    file: "pages/index/index.js",
    from: "  onBudgetChange(e) {\n    const i = Number(e.detail.value);\n    this.setData({ budgetIdx: i, showCustom: this.data.budgetKeys[i] === \"custom\" });\n    this._syncAdv();\n  },",
    to: "  onBudgetChange(e) {\n    const i = Number(e.detail.value);\n    if (i < 0 || i >= this.data.budgetKeys.length) return;\n    this.setData({ budgetIdx: i, showCustom: this.data.budgetKeys[i] === \"custom\" });\n    this._syncAdv();\n  },",
    why: "预算档位 picker 越界守卫"
  }
];

let ok = 0, fail = 0;
for (const e of edits) {
  if (!fs.existsSync(e.file)) { console.log("跳过（文件不存在）:", e.file); fail++; continue; }
  const s = fs.readFileSync(e.file, "utf8");
  const n = s.split(e.from).length - 1;
  if (n !== 1) { console.log("命中", n, "次（期望 1）→ 跳过:", e.file, "|", e.why); fail++; continue; }
  fs.writeFileSync(e.file, s.replace(e.from, e.to), "utf8");
  console.log("已修复:", e.file, "|", e.why);
  ok++;
}
console.log(`\n完成：${ok} 处成功，${fail} 处跳过`);
process.exit(fail > 0 ? 1 : 0);
