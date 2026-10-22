# 物理组件 P1 验收记录

> 2026-10-22 后续：本批留下的16台载人滑轮性能债务已在剩余物理组件批次关闭，原脚本/门不改、8/32RPM各三轮均通过，见 [后续验收](physics-rest-verification.md)。以下保留当时原始结论与证据。

验收时间：2026-10-18 至 2026-10-19（Asia/Shanghai）。独立 QA 按 `physics-p1-plan.md` 的行为契约编写测试，未按新求解器实现生成预期。世界、动力、红石、物品、存储逻辑均使用产品模块。

## 逻辑验收

| 范围 | 已执行结果 | 证据 |
|---|---:|---|
| 开工前既有 gamelogic | 190/190 通过 | `/tmp/mcweb-physics-baseline.log` |
| 既有回归 + 首轮新增 38 项 | 228/228 通过，9.60 秒 | `/tmp/mcweb-physics-p1-all-qa.log` |
| 新增 P1 独立验收，含羊的 0.35 半宽边缘承载 | 39/39 通过，5.33 秒 | `/tmp/mcweb-physics-p1-qa-final.log` |
| 最终全套（既有 190 项 + 新增 P1 51 项） | **241/241 通过，8.24 秒；零跳过** | [gamelogic-final.tap](physics-p1-evidence/gamelogic-final.tap) |
| 组件库/官方关卡/助手知识库相关回归 | **84/84 通过，0.71 秒；零跳过** | [related-final.tap](physics-p1-evidence/related-final.tap) |

最终 51 项包含同格替换机器/材料进度隔离：机械锯已工作 0.4 秒后，锯本身或目标原木经历 AIR→同 ID，新一轮 0.1 秒不得产出；经过新一轮完整耗时才产出 4 块木板。此二项已在最终全套通过。

终审补充均已通过：机械锯与粉碎轮完成一轮后的有界时间余量，在补料、停机一帧及复电后仍保留；24 个实体的高负载队列在 10/30/60/120 Hz 下真实进入候选索引分支，32 RPM 经 90° 拐角、抵满箱、部分接收、断复电与腾箱，逐帧不越队首、同直线队距不小于 0.34 格。每种帧率均验证 24×4 件投料加箱内原有 63 件，最终箱内恰 159 件、地上零余件。该回归先检出转角越位和队距收缩，修复后保留原断言通过。

新增逻辑覆盖：三轴放置及代表物品、63..74 全变体红石重算、1/2/3 级升降速与 2..32 RPM 边界、全部大小齿轮连接规则、换向器两端供能与双翻转、多源容量/旋向/速度冲突、带的相位隔离、16 RPM 真实粉碎负载与加工时间、16/4 RPM 机械锯真实耗时、手摇拆换不继承动力、12 变体活塞压碎退款、平台唯一绑定、低顶整步拒绝、共享乘客、正常下行、怪物/物品承载、长帧部分成功子步、32 RPM 实际带速与四帧率队列守恒、旧目录索引、普通档/快照/关卡卡/RLE 回环。

测试夹具修订：既有 `kinetic-cross.test.mjs` 用例 11 的平台初始 y=11、滑轮 y=14。上升后玩家脚 y=13，头顶 y=14.8，会进入滑轮；新承载安全契约应阻止这一步。独立复核后只把该用例的起始平台和玩家下移一格，继续断言平台与玩家各真实上升一格，未删除断言或放宽安全预期。

运行命令：

```sh
node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/physics-p1.test.mjs
node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs
node --test --import ./tests/gamelogic/_preload.mjs tools/test_level_editor.mjs tools/test_builtin_levels.mjs tools/test_assistant_knowledge.mjs
```

相关测试首次直接用 Node 运行时，组件库/关卡模块链触及浏览器 `three` 导入而未能加载；使用仓库既有预载渲染桩后 84 项通过，无依赖安装、无产品修改。此为执行环境修正，未绕过逻辑断言。

## 浏览器输入与制作验收

环境：Ego Lite，TaskSpace 161，独立游戏页 p2，`http://127.0.0.1:18437/`。最终轮重载了最新输入停止修复；页面动态导入不带 cache-buster，读取与运行游戏相同的模块实例。注入仅用于搭建世界、设置异常条件与读取结果；X/E/Escape/方向键/S/V/Shift、制作按钮及鼠标右键由浏览器输入 API 发送。

结果：**16 项通过，1 项浏览器平台限制**。原始结构化结果见 [browser-input.json](physics-p1-evidence/browser-input.json)，详细输出见 `/tmp/mcweb-physics-p1-browser.log`，重跑脚本见 `tests/e2e/physics_p1_ego.mjs`。

| 用例 | 结果 |
|---|---|
| X 按住供能、松开停机，保持期间不重复放方块 | 通过 |
| E 打开背包停止，关闭不自动续摇 | 通过 |
| 方向键移开准星停止，重新瞄准不自动续摇 | 通过 |
| 按 S 走出射程停止 | 通过 |
| V 切换视角停止 | 通过 |
| 死亡条件停止 | 通过 |
| 世界数组身份改变停止 | 通过 |
| 同一格拆掉再放回不继承操作 | 通过 |
| Shift+X 保留贴面放置语义 | 通过 |
| 闯关态拒绝获得手摇动力 | 通过 |
| 同一次页面调用内存档/读档，保留组件并清除手摇瞬态 | 通过 |
| 创造背包显示三个新组件 | 通过 |
| 生存制作 UI 实际制作三组件并精确消耗材料 | 通过 |
| 三组件分别经真实 X 操作在 X/Y/Z 面放置，共 9 种 | 通过 |
| 新开临时标签造成真实 blur，按住操作立即撤销 | 通过 |
| 原生指针锁后鼠标右键完整链路 | 平台限制，未宣称通过 |
| 显式模拟已锁定前提后的 trusted 右键 down/up → 产品输入处理 → 手摇供能/停止 | 通过，单独标注测试前提 |

指针锁诊断：真实 `mousedown` 的 `isTrusted=true`，页面 `hasFocus=true`、`visibilityState=visible`，用户激活有效；Ego 中 `canvas.requestPointerLock()` 仍拒绝：

```text
WrongDocumentError: The root document of this element is not valid for pointer lock.
```

这是宿主浏览器根文档限制。未修改产品规避，也未将测试锁态下的鼠标通过结果表述为原生指针锁通过。原生 Chrome 的锁定请求仍需实际环境补验。

清理：已恢复原本为空的测试存档槽 5 和索引当前槽，恢复 `document.pointerLockElement` 原属性，关闭仅本次 QA 创建的 p2 及 blur 临时页。未清空 localStorage、cookie、缓存或整个浏览器配置；共享空间与其他代理的页面保持。

## 模板、画面与资源检查

四个模板从 `levelPrefabs.js` 现成几何展开后放入真实世界，运行产品 tick 与红石输入；以下均已纳入最终 241 项：

| 模板 | 实际行为结果 |
|---|---|
| 手摇运输台 | 8 RPM；半秒运物 0.75 格，松手停止；重新手摇后 4 件木板全部进入末端箱子 |
| 快慢对照工厂 | 两侧 16/4 RPM；0.1 秒分别运物 0.3/0.075 格；快侧 0.3 秒前完成原木加工、慢侧仍在加工，最终合计产出 8 块木板 |
| 升降实验台 | 负载 40 SU；真实拉杆控制平台与玩家共同上升一格、再下降一格 |
| 合流纠偏台 | 初始卡死不加工；拉杆打开后恢复 8 RPM、容量 128 SU，真实产出 4 块木板；关闭后再次卡死且新原木保持 |

协调代理另在独立测试源 `http://127.0.0.1:18438/`，经真实B库选择与Enter盖章放置全部四模板；X按住手摇读到8RPM，快慢台两支路实读16/4RPM，合流台真实X拨杆后从转向冲突恢复8RPM/128SU。升降台经目检发现顶柱拉杆从起点被支柱遮挡，改挂机头底面后，站平台抬头X可上升至脚高11.001，再X下降回9.001。

画面以1280×800截图检查：手摇铜色手柄、大小齿轮尺寸差、换向器黄端标记与信号点可辨，HUD读数可读；说明页390px宽交互演示无横向溢出。截图：

- [手摇与HUD](physics-p1-evidence/02-hand-running.png)
- [B组件库](physics-p1-evidence/03-library.png)
- [快慢对照工厂](physics-p1-evidence/04-speed-factory.png)
- [合流换向器](physics-p1-evidence/06-reverser-merge.png)
- [可从平台操作的升降台](physics-p1-evidence/07-lift-accessible.png)
- [窄屏说明页](qa/physics-p1-help/02-mobile-running.png)

`tests/e2e/physics_p1_resources_ego.mjs`实际创建全部12变体、掉落物，渲染后存读再清世界。带电换向变体的对应信号源随场景保存，避免把读档后的合法电平重算误判为ID丢失。预热3轮后20轮完全一致：geometry=190、textures=2、scene children=11、props/drops/components/progress均0。共享模型缓存允许保留，未出现单调增长。[原始资源计数](physics-p1-evidence/resources-20-cycles.json)

真实浏览器另执行10台32RPM机械锯的600步持续生产，含真实供料/完成区块重建、粒子、掉落与渲染提交：800原木→3200木板、网络重算0；活动步mean3.894ms/p95 10.600ms，完成步mean10.541ms/p95 11.000ms。仅CPU与WebGL提交观察，不等同GPU帧耗或历史回归门通过。[浏览器性能原始证据](physics-p1-evidence/browser-performance.json)

最终边界：功能、兼容与20轮资源验收通过；Node轴/持续生产/带运输满足对应预算，16台持续携客滑轮的8/32RPM移动帧门仍未全过。原生指针锁受宿主限制，浏览器性能无实施前历史门，均未算通过。完整数字和方法学限制见 [physics-p1-performance.md](physics-p1-performance.md)；本批未发布。
