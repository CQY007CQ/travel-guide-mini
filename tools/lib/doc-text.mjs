/**
 * tools/lib/doc-text.mjs —— 交付材料纯文本提取（docx / pptx / md 统一入口）
 *
 * 为什么抽出来（v1.20.8 / T2 收敛）：
 *   原来这套 unzip + XML 抽字逻辑只存在于 tools/check/check-doc-consistency.mjs 里。
 *   新增「文档数字与实测一致」门禁（check-doc-numbers.mjs）需要同一份提取能力，
 *   复制一份就是又一个「同一事实两个真相源」——两边对 &nbsp; / 分片顺序的处理一旦
 *   分叉，会出现「一份门禁绿、一份门禁红」却都读同一份文件的荒诞局面。
 *
 * 只读、不联网；文件不存在返回 null（不是空串）——让调用方能区分「没有这份材料」
 * 与「材料是空的」，前者在 CI / 干净 checkout 下必须跳过而不是判红。
 */
import fs from "fs";
import { execFileSync } from "child_process";

/** 用 `unzip -p` 取出 zip 内某个成员的文本，失败返回空串（材料损坏时由调用方判空） */
export function unzipMember(zipPath, member) {
  try {
    return execFileSync("unzip", ["-p", zipPath, member], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    return "";
  }
}

/** 列出 zip 内全部成员路径（失败返回空数组） */
export function unzipList(zipPath) {
  try {
    return execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/** 从 OOXML 片段里抽出所有可见文字（w:t 是 Word、a:t 是 PowerPoint），并还原 5 种实体 */
export function xmlText(xml) {
  return [...xml.matchAll(/<(?:(?:w:t)|(?:a:t))(?:\s[^>]*)?>([\s\S]*?)<\/(?:(?:w:t)|(?:a:t))>/g)]
    .map((m) =>
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    )
    .join(" ");
}

/**
 * 材料 → 纯文本。docx 取 word/document.xml；pptx 按 slide1..N 自然序拼接
 * （字典序会把 slide10 排在 slide2 前面，所以必须按编号排序）；
 * 其余（.md/.txt）直接读。文件不存在返回 null。
 */
export function materialText(p) {
  if (!fs.existsSync(p)) return null;
  if (p.endsWith(".docx")) return xmlText(unzipMember(p, "word/document.xml"));
  if (p.endsWith(".pptx")) {
    return unzipList(p)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]))
      .map((n) => xmlText(unzipMember(p, n)))
      .join("\n");
  }
  return fs.readFileSync(p, "utf8");
}
