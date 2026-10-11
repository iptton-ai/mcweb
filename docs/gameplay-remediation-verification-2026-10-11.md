# 游戏玩法修复验收与销项（2026-10-11）

本次交接的修复、回归、知识库同步和独立复核已完成。规格为 [spec-gameplay-remediation.md](../_bmad-output/implementation-artifacts/spec-gameplay-remediation.md)，基线为 `c9060e4915efb1de41fb9b29c8a4f650175978f3`。先验证交接时最新补丁（44/44），再修剩余问题，最终全量逻辑回归 **86/86**。未提交、未推送、未发布；混合工作区既有修改继续保留。

## 销项表

以下结论对照实际源码与测试，不沿用交接时“尚未测试”的状态。测试文件均调用真实游戏模块，渲染与浏览器平台边界由 gamelogic 预载垫片替代。

| 编号 | 优先级／问题 | 最终行为 | 回归证据 | 状态 |
|---|---|---|---|---|
| R01 | P1 临时世界入口原世界保存失败 | 保存严格成功才进入；失败保留原世界，列表／试玩／编辑均显示存储原因 | remediation、review；真实试玩按钮故障注入与截图 | ✅ |
| R02 | P1 编辑／闯关热重载污染槽位 | 临时世界只写标记，不序列化方块；启动恢复原槽 | remediation；snapshot 模块 | ✅ |
| R03 | P1 损坏世界导入覆盖存档 | 完整校验尺寸、base64、RLE/raw 长度后写入；损坏数据不改原槽及索引 | remediation；浏览器 native 场景 | ✅ |
| R04 | P1 零次验证被误当已通过 | 显式 0 保持 0；草稿缺省次数也为 0；正式导出继续双通过验证 | lifecycle；浏览器草稿验证 | ✅ |
| R05 | P2 部分头部墙碰撞缺口 | X/Z 包含头部覆盖的上层格 | physics；真实 W 键撞墙 | ✅ |
| R06 | P2 高速垂直穿过薄平台／天花板 | 扫过全部经过层，按整个碰撞盒先接触位置阻挡 | physics：上升／下落／粘液／摔伤／水／传送带／活塞；真实 rAF 下落 | ✅ |
| R07 | P2 玩家穿墙近战及第三人称误选身后 | 准星射线与实体盒求交，眼睛距离 ≤4 格；墙遮挡；射线从眼睛投影处起算，贴脸前方仍命中 | combat；真实 Enter 第三人称攻击，后方 hp20／前方 hp14 | ✅ |
| R08 | P2 僵尸隔墙攻击、实体重合 NaN | 近战路径受实心方块遮挡；重合位置除零守卫 | combat | ✅ |
| R09 | P2 合成／丢弃拾回洗工具耐久 | 合成备用保留活动工具磨损；最后一把丢弃携带磨损，拾回合并取较大值 | combat：合成、损坏切备用、最后一把及有备用丢弃 | ✅ |
| R10 | P2 快照遗漏生存／种子、瞬态残留 | 恢复 hunger/air/xp/toolWear/worldSeed；先校验坏编码；清施工、生物、掉落、引信与粒子，重建机关 | lifecycle；浏览器快照回环 | ✅ |
| R11 | P2 读档落地／落差与机关缓存污染 | 重置 onGround/fallStartY/inWater/dead，清旧注册并重算红石／动力 | lifecycle | ✅ |
| R12 | P2 按钮恢复、重复初始化活塞丢动作 | 按钮释放前只采集原供能，释放后回放下降沿；重复 init 按实际伸出态重建动作；未供能手动门保持 | mechanisms：关门、收回、重复 init、合法伸出、手动门与 TNT | ✅ |
| R13 | P2 投料器替换水后动力不更新 | 水源被机器放置／替换后标记动力网络重新求解 | mechanisms：独立动力线水车／带停转 | ✅ |
| R14 | P2 TNT 重复引信、替换幽灵爆炸、爆心 NaN／残网格 | 有效 TNT 才点燃，同格单引信且不重置；替换取消；爆心有限数值；孤立爆炸也刷新区块 | mechanisms；浏览器 native TNT 场景 | ✅ |
| R15 | P2 草稿身份／规则丢失，模板覆盖源稿 | 续编保留 created/rules；模板草稿另开身份；正式卡改副本保留源卡 | lifecycle；真实 IndexedDB 草稿更新 | ✅ |
| R16 | P2 异步存稿／退出与出卡混合世界竞态 | 串行存稿；退出等在途，重复退出合并；摘守卫前加载恢复模块；几何一致快照，切世界中止出卡 | lifecycle：toBlob 延迟、并发保存、saveDraft:false、异步取锁换世界 | ✅ |
| R17 | P2 正式 UI 导出丢限时／考核锁 | 保存按钮保留 timeLimit；源卡初始化考核意图，作者修改同步，退出恢复原意图 | review；真实表单填写与保存按钮 | ✅ |
| R18 | P1 持久写失败后误删旧稿／同 ID 最新稿不可见 | 最新会话稿覆盖读取；持久成功才替换持久备份，旧会话只删内存；同 ID 退出续编另查磁盘备份；提示会话保存限制 | lifecycle：可读可删但 put 失败的 IDB 边界；真实浏览器 IDB put 故障及跨退出续编 | ✅ |
| R19 | P2 越限同帧踩终点成功 | 先判超时再踩终点；超时结算 0 星 | lifecycle、test_level_run | ✅ |
| R20 | P2 快速临时入口清掉另一会话、UI 点击／提示被画布盖住 | 入口共享同步互斥；导出浮层层级 74 且注入样式；tooltip 层级 130、仍不拦截点击 | review；真实导出与试玩失败按钮、可见性断言及截图 | ✅ |

细项测试：

- [remediation.test.mjs](../tests/gamelogic/remediation.test.mjs)：3 项交接已有回归。
- [remediation-physics.test.mjs](../tests/gamelogic/remediation-physics.test.mjs)：8 项。
- [remediation-combat.test.mjs](../tests/gamelogic/remediation-combat.test.mjs)：9 项。
- [remediation-lifecycle.test.mjs](../tests/gamelogic/remediation-lifecycle.test.mjs)：13 项。
- [remediation-mechanisms.test.mjs](../tests/gamelogic/remediation-mechanisms.test.mjs)：9 项。
- [remediation-review.test.mjs](../tests/gamelogic/remediation-review.test.mjs)：3 项。

专项回归共 45 项，本次续修新增 42 项；全套还包含既有 41 项逻辑测试。

## 最终验证

| 命令／套件 | 结果 | 保存证据 |
|---|---|---|
| `node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs` | 86/86，0 fail/skip | [final-logic.log](gameplay-remediation-evidence/2026-10-11/final-logic.log) |
| `node tools/test_builtin_levels.mjs` | 64/64 | [builtin.log](gameplay-remediation-evidence/2026-10-11/builtin.log) |
| `node tools/test_level_editor.mjs` | 10/10 | [editor.log](gameplay-remediation-evidence/2026-10-11/editor.log) |
| `node tools/test_question_bank.mjs` | 13/13 | [question-bank.log](gameplay-remediation-evidence/2026-10-11/question-bank.log) |
| `node tools/test_level_run.mjs` | 10/10 | [run.log](gameplay-remediation-evidence/2026-10-11/run.log) |
| `node tools/test_level_workshop.mjs` | 21/21 | [workshop.log](gameplay-remediation-evidence/2026-10-11/workshop.log) |
| `node tools/test_edu_progress.mjs` | 8/8 | [edu-progress.log](gameplay-remediation-evidence/2026-10-11/edu-progress.log) |
| `node --test tools/test_assistant_knowledge.mjs` | 10/10 | [knowledge-tests.log](gameplay-remediation-evidence/2026-10-11/knowledge-tests.log) |
| `python3 tools/validate_banks.py` | 597 题、0 违规、0 提醒 | [banks.log](gameplay-remediation-evidence/2026-10-11/banks.log) |
| `git diff --check` | 通过 | 最终工作区检查 |

Node 合计 **222/222**。知识库已同步碰撞／攻击／耐久、快照与读档、按钮恢复、临时入口、草稿降级、模板身份、正式导出规则与超时顺序，保留原有知识库修改。

浏览器使用 ego-browser 同一 TaskSpace 9、p1，隔离 origin `http://127.0.0.1:18641/`，真实 Three.js、DOM、IndexedDB。没有按旧 CDP 示例启动浏览器。脚本为 [gameplay_remediation_ego.mjs](../tests/e2e/gameplay_remediation_ego.mjs)，包含 9 组原生模块场景、真实 rAF 下落／W 撞墙／Enter 第三人称攻击、6 组草稿生命周期检查、7 组正式导出与存储降级检查，以及真实试玩失败提示检查。输入采用已观察到的表单／按钮，存储故障补丁在 finally 恢复；只清理测试创建的卡，未操作其他 origin 的用户存档。

浏览器结果：[browser.log](gameplay-remediation-evidence/2026-10-11/browser.log)。[失败提示截图](gameplay-remediation-evidence/2026-10-11/save-error.png) 已视觉复核，提示出现在关卡浮层上；[游戏画面](gameplay-remediation-evidence/2026-10-11/final.png) 已视觉复核。此次没有逐关手动完成全部官方关卡，也没有重跑全部历史 CDP E2E，官方卡只承诺上述 64 项静态／逻辑契约通过。

## 独立复核与处置

quick-dev step04 使用三个未继承会话的只读核查代理，分别审补丁、边界及规格验收；核查员没有编辑源码或运行测试。最终跟进继续检查最新源码。

| 核查发现 | 分类与处置 | 最终核查 |
|---|---|---|
| 保存失败提示调用与被通用提示覆盖；试玩按钮漏同步 | patch：正确 showTooltip 与入口错误 accessor；真实失败按钮确认 | acceptance 已销项 |
| 并发临时入口，草稿模板源身份，正式 UI 导出限时／考核意图 | patch：互斥、模板新身份、规则与意图同步 | acceptance／edges 已销项 |
| 按钮下降沿缺失、重复 init 丢失活塞动作，第三人称贴脸被过滤 | patch：基线只读采集／实际伸出态重建／眼睛投影 | blind 未发现新可达错误 |
| IDB put 失败后的同 ID 遮蔽、跨退出续编误删备份 | patch：只清旧会话、另查持久身份；补跨会话测试和真 IDB 故障 | acceptance／edges／blind 均销项 |
| 导出浮层缺层级、失败提示被浮层遮盖（浏览器实测） | patch：补 UI 层级，真实点击与截图验证 | blind 未发现新问题 |
| 无旗标／超范围末稿无法保存时退出仍恢复原世界 | defer：预存限制，交接明确保留简化退出，不新增退出阻断设计 | [deferred-work.md](../_bmad-output/implementation-artifacts/deferred-work.md) |

本次修复范围无剩余可复现的未修项；此结论不等于仓库所有玩法和历史 E2E 均已验收。三路复核全部收齐后完成规格与交接状态回写。未设置 story_key，按 quick-dev 规则跳过 sprint-status，同样没有改已冻结的授权边界。

## 工作区与复跑

源码补丁与既有改动共存；上述 diff 基线用于审查，不代表该基线之后的所有改动均属于本任务。官方关卡 JSON／生成器未修改。用户要求不提交，所以覆盖技能默认提交步骤，也未建立分支或暂存。

复跑浏览器：用隔离端口启动 `python3 server.py --port 18641 --host 127.0.0.1`，在 ego-browser 当前任务页加载该 origin，调用脚本导出的 `run`、`runLifecycle`、`prepareExport` → 观察表单 → `runExport`、`prepareTrySaveFailure` → 观察按钮 → `runTrySaveFailure`。TaskSpace 9 是本次本机运行的标识，不应在另一台机器硬编码复用。


## 后续修复：此前退出限制已解决

本报告 deferred 表格为前一批验收时的历史状态。用户后续已明确授权退出失败选择；无旗标／超范围末稿退出丢失修改现已修复并销项，见 [本轮退出保护验收](editor-exit-verification-2026-10-11.md)。此追加不改原批次测试口径或冻结规格。
