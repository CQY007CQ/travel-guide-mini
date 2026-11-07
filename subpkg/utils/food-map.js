/**
 * utils/food-map.js —— 「当地美食 → 供应它的店铺」匹配
 *
 * 背景：FOOD_SPOTS 里的 food 字段全库 0% 填充（历史数据只有店名/地址/坐标/价格），
 * 所以菜单与店铺的关系只能靠**店名与地址的词面匹配**推导，不能靠猜。
 *
 * 策略（三层，强到弱）：
 *   1. 品牌联想表 BRAND：把「北京烤鸭 → 全聚德/便宜坊/四季民福」这类常识做成显式映射
 *      （只适用于高频名菜，显式可审查，不是模型猜的）
 *   2. 菜名词根：去掉「正宗/老/特色」等修饰与括号，按「配/和/、」拆段后整串匹配
 *   3. 尾词兜底：核心词 ≥3 字时，用末两字再匹配一轮（"北京烤鸭" → "烤鸭"），
 *      命中项标记为弱匹配并排在强匹配之后
 *
 * 边界：无命中不编造，直接返回空数组，由页面回退到「本城推荐 + 说明」。
 */

// 高频名菜的品牌联想（公开常识级映射，可人工审查与增补）
const BRAND = {
  "北京烤鸭": ["全聚德", "便宜坊", "四季民福", "大董", "利群", "烤鸭"],
  "铜锅涮肉": ["东来顺", "聚宝源", "南门涮肉", "涮肉", "涮羊"],
  "炸酱面": ["炸酱面", "海碗居", "老北京面"],
  "卤煮火烧": ["卤煮"],
  "卤煮": ["卤煮"],
  "豆汁儿配焦圈": ["豆汁", "焦圈"],
  "麻婆豆腐": ["麻婆豆腐", "陈麻婆"],
  "龙抄手": ["抄手", "龙抄手"],
  "羊肉泡馍": ["泡馍", "老孙家", "同盛祥"],
  "肉夹馍": ["肉夹馍", "腊汁肉"],
  "小笼包": ["小笼", "南翔"],
  "生煎": ["生煎"],
  "酸汤鱼": ["酸汤鱼", "凯里"],
  "螺蛳粉": ["螺蛳粉"],
  "臭豆腐": ["臭豆腐"],
  "烧鹅": ["烧鹅", "烧腊"],
  "肠粉": ["肠粉"],
  "早茶": ["茶楼", "点心", "早茶", "酒家"],
  "锅贴": ["锅贴"],
  "水席": ["水席"],
  "牛肉汤": ["牛肉汤"],
  "豆腐汤": ["豆腐汤"],
  "浆面条": ["浆面条"],
  "不翻汤": ["不翻汤", "丸子汤"],
  "涮牛肚": ["涮牛肚", "牛肚"],
  "驴肉汤": ["驴肉汤"],
  "羊肉汤": ["羊肉汤"],
  "拉面": ["拉面", "牛肉面"],
  "米线": ["米线"],
  "火锅": ["火锅"],
  "串串": ["串串", "麻辣烫"],
};

// 修饰前缀（去掉后更容易命中店名）
const STRIP = /^(正宗|老字号|传统|特色|本地|地道|农家|名吃|风味|招牌|经典)/;

/** 把菜名拆成可匹配的词根：整串 + 去修饰串 + 分段串 */
function rootsOf(dish) {
  const raw = String(dish || "").replace(/[（(][^)）]*[)）]/g, "").trim();
  if (!raw) return [];
  const out = new Set();
  const parts = raw.split(/[配和、+＋/]/).map((x) => x.trim()).filter(Boolean);
  for (const p of parts) {
    if (p.length >= 2) out.add(p);
    const c = p.replace(STRIP, "");
    if (c.length >= 2) out.add(c);
  }
  return [...out];
}

/** 某道菜的匹配词：品牌联想（强） + 词根（强） + 尾两字（弱） */
function dishKeys(dish) {
  const strong = new Set();
  const weak = new Set();
  (BRAND[String(dish || "").trim()] || []).forEach((k) => strong.add(k));
  for (const r of rootsOf(dish)) {
    strong.add(r);
    if (r.length >= 3) weak.add(r.slice(-2));
  }
  // 弱词若已是强词则不重复
  for (const k of [...weak]) if (strong.has(k)) weak.delete(k);
  return { strong: [...strong], weak: [...weak] };
}

/**
 * 在城市店铺里找「做这道菜」的店
 * @returns {Array} 命中店铺（强匹配在前），元素附加 m 字段：2=强 1=弱
 */
function shopsForDish(shops, dish) {
  const list = Array.isArray(shops) ? shops : [];
  const { strong, weak } = dishKeys(dish);
  if (!strong.length && !weak.length) return [];
  const hit = [];
  for (const s of list) {
    const hay = (s.shop || "") + " " + (s.addr || "") + " " + (s.food || "");
    let m = 0;
    for (const k of strong) if (hay.indexOf(k) >= 0) { m = 2; break; }
    if (!m) for (const k of weak) if (hay.indexOf(k) >= 0) { m = 1; break; }
    if (m) hit.push(Object.assign({}, s, { m }));
  }
  hit.sort((a, b) => (b.m - a.m) || 0);
  return hit;
}

module.exports = { dishKeys, shopsForDish };
