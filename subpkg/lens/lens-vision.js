// lens-vision.js —— 拍照识物的纯逻辑层（放在 assistant/lens 分包，主包零增长）
//
// 职责：名称归一、结构化结果解析、多链多数投票、本地真实资料候选、云端名称对齐本地库。
// 铁律：本文件不产生任何「事实」。所有候选名称 / 简介都只能来自 utils/data.js 的真实随包数据，
//       解析与投票只做文本处理，绝不因为模型说得含糊就补一个像模像样的名字（零伪造）。
// 纯函数：不碰 wx.*、不碰网络、不写存储，便于 Node 单测与网页端同源复用。

const D = require("../../utils/data.js");

var UNCERTAIN_RE = /无法确定|不确定|不清楚|不太确定|难以确定|无法确认|不能确认|疑似|存疑|我无法|也许是|大概是/;
var PREFIX_RE = /^(这是|可能是|疑似|大概率是|应为|应该是|我认为是|估计是|或为|一张|照片里(?:的|是)?)\s*/;
var GENERIC_SUFFIX = /(?:国家)?(?:博物院|博物馆|风景名胜区|风景区|旅游度假区|旅游区|景区|遗址公园|国家公园|主题公园|公园|古镇|古城)$/;

// ── 1. 名称归一 ────────────────────────────────────────────────────────────
function normalizeName(s) {
  var t = String(s == null ? "" : s).trim();
  if (!t) return "";
  t = t.replace(/^[①-⑩\s]*名称\s*[：:]\s*/, "");
  t = t.replace(/[（(]?\s*置信度?\s*[:：]?\s*(高|中|低)\s*[）)]?/g, "");
  t = t.replace(PREFIX_RE, "");
  t = t.replace(/\s*[（(][^）)]*[）)]\s*$/, "");            // 尾部括号别名
  t = t.replace(/[\s，。；：、,.;:！!？?"'"'【】\[\]<>《》\-—_]/g, "");
  t = t.toLowerCase();
  return t.length > 30 ? "" : t;
}

// 名称原文清理（保留大小写与中文，供展示 / spotLookup）
function cleanName(s) {
  var t = String(s == null ? "" : s).trim();
  t = t.replace(/^[①-⑩\s]*名称\s*[：:]\s*/, "");
  t = t.replace(/[（(]?\s*置信度?\s*[:：]?\s*(高|中|低)\s*[）)]?/g, "");
  t = t.replace(PREFIX_RE, "");
  t = t.replace(/\s*[（(][^）)]*[）)]\s*$/, "");
  t = t.replace(/^[\s，。；：、,.;:]+|[\s，。；：、,.;:]+$/g, "");
  return (t.length > 1 && t.length <= 30) ? t : "";
}

// ── 2. 结构化结果解析 ──────────────────────────────────────────────────────
// 兼容带圈号编号、纯文本冒号、以及模型偶尔不按格式作答（此时至少抽出名称）。
function section(text, labels) {
  var t = String(text || "");
  for (var i = 0; i < labels.length; i++) {
    var re = new RegExp("(?:^|\\n)\\s*(?:[①-⑩]\\s*)?" + labels[i] + "\\s*[：:]\\s*([^\\n]*)");
    var m = t.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return "";
}

function parseResult(text) {
  var raw = String(text || "").trim();
  var nameLine = section(raw, ["名称", "主体名称", "最可能是什么"]) ||
    (function () {
      var m = raw.match(/名称\s*[：:]\s*([^\n]+)/);
      return m ? m[1].trim() : "";
    })();
  var name = cleanName(nameLine);
  if (!name) {
    // 兜底：首行首个词组（不生成任何新词，只截取模型原文）
    var lines = raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 1; });
    if (lines.length) {
      var first = lines[0].replace(/^[①-⑩\s]+/, "").replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, "");
      name = cleanName(first.split(/[，。；：、（）()【】\s]/)[0] || "");
    }
  }
  var confidence = "";
  var cm = raw.match(/置信度\s*[：:]?\s*(高|中|低)/);
  if (cm) confidence = cm[1];
  var category = section(raw, ["类别", "大类", "所属类别"]);
  var featureLine = section(raw, ["关键可辨识特征", "可辨识特征", "判别特征", "特征"]);
  var features = featureLine ? featureLine.split(/[、；;,，]/).map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 1; }).slice(0, 4) : [];
  var science = section(raw, ["一句话科普", "科普"]);
  var tip = section(raw, ["旅途小贴士", "小贴士", "提示"]);
  var uncertain = !name || UNCERTAIN_RE.test(raw) || confidence === "低" || /^(无法确定|不确定|不清楚)/.test(name);
  return {
    name: uncertain ? "" : name,
    rawName: name,
    category: category || "",
    confidence: confidence || "",
    features: features,
    science: science || "",
    tip: tip || "",
    uncertain: !!uncertain,
    raw: raw
  };
}

// ── 3. 多链多数投票 ────────────────────────────────────────────────────────
// chains: [{ text, ok }] —— 每条是一次独立识别链的原文。
// 规则：只对「解析出明确名称」的链计票；「无法确定」不计票（不算反对，也不算赞成）。
//       consensus 仅在 >=2 条有效链且最高票 >=2 时成立；平票 / 全分歧一律标不确定，
//       由 UI 展示分歧候选交用户人工确认，绝不擅自挑一个当成结论。
// 投票键：先剥通用后缀（「故宫博物院」→「故宫」），避免同一实体因全称/简称被误判为分歧。
function voteKey(name) {
  var k = normalizeName(name);
  var s = k.replace(GENERIC_SUFFIX, "");
  return (s && s.length >= 2) ? s : k;
}
function sameKey(a, b) {
  if (a === b) return true;
  var short = a.length <= b.length ? a : b;
  var long = a.length <= b.length ? b : a;
  return short.length >= 2 && long.indexOf(short) >= 0;
}
function vote(chains) {
  var list = Array.isArray(chains) ? chains : [];
  var counts = [], valid = 0;
  for (var i = 0; i < list.length; i++) {
    var c = list[i] || {};
    if (c.ok === false || !c.text) continue;
    var p = parseResult(c.text);
    if (p.uncertain || !p.name) continue;
    valid++;
    var k = voteKey(p.name);
    if (!k) continue;
    var hit = null;
    for (var z = 0; z < counts.length; z++) {
      if (sameKey(counts[z].key, k)) { hit = counts[z]; break; }
    }
    if (!hit) { hit = { name: p.name, key: k, count: 0, text: c.text }; counts.push(hit); }
    hit.count++;
  }
  counts.sort(function (a, b) { return b.count - a.count; });
  var top = counts[0] || null;
  var tie = counts.length > 1 && counts[1].count === (top ? top.count : 0);
  var consensus = !!top && top.count >= 2 && !tie && valid >= 2;
  var alternatives = counts.map(function (x) { return { name: x.name, count: x.count }; });
  var primaryText = "";
  if (consensus && top) primaryText = top.text;
  else {
    for (var j = 0; j < list.length; j++) {
      if (list[j] && list[j].ok !== false && list[j].text) { primaryText = list[j].text; break; }
    }
  }
  return {
    name: consensus ? top.name : "",
    consensus: consensus,
    agree: top ? top.count : 0,
    total: valid,
    tied: !!tie,
    alternatives: alternatives,
    primaryText: primaryText,
    chains: list.length,
    uncertain: !consensus
  };
}

// ── 4. 本地真实资料候选（离线对照，零伪造） ────────────────────────────────
// 只在本地库里取名字；note 也只取随包真实字段，取不到就留空，绝不写「疑似…」之类的话。
// 用途：云端不可用时给用户一个诚实的出口 —— 本机不做图像识别，请对照照片自己确认。
// limit：默认 20；传 0 表示「不限」（matchLocalName 需要同城全量真实名做对齐）。
function citySpotNames(city, limit) {
  var out = [];
  var max = (limit == null) ? 20 : limit;
  var cards = (D.SPOT_CARDS_BY_CITY && D.SPOT_CARDS_BY_CITY[city]) || null;
  if (cards && typeof cards === "object") {
    for (var n in cards) {
      if (!Object.prototype.hasOwnProperty.call(cards, n)) continue;
      var v = cards[n];
      var note = (Array.isArray(v) && typeof v[0] === "string") ? v[0] : "";
      out.push({ name: n, note: note, kind: "随包收录" });
      if (max > 0 && out.length >= max) break;
    }
  }
  return out;
}

function localCandidates(opts) {
  opts = opts || {};
  var city = String(opts.city || "").trim();
  var plan = opts.plan || null;
  var wish = Array.isArray(opts.wish) ? opts.wish : [];
  var limit = opts.limit || 8;
  var seen = {}, out = [];
  function push(name, note, kind) {
    var n = String(name || "").trim();
    if (!n || n.length > 30) return;
    var k = normalizeName(n);
    if (!k || seen[k]) return;
    seen[k] = 1;
    out.push({ name: n, note: String(note || "").trim(), city: city, kind: kind });
  }
  // 行程内景点优先（用户此刻最可能正在拍的东西）
  if (plan && Array.isArray(plan.days)) {
    for (var d = 0; d < plan.days.length && out.length < limit; d++) {
      var items = (plan.days[d] && plan.days[d].items) || [];
      for (var i = 0; i < items.length && out.length < limit; i++) {
        var it = items[i] || {};
        push(it.name || it.disp, "", "今日行程");
      }
    }
  }
  for (var w = 0; w < wish.length && out.length < limit; w++) push(wish[w], "", "想去清单");
  var local = citySpotNames(city, limit * 2);
  for (var j = 0; j < local.length && out.length < limit; j++) {
    push(local[j].name, local[j].note, local[j].kind);
  }
  return out.slice(0, limit);
}

// ── 5. 云端名称 → 本地真实景点名对齐 ───────────────────────────────────────
// 只在随包真实名称里找；找不到返回 ""（由 UI 走「查景点」页搜索，绝不编造景点）。
function matchLocalName(name, city) {
  var key = normalizeName(name);
  if (!key) return "";
  var pool = citySpotNames(city, 0).map(function (x) { return x.name; });
  // 同城资料卡之外，再补同城坐标库与详情库里的真实键
  var more = (D.SPOT_DETAILS_BY_CITY && D.SPOT_DETAILS_BY_CITY[city]) || null;
  if (more && typeof more === "object" && !Array.isArray(more)) {
    for (var n in more) if (Object.prototype.hasOwnProperty.call(more, n)) pool.push(n);
  }
  var seen = {}, uniq = [];
  for (var i = 0; i < pool.length; i++) {
    var k = normalizeName(pool[i]);
    if (k && !seen[k]) { seen[k] = 1; uniq.push(pool[i]); }
  }
  // ① 完全一致
  for (var a = 0; a < uniq.length; a++) if (normalizeName(uniq[a]) === key) return uniq[a];
  // ② 去掉通用后缀后一致（「故宫博物院」↔「故宫」这类）
  var keyShort = key.replace(GENERIC_SUFFIX, "");
  if (keyShort && keyShort !== key) {
    for (var b = 0; b < uniq.length; b++) {
      var nb = normalizeName(uniq[b]);
      if (nb === keyShort || nb.replace(GENERIC_SUFFIX, "") === keyShort) return uniq[b];
    }
  }
  // ③ 双向包含（仅当较短一侧 >=2 字，避免「山」「寺」这种误命中）
  for (var c = 0; c < uniq.length; c++) {
    var nc = normalizeName(uniq[c]);
    if (!nc) continue;
    var short = key.length <= nc.length ? key : nc;
    var long = key.length <= nc.length ? nc : key;
    if (short.length >= 2 && long.indexOf(short) >= 0) return uniq[c];
  }
  return "";
}

module.exports = {
  normalizeName: normalizeName,
  cleanName: cleanName,
  parseResult: parseResult,
  vote: vote,
  citySpotNames: citySpotNames,
  localCandidates: localCandidates,
  matchLocalName: matchLocalName,
  UNCERTAIN_RE: UNCERTAIN_RE
};
