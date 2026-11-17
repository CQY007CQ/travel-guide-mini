<!-- candidate: C13 -->
task: 对 v1.20.10 做升级评估，产出改什么/为什么/怎么验证。

restate: 评估非开发；输入=事实清单+check-health 单一出口；交付=八字段定序可校验；约束=只读、61 步与 800 行不动、阈值只加严、涉本人动作只列不做。

evidence: ①主包 raw 1177KB、余量 359KB、steps=61、30/30 通过（check-health [fig]；阈值 1536 见 check-health.mjs:47）。②跨页衔接已实现：crossSceneHints 注入他页最近 2 条提问，TTL 10min（utils/ai-agent.js:87-110），已入 allcheck.sh:306（10 通过）。③MAX_SCENES=8（ai-agent.js:28，注释称 11）< 实测去重 12 个 scene，守卫仅断言 >=8（check-ai-fallback.mjs:94）。④美食 (0,0) 299 / 无坐标 371（共 9625），无 pin 合计 670；613 在 docs grep 无命中，待确认。

chain: A 待办驱动——六.1 已在、已测，判不改，先修口径。B 门禁驱动——359KB 非瓶颈，增量在门禁，首优把包内能力做对→MAX_SCENES。C 症状驱动——8 槽淘汰 4 场景加 10min TTL→MAX_SCENES。投票取 B/C（频次 2、无矛盾）为 P0；分歧：A 排口径第一，B/C 排可见缺陷第一。

verdict: 不改跨页衔接新开发（「缺 400 字节主包」仅见事实清单、已失效），转验收。改：P0 场景容量 8→12；P1 补「无 pin 合计 670」派生量收敛 613；P2 守卫与余量阈值按棘轮加严。

actions: ①ai-agent.js:28 改 8→12，跑 node tools/web/build.mjs，验证 _test-cross-scene-ai.mjs。②check-ai-fallback.mjs:94 断言 >=8 加严为 >=12，注 grep 来源，串现有 step 不新增。③check-health 增「无 pin 合计 670」派生量，令 613 回流单一出口，验证 30/30。④check-health.mjs:52 余量 >0KB 断言加严，水位先与用户确认。

risks: ①ai-agent.js 不在 build-min 名单与 _src-backup，判手写真源；若纳入压缩须回改（待确认）。②modules.js 为产物，漏跑 build 双端漂移。③12 槽落盘上界按 12×6×2×600 估算，未实测。④613/670 差额或源自并表中间态（日志 298/298/299），改前冻结数据版本。

selfcheck: ①复跑两次 diff=0，main_raw_kb=1177 / headroom=359 / steps=61，30/30。②guards 首轮 28、复跑 29：新增 check-prompt-lab.mjs 抬升文件计数（check-health.mjs:100），按复跑取值。③allcheck 仍 61 步，全程只读。④613 与「400 字节」降级待确认，无编造。
