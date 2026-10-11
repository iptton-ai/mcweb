// ==================== assistant/agent.js ====================
// Agent 循环：用户消息 → LLM（流式）→ 工具调用 → 结果回传 → … → 最终文本回复
// 约束：系统提示词每轮实时构建（状态/调色板随游戏同步）；
//       reload_game 执行后立即终止循环（页面即将重载，会话会在新页面自动继续）。

import { chatCompletion, getConfig, isConfigured } from './llm.js';
import { buildFinalSystemPrompt } from './docs.js';
import { executeTool, getToolSchemas } from './tools.js';
import { getJevConfig, isJevConfigured, jevPreflight } from './jev.js';
import { checkEvidence } from './evidence.js';
import { state } from '../state.js';
import { setAgentHold } from '../buildQueue.js';

// 建造类工具：执行其一即认为本轮对话在做施工流程，跨轮次等 LLM 期间跟拍保持取景
const BUILD_TOOLS = new Set(['place_blocks', 'clear_area', 'build_script']);

const MAX_API_MESSAGES = 60;   // 发给 LLM 的历史长度上限（按条数）
const MAX_TOOL_RESULT = 24000; // 单条工具结果发给 LLM 的字符上限
const MAX_STORED_REASONING = 30000; // 存入会话的思考文本上限（超出保留末尾：结论在末段）

function toApiMessage(m) {
    if (m.role === 'assistant') {
        const out = { role: 'assistant', content: m.content || '' };
        if (m.toolCalls && m.toolCalls.length > 0) {
            out.tool_calls = m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments || '{}' },
            }));
        }
        return out;
    }
    if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.toolCallId, content: String(m.content || '').slice(0, MAX_TOOL_RESULT) };
    }
    // user / 系统事件
    return { role: 'user', content: m.meta === 'system' ? `[系统事件] ${m.content}` : m.content };
}

// 裁剪历史：从某条 user 消息开始截断，保证 tool 消息不会失去前置的 tool_calls
function buildApiMessages(session) {
    const msgs = session.messages;
    let start = 0;
    if (msgs.length > MAX_API_MESSAGES) {
        for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].role === 'user' && msgs.length - i <= MAX_API_MESSAGES) { start = i; break; }
        }
    }
    return [{ role: 'system', content: buildFinalSystemPrompt() }, ...msgs.slice(start).map(toApiMessage)];
}

/**
 * 执行一轮完整对话（可能包含多次工具循环）
 * 回调：
 *   onStreamText(累计正文)     流式渲染中
 *   onReasoningText(累计思考)  思考内容（reasoning_content）流式渲染中
 *   onAssistantDone(msg)       一条 assistant 消息定型（含 toolCalls / reasoning）
 *   onToolCall(tc)             工具开始执行
 *   onToolResult(toolMsg)      工具执行完成
 *   onEvidence(res)            证据 checkpoint 结果（E3，含每条件分数/冲突/遗漏/门控/降级原因；
 *                              仅存 DOM 不进会话历史，接线方式同 onJevRoute）
 *   onStatus(text)             状态提示
 * 返回 { finalText, reloading }
 */
export async function runAgentTurn({ session, signal, onStreamText, onReasoningText, onAssistantDone, onToolCall, onToolResult, onJevRoute, onEvidence, onStatus }) {
    const cfg = getConfig();
    const messages = buildApiMessages(session);
    const tools = getToolSchemas();
    let lastText = '';
    let buildStarted = false; // 本轮是否执行过建造类工具（决定收尾时是否摘掉跟拍 hold）

    // Jev 快速路由（⚙️ 里开启）放在 LLM 配置检查之前：纯知识直答不依赖主模型也能用。
    // 仅对用户真实发言生效（系统事件/任务续跑跳过——续跑消息路由会误判，直答会打断任务恢复）。
    // 高置信 FAQ 免 LLM 直答；其余预取知识注入首轮省一轮工具往返。失败静默走原路径，绝不抛错。
    const lastMsg = session.messages[session.messages.length - 1];
    if (lastMsg && lastMsg.role === 'user' && !lastMsg.meta) {
        const route = await jevPreflight(lastMsg.content, { signal, inLevelRun: !!state.levelRun });
        // 路由发生即上报（含失败详情）：会话里以工具卡片样式展示，否则这次调用完全不可见
        if (route) onJevRoute?.({ ...route.detail, action: route.action, reason: route.reason, text: lastMsg.content });
        if (route?.action === 'direct') {
            onStatus?.('⚡ 快速回答…');
            // jev 标记三件套（E2）：ui.js 据此给直答消息挂 👍/👎 反馈行；jevSection/jevQuery 供缺口日志归因
            const assistantMsg = { role: 'assistant', content: route.answer, jev: true, jevSection: (route.detail?.section?.id) || '', jevQuery: lastMsg.content };
            session.messages.push(assistantMsg);
            onAssistantDone?.(assistantMsg);
            return { finalText: route.answer, reloading: false };
        }
        if (route?.action === 'prefetch' && route.hint) {
            // 追加在用户消息之后（仅进 API 不进会话历史）：模型首轮即可见，省一轮工具往返
            messages.push({ role: 'user', content: route.hint });
        }
    }

    // ===== E3 证据回路（docs/jev-evidence-loop-plan.md §3.3）：turn 级闭包状态，不进会话历史 =====
    // 铁律（fail-open）：Jev 未配置 / 闯关中 / 模型未登记条件 / 任何失败时整段不激活或静默跳过，
    // 主对话行为与现状一致——证据校验是提速件，绝不能变成故障件。
    const turnUserText = lastMsg && lastMsg.role === 'user' ? String(lastMsg.content || '') : '';
    let turnConditions = null; // plan_conditions 拦截登记的可核验条件 [{id,text}]
    let checkpointsUsed = 0;   // 本轮证据 checkpoint 已做次数（≤2，防延迟膨胀）
    let evidenceRounds = 0;    // 已注入缺口提示的补证轮数（≤2，用尽即放行收束）
    let realToolRan = false;   // 本轮是否执行过 ≥1 个非 plan_conditions 工具（checkpoint 的前提）
    let gateFailed = false;    // 最近一次 checkpoint 门是否未过（收束时决定是否尾注未核验项）
    let lastGaps = [];         // 最近一次未过门的低分条件（缺口提示/尾注共用）
    // 缺口提示：低分条件原文+分数+建议补证工具，注入 API 消息（仅进 API 不进会话，同 Jev 预取模式）
    const buildGapHint = (res) => {
        const lines = ['[⚡ 证据校验] 以下条件现有证据不足，请先用工具补证，再收束汇报：'];
        for (const g of res.gate.gaps) {
            lines.push(`- 「${g.text}」支持度 ${Number(g.score ?? 0).toFixed(2)} → 建议用 scan_terrain / read_blocks / read_game_file / get_runtime_errors 等工具实地取证后继续`);
        }
        if ((res.conflict ?? 0) >= 0.5) lines.push('- 证据之间存在矛盾或与请求冲突：先核对消除冲突再继续');
        if ((res.missing ?? 0) >= 0.5) lines.push('- 存在明显遗漏的必查项：请补查后再收束');
        return lines.join('\n');
    };
    // 证据回路是否激活：条件已登记 && 非闯关 && 做过实质取证 && Jev 已配置
    const evidenceActive = () => !!(turnConditions && !state.levelRun && realToolRan && isJevConfigured());
    // 证据 checkpoint：一次 Jev 批判（每轮 ≤2 次）；门未过且补证预算未尽 → 注入缺口提示并返回 true
    const doEvidenceCheckpoint = async () => {
        if (checkpointsUsed >= 2 || evidenceRounds >= 2) return false;
        checkpointsUsed++;
        // 任何失败都返回 ok:false → 不注入、不改主流程（fail-open）
        const res = await checkEvidence(turnUserText, turnConditions, messages, getJevConfig(), signal);
        gateFailed = !!(res.ok && res.gate && !res.gate.pass);
        lastGaps = (res.ok && res.gate && res.gate.gaps) || [];
        onEvidence?.(res); // 卡片上报（含降级原因），仅存 DOM 不进会话历史
        if (gateFailed) {
            messages.push({ role: 'user', content: buildGapHint(res) });
            evidenceRounds++;
            return true;
        }
        return false;
    };

    if (!isConfigured()) {
        throw new Error('尚未配置 LLM：请点击面板右上角 ⚙️ 填写 API 地址 / Key / 模型');
    }

    try {
        for (let iter = 0; iter < cfg.maxToolIterations; iter++) {
            onStatus?.(iter === 0 ? '思考中…' : `第 ${iter + 1} 轮工具调用…`);
            const { content, reasoning, toolCalls } = await chatCompletion({
                messages,
                tools,
                signal,
                onDelta: (full) => { lastText = full; onStreamText?.(full); },
                onReasoning: (full) => onReasoningText?.(full),
            });

            // ===== E3 收束门：先于 assistant 消息定型执行——门未过且预算未尽时注入缺口提示
            // （本轮收束尝试照常定型，API 序列 assistant → user 提示）再续跑一轮；
            // 补证预算（checkpoint ≤2 / 提示 ≤2）用尽即放行收束，并把未核验项尾注进回答正文 =====
            let gateNote = '';
            if (toolCalls.length === 0 && evidenceActive()) {
                if (checkpointsUsed < 2 && evidenceRounds < 2 && await doEvidenceCheckpoint()) {
                    const retryMsg = {
                        role: 'assistant',
                        content,
                        reasoning: reasoning ? (reasoning.length > MAX_STORED_REASONING ? reasoning.slice(-MAX_STORED_REASONING) : reasoning) : undefined,
                    };
                    session.messages.push(retryMsg);
                    onAssistantDone?.(retryMsg);
                    messages.push(toApiMessage(retryMsg));
                    continue; // 缺口提示已注入：不收束，给模型一轮补证机会
                }
                if (gateFailed && lastGaps.length) {
                    gateNote = `\n\n（⚠️ 证据校验未全部通过，未核验项：${lastGaps.map((g) => `「${g.text}」`).join('、')}）`;
                }
            }

            const assistantMsg = {
                role: 'assistant',
                // E3：仅当证据回路激活的收束才把兜底文案+未核验项尾注写进正文（DOM/会话/返回值一致）；
                // 其余情况保持原样（含空正文原样入库，不改既有行为）
                content: toolCalls.length === 0 && evidenceActive()
                    ? (content || '（模型返回了空回复——可能是上游接口异常或被限流，请重试）') + gateNote
                    : content,
                // 思考文本只在本机展示（toApiMessage 不回传 LLM），超限保留末尾
                reasoning: reasoning ? (reasoning.length > MAX_STORED_REASONING ? reasoning.slice(-MAX_STORED_REASONING) : reasoning) : undefined,
                toolCalls: toolCalls.length ? toolCalls : undefined,
            };
            session.messages.push(assistantMsg);
            onAssistantDone?.(assistantMsg);
            messages.push(toApiMessage(assistantMsg));

            if (toolCalls.length === 0) {
                return {
                    finalText: (content || '（模型返回了空回复——可能是上游接口异常或被限流，请重试）') + gateNote,
                    reloading: false,
                };
            }

            // 逐个执行工具并把结果追加到对话
            for (const tc of toolCalls) {
                let args = {};
                try {
                    args = JSON.parse(tc.arguments || '{}');
                } catch {
                    // 参数不是合法 JSON：原样作为错误回传，让模型自行纠正
                }
                // E3 条件登记拦截：条件存本轮闭包（不进会话历史），工具回执只作确认。
                // 参数解析失败时 args 为空对象 → 自然忽略，executeTool 会回执格式错误
                if (tc.name === 'plan_conditions') {
                    if (!state.levelRun && Array.isArray(args.conditions)) {
                        const conds = args.conditions
                            .map((c) => ({ id: String((c && c.id) || '').slice(0, 40), text: String((c && c.text) || '').slice(0, 120) }))
                            .filter((c) => c.id && c.text)
                            .slice(0, 6);
                        if (conds.length) turnConditions = conds;
                    }
                } else {
                    realToolRan = true; // 实质取证工具：证据 checkpoint 的前提
                }
                onToolCall?.(tc);
                onStatus?.(`🔧 ${tc.name}…`);
                if (BUILD_TOOLS.has(tc.name) && !buildStarted) {
                    // 施工流程开始：两次建造调用之间隔着一次 LLM 往返（网络+思考，常超数秒），
                    // 期间施工队列短暂为空。挂起 hold 让建造跟拍保持最后取景等下一批任务，
                    // 不提前判「建造完成」并停录；整轮结束（含出错路径）在 finally 摘掉
                    buildStarted = true;
                    setAgentHold(true);
                }
                const { result, isError } = await executeTool(tc.name, args);
                const toolMsg = { role: 'tool', toolCallId: tc.id, name: tc.name, content: result, isError };
                session.messages.push(toolMsg);
                onToolResult?.(toolMsg);
                messages.push(toApiMessage(toolMsg));

                // 页面即将重载：终止本轮，避免继续请求 LLM
                if (tc.name === 'reload_game') {
                    return { finalText: '🔄 正在热重载游戏以应用修改…', reloading: true };
                }
            }

            // ===== E3 证据 checkpoint：首批实质工具结果回来后批判一次（缺口早暴露）。
            // 后续工具批不再判——重判留给收束门，合计每轮 ≤2 次（防延迟膨胀）=====
            if (evidenceActive() && checkpointsUsed === 0) {
                if (await doEvidenceCheckpoint()) continue; // 缺口提示已注入：把证据补齐再谈收束
            }
        }
        return { finalText: lastText || '（已达最大工具调用轮数上限，任务未完成。可让我继续。）', reloading: false };
    } finally {
        if (buildStarted) setAgentHold(false);
    }
}
