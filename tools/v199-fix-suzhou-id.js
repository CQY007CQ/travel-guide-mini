// v1.18 修复：苏州 id 改名后遗留的附属数据错挂
// 背景：v1.15「苏州 id 冲突修复为 suzhou_jiangsu」时，只改了 CITIES 里的 id，
//       没有同步迁移按 id 索引的 HOTELS / EXTRA_SPOTS，结果：
//         - EXTRA_SPOTS.suzhou = ["留园","沧浪亭","可园","苏州中心","狮子林","网师园","盘门景区","阳澄湖"]
//           HOTELS.suzhou      = 观前街/苏州中心一带的酒店
//         这些其实是苏州的数据，却挂在了 suzhou 键下；
//       而 suzhou 这个 id 现在属于「宿州」→ 宿州生成行程时错拿苏州景点与酒店，
//       同时苏州自己（suzhou_jiangsu）反而没有酒店与候选景点。
// 修复：把这两个键从 suzhou 迁到 suzhou_jiangsu（幂等，重放安全）。
module.exports = {
  ID_REKEY: [
    { from: "suzhou", to: "suzhou_jiangsu", libs: ["HOTELS", "EXTRA_SPOTS", "EXTRA_SPOTS2", "EXTRA_SPOTS3", "EXTRA_SPOTS4", "EXTRA_SPOTS5"] }
  ]
};
