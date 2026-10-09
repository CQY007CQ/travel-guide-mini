// P1 批：动线优化建议 / 高光时刻标记 / 错峰提示 / 行李清单增强 —— 追加到 travel.js
import fs from "fs";

const F = "tools/_src-backup/travel.js";
let s = fs.readFileSync(F, "utf8");

const block = `
/* ============ 新功能 P1（v1.19.13+） ============ */
const _km2 = (a, b) => {
  const R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// 动线优化建议：找出每天跨度过大的相邻对，给出换序/拆天建议
function routeAdvicePlus(plan) {
  const out = [];
  try {
    const days = Array.isArray(plan && plan.days) ? plan.days : [];
    const cn = plan && plan.cityName;
    days.forEach((d, di) => {
      const items = (d && d.items) || [];
      const real = items.filter(it => {
        const n = String(it.name || "");
        return n.length >= 3 && !/^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|深度游览|继续)/.test(n)
          && !/自由活动|自由探索|休整|早餐|晚餐|馆子|夜市|小吃|美食|散步|看演出|看音乐剧|看歌剧|看相声|看演艺/.test(n);
      });
      for (let i = 0; i + 1 < real.length; i++) {
        const a = P.getSpotCoord(cn || "", real[i].name);
        const b = P.getSpotCoord(cn || "", real[i + 1].name);
        if (a && b && a.lat && b.lat) {
          const km = _km2(a, b);
          if (km > 25) out.push({ day: di + 1, from: real[i].name, to: real[i + 1].name, km: Math.round(km), tip: "建议把较远的那个点挪到专门的一天，或与同方向景点合并" });
        }
      }
    });
  } catch (e) {}
  return out;
}

// 高光时刻标记：用 spotTiming 为每天挑出最佳出片/体验点
function highlightOf(plan) {
  const out = [];
  try {
    const days = Array.isArray(plan && plan.days) ? plan.days : [];
    days.forEach((d, di) => {
      const items = (d && d.items) || [];
      const real = items.filter(it => {
        const n = String(it.name || "");
        return n.length >= 3 && !/^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|深度游览|继续)/.test(n);
      });
      const picked = real.find(it => {
        const t = typeof spotTiming === "function" ? spotTiming(it.name) : null;
        return t && t.best;
      }) || real[0];
      if (picked) {
        const t = typeof spotTiming === "function" ? spotTiming(picked.name) : null;
        out.push({ day: di + 1, name: picked.name, best: (t && t.best) || "全天", tip: (t && t.tip) || "顺路安排即可" });
      }
    });
  } catch (e) {}
  return out;
}

// 错峰提示：法定节假日 + 周末对热门景点给提示（静态规则）
const _HOLIDAYS = { "01-01": "元旦", "02-10": "春节", "04-05": "清明", "05-01": "五一", "06-10": "端午", "09-15": "中秋", "10-01": "国庆" };
function crowdTipOf(dateStr) {
  const d = String(dateStr || "");
  const md = d.slice(5, 10);
  const hol = _HOLIDAYS[md] || "";
  try {
    const dt = new Date(d + "T00:00:00");
    const wd = dt.getDay();
    const isWeekend = wd === 0 || wd === 6;
    if (hol) return { level: "高", txt: hol + "假期人流量大，热门景点建议提前预约、错开上午 10 点前入场" };
    if (isWeekend) return { level: "中", txt: "周末市区景点人流较多，热门点建议赶早" };
    return { level: "低", txt: "工作日出行，人流友好" };
  } catch (e) { return { level: "-", txt: "" }; }
}

// 行李清单增强：在 packSmart 基础上按行程特色追加项目（返回追加数组）
function packExtra(plan) {
  const add = [];
  try {
    const days = Array.isArray(plan && plan.days) ? plan.days : [];
    const names = [];
    days.forEach(d => (d.items || []).forEach(it => names.push(String(it.name || ""))));
    const all = names.join(" ");
    if (/山|峰|岭|栈道|徒步|登山|长城|峡谷|索道/.test(all)) add.push("登山鞋/防滑鞋");
    if (/海|海滩|岛|沙滩|海滨|浴场/.test(all)) add.push("泳衣/防晒/人字拖");
    if (/温泉/.test(all)) add.push("泳衣（温泉用）");
    if (/滑雪|冰雪/.test(all)) add.push("保暖手套/帽子/雪镜");
    if (/沙漠|戈壁/.test(all)) add.push("防风面巾/墨镜/润唇膏");
    if (/高原|海拔|拉萨|稻城|香格里拉|玉龙/.test(all)) add.push("红景天/润喉糖/防晒帽");
    if (/博物馆|美术馆|展览|演出|剧场|剧院/.test(all)) add.push("薄外套（室内空调冷）");
    if (/夜市|小吃街|美食/.test(all)) add.push("肠胃药/健胃消食片");
    if (/漂流|水上乐园/.test(all)) add.push("手机防水袋/速干衣");
  } catch (e) {}
  return add;
}
`;

const anchor = "module.exports = {";
const n = s.split(anchor).length - 1;
if (n !== 1) { console.log("✗ anchor 命中 " + n); process.exit(1); }
s = s.replace(anchor, block + "\n" + anchor);

const expFrom = "module.exports = {\n ready, planCheckup, swapSpotFor, askTrip,";
const expTo = "module.exports = {\n ready, planCheckup, swapSpotFor, askTrip,\n routeAdvicePlus, highlightOf, crowdTipOf, packExtra,";
const n2 = s.split(expFrom).length - 1;
if (n2 !== 1) { console.log("✗ exports 命中 " + n2); process.exit(1); }
s = s.replace(expFrom, expTo);
fs.writeFileSync(F, s, "utf8");
console.log("✓ P1 四函数已写入并导出");
