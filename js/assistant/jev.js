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

// 网关地址规范化：只填域名（无路径）时自动补默认路径 /api/jev——用户不该被要求记住转发路径。
// 已带路径的地址原样保留（自建网关可能用别的路由路径）。
export function normalizeGateway(url) {
    const u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) return u;
    try {
        const parsed = new URL(u);
        if (parsed.pathname === '' || parsed.pathname === '/') return u + '/api/jev';
    } catch { /* 非法地址原样返回，让 fetch 失败并在卡片里显示错误 */ }
    return u;
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

// 直答正文：支持 1~2 节合并渲染（主节 + 复合问题的伴随节），总输出 ≤maxLen（默认 2000 字符）。
// 每节可带「来源：」行（sec.sources 是批次 E1 并行补的元数据，没有就跳过该行，不算错误）；
// 单节超预算照旧截断并提示「继续问可以展开」。
export function formatDirectAnswer(sec, maxLen = 2000) {
    const secs = Array.isArray(sec) ? sec.filter(Boolean) : (sec ? [sec] : []);
    if (!secs.length) return '';
    const FOOTER = '*来自内置知识库的精确匹配。想深入了解、或要我动手做点什么，直接继续说。*';
    const SEP = '\n\n---\n';
    const TRUNC = '\n…（章节较长已截断，继续问可以展开）';
    // 预算账本：先扣掉全部分隔线与结尾语，剩余按「未渲染节数」均摊（主节排第一吃大头），
    // 逐节扣减保证总长不超预算（+2 是节标题后的空行）
    let used = (secs.length + 1) * SEP.length + FOOTER.length;
    const blocks = [];
    for (let i = 0; i < secs.length; i++) {
        const s = secs[i];
        const head = i === 0 ? `⚡ **${s.title}**（快速回答）` : `📎 **${s.title}**（相关章节）`;
        const srcLine = Array.isArray(s.sources) && s.sources.length ? `\n来源：${s.sources.join('、')}` : '';
        const budget = Math.max(120, Math.floor((maxLen - used - head.length - 2 - srcLine.length - TRUNC.length) / (secs.length - i)));
        let body = String(s.text || '');
        if (body.length > budget) body = body.slice(0, budget) + TRUNC;
        used += head.length + 2 + srcLine.length + body.length;
        blocks.push(`${head}\n\n${body}${srcLine}`);
    }
    return blocks.join(SEP) + SEP + FOOTER;
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

// 经 CF Worker 网关调 systemone。成功返回 answers；用户主动停止返回 null；
// 网络/HTTP 失败抛错（由 jevPreflight 捕获转成 detail.error，会话卡片可见）。
export async function callJev(request, cfg, signal) {
    const inner = new AbortController();
    const onUserAbort = () => inner.abort(signal?.reason);
    if (signal) {
        if (signal.aborted) return null;
        signal.addEventListener('abort', onUserAbort, { once: true });
    }
    const timer = setTimeout(() => inner.abort(new Error('jev 路由超时')), cfg.timeoutMs || DEFAULT_JEV_CONFIG.timeoutMs);
    try {
        const resp = await fetch(normalizeGateway(cfg.gateway), {
            method: 'POST',
            // 自定义头最后展开：用户可覆盖 Authorization 适配自家网关鉴权
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey, ...parseHeaders(cfg.customHeaders) },
            body: JSON.stringify(request),
            signal: inner.signal,
        });
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            throw new Error(`网关返回 ${resp.status}${resp.status === 404 ? '（检查网关地址是否为完整转发路径）' : ''} ${body.slice(0, 120)}`);
        }
        const json = await resp.json();
        return json?.answers || null;
    } catch (e) {
        if (signal?.aborted) return null; // 用户主动停止不算错误
        if (e?.name === 'AbortError') throw new Error(`jev 路由超时（${cfg.timeoutMs || DEFAULT_JEV_CONFIG.timeoutMs}ms）`);
        if (e instanceof TypeError) throw new Error(`网关连接失败（${e.message}）`);
        throw e;
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onUserAbort);
    }
}

/**
 * 助手发送前钩子：一次路由，决定直答或预取。
 * 未启用/未配置/空文本返回 null（调用方走原路径，也不展示卡片）；
 * 已启用时总是返回结果对象（含 detail），失败也带 detail——供会话里的工具卡片展示。
 * @returns {Promise<null|{
 *   action:'direct'|'prefetch'|'none', answer?, hint?, reason?,
 *   detail:{ok,elapsedMs,error?,intent?,section?,quiz?,modules,sections},
 * }>}
 */
export async function jevPreflight(userText, { signal, inLevelRun = false } = {}) {
    const text = String(userText || '').trim();
    if (!text) return null;
    const cfg = getJevConfig();
    if (!cfg.enabled || !cfg.apiKey || !cfg.gateway) return null;

    const __t0 = Date.now();
    let lastErr = null;
    const attempt = () => callJev(buildRouteRequest(text, cfg), cfg, signal).catch((e) => { lastErr = e; return null; });
    let answers = await attempt();
    if (!answers && !signal?.aborted) {
        // 冷启动 DNS/TLS 抖动很常见：首败重试一次（路由失败反正要降级走慢路径，多等一次值得）
        lastErr = null;
        answers = await attempt();
    }
    const elapsedMs = Date.now() - __t0;

    // 返回前统一落盘路由统计（E2）：direct/prefetch/none 计数，ok=false 单列 fail——降级率要单独可见。
    // 统计是旁路数据，任何异常都不能影响路由本身（Node 无 localStorage 时内部静默走内存兜底）。
    const finishRoute = (result) => {
        try {
            const d = result.detail || {};
            const bump = d.ok === false ? { fail: 1 } : { [result.action]: 1 };
            bumpJevStats({ ...bump, elapsedMs: d.elapsedMs });
        } catch { /* 统计失败仅忽略 */ }
        return result;
    };

    if (!answers) {
        return finishRoute({
            action: 'none',
            detail: { ok: false, elapsedMs, error: (lastErr && lastErr.message) || '网关请求失败', intent: null, section: null, quiz: null, modules: [], sections: [] },
        });
    }
    const decision = decideRoute(answers, { minConfidence: cfg.minConfidence, inLevelRun });
    const detail = {
        ok: true,
        elapsedMs,
        intent: answers.intent ? { choice: answers.intent.choice, confidence: answers.intent.confidence } : null,
        section: answers.section ? { id: answers.section.choice, confidence: answers.section.confidence } : null,
        quiz: answers.is_quiz_answer?.noul ?? null,
        modules: decision.moduleIds || [],
        sections: [],
    };
    // 知识缺口自动记录（E2）：FAQ 问到了知识库没有的东西——章节未命中（other/空/低置信）
    // 且本地检索也零命中 → 记一笔 no_hit，直接当知识库迭代（E1 式）的需求清单；
    // 守卫拦截（quiz_answer/level_run）与检索有货的情况不算缺口，避免噪声。
    if (!decision.reason && answers.intent?.choice === 'faq') {
        const secAns = answers.section || {};
        const secMiss = !secAns.choice || secAns.choice === 'other' || (secAns.confidence ?? 0) < 0.5;
        if (secMiss && searchKnowledge(text).length === 0) {
            logKnowledgeGap({ query: text, section: 'other', reason: 'no_hit' });
        }
    }
    // 复合直答（E2）：命中节之外，再用本地关键词检索取「第一个不同章节」当伴随节——
    // 复合问题（「红石灯怎么点亮？晚上会不会刷怪？」）一次 ~1.5s 直答全覆盖，零额外网络请求。
    // 伴随节不存在（检索零命中/只有命中节自己）就不并，行为与单节直答完全一致。
    if (decision.action === 'direct') {
        const sec = KNOWLEDGE_SECTIONS.find((s) => s.id === decision.sectionId);
        if (sec) {
            const companion = searchKnowledge(text, 3).find((s) => s.id !== sec.id) || null;
            const secs = companion ? [sec, companion] : [sec];
            detail.sections = secs.map((s) => `${s.id} ${s.title}`);
            return finishRoute({ action: 'direct', answer: formatDirectAnswer(secs), detail });
        }
        return finishRoute({ action: 'none', detail });
    }
    if (decision.action === 'prefetch') {
        // Jev 选中的章节 → 命中的建造系统 → 本地关键词检索兜底（去重保序）
        const sec = decision.sectionId ? KNOWLEDGE_SECTIONS.find((s) => s.id === decision.sectionId) : null;
        const modSecs = (decision.moduleIds || [])
            .map((id) => KNOWLEDGE_SECTIONS.find((s) => s.id === id))
            .filter(Boolean);
        const merged = mergePrefetchSections(sec, modSecs, searchKnowledge(text, 2));
        const hint = buildPrefetchHint(text, merged);
        detail.sections = merged.map((s) => `${s.id} ${s.title}`);
        return finishRoute(hint ? { action: 'prefetch', hint, detail } : { action: 'none', detail });
    }
    return finishRoute({ action: 'none', detail, reason: decision.reason });
}

// ---------- 路由统计与知识缺口日志（批次 E2：让「提速」可度量、让知识缺口可沉淀）----------
// 存储契约（见 docs/jev-evidence-loop-plan.md §4）：
//   mcAssistant.jev.stats.v1 = { direct, prefetch, none, fail, totalElapsedMs, count }
//   mcAssistant.jev.gaps.v1  = [{ ts, query, section, reason }]，数组 FIFO 上限 200
// reason 取值：no_hit = FAQ 章节未命中且本地检索零命中（自动）、user_down = 用户点👎（人工）。
// 读写全部 try/catch：Node 直测/隐私模式无 localStorage 时走内存兜底，绝不抛错。

const JEV_STATS_KEY = 'mcAssistant.jev.stats.v1';
const JEV_GAPS_KEY = 'mcAssistant.jev.gaps.v1';
const GAPS_MAX = 200;   // 缺口日志 FIFO 上限：只留最近 200 条，防 localStorage 无限膨胀
let memoryStats = null; // 无 localStorage（Node 直测/隐私模式）时的内存态
let memoryGaps = null;

function readStore(key, memoryValue) {
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(key));
    } catch { /* Node/隐私模式 */ }
    return saved ?? memoryValue ?? null;
}

function writeStore(key, value, setMemory) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        setMemory(value); // localStorage 不可用：至少本次进程内可见（频次低，性能无虞）
    }
}

const EMPTY_STATS = { direct: 0, prefetch: 0, none: 0, fail: 0, totalElapsedMs: 0, count: 0 };

// 读路由统计（每次返回全新副本，调用方可随意改不动存储）
export function getJevStats() {
    const saved = readStore(JEV_STATS_KEY, memoryStats);
    return { ...EMPTY_STATS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

// 统计累加：patch 形如 { direct: 1, elapsedMs: 120 }——动作名 +N，elapsedMs 计入均耗分母 count
export function bumpJevStats(patch = {}) {
    const s = getJevStats();
    for (const k of ['direct', 'prefetch', 'none', 'fail']) {
        if (patch[k]) s[k] += patch[k];
    }
    if (typeof patch.elapsedMs === 'number' && patch.elapsedMs >= 0) {
        s.totalElapsedMs += Math.round(patch.elapsedMs);
        s.count += 1;
    }
    writeStore(JEV_STATS_KEY, s, (v) => { memoryStats = v; });
    return s;
}

// 统计归零（预留：⚙️ 卡以后要「重置统计」直接接）
export function resetJevStats() {
    const s = { ...EMPTY_STATS };
    writeStore(JEV_STATS_KEY, s, (v) => { memoryStats = v; });
    return s;
}

// 记一条知识缺口（FIFO ≤200，挤掉最旧）；query 截短防单条过大
export function logKnowledgeGap(entry = {}) {
    const saved = readStore(JEV_GAPS_KEY, memoryGaps);
    const list = Array.isArray(saved) ? saved : [];
    list.push({
        ts: typeof entry.ts === 'number' ? entry.ts : Date.now(),
        query: String(entry.query || '').slice(0, 300),
        section: String(entry.section || ''),
        reason: String(entry.reason || ''),
    });
    while (list.length > GAPS_MAX) list.shift();
    writeStore(JEV_GAPS_KEY, list, (v) => { memoryGaps = v; });
    return list;
}

export function getKnowledgeGaps() {
    const saved = readStore(JEV_GAPS_KEY, memoryGaps);
    return Array.isArray(saved) ? saved : [];
}

export function clearKnowledgeGaps() {
    writeStore(JEV_GAPS_KEY, [], (v) => { memoryGaps = v; });
    return [];
}

// 导出缺口为带元信息的 JSON 文本（⚙️ 卡「导出缺口」下载用）：可直接当知识库迭代的需求清单
export function exportKnowledgeGapsJson() {
    const gaps = getKnowledgeGaps();
    return JSON.stringify({ exportedAt: new Date().toISOString(), count: gaps.length, gaps }, null, 2);
}
