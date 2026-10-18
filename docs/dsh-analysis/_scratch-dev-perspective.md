# Agent 开发者视角：从 dsh 源码里能抄走的 9 条工程经验

> 目标读者：正在写 agent / agent framework / LLM tooling 的工程师。
> 不是功能巡礼，是**可迁移的工程技法**。所有结论都带 `path:line` 或逐字引用，未经验证的单独列在文末。
> 仓库：`/Users/zxnap/code/opensource/deepseek-harness`（HEAD `00102833dfae`，`Tue Sep 22 23:25:38 2026 +0800`，`git rev-list --count HEAD` = **19,520**）。

**排序原则**：transferability（换一个项目还能用吗）× non-obviousness（想得到吗）。排在前面的不是最重要的，是**最反直觉且最通用**的。

---

## Lesson 1 ★★★★★｜把「约定」编译成「退非零的闸门」，因为 agent 只服从机器

**一句话结论：任何机械可检查的约定都必须有一条命令来强制，写进 AGENTS.md 的散文约定对 agent 基本无效——而「工作量大」在 agent 干活的前提下根本不是成本论据。**

### 源码证据

`.agents/notes/implemented/process/2026-06-11-quality-gates.md:13-15` 逐字：

> This codebase is developed primarily by coding agents. Agents follow enforced gates far more reliably than prose conventions, and "a lot of work" is not a cost argument when agents do the labor. Early evidence: tests that didn't typecheck shipped (vitest doesn't typecheck) and were only caught by a review.

同文件 `:19`：

> Every mechanically checkable AGENTS.md promise gets a command that exits non-zero.

规模证据：`scripts/` 下 `verify-*` 前缀的文件共 **69 个**，其中 **27 个是 `.spec.ts` 自检文件**，去掉后还剩 **42 个闸门本体**（`ls scripts/ | grep -c '^verify-'` → 69；`| grep -v '\.spec\.ts$'` → 42）。**闸门与"验证闸门能红"的自检文件成对出现**，这个 1:1.5 的比例本身就是 Lesson 1 的可迁移点之一。

### 5 个最可迁移的闸门（逐个说清它到底卡什么）

| 闸门 | 强制的内容 | 为什么可迁移 |
|---|---|---|
| `scripts/verify-agent-note-format.ts` | 文档**结构**的逐行语法：`# Agent Note: <title>` 必须第 1 行、第 2 行必须空、第 3 行 `Status:` 必须与所在生命周期目录匹配（`proposed`/`implemented`/`rejected — <why>`）、`## Problem` 必须是第一个二级标题、按生命周期要求必备章节、`implemented/` 里**禁用** proposal 时代的标题（`## Proposal`/`## Plan`/`## Migration plan`/`## Acceptance criteria`） | 它连「代码块里的示例不算文档结构」这种细节都处理了（`:44-51` 用 fence 状态过滤）。这就是「agent 写的文档」的正确治理粒度：**不是审内容，是审结构**——结构能机器判，内容交给人 |
| `scripts/verify-doc-budgets.ts` | 每个列在 `scripts/doc-budgets.manifest.json` 的常驻文档的字数上限；**缺文件也失败**（`:39-42` 提示"renamed or deleted? update manifest in the same change"） | 这是「防文档腐化」的完整方案：不是建议别写长，是**给天花板 + 给改天花板的流程**。而且 `--list` 模式（`:52-55`）让人能先看现状再决定 |
| `scripts/verify-translation-pairing.ts` | 双语对（英/中）**结构签名一致** + **记录 git blob 哈希**（`:1-10`）；`--write` 记录已确认配对、`--cached` 对 index 精确校验（给 hook 用） | 关键设计：`Translation quality remains a review responsibility.`（`:9`）——**机器管结构与漂移，人管质量**。哈希让"翻译没跟着改"变成可检测的漂移 |
| `scripts/verify-package-invariants.ts` → `scripts/package-invariants.ts` | 不变式伴生插件的**存在性、导出形状、注册正确性**全套；AST 级规则：拒绝 `@generated` 标记（`:242` "invariant companions must be hand-owned and may not carry @generated markers"）、拒绝 default export、拒绝空 installer（`:284` "must use the checked local install function"）、installer 第二个参数必须是失败上报器**且必须被使用**（`:334-340`） | 「不许写空实现来骗过闸门」被推到了 AST 层。这是防 agent 钻空子的标准动作：**把 gate 的旁路也变成 gate 的检查项** |
| `scripts/verify-cordis-config.ts` | 只允许特定字段接受表达式，其余 entry metadata 必须是字面量（`:1-10`）；连「运行时字符串挂载的包」都手工列白名单校验（`:43-53` `CHOOSER_BACKEND_PACKAGES`） | 它**源自一次事故**：postmortem 0002（`docs/postmortem/0002-js-expression-disabled-filesystem-tools.md:40`）明说 `verify-cordis-config` 是那次 bug 催生的。可以照抄的是这个闭环：**事故 → 闸门**，而不是闸门本身 |

### 可迁移做法（照做级）

1. 列一张表：左侧「我们希望 agent 遵守的所有约定」，右侧「命令」。右侧空着的那一行，就是不会发生的约定。
2. 闸门的第一条规则应该是**幂等可自检**：`--list` 打印现状（`verify-doc-budgets.ts:52`），让 agent 在改之前能看见基线。
3. 每个闸门配一个 `.spec.ts` 兄弟文件（仓库里 `verify-*.spec.ts` 与 `verify-*.ts` 成对出现），**验证这个闸门本身能红**。
4. 把「改上限」写进流程而不是禁止改：`docs/AGENTS.md:54-58` 的三步是「Relocate → Condense → Raise（且必须在 PR 里给理由）」，并且 `Ceilings are guardrails, not reduction targets.`——**防止 agent 把预算当成缩减指标去砍内容**。
5. 硬规矩：`A too-low ceiling is a budget bug.`（`docs/AGENTS.md:58`）。

> ⚠️ 关于「5% headroom」：文件头注释我读到的原文是 `Ceilings ratchet down with at least 5% headroom`（`scripts/verify-doc-budgets.ts:4`），而 `docs/AGENTS.md:58` 是 `At or below target, retain at least 5% headroom; above target, freeze the ceiling`。含义一致（下调时要留 5% 余量；超了就冻结不许上调），但**任务描述里的"ratchet-with-5%-headroom"是这两处的合并表述，不是某一行逐字原文**。

---

## Lesson 2 ★★★★★｜运行时不变式要断言「关系」，不要断言「存在」

**一句话结论：单元测试证明某个函数在给定输入下正确；运行时不变式证明"系统在时间流逝和可变数据下没有进入不可能状态"——后者是 agent 系统唯一能覆盖长尾的检查。**

### 源码证据

`.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md:13-15` 逐字（这是全文的核心判据）：

> A useful runtime invariant relates observations over time or across a mutable data structure. Examples include a terminal event without its start, an LLM delta for a block that is not open, or a durable result whose identity differs from its request. Merely confirming that a declared method exists, that a plugin has its expected name, or that a constant example still returns a known value is not such a relation.

同一文件还诚实地承认**不是每个包都该有不变式**（`:17-19`）：

> Some packages genuinely own no continuously observable relation. ... Requiring a synthetic runtime assertion for those packages would optimize for satisfying a gate instead of detecting corruption.

**"Model-visible ⟺ logged" 的实际断言**——`packages/core/agent-loop/src/invariant.ts:40-43` 逐字：

```ts
const expected = session.deriveMessages()
if (JSON.stringify(options.messages) !== JSON.stringify(expected)) {
  fail(`llm request for session "${String(session.id)}" diverges from the dispatch-time durable derivation (log-reconstruction desync)`)
}
```

这条断言两侧的来源是**两个独立的生产者**：左边是 loop 实际发给 provider 的请求体，右边是从 append-only session log 重新推导出来的消息数组。它们本该恒等——不等就说明日志与真实请求脱钩了。

配套的完整检查（同一文件 `:21-56`）还包括：请求必须被 `Object.isFrozen` 冻结、必须携带活的 session id、messages 数组必须冻结、session log 里必须有 `step/start`、必须能 fold 出 `request/header`、header 的 model/temperature/maxTokens/stop/tools 必须逐项吻合。注意 `:20` 的注释：

> Prepend prevents a short-circuiting replay listener from silencing the check.

——**它连"这条检查本身可能被其它监听器短路"都防了**（`{ global: true, prepend: true }`）。

这条不变式服务的顶层原则在 `docs/architecture.md:125` 逐字：

> **Model-visible means logged.** Anything that reaches a model request must be reconstructable from the log, and a runtime invariant asserts it.

`packages/core/session/README.md:88` 有同义表述：`Model-visible means logged: anything that reaches a model request must be reconstructable from the log.`

### 为什么运行时关系断言 > 单元测试（这里是关键论证）

1. **单元测试的输入是你想到的；代理系统崩在你想不到的时序。** `dsh-session` 的关系是「严格序列增长、turn/step 包围、同 step 的 tool call/result 配对」——这三条都只有在真实长跑里才会被违反，而且往往要几十个 turn 才出现一次。
2. **单元测试测函数，不变式测接线。** agent-loop 那条断言两侧（loop 的组装路径 vs session 的推导路径）各自都有完备的单元测试，**两边都绿**，但它们的**乘积**可以错——因为两边的实现是独立演化的。这正是单元测试结构上覆盖不到的位置。
3. **它是常开的，不是按需跑的。** 挂在 `llm/stream` 这个真实边界上，每次模型调用都过一次——不需要有人记得加用例。
4. **失败信息本身就是定位信息。** `(log-reconstruction desync)` 这句话直接说出根因分类，不是 `expected true got false`。

### 「只为会发散的观测发伴生插件」规则

`packages/AGENTS.md`（Harness Packages 段）逐字：

> **Publish `./invariant` only for diverging observations.** Check an owned relation under the manifest name. Otherwise omit wiring and give the package-specific README reason. Empty companions and ignored reporters fail [`verify-package-invariants`](...).

判据（`.agents/skills/dsh-find-simplifications/SKILL.md` 里说得更直白）：

> An invariant companion is justified by comparing independently produced observations that can diverge. Checks of service presence, plugin metadata, fixed examples, or the same mutation's return value do not qualify.

即：**两侧必须是独立产生的观测**。同一个函数返回值自己跟自己比、service 存不存在、插件名字对不对——全部不合格。

### 可迁移做法

1. 建一个 `ctx.invariants.register(pkgName, install)` 式的中心服务 + 各包自带伴生检查；中心只管注册唯一性/生命周期/回滚/归因，**不提供任何"检查插件形状"的通用 helper**（`2026-07-19-...md:29-31` 明确禁止）。
2. 写出你的 top-3「本该恒等」关系。每个都要能回答：两侧由**谁**独立产生？多久观测一次？违反时的错误消息能否直接定位？
3. 审计现有不变式：凡是能改写成 `expect(typeof x.method).toBe('function')` 的，删掉——它们只让闸门变绿，不让系统更安全。
4. 给"这个包确实没有可观测关系"留一条**显式豁免路径**，且要求写进 README 说明理由。强迫每个包都造一个假断言，产出的是"满足闸门的优化"而非"检测损坏"。

---

## Lesson 3 ★★★★★｜孪生实现：用第二个真实实现来验证抽象，而不是用 mock

**一句话结论：只对着一个实现定义的"中立"协议，实际上是把那个实现的怪癖偷偷写成了规范；验证它的唯一方法是立刻上第二个**真实**实现，并且明文拒绝用 mock 顶替。**

### 源码证据

`.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md:9-11` 逐字（问题陈述）：

> A vocabulary defined against a single adapter risks baking that adapter's quirks into the "neutral" contract: anything the one implementation happens to do becomes the de-facto spec, and the abstraction is unverified until a second provider arrives — by which point the leak is expensive to fix.

规则本体（`:19-20`）逐字：

> The rule they enforce: **anything the StreamChunk vocabulary cannot express for BOTH implementations is a core-vocabulary bug**, caught immediately rather than at the next provider.

两个实现的**内部必须不同**（`:13-17`）：`dsh-llm-deepseek` 是直接 `fetch` + 自研 SSE 翻译，`dsh-llm-pi-ai` 走 `@earendil-works/pi-ai` 库（自带一套事件词汇）。注意它**诚实划界**了自己"孪生"到底意味着什么：

> The twin identity is owning the fetch/translate internals rather than delegating to a full provider SDK, not hand-rolling transport plumbing.

被明确拒绝的方案（`:25`）逐字：

> **A mock second adapter** — cheaper but doesn't exercise a real provider's wire quirks, so it proves little. The twin is real-on-real.

**收获（` :21-22`）**——这才是这条技法的价值证明：孪生对立刻把 4 条约定逼了出来，并钉在 `dsh-llm/src/types.ts` 的 `StreamChunk` 文档里：
1. `usage` 必须在 `finish` **之前**发出；
2. `finish` 之后**不得**再有事件；
3. tool-call 的 `arguments` 端到端保持**原始 JSON 字符串**；
4. 有**两条**合法错误路径（从 `stream()` 抛异常 **或** 以 `finish {kind:'error'|'aborted'}` 结束），消费方必须两条都处理。

第 4 条尤其能说明问题——`:22` 明说这是一次**库派实现才暴露出来、单一直连实现会永久隐藏**的分歧。

### 成本会计（原文怎么算的）

`:27` 逐字：

> The twin doubles adapter and key-gated e2e maintenance—both cover V4 Flash and Pro across representative reasoning modes—in exchange for continuous seam-neutrality validation and a second implementation example.

以及一条**预设的退出条件**（`:28`）：

> A future conformance suite could justify retiring one adapter through a superseding Agent Note.

——注意它不是"永远维护两份"，而是"在一致性测试套件出现之前，这是验证 seam 的唯一手段"。

### 可迁移做法

1. 找出你系统里那些**只被一个实现满足**的"中立"接口（流式协议、消息模型、工具 schema、持久化格式）。写出它的 de-facto 规范——你多半在描述那一个实现的实现细节。
2. 上第二个**真实**实现，且**故意选不同内层**（直连 vs SDK、HTTP vs 本地、同步 vs 异步）。选第二个"同一个库换个包装"的实现在这里等于什么都没做。
3. 明文写下那条判据：**"第二个实现表达不出来的东西 = 核心词汇表的 bug"**——它把"这个边界要不要改"从审美争论变成了可判定的问题。
4. 成本用「双份 adapter + 双份 key-gated e2e」记账，并在同一条记录里写下**退役条件**（这里是"出现一致性测试套件"）。
5. 如果团队想用 mock 省钱，把拒绝理由抄进决策记录：**mock 不跑真实 provider 的线缆怪癖，所以它证明不了什么**。

> 📌 附注：仓库里其实有**第三个**实现——`2026-09-07-deepseek-messages-adapter.md` 记录在 `llm-deepseek` 内新增了 Anthropic 协议实现，并声明它保持同一套流式约定（`2026-06-13-twin-llm-adapters.md:30`）。这说明孪生不是一次性动作，而是可持续的验证位。

---

## Lesson 4 ★★★★☆｜协调协议的三块硬骨头：持久邮箱 / CAS 任务板 / 身份与生命周期分离

**一句话结论：多 agent 协调的全部难点可以被压缩成三个具体数据结构决策——消息用「排队 − 已投递」做崩溃恢复，任务用单调 revision 做 CAS，身份用持久事实、状态用运行时推导。**

### 4a. 持久邮箱：queued → delivered，崩溃恢复 = replay(queued − delivered)

`packages/experimental/agent-team/README.md`（Understand the implementation → Durable mailbox）逐字：

> `sendMessage()` validates peer membership, appends `team/message/queued`, and flushes before attempting delivery. ... A target receipt is acknowledged with `team/message/delivered` only after the target Session durably holds the message identity in its pending inbox or recorded history. Immediate admissions are serialized per target in durable queue order; recovery dispatches queued-minus-delivered records in the same order. Delivery folds both live and persisted target inbox/history state before retrying, **so a crash between inbox acceptance and model claim does not duplicate the message.**

并且它**主动降低了自己的保证等级**（同段末）：

> The guarantee is process-local retry plus target-Session de-duplication, **not cross-process exactly-once delivery**.

代码对应：`packages/experimental/agent-team/src/mailbox.ts:88-95` 的 `recoverFor()` 就是字面的 `!state.delivered.includes(message.id)` 过滤；`:117-147` 的 `sendAdmitted()` 先 `appendAndFlush('team/message/queued')` 再 `tryDispatch`；`:288-291` 的确认路径先查 `if (state.delivered.includes(messageId)) return`（幂等）再 append `team/message/delivered`。

**关键推论（这是最该抄的一点）**：send 返回 `queued` 也是成功，因为消息**已经落盘**。README 逐字：

> A queued message is already safely stored, so it must not be resent.

——把"已持久化"和"已送达"分成两个语义，重试就从"可能重复"变成了"必然幂等"。

### 4b. 任务板：单调 revision + CAS，过期写被拒而不是静默覆盖

README（Shared task board）逐字：

> Tasks are complete versioned snapshots; every mutation carries `expectedRevision`, and a stale caller receives `TEAM_TASK_STALE_REVISION` instead of overwriting a newer value. Numeric `task-<n>` ids require a safe-integer suffix, and id-space exhaustion reports `TEAM_TASK_LIMIT` instead of reusing the final id. Deleted tasks remain tombstones for replay and id stability but do not consume `maxTasks` or appear in `listTasks()`.

代码：`packages/experimental/agent-team/src/task-board.ts:119-123` 是那段 CAS 检查本体；`:209` 提交时 `revision: current.revision + 1`；`:256` 的 `taskReady` 实现 DAG 就绪判定（`blockedBy.every(... status === 'completed')`）；`:215-236` 的 `dependencies()` 校验自环、重复 blocker、指向不存在/已删除任务。

三个细节特别值得抄：
- **id 耗尽要报 `TEAM_TASK_LIMIT`，不能复用最后一个 id**（复用会让历史记录指向错误的任务）；
- **删除是 tombstone**：不占配额、不出现在 list，但保留给 replay 用；
- **DAG 校验带错误码映射**（`:243-251` 把共享校验器的 violation 映射到稳定的 command error code）——模型看到的是稳定的错误码，不是随实现漂移的消息文本。

### 4c. 成员生命周期：持久 `active`/`failed` vs 运行时 `running`/`idle`/`inactive`

README（Teammates）逐字：

> The roster shows every member with its role (`lead` or `teammate`) and current status: `running`, `inactive` (no turn is executing, whether loaded or stored), `provisioning`, or `failed`.

投影逻辑在 `packages/experimental/agent-team/src/roster.ts:145-152`：

```ts
status: member.phase === 'failed'
  ? 'failed'
  : member.phase === 'provisioning'
    ? 'provisioning'
    : availability(live),
```

而 `availability` 是纯运行时推导（`:492-494`）：

```ts
function availability(agent: Agent | undefined): 'running' | 'inactive' {
  return agent?.status === 'running' ? 'running' : 'inactive'
}
```

**这就是分离点**：`phase`（`provisioning`/`active`/`failed`）是**持久事实**，写进日志；`running`/`inactive` 是**瞬时事实**，每次读取现算。`tool-agent-team/README.md:64` 还专门提醒消费者别搞混：

> `inactive` means no turn is executing, whether the member is loaded or must be resumed; **it does not describe task completion or outcome.**

即：**不要把"没在跑"误读成"任务失败/完成"**——这是 agent 编排里极常见的语义塌缩事故。

### 4d. 名字永久性 + 分配即预留

README 逐字：

> Teammate names are permanent — even a teammate whose creation failed keeps its name, and **no name is ever reused**.

Agent Note `2026-08-05-agent-teams.md` 给出了原因与实现顺序：

> Creation first appends and flushes a `team/member` provisioning snapshot in the Lead Session, **then** starts the reserved continuable child through the selected fresh or fork provider. ... **Names are reserved by the first provisioning record and never reused, including after failure.**

即：**先落盘预留，再真正创建**。这样崩溃后可以"对着子 Session 的独立持久化状态做对账"——匹配 direct-parent + continuable 描述符 + 已记录的初始用户消息 → 判为 `active`；其余情况判 `failed`。这也是为什么失败的名字不能回收：名字是恢复时的**关联键**。

### 4e. 诚实边界（这本身就是一条经验）

`packages/experimental/agent-team/README.md` 的 `## Known Limitations and Deferred Work` 逐字：

> - **Experimental prototype with no stability promise** — the package is public, but its contracts can change freely while it incubates.
> - **One process and one shared checkout** — members share cwd and observe edits immediately; this package provides no worktree, remote member, merge, or filesystem lock.
> - **Advisory write scopes** — Bash, formatters, code generators, and direct external writers can bypass filesystem version checks; Leads must coordinate ownership and review the final diff.
> - **Flat immutable roster** — only the Lead creates direct teammates; there is no nested Team, rename, deletion, or name reuse.
> - **No automatic ownership release** — inactivity, interruption, process exit, and failed work do not release a task owner.
> - **Mailbox is not cross-process exactly-once** — concurrent harness processes over one Team are unsupported.

**为什么"诚实边界"本身是经验**：这六条每一条都预先否掉了一个下游设计假设。想加嵌套 team 的人、想让进程退出自动释放任务的人、以为 writeScope 是锁的人，都会在前 5 分钟撞上这份清单，而不是在架构评审第 3 周。`packages/subagent/subagent/README.md:185-192` 是同一风格的六条（ACP 子代理一次性、邻接消息限制、父必须存活、取消收敛期的唤醒空窗、pending context 保留 Activation、进程本地驻留）。

### 可迁移做法

1. 邮箱：两张表 `queued` / `delivered`，`send` 在投递**之前**先落 queued；恢复 = 重放差集；确认在目标**真正持久持有**之后。给 `send` 的返回值区分 `accepted` / `queued`，并在 API 文档里写死"queued 也算成功，不要重发"。
2. 任务板：所有变更携带 `expectedRevision`；不匹配就报错返回，**绝不覆盖**；id 单调且不复用；删除留 tombstone。
3. 成员：拆成 `phase`（持久）+ `availability`（推导）两个字段，在面向模型/UI 的文档里点名区分，并警告"inactive ≠ 任务完成"。
4. 分配：`先落盘预留 → 再创建 → 成功后补 flush`；失败的名字不回收，作为恢复关联键。
5. 每个协调组件都写 `## Known Limitations`，每条必须**显式否定一个下游可能会有的假设**。写"不支持 X"比写"支持 Y"更有用。

---

## Lesson 5 ★★★★☆｜协调元数据 ≠ 强制执行：明确拒绝把 writeScopes 当锁

**一句话结论：任何"约定某个资源归谁"的元数据，在能被绕过的执行路径存在时，都只能做警告不能做强制——伪装成互斥比显式警告更危险。**

### 源码证据

`packages/experimental/agent-team/README.md`（Shared task board 末段）逐字：

> `writeScopes` are normalized workspace-relative prefixes; **views warn on overlap with in-progress tasks but never block claim or authorize writes.**

`packages/experimental/agent-team/src/task-board.ts:266` 的 JSDoc 用的词是 `advisory write overlaps`，`:45` 是 `advisory write scopes` —— "advisory" 是写进代码注释的定性，不是临时措辞。

**为什么不用作锁**——`2026-08-05-agent-teams.md` 的 Alternatives 段给了完整论证，三层理由逐字：

> **Treat task ownership or write scopes as locks.** Rejected because external writers bypass them, crashed owners remain durable, and path-prefix overlap cannot prove semantic independence. **False mutual exclusion is more dangerous than an explicit warning.**

同 note 的 Problem 段把"能绕过"说得更具体：

> Filesystem edit tools can reject an observed stale version, but Bash, formatters, generators, and external writers bypass that fence. **Treating a teammate name or task owner as a file lock would hide rather than solve this concurrency boundary.**

README 里对"能绕过"的枚举是完整的（Known Limitations 第 3 条）：

> **Advisory write scopes** — Bash, formatters, code generators, and direct external writers can bypass filesystem version checks; Leads must coordinate ownership and review the final diff.

注意最后那半句——**它不只说"这不是锁"，还说了正确的替代动作**：Lead 负责协调 ownership 并审最终 diff。

### 三层不可用的理由（可迁移的判据）

1. **绕过面不可枚举**：只要存在不经过你的检查点的写入路径（shell、格式化器、代码生成器、外部进程），互斥就不成立。你做不完枚举，所以锁必然是假的。
2. **崩溃后 owner 持久**：`No automatic ownership release`（Known Limitations 第 5 条）——锁会永久卡死，而警告不会。
3. **路径前缀重叠推不出语义独立**：两个 agent 改同一前缀下的不同文件可能完全无冲突；改不同前缀也可能语义冲突。**路径不是正确性的代理**。

结论那句话值得背下来：**False mutual exclusion is more dangerous than an explicit warning.**（虚假的互斥比显式警告更危险）

### 可迁移做法

1. 把协调元数据（writeScope、owner、assignee、lockfile、branch claim）分成两类：**能证明安全的** 和 **只能提示的**。只有前者能挡操作。
2. 对第二类，在 API 名字、类型、JSDoc、README 四处都写上 `advisory`，并且**明确列出已知绕过路径**——不要写"通常不会被绕过"。
3. 给"被绕过时怎么办"配一条正向动作（这里是"Lead 审最终 diff"），否则读者只知道不能用，不知道该用什么。
4. 如果你真的想要强制，先把执行面收敛：让**所有**写路径经过同一个检查点。做不到就老实做警告。

---


---

## Lesson 6 ★★★★☆｜反过度工程规则：把"设计品味"编译成可执行的 prompt 条目

**一句话结论：`packages/AGENTS.md` 里那几条规则的价值不在措辞漂亮，而在于每条都指向一个**具体的、agent 高频犯的错**，而且能被转成"这条抽象该不该存在"的判定问题。**

### 源码证据：`packages/AGENTS.md` 逐条 + 作为可执行规则怎么用

**① Require a current owner and need.** 逐字：

> Tie each abstraction, state machine, option, defensive copy, and compatibility path to a current contract or production consumer, and keep behavior in its owning plugin or service.

→ **可执行化**：让 review/agent 对每个新抽象回答"当前 owner 是谁、当前 consumer 是谁"。答案里出现"将来可能"、"为扩展性预留"、"统一入口"就驳回。注意它覆盖的清单很宽：抽象、状态机、option、防御性拷贝、兼容路径——**兼容路径**这条尤其容易被忽略（"为了兼容旧版"经常是没有旧版调用方）。

**② 反向气味：只有一个内部调用方的 public service method。** 逐字：

> Inverse smell: a public service method with one internal caller — pass a private capability closure instead (`RunCodeBridgeOptions`).

→ **可执行化**：grep 每个 public service method 的调用点。恰好 1 个且是内部调用 → 改成私有闭包。这条的价值在于它给出了**"public 的正当性标准"**：不是因为它是方法，是因为它有多个/外部调用方。

**③ Require evidence for public choices.** 逐字：

> Configurability does not justify an unsupported default, public operation set, format, or imported external concept. Use current-consumer evidence or relevant prior art; otherwise require an explicit value or defer the choice.

→ **可执行化**：每个默认值要么附"当前消费者证据 / 相关先例"，要么**不给默认值、强制显式传值**，要么推迟决定。它防的是 agent 最爱的动作：`maxRetries = 3` 这种凭空冒出来的默认值——一旦写上，它就变成了别人依赖的契约。注意它连 `imported external concept`（照搬外部框架的概念）都禁。

**④ Design Service Definitions for all current Consumers.** 逐字：

> Keep tool-schema, Loader, UI, transport, and provider-specific behavior in the Consumer or provider; do not let one Consumer dictate the service contract.

→ **可执行化**：定义接口时，先列出**当前所有** consumer，找它们的**交集**；任一 consumer 独有的需求下沉到它自己。反模式是"第一个消费者顺手往接口里加的字段"。配套的反向气味见 ②。

**⑤ Enforce a decision in the operation that makes it.** 逐字：

> **Schema omission, prompt filtering, facades, wrappers, and listener order are not enforcement when direct or alternate callers can bypass them; test denial through the executor.**

→ **可执行化**：这是全篇最硬的一条。它列出了 **5 种伪装成强制的手段**（schema 缺字段、prompt 里过滤、facade、wrapper、listener 顺序），并给出验收方式：**在 executor 上测拒绝**。也就是说：不要测"模型没看到这个字段"，要测"拿着这个字段直接调 executor 会被拒"。这跟 Lesson 5 是同一条原则在另一个面上的投射——**元数据不是强制**。

### 补充规则（同文件，同样可执行）

- **Publish state only at its commit point.**（"Emit each notification and update derived state only after the operation succeeds; derive caches, prompts, UI echoes, replay, and query views from one authoritative source."）→ 通知和派生状态都在成功之后再动；所有视图从一个权威源推导。
- **Apply bounds to the complete result.**（"Enforce byte, token, item, and time limits where the complete emitted or retained value, including wrappers and metadata, is known; test tiny and exact limits, oversized single chunks, and multibyte byte limits."）→ 限额要算上包装与元数据；**必须测 0/1 边界、刚好等于限额、超大批次、多字节**。这是把"设了限制"推进到"限制真的生效"的那一步。
- **Represent one asynchronous operation with one lifecycle controller or transaction.** → 一个异步操作只能有一个生命周期 owner；额外多出来的 readiness/cancellation/disposal/reservation/sentinel 状态，要么有独立 owner，要么合并。
- **Product-visible plugins require a non-unit REAL-composition test.**（"Hand-built `ctx.plugin(...)` suites are insufficient. Boot test-only `cordis.yml` through the Loader and app/process; mock only external services or nondeterministic inputs and assert model-visible, durable, or user-visible output."）→ **手搓的插件测试不算数**，必须走真实 Loader 入口。这条直接对应 postmortem 0001 的教训。

### 删除证据工作流：`dsh-find-simplifications`

`.agents/skills/dsh-find-simplifications/SKILL.md` 的核心要求逐字：

> For each candidate, record the current owner, effective producer/consumer path, what disappears, what remains, and the strongest reason to retain it. Distinguish:
> - removal of unreachable or unread behavior;
> - a narrower public or product behavior with an explicit loss;
> - a protected obligation or insufficient evidence.

以及两条防"假简化"的判据：

> Reject a candidate when it breaks a retained obligation, **merely relocates the same complexity**, or has no meaningful reduction.

> A library that covers framing but requires rebuilding the same framing to enforce a size limit is not a simplification.

并且它对**证据**的要求很硬：

> Start with `rg`, then read the matches. ... **Tests and declarations can show a contract without proving a shipped producer or consumer.**

以及一条防止"删了就跑"的：

> Public third-party extension paths can be intentional despite zero repository call sites.

→ 可迁移：给删除动作定义"证据等级"——**有 shipped producer/consumer 才算可达**，测试和类型声明不算。

### 被否决提案的纪律：`rejected/` 目录

仓库有 `rejected/` 生命周期，且**保留条件写得很克制**——`.agents/notes/README.md` 逐字：

> **`rejected/`** — the proposal was considered and declined. **Keep it only while its rationale prevents a tempting, meaningful mistake; otherwise delete the complete triplet.**

`Status:` 行是 rejected 唯一带内容的形态（README 逐字）：`Status: rejected — <why, in one line>`，理由是 `because a rejected Agent Note's verdict is the fact readers come for`。

**两篇实例的力度**——`.agents/notes/rejected/simplification/2026-06-20-drop-durable-step-boundaries.md`：提案是删掉 `step/start`/`step/end`（因为每个 step 事件已带 `{turn, step}`），否决理由逐字：

> `step/end` is the durable indication that a model step finished, and keeping the symmetric `step/start` / `step/end` pair makes crash repair, invariants, and transcript inspection clearer than inferring completion from adjacent step-scoped events.

并且正文明确写了"放弃了什么"：`The log no longer records "a model request started but produced no event before the process died" as a durable fact` —— **拒绝记录里保留的是"我们放弃了什么能力"**，不是"我们谁赢了"。

`.agents/notes/rejected/architecture/2026-06-16-typed-event-schemas.md` 更能说明这种纪律：提案是给事件词汇表上运行时 schema（Zod），它**做了完整的 blast radius 测量**（6 个 merge-extensible map ≈370 LOC、~10 个 declare module 扩张点、16 个 `session.append` 调用点、~7 个 switch 消费者……），然后给出**比例恰当的替代路线**（Option B：用仓库既有的 schemastery 只校验封闭的 header/metadata 形状），最后结论是 `Defer.`。它连"Zod 目前只是 pi-ai 的传递依赖、仓库既定 schema 库是 schemastery"这种依赖事实都核过。

⚠️ 注意：这两篇都带 `<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->` 祖父条款注释（格式规则 2026-07-05 才生效，这两篇在此前）。所以**不要把它们当作"rejected 必须写 Alternatives considered"的例证**——按现行规则 rejected 也必须带该章节，这两篇是历史豁免。

### 可迁移做法

1. 把上面 5 条硬规则原样抄进你项目的 `AGENTS.md`（它们是通用设计规则，不是 dsh 特有的）。
2. 对 ⑤ 建立验收模板：**每个"我们禁止 X"的决定，都要有一条在 executor 上直接调用 X 并断言被拒的测试**。测试"模型看不见 X"不算。
3. 建 `rejected/` 目录，格式只要两行：`Status: rejected — <一句话理由>` + `## Problem`（原提案）+ 提案时代章节。保留判据用原文：**只有当它的理由能阻止一个诱人的、有意义的错误时才保留**。
4. 删除类提案走"证据三级"：unreachable/unread → 可删；narrower public behavior → 需显式记录损失；protected obligation / insufficient evidence → 驳回。
5. 给每个包配一个 `## Known Limitations`，并且用 `verify-*` 强制"必须存在或有正当豁免"（仓库里对应 `scripts/verify-package-readme-limitations.ts`）。

---

## Lesson 7 ★★★★☆｜上下文压缩：分层降级，先裁剪再总结，触发阈值算进去三件事

**一句话结论：长跑 agent 的上下文管理不该是"到顶了总结一下"，而应是**分层降级管线**——先用零模型调用的裁剪（可能直接解决问题），再上总结（花一次模型调用），并且阈值必须把输出预留和 headroom 一起算进去。**

### 源码证据：五个包的职责切分

`packages/compaction/` 下有 5 个子包：`compaction`（抽象契约）、`compaction-basic`（默认后端）、`compaction-tool-result-pruner`（裁剪）、`compaction-image-offload`、`command-compact`（`/compact` 命令）。

**触发公式**（`packages/compaction/compaction-basic/README.md:62`）逐字：

> All settings are optional. With context window `W`, effective request output cap `O`, and headroom `B`, the default trigger is `floor(min(W × 0.8, W − O − B))`, where `B = 65,536` tokens. Retention keeps the newest 16% of `W − O` verbatim.

默认值（同文件表格）：`thresholdRatio` `0.8`、`headroomTokens` `65536`、`retainRatio` `0.16`、`compactionRetries` `1`、`maxOverflowRetries` `1`、`auto` `true`。

**注意这个公式为什么取 min**：`W × 0.8` 是比例直觉，`W − O − B` 是硬约束（你得给输出和余量留位置）。两者取小意味着**小窗口模型上硬约束赢**。README 明确要求配置失败要快（`:78`）：

> Misconfiguration fails fast: unknown settings, duplicate per-model overrides, invalid token counts, both retention forms together, or a retention ratio at least as large as the threshold ratio reject the plugin at load.

**分层降级**——pruner 在 basic 之前（`compaction-tool-result-pruner/README.md:90` 引 basic README）：

> Mount `dsh-compaction-tool-result-pruner` before this package to trim oversized tool results as part of condensation. **Trimming makes no model call and can remove the need to summarize at all**: when the trimmed conversation fits within the threshold, condensation skips the summary. Trimming only runs after a condensation trigger qualifies — a below-pressure conversation is never touched.

pruner 的默认策略（`compaction-tool-result-pruner/README.md:48`）：超过 8192 字符的结果 → 前 4096 + `\n\n[... tool result middle pruned ...]\n\n` + 后 1024。

**两条非常工程化的设计**：
1. **确定性的单趟收敛**（`:76`）：`Slicing is by Unicode code point with fixed budgets, so every emitted result has exactly the configured head, marker, and tail ... and is strictly smaller than the triggering input.` —— 保证裁剪不会越裁越大、不会反复重裁。
2. **影子定价协议**（`:78`）：`compaction/prune` 事件**紧邻**它替换的内容，通过注入的 token meter 给**被替换的那个精确区间**定价，让纯消费者无需维护逐节点状态就能做减法。

**有界失败 + 幂等**（`:44`）：`If a replacement cannot be recorded, the run fails and the trims already applied stay in place.`（已经应用的裁剪保留——不假装回滚）

**bracket 即锁**（`compaction/README.md`）：`compaction/start` 在总结让出之前追加，`compaction/end` 释放；`every failure makes exactly one close attempt, and a failed close leaves the unmatched start as the intentional busy signal.` —— **未配对的 start 本身就是"正忙"信号**，不需要额外的标志位。

**诚实边界**（`compaction-basic/README.md:245`）逐字：

> **Some indivisible-unit and envelope-only overflow remains outside surface compaction** — recovery cannot shrink system/tools/prefix, split an indivisible non-tool node, or repair a tool unit whose non-prunable remainder still exceeds the window.

以及两条"未定"（`:257-259`）：

> - **Default ratios, undecided** — `thresholdRatio: 0.8` and `retainRatio: 0.16` are fixed defaults; per-model tuning via `modelPolicies` exists, but **no corpus-backed guidance on ideal values is recorded**.
> - **Overflow recovery beyond canonical errors, undecided** — recovery triggers on `CONTEXT_WINDOW_EXCEEDED` only.

——`no corpus-backed guidance ... is recorded` 这种措辞值得学：**把"我们拍了个数但没有数据支撑"明说出来**，而不是让读者以为 0.8 是调优结果。

**overflow 恢复是另一条路径**（`:113`）：`agent/request-error` 监听器对 provider 确认的 `CONTEXT_WINDOW_EXCEEDED` 做出反应，**绕过常规阈值与保留策略**，做一次最大化的平衡头部削减，并且**只有在 surface replacement generation 前进之后才允许重试**。

**保留原始**（pruner README `:78`）：`The original event remains in the append-only log; the replacement cites it through `sourceEventSeqs`, so replay recovers the exact input that produced the pruned result.`

### 可迁移做法

1. 触发阈值不要只写 `W × ratio`。用 `floor(min(W × ratio, W − outputReservation − headroom))`，并在配置解析时对"输出+headroom 撑爆窗口"、"retain ≥ threshold"这类组合**在加载期直接拒绝**，不要等运行时。
2. 压缩做成分层：**先无损可逆的裁剪（不花模型调用）→ 再总结（花一次）**。裁剪后重新测量，够用就跳过总结。
3. 裁剪规则要**确定性且严格收缩**：固定头+标记+固定尾、按 Unicode code point 切（不劈开代理对）、保证输出严格小于输入。
4. 给"被替换的区间"单独发一个定价事件，让下游能无状态地做 token 记账。
5. 所有替换都**保留原始事件、只追加引用**（`sourceEventSeqs`）——压缩不能破坏可重放性。
6. 用 bracket（start/end 事件）做互斥；**未配对的 start 就是 busy 信号**，不要额外加锁标志。
7. 把"压缩解决不了的溢出"（系统提示词本身过大、单个不可分割的大 tool call）明确写成 limitation，别让人以为它能兜底一切。

---

## Lesson 8 ★★★★☆｜会话 = 只追加事件日志：让状态可重建，而不是被维护

**一句话结论：把 agent 的全部模型可见事实写进一条只追加日志，且**任何进入模型请求的东西都必须能从日志重建**——这样 replay/fork/审计/压缩全部变成日志上的纯函数，而不是各自维护一套状态。**

### 源码证据

`packages/core/session/README.md:12` 逐字：

> `dsh-session` records every model-visible fact in an append-only session log and derives model history from that record. Consumers can inspect, replay, fork, and flush sessions while preserving historical events; **compaction hides superseded entries from the active conversation without deleting them**.

`:88` 逐字（event sourcing 的完整表述）：

> The package is built on event sourcing: a `Session` is an append-only log of typed `SessionEvent`s, and everything else — model history, transcripts, telemetry, titles, persistence — derives from that stream. The surface is a derived projection: an incremental manager validates append candidates, advances the ordered view from committed events, and tracks `replaceGeneration` for positional replacements and `contentGeneration` for replacements and plugin-owned message changes. **Model-visible means logged: anything that reaches a model request must be reconstructable from the log.**

`deriveMessages()` 的重建机制（`:42`）：

> `session.append(type, data, opts?)` commits one typed event — it snapshots and freezes the payload, validates it as lossless JSON, and notifies observers. `session.deriveMessages()` projects the log into the `Message[]` the model sees, **incrementally and cached**.

`:112` 的关键细节：

> `deriveMessages()` caches deep-frozen projections and returns **a fresh array per call**. ... Replacements and projection decisions invalidate the cache.

——**深冻结 + 每次返回新数组**：调用方无法通过修改返回值污染缓存，也无法通过共享引用产生隐式耦合。

**请求也是日志的纯函数**（`:92`）逐字：

> `request/header` stores a full canonical snapshot of the non-history request envelope with reason `initial`, `resume`, `change`, or `series`. ... **This self-contained record supports partial-window rendering and exact reconstruction at the cost of growth per message series.**

`:116` 说得最直接：

> `foldRequestHeader(events)` reconstructs it by selecting the latest snapshot, making **every conversation request a pure function of the log**.

**fork 的实现**（`:68`）逐字：

> `ctx.sessions.fork(source, boundary?, childSessionId?)` copies an exact inclusive event prefix (default: the last event) from a live source. `buildForkSeed` in `dsh-session/fork` places an inherited marker after the copied events, adds missing error tool results only for the open step, and closes that step and turn with a `forked` reason. **Closed steps and turns remain unchanged**, including historical missing results.

注意几个精确设计：
- fork **不改写历史**：已关闭的 step/turn 原样保留；
- 只有**未闭合**的 step 会被补上缺失的 error tool result 并用 `forked` 原因闭合；
- `inheritedEventCount` 记录拷贝前缀的长度，`ownEvents()` / `isOwnSeq(seq)` 区分"继承的"和"自己的"事件（`:70`）；
- 连**恢复时的合成结果文案**都区分了两种未知（`:156`）：`TOOL_NOT_STARTED`（有请求没有 call 记录）vs `TOOL_OUTCOME_UNKNOWN`（有 call 没有结果），后者明说 `Do not retry blindly.`

**崩溃修复的诚实性**（`:156`）——fork 生成的结果只说继承前缀里的事：

> Fork-generated results describe only the inherited records: the parent may have started or completed a call after the selected event.

**压缩与追加日志的关系**（`:150`）：

> Appended surface entries preserve reusable prefixes. A `replace` operation invalidates reuse from the first shadowed message **even though the underlying event log stays append-only**.

——KV-cache 的失效是**投影层**的事，不破坏日志的只追加性。这是分层的价值。

### 为什么只追加日志（而不是可变状态）

1. **可重放**：同一条日志 + 同一份代码 → 同一段会话。这意味着 bug 可复现，而不只是"我们复现不了"。
2. **可 fork**：fork 只需要一次前缀拷贝 + 一句闭合规则。可变状态下，fork 要深拷贝整棵状态并解决所有跨引用。
3. **可审计**：每一次模型看到的内容都能追溯到具体事件（配合 Lesson 2 的运行时断言，这个追溯是被**持续验证**的，不是声称的）。
4. **压缩是投影而非破坏**（`:12` "without deleting them"）：压缩只改变"活动视图"，原始记录仍在，replay 依然确定。
5. **新增模型可见输入有唯一正确做法**（`docs/architecture.md:125`）：`A new model-visible input requires a session event.` —— 新需求不会导致"顺手在内存里塞一个字段"。
6. **状态派生而非维护**：README `:98` 的 source map 里，`SessionStore` 一个服务同时支撑 store 生命周期/fork/flush，因为没有第二份状态要对齐。

### 可迁移做法

1. 定义一条铁律：**凡进入模型请求的内容，必须能从日志重建**。然后写一条运行时断言去验证它（这是 Lesson 2 那条断言存在的理由）。
2. 每个事件在 append 时**快照并冻结** payload，并校验可无损 JSON 序列化（拒绝 BigInt/函数/循环引用/非有限数）。
3. 推导函数（`deriveMessages` 类）缓存**深冻结**结果，但**每次调用返回新数组**——冻结防污染，新数组防耦合。
4. 把"请求信封"（model/temperature/maxTokens/tools/stop）作为独立快照事件记录，并标注原因（initial/resume/change/series）。这样任何历史请求都能被**精确**重建，而不是近似复原。
5. fork = 拷贝前缀 + 标记 + **只闭合未闭合的单元** + 记录继承长度。绝不改写已闭合的历史。
6. 压缩实现成 **surface replacement**（追加替换事件 + 引用原事件），保持底层日志只追加。
7. 恢复时对"未知结果"分级：分不清"没开始"和"开始了但结果不明"，并对后者给出明确的重试判据（只重试只读或幂等操作；有副作用的先验证外部状态或问用户）。

---

## Lesson 9 ★★★★☆｜CoT 泄漏治理：给 agent 写的文档一个"HEAD 视角"判据

**一句话结论：当文档由 agent 写，"推理过程的残留"会成为主要噪声源；治理它的核心是**一条可判定的测试**——"一个站在 HEAD、看不到任何会话记录/PR 线程/未提交草稿的读者，能不能解析每一个引用并验证每一条断言？"**

### 源码证据

`.agents/skills/dsh-trim-cot-leakage/SKILL.md` 给出了定义与那一条测试。定义逐字：

> Chain-of-thought leakage is prose whose vantage is the authoring session rather than the repository: it cites artifacts only that session could see, narrates the change instead of the state, or argues with a reviewer who has left.

**The one test** 逐字：

> For every suspect passage ask: **could a reader at HEAD, with no access to any session transcript, PR thread, or uncommitted draft, resolve every reference and verify every claim?** If no, restate the surviving facts from the repository's vantage and delete the rest. If yes, it is not leakage, however historical it sounds — but resolvability only clears this skill's bar: on current-state surfaces (READMEs, docs, JSDoc) a resolvable change story is still change narration, and class 3 routes it to its sanctioned home.

**修复原则**（不是删了就完）逐字：

> The fix is never deletion alone when a passage carries factual clauses — restate each so it stands at HEAD, then delete the transcript around it; a passage carrying none (an audit code, control-flow narration) is deleted outright.

### 八类分类法（原文照抄）

1. **Dead design-session citations** — `(decision 7)`、`(audit C2)`、`design §4.7`、`plan §1.4`、阶段标签（`T4`、`W3`、`P-I`）、"the design ledger"、"(B ruling)"。如果该决定有已提交的 owner，按名字与路径引用它；否则删掉引用、把事实从句重述成能独立成立的句子。
2. **Stack and PR vantage** — "a later PR in this stack"、"this PR adds"、"the previous commit"。改为陈述已发布的机制或扩展点；延后工作移到 `TODO` 标记或 issue 引用。
3. **Change narration and version stamps** — "used to"、"no longer"、"the old X"，以及指示性时间戳（"v1"、"this cut"、"today"、"now" 与过去状态对比）。陈述当前行为；固定的回归改成现在时反事实（"without X, Y happens"），**绝不用仓库历史**（"used to Y"）。
4. **Review choreography** — "Rejected in review:"、"the reviewer confirmed"、草稿序号（"v5 of this note"）、轮次归属。保留幸存的决策与理由作为陈述事实；**删掉"谁在什么时候说的"**。
5. **Reviewer-addressed justification** — "the cast is safe — it simply…"、"this is correct because…"。评论在论证自己的正确性时，是在对一个 reviewer 说话，不是在跟维护者说话。改为陈述让代码安全的那条不变式，或删掉。
6. **Restatement and derivation transcripts** — 控制流叙事（"first we X, then we Y"）、测试走查、显而易见分支的证明。删除；只保留非显然的契约或不变式。
7. **Hedges and planning residue** — "probably fine for now"、"should be enough"、没有标记的延后项。升级为 `TODO`/`FIXME`，或重述为实际的界；删掉 hedge。
8. **Authoring-language slips** — 在英文散文中混入未翻译的工作语言片段，或 zh 对应文件里的反向情况。翻译或删除。

### 边界同样被精确划定（"What is not leakage"）

这份清单比分类法更有价值，因为它防止**过度修剪**。逐字要点：

- **Issue references** — `#1470`、`TODO(name):`、"issue #N owns the follow-up" 在 HEAD 可解析，**在包括 README 在内的任何面上都保留**。不要把它们搬去 Agent Notes。
- **Merged-PR and issue citations inside Agent Notes and postmortems** — 文档标准认可的**证据**。
- **Suppression justifications** — `oxlint-disable … -- reason`、覆盖率忽略理由、空 catch 说明是**必需的散文**；修正一条假理由，但绝不删除。
- **Counterfactual-present regression pins** — "without X, Y happens"、"a naive X would…"。
- **Measured bounds** — "(measured: 512 nests ≈ 0.15s)"；**"measured" 这个词是承重的**。
- **Runtime old/new states** — "the old connection drains before the new one accepts" 是运行时生命周期，不是变更史。
- **Historical stage names inside a note's change-story sections** — "the first cut shipped X" 在那里是当前态安全的；指示性时间戳（"this cut"）到处都禁。
- **External references that resolve outside the repo by design** — 标准章节（RFC 9110 §10.1.5）、Figma frame 名；§-禁令覆盖的是未提交的内部草稿，不是外部标准或已提交文档。
- **Project voice and genre forms** — "we" 作为项目口吻；note 的 Alternatives-considered 章节。

### 工作流里两个防自欺的细节

**审计先只读，且要校准探针**（Workflow §2）逐字：

> Audit read-only first: run the [recall batteries](references/recall-batteries.md) (with `--hidden` so `.agents/` is searched), **calibrating each probe against a known positive and a near-miss negative before trusting its output**, then judge every hit semantically. **The batteries are probes, not the definition** — each review round of the original purge found cases the batteries missed, so also read the densest prose in scope (module JSDoc, READMEs, Agent Notes) without a pattern in hand.

——两个关键：探针要**用已知正例和近似负例校准**；以及**正则不是定义**，必须人工读最密集的散文。

**删之前先防止过度修正**（Workflow §4）逐字：

> Before deleting anything, enumerate the passage's propositions (prose-standard) and check the [overcorrection traps](references/examples.md#overcorrection-traps): trims that **flip an obligation into an endorsement, promote a hypothetical to a shipped feature, delete a true fact, or drop the evidence source.**

——四类过度修正陷阱被点名，每一类都是"修完反而更糟"的具体形态。

### 可迁移做法

1. 把"那一条测试"原样写进你项目的 writing guide，并**在 review 模板里作为第一问**：每个可疑段落，能否被一个只看 HEAD 的读者解析与验证？
2. 建 8 类分类法（可直接抄这份），并在每类下面配**你项目里的真实例子**——分类法没有例子不会被使用。
3. **同样重要的是建"什么不是泄漏"的保留清单**，尤其是：issue 引用、抑制理由（lint-disable 的原因）、"measured" 标定的常量、运行时新旧状态描述。没有这份清单，修剪会退化成删掉真实信息。
4. 把探针脚本化，但写明"**探针是探针，不是定义**"，并强制人工读最密集的几处散文。
5. 删之前先枚举该段落的**命题**，逐个检查是否踩了四类过度修正陷阱。
6. 修复方式优先"重述事实从句"，而不是直接删除——因为大部分可疑段落里混着真事实。

---

## Lesson 10 ★★★★☆｜流程纪律：Agent Notes 四态生命周期 + 强制"考虑过的替代方案" + 事故→闸门闭环

**一句话结论：决策记录的价值不在"记下了决定"，而在"记下了它打败了什么"——否则同一个提议会周而复始地重新被提出；而事故的价值不在"修好了"，而在"生出了闸门"。**

### 10a. 四态（实为三态 + 冻结存档）生命周期

`.agents/notes/README.md` 逐字：

> Every Agent Note has two axes, both encoded in its **path** — `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`

三个生命周期（`:7-13`）：
- **`proposed/`** — 实施前评审的提案，尚未构建；
- **`implemented/`** — 决定已发布。`The file records what was decided and what was rejected, and is **kept current with what actually shipped**`（不是写死的历史快照，而是跟着代码走的事实记录）；
- **`rejected/`** — 被考虑并否决。`Keep it only while its rationale prevents a tempting, meaningful mistake; otherwise delete the complete triplet.`

另有**冻结归档树** `archived/{class}/`（`implemented` 刻意缺席——只有 implemented 能进归档），一旦封存**永久冻结**：`Do not edit, translate, reformat, update, move, or delete it`，且 `do not treat it as authority for current behavior`。

分类是**封闭集合**（`feature` / `bug-fix` / `simplification` / `architecture` / `process` / `testing`），由 `scripts/agent-note-tree.ts` 定义，`Adding a class requires updating the canonical set and this section.` 注意 `refactor` 被**故意排除**，理由逐字：`it overlaps `simplification`, whose discriminator, "does observable behavior change?", already covers it.`

**状态与目录必须一致**，由闸门交叉校验——`scripts/verify-agent-note-format.ts:20-25`：

```ts
const STATUS: Record<string, RegExp> = {
  proposed: /^Status: proposed$/,
  implemented: /^Status: implemented$/,
  rejected: /^Status: rejected — .+$/,
}
```

而 `Status:` 行**不带日期、不带括注**（README）：`the filename holds the first-proposed date, git holds everything else`。

### 10b. 强制 `## Alternatives considered` 与那句杀手锏

`.agents/notes/README.md` 逐字：

> ### Alternatives considered — mandatory
> Every Agent Note carries an `## Alternatives considered` section: each genuine alternative and why it lost, one bold-led paragraph per alternative or a `### Why not <X>?` subsection per contested one. **A decision recorded without what it beat invites re-litigation — the failure Agent Notes exist to prevent.**
> Alternatives are recorded, **never invented**.

闸门实现 `scripts/verify-agent-note-format.ts:78-81`：既没有该章节、也没有祖父条款注释 → fail；两者同时存在 → fail。

而 `2026-07-05-uniform-agent-note-format.md` 的 Consequences 段把这句话又说了一遍，并加了"这是刻意摩擦"的定性：

> the mandatory `Alternatives considered` section is **deliberate friction**: a decision recorded without what it beat invites the re-litigation Agent Notes exist to prevent.

同一段还保留了一句对"诚实"的承诺：

> Pre-format Agent Notes whose alternatives were not reconstructible carry the grandfather comment permanently — **an honest gap on the record rather than fabricated rationale**.

——**宁可留一个明写的空缺，也不编造理由**。这条纪律值得单独抄走。

### 10c. 事故 → 闸门闭环：4 篇 postmortem，4 组闸门

`docs/postmortem/README.md` 定义了写作门槛逐字：

> Write one when a bug is **subtle** (the mechanism is non-obvious and a careful engineer would re-derive it the hard way), **systemic** (the reason it escaped is a gap in tests/tooling/conventions, not a one-off typo), and **costly to rediscover** (it cost real debugging time, and would cost it again). **Link the guardrails (tests, AGENTS.md rules, ADRs) the post-mortem motivated.**

并且明确与 Agent Note 划界：`A post-mortem is NOT an Agent Note` —— 一个是"刻意决策与其被否替代方案"，一个是"失败的回溯记录：什么坏了、机制、为什么每个安全网都没拦住、加了什么护栏"。

四篇的 `## Guardrails added` 都落地成了**具体产物**：

- **0001**（ACP default export 丢 inject）→ 删掉 `export default apply`、改用 `ctx.get('sessionPersistence')`、加**无 API key 的真实 stdio e2e**（`:104` 且注明 `Verified it fails when `export default apply` is restored.`）、修 tsx 路径解析使测试跑**源码**而非旧构建、**写进 `docs/testing.md` 的规则**："test the real entry path", line coverage is not behavior coverage。
- **0002**（`!!js` 字面量永久禁用了文件系统工具）→ 显式 overlay 配置、`AGENTS.md` 与 Cordis primer 声明哪些字段才接受表达式、**`verify-cordis-config` 这个闸门本身**、snapshot 对新运行拒绝结构化 `UNKNOWN_TOOL` 结果。
- **0003**（Web agent 验证了一个替代服务器而非它自己的 GUI）→ launcher 发布规范 loopback URL 到日志化的 prompt 段与 `$DSH_WEB_URL`、standalone Vite serve 在配置期直接拒绝、分层真实路径测试、**PR 证据必须保留截图与真实模型的 GUI 前后对比**。
- **0004**（Landlock partial-enforcement 通知被误分类为子进程失败）→ `RunnerFailureRule` 增加可选退出码/逐行致命签名/精确信息行豁免、`dsh-sandbox-local` 明确映射退出码 125、`partial-landlock.spec.ts` 回归用例、**snapshot composition 独立于实现选择钉住**组装路径。

每篇还都带 `## Lessons` 段，把教训写成可复用的句子。0003 的四条逐字：

> - The agent must know hidden runtime prerequisites before it can guide the user; startup mode is application context, not tribal knowledge.
> - HTTP readiness, build success, and a boot manifest are different facts. Acceptance names the exact origin and externally observes the requested change there.
> - A replacement service cannot prove that an existing page changed.
> - A regression test must be able to fail for the reported mechanism. Process timeout is not equivalent to fail-fast, and post-exit port availability does not prove the port was never bound.

——最后一条特别值得抄：**回归测试必须能为所报机制而失败**。0003 的 Root cause 段记录了第一版回归测试自己犯的同类错误：`a timeout killed Vite and satisfied a nonzero-exit assertion. Live reproduction exposed that false positive.`

### 可迁移做法

1. 建 `{lifecycle}/{class}/` 路径编码的决策记录目录，生命周期三态 + 冻结归档。路径编码让**分类与状态本身可被闸门检查**，不需要索引文件（仓库明确禁止 `Do not add a centralized INDEX.md`）。
2. `## Alternatives considered` 设为**强制且被闸门检查**。写不下真实替代方案时，用一条显式的 grandfather 注释留下**诚实的空缺**，而不是编理由。
3. 每次状态迁移（proposed → implemented）强制重写正文（`## Proposal` → 现在时的 `## Decision`），并让闸门在迁移时 fail——**迁移的代价当场付清，而不是留给一个没人跟踪的后续清理**。
4. 建 postmortem 门槛：subtle + systemic + costly to rediscover 三者齐备才写。每篇必须有 `## Guardrails added`，且每条护栏要**指向具体文件/测试/规则**，并能回答"你把旧代码恢复回去，它会红吗"。
5. 让 postmortem 的产出**回流到 AGENTS.md**（0001 和 0002 都这么做了）——这样同类错误对新来的 agent 是显式禁忌，而不是要它自己再踩一次。
6. 归档政策用"**校准的工作流**而不是字数/年龄/配额"——README 逐字：`Use the calibrated [`dsh-archive-agent-notes`](...) workflow rather than word count, age, or a target quota.`

---

# 可直接引用的金句（10–15 条，全部核对过原文）

| # | 英文原文（逐字） | 出处 | 建议中文 |
|---|---|---|---|
| 1 | "This codebase is developed primarily by coding agents. Agents follow enforced gates far more reliably than prose conventions, and 'a lot of work' is not a cost argument when agents do the labor." | `.agents/notes/implemented/process/2026-06-11-quality-gates.md:13` | 这个代码库主要由编码 agent 开发。Agent 服从被强制的闸门，远比服从散文式约定可靠；而当干活的是 agent 时，"工作量大"根本不算成本论据。 |
| 2 | "Every mechanically checkable AGENTS.md promise gets a command that exits non-zero." | 同上 `:19` | 每一条机械可检查的 AGENTS.md 承诺，都必须有一条退非零的命令。 |
| 3 | "A useful runtime invariant relates observations over time or across a mutable data structure. … Merely confirming that a declared method exists, that a plugin has its expected name, or that a constant example still returns a known value is not such a relation." | `.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md:13` | 有用的运行时不变式，断言的是**随时间或跨可变数据结构**的观测关系；仅仅确认某个方法存在、插件名字对、某个固定例子仍返回已知值，都不算这种关系。 |
| 4 | "**Model-visible means logged.** Anything that reaches a model request must be reconstructable from the log, and a runtime invariant asserts it." | `docs/architecture.md:125`（同义表述见 `packages/core/session/README.md:88`） | **模型可见即已记录。** 任何进入模型请求的东西都必须能从日志重建——而且有一条运行时不变式在断言这件事。 |
| 5 | "anything the StreamChunk vocabulary cannot express for BOTH implementations is a core-vocabulary bug" | `.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md:19` | 凡是 StreamChunk 词汇表在**两个**实现上都表达不出来的东西，就是核心词汇表的 bug。 |
| 6 | "**A mock second adapter** — cheaper but doesn't exercise a real provider's wire quirks, so it proves little. The twin is real-on-real." | 同上 `:25` | **用 mock 做第二个适配器**——更便宜，但它不跑真实 provider 的线缆怪癖，所以证明不了什么。孪生必须真对真。 |
| 7 | "Treating a teammate name or task owner as a file lock would hide rather than solve this concurrency boundary." | `.agents/notes/implemented/feature/2026-08-05-agent-teams.md`（Problem 段） | 把队友名字或任务 owner 当作文件锁，只会**掩盖**而不是解决这个并发边界。 |
| 8 | "rejected because external writers bypass them, crashed owners remain durable, and path-prefix overlap cannot prove semantic independence. **False mutual exclusion is more dangerous than an explicit warning.**" | 同上（Alternatives 段） | 否决理由：外部写入者能绕过、崩溃的 owner 会永久留存、路径前缀重叠推不出语义独立。**虚假的互斥比显式的警告更危险。** |
| 9 | "views warn on overlap with in-progress tasks but never block claim or authorize writes." | `packages/experimental/agent-team/README.md`（Shared task board 段） | 视图会对与进行中任务的重叠发出警告，但**从不阻止认领，也不授权写入**。 |
| 10 | "Schema omission, prompt filtering, facades, wrappers, and listener order are not enforcement when direct or alternate callers can bypass them; test denial through the executor." | `packages/AGENTS.md`（Enforce a decision in the operation that makes it） | schema 缺字段、prompt 过滤、facade、wrapper、监听器顺序，在直接或替代调用方能绕过时**都不是强制**；要在 executor 上测试拒绝。 |
| 11 | "Inverse smell: a public service method with one internal caller — pass a private capability closure instead." | `packages/AGENTS.md`（Design Service Definitions for all current Consumers） | 反向气味：只有一个内部调用方的 public service 方法——改成传一个私有的能力闭包。 |
| 12 | "Configurability does not justify an unsupported default, public operation set, format, or imported external concept." | `packages/AGENTS.md`（Require evidence for public choices） | "可配置"不能成为无依据的默认值、公开操作集、格式或外来概念的正当理由。 |
| 13 | "could a reader at HEAD, with no access to any session transcript, PR thread, or uncommitted draft, resolve every reference and verify every claim?" | `.agents/skills/dsh-trim-cot-leakage/SKILL.md`（The one test） | 一个站在 HEAD、看不到任何会话记录、PR 线程或未提交草稿的读者，能不能解析每一个引用、验证每一条断言？ |
| 14 | "A decision recorded without what it beat invites re-litigation — the failure Agent Notes exist to prevent." | `.agents/notes/README.md`（Alternatives considered — mandatory） | 一个没有记下"它打败了什么"的决定，会招致反复重提——这正是 Agent Notes 存在的意义所在。 |
| 15 | "Pre-format Agent Notes whose alternatives were not reconstructible carry the grandfather comment permanently — an honest gap on the record rather than fabricated rationale." | `.agents/notes/implemented/process/2026-07-05-uniform-agent-note-format.md`（Consequences） | 无法重建替代方案的旧格式 Agent Note 永久携带祖父注释——**记录上一个诚实的空缺，而不是编造出来的理由**。 |
| 16 | "the reason it escaped is a gap in tests/tooling/conventions, not a one-off typo" | `docs/postmortem/README.md` | 它能逃逸出去的原因，是测试／工具／约定上的一个缺口，而不是一次性的笔误。 |
| 17 | "Reject a candidate when it breaks a retained obligation, merely relocates the same complexity, or has no meaningful reduction." | `.agents/skills/dsh-find-simplifications/SKILL.md` | 当一个候选方案破坏了仍需保留的义务、只是把同样的复杂度搬了个地方、或者没有实质性的削减时，就否决它。 |
| 18 | "Trim `head` + marker + `tail`… **Character budgets are not token budgets** — provider token density varies, so `ctx.tokenMeter` remains the authority for deciding whether trimming relieved request pressure." | `packages/compaction/compaction-tool-result-pruner/README.md:134` | 字符预算不是 token 预算——各 provider 的 token 密度不同，所以判断裁剪是否真的缓解了压力，权威仍是 token meter。 |

---

# 未能验证 / 需要打折的项

诚实列出我**没有**在源码里找到逐字证据或与任务描述有出入的部分：

1. **✅ 已更正 —— "69 gates" 的口径**。`ls scripts/ | grep -c '^verify-'` 确实返回 **69**，但这 69 个里 **27 个是 `.spec.ts` 自检兄弟文件**。去掉后是 **42 个闸门本体**（含 `.ts`/`.mjs`/`.sh`）。所以"69 个闸门"应表述为"69 个 `verify-*` 文件 = 42 个闸门 + 27 个闸门自检"。**顺带这是个正面发现**：闸门与"验证闸门能红"的测试近乎成对，值得单独作为经验点（已补进 Lesson 1）。
2. **"ratchet-with-5%-headroom"** 不是逐字原文。见 Lesson 1 末尾的说明：它是 `scripts/verify-doc-budgets.ts:4`（`Ceilings ratchet down with at least 5% headroom`）与 `docs/AGENTS.md:58`（`At or below target, retain at least 5% headroom; above target, freeze the ceiling`）两处的合并表述。
3. **任务里说的 `packages/runtime-diagnostics/invariants/` 里找不到 `deriveMessages` 断言**。那个目录只是**中央不变式服务**（`dsh-invariants`：配置、注册唯一性、子 fiber 生命周期、回滚、处置、按包归因失败），它**明确不提供任何通用插件形状检查 helper**。真正的 `deriveMessages` 断言在 **`packages/core/agent-loop/src/invariant.ts:40-43`**（伴生插件），不是中央服务里。任务描述把两者混在一起了，我在 Lesson 2 里按实际代码写。
4. **`verify-doc-budgets` 的 manifest 只有 8 个条目**（`scripts/doc-budgets.manifest.json`），不是"所有文档"。文件头注释也说 `Only listed standing docs are budgeted.` 其余层级由 review 把关（`docs/AGENTS.md:58` 末句 `Review governs unbudgeted tiers.`）。
5. **`verify-translation-pairing` 的 manifest 是"显式排除清单"**，不是"待校验清单"（`scripts/verify-translation-pairing.ts:2-3`：`The manifest contains only explicit exclusions`）。我未逐一核对该 manifest 的内容。
6. **`.agents/notes/` 规模**：`find .agents/notes -name "*.md" -not -name "*.zh.md" | wc -l` = **1179**（含 `archived/`）。我没有按生命周期细分统计。
7. **Agent Teams 的 `maxMembers`/`maxTasks` 等默认值**取自 README 的表格（`16`/`256`/`64`/`65,536`/`5,000`），我**未**逐一到 `src/index.ts` 的 Config schema 里核对。
8. **「四篇 postmortem 全部产出闸门」** —— 我逐篇读了 `## Guardrails added` 段并确认每篇都列出了具体产物（第 10c 节），**但"全部"是就这四篇而言**；仓库当时只有 4 篇 postmortem（`docs/postmortem/` 目录列表确认）。
9. **`archived/` 归档树的存在与规则**来自 `.agents/notes/README.md` 的叙述与 `scripts/verify-archived-agent-notes.ts` 的存在；我**未**打开该脚本核对它到底强制了哪几条。
10. **Lesson 7 里 `compaction-image-offload` 包的职责我未展开**（只确认它存在于 `packages/compaction/` 下），因此本文对压缩管线的描述**不覆盖图像卸载那条路径**。
11. **✅ 已核实 —— HEAD 与提交数**。`git log -1` 给出 `00102833dfae Tue Sep 22 23:25:38 2026 +0800`（merge PR #4978，release dsh-0.1.7-alpha.2），`git rev-list --count HEAD` = **19,520**，与任务描述一致。但 **"since 2026-06-10" 这个起点我无法验证**：`git log --oneline 2026-06-10..HEAD` 返回 **0**（该日期字符串不被解析为 revision，需用 `--since` 且依赖本地提交历史的真实日期分布），所以我只能确认**总数 19,520**，不能确认这个总数全部产生于 2026-06-10 之后。
12. **`.agents/skills/dsh-find-simplifications/SKILL.md` 我读了全文**，但其中引用的 `references/historical-patterns.md` 与 `dsh-archive-agent-notes` 工作流**未读**。
13. **CoT skill 引用的 `references/recall-batteries.md` 与 `references/examples.md`（过量修正陷阱的具体条目）未读** —— Lesson 9 里我列出的四类过度修正陷阱取自 SKILL.md 主文的枚举，未展开参考文件里的实例。

---

*本文全部结论均来自 `/Users/zxnap/code/opensource/deepseek-harness` 的只读检视（HEAD `00102833dfae`）。未修改该仓库任何文件。*
