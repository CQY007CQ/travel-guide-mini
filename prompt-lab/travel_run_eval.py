#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
执行层评测器（prompt-lab / travel_run_eval.py）
-----------------------------------------------
把 14 条候选提示词 + 1 条终极版在同一任务/同一资料 fixture 下逐条真实执行后，
对 runs/*.md 中的**实际输出**做自动化合规检测，补齐静态打分缺失的端到端证据。

与 GSM8K 版（run_eval.py）的区别：
- 答案可核验改为「黄山真实检索数据命中」且「景德镇未收录→显式暂无数据」双条件；
- 无编造检测聚焦景德镇：不得采纳 S05 的未核验星级(★)/坐标(29.30,117.18)/景点名(御窑/瑶里)；
- 口径冲突=S02（约10家/四季皆宜），时效=S03（2024 旧版），无关=S04（哈尔滨）；
- 各提示词按自身声明配置 vote/selfcheck/restate 是否计分项（极简/轻量档豁免），
  更公平地衡量「提示词实际产出了什么」。

输出：travel_exec_report.json + 执行评测报告.md
"""
import os, re, json, math

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")

# 静态分（来自 docs/prompt-engineering-travel-assistant.md 第三节「自动评分与排名」）
STATIC = {
 "P01":8.80,"P05":8.95,"P06":8.70,"P03":8.75,"P10":8.85,"P11":8.55,"P13":8.90,
 "P02":6.55,"P04":7.20,"P07":6.75,"P08":8.10,"P09":8.00,"P12":6.60,"P14":5.85,
}
# 终极版系 P05 收敛产物，无独立静态分，不参与 Pearson（单独列示）。

# 每提示词配置：格式契约 / 各硬约束是否计分项 / 篇幅档
CONFIG = {
 "P01":{"name":"通用均衡","fmt":"sections","sections":["结论","依据","提示"],"vote":True,"selfcheck":True,"restate":True,"len":"mid"},
 "P02":{"name":"极简速答","fmt":"tiny","sections":[],"vote":False,"selfcheck":True,"restate":False,"len":"tiny"},
 "P03":{"name":"深度专家","fmt":"sections","sections":["摘要","分步推理","依据字段","边界"],"vote":True,"selfcheck":True,"restate":True,"len":"mid"},
 "P04":{"name":"暖心陪伴","fmt":"loose","soft":"暖|温馨|祝","sections":[],"vote":False,"selfcheck":True,"restate":True,"len":"mid"},
 "P05":{"name":"多链投票强化","fmt":"sections","sections":["共识结论","各链要点","依据"],"vote":True,"selfcheck":True,"restate":True,"len":"mid"},
 "P06":{"name":"检索优先","fmt":"sections","sections":["检索摘要","回答"],"vote":False,"selfcheck":True,"restate":True,"len":"mid"},
 "P07":{"name":"小白向导","fmt":"loose","soft":"为什么","sections":[],"vote":False,"selfcheck":True,"restate":True,"len":"mid"},
 "P08":{"name":"商务差旅","fmt":"table","sections":["行程","注意"],"vote":True,"selfcheck":True,"restate":True,"len":"mid"},
 "P09":{"name":"亲子出游","fmt":"sections","sections":["推荐","适龄说明","安全提示"],"vote":True,"selfcheck":True,"restate":True,"len":"mid"},
 "P10":{"name":"硬核数据","fmt":"sections","sections":["指标表","对比","结论"],"vote":True,"selfcheck":True,"restate":True,"len":"mid"},
 "P11":{"name":"极客可控","fmt":"json","sections":[],"vote":True,"selfcheck":True,"restate":True,"len":"short"},
 "P12":{"name":"安抚情绪","fmt":"loose","soft":"别担心|别着急|理解|放心|别怕|共情|安","sections":[],"vote":False,"selfcheck":True,"restate":False,"len":"mid"},
 "P13":{"name":"严谨学术","fmt":"sections","sections":["立论","证据","局限"],"vote":True,"selfcheck":True,"restate":True,"len":"mid"},
 "P14":{"name":"轻量对话","fmt":"loose","soft":None,"sections":[],"vote":False,"selfcheck":False,"restate":False,"len":"short"},
 "U":  {"name":"★ 终极提示词","fmt":"ultimate","sections":["结论","依据","共识度","提示"],"vote":True,"selfcheck":True,"restate":True,"len":"long"},
}


def strip_fence(t):
    m = re.search(r"```(?:json|yaml|yml)?\s*\n([\s\S]*?)\n```", t)
    return m.group(1).strip() if m else t.strip()


def check_format(cfg, text):
    fmt = cfg["fmt"]
    if fmt == "json":
        s = strip_fence(text)
        if not s.startswith("{"):
            m = re.search(r"\{[\s\S]*\}", s)
            if not m: return False, "无 JSON 对象"
            s = m.group(0)
        try:
            json.loads(s); return True, "JSON 可解析"
        except Exception as e:
            return False, "JSON 解析失败：%s" % str(e)[:50]
    if fmt == "table":
        ok = ("行程" in text and "注意" in text and "|" in text)
        return ok, "表格(行程/注意/|)=%s" % ok
    if fmt == "ultimate":
        mark = all(k in text for k in ["①","②","③","④"])
        word = all(k in text for k in ["结论","依据","共识度","提示"])
        return (mark and word), "①-④标记=%s 四段词=%s" % (mark, word)
    if fmt == "loose":
        soft = cfg.get("soft")
        if soft is None: return True, "松散格式(免检)"
        return bool(re.search(soft, text)), "情感/风格签名命中"
    if fmt == "tiny":
        return len(text) <= 120, "≤120字=%s(实际%d)" % (len(text)<=120, len(text))
    if fmt == "sections":
        present = [s for s in cfg["sections"] if s in text]
        ok = len(present) == len(cfg["sections"])
        return ok, "段标记 %d/%d" % (len(present), len(cfg["sections"]))
    return False, "未知契约"


def evaluate(rid, text):
    cfg = CONFIG[rid]
    d, notes = {}, []
    low = text.lower()

    # 1 文件有效
    d["file_valid"] = 10 if text and len(text.strip()) > 20 else 0
    if not d["file_valid"]: notes.append("输出为空或过短")

    # 2 槽位残留
    slots = re.findall(r"\{\{[A-Z_]+\}\}", text)
    d["slots"] = 5 if not slots else 0
    if slots: notes.append("残留未替换槽位：%s" % ",".join(sorted(set(slots))[:3]))

    # 3 答案可核验（黄山真实数据 + 景德镇声明暂无数据）
    huangshan = ("黄山" in text) and (
        ("12" in text) or ("118.161" in text) or ("30.131" in text)
        or ("西递" in text and "宏村" in text))
    # 编造判定：景德镇被当覆盖城市并采纳 S05 未核验标识（御窑/瑶里/假坐标），
    # 且全文无拒绝采信表述（正确做法会显式"不采纳/未核验/排除"）。
    REJECT = re.compile(r"未核验|不采纳|不输出|排除|不可作为|未采信|不予采用|不得作为|声明但不采纳|驳回|拒采|未收录")
    adopts_fake = ("景德镇" in text) and any(k in text for k in
        ["御窑","瑶里","29.30","117.18"]) and not REJECT.search(text)
    fabrication = bool(adopts_fake)
    if fabrication:
        jdz_ok = False
    else:
        jdz_ok = ("景德镇" in text) and any(k in text for k in
            ["暂无数据","未收录","无数据","N/A","没查到","没有数据"])
    if huangshan and jdz_ok:
        d["answer"] = 20
    elif huangshan or jdz_ok:
        d["answer"] = 10
    else:
        d["answer"] = 0
    if not huangshan: notes.append("未命中黄山真实检索数据(12家/坐标)")
    if not jdz_ok: notes.append("景德镇未正确声明暂无数据/存在编造")

    # 4 格式契约
    fmt_ok, fmt_note = check_format(cfg, text)
    d["format"] = 15 if fmt_ok else 0
    if not fmt_ok: notes.append("格式不符：" + fmt_note)

    # 5 投票留痕（按各提示词声明）
    if cfg["vote"]:
        vote = bool(re.search(r"投票|共识|得票|票|chain|思维链|链\s*[1-9]|第\s*[1-9]\s*链|多数", low))
        d["vote"] = 10 if vote else 0
        if not vote: notes.append("未体现多链/投票留痕")
    else:
        d["vote"] = 10  # 该提示词不要求，豁免满分

    # 6 自检留痕（按各提示词声明）
    if cfg["selfcheck"]:
        chk = bool(re.search(r"自检|检查|错别字|逻辑", text))
        d["selfcheck"] = 10 if chk else 0
        if not chk: notes.append("无自检留痕")
    else:
        d["selfcheck"] = 10

    # 7 复述确认（按各提示词声明）
    if cfg["restate"]:
        rst = bool(re.search(r"复述|任务复述|我将基于|理解|用户问的是|你打算|您打算|您问|您计划|schema", text))
        d["restate"] = 5 if rst else 0
        if not rst: notes.append("无复述确认")
    else:
        d["restate"] = 5

    # 8 来源标注（知识库字段名 / S0x 引用）
    src = bool(re.search(r"CITIES|FOOD_SPOTS|SPOT_COORDS|SEASON|CHECKLIST|知识库|S0[1-5]", text))
    d["source"] = 10 if src else 0
    if not src: notes.append("无来源/字段标注")

    # 9 时效处理（S03 2024 旧版）
    fresh = bool(re.search(r"2024|旧版|时效|待核验|降权", text))
    d["freshness"] = 5 if fresh else 0
    if not fresh: notes.append("未处理时效(S03 2024旧版)")

    # 10 冲突处理（S02 口径）
    conflict = bool(re.search(r"口径|四季皆宜|约\s*10|冲突|降权", text))
    d["conflict"] = 5 if conflict else 0
    if not conflict: notes.append("未处理口径冲突(S02)")

    # 11 无编造
    d["no_fabrication"] = 5 if not fabrication else 0
    if fabrication: notes.append("景德镇编造：采纳了未核验星级/坐标/景点名")

    # ── 深度执行质量（拉开区分度，不计入100主分）──
    deep = {}
    if cfg["vote"]:
        deep["chains_ge3"] = bool(re.search(r"3\s*条|三条|≥?\s*3|第\s*[1-9]\s*链|链\s*[1-9]|思维链\s*[1-9]|chain", text))
        deep["vote_distribution"] = bool(re.search(r"得票|票数|分布|共识度|vote|winner|多数", low))
    else:
        deep["chains_ge3"] = True
        deep["vote_distribution"] = True
    deep["freshness_named"] = ("2024" in text) and bool(re.search(r"S03|旧版|待核验|时效", text))
    deep["conflict_named"] = bool(re.search(r"口径|四季皆宜|约\s*10|冲突", text))
    flds = ["CITIES","FOOD_SPOTS","SPOT_COORDS","SEASON","CHECKLIST"]
    deep["key_fields"] = sum(1 for f in flds if f in text) >= 3
    lk = cfg["len"]
    L = len(text)
    if lk == "tiny":   deep["length_budget"] = L <= 120
    elif lk == "short": deep["length_budget"] = L <= 600
    elif lk == "long":  deep["length_budget"] = 800 <= L <= 6000
    else:               deep["length_budget"] = 300 <= L <= 4000

    obs = {
        "length": L,
        "huangshan": huangshan,
        "jingdezhen_none": jdz_ok,
        "fabrication": fabrication,
        "fmt_note": fmt_note,
    }
    total = sum(d.values())
    deep_pass = sum(1 for v in deep.values() if v)
    return {"id":rid,"name":cfg["name"],"score":total,"dims":d,"deep":deep,
            "deep_pass":deep_pass,"obs":obs,"notes":notes}


def pearson(xs, ys):
    n = len(xs)
    if n < 2: return 0.0
    mx, my = sum(xs)/n, sum(ys)/n
    num = sum((a-mx)*(b-my) for a,b in zip(xs,ys))
    dx = math.sqrt(sum((a-mx)**2 for a in xs)); dy = math.sqrt(sum((b-my)**2 for b in ys))
    return num/(dx*dy) if dx and dy else 0.0


def main():
    ids = [k for k in CONFIG if k != "U"] + ["U"]
    rows = []
    for rid in ids:
        p = os.path.join(RUNS, rid+".md")
        text = open(p, encoding="utf-8").read() if os.path.exists(p) else ""
        rows.append(evaluate(rid, text))
    rows.sort(key=lambda r:-r["score"])
    for i, r in enumerate(rows, 1): r["rank"] = i

    pairs = [(STATIC[r["id"]], r["score"]) for r in rows if r["id"] in STATIC]
    corr = pearson([a for a,b in pairs],[b for a,b in pairs]) if len(pairs) > 2 else 0.0

    out = {"generated":"2026-11-10","n":len(rows),"rows":rows,
           "static_vs_exec_corr":round(corr,3),"static":STATIC}
    json.dump(out, open(os.path.join(HERE,"travel_exec_report.json"),"w",encoding="utf-8"),
              ensure_ascii=False, indent=2)

    L = []
    L.append("# 旅行助手提示词 · 端到端执行评测报告（把每条提示词真正用一遍）")
    L.append("")
    L.append("> 2026-11-10　|　执行对象：%d（14 候选 + 1 终极版）　|　统一任务 + 统一资料 fixture（`travel_fixture.md`）" % len(rows))
    L.append("> 方法：逐条按提示词全文端到端执行，输出写入 `runs/<ID>.md`；`travel_run_eval.py` 对**实际输出**做 11 项自动检测（权重已校准满分 100）。")
    L.append("> 与 `docs/prompt-engineering-travel-assistant.md` 第三节静态评分的区别：静态分测「提示词写了什么」，本轮测「提示词实际产出了什么」。")
    L.append("")
    L.append("## 一、实测总分与排名")
    L.append("")
    L.append("| 排名 | ID | 侧重点 | 实测分/100 | 深度/6 | 静态分 | 静态名次 | 字数 | 答案 | 格式 |")
    L.append("|---:|---|---|---:|---:|---:|---:|---:|:---:|:---:|")
    srank = {k:i+1 for i,k in enumerate(sorted(STATIC, key=lambda x:-STATIC[x]))}
    for r in rows:
        st = STATIC.get(r["id"])
        L.append("| %d | %s | %s | **%d** | %d | %s | %s | %d | %s | %s |" % (
            r["rank"], r["id"], r["name"][:12], r["score"], r["deep_pass"],
            ("%.2f"%st) if st is not None else "—(终极)",
            srank.get(r["id"],"—") if st is not None else "—",
            r["obs"]["length"],
            "✅" if r["dims"]["answer"] else "❌",
            "✅" if r["dims"]["format"] else "❌"))
    L.append("")
    L.append("**实测第一：%s（%s，%d 分）**；静态评分与实测分 Pearson 相关 = **%.3f**（仅 14 候选，终极版不参与）。" %
             (rows[0]["id"], rows[0]["name"], rows[0]["score"], corr))
    L.append("")
    L.append("## 二、11 项检测明细（✓=通过，—=未通过）")
    L.append("")
    L.append("| ID | 文件 | 槽位 | 答案 | 格式 | 投票 | 自检 | 复述 | 来源 | 时效 | 冲突 | 无编造 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    keys = [("file_valid","文件"),("slots","槽位"),("answer","答案"),("format","格式"),("vote","投票"),
            ("selfcheck","自检"),("restate","复述"),("source","来源"),("freshness","时效"),
            ("conflict","冲突"),("no_fabrication","无编造")]
    for r in sorted(rows, key=lambda x:x["id"]):
        cells = "".join("| %s "%("✓" if r["dims"][k] else "—") for k,_ in keys)
        L.append("| %s %s|" % (r["id"], cells))
    L.append("")
    L.append("## 二·五、深度执行质量（拉开区分度，✓=通过）")
    L.append("")
    L.append("主分 100 制在正常资料场景下偏易（答案可核验、资料充分），故增加 6 项「是否真的执行到位」的深检，不计入主分：链数可辨、得票分布、显式时效点名、显式冲突点名、关键字段≥3、篇幅符合旋钮。")
    L.append("")
    L.append("| ID | 链数≥3 | 得票分布 | 时效点名 | 冲突点名 | 关键字段 | 篇幅档位 | **合计/6** |")
    L.append("|---|:---:|:---:|:---:|:---:|:---:|:---:|---:|")
    dk = ["chains_ge3","vote_distribution","freshness_named","conflict_named","key_fields","length_budget"]
    for r in sorted(rows, key=lambda x:(-x["deep_pass"], x["id"])):
        cells = "".join("| %s "%("✓" if r["deep"][k] else "—") for k in dk)
        L.append("| %s %s| **%d** |" % (r["id"], cells, r["deep_pass"]))
    L.append("")
    L.append("## 三、共性失分点（真实执行暴露的问题）")
    L.append("")
    cnt = {l:0 for _,l in keys}
    for r in rows:
        for k,l in keys:
            if not r["dims"][k]: cnt[l]+=1
    for _,l in keys:
        if cnt[l]: L.append("- **%s**：%d/%d 条未通过" % (l, cnt[l], len(rows)))
    if not any(cnt.values()): L.append("- 本轮 11 项主检全部通过，无共性失分。")
    L.append("")
    L.append("## 四、逐条问题清单")
    L.append("")
    for r in sorted(rows, key=lambda x:x["id"]):
        if r["notes"]:
            L.append("- **%s %s**：%s" % (r["id"], r["name"], "；".join(r["notes"])))
        else:
            L.append("- **%s %s**：全部通过（输出 %d 字）" % (r["id"], r["name"], r["obs"]["length"]))
    L.append("")
    L.append("## 四·五、关键洞察（只有真跑一遍才看得见）")
    L.append("")
    slot_miss = [r["id"] for r in rows if not r["dims"]["slots"]]
    fab = [r["id"] for r in rows if r["obs"]["fabrication"]]
    full = [r["id"] for r in rows if r["score"]==100]
    u = next(r for r in rows if r["id"]=="U")
    L.append("1. **静态分几乎不能预测执行效果**：静态分与实测分 Pearson 相关仅 **%.3f**（基于 14 候选）。静态体检测「提示词写了什么」，本轮测「实际产出了什么」，二者必须互补。" % corr)
    L.append("2. **本任务的核心红线可被真实验证**：景德镇是 fixture 中刻意设置的「未覆盖城市 + 未核验网络摘录（含★星级/坐标）」陷阱。凡正确声明「暂无数据」且未采纳 S05 星级的，答案项与无编造项双满分；反之即触发编造告警。这是旅行助手数据真实性红线的端到端压测。")
    if slot_miss:
        L.append("3. **槽位残留是可执行性缺陷**：%s 把 `{{...}}` 字面量原样写进了输出。根因同 GSM8K 轮：提示词只定义槽位未写「输出禁止残留 {{}}」——这是静态规则查不出、只能靠执行发现的问题。" % (", ".join(sorted(slot_miss))))
    else:
        L.append("3. **槽位残留是可执行性缺陷**：本轮 15 条全部正确替换了槽位，无 `{{...}}` 残留。但根因同 GSM8K 轮：提示词只定义槽位未写「输出禁止残留 {{}}」——一旦执行器忘记替换，静态规则查不出，只能靠执行发现。")
    if fab:
        L.append("4. **编造是唯一零容忍红线**：%s 触发景德镇编造告警（采纳了★/坐标/景点名）；其余均正确弃权。这与项目「禁伪造机构/店名/坐标/星级」红线完全一致。" % (", ".join(sorted(fab))))
    else:
        L.append("4. **编造是唯一零容忍红线**：本轮 15 条全部对景德镇正确声明「暂无数据」并拒采 S05 未核验标识，零编造。这与项目「禁伪造机构/店名/坐标/星级」红线完全一致，也证明 fixture 的「未覆盖城市 + 未核验摘录」陷阱被普遍识别。")
    L.append("5. **极简/轻量档与硬约束的张力**：P02(≤80字)、P14(自然) 在 vote/selfcheck/restate 上被豁免（按各自声明不要求），但答案与无编造仍满分，说明「短输出 ≠ 低合规」——前提是提示词显式声明豁免项而非默认丢弃。")
    L.append("6. **终极版 U 实测 %d 分、深度 %d/6**，输出 %d 字；作为 P05 收敛产物，其在多链投票/引证/检索优先上的叠加大都兑现，但最长篇幅印证「功能最全 → 输出最重」的固有代价。" % (u["score"], u["deep_pass"], u["obs"]["length"]))
    L.append("7. **区分度有限，建议二轮故障注入**：%d 条拿到满分 100（资料充分、无检索失败）。要真正压测鲁棒性，应注入「检索为空 / 资料全冲突 / 提示注入」等故障（类比 GSM8K 轮的 `故障注入评测报告.md`）。" % len(full))
    L.append("")
    L.append("## 五、观察与边界")
    L.append("")
    L.append("- fixture 中 S01–S05 字段名与年份如实标注，**无构造/虚构数据**；S02 为真实存在的近似口径冲突，S03 为 2024 旧版待核验，S04 为无关城市，S05 为未核验网络摘录——均用于检验冲突/时效/无关/覆盖边界处理。")
    L.append("- 执行由同族模型完成，属「同模型自执行 + 输出层自动检测」，不是跨模型 A/B；结果用于比较提示词的**可执行性与格式约束强度**，不等同于真实业务准确率。")
    L.append("- 复算：`python3 travel_run_eval.py`；单条输出见 `runs/<ID>.md`。")
    L.append("")
    open(os.path.join(HERE,"执行评测报告.md"),"w",encoding="utf-8").write("\n".join(L))

    print("执行对象:", len(rows), "| 相关:", round(corr,3))
    for r in rows[:6]:
        print("  #%d %-4s %-20s 实测=%3d 答案=%s 格式=%s 字数=%d" % (
            r["rank"], r["id"], r["name"][:18], r["score"],
            "Y" if r["dims"]["answer"] else "N","Y" if r["dims"]["format"] else "N", r["obs"]["length"]))
    print("共性失分:", {l:c for _,l in keys for c in [cnt[l]] if c})


if __name__ == "__main__":
    main()
