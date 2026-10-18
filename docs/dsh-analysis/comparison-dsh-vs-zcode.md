# dsh vs ZCode：两个 agent harness 的研发治理对比

> **分析对象**
> - **dsh（deepseek-harness）**：`/Users/zxnap/code/opensource/deepseek-harness`（HEAD `00102833`，2026-09-22）
> - **ZCode**：`/Users/zxnap/code/MyWorks/yltech.edu/game/.ref-zcode/ZCode`（HEAD `aac4755` v3.15.1，2026-10-10）
>
> **方法**：两个仓库各自派两个子代理做源码级分析（治理面 + 架构面），Lead 对关键结论逐条独立复核。所有引文带 `path:line` 或逐字原文。
> **日期**：2026-10-12

---

## 0. 结论先行

| | dsh | ZCode |
|---|---|---|
| **本质** | 一切皆插件的 agent **运行时**（微内核 + 57 包） | 一个 Agent 内核 + **多个外壳**（桌面/Web/CLI/Android） |
| **治理主线** | **机制化门禁**：把每条约定编译成 exit 非零 | **架构政策**：把模块边界写成可校验的 YAML |
| **决策记录** | 1,179 篇 Agent Note，四态路径编码 | 273 篇平铺事实文档 + **仅 4 篇 ADR** |
| **规则载体长度** | 根 AGENTS.md **1,949 词**（自包含手册） | 根 AGENTS.md **357 词**（路由表 + 红线） |
| **多智能体** | **Agent Teams**：Lead + 具名 teammate + 共享任务板 | **明确不做**：测试断言工具描述不得含 "teammate" |
| **会话模型** | append-only 事件日志（可推导、可重放） | **SQLite + upsert + 单调 sequence** |
| **安全边界** | 包自有运行时不变式 + 审批 fail-closed + 沙箱 | 审批门 + 命令解析，**全仓无 OS 级沙箱** |
| **git 可分析性** | 19,520 次提交（历史可考古） | **4 次提交**（压平导入，历史不可分析） |

**一句话**：dsh 把纪律做进**运行时与门禁**，ZCode 把纪律做进**架构政策与模块契约**。两者都在回答同一个问题——「怎么让 AI 写的代码不失控」——但答案各自长在自家产品的形状上。

---

## 1. 方法学警告（必须先说）

**ZCode 只有 4 个提交**，全部是压平导入：

```
2026-09-20 Initial commit
2026-09-21 feat: open source
2026-09-24 feat: update v3.14.3
2026-10-10 feat: update to v3.15.1
```

这意味着：**任何"演化过程"类结论都不可验证**。前一篇对 dsh 的分析之所以能谈"ratchet 收紧""事故催生门禁"，是因为它有 19,520 次提交和 4 份 postmortem 可考古；ZCode 只能做**工作树快照**，谈"现在是什么样"，不能谈"怎么变成这样"。

本文对 ZCode 的所有结论都是**静态事实**，不涉及演化因果。

---

## 2. 治理模型：门禁 vs 政策

### 2.1 dsh：一切可检查的约定都配一条 exit 非零

核心判断（`.agents/notes/implemented/process/2026-06-11-quality-gates.md`）：

> This codebase is developed primarily by coding agents. Agents follow enforced gates far more reliably than prose conventions, and "a lot of work" is not a cost argument when agents do the labor.

落成 **69 个 `scripts/verify-*` 文件**（42 个门禁本体 + 27 个自检），覆盖：决策笔记格式、文档字数预算、双语配对哈希、包不变式接线、cordis 配置、Skill 触发元数据、导出 JSDoc、禁裸 dispatcher、禁 unknown cast……

### 2.2 ZCode：把架构边界写成可校验的政策文件

ZCode 最独特的产物是 **`architecture-policy.yaml`**——一份**可执行的架构政策**，登记 25 个模块：

```yaml
- id: storage
  roots: [packages/services/src/storage]
  managed: true
  requires: [shared, rpc, services]
  publicEntrypoints: [packages/services/src/storage/contract.ts]
  layers: { domain: domain, app: app, adapters: adapters }
  layerOrder: [domain, app, adapters]
  owner: desktop-settings
```

配套 `scripts/architecture/architecture-check.mjs`（+ `index.mjs` 398 行）执行 **12 条规则**：

| 规则 | 强制内容 |
|---|---|
| `cycle` | 禁止循环依赖 |
| `layer-direction` | 层不能依赖更高层（domain→app→adapters 单向） |
| `domain-io` | **domain 层不能依赖 IO/进程/网络/定时器**（`node:`/`fs`/`path`/`http`/`child_process`/`timers` 全禁） |
| `module-dependency` | 跨模块依赖必须在 `requires` 里声明 |
| `deep-import` | 只能走 `publicEntrypoints`，禁深路径导入 |
| `ui-implementation-import` | UI 不准直接 import `repo`/`runtime`/`services` 实现 |
| `missing-module-artifact` | managed 模块必须齐备 5 件产物 |
| `max-file-lines` | **400 行**上限 |
| `max-contract-lines` | **300 行**上限 |
| `max-public-methods` | **12 个**公开方法上限 |
| `disable-count` | managed 模块里**一行 lint-disable 即失败**（阈值 0） |
| `expired-exception` | 例外过期自动变成违规 |

真实失败消息（中文，逐字）：

```
检测到循环依赖：A -> B -> A
层 ${importerLayer} 不能依赖更高层 ${targetLayer}
domain 层不能依赖 IO、进程、网络或定时器
模块 ${module.id} 缺少 ${artifact}
文件 ${lines} 行，超过上限 ${policy.global.maxFileLines} 行
例外 ${exception.id} 已于 ${exception.expires} 过期
```

### 2.3 两者对比

| 维度 | dsh | ZCode |
|---|---|---|
| 检查对象 | **流程**（笔记格式、文档预算、双语配对） | **结构**（层方向、依赖、文件/契约尺寸、公开面） |
| 强制手段 | 69 个独立脚本，CI 跑全集 | 1 个政策文件 + 1 个检查器，**12 条规则** |
| 违规定位 | 逐条消息 | 逐条消息（中文） |
| 例外机制 | 无（不许绕过） | **有，且必须写 reason、可设 expires**，过期即违规 |
| 棘轮 | 文档字数上限只许下调（≥5% 余量） | baseline 用 `sha256(rule\0file\0detail)` 指纹，**当前为空 = 存量已清零** |
| 门禁定位 | 事后拦截 | **事前显式化** |

最后一条是 ZCode 最值得抄的一句话（`.agents/skills/architecture-governance/SKILL.md:8`）：

> It is a design guide as well as a gate: the goal is to make the intended architecture obvious before code is generated, so the checker confirms a decision instead of discovering it for the first time.

**它同时是设计指南和门禁：目的是让目标架构在代码生成之前就显式，好让检查器"确认一个决定"，而不是"第一次发现它"。** 这是从事后拦截到事前显式化的定位改写。

### 2.4 但 ZCode 自己诚实公告了能力边界

`docs/architecture/architecture-governance.md:72` 原文：

> 当前 `managedOnly: true` 下的零违规仅表示已启用规则没有报错，不证明所有存量跨域依赖已通过机械检查。

**25 个模块只有 9 个 `managed: true`**，其余 16 个只是"登记以便生成阅读包"，不受任何规则约束。所以"零违规"是**在已启用范围内的零违规**——这句话本身就值得单独引用，因为它示范了基础设施团队该如何描述门禁的效力边界。

### 2.5 已发现的治理漂移（两边都有）

| 项目 | 漂移 |
|---|---|
| ZCode | `architecture-policy.yaml` 把 `packages/services/src/session/contract.ts` 声明为 public entrypoint，**该文件不存在** |
| ZCode | `dependency-graph.mmd` 是生成的，但**没有漂移门禁**（不进 pre-push，无测试覆盖） |
| ZCode | `audit:agent-remnants` 备了 `--max-unclassified`/`--max-runtime-blocker` 双旋钮，但 package.json 调用**没传参** → 纯报告模式，旋钮未接线 |
| ZCode | 两条例外都支持 `expires`，但**都没设** → 机制已实现未使用 |
| dsh | 根 `AGENTS.md:7` 仍写"SQLite uses monotonic SCHEMA_VERSION"，而 **SQLite 持久化后端早已删除**（commit `4553c9d957`） |

**这一节的元结论**：两个项目都有"治理声明 vs 实际状态"的偏差。dsh 的偏差在**过期文档**，ZCode 的偏差在**未接线的机制**。这说明——治理体系本身也需要被治理，而两边都还没做到。

---

## 3. 决策记录：四态笔记 vs 平铺事实文档

### 3.1 dsh：1,179 篇 Agent Note，路径即状态

`{lifecycle}/{class}/yyyy-mm-dd-topic.md`：

| 状态 | 数量 | 规则 |
|---|---|---|
| `proposed/` | 39 | 提案，还没做 |
| `implemented/` | 484 | 已落地，**必须随代码同步更新事实** |
| `rejected/` | 14 | 被否，**只在理由仍能阻止诱人错误时保留** |
| `archived/` | 640 | 独立冻结树，**永不编辑**，门禁跳过其外链检查 |

强制 `Alternatives considered`，理由是全文最漂亮的一句：

> a decision recorded without what it beat invites the re-litigation Agent Notes exist to prevent.

### 3.2 ZCode：273 篇平铺事实文档 + 4 篇 ADR

`docs/` 下 **1,866 个 markdown 是虚数**——其中 `docs/knip/`（47）、`docs/superpowers/`（253）、`docs/browser-use/`（48）、`docs/webdriverio/`（124）等是**第三方文档站源码被纳管**。自写的平铺文档实为 **273 篇**，命名如 `agent-subagent-provider-runtime-headers-routing.md`。

ADR 只有 **4 篇**，且都是"例外文书"：

- **0001** 商店 listing 与 manifest 分离（改展示不用重发 zip）
- **0002** **授权一处刻意违规**——插件商店页有意偏离 `DESIGN.md`，并写明禁止后人"顺手修正"
- **0003** 安装状态与来源状态必须独立建模（UI 不能用"目录中不存在"推导"未安装"）
- **0004** 发布打包平台契约

**分工是自洽的**：ADR 保证"不可逆决策"有唯一文本；平铺文档承载"易变量"，避免产生 N 份副本。

**但代价明显**：273 篇平铺文档**没有索引、没有状态字段、没有 supersede 链**。读者无法从文件名判断一份文档是"当前事实"还是"历史 plan"，治理文档只能用"历史 plan/spec 仅作背景"这类文字约定兜底。

### 3.3 对比

| 维度 | dsh | ZCode |
|---|---|---|
| 决策记录数 | 1,179（含双语 2,354 文件） | 273 自写 + 4 ADR |
| 状态编码 | **路径即状态**（四态目录） | 无状态字段（除 4 篇 ADR） |
| 强制"放弃了什么" | **是**（门禁强制） | 否（ADR 模板里有 Alternatives，平铺文档无） |
| 索引 | 明确**禁止**中心索引 | 无索引（4 个 README） |
| 归档机制 | 冻结树 + 哈希封条 | 无 |
| 文档预算门禁 | **有**（8 个受管文档，棘轮） | **无**（grep "文档预算/doc budget" 零命中） |

**这是两者差异最锐利的地方**：dsh 把**文档本身当成需要机械约束的产物**（字数上限、格式门禁、双语哈希、归档封条）；ZCode 的文档侧**零门禁**，只有 5 条 prose 约定，其中最重要的是（`docs/agents/instruction-maintenance.md:5`）：

> 文件长度只用于观察上下文开销，不作为效果提升的证明。

**一边用脚本管文档，一边用文字自律。** 两种都成立，但风险不对称：dsh 的文档不会失控但维护成本高；ZCode 的文档灵活但已累积 273 篇无索引事实文档。

---

## 4. 根 AGENTS.md：手册 vs 路由表

| 维度 | dsh（1,949 词） | ZCode（357 词） |
|---|---|---|
| 主体 | 工具语义、工作流、项目结构、硬规则 | **行为纪律 + 一行式边界清单** |
| 领域知识 | 内联承载 | **全部外链**（`CONTEXT.md` 190 词 / `DESIGN.md` 4,927 词 / `docs/agents/*`） |
| 组织方式 | 自包含手册 | **"何时读哪个文件"的路由表** |
| 第一句 | 项目概述 | **「开工前运行 `node scripts/check-workspace-freshness.mjs`」** |

ZCode 明确****把"根文件不承载领域知识"制度化：`docs/agents/instruction-maintenance.md` 给出分工表，并规定「删除功能时同步清理指令和技能中的引用」。

它最硬的一条（`AGENTS.md:45`）：

> 必须执行 `pnpm typecheck` 和 `pnpm lint`，报告真实结果，不将已有失败写成通过。

**"不将已有失败写成通过"**——这条针对的正是 AI 的报告偏差。

### ZCode 独有的 `CONTEXT.md`：带"禁用词"的领域词汇表

它不只是术语表，还给出 **`_Avoid_`（避免用法）**：

> **Official Marketplace（官方市场）**：ZCode 官方运营的唯一分发渠道……是"分发渠道"而非"作者归属"。
> _Avoid_: 把 claude-plugins-official 称作"官方市场"；"官方"泛指一切受信市场

**给出"该怎么叫"的同时给出"别怎么叫"**，这个设计对约束 AI 写作的术语漂移很有效——而且和 dsh 的 CoT 泄漏治理是同一问题的两种解法。

---

## 5. 架构：微内核运行时 vs 内核 + 多外壳

### 5.1 dsh：没有特权内核

`docs/architecture.md:11-13` 逐字：

> Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so each is replaceable from configuration.
>
> There is no privileged core to patch: you extend dsh by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads.

可核对：`packages/*/*/package.json` 中**只有 2 个包**运行时依赖 agent-loop（`dsh-base`、`dsh-sdk-minimal`），且都是组装档；47 个包只在 devDependencies 引用它。另有 20 行 "Where new behavior goes" 扩展点对照表。

### 5.2 ZCode：一个内核 + 多个外壳，事实源在 CLI

根 README 自述「AI 编程工作台，提供桌面应用、浏览器界面和终端 Agent」。三份架构文档重复同一条不变量（`docs/architecture/communication-protocol-layers.md:104`）：

> V4 的最终事实源和命令裁决者是 workspace 对应的 `zcode-cli`，不是 Renderer、Main 或 Relay。

Electron Main 被刻意削薄到「不拥有连接池、task projection、row、stream、queue、snapshot、goal 或 interaction 状态」——只做窗口、原生操作、进程调度、消息转发。

**这是根本性的架构分歧**：dsh 是"同一内核被不同配置组装成不同产品"；ZCode 是"同一内核被多个客户端外壳挂载，其中 CLI 是权威"。

### 5.3 会话模型：append-only 日志 vs SQLite

| | dsh | ZCode |
|---|---|---|
| 存储 | append-only 事件日志（JSONL + zstd） | `~/.zcode/cli/db/db.sqlite` |
| 驱动 | 自研 RLE/句柄 | **Node 内置 `node:sqlite`**（零依赖） |
| 写入 | 只追加 | `insert ... on conflict(id) do update`（upsert）+ 单调 `sequence` |
| 不变式 | **"Model-visible ⟺ logged"**：`JSON.stringify(messages) === JSON.stringify(session.deriveMessages())` 运行时断言 | 单调 sequence 保证顺序 |
| 时光机 | fork（任意 seq） | fork / rewind / **file-rewind（连代码文件都能回退）** |

**dsh 的赌注是"可推导"**——模型看到的东西必须能从日志重新推导（这条有运行时断言，不是口号）；**ZCode 的赌注是"可检索 + 可修订"**——用数据库换来更低的存储成本与更强的查询能力，代价是放弃了"日志即真相"的强不变量。

### 5.4 多智能体：dsh 做了，ZCode 明确不做

这是**最有新闻价值的对比**。

**dsh** 有完整 Agent Teams：Lead + 具名 teammate、持久 mailbox（先落盘再投递）、共享任务板（`blockedBy` DAG + revision CAS）、名字永久、**任务所有权永不自动释放**。设计金句：

> False mutual exclusion is more dangerous than an explicit warning.

**ZCode 则是一个产品决策明确不做**，有三重证据：

1. subagent 规范把 `teammate spawn` 归类为「agent team/swarm，不是普通 subagent」
2. 明确写道「teammate mailbox、shutdown、plan approval 等 **ZCode 未支持的 team protocol** 不进入工具说明」
3. **有测试机械断言工具描述不得含该词**（`apps/zcode-cli/packages/core/tests/tool-contracts.test.ts:304`）：

```ts
expect(contract?.description).not.toContain("teammate");
```

`TaskCreate`/`TaskList`/`TaskUpdate` 被列入非目标清单。

**这条测试本身就是个治理样本**：产品的"不做"被写成断言钉在测试里，防止后来者（或 AI）顺手把它加回来。

而 ZCode 对自己的 subagent 语义也有一句极诚实的说明：

> `status: "success"` 只表示消息已被 queued/steered 接受，不表示目标 agent 已读取、接受任务或回复。

**"成功"只表示消息被接受，不表示对方读了。** 这与 dsh 那条 `inactive does not describe task completion` 是同一类诚实的反面语义声明——两边都在防止使用者把"投递成功"误读成"任务完成"。

### 5.5 安全模型：谁在守边界

| | dsh | ZCode |
|---|---|---|
| OS 级沙箱 | 有（sandbox/local、windows-acl、fs-sandbox、bash-sandbox） | **无**（grep `seatbelt\|bwrap\|sandbox-exec` 在 packages/apps 零命中） |
| 审批 | fail-closed：缺失/失败的 answerer → `unavailable`，**宁可不开门** | 审批门 + 命令解析（20+ 文件按命令族建表） |
| 危险操作 | 提权严格向上、理由必填 | 危险命令单次批准，**不提供永久授权** |
| 权限继承 | 子代理审批策略**钉死为 `never`** | 单向收紧：`parent === "guarded" && resolved === "yolo" ? "guarded" : resolved` |
| 诚实声明 | 沙箱只管文件："Network and process visibility are outside this vocabulary" | 保留启发式检查「只会制造已经建立安全边界的错误认知」 |

ZCode 那句坦白值得单独引用（`docs/automation-edit-status.md`）——**明知没有 OS 沙箱，就明确不加"看起来像保护"的启发式检查**，因为那会"制造已经建立安全边界的错误认知"。

两边在这一点上价值观一致：**宁可明说边界在哪，也不摆一个会失效的防线**（与 dsh 的 "False mutual exclusion is more dangerous than an explicit warning" 同源）。

---

## 6. 各自独有的东西

### 6.1 ZCode 独有

- **可执行架构政策 + 12 条结构规则**，含 `domain-io`（domain 层禁 IO）和 `disable-count` 阈值 0
- **"阅读包"（reading package）**：`pnpm architecture:context <module-id>` 生成受控上下文——**门禁顺手变成了上下文供给**，这是很妙的一手
- **native search 三件套**：ripgrep 14.1.1 + bfs 4.1.1 + ugrep 7.8.4，C 依赖闭包逐个 sha256，验证做到 **Mach-O magic / ELF machine 二进制格式级**，归档确实随仓库分发（5 个归档目录 + `SHA256SUMS`）
- **真插件商店 + 主动兼容 Claude Code 插件**（四阶段迁移，明说"不把 Claude 的高权限运行时语义直接带入"）
- **bots**（飞书群协作、私有任务同步、流式卡片）与 **automations**（`scheduleRule` 权威、`cronExpr` 仅兼容载体——因为五段 cron 表达不了"每 31 小时"；上限 20 条，撞限后"锁死工具只允许一次纯文本回复"）
- **容器 E2E**：`--network none` + replay provider 做断网确定性回放；两个 verified 预设当前**是空串**，脚本注释「formal/local replay 通过不等于 Docker admission」，空跑 exit 2
- **`packages/formal-proof/`**：名字误导，实为**产品行为状态空间枚举器**（7 维 `ProductContext` 穷举对话状态，`undefined` 是一等公民 = 显式建模"产品未定义该组合"）
- **`CONTEXT.md` 的 `_Avoid_` 反术语**机制

### 6.2 dsh 独有

- **69 个流程门禁**：笔记格式、文档预算棘轮、双语配对哈希、包不变式接线、Skill 触发元数据、CoT 泄漏分类
- **运行时关系不变式**：`Model-visible ⟺ logged` 每条模型请求前断言；且 `prepend` 注册防别的监听器短路它
- **Twin 真实现**：两个真适配器压同一契约，"凡是词汇表无法同时表达两个实现的都是词汇表的 bug"；明确拒绝 mock 当第二实现
- **Agent Teams** 全套 + `False mutual exclusion` 判断
- **四份 postmortem**：每份都"测试全绿、真实路径是死的"，每份都产出机械门禁而非"注意事项"
- **CoT 泄漏治理** 8 类 + "只问一个问题"判定
- **文档字数棘轮**（只许下调，≥5% 余量）

---

## 7. 共同点（这才是最值得注意的）

尽管架构与治理模型差异巨大，两者在**价值观层高度一致**：

1. **都要"机器可检查"，不要"靠自觉"**
   dsh：每条约定配 exit 非零命令。
   ZCode：架构边界写成 YAML + 检查器 + pre-push 拦截。

2. **都强制"事前"，不止"事后"**
   dsh：spec/笔记与实现同 PR；ZCode：SKILL.md 明说"让检查器确认一个决定，而不是第一次发现它"。

3. **都诚实标注能力边界**
   dsh：`inactive does not describe task completion`；沙箱只管文件不管网络。
   ZCode：`status: success` 只表示消息被接受；零违规只代表已启用规则没报错。

4. **都拒绝"会失效的防线"**
   dsh："False mutual exclusion is more dangerous than an explicit warning."
   ZCode：明知无 OS 沙箱就不加启发式检查，避免"制造已建立安全边界的错误认知"。

5. **都有棘轮**
   dsh：文档字数上限只许下调。
   ZCode：架构 baseline 用 sha256 指纹，当前为空 = 存量清零，CI 不得自动刷新。

6. **都把 AI 当作"需要被约束的执行者"，同时不掩盖它在劳动**
   dsh："a lot of work is not a cost argument when agents do the labor."
   ZCode："必须执行 typecheck 和 lint，报告真实结果，不将已有失败写成通过。"

---

## 8. 给两类读者的启示

### 8.1 对 Agent 开发者

| 启示 | 来自 |
|---|---|
| **门禁要"事前显式化"，不只是事后拦截** | ZCode SKILL.md:8 |
| **架构规则要写成数据（YAML），不要写成散文** | ZCode `architecture-policy.yaml` |
| **例外机制必须带 reason + 过期时间** | ZCode `expires` 规则（过期即违规） |
| **数字预算比形容词有效**：400 行、12 个公开方法、lint-disable 阈值 0 | ZCode global 阈值 |
| **门禁可以顺手产出上下文**（阅读包） | ZCode `architecture:context` |
| **"不做"也要写进测试**（`not.toContain("teammate")`） | ZCode tool-contracts.test.ts:304 |
| **运行时关系断言 > 单测存在性检查** | dsh `deriveMessages` 不变式 |
| **关键抽象用两个真实现压，别用 mock** | dsh twin adapters |
| **失败要留下可复用的形状**（rejected 笔记永久保留） | dsh 14 篇 rejected |
| **公开自己的能力边界**（"零违规 ≠ 全部合规"） | ZCode governance.md:72 |

### 8.2 对普通 AI 用户

| 启示 | 来自 |
|---|---|
| **"投递成功"不等于"任务完成"** | ZCode `status: success` 只表示消息被接受；dsh `inactive` 不描述完成 |
| **"测试全绿"不等于"能用"** | dsh postmortem 0001：178 绿测试 + 100% 覆盖率，真实编辑器一连就崩 |
| **AI 可能验证的是另一个东西** | dsh postmortem 0003：验证了替换服务器，没探用户在用的端口 |
| **要关系性证据，不要存在性证据** | dsh："检查方法存在是假测试" |
| **长对话变笨是历史被删了** | dsh：到 80% 触发压缩，只剩 16% 逐字 |
| **危险操作应该单次批准，不该长期记住** | ZCode：不提供也不接受永久授权 |
| **没有沙箱时就别假装有** | ZCode 拒绝加"看起来像保护"的启发式检查 |

---

## 9. 证据与产物

| 文件 | 内容 |
|---|---|
| `docs/dsh-analysis/_zcode-governance.md` | ZCode 治理分析（2,102 行）：政策文件、ADR、门禁、门禁接线、对比表 |
| `docs/dsh-analysis/_zcode-architecture.md` | ZCode 架构分析（1,599 行）：内核外壳、会话/存储、多智能体决策、安全、原生搜索 |
| `docs/dsh-analysis/_scratch-dsh-governance.md` | dsh 治理分析（前一批，2,102 行） |
| `docs/dsh-analysis/_scratch-dsh-architecture.md` | dsh 架构分析（前一批，1,194 行） |
| `docs/article-dsh-discipline.md` | 已发布的 dsh 单篇公众号文章 |
| `docs/article-dsh-vs-zcode.md` | 本文对应的公众号对比文章 |

### 复核修正记录

子代理结论经 Lead 独立复核，修正如下：

| 子代理结论 | 复核结果 |
|---|---|
| ZCode "27 个模块、10 个 managed" | **25 个模块、9 个 managed**（YAML 权威解析） |
| dsh "69 个门禁" | 69 个 `verify-*` **文件** = 42 门禁本体 + 27 `.spec.ts` 自检 |
| dsh "ADR 0007" | 不存在 ADR 体系，实为 Agent Note |
| ZCode `docs/` "1,866 文档" | 含第三方文档站源码；**自写平铺文档 273 篇** |
| ZCode 无 CI 配置 | 已核实：无 `.github/workflows`／`.gitlab-ci.yml`／`.cnb.yml` → **不能断言架构检查真在 CI 阻断**，只能引治理文档作为意图证据 |

### 置信度

- **架构与治理的静态事实**：高。所有关键结论都有 `path:line` 或逐字引文，关键项经 Lead 二次复核（沙箱零命中、teammate 断言、policy 解析、drift 确认）。
- **"演化因果"类结论**：dsh 可用（19,520 提交 + 4 postmortem），**ZCode 不可用**（4 个压平提交）。
- **"门禁是否真的开过火"**：两边都**未验证**。ZCode 无 CI 配置可查，dsh 未审计门禁历史失败率。这正是前一篇对博客分析提出的同一条批评——本文同样未能完成，如实标注。
