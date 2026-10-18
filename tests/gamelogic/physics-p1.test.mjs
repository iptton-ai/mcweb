// Independent acceptance tests from docs/physics-p1-plan.md, written before implementation.
// These scenarios assert physical outcomes and compatibility, not graph internals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry } from 'three';
import { freshWorld, pump, setB, at, state } from './kit.mjs';
import * as C from '../../js/config.js';
import * as K from '../../js/kinetic.js';
import { placeRedstone, toggleLeverAt, updateRedstoneNetwork } from '../../js/redstone.js';
import { placePiston } from '../../js/piston.js';
import { spawnItemDrop } from '../../js/items.js';
import { spawnMob } from '../../js/entities.js';
import { containerAt } from '../../js/homestead.js';
import { rleEncode, rleDecode } from '../../js/rle.js';
import { saveGame, loadGame } from '../../js/saveGame.js';
import { saveSnapshotForReload, restoreSnapshotIfAny } from '../../js/assistant/snapshot.js';
import { buildLevelCard, validateLevelCard, embedLevelToWorld, LEVEL_EMBED_OFFSET } from '../../js/levelWorkshop.js';
import { getPrefab, buildPrefabCells } from '../../js/levelPrefabs.js';

const B = C.BlockTypes;
const UP = { dx: 0, dy: 1, dz: 0 }, FX = { dx: 1, dy: 0, dz: 0 };
const FACES = [FX, UP, { dx: 0, dy: 0, dz: 1 }];
// Exact catalog observed before P1 implementation. selectedSlot is persisted as its index.
const OLD_HOTBAR = [1,2,3,4,5,6,9,10,11,12,13,14,15,8,16,17,18,19,35,37,49,61,83,95,97,104,116,135,156,148,152,160,164,212,218,222,202,206,224,226,228,7,170,171,172,173,174,175,180,181,182,183,184,185,186,187,190,191,100,192,193,194,101,195,196,197,102,198,199,200,103,201,229,230,231,232,234,188,242,248,249,250,256,257,258,259,260,261,262,263,252,264,265,266];
const SAVE_KEYS = ['adventure','blocks','dims','enc','firstDayRemaining','gameMode','generationVersion','homeBed','homeGuideEnabled','life','player','savedAt','spawn','starterWorkshopClaimed','survivalDifficulty','survivalStarted','time','version','viewMode','worldSeed'];
const PLAYER_KEYS = ['air','flying','health','hunger','inventory','pitch','quickbar','selectedSlot','toolReserveWear','toolWear','x','xp','y','yaw','z'];

// Existing test renderer omits UV storage; local shim only, no gameplay behavior substituted.
if (!Object.getOwnPropertyDescriptor(BufferGeometry.prototype, 'attributes')) {
    Object.defineProperty(BufferGeometry.prototype, 'attributes', {
        configurable: true,
        get() { return this.__attrs; },
        set(v) { if (v && !v.uv) v.uv = new BufferAttribute(new Float32Array(48), 2); this.__attrs = v; },
    });
}
BufferAttribute.prototype.setXY ||= function (i, x, y) {
    this.array[i * this.itemSize] = x; this.array[i * this.itemSize + 1] = y; return this;
};

const info = (x, y, z) => K.kineticInfoAt(x, y, z);
const rpm = (x, y, z) => Math.abs(info(x, y, z)?.rpm || 0);
const running = (x, y, z) => !!info(x, y, z)?.running;
function setup() {
    freshWorld();
    state.levelRun = state.levelEdit = null;
    state.player.selectedSlot = 0;
}
function waterwheel(x, y, z, axis = 0) {
    setB(x, y, z, C.waterwheelId(axis));
    setB(x, y + 1, z, B.WATER);
}
function lever(x, y, z, on = true) {
    setB(x, y - 1, z, B.STONE);
    assert.equal(placeRedstone(x, y, z, C.LEVER_ITEM_ID, UP), null);
    if (on) toggleLeverAt(x, y, z);
}
function gears(stages = 1, fast = true, ox = 30, oy = 10, oz = 30) {
    waterwheel(ox, oy, oz);
    const first = fast ? C.largeCogId : C.cogId;
    const second = fast ? C.cogId : C.largeCogId;
    for (let s = 0; s < stages; s++) {
        const x = ox + 1 + 2 * s, y = oy + s;
        setB(x, y, oz, first(0));
        setB(x, y + 1, oz, second(0));
        if (s + 1 < stages) setB(x + 1, y + 1, oz, C.shaftId(0));
    }
    K.updateKineticNetwork();
    return { x: ox + 2 * stages - 1, y: oy + stages, z: oz };
}
function lift(x = 40, z = 40, platformY = 11, pulleyY = 20) {
    waterwheel(x, pulleyY + 3, z, 1);
    for (const y of [pulleyY + 1, pulleyY + 2]) setB(x, y, z, C.shaftId(1));
    setB(x, pulleyY, z, C.pulleyId(false, false));
    setB(x, platformY, z, C.PLATFORM_ITEM_ID);
    lever(x, pulleyY, z + 1);
    K.updateKineticNetwork();
    return { x, z, platformY, pulleyY };
}
function variants() { return Array.from({ length: 12 }, (_, i) => 63 + i); }
function registerAllVariants() {
    for (const [i, id] of variants().entries()) {
        const x = 20 + i * 3;
        setB(x, 9, 20, id);
        if (id >= 69 && (id - 69) % 2) setB(x, 9, 21, C.leverId(0, 1));
    }
}

test('P1-E01: every new family places along all three axes and breaks into its representative', () => {
    setup();
    const families = [
        [C.CRANK_ITEM_ID, C.crankId], [C.LARGE_COG_ITEM_ID, C.largeCogId],
        [C.REVERSER_ITEM_ID, axis => C.reverserId(axis, 0)],
    ];
    for (const [f, [item, encoded]] of families.entries()) for (let axis = 0; axis < 3; axis++) {
        const x = 20 + f * 6 + axis * 2;
        assert.equal(K.placeKinetic(x, 9, 20, item, FACES[axis]), null);
        assert.equal(at(x, 9, 20), encoded(axis));
        assert.equal(C.BlockInfo[at(x, 9, 20)].drop, item);
        assert.equal(C.kineticItemId(at(x, 9, 20)), item);
        K.breakKineticAt(x, 9, 20);
        assert.equal(at(x, 9, 20), B.AIR);
    }
});

test('P1-N01: redstone never converts IDs 63..74 into lamps; old dust/lamp still work', () => {
    setup(); registerAllVariants();
    lever(20, 9, 40, false);
    for (const x of [21, 22]) setB(x, 9, 40, C.DUST_ITEM_ID);
    setB(23, 9, 40, C.LAMP_ITEM_ID);
    updateRedstoneNetwork();
    for (const [i, id] of variants().entries()) assert.equal(at(20 + i * 3, 9, 20), id, `ID ${id}`);
    toggleLeverAt(20, 9, 40);
    assert.equal(C.dustLit(at(22, 9, 40)), 1);
    assert.ok(C.isLampLitId(at(23, 9, 40)));
    toggleLeverAt(20, 9, 40);
    assert.equal(C.dustLit(at(22, 9, 40)), 0);
    assert.ok(!C.isLampLitId(at(23, 9, 40)));
});

for (const fast of [true, false]) for (const stages of [1, 2, 3]) {
    test(`P1-E04: ${stages} ${fast ? 'speed-up' : 'reduction'} stages honor 2..32 RPM`, () => {
        setup(); const p = gears(stages, fast);
        const expected = 8 * (fast ? 2 : 0.5) ** stages;
        if (stages === 3) {
            assert.equal(running(p.x, p.y, p.z), false);
            assert.equal(rpm(30, 10, 30), 0, 'out-of-range stalls the whole connected network');
            assert.match(K.kineticStatusAt(p.x, p.y, p.z), /超出转速范围/);
        } else {
            assert.equal(rpm(p.x, p.y, p.z), expected);
            assert.equal(info(p.x, p.y, p.z).direction, stages % 2 ? -1 : 1);
            assert.equal(info(p.x, p.y, p.z).ratio, expected / 8);
        }
    });
}

for (const arrangement of ['parallel', 'perpendicular', 'coaxial']) {
    test(`P1-E11: large/large ${arrangement} is equal-speed with the specified direction`, () => {
        setup(); waterwheel(30, 10, 30);
        setB(31, 10, 30, C.largeCogId(0));
        const p = arrangement === 'coaxial' ? [32, 10, 30] : [31, 11, 30];
        setB(...p, C.largeCogId(arrangement === 'perpendicular' ? 1 : 0));
        K.updateKineticNetwork();
        assert.equal(rpm(...p), 8);
        assert.equal(info(...p).direction, arrangement === 'coaxial' ? 1 : -1);
    });
}
test('P1-E04/E11: coaxial large/small is 1:1; parallel old small/small stays disconnected', () => {
    setup(); waterwheel(30, 10, 30);
    setB(31, 10, 30, C.largeCogId(0)); setB(32, 10, 30, C.cogId(0));
    setB(32, 11, 30, C.cogId(0)); K.updateKineticNetwork();
    assert.equal(rpm(32, 10, 30), 8);
    assert.equal(info(32, 10, 30).direction, 1);
    assert.equal(rpm(32, 11, 30), 0);
});

for (const fromRight of [false, true]) test(`P1-E05: powered reverser flips once with source on ${fromRight ? '+' : '-'} port`, () => {
    setup(); waterwheel(fromRight ? 34 : 30, 9, 30);
    setB(31, 9, 30, C.shaftId(0)); setB(32, 9, 30, C.reverserId(0, 0));
    setB(33, 9, 30, C.shaftId(0));
    lever(32, 9, 31, false); K.updateKineticNetwork();
    const end = fromRight ? 31 : 33;
    assert.equal(info(end, 9, 30).direction, 1);
    toggleLeverAt(32, 9, 31);
    assert.equal(C.reverserPowered(at(32, 9, 30)), 1);
    assert.equal(info(end, 9, 30).direction, -1);
    assert.equal(rpm(end, 9, 30), 8);
    setB(32, 9, 31, B.AIR); updateRedstoneNetwork();
    assert.equal(C.reverserPowered(at(32, 9, 30)), 0);
    assert.equal(info(end, 9, 30).direction, 1);
});
test('P1-E05: two powered reversers in series cancel', () => {
    setup(); waterwheel(30, 9, 30);
    setB(31, 9, 30, C.reverserId(0, 1)); setB(32, 9, 30, C.reverserId(0, 1));
    setB(33, 9, 30, C.shaftId(0)); K.updateKineticNetwork();
    assert.equal(rpm(33, 9, 30), 8); assert.equal(info(33, 9, 30).direction, 1);
});

test('P1-E07/E10: odd mesh conflicts with a second source; reverser fixes phase and sums capacity', () => {
    setup(); waterwheel(30, 10, 30);
    setB(31, 10, 30, C.cogId(0)); setB(31, 11, 30, C.cogId(1));
    setB(31, 12, 30, C.reverserId(1, 0)); setB(31, 13, 30, C.shaftId(1));
    waterwheel(31, 14, 30, 1); lever(31, 12, 31, false); K.updateKineticNetwork();
    assert.equal(running(30, 10, 30), false);
    toggleLeverAt(31, 12, 31);
    assert.equal(rpm(30, 10, 30), 8);
    assert.equal(info(30, 10, 30).capacity, 128);
    toggleLeverAt(31, 12, 31);
    assert.equal(running(30, 10, 30), false);
    setB(31, 15, 30, B.AIR); K.updateKineticNetwork();
    assert.equal(rpm(31, 13, 30), 8, 'removing the conflicting source restores operation');
});

test('P1-E07: belts join capacity and absolute speed without imposing shaft phase', () => {
    setup(); waterwheel(30, 9, 30); waterwheel(30, 9, 34);
    setB(31, 9, 30, C.reverserId(0, 1)); setB(32, 9, 30, C.shaftId(0));
    setB(31, 9, 34, C.shaftId(0)); setB(32, 9, 34, C.shaftId(0));
    for (let z = 30; z <= 34; z++) setB(33, 9, z, C.beltId(2));
    K.updateKineticNetwork();
    assert.equal(info(32, 9, 30).direction, -1);
    assert.equal(info(32, 9, 34).direction, 1);
    assert.equal(rpm(33, 9, 32), 8);
    assert.equal(info(33, 9, 32).capacity, 128);
});

test('P1-E07: two differently geared sources joined by a belt report speed conflict', () => {
    setup(); const p = gears(1, true);
    setB(p.x + 1, p.y, p.z, C.beltId(1));
    waterwheel(p.x + 2, p.y, p.z, 0); K.updateKineticNetwork();
    assert.equal(running(p.x, p.y, p.z), false);
    assert.match(K.kineticStatusAt(p.x, p.y, p.z), /转速冲突/);
    setB(p.x + 2, p.y + 1, p.z, B.AIR); K.updateKineticNetwork();
    assert.equal(rpm(p.x, p.y, p.z), 16);
});

test('P1-E08: 16 RPM doubles crusher load; a second compatible source restores production', () => {
    setup(); gears(1, true);
    setB(32, 11, 30, C.shaftId(0));
    setB(33, 11, 30, C.crusherId(0)); setB(33, 11, 31, C.crusherId(0));
    K.updateKineticNetwork();
    assert.equal(info(33, 11, 30).load, 128);
    assert.equal(running(33, 11, 30), false);
    assert.match(K.kineticStatusAt(33, 11, 30), /过载/);
    waterwheel(29, 10, 30); K.updateKineticNetwork();
    assert.equal(info(33, 11, 30).capacity, 128);
    assert.equal(rpm(33, 11, 30), 16);
    setB(33, 12, 30, B.STONE);
    pump(0.01, 58); assert.equal(at(33, 12, 30), B.STONE, 'before 0.6s, stone remains');
    pump(0.01, 5); assert.equal(at(33, 12, 30), B.AIR);
    assert.equal(dropCount(B.COBBLESTONE), 1);
});
for (const fast of [true, false]) test(`P1-E06: ${fast ? '16' : '4'} RPM changes real saw completion time`, () => {
    setup(); gears(1, fast);
    setB(32, 11, 30, C.shaftId(0)); setB(33, 11, 30, C.sawId(3));
    K.updateKineticNetwork(); setB(34, 11, 30, B.WOOD);
    const sec = fast ? 0.25 : 1;
    pump(0.01, Math.round(sec * 100) - 2);
    assert.equal(at(34, 11, 30), B.WOOD, 'not finished before the calculated duration');
    pump(0.01, 5); assert.equal(at(34, 11, 30), B.AIR);
    assert.equal(dropCount(B.PLANKS), 4);
});
for (const replaced of ['machine', 'material']) test(`P1-N02: same-cell ${replaced} replacement never inherits saw progress`, () => {
    setup(); waterwheel(30, 9, 30);
    setB(31, 9, 30, C.shaftId(0)); setB(32, 9, 30, C.sawId(3));
    setB(33, 9, 30, B.WOOD); K.updateKineticNetwork();
    pump(0.1, 4); assert.equal(at(33, 9, 30), B.WOOD, '0.4 of the original 0.5-second operation elapsed');
    const x = replaced === 'machine' ? 32 : 33;
    const id = replaced === 'machine' ? C.sawId(3) : B.WOOD;
    setB(x, 9, 30, B.AIR); setB(x, 9, 30, id); K.updateKineticNetwork();
    pump(0.1, 1);
    assert.equal(at(33, 9, 30), B.WOOD, 'the new operation has only 0.1 seconds of progress');
    assert.equal(dropCount(B.PLANKS), 0);
    pump(0.1, 4);
    assert.equal(at(33, 9, 30), B.AIR, 'replacement still completes after its own full processing duration');
    assert.equal(dropCount(B.PLANKS), 4);
});
test('P1-E06: saw preserves completed-cycle remainder across refill and a powerless frame', () => {
    setup(); waterwheel(30, 9, 30);
    setB(31, 9, 30, C.shaftId(0)); setB(32, 9, 30, C.sawId(3));
    setB(33, 9, 30, B.WOOD); K.updateKineticNetwork();
    pump(0.3, 2);
    assert.equal(at(33, 9, 30), B.AIR); assert.equal(dropCount(B.PLANKS), 4);
    setB(33, 9, 30, B.WOOD); setB(30, 10, 30, B.AIR); K.updateKineticNetwork();
    pump(0.1, 1); assert.equal(at(33, 9, 30), B.WOOD, 'powerless time makes no progress');
    setB(30, 10, 30, B.WATER); K.updateKineticNetwork(); pump(0.4, 1);
    assert.equal(at(33, 9, 30), B.AIR, '0.1-second cycle remainder + 0.4 powered seconds completes the refill');
    assert.equal(dropCount(B.PLANKS), 8);
});
test('P1-E06: crusher preserves completed-cycle remainder across refill and a powerless frame', () => {
    setup(); waterwheel(30, 9, 30);
    setB(31, 9, 30, C.shaftId(0)); setB(32, 9, 30, C.crusherId(0));
    setB(32, 9, 31, C.crusherId(0)); setB(32, 10, 30, B.STONE); K.updateKineticNetwork();
    pump(0.7, 2);
    assert.equal(at(32, 10, 30), B.AIR); assert.equal(dropCount(B.COBBLESTONE), 1);
    setB(32, 10, 30, B.STONE); setB(30, 10, 30, B.AIR); K.updateKineticNetwork();
    pump(0.1, 1); assert.equal(at(32, 10, 30), B.STONE);
    setB(30, 10, 30, B.WATER); K.updateKineticNetwork(); pump(1, 1);
    assert.equal(at(32, 10, 30), B.AIR, '0.2-second cycle remainder + 1 powered second completes the refill');
    assert.equal(dropCount(B.COBBLESTONE), 2);
});

test('P1-E02/N06: hand crank starts/stops; same-cell demolition and axis replacement cancel its source', () => {
    setup(); setB(30, 9, 30, C.crankId(0)); setB(31, 9, 30, C.beltId(1));
    K.updateKineticNetwork(); assert.equal(rpm(31, 9, 30), 0);
    K.setCrankActive(30, 9, 30, true);
    assert.equal(rpm(31, 9, 30), 8); assert.equal(info(31, 9, 30).capacity, 64);
    K.setCrankActive(30, 9, 30, false); assert.equal(rpm(31, 9, 30), 0);
    for (const interim of [B.AIR, C.crankId(1)]) {
        K.setCrankActive(30, 9, 30, true);
        setB(30, 9, 30, interim); setB(30, 9, 30, C.crankId(0));
        K.updateKineticNetwork(); pump(0.05, 2);
        assert.equal(rpm(31, 9, 30), 0, 'a replacement must require a fresh operation');
    }
});

test('P1-N06: every new axis/state is piston-pop, returning exactly one representative', () => {
    setup(); state.gameMode = C.GameModes.SURVIVAL;
    for (const [i, id] of variants().entries()) {
        const z = 20 + i * 3;
        setB(31, 9, z, id);
        assert.equal(placePiston(30, 9, z, C.PISTON_ITEM_ID, FX), null);
        lever(29, 9, z);
    }
    pump(0.05, 5);
    for (const [i] of variants().entries()) {
        assert.ok(C.isPistonHeadId(at(31, 9, 20 + i * 3)));
        assert.equal(at(32, 9, 20 + i * 3), B.AIR, 'not moved one cell forward');
    }
    for (const [id, count] of [[63, 3], [66, 3], [69, 6]]) assert.equal(state.player.inventory[id], count);
    pump(0.05, 10);
    for (const [id, count] of [[63, 3], [66, 3], [69, 6]]) assert.equal(state.player.inventory[id], count, 'no duplicate refunds');
});

test('P1-N05: side belt cannot steal a bound platform or an unbound platform', () => {
    setup(); lift();
    gears(1, true, 36, 10, 40);
    setB(38, 11, 40, C.shaftId(0)); setB(39, 11, 40, C.beltId(1));
    setB(39, 11, 41, C.PLATFORM_ITEM_ID); K.updateKineticNetwork();
    assert.equal(rpm(39, 11, 40), 16);
    assert.equal(rpm(40, 11, 40), 8);
    assert.equal(info(40, 20, 40).load, C.PULLEY_SU_LOAD + C.PLATFORM_SU_LOAD);
    assert.equal(info(40, 20, 40).capacity, 64);
    assert.equal(info(39, 11, 40).load, C.BELT_SU_LOAD * 2);
    assert.equal(rpm(39, 11, 41), 0, 'unbound platform has no adjacent-belt network');
});

test('P1-N03/N07: low ceiling rejects the entire lift step, then removing it resumes safely', () => {
    setup(); lift();
    Object.assign(state.player, { x: 40.5, y: 12, z: 40.5 });
    setB(40, 14, 40, B.STONE); // Current head <14; translated head would intersect 14..15.
    pump(0.05, 15);
    assert.equal(at(40, 11, 40), C.PLATFORM_ITEM_ID);
    assert.equal(at(40, 12, 40), B.AIR);
    assert.equal(state.player.y, 12);
    assert.match(K.kineticStatusAt(40, 20, 40), /乘客.*受阻/);
    setB(40, 14, 40, B.AIR); pump(0.05, 15);
    assert.equal(at(40, 12, 40), C.PLATFORM_ITEM_ID);
    assert.equal(state.player.y, 13, 'new platform is not treated as an immovable swept obstacle');
});
test('P1-N07: two adjacent lifts never carry their shared passenger twice in one frame', () => {
    setup(); lift(40); lift(41);
    Object.assign(state.player, { x: 41, y: 12, z: 40.5 });
    pump(0.05, 14);
    assert.equal(state.player.y, 13);
    assert.ok(at(40, 12, 40) === C.PLATFORM_ITEM_ID || at(41, 12, 40) === C.PLATFORM_ITEM_ID);
});
test('P1-N07: a downward step moves its passenger with the platform without self-collision', () => {
    setup(); lift(); Object.assign(state.player, { x: 40.5, y: 12, z: 40.5 });
    toggleLeverAt(40, 20, 41); pump(0.05, 14);
    assert.equal(at(40, 10, 40), C.PLATFORM_ITEM_ID);
    assert.equal(state.player.y, 11);
});
for (const passenger of ['sheep', 'item']) test(`P1-N03: an obstructed ${passenger} blocks the platform transaction`, () => {
    setup(); lift();
    let entity;
    if (passenger === 'sheep') entity = spawnMob('sheep', 40.5, 12, 40.5);
    else {
        spawnItemDrop(40.5, 12.15, 40.5, B.STONE, 1, { noScatter: true });
        entity = state.itemDrops[0];
    }
    setB(40, 13, 40, B.STONE);
    pump(0.05, 14);
    assert.equal(at(40, 11, 40), C.PLATFORM_ITEM_ID);
    assert.ok(entity.y < 12.5, 'the blocked passenger must not receive a one-cell translation');
});
test('P1-N03: sheep whose actual 0.35 half-width overlaps only the platform edge is carried', () => {
    setup(); lift();
    const sheep = spawnMob('sheep', 41.32, 12, 40.5);
    pump(0.05, 14);
    assert.equal(at(40, 12, 40), C.PLATFORM_ITEM_ID);
    assert.equal(sheep.y, 13, 'left edge 40.97 is still supported by platform x40..41');
});
test('P1-N07: a second blocked fast-lift substep preserves only the first completed step', () => {
    setup();
    for (const x of [25, 26, 27]) waterwheel(x, 20, 40);
    setB(28, 20, 40, C.shaftId(0)); setB(29, 20, 40, C.largeCogId(0));
    setB(29, 19, 40, C.cogId(0)); setB(30, 19, 40, C.shaftId(0));
    setB(31, 19, 40, C.largeCogId(0)); setB(31, 18, 40, C.cogId(0));
    setB(31, 17, 40, C.cogId(1)); setB(31, 16, 40, C.shaftId(1));
    setB(31, 15, 40, C.pulleyId(false, false)); setB(31, 10, 40, C.PLATFORM_ITEM_ID);
    lever(31, 15, 41); K.updateKineticNetwork();
    assert.equal(rpm(31, 15, 40), 32, 'three sources supply the fast lift load');
    Object.assign(state.player, { x: 31.5, y: 11, z: 40.5 }); setB(31, 14, 40, B.STONE);
    pump(0.4, 1); // A deliberately long frame exercises bounded multi-step advancement.
    assert.equal(at(31, 11, 40), C.PLATFORM_ITEM_ID);
    assert.equal(at(31, 12, 40), B.AIR);
    assert.equal(state.player.y, 12);
});

function fastBelt() {
    gears(2, true);
    setB(34, 12, 30, C.shaftId(0));
    for (const [x, z, dir] of [[35, 30, 1], [36, 30, 2], [36, 31, 2]]) {
        setB(x, 11, z, B.STONE); setB(x, 12, z, C.beltId(dir));
    }
    setB(36, 11, 32, B.STONE); setB(36, 12, 32, C.LifeBlocks.CHEST);
    K.updateKineticNetwork();
    assert.equal(rpm(35, 12, 30), 32);
    assert.equal(K.beltSpeedAt(35, 12, 30), 6);
    return containerAt(36, 12, 32);
}
const chestCount = (c, id) => c.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
const dropCount = id => state.itemDrops.reduce((n, d) => n + (d.itemId === id ? d.count : 0), 0);
test('P1-E06: actual 32 RPM belt transport travels 0.6 cells in a 0.1-second frame', () => {
    setup(); fastBelt();
    spawnItemDrop(35.1, 12.15, 30.5, B.PLANKS, 1, { noScatter: true });
    pump(0.1, 1);
    assert.ok(Math.abs(state.itemDrops[0].x - 35.7) < 0.02,
        `actual item x=${state.itemDrops[0].x}; the HUD speed alone is not sufficient`);
});
for (const hz of [10, 30, 60, 120]) test(`P1-N04/N08: 32 RPM turn/full chest/partial intake/power cycle conserves stock at ${hz}Hz`, () => {
    setup(); const c = fastBelt();
    c.slots = Array.from({ length: 27 }, () => ({ id: B.DIRT, count: 64 }));
    c.slots[0] = { id: B.PLANKS, count: 63 };
    for (const x of [35.1, 35.5, 35.9]) spawnItemDrop(x, 12.15, 30.5, B.PLANKS, 4, { noScatter: true });
    const queued = [...state.itemDrops], progress = d => d.x - 35.1 + d.z - 30.5;
    for (let frame = 0; frame < hz * 4; frame++) {
        pump(1 / hz, 1);
        assert.ok(progress(queued[0]) <= progress(queued[1]) + 1e-6 &&
            progress(queued[1]) <= progress(queued[2]) + 1e-6, 'following stock may not cross the queue ahead');
    }
    assert.equal(chestCount(c, B.PLANKS), 64, 'exactly one item fits before chest is full');
    assert.equal(dropCount(B.PLANKS), 11);
    assert.ok(state.itemDrops.every(d => d.z < 32 && d.x < 37), 'queue cannot cross chest or miss the corner');
    setB(30, 11, 30, B.AIR); K.updateKineticNetwork(); pump(1 / hz, hz);
    assert.equal(dropCount(B.PLANKS), 11, 'power loss preserves all queued stock');
    c.slots[1] = null; setB(30, 11, 30, B.WATER); K.updateKineticNetwork(); pump(1 / hz, hz * 4);
    assert.equal(chestCount(c, B.PLANKS), 75);
    assert.equal(dropCount(B.PLANKS), 0);
    assert.equal(state.player.inventory[B.PLANKS] || 0, 0);
});
for (const hz of [10, 30, 60, 120]) test(`P1-N08/P05: 24-entity 32 RPM corner queue conserves count and spacing at ${hz}Hz`, () => {
    setup(); gears(2, true);
    for (const x of [27, 28, 29]) waterwheel(x, 10, 30);
    setB(34, 12, 30, C.shaftId(0));
    for (let x = 35; x <= 45; x++) {
        setB(x, 11, 30, B.STONE); setB(x, 12, 30, C.beltId(x === 45 ? 2 : 1));
    }
    setB(45, 11, 31, B.STONE); setB(45, 12, 31, C.beltId(2));
    setB(45, 11, 32, B.STONE); setB(45, 12, 32, C.LifeBlocks.CHEST);
    K.updateKineticNetwork();
    assert.equal(rpm(35, 12, 30), 32); assert.equal(info(35, 12, 30).capacity, 256);
    const chest = containerAt(45, 12, 32);
    chest.slots = Array.from({ length: 27 }, () => ({ id: B.DIRT, count: 64 }));
    chest.slots[0] = { id: B.PLANKS, count: 63 };
    for (let i = 0; i < 24; i++) spawnItemDrop(35.15 + i * 0.4, 12.15, 30.5, B.PLANKS, 4, { noScatter: true });
    assert.equal(state.itemDrops.length, 24, 'scenario must enter the high-entity transport path');
    const queued = [...state.itemDrops], progress = d => d.x + d.z;
    for (let frame = 0; frame < hz * 3; frame++) {
        pump(1 / hz, 1);
        for (let i = 1; i < queued.length; i++) {
            const tail = queued[i - 1], head = queued[i];
            const positions = JSON.stringify({tail:[tail.x,tail.z],head:[head.x,head.z]});
            assert.ok(progress(tail) <= progress(head) + 1e-6, `frame ${frame}: stack ${i - 1} crossed stack ${i}: ${positions}`);
            if (Math.abs(tail.x - head.x) < 0.02 || Math.abs(tail.z - head.z) < 0.02) {
                assert.ok(Math.hypot(tail.x - head.x, tail.z - head.z) >= 0.34,
                    `frame ${frame}: collinear queue gap collapsed between stacks ${i - 1}/${i}: ${positions}`);
            }
        }
    }
    assert.equal(chestCount(chest, B.PLANKS), 64); assert.equal(dropCount(B.PLANKS), 95);
    assert.ok(queued.every(d => d.z < 32 && d.x < 46), 'nothing crosses the corner or the full chest');
    for (const x of [27, 28, 29, 30]) setB(x, 11, 30, B.AIR);
    K.updateKineticNetwork(); pump(1 / hz, hz);
    assert.equal(dropCount(B.PLANKS), 95);
    chest.slots[1] = chest.slots[2] = null;
    for (const x of [27, 28, 29, 30]) setB(x, 11, 30, B.WATER);
    K.updateKineticNetwork(); pump(1 / hz, hz * 6);
    assert.equal(chestCount(chest, B.PLANKS), 159, '63 initial + 96 delivered items');
    assert.equal(dropCount(B.PLANKS), 0);
});

test('P1-S01: old catalog indices stay fixed and all new byte IDs survive RLE long runs', () => {
    assert.deepEqual(C.HotbarBlocks.slice(0, OLD_HOTBAR.length), OLD_HOTBAR);
    assert.deepEqual(C.HotbarBlocks.slice(OLD_HOTBAR.length), [63, 66, 69]);
    const data = new Uint8Array(70000 + 12);
    data.fill(63, 0, 70000); data.set(variants(), 70000);
    assert.deepEqual(rleDecode(rleEncode(data), data.length), data);
});
test('P1-S01/S02: all variants survive save and snapshot; field sets and selectedSlot stay compatible', () => {
    setup(); registerAllVariants(); state.saveSlot = 4;
    state.player.selectedSlot = OLD_HOTBAR.length - 1;
    K.updateKineticNetwork(); K.setCrankActive(20, 9, 20, true);
    assert.equal(saveGame(), true);
    const saved = JSON.parse(localStorage.getItem('mcweb.save.v1.slot4'));
    assert.deepEqual(Object.keys(saved).sort(), SAVE_KEYS);
    assert.deepEqual(Object.keys(saved.player).sort(), PLAYER_KEYS);
    setB(20, 9, 20, B.AIR); assert.equal(loadGame(4), true);
    for (const [i, id] of variants().entries()) assert.equal(at(20 + i * 3, 9, 20), id);
    assert.equal(rpm(20, 9, 20), 0, 'saved manual operation never restarts');
    assert.equal(C.HotbarBlocks[state.player.selectedSlot], OLD_HOTBAR.at(-1));
    assert.equal(saveSnapshotForReload(), true); setB(20, 9, 20, B.AIR);
    assert.equal(restoreSnapshotIfAny(), true);
    for (const [i, id] of variants().entries()) assert.equal(at(20 + i * 3, 9, 20), id);
    assert.equal(C.HotbarBlocks[state.player.selectedSlot], OLD_HOTBAR.at(-1));
    assert.equal(rpm(20, 9, 20), 0);
});
test('P1-S01: current level-card format round-trips all twelve component variants', async () => {
    setup(); registerAllVariants();
    setB(18, 9, 18, C.flagId(C.FLAG_START)); setB(55, 9, 22, C.flagId(C.FLAG_GOAL));
    const card = await buildLevelCard({ name: 'P1 component compatibility', author: 'independent QA' });
    assert.ok(card && !card.error, card?.error);
    assert.equal(card.format, 'mcweb.level.v1');
    assert.equal(validateLevelCard(card).ok, true);
    setup(); embedLevelToWorld(card);
    for (const [i, id] of variants().entries()) {
        assert.equal(at(LEVEL_EMBED_OFFSET.x + 20 + i * 3 - card.region.x0,
            LEVEL_EMBED_OFFSET.y + 9 - card.region.y0,
            LEVEL_EMBED_OFFSET.z + 20 - card.region.z0), id);
    }
});

function stampPhysicsPrefab(id) {
    const prefab = getPrefab(id), built = buildPrefabCells(prefab);
    assert.ok(prefab, `registered template ${id}`);
    assert.ok(!built.error, built.error);
    for (const c of built.cells) setB(50 + c.x, 8 + c.y, 50 + c.z, c.id);
    updateRedstoneNetwork(); K.updateKineticNetwork();
    return (x, y, z) => [50 + x, 8 + y, 50 + z];
}
test('P1-E09: hand-transport prefab actually carries stock into its chest and stops on release', () => {
    setup(); const pos = stampPhysicsPrefab('physics_hand_transport');
    const chest = containerAt(...pos(7, 1, 2));
    spawnItemDrop(53.5, 9.15, 52.5, B.PLANKS, 4, { noScatter: true });
    K.setCrankActive(...pos(1, 1, 2), true);
    assert.equal(rpm(...pos(3, 1, 2)), 8); pump(0.05, 10);
    const drop = state.itemDrops[0], x = drop.x;
    assert.ok(Math.abs(x - 54.25) < 0.02);
    K.setCrankActive(...pos(1, 1, 2), false); pump(0.05, 10);
    assert.equal(drop.x, x);
    K.setCrankActive(...pos(1, 1, 2), true); pump(0.05, 60);
    assert.equal(chestCount(chest, B.PLANKS), 4); assert.equal(dropCount(B.PLANKS), 0);
});
test('P1-E09: speed-comparison prefab realizes 16/4 RPM, fourfold distance and distinct saw durations', () => {
    setup(); const pos = stampPhysicsPrefab('physics_speed_comparison');
    assert.equal(rpm(...pos(4, 2, 2)), 16); assert.equal(rpm(...pos(4, 2, 6)), 4);
    spawnItemDrop(54.5, 10.15, 52.5, B.STONE, 1, { noScatter: true }); const fast = state.itemDrops.at(-1);
    spawnItemDrop(54.5, 10.15, 56.5, B.STONE, 1, { noScatter: true }); const slow = state.itemDrops.at(-1);
    pump(0.1, 1);
    assert.ok(Math.abs(fast.x - 54.8) < 0.01); assert.ok(Math.abs(slow.x - 54.575) < 0.01);
    pump(0.1, 2);
    assert.equal(at(...pos(9, 2, 2)), B.AIR, 'fast side has finished its log at 0.3s');
    assert.equal(at(...pos(9, 2, 6)), B.LOG, 'slow side is still cutting at 0.3s');
    pump(0.05, 15);
    assert.equal(at(...pos(9, 2, 6)), B.AIR);
    assert.equal(dropCount(B.PLANKS), 8, 'both real saws each produce four planks');
});
test('P1-E09: lift-lab prefab lever wiring raises and lowers an actual passenger', () => {
    setup(); const pos = stampPhysicsPrefab('physics_lift_lab');
    const levers = buildPrefabCells(getPrefab('physics_lift_lab')).cells.filter(c => C.isLeverId(c.id));
    assert.equal(levers.length, 1, 'the playable lift template has one actual control lever');
    const control = pos(levers[0].x, levers[0].y, levers[0].z);
    Object.assign(state.player, { x: 52.5, y: 9, z: 52.5 });
    assert.equal(info(...pos(2, 6, 2)).load, 40);
    toggleLeverAt(...control); pump(0.05, 14);
    assert.equal(at(...pos(2, 1, 2)), C.PLATFORM_ITEM_ID); assert.equal(state.player.y, 10);
    toggleLeverAt(...control); pump(0.05, 14);
    assert.equal(at(...pos(2, 0, 2)), C.PLATFORM_ITEM_ID); assert.equal(state.player.y, 9);
});
test('P1-E09/E10: phase-merge prefab jams until its real lever is on, then produces planks', () => {
    setup(); const pos = stampPhysicsPrefab('physics_phase_merge');
    assert.equal(running(...pos(2, 1, 2)), false); pump(0.1, 6);
    assert.equal(at(...pos(1, 1, 2)), B.LOG);
    toggleLeverAt(...pos(5, 3, 2));
    assert.equal(rpm(...pos(2, 1, 2)), 8); assert.equal(info(...pos(2, 1, 2)).capacity, 128);
    pump(0.1, 6); assert.equal(at(...pos(1, 1, 2)), B.AIR); assert.equal(dropCount(B.PLANKS), 4);
    setB(...pos(1, 1, 2), B.LOG); toggleLeverAt(...pos(5, 3, 2)); pump(0.1, 6);
    assert.equal(running(...pos(2, 1, 2)), false); assert.equal(at(...pos(1, 1, 2)), B.LOG);
    assert.equal(dropCount(B.PLANKS), 4, 'turning correction off prevents another production');
});
