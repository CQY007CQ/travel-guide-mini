// 真实用户体验巡检：批量生成行程，检查用户一眼能看出的毛病。
global.wx = { getStorageSync: () => "", setStorageSync: () => {}, removeStorageSync: () => {}, showToast: () => {} };
const T = require("../utils/travel.js");

const CITIES = ["太原","北京","上海","广州","深圳","成都","杭州","西安","南京","重庆","武汉","长沙","青岛","厦门","昆明","贵阳","哈尔滨","长春","沈阳","大连","天津","苏州","无锡","宁波","福州","合肥","郑州","济南","石家庄","南昌","南宁","海口","兰州","西宁","银川","乌鲁木齐","拉萨","呼和浩特","三亚","桂林"];

const ORDER = ["凌晨","清晨","早上","上午","中午","下午","傍晚","晚上","深夜","夜间","全天"];
const idx = s => { const i = ORDER.indexOf(s); return i < 0 ? 99 : i; };

const bad = { 占位符: [], 重复景点: [], 空日: [], 时段倒挂: [], 预算异常: [], 建造失败: [] };

for (const nm of CITIES) {
  for (const days of [1, 2, 3, 5]) {
    let c;
    try { c = T.findCity(nm); } catch (e) { bad.建造失败.push(nm + " findCity 抛错 " + e.message); continue; }
    if (!c) { bad.建造失败.push(nm + " 未找到城市"); continue; }
    let plan;
    try {
      plan = T.buildPlan({ city: c, days, depart: "2026-10-01", pace: days >= 5 ? "relax" : "balance" });
    } catch (e) { bad.建造失败.push(nm + "/" + days + "天 buildPlan 抛错: " + e.message); continue; }
    if (!Array.isArray(plan)) { bad.建造失败.push(nm + " 返回非数组"); continue; }

    const seen = new Map();
    plan.forEach((d, di) => {
      const items = (d.items || []);
      if (!items.length) { bad.空日.push(nm + "/" + days + "天 D" + (di + 1)); }
      let last = -1;
      items.forEach(it => {
        const name = String(it.name || "");
        const note = String(it.note || "");
        // 1) 占位符 / 空值残留
        if (/undefined|NaN|null|\[object/.test(name + " " + note)) {
          bad.占位符.push(nm + "/" + days + "天 D" + (di + 1) + " " + (name || note).slice(0, 60));
        }
        // 2) 同日重复景点
        const key = name.replace(/^(抵达 \+ 直奔|出发前往|深度游览|继续深度游览|继续游览 \+ 登山\/索道上行)、?「?|」?$/g, "");
        if (key.length >= 2 && !/抵达|退房|入住|返程|早餐|午餐|晚餐|自由活动|留白|休整|美食/.test(key)) {
          seen.set(key, (seen.get(key) || 0) + 1);
        }
        // 3) 时段倒挂
        const k = idx(it.period);
        if (k !== 99 && k !== 9 && k < last) {
          bad.时段倒挂.push(nm + "/" + days + "天 D" + (di + 1) + " " + it.period + " 出现在 " + items[items.indexOf(it) - 1]?.period + " 之后");
        }
        if (k !== 99 && k !== 9) last = k;
      });
    });
    // 重复统计（>1 次）
    for (const [k, v] of seen) if (v > 1) bad.重复景点.push(nm + "/" + days + "天 " + k + " ×" + v);
  }
}
for (const k in bad) {
  const arr = bad[k];
  console.log("【" + k + "】" + arr.length + " 处");
  const uniq = [...new Set(arr)];
  uniq.slice(0, 6).forEach(x => console.log("   " + x));
}
