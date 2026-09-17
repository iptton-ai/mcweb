---
title: 实现就绪度报告与 Sprint 规划（mcweb）
status: final
verdict: CONCERNS
intent: sprint-planning（headless，无人工交互）
created: 2026-09-17
project: game（mcweb「我的世界 - 网页复刻版」）
sources:
  - _bmad-output/planning-artifacts/briefs/brief-game-2026-09-17/brief.md + addendum.md
  - _bmad-output/planning-artifacts/prds/prd-game-2026-09-17/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-game-2026-09-17/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-game-2026-09-17/DESIGN.md + EXPERIENCE.md
  - _bmad-output/planning-artifacts/epics.md
  - AGENTS.md（仓库根）；docs/create-lite-org-plan.md / create-lite-org-log.md；docs/edu-workshop-impl-contract.md / edu-quiz-banks-contract.md
outputs:
  - _bmad-output/implementation-artifacts/sprint-status.yaml（Sprint 跟踪文件，已生成并通过脚本 validate 与 merge 往返测试）
---

# 实现就绪度报告与 Sprint 规划（bmad-sprint-planning，第六步）

## 1. 判定：CONCERNS（可实施，带三项已知保留意见）

对规划链整体回答门禁核心问题——**「开发者能否在不发明『没有任何记录的决策』的前提下实施这些史诗？」**：

- **Epic 1~7（现役，回溯登记）**：可以。回溯故事与 FR/NFR/UX-DR 追溯链完整（FR-1..42 全覆盖、双向无孤儿），验收锚点全部落到既有测试资产（`tests/e2e/run_*.py`、`tools/test_*.mjs`、`validate_banks.py`）。
- **Epic 8~11（前瞻）**：方向可以立项。AC 与架构约束（AD 编号）已写清，实现细节被上游**显式登记**为「留待批次 G1 方案」——这是有记录的推迟，不是缺失；但其中 4 条故事带**未裁决前置条件**（见 Findings 2），未裁决前不得进入可取用池。

不构成 FAIL 的理由：所有缺口都已在上游产物中被登记为显式开放问题或债务（有编号、有触发条件），跟踪文件已将其结构化为阻塞闸门，不存在「静默缺口」。

## 2. Findings（按严重度）

1. **[中] 回溯 Done 口径未重跑测试**（epics.md 假设 A-1）。32 条回溯故事的 done 依据是「锚点在文档化时点（2026-09-16 止代码）为通过状态、以 AGENTS.md 记录的用例数与绿灯口径为基线」，本次规划未重跑任何套件。风险：若某锚点当前实际为红，跟踪文件的 done 会高估真实进度。**缓解**：把「全套件回归（NFR-8 清单）」列为下一个 Sprint 的开场动作，先坐实 done 基线再动新代码。
2. **[中] Epic 8~11 存在未裁决前置条件**：8-1 受技术债 5/脊线 OQ-3（星辉门自包含，仅「预告关」类）阻塞；9-1 受 UX OQ-E2（大字模式档位）与 UX OQ-E5/SM-5（键位墙形态须儿童测试）阻塞；10-1 铺量环节受 PRD OQ-5（版权法务确认）阻塞；11-1/11-2 为条件需求，分别整条依赖 PRD OQ-1/OQ-2 裁决。已在 `sprint-status.yaml` 的 `forward_story_gates` 中逐条登记（tblocked-partial / tblocked-hard），**清空前不得提升为 ready-for-dev**。
3. **[中] 测试缺口 12 项登记在案**（epics.md 故事统计节；开放问题 OQ-S1）：完全缺口 4（FR-11 商人运行时 / FR-14 奖励冻结态 / FR-28 回流 7 天窗口 / FR-32 草稿生成浏览器全链）+ 部分缺口 8。其中 FR-14（刻意观察态）与 FR-33（LLM 非确定行为）属「刻意不自动化」，FR-8 编码降级链属环境依赖，NFR-2 锚点在仓库外（主站仓 nginx）——**可自动化补齐的约 7 项**已纳入下一个 Sprint 建议。
4. **[低] 两套 OQ 编号体系并存**：PRD §9.1（OQ-1..6）与架构脊线（OQ-1..6）编号不互指，同名编号语义不同（如 OQ-2 在 PRD=商标改名、在脊线=元件索引立项时点）。本报告与跟踪文件一律以「PRD OQ-n / 脊线 OQ-n / UX OQ-En / 债 n」前缀消歧；建议后续文档批次统一编号（非阻塞）。
5. **[低] BMAD 语义的回顾未运行**：全部 retrospective 诚实保留 optional。批次级复盘事实上以决策日志形式沉淀于 `docs/create-lite-org-log.md`（覆盖 B1/L1/L2/W 批次，未覆盖全部 Epic 1~7），如需补跑用 bmad-retrospective。
6. **[信息] 解析 warning ×2**（epics.md 第 18 行文档主标题、第 183 行「Epic List」目录标题被识别为疑似史诗标题）：已逐一核对为非史诗标题，属预期误报，不需修改 epics.md。

## 3. 跟踪文件生成结果与自主裁决记录

- **文件**：`_bmad-output/implementation-artifacts/sprint-status.yaml`（由 `sprint_plan.py` 生成，`--set` 显式落回溯状态）。
- **覆盖**：11 史诗 / **40 故事全部在册**（32 done + 8 backlog）/ 11 retrospective（optional）。脚本 validate 通过；重跑 merge 往返字节级一致（注记与自定义键保留、done 不降级、in_sync=true）。
- **状态分布**：done 39（7 史诗 + 32 故事）、backlog 12（4 史诗 + 8 故事）、optional 11（回顾）。

headless 环境下以下环节以产物取证代替人工确认（技能流程要求记录裁决理由）：

| # | 裁决 | 依据 |
|---|---|---|
| 1 | Epic 1~7（7 史诗 + 32 故事）标 done=回溯性登记，注明锚点见 epics.md | 任务指令 + epics.md 各故事「Done·回溯」状态标注 + PRD §7.1「现役已交付」清单，三证一致 |
| 2 | `tblocked` 不直接写入状态值（脚本词表只有 backlog/ready-for-dev/in-progress/review/done，非法值会在下次 merge 被重置），阻塞语义放顶层自定义键 `forward_story_gates`（merge 往返保留，已实测） | sprint_plan.py 词表与 merge 实现；保住「脚本可继续维护该文件」的确定性路径 |
| 3 | retrospective 全部 optional（不标 done） | org-log 只覆盖 B1/L1/L2/W 批次，不能代表 Epic 1~7 全部；诚实优先于美观 |
| 4 | 判定 CONCERNS 后继续生成跟踪文件（不停止） | 门禁 reference 对 CONCERNS 允许继续；headless 模式规定不提问；任务明确要求产出跟踪文件 |
| 5 | 回顾条目不充当发布记录；发布批准保留为人类决策队列第一项 | 本项目惯例：人类尽量不参与裁决，发布批准与产品级裁决必经人类（org-plan §5.5） |

## 4. 下一个可执行 Sprint 建议——S1「还债与通路」

> 定位：不排期任何被阻塞的前瞻故事；先把 done 基线坐实、把测试缺口中可自动化的部分清掉、把无前置的前瞻故事推进到可立项状态。实施照常走批次流水线（G1 方案 → G2 对抗评审 → 开发 → G3 验收，小批次 G1 可从简），本建议不改门禁。

**主线 C（开场，半天量级）｜done 基线复核**：按 NFR-8 清单跑全套件回归（run_g0 / run_regression / run_l1 / run_l2 / run_rec / run_migrate / run_elevator / run_filming / run_workshop / run_l2 + smoke_* 与 tools/test_*.mjs、validate_banks.py）。全绿 → Findings 1 关闭；有红 → 先走 G0 修复门，并如实回写跟踪文件。

**主线 A（主体）｜测试缺口补齐批次（OQ-S1 可自动化子集，按性价比排序）**：

1. **NFR-3 无遥测扫描**（缺口⑫）：新增 `tools/` 静态扫描脚本（fetch / XMLHttpRequest / WebSocket / sendBeacon / EventSource / Image 上报等网络调用面），白名单=用户自配 LLM 上游 + 静态 CDN；把 AR-14 零遥测红线从「评审口径」升级为可执行门，进 G3 检查单。
2. **FR-32 草稿生成浏览器全链 E2E**（缺口④）：smoke 扩展「生成 → 导入 → 编辑 → 正式导出拦截」，Node 直测（test_gen_draft.mjs）之外的 UI 链路补齐。
3. **FR-11 英语商人运行时 E2E**（缺口①）：三模式轮换、奖励发放、图鉴 `s:` 前缀入鉴。
4. **FR-28 回流事件 7 天窗口端到端**（缺口③）：时间推移方案（时钟注入/夹具）随 G1 定。
5. **FR-12 识字矿石挖开→认领→入鉴运行时 E2E**（缺口⑥）。
6. **FR-27 打印 CSS 与 details 折叠 UI、FR-35 海报截帧失败降级路径**（缺口⑦⑨）。
7. （可选）**FR-2 生存数值部分缺口**（缺口⑤：29 配方逐条/四档工具数值断言）。

**不做**（登记理由）：缺口② FR-14 奖励冻结态（刻意观察态 SM-C3，为冻结功能补测属浪费）；缺口⑧ FR-33「绝不代答」LLM 输出（非确定行为，锚=提示词红线+人工评审）；缺口⑩ FR-8 编码降级链（依赖宿主编码器，环境依赖型）；缺口⑪ NFR-2 公网缓存（锚点在主站仓 nginx，仓库外）。

**主线 B（可并行）｜无硬前置的前瞻故事预研**：8-2（新锁具校验管线与 E2E 冻结清单扩展）无硬前置，可先行 G1 预研（纯校验器增量，不触 redstone 扫描面）；9-2 / 10-2 同为无硬前置，但触及扫描规模/世界扩容前必须先过债 1（债 2）评估——在评估结论出来前只做方案不写码。

**完成定义（G3 口径）**：主线 C 全套件绿；新增用例全部进入冻结清单（AR-15 只增不改）；不引入任何被 forward_story_gates 拦截的故事；性能敏感分支先跑基线再定阈值（基线 ×1.2）。

## 5. 人类决策队列（必经人类，同步登记于 sprint-status.yaml `human_decision_queue`）

PRD OQ-1（回流观测闭环→阻塞 11-1）、PRD OQ-2（商标改名→阻塞 11-2）、PRD OQ-4（M2 奖励梯队去留→影响 2-6 冻结态走向）、PRD OQ-5（版权法务确认→阻塞 10-1 铺量）、脊线 OQ-3/债 5（星辉门自包含→阻塞 8-1 预告关类）、脊线 OQ-2/债 1（元件索引立项时点→8-2/9-2/10-2 条件触发）、epics.md OQ-S1（补测范围确认）＋每次发布上线批准。裁决落地后：条件故事改 `ready-for-dev`（先建故事文件）并清空对应 gate，再重跑本技能刷新跟踪文件。
