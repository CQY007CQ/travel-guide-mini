#!/usr/bin/env node
/**
 * tools/test/_test-optimizations.mjs —— 多层级优化单测（v1.20.6）
 * 覆盖：坐标有效性单一真源 / 文案按句截断 / 加载期坐标观测与 shape 断言。
 * 全部离线，不碰 wx.*、不碰网络。
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const req = createRequire(fileURLToPath(import.meta.url));
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COORD = req(path.join(ROOT, "subpkg/utils/coord.js"));
const T = req(path.join(ROOT, "utils/travel.js"));
const D = req(path.join(ROOT, "utils/data.js"));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

let n = 0, fail = 0;
function ok(name, cond, extra) {
  n++;
  if (cond) return;
  fail++;
  console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : ""));
}

/* ---------- L2 坐标有效性：显式数值判定 ---------- */
ok("真实坐标有效", COORD.hasCoord({ lat: 30.655, lon: 104.079 }) === true);
ok("字符串坐标也能用（WXML data-* 常见）", COORD.hasCoord({ lat: "30.655", lon: "104.079" }) === true);
ok("数字 0,0 占位无效", COORD.hasCoord({ lat: 0, lon: 0 }) === false);
ok("字符串 \"0\" 占位无效（旧 truthy 判断会漏）", COORD.hasCoord({ lat: "0", lon: "0" }) === false);
ok("缺字段 / null / NaN 无效",
  !COORD.hasCoord({}) && !COORD.hasCoord({ lat: null, lon: 104 }) &&
  !COORD.hasCoord({ lat: NaN, lon: 104 }) && !COORD.hasCoord(null));
ok("空串无效", COORD.hasCoord({ lat: "", lon: "104" }) === false);
ok("境外坐标在 inChina 模式被拒、默认模式保留",
  COORD.hasCoord({ lat: 48.85, lon: 2.35 }) === true &&
  COORD.hasCoord({ lat: 48.85, lon: 2.35 }, true) === false);
ok("classify 区分占位 / 缺失 / 有效",
  COORD.classify({ lat: 0, lon: 0 }) === "placeholder" &&
  COORD.classify({ lat: null, lon: null }) === "missing" &&
  COORD.classify({ lat: 30.6, lon: 104 }) === "ok");
const foodJs = read("subpkg/food/food.js"), mapJs = read("subpkg/map/map.js");
ok("food / map 共用同一坐标真源（无重复实现）",
  /require\("\.\.\/utils\/coord\.js"\)/.test(foodJs) && /require\("\.\.\/utils\/coord\.js"\)/.test(mapJs) &&
  !/function hasCoord\(/.test(foodJs) && !/function hasCoord\(/.test(mapJs));
ok("旧 truthy 坐标判断不回潮",
  !/if \(fs\.lat && fs\.lon\)/.test(mapJs) && !/if \(s\.lat && s\.lon\)/.test(foodJs));
ok("两页列表都显式标注无坐标",
  /noCoord/.test(foodJs) && /noCoord/.test(mapJs) &&
  /暂无坐标/.test(read("subpkg/food/food.wxml")) && /暂无坐标/.test(read("subpkg/map/map.wxml")));

/* ---------- L3 文案按句截断 ---------- */
ok("briefOf 已导出", typeof T.briefOf === "function");
ok("短文本原样返回、不加省略号", T.briefOf("短句", 26) === "短句");
ok("超长文本在句末标点收尾",
  T.briefOf("火锅必点毛肚、鹅肠、黄喉，锅底选牛油微辣起步。兔头是成都人挚爱。", 26).endsWith("。…"),
  T.briefOf("火锅必点毛肚、鹅肠、黄喉，锅底选牛油微辣起步。兔头是成都人挚爱。", 26));
ok("无标点时按上限硬切且不超长",
  T.briefOf("一".repeat(60), 26).length <= 27);
ok("空值安全", T.briefOf(null, 26) === "" && T.briefOf(undefined, 26) === "");
ok("截断结果不补写原文没有的内容",
  T.briefOf("一二三四五六七八九十", 5).indexOf("一") === 0);
ok("foodRouteOf 不再硬切 26 字",
  !/foodNote\.slice\(0, ?26\)/.test(read("tools/_src-backup/travel.js")));

/* ---------- L1/L4 观测与 shape 断言 ---------- */
ok("coordStats 已暴露且字段完整",
  typeof D.coordStats === "function" &&
  ["outOfRange", "zeroFood", "noCoordFood", "foodTotal"].every(k => typeof D.coordStats()[k] === "number"));
const cs = D.coordStats();
ok("坐标观测数字自洽（总数 ≥ 占位 + 无坐标）",
  cs.foodTotal >= cs.zeroFood + cs.noCoordFood && cs.foodTotal > 0,
  JSON.stringify(cs));
ok("越界景点坐标为 0（打包期硬门禁口径）", cs.outOfRange === 0, "bad=" + cs.outOfRange);
ok("assertDataShape 已暴露且当前数据无结构问题",
  typeof D.assertDataShape === "function" && D.assertDataShape().length === 0,
  JSON.stringify(D.assertDataShape()));
ok("shape 断言只读（不改写数据）",
  (function () { const before = D.CITIES.length; D.assertDataShape(); return D.CITIES.length === before; })());
ok("加载器真源与产物双源一致",
  read("tools/_src-backup/data.js") === read("utils/data.js"));
ok("打包期输出美食坐标观测",
  /美食坐标观测/.test(read("tools/build/pack-data.mjs")));
ok("健康快照聚合真实数据且无异常也能查看",
  /_healthLines\(\)/.test(read("pages/more/more.js")) &&
  !/if \(!n\) \{ wx\.showToast/.test(read("pages/more/more.js")));

console.log("  多层级优化单测: " + (n - fail) + "/" + n + " 通过");
if (fail) process.exit(1);
