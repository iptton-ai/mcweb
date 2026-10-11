import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, state, setB, at, pump } from './kit.mjs';
import {
    BlockTypes, GameModes, FLAG_BASE, FLAG_START, FLAG_GOAL, KEYPAD_BASE,
    plateId, waterwheelId, shaftId, lampId,
} from '../../js/config.js';
import { saveGame, loadGame } from '../../js/saveGame.js';
import { saveSnapshotForReload, restoreSnapshotIfAny } from '../../js/assistant/snapshot.js';
import { initRedstone } from '../../js/redstone.js';
import { initKinetic, kineticStatusAt } from '../../js/kinetic.js';
import { spawnItemDrop } from '../../js/items.js';
import { spawnTntEntity } from '../../js/tnt.js';
import { enqueueBuildOps } from '../../js/buildQueue.js';
import { particleSystem, spawnBreakParticles } from '../../js/particles.js';
import { seedAuthoredLock, getAuthoredLock, restoreAuthoredLocks } from '../../js/eduKeypad.js';
import { enterLevelEditor, saveEditorDraft, exitLevelEditor } from '../../js/levelEditor.js';
import { tickRun } from '../../js/levelRun.js';
import {
    buildLevelCard, decodeRegionBlocks, validateLevelCard, saveLevelCard,
    listLevelCards, getLevelCard, deleteLevelCard, localToWorld,
} from '../../js/levelWorkshop.js';

const QUESTION = { subject: 'math', kind: 'input', stem: '6+7=?', answer: 13, hint: '先凑十', meta: { source: 'custom' } };

function reset(options) {
    state.levelEdit = null;
    state.levelRun = null;
    localStorage.clear(); sessionStorage.clear();
    restoreAuthoredLocks([]);
    freshWorld(options);
    state.saveSlot = 0;
    state.player.toolWear = {}; state.player.hunger = 20; state.player.air = 10; state.player.xp = 0;
    particleSystem.particles.length = 0;
}

function putLevel(x = 40, y = 9, z = 40) {
    setB(x, y, z, FLAG_BASE + FLAG_START);
    setB(x + 4, y, z, KEYPAD_BASE);
    setB(x + 8, y, z, FLAG_BASE + FLAG_GOAL);
    seedAuthoredLock(x + 4, y, z, QUESTION, 2);
}

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

async function clearCards() {
    for (const row of await listLevelCards()) await deleteLevelCard(row.id);
}

// 只替代浏览器持久化边界；open/事务/请求事件与结构化克隆遵循 IndexedDB 语义。
// 允许 put 配额失败，但 get/getAll/delete 保持成功，复现写失败后误删旧持久草稿。
function controlledIndexedDB() {
    const previous = globalThis.indexedDB;
    const stores = new Map();
    const control = { failPuts: false, deleted: [] };
    const request = (operation, tx) => {
        const req = {};
        queueMicrotask(() => {
            try {
                req.result = operation(); req.onsuccess?.();
                queueMicrotask(() => tx?.oncomplete?.());
            } catch (error) {
                req.error = error; req.onerror?.();
                if (tx) { tx.error = error; queueMicrotask(() => tx.onabort?.()); }
            }
        });
        return req;
    };
    const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore(name) { stores.set(name, new Map()); },
        close() {},
        transaction(name) {
            const rows = stores.get(name);
            assert.ok(rows, `事务 store ${name} 已创建`);
            const tx = { objectStore: () => ({
                put: record => request(() => {
                    if (control.failPuts) throw new DOMException('空间不足', 'QuotaExceededError');
                    rows.set(record.id, structuredClone(record)); return record.id;
                }, tx),
                get: id => request(() => structuredClone(rows.get(id))),
                getAll: () => request(() => structuredClone([...rows.values()])),
                delete: id => request(() => { control.deleted.push(id); rows.delete(id); }, tx),
            }) };
            return tx;
        },
    };
    globalThis.indexedDB = {
        open() {
            const req = {};
            queueMicrotask(() => {
                req.result = db;
                if (!stores.size) req.onupgradeneeded?.();
                req.onsuccess?.();
            });
            return req;
        },
    };
    return { control, records: () => stores.get('cards'), restore: () => { globalThis.indexedDB = previous; } };
}

// 真缩略图逻辑照常运行，仅把浏览器异步 toBlob 完成时刻交给测试控制。
function delayThumbnail() {
    const create = document.createElement;
    const started = deferred();
    let complete;
    document.createElement = tag => {
        const el = create(tag);
        if (tag === 'canvas') {
            const getContext = el.getContext;
            el.getContext = kind => {
                const ctx = getContext(kind);
                ctx.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
                return ctx;
            };
            el.toBlob = cb => { complete = cb; started.resolve(); };
        }
        return el;
    };
    return { started: started.promise, release: () => complete?.(null), restore: () => { document.createElement = create; } };
}

test('读档重置临时压力板/动力注册表与落地摔落状态', () => {
    reset({ gameMode: GameModes.SURVIVAL });
    setB(30, 9, 30, BlockTypes.STONE);
    setB(40, 9, 40, waterwheelId(0));
    assert.equal(saveGame(), true);

    setB(30, 9, 30, plateId(0));
    setB(40, 10, 40, BlockTypes.WATER);
    initRedstone(); initKinetic();
    assert.match(kineticStatusAt(40, 9, 40), /RPM/);
    Object.assign(state.player, { x: 30.5, y: 9, z: 30.5, onGround: true, dead: true, inWater: true, fallStartY: 60, vy: -40 });
    assert.equal(loadGame(), true);
    assert.equal(state.player.onGround, false);
    assert.equal(state.player.dead, false);
    assert.equal(state.player.fallStartY, null);
    assert.equal(state.player.inWater, false);
    assert.equal(state.player.vy, 0);
    assert.match(kineticStatusAt(40, 9, 40), /静止/);
    Object.assign(state.player, { x: 30.5, y: 9, z: 30.5 });
    pump();
    assert.equal(at(30, 9, 30), BlockTypes.STONE, '旧压力板位置不得覆盖读回的石头');
});

test('热重载恢复生存/种子与机关，清施工、怪物、掉落、引信和粒子', async () => {
    reset({ gameMode: GameModes.SURVIVAL, seed: 123456 });
    Object.assign(state.player, { health: 7, hunger: 6, air: 3, xp: 19, inventory: { 190: 1 }, toolWear: { 190: 28 }, yaw: 0.7, pitch: -0.2 });
    setB(40, 9, 40, waterwheelId(0)); setB(40, 10, 40, BlockTypes.WATER);
    setB(41, 9, 40, shaftId(0));
    setB(50, 9, 50, KEYPAD_BASE + 1); setB(51, 9, 50, lampId(0));
    assert.equal(saveSnapshotForReload(), true);

    setB(30, 9, 30, plateId(0)); setB(40, 10, 40, BlockTypes.AIR);
    initRedstone(); initKinetic();
    state.worldSeed = 999; state.gameMode = GameModes.CREATIVE;
    Object.assign(state.player, { health: 20, hunger: 20, air: 10, xp: 0, toolWear: {}, inventory: {}, onGround: true, dead: true, fallStartY: 70, inWater: true });
    spawnItemDrop(20, 12, 20, BlockTypes.STONE);
    state.enemies.push({ mesh: {} });
    setB(25, 9, 25, BlockTypes.TNT); spawnTntEntity(25, 9, 25);
    spawnBreakParticles(20, 10, 20, BlockTypes.STONE);
    const building = enqueueBuildOps('旧世界施工', [[60, 10, 60, BlockTypes.STONE]]);

    assert.equal(restoreSnapshotIfAny(), true);
    assert.equal(state.worldSeed, 123456);
    assert.equal(state.gameMode, GameModes.SURVIVAL);
    assert.deepEqual([state.player.health, state.player.hunger, state.player.air, state.player.xp], [7, 6, 3, 19]);
    assert.deepEqual(state.player.toolWear, { 190: 28 });
    assert.deepEqual(state.player.inventory, { 190: 1 });
    assert.equal(state.player.onGround, false);
    assert.equal(state.player.fallStartY, null);
    assert.equal(state.player.dead, false);
    assert.equal(state.player.inWater, false);
    assert.equal(state.itemDrops.length, 0); assert.equal(state.enemies.length, 0); assert.equal(state.tntEntities.length, 0);
    assert.equal(particleSystem.particles.length, 0); assert.equal(particleSystem.points.visible, false);
    assert.match((await building).skipped[0], /世界已切换/);
    assert.match(kineticStatusAt(41, 9, 40), /RPM/);
    assert.equal(at(51, 9, 50), lampId(1));
    Object.assign(state.player, { x: 30.5, y: 9, z: 30.5 }); pump();
    assert.equal(at(30, 9, 30), BlockTypes.AIR);
});

test('坏 base64 快照失败且不改世界、生存与瞬态', () => {
    reset({ seed: 777 });
    const world = state.blocks;
    setB(20, 12, 20, BlockTypes.DIAMOND_ORE);
    state.player.hunger = 8; state.player.toolWear = { 190: 20 };
    spawnBreakParticles(20, 10, 20, BlockTypes.STONE);
    sessionStorage.setItem('mcAssistant.snapshot', JSON.stringify({ v: 3, enc: 'raw', blocks: '!!!', worldSeed: 999, player: { hunger: 20 } }));
    assert.equal(restoreSnapshotIfAny(), false);
    assert.equal(state.blocks, world); assert.equal(at(20, 12, 20), BlockTypes.DIAMOND_ORE);
    assert.equal(state.worldSeed, 777); assert.equal(state.player.hunger, 8);
    assert.deepEqual(state.player.toolWear, { 190: 20 });
    assert.equal(particleSystem.particles.length, 12);
});

test('续编显式零次双通过保持零次，正式导出继续拦', async () => {
    reset(); await clearCards(); putLevel();
    const card = await buildLevelCard({ name: '零次草稿', draft: true });
    card.questions[0].meta.verifiedPasses = 0;
    assert.equal(await enterLevelEditor(card), true);
    try {
        await state.levelEdit.draftSavePending;
        const q = card.questions[0]; const w = localToWorld(q.x, q.y, q.z);
        assert.equal(getAuthoredLock(w.x, w.y, w.z).verifiedPasses, 0);
        const formal = await buildLevelCard({ name: '零次正式关' });
        assert.equal(formal.questions[0].meta.verifiedPasses, 0);
        assert.equal(validateLevelCard(formal).ok, false);
    } finally { await exitLevelEditor({ saveDraft: false }); await clearCards(); }
});

test('草稿缺 verifiedPasses 续编保持零次，不借旧正式卡兼容绕过验证', async () => {
    reset(); await clearCards(); putLevel();
    const card = await buildLevelCard({ name: '缺省验证草稿', draft: true });
    delete card.questions[0].meta.verifiedPasses;
    assert.equal(await enterLevelEditor(card), true);
    try {
        await state.levelEdit.draftSavePending;
        const q = card.questions[0]; const w = localToWorld(q.x, q.y, q.z);
        assert.equal(getAuthoredLock(w.x, w.y, w.z).verifiedPasses, 0);
        const formal = await buildLevelCard({ name: '缺省验证正式关' });
        assert.equal(formal.questions[0].meta.verifiedPasses, 0);
        assert.equal(validateLevelCard(formal).ok, false);
    } finally { await exitLevelEditor({ saveDraft: false }); await clearCards(); }
});

test('草稿作为模板使用创建新稿身份，编辑后保留原草稿', async () => {
    reset(); await clearCards(); putLevel();
    const card = await buildLevelCard({ name: '模板源草稿', draft: true, rules: { timeLimit: 80, lockAIHelp: false } });
    card.created = '2026-09-18T01:00:00.000Z';
    const source = await saveLevelCard(card);
    assert.equal(await enterLevelEditor(card, { templateName: '我的草稿模板', name: '模板副本' }), true);
    try {
        const ed = state.levelEdit;
        await ed.draftSavePending;
        assert.notEqual(ed.draftCard.created, card.created, '用作模板不能沿用源草稿创建时间');
        setB(83, 6, 83, BlockTypes.DIAMOND_ORE);
        const saved = await saveEditorDraft({ silent: true });
        assert.deepEqual(saved.rules, card.rules);
        assert.deepEqual(await getLevelCard(source.id), card, '源草稿保留内容与身份');
        const rows = await listLevelCards();
        assert.equal(rows.length, 2);
        assert.equal(rows.filter(row => row.id === source.id).length, 1);
    } finally { await exitLevelEditor({ saveDraft: false }); await clearCards(); }
});

test('持久 put 失败保留旧稿，重复会话降级不积累，恢复持久写后安全替换', async () => {
    reset(); await clearCards(); putLevel();
    const idb = controlledIndexedDB();
    try {
        const card = await buildLevelCard({ name: '持久原稿', draft: true });
        card.created = '2026-09-18T03:00:00.000Z';
        const source = await saveLevelCard(card);
        assert.equal(source.ok, true); assert.equal(source.sessionOnly, undefined);
        idb.control.failPuts = true;
        assert.equal(await enterLevelEditor(card), true);
        const ed = state.levelEdit;
        await ed.draftSavePending;
        for (const block of [BlockTypes.DIAMOND_ORE, BlockTypes.LOG, BlockTypes.GLASS]) {
            setB(83, 6, 83, block);
            await saveEditorDraft({ silent: true });
            assert.equal(idb.records().size, 1);
            assert.deepEqual(idb.records().get(source.id).card, card, '降级过程中不删除或改写持久源稿');
            assert.equal(idb.control.deleted.includes(source.id), false);
            const rows = await listLevelCards();
            assert.equal(rows.length, 2, '只保留持久原稿与最新会话稿');
            assert.equal(rows.filter(row => row.sessionOnly).length, 1);
        }
        const sessionId = (await listLevelCards()).find(row => row.sessionOnly).id;
        idb.control.failPuts = false;
        setB(83, 6, 83, BlockTypes.DIRT);
        const persisted = await saveEditorDraft({ silent: true });
        const rows = await listLevelCards();
        assert.equal(rows.length, 1); assert.equal(rows[0].sessionOnly, undefined);
        assert.equal(idb.records().size, 1); assert.equal(idb.records().has(source.id), false);
        assert.equal(await getLevelCard(sessionId), null, '持久成功后移除旧会话版本');
        assert.deepEqual((await getLevelCard(rows[0].id)), persisted);
    } finally {
        if (state.levelEdit) await exitLevelEditor({ saveDraft: false });
        await clearCards(); idb.restore();
    }
});

test('同身份写入降级时显示最新会话内容，持久成功后清除会话标记', async () => {
    reset(); await clearCards(); putLevel();
    const idb = controlledIndexedDB();
    try {
        const original = await buildLevelCard({ name: '持久名称', draft: true });
        const source = await saveLevelCard(original);
        const latest = structuredClone(original); latest.name = '最新会话名称';
        idb.control.failPuts = true;
        const fallback = await saveLevelCard(latest);
        assert.equal(fallback.id, source.id);
        assert.equal(fallback.sessionOnly, true);
        assert.deepEqual(await getLevelCard(source.id), latest);
        assert.equal((await listLevelCards())[0].name, latest.name);
        assert.equal((await listLevelCards())[0].sessionOnly, true);
        assert.deepEqual(idb.records().get(source.id).card, original);
        idb.control.failPuts = false;
        assert.equal((await saveLevelCard(latest)).sessionOnly, undefined);
        assert.equal((await listLevelCards())[0].sessionOnly, undefined);
        assert.deepEqual(idb.records().get(source.id).card, latest);
    } finally { await clearCards(); idb.restore(); }
});

test('同身份降级草稿退出后续编仍保留持久备份，恢复写入才替换', async () => {
    reset(); await clearCards(); putLevel();
    const idb = controlledIndexedDB();
    try {
        const original = await buildLevelCard({ name: '跨会话持久原稿', draft: true });
        const source = await saveLevelCard(original);
        idb.control.failPuts = true;
        assert.equal(await enterLevelEditor(original), true);
        await state.levelEdit.draftSavePending;
        state.levelEdit.name = '同身份会话新名称';
        await saveEditorDraft({ silent: true });
        await exitLevelEditor({ saveDraft: false });
        const latest = await getLevelCard(source.id);
        assert.equal(latest.name, '同身份会话新名称');
        assert.equal(await enterLevelEditor(latest), true);
        await state.levelEdit.draftSavePending;
        assert.equal(state.levelEdit.persistentDraftId, source.id);
        setB(83, 6, 83, BlockTypes.DIAMOND_ORE);
        await saveEditorDraft({ silent: true });
        assert.deepEqual(idb.records().get(source.id).card, original);
        assert.equal(idb.control.deleted.includes(source.id), false);
        assert.equal((await listLevelCards()).filter(row => row.sessionOnly).length, 1);
        idb.control.failPuts = false;
        setB(83, 6, 83, BlockTypes.GLASS);
        await saveEditorDraft({ silent: true });
        assert.equal(idb.records().has(source.id), false);
        assert.equal((await listLevelCards()).length, 1);
    } finally {
        if (state.levelEdit) await exitLevelEditor({ saveDraft: false });
        await clearCards(); idb.restore();
    }
});

test('异步取锁时几何采用同一快照，切世界则拒绝混合卡', async () => {
    reset(); putLevel();
    const gate = deferred(); const started = deferred();
    const pending = buildLevelCard({ name: '一致快照', lockMetaProvider: async () => { started.resolve(); await gate.promise; return { question: QUESTION, verifiedPasses: 2 }; } });
    await started.promise;
    setB(40, 9, 40, BlockTypes.AIR); setB(48, 9, 40, BlockTypes.AIR);
    gate.resolve();
    const card = await pending;
    assert.equal(card.error, undefined);
    const decoded = decodeRegionBlocks(card).blocks;
    const r = card.region;
    assert.equal(decoded[card.flags.start.x + card.flags.start.z * r.w + card.flags.start.y * r.w * r.d], FLAG_BASE + FLAG_START);
    assert.equal(decoded[card.flags.goal.x + card.flags.goal.z * r.w + card.flags.goal.y * r.w * r.d], FLAG_BASE + FLAG_GOAL);

    putLevel(); const swapped = deferred(); const swapping = deferred();
    const mixed = buildLevelCard({ name: '切世界', lockMetaProvider: async () => { swapping.resolve(); await swapped.promise; return { question: QUESTION, verifiedPasses: 2 }; } });
    await swapping.promise;
    state.blocks = new Uint8Array(state.blocks.length);
    swapped.resolve();
    assert.match((await mixed).error, /世界已切换/);

    putLevel();
    const loadingDefault = buildLevelCard({ name: '默认锁切会话' });
    state.levelEdit = {};
    assert.match((await loadingDefault).error, /世界已切换/, '默认锁模块 await 后也必须核对原会话');
    state.levelEdit = null;
});

test('正式卡改副本保留源卡；普通退出追加末稿且退出后拒收新保存', async () => {
    reset(); await clearCards(); putLevel();
    const idb = controlledIndexedDB(); // 正常自动退出要求末稿持久成功，不能把会话降级当成磁盘保存。
    const sourceCard = await buildLevelCard({ name: '正式源卡', rules: { timeLimit: 60, lockAIHelp: true } });
    sourceCard.created = '2026-09-15T00:00:00.000Z';
    const source = await saveLevelCard(sourceCard);
    spawnBreakParticles(20, 10, 20, BlockTypes.STONE);
    assert.equal(await enterLevelEditor(sourceCard, { name: '正式副本' }), true);
    assert.equal(particleSystem.particles.length, 0, '进入编辑器清掉原世界粒子');
    const ed = state.levelEdit;
    await ed.draftSavePending;
    const delay = delayThumbnail();
    let saving; let exiting;
    try {
        saving = saveEditorDraft({ silent: true });
        await delay.started;
        ed.name = '副本最终版';
        setB(83, 6, 83, BlockTypes.DIAMOND_ORE);
        exiting = exitLevelEditor();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(state.levelEdit, ed);
        assert.equal(await saveEditorDraft({ silent: true }), null, '退出已封住新的保存入口');
        delay.restore(); delay.release();
        await saving; assert.equal(await exiting, true);
        const rows = await listLevelCards();
        assert.equal(rows.length, 2);
        assert.deepEqual(await getLevelCard(source.id), sourceCard, '正式源卡内容与身份保留');
        const draftRow = rows.find(row => row.id !== source.id);
        const draft = await getLevelCard(draftRow.id);
        assert.equal(draft.meta.draft, true); assert.equal(draft.name, '副本最终版');
        assert.deepEqual(draft.rules, sourceCard.rules);
    } finally {
        delay.restore(); delay.release();
        await Promise.allSettled([saving, exiting].filter(Boolean));
        if (state.levelEdit) await exitLevelEditor({ saveDraft: false });
        await clearCards();
        idb.restore();
    }
});

test('草稿串行保存保持单条身份与规则；不补存退出排空在途、并发退出合并', async () => {
    reset(); await clearCards(); putLevel();
    const card = await buildLevelCard({ name: '并发草稿', draft: true, rules: { timeLimit: 90, lockAIHelp: false } });
    card.created = '2026-09-18T02:00:00.000Z';
    const source = await saveLevelCard(card);
    assert.equal(await enterLevelEditor(card), true);
    const ed = state.levelEdit;
    await ed.draftSavePending;
    const delay = delayThumbnail();
    let first; let second; let exiting; let exitingAgain;
    try {
        first = saveEditorDraft({ silent: true });
        await delay.started;
        setB(83, 6, 83, BlockTypes.DIAMOND_ORE);
        ed.name = '并发草稿更新';
        second = saveEditorDraft({ silent: true });
        exiting = exitLevelEditor({ saveDraft: false });
        exitingAgain = exitLevelEditor({ saveDraft: false });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(state.levelEdit, ed, '存稿完成前必须保留编辑世界与锁题表');
        delay.restore(); delay.release();
        const [oldDraft, latestDraft] = await Promise.all([first, second]);
        assert.equal(oldDraft.name, '并发草稿'); assert.equal(latestDraft.name, '并发草稿更新');
        assert.equal(await exiting, true); assert.equal(await exitingAgain, true);
        const rows = await listLevelCards();
        assert.equal(rows.length, 1); assert.equal(rows[0].name, '并发草稿更新');
        const saved = await getLevelCard(rows[0].id);
        assert.equal(saved.created, card.created);
        assert.deepEqual(saved.rules, { timeLimit: 90, lockAIHelp: false });
        assert.equal(await getLevelCard(source.id), null, '更新后的草稿替代旧 hash 身份');
        assert.equal(state.levelEdit, null);
        assert.equal(at(40, 9, 40), FLAG_BASE + FLAG_START, '退出精确读回原世界');
    } finally {
        delay.restore(); delay.release();
        await Promise.allSettled([first, second, exiting, exitingAgain].filter(Boolean));
        if (state.levelEdit) await exitLevelEditor({ saveDraft: false });
        await clearCards();
    }
});

test('到达限时同帧踩终点判超时零星，限时前仍可通关', () => {
    reset();
    const makeRun = elapsed => ({ elapsed, finished: false, deaths: 0, rules: { timeLimit: 10 }, answers: {}, activatedCheckpoints: new Set(), card: { name: '限时关', questions: [], flags: { goal: { x: 1, y: 9, z: 1 }, checkpoints: [] } } });
    const hooks = { toWorld: (x, y, z) => ({ x, y, z }) };
    const goal = { x: 1.5, y: 9, z: 1.5 };
    const run = makeRun(9.95);
    const timeout = tickRun(run, 0.05, goal, hooks);
    assert.equal(timeout.timeout, true); assert.equal(timeout.stars, 0); assert.equal(run.finished, true);
    assert.equal(tickRun(run, 1, goal, hooks), null);
    const early = tickRun(makeRun(9.8), 0.05, goal, hooks);
    assert.equal(early.timeout, undefined); assert.equal(early.stars, 3);
});
