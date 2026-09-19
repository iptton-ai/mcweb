// tools/test_question_bank.mjs —— 我的题库纯模块单测（node:test，平铺录题批次 2026-09-18）
// js/questionBank.js 零依赖、localStorage 访问全部运行时守卫（Node 无 localStorage 时降级内存态），
// 可直接 import；持久化路径用 globalThis.localStorage 垫片验证。隔离用 URL query 拿新模块实例。
// 运行：cd <仓库根> && node --test tools/test_question_bank.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOD_URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'questionBank.js')).href;

// localStorage 垫片（每次实例化独立 store，模拟真实存取）
function makeLS() {
    const store = new Map();
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
    };
}

async function freshInstance(ls) {
    if (ls) globalThis.localStorage = ls;
    else delete globalThis.localStorage;
    const url = MOD_URL + '?t=' + Math.random().toString(36).slice(2);
    return import(url);
}

const inputQ = { subject: 'math', kind: 'input', stem: ' 3×4+5 ', answer: 17, hint: ' 先乘除 ', unit: ' 三上·混合运算 ' };
const choiceQ = {
    subject: 'science', kind: 'choice', stem: '水沸腾的温度大约是？',
    options: ['60℃', '100℃', '120℃'], answer: 1, unit: '三上·水',
};

test('校验：合法 input 与 choice 通过', async () => {
    const qb = await freshInstance(makeLS());
    assert.equal(qb.validateBankQuestion(inputQ).ok, true);
    assert.equal(qb.validateBankQuestion(choiceQ).ok, true);
});

test('校验：学科必须是五枚举（自拟不是学科）', async () => {
    const qb = await freshInstance(makeLS());
    const r = qb.validateBankQuestion({ ...inputQ, subject: 'custom' });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /学科/);
});

test('校验：数字题答案必须 0..9999 整数（含 NaN 挡空串）', async () => {
    const qb = await freshInstance(makeLS());
    for (const ans of [-1, 10000, 1.5, NaN, '17']) {
        assert.equal(qb.validateBankQuestion({ ...inputQ, answer: ans }).ok, false, String(ans));
    }
    assert.equal(qb.validateBankQuestion({ ...inputQ, answer: 0 }).ok, true);
    assert.equal(qb.validateBankQuestion({ ...inputQ, answer: 9999 }).ok, true);
});

test('校验：选择题选项 3~4 条、非空、不重复、正确项索引合法', async () => {
    const qb = await freshInstance(makeLS());
    assert.equal(qb.validateBankQuestion({ ...choiceQ, options: ['a', 'b'] }).ok, false); // 只有 2 条
    assert.equal(qb.validateBankQuestion({ ...choiceQ, options: ['a', 'b', 'c', 'd', 'e'] }).ok, false); // 5 条
    assert.equal(qb.validateBankQuestion({ ...choiceQ, options: ['a', 'b', ''] }).ok, false); // 空选项
    assert.equal(qb.validateBankQuestion({ ...choiceQ, options: ['a', 'a', 'b'] }).ok, false); // 重复
    assert.equal(qb.validateBankQuestion({ ...choiceQ, options: ['a', 'b', 'c'], answer: 3 }).ok, false); // 越界
    assert.equal(qb.validateBankQuestion({ ...choiceQ, options: ['a', 'b', 'c'], answer: -1 }).ok, false);
});

test('校验：题干空 / 未知题型 / hint 非字符串 拒绝', async () => {
    const qb = await freshInstance(makeLS());
    assert.equal(qb.validateBankQuestion({ ...inputQ, stem: '   ' }).ok, false);
    assert.equal(qb.validateBankQuestion({ ...inputQ, kind: 'poll' }).ok, false);
    assert.equal(qb.validateBankQuestion({ ...inputQ, hint: 42 }).ok, false);
});

test('新增：生成 id、新题在队首、trim 收敛、落 localStorage', async () => {
    const ls = makeLS();
    const qb = await freshInstance(ls);
    const r1 = qb.saveBankQuestion(inputQ);
    assert.equal(r1.ok, true);
    assert.match(r1.entry.id, /^q-/);
    const r2 = qb.saveBankQuestion(choiceQ);
    assert.equal(r2.ok, true);
    const list = qb.listBankQuestions();
    assert.equal(list.length, 2);
    assert.equal(list[0].id, r2.entry.id); // 新题在前
    assert.equal(list[0].stem, choiceQ.stem);
    assert.equal(list[1].stem, '3×4+5'); // trim 过
    assert.equal(list[1].hint, '先乘除');
    assert.equal(list[1].unit, '三上·混合运算');
    // 真落盘：垫片里能读回同样的数据
    const round = JSON.parse(ls.getItem(qb.BANK_KEY));
    assert.equal(round.length, 2);
    assert.equal(round[0].stem, choiceQ.stem);
});

test('更新：按 id 覆盖字段、保留 created、刷新 updated', async () => {
    const qb = await freshInstance(makeLS());
    const r = qb.saveBankQuestion(inputQ);
    const oldId = r.entry.id;
    const oldCreated = r.entry.created;
    const oldUpdated = r.entry.updated; // 更新是原地 mutate，先留影再改
    await new Promise((res) => setTimeout(res, 5)); // 保证 updated 时间戳前移
    const r2 = qb.saveBankQuestion({ ...inputQ, id: oldId, stem: '5+5', answer: 10, hint: '' });
    assert.equal(r2.ok, true);
    const got = qb.getBankQuestion(oldId);
    assert.equal(got.stem, '5+5');
    assert.equal(got.answer, 10);
    assert.equal(got.created, oldCreated);
    assert.ok(got.updated > oldUpdated);
    assert.equal(got.hint, undefined); // 空串 hint 不落库（契约可选字段）
    assert.equal(qb.countBankQuestions(), 1); // 更新不新增条目
});

test('更新：题型切换不留旧形状的键（choice→input 无 options，input→choice 无残字段）', async () => {
    const qb = await freshInstance(makeLS());
    const r = qb.saveBankQuestion(choiceQ);
    const id = r.entry.id;
    qb.saveBankQuestion({ ...inputQ, id, stem: '改成数字题', answer: 7 });
    const got = qb.getBankQuestion(id);
    assert.equal(got.kind, 'input');
    assert.equal(got.options, undefined); // 旧 options 必须删干净（残留会污染导出卡）
    const r2 = qb.saveBankQuestion({ ...choiceQ, id, stem: '改回选择题', options: ['a', 'b', 'c'], answer: 2 });
    assert.equal(r2.ok, true);
    const got2 = qb.getBankQuestion(id);
    assert.equal(got2.kind, 'choice');
    assert.deepEqual(got2.options, ['a', 'b', 'c']);
});

test('更新：id 不存在报错；非法题拒绝且不改动库', async () => {
    const qb = await freshInstance(makeLS());
    const r = qb.saveBankQuestion({ ...inputQ, id: 'q-nope' });
    assert.equal(r.ok, false);
    assert.match(r.error, /不存在/);
    const bad = qb.saveBankQuestion({ ...inputQ, answer: 99999 });
    assert.equal(bad.ok, false);
    assert.equal(qb.countBankQuestions(), 0);
});

test('删除：删掉返回 true，再删返回 false', async () => {
    const qb = await freshInstance(makeLS());
    const { entry } = qb.saveBankQuestion(inputQ);
    assert.equal(qb.deleteBankQuestion(entry.id), true);
    assert.equal(qb.deleteBankQuestion(entry.id), false);
    assert.equal(qb.countBankQuestions(), 0);
});

test('容量上限：MAX_BANK_QUESTIONS 条后新增被拦', async () => {
    const qb = await freshInstance(makeLS());
    for (let i = 0; i < qb.MAX_BANK_QUESTIONS; i++) {
        const r = qb.saveBankQuestion({ ...inputQ, stem: '题' + i });
        assert.equal(r.ok, true, '第 ' + i + ' 条');
    }
    const full = qb.saveBankQuestion(inputQ);
    assert.equal(full.ok, false);
    assert.match(full.error, /上限/);
    // 但更新已有题不受上限影响
    const first = qb.listBankQuestions().at(-1); // 最早入库的在队尾
    const upd = qb.saveBankQuestion({ ...inputQ, id: first.id, stem: '改' });
    assert.equal(upd.ok, true);
});

test('加载容错：localStorage 里的坏条目被丢弃、坏 JSON 当空库', async () => {
    const ls = makeLS();
    const qbA = await freshInstance(ls);
    const { entry } = qbA.saveBankQuestion(inputQ);
    // 手塞一条坏数据（学科非法）+ 保持好的一条
    const raw = JSON.parse(ls.getItem(qbA.BANK_KEY));
    raw.push({ id: 'q-bad', subject: 'nope', kind: 'input', stem: '坏题', answer: 1 });
    ls.setItem(qbA.BANK_KEY, JSON.stringify(raw));
    delete globalThis.localStorage;
    const qbB = await import(MOD_URL + '?t=' + Math.random().toString(36).slice(2)); // 全新实例读同一 ls
    globalThis.localStorage = ls;
    const list = qbB.listBankQuestions();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, entry.id);
    // 坏 JSON：当空库不抛
    ls.setItem(qbA.BANK_KEY, '{broken json');
    const qbC = await import(MOD_URL + '?t=' + Math.random().toString(36).slice(2));
    assert.equal(qbC.countBankQuestions(), 0);
});

test('无 localStorage 环境（Node/隐私模式）：CRUD 降级内存态不抛错', async () => {
    const qb = await freshInstance(null);
    const r = qb.saveBankQuestion(choiceQ);
    assert.equal(r.ok, true);
    assert.equal(r.persisted, false); // 明示没落盘
    assert.equal(qb.countBankQuestions(), 1);
    assert.equal(qb.deleteBankQuestion(r.entry.id), true);
    assert.equal(qb.countBankQuestions(), 0);
});
