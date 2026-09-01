// ==================== assistant/agent.js ====================
// Agent 循环：用户消息 → LLM（流式）→ 工具调用 → 结果回传 → … → 最终文本回复
// 约束：系统提示词每轮实时构建（状态/调色板随游戏同步）；
//       reload_game 执行后立即终止循环（页面即将重载，会话会在新页面自动继续）。

import { chatCompletion, getConfig, isConfigured } from './llm.js';
import { buildFinalSystemPrompt } from './docs.js';
import { executeTool, getToolSchemas } from './tools.js';

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
 *   onStatus(text)             状态提示
 * 返回 { finalText, reloading }
 */
export async function runAgentTurn({ session, signal, onStreamText, onReasoningText, onAssistantDone, onToolCall, onToolResult, onStatus }) {
    if (!isConfigured()) {
        throw new Error('尚未配置 LLM：请点击面板右上角 ⚙️ 填写 API 地址 / Key / 模型');
    }
    const cfg = getConfig();
    const messages = buildApiMessages(session);
    const tools = getToolSchemas();
    let lastText = '';

    for (let iter = 0; iter < cfg.maxToolIterations; iter++) {
        onStatus?.(iter === 0 ? '思考中…' : `第 ${iter + 1} 轮工具调用…`);
        const { content, reasoning, toolCalls } = await chatCompletion({
            messages,
            tools,
            signal,
            onDelta: (full) => { lastText = full; onStreamText?.(full); },
            onReasoning: (full) => onReasoningText?.(full),
        });

        const assistantMsg = {
            role: 'assistant',
            content,
            // 思考文本只在本机展示（toApiMessage 不回传 LLM），超限保留末尾
            reasoning: reasoning ? (reasoning.length > MAX_STORED_REASONING ? reasoning.slice(-MAX_STORED_REASONING) : reasoning) : undefined,
            toolCalls: toolCalls.length ? toolCalls : undefined,
        };
        session.messages.push(assistantMsg);
        onAssistantDone?.(assistantMsg);
        messages.push(toApiMessage(assistantMsg));

        if (toolCalls.length === 0) {
            return {
                finalText: content || '（模型返回了空回复——可能是上游接口异常或被限流，请重试）',
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
            onToolCall?.(tc);
            onStatus?.(`🔧 ${tc.name}…`);
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
    }
    return { finalText: lastText || '（已达最大工具调用轮数上限，任务未完成。可让我继续。）', reloading: false };
}
