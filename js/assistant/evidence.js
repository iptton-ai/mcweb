// ==================== assistant/evidence.js ====================
// Jev 证据回路纯函数组（docs/jev-evidence-loop-plan.md §3.3/§4，批次 E3）：
// 主 LLM 开工前用 plan_conditions 登记 1~6 条可核验条件 → 工具结果回来后把
// 「用户原话 + 证据摘要」发一次 systemone 批量判定（每条件一个 noul + 冲突/遗漏两问）
// → decideEvidenceGate 决定放行收束，还是把低分条件拼成缺口提示续检一轮。
// 铁律与 jev.js 同源：未配置/任何异常一律 {ok:false}（fail-open：调用方跳过校验照旧走，
// 提速件绝不能变成故障件，绝不抛错阻塞主循环）；本模块全部 Node 可直测，无浏览器依赖。

import { callJev, DEFAULT_JEV_CONFIG } from './jev.js';

// 证据摘要三级预算：最近 ≤maxMsgs 条工具结果、单条 ≤perMsg 字、总计 ≤total 字
// （systemone state 上限 4000，留余量给用户原话，防止截断吃掉判定上下文——方案 §6 风险 2）
export const DIGEST_LIMITS = { maxMsgs: 3, perMsg: 1000, total: 3600 };

const DIGEST_SEP = '\n─────\n';

/**
 * 证据摘要：从 toolMsgs（agent 循环的 API 消息数组即可，内部过滤）取最近 ≤maxMsgs 条
 * role='tool' 消息内容，各截 perMsg 字，总预算 total 封顶（分隔符计入预算，超预算丢最旧）。
 * 返回拼接字符串（空输入/无 tool 消息 → 空串）。
 */
export function buildEvidenceDigest(toolMsgs, opts = {}) {
    const lim = { ...DIGEST_LIMITS, ...(opts || {}) };
    const list = Array.isArray(toolMsgs) ? toolMsgs : [];
    const parts = []; // 旧 → 新（unshift 回正序）
    let used = 0;
    for (let i = list.length - 1; i >= 0 && parts.length < lim.maxMsgs; i--) {
        const m = list[i];
        if (!m || m.role !== 'tool') continue;
        let text = String(m.content || '');
        if (text.length > lim.perMsg) text = text.slice(0, lim.perMsg);
        const sepLen = parts.length ? DIGEST_SEP.length : 0;
        const room = lim.total - used - sepLen;
        if (room <= 0) break; // 总预算用尽：更旧的结果直接丢
        if (text.length > room) text = text.slice(0, room);
        if (!text) continue; // 空内容的结果跳过，继续找更旧的
        parts.unshift(text);
        used += sepLen + text.length;
    }
    return parts.join(DIGEST_SEP);
}

/**
 * 证据判定请求体：state = 用户原话 + 证据摘要（整体截断 ≤4000），
 * questions = 每条件一个 noul「现有证据是否足以支持该条件：<text>」
 *           + ev_conflict（证据间是否互相矛盾或与请求冲突）
 *           + ev_missing（是否有明显遗漏的必查项）。
 */
export function buildEvidenceRequest(userText, conditions, digest, cfg = {}) {
    const questions = {};
    for (const c of Array.isArray(conditions) ? conditions : []) {
        if (!c || !c.id) continue;
        questions[`cond_${c.id}`] = {
            type: 'noul',
            instructions: `现有证据是否足以支持该条件：${String(c.text || '')}`,
        };
    }
    questions.ev_conflict = {
        type: 'noul',
        instructions: '现有证据之间是否互相矛盾，或与用户请求冲突',
    };
    questions.ev_missing = {
        type: 'noul',
        instructions: '是否有明显遗漏的必查项（该查而没查的关键证据）',
    };
    return {
        model: cfg.model || DEFAULT_JEV_CONFIG.model,
        state: `用户请求：${String(userText || '')}\n\n证据摘要（最近的工具结果）：\n${String(digest || '')}`.slice(0, 4000),
        questions,
    };
}

/**
 * 解析 answers：抽每条件分数（缺答案 = 0，保守判不支持）与 conflict / missing；
 * conditions 以 {id,text} 原样带回（decideEvidenceGate 拼 gaps 缺口列表要用原文）。
 */
export function parseEvidence(answers, conditions) {
    const conds = (Array.isArray(conditions) ? conditions : []).filter((c) => c && c.id);
    const scores = {};
    for (const c of conds) {
        scores[c.id] = answers?.[`cond_${c.id}`]?.noul ?? 0;
    }
    return {
        scores,
        conflict: answers?.ev_conflict?.noul ?? 0,
        missing: answers?.ev_missing?.noul ?? 0,
        conditions: conds.map((c) => ({ id: c.id, text: String(c.text || '') })),
    };
}

/**
 * 停止门（纯函数）：全部条件支持度 ≥minSupport（缺省 0.6）且 conflict < maxConflict
 * （缺省 0.5，恰好 0.5 视为有冲突不放行）→ {pass:true}；
 * 否则 {pass:false, gaps:[{id,text,score}]}，gaps 只含低分条件（原文+分数）。
 */
export function decideEvidenceGate(parsed, opts = {}) {
    const { minSupport = 0.6, maxConflict = 0.5 } = opts || {};
    const scores = (parsed && parsed.scores) || {};
    const conflict = parsed ? (parsed.conflict ?? 0) : 0;
    const conditions = (parsed && parsed.conditions) || [];
    const gaps = [];
    for (const c of conditions) {
        const score = scores[c.id] ?? 0;
        if (score < minSupport) gaps.push({ id: c.id, text: c.text, score });
    }
    // 没有任何条件时门视为不过（零条件的「全过」是空话，防御 parsed 缺失/畸形输入）
    return { pass: conditions.length > 0 && gaps.length === 0 && conflict < maxConflict, gaps };
}

/**
 * 编排一次证据 checkpoint：摘要 → 请求 → callJev → 解析 → 门控。
 * 输出契约（§4）：成功 {ok:true, scores, conflict, missing, conditions, gate, elapsedMs}；
 * 未配置/条件为空/用户中止/网关失败/任何异常 → {ok:false, reason, error?, elapsedMs}
 * （fail-open：调用方拿到 ok:false 就跳过校验照旧走）。
 */
export async function checkEvidence(userText, conditions, toolMsgs, cfg, signal) {
    const t0 = Date.now();
    try {
        const conds = (Array.isArray(conditions) ? conditions : []).filter((c) => c && c.id && c.text);
        // 未配置（与 jev.js isJevConfigured 同一判定）或没有条件：不发请求，静默跳过
        if (!cfg || !cfg.enabled || !cfg.apiKey || !cfg.gateway || !conds.length) {
            return { ok: false, reason: 'unconfigured', elapsedMs: Date.now() - t0 };
        }
        const request = buildEvidenceRequest(userText, conds, buildEvidenceDigest(toolMsgs), cfg);
        const answers = await callJev(request, cfg, signal);
        if (signal?.aborted) return { ok: false, reason: 'aborted', elapsedMs: Date.now() - t0 };
        if (!answers) return { ok: false, reason: 'no_answers', elapsedMs: Date.now() - t0 };
        const parsed = parseEvidence(answers, conds);
        const gate = decideEvidenceGate(parsed);
        return { ok: true, ...parsed, gate, elapsedMs: Date.now() - t0 };
    } catch (e) {
        // 网关不可达/超时等任何异常：跳过校验照旧走（提速件绝不能变成故障件）
        return {
            ok: false,
            reason: 'error',
            error: e?.message ? String(e.message) : String(e),
            elapsedMs: Date.now() - t0,
        };
    }
}
