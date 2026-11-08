// 官方公开名录采集 + 校验管线（美食店 / 医院）
//
// 用法：
//   node tools/_collect-official-roster.mjs --fetch   # 宿主网络抓取各官方源到 cache/（需 dangerouslyDisableSandbox）
//   node tools/_collect-official-roster.mjs           # 离线：只读 cache/ 重新解析并生成候选池
//
// 设计原则（对齐 utils/emergency-data.js 的合规口径）：
//   1. 只采「官方公示里的具名机构」，逐条带 source 官方 URL + authority + collected；
//   2. 无来源、模板名（城名 + 人民医院/中医院…批量拼接）、残缺名一律拒绝；
//   3. 候选池 verified=false / coord=null —— 未做地址核验与坐标定位，绝不冒充可导航医院，
//      也不直接写入 HOSPITALS / FOOD_SPOTS。要真正入库须另行做地址核验 + 坐标（合规 AMap key）。
//   4. 全流程可离线复跑：cache/ 不进 git，candidates.json 进 git 且自带来源，随时可复核。
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const ROOT = process.cwd();
const REG = path.join(ROOT, "tools", "official-roster-sources.json");
const DIR = path.join(ROOT, "tools", "official-roster");
const CACHE = path.join(DIR, "cache");
const OUT = path.join(DIR, "candidates.json");
const FETCH = process.argv.includes("--fetch");

const reg = JSON.parse(fs.readFileSync(REG, "utf8"));
fs.mkdirSync(CACHE, { recursive: true });

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function decode(buf) {
  // 政府站点编码混杂（UTF-8 / GB2312 / GBK）。优先严格 UTF-8，失败回落 GB18030。
  for (const enc of ["utf-8", "gb18030"]) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch (e) {}
  }
  return new TextDecoder("utf-8").decode(buf);
}
function decodeEntities(s) {
  return s.replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-zA-Z]{2,8};/g, " ");
}
function toText(html) {
  const s = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s).replace(/\s+/g, " ");
}

// 公文/导航里常出现的伪机构名：一律排除，避免把「关于加强三级公立医院」当医院收进来。
const DOC_WORDS = [
  "关于", "通知", "参加", "考核", "名录", "名单", "平台", "上传", "工作", "要求", "管理",
  "系统", "信息", "发展", "建设", "附件", "做好", "推进", "会议", "监测", "统计", "公示",
  "三级", "二级", "公立", "绩效", "质量", "改革", "服务", "能力", "标准", "办法", "意见",
  "各省", "全国", "有关", "以及", "和", "及", "的", "等", "将", "按照", "通过", "确定",
  "公布", "结果", "评审", "复核", "委", "部门", "机构", "单位", "序号", "备注", "组织", "请各",
  "参评", "年度", "各附属", "家医院"
];
// 残缺/模板名特征：历史 _hospital-batch4/5/6 全是这种「城名 + 类型」拼接，且常带单字地名。
const TAIL = /(?:人民医院|中医院|中心医院|妇幼保健院|第一人民医院|中医院)$/;
// 起始字符必须是中文/字母，避免把「）组织对无锡市人民医院」这类前文残片一起吞进来。
const NAME_RE = /[A-Za-z\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9（）()·]{1,39}?(?:医院|妇幼保健院|防治院|防治所|卫生院|医疗中心)/g;

function isTruncated(n) {
  // 「阿人民医院」「昌中医院」这类：去掉机构类型后只剩 1 个字 → 明显截断
  const stem = n.replace(/(?:第一|第二|第三)?(?:人民|中心|中医)?(?:医院|妇幼保健院|防治院|防治所|卫生院|医疗中心)$/, "");
  return stem.length <= 1;
}
function isTemplateish(n) {
  // 形如「XX人民医院」且 XX 是纯地名（2-4 字、无「附属/大学/第/市/区/县」等具名特征）
  if (!TAIL.test(n)) return false;
  const stem = n.replace(TAIL, "");
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(stem)) return false;
  return !/(附属|大学|学院|医科|中医药|区|县|市|镇|矿|集团|第)/.test(stem);
}
// 通用类型词 / 办医主体被截断出的伪机构名（实测「申康医院」「中西医结合医院」会混进来）
const GENERIC_ORG = new Set([
  "人民医院", "中医院", "中心医院", "中西医结合医院", "综合医院", "专科医院", "综合中医医院",
  "妇幼保健院", "儿童医院", "肿瘤医院", "口腔医院", "传染病医院", "精神病院", "申康医院", "区级医院"
]);
// 公文句子被正则截断后，常以虚词/动词开头（「请各医院」「并指导各区级医院」）
// ⚠️ 不要放「上/中/下/前/后」等单字：上海市第一人民医院、中国人民解放军… 都会被误杀。
const LEAD_BAD = /^(请|并|各|为|在|对|把|从|由|向|与|及|或|该|本|其|将|已|未|可|应|须|如|按|据|使|让|给|被|且|但|而|则|即|另|又|还|也|就|均|共|总|含|到|至|以|于|等|所)/;
function validate(n) {
  if (typeof n !== "string") return "非字符串";
  if (n.length < 4 || n.length > 30) return "长度异常";
  if (!/[\u4e00-\u9fa5]/.test(n)) return "无中文";
  if (GENERIC_ORG.has(n)) return "通用类型名";
  if (LEAD_BAD.test(n)) return "公文截断句";
  if (/(?:省|市)医院$/.test(n) && n.length <= 7) return "疑似截断行政区名";
  if (/[（）()]/.test(n) && !/(附属|分院|院区)/.test(n)) return "含括号残片";
  for (const w of DOC_WORDS) if (n.indexOf(w) >= 0) return "公文词:" + w;
  if (isTruncated(n)) return "残缺名";
  if (isTemplateish(n)) return "模板名";
  return "";
}

const sources = [], items = [], rejected = {};
const seen = new Set();
function reject(why) { rejected[why] = (rejected[why] || 0) + 1; }

for (const src of (reg.sources || [])) {
  if (!src.enabled) { console.log("跳过（未启用）:", src.id, src.blocked || ""); continue; }
  const file = path.join(CACHE, src.id + ".html");
  if (FETCH) {
    try {
      execFileSync("curl", ["-sS", "-L", "--max-time", "40", "-A", UA, "-o", file, src.url], { stdio: "pipe" });
    } catch (e) {
      console.error("抓取失败:", src.id, e.message);
      process.exitCode = 1;
      continue;
    }
  }
  if (!fs.existsSync(file)) {
    console.error("缺缓存:", file, "—— 先跑 node tools/_collect-official-roster.mjs --fetch");
    process.exitCode = 1;
    continue;
  }
  const buf = fs.readFileSync(file);
  if (buf.length < 2000) { console.error("内容过小，疑似拦截页:", src.id, buf.length); process.exitCode = 1; continue; }
  const text = toText(decode(buf));
  const found = text.match(NAME_RE) || [];
  let kept = 0;
  for (const raw of found) {
    const n = raw.trim();
    const why = validate(n);
    if (why) { reject(why); continue; }
    const key = (src.prov || "") + "|" + (src.city || "") + "|" + n;
    if (seen.has(key)) { reject("重复"); continue; }
    seen.add(key);
    items.push({
      n,
      kind: src.kind,
      city: src.city || "",
      prov: src.prov || "",
      authority: src.authority,
      source: src.url,
      collected: src.collected,
      verified: false,
      coord: null
    });
    kept++;
  }
  sources.push({ id: src.id, authority: src.authority, url: src.url, bytes: buf.length, textLen: text.length, raw: found.length, kept });
  console.log(src.id.padEnd(12), "原文", String(found.length).padStart(4), "→ 通过", String(kept).padStart(4), "|", src.authority);
}

const result = {
  generated: new Date().toISOString().slice(0, 10),
  policy: reg._policy,
  blocked: reg._blocked,
  count: items.length,
  sources,
  rejected,
  items
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
console.log("候选池:", OUT, "| 具名条目", items.length, "| 已启用源", sources.length);
console.log("过滤原因 TOP:", Object.entries(rejected).sort((a, b) => b[1] - a[1]).slice(0, 8));
console.log("提示: verified=false 条目不得直接并入 HOSPITALS/FOOD_SPOTS，需先做地址核验 + 坐标。");
