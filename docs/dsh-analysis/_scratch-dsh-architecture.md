# DeepSeek Harness (dsh) 真实源码架构分析

> **证据基准**：`/Users/zxnap/code/opensource/deepseek-harness`
> HEAD = `00102833dfaee1da9f48a3a8eae9d34005a75218`（2026-09-22，`Merge pull request #4978 from deepseek-harness/worktree/release-dsh-0.1.7-alpha.2`）
> 全部结论只读自真实仓库；每条都带 `path:line` 或逐字引用。**未经验证的内容一律不写**。
> 面向两拨读者：**(A) 普通 AI 产品用户** / **(B) Agent 开发者**。

---

## 0. 结论速览

dsh 不是一个「带插件系统的 agent」，而是**一个把 agent 本身也当作插件的 Cordis 微内核**。产品里每一个部件——模型适配器、工具注册表、会话日志、乃至 agent 循环本身——都是可替换的插件：

> "Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so each is replaceable from configuration."
> — `docs/architecture.md:11`

> "There is no privileged core to patch: you extend dsh by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads."
> — `docs/architecture.md:13`

---

## 1. Everything-is-a-plugin / Cordis 微内核

### 1.1 内核是什么：一个 service 仓库 + 可逆副作用

Cordis 的全部心智模型只有五条（`docs/cordis-primer.md:7-15`）：

- **A plugin is a object that implements Service.** 可以是带 `inject`/`apply(ctx)` 的函数，也可以是 `Service` 子类。
- **A context is a repository of services.** service 占据一个稳定的 `ctx.<key>`，如 `ctx.tools`、`ctx.llm`、`ctx.sessions`；别的插件靠 key 找服务，而不是 import 具体实现。
- **Declare service dependency via `inject`.** 「A plugin that names required services waits until those services exist, so load order is expressed through service requirements rather than manual boot sequencing.」
- **Typed Events for communication.** 事件名靠 TypeScript declaration merging 声明，再按 `emit`/`waterfall`/`parallel`/`serial`/`bail` 之一分发。
- **Registrations are reversible effects.** 一切注册走 `ctx.effect()` / `ctx.on()`，插件卸载时自动回滚。

`docs/cordis-primer.md:17-25` 给出五种分发模式的完整表格（是否 await、顺序、有无返回值）。**分发模式是事件的公开契约**，新事件要用 `@mode` 标注。

### 1.2 接缝（seam）：三角色缺一不可

> "A **seam** is a swappable capability with three roles: a **Service Definition** declaring the interface, a **Service Provider** implementing it, and a **Consumer** using it, commonly a model-facing tool. A package may combine roles, but one role alone is not a seam; adding a capability means designing all three"
> — `docs/architecture.md:131`

`docs/glossary.md:9` 把这一点钉得更死：Service Definition 必须是 Cordis `Service`（抽象类或具体注册表），**绝不是 TypeScript `interface`**；并且给出规范例：

> "`packages/shell` is the canonical example: `dsh-shell` (Service Definition), `dsh-bash-local` / `dsh-bash-sandbox` (providers), and `dsh-tool-bash` (Consumer)."

接缝的威力在于「换一个 provider，整个产品跟着换」：

> "Seams are why one provider swap changes the whole product. Filesystem and subprocess providers share one execution world, so pointing them at a remote sandbox moves Bash, PTY, and LSP with them, with no provider forks."
> — `docs/architecture.md:133`

### 1.3 插件如何组合：profile → bundle → patch 的分层

一次运行的 dsh 是一棵**按有序层在启动时组合出来的插件树**（`docs/architecture.md:17-29`）：

- **profile**：存在 Harness home 里的具名组合，列出它堆叠的 bundle、装哪些树外插件、保留用户自己的 `cordis.patch.yml`。出厂模板有 `web`、`headless`、`sdk`、`sdk-minimal`、`acp`（`docs/architecture.md:19`）。
- **bundle**：Cordis config 行 + 它们挂载的代码的分发格式，**插进去的东西仍可被上层 patch**（`docs/architecture.md:21`）。
- **层序**（`docs/architecture.md:27`）：profile 列出的每个 bundle → profile 的 `cordis.patch.yml` → home 级 patch → 任意 `--patch` 覆盖层。「A patch targets a row by id and replaces its whole config, or inserts new rows.」

`dsh-base` 是 `web`/`headless`/`sdk`/`acp` 共享的第一层（模型适配器、工具、持久化、沙箱与审批策略、设置、凭据、遥测），`dsh-sdk-minimal` 是**刻意的例外**：单个 bundle 拥有自己完整显式的 SDK 树，不套用 `dsh-base`（`docs/architecture.md:25`）。

用户可以自己看这台机器究竟启动了什么树：

```sh
dsh --profile web --dump-config
```
`docs/architecture.md:36`，紧接着一句关键承诺：「Any row it prints can be replaced by a patch of your own.」（`docs/architecture.md:39`）

### 1.4 验证博客断言：「插件只依赖接口包，绝不依赖 agent-loop」

**这条基本成立，但需要加一个精确的限定。** 我扫了全部 `packages/*/*/package.json`，统计对 `@deepseek-ai/dsh-agent-loop` 的依赖：

| 依赖类型 | 数量 | 说明 |
|---|---|---|
| `dependencies`（运行时） | **2** | `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-sdk-minimal` |
| `devDependencies`（仅测试/构建） | **47** | 含 tool-bash、tool-fs、compaction-basic、agent-team 等一切功能插件 |
| `peerDependencies` | 0 | — |

那仅有的 2 个运行时依赖方**都是 bundle**（组合层），不是功能插件。`packages/bundle/base/package.json:41` 声明 `"@deepseek-ai/dsh-agent-loop": "workspace:*"`，且其 `dsh` 字段为 `{"bundle": {"patch": "./cordis.patch.yml"}}` —— 即它声明 agent-loop 正是为了**在自己的 patch 文件里把这一行挂进树**，而 patch 行本身就是「可被上层替换」的组合面，而不是耦合到循环内部实现。

功能插件的真实姿势以 `tool-bash` 为标本（`packages/shell/tool-bash/package.json`）：

- **运行时**依赖的是接口与邻近能力：`dsh-agent`、`dsh-shell`、`dsh-tools`、`dsh-llm`、`dsh-sandbox`、`dsh-sandbox-policy`、`dsh-user-approval`、`dsh-jobs`…（`peerDependencies`）
- `dsh-agent-loop` **只出现在 `devDependencies`**，与 `dsh-agent-loop-testkit` 并列——它只在测试里被用来跑真实组合。

**结论**：博客断言应表述为「功能插件不得把 agent-loop 当运行时依赖；唯一允许在运行时声明它的是 bundle（组合层），因为 bundle 的职责本就只是把这一行挂进可 patch 的树」。这个措辞与源码完全一致，且比原断言更强——因为它把「为什么 bundle 例外」也解释清楚了。

### 1.5 「新行为放哪里」地图（确实存在）

博客说的地图是真的，位置在 `docs/architecture.md:137-162`，标题就叫 **"Where new behavior goes"**，开宗明义：

> "New behavior attaches to a documented extension point. Changing the loop itself updates this map."
> — `docs/architecture.md:139`

完整表（`docs/architecture.md:141-162`，逐行摘录，这是本文最有引用价值的一张表）：

| Goal | Mechanism |
|---|---|
| Add a model provider | register its adapter on `ctx.llm` |
| Add a model-facing capability | register on `ctx.tools`; its schema joins prompt assembly |
| Give one session a different capability set | compose an agent preset; a service row there needs an `isolate` realm |
| Add shell execution | register a `ctx.shell` backend; the local one spawns through `ctx.subprocess` |
| Add persistent terminal execution | register a `ctx.terminals` backend plus `dsh-tool-terminal` |
| Add a human command | register on `ctx.commands`; it dispatches without a model turn |
| Manage background jobs | register on `ctx.jobs`; `job_*` tools read or stop jobs |
| Start a Session from an external webhook | register a trusted rule on `ctx.webhookRuntime` and mount a provider adapter |
| Add filesystem access or policy | register a `ctx.fs` provider or listen to `fs/*` events |
| Confine spawned processes | use a `ctx.sandbox` backend; consumers wrap argv before spawning |
| Intercept a request, tool, or turn | use its `agent/*` or `tools/*` event; `agent/turn-stopping` stops a turn |
| Add model-facing context | call `agent.inject()`; it lands in the next admitted request |
| Add UI or editor integration | drive `ctx.agents` and render from `session/event` |
| Add a Web Client Chat node | register a `ConversationNodeDefinition` + keyed renderer |
| Add durable session state | extend `SessionEventMap`; render and replay from the log |
| Generate session titles | register the sole `ctx.sessionTitle` provider |
| Manage a same-session objective | use `ctx.goals`; continue through `agent/*` |
| Fork a session at a turn boundary | `ctx.agents.create({ sessionId, seed, meta: { parentSession, seedLength } })` — only agent-loop-published sessions persist |
| Store sessions in a new backend | implement `SessionPersistence` (`create`/`open`/`stat`/`list`/`export`) over the shared handle scaffolding |
| Scope a registration to one agent | use that agent's `agent.ctx` |

**开发者如何决策**：先问「我要加的是什么形态的行为」——是一个**可替换能力**（→ 设计三角色的接缝，然后在表里找对应的 `ctx.*` 注册点），还是一个**对既有流程的拦截/观察**（→ 用现成的 `agent/*` / `tools/*` 事件，绝不改循环），还是一个**新的持久事实**（→ 扩展 `SessionEventMap`，从日志渲染与重放）。表中"Intercept a request, tool, or turn"一行是整个架构的题眼：**拦截走事件，不走分支**。

仓库还配了扩展 cookbook（`docs/architecture.md:164`）：`cookbook/extension-cookbook.md` 把功能映射到能力，并索引了 adding-a-package / adding-a-tool / adding-an-llm-adapter / adding-a-settings-card 的分步指南。

---

## 2. Agent 循环（`packages/core/agent-loop/`）

### 2.1 循环是什么

> "`dsh-agent-loop` creates fresh agents or resumes persisted sessions, then drives each turn through model requests, streamed responses, tool execution, and durable session history."
> — `packages/core/agent-loop/README.md:12`

它是公开 `Agent` 契约的**唯一具体实现**，注册为 `ctx.agents` 上的 `AgentFactory`——所以消费者永远不 import 这个包（`packages/core/agent-loop/README.md:89`）。

### 2.2 turn vs step：定义与完整循环

最精确的定义在 `docs/architecture.md:86`：

> "A **step** is one model request plus the tools it calls. A **turn** is zero or more steps: it opens before its first input is claimed and closes once nothing is owed."

完整 turn 流程图（`docs/architecture.md:88-107` 逐字）：

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas; project runtime context
  -> agent/pre-step                   reject | enter(messages, startsRequestSeries?)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     agent/request -> prepareCall (cancellation commits neither system nor users)
     reconcile system/message using the prepared call capability
     append entered messages as user/message; log request/header and request/context as needed
     derive and freeze model history from the log
     stream the bound prepared call -> llm/stream -> agent/assistant-stream start
       agent/assistant-stream chunk*
       assistant/message | assistant/attempt -> agent/assistant-stream end
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

**开发者要点**：`turn/*`、`step/*`、`system/message`、`user/message`、`assistant/message`、`assistant/attempt`、`tool/*` 是**持久会话事件**；其余是活扩展点。`agent/pre-step`、`agent/request`、`llm/stream`、三个 `tools/*` 是 **waterfall**（监听器必须调 `next()` 才委派，返回即短路）；`agent/turn-stopping` 是 **serial** 且**没有 `next()`**（`docs/architecture.md:109`）。

### 2.3 并行工具调用

- 配置项 `maxParallelToolCalls`，默认 **10**：「Parallel-safe tool calls in flight per step; `1` is serial」（`packages/core/agent-loop/README.md:48`）。
- 语义：「Parallel-safe calls may overlap up to `maxParallelToolCalls`; **exclusive calls run alone as ordering barriers**.」（`packages/core/agent-loop/README.md:75`）
- 源码在 `packages/core/agent-loop/src/tool-calls.ts`：第 90 行区分 `mode === 'parallel' ? planned.slice(next) : [first]`——**排他调用会切断并行组**；第 200 行是滚动池 `inFlight.size < maxParallelToolCalls`。
- 已知限制（很重要，开发者常踩）：「**Classification is unary** — calls whose safety depends on comparing siblings or resources must remain exclusive」（`packages/core/agent-loop/README.md:199`）。即安全判定只看单个调用自身，无法表达「A 和 B 不能同时跑」。

### 2.4 取消

> "Cancellation is cooperative: `agent.cancel()` aborts the current activity and, unless `keepInbox` is set, clears pending work; a cancelled stream **finalizes the text already delivered to the user**."
> — `packages/core/agent-loop/README.md:75`

取消后未派发的模型工具调用会得到合成结果对，模型/用户可见文本逐字为（`packages/core/agent-loop/README.md:182-183`）：

> 错误码 `ABORTED_BEFORE_DISPATCH`，结果文本 `Error: tool call aborted before dispatch`

`turn/end` 会声明 `TurnEndCancelCause`；取消记录一份新的 `AgentCancelCause`，保留调用方的 `kind` 与 hook 的 `reason` 文本。而活的 `AbortSignal.reason` 仍是调用方的对象——Node 的 fetch 会往上面挂 `stack`——所以**日志里存的是副本，把这段 trace 挡在日志外，同时保证 ending 可追加**（`packages/core/agent-loop/README.md:125`）。

### 2.5 失败处理与「失败步骤扩展点」

终局失败（最终 adapter 选择、派发、迭代失败）进入 `agent/request-error` 这个 waterfall：

> "Final adapter selection, dispatch, and iteration failures arrive as terminal finishes and enter `agent/request-error`; **a handling listener returns `{ kind: 'retry' }` without calling `next()`**, while an unhandled failure is terminal. Middleware, result-processing, tool, and other extension failures remain thrown and close the turn directly — **plugin failure ends the turn, not the loop**."
> — `packages/core/agent-loop/README.md:127`

源码位置：`packages/core/agent-loop/src/agent.ts:477` 派发 `agent/request-error`，携带 `{ turn, step, provider, failure, retryPolicy, signal }`；`action?.kind !== 'retry'` 时抛 `LlmError`（`agent.ts:484-486`）。事件类型签名在 `packages/core/agent/src/runtime-types.ts:353`。

**「失败步骤扩展点」的官方名字就是 `agent/request-error`**，dsh-llm 的 README 明确点名：

> "This service never re-runs a request: retrying is the job of `dsh-llm-retry` at the agent's **failed-step extension point**."
> — `packages/llm/llm/README.md:72`

而重试插件如何挂上去，Agent Note 说得最直白：

> "`@deepseek-ai/dsh-llm-retry` is a function plugin that listens to `agent/request-error`. It introduces no service or new loop branch; the agent-loop package changes only the data carried through its existing failed-step recovery control flow."
> — `.agents/notes/implemented/architecture/2026-06-21-bounded-llm-request-recovery.md:53`

默认重试策略（同一份 Note）：**2 次瞬时重试、初始 500ms、延迟上限 10s、10% 抖动**，瞬时码集合为 `RATE_LIMIT`、`SERVER`、显式 `TIMEOUT`、`TRANSPORT`、`EMPTY_RESPONSE`。重试前会先落一条**非 surface 的 `llm/retry` 会话事件**（含 provider、策略模式、解析后的完整策略 key、重试序号、排定延迟与 `LlmFailure`），「The event says what was scheduled, not that the next request completed」。

失败的尝试会落一条只写日志的 `assistant/attempt`（内嵌该次完整精简 stream），**消息推导会忽略它**，所以失败的部分输出永远不会被提升为模型历史（`packages/core/agent-loop/README.md:99-102`）。

### 2.6 已知限制

- **No built-in turn budget** —— 工具调用或 steering 会延续当前 turn；要限制失控 turn，必须从 `agent/turn-stopping` 这类既有生命周期扩展点取消（`packages/core/agent-loop/README.md:202`）。

---

## 3. 子代理与 Agent Teams（重头戏）

### 3.1 子代理是一等接缝，且是**多 provider 注册表**

```ts
// docs/subsystems/subagent.md:29-36 (逐字)
interface SubagentCapabilities {
  readonly agentOptions: boolean
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}
```

关键设计差异（`docs/subsystems/subagent.md:5`）：

> "It differs from the other capability seams because **multiple provider implementations coexist** in one context, registered by name (`ctx.subagents`), while bash allows only one executor. Its registry follows the [LLM adapter registry](llm-streaming.md), not the single-service bash executor."

Provider 清单（`packages/subagent/README.md:27-36`）：

| 包 | 角色 | 注册到 |
|---|---|---|
| `subagent/` | 定义委派服务：provider 注册表、一次性 run、可续子代理、发现 | `ctx.subagents` |
| `subagent-in-process-driver/` | 共享的进程内 run driver | — |
| `subagent-spawn-in-process/` | 全新（fresh）进程内子代理 | `ctx.subagents` |
| `subagent-fork-in-process/` | 用父代理已完成历史做种子的子代理 | `ctx.subagents` |
| `subagent-acp/` | 经 Agent Client Protocol 的进程外子代理 | `ctx.subagents` |
| `subagent-codex/` | 经官方 app-server 协议跑真实 Codex | `ctx.subagents` |
| `subagent-claude-code/` | 经官方 Agent SDK 跑真实 Claude Code | `ctx.subagents` |
| `subagent-dsh-sdk/` | 经 TypeScript SDK 跑进程外 Harness 子代理 | `ctx.subagents` |
| `tool-subagent/` | 把委派暴露给模型 | `ctx.tools` |
| `tool-subagent-control/` | 把相邻 agent 消息、打断、列出暴露给模型 | `ctx.tools` |

能力有两种发现方式，这个区分很妙（`docs/subsystems/subagent.md:15`）：**start-time** 能力是静态 descriptor，服务在 run 存在**之前**就检查，缺了直接 `SubagentError('UNSUPPORTED_CAPABILITY')` 拒绝——「never accepted-then-ignored」；而**可续（continuable）**子代理由 continuation manager 自己组合，所以它的门槛是「某个可选方法存在与否」——**方法存在即能力**，用 TS 窄化做发现机制（`SubagentProvider.prepareContinuable`）。

### 3.2 全新 vs fork：上下文继承

`inheritsParentContext` 是**描述性**的，只描述对话播种（`docs/subsystems/subagent.md:397`）：

> "`inheritsParentContext` describes only conversation seeding (`fork`: true; `spawn` and `acp`: false), allowing consumers to generate accurate model-facing wording **without implying inherited tools, services, or authority**."

fork 的播种机制（`docs/subsystems/subagent.md:466`）：

> "The fork backend passes a *balanced completed-turn prefix* of the parent's log — the parent's events up to and including its last `turn/end` — so the seed is contiguous-from-0 and the invariants replay accepts it (**the in-flight, unbalanced turn is excluded**)."

即：fork 继承的是**父代理已完结的轮次前缀**，当前正在飞的那一轮被排除。使用的原语是 `CreateAgentOptions.seed`——和 `ctx.agents.resume()` 用的是同一个（`docs/subsystems/subagent.md:466`）。

出厂 base bundle 的配置很能说明意图（`packages/bundle/base/cordis.patch.yml`）：

- `subagent`（spawn）配 `backgroundMode: continuable`——默认的委派工具产生**可续**后台子代理。
- `subagent_fork` 配 `backgroundMode: one-shot`，并附注释：「Fork omits model selection so provider/model stay equal to the parent and **the inherited history remains eligible for KV Cache reuse**」（KV-cache 理由）。

另有工具过滤的强语义（`docs/subsystems/subagent.md:92-96`）：进程内后端把它作为子代理创建窗口内的 scoped `tools.restrict()`——**具名工具同时从子代理提示词中消失且拒绝执行（one visibility）**，未知名字大声报错。

### 3.3 Lead 如何委派

Agent Teams 的核心决策（`.agents/notes/implemented/feature/2026-08-05-agent-teams.md`）：

> "**Every ordinary runtime root is the implicit Lead of a Team identified by that root's `SessionId`.** The Team has no creation event: its Lead pseudo-row exists by identity, while durable state begins with the first member, message, or task event."
> — 同文件，`## Decision` 首段

- roster **扁平**、上限为配置的成员数，名字是不可变的小写 kebab-case。
- **每个 teammate 都是一个可续（continuable）直接子代理**，拥有预留的 Session id；**只有 Lead 能创建或打断 teammate**。
- 「Ordinary provider-owned subagents outside the roster are not Team members, and an ordinary fork is a new root whose inherited Team records are excluded by their ancestor `TeamId`.」

工具面（`packages/experimental/tool-agent-team/README.md:28,59-62`）：挂载后**每个成员（Lead 与各 teammate）都拿到同样的九个工具和同样的协作策略**；只有 Lead 能调 `spawn_teammate` 和 `interrupt_agent`。

> "All nine Team schemas are identical for Leads and teammates; execution enforces Lead-only operations."
> — `packages/experimental/tool-agent-team/README.md:128`

身份写进**初始任务消息**而不是 system prompt，理由是 KV cache（Agent Note）：

> "Putting identity in the system prompt changes the prefix before inherited history; keeping it in the initial task preserves that prefix without per-step identity bookkeeping."

逐字前缀（`packages/experimental/tool-agent-team/README.md:128`）：

```
<system-reminder>
You are teammate "<name>".
Your Team Lead is named "lead".
Use list_agents({}) to find your teammates and their names.
To message your Team Lead, use send_message({ target: "lead", message: "..." }).
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).
</system-reminder>
```

### 3.4 共享任务板：id、blockedBy DAG、revision CAS、owner

任务快照的**逐字类型**（`docs/subsystems/agent-team.md:60-72`）：

```ts
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

规则（`docs/subsystems/agent-team.md:58,74`）：

- **每个任务事件存完整快照**；`revision` 是 compare-and-set 值，每次变更 +1。
- `blockedBy` 边**必须指向未删除的任务，且保持图无环**（DAG）。
- `writeScopes` 是**规范化的建议性路径前缀，不是锁**（"normalized advisory path prefixes rather than locks"）。
- `pending` = 未开始或已释放；`in_progress` = 有 owner；`completed` = 满足前置；`deleted` = **保留的墓碑**。
- 视图会附加 owner 名、就绪状态、写域重叠警告，但**不改动持久快照**。

CAS 拒绝语义（`packages/experimental/agent-team/README.md:138`）：

> "every mutation carries `expectedRevision`, and a stale caller receives **`TEAM_TASK_STALE_REVISION`** instead of overwriting a newer value."

id 空间耗尽同样大声失败：报 `TEAM_TASK_LIMIT` **而不是复用最后一个 id**。已删除的任务保留为墓碑，**既不占用 `maxTasks` 也不出现在 `listTasks()`**。

「只在依赖全部完成时才可认领」在 README 里对用户直说（`packages/experimental/agent-team/README.md:75`）：

> "A task is claimable only when everything it depends on is complete."

### 3.5 持久邮箱：queued→delivered、去重、崩溃恢复

核心不变式（`docs/subsystems/agent-team.md:28`）：

> "The Lead Session first stores the complete queued message. A target receipt is acknowledged only after its pending inbox item or recorded user message is durable, **leaving queued-minus-delivered as the recovery mailbox**."

投递语义（`docs/subsystems/agent-team.md:41`）：

> "Every message attempts **Steer** delivery. A running target receives it at the nearest step boundary; an inactive target starts a turn if loaded or cold-resumes otherwise. **Scheduling is not stored in the durable record because callers cannot select another mode.**"

去重键（`docs/subsystems/agent-team.md:43`）：

> "The target Session keeps message identity and sender attribution on both the pending inbox item and the eventual user message. **Folding that source across inbox and history is the target-side de-duplication key**; the model-visible framing repeats the id and sender."

实现层把「从不丢、从不重复」讲透了（`packages/experimental/agent-team/README.md:132`）：

> "Delivery folds both live and persisted target inbox/history state before retrying, so **a crash between inbox acceptance and model claim does not duplicate the message**. The guarantee is **process-local retry plus target-Session de-duplication, not cross-process exactly-once delivery**."

对用户的一句话承诺（`packages/experimental/agent-team/README.md:69`）：

> "Messages are never lost and never delivered twice."

以及一条反直觉的操作规则（`packages/experimental/agent-team/README.md:71`）：

> "A queued message is **already safely stored, so it must not be resent**."

### 3.6 成员生命周期：两套状态**故意分离**

这是整个设计里最容易讲错、也最值得写进文章的一点。

**roster phase**（不可变终局）与 **runtime status**（派生态）是两回事（`docs/subsystems/agent-team.md:24`）：

> "Every member starts in `provisioning` and reaches exactly one terminal roster phase, `active` or `failed`. **Roster `running`/`inactive` status is derived separately and never rewrites this record.**"

派生状态的含义，README 用括号说死了：

> "The roster shows every member with its role (`lead` or `teammate`) and current status: `running`, `inactive` (**no turn is executing, whether loaded or stored**), `provisioning`, or `failed`. A member that is not loaded receives its messages when it wakes."
> — `packages/experimental/agent-team/README.md:63`

工具面文档再次强调，防止模型误判：

> "`inactive` means no turn is executing, whether the member is loaded or must be resumed; **it does not describe task completion or outcome**."
> — `packages/experimental/tool-agent-team/README.md:64`

**这条正是「反直觉规则」的最佳候选**：`inactive` ≠ 任务做完；它只表示「此刻没有 turn 在跑」，成员可能只是被换出到磁盘、等着被唤醒。

### 3.7 名字的永久性：失败成员保留名字与名额

> "Teammate names are permanent — **even a teammate whose creation failed keeps its name, and no name is ever reused**."
> — `packages/experimental/agent-team/README.md:61`

limits 表里同一件事的另一个侧面：`maxMembers` 的含义是「Maximum teammates a team may ever create, **including failed ones**」（`packages/experimental/agent-team/README.md:51`）。

设计意图（Agent Note `## Consequences`）：

> "A failed member permanently consumes its name and member slot, **making provisioning failures visible instead of silently recycling identity**."

即：宁可让名字和名额永久消耗，也不静默回收身份。

配置的 schema 层注意 `maxMembers: z.number().step(1).min(1).default(DEFAULT_MAX_MEMBERS)`——**下限是 1**，即 dsh 不允许把成员上限配成 0。

供给与恢复（`packages/experimental/agent-team/README.md:128`）：

> "`spawnTeammate()` first appends and flushes a `provisioning` member record, then asks the configured provider to create the reserved child; a provider failure appends a durable `failed` member. A fresh child starts with no Lead history; a fork child captures the Lead's completed-turn prefix once. Recovery reconciles an unterminated provisioning record against the child's independently persisted Session: a matching direct-parent and continuable descriptor plus a recorded initial user message produces `active`, and anything else produces `failed`. If recovery wins a same-process race, the creator accepts the terminal state or reports **`TEAM_PROVISIONING_CONFLICT`** and drains the child. **Names are reserved by the first provisioning record and never reused.**"

### 3.8 限制表（用户给的数字全部核实）

`packages/experimental/agent-team/README.md:49-55` 的原始表（逐字）：

| Field | Default | Meaning |
|---|---|---|
| `maxMembers` | `16` | Maximum teammates a team may ever create, including failed ones |
| `maxTasks` | `256` | Maximum active tasks on the board |
| `maxPendingMessagesPerMember` | `64` | Maximum queued messages for one member |
| `maxMessageBytes` | `65,536` | Maximum size of one sent message |
| `disposalTimeoutMs` | `5,000` | Time allowed for shutdown cleanup |

**五个数字全部在源码里对上**（`packages/experimental/agent-team/src/index.ts:43-47`）：

```ts
const DEFAULT_MAX_MEMBERS = 16
const DEFAULT_MAX_TASKS = 256
const DEFAULT_MAX_PENDING_MESSAGES = 64
const DEFAULT_MAX_MESSAGE_BYTES = 65_536
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000
```

### 3.9 明确声明的限制（article 的关键料）

`packages/experimental/agent-team/README.md:201-206` 逐字：

> - **Experimental prototype with no stability promise** — the package is public, but its contracts can change freely while it incubates.
> - **One process and one shared checkout** — members share cwd and observe edits immediately; this package provides no worktree, remote member, merge, or filesystem lock.
> - **Advisory write scopes** — Bash, formatters, code generators, and direct external writers can bypass filesystem version checks; Leads must coordinate ownership and review the final diff.
> - **Flat immutable roster** — only the Lead creates direct teammates; there is no nested Team, rename, deletion, or name reuse.
> - **No automatic ownership release** — inactivity, interruption, process exit, and failed work do not release a task owner.
> - **Mailbox is not cross-process exactly-once** — concurrent harness processes over one Team are unsupported.

**「不自动释放 owner」是最反直觉的一条**：一个成员挂掉、被打断、进程退出、任务失败——**owner 都不会被释放**，任务会一直挂在他名下，必须由人或 Lead 显式释放/重开。README 给用户的对照说法是「Avoid it when … a task owner should be released automatically — none of those are supported.」（`:32`）

### 3.10 不默认开启

Agent Note 的 alternatives 里明确拒绝了「默认开启」：

> "**Enable Teams in the default catalog.** Rejected because scoped Team controls would shadow same-named legacy globals and **unsolicited delegation would add latency and token cost to simple tasks**. An opt-in profile bundle inserts Team and disables the legacy controls without adding Team packages to shipped dependency graphs."

并且激活有硬前提（`packages/experimental/agent-team/README.md:12`）：

> "It is published under its experimental name, **carries no stability promise, and needs durable session storage to activate**."

最小可用配置（同 README `:40-45`）：

```yaml
# smallest team setup — durable storage plus both Team packages
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-experimental-agent-team'
- name: '@deepseek-ai/dsh-experimental-tool-agent-team'
```

### 3.11 为什么 writeScopes 不是锁（一段极好的设计推理）

Agent Note 的 alternatives 里，这条论证值得整段引用：

> "**Treat task ownership or write scopes as locks.** Rejected because external writers bypass them, crashed owners remain durable, and path-prefix overlap cannot prove semantic independence. **False mutual exclusion is more dangerous than an explicit warning.**"

以及共享检出边界的坦白：dsh 的文件编辑工具能观察到陈旧版本并拒绝，但「Bash, formatters, generators, and external writers bypass that fence」，而「Treating a teammate name or task owner as a file lock would **hide rather than solve** this concurrency boundary.」

---

## 4. 上下文管理与压缩（`packages/compaction/*`）

### 4.1 什么触发压缩

默认触发公式（`packages/compaction/compaction-basic/README.md:62`，逐字）：

> "With context window `W`, effective request output cap `O`, and headroom `B`, the default trigger is **`floor(min(W × 0.8, W − O − B))`, where `B = 65,536` tokens**. Retention keeps the newest **16% of `W − O`** verbatim."

配置表关键行（同 README `:66-84`）：

| Field | Default | Meaning |
|---|---|---|
| `thresholdRatio` | `0.8` | Window fraction used in `floor(min(W × thresholdRatio, W − O − headroomTokens))` |
| `headroomTokens` | `65536` | Additional pressure headroom beyond the routed output reservation |
| `retainRatio` | `0.16` | Recent conversation kept verbatim as a fraction of `W − O` |
| `compactionRetries` | `1` | Extra condensation attempts after the first when pressure remains above threshold |
| `maxOverflowRetries` | `1` | Maximum retries after a confirmed context-window overflow |
| `auto` | `true` | Enable automatic condensation and overflow recovery; `false` for manual-only |

四种行为（`packages/compaction/compaction-basic/README.md:32`）：

> "automatic condensation as the conversation grows toward the model's context limit; **recovery after a confirmed context-overflow error, where the conversation condenses and the request retries**; on-demand condensation through the `/compact` command; and — when the pruner is mounted — trimming of oversized tool outputs before condensation."

**两条触发路径**：① 增长到阈值前自动压；② **收到确认的 context-overflow 错误后压缩并重试**（这是很多 harness 没有的韧性设计）。

### 4.2 三种策略

| 包 | 作用 | ctx key |
|---|---|---|
| `compaction/` | 共享的压缩契约：所有 backend 与 trigger 用的操作与摘要格式 | `ctx.compaction` |
| `compaction-basic/` | 随 token 压力增长自动把较旧历史压成摘要 | 注册 `ctx.compaction` |
| `compaction-tool-result-pruner/` | 裁剪超大工具输出，**让需要被压缩的历史变少** | `ctx.toolResultPruner` |
| `compaction-image-offload/` | 当支持图像的 route 拒绝请求时，把超预算图像换成占位符 | 监听 `agent/request-error` |
| `command-compact/` | `/compact` 命令，按需压缩 | 注册到 `ctx.commands` |

（来源：`packages/compaction/README.md` 包表）

出厂 base 的实际配置（`packages/bundle/base/cordis.patch.yml`，逐字注释）：

```yaml
    # Compacts oversized tool results before the broader conversation compactor
    # runs, preserving the model-visible result within the configured budget.
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024

    # When an image-capable route rejects a request as over its image budget,
    # replace the oldest images with placeholders on the surface and retry.
    - id: image-offload
      name: '@deepseek-ai/dsh-compaction-image-offload'
```

pruner 的具体预算：超过 8192 字符裁掉，保留头 4096 + 尾 1024。**头重尾轻**——保留开头（任务设定）和结尾（最新结果），掐中间。

### 4.3 压缩在日志里长什么样（开发者关键）

三个事件全部**只写日志（log-only）**，都不进 surface（`docs/subsystems/compaction.md:13`）：

| Event | Payload | Role |
|---|---|---|
| `compaction/start` | `{ turn }` | 获取日志记录的锁；数字标识自动 turn，`null` 标识独立手动尝试 |
| `compaction/summary` | `{ summary, rawOutput?, llmStreamCall?, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | 安全摘要投影 + 被遮蔽的 surface 边界对 |
| `compaction/end` | `{ turn, error? }` | 用同样的数字或 null 所有者释放锁 |

摘要本身搭在一条独立的 `user/message` 上，带 `surfaceOp: { op: 'replace', startSeq, endSeq }`——「**the only surface mutation performed by summary compaction**」（`docs/subsystems/compaction.md:13`）。

锁的次序有意为之（`docs/subsystems/compaction.md:17`）：

> "The lock brackets the **whole** operation: `compaction/start` is appended first, then summarization, the `compaction/summary` record, and the `user/message` replacement all land, and only then `compaction/end`. **Releasing the lock last turns a crash mid-operation into a detectable orphaned lock** … rather than a `compaction/end` that falsely claims compaction finished."

### 4.4 对长会话用户的可见后果

**能保住的**：会话可以越过原本会溢出的点继续跑下去（README 原话：「watching the conversation continue past the point where it would otherwise overflow」，`:56`）。

**会失去 / 做不到的**（`packages/compaction/compaction-basic/README.md:14` 逐字）：

> "Condensation uses **one extra model request** and **retains only its summary text**. It **cannot reduce the system prompt, tools, or session prefix**, or **split one indivisible unit such as a single huge tool call**."

即：压缩有成本（一次额外模型调用）、有损失（原文变成摘要）、有边界（system prompt/工具/会话前缀压不动，单个巨型工具调用也切不开）。

**没配好会拒绝启动**（fail fast，`:86`）：

> "Misconfiguration fails fast: unknown settings, duplicate per-model overrides, invalid token counts, both retention forms together, or a retention ratio at least as large as the threshold ratio **reject the plugin at load**."

---

## 5. 会话模型与持久化（`packages/session/*`、`session-query/*`）

### 5.1 会话日志是模型上下文的唯一事实源

> "The session log is the source of the context the model sees. `deriveMessages()` projects model history from it."
> — `docs/architecture.md:121`

> "Each `assistant/message` embeds the exact compact timed stream that produced its assembled content; `assistant/attempt` retains settled failed, retried, cancelled, and stream-error attempts without adding model history. **Fork, resume, transcripts, telemetry, and persistence all derive from these durable settlements**, while live UI incrementality comes from `agent/assistant-stream`."
> — `docs/architecture.md:121`

**为什么「append-only」重要**：因为 replay、fork、rebuild 全都从这一条日志推导，日志一旦可改，「模型看到什么」就不可复现了。dsh 甚至把「已提交的代际永不重命名/替换/删除」写成硬规矩（`docs/architecture.md:123`）：

> "committed generation paths are **never renamed, replaced, or deleted**."

### 5.2 「Model-visible ⟺ logged」不变式：确实存在，且**双保险**

**第一处：`dsh-llm` README（用户猜对了）**——`packages/llm/llm/README.md:112`，逐字：

> "- **Model-visible ⟺ logged** — callers must keep every provider request's model-visible input reconstructable from the session log; loop-built requests arrive deep-frozen and cannot be rewritten."

同文件开头 `:12` 也有一句：「Callers must keep all model-visible input reconstructable from the session log.」

**第二处：`docs/architecture.md:125`**：

> "**Model-visible means logged.** Anything that reaches a model request must be reconstructable from the log, and **a runtime invariant asserts it**. A new model-visible input requires a session event."

**第三处：仓库级规矩**——`AGENTS.md:136`：

> "- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event."

**运行时强制（用户的那条断言，逐字核实）**：`packages/core/agent-loop/src/invariant.ts:40-43`：

```ts
    const expected = session.deriveMessages()
    if (JSON.stringify(options.messages) !== JSON.stringify(expected)) {
      fail(`llm request for session "${String(session.id)}" diverges from the dispatch-time durable derivation (log-reconstruction desync)`)
    }
```

**用户记的表达式完全正确**（`JSON.stringify(options.messages) === JSON.stringify(session.deriveMessages())`，这里是取反判失败版本）。同一段还检查了：请求必须 frozen（`:23`）、必须带 session id（`:24`）、messages 数组必须 frozen（`:27-29`）、日志里必须有 `step/start`（`:33-35`）与 `request/header`（`:36-39`），以及 header 必须匹配（model、`system === undefined`、temperature、maxTokens、stop、tools，`:46-54`）。

分配置方式也很讲究（`:20`）——`prepend: true` 是**故意的**：

> "// Prepend prevents a short-circuiting replay listener from silencing the check."

即：不变式检查挂在 waterfall 最前面，防止任何插件通过短路把这条检查静音。

源码里还有一句把 system prompt 的位置钉死（`invariant.ts:45`）：

> "// The system prompt travels inside `messages` as surface node 0, never as `system`."

### 5.3 实际出厂的持久化后端：**只有一个，JSONL**

用户问的「is there really only ONE persistence backend shipped (JSONL)」——**是，而且比「只有一个」更强的结论是：SQLite 后端已经被删掉了。**

`packages/session/` 下名为 `session-persistence*` 的目录有三个，但：

- `session-persistence/`：抽象接缝（`ctx.sessionPersistence`），服务定义，非后端。
- `session-persistence-jsonl/`：**唯一的出厂后端**。README 逐字：「It is the **sole first-party Session-persistence provider**.」（`packages/session/session-persistence-jsonl/README.md:32`）
- `session-persistence-sqlite/`：**只剩 `lib/` 与 `node_modules/` 残留，没有 `package.json`、没有 `src/`，且 `git ls-files` 为空（未被 git 跟踪）。** `git log` 显示删除提交：`4553c9d957 refactor(session)!: remove SQLite persistence backend`。

bundle 层的接线也印证（grep 全部 `packages/bundle/*/cordis.patch.yml`）：

- `packages/bundle/base/cordis.patch.yml:130-131`：`session-persistence-jsonl`
- `packages/bundle/sdk-minimal/cordis.patch.yml:155`：`session-persistence-jsonl`

`docs/subsystems/persistence.md` 的措辞同样收紧为「The repository ships dsh-session-persistence-jsonl as its provider; out-of-tree providers may implement the same service contract.」（`:5`）

**注意**：仓库别处仍提到 SQLite（例如 `AGENTS.md:7` 说「SQLite uses monotonic `SCHEMA_VERSION`」，`docs/persistence-catalog.md` 等）。这属于**文档滞后于代码**——真实代码与 bundle 接线里 SQLite 后端已不存在。写文章时应以 `git log` 与 bundle 接线为准。

### 5.4 磁盘布局与代际规则

`packages/session/session-persistence-jsonl/README.md:60-73`（逐字）：

```text
<root>/
  --<normalized-cwd>--/          # readable project directory (or _no-cwd/)
    <encoded-id>/                # session-owned directory
      session.jsonl.zstd         # released v0, compressed root
      session.v1.jsonl.zstd      # released v1, compressed root
      session.v2.jsonl.zstd      # released v2, compressed root
      session.v3.jsonl.zstd      # released v3/current, compressed root
      session.jsonl              # released v0, raw root
      session.v1.jsonl           # released v1, raw root
      session.v2.jsonl           # released v2, raw root
      session.v3.jsonl           # released v3/current, raw root; later versions use vN
```

要点：

- 每个 session 一个目录，**目录名里带规范化 cwd**，所以「看得懂、好导航」；session id 做单段安全转义（无穿越、无碰撞）。
- **默认 Zstandard 压缩**（`compression: 'zstd'`），可切 `'none'` 变成**人能直接读的逐行文本**。
- 「Runtime operations select the **numerically highest** canonical generation」（`:75`）。
- 启动/打开时的行为（`docs/architecture.md:123`）：header-only 的 `stat` 与 `list` 重扫每个 Session 目录、选数值最高的规范代际、翻译受支持的历史 header，**而不加载事件、也不发布后继**；存储会话的 `open` 选中同一代际，**拒绝未来版本**，或解码并组合一次静态相邻迁移链后返回校验过的当前逻辑事件。

崩溃语义（`packages/session/session-persistence-jsonl/README.md:78`）：

> "the stored log keeps its interrupted final turn — every record in the committed prefix survives, and the resuming reader appends synthetic closers through its write handle. An incomplete final raw line is discarded."

恢复时到底补什么（`packages/session/session-persistence/README.md`，`Resuming and crash recovery` 节）：

> "Resume (agent-loop) reads the stored log through its write handle, computes **`interruptedTurnClosers`** — synthetic `tool/result` errors, any open `step/end`, and `turn/end {interrupted}` — and appends them through the same handle as an ordinary batch."

关键取舍：**持久化层只返回物理上有效的日志，语义修复是读者的事**——「Persistence returns the physically valid log; **semantic repair belongs to the reader**.」

### 5.5 用户语言的「分叉 / 恢复」

- **恢复（resume）**：`ctx.agents.resume()` 打开持久会话。agent-loop 通过 `persistence.open(id, 'write')` 拿到写句柄（**同时排除并发恢复同一 id**），读取物理有效日志，并把上面那批 closers 作为普通 batch 追加（`packages/core/agent-loop/README.md:115`）。**用户视角**：关掉 dsh、第二天回来继续，对话历史、工具调用、结果都在，而且那次「半路被杀」的那一轮会被明确标记为 `interrupted`，不会假装它成功结束。
- **分叉（fork）**：架构表里给的 API 是 `ctx.agents.create({ sessionId, seed, meta: { parentSession, seedLength } })`，并附一句限定——**「only agent-loop-published sessions persist」**（`docs/architecture.md:160`）。`seed` 就是一份 `SessionEvent[]` 前缀，和 resume 用的是同一原语（`docs/subsystems/subagent.md:466` 提到 `CreateAgentOptions.seed` 走 `AgentLoop.createAgent` → `ctx.sessions.prepare({ seed })`）。**用户视角**：把一段对话在某个轮次边界**复制**成新会话，两边从此各自独立演化；原会话不受影响（因为日志只追加）。

### 5.6 session-query 干什么

`packages/session-query/` 提供浏览/搜索/导出。README 注解提到只读观察者（session-query）用**同样的 closers 但在内存里**平衡被中断的冷日志（`packages/session/session-persistence/README.md`「Resuming and crash recovery」节）：

> "Read-only observers (session-query) balance an interrupted cold log with the same closers in memory only."

即：查询侧不写盘也能给出一致的视图。配合 `stat`/`list`/`export` 三个服务方法（`docs/architecture.md:161`）与 `handle.read(offset?, length?)`。

### 5.7 一个值得单列的用户可见限制

`packages/session/session-persistence-jsonl/README.md:163`：

> "- **Nothing deletes session files** — logs accumulate under `root` until removed externally; **the seam has no deletion API**."

**没有任何东西会删除会话文件**，持久化接缝**没有删除 API**。对用户来说：会话日志会一直涨，要清理得手工删目录。这是 append-only 哲学的必然代价。

另一条（`:164`）：**每个会话同时只有一个活写者**——进程内写句柄声明 + 内核锁（POSIX 用 `session.lock` 上的非阻塞 `flock(2)`，Windows 用同路径派生的具名内核信号量，无文件系统足迹）。

---

## 6. 技能（`packages/skill/*`、`.agents/skills/`）

### 6.1 技能在磁盘上长什么样

两种形态，**刻意不支持嵌套**（`docs/subsystems/skills.md:85`）：

> "The local provider accepts directory bundles (`<name>/SKILL.md`) and flat Markdown files (`<name>.md`). **Nested recursive `**/SKILL.md` discovery is not supported.**"

名字规则（同处）：kebab-case，正则 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。

frontmatter 字段（`packages/skill/skill-filesystem/README.md:36`，逐字）：

> "The file starts with YAML frontmatter: **required `name` and `description`**, plus optional `whenToUse`, `metadata`, `disable-model-invocation`, and `user-invocable`."

仓库内真实样例（`.agents/skills/dsh-pre-push-checks/SKILL.md:1-4`，逐字）：

```yaml
---
name: dsh-pre-push-checks
description: Use before pushing, force-pushing, marking ready for review, or claiming checks pass on a deepseek-harness branch, and immediately after gh stack sync publishes rewritten branches, to select the smallest tests and checks that cover the outgoing or just-published diff without reflexively running the full repository suite.
---
```

注意 `description` 的写法：**不描述「技能是什么」，而是描述「什么时候该用它」**——因为这是模型用来路由的文字。

`description` 的语义（`docs/subsystems/skills.md:94`）：

> "the model session catalog uses **only model-invocable `name` and `description`, never the body or absolute file path**."

即：模型先只看到名字+描述，**正文按需加载**。这是省 token 的关键结构。描述长度可配 `catalogDescriptionMaxLength` 截断（`packages/skill/tool-skill/README.md:12`）。

### 6.2 四象限触发模型：**确实存在**，就是两个正布尔的四种组合

核心类型（`docs/subsystems/skills.md:94-99`，逐字）：

```ts
/** Invocation controls shared by skill discovery consumers. */
interface SkillInvocationPolicy {
  /** Whether model-facing catalogs and loaders include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs and loaders include this skill. */
  readonly userInvocable: boolean
}
```

四象限规则（`docs/subsystems/skills.md:128`，逐字）：

> "`ctx.skills.list()` preserves all four policy combinations. `isModelInvocable(skill)` and `isUserInvocable(skill)` read the corresponding required field. A model-only skill sets `{ modelInvocable: true, userInvocable: false }`, a user-only skill sets `{ modelInvocable: false, userInvocable: true }`, and **setting both fields to `false` keeps the skill available only through trusted `ctx.skills.get()` callers**. The local provider reads the exact kebab-case frontmatter keys **`disable-model-invocation`** and **`user-invocable`**, **defaults omitted fields to `true`**, and projects every parsed skill into this normalized policy."

整理成表：

| 象限 | frontmatter | 谁能触发 |
|---|---|---|
| 模型 + 用户 | 都不写（默认 `true`/`true`） | 两侧都可 |
| 仅模型 | `user-invocable: false` | 只有 `skill` 工具 |
| **仅用户** | `disable-model-invocation: true` | **只有 `/name`**，目录与工具永不暴露 |
| 都禁止 | 两个都设 | 只有受信任的 `ctx.skills.get()` 调用方 |

**解析的严格性值得单列**（`packages/skill/skill-filesystem/README.md:38`）：

> "The two keys accept YAML booleans plus the case-insensitive `true`/`false`, `yes`/`no`, `on`/`off`, and `1`/`0` forms; **a rejected spelling or a non-boolean value drops the whole skill with a warning rather than silently permitting a surface**."

而且**旧字段名会被显式拒绝**——`packages/skill/skill-filesystem/src/index.ts:1001-1003` 有 `rejectLegacyInvocationKey(data, 'disableModelInvocation', 'disable-model-invocation')` 等三行，把驼峰旧名和 `modelInvocable`/`userInvocable` 都挡掉。即：写错字段名不会静默放行，而是报错。

### 6.3 发现：模型看到的是**会话内目录**，且变更会追加替换

`packages/skill/tool-skill/README.md:12`（逐字）：

> "Before the first request, when model-invocable skills exist and the `skill` tool is visible, they receive a **durable catalog** of available skill names and capped descriptions, and can use the `skill` tool to load full instructions."

目录的生命周期（`packages/skill/tool-skill/README.md:83`，逐字）：

> "At each eligible `agent/pre-step`, the plugin snapshots the calling session's skill catalog, applies exact `skill` tool visibility, filters to model-invocable skills, and compares a digest of the entries against the newest visible `skill-catalog` message in the session log. **When the digest changed, it hands the `enter` decision a durable user-role message containing the complete replacement catalog; an empty replacement explicitly retires earlier names.** An incomplete provider snapshot emits nothing and preserves the last-good view for the next pre-step."

**两个精彩细节**：① 目录变更发的是**完整替换**，空替换显式作废旧名字（不做增删差量，避免状态漂移）；② provider 快照不完整时**什么都不发**，保留上一次的好视图（宁可旧不可错）。

### 6.4 本地发现优先级（6 个 rank）

`docs/subsystems/skills.md`「Local discovery priority」表（逐字）：

| Rank | Source | Root |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `Config.bundledSkillDir` when configured |

项目根 = **最近的含 `.git` 的祖先目录**；没有就用当前 cwd。而且当 `ctx.fs` 可用时，git-root 探测**走文件系统服务**——「so remote or sandboxed workspaces do not fall back to the host filesystem boundary」。

同名冲突：**层内**按 rank → provider 顺序 → 本地顺序；**跨层**则「the nearest layer's entry wins a duplicate skill name outright」。

### 6.5 `/name`（用户触发）到底做了什么

`packages/skill/tool-skill/README.md`「Invocation boundary」节（逐字）：

> "The `/name` gesture listener scans **only claimed user messages**: a whitespace-bounded token naming a user-invocable skill in the workspace catalog injects the same `<skill_content>` rendering as a `user`-role instructions context **appended after every other injection**. Unknown names and user-disabled skills stay ordinary prose. **This is the only entry point for `disable-model-invocation` skills, which the catalog and the `skill` tool never expose.**"

对用户：`/某技能名` 就是把该技能的正文**当成用户那段话的上下文**塞进这一步。对开发者：注意「只扫**已认领**的用户消息」——它作用于真实用户输入，也不会因为模型自己提到名字而误触发。另外，未知名字**保持为普通文本**，不会被吞掉。

### 6.6 仓库自用的技能

`.agents/skills/` 下 13 个：`agent-experience`、`dsh-archive-agent-notes`、`dsh-ci-test-reliability`、`dsh-code-review`、`dsh-doc`、`dsh-find-simplifications`、`dsh-merging-stacked-prs`、`dsh-pre-push-checks`、`dsh-prose-standard`、`dsh-speed-up-perf`、`dsh-translate-docs`、`dsh-trim-cot-leakage`、`record-browser-gif`。这些是**开发这个仓库的人自己的技能**，通过 rank 200 的 `.agents/skills` 被 dsh 自己加载——**dsh 用自己的技能机制来开发 dsh**。

---

## 7. 工具与安全

### 7.1 审批（approval）：问什么、怎么答、拿不到答案怎么办

接缝只回答一个问题（`docs/subsystems/approval.md:3`）：

> "The user-approval seam of dsh-user-approval answers one question: **may this specific action proceed?**"

**结果是封闭的，且 fail-closed**（`docs/subsystems/approval.md:25`，逐字）：

```ts
/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

> "`allowed-once` grants **only the asked-about action**; callers deny on `rejected`, `cancelled`, and `unavailable`. **A missing, non-owning, throwing, or non-conforming answerer becomes `unavailable` rather than opening the gate.**"
> — `docs/subsystems/approval.md:19`

这是全篇最值得写给用户的一句话：**审批通道坏掉 = 拒绝，而不是放行。**

每会话策略（`docs/subsystems/approval.md:31`，逐字）：

```ts
type ApprovalPolicy = 'ask' | 'never'
```

> - `'ask'` (the default) — delegate to the composed answerers; with none composed the chain falls through to the **fail-closed `'unavailable'`**.
> - `'never'` — never prompt anyone: every ask resolves `'rejected'` deterministically. **The strict headless stance (CI, unattended runs)** and the policy whose outcome is knowable without asking.

消费方一侧（`packages/core/tools/src/index.ts:602`）确认：「runs only after an approval service returns `allowed-once` and otherwise」……而 `:1722` 说「`allowed-once` proceeds; the three non-grants deny」。

**审批问题里不带工具参数**（`docs/subsystems/approval.md`，`ApprovalRequest` 的 JSDoc，逐字）：

> "It deliberately omits tool arguments: an answerer attaches the prompt to the already-streamed tool call through `callId` instead of **rendering a second copy that could drift**."

### 7.2 权限预设：两个独立旋钮打成一个名字

（`docs/subsystems/permission-presets.md:3`）

> "The permission-preset layer of dsh-permission-presets (`ctx.permissionPresets`, `PermissionPresetService`) bundles **the two independent enforcement knobs** — sandbox mode (`sandbox/mode`) and approval policy (`approval/policy`) — into named presets a client offers as one Permissions selector."

出厂表（同文件 `:11`，逐字）：

> "The default configured table ships **`workspace-write` (`workspace-write` + `ask`)** and **`danger-full-access` (`danger-full-access` + `never`)**; `custom` and `auto` are reserved and cannot be configured."

`custom` 是**只读派生值**：

> "`custom` is derived-only: **clients may display it as the current value, but it is never a switch target or an event payload.**"

且切换会留下**只写日志的用户意图** `permission/preset`：

> "`permission/preset` is durable, log-only user intent: **it stays out of the model transcript** … and it exists so `current()` can preserve which preset the user chose when two presets share a bundle."

配错**在插件加载时就炸**：「misconfiguration fails at plugin load: configured entries named `custom` or `auto` throw, and composing over a bash executor that does not confine (no `sandboxMode` capability fact) throws because presets bundle a sandbox mode.」

### 7.3 沙箱：限制什么、限制到什么程度

`SandboxMode` 只管**文件效果**（`docs/subsystems/sandbox.md:13`，逐字）：

```ts
/**
 * File-effect policy for confined processes. `read-only` permits only required
 * sinks such as `/dev/null`; `workspace-write` also permits the workspace and a
 * backend-defined temp area; `danger-full-access` bypasses confinement. Network
 * and process visibility are outside this vocabulary.
 */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
```

**「网络与进程可见性不在这套词汇里」**——这是必须对用户讲清楚的边界。

平台后端（`docs/subsystems/sandbox.md:3`）：

> "dsh-sandbox-local supplies **Linux bwrap/Landlock, macOS Seatbelt, and the Windows ACL restricted-token backend**; dsh-bash-sandbox and dsh-pwsh-sandbox consume it."

**执行强度是「被报告的事实」而不是布尔**（`docs/subsystems/sandbox.md:27`，逐字）：

```ts
type SandboxEnforcement = 'full' | 'partial'
```

> "`full` means the backend governs every file effect promised by the mode; **`partial` means an active backend or older kernel ABI governs only a subset, so consumers that require the absolute promise must reject or surface that distinction.** Older Landlock ABIs and the Windows ACL runner's hard-link, unconfined-read, and AppContainer-ACL boundaries are current partial cases."

第 3 个模式根本不是沙箱（`:17`）：

> "**Only the first two modes can be sent to a provider.** A `danger-full-access` consumer spawns its original argv and does not call `ctx.sandbox`."

### 7.4 拒绝是怎么被报告的（真实字符串）

**Bash**：给模型的工具描述里就写明了这条约定的确切形状（`packages/shell/tool-bash/src/index.ts:105`，逐字）：

> "Commands may run under a file sandbox; a blocked file operation is reported as `` `[sandbox: file access denied under <mode> mode]` `` — **a policy denial, not a bug in the command; do not retry another way.**"

**文件系统**：抛错时带真实模式名（`packages/fs/fs-sandbox/src/index.ts:127,141`，逐字）：

> `cannot write "${target.displayPath}": file access denied under read-only mode` — 错误码 `FS_SANDBOX_DENIED`
> `cannot write "${target.displayPath}": file access denied under workspace-write mode` — 错误码 `FS_SANDBOX_DENIED`

**沙箱运行器自己崩了**也有专门的措辞，与「命令失败」显式区分（`packages/shell/tool-bash/src/render.ts:111` 与 `background.ts:23`，逐字）：

> `[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode — the command did not run; this is a sandbox problem, not a command failure]`

注意这几种措辞都在反复教模型同一件事：**这是策略拒绝，别绕路重试**。这一点对用户信任很重要——沙箱拒绝不会被伪装成工具故障。

### 7.5 失败关闭（fail-closed）与升级路径

- 审批拿不到答案 → `unavailable` → 调用方拒绝（`docs/subsystems/approval.md:19`）。
- 沙箱不可用/降级 → 报 `partial`，要求绝对边界的使用方必须**拒绝或明确暴露这个区别**（`docs/subsystems/sandbox.md:27`）。
- 命令被拒是**事实**，工具层把它转成标准的权限拒绝面；**升级**要用户批准（`packages/shell/pwsh-sandbox/README.md:60`，逐字）：

> "When escalation is available, the model may **retry the exact command once with the narrowest wider mode and a one-sentence justification**; the approval prompt asks the user, and **nothing executes before approval**. This executor never negotiates permissions itself."

三个约束都值得写：**同一条命令**、**只重试一次**、**最窄的更宽模式**，而且要一句理由。

### 7.6 dsh 自己的安全声明（写给用户看的）

`SAFETY.md`（逐字节选）：

> "DeepSeek Harness is **experimental developer-preview software. It has not undergone a security audit and must not be treated as secure or production-ready.**"
> "The project can execute model-generated code and commands, load third-party plugins, and access the network, processes, credentials, and files made available to it. Incorrect model output, defects, misconfiguration, malicious input, or untrusted plugins may **damage the host computer, modify or delete files, disclose data or credentials**, or cause other unintended effects."
> "Sandboxing, approval prompts, and permission controls can **reduce risk, but they do not guarantee isolation or prevent damage**. Even correctly enforced restrictions cannot protect resources that the project is allowed to access."
> "**Do not rely on DeepSeek Harness as the sole security control for untrusted workloads.**"
> — `SAFETY.md:5,7,13,15`

以及五条负责任使用建议（`SAFETY.md:17-23`）：最小权限、优先用一次性 VM/容器/专用环境、**备份项目能访问的文件**、不要暴露敏感凭据、**运行前先审查插件/配置/待执行命令**。

---

## 8. 双 LLM 适配器（`packages/llm/`）

### 8.1 动机：用一个「孪生」来检验抽象

（`.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md`，`## Problem`，逐字）

> "A vocabulary defined against a single adapter risks baking that adapter's quirks into the "neutral" contract: anything the one implementation happens to do becomes the de-facto spec, and the abstraction is unverified until a second provider arrives — **by which point the leak is expensive to fix**."

### 8.2 两个适配器

（同 Note，`## Decision`，逐字）

> "- `dsh-llm-deepseek` — direct `fetch` + in-repo translation against the DeepSeek API; SSE framing is delegated to `eventsource-parser` … The twin identity is owning the fetch/translate internals rather than delegating to a full provider SDK, not hand-rolling transport plumbing.
> - `dsh-llm-pi-ai` — the same endpoint through the `@earendil-works/pi-ai` library (its own event vocabulary)."

补充一条容易漏的：`llm-deepseek` 内部还**多了一个 Anthropic 协议的实现**——「The [Messages adapter] adds an Anthropic-protocol implementation inside `llm-deepseek`; it preserves the same stream conventions.」

### 8.3 核心规则与 4 条约定（用户给的都核实了）

（同 Note，逐字）

> "The rule they enforce: **anything the StreamChunk vocabulary cannot express for BOTH implementations is a core-vocabulary bug**, caught immediately rather than at the next provider. The pair pinned down conventions now documented on `StreamChunk` in `dsh-llm/src/types.ts`: **usage emitted before finish, nothing after finish, tool-call `arguments` as raw JSON strings end-to-end, and the two sanctioned error paths (throw from `stream()` *or* end with `finish {kind:'error'|'aborted'}`)** that a consumer must handle on both sides — a divergence the library-backed adapter surfaced that a single direct-fetch adapter would have hidden."

**四条约定 + 一条元规则，全部与用户描述一致。** 而 `packages/llm/llm/README.md` 的 Invariants 节把第 1、3、4 条固化成条（逐字）：

> "- **Protocol ordering** — `usage` precedes `finish`, **tool arguments stay raw JSON strings**, and **nothing follows the terminal `finish`**."

同节的其他不变式也很值钱：

> "- **Model-visible ⟺ logged** …"
> "- **Replay state travels only within one adapter** — assistant replay state rides along only when the same adapter instance owns the historical and target routes; otherwise it is dropped before dispatch."
> "- **Prepared calls are one-shot** — a prepared call can be dispatched **exactly once**, and its call-config fields must match the prepared config."
> "- **File projection is unconditional** — **no provider receives file bytes**; every route gets one deterministic handle line per `FileBlock`, and the model reads the saved copy with its file tools on demand."

「同一条 prepared call 只能派发一次」和「任何 provider 都拿不到文件字节」这两条，是相当强的工程承诺。

### 8.4 终局协议

（`packages/llm/llm/README.md:72`，逐字）

> "Every stream ends in **exactly one terminal `finish` chunk**: `{ kind: 'error', failure }` on failure, `{ kind: 'aborted', failure }` on cancellation. Failures carry stable codes such as `NO_ADAPTER`, `MISSING_CREDENTIAL`, `AUTH`, `RATE_LIMIT`, and `CONTEXT_WINDOW_EXCEEDED`; **consumers route on the code, never on message text.**"

**「按 code 路由，永不按文本路由」**——这是给所有 agent 开发者的通用教训。

### 8.5 持久化孪生问题：**只有一个后端，且 SQLite 已被删除**

见 §5.3。一句话版本：**只有 JSONL 一个出厂后端**，而且是"sole first-party provider"；SQLite 后端已在 `4553c9d957 refactor(session)!: remove SQLite persistence backend` 中删除，仓库里只剩未跟踪的构建残留。所以用户设想的「持久化双实现」**并不存在**——接缝设计允许多后端（`docs/architecture.md:161` 明确邀请第三方实现 `SessionPersistence`），但出厂只发一个。

---

## 9. 长时运行原语

每个一段，说清「比普通聊天多给了什么」。

**goal（目标）**——一句话：让会话有一个**能跨重启、恢复、分叉存活**的完成目标。

> "The goal group lets one agent session pursue a **durable completion objective** across restarts, resumes, and forks. Agents can create and update the objective, while **people can inspect or control it directly with `/goal` without spending a model turn**. An optional continuation package can keep active work moving through sequential Rounds. **Each session has only one current goal**, and that goal **records completion state rather than scheduling work; automatic continuation must therefore be enabled separately**."
> — `packages/goal/README.md`（`## Summary` 逐字）

普通聊天里「帮我完成 X」这句话会随上下文漂走；goal 把它变成一条持久记录，人和 agent 都能查、能改，且**人有 `/goal` 这条不花模型 token 的直接通道**。注意两个限定：**每会话只有一个目标**；**记录完成状态 ≠ 会自动干活**（自动续跑要另开 `goal-round-driver`）。

**workflow（工作流）**——一句话：让模型**写一段编排脚本**，扇出到大量子代理，最后返回一个值。

> "The workflow group lets an agent run **orchestration scripts** that delegate work to subagents and return a final value. The `workflow` tool supports scripted fan-out; the opt-in `ralph` tool runs a fixed sequence of fresh agents. Scripts use the shared PTC Node process runtime under the calling Session's file policy."
> — `packages/workflow/README.md`（`## Summary` 逐字）

工具面的使用边界写得很克制（`packages/workflow/tool-workflow/README.md`）：

> "Use it only when the user explicitly requests a workflow or large multi-agent orchestration; **prefer plain subagent calls for one or two delegations**."

以及一条对用户有意义的语义：前台执行**等全部完成**，「cancellation or abnormal completion returns an error rather than partial success」；`run_in_background: true` 立刻返回一个**带所有权的 job id** 并暴露实时输出。普通聊天一次只能推进一条线；workflow 让「一次跑几十个独立子任务」变成一个工具调用。

**jobs（后台作业）**——一句话：不阻塞本轮 turn 的长活，且**只在归属会话里可见**。

> "The jobs group is the background-work capability family: tools that run long work register it as a job, and **the owning agent can read, wait on, list, and cancel it without blocking its own turn**. Jobs belong to the agent session that started them, so **one agent never sees another's work**, and **completion is delivered to the owning agent in-session instead of polled**."
> — `packages/jobs/README.md`（`## Summary` 逐字）

两个关键词：**不阻塞**、**推送而非轮询**。普通聊天里发起一个耗时命令只能干等；jobs 让 agent 继续做别的事，干完主动通知。

**schedule（定时提醒）**——一句话：给**当前会话**排一条未来会到达的普通消息。

> "The schedule group lets an agent create, list, and cancel **reminders for the current conversation**. Reminders can run **after a delay, at an absolute time, or on a fixed interval**; when due, **they arrive as ordinary messages in that conversation**. They **survive restarts, but never leave the session or send email, SMS, or push notifications**."
> — `packages/schedule/README.md`（`## Summary` 逐字）

边界非常干净：**会话内的持久定时器，绝不外发通知**。前端指示器是缓存态，可能滞后于运行中的会话。

**plan（计划模式）**——一句话：先探勘设计、给出计划、**等人批准**，再动手。

> "The `plan/` group provides **plan mode**: while it is active, the agent explores and designs before executing, guided by instructions the deployment writes, and **presents the finished plan for your approval before carrying it out**. You can enter and leave plan mode with the `/plan` command and **approve the plan or send the agent back to keep planning**. **Plan mode guides rather than restricts: every tool stays available**, and limits such as sandbox mode and approval prompts are configured separately."
> — `packages/plan/README.md`（`## Summary` 逐字）

对用户：有了「先看方案再让它动手」的关口。**注意最后一句是诚实且重要的**——plan 模式**只是引导，不是强制**，工具并没有被锁；真正的限制来自沙箱与审批（那是另外两个旋钮）。

**checkpoint（检查点）**——一句话：在**会造成外部影响的动作之前**先落盘，让崩溃后能无损续上。

> "Use this package with a session persistence backend to make work durable **before a model request, before a top-level tool can cause external effects, and before the next agent step begins**. After each checkpoint, work can resume after a crash from stored requests, tool calls, responses, and results **without loss**. **Checkpoint failures are fail-closed: a model adapter or top-level tool body does not run until the durable write succeeds.** The package has no configuration and adds no prompt or tool schema; unfinished Assistant streams remain transient, and **interrupted tool calls recover with an unknown outcome instead of an automatic retry**."
> — `packages/session/session-checkpoint-policy/README.md`（`## Summary` 逐字）

出厂的接线注释也直说目的（`packages/bundle/base/cordis.patch.yml`）：

> "# Durability checkpoints before each model request and top-level dispatch."

对用户：这是「崩溃了也基本不丢东西」的机制。三条细节值得记：**零配置**、**不增加提示词或工具 schema（所以不花 token）**、以及一条重要的诚实声明——**被打断的工具调用以「结果未知」恢复，绝不自动重试**（因为重试可能造成重复副作用）。

---

## 对普通 AI 用户的启示

1. **「模型看到什么」和「日志里记了什么」在这个产品里是同一件事，而且有代码强制。** 不是口号：`packages/core/agent-loop/src/invariant.ts:41` 在每次模型请求时断言 `JSON.stringify(options.messages) === JSON.stringify(session.deriveMessages())`，不一致就报 `log-reconstruction desync`。含义：你看到的对话历史就是模型看到的，没有隐藏的额外输入。

2. **崩溃不是灾难，是「可检测的异常」。** 会话日志只追加、已提交的代际永不改写（`docs/architecture.md:123`）；崩溃后恢复会补上合成的收尾事件（`interruptedTurnClosers`，含 `turn/end {interrupted}`），所以那次中断会被**明确标记**，而不是假装成功结束（`packages/session/session-persistence/README.md`）。

3. **被打断的工具调用以「结果未知」恢复，绝不偷偷重试。** 原文：「interrupted tool calls recover with an unknown outcome instead of an automatic retry」（`packages/session/session-checkpoint-policy/README.md`）。对用户是好事：不会在你不知情的时候把同一个有副作用的操作做两遍。

4. **审批通道坏掉的默认行为是「拒绝」，不是「放行」。** `ApprovalOutcome` 是封闭集合，`allowed-once` 只授权**被问的那一次动作**；缺失/不拥有/抛异常/不合规的应答者一律降级为 `unavailable`，而「callers fail closed on `unavailable`」（`docs/subsystems/approval.md:19,25`）。

5. **沙箱只管文件，不管网络。** 这条必须知道：「Network and process visibility are outside this vocabulary」（`docs/subsystems/sandbox.md:13`）。沙箱强度还会自报家门——`full` 或 `partial`，「partial means … cannot govern every promised file effect」，所以看到 `partial` 时不应把它当成绝对边界（`:27`）。

6. **被沙箱拒绝时的措辞是诚实的，且明确要求不要绕路。** 逐字：`[sandbox: file access denied under <mode> mode]` —— 「a policy denial, not a bug in the command; **do not retry another way**」（`packages/shell/tool-bash/src/index.ts:105`）。沙箱运行器自己挂了也有另一句，明确区分「沙箱问题」与「命令失败」。

7. **长会话不会崩，但会付两次代价：一次额外的模型调用，和一段历史被换成摘要。** 默认在 `floor(min(W×0.8, W−O−65536))` 触发，保留最新 16% 原文（`packages/compaction/compaction-basic/README.md:62`）；并且压缩**压不动 system prompt、工具定义和会话前缀**（同文件 `:14`）。想让会话更"记得住"，可以调 `thresholdRatio` 更晚压、`retainRatio` 更大。

8. **Agent Teams 还只是实验品，而且它在**默认关闭**、有硬上限、有明确做不到的事。** 数字是实的：最多 16 名成员（**含创建失败的**）、任务板 256、每人待处理消息 64、单条消息 65536 字节（`packages/experimental/agent-team/src/index.ts:43-47`）。并且「no stability promise」「needs durable session storage to activate」，`inactive` 只表示「此刻没 turn 在跑」，**不代表任务完成**（`packages/experimental/agent-team/README.md:12,63`）。

---

## 对 Agent 开发者的启示

1. **不要改循环——挂到已文档化的扩展点上。** 「Plugins, not loop changes: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md」（`AGENTS.md:137`），并且有一张 20 行的「Where new behavior goes」权柄表（`docs/architecture.md:141-162`）。拦截请求/工具/turn 一律走 `agent/*` / `tools/*` 事件，**没有一条是「加个 if 到循环里」**。

2. **设计能力要先设计三个角色，缺一不可。** 「A capability seam comprises Service Definition / Service Provider / Consumer roles. It is complete, never one role」（`AGENTS.md:138`）。定义必须是 Cordis `Service`（抽象类或注册表），**不是 TS `interface`**（`docs/glossary.md:9`）。角色只在独立演化时才拆包——否则一个包可以同时拥有多个角色（`dsh-user-approval` 就是这样）。

3. **依赖方向用 `package.json` 的字段来表达，而不是靠约定。** 全仓库对 `dsh-agent-loop` 的**运行时**依赖只有 2 个，且都是 bundle（组合层）；47 个功能包只把它列在 `devDependencies`（实测自 `packages/*/*/package.json`）。所以「插件不依赖循环」是**可机械检查**的，不是君子协定。

4. **要提供重试钩子，就把「失败」做成一个一等事件，让策略成为可选插件。** 范式是 `agent/request-error`：监听器返回 `{ kind: 'retry' }` 且**不调 `next()`** 即接管；`dsh-llm-retry` 因此「introduces no service or new loop branch」（`.agents/notes/.../2026-06-21-bounded-llm-request-recovery.md:53`）。同时**失败尝试必须与真实历史分离**——`assistant/attempt` 只写日志，`deriveMessages()` 忽略它，所以失败的部分输出永远不会污染模型上下文。

5. **对「模型可见」的输入，用运行时不变式兜底，并且挂到 waterfall 最前面防止被短路静音。** `invariant.ts:20` 的注释写明了这个意图：`prepend` 是为了「Prevent a short-circuiting replay listener from silencing the check.」

6. **并行工具调用的安全分类是「一元」的，因此保守做法是：语义排他的一律标 exclusive。** `maxParallelToolCalls` 默认 10，排他调用构成排序屏障（`packages/core/agent-loop/README.md:48,75`）；但已知限制是「Classification is unary — calls whose safety depends on comparing siblings or resources must remain exclusive」（`:199`）。**无法表达「A 与 B 不能同时跑」，所以只能退化成串行。**

7. **多代理协作里，最贵的坑是「把建议当成锁」。** dsh 的评审明确拒绝把 task owner / writeScopes 当锁，理由值得背下来：「external writers bypass them, crashed owners remain durable, and path-prefix overlap cannot prove semantic independence. **False mutual exclusion is more dangerous than an explicit warning.**」（`.agents/notes/.../2026-08-05-agent-teams.md`，Alternatives）。对应的产品行为也很反直觉：**owner 永不自动释放**——不活跃、被打断、进程退出、任务失败都不释放（`packages/experimental/agent-team/README.md:205`）。

8. **跨进程的邮箱不要承诺 exactly-once。** 诚实的表述是「process-local retry plus target-Session de-duplication, not cross-process exactly-once delivery」，去重键是「target Session 把 message identity + sender attribution 同时记在 pending inbox item 与最终 user message 上，折叠这两处即为去重键」（`packages/experimental/agent-team/README.md:132`、`docs/subsystems/agent-team.md:43`）。同时把**投递模式写死**而不是留给调用方选——「Scheduling is not stored in the durable record because **callers cannot select another mode**」（`docs/subsystems/agent-team.md:41`）。少一个选项 = 少一类恢复分支。

9. **把「尽力而为」与「保证」分开标注，用一个专门的类型去防止转录冒名。** `SubagentSettledMessageSource` 的 JSDoc 是极好的范例（逐字）：**「Deliberately a different kind from `AgentMessageSource`: an Agent message is content the sender chose, while this message is the manager stating what became of the child, and a transcript that merged them would credit the child with words it never wrote.」**（`docs/subsystems/subagent.md:205-211`）

10. **启动时就要大声失败，不要等到运行期。** 这条在仓库里反复出现：能力缺失在 run 存在之前就拒绝（`SubagentError('UNSUPPORTED_CAPABILITY')`，`docs/subsystems/subagent.md:15`）；压缩配置错了在 load 期就拒绝（`packages/compaction/compaction-basic/README.md:86`）；权限预设配错在 load 期就抛（`docs/subsystems/permission-presets.md:11`）；dsh-llm 对未注册 provider 报 `NO_ADAPTER`、对畸形凭据报 `INVALID_CREDENTIAL`「instead of surfacing as an opaque fetch error」（`packages/llm/llm/README.md:72`）。

---

## 可直接引用的金句

以下 20 条均为**逐字**引用（保留英文原文以便核对；括号内为建议中译）。

1. **「Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so each is replaceable from configuration.」**
   — `docs/architecture.md:11`
   （产品的每一部分都是插件，包括模型适配器、工具注册表、会话日志，以及 agent 循环本身——因此每一部分都可以从配置替换。）

2. **「There is no privileged core to patch: you extend dsh by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads.」**
   — `docs/architecture.md:13`
   （没有需要打补丁的特权内核：你通过在其他插件旁边挂一个插件来扩展 dsh，而注册是可逆副作用，插件卸载时会自动回滚。）

3. **「A step is one model request plus the tools it calls. A turn is zero or more steps: it opens before its first input is claimed and closes once nothing is owed.」**
   — `docs/architecture.md:86`
   （一个 step = 一次模型请求 + 它调用的工具；一个 turn = 零个或多个 step。）

4. **「**Model-visible means logged.** Anything that reaches a model request must be reconstructable from the log, and a runtime invariant asserts it. A new model-visible input requires a session event.」**
   — `docs/architecture.md:125`

5. **`fail(\`llm request for session "${String(session.id)}" diverges from the dispatch-time durable derivation (log-reconstruction desync)\`)`** — 以及它上方那行 **`if (JSON.stringify(options.messages) !== JSON.stringify(expected))`**
   — `packages/core/agent-loop/src/invariant.ts:41-42`
   （模型可见 ⟺ 已记录的运行时强制：请求与从日志推导出的消息必须逐字节一致。）

6. **「// Prepend prevents a short-circuiting replay listener from silencing the check.」**
   — `packages/core/agent-loop/src/invariant.ts:20`
   （这次检查被有意挂在 waterfall 最前面，防止任何插件用短路把它静音。）

7. **「Plugins, not loop changes: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.」**
   — `AGENTS.md:137`

8. **「New behavior attaches to a documented extension point. Changing the loop itself updates this map.」**
   — `docs/architecture.md:139`

9. **「A capability seam comprises Service Definition / Service Provider / Consumer roles. It is complete, never one role; split only when roles evolve independently.」**
   — `AGENTS.md:138`

10. **「This service never re-runs a request: retrying is the job of `dsh-llm-retry` at the agent's failed-step extension point.」**
    — `packages/llm/llm/README.md:72`
    （LLM 服务永不重跑请求；重试是 `dsh-llm-retry` 在 agent 的失败步骤扩展点上做的事。）

11. **「`@deepseek-ai/dsh-llm-retry` is a function plugin that listens to `agent/request-error`. It introduces no service or new loop branch; the agent-loop package changes only the data carried through its existing failed-step recovery control flow.」**
    — `.agents/notes/implemented/architecture/2026-06-21-bounded-llm-request-recovery.md:53`

12. **「anything the StreamChunk vocabulary cannot express for BOTH implementations is a core-vocabulary bug」**
    — `.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md`
    （凡是 StreamChunk 词汇表**无法同时**表达两个实现的东西，都是核心词汇表的 bug。）

13. **「Protocol ordering — `usage` precedes `finish`, tool arguments stay raw JSON strings, and nothing follows the terminal `finish`.」**
    — `packages/llm/llm/README.md`（Invariants 节）
    （协议次序：usage 在 finish 之前；工具参数全程是原始 JSON 字符串；终局 finish 之后什么都没有。）

14. **「Every stream ends in exactly one terminal `finish` chunk … consumers route on the code, never on message text.」**
    — `packages/llm/llm/README.md:72`
    （按错误码路由，永不按消息文本路由。）

15. **「`allowed-once` grants only the asked-about action; callers deny on `rejected`, `cancelled`, and `unavailable`. A missing, non-owning, throwing, or non-conforming answerer becomes `unavailable` rather than opening the gate.」**
    — `docs/subsystems/approval.md:19`
    （审批失败关闭：拿不到答案 = 拒绝，绝不等于放行。）

16. **「Commands may run under a file sandbox; a blocked file operation is reported as `` `[sandbox: file access denied under <mode> mode]` `` — a policy denial, not a bug in the command; do not retry another way.」**
    — `packages/shell/tool-bash/src/index.ts:105`

17. **「Network and process visibility are outside this vocabulary.」**
    — `docs/subsystems/sandbox.md:13`
    （沙箱词汇表只管文件效果——网络与进程可见性不在其中。）

18. **「`partial` means an active backend or older kernel ABI cannot govern every promised file effect; callers requiring an absolute boundary must not treat it as `full`.」**
    — `docs/subsystems/sandbox.md:27`

19. **「Messages are never lost and never delivered twice.」** / **「A queued message is already safely stored, so it must not be resent.」**
    — `packages/experimental/agent-team/README.md:69,71`

20. **「`inactive` means no turn is executing, whether the member is loaded or must be resumed; it does not describe task completion or outcome.」**
    — `packages/experimental/tool-agent-team/README.md:64`
    （inactive ≠ 任务完成——它只表示此刻没有 turn 在执行。）

21. **「Teammate names are permanent — even a teammate whose creation failed keeps its name, and no name is ever reused.」**
    — `packages/experimental/agent-team/README.md:61`

22. **「A failed member permanently consumes its name and member slot, making provisioning failures visible instead of silently recycling identity.」**
    — `.agents/notes/implemented/feature/2026-08-05-agent-teams.md`（`## Consequences`）

23. **「Treat task ownership or write scopes as locks. Rejected because external writers bypass them, crashed owners remain durable, and path-prefix overlap cannot prove semantic independence. False mutual exclusion is more dangerous than an explicit warning.」**
    — `.agents/notes/implemented/feature/2026-08-05-agent-teams.md`（Alternatives considered）

24. **「Deliberately a different kind from `AgentMessageSource`: an Agent message is content the sender chose, while this message is the manager stating what became of the child, and a transcript that merged them would credit the child with words it never wrote.」**
    — `docs/subsystems/subagent.md:205-211`

25. **「Condensation uses one extra model request and retains only its summary text. It cannot reduce the system prompt, tools, or session prefix, or split one indivisible unit such as a single huge tool call.」**
    — `packages/compaction/compaction-basic/README.md:14`

26. **「Nothing deletes session files — logs accumulate under `root` until removed externally; the seam has no deletion API.」**
    — `packages/session/session-persistence-jsonl/README.md:163`

27. **「Checkpoint failures are fail-closed: a model adapter or top-level tool body does not run until the durable write succeeds.」** / **「interrupted tool calls recover with an unknown outcome instead of an automatic retry.」**
    — `packages/session/session-checkpoint-policy/README.md`

28. **「DeepSeek Harness is experimental developer-preview software. It has not undergone a security audit and must not be treated as secure or production-ready.」**
    — `SAFETY.md:5`

29. **「Sandboxing, approval prompts, and permission controls can reduce risk, but they do not guarantee isolation or prevent damage. … Do not rely on DeepSeek Harness as the sole security control for untrusted workloads.」**
    — `SAFETY.md:13,15`

30. **「Plan mode guides rather than restricts: every tool stays available, and limits such as sandbox mode and approval prompts are configured separately.」**
    — `packages/plan/README.md`

---

## 附：本次核实中新发现的事实（对原设问的更正与补充）

1. **「插件只依赖接口包、绝不依赖 agent-loop」基本成立，但需要精确化**：全仓库**运行时**依赖 agent-loop 的只有 2 个包，且都是 bundle（组合层，职责就是把这一行挂进可 patch 的树）；47 个功能包只在 `devDependencies` 里引用它。详见 §1.4。

2. **「失败步骤扩展点」的官方名字是 `agent/request-error`**，是一个 waterfall 事件；监听器返回 `{ kind: 'retry' }` 且不调 `next()` 即接管。`packages/core/agent-loop/src/agent.ts:477` 是派发点。详见 §2.5。

3. **持久化后端：只有 1 个（JSONL），且 SQLite 后端已被删除**（`4553c9d957 refactor(session)!: remove SQLite persistence backend`）。`packages/session/session-persistence-sqlite/` 只剩未跟踪的 `lib/` 残留、无 `package.json`、无 `src/`，`git ls-files` 为空。README 自称「sole first-party Session-persistence provider」。**仓库根 `AGENTS.md:7` 仍写着「SQLite uses monotonic SCHEMA_VERSION」，属文档滞后。** 详见 §5.3 / §8.5。

4. **「Model-visible ⟺ logged」在四处出现**（`packages/llm/llm/README.md:12,112`、`docs/architecture.md:125`、`AGENTS.md:136`），并由 `packages/core/agent-loop/src/invariant.ts:41` 的运行时断言强制执行——用户记忆中的表达式**完全正确**。详见 §5.2。

5. **技能的四象限模型确实存在**，由 `SkillInvocationPolicy` 的两个正布尔定义，frontmatter 键为 `disable-model-invocation` 与 `user-invocable`，省略即 `true`。「都设为 false」是第四象限（只有受信任的 `ctx.skills.get()`）。旧驼峰键会被**显式拒绝**。详见 §6.2。

6. **Agent Teams 的六个限制里，最反直觉的不是 `inactive`，而是「owner 永不自动释放」**：不活跃、被打断、进程退出、任务失败**都不释放任务所有权**。`inactive` 那条是第二反直觉。详见 §3.9 / §3.6。

7. **沙箱的强度是一个自报的枚举（`full` / `partial`），不是布尔**，且 `danger-full-access` **根本不调用沙箱服务**（「spawns its original argv and does not call `ctx.sandbox`」）。详见 §7.3。

8. **`agent-loop` 的已知限制里有一条重要的**：**没有内置 turn 预算**，限制失控 turn 必须从 `agent/turn-stopping` 这类既有扩展点取消。详见 §2.6。
