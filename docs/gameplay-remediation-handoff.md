# 游戏玩法修复交接

## 目标与授权

用户先要求全面审查玩法，之后授权“帮我按顺序进行修复吧”。目前用户要求停止本会话施工，交由另一个 agent 会话继续。修复尚未完成，不要把现有补丁或历史测试当成最终验收。

工作目录：`/Users/zxnap/code/MyWorks/yltech.edu/game`。纯前端原生 ES Modules / Three.js 0.160.0 / 无构建安装步骤。用户使用中文。未授权 commit、push、发布；保留工作区所有既有改动。

规格：`_bmad-output/implementation-artifacts/spec-gameplay-remediation.md`（in-progress，基线 `c9060e4915efb1de41fb9b29c8a4f650175978f3`，冻结段勿改）。已应用 gds-quick-dev、review-remediation、game-playability-triage；quick-dev step03 实施中，step04 尚未执行。技能入口 `.agents/skills/gds-quick-dev/`，review-remediation 位于 `/Users/zxnap/.agents/skills/review-remediation/`。继续时读取相应技能及必要步骤，勿重做历史审查。

## 已实施代码（仍需补齐回归与复核）

1. 四项 P1：
   - `js/levelRun.js`、`js/levelEditor.js`：进临时世界要求 `saveGame() === true`；失败拒绝进入，保留原世界并提示。
   - `js/assistant/snapshot.js`：运行/编辑临时世界只写 `temporaryWorldWasActive` 标记，不序列化方块；恢复拒绝临时快照。
   - `js/saveGame.js`：导入先验证尺寸、base64、RLE/raw 完整长度再修改槽位；先写槽位后写索引，保存失败返回 false。
   - `js/levelEditor.js`：verifiedPasses 用 nullish fallback，显式 0 不再误变成已通过。
2. 碰撞、战斗、耐久：
   - `js/playerPhysics.js`：X/Z 扫描上限用 ceil，阻挡部分覆盖头部的墙。
   - `js/interaction.js`：怪物 AABB 射线攻击、眼睛到命中点最多 4 格、方块遮挡；raycastBlocks 返回 distance。
   - `js/entities.js`：僵尸近战视线遮挡；重合位置避免除以 0。
   - `js/ui.js`：合成备用工具保留当前工具磨损，导出 craftRecipe 供实际模块测试。
   - `js/interaction.js`、`js/items.js`：最后一把工具丢弃时携带 wear，拾回不洗耐久；工具数量+活动工具磨损模型维持原架构。
3. 快照与机关：
   - 快照恢复 survival / toolWear / worldSeed，坏 base64 返回失败；清临时实体、队列并重新初始化机关。
   - `js/redstone.js`：初始化清注册表、按钮定时器、活塞状态，并释放编码为 pressed 的按钮。
   - `js/kinetic.js`：投料器放置/替换水后标记网络重算。
   - `js/tnt.js`：仅有效 TNT 点燃、同位置引信去重、方块已替换则取消引信、爆心重合不产生 NaN。
4. 草稿与计时：
   - `js/levelEditor.js`：续编保留 draftCard / lastDraftId / rules / created；await 缩略图 toBlob；新卡成功后删旧 id。
   - `js/levelWorkshop.js`：buildLevelCard 接受 rules 覆盖，保留 timeLimit / lockAIHelp。
   - `js/levelRun.js`：tickRun 先判断超时再踩终点，越限不能结算成功；超时 0 星。

## 独立复核后最新补丁：尚未测试

独立只读代理已完成，发现 6 个残余问题。随后主会话修改：

- `js/levelEditor.js:242` saveEditorDraft 用 ed.draftSavePending Promise 链串行化，finally release，防旧保存完成后删新草稿。现有 try 内缩进待整理。
- `js/saveGame.js` 导入 initRedstone/initKinetic，loadGame 恢复世界后初始化两网络；player 重置 dead:false / fallStartY:null / inWater:false。onGround 尚未重置。
- `js/tnt.js` explode 的 dirty chunks 初始包含爆心所在区块，修单个孤立 TNT 被引信移除后残留网格。
- **本会话最后一笔修改** `js/interaction.js:194`：攻击命中点与玩家眼睛的向量和准星 dir 点积 < 0 时跳过，修第三人称优先攻击身后敌人。此修改尚未跑测试；需要验证前方敌人仍可选中、墙遮挡正确。
- `js/levelRun.js` tickRun 注释改为计时→限时超时→踩踏→掉界。

最新整体测试证据仍是独立复核的 **44 passed / 0 failed / 约 3.9 秒**，发生于以上补丁之前。不要宣称当前工作树全绿。

## 剩余工作（建议按此顺序）

1. 阅读 tests/gamelogic/README.md、kit.mjs、_preload.mjs，补真实模块回归并先跑 targeted suite。
   - remediation.test.mjs 当前只有 3 个测试：损坏导入不改槽位/索引；保存失败拒绝进入；编辑快照不覆盖原世界。
   - 已加多个 imports 以备新测试，但没有新增 test bodies，且 imports 尚未验证。
2. 修高速垂直穿透：playerPhysics Y 轴只取 newY 终点层，dt<=0.1、vy>=-40 时一次能跌 4 格，跳过薄平台。例 feet y20→16，平台 y18。需扫掠经过的 voxel 层、按移动方向选首先接触层，并保留粘液弹跳/摔落/骑带/活塞机制。
3. loadGame 重置 onGround；测试临时压力板注册表不再在普通世界覆盖石头，动力不残留。检查快照粒子清理（目前 particles 未清），注释仍只讲 run 的地方同步 editor。
4. 草稿队列进一步检查：exitLevelEditor({saveDraft:false}) 在途保存、buildLevelCard 在 await authored locks 前后采集 region/flags/blocks 的一致性。普通退出 await 保存改善了竞态，但可能还有换世界混合快照；先证明再修。清缩进。
5. 补回归覆盖：
   - explicit-zero verifiedPasses；部分头部墙；玩家/僵尸隔墙攻击；零距离怪物；第三人称后方目标；高速落地。
   - 合成/丢弃/拾回耐久；快照 survival/seed/网络/坏 base64/瞬态清理。
   - 按钮恢复；投料器替换水；TNT 去重/取消/爆心/区块刷新；loadGame 缓存与摔落状态。
   - 草稿单条身份/rules/并发保存；越限同帧到终点失败。
6. 更新 js/assistant/knowledge.js（保留用户既有编辑），规格任务勾选、审查销项记录，完成 quick-dev step04 和独立后续复核。
7. 执行下方全量验证。浏览器证据尚未取得，Node 模块通过不能代表实际可玩性。若浏览器可用，用 ego-browser；禁止按旧 AGENTS 示例自行启动 CDP。没有 browser 证据就明确未验证。

第三人称复现 fixture：player=(10.5,10,10.5)、yaw/pitch=0；camera=(10.5,11.62,15) 看向 -z；rear enemy z12.5（t2.2，eye distance2.3）；front enemy z8.5（t6.2）。此前 rear 抢 nearest；新点积守卫需回归。

## 验证命令

```sh
node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs
node tools/test_builtin_levels.mjs
node tools/test_level_editor.mjs
node tools/test_question_bank.mjs
node tools/test_level_run.mjs
node tools/test_level_workshop.mjs
node tools/test_edu_progress.mjs
node --test tools/test_assistant_knowledge.mjs
python3 tools/validate_banks.py
```

## 实施注意

- state 单例，世界 Uint8Array 256×256×128；区块16；tick50ms。
- freshWorld 不重置 wear/hunger/xp/level sessions，新测试显式重置。
- pump 顺序 TNT→redstone/pistons→kinetics→drops。
- config 用 waterwheelId/WATERWHEEL_BASE，没有 WATERWHEEL 常量；buttonId/buttonPressed/deployerId 生成变体。
- woodpick190；木镐 recipe PLANKS3/STICK2；inventory 是数量，toolWear 是活动工具损耗。
- 保持既有设计：死亡留背包、瞬时冶炼、暂停/背包/死亡继续模拟、坐标题、商人模式、锁题内存、简化退出恢复、机械套装、苦力怕火药/粘液奖励。
- 内置卡不能手改 JSON；改生成器才重跑产物。本任务未改官方关卡。
- 读文件后 edit；glob 发现，grep 搜索；工具 FS_STALE_VERSION 则重新 read/rebase。不要整体还原工作树。
- 没有运行中的 shell/background job；独立代理结果已收齐；没有启动服务器。工具尝试给已完成旧代理发消息曾报 target not found，勿据此重派重复工作。
- 持久 goal id=goal-4f9df2fa-0b99-408d-8f63-057d09131c87，交接时将 pause（任务未完成，别 mark complete）。新会话根据用户继续指令建立/恢复自己的任务追踪。

## 既有用户修改（勿归为本次任务或覆盖）

任务开始前已改：.gitignore、assets/.DS_Store、index.html、js/assistant/{agent,docs,jev,knowledge,tools,ui}.js、js/{input,main,redstone,state,textures,ui,uiKeys,uiModal}.js、tests/e2e/{run_regression,smoke_assistant_jev}.py、tools/test_assistant_{jev,knowledge}.mjs。

任务开始前已 untracked：.DS_Store、docs/{assistant-sim-elevator-findings,jev-evidence-loop-plan,testability-plan}.md、docs/redstone-energy-guide.html、js/{assistant/evidence,helpDocs,textureTiles}.js、tests/{assistant-sim,gamelogic}/、tools/test_assistant_evidence.mjs。本任务新增 remediation.test.mjs 位于此前就 untracked 的测试目录。

当前 git status 包含混合用户改动与本次补丁，不能直接 git add/commit 全部。交接时未提交、未推送、未发布。


## 2026-10-11 续修完成附录（最新状态）

本文件以上部分为交接时历史状态。“尚未测试”“剩余工作”已由本次续修完成；以 [完整销项与最终证据](gameplay-remediation-verification-2026-10-11.md) 为准。规格已标 done，冻结授权段未改，五项任务全部勾选。

- 首先验证最新交接补丁 44/44；随后补齐高速垂直扫掠、读档落地态、粒子清理、异步几何一致性、存稿队列与退出排空。
- 三路只读复核发现的入口提示／互斥、按钮下降沿／重复 init、贴脸攻击、模板身份、正式 UI 规则、持久存储降级跨会话备份保护均修复并再次销项。
- 浏览器真实点击额外修复导出面板被画布挡住、保存错误提示被浮层盖住。
- 最终游戏逻辑 86/86，其他 Node 契约和知识库 136/136；题库 597 题零违规。真实 rAF／W／Enter、DOM 保存按钮与原生 IndexedDB 故障回归通过，证据已归档。
- 无旗标／超范围末稿退出仍走原简化恢复设计，属于预存限制，见 [deferred-work.md](../_bmad-output/implementation-artifacts/deferred-work.md)。本次没有把它报告为已解决。
- 未暂存、未提交、未推送、未发布；保留本文件记录的全部既有工作区改动。没有改官方卡生成产物。


## 2026-10-11 后续授权：无效末稿退出丢失修改已销项

用户后续明确要求“保存失败时提示原因，让用户选择继续编辑或明确放弃”，取代上一轮保留简化退出的约束。本项已完成：[退出保护验收与证据](editor-exit-verification-2026-10-11.md)，[新规格](../_bmad-output/implementation-artifacts/spec-editor-exit-save-failure.md)标 done；原规格冻结段及上方历史记录保持。

缺旗／无锚点／超范围／持久保存失败均保留编辑世界显示原因，默认继续（Esc/Q），明确放弃才恢复；最后有效稿保留。补齐事务提交判定、保存中鼠标／作者输入和助手原生事件守卫。新增 12 项专项、全量逻辑 98/98、其他 Node 136/136，完整真实浏览器与三路独立复核通过。知识库、工坊契约和 deferred 项已同步。未提交、推送、发布，既有改动保留。
