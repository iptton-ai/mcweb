// ==================== edu-level-cross.test.mjs ====================
// 教学组（答题机/星辉门/英语商人/奖励）× 红石 × 关卡工坊/闯关 跨模组无头集成测试。
// 纯 Node 运行（不启动浏览器、不渲染）：渲染层被 _preload/hooks 垫掉，世界数据为真。
//
// 覆盖清单：
//   1. 答题机答对 → 红石常供能开门全链（含答错路径：保持锁定/无信号/进度记账）
//   2. 答题机 → 邻接红石灯（答对即亮，无需布线）
//   3. 英语商人：答对发奖励掉落 + 分模式计数；答错无奖励
//   4. 奖励梯队：streak 8/5/3/0 四档掉落 + 累计里程碑
//   5. 星辉门：超纲题答对开门供电；答错入错题本
//   6. 从真实世界建卡 → 校验 → 嵌入新世界（区域快照逐格一致）
//   7. reachabilityBFS：通卡全可达；终点旗被实心墙封死 → missing
//   8. 闯关全链：enterLevel → 卡题作答 → 记账 → 踩终点结算 → 星级/最佳成绩 → 退出恢复
//   9. 闯关中 TNT 保护（锁/旗/门免疫爆炸，普通方块照炸）+ 非闯关对照
//   10. 我的题库 × 出题链（数据可达 eduKeypad 作者锁路径 + 坏数据挡板）
//
// 运行（必须带 --import 预载）：
//   cd /Users/zxnap/code/MyWorks/yltech.edu/game && node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/edu-level-cross.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- 相对地址 fetch 修正（测试文件自己的运行期包装，不改共享底座）----
// 游戏代码用浏览器语义的相对地址拉题库（fetch('assets/edu/x.json')）；
// _preload 的磁盘直读只认 / 开头与同源绝对地址。这里补一道前缀，让引擎与测试
// 读到同一份磁盘题库（不装的话引擎静默落到内置兜底题池，与磁盘数据不同源）。
const __prevFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
    if (typeof input === 'string' && !input.startsWith('/') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) {
        input = '/' + input;
    }
    return __prevFetch(input, init);
};

import { freshWorld, pump, at, setB, state, __listeners } from './kit.mjs';
import { initRedstone } from '../../js/redstone.js';
import { tryPlaceDoor } from '../../js/door.js';
import { spawnTntEntity } from '../../js/tnt.js';
import { setState, getUIState } from '../../js/uiModal.js';
import {
    BlockTypes, GameModes,
    KEYPAD_BASE, MERCHANT_BASE, keypadId, keypadSolved, isKeypadId,
    starlightId, starlightOpen, isStarlightId,
    flagId, flagKind, isFlagId, FLAG_START, FLAG_CHECKPOINT, FLAG_GOAL,
    isDoorId, doorOpen, isLampLitId, LAMP_ITEM_ID, ItemTypes,
} from '../../js/config.js';
import {
    interactKeypadAt, seedAuthoredLock, getAuthoredLock, isLockVerified,
    selectQuestion, sanitizeManifest, normalizeBank,
} from '../../js/eduKeypad.js';
import { interactStarlightAt } from '../../js/eduStarlight.js';
import { interactMerchantAt } from '../../js/eduMerchant.js';
import {
    EDU_STORE_KEY, loadEduProgress, saveEduProgress, getProgress, setProgress,
    ensureUnitBanks, unitManifest, unitItemsOf, unitSequence, grantEduReward,
} from '../../js/eduRewards.js';
import {
    buildLevelCard, validateLevelCard, embedLevelToWorld, reachabilityBFS,
    cardHash, levelCardId, decodeRegionBlocks, worldToLocal, localToWorld,
    LEVEL_EMBED_OFFSET,
} from '../../js/levelWorkshop.js';
import {
    enterLevel, exitLevelRun, isLevelRunActive, getLevelRun, getCardQuestion,
    isLockAIHelpFrozen, tickLevelRun, computeStars, getBestScores, getHudState,
} from '../../js/levelRun.js';
import {
    saveBankQuestion, listBankQuestions, countBankQuestions,
    validateBankQuestion, deleteBankQuestion, BANK_KEY,
} from '../../js/questionBank.js';

// ---- 底座缺口 workaround（不改共享桩文件，运行期补齐）----
// tests/gamelogic/stubs/three-logic.mjs 的 BufferAttribute 没有 setXY/getX/getY，
// 且几何体没有 uv 属性——js/items.js 的掉落物网格（getDropGeo/getDropSprite，
// items.js:38/57）读写 geo.attributes.uv，直接 TypeError。此处 import 的是
// 模块钩子映射给 'three' 的同一个桩模块实例，原型级补齐即可全局生效。
import { BufferAttribute, BufferGeometry } from './stubs/three-logic.mjs';
{
    const proto = BufferAttribute.prototype;
    if (!proto.setXY) proto.setXY = function (i, x, y) { this.setX(i, x); return this.setY(i, y); };
    if (!proto.getX) proto.getX = function (i) { return this.array[i * this.itemSize]; };
    if (!proto.getY) proto.getY = function (i) { return this.array[i * this.itemSize + 1]; };
    // 几何体默认带一段可读写 uv（掉落物网格只写不读，逻辑层不看内容）
    const mkUv = () => new BufferAttribute(new Float32Array(64), 2);
    Object.defineProperty(BufferGeometry.prototype, 'attributes', {
        configurable: true,
        get() {
            if (!this.__attrs) this.__attrs = {};
            if (!this.__attrs.uv) this.__attrs.uv = mkUv();
            return this.__attrs;
        },
        set(v) {
            this.__attrs = v || {};
            if (!this.__attrs.uv) this.__attrs.uv = mkUv();
        },
    });
}

// ---- 底座缺口 workaround 2（不改共享桩文件）----
// assistant-sim 的 textures 桩 blockUVs 是空表，而 loadGame 尾部的 updateHotbar
//（js/ui.js:103）读 blockUVs[id].top → undefined.top 抛错。这条异常平时被
// levelRun.exitLevelRun 的 try/catch 吞掉，随后走 generateWorld 兜底、把刚恢复的
// 世界整个覆盖成自然地形（恢复悄悄失效）。这里把 0..255 全 id 填上占位 UV，
// 让 loadGame/updateHotbar 在无头环境完整走通。
// ⚠️ 必须 import '../../js/textures.js'——hooks 是「重写源码、按 js/textures.js 的
// URL 求值」，直连桩文件会拿到另一个模块实例、改不到游戏用的那张表。
import { blockUVs } from '../../js/textures.js';
for (let id = 0; id < 256; id++) blockUVs[id] = { top: { x: 0, y: 0 } };

// ==================== 公共助手 ====================

// 进入「游戏中」UI 态：答题面板的 keydown 处理器只在 getUIState()==='playing' 时消费按键。
// 纯键盘模式 = 永不请求指针锁定（无头环境没有真 canvas，别去碰 requestPointerLock）。
function playMode() {
    state.inputMode = 'keyboard';
    if (getUIState() !== 'playing') setState('playing');
}

// 每条用例的隔离底座：平地世界 + 清教学进度/最佳成绩/闯关态 + 防御性收起遗留面板 + playing 态
function baseSetup() {
    freshWorld();
    localStorage.removeItem(EDU_STORE_KEY);
    localStorage.removeItem('mcweb.levels.v1');
    state.levelRun = null;
    state.levelResult = null;
    state.itemDrops.length = 0;
    pressEscape(); // 上条用例若遗留答题面板则收起（无面板时是 no-op）
    playMode();
}

// 本地按键派发（替代 kit 的 dispatchKey）：底座缺口 workaround——_preload.mjs:31-34 的
// dispatchKey 事件对象没有 stopImmediatePropagation，而三个答题面板的 keydown 处理器
//（eduKeypad.js:674/689、eduStarlight.js:455、eduMerchant.js:300）都会调它，直接 TypeError。
// 这里向同一批 window keydown 收集器（_preload 导出的 __listeners，kit 再导出）投递补全的事件。
function dispatchKey(key, extra = {}) {
    const ev = {
        key, code: extra.code ?? '', repeat: false,
        preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
        ...extra,
    };
    for (const fn of __listeners.get('keydown') || []) fn(ev);
}

// 按键语义对齐 js/eduKeypad.js 的 keydown 处理器（约 :662 起）：分支匹配的是 e.code——
// 选择题 Digit1..4 直接判定；数字题 Digit 键入（≤4 位）+ Enter 提交；Esc 关闭。
function pressDigit(n) { dispatchKey(String(n), { code: 'Digit' + n }); }
function pressEnter() { dispatchKey('Enter', { code: 'Enter' }); }
function pressEscape() { dispatchKey('Escape', { code: 'Escape' }); }

// 对打开的答题面板作答（eduKeypad / eduStarlight 的会话题面同形：{kind, a, options?}）
function answerQuiz(q, { correct = true } = {}) {
    if (q.kind === 'choice') {
        const idx = correct ? q.a : (q.a + 1) % (q.options ? q.options.length : 4);
        pressDigit(idx + 1); // 面板按 1..4 作答
    } else {
        const val = correct ? q.a : (q.a >= 9999 ? q.a - 1 : q.a + 1);
        for (const ch of String(val)) pressDigit(ch);
        pressEnter();
    }
}

// 复算答题机引擎将出的题：照 js/eduKeypad.js ensureBanks/loadSubjectBank 的装载路径
// （同一批磁盘题库文件 + 导出的同规格清洗函数）重建题池，再用导出的 selectQuestion
// 按「世界种子+格子坐标」确定性复算——与引擎同格同题。
async function replicaKeypadQuestion(x, y, z, seed = state.worldSeed) {
    const resp = await fetch('assets/edu/banks.json');
    const manifest = (resp.ok ? sanitizeManifest(await resp.json()) : null) || [];
    assert.ok(manifest.length, 'banks.json 清单可读（引擎与测试同源的前提）');
    const banks = [];
    for (const entry of manifest) {
        const st = {
            subject: entry.subject, emoji: entry.emoji, name: entry.name, weight: entry.weight,
            pools: { input: [], choice: [] },
        };
        const r = await fetch('assets/edu/' + entry.file);
        if (r.ok) {
            const norm = normalizeBank(await r.json());
            if (norm && norm.subject === entry.subject) {
                for (const b of norm.banks) st.pools[b.kind].push(...b.items);
            }
        }
        assert.ok(st.pools.input.length + st.pools.choice.length > 0,
            `${entry.subject} 题库装载成功（引擎 loadSubjectBank 同路径）`);
        banks.push(st);
    }
    return selectQuestion(banks, seed, x, y, z);
}

// ---- 星辉门超纲抽题复算（照抄 js/eduStarlight.js 的盐常量与哈希，:42-53 / :108-152）----
const SALT_SL_SUBJECT = 0x7f4a7c15;
const SALT_SL_ITEM = 0x2545f491;
function slHashCell(seed, x, y, z, salt) {
    let h = (seed >>> 0) ^ salt;
    h = Math.imul(h ^ x, 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ y, 0xc2b2ae35) >>> 0;
    h = Math.imul(h ^ z, 0x27d4eb2f) >>> 0;
    h ^= h >>> 15;
    h >>>= 0;
    return h;
}
function slBeyondPool(subject, progressUnit) {
    const ordOf = new Map(unitSequence(subject).map((u, i) => [u.unit, i + 1]));
    return unitItemsOf(subject).filter((it) => {
        const ord = ordOf.get(typeof it.unit === 'string' ? it.unit.trim() : '');
        return ord !== undefined && ord > progressUnit;
    });
}
function replicaStarlightQuestion(x, y, z) {
    const manifest = unitManifest();
    const progress = getProgress().unit;
    const usable = manifest
        .map((m) => ({ ...m, pool: slBeyondPool(m.subject, progress) }))
        .filter((m) => m.pool.length > 0);
    assert.ok(usable.length, '存在超纲知识单元（进度之后还有内容）');
    const weightOf = (m) => Math.max(1, Math.floor(Number(m.weight)) || 1);
    const totalW = usable.reduce((s, m) => s + weightOf(m), 0);
    let r = slHashCell(state.worldSeed, x, y, z, SALT_SL_SUBJECT) % totalW;
    let entry = usable[usable.length - 1];
    for (const m of usable) {
        r -= weightOf(m);
        if (r < 0) { entry = m; break; }
    }
    const item = entry.pool[slHashCell(state.worldSeed, x, y, z, SALT_SL_ITEM) % entry.pool.length];
    return {
        subject: entry.subject,
        kind: item.kind === 'choice' ? 'choice' : 'input',
        q: item.q, a: item.a,
        unit: typeof item.unit === 'string' ? item.unit : '',
        options: Array.isArray(item.options) ? item.options : undefined,
    };
}

// ---- 关卡卡构造助手（旗三件 + 双锁题答题机 + 门，全部露天可达）----
const LOCK_Q_INPUT = { subject: 'math', kind: 'input', stem: '建卡算式 9×9', answer: 81, meta: { source: 'custom' } };
const LOCK_Q_CHOICE = { subject: 'science', kind: 'choice', stem: '建卡·水沸腾大约多少℃?', options: ['60℃', '100℃', '120℃'], answer: 1, meta: { source: 'custom' } };

async function buildGalleryCard(name = '建卡回环') {
    freshWorld();
    setB(10, 9, 10, flagId(FLAG_START));
    setB(14, 9, 10, flagId(FLAG_CHECKPOINT));
    setB(18, 9, 18, flagId(FLAG_GOAL));
    seedAuthoredLock(12, 9, 10, LOCK_Q_INPUT, 2); // 双通过已完成的作者锁
    setB(12, 9, 10, keypadId(0));
    seedAuthoredLock(16, 9, 14, LOCK_Q_CHOICE, 2);
    setB(16, 9, 14, keypadId(0));
    assert.equal(tryPlaceDoor(15, 9, 12, 0), true, '门放置成功');
    // lockMetaProvider 收到的是世界坐标（levelWorkshop.buildLevelCard 扫描循环传入 wx,wy,wz）
    const card = await buildLevelCard({
        name, author: '无头测试员',
        lockMetaProvider: (x, y, z) => getAuthoredLock(x, y, z),
    });
    assert.ok(card && !card.error, '关卡卡构建成功：' + ((card && card.error) || ''));
    return card;
}

// 闯关全链用的紧凑布局：起点/检查点/终点旗一线 + 一把输入锁 + 贴门
async function buildRunCard(name = '闯关全链') {
    freshWorld();
    setB(10, 9, 10, flagId(FLAG_START));
    setB(14, 9, 10, flagId(FLAG_CHECKPOINT));
    setB(18, 9, 10, flagId(FLAG_GOAL));
    seedAuthoredLock(12, 9, 10, {
        subject: 'math', kind: 'input', stem: '闯关算式 6×7', answer: 42,
        meta: { source: 'custom' },
    }, 2);
    setB(12, 9, 10, keypadId(0));
    assert.equal(tryPlaceDoor(13, 9, 10, 0), true);
    const card = await buildLevelCard({ name, author: '无头测试员', rules: { timeLimit: 60 } });
    assert.ok(card && !card.error, '闯关卡构建成功：' + ((card && card.error) || ''));
    const v = validateLevelCard(card);
    assert.equal(v.ok, true, '闯关卡校验通过：' + v.errors.join(';'));
    return card;
}

// ==================== 用例 ====================

test('1. 答题机答对→红石常供能开门全链；答错保持锁定无信号', async () => {
    baseSetup();
    // —— 台 A：锁定答题机 + 邻接门，答对开门 ——
    setB(12, 9, 12, keypadId(0));
    assert.equal(tryPlaceDoor(13, 9, 12, 0), true);
    state.player.x = 12.5; state.player.y = 10; state.player.z = 12.5; // 站到答题机旁
    const q = await replicaKeypadQuestion(12, 9, 12);
    assert.ok(q, '引擎将出的题可同源复算');
    assert.equal(await interactKeypadAt(12, 9, 12), true, '右键答题机打开答题面板');
    answerQuiz(q, { correct: true });
    assert.equal(at(12, 9, 12), keypadId(1), '答对翻转为已解锁变体');
    assert.equal(isDoorId(at(13, 9, 12)), true);
    assert.equal(doorOpen(at(13, 9, 12)), 1, '解锁的答题机=常供能红石源：邻接门上升沿开启');
    const p1 = loadEduProgress();
    assert.equal(p1.solved, 1, '累计答对 +1');
    assert.equal(p1.streak, 1, '连对 +1');
    assert.equal(p1.subjects[q.subject].solved, 1, '分学科答对计数');
    assert.ok(state.itemDrops.length >= 1, '答对触发奖励掉落');
    pump(0.05, 2);
    assert.equal(doorOpen(at(13, 9, 12)), 1, '供能稳定：泵帧后门仍开');

    // —— 台 B：故意答错 ——
    setB(20, 9, 20, keypadId(0));
    assert.equal(tryPlaceDoor(21, 9, 20, 0), true);
    state.player.x = 20.5; state.player.y = 10; state.player.z = 20.5;
    const q2 = await replicaKeypadQuestion(20, 9, 20);
    assert.equal(await interactKeypadAt(20, 9, 20), true);
    answerQuiz(q2, { correct: false });
    assert.equal(at(20, 9, 20), keypadId(0), '答错保持锁定变体');
    assert.equal(doorOpen(at(21, 9, 20)), 0, '无信号：门不开');
    const p2 = loadEduProgress();
    assert.equal(p2.solved, 1, '答错不影响答对数');
    assert.equal(p2.wrong, 1, '答错计数 +1（mcweb.edu.v1）');
    assert.equal(p2.streak, 0, '连对清零');
    assert.equal(p2.subjects[q2.subject].wrong, 1, '分学科答错计数');
    pressEscape(); // 收起可重试的答题面板
});

test('2. 答题机→红石灯：答对即亮（6 邻直贴无需布线）', async () => {
    baseSetup();
    setB(50, 9, 50, keypadId(0));
    setB(51, 9, 50, LAMP_ITEM_ID);
    state.player.x = 50.5; state.player.y = 10; state.player.z = 50.5;
    assert.equal(isLampLitId(at(51, 9, 50)), false, '锁定态无供能：灯灭');
    const q = await replicaKeypadQuestion(50, 9, 50);
    assert.equal(await interactKeypadAt(50, 9, 50), true);
    answerQuiz(q, { correct: true });
    assert.equal(at(50, 9, 50), keypadId(1));
    assert.equal(isLampLitId(at(51, 9, 50)), true, '解锁即常供能源：邻接灯亮');
});

test('3. 英语商人：答对发奖励掉落+分模式计数；答错无奖励', async () => {
    baseSetup();
    setB(30, 9, 30, MERCHANT_BASE);
    state.player.x = 30.5; state.player.y = 10; state.player.z = 30.5;
    // 固定随机：makeOptions 的干扰项挑选与洗牌确定化 → 正确项恒落在下标 2（按 3 键）
    const rnd = Math.random;
    Math.random = () => 0;
    // 第一问（模块出题序 1 → 模式 w2e 看中文选英文）
    assert.equal(await interactMerchantAt(30, 9, 30), true);
    pressDigit(3); // choose(2) === answer → 答对
    Math.random = rnd;
    const p1 = loadEduProgress();
    assert.equal(p1.trades, 1, '交易计数 +1');
    assert.equal(p1.wordStreak, 1, '商人连对 +1');
    assert.equal(p1.merchantModes.w2e.solved, 1, '分模式答对计数');
    assert.equal(p1.words.length, 1, '词条入图鉴');
    assert.equal(state.itemDrops.length, 2, '奖励掉落（普通档苹果×1 + 固定随机触发的彩蛋熟猪排×1）');

    // 第二问（出题序 2 → 模式 e2z 看英文选中文）：故意按错（正确项在下标 2，按 1 必错）
    Math.random = () => 0;
    assert.equal(await interactMerchantAt(30, 9, 30), true);
    Math.random = rnd;
    const dropsBefore = state.itemDrops.length;
    pressDigit(1);
    const p2 = loadEduProgress();
    assert.equal(p2.trades, 1, '答错不记交易');
    assert.equal(p2.wordWrong, 1, '答错计数 +1');
    assert.equal(p2.wordStreak, 0, '连对清零');
    assert.equal(p2.merchantModes.e2z.wrong, 1, '分模式答错计数');
    assert.equal(state.itemDrops.length, dropsBefore, '答错无奖励掉落');
    pressEscape();
});

test('4. 奖励梯队：streak 8/5/3/0 四档掉落与累计里程碑', () => {
    baseSetup();
    // 压掉里程碑与随机彩蛋：claimed 全勾 + random 固定 0.5（≥0.1 不触发彩蛋）
    saveEduProgress({ solved: 99, claimed: ['ms5', 'ms10', 'ms20', 'ms50'] });
    const rnd = Math.random;
    Math.random = () => 0.5;
    try {
        grantEduReward(60, 9, 60, { streak: 8, totalKey: 'solved' });
        assert.equal(state.itemDrops.length, 2, '传说档：两捆掉落');
        assert.deepEqual(state.itemDrops.map((d) => [d.itemId, d.count]),
            [[ItemTypes.DIAMOND, 2], [ItemTypes.COOKED_PORK, 2]]);

        state.itemDrops.length = 0;
        grantEduReward(60, 9, 60, { streak: 5, totalKey: 'solved' });
        assert.deepEqual(state.itemDrops.map((d) => [d.itemId, d.count]),
            [[ItemTypes.DIAMOND, 1], [ItemTypes.IRON_INGOT, 2]], '史诗档');

        state.itemDrops.length = 0;
        grantEduReward(60, 9, 60, { streak: 3, totalKey: 'solved' });
        assert.deepEqual(state.itemDrops.map((d) => [d.itemId, d.count]),
            [[ItemTypes.IRON_INGOT, 2], [ItemTypes.APPLE, 2]], '精良档');

        state.itemDrops.length = 0;
        grantEduReward(60, 9, 60, { streak: 0, totalKey: 'solved' });
        assert.deepEqual(state.itemDrops.map((d) => [d.itemId, d.count]),
            [[ItemTypes.APPLE, 1]], '基础档');

        // 里程碑：清空 claimed、solved=5 过 ms5 线 → 基础档追加红石灯×2，claimed 记账
        saveEduProgress({ solved: 5 });
        state.itemDrops.length = 0;
        grantEduReward(62, 9, 60, { streak: 1, totalKey: 'solved' });
        assert.deepEqual(state.itemDrops.map((d) => [d.itemId, d.count]).sort(),
            [[ItemTypes.APPLE, 1], [LAMP_ITEM_ID, 2]].sort(), '里程碑红石灯×2 追加');
        assert.deepEqual(loadEduProgress().claimed, ['ms5'], '里程碑领取记账');
    } finally {
        Math.random = rnd;
    }
});

test('5. 星辉门：超纲题答对开门供电；答错入错题本', async () => {
    baseSetup();
    setProgress(1); // 学习进度=三上第 1 单元 → 序数更大的单元均为「超纲」
    await ensureUnitBanks(); // 与引擎同一份磁盘题库（导出的加载入口）
    assert.ok(unitManifest().length, '题库清单已装载');
    const SL = { x: 14, y: 9, z: 14 };
    setB(SL.x, SL.y, SL.z, starlightId(0));
    setB(SL.x + 1, SL.y, SL.z, LAMP_ITEM_ID);
    assert.equal(tryPlaceDoor(SL.x - 1, SL.y, SL.z, 0), true);
    state.player.x = SL.x + 0.5; state.player.y = SL.y + 1; state.player.z = SL.z + 0.5;

    const q = replicaStarlightQuestion(SL.x, SL.y, SL.z);
    assert.ok(q && q.kind, '超纲题可确定性复算');
    assert.equal(await interactStarlightAt(SL.x, SL.y, SL.z), true);
    answerQuiz(q, { correct: true });
    assert.equal(at(SL.x, SL.y, SL.z), starlightId(1), '答对翻转为开启变体');
    assert.equal(starlightOpen(at(SL.x, SL.y, SL.z)), 1);
    assert.equal(isLampLitId(at(SL.x + 1, SL.y, SL.z)), true, '开启星辉门=常供能源：邻灯亮');
    assert.equal(doorOpen(at(SL.x - 1, SL.y, SL.z)), 1, '邻接门得电开启');
    const p1 = loadEduProgress();
    assert.equal(p1.metrics.earlyUnlocks.length, 1, '记「提前解锁」');
    assert.equal(p1.metrics.returnEvents.length, 1, '记回流事件');

    // —— 答错路径：另一台星辉门 ——
    const S2 = { x: 20, y: 9, z: 20 };
    setB(S2.x, S2.y, S2.z, starlightId(0));
    state.player.x = S2.x + 0.5; state.player.y = S2.y + 1; state.player.z = S2.z + 0.5;
    const q2 = replicaStarlightQuestion(S2.x, S2.y, S2.z);
    assert.equal(await interactStarlightAt(S2.x, S2.y, S2.z), true);
    answerQuiz(q2, { correct: false });
    assert.equal(at(S2.x, S2.y, S2.z), starlightId(0), '答错保持锁定');
    const p2 = loadEduProgress();
    assert.equal(p2.wrongBook.length, 1, '错题本 +1');
    assert.equal(p2.wrongBook[0].source, '星辉门', '错题来源标记');
    assert.equal(p2.wrongBook[0].stem, q2.q, '错题题干入库');
    pressEscape();
});

test('6. 从真实世界建卡→校验→嵌入新世界（区域快照逐格一致）', async () => {
    baseSetup();
    const card = await buildGalleryCard();
    const r = card.region;
    // 锚点自动区域 = 旗∪锁∪门 包围盒 +2（本布局 x∈[10,18] y∈[9,10] z∈[10,18] → x0=8,y0=7,z0=8）
    assert.equal(r.x0, 8); assert.equal(r.y0, 7); assert.equal(r.z0, 8);
    // 卡内一律局部坐标：锁/旗的世界坐标 − region 原点
    assert.equal(card.questions.length, 2, '两把锁进卡');
    const locals = card.questions.map((q) => `${q.x},${q.y},${q.z}`).sort();
    assert.deepEqual(locals, ['4,2,2', '8,2,6'], '锁落局部坐标');
    assert.ok(card.questions.every((q) => q.meta.verifiedPasses === 2), '双通过随卡带出');
    assert.deepEqual(card.flags.start, { x: 2, y: 2, z: 2 }, '起点旗局部坐标');
    assert.deepEqual(card.flags.goal, { x: 10, y: 2, z: 10 }, '终点旗局部坐标');
    assert.equal(card.flags.checkpoints.length, 1, '检查点旗进卡');
    assert.equal(cardHash(card), cardHash(JSON.parse(JSON.stringify(card))), 'cardHash 序列化回环稳定');
    assert.match(levelCardId(card), /^[0-9a-f]{8}-[0-9a-z]+$/, '卡片 id 形制');
    const v = validateLevelCard(card);
    assert.equal(v.ok, true, '关卡卡校验通过：' + v.errors.join(';'));

    // 换一个空世界接收嵌入
    freshWorld();
    const res = embedLevelToWorld(card);
    assert.ok(res && res.dirtyChunks.length > 0, '嵌入返回受影响区块');
    initRedstone(); // 嵌入是直写 state.blocks，红石基线需按新世界重算
    assert.deepEqual(res.spawn, localToWorld(2, 2, 2), '出生点 = 起点旗世界坐标');

    // 逐格对账：卡内区域快照 === 嵌入世界（局部 + LEVEL_EMBED_OFFSET）
    const dec = decodeRegionBlocks(card);
    assert.ok(dec.blocks, '卡内区域可解码');
    const ox = LEVEL_EMBED_OFFSET.x, oy = LEVEL_EMBED_OFFSET.y, oz = LEVEL_EMBED_OFFSET.z;
    let k = 0;
    for (let ly = 0; ly < r.h; ly++) {
        for (let lz = 0; lz < r.d; lz++) {
            for (let lx = 0; lx < r.w; lx++) {
                assert.equal(at(ox + lx, oy + ly, oz + lz), dec.blocks[k++],
                    `嵌入格 (${lx},${ly},${lz}) 与卡内快照一致`);
            }
        }
    }
    // 锚点抽查：源世界摆的什么，嵌入世界就是什么（局部→世界各 +80/+4/+80）
    assert.equal(at(ox + 4, oy + 2, oz + 2), keypadId(0), '答题机（锁定态）');
    assert.equal(at(ox + 8, oy + 2, oz + 6), keypadId(0), '第二台答题机');
    assert.equal(at(ox + 2, oy + 2, oz + 2), flagId(FLAG_START), '起点旗');
    assert.equal(at(ox + 6, oy + 2, oz + 2), flagId(FLAG_CHECKPOINT), '检查点旗');
    assert.equal(at(ox + 10, oy + 2, oz + 10), flagId(FLAG_GOAL), '终点旗');
    assert.equal(isDoorId(at(ox + 7, oy + 2, oz + 4)), true, '门下半');
    assert.equal(isDoorId(at(ox + 7, oy + 3, oz + 4)), true, '门上半');
});

test('7. reachabilityBFS：通卡全可达；终点旗被实心墙封死→missing', async () => {
    baseSetup();
    // —— 通卡：露天旗组 + 双锁 + 门，全部可达 ——
    const good = await buildGalleryCard();
    assert.equal(validateLevelCard(good).ok, true);
    const bfs = reachabilityBFS(good);
    assert.equal(bfs.reachable, true, '起点→终点+全部锁可达');
    assert.deepEqual(bfs.missing, []);

    // —— 终点旗六面实心封死 ——
    freshWorld();
    setB(10, 9, 10, flagId(FLAG_START));
    setB(18, 9, 10, flagId(FLAG_GOAL));
    setB(17, 9, 10, BlockTypes.STONE);
    setB(19, 9, 10, BlockTypes.STONE);
    setB(18, 9, 9, BlockTypes.STONE);
    setB(18, 9, 11, BlockTypes.STONE);
    setB(18, 10, 10, BlockTypes.STONE);
    setB(18, 8, 10, BlockTypes.STONE);
    const sealed = await buildLevelCard({ name: '封死关', author: '无头测试员' });
    assert.ok(sealed && !sealed.error, '封死卡可构建');
    const v2 = validateLevelCard(sealed);
    assert.equal(v2.ok, true, '不可达只是警告、不挡导出');
    assert.ok(v2.warnings.some((w) => w.includes('可达性')), '校验器给出静态可达性警告');
    const bfs2 = reachabilityBFS(sealed);
    assert.equal(bfs2.reachable, false, '封死→不可达');
    assert.equal(bfs2.missing.length, 1);
    assert.match(bfs2.missing[0], /终点旗/, 'missing 指向终点旗');
});

test('8. 闯关全链：进关→卡题作答→记账→结算星级→最佳成绩→退出恢复', async () => {
    baseSetup();
    const card = await buildRunCard(); // 内部 freshWorld：此世界即「进关前基准」
    setB(200, 30, 60, BlockTypes.STONE); // 基准世界标记方块（退出恢复后应回来）

    const run = await enterLevel(card);
    assert.ok(run, 'enterLevel 成功');
    assert.equal(isLevelRunActive(), true);
    assert.equal(getLevelRun().card.name, '闯关全链');
    assert.equal(state.gameMode, GameModes.SURVIVAL, '闯关强制生存');
    assert.equal(state.time, state.dayLength / 2, '时间锁正午');
    assert.equal(at(12, 9, 10), BlockTypes.AIR, '原世界已被清空');
    assert.equal(at(84, 0, 82), BlockTypes.BEDROCK, '临时世界底部基岩');
    // 嵌入固定偏移 (80,4,80)：源世界 (12,9,10) 的锁 → 局部 (4,2,2) → 世界 (84,6,82)
    assert.equal(at(84, 6, 82), keypadId(0), '锁嵌入到位');
    // 玩家出生在起点旗块中心上方
    assert.equal(state.player.x, 82.5);
    assert.equal(state.player.y, 7);
    assert.equal(state.player.z, 82.5);

    // 出卡内题（不是题库题）：世界坐标 → 局部坐标 → card.questions 命中
    const cardQ = getCardQuestion(84, 6, 82);
    assert.ok(cardQ, '闯关中该格命中卡内题');
    assert.equal(cardQ.stem, '闯关算式 6×7');
    assert.equal(cardQ.answer, 42);
    assert.equal(isLockAIHelpFrozen(), false, '考核锁未开');
    assert.equal(getHudState().total, 1, 'HUD 锁总数');

    // 走真实交互链答锁：面板出卡题 → 答对 → 翻转变体 + 红石开门 + 记账
    state.player.x = 84.5; state.player.y = 7; state.player.z = 82.5;
    assert.equal(await interactKeypadAt(84, 6, 82), true);
    pressDigit(4); pressDigit(2); // 输入 42
    pressEnter();
    assert.equal(at(84, 6, 82), keypadId(1), '卡题答对翻转');
    assert.equal(doorOpen(at(85, 6, 82)), 1, '贴锁的门自动开');
    assert.deepEqual(getLevelRun().answers['4,2,2'], { tries: 1, solved: true }, 'recordLockAttempt 记账');

    // 挪到终点旗 → tickLevelRun 踩踏结算
    const g = card.flags.goal;
    const gw = localToWorld(g.x, g.y, g.z);
    state.player.x = gw.x + 0.5; state.player.y = gw.y + 1; state.player.z = gw.z + 0.5;
    const result = tickLevelRun(0.05);
    assert.ok(result, '踩终点触发结算');
    assert.equal(result.name, '闯关全链');
    assert.equal(result.deaths, 0);
    assert.equal(result.locks.length, 1);
    assert.equal(result.locks[0].tries, 1);
    assert.equal(result.locks[0].solved, true);
    assert.equal(result.stars, 3, '零死亡 + 全锁一次过 = 3 星');
    assert.equal(result.isNewBest, true, '首通即最佳');
    assert.equal(getBestScores(run.cardHash).stars, 3, '最佳成绩持久化（mcweb.levels.v1）');

    // 星级规则矩阵（纯函数单点：computeStars）
    assert.equal(computeStars({ deaths: 0, locks: [{ tries: 1, solved: true }] }), 3);
    assert.equal(computeStars({ deaths: 1, locks: [{ tries: 2, solved: true }] }), 2, '通关+全对但有死亡');
    assert.equal(computeStars({ deaths: 0, locks: [{ tries: 3, solved: true }] }), 2, '零死亡但非一次过');
    assert.equal(computeStars({ deaths: 1, locks: [{ tries: 1, solved: false }] }), 1, '仅通关');
    assert.equal(computeStars({ deaths: 0, locks: [], timeout: true }), 0, '超时 = 0 星失败');

    // 退出：恢复进关前世界（含标记方块）与界面态
    assert.equal(exitLevelRun({ toTitle: true }), true);
    assert.equal(isLevelRunActive(), false, '闯关态立即关闭');
    await new Promise((r) => setTimeout(r, 30)); // 异步续段：loadGame 读回基准世界
    assert.equal(getUIState(), 'title', 'toTitle 退出回首屏');
    assert.equal(at(84, 6, 82), BlockTypes.STONE, '嵌入锁已消失（基准世界的地板石原样回来）');
    assert.equal(at(200, 30, 60), BlockTypes.STONE, '基准世界的标记方块被恢复');
    assert.equal(at(12, 9, 10), keypadId(0), '源世界布局原样恢复');
    assert.equal(state.gameMode, GameModes.CREATIVE, '模式恢复');
});

test('9. 闯关中 TNT 保护：锁/旗/门免疫爆炸；非闯关对照全毁', async () => {
    baseSetup();
    const card = await buildRunCard();
    assert.equal(await enterLevel(card) !== null, true);
    // 嵌入布局（世界坐标）：锁(84,6,82) 门(85,6,82) 检查点旗(86,6,82) 终点旗(90,6,82)
    // 两枚 TNT 错位摆：让四类保护对象各自落在至少一枚的爆半径（R=3.5）内
    setB(85, 6, 84, BlockTypes.TNT); // 锁/门/检查点旗旁
    setB(88, 6, 82, BlockTypes.TNT); // 终点旗/检查点旗旁
    spawnTntEntity(85, 6, 84);
    spawnTntEntity(88, 6, 82);
    state.player.x = 200; state.player.y = 30; state.player.z = 60; // 远离爆心，免受击退干扰
    pump(0.1, 30); // 引信 2.5s → 两枚 TNT 依次引爆
    assert.equal(at(85, 6, 84), BlockTypes.AIR, 'TNT 本体照炸（不在保护清单）');
    assert.equal(at(88, 6, 82), BlockTypes.AIR, 'TNT 本体照炸');
    assert.equal(at(88, 5, 82), BlockTypes.AIR, '普通地面方块照炸');
    assert.equal(at(84, 6, 82), keypadId(0), '闯关中：答题机免疫爆炸');
    assert.equal(isDoorId(at(85, 6, 82)), true, '闯关中：门免疫爆炸');
    assert.equal(at(86, 6, 82), flagId(FLAG_CHECKPOINT), '闯关中：检查点旗免疫爆炸');
    assert.equal(at(90, 6, 82), flagId(FLAG_GOAL), '闯关中：终点旗免疫爆炸');
    assert.equal(keypadSolved(at(84, 6, 82)), 0);
    exitLevelRun({ toTitle: true });
    await new Promise((r) => setTimeout(r, 30));

    // —— 对照：普通世界（非闯关）同样爆炸 → 保护清单外的锁/旗/门全毁 ——
    baseSetup();
    setB(40, 9, 40, keypadId(0));
    setB(42, 9, 40, BlockTypes.TNT);
    setB(44, 9, 40, flagId(FLAG_GOAL));
    assert.equal(tryPlaceDoor(44, 9, 42, 0), true);
    setB(42, 9, 42, flagId(FLAG_CHECKPOINT));
    spawnTntEntity(42, 9, 40);
    pump(0.1, 30);
    assert.equal(at(42, 9, 40), BlockTypes.AIR, 'TNT 本体引爆');
    assert.equal(at(40, 9, 40), BlockTypes.AIR, '非闯关：答题机被炸毁');
    assert.equal(at(44, 9, 40), BlockTypes.AIR, '非闯关：终点旗被炸毁');
    assert.equal(isDoorId(at(44, 9, 42)), false, '非闯关：门被炸毁');
    assert.equal(at(42, 9, 42), BlockTypes.AIR, '非闯关：检查点旗被炸毁');
});

test('10. 我的题库×出题链：数据可达 eduKeypad 作者锁路径，坏数据被挡', () => {
    baseSetup();
    localStorage.removeItem(BANK_KEY); // 题库缓存懒加载，首访前清即空库
    // —— 校验挡板：坏学科 / 选项重复 ——
    assert.equal(saveBankQuestion({ subject: '数学', kind: 'input', stem: '1+1', answer: 2 }).ok, false, '学科必须五枚举');
    assert.equal(saveBankQuestion({ subject: 'math', kind: 'choice', stem: 'x', options: ['a', 'a', 'b'], answer: 0 }).ok, false, '选项不能重复');
    assert.equal(saveBankQuestion({ subject: 'math', kind: 'input', stem: 'x', answer: 12345 }).ok, false, '数字题答案 0..9999');
    // —— 正常录题两道（新题在前）——
    const r1 = saveBankQuestion({ subject: 'math', kind: 'input', stem: '6×7=?', answer: 42, unit: '三上·乘法' });
    assert.equal(r1.ok, true, '录入数字题');
    const r2 = saveBankQuestion({ subject: 'science', kind: 'choice', stem: '水沸腾大约多少℃?', options: ['60℃', '80℃', '100℃'], answer: 2, hint: '标准大气压' });
    assert.equal(r2.ok, true, '录入选择题');
    const bank = listBankQuestions();
    assert.equal(countBankQuestions(), 2);
    assert.equal(bank[0].stem, '水沸腾大约多少℃?', '新题排前');
    assert.equal(validateBankQuestion(bank[0]).ok, true, '库内条目过题级契约校验');
    // —— 数据可达 eduKeypad：题库条目走「📋 我的题目」→ 保存 → 双通过的数据链
    //（游戏内 UI 点击链在无头 fake DOM 不可驱动，这里对齐同一数据面）——
    seedAuthoredLock(70, 9, 70, bank[0], 2);
    const lock = getAuthoredLock(70, 9, 70);
    assert.ok(lock, '题库条目进入作者锁表');
    assert.equal(lock.question.stem, '水沸腾大约多少℃?');
    assert.equal(lock.question.answer, 2);
    assert.equal(isLockVerified(70, 9, 70), true, '双通过后可导出');
    // 删除链路
    assert.equal(deleteBankQuestion(bank[1].id), true);
    assert.equal(countBankQuestions(), 1);
});
