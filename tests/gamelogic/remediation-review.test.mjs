import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, state, setB, at } from './kit.mjs';
import { BlockTypes, FLAG_BASE, FLAG_START, FLAG_GOAL, KEYPAD_BASE } from '../../js/config.js';
import { buildLevelCard, listLevelCards, getLevelCard, deleteLevelCard } from '../../js/levelWorkshop.js';
import { seedAuthoredLock, restoreAuthoredLocks, getExamIntent, setExamIntent } from '../../js/eduKeypad.js';
import { enterLevel, getLevelEntryError } from '../../js/levelRun.js';
import { enterLevelEditor, exitLevelEditor, getEditorEntryError } from '../../js/levelEditor.js';
import { doLevelExport } from '../../js/ui.js';

function reset() {
    state.levelRun = null; state.levelEdit = null; state.temporaryWorldTransition = null;
    freshWorld(); restoreAuthoredLocks([]); setExamIntent(false);
}
async function card() {
    setB(40, 9, 40, FLAG_BASE + FLAG_START); setB(48, 9, 40, FLAG_BASE + FLAG_GOAL);
    setB(44, 9, 40, KEYPAD_BASE);
    seedAuthoredLock(44, 9, 40, { subject: 'math', kind: 'input', stem: '6+7=?', answer: 13, hint: '凑十', meta: { source: 'custom' } }, 2);
    return buildLevelCard({ name: '复核入口', rules: { timeLimit: 90, lockAIHelp: false } });
}

test('落盘失败在真实进关/编辑入口显示存储原因，退出入口互斥锁', async () => {
    reset();
    const value = await card(); const blocks = state.blocks;
    const set = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
        assert.equal(await enterLevel(value), null);
        assert.match(getLevelEntryError(), /保存失败.*存储空间/);
        assert.match(document.getElementById('tooltip').textContent, /保存失败.*存储空间/);
        assert.equal(state.temporaryWorldTransition, null);
        assert.equal(await enterLevelEditor(value), false);
        assert.match(getEditorEntryError(), /保存失败.*存储空间/);
        assert.equal(state.blocks, blocks);
        assert.equal(state.temporaryWorldTransition, null);
    } finally { localStorage.setItem = set; }
});

test('异步临时世界入口互斥，快速编辑/进关只允许第一请求进入', async () => {
    reset(); const value = await card(); setB(20, 12, 20, BlockTypes.DIAMOND_ORE);
    const results = await Promise.all([enterLevelEditor(value), enterLevel(value), enterLevelEditor(value)]);
    assert.deepEqual(results, [true, null, false]);
    assert.ok(state.levelEdit); assert.equal(state.levelRun, null);
    assert.equal(state.temporaryWorldTransition, null);
    await exitLevelEditor({ saveDraft: false });
    assert.equal(at(20, 12, 20), BlockTypes.DIAMOND_ORE);
});

test('正式导出入口保留源卡限时与考核锁，作者修改考核锁仍生效', async () => {
    reset(); const value = await card();
    const previousIds = new Set((await listLevelCards()).map(r => r.id));
    assert.equal(await enterLevelEditor(value), true);
    try {
        await state.levelEdit.draftSavePending;
        assert.equal(getExamIntent(), true, '源卡禁止AI帮助初始化到考核意图');
        document.getElementById('export-name').value = '正式保真';
        document.getElementById('export-author').value = '回归';
        await doLevelExport(false);
        let row = (await listLevelCards()).find(r => r.name === '正式保真');
        assert.ok(row); assert.deepEqual((await getLevelCard(row.id)).rules, value.rules);
        setExamIntent(false);
        assert.equal(state.levelEdit.rules.lockAIHelp, true);
        document.getElementById('export-name').value = '正式允许帮助';
        await doLevelExport(false);
        row = (await listLevelCards()).find(r => r.name === '正式允许帮助');
        assert.ok(row);
        assert.deepEqual((await getLevelCard(row.id)).rules, { timeLimit: 90, lockAIHelp: true });
    } finally {
        await exitLevelEditor({ saveDraft: false });
        assert.equal(getExamIntent(), false, '退编辑器恢复普通世界考核意图');
        for (const row of await listLevelCards()) if (!previousIds.has(row.id)) await deleteLevelCard(row.id);
    }
});
