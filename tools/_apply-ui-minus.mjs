// v1.19.7 UI 减法：移除「重复解释性文案」，保留功能性文案。
// 原则：按钮/交互本身已经说明的事情，不再用一行小字复述；只删纯解释，不动任何功能。
// 每条替换必须恰好命中 1 次，否则整体放弃写入（原子）。
import fs from "fs";

const edits = [
  {
    file: "pages/index/index.wxml",
    from: `<text class="disc-hint">{{discoverOpen ? '盲盒 / 同省顺路 / 行前提示（展开）' : '盲盒 / 同省顺路 / 行前提示'}}</text>`,
    to: `<text class="disc-hint">盲盒 / 同省顺路 / 行前提示</text>`,
    why: "展开状态再写一遍「（展开）」是复述箭头状态"
  },
  {
    file: "pages/more/more.wxml",
    from: `<view class="sp-tip dim">点行程名或「恢复」切换 · 当前行程重新生成前会自动存档</view>`,
    to: `<view class="sp-tip dim">点行程名或「恢复」切换</view>`,
    why: "后半句是后台行为说明，用户无需知道；存档本就自动发生"
  },
  {
    file: "pages/more/more.wxml",
    from: `<view class="sp-tip dim">点城市看打过卡的地方 · 在「行程」页点开景点详情 → 打卡即可点亮</view>`,
    to: `<view class="sp-tip dim">点城市看打过卡的地方</view>`,
    why: "后半句是打卡入口指引，与「行程」页功能重复，且过长"
  },
  {
    file: "pages/index/index.wxml",
    from: `<view class="pk-sub">按 {{days}}天 × {{people}}人 自动分摊到每人每天，用于匹配酒店档位</view>`,
    to: `<view class="pk-sub">{{days}}天 × {{people}}人 自动分摊</view>`,
    why: "精简为关键数字，去掉冗长解释"
  }
];

let ok = 0, fail = 0;
for (const e of edits) {
  if (!fs.existsSync(e.file)) { console.log("跳过（文件不存在）:", e.file); fail++; continue; }
  const s = fs.readFileSync(e.file, "utf8");
  const n = s.split(e.from).length - 1;
  if (n !== 1) { console.log("命中", n, "次（期望 1）→ 跳过:", e.file, "|", e.why); fail++; continue; }
  fs.writeFileSync(e.file, s.replace(e.from, e.to), "utf8");
  console.log("已精简:", e.file, "|", e.why);
  ok++;
}
console.log(`\n完成：${ok} 处成功，${fail} 处跳过`);
process.exit(fail > 0 ? 1 : 0);
