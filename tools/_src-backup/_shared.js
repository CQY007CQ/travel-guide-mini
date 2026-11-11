// 跨模块共享的纯函数（无数据依赖，travel.js / planner.js 可在顶层直接 require）
// 收敛前：cleanSpotName 与 baikeKeyword 在 travel.js、planner.js 各定义一份，逻辑完全一致，
// 由本文件单点真源，两处改为引用，消除重复且避免日后两端漂移。
function cleanSpotName(name) {
  const raw = String(name || "").trim();
  let n = raw.replace(/^(?:继续深度游览|深度游览|出发前往|继续游览|凌晨出发，前往|抵达 \+ 直奔|抵达 \+ )\s*[「]?/, "").replace(/」$/, "");
  n = n.replace(/[（(【].*?[)）】]/g, "").trim();
  return n || raw;
}

function baikeKeyword(name) {
  let n = String(name || "").trim();
  if (!n) return "";
  n = n.replace(/^(?:继续深度游览|深度游览|出发前往|继续游览|凌晨出发，前往|抵达 \+ 直奔|抵达 \+ )\s*[「]?/, "").replace(/」$/, "");
  const parts = n.split(/\s*(?:\+|＋|、|\/)\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length) n = parts[0];
  return n.trim();
}

module.exports = { cleanSpotName, baikeKeyword };
