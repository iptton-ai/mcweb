# ZCode 架构分析报告（源码取证版）

> **分析对象**：`github.com/zai-org/ZCode`（Z.ai 的编码 Agent 工作台）
> **检出**：`/Users/zxnap/code/MyWorks/yltech.edu/game/.ref-zcode/ZCode`
> **HEAD**：`aac4755`「feat: update to v3.15.1」（根 README 标注 2026-10-10），**仅 4 个 commit**（squashed，无可用 git 历史）
> **方法**：只读源码取证。所有结论附 `path:line` 或逐字引用。凡未能证实的一律标注「未能证实」。
> **用途**：中文技术文章素材，面向 (A) 普通 AI 用户、(B) Agent 开发者，并与 dsh 做架构对比。

**证据强度图例**：✅ 有源码/规格双重取证 · ⚠️ 仅有文档或仅有代码单侧 · ❌ 本检出中不存在（可能是闭源/裁剪）

---

## 总体印象（先说三个反直觉点）

1. **ZCode 不是 CLI，甚至不主要是 CLI。** 它是一个**多端产品**：Electron 桌面应用（主形态）+ 浏览器 Web + 手机远控 + 一个被桌面当子进程拉起的 `zcode-cli` Agent 运行时 + 一个可独立部署的 `zcode-server` 远端宿主。`apps/zcode-cli` 虽然叫 CLI，但架构文档把它定位为「**conversation 的权威状态持有者**」，是**每个 workspace 一个的 Agent 内核进程**，不是用户入口。
2. **ZCode 有一套「架构治理」机制**（`architecture-policy.yaml` + `pnpm architecture:check`），用机器可校验的模块边界、分层顺序、文件行数上限来约束 AI 时代的代码增长。这是 dsh 那套「Cordis 微内核 + Service Definition 三角色」完全不同的治理哲学。
3. **ZCode 的 multi-agent 能力是「克制的」。** 它有 subagent、后台 subagent、双向 mailbox（`SendMessage` / `RespondToCoordinator`），但**没有 Agent Teams / swarm**——而且这一点是**显式写在规格里的非目标**，不是没做。

---

## §1 整体形态 / 产品形态

### 1.1 ZCode 是什么

根 README 的第一句就是产品定义：

> 「ZCode 是 AI 编程工作台，提供桌面应用、浏览器界面和终端 Agent。本仓库包含客户端、后端服务、共享 UI，以及 Agent CLI 与运行时源码。」
> —— `README.md:19`

仓库是 pnpm monorepo，`packages/` 下 21 个包 + `apps/` 下 2 个应用：

| 目录 | 包名 | 角色 |
| --- | --- | --- |
| `apps/zcode-cli` | `zcode-cli` v0.16.9 | Agent 运行时内核（会话/轮次/工具/模型） |
| `packages/desktop` | `@zcode/desktop` | Electron 壳：main / preload / renderer / **host** |
| `packages/web` | `@zcode/web` | 浏览器 Web 客户端（Vite） |
| `packages/android` | (Gradle 工程，无 package.json) | Android 客户端 |
| `packages/server` | `@zcode/server` | `zcode-server` 远端宿主（SSH/WSL/Docker 目标上的服务端） |
| `packages/zcode-server-cli` | `@zcode/server-cli` | 远端 server 的 CLI 包装 |
| `packages/ui` | `@zcode/ui` | **平台无关 React UI + hooks + Zustand store**，桌面/Web/手机复用 |
| `packages/services` | `@zcode/services` | Host 侧业务服务接口 + Node 实现 |
| `packages/rpc` | `@zcode/rpc` v1.0.0 | Channel RPC / transport / proxy / 事件中间件 |
| `packages/client` | `@zcode/client` | Service proxy 与客户端 transport 装配 |
| `packages/shared` | `@zcode/shared` | 跨进程类型、V4 schema、workspace identity、平台契约 |
| `packages/provider` / `provider-node` | `@zcode/provider(-node)` | 模型 provider 抽象与 Node 侧实现 |
| `packages/zcode-cua` | `@zcode/zcode-cua` v0.6.3 | **Computer Use 占位包（本版本不含 CUA）** |
| `share-ui` / `web-share` / `stream-animate` / `model-option-map` / `formal-proof` / `e2e-report` | — | 分享 UI、流式动画、形式化验证、E2E 报告等支撑包 |

> `packages/*/package.json` 名称逐一读取；`zcode-cua` 的 description 逐字为：
> 「API-compatible placeholder package for Computer Use. This build ships without Computer Use: every runtime surface reports unavailable and fails closed.」

### 1.2 运行时拓扑（当前事实）

`docs/architecture/architecture.md` 已自认「历史」，并指向当前事实文档。**当前口径**来自 `docs/architecture/zcode-code-architecture-overview.md`：

> 「Z Code 可以运行多个 workspace window；每个窗口有且只有一个 Window Host，每个 workspaceKey 最多一个聊天 CLI。Renderer 只通过 service/protocol 边界访问能力；CLI 持有 conversation 的权威状态。」
> —— `docs/architecture/zcode-code-architecture-overview.md:7`

其给出的拓扑图（`zcode-code-architecture-overview.md:9-26`，逐字）：

```text
Electron App
├─ Main Process（调度/原生能力/attachment 中转）
└─ Workspace Window（每个窗口独立一组）
   ├─ Renderer
   └─ Window Host（唯一 PID）
      ├─ LocalSource
      │  ├─ workspaceKey A ── stdio ── zcode-cli A
      │  └─ workspaceKey B ── stdio ── zcode-cli B
      ├─ RemoteConnectionRegistry
      │  ├─ SSH / WSL pooled connection
      │  ├─ Docker / Server dedicated connection
      │  └─ remoteSessionId -> workspaceKey scoped services
      ├─ ControllerProjection（workspace/task 列表事实）
      └─ AttachmentRegistry
         ├─ desktop-continuous
         └─ web-remote-replayable
```

关键设计点，逐条取证：

- **Window Host 是每窗口唯一进程**，由 `createLocalServices({ parentPort })` 初始化；「一个窗口只注册一个 realtime `hostId`」（`zcode-code-architecture-overview.md:42,44`）。
- **每个 workspaceKey 最多一个 CLI**：「CLI 承载 session/core runtime、V4 command inbox、幂等/CAS 裁决、ProductProjection reducer、conversation topic、queue、goal、interaction、tool 与模型运行态。」（`zcode-code-architecture-overview.md:50`）
- **Main Process 被刻意削薄**：「Main 不拥有连接池、logical session lifecycle、task projection、row、stream、queue、snapshot、goal 或 interaction 状态；`remoteSessionId` 由 Window Host 分配。」（`:34`）
- **身份与路径分离**是一个反复强调的不变量：

```text
workspaceKey = workspaceIdentity?.trim() || workspacePath
```
（`zcode-code-architecture-overview.md:55`；同一公式在 `docs/bots.md:22`、`docs/automation-edit-status.md` 等多处复述）

  「身份/隔离使用 workspaceKey：CLI 映射、session 绑定、缓存、队列、持久化与跨进程关联。文件执行使用 workspacePath：cwd、文件读写、Git 和路径展示。」（`:58-59`）

### 1.3 通信协议三层模型

`docs/architecture/communication-protocol-layers.md` 用「寄快递」做心智模型（`:13-19`）：

```text
第 3 层：内容 —— 要做什么        （快递里的物品 = 业务内容）
第 2 层：信封 —— 如何描述、编号和匹配消息 （快递单和包装 = 消息协议）
第 1 层：通道 —— 消息通过什么管道传输    （卡车、公路、飞机 = 传输通道）
```

- **第 1 层通道**（`:29-33`）：`MessagePort`（Renderer↔Host）、`stdio`（Host↔CLI、server↔CLI）、`WebSocket`（连远端 server / 手机 relay）、Electron IPC、UtilityProcess `postMessage`（Main↔Host）。
- **第 2 层信封**（`:49-88`）三种形式：`@zcode/rpc`（通用 Service 调用，支持 call/response/listen/事件）；**ZCode Protocol JSON envelope**（Host↔CLI，NDJSON over stdio）；Typed IPC `postMessage`（Main↔Host 控制消息）。

ZCode Protocol 的报文形态（`:60-72`，逐字）：

```json
{
  "id": 42,
  "method": "v4/command",
  "params": {
    "commandId": "cmd-123",
    "clientId": "desktop-client",
    "sessionId": "session-1",
    "type": "sendText",
    "payload": { "text": "你好" }
  }
}
```

- **第 3 层内容**：V4 对话协议（`createSession`、`sendText`、`stop`、`compact`、`switchModelConfig`；命令 ACK；conversation topic 的 snapshot/delta/`seq`/`revision`；两种交付语义）。

最锋利的一句定义：

> 「V4 的最终事实源和命令裁决者是 workspace 对应的 `zcode-cli`，不是 Renderer、Main 或 Relay。」
> —— `communication-protocol-layers.md:104`

各链路对应关系表（`:131-139`，节选逐字）：

| 链路 | 第 3 层：内容 | 第 2 层：信封 | 第 1 层：通道 |
| --- | --- | --- | --- |
| Renderer → Host | Service API、V4 命令/查询/订阅 | `@zcode/rpc` | `MessagePort` |
| Main → Host | Host 控制消息 | typed `{ type, ... }` | `postMessage` |
| Host → 本地 CLI | V4、少量 legacy 操作 | ZCode Protocol JSON | stdio NDJSON |
| Host → `zcode-server` | 远程 Service API，参数可携带 V4 | `@zcode/rpc` | SSH stdio 或 WebSocket |
| 手机 → Relay → Main | 远控 Service/V4 调用 | relay envelope + `rpc-frame` | WebSocket |

### 1.4 消息流：ACK 与 projection 是两种语义

`docs/architecture/message-flow.md:28-42` 给出输入时序，并强调：

> 「ACK 与 projection 是两条不同语义：ACK 回答"命令是否被接纳/拒绝"，projection 回答"产品状态现在是什么"。UI 最终必须以后者收敛。」
> —— `docs/architecture/message-flow.md:42`

主链路（`:5-24`，逐字）：

```text
ConversationComposer / SessionPane
  │ createSession | sendText | other V4 command
  ▼
agentConversationTransport
  ▼
Host: sendConversationCommandV4
  ▼
workspaceKey 对应的 zcode-cli
  ├─ command inbox 裁决
  ├─ core 执行
  └─ ProductProjection 更新
       │ snapshot / delta
       ▼
SessionDataLayer
  ▼
ConversationProjectionStore
  ▼
ConversationTimeline / Composer / StatusPanel
```

**多端交付差异**是本架构最有特色的一处设计（`:46-48`）：

- 桌面：`desktop-continuous`，直接订阅 live topic；断线后按 seq 恢复。
- 手机远控：`web-remote-replayable`，经 shared-host attachment 订阅同一 Host/CLI，并保留 gap/snapshot 恢复。
- 「relay 与 Electron main 只做鉴权、配对、心跳、frame 透传和 attachment 调度，不拥有 conversation 状态。」（`:48`）

且 `AGENTS.md` 把它列为硬约束：「Desktop 的 `desktop-continuous` 实时链路与手机的 `web-remote-replayable` 恢复链路必须明确区分。修改 stream、snapshot、queue 或重连时，同时验证两种语义。」

### 1.5 架构治理：`architecture-policy.yaml` 是机器可执行的宪法

仓库根有 `architecture-policy.yaml`（6257 字节），由 `pnpm architecture:check --changed` 强制。它逐模块声明 `roots` / `managed` / `requires` / `publicEntrypoints` / `layers` / `owner`。全局规则（`architecture-policy.yaml` 尾部）：

```yaml
global:
  maxFileLines: 400
  maxContractLines: 300
  maxPublicMethods: 12
  forbidCycles: true
  forbidDeepImports: true
  managedOnly: true
```

并带**显式例外登记**（`exceptions:` 段），每条必须写 `reason`，例如：

```yaml
  - id: gen-ui-tweak-runtime-size
    rule: max-file-lines
    paths: [packages/desktop/src/renderer/src/plugin-sandbox/genUiTweakRuntime.js]
    reason: Keep parameter binding and registration lifecycle together; runtime-manifest.json and tests verify file integrity.
```

**这是与 dsh 最本质的对比点之一**：dsh 用 Cordis 的运行时服务图来表达架构（能力即插件，运行时组合）；ZCode 用**静态策略文件 + CI 检查**来表达架构（边界即声明，编译前拦截）。`managed: true` 表示该模块已完成迁移并接受完整层序检查；`managed: false` 是 legacy 豁免——这是一条**渐进式治理**路径。

**⚠️ 发现一处政策漂移**：`architecture-policy.yaml` 声明

```yaml
  - id: session
    roots: [packages/services/src/session]
    requires: [shared]
    publicEntrypoints: [packages/services/src/session/contract.ts]
    owner: conversation
```

但 `packages/services/src/session/contract.ts` **在本检出中不存在**（`ls packages/services/src/session/` 无 `contract.ts`；`wc -l` 报 `No such file or directory`）。session 模块的实际内容全是实现文件（`automationCron.ts`、`automationService.ts`、`zcodeTaskService.ts`、`sessionMailbox.ts` 等）。这说明**策略文件声明的公开入口没有落地**——治理规则本身也有漂移。相对地，同级 `storage` 模块的 `contract.ts` 真实存在（35 行）。

### 1.6 为什么重要

对普通用户：ZCode 是「**装了桌面端后，同一个 Agent 还能被 Chat 里叫、被手机远控、被定时器唤起**」的产品——它是**一个 Agent 内核 + 多个外壳**，不是一个命令行工具加几个壳。

对 Agent 开发者：这是一套**把「权威状态在哪」写进文档并反复强制的架构**。三处独立文档（overview / message-flow / protocol-layers）都在重复同一句话「CLI 是唯一事实源，Main/Relay/Host 都不持有业务状态」。这种「同一不变量在多个入口重复声明」的写法，本身是为 AI 协作写的：模型改代码前读文档就能知道哪条线不能碰。

---

## §2 Agent 循环 / 内核

### 2.1 Turn 是一台显式状态机

核心在 `apps/zcode-cli/packages/core/src/agent/turn-state.ts`。**Turn 有 10 个相位**（`:25-36`，逐字）：

```ts
export const TurnPhase = {
  Idle: "idle",
  ProcessingInput: "processing_input",
  AwaitingModelResponse: "awaiting_model_response",
  Streaming: "streaming",
  SchedulingTools: "scheduling_tools",
  ExecutingTools: "executing_tools",
  AggregatingResults: "aggregating_results",
  AwaitingPermission: "awaiting_permission",
  Completing: "completing",
  Error: "error",
} as const;
```

**合法转移被硬编码成表**，非法转移直接抛错（`turn-state.ts:231-264`）：

```ts
const validTransitions: Record<TurnPhase, TurnPhase[]> = {
  [TurnPhase.Idle]: [TurnPhase.ProcessingInput],
  [TurnPhase.ProcessingInput]: [TurnPhase.AwaitingModelResponse, TurnPhase.Completing],
  [TurnPhase.AwaitingModelResponse]: [TurnPhase.Streaming, TurnPhase.Completing, TurnPhase.Error],
  [TurnPhase.Streaming]: [TurnPhase.SchedulingTools, TurnPhase.AggregatingResults, TurnPhase.Completing, TurnPhase.Error],
  ...
};
return validTransitions[current]?.includes(next) ?? false;
```

`turn-machine.ts:92-104` 的 `transition()` 在非法时抛 `CoreErrorType.InvalidTurnPhase`。

**回环的关键**：`getNextPhase()`（`turn-machine.ts:308-339`）在 `AggregatingResults` 阶段判定——若失败工具数 > 0 则去 `Completing`，否则**回到 `AwaitingModelResponse`**。这就是 agent loop 的「再问一次模型」的显式表达。

### 2.2 Turn vs Step

- **Turn** = 一次用户输入引发的完整处理单元，有 `TurnId`、`traceId`、`turnNumber`，产出 `TurnComplete` / `TurnError` 事件（`runtime/methods/turn.ts:135,321-349,697-716`）。
- **Step** = 一次模型往返（model roundtrip）。`turn-loop.ts` 的主循环里 `state.modelStepCount` 计数（`turn-loop.ts:56,78,81,95`），每步重新投影 context、重新取工具、重新做 compact 判定。

`TurnState` 里聚合了整轮的全部子态（`turn-state.ts:44-66`）：`modelRequest`、`streamingContent`、`toolCalls[]`、`toolResults[]`、`scheduledTools`（含 `parallelGroups` / `executionOrder`）、`pendingInputs[]`、`pendingPermissions[]`、`resolvedPermissions[]`、`resultType`。

**结果类型有 5 种**（`turn-state.ts:149-156`，逐字）：

```ts
export type TurnResultType =
  | "success"
  // "cancelled": 用户主动中断（TurnCancelled）属于正常结束，复用 TurnComplete 上报而非 TurnError。
  | "cancelled"
  | "error_max_turns"
  | "error_max_budget"
  | "error_during_execution"
  | "error_max_tool_calls";
```

### 2.3 主循环：`runRegularTurnLoop`

`apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts`（234 行）是循环本体。它是一个 `while (true)`（`:48`），每轮做：

1. **中止检查**：`throwIfTurnAborted(state.turnAbortSignal)`（`:49`，循环内多处）。
2. **排空运行期命令**（`:56-66`）：`drainPendingRuntimeCommandsForActiveLoop()` —— 这里消费的是 **background subagent 结果**、**workflow 结果**、steering 消息。
3. **microcompact**（`:79-84`）→ **autoCompact**（`:88-101`），压缩与 `rapidRefill` 防抖。
4. **MCP 初始化与 tools/list_changed 刷新**（`:116-120`）——注释点明时序：「`tools/list_changed` 只在回合开始前生效。」
5. **取工具集**：`const tools = getTurnTools(this, state)`（`:123`）。
6. **注入一串 system reminder**：`plan_mode_exit`（`:131`）、`runtime_mode`（`:143`）、`todo_reminder`（`:154`）、`output_style`（`:173`）。
7. **构造 provider-visible 消息**：`buildRuntimeProviderRequestMessages(this, {...})`（`:187-192`），并显式设置 `applyCacheControl: true`，注释解释根因：「provider-visible user ordering projection 会改变最终 latest user 落点，cache-control 必须在 projection 后统一设置，避免 raw synthetic entry 抢占缓存锚点。」（`:185-186`）
8. **驱动状态机**：`state.turnMachine.startModelRequest(...)`（`:202-207`）。
9. **执行模型步**：`await runModelBackedTurnStep.call(this, state, {...})`（`:220-228`），返回 `"break"` 则退出循环（`:230-232`）。

### 2.4 工具调度的并发模型

`apps/zcode-cli/packages/core/src/tool/scheduler.ts`（245 行）是纯调度器：

- **默认并发 10**：`const DEFAULT_MAX_CONCURRENCY = 10;`（`:48`）
- **拓扑排序**（`:105-152`）处理工具间依赖，有环则抛 `InvalidStateTransition`。
- **分层并行组**（`:154-202`）：按依赖层级分组，同层内 `canRunParallel` 的进同一 parallel group，否则独占一组。
- **并行判定规则**（`:85-103`，逐字逻辑）：

```ts
if (tool.destructive) return false;
if (tool.concurrentSafe === true) return true;
if (tool.concurrentSafe === false) return false;
if (readOnly) return true;
return tool.sideEffectScope === "none";
```

- **只读工具白名单**（`:233-243`，逐字）：

```ts
export const READ_ONLY_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebSearch", "WebFetch",
  "TodoRead", "TodoWrite", "AskUserQuestion", "Skill",
]);
```

注意 `TodoWrite` 被列为只读——这是 `docs/agent-tool-relaxed-execution-policy.md` 放宽策略的一部分。

### 2.5 工具契约：副作用范围是一等字段

`ToolScheduleItem` 携带 `readOnly` / `destructive` / `concurrentSafe` / `sideEffectScope`（`scheduler.ts:18-27`）。`sideEffectScope` 的类型来自 contracts 的 `ModelToolSideEffectScope`。`apps/zcode-cli/AGENTS.md` 把这条上升为规范：

> 「每个 tool 都应声明明确的 `inputSchema`、`outputSchema`、是否只读、是否破坏性、是否并发安全、最大输出大小、超时、取消语义和权限需求。」
> 「tool 的副作用范围应显式声明，例如 `none`、`workspace`、`git`、`network`、`system`。权限系统、sandbox 和审批流程应读取这些声明，不依赖调用点临时猜测。」
> —— `apps/zcode-cli/AGENTS.md`「工具与副作用契约」

**⚠️ 诚实标注**：`AGENTS.md` 是规范文本；我在本检出中未逐一验证每个 tool 都实际填了全部字段。但调度器**消费**了这些字段（`scheduler.ts:85-103`），所以声明→消费的链路是真实存在的。

### 2.6 取消（cancellation）

取消是**协作式 + 作用域化**的：

- `createTurnAbortScope(options?.abortSignal)` 建立本轮 abort scope（`runtime/methods/turn.ts:139-140`）。
- 循环内每步 `throwIfTurnAborted(turnAbortSignal)` 检查。
- 取消被归为**正常结束**而非错误（`turn-state.ts:151` 的注释）：「用户主动中断（TurnCancelled）属于正常结束，复用 TurnComplete 上报而非 TurnError。」
- 收尾在 `finally` 中做有界清理（`turn.ts:873-896`）：`disposeProjectMemoryRecallPrefetch`、`clearInterval(targetRunHeartbeat)`、`releaseTurnStart`、`clearBrowserTurnState`、`finishActiveTurn`、`turnAbortScope.dispose()`。

### 2.7 模型 provider 的抽象

- `packages/provider/src/`：`registry.ts`（`ProviderRegistry` 类，含 `ProviderRegistryView { revision, providers }`、`ProviderRegistryChangedEvent`）、`resolver.ts`、`config-service.ts`、`sources.ts`、`account-provider-resolution.ts`、`model-selection-config.ts`。
- `packages/provider-node/src/`：`provider-config-runtime.ts`、`provider-registry-runtime.ts`、`zcode-builtin-*.ts`（内置 provider 配置的下载 / 物化 / 版本 / 远端同步）。

**关键设计：模型选择是持久化领域对象，不是参数**。`ModelSelection` 类型贯穿 registry（`packages/provider/src/registry.ts:2-3`），校验失败返回结构化错误码而非抛字符串（`:12-32`）：

```ts
export type ModelSelectionValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "provider-not-found"; readonly providerId: ProviderId }
  | { readonly ok: false; readonly code: "model-not-found"; ... }
  | { readonly ok: false; readonly code: "reasoning-level-missing"; ... }
  | { readonly ok: false; readonly code: "reasoning-level-not-supported"; readonly supportedLevels: readonly string[] };
```

**内置账号级 provider 有 6 个**（`packages/shared/src/model-provider-types.ts:7-14`，逐字）：

```ts
export const BUILTIN_MODEL_PROVIDER_IDS = {
  zaiIndividualCodingPlan: "account:zai-individual-coding-plan",
  zaiTeamCodingPlan: "account:zai-team-coding-plan",
  zaiStartPlan: "account:zai-start-plan",
  bigmodelIndividualCodingPlan: "account:bigmodel-individual-coding-plan",
  bigmodelTeamCodingPlan: "account:bigmodel-team-coding-plan",
  bigmodelStartPlan: "account:bigmodel-start-plan",
} as const;
```

即 **Z.ai** 与 **BigModel** 两个 family × 三档套餐（Start / 个人 Coding Plan / 团队 Coding Plan）。`packages/shared/src/model-provider-family.ts:44-60` 定义 `MODEL_PROVIDER_FAMILY_SPECS`，含 `rootDomain`（`z.ai` / `bigmodel.cn`）与 `teamCodingPlanManageUrl`。

**这与 dsh 的「twin LLM adapters」形成清晰对比**：dsh 的 twin 是「两个同源 provider 适配器各自拥有 fetch/translate 内部实现」；ZCode 是「**账号套餐即 provider 身份**」——`zaiTeamCodingPlan` 是一个 provider id，Subscription 层级被直接编码进模型选择体系，还有配套的 `coding-plan-subscription` / `usage-quota` / `coding-plan-quota-remaining-api` 服务（`docs/` 下有 10+ 篇 coding-plan 文档）。

### 2.8 为什么重要

对 Agent 开发者：ZCode 的 turn loop 把「**agent 循环 = 显式状态机 + 分层并行工具调度 + 可声明副作用**」做成可测试的纯结构。`turn-state.ts` / `turn-machine.ts` / `scheduler.ts` 三个文件合计 853 行，**没有一个 `any`**，状态机非法转移直接抛错。这是"把 agent 循环当编译器前端写"的风格。

另一个值得学的点：**循环里注入的每一条 system reminder 都带根因注释**。例如 `turn-loop.ts:185-186` 解释 cache-control 为何必须在 projection 之后设置。这类注释让后来者（尤其是 AI）不敢随意挪动顺序。

---

## §3 子代理 / 后台 Agent（与 dsh Agent Teams 的对比重点）

### 3.1 三种执行形态

模型可见工具名是 `Agent`（历史别名 `Task`），契约在 `apps/zcode-cli/packages/contracts/src/tools/agent.ts`：

```ts
export const AgentType = {
  GeneralPurpose: "general-purpose",
  Explore: "Explore",
} as const;
```

输入 schema（`agent.ts:16-30`，逐字）：

```ts
export const AgentInputSchema = z.object({
  description: z.string().describe("A short (3-5 word) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().optional().describe("The type of specialized agent to use for this task"),
  run_in_background: z.boolean().optional().describe(
    "Set to true to run this agent in the background. You will be notified when it completes."),
});
```

输出有两态（`agent.ts:52-76`）：`status: "completed"`（同步）或 `status: "async_launched"`（后台，带 `agentId` / `childSessionId` / `backgroundTaskId` / `outputFile` / `canReadOutputFile`）。

### 3.2 规格文档明确划界：**Teammate / swarm 不是 subagent**

`apps/zcode-cli/docs/design/v2/tool/07-subagent.md:8-20` 有一张**执行形态表**，逐字（节选）：

| 形态 | 触发条件 | 说明 |
| --- | --- | --- |
| fresh subagent | 指定 `subagent_type`，或未启用 fork 时省略 | 新建独立 agent 对话 |
| fork subagent | fork gate 开启且省略 `subagent_type` | 子 agent 继承父会话历史、system prompt 和精确 tool pool，用于 prompt cache 共享 |
| background subagent | `run_in_background`、agent 定义 `background: true`、coordinator、assistant mode、fork gate 或 proactive 强制 | 立即返回 task 引用，完成后以通知重新进入主会话 |
| worktree subagent | `isolation: "worktree"` | 在临时 git worktree 中运行 |
| remote agent | `isolation: "remote"` | **远程环境执行；ZCode 当前不支持** |
| teammate spawn | `team_name` 和 `name` 同时存在 | **这是 agent team/swarm，不是普通 subagent，应作为独立工具或独立模式处理** |

紧接着的关键边界（`07-subagent.md:18`，逐字）：

> 「关键边界：普通 subagent 不是 OS 子进程，而是在同一进程内创建新的子执行上下文，再运行新的 query loop。外部进程、tmux、in-process teammate 和 remote agent 属于 agent team 或 remote task 分支，不应和普通 subagent 混成一个概念。」

规范里**列出了** `team_name` / `mode` / `teammate_spawned` 这些字段与状态，但同一文档 `:436-437` 明确说明它们**不进 provider-visible 描述**：

> 「provider-visible description 和字段说明只覆盖 local-agent 子集；teammate mailbox、shutdown、plan approval 等 **ZCode 未支持的 team protocol** 不进入工具说明。」

并有机械测试守住这条线——`apps/zcode-cli/packages/core/tests/tool-contracts.test.ts:304`：

```ts
expect(contract?.description).not.toContain("teammate");
```

### 3.3 后台 subagent 的生命周期（含一次真实的架构纠错）

`docs/agent-background-subagent-join.md` 是一篇**废弃方案的历史说明**，开头逐字：

> 「本文档记录的是 2026-06 期间的旧临时方案：把 background subagent 重新收敛成"当前 main turn 内等待并 join"的行为。该方案已经废弃，不再作为实现目标。」

废弃原因（逐字）：

> 「当前目标不是让 main turn 等待 background subagent 完成后再结束，而是允许 main turn 先正常结束。」
> 「background local_agent 完成后，应通过 `<task-notification>` 自动唤醒 main agent 继续处理结果。」
> 「旧方案明确排除了 idle wake，和当前目标相反。」
> 「继续沿用旧方案会掩盖 fake running / fake notified 这类真实 lifecycle 问题。」

**这是本仓库对写文章最有价值的一段工程叙事之一**：一个「让父 turn 等待」的方案被推翻，改成「父 turn 正常结束 + 子完成后 idle wake」。`docs/cli-background-subagent-wake-plan.md` 给出了完整的问题诊断，含**真实失败会话 id**：

> 「参考失败形态：`sess_bc1e9c8a-80a0-4bda-a927-6fde7ec6dc4c` 的父 turn 已 finish，子 session 后续正常完成并写出 output，但父 session 没有新的 model request，也没有 `background_task` synthetic notice。这符合"completion 入队后无人 wake"的根因。」

该文档的**非目标清单**同样关键（逐字）：

> 「- teammate、swarm、workflow、worktree isolation、model-facing `TaskCreate` / `TaskList` / `TaskUpdate`。
> - 进程重启后恢复正在运行的 background subagent，或持久化未消费 notification outbox；本轮 queued command 仍是进程内运行态，不是 durable outbox。」

**→ 结论：ZCode 明确不做 model-facing 的任务板（`TaskCreate`/`TaskList`/`TaskUpdate`）。**

### 3.4 子代理之间能通信——但有明确边界

`apps/zcode-cli/docs/design/v2/tool/07-subagent.md:440-460`「SendMessage 当前范围」逐字列出能力与限制：

> 「- `to` 必须是当前 runtime `RuntimeTaskRegistry` 中仍可寻址的 `local_agent` task/agent id。**当前不支持名称 alias、跨 runtime 投递**，也不会在 task 已从 registry evict 后仅凭磁盘 artifact 重新发现目标。
> - running agent 有 active message sink 时直接投递到当前 turn，返回 `steered` 或 `queued`；没有 sink 或 sink 投递失败时进入该 task 的 pending message queue。
> - terminal agent 仍保留 profile 和 child session id 时，`SendMessage` 复用原 child session 并在后台恢复 […]
> - `status: "success"` 只表示消息已被 `queued`、`steered` 或通过 `resumed_background` 接受，**不表示目标 agent 已读取、接受任务或回复**。」

最后一条**极其诚实**，也是写文章的好料：工具返回 `success` 但语义只是"投递被接受"。

另有 `RespondToCoordinator`（子→父）与独立的小写 `send_message`（session mailbox，另一套语义）：「lowercase `send_message` 是独立的 session mailbox 工具，不复用 `SendMessage` 的 local-agent 路由、output 或 display 语义。」

### 3.5 与 dsh Agent Teams 的对比（诚实版）

| 维度 | dsh Agent Teams | ZCode |
| --- | --- | --- |
| 命名队友 | 有。`spawn_teammate`，名字**永久保留、绝不复用**，连创建失败的也占名 | ❌ 无。`name` 字段在 spec 中被归类为 teammate 分支，不进 provider-visible schema |
| 共享任务板 | 有。任务板 + owner/lease，**owner 永不自动释放** | ❌ 明确非目标：`TaskCreate`/`TaskList`/`TaskUpdate` 列在非目标清单 |
| 角色 | Lead + teammate，扁平不可变 roster，只有 Lead 能创建/打断 | 无角色概念，只有 `general-purpose` / `Explore` 两种 profile |
| 硬上限 | `maxMembers: 16`（**含创建失败的**）、任务板 256、每人待处理消息 64 | 无 team 上限（因无 team）；subagent 并发受 tool scheduler 的 `maxConcurrency: 10` 影响 |
| 成熟度 | 实验包、默认关闭、无稳定性承诺 | subagent 是**主线能力**；background subagent 有完整 plan + 回归测试 |
| 子代理续聊 | `send_message` 唤醒队友 | `SendMessage({ to })`，仅限本 runtime registry 内的 local_agent id |

**一句话**：ZCode 是「**单主 agent + 可后台 spawn 的子 agent + 双向 mailbox**」；dsh 是「**Lead/teammate 角色化 + 共享任务板 + 永久命名**」。ZCode 的 multi-agent 更保守、更工程化；dsh 的更接近"组织"。

**⚠️ 需要提醒读者的**：ZCode 的 spec 文档**描述了** teammate/swarm 的字段与状态（`team_name`、`teammate_spawned`、teammate mailbox、shutdown、plan approval），读者可能误以为已实现。实际证据（`:436-437` 的「ZCode 未支持的 team protocol」+ 测试断言 `not.toContain("teammate")`）表明：**文档在描述"如果未来做会是什么形状"，而当前 provider 可见面刻意不含 team**。

### 3.6 为什么重要

对普通用户：「你让 ZCode 干一件大事，它可以派几个小工去干别的，干完了自己回来报信——但你**不能**给这些临时工起名、拉群、开共享任务清单。」这就是 ZCode 与「真·多智能体协作」的分界线，而且这条线是**产品决策**，不是技术欠债（有文档、有测试、有非目标清单三重固定）。

---

## §4 会话与持久化

### 4.1 存储位置与格式：SQLite（Node 内置驱动）

```ts
export function getDefaultSessionDbPath(): string {
  return join(homedir(), ".zcode", "cli", "db", "db.sqlite");
}
```
—— `apps/zcode-cli/packages/adapters/src/storage/session-store/paths.ts:5-7`

驱动是 **Node 24 内置的 `node:sqlite`**（`import { DatabaseSync } from "node:sqlite"`，`sqlite-session-store.ts:2`；`session-target.ts:6` 同）。**没有 `better-sqlite3` / `bun:sqlite` 依赖**——这与 ZCode 追求"零生产依赖"的 CLI 定位一致（`apps/zcode-cli/README.md`：「Runtime code has zero production dependencies.」）。

### 4.2 表结构（`migrations.ts`）

核心表（`:14-115`，逐字摘录）：

```sql
create table if not exists session (
  ... project_id, workspace_id, parent_id, trace_id, task_type, slug,
      directory, path, title, title_source, ..., permission, time_created, time_updated,
      time_compacting, time_archived
);
create index if not exists session_project_idx on session(project_id);
create index if not exists session_workspace_idx on session(workspace_id);
create index if not exists session_parent_idx on session(parent_id);

create table if not exists message (
  id text primary key,
  session_id text not null references session(id) on delete cascade,
  time_created integer not null,
  time_updated integer not null,
  data text not null
);

create table if not exists part (
  id text primary key,
  message_id text not null references message(id) on delete cascade,
  session_id text not null,
  time_created integer not null, time_updated integer not null,
  data text not null
);

create table if not exists session_entry (
  id text primary key,
  session_id text not null references session(id) on delete cascade,
  type text not null,
  time_created integer not null, time_updated integer not null,
  data text not null
);
create index if not exists session_entry_session_type_idx on session_entry(session_id, type);
```

其余表：`todo`、`permission`、`input_history`、`local_setting`、`session_target`、`workflow_definition` / `workflow_run` / `workflow_activity` / `workflow_event`、`session_task_link`、`model_usage` / `turn_usage` / `tool_usage`、`session_input`。

**这是 dsh「append-only 事件日志」的对照面**：ZCode 是**关系型、可变（upsert）**的存储。

### 4.3 有 `sequence` 列，但**不是 append-only**

`message` / `part` 表在后续 migration 中加了 `sequence` 列。`repositories/messages.ts:35-36` 的注释说明了归并规则：

> 「on-conflict 的 sequence 规则：同 scope 再保存必须原样保留现有 sequence——包括 NULL。coalesce(existing, excluded)」

写入语句（`:69-90`）使用 `insert ... on conflict ... do update`，并以子查询分配序号：

```sql
insert into message (id, session_id, time_created, time_updated, data, sequence)
...
select coalesce(max(sequence), -1) + 1
```

**结论**：ZCode 的会话存储是**带单调序号的 upsert 存储**，不是「只追加、永不修改」的事件日志。同一条 `message` 的 `data` 可以被后续写入更新（`:87-90` 的 `sequence = case when ... then message.sequence else excluded.sequence end`）。读取按 `order by sequence is null, sequence, time_created, rowid`（`:230`）。

**⚠️ 与 dsh 的差异要点**：dsh 的 append-only 日志使「已提交的代际永不重命名/替换/删除」，因此 replay/fork/rebuild 完全可推导；ZCode 的 upsert 模型让状态可变（更贴近产品实时性），代价是**不存在"日志即真相"的单点推导**——真相由 `ProductProjection` reducer 与 DB 行共同承担。

### 4.4 Fork / Resume 存在

- **Fork**：`apps/zcode-cli/packages/core/src/runtime/methods/session-fork.ts`，含 `cloneMessageForFork` / `clonePartForFork`、`formatConversationForkNoticeBody`，并有多种 fork 变体类型：`StableConversationForkOptions`、`ConversationBeforeInputForkOptions`、`SelectionSideChatCreateOptions`、`WorkspaceForkResult`。还有 `stable-fork-boundary.ts` 与 `workspace-fork.ts`。
- **Rewind**：`runtime/helpers/rewind.ts` + `runtime/methods/rewind.ts` + `rewind-message.ts` + `file-rewind.ts`（**文件也能回退**）。
- **Resume**：`runtime/methods/resume.ts`；`session-fork.ts` 中还有 `ForkCommitBundle`、`ForkChildSessionMetadata`。
- **Checkpoint**：`runtime/methods/workspace-checkpoint-persistence.ts` + `workspace-checkpoints.ts`。

`apps/zcode-cli/AGENTS.md` 把这一点写成规范：

> 「Coding agent CLI 应把 session、message、tool call、permission、checkpoint、队列和 pending 状态视为一等状态对象，支持**恢复、分叉、回滚和并发 session**。」

### 4.5 session / storage 的缝

`architecture-policy.yaml` 把两者声明为**不同 owner 的两个模块**：

- `session`：`packages/services/src/session`，owner `conversation`，`requires: [shared]`，public entrypoint 声明为 `contract.ts`（**但该文件不存在，见 §1.5**）。
- `storage`：`packages/services/src/storage`，owner `desktop-settings`，`requires: [shared, rpc, services]`，**启用了分层检查**：

```yaml
    layers: { domain: domain, app: app, adapters: adapters }
    layerOrder: [domain, app, adapters]
```

实际目录完全对上：

- `storage/domain/`：`cleanPlan.ts`、`storageCatalog.ts`、`usageAggregate.ts`（纯领域）
- `storage/app/`：`ports.ts`、`scanJob.ts`、`storageService.ts`（应用编排）
- `storage/adapters/`：`fsCleaner.ts`、`fsWalker.ts`、`inProcessScanRunner.ts`、`rootsResolver.ts`、`volumeProbe.ts`（IO 适配）
- `storage/contract.ts`（35 行）+ `storage/CONTRACT.md` + `contract.example.ts` + `contract.test.ts`

**语义区别很重要**：`storage` 模块在 ZCode 里**不是会话存储**，而是**磁盘占用扫描/清理**（domain 里的 `cleanPlan`、`storageCatalog`、`usageAggregate` 就是证据），对应 `docs/settings-storage-management.md`。**真正的会话持久化实现在 `apps/zcode-cli/packages/adapters/src/storage/session-store/`**，不在 `packages/services`。

这是一个值得写进文章的观察：**`architecture-policy.yaml` 的模块清单与实际的会话存储实现位置不一致**——policy 里的 `session` 模块只覆盖 `packages/services/src/session`（自动化、任务索引、mailbox 等 Host 侧服务），而 Agent 侧真正的 session store（SQLite、migrations、repositories）住在 `apps/zcode-cli/packages/adapters`，且在 policy 中**没有对应的模块声明**（policy 里 `zcode-cli` 模块的 roots 是 `apps/zcode-cli`，`managed: false`，即整个 CLI 目录是治理豁免区）。

### 4.6 为什么重要

对普通用户：会话能**分叉**（从某条消息开新对话）、**回退**（连文件一起回退）、**恢复**（重启后继续）。数据在 `~/.zcode/cli/db/db.sqlite` 一个文件里。

对 Agent 开发者：ZCode 用**关系型 + upsert + 单调序号**解决会话持久化，用 `node:sqlite` 零依赖落地。它同时拥有 fork/rewind/checkpoint 三种"时光机"，这在同类产品里并不常见——尤其 **`file-rewind.ts` 意味着代码文件本身也能随会话回退**。

---

## §5 工具与安全

### 5.1 工具注册表

`apps/zcode-cli/packages/core/src/tool/registry.ts`（`ToolRegistryImpl`）提供 `register` / `unregister` / `get` / `has` / `list` / `getMetadata` / `toContracts`。

有两条**防遮蔽规则**，都带根因注释（`:41-52`）：

> 「查找时 alias 若优先于 canonical，后注册的真实同名工具会继续被旧 alias 遮蔽。**canonical 始终优先**，并留下告警，避免兼容别名改变工具身份。」

注册同名工具会打 warning 并覆盖（`:60-62`）。工具带 `aliases` 数组（`:69`）——这是为 Claude Code 插件生态兼容准备的（`Task` ← `Agent`）。

### 5.2 工具处理器规模

`apps/zcode-cli/packages/core/src/tool/handlers/` 下有 **130+ 个文件**。核心工具有：`read.ts` / `read-text.ts` / `read-image.ts` / `read-pdf.ts` / `read-video.ts`、`write.ts`、`edit.ts`、`glob.ts`、`grep.ts`、`bash.ts`、`webfetch.ts`、`websearch.ts`、`apply-patch.ts`、`todo.ts`、`task-output.ts` / `task-stop.ts`、`send-message.ts` / `respond-to-coordinator.ts`、`ask-user-question.ts`、`skill.ts`、`plan-mode.ts`、`cron.ts`、`node-repl.ts`、`escalate.ts`、`submit-result.ts`。

**Bash 的安全逻辑被拆成 20+ 个文件**，这是本仓库最壮观的模块化之一：

```
bash-command-parser.ts            bash-command-permission-policy.ts
bash-command-rule-evaluator.ts    bash-cwd-policy.ts
bash-git-runtime-safety.ts        bash-readonly-policy.ts
bash-readonly-policy-argv.ts      bash-readonly-policy-argv-direct.ts
bash-readonly-policy-argv-flags.ts bash-readonly-policy-argv-git.ts
bash-readonly-policy-argv-io.ts   bash-readonly-policy-callbacks.ts
bash-readonly-policy-commands.ts  bash-readonly-policy-flags.ts
bash-readonly-policy-flags-file.ts bash-readonly-policy-flags-git.ts
bash-readonly-policy-flags-process.ts bash-readonly-policy-flags-text.ts
bash-readonly-policy-git-subcommands-core.ts bash-readonly-policy-git-subcommands-history.ts
bash-readonly-policy-multiword-core.ts bash-readonly-policy-multiword-gh.ts
```

即：**有独立的 argv 解析器来判断某条 bash 命令是否只读**，按命令族（git / gh / 进程 / 文件 / 文本）分别建表，`multiword` 处理多词命令。这远超"用正则判断 rm -rf"的常见做法。

### 5.3 权限模式：6 种

```ts
export type CollaborationMode = "plan" | "build" | "edit" | "yolo" | "guarded" | "auto";
```
—— `apps/zcode-cli/packages/contracts/src/interfaces/session.port.ts:32`

**权限继承有一条显式收紧规则**（同文件 `:34-40`，逐字）：

```ts
/** 父 guarded 只收紧内部 YOLO 派生；显式的其它子模式保留各自策略。 */
export function inheritPermissionMode<T extends CollaborationMode | undefined>(
  parent: CollaborationMode | undefined,
  resolved: T,
): T | "guarded" {
  return parent === "guarded" && resolved === "yolo" ? "guarded" : resolved;
}
```

即：**父会话是 guarded 时，子代理不能自己升格成 yolo**。这是"权限不能被委派绕过"的代码级表达。

风险等级（同文件 `:42`）：`export type RiskLevel = "low" | "medium" | "high" | "critical";`

### 5.4 「放宽执行策略」是什么

`docs/agent-tool-relaxed-execution-policy.md` 记录的是**放宽两条本地策略**，根因来自 2026-06-29 的日志排查（逐字）：

> 「连续 subagent 失败的第一层原因不是同类型 `Agent` tool call 被拒绝，而是：
> - `TodoWriteInputSchema` 在 schema 层拒绝多个 `in_progress` todo，导致 `TodoWrite` 失败；
> - `executeToolSchedule` 看到前序非 `concurrentSafe` 工具失败后，对后续调度组生成 skipped 结果并停止执行。
>
> 这两个策略都会把模型一次性产出的后续工具调用提前截断。」

放宽后行为（逐字）：

> 「- `TodoWrite` 不再在 runtime schema 层硬拒绝多个 `in_progress` todo。`summary.inProgress` 继续按真实数量统计。
> - 工具调度按既有 `parallelGroups` 顺序执行。**某一组出现普通失败后，不再自动跳过后续组**；后续工具是否能运行仍由各自权限、取消信号、handler 错误和调度分组决定。
> - `turnControl.stopTurnAfterResult` 是显式 turn 边界。某个工具结果请求停止当前 turn 时，后续调度组不再执行真实 handler，并会生成取消结果来闭合 provider-visible tool call history。」

**"关掉 fail-fast"是这份文档的核心**：一个工具失败不再让整批后续工具作废。

非目标（逐字）：「不删除旧策略代码。旧校验和跳过分支保留为注释，方便后续对比或回滚。」

### 5.5 Guarded 模式 = 危险命令单次批准（本仓库最厚的一份设计文档）

`docs/dangerous-command-approval-v1-plan.md` 是 **Guarded 权限模式 V1** 的规格。要点：

- **界面文案**（逐字）：「`guarded` 的界面名称为"自主模式 / Autonomous mode"，下方单行描述为"在有风险时询问 / Ask when there's risk"。」并且：「内部 mode 值、CLI 命令、权限语义、默认值和保存恢复不变」——**改名不改语义**。
- **定位**（逐字）：「guarded=**YOLO 基础策略 + 明确危险命令用户单次批准**；原 yolo/build/edit/plan 保持原行为，**auto 仍未实现**。不修改默认值，不迁移已有任务/自动化/配置，不新增保护 boolean 或数据库迁移。**不是完整 Auto Mode classifier，也不承诺未知语法安全。**」
- **识别范围**（2026-09-24 补充，逐字）：「仅扩展识别层，不重构审批核心：rm 递归或明确批量、CMD rd/rmdir /s、CMD del/erase、find -delete、Git clean 有效 force、Windows Robocopy /MIR 或 /PURGE。」
- **明确排除**（逐字）：「仍排除 PowerShell、brace/变量/命令替换展开、脚本、隐式配置、rimraf/shred/truncate、远端删除、Git 局部回退；wrapper 仍仅 env/time/sudo，xargs/find-exec/npx 不扩展。**未命中/unsupported 沿原策略，不表示安全。**」
- **授权粒度**：「危险请求的 `user-once` 约束优先，**不提供也不接受项目/会话永久授权或 Full access**，不被 `prepareApproval.proceed` 放行。」
- **子任务继承**：「普通子任务继续透传同一个 broker 登记信号和最内层 origin。」
- **链路**（逐字）：「链路不变：matcher → Bash ToolEntry.userApprovalRule → PermissionService → executor/broker → 单次批准/拒绝 → 原 tool result。」
- **工程诚实度极高的证据段**：文档给出具体测试数量与失败报告 id，例如「Desktop pending 5/5、正式 Guarded 16/16 通过，报告 `desktop-e2e-20260924091043202-p16067-b339773b57c600dd`」，并主动披露「该次联跑的 Hook 用例因 pending 自动开启人工审核录屏，在收尾报 `spawn ffmpeg ENOENT`，**不能记为整轮通过**」。
- **明确的不通过声明**（逐字）：「全量门禁未通过，不宣称 production ready，不自动提交/推送；新增 E2E 待人工审核，Linux 原生执行及 Windows Desktop/手机 UI 未运行。」

### 5.6 有没有沙箱？——**没有操作系统级沙箱**

我在整个检出中 grep `seatbelt|bubblewrap|bwrap|sandbox-exec`，**零命中**。

唯一的 `sandbox` 语义有两处，都不是 OS 隔离：

1. **`dangerouslyDisableSandbox`** 是 Bash 工具的一个 schema 字段（`apps/zcode-cli/docs/design/v2/tool/04-bash.md:30`：「`timeout`、`run_in_background` 和 `dangerouslyDisableSandbox` 在 provider-facing JSON Schema …」）。
2. **插件 UI 沙箱**（`PluginSandboxHandle` / `prepareSandbox` / `buildPluginSandboxScopeId`，见 `packages/services/src/plugin-ui-bridge/contract.ts:21-111`）——这是 **Web 内容隔离**（MCP Apps / iframe CSP），不是进程隔离。

而 `docs/automation-edit-status.md` 里有一段**极其重要的坦白**（逐字）：

> 「本版本完整撤销 automation 内部库在通用 Bash 执行链上的专用保护：**既不增加 OS sandbox、capability probe、`bwrap` / Seatbelt 包装或受保护资源协议字段**，也不根据命令字符串识别和拒绝数据库访问。shell 的变量、cwd、脚本、符号链接和跨平台展开语义无法由关键词或正则可靠还原，保留启发式检查只会**制造已经建立安全边界的错误认知**。」

以及：

> 「`AutomationService` 是受支持的任务定义修改 API，但这**不等于 Bash 对数据库文件具备权限隔离**；本版本不承诺阻止 Bash 访问 `tasks-index.sqlite`，也**不能把命令字符串检查描述成文件访问安全边界**。」

**→ 这是本文最重要的安全结论**：ZCode 的安全模型是「**权限门（审批）+ 命令解析（只读判定）**」，**不是沙箱**。而且团队明确拒绝"用启发式假装有边界"。

### 5.7 审批 E2E 与人工审核

`docs/` 下有大量审批相关取证：E2E case 是**先红后绿**、覆盖**迟到批准无效**、**handler 调用 0/1 次**、**项目规则零写入**，并通过**真实内存 broker 的 pending/resolve** 验证。跨平台验证上，作者在 macOS 上跑 12 项 Bash oracle，再**通过 SSH 在 Windows 测试机上执行 CMD/Git Bash 验证 24 项**（并诚实标注「不冒充 Windows Desktop E2E」）。

### 5.8 前台 Bash 超时会转后台（而非 kill）

`docs/bash-background-parity.md`（逐字）：「当 foreground Bash 到达 timeout 且命令可 background 时，**运行中的子进程不会被 kill，而是被移交为 background task**。」

默认预算（逐字）：「foreground Bash 默认等待预算为 `120000ms`，默认最大值为 `600000ms`。bootstrap 支持 `BASH_DEFAULT_TIMEOUT_MS` / `BASH_MAX_TIMEOUT_MS`」。

有 `sleep` 特例（逐字）：「首个原始 token 为 `sleep` 的命令不进入 timeout auto-background」——这是防"模型用 sleep 逃避超时"的小心思。

输出文件跨平台 flags（逐字）：「macOS/Linux 使用 `O_WRONLY | O_CREAT | O_APPEND | (O_NOFOLLOW ?? 0)`，不包含 `O_TRUNC`…；Windows 使用 `"w"`」——**POSIX 用 append + no-follow 防符号链接攻击**。

### 5.9 为什么重要

对普通用户：ZCode 会**问你**才删东西（Guarded 模式），而不是把你关进沙箱。危险命令识别是尽量做准的，但**产品自己说"未命中不等于安全"**。这是一个诚实但需要用户理解边界的模型。

对 Agent 开发者：三件事值得抄——(1) **副作用范围显式声明**（`readOnly`/`destructive`/`concurrentSafe`/`sideEffectScope`），权限与调度都读它；(2) **权限继承的收紧方向单向**（guarded 父不给 yolo 子升格）；(3) **拒绝用启发式伪装安全边界**，宁可写下"我不承诺"。

---

## §6 插件 / 扩展 / 市场

### 6.1 领域词汇表：`CONTEXT.md` 是唯一裁决来源

`CONTEXT.md` 自称：「插件设置页及其市场浏览/安装体验的领域词汇表。2026-07 商店化重设计引入了一批容易混淆的术语，本文件是唯一裁决来源。」

它给每个术语配 `_Avoid_`（禁用别名），这在工程文档里很少见。核心名词（逐字）：

- **Official Marketplace（官方市场）**：市场 id 为 `zcode-plugins-official`，内容 = 内置插件 + CDN 插件。「是"**分发渠道**"而非"作者归属"——其中可以收录社区作者的插件。」`_Avoid_: 把 claude-plugins-official 称作"官方市场"`
- **Builtin Plugin（内置插件）**：随应用包一起分发、启动时播种进官方市场的插件。
- **CDN Plugin（CDN 插件）**：通过官方 CDN 以 **sha256 校验的 zip** 分发、按需下载安装。
- **Personal Source（个人来源）**：「用户自行添加的一切插件来源：claude-plugins-official、git/GitHub/URL/本地目录市场、inline 插件。」`_Avoid_: 第三方市场（claude-plugins-official 也归此类，"第三方"名不副实）`
- **Store Listing（商店信息）**：「目录条目携带的展示性元数据：显示名、icon、分类、开发者、网站/隐私政策/服务条款链接、hero 图、示例提示词。**描述"如何在商店里呈现"，不影响插件功能**。」
- **Plugin Manifest（插件清单）**：「插件包内 `plugin.json` 的功能性定义（commands/agents/skills/hooks/mcpServers/userConfig…）。**描述"插件是什么、做什么"**。」
- **Featured（精选）**：公开分段顶部策展区，「名单由官方 CDN 目录的 `featured` 字段**远程控制**」。
- **Recommended（推荐）**：个人分段顶部策展区，「名单由仓内 `recommendedPlugins.json` 维护」。
- **Restorable Builtin（可恢复内置插件）**：被卸载并进入持久化抑制状态的内置插件，「应用重启不得自动重新播种」。
- **Orphaned Installed Plugin（孤立已安装插件）**：来源已删但安装与数据保留。

### 6.2 三条 ADR：市场目录、风格偏离、来源删除

**ADR 0001 — Store Listing 元数据放在市场目录层，展示时目录优先、manifest 回退。**

决策依据（逐字）：「官方 CDN **只改目录 JSON 就能调整商店呈现（含 featured 名单），无需重新打包发布 zip**」。

被否决的选项（逐字）：

> 「- **manifest 内嵌**（listing 写进 plugin.json）：改一个作者名/换一张图都要重发 zip + 改 sha256，运营成本不可接受；个人来源插件依然不会有 icon，问题没解决。
> - **独立 listing 服务/接口**：多一个网络依赖与失败模式，目录 JSON 本来就是逐条描述插件的地方，没必要。」

代价被如实记录（逐字）：

> 「同一信息可能在两处存在且不一致（目录说作者是 A，manifest 说是 B）——按本决定，**UI 永远信目录**。」

**ADR 0002 —「插件商店页面有意偏离 DESIGN.md 的克制风格」**（全文极短，逐字）：

> 「仓库设计系统（DESIGN.md）要求避免"marketing-style spacing、playful gradients、bright full-surface brand fills"。2026-07 插件商店重设计是明确的产品决策：采用展示型商店的视觉与交互（display 级大标题、宽松留白、hero 渐变横幅、示例提示词胶囊）。该偏离**仅限插件商店相关界面**（列表页、详情页、管理已安装视图），**不构成对其他设置页或全局 UI 的先例**；商店页仍必须使用现有语义 token 实现深浅主题与中英文适配。**未来若设计系统与商店风格冲突，以本决定为准，不要"顺手修正"商店页的留白与渐变。**」

**这篇 ADR 的价值在于反熵**：它防的是"未来的贡献者（或 AI）看到商店页不符合规范，顺手把它改回去"。这是**为 AI 协作时代写的 ADR**——显式授权一处刻意的例外。

**ADR 0003 — 删除 Marketplace Source 时保留已安装插件。**

问题（逐字）：「Personal Source 同时承担"可发现目录"和"未来更新来源"，但已安装插件已经复制到用户级插件存储，并可能拥有配置、启停状态和数据。**删除来源若隐式级联卸载，会把一个看似只管理目录的操作变成破坏性数据删除**；若完全隐藏插件，又会让磁盘中的有效安装失去管理入口。」

决策结果：来源删除只删 marketplace 记录和目录投影，安装进入 `Orphaned Installed Plugin` 状态——**仍可使用、配置、启停、卸载；但不能更新**；重新添加同一来源后自动恢复关联。

约束（逐字）：「**安装状态和来源状态必须独立建模，UI 不能以"目录中不存在"推导"未安装"。**」

### 6.3 Marketplace 的默认配置（可数）

`packages/shared/src/plugin-marketplaces.ts`：

```ts
export const ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "zcode-plugins-official";
```
（`:8`）

```ts
export const CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "claude-plugins-official";
```
（`:15`）

官方市场源（`:41-49`，逐字）：

```ts
export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [
  {
    // ZCode 官方唯一市场：本地 seed 分片与 CDN 分片在 Agent storage 内合并。
    // CDN manifest 的 name 必须与该 canonical id 一致。
    id: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
    ...
```

**默认启用集合共 11 项**（`DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS`，`:17-39`，逐字）：`browser-use`、`image-search`、`documents`、`pdf`、`presentations`、`spreadsheets`、`node-repl-host`、`skill-creator`、`plugin-creator`、`zcode-guide`、`visualize`。

且带两条重要的设计注释（逐字）：

> 「node_repl 宿主：不进市场、不对用户露出，也不贡献任何 skill/command/subagent，但必须始终可用 —— node_repl 的注册门禁是「Browser Use 或 Computer Use 任一启用」，宿主自己不参与那个判断。Browser Use 默认开着，宿主若默认关就等于它上来就没有宿主。」
> 「电脑控制回退为默认关闭，故 computer-use 不在此名单内。该集合必须与 official-plugin-definitions.ts 里标了 defaultEnabled 的插件逐一对应，**bootstrap 的「Settings 默认启用集合与 CLI 的官方插件声明一致」单测机械对照两者**。」

**后者是很有价值的工程模式**：两处列表容易漂移，用**单测机械对拍**。而且注释本身就记录了历史上真实发生过的一次漂移（visualize 曾漏加）。

**内置官方插件定义有 9 个 `name:` 条目**（`apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts`，`grep -c`）：`visualize`、`android-emulator`、`image-search`、`ios-simulator`、`restore-legacy-sessions`、`plugin-creator`、`skill-creator`、`zcode-guide`、`computer-use`。

### 6.4 插件存储布局

`apps/zcode-cli/README.md` 的「Plugin Development」段逐字：

> 「Plugin state lives under `~/.zcode/cli/plugins`:
> - `cache/`: installed marketplace plugin code and static files.
> - `data/<plugin-id>/`: persistent plugin data. MCP servers should write runtime output here, not into the plugin source directory.
> - `marketplaces/zcode-plugins-official/`: bundled and CDN partitions plus the merged metadata for the single official marketplace.」

以及：

> 「zcode plugins are local bundles that can contribute **skills, custom commands, and MCP servers**. The plugin surface is **compatible with the Claude Code plugin layout**, so existing plugin content can be reused with minimal changes.」

安装态单独存 `installed_plugins.json`（`packages/services/src/plugins/installedPluginRoots.ts:10`），启用态存在 `plugins.enabledPlugins`（见下节）。

### 6.5 Claude Code 插件兼容：分阶段（V1a → V2）

`docs/claude-code-marketplace-plugin-compat.md` 给出四阶段计划。第一条原则（逐字）：

> 「ZCode 需要最大努力兼容 Claude Code Marketplace 插件，**但不能把 Claude 的高权限运行时语义直接带入当前 ZCode runtime**。第一阶段先实现 marketplace 生命周期、安装态、启用态、兼容诊断和低风险资源投影；**缺少安全模型或运行基础的能力必须可识别、可展示、可诊断，但不能静默运行。**」

分阶段（逐字摘要）：

- **V1a 安装闭环**：marketplace `add/list/update/remove`；plugin `install/uninstall/update`；默认注册 `claude-plugins-official` 指向 `anthropics/claude-plugins-official`；**「默认市场只提供 catalog 来源，不自动安装、不自动启用任何 Claude 插件」**；新增 `installed_plugins.json`；兼容读取 `.claude-plugin/marketplace.json`（根目录 `marketplace.json` 作为 fallback）；输出 compatibility diagnostics，「disabled 插件也必须能在管理页展示这些诊断，不能只在 enabled 后才发现」。
- **V1b 低风险运行投影**：运行 `skills`、commands root、`mcpServers`、non-sensitive `userConfig` defaults。「`zcode-plugins-official` 和 `claude-plugins-official` 安装产物可注入 hooks；**其他第三方 marketplace 插件的 `hooks` V1 默认只解析和诊断，不注入 runtime**，后续必须有显式信任/权限门后才能启用。」MCP server key 加插件命名空间。**「sensitive `userConfig` 只能进入 MCP env / credential / runtime secret path，不能进入模型可见 command、skill 或 markdown 内容。」**
- **V1c**：dependency resolver（closure / 缺失依赖 / cycle）；「默认阻止跨 marketplace dependency，只有显式 allowlist 才放行」。
- **V2**：「Plugin agents 完整运行。LSP、outputStyles、channels、MCPB/DXT、enterprise policy、seed marketplace、GCS mirror、auto-update daemon。」

有一处概念澄清（逐字）：「`marketplace` 和 `source` 是两条不同的轴，不能混用：`marketplace` 表示插件身份所属的市场…`source` 表示当前本地加载位置/来源，例如 `official`、`inline`、`cache`。」

### 6.6 「三件套」兼容验证

`docs/claude-marketplace-triplet-plugin-compat.md` 的"三件套"= 同时含 **skills + commands + MCP servers** 的插件。样本取自本机 Claude CLI 缓存，**固定 10 个**（逐字表格）：`appwrite`(11 skills/2 cmds)、`aws-agents-for-devsecops`(13/9)、`bigdata-com`(1/27)、`cloudflare`(11/2)、`confidence`(11/5)、`convex`(2/1)、`dominodatalab`(23/4)、`fiftyone`(16/2)、`legalzoom`(1/1)、`logfire`(3/4)。

验证要求（逐字）：「MCP server key 被**命名空间化**为 `plugin:<plugin-name>:<server-name>`」——这是防多个插件声明同名 server 互相覆盖的措施。

### 6.7 MCP 是插件的一种资源

`packages/shared/src/mcp.ts`、`packages/shared/src/mcp-sync.ts`、`packages/shared/src/mcp-apps/`、`packages/services/src/mcp-sync/`、`packages/services/src/official-mcp/`、`packages/services/src/plugin-ui-bridge/`。

`architecture-policy.yaml` 把 MCP 相关能力声明为**4 个独立 managed 模块**：`mcp-apps-protocol`（`packages/shared/src/mcp-apps`）、`mcp-ui`、`plugin-ui-bridge`（`packages/services/src/plugin-ui-bridge`）、`plugin-sandbox`（`packages/desktop/src/{main,host,preload,renderer}/pluginSandbox`）。这些模块的 `owner` 统一是 `plugin`。

**插件 UI 有沙箱**——`packages/services/src/plugin-ui-bridge/contract.ts:102-111`（逐字）：

> 「`prepareSandbox` 以 (ownerWebContentsId, workspaceKey, sessionId, pluginId, scopeId) **幂等**：重复调用返回同一 `sandboxId` 与递增 `initId`；同键并发调用只合并资源读取、登记各自进行（H15-a，每个调用方拿自己的 initId）」

沙箱作用域 id 的构造规则（`:22`）：「工具卡片 `tool:<toolCallId>`，面板 `surface:<surfaceId>`」。

**注意区分**：这是**渲染层沙箱**（Electron webContents + CSP），不是 §5.6 说的进程沙箱。二者不可混为一谈。

### 6.8 与 dsh「everything-is-a-plugin」的对比

| 维度 | dsh | ZCode |
| --- | --- | --- |
| 插件本体 | Cordis 微内核，**agent 循环自身也是插件**，可替换 | `zcode-cli` 内核是**固定的产品核心**；插件贡献 skills / commands / MCP servers / agents / hooks / userConfig |
| 组合方式 | 运行时服务图 + Service Definition 三角色（Definition/Provider/Consumer） | 静态 `plugin.json` manifest + 市场目录 JSON |
| 分发 | bundle（Cordis config 行 + 代码） | 官方 CDN zip（sha256 校验）+ git/GitHub/URL/本地目录/inline |
| 市场 | 无内建市场 | **有**：官方市场（CDN 驱动 featured）+ 个人来源分段 UI |
| 生态兼容 | 自有体系 | **主动兼容 Claude Code 插件布局与 marketplace**，分 V1a→V2 四阶段 |
| 治理 | 运行时（服务注册表就是真相） | 编译前（`architecture-policy.yaml` + `architecture:check`） |

**这是 ZCode 相比 dsh 最显著的差异化**：它有**一个真的商店**——featured 由 CDN 远程控制、listing 与 manifest 分离、来源删除不破坏安装、孤立插件有独立状态。dsh 的哲学是"一切皆可组合"，ZCode 的哲学是"**一切皆可分发**"。

### 6.9 为什么重要

对普通用户：ZCode 有一个**你能逛的插件商店**（精选区 + 分类 + 示例提示词胶囊，点一下开新会话预填），而且**能装 Claude Code 的插件**——这是实打实的生态红利。删掉一个市场来源**不会**顺手删掉你已经装的插件和配置。

对 Agent 开发者：三条可迁移的经验——(1) **listing 与 manifest 分离**，让运营不必重打包；(2) **安装态与来源态独立建模**，防止"管理目录"变成"数据删除"；(3) **用单测对拍两处易漂移的列表**（默认启用集合 ↔ 插件声明）。

---

## §7 Bots / 渠道

### 7.1 是什么

一句话定义，逐字（`docs/bots.md:3`）：

> 「**Bots lets a private third-party chat drive the same ZCode task flow as the UI input box.** The v2 model removes the old nested allowed-users shape: each `bot` is a complete access instance with provider, credentials, one bound actor, workspace scope, command policy, current options, and reply mode.」

即：**在第三方聊天里驱动同一套 ZCode 任务流**。每个 `bot` 是一个"完整访问实例"，绑定**恰好一个 actor**。

### 7.2 支持的平台

从 `docs/bots.md` 与代码可确认：**Feishu（飞书）/ Lark** 是一等公民（且是唯一支持流式卡片的）、**Telegram**、**Weixin（微信）**、**Webhook**，**DingTalk 仅为 coming-soon**。

逐字证据：

> 「Feishu / Lark only support `streaming_card`; old Feishu / Lark configs with another value are normalized back to `streaming_card`. Every other provider only supports the three non-card granularities; `streaming_card` is excluded from Settings and `/reply`, and copied or legacy values are normalized to `assistant_changes`.」

> 「Feishu and Lark are both first-class new bot entries. They share the same provider implementation and registration flow, but **the selected provider id must be preserved because it chooses the OpenAPI domain (`open.feishu.cn` for Feishu, `open.larksuite.com` for Lark)**. **DingTalk is shown there only as a coming-soon channel.**」

区域标签也如实区分（逐字）：「Feishu uses BigModel's `中国` / `CN` tag, and Lark uses Z.AI's `全球` / `Global` tag. These tags are display-only and do not affect provider routing.」

### 7.3 存储

两类文件（逐字）：

> 「- `bot-config.v3.json`: persistent bot configuration. The top-level shape is `{ "version": 3, "bots": [] }`.
> - `bot-state.v3.json`: current runtime state keyed by bot id. It stores active workspace, draft/task mode, active task, pending permissions, Telegram offset, and update time.
> - `bot-config.json` / `bot-state.v2.json` / `bot-state.json`: one-time upgrade inputs, retained unchanged for rollback.」

**凭证不进配置**（逐字）：「Secrets still live in `CredentialService`; config files only store refs such as `credentialRef` and `webhookSecretRef`.」

### 7.4 绑定与鉴权

逐字：

> 「`/bind <code>` binds a private actor to a specific bot id. **Rebinding overwrites that bot's `providerUserId` and `displayName`; it does not append another user.** Unbound bots only accept `/bind`; ordinary messages and other commands are ignored or rejected.」
> 「At runtime, authorization resolves **exactly one enabled bot** by: `provider + providerUserId`.」

**这是一个非常严格（甚至激进）的授权模型**：一个 bot 只服务一个人，重绑是覆盖不是新增。这解释了它为什么自称 "a **private** third-party chat"。

### 7.5 用户在聊天里能做什么

**允许的命令集**（逐字，`allowedCommands`）：「`status`, `new`, `workspace`, `model`, `mode`, `thoughtLevel`, `sandboxMode`, `approvalPolicy`, `reply`」。

文档详列了中英双语命令（逐字节选）：`/status`、`/new` / `/clear`、`/project` / `/workspace` / `/项目`、`/reconnect` / `/重连`、`/model`、`/mode` / `/模式`、`/think` / `/thoughtLevel` / `/思考`、`/cli`、`/reply` / `/回复`、`/stop` / `/停止`。

**普通消息的行为**（逐字）：

> 「- In draft mode, or when no active task exists, the message creates a new ZCode task and becomes the first prompt.
> - In task mode, the message is sent to the active task.」

即：**从聊天里直接开任务、继续任务、切模型/模式/思考档、看状态、停止生成**——等于把 ZCode 的输入框搬进 IM。

### 7.6 远端安全：不做隐式回退

一段很关键的安全设计（逐字）：

> 「Remote workspace execution is guarded by an injectable runtime connector. **A disconnected remote workspace never reconnects as a side effect of a plain message, task command, config command, or permission response.** Those commands return a stable "remote disconnected" reply and do not execute. **Only `/reconnect` / `/重连` asks the runtime connector to reconnect** the selected remote workspace. This prevents a remote bot message from silently falling back to a local workspace with the same path or unexpectedly opening a remote runtime.」

**这防的是"同路径本地 workspace 顶替远端 workspace"**——一个隐蔽但真实的安全风险。

### 7.7 流式卡片：可靠性工程（本仓库最漂亮的一段）

`docs/bots-feishu-streaming-card-reliability.md`。

其定位（逐字）：

> 「- State owner: **one inbound Bot turn owns its card handle, consecutive failure count, next allowed attempt time, and circuit-open state. The state is memory-only and is discarded with that turn.**
> - Protocol boundary: Bot task subscriptions remain `bot-channel-continuous`; this change does not alter desktop `desktop-continuous` or mobile `web-remote-replayable` recovery semantics.」

故障恢复契约（逐字代码块）：

```text
task stream event
      |
      v
card sync requested -- before nextAttemptAt --> suppress request
      |
      +-- circuit open ----------------------> suppress request
      |
      v
Feishu create/update
      | success
      +------------------> reset failure state
      |
      | failure
      v
failure 1 -- wait 1s --> failure 2 -- wait 2s --> failure 3
                                                    |
                                                    v
                                              open circuit
```

关键语义（逐字）：

> 「The circuit opens after **three consecutive failures in the same inbound turn**. It has **no timer-based half-open transition**: stale events arriving minutes later cannot restart writes for that turn. A new inbound user message creates a new turn-local state and may attempt delivery again.」
> 「The backoff is **event-driven**; no retry timer is created. A request is attempted only when another task event arrives after the current delay.」

**卡片元素预算**（逐字）：

> 「Feishu Card JSON 2.0 rejects cards that exceed **200 components or elements** with `230099/11310` and `element exceeds the limit`. The provider therefore owns a **conservative budget of 180 tagged elements** per streaming card, including nested elements and the running/completed status line. The budget is checked before every create or update request.」

超预算时的分段策略（逐字）：

> 「When the next timeline block would exceed that budget, the current card is **sealed with the largest fitting prefix and retained in the conversation**. Remaining blocks start a new card, which becomes the only card updated by later stream events.」

并诚实处理"本地预算仍被平台拒绝"（逐字）：「If Feishu still returns `230099/11310` despite the conservative local budget, normal backoff and circuit breaking apply」。

### 7.8 交互卡片与流式卡片的互斥（细节极多）

逐字：

> 「A Feishu / Lark task using streaming-card replies keeps ordinary Agent output independent from blocking interactions. **AskUserQuestion, permission, and Plan approval use one current interaction message. Before an interaction is shown, the current streaming card is sealed**: its accumulated content remains visible, its running status is removed, and later Agent output must create a new streaming card. **Question progress only replaces the current interaction message and never copies the question, answers, or plan back into either streaming card.**」

以及**单次卡片写入**的严格约束（逐字）：

> 「For a Feishu/Lark WebSocket card action, BotService first advances the authoritative interaction state and returns the complete outbound message to the transport. The action handler synchronously renders that exact message as `card.raw`… **That synchronous response is the only card write for the click: it does not also call `card_update_token`, PATCH the message, synthesize a card from `zcodeCardText`, send a replacement message, or recall the original.**」

**这是一条典型的"防双写"约束**，用五条否定式枚举来钉死。

### 7.9 群协作

`docs/bots.md` 逐字：

> 「Feishu/Lark ordinary groups and dedicated topic groups support explicitly enabled collaborative sessions. **Topics bind independent tasks; only @ mentions trigger work**, and `/history on` opts a group into incremental topic background.」

另有 `docs/bots-feishu-group-collaboration.md`（未在本次完整阅读，标注为「normative group authorization, input, queue, delivery and lifecycle contract」）、`docs/bots-private-task-sync.md`、`docs/bot-channel-runtime-split.md`、`docs/bots-workspace-read-state-transport-race.md`、`docs/bots-topic-input-materials.md`、`docs/bots-session-expired-callback.md`、`docs/bots-e2e-case-catalog.md`。

**⚠️ 未完整取证**：`bot-channel-runtime-split.md`、`bots-private-task-sync.md`、`bots-feishu-group-collaboration.md` 的具体内容本次未逐字读取，仅从文件名与 `bots.md` 的交叉引用确认存在与主题。写文章时如引用这三篇的细节，需要再读。

### 7.10 任务被删的自愈（产品细节）

逐字，很典型的一段状态机：

> 「Before an ordinary message reuses an active task, query the selected workspace's deleted-task tombstones through its task service (including `workspaceIdentity`). A confirmed deleted task returns the Bot to draft, clears pending permissions/questions/selections, and creates a fresh task for this same message. **A task missing from a filtered list, or only archived/pinned, is not evidence of deletion; read failures must not trigger creation.**」

并规定给用户一条中英文本地化通知（逐字）：

> 「"原任务已删除，已为你新建任务。本条消息将在新任务中处理，不会继承原任务的对话上下文。"」

且「process the original message **exactly once**」。

### 7.11 为什么重要

对普通用户：**你可以在飞书/Telegram/微信里指挥 ZCode**——开会时在群里 @ 它派活、手机上看到任务进度卡片实时刷新、危险操作直接在聊天里点批准。而且一个 bot 只绑你一个人，不会串号。

对 Agent 开发者：这里有三条可复用的工程模式——(1) **把外部平台当成"另一个 UI"，状态所有者仍是同一个 turn**；(2) **流式渲染要有熔断 + 元素预算 + 分段封存**，否则一次平台拒绝会变成请求风暴；(3) **远端连接绝不隐式回退**，宁可回一句"远端已断开"。

---

## §8 自动化 / 定时任务

### 8.1 是什么

`packages/shared/src/automation-types.ts:6-8`（逐字）：

```ts
// ---- 定时任务(Automation)领域类型 ----
// automation / automation_runs 存 tasks-index.sqlite。
// 这里是跨 services / cli / desktop / ui 复用的 camelCase 领域类型；sqlite 列名为 snake_case。
```

**存储位置**：`~/.zcode/v2/tasks-index.sqlite`（从 `docs/automation-edit-status.md` 的「Bash 直改 `~/.zcode/v2/tasks-index.sqlite` 属于不受支持的行为」可确认）。

生命周期（`automation-types.ts:21`）：

```ts
export type ZCodeAutomationLifecycleStatus = "active" | "completed" | "failed" | "paused";
```

派发态（`:24-28`）：

```ts
export type ZCodeAutomationDispatchStatus = "idle" | "claimed" | "dispatched" | "failed_to_dispatch";
```

触发来源（`:34`）：`export type ZCodeAutomationTrigger = "schedule" | "manual";`

### 8.2 上限：**20 条**

`packages/shared/src/automation-types.ts:10-11`（逐字）：

```ts
/** 单个本地任务索引允许保留的定时任务定义总数；所有生命周期状态都计入。 */
export const AUTOMATION_CREATE_LIMIT = 20;
export const AUTOMATION_CREATE_LIMIT_ERROR_CODE = "AUTOMATION_CREATE_LIMIT_REACHED";
```

`docs/automation-create-limit.md` 给出完整产品语义（逐字）：

> 「- 单个本地任务索引最多保留 `20` 条定时任务定义。
> - 统计范围与管理页 `listAllAutomations()` 一致，**覆盖所有项目；不是每个 workspace 各 20 条**。
> - `active`、`paused`、`completed`、`failed` 等**全部生命周期状态都占用名额**。
> - **闲时任务属于独立领域，不计入定时任务的 20 条上限。**
> - 更新、运行、暂停和恢复已有任务**不受限制**；只有删除定时任务定义才释放名额。
> - 手动表单、模板、会话 `CronCreate` 等**所有创建入口都遵守同一上限**。」

**并发一致性是这样保证的**（逐字）：

> 「UI 根据已加载的全量列表提前阻止创建并展示国际化提示；**该检查只用于交互反馈，不作为最终一致性边界**。服务层创建最终由 SQLite 写事务串行检查总数，避免桌面多窗口或会话工具并发创建时同时通过旧计数。」

```text
UI / CronCreate
      |
      v
AutomationService.create
      |
      v
BEGIN IMMEDIATE
      |
      +-- COUNT(all lifecycle states) >= 20 --> rollback + limit error
      |
      +-- COUNT < 20 --> INSERT --> commit
```

且（逐字）：「达到上限时**不得自动清理**已完成或失败任务，也**不得按 workspace、状态或是否启用过滤计数**。」

### 8.3 Agent 撞上限时的强制行为（很硬核）

逐字：

> 「`CronCreate` 命中全局上限后属于**不可由 Agent 自行恢复的产品限制**，不是普通可重试工具错误：
> - 本次创建不修改任何任务。
> - **当前模型轮次后续尚未执行的工具调用必须取消。**
> - 当前用户 turn **仅允许再进行一次无工具的模型回复**，用当前语言直接告知已达上限，并提示用户前往"自动化"手动删除任务后重试。
> - 该回复阶段**不得再暴露** `CronList`、`CronDelete`、`CronCreate`、Bash 或其他绕过入口。
> - **Agent 不得自行选择、删除或覆盖已有任务**；即使当前 workspace 的 `CronList` 少于 20 条，也不能据此推断其他 workspace 的全局名额或执行清理。」

**这是"产品限制不可被 Agent 绕过"的教科书式实现**：锁工具 + 只允许一次纯文本回复 + 明确禁止自作主张删任务。

### 8.4 调度语义：`scheduleRule` 是权威，cron 只是兼容 carrier

这是本功能最有技术含量的设计。问题根源（`docs/automation-session-hourly-interval.md`，逐字）：

> 「标准五段 cron 对各字段的步长有上限：分钟为 59、小时为 24、日为 31、月为 12。因此以下表达式无效：
> - 每 61 分钟：`*/61 * * * *`
> - 每 31 小时：`49 */31 * * *`
> - 每 32 天：`0 9 */32 * *`
> - 每 13 个月：`0 9 15 */13 *`
> 若把超过上限的间隔直接写入 cron，服务层会在 `isValidCronExpr` 校验时拒绝任务；若静默改为每分钟/每小时 cron 又会**错误地改变任务频率**。」

解决方案：新增成对字段（逐字）：

```ts
intervalUnit: "minute" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
interval: 1..200;
```

并明确（逐字）：

> 「**真实重复语义以持久化的 `scheduleRule` 为准；`cronExpr` 只保留为合法兼容表达式，不能因 cron 字段的步长上限改变真实频率。**」

映射表（`docs/automation-session-hourly-interval.md`，逐字节选）：

| 真实语义 | carrier | 合法兼容 cron 示例 |
| --- | --- | --- |
| 每 200 分钟 | `minute`, `200` | `* * * * *` |
| 每 31 小时的第 49 分 | `hourly`, `31` | `49 * * * *` |
| 每 40 天 09:00 | `daily`, `40` | `0 9 * * *` |
| 每 13 个月的 15 日 09:00 | `monthly`, `13` | `0 9 15 * *` |

`scheduleRule` 结构（`automation-types.ts:37-47`，逐字）：

```ts
export interface ZCodeAutomationScheduleRule {
  unit: "minute" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  hour: number;
  minute: number;
  anchorAt: number;
  weekdays?: number[];
  monthDays?: number[];
  /** yearly 用：1-12 人类月份。缺省回退 anchorAt 的月份（兼容未写该字段的旧记录）。 */
  months?: number[];
  monthlyMode?: "date" | "weekday";
}
```

**`anchorAt` 解决的是"每 N 分钟从哪开始算"**（`docs/automation-edit-status.md`，逐字）：

> 「用户表达"每 N 分钟"时，产品语义是从任务创建或最近一次修改计划的时刻开始计时，**不能按标准 cron 的墙钟分钟刻度提前触发**。」

```text
11:46 create "every 10 minutes"
  -> anchorAt = 11:46
  -> first run = 11:56
  -> next runs = 12:06, 12:16, ...

not:
11:46 create -> cron wall-clock tick 11:50
```

边界（逐字）：

> 「`interval` 必须是 **1–200 的整数**；`0`、负数、小数和大于 `200` 的值必须在 contract、协议和 service 边界拒绝。」
> 「月度规则最多允许间隔 **1200 个月**。非法规则必须整体拒绝，不能依赖计算函数静默取整、填默认值或返回 `null`，**否则会持久化一个永远没有 `nextRunAt` 的活动任务**。」

**旧 Host 的兼容边界也很严谨**（逐字）：

> 「旧 Host 的严格 schema 不识别新字段时，**不能降级成普通 cron 创建任务**，因为那会把真实的 31 小时、40 天等频率错误地写成每小时/每天。此类请求必须失败并明确提示 Host 不支持 interval carrier；未使用 carrier 的旧 CronCreate/CronUpdate 继续保持兼容。」

### 8.5 派发时先回写配置再发 prompt（时序很讲究）

逐字：

> 「定时任务触发时，任务当前保存的模型、Think 和模式**必须先回写绑定会话，再发送 prompt**。模型先通过 V4 `switchModelConfig` 原子更新 runtime 和 conversation projection，再在目标模型上显式收敛 Think，最后通过 `switchCollaborationMode` 收敛权限模式。**禁止先走 legacy `session/setModel`**，否则 runtime 已切换时补写可能返回 noop，导致会话工具栏仍显示旧模型。」

```text
automation dispatch
  -> V4 switchModelConfig(model + think + runtimeModel)
  -> V4 state.updated.config
  -> V4 switchModelConfig(target think)
  -> V4 switchCollaborationMode(permission mode)
  -> send prompt
```

### 8.6 防递归：Agent 不能自建定时任务

两层独立 guard（逐字）：

> 「三种写工具有两层独立 guard：provider 请求**先隐藏** `CronCreate` / `CronUpdate` / `CronDelete`；即使旧入口或异常 provider 绕过可见性过滤，tool executor 仍把本轮 automation 事实传给 handler，**三个 handler 都必须在调用 `AutomationPort` 前拒绝**。`CronList` 是只读查询，automation turn 仍可调用。」

归属判据（逐字）：「现行权限判据**只使用 Host admission 在本轮显式传入的 `automationId`**」；且「普通用户会话允许通过 `CronList` 获取当前 workspace 的任务 ID，再使用 `CronUpdate` 修改同一条定时任务定义」，因为「用户在同一绑定会话中主动发起的新一轮属于**普通用户轮**，必须重新暴露 `CronUpdate` / `CronDelete`」。

并对工具描述提出约束（逐字）：

> 「`CronCreate` 的工具描述和 prompt 字段描述必须要求模型直接填写每次触发时要完成的业务工作，**不得在 prompt 中要求再次创建、配置定时任务或调用 `CronCreate`**。该约束属于模型工具 contract，**不在 contracts 或 handler 中用关键词、正则表达式猜测自然语言意图**。」

### 8.7 为什么重要

对普通用户：定时任务 = 「**每天 9 点让 ZCode 跑这件事**」。但同类任务**全局最多 20 条**（不是每个项目 20 条），且**满了它不会自动清理**，会明确告诉你"去自动化页手动删"。支持"每 31 小时""每 40 天"这类 cron 本身表达不了的真实频率。

对 Agent 开发者：这里有两个高价值模式——(1) **「权威语义字段 + 兼容展示字段」双轨**（`scheduleRule` 权威，`cronExpr` 只做 carrier/展示），解决"标准格式表达力不够但生态又必须输出标准格式"这类矛盾；(2) **产品限制的 Agent 化处理**：撞上不可恢复的产品上限时，锁工具 + 限定一次文本回复 + 禁止 Agent 自行清理，而不是抛一个模型可以疯狂重试的普通错误。

---

## §9 Computer Use (CUA)

### 9.1 结论：**本版本不包含 Computer Use**

`packages/zcode-cua/README.md` 全文（极短，逐字）：

> 「# @zcode/zcode-cua
>
> API-compatible placeholder package for Computer Use. **This build ships without Computer Use: every runtime surface (Computer Use runtime, broker RPC, Helper install/launch/verify, PiP session client, native addon loader) reports `unavailable` and fails closed**, predicates about official CUA frames are `false`, and permission ports keep their privacy fail-closed semantics.
>
> License: Apache-2.0.」

包描述（`package.json`，逐字）：

> 「API-compatible placeholder package for Computer Use. This build ships without Computer Use: every runtime surface reports unavailable and fails closed.」

`zcode-cua` 版本为 **0.6.3**——说明它曾真实存在并迭代过，是**被裁剪**而非从未实现。

### 9.2 但仍留有大量架构痕迹

`packages/zcode-cua/` 中的 `.d.ts` 文件揭示了原本的设计面（文件名即证据）：

```
broker.d.ts                       broker-server.d.ts
broker-helper-constants.d.ts      broker-helper-health.d.ts
broker-ports.d.ts                 broker-socket-path.d.ts
frame-contract.d.ts               host-display-contract.d.ts
pip-session.d.ts                  pip-session-node.d.ts
request-access-contract.d.ts      index.d.ts
```

即原始设计包含：**broker（进程间代理）+ helper（原生辅助程序，有 install/launch/verify 与健康检查）+ frame contract（画面帧契约）+ host-display contract + PiP session（画中画会话，含 Node 实现）+ request-access contract（请求授权）**。这是一套**完整的 Computer Use 运行时**，而非简单的截图工具。

### 9.3 代码侧的残留

- `apps/zcode-cli/packages/core/src/subagent/computer-use-policy.ts`（117 行）
- `apps/zcode-cli/packages/services/src/cua-permission-broker/`
- `apps/zcode-cli/packages/core/src/runtime/helpers/official-cua-media.ts`
- `packages/shared/src/cuaAccessibilitySettings.ts`
- `apps/zcode-cli/packages/zcode-cua-plugin/`（v0.6.4，含 `scripts/computer-use-client.mjs`、`skills/`、`docs/`）
- 官方插件定义中有 `computer-use`（`official-plugin-definitions.ts`）
- `isZCodeCuaInternalFeatureEnabled` / `ZCODE_CUA_OFFICIAL_PLUGIN_ID`（`packages/shared`，被 `bundled-plugins.ts:13` 引用）

**默认关闭**，有明确注释（`packages/shared/src/plugin-marketplaces.ts`，逐字）：

> 「电脑控制回退为默认关闭，故 computer-use 不在此名单内。」

### 9.4 设计文档仍在仓库里

`docs/cua/` 有 13 篇（含 `2026-09-14-windows-cua-indicator-repair-spec.md`、`windows-product-runtime.md`、`windows-source-development.md`），说明 CUA 曾推进到 Windows 平台适配阶段。

另在 `docs/` 根有 `cua-get-app-state-user-title.md`、`cua-permission-broker/` 等。

### 9.5 与 dsh 对比

dsh 提供的是 `vision` 工具（**单张图片的语义理解**）+ `read_image`，是"看图"；ZCode 的 CUA 目标是"**操作电脑**"（broker + native helper + PiP 会话 + frame contract）。**两者不是同一层能力**。就本版本而言，二者都不可用于"操作 GUI"——dsh 需要你自己接 browser-use 之类的 MCP；ZCode 的 CUA 被显式裁剪成 fail-closed 占位。

### 9.6 为什么重要

对普通用户：**本版本的 ZCode 不能操作你的电脑**。但代码里预留了一整套（包括权限 broker 和隐私 fail-closed 语义），说明这是产品路线图上的东西，只是当前 build 关了。

对 Agent 开发者：**"API-compatible placeholder that fails closed" 是一种值得学习的裁剪方式**——不是删掉包，而是保留全部 API 表面、全部返回 unavailable、全部谓词返回 false，让上层代码零改动。这比"删包导致编译失败"或"半残功能悄悄跑"都好。

---

## §10 原生搜索工具链

### 10.1 是什么：三个原生二进制 + 一条可验证的供应链

`scripts/native-search-tools-*.mjs` 共 **14 个脚本**，配置在 `scripts/native-search-tools-config.mjs`。

**工具与版本**（逐字，`:38-42`）：

```js
export const NATIVE_SEARCH_TOOL_VERSIONS = Object.freeze({
  bfs: "4.1.1",
  ripgrep: "14.1.1",
  ugrep: "7.8.4",
});
```

**三个工具不是同一种东西**（这点很关键，不是"ripgrep 打包"那么简单）：

- **ripgrep 14.1.1** — 内容搜索（grep 替代）
- **bfs 4.1.1** — 文件查找（`find` 替代，tavianator/bfs）
- **ugrep 7.8.4** — 另一个 grep，带归档格式支持

**每个平台分发的工具不同**（逐字，`:82-86`）：

```js
const NATIVE_SEARCH_RUNTIME_TOOL_IDS_BY_PLATFORM = Object.freeze({
  darwin: Object.freeze(["bfs", "ugrep", "ripgrep"]),
  linux: Object.freeze(["bfs", "ugrep", "ripgrep"]),
  win32: Object.freeze(["ugrep", "ripgrep"]),   // Windows 没有 bfs
});
```

### 10.2 平台基线被显式钉死

逐字（`:14-15`）：

```js
export const MACOS_NATIVE_SEARCH_DEPLOYMENT_TARGET = "12.0";
export const LINUX_NATIVE_SEARCH_GLIBC_BASELINE = "2.28";
```

即：**macOS 最低 12.0，Linux 最低 glibc 2.28**。这是"编译产物发给用户"必须先声明的兼容契约。

### 10.3 供应链：每一个输入都带 sha256

预编译 release 命名（逐字，`:44-48`）：

```js
export const NATIVE_SEARCH_PREBUILT_RELEASES = Object.freeze({
  bfs: `v${NATIVE_SEARCH_TOOL_VERSIONS.bfs}-1`,
  ripgrep: `v${NATIVE_SEARCH_TOOL_VERSIONS.ripgrep}-1`,
  ugrep: `v${NATIVE_SEARCH_TOOL_VERSIONS.ugrep}-1`,
});
```

从源码构建时的**全部输入源 + 每个的 sha256**（`:55-102` 逐字节选）：

```js
export const NATIVE_SEARCH_SOURCE_ARCHIVES = Object.freeze([
  { id: "bfs", version: "4.1.1",
    url: "https://codeload.github.com/tavianator/bfs/tar.gz/f220fb5afd8dd7f46b1d1a2ae9c36261eaccf3cd",
    sha256: "26a122dbafc81f42a60f32d842ca5b4f30c943ba2efff1d61db827bda5efe742" },
  { id: "ugrep", version: "7.8.4",
    url: "https://codeload.github.com/Genivia/ugrep/tar.gz/550599a6434fc5315fb6ecd415a5d859e6d846a8",
    sha256: "0b3ed2dc7c3902d89f2ef8b66961db2e31a32f240fa2a2e0eb8d559827f36dab" },
  { id: "oniguruma", version: "6.9.10", sha256: "2a5cfc5ae259e4e97f86b68dfffc152cdaffe94e2060b770cb827238d769fc05" },
  { id: "pcre2", version: "10.43", sha256: "889d16be5abb8d05400b33c25e151638b8d4bac0e2d9c76e9d6923118ae8a34e" },
  { id: "zlib", version: "1.3.1", sha256: "9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23" },
  { id: "bzip2", version: "1.0.8", sha256: "ab5a03176ee106d3f0fa90e381da478ddae405918153cca248e682cd0c4a2269" },
  { id: "zstd", version: "1.5.6", sha256: "33eaa5611d330dbc037e32554521d4e4a8edf2358df7d9b74d586c510a4bcec6" },
  { id: "brotli", version: "1.1.0", sha256: "aaa739962a45b508b2e783b915e6b2b57ed3b12bd4b0feac73acfb144dffa54f" },
]);
```

注意 **oniguruma / pcre2 / zlib / bzip2 / zstd / brotli 六个依赖库也在清单里**——即整条 C 依赖闭包都被固定了版本与摘要。

bfs 的构建参数（逐字，`:32-38`）：

```js
export const NATIVE_SEARCH_BFS_CONFIGURE_ARGS = Object.freeze([
  "--enable-release", "--with-oniguruma",
  "--without-libselinux", "--without-libacl",
  "--without-liburing", "--without-libcap",
]);
```

**关掉 libselinux/libacl/liburing/libcap 是为了可移植性**（避免在目标机器上找系统库）。

还有一条 v13 legacy 兜底（逐字，`:17-26`）：`LEGACY_REMOTE_RIPGREP_VERSION = "v13.0.0-10"`，为远端（darwin）保留旧版 release，并**六个平台的归档 sha256 全部列出**，注释说明：「下载器与新的预编译工具链共用同一份"下载前必须具备可信摘要"的合同，**不能因为该 release 较旧就跳过归档验真**。」

### 10.4 验证：不是"校验 sha256"那么简单

`scripts/native-search-tools-verify.mjs` 做了**二进制格式级验证**：

- Mach-O 校验（`:26-45`）：读 magic `0xfeedfacf`（64 位）、file type 必须为 `MACHO_EXECUTE_FILE_TYPE = 2`（可执行）、CPU type 必须匹配 `arm64: 0x0100000c` / `x64: 0x01000007`。
- ELF 校验（`:47-65`）：magic `0x7f 'E' 'L' 'F'` + 64 位 + 小端，file type 为 2 或 3，machine 匹配 `arm64: 0xb7` / `x64: 0x3e`。
- Windows PE：单独的 `native-search-tools-windows-pe.mjs` + `native-search-tools-windows/` 目录。

另有 **bundle meta 机制**（`native-search-tools-bundle-meta.mjs:16-27`）：每个二进制旁边写一个 `.bundle-meta.json`，内含 `archiveSha256` / `binaryName` / `platform` / `provider: "native-search-tool"` / `release` / `sha256` / `source` / `toolId` / `version`。校验函数 `isNativeSearchBundleCurrent()` **重算二进制 sha256 并与 meta 逐字段比对**（`:33-47`）。

**这解决了什么问题**：只校验"下载的包对不对"不够——还要校验"**本地产物是不是那个包构建出来的、是不是对的架构、有没有被替换**"。所以要在本地产物旁边留一份 meta 并每次重算。

### 10.5 双来源：仓内预编译归档 + 内网镜像

配置注释（逐字，`:9-13`）：

```js
// 仓库内置的预编译归档与内网镜像同名、同 SHA-256；只在未配置内网依赖源时作为离线来源。
export const NATIVE_SEARCH_DEPENDENCIES_DIR = join(
  repoRoot, "apps/zcode-cli/dependencies/native-search",
);
```

即：**同一份产物在仓库内和公司内网镜像各存一份，摘要相同**——内网优先，离线兜底。这是企业内网环境的务实做法。

### 10.6 还在用 `ripgrep` npm 包

`apps/zcode-cli/packages/adapters/package.json` 依赖里有 `"ripgrep": "0.3.1"`——**npm 包与自建原生工具链并存**。推测是 fallback 路径（未取证具体调用关系）。

### 10.7 与 dsh 对比

dsh 用 `@vscode/ripgrep` 之类的**单一 ripgrep**；ZCode 是 **ripgrep + bfs + ugrep 三件套**，覆盖"搜内容"与"找文件"两个正交需求，且**自建构建、自建供应链验真、按平台裁剪工具集**。

### 10.8 为什么重要

对普通用户（可讲的故事）：ZCode 会**自带一套搜索引擎的原生二进制**，装在本地、不依赖你机器上有没有 `grep`/`find`。代价是安装包更大，收益是**在任何机器上行为一致**。

对 Agent 开发者：这是一份**原生依赖供应链的最小完整范本**——
1. 固定版本 + 固定 commit + 每个输入 sha256
2. 声明平台基线（glibc / min macOS）
3. 关掉可选的系统库依赖以提升可移植性
4. 本地产物旁留 meta 并每次重算校验
5. 校验二进制**格式与架构**，不只校验 hash
6. 内网镜像 + 仓库离线归档双来源，摘要一致

**⚠️ 未取证**：我未运行这些脚本。脚本逻辑是逐行读取的；`apps/zcode-cli/dependencies/native-search/` 下**已确认存在** `bfs-v4.1.1-1`、`bfs-v4.1.1-2`、`ripgrep-v13.0.0-10`、`ripgrep-v14.1.1-1`、`ugrep-v7.8.4-1` 五个归档目录与一份 `SHA256SUMS`，但未逐一比对 `SHA256SUMS` 与 config 中 sha256 是否一致，也未验证这些归档是否真的随发布包分发。

---

## 对普通用户的启示

1. **ZCode 不是"一个 CLI"，而是"一个 Agent 内核 + 四五个外壳"。** 同一个 Agent 会话可以在桌面窗口里用、在浏览器里用、被手机远控、被飞书/Telegram 里的 bot 唤起、被定时器自动唤起。你换的是入口，不是换了一个 agent。（依据：§1.2 拓扑图、§7 bots、§8 automations、`docs/architecture/message-flow.md:46-56`）

2. **它的安全性靠"问你"，不靠"关住它"。** 没有操作系统级沙箱（全仓 grep `seatbelt|bwrap|sandbox-exec` 零命中）。Guarded 模式是"YOLO 基础策略 + 明确危险命令单次批准"。产品自己写明「未命中/unsupported 沿原策略，**不表示安全**」。**你要把审批弹窗当回事。**（依据：§5.6、`docs/dangerous-command-approval-v1-plan.md`）

3. **你的会话数据在一个 SQLite 文件里：`~/.zcode/cli/db/db.sqlite`。** 而且你能做三件"时光机"操作：**分叉**（从某条消息开新对话）、**回退消息**、**回退文件**（`file-rewind.ts`——代码文件本身也能回到之前的状态）。（依据：§4.1、§4.4）

4. **插件商店是真商店，而且能装 Claude Code 的插件。** 精选区由官方 CDN 远程控制（改 JSON 就能调，不用重发插件包）；删掉一个市场来源**不会**删掉你已经装的插件和配置，只会让它变成"孤立已安装"状态——仍可用、可配置，只是不能更新，把来源加回来就恢复。（依据：§6.2 ADR 0001/0003、§6.4、§6.5）

5. **定时任务全局最多 20 条，而且满了不会自动清理。** 计数覆盖所有项目（不是每个项目 20 条），`active`/`paused`/`completed`/`failed` 全部占名额。满了之后 Agent 会告诉你"去自动化页手动删"，并且**它被明确禁止自己删任务**——这是保护你的设计。（依据：§8.3）

6. **本版本没有"操作电脑"能力，也不能用语音/看图之外的多模态操作。** `zcode-cua` 是刻意裁剪的占位包，"every runtime surface reports unavailable and fails closed"。但代码里留着完整的 broker + native helper + PiP 会话架构，说明这是路线图上的。（依据：§9.1、§9.2）

7. **飞书里的机器人是"单人专属"的。** 一个 bot 只绑一个 actor，重新 `/bind` 是**覆盖**不是新增。别人拿不到你的 bot。而且如果远端 workspace 断线，bot **不会**偷偷回退到同路径的本地目录，它会明确回你"远端已断开"，只有你发 `/reconnect` 才会重连。（依据：§7.4、§7.6）

---

## 对 Agent 开发者的启示

1. **把"谁是权威状态持有者"写进多份文档并反复强制。** ZCode 用三份独立文档（overview / message-flow / protocol-layers）重复同一句话：「CLI 持有 conversation 的权威状态」，「Main 不拥有连接池、logical session lifecycle、task projection、row、stream、queue、snapshot、goal 或 interaction 状态」。**这种重复不是冗余，是给 AI 协作者的护栏。**（依据：§1.2、§1.4）

2. **把 agent 循环写成显式状态机，让非法转移直接抛错。** `turn-state.ts` 的 `validTransitions` 表 + `turn-machine.ts:92-104` 的抛错，使循环可测试、可推理。10 个相位里 `Streaming → SchedulingTools → ExecutingTools → AggregatingResults → AwaitingModelResponse` 的回环就是 agent loop 的全部。（依据：§2.1、§2.2）

3. **工具的副作用范围要做成一等声明，并让权限与调度都读它。** `readOnly` / `destructive` / `concurrentSafe` / `sideEffectScope` 四个字段直接决定 `canRunInParallel`，也直接被权限系统消费（`AGENTS.md` 明文要求）。这比在每个调用点临时判断安全得多。（依据：§2.5、§5.4）

4. **别用启发式伪装安全边界——宁可写下"我不承诺"。** ZCode 有一段罕见的坦白：「既不增加 OS sandbox、capability probe、`bwrap`/Seatbelt 包装…也不根据命令字符串识别和拒绝数据库访问。shell 的变量、cwd、脚本、符号链接和跨平台展开语义无法由关键词或正则可靠还原，保留启发式检查只会**制造已经建立安全边界的错误认知**。」（依据：§5.6）

5. **产品限制不能用"普通错误"表达。** 定时任务撞 20 条上限时：取消本轮剩余工具调用 → 锁死所有工具 → 只允许一次纯文本回复 → 明确禁止 Agent 自行删除任务。这是"不可恢复的产品约束"应有的形态。（依据：§8.3）

6. **异步子代理的正确形态是"父先结束 + 子完成后 idle wake"，不是"父等子"。** ZCode 为此写过一版废弃方案并留下说明，还附了真实失败会话 id 与根因（"completion 入队后无人 wake"）。注意它的非目标里明确排除了 `TaskCreate`/`TaskList`/`TaskUpdate`——**不做任务板是一个决策，不是一个遗漏**。（依据：§3.3）

7. **原生二进制供应链要验到"格式与架构"这一层，而不只是 sha256。** 三件套（ripgrep + bfs + ugrep）、平台基线（macOS 12.0 / glibc 2.28）、C 依赖闭包全部固定摘要、本地产物旁留 `.bundle-meta.json` 并每次重算比对、Mach-O/ELF/PE 逐字节校验 magic + CPU type / machine。（依据：§10.3、§10.4）

---

## 可直接引用的金句

1. > 「V4 的最终事实源和命令裁决者是 workspace 对应的 `zcode-cli`，不是 Renderer、Main 或 Relay。」
> — `docs/architecture/communication-protocol-layers.md:104`

2. > 「ACK 与 projection 是两条不同语义：ACK 回答"命令是否被接纳/拒绝"，projection 回答"产品状态现在是什么"。UI 最终必须以后者收敛。」
> — `docs/architecture/message-flow.md:42`

3. > 「Main 不拥有连接池、logical session lifecycle、task projection、row、stream、queue、snapshot、goal 或 interaction 状态。」
> — `docs/architecture/zcode-code-architecture-overview.md:34`

4. > 「workspaceKey = workspaceIdentity?.trim() || workspacePath」
> — `docs/architecture/zcode-code-architecture-overview.md:55`（同一公式在 `docs/bots.md:22` 等处复述）

5. > 「关键边界：普通 subagent 不是 OS 子进程，而是在同一进程内创建新的子执行上下文，再运行新的 query loop。外部进程、tmux、in-process teammate 和 remote agent 属于 agent team 或 remote task 分支，**不应和普通 subagent 混成一个概念**。」
> — `apps/zcode-cli/docs/design/v2/tool/07-subagent.md:18`

6. > 「teammate spawn | `team_name` 和 `name` 同时存在 | 这是 agent team/swarm，不是普通 subagent，应作为独立工具或独立模式处理」
> — `apps/zcode-cli/docs/design/v2/tool/07-subagent.md:16`

7. > 「provider-visible description 和字段说明只覆盖 local-agent 子集；teammate mailbox、shutdown、plan approval 等 **ZCode 未支持的 team protocol** 不进入工具说明。」
> — `apps/zcode-cli/docs/design/v2/tool/07-subagent.md:436-437`

8. > 「`status: "success"` 只表示消息已被 `queued`、`steered` 或通过 `resumed_background` 接受，**不表示目标 agent 已读取、接受任务或回复**。」
> — `apps/zcode-cli/docs/design/v2/tool/07-subagent.md:459`

9. > 「参考失败形态：`sess_bc1e9c8a-80a0-4bda-a927-6fde7ec6dc4c` 的父 turn 已 finish，子 session 后续正常完成并写出 output，但父 session 没有新的 model request，也没有 `background_task` synthetic notice。这符合"completion 入队后无人 wake"的根因。」
> — `docs/cli-background-subagent-wake-plan.md`

10. > 「本版本完整撤销 automation 内部库在通用 Bash 执行链上的专用保护：**既不增加 OS sandbox、capability probe、`bwrap` / Seatbelt 包装或受保护资源协议字段**，也不根据命令字符串识别和拒绝数据库访问。shell 的变量、cwd、脚本、符号链接和跨平台展开语义无法由关键词或正则可靠还原，保留启发式检查只会**制造已经建立安全边界的错误认知**。」
> — `docs/automation-edit-status.md`

11. > 「guarded=**YOLO 基础策略 + 明确危险命令用户单次批准**；原 yolo/build/edit/plan 保持原行为，**auto 仍未实现**。不修改默认值，不迁移已有任务/自动化/配置，不新增保护 boolean 或数据库迁移。**不是完整 Auto Mode classifier，也不承诺未知语法安全。**」
> — `docs/dangerous-command-approval-v1-plan.md`

12. > 「**全量门禁未通过，不宣称 production ready，不自动提交/推送**；新增 E2E 待人工审核，Linux 原生执行及 Windows Desktop/手机 UI 未运行。」
> — `docs/dangerous-command-approval-v1-plan.md`

13. > 「同一信息可能在两处存在且不一致（目录说作者是 A，manifest 说是 B）——按本决定，**UI 永远信目录**。」
> — `docs/adr/0001-store-listing-in-marketplace-catalog.md`

14. > 「未来若设计系统与商店风格冲突，**以本决定为准，不要"顺手修正"商店页的留白与渐变**。」
> — `docs/adr/0002-plugin-store-style-deviation.md`

15. > 「**安装状态和来源状态必须独立建模，UI 不能以"目录中不存在"推导"未安装"。**」
> — `docs/adr/0003-marketplace-source-removal-keeps-installed-plugins.md`

16. > 「**Bots lets a private third-party chat drive the same ZCode task flow as the UI input box.**」
> — `docs/bots.md:3`

17. > 「The circuit opens after **three consecutive failures in the same inbound turn**. It has **no timer-based half-open transition**: stale events arriving minutes later cannot restart writes for that turn.」
> — `docs/bots-feishu-streaming-card-reliability.md`

18. > 「**The synchronous response is the only card write for the click**: it does not also call `card_update_token`, PATCH the message, synthesize a card from `zcodeCardText`, send a replacement message, or recall the original.」
> — `docs/bots.md`

19. > 「- `active`、`paused`、`completed`、`failed` 等全部生命周期状态都占用名额。
> - 闲时任务属于独立领域，不计入定时任务的 20 条上限。
> - 更新、运行、暂停和恢复已有任务不受限制；**只有删除定时任务定义才释放名额**。」
> — `docs/automation-create-limit.md`

20. > 「**真实重复语义以持久化的 `scheduleRule` 为准；`cronExpr` 只保留为合法兼容表达式，不能因 cron 字段的步长上限改变真实频率。**」
> — `docs/automation-session-hourly-interval.md`

21. > 「API-compatible placeholder package for Computer Use. **This build ships without Computer Use: every runtime surface reports unavailable and fails closed.**」
> — `packages/zcode-cua/README.md`

22. > 「仍排除 PowerShell、brace/变量/命令替换展开、脚本、隐式配置、rimraf/shred/truncate、远端删除、Git 局部回退；wrapper 仍仅 env/time/sudo，xargs/find-exec/npx 不扩展。**未命中/unsupported 沿原策略，不表示安全。**」
> — `docs/dangerous-command-approval-v1-plan.md`

23. > 「**下载器与新的预编译工具链共用同一份"下载前必须具备可信摘要"的合同，不能因为该 release 较旧就跳过归档验真。**」
> — `scripts/native-search-tools-config.mjs:19-21`

24. > 「该集合必须与 official-plugin-definitions.ts 里标了 defaultEnabled 的插件逐一对应，**bootstrap 的「Settings 默认启用集合与 CLI 的官方插件声明一致」单测机械对照两者**。」
> — `packages/shared/src/plugin-marketplaces.ts:36-38`

25. > 「**Coding agent CLI 应把 session、message、tool call、permission、checkpoint、队列和 pending 状态视为一等状态对象，支持恢复、分叉、回滚和并发 session。**」
> — `apps/zcode-cli/AGENTS.md`「会话、配置与可观测性」

---

## 与 dsh 的架构差异

> dsh 侧事实引自本仓库 `docs/dsh-analysis/_scratch-dsh-architecture.md`（同事的取证文档），ZCode 侧事实全部来自本报告前述章节。

| 维度 | dsh | ZCode | 证据 |
| --- | --- | --- | --- |
| **内核形态** | Cordis 微内核，**agent 循环本身是插件**，一切可替换 | **固定产品内核**（`zcode-cli`）+ 多端外壳；插件贡献 skills/commands/MCP/agents/hooks | dsh：`_scratch-dsh-architecture.md:12,22-26`；ZCode：`README.md:19`、`apps/zcode-cli/README.md`「Plugin Development」 |
| **架构治理** | **运行时**：能力即服务，Service Definition 必须是 Cordis `Service`（抽象类/注册表），不是 TS interface | **编译前**：`architecture-policy.yaml` 声明模块 roots/requires/layers/owner，`pnpm architecture:check` 强制；全局 `maxFileLines: 400` / `forbidCycles: true` | ZCode：`architecture-policy.yaml`（`global:` 段与 `exceptions:` 段）；dsh：`_scratch-dsh-architecture.md:41`。**⚠️ ZCode 治理有漂移**：policy 声明的 `session` 模块 `contract.ts` 不存在 |
| **会话持久化** | **长生命周期 append-only 事件日志**；已提交代际永不重命名/替换/删除；replay/fork/rebuild 全部从日志推导 | **SQLite（`node:sqlite`）+ upsert + 单调 `sequence`**；`~/.zcode/cli/db/db.sqlite`；表 `session`/`message`/`part`/`session_entry` | ZCode：`session-store/paths.ts:5-7`、`migrations.ts:14-115`、`repositories/messages.ts:35-36,69-90`；dsh：`_scratch-dsh-architecture.md:562,676` |
| **持久化接缝的可删性** | **没有删除 API**，会话文件永不删除，清理要手工删目录 | 有 `uninstallPlugin`、`session-fork`、`rewind`、`storage` 磁盘清理模块（domain 含 `cleanPlan`） | ZCode：`packages/services/src/storage/domain/`、`runtime/methods/rewind.ts`；dsh：`_scratch-dsh-architecture.md:676` |
| **多智能体** | **Agent Teams（实验）**：Lead + teammate 角色化、永久命名（含创建失败的）、共享任务板、owner/lease 永不自动释放；`maxMembers: 16` / 任务板 256 / 每人 64 条消息 | **单主 agent + 子 agent spawn + 双向 mailbox**；**无 team、无任务板**；`TaskCreate`/`TaskList`/`TaskUpdate` 在非目标清单里；测试断言 tool description `not.toContain("teammate")` | dsh：`_scratch-dsh-architecture.md:268-428`；ZCode：`07-subagent.md:16,18,436-437`、`cli-background-subagent-wake-plan.md` 非目标、`tool-contracts.test.ts:304` |
| **子代理续聊** | `send_message` 唤醒队友；teammate 有预留 Session id | `SendMessage({ to })`，仅限本 runtime `RuntimeTaskRegistry` 内 `local_agent` id；**不支持名称 alias、不支持跨 runtime 投递**；`success` 仅表示投递被接受 | ZCode：`07-subagent.md:440-459`；dsh：`_scratch-dsh-architecture.md:274,294` |
| **LLM 适配** | **twin LLM adapters**：两个同源适配器各自拥有 fetch/translate 内部实现 | **账号套餐即 provider 身份**：6 个内置 provider = Z.ai / BigModel × Start/个人/团队 Coding Plan；`ModelSelection` 是持久化领域对象，校验返回结构化错误码 | ZCode：`model-provider-types.ts:7-14`、`provider/src/registry.ts:12-32`、`model-provider-family.ts:44-60`；dsh：`_scratch-dsh-architecture.md:924,932` |
| **分发与市场** | **无内建商店**；bundle = Cordis config 行 + 代码，插进去的还能被上层 patch | **有真商店**：官方市场（CDN 驱动 `featured`）+ 个人来源分段；listing 与 manifest 分离；sha256 zip；**主动兼容 Claude Code 插件布局**（V1a→V2 四阶段） | ZCode：`CONTEXT.md`、`docs/adr/0001`、`plugin-marketplaces.ts:41-49`、`claude-code-marketplace-plugin-compat.md`；dsh：`_scratch-dsh-architecture.md:55` |
| **安全模型** | （依 dsh scratch：审批/权限为独立包 `dsh-user-approval`，作为可替换能力拼装） | **审批门 + 命令解析**（6 种 `CollaborationMode`，其中 `guarded` = YOLO + 危险命令单次批准）；**无 OS 沙箱**（全仓 grep `seatbelt\|bwrap\|sandbox-exec` 零命中）；Bash 只读判定拆成 20+ 文件按命令族建表；权限继承单向收紧（guarded 父不给 yolo 子升格） | ZCode：`session.port.ts:32-40`、`docs/dangerous-command-approval-v1-plan.md`、`docs/automation-edit-status.md`、`tool/handlers/bash-readonly-policy-*.ts` |
| **实验功能默认态** | 实验特性默认关闭（如 Agent Teams） | 同样偏保守：`auto` 权限模式**未实现**；CUA **裁剪为 fail-closed 占位**；`computer-use` 默认关闭；`interval` 上限 200 | ZCode：`docs/dangerous-command-approval-v1-plan.md`「auto 仍未实现」、`zcode-cua/README.md`、`plugin-marketplaces.ts`「电脑控制回退为默认关闭」 |
| **外部渠道** | （dsh 为纯本地 harness） | **bots：把 agent 接进飞书/Lark/Telegram/微信/Webhook**，流式卡片有熔断 + 180 元素预算 + 分段封存；远端断线**绝不隐式回退** | ZCode：`docs/bots.md`、`docs/bots-feishu-streaming-card-reliability.md` |
| **调度能力** | （dsh 无内建定时） | **automations：cron + `scheduleRule` 双轨**；全局上限 20 条；`intervalUnit`+`interval`(1–200)；Agent 撞限时锁工具 + 禁止自删 | ZCode：`automation-types.ts:10-11,37-47`、`docs/automation-create-limit.md`、`docs/automation-session-hourly-interval.md` |
| **原生工具链** | （dsh 用 ripgrep 类单一工具） | **三件套：ripgrep 14.1.1 + bfs 4.1.1 + ugrep 7.8.4**，按平台裁剪（Windows 无 bfs）；平台基线 macOS 12.0 / glibc 2.28；C 依赖闭包逐个 sha256；本地产物 `.bundle-meta.json` 每次重算；Mach-O/ELF/PE 格式与架构校验 | ZCode：`scripts/native-search-tools-config.mjs:14-15,38-42,55-102`、`native-search-tools-verify.mjs:26-65`、`native-search-tools-bundle-meta.mjs:16-47` |
| **产品形态** | harness / 库形态，面向开发者组合 | **成品多端产品**：Electron 桌面（主）+ Web + Android + 手机远控 + CLI + `zcode-server` 远端宿主 | ZCode：`packages/{desktop,web,android,server,zcode-server-cli}`、`zcode-code-architecture-overview.md:9-26` |
| **多端交付语义** | 单进程 harness | **两条交付链路必须同时验证**：桌面 `desktop-continuous`（live topic + seq 恢复）/ 手机 `web-remote-replayable`（shared-host attachment + gap/snapshot 恢复）；relay 与 Main 不持有业务状态 | ZCode：`message-flow.md:46-48`、`zcode-code-architecture-overview.md:98`、根 `AGENTS.md`「进程、协议与远程控制」 |
| **工作区身份** | （dsh 面向单一工作目录） | `workspaceKey`（身份）与 `workspacePath`（执行）严格分离；远程贯穿 `remoteSessionId`；「不得用相同远端路径推导相同 workspace 身份」 | ZCode：`zcode-code-architecture-overview.md:52-62`、根 `AGENTS.md`「Workspace Identity」 |

---

## 附录：本报告的取证边界（诚实声明）

**已逐字读取的文档**（完整）：`docs/architecture/architecture.md`、`zcode-code-architecture-overview.md`、`message-flow.md`、`communication-protocol-layers.md`、`docs/adr/0001~0003`、`CONTEXT.md`、`docs/bots.md`、`docs/automation-create-limit.md`、`docs/automation-edit-status.md`、`docs/automation-session-hourly-interval.md`、`docs/dangerous-command-approval-v1-plan.md`、`docs/agent-tool-relaxed-execution-policy.md`、`docs/agent-background-subagent-join.md`、`docs/cli-background-subagent-wake-plan.md`、`docs/claude-code-marketplace-plugin-compat.md`、`docs/claude-marketplace-triplet-plugin-compat.md`、`docs/bash-background-parity.md`、`packages/zcode-cua/README.md`、`apps/zcode-cli/docs/design/v2/tool/07-subagent.md`（前半 + §SendMessage 段 + 非目标段）、`apps/zcode-cli/docs/design/v2/tool/07-subagent-background-plan.md`（前半）、`architecture-policy.yaml`、根 `README.md`（前半）、`apps/zcode-cli/README.md`（前半）、根/CLI `AGENTS.md`。

**已逐字读取的代码**：`agent/turn-state.ts`、`agent/turn-machine.ts`、`runtime/methods/turn-loop.ts`、`runtime/methods/turn.ts`、`tool/scheduler.ts`（全文）；`runtime/methods/session-fork.ts`（前 70 行）、`contracts/src/tools/agent.ts`（前 120 行）、`contracts/src/interfaces/session.port.ts:32-46`、`provider/src/registry.ts:1-50`、`shared/src/model-provider-types.ts:7-29`、`shared/src/automation-types.ts:1-60`、`shared/src/plugin-marketplaces.ts:1-60`、`adapters/src/storage/session-store/paths.ts`（全文）、`migrations.ts:30-115`、`repositories/messages.ts:35-90,230`、`repositories/session-entries.ts:1-50`、`plugins/{installedPluginRoots,pluginManagementService}.ts`（前半）、`scripts/native-search-tools-{config,verify,bundle-meta}.mjs`（部分）。

**未能证实 / 未取证的项**（写文章时需谨慎或补证）：

- `packages/services/src/session/contract.ts` **不存在**，但被 `architecture-policy.yaml` 声明为 public entrypoint —— 这是**已证实的政策漂移**，非未证实项。
- `apps/zcode-cli/dependencies/native-search` 下**确实有预编译归档**（已验证）：`bfs-v4.1.1-1`、`bfs-v4.1.1-2`、`ripgrep-v13.0.0-10`（legacy）、`ripgrep-v14.1.1-1`、`ugrep-v7.8.4-1`，另有 `SHA256SUMS`（2291 字节）汇总各归档摘要。**但归档内的二进制是否已在本次检出中解开、`SHA256SUMS` 的内容是否与 config 的 sha256 逐条一致，未逐一比对。**
- `docs/bots-feishu-group-collaboration.md`、`docs/bots-private-task-sync.md`、`docs/bot-channel-runtime-split.md`（**注意：这是 `docs/` 根下的独立文件，不存在 `docs/bots/` 目录**）的具体内容 —— **未逐字读取**（仅确认存在，且 `bots.md` 引用了 group collaboration 文档为 normative）。
- 「channel runtime split」的具体切分口径 —— **未证实**。
- `packages/android/` 的实现范围（本报告仅确认其为 Gradle 工程目录，未读代码）。
- `packages/formal-proof/`、`packages/stream-animate/`、`packages/model-option-map/` 的职责 —— **未取证**（仅从包名与目录推断，本报告未依赖它们做任何论断）。
- `agent.ts` 的 `outputSchema` 是否严格等价于 `AgentOutputSchema` 在 routes 上的实际使用 —— 仅读了契约定义。
- ZCode 是否真的支持「按会话并发多 session」的运行时上限 —— 未找到明确数字。
- `docs/` 下另有 **318 个条目**（`ls docs/ | wc -l` = 318），本报告只覆盖了与 scope 直接相关的部分。写文章引用其他文档前应另行取证。
