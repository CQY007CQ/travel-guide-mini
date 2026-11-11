// v1.19.184 各板块采集状态报告（替代从 collect-state.json 读远程状态）。
// 背景：spoke 机的 collect-state.json 按规约只改本地、严禁提交，远程那份永远滞后，
//      导致按它展示的板块状态永远「无状态」。本脚本改为从各板块唯一承诺推送的
//      team-region-<板块>.json 的「文件内容 + git 提交历史」推导真实状态。
// 用法：node tools/_spoke-status.mjs [--md]（--md 输出 Markdown，可由中枢写入状态文档）
// 只读：不写任何文件、不联网、无 API key。
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";

const REGIONS = ["华北", "东北", "华东", "华中", "华南", "西南", "西北"];
const SECTIONS = ["food", "hotels", "hotelList", "hospitals"];
const md = process.argv.includes("--md");

function gitInfo(path) {
  try {
    const out = execSync(
      `git log -1 --format="%ad|%h|%s" --date=short -- "${path}"`,
      { encoding: "utf8" }
    ).trim();
    if (!out) return { date: null, hash: null, subject: null };
    const [date, hash, ...rest] = out.split("|");
    return { date, hash, subject: rest.join("|") };
  } catch {
    return { date: null, hash: null, subject: null };
  }
}

const rows = [];
for (const r of REGIONS) {
  const p = `tools/team/team-region-${r}.json`;
  if (!existsSync(p)) {
    rows.push({ region: r, missing: true, ...gitInfo(p) });
    continue;
  }
  const j = JSON.parse(readFileSync(p, "utf8"));
  const stat = {};
  for (const s of SECTIONS) stat[s] = Object.keys(j[s] || {}).length;
  rows.push({ region: r, cities: stat, ...gitInfo(p) });
}

if (md) {
  console.log("| 板块 | food 城市 | hotels 片区 | hotelList 城市 | hospitals 城市 | 最后推送 | 最近提交 |");
  console.log("|---|---|---|---|---|---|---|");
  for (const x of rows) {
    if (x.missing) {
      console.log(`| ${x.region} | - | - | - | - | 未建文件 | - |`);
      continue;
    }
    console.log(
      `| ${x.region} | ${x.cities.food} | ${x.cities.hotels} | ${x.cities.hotelList} | ${x.cities.hospitals} | ${x.date || "-"} | ${x.hash || "-"} ${x.subject || ""} |`
    );
  }
} else {
  console.log("板块  food城 hotels片 hotelList城 hospitals城  最后推送   最近提交");
  for (const x of rows) {
    if (x.missing) {
      console.log(`${x.region.padEnd(4)}  未建文件`);
      continue;
    }
    console.log(
      `${x.region.padEnd(4)}  ${String(x.cities.food).padEnd(6)} ${String(x.cities.hotels).padEnd(8)} ${String(x.cities.hotelList).padEnd(11)} ${String(x.cities.hospitals).padEnd(11)} ${x.date || "-"}  ${x.hash || "-"} ${x.subject || ""}`
    );
  }
}
