# DeepSeek Harness (dsh) 治理 / 质量门 / 决策记录 / 事故复盘 —— 引证核查报告

**核查对象**：`/Users/zxnap/code/opensource/deepseek-harness`（真实 git checkout）
**HEAD**：`00102833dfaee1da9f48a3a8eae9d34005a75218` — `Tue Sep 22 23:25:38 2026 +0800` — *Merge pull request #4978 from deepseek-harness/worktree/release-dsh-0.1.7-alpha.2*
**提交总数**：19,520（`git rev-list --count HEAD` 实测）
**首次提交**：`Wed Jun 10 22:57:44 2026 +0800`
**读取权限**：只读（本人未修改仓库任何文件）
**核查日期**：2026-10-12

> 本报告所有引文均为**逐字原文**，标注 `路径:行号`。凡与用户既有认知不符处，见文末「可疑/不实说法核对」表。**凡我未能证实者，明确标注「未证实」，绝不编造。**

---

## 0. 总览：一句话结论

dsh 仓库的治理体系**确实存在且高度机械化**，但它的组织方式与「ADR 编号制」完全不同：它用 **Agent Notes（路径编码生命周期/类别的 RFC 式决策记录）** + **69 个 `scripts/verify-*` 机械门禁** + **4 篇 postmortem** 三层结构，明确**拒绝**编号式 ADR 惯例。用户提供的绝大部分引文**逐字属实**，但有 **4 处关键偏差**（ADR 0007、1600 词预算、foundation over blast radius、"9 rejected 都是怕丢信息"），详见 §11。

---

## 1. Agent Notes 系统（`.agents/notes/`）

### 1.1 数量核查（重要修正）

`find .agents/notes -name '*.md' | wc -l` = **2354**（用户数字正确，但**口径是「全部三件套产物」**）。

dsh 的每一篇 Agent Note 是一个**三件套（triplet）**：`topic.md`（英文正文）+ `topic.zh.md`（中文对照）+ `topic.i18n.yaml`（一致性记录）。实测：

| 产物类型 | 数量 |
|---|---|
| `*.md`（英文正文） | **1179** |
| `*.zh.md`（中文对照） | 1175 |
| `*.i18n.yaml`（一致性记录 sidecar） | 1175 |
| `*.md` 合计（含 zh） | **2354** ← 用户的 2354 |

**用户提供的 21 个 `{state}/{class}` 数字与「英文正文」口径逐一精确吻合**（本人逐目录核验，21/21 全中）：

| state/class | 用户数字 | 实测（英文正文） | 实测（含 zh，全部 .md） |
|---|---|---|---|
| archived/feature | 217 | **217** ✓ | 434 |
| implemented/architecture | 184 | **184** ✓ | 368 |
| archived/bug-fix | 128 | **128** ✓ | 256 |
| archived/architecture | 125 | **125** ✓ | 250 |
| implemented/feature | 123 | **123** ✓ | 246 |
| archived/process | 75 | **75** ✓ | 150 |
| archived/simplification | 74 | **74** ✓ | 148 |
| implemented/process | 67 | **67** ✓ | 134 |
| implemented/bug-fix | 56 | **56** ✓ | 112 |
| implemented/simplification | 27 | **27** ✓ | 54 |
| implemented/testing | 25 | **25** ✓ | 50 |
| archived/testing | 20 | **20** ✓ | 40 |
| proposed/architecture | 12 | **12** ✓ | 24 |
| proposed/simplification | 10 | **10** ✓ | 20 |
| rejected/simplification | 9 | **9** ✓ | 18 |
| proposed/process | 7 | **7** ✓ | 14 |
| proposed/feature | 7 | **7** ✓ | 14 |
| rejected/architecture | 3 | **3** ✓ | 6 |
| rejected/process | 2 | **2** ✓ | 4 |
| proposed/testing | 2 | **2** ✓ | 4 |
| proposed/bug-fix | 1 | **1** ✓ | 2 |

**结论：用户的测量完全正确，只是口径为「英文正文」。写文章时必须说明口径，否则 2354 与 1179 都对但会互相打脸。** 全文总数 1179 篇英文 Agent Note（+ 中文对照与一致性记录）。

### 1.2 何时必须写（mandatory 条件）

`.agents/notes/README.md:46`：

> Add or update an Agent Note in the same PR only for lasting decision rationale that code, tests, and existing documentation do not explain. A proposal for substantial future work starts in `proposed/`; a decision already made starts in `implemented/`. Pick the class folder that matches the decision (see [Classification](#classification)).

豁免条件，`.agents/notes/README.md:48`：

> Mechanical or local edits, including local UI presentation and interaction changes, are exempt.

根 `AGENTS.md:153` 复述同一规则：

> - **Create Agent Notes only for durable decision rationale;** mechanical/local edits are exempt, including local UI changes

**关键机制：不是「写完再说」，而是「同一个 PR 内」**（`in the same PR`）。且 `AGENTS.md:5`：

> **Every new Agent Note triggers a supersession check.** Search the active tree for older notes covering the same decision or mechanism, classify any full or partial supersession with [`dsh-archive-agent-notes`](../skills/dsh-archive-agent-notes/SKILL.md), and archive every qualifying implemented triplet in the same PR.

即：**每写一篇新 note，强制触发一次「取代关系检查」**，并必须在同一 PR 内归档所有符合条件的 implemented 三件套。

### 1.3 路径编码 `{lifecycle}/{class}/yyyy-mm-dd-topic.md`

`.agents/notes/README.md:9`（逐字）：

> Every Agent Note has two axes, both encoded in its **path** — `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`:

**Lifecycle（顶层目录）= 状态，note 会随状态变化在目录间移动**（`README.md:11`）：

> - **Lifecycle** (the top-level folder) is the Agent Note's status, and an Agent Note moves between folders as that status changes:

三个 lifecycle（`README.md:12-14`）：

- `proposed/` — proposals reviewed before implementation; not yet built (or only partly).
- `implemented/` — the decision shipped. …
- `rejected/` — the proposal was considered and declined. Keep it only while its rationale prevents a tempting, meaningful mistake; otherwise delete the complete triplet.

**日期的语义被明确限定为首提日期**（`README.md:17`）：

> The date in the filename is when the topic was **first proposed** (per git history). Cross-references between Agent Notes use relative markdown links (`[topic](../../implemented/architecture/2026-…-….md)`) — never bare prose or numbers — so they are mechanically checkable and survive moves between folders.

**类别（class）是封闭集，由代码定义**（`README.md:23`）：

> Each Agent Note belongs to one path-encoded class from the closed set in `scripts/agent-note-tree.ts`; the classification gate rejects other folders. Adding a class requires updating the canonical set and this section.

六个 class（`README.md:25-32`）：`feature` / `bug-fix` / `simplification` / `architecture` / `process` / `testing`。

架构 vs 流程的分界线（`README.md:34`，可作为金句）：

> The `architecture` / `process` line: **architecture** is about the source we ship; **process** is the surrounding tooling and workflow. (`refactor` is deliberately absent — it overlaps `simplification`, whose discriminator, "does observable behavior change?", already covers it.)

**反索引化**（`README.md:19`）：

> Do not add a centralized `INDEX.md`; the [no-index Agent Note](implemented/process/2026-07-19-remove-generated-agent-note-index.md) owns the rationale.

### 1.4 文件内必需格式（严格可机械校验）

`.agents/notes/README.md:56`：

> Every active Agent Note follows one in-file format, enforced by `pnpm run verify-agent-note-format` ([scripts/verify-agent-note-format.ts](../../scripts/verify-agent-note-format.ts), part of `doc-sync`)

**头部三行精确**（`README.md:60`）：

> The first three lines of every Agent Note are exactly:
>
> ```markdown
> # Agent Note: <title>
>
> Status: <status>
> ```

`Status:` 三种形式，且**必须与所在 lifecycle 目录一致**（`README.md:68`）：

> The `Status:` value is one of three forms, and must agree with the lifecycle folder the file sits in — the gate cross-checks them:
>
> - `Status: proposed`
> - `Status: implemented`
> - `Status: rejected — <why, in one line>`

`README.md:74`：

> The rejection reason is the one status with content, because a rejected Agent Note's verdict is the fact readers come for.

**正文骨架按 lifecycle 分**（`README.md:78`）：

- `proposed/`：`## Problem` → `## Proposal` → …bespoke… → `## Alternatives considered` → `## Acceptance criteria` → `## Risks`
- `implemented/`：`## Problem` → `## Decision` → …bespoke… → `## Alternatives considered` → `## Consequences`
- `rejected/`：保留提案期章节，verdict 放在 `Status:` 行

**implemented 禁用提案期标题**（`README.md:103`）：

> Proposal-era headings are spec-speak here and the gate rejects them: `## Proposal`, `## Plan`, `## Migration plan`, and `## Acceptance criteria` may not appear in an implemented Agent Note (the [slop checklist](../../docs/AGENTS.md) names why).

### 1.5 `## Alternatives considered` —— 强制

`README.md:111`（逐字，全文最有价值的一段之一）：

> Every Agent Note carries an `## Alternatives considered` section: each genuine alternative and why it lost, one bold-led paragraph per alternative or a `### Why not <X>?` subsection per contested one. **A decision recorded without what it beat invites re-litigation — the failure Agent Notes exist to prevent.**

`README.md:113`：

> Alternatives are recorded, never invented. An Agent Note dated before 2026-07-05 whose alternatives are not reconstructible from the record carries this exact comment in place of the section, which the gate accepts for pre-format files only:
>
> ```markdown
> <!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
> ```

### 1.6 归档标准 —— 用户说法**已证实**

用户称文章说归档标准是「future decision value, not word count/age」。**逐字证实**，`.agents/notes/README.md:38`：

> Archive other implemented notes only when the shipped decision is complete, its rationale is unlikely to guide future work, and the record still has historical decision value. Keep it active when its alternatives, ownership boundary, negative guarantee, durable or wire semantics, security rule, or reintroduction condition remains useful. Never archive a proposed note: reject an obsolete proposal. Keep a rejected note only while it prevents a plausible mistake; otherwise delete its English, Chinese, and sidecar files together. **Use the calibrated [`dsh-archive-agent-notes`](../skills/dsh-archive-agent-notes/SKILL.md) workflow rather than word count, age, or a target quota.**

**「rather than word count, age, or a target quota」逐字命中用户的复述。**

且 `README.md:38` 前半还有一条**删除规则**（不是只归档）：

> Delete an implemented Agent Note that only describes small UI adjustments or purely mechanical changes; delete its English, Chinese, and sidecar files together and repair or remove inbound links. **A local bug fix, performance change, new capability, or substantive behavior decision does not qualify merely because its implementation is small.**

### 1.7 归档后「永久冻结」

`README.md:42`（逐字）：

> Once sealed, every archived triplet is permanently frozen. Do not edit, translate, reformat, update, move, or delete it, and do not treat it as authority for current behavior. Documentation gates skip archived sources, including their outbound links; active prose may still link into an archived note when it intentionally cites history. [`verify-archived-agent-notes`](../../scripts/verify-archived-agent-notes.ts) enforces the closed class tree, complete triplets, archive metadata, sidecar hashes, and the append-only frozen-content manifest.

`README.md:40` 规定归档时**唯一允许的内容改动**：

> An archival change moves the complete English/Chinese/sidecar triplet, retains `Status: implemented`, inserts the same `Archived: YYYY-MM-DD` line immediately below that status in both language files, re-records the sidecar, and repairs or deletes inbound links. **These are the only permitted content changes during archival.**

`archived/AGENTS.md:3`：

> Archived Agent Note triplets under the kind directories are frozen historical snapshots, not current authority. Never edit, reformat, translate, repair, delete, or move a sealed artifact; use an active Agent Note or current documentation for new decisions and facts.

### 1.8 implemented/ 必须与代码同步

`implemented/AGENTS.md:7`：

> Keep paths, symbols, defaults, and mechanisms current in the same change that alters them. Rewrite stale facts in place; do not append change history.

`implemented/AGENTS.md:13` —— 关键的「同步 ≠ 改写决策」红线：

> Update factual realization in place. A reversal of the decision or its rationale requires a new Agent Note and cross-link; a fully superseded old note may be deleted only through the consolidation rule in the [Agent Note rules](../README.md).

`README.md:48` 同样表述：

> An Agent Note is never edited into a *different decision*: supersede it with a new one, and keep both notes cross-linked unless the old note is later fully consolidated under the rule below. Editing an `implemented/` Agent Note to track where its existing decision lives is required, not forbidden

### 1.9 跨 lifecycle 移动的机械代价

`README.md:121`：

> Moving a file between lifecycle folders means updating the `Status:` line and re-satisfying that folder's skeleton in the same change — the gate fails the move otherwise. Concretely, `proposed/` → `implemented/` rewrites `## Proposal` into a present-tense `## Decision`, folds `## Acceptance criteria` and `## Risks` into `## Consequences` (or a present-tense `## Testing`/`## Verification` section for what now pins the behavior), and drops plans in favor of what shipped

### 1.10 `rejected/` 的「留 vs 删」规则（用户问的点）

`README.md:14` 与 `README.md:38` 双处规定：

- 保留条件：`Keep it only while its rationale prevents a tempting, meaningful mistake`
- 否则：`otherwise delete the complete triplet`（英文+中文+sidecar 三件套一起删）
- `README.md:38` 补充：`Keep a rejected note only while it prevents a plausible mistake; otherwise delete its English, Chinese, and sidecar files together.`

**注意：规则不区分 rejected 的 class**——9 篇 rejected/simplification、3 篇 rejected/architecture、2 篇 rejected/process 共用同一删除规则。

---

## 2. `rejected/` 全部 14 篇：什么被拒、为什么

实测共 **14 篇**英文 rejected note（`rejected/simplification` 9 + `rejected/architecture` 3 + `rejected/process` 2），与用户口径一致。

### 2.1 九篇 rejected/simplification 的 `Status:` 行原文

| 文件 | Status 行（逐字） |
|---|---|
| `rejected/simplification/2026-06-20-drop-durable-step-boundaries.md:3` | `Status: rejected — \`step/end\` is the durable indication that a model step finished, and keeping the symmetric \`step/start\` / \`step/end\` pair makes crash repair, invariants, and transcript inspection clearer than inferring completion from adjacent step-scoped events.` |
| `rejected/simplification/2026-06-20-fold-session-persistence-interface.md:3` | `Status: rejected — the separate persistence Service Definition package is the intended modular role split for the durable-persistence capability seam. Folding it into \`dsh-session\` would reduce package count at the cost of a cleaner backend boundary.` |
| `rejected/simplification/2026-06-20-truncate-interrupted-turns.md:3` | `Status: rejected — a single turn can contain substantial real work, including many steps and large tool output. Preserving interrupted turns is preferable to silently dropping that tail on load.` |
| `rejected/simplification/2026-07-04-prune-dead-core-spine-api.md:3` | `Status: rejected — stale 2026-07 inventory: rows were pruned piecemeal or gained callers; a fresh audit must supersede it` |
| `rejected/simplification/2026-07-12-prune-unused-skill-registry-api.md:3` | `Status: rejected — Direct runtime skill registration is an intentional extension path for third-party plugins.` |
| `rejected/simplification/2026-07-19-fold-compaction-package-split.md:3` | `Status: rejected — More compaction backends are planned, so the Service Definition and basic provider packages remain separate.` |
| `rejected/simplification/2026-07-19-make-jsonrpc-directional.md:3` | `Status: rejected — session/prompt became an enqueue receipt without status (2026-07-30-followup-enqueue-and-owned-runs); transport narrowing may be re-proposed alone` |
| `rejected/simplification/2026-07-26-builtin-timer-promises-for-hand-rolled-sleeps.md:3` | `Status: rejected — implementation (PR #679) falsified the parity premise: vitest's fake clock does not intercept \`node:timers/promises\`, so the swap costs deterministic fast tests for ~10 deleted lines` |
| `rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.md:3` | `Status: rejected — every swap below fails the net-simplification bar on evidence; recorded so the survey is not re-run from scratch` |

### 2.2 深读三篇：拒绝理由的真实肌理

**blog 的说法「9 篇 rejected simplification 大多是『再砍一刀就会丢信息』」——未能证实，且实际上分类不成立。** 九篇的拒绝理由分属五类**完全不同的**论证：

1. **对等结构本身有可检故障价值**（`drop-durable-step-boundaries`）：不是「丢信息」，而是 `step/end` 是「模型步完成的持久指示」，且对称的 start/end 对让崩溃修复、不变式、transcript 检视**更清晰**。
2. **模块角色切分是刻意的架构边界**（`fold-session-persistence-interface`）：拒绝理由明说合包「reduce package count at the cost of a cleaner backend boundary」——**为更干净的边界而接受更多包数**。
3. **真实工作量论证**（`truncate-interrupted-turns`）：`a single turn can contain substantial real work, including many steps and large tool output. Preserving interrupted turns is preferable to silently dropping that tail on load.` —— 这一篇**最接近**「丢信息」说法，但九篇里**只有它一篇**如此。
4. **账目过期 / 已被别处零敲碎打消化**（`prune-dead-core-spine-api`）：理由是「stale 2026-07 inventory」，属于**证据失效**，不是信息损失。
5. **前提被实证证伪**（`builtin-timer-promises...`）：理由直白——`implementation (PR #679) falsified the parity premise: vitest's fake clock does not intercept node:timers/promises, so the swap costs deterministic fast tests for ~10 deleted lines`。这是**用实测反驳「等价的简化」**，与信息损失无关。
6. **有意的扩展路径**（`prune-unused-skill-registry-api`）：`Direct runtime skill registration is an intentional extension path for third-party plugins.`
7. **未来规划**（`fold-compaction-package-split`）：`More compaction backends are planned`
8. **净简化门槛未达标**（`dependency-swaps-rejected-by-nih-audit`）：`every swap below fails the net-simplification bar on evidence; recorded so the survey is not re-run from scratch` —— 注意最后半句点了**保留此 note 的真实动机**：防止重复调研。

**`prune-dead-core-spine-api` 的 `## Risks` 末句极适合引用**（`rejected/simplification/2026-07-04-prune-dead-core-spine-api.md`）：

> The repository is unreleased, so carrying unsupported surface is the larger foundation cost.

**同篇 `## Alternatives considered` 首段（拒绝「留着以后也许有用」）**：

> **Keep test conveniences and self-contained results public.** Public helpers can make white-box tests convenient, self-contained result fields can look ergonomic, and future embedders might want the concrete loop or enumeration methods. **Those benefits are hypothetical**; retaining them makes every implementation and document explain states that no shipped caller can observe. A real consumer can introduce the smallest contract it needs, with its ownership and failure semantics known.

**`truncate-interrupted-turns` 的 Problem 段落里最有价值的一句**（揭示了这批简化提案的**共同靶子**）：

> This is a lot of machinery to preserve partial work from the last crashed turn. **It also invents events that never happened.** A synthetic tool result is useful because it makes provider history valid, but it also means the resumed log contains model-visible text that no tool produced. **The current design optimizes for maximum tail preservation before there is a released product or a real resume UX that proves partial-turn recovery matters.**

**另有 5 篇非 simplification 的 rejected，理由同样各异**：

- `rejected/process/2026-06-11-architectural-conformance.md:3`：`Status: rejected — premise gone: plugins depend on dsh-agent-loop by design; dsh-llm/invariant and the hygiene dependency gates own conformance`（**前提消失**）
- `rejected/process/2026-08-04-artifact-first-npm-baseline-publication.md:3`：`Status: rejected — superseded by 2026-08-10-npm-release-sequences: numbered versions and pack→protected publish shipped; timestamp versions were not adopted`（**被取代**）
- `rejected/architecture/2026-07-25-client-settings-locale-theme.md:3`：`Status: rejected — closed as a proposal: the shipped ui-settings, locale, and ui-theme packages and their READMEs own the design`（**已由已发布实现拥有，提案作废**）
- `rejected/architecture/2026-08-08-cordis-web-dynamic-packages.md:3`：同上句式
- `rejected/architecture/2026-06-16-typed-event-schemas.md:3`：`Status: rejected — runtime event-schema registry declined; event maps stay compile-time, Zod validates projection state, migrations validate durable payloads`

**结论：`rejected/` 不是「保守派否决激进简化」的单一故事，而是一份理由高度分散的负面决策台账**——其中包含「前提消失」「已被实现取代」「实证证伪」「账目过期」等，且**保留理由常常是「防止重复调研」而非「决策本身还有价值」**。

---

## 3. `scripts/verify-*`：69 个门禁

### 3.1 实测计数

```
ls scripts/verify-* | wc -l   →  69
```
用户「我数了 69 个」**精确正确**。

其中 69 = **42 个非 spec 的实现脚本** + **27 个 `.spec.ts` 自测**（每个门禁自己也有测试）。`package.json` 中注册的 `"verify-*"` 脚本名去重后 **61 个**（部分门禁按不同参数注册多次/或由 `run-gates.ts` 直接调）。

**42 个门禁实现脚本全名**（`ls scripts/verify-*.ts scripts/verify-*.mjs | grep -v '\.spec\.'`）：

```
verify-agent-note-classification.ts        verify-node-next-types.ts
verify-agent-note-format.ts                verify-npm-install-layout.ts
verify-application-entrypoints.ts          verify-optional-dependency-imports.ts
verify-archived-agent-notes.ts             verify-package-dependencies.ts
verify-built-package-invariants.mjs        verify-package-invariants.ts
verify-client-domain-graph.ts              verify-package-meta.ts
verify-client-packages.ts                  verify-package-paths.ts
verify-client-route-resolution.ts          verify-package-readme-limitations.ts
verify-client-ui-i18n.ts                   verify-package-readme-model-experience.ts
verify-concrete-terms.ts                   verify-package-readme-summaries.ts
verify-config-source-ownership.ts          verify-public-repository-links.ts
verify-cordis-config.ts                    verify-repository-references.ts
verify-default-product-isolation.ts        verify-runtime-closure.ts
verify-doc-budgets.ts                      verify-skill-invocation-metadata.ts
verify-doc-refs.ts                         verify-subsystem-pages.ts
verify-doc-site-fragments.ts               verify-translation-pairing.ts
verify-dsh-package-licenses.ts             verify-translation-prompt.ts
verify-export-jsdoc.ts                     verify-type-equiv.ts
verify-md-links.ts                         verify-v3-event-vocabulary.ts
verify-md-wrap.ts                          verify-mermaid.ts
verify-no-bare-dispatcher.ts               verify-no-unknown-casts.ts
```

配套的 27 个 `.spec.ts`：`verify-application-entrypoints`、`verify-built-package-invariants`、`verify-client-domain-graph`、`verify-client-packages`、`verify-client-route-resolution`、`verify-client-ui-i18n`、`verify-concrete-terms`、`verify-config-source-ownership`、`verify-cordis-config`、`verify-default-product-isolation`、`verify-doc-site-fragments`、`verify-dsh-package-licenses`、`verify-md-links`、`verify-no-bare-dispatcher`、`verify-no-unknown-casts`、`verify-npm-install-layout`、`verify-optional-dependency-imports`、`verify-package-dependencies`、`verify-package-meta`、`verify-package-paths`、`verify-package-readme-summaries`、`verify-public-repository-links`、`verify-repository-references`、`verify-runtime-closure`、`verify-skill-invocation-metadata`、`verify-subsystem-pages`、`verify-v3-event-vocabulary`。

**用户点名的三个脚本的精确名字**（用户不确定的）：
- `verify-package-invariants` → 精确名即 **`scripts/verify-package-invariants.ts`**（真实存在，由 `scripts/package-invariants.ts` 承载规则）
- `verify-doc-budgets` → 精确名即 **`scripts/verify-doc-budgets.ts`**（真实存在）
- `verify-cordis-config` → 精确名即 **`scripts/verify-cordis-config.ts`**（真实存在，578 行，是这批里最厚的之一）

三个名字**全部正确**，无需修正。

### 3.2 `verify-agent-note-format.ts` —— 逐条失败条件

文件头声明（`scripts/verify-agent-note-format.ts:1-5`）：

> Enforce Agent Note headers, lifecycle-specific sections, alternatives, and retired marker rules. Classification and filenames belong to the sibling tree gate; translation structure belongs to the pairing gate.

失败条件（**全部逐字**，`:55-84`）：

| 行 | 触发失败的条件（引号内为门禁原文） | 判定逻辑 |
|---|---|---|
| `:55` | 首行不匹配 `/^# Agent Note: \S/` | `'line 1 must be \`# Agent Note: <title>\`'` |
| `:56` | 第 2 行非空 | `'line 2 must be blank'` |
| `:58-60` | 第 3 行不匹配该 lifecycle 的状态语法 | `line 3 must match the ${note.lifecycle} status grammar (${String(status)})` |
| `:61` | 第 4 行非空 | `'line 4 must be blank'` |
| `:62-65` | 文件中出现第二个 `Status:` 行 | `'the line-3 \`Status:\` line must be the only one in the file'` |
| `:68` | 第一个 `## ` 标题不是 `## Problem` | `the first section must be \`## Problem\` (got ${JSON.stringify(h2s[0] ?? '<none>')})` |
| `:69-71` | 缺 lifecycle 必需章节 | `missing the required \`${required}\` section` |
| `:72-76` | implemented note 出现提案期标题 | `` `${h2}` is a proposal-era heading; an implemented Agent Note states what is (fold it into Decision/Consequences/Testing) `` |
| `:80` | 同时有 `## Alternatives considered` 与祖父注释 | `'carries both \`## Alternatives considered\` and the grandfather comment — drop the comment'` |
| `:81` | 两者都无 | `` 'missing `## Alternatives considered` (a pre-format Agent Note whose alternatives are not reconstructible carries the grandfather comment instead — see .agents/notes/README.md § The file format)' `` |
| `:82` | 祖父注释用于 2026-07-05 及以后的 note | `the grandfather comment is only valid for Agent Notes dated before ${FORMAT_ADOPTED}` |
| `:84` | 出现已废止的 legacy 债标记 | `'carries the retired legacy-format debt marker'` |

关键常量（`:13-36`）：

```ts
const FORMAT_ADOPTED = '2026-07-05'
const GRANDFATHER = '<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->'
const LEGACY_MARKERS = ['XXX: legacy ADR/RFC body format', 'XXX: legacy ADR/Agent Note body format']
const STATUS: Record<string, RegExp> = {
  proposed: /^Status: proposed$/,
  implemented: /^Status: implemented$/,
  rejected: /^Status: rejected — .+$/,
}
const REQUIRED: Record<string, string[]> = {
  proposed: ['## Proposal', '## Acceptance criteria', '## Risks'],
  implemented: ['## Decision', '## Consequences'],
  rejected: ['## Proposal'],
}
const BANNED_IMPLEMENTED = /^## (?:Proposal\b|Plan\b|Migration plan\b|Acceptance criteria\b)/i
```

**注意 `:45-53` 的一个精细设计——代码块内的格式 token 不算文档结构**：

> ```ts
> // Format tokens inside fenced examples are not document structure.
> ```

成功输出（`:88`）：

> `verify-agent-note-format: ${notes.length} Agent Note(s) checked, all conform to .agents/notes/README.md § The file format.`

**注意 `LEGACY_MARKERS` 里两次出现 "ADR"——这是全仓库仅有的 3 处 "ADR" 之一（另两处见 §7）。**

### 3.3 `verify-archived-agent-notes.ts` —— 冻结归档的哈希封条

用途（`scripts/verify-archived-agent-notes.ts:1`）：

> `/** Verify and append-seal the frozen Agent Note archive. */`

它做四件事（`:31-99`）：

1. **目录结构**（`:31`）：`'archived/AGENTS.md is required'`
2. **根目录只允许 `AGENTS.md` 和 `manifest.json`**（`:28,35`）：`archived/${entry.name}: unexpected root file`
3. **kind 目录必须是封闭 class 集**（`:42-44`）：`archived/${entry.name}/: unknown Agent Note kind`
4. **每个 class 目录必须存在**（`:56-58`）：`archived/${kind}/: required kind directory is missing`
5. **归档必须是三件套**（`scripts/archived-agent-notes.ts:144`）：`${key}: incomplete archived triplet; missing ${missing.join(', ')}`
6. **文件名格式**（`archived-agent-notes.ts:118`）：`${path}: expected {kind}/yyyy-mm-dd-topic.{md,zh.md,i18n.yaml}`
7. **必须有 `Status: implemented`**（`archived-agent-notes.ts:101`）：`` `${path}: requires \`Status: implemented\`` ``
8. **必须紧跟合法日期的 `Archived:` 行**（`:104`）：`` `${path}: requires \`Archived: YYYY-MM-DD\` with a valid date immediately after the status` ``
9. **归档日期不得早于文件名日期**（`:106`）：`${path}: archive date ${archived} predates the note filename`
10. **中英归档日期必须一致**（`:152`）：`${key}: English and Chinese archive dates differ (${sourceDate} vs ${zhDate})`
11. **sidecar 必须记录两侧当前 git blob 哈希**（`:158`）：`${metaPath}: consistency record must contain the current Git blob hashes of both archived sides`
12. **封条哈希不得改变**（`:64-65`）：`${path}: sealed manifest entry is missing` / `${path}: sealed manifest hash changed`
13. **内容哈希**（`:174`）：`${path}: sealed content hash changed`
14. **新归档必须先在 manifest 封条**（`verify-archived-agent-notes.ts:98`）：`${path}: archived artifact is not sealed in manifest.json`

**这是「append-only 冻结」的机械实现**：`manifest.json` 记录每个归档文件的 blob 哈希，任何对已归档文件的修改都会被 `sealed manifest hash changed` 拦下。写模式为 `pnpm run verify-archived-agent-notes --write`（`:112`：`sealed ${extended.added.length} new artifact(s); existing seals unchanged.`）。

重放保护（`:86-87`）——**CI 与本地用不同基线，防止「改写已提交的 manifest」**：

> ```ts
> // CI supplies its trusted pre-change commit; local writes compare with committed HEAD.
> const baselineRef = process.env.DSH_ARCHIVE_BASE_REF ?? 'HEAD'
> ```

### 3.4 `verify-package-invariants.ts`

实现极薄（21 行），规则在 `scripts/package-invariants.ts`。用途（`:1`）：

> `/** Verify package-owned invariant source and publication rules. */`

失败输出（`verify-package-invariants.ts:11-15`）：

```
verify-package-invariants: violations found:
    <violation>
```

规则来源（`scripts/package-invariants.ts:70-75`）：`checkManifest` / `checkBuild` / `checkSource` / `checkOmissionReason` 四类检查。具体违规消息（实测）：

- `package-invariants.ts:128`：`'files must publish lib/invariant.js'`
- `package-invariants.ts:180`：`'package build override must bundle lib/types/invariant.js'`

**这就是 `packages/AGENTS.md:19` 那条规则的执行者**：

> - **Publish `./invariant` only for diverging observations.** Check an owned relation under the manifest name. Otherwise omit wiring and give the package-specific README reason. Empty companions and ignored reporters fail [`verify-package-invariants`](../.agents/notes/implemented/simplification/2026-08-28-omit-unneeded-invariant-companions.md).

成功输出：`verify-package-invariants: ${packageInvariantOwners(root).length} hand-owned package companion(s) conform.`

### 3.5 `verify-doc-budgets.ts` —— 词数预算门禁（**直接推翻 1600 词说法**）

用途（`scripts/verify-doc-budgets.ts:1-8`）：

> ```ts
> /**
>  * Enforce `wc -w`-style ceilings from `scripts/doc-budgets.manifest.json`.
>  * Missing files and invalid ceilings fail; `--list` reports current usage.
>  * Only listed standing docs are budgeted. Ceilings ratchet down with at least
>  * 5% headroom; raising one requires the justification defined in
>  * `docs/AGENTS.md`.
>  */
> ```

计数法（`:17-19`）：

> ```ts
> /** `wc -w` equivalent: count whitespace-delimited tokens. */
> ```

失败条件（`:36-52`）：

- ceiling 非正整数 → `${path}: ceiling must be a positive integer, got ${ceiling}`
- 文件不存在 → `${path}: budgeted file does not exist (renamed or deleted? update scripts/doc-budgets.manifest.json in the same change)`
- 超预算 → `${path}: ${words} words exceeds the ${ceiling}-word ceiling — relocate or condense per docs/AGENTS.md (raising the ceiling requires justification in the PR)`

失败尾部提示（`:56`）：

> `See docs/AGENTS.md for the documentation standard and the relocation-first rule.`

**预算清单原文**（`scripts/doc-budgets.manifest.json`）：

```json
{
  "AGENTS.md": 1950,
  "docs/AGENTS.md": 1320,
  "docs/architecture.md": 2410,
  "docs/cordis-primer.md": 600,
  "docs/defensive-patterns.md": 550,
  "docs/testing.md": 1350,
  "packages/AGENTS.md": 750,
  "packages/README.md": 994
}
```

**当前实际消耗**（`npx tsx scripts/verify-doc-budgets.ts --list` 实测输出）：

```
ok      1949 / 1950   AGENTS.md
ok      1313 / 1320   docs/AGENTS.md
ok      2410 / 2410   docs/architecture.md
ok       600 / 600    docs/cordis-primer.md
ok       518 / 550    docs/defensive-patterns.md
ok      1349 / 1350   docs/testing.md
ok       717 / 750    packages/AGENTS.md
ok       975 / 994    packages/README.md
```

**决定性发现**：
1. **根 `AGENTS.md` 的预算是 1950 词，不是 1600 词**（见 §11 核对表）。
2. 用户提供的 **1949 词** 与 **717 词** 实测**完全正确**——两者都是 `wc -w` 口径。
3. `docs/architecture.md` 恰好卡在 2410/2410，`docs/cordis-primer.md` 卡在 600/600——**是「顶格运行」的证据，说明预算被当作真实上限在使用**。
4. 清单只覆盖 **8 个 standing doc**（`Only listed standing docs are budgeted`），不是全仓库文档。
5. 有**棘轮机制**：`Ceilings ratchet down with at least 5% headroom`（降预算要留 5% 余量），涨预算要走 `docs/AGENTS.md` 的论证流程。

### 3.6 `verify-cordis-config.ts` —— `!!js` 事故的机械防线

用途（`:2-7`）：

> ```ts
> /**
>  * Validate Cordis Loader entry metadata and package resolution.
>  * ...
>  * activate, against that plugin context) and the entry `disabled` field (at
>  * ...
>  * metadata field stays static, so an expression there remains truthy data and
>  */
> ```

**被允许插值的字段白名单**（`:509-512`，逐字）：

> ```ts
> /**
>  * Expression-node diagnostics for one entry. `disabled` is the single
>  * interpolated metadata field: its own `!!js` expression node is allowed and
>  * must parse, while expressions nested below it stay truthy data; every other
>  * metadata field must stay fully static.
>  *
>  * @returns one diagnostic per offending expression.
>  */
> ```

**「其他元数据必须静态」的字段清单**（`:41`）：

> ```ts
> const metadataFields = ['id', 'name', 'group', 'inject', 'intercept', 'isolate'] as const
> ```

**失败消息**（`:523`）：

> ```ts
> problems.push(`${expressionPath}: !!js is not interpolated here`)
> ```

即：在 `id` / `name` / `group` / `inject` / `intercept` / `isolate` 任一字段下出现 `!!js` 表达式节点 → 直接报 `!!js is not interpolated here`。`disabled` 是唯一例外，且其表达式**必须可解析**（`:525-531`，`disabledExpressionProblem` 校验）。

**这正对应 postmortem 0002 的机制**：事故根因是团队以为 `!!js` 作用于整个 Loader 条目，实际只作用于 `entry.options.config`（见 §6.2）。这个门禁把「哪些字段会被插值」变成了可执行断言。

另有一条 `AGENTS.md:130` 的配套规则（**注意 `never !js` 的写法**）：

> cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition also uses overlays

同段（`AGENTS.md:129`）：

> Raw/Web `cordis.yml` bare plugins must appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces it.

### 3.7 关于 CoT 泄漏与 doc slop 的门禁

**重要澄清：CoT 泄漏没有 `verify-*` 脚本，它是一个 skill。** `dsh-trim-cot-leakage` 是 `.agents/skills/` 下的**方法论 skill**，其中第 5 步把门禁作为**验证手段**调用（见 §9）。

**doc slop 同样没有独立 `verify-*` 脚本**，而是：
- `docs/AGENTS.md:60-72` 的 **slop checklist**（人/AI 执行的清单，见 §8）
- `verify-concrete-terms.ts`（`AGENTS.md:151` 的 `Ban prove + nance` 规则执行者）

`AGENTS.md:151`：

> - **Ban `prove` + `nance`** ([rule](.agents/notes/implemented/process/2026-08-26-ban-ambiguous-origin-label.md)).

以及 `AGENTS.md:172` 的长段 prose 规则（见 §5）。

---

## 4. `packages/AGENTS.md`（实测 717 词）—— 反过度工程规则

实测词数 **717**（与用户所述完全一致），预算上限 750。

### 4.1 「Require a current owner and need」—— 逐字证实

`packages/AGENTS.md:11`：

> - **Require a current owner and need.** Tie each abstraction, state machine, option, defensive copy, and compatibility path to a current contract or production consumer, and keep behavior in its owning plugin or service.

### 4.2 「Inverse smell」—— 逐字证实（但它是嵌在另一条规则里）

`packages/AGENTS.md:10`：

> - **Design Service Definitions for all current Consumers.** Keep tool-schema, Loader, UI, transport, and provider-specific behavior in the Consumer or provider; do not let one Consumer dictate the service contract ([capability-seam rationale](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)). **Inverse smell: a public service method with one internal caller — pass a private capability closure instead (`RunCodeBridgeOptions`).**

### 4.3 「Require evidence for public choices」—— 逐字证实

`packages/AGENTS.md:12`：

> - **Require evidence for public choices.** Configurability does not justify an unsupported default, public operation set, format, or imported external concept. Use current-consumer evidence or relevant prior art; otherwise require an explicit value or defer the choice.

### 4.4 发布前立场 —— **用户措辞有误，实际是「foundation over speculative future」**

`packages/AGENTS.md` 中**不存在** "foundation over blast radius"（grep 无命中）。该短语在**另一篇 archived note 引用根 AGENTS.md** 时出现，真实措辞是 **"foundation over speculative future"**：

`.agents/notes/archived/simplification/2026-06-20-drop-unconsumed-llm-assembled-surfaces.md:36`：

> - **It removes public methods from a core vocabulary package.** A future plugin that wants assembled blocks without deltas would need to call `stream()` and use `BlockAssembler` directly or reintroduce a focused helper with a real consumer. Given the pre-release **"foundation over speculative future"** stance ([AGENTS.md](../../../../AGENTS.md)), this is the right time to cut test-only public shape.

**注意：该 note 把这句话归因给根 `AGENTS.md`，但根 `AGENTS.md` 中已 grep 不到这句话**——它要么在后续编辑中被改动/删除，要么该 note 引用的是措辞而非逐字引用。**「发布前立场」的精神在仓库中确实充分存在**，最有力的直接证据是 `rejected/simplification/2026-07-04-prune-dead-core-spine-api.md` 的 Risks 末句：

> The repository is unreleased, so carrying unsupported surface is the larger foundation cost.

以及 `packages/AGENTS.md:12` 的 `Configurability does not justify an unsupported default`。

### 4.5 packages/AGENTS.md 其他值得引用的硬规则

- `:5`（**postmortem 0001 的机械转化**）：`**Plugin exports:** service packages default-export their service class; function plugins named-export \`name\` / \`inject\` / \`Config\` / \`apply\` and have no default export. Mixing the forms makes the Loader discard the function plugin's namespace`
- `:6`：`**Optional services use \`ctx.get(name)\`.** Reserve \`ctx.<name>\` for declared injections; the property proxy is topology-sensitive, while strict \`ctx.get\` reads the global service store`
- `:7`（**反「手搭测试」**）：`**Product-visible plugins require a non-unit REAL-composition test.** Hand-built \`ctx.plugin(...)\` suites are insufficient. Boot test-only \`cordis.yml\` through the Loader and app/process; mock only external services or nondeterministic inputs and assert model-visible, durable, or user-visible output. Keep opt-ins out of shipped defaults.`
- `:9`（**一个异步操作一个生命周期控制器**）：`**Represent one asynchronous operation with one lifecycle controller or transaction.** Separate readiness, cancellation, disposal, reservation, or sentinel state requires an independent owner or settlement point; otherwise fold it while preserving rollback, callback containment, and quiescence.`
- `:14`（**决策要在做决策的那个操作里执行**，反 façade）：`**Enforce a decision in the operation that makes it.** Schema omission, prompt filtering, facades, wrappers, and listener order are not enforcement when direct or alternate callers can bypass them; test denial through the executor.`
- `:15`：`**Publish state only at its commit point.** Emit each notification and update derived state only after the operation succeeds; derive caches, prompts, UI echoes, replay, and query views from one authoritative source.`
- `:16`：`**Apply bounds to the complete result.** Enforce byte, token, item, and time limits where the complete emitted or retained value, including wrappers and metadata, is known; test tiny and exact limits, oversized single chunks, and multibyte byte limits.`
- `:18`（**测试不得只在单独跑时通过**）：`**Specs run concurrently** in forked workers beside other gate processes. Own each acquired port, path, and child process through teardown; **a spec that passes only when run alone is a defect in the spec**`
- `:13`（**模型视角写契约**）：`**Write model-facing contracts from the model's perspective.** Prompts, tool schemas, results, and diagnostics contain only task-relevant concepts, not UI, transport, or implementation vocabulary.`

---

## 5. 根 `AGENTS.md`（实测 1949 词）—— 操作层面的硬规则

实测词数 **1949**（与用户所述完全一致），预算上限 1950。**注意：1949/1950 意味着只剩 1 词余量。**

### 5.1 空 catch 规则 —— 逐字证实（`AGENTS.md:148`）

> - **An empty `catch` names the error** and why; keep its `try` to one statement.

### 5.2 注释规则（对应「obvious-fact comments」）—— 逐字证实（`AGENTS.md:149`）

> - **Keep comments local.** Do not restate code, expand unrelated comments, or explain distant behavior without local need ([rationale](.agents/notes/implemented/process/2026-08-09-concrete-prose-names-actors-and-recorded-facts.md)).

更完整的一段在 `AGENTS.md:172`（**这是对「obvious-fact comments」最直接的禁令**）：

> Comments and docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms. Do not use metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether a more exact term names the subject: write `response fields`, `JSON validation`, or `ESM exports` instead of `response shape`, `validation boundary`, or `module shape`. Keep `contract` for preconditions, postconditions, invariants, compatibility promises, and other obligations that callers, callees, implementers, providers, producers, or consumers rely on. Keep a literal process, wire, security, transaction, or lifecycle boundary. **Do not narrate control flow or tests, preserve review history, or restate code.** Keep behavior, failure, timing, ownership, and safe-use facts; link the rationale.

### 5.3 「Registrations are effects」—— 逐字证实（`AGENTS.md:131`）

> - **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.

### 5.4 force-push 政策 —— 逐字证实（`AGENTS.md:159`）

> - **Choose PR history deliberately.** Split independent changes and fix the introducing PR before propagation. Standalone/stack branches may merge-forward or rebase. **Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`**; preserve an in-progress merge-forward checkpoint before taking a newer base ([rationale](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)).

### 5.5 「Tests describe behavior」—— 逐字证实（`AGENTS.md:152`）

> - **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in the PR.

**注意用户原话是「tests describe behavior」——逐字正确，但完整句是 "Tests describe behavior, not correctness."，后半句才是真正的观点所在。**

### 5.6 其他操作层硬规则（值得引用）

- `AGENTS.md:132`（**「空不变式安装器」非法**）：`- **Runtime invariants assert owned relationships.** Publish \`./invariant\` only when independent observations can diverge. Otherwise omit its source and wiring and record why in its README; empty installers and checks of service presence, plugin metadata, effects, or fixed examples are invalid`
- `AGENTS.md:136`（**waterfall 必须 next()**）：`- **Waterfall listeners MUST call \`next()\`** to delegate; returning without it short-circuits the chain`
- `AGENTS.md:137`（**本仓库最锋利的一条不变式**）：`- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.`
- `AGENTS.md:138`：`- **Plugins, not loop changes**: new behavior goes on documented extension points; changing \`agent-loop\` requires updating docs/architecture.md.`
- `AGENTS.md:141`（**反 `?? default`**）：`- **Explicit > implicit at package boundaries**: defaulting is an explicit \`resolve(request): Spec\` step in the owning implementation, never a hidden \`?? default\` inside \`run()\` (the \`dsh-shell\` request/spec split is the template).`
- `AGENTS.md:142`（**反硬编码可调项**）：`- **No hardcoded tunables in plugins**: deployment-varying choices are validated \`Config\` fields changeable from cordis.yml; a \`DEFAULT_*\` constant or test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed.`
- `AGENTS.md:143`：`- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.`
- `AGENTS.md:145`（**反类型边界冗余校验**）：`- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.`
- `AGENTS.md:146`：`- **No new assertions to \`unknown\`** (\`as unknown\` or \`<unknown>\`). Preserve or reduce the exact legacy baseline; use typed values or validation for replacements`
- `AGENTS.md:147`（**源平面/产物平面不得混用**）：`- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig \`paths\` to \`src\` and pass on a clean tree; gates consuming built \`lib/\` declare that dependency`
- `AGENTS.md:150`：`- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.`
- `AGENTS.md:153`：`- **Create Agent Notes only for durable decision rationale;** mechanical/local edits are exempt, including local UI changes. Archived notes are frozen: never edit or treat them as current authority`
- `AGENTS.md:154`：`- **Client UI copy is locale-owned.** Route product text through typed dictionaries and \`t\` or localized primitive props; \`verify-client-ui-i18n\` rejects hardcoded copy`
- `AGENTS.md:155`（**快照策略**）：`- **Testing policy** — [docs/testing.md](docs/testing.md). Every non-trivial model- or product-user-visible change updates a keyless recorded-session snapshot; ... **Fixtures replay on macOS/Linux; fix fixtures, not normalizers.**`

---

## 6. `docs/postmortem/` —— 全部 4 篇

### 6.0 postmortem 体裁定义（`docs/postmortem/README.md`）

`README.md`（无行号，全文 18 行；关键段）：

> Incident write-ups: a bug reached a place it shouldn't have (a real user, a merged PR, a release), and the interesting part is ***why our process let it through***, not just the one-line fix.
>
> A post-mortem is **NOT** an [Agent Note] (which records a deliberate design decision and its rejected alternatives, or proposes future work). It is a backward-looking record of a failure: what broke, the mechanism, why every safety net missed it, and the concrete guardrails added so the same class of bug fails loudly next time.
>
> Write one when a bug is **subtle** (the mechanism is non-obvious and a careful engineer would re-derive it the hard way), **systemic** (the reason it escaped is a gap in tests/tooling/conventions, not a one-off typo), and **costly to rediscover** (it cost real debugging time, and would cost it again).

**三条件（subtle / systemic / costly to rediscover）是写入门槛**，且明确与 Agent Note 划清界限。

> Every post-mortem opens with an **Executive summary**: one short paragraph a busy reader can absorb in thirty seconds

### 6.1 Postmortem 0001 — ACP `export default` 掉 `inject`

**状态行**（`0001-acp-default-export-drops-inject.md:5`）：`Status: resolved (fix in PR #41 \`feat/acp-2-bridge\`)`

**(a) 事故** —— 用户说法**逐字证实**（`:9`）：

> Two integration mistakes broke ACP despite full unit coverage: a default export caused the Loader to discard `inject`, and a traced optional-service lookup failed across a shadow boundary. Hand-mounted tests bypassed both paths. The fixes added keyless real-Loader coverage and package rules for plugin exports and optional-service access.

`:15`（**178 绿测 + 100% 覆盖率的原始出处在 `## Summary` 而非 exec summary**）：

> The ACP server (`dsh --profile acp`, `@deepseek-ai/dsh-acp`) crashed the instant a real editor (Zed) connected: the first `session/new` request returned `Internal error: cannot get property "agents" without inject`, and `session/load` returned the same for `sessionPersistence`. **The bridge was completely non-functional in production despite 178 green unit tests and 100% line coverage.** Two independent bugs were hiding behind the same error string, and the test suite missed both for the same reason: every test mounted the plugin through a path that did not exercise how it actually loads or how its services actually resolve.

**用户说法「178 green tests + 100% coverage but crashed on real Zed connect」——完全属实。**

**(b) 根因** —— 两个独立 bug：`:9` 的 `default export caused the Loader to discard inject`；以及 shadow boundary 下的可选服务查找。`:17`（Impact）：

> The ACP server could not create or load a single session — the two RPCs an editor calls first. Anyone wiring the agent into Zed got an immediate hard failure. No data loss (nothing persisted before the crash); the cost was entirely "the feature does not work" plus the debugging time to find out why, twice.

**(c) Guardrails added**（`:exit` 段，逐字）：

> - **Removed `export default apply`** (`packages/acp/acp/src/index.ts`) — the Bug #1 fix.
> - **`AgentLoop.resume` reads `this.ctx.get('sessionPersistence')`** (`packages/core/agent-loop/src/index.ts`) — the Bug #2 fix, with a comment explaining the shadow-walk trap.
> - **No-key `session/new` e2e over real stdio** (`apps/cli/tests/profiles/acp/tests/acp.e2e.ts`): boots the profile as a subprocess through the real Loader and asserts `session/new` resolves. This fails loudly on Bug #1 with no API key. Verified it fails when `export default apply` is restored.
> - **`TSX_TSCONFIG_PATH` in the e2e spawn**: the subprocess runs from a temp cwd, where tsx cannot find the repo-root tsconfig `paths` map by searching upward — so dsh-* imports silently fell back to built `lib/`. Pointing tsx at the repo tsconfig makes resolution cwd-independent and ensures the test runs *source*, not a possibly-stale build.
> - **[docs/testing.md](../testing.md) rule**: "test the real entry path", line coverage is not behavior coverage — codifies the lesson for every future plugin.

**(d) Lessons**（`## Lessons`，逐字）：

> - A namespace plugin and a default export are mutually exclusive under the cordis Loader. Pick the namespace form (`name`/`inject`/`Config`/`apply`) and do not add `export default` — `unwrapExports` will discard the namespace.
> - For a service a plugin reads opportunistically but does NOT declare in `static inject`, use `ctx.get(name)`, never `ctx.<name>`. The property proxy resolves by an ancestor-only fiber walk that fails through a foreign shadow; `ctx.get(name)` is the topology-independent lookup (and strict by default — an inactive backend reads as `undefined` rather than being handed back mid-teardown).
> - **A test that constructs a plugin by hand cannot validate how the plugin loads.** At least one test must drive the real Loader/export path end-to-end. When the headline operation does not call the model, that test needs no API key — so it belongs in CI, not behind a key gate.
> - **Trust the trace, not the theory.** The elegant shadow explanation was real but was the *second* bug; the *first* was a one-line export mistake that a fiber-walk `console.error` found in minutes after hours of plausible-but-wrong reasoning.

**最终产出（该事故的机械转化）**：`packages/AGENTS.md:5` 与 `:6` 两条规则（§4.5 已引），及 `docs/testing.md` 的 "test the real entry path"。

### 6.2 Postmortem 0002 — `!!js` 只作用于 config，快照把 `UNKNOWN_TOOL` 当合法

**状态行**（`0002-js-expression-disabled-filesystem-tools.md:5`）：`Status: resolved`

**(a) 事故（Executive summary，逐字，`:9`）**：

> The ACP example attempted to enable filesystem plugins conditionally with `disabled: !!js ...`, but Cordis evaluates JavaScript expressions only inside plugin `config`. The raw expression object was truthy, so the filesystem stack was always disabled. Snapshot refresh then accepted `UNKNOWN_TOOL` results as new expected outputs. The fix uses an explicit filesystem overlay and adds static-config and snapshot-result guards.

**用户的说法「`!!js` only applied to config not disabled / snapshot treated UNKNOWN_TOOL as valid」——完全属实。**

`:13-15`（Summary，机制）：

> The default ACP composition is intentionally bash-only because its sandbox cannot confine in-process filesystem providers. Filesystem snapshot scenarios still need `read`, `write`, and `edit`, so their plugins were placed in the default `cordis.yml` with a `disabled` expression intended to enable them only for full-access launches and snapshots.
>
> Cordis Include parsed each `!!js` scalar into an expression object. The Loader recursively interpolated the plugin's `config`, but consumed entry metadata such as `disabled` directly. **Every filesystem entry therefore saw a truthy object and remained disabled in every mode.**

**(b) 根因（`## Root cause`，逐字，`:32-34`）**：

> The implementation assumed `!!js` applied to an entire Loader entry. **It applies only to `entry.options.config`**: `Entry._resolveConfig()` interpolates that field, while `Entry.disabled` tests `entry.options.disabled` without interpolation. The YAML tag was syntactically valid, so loading produced no diagnostic.
>
> The snapshot framework treated any deterministic transcript as valid behavior. Header pins verified the composed tool schemas, but the filesystem scenarios shared a pin from the default composition and therefore did not independently prove that their required tools were registered. Refresh rewrote the expected stdout and session logs before any semantic assertion rejected missing tools.

**事故的影响范围（`:19`）——「快照套件通过了，但它证明的是回归的确定性重放，而不是文件系统行为」**：

> Seven filesystem scenarios and the mixed workspace-edit scenario called tools that were absent from the registry. Their structured session logs carried `ToolNotFoundError` with code `UNKNOWN_TOOL`, while stdout rendered generic failed tool cards. **The snapshot suite passed because both outputs matched the refreshed fixtures; it proved deterministic replay of the regression rather than successful filesystem behavior.**

**一个重要的「幸好」**（`:21`）：

> The live confined default did not gain unintended filesystem access. **A naive interpolation fix would have created that risk**: permission presets update bash sandbox and approval state at runtime, but cannot mount, unmount, or confine the filesystem stack.

**(c) Guardrails added（`:36-41`，逐字）**：

> - Filesystem scenarios boot `fs.cordis.yml`, an explicit fixed full-access overlay with a paired replay config and its own request-header class.
> - [`AGENTS.md`](../../AGENTS.md) and the [Cordis primer](../cordis-primer.md#loader-configuration) state that `!!js` is valid under plugin `config` and entry `disabled`; other entry metadata stays literal, so conditional composition uses overlays.
> - `verify-cordis-config` parses repository Cordis YAML and **rejects expression nodes in Loader entry metadata**, including include patches and inserted entries.
> - `dsh-session-snapshot` rejects structured `UNKNOWN_TOOL` results in fresh runs and committed session fixtures before they can be committed as expected outputs.

**(d) Lessons（`:44-47`，逐字）**：

> - A syntactically accepted configuration value is not necessarily evaluated at that location; document and verify exactly which fields are interpolated.
> - **A snapshot refresh is fixture production, not correctness review.** Semantic impossibilities such as a missing registered tool need assertions independent of the expected output.
> - Permission controls must describe only the capabilities they actually govern. Composition-time filesystem access cannot follow a runtime bash-only preset safely.

### 6.3 Postmortem 0003 — Web agent 验证了「替换服务器」而不是它正在用的 GUI

**状态行**（`0003-web-agent-gui-feedback-loop.md:5`）：`Status: resolved`

**(a) 事故（Executive summary，逐字，`:9`）**：

> A Web agent changed the GUI source but did not know which URL and process hosted its session. It delegated acceptance to the user, then treated a bare Vite HTTP 200 as success despite a missing `window.__DSH_BOOT__` white screen, and finally **validated a replacement `dsh web` server on another port while the original page had already picked up rebuilt artifacts**. The fix makes the current URL and runtime mode model-visible and shell-queryable, rejects standalone Vite before listen, and verifies production refresh and development HMR against external state.

**用户说法「validated a REPLACEMENT server on another port instead of the GUI it was actually using」——逐字证实。**

`:13-17`（Summary，极有引用价值）：

> The session ran inside the DeepSeek Harness Web GUI at port 3081 while its selected Workspace was an empty `test/` directory. The model request named neither the GUI nor its source checkout, URL, process, or update mode. Repository affordances exposed `apps/web` with a Vite development script, while the full browser composition lived behind `dsh web`.
>
> **The resulting actions were individually plausible but did not share one acceptance target. A source edit, a successful build, an HTTP 200, an injected boot manifest, and the user's existing page were treated as interchangeable facts.**

**取证方式本身值得引用**（`:17`）：

> The evidence source is the persisted event log for `session-3eb796c2-5159-4686-affe-df8719f6f987`, whose header records cwd `/Users/tn.shen/Documents/deepseek-harness-gui-master/test`. Its initial request header is sequence 6; the user-facing handoff, bare-Vite launch, replacement-host launch, boot-manifest probe, and first 3081 process probe are sequences 30939, 31865, 34309, 34441, and 34681 respectively. **The timeline below follows those events rather than reconstructing intent from the later report.**

**(b) 根因** → 三条独立的归因错误（"did not share one acceptance target"）＋ 运行前提未对模型可见（"startup mode is application context, not tribal knowledge"）。

**(c) Guardrails added（逐字）**：

> - The Web launcher publishes the canonical loopback URL in the logged `app:web-surface` prompt section and the managed `$DSH_WEB_URL` environment.
> - Production guidance requires rebuilding artifacts and verifying the existing URL after refresh. Development guidance explains that the HMR receiver is always on; `pnpm run dev:web` in the same checkout rebuilds client-plugin bundles for refresh-free reload, while shell and plain-package changes still require refresh.
> - `apps/web` standalone Vite serve mode rejects during configuration. Its subprocess test proves natural exit and instruments `Server.listen()` so a transient bind cannot pass unnoticed.
> - Layered real-path tests cover the CLI request, exact production/development prompts, shell runtime facts, same-port static replacement, source watcher rebuild, host stat polling, and browser HMR under an unchanged page identity.
> - PR evidence preserves screenshots from the original 3081 session and a real-model before/after GUI run; **external browser, HTTP, process, and session-log observations carry acceptance**.

**(d) Lessons（逐字）**：

> - The agent must know hidden runtime prerequisites before it can guide the user; **startup mode is application context, not tribal knowledge**.
> - **HTTP readiness, build success, and a boot manifest are different facts.** Acceptance names the exact origin and externally observes the requested change there.
> - **A replacement service cannot prove that an existing page changed.** Long-running processes use managed task lifecycles when they are actually requested.
> - A regression test must be able to fail for the reported mechanism. Process timeout is not equivalent to fail-fast, and post-exit port availability does not prove the port was never bound.

### 6.4 Postmortem 0004 — Landlock 提示性 stderr 被误判为子进程致命失败

**状态行**（`0004-landlock-partial-notice-misclassified-child-failures.md:5`）：`Status: resolved`

**(a) 事故（Executive summary，逐字，`:9`）**：

> On kernels with an older Landlock ABI, the launcher prints a benign partial-enforcement notice before executing every child. The harness treated that shared `landlock-run:` prefix plus any nonzero child exit as launcher failure, so **ordinary outcomes such as ripgrep's exit 1 for no matches surfaced as `SANDBOX_UNAVAILABLE`**; the then-bash-backed filesystem search also hid that structured error behind `SEARCH_FAILED`. Broad signature rules and missing partial-ABI composition coverage let the defect through. Runner classification now requires status-gated fatal evidence after exact informational exclusions, and an assembled keyless scenario pins the surviving bash path. Filesystem search uses packaged ripgrep through the subprocess seam and does not cross sandboxed bash.

**用户说法「Landlock informational stderr misclassified as fatal child failure」——完全属实。**

`:13-15`（Summary，契约细节）：

> The native launcher contract distinguishes two kinds of stderr lines. A partially enforcing kernel prints exactly `landlock-run: partial enforcement (older Landlock ABI)` and continues into the child. A launcher failure prints another `landlock-run:` line and exits 125 without executing the child.
>
> The harness represented both with one case-insensitive `landlock-run: ` substring. Its consumer classified any nonzero exit carrying that substring as runner failure. **The child's status was therefore attached to the launcher's informational line: `false`, ripgrep's no-match exit 1, invalid-pattern exit 2, and even a child-selected exit 125 could be blamed on the sandbox despite successful confinement and execution.**

**(b) 根因（`## Root cause`，逐字，`:35-39`）**：

> The public sandbox result type could express only a bag of substrings. It could not state that Landlock failure requires exit 125, that evidence must occur within one fatal line, or that one exact line under the same prefix is informational. **The boolean consumer consequently joined unrelated facts from different processes and selected the first stderr line for detail even when a later line was the fatal evidence.**
>
> The test matrix mirrored that representation. Fake providers emitted either no runner line or an unambiguously fatal prefix; **they never emitted a benign runner line before a child-controlled nonzero exit.** Real Landlock coverage depended on the host ABI, so full-ABI hosts could not exercise the notice.

**安全影响的诚实界定**（`:23`，极适合引用）：

> The defect did not weaken confinement or run a command unconfined. **Its security effect was availability and diagnostic integrity: a valid confined result was rejected or mislabeled.**

**(c) Guardrails added（逐字，`:42-48`）**：

> - [`RunnerFailureRule`](../subsystems/sandbox.md#wrapped-argv-and-classification-dialects) carries optional allowed exit codes, case-insensitive per-line fatal signatures, and case-insensitive exact informational-line exclusions.
> - [`dsh-sandbox-local`](../../packages/sandbox/sandbox-local/) maps Landlock to exit 125 plus a non-notice `landlock-run:` line while bwrap, Seatbelt, and custom runners remain signature-only.
> - [`dsh-bash-sandbox`](../../packages/shell/bash-sandbox/) directly spawns the provider argv, so a pre-start rejection uses the spawn-error channel instead of localized shell diagnostics. Settled foreground and background execution share one evidence-returning classifier; **fatal evidence outranks denial**, and foreground errors report the matched fatal line without changing captured stderr.
> - [`dsh-tool-fs-search`](../../packages/fs/tool-fs-search/) uses packaged ripgrep through `ctx.subprocess` and remains outside the sandboxed bash seam.
> - The native-boundary regression cases live in [`partial-landlock.spec.ts`](../../packages/shell/bash-sandbox/tests/partial-landlock.spec.ts), including informational notices, fatal evidence, and foreground/background classification.
> - The assembled product path is pinned by the [`partial-landlock` snapshot composition](../../snapshots/session/partial-landlock-child-failure/cordis.snapshot.yml), independently of filesystem-search implementation choices.

**(d) Lessons（逐字，`:51-55`）**：

> - **Process attribution requires a conjunction of independent evidence; a shared prefix is not a protocol.**
> - Informational and fatal diagnostics can share a namespace, so exclusions must be exact and narrow while unknown fatal lines stay fail-closed.
> - **An adapter must preserve structured failures owned by the seam below it instead of replacing them with its own nearest generic category.**
> - Platform-dependent behavior needs a deterministic fake at the native boundary plus one assembled product path; **a self-skipping real-kernel test cannot carry that regression alone**.

### 6.5 四篇 postmortem 的共性（文章可用的宏观结论）

1. **四篇全部是「测试全绿但真实路径失效」**——0001（178 绿测/100% 覆盖）、0002（快照套件通过，但通过的是「回归的确定性重放」）、0003（构建成功 + HTTP 200 但白屏）、0004（真内核测试自跳过）。**这是 dsh 治理体系最核心的教训主题。**
2. **四篇都产出了机械门禁**，而不是只写「以后注意」：0001 → `packages/AGENTS.md:5,6` + testing.md 真入口规则；0002 → `verify-cordis-config` 元数据静态检查 + snapshot 拒 `UNKNOWN_TOOL`；0003 → launcher 发布 `$DSH_WEB_URL` + `apps/web` standalone Vite 拒绝启动；0004 → `RunnerFailureRule` 结构化规则 + `partial-landlock.spec.ts`。
3. **四篇都把「谁来验收」写成外部可观测量**（0003 的 Guardrails 末条最明确：`external browser, HTTP, process, and session-log observations carry acceptance`）。

---

## 7. 质量门决策记录 与 **「ADR 0007」说法的真伪**

### 7.1 该 note 的确切身份

`.agents/notes/implemented/process/2026-06-11-quality-gates.md:1`：

> `# Agent Note: Mechanical quality gates over prose guidelines`

**标题与用户所述完全一致。它的身份是「一篇 Agent Note」，不是任何编号的 ADR。路径为 `implemented/process/`，无编号。**

### 7.2 Problem 段 —— 用户引文逐字证实

`:9`（`## Problem` 段，逐字）：

> This codebase is developed primarily by coding agents. Agents follow enforced gates far more reliably than prose conventions, and "a lot of work" is not a cost argument when agents do the labor. Early evidence: tests that didn't typecheck shipped (vitest doesn't typecheck) and were only caught by a review.

**用户引文「This codebase is developed primarily by coding agents. Agents follow enforced gates far more reliably than prose conventions, and 'a lot of work' is not a cost argument when agents do the labor.」——逐字命中，一字不差。**

### 7.3 该 note 已被部分取代（**文章若引用需注意**）

`:7`（**note 顶部的前置声明**）：

> The hook/CI symmetry in this record is superseded by [Fast local Git hooks](../../archived/process/2026-07-22-fast-local-git-hooks.md); CI remains the exhaustive enforcement path.

且该 note 尾部（`:30`）带有祖父注释：

> `<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->`

——说明它是 2026-07-05 格式统一**之前**写的（note 日期 2026-06-11），因此**没有 `## Alternatives considered`**，由门禁的祖父条款豁免。

### 7.4 Decision 段要点（`:15-22`）

`：15`（**最核心的一句**）：

> Every mechanically checkable AGENTS.md promise gets a command that exits non-zero. CI invokes the exhaustive set, while Git hooks reserve their latency budget for cheap local defects:

具体门禁清单（逐条，`:17-22`）包括：Max-strict TypeScript（`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）、Oxlint 类型感知规则 + @stylistic + SonarJS、jscpd 跨文件克隆检测、**Per-file 100% coverage on `packages/*/*/src` (v8)**、publint、workspace constraints、NodeNext consumer typecheck、lefthook pre-commit/pre-push。

`：20`（**100% 覆盖的政策与其「逃生阀」**）：

> Per-file 100% coverage on `packages/*/*/src` (v8); **unreachable defensive guards carry `/* v8 ignore */ ` with stated reasons instead of deletion.**

`：28`（**Consequences 里最诚实的一条自我批评**，极适合引用）：

> **100%-coverage pressure can produce assertion-free tests** — mutation testing is the planned counterweight (see [the mutation-testing proposal](../../proposed/testing/2026-06-11-mutation-testing.md)).

`：26`：

> Conventions survive agent turnover; cheap commit/push defects fail locally and exhaustive violations fail in CI.

`：27`：

> **The gates themselves are code to maintain; config changes are reviewed like any change.**

### 7.5 ★ 「ADR」编号惯例是否存在？—— **不存在。确认为不实说法。**

**全仓库 grep（限制在 `.agents/notes/` 与 `docs/`）命中 "ADR" 共 3 处，逐条列出**：

```
.agents/notes/implemented/process/2026-07-05-uniform-agent-note-format.md:9
.agents/notes/implemented/process/2026-07-05-uniform-agent-note-format.zh.md:9
（第 3 处在 scripts/verify-agent-note-format.ts:19 的 LEGACY_MARKERS 常量内，属源码非 md）
```

**唯一实质命中的原文**（`implemented/process/2026-07-05-uniform-agent-note-format.md:9`）：

> Agent Note paths encoded lifecycle and class, but file contents still mixed headings, status formats, **ADR** and proposal templates, and proposal-era sections in implemented records. Authors copied whichever neighbor they found, and lifecycle moves could skip the required rewrite because no gate enforced an in-file contract.

**这不是在建立 ADR 惯例，恰恰相反——它是在描述「过去混用 ADR 模板与提案模板」这一被修复的混乱状态。** 对应地，门禁把历史的 ADR 痕迹当作**债务标记列入黑名单**（`scripts/verify-agent-note-format.ts:19`）：

```ts
const LEGACY_MARKERS = ['XXX: legacy ADR/RFC body format', 'XXX: legacy ADR/Agent Note body format']
```

发现即失败：`'carries the retired legacy-format debt marker'`。

**结论（可写进文章，且是一个很好的反转点）**：
- dsh **没有任何 ADR 编号体系**；不存在 "ADR 0007"，也不存在任何 "ADR N"。
- 该仓库的决策记录体是 **Agent Note**，**显式拒绝编号**（无中心索引：`README.md:19` 明令 `Do not add a centralized INDEX.md`）。
- 替代编号的是**路径编码**：`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`，加上**相对 markdown 链接**做交叉引用（`README.md:17`：`never bare prose or numbers`）。
- 更讽刺的是：**"ADR" 在本仓库里是一个被明令禁止复活的词**（`LEGACY_MARKERS` 黑名单）。
- 把 "quality-gates" 那篇称为 **"ADR 0007"** 是**blog 的作者把外部惯例（常见于其他仓库）投射到了 dsh 上**——dsh 的命名法中它就叫 *Agent Note: Mechanical quality gates over prose guidelines*，路径 `implemented/process/2026-06-11-quality-gates.md`。
- **另注**：`docs/postmortem/README.md` 确实提过一次 "ADRs"，但那是列举「postmortem 应当链接的 guardrail 类型」时的泛称：

> Link the guardrails (tests, AGENTS.md rules, ADRs) the post-mortem motivated.

——这是**通用术语的泛指**，不构成编号惯例，且与 Agent Notes 体系并存（同一 README 上一段刚明确 postmortem **不是** Agent Note）。

---

## 8. 词数预算 与 doc slop 清单

### 8.1 预算门禁真实存在，但数字与用户认知不符

**见 §3.5 完整证据。核心事实：**

| 文件 | 实际词数 | 预算上限 |
|---|---|---|
| `AGENTS.md`（根） | **1949** | **1950**（**不是 1600**） |
| `docs/AGENTS.md` | 1313 | 1320 |
| `docs/architecture.md` | 2410 | 2410 |
| `docs/cordis-primer.md` | 600 | 600 |
| `docs/defensive-patterns.md` | 518 | 550 |
| `docs/testing.md` | 1349 | 1350 |
| `packages/AGENTS.md` | **717** | 750 |
| `packages/README.md` | 975 | 994 |

**blog 的「≤1600 词预算」在清单中不存在。** 用户实测的 1949 与 717 两个数字**均精确正确**。

**关于「预算实际上限制什么」的准确表述**：
- 门禁名：`verify-doc-budgets`
- 清单：`scripts/doc-budgets.manifest.json`（**只 8 个 standing doc**）
- 计数法：`text.split(/\s+/).filter(Boolean).length`，即 `wc -w` 口径
- 棘轮：`Ceilings ratchet down with at least 5% headroom`
- 涨额：`raising one requires the justification defined in docs/AGENTS.md`（PR 内论证）
- 违规动作：**不是「删内容」，而是 `relocate or condense`**——失败消息末尾直接指向 `See docs/AGENTS.md for the documentation standard and the relocation-first rule.`（**"relocation-first" 是这套预算哲学的关键词：先搬家，再压缩**）

### 8.2 slop 清单（逐字，`docs/AGENTS.md:60-72`）

`docs/AGENTS.md:60-62` 引导语：

> ## The slop checklist
>
> Hunt these in any doc; [dsh-doc](../.agents/skills/dsh-doc/SKILL.md) runs this list as an audit:

九条清单（逐字，`:64-72`）：

> - Duplicated rules: search a distinctive phrase; keep one home and link the rest.
> - History outside its permitted tier: state current facts and link the historical owner.
> - Implementation-status annotations in prose or diagrams ("implemented!", "future: …"). Status rots; the repo layout and package manifests carry it.
> - Hand-restated catalogs, JSDoc, or inventories of tests, packages, and status when source or a generator is authoritative.
> - Reasoning transcripts: step-by-step implementation narration, proof of obvious branches, test walkthroughs, or rejected local alternatives. Keep the resulting contract or durable rationale; delete the path used to derive it.
> - Rationale repeated beside sibling methods instead of once at the owning capability or helper.
> - Paragraph walls: one paragraph carrying several rules and parenthetical asides. Split it or demote the detail to its home.
> - Emphasis inflation: bold, CAPS, or "critically" everywhere means nothing stands out. Reserve emphasis for the clause that changes behavior.
> - Spec-speak in `implemented/` Agent Notes: "should", migration plans, acceptance checklists. An implemented Agent Note describes what is, per the [implemented-note instructions](../.agents/notes/implemented/AGENTS.md).

**第 9 条正是 `verify-agent-note-format.ts:74` 报错消息里那个 `(the slop checklist names why)` 的所指**，也对应 `BANNED_IMPLEMENTED` 正则。

配套的引用规则（`docs/AGENTS.md:76`）：

> Use relative Markdown links for current files and tags or PR numbers for historical references. `verify-md-links` checks local targets. [Reference validation](../scripts/verify-repository-references.ts) rejects actual commit identifiers and disallowed organization URLs in maintained files.

---

## 9. CoT 泄漏：`dsh-trim-cot-leakage` skill

路径：`.agents/skills/dsh-trim-cot-leakage/SKILL.md`（45 行，含 `references/examples.md` 与 `references/recall-batteries.md`）。**这是 skill，不是 `verify-*` 脚本**（门禁只在其工作流第 5 步被调用作验证）。

### 9.1 front-matter 的 description（`:3`，**泄漏分类的官方定义处**）

> `description: Use when auditing or fixing prose that reads like a leaked reasoning transcript — dead design-session citations such as (decision N), audit item codes, or §N of uncommitted drafts; change narration such as "used to", "no longer", "this cut"; stack or review vantage ("a later PR in this stack", "rejected in review"); reviewer-addressed justifications; control-flow narration; or hedged planning residue in comments, JSDoc, docs, or Agent Notes.`

### 9.2 泄漏的定义（`:8`，逐字）

> **Chain-of-thought leakage is prose whose vantage is the authoring session rather than the repository: it cites artifacts only that session could see, narrates the change instead of the state, or argues with a reviewer who has left.** The fix is never deletion alone when a passage carries factual clauses — restate each so it stands at HEAD, then delete the transcript around it; a passage carrying none (an audit code, control-flow narration) is deleted outright.

### 9.3 ★ 决策测试（`## The one test`，`:12`，逐字）

> For every suspect passage ask: **could a reader at HEAD, with no access to any session transcript, PR thread, or uncommitted draft, resolve every reference and verify every claim?** If no, restate the surviving facts from the repository's vantage and delete the rest. If yes, it is not leakage, however historical it sounds — but resolvability only clears this skill's bar: on current-state surfaces (READMEs, docs, JSDoc) a resolvable change story is still change narration, and class 3 routes it to its sanctioned home.

### 9.4 八类泄漏分类学（`## Taxonomy`，`:16-23`，逐字）

> 1. **Dead design-session citations** — `(decision 7)`, `(audit C2)`, `design §4.7`, `plan §1.4`, phase labels (`T4`, `W3`, `P-I`), "the design ledger", "(B ruling)". If the decision has a committed owner, cite it by name and path; otherwise delete the citation and restate its factual clause to stand alone.
> 2. **Stack and PR vantage** — "a later PR in this stack", "this PR adds", "the previous commit". State the shipped mechanism or the extension point; deferred work moves to a `TODO` marker or an issue reference.
> 3. **Change narration and version stamps** — "used to", "no longer", "the old X", and indexical stamps ("v1", "this cut", "today", "now" contrasting with a past state). State the present behavior; a fixed regression becomes a present-tense counterfactual ("without X, Y happens"), never repo history ("used to Y").
> 4. **Review choreography** — "Rejected in review:", "the reviewer confirmed", draft ordinals ("v5 of this note"), round attributions. Keep the surviving decision and rationale as plain fact; delete who said it when.
> 5. **Reviewer-addressed justification** — "the cast is safe — it simply…", "this is correct because…". A comment arguing its own correctness addresses a reviewer, not a maintainer. State the invariant that makes the code safe, or delete the comment if the code shows it.
> 6. **Restatement and derivation transcripts** — control-flow narration ("first we X, then we Y"), test walkthroughs, proofs of obvious branches. Delete; keep only a non-obvious contract or invariant.
> 7. **Hedges and planning residue** — "probably fine for now", "should be enough", deferrals with no marker. Promote to `TODO`/`FIXME` or restate as the actual bound; delete the hedge.
> 8. **Authoring-language slips** — untranslated working-language fragments (端, 设计稿, `---- 私有 ----` separators) in prose whose language is otherwise English, or the reverse in a zh counterpart. Translate or delete.

### 9.5 「什么不是泄漏」的 keep 规则（`## What is not leakage`，`:25-37`）

`：27`（**这条 meta 规则本身极适合引用**）：

> **Unaided citation passes fail in both directions by deleting durable references and keeping dead ones.** Apply these keep rules as written

保留项（逐字摘要，`:29-37`）：issue 引用（`#1470`、`TODO(name):`）／Agent Notes 与 postmortems **内部**的已合并 PR 与 issue 引用（`sanctioned evidence`）／抑制理由（`oxlint-disable … -- reason`、覆盖忽略理由、空 catch 说明**是必需散文，绝不能删**）／反事实现在时回归钉（`without X, Y happens`）／实测边界（`(measured: 512 nests ≈ 0.15s)`——`the evidence word "measured" is load-bearing`）／运行时新旧状态／note 变更史章节内的历史阶段名／按设计在仓外解析的外部引用（RFC 9110 §10.1.5、Figma 帧名——`the §-ban covers uncommitted internal drafts, not external standards`）／项目口吻与体裁形式（`"we" as project voice; a note's Alternatives-considered section`）。

### 9.6 工作流与「探针不是定义」（`:42`，极适合引用）

> Audit read-only first: run the [recall batteries](references/recall-batteries.md) (with `--hidden` so `.agents/` is searched), calibrating each probe against a known positive and a near-miss negative before trusting its output, then judge every hit semantically. **The batteries are probes, not the definition — each review round of the original purge found cases the batteries missed, so also read the densest prose in scope (module JSDoc, READMEs, Agent Notes) without a pattern in hand.**

`:45`（**验证收尾，列出被调用的门禁**）：

> Verify: re-run the batteries expecting only sanctioned keeps, this skill's own directory, and the owning note's quoted evidence; confirm every remaining citation resolves at HEAD; run the gates for touched surfaces (`doc-sync` for docs, `verify-type-equiv`, `verify-translation-pairing`).

`:44`（**删除前的保护**）：

> Before deleting anything, enumerate the passage's propositions (prose-standard) and check the [overcorrection traps](references/examples.md#overcorrection-traps): **trims that flip an obligation into an endorsement, promote a hypothetical to a shipped feature, delete a true fact, or drop the evidence source.**

---

## 10. `doc-sync` 聚合门 与 本地 hooks 为何保持窄

### 10.1 `doc-sync` 是什么

`package.json:189`（注意同处还有 `doc-quick`）：

```json
"doc-sync": "tsx scripts/run-gates.ts doc-sync",
```

`doc-sync` 是 `scripts/run-gates.ts` 里的一个**聚合模式（aggregate）**。合法模式清单见 `scripts/run-gates.ts:159`：

> `run-gates: expected mode ci-primary | ci-linux-primary | ci-static | ci-lint-contracts-ready | ci-coverage | ci-bench | ci-snapshot | ci-artifacts | ci-consumers | ci-windows-blocking | ci-windows-complete | ci-windows-observational-ready | node-compat | check-all | hygiene | doc-sync | doc-quick, got ${JSON.stringify(raw)}.`

**`doc-quick` 是「无需构建的文档聚合」**（`scripts/run-gates.ts:57` 注释）：

> ```ts
> /** Include this leaf in the build-free documentation aggregate. */
> quick?: boolean
> ```

即：**每个门禁用 `quick: true` 标记自己是否属于免构建的快速文档门**。

### 10.2 `doc-sync` 实际包含的门禁（实测 `quick: true` 成员）

```
markdown-links            verify-md-links
type-equivalence          verify-type-equiv
translation-pairing       verify-translation-pairing
markdown-wrap             verify-md-wrap
dependency-catalog        verify-dependency-catalog
persistence-formats       verify-persistence-formats
public-repository-links   verify-public-repository-links
repository-references     verify-repository-references
concrete-terms            verify-concrete-terms
doc-refs                  verify-doc-refs
package-readme-summaries  verify-package-readme-summaries
package-readme-model-experience  verify-package-readme-model-experience
agent-note-classification verify-agent-note-classification
agent-note-format         verify-agent-note-format          ← §1.4 的格式门
archived-agent-notes      verify-archived-agent-notes       ← §1.7 的冻结门
skill-invocation-metadata verify-skill-invocation-metadata
translation-prompt        verify-translation-prompt
doc-budgets               verify-doc-budgets                ← §3.5 的预算门
package-readme-limitations verify-package-readme-limitations
documentation standard tests（docs/AGENTS.md 的 spec）
documentation site checks
```

另有一批非 `quick`（重量级）成员同时属于 doc-sync，如 `docs-site-build`（documentation build）、`doc-graphs`（verify-doc-graphs）、`cordis-catalog`、`client-catalog`、`export-jsdoc`、`tool-catalog`、`config-catalog`、`persistence-catalog`、`persistence-changes`、`persistence-releases`、`session-format-catalog`、`subsystem-pages`、`package-paths`、`tsconfig-paths`、`config-source-ownership`、`plugin-packages`。

**要点：Agent Notes 的三个门禁（classification / format / archived）全部在 `doc-sync` 内，且全部标 `quick: true`——即「文档改了就该秒级跑」，不带构建负担。**

### 10.3 ★ Fast local Git hooks —— 为何 hooks 保持窄（**用户说法逐字证实**）

文件：`.agents/notes/archived/process/2026-07-22-fast-local-git-hooks.md`（注：**已归档**，`Status: implemented` + `Archived: 2026-09-04`，行 3-4）

**`## Problem`（`:10`，逐字，正是用户所问的推理）**：

> **An agent already runs the tests and checks that exercise its change**, while commit, push, and CI can each repeat increasingly broad subsets of the same work. A full pre-push suite therefore delays every publication, amplifies unrelated local flakes, and gives no new signal when CI immediately runs the exhaustive matrix again.

`：12`（**划出 hooks 的合理边界**）：

> Fast hooks still need to reject cheap, high-confidence defects before work leaves the machine. **Staged formatting, whitespace errors, missing vendored-source metadata, and repository type errors fit that boundary; unit suites, snapshots, documentation checks, builds, and package hygiene vary with the changed surface and do not.**

**`## Decision`（`:16`，逐字，hooks 的确切内容）**：

> [lefthook.yml](../../../../lefthook.yml) keeps both hooks as bounded local checkpoints. Pre-commit runs sequentially: a project-free [Oxlint](2026-07-29-oxlint-linter.md) profile validates changed JavaScript and TypeScript, applies safe fixes with a [bounded retry](2026-08-09-oxlint-only-fix-workflow.md), and re-stages them; `git diff --cached --check` rejects staged whitespace errors, and the vendor manifest guard checks vendored-source metadata. Pre-push runs `pnpm run typecheck`, which prepares the generated Host Typert contracts before the Client incremental typecheck.

`:18`（**明令 pre-commit 不做什么**）：

> **Pre-commit does not run type analysis, tests, snapshots, documentation checks, builds, hygiene, or the gate scheduler.** Pre-push adds only the Host contract build required by repository typecheck. The opt-in `check:all` package script selects the `check-all` scheduler inventory in [scripts/run-gates.ts](../../../../scripts/run-gates.ts) independently of the hooks; it is a contributor command, not an agent instruction.

`:20`（**分工的正面表述，核心金句候选**）：

> Agents inspect the outgoing diff and run the narrowest tests and checks that cover its behavior once. **CI owns exhaustive coverage, built-artifact checks, and the platform matrix.** A complete local rehearsal is reserved for an explicit request, CI diagnosis, or a repository-wide change that cannot be validated credibly by narrower evidence.

**`## Supersedes`（`:24`）—— 与 §7 的质量门 note 的关系**：

> This decision supersedes the local-hook portion of [Parallel pre-push gates](2026-07-06-parallel-pre-push-gates.md) and **the hook/CI symmetry in [Mechanical quality gates over prose guidelines](2026-06-11-quality-gates.md)**. Their CI scheduler, package-gate, and mechanical-enforcement decisions remain in force.

（**呼应 §7.3**：quality-gates note 顶部正是声明这一取代关系。）

**`## Alternatives considered`（`:28-31`，逐字，四个被否方案）**：

> - **Keep the full pre-push suite and optimize its scheduler** — preserves the earliest exhaustive signal but still repeats agent-selected evidence and CI, while unrelated failures continue blocking publication.
> - **Remove pre-push entirely** — makes pushes cheapest but loses the fast cross-file guarantee that TypeScript provides after several commits.
> - **Keep typecheck in pre-commit** — catches type errors earlier but charges every intermediate commit instead of one push; staged lint already covers the commit-local syntax and style boundary.
> - **Make staged lint check-only** — avoids hook-side mutation, but contributors intentionally retain the auto-fix workflow; Oxlint's bounded retry and Lefthook's `stage_fixed` preserve it without a separate formatter or duplicate `git add`.

**`## Consequences`（`:35`、`:37`，逐字）**：

> :35 — Normal commits take the project-free staged Oxlint fix-and-validate critical path, and warm pushes take the prepared incremental typecheck critical path. Contributors retain a one-command opt-in rehearsal without widening the hook critical paths or the agent-required validation set. **Hook latency is observed in development and PR evidence rather than enforced by a timing test whose result would depend on host load and cache state.**
>
> :37 — **Local publication no longer proves the exhaustive repository matrix. Agents must select relevant behavioral evidence, reviewers must evaluate whether that selection matches the diff, and CI supplies the comprehensive signal once per pushed revision.**

**用户说法「agents already ran tests, so hooks should not duplicate」——逐字证实**（`:10` 与 `:20` 两处）。且该 note 给出了一个**重要的诚实代价**（`:37`）：局部发布**不再能证明**全仓库矩阵。

---

## 11. 可疑 / 不实说法核对

| # | 用户/文章的说法 | 核查结论 | 逐字证据 |
|---|---|---|---|
| 1 | 2354 个 `.md` 文件 | ✅ **属实（但口径需说明）** | `find .agents/notes -name '*.md' \| wc -l` = 2354。但其中 1175 是 `.zh.md` 中文对照，英文正文仅 **1179**；另有 1175 个 `.i18n.yaml` sidecar。**21 个 `{state}/{class}` 数字全部对应「英文正文」口径，21/21 精确吻合。** |
| 2 | 69 个 `scripts/verify-*` | ✅ **精确属实** | `ls scripts/verify-* \| wc -l` = 69（42 实现 + 27 `.spec.ts`）。`package.json` 注册的 `"verify-*"` 脚本名去重 **61** 个。 |
| 3 | 「**ADR 0007**」指 quality-gates 那篇 | ❌ **不实** | 全仓库（`.agents/notes/` + `docs/`）grep "ADR" 仅 3 处：2 处是**同一篇 note 描述「过去混用 ADR 与提案模板」这一被修复的混乱**（`implemented/process/2026-07-05-uniform-agent-note-format.md:9` 及其中文版）；1 处在源码 `scripts/verify-agent-note-format.ts:19` 的 **`LEGACY_MARKERS` 黑名单**里，即 **"ADR" 是被明令禁止复活的词**。**dsh 没有任何 ADR 编号体系，无中心索引（`README.md:19` 明令禁止加 `INDEX.md`）。该 note 的真名是 `Agent Note: Mechanical quality gates over prose guidelines`，路径 `implemented/process/2026-06-11-quality-gates.md`。** |
| 4 | 根 `AGENTS.md` 有「**≤1600 词预算**」 | ❌ **不实** | `scripts/doc-budgets.manifest.json` 中 `"AGENTS.md": 1950`。**预算是 1950 词，不存在 1600 词上限。** 实测消耗 `ok 1949 / 1950`。 |
| 5 | 根 `AGENTS.md` **1949 词** | ✅ **精确属实** | `verify-doc-budgets --list` → `ok 1949 / 1950 AGENTS.md`（`wc -w` 口径）。 |
| 6 | `packages/AGENTS.md` **717 词** | ✅ **精确属实** | `ok 717 / 750 packages/AGENTS.md`。 |
| 7 | packages 里有「**foundation over blast radius**」发布前立场 | ❌ **措辞不实（精神属实）** | 该短语在仓库中**不存在**。真实措辞是 **"foundation over speculative future"**，且**只出现在一篇 archived note 对根 AGENTS.md 的转述中**（`archived/simplification/2026-06-20-drop-unconsumed-llm-assembled-surfaces.md:36`），根 `AGENTS.md` 现已 grep 不到这句。**"blast radius" 在本仓库是另一个概念**（用于描述改动波及面，见多篇 notes）。发布前立场的精神确有多处直接证据，最有力者为 `rejected/simplification/2026-07-04-prune-dead-core-spine-api.md` Risks 末句：`The repository is unreleased, so carrying unsupported surface is the larger foundation cost.` |
| 8 | 归档标准是「**future decision value, not word count/age**」 | ✅ **逐字属实** | `.agents/notes/README.md:38`：`Use the calibrated dsh-archive-agent-notes workflow **rather than word count, age, or a target quota**.` 前半句：`Archive other implemented notes only when the shipped decision is complete, its rationale is unlikely to guide future work, and the record still has historical decision value.` |
| 9 | **9 篇 rejected simplification 大多是「再砍一刀就会丢信息」** | ❌ **不实（分类不成立）** | 9 篇拒绝理由分属至少 5 类：对等结构的故障可检价值（`drop-durable-step-boundaries`）、刻意保留的架构边界（`fold-session-persistence-interface`，明言愿以更多包数换更干净边界）、**真实工作量论证**（`truncate-interrupted-turns`，唯一接近「丢信息」的一篇）、**账目过期**（`prune-dead-core-spine-api`）、**实证证伪前提**（`builtin-timer-promises...`：`implementation (PR #679) falsified the parity premise`）、有意扩展路径（`prune-unused-skill-registry-api`）、未来规划（`fold-compaction-package-split`）、净简化门槛未达（`dependency-swaps-rejected-by-nih-audit`，保留动机是 `so the survey is not re-run from scratch`）。**「怕丢信息」只在 9 篇中占 1 篇。** |
| 10 | postmortem 0001：`export default` 掉 `inject`；**178 绿测 + 100% 覆盖**却崩在真 Zed 连接 | ✅ **逐字属实** | `docs/postmortem/0001-...md:15`：`The bridge was completely non-functional in production despite **178 green unit tests and 100% line coverage**.` 崩溃现场：`crashed the instant a real editor (Zed) connected`，错误 `cannot get property "agents" without inject`。 |
| 11 | postmortem 0003：Web agent 验证了**替换服务器**而不是它实际在用的 GUI | ✅ **逐字属实** | `docs/postmortem/0003-...md:9`：`finally **validated a replacement \`dsh web\` server on another port while the original page had already picked up rebuilt artifacts**`。原文端口 3081。 |
| 12 | postmortem 0002：`!!js` 只作用于 config 不作用于 disabled；快照把 `UNKNOWN_TOOL` 当合法 | ✅ **逐字属实** | `docs/postmortem/0002-...md:32`：`It applies only to \`entry.options.config\`... while \`Entry.disabled\` tests \`entry.options.disabled\` without interpolation.` `:9`：`Snapshot refresh then accepted \`UNKNOWN_TOOL\` results as new expected outputs.` |
| 13 | postmortem 0004：Landlock 提示性 stderr 被误判为子进程致命失败 | ✅ **逐字属实** | `docs/postmortem/0004-...md:9`：`The harness treated that shared \`landlock-run:\` prefix plus any nonzero child exit as launcher failure, so ordinary outcomes such as ripgrep's exit 1 for no matches surfaced as \`SANDBOX_UNAVAILABLE\``。 |
| 14 | quality-gates note 的 Problem 段引文 | ✅ **逐字属实（一字不差）** | `implemented/process/2026-06-11-quality-gates.md:9`：`This codebase is developed primarily by coding agents. Agents follow enforced gates far more reliably than prose conventions, and "a lot of work" is not a cost argument when agents do the labor.` |
| 15 | 用户点名的三个脚本名：`verify-package-invariants` / `verify-doc-budgets` / `verify-cordis-config` | ✅ **三个名字全部正确** | 精确文件名：`scripts/verify-package-invariants.ts`（21 行，规则在 `scripts/package-invariants.ts`）／`scripts/verify-doc-budgets.ts`／`scripts/verify-cordis-config.ts`（578 行）。 |
| 16 | packages/AGENTS.md 三条规则「Require a current owner and need」/「Inverse smell」/「Require evidence for public choices」 | ✅ **三条均逐字存在** | `packages/AGENTS.md:11` / `:10`（Inverse smell 嵌在 Design Service Definitions 条内） / `:12`。 |
| 17 | 根 AGENTS.md 有「obvious-fact comments」「empty catch」「registration-as-side-effect」「force-push `--force-with-lease`」「tests describe behavior」 | ✅ **五条全部命中**（措辞分别对应 `:149`+`:172` 的 `Do not narrate control flow or tests, preserve review history, or restate code` / `:148` / `:131` / `:159` / `:152`） | 逐字引文见 §5。 |
| 18 | hooks 保持窄的理由是「agents already ran tests」 | ✅ **逐字属实** | `.agents/notes/archived/process/2026-07-22-fast-local-git-hooks.md:10`：`**An agent already runs the tests and checks that exercise its change**...`；`:20`：`CI owns exhaustive coverage, built-artifact checks, and the platform matrix.` |
| 19 | （补充）文章称 `.agents/notes/` 有「中心索引」或可按编号检索 | ❌ **反向** | `README.md:19`：`**Do not add a centralized \`INDEX.md\`**; the no-index Agent Note owns the rationale.` 交叉引用强制用**相对 markdown 链接**，`never bare prose or numbers`（`README.md:17`）。 |
| 20 | （补充）「postmortem 也是一种 Agent Note」 | ❌ **明确否认** | `docs/postmortem/README.md`：`A post-mortem is **NOT** an [Agent Note] (which records a deliberate design decision and its rejected alternatives, or proposes future work).` |

---

## 12. 可直接引用的金句（18 条）

> 每条含：**英文原文**（逐字）+ **`路径:行号`** + **建议中文译法**。

**1.** "The codebase is developed primarily by coding agents. Agents follow enforced gates far more reliably than prose conventions, and 'a lot of work' is not a cost argument when agents do the labor."
— `.agents/notes/implemented/process/2026-06-11-quality-gates.md:9`
> **译**：这个代码库主要由编码智能体开发。智能体遵循**被强制执行的门禁**，远比遵循散文式约定可靠；而当干活的是智能体时，「工作量很大」根本不算成本论据。

**2.** "Every mechanically checkable AGENTS.md promise gets a command that exits non-zero."
— `.agents/notes/implemented/process/2026-06-11-quality-gates.md:15`
> **译**：AGENTS.md 里每一条**可机械检查**的承诺，都配一条**非零退出**的命令。

**3.** "A decision recorded without what it beat invites re-litigation — the failure Agent Notes exist to prevent."
— `.agents/notes/README.md:111`
> **译**：一个不记录「它击败了什么」的决策，会招来反复翻案——而这正是 Agent Note 这种文体存在的意义：防止这种失败。

**4.** "Alternatives are recorded, never invented."
— `.agents/notes/README.md:113`
> **译**：备选方案只**记录**，绝不**编造**。

**5.** "Use the calibrated `dsh-archive-agent-notes` workflow rather than word count, age, or a target quota."
— `.agents/notes/README.md:38`
> **译**：归档要走校准过的 `dsh-archive-agent-notes` 流程，**而不是看字数、看年头、或凑一个配额**。

**6.** "Once sealed, every archived triplet is permanently frozen. Do not edit, translate, reformat, update, move, or delete it, and do not treat it as authority for current behavior."
— `.agents/notes/README.md:42`
> **译**：一旦封存，每个归档三件套即**永久冻结**：不得编辑、翻译、重排版、更新、移动或删除，也不得把它当作当前行为的权威依据。

**7.** "architecture is about the source we ship; process is the surrounding tooling and workflow."
— `.agents/notes/README.md:34`
> **译**：**architecture 管我们交付的源码；process 管围绕它的工具链与工作流。**

**8.** "A test that constructs a plugin by hand cannot validate how the plugin loads."
— `docs/postmortem/0001-acp-default-export-drops-inject.md`（`## Lessons` 第 3 条）
> **译**：**手工构造插件实例的测试，无法验证插件是如何被加载的。**

**9.** "Trust the trace, not the theory. The elegant shadow explanation was real but was the *second* bug; the *first* was a one-line export mistake that a fiber-walk `console.error` found in minutes after hours of plausible-but-wrong reasoning."
— `docs/postmortem/0001-acp-default-export-drops-inject.md`（`## Lessons` 第 4 条）
> **译**：**相信 trace，别相信理论。** 那个优雅的 shadow 解释确实成立，但它是**第二个** bug；**第一个**只是一行导出写错——在数小时「看似合理但方向错误」的推理之后，一句 fiber-walk 的 `console.error` 几分钟就找到了它。

**10.** "The snapshot suite passed because both outputs matched the refreshed fixtures; it proved deterministic replay of the regression rather than successful filesystem behavior."
— `docs/postmortem/0002-js-expression-disabled-filesystem-tools.md:19`
> **译**：快照套件之所以通过，是因为两份输出都与**刷新后的**fixture 吻合；它证明的是**这个回归可以被确定性地重放**，而**不是**文件系统行为正常。

**11.** "A snapshot refresh is fixture production, not correctness review."
— `docs/postmortem/0002-js-expression-disabled-filesystem-tools.md`（`## Lessons` 第 2 条）
> **译**：**刷新快照是「生产 fixture」，不是「评审正确性」。**

**12.** "A syntactically accepted configuration value is not necessarily evaluated at that location; document and verify exactly which fields are interpolated."
— `docs/postmortem/0002-js-expression-disabled-filesystem-tools.md`（`## Lessons` 第 1 条）
> **译**：**语法上被接受的配置值，不一定在该位置被求值**；必须写清楚并验证到底是哪些字段会被插值。

**13.** "The resulting actions were individually plausible but did not share one acceptance target. A source edit, a successful build, an HTTP 200, an injected boot manifest, and the user's existing page were treated as interchangeable facts."
— `docs/postmortem/0003-web-agent-gui-feedback-loop.md:15`
> **译**：这些动作**单看每一个都合理，但它们并不共享同一个验收目标**。源码改动、构建成功、HTTP 200、注入的 boot manifest、用户眼前那个页面——被当成了**可以互相替换的事实**。

**14.** "HTTP readiness, build success, and a boot manifest are different facts. Acceptance names the exact origin and externally observes the requested change there."
— `docs/postmortem/0003-web-agent-gui-feedback-loop.md`（`## Lessons` 第 2 条）
> **译**：**HTTP 就绪、构建成功、boot manifest 是三件不同的事。** 验收必须**点名确切的 origin**，并在**那里**从外部观察到所请求的改动。

**15.** "A replacement service cannot prove that an existing page changed."
— `docs/postmortem/0003-web-agent-gui-feedback-loop.md`（`## Lessons` 第 3 条）
> **译**：**一个替换服务，无法证明那个已经存在的页面发生了改变。**

**16.** "Process attribution requires a conjunction of independent evidence; a shared prefix is not a protocol."
— `docs/postmortem/0004-landlock-partial-notice-misclassified-child-failures.md`（`## Lessons` 第 1 条）
> **译**：**进程归因需要多条独立证据的合取；共享的前缀不是协议。**

**17.** "An adapter must preserve structured failures owned by the seam below it instead of replacing them with its own nearest generic category."
— `docs/postmortem/0004-landlock-partial-notice-misclassified-child-failures.md`（`## Lessons` 第 3 条）
> **译**：**适配器必须保住下层接缝所拥有的结构化失败，而不是用自己的「就近泛化类别」把它替换掉。**

**18.** "Agents inspect the outgoing diff and run the narrowest tests and checks that cover its behavior once. CI owns exhaustive coverage, built-artifact checks, and the platform matrix."
— `.agents/notes/archived/process/2026-07-22-fast-local-git-hooks.md:20`
> **译**：**智能体检视即将推出的 diff，并针对其行为跑一次最窄的测试与检查。穷尽式覆盖、构建产物检查、平台矩阵——这些归 CI。**

**备选金句（同样逐字，可替换上文）**：

**19.** "An agent already runs the tests and checks that exercise its change, while commit, push, and CI can each repeat increasingly broad subsets of the same work."
— `.agents/notes/archived/process/2026-07-22-fast-local-git-hooks.md:10`
> **译**：**智能体本来就会跑覆盖其改动的那批测试与检查**，而 commit、push、CI 却可能各自把同一份工作的越来越大的子集再跑一遍。

**20.** "Chain-of-thought leakage is prose whose vantage is the authoring session rather than the repository."
— `.agents/skills/dsh-trim-cot-leakage/SKILL.md:8`
> **译**：**思维链泄漏，就是那种视角属于「创作会话」而非「代码库」的散文。**

**21.** "Could a reader at HEAD, with no access to any session transcript, PR thread, or uncommitted draft, resolve every reference and verify every claim?"
— `.agents/skills/dsh-trim-cot-leakage/SKILL.md:12`
> **译**：**一个站在 HEAD 的读者，在没有会话记录、PR 讨论串、未提交草稿的情况下，能解析文中每一个引用、验证每一条断言吗？**

**22.** "100%-coverage pressure can produce assertion-free tests — mutation testing is the planned counterweight."
— `.agents/notes/implemented/process/2026-06-11-quality-gates.md:28`
> **译**：**100% 覆盖率的压力会催生「没有断言的测试」**——变异测试是计划中的对抗手段。

**23.** "Those benefits are hypothetical; retaining them makes every implementation and document explain states that no shipped caller can observe."
— `.agents/notes/rejected/simplification/2026-07-04-prune-dead-core-spine-api.md`（`## Alternatives considered`）
> **译**：**那些好处都是假设性的**；留着它们，会让每一处实现和每一份文档都去解释「没有任何已交付调用方能观察到的状态」。

**24.** "The repository is unreleased, so carrying unsupported surface is the larger foundation cost."
— `.agents/notes/rejected/simplification/2026-07-04-prune-dead-core-spine-api.md`（`## Risks` 末句）
> **译**：**本仓库尚未发布，所以「背着一堆无人支撑的表面」才是更大的地基成本。**

---

## 13. 供文章使用的结构性观察（非引文，本人归纳）

1. **三层否定式治理**：路径编码（`{lifecycle}/{class}/date-topic`）+ 强制章节（`## Alternatives considered`）+ 冻结哈希封条（`manifest.json` 的 blob 哈希）。**三者都是「让偏离无法发生」，而不是「让偏离被批评」。**
2. **69 个 verify 门禁里，Agent Note 自身占 3 个**（classification / format / archived），全部标 `quick: true`。**文档治理本身是被门禁覆盖的一等公民。**
3. **「旧测绿不了」是四篇 postmortem 的共同毒株**——四篇全部符合「测试通过但真实路径失效」。dsh 的应对统一是**加一条真路径测试 + 一条机械门禁**，而非加一条散文规范。
4. **预算与实际消耗的贴合度**（1949/1950、1349/1350、2410/2410、600/600）说明这些**不是摆设性上限**，而是被持续顶格使用的真实约束。
5. **`rejected/` 的存在本身是一种制度**：14 篇负面决策台账，明确以「防止重复提出」为保留动机之一（`dependency-swaps-rejected-by-nih-audit`：`recorded so the survey is not re-run from scratch`）。**这与一般仓库「把被否提案删掉」的做法相反。**
6. **CoT 泄漏治理的形态是 skill 而非门禁**，且该 skill 明确承认**自动探针不完备**（`:42`：`The batteries are probes, not the definition — each review round of the original purge found cases the batteries missed`），并要求**人工语义判断 + 无预设地通读最密集的散文**。这是本仓库少见的「承认机械手段有边界」之处。

---

## 附录 A：本次核查执行的原始命令（可复现）

```bash
cd /Users/zxnap/code/opensource/deepseek-harness
git log -1 --format='%H %ad %s'          # HEAD
git rev-list --count HEAD                # 19520
git log --reverse --format='%ad' | head -1   # 首次提交 2026-06-10
find .agents/notes -name '*.md' | wc -l              # 2354
find .agents/notes -name '*.md' -not -name '*.zh.md' | wc -l   # 1179
find .agents/notes -name '*.zh.md' | wc -l           # 1175
find .agents/notes -name '*.i18n.yaml' | wc -l       # 1175
ls scripts/verify-* | wc -l                          # 69
npx tsx scripts/verify-doc-budgets.ts --list         # 预算实况
grep -rn "\bADR\b" .agents/notes/ docs/              # 3 处命中（全部非编号惯例）
find .agents/notes/rejected -name '*.md' -not -name '*.zh.md' | wc -l   # 14
```

## 附录 B：本次核查未能证实的事项（诚实声明）

1. **根 `AGENTS.md` 中不存在「foundation over speculative future」字样**。该短语仅见于 `archived/simplification/2026-06-20-drop-unconsumed-llm-assembled-surfaces.md:36` 对根 AGENTS.md 的**转述**。我**无法确定**它曾存在于 AGENTS.md 后被删除，还是该 note 引用的是措辞而非逐字文本。**文章若使用此短语，应表述为「一篇 archived note 将其归因于根 AGENTS.md」，而非「AGENTS.md 中写着」。**
2. **`docs/postmortem/README.md` 中提到的 "ADRs"** 是 guardrail 类型的**泛指**，我没有在仓库中找到任何被如此命名的实体，因此无法给出该词所指的具体文件。
3. **`verify-*` 的 69 与 `package.json` 注册的 61 个名字之间的差额**，我确认了部分脚本由 `run-gates.ts` 以非 `pnpmScript` 方式调用或按不同参数注册，但**未逐一穷举 8 个差额的归属**。
4. **用户提到的「blog 称 9 rejected simplification 大多是怕丢信息」**：我核实了全部 9 篇的 `Status:` 行与部分全文，**结论是该概括不成立**；但我**没有**找到那篇 blog 原文，因此无法确认其确切措辞——本报告的判定基于仓库内证据，而非 blog 文本本身。
