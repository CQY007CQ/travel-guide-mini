// v1.19.77 · 任务#404 模板路线（热门城市一键套用）
// 只改页面层：pages/index/index.{js,wxml,wxss}，绝不碰 utils/ 与数据管道。
// 每条替换断言「恰好命中 1 次」，防同文件多次替换静默回滚。
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const F = {
  js: path.join(ROOT, "pages/index/index.js"),
  wxml: path.join(ROOT, "pages/index/index.wxml"),
  wxss: path.join(ROOT, "pages/index/index.wxss")
};

const edits = [];
function once(file, from, to, tag) {
  edits.push({ file, from, to, tag });
}

/* ── 1. wxml：目的地字段下插入「热门路线」横向卡片 ── */
once(F.wxml,
`        <!-- v1.19 P0-1：发现灵感（默认折叠，减负首屏） -->`,
`        <!-- v1.19.77：模板路线 —— 热门城市一键套用（省掉 选省 → 搜城 → 调天数 三步） -->
        <view class="tpl-row">
          <view class="tpl-hd">
            <text class="tpl-t">热门路线</text>
            <text class="tpl-s">点一下，城市与天数自动填好</text>
          </view>
          <scroll-view class="tpl-scroll" scroll-x enable-flex show-scrollbar="{{false}}">
            <view class="tpl-card {{cityName === item.city ? 'on' : ''}}" wx:for="{{tpls}}" wx:key="city" data-i="{{index}}" bindtap="onTplPick">
              <text class="tpl-city">{{item.city}}</text>
              <text class="tpl-meta">{{item.days}}天 · {{item.tag}}</text>
            </view>
          </scroll-view>
        </view>
        <!-- v1.19 P0-1：发现灵感（默认折叠，减负首屏） -->`,
"wxml/tpl-row");

/* ── 2. js data：新增 tpls ── */
once(F.js,
`    days: 4, daysText: "4 天", dayPresets: [3, 5, 7],`,
`    days: 4, daysText: "4 天", dayPresets: [3, 5, 7],
    // v1.19.77：模板路线 —— 热门城市 + 建议天数（数据均已在库，城市名与 CITIES 完全一致）
    tpls: [
      { city: "西安", days: 4, tag: "古都" },
      { city: "成都", days: 4, tag: "慢生活" },
      { city: "重庆", days: 3, tag: "山城" },
      { city: "北京", days: 5, tag: "京城" },
      { city: "杭州", days: 3, tag: "西湖" },
      { city: "厦门", days: 3, tag: "海岛" },
      { city: "大理", days: 4, tag: "风花雪月" },
      { city: "桂林", days: 4, tag: "山水" },
      { city: "青岛", days: 3, tag: "海滨" },
      { city: "敦煌", days: 3, tag: "丝路" }
    ],`,
"js/tpls-data");

/* ── 3. js：新增 onTplPick ── */
once(F.js,
`  /* ---- 高级设置折叠 ---- */`,
`  // v1.19.77：模板路线 —— 点卡片自动填好城市 + 天数
  // 顺序很关键：先落天数再切城，_applyCity 内会按该城真实可玩量收敛 → 结果 = min(城市上限, 模板天数)
  onTplPick(e) {
    const i = Number(e.currentTarget.dataset.i);
    const t = this.data.tpls[i];
    if (!t) return;
    try {
      const provs = T.provinces();
      let pIdx = -1;
      for (let p = 0; p < provs.length; p++) {
        const cs = T.citiesOf(provs[p]) || [];
        if (cs.some(c => c.name === t.city)) { pIdx = p; break; }
      }
      if (pIdx < 0) { wx.showToast({ title: "暂未收录 " + t.city, icon: "none" }); return; }
      this.setData({ days: t.days, daysText: t.days + " 天" });
      this._fillProv(pIdx, t.city);
      const d = this.data.days;
      this._syncAdv();
      wx.showToast({ title: "「" + t.city + "」" + d + " 天已填好", icon: "none" });
    } catch (err) { wx.showToast({ title: "套用失败，请手动选择", icon: "none" }); }
  },

  /* ---- 高级设置折叠 ---- */`,
"js/onTplPick");

/* ── 4. wxss：模板路线样式 ── */
once(F.wxss,
`.df-btn.df-loading { opacity: .6; }`,
`.df-btn.df-loading { opacity: .6; }

/* ═══ v1.19.77 · 模板路线（热门城市一键套用） ═══ */
.tpl-row { margin: 10rpx 0 4rpx; }
.tpl-hd { display: flex; align-items: baseline; gap: 12rpx; padding: 0 2rpx 12rpx; }
.tpl-t { font-size: calc(24rpx * var(--fs, 1)); font-weight: 800; color: var(--t2, #5b6b82); letter-spacing: 1rpx; }
.tpl-s { flex: 1; min-width: 0; font-size: calc(21rpx * var(--fs, 1)); color: var(--t4, #7d92ab); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tpl-scroll { width: 100%; white-space: nowrap; }
.tpl-card {
  display: inline-flex; flex-direction: column; align-items: flex-start; justify-content: center;
  gap: 4rpx; min-width: 148rpx; height: 104rpx; padding: 0 22rpx; margin-right: 12rpx;
  border-radius: 20rpx; box-sizing: border-box;
  background: rgba(var(--ln-rgb, 100, 116, 139), .07);
  border: 1rpx solid rgba(var(--ln-rgb, 100, 116, 139), .16);
  transition: transform .18s ease, background .18s ease, border-color .18s ease;
}
.tpl-card:active { transform: scale(.96); }
.tpl-card.on {
  background: linear-gradient(135deg, rgba(230, 187, 98, .22), rgba(212, 169, 78, .12));
  border-color: rgba(212, 169, 78, .55);
}
.tpl-city { font-size: calc(27rpx * var(--fs, 1)); font-weight: 800; color: var(--tx, #18233a); letter-spacing: .5rpx; }
.tpl-card.on .tpl-city { color: var(--gold-tx, #8f6a1f); }
.tpl-meta { font-size: calc(19rpx * var(--fs, 1)); color: var(--dim, #5b6b82); }`,
"wxss/tpl-style");

/* ── 执行 ── */
let fail = 0;
for (const ed of edits) {
  const src = fs.readFileSync(ed.file, "utf8");
  const n = src.split(ed.from).length - 1;
  if (n !== 1) {
    console.error(`✗ [${ed.tag}] 命中 ${n} 次（期望 1）— 已跳过`);
    fail++;
    continue;
  }
  fs.writeFileSync(ed.file, src.replace(ed.from, ed.to));
  console.log(`✔ [${ed.tag}] 已写入`);
}
if (fail) { console.error(`\n共 ${fail} 条失败，未做任何破坏性写入（失败项已跳过）。`); process.exit(1); }
console.log(`\n全部 ${edits.length} 条替换完成。`);
