# 可测性体检与无头测试体系建设（2026-09-23）

> 目标：摸清项目可测性现状；为核心模拟模组（红石/活塞/动力/物流/电梯/门/TNT/物品/教学组/关卡）
> 建立**不跑浏览器 UI** 的自动化测试，UI 与数据分离，让回归验证从分钟级降到秒级。
> 本文是方案 + 交付记录，配套基建在 `tests/gamelogic/`（用法见其 README）。

## 1. 可测性体检结论（建设前）

### 1.1 已有资产

| 层 | 资产 | 特点 |
| --- | --- | --- |
| 纯 Node 单测 | `tools/test_*.mjs` 13 个（node:test，零依赖） | 只覆盖**数据契约类**模块：题库/关卡卡 schema/知识库/Jev 路由/证据回路/缩略图纯函数；对游戏模拟逻辑零覆盖 |
| 浏览器 E2E | `tests/e2e/*.py` 30+（CDP 注入式） | 覆盖全但要起 Chrome + server.py，分钟级、脆弱（指针锁/前台标签页），适合冒烟不适合高频回归 |
| 助手模拟 | `tests/assistant-sim/` | 已验证「渲染层垫掉 + 游戏逻辑真跑」的可行性（module.register 钩子 + 浏览器垫片），但面向助手对话，不是断言型测试 |
| 切片装载惯例 | AUTHOR-PURE/PURE/DRAFT-PURE 源码标记 | 单函数级纯逻辑切片，粒度太细、覆盖不了模块间交互 |

### 1.2 覆盖缺口（建设前，按模组）

- **完全没有 Node 层测试**：redstone / piston / kinetic(动力+物流) / door / tnt / items / entities /
  eduKeypad 运行时 / eduStarlight / eduMerchant（全仓零测试）/ levelEditor 本体
- 这些模组两两交互的链路（拉杆→活塞伸出、答对→红石供能→开门、传送带→物品运输、滑轮→载客、
  离合器→动力启停、闯关→锁题判题→TNT 保护……）全部只能靠浏览器 E2E 验证——回归成本高，
  所以改动这些模组时最缺安全网。

### 1.3 阻塞无头化的四个技术点（已全部解决）

1. 逻辑模块的 import 链拖进 three/engine/textures/chunk（渲染）→ module.register 钩子垫掉
2. audio/bgm/recording/ui/playerLife 顶层 localStorage/window 副作用 → 浏览器垫片（内存版）
3. 教学组顶层 window.addEventListener + setInterval（挂住进程）→ keydown 收集器 + unref
4. three 万能桩把坐标算成 NaN（物品/载客/引信断言不了）→ 带真数值 position 的逻辑桩

## 2. 方案：tests/gamelogic 无头逻辑测试套件

架构与用法见 `tests/gamelogic/README.md`。要点：

- **UI/数据分离的实现方式是「垫渲染、跑真逻辑」**：世界数据（state.blocks）、红石/动力网络求解、
  机器 tick、答题判分、关卡嵌入全部走真实源码；只有网格重建/贴图/相机被替换为保留语义的桩。
  这比「抽接口重构游戏源码」侵入小得多——游戏源码零改动。
- 测试入口统一：`node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/`
- 时间推进全部是显式 `pump(dt)`（等价 main.js 每帧调用序），无真实 sleep，结果确定性可复现。

## 3. 团队分工（本轮执行记录）

| 角色 | 职责 | 产出 |
| --- | --- | --- |
| 侦察×2 | 测试资产盘点 / 模块依赖与跨模组交互面梳理 | §1 结论 + 各模组导出面/调用链 file:line 报告 |
| 基建工程师 | 预载器、加载钩子、three 逻辑桩、世界夹具工具箱、冒烟验证 | tests/gamelogic/{_preload,hooks,kit,stubs,README}+redstone-smoke |
| 施工组 A | 红石×执行器跨模组测试 | redstone-cross.test.mjs（门/TNT/灯/活塞/压力板/观察者/粘液块/孤儿修复） |
| 施工组 B | 动力×物流×电梯×物品跨模组测试 | kinetic-cross.test.mjs（水车/应力/离合/传送带/粉碎/锯/投料器/滑轮载客） |
| 施工组 C | 教学×红石×关卡跨模组测试 | edu-level-cross.test.mjs（答题机供能开门/星辉门/商人/奖励/建卡嵌入/闯关全链/TNT 保护） |
| 项目经理（汇总） | 方案裁决、底座验收、全量跑测、本文档 | docs/testability-plan.md + AGENTS.md 登记 |

施工纪律：共享底座只读（避免并行冲突）；只新增各自测试文件；疑似游戏 bug 不修、skip 并记录。

## 4. 交付结果（2026-09-23 验收）

**全量跑测**（`node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs`）：
**38/38 全绿，墙钟 3.7 秒**；既有 219 个纯 Node 测试回归零影响（0.67 秒）；本批次零游戏源码改动。

| 交付 | 用例 | 覆盖 |
| --- | --- | --- |
| redstone-smoke.test.mjs | 3 ✅ 0.6s | 底座冒烟：拉杆→粉→灯 / 门边沿 / 按钮→活塞 0.15s 延迟伸出 |
| redstone-cross.test.mjs（A 组） | 13 ✅ 3.9s | 信号衰减·断路·连锁脱落 / 火把反相器·时钟振荡 / 火把塔竖直传信号（强充能方块翻转上级火把；**差异锚点：被充能方块不直接喂粉，与原版不同**）/ 压力板载人 / 观察者脉冲 / TNT 引爆与活塞孤儿修复（双分支）/ 粘液块拖拽 / 12 格推动上限双向 / 压碎返还 / 活塞载客 |
| kinetic-cross.test.mjs（B 组） | 12 ✅ 2.3s | 水车 8 RPM·应力 64 满载与过载停转 / 齿轮对顶卡死 / 离合器电平通断 / 传送带 1.5 格/s 运物（数值坐标断言）·断电停复电续 / 粉碎轮四级链 / 机械锯 / 投料器节拍与守卫 / 滑轮卷绳放绳悬停 / 平台载客 / 活塞推平台脱绑重绑 |
| edu-level-cross.test.mjs（C 组） | 10 ✅ 2.3s | 答题机答对→常供能开门全链+答错错题本 / 答题机→邻接灯 / 英语商人对错 / 奖励四档梯队+里程碑 / 星辉门超纲供能 / 真实世界建卡→校验→嵌入逐格对账 / reachabilityBFS 通断 / 闯关全链（卡内题→真键盘作答→门开→3 星→最佳成绩→退出恢复）/ 闯关 TNT 保护对照 / 题库×出题 |

**疑似游戏 bug（未修，待裁决）**：
- `js/levelRun.js:577-585` exitLevelRun 对 loadGame 用 try/catch 吞掉一切异常后走 generateWorld
  兜底——若 loadGame 在恢复中途（blocks 已赋值、尾部 updateHotbar 等）抛错，恢复悄悄失效，
  半恢复的世界被整片自然地形覆盖。无头环境实测可踩中（textures 桩补齐前）。建议只对
  loadGame 干净返回 false 才 generateWorld，异常路径保留现场并报错。

**设计澄清（非 bug）**：seedAuthoredLock 只进作者 Map（供出题面板/建卡 provider），普通世界
答题机抽题走「题库哈希/卡内题」不经它；拉杆断电=滑轮受控放绳下行，「悬停」是无动力语义。

**仍需浏览器 E2E 的清单**（有真实 UI/WebGL/音频语义，无头不覆盖）：挖掘蓄力与裂纹渲染、
指针锁/键盘模式、背包与合成面板交互、拍摄录像、官方关卡全链烟雾（smoke_builtin_levels）、
物品拾取入包的 HUD 表现。gamelogic 套件负责数据层回归，两层互补。

**性能备注**：耗时大头是 updateRedstoneNetwork/updateKineticNetwork 的 8.4M 格全图扫描
（每用例触发 10~25 次）——根治方案（按写入口维护元件索引，AGENTS.md P01 债务）落地后本套件可趋近瞬时。

## 5. 后续路线

- 红绿条接入日常：改 redstone/piston/kinetic/edu/level 任一模组后，先跑 gamelogic 套件（秒级），
  提交前再跑对应浏览器 smoke（分钟级）做 UI 层抽验。
- entities.js（生物）目前只有 TNT 波及/载客间接覆盖，后续补刷怪/追击/掉落的独立无头用例。
- interaction.js（玩家挖掘/放置入口）与 input.js 属于「薄 UI 壳」，继续留给浏览器 E2E。
