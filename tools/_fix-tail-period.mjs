// 修复「返程/转场 时段倒挂」：1 天行程里先排了 [晚上] 景点，再把「返程」标成 [傍晚] 追加到末尾，
// 用户看到的时间线是「晚上 晋阳湖公园 → 傍晚 返程」——倒挂。改为按当天已排时段决定收尾时段。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const helper = `
// 收尾项（返程/转场）的时段必须与当天已排时段一致：
// 若当天已排过 [晚上/深夜/夜间]，返程再标 [傍晚] 会排到晚上之后，时间线倒挂。
const tailPeriod = (arr) => (Array.isArray(arr) && arr.some(it => it && /^(晚上|深夜|夜间)$/.test(it.period))) ? "晚上" : "傍晚";
`;

const edits = [
  { from: `const MATCH_DENY = ["九华山公园"];`, to: `const MATCH_DENY = ["九华山公园"];${helper}` },
  {
    from: `    if(isTransfer) items.push({name:\`前往 \${nextCity}\`,period:"傍晚",note:"退房后转场到下一站，建议预留半天时间"});
    else items.push({name:"返程",period:"傍晚",note:"预留充足时间前往机场/车站"});`,
    to: `    if(isTransfer) items.push({name:\`前往 \${nextCity}\`,period:tailPeriod(items),note:"退房后转场到下一站，建议预留半天时间"});
    else items.push({name:"返程",period:tailPeriod(items),note:"预留充足时间前往机场/车站"});`,
  },
  {
    from: `   if(isTransfer) items.push({name:\`前往 \${nextCity}\`,period:"傍晚",note:"建议预留充足时间，乘高铁/飞机转场到下一站"});
   else items.push({name:"返程",period:"傍晚",note:"预留充足时间前往机场/车站"});`,
    to: `   if(isTransfer) items.push({name:\`前往 \${nextCity}\`,period:tailPeriod(items),note:"建议预留充足时间，乘高铁/飞机转场到下一站"});
   else items.push({name:"返程",period:tailPeriod(items),note:"预留充足时间前往机场/车站"});`,
  },
  {
    from: `   items.push({name:"返程", period:"傍晚", note:"预留充足时间前往机场/车站"});`,
    to: `   items.push({name:"返程", period:tailPeriod(items), note:"预留充足时间前往机场/车站"});`,
  },
];

let ok = true;
for (const [k, ed] of edits.entries()) {
  const n = s.split(ed.from).length - 1;
  const want = k === 0 ? 1 : 1;
  if (n !== want) { console.log("✗ 第" + (k + 1) + " 处命中 " + n + " 次（期望 " + want + "），放弃"); ok = false; break; }
}
if (ok) {
  for (const ed of edits) s = s.replace(ed.from, ed.to);
  fs.writeFileSync(F, s, "utf8");
  console.log("✓ 返程时段已改为动态");
}
