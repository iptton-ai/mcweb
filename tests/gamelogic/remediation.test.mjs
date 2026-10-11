import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, state, setB, at } from './kit.mjs';
import { BlockTypes, GameModes, ToolTypes, RECIPES, waterwheelId, buttonId, buttonPressed } from '../../js/config.js';
import { initRedstone } from '../../js/redstone.js';
import { updateKineticNetwork, kineticStatusAt } from '../../js/kinetic.js';
import { spawnTntEntity, updateTnt, explode } from '../../js/tnt.js';
import { tickRun } from '../../js/levelRun.js';
import { craftRecipe } from '../../js/ui.js';
import { dropHeldItem } from '../../js/interaction.js';
import { updateItemDrops } from '../../js/items.js';
import { saveGame, importSlotJson, exportSlotJson, loadGame } from '../../js/saveGame.js';
import { enterLevel } from '../../js/levelRun.js';
import { enterLevelEditor } from '../../js/levelEditor.js';
import { saveSnapshotForReload, restoreSnapshotIfAny } from '../../js/assistant/snapshot.js';

test('损坏世界导入保留原槽位与索引', () => {
    freshWorld();
    state.levelRun = null; state.levelEdit = null; state.saveSlot = 0;
    assert.equal(saveGame(), true);
    const original = exportSlotJson(0);
    const index = localStorage.getItem('mcweb.save.index');
    for (const extra of [
        { blocks: 'AA==', enc: 'raw' },
        { blocks: '!!!', enc: 'raw' },
        { blocks: 'AA==', enc: 'rle' },
        { blocks: 'AA==', dims: [0, 128, 256] },
    ]) {
        const bad = { version: 4, player: {}, dims: [256, 128, 256], ...extra };
        assert.equal(typeof importSlotJson(JSON.stringify(bad), 0), 'string');
        assert.equal(exportSlotJson(0), original);
        assert.equal(localStorage.getItem('mcweb.save.index'), index);
    }
    assert.equal(loadGame(0), true);
});

test('落盘失败拒绝进入关卡与编辑器且保留当前世界', async () => {
    freshWorld(); state.levelRun = null; state.levelEdit = null;
    setB(20, 12, 20, BlockTypes.DIAMOND_ORE);
    const blocks = state.blocks;
    const realSet = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
        assert.equal(await enterLevel({ format: 'mcweb.level.v1' }), null);
        assert.equal(await enterLevelEditor(), false);
        assert.equal(state.blocks, blocks);
        assert.equal(at(20, 12, 20), BlockTypes.DIAMOND_ORE);
        assert.equal(state.levelRun, null);
        assert.equal(state.levelEdit, null);
    } finally { localStorage.setItem = realSet; }
});

test('编辑世界热重载不序列化方块、不覆盖启动恢复的原世界', () => {
    freshWorld(); state.levelEdit = {}; state.levelRun = null;
    try {
        assert.equal(saveSnapshotForReload(), true);
        const snap = JSON.parse(sessionStorage.getItem('mcAssistant.snapshot'));
        assert.equal(snap.blocks, undefined);
        state.levelEdit = null;
        setB(20, 12, 20, BlockTypes.STONE);
        assert.equal(restoreSnapshotIfAny(), false);
        assert.equal(at(20, 12, 20), BlockTypes.STONE);
    } finally { state.levelEdit = null; }
});
