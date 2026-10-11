// tools/test_assistant_jev.mjs —— 助手 Jev 快速路由单测（node:test）
// js/assistant/jev.js 纯数据+纯函数（章节 import 自 knowledge.js），Node 可直连。
// 运行：cd <仓库根> && node --test tools/test_assistant_jev.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_JEV_CONFIG, getJevConfig, saveJevConfig, isJevConfigured,
    BUILD_MODULE_IDS,
    buildRouteRequest, decideRoute, formatDirectAnswer, buildPrefetchHint,
    extractModules, mergePrefetchSections, parseHeaders, normalizeGateway,
    callJev, jevPreflight,
    bumpJevStats, getJevStats, resetJevStats,
    logKnowledgeGap, getKnowledgeGaps, clearKnowledgeGaps, exportKnowledgeGapsJson,
} from '../js/assistant/jev.js';
import { KNOWLEDGE_SECTIONS, searchKnowledge } from '../js/assistant/knowledge.js';

// ---------- 配置 ----------

test('配置：默认关闭、网关不内置（私有中转不入库）、模型 pin 固定版本', () => {
    const c = getJevConfig();
    assert.equal(c.enabled, false);
    assert.equal(c.gateway, '');
    assert.equal(c.model, 'jev-1.13.0');
    assert.ok(c.minConfidence > 0.5 && c.minConfidence <= 1);
});

test('parseHeaders：多行 Key: Value 解析，坏行忽略，同名后者覆盖', () => {
    assert.deepEqual(parseHeaders('X-A: 1\nX-B: 2\n\nbad line\nX-A: 3'), { 'X-A': '3', 'X-B': '2' });
    assert.deepEqual(parseHeaders(''), {});
    assert.deepEqual(parseHeaders(null), {});
    assert.deepEqual(parseHeaders(' : novalue\nnocolon\nX:'), {});
});

test('配置：saveJevConfig 合并生效（Node 无 localStorage 走内存兜底）', () => {
    const c = saveJevConfig({ enabled: true, apiKey: 'apikey_test', gateway: 'https://relay.example.local/api/jev' });
    assert.equal(c.enabled, true);
    assert.equal(c.apiKey, 'apikey_test');
    assert.equal(getJevConfig().model, DEFAULT_JEV_CONFIG.model); // 未改字段保持默认
    assert.equal(isJevConfigured(), true);
    saveJevConfig({ enabled: false, apiKey: '', gateway: '' }); // 还原，避免影响其他用例
    assert.equal(isJevConfigured(), false);
});

// ---------- 请求构造 ----------

test('请求：三问并行，章节 criteria 覆盖 15 节 + other，state 截断 4000', () => {
    const req = buildRouteRequest('红石灯怎么点亮？', getJevConfig());
    assert.equal(req.model, getJevConfig().model);
    assert.equal(req.state, '红石灯怎么点亮？');
    assert.equal(req.questions.intent.type, 'choice');
    assert.equal(req.questions.is_quiz_answer.type, 'noul');
    const criteria = req.questions.section.criteria;
    assert.equal(Object.keys(criteria).length, KNOWLEDGE_SECTIONS.length + 1);
    for (const s of KNOWLEDGE_SECTIONS) assert.ok(criteria[s.id], `缺章节 ${s.id}`);
    assert.ok(criteria.other);
    const long = 'x'.repeat(5000);
    assert.equal(buildRouteRequest(long).state.length, 4000);
});

// ---------- 决策 ----------

const faqHigh = {
    intent: { type: 'choice', choice: 'faq', confidence: 0.95 },
    section: { type: 'choice', choice: 'redstone', confidence: 0.97 },
    is_quiz_answer: { type: 'noul', noul: 0.02 },
};

test('决策：高置信 FAQ+章节命中 → direct（可跳过主模型）', () => {
    const d = decideRoute(faqHigh, { minConfidence: 0.8 });
    assert.equal(d.action, 'direct');
    assert.equal(d.sectionId, 'redstone');
});

test('决策：置信度低于门槛 → 降级 prefetch（预取注入，不直答）', () => {
    const d = decideRoute({
        intent: { choice: 'faq', confidence: 0.6 },
        section: { choice: 'kinetic', confidence: 0.6 },
        is_quiz_answer: { noul: 0.1 },
    }, { minConfidence: 0.8 });
    assert.equal(d.action, 'prefetch');
});

test('决策：非 FAQ 意图（建造/闲聊）→ 永不直答', () => {
    for (const intent of ['build', 'code', 'chat']) {
        const d = decideRoute({ ...faqHigh, intent: { ...faqHigh.intent, choice: intent } }, { minConfidence: 0.8 });
        assert.equal(d.action, 'prefetch');
    }
});

test('决策：疑似索要闯关答案（noul≥0.5）→ none，置信度再高也不直答（只收紧不放松）', () => {
    const d = decideRoute({ ...faqHigh, is_quiz_answer: { noul: 0.6 } }, { minConfidence: 0.8 });
    assert.equal(d.action, 'none');
    assert.equal(d.reason, 'quiz_answer');
});

test('决策：闯关模式一律 none（苏格拉底红线交给主 LLM 兜底）', () => {
    assert.equal(decideRoute(faqHigh, { minConfidence: 0.8, inLevelRun: true }).action, 'none');
});

test('决策：章节 other / 低章节置信 / answers 缺失 → none', () => {
    const other = decideRoute({ ...faqHigh, section: { choice: 'other', confidence: 0.99 } }, { minConfidence: 0.8 });
    assert.equal(other.action, 'none');
    const lowSec = decideRoute({
        intent: { choice: 'faq', confidence: 0.99 },
        section: { choice: 'mobs', confidence: 0.3 },
    }, { minConfidence: 0.8 });
    assert.equal(lowSec.action, 'none');
    assert.equal(decideRoute(null).action, 'none');
    assert.equal(decideRoute({}).action, 'none');
});

// ---------- 文案 ----------

test('直答文案：含章节标题与正文，超长截断', () => {
    const sec = KNOWLEDGE_SECTIONS.find((s) => s.id === 'redstone');
    const out = formatDirectAnswer(sec);
    assert.ok(out.includes(sec.title));
    assert.ok(out.length > 100);
    const capped = formatDirectAnswer({ title: 'T', text: 'y'.repeat(3000) }, 1500);
    assert.ok(capped.length < 1700);
    assert.ok(capped.includes('截断'));
    assert.equal(formatDirectAnswer(null), '');
});

test('预取注入：Jev 章节优先且与本地检索去重，总量封顶', () => {
    const redstone = KNOWLEDGE_SECTIONS.find((s) => s.id === 'redstone');
    const hint = buildPrefetchHint('红石灯怎么点亮', [redstone, redstone, ...searchKnowledge('红石 灯', 2)]);
    assert.ok(hint.includes('【redstone｜'));
    assert.ok(hint.length <= 3400); // 3000 预算 + 头部说明
    assert.equal(buildPrefetchHint('x', []).length, 0);
    assert.equal(buildPrefetchHint('x', null).length, 0);
});

// ---------- 建造系统 fan-out（2026-09-21 批次二）----------

test('模组 fan-out：请求体每个建造系统一个 noul，抽取按阈值过滤', () => {
    assert.ok(BUILD_MODULE_IDS.length >= 4, '建造系统太少，fan-out 没意义');
    const req = buildRouteRequest('盖个带红石灯的房子', {});
    for (const id of BUILD_MODULE_IDS) {
        assert.equal(req.questions['mod_' + id]?.type, 'noul', `缺 mod_${id} 问题`);
    }
    const mods = extractModules({
        mod_redstone: { noul: 0.9 }, mod_kinetic: { noul: 0.49 }, mod_piston: { noul: 0.5 },
    });
    assert.deepEqual(mods.sort(), ['piston', 'redstone']);
    assert.deepEqual(extractModules(null), []);
    assert.deepEqual(extractModules({}), []);
});

test('决策：建造意图章节未命中但模组命中 → prefetch 且带 moduleIds', () => {
    const d = decideRoute({
        intent: { choice: 'build', confidence: 0.9 },
        section: { choice: 'other', confidence: 0.8 },
        mod_redstone: { noul: 0.85 },
    }, { minConfidence: 0.8 });
    assert.equal(d.action, 'prefetch');
    assert.equal(d.sectionId, null);
    assert.deepEqual(d.moduleIds, ['redstone']);
});

test('决策：直答携带 moduleIds（回归：fan-out 不影响直答路径）', () => {
    const d = decideRoute({ ...faqHigh, mod_kinetic: { noul: 0.7 } }, { minConfidence: 0.8 });
    assert.equal(d.action, 'direct');
    assert.deepEqual(d.moduleIds, ['kinetic']);
});

test('决策：模组未命中 + 非 build/code 意图 → none（闲聊不预取）', () => {
    const d = decideRoute({
        intent: { choice: 'chat', confidence: 0.95 },
        section: { choice: 'other', confidence: 0.9 },
        mod_redstone: { noul: 0.2 },
    }, { minConfidence: 0.8 });
    assert.equal(d.action, 'none');
});

test('合并：Jev 章节 → 模组节 → 本地检索，去重保序', () => {
    const byId = (id) => KNOWLEDGE_SECTIONS.find((s) => s.id === id);
    const merged = mergePrefetchSections(
        byId('kinetic'),
        [byId('kinetic'), byId('redstone')],
        [byId('kinetic'), byId('elevator')],
    );
    assert.deepEqual(merged.map((s) => s.id), ['kinetic', 'redstone', 'elevator']);
    assert.deepEqual(mergePrefetchSections(null, [], []), []);
});

// ---------- 网络（仅本地快速失败路径，不访问外网）----------

test('callJev：网关不可达 → 抛出带原因的错误（静默降级由 jevPreflight 兜底）', async () => {
    await assert.rejects(
        callJev(buildRouteRequest('测试', {}), { gateway: 'http://127.0.0.1:9/api/jev', apiKey: 'k', timeoutMs: 1500 }, undefined),
        /网关连接失败/,
    );
});

test('normalizeGateway：只填域名自动补 /api/jev，带路径/非法输入原样保留', () => {
    assert.equal(normalizeGateway('https://jev-api.pan2017.cn'), 'https://jev-api.pan2017.cn/api/jev');
    assert.equal(normalizeGateway('https://jev-api.pan2017.cn/'), 'https://jev-api.pan2017.cn/api/jev');
    assert.equal(normalizeGateway('https://relay.example.com/my/jev'), 'https://relay.example.com/my/jev');
    assert.equal(normalizeGateway('https://relay.example.com/my/jev/'), 'https://relay.example.com/my/jev');
    assert.equal(normalizeGateway('  '), '');
    assert.equal(normalizeGateway('not a url'), 'not a url');
});

test('jevPreflight：未启用直接返回 null，不发起网络请求', async () => {
    saveJevConfig({ enabled: false });
    assert.equal(await jevPreflight('红石灯怎么点亮'), null);
});

test('jevPreflight：调用失败仍返回 none + 失败详情（会话卡片要展示这次调用）', async () => {
    saveJevConfig({ enabled: true, apiKey: 'k', gateway: 'http://127.0.0.1:9/api/jev' });
    const r = await jevPreflight('红石灯怎么点亮');
    assert.equal(r.action, 'none');
    assert.equal(r.detail.ok, false);
    assert.ok(r.detail.error);
    assert.equal(typeof r.detail.elapsedMs, 'number');
    saveJevConfig({ enabled: false, apiKey: '', gateway: '' }); // 还原
});

// ---------- 批次 E2：复合直答 / 路由统计 / 知识缺口 ----------

test('复合直答：主节+伴随节合并渲染（顺序正确、伴随节带「相关章节」标记、结尾引导语保留）', () => {
    const a = KNOWLEDGE_SECTIONS.find((s) => s.id === 'redstone');
    const b = KNOWLEDGE_SECTIONS.find((s) => s.id === 'mobs');
    const out = formatDirectAnswer([a, b]);
    assert.ok(out.includes('快速回答'));
    assert.ok(out.includes('相关章节'));
    assert.ok(out.indexOf(a.title) < out.indexOf(b.title), '主节应排在伴随节之前');
    assert.ok(out.includes('想深入了解、或要我动手做点什么'), '既有结尾引导语要保留');
    assert.equal(formatDirectAnswer([]), '');
});

test('复合直答：总预算 ≤2000（超长节各自截断且保留截断提示），单节路径不受影响', () => {
    const long = (t, n) => ({ id: t, title: t, text: t.repeat(n) });
    const merged = formatDirectAnswer([long('甲', 1500), long('乙', 1500)]); // 两节合计 3000 > 2000 预算
    assert.ok(merged.length <= 2000, `合并输出 ${merged.length} 字符，超预算`);
    assert.ok(merged.includes('截断'));
    const single = formatDirectAnswer([long('丙', 3000)]); // 单节 3000 字超预算
    assert.ok(single.length <= 2000, `单节输出 ${single.length} 字符，超预算`);
    assert.ok(single.includes('截断'));
});

test('直答来源行：有 sources 渲染「来源：」行，无 sources 容错跳过（E1 数据未就绪也不报错）', () => {
    const withSrc = { id: 'a', title: '有源', text: '正文', sources: ['js/a.js', 'js/b.js'] };
    const withSrc2 = { id: 'b', title: '也有源', text: '正文', sources: ['js/c.js'] };
    const bare = { id: 'c', title: '无源', text: '正文' };
    const out = formatDirectAnswer([withSrc, bare]);
    assert.ok(out.includes('来源：js/a.js、js/b.js'));
    assert.ok(!out.includes('来源：js/c.js'), '无 sources 的伴随节不该渲染来源行');
    const both = formatDirectAnswer([withSrc, withSrc2]);
    assert.ok(both.includes('来源：js/a.js、js/b.js'));
    assert.ok(both.includes('来源：js/c.js'));
    // sources 为空数组 / 非数组 / 整节缺失，全都不渲染该行也不抛错
    assert.equal(formatDirectAnswer({ title: 'T', text: 'x', sources: [] }).includes('来源：'), false);
    assert.equal(formatDirectAnswer({ title: 'T', text: 'x', sources: 'js/a.js' }).includes('来源：'), false);
    assert.equal(formatDirectAnswer(null), '');
});

test('路由统计：bumpJevStats 累加动作与耗时，getJevStats 均值可算，resetJevStats 归零', () => {
    resetJevStats(); // 先归零，防前序用例的路由调用污染计数
    bumpJevStats({ direct: 1, elapsedMs: 100 });
    bumpJevStats({ direct: 1, elapsedMs: 200 });
    bumpJevStats({ fail: 1, elapsedMs: 300 });
    let s = getJevStats();
    assert.equal(s.direct, 2);
    assert.equal(s.fail, 1);
    assert.equal(s.prefetch, 0);
    assert.equal(s.none, 0);
    assert.equal(s.count, 3);
    assert.equal(s.totalElapsedMs, 600);
    assert.equal(Math.round(s.totalElapsedMs / s.count), 200); // ⚙️ 卡均耗的算法
    s = resetJevStats();
    assert.deepEqual(s, { direct: 0, prefetch: 0, none: 0, fail: 0, totalElapsedMs: 0, count: 0 });
    assert.deepEqual(getJevStats(), s);
});

test('知识缺口：FIFO 上限 200（挤掉最旧）、元素字段齐全、导出 JSON 结构带元信息', () => {
    clearKnowledgeGaps();
    for (let i = 0; i < 202; i++) {
        logKnowledgeGap({ query: `问题${i}`, section: 'other', reason: 'no_hit' });
    }
    const gaps = getKnowledgeGaps();
    assert.equal(gaps.length, 200);
    assert.equal(gaps[0].query, '问题2');     // 最旧两条已被 FIFO 挤掉
    assert.equal(gaps[199].query, '问题201');
    for (const g of gaps) {
        assert.equal(typeof g.ts, 'number');
        assert.ok('query' in g && 'section' in g && 'reason' in g);
    }
    const parsed = JSON.parse(exportKnowledgeGapsJson());
    assert.equal(parsed.count, 200);
    assert.deepEqual(parsed.gaps, gaps);
    assert.ok(parsed.exportedAt);
    clearKnowledgeGaps(); // 还原，不影响其他用例
    assert.equal(getKnowledgeGaps().length, 0);
});

// mock 网关：走真实 jevPreflight 全链（fetch 替身返回合成 answers），测完 finally 还原现场
function mockJevGateway(answers) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ answers }) });
    return () => { globalThis.fetch = realFetch; };
}

test('jevPreflight：faq 章节未命中且本地检索零命中 → 自动记 no_hit 缺口 + none 统计', async () => {
    saveJevConfig({ enabled: true, apiKey: 'k', gateway: 'https://mock.local/api/jev' });
    const query = '唔噜唔噜'; // 知识库无论如何不该有的词（E1 改版后依然成立）
    assert.equal(searchKnowledge(query).length, 0, '测试前置：该问题本地检索应零命中');
    const restoreFetch = mockJevGateway({
        intent: { type: 'choice', choice: 'faq', confidence: 0.95 },
        section: { type: 'choice', choice: 'other', confidence: 0.9 },
        is_quiz_answer: { type: 'noul', noul: 0.02 },
    });
    try {
        clearKnowledgeGaps();
        resetJevStats();
        const r = await jevPreflight(query);
        assert.equal(r.action, 'none');
        assert.equal(r.detail.ok, true);
        const gaps = getKnowledgeGaps();
        assert.equal(gaps.length, 1);
        assert.equal(gaps[0].query, query);
        assert.equal(gaps[0].section, 'other');
        assert.equal(gaps[0].reason, 'no_hit');
        assert.equal(getJevStats().none, 1);
    } finally {
        restoreFetch();
        clearKnowledgeGaps();
        resetJevStats();
        saveJevConfig({ enabled: false, apiKey: '', gateway: '' });
    }
});

test('jevPreflight：直答路径自动并伴随节 + direct 统计；网关失败单列 fail 不混入 none', async () => {
    saveJevConfig({ enabled: true, apiKey: 'k', gateway: 'https://mock.local/api/jev' });
    const restoreFetch = mockJevGateway(faqHigh);
    try {
        resetJevStats();
        const r = await jevPreflight('红石灯怎么点亮？晚上会不会刷怪？');
        assert.equal(r.action, 'direct');
        assert.equal(r.detail.sections.length, 2, '复合直答应带 1 个伴随节');
        assert.ok(r.answer.includes('相关章节'));
        assert.equal(getJevStats().direct, 1);
        // 失败走 fail 而非 none：降级率要单独可见
        globalThis.fetch = async () => { throw new TypeError('connect ECONNREFUSED'); };
        const f = await jevPreflight('红石灯怎么点亮？');
        assert.equal(f.detail.ok, false);
        assert.equal(getJevStats().fail, 1);
        assert.equal(getJevStats().none, 0, '失败不能计入放行');
    } finally {
        restoreFetch();
        resetJevStats();
        saveJevConfig({ enabled: false, apiKey: '', gateway: '' });
    }
});
