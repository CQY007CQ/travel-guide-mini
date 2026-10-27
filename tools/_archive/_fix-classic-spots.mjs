// v1.19.9 真实体验修复 ①：远郊头号景点被「就近优化」永久跳过
//
// 现象（真实跑出来的）：太原 3 天行程 = 关帝庙/钟楼街/纯阳宫/观汾/五一广场/大关帝庙/天主教堂，
// 而池子里排第 1 的晋祠、第 2 的山西博物院、第 5 的双塔寺一次都没出现（8 次生成 0 命中）。
// 用户视角：去太原三天竟然不去晋祠 —— 这份攻略不可信。
//
// 根因：nearest() 里 `isFar = 距市中心 > 25km`，远郊景点只有在「市区候选 ≤1 且远郊 ≥2」时才启用。
// 太原市区景点 68 个，urbanCount 永远 > 1 → 晋祠（晋源区，~25km）永远进不了行程。
// 这是「只顾动线短、不管该不该去」的问题。
//
// 修法：pool 的顺序即编辑精选顺序（越靠前越经典）。给前 6 名一个距离折扣，让经典景点
// 即使略远也能压过市中心的小景点；取走后 cursor 移到远郊，会自然把同方向景点（天龙山、
// 蒙山）聚成「远郊一日游」，其余天仍是市区，动线依旧合理。
import fs from "fs";

const file = "tools/_src-backup/planner.js";
let s = fs.readFileSync(file, "utf8");

const edits = [
  {
    // 1) 在就近优化开始前，给 pool 标注精选名次
    from: `  const cityAnchor = getCoord(city.name); // 市中心锚点（代表酒店/抵达地）`,
    to: `  // v1.19.9：记录「编辑精选名次」。pool 的顺序代表景点重要度（越靠前越经典），
  // 后面 nearest() 会据此给经典景点距离折扣，避免远郊头号景点被就近优化永久跳过。
  pool.forEach((e, i) => { if (e && typeof e === "object" && e._rank === undefined) e._rank = i; });
  const cityAnchor = getCoord(city.name); // 市中心锚点（代表酒店/抵达地）`,
    why: "标注精选名次 _rank"
  },
  {
    // 2) nearest 里对前 6 名给距离折扣
    from: `    d += biasEff(e.name); // v1.15 攻略风格偏好（历史/自然）`,
    to: `    d += biasEff(e.name); // v1.15 攻略风格偏好（历史/自然）
    // v1.19.9：经典必去加权。池子前 6 名是当地最该去的地方，给距离折扣让它们优先入选，
    // 否则纯按距离取点会把远郊头号景点（如太原晋祠）永久排除在行程外。
    if (typeof e._rank === "number" && e._rank < 6) d -= 300;`,
    why: "前 6 名经典景点距离折扣"
  }
];

let ok = 0, skip = 0;
for (const e of edits) {
  const n = s.split(e.from).length - 1;
  if (n !== 1) { console.log(`命中 ${n} 次(期望1) → 跳过: ${e.why}`); skip++; continue; }
  s = s.replace(e.from, e.to);
  console.log("✓", e.why);
  ok++;
}
fs.writeFileSync(file, s, "utf8");
console.log(`\n完成：${ok} 处成功，${skip} 处跳过`);
process.exit(skip > 0 ? 1 : 0);
