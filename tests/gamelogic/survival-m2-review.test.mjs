import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, state, setB, at, pump } from './kit.mjs';
import {
    BlockTypes as B, LifeBlocks as L, LifeItems as I, LIFE, GameModes,
    ToolTypes, HotbarBlocks, PLAYER_EYE_HEIGHT, MAX_PASSIVE_MOBS,
    DUST_ITEM_ID, LEVER_ITEM_ID, LAMP_ITEM_ID, PISTON_ITEM_ID, isLampLitId,
} from '../../js/config.js';
import { addInventoryStack, toolWears } from '../../js/inventoryStacks.js';
import { depositToContainer, flushLifeDrops, harvestPlant, tickHomestead, useFarmItem, growTreeAt } from '../../js/homestead.js';
import { captureLifeState, lifeData } from '../../js/lifeData.js';
import { updateItemDrops } from '../../js/items.js';
import { spawnMob, damageEnemy, updateEnemies } from '../../js/entities.js';
import { breakBlockAt, raycastBlocks, placeBlock } from '../../js/interaction.js';
import { getBlockIndex } from '../../js/world.js';
import { saveGame, loadGame, exportSlotJson, importSlotJson } from '../../js/saveGame.js';
import { setState } from '../../js/uiModal.js';
import { setSurvivalRules } from '../../js/survivalRules.js';
import { enqueueBuildOps, updateBuild, clearBuildQueue, setBuildSpeedIdx, getBuildStatus } from '../../js/buildQueue.js';
import { placeRedstone, toggleLeverAt } from '../../js/redstone.js';
import { placePiston } from '../../js/piston.js';
import { explode } from '../../js/tnt.js';

function setup() {
    clearBuildQueue();
    freshWorld({ gameMode: GameModes.SURVIVAL });
    Object.assign(state, {
        levelRun: null, levelEdit: null, inputMode: 'keyboard', camMode: 'player',
        viewMode: 0, windowUnfocused: false, helpDocOpen: false,
        questionBankOpen: false, prefabPickerOpen: false, authorPanelOpen: false,
        recordingControlsOpen: false, levelExportOpen: false, buildPaused: false,
    });
    setState('playing');
}
const give = (id, count = 1, wear = 0) => addInventoryStack({ id, count, wear });
const refunded = id => captureLifeState().drops.filter(d => d.stack.id === id).reduce((n, d) => n + d.stack.count, 0);
function crop(x = 20, y = 9, z = 20, id = L.WHEAT_MATURE) {
    setB(x, y - 1, z, id === L.SAPLING ? B.DIRT : L.FARMLAND);
    setB(x, y, z, id);
}

test('M2 审查：创造模式拾回拆箱物资，保留两把工具磨损', () => {
    setup();
    setB(20, 9, 20, L.CHEST);
    give(ToolTypes.WOOD_PICKAXE, 1, 17);
    give(ToolTypes.WOOD_PICKAXE, 1, 41);
    give(B.PLANKS, 70);
    depositToContainer(20, 9, 20, ToolTypes.WOOD_PICKAXE);
    depositToContainer(20, 9, 20, ToolTypes.WOOD_PICKAXE);
    depositToContainer(20, 9, 20, B.PLANKS, 64);
    depositToContainer(20, 9, 20, B.PLANKS, 64);
    setB(20, 9, 20, B.AIR);
    flushLifeDrops();
    state.gameMode = GameModes.CREATIVE;
    for (const d of [...state.itemDrops]) {
        Object.assign(state.player, { x: d.x, y: d.y - .9, z: d.z });
        d.age = d.pickupDelay;
        updateItemDrops(.01);
    }
    assert.equal(state.itemDrops.length, 0);
    assert.equal(state.player.inventory[B.PLANKS], 70);
    assert.deepEqual(toolWears(ToolTypes.WOOD_PICKAXE).sort((a, b) => a - b), [17, 41]);
    assert.ok(saveGame());
    assert.ok(loadGame());
    assert.deepEqual(toolWears(ToolTypes.WOOD_PICKAXE).sort((a, b) => a - b), [17, 41]);
});

test('M2 审查：创造模式背包满时，拆箱持久掉落留在世界', () => {
    setup();
    setB(20, 9, 20, L.CHEST);
    give(B.PLANKS, 64);
    depositToContainer(20, 9, 20, B.PLANKS);
    setB(20, 9, 20, B.AIR);
    flushLifeDrops();
    give(B.PLANKS, LIFE.maxInventory);
    state.gameMode = GameModes.CREATIVE;
    const d = state.itemDrops[0];
    Object.assign(state.player, { x: d.x, y: d.y - .9, z: d.z });
    updateItemDrops(10000);
    assert.equal(state.itemDrops.length, 1);
    assert.equal(state.itemDrops[0].count, 64);
    assert.equal(state.player.inventory[B.PLANKS], LIFE.maxInventory);
});

test('M2 审查：连续击退不穿围栏或关门，开门允许通过', () => {
    for (const barrier of [L.FENCE, L.GATE]) {
        setup();
        for (let x = 19; x <= 21; x++) setB(x, 9, 22, barrier);
        const e = spawnMob('sheep', 20.5, 9, 23.36);
        e.owned = true;
        Object.assign(state.player, { x: 20.5, y: 9, z: 25.5 });
        for (let i = 0; i < 20; i++) damageEnemy(e, .01);
        assert.ok(e.z >= 23.35, '羊完整脚印仍在围栏外');
        setB(20, 9, 22, L.GATE_OPEN);
        for (let i = 0; i < 4; i++) damageEnemy(e, .01);
        assert.ok(e.z < 22, '开门后击退可经过通道');
    }
});

test('M2 审查：挖支撑即时清除成熟麦与树苗，重复清理不重复退款', () => {
    setup();
    crop();
    crop(22, 9, 20, L.SAPLING);
    breakBlockAt({ x: 20, y: 8, z: 20, block: L.FARMLAND });
    breakBlockAt({ x: 22, y: 8, z: 20, block: B.DIRT });
    for (let i = 0; i < 10; i++) {
        setB(20, 8, 20, B.AIR);
        setB(22, 8, 20, B.AIR);
        tickHomestead(.25);
    }
    assert.equal(at(20, 9, 20), B.AIR);
    assert.equal(at(22, 9, 20), B.AIR);
    assert.deepEqual(lifeData().plants, {});
    assert.equal(refunded(I.WHEAT), 1);
    assert.equal(refunded(I.SEEDS), 2);
    assert.equal(refunded(L.SAPLING), 1);
    assert.ok(saveGame());
    assert.ok(loadGame());
    assert.equal(refunded(I.WHEAT), 1);
    assert.equal(refunded(I.SEEDS), 2);
    assert.equal(refunded(L.SAPLING), 1);
});

test('M2 审查：爆炸或活塞移走支撑不会留下悬空植物', () => {
    setup();
    crop();
    explode(20, 8, 20);
    assert.equal(at(20, 9, 20), B.AIR);
    assert.equal(refunded(I.WHEAT), 1);
    assert.equal(refunded(I.SEEDS), 2);
    setup();
    crop(21, 10, 20);
    assert.equal(placePiston(20, 9, 20, PISTON_ITEM_ID, { dx: 1, dy: 0, dz: 0 }), null);
    placeRedstone(19, 9, 20, LEVER_ITEM_ID, { dx: 0, dy: 1, dz: 0 });
    toggleLeverAt(19, 9, 20);
    pump(.05, 6);
    assert.equal(at(22, 9, 20), L.FARMLAND);
    assert.equal(at(21, 10, 20), B.AIR);
    assert.equal(refunded(I.WHEAT), 1);
    assert.equal(refunded(I.SEEDS), 2);
});

test('M2 审查：成长入口再次核对支撑，坏旧世界不长悬空植物', () => {
    setup();
    crop(20, 9, 20, L.SAPLING);
    crop(22, 9, 20, L.WHEAT);
    state.blocks[getBlockIndex(20, 8, 20)] = B.AIR;
    state.blocks[getBlockIndex(22, 8, 20)] = B.AIR;
    assert.equal(growTreeAt(20, 9, 20), false);
    tickHomestead(.25);
    tickHomestead(.25);
    assert.equal(at(20, 9, 20), B.AIR);
    assert.equal(at(22, 9, 20), B.AIR);
    assert.equal(refunded(L.SAPLING), 1);
    assert.equal(refunded(I.SEEDS), 1);
});

test('M2 审查：编辑器删除植物和拆支撑无奖励，闯关不能收获', () => {
    setup();
    state.levelEdit = {};
    crop();
    crop(22, 9, 20, L.SAPLING);
    breakBlockAt({ x: 20, y: 9, z: 20, block: L.WHEAT_MATURE });
    harvestPlant(22, 9, 20);
    assert.equal(at(20, 9, 20), B.AIR);
    assert.equal(at(22, 9, 20), B.AIR);
    crop();
    setB(20, 8, 20, B.AIR);
    assert.equal(at(20, 9, 20), B.AIR);
    assert.deepEqual(state.player.inventory, {});
    assert.equal(state.lifePendingDrops.length, 0);
    state.levelEdit = null;
    state.levelRun = {};
    crop();
    assert.match(harvestPlant(20, 9, 20), /闯关/);
    breakBlockAt({ x: 20, y: 9, z: 20, block: L.WHEAT_MATURE });
    assert.equal(at(20, 9, 20), L.WHEAT_MATURE);
    assert.deepEqual(state.player.inventory, {});
});

test('M2 审查：围栏与关门上半格可选中开门，墙体仍遮挡', () => {
    setup();
    Object.assign(state.player, { x: 20.5, y: 9, z: 24.5, yaw: 0,
        pitch: Math.atan2(10.25 - (9 + PLAYER_EYE_HEIGHT), 2) });
    for (const barrier of [L.FENCE, L.GATE]) {
        setB(20, 9, 22, barrier);
        const hit = raycastBlocks();
        assert.deepEqual([hit?.x, hit?.y, hit?.z, hit?.block], [20, 9, 22, barrier]);
        assert.deepEqual(hit.face, { dx: 0, dy: 0, dz: 1 });
    }
    placeBlock();
    assert.equal(at(20, 9, 22), L.GATE_OPEN);
    setB(20, 9, 22, L.GATE);
    setB(20, 10, 23, B.STONE);
    assert.equal(raycastBlocks().block, B.STONE);
});

test('M2 审查：坏工具当前/备用磨损与数量导入不能覆盖好档', () => {
    setup();
    const id = ToolTypes.WOOD_PICKAXE;
    give(id, 1, 17);
    give(id, 1, 41);
    assert.ok(saveGame());
    const before = exportSlotJson();
    const invalid = [
        p => { p.toolWear[id] = -100; },
        p => { p.toolWear[id] = 59; },
        p => { p.toolWear[id] = 1.5; },
        p => { p.toolReserveWear[id] = [-1]; },
        p => { p.toolReserveWear[id] = [59]; },
        p => { p.toolReserveWear[id] = [1, 2]; },
        p => { p.toolReserveWear[id] = {}; },
        p => { p.inventory[id] = 0; },
        p => { p.inventory[id] = 1.5; },
        p => { p.inventory[id] = LIFE.maxToolCount + 1; },
    ];
    for (const mutate of invalid) {
        const bad = JSON.parse(before);
        mutate(bad.player);
        assert.match(importSlotJson(JSON.stringify(bad)), /工具/);
        assert.equal(exportSlotJson(), before);
        assert.deepEqual(toolWears(id), [41, 17]);
    }
    const old = JSON.parse(before);
    delete old.life;
    old.player.toolWear[id] = -100;
    assert.match(importSlotJson(JSON.stringify(old)), /工具/);
    assert.equal(exportSlotJson(), before);
});

test('M2 审查：家畜上限与野生数量独立，认领十只后仍补野生羊', () => {
    setup();
    state.time = state.dayLength * .25;
    Object.assign(state.player, { x: 64.5, y: 9, z: 64.5 });
    setB(32, 8, 64, B.GRASS);
    for (let i = 0; i < MAX_PASSIVE_MOBS; i++) {
        const e = spawnMob('sheep', 60.5, 9, 60.5);
        e.owned = true;
        e.animalId = i + 1;
    }
    // 固定候选点和群大小，只控制随机输入，真实刷新逻辑仍完整运行。
    const originalRandom = Math.random;
    Math.random = () => .5;
    try {
        updateEnemies(.05);
        assert.equal(state.enemies.filter(e => e.owned).length, MAX_PASSIVE_MOBS);
        assert.equal(state.enemies.filter(e => !e.owned).length, 2);
        for (let i = 0; i < 10; i++) updateEnemies(.05);
        assert.equal(state.enemies.filter(e => !e.owned).length, MAX_PASSIVE_MOBS);
    } finally { Math.random = originalRandom; }
});

test('M2 审查：取消部分施工保留已应用动作并结算红石，剩余不写入', async () => {
    for (const cancel of [() => setSurvivalRules('standard'), () => {
        state.survivalRules = 'standard'; updateBuild(.05);
    }]) {
        setup();
        placeRedstone(20, 9, 20, LEVER_ITEM_ID, { dx: 0, dy: 1, dz: 0 });
        placeRedstone(21, 9, 20, DUST_ITEM_ID, { dx: 0, dy: 1, dz: 0 });
        placeRedstone(22, 9, 20, LAMP_ITEM_ID, { dx: 0, dy: 1, dz: 0 });
        toggleLeverAt(20, 9, 20);
        assert.ok(isLampLitId(at(22, 9, 20)));
        setSurvivalRules('experiment');
        setBuildSpeedIdx(0);
        const job = enqueueBuildOps('部分拆除', [[20, 9, 20, B.AIR], [30, 9, 20, B.STONE]]);
        updateBuild(.05);
        assert.equal(at(20, 9, 20), B.AIR);
        assert.equal(getBuildStatus().active, true);
        cancel();
        assert.equal(isLampLitId(at(22, 9, 20)), false);
        const result = await job;
        assert.equal(result.applied, 1);
        assert.match(result.skipped.join(' '), /已应用部分保留/);
        pump(.05, 3);
        assert.equal(at(30, 9, 20), B.AIR);
        assert.equal(getBuildStatus().active, false);
    }
});

test('M2 审查：取水和放水自动切换手中桶及原常用栏位置', () => {
    setup();
    give(I.BUCKET);
    state.player.quickbar = [B.WOOD, I.BUCKET, B.PLANKS, 0, 0, 0, 0, 0, 0];
    state.player.selectedSlot = HotbarBlocks.indexOf(I.BUCKET);
    setB(20, 9, 20, B.WATER);
    useFarmItem(I.BUCKET, { x: 20, y: 9, z: 20, block: B.WATER });
    assert.equal(HotbarBlocks[state.player.selectedSlot], I.WATER_BUCKET);
    assert.equal(state.player.quickbar[1], I.WATER_BUCKET);
    assert.equal(state.player.inventory[I.BUCKET], 0);
    assert.equal(state.player.inventory[I.WATER_BUCKET], 1);
    useFarmItem(I.WATER_BUCKET, { x: 21, y: 8, z: 20, block: B.STONE, face: { dx: 0, dy: 1, dz: 0 } });
    assert.equal(HotbarBlocks[state.player.selectedSlot], I.BUCKET);
    assert.equal(state.player.quickbar[1], I.BUCKET);
    assert.equal(state.player.inventory[I.WATER_BUCKET], 0);
    assert.equal(state.player.inventory[I.BUCKET], 1);
    assert.equal(at(21, 9, 20), B.WATER);
});

test('M2 审查：真实区块道具构建包含农作物与围栏，清除后无幽灵模型', async () => {
    setup();
    // 带查询串仅绕开无头加载器的 chunk 整体桩，真实渲染装配逻辑原样执行。
    // Three 和 Canvas 仍用测试替身，不声称验证 GPU 像素。
    const { tileMap } = await import('../../js/textures.js');
    tileMap.piston = { x: 0, y: 0 };
    const { buildChunkProps, disposeChunkProps } = await import('../../js/chunk.js?life-render-regression');
    const ids = [L.WHEAT, L.WHEAT + 1, L.WHEAT + 2, L.WHEAT_MATURE, L.SAPLING, L.FENCE, L.GATE, L.GATE_OPEN];
    ids.forEach((id, i) => {
        if (id <= L.WHEAT_MATURE) setB(20 + i, 8, 20, L.FARMLAND);
        else if (id === L.SAPLING) setB(20 + i, 8, 20, B.DIRT);
        setB(20 + i, 9, 20, id);
    });
    buildChunkProps(1, 1);
    assert.equal(state.droppedItems.length, ids.length);
    assert.ok(state.droppedItems.every(d => d.mesh.children.length > 0));
    ids.forEach((_, i) => setB(20 + i, 9, 20, B.AIR));
    disposeChunkProps(1, 1);
    buildChunkProps(1, 1);
    assert.equal(state.droppedItems.length, 0);
});
