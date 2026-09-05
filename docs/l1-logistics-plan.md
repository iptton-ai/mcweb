# Create-lite 批次 L1（物流+控制）技术方案 — 传送带 / 离合器 / 投料器

> **用途**：跨会话交接。G1 设计门产出物：批次 L1 三组件（传送带·平带版 / 离合器 / 投料器·部署器-lite）
> 的技术方案，结构沿用 docs/create-lite-plan.md（阶段二）模板，流程契约见
> docs/create-lite-org-plan.md（§0.2 五条准绳、§2.2 文档模板、§2.3 G1 DoD）。
> 开工前先读 `AGENTS.md`，再读本文档。
>
> **批次定义（协调代理已裁决冻结，不得增删组件）**：
> - 传送带（平带版）：物品实体转运层
> - 离合器：红石控制动力通断
> - 投料器（部署器-lite）：物品实体→方块的自动放置
>
> 批次叙事：**水车→粉碎→带→投料器再投料 + 拉杆一键启停 = 无人值守产线闭环**。
>
> **行号时点**：文中行号/符号基于 2026-09-05 HEAD + B1 批次（G0 修复门）之后的工作区，
> 落地时必有漂移，定位一律以符号名（函数/常量）搜索为准。动工前**先核对 config.js 里
> 202..217 段不与实际占用冲突**（本文 §2 已核对：当前最大已用 ID = 201 钻石剑）。

---

## 0. 背景与玩法场景

### 0.1 为什么做这一批

阶段二（docs/create-lite-plan.md）交付了「水车→轴/齿轮→粉碎轮/机械锯」的加工闭环，
但闭环有两处必须由人肉维持的断点：

1. **投料是人肉**——粉碎轮四级链（石→圆石→沙砾→沙）每级都要玩家右键把方块放回投料口；
2. **产出是人肉**——机器弹出的物品实体散落在机器脚下，要玩家跑过去磁吸拾取；
3. **启停是人肉**——想让产线停转只能拆水车或断轴，没有「开关」。

L1 三组件各补一个断点：**传送带**搬产出（物流层）、**投料器**把物品实体变回方块塞进机器
（回流层）、**离合器**给动力网一个红石开关（控制层）。三者拼起来即本批交付的完整体验：
**无人值守产线**。

### 0.2 三段玩家场景（G1 DoD 第 1 项）

**场景一（离合器·一键启停）**：玩家在湖边架好水车粉碎产线，白天想让它转、夜里下矿前想
让它停（省得噪音引怪？本作无噪音，但「关机」是直觉）。在传动轴中段串一枚离合器，旁边
立一根拉杆——拉杆一扳，红石充能离合器、传动在此断开，粉碎轮与锯停转；水车侧照转不误
（动力源被隔离，不是被憋停）。再扳回来，产线原速恢复。进阶玩法：红石火把时钟驱动
离合器 = 脉冲式产线（转 0.1s 停 0.1s），配合观察者可做节拍器。

**场景二（传送带·产出搬运）**：粉碎轮吐出的沙砾散在轮子脚下，玩家要蹲守拾取。现在从
机器脚下铺一条传送带延伸到工作台旁：产出物落到带上即被带走，沿箭头方向 1.5 格/秒匀速
平移，玩家站在带尽头等着收货即可（带尽头掉落恢复普通物理，天然「卸货点」）；也可以把
带铺到自己家门口，路上走过去顺手捡。断电（离合器断开/水车干涸）带上的物品停在原地，
恢复供电继续走——物品不会丢。

**场景三（投料器·四级粉碎全自动）**：四级粉碎链最磨人的是每级手动投料。在粉碎轮旁
一格放投料器、朝向轮上方投料口，再把传送带尽头架在投料器正上方——玩家丢一块圆石上带，
带把它送到投料器顶上落下，投料器通电后每 0.5 秒检查一次头顶：发现有方块类物品就把它
变回方块塞进朝向的投料口，粉碎轮碾碎，产出再落带、再回流——**石→圆石→沙砾→沙 ≥2 轮
粉碎无人值守**，拉杆一扳整线启停。这就是本批的收官画面。

```
水车 ─→ 传动轴 ─[离合器 ←拉杆]─→ 传动轴 ─→ 粉碎轮（成对）
                                                │ 投料口产出 = 物品实体
                                                ▼ 落到带上
      传送带 ──→ 带尽头架在投料器正上方 ──→ 物品落下
                                              ▼
                          投料器（通电 0.5s/次）把物品变回方块
                          塞进朝向格 = 粉碎轮投料口 ──→ 再粉碎（闭环）
```

### 0.3 与既有系统的组合性（准绳 2 自证）

| 组件 | 与动力组合 | 与红石/活塞组合 |
|---|---|---|
| 离合器 | 动力网通断（本批核心） | 红石负载边沿驱动（照门/TNT/活塞先例）；活塞推动离合器=位移后状态自愈 |
| 传送带 | 带格计入动力分量（SU 负载 4/格） | 活塞推带=压碎返还（贴面道具先例）；带把物品送给玩家拾取=与生存系统组合 |
| 投料器 | 动力负载（SU 16）+ 机器计时（照粉碎轮/锯骨架） | 投料放置触发观察者脉冲/红石拓扑刷新（照 finishSaw 先例）；投 TNT 可做红石陷阱自动化 |

---

## 1. 现状速览（引擎关键事实）

| 事实 | 位置 | 对本方案的意义 |
|---|---|---|
| **容器红线**：任何「方块内存物品清单」的方案直接违反准绳 1（存档零改动） | js/saveGame.js（blocks RLE + 玩家标量，无容器字段） | **物流必须走「物品实体 + 世界方块」路线，这是本批最重要的架构约束**：带运的是 `state.itemDrops` 实体（不存档），投料器把实体「变成」世界方块（存档天然支持）。Create 的漏斗/箱子容器整族不予考虑 |
| 方块 ID 上限 255；当前最大已用 201（钻石剑 TOOL_EXTRA_BASE+11），202..217 空闲 | js/config.js | 新动力族方块从 **202** 起：BELT 202..205（4）、DEPLOYER 206..211（6）、CLUTCH 212..217（6），188..189 与 218..255 仍留空 |
| `isKineticId(id)` 是热路径：动力求解器全图扫描（128×128×64 ≈ 1M 格）逐格调用 | js/config.js `isKineticId`、js/kinetic.js `updateKineticNetwork` | 需从单区间 `148..169` 改为多区间 `148..169 ∪ 202..217`——**热路径上一行改动**（两次范围比较，无函数调用），全图扫描成本不变 |
| 图集 16×16=256 格，已用 0..72（生存进度组止于钻石剑 tile 72） | js/textures.js `atlasSize` / `tileMap` | 新 tile 从 **73** 起，预估 73..78（带×2、投料器×2、离合器×2），在 G1 框架预估 73..82 预算内 |
| 水是静态方块（无流动模拟） | js/world.js | 带上方洒水/投料器投水只是普通方块放置，无流体交互要处理 |
| 「红石不控制动力网络」是阶段二既定决策（无 redstone links） | docs/create-lite-plan.md §10 | **离合器是第一个受控例外**：控制的是「传动连通性」这一个新方块，而不是给动力网加红石全局钩子——例外范围见 §5 差异决策记录首条 |
| 物品实体（js/items.js）：spawnItemDrop opts（vx/vz/pickupDelay）、4 格磁吸、1.5 格拾取、120s 寿命、`updateItemDrops(dt)` 简单重力（落地即停） | js/items.js | carried 模式挂在 `updateItemDrops` 内、判定用「脚部格 = floor(y-0.15)」与现有落地公式同源；物品实体不进存档（`clearItemDrops`）——带载物品处置见 §6 |
| 全量网络重算骨架：扫描→建图（`neighborsOf`）→连通分量→应力/转向→回写运行时 Map | js/kinetic.js `updateKineticNetwork`（119 轴实测 2.8ms） | 三组件全部作为动力族新 ID 进同一求解器：带=新邻接规则+负载、投料器=照锯的背面传动+负载、离合器=同轴邻接的可断门 |
| 派生态回写方块变体先例：红石粉亮灭（`dustLit` 回写） | js/redstone.js `updateRedstoneNetwork` | 离合器 engaged 态照此回写：红石重算时把接合/断开编码进 ID 变体 |
| 负载邻接激活判定：`isCellActive`（闭包，查 6 邻激活粉/源） | js/redstone.js `updateRedstoneNetwork` 内 | 离合器复用该判定；需新增导出（见 §3.2，对既有模块 redstone.js 的唯一接口新增） |
| 边沿检测先例：`pistonPoweredPrev` / `doorPoweredPrev` / `tntPoweredPrev` | js/redstone.js | 离合器加 `clutchPoweredPrev`，同款模式 |
| 模块间双向运行时循环 import 先例：redstone ↔ piston（互相只在函数运行时调用） | js/redstone.js / js/piston.js 互引 | redstone → kinetic 的新增反向引用同款安全（kinetic 现已 import redstone；两方均无模块顶层调用） |
| 贴面道具网格先例：红石粉（邻格现算形状，不入缓存）、压力板（薄板，按变体入 `propMeshCache`） | js/chunk.js `getPropMesh` / `buildPlateMesh` | 带网格照压力板模式（按 dir 变体缓存薄板）；离合器/投料器照动力组 root→orient→spinner 约定（离合器转、投料器不转） |
| 活塞推方块分类：`pushKind` PUSH_EMPTY/POP/MOVE/FIXED | js/piston.js | 带（贴面薄板）归 **PUSH_POP**（压碎返还，照红石粉）；离合器/投料器是 solid 动力块，走默认 **PUSH_MOVE**（位移后网络重算自愈） |
| 主循环挂点已齐：`updateRedstoneTick` → `updateKineticTick` → `updateItemDrops`，读档 `initRedstone` → `initKinetic` | js/main.js `gameLoop` / 读档路径 | **main.js 与 state.js、saveGame.js 零改动**——三组件逻辑全部装进既有 tick 与求解器 |
| 触发点已齐：放置/破坏（interaction.js）、活塞推拉后（piston.js）、助手施工完成（buildQueue.js）、TNT 爆炸后（tnt.js）、放水（interaction.js）均已调 `updateKineticNetwork` | 各文件 | 新动力族 ID 经 `isKineticId` 多区间判定后**自动接入全部既有触发点**，无需逐点补线 |

---

## 2. ID 编码与方块清单（config.js）

### 2.1 ID 段分配（已与 config.js 现状核对无冲突）

| 段 | 内容 | 备注 |
|---|---|---|
| 148..169 | 既有动力组（轴/齿轮/水车/粉碎轮/锯） | 不动 |
| 170..175 | 生存进度组方块 | 不动 |
| 180..187 | 生存物品 | 不动 |
| 190..201 | 木/石/钻三档工具（铁档沿用 100..103） | 不动；**201 是本方案核对时的最大已用 ID** |
| **202..205** | **BELT_BASE + dir(0..3)** | 传送带，水平四向 |
| **206..211** | **DEPLOYER_BASE + facing(0..5)** | 投料器，照机械锯朝向编码（复用 FACING_NORMALS） |
| **212..217** | **CLUTCH_BASE + axis(0..2)×2 + engaged(0/1)** | 离合器，照轴的 3 轴编码 + 充能断开态编码进 ID |
| 218..255 | 留空 | 后续批次 |

### 2.2 方块清单

| 方块 | 常量与编码 | 变体数 | 放置规则 | BlockInfo 要点 |
|---|---|---|---|---|
| 传送带 | `BELT_BASE=202 + dir`；dir 0..3 = 北/东/南/西（与门 facing 同序，配 `BELT_DIRS` 法线表） | 4 | **贴实心方块顶面**（照红石粉/压力板：`isSolid(below)` 校验）；dir = 玩家水平朝向量化四向（复用 door.js `facingFromYaw`） | solid **false**（薄板不参与碰撞，照压力板）、transparent、customMesh、kinetic、hardness 0.5 / axe、**drop: BELT_ITEM_ID**（活塞压碎返还代表变体，防变体 ID 进背包不叠堆） |
| 投料器 | `DEPLOYER_BASE=206 + facing(0..5)`（复用 FACING_NORMALS） | 6 | 朝向 = 所点击面外法线（照机械锯：贴着目标面放，面向「要投料的位置」） | solid、transparent、customMesh、kinetic、hardness 1.5 / pickaxe |
| 离合器 | `CLUTCH_BASE=212 + axis*2 + engaged`；engaged 1=接合（默认）/ 0=断开（红石充能） | 6 | 轴向 = 所点击面法线（照传动轴：点顶面=立轴）；初始 engaged = `!isCellActiveNow`（见 §3.2），放进已充能位直接落断开态 | solid、transparent、customMesh、kinetic、hardness 0.8 / axe |

编解码纯函数照既有模式成套新增（供 chunk/interaction/kinetic/redstone 共用）：
`beltId/isBeltId/beltDir`、`deployerId/isDeployerId/deployerFacing`、
`clutchId/isClutchId/clutchAxis/clutchEngaged`。

**`isKineticId` 多区间改动（热路径一行）**：

```js
// 改前：return id >= SHAFT_BASE && id < SAW_BASE + 6;            // 148..169
// 改后：return (id >= SHAFT_BASE && id < SAW_BASE + 6) ||
//             (id >= BELT_BASE && id < CLUTCH_BASE + CLUTCH_COUNT); // ∪ 202..217
```

`kineticAxisOf` 扩展：离合器 → 编码轴；投料器 → 朝向法线所在轴（照锯的映射）；
**传送带 → 返回 null（无轴）**——`neighborsOf` 对带走专属分支、不读 axis（见 §3.1）。
`kineticItemId` 扩展三映射（破坏返还 BELT/DEPLOYER/CLUTCH_ITEM_ID）。
物品代表变体：`BELT_ITEM_ID=BELT_BASE`（北向）、`DEPLOYER_ITEM_ID=DEPLOYER_BASE`（朝上）、
`CLUTCH_ITEM_ID=CLUTCH_BASE`（X 轴·接合），HotbarBlocks 插在 SAW_ITEM_ID 之后、WATER 之前。

### 2.3 数值常量（集中 config.js 便于调平）

| 常量 | 值 | 说明 |
|---|---|---|
| `BELT_SU_LOAD` | 4 | 每格带的应力负载（纯转运件，远低于粉碎轮 32） |
| `DEPLOYER_SU_LOAD` | 16 | 每台投料器负载（介于锯 24 与带 4 之间） |
| `CLUTCH_SU_LOAD` | 0 | 纯传动件不计负载（照轴） |
| `BELT_SPEED` | 1.5 | 带速（格/秒，恒定——见 §5 差异 2） |
| `DEPLOYER_SEC` | 0.5 | 投料器动作冷却（秒/次） |
| `BELT_RIDE_Y` | 0.15 | carried 物品骑行高度（带格底起算，与 items.js 落地公式的 0.15 同源） |

---

## 3. 求解器与状态机

三组件**不新建模块**（新模块数 0 ≤ 1/组件，G1 DoD 第 3 项满足），全部扩进
js/kinetic.js（求解与机器计时）、js/items.js（carried）、js/redstone.js（离合器边沿）。

### 3.1 动力网络求解器扩展（js/kinetic.js `updateKineticNetwork` / `neighborsOf`）

收集阶段零改动（`isKineticId` 多区间后自动入 `cells`）。邻接规则增量：

| 当前格 | 邻接规则 | 备注 |
|---|---|---|
| 传送带 | **专属分支（`neighborsOf` 开头 `if (isBeltId(c.id))`，不读 c.axis）**：① 四邻水平格是带 → 相连（mesh=false，同分量传导）；② **下方格或四邻水平格**是动力方块（轴/齿轮/离合器·接合/粉碎轮/水车/投料器背面…按对方自身规则） → 接入该分量（mesh=false） | 带↔带传导 = Create「整条带单点驱动」的离散版（§5 差异 9）；带↔动力只从带这一侧枚举（BFS 单侧发现即成边，转向传播与连通性均成立——与粉碎轮配对边只从轮侧枚举同构） |
| 离合器 | 同轴相邻照轴传动，**但 engaged=0（断开）时：自身不外延任何传动边，且作为 `other` 时不可被跨过**（`neighborsOf` 里对 other 是离合器且断开 → 不 yield；当前格是离合器且断开 → 直接 return） | BFS 遇断开离合器 = 该格仍是分量成员（可被应力统计/HUD 查询）但动力传不过去——水车侧照转、下游静止 |
| 投料器 | **照机械锯**：正面（朝向邻格）是被投目标不传动，只有「本格正好在它背面」才接通 | cells 收集时给锯/投料器统一打 front-blocked 标志，现有 saw 特判分支扩为 `saw || deployer` 双适用 |

应力统计增量（`updateKineticNetwork` 第 2 步的负载链）：
`load +=` 每格带 4（**分量内全部带格计**，无论 individually 供电还是传导归属）+ 每台投料器 16 +
离合器 0。转向传播零改动（带/离合器/投料器均不啮合翻转；带不改变网络方向语义）。

派生态照旧写 `kineticMap`（key=格，含带/离合器/投料器格）——**新增导出
`isBeltRunningAt(x,y,z)`**（查 kineticMap + components[compId].running，供 items.js
carried 判定；这是对既有模块 kinetic.js 的功能扩展导出，与 §3.2 的 redstone.js 唯一
接口新增并列记入 §4 清单）。

机器清单增量：`deployerCells`（照 sawCells）+ `deployerCool: Map<key, t>`（冷却，照
crushProgress 模式；网络重算兜底清理不在清单的 key、`initKinetic` 清空——照 G0-05 修法）。

### 3.2 离合器：红石触发链与时序（js/redstone.js + js/kinetic.js）

**Create 语义：红石信号 = 断开**（engaged = !powered）。

`isCellActive` 是 `updateRedstoneNetwork` 内闭包（捕获当轮 `strength`/`activeSourceKeys`），
不能字面导出。**对既有模块 redstone.js 的唯一接口新增**设计为它的快照版：

```js
// redstone.js：updateRedstoneNetwork 末尾保存快照，导出查询函数
let lastStrength = null, lastActiveSourceKeys = null;   // 每轮重算刷新
export function isCellActiveNow(x, y, z) {
    // 用最近一次重算的快照做 6 邻激活判定；无快照（未重算过）返回 false
    // O(6) 纯查表，供 kinetic.js 放置离合器时定初始 engaged 态
}
```

（闭包本体与快照版共用同一段 6 邻判定代码，避免两份逻辑漂移。）

**触发链时序（边沿触发，防时钟×动力重算风暴——攻击场景见 §6.2）**：

```
拉杆右键 toggleLeverAt / 粉末亮灭 / 活塞位移 / …任何红石事件
  └→ updateRedstoneNetwork()
       ① 主扫描循环加分支：else if (isClutchId(id)) clutches.push(…)
       ② 照活塞边沿模式：powered = isCellActive(离合器格)
          clutchPoweredPrev 做边沿（新放置的离合器 prev 缺省 false → 放进充能位立即翻转）
       ③ 目标 engaged (= !powered) ≠ 当前 ID 编码 →
            setBlockSafe(clutchId(axis, engaged)) + refreshPropAt   ← 照 dustLit 回写先例
            kineticDirty = true
       ④ 门/TNT/活塞边沿检测照旧运行（互不影响）
       ⑤ 末尾：kineticDirty === true → updateKineticNetwork()      ← 仅边沿触发一次
```

- redstone.js 新增 `import { updateKineticNetwork } from './kinetic.js'`：与既有
  redstone ↔ piston 双向引用同构，**均为运行时函数调用、无模块顶层执行**，循环安全
  （kinetic.js 现已 import redstone 的 `popUnsupportedRedstone`/`updateRedstoneNetwork`）。
- **反向自愈**：活塞把离合器推到别处 → `doExtend`/`doRetract` 末尾既有的
  `updateRedstoneNetwork()` + `updateKineticNetwork()` 双调 → 离合器在新位置按当前信号
  重判 engaged（推入充能区自动断开、推出自动接合），无残留。
- **递归有界**：`finishSaw` 里「锯完 → updateRedstoneNetwork → 离合器翻转 → 再
  updateKineticNetwork」最多弹跳一层（动力求解不再改红石状态），终止。
- 放置路径：`placeKinetic` 离合器分支以 `engaged = !isCellActiveNow(格)` 直落正确变体，
  随后照链 ⑤ 调 `updateRedstoneNetwork()`（建边沿基线，快照可能因新 solid 方块挡粉路而
  过期——重算即自愈）+ `updateKineticNetwork()`。

### 3.3 传送带：carried 状态机（js/items.js `updateItemDrops`）

物品实体每帧**最先**做携带判定（优先于磁吸/重力/寿命之外的一切）：

```
普通物理（重力 / 磁吸 / 拾取 / 寿命）—— 完全照旧
  │ 每帧先查：feet = floor(y - 0.15)（与落地探针同源），feet 格 isBeltId 且 isBeltRunningAt(feet)
  ▼ 命中
carried 模式：
  · 豁免重力与磁吸（寿命照走；1.5 格拾取保留——带通向玩家 = 免费的自动收集线）
  · 沿 BELT_DIRS[dir] 以 BELT_SPEED·dt 平移；横向坐标与高度向「格中心 x/z + BELT_RIDE_Y」
    收敛（lerp，防斜着飘出带缘；物品从上方落入带格时高度向下收敛到骑行面）
  │ feet 跨出当前带格（进入下一格）
  ▼ 新 feet 格也是 running 带？──是──→ 继续 carried（接力）
                  └──否──→ 恢复普通物理（保留向前的残余 vx，自然弹出/落地）
  带尽头是实心墙：抵墙停留不越过（寿命照扣，120s 防无限堆积）；撤墙后继续
```

- 带 solid=false（照压力板）：物品落入带格后继续下坠到带下方支撑面，落地高度
  `支撑面+1.15` 使 feet 恰落回带格 → carried 接管；带架空时物品穿越带格的瞬间即被
  carried 捕获（高度收敛拉回骑行面）。**无需改 items.js 落地公式的支撑判定**（零侵入）。
- 断电（分量 running=false）：`isBeltRunningAt` 返回 false → 判定不命中 → 普通物理，
  物品原地落地停住（feet 仍在带格、贴骑行面），恢复供电即再被带走。
- 中键吸取/丢弃与带无交互（丢弃物 pickupDelay 期间照走 carried，冷却完可拾回）。

### 3.4 投料器：放置状态机（js/kinetic.js `updateDeployers`，照 `updateSaws` 骨架）

```
每台投料器（deployerCells）：
  分量 running？──否──→ 冷却冻结，不动
  ▼ 是
  deployerCool 递减；到 0 时扫描「捕获格」内的物品实体（state.itemDrops）：
    捕获格 = { 朝向格 T, 朝向格正上方 T+up, 投料器头顶 D+up } 三格
    （feet 格落在任一捕获格的物品；见下方设计说明）
  找第一个满足全部条件的实体：
    · 是「可放置方块物品」：BlockInfo[id] 存在 && !item && !isToolId && !customMesh
      （即普通方块域：石/圆石/沙砾/沙/木板/原木/玻璃/TNT/水/羊毛…；
        材料/食物/工具/贴面道具一律忽略——§5 差异 11）
    · T 为 AIR 或 WATER（目标被占/是带格 → 本次跳过不消耗，冷却重照走）
    · T 不与玩家/怪物 AABB 重叠（照 placeBlock 的重叠检查语义）
  ▼ 命中
    实体 count > 1 → count-1 保留实体；否则移除实体（消耗）
    setBlockSafe(T, itemId) + 重建所在区块 + 照 finishSaw 先例调
    updateRedstoneNetwork()（T 可能挡粉路/是新挂靠位）+ updateKineticNetwork()（幂等）
    冷却重置 DEPLOYER_SEC
```

**捕获格设计说明（对 G1 框架句的细节修正，G2 需重点裁决）**：框架句为「朝向格正上方
一格内的物品实体」，但物品实体**不会静止悬停在朝向格上方**（该格下方是空气/朝向格本体，
无支撑面）——静止物只可能出现在：投料器头顶（落在机器顶上，`投料器上方落下` 的规范
摆位）、或朝向格内（粉碎轮产出弹起后回落进投料口——**「再粉碎」闭环正依赖它**）。故
捕获格取三格并集：T（产出回流/玩家手丢）、T+up（框架句字面格，带从目标口上方经过的
中转物品）、D+up（带尽头架在投料器上方的落料）。T 必须为空才放置，天然防止「放进
T 的方块没被机器消化时反复误投」。

**用法示例（收官摆位）**：粉碎轮 (cx,cy,cz)，投料口 = (cx,cy+1,cz)；投料器放
(cx-1,cy+1,cz)（与投料口同层相邻）朝东 → T=投料口；带尽头架在投料器上方
(cx-1,cy+2,cz)（支撑=投料器本体，solid 成立）→ 圆石落投料器头顶 → 变方块进投料口 →
碾碎 → 产出回落投料口格（T 命中）→ 再投 → 四级链滚动到沙（沙不在 KINETIC_RECIPES，
方块留在投料口，线自然停在末端——「≥2 轮无人值守」达成且有限幅）。

---

## 4. 接入点逐文件清单

| 文件 | 改动 | 性质 |
|---|---|---|
| js/config.js | §2 全部：常量/编解码/BlockInfo 变体批量注册（照动力组段）/HotbarBlocks +3/数值常量/**isKineticId 多区间（热路径一行）**/kineticAxisOf·kineticItemId 扩展 | 主干 A |
| js/redstone.js | ① **唯一接口新增：export `isCellActiveNow`（§3.2 快照版）**；② 主扫描加离合器分支 + `clutchPoweredPrev` 边沿 + engaged 变体回写 + 末尾条件调 `updateKineticNetwork`；③ 新增 `import { updateKineticNetwork } from './kinetic.js'`（redstone↔kinetic 双向运行时循环，照 redstone↔piston 先例） | 主干 B（链 1） |
| js/kinetic.js | `neighborsOf` 带专属分支/离合器门控/锯+投料器 front-blocked 统一；负载链 +带+投料器；`placeKinetic` 三新分支（带：贴面校验+dir=facingFromYaw；离合器：axis=面法线轴+初始 engaged；投料器：facing=面法线）；`updateKineticTick` 末尾挂 `updateDeployers`；`kineticStatusAt` 三组件文案；`deployerCells/deployerCool` 与兜底清理；**新导出 `isBeltRunningAt`**；`initKinetic` 清投料冷却 | 主干 B（链 1/2/3） |
| js/items.js | `updateItemDrops` 头部插 carried 判定与移动分支（§3.3）；import `isBeltRunningAt`/`isBeltId`/`BELT_SPEED`/`BELT_DIRS` | 主干 B（链 2） |
| js/chunk.js | `buildKineticMesh` 三分支：带（薄板按 dir 旋转，**不挂 userData.kinetic**、照压力板入缓存）、投料器（方箱+正面喷嘴，照 orientCellBox 摆朝向，不转）、离合器（root→orient→spinner 照约定，断开变体=变色+红点指示，userData.kinetic=true 参与旋转动画）；新编解码 import | 主干 C |
| js/interaction.js | 零新分支（isKineticId 多区间后放置/破坏/中键吸取自动路由到 placeKinetic/breakKineticAt/kineticItemId）；仅需确认粉碎轮投料口校验对带/投料器/离合器格的既有序（放不进投料口=现有 `crusherIntakeError` 提示，行为合理） | 主干 C（核验级） |
| js/piston.js | `pushKind` 加 `isBeltId(bt) → PUSH_POP`（一行）；离合器/投料器走默认 PUSH_MOVE；位移后的双网络重算既有调用已覆盖离合器自愈 | 主干 C（链 2） |
| js/textures.js | tile 73..78（带顶面箭头/带沿、投料器正面/侧面、离合器接合面/断开指示）+ drawFunctions + blockUVs 注册 3 条 | 支线 D |
| js/audio.js | 可选：带运转嗡鸣（循环太吵则不做）、投料器「咔哒」放置声 | 支线 D |
| js/itemInfo.js | SPECIAL_HINTS 三组件行为文案（「贴顶面放置·需通电」「红石充能=断开传动」「把头顶物品放进朝向格」） | 支线 D |
| js/ui.js | 生存开局机械组套装追加：传送带×16、离合器×2、投料器×1（数量可调） | 主干 C |
| js/main.js / js/state.js / js/saveGame.js | **零改动**（挂点与触发点全部既有，见 §1 末两行） | — |
| AGENTS.md + js/assistant/docs.js | 目录结构与操作方式增补（docs.js 调色板经 BlockInfo 自动同步无需手改） | 支线 F |

---

## 5. 与 Create·原版的差异决策记录（逐条附理由，G2 评审重点）

| # | 差异 | 决策 | 理由（一行） |
|---|---|---|---|
| 1 | 红石不控制动力网（阶段二既定） vs 离合器 | **离合器 = 第一个受控例外，且是唯一例外** | 控制点收敛在一个新方块上（engaged 编码进 ID、边沿触发重算），不给动力网加任何全局红石钩子——例外的爆炸半径 = 一类方块的邻接规则 |
| 2 | 带速随 RPM 变化（Create 皮带受转速影响） | **恒定 1.5 格/s** | 本作全网恒 8 RPM（多水车不加速，阶段二既定），RPM 无变化维度，按转速调带速是伪自由度 |
| 3 | 平带无斜坡/无垂直段 | **v1 只做水平平带** | 斜坡带需物品 Y 向运动与坡面支撑判定扩展，收益低；水平闭环（§0.2 场景三）已成立 |
| 4 | 带面 UV 滚动动画 | **不做** | propMesh 材质模块级共享，逐带滚动需拆材质实例；物品移动本身即方向反馈 |
| 5 | 投料器只做「放置」动词 | **不做收取/右键交互/过滤模式**（vs Create 部署器/漏斗全家桶） | 放置是闭环最小动词；「收取」需要容器语义 = 方块内存物品清单，直接违反准绳 1 |
| 6 | 物品实体物流 vs 容器 | **物品实体 + 世界方块路线**（§1 容器红线） | 容器 = 存档结构改动，准绳 1 直接驳回，无权衡余地 |
| 7 | 离合器断开 = 充能 | **与 Create 同向**（红石信号=断开） | 对齐 Create 直觉，且与门/TNT/活塞的「充能即动作」心智一致（动作=切断传动） |
| 8 | 带被活塞推 | **压碎返还物品（PUSH_POP）**（vs Create 带不可推/整条拆除） | 贴面道具压碎管线已存在（红石粉先例）零新代码；Create 的带是实体不可推，本作无实体方块管线 |
| 9 | 带沿自身传导动力归属 | **带↔带相邻 = 同分量传导**（框架句只定义了带↔动力邻接） | Create 皮带本就是整条单点驱动的传动件；若逐格贴轴，拐角布线苛刻且玩法受损——传导是框架的细节补全而非违背（G2 需确认） |
| 10 | 投料器捕获格 | **{T, T+up, D+up} 三格并集**（框架句只写 T+up） | 物品实体不会静止悬停在 T+up（无支撑面）；产出回流在 T、带送落料在 D+up——少一格闭环断链，多一格无副作用（T 空才放置天然限幅） |
| 11 | 投料器可投物域 | **仅普通方块**（排除 customMesh 贴面道具/门/工具/材料，框架句为「BlockInfo 有 solid 定义」） | 直放贴面道具会产出无支撑红石/半扇门/悬空火把等非法状态；粉碎链所需方块全在普通方块域；水可投（投水造水车选址是彩蛋玩法） |
| 12 | 带失去支撑 | **不自动脱落，悬空保留可照常工作**（vs 红石元件拆支撑连锁脱落） | Create 带本为独立实体可悬空；自动脱落需新建连锁管线（popUnsupportedRedstone 是红石专用），收益低——挂债务表，触发条件：G2 裁 P2 则补 |
| 13 | 带上物品与玩家 | **磁吸豁免、1.5 格拾取保留** | 带通向玩家 = 免费的自动收集玩法；豁免磁吸防物品半路飞离带 |
| 14 | 投料器放置不做玩家挤压位移 | **目标格被玩家/怪占据 = 跳过本次**（不消耗） | 活塞式推挤语义（整体位移 1 格）对 0.5s 节拍的机器过度设计；跳过即安全 |

---

## 6. 存档与性能

### 6.1 存档（准绳 1：零改动不变式）

- **存档格式零改动**：三组件状态全部编码进方块 ID 变体（带 dir / 投料器 facing /
  离合器 axis×engaged——engaged 照 dustLit 回写先例），RLE 对任意字节透明；转速/应力/
  分量归属/投料冷却全是派生态走运行时 Map，读档 `initRedstone` → `initKinetic` 重算
  （main.js 既有顺序恰好先红石后动力：离合器 engaged 基线先于动力求解建立）。
- **带上物品的处置（选择：读档后消失）**：物品实体（state.itemDrops）本就不进存档、
  读档 `clearItemDrops`——带上物品随全体物品实体一起消失。备选「落在原位地面」需要
  在存档里记录实体位置 = 新存档字段，违反准绳 1；「消失」与既有机器产出物品的处置
  完全一致（阶段二已接受），玩家损失上限 = 当时在带上的散料。
- 旧档无新 ID：202..217 在旧存档里恒为空气/不存在，RLE 往返字节不变（G3 S/R5 层复测）。

### 6.2 性能预算（基线已实测，阈值 = 基线 × 1.2）

**基线定义与实测（2026-09-05，G1 冻结时跑）**：场景 = 100 传动轴动力网（水车供电全转）+
红石火把时钟电路振荡中。**方法学（重要）**：rAF 端到端帧率在 CDP 自动化环境受
窗口遮挡节流不可靠（G0 验收第三轮实证，60s 墙钟仅得 163 帧的废数据），基线与 G3
性能验收**统一采用确定性手动泵指标**——`updateRedstoneTick+updatePistonTick+
updateKineticTick+updateItemDrops` 四函数按 dt=1/60 手动驱动 1200 帧的每帧耗时分布，
外加红石/动力全量重算的单次耗时。真帧率（fps）仅作人工观察参考，不作门指标。

| 基线指标 | 实测值 | 本批阈值（×1.2） |
|---|---|---|
| 四 tick 每帧耗时 mean（含时钟触发的重算摊薄） | **0.45 ms** | ≤ 0.54 ms |
| 四 tick 每帧耗时 p95 | **3.1 ms** | ≤ 3.72 ms |
| 四 tick 每帧耗时 max | 4.5 ms | 参考（不设门，尖峰看 p99） |
| 红石全量重算单次 mean（50 次采样） | **3.0 ms**（max 3.7） | ≤ 3.6 ms |
| 动力全量重算单次 mean（50 次采样） | **2.1 ms**（max 2.3） | ≤ 2.5 ms |

三个攻击场景：

| # | 场景 | 成本模型 | 缓解（进 v1） | 残余风险 |
|---|---|---|---|---|
| P-1 | **时钟 × 离合器重算风暴**：红石火把时钟（org-log 实测 ~9.5 翻转/s）驱动离合器，每次翻转若都触发动力全量重算 = 9.5 次/秒 × ~2.1ms ≈ 2% 帧预算/时钟；K 个时钟线性叠加 | O(K × 全图扫描) | **边沿触发**（§3.2 链 ⑤：仅 engaged 实际翻转才 updateKineticNetwork；拉杆稳态、粉亮灭但离合器两侧电平不变时零动力重算） | K 大时帧内尖峰（重算发生在红石 tick 帧内）；G3 P 层实测超阈值 → 按债务表立项增量重算 |
| P-2 | **百带百物 carried 每帧更新**：100+ 带格 + 100+ carried 实体，每实体每帧 = 1 次 getBlock + 1 次 Map 查询 + 算术 | O(N) 极轻（对比：同量级实体已有重力+磁吸+网格摆位） | 判定即出即走，无网格重建（物品 mesh 只改 position） | 无 |
| P-3 | **投料器扫描开销**：D 台投料器 × 全体物品实体 N × 3 捕获格 × 2Hz | 10 台 × 200 物品 × 2Hz ≈ 1.2 万次格比对/秒，可忽略 | 冷却节流（DEPLOYER_SEC）天然限频 | 无 |

另注意（不属攻击场景、写明防呆）：带/离合器/投料器均为 propMesh，drawcall 随数量线性涨
——百级带时与百级齿轮同量级，阶段二已评估「超了再 InstancedMesh」后置优化不进 v1。

---

## 7. E2E 验证清单（纯行为描述，验收代理可独立执行；G2 冻结后只增不改）

### 功能（E）

| 用例ID | 前置 | 操作 | 期望行为 | 来源 | 结果 |
|---|---|---|---|---|---|
| L1-E01 | 水车+轴+离合器(接合)+轴+粉碎轮全网转 | 拉杆右键给离合器供能 | 离合器变断开态（外观变化），其下游轴与粉碎轮停转，水车侧照转 | 设计§3.2 | 待测 |
| L1-E02 | L1-E01 断开态 | 拉杆再右键断开信号 | 离合器恢复接合，下游全网恢复转动，粉碎轮可继续投料加工 | 设计§3.2 | 待测 |
| L1-E03 | 通电传送带（贴轴旁/轴顶）水平 ≥3 格 | 往带起点丢一个圆石 | 物品落带被带走，沿箭头方向匀速移动，不侧向掉带 | 设计§3.3 | 待测 |
| L1-E04 | 带上物品正在运送 | 断电（拉离合器/拆水车顶水） | 带上物品原地停住不消失；恢复供电后从原地继续走 | 设计§3.3 | 待测 |
| L1-E05 | 投料器通电、朝向格为空气、头顶丢 3 个圆石（同实体 count=3 或三实体） | 等待 ≤1s | 圆石变方块出现在朝向格，物品数量-1（或一个实体消失），0.5s 节拍可连续投 | 设计§3.4 | 待测 |
| L1-E06 | 投料器通电、朝向格为空气 | 头顶丢木棍、铁剑、苹果 | 均不放置、不消耗，物品留在原位 | 设计§3.4/差异 11 | 待测 |
| L1-E07 | §3.4 收官摆位（粉碎轮+投料器朝投料口+带尽头在投料器上方）全网通电 | 丢一块圆石上带，离开不操作 | 圆石→投料→碾碎→产出回流→再投料：石→圆石→沙砾→沙 ≥2 轮粉碎无人值守，最终沙方块停在投料口 | 设计§3.4 | 待测 |
| L1-E08 | 投料器通电、朝向格已有方块 | 头顶丢圆石 | 不放置、不消耗（等待目标格清空） | 设计§3.4 | 待测 |
| L1-E09 | 任意新组件在网 | 准星对准它 | HUD 状态条有对应文案（带：运转/静止；投料器：转速+应力；离合器：接合/断开·红石） | 设计§4 | 待测 |
| L1-E10 | 传送带一格与水车同分量 | 查看准星 HUD 应力 | 带计入应力负载（+4/格），加带到过载线 → 整网停转提示 ⛔过载 | 设计§3.1 | 待测 |

### 边界（N）

| 用例ID | 前置 | 操作 | 期望行为 | 来源 | 结果 |
|---|---|---|---|---|---|
| L1-N01 | 传送带已放置 | 活塞推带 | 带被压碎，生存模式返还一个「传送带」物品（与物品栏叠堆），无残 mesh | 设计§4/差异 8 | 待测 |
| L1-N02 | 投料器/离合器工作中（含投料冷却中/断开态） | 活塞各推 1 格 | 整体位移成功、无进度/状态残留错乱：位移后按新拓扑照常工作或正确停转（离合器推入充能区自动断开） | 设计§3.2/R2 | 待测 |
| L1-N03 | 世界边缘（x=0 / x=127 / y 顶） | 尝试放带/投料器/离合器 | 越界放置被拒（沿用 placeKinetic 边界校验）；带在边缘格照常运转，物品带端出界前恢复物理掉落 | R2 | 待测 |
| L1-N04 | 传送带已放置 | 尝试向带所在格放方块；拆带下方块 | 带格不可被覆盖（放置需空格）；拆支撑后**带悬空保留且可照常工作**（差异 12 行为锁定） | 设计§4/差异 12 | 待测 |
| L1-N05 | 带载物品 + 离合器任意态 | 保存 → 刷新 → 读档 | 带上物品消失（处置选择），方块 ID/朝向/离合器接合态逐一与存前一致，网络转速恢复 | 设计§6.1 | 待测 |
| L1-N06 | 带尽头悬空 / 带尽头贴墙 | 物品运送至尽头 | 悬空：物品恢复物理掉落落地；贴墙：物品抵墙停留不穿越（寿命照扣），撤墙后续走 | 设计§3.3 | 待测 |
| L1-N07 | 投料器通电、朝向格为空 | 头顶放木板类物品与贴面道具（红石粉/火把/门）各一 | 只投普通方块；贴面道具不被投（不产生无支撑红石/半扇门） | 设计§3.4/差异 11 | 待测 |
| L1-N08 | 红石火把时钟（~10Hz）驱动离合器，下游 50+ 轴 | 运行 30s 观察 | 每次翻转恰好一次网络状态切换（下游停/转与信号同步），无卡中间态、无重算风暴卡顿 | 设计§3.2/§6.2 P-1 | 待测 |

### 存档（S）

| 用例ID | 前置 | 操作 | 期望行为 | 来源 | 结果 |
|---|---|---|---|---|---|
| L1-S01 | 三组件混合布局全网运行 | 保存 → 读档 | 方块 ID（含 dir/facing/engaged 变体）往返一致；重算后转速/应力/接合态与存前一致；存档经 RLE 后结构不变（无新字段） | 设计§6.1/R5 | 待测 |
| L1-S02 | 带上多个物品运送中 | 保存 → 读档 | 物品消失（§6.1 处置），带恢复运转，无幽灵 mesh | 设计§6.1 | 待测 |
| L1-S03 | 含新 ID 的世界 | 六槽切换 + 导出 JSON → 导入 | 切槽回来世界一致；导入后新 ID 方块与状态一致 | R5 | 待测 |

### 性能（P）

| 用例ID | 前置 | 操作 | 期望行为 | 来源 | 结果 |
|---|---|---|---|---|---|
| L1-P01 | G1 基线场景：100 轴 + 时钟电路 | 手动泵 1200 帧 + 50 次重算采样（§6.2 方法学） | 基线已实测：tick mean 0.45ms / p95 3.1ms；红石重算 3.0ms；动力重算 2.1ms。G3 时在**同一批次代码**上复跑同场景，确认无回归漂移（≤ ×1.2） | org-plan §5.3 | **基线已填** |
| L1-P02 | 100 轴 + 时钟驱动离合器（P-1 场景） | 手动泵 1200 帧采样 + 计数动力重算次数 | tick mean ≤ 0.54ms、p95 ≤ 3.72ms；动力重算次数 ≈ 时钟翻转次数（边沿触发生效，无多余重算） | §6.2 P-1/R4 | 待测 |
| L1-P03 | 100+ 带格 + 100 carried 物品 | 手动泵 1200 帧采样 | tick mean ≤ 0.54ms、p95 ≤ 3.72ms，无尖峰 | §6.2 P-2/R4 | 待测 |
| L1-P04 | 10 投料器 + 200 物品实体 | 手动泵 1200 帧采样 | tick mean ≤ 0.54ms、p95 ≤ 3.72ms | §6.2 P-3/R4 | 待测 |

### 回归（R）

按 org-plan §5.1 清单全量执行（引用既有用例，不在此复制）：
红石（时钟/反相器/自动门/红石灯）、活塞（推拉/粘液拖拽/观察者/飞行器/推链 ≥2 格）、
动力（供水断电/啮合换向/平行隔离/过载/反向卡死/粉碎链/锯切与进度重置/活塞推动重算/
存档往返）、G0-01..07 用例。重点关注：离合器使 redstone.js 新增扫描分支——红石全量
回归必测（扫描循环改动波及所有元件）。

---

## 8. 提交切分（三条链 × A/B/C 内部结构 + 支线 D/E/F）

每链独立可 revert、完成即验（准绳 4）；链间串行（链 2 的 carried 依赖链 1 的
isKineticId 多区间与求解器扩展，链 3 依赖链 2 的物品回流语义）。

### 链 1：离合器（最小可验 = 拉杆断/通产线）

| Commit | 内容 | 完成即验（可执行断言） |
|---|---|---|
| A | config.js：CLUTCH 常量/编解码/BlockInfo/HotbarBlocks/**isKineticId 多区间** | `node --check js/config.js`；读一个含旧 ID 的槽位不报错（旧档冒烟）；控制台 `isKineticId(212)===true && isKineticId(202)===true && isKineticId(201)===false` |
| B | redstone.js 扫描/边沿/回写/isCellActiveNow + kinetic.js neighborsOf 门控与负载 0 | 摆「水车+轴+离合器+轴」通电：拉杆翻转离合器 → 下游轴停/转（F3 观察或看 mesh 旋转），HUD 文案随变体切换 |
| C | chunk.js 离合器网格（含断开指示变体）+ interaction 路由核验 + HUD 文案 | 手动 5 分钟单：放置（贴面轴向）/拆/拉杆通断/活塞推离合各一遍 → **E2E：L1-E01、E02、N02（离合器半）绿** |

### 链 2：传送带（最小可验 = A 点投 B 点出）

| Commit | 内容 | 完成即验 |
|---|---|---|
| A | config.js：BELT 常量/编解码/BlockInfo(drop=代表变体)/HotbarBlocks/BELT_DIRS | `node --check` + 旧档冒烟 |
| B | kinetic.js 带邻接分支 + SU 负载 + isBeltRunningAt 导出；items.js carried | 摆通电带 ≥3 格，控制台丢圆石上带 → 物品沿箭头走到尽头掉落；断电 → 停走，复电 → 续走 |
| C | chunk.js 带网格（dir 旋转薄板）+ interaction 放置（贴面校验/朝向）+ piston pushKind + ui.js 生存套装 | 手动单 + **E2E：L1-E03、E04、E10、N01、N03、N04、N06 绿** |

### 链 3：投料器 + 全批闭环（最小可验 = 物品→方块；收官 = 闭环 ≥2 轮）

| Commit | 内容 | 完成即验 |
|---|---|---|
| A | config.js：DEPLOYER 常量/编解码/BlockInfo/HotbarBlocks | `node --check` + 旧档冒烟 |
| B | kinetic.js updateDeployers（捕获三格/放置守卫/冷却/重算双调照 finishSaw） | 通电投料器朝空格，头顶丢圆石 → 圆石变方块、数量-1、0.5s 节拍；丢木棍无效 |
| C | chunk.js 投料器网格 + interaction 路由核验 + HUD 文案 + 收官摆位调平 | **E2E：L1-E05..E09、N07、N08 绿；全批闭环 L1-E07（≥2 轮无人值守）绿** |

### 支线（并行，org-plan §4.2/§4.3 白名单）

- **D**：贴图（textures.js tile 73..78 + assets/textures/ 覆盖可选）、audio.js 音效、itemInfo.js 文案。
- **E**：E2E 脚本（验收代理按 G2 冻结清单编写，作者 ≠ 核心编码代理）+ 随测修复。
- **F**：文档定稿（本 plan 勾项、AGENTS.md 目录结构与操作方式增补、org-log 批次 L1 节登记）。

---

## G1 DoD 自检清单（org-plan §2.3 七项逐一）

- [x] 每组件一段玩家场景描述（§0.2 三段 + 闭环叙事图）；
- [x] ID 段分配表与 config.js 现状核对无冲突（§2.1，以符号核对：最大已用 201 = TOOL_EXTRA_BASE+11 钻石剑，202..217 空闲）；
- [x] 逐文件接入清单齐全（§4）；新模块 ≤1/组件（**本批新模块数 = 0**，全部扩进 kinetic/items/redstone 既有模块）；
- [x] E2E 清单为纯行为描述、验收代理可独立执行（§7，全部以前置/操作/期望行为表述，无实现细节）；
- [x] 每条与 Create/原版的差异附理由（§5 十四条，含 G2 需重点裁决的 #9/#10/#11/#12 标注）；
- [x] 明示存档零改动不变式（§6.1）与性能预算（§6.2：基线定义 + ×1.2 阈值 + 三攻击场景及缓解，P01 待 G3 前实测填数）；
- [x] 决策日志登记本阶段全部裁决：docs/create-lite-org-log.md「批次 L1」节已登记候选池/打分/冻结/协调代理对四处细节完善的预裁决（2026-09-05）。

> **给 G2 评审代理的路标**：本计划相对 G1 冻结框架有四处「细节完善」需重点攻击——
> ① §3.4 捕获格三格修正（框架句「朝向格正上方」的几何缺口）；② §3.1 带↔带分量传导
> （框架句只定义带↔动力邻接）；③ §3.2 isCellActiveNow 快照导出与 redstone↔kinetic
> 双向引用；④ 差异 12 带不自动脱落（R2「拆支撑连锁」攻击面正中）。
