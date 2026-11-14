// subpkg/utils/coord.js —— 坐标有效性判定的单一真源（分包内复用，纯函数、可 Node 单测）
//
// v1.20.6：food / map 两页原先各写一份 `if (v.lat && v.lon)`，是典型的隐式 truthy 判断：
//   · WXML data-* 传过来的 "0"（字符串）是 truthy，会被当成有效坐标；
//   · NaN / null / 空串组合也可能漏判；
//   · (0,0) 是采集端「没取到坐标」的占位值，落到地图上就是几内亚湾的假 pin。
// 统一收敛到这里：数值化 + 有限性 + 非零三重判定。
// 零伪造：只判断「能不能用」，绝不补造、绝不吸附到城心。

const CN_BOUNDS = { minLat: 3.8, maxLat: 53.5, minLon: 73, maxLon: 135 };

/**
 * 是否具备可导航的真实坐标。
 * @param {object} v 含 lat / lon 的对象
 * @param {boolean} inChina 是否额外要求落在中国境内范围（默认 false，仅做基础有效性判断）
 */
function hasCoord(v, inChina) {
  if (!v || typeof v !== "object") return false;
  const la = +v.lat, lo = +v.lon;
  if (!isFinite(la) || !isFinite(lo) || la === 0 || lo === 0) return false;
  if (inChina && (la < CN_BOUNDS.minLat || la > CN_BOUNDS.maxLat || lo < CN_BOUNDS.minLon || lo > CN_BOUNDS.maxLon)) return false;
  return true;
}

// 观测口径：区分「(0,0) 占位」与「压根没有坐标」，供健康快照 / 体检门禁使用。
function classify(v) {
  if (!v || typeof v !== "object") return "missing";
  const la = +v.lat, lo = +v.lon;
  if (v.lat == null || v.lon == null || !isFinite(la) || !isFinite(lo)) return "missing";
  if (la === 0 || lo === 0) return "placeholder";
  return "ok";
}

module.exports = { hasCoord: hasCoord, classify: classify, CN_BOUNDS: CN_BOUNDS };
