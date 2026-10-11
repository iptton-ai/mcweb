# gamelogic：游戏逻辑无头测试套件（纯 Node，零浏览器）

不启动浏览器、不渲染任何画面，**游戏逻辑模块原样运行**：红石/活塞/动力/物流/电梯/门/TNT/
物品实体/教学组/关卡工坊全部走真实源码，世界数据是真的（`state.blocks`），只有渲染层被垫掉。
用来做「跨模组交互」的快速回归——同样的链路在浏览器 E2E 里要跑几十秒，这里只要零点几秒。

## 运行

```bash
cd <仓库根>
node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs
# 单跑一个文件：
node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/redstone-smoke.test.mjs
```

⚠️ `--import ./tests/gamelogic/_preload.mjs` 不可省：模块加载钩子必须在任何游戏模块解析之前注册。
⚠️ 传给 `--test` 的是 glob/文件列表，不是目录（Node v22 会把目录当 ES 模块导入报错）。
全仓已有的纯 Node 测试照旧跑（`node --test tools/test_*.mjs`），与本套件互不影响。

## 分层原理（UI/数据分离）

| 层 | 处理方式 |
| --- | --- |
| 世界数据 | **真实**。`state.blocks` 直接手搓平地（freshWorld），红石/动力网络真求解 |
| 逻辑模块 | **真实**。redstone/piston/kinetic/door/tnt/items/eduKeypad/levelWorkshop/levelRun 原样 import |
| 渲染层 | **垫掉**（`hooks.mjs`）：`three`→逻辑桩（带真数值 position，物品/载客/引信的坐标运算可用）、`engine.js`/`textures.js`→整体桩、`chunk.js`→纯函数从真实源码提取（防漂移），网格函数 no-op |
| 浏览器平台 | **垫片**（复用 `tests/assistant-sim/browser-shims.mjs`）：内存版 localStorage/sessionStorage、万能假 DOM、location/navigator；另加 window keydown 收集器（教学组答题面板用 `dispatchKey` 驱动）、setInterval unref、fetch 磁盘直读（assets/edu/banks.json 真读得到） |

## 文件

- `_preload.mjs` —— `--import` 预载入口：装垫片、收集 window 事件、unref 定时器、fetch 磁盘直读、挂模块钩子
- `hooks.mjs` —— module.register 钩子：复用 assistant-sim 的 engine/textures/chunk 处理，`three` 换成本目录逻辑桩
- `stubs/three-logic.mjs` —— three 逻辑桩：Mesh/Group/Points/Vector3 等带真数值坐标与可用子树，渲染类轻量化
- `kit.mjs` —— 测试工具箱：
  - `freshWorld({seed, floorY=8, gameMode})`：手搓平地世界 + 玩家落位 + initRedstone/initKinetic 边沿基线
  - `pump(dt=0.05, frames)`：按 main.js 主循环顺序泵逻辑帧（TNT→红石(含活塞)→动力→物品）
  - `setB/at/fillBox/setBlockSafe/getBlock/state/dispatchKey`
- `redstone-smoke.test.mjs` —— 底座冒烟（拉杆→粉→灯 / 门边沿 / 按钮→活塞延迟伸出）
- `redstone-cross.test.mjs` —— 红石×活塞/门/TNT/灯/压力板/观察者/粘液块（跨模组 A 组）
- `redstone-torch-phase.test.mjs` —— 火把双级反相「竖行平不行」实证：亮火把只强充能正上方方块（原版规则），平铺双相链要垫一格红石粉
- `kinetic-cross.test.mjs` —— 动力×物流×电梯×物品×红石离合（跨模组 B 组）
- `edu-level-cross.test.mjs` —— 教学组×红石×关卡工坊/闯关（跨模组 C 组）

## 写新用例的规矩

- 每个 test 开头 `freshWorld()`；断言世界数据（方块 ID/实体坐标/进度），不 assert DOM 细节。
- 一切时间推进用 `pump(dt)`，禁止真实 sleep；不依赖 Math.random 的具体值。
- `updateRedstoneNetwork`/`updateKineticNetwork` 是全图扫描（256×256×128），别在循环里无谓反复触发。
- 发现游戏行为与设计不符：不修游戏，`t.skip('疑似游戏 bug：…')` 并在报告记录。
- 共享底座（`_preload/hooks/stubs/kit`）是基建，改它要照顾全部用例；用例文件互不依赖。
