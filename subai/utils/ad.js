// 流量主 · 激励视频 —— 「看一次广告解锁全部城市深玩内容」
//
// ── 设计原则（先说清楚，免得以后写坏）────────────────────────────────
// ① **不抽取任何已有免费能力**：行程生成、地图、体检、日历导出、现有 And
//    当前城市的深度玩法 —— 全部保持免费、永远不加锁。
// ② **只给「新增内容」设解锁**：深玩页里切到「非当前行程城市」的内容，
//    看一次激励视频解锁当天全部城市（解锁状态存本地，到次日 0 点失效）。
// ③ **fail-open（故障放行）**：没有广告位 ID、没开流量主、不支持该 API、
//    加载失败、播放未完成以外的任何异常 —— 一律视为已解锁。
//    绝不因为广告出问题让用户看不了内容。
// ④ 广告只在用户**主动点击**时出现；没有插屏、没有 banner、不在首页/启动冻结。
//
// ── 开通步骤（待小程序 UV 累计 ≥1000 后）────────────────────────────
//   1) mp.weixin.qq.com → 推广 → 流量主 → 开通（个人主体可申请，不要求微信认证）
//   2) 广告位管理 → 新建「激励视频」广告位 → 复制 adUnitId
//   3) 把下面 AD_UNIT_ID 填进去，ENABLED 改成 true，重新上传即可生效

const S = require("../../utils/store.js");   // v1.20.4 #81：统一存储出口
const ENABLED = false;                 // 广告总开关（未开通前保持 false = 全免费全解锁）
const AD_UNIT_ID = "";                 // ← 开通后填激励视频广告位 ID（形如 adunit-xxxxxxxx）
const UNLOCK_KEY = "adUnlockV1";       // 本地解锁状态
const UNLOCK_HOURS = 20;               // 一次观看解锁的有效时长（小时）

function _todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

function _readRaw() {
  return S.getJSON(UNLOCK_KEY, null);
}

/** 激励视频是否真的可用（未开通 / 未填 ID / 环境不支持 → false → 调用方放行） */
function available() {
  if (!ENABLED || !AD_UNIT_ID) return false;
  try { return typeof wx.createRewardedVideoAd === "function"; } catch (e) { return false; }
}

/** 解锁是否仍在有效期内 */
function unlocked() {
  if (!available()) return true;          // ③ fail-open
  const s = _readRaw();
  if (!s || !s.t) return false;
  const passed = (Date.now() - Number(s.t || 0)) / 3600000;
  return Number.isFinite(passed) && passed < UNLOCK_HOURS;
}

function _markUnlocked() {
  S.setJSON(UNLOCK_KEY, { t: Date.now(), day: _todayKey() });
}

let _ad = null;
let _loading = false;
let _resolve = null;   // onClose 只注册一次，避免多次 watch 叠加回调

/**
 * 观看一次激励视频。返回 true = 已解锁（含"本来就解锁 / 无需解锁 / 观看成功"）
 * 任何异常都返回 true —— 见设计原则③，用户不该为广告故障买单。
 */
function watch() {
  return new Promise((resolve) => {
    if (!available()) { resolve(true); return; }   // 未开通 → 直接放行
    if (unlocked()) { resolve(true); return; }
    try {
      if (!_ad) {
        _ad = wx.createRewardedVideoAd({ adUnitId: AD_UNIT_ID });
        _ad.onError(() => {
          if (_resolve) { const r = _resolve; _resolve = null; r(true); }   // 广告出错 → 放行
        });
        _ad.onClose((res) => {
          const granted = !!(res && res.isEnded);   // 必须看完才算，半程退出不给奖励
          if (granted) _markUnlocked();
          if (_resolve) { const r = _resolve; _resolve = null; r(granted); }
        });
      }
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; _resolve = null; resolve(v); } };
      const go = () => {
        _ad.show().catch(() => {
          _ad.load().then(() => _ad.show()).catch(() => done(true));
        });
      };
      if (_loading) { done(true); return; }
      _loading = true;
      _resolve = done;
      _ad.load().then(() => { _loading = false; go(); })
        .catch(() => { _loading = false; done(true); });
      // 兜底：15 秒还没结果就放行，防止 SDK 卡住把用户锁死
      setTimeout(() => { _loading = false; done(true); }, 15000);
    } catch (e) {
      resolve(true);
    }
  });
}

module.exports = {
  available,
  unlocked,
  watch,
  // 调试/排查用：页面可在「关于」里显示当前是否处于广告可用状态
  debug: () => ({ enabled: ENABLED, hasUnit: !!AD_UNIT_ID, avail: available(), unlocked: unlocked() })
};
