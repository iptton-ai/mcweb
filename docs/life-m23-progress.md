完成状态（2026-10-18）：第二、三批已全部完成。本地实现、三路独立审查、190项逻辑回归、217项工具回归、52项最终浏览器模块检查及原生游玩均通过。最终报告：`docs/survival-m23-verification-2026-10-18.md`。未提交推送或发布。以下保留历史交接记录。

# 生存第二三批执行记录

目标：按已确认行动计划完成第二批 A07–A10＋A15、第三批 A11–A14，并完成回归、独立审查与真实浏览器验证。用户授权本地实现，不发布、不提交推送。

2026-10-18 初始状态：第一批已完成但未提交，基线逻辑129/129通过。原未提交文件和无关 `.ref-zcode`、dsh分析资料保留。

- M2规格：`_bmad-output/implementation-artifacts/spec-survival-m2.md`，实施中。
- M3规格：`_bmad-output/implementation-artifacts/spec-survival-m3.md`，M2完成并集成后继续。
- 共同约束：`docs/survival-m23-contract.md`。
- 工作树基线快照：`/var/folders/58/mctmb5rs4m36zm0x9zdhfy480000gn/T/mcweb-m23-baseline-p547scsj`，清单在 `docs/life-m23-evidence/2026-10-18/baseline.json`。比较本批差异使用该快照，不能拿HEAD当M1已提交版本。
- 旧地形v1/v2四种子hash：同证据目录 `baseline-terrain.json`。
- M2唯一产品实现代理：`/root/m23_storage_recon`。模块计划 inventoryStacks.js / lifeData.js / homestead.js / lifeUI.js / survivalRules.js，父代理独占浏览器与E2E脚本。
- M3只读准备：`/root/m23_adventure_recon`。调查已完成，正在细化地标与产线可玩布局。
- 测试环境：Ego TaskSpace **96**，`p1`，独立 `http://127.0.0.1:8148/`；server exec session **98555**。整个目标只用这个TaskSpace，结束时finish一次并停止本任务服务器。

待验收重点：工具多磨损守恒；箱满、销毁立即保存；炉加工中保存；生产有效时钟与植物数量无关；树苗不覆盖建筑；家畜跨死亡/远距/换槽/临时世界；标准生存AI多入口与队列切换；重复题不刷高级物资；旧地形保真；三地标实际可往返；机器产物真正入箱；目标与展示入口实际有效。

2026-10-18 续接：旧代理/服务器/浏览器任务空间已不存在；Ego空间列表为空后恢复为TaskSpace97（p1），服务8148 exec session21910，测试存档仍在。M2完成：165逻辑＋217工具＋32浏览器边界全过，实际农林羊炉箱流程记录在验证报告。M3唯一产品实现代理 `/root/m3_implement`，基线 `/var/folders/58/mctmb5rs4m36zm0x9zdhfy480000gn/T/mcweb-m3-baseline-swsel_rb`，清单m3-baseline.json。父独占E2E脚本与总验证报告。
