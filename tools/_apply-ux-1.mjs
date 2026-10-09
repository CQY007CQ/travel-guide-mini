// v1.19.2 体验优化批量落地（重度用户 + 新手用户）
// 严格断言：任一替换未恰好命中 1 次即整体放弃，避免半成品落盘。
import fs from "fs";

const EDITS = {
  /* ============ 首页 index.js ============ */
  "pages/index/index.js": [
    // [重度] 天数快捷预设需要数据源
    ['    days: 4, daysText: "4 天",',
     '    days: 4, daysText: "4 天", dayPresets: [3, 5, 7],'],

    // [新手] 预算档位给出金额区间，不用猜「舒适型」是多少钱
    ['    showCustom: false, customAmt: "",',
     '    showCustom: false, customAmt: "", budgetHint: "",'],

    // [重度] 想玩池新增 poolMore（被 120 上限截断的数量）
    ['    pool: [], poolFiltered: [], poolCount: 0, poolOn: 0, pickOnly: true, pickKw2: "", poolTag: "", poolTagList: [],',
     '    pool: [], poolFiltered: [], poolCount: 0, poolOn: 0, poolMore: 0, pickOnly: true, pickKw2: "", poolTag: "", poolTagList: [],'],

    // [重度] 池子截断数量透出（提上限到 300 + 显式告知还剩多少）
    [`    list = list.slice(0, 120);
    this.setData({ pool: full, poolFiltered: list, poolCount: full.length, poolOn: full.filter(x => x.on).length, poolTagList: Array.from(tagSet) });`,
     `    const matched = list.length;
    list = list.slice(0, 300);
    this.setData({
      pool: full, poolFiltered: list, poolCount: full.length,
      poolMore: Math.max(0, matched - list.length),
      poolOn: full.filter(x => x.on).length, poolTagList: Array.from(tagSet)
    });`],

    // [重度] 筛选态下同样透出截断数量
    [`    this.setData({
      pool: full,
      poolOn: full.filter(x => x.on).length,
      poolFiltered: list.slice(0, 120)
    });`,
     `    this.setData({
      pool: full,
      poolOn: full.filter(x => x.on).length,
      poolMore: Math.max(0, list.length - Math.min(list.length, 300)),
      poolFiltered: list.slice(0, 300)
    });`],

    // [重度] 连续勾选是高频动作：去掉每次点击的 1.5s toast 遮罩，改为零打扰（chip 高亮 + 计数已足够）
    [`  togglePool(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    const cur = (this.data.pool.find(x => x.name === name) || {}).on;
    const full = this.data.pool.map(x => (x.name === name ? { name, on: !x.on } : x));
    const c = this.data.cities[this.data.cityIdx];
    T.toggleWish(name, c ? c.name : "");
    this._applyPoolList(full);
    wx.showToast({
      title: cur ? "已取消想玩「" + name + "」" : "已勾选「" + name + "」· 生成时优先",
      icon: "none", duration: 1500
    });
  },`,
     `  // v1.19.2：连续勾选是高频动作，原先每点一次弹一次 1.5s toast 会持续打断操作。
  // 改为零 toast —— 勾选反馈由 chip 高亮 + 折叠栏「已选 N 个」承担，连点不再被打断。
  togglePool(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    const full = this.data.pool.map(x => (x.name === name ? { name, on: !x.on } : x));
    const c = this.data.cities[this.data.cityIdx];
    T.toggleWish(name, c ? c.name : "");
    this._applyPoolList(full);
  },`],

    // [重度] 全选会一次写入上百条想玩，误触代价高 → 批量动作加二次确认
    [`  pickAllPool() {
    const c = this.data.cities[this.data.cityIdx];
    const wished = new Set(T.getWish().map(x => x.name));
    const full = this.data.pool.map(it => ({ name: it.name, on: true }));
    full.forEach(it => { if (!wished.has(it.name)) T.toggleWish(it.name, c ? c.name : ""); });
    this._applyPoolList(full);
    wx.showToast({ title: "已全选 " + full.length + " 个想玩景点", icon: "none" });
  },`,
     `  // v1.19.2：全选会一次写入上百条想玩，误触后要一条条取消 → 批量动作补二次确认
  pickAllPool() {
    const n = (this.data.pool || []).length;
    if (!n) return;
    const run = () => {
      const c = this.data.cities[this.data.cityIdx];
      const wished = new Set(T.getWish().map(x => x.name));
      const full = this.data.pool.map(it => ({ name: it.name, on: true }));
      full.forEach(it => { if (!wished.has(it.name)) T.toggleWish(it.name, c ? c.name : ""); });
      this._applyPoolList(full);
      wx.showToast({ title: "已全选 " + full.length + " 个想玩景点", icon: "none" });
    };
    if (n < 15) { run(); return; }
    wx.showModal({
      title: "全选 " + n + " 个景点？",
      content: "会一次性加入想玩清单，生成时优先安排。之后可随时逐个取消。",
      confirmText: "全选",
      success: r => { if (r.confirm) run(); }
    });
  },`],

    // [重度] 搜索无防抖：大池每次按键都全量 filter + setData → 输入卡顿
    [`  onPickKw2(e) {
    const kw = e.detail.value.trim();
    const full = this.data.pool;
    let list = kw ? full.filter(x => x.name.includes(kw)) : full.slice();
    const tag = this.data.poolTag || "";
    if (tag) list = list.filter(x => T.spotTagOf(x.name, this.data.cityName).some(t => t === tag || t.indexOf(tag) >= 0 || tag.indexOf(t) >= 0));
    this.setData({ pickKw2: kw, poolFiltered: list.slice(0, 120) });
  },`,
     `  // v1.19.2：搜索无防抖 —— 池子动辄数百条，每敲一个字都全量 filter + setData 会明显卡顿。
  // 现在输入立即回显关键词、过滤结果做 180ms 防抖，快速连打只算最后一帧。
  onPickKw2(e) {
    const kw = e.detail.value.trim();
    this.setData({ pickKw2: kw });
    if (this._kwTimer) clearTimeout(this._kwTimer);
    this._kwTimer = setTimeout(() => { this._kwTimer = null; this._filterPool(); }, 180);
  },
  _filterPool() {
    const kw = this.data.pickKw2 || "";
    const full = this.data.pool;
    let list = kw ? full.filter(x => x.name.includes(kw)) : full.slice();
    const tag = this.data.poolTag || "";
    if (tag) list = list.filter(x => T.spotTagOf(x.name, this.data.cityName).some(t => t === tag || t.indexOf(tag) >= 0 || tag.indexOf(t) >= 0));
    this.setData({
      poolFiltered: list.slice(0, 300),
      poolMore: Math.max(0, list.length - Math.min(list.length, 300))
    });
  },
  // v1.19.2：一键清空搜索词（输入长词后要逐字删很烦）
  clearPoolKw() {
    if (this._kwTimer) { clearTimeout(this._kwTimer); this._kwTimer = null; }
    this.setData({ pickKw2: "" });
    this._filterPool();
  },`],

    // [重度+新手] 常用天数一键预设
    [`  onDateChange(e) { this.setData({ depart: e.detail.value }); this._syncHoli(); },`,
     `  // v1.19.2：常用天数一键到位（步进要点 7 次；新手也不知道「几天合适」，预设覆盖多数行程）
  onDaysPreset(e) {
    const cap = this._dayCap();
    const want = Number(e.currentTarget.dataset.d) || 3;
    const v = Math.max(1, Math.min(cap, want));
    if (v !== want) wx.showToast({ title: "这城最多 " + cap + " 天，已取上限", icon: "none" });
    this.setData({ days: v, daysText: v + " 天" });
    this._syncAdv();
  },
  onDateChange(e) { this.setData({ depart: e.detail.value }); this._syncHoli(); },`],

    // [新手] 预算档位金额区间
    [`    if (d.defFromIdx >= 0 && d.fromIdx !== d.defFromIdx) {
      const nm = (d.fromNames[d.fromIdx] || "").split("·").pop().trim();
      if (nm) chips.push("从" + nm);
    }
    this.setData({ advChips: chips });
    this._syncUi();`,
     `    if (d.defFromIdx >= 0 && d.fromIdx !== d.defFromIdx) {
      const nm = (d.fromNames[d.fromIdx] || "").split("·").pop().trim();
      if (nm) chips.push("从" + nm);
    }
    // v1.19.2：预算档位补一句金额区间 —— 新手不该靠猜「舒适型」是什么价位
    const bk = d.budgetKeys[d.budgetIdx] || "mid";
    const BUD = {
      low: "参考：人均 ¥150–300 / 天（青旅或快捷酒店 + 小吃为主）",
      mid: "参考：人均 ¥300–600 / 天（连锁酒店 + 正餐 + 打车）",
      high: "参考：人均 ¥600–1200 / 天（四星以上 + 品质餐厅 + 包车）"
    };
    const budgetHint = (bk === "custom") ? "" : (BUD[bk] || "");
    this.setData({ advChips: chips, budgetHint });
    this._syncUi();`],

    // [重度] 生成期间给全屏 loading（大城 14 天生成要 1s+，只改按钮文字反馈太弱）
    [`    this.setData({ loading: true });
    this._syncUi();`,
     `    this.setData({ loading: true });
    this._syncUi();
    // v1.19.2：生成是同步计算，大城 / 全省 14 天会明显停顿；补全屏 loading 给出明确反馈
    try { wx.showLoading({ title: "正在生成攻略…", mask: true }); } catch (e) {}`],

    [`    } finally {
      this.setData({ loading: false });
      this._syncUi();
    }
  },`,
     `    } finally {
      try { wx.hideLoading(); } catch (e) {}
      this.setData({ loading: false });
      this._syncUi();
    }
  },`]
  ],

  /* ============ 首页 index.wxml ============ */
  "pages/index/index.wxml": [
    // [重度+新手] 天数快捷预设
    [`      <picker mode="date" value="{{depart}}" start="{{departMin}}" bindchange="onDateChange">
        <view class="field-row">
          <text class="field-label">出发日期</text>
          <text class="field-value pick-value">{{depart}}<text class="arrow">›</text></text>
        </view>
      </picker>
      <!-- v1.9：假期客流提醒 -->`,
     `      <!-- v1.19.2：常用天数一键预设（步进要点 7 次才好；新手也不知道几天合适） -->
      <view class="day-preset">
        <text class="dp-t">常用</text>
        <text class="dp-chip {{days === item ? 'on' : ''}}" wx:for="{{dayPresets}}" wx:key="*this" data-d="{{item}}" bindtap="onDaysPreset">{{item}} 天</text>
        <text class="dp-hint">可选范围按目的地可玩量自动收敛</text>
      </view>
      <picker mode="date" value="{{depart}}" start="{{departMin}}" bindchange="onDateChange">
        <view class="field-row">
          <text class="field-label">出发日期</text>
          <text class="field-value pick-value">{{depart}}<text class="arrow">›</text></text>
        </view>
      </picker>
      <!-- v1.9：假期客流提醒 -->`],

    // [新手] 预算区间提示
    [`        <view class="pk-sub">按 {{days}}天 × {{people}}人 自动分摊到每人每天，用于匹配酒店档位</view>
      </block>`,
     `        <view class="pk-sub">按 {{days}}天 × {{people}}人 自动分摊到每人每天，用于匹配酒店档位</view>
      </block>
      <!-- v1.19.2：非自定义预算时显示档位金额区间，避免新手猜「舒适型」是多少钱 -->
      <view class="pk-sub" wx:if="{{!showCustom && budgetHint}}">{{budgetHint}}</view>`],

    // [重度] 池子搜索支持一键清空 + 截断告知
    [`      <input class="pk-search" placeholder="搜索景点名（共 {{poolCount}} 个）" value="{{pickKw2}}" bindinput="onPickKw2"/>`,
     `      <view class="pk-search-row">
        <input class="pk-search" placeholder="搜索景点名（共 {{poolCount}} 个）" value="{{pickKw2}}" bindinput="onPickKw2"/>
        <text class="pk-clear" wx:if="{{pickKw2}}" catchtap="clearPoolKw">清空</text>
      </view>`],

    [`        <view wx:for="{{poolFiltered}}" wx:key="name"
              class="pk-chip {{item.on ? 'on' : ''}}" data-name="{{item.name}}" bindtap="togglePool">
          <text>{{item.on ? '✓ ' : ''}}{{item.name}}</text>
        </view>
      </view>`,
     `        <view wx:for="{{poolFiltered}}" wx:key="name"
              class="pk-chip {{item.on ? 'on' : ''}}" data-name="{{item.name}}" bindtap="togglePool">
          <text>{{item.on ? '✓ ' : ''}}{{item.name}}</text>
        </view>
      </view>
      <!-- v1.19.2：池子被截断时明确告知还剩多少，而不是让用户以为只有这些 -->
      <view class="pk-more dim" wx:if="{{poolMore}}">还有 {{poolMore}} 个未显示 · 输入关键词可精确查找</view>`]
  ],

  /* ============ 行程页 plan.js ============ */
  "pages/plan/plan.js": [
    // [新手] 没有行程时不再「强行踢回首页」，改为明确告知 + 温和切到出发页
    [`    if (!plan || !plan.days || !plan.days.length) {
     wx.showToast({ title: "请先生成攻略", icon: "none" });
     setTimeout(() => { try { wx.reLaunch({ url: "/pages/index/index" }); } catch (_) {} }, 500);
     return;
    }`,
     `    if (!plan || !plan.days || !plan.days.length) {
     // v1.19.2：原实现「toast + reLaunch」把用户直接踢回首页且无解释，新手会以为页面坏了。
     // 现在说清原因、用 switchTab 正常切到出发页（保留 tab 栈，不再销毁页面）。
     this.setData({ hasPlan: false });
     wx.showToast({ title: "还没有行程，先去「出发」选个城市", icon: "none", duration: 2000 });
     setTimeout(() => { try { wx.switchTab({ url: "/pages/index/index" }); } catch (_) {} }, 1200);
     return;
    }
    if (!this.data.hasPlan) this.setData({ hasPlan: true });`],

    // [重度] 换方案会清掉「只玩勾选」，用户辛苦勾的偏好被静默丢失 → 保留
    [`   app.setPlan({ ...plan, days: daysArr, pace, altIdx: idx, pickOnly: false });`,
     `   // v1.19.2：换方案前若用户开着「只玩勾选」，rebuild 仍会按 picks 生成，
     // 这里不再把 pickOnly 静默改成 false（否则勾选偏好被无提示清掉，与 rebuild 行为也不一致）
   app.setPlan({ ...plan, days: daysArr, pace, altIdx: idx, pickOnly: plan.pickOnly !== false });`],

    [`  altNames: ["轻松休闲", "平衡舒适", "特种兵打卡"],`,
     `  altNames: ["轻松休闲", "平衡舒适", "特种兵打卡"],
  hasPlan: true,`]
  ],

  /* ============ 地图页 map.js ============ */
  "pages/map/map.js": [
    // [重度] 切天到边界时静默无反应 → 明确提示
    [`  onPrev() {
    const plan = app.globalData.plan;
    if (plan && this.data.dayIdx > 0) this._renderDay(plan, this.data.dayIdx - 1);
  },
  onNext() {
    const plan = app.globalData.plan;
    if (plan && this.data.dayIdx < plan.days.length - 1) this._renderDay(plan, this.data.dayIdx + 1);
  },`,
     `  // v1.19.2：到边界时原来静默无反应，用户以为按钮坏了 → 补一句明确提示
  onPrev() {
    const plan = app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) return;
    if (this.data.dayIdx <= 0) { wx.showToast({ title: "已经是第 1 天", icon: "none" }); return; }
    this._renderDay(plan, this.data.dayIdx - 1);
  },
  onNext() {
    const plan = app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) return;
    if (this.data.dayIdx >= plan.days.length - 1) { wx.showToast({ title: "已经是最后一天", icon: "none" }); return; }
    this._renderDay(plan, this.data.dayIdx + 1);
  },`]
  ],

  /* ============ 更多页 more.js ============ */
  "pages/more/more.js": [
    // [重度] 本地数据一键重置的显式出口（此前只能靠卸载/清缓存）
    [`  goGen() { wx.switchTab({ url: "/pages/index/index" }); },`,
     `  goGen() { wx.switchTab({ url: "/pages/index/index" }); },

  // v1.19.2：重度用户反复测试、或换机前想彻底重置，此前没有任何入口（只能卸载小程序）。
  // 数据全在本机，必须给显式出口，且用二次确认 + 提示先备份，避免误清。
  clearAllData() {
    wx.showModal({
      title: "清空全部本地数据？",
      content: "行程、存档、账本、想玩、待办、手记、足迹都会删除且不可恢复。建议先「备份到剪贴板」。",
      confirmText: "仍要清空",
      confirmColor: "#cc3d3d",
      success: (r) => {
        if (!r.confirm) return;
        try { wx.clearStorageSync(); } catch (e) {}
        try { app.clearPlan(); } catch (e) {}
        wx.showToast({ title: "已清空，回到初始状态", icon: "none" });
        setTimeout(() => { try { wx.reLaunch({ url: "/pages/index/index" }); } catch (_) {} }, 700);
      }
    });
  },`]
  ],

  /* ============ 更多页 more.wxml ============ */
  "pages/more/more.wxml": [
    [`  <view class="foot dim">数据均存本机 · 旅途中离线可用（地图需联网）</view>`,
     `  <!-- v1.19.2：本地数据一键重置（重度用户反复测试 / 换机场景的显式出口） -->
  <view class="group">
    <view class="group-title">数据与隐私</view>
    <view class="card group-card">
      <view class="menu" bindtap="clearAllData">
        <image class="m-ic" src="/images/icons/close.png"/>
        <view class="m-txt">
          <view class="m-t">清空全部本地数据</view>
          <view class="m-d dim">行程 / 账本 / 想玩 / 足迹 全部重置，不可恢复</view>
        </view>
        <text class="arrow">›</text>
      </view>
    </view>
  </view>

  <view class="foot dim">数据均存本机 · 旅途中离线可用（地图需联网）</view>`]
  ]
};

let failures = [];
const out = {};
for (const [file, pairs] of Object.entries(EDITS)) {
  let src = fs.readFileSync(file, "utf8");
  let hits = 0;
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    if (n !== 1) { failures.push(`${file}: 期望命中 1 次实际 ${n} 次 → ${from.slice(0, 60).replace(/\n/g, "⏎")}`); continue; }
    src = src.replace(from, to);
    hits++;
  }
  out[file] = src;
  console.log(`${file}: ${hits}/${pairs.length}`);
}
if (failures.length) {
  console.error("\n❌ 未命中，放弃全部写入：");
  failures.forEach(f => console.error("   " + f));
  process.exit(1);
}
for (const [file, src] of Object.entries(out)) fs.writeFileSync(file, src);

// 首页新增样式（天数预设 / 搜索行 / 截断提示）
const CSS = `
/* ═══ v1.19.2 新增：天数快捷预设 / 池子搜索行 / 截断提示 ═══ */
.day-preset { display: flex; align-items: center; flex-wrap: wrap; gap: 10rpx; margin: 4rpx 0 10rpx; }
.day-preset .dp-t { font-size: 22rpx; color: var(--tx-3, #64748b); margin-right: 2rpx; }
.day-preset .dp-chip { font-size: 23rpx; padding: 6rpx 20rpx; border-radius: 22rpx; color: var(--tx-2, #46536b); background: rgba(var(--ln-rgb, 100, 116, 139), .08); border: 1rpx solid transparent; }
.day-preset .dp-chip.on { color: var(--chip-tx, #14100a); background: var(--gold, #d4a94e); font-weight: 700; }
.day-preset .dp-hint { font-size: 20rpx; color: var(--tx-3, #64748b); margin-left: auto; }
.pk-search-row { display: flex; align-items: center; gap: 12rpx; }
.pk-search-row .pk-search { flex: 1; }
.pk-search-row .pk-clear { font-size: 22rpx; color: var(--gold-tx, #8f6a1f); padding: 8rpx 14rpx; flex-shrink: 0; }
.pk-more { font-size: 21rpx; padding: 10rpx 4rpx 0; }
`;
fs.appendFileSync("pages/index/index.wxss", CSS);
console.log("\n✅ 全部写入成功（含 index.wxss 样式追加）");
