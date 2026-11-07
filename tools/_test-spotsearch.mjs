// 回归：「按标签找景点」标注词库 + 倒排检索引擎（v1.19.163）
// 覆盖：
//  1) 词库规模（50 标签 / 7 维度）
//  2) parseQueryTags 词重叠抑制（"雪山"→snowmtn 而非 mountain，避免假山/公园被拉入）
//  3) tagSpot 单景点标注合理（玉龙雪山→高原雪山；丽江古城→古镇古城）
//  4) searchSpots 精确锁定：雪山/古镇/免费海边 命中目标标签；秋天红叶小众 以秋季优先（IDF）
//  5) 范围限定：city 过滤只返回该城
//  6) 文本兜底：无识别标签时按子串命中（故宫）
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");
const ST = req("./utils/spot-tags.js");
const SS = req("./subpkg/utils/spotsearch.js");

let fail = 0;
const ok = (n, c) => { console.log((c ? "  ✓ " : "  ✗ FAIL: ") + n); if (!c) fail++; };

SS.prefetch(D);

// 1) 词库规模
ok("词库共 50 个标签", ST.TAGS.length === 50);
ok("覆盖 7 个维度", Object.keys(ST.DIM_LABELS).length === 7);

// 2) 词重叠抑制
const p1 = ST.parseQueryTags("雪山");
ok("「雪山」只命中 snowmtn（不被 mountain 的『山』带偏）", p1.length === 1 && p1[0] === "snowmtn");
const p2 = ST.parseQueryTags("带娃 雪山");
ok("「带娃 雪山」→ [family, snowmtn]", p2.indexOf("family") >= 0 && p2.indexOf("snowmtn") >= 0 && p2.indexOf("mountain") < 0);
const p3 = ST.parseQueryTags("秋天看红叶小众");
ok("「秋天看红叶小众」→ [autumn, quiet]", p3.indexOf("autumn") >= 0 && p3.indexOf("quiet") >= 0 && p3.length === 2);

// 3) 单景点标注
const yulong = ST.tagSpot({ name: "玉龙雪山", period: "全天", note: "大索道登顶4680米" }, { name: "丽江" });
ok("玉龙雪山含 高原雪山", yulong.indexOf("snowmtn") >= 0);
ok("玉龙雪山含 山岳名峰（雪不去重 mountain）", yulong.indexOf("mountain") >= 0);
const gucheng = ST.tagSpot({ name: "丽江古城", period: "全天", note: "纳西族古城，慢逛" }, { name: "丽江" });
ok("丽江古城含 古镇古城", gucheng.indexOf("oldtown") >= 0);

// 4) 检索精确锁定
const rSnow = SS.searchSpots({ text: "雪山", D, limit: 5 });
ok("「雪山」有结果", rSnow.results.length > 0);
ok("「雪山」Top1 命中高原雪山", (rSnow.results[0].reasons || []).indexOf("高原雪山") >= 0);

const rOld = SS.searchSpots({ text: "人少的古镇", D, limit: 5 });
ok("「人少的古镇」Top1 命中古镇古城", (rOld.results[0].reasons || []).indexOf("古镇古城") >= 0);

const rFree = SS.searchSpots({ text: "免费 海边", D, limit: 10 });
ok("「免费 海边」存在同时命中 海滨海岛+免费开放 的结果", rFree.results.some(x => (x.reasons || []).indexOf("海滨海岛") >= 0 && (x.reasons || []).indexOf("免费开放") >= 0));

// IDF：稀有目标标签（秋季适宜）应优先于常见过滤（人少小众）
const rAut = SS.searchSpots({ text: "秋天 看红叶 小众", D, limit: 6 });
ok("「秋天看红叶小众」Top1 以秋季适宜优先（非仅小众）", (rAut.results[0].reasons || []).indexOf("秋季适宜") >= 0);

// 5) 范围限定
const rHb = SS.searchSpots({ text: "滑雪 温泉", city: "哈尔滨", D, limit: 20 });
ok("范围限定哈尔滨：结果全部属于哈尔滨", rHb.results.length > 0 && rHb.results.every(x => x.city === "哈尔滨"));

// 6) 文本兜底
const rGugong = SS.searchSpots({ text: "故宫", D, limit: 10 });
ok("文本兜底「故宫」命中名称含故宫的景点", rGugong.results.length > 0 && rGugong.results.some(x => x.name.indexOf("故宫") >= 0));

console.log(fail === 0 ? "\n✅ 全部通过" : "\n❌ 失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);
