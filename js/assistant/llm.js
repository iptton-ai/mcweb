// ==================== assistant/llm.js ====================
// LLM 客户端：OpenAI 兼容 /chat/completions（流式 + 工具调用增量解析）
// 浏览器直连上游接口，不经本地服务器中转（要求上游允许跨域 CORS）

const CONFIG_KEY = 'mcAssistant.config.v1';

// 超时保护（可用配置 requestTimeoutMs / idleTimeoutMs 覆盖，弱网或测试调参用）：
// 等响应头最长 60 秒；流式输出期间连续 90 秒没有任何数据则判定上游挂死并中断。
// 没有这两道闸，上游假死会让面板永远停在「思考中…」。
const HEADER_TIMEOUT_MS = 60000;
const IDLE_TIMEOUT_MS = 90000;

export const DEFAULT_CONFIG = {
    baseUrl: 'https://api.deepseek.com/v1', // 填到 /v1 为止（自动拼接 /chat/completions）
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.7,
    maxToolIterations: 30,  // 单轮对话最多工具调用循环次数
    extraInstructions: '',  // 用户自定义附加说明（追加到系统提示词）
};

let cachedConfig = null;

export function getConfig() {
    if (cachedConfig) return cachedConfig;
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    } catch {
        saved = {};
    }
    cachedConfig = { ...DEFAULT_CONFIG, ...saved };
    return cachedConfig;
}

export function saveConfig(patch) {
    cachedConfig = { ...getConfig(), ...patch };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cachedConfig));
    return cachedConfig;
}

export function isConfigured() {
    const c = getConfig();
    return !!(c.apiKey && c.model && c.baseUrl);
}

function completionsUrl() {
    return getConfig().baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

/**
 * 发起一次对话补全（stream: true），返回聚合后的 {content, toolCalls}
 * onDelta(累计文本) 用于流式渲染
 */
export async function chatCompletion({ messages, tools, signal, onDelta }) {
    const cfg = getConfig();
    const headerMs = Number(cfg.requestTimeoutMs) > 0 ? Number(cfg.requestTimeoutMs) : HEADER_TIMEOUT_MS;
    const idleMs = Number(cfg.idleTimeoutMs) > 0 ? Number(cfg.idleTimeoutMs) : IDLE_TIMEOUT_MS;
    const payload = {
        model: cfg.model,
        messages,
        stream: true,
        temperature: cfg.temperature,
    };
    if (tools && tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = 'auto';
    }

    // 内部控制器：把「用户点停止」与「超时」统一作用到 fetch/流上，且两者错误可区分
    const inner = new AbortController();
    const onUserAbort = () => inner.abort(signal?.reason);
    if (signal) {
        if (signal.aborted) onUserAbort();
        else signal.addEventListener('abort', onUserAbort, { once: true });
    }
    let timer = setTimeout(
        () => inner.abort(new Error(`LLM 接口 ${Math.round(headerMs / 1000)} 秒无响应，连接超时`)),
        headerMs,
    );
    // 进入流式阶段后改作空闲看门狗：每收到一段数据就重新计时
    const armIdle = () => {
        clearTimeout(timer);
        timer = setTimeout(
            () => inner.abort(new Error(`LLM 流式响应超过 ${Math.round(idleMs / 1000)} 秒没有数据，已中断`)),
            idleMs,
        );
    };

    let resp;
    try {
        // 浏览器直连上游，不经本地服务器中转
        resp = await fetch(completionsUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
            signal: inner.signal,
            body: JSON.stringify(payload),
        });
    } catch (e) {
        if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
        // 超时以 Error(reason) 形态抵达；网络错误才是 TypeError
        throw new Error('无法连接 LLM 接口（网络错误/超时或上游不允许浏览器跨域 CORS）：'
            + completionsUrl() + (e?.message ? `（${e.message}）` : ''));
    }

    try {
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`LLM 接口返回 ${resp.status}：${text.slice(0, 400)}`);
        }

        const ctype = resp.headers.get('Content-Type') || '';
        if (ctype.includes('application/json')) {
            // 上游不支持流式：整体解析
            const json = await resp.json();
            const msg = json.choices?.[0]?.message || {};
            return normalizeResult(msg.content || '', msg.tool_calls || []);
        }

        armIdle();
        return await consumeStream(resp, onDelta, armIdle);
    } catch (e) {
        if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
        throw e;
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onUserAbort);
    }
}

async function consumeStream(resp, onDelta, onActivity) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolAcc = []; // 按增量序号聚合工具调用

    while (true) {
        const { done, value } = await reader.read();
        onActivity?.(); // 每收到一段数据（含 SSE 心跳/空行）就重置空闲看门狗
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 事件以空行分隔
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            for (const line of rawEvent.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                let json;
                try {
                    json = JSON.parse(data);
                } catch {
                    continue; // 跳过无法解析的碎片
                }
                const delta = json.choices?.[0]?.delta || {};
                if (delta.content) {
                    content += delta.content;
                    onDelta?.(content);
                }
                if (Array.isArray(delta.tool_calls)) {
                    for (const d of delta.tool_calls) {
                        const i = d.index ?? 0;
                        if (!toolAcc[i]) toolAcc[i] = { id: '', name: '', arguments: '' };
                        if (d.id) toolAcc[i].id = d.id;
                        if (d.function?.name) toolAcc[i].name += d.function.name;
                        if (d.function?.arguments) toolAcc[i].arguments += d.function.arguments;
                    }
                }
            }
        }
    }
    return normalizeResult(content, toolAcc.filter(Boolean));
}

function normalizeResult(content, rawToolCalls) {
    const toolCalls = (rawToolCalls || []).map((tc, i) => ({
        id: tc.id || `call_${i}_${Date.now()}`,
        name: tc.function?.name || tc.name || '',
        arguments: tc.function?.arguments ?? tc.arguments ?? '{}',
    })).filter((tc) => tc.name);
    return { content, toolCalls };
}
