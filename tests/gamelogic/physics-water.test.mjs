// 水力独立验收：按 docs/physics-rest-plan.md 冻结行为编写，不读取求解器实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry } from 'three';
import { freshWorld, setB, setBlockSafe, at, state } from './kit.mjs';
import * as C from '../../js/config.js';
import { initKinetic, updateKineticNetwork, kineticInfoAt, placeKinetic } from '../../js/kinetic.js';
import { updateRedstoneNetwork, toggleLeverAt } from '../../js/redstone.js';
import { setState } from '../../js/uiModal.js';
import { breakBlockAt, placeBlock } from '../../js/interaction.js';
import {
    initPhysicsLab, tickPhysicsLab, configurePhysicsAt, physicsActionAt,
    physicsInfoAt, physicsBucketAt,
} from '../../js/physicsLab.js';
import {
    capturePhysicsState, validatePhysicsState, restorePhysicsState,
} from '../../js/physicsData.js';
import { saveGame, loadGame, exportSlotJson, importSlotJson } from '../../js/saveGame.js';
import { saveSnapshotForReload, restoreSnapshotIfAny } from '../../js/assistant/snapshot.js';
import {
    buildLevelCard, validateLevelCard, embedLevelToWorld, cardHash, LEVEL_EMBED_OFFSET,
} from '../../js/levelWorkshop.js';

const B = C.BlockTypes;
const WATER_IDS = [176, 177, 178, 179, 189];
const VALVE = 81, PUMP = 82;
const T = (x, y, z, q = 0) => { setBlockSafe(x, y, z, WATER_IDS[q], {physicsWaterTransfer:true}); return [x, y, z]; };
const qAt = p => WATER_IDS.indexOf(at(...p));
const sumWater = cells => cells.reduce((n, p) => n + qAt(p), 0);
const clone = value => structuredClone(value);
const configure = (p, patch) => assert.equal(configurePhysicsAt(...p, patch)?.ok, true);
const action = (p, name) => assert.equal(physicsActionAt(...p, name)?.ok, true);

// 只补渲染桩的 UV 存储；世界、物资与实验逻辑均使用真实模块。
if (!Object.getOwnPropertyDescriptor(BufferGeometry.prototype, 'attributes')) {
    Object.defineProperty(BufferGeometry.prototype, 'attributes', {
        configurable: true,
        get() { return this.__attrs; },
        set(v) {
            if (v && !v.uv) v.uv = new BufferAttribute(new Float32Array(48), 2);
            this.__attrs = v;
        },
    });
}
BufferAttribute.prototype.setXY ||= function (i, x, y) {
    this.array[i * this.itemSize] = x;
    this.array[i * this.itemSize + 1] = y;
    return this;
};

function setup(gameMode = C.GameModes.CREATIVE) {
    state.levelRun = state.levelEdit = null;
    freshWorld({ gameMode });
    restorePhysicsState(undefined);
    initPhysicsLab();
    state.inputMode = 'keyboard';
    state.windowUnfocused = false;
    state.helpDocOpen = state.questionBankOpen = state.authorPanelOpen = false;
    state.prefabPickerOpen = state.levelExportOpen = state.recordingControlsOpen = false;
    state.readingPanels = {};
    state.player.selectedSlot = 0;
    state.saveSlot = 0;
    setState('playing');
}

function step(seconds, hz = 60, check) {
    const frames = Math.round(seconds * hz);
    for (let i = 0; i < frames; i++) {
        tickPhysicsLab(1 / hz);
        state.time += 1 / hz;
        check?.();
    }
}

function wheel(x, y, z) {
    setB(x, y, z, C.waterwheelId(0));
    setB(x, y + 1, z, B.WATER);
}

// 泵向东：后面 X 轴；南侧进水；东侧按 lift 扬程出水。
function pumpScene({ rpm = 8, source = 4, target = 0, lift = 2 } = {}) {
    const p = [60, 12, 60];
    const input = T(60, 12, 61, source);
    const output = T(61, 12 + lift, 60, target);
    setB(...p, PUMP);
    configure(p, { dir: 1, lift });
    setB(59, 12, 60, C.shaftId(0));
    if (rpm === 8) wheel(58, 12, 60);
    else {
        wheel(57, 11, 60);
        setB(58, 11, 60, rpm === 16 ? C.largeCogId(0) : C.cogId(0));
        setB(58, 12, 60, rpm === 16 ? C.cogId(0) : C.largeCogId(0));
    }
    initPhysicsLab();
    updateKineticNetwork();
    return { p, input, output, cells: [input, output] };
}

test('W-F0：五种非连续水量 ID 可选择、回收，材料物品不误认作水槽', () => {
    setup();
    assert.deepEqual(C.TROUGH_IDS, WATER_IDS);
    for (let q = 0; q <= 4; q++) {
        const p = T(20 + q * 2, 12, 20, q);
        assert.equal(C.troughId(q), WATER_IDS[q]);
        assert.equal(C.troughWater(WATER_IDS[q]), q);
        assert.equal(C.BlockInfo[WATER_IDS[q]].drop, WATER_IDS[q]);
        assert.ok(C.HotbarBlocks.includes(WATER_IDS[q]));
        assert.equal(physicsInfoAt(...p)?.water, q);
    }
    for (let id = 180; id <= 188; id++) {
        assert.equal(C.isTroughId(id), false);
        assert.equal(C.isVoxelId(id), false);
    }
    assert.equal(C.RECIPES.some(r => WATER_IDS.slice(1).includes(r.out)), false,
        '湿槽只能保存已有水量，不能由配方凭空做水');
});

for (const hz of [30, 60, 120]) {
    test(`W01：${hz}Hz 分流守恒、槽外密闭、普通静水保持`, () => {
        setup();
        const cells = [T(40, 12, 40, 4), T(39, 12, 40), T(41, 12, 40), T(40, 12, 41)];
        setB(45, 12, 40, B.WATER);
        initPhysicsLab();
        step(4, hz, () => {
            assert.equal(sumWater(cells), 4);
            assert.ok(cells.every(p => Number.isInteger(qAt(p)) && qAt(p) >= 0 && qAt(p) <= 4));
        });
        for (const p of cells.slice(1)) assert.ok(qAt(p) > 0, '每个分支均能收到水');
        assert.equal(at(45, 12, 40), B.WATER);
        assert.equal(at(40, 11, 40), B.AIR, '水不能漏到槽下方空气');
        assert.equal(at(40, 12, 39), B.AIR, '水不能在槽外生出普通水');
    });
}

test('W01：高槽流向相邻低一格槽，满槽和无接收槽时水不消失', () => {
    setup();
    const upper = T(30, 13, 30, 4), lower = T(31, 12, 30, 0);
    initPhysicsLab();
    step(3, 60, () => assert.equal(sumWater([upper, lower]), 4));
    assert.equal(qAt(upper), 0);
    assert.equal(qAt(lower), 4);
    step(3, 60, () => assert.equal(sumWater([upper, lower]), 4));
    assert.equal(at(31, 11, 30), B.AIR);
});

test('W01：手动闸隔绝两端，开闸输水，闭闸保留当前水量', () => {
    setup();
    const left = T(49, 12, 50, 4), right = T(51, 12, 50), valve = [50, 12, 50];
    setB(...valve, VALVE);
    configure(valve, { dir: 1, control: 0, open: 0 });
    initPhysicsLab();
    step(1);
    assert.deepEqual([qAt(left), qAt(right)], [4, 0]);
    action(valve, 'toggle');
    step(1, 60, () => assert.equal(sumWater([left, right]), 4));
    assert.ok(qAt(right) > 0);
    action(valve, 'toggle');
    const stopped = [qAt(left), qAt(right)];
    step(1);
    assert.deepEqual([qAt(left), qAt(right)], stopped);
});

test('W01：红石模式水闸使用真实供能，手动动作不能绕过控制模式', () => {
    setup();
    const left = T(49, 12, 50, 4), right = T(51, 12, 50), valve = [50, 12, 50];
    setB(...valve, VALVE);
    configure(valve, { dir: 1, control: 1, open: 0 });
    setB(50, 11, 51, B.STONE);
    setB(50, 12, 51, C.leverId(0, 0));
    initPhysicsLab();
    updateRedstoneNetwork();
    physicsActionAt(...valve, 'toggle');
    step(1);
    assert.deepEqual([qAt(left), qAt(right)], [4, 0]);
    toggleLeverAt(50, 12, 51);
    step(1, 60, () => assert.equal(sumWater([left, right]), 4));
    assert.ok(qAt(right) > 0);
    toggleLeverAt(50, 12, 51);
    T(...left, 4); T(...right, 0);
    step(1);
    assert.deepEqual([qAt(left), qAt(right)], [4, 0]);
});

test('W01：生存整桶往返与库存守恒，部分满槽和库存不足均拒绝', () => {
    setup(C.GameModes.SURVIVAL);
    const p = T(30, 12, 30), bucket = C.LifeItems.BUCKET, full = C.LifeItems.WATER_BUCKET;
    state.player.inventory = { [bucket]: 2, [full]: 1 };
    const initial = clone(state.player.inventory);
    assert.equal(physicsBucketAt(...p, full)?.ok, true);
    assert.equal(qAt(p), 4);
    assert.equal(state.player.inventory[full], 0);
    assert.equal(state.player.inventory[bucket], 3);
    assert.equal(physicsBucketAt(...p, bucket)?.ok, true);
    assert.equal(qAt(p), 0);
    assert.deepEqual(state.player.inventory, initial);
    for (let q = 1; q < 4; q++) {
        T(...p, q);
        for (const held of [bucket, full]) {
            const inventory = clone(state.player.inventory);
            assert.ok(physicsBucketAt(...p, held)?.error);
            assert.equal(qAt(p), q);
            assert.deepEqual(state.player.inventory, inventory);
        }
    }
    T(...p, 0); state.player.inventory[full] = 0;
    assert.ok(physicsBucketAt(...p, full)?.error);
    assert.equal(qAt(p), 0);
});

test('W01：输出桶库存已满时，注水和取水事务都不能先改槽', () => {
    setup(C.GameModes.SURVIVAL);
    const p = T(30, 12, 30), bucket = C.LifeItems.BUCKET, full = C.LifeItems.WATER_BUCKET;
    state.player.inventory = { [bucket]: C.LIFE.maxInventory, [full]: 1 };
    let before = clone(state.player.inventory);
    assert.ok(physicsBucketAt(...p, full)?.error);
    assert.equal(qAt(p), 0);
    assert.deepEqual(state.player.inventory, before);
    T(...p, 4);
    state.player.inventory = { [bucket]: 1, [full]: C.LIFE.maxInventory };
    before = clone(state.player.inventory);
    assert.ok(physicsBucketAt(...p, bucket)?.error);
    assert.equal(qAt(p), 4);
    assert.deepEqual(state.player.inventory, before);
});

test('W01：挖回部分满槽后从背包重新放置，水量和物品数量不变', () => {
    setup(C.GameModes.SURVIVAL);
    const id = WATER_IDS[2], p = T(20, 9, 18, 2);
    state.player.x = 20.5; state.player.y = 9; state.player.z = 20.5;
    state.player.yaw = 0;
    state.player.pitch = Math.atan2(8.9 - (9 + C.PLAYER_EYE_HEIGHT), 2);
    breakBlockAt({ x: p[0], y: p[1], z: p[2], block: id });
    assert.equal(at(...p), B.AIR);
    assert.equal(state.player.inventory[id], 1);
    state.player.selectedSlot = C.HotbarBlocks.indexOf(id);
    assert.ok(state.player.selectedSlot >= 0);
    placeBlock();
    assert.equal(at(...p), id);
    assert.equal(state.player.inventory[id], 0);
});

for (const hz of [30, 60, 120]) {
    test(`W02：${hz}Hz 真轴驱动水泵搬运已有水，计16SU，断轴悬停后恢复`, () => {
        setup();
        const s = pumpScene();
        assert.equal(kineticInfoAt(...s.p)?.rpm, 8);
        assert.equal(kineticInfoAt(...s.p)?.load, 16);
        step(0.8, hz, () => assert.equal(sumWater(s.cells), 4));
        assert.equal(qAt(s.output), 2);
        setB(59, 12, 60, B.AIR);
        updateKineticNetwork();
        const stopped = [qAt(s.input), qAt(s.output)];
        step(0.8, hz);
        assert.deepEqual([qAt(s.input), qAt(s.output)], stopped);
        setB(59, 12, 60, C.shaftId(0));
        updateKineticNetwork();
        step(0.8, hz, () => assert.equal(sumWater(s.cells), 4));
        assert.equal(qAt(s.output), 4);
    });
}

test('W02：16/8/4RPM改变真实流量和折算SU，泵不获得免费动力', () => {
    const results = [];
    for (const [rpm, units, load] of [[4, 1, 8], [8, 2, 16], [16, 4, 32]]) {
        setup();
        const s = pumpScene({ rpm });
        assert.equal(kineticInfoAt(...s.p)?.rpm, rpm);
        assert.equal(kineticInfoAt(...s.p)?.load, load);
        step(1.05, 60, () => assert.equal(sumWater(s.cells), 4));
        results.push(qAt(s.output));
        assert.equal(qAt(s.output), units);
    }
    assert.deepEqual(results, [1, 2, 4]);
});

test('W02：无水与满槽时泵不造水、不吞水，并有可理解状态', () => {
    for (const [source, target, pattern] of [[0, 0, /无水|缺水|水源|空/], [4, 4, /满|容量/]]) {
        setup();
        const s = pumpScene({ source, target });
        step(2, 60, () => assert.equal(sumWater(s.cells), source + target));
        assert.deepEqual([qAt(s.input), qAt(s.output)], [source, target]);
        assert.match(physicsInfoAt(...s.p)?.status || '', pattern);
    }
});

test('W02：标准浮块轻浮重沉，排水后下降，复位不改变水量或背包', () => {
    setup();
    const p = T(35, 12, 35, 4);
    configure(p, { float: 1, ballast: 0 });
    step(2);
    const lightHeight = physicsInfoAt(...p)?.height;
    assert.ok(Number.isFinite(lightHeight));
    configure(p, { ballast: 4 });
    step(2);
    const heavyHeight = physicsInfoAt(...p)?.height;
    assert.ok(lightHeight > heavyHeight, '重物沉得更低');
    configure(p, { ballast: 0 });
    step(2);
    T(...p, 0);
    step(2);
    assert.ok(physicsInfoAt(...p)?.height < lightHeight, '抽空水后浮块回到底部');
    const inventory = clone(state.player.inventory);
    action(p, 'reset');
    step(0.5);
    assert.equal(qAt(p), 0);
    assert.deepEqual(state.player.inventory, inventory);
    assert.equal(state.itemDrops.length, 0, '虚拟浮块不能兑换掉落物');
});

test('S01：槽q变体改变后浮块配置仍能捕获、验证、恢复，初始化不复位水量', () => {
    setup();
    const p = T(35, 12, 35, 0);
    configure(p, { float: 1, ballast: 2 });
    T(...p, 4);
    const raw = capturePhysicsState();
    assert.equal(validatePhysicsState(raw, state.blocks), null);
    restorePhysicsState(raw);
    initPhysicsLab();
    assert.equal(qAt(p), 4);
    assert.equal(physicsInfoAt(...p)?.config.float, 1);
    assert.equal(physicsInfoAt(...p)?.config.ballast, 2);
});

test('S01：旧档缺physics兼容；坏版本、键坐标、ID、未知字段与非有限配置拒绝', () => {
    setup();
    const p = [40, 12, 40]; setB(...p, VALVE);
    configure(p, { dir: 1, control: 0, open: 0 });
    const good = capturePhysicsState(), key = p.join(',');
    assert.equal(validatePhysicsState(undefined, state.blocks), null);
    assert.equal(validatePhysicsState(good, state.blocks), null);
    const bad = [null, [], { ...clone(good), v: 2 }, { ...clone(good), devices: [] }];
    const unknown = clone(good); unknown.devices[key].config.unknownParameter = 1; bad.push(unknown);
    const nan = clone(good); nan.devices[key].config.dir = NaN; bad.push(nan);
    const infinite = clone(good); infinite.devices[key].config.dir = Infinity; bad.push(infinite);
    const mismatch = clone(good); mismatch.devices[key].id = PUMP; bad.push(mismatch);
    for (const wrongKey of ['-1,12,40', '256,12,40', '40,128,40', '40,12,40.5', '__proto__']) {
        const raw = clone(good);
        raw.devices = Object.fromEntries([[wrongKey, clone(good.devices[key])]]);
        bad.push(raw);
    }
    for (const raw of bad) {
        const error = validatePhysicsState(raw, state.blocks);
        assert.ok(typeof error === 'string' && error.length > 0, '非法配置必须返回错误文案');
    }
    assert.deepEqual(capturePhysicsState(), good, '纯校验不修改当前配置');
});

test('S01：超512装置的保存数据拒绝，不能借每槽默认值绕过上限', () => {
    setup();
    const p = [40, 12, 40]; setB(...p, VALVE); configure(p, { dir: 1, open: 0, control: 0 });
    const sample = capturePhysicsState().devices[p.join(',')];
    const dims = [32, 4, 32], blocks = new Uint8Array(32 * 4 * 32), raw = { v: 1, devices: {} };
    for (let i = 0; i < 513; i++) {
        const x = i % 32, z = Math.floor(i / 32), y = 1;
        blocks[x + z * 32 + y * 32 * 32] = VALVE;
        raw.devices[`${x},${y},${z}`] = clone(sample);
    }
    const error = validatePhysicsState(raw, blocks, dims);
    assert.ok(typeof error === 'string' && error.length > 0);
});

test('S01：六个普通槽分别保存水量和阀参数，读取不串槽', () => {
    setup(); localStorage.clear();
    const p = [40, 12, 40], trough = [43, 12, 40];
    setB(...p, VALVE);
    for (let slot = 0; slot < C.SAVE_SLOTS; slot++) {
        state.saveSlot = slot;
        T(...trough, slot % 5);
        configure(p, { dir: slot % 4, control: 0, open: slot % 2 });
        assert.equal(saveGame(), true);
    }
    for (let slot = 0; slot < C.SAVE_SLOTS; slot++) {
        assert.equal(loadGame(slot), true);
        assert.equal(qAt(trough), slot % 5);
        const config = physicsInfoAt(...p)?.config;
        assert.equal(config?.dir, slot % 4);
        assert.equal(config?.open, slot % 2);
    }
});

test('S01：文件导入先验证physics；坏数据不覆盖目标槽或当前世界', () => {
    setup(); localStorage.clear();
    const p = [40, 12, 40], trough = T(43, 12, 40, 3);
    setB(...p, VALVE); configure(p, { dir: 1, control: 0, open: 0 });
    assert.equal(saveGame(), true);
    const text = exportSlotJson(0), raw = JSON.parse(text), beforeBlocks = state.blocks.slice();
    localStorage.setItem('mcweb.save.v1.slot1', text);
    const beforeTarget = localStorage.getItem('mcweb.save.v1.slot1');
    const bad = clone(raw); bad.physics.devices[p.join(',')].config.open = 7;
    assert.ok(importSlotJson(JSON.stringify(bad), 1));
    assert.equal(localStorage.getItem('mcweb.save.v1.slot1'), beforeTarget);
    assert.deepEqual(state.blocks, beforeBlocks);
    assert.equal(qAt(trough), 3);
    assert.equal(importSlotJson(text, 1), null);
    assert.equal(loadGame(1), true);
    assert.equal(qAt(trough), 3);
    assert.equal(physicsInfoAt(...p)?.config.open, 0);
});

test('S01：热重载恢复水量和配置；坏快照在改世界之前拒绝', () => {
    setup(); sessionStorage.clear();
    const p = [40, 12, 40], trough = T(43, 12, 40, 4);
    setB(...p, VALVE); configure(p, { dir: 1, control: 0, open: 0 });
    assert.equal(saveSnapshotForReload(), true);
    const good = sessionStorage.getItem('mcAssistant.snapshot');
    T(...trough, 1); configure(p, { open: 1 });
    const bad = JSON.parse(good); bad.physics.devices[p.join(',')].config.dir = 99;
    sessionStorage.setItem('mcAssistant.snapshot', JSON.stringify(bad));
    const before = state.blocks.slice();
    assert.equal(restoreSnapshotIfAny(), false);
    assert.deepEqual(state.blocks, before);
    assert.equal(physicsInfoAt(...p)?.config.open, 1);
    sessionStorage.setItem('mcAssistant.snapshot', good);
    assert.equal(restoreSnapshotIfAny(), true);
    assert.equal(qAt(trough), 4);
    assert.equal(physicsInfoAt(...p)?.config.open, 0);
});

test('S01：卡片配置局部坐标往返，q状态与浮块参数保留，改参数改变hash', async () => {
    setup();
    setB(20, 9, 20, C.flagId(C.FLAG_START));
    setB(28, 9, 20, C.flagId(C.FLAG_GOAL));
    const trough = T(23, 9, 21, 3), valve = [25, 9, 21];
    configure(trough, { float: 1, ballast: 2 });
    setB(...valve, VALVE); configure(valve, { dir: 1, control: 0, open: 0, allowRun: 1 });
    const card = await buildLevelCard({ name: '水力独立往返验收', author: 'QA', lockMetaProvider: () => null });
    assert.ok(card && !card.error, card?.error);
    assert.equal(validateLevelCard(card).ok, true);
    assert.ok(card.physics?.devices);
    for (const key of Object.keys(card.physics.devices)) {
        const [x, y, z] = key.split(',').map(Number);
        assert.ok(x >= 0 && x < card.region.w && y >= 0 && y < card.region.h && z >= 0 && z < card.region.d);
    }
    const localValve = valve.map((v, i) => v - [card.region.x0, card.region.y0, card.region.z0][i]).join(',');
    const changed = clone(card); changed.physics.devices[localValve].config.open = 1;
    assert.notEqual(cardHash(changed), cardHash(card));
    const reordered = clone(card);
    reordered.physics.devices = Object.fromEntries(Object.entries(reordered.physics.devices).reverse().map(([key, device]) =>
        [key, { ...device, config: Object.fromEntries(Object.entries(device.config).reverse()) }]));
    assert.equal(cardHash(reordered), cardHash(card), '参数键顺序不改变卡身份');
    const compact=clone(card),compactConfig=compact.physics.devices[localValve].config;
    delete compactConfig.dir;delete compactConfig.open;delete compactConfig.control;compactConfig.allowRun=true;
    assert.equal(cardHash(compact),cardHash(card),'省略默认条件、0/1与布尔授权不改变卡身份');
    const legacy = clone(card); delete legacy.physics;
    const empty = clone(legacy); empty.physics = { v: 1, devices: {} };
    assert.equal(cardHash(empty), cardHash(legacy), '缺字段旧卡与空物理配置保留同一身份');
    const targets = [trough, valve].map(p => p.map((v, i) =>
        v - [card.region.x0, card.region.y0, card.region.z0][i] + [LEVEL_EMBED_OFFSET.x, LEVEL_EMBED_OFFSET.y, LEVEL_EMBED_OFFSET.z][i]));
    setup();
    assert.ok(embedLevelToWorld(card)?.spawn);
    initPhysicsLab();
    assert.equal(qAt(targets[0]), 3);
    assert.equal(physicsInfoAt(...targets[0])?.config.float, 1);
    assert.equal(physicsInfoAt(...targets[0])?.config.ballast, 2);
    assert.equal(physicsInfoAt(...targets[1])?.config.allowRun, 1);
});

test('S02：关卡拒绝桶和改参数，覆盖与切世界清除旧装置配置', () => {
    setup();
    const p = T(35, 12, 35, 0);
    configure(p, { float: 1, ballast: 2, allowRun: 0 });
    state.player.inventory[C.LifeItems.WATER_BUCKET] = 1;
    state.levelRun = { rules: {} };
    const before = clone(state.player.inventory);
    assert.ok(physicsBucketAt(...p, C.LifeItems.WATER_BUCKET)?.error);
    assert.ok(configurePhysicsAt(...p, { ballast: 4 })?.error);
    assert.ok(physicsActionAt(...p, 'reset')?.error);
    assert.equal(qAt(p), 0);
    assert.deepEqual(state.player.inventory, before);
    state.levelRun = null;
    setB(...p, B.STONE);
    assert.equal(physicsInfoAt(...p), null);
    assert.equal(capturePhysicsState().devices[p.join(',')], undefined);
    setup();
    assert.equal(physicsInfoAt(...p), null);
    assert.equal(Object.keys(capturePhysicsState().devices).length, 0);
});

test('G3/S01：省略可选physics字段不能绕过装置与水槽上限', () => {
    const dims=[32,4,32],blocks=new Uint8Array(32*4*32);
    blocks.fill(C.PhysicsBlocks.RAMP,0,513);
    assert.match(validatePhysicsState(undefined,blocks,dims),/超限/);
    blocks.fill(0);blocks.fill(C.troughId(0),0,257);
    assert.match(validatePhysicsState(undefined,blocks,dims),/超限/);
    blocks.fill(0);blocks[0]=C.PhysicsBlocks.RAMP;
    assert.equal(validatePhysicsState(undefined,blocks,dims),null,'少量旧数据仍取默认配置');
});

test('G3/S01：公开机械放置入口在512装置时返回错误且不写目标格', () => {
    setup();
    for(let i=0;i<512;i++)state.blocks[10+i%32+(10+Math.floor(i/32))*C.WORLD_WIDTH+12*C.WORLD_WIDTH*C.WORLD_DEPTH]=C.PhysicsBlocks.RAMP;
    initPhysicsLab();
    assert.match(placeKinetic(80,12,80,C.PhysicsBlocks.FAN,{dx:0,dy:1,dz:0}),/上限/);
    assert.equal(at(80,12,80),B.AIR);
});

test('G3/W01：普通实验组件库存满时挖掘转为真掉落，不丢失回收物', () => {
    setup(C.GameModes.SURVIVAL);
    const p=[40,12,40],id=C.PhysicsBlocks.RAMP;
    setB(...p,id);state.player.inventory[id]=C.LIFE.maxInventory;
    breakBlockAt({x:p[0],y:p[1],z:p[2],block:id});
    assert.equal(at(...p),B.AIR);
    assert.equal(state.player.inventory[id],C.LIFE.maxInventory);
    assert.equal(state.itemDrops.filter(d=>d.itemId===id).reduce((n,d)=>n+d.count,0),1);
});

test('G3/W01：普通世界直接把湿槽换成空槽也保留原水量回收物', () => {
    setup(C.GameModes.SURVIVAL);const p=T(40,12,40,4);
    setB(...p,C.troughId(0));
    assert.equal(qAt(p),0);
    assert.equal(state.lifePendingDrops.filter(d=>d.stack.id===C.troughId(4)).reduce((n,d)=>n+d.stack.count,0),1);
    tickPhysicsLab(.3);
    assert.equal(state.lifePendingDrops.length,1,'空槽的普通更新不能重复返还原来的水');
});
