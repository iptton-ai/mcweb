// tools/test_gen_draft.mjs —— gen_level_draft 纯函数冒烟（node --test）
// 测 tools.js 的 DRAFT-PURE 区间：draftHash / pickDraftQuestions / bankItemToCardQuestion。
// tools.js 顶层有浏览器依赖（three/chunk/DOM），无法在 Node 整文件 import——参照
// js/eduKeypad.js 的 PURE 区惯例，按区间标记切片源码、剥掉 export 后用 new Function 求值。
// 运行：cd <仓库根> && node --test tools/test_gen_draft.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'assistant', 'tools.js'), 'utf8');
const m = src.match(/\/\/ >>> DRAFT-PURE-BEGIN([\s\S]*?)\/\/ <<< DRAFT-PURE-END/);
assert(m, 'tools.js 缺少 DRAFT-PURE 纯函数区（标记被移动或改名？）');
// 剥掉 export 关键字后求值（new Function 体内不允许 export 语法）
const code = m[1].replace(/\bexport\s+function\b/g, 'function');
const { pickDraftQuestions, bankItemToCardQuestion } = new Function(`${code}; return { pickDraftQuestions, bankItemToCardQuestion };`)();

// 40 道可区分的假题池
const POOL = Array.from({ length: 40 }, (_, i) => ({ q: `题${i}`, a: i, kind: 'input', unit: '三上·测试' }));

test('确定性：同参数两次抽取结果完全一致', () => {
    const a = pickDraftQuestions(POOL, 100, 64, 200, 3);
    const b = pickDraftQuestions(POOL, 100, 64, 200, 3);
    assert.deepEqual(a, b);
    assert.equal(a.length, 3);
});

test('确定性：不同坐标大概率给出不同题目（哈希分散性抽查）', () => {
    const firsts = new Set();
    for (let i = 0; i < 60; i++) {
        const [r] = pickDraftQuestions(POOL, i * 7, 64, i * 13, 1);
        firsts.add(r.q);
    }
    assert.ok(firsts.size >= 10, `60 个坐标只抽到 ${firsts.size} 种首题，分散性不足`);
});

test('不重复：一次抽 k 道（k≤池长）互不相同', () => {
    for (const k of [1, 2, 5, 40]) {
        const out = pickDraftQuestions(POOL, 9, 9, 9, k);
        assert.equal(out.length, k);
        assert.equal(new Set(out.map((it) => it.q)).size, k, `k=${k} 出现重复题`);
    }
});

test('降级：count 超过池长/为 0/池为空/非数组 → 按实际数量或空数组', () => {
    const small = [{ q: 'a' }, { q: 'b' }, { q: 'c' }];
    assert.equal(pickDraftQuestions(small, 1, 1, 1, 5).length, 3); // 降级到池长
    assert.deepEqual(pickDraftQuestions(small, 1, 1, 1, 0), []);
    assert.deepEqual(pickDraftQuestions(small, 1, 1, 1, -2), []);
    assert.deepEqual(pickDraftQuestions([], 1, 1, 1, 3), []);
    assert.deepEqual(pickDraftQuestions(null, 1, 1, 1, 3), []);
    assert.deepEqual(pickDraftQuestions(POOL, 1, 1, 1, NaN), []); // 非法计数不给题
});

test('默认 count=1：不给 count 只抽一道', () => {
    const out = pickDraftQuestions(POOL, 3, 3, 3);
    assert.equal(out.length, 1);
});

test('题库条目 → 关卡卡题级 schema（契约 §2）：字段映射与 meta.source', () => {
    const choice = bankItemToCardQuestion({ q: '1+1=?', a: 0, kind: 'choice', options: ['2', '3', '4'], hint: '数一数', unit: '三上·加减法' }, 'math');
    assert.deepEqual(choice, {
        subject: 'math', kind: 'choice', stem: '1+1=?', answer: 0,
        options: ['2', '3', '4'], hint: '数一数', unit: '三上·加减法',
        meta: { source: 'bank' },
    });
    const input = bankItemToCardQuestion({ q: '5×6=?', a: 30, kind: 'input' }, 'math');
    assert.deepEqual(input, { subject: 'math', kind: 'input', stem: '5×6=?', answer: 30, meta: { source: 'bank' } });
    assert.equal('options' in input, false, 'input 题不应带 options 字段');
});
