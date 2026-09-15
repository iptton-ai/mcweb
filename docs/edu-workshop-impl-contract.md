# 关卡工坊实施契约（P0–P3 批次内部接口）

> 2026-09-15 冻结。本文档是「关卡工坊」批次所有实施代理的**唯一接口事实源**：
> 导出名、签名、卡片 schema、ID 分配、DOM id 一律以此为准，禁止私自改名。
> 上游：docs/edu-level-workshop-plan.md（含 §8 G2 裁决修订）。

## 0. 文件归属矩阵（并行开发防冲突，唯一写者制）

| 代理 | 独占文件 |
|---|---|
| A1 | js/levelWorkshop.js（新） |
| A2 | js/levelRun.js（新） |
| A3 | js/eduStarlight.js（新）+ js/settingsUI.js + js/eduRewards.js |
| A4 | js/assistant/tools.js + js/assistant/docs.js |
| B1 | js/config.js + js/textures.js + js/chunk.js + index.html |
| B2 | js/interaction.js + js/mining.js + js/input.js + js/playerLife.js + js/saveGame.js + js/main.js + js/uiModal.js + js/tnt.js + js/entities.js + js/redstone.js + js/state.js |
| B3 | js/eduKeypad.js |
| B4 | js/ui.js + js/recording.js |
| B6（P1 后续） | js/levelPoster.js（新）+ js/ui.js 增量 |
| E2E | tests/e2e/run_workshop.py |

读别人的模块只许 import，不许改。契约未覆盖的细节按仓库既有惯例就近处理。

## 1. ID 与资源分配（config.js 由 B1 落地，全员照此引用）

```js
// 旗组（关卡锚点方块，非 solid、customMesh、即挖）
FLAG_BASE = 229, FLAG_COUNT = 3
flagId(kind) // kind: 0=起点 1=检查点 2=终点
isFlagId(id) / flagKind(id)
// 出题笔（物品，非方块非工具）
PEN_ID = 188          // ItemTypes 180..187 已用；BlockInfo[188]={item:true,...}；进 HotbarBlocks
// 星辉门（P2 锁具，2 变体）
STARLIGHT_BASE = 232, STARLIGHT_COUNT = 2
starlightId(state)    // 0=锁定(solid 可碰撞) 1=开启(非 solid 可通行)
isStarlightId(id) / starlightOpen(id)
```

- BlockInfo：旗组 `{solid:false, transparent:true, customMesh:true, hardness:0.05, drop:自身ID}`；星辉门锁定 `{solid:true, transparent:true, customMesh:true, hardness:1, drop:自身ID}` / 开启 `{solid:false, ...}`。
- outline（config.js 选取形状段）：旗子登记细杆 AABB（约 `[0.42,0,0.42,0.58,1.0,0.58]`，B1 按实际网格微调）；星辉门满格不用登记。
- 图集 tile 分配（textures.js，tile 85 起空闲）：85 `flag_start` / 86 `flag_checkpoint` / 87 `flag_goal` / 88 `starlight_locked` / 89 `starlight_open` / 90 `pen_item`。程序化起步，TILE_OVERRIDES 预留两项条目注释即可。
- chunk.js：`isPropBlock` 必须加入旗组与星辉门（否则读档后道具网格消失）；`getPropMesh` 加旗（杆+旗面，杆可复用木板 tile）与星辉门分支。
- interaction.js 的 `pickBlockItem`：旗三变体→自身、星辉门→锁定变体。
- redstone.js：星辉门**开启**变体并入现有 `id >= CLUTCH_BASE` 分支内 keypads 细分处（追加 `isStarlightId(id)&&starlightOpen(id)` 进 activeSources）——**禁止延长 else-if 链**（redstone.js:362 性能红线）。

## 2. 关卡卡 schema `mcweb.level.v1`（冻结，只增不改）

```js
{
  format: 'mcweb.level.v1',
  name: string, author: string,       // 本地填写昵称，不采集真实信息
  created: ISO string, version: 1,
  region: { x0,y0,z0,w,h,d, enc:'rle', blocks:<base64> },  // RLE=saveGame.js rleEncode 直出
  questions: [{                        // 锁=卡内局部坐标
    lockType: 'keypad'|'starlight',    // 缺省 keypad
    x,y,z,                              // 局部坐标（相对 region.x0/y0/z0）
    subject: 'math'|'science'|'daofa'|'yuwen'|'english',
    kind: 'input'|'choice',            // 题级 kind（题库契约的 bank 层 kind 在此下沉到题级）
    stem: string,                      // 题干（= 题库的 q 字段）
    options?: string[],                // choice 3~4 项
    answer: number,                    // input: 0..9999；choice: 正确索引 0..3
    hint?: string, unit?: string,
    meta: { source:'bank'|'custom' }
  }],
  rules: { timeLimit: number|null, lockAIHelp: boolean },  // lockAIHelp=false ⇒ 考核锁（P3 助手拒答提示）
  flags: { start:{x,y,z}, checkpoints:[{x,y,z}], goal:{x,y,z} },  // 局部坐标
  meta?: { draft?:true, generator?:'ai' }  // AI 草稿：导出校验双通过降为警告
}
```

- 尺寸上限 **96×64×96**；嵌入固定偏移 **EMBED_OFFSET = {x:80, y:4, z:80}**（80+96=176≤256，4+64=68≤128）。
- **坐标铁律**：卡内存局部坐标；`worldToLocal/localToWorld` 只在 levelWorkshop.js 实现，其他模块经它换算。`state.levelRun.answers` 以局部坐标字符串 `'x,y,z'` 为 key。
- 区域自动检测（G2 P0-1 修订）：**旗组∪答题机∪星辉门∪门 的联合包围盒 +2 格边距**，clamp 进世界边界；超 96×64×96 上限报错提示缩围。圈外装饰不进卡（P0 简化，已裁决）。

## 3. 模块 API

### 3.1 js/levelWorkshop.js（新，A1）

```js
export const LEVEL_CARD_FORMAT = 'mcweb.level.v1'
export const LEVEL_REGION_MAX = { w:96, h:64, d:96 }
export const LEVEL_EMBED_OFFSET = { x:80, y:4, z:80 }

export function computeAutoRegion()            // → {x0,y0,z0,w,h,d}|null（无锚点返回 null；锚点=旗∪keypad∪星辉门∪门）
export function snapshotRegion(region)         // → Uint8Array（RLE 字节，读 state.blocks）
export function buildLevelCard({name, author, lockMetaProvider, draft})
  // lockMetaProvider(x,y,z) → {question:{subject,kind,stem,options?,answer,hint?,unit?}, verifiedPasses:number}|null
  //   缺省 = import eduKeypad 的 getAuthoredLock；A1 的 Node 测试注入 stub
  //   draft=true ⇒ meta.draft=true（AI 草稿，questionProvider 直接给锁题）
  // 扫描 region 内 keypad→questions（verified 带出），旗→flags；返回 card | {error:文案}
export function validateLevelCard(card)        // → {ok, errors[], warnings[]}
  // 格式/方块ID合法/题目schema（选项查重、答案≠干扰项、input 0..9999、choice 索引合法、答案唯一性）/
  // 起终点旗存在/锁双通过（meta.draft 时降为 warning）/ reachabilityBFS 不可达 ⇒ warning
export function cardHash(card)                 // → 稳定字符串（djb2 over 规范化 JSON：region.blocks+questions+rules）
export function reachabilityBFS(card)          // → {reachable:bool}  实心=墙；keypad/星辉门/门/旗格=可通行；起→终+全部锁
export async function saveLevelCard(card, thumbnailBlob?)   // → {ok:true,id,sessionOnly?:bool}
  // IndexedDB 'mcweb-levels'/'cards'（key=id=cardHash+created 短码）；不可用/超限⇒内存会话存储+sessionOnly:true
export async function listLevelCards()         // → [{id,name,author,created,cardHash,sessionOnly?}]（IndexedDB+会话合并）
export async function getLevelCard(id)         // → card|null
export async function deleteLevelCard(id)      // → bool
export function embedLevelToWorld(card)        // → {dirtyChunks:[{cx,cz}], spawn:{x,y,z}}
  // 前置：调用方已把 state.blocks 清零+铺 y=0 基岩层；本函数只写 region 区（局部→世界 +EMBED_OFFSET）
  // 返回需重建的区块键；spawn=起点旗世界坐标
export function worldToLocal(x,y,z) / localToWorld(x,y,z)   // 唯一换算点
export function isOutOfRunArea(x,y,z)          // 掉界判定：y<1 或 水平超出 region±2
```

Node 可测性：levelWorkshop 只许 import config/state/world/saveGame（禁 three/chunk/DOM）；浏览器专用路径（默认 lockMetaProvider 的 eduKeypad import）用动态 `import()` 惰性加载。A1 附 `tools/test_level_workshop.mjs`（node:test：RLE 回环/卡片校验各分支/坐标换算/BFS/越界 clamp）。

### 3.2 js/levelRun.js（新，A2）

```js
export function isLevelRunActive()             // state.levelRun != null
export function getLevelRun()
export async function enterLevel(cardOrId)     // 卡对象或 IndexedDB id 均可。流程：
  // saveGame() 强制落盘当前世界 → clearBuildQueue() → state.levelRun = {...} →
  // 暂存{time,gameMode} → state.blocks 清零+y0 基岩 → embedLevelToWorld → 重建 dirtyChunks →
  // initRedstone()/initKinetic() → 清 enemies/itemDrops/tnt/particles → 玩家置 spawn、fallStartY=null →
  // gameMode 强制 SURVIVAL、time 锁正午 → 关全部浮层 setState('playing')
export function exitLevelRun({toTitle=false})  // levelRun=null → 恢复 time/gameMode → loadGame(state.saveSlot)
  // → setState(toTitle?'title':'playing')；若录像 owner==='level' 先 stopRecording()
export function tickLevelRun(dt)               // main.js 每帧调：计时/检查点踩踏（水平距<1.2 且 y±1.5）/终点/
  // 掉界(isOutOfRunArea)/timeLimit 超时⇒失败结算；触发结算时 openResultState()（uiModal）
export function onPlayerDeath()                // playerLife.die() 调：deaths+1（计时不停）
export function getRespawnPos()                // → 最近激活检查点|起点（playerLife.respawn 用）
export function recordLockAttempt(localKey, correct)  // eduKeypad/星辉门作答均调（answers 记账）
export function getCardQuestion(x,y,z)         // 世界坐标→局部→card.questions 匹配；无则 null
export function isLockAIHelpFrozen()           // card.rules.lockAIHelp===false
export function finishRun()                    // 踩终点：{timeSec,deaths,locks:[{pos,tries,solved}],stars,isNewBest}
  // 星级：3=零死亡且全锁一次过；2=通关且(零死亡或全锁最终答对)；1=通关。recordBest 落 localStorage
export function getBestScores(cardHash) / function getHudState()  // {time,deaths,solved,total}
// 埋点（P2）：enterLevel 时 recordLevelPlay()；七天内同知识点开门由星辉门侧调 recordReturnEvent()
```

`state.levelRun` 结构：`{cardId, cardHash, card, spawn, respawn, activatedCheckpoints:Set, timeStart, elapsed, deaths, answers:{'lx,ly,lz':{tries,solved}}, rules, restore:{time,gameMode}}`。
A2 附 `tools/test_level_run.mjs`（node:test：星级规则/answers 记账/检查点切换/getCardQuestion 换算——DOM/Three 路径用注入 stub）。浏览器专用 import（buildQueue/uiModal/redstone 等）集中放文件底部延迟段，纯逻辑函数保持可测。

### 3.3 js/eduStarlight.js（新，A3）

```js
export function interactStarlightAt(x,y,z)   // → true 拦截右键链。面板：展示超纲知识点（进度单元之后）
  // 抽题=按格哈希（同格同题，沿用 M1 契约），单元=unitSequence(subject) 中 progress.unit 之后
  // 答对：setBlockSafe(starlightId(1))+rebuildChunk+updateRedstoneNetwork+「提前解锁」记录+recordReturnEvent
  // 答错：温和文案+addWrongQuestion({source:'星辉门'})+引导找 🤖 要提示（若 isLockAIHelpFrozen 改文案）
export function closeStarlightPanel()
```

### 3.4 js/eduKeypad.js 增量（B3）

```js
export function getAuthoredLock(x,y,z)       // → {question, verifiedPasses}|null（作者面板内存 Map）
export function interactKeypadAuthorAt(x,y,z)// 持出题笔右键答题机：作者面板（自拟/抽题/双通过/考核锁开关）
export function isLockVerified(x,y,z)        // verifiedPasses>=2
```
- `interactKeypadAt` 修改：开头查 `levelRun.getCardQuestion(x,y,z)`，有则跳过题库抽题直接用它；无论对错作答都调 `levelRun.recordLockAttempt(localKey, correct)`（localKey 用 levelWorkshop.worldToLocal）。
- 作者面板（复用 M1 答题 UI 骨架）：学科标签+题型（数字 0..9999/三~四选一）+「从题库抽」按学科+单元过滤+数学输入题「系统算答案」按钮（回显答案，G2 P1-2：作者须能看见答案完成双通过）+选项查重+数字题答案唯一性校验+考核锁开关（写 rules.lockAIHelp）。
- 双通过=同一把锁连续答对 2 次（verifiedPasses 计数，答错清零重计）。

### 3.5 js/eduRewards.js 增量（A3）

```js
p.progress = { unit: 1 }                     // 当前学习进度（三上第 N 单元，默认 1）
export function setProgress/getProgress
p.wrongBook = []                             // cap 50 滚动：{t, subject, unit, stem, answer?, source}
export function addWrongQuestion(entry)
p.metrics = { weekPlays:{'YYYY-Www':n}, returnEvents:[{t,unit}], helpRequests:n }
export function recordLevelPlay() / recordReturnEvent(unit) / recordHelpRequest() / getWeeklyReport()
export function unitSequence(subject)        // → [{unit:string}] 保序去重（读 bank items 的 unit 字段）
```

## 4. 接线点清单（B2 拥有全部下列文件）

| 文件 | 改动 |
|---|---|
| state.js | `state.levelRun = null` 初始字段 |
| saveGame.js | `saveGame()` 入口 `if (state.levelRun) return false`（G2 P0-2 唯一防线：30s 自动存档/pagehide/visibilitychange/手动保存四通道全覆盖） |
| interaction.js | ① breakBlockAt 顶部 levelRun 拒绝（攻击路径不受影响——攻击在 tryAttackEnemy）②默认放置分支 levelRun 拒绝+toast ③右键链 keypad 前插「持 PEN_ID 命中答题机→interactKeypadAuthorAt」④keypad 后插星辉门分支 `interactStarlightAt` ⑤门手动开合分支：levelRun 时拒绝（只许红石边沿驱动）⑥中键 pickBlockUnderCrosshair levelRun 拒绝 |
| mining.js | 挖掘蓄力路径 levelRun 短路（左键攻击保留） |
| input.js | E/M/F/F6/双击空格飞行：levelRun 时拒绝+toast |
| playerLife.js | respawn() 重生点优先 `levelRun.getRespawnPos()`；die() 调 `levelRun.onPlayerDeath()`；updateSurvivalStats levelRun 时冻结 hunger/air（摔落伤害保留） |
| main.js | gameLoop 挂 `tickLevelRun(dt)`（updateItemDrops 附近）+ `updateLevelHud()`（updateDebugInfo 附近，B4 导出）；首屏 `#btn-levels` 点击→B4 导出的 `initLevelListUI/openLevelList` |
| uiModal.js | 新态 `result`：syncOverlays 挂 `#result-panel`；openResultState()/closeResultState()；Esc in result ⇒ exitLevelRun({toTitle:true})；`wantLockNow` 天然不含 result |
| tnt.js | explode：levelRun 时跳过 锁具∪旗组∪门（普通方块照炸；bedrock 分支旁加判定） |
| entities.js | 刷怪 gate levelRun 直接跳过；补 export `clearAllEnemies()`（若无） |
| redstone.js | 星辉门开启变体进 activeSources（§1，禁延长 else-if 链） |

## 5. UI 与 DOM（B1 建 DOM，B4 接线，id 契约）

- index.html（B1）：
  - `#menu-actions` 内加 `<button id="btn-levels">🗺 关卡</button>`。
  - `#level-hud`：游戏内闯关计时条（mm:ss / 💀 deaths / 🔒 solved/total），默认 hidden，考虑 F1 `body.hud-hidden` 隐藏规则。
  - `#level-list`：首屏浮层（z-index 高于 #start-screen）：标题、`#level-list-rows` 列表容器、`#btn-level-import` + `<input type=file id=level-file-input accept=.json hidden>`、`#btn-level-try`（试玩当前世界区域）、✕ 关闭钮。
  - `#result-panel`：结算浮层（只读）：关卡名/作者、用时、死亡数、星级（★★☆）、锁明细表（每锁 位置/尝试次数/对错）、按钮 `#btn-result-retry`（🔄 重试）`#btn-result-exit`（🚪 退出）`#btn-result-poster`（📸 生成海报，P1）`#btn-result-video`（🎥 拍宣传片，P1）。
- ui.js（B4）：`initLevelListUI() / openLevelList() / renderLevelList()`（listLevelCards+最佳成绩+▶进入+✕删除二次确认+导入校验提示）、`updateLevelHud()`（读 levelRun.getHudState）、结算面板填充（finishRun 结果+星级）、`#btn-level-try`=buildLevelCard(试玩)+enterLevel(卡对象)（不落盘）、录像接线：`#btn-result-video`→守卫 `isRecording()` 后 `toggleBuildRecording('level')`（recording.js 若只认 'cam'/'user' 两源则 B4 在 recording.js 补 'level' owner 档；通关/退出自动停前必须 `isLevelOwnedRecording()` 守卫，绝不碰用户会话——run_rec.py 三用例回归）。
- main.js（B2）：`#btn-levels` 点击 → `openLevelList()`。

## 6. P3 AI 三角色（A4）

- tools.js：新工具 `check_level`（读当前世界自动区域→buildLevelCard(dry)→validateLevelCard→报告逐条文案）；`gen_level_draft`（参数 subject/unit/count/style∈{跑酷,地牢,寻宝}/name：题库抽题→三模板 buildOps enqueueBuildOps→摆旗+答题机→buildLevelCard({draft:true, questionProvider})→saveLevelCard→回执）。switch 加 case，schema 照 fn() 模式。
- docs.js：buildSystemPrompt 加「闯关模式/关卡工坊」段（出题笔用法、锁具清单、作者流程）；gameStateJson 注入 levelRun 概要（活跃卡名/计时/锁进度/isLockAIHelpFrozen）；**苏格拉底约束**：梯度提示（先反问→方法提示→「还要更直接吗」）绝不直接给答案；`isLockAIHelpFrozen()` 时拒答提示（「这扇门要靠你自己」）。
- gen 草稿 meta.draft=true；建造走 buildQueue 渐进施工。

## 7. E2E 冻结清单（W01~W19，tests/e2e/run_workshop.py，冻结后只增不改）

W01 模式隔离（挖/放/E 全拒+普通存档回归）/ W02 检查点（死亡回旗+计时连续+deaths+1+重复踩刷新）/ W03 终点结算（明细+星级+timeLimit 超时失败面板）/ W04 锁具联动（答对翻转→红石开门）/ W05 出题校验（未双通过拒导出/选项重复拒/数字范围）/ W06 卡片回环（导出→删→导入逐字段一致+锁坐标映射）/ W07 嵌入展开（固定偏移/四周空气/底部基岩/出生起点旗）/ W08 性能门（导入构建+首帧耗时，基线×1.2 实测定）/ W09 成绩持久（localStorage 重开仍在）
**W10 存档防线**（关卡中跨自动存档+pagehide+手动保存，槽位字节不变；退出恢复进关前世界）/ **W11 绕过通道全闭**（右键门手开无效/M/F/F6/双击空格/中键全拒/正午锁/无怪）/ **W12 爆炸保护**（TNT 炸锁旗门无效、普通方块照毁）/ **W13 幽灵建筑**（buildQueue 残留不写进关卡）/ **W14 坐标映射**（两把锁独立记账）/ **W15 重试重置**（锁回锁定/计时清零/最佳保留）/ **W16 出题可行性**（系统算答案+双通过+导出）/ **W17 降级路径**（IndexedDB 不可用导入即玩+提示）/ **W18 区域检测**（地形噪声下只含「旗∪锁」包围盒+2；边缘 clamp）/ **W19 试玩入口**（放旗→试玩→答题→结算全链）。

## 8. 流程与提交

- 提交链（照仓库惯例中文提交信息）：c1 基线（Edu M1/M2 存量入库）→ c2 docs（G2 裁决+本契约+org-log）→ c3 feat P0 关卡工坊核心 → c4 feat P1 炫耀回路 → c5 feat P2 拉力回流 → c6 feat P3 AI 三角色 → c7 test run_workshop → c8 docs 归档（plan 勾项/AGENTS.md/org-log G3 记录）。共享文件导致 c3~c6 边界按主题就近切分，org-log 如实记录偏差。
- 债务登记：助手热重载快照不含 levelRun（恢复后强制 levelRun=null 回关卡列表）；IndexedDB 降级成绩孤儿显示「（卡已不在本机）」。
