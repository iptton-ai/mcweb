// tools/test_assistant_evidence.mjs —— Jev 证据回路单测（node:test）
// js/assistant/evidence.js 纯函数组（复用 jev.js callJev），Node 可直连。
// 运行：cd <仓库根> && node --test tools/test_assistant_evidence.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
    DIGEST_LIMITS, buildEvidenceDigest, buildEvidenceRequest,
    parseEvidence, decideEvidenceGate, checkEvidence,
} from '../js/assistant/evidence.js';

const CONDS = [
    { id: 'flat', text: '地基区域已清平' },
    { id: 'walls', text: '四面墙体完整无缺口' },
];

const toolMsg = (content) => ({ role: 'tool', toolCallId: 't1', name: 'read_blocks', content });

// ---------- buildEvidenceDigest：三级截断 ----------

test('digest：只取 role=tool 消息，最近优先，超过 maxMsgs 丢最旧', () => {
    const msgs = [
        { role: 'user', content: '用户消息不算证据' },
        toolMsg('E1'),
        { role: 'assistant', content: '助手消息不算证据' },
        toolMsg('E2'),
        toolMsg('E3'),
        toolMsg('E4'),
    ];
    const d = buildEvidenceDigest(msgs);
    assert.ok(d.includes('E2') && d.includes('E3') && d.includes('E4'), `实际：${d}`);
    assert.ok(!d.includes('E1'), '超过 maxMsgs 应丢最旧');
    assert.ok(!d.includes('用户消息') && !d.includes('助手消息'), '非 tool 消息不得进入摘要');
});

test('digest：单条 perMsg 截断', () => {
    assert.equal(buildEvidenceDigest([toolMsg('x'.repeat(2000))]).length, DIGEST_LIMITS.perMsg);
});

test('digest：总预算 total 封顶（分隔符计入预算，超预算丢最旧）', () => {
    const d = buildEvidenceDigest(
        [toolMsg('a'.repeat(2000)), toolMsg('b'.repeat(2000)), toolMsg('c'.repeat(2000))],
        { perMsg: 2000 },
    );
    assert.ok(d.length <= DIGEST_LIMITS.total, `实际 ${d.length}`);
    assert.ok(d.includes('cccc') && !d.includes('aaaa'), '预算不足时应保新丢旧');
    // 小预算行为核验：结果长度绝不超 total
    const small = buildEvidenceDigest([toolMsg('aaa'), toolMsg('bbb'), toolMsg('ccc')], { perMsg: 10, total: 7 });
    assert.ok(small.length <= 7 && small.includes('ccc'), `实际：${small}`);
});

test('digest：空输入/无 tool 消息 → 空串', () => {
    assert.equal(buildEvidenceDigest([]), '');
    assert.equal(buildEvidenceDigest(null), '');
    assert.equal(buildEvidenceDigest([{ role: 'user', content: 'hi' }]), '');
});

// ---------- buildEvidenceRequest：问题构造与 state 截断 ----------

test('请求：questions = 条件数 + 2（ev_conflict/ev_missing），均为 noul 且带条件原文', () => {
    const req = buildEvidenceRequest('盖一座小屋', CONDS, '证据摘要', { model: 'jev-1.13.0' });
    assert.equal(req.model, 'jev-1.13.0');
    const keys = Object.keys(req.questions);
    assert.equal(keys.length, CONDS.length + 2);
    assert.deepEqual(keys.filter((k) => k.startsWith('cond_')).sort(), ['cond_flat', 'cond_walls']);
    assert.equal(req.questions.cond_flat.type, 'noul');
    assert.ok(req.questions.cond_flat.instructions.includes('地基区域已清平'), '条件原文要进 instructions');
    assert.ok(req.questions.cond_flat.instructions.includes('足以支持'));
    assert.equal(req.questions.ev_conflict.type, 'noul');
    assert.equal(req.questions.ev_missing.type, 'noul');
});

test('请求：state = 用户原话 + 证据摘要，整体截断 ≤4000', () => {
    const req = buildEvidenceRequest('盖一座小屋', CONDS, 'd'.repeat(5000), {});
    assert.ok(req.state.includes('盖一座小屋'), '用户原话要在 state 里');
    assert.ok(req.state.includes('ddd'), '证据摘要要在 state 里');
    assert.ok(req.state.length <= 4000);
    // 用户原话超长同样受 4000 整体截断保护
    const long = buildEvidenceRequest('u'.repeat(5000), CONDS, 'digest', {});
    assert.equal(long.state.length, 4000);
});

test('请求：非法/空条件不产生 cond_* 问题（但保留 ev_* 两问）', () => {
    const req = buildEvidenceRequest('x', [null, {}, { id: '', text: '无 id' }], '', {});
    assert.deepEqual(Object.keys(req.questions).filter((k) => k.startsWith('cond_')), []);
    assert.ok(req.questions.ev_conflict && req.questions.ev_missing);
});

// ---------- parseEvidence：缺答案容错 ----------

test('parse：抽每条件分数与 conflict/missing；缺答案=0（保守），未登记条件的答案忽略', () => {
    const p = parseEvidence({
        cond_flat: { noul: 0.9 },
        ev_conflict: { noul: 0.2 },
        ev_missing: { noul: 0.3 },
        cond_others: { noul: 0.99 }, // 不在登记条件里的答案必须忽略
    }, CONDS);
    assert.equal(p.scores.flat, 0.9);
    assert.equal(p.scores.walls, 0, '缺答案 = 0');
    assert.equal(p.conflict, 0.2);
    assert.equal(p.missing, 0.3);
    assert.deepEqual(p.conditions.map((c) => c.id), ['flat', 'walls']);
    assert.deepEqual(p.conditions.map((c) => c.text), ['地基区域已清平', '四面墙体完整无缺口']);
});

test('parse：answers 缺失/条件为空 → 全 0 且不抛', () => {
    assert.equal(parseEvidence(null, CONDS).scores.flat, 0);
    assert.deepEqual(parseEvidence(undefined, CONDS), {
        scores: { flat: 0, walls: 0 }, conflict: 0, missing: 0,
        conditions: CONDS.map((c) => ({ id: c.id, text: c.text })),
    });
    const empty = parseEvidence({ cond_flat: { noul: 1 } }, []);
    assert.deepEqual(empty.scores, {});
    assert.deepEqual(empty.conditions, []);
});

// ---------- decideEvidenceGate：门控边界与 gaps ----------

test('门控边界：支持度恰好 0.6 算达标，冲突恰好 0.5 算不过', () => {
    const pass = decideEvidenceGate(parseEvidence({
        cond_flat: { noul: 0.6 }, cond_walls: { noul: 0.6 }, ev_conflict: { noul: 0.49 },
    }, CONDS));
    assert.equal(pass.pass, true);
    assert.deepEqual(pass.gaps, []);

    const conflictBoundary = decideEvidenceGate(parseEvidence({
        cond_flat: { noul: 0.9 }, cond_walls: { noul: 0.9 }, ev_conflict: { noul: 0.5 },
    }, CONDS));
    assert.equal(conflictBoundary.pass, false, 'conflict < 0.5 才放行，恰好 0.5 不过');

    const supportBoundary = decideEvidenceGate(parseEvidence({
        cond_flat: { noul: 0.59 }, cond_walls: { noul: 0.9 }, ev_conflict: { noul: 0.1 },
    }, CONDS));
    assert.equal(supportBoundary.pass, false, '0.59 < 0.6 不达标');
});

test('门控：gaps 只含低分条件（原文+分数），高分条件不进', () => {
    const g = decideEvidenceGate(parseEvidence({
        cond_flat: { noul: 0.95 }, cond_walls: { noul: 0.3 }, ev_conflict: { noul: 0.1 },
    }, CONDS));
    assert.equal(g.pass, false);
    assert.deepEqual(g.gaps, [{ id: 'walls', text: '四面墙体完整无缺口', score: 0.3 }]);
});

test('门控：全部低分 → gaps 保序全列；parsed 缺失 → 不过且 gaps 空', () => {
    const g = decideEvidenceGate(parseEvidence({
        cond_flat: { noul: 0.1 }, cond_walls: { noul: 0.2 }, ev_conflict: { noul: 0.8 },
    }, CONDS));
    assert.deepEqual(g.gaps.map((x) => x.id), ['flat', 'walls']);
    const none = decideEvidenceGate(null);
    assert.equal(none.pass, false);
    assert.deepEqual(none.gaps, []);
    // 阈值可覆盖
    const strict = decideEvidenceGate(parseEvidence({
        cond_flat: { noul: 0.7 }, cond_walls: { noul: 0.7 }, ev_conflict: { noul: 0.2 },
    }, CONDS), { minSupport: 0.8 });
    assert.equal(strict.pass, false);
});

// ---------- checkEvidence：编排 + fail-open ----------

test('checkEvidence：未配置（enabled/apiKey/gateway 任一缺失）→ {ok:false} 且不发请求', async () => {
    for (const cfg of [
        { enabled: false, apiKey: 'k', gateway: 'http://127.0.0.1:9/api/jev' },
        { enabled: true, apiKey: '', gateway: 'http://127.0.0.1:9/api/jev' },
        { enabled: true, apiKey: 'k', gateway: '' },
        null,
    ]) {
        const r = await checkEvidence('盖小屋', CONDS, [toolMsg('e')], cfg, undefined);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'unconfigured');
    }
});

test('checkEvidence：条件为空 → {ok:false}', async () => {
    const r = await checkEvidence('x', [], [toolMsg('e')], { enabled: true, apiKey: 'k', gateway: 'http://127.0.0.1:9/api/jev' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unconfigured');
});

test('checkEvidence：网关不可达 → {ok:false}（fail-open，绝不抛错阻塞主循环）', async () => {
    const r = await checkEvidence('盖小屋', CONDS, [toolMsg('evidence')], {
        enabled: true, apiKey: 'k', gateway: 'http://127.0.0.1:9/api/jev', timeoutMs: 1500,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'error');
    assert.ok(r.error, '要带失败原因供卡片展示');
});

// 本地 mock 网关（node:http），验证「请求构造 → answers 解析 → 门控」端到端编排
function startMockJev(answersFor) {
    let captured = null;
    const server = http.createServer((req, resp) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            captured = JSON.parse(raw || '{}');
            resp.writeHead(200, { 'Content-Type': 'application/json' });
            resp.end(JSON.stringify({ answers: answersFor(captured) }));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, getCaptured: () => captured }));
    });
}

const highAnswers = (body) => {
    const answers = {};
    for (const k of Object.keys(body.questions || {})) {
        if (k.startsWith('cond_')) answers[k] = { type: 'noul', noul: 0.9 };
    }
    answers.ev_conflict = { type: 'noul', noul: 0.1 };
    answers.ev_missing = { type: 'noul', noul: 0.1 };
    return answers;
};

test('checkEvidence：mock 网关高分 → ok + 门通过（请求体与结果契约全量核对）', async () => {
    const mock = await startMockJev(highAnswers);
    try {
        const r = await checkEvidence('盖一座小屋', CONDS, [toolMsg('e'.repeat(50))], {
            enabled: true, apiKey: 'k', gateway: `http://127.0.0.1:${mock.port}/api/jev`, timeoutMs: 3000,
        });
        assert.equal(r.ok, true);
        assert.deepEqual(r.scores, { flat: 0.9, walls: 0.9 });
        assert.equal(r.conflict, 0.1);
        assert.equal(r.missing, 0.1);
        assert.equal(r.gate.pass, true);
        assert.deepEqual(r.gate.gaps, []);
        assert.equal(typeof r.elapsedMs, 'number');
        // 请求体核对：state 含用户原话与证据摘要，questions = 条件 + 2
        const sent = mock.getCaptured();
        assert.ok(sent.state.includes('盖一座小屋') && sent.state.includes('eee'));
        assert.ok(sent.questions.cond_flat && sent.questions.cond_walls && sent.questions.ev_conflict && sent.questions.ev_missing);
        assert.ok(sent.questions.cond_flat.instructions.includes('地基区域已清平'));
    } finally {
        mock.server.close();
    }
});

test('checkEvidence：mock 网关低分 → ok 但门不过，gaps 携带低分条件原文', async () => {
    const mock = await startMockJev((body) => {
        const answers = {};
        for (const k of Object.keys(body.questions || {})) {
            if (k.startsWith('cond_')) answers[k] = { type: 'noul', noul: 0.2 };
        }
        answers.ev_conflict = { type: 'noul', noul: 0.6 };
        answers.ev_missing = { type: 'noul', noul: 0.5 };
        return answers;
    });
    try {
        const r = await checkEvidence('盖一座小屋', CONDS, [toolMsg('e')], {
            enabled: true, apiKey: 'k', gateway: `http://127.0.0.1:${mock.port}/api/jev`, timeoutMs: 3000,
        });
        assert.equal(r.ok, true);
        assert.equal(r.gate.pass, false);
        assert.deepEqual(r.gate.gaps.map((g) => g.id), ['flat', 'walls']);
        assert.ok(r.gate.gaps.every((g) => g.score === 0.2 && g.text));
    } finally {
        mock.server.close();
    }
});
