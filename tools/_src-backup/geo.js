// utils/geo.js —— 统一地球距离计算（合并原 travel.haversineKm 与 planner.haversine 及多处内联 R=6371）
//
// 为什么存在：此前距离计算散落在 travel.js（haversineKm、_havKm、两处 _km2）与 planner.js（haversine），
// 共 5 处近似实现，四舍五入与入参字段名（{lat,lon} vs {latitude,longitude}）还不一致。
// 收敛到这一处：入参兼容两种字段名、非法/缺字段返回 0（防 fuzz 崩溃）、统一保留 0.1km 精度。
// 纯函数、无依赖，避免与 travel/planner 的循环依赖。
function _num(...xs) {
  for (const x of xs) if (typeof x === "number" && isFinite(x)) return x;
  return NaN;
}
function haversine(a, b) {
  if (!a || !b) return 0;
  const la1 = _num(a.lat, a.latitude), lo1 = _num(a.lon, a.longitude);
  const la2 = _num(b.lat, b.latitude), lo2 = _num(b.lon, b.longitude);
  if (!isFinite(la1) || !isFinite(lo1) || !isFinite(la2) || !isFinite(lo2)) return 0;
  const R = 6371, p = Math.PI / 180;
  const dLa = (la2 - la1) * p, dLo = (lo2 - lo1) * p;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * p) * Math.cos(la2 * p) * Math.sin(dLo / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}
const haversineKm = haversine;
module.exports = { haversine, haversineKm };
