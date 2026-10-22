# 剩余物理组件浏览器验收

2026-10-22；Ego Lite，唯一 TaskSpace 137 / p1，`http://127.0.0.1:18439/`，1280 × 900。

常驻脚本：`tests/e2e/physics_rest_ego.mjs`。正式刷新后 13 / 13 组通过，完整记录在 `browser-input.json`。注入仅建立场地、配置测试物资、站位、公共模块导入与观测；合成、放置、面板操作、手动启动、桶取放、模板选择及盖章、拉杆和关卡出口均走真实浏览器输入。没有读取新求解器或数据模块实现来编写断言。

| 组 | 实测 |
| --- | --- |
| BR01 | 生存背包实际合成斜坡台，材料扣清，X 放出 ID 75 |
| BR02 | X 开台，真实选择 15° / 光滑，启动后距离 0.13853；复位距离及时间归零 |
| BR03 | 方向键焦点留在面板，E / Q 关闭，Shift + X 绕过交互并放置石块 |
| BR04 | 手动压缩弹簧后释放，高度 0.41890，真实主循环驱动 |
| BR05 | B 库十个新增模板可见，实际选中摩擦对照模板、Enter 盖章，X 结束放置 |
| BR06 | 其余九个模板以盖章接口建立后显示，24 个模型、26 个物理格 |
| BR07 | 连续 X 满桶注入四份，再用空桶取回；水槽 0 → 4 → 0，库存完整回到满桶 1 / 空桶 2 |
| BR08 | 真实水闸按钮改变水路；机械泵 8 RPM，输出一份水；轻浮块高度 0.274 |
| BR09 | 三格宽平台边缘载人；低顶阻碍时 offset 0，拆阻碍后玩家 x 70.5 → 71.5；实际拉杆切换后回到 offset 0 |
| BR10 | 从游戏说明目录打开新物理实验帮助页 |
| BR11 | 实际试玩当前关卡；未授权台的控制禁用，授权台可启动，水桶写入被拒，走到终点并真实退出 |
| BR12 | 17 种新模型，3 轮预热后 20 轮建模 → 保存读取 → 清场资源稳定 |
| BR13 | 13 个实际模型姿态的 Three.Box3 全部位于单格内，含风扇和风车完整旋转 |

BR02 启动后额外记录：`ui=playing`、`paused=false`、`active=BODY`、`document.hasFocus()=true`、`windowUnfocused=false`，运行到 0.05 秒时距离 0.002697。没有用注入 tick 代替这次真实运行。

## 资源与边界

`browser-resources-20-cycles.json` 保存全部 23 个样本，正式计量的第 1 至第 20 轮完全一致：

| 计数 | 第 1 轮 | 第 20 轮 |
| --- | ---: | ---: |
| WebGL geometries | 67 | 67 |
| WebGL textures | 3 | 3 |
| WebGL programs | 18 | 18 |
| 场景材质实例 | 13 | 13 |
| scene children | 11 | 11 |
| props / drops | 0 / 0 | 0 / 0 |
| physics cells / runtime / windLevels | 0 / 0 / 0 | 0 / 0 / 0 |

`browser-model-bounds.json` 使用实际场景 prop 及真实 Three.Box3，`precise=true`。四种坡度、三种支点左右载荷极值、四绳滑轮均通过。风扇 934 帧 / 8005 ms，风车 981 帧 / 8002 ms，均为 8 RPM，覆盖完整旋转；二者最高 y 为 0.995105，其余轴范围 0.03 至 0.97。

## 截图目检

已亲眼查看以下正式截图，模型齐全，面板可读，没有越框遮挡：

- `browser-ramp-panel.png`：坡度、表面参数与启动 / 复位按钮。
- `browser-ramp-running.png`：已收起面板的实际运行坡台。
- `browser-physics-overview.png`：模板总览。
- `browser-water-float-panel.png`：泵输出槽与浮块实时读数。
- `browser-wide-platform-rider.png`：第三人称真实玩家站在移动宽平台。

帮助页另有 390 × 844 手机顶部、水泵、滑轮截图与 1280 × 1000 桌面截图，均已目检。真实滑轮选择与高度调整后，四绳、提升 0.5 显示拉力 2.45、拉绳 2.00、功 4.90；页面无横向溢出。

## 初跑记录与恢复

初跑保留在 `browser-input-first-run.json`（11 / 13），以及 `browser-model-bounds-first-run.json`。BR12 当时把 23 轮集中到一次页面执行，超过宿主 14 秒限制；现按每轮一个 evaluate 执行。初跑 BR02 的单次启动等待超时未能可靠归因，失败截图显示正常游戏画面；正式刷新、补充公开暂停与焦点记录后通过，没有加入强制 tick 或点击后的焦点绕过。

每次测试均备份并原样恢复 slot5、`mcweb.save.index`、原有现场快照与最佳成绩存储。正式收尾验证 `memoryRestored / slot5Restored / indexRestored` 均为 true。没有清空浏览器 profile，没有保留测试世界，没有关闭或 finish 根任务的空间。

重跑脚本已参数化：调用者按 ego-browser skill 新建本目标唯一空间，传 `E2E_SPACE=<ID> E2E_BASE=http://127.0.0.1:<端口>`；复用其 p1，结束恢复现场后由调用者统一 finish。已结束的137不再复用。
