---
title: 生存第二批 稳定生活
type: feature
created: 2026-10-18
status: done
baseline_commit: e4a5aaa
baseline_snapshot: /var/folders/58/mctmb5rs4m36zm0x9zdhfy480000gn/T/mcweb-m23-baseline-p547scsj
context:
  - '{project-root}/docs/survival-playability-plan-grade3-2026-10-15.md'
  - '{project-root}/docs/survival-m23-contract.md'
---

<frozen-after-approval reason="用户已明确要求继续完成第二、三批">

## Intent

**Problem:** 安家后仍无法储藏、持续生产食物与木材、拥有家畜或使用真正工作的熔炉。
**Approach:** 完成 A07–A10 和 A15，让孩子能经营箱子、农田、树林、羊圈与炉子，离开再回来仍保留成果。

## Boundaries & Constraints

**Always:** 保留第一批、旧建筑和库存；纯静态零依赖；所有可变数据归 state。工具数量和每把磨损在存取／丢捡／换槽时守恒。所有新增物资有明确可达来源，不依赖答题或 AI 造物。
**Ask First:** 发布线上或扩展到多人／新维度；本地实现、测试、修复已授权。
**Never:** 不覆盖既有未提交工作，不提交／推送；不靠强制答题维持生活。

## I/O & Edge-Case Matrix

| 场景 | 输入 | 结果 | 异常处理 |
| --- | --- | --- | --- |
| 箱子 | 混合资源、不同磨损同类工具 | 存取、存同类、取常用，数量磨损守恒 | 满箱只接可容纳部分，失败不扣源 |
| 持续熔炉 | 材料、有效燃料、空输出 | 收起后持续加工，离开仍工作 | 无料／无燃料／输出满明确提示；拆炉返还未耗内容 |
| 农林循环 | 水桶、锄头、种子、树苗 | 耕种、可见生长、收获、面包、补种与植树 | 成熟必返可续种种子；空间不足不覆盖建筑 |
| 羊圈 | 小麦、剪刀、围栏／门 | 引诱、喂养、认领、命名、剪毛再生，持久家畜 | 不远距回收，不在普通死亡时清除；数量有界 |
| 数据往返 | 箱／炉／植物／动物状态 | 普通档、文件、快照、切槽、临时世界回环 | 坏数据在应用前校验，旧档安全空默认 |
| 自由边界 | 生存 AI 与重复学习奖励 | 生存默认指导；免费造物需显式自由实验；重复答题不无限给高级矿物 | 切回生存取消待执行免费队列，拒绝有原因 |

</frozen-after-approval>

## Code Map

- `js/config.js`, `textureTiles.js`, `textures.js`, `chunk.js`：物品、配方、农田／作物／树苗／箱子／围栏模型。
- 新生活领域模块、`world.js`, `items.js`, `mining.js`, `kinetic.js`：元数据、守恒和销毁入口。
- `entities.js`, `interaction.js`, `playerLife.js`：动物互动与保存后恢复、死亡保留。
- `state.js`, `saveGame.js`, `assistant/snapshot.js`, `levelRun.js`, `levelEditor.js`, `main.js`：时钟、持久化与模式边界。
- 生活 UI、`ui.js`, `uiModal.js`, `uiKeys.js`, `input.js`, `settingsUI.js`, `index.html`：安全可键盘操作的入口。
- `assistant/tools.js`, `buildQueue.js`, `eduRewards.js`：生存经济边界。

## Tasks & Acceptance

- [x] 有界生活数据与工具磨损转移底座，接所有存档和换世界入口。
- [x] 箱子完整存取整理、容量反馈和所有销毁路径。
- [x] 水桶、锄头、小麦面包、树苗闭环和可靠首份／补充来源。
- [x] 羊圈、喂养认领命名、剪毛再生及持久家畜。
- [x] 真输入／燃料／输出熔炉，关闭即时兑换旁路。
- [x] 学习奖励收藏化和生存 AI／自由实验统一守卫。
- [x] 更新来源、帮助、知识库、AGENTS；真实模块边界与全量回归。
- [x] 浏览器真实制作／存取／耕种／喂羊／烧制及保存重进验证。

**Acceptance Criteria:**
- Given 新普通生存，when 正常收集制作，then 不切创造或刷题也可完成可再生补给。
- Given 生产设施和家畜，when 暂停、睡眠、死亡、切槽、重载或临时世界往返，then 时钟规则一致且成果不丢不复制。
- Given 标准生存，when AI 写世界或重复学习交易，then 不绕过资源成长；显式自由实验可保留原建造能力。

## Spec Change Log

## Design Notes

具体接口和号段由共同契约冻结；M2 先于 M3 实现。本批继续基于已验收但未提交的 M1，因此独立审查以 baseline_snapshot 对比，不把 M1 当成本批改动。

## Verification

`node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs`；原官方关卡／编辑器／题库／知识库工具回归；独立浏览器 origin 的白盒守恒与真实输入生活动线。

### 第二批实现验证（2026-10-18）

- 游戏逻辑：152/152（既有 129 + 新增 23）。
- 相关工具：128/128；全 tools/test_*.mjs 217/217 通过。
- 新增测试：[survival-m2.test.mjs](../../tests/gamelogic/survival-m2.test.mjs)。覆盖工具逐把磨损、满箱、刚拆即保存、炉中途回环、256 株同速、坏档拒绝、动物遮挡/死亡/远距/读档、玩家跳栏、羊与门、临时编辑回环、AI多入口、收藏奖励。
- 规则变更：原免费AI/实验包测试显式选择 experiment；旧“没有水桶”断言更新为真实取放水；缩略图原未知 ID 250 现为围栏门，未知色兜底改测空缺 ID 63。原用例没有删除。
- 炉面板仅列可用原料／燃料，操作按钮含物品名 aria-label；浏览器验收由父协调代理独立执行，保持未勾选。

### 独立审查修复复核（2026-10-18）

- 8 项发现逐项完成：创造拾取持久掉落守恒、家畜击退碰撞、植物支撑清理与一次退款、编辑器可删植物而不产资源、围栏上半射线、完整工具耐久导入校验、家畜与野生额度分离、取消部分施工后的网格/网络收敛。
- 取水／倒水同步切手中物品与原常用栏位置，避免空桶数量归零却仍选在手上。
- 额外修复 `chunk.isPropBlock` 未登记植物和围栏模型：有模型定义却不会在区块重建时出现。新增真实道具装配／删除测试，浏览器像素与自然成长验证由父代理执行。
- 新增 `tests/gamelogic/survival-m2-review.test.mjs` 13 项审查回归，全量游戏逻辑 **165/165**、工具 **217/217**、`git diff --check` 通过。日志 `docs/life-m23-evidence/2026-10-18/m2-final-logic.log` 与 `m2-final-tools.log`。
- 帮助入口新增「让家每天都有收获」及 `docs/life-survival-guide.html`，M1 帮助说明机械包需显式自由实验。知识库与 AGENTS 同步。

### 最终浏览器验收

32/32 白盒边界通过，运行时错误为空；真实UI完成制炉炼铁、箱子存取、水桶取放、五株小麦自然成熟/收获/补种、面包、羊命名剪毛再生、树苗自然长树及保存切槽恢复。完整记录见 [验证报告](../../docs/survival-m23-verification-2026-10-18.md)。

## Suggested Review Order

- 生活持久数据和导入边界
  [lifeData.js](../../js/lifeData.js#L1)
- 物资转移和有效时间生产
  [homestead.js](../../js/homestead.js#L1)
- 统一面板与操作反馈
  [lifeUI.js](../../js/lifeUI.js#L1)
- 生存资源与免费建造边界
  [survivalRules.js](../../js/survivalRules.js#L1)
- 独立审查修复回归
  [survival-m2-review.test.mjs](../../tests/gamelogic/survival-m2-review.test.mjs#L1)
