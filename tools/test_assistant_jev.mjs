// tools/test_assistant_jev.mjs —— 助手 Jev 快速路由单测（node:test）
// js/assistant/jev.js 纯数据+纯函数（章节 import 自 knowledge.js），Node 可直连。
// 运行：cd <仓库根> && node --test tools/test_assistant_jev.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_JEV_CONFIG, getJevConfig, saveJevConfig, isJevConfigured,
    BUILD_MODULE_IDS,
    buildRouteRequest, decideRoute, formatDirectAnswer, buildPrefetchHint,
    extractModules, mergePrefetchSections, parseHeaders,
    callJev, jevPreflight,
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

test('callJev：网关不可达/未配置 → 返回 null（静默降级，不抛错）', async () => {
    const dead = await callJev(
        buildRouteRequest('测试', {}),
        { gateway: 'http://127.0.0.1:9/api/jev', apiKey: 'k', timeoutMs: 1500 },
        undefined,
    );
    assert.equal(dead, null);
});

test('jevPreflight：未启用直接返回 null，不发起网络请求', async () => {
    saveJevConfig({ enabled: false });
    assert.equal(await jevPreflight('红石灯怎么点亮'), null);
});
