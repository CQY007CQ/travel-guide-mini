#!/usr/bin/env node
/**
 * tools/build/_check-pack-idempotent.mjs —— 打包产物一致性 / 幂等自证（v1.20.8 / T3）
 *
 * 问题（T3 原文）：
 *   pack-data 原来是「在当前已加载数据上重打包」，会累积烘焙 enrich。必须靠人记得先
 *   `git checkout` 旧产物才能回到干净基数据 —— 这是「靠记忆维持的正确性」，迟早出事。
 *
 * 现在的做法：
 *   ① pack-data 打包期只取基数据（PACK_BASE_ONLY），并在入口自检开关真的生效；
 *   ② 本脚本把 ① 的事实固化成断言：跑一次 pack-data，产物必须与仓库里已提交的逐字节一致。
 *
 * 为什么这样就等于「幂等」：
 *   若「从现有源产物再打一次」得到的字节与当前提交的相同，说明该产物就是当前源的固定点，
 *   再跑第二次仍会得到同一结果（同一输入 → 同一输出的纯函数性质）。
 *   于是不需要「先还原旧产物」这一步，也就不再依赖任何人记得还原。
 *
 * 退出码：0 一致 / 1 不一致（说明改了源没重打包，或有人手工改了 data-packed*）
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sha1 = (p) => crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");

// 受管产物：数据分块 + 加载器。任一处变化都要重新打包并提交。
const TARGETS = [
  "subdata/data/data-packed.js",
  "subdata2/data/data-packed2.js",
  "subdata3/data/team-food3.js",
  "utils/data.js",
].filter((p) => fs.existsSync(path.join(ROOT, p)));

const before = {};
for (const p of TARGETS) before[p] = sha1(path.join(ROOT, p));

const run = spawnSync(process.execPath, [path.join(ROOT, "tools/build/pack-data.mjs")], {
  cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
});
if (run.status !== 0) {
  console.log("  ✗ FAIL: pack-data 执行失败（rc=" + run.status + "）");
  console.log(String(run.stderr || run.stdout || "").split("\n").slice(-8).join("\n"));
  process.exit(1);
}

const drifted = [];
for (const p of TARGETS) {
  const now = sha1(path.join(ROOT, p));
  if (now !== before[p]) drifted.push(p + "  " + before[p].slice(0, 8) + " → " + now.slice(0, 8));
}
if (drifted.length) {
  console.log("  ✗ FAIL: 打包产物与仓库不一致（改了数据源却漏跑 pack-data，或手工改过产物）");
  for (const d of drifted) console.log("      " + d);
  console.log("    修复：node tools/build/pack-data.mjs 后，把产物一起提交");
  process.exit(1);
}
console.log("  ✓ 打包产物与源一致且幂等（" + TARGETS.length + " 个受管产物零 diff）");
