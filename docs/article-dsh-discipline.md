<!--
使用说明（发布前删除本注释）：
1. 五张 SVG 均为 width=330，按手机正文区设计，1:1 呈现不缩放不裁切；
   纯展示属性、无 class、无 <style>；整个 <svg> 压成单行。
2. 事实来源：deepseek-harness 公开仓库 master（HEAD 2026-09-22，19,520 次提交，
   首个提交 2026-06-10）。所有机制、数字、引文均取自仓库源码、Agent Note 与
   postmortem 原文，无推测补充；引用处标注了文件路径。
3. 粘贴用 mdnice / 135编辑器 等支持内联 SVG 的工具；若编辑器剥 SVG，
   可把每张 <svg> 单独存成 .svg 经素材库转图上传。
-->

# 一个由 AI 写代码的项目，把"管住 AI"写成了代码

> 附 Z.ai 的 ZCode 对照组：同一个问题，两套相反的答案

DeepSeek 的 agent harness（下称 dsh）把仓库开源了。我把它拉下来翻了一遍——19,520 次提交、1,179 篇决策笔记、42 个自动门禁、13 个给 AI 自己用的技能。

但有价值的不是这些数字。有价值的是：**这是一个主要由 AI 写代码的项目，而它把"怎么管住 AI"这件事，本身也写成了代码和脚本。**

下面所有机制与引文都来自仓库源码与文档原文，没有推测性补充。后半篇还会拉上 Z.ai 的同类产品 **ZCode** 做对照——它面对同一个问题，答案几乎处处相反。

**TLDR：**

- **对 AI 用户**：AI 说"我测过了"可能测的是**另一个东西**——仓库里有一份事故报告，AI 改了界面却去验证自己新起的一台"替换服务器"，而用户真正在用的页面它从头到尾没探过，然后报告成功
- **对 AI 用户**：同一批事故里还有一份是 **178 个测试全绿 + 100% 覆盖率，真实编辑器一连就崩**。原文——"覆盖率只证明那些行跑过，完全不说明这个功能是否按它发运的方式工作"
- **对 AI 用户**：长对话变笨不是走神，是**历史真被删了**——用量到 80% 触发压缩，只有最近 16% 逐字保留，更早的压成一条摘要
- **对 Agent 开发者**：规则要编译成脚本。原文——"代理对强制门禁的遵从远高于对散文约定的遵从；当代理承担劳动时，'工作量很大'不构成成本论据"
- **对 Agent 开发者**：决策记录强制写"放弃了什么"。原文——"一份没记录它打败了什么的决策，会招来 Agent Note 本来要防止的反复争论"；14 篇被否决的提案被永久保留
- **对照组**：ZCode 走了另一条路——把架构写成可校验的 YAML 政策（连"domain 层不许碰 IO"都能机械检查），并对"我们决定不做多智能体团队"这件事**写了测试断言来防止被加回来**

## 01｜先看清这是什么项目

dsh 是 DeepSeek 开源的 agent harness——一个"什么都是插件"的运行时（57 个顶层包，从模型适配器到沙箱到 UI 全是插件）。2026-06-10 建仓，到我看的这版 HEAD（2026-09-22）已经 19,520 次提交。

它最特别的地方不是功能表，是仓库里有一套**给 AI 看的纪律体系**，而且这套体系是被机器强制的。

它的架构声明也很直白（`docs/architecture.md`）——**"没有特权内核可供打补丁"**：

> Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so each is replaceable from configuration.
>
> There is no privileged core to patch: you extend dsh by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads.

而且这条声明是可核对的，不是口号。我数了 `packages/*/*/package.json`：整个仓库里**只有 2 个包**在运行时依赖 agent-loop，且这两个都是"bundle"（组装档，职责就是把这个运行时装进一棵可打补丁的树）；另有 47 个包**只在 devDependencies 里**引用它（测试用）。也就是说——**能力插件不 import 循环本体，控制反转走事件。**

配套的还有一张"新行为该放哪"的对照表（`docs/architecture.md`，20 行 Goal → Mechanism），它把"改哪里"从判断题变成查表题：

<svg width="330" height="486" viewBox="0 0 330 486" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"><text x="165" y="30" font-size="15.5" font-weight="bold" fill="#0f172a" text-anchor="middle">"新行为放哪"是一张查表题</text><text x="165" y="52" font-size="11" fill="#64748b" text-anchor="middle">docs/architecture.md 的 20 行对照表（节选）</text><rect x="14" y="70" width="302" height="62" rx="10" fill="#eef2ff" stroke="#c7d2fe" stroke-width="1.3"/><text x="30" y="93" font-size="11.5" font-weight="bold" fill="#1e3a8a">加一个模型提供方</text><text x="30" y="114" font-size="10.5" fill="#475569" font-family="'SF Mono',Menlo,Consolas,monospace">register adapter on ctx.llm</text><rect x="14" y="144" width="302" height="62" rx="10" fill="#f0fdf4" stroke="#86efac" stroke-width="1.3"/><text x="30" y="167" font-size="11.5" font-weight="bold" fill="#166534">加一个模型可见能力</text><text x="30" y="188" font-size="10.5" fill="#475569" font-family="'SF Mono',Menlo,Consolas,monospace">register on ctx.tools</text><rect x="14" y="218" width="302" height="62" rx="10" fill="#fff7ed" stroke="#fdba74" stroke-width="1.3"/><text x="30" y="241" font-size="11.5" font-weight="bold" fill="#9a3412">拦截请求 / 工具 / 轮次</text><text x="30" y="262" font-size="10.5" fill="#475569" font-family="'SF Mono',Menlo,Consolas,monospace">use its agent/* or tools/* event</text><rect x="14" y="292" width="302" height="62" rx="10" fill="#faf5ff" stroke="#d8b4fe" stroke-width="1.3"/><text x="30" y="315" font-size="11.5" font-weight="bold" fill="#6b21a8">加持久会话状态</text><text x="30" y="336" font-size="10.5" fill="#475569" font-family="'SF Mono',Menlo,Consolas,monospace">extend SessionEventMap; replay from log</text><rect x="14" y="366" width="302" height="62" rx="10" fill="#fef2f2" stroke="#fecaca" stroke-width="1.3"/><text x="30" y="389" font-size="11.5" font-weight="bold" fill="#991b1b">换一个会话存储后端</text><text x="30" y="410" font-size="10.5" fill="#475569" font-family="'SF Mono',Menlo,Consolas,monospace">implement SessionPersistence</text><text x="165" y="452" font-size="10.5" fill="#64748b" text-anchor="middle">核心只有一句：拦截靠事件，不靠在循环里加分支</text><text x="165" y="470" font-size="10.5" fill="#64748b" text-anchor="middle">这张表本身也被门禁维护——改循环就得同步改表</text></svg>

**这张表最重要的不是那 20 行，而是它的哲学：拦截靠事件，不靠在循环里加分支。** 所以重试逻辑是一个挂在 `agent/request-error` 上的插件，而不是循环里的一个 `if`——它"不引入任何服务，也不给循环加分支"。

顺便先纠正一个广泛流传的说法：网上不少解读把它的关键决策文件称作"ADR 0007""ADR 0009"。**这个仓库里没有 ADR 编号体系**——`docs/adr/` 目录不存在，全仓库也没有任何编号 ADR。那两份文件真身是 **Agent Note**，路径即状态、不带编号：所谓"0007"是 `.agents/notes/implemented/process/2026-06-11-quality-gates.md`，所谓"0009"是 `2026-06-13-capability-seams.md`。仓库从 ADR/RFC 体系迁移过来的痕迹还留在门禁里——`scripts/verify-agent-note-format.ts` 至今把 `XXX: legacy ADR/RFC body format` 列为必须清除的遗留标记。

<svg width="330" height="470" viewBox="0 0 330 470" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"><text x="165" y="30" font-size="16" font-weight="bold" fill="#0f172a" text-anchor="middle">三层纪律，同一套规则的三种形态</text><text x="165" y="52" font-size="11" fill="#64748b" text-anchor="middle">从"写得好看"到"绕不过去"</text><rect x="14" y="70" width="302" height="106" rx="12" fill="#eef2ff" stroke="#4d6bfe" stroke-width="1.5"/><text x="30" y="94" font-size="13.5" font-weight="bold" fill="#1e3a8a">① 门禁：机器强制</text><text x="30" y="116" font-size="11" fill="#334155">69 个 verify-* 文件 = 42 个门禁本体</text><text x="30" y="136" font-size="11" fill="#334155">CI 跑全集；钩子只留廉价本地缺陷</text><text x="30" y="156" font-size="11" fill="#475569">AI 绕不过去——exit 非零就是失败</text><rect x="14" y="188" width="302" height="106" rx="12" fill="#f0fdf4" stroke="#86efac" stroke-width="1.5"/><text x="30" y="212" font-size="13.5" font-weight="bold" fill="#166534">② 技能：代理内化</text><text x="30" y="234" font-size="11" fill="#334155">13 个 .agents/skills/*/SKILL.md</text><text x="30" y="254" font-size="11" fill="#334155">高频工作流的判断标准</text><text x="30" y="274" font-size="11" fill="#475569">如 dsh-code-review、dsh-trim-cot-leakage</text><rect x="14" y="306" width="302" height="106" rx="12" fill="#fff7ed" stroke="#fdba74" stroke-width="1.5"/><text x="30" y="330" font-size="13.5" font-weight="bold" fill="#9a3412">③ 决策记录：有生命周期</text><text x="30" y="352" font-size="11" fill="#334155">1,179 篇 Agent Note 四态流转</text><text x="30" y="372" font-size="11" fill="#334155">proposed → implemented → archived</text><text x="30" y="392" font-size="11" fill="#475569">rejected 也保留：防止重新踩坑</text><text x="165" y="438" font-size="10.5" fill="#64748b" text-anchor="middle">规则写成 README 没人执行；写成脚本才执行</text><text x="165" y="456" font-size="10.5" fill="#64748b" text-anchor="middle">三层同时存在，是这套体系的地基</text></svg>

这套体系的核心判断写在 `.agents/notes/implemented/process/2026-06-11-quality-gates.md`。它的标题是《Mechanical quality gates over prose guidelines》，问题段原文：

> This codebase is developed primarily by coding agents. Agents follow enforced gates far more reliably than prose conventions, and "a lot of work" is not a cost argument when agents do the labor.

翻译过来是两句话：**代理对强制门禁的遵从远高于对散文约定的遵从**；而且**当代理承担劳动时，"工作量很大"不构成成本论据**。后半句尤其关键——它取消了人类团队最常用的那条拒绝理由。

同一篇里还有一句，是整套体系的施工图纸：

> Every mechanically checkable AGENTS.md promise gets a command that exits non-zero.

**每一句"机制上可检查"的约定，都要配一条 exit 非零的命令。**

## 02｜给 AI 用户的第一个教训：AI 说"测过了"，可能测的是别的东西

这个仓库有四份 postmortem（事故复盘），每一份都催生了一道新的自动门禁。其中 0003 值得所有用 AI 的人读一遍。

事故原文摘要（`docs/postmortem/0003-web-agent-gui-feedback-loop.md`）：

> A Web agent changed the GUI source but did not know which URL and process hosted its session. It delegated acceptance to the user, then treated a bare Vite HTTP 200 as success despite a missing `window.__DSH_BOOT__` white screen, and finally validated a replacement `dsh web` server on another port while the original page had already picked up rebuilt artifacts.

连起来是三步错：把验收**推回给用户**；拿一个"裸 Vite 返回 HTTP 200"当成功，而浏览器实际是**白屏**；最后**去验证了一台自己新起的替换服务器**——而用户真正在用的那个页面，它从头到尾没探过。

报告里有一句判断特别冷：

> The resulting actions were individually plausible but did not share one acceptance target.

**每一个动作单独看都合理，但它们不共享同一个验收目标。** 这就是 AI 说"我测过了没问题"时最危险的情形——它不是撒谎，是测了另一个东西。

修复方式同样有启发：让"当前 URL 和运行模式"**对模型可见**，并且启动裸 Vite 直接在配置阶段就被拒绝。也就是说，**把"你现在到底在服务哪个东西"变成模型的输入**，而不是靠它自己猜。

而这份事故报告本身还有一个更妙的细节——**它的证据来源，是 dsh 自己的会话事件日志。** 报告原文写道，证据是会话 `session-3eb796c2-…` 的持久化事件日志，并且逐个点名了序号：把验收推给用户是 seq 30939，起裸 Vite 是 31865，起替换服务器是 34309，只探替换服务器是 34441，第一次去探真正的 3081 端口是 34681。

报告还特意说明：**时间线依据这些事件，而不是从后来的汇报里反推意图。**

这就是前面那条"模型看到的东西必须可推导"原则的回报——**事故复盘不用靠回忆，可以靠重放。** 一条为可信性设计的不变式，最后变成了审计工具。

另一份 0001 更直接地打击了"测试全绿"这个信号（`docs/postmortem/0001-acp-default-export-drops-inject.md`）：

> The bridge was completely non-functional in production despite 178 green unit tests and 100% line coverage.

178 个单元测试全过、行覆盖率 100%，真实编辑器（Zed）一连就崩。根因是一行 `export default apply` 让插件加载器丢掉了 `inject`——**而所有测试都用手工挂载的路径，绕过了真实加载路径。**

报告里有一句可以直接贴在任何一个"覆盖率达标"的看板上：

> Coverage proves lines *ran*; it says nothing about whether the feature works *the way it ships*.

**覆盖率只证明那些行跑过，完全不说明这个功能是否按它发运的方式工作。**

而四份事故复盘读下来，其实是**同一种病**：测试是绿的，真实路径是死的。

<svg width="330" height="452" viewBox="0 0 330 452" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"><text x="165" y="30" font-size="15.5" font-weight="bold" fill="#0f172a" text-anchor="middle">四份事故，同一种病</text><text x="165" y="52" font-size="11" fill="#64748b" text-anchor="middle">测试全绿，真实路径是死的</text><rect x="14" y="70" width="302" height="80" rx="10" fill="#fef2f2" stroke="#fecaca" stroke-width="1.3"/><text x="30" y="94" font-size="12" font-weight="bold" fill="#991b1b">0001 · ACP 编辑器一连就崩</text><text x="30" y="114" font-size="10.5" fill="#7f1d1d">178 绿测试 + 100% 行覆盖率</text><text x="30" y="134" font-size="10.5" fill="#b91c1c">→ 门禁：产品可见插件须有真实组合测试</text><rect x="14" y="158" width="302" height="80" rx="10" fill="#fff7ed" stroke="#fdba74" stroke-width="1.3"/><text x="30" y="182" font-size="12" font-weight="bold" fill="#9a3412">0002 · 文件系统工具永久禁用</text><text x="30" y="202" font-size="10.5" fill="#7c2d12">快照"通过"，因为它重放了同一个 bug</text><text x="30" y="222" font-size="10.5" fill="#c2410c">→ 门禁：拒绝配置表达式节点 + 快照语义断言</text><rect x="14" y="246" width="302" height="80" rx="10" fill="#f0fdf4" stroke="#86efac" stroke-width="1.3"/><text x="30" y="270" font-size="12" font-weight="bold" fill="#166534">0003 · 验证了替换服务器</text><text x="30" y="290" font-size="10.5" fill="#14532d">构建成功 + HTTP 200，但用户看到白屏</text><text x="30" y="310" font-size="10.5" fill="#15803d">→ 门禁：当前 URL 与运行模式须对模型可见</text><rect x="14" y="334" width="302" height="80" rx="10" fill="#faf5ff" stroke="#d8b4fe" stroke-width="1.3"/><text x="30" y="358" font-size="12" font-weight="bold" fill="#6b21a8">0004 · 子进程失败被误判为沙箱故障</text><text x="30" y="378" font-size="10.5" fill="#581c87">内核相关的测试自己跳过，从未真跑</text><text x="30" y="398" font-size="10.5" fill="#7e22ce">→ 门禁：状态门控的失败分类器</text><text x="165" y="438" font-size="10.5" fill="#64748b" text-anchor="middle">四次都产出"机械门禁"，没有一次产出"注意事项"</text></svg>

这四份报告最有价值的地方是它们**只用机械门禁收尾，从不写成一句"下次注意"**。0002 的教训甚至直接点名了这种自欺：

> A snapshot refresh is fixture production, not correctness review.

**刷新快照是在生产测试数据，不是在评审正确性。**

0001 的教训则是一句通用方法论：

> Trust the trace, not the theory.

**相信 trace，不要相信理论。** 报告里说得很直白：那个"更优雅"的解释确实是第二个 bug，但第一个 bug 只是一行导出写错——前面几小时都花在了听起来合理但错误的推理上，最后靠一个 `console.error` 的 fiber walk 几分钟就找到了。

## 03｜第二个教训：检查"存在"是假验证

仓库里有一条被反复引用的判断，出自 2026-07-19 的 Agent Note：**检查"插件名存在、方法存在"是假测试**——TypeScript 和加载测试早就保证了这些；真正有价值的是**跨时间或跨可变数据的观测关系**。

这条原则被真的写成了运行时代码。`packages/core/agent-loop/src/invariant.ts` 里装了一个监听器，挂在每一次模型请求分发上，断言：

```ts
const expected = session.deriveMessages()
if (JSON.stringify(options.messages) !== JSON.stringify(expected)) {
  fail(`llm request for session "${String(session.id)}" diverges
        from the dispatch-time durable derivation (log-reconstruction desync)`)
}
```

用一句话说：**模型看到的东西，必须能由会话日志重新推导出来。** 不是检查某个字段有没有，而是检查两个来路不同的东西是否一致——任何一个插件绕道拼请求，当场炸。

源码里还有一句注释解释了为什么要 `prepend` 注册：

> Prepend prevents a short-circuiting replay listener from silencing the check.

**先注册，防止别的监听器短路掉这个检查。** 连"检查本身被绕过"都考虑到了。

有意思的是，这套机制还有一条反向纪律（`packages/AGENTS.md`）：**只有"会发散的观测关系"才配拥有不变量**。没有这类关系的包必须在 README 里写明"本包不发布 runtime invariant companion"并给出本包专属理由。实测 290 个包里有 38 个带 `invariant.ts`——**这是一条条件性纪律，不是"每个包都写一个"。** 检查写多了和写少了都是病。

对普通用户的可操作版本是：**别问 AI"你做了吗"，问它"你观察到什么、和什么对上了"。** "测试通过"是存在性证据；"我重新读取了 X，它现在等于 Y"才是关系性证据。

## 04｜给 Agent 开发者的第一课：把规则编译成脚本

回到那句核心判断——AI 遵从强制门禁远高于遵从散文约定。dsh 把它落成了 69 个 `scripts/verify-*` 文件（其中 42 个是门禁实现、27 个是它们自己的测试，另有 61 条 `verify-*` npm 脚本，由一个 `run-gates.ts` 聚合成 18 组）。挑几个最有代表性的：

<svg width="330" height="452" viewBox="0 0 330 452" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"><text x="165" y="30" font-size="16" font-weight="bold" fill="#0f172a" text-anchor="middle">把"约定"变成"exit 非零"</text><text x="165" y="52" font-size="11" fill="#64748b" text-anchor="middle">42 个门禁本体里最能迁移的几个</text><rect x="14" y="70" width="302" height="82" rx="10" fill="#eef2ff" stroke="#c7d2fe" stroke-width="1.3"/><text x="30" y="94" font-size="12.5" font-weight="bold" fill="#1e3a8a">文档字数预算</text><text x="30" y="114" font-size="10.5" fill="#334155" font-family="'SF Mono',Menlo,Consolas,monospace">verify-doc-budgets.ts</text><text x="30" y="134" font-size="10.5" fill="#475569">上限只许下调；上调必须在 PR 里写明理由</text><rect x="14" y="164" width="302" height="82" rx="10" fill="#f0fdf4" stroke="#86efac" stroke-width="1.3"/><text x="30" y="188" font-size="12.5" font-weight="bold" fill="#166534">双语配对哈希</text><text x="30" y="208" font-size="10.5" fill="#334155" font-family="'SF Mono',Menlo,Consolas,monospace">verify-translation-pairing.ts</text><text x="30" y="228" font-size="10.5" fill="#475569">中英各改一边就得重录，配对不齐直接失败</text><rect x="14" y="258" width="302" height="82" rx="10" fill="#fff7ed" stroke="#fdba74" stroke-width="1.3"/><text x="30" y="282" font-size="12.5" font-weight="bold" fill="#9a3412">决策笔记格式</text><text x="30" y="302" font-size="10.5" fill="#334155" font-family="'SF Mono',Menlo,Consolas,monospace">verify-agent-note-format.ts</text><text x="30" y="322" font-size="10.5" fill="#475569">强制"放弃了什么"一节；漏写直接挂 CI</text><rect x="14" y="352" width="302" height="82" rx="10" fill="#faf5ff" stroke="#d8b4fe" stroke-width="1.3"/><text x="30" y="376" font-size="12.5" font-weight="bold" fill="#6b21a8">不变量接线</text><text x="30" y="396" font-size="10.5" fill="#334155" font-family="'SF Mono',Menlo,Consolas,monospace">verify-package-invariants.ts</text><text x="30" y="416" font-size="10.5" fill="#475569">拒绝空 installer、漏 reporter、注册名错误</text><text x="165" y="446" font-size="10.5" fill="#64748b" text-anchor="middle">"每次改动都必须"只有变成脚本才成立</text></svg>

字数预算那条特别值得抄：`verify-doc-budgets.ts` 从一份 manifest 读上限。实测八个受管文档里，`AGENTS.md` 是 1949 词 / 上限 1950，`docs/architecture.md` 是 **2410 / 2410**，`docs/cordis-primer.md` 是 **600 / 600**——**后两个已经顶格，零余量。** 而脚本头注释写着：**上限只会以至少 5% 的余量收紧；抬高任何一个上限，都必须按 `docs/AGENTS.md` 的定义给出理由。** 这是一条棘轮：**文档只会变短，想变长得先说服人。**

本地钩子则是刻意做窄的（`2026-07-22-fast-local-git-hooks.md`）：pre-commit 只做 lint 和空白检查，pre-push 只做增量 typecheck，穷尽矩阵全部交给 CI。理由是**代理已经跑过测试了，钩子别再重复**——把延迟预算留给廉价缺陷，把重活留给 CI。

## 05｜第二课：Twin 实现——用两个真实现防止契约被污染

这是全仓库我最想推荐给 Agent 开发者的技术。

问题（`2026-06-13-twin-llm-adapters.md` 原文）：一个只对着单一适配器定义的"中立词汇表"，**会把那一个实现的怪癖固化成事实标准**——等第二个提供方到来时，泄漏已经写进所有消费者。

dsh 的解法是从一开始就交付**两个真实适配器，刻意基于不同内部机制**：`dsh-llm-deepseek` 走裸 `fetch` + 仓库内翻译；`dsh-llm-pi-ai` 走第三方库。规则是：

> anything the StreamChunk vocabulary cannot express for BOTH implementations is a core-vocabulary bug.

**凡是这个词汇表无法同时表达两个实现的东西，都是核心词汇表的 bug。**

而且它明确否决了更便宜的做法——用 mock 当第二实现，理由是"mock 不会触及真实提供方的 wire 协议怪癖，证明力有限"。代价也写在明面上：适配器和带密钥 e2e 的维护量翻倍。

收益是具体的：pi-ai 那条实现暴露了裸 fetch 实现**会隐藏**的四条分歧，后来固化成了文档约定——usage 必须在 finish 之前发出、finish 之后不得再有事件、工具调用 arguments 全程保持原始 JSON 字符串、消费者必须处理两条合法错误路径。

这个手法可以推广：**凡是你要长期依赖的抽象层（协议、持久化、模型词汇），值得用两个真实实现去压它一遍。** 用 mock 压不出来。

## 06｜第三课：多智能体协作里，最贵的是"假互斥"

如果你在做多 agent 系统，这一节是全文最值得看的。dsh 有个实验特性叫 Agent Teams——把一个会话变成一支小团队：主 agent 自动成为 Lead，创建具名 teammate 委派工作，成员之间发持久消息，在共享任务板上协调。

它的文档很长，但真正反直觉的规则只有几条。

**第一条：任务所有权永不自动释放。** 原文（`packages/experimental/agent-team/README.md:205`）：

> **No automatic ownership release** — inactivity, interruption, process exit, and failed work do not release a task owner.

**不活跃、被中断、进程退出、工作失败——这四种情况都不会释放任务所有者。** 这条规则违反几乎所有分布式系统的直觉（心跳超时就该回收），但它是有意的：进程崩了不代表它没在做那件事，自动回收会让另一个 agent 接手同一份工作。

**第二条，也是我最想推荐的一句设计判断**，出自 Agent Teams 的决策笔记——他们明确**拒绝**把任务所有权或 writeScopes 当锁用：

> Rejected because external writers bypass them, crashed owners remain durable, and path-prefix overlap cannot prove semantic independence. **False mutual exclusion is more dangerous than an explicit warning.**

**虚假的互斥比一个明确的警告更危险。** 路径前缀重叠证明不了语义独立——所以宁可告诉你"这里可能撞"，也不要给你一个会失效的锁。这条判断可以直接搬进任何多 agent 编排器的设计评审。

**第三条：身份是永久的。** 名字小写 kebab-case，**创建失败的名字也占着，绝不复用**——设计上宁可让失败保持可见，也不静默回收身份。（它同时是崩溃恢复的关联键：拿名字才能对上恢复后的会话。）

还有一条对使用者友好但容易被忽略的语义（`tool-agent-team/README.md:64`）：

> `inactive` means no turn is executing…; it does not describe task completion or outcome

**"不活跃"只表示没有轮次在执行，不表示任务完成了、成功了、失败了或在等别人。** 这句话在三处文档重复，而且**有一条测试把它钉在 schema 上**——防止未来的模型或开发者把它误读成"干完了"。

顺带一个值得玩味的取舍：Agent Teams **默认不启用**。理由不是没做完，而是——**主动委派会给简单任务增加延迟和 token 成本**。所以它选择让用户显式开启。

## 07｜第四课：把"为什么"和"放弃了什么"变成有生命周期的资产

1,179 篇 Agent Note，路径即状态：`{lifecycle}/{class}/yyyy-mm-dd-topic.md`。生命周期有三个**活跃**状态，外加一个冻结归档区：

- **proposed/**（39 篇）：提案，还没做
- **implemented/**（484 篇）：决策已落地，**且必须随代码同步更新事实**（改了文件名、包名、默认值，同一次改动里就得改）
- **rejected/**（14 篇）：提案被否——**只在理由仍能阻止一个诱人的错误时保留**
- **archived/**（640 篇）：**单独的冻结树**，不接收 `proposed`，三元组整体封存，**永不编辑**——门禁甚至会跳过归档文档的外链检查

归档标准写得很硬（`.agents/notes/README.md`）：

> Use the calibrated `dsh-archive-agent-notes` workflow rather than word count, age, or a target quota.

**用校准过的工作流判断，不看字数、不看年龄、不设配额。** 并且明确禁止造一份中心索引目录。

而"强制写 Alternatives considered（考虑过什么）"的理由，是全仓库最漂亮的一句话：

> a decision recorded without what it beat invites the re-litigation Agent Notes exist to prevent.

**一份没记录它打败了什么的决策，会招来 Agent Note 本来要防止的反复争论。**

还有一条关于诚实的纪律：如果一篇老笔记的"备选方案"今天已经无法还原，**不许编**——必须永久带上 `alternatives-not-recorded` 标记：

> an honest gap on the record rather than fabricated rationale.

**宁可留下一个诚实的空白，也不编造理由。** 这句话值得每个用 AI 写文档的人抄下来。

## 08｜被否决的提案，为什么也留着

14 篇 rejected 是这套系统里最少被注意、也最有意思的部分。看一篇真实的开头：

> **Status: rejected** — `step/end` is the durable indication that a model step finished, and keeping the symmetric `step/start` / `step/end` pair makes crash repair, invariants, and transcript inspection clearer than inferring completion from adjacent step-scoped events.

正文里写着"这是一个看起来合理的简化：每个 step 事件本来就带 `{turn, step}`，边界事件显得多余"。然后逐条给出为什么不行：谁能判断一次模型请求是"结束了"还是"崩了"；崩溃修复怎么办。

另一篇更狠——一份全仓库"重复造轮子"审计（十个并行子代理，覆盖每个包组）的**负面结论**被整篇冻结，理由是："这些否定的判决同样有价值，但否则只会活在某个 PR 描述里。" 每个条目还附了一句通用威慑：

> a future proposal for any item must beat its recorded reason, not just re-cite the policy.

**未来想再提这一条，必须先打败记录在案的理由，而不是重新引用政策。**

而且这 14 篇被否决的理由，比"再砍一刀会丢信息"丰富得多。实读下来有四种截然不同的死法：约 3 篇确实是**信息/边界损失**；**2 篇是被测量证伪**的（有人假设两个定时器实现对等，PR #679 直接把这个前提打掉了）；**2 篇是误判的"死代码"**（那个看起来没人用的 skill registry API，其实是对第三方开放的扩展路径）；还有 2 篇是被后续决策取代。

对 Agent 开发者的迁移价值很直接：**你没有义务把每个尝试做成功，但你有义务让失败留下可复用的形状。** 尤其是"否定"这种最容易随 PR 一起蒸发的信息——它把"我们试过、不行、原因是这个"从口头共识变成了下一轮迭代的输入。

## 09｜给 AI 用户的第三课：AI 写的东西有"思维泄漏"这种病

这一节对普通人最实用。仓库有个技能叫 `dsh-trim-cot-leakage`——清理"链式思维泄漏"。定义是：

> Chain-of-thought leakage is prose whose vantage is the authoring session rather than the repository: it cites artifacts only that session could see, narrates the change instead of the state, or argues with a reviewer who has left.

**视角属于"写作那次会话"而不是"仓库"的文本**——引用了只有那次会话能看到的材料、叙述"改动过程"而不是"当前状态"、或者跟一个**已经离开的审查者**辩论。

判定只有一个问题：

> could a reader at HEAD, with no access to any session transcript, PR thread, or uncommitted draft, resolve every reference and verify every claim?

**一个只拿到当前版本的人，无法访问任何会话记录、PR 讨论、未提交草稿，能不能解析你所有的引用、验证你所有的断言？**

它把泄漏分成 8 类，我挑出普通人最容易撞见的四类：

<svg width="330" height="470" viewBox="0 0 330 470" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"><text x="165" y="30" font-size="15.5" font-weight="bold" fill="#0f172a" text-anchor="middle">AI 文本的四种"思维泄漏"</text><text x="165" y="52" font-size="11" fill="#64748b" text-anchor="middle">看起来像成品，实际是思考过程的外溢</text><rect x="14" y="70" width="302" height="86" rx="10" fill="#fef2f2" stroke="#fecaca" stroke-width="1.3"/><text x="30" y="94" font-size="12.5" font-weight="bold" fill="#991b1b">① 死引用</text><text x="30" y="114" font-size="10.5" fill="#7f1d1d">"（决策 7）" "（审计 C2）" "设计 §4.7"</text><text x="30" y="134" font-size="10.5" fill="#b91c1c">指向一份只有那次会话见过的草稿</text><rect x="14" y="168" width="302" height="86" rx="10" fill="#fff7ed" stroke="#fdba74" stroke-width="1.3"/><text x="30" y="192" font-size="12.5" font-weight="bold" fill="#9a3412">② 改动叙述</text><text x="30" y="212" font-size="10.5" fill="#7c2d12">"以前是…" "不再…" "这一版"</text><text x="30" y="232" font-size="10.5" fill="#c2410c">该说现在是什么，却在讲改了什么</text><rect x="14" y="266" width="302" height="86" rx="10" fill="#f0fdf4" stroke="#86efac" stroke-width="1.3"/><text x="30" y="290" font-size="12.5" font-weight="bold" fill="#166534">③ 跟审查者辩论</text><text x="30" y="310" font-size="10.5" fill="#14532d">"评审时被否决" "这个转换是安全的"</text><text x="30" y="330" font-size="10.5" fill="#15803d">注释在向一个不在场的人自证正确</text><rect x="14" y="364" width="302" height="86" rx="10" fill="#faf5ff" stroke="#d8b4fe" stroke-width="1.3"/><text x="30" y="388" font-size="12.5" font-weight="bold" fill="#6b21a8">④ 保险话与规划残留</text><text x="30" y="408" font-size="10.5" fill="#581c87">"目前大概够用" "应该没问题"</text><text x="30" y="428" font-size="10.5" fill="#7e22ce">含糊的不确定性，没有变成明确的边界</text></svg>

用法：**把那个"只问一个问题"当成验收 AI 输出的通用筛子。** AI 交给你一段文档、一段说明、一份总结时，问自己：一个只看到成品、看不到我们对话的人，能不能读懂？如果里面全是"刚才那个方案""按你说的改了"，那就是思维泄漏——**要求它重写成能独立成立的版本。**

同样的标准也被用在他们自己的 API 文档上：包 README 必须区分"给模型看的合同"和"给维护者看的实现"，模型可见的文本要**逐字固定**并用快照覆盖（`packages/AGENTS.md`）。

## 10｜长对话为什么会变笨：它不是走神，是被删了

这一条对普通用户最实用，而且答案比想象的机械。

dsh 的压缩（compaction）策略有明确数字（`packages/compaction/compaction-basic/README.md`）：当上下文用量到达窗口的 **80%**（`thresholdRatio: 0.8`）时触发压缩；压缩后**只有最近 16%**（`retainRatio: 0.16`）逐字保留，更早的部分被**压成一条摘要消息**。

也就是说，长对话里 AI 不是"注意力涣散"——**它的早期历史被真实地替换成了一段摘要**。原文机制描述是：把更早的历史压缩成一条摘要、保留近期对话、然后像那条摘要一直都在一样继续（而且被遮盖的内容仍留在日志里，重放能确定性地复现同一段压缩后的对话）。

对照用户直觉，这里有个很实在的结论：**跟一个超长对话较劲，不如开新对话把关键结论复述一遍。** 因为你在长对话里补的每一句话，最终都要先挤过"80% 触发、只剩 16% 逐字"这道闸门。

还有一个安全向的细节值得所有用「多智能体」产品的人知道。dsh 规定：**被委派出去的子代理，权限在委派那一刻就钉死**（`.agents/notes/implemented/feature/2026-08-10-subagent-approval-pinned-never.md`）。原文说：子代理的审批策略被直接钉成 `never`——**它不再读取父会话自己的审批策略**——而且这条策略作为持久事件写进子代理自己的日志，冷启动重放也覆盖不掉。

理由写得很清楚：**子代理的整个权限故事就是它的沙箱范围**；需要提权时，决定权永远留在父会话那边（先给父会话提权，再委派或追问）。

翻成用户语言：**AI 把活儿转包给另一个 AI 时，转包出去的权限不应该悄悄变大。** 遇到"我让一个子代理去处理"的产品，这是一个值得问的问题。

## 11｜对照组：Z.ai 的 ZCode 选了另一条路

只讲一个项目容易以为"这就是标准答案"。我把 Z.ai 开源的同类产品 ZCode 也拉下来分析了一遍——**它面对同一个问题，给出的答案几乎处处相反。**

先说一个方法学前提，这一条很重要：**ZCode 仓库只有 4 个提交**，是压平导入的。所以对它可以讲"现在是什么样"，**不能讲"怎么变成这样"**。下面全是静态事实。

<svg width="330" height="478" viewBox="0 0 330 478" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"><text x="165" y="30" font-size="15.5" font-weight="bold" fill="#0f172a" text-anchor="middle">同一个问题，两套相反的答案</text><text x="165" y="52" font-size="11" fill="#64748b" text-anchor="middle">dsh 与 ZCode 的治理路线对照</text><rect x="14" y="68" width="302" height="62" rx="10" fill="#eef2ff" stroke="#c7d2fe" stroke-width="1.3"/><text x="30" y="91" font-size="11.5" font-weight="bold" fill="#1e3a8a">门禁：42 个脚本 vs 1 份架构政策</text><text x="30" y="112" font-size="10.5" fill="#475569">dsh 逐条约定配脚本；ZCode 写 YAML 规则</text><rect x="14" y="140" width="302" height="62" rx="10" fill="#f0fdf4" stroke="#86efac" stroke-width="1.3"/><text x="30" y="163" font-size="11.5" font-weight="bold" fill="#166534">规则长度：1949 词 vs 357 词</text><text x="30" y="184" font-size="10.5" fill="#475569">dsh 是自包含手册；ZCode 是路由表</text><rect x="14" y="212" width="302" height="62" rx="10" fill="#fff7ed" stroke="#fdba74" stroke-width="1.3"/><text x="30" y="235" font-size="11.5" font-weight="bold" fill="#9a3412">多智能体：做 vs 明确不做</text><text x="30" y="256" font-size="10.5" fill="#475569">ZCode 有测试断言"不许出现 teammate"</text><rect x="14" y="284" width="302" height="62" rx="10" fill="#faf5ff" stroke="#d8b4fe" stroke-width="1.3"/><text x="30" y="307" font-size="11.5" font-weight="bold" fill="#6b21a8">会话：只追加日志 vs SQLite</text><text x="30" y="328" font-size="10.5" fill="#475569">一个赌"可推导"，一个赌"可检索"</text><rect x="14" y="356" width="302" height="62" rx="10" fill="#fef2f2" stroke="#fecaca" stroke-width="1.3"/><text x="30" y="379" font-size="11.5" font-weight="bold" fill="#991b1b">文档：有字数门禁 vs 零门禁</text><text x="30" y="400" font-size="10.5" fill="#475569">dsh 用脚本管文档；ZCode 靠文字自律</text><text x="165" y="444" font-size="10.5" fill="#64748b" text-anchor="middle">两边都不是标准答案，是各自长成了自己的形状</text><text x="165" y="462" font-size="10.5" fill="#64748b" text-anchor="middle">但价值观层高度一致——见下一节</text></svg>

### ZCode 最值得看的一手：把架构写成可校验的政策

dsh 管的是**流程**（笔记格式、文档预算、双语配对）；ZCode 管的是**结构**。它有一份 `architecture-policy.yaml`，登记 **25 个模块**，每个模块声明自己的根目录、依赖、公开入口、分层和负责人：

```yaml
- id: storage
  roots: [packages/services/src/storage]
  managed: true
  requires: [shared, rpc, services]
  publicEntrypoints: [packages/services/src/storage/contract.ts]
  layers: { domain: domain, app: app, adapters: adapters }
  layerOrder: [domain, app, adapters]
```

配套检查器执行 **12 条规则**，其中几条特别硬：

- **`domain-io`**：domain 层**不许依赖 IO、进程、网络或定时器**（`node:` / `fs` / `path` / `http` / `child_process` / `timers` 全禁）
- **`layer-direction`**：层只能单向依赖，不许反向
- **`disable-count`**：受管模块里**写一行 `oxlint-disable` 就失败**（阈值 0）
- **`max-file-lines` 400 行**、**`max-public-methods` 12 个**
- **`expired-exception`**：例外必须写明理由，可以设过期日——**过期后自动变成违规**

这最后一条我特别喜欢：**它不是禁止例外，而是让例外自己到期。** 承认"有些地方确实得破例"，但要求破例方写下理由并接受它迟早要还。

而它对这个门禁的定位，是全篇最值得抄给 Agent 开发者的一句（`.agents/skills/architecture-governance/SKILL.md:8`）：

> It is a design guide **as well as** a gate: the goal is to make the intended architecture obvious before code is generated, so the checker **confirms a decision instead of discovering it for the first time**.

**它同时是设计指南和门禁：目的是让目标架构在代码生成之前就显式，好让检查器"确认一个决定"，而不是"第一次发现它"。**

不过 ZCode 自己也把话说得很清楚——`docs/architecture/architecture-governance.md` 原文：

> 当前 `managedOnly: true` 下的零违规仅表示已启用规则没有报错，不证明所有存量跨域依赖已通过机械检查。

**25 个模块里只有 9 个是受管状态**，其余只是"登记了但不受约束"。所以"零违规"是**在已启用范围内的零违规**。这句自我限定，是基础设施团队描述门禁效力时该有的诚实。

### 「不做」也要写进测试

ZCode **明确不做**多智能体团队——而且这不是技术欠债，是产品决策，有三重证据。最硬的一重是**测试里的断言**（`apps/zcode-cli/packages/core/tests/tool-contracts.test.ts:304`）：

```ts
expect(contract?.description).not.toContain("teammate");
```

**工具描述里不许出现"teammate"这个词。** 这条测试防的不是 bug，是**后来者（或 AI）顺手把这个功能加回来**。

**把"我们决定不做"写成机械断言，这个手法值得学。** 多少团队的"不做"只活在某次会议记录里，三个月后被一个"顺手补上"的 PR 推翻。

### 让我停一下的两处诚实

ZCode 有两句话，我读到时停了一下。

第一句，讲消息发送的语义：

> `status: "success"` 只表示消息已被 queued/steered 接受，**不表示目标 agent 已读取、接受任务或回复**。

第二句更要紧。ZCode **全仓没有 OS 级沙箱**（我 grep 过 `seatbelt` / `bwrap` / `sandbox-exec`，在源码里零命中）。它没有假装有，而是明确拒绝了"看起来像保护"的启发式检查，理由是那样**「只会制造已经建立安全边界的错误认知」**（`docs/automation-edit-status.md`）。

**明知没有沙箱，就不摆一个会让人误以为有沙箱的东西。** 这和 dsh 那句"虚假的互斥比一个明确的警告更危险"是同一个价值观。

### 价值观层：两边其实惊人地一致

架构和治理模型差这么远，但把两边的做法放在一起看，会看到一组高度一致的原则：

1. **都要"机器可检查"，不要"靠自觉"**——dsh 配 exit 非零命令；ZCode 写 YAML 政策 + pre-push 拦截
2. **都强制"事前"**——dsh 要求决策笔记与实现同 PR；ZCode 明说"让检查器确认决定，而不是第一次发现它"
3. **都诚实标注能力边界**——dsh："`inactive` 不描述任务完成"；ZCode："零违规只代表已启用规则没报错"
4. **都拒绝会失效的防线**——dsh："虚假的互斥比明确的警告更危险"；ZCode：没有沙箱就明说没有
5. **都有棘轮**——dsh 的文档字数上限只许下调；ZCode 的架构 baseline 用 sha256 指纹、**CI 不得自动刷新**
6. **都把 AI 当需要被约束的执行者，同时不掩盖它在劳动**——dsh："当代理承担劳动时，'工作量很大'不构成成本论据"；ZCode："报告真实结果，不将已有失败写成通过"

**这两个项目没有互相抄。它们是从同一个前提出发、长出两套形状。** 而那个前提是：**执行者不可靠，但你也不能靠喊口号来约束它。**

### 一个两边都有的瑕疵

我的子代理在 ZCode 里发现了一处**治理漂移**：`architecture-policy.yaml` 把 `packages/services/src/session/contract.ts` 声明为公开入口，**而那个文件不存在**。

而 dsh 也有一处类似的：根 `AGENTS.md` 至今写着"SQLite 使用单调 SCHEMA_VERSION"，但 **SQLite 持久化后端早已被删除**（提交 `4553c9d957`）。

**两边都有"治理声明 vs 实际状态"的偏差。** dsh 的是过期文档，ZCode 的是未接线的机制（比如某个审计脚本备了两个旋钮，但调用时没传参，实际是纯报告模式）。

这说明一件事：**治理体系本身也需要被治理，而两边都还没做到。** 我把这一节留在文章里，因为它是对我自己前面所有赞美的一个必要的对冲——**门禁存在不等于门禁开过火**，这一点我在分析另一个项目时批评过，在这里同样适用。

## 12｜两边都该记住的元教训

如果把前面所有机制压成一条，我会选这条：

**不要相信"我检查过了"，要相信"检查这件事被写成了脚本"。**

dsh 仓库里最一致的做法是：**任何一句"我们必须……"，都要配一条 exit 非零的命令。** 而这几十条门禁不是一次性设计的——四份事故复盘各催生了一批，被否决的提案反向固化了边界，字数上限只许往下走。**这套纪律是长出来的，不是设计出来的。**

对 AI 用户，可操作的版本是三条：

1. **要关系，不要存在。** 不问"你做了吗"，问"你观察到了什么，和什么一致"
2. **要目标明确的验收。** 问"你在哪个 URL / 哪个文件 / 哪个进程上验的"——AI 很擅长验证一个自己没有意识到的替代品
3. **警惕思维泄漏。** 交出来的东西能不能脱离对话独立成立

对 Agent 开发者，也是三条：

1. **把规则编译成脚本。** 散文约定会被忽略，exit 非零不会
2. **给关键抽象配 twin 真实现。** mock 压不出真实协议怪癖
3. **让失败留下形状。** 被否决的提案、事故复盘、强制填写的"放弃了什么"——这些是唯一能让下一个 AI 不重蹈覆辙的东西

最后一句留给这个仓库自己的话。它解释为什么要给 AI 写这么严的规矩时，用的是取消借口的方式：

> "a lot of work" is not a cost argument when agents do the labor.

**当劳动由代理承担时，"工作量很大"不再是一个论据。**

这句话反过来读也成立：既然工作量不再是借口，那么**唯一剩下的借口就是"我没把它写成机制"。**

---

*本文事实与引文均取自 deepseek-harness 公开仓库（HEAD 2026-09-22，19,520 次提交），来源文件已在正文标注路径。*
