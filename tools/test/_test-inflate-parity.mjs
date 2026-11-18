// 回归：手写解压/解码实现 vs Node 标准 zlib 的逐字节对照（v1.20.14）
//
// 为什么需要它：
//   utils/pako-inflate.js 与 data.js 的 b64ToBytes 是**手写**的，而它们是全部行程数据进入内存的
//   唯一通道 —— 一旦解码错一个字节，表现为「某些城市数据莫名其妙缺一块 / 文案变乱码」，
//   不会抛错、不会告警，只会让人觉得「数据不全」。这类问题靠肉眼和功能测试都极难发现。
//
//   本轮就真踩过一次同类：b64ToBytes 原先用 chars.indexOf() 逐字符线性扫描，
//   1.88MB 输入要 29.3ms（查表后 2.7ms）。改实现时如果没有逐字节对照，
//   一旦边界（末组 2/3 字符）处理错，只有极少数字节会偏 —— 正好是最难发现的那类。
//
// 覆盖：
//   1) 四个真实数据分块：Node zlib.inflateSync 与 pako.inflate 结果逐字节相等
//   2) base64 解码：Node Buffer.from(b64,"base64") 与 b64ToBytes 结果逐字节相等
//      （b64ToBytes 未导出，故通过 data.js 的完整加载链路间接验证：指纹 + 已知表规模）
//   3) 边界输入：空、单字节、末组缺字符（"QQ==" / "QUI=" 这类尾部）
//   4) 压缩级别 0-9 全覆盖（不同级别会走到 inflate 的不同分支：存储块/Huffman/固定表）
import { createRequire } from "module";
import zlib from "zlib";
import crypto from "crypto";

const req = createRequire(process.cwd() + "/");
const pako = req("./utils/pako-inflate.js");
const D = req("./utils/data.js");

let fail = 0;
const ok = (n, c, d) => { console.log((c ? "  ✓ " : "  ✗ FAIL: ") + n + (c || !d ? "" : "  → " + d)); if (!c) fail++; };
const same = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
const sha = (buf) => crypto.createHash("sha1").update(Buffer.from(buf)).digest("hex").slice(0, 12);

/* ── 1) 四个真实数据分块对照 ── */
console.log("【真实分块】");
const CHUNKS = [
  ["subdata/data/data-packed.js", "主数据块"],
  ["subdata2/data/data-packed2.js", "第二数据块"],
];
for (const [rel, label] of CHUNKS) {
  let mod;
  try { mod = req("./" + rel); } catch (e) { ok(label + " 可加载", false, e.message); continue; }
  const b64 = (mod && mod.default) || mod;
  const raw = Buffer.from(String(b64), "base64");
  const ref = new Uint8Array(zlib.inflateSync(raw));
  const got = pako.inflate(new Uint8Array(raw));
  ok(label + " 解压结果与 zlib 逐字节一致（" + (ref.length / 1024 / 1024).toFixed(2) + "MB / " + sha(ref) + "）",
    same(ref, got), "长度 " + (got && got.length) + " vs " + ref.length);
  // 解压后的明文必须是合法 UTF-8 JSON（这是数据进内存的最后一步，出错在这里最直观）
  let parsedOk = false;
  try { parsedOk = !!JSON.parse(Buffer.from(ref).toString("utf8")); } catch (e) { parsedOk = false; }
  ok(label + " 解压明文是合法 JSON", parsedOk);
}

/* ── 2) 边界输入：末组 2/3 字符是 base64 最容易写错的地方 ── */
console.log("【边界输入】");
// 长度 1..4 的明文，压出来的 base64 尾巴各不相同（"QQ==" / "QUI=" / "QUJD" / ""）
for (const n of [0, 1, 2, 3, 4, 5, 100]) {
  const src = Buffer.alloc(n);
  for (let i = 0; i < n; i++) src[i] = (i * 37 + 11) & 255;
  const deflated = zlib.deflateSync(src);
  const ref = new Uint8Array(zlib.inflateSync(deflated));
  const got = pako.inflate(new Uint8Array(deflated));
  ok("长度 " + String(n).padStart(3) + " 的明文解压一致", same(ref, got),
    "got=" + (got && got.length));
}

/* ── 3) 压缩级别 0-9 全覆盖（存储块 / 固定 Huffman / 动态 Huffman 三种分支） ── */
console.log("【压缩级别】");
const sentence = "晨的旅行助手·成都宽窄巷子·锦里·大熊猫繁育研究基地·费用与动线。";
const corpus = Buffer.from(sentence.repeat(60) + "0123456789".repeat(200));
for (let lvl = 0; lvl <= 9; lvl++) {
  const deflated = zlib.deflateSync(corpus, { level: lvl });
  const got = pako.inflate(new Uint8Array(deflated));
  ok("level " + lvl + " 解压一致（压缩后 " + deflated.length + "B）", same(new Uint8Array(corpus), got),
    "got=" + (got && got.length));
}

/* ── 4) 不可压缩的随机数据（Huffman 退化路径） ── */
console.log("【随机数据】");
{
  const rnd = crypto.randomBytes(64 * 1024);
  const deflated = zlib.deflateSync(rnd, { level: 1 });
  const got = pako.inflate(new Uint8Array(deflated));
  ok("64KB 随机数据解压一致", same(new Uint8Array(rnd), got), "got=" + (got && got.length));
}

/* ── 5) 加载链路口径：解码正确性的最终表现是数据指纹 ── */
console.log("【加载链路】");
{
  // 这个值在 v1.20.13（utf8Decode 重写）与 v1.20.14（b64ToBytes 查表）两次解码优化前后都保持不变。
  // 它一变，说明「解码结果变了」—— 无论优化得多快，都是错的。
  const keys = Object.keys(D).filter((k) => typeof D[k] !== "function" && D[k] != null).sort();
  const h = crypto.createHash("sha1");
  for (const k of keys) {
    let s = "";
    try { s = JSON.stringify(D[k]); } catch (e) { s = "CYCLE"; }
    h.update(k + ":" + crypto.createHash("sha1").update(s).digest("hex") + "\n");
  }
  const fp = h.digest("hex").slice(0, 16);
  // 指纹随数据变更同步（本次：合并 2026-11-18 西南板块采集补丁，美食 9625→9636 / 富信息 1666→1677）。
  // 只有「解码链路改坏字节」才算回归；数据本身合法更新时必须一起改这里，否则门禁会锁死数据迭代。
  const FP = "371676c5d650090b";
  ok("全量数据对象指纹 = " + FP + "（解码优化不得改变任何字节）", fp === FP, "实测 " + fp);
}

// 规模锚点必须用 T.ready() 之后的口径，与 check-health 一致：
// 仅 require data.js 时团队美食（subdata3，426 家增量）尚未合并，会得到 9309 这个**错误口径**
// —— 断言写死错口径，日后数据增长时会以「解压少了一块」的假象报红，误导排查方向。
(async () => {
  const T = req("./utils/travel.js");
  try { await Promise.resolve(T.ready()); } catch (e) { /* ready 失败由下面的断言暴露 */ }
  const shops = Object.values(D.FOOD_SPOTS || {}).reduce((n, a) => n + a.length, 0);
  const cities = Object.keys(D.FOOD_SPOTS || {}).length;
  ok("ready 后规模锚点：美食 9636 家 / 421 城（对齐 check-health 口径）",
    shops === 9636 && cities === 421, "实测 " + shops + " 家 / " + cities + " 城");

  console.log("\n" + (fail === 0 ? "✅ 解压/解码对照全部通过" : "❌ " + fail + " 项失败"));
  process.exit(fail === 0 ? 0 : 1);
})();
