#!/usr/bin/env node
/**
 * tools/check/check-lens.mjs —— 拍照识物能力防回潮守卫（v1.20.6）
 *
 * 守住这轮增强的五个关键点：
 *   ① 云函数 custom system 分支必须注入本地上下文（旧版直接 return，grounding 全丢）
 *   ② 识物请求必须带 grounding，且用「多链多数投票」而非「第二次结果覆盖第一次」
 *   ③ 只有多链一致才自动联动 / 记历史，分歧必须交人工确认
 *   ④ 离线出口必须明确声明「本机不含离线图像识别」，绝不把知识库候选包装成识别结果
 *   ⑤ 结构化结果 / 分歧候选 / 识别历史三个 UI 区块都在
 *
 * 注意：项目反复踩过「断言查字面量被自身注释误伤」的坑，所有「不应存在」的
 *       断言一律先滤掉注释行再匹配。
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
// 滤掉行注释 / 块注释行 / WXML 注释行，避免守卫自己的说明文字被当成代码特征。
const code = (s) => s.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*|<!--|#)/.test(l))
  .join("\n");

let n = 0, fail = 0;
function ck(name, cond, extra) {
  n++;
  if (cond) { console.log("  [ok]   " + name); return; }
  fail++;
  console.log("  [fail] " + name + (extra ? "  → " + extra : ""));
}

const proxy = read("tools/cloud/llmProxy/index.js");
const lens = code(read("subpkg/lens/lens.js"));
const vision = code(read("subpkg/lens/lens-vision.js"));
const wxml = code(read("subpkg/lens/lens.wxml"));
const wxss = read("subpkg/lens/lens.wxss");
const appJson = read("app.json");

/* ---------- ① 云端 grounding ---------- */
ck("云函数 buildSystem 的 custom 分支注入 hasContext 上下文",
  /if \(custom\)[\s\S]{0,400}?if \(hasContext\)[\s\S]{0,300}?event\.context/.test(proxy));
ck("云函数仍强制追加零伪造 GUARDRAIL", /return s \+ "\\n\\n" \+ GUARDRAIL/.test(proxy));

/* ---------- ② grounding + 级联多数投票 ---------- */
ck("lens 引入分包纯逻辑层 lens-vision（主包零增长）", /require\("\.\/lens-vision\.js"\)/.test(lens));
ck("多模态请求带本地 grounding 上下文", /_groundContext\(\)/.test(lens) && /context: ctx/.test(lens));
ck("grounding 只用随包真实景点名（V.citySpotNames），不生成名称",
  /V\.citySpotNames\(city, 20\)/.test(lens));
ck("三条独立识别链齐备（主链 / 客观复核 / 分歧仲裁）",
  /_prompt\(\)/.test(lens) && /_promptVerify\(\)/.test(lens) && /_promptArbitrate\(\)/.test(lens));
ck("复核链与仲裁链用独立 system（避免同一视角重复出错）",
  /_systemVerify\(\)/.test(lens) && /_systemArbitrate\(\)/.test(lens));
ck("用多数投票判定一致（2 链即定 / 分歧起第 3 链）",
  /V\.vote\(rs\)/.test(lens) && /V\.vote\(\[rs\[0\], rs\[1\], third\]\)/.test(lens) && /v2\.consensus/.test(lens));
ck("旧缺陷不回潮：不再用「第二次结果直接覆盖第一次」",
  !/text: r2\.text, source: r2\.source \|\| "ai", voted: true/.test(lens));
ck("结构化输出约定含类别与置信度（parseResult 可解析）",
  /②类别/.test(lens) && /置信度：高\/中\/低/.test(lens));

/* ---------- ③ 一致才联动 / 分歧人工确认 ---------- */
ck("只有多链一致才产出联动名称", /v\.consensus \? v\.name : ""/.test(lens));
ck("云端名称对齐本地真实景点名", /V\.matchLocalName\(name, city\)/.test(lens));
ck("一致结果才写入识别历史", /if \(spotName\) self\._pushHistory\(/.test(lens));
ck("分歧时 UI 明确提示不会自动加入行程", /此时不会自动加入行程/.test(wxml));
ck("分歧候选可点选人工确认", /voteInfo\.alternatives/.test(wxml) && /bindtap="onPickCandidate"/.test(wxml));

/* ---------- ④ 离线诚实出口与上传健壮性 ---------- */
ck("云不可用时不再只弹错误，而是打开本机离线对照", /self\._openLocalCompare\(/.test(lens));
ck("离线出口明确声明「本机不含离线图像识别」", /本机不含离线图像识别/.test(lens));
ck("离线候选只来自随包真实资料", /V\.localCandidates\(/.test(lens) && /localCandidates/.test(vision));
ck("逐张上传失败只丢该张（不再整批全挂）",
  /Cloud\.uploadImage\(p\)\.catch\(function \(\) \{ return ""; \}\)/.test(lens));
ck("上传全失败自动重试一次", /_uploadWithRetry/.test(lens) && /正在重试一次/.test(lens));
ck("识别失败 / 无结果也回落离线对照", /云端识别未返回结果/.test(lens));

/* ---------- ⑤ 纯逻辑零伪造与 UI 区块 ---------- */
ck("纯逻辑层不生成任何名称（无随机 / 无模板造词）",
  !/Math\.random/.test(vision) && !/疑似\$\{|可能是\$\{/.test(vision));
ck("matchLocalName 找不到时返回空串（不编造景点）", /return "";/.test(vision));
ck("vote 平票标分歧、不擅自挑一个", /consensus = !!top && top\.count >= 2 && !tie/.test(vision));
ck("追问带上识别结论且标注可能有误", /刚才这张照片的识别结论/.test(lens) && /仅供参考，可能有误/.test(lens));
ck("WXML 有结构化摘要（名称 / 置信度 / 特征）",
  /parsed\.rawName/.test(wxml) && /parsed\.confidence/.test(wxml) && /parsed\.features/.test(wxml));
ck("WXML 有多链一致 / 分歧徽章", /voteInfo\.consensus/.test(wxml) && /意见不一致/.test(wxml));
ck("WXML 有离线对照与「非图像识别」标识", /localMode/.test(wxml) && /非图像识别/.test(wxml));
ck("WXML 有识别历史与清空入口", /history\.length/.test(wxml) && /onClearHistory/.test(wxml));
ck("WXSS 有新增区块样式（结构化 / 候选 / 历史）",
  /\.sum \{/.test(wxss) && /\.cand \{/.test(wxss) && /\.hist-item/.test(wxss));
ck("识物页仍注册在分包内（新增文件不占主包）",
  /"lens\/lens"/.test(appJson) && !/utils\/lens-vision/.test(lens));

console.log("  拍照识物防回潮守卫: " + (n - fail) + "/" + n + " 通过");
if (fail) process.exit(1);
