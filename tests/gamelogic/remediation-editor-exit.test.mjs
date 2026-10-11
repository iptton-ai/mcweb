import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, state, setB, at } from './kit.mjs';
import { BlockTypes, GameModes, FLAG_BASE, FLAG_START, FLAG_CHECKPOINT, FLAG_GOAL, KEYPAD_BASE } from '../../js/config.js';
import * as editor from '../../js/levelEditor.js';
import { seedAuthoredLock, getAuthoredLock, restoreAuthoredLocks, listAuthoredLocks } from '../../js/eduKeypad.js';
import { buildLevelCard, saveLevelCard, listLevelCards, getLevelCard, deleteLevelCard, localToWorld } from '../../js/levelWorkshop.js';
import { isGameActive, isKeyboardPlayActive, getUIState } from '../../js/uiModal.js';

const QUESTION = { subject: 'math', kind: 'input', stem: '6+7=?', answer: 13, hint: '先凑十', meta: { source: 'custom' } };

// 仅控制浏览器存储边界，所有世界、卡片生成和退出流程运行真实游戏模块。
// 每次写入／读取采用 structuredClone，防测试因 Map 引用共用而漏掉持久备份被改写。
function controlledIndexedDB() {
    const previous = globalThis.indexedDB;
    const stores = new Map();
    const control = {
        failPuts: false, holdPuts: false, abortPutsAfterSuccess: false,
        puts: 0, successfulPutRequests: 0, committedPuts: 0, abortedPuts: 0,
        releases: [], deleted: [],
    };
    const request = operation => {
        const req = {};
        queueMicrotask(() => {
            try { req.result = operation(); req.onsuccess?.(); }
            catch (error) { req.error = error; req.onerror?.(); }
        });
        return req;
    };
    const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore(name) { stores.set(name, new Map()); },
        close() {},
        transaction(name, mode) {
            const rows = stores.get(name);
            assert.ok(rows, `store ${name} 已创建`);
            if (mode !== 'readwrite') return { objectStore: () => ({
                get: id => request(() => structuredClone(rows.get(id))),
                getAll: () => request(() => structuredClone([...rows.values()])),
            }) };
            // 真 IndexedDB 的 request success 只代表工作副本写入成功；事务 complete 才持久提交。
            const working = structuredClone(rows);
            const tx = { error: null };
            const mutate = (operation, { put = false, deletedId } = {}) => {
                const req = {};
                const completeRequest = () => {
                    try {
                        req.result = operation();
                        if (put) control.successfulPutRequests++;
                        req.onsuccess?.();
                        queueMicrotask(() => {
                            if (put && control.abortPutsAfterSuccess) {
                                control.abortedPuts++;
                                tx.error = new DOMException('事务提交失败：持久写入中止', 'AbortError');
                                tx.onabort?.();
                                return;
                            }
                            rows.clear();
                            for (const [id, rec] of working) rows.set(id, structuredClone(rec));
                            if (put) control.committedPuts++;
                            if (deletedId !== undefined) control.deleted.push(deletedId);
                            tx.oncomplete?.();
                        });
                    } catch (error) {
                        req.error = error; tx.error = error;
                        req.onerror?.();
                        queueMicrotask(() => tx.onabort?.());
                    }
                };
                if (put) control.puts++;
                if (put && control.holdPuts) control.releases.push(completeRequest);
                else queueMicrotask(completeRequest);
                return req;
            };
            tx.objectStore = () => ({
                put(record) {
                    const copy = structuredClone(record);
                    return mutate(() => {
                        if (control.failPuts) throw new DOMException('空间不足', 'QuotaExceededError');
                        working.set(copy.id, copy);
                        return copy.id;
                    }, { put: true });
                },
                delete: id => mutate(() => working.delete(id), { deletedId: id }),
            });
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
    return {
        control,
        records: () => stores.get('cards'),
        releaseAll: () => { control.holdPuts = false; for (const release of control.releases.splice(0)) release(); },
        restore: () => { globalThis.indexedDB = previous; },
    };
}

async function until(predicate, message) {
    // 给真实动态 import 和存储请求事件让出执行；无真实 sleep，也不以机器时钟推进玩法。
    for (let i = 0; i < 2000; i++) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail(message);
}

async function clearCards() {
    for (const row of await listLevelCards()) await deleteLevelCard(row.id);
}

function storedSlots() {
    const rows = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('mcweb.save')) rows.push([key, localStorage.getItem(key)]);
    }
    return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

async function fixture({ blank = false } = {}) {
    state.levelEdit = null; state.levelRun = null;
    state.editorExitOpen = false; state.temporaryWorldTransition = null;
    state.recordingControlsOpen = state.levelExportOpen = state.prefabPickerOpen = false;
    state.authorPanelOpen = state.questionBankOpen = state.helpDocOpen = false;
    state.inputMode = 'keyboard';
    localStorage.clear(); sessionStorage.clear();
    restoreAuthoredLocks([]);
    freshWorld({ seed: 123456, gameMode: GameModes.SURVIVAL });
    state.saveSlot = 2;
    state.player.inventory = { [BlockTypes.LOG]: 3 };
    state.player.toolWear = {}; state.player.hunger = 16; state.player.air = 8; state.player.xp = 11;
    setB(12, 9, 12, KEYPAD_BASE);
    seedAuthoredLock(12, 9, 12, QUESTION, 1);
    const originalBlocks = state.blocks.slice();
    const originalLocks = listAuthoredLocks();
    await clearCards();
    const idb = controlledIndexedDB();
    let source = null;
    let card = null;
    if (!blank) {
        // 原世界的教学锁在远处，显式区域由源关卡旗组限定；删除它仅为建测试卡。
        setB(12, 9, 12, BlockTypes.AIR);
        setB(40, 9, 40, FLAG_BASE + FLAG_START);
        setB(44, 9, 40, KEYPAD_BASE);
        setB(48, 9, 40, FLAG_BASE + FLAG_GOAL);
        seedAuthoredLock(44, 9, 40, QUESTION, 2);
        card = await buildLevelCard({ name: '退出保护源草稿', draft: true, rules: { timeLimit: 90, lockAIHelp: false } });
        assert.equal(card.error, undefined);
        source = await saveLevelCard(card);
        assert.equal(source.sessionOnly, undefined);
        // 回到真正的进编辑器前世界，检验精确恢复与作者锁题快照。
        state.blocks = originalBlocks.slice();
        restoreAuthoredLocks(originalLocks);
    }
    assert.equal(await editor.enterLevelEditor(card), true);
    const ed = state.levelEdit;
    await ed.draftSavePending;
    // 入场自动存稿已把世界坐标、作者等正常信息更新；失败退出应保护这一最后有效版。
    if (card) card = structuredClone(ed.draftCard);
    const slots = storedSlots();
    const anchors = card ? {
        start: localToWorld(card.flags.start.x, card.flags.start.y, card.flags.start.z),
        goal: localToWorld(card.flags.goal.x, card.flags.goal.y, card.flags.goal.z),
        lock: localToWorld(card.questions[0].x, card.questions[0].y, card.questions[0].z),
    } : null;
    return {
        ed, idb, source, card, anchors, originalBlocks, originalLocks, slots,
        async cleanup() {
            idb.releaseAll();
            idb.control.failPuts = idb.control.abortPutsAfterSuccess = false;
            if (state.levelEdit) await editor.exitLevelEditor({ saveDraft: false });
            await clearCards(); idb.restore();
        },
    };
}

function erase(position) {
    setB(position.x, position.y, position.z, BlockTypes.AIR);
}

async function promptForExit(f, options) {
    const pending = editor.exitLevelEditor(options);
    await until(() => f.ed.exitPrompt, '失败退出必须等待玩家选择');
    assert.equal(state.editorExitOpen, true);
    return { pending };
}

function assertEditingUnchanged(f, editBlocks, editLocks, rules) {
    assert.equal(state.levelEdit, f.ed);
    assert.equal(state.blocks, editBlocks, '保存失败不得切换或重新嵌入世界');
    assert.deepEqual(listAuthoredLocks(), editLocks, '保存失败不得恢复原世界的锁题表');
    assert.deepEqual(f.ed.rules, rules);
    assert.equal(state.saveSlot, 2);
    assert.deepEqual(storedSlots(), f.slots, '编辑世界与失败退出不写玩家存档槽');
    assert.equal(isGameActive(), false, '选择期间世界操作谓词停用');
    assert.equal(isKeyboardPlayActive(), false, '选择期间纯键盘不能挖掘或移动');
}

for (const scenario of [
    { name: '无锚点', blank: true, reason: /锚点/ },
    { name: '缺起点旗', remove: 'start', reason: /起点旗/ },
    { name: '缺终点旗', remove: 'goal', reason: /终点旗/ },
    { name: '区域超范围', overflow: true, reason: /96[×x]64[×x]96|超出/ },
]) {
    test(`${scenario.name}保存失败保留世界和旧稿，明确继续后可再次编辑`, async () => {
        const f = await fixture({ blank: scenario.blank });
        try {
            if (scenario.remove) erase(f.anchors[scenario.remove]);
            if (scenario.overflow) setB(220, 6, 220, FLAG_BASE + FLAG_GOAL);
            setB(83, 6, 83, BlockTypes.DIAMOND_ORE);
            const editBlocks = state.blocks;
            const editLocks = listAuthoredLocks();
            const rules = structuredClone(f.ed.rules);
            const { pending } = await promptForExit(f);
            assert.match(f.ed.exitPrompt.reason, scenario.reason);
            assert.match(f.ed.draftSaveError, scenario.reason);
            assertEditingUnchanged(f, editBlocks, editLocks, rules);
            assert.equal(at(83, 6, 83), BlockTypes.DIAMOND_ORE);
            if (f.source) assert.deepEqual(await getLevelCard(f.source.id), f.card, '保留最后有效草稿');
            assert.equal(await editor.resolveEditorExitDecision(false), true);
            assert.equal(await pending, false);
            assert.equal(state.levelEdit, f.ed);
            assert.equal(state.editorExitOpen, false);
            assert.equal(f.ed.exiting, false);
            assert.ok(!f.ed.exitPending && !f.ed.exitPrompt, '继续后必须清除退出锁与待决选择');
            assert.equal(isKeyboardPlayActive(), true);
        } finally { await f.cleanup(); }
    });
}

test('继续编辑修正缺旗后正常保存退出，新稿包含修改且原世界精确恢复', async () => {
    const f = await fixture();
    try {
        erase(f.anchors.goal);
        setB(83, 6, 83, BlockTypes.DIAMOND_ORE);
        const { pending } = await promptForExit(f);
        await editor.resolveEditorExitDecision(false);
        assert.equal(await pending, false);
        setB(f.anchors.goal.x, f.anchors.goal.y, f.anchors.goal.z, FLAG_BASE + FLAG_GOAL);
        assert.ok(await editor.saveEditorDraft({ silent: true }), '取消后重新开放存稿');
        assert.equal(f.ed.draftSaveError, '');
        assert.equal(await editor.exitLevelEditor(), true);
        assert.equal(state.levelEdit, null);
        assert.equal(state.editorExitOpen, false);
        assert.equal(getUIState(), 'title');
        assert.deepEqual(state.blocks, f.originalBlocks);
        assert.deepEqual(listAuthoredLocks(), f.originalLocks);
        assert.equal(state.saveSlot, 2);
        const rows = await listLevelCards();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].sessionOnly, undefined);
        const latest = await getLevelCard(rows[0].id);
        assert.deepEqual(latest.rules, { timeLimit: 90, lockAIHelp: false });
        assert.equal(latest.questions[0].meta.verifiedPasses, 2);
        assert.notDeepEqual(latest.region.blocks, f.card.region.blocks);
        assert.equal(await editor.enterLevelEditor(latest), true);
        await state.levelEdit.draftSavePending;
        assert.equal(at(83, 6, 83), BlockTypes.DIAMOND_ORE, '新稿可续编且带回修改');
        const q = latest.questions[0]; const w = localToWorld(q.x, q.y, q.z);
        assert.equal(getAuthoredLock(w.x, w.y, w.z).verifiedPasses, 2);
    } finally { await f.cleanup(); }
});

test('明确放弃失败末稿才恢复原世界，原锁题和持久草稿不丢失', async () => {
    const f = await fixture();
    try {
        erase(f.anchors.start);
        seedAuthoredLock(f.anchors.lock.x, f.anchors.lock.y, f.anchors.lock.z, { ...QUESTION, stem: '编辑后题目' }, 0);
        f.ed.rules = { timeLimit: 30, lockAIHelp: true };
        setB(83, 6, 83, BlockTypes.DIAMOND_ORE);
        const { pending } = await promptForExit(f);
        assert.equal(await editor.resolveEditorExitDecision(true), true);
        assert.equal(await pending, true);
        assert.equal(state.levelEdit, null);
        assert.equal(state.editorExitOpen, false);
        assert.deepEqual(state.blocks, f.originalBlocks);
        assert.deepEqual(listAuthoredLocks(), f.originalLocks);
        assert.equal(state.gameMode, GameModes.SURVIVAL);
        assert.equal(state.worldSeed, 123456);
        assert.equal(state.saveSlot, 2);
        assert.deepEqual(storedSlots(), f.slots);
        assert.deepEqual(await getLevelCard(f.source.id), f.card);
        assert.equal(await editor.resolveEditorExitDecision(true), false, '过时选择不得影响下一世界');
    } finally { await f.cleanup(); }
});

test('持久写异常降级仅会话时退出等待选择，继续后恢复写入才正常退出', async () => {
    const f = await fixture();
    try {
        const persisted = structuredClone(f.idb.records().get(f.source.id));
        f.idb.control.failPuts = true;
        setB(83, 6, 83, BlockTypes.DIAMOND_ORE);
        const { pending } = await promptForExit(f);
        assert.match(f.ed.exitPrompt.reason, /会话/);
        assert.match(f.ed.exitPrompt.reason, /刷新|持久|存储/);
        assert.deepEqual(f.idb.records().get(f.source.id), persisted);
        assert.equal(f.idb.control.deleted.includes(f.source.id), false);
        assert.equal((await listLevelCards()).filter(row => row.sessionOnly).length, 1);
        await editor.resolveEditorExitDecision(false);
        assert.equal(await pending, false);
        f.idb.control.failPuts = false;
        assert.equal(await editor.exitLevelEditor(), true);
        assert.equal(state.levelEdit, null);
        assert.deepEqual(state.blocks, f.originalBlocks);
        const rows = await listLevelCards();
        assert.equal(rows.length, 1); assert.equal(rows[0].sessionOnly, undefined);
        assert.equal(f.idb.records().size, 1);
    } finally { await f.cleanup(); }
});

test('写请求成功后事务中止不能宣称持久保存，保留备份并等待玩家选择', async () => {
    const f = await fixture();
    try {
        const persisted = structuredClone(f.idb.records().get(f.source.id));
        const priorCommitted = f.idb.control.committedPuts;
        const priorSuccess = f.idb.control.successfulPutRequests;
        f.idb.control.abortPutsAfterSuccess = true;
        setB(83, 6, 83, BlockTypes.DIAMOND_ORE);
        const editBlocks = state.blocks;
        const { pending } = await promptForExit(f);
        assert.equal(f.idb.control.successfulPutRequests, priorSuccess + 1, 'put 请求已触发 onsuccess');
        assert.equal(f.idb.control.abortedPuts, 1, '随后事务中止，工作副本不提交');
        assert.equal(f.idb.control.committedPuts, priorCommitted);
        assert.match(f.ed.exitPrompt.reason, /事务提交失败|持久写入中止|事务/);
        assert.match(f.ed.exitPrompt.reason, /会话/);
        assert.equal(state.blocks, editBlocks);
        assert.deepEqual(f.idb.records().get(f.source.id), persisted);
        assert.equal(f.idb.records().size, 1);
        assert.equal(f.idb.control.deleted.includes(f.source.id), false, '失败事务不得引发删除持久备份');
        assert.equal((await listLevelCards()).filter(row => row.sessionOnly).length, 1);
        await editor.resolveEditorExitDecision(false);
        assert.equal(await pending, false);
        assert.equal(state.levelEdit, f.ed);
        f.idb.control.abortPutsAfterSuccess = false;
        assert.equal(await editor.exitLevelEditor(), true);
        assert.equal(f.idb.control.committedPuts, priorCommitted + 1);
        assert.equal(state.levelEdit, null);
        assert.deepEqual(state.blocks, f.originalBlocks);
        const rows = await listLevelCards();
        assert.equal(rows.length, 1); assert.equal(rows[0].sessionOnly, undefined);
        assert.equal(f.idb.records().size, 1);
        assert.deepEqual(await getLevelCard(rows[0].id), f.idb.records().get(rows[0].id).card);
    } finally { await f.cleanup(); }
});

test('存稿意外异常捕获具体原因，继续后解除保存锁并可重试', async () => {
    const f = await fixture();
    try {
        const rules = f.ed.rules;
        // buildLevelCard 真读规则；触发异步存稿异常，检验 finally 能排空队列并保护会话。
        f.ed.rules = { get timeLimit() { throw new Error('规则读取失败：存稿异常'); }, lockAIHelp: false };
        const editBlocks = state.blocks;
        const { pending } = await promptForExit(f);
        assert.match(f.ed.exitPrompt.reason, /规则读取失败|存稿异常/);
        assert.equal(state.blocks, editBlocks);
        assert.deepEqual(await getLevelCard(f.source.id), f.card);
        await editor.resolveEditorExitDecision(false);
        assert.equal(await pending, false);
        assert.equal(f.ed.draftSavePending, null);
        f.ed.rules = rules;
        assert.ok(await editor.saveEditorDraft({ silent: true }));
        assert.equal(await editor.exitLevelEditor(), true);
    } finally { await f.cleanup(); }
});

test('重复失败退出合并末稿与同一个待决选择，取消后下一次退出重新保存', async () => {
    const f = await fixture();
    try {
        erase(f.anchors.goal);
        const first = editor.exitLevelEditor();
        const shared = f.ed.exitPending;
        const second = editor.exitLevelEditor({ toTitle: false });
        assert.equal(f.ed.exitPending, shared);
        await until(() => f.ed.exitPrompt, '重复退出仍应产生唯一选择');
        const prompt = f.ed.exitPrompt;
        const third = editor.exitLevelEditor();
        assert.equal(f.ed.exitPrompt, prompt);
        assert.equal(await editor.saveEditorDraft({ silent: true }), null, '待决选择不接收新保存');
        await editor.resolveEditorExitDecision(false);
        assert.deepEqual(await Promise.all([first, second, third]), [false, false, false]);
        assert.equal(state.levelEdit, f.ed);
        const retry = editor.exitLevelEditor();
        await until(() => f.ed.exitPrompt, '继续后可以再次请求退出');
        assert.notEqual(f.ed.exitPrompt, prompt);
        await editor.resolveEditorExitDecision(true);
        assert.equal(await retry, true);
        assert.deepEqual(state.blocks, f.originalBlocks);
    } finally { await f.cleanup(); }
});

test('退出先排空在途保存；不补存明确放弃可结束已有待决选择', async () => {
    const f = await fixture();
    try {
        f.idb.control.holdPuts = true;
        setB(83, 6, 83, BlockTypes.DIAMOND_ORE);
        const saving = editor.saveEditorDraft({ silent: true });
        await until(() => f.idb.control.releases.length === 1, '保存已到达存储请求边界');
        erase(f.anchors.goal);
        const exiting = editor.exitLevelEditor();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(state.levelEdit, f.ed);
        assert.equal(f.ed.exitPrompt, undefined, '在途写结束前不提前放弃或恢复');
        f.idb.releaseAll();
        assert.ok(await saving);
        await until(() => f.ed.exitPrompt, '排空后末稿校验失败等待选择');
        const persisted = structuredClone([...f.idb.records().values()][0].card);
        const forceDiscard = editor.exitLevelEditor({ saveDraft: false });
        assert.equal(await forceDiscard, true);
        assert.equal(await exiting, true);
        assert.equal(state.levelEdit, null);
        assert.deepEqual(state.blocks, f.originalBlocks);
        const rows = await listLevelCards();
        assert.equal(rows.length, 1);
        assert.deepEqual(await getLevelCard(rows[0].id), persisted, '明确放弃不抹掉已完成的在途存稿');
    } finally { await f.cleanup(); }
});

test('末稿保存请求在途时共享盖章入口拒写，继续编辑后组件可正常放置', async () => {
    const f = await fixture();
    try {
        assert.equal(editor.startPlacing('flag_checkpoint'), true);
        f.idb.control.holdPuts = true;
        const pending = editor.exitLevelEditor();
        await until(() => f.idb.control.releases.length === 1, '退出末稿已到存储请求边界');
        const editingBlocks = state.blocks;
        const snapshot = editingBlocks.slice();
        const hit = { x: 84, y: 3, z: 84, face: { dx: 0, dy: 1, dz: 0 } };
        assert.equal(f.ed.exiting, true);
        assert.equal(state.editorExitOpen, false, '存稿尚在途，还没有失败选择框');
        assert.equal(editor.consumePlaceClick(), false, '共享点击消费入口不能绕过退出守卫');
        assert.equal(await editor.stampPrefabAt('flag_checkpoint', hit), false);
        assert.equal(state.blocks, editingBlocks);
        assert.equal(Buffer.compare(state.blocks, snapshot), 0, '在途保存期间不能偷偷写组件方块');
        f.idb.control.failPuts = true;
        f.idb.releaseAll();
        await until(() => f.ed.exitPrompt, '持久失败后产生继续编辑选择');
        assert.equal(editor.consumePlaceClick(), false);
        assert.equal(await editor.stampPrefabAt('flag_checkpoint', hit), false);
        assert.equal(Buffer.compare(state.blocks, snapshot), 0, '选择期间组件入口也不能写世界');
        await editor.resolveEditorExitDecision(false);
        assert.equal(await pending, false);
        f.idb.control.failPuts = false;
        assert.equal(await editor.stampPrefabAt('flag_checkpoint', hit), true, '继续后重新开放组件盖章');
        assert.equal(at(84, 4, 84), FLAG_BASE + FLAG_CHECKPOINT);
        assert.equal(await editor.exitLevelEditor(), true);
    } finally { await f.cleanup(); }
});
