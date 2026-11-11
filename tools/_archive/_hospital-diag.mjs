import fs from "fs";
const file = "utils/emergency-data.js";
const src = fs.readFileSync(file, "utf8");
const m = src.match(/const HOSPITALS = (\{[\s\S]*?\n\});/);
const cur = eval("(" + m[1] + ")");
const cities = Object.keys(cur);
let total = 0;
const buckets = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5+": 0 };
const under3 = [], under5 = [];
for (const c of cities) {
  const n = cur[c].length;
  total += n;
  if (n === 0) buckets["0"]++;
  else if (n === 1) buckets["1"]++;
  else if (n === 2) buckets["2"]++;
  else if (n === 3) buckets["3"]++;
  else if (n === 4) buckets["4"]++;
  else buckets["5+"]++;
  if (n < 3) under3.push(c + "(" + n + ")");
  if (n < 5) under5.push(c + "(" + n + ")");
}
console.log("城市总数:", cities.length, " 医院总数:", total);
console.log("分布:", JSON.stringify(buckets));
console.log("少于3家的城市数:", under3.length);
console.log("少于5家的城市数:", under5.length);
console.log("\n--- 少于3家的城市 ---\n" + under3.join("  "));
