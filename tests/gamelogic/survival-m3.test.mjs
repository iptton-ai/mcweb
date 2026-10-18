import { describeItem } from '../../js/itemInfo.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { freshWorld, setB, at, state, pump } from './kit.mjs';
import * as C from '../../js/config.js';
import { generateWorld, getBlock } from '../../js/world.js';
import {
    resetAdventureData,
    adventureData,
    captureAdventureState,
    restoreAdventureState,
} from '../../js/adventureData.js';
import {
    tickAdventure,
    toggleEquipment,
    repairTool,
    repairCost,
    addMapMarker,
    chooseProject,
    projectProgress,
} from '../../js/adventure.js';
import { updatePlayerPhysics } from '../../js/playerPhysics.js';
import { keys, clearKeys } from '../../js/input.js';
import { damagePlayer } from '../../js/playerLife.js';
import { setState, setAssistantVisible, setRecordingControlsOpen, isKeyboardPlayActive } from '../../js/uiModal.js';
import { addInventoryStack, toolWears } from '../../js/inventoryStacks.js';
import { containerAt, harvestPlant, flushLifeDrops } from '../../js/homestead.js';
import { placeKinetic, updateKineticNetwork, kineticStatusAt } from '../../js/kinetic.js';
import { spawnItemDrop, updateItemDrops } from '../../js/items.js';
import { saveGame, loadGame } from '../../js/saveGame.js';
import { saveSnapshotForReload, restoreSnapshotIfAny } from '../../js/assistant/snapshot.js';
import { enterLevelEditor, exitLevelEditor } from '../../js/levelEditor.js';
const B = C.BlockTypes,
    I = C.AdventureItems,
    FX = { dx: 1, dy: 0, dz: 0 },
    UP = { dx: 0, dy: 1, dz: 0 },
    DOWN = { dx: 0, dy: -1, dz: 0 };
function setup() {
    freshWorld({ gameMode: C.GameModes.SURVIVAL });
    resetAdventureData();
    clearKeys();
    state.levelRun = null;
    state.levelEdit = null;
    state.temporaryWorldTransition = null;
    state.camMode = 'player';
    state.inputMode = 'keyboard';
    state.helpDocOpen = false;
    state.questionBankOpen = false;
    state.authorPanelOpen = false;
    state.prefabPickerOpen = false;
    state.levelExportOpen = false;
    state.recordingControlsOpen = false;
    state.windowUnfocused = false;
    state.player.invulnTimer = 0;
    state.player.xp = 0;
    state.player.hunger = 20;
    state.player.air = 10;
    setState('playing');
}
function walk(x, z, { jump = true, limit = 25 } = {}) {
    const p = state.player;
    keys.KeyW = true;
    keys.Space = jump;
    let ticks = 0;
    while (Math.hypot(x - p.x, z - p.z) > 0.24 && ticks++ < limit * 60) {
        p.yaw = Math.atan2(-(x - p.x), -(z - p.z));
        updatePlayerPhysics(1 / 60);
        tickAdventure();
        p.invulnTimer = 0;
    }
    clearKeys();
    for (let i = 0; i < 20; i++) updatePlayerPhysics(1 / 60);
    assert.ok(Math.hypot(x - p.x, z - p.z) < 0.6, `cannot walk to ${x},${z} from ${p.x},${p.y},${p.z}`);
    assert.ok(!p.dead, 'route must not kill player');
}
function road(tx, tz) {
    const p = state.player,
        sx = p.x,
        sz = p.z,
        n = Math.ceil(Math.hypot(tx - sx, tz - sz) / 5);
    for (let i = 1; i <= n; i++) walk(sx + ((tx - sx) * i) / n, sz + ((tz - sz) * i) / n);
}
function line() {
    setB(30, 11, 30, B.WATER);
    assert.equal(placeKinetic(30, 10, 30, C.WATERWHEEL_ITEM_ID, FX), null);
    assert.equal(placeKinetic(31, 10, 30, C.SHAFT_ITEM_ID, FX), null);
    assert.equal(placeKinetic(32, 10, 30, C.SAW_ITEM_ID, FX), null);
    for (let x = 32; x <= 35; x++) {
        state.player.yaw = -Math.PI / 2;
        assert.equal(placeKinetic(x, 9, 30, C.BELT_ITEM_ID, UP), null);
    }
    setB(36, 9, 30, C.LifeBlocks.CHEST);
    updateKineticNetwork();
    return containerAt(36, 9, 30);
}
const chestCount = (c) => c.slots.reduce((n, s) => n + (s?.count || 0), 0);
test('M3 v1/v2 eight full-world SHA256 remain byte-identical', () => {
    setup();
    const baseline = JSON.parse(
        readFileSync(
            new URL('../../docs/life-m23-evidence/2026-10-18/baseline-terrain.json', import.meta.url),
        ),
    );
    for (const b of baseline) {
        state.generationVersion = b.version;
        state.worldSeed = b.seed;
        generateWorld();
        assert.equal(
            createHash('sha256').update(state.blocks).digest('hex'),
            b.sha256,
            `v${b.version} seed${b.seed}`,
        );
        assert.deepEqual(adventureData().sites, []);
    }
});
for (const seed of [1, 42, 2026, 1287621887])
    test(`M3 v3 seed ${seed}: real walking/jumping mine roundtrip, tower climb and camp`, () => {
        setup();
        state.generationVersion = 3;
        state.worldSeed = seed;
        generateWorld();
        const a = adventureData(),
            p = state.player,
            homeY = (() => {
                for (let y = 100; y > 0; y--) if (C.BlockInfo[getBlock(128, y, 128)]?.solid) return y + 1.001;
            })();
        Object.assign(p, { x: 128.5, y: homeY, z: 128.5, vx: 0, vy: 0, vz: 0, onGround: true, health: 20 });
        const mine = a.sites.find((s) => s.id === 'mine'),
            CaveFloor = mine.y - 1,
            depth = Math.max(6, CaveFloor - 27),
            len = depth * 3 + 3;
        road(128.5, 80.5);
        const way = [];
        for (let i = 3; i <= len; i += 3)
            way.push({ x: 128.5 + Math.max(0, i - 24), z: 80.5 - Math.min(24, i) });
        for (const w of way) walk(w.x, w.z);
        for (const w of [...way].reverse()) walk(w.x, w.z);
        walk(128.5, 80.5);
        road(128.5, 128.5);
        road(176.5, 128.5);
        walk(176.5, 125.5, { jump: false });
        keys.Space = true;
        for (let i = 0; i < 240; i++) updatePlayerPhysics(1 / 60);
        clearKeys();
        const T = a.sites.find((s) => s.id === 'tower').y - 1;
        assert.ok(p.y >= T + 8, `ladder reaches platform: ${p.y}/${T + 8}`);
        walk(176.5, 127.5, { jump: false });
        assert.ok(p.y >= T + 8, 'walk off top onto platform');
        walk(176.5, 125.5, { jump: false });
        keys.ShiftLeft = true;
        for (let i = 0; i < 200; i++) updatePlayerPhysics(1 / 60);
        clearKeys();
        walk(176.5, 128.5, { jump: false });
        road(128.5, 128.5);
        road(80.5, 128.5);
        road(128.5, 128.5);
        assert.deepEqual([...a.discovered].sort(), ['camp', 'mine', 'tower']);
        assert.equal(p.inventory[I.SOUVENIR], 3);
        const xp = p.xp;
        tickAdventure();
        assert.equal(p.xp, xp);
        assert.ok(p.health > 0);
    });
test('M3 ladder placement support removal refunds once and no dangling climb', () => {
    setup();
    setB(20, 9, 19, B.STONE);
    setB(20, 9, 20, C.LADDER_BASE);
    setB(20, 9, 19, B.AIR);
    assert.equal(at(20, 9, 20), 0);
    assert.equal(state.lifePendingDrops.filter((d) => d.stack.id === 252).length, 1);
    setB(20, 9, 19, B.AIR);
    assert.equal(state.lifePendingDrops.filter((d) => d.stack.id === 252).length, 1);
    flushLifeDrops();
    flushLifeDrops();
    assert.equal(state.itemDrops.filter((d) => d.itemId === C.LADDER_BASE).length, 1);
});
test('M3 closing the assistant also releases hidden recording controls for keyboard play', () => {
    setup();
    setAssistantVisible(true);
    setRecordingControlsOpen(true);
    assert.equal(isKeyboardPlayActive(), false);
    setAssistantVisible(false);
    assert.equal(state.recordingControlsOpen, false);
    assert.equal(isKeyboardPlayActive(), true);
});
test('M3 armor and facing shield protect explicit combat only, consume wear and break', () => {
    setup();
    const p = state.player;
    addInventoryStack({ id: I.ARMOR, count: 1 });
    addInventoryStack({ id: I.SHIELD, count: 1 });
    toggleEquipment(I.ARMOR);
    toggleEquipment(I.SHIELD);
    p.yaw = 0;
    p.shieldRaised = false;
    damagePlayer(0, 'explosion', { x: p.x, z: p.z - 2 });
    assert.equal(p.health, 20);
    assert.equal(p.toolWear[I.ARMOR] || 0, 0);
    damagePlayer(2, 'melee', { x: p.x, z: p.z - 2 });
    assert.equal(p.health, 19, 'iron visibly reduces small zombie hits');
    p.health = 20;
    p.invulnTimer = 0;
    p.shieldRaised = true;
    damagePlayer(10, 'melee', { x: p.x, z: p.z - 2 });
    assert.equal(p.health, 18);
    assert.ok(p.toolWear[I.SHIELD] > 0);
    p.invulnTimer = 0;
    p.health = 20;
    damagePlayer(10, 'melee', { x: p.x, z: p.z + 2 });
    assert.equal(p.health, 14, 'rear attack bypasses shield');
    for (const source of ['fall', 'hunger', 'drowning']) {
        p.invulnTimer = 0;
        p.health = 20;
        damagePlayer(5, source);
        assert.equal(p.health, 15, source);
    }
    p.toolWear[I.SHIELD] = 119;
    p.invulnTimer = 0;
    damagePlayer(5, 'explosion', { x: p.x, z: p.z - 1 });
    assert.equal(p.inventory[I.SHIELD], 0);
});
test('M3 shield requires held key and clears on panel; old level-run combat bypasses gear', () => {
    setup();
    addInventoryStack({ id: I.SHIELD, count: 1 });
    toggleEquipment(I.SHIELD);
    keys.KeyO = true;
    updatePlayerPhysics(1 / 60);
    assert.equal(state.player.shieldRaised, true);
    setState('adventure');
    updatePlayerPhysics(1 / 60);
    assert.equal(state.player.shieldRaised, false);
    state.levelRun = {};
    state.player.shieldRaised = true;
    state.player.health = 20;
    damagePlayer(8, 'melee', { x: 3.5, z: 2 });
    assert.equal(state.player.health, 12);
    state.levelRun = null;
});
test('M3 four-tier repair costs, no-charge failures, active only and reserve wear preserved', () => {
    setup();
    setB(4, 9, 3, B.CRAFTING_TABLE);
    const p = state.player;
    p.xp = 100;
    for (const [id, material] of [
        [C.ToolTypes.WOOD_PICKAXE, B.PLANKS],
        [C.ToolTypes.STONE_PICKAXE, B.COBBLESTONE],
        [C.ToolTypes.PICKAXE, C.ItemTypes.IRON_INGOT],
        [C.ToolTypes.DIAMOND_PICKAXE, C.ItemTypes.DIAMOND],
        [C.LifeItems.HOE, B.PLANKS],
        [C.LifeItems.SHEARS, C.ItemTypes.IRON_INGOT],
    ]) {
        assert.equal(repairCost(id).material, material);
        addInventoryStack({ id, count: 1, wear: 20 });
        addInventoryStack({ id, count: 1, wear: 10 });
        p.inventory[material] = 1;
        const xp = p.xp;
        assert.match(repairTool(id), /修好了/);
        assert.equal(p.xp, xp - 3);
        assert.equal(p.inventory[material], 0);
        assert.equal(p.toolReserveWear[id][0], 10);
    }
    const id = C.ToolTypes.AXE;
    addInventoryStack({ id, count: 1 });
    const xp = p.xp;
    assert.match(repairTool(id), /满/);
    assert.equal(p.xp, xp);
    p.toolWear[id] = 30;
    p.xp = 0;
    assert.match(repairTool(id), /经验/);
    assert.equal(p.toolWear[id], 30);
    p.xp = 20;
    p.x = 100;
    assert.match(repairTool(id), /工作台/);
    assert.equal(p.xp, 20);
});
for (const hz of [30, 60, 120])
    test(`M3 saw→belt→chest ${hz}Hz: 20 logs→80 planks outside pickup, no loss on full/off`, () => {
        setup();
        const c = line();
        const p = state.player;
        p.x = 3;
        p.y = 9;
        p.z = 3;
        assert.match(kineticStatusAt(32, 10, 30), /8 RPM/);
        for (let i = 0; i < 20; i++) {
            setB(33, 10, 30, B.WOOD);
            pump(1 / hz, Math.ceil(hz * 0.8));
        }
        pump(1 / hz, hz * 8);
        assert.equal(chestCount(c), 80);
        assert.equal(state.itemDrops.length, 0);
        assert.equal(p.inventory[B.PLANKS] || 0, 0);
        assert.equal(adventureData().delivered, 80);
        c.slots = Array.from({ length: 27 }, () => ({ id: B.DIRT, count: 64 }));
        setB(33, 10, 30, B.WOOD);
        pump(1 / hz, hz * 8);
        assert.equal(
            state.itemDrops.reduce((n, d) => n + d.count, 0),
            4,
        );
        const d = state.itemDrops[0];
        d.age = 10000;
        p.x = d.x;
        p.z = d.z;
        p.y = d.y - 0.9;
        pump(1 / hz, hz);
        assert.equal(state.itemDrops[0].count, 4, 'running belt wins over close pickup');
        p.x = 3;
        p.z = 3;
        setB(30, 11, 30, 0);
        updateKineticNetwork();
        pump(1 / hz, hz);
        assert.equal(state.itemDrops[0].count, 4, 'stopped belt does not expire');
        c.slots[0] = null;
        setB(30, 11, 30, B.WATER);
        updateKineticNetwork();
        pump(1 / hz, hz * 2);
        assert.equal(state.itemDrops.length, 0);
        assert.equal(c.slots[0].count, 4);
    });
test('M3 reversed belt never reports delivery and partial chest capacity preserves remainder', () => {
    setup();
    const c = line();
    c.slots = Array.from({ length: 27 }, () => ({ id: B.PLANKS, count: 64 }));
    c.slots[0].count = 62;
    spawnItemDrop(35.95, 9.15, 30.5, B.PLANKS, 4, { noScatter: true });
    pump(0.05, 3);
    assert.equal(c.slots[0].count, 64);
    assert.equal(state.itemDrops[0].count, 2);
    assert.equal(adventureData().delivered, 2);
    setB(35, 9, 30, C.beltId(3));
    updateKineticNetwork();
    const x = state.itemDrops[0].x;
    pump(0.05, 10);
    assert.ok(state.itemDrops[0].x < x);
    assert.equal(adventureData().delivered, 2);
});
test('M3 exploration/markers/equipment/projects survive save, snapshot and temporary editor isolation', async () => {
    setup();
    state.saveSlot = 5;
    addMapMarker('我家附近');
    chooseProject('farm');
    adventureData().projects.farm.explanation = '从播种到做面包';
    adventureData().delivered = 24;
    adventureData().discovered = ['mine'];
    addInventoryStack({ id: I.ARMOR, count: 1, wear: 11 });
    toggleEquipment(I.ARMOR);
    const before = captureAdventureState();
    assert.equal(saveGame(), true);
    resetAdventureData();
    assert.equal(loadGame(5), true);
    assert.deepEqual(captureAdventureState(), before);
    assert.equal(saveSnapshotForReload(), true);
    resetAdventureData();
    assert.equal(restoreSnapshotIfAny(), true);
    assert.deepEqual(captureAdventureState(), before);
    await enterLevelEditor();
    assert.equal(state.adventure.markers.length, 0);
    assert.equal(state.adventure.project, null);
    await exitLevelEditor({ saveDraft: false, toTitle: true });
    assert.deepEqual(captureAdventureState(), before);
});
test('M3 farm goal only counts mature harvest and chosen sites; project names kept when switching', () => {
    setup();
    chooseProject('farm');
    const a = adventureData();
    a.projects.farm.name = '我的麦田';
    setB(4, 8, 4, C.LifeBlocks.FARMLAND);
    setB(4, 9, 4, C.LifeBlocks.WHEAT);
    harvestPlant(4, 9, 4);
    assert.equal(a.harvests, 0);
    setB(4, 9, 4, C.LifeBlocks.WHEAT_MATURE);
    harvestPlant(4, 9, 4);
    assert.equal(a.harvests, 1);
    chooseProject('lighthouse');
    chooseProject('farm');
    assert.equal(a.projects.farm.name, '我的麦田');
    assert.equal(projectProgress().find((g) => g.label.includes('收获')).value, 1);
});
test('M3 lift goal requires real powered movement in its project region', () => {
    setup();
    Object.assign(state.player, { x: 28.5, y: 9, z: 30.5 });
    chooseProject('lift');
    state.player.x = 3;
    setB(28, 18, 30, B.WATER);
    placeKinetic(28, 17, 30, C.WATERWHEEL_ITEM_ID, UP);
    for (const y of [15, 16]) placeKinetic(28, y, 30, C.SHAFT_ITEM_ID, UP);
    placeKinetic(28, 14, 30, C.PULLEY_ITEM_ID, DOWN);
    placeKinetic(28, 12, 30, C.PLATFORM_ITEM_ID, UP);
    assert.equal(adventureData().projects.lift.liftMoves || 0, 0);
    pump(0.05, 180);
    assert.ok(adventureData().projects.lift.liftMoves >= 3);
    assert.equal(projectProgress().find((g) => g.label.includes('真实移动')).done, true);
});
test('M3 persisted exploration fields are bounded and reject out-of-world markers', () => {
    setup();
    restoreAdventureState({
        markers: [
            { id: 'mark-1', x: -1, y: 9, z: 1 },
            { id: 'mark-2', x: 2, y: 9, z: 2, name: 'x'.repeat(100) },
        ],
        discovered: ['mine', 'mine', 'bad'],
        delivered: Infinity,
        armor: 'true',
    });
    assert.equal(adventureData().markers.length, 1);
    assert.equal(adventureData().markers[0].name.length, 24);
    assert.deepEqual(adventureData().discovered, ['mine']);
    assert.equal(adventureData().delivered, 0);
    assert.equal(adventureData().armor, false);
});

test('M3 装备、梯子及生活工具来源说明不出现未定义攻击数据', () => {
    for (const id of [I.ARMOR, I.SHIELD, C.LifeItems.HOE, C.LifeItems.SHEARS, C.LADDER_BASE]) {
        assert.doesNotMatch(describeItem(id).join(' '), /undefined|NaN/);
    }
    assert.match(describeItem(I.SHIELD).join(' '), /按住 O/);
});
