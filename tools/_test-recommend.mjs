/**
 * tools/_test-recommend.mjs —— 个性推荐引擎回归（utils/recommend.js）
 *
 * 为什么要有这组断言：
 *   推荐引擎里唯一的"主观部分"是 W 权重表。权重一调，排序就可能整体走样，
 *   而这种走样**不会报错** —— 只会悄悄把"海边亲子"推成合肥、把"古镇"推成淮北。
 *   所以这里锁定若干黄金用例，权重改动若破坏了底线行为，allcheck 会直接红。
 *
 * 断言分两类：
 *   ① 硬性质（绝不能破）：确定性、分数区间、理由非空、limited 不外泄、TopN 生效
 *   ② 垂类底线（改权重时必须复核）：古镇/海边/沙漠三个高置信场景的 Top1/Top3
 * 刻意不锁死具体名次 —— 那是脆断言，容易为了过测而改产品。
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const R = require("../utils/recommend.js");
const T2 = require("../utils/travel.js");
const D2 = (T2 && T2.D) || {};

/* 时令口径（v1.19.201）：此前全文件把 month 硬编码为 10，运行时却按当前月算，
 * 造成「单测全绿、现场翻车」——11 月沙漠榜推南昌/张家口、敦煌掉第 7，单测毫无察觉。
 * 现在：全部行为断言跟随运行时真实月份；另设【全年时令稳定性】遍历 1–12 月。 */
const MONTH_NOW = new Date().getMonth() + 1;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? ("  → " + extra) : "")); }
}

/* ── ① 需求解析 ── */
console.log("【需求解析】");
{
  const p = R.extractPrefs("想找个人少的古镇，三天，预算省一点", { month: MONTH_NOW });
  ok("识别古镇标签", p.tags.indexOf("oldtown") >= 0, JSON.stringify(p.tags));
  ok("识别人少标签", p.tags.indexOf("quiet") >= 0, JSON.stringify(p.tags));
  ok("识别天数=3", p.days === 3, String(p.days));
  ok("识别预算=low", p.budget === "low", p.budget);

  const p2 = R.extractPrefs("海边亲子游，五天，舒适", { month: MONTH_NOW });
  ok("识别海边+亲子", p2.tags.indexOf("sea") >= 0 && p2.tags.indexOf("family") >= 0, JSON.stringify(p2.tags));
  ok("识别天数=5", p2.days === 5, String(p2.days));
  ok("识别预算=mid", p2.budget === "mid", p2.budget);

  const p3 = R.extractPrefs("随便逛逛", { month: MONTH_NOW });
  ok("无标签时 tags 为空", p3.tags.length === 0, JSON.stringify(p3.tags));
  ok("未提天数时不臆造", p3.days === 0, String(p3.days));
}

/* ── ② 硬性质 ── */
console.log("【硬性质】");
{
  const q = "海边亲子游，五天";
  const a = R.recommend(q, { month: MONTH_NOW, topN: 5 });
  const b = R.recommend(q, { month: MONTH_NOW, topN: 5 });
  ok("确定性：同输入同输出", JSON.stringify(a.list) === JSON.stringify(b.list));

  ok("返回非空", a.list.length > 0, String(a.list.length));
  ok("TopN 生效", a.list.length <= 5, String(a.list.length));
  ok("分数落在 1..99", a.list.every(x => x.score >= 1 && x.score <= 99));
  ok("每条都有可解释理由", a.list.every(x => Array.isArray(x.reasons) && x.reasons.length > 0));
  ok("理由含具体命中文案", a.list.every(x => x.reasons.every(r => typeof r.label === "string" && typeof r.delta === "number")));
  ok("默认不返 limited 城", a.list.every(x => !x.limited));
  ok("排序单调不升", a.list.every((x, i) => i === 0 || a.list[i - 1].score >= x.score));

  const w = R.recommend(q, { month: MONTH_NOW, topN: 8, includeLimited: true });
  ok("includeLimited 可放开", w.list.length >= a.list.length, w.list.length + " vs " + a.list.length);

  // topN 边界：曾被 `parseInt(topN) || 5` 坑过 —— 传 0 时 0 是 falsy，会回退默认 5，
  // 与"夹到 [1,20]"的意图不符（由 _fuzz-recommend 发现）。这里锁住边界行为。
  ok("topN=0 夹到 1 条", R.recommend(q, { month: MONTH_NOW, topN: 0 }).list.length === 1,
    "实际 " + R.recommend(q, { month: MONTH_NOW, topN: 0 }).list.length + " 条");
  ok("topN=999 夹到 ≤20 条", R.recommend(q, { month: MONTH_NOW, topN: 999 }).list.length <= 20,
    "实际 " + R.recommend(q, { month: MONTH_NOW, topN: 999 }).list.length + " 条");
  ok("topN 非数字时回落默认", R.recommend(q, { month: MONTH_NOW, topN: "abc" }).list.length > 0);
}

/* ── ③ 垂类底线（改 W 权重时必须复核这三组）── */
console.log("【垂类底线】");
{
  const oldtown = R.recommend("古镇 人少 三天", { month: MONTH_NOW, topN: 5 });
  const names = oldtown.list.map(x => x.name);
  // v1.19.201：原断言锁「平遥进前 3」，但平遥只在 4/5/9/10 月靠旧季节 +12 进前三，
  // 是典型「固定月份撑起来的脆断言」。改为结构断言：Top5 必须真的命中古镇标签。
  const oldtownHit = oldtown.list.filter(x => (x.tagHits || []).some(t => t.key === "oldtown")).length;
  ok("古镇：Top5 ≥4 个命中古镇标签", oldtownHit >= 4, names.join(",") + " 命中=" + oldtownHit);
  ok("古镇：命中结果非空", oldtown.list.length > 0);

  const COASTAL = ["秦皇岛", "青岛", "烟台", "威海", "三亚", "大连", "厦门", "珠海", "北海", "台州", "舟山", "温州", "汕头", "湛江", "连云港", "日照"];
  const sea = R.recommend("海边亲子游，五天，舒适", { month: MONTH_NOW, topN: 5 });
  const seaNames = sea.list.map(x => x.name);
  const coastalHit = seaNames.filter(n => COASTAL.indexOf(n) >= 0).length;
  ok("海边亲子：Top5 ≥4 个沿海城", coastalHit >= 4, seaNames.join(","));
  // AND 语义回归：重庆是亲子强市但不是海边，曾被"标签求和"顶进海边榜（实测出现过）
  ok("海边亲子：内陆城市不得混入", seaNames.indexOf("重庆") < 0, seaNames.join(","));

  const desert = R.recommend("沙漠戈壁 摄影 四天", { month: MONTH_NOW, topN: 5 });
  const dNames = desert.list.map(x => x.name);
  ok("沙漠：敦煌进前 3", dNames.slice(0, 3).indexOf("敦煌") >= 0, dNames.join(","));
  ok("沙漠：Top5 不出现字面误命中城", !dNames.some(n => ["南昌", "张家口", "安庆", "宁波", "渭南"].indexOf(n) >= 0), dNames.join(","));
}

/* ── ③b 标签覆盖（不看具体城名，只看"Top5 是否真的命中该标签"）──
 * 目的：调权重后排序可能整体漂走却不报错；这一组用结构断言兜住。
 * 5 个类目覆盖数据厚薄差异较大的场景（滑雪仅 36 城有内容，沙漠/温泉数据较厚）。 */
console.log("【标签覆盖】");
{
  const CASES = [
    ["温泉 放松 两天", "hotspring"],
    ["草原 骑马 五天", "grass"],
    ["滑雪 四天", "ski"],
    ["博物馆 看展 三天", "museum"],
    ["沙漠 三天", "desert"],
  ];
  for (const pair of CASES) {
    const r = R.recommend(pair[0], { month: MONTH_NOW, topN: 5 });
    const hitN = r.list.filter(function (x) {
      return (x.tagHits || []).some(function (t) { return t.key === pair[1]; });
    }).length;
    ok("「" + pair[1] + "」Top5 命中 ≥3", hitN >= 3, hitN + "/5");
  }
}

/* ── ④b 智能性 / 透明度回归（v1.19.147+ 升级锁）──
 * 锁住用户投诉的核心：① 点名城市必须锚定到榜首；② 无意图时明确标注"综合热度"不伪装；
 * ③ 每条带可解释 reasonTag；④ "最…"类诉求记 extreme 但不编造年代排序；
 * ⑤ 防止"无论输入什么都出同一批城市 + 同一分数"的退化（曾出现花卉市场→全城 34 分）。 */
console.log("【智能性/透明度】");
{
  // ① 点名城市锚定：query 显式含城市名 → 该城必须进榜首，且理由标注"你提到的城市"
  const named = R.recommend("火锅 美食 成都", { month: MONTH_NOW, topN: 5 });
  ok("点名城锚定：成都进榜首", named.list.length && named.list[0].name === "成都", named.list.map(x => x.name).join(","));
  ok("点名城锚定：理由标注点名", named.list.length && named.list[0].reasonTag === "你提到的城市", named.list[0] && named.list[0].reasonTag);
  ok("点名城锚定：mode=city", named.mode === "city", named.mode);

  // ② 无明确意图：不伪装成命中理由，明确综合热度
  const idle = R.recommend("随便逛逛", { month: MONTH_NOW, topN: 5 });
  ok("无意图：noIntent=true", idle.noIntent === true, String(idle.noIntent));
  ok("无意图：mode=overall", idle.mode === "overall", idle.mode);
  ok("无意图：榜首标注综合热度", idle.list.length && idle.list[0].reasonTag === "综合热度", idle.list[0] && idle.list[0].reasonTag);
  ok("无意图：summary 诚实说明", idle.list.length && idle.list[0].summary.indexOf("综合热度推荐") >= 0, idle.list[0] && idle.list[0].summary);

  // ③ 每条都带 reasonTag（前端据此展示"分数=什么"）
  const intent = R.recommend("海边亲子游，五天，舒适", { month: MONTH_NOW, topN: 5 });
  ok("有意图：每条 reasonTag 非空", intent.list.every(x => typeof x.reasonTag === "string" && x.reasonTag.length > 0), intent.list.map(x => x.reasonTag).join("|"));

  // ④ 最高级诉求记 extreme，但不编造年代排序
  const ext = R.recommend("有最大的花卉市场", { month: MONTH_NOW, topN: 5 });
  ok("最高级诉求：extreme=true", ext.extreme === true, String(ext.extreme));
  ok("花卉诉求：命中 photo 标签", ext.prefs.tags.indexOf("photo") >= 0, JSON.stringify(ext.prefs.tags));

  // ⑤ 退化防护：同一输入 Top5 分数不允许全部相同（曾出现全 34 分）
  const scores = intent.list.map(x => x.score);
  const uniq = Array.from(new Set(scores));
  ok("防退化：Top5 分数不全相同", uniq.length > 1, scores.join(","));

  // ⑥ 无意图路径也须有区分度（heat 先验破平，不再全 34 分）
  // v1.19.201：score 是取整后的整数，只有 1 分精度；Top 城 heat 趋于饱和时
  // _raw 仅差 0.3，取整必然全同（11 月实测 Top5 全 47 分）。原断言在 10 月
  // 只是靠一个 41.58→42 的取整巧合通过，属于「固定月份撑起来的脆断言」。
  // 真正要防的退化是「底层无区分 + 城市永远同一批」，故改看 _raw 与跨月活性。
  const idleRaw = idle.list.map(x => x._raw);
  const idleRawUniq = Array.from(new Set(idleRaw));
  ok("无意图：Top5 底层分数(_raw)不全相同", idleRawUniq.length > 1, idleRaw.join(","));
  const idleSig = m => R.recommend("随便逛逛", { month: m, topN: 5 }).list.map(x => x.name).join(",");
  const idleSigs = new Set(MONTHS.map(idleSig));
  ok("无意图：12 个月榜单随时令变化（非固定同一批）", idleSigs.size > 1, idleSigs.size + " 种榜单");

  // ⑦ 省份定向：显式点名省份 → 该省城市压过同名类外省强城
  const zhejiang = R.recommend("浙江 古镇 三天", { month: MONTH_NOW, topN: 5 });
  const zjNames = zhejiang.list.map(x => x.name);
  const zjCount = zjNames.filter(function (n) {
    const c = (D2.CITIES || []).filter(function (c) { return c && c.name === n; })[0];
    return c && c.province === "浙江";
  }).length;
  ok("省份定向：浙江城优先（Top5≥2 个浙江）", zjCount >= 2, zjNames.join(",") + " 浙江=" + zjCount);
  // 平遥(山西)是无省份限定时古镇 Top1；点名浙江后不应再压过浙江古镇
  ok("省份定向：外省强城不压本省（平遥不进前 3）", zjNames.indexOf("平遥") < 0 || zjNames.indexOf("平遥") >= 3, zjNames.join(","));
}

/* ── ④c 50 维共享词库补充意图（v1.19.164 优化锁）──
 * 锁住本次优化的核心：18 类主词典覆盖不到/不准的意图（秋天/红叶/免费/海岛…），
 * 现在经「按标签找景点」共享词库识别，并改用「真实景点标签命中数」计分。
 * 只断言这些意图 label 出现在 Top5 的可解释理由里（不锁城名，避免脆断言）。
 * 回归意义：此前这些意图会被彻底忽略（既不进 tags、也不驱动排序）。 */
console.log("【50 维共享词库补充意图】");
{
  const hasReason = (list, label) => list.some(x => (x.reasons || []).some(r => r.label === label));

  const autumn = R.recommend("秋天 看红叶 小众 五天", { month: MONTH_NOW, topN: 5 });
  ok("秋天红叶：Top5 出现「秋季适宜」理由（autumn 词库意图被识别）", hasReason(autumn.list, "秋季适宜"), JSON.stringify(autumn.list.map(x => x.reasonTag)));

  const free = R.recommend("免费 海边 三天", { month: MONTH_NOW, topN: 5 });
  ok("免费海边：Top5 出现「免费开放」理由（free 词库意图被识别）", hasReason(free.list, "免费开放"), JSON.stringify(free.list.map(x => x.reasons && x.reasons.map(r => r.label))));

  const island = R.recommend("海岛 潜水 一周", { month: MONTH_NOW, topN: 5 });
  ok("海岛潜水：Top5 出现「离岛小岛」理由（island 词库意图被识别）", hasReason(island.list, "离岛小岛"), JSON.stringify(island.list.map(x => x.reasons && x.reasons.map(r => r.label))));

  // 雪山/冰川/高原：snowmtn 经真实景点标签命中（而非仅语料正则），Top1 须为高原雪山目的地
  const snow = R.recommend("雪山 冰川 高原 七天", { month: MONTH_NOW, topN: 5 });
  ok("雪山高原：Top1 为高原雪山类目的地（丽江/迪庆/喀什/甘孜/日喀则之一）",
    ["丽江", "迪庆", "喀什", "甘孜", "日喀则"].indexOf((snow.list[0] || {}).name) >= 0,
    snow.list.map(x => x.name).join(","));
}

/* ── ④ 单城解释 ── */
console.log("【单城解释】");
{
  const e = R.explain("平遥", "古镇 三天", { month: MONTH_NOW });
  ok("explain 找到城市", e && e.found === true);
  ok("explain 有理由", e && Array.isArray(e.reasons) && e.reasons.length > 0);
  ok("explain 带标签命中明细", e && Array.isArray(e.tagHits) && e.tagHits.length > 0);

  const miss = R.explain("不存在的城市XYZ", "古镇", { month: MONTH_NOW });
  ok("explain 未找到时不崩", miss && miss.found === false);
}


/* ── ⑤ 全年时令稳定性（v1.19.201 防月份漂移）──
 * 背景：旧权重季节 +12/-5（摆幅 17）大于主题强弱差距，且「厚田沙漠」
 * 「大观区沙漠洲生态公园」这类字面假阳性只命中 1–2 处就能拿满额时令加分。
 * 单测只跑固定 10 月时全绿，到 11 月现场演示却把南昌/张家口推上榜首、敦煌掉第 7。
 * 这里遍历 12 个月，锁住「主题不被季节掀翻」这条不变量。 */
console.log("【全年时令稳定性（1–12 月）】");
{
  const VERTICALS = [
    { q: "古镇 人少 三天", key: "oldtown" },
    { q: "海边亲子游 五天 舒适", key: "sea" },
    { q: "沙漠戈壁 摄影 四天", key: "desert" },
    { q: "温泉放松 周末 两天", key: "hotspring" },
  ];
  const COASTAL = ["秦皇岛", "青岛", "烟台", "威海", "三亚", "大连", "厦门", "珠海", "北海", "台州", "舟山", "温州", "汕头", "湛江", "连云港", "日照"];
  const FALSE_POSITIVES = ["南昌", "张家口", "安庆", "宁波", "渭南"];
  const N = MONTHS.length;
  let hitOK = 0, coastOK = 0, dunOK = 0, cleanOK = 0;
  const bad = [];
  const sigs = new Set();
  for (const m of MONTHS) {
    for (const v of VERTICALS) {
      const r = R.recommend(v.q, { month: m, topN: 5 });
      const names = r.list.map(x => x.name);
      const hit = r.list.filter(x => (x.tagHits || []).some(t => t.key === v.key)).length;
      if (hit >= 4) hitOK++; else bad.push(m + "月 " + v.key + " 只命中 " + hit);
      if (v.key === "sea") {
        const c = names.filter(n => COASTAL.indexOf(n) >= 0).length;
        if (c >= 4) coastOK++; else bad.push(m + "月 沿海仅 " + c);
      }
      if (v.key === "desert") {
        sigs.add(names.join(","));
        const di = names.indexOf("敦煌");
        if (di >= 0 && di < 2) dunOK++; else bad.push(m + "月 敦煌第 " + (di + 1) + "：" + names.join(","));
        const fp = names.filter(n => FALSE_POSITIVES.indexOf(n) >= 0);
        if (!fp.length) cleanOK++; else bad.push(m + "月 字面误命中 " + fp.join(","));
      }
    }
  }
  ok("全年 12 月 × 4 垂类：Top5 主题命中 ≥4（" + hitOK + "/" + N * 4 + "）", hitOK === N * 4, bad.slice(0, 3).join("; "));
  ok("全年 12 月海边：Top5 ≥4 沿海城（" + coastOK + "/" + N + "）", coastOK === N, bad.slice(0, 3).join("; "));
  ok("全年 12 月沙漠：敦煌稳居前 2（" + dunOK + "/" + N + "）", dunOK === N, bad.slice(0, 3).join("; "));
  ok("全年 12 月沙漠：无字面误命中城（" + cleanOK + "/" + N + "）", cleanOK === N, bad.slice(0, 3).join("; "));
  ok("季节仍有区分度（12 个月榜单并非完全相同）", sigs.size > 1, "不同榜单 " + sigs.size + " 种");
  ok("运行时当前月 " + MONTH_NOW + " 月即被覆盖", MONTH_NOW >= 1 && MONTH_NOW <= 12, String(MONTH_NOW));
}

/* ── 汇总 ── */
console.log("");
if (fail === 0) {
  console.log("recommend 回归通过：" + pass + " 项（当前月 " + MONTH_NOW + " 月 + 全年 12 月覆盖）");
  process.exit(0);
} else {
  console.log("recommend 回归失败：" + fail + " 项失败 / 共 " + (pass + fail) + " 项");
  process.exit(1);
}
