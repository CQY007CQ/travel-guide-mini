// 云函数 sendRemind —— 订阅消息入库 + 定时发送
//
// ⚠️ 本文件**不会**被打包进小程序（tools/ 已被 project.config.json 的
//    packOptions.ignore 排除），放在这里是为了进 git，方便以后一键上传。
//
// ── 部署步骤 ────────────────────────────────────────────────────────
//  1) 开发者工具 → 云开发 → 开通环境，记下环境 ID
//  2) 云函数根目录新建 sendRemind，把 index.js / package.json 拷进去
//  3) 右键「上传并部署」（云端安装依赖）
//  4) 为该云函数加「定时触发器」，Cron 写 `0 0 8 * * * *`（每天 8 点跑一次 flush）
//  5) 新建数据库集合 reminds（权限建议：仅创建者可读写）
//  6) mp 后台 → 订阅消息 → 选模板 → 拿模板 ID 填进 utils/remind.js 的 TMPL_IDS
//
// ── 两种调用模式 ────────────────────────────────────────────────────
//  { mode: "add",   date, title, city, note }  → 写入集合，等待到点时发
//  { mode: "flush" }                            → 由定时触发器调用，扫到点的记录发送
//
// ── 合规提醒 ────────────────────────────────────────────────────────
//  订阅消息只能发给「已经授权过该模板」的用户，且一条授权只能发一条；
//  授权过期 / 从未授权的记录发送会失败，代码里按失败计数清理，不做重试轰炸。

const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = "reminds";

// ── 订阅消息模板字段，改这里即可适配你选用的模板 ──
// thing 类型最长 20 个中文字符，date / thing 都要按模板 keyword 顺序对应
const TEMPLATE_ID = process.env.TMPL_ID || "";   // 建议配在云函数环境变量里，别写死在代码
const MAX_PER_RUN = 200;

function clip(s, n) {
  const t = String(s == null ? "" : s);
  return t.length > n ? t.slice(0, n) : t;
}

function ymd(d) {
  const x = d || new Date();
  const p = (n) => (n < 10 ? "0" + n : String(n));
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
}

async function handleAdd(openid, data) {
  const date = clip(data.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, msg: "日期格式应为 YYYY-MM-DD" };
  await db.collection(COL).add({
    data: {
      openid,
      date,
      title: clip(data.title || "出发提醒", 20),
      city: clip(data.city || "", 20),
      note: clip(data.note || "", 32),
      sent: false,
      fail: 0,
      createdAt: Date.now()
    }
  });
  return { ok: true };
}

async function handleFlush() {
  if (!TEMPLATE_ID) return { ok: false, msg: "未配置 TMPL_ID 环境变量" };
  const today = ymd();
  const { data: rows } = await db.collection(COL)
    .where({ sent: false, date: today })
    .limit(MAX_PER_RUN)
    .get();
  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: r.openid,
        templateId: TEMPLATE_ID,
        page: "pages/plan/plan",
        miniprogramState: "formal",
        lang: "zh_CN",
        data: {
          thing1: { value: clip(r.title, 20) },
          date2: { value: r.date },
          thing3: { value: clip(r.city || "看看今天的行程", 20) }
        }
      });
      await db.collection(COL).doc(r._id).update({ data: { sent: true, sentAt: Date.now() } });
      sent++;
    } catch (e) {
      failed++;
      const f = (r.fail || 0) + 1;
      // 连续失败 3 次（多半是用户从未授权或已过期）→ 停掉，别一直重试
      await db.collection(COL).doc(r._id).update({ data: { fail: f, dead: f >= 3 } });
    }
  }
  return { ok: true, total: rows.length, sent, failed };
}

exports.main = async (event, context) => {
  const openid = (context && context.OPENID) || (cloud.getWXContext && cloud.getWXContext().OPENID) || "";
  if (!openid) return { ok: false, msg: "取不到 OPENID" };
  const mode = (event && event.mode) || "add";
  try {
    if (mode === "flush") return await handleFlush();
    return await handleAdd(openid, event || {});
  } catch (e) {
    return { ok: false, msg: String((e && e.message) || e) };
  }
};
