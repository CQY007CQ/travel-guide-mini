#!/usr/bin/env node
/**
 * tools/test/_test-corpus.mjs —— v1.19.204 帮助页「离线数据规模」统计口径回归
 *
 * 背景：帮助页底部有一张「离线数据来源 · 规模」卡（城市 / 景点 / 美食 / 应急医院 …），
 *   用于向评审说明随包知识库的真实体量。实测该卡长期显示
 *   「0 家应急医院覆盖 0 城」——数字不是"少"，而是恒为 0。
 *
 * 根因：utils/corpus.js 用 D.HOSPITALS 统计医院，但医院数据从来不在 data.js，
 *   而在 utils/emergency-data.js（HOSPITALS 具名 193 家 / 128 城 + APPROX 323 城）。
 *   D.HOSPITALS 恒为 undefined → _countKeys 返回 0、累加循环不执行。
 *   同类原因还让使用指南里写了「125 城 156 家」这种静态数字，双份口径各自漂移。
 *
 * 修复：① corpus.js 改为从 emergency-data.js 取真源，并把「具名医院」与
 *   「只有城心坐标、走地图搜索降级」的城分开统计，不把降级城算成医院；
 *   ② 帮助页新增「搜索降级城」一格，headline 里明确两种覆盖；
 *   ③ 使用指南去掉易漂移的静态数字，改为定性描述 + 合规口径。
 *
 * 断言：统计非 0、与 emergency-data 真源逐项一致、headline 不含 0、
 *   真源/产物都指向 emergency-data、帮助页三处渲染、指南无静态数字、版本一致性。
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const req = createRequire(fileURLToPath(import.meta.url));

let fail = 0, n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (cond) return;
  fail++;
  console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : ""));
};

/* ---------- 0. 真源数据基准（emergency-data.js） ---------- */
const ED = req("../../utils/emergency-data.js");
const HC = Object.keys(ED.HOSPITALS || {});
const AC = Object.keys(ED.APPROX || {});
let realHospitals = 0;
for (const k of HC) if (Array.isArray(ED.HOSPITALS[k])) realHospitals += ED.HOSPITALS[k].length;

/* ---------- 1. 运行真实 corpusStats() ---------- */
const T = req("../../utils/travel.js");
const CP = req("../../utils/corpus.js");
let s = null, err = "";
try {
  await T.ready();
  s = CP.corpusStats();
} catch (e) { err = e && e.message; }
ok("corpusStats() 可正常执行", !!s, err);

if (s) {
  /* ---------- 2. 医院统计不再恒为 0 ---------- */
  ok("急救医院数 > 0（旧版恒为 0 的回归点）", s.hospitals > 0, "hospitals=" + s.hospitals);
  ok("急救医院覆盖城数 > 0", s.hospitalCities > 0, "hospitalCities=" + s.hospitalCities);
  ok("地图搜索降级城数 > 0", s.approxCities > 0, "approxCities=" + s.approxCities);

  /* ---------- 3. 与真源逐项一致（不写死数字，动态比对） ---------- */
  ok("医院条目数与 emergency-data 一致", s.hospitals === realHospitals,
    s.hospitals + " vs " + realHospitals);
  ok("覆盖城数与 emergency-data 一致", s.hospitalCities === HC.length,
    s.hospitalCities + " vs " + HC.length);
  ok("降级城数与 emergency-data 一致", s.approxCities === AC.length,
    s.approxCities + " vs " + AC.length);
  ok("具名城与降级城不重叠（不重复计数）", HC.every((k) => !AC.includes(k)),
    "重叠 " + HC.filter((k) => AC.includes(k)).length + " 城");
  ok("具名城均有真实条目（无空数组占位）",
    HC.every((k) => Array.isArray(ED.HOSPITALS[k]) && ED.HOSPITALS[k].length > 0));

  /* ---------- 4. headline 不得出现 0 ---------- */
  // v1.20.5：医院数由 195 → 220 后，裸 /0\s*家/ 会把「220 家」的末位 0 当成「0 家」误报。
  // 必须要求 0 前面不是数字，才是真正的「零家」。
  ok("headline 不含「0 家」", !/(?:^|[^0-9])0\s*家/.test(s.headline), s.headline);
  ok("headline 不含「0 城」", !/(?:^|[^0-9])0\s*城/.test(s.headline), s.headline);
  ok("headline 含真实医院数", s.headline.includes(String(s.hospitals)), s.headline);
  ok("headline 含真实覆盖城数", s.headline.includes(String(s.hospitalCities)), s.headline);
  ok("headline 标明降级口径（走地图搜索）", s.headline.includes("地图搜索"), s.headline);

  /* ---------- 5. 其它统计项仍然有效（改动未误伤） ---------- */
  ok("城市数 > 0", s.cities > 0, "cities=" + s.cities);
  ok("景点数 > 0", s.spots > 0, "spots=" + s.spots);
  ok("美食城数 > 0", s.foods > 0, "foods=" + s.foods);
  ok("省级区数 > 0", s.provinces > 0, "provinces=" + s.provinces);
  ok("气候带分布非空", Array.isArray(s.climate) && s.climate.length > 0);
  ok("气候带人数合计 = 城市数",
    s.climate.reduce((a, b) => a + b.n, 0) === s.cities,
    s.climate.reduce((a, b) => a + b.n, 0) + " vs " + s.cities);
  ok("区域分布非空", Array.isArray(s.region) && s.region.length > 0);
  ok("区域人数合计 = 城市数",
    s.region.reduce((a, b) => a + b.n, 0) === s.cities,
    s.region.reduce((a, b) => a + b.n, 0) + " vs " + s.cities);
  ok("ready 标记为 true", s.ready === true);

  /* ---------- 5b. 城市口径双轨（2026-11-10） ----------
     防回潮：曾经把「有真实美食店的城数」误当成城市总数，也没说清 751 条里含别名。 */
  ok("城市池条目数 > 去重后真实城市数", s.cityEntries > s.cities,
    "cityEntries=" + s.cityEntries + " cities=" + s.cities);
  ok("别名条目数 = 城市池条目 - 真实城市",
    s.aliasEntries === s.cityEntries - s.cities, "alias=" + s.aliasEntries);
  ok("headline 并列标出城市池条目数与真实城市数",
    s.headline.includes(String(s.cityEntries)) && s.headline.includes("真实城市") && s.headline.includes("别名"),
    s.headline);
  ok("有景点坐标城数 > 0", s.spotCities > 0, "spotCities=" + s.spotCities);
}

/* ---------- 6. 真源与产物都指向 emergency-data（防回潮） ---------- */
const srcCorpus = read("tools/_src-backup/corpus.js");
const outCorpus = read("utils/corpus.js");
ok("真源 corpus.js 从 emergency-data 取医院真源",
  /require\(["']\.\/emergency-data\.js["']\)/.test(srcCorpus));
ok("压缩产物同样引用 emergency-data",
  /require\(["']\.\/emergency-data\.js["']\)/.test(outCorpus));
ok("真源不再用 D.HOSPITALS 统计（回潮点）",
  !/D\.HOSPITALS/.test(srcCorpus.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")));
ok("产物不含 D.HOSPITALS", !/D\.HOSPITALS/.test(outCorpus));

/* ---------- 7. 帮助页渲染三处 ---------- */
const helpWxml = read("pages/help/help.wxml");
const helpJs = read("pages/help/help.js");
ok("help.wxml 渲染 headline", /\{\{\s*corpus\.headline\s*\}\}/.test(helpWxml));
ok("help.wxml 渲染 hospitals", /\{\{\s*corpus\.hospitals\s*\}\}/.test(helpWxml));
ok("help.wxml 渲染 approxCities（降级城单独展示）",
  /\{\{\s*corpus\.approxCities\s*\}\}/.test(helpWxml));
ok("help.js 通过 corpusStats() 取数", /corpusStats\s*\(/.test(helpJs));
ok("help.js 取数失败不拖垮页面（try/catch）",
  /try\s*\{[^}]*corpusStats|corpusStats[^;]*\}\s*catch/.test(helpJs));
ok("help.wxml 展示城市池条目数", /\{\{\s*corpus\.cityEntries\s*\}\}/.test(helpWxml));
ok("help.wxml 解释全称别名口径", /全称别名/.test(helpWxml));
ok("help.wxml 说明未收录城市走降级、不编造", /不编造店名与坐标/.test(helpWxml));

/* ---------- 8. 使用指南不再写静态医院数字 ---------- */
const guideJs = read("subpkg/guide/guide.js");
const b4 = (guideJs.match(/\{\s*k:\s*"b4"[\s\S]*?\}/) || [])[0] || "";
ok("使用指南 b4 条目存在", !!b4);
ok("使用指南 b4 不含易漂移的静态医院数字", !/\d+\s*(?:城|家)/.test(b4), b4.slice(0, 90));
ok("使用指南仍说明降级口径（不编造机构名）",
  b4.includes("地图搜附近医院") || b4.includes("地图搜索"));

/* ---------- 9. 版本一致性（动态真值，禁止写死） ---------- */
const ver = (x) => (x.match(/APP_VER\s*=\s*"([^"]+)"/) || [])[1];
const cfgVer = JSON.parse(read("project.config.json")).version;
ok("真源 / 产物 / project.config.json 版本一致",
  ver(read("tools/_src-backup/travel.js")) === cfgVer && ver(read("utils/travel.js")) === cfgVer,
  [ver(read("tools/_src-backup/travel.js")), ver(read("utils/travel.js")), cfgVer].join(" / "));

/* ---------- 10. 团队合并管线防回潮（v1.20.6） ----------
   远端分区采集回仓后曾出现两类静默故障：
   ① 采集端用 0,0 表示"没取到坐标"，被当成真实越界 → 55 条错误把整批 992 店合并拦死；
   ② 全量注入四块静态数据会把主包从 1459KB 顶到 1626KB，越过 1.5M 代码质量线；
   ③ 旧 pruneApprox 正则匹配不到压缩产物的 APPROX 声明 → 新增具名医院城与降级城重叠。
   这里守住三处修复都还在，且注入块里确实没有 (0,0) 假坐标。 */
const mergeSrc = read("tools/data/_merge-team-enrich.mjs");
ok("合并脚本把 0,0 占位坐标归一为缺失（绝不写假坐标）",
  /const isNoCoord\s*=/.test(mergeSrc) && /function normCoord\(/.test(mergeSrc) &&
  /delete o\.lat;\s*delete o\.lon/.test(mergeSrc));
ok("美食 / 逐店酒店 / 医院三处校验都走 normCoord",
  (mergeSrc.match(/normCoord\(/g) || []).length >= 4,
  "调用点=" + (mergeSrc.match(/normCoord\(/g) || []).length);
ok("合并脚本有主包 1.5M 预算感知，超限块显式暂缓而非撑爆",
  /MAIN_LIMIT_KB\s*=\s*1536/.test(mergeSrc) && /主包剩余/.test(mergeSrc) &&
  /受主包预算约束暂缓/.test(mergeSrc));
ok("APPROX 剔除用平衡括号扫描且产物/源码双写",
  /function objLiteral\(/.test(mergeSrc) &&
  mergeSrc.includes('pruneApprox("utils/emergency-data.js"') &&
  mergeSrc.includes('pruneApprox("tools/_src-backup/emergency-data.src.js"'));
const dsrc = read("tools/_src-backup/data.js");
const tm = dsrc.match(/>>>TEAM_FOOD_START>>>[\s\S]*?const TEAM_FOOD_ENRICH = ([\s\S]*?);\s*\/\/ <<<TEAM_FOOD_END<<</);
let teamFood = null, zero = 0;
try { teamFood = tm ? Function("return " + tm[1] + ";")() : null; } catch (e) { /* 解析失败即判红 */ }
if (teamFood) for (const c in teamFood) for (const sh of teamFood[c] || [])
  if (sh && (sh.lat === 0 || sh.lon === 0)) zero++;
ok("注入的团队美食块无 (0,0) 占位坐标", !!teamFood && zero === 0, "zero=" + zero);
ok("远端采集增量确已入包（团队美食块 ≥900 店）", !!teamFood &&
  Object.values(teamFood).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0) >= 900);

console.log("  离线数据规模口径回归: " + (n - fail) + "/" + n + " 通过");
if (fail) process.exit(1);
console.log("  ✔ 医院统计已指向真源（具名 / 降级分开算），帮助页不再显示 0");
