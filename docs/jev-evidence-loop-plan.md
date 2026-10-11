# Jev 证据回路与知识库补强方案（批次 E）

> 背景：2026-09-21 批次上线的 Jev 快速路由（js/assistant/jev.js）目前只做「入口一次性路由」
> （直答/预取/放行）。用户提出对齐「研究系统」思路：把复杂问题拆成可核验条件 → 主 LLM 规划与
> 取证 → Jev 一类判断模型持续检查证据相关性/支持度/遗漏/冲突 → 按具体缺口续检 → 证据充分才
> 生成带来源结论 → 用事实结果与人工反馈改进下一轮检索与判断。
> 本方案盘点现状差距，规划四个子批次（E1 知识库 → E2 直答与反馈 → E3 证据回路 → E4 实测调阈）。

## §0 结论摘要

**「能否充分使用 Jev 提速」的答案：入口侧已用好，证据侧完全没用上，可以再提速一档。**

- 现状 Jev 每条用户消息只发 **≤1 次** systemone 调用（~1.5s），产出三件事：高置信 FAQ 免主模型
  直答、建造/改码预取知识节注入首轮、闯关索答守卫。这条链路健康（有单测+烟雾）。
- 截图思路的核心——「工具循环内持续核验证据、按缺口续检、知道何时停」——现状 **零覆盖**：
  Jev 在工具结果产生后就退场了，「证据够不够」全凭主模型自觉，唯一的停止判据是
  `maxToolIterations=30`（llm.js:18）这种兜底上限。
- 知识库（js/assistant/knowledge.js，15 节）有两处**实锤漂移**和若干**缺节**（§1.3），
  直接限制直答覆盖面与回答正确性——E1 必须先做，它是 E2/E3 的地基。

## §1 现状盘点

### §1.1 Jev 现在怎么用（jev.js）

| 环节 | 实现 | 位置 |
|---|---|---|
| 入口路由请求 | 一次批量 systemone：intent(choice) + section(choice) + is_quiz_answer(noul) + 6 个建造系统 mod_*（noul fan-out） | jev.js:116-148 `buildRouteRequest` |
| 决策 | direct（faq ∧ intent≥0.8 ∧ section≥0.8）/ prefetch（章节∨模组∨本地检索注入首轮）/ none | jev.js:160-181 `decideRoute` |
| 守卫 | 疑似索要闯关答案（noul≥0.5）、闯关中 → 一律 none；失败静默降级 fail-open | jev.js:163-164, 263-285 |
| 消费 | agent.js 发送前钩子：direct 直接回知识库正文；prefetch 以 user 角色 hint 注入首轮（仅进 API 不进会话） | agent.js:72-88 |
| 可见性 | 路由卡片（动作/意图/章节/模组/耗时/失败原因，仅存 DOM 不进历史） | ui.js:846 onJevRoute |

### §1.2 知识库现状（knowledge.js）

15 节（ids/mining/world/redstone/piston/kinetic/logistics/elevator/survival/mobs/saves/modules/recipes/keys/edu），
数值与 ID 段 import 自 config.js 动态生成（不漂移），`searchKnowledge` 关键词检索，
`search_game_docs` 工具暴露给主模型。单测 tools/test_assistant_knowledge.mjs 防漂移——
但只断言「config 派生数值锚点」（8 RPM/64 SU/基址 224 等），**不覆盖手写文案**。

### §1.3 已核实的知识缺口（E1 依据）

**漂移（ actively harmful，会误导改码任务）：**

1. 纹理图集：textures.js 实际 `atlasSize = 16`（textures.js:28），tile **45..72 已占用**（注释
   「新增 28 个 tile（45..72）」）+ 教学组 77..84（keypad 77-79 / hanzi 83 / merchant 82,84）。
   而 knowledge.js recipes 节写「空闲 tile 45..63」、docs.js 系统提示词写「atlasSize=8（8×8=64 格）
   tile 0..44 已占用，45..63 空闲」——助手按此新增方块会**覆盖已占用 tile**，直接出贴图事故。
2. docs.js 模块地图旧账：`entities.js：僵尸生成与 AI`（实际已 MOB_TYPES 五种生物）、图集描述同上、
   interaction.js 缺 outline 精确求交说明。AGENTS.md 已更新但系统提示词没跟上。

**缺节（用户高频可问、助手只能整读源码或答不出）：**

3. TNT 与爆炸：半径 3.5、点燃路径（右键/红石上升沿）、苦力怕自爆复用同爆炸、闯关爆炸保护——散见
   redstone/mobs，无专节。
4. 录像与拍摄：recording.js/cameraRig.js 全套（三镜头、AI 施工自动取景跟拍、H.264+AAC 编码、
   10 分钟上限、保存上一段、跟拍 hold、R/Tab/C/[ ]/P/G 键）——keys 节只有键位一行。
5. 配乐与音效：bgm.js 四态势+风格包+文件名规则+回退、audio.js sfxBus 与录像分轨、设置页音量——零覆盖。
6. edu 节缺：奖励梯队（连对 8/5/3→传说/史诗/精良、里程碑 5/10/20/50、10% 彩蛋）、学习进度
   localStorage mcweb.edu.v1 字段结构、题库契约要点（banks.json 清单、math 权重×2）、关卡卡
   mcweb.level.v1 schema 摘要（region 上限 96×64×96、题目全量拷贝、局部坐标、双通过）。

**元数据缺失：** 章节无 `sources` 字段——「带来源的结论」没有数据基础；直答只有一句
「来自内置知识库」，没有逐节来源。

## §2 差距分析：截图六步 vs 现状

| # | 截图思路 | 现状 | 差距定性 |
|---|---|---|---|
| 1 | 拆成可核验条件，列出各条件所需证据 | 主 LLM 隐式规划，无结构化条件登记 | **缺位** → E3 条件登记工具 |
| 2 | Jev 持续检查：证据是否相关/支持条件/遗漏/冲突 | Jev 只在入口路由一次，循环内不参与 | **缺位** → E3 证据 checkpoint |
| 3 | 证据不足→按具体缺口继续检索 | 无缺口信号；模型自觉决定下一轮调什么 | **缺位** → E3 缺口提示注入 |
| 4 | 证据充分→才生成带来源结论 | 停止判据=迭代上限 30；来源标注弱 | **部分** → E3 停止门 + E1 sources |
| 5 | 完成后用事实结果改进流程 | read_blocks/get_runtime_errors 已是工作流，但结果不回流到检索策略 | **部分** → E3 checkpoint 吃工具结果 + E2 统计 |
| 6 | 人工反馈改进检索与判断 | 无任何反馈通道（路由卡片仅存 DOM） | **缺位** → E2 👍/👎 + 缺口日志 |

另有一条横向差距：**直答只能单节**。复合问题（「红石灯怎么点亮？晚上会不会刷怪？」）Jev 只选一个
章节，其余靠主模型慢路径——E2 用零成本方式补（直答并本地伴随节）。

## §3 方案

### §3.1 批次 E1：知识库补强与防漂移（纯数据+测试，先行）

1. **修漂移（root cause 治理，不是改两句话）**：textures.js 的 tiles 分配表下沉为 Node 可 import
   的纯数据模块（js/textureTiles.js 或并入 config.js，保持「常量集中」惯例）；knowledge.js/docs.js
   的图集尺寸与空闲区间文案改为**从该表动态生成**；test_assistant_knowledge.mjs 加对账断言
   （「空闲 tile」文案中的每个区间与分配表求差集核验）。
2. **新增节**：`tnt`（爆炸机制/点燃路径/苦力怕复用/闯关保护）、`media`（拍摄录像+配乐音效合一节，
   预算内装要点）。扩 `edu`（奖励梯队/进度字段/题库契约要点/关卡卡 schema 摘要，现有 ~1300 字 +
   ~800 字仍 <3000 预算）。扩 `world` 补光照细节（火把点光源/灯照不刷怪已有，补 daynight 天空要点）。
3. **加 `sources` 元数据**：每节 `sources: ['js/redstone.js','js/config.js']`（手写，轻量）；
   `formatDirectAnswer` 与 search_game_docs 返回体带出来源行。
4. **docs.js 模块地图与 AGENTS.md 对账**：entities.js 描述、图集、interaction.js outline 等。
5. 测试：新节检索命中用例、sources 全覆盖断言、tile 对账断言；目录行数=章节数断言随之更新。

### §3.2 批次 E2：直答强化 + 反馈回路

1. **复合直答（零成本版先行）**：direct 命中章节后，并上 `searchKnowledge(text, 2)` 的前 1 个
   伴随节（≠命中节且得分达门槛），合并正文受 ≤2000 字预算——复合 FAQ 也走 ~1.5s 直答。
   Jev 侧 15 节 section fan-out（多热直答）作为 **E2.5 备选 spike**：仅当合并质量不足再上
   （问题总数将达 ~34/请求，需实测 systemone 上限与延迟，见 §6 风险 1）。
2. **直答 👍/👎**：⚡ 直答消息尾加反馈按钮；👎 → 写入知识缺口日志
   （localStorage `mcAssistant.jev.gaps.v1`：query/section/时间/原因）。
3. **缺口自动记录**：intent=faq ∧ section=other ∧ 本地检索空 → 自动记缺口（无需用户点👎）。
4. **路由统计**：`mcAssistant.jev.stats.v1` 累计 direct 率/降级率/平均耗时；⚙️ Jev 卡新增一行
   统计 + 缺口计数入口（列表查看/导出 JSON/清空）——「提速」从此可度量，缺口列表直接喂 E1 式
   知识库迭代（截图第 6 步的落点）。

### §3.3 批次 E3：证据回路（核心，对齐截图第 1-4 步）

**数据流**：主 LLM 开工前登记条件 → 工具结果回来后 Jev 批判 → 缺口注入续检 → 门控收束。

1. **条件登记工具** `plan_conditions({ conditions: [{id, text}] })`（1~6 条）：系统提示词工作流
   A/B 各补一句——复杂建造/改码任务开工前先登记「可被工具输出证实/证伪」的条件
   （例：改码任务=「redstone.js 的修改不改变既有负载判定」「改动仅触及 X 文件」；建造任务=
   「地基区域已清平」「滑轮背面接有运转传动」）。工具结果回执「已登记 N 条」，条件存本轮
   turn 上下文（agent.js 闭包，不进会话历史）。模型不登记 → 回路不激活（fail-open）。
2. **证据 checkpoint**（新纯函数组 jev.js `checkEvidence` / `buildEvidenceDigest` /
   `decideEvidenceGate`）：一次 systemone 调用，
   - state = 用户原话 + 证据摘要（最近 ≤3 条工具结果各截 ~1000 字，总 ≤3600，防 4000 截断丢条件）；
   - questions = 每条件一个 noul「现有证据是否足以支持该条件」+ `ev_conflict`（证据间是否矛盾
     或与请求冲突）+ `ev_missing`（是否有明显遗漏必查项）。
3. **触发时机（每轮 ≤2 次，防延迟膨胀）**：a) 首批实质工具结果回来后（checkpoint 1，缺口早暴露）；
   b) 模型返回无工具调用的「最终回复」时，若门未通过且预算未尽 → 不收束，注入缺口提示再给一轮。
4. **停止门** `decideEvidenceGate`：全部条件 ≥0.6 ∧ conflict <0.5 → 放行收束；否则把低分条件
   原文+分数拼成缺口提示（user 角色系统事件，仅进 API 同 prefetch 模式），指名「用哪个工具补哪条
   证据」；补检轮数上限 2，用尽即收束并在回答尾注「未核验项」。
5. **守卫与降级（铁律不变）**：闯关中/疑似索答 → 回路整体关闭（checkpoint 只服务 build/code
   任务，天然避开锁题）；Jev 失败/超时 → 跳过校验照旧走（提速件绝不能变成故障件）；
   每 checkpoint ~1.5s，简单 FAQ/chat 零新增延迟。
6. **可见性**：checkpoint 结果以路由卡片同款样式展示（每条件分数/冲突/遗漏/耗时），fail 时带原因。

### §3.4 批次 E4：实测、调阈与回归

1. 单测：jev 纯函数（checkEvidence 请求构造/摘要截断/门控边界/守卫关闭路径）、knowledge 新断言。
2. 烟雾 tests/e2e/smoke_assistant_jev.py 增：JV-05 条件登记→checkpoint 请求体含每条件 noul
   （mock 主模型抓包）；JV-06 低分→缺口注入→续检一轮→收束；JV-07 👎 落盘与缺口列表/统计展示。
3. A/B 分相计时（参照 new-model-integration 方法论）：同批 FAQ 与建造请求，Jev 开/关对照，
   产出直答率、P50/P95 耗时、续检率——写进 docs/create-lite-org-log.md 同款决策日志。
4. 阈值调校：直答 0.8 / 证据 0.6 / 冲突 0.5 为初始值，按 A/B 结果微调（model 已 pin jev-1.13.0，
   阈值不漂移）；AGENTS.md 的 jev.js/knowledge.js 条目同步更新。

## §4 新增接口与存储契约

| 项 | 契约 |
|---|---|
| `plan_conditions` 工具 | args `{conditions:[{id:string, text:string}]}`，1~6 条，text ≤120 字；结果回执登记回显 |
| `checkEvidence` | 输入 (userText, conditions, toolMsgs, cfg, signal)；输出 `{ok, scores:{condId:noul}, conflict, missing, elapsedMs, error?}`；异常返回 `{ok:false}` 由门控 fail-open |
| `decideEvidenceGate` | 输入 scores+阈值；输出 `{pass, gaps:[{id,text,score}]}`，纯函数可直测 |
| 存储键 | `mcAssistant.jev.stats.v1`（计数器）、`mcAssistant.jev.gaps.v1`（缺口数组，上限 200，FIFO） |
| 知识节字段 | 新增可选 `sources: string[]`；`formatDirectAnswer` 渲染「来源：js/xx.js」行 |
| 会话卡片 | jev 路由卡新增 kind=evidence（scores 列表/冲突/遗漏/耗时/降级原因），仅存 DOM |

## §5 验收清单（冻结后照此跑）

- E1：`node --test tools/test_assistant_knowledge.mjs` 全绿含新增断言（tile 对账/新节检索/sources 覆盖）；
  knowledge.js 任意节 ≤3000 字符；docs.js 图集描述与 textureTiles 表一致。
- E2：JV-05~07 过；直答尾部含来源行；👎 后 gaps+1 且 ⚙️ 卡可见；faq 未命中自动进缺口日志。
- E3：mock 主模型断言全链（登记→checkpoint→缺口注入→收束）；网关不可达时行为与现状逐字节一致
  （fail-open 回归）；闯关中 plan_conditions/checkpoint 均不激活；每轮 checkpoint ≤2 次有断言。
- E4：A/B 报表（直答率/P50/续检率）落 docs；阈值调整有决策日志条目。

## §6 风险与对策

1. **systemone 单请求问题数上限未知**（现 4+6=10 问；section fan-out 将达 ~34 问）→ E2 先走
   零成本合并直答，fan-out 作为实测 spike，超限/变慢即弃。
2. **证据摘要 4000 字截断**（MAX_TOOL_RESULT 单条可达 24000）→ buildEvidenceDigest 硬预算
   ≤3600 字 + 按工具结果新鲜度截取；条件文本独立于 state 预算（在 questions 里）。
3. **延迟预算**：checkpoint +1.5s/次、每轮 ≤2 次；只对登记了条件的复杂任务发生，换取的是省掉
   3-8s 的错误收束返工与一轮无谓 read_game_file——净收益由 E4 A/B 验证，不达标即回调触发条件
   （例如仅改码任务启用）。
4. **模型不配合登记条件** → 回路静默不激活，现有路径零回归；系统提示词给正反例提高依从率。
5. **知识库单节 3000 字预算**：edu 扩充后接近上限 → 若超，把题库契约要点独立成 `quiz` 节而非压缩正文。
6. **红线只收紧不放松**：直答/证据回路对闯关索答、闯关模式的关闭逻辑复用 preflight 同一判定，
   单测逐条覆盖（对应现有 quiz_answer/level_run 用例的镜像断言）。

## §7 实施顺序

E1（半天，纯数据+测试，零运行时风险）→ E2（半天，UI+纯函数）→ E3（1 天，agent 循环+jev 纯函数+
工具+卡片）→ E4（半天，实测+文档）。每批次独立可交付、独立可回滚；E1 完成即修复图集漂移这一
正确性问题，不等 E3。

## §8 实施记录（2026-09-22）

E1/E2/E3 已由三人并行小队（e1-knowledge / e2-jev-feedback / e3-evidence-loop）完成，Lead 集成评审通过：

- **E1 落地**：js/textureTiles.js（tiles 分配表唯一事实源，occupiedTiles/freeTileRanges，实测空闲
  80、91..255——85..90 已被关卡工坊占用）；knowledge.js 17 节（新增 tnt/media，扩充 edu/world），
  全节带 sources，空闲 tile 文案动态生成；docs.js 模块地图对账；test_assistant_knowledge.mjs
  含 tile 对账与「45..63 复辟拦截」断言。10 pass。
- **E2 落地**：复合直答（命中节+伴随节 ≤2000 字、来源行容错渲染）；路由统计
  mcAssistant.jev.stats.v1 + 知识缺口日志 mcAssistant.jev.gaps.v1（no_hit 自动记 + 直答 👎 记
  user_down，FIFO≤200，⚙️ 卡统计行/导出/清空）；agent.js direct 分支打 jev 标记三件套。
  test_assistant_jev.mjs 28 pass。
- **E3 落地**：js/assistant/evidence.js 纯函数组（digest 三级预算 ≤3600/请求构造/门控 0.6·0.5/
  fail-open）；tools.js plan_conditions（1~6 条，闯关拒绝）；agent.js 证据回路（首批工具结果后
  checkpoint + 收束前重判，各 ≤2 次预算，缺口提示仅进 API，预算用尽尾注未核验项）；docs.js 工作流
  A/B 各补 2 行；ui.js「🔍 证据校验」卡。test_assistant_evidence.mjs 17 pass。
- **验收**：单测 55/55 全绿；smoke_assistant_jev.py 增 JV-05（8 断言）/JV-06（7 断言）本地 mock
  网关零 env 方案并真浏览器实跑全过；fail-open 回归（网关不可达时普通路径逐字节一致）已验。
- **余项（E4）**：👍/👎 落盘浏览器用例（JV-07）、A/B 分相计时报表与阈值调校、决策日志条目——
  待真网关（JEV_GATEWAY）可用的时段跑。
