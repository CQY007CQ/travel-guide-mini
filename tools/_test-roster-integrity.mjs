// 离线数据真实性门禁：资料卡规模/字段可溯源 + 官方名录候选池 + 医院模板名防回潮
// 串在 allcheck.sh 已有的「审计整改防回潮断言」步内，不新增 step（保住 61 步材料口径）。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const ROOT = process.cwd();
const req = createRequire(ROOT + "/");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
function ck(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  → " + detail : "")); }
}

const D = req(path.join(ROOT, "utils/data.js"));
const E = req(path.join(ROOT, "utils/emergency-data.js"));

// ── 1) 真实资料卡（v1.20.6 新增）────────────────────────────────────
const CARDS = D.SPOT_CARDS_BY_CITY || {};
let cardN = 0, badShape = 0, tplNote = 0, noFact = 0;
const TPL = /结合周边景点串成一条线|可乘地铁或公交至邻近站点|用地图导航到景区入口最稳妥|适合慢逛|避开高峰更舒服|建议预留半天/;
for (const cn in CARDS) {
  for (const nm in CARDS[cn]) {
    cardN++;
    const c = CARDS[cn][nm];
    if (!Array.isArray(c) || c.length !== 5) { badShape++; continue; }
    if (typeof c[0] !== "string" || typeof c[1] !== "string" || typeof c[2] !== "string") badShape++;
    if (TPL.test(String(c[0] || ""))) tplNote++;      // §9.9 模板文案绝不能冒充资料卡看点
    if (!c[1] && !c[2] && (c[3] === "" || c[4] === "")) noFact++;
  }
}
ck("真实资料卡 ≥5000 条（用户要求 5000，实际留余量）", cardN >= 5000, "实际=" + cardN);
ck("资料卡覆盖 ≥300 座城市（全国范围）", Object.keys(CARDS).length >= 300, "城市=" + Object.keys(CARDS).length);
ck("资料卡形状统一 [看点,评分,票价,lat,lon]", badShape === 0, "异常=" + badShape);
ck("资料卡不含 §9.9 类型化模板套话", tplNote === 0, "命中=" + tplNote);
ck("资料卡非空壳（每条至少一项结构化真实字段）", noFact === 0, "空壳=" + noFact);

// ── 2) 百科链路确实用上了资料卡 ────────────────────────────────────
const travelSrc = read("tools/_src-backup/travel.js");
const outSrc = read("utils/travel.js");
ck("travel 真源读取 SPOT_CARDS_BY_CITY 且返回 card 标记",
  travelSrc.indexOf("D.SPOT_CARDS_BY_CITY") >= 0 && /card:\s*cardHit/.test(travelSrc));
ck("压缩产物 utils/travel.js 已同步（真源不漂移）", outSrc.indexOf("SPOT_CARDS_BY_CITY") >= 0);
ck("_apply-safe.mjs 幂等重建资料卡（每轮从零）",
  /base\.SPOT_CARDS_BY_CITY\s*=\s*\{\}/.test(read("tools/_apply-safe.mjs")));
const T = req(path.join(ROOT, "utils/travel.js"));
const fake = T.baikeInfo("完全虚构的地点XYZ不存在的名字", "西安");
ck("虚构地点仍判「暂未收录」（资料卡不得抬升 has）", !!(fake && fake.has === false && fake.text === ""));
const real = T.baikeInfo("故宫博物院", "北京");
ck("真实景点百科含「随包资料」结构化信息", !!(real && real.has && real.card && real.text.indexOf("随包资料") >= 0));

// ── 3) 官方名录候选池：逐条可追溯，且未冒充可导航医院 ────────────────
const CF = path.join(ROOT, "tools/official-roster/candidates.json");
let cand = null;
try { cand = JSON.parse(fs.readFileSync(CF, "utf8")); } catch (e) {}
ck("官方名录候选池存在且非空", !!(cand && cand.count > 0 && Array.isArray(cand.items)), cand ? "count=" + cand.count : "文件缺失");
const items = (cand && cand.items) || [];
let missingMeta = 0, badName = 0, fakeVerified = 0;
const DOC = /关于|通知|参加|考核|名录|名单|平台|上传|附件|三级|二级|公立|绩效|评审|公示|监测|请各|并指导/;
const GENERIC = new Set(["人民医院", "中医院", "中心医院", "中西医结合医院", "综合医院", "申康医院", "区级医院"]);
for (const it of items) {
  if (!it.n || !/^https?:\/\//.test(it.source || "") || !it.authority || !it.collected) missingMeta++;
  if (it.verified !== false || it.coord !== null) fakeVerified++;
  const n = String(it.n || "");
  if (n.length < 4 || n.length > 30 || GENERIC.has(n) || DOC.test(n) || /^(请|并|各|为|在|对|把)/.test(n)) badName++;
}
ck("候选池每条带官方 URL / 发布机构 / 采集日期", missingMeta === 0, "缺元数据=" + missingMeta);
ck("候选池无公文截断名 / 通用类型名", badName === 0, "坏名=" + badName);
ck("候选池全部 verified=false 且 coord=null（未核验坐标不得冒充可导航）", fakeVerified === 0, "越权=" + fakeVerified);
ck("源注册表登记了受限源并说明原因",
  /_blocked/.test(read("tools/official-roster-sources.json")) && /mofcom-laozihao/.test(read("tools/official-roster-sources.json")));

// ── 4) 医院模板名防回潮（对齐 emergency-data.js 合规口径）────────────
// ⚠️ 不能用「名字长得像城名+人民医院」来判模板：官方公示里的「无锡市人民医院」
//    「宿迁市第一人民医院」是真实具名机构，形态判定会误伤 69 家。
//    正确口径是「是否与历史伪造批次（无来源、坐标按城心 ±0.02 网格拼接）逐条重合」。
const batchFingerprint = new Set();
for (const f of ["_hospital-batch4.json", "_hospital-batch5.json", "_hospital-batch6.json"]) {
  try {
    const a = JSON.parse(read("tools/" + f));
    const list = Array.isArray(a) ? a : (a.list || Object.values(a)[0] || []);
    for (const x of (Array.isArray(list) ? list : [])) {
      if (x && x.city && x.n) batchFingerprint.add(x.city + "|" + x.n);
    }
  } catch (e) {}
}
let hospN = 0, batchHit = 0, truncHosp = 0, noCoord = 0;
for (const cn in (E.HOSPITALS || {})) {
  for (const h of (E.HOSPITALS[cn] || [])) {
    hospN++;
    const n = String((h && (h.n || h.name)) || "");
    if (n.length < 4) truncHosp++;
    if (batchFingerprint.has(cn + "|" + n)) batchHit++;
    if (!(h && typeof h.lat === "number" && typeof h.lon === "number")) noCoord++;
  }
}
ck("历史模板批次指纹已加载（1572 条禁用名单）", batchFingerprint.size > 1000, "指纹=" + batchFingerprint.size);
ck("HOSPITALS 未混入任何历史模板批次条目", batchHit === 0, "命中=" + batchHit + "/总数=" + hospN);
ck("HOSPITALS 每条带核验坐标", noCoord === 0, "缺坐标=" + noCoord);
ck("HOSPITALS 无单字残缺名", truncHosp === 0, "残缺=" + truncHosp);
const mergeSrc = read("tools/_apply-safe.mjs") + read("tools/pack-data.mjs");
ck("历史模板批次 _hospital-batch4/5/6 未被任何合并管线引用",
  !/_hospital-batch[456]\.json/.test(mergeSrc));
ck("候选池未被直接 require 进运行包（保持离线核验边界）",
  !/official-roster\/candidates/.test(read("utils/data.js") + read("utils/emergency-data.js")));

console.log("");
if (fail) { console.log("离线数据真实性门禁失败：" + fail + " 项 / 共 " + (pass + fail) + " 项"); process.exit(1); }
console.log("离线数据真实性门禁通过：" + pass + " 项");
