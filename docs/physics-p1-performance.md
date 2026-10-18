# 物理组件 P1：性能验收

2026-10-19，独立性能支线。**100轴/旋转prop、真实持续生产、64物品运输通过；最新滑轮独立复验尚未满足8 RPM与32 RPM移动帧门，不能宣告性能全绿。** 第三轮完整场景中32 RPM滑轮中位数曾通过，但独立场景复验未过，完整保留两次结果。所有数字为Node真实游戏逻辑、渲染桩，不是浏览器FPS；浏览器区块重建与GPU必须另验。

## 脚本与方法

[可复跑脚本](../tests/gamelogic/physics-perf.mjs)。Apple M4 Max、darwin arm64、Node v22.23.0。每次代码先完整复制为固定副本，再交错独立进程重复3轮；不挑最快一轮。实际采样中位数与逐轮结果同时报告。搭建、补料、断言不计时；机器产物创建计入。

```bash
# 保持历史场景，复核轴/带/梯原门（历史生产结果仅用于复现）
node --import ./tests/gamelogic/_preload.mjs tests/gamelogic/physics-perf.mjs --rpm=8
node --import ./tests/gamelogic/_preload.mjs tests/gamelogic/physics-perf.mjs --rpm=32
# 公平生产场景：真实粒子生命周期也计时；固定粒子随机种子
node --import ./tests/gamelogic/_preload.mjs tests/gamelogic/physics-perf.mjs --rpm=8 --scene=production --particles=live --check
node --import ./tests/gamelogic/_preload.mjs tests/gamelogic/physics-perf.mjs --rpm=32 --scene=production --particles=live --check
```

`--rpm=proxy32`只用于最小原型预算：一个测量帧执行四个8 RPM、1/60秒逻辑步，绝不标成原生32 RPM结果。`--scene`可单跑。`--check`在未过门时退出1；历史生产门虽保留数字比较，但有`valid:false`，不能拿它宣称真实生产达标。

| 场景 | 固定工作量与活动门 |
|---|---|
| 100轴 | 100个prop确实旋转；重算预热10次/采50次，tick预热10000次/采1000×100次摊销 |
| 10台锯 | 每线384 SU，持续补原木，预热120帧、采600活动帧；真实产物数=完成数×4；32 RPM需790–810原木/10秒 |
| 16台滑轮 | 每台1名乘客、16格行程、每台至少2次往返换向，累计≥512平台格；每帧验证乘客脚下是真平台，单列移动帧 |
| 4线64物品 | 固定64实体/84格带，90度转弯与满箱再腾空；仅真实接收后补货；必须出现满箱队首停止，≥600运输活动帧 |

新实现同时断言实际活动与`machineCompletions`/`pulleySteps`一致，持续加工、升降和运输期间`networkRebuilds=0`。旧版没有计数器，null是不可观测，不等于0。旋转、升降、运输工作量都不允许用静止帧稀释。

## 基线、冻结与方法修订

[冻结点与全部阈值](physics-p1-evidence/performance-frozen-budgets.json)；[原版8 RPM基线](physics-p1-evidence/performance-baseline8.json)；[G0原型代理](physics-p1-evidence/performance-prototype-proxy32.json)。P01沿用主方案更早冻结门，8 RPM回归为同场景旧版×1.2；原生新增工作预算先用实施前G0原型四子步代理×1.2。初始冻结发生在首次原生32 RPM采样之前，旧门未被事后放宽。

第一、二轮发现并如实保留了：旧版集中加工重算风暴；初版32 RPM因清掉余量只有750原木/10秒；快带与安全载客额外成本。余量和格桶修复后产量800、带显著加速，详情见原始记录。

生产的初始计时方法存在已证实缺陷：没有调用`updateParticles`，旧版8 RPM/G0代理/原型32的采样起点分别720/2000/1800粒子，结束均2000；代理预热先使池饱和，不能代表真实持续生产。这些数字/失败不删除，也不改名为通过。补充公平方法在每个真实dt调用公开粒子更新，并计入同一时间区间；固定独立PRNG种子20261018（三轮粒子数一致）。在**留存的原版/G0原型代码**上先取3轮中位数×1.2，冻结于2026-10-19 00:14:28，之后才测最终实现，未用最终成绩反推阈值。

| 公平生产补充门 | mean / p95 ms |
|---|---:|
| 8 RPM 全帧 | 7.198515440 / .042000000 |
| 8 RPM 完成帧 | 215.486469960 / 222.839049600 |
| 32 RPM 全帧 | .069716006 / .136452000 |
| 32 RPM 完成帧 | .136883096 / .255051600 |

公平参照粒子数：原版188→314、G0代理244→289、G0原生32为574→585，均正常释放且未饱和。原型原生32仅作方法参照，预算始终取已声明的代理上界。带的全局p95易受排队阶段分布影响，因此同时报告满箱单列门；格桶修复后两者都通过。8 RPM梯的安全扫掠额外成本是真实成本，不能借生产方法错误豁免。

## 最新对比：第三轮固定源码采样

表中值是三轮mean和p95各自的中位数；“轮数”表示该项mean/p95同时通过的独立轮次。生产使用公平live方法，其余维持原场景/原门。

| RPM | 样本 | 实测mean / p95 ms | 门mean / p95 ms | 结果 |
|---|---|---:|---:|---|
| 8 | shafts/network | 10.017949140 / 10.402083000 | 12.174000000 / 13.252000000 | 通过，3/3轮 |
| 8 | shafts/tick | 0.001426441 / 0.001558330 | 0.001657000 / 0.001872000 | 通过，3/3轮 |
| 8 | lifts/allFrames | 0.005412686 / 0.004834000 | 0.005472955 / 0.004249200 | 超门，0/3轮 |
| 8 | lifts/movementFrames | 0.112804150 / 0.169291000 | 0.104085800 / 0.254950800 | 超门，0/3轮 |
| 8 | belts/transportFrames | 0.026755209 / 0.056209000 | 0.044045301 / 0.271350000 | 通过，3/3轮 |
| 8 | belts/fullChestFrames | 0.029965113 / 0.059125000 | 0.071707996 / 0.298550400 | 通过，3/3轮 |
| 32 | shafts/network | 9.931448340 / 10.540167000 | 12.174000000 / 13.252000000 | 通过，3/3轮 |
| 32 | shafts/tick | 0.001472530 / 0.001579580 | 0.001657000 / 0.001872000 | 通过，3/3轮 |
| 32 | lifts/allFrames | 0.013749165 / 0.110167000 | 0.021631030 / 0.129601200 | 通过，3/3轮 |
| 32 | lifts/movementFrames | 0.109706200 / 0.130375000 | 0.112317560 / 0.156199200 | 通过，2/3轮 |
| 32 | belts/transportFrames | 0.024854312 / 0.056041000 | 0.165985898 / 0.161048400 | 通过，3/3轮 |
| 32 | belts/fullChestFrames | 0.048306107 / 0.063708000 | 0.274834640 / 1.884100800 | 通过，3/3轮 |
| 8 | production/allFrames | 0.019132230 / 0.036208000 | 7.198515440 / 0.042000000 | 通过，3/3轮 |
| 8 | production/completionFrames | 0.101704250 / 0.149209000 | 215.486469960 / 222.839049600 | 通过，3/3轮 |
| 32 | production/allFrames | 0.045247175 / 0.095667000 | 0.069716006 / 0.136452000 | 通过，3/3轮 |
| 32 | production/completionFrames | 0.094453125 / 0.162750000 | 0.136883096 / 0.255051600 | 通过，3/3轮 |

实际工作量全部满足：每轮8 RPM锯切200原木/800板，32 RPM锯切800原木/3200板；滑轮960次载客跨格、无全图重算。旧速运输76次转角/64件入箱/2735满箱停止实体帧；高速192次转角/152件入箱/685停止实体帧；全程64实体且数量守恒。公平最终生产粒子8 RPM为298→294、32 RPM为508→513，三轮一致。

目前真实残余：8 RPM梯移动帧均值.112804150ms高于.104085800ms（约8.4%），混合帧p95 .004834ms高于.0042492ms。32 RPM梯移动均值中位数.1097062ms低于.11231756ms，但一轮略超，不能写“三轮全过”。无需推测未测浏览器帧率。


### 滑轮独立复验

最后一次仅减少远端生物临时对象分配，保留安全判定；按协调要求仅用`--scene=lifts`交错8/32各3轮。以下数值仍对原冻结门，没有事后调门。独立场景不包含此前完整脚本的100000次空网tick预热，因此不能把相对第三轮的差异简单归因该分配改动；这也不能成为宣告通过的理由。

| RPM | 样本 | mean / p95 ms | 门mean / p95 ms | 通过轮次 |
|---|---|---:|---:|---|
| 8 | allFrames | 0.005897194 / 0.004875000 | 0.005472955 / 0.004249200 | 0/3轮 |
| 8 | movementFrames | 0.115114600 / 0.182250000 | 0.104085800 / 0.254950800 | 0/3轮 |
| 32 | allFrames | 0.015674588 / 0.109000000 | 0.021631030 / 0.129601200 | 3/3轮 |
| 32 | movementFrames | 0.116638883 / 0.156583000 | 0.112317560 / 0.156199200 | 0/3轮 |

六轮都完成960次真实携客跨格，计数一致、动力全图重算0。[旧速原始第一轮](physics-p1-evidence/performance-lift-final-8-1.json)、[高速原始第一轮](physics-p1-evidence/performance-lift-final-32-1.json)，其余轮次见总清单。当前最重要的限制是滑轮性能门仍未全过；有效旧门与这些未达标记录均保留。

## 真实浏览器生产观察

独立配套支线执行 [浏览器脚本](../tests/e2e/physics_p1_browser_perf_ego.mjs)，从独立18438测试源重新加载最新模块；普通生存暂停主循环后，显式驱动真实产品逻辑、区块重建、粒子、掉落物与WebGL渲染。1280×720、pixelRatio=1、阴影开；22个chunk groups、32个真实chunk meshes、170个旋转prop。预热120步后测600个1/60秒活动步，包含供料和完成时的真实区块重建，没有替换为渲染桩。

| 样本 | 帧数 | mean / p95 / max ms |
|---|---:|---:|
| 全部活动步 | 600 | 3.894 / 10.600 / 11.300 |
| 加工完成步 | 80 | 10.541 / 11.000 / 11.300 |

实际800原木→3200木板，动力重算0，完成区块对象真实替换。统计为CPU更新与WebGL提交耗时，未同步等待GPU；不能推导实际FPS。没有实施前冻结的浏览器历史门，因此只报告观察值，不将其算为浏览器回归门通过。[完整机器/浏览器环境、逐步时间与计数](physics-p1-evidence/browser-performance.json)。测试页已清理并导航至空白页。

结论：第一批组件可用，功能和资源验收完成；G3性能层仍有滑轮门未关闭，浏览器亦无可比的历史预算。保留乘客安全检查，将16台持续携客场景的优化作为明确后续项；不能以删除安全检查或放宽本批门值结案。

## 原始证据

所有历史、修订前后参考、首次并行样本、独占三轮数据均已落入仓库，原值未改；不依赖临时目录继续存在。[总清单及SHA256](physics-p1-evidence/performance-manifest.json)含所有53份JSON，冻结信息另存。常用入口：

- [初次原型8 RPM](physics-p1-evidence/performance-prototype-8.json)、[初次原型四子步](physics-p1-evidence/performance-prototype-proxy32.json)
- [第一轮8 RPM](physics-p1-evidence/performance-final-8-1.json)、[第一轮32 RPM](physics-p1-evidence/performance-final-32-1.json)
- [第二轮8 RPM](physics-p1-evidence/performance-round2-8-1.json)、[第二轮32 RPM](physics-p1-evidence/performance-round2-32-1.json)
- [公平原版基线](physics-p1-evidence/performance-live-reference-baseline8-8-1.json)、[公平G0代理](physics-p1-evidence/performance-live-reference-prototype-proxy32-1.json)、[公平G0原生参照](physics-p1-evidence/performance-live-reference-prototype-32-1.json)
- [最终旧速全场景](physics-p1-evidence/performance-round3-8-historical-1.json)、[最终高速全场景](physics-p1-evidence/performance-round3-32-historical-1.json)
- [最终公平旧速生产](physics-p1-evidence/performance-round3-8-live-1.json)、[最终公平高速生产](physics-p1-evidence/performance-round3-32-live-1.json)

每组其余轮次及未固定随机源的探索样本均在总清单中；此前无粒子生命周期的生产时间门保留历史意义，不参与真实持续生产达标结论。当前脚本SHA256：`35bb8acaff01de1d9abf31b23bc66f10015f0b9eb9c8570b7cbe2ab9567b35c7`。
