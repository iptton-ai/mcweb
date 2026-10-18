---
title: 生存第一批 我有自己的家
type: feature
created: 2026-10-15
status: done
baseline_commit: e4a5aaa
context:
  - '{project-root}/docs/survival-playability-plan-grade3-2026-10-15.md'
---

<frozen-after-approval reason="用户已要求完整实现已讨论的第一批并完成回归与实际游玩验证">

## Intent

**Problem:** 普通生存缺少床与家重生，门不可制作，阅读仍有危险，工具选择困难且自然水源不可达。

**Approach:** 完成第一批 A01–A06：安全暂停、基础获取链、常用栏、床与返家、新手缓冲和轻松生存、新世界浅水。让三年级孩子不靠创造或 AI 送物资完成安家。

## Boundaries & Constraints

**Always:** 保持纯静态 ES Modules、state 单例、Uint8 方块与现有关卡卡；旧档建筑和物资保留；存档、快照、切槽及临时世界恢复同步新增字段；知识库和帮助同步。

**Ask First:** 公网发布或改变本批范围；本地实现和验证已授权。

**Never:** 本批不做箱子、种田、养殖、附魔、多人；不清用户存档，不提交推送；不把基础生存必需品绑答题。

## I/O & Edge-Case Matrix

| 场景 | 输入 | 预期 | 失败处理 |
| --- | --- | --- | --- |
| 第一间家 | 新轻松生存，木材与赠羊毛 | 门与床可制作；白天用床设家、晚上睡到清晨 | 缺料明确展示数量及来源 |
| 床放置 | 四方向、双格 | 支撑／边界／占用／玩家碰撞合法才扣一床 | 失败不扣物资 |
| 睡醒／重生 | 床有效且附近安全 | 安全落点，清速度和摔落态，保留背包 | 床无效时安全回退出生点并解释 |
| 拆除／爆炸／覆盖 | 床任一半或支撑变化 | 不留半床、不重复掉物、失效家引用可恢复 | 带状态床不可被活塞／锯／投料器非法拆分 |
| 阅读暂停 | 普通生存菜单／背包／题卡／说明／失焦 | 世界危险、时间、消耗冻结，恢复无追赶伤害 | 创造施工录像、关卡计时仍沿既有规则 |
| 数据往返 | 老档、新档、切槽、快照、临时世界 | 家、常用栏、规则、缓冲和生成版本属于对应世界 | 缺／坏字段安全默认 |
| 自然水 | 新生成版本 | 可步行接近的浅池和安全出生；老档不重造 | 旧版本扩容仍用旧生成算法 |

</frozen-after-approval>

## Code Map

- `js/config.js`, `textureTiles.js`, `textures.js`, `chunk.js` — 床 234..241 与空闲贴图、配方、可视模型。
- `js/world.js`, `main.js`, `state.js`, `saveGame.js`, `assistant/snapshot.js` — 新世界规则、生命周期与持久化。
- `js/bed.js`（新）, `interaction.js`, `playerLife.js`, `piston.js`, `tnt.js`, `kinetic.js`, `buildQueue.js` — 床全生命周期、睡眠与爆炸来源。
- `js/ui.js`, `input.js`, `uiModal.js`, `settingsUI.js`, `itemInfo.js`, `index.html` — 常用栏、安全阅读、规则与家指引。
- `js/eduKeypad.js`, `eduMerchant.js`, `eduStarlight.js` — 阅读态登记与清理。

## Tasks & Acceptance

**Execution:**
- [x] `config/bed/chunk/textures/interaction` — 床完整制作、放置、交互、拆除，门配方和圆石烧石链。
- [x] `playerLife/world/main/state/saveGame/snapshot` — 家返生、安全出生、新浅池生成版本与数据往返。
- [x] `ui/input/itemInfo/index` — 九格可配置常用栏、已有优先／分类、缺料来源、家方向与渐进目标。
- [x] `uiModal/main/edu*` — 普通生存安全暂停统一门控，保持创造／关卡行为。
- [x] `settingsUI/main/ui/tnt/entities` — 新生存默认轻松，选项可切；首夜缓冲，新手羊毛；苦力怕不毁家与主动 TNT 分流。
- [x] `assistant/knowledge.js`, `AGENTS.md`, 帮助 — 同步机制与入口。
- [x] `tests/gamelogic/home-m1.test.mjs` 等 — 上表真实模块回归、生成旧版对照与存档边界。
- [x] 浏览器 — 真 UI 合成、键盘移动、放门／床、设家／过夜／回家、保存重入、截图与错误检查。

**Acceptance Criteria:**
- Given 新轻松生存，when 通过正常 UI 安家，then 无创造／AI 赠物可制作并使用门床，常用工具随手可选。
- Given 普通生存阅读／暂停，when 等待并恢复，then 饥饿、伤害和世界时间不增长；关卡和创造专用流程不被新增规则干扰。
- Given 已建之家，when 死亡、读档、切槽或临时世界返回，then 返回对应家园或有解释的安全回退，物品不丢不增。
- Given 新生存轻松规则，when 苦力怕爆炸，then 家园方块保留；主动 TNT 与官方关卡既有语义保持。
- Given 旧生成版本，when 读档或尺寸迁移，then 老地形与改动保真；新版本多种子都有可达浅水与安全起点。

## Spec Change Log

- 2026-10-15：实机走到浅池发现腰部探针过早切断浮力，玩家无法回到一格高岸。仅修 playerPhysics 浸水体积判定（包含脚部），保留正常离水重力和头顶/侧墙碰撞，不改池几何绕过问题。新增真实 keys 入水→上岸、30/60/120Hz、低顶/高墙/无无限空跳及现场种子坐标回放。

- 2026-10-15：独立审查后的验证完善，保留已实现安家闭环与 UI 动线。修复同层矮床/整块碰撞选面、红石灯 raw 写导致悬空床、床挂件失支撑仍供电；统一交互写入口和玩家返床/环境清理策略。分离自然出生避树与已有世界合法原木地板。引导补齐工作台拥有/放置/附近/材料阶段；itemSources.js 统一可采/制作/实验包/仅创造来源及材料问号文案。保守迁移旧空背包创造档的首赠资格，睡眠威胁补高台下落路径。追加 9 项真实模块缺陷回归（含双扫描顺序和 2–4 格高台 fixture），不修改冻结范围。

## Design Notes

用户已授权整批，按既定 A01–A06 实施。小型新字段附加现有存档，体积远低于 100KB；床朝向／双格编码仍在 ID。生成 v1 保持旧算法，v2 添加确定性浅池。新世界赠 3 羊毛闭合首床链，保留旧档所有赠品；新手首夜缓冲初值 8 分钟有效模拟时间。常用栏以物品 ID 储存，保留 selectedSlot 全目录索引以兼容现有交互。轻松规则适用于新世界，旧世界默认保持既有冒险爆炸规则，可在设置主动切换。

实现定型补记：床采用 234..241 与 91/92 图标贴图，customMesh 为矮床实体，碰撞高 9/16。`world.setBlockSafe` 清理旧床两半及失去支撑的床，主循环刷新关联区块；AI 队列拒绝直接写床 ID，防单格孤床。睡觉通过有限站格可达搜索阻止真正能到床边的敌人，墙外封闭敌人不阻睡；跳到清晨同时播放短遮罩，不补饥饿。新世界安全出生搜索避开树冠（seed 2026 回归发现并修复）。

实现验证已完成：新增安家逻辑 14/14、全逻辑 115/115、相关工具 136/136、知识库 10/10；后续放置提示/威胁搜索/物理守卫收尾后针对安家+物理 23/23。父代理负责浏览器实玩、最终独立评审及复验；本段不把浏览器验收预先标完成。

## Verification

- `node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs`
- `node --test tools/test_assistant_knowledge.mjs`
- `node tools/test_builtin_levels.mjs` 及关卡／编辑器／题库／进度相关工具测试。
- 独立 origin 的 Ego 浏览器：白盒边界验证与真实输入安家动线分别留证；不得把注入状态当成完整实玩。

## Suggested Review Order

**主循环与安全暂停**

- 普通生存统一停止模拟，保留渲染与专用模式。
  [main.js:57](../../js/main.js#L57)

**床的完整生命周期**

- 四向放置、拆除、睡眠与安全回退。
  [bed.js:21](../../js/bed.js#L21)

**家与旧档兼容**

- 新字段安全迁移，家和常用栏随世界恢复。
  [homeSurvival.js:34](../../js/homeSurvival.js#L34)

**地形版本**

- 只为新版世界增加浅水，旧生成保持不变。
  [world.js:192](../../js/world.js#L192)

**半格碰撞和上岸**

- 脚部浮力与扫掠碰撞保持可玩。
  [playerPhysics.js:25](../../js/playerPhysics.js#L25)

**常用栏与来源**

- 常用选择与制作入口可发现。
  [ui.js:73](../../js/ui.js#L73)

**真实回归**

- 覆盖审查和实玩发现的缺陷。
  [home-m1-review.test.mjs:35](../../tests/gamelogic/home-m1-review.test.mjs#L35)

验收报告：../../docs/home-m1-verification-2026-10-15.md。最终逻辑129/129、工具136/136，浏览器安家25/25，真实自然过夜与水源往返验证完成。
