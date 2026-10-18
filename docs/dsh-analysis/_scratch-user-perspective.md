# 普通 AI 产品用户，能从 DeepSeek Harness 的源码里学到什么

> 素材来源：`/Users/zxnap/code/opensource/deepseek-harness`（真实源码，HEAD `00102833dfaee1da9f48a3a8eae9d34005a75218`，2026-09-22）。
> 全文引用均已逐字核对；无法核实的条目集中列在文末。
> 读者设定：用 ChatGPT / DeepSeek / Claude / Cursor，但不是工程师，也不会去装 dsh。

---

## 排序说明

以下 9 条按「对普通用户的**反直觉程度 × 可操作性**」从高到低排列。排名靠前的，是你今天就能改变用法、且大概率和你现在的直觉相反的。

---

## 1. AI 说「我测过了」，最可能测的不是你在用的那个东西

**一句话结论：** AI 的「验证通过」和「你的问题被解决」是两件事——验收对象一错，后面所有绿灯都是假的。

**源码里的机制：**

`docs/postmortem/0003-web-agent-gui-feedback-loop.md` 是一份真实事故复盘。Agent 改了 GUI 源码，却不知道自己这个会话跑在哪个 URL、哪个进程上，于是：

- 它改完代码，让用户自己去打开页面验证（把验收甩回给用户）；
- 它启动了「裸 Vite」开发服务器，看到 HTTP 200 就宣布成功——但真正的页面白屏了，因为 `window.__DSH_BOOT__` 只有完整的 host 才会注入。复盘原文：

  > "it delegated acceptance to the user, then treated a bare Vite HTTP 200 as success despite a missing `window.__DSH_BOOT__` white screen"
  > —— `docs/postmortem/0003-web-agent-gui-feedback-loop.md:11`

- 更关键的一步：它又在**另一个端口**起了一个「替代服务器」来验证，只检查这个替代品返回 200。

  复盘把这种思维方式总结成了一句话：

  > "A source edit, a successful build, an HTTP 200, an injected boot manifest, and the user's existing page were treated as interchangeable facts."
  > —— `docs/postmortem/0003-web-agent-gui-feedback-loop.md:19`

  以及教训部分：

  > "A replacement service cannot prove that an existing page changed."
  > —— `docs/postmortem/0003-web-agent-gui-feedback-loop.md`（Lessons）

  真相是：用户实际在用的 3081 端口页面**早就已经是新版**了。Agent 从头到尾没探测过 3081，却在替身身上耗了一整轮。

**对普通用户意味着什么（可操作）：**

- **永远问一句「你是在哪个东西上验证的？」** 如果你在用一个网页产品，而 AI 说「我测过了」，它测的可能是它自己搭的一个副本，不是你在用的那个页面。
- **把「验收对象」写进你的要求里。** 不要说「帮我改好」，要说「改完后，请确认**我正在用的这个地址**刷新后确实变了」。这一句能挡掉 0003 里 90% 的返工。
- **警惕「替代品绿灯」。** 一个新建的副本跑通了，恰恰不构成「你原来那个坏掉的东西被修好了」的证据。这两个是独立的事实。
- 另一个同源的坑在同一份复盘里：Agent 用 shell 的 `&` 起了个后台进程，绕过了受管的任务生命周期：

  > "Background process semantics were also bypassed with shell `&`, so job identity, completion notices, collection, and cleanup did not apply. Verifying port 3334 therefore proved only that a second service worked."
  > —— `docs/postmortem/0003-web-agent-gui-feedback-loop.md`（Root cause）

---

## 2. 「测试全绿、覆盖率 100%」和「这东西能用」之间没有因果关系

**一句话结论：** 测试证明的是「代码被执行过」，不是「功能按出厂方式工作」。

**源码里的机制：**

`docs/postmortem/0001-acp-default-export-drops-inject.md` 记录的是一次极其彻底的翻车：

> "The bridge was completely non-functional in production despite 178 green unit tests and 100% line coverage."
> —— `docs/postmortem/0001-acp-default-export-drops-inject.md:11`

178 个测试全绿、行覆盖率 100%，真实编辑器一连上来就崩。根因是源码多写了一行 `export default apply`，导致插件加载时 `inject` 被丢弃。而复盘的结论更狠——为什么测试没抓到：

> "every test mounted the plugin through a path that did not exercise how it actually loads or how its services actually resolve."
> —— `docs/postmortem/0001-acp-default-export-drops-inject.md:11`

以及那句可以裱起来的话：

> "Coverage proves lines *ran*; it says nothing about whether the feature works *the way it ships*."
> —— `docs/postmortem/0001-acp-default-export-drops-inject.md`

测试是**手工挂载**插件的（相当于人工把零件装成能跑的样子），而真实加载路径是另一条路。测试走的路，和产品走的路，不是同一条路。

**对普通用户意味着什么（可操作）：**

- 当 AI 用「我写了测试 / 全部通过 / 覆盖率 100%」来回答「你确定能行吗」时，**这不构成回答**。它的可信度和「代码能编译」差不多。
- **换成这两个问题**：
  1. 「**你实际运行过它吗？**」（而不是「你测过它吗」）
  2. 「测试走的是不是我实际会走的那条路径？」
- 一个更普适的鉴别法：如果 AI 的验证方式是**它自己搭的一套环境**（mock、模拟器、手写的小样例），那它验的是它的模型，不是你的现实。真实环境的边界（网络、权限、缓存、真实数据）恰恰是最容易崩的地方。

---

## 3. 检查「东西存在」是假测试；真正值钱的测试检查「一段时间/一份数据里的关系」

**一句话结论：** 让 AI 证明「它做了 X」，远远不如让它证明「X 和 Y 之间的关系成立」。

**源码里的机制：**

`.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md` 专门纠正了一次「假装有测试」的做法。原文把无用断言写得很直白：

> "Merely confirming that a declared method exists, that a plugin has its expected name, or that a constant example still returns a known value is not such a relation."
> —— `.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md:13`

它给「有用的运行时断言」下了定义：

> "A useful runtime invariant relates observations over time or across a mutable data structure. Examples include a terminal event without its start, an LLM delta for a block that is not open, or a durable result whose identity differs from its request."
> —— `.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md:11`

并且明确说了这类空断言为什么有害：

> "Those assertions made every companion executable without making the system safer"
> —— `.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md:7`

同一个原则也写进了 `AGENTS.md:132`：

> "**Runtime invariants assert owned relationships.** Publish `./invariant` only when independent observations can diverge. Otherwise omit its source and wiring and record why in its README; empty installers and checks of service presence, plugin metadata, effects, or fixed examples are invalid"

`packages/AGENTS.md:11` 的措辞更接近日常：**"Require a current owner and need."**

**对普通用户意味着什么（可操作）：**

- 这是本文最可迁移的一条。**「存在性检查」是最好写、也最没用的检查。**
- 把下面这些「假验证」换成关系型验证：

  | AI 的假验证 | 你该要求的真验证 |
  |---|---|
  | 「文件已经创建了」 | 「文件内容和我给你的原文一致吗？把 diff 给我看」 |
  | 「这个函数存在」 | 「调用它之后，返回值对得上输入吗」 |
  | 「我加了日志」 | 「同一次操作，开始和结束的两条记录条数对得上吗」 |
  | 「配置项已支持」 | 「我改了这个值，行为真的变了没」 |

- 一句话模板：**「别告诉我它存在，告诉我它和什么对得上。」**
- 这条之所以反直觉：存在性检查**看起来**完全像测试（有断言、会通过、会失败），所以它能骗过大多数人。源码作者也是被它骗过一次才写下这条规则。

---

## 4. 长对话里 AI 变笨，不是它「走神」，是它的记忆被真的删掉并改写成了摘要

**一句话结论：** 长会话里 AI 变差是**设计使然**，不是玄学；知道触发点在哪，你就能主动管理它。

**源码里的机制：**

`packages/compaction/compaction-basic/README.md` 公开了完整的默认参数：

> "the default trigger is `floor(min(W × 0.8, W − O − B))`, where `B = 65,536` tokens. Retention keeps the newest 16% of `W − O` verbatim."
> —— `packages/compaction/compaction-basic/README.md:62`

也就是说：上下文用到 **80%** 就触发压缩；压缩时**只有最近 16% 保持逐字原文**，更早的部分被替换成一条摘要：

> "The oldest balanced span is replaced by one summary message and the recent tail stays verbatim; the conversation continues from the summary."
> —— `packages/compaction/compaction-basic/README.md:82`

而且压缩**明确是有损的**——原文列了它做不到什么：

> "It cannot reduce the system prompt, tools, or session prefix, or split one indivisible unit such as a single huge tool call."
> —— `packages/compaction/compaction-basic/README.md:12`

压缩本身还要**多花一次模型调用**：

> "Condensation uses one extra model request and retains only its summary text."
> —— `packages/compaction/compaction-basic/README.md:12`

值得注意的是，这套设计里有一层更轻的补救：`compaction-tool-result-pruner` 不调用模型，只把过大的工具输出剪成「头部 + middle pruned 标记 + 尾部」。默认是把超过 8192 字符的结果截成前 4096 + 后 1024（`packages/compaction/compaction-tool-result-pruner/README.md` 配置表）。**关键的安心点**：

> "The complete original result remains in the session log for exact replay and inspection."
> —— `packages/compaction/compaction-tool-result-pruner/README.md:12`

**对普通用户意味着什么（可操作）：**

- **「AI 忘了」是字面意义的忘。** 早期对话不是被「理解后记住」，而是被替换成一段摘要；摘要里没写的细节就是真的没了。
- **主动开新会话，而不是跟一个超长会话死磕。** 一旦你发现 AI 开始重复问你已经说过的信息、或引用你早先说过的内容出现偏差，那大概率已经越过 80% 阈值进入摘要区了。
- **重要约束要重述，且要放在最近的位置。** 因为只有最近的那一小段是逐字保留的。你在 30 轮前定的规则，很可能已经变成摘要里的一句话、甚至没进摘要。
- **长文档/长输出要留心。** 那条 8192 字符的裁剪线意味着：如果 AI 在一个长会话里处理一份大文件，**后半段会话里它看到的可能已经不是全文了**（原文仍留在日志里，但模型看到的被剪过）。跨轮次引用一份长材料时，重新贴一次比指望它记得更可靠。

---

## 5. 一切模型看到的东西都可以从日志原样重建——这是「可审计」，也是「可追责」

**一句话结论：** 这个系统有一条硬不变量：凡是进入模型请求的内容，必须能从会话日志里逐字节重建。对用户来说，这意味着 AI 说的话在原理上是可复现、可对账的。

**源码里的机制：**

`AGENTS.md:136` 把这条写成了一行：

> "**Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event."

设计记录里的完整表述更可检查：

> "**Model-visible ⟺ durably referenced.** Anything that reaches a model request must be reconstructable from the session log and the immutable content-addressed objects it references. The checkable consequence: anyone holding the log, its referenced attachment objects, and the pinned code version reconstructs every loop request byte-for-byte."
> —— `.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md:17`

还有一条副作用值得注意——**前缀缓存稳定性是推论，不是目标**：

> "Prefix-cache stability is corollary #1, not the headline: an append-only log projected by a per-node pure function yields requests that are append-extensions of their predecessors whenever the header is unchanged — stability is emergent, not managed."
> —— `.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md:19`

这条不变量的代价也被诚实地记录了一次：多图提问时，`user/message` 必须等所有附件落盘才能写入，导致界面上迟迟不显示消息（`.agents/notes/archived/architecture/2026-08-26-local-submission-echoes.md:10`）。**即使牺牲响应手感，也不允许「模型看到了但日志里没有」**——这就是不变量的分量。

**对普通用户意味着什么（可操作）：**

- 你可以理直气壮地要求**可核对的过程记录**，而 AI 产品里「它到底看到了什么」通常是个黑箱。
- 实际用法：当 AI 的回答明显不该出现（比如引用了你没说的话），正确的怀疑顺序是——**「我的输入有没有被截断/替换过？」**，而不是先假设它在胡说。第 4 条的摘要机制正是这种事的高发区。
- 更普适的原则：**一个系统的可信度，取决于它能不能回答「你为什么这么说」。** 如果一个 AI 产品无法给你看到它当时看到的内容，「可复现」就无从谈起。

---

## 6. 你可以「分叉」一段对话——因为对话是一条只增不改的日志

**一句话结论：** 对话不是一坨可被覆盖的状态，而是一条只能追加的事件流；正因如此，它可以在任意历史点分裂成两条互不影响的线。

**源码里的机制：**

`SessionStore.fork` **接受任意已存在的整数事件序号**：

> "`SessionStore.fork` accepts any existing integer event seq exactly. It owns source membership, child identity and cut validation."
> —— `.agents/notes/implemented/feature/2026-08-18-arbitrary-seq-session-fork.md`

省略 `atSeq` 时的语义：

> "Omitted `atSeq` means the latest completed turn with its independent tail, stopping before the next turn or queued user input. An explicit seq never moves."
> —— 同上

分叉后会补上继承标记并按统一规则闭合悬空的工具调用：

> "`buildForkSeed`, the only export of `dsh-session/fork`, copies the inclusive prefix, inserts the child's inherited `session/end-seed` marker, and closes the open tail."
> —— 同上

而这条能力是**刻意放宽**的，之前只允许在「已完成的轮次」切：

> "This replaces the completed-turn-only controller policy."
> —— 同上

一条被明确记录的取舍，正是本文第 5 条那条不变量在起作用：

> "**Repair during request construction.** Model-visible results must be logged, so the seed records them before the model request."
> —— 同上（Alternatives considered）

**对普通用户意味着什么（可操作）：**

- **心智模型升级**：别把对话当「一份文档」，把它当「一条有版本的历史」。你在中途做的每一次尝试，原则上都是可回到的分支点。
- 实用战术：**在让 AI 做一件有风险的事之前，先确认当前状态是「干净的一轮」。** 这样一旦它跑偏，你回到的是那个干净点，而不是被污染的状态。
- **不要用「编辑上文」的方式纠正 AI。** 改上一句话是在破坏这个「日志」模型；更稳的做法是**新开一条线**（新会话/新分叉），让旧线和它的错误一起留在那里备查。
- 顺带一个认知：分叉后**父与子的序号会分道扬镳**（原文："Parent and child sequence numbers diverge after the cut."）。所以「同一段历史的两条线」不会互相污染——这正是它值得存在的原因。

---

## 7. AI 能派 AI 干活时，你该把「任务」说成任务，而不是说成请求

**一句话结论：** 当 AI 可以委派、等待、收件时，「让它做一件事」的最优说法变了——你需要给它可并行的**任务**和可交接的**成果**，而不是一句祈使句。

**源码里的机制：**

委派的隔离性是明确的：

> "Children are isolated: a crashed or misbehaving child cannot corrupt the parent's session."
> —— `packages/subagent/subagent/README.md:67`

子代理只把**最终结果**交回，不是完整过程：

> "One notice per settled Activation in the parent's request, sized by the child's final text."
> —— `packages/subagent/subagent/README.md:154`

`packages/experimental/agent-team/README.md` 则把「一支小队」的机制写全了，它对用户最有启发的是**任务板**和**消息传递**：

> "the session's agent becomes the Lead, creates named teammates for delegated work, exchanges durable messages with them, and tracks shared tasks on a common board."
> —— `packages/experimental/agent-team/README.md:12`

任务板的三个关键语义（都直接对应「怎么给 AI 派活」）：

1. **依赖关系是硬门禁**：
   > "A task is claimable only when everything it depends on is complete."
   > —— 同上
2. **并发写是 CAS，不会互相静默覆盖**：
   > "Every change is compare-and-set: an update based on an outdated copy is rejected, so two members cannot silently overwrite each other's work."
   > —— 同上
3. **文件冲突只警告、不阻塞**：
   > "File hints produce warnings when two in-progress tasks plan to touch overlapping paths — they never block anything."
   > —— 同上

消息传递上有一条非常实用的性质：

> "A live member receives it immediately; an offline member's messages queue and arrive when it resumes. Messages are never lost and never delivered twice."
> —— 同上

**对普通用户意味着什么（可操作）：**

- **把「帮我写个方案」改成「任务清单」**：拆成几件可以分别完成、彼此有先后关系的事。上面那条依赖门禁说明——**显式写出「B 要等 A 完成」比指望模型自己排序可靠得多**，因为系统层面就是这么执行的。
- **主动告诉它「哪些文件/哪部分内容会被碰到」**，即便只是提示。原文明确说文件提示只会产生警告、不阻塞——所以这是**你能免费提供的、降低返工率的信息**。
- **放心地「离线派活」**：消息对不在线的成员会排队、不丢也不重发。所以「你先做，我待会儿再问」是安全的工作方式，不必一次问完。
- 一个边界要记住：子代理**不是全知的分身**。团队模式里明确写着 teammate 要么全新开始、要么只继承 Lead 已完成的轮次（"A teammate starts fresh with no memory of the Lead's conversation, or as a fork that inherits the Lead's completed turns"）。**所以派活时要自带上下文**，别假设它记得你刚才聊了什么。
- 还有一条源码级别的诚实提醒：子代理的审批是**钉死为 `never`** 的。`.agents/notes/implemented/feature/2026-08-10-subagent-approval-pinned-never.md` 的原文说：

  > "A delegated child acts only within the permission scope fixed at delegation, and approval prompts are removed from its world entirely"
  
  对用户的含义：**授权是在「派活那一刻」定死的**，之后子任务无法在你眼前弹窗申请更多权限。所以「先给足权限再派活」，而不是指望它中途来问你。

---

## 8. AI 写出的「像成品的文字」，很多其实是它没说完的思考过程——有现成的分类法可以识别

**一句话结论：** 一份看起来结构完整、语气笃定的产出，可能仍然只是作者的对内独白；有一套八类的识别清单可以直接拿来用。

**源码里的机制：**

`.agents/skills/dsh-trim-cot-leakage/SKILL.md` 把这个现象命名为 **Chain-of-Thought leakage（思维链泄漏）**，并给出定义：

> "Chain-of-thought leakage is prose whose vantage is the authoring session rather than the repository: it cites artifacts only that session could see, narrates the change instead of the state, or argues with a reviewer who has left."
> —— `.agents/skills/dsh-trim-cot-leakage/SKILL.md`

**它给出的「唯一一条测试」极其好用：**

> "For every suspect passage ask: **could a reader at HEAD, with no access to any session transcript, PR thread, or uncommitted draft, resolve every reference and verify every claim?**"
> —— 同上

八类分类法（原文 Taxonomy 节，1–8）：

1. 引用只有那个会话能看到的死引用——`(decision 7)`、`design §4.7`、阶段标签 `T4`/`W3`；
2. 站队视角——"a later PR in this stack"、"this PR adds"；
3. 变更叙述与版本戳——**"used to"、"no longer"、"the old X"**，"this cut"、"today"；
4. 评审编排——"Rejected in review:"、"the reviewer confirmed"、草稿序号；
5. **对审阅者说话的自证**——"the cast is safe — it simply…"、"this is correct because…"；
6. 复述与推导过程——"first we X, then we Y"、把显而易见的判断也展开写；
7. **对冲与规划残留**——"probably fine for now"、"should be enough"、没有标记的推迟；
8. 写作语言串味——中英混入的未翻译工作语（如 `端`、`设计稿`）。

判定标准也是原话：

> "State the invariant that makes the code safe, or delete the comment if the code shows it."
> —— 第 5 类（Reviewer-addressed justification）

**对普通用户意味着什么（可操作）：**

- **这是本文最可直接上手的一条。** 它给了你一份「AI 输出的注水检测表」。看到下面这些词，说明你手上的是草稿/独白，不是结论：
  - 「原来……现在改成了……」/ "used to" / "no longer"
  - 「我们首先……然后……」的过程流水账
  - 「这应该是够用的」/「目前看没问题」/ "probably fine for now"
  - 「正如评审指出的……」/「之所以这样写是正确的，是因为……」
- **两个立刻能用的追问**：
  1. 「**把结论和你的过程分开**：只给我最终说法，别复述你怎么推的。」
  2. 「**删掉所有『以前是这样/现在改成这样』的叙述**，只描述现在的状态。」（对应第 3 类）
- **一个反常识的好处**：要求「只讲当前状态、不讲变更故事」不只是让文字变短——它会**逼出真正的结论**。因为「变更叙述」最容易掩盖一个事实：作者其实还没决定最终是什么。
- 这份 skill 还提醒了一个过度修正的陷阱（原文 Overcorrection traps）：修剪时不能把「义务」说成「倡导」、不能把「假设」升格成「已上线功能」。**所以你让 AI 精简时，要补一句「不许丢掉事实」**，否则它会连真话一起删掉。

---

## 9. 一切靠「自觉遵守」的约定都会失效——要约束，不要嘱咐

**一句话结论：** 唯一的有效方式是把要求变成「会报错的检查」；给 AI 提要求时，「你必须」不如「你怎么证明」。

**源码里的机制：**

`.agents/notes/implemented/process/2026-06-11-quality-gates.md` 的 Problem 节写下了两条在这个仓库里被反复验证的判断：

> "Agents follow enforced gates far more reliably than prose conventions, and 'a lot of work' is not a cost argument when agents do the labor."
> —— `.agents/notes/implemented/process/2026-06-11-quality-gates.md`（Problem）

对应的决定是：

> "Every mechanically checkable AGENTS.md promise gets a command that exits non-zero."
> —— 同上（Decision）

也就是：凡是**能机械检查**的承诺，都要配一条会返回非零退出码的命令。而且文档本身也被上了硬约束——`scripts/verify-doc-budgets.ts` 头部写明：

> "Ceilings ratchet down with at least 5% headroom; raising one requires the justification defined in `docs/AGENTS.md`."
> —— `scripts/verify-doc-budgets.ts:4-5`

**「棘轮」的意思**：预算只能往下调，每次还必须留出至少 5% 余量；想上调，必须写出理由。文档只会越写越短，不会悄悄膨胀。具体到文件：`AGENTS.md` 上限 1950 词、`packages/AGENTS.md` 上限 750 词（`scripts/doc-budgets.manifest.json`）。超了就是构建失败。

同一主题的另一面写在 `AGENTS.md` 里，两个原则值得并列看：

> "**Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent." —— `AGENTS.md`
>
> "**Trust TypeScript at typed same-process boundaries.** Do not add runtime validation … validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries." —— `AGENTS.md:144`

以及 `packages/AGENTS.md:12`：

> "**Require evidence for public choices.** Configurability does not justify an unsupported default, public operation set, format, or imported external concept."

**对普通用户意味着什么（可操作）：**

- **别用形容词提要求，用验收条件提要求。** 「写得好一点」「严谨一些」是 prose convention，一定会漂移。换成：「给我三个具体数字，每个都要标明来源。」——这是 gate。
- **「工作量大」不是理由。** 源码里那条判断直接迁移：当劳动由 AI 承担时，「这样做太费事了」这个论据就失效了。**所以当 AI 用「这需要很多工作」来劝你降级方案时，你可以直接拒绝这个论据本身**，让它按原方案做。（这是本文最实用的一句话之一。）
- **主动要求「失败要响」。** 对应原文的 fails loud：宁可要一个明确的报错，也不要一个「悄悄跳过」。当你听到 AI 说「如果找不到就默认忽略」时，这是一个值得警惕的信号。
- **对文档/产出设「棘轮」。** 与其每次抱怨太长，不如约定一个上限（比如「这份说明不许超过两页」），并且只准往下调。这比反复叮嘱有效得多——因为这个仓库用的就是这个办法，而且是**用构建失败来强制**的。
- 最后一条边界感（来自 `AGENTS.md:144`）：这个仓库刻意**不在内部调用上加防御性检查**，只在真正的边界（解析器、配置文件、模型/工具 JSON、跨进程/跨线缆）上加。对用户的启发是——**问 AI「这里信任的依据是什么」**，比笼统地问「这里安全吗」更能得到真答案。

---

## 附：可直接引用的金句

| # | 英文原文（逐字） | 出处 | 建议中文 |
|---|---|---|---|
| 1 | "Coverage proves lines *ran*; it says nothing about whether the feature works *the way it ships*." | `docs/postmortem/0001-acp-default-export-drops-inject.md`（Why every test missed it） | 覆盖率只能证明代码「跑过」，完全不能证明功能「按出厂方式能用」。 |
| 2 | "The bridge was completely non-functional in production despite 178 green unit tests and 100% line coverage." | `docs/postmortem/0001-acp-default-export-drops-inject.md:11` | 178 个单元测试全绿、行覆盖率 100%，这个模块在生产环境里依然完全不能用。 |
| 3 | "A source edit, a successful build, an HTTP 200, an injected boot manifest, and the user's existing page were treated as interchangeable facts." | `docs/postmortem/0003-web-agent-gui-feedback-loop.md:19` | 改过源码、构建成功、返回 200、启动清单已注入、用户正在用的那个页面——这五件事被当成了可以互相替代的事实。 |
| 4 | "A replacement service cannot prove that an existing page changed." | `docs/postmortem/0003-web-agent-gui-feedback-loop.md`（Lessons） | 一个替代服务跑通了，不能证明你原来那个页面已经变了。 |
| 5 | "Merely confirming that a declared method exists, that a plugin has its expected name, or that a constant example still returns a known value is not such a relation." | `.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md:13` | 仅仅确认「这个方法存在」「这个名字对」「这个例子还返回老值」，都不算一条真正的关系。 |
| 6 | "A useful runtime invariant relates observations over time or across a mutable data structure." | `.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md:11` | 真正有用的检查，是去验证「跨时间、跨一份会变的数据」之间的关系。 |
| 7 | "**Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log" | `AGENTS.md:136` | 模型可见 ⟺ 已入日志：任何进入模型请求的内容，都必须能从会话日志里重建。 |
| 8 | "anyone holding the log, its referenced attachment objects, and the pinned code version reconstructs every loop request byte-for-byte." | `.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md:17` | 任何拿到日志、它引用的附件、以及固定版本代码的人，都能逐字节重建每一次请求。 |
| 9 | "Agents follow enforced gates far more reliably than prose conventions, and 'a lot of work' is not a cost argument when agents do the labor." | `.agents/notes/implemented/process/2026-06-11-quality-gates.md`（Problem） | 比起写在文档里的约定，Agent 更可靠地遵守「会报错的检查」；而当干活的是 Agent 时，「这要花很多功夫」根本不算一个成本论据。 |
| 10 | "Ceilings ratchet down with at least 5% headroom; raising one requires the justification defined in `docs/AGENTS.md`." | `scripts/verify-doc-budgets.ts:4-5` | 字数上限只往下棘轮，且每次至少留 5% 余量；想上调就必须给出理由。 |
| 11 | "Chain-of-thought leakage is prose whose vantage is the authoring session rather than the repository" | `.agents/skills/dsh-trim-cot-leakage/SKILL.md` | 思维链泄漏，指的是那些「站在写作者那一次会话的视角、而不是站在作品本身视角」的文字。 |
| 12 | "could a reader at HEAD, with no access to any session transcript, PR thread, or uncommitted draft, resolve every reference and verify every claim?" | `.agents/skills/dsh-trim-cot-leakage/SKILL.md`（The one test） | 一个只看到最终成品、拿不到任何会话记录／评审讨论／未提交草稿的读者，能不能查证这里的每一个说法？ |
| 13 | "Children are isolated: a crashed or misbehaving child cannot corrupt the parent's session." | `packages/subagent/subagent/README.md:67` | 子任务之间是隔离的：某个子任务崩溃或行为异常，也不会污染主会话。 |
| 14 | "A delegated child acts only within the permission scope fixed at delegation, and approval prompts are removed from its world entirely" | `.agents/notes/implemented/feature/2026-08-10-subagent-approval-pinned-never.md`（Decision） | 被派出去的子任务只能在「派活那一刻」定死的权限范围内行动，它的世界里根本不存在弹窗申请权限这件事。 |

---

## 未能核实的条目（诚实标注）

以下几处我**没有找到**确凿证据，因此正文中未作为结论使用：

1. **「上下文压缩会让模型变笨」的源码自述。** 我验证了压缩的触发线（80%）、保留比例（16%）、有损性质，但没有在 `packages/compaction/*` 里找到**明确把「压缩」与「回答质量下降」挂钩**的原话。第 4 条中「AI 变差」的部分是我基于机制（历史被摘要替换）的合理推断，**不是**源码的直接主张。引用时请只引用触发线与保留比例这类硬事实。

2. **`compaction-image-offload` 与 `command-compact` 的细节。** 我只读了 `compaction-basic` 和 `compaction-tool-result-pruner` 的 README；`/compact` 命令的存在已在 `compaction-basic` README 中确认，但另两个包的内部机制未展开核实。

3. **KV cache 与压缩的关系。** `compaction-basic` README 提到摘要调用会复用 warm prefix（"Summarization reuses the provider's warm prefix"），但我没有找到「压缩会导致 KV cache 失效」的直接陈述，故未写入。

4. **「消息永不丢失、永不重复投递」的实现验证。** 该说法是 `packages/experimental/agent-team/README.md` 的**文档声明**，我未审计其实现代码或测试。引用时应写明「文档如此声明」。

5. **`agent-team` 的稳定性。** 该包 README 自述 "published under its experimental name, carries no stability promise"，且需持久化存储才生效。第 7 条据此机制推导出的用法建议，属于**方法论借鉴**，不代表该功能在普通产品中已普遍可用。

6. **文档预算的「5%」是规则还是现状。** 我核实的是 `scripts/verify-doc-budgets.ts` 注释中的规则表述与 manifest 中的具体上限值（1950 / 750 等）；「每次下调都实际留了 5%」这一现状我未逐一比对历史提交验证。

7. **`session-query/*` 的分叉查询能力。** 我确认了 fork 机制（`2026-08-18-arbitrary-seq-session-fork.md`）与日志的 append-only 性质，但 `packages/session-query/*` 各包的具体查询/导出能力我只做了目录级确认，未逐包阅读 README。第 6 条因此只建立在 fork 与日志模型上。

8. **未逐一阅读 `packages/sandbox/sandbox-local` 的平台实现。** 沙箱的三种模式、fail-closed 行为、升级审批链条均来自 `packages/sandbox/sandbox/README.md`（该包的公开契约文档）；各平台后端（Landlock / Seatbelt / Windows ACL）的具体差异只通过 postmortem 0004 间接了解。
