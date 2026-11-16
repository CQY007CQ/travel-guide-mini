/**
 * tools/lib/page-src.mjs —— 「页面 + 同目录拆分模块」拼成一份源码，供按文本断言的门禁使用
 *
 * 为什么需要：T4 把 pages/plan/plan.js（1708 行）和 pages/index/index.js（1409 行）
 * 按职责拆成了同目录的若干模块。原先有一批门禁用 `readFileSync("pages/plan/plan.js")`
 * 直接对页面源码做正则断言（例如「onBaike 里必须 setClipboardData 且只出现 1 次百科域名」）。
 * 拆分后如果继续只读页面文件，那些断言会因为「代码搬走了」而变成**静默失效的假绿**。
 *
 * 这里把断言面扩大到「页面文件 + 同目录所有兄弟 .js」：
 *   - 「必须出现」类断言 → 扫描面变大，强度不降；
 *   - 「不得出现」类断言 → 扫描面变大，反而更严格。
 * 不做任何白名单或例外，拆分前后断言语义一致。
 */
import fs from "fs";
import path from "path";

/** 页面同目录里由拆分产生的模块（约定：p-*.js / m-*.js / 页面名-ctx.js） */
const SIBLING = /^(?:(?:p|m)-[A-Za-z0-9_-]+|(?:plan|index)-ctx)\.js$/;

/**
 * @param {string} rel 相对仓库根的页面 JS，如 "pages/plan/plan.js"
 * @param {string} root 仓库根（默认 process.cwd()）
 * @returns {string} 页面源码 + 兄弟模块源码（按文件名排序，稳定可复现）
 */
export function pageSrc(rel, root = process.cwd()) {
  // 相对路径按仓库根解析；也接受绝对路径（部分单测按 __dirname 拼路径）
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  if (!fs.existsSync(abs)) throw new Error("pageSrc: 文件不存在 " + rel);
  const parts = [fs.readFileSync(abs, "utf8")];
  const dir = path.dirname(abs);
  const sibs = fs
    .readdirSync(dir)
    .filter((f) => SIBLING.test(f) && f !== path.basename(abs))
    .sort();
  for (const f of sibs) parts.push(fs.readFileSync(path.join(dir, f), "utf8"));
  return parts.join("\n");
}

/** 只列出同目录的拆分模块文件名（需要逐文件定位时用） */
export function pageModules(rel, root = process.cwd()) {
  const dir = path.dirname(path.join(root, rel));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => SIBLING.test(f)).sort().map((f) => path.join(path.dirname(rel), f));
}
