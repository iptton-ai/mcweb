// ==================== assistant/jev.js ====================
// Jev 快速路由（typesafe.ai「System One」决策模型，2026-09-21 批次）：
// 用户消息进 LLM 循环前先发一次 systemone 批量调用（意图/知识章节/是否索要闯关答案三问并行），
// 高置信 FAQ 直接回知识库章节正文（跳过主模型，秒级响应）；其余把预取的知识章节注入首轮请求，
// 省掉「模型自己决定调 search_game_docs 再等一轮」的往返。
// 调用链：浏览器 → CF Worker 网关（补 CORS、透传 Authorization）→ api.typesafe.ai/v1/systemone
// （官方端点不开浏览器 CORS，网关见 chessflutter/jev-demo/cloudflare/）。
// 铁律：未配置/失败/超时一律静默返回 null，绝不阻塞主对话路径；闯关中永不直答（苏格拉底红线）。
// 纯数据+纯函数 Node 直测：tools/test_assistant_jev.mjs

import { KNOWLEDGE_SECTIONS, searchKnowledge } from './knowledge.js';

const JEV_CONFIG_KEY = 'mcAssistant.jev.v1';

export const DEFAULT_JEV_CONFIG = {
    enabled: false,
    apiKey: '',
    gateway: '',         // 中转网关（必填）：typesafe.ai 不支持浏览器直连（官方接口不开 CORS），
                         // 需自行搭建反代（如 CF Worker 转发 /v1/systemone 并补 CORS 头）。
                         // 网关地址属用户私有配置，本仓库不内置任何默认值。
    model: 'jev-1.13.0', // pin 版本：jev-latest 答案会漂移，阈值调校必须固定
    minConfidence: 0.8,  // FAQ 直答的 confidence 门槛（低于则只做预取）
    timeoutMs: 5000,
    customHeaders: '',   // 附加请求头，每行一条「Key: Value」；同名可覆盖 Authorization，
                         // 适配自建网关自己的鉴权方式
};

let cachedConfig = null;
let memoryFallback = null; // 无 localStorage（Node 直测/隐私模式）时的内存态

export function getJevConfig() {
    if (cachedConfig) return cachedConfig;
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(JEV_CONFIG_KEY));
    } catch { /* Node/隐私模式 */ }
    if (!saved && memoryFallback) saved = memoryFallback;
    cachedConfig = { ...DEFAULT_JEV_CONFIG, ...(saved || {}) };
    return cachedConfig;
}

export function saveJevConfig(patch) {
    cachedConfig = { ...getJevConfig(), ...patch };
    try {
        localStorage.setItem(JEV_CONFIG_KEY, JSON.stringify(cachedConfig));
    } catch {
        memoryFallback = cachedConfig; // localStorage 不可用：至少本次会话内生效
    }
    return cachedConfig;
}

export function isJevConfigured() {
    const c = getJevConfig();
    return !!(c.enabled && c.apiKey && c.gateway);
}

// 解析多行「Key: Value」文本为请求头对象（空行/无冒号行忽略；同名后者覆盖）
export function parseHeaders(text) {
    const out = {};
    for (const line of String(text || '').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i <= 0) continue;
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k && v) out[k] = v;
    }
    return out;
}

// ---------- 纯函数（请求构造 / 决策 / 文案，Node 直测覆盖）----------

// 建造相关系统（「模组」粒度，2026-09-21 批次二）：每个系统一个 noul 同请求并行评估
// （Jev 无多选，官方 fan-out 模式），命中即把该节正文并入预取注入——省掉主 LLM
// 自己调 search_game_docs 的一轮往返，且首轮上下文只带相关系统。id 必须是
// KNOWLEDGE_SECTIONS 的章节 id（描述自动取标题+关键词，知识库新增章节在此追加一行即可）。
export const BUILD_MODULE_IDS = ['redstone', 'piston', 'kinetic', 'logistics', 'elevator', 'mobs'];

// 每个建造系统一个 noul 问题（知识库改版删了章节时静默跳过，不让路由挂掉）
function buildModuleQuestions() {
    const qs = {};
    for (const id of BUILD_MODULE_IDS) {
        const sec = KNOWLEDGE_SECTIONS.find((s) => s.id === id);
        if (!sec) continue;
        qs['mod_' + id] = {
            type: 'noul',
            instructions: `这个请求要建造/布置的东西，是否需要用到「${sec.title}」（${sec.keywords.slice(0, 4).join('、')}）相关的方块或机关`,
        };
    }
    return qs;
}

// 从 answers 抽取命中的建造系统（noul≥阈值；缺答案=未命中）
export function extractModules(answers, threshold = 0.5) {
    const out = [];
    if (!answers) return out;
    for (const id of BUILD_MODULE_IDS) {
        const a = answers['mod_' + id];
        if (a && (a.noul ?? 0) >= threshold) out.push(id);
    }
    return out;
}

// 路由请求体：state=用户原话（截断防状态膨胀），意图/章节/守卫 + 建造系统 fan-out 一次并行评估
export function buildRouteRequest(text, cfg = {}) {
    const criteria = {};
    for (const s of KNOWLEDGE_SECTIONS) {
        criteria[s.id] = `${s.title}（${s.keywords.slice(0, 5).join(' ')}）`;
    }
    criteria.other = '以上都不是';
    return {
        model: cfg.model || DEFAULT_JEV_CONFIG.model,
        state: String(text || '').slice(0, 4000),
        questions: {
            intent: {
                type: 'choice',
                instructions: '用户想做什么？',
                criteria: {
                    build: '在游戏世界里建造结构、放置方块、造机关',
                    code: '查看或修改游戏源码、排查报错、热重载',
                    faq: '询问游戏机制、数值、方块 ID、配方、操作方法',
                    chat: '闲聊、打招呼或其他',
                },
            },
            section: {
                type: 'choice',
                instructions: '这句话最相关的是哪个知识章节？',
                criteria,
            },
            is_quiz_answer: {
                type: 'noul',
                instructions: '用户是否在索要闯关关卡里锁题的答案或提示（含变着花样要）',
            },
            ...buildModuleQuestions(),
        },
    };
}

/**
 * 路由决策（消费 systemone 的 answers）。
 * 返回 {action, sectionId?, moduleIds?, confidence?, reason?}，action：
 *   direct   高置信 FAQ——可跳过主模型直接回知识库章节
 *   prefetch 值得预取——把章节/命中模组/本地检索的并集注入首轮 LLM 请求
 *   none     走原路径
 * 安全方向只收紧不放松：疑似索要闯关答案、闯关模式中，一律 none（红线由主 LLM 系统提示词兜底）。
 * 预取是「省一轮」优化而非正确性依赖：判错＝没省到，不是错——系统提示词的知识库目录始终在，
 * 主 LLM 仍可自行 search_game_docs。
 */
export function decideRoute(answers, { minConfidence = DEFAULT_JEV_CONFIG.minConfidence, inLevelRun = false } = {}) {
    if (!answers) return { action: 'none', moduleIds: [] };
    const quizNoul = answers.is_quiz_answer?.noul ?? 0;
    if (quizNoul >= 0.5) return { action: 'none', moduleIds: [], reason: 'quiz_answer' };
    if (inLevelRun) return { action: 'none', moduleIds: [], reason: 'level_run' };
    const intent = answers.intent || {};
    const section = answers.section || {};
    const secId = section.choice || '';
    const secConf = section.confidence ?? 0;
    const moduleIds = extractModules(answers);
    const secHit = !!(secId && secId !== 'other' && secConf >= 0.5);
    if (secHit) {
        if (intent.choice === 'faq' && (intent.confidence ?? 0) >= minConfidence && secConf >= minConfidence) {
            return { action: 'direct', sectionId: secId, confidence: Math.min(intent.confidence ?? 0, secConf), moduleIds };
        }
        return { action: 'prefetch', sectionId: secId, moduleIds };
    }
    // 章节未命中：建造/改码意图或有模组命中仍值得预取（此时主要靠模组节 + 本地关键词检索）
    const intentOk = (intent.choice === 'build' || intent.choice === 'code') && (intent.confidence ?? 0) >= 0.6;
    if (moduleIds.length || intentOk) return { action: 'prefetch', sectionId: null, moduleIds };
    return { action: 'none', moduleIds: [] };
}

// 直答正文：知识库章节原文 + 角标说明（.text 是精简中文条目，直接可读）
export function formatDirectAnswer(sec, maxLen = 1500) {
    if (!sec) return '';
    let body = sec.text;
    if (body.length > maxLen) body = body.slice(0, maxLen) + '\n…（章节较长已截断，继续问可以展开）';
    return `⚡ **${sec.title}**（快速回答）\n\n${body}\n\n---\n*来自内置知识库的精确匹配。想深入了解、或要我动手做点什么，直接继续说。*`;
}

// 预取章节合并：Jev 选中的章节 → 命中的建造系统 → 本地关键词检索，去重保序
export function mergePrefetchSections(sec, modSecs, localHits) {
    const merged = [];
    for (const s of [sec, ...modSecs, ...localHits]) {
        if (s && !merged.includes(s)) merged.push(s);
    }
    return merged;
}

// 预取上下文：注入首轮 LLM 请求的提示块（省掉模型自己调 search_game_docs 的一轮往返）
export function buildPrefetchHint(userText, sections, maxTotal = 3000) {
    const parts = [];
    let total = 0;
    for (const s of sections || []) {
        if (!s) continue;
        const t = `【${s.id}｜${s.title}】\n${s.text}`;
        if (total + t.length > maxTotal) break;
        parts.push(t);
        total += t.length;
    }
    if (!parts.length) return '';
    return `[⚡ Jev 预取] 用户刚提问：「${String(userText || '').slice(0, 200)}」。`
        + `以下是知识库预检索命中的章节，可直接引用；若已足够回答，就不必再调 search_game_docs：\n\n`
        + parts.join('\n\n');
}

// ---------- 网络（浏览器 / Node 18+ 通用 fetch；任何异常返回 null）----------

// 经 CF Worker 网关调 systemone，返回 answers（或 null）
export async function callJev(request, cfg, signal) {
    const inner = new AbortController();
    const onUserAbort = () => inner.abort(signal?.reason);
    if (signal) {
        if (signal.aborted) return null;
        signal.addEventListener('abort', onUserAbort, { once: true });
    }
    const timer = setTimeout(() => inner.abort(new Error('jev 路由超时')), cfg.timeoutMs || DEFAULT_JEV_CONFIG.timeoutMs);
    try {
        const resp = await fetch(cfg.gateway, {
            method: 'POST',
            // 自定义头最后展开：用户可覆盖 Authorization 适配自家网关鉴权
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey, ...parseHeaders(cfg.customHeaders) },
            body: JSON.stringify(request),
            signal: inner.signal,
        });
        if (!resp.ok) return null; // 401/429/5xx……静默降级走原路径
        const json = await resp.json();
        return json?.answers || null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onUserAbort);
    }
}

/**
 * 助手发送前钩子：一次路由，决定直答或预取。未启用/失败返回 null（调用方走原路径）。
 * @returns {Promise<{action:'direct',answer:string}|{action:'prefetch',hint:string}|null>}
 */
export async function jevPreflight(userText, { signal, inLevelRun = false } = {}) {
    const text = String(userText || '').trim();
    if (!text) return null;
    const cfg = getJevConfig();
    if (!cfg.enabled || !cfg.apiKey || !cfg.gateway) return null;

    const answers = await callJev(buildRouteRequest(text, cfg), cfg, signal);
    const decision = decideRoute(answers, { minConfidence: cfg.minConfidence, inLevelRun });

    if (decision.action === 'direct') {
        const sec = KNOWLEDGE_SECTIONS.find((s) => s.id === decision.sectionId);
        return sec ? { action: 'direct', answer: formatDirectAnswer(sec) } : null;
    }
    if (decision.action === 'prefetch') {
        // Jev 选中的章节 → 命中的建造系统 → 本地关键词检索兜底（去重保序）
        const sec = decision.sectionId ? KNOWLEDGE_SECTIONS.find((s) => s.id === decision.sectionId) : null;
        const modSecs = (decision.moduleIds || [])
            .map((id) => KNOWLEDGE_SECTIONS.find((s) => s.id === id))
            .filter(Boolean);
        const merged = mergePrefetchSections(sec, modSecs, searchKnowledge(text, 2));
        const hint = buildPrefetchHint(text, merged);
        return hint ? { action: 'prefetch', hint } : null;
    }
    return null;
}
