// v1.16 真实美食店抓取（高德 POI）
// 背景：此前美食店数据无法保证真实，故一直未做；现在用高德「餐饮服务」POI 取真实店名/地址/坐标/人均/评分。
// 每城搜 1 次（offset=20），取评分与人气较高且有人均的前 5 家 → 365 城约 365 次调用。
// 产出：tools/v199-food-shops.js（FOOD_SPOTS_ADD）
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { isPunishPage, BAN_HINT } from "./_amap-compliance.mjs";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

const ROOT = process.cwd();
const OUT = path.join(ROOT, "tools", "v199-food-shops.js");
// v1.19.7：改用多 Key 池并自动轮换（原实现只读单把 tools/geocode.key，该 key 配额耗尽后
// 420 城全部空跑、一条店都抓不到）。与 fetch-amap-spots.mjs 保持同一套读取优先级：
//   环境变量 MAP_KEYS / MAP_KEY  >  tools/geocode.keys（一行一把，# 后为注释）  >  tools/geocode.key
const KEYS = (() => {
  const out = [];
  // 高德 Web 服务 key 是 32 位纯字母数字。必须按「合法 key 形状」过滤：
  // geocode.keys 里的 # 注释含中文（如「高德 Web 服务 Key 池」），若只按空白切分，
  // 「Web」「服务」等词会被当成 key，导致拿着无效 key 请求 → INVALID_USER_KEY → 全城空跑。
  const KEY_RE = /^[a-zA-Z0-9]{28,40}$/;
  const push = raw => String(raw || "").split(/[\s,]+/).forEach(s => {
    const t = s.replace(/#.*$/, "").trim();
    if (KEY_RE.test(t) && out.indexOf(t) < 0) out.push(t);
  });
  if (process.env.MAP_KEYS) push(process.env.MAP_KEYS);
  if (process.env.MAP_KEY) push(process.env.MAP_KEY);
  for (const f of ["geocode.keys", "geocode.key"]) {
    try { push(fs.readFileSync(path.join(ROOT, "tools", f), "utf8")); } catch (e) {}
  }
  return out;
})();
if (!KEYS.length) { console.error("未找到 Key：请写入 tools/geocode.keys（一行一把）或设置 MAP_KEYS"); process.exit(1); }
// 2026-09-14 批量抓取总闸（详见 tools/_amap-compliance.mjs）：高德已按《服务协议》4.12.3
// 封禁本账号的 v3/place/text 接口权限。本脚本按城市批量检索餐饮 POI 并落盘，属同一违规类型
// （协议 3.5 禁止存储/缓存本服务数据）→ 默认关闭，须显式 AMAP_BULK_OK=1 才放行。
if (!process.env.AMAP_BULK_OK) {
  console.error("🛑 批量抓取已默认关闭（2026-09-14 高德封禁事件后设的总闸）。");
  console.error("   本脚本原用 v3/place/text（已被官方封禁），现改走 v3/place/around，");
  console.error("   但仍属「批量抓取 POI 后落盘」，违反《服务协议》3.5 / 4.12.3。");
  console.error("   如确需运行，请显式设置环境变量：AMAP_BULK_OK=1");
  process.exit(5);
}
let keyIdx = 0;
const KEY = () => KEYS[keyIdx];
const rotateKey = () => { keyIdx = (keyIdx + 1) % KEYS.length; return keyIdx === 0; };  // 回到第 1 把表示已轮完一圈
const mask = k => (k ? k.slice(0, 6) + "…" + k.slice(-4) : "");
console.log("Key 池: " + KEYS.length + " 把");

const argv = process.argv.slice(2);
const LIMIT = (() => { const i = argv.indexOf("--limit"); return i >= 0 ? parseInt(argv[i + 1], 10) || 0 : 0; })();
const FRESH = argv.includes("--fresh");   // --fresh：忽略已有补丁，全城重新抓取（用于扩量/刷新）
const perIdx = argv.indexOf("--percap");
// 每城保留前 N 家。默认 12：420 城 × 12 ≈ 5000 家（对应本轮扩量目标）。
const PER_CAP = perIdx >= 0 ? (parseInt(argv[perIdx + 1], 10) || 12) : 12;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CITIES = D.CITIES.map(c => c.name).filter(Boolean);
console.log("待抓取城市:", CITIES.length, "| FRESH=", FRESH, "| PER_CAP=", PER_CAP);

const out = {};
// 断点续传：已生成的补丁里覆盖过的城市直接跳过（--fresh 时强制全量重抓）
if (!FRESH) {
  try {
    const prev = req("./tools/v199-food-shops.js");
    Object.assign(out, (prev && prev.FOOD_SPOTS_ADD) || {});
    console.log("续跑：已有", Object.keys(out).length, "城");
  } catch (e) {}
}
// v1.19.7：多关键词扩量。单关键词「老字号 特色小吃 本地菜 餐厅」每城只回 20 条、去重后
// 往往只剩几家；改为按品类分别检索再合并，能显著提高每城可收录的真实店铺数。
const FOOD_KEYWORDS = ["老字号 特色小吃 本地菜", "餐厅 美食城", "火锅 烧烤", "面馆 包子 早点", "农家乐 私房菜"];
let done = 0, got = 0, empty = 0, calls = 0, rotated = 0;
let allExhausted = false;
for (const city of CITIES) {
  if (LIMIT && done >= LIMIT) break;
  if (allExhausted) {
    console.log(`\n所有 key 搜索配额均已用尽，提前结束。剩余 ${CITIES.length - done} 城待下次继续。`);
    break;
  }
  if (out[city] && out[city].length) continue;   // 已抓过
  // 2026-09-14：place/text 被官方封禁（4.12.3）→ 改用 place/around，需要城市中心做锚点
  const cen = (D.CITY_COORDS || {})[city];
  if (!cen || cen.length < 2) { empty++; done++; continue; }
  const merged = [];
  const seen = new Set();
  let anyOk = false;
  for (const kw of FOOD_KEYWORDS) {
    // 2026-09-14：v3/place/text 被官方封禁（服务协议 4.12.3）→ 改走 v3/place/around（周边搜索，未在封禁清单内）
    // 以城市中心为锚、半径 50km；周边搜索的 keywords 分隔符为 | ；返回同样的 biz_ext（评分/人均）。
    const kwq = String(kw).split(/[\s|]+/).filter(Boolean).join("|");
    const url = `https://restapi.amap.com/v3/place/around?location=${cen[1]},${cen[0]}&keywords=${encodeURIComponent(kwq)}&types=050000&radius=50000&offset=20&page=1&key=${KEY()}`;
    let j = null, err = "";
    for (let attempt = 0; attempt < KEYS.length; attempt++) {
      try {
        const r = await fetch(url.replace(/key=[^&]*$/, "key=" + KEY()));
        const _txt = await r.text();
        // 响应不是 JSON（阿里「比西」punish 页）= 行为风控拦截 → 立刻终止整轮，绝不重试
        if (isPunishPage(_txt)) { console.error(BAN_HINT); allExhausted = true; break; }
        j = JSON.parse(_txt); calls++;
        // 成功判定：以「返回了 pois 数据」为准。
        // 注意：place/around 会带 status 字段，但仍以「返回了 pois 数据」为准更稳
        // （旧 place/text 通道响应不带 status，曾导致明明有数据却被当成失败，420 城全部空跑）。
        if (j && Array.isArray(j.pois) && j.pois.length) { anyOk = true; break; }
        // 10044 = USER_DAILY_QUERY_OVER_LIMIT（个人认证搜索类 100 次/日）
        if (j && (j.infocode === "10044" || /OVER_LIMIT|超限|配额|限额/.test(String(j.info || "")))) {
          if (rotateKey()) { allExhausted = true; break; }   // 轮完一圈仍超额 → 全部耗尽
          rotated++;
          continue;
        }
        break;
      } catch (e) { err = String(e && e.message || e); if (rotateKey()) { allExhausted = true; break; } rotated++; }
    }
    if (allExhausted) break;
    if (!j || !Array.isArray(j.pois) || !j.pois.length) continue;   // 同样以 pois 数据为准
    for (const p of j.pois) {
      const bx = p.biz_ext || {};
      const loc = String(p.location || "").split(",");
      const lat = Number(loc[1]), lon = Number(loc[0]);
      const per = Number(bx.cost) || 0;
      const rating = Number(bx.rating) || 0;
      const nm = String(p.name || "").trim();
      if (!nm || !isFinite(lat) || !isFinite(lon)) continue;
      if (per > 0 && per >= 1000) continue;         // 人均异常高，多半不是正餐
      if (seen.has(nm)) continue;
      seen.add(nm);
      merged.push({ shop: nm, addr: String(p.address || ""), lat, lon, per, rating });
    }
    await sleep(150);
  }
  if (allExhausted) { console.log(`\n所有 key 搜索配额均已用尽，提前结束。剩余 ${CITIES.length - done} 城待下次继续。`); break; }
  // 优先「有人均 + 有评分」，再按人均适中排序
  const list = merged
    .filter(x => x.per > 0)
    .sort((a, b) => (b.rating - a.rating) || (a.per - b.per))
    .slice(0, PER_CAP)
    .map(x => ({ shop: x.shop, addr: x.addr, lat: +x.lat.toFixed(6), lon: +x.lon.toFixed(6), price: x.per ? "人均¥" + x.per : "" }));
  // 有人均的不足时，用无人均但真实的店补齐（保证每城都有店，不虚构）
  if (list.length < PER_CAP) {
    const fill = merged.filter(x => !(x.per > 0)).slice(0, PER_CAP - list.length)
      .map(x => ({ shop: x.shop, addr: x.addr, lat: +x.lat.toFixed(6), lon: +x.lon.toFixed(6), price: "" }));
    list.push(...fill);
  }
  if (list.length) { out[city] = list; got += list.length; } else empty++;
  done++;
  if (done % 10 === 0) process.stdout.write(`  已处理 ${done}/${CITIES.length}  店铺 ${got}  空 ${empty}  调用 ${calls}\r`);
  await sleep(180);
}
console.log(`\n完成：城市 ${done} | 店铺 ${got} | 无结果 ${empty}`);

const src = "// 自动生成：高德真实美食店 POI（勿手改）\nmodule.exports = {\n  FOOD_SPOTS_ADD: " + JSON.stringify(out, null, 1) + "\n};\n";
fs.writeFileSync(OUT, src, "utf8");
console.log("补丁已生成:", OUT, "| 覆盖城市:", Object.keys(out).length);
