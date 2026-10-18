# 我有自己的家 实施与验收

2026-10-15。第一批 A01–A06 已完成，基线 `e4a5aaa`。本次未提交、推送或发布。

**已交付的玩法**

- 普通生存打开菜单、背包、题卡、说明、打字或离开窗口时，停止世界模拟；创造施工和关卡计时保留原规则。
- 工作台新增门和床的配方，补圆石烧回石头；材料缺额与真实来源可查，配方有明确“制作”按钮。
- 九格常用栏支持数字键、滚轮和自定义；物品已有优先，支持已有／安家／工具筛选。短窗口的配方与物品区域分别滚动。
- 小床完整支持双格四方向放置、白天设家、夜晚睡眠、安全起身、死亡回家和失效回退。床有实际矮碰撞体，拆床／破坏支撑／爆炸／AI 覆盖会清理完整床及无支撑附件。
- 新世界默认轻松生存，苦力怕伤人但不毁家；玩家主动 TNT 保持原行为。新手包提供木工具、食物、火把、原木和首床所需的 3 羊毛，首夜有至少 8 分钟有效游玩缓冲；机械实验包改为设置中自选领取。
- 新生成版本在出生区域附近有浅水池与安全出生点；旧生成版本保持原样。浅水实玩发现并修复了上岸问题，脚部仍浸水时保留浮力，低顶和高墙碰撞照常生效。
- 家、常用栏、首夜状态、难度、生成版本随存档和热重载保存；进入／退出编辑与闯关世界恢复对应普通世界数据。
- 游戏说明、AI 知识库和本地 AGENTS 指南已同步。AGENTS.md 被现有仓库规则忽略，不出现在普通 Git diff 中。

**验证结果**

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 改动前游戏逻辑基线 | 101／101 通过 | [基线日志](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/baseline-logic.log) |
| 最终全量游戏逻辑 | **129／129 通过，0 跳过**；新增 28 项覆盖安家及发现的问题 | [最终逻辑日志](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/final-logic.log) |
| 官方关卡、编辑器、关卡 IO／运行、题库、学习进度、知识库工具测试 | **136／136 通过，0 跳过** | [最终工具日志](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/final-tools.log) |
| 浏览器安家边界 | **25／25 通过**：床方向、拆除、睡眠、存档、快照、常用栏、爆炸来源 | [浏览器边界](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/browser-boundaries.json) |
| 浏览器暂停 | 墙钟等待约 28.7 秒，时间、位置、血量、饥饿、首夜剩余均不变 | [暂停记录](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/browser-pause.json) |
| 既有浏览器玩法回归 | 9 个模块场景、真实帧落地、真实键盘碰墙／攻击、6 个 IndexedDB 编辑器生命周期场景全部通过 | [既有流程回归](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/browser-existing-regression.json) |
| 官方关卡隔离 | 村口热身赛进入、禁写槽位、禁改家、保留关卡计时，退出精确恢复家与常用栏 | [官方关卡往返](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/browser-official-level.json) |
| 旧地形兼容 | 种子 1、42、2026 的旧版世界完整 8,388,608 字节与原 HEAD 的 SHA256 一致；新版各有 49 水格 | [地形对照](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/terrain-compatibility.json) |
| 实机窗口布局 | 1024×640 默认与展开常用栏均有完整物品行和关闭入口，说明不遮挡；1301×1169 展开后配方高 220px、网格高 377px | 下方截图 |
| 浏览器运行错误 | 实玩、重生、官方关卡往返记录均为 `[]` | 重生及官方关卡 JSON |
| 补丁格式 | `git diff --check` 通过 | 终检 |

**实际游玩过程**

环境为 Ego 浏览器，同一 TaskSpace 的独立 `127.0.0.1:8138` origin，与平时的存档隔离。实玩从界面创建第二槽的新生存世界，随机种子为 `1287621887`。

1. 使用真实背包界面把初始原木制作成木板与工作台，数字键选工作台、X 放置。
2. 在工作台旁使用真实界面制作橡木门与床，X 放床并再次交互设家。家床在 `(131,48,127)`，朝东。
3. 真实键盘移动、按住 Enter 用木斧砍下 4 块原木，回背包制作材料；用 X 放门和门框、搭临时施工垫块。没有调用 AI 造物或注入资源、方块、玩家位置。
4. 在背包把木板配置到第 9 常用格，配置保存后仍可用数字键选中。点击保存并刷新，家、材料、常用栏和轻松规则恢复正确。
5. 用方向键、W 和 Space 从家附近走到浅池。首次上岸失败后，采样证实浮力过早停止；修复后从同一个存档位置正常游上岸，血量为 20。[上岸记录](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/real-walk-to-water.json)
6. 真实按键沿地形返回门口，穿过自己放置的门，回到床边。导航辅助的窄航点曾超时，现场确认是控制路线撞到已搭的门框；随后通过真实按键调整路线，没有传送越过障碍。
7. **等到首夜缓冲自然结束后按 X 睡觉**，未修改时钟：睡前 `time=468.2122`、夜间、缓冲为 0；睡后 `time=780.0507`、白天，安全起身到 `(131.5,48.001,126.5)`；饥饿保持 19、生命保持 20。[自然首夜记录](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/real-night-sleep.json)
8. 单独用测试伤害触发死亡，再原生点击“重生”按钮，返回有效家床附近，背包保持；这个死亡条件属于测试注入，未计为自然游玩死亡。[重生记录](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/browser-respawn.json)

实际测试建造了床、工作台、门框和施工垫块，没有声称完成封闭整栋房屋。床按本批设计不要求屋顶；封闭墙外怪物不阻睡、屋内／可落台接近的怪物阻睡另有真实逻辑回归。

**发现的问题与处理**

三路独立审查的九个问题全部修复并有专项回归：[审查销项表](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/review-triage.md)。此外，实际游玩修复了配方误触区域、家指引与调试框重叠、短窗口物品区不可见、浅水上岸，以及致命伤害导致空心条超长的问题。后者已同时通过 Node 和浏览器复验，致命伤害显示十颗空心。[死亡 HUD 记录](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/death-hud-browser.json)

**截图**

床的模型、选取和家方向：

![小床与家方向](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/bed-clear.png)

修复后的 1024×640 背包：

![短窗口背包](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/inventory-compact-fixed.png)

大窗口展开常用栏配置：

![大窗口背包](/Users/zxnap/code/MyWorks/yltech.edu/game/docs/home-m1-evidence/2026-10-15/inventory-large-fixed.png)

**复验入口与范围**

```sh
node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs
node --test tools/test_builtin_levels.mjs tools/test_level_editor.mjs tools/test_question_bank.mjs tools/test_level_run.mjs tools/test_level_workshop.mjs tools/test_edu_progress.mjs tools/test_assistant_knowledge.mjs
```

浏览器辅助脚本：[home_m1_ego.mjs](/Users/zxnap/code/MyWorks/yltech.edu/game/tests/e2e/home_m1_ego.mjs)。`runBoundaries` 会改动测试世界，只能对独立测试 origin 使用；`lookAt`／`walkToward` 用真实键盘，读取状态用于控制，不修改坐标或物资。

本次验证由代理执行，尚未进行三年级儿童用户测试；没有新增箱子、农业或多人，也没有发布线上。测试浏览器与服务器在交付时清理。
