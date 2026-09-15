// ==================== test_edu_progress.mjs（关卡工坊 P2，2026-09-15）====================
// P2「拉力与回流」纯逻辑单测（node:test）。用法：
//   node tools/test_edu_progress.mjs
//
// 为什么提取 eval 而不整模块 import：eduRewards.js 顶部静态依赖链（items/audio → three.js），
// Node 下跑不起来。仓库既有约定（eduKeypad.js PURE 区注释）：可测逻辑收在
// // >>> PURE-BEGIN .. // <<< PURE-END 纯逻辑区内，测试提取全部区文本、剥掉 export 后
// 在函数作用域内 eval。eduStarlight/settingsUI 的 DOM 部分不进 Node（node --check 过即可）。
//
// localStorage 桩挂在 globalThis 上：纯逻辑区里的 eduStoreRead/eduStoreWrite 引用裸标识符
// localStorage，运行期经 globalThis 解析到桩（内存 Map 实现）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// ---------- 提取纯逻辑区并实例化 ----------
const src = await readFile(new URL('../js/eduRewards.js', import.meta.url), 'utf8');
const regionRe = /\/\/ >>> PURE-BEGIN([\s\S]*?)\/\/ <<< PURE-END/g;
let pure = '';
for (const m of src.matchAll(regionRe)) pure += `${m[1]}\n`;
assert.ok(pure.includes('function weekKeyOf'), 'PURE 区应包含 weekKeyOf（标记或函数被挪动了？）');
assert.ok(pure.includes('function addWrongQuestion'), 'PURE 区应包含 addWrongQuestion');

const api = new Function(`${pure.replace(/\bexport\s+/g, '')}
    return { weekKeyOf, unitSequenceFromItems, getProgress, setProgress,
             addWrongQuestion, recordLevelPlay, recordReturnEvent,
             recordHelpRequest, recordEarlyUnlock, getWeeklyReport };`)();

// ---------- localStorage 内存桩 ----------
function installStorageStub() {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    };
    return store;
}
const KEY = 'mcweb.edu.v1';
const readStore = () => JSON.parse(globalThis.localStorage.getItem(KEY));

// ---------- 1) weekKeyOf：ISO 周键正确性 ----------
test('weekKeyOf 基础正确性（ISO 8601：周一为一周之始，含首个周四的周为第 1 周）', () => {
    installStorageStub();
    const wk = (y, m, d) => api.weekKeyOf(new Date(y, m - 1, d));
    // 2026-01-01 是周四 → 属 2026 年第 1 周
    assert.equal(wk(2026, 1, 1), '2026-W01');
    // 2026-09-15（周二，本批次日期）→ W38
    assert.equal(wk(2026, 9, 15), '2026-W38');
    // ISO 年跨年：2025-12-29（周一）属于 2026-W01；2025-12-28（周日）还是 2025-W52
    assert.equal(wk(2025, 12, 29), '2026-W01');
    assert.equal(wk(2025, 12, 28), '2025-W52');
});

test('weekKeyOf 同一 ISO 周内任意一天得到同一键（周一/周日夹逼）', () => {
    installStorageStub();
    const wk = (y, m, d) => api.weekKeyOf(new Date(y, m - 1, d));
    for (const [mon, day] of [[9, 14], [9, 15], [9, 20]]) { // 2026-09-14 周一 … 09-20 周日
        assert.equal(wk(2026, mon, day), '2026-W38');
    }
    // 相邻两周键不同
    assert.notEqual(wk(2026, 9, 13), wk(2026, 9, 14)); // 周日 vs 周一
});

// ---------- 2) unitSequenceFromItems：input+choice 混排保序去重 ----------
test('unitSequenceFromItems 保序去重（input/choice 混排 + 空 unit 丢弃）', () => {
    installStorageStub();
    const items = [
        { kind: 'input', q: '3+4', a: 7, unit: '三上·第二单元' },          // 先出现的在先
        { kind: 'choice', q: '水沸点？', options: ['1', '2', '3'], a: 2, unit: '三上·第一单元' },
        { kind: 'input', q: '5×5', a: 25, unit: '三上·第二单元' },         // 重复 → 去掉
        { kind: 'input', q: '无单元题', a: 1 },                            // 空 unit → 丢弃
        { kind: 'choice', q: 'x', options: ['a', 'b', 'c'], a: 0, unit: '   ' }, // 空白 unit → 丢弃
        { kind: 'input', q: '6×6', a: 36, unit: '三上·第三单元' },
        null, // 脏元素不崩
    ];
    assert.deepEqual(api.unitSequenceFromItems(items), [
        { unit: '三上·第二单元' }, { unit: '三上·第一单元' }, { unit: '三上·第三单元' },
    ]);
    // 非数组入参 → 空序列（不抛）
    assert.deepEqual(api.unitSequenceFromItems(null), []);
    assert.deepEqual(api.unitSequenceFromItems('nope'), []);
});

// ---------- 3) addWrongQuestion：50 条滚动淘汰 ----------
test('addWrongQuestion 上限 50 条，滚动淘汰最旧、保留最新', () => {
    installStorageStub();
    for (let i = 0; i < 55; i++) {
        api.addWrongQuestion({ subject: 'math', unit: `u${i}`, stem: `题${i}`, answer: i, source: '星辉门' });
    }
    const book = readStore().wrongBook;
    assert.equal(book.length, 50);
    assert.equal(book[0].stem, '题5');   // 最旧 5 条被淘汰
    assert.equal(book[49].stem, '题54'); // 最新保留
    assert.equal(book[49].answer, 54);
    assert.equal(book[49].source, '星辉门');
});

test('addWrongQuestion 字段归一化与附加字段（options/hint）', () => {
    installStorageStub();
    api.addWrongQuestion({ subject: 'science', unit: '三上·水', stem: '水沸点？',
        answer: 2, options: ['60℃', '80℃', '100℃'], hint: '标准大气压', source: '关卡「试炼」' });
    const e = readStore().wrongBook[0];
    assert.equal(e.subject, 'science');
    assert.deepEqual(e.options, ['60℃', '80℃', '100℃']);
    assert.equal(e.hint, '标准大气压');
    assert.equal(typeof e.t, 'number'); // 时间戳兜底 Date.now()
    // 非法入参不抛、不产脏条目崩溃
    api.addWrongQuestion(null);
    assert.equal(readStore().wrongBook.length, 2);
    assert.equal(readStore().wrongBook[1].stem, '');
});

// ---------- 4) getWeeklyReport：近 4 周聚合（越窗不计、字段齐备） ----------
test('getWeeklyReport 近 4 周聚合：weekPlays/returnEvents/helpRequests/earlyUnlocks', () => {
    installStorageStub();
    // 注入固定「现在」= 2026-09-15（周二，ISO 2026-W38）→ 4 周窗口 = W35..W38
    const now = new Date(2026, 8, 15);
    const tOf = (y, m, d) => new Date(y, m - 1, d).getTime();
    globalThis.localStorage.setItem(KEY, JSON.stringify({
        metrics: {
            weekPlays: { '2026-W38': 3, '2026-W37': 2, '2026-W30': 9 }, // W30 在窗外
            returnEvents: [
                { t: tOf(2026, 9, 15), unit: '三上·混合运算' }, // 本周 → 计入
                { t: tOf(2026, 8, 25), unit: '三上·倍的认识' }, // 8-25 = W35 → 计入
                { t: tOf(2026, 7, 23), unit: '越窗' },          // 7-23 = W30 → 不计
                { t: '坏数据' },                                // 非法时间戳 → 忽略不崩
            ],
            helpRequests: 7,
            earlyUnlocks: [{ t: 1, unit: 'a' }, { t: 2, unit: 'b' }],
        },
    }));
    const rep = api.getWeeklyReport(now);
    assert.equal(rep.weeks.length, 4);
    assert.deepEqual(rep.weeks.map((w) => w.key),
        ['2026-W35', '2026-W36', '2026-W37', '2026-W38']); // 旧 → 新
    assert.deepEqual(rep.weeks.map((w) => w.plays), [0, 0, 2, 3]);
    assert.deepEqual(rep.weeks.map((w) => w.returns), [1, 0, 0, 1]);
    assert.equal(rep.totalPlays, 5);     // 窗外 W30 的 9 次不计
    assert.equal(rep.totalReturns, 2);
    assert.equal(rep.helpRequests, 7);
    assert.equal(rep.earlyUnlocks, 2);
});

// ---------- 5) 附带：埋点写入链路（recordLevelPlay → weekPlays → 报表） ----------
test('recordLevelPlay/recordReturnEvent 写入当周并可被 getWeeklyReport 读回', () => {
    installStorageStub();
    api.recordLevelPlay();
    api.recordLevelPlay();
    api.recordReturnEvent('三上·混合运算');
    const rep = api.getWeeklyReport(new Date()); // 真实当前时间
    assert.equal(rep.totalPlays, 2);
    assert.equal(rep.totalReturns, 1);
    const w = rep.weeks[rep.weeks.length - 1]; // 最新一桶 = 本周
    assert.equal(w.plays, 2);
    assert.equal(w.returns, 1);
});

// ---------- 6) 附带：进度读写（默认 1 / 脏数据拉回） ----------
test('getProgress 默认三上第 1 单元；setProgress 落盘并容错', () => {
    installStorageStub();
    assert.deepEqual(api.getProgress(), { unit: 1 });
    api.setProgress(5);
    assert.deepEqual(api.getProgress(), { unit: 5 });
    api.setProgress(-3);
    assert.deepEqual(api.getProgress(), { unit: 1 }); // 非法 → 拉回 1
    globalThis.localStorage.setItem(KEY, JSON.stringify({ progress: { unit: 'abc' } }));
    assert.deepEqual(api.getProgress(), { unit: 1 }); // 脏档 → 拉回 1
});
