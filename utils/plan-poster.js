// 行程页 · 分享长图 / 转发卡片 的纯绘制与模型函数
// 从 pages/plan/plan.js 抽出（v1.19.109）：核心页只保留事件/数据逻辑，canvas 绘制隔离到本模块，
// 全部为纯函数（不依赖 this / 页面实例），既降低核心页体积，也便于单测与维护。
// 注意：本模块只负责「画」，canvas 节点的获取、临时文件导出、页面状态（__shareImg 等）仍在 plan.js。

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx, text, maxW, fontPx) {
  text = String(text == null ? "" : text);
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

// 朋友圈/群分享长图模型（对齐原 _posterModel）
function posterModel(data, plan) {
  const d = data || {};
  const p = plan || {};
  const cityName = p.cityName || d.summary || "旅行攻略";
  const days = (d.view || []).slice(0, 6).map((day) => {
    const items = (day.items || []).filter(it => !it.f).slice(0, 6).map(it => ({ t: it.period || "", n: (it.disp || it.name || "") }));
    return { theme: day.theme || "行程", dateText: day.dateText || "", items };
  });
  let spots = 0; days.forEach(dd => spots += dd.items.length);
  const mode = d.modeTxt || "平衡舒适";
  const headH = 168, statH = 72, itemH = 40, footH = 100, padX = 40;
  let bodyH = statH + 28;
  days.forEach(dd => { bodyH += 46 + dd.items.length * itemH + 14 + 16; });
  const H = headH + bodyH + footH;
  return { W: 600, H, padX, cityName, days, spots, mode, daysN: days.length };
}

function drawPoster(ctx, cw, m) {
  const PAD = m.padX;
  const GOLD = "#d4a94e", NAVY = "#16263f", NAVY2 = "#0e1830", DAYBG = "#f6f7f5", SUB = "#6b7280", DARK = "#1c2533", LINE = "#e7e9ea";
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cw, m.H);
  const g = ctx.createLinearGradient(0, 0, cw, 180); g.addColorStop(0, NAVY); g.addColorStop(1, NAVY2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, 168);
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  ctx.fillStyle = "rgba(212,169,78,0.95)"; ctx.font = "20px sans-serif"; ctx.fillText("TRAVEL PLAN · 微信小程序", PAD, 48);
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 46px sans-serif"; ctx.fillText(fit(ctx, m.cityName, cw - PAD * 2, 46), PAD, 104);
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "22px sans-serif";
  ctx.fillText(m.daysN + " 天 · " + m.mode + " · " + m.spots + " 个景点", PAD, 142);
  let y = 168 + 24; const sw = (cw - PAD * 2 - 24) / 3, sh = 72;
  [["天数", String(m.daysN)], ["景点", String(m.spots)], ["模式", m.mode]].forEach((s, i) => {
    const x = PAD + i * (sw + 12);
    ctx.fillStyle = DAYBG; rrect(ctx, x, y, sw, sh, 12); ctx.fill();
    ctx.textAlign = "center"; ctx.fillStyle = GOLD; ctx.font = "bold 30px sans-serif";
    ctx.fillText(fit(ctx, s[1], sw - 20, 30), x + sw / 2, y + 38);
    ctx.fillStyle = SUB; ctx.font = "18px sans-serif"; ctx.fillText(s[0], x + sw / 2, y + 60);
  });
  ctx.textAlign = "left";
  let yy = y + sh + 28;
  m.days.forEach((dd, di) => {
    const dh = 46 + dd.items.length * itemH + 14;
    ctx.fillStyle = DAYBG; rrect(ctx, PAD, yy, cw - PAD * 2, dh, 14); ctx.fill();
    ctx.fillStyle = GOLD; ctx.font = "bold 24px sans-serif"; ctx.fillText("DAY " + (di + 1), PAD + 18, yy + 32);
    ctx.fillStyle = DARK; ctx.font = "bold 24px sans-serif"; ctx.fillText(fit(ctx, dd.theme, cw - PAD * 2 - 130, 24), PAD + 110, yy + 32);
    if (dd.dateText) { ctx.fillStyle = SUB; ctx.font = "18px sans-serif"; ctx.textAlign = "right"; ctx.fillText(dd.dateText, cw - PAD - 18, yy + 30); ctx.textAlign = "left"; }
    let iy = yy + 32 + 24;
    dd.items.forEach(it => {
      ctx.fillStyle = "#9aa3ad"; ctx.font = "18px sans-serif"; ctx.fillText(it.t || "", PAD + 22, iy);
      ctx.fillStyle = DARK; ctx.font = "20px sans-serif"; ctx.fillText(fit(ctx, it.n, cw - PAD * 2 - 130, 20), PAD + 110, iy);
      iy += itemH;
    });
    yy += dh + 16;
  });
  const fy = m.H - 96;
  ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PAD, fy); ctx.lineTo(cw - PAD, fy); ctx.stroke();
  ctx.fillStyle = GOLD; ctx.font = "bold 24px sans-serif"; ctx.textAlign = "left"; ctx.fillText("旅行攻略生成器", PAD, fy + 42);
  ctx.fillStyle = SUB; ctx.font = "18px sans-serif"; ctx.fillText("微信搜索同名小程序 · 离线可用 · 数据只存你手机", PAD, fy + 70);
}

// 转发卡片（5:4 黑金卡）模型（对齐原 _shareCardModel）
function shareCardModel(data, plan) {
  const d = data || {};
  const p = plan || {};
  const cityName = p.cityName || d.summary || "旅行攻略";
  const prov = (p.province && p.province !== cityName) ? p.province : "";
  const daysN = (p.days || []).length;
  let spots = 0;
  (d.view || []).forEach(day => (day.items || []).forEach(it => { if (!it.f) spots++; }));
  const mode = d.modeTxt || "平衡舒适";
  return { W: 750, H: 600, cityName, prov, daysN, spots, mode };
}

function drawShareCard(ctx, cw, m) {
  const GOLD = "#d4a94e", GOLD_L = "#e6bb62", NAVY = "#16263f", NAVY2 = "#0e1830";
  const g = ctx.createLinearGradient(0, 0, cw, m.H);
  g.addColorStop(0, NAVY); g.addColorStop(1, NAVY2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, m.H);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,.42)";
  ctx.font = "500 26px sans-serif";
  ctx.fillText("旅行攻略生成器", cw / 2, 92);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.globalAlpha = .65;
  ctx.beginPath(); ctx.moveTo(cw / 2 - 130, 122); ctx.lineTo(cw / 2 + 130, 122); ctx.stroke();
  ctx.globalAlpha = 1;
  const gg = ctx.createLinearGradient(0, 0, cw, 0);
  gg.addColorStop(0, GOLD_L); gg.addColorStop(1, GOLD);
  ctx.fillStyle = gg;
  ctx.font = "700 " + (m.cityName.length > 4 ? 96 : 120) + "px sans-serif";
  ctx.fillText(m.cityName, cw / 2, 300);
  const sub = (m.prov ? m.prov + " · " : "") + m.daysN + " 天" + (m.spots ? " · " + m.spots + " 个安排" : "") + " · " + m.mode;
  ctx.fillStyle = "rgba(255,255,255,.78)";
  ctx.font = "500 32px sans-serif";
  ctx.fillText(sub, cw / 2, 380);
  ctx.fillStyle = "rgba(212,169,78,.85)";
  ctx.font = "500 26px sans-serif";
  ctx.fillText("离线攻略 · 每月正当时，说走就走", cw / 2, 500);
}

module.exports = { rrect, fit, posterModel, drawPoster, shareCardModel, drawShareCard };
