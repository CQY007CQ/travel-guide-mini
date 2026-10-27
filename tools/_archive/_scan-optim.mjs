// 扫描源码中的可优化点（只读，不改文件）
import fs from "fs";

const SRC = ["tools/_src-backup/travel.js", "tools/_src-backup/planner.js", "tools/_src-backup/weather.js"];
const PAGES = [];
for (const root of ["pages", "subpkg"]) {
  if (!fs.existsSync(root)) continue;
  for (const d of fs.readdirSync(root)) {
    const f = `${root}/${d}/${d}.js`;
    if (fs.existsSync(f)) PAGES.push(f);
  }
}

console.log("=== A) 循环内全量遍历 CITIES（O(n) 热点）===");
for (const f of SRC) {
  if (!fs.existsSync(f)) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (/D\.CITIES/.test(l) && /\.(filter|map|find|some|forEach)\(/.test(l)) {
      console.log(`  ${f}:${i + 1}  ${l.trim().slice(0, 92)}`);
    }
  });
}

console.log("\n=== B) 循环内 JSON.parse / stringify ===");
for (const f of SRC.concat(PAGES)) {
  if (!fs.existsSync(f)) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (/JSON\.(parse|stringify)/.test(l) && /(for\s*\(|\.forEach\(|\.map\()/.test(l)) {
      console.log(`  ${f}:${i + 1}  ${l.trim().slice(0, 92)}`);
    }
  });
}

console.log("\n=== C) 页面 setData 未使用 this.data 局部缓存（大对象全量 setData）===");
for (const f of PAGES) {
  const s = fs.readFileSync(f, "utf8");
  const n = (s.match(/setData\(\{/g) || []).length;
  if (n > 12) console.log(`  ${f}: setData ${n} 处`);
}

console.log("\n=== D) 可能的未判空属性访问（obj.xxx 前无 && 守卫）===");
let dCount = 0;
for (const f of PAGES) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    // page 里 plan.days[di].items[ix] 这类链式访问，前面没判断
    if (/globalData\.plan\.\w+\[/.test(l) && !/\&\&|if\s*\(|\?/.test(l)) {
      dCount++;
      if (dCount <= 20) console.log(`  ${f}:${i + 1}  ${l.trim().slice(0, 92)}`);
    }
  });
}
console.log(`  小计 ${dCount} 处`);

console.log("\n=== E) 重复的 wx.showToast 文案（可抽常量）===");
const toastMap = {};
for (const f of PAGES) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    const m = /title:\s*"([^"]{2,20})"/.exec(l);
    if (m && /showToast/.test(l)) (toastMap[m[1]] = toastMap[m[1]] || []).push(`${f}:${i + 1}`);
  });
}
Object.keys(toastMap).forEach(k => {
  if (toastMap[k].length > 1) console.log(`  「${k}」x${toastMap[k].length}  ${toastMap[k].slice(0, 3).join(" ")}`);
});

console.log("\n=== F) 硬编码魔法数字（次数/上限类）===");
for (const f of SRC) {
  if (!fs.existsSync(f)) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (/\b(200|2000|1500000|5000|10000)\b/.test(l) && !/\/\//.test(l)) {
      console.log(`  ${f}:${i + 1}  ${l.trim().slice(0, 92)}`);
    }
  });
}
