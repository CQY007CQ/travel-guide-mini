/**
 * tools/lib-near-dup.mjs —— 景点「同一性」判定的单一真源
 *
 * 背景（真实事故）：
 *   _apply-safe.mjs 写入坐标时用「名称包含 + 坐标 <3km」判近似重复并丢弃，
 *   而 _geocode-all-missing.mjs 找缺失景点时只按**精确名称**比对 SPOT_COORDS。
 *   两者判定不一致 → 「九寨沟风景名胜区」被判缺失 → geocode 回来 → 因 SPOT_COORDS 已有
 *   「九寨沟」且距离 <3km 被丢弃 → 下一轮又判缺失 …… 每日任务连续多天「命中 46」却零新增。
 *
 * 因此把规则抽到这里，两个工具共用，避免再次漂移。
 *
 * 关于「为什么要丢弃而不是改名保留」：
 *   坐标表在「全省游」的省域扫描里按名匹配，如果同城出现「劳动公园」与「大连劳动公园」两条
 *   相距 <3km 的记录，短名会被先匹配到，导致跨城重名把景点指到错误城市
 *   （历史事故：辽宁·劳动公园 从朝阳市被改指到大连）。所以宁可丢弃冗余条目，
 *   也不能让短名重复出现。
 */

/** 两点球面距离（km）。入参顺序 [名, 纬度, 经度] */
export function km(a, b) {
  const R = 6371;
  const dLa = (b[1] - a[1]) * Math.PI / 180;
  const dLo = (b[2] - a[2]) * Math.PI / 180;
  const la1 = a[1] * Math.PI / 180;
  const la2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 判断待写入条目 x 是否已被 list 中的某条"实质上覆盖"。
 * 规则：名称互相包含（短名 ≥3 字）且相距 < 3km。
 * @param {Array} list 已有条目数组，元素形如 ["景点名", lat, lng]
 * @param {Array} x    待判定条目，形如 ["景点名", lat, lng]
 */
export function isNearDup(list, x) {
  const n = String(x[0]);
  return list.some((y) => {
    if (!y || !y[0]) return false;
    const m = String(y[0]);
    if (m === n) return false; // 同名交给调用方的新旧去重
    const [short, long] = m.length <= n.length ? [m, n] : [n, m];
    if (short.length < 3 || long.indexOf(short) < 0) return false;
    return km(y, x) < 3;
  });
}

/** 便捷封装：某个景点名在该城已有坐标表里是否已被覆盖（含近似重复） */
export function isCovered(list, name, lat, lng) {
  if (!Array.isArray(list) || !list.length) return false;
  if (list.some((y) => y && y[0] === name)) return true;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  return isNearDup(list, [name, lat, lng]);
}

/**
 * 与产品 getSpotCoord(fuzzy) 对齐：同城坐标表里已有名称与候选名互相包含（均 ≥2 字）即视为已覆盖。
 * 用途：_geocode-all-missing 用它判断"是否还需要补坐标"，避免全称景点永远被判缺失。
 * 与 isNearDup 的差别：这里不要求距离 <3km —— 因为此刻还没有候选坐标。
 */
export function isCoveredByName(list, name) {
  if (!Array.isArray(list) || !list.length) return false;
  const n = String(name);
  if (n.length < 2) return false;
  for (const y of list) {
    if (!y || !y[0]) continue;
    const k = String(y[0]);
    if (k === n) return true;
    if (k.length >= 2 && (n.indexOf(k) >= 0 || k.indexOf(n) >= 0)) return true;
  }
  return false;
}
