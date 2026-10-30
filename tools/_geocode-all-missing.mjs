// 每日补全入口（薄壳）：委托 geocode-runner 完成合规坐标富集。
// 用法：node tools/_geocode-all-missing.mjs [budget] [domain]
//   budget  默认 2000（单 key 当日上限，远离 5000）
//   domain  scenic|food|all（默认 all）
// 合规：内部只用 geocode/geo，按天轮换单 key/日（禁止同日多 key 拼吞吐，规避高德 3.7）。
import { runDaily } from "./geocode-runner.mjs";

const argBudget = parseInt(process.argv[2] || "", 10);
const argDomain = process.argv[3] || "all";
runDaily({
  domain: argDomain,
  budget: isNaN(argBudget) ? 2000 : argBudget,
});
