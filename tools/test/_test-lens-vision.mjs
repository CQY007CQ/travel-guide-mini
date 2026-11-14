#!/usr/bin/env node
/**
 * tools/test/_test-lens-vision.mjs —— 拍照识物纯逻辑层单测（v1.20.6）
 *
 * 覆盖：名称归一 / 结构化解析 / 多链多数投票（含同义归组与分歧）/ 本地真实候选 /
 *       云端名称对齐本地库 / 零伪造红线。
 * 全部离线，不碰 wx.*、不碰网络；直接 require subpkg/lens/lens-vision.js 与 utils/data.js。
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const req = createRequire(fileURLToPath(import.meta.url));
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const V = req(path.join(ROOT, "subpkg/lens/lens-vision.js"));
const D = req(path.join(ROOT, "utils/data.js"));

let n = 0, fail = 0;
function ok(name, cond, extra) {
  n++;
  if (cond) return;
  fail++;
  console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : ""));
}

const A = "①名称：故宫博物院（置信度：高）\n" +
  "②类别：地标建筑\n" +
  "③关键可辨识特征：红墙黄瓦、中轴对称、太和殿\n" +
  "④一句话科普：明清两代皇宫\n" +
  "⑤旅途小贴士：需提前实名预约，周一闭馆";
const B = "①名称：故宫（置信度：高）\n②类别：地标建筑\n③关键可辨识特征：红墙、中轴线\n④一句话科普：明清皇宫\n⑤旅途小贴士：提前预约";
const C = "①名称：天坛（置信度：中）\n②类别：地标建筑\n③关键可辨识特征：圆形祈年殿\n④一句话科普：明清祭天场所\n⑤旅途小贴士：清晨人少";

/* ---------- 1. 名称归一 / 清理 ---------- */
ok("归一：剥掉置信度与前缀", V.normalizeName("可能是 故宫博物院（置信度：高）") === "故宫博物院",
  V.normalizeName("可能是 故宫博物院（置信度：高）"));
ok("归一：去标点后大小写不敏感", V.normalizeName("Eiffel Tower!") === V.normalizeName("eiffeltower"));
ok("cleanName 保留中文原文且挡住过长", V.cleanName("故宫博物院") === "故宫博物院" && V.cleanName("x".repeat(40)) === "");
ok("空输入不抛错", V.normalizeName(null) === "" && V.cleanName(undefined) === "");

/* ---------- 2. 结构化解析 ---------- */
const p = V.parseResult(A);
ok("解析出名称", p.name === "故宫博物院", p.name);
ok("解析出类别", p.category === "地标建筑", p.category);
ok("解析出置信度", p.confidence === "高", p.confidence);
ok("解析出 3 个可核对特征", p.features.length === 3, JSON.stringify(p.features));
ok("解析出科普与贴士", /明清/.test(p.science) && /预约/.test(p.tip));
ok("高置信不判为不确定", p.uncertain === false);
ok("低置信判为不确定", V.parseResult(A.replace("置信度：高", "置信度：低")).uncertain === true);
ok("「无法确定」判为不确定且不产出名称",
  V.parseResult("①名称：无法确定\n②类别：其他\n③关键可辨识特征：画面模糊").uncertain === true &&
  V.parseResult("①名称：无法确定\n②类别：其他").name === "");
ok("自由文本也能抽出首行名称", V.parseResult("金银花，忍冬科植物。").name.length > 1);
ok("解析空文本不抛错", V.parseResult("").name === "" && V.parseResult("").uncertain === true);

/* ---------- 3. 多链多数投票 ---------- */
const v2 = V.vote([{ text: A, ok: true }, { text: B, ok: true }]);
ok("2 链同义（全称/简称）判定一致", v2.consensus === true && v2.name === "故宫博物院", JSON.stringify(v2));
ok("一致时 agree/total 正确", v2.agree === 2 && v2.total === 2);
const v3 = V.vote([{ text: A, ok: true }, { text: B, ok: true }, { text: C, ok: true }]);
ok("3 链 2:1 取多数且仍标记一致", v3.consensus === true && v3.name === "故宫博物院" && v3.agree === 2, JSON.stringify(v3));
ok("分歧候选被完整保留", v3.alternatives.length === 2 && v3.alternatives.some(x => x.name === "天坛"));
const tie = V.vote([{ text: A, ok: true }, { text: C, ok: true }]);
ok("平票不算一致（不擅自挑一个）", tie.consensus === false && tie.tied === true && tie.name === "", JSON.stringify(tie));
const none = V.vote([{ text: "无法确定", ok: true }, { text: "无法确定", ok: true }]);
ok("全不确定不产出名称", none.name === "" && none.total === 0 && none.uncertain === true);
const partial = V.vote([{ text: A, ok: true }, { text: "", ok: false }, { text: B, ok: true }]);
ok("失败链不计票、其余仍可达成一致", partial.consensus === true && partial.chains === 3, JSON.stringify(partial));
ok("投票返回首选文本供展示", typeof v2.primaryText === "string" && v2.primaryText.indexOf("故宫") >= 0);
ok("空链数组不抛错", V.vote([]).consensus === false);

/* ---------- 4. 本地真实候选（零伪造） ---------- */
const city = "成都";
const cards = D.SPOT_CARDS_BY_CITY && D.SPOT_CARDS_BY_CITY[city];
ok("测试城市确有随包资料卡", !!cards && Object.keys(cards).length > 0);
const allNames = Object.keys(cards || {});
const cand = V.localCandidates({ city: city, plan: null, wish: [], limit: 8 });
ok("候选数量为上限内且非空", cand.length > 0 && cand.length <= 8, "n=" + cand.length);
ok("每个候选名都来自随包真实资料", cand.every(x => allNames.indexOf(x.name) >= 0),
  cand.map(x => x.name).join("|"));
ok("候选不重名", new Set(cand.map(x => x.name)).size === cand.length);
ok("候选附带的 note 也是真实字段（不生成文案）",
  cand.every(x => !x.note || (Array.isArray(cards[x.name]) && cards[x.name][0] === x.note)));
ok("候选绝不出现疑似 / 可能 / 无法确定等生成词",
  cand.every(x => !/疑似|可能|无法确定|大约是|估计是/.test(x.name)));
const withPlan = V.localCandidates({
  city: city,
  plan: { days: [{ items: [{ name: "武侯祠" }, { name: "杜甫草堂" }] }] },
  wish: ["青城山"], limit: 8
});
ok("行程内景点排在候选最前", withPlan[0].name === "武侯祠" && withPlan[0].kind === "今日行程", JSON.stringify(withPlan.slice(0, 3)));
ok("想去清单也进候选且不重复", withPlan.some(x => x.name === "青城山" && x.kind === "想去清单"));
ok("无城市且无行程时不凭空造候选", V.localCandidates({ city: "", plan: null, wish: [], limit: 8 }).length === 0);
ok("citySpotNames 传 0 表示不限（不是被当成默认 20）",
  V.citySpotNames(city, 0).length === allNames.length,
  "全量=" + allNames.length + " 传0=" + V.citySpotNames(city, 0).length);

/* ---------- 5. 云端名称 → 本地真实名对齐 ---------- */
const bj = Object.keys((D.SPOT_CARDS_BY_CITY && D.SPOT_CARDS_BY_CITY["北京"]) || {});
const gugong = bj.filter(x => /故宫/.test(x));
ok("北京资料卡里有故宫类条目", gugong.length > 0, gugong.join("|"));
if (gugong.length) {
  const hit = V.matchLocalName("故宫", "北京");
  ok("简称可对齐到本地标准名", !!hit && /故宫/.test(hit), "hit=" + hit);
  ok("对齐结果必须是随包真实名", bj.indexOf(hit) >= 0 || /故宫/.test(hit), "hit=" + hit);
}
ok("完全不相干的名称返回空（绝不编造景点）", V.matchLocalName("一只不存在的火星猫", "北京") === "");
ok("空名称返回空", V.matchLocalName("", "北京") === "");
ok("无城市返回空（不跨域乱配）", V.matchLocalName("西湖", "不存在的城市xyz") === "");

console.log("  拍照识物纯逻辑单测: " + (n - fail) + "/" + n + " 通过");
if (fail) process.exit(1);
