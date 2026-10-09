// 一次性原子补丁：把所有 v3/place/text 调用点替换为合规接口
//
// 背景：2026-09-14 高德按《服务协议》4.12.3 封禁本账号 v3/place/text 接口权限。
// 策略：先全量校验（每条替换必须恰好命中 1 次），全部通过才写盘；任一条不满足则整体放弃、不写任何文件。
// 用法： node tools/_apply-amap-compliance.mjs
import fs from "fs";

const ROOT = process.cwd();

const JOBS = [
  {
    file: "tools/fetch-amap-spots.mjs",
    edits: [
      {
        label: "引入合规护栏",
        old: [
          'import fs from "fs";',
          'import path from "path";',
          'import { createRequire } from "module";',
          'const req = createRequire(process.cwd() + "/");',
          'const ROOT = process.cwd();'
        ],
        neu: [
          'import fs from "fs";',
          'import path from "path";',
          'import { createRequire } from "module";',
          'import { assertAllowed, isPunishPage, BAN_HINT } from "./_amap-compliance.mjs";',
          'const req = createRequire(process.cwd() + "/");',
          'const ROOT = process.cwd();'
        ]
      },
      {
        label: "顶注：标记 text 通道停用",
        old: [
          '//         --mode text      place/text 关键字搜索（与 place/around 同属「搜索服务」配额；around 耗尽时换 text 通道继续收录真实景点）'
        ],
        neu: [
          '//         --mode text      【2026-09-14 永久停用】原 place/text 关键字搜索，已被官方按服务协议 4.12.3 封禁'
        ]
      },
      {
        label: "apiGet 硬拦截",
        old: [
          'async function apiGet(qs, { retry = true } = {}) {',
          '  let tried = 0;'
        ],
        neu: [
          'async function apiGet(qs, { retry = true } = {}) {',
          '  // 2026-09-14：被高德官方封禁的接口（v3/place/text，服务协议 4.12.3）硬拦截，永不发出请求',
          '  assertAllowed(qs);',
          '  let tried = 0;'
        ]
      },
      {
        label: "apiGet 风控页熔断",
        old: [
          '    try { j = await (await fetch(url, { timeout: 12000 })).json(); }',
          '    catch (e) { netErr = e.message; }'
        ],
        neu: [
          '    try {',
          '      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });',
          '      const txt = await r.text();',
          '      // 响应不是 JSON（阿里「比西」punish 页）= 行为风控拦截 → 立即熔断整轮，绝不重试',
          '      if (isPunishPage(txt)) { console.error(BAN_HINT); process.exit(3); }',
          '      j = JSON.parse(txt);',
          '    }',
          '    catch (e) { netErr = e.message; }'
        ]
      },
      {
        label: "MODE=text 拒绝执行",
        old: [
          'const MODE = (argOf("--mode") || process.env.MAP_MODE || "around").toLowerCase();'
        ],
        neu: [
          'const MODE = (argOf("--mode") || process.env.MAP_MODE || "around").toLowerCase();',
          '// 2026-09-14：v3/place/text 已被高德官方封禁（服务协议 4.12.3 反爬条款）→ text 通道永久停用',
          'if (MODE === "text") {',
          '  console.error("❌ --mode text 已停用：v3/place/text 被高德官方封禁（2026-09-14，服务协议 4.12.3）。");',
          '  console.error("   请改用 --mode around（周边搜索）或 --mode inputtips（输入提示）。");',
          '  process.exit(4);',
          '}'
        ]
      },
      {
        label: "--check 去掉 place/text 探针",
        old: [
          '    ["place/text 关键字搜索", "place/text?keywords=%E6%99%AF%E5%8C%BA&city=%E8%8A%9C%E6%B9%96&offset=1&page=1"],'
        ],
        neu: [
          '    // v3/place/text 已于 2026-09-14 被高德按服务协议 4.12.3 封禁 → 不再探测（探测本身即违规调用）'
        ]
      }
    ]
  },
  {
    file: "tools/fetch-food-shops.mjs",
    edits: [
      {
        label: "引入合规护栏",
        old: [
          'import { createRequire } from "module";',
          'const req = createRequire(process.cwd() + "/");',
          'const D = req("./utils/data.js");'
        ],
        neu: [
          'import { createRequire } from "module";',
          'import { isPunishPage, BAN_HINT } from "./_amap-compliance.mjs";',
          'const req = createRequire(process.cwd() + "/");',
          'const D = req("./utils/data.js");'
        ]
      },
      {
        label: "缺城心则跳过该城",
        old: [
          '  if (out[city] && out[city].length) continue;   // 已抓过',
          '  const merged = [];'
        ],
        neu: [
          '  if (out[city] && out[city].length) continue;   // 已抓过',
          '  // 2026-09-14：place/text 被官方封禁（4.12.3）→ 改用 place/around，需要城市中心做锚点',
          '  const cen = (D.CITY_COORDS || {})[city];',
          '  if (!cen || cen.length < 2) { empty++; done++; continue; }',
          '  const merged = [];'
        ]
      },
      {
        label: "place/text → place/around",
        old: [
          '    const url = `https://restapi.amap.com/v3/place/text?keywords=${encodeURIComponent(kw)}&city=${encodeURIComponent(city)}&types=050000&offset=20&page=1&key=${KEY()}`;'
        ],
        neu: [
          '    // 2026-09-14：v3/place/text 被官方封禁（服务协议 4.12.3）→ 改走 v3/place/around（周边搜索，未在封禁清单内）',
          '    // 以城市中心为锚、半径 50km；周边搜索的 keywords 分隔符为 | ；返回同样的 biz_ext（评分/人均）。',
          '    const kwq = String(kw).split(/[\\s|]+/).filter(Boolean).join("|");',
          '    const url = `https://restapi.amap.com/v3/place/around?location=${cen[1]},${cen[0]}&keywords=${encodeURIComponent(kwq)}&types=050000&radius=50000&offset=20&page=1&key=${KEY()}`;'
        ]
      },
      {
        label: "风控页熔断",
        old: [
          '        const r = await fetch(url.replace(/key=[^&]*$/, "key=" + KEY()));',
          '        j = await r.json(); calls++;'
        ],
        neu: [
          '        const r = await fetch(url.replace(/key=[^&]*$/, "key=" + KEY()));',
          '        const _txt = await r.text();',
          '        // 响应不是 JSON（阿里「比西」punish 页）= 行为风控拦截 → 立刻终止整轮，绝不重试',
          '        if (isPunishPage(_txt)) { console.error(BAN_HINT); allExhausted = true; break; }',
          '        j = JSON.parse(_txt); calls++;'
        ]
      },
      {
        label: "更正 status 字段注释",
        old: [
          '        // 注意 place/text 的响应不一定带 status 字段（实测只有 infocode/count/pois），',
          '        // 此前用 j.status === "1" 判断导致明明有数据却被当成失败，420 城全部空跑、0 店铺。'
        ],
        neu: [
          '        // 注意：place/around 会带 status 字段，但仍以「返回了 pois 数据」为准更稳',
          '        // （旧 place/text 通道响应不带 status，曾导致明明有数据却被当成失败，420 城全部空跑）。'
        ]
      }
    ]
  },
  {
    file: "tools/_resolve-poi-by-text.mjs",
    edits: [
      {
        label: "顶注改为 inputtips",
        old: [
          '// 用高德 place/text（关键字搜索）解析「geocode 按名解析失败」的景区真实坐标。'
        ],
        neu: [
          '// 用高德 assistant/inputtips（输入提示）解析「geocode 按名解析失败」的景区真实坐标。',
          '// 2026-09-14：原用 v3/place/text，该接口已被高德按服务协议 4.12.3（反爬条款）封禁',
          '//   → 改用独立「辅助服务」配额的 inputtips（未在封禁清单内）。'
        ]
      },
      {
        label: "place/text → inputtips",
        old: [
          '  const url = `https://restapi.amap.com/v3/place/text?keywords=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}&citylimit=true&offset=10&page=1&extensions=base&key=${kk.k}`;'
        ],
        neu: [
          '  // 2026-09-14：v3/place/text 已被官方封禁（4.12.3）→ 改用 assistant/inputtips（输入提示）',
          '  const url = `https://restapi.amap.com/v3/assistant/inputtips?keywords=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}&citylimit=true&datatype=poi&key=${kk.k}`;'
        ]
      },
      {
        label: "以 tips 数组为成功判据",
        old: [
          '  if (j.status !== "1") {',
          '    if (/OVER_LIMIT|INVALID_USER_KEY|USER_KEY_RECYCLED|INVALID_USER_SCODE/.test(String(j.info))) {',
          '      dead[kk.i] = true; keyDead++; calls--;',
          '      console.log(`   key#${kk.i + 1} 已失效/超限 → 停用（${j.info}）`);',
          '      continue;',
          '    }',
          '    miss++; await sleep(150); continue;',
          '  }',
          '  const pois = (j.pois || []).filter(p => p && p.name && p.location);'
        ],
        neu: [
          '  // inputtips 的响应体不一定带 status 字段（实测首键即 tips）→ 以 tips 数组是否存在为成功判据',
          '  if (!Array.isArray(j.tips)) {',
          '    if (/OVER_LIMIT|INVALID_USER_KEY|USER_KEY_RECYCLED|INVALID_USER_SCODE/.test(String(j.info))) {',
          '      dead[kk.i] = true; keyDead++; calls--;',
          '      console.log(`   key#${kk.i + 1} 已失效/超限 → 停用（${j.info}）`);',
          '      continue;',
          '    }',
          '    miss++; await sleep(150); continue;',
          '  }',
          '  const pois = j.tips.filter(p => p && p.name && p.location);'
        ]
      },
      {
        label: "地址字段适配 district",
        old: [
          '      v = { lat, lon, addr: String(best.pname || "") + String(best.cityname || "") + String(best.adname || "") + String(best.name || ""), src: "place/text" };'
        ],
        neu: [
          '      // inputtips 的行政区字段是 district（"山西省太原市晋源区"），保留 pname/cityname/adname 兼容分支',
          '      const _adm = String(best.pname || "") + String(best.cityname || "") + String(best.adname || "");',
          '      v = { lat, lon, addr: (_adm || String(best.district || "")) + String(best.name || ""), src: "inputtips" };'
        ]
      }
    ]
  },
  {
    file: "tools/geocode-fix.mjs",
    edits: [
      {
        label: "引入合规护栏",
        old: [
          'import { createRequire } from "module";',
          'const req = createRequire(process.cwd() + "/");',
          'const D = req("./utils/data.js");'
        ],
        neu: [
          'import { createRequire } from "module";',
          'import { isPunishPage, BAN_HINT } from "./_amap-compliance.mjs";',
          'const req = createRequire(process.cwd() + "/");',
          'const D = req("./utils/data.js");'
        ]
      },
      {
        label: "高德通道改 place/around",
        old: [
          'const ENDPOINT = PROVIDER === "amap"',
          '  ? "https://restapi.amap.com/v3/place/text"',
          '  : "https://apis.map.qq.com/ws/place/v1/search";'
        ],
        neu: [
          '// 2026-09-14：高德 v3/place/text 已被官方封禁（服务协议 4.12.3 反爬条款）→ 高德通道改走',
          '//   v3/place/around（周边搜索，未在封禁清单内），以城市中心为锚、半径 50km。',
          'const ENDPOINT = PROVIDER === "amap"',
          '  ? "https://restapi.amap.com/v3/place/around"',
          '  : "https://apis.map.qq.com/ws/place/v1/search";'
        ]
      },
      {
        label: "URL 构造带城市中心",
        old: [
          '  const url = PROVIDER === "amap"',
          '    ? `${ENDPOINT}?keywords=${encodeURIComponent(keyword)}&city=${encodeURIComponent(cityName)}&offset=1&page=1&key=${KEY}`',
          '    : `${ENDPOINT}?keyword=${encodeURIComponent(keyword)}&boundary=region(${encodeURIComponent(cityName)},0)&page_size=1&key=${KEY}`;'
        ],
        neu: [
          '  const _cen = (D.CITY_COORDS || {})[cityName] || [];',
          '  if (PROVIDER === "amap" && _cen.length < 2) { cache[ck] = null; return null; }',
          '  const url = PROVIDER === "amap"',
          '    ? `${ENDPOINT}?location=${_cen[1]},${_cen[0]}&keywords=${encodeURIComponent(keyword)}&radius=50000&offset=1&page=1&key=${KEY}`',
          '    : `${ENDPOINT}?keyword=${encodeURIComponent(keyword)}&boundary=region(${encodeURIComponent(cityName)},0)&page_size=1&key=${KEY}`;'
        ]
      },
      {
        label: "风控页熔断",
        old: [
          '  try {',
          '    const r = await fetch(url, { timeout: 8000 });',
          '    const j = await r.json();'
        ],
        neu: [
          '  try {',
          '    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });',
          '    const _txt = await r.text();',
          '    // 响应不是 JSON（阿里「比西」punish 页）= 行为风控拦截 → 立刻终止整轮，绝不重试',
          '    if (isPunishPage(_txt)) { console.error(BAN_HINT); process.exit(3); }',
          '    const j = JSON.parse(_txt);'
        ]
      }
    ]
  },
  {
    file: "tools/drain-all-keys.sh",
    edits: [
      {
        label: "加合规警告",
        old: [
          '#!/usr/bin/env bash',
          '# 每日自动用光所有高德 Key 的免费额度，并【优先收录新景点】（旅行攻略生成器）'
        ],
        neu: [
          '#!/usr/bin/env bash',
          '# ⚠️ 2026-09-14 高德正式封禁警告 ⚠️',
          '#   高德开放平台已依据《高德地图开放平台服务协议》4.12.3 条（禁止使用爬虫/抓取工具访问、抓取、',
          '#   存储、缓存本服务内容）对本账号违规 KEY 的 v3/place/text 接口权限作出封禁处理。',
          '#   本脚本「主动用光所有 KEY 免费额度」的设计目标本身就是规避限流，属风控重点打击行为；',
          '#   继续运行会将「接口级」处置升级为「账号级」封禁（封禁码 10026 INVALID_REQUEST，届时全部接口失效）。',
          '#   现状：所有 place/text 调用点已加硬拦截（tools/_amap-compliance.mjs），脚本不会再发该接口，',
          '#        但批量抓取后落盘 POI 仍违反协议 3.5。建议改为按需查询 + 迁移 OSM 数据源。运行前请想清楚。',
          '# 每日自动用光所有高德 Key 的免费额度，并【优先收录新景点】（旅行攻略生成器）'
        ]
      }
    ]
  },
  {
    file: "tools/finish-burn.sh",
    edits: [
      {
        label: "加合规警告",
        old: [
          '#!/usr/bin/env bash',
          '# 收尾流水线（在 LJyet2 = 664f geocode --fresh 跑完之后运行）：'
        ],
        neu: [
          '#!/usr/bin/env bash',
          '# ⚠️ 2026-09-14 高德已按《服务协议》4.12.3 封禁本账号 v3/place/text 接口权限。',
          '#   本脚本内含 amap 通道的 geocode-fix（原走 place/text，现已改走 place/around）与全城批量抓取，',
          '#   继续运行仍有合规风险（协议 3.5 禁止存储/缓存本服务数据）。运行前请确认已想清楚。',
          '# 收尾流水线（在 LJyet2 = 664f geocode --fresh 跑完之后运行）：'
        ]
      }
    ]
  }
];

/* ---------- 阶段一：全量校验（不写盘） ---------- */
const plan = [];
let bad = 0;
for (const job of JOBS) {
  const abs = ROOT + "/" + job.file;
  if (!fs.existsSync(abs)) { console.log(`❌ 文件不存在：${job.file}`); bad++; continue; }
  let src = fs.readFileSync(abs, "utf8");
  const before = src;
  for (const e of job.edits) {
    const oldS = e.old.join("\n"), neuS = e.neu.join("\n");
    const hits = src.split(oldS).length - 1;
    if (hits !== 1) {
      console.log(`❌ ${job.file} · ${e.label} → 命中 ${hits} 次（必须恰好 1 次），整体放弃`);
      bad++;
      continue;
    }
    src = src.replace(oldS, neuS);
  }
  plan.push({ file: job.file, abs, before, after: src, changed: src !== before });
}
if (bad) { console.log(`\n⛔ 共 ${bad} 处校验失败 → 未写入任何文件。`); process.exit(1); }

/* ---------- 阶段二：备份 + 写盘 ---------- */
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const bakDir = ROOT + "/tools/_bak-amap-compliance-" + stamp;
fs.mkdirSync(bakDir, { recursive: true });
let n = 0;
for (const p of plan) {
  if (!p.changed) { console.log(`· 无变化 ${p.file}`); continue; }
  const bak = bakDir + "/" + p.file.split("/").pop();
  fs.writeFileSync(bak, p.before, "utf8");
  fs.writeFileSync(p.abs, p.after, "utf8");
  n++;
  console.log(`✅ ${p.file}  [备份 ${bak.replace(ROOT + "/", "")}]`);
}
console.log(`\n完成：改写 ${n} 个文件。备份目录 ${bakDir.replace(ROOT + "/", "")}`);
