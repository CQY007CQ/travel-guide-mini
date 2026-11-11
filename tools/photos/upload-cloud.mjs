// tools/photos/upload-cloud.mjs —— 把 cache/ 里的真实照片批量上传到微信云开发存储
//
// 用法：
//   node tools/photos/upload-cloud.mjs
//
// 两种模式（自动选择，均 fail-closed，绝不假装上传成功）：
//   A) 自动：已安装 @cloudbase/node-sdk 且设置环境变量
//        TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY
//      → 逐个上传 cache/*.jpg 到 spots/<file>，产出 tools/photos/uploaded.json（真实 fileID 映射）。
//   B) 手动（默认，推荐）：未装 SDK 或未配密钥
//      → 产出 tools/photos/upload-plan.json（待上传清单 + 步骤），并打印操作指引后正常退出。
//        在微信开发者工具 → 云开发 → 云存储 → 新建 spots 目录 → 拖拽 cache/ 内全部 jpg 上传。
//        上传后从控制台任选一个文件复制其 fileID，取「/spots/」之前的部分作为 --prefix 传给 build-map.mjs。
//
// 为什么不用自建服务器 / 对象存储：云开发存储域名对小程序自动白名单，无需备案、无需配置 downloadFile。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(OUT, "cache");
const MANIFEST = path.join(OUT, "manifest.json");
const UPLOADED = path.join(OUT, "uploaded.json");
const PLAN = path.join(OUT, "upload-plan.json");

function readJSON(p, def) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return def; } }

const files = fs.existsSync(CACHE) ? fs.readdirSync(CACHE).filter(f => /\.jpg$/i.test(f)) : [];
const manifest = readJSON(MANIFEST, []);
if (!files.length) { console.error("cache/ 为空：先跑 fetch-commons.mjs 抓图"); process.exit(1); }

const ENV = process.env.TCB_ENV || "";
const SID = process.env.TCB_SECRET_ID || "";
const SKEY = process.env.TCB_SECRET_KEY || "";
let sdk = null;
try { sdk = require("@cloudbase/node-sdk"); } catch (e) { sdk = null; }

if (sdk && ENV && SID && SKEY) {
  const app = sdk.init({ env: ENV, secretId: SID, secretKey: SKEY });
  const uploaded = readJSON(UPLOADED, {});
  let ok = 0, fail = 0;
  for (const f of files) {
    if (uploaded[f]) continue;                 // 幂等
    const cloudPath = "spots/" + f;
    try {
      const res = await app.uploadFile({ cloudPath, fileContent: fs.createReadStream(path.join(CACHE, f)) });
      const fileID = (res && res.fileID) || "";
      if (!fileID) throw new Error("no-fileID");
      uploaded[f] = fileID;
      ok++;
    } catch (e) {
      fail++;
      console.error("上传失败 " + f + "：" + String((e && e.message) || e));
    }
  }
  fs.writeFileSync(UPLOADED, JSON.stringify(uploaded, null, 2) + "\n");
  console.log("自动上传完成：成功 " + ok + " / 失败 " + fail + " | uploaded.json 累计 " + Object.keys(uploaded).length);
  console.log("下一步：node tools/photos/build-map.mjs --enable（自动从 uploaded.json 读真实 fileID）");
} else {
  const plan = {
    createdAt: new Date().toISOString(),
    total: files.length,
    files: files,
    targetDir: "spots/",
    steps: [
      "1) 微信开发者工具 → 云开发 → 云存储 → 新建目录 spots",
      "2) 把 tools/photos/cache/ 里全部 .jpg 拖进 spots（保持原文件名，manifest.json 靠文件名对齐）",
      "3) 任选一个文件，复制其完整 fileID（形如 cloud://env.bucket/spots/abc.jpg）",
      "4) 把 /spots/ 之前的部分作为 --prefix 传给 build-map.mjs：",
      "   node tools/photos/build-map.mjs --prefix \"cloud://env.bucket\" --enable",
      "5) 真机预览确认图片能显示；失败会自动 binderror 回退示意图"
    ],
    note: "若想全自动，安装 @cloudbase/node-sdk 并设置 TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY 后重跑本脚本。"
  };
  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2) + "\n");
  console.log("未检测到 CloudBase 凭据 → 采用手动模式（零依赖、零伪造）");
  console.log("待上传 " + files.length + " 张 → 已生成 tools/photos/upload-plan.json");
  plan.steps.forEach(s => console.log("  " + s));
}
