// ==================== test_level_run.mjs ====================
// js/levelRun.js 的 Node 自测（node:test）：`node tools/test_level_run.mjs` 可跑。
// 不经 levelWorkshop（并行代理可能在写）：卡与运行时对象全部手工构造，
// 世界↔局部换算按契约冻结偏移 EMBED_OFFSET{80,4,80} 手算。
// localStorage 用 globalThis 桩（Node 无 localStorage ⇒ 模块内建内存兜底亦可被桩覆盖）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/state.js';
import {
    bumpPlayCount,
    computeStars,
    finishRun,
    getBestScores,
    getCardQuestion,
    getHudState,
    getLevelRun,
    getRespawnPos,
    isLevelRunActive,
    isLockAIHelpFrozen,
    onPlayerDeath,
    recordLockAttempt,
    tickRun,
} from '../js/levelRun.js';

// ---- 手工构造的关卡卡（局部坐标；世界坐标 = 局部 + {x:80, y:4, z:80}）----
const CARD = {
    format: 'mcweb.level.v1',
    name: '自测关卡',
    author: 'A2',
    region: { x0: 0, y0: 0, z0: 0, w: 16, h: 8, d: 16, enc: 'rle', blocks: '' },
    questions: [
        {
            lockType: 'keypad', x: 3, y: 1, z: 3, subject: 'math', kind: 'input',
            stem: '1+1=?', answer: 2, meta: { source: 'custom' },
        }, // 世界块坐标 (83,5,83)
        {
            lockType: 'starlight', x: 6, y: 1, z: 6, subject: 'english', kind: 'choice',
            stem: 'apple', options: ['苹果', '香蕉'], answer: 0, meta: { source: 'custom' },
        }, // 世界块坐标 (86,5,86)
    ],
    rules: { timeLimit: null, lockAIHelp: true },
    flags: {
        start: { x: 1, y: 1, z: 1 },            // 世界 (81,5,81)
        checkpoints: [{ x: 5, y: 1, z: 5 }],    // 世界 (85,5,85)
        goal: { x: 8, y: 1, z: 8 },             // 世界 (88,5,88)
    },
};

const clone = (v) => JSON.parse(JSON.stringify(v));

// 运行时对象（契约 §3.2 结构的同构替身）
function makeRun(overrides = {}) {
    return {
        cardId: 'test-id',
        cardHash: 'hash-test',
        card: clone(CARD),
        spawn: { x: 81, y: 5, z: 81 },
        respawn: { x: 81, y: 5, z: 81 },
        activatedCheckpoints: new Set(),
        timeStart: 300,
        elapsed: 0,
        deaths: 0,
        answers: {},
        rules: { timeLimit: null, lockAIHelp: true },
        restore: { time: 123, gameMode: 'creative' },
        ...overrides,
    };
}

// 站上某局部坐标旗块中心的玩家位置（y=5.6：站在旗块附近地面，y 差 0.6 < 1.5）
const atFlag = (lx, ly, lz) => ({ x: lx + 80 + 0.5, y: ly + 4 + 0.6, z: lz + 80 + 0.5 });
// 远离一切旗的中性点（到最近旗的水平距离 ≥ 2 > 1.2）
const FAR = { x: 92.5, y: 5, z: 70.5 };

// localStorage 桩（内存 Map 兜底）
function installLocalStorage() {
    const m = new Map();
    globalThis.localStorage = {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
    };
    return m;
}

test('computeStars 全分支：3/2(零死亡)/2(全锁最终答对)/1/0(超时)/无锁跑酷', () => {
    const L = (tries, solved = true) => ({ tries, solved });
    assert.equal(computeStars({ deaths: 0, locks: [L(1), L(1)] }), 3);          // 零死亡全锁一次过
    assert.equal(computeStars({ deaths: 0, locks: [L(1), L(3)] }), 2);          // 零死亡但重试过
    assert.equal(computeStars({ deaths: 2, locks: [L(3), L(3)] }), 2);          // 全锁最终答对
    assert.equal(computeStars({ deaths: 2, locks: [L(3), { tries: 2, solved: false }] }), 1); // 通关保底
    assert.equal(computeStars({ deaths: 0, locks: [L(1)], timeout: true }), 0); // 超时=失败零星
    assert.equal(computeStars({ deaths: 0, locks: [] }), 3);                    // 无锁跑酷零死亡
    assert.equal(computeStars({ deaths: 1, locks: [] }), 2);                    // 无锁死一次
});

test('recordLockAttempt：tries 累计、solved 保持，两把锁独立记账', () => {
    const run = makeRun();
    state.levelRun = run;
    recordLockAttempt('3,1,3', false);
    assert.deepEqual(run.answers['3,1,3'], { tries: 1, solved: false });
    recordLockAttempt('3,1,3', true);
    assert.deepEqual(run.answers['3,1,3'], { tries: 2, solved: true });
    recordLockAttempt('6,1,6', true);
    assert.deepEqual(run.answers['6,1,6'], { tries: 1, solved: true }); // 与第一把锁独立
    recordLockAttempt('3,1,3', false); // 已 solved 不被答错降级
    assert.deepEqual(run.answers['3,1,3'], { tries: 3, solved: true });
    state.levelRun = null;
    recordLockAttempt('3,1,3', true); // 非关卡环境安全无操作
    assert.equal(isLevelRunActive(), false);
});

test('tickRun：检查点踩踏切换 respawn + 起点回退 + 重复踩刷新', () => {
    const run = makeRun();
    state.levelRun = run;
    // 踩检查点（局部 5,1,5 → 世界 85,5,85）
    assert.equal(tickRun(run, 0.5, atFlag(5, 1, 5)), null); // 不触发结算
    assert.deepEqual(run.respawn, { x: 85, y: 5, z: 85 });
    assert.ok(run.activatedCheckpoints.has('5,1,5'));
    // 踩起点（局部 1,1,1）→ respawn 刷回起点
    tickRun(run, 0.5, atFlag(1, 1, 1));
    assert.deepEqual(run.respawn, { x: 81, y: 5, z: 81 });
    assert.equal(run.activatedCheckpoints.size, 1); // 起点不进检查点集合
    // 再踩检查点 = 刷新（respawn 重设，幂等不重复入集合）
    tickRun(run, 0.5, atFlag(5, 1, 5));
    assert.deepEqual(run.respawn, { x: 85, y: 5, z: 85 });
    assert.equal(run.activatedCheckpoints.size, 1);
    // 距离阈值外不切换（水平 2 格 > 1.2）
    tickRun(run, 0.5, { x: 87.5, y: 5.6, z: 85.5 });
    assert.deepEqual(run.respawn, { x: 85, y: 5, z: 85 });
    state.levelRun = null;
});

test('tickRun：终点触发结算（注入 onFinish 收结果），finished 后不再触发', () => {
    const run = makeRun();
    run.deaths = 1;
    run.answers = { '3,1,3': { tries: 1, solved: true }, '6,1,6': { tries: 3, solved: true } };
    let got = null;
    const res = tickRun(run, 12.5, atFlag(8, 1, 8), { onFinish: (r) => { got = r; } });
    assert.ok(run.finished, 'run 应标记结束');
    assert.equal(res, got, '返回值与回调收到的应是同一结果');
    assert.equal(res.timeSec, 12.5);
    assert.equal(res.deaths, 1);
    assert.deepEqual(res.locks, [ // locks 按 card.questions 顺序汇总
        { pos: '3,1,3', tries: 1, solved: true },
        { pos: '6,1,6', tries: 3, solved: true },
    ]);
    assert.equal(res.stars, 2); // 有死亡但全锁最终答对
    assert.equal(res.timeout, undefined);
    assert.equal(tickRun(run, 1, FAR), null); // 已结束：不再计时/结算
    assert.equal(run.elapsed, 12.5);
});

test('tickRun：OOB 谓词注入 → 模拟死亡（deaths+1 + onOOB），不结算', () => {
    const run = makeRun();
    let oobCount = 0;
    const res = tickRun(run, 0.1, FAR, { isOOB: () => true, onOOB: () => { oobCount++; } });
    assert.equal(run.deaths, 1);
    assert.equal(oobCount, 1);
    assert.equal(res, null, '掉界不是结算');
    assert.equal(run.finished, undefined);
    tickRun(run, 0.1, FAR, { isOOB: () => true, onOOB: () => { oobCount++; } });
    assert.equal(run.deaths, 2); // 连续掉界连续计数（计时不停）
});

test('tickRun：timeLimit 超时 → 失败结算（stars=0、timeout:true）', () => {
    const run = makeRun();
    run.rules = { timeLimit: 10, lockAIHelp: true };
    let got = null;
    tickRun(run, 6, FAR, { onFinish: (r) => { got = r; } });
    assert.equal(got, null, '未到时限不结算');
    const res = tickRun(run, 6, FAR, { onFinish: (r) => { got = r; } }); // elapsed=12 ≥ 10
    assert.ok(run.finished);
    assert.equal(res, got);
    assert.equal(res.timeout, true);
    assert.equal(res.stars, 0); // 超时零星，不走 1 星保底
    assert.equal(res.timeSec, 12);
});

test('getCardQuestion：世界→局部换算命中两把不同锁，未命中返回 null', () => {
    const run = makeRun();
    state.levelRun = run;
    const q1 = getCardQuestion(83, 5, 83); // 局部 (3,1,3) keypad
    assert.ok(q1 && q1.subject === 'math' && q1.stem === '1+1=?');
    const q2 = getCardQuestion(86, 5, 86); // 局部 (6,1,6) starlight（同一张表不筛 lockType）
    assert.ok(q2 && q2.lockType === 'starlight' && q2.stem === 'apple');
    assert.equal(getCardQuestion(0, 0, 0), null);
    assert.equal(getCardQuestion(83, 6, 83), null); // y 不匹配
    state.levelRun = null;
    assert.equal(getCardQuestion(83, 5, 83), null); // 非关卡环境安全
});

test('getHudState：计时/死亡/解锁计数', () => {
    assert.equal(getHudState(), null); // 非关卡时 null
    const run = makeRun();
    run.elapsed = 12.34;
    run.deaths = 2;
    run.answers = { '3,1,3': { tries: 1, solved: true }, '6,1,6': { tries: 2, solved: false } };
    state.levelRun = run;
    assert.deepEqual(getHudState(), { time: 12.34, deaths: 2, solved: 1, total: 2 });
    state.levelRun = null;
});

test('onPlayerDeath / getRespawnPos / isLockAIHelpFrozen / isLevelRunActive / getLevelRun', () => {
    assert.equal(isLevelRunActive(), false);
    assert.equal(getRespawnPos(), null);
    assert.equal(isLockAIHelpFrozen(), false);
    const run = makeRun();
    run.card.rules = { timeLimit: 30, lockAIHelp: false }; // 考核锁
    state.levelRun = run;
    assert.equal(isLevelRunActive(), true);
    assert.equal(getLevelRun(), run);
    onPlayerDeath();
    assert.equal(run.deaths, 1);
    assert.equal(run.elapsed, 0, '死亡不停表');
    assert.ok(isLockAIHelpFrozen());
    assert.deepEqual(getRespawnPos(), { x: 81, y: 5, z: 81 });
    state.levelRun = null;
});

test('finishRun + 最佳成绩：localStorage 桩落盘、isNewBest、差成绩不降级、plays 累计', () => {
    const store = installLocalStorage();
    // 第一局：全锁最终答对 + 无死亡 → 2 星，新最佳
    const run = makeRun({ cardHash: 'h-finish' });
    run.answers = { '3,1,3': { tries: 1, solved: true }, '6,1,6': { tries: 2, solved: true } };
    state.levelRun = run;
    bumpPlayCount('h-finish'); // enterLevel 的进关计数（Node 直测追加导出）
    const res = finishRun();
    assert.equal(res.stars, 2);
    assert.equal(res.isNewBest, true);
    assert.equal(res.best.plays, 1, '结算条目保留进关次数');
    // 第二局：更差（有死亡且未全解锁 → 1 星）——最佳不降级、isNewBest=false
    const run2 = makeRun({ cardHash: 'h-finish' });
    run2.deaths = 3;
    run2.answers = { '3,1,3': { tries: 5, solved: true } };
    state.levelRun = run2;
    bumpPlayCount('h-finish');
    const res2 = finishRun();
    assert.equal(res2.stars, 1);
    assert.equal(res2.isNewBest, false);
    const best = getBestScores('h-finish');
    assert.equal(best.stars, 2);
    assert.equal(best.timeSec, res.timeSec);
    assert.equal(best.plays, 2, '两次进关 plays=2');
    assert.deepEqual(JSON.parse(store.get('mcweb.levels.v1')).best['h-finish'], best, 'localStorage 桩内容与读取一致');
    // 超时失败（0 星）不刷新最佳
    const run3 = makeRun({ cardHash: 'h-finish' });
    run3.rules = { timeLimit: 1, lockAIHelp: true };
    state.levelRun = run3;
    bumpPlayCount('h-finish');
    tickRun(run3, 2, FAR); // 超时结算（不注入 onFinish 不开面板）
    assert.equal(getBestScores('h-finish').stars, 2);
    assert.equal(getBestScores('h-finish').plays, 3);
    assert.equal(getBestScores('no-such'), null);
    state.levelRun = null;
});
