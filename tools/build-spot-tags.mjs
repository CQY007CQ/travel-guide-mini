/* 构建期景点标注校验器（tools/build-spot-tags.mjs）
 *
 * 标签不再以静态大文件随包下发（会撑爆 2MB 分包），而是运行时由 spotsearch.js 用同一套
 * tagSpot() 从 D.CITIES 即时构建倒排索引。本脚本只做"构建期校验"：确认标注逻辑对全量景点
 * 跑得通、覆盖与分布合理，并打印样例，供人工抽检标签质量。不写任何随包数据。
 *
 * 用法：node tools/build-spot-tags.mjs
 */
import { createRequire } from "module";
const req = createRequire(import.meta.url);
const T = req("../utils/spot-tags.js");
const D = req("../utils/data.js");

function main() {
  const CITIES = D.CITIES || [];
  let spotCount = 0, tagged = 0, totalTags = 0;
  const freq = {};
  const cities = 0;
  const samples = [];
  for (let i = 0; i < CITIES.length; i++) {
    const c = CITIES[i];
    if (!c || !c.name || !Array.isArray(c.experiences)) continue;
    for (let j = 0; j < c.experiences.length; j++) {
      const e = c.experiences[j];
      if (!e || !e.name) continue;
      spotCount++;
      const keys = T.tagSpot(e, c);
      if (!keys.length) continue;
      tagged++;
      totalTags += keys.length;
      keys.forEach((k) => { freq[k] = (freq[k] || 0) + 1; });
      if (samples.length < 6) samples.push(c.name + " / " + e.name + " => " + keys.join(","));
    }
  }
  console.log("全量校验：景点 " + spotCount + " / 已标注 " + tagged + "（" + (tagged / spotCount * 100).toFixed(1) + "%） / 平均每景点 " + (tagged ? (totalTags / tagged).toFixed(2) : "0") + " 个标签");
  const top = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 15);
  console.log("标签频次 Top15：");
  for (const k of top) console.log("  " + (T.TAG_BY_KEY[k] ? T.TAG_BY_KEY[k].label : k) + " (" + k + "): " + freq[k]);
  console.log("样例：");
  samples.forEach((s) => console.log("  " + s));
}
main();
