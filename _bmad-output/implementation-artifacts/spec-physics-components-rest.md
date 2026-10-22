---
title: '补齐剩余物理组件'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_commit: '7de5025'
context: ['docs/physics-rest-plan.md']
---

<frozen-after-approval reason="用户已要求继续实现路线图全部剩余组件">

## Intent

补齐物理路线图E0–E6、W1–W3与A1–A3，让玩家在世界里搭建可观察、可复位的力学和水力装置，并组合已有红石、轴网与关卡。既有P1组件保留，按依赖逐小批实现并验证。

## Boundaries & Constraints

Always: 原生ES模块、字节世界、旧档兼容；旧静水/沙砾/TNT保持现有规则；配置版本化完整贯穿普通档、快照与局部关卡卡；水量/背包守恒、局部有界tick、键鼠与纯键盘共用交互。

Ask First: 公网发布。

Never: 无输入无限储能、复位兑换物资、逐帧全世界流体/刚体模拟、扩大世界字节宽度、绕过闯关锁具。

</frozen-after-approval>

## Code Map

- js/config.js：编号/物理常量/配方。
- js/physicsData.js、physicsLab.js、physicsModels.js、physicsUI.js：配置验证、计算/事务、模型、交互。
- js/world.js、kinetic.js、redstone.js、piston.js、items.js：索引/动力/供能/载客/风力。
- js/homeSurvival.js、saveGame.js、assistant/snapshot.js、levelWorkshop.js：保存与跨世界隔离。
- js/levelPrefabs.js、assistant/knowledge.js、docs/physics-components-guide.html：可玩模板与说明。

## Tasks & Acceptance

- [x] 冻结编号与模型，完成独立五面设计评审并处理意见。
- [x] 实现E/W/A全部组件与模板、物资/运动安全及配置保存。
- [x] 接键盘模态、物品图标、合成来源、帮助与知识库。
- [x] 运行冻结行为验收、既有回归、浏览器真实输入、资源与性能检查，修复发现。

Given 路线图与首批实现，when 玩家打开B物理实验并放置组件，then 剩余各类均能通过可理解交互完成真实实验或机械闭环。

Given 旧世界与临时关卡，when 保存/导出/重载/往返，then 旧内容保留、配置与水量正确、临时操作不污染原档。

## Spec Change Log

- 2026-10-22 G2：保持Uint8与旧静水/沙砾/TNT，限定可选physics v1，普通档/快照/局部卡共用白名单；KEEP原P1目录索引和真实载客安全。
- 2026-10-22 G3：修补默认配置、数量入口、平台解绑、实际测速时序与交点、风力方向和三维遮挡、湿槽替换返还、源缓存/空间边界、端口/电路联动与缓存清理。KEEP固定步、数量守恒、后接口与所有乘客扫掠，不扩大物理引擎范围，不放宽既有性能门。

## Verification

`node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs`；相关tools测试；浏览器冻结清单与20轮资源复验。验收结果单列docs/physics-rest-verification.md。


最终验证：357/357逻辑、85/85工具、13/13浏览器，20轮资源稳定；256槽+32活动装置p95 0.619ms（≤5ms），旧滑轮8/32RPM各三轮原门均通过。最后新增直接换风车及床双格遮挡回归。原生指针锁宿主限制独立记录。本地实现完成，未push/发布。完整证据见[验收记录](../../docs/physics-rest-verification.md)。

## Suggested Review Order

**玩法入口**

- B库十个模板串起全部新增装置
  [levelPrefabs.js:317](../../js/levelPrefabs.js#L317)

**模型与时序**

- 固定步与事务统一驱动实验
  [physicsLab.js:367](../../js/physicsLab.js#L367)

**数据边界**

- 先验配置、数量和实际平台足迹
  [physicsData.js:115](../../js/physicsData.js#L115)

**跨系统安全**

- 统一写入并通知风车与双格床
  [world.js:115](../../js/world.js#L115)

- 整组扫掠并去重载客
  [piston.js:280](../../js/piston.js#L280)

**交互与权限**

- 同面板配置、观察和作者授权
  [physicsUI.js:27](../../js/physicsUI.js#L27)

**持久与隔离**

- 区域快照与配置同刻捕获
  [levelWorkshop.js:292](../../js/levelWorkshop.js#L292)

**回归与证据**

- 覆盖替换与环境副作用回归
  [physics-motion.test.mjs:462](../../tests/gamelogic/physics-motion.test.mjs#L462)

- 真实输入、WebGL及存储恢复
  [physics_rest_ego.mjs:104](../../tests/e2e/physics_rest_ego.mjs#L104)

- 保留冻结门与失败历史
  [physics-rest-verification.md:55](../../docs/physics-rest-verification.md#L55)
