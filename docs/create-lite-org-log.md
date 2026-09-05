# Create-lite 组织流程决策日志

> 按 docs/create-lite-org-plan.md 附录 B 格式按批次分节追加，记录每条裁决的理由与依据，
> 供人类事后审计。裁决准绳见 org-plan §0.2。

## 批次 B1（2026-09-05）：G0 修复门

**目标**：修复 2026-09-05 有状态方块设计审查的 P1×3 + 附录 A 顺手修×2，
每项一 commit + E2E 用例锁行为（用例号 G0-xx）。

### 待办（G0 范围冻结）

- [ ] G0-01 红石灯叠放连锁塌落 —— `isSupportedBy`/`popUnsupportedRedstone` 排除 LAMP（js/redstone.js）：灯是 solid 立方体，不参与贴面支撑逻辑
- [ ] G0-02 观察者充能方向反 —— 脉冲应充能背面输出格 `powerBlock(s + 输出法线)`，现状误充正面侦测目标（js/redstone.js）
- [ ] G0-03 覆盖水车顶的水不触发动力重算 —— 放置分支：目标格下方是水车且发生「水→固体」覆盖时补调 `updateKineticNetwork()`（js/interaction.js）
- [ ] G0-04 活塞推出界对齐原版 —— `planExtend` 目的格出界 = 整个动作失败（js/piston.js）【附录 A 顺手修】
- [ ] G0-05 机器进度 Map 残留清理 —— `updateKineticNetwork` 对不在 crusherCells/sawCells 的 key 清理（js/kinetic.js）【附录 A 顺手修】
- [ ] E2E：G0-01..05 新用例 + 红石/活塞/动力既有回归（org-plan §5.1）
- [ ] P2/P3 按附录 A 默认裁决登记去向（不修，仅记录）

### 裁决记录

- [G0] 开工：org-plan + 本日志入库（commit 见下）。
