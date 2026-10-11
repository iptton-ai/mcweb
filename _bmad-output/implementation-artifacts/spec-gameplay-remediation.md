---
title: 游戏玩法审查问题修复
type: bugfix
created: 2026-10-11
status: done
baseline_commit: c9060e4915efb1de41fb9b29c8a4f650175978f3
context: []
---

<frozen-after-approval reason="用户已授权按审查优先级依次修复">

## Intent

**Problem:** 已复现四项 P1 数据与验证缺陷及多项 P2 玩法错误，涉及临时世界隔离、存档导入、碰撞、战斗、工具耐久、热重载和机关运行。

**Approach:** 按既有报告顺序修复实际源码，添加真实模块回归，进行独立核查并记录销项。

## Boundaries & Constraints

**Always:** 保留工作区既有改动、原生 ES 模块架构和存档兼容；修复前核对源码；玩法机制修正同步知识库。

**Ask First:** 新增玩法或改变已确认的设计取舍需要用户决定。

**Never:** 不发布、不提交推送、不改官方关卡生成产物；不将尚未实测的可达性当作通过。

## I/O & Edge-Case Matrix

| 场景 | 输入 | 预期 | 错误处理 |
|---|---|---|---|
| 进临时世界 | 原世界保存失败 | 保留原世界、拒绝进入 | 可见提示 |
| 导入 | 编码损坏或尺寸不符 | 原槽位保持完整 | 返回错误 |
| 编辑热重载 | 活跃编辑世界 | 原世界继续受隔离 | 放弃临时世界快照 |
| 续编题目 | verifiedPasses=0 | 保持零次 | 正式导出继续拦截 |
| 物理战斗 | 上层墙、实体在墙后 | 碰撞阻挡、攻击不穿墙 | 不扣血 |
| 工具 | 合成新工具、丢弃拾回旧工具 | 旧工具耐久不重置 | 保存磨损 |
| 重载 | 世界与生存状态快照 | 状态完整、机关重新求解 | 坏快照返回失败 |
| 机关 | 按钮恢复、水被替换、重复点燃 | 按钮复位、动力停转、单引信 | 无幽灵爆炸与 NaN |
| 草稿与计时 | 续编修改、越限到达终点 | 草稿单条、规则保真、超时失败 | 保留正式卡身份语义 |

</frozen-after-approval>

## Code Map

- `js/saveGame.js`、`js/levelRun.js`、`js/levelEditor.js`：存档与临时世界生命周期。
- `js/assistant/snapshot.js`：热重载快照。
- `js/playerPhysics.js`、`js/interaction.js`、`js/entities.js`：碰撞与战斗。
- `js/mining.js`、`js/ui.js`、`js/items.js`：耐久与掉落。
- `js/redstone.js`、`js/kinetic.js`、`js/tnt.js`：机关。

## Tasks & Acceptance

**Execution:**
- [x] 修复四项 P1 并补回归。
- [x] 修复碰撞、战斗、工具耐久并补回归。
- [x] 修复快照、按钮、投料器与 TNT 并补回归。
- [x] 修复草稿身份、规则与限时边界并补回归。
- [x] 同步知识库、全量验证、独立只读核查和销项记录。

**Acceptance Criteria:**
- Given 已复现缺陷，when 对应入口再次运行，then 不变量符合矩阵且回归通过。
- Given 既有逻辑与契约测试，when 全量运行，then 无新增失败。

## Spec Change Log

用户已在前文授权“帮我按顺序进行修复吧”；本规格记录既有授权，不新增确认流程。

2026-10-11 续修：先确认交接补丁 44/44，再完成垂直扫掠、生命周期／草稿并发／快照清理。独立复核补充入口互斥、按钮下降沿与重复初始化、模板身份、正式导出规则、持久写失败跨退出续编保护；浏览器实测补导出浮层和错误提示层级。上述属于原边界内修复，冻结段未改变。保留无效末稿的简化退出设计并独立记录后续项；用户禁止提交覆盖技能默认提交步骤。

## Verification

**Commands:**
- `node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs`
- 六项关卡与教学契约脚本。
- `node --test tools/test_assistant_knowledge.mjs`


**Final results (2026-10-11):**
- 游戏逻辑 86/86（专项 45 项，续修新增 42 项）；其他 Node 契约／知识库 136/136，共 222/222。
- 题库 597 题、0 违规；git diff --check 通过。
- ego-browser 真实 Three.js／DOM／IndexedDB、rAF／W／Enter、正式导出按钮及存储故障跨退出续编通过。
- 三路独立只读复核与最新补丁跟进销项收齐。
- [完整销项与证据](../../docs/gameplay-remediation-verification-2026-10-11.md)；[既有退出设计限制](deferred-work.md)。
- story_key 未设置，sprint-status 同步按规则跳过。未提交／推送／发布；既有改动保留。

## Suggested Review Order

**临时世界与数据边界**

- 原世界必须落盘，临时入口同步互斥。
  [levelRun.js:139](../../js/levelRun.js#L139)

- 编辑入口隔离锁题、规则与备份身份。
  [levelEditor.js:106](../../js/levelEditor.js#L106)

- 导入先校验完整编码，避免破坏原槽。
  [saveGame.js:338](../../js/saveGame.js#L338)

- 快照拒收临时世界并重建生存与机关。
  [snapshot.js:84](../../js/assistant/snapshot.js#L84)

**碰撞与战斗**

- 垂直扫掠按方向选择首次碰撞。
  [playerPhysics.js:17](../../js/playerPhysics.js#L17)

- 从眼睛投影检测，防身后误命中。
  [interaction.js:182](../../js/interaction.js#L182)

**机关与异步草稿**

- 按钮下降沿与实际活塞状态恢复。
  [redstone.js:623](../../js/redstone.js#L623)

- 爆心与引信保持有效、去重和可取消。
  [tnt.js:49](../../js/tnt.js#L49)

- 存稿串行，只在持久成功后替换备份。
  [levelEditor.js:277](../../js/levelEditor.js#L277)

- 一致几何快照避免跨世界混合卡。
  [levelWorkshop.js:269](../../js/levelWorkshop.js#L269)

- 同身份会话覆盖读取，另查持久备份。
  [levelWorkshop.js:695](../../js/levelWorkshop.js#L695)

- 正式保存入口保留限时与考核意图。
  [ui.js:1437](../../js/ui.js#L1437)

**知识与验证**

- 机制说明跟随源码更新。
  [knowledge.js:375](../../js/assistant/knowledge.js#L375)

- 覆盖可读可删但无法写入的存储故障。
  [remediation-lifecycle.test.mjs:245](../../tests/gamelogic/remediation-lifecycle.test.mjs#L245)

- 真实键盘、浮层按钮与浏览器存储回归。
  [gameplay_remediation_ego.mjs:4](../../tests/e2e/gameplay_remediation_ego.mjs#L4)
