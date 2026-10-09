// 共享逻辑单测（node + wx stub，模拟小程序环境可复用的部分）
const mem = {};
global.wx = {
  getStorageSync: k => (k in mem ? mem[k] : ""),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: k => { delete mem[k]; },
  showToast: () => {}, showModal: () => {}, openLocation: () => {}, setClipboardData: () => {},
  navigateTo: () => {}, switchTab: () => {}, reLaunch: () => {}, navigateBack: () => {}
};
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = T.D;

let pass = 0, fail = 0;
const assert = (n, c, ex) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n + (ex ? " → " + ex : "")); } };

// 用「本地日期」构造 DEP（勿用 toISOString：本地 00:00-08:00 时 UTC 日期滞后一天，
// 会与 todayState 的 fmtLocalDate(本地) 语义错位，导致 daysLeft/dayNo 差 1 的偶发失败）
const _depD = new Date(Date.now() + 8 * 86400000);
const DEP = _depD.getFullYear() + "-" + String(_depD.getMonth() + 1).padStart(2, "0") + "-" + String(_depD.getDate()).padStart(2, "0");
const BJ = D.CITIES.find(c => c.name === "北京");

console.log("== 1. 生成（复用 planner）==");
const days = T.buildPlan({ city: BJ, days: 4, depart: DEP, pace: "balance" });
assert("北京 4 天", days.length === 4);
const names = days.flatMap(d => d.items.map(i => i.name));
assert("无脏值", !names.some(n => /undefined|NaN/.test(String(n))));

console.log("== 2. 名称清洗 / 导航判定 ==");
assert("cleanSpotName 去前缀", T.cleanSpotName("深度游览「天安门广场 + 故宫博物院」") === "天安门广场 + 故宫博物院");
assert("isFrameName 抵达", T.isFrameName("抵达 + 入住「市中心」"));
assert("isFrameName 出发前往", T.isFrameName("出发前往「故宫」"));
assert("isFrameName 景点否", !T.isFrameName("故宫博物院"));
const nav = T.navTarget("故宫博物院", "北京");
assert("故宫可坐标导航", nav && nav.type === "coord");
const nav2 = T.navTarget("某个未收录小众点", "北京");
assert("未收录点走城锚兜底", nav2 && nav2.type === "city" && nav2.city === "北京" && typeof nav2.lat === "number", JSON.stringify(nav2));
assert("baikeKeyword 组合名取主段", T.baikeKeyword("天安门广场 + 故宫博物院") === "天安门广场");

console.log("== 3. 今天状态 ==");
const mkPlan = off => { const d = new Date(DEP); const p = JSON.parse(JSON.stringify({ cityName: "北京", days, depart: DEP })); p.days.forEach(x => { const dt = new Date(DEP); dt.setDate(dt.getDate() + off + (x.date ? 0 : 0)); }); return p; };
// 行前：DEP = 今天+8 → before
const stBefore = T.todayState({ cityName: "北京", days });
assert("DEP(+8) 是行前", stBefore && stBefore.phase === "before" && stBefore.daysLeft === 8, JSON.stringify(stBefore));
// 途中：把日期改成昨天开始
const daysPast = JSON.parse(JSON.stringify(days));
daysPast.forEach(x => { const dt = new Date(x.date); dt.setDate(dt.getDate() - 9); x.date = dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0"); });
const stMid = T.todayState({ cityName: "北京", days: daysPast });
assert("前移 9 天后是途中", stMid && stMid.phase === "during", JSON.stringify(stMid));
assert("途中第 2 天", stMid.dayNo === 2, String(stMid.dayNo));
// 结束
const daysEnd = JSON.parse(JSON.stringify(days));
daysEnd.forEach(x => { const dt = new Date(x.date); dt.setDate(dt.getDate() - 30); x.date = dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0"); });
const stAfter = T.todayState({ cityName: "北京", days: daysEnd });
assert("前移 30 天是结束", stAfter && stAfter.phase === "after", JSON.stringify(stAfter));

console.log("== 4. 途中当日活动 ==");
const act = T.nextActivity(daysPast[1]);
assert("nextActivity 有结构", typeof act === "object");
assert("剩余数 ≥0", act.left >= 0 && act.spotsN > 0);

console.log("== 5. 记账 ==");
T.addLedger(50, "餐饮", "早餐");
T.addLedger(88.5, "门票");
assert("记账 2 笔", T.getLedger().length === 2);
assert("今日花费", T.todaySpent() === 138.5, String(T.todaySpent()));
T.delLedger(0);
assert("删除后 1 笔", T.getLedger().length === 1);

console.log("== 6. 待办勾选 ==");
const ph = T.prepPhaseList(5);
assert("5 天 → 抢预约档", ph.items.some(([k]) => k === "p_book"));
T.togglePrepCheck("p_book");
assert("勾选持久化", T.getPrepChecks().p_book === true);

console.log("== 7. 想玩 ==");
T.toggleWish("故宫博物院", "北京");
assert("加入想玩", T.isWished("故宫博物院"));
T.toggleWish("故宫博物院", "北京");
assert("再点取消", !T.isWished("故宫博物院"));

console.log("== 8. 详情/美食/票务数据 ==");
const dt = T.spotDetailText("故宫博物院", "北京");
assert("详情纯文本非空", !!dt && !dt.includes("<"));
assert("美食覆盖北京", (D.FOOD_SPOTS["北京"] || []).length >= 5);
assert("PREP_CHECKLIST 行李", T.PACK_LIST.length >= 6);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
