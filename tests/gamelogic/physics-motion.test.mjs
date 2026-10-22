// 按 physics-rest-plan 的冻结行为编写；只使用公开 API，不读取实验求解器实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry } from 'three';
import { freshWorld, setB, at, state } from './kit.mjs';
import * as C from '../../js/config.js';
import * as K from '../../js/kinetic.js';
import { updateRedstoneNetwork, updateRedstoneTick, redstoneSignalAt } from '../../js/redstone.js';
import { spawnTntEntity, updateTnt } from '../../js/tnt.js';
import { saveGame, loadGame, importSlotJson, exportSlotJson } from '../../js/saveGame.js';
import { saveSnapshotForReload, restoreSnapshotIfAny } from '../../js/assistant/snapshot.js';
import {
    initPhysicsLab, tickPhysicsLab, configurePhysicsAt, physicsActionAt, physicsInfoAt, physicsDiagnostics, physicsWindOpenAt,
} from '../../js/physicsLab.js';
import { capturePhysicsState, validatePhysicsState } from '../../js/physicsData.js';
import { buildLevelCard } from '../../js/levelWorkshop.js';

const B = C.BlockTypes, P = C.PhysicsBlocks;

// 既有无头渲染桩不保存 UV；仅填补绘制依赖，不替代任何游戏行为。
if (!Object.getOwnPropertyDescriptor(BufferGeometry.prototype, 'attributes')) {
    Object.defineProperty(BufferGeometry.prototype, 'attributes', {
        configurable: true,
        get() { return this.__attrs; },
        set(v) { if (v && !v.uv) v.uv = new BufferAttribute(new Float32Array(48), 2); this.__attrs = v; },
    });
}
BufferAttribute.prototype.setXY ??= function (i, x, y) {
    this.array[i * this.itemSize] = x; this.array[i * this.itemSize + 1] = y; return this;
};

function setup() {
    freshWorld();
    state.levelRun = state.levelEdit = null;
    state.physicsPanel = null;
    state.player.selectedSlot = 0;
    state.saveSlot = 5;
    initPhysicsLab();
}
function configured(x, y, z, patch) {
    const result = configurePhysicsAt(x, y, z, patch);
    assert.equal(result?.ok, true, result?.error || JSON.stringify(result));
}
function act(x, y, z, action) {
    const result = physicsActionAt(x, y, z, action);
    assert.equal(result?.ok, true, result?.error || JSON.stringify(result));
}
function advance(seconds, hz = 120) {
    for (let frame = 0; frame < Math.round(seconds * hz); frame++) {
        const dt = 1 / hz;
        updateTnt(dt);
        updateRedstoneTick(dt);
        K.updateKineticTick(dt);
        tickPhysicsLab(dt);
        state.time += dt;
    }
}
const info = (x, y, z) => physicsInfoAt(x, y, z);
const offset = p => info(p.x, p.y, p.z)?.config?.offset;
const rpm = (x, y, z) => K.kineticInfoAt(x, y, z)?.rpm || 0;
function idsInColumn(x, z, id) {
    const rows = [];
    for (let y = 0; y < C.WORLD_HEIGHT; y++) if (at(x, y, z) === id) rows.push(y);
    return rows;
}
function waterInColumn(x, z) { return idsInColumn(x, z, B.WATER).length; }
function platformCells(p) {
    const result = [];
    for (let x = p.x; x <= Math.min(C.WORLD_WIDTH - 1, p.x + 8); x++) {
        for (let z = p.z - 1; z <= p.z + 1; z++) {
            if (at(x, p.y + 1, z) === C.PLATFORM_BASE) result.push([x, p.y + 1, z]);
        }
    }
    return result;
}
function carriage({ x = 40, y = 9, z = 40, length = 4 } = {}) {
    for (let xx = x; xx <= Math.min(x + length, C.WORLD_WIDTH - 1); xx++) {
        for (let zz = z - 1; zz <= z + 1; zz++) setB(xx, y, zz, B.STONE);
    }
    setB(x - 2, y, z, C.waterwheelId(C.AXIS_X));
    setB(x - 2, y + 1, z, B.WATER);
    setB(x - 1, y, z, C.shaftId(C.AXIS_X));
    setB(x, y, z, P.CARRIAGE);
    for (let zz = z - 1; zz <= z + 1; zz++) setB(x, y + 1, zz, C.PLATFORM_BASE);
    initPhysicsLab();
    configured(x, y, z, { dir: 1, width: 3, length, offset: 0 });
    updateRedstoneNetwork(); K.updateKineticNetwork();
    return { x, y, z, length };
}
function riderOn(p) {
    // 身体横跨两块平台的接缝，检查整组乘客去重。
    Object.assign(state.player, { x: p.x + 0.5, y: p.y + 2, z: p.z,
        vx: 0, vy: 0, vz: 0, onGround: true, flying: false });
    return { x: state.player.x, y: state.player.y, z: state.player.z };
}
function windmill() {
    setB(40, 9, 40, P.WINDMILL);
    setB(40, 8, 40, C.shaftId(C.AXIS_Y));
    setB(41, 8, 40, C.beltId(1));
    initPhysicsLab(); K.updateKineticNetwork();
}

for (const hz of [30, 60, 120]) test(`A01：三格宽平台在 ${hz}Hz 载边缘乘客到端点并由红石回程`, () => {
    setup(); const p = carriage(), rider = riderOn(p);
    assert.equal(rpm(p.x, p.y, p.z), 8, '真水车与轴供能');
    assert.equal(K.kineticInfoAt(p.x, p.y, p.z)?.load, 56, '32驱动 + 三个平台各8SU');
    advance(5, hz);
    assert.equal(offset(p), p.length);
    assert.deepEqual(platformCells(p), [-1, 0, 1].map(dz => [p.x + p.length, p.y + 1, p.z + dz]));
    assert.equal(state.player.x, rider.x + p.length, '跨接缝乘客只平移一次');
    assert.equal(state.player.y, rider.y);
    assert.equal(state.player.z, rider.z);
    // 放在驱动器正下方，避免替换三格宽轨道的侧边地板。
    setB(p.x, p.y - 1, p.z, C.leverId(0, 1));
    updateRedstoneNetwork();
    advance(5, hz);
    assert.equal(offset(p), 0);
    assert.deepEqual(platformCells(p), [-1, 0, 1].map(dz => [p.x, p.y + 1, p.z + dz]));
    assert.equal(state.player.x, rider.x);
});

test('A01：三格目的足迹仅一格有墙也整体停机，撤墙后恢复', () => {
    setup(); const p = carriage(), rider = riderOn(p);
    setB(p.x + 1, p.y + 1, p.z + 1, B.STONE);
    advance(2);
    assert.equal(offset(p), 0); assert.equal(state.player.x, rider.x);
    assert.equal(platformCells(p).length, 3, '不能部分移动或丢平台');
    setB(p.x + 1, p.y + 1, p.z + 1, B.AIR);
    advance(2);
    assert.ok(offset(p) > 0); assert.equal(platformCells(p).length, 3);
    assert.equal(state.player.x - rider.x, offset(p));
});

test('A01：平台前方低顶先挡住乘客扫掠，不能把人推进墙', () => {
    setup(); const p = carriage(), rider = riderOn(p);
    setB(p.x + 1, p.y + 3, p.z, B.STONE);
    advance(2);
    assert.equal(offset(p), 0); assert.equal(state.player.x, rider.x);
    setB(p.x + 1, p.y + 3, p.z, B.AIR);
    advance(2);
    assert.ok(offset(p) > 0); assert.equal(state.player.x - rider.x, offset(p));
});

test('A01：前方站在导轨地板上的旁观者挡停整组，不被当乘客推走', () => {
    setup(); const p = carriage(), rider = riderOn(p);
    const bystander = { x: p.x + 1.5, y: p.y + 1, z: p.z + 0.5,
        hp: 20, vx: 0, vy: 0, vz: 0, onGround: true };
    state.enemies.push(bystander);
    advance(2);
    assert.equal(offset(p), 0); assert.equal(state.player.x, rider.x);
    assert.equal(bystander.x, p.x + 1.5); assert.equal(bystander.y, p.y + 1);
    state.enemies.length = 0;
    advance(2);
    assert.ok(offset(p) > 0);
});

test('A01：断动力悬停、恢复续走，平台数量始终守恒', () => {
    setup(); const p = carriage(); riderOn(p);
    advance(1.2); const stopped = offset(p), px = state.player.x;
    assert.ok(stopped > 0 && stopped < p.length);
    setB(p.x - 2, p.y + 1, p.z, B.AIR); K.updateKineticNetwork();
    advance(2);
    assert.equal(offset(p), stopped); assert.equal(state.player.x, px);
    assert.equal(platformCells(p).length, 3);
    setB(p.x - 2, p.y + 1, p.z, B.WATER); K.updateKineticNetwork();
    advance(4);
    assert.equal(offset(p), p.length); assert.equal(platformCells(p).length, 3);
});

test('A01：最后合法世界列可作行程端点，越界参数拒绝且不改现有配置', () => {
    setup(); const p = carriage({ x: C.WORLD_WIDTH - 5 }); riderOn(p);
    const before = structuredClone(info(p.x, p.y, p.z).config);
    assert.ok(configurePhysicsAt(p.x, p.y, p.z, { length: 8 })?.error);
    assert.deepEqual(info(p.x, p.y, p.z).config, before);
    advance(6);
    assert.equal(offset(p), 4);
    assert.deepEqual(platformCells(p), [-1, 0, 1].map(dz => [C.WORLD_WIDTH - 1, p.y + 1, p.z + dz]));
    assert.ok(state.player.x + C.PLAYER_WIDTH / 2 < C.WORLD_WIDTH);
});

test('A01/S01：中途普通存读保存真实偏移与三块足迹，读后继续同方向', () => {
    setup(); const p = carriage(); riderOn(p);
    advance(2.1); const savedOffset = offset(p), savedCells = platformCells(p);
    assert.ok(savedOffset > 0 && savedOffset < p.length);
    assert.equal(saveGame(), true);
    advance(2);
    assert.equal(loadGame(5), true);
    assert.equal(offset(p), savedOffset); assert.deepEqual(platformCells(p), savedCells);
    advance(3);
    assert.equal(offset(p), p.length); assert.equal(platformCells(p).length, 3);
});

test('A01/S01：篡改移动平台偏移的存档拒绝导入，保留当前槽与世界', () => {
    setup(); const p = carriage(); advance(1.2);
    assert.equal(saveGame(), true);
    const original = exportSlotJson(5), raw = JSON.parse(original), blocks = state.blocks;
    const device = raw.physics?.devices?.[`${p.x},${p.y},${p.z}`];
    assert.ok(device, '存档必须保留驱动器配置');
    device.config.offset = 999;
    assert.equal(typeof importSlotJson(JSON.stringify(raw), 5), 'string');
    assert.equal(exportSlotJson(5), original);
    assert.equal(state.blocks, blocks);
});

test('A02：开阔风车固定Y轴8RPM/64SU，真实驱动轴与传送带', () => {
    setup(); windmill();
    assert.equal(rpm(40, 9, 40), 8); assert.equal(rpm(40, 8, 40), 8);
    assert.equal(rpm(41, 8, 40), 8);
    assert.equal(K.kineticInfoAt(40, 9, 40)?.capacity, 64);
    assert.equal(K.kineticInfoAt(40, 9, 40)?.load, C.BELT_SU_LOAD);
    assert.equal(K.beltSpeedAt(41, 8, 40), C.BELT_SPEED);
});

test('A02：普通石块在遮挡体积角落加挡撤挡均更新供能，体积外不影响', () => {
    setup(); windmill();
    setB(43, 12, 42, B.STONE); advance(0.1);
    assert.equal(rpm(41, 8, 40), 8, 'x距离3在监视体积外');
    setB(42, 12, 42, B.STONE); advance(0.1);
    assert.equal(rpm(41, 8, 40), 0, '不手动重算也应检测普通石头写入');
    setB(42, 12, 42, B.AIR); advance(0.1);
    assert.equal(rpm(41, 8, 40), 8, '石头移除同样触发重新开阔');
    setB(40, 10, 40, B.STONE); advance(0.1);
    assert.equal(rpm(41, 8, 40), 0, '正上方第一格也在遮挡体积内');
});

test('A02：风车应力超载停网，拆除负载后恢复', () => {
    setup(); windmill();
    for (let x = 42; x <= 57; x++) setB(x, 8, 40, C.beltId(1));
    K.updateKineticNetwork();
    assert.equal(rpm(40, 9, 40), 0);
    assert.match(K.kineticStatusAt(40, 9, 40), /应力|过载/);
    for (let x = 42; x <= 57; x++) setB(x, 8, 40, B.AIR);
    K.updateKineticNetwork();
    assert.equal(rpm(41, 8, 40), 8);
});

for (const hz of [30, 60, 120]) test(`A03：实验落块在 ${hz}Hz 落地守恒，旧沙砾与旧TNT保持悬空`, () => {
    setup();
    setB(90, 16, 90, P.FALLING);
    setB(92, 16, 90, B.SAND); setB(94, 16, 90, B.GRAVEL); setB(96, 16, 90, B.TNT);
    initPhysicsLab(); advance(3, hz);
    assert.deepEqual(idsInColumn(90, 90, P.FALLING), [9]);
    assert.equal(at(92, 16, 90), B.SAND);
    assert.equal(at(94, 16, 90), B.GRAVEL);
    assert.equal(at(96, 16, 90), B.TNT);
});

test('A03：普通水交换不吞水，实验落块仍可落至水下地面', () => {
    setup(); setB(90, 16, 90, P.FALLING); setB(90, 10, 90, B.WATER);
    initPhysicsLab(); const water = waterInColumn(90, 90);
    advance(4);
    assert.equal(waterInColumn(90, 90), water);
    assert.deepEqual(idsInColumn(90, 90, P.FALLING), [9]);
});

test('A03/W01：湿槽挡住落块，不能交换或消失容器及水量', () => {
    setup(); setB(90, 16, 90, P.FALLING); setB(90, 10, 90, C.troughId(4));
    initPhysicsLab(); advance(3);
    assert.equal(at(90, 10, 90), C.troughId(4));
    assert.deepEqual(idsInColumn(90, 90, P.FALLING), [11]);
    assert.equal(C.troughWater(at(90, 10, 90)), 4);
});

test('A03：落块遇玩家身体停落，玩家离开后恢复落地', () => {
    setup(); setB(90, 16, 90, P.FALLING);
    Object.assign(state.player, { x: 90.5, y: 9, z: 90.5, flying: false, onGround: true });
    initPhysicsLab(); advance(3);
    const blocked = idsInColumn(90, 90, P.FALLING);
    assert.equal(blocked.length, 1);
    assert.ok(blocked[0] >= Math.ceil(state.player.y + C.PLAYER_HEIGHT));
    assert.equal(state.player.y, 9, '不能通过推挪玩家来解埋');
    state.player.x = 3.5; state.player.z = 3.5;
    advance(3);
    assert.deepEqual(idsInColumn(90, 90, P.FALLING), [9]);
});

test('A03：世界底部没有支撑也不能把实验落块移出界', () => {
    setup(); setB(20, 2, 20, P.FALLING);
    initPhysicsLab(); advance(3);
    assert.deepEqual(idsInColumn(20, 20, P.FALLING), [0]);
});

test('A03/S01：运动TNT随落点迁配置，普通存读保留剩余引信并在现址爆炸', () => {
    setup(); setB(110, 20, 110, P.MOTION_TNT);
    setB(111, 20, 110, B.BRICK); setB(111, 9, 110, B.BRICK);
    initPhysicsLab(); act(110, 20, 110, 'ignite'); advance(1.8);
    const rows = idsInColumn(110, 110, P.MOTION_TNT);
    assert.equal(rows.length, 1); assert.equal(rows[0], 9);
    const current = info(110, rows[0], 110);
    assert.equal(current?.config?.armed, true);
    assert.ok(current.config.fuse > 0.5 && current.config.fuse < 0.9);
    const savedFuse = current.config.fuse;
    assert.equal(info(110, 20, 110), null, '旧坐标不能残留点燃实例');
    assert.equal(saveGame(), true);
    assert.equal(loadGame(5), true);
    assert.ok(Math.abs(info(110, 9, 110).config.fuse - savedFuse) < 1e-8);
    advance(1);
    assert.deepEqual(idsInColumn(110, 110, P.MOTION_TNT), []);
    assert.equal(at(111, 9, 110), B.AIR, '爆炸在当前落点');
    assert.equal(at(111, 20, 110), B.BRICK, '原始高处不发生幽灵爆炸');
    assert.ok(!Object.values(capturePhysicsState().devices).some(d => d.id === P.MOTION_TNT));
});

test('A03/S01：临近引爆的运动TNT热重载不重置计时，也不重复爆炸', () => {
    setup(); setB(110, 9, 110, P.MOTION_TNT); setB(111, 9, 110, B.BRICK);
    initPhysicsLab(); act(110, 9, 110, 'ignite'); advance(2.45);
    const remaining = info(110, 9, 110).config.fuse;
    assert.ok(remaining > 0 && remaining < 0.1);
    assert.equal(saveSnapshotForReload(), true);
    assert.equal(restoreSnapshotIfAny(), true);
    assert.ok(Math.abs(info(110, 9, 110).config.fuse - remaining) < 1e-8);
    advance(0.2);
    assert.equal(at(110, 9, 110), B.AIR); assert.equal(at(111, 9, 110), B.AIR);
    setB(111, 9, 110, B.BRICK); advance(1);
    assert.equal(at(111, 9, 110), B.BRICK, '旧点燃实例已清理，不能第二次爆炸');
});

test('A03：原TNT点燃后仍在原格倒计时，新运动规则不迁移旧TNT', () => {
    setup(); setB(110, 20, 110, B.TNT);
    initPhysicsLab(); spawnTntEntity(110, 20, 110); advance(1);
    assert.equal(at(110, 20, 110), B.TNT);
    assert.deepEqual(idsInColumn(110, 110, B.TNT), [20]);
    assert.equal(state.tntEntities.length, 1);
});

test('G3-A01：运行途中拆掉一块宽平台后仍能保存整个普通世界', () => {
    setup(); const p = carriage(); advance(2.1);
    const current = offset(p);
    assert.ok(current > 0 && current < p.length);
    setB(p.x + current, p.y + 1, p.z + 1, B.AIR);
    advance(0.1);
    assert.equal(saveGame(), true, '合法挖掉平台不能让整个存档永久校验失败');
    assert.equal(loadGame(5), true);
    assert.equal(platformCells(p).length, 2, '保存修复不能凭空补回被挖掉的平台');
});

test('G3-A01：平台离开后顶部红石粉按既有支撑规则脱落', () => {
    setup(); const p = carriage();
    setB(p.x, p.y + 2, p.z + 1, C.DUST_ITEM_ID); updateRedstoneNetwork();
    advance(1.2);
    assert.equal(offset(p), 1);
    assert.equal(at(p.x, p.y + 2, p.z + 1), B.AIR, '不能留下失去平台支撑的浮空红石');
});

test('G3-A03：实验落块离开后顶部红石粉也必须失去支撑', () => {
    setup(); setB(90, 16, 90, P.FALLING); setB(90, 17, 90, C.DUST_ITEM_ID);
    initPhysicsLab(); updateRedstoneNetwork(); advance(3);
    assert.deepEqual(idsInColumn(90, 90, P.FALLING), [9]);
    assert.equal(at(90, 17, 90), B.AIR, '落块不能在高处留下浮空红石粉');
});

test('G3-S01：非TNT实验不能通过armed布尔字段绕过配置白名单', () => {
    setup(); setB(90, 9, 90, P.RAMP); initPhysicsLab();
    const raw = capturePhysicsState();
    raw.devices['90,9,90'].config.armed = true;
    assert.equal(typeof validatePhysicsState(raw, state.blocks), 'string');
});

test('G3-S01：导入缺字段的实验配置应拒绝或补齐默认值，不能产生NaN', () => {
    setup(); setB(90, 9, 90, P.RAMP); initPhysicsLab();
    assert.equal(saveGame(), true);
    const original = exportSlotJson(5), raw = JSON.parse(original);
    raw.physics.devices['90,9,90'].config = {};
    const result = importSlotJson(JSON.stringify(raw), 5);
    if (typeof result === 'string') {
        assert.equal(exportSlotJson(5), original); return;
    }
    assert.equal(result, null); assert.equal(loadGame(5), true);
    act(90, 9, 90, 'start'); advance(0.2);
    const readout = info(90, 9, 90);
    for (const key of ['distance', 'velocity', 'height']) assert.equal(Number.isFinite(readout[key]), true, `${key}不能变NaN`);
});

test('G3-E：复位不应把持续高电平误判成新的启动上升沿', () => {
    setup(); setB(90, 9, 90, P.RAMP); setB(91, 9, 90, C.leverId(0, 0));
    initPhysicsLab(); updateRedstoneNetwork(); advance(1 / 120);
    setB(91, 9, 90, C.leverId(0, 1)); updateRedstoneNetwork(); advance(0.1);
    assert.equal(info(90, 9, 90).running, true, '第一次供电确实自动启动');
    act(90, 9, 90, 'reset'); advance(0.1);
    assert.equal(info(90, 9, 90).running, false, '复位后没有新的供电边沿，保持就绪');
    setB(91, 9, 90, C.leverId(0, 0)); updateRedstoneNetwork(); advance(0.1);
    setB(91, 9, 90, C.leverId(0, 1)); updateRedstoneNetwork(); advance(0.1);
    assert.equal(info(90, 9, 90).running, true, '新的上升沿仍可重新启动');
});

test('G3-P01：风扇不能绕过32台活动实验上限启动第33台坡台', () => {
    setup(); const benches = [];
    for (let i = 0; i < C.PHYSICS.maxRunning; i++) {
        const cell = [40 + (i % 8) * 3, 9, 40 + Math.floor(i / 8) * 3];
        setB(...cell, P.RAMP); benches.push(cell);
    }
    setB(90, 9, 90, P.FAN); setB(91, 9, 90, P.RAMP);
    setB(88, 9, 90, C.waterwheelId(C.AXIS_X)); setB(88, 10, 90, B.WATER);
    setB(89, 9, 90, C.shaftId(C.AXIS_X));
    initPhysicsLab(); K.updateKineticNetwork();
    assert.equal(rpm(90, 9, 90), 8);
    for (const cell of benches) act(...cell, 'start');
    advance(1 / 120);
    const running = [...benches, [91, 9, 90]].filter(cell => info(...cell).running).length;
    assert.ok(running <= C.PHYSICS.maxRunning, `上限32，实际${running}台运行`);
});

test('G3/S02：拆除最后一个红石源必须清除新物理负载的供能缓存', () => {
    setup();setB(40,9,40,P.VALVE);setB(40,9,41,C.leverId(0,1));
    updateRedstoneNetwork();assert.equal(redstoneSignalAt(40,9,40),true);
    setB(40,9,41,B.AIR);updateRedstoneNetwork();
    assert.equal(redstoneSignalAt(40,9,40),false);
});

test('G3/S02：边界装置不能读取相邻行折返的远处信号', () => {
    setup();setB(0,9,20,P.VALVE);setB(255,9,19,C.leverId(0,1));
    updateRedstoneNetwork();
    assert.equal(redstoneSignalAt(0,9,20),false);
});

test('G3/A03：实验落块移走水车顶水后，真实动力网立即停机', () => {
    setup();setB(90,9,90,C.waterwheelId(C.AXIS_X));setB(90,10,90,B.WATER);
    setB(90,14,90,P.FALLING);initPhysicsLab();K.updateKineticNetwork();
    assert.equal(K.kineticInfoAt(90,9,90).rpm,8);
    advance(3);
    assert.equal(at(90,10,90),P.FALLING);
    assert.equal(at(90,11,90),B.WATER,'水量交换保留在落块旧位置');
    assert.equal(K.kineticInfoAt(90,9,90).rpm,0);
});

test('G3/L01：不同位置反复建拆风车不会残留风力缓存', () => {
    setup();
    for(let i=0;i<5;i++) {
        setB(100+i,9,100,P.WINDMILL);tickPhysicsLab(1/120);
        setB(100+i,9,100,B.AIR);tickPhysicsLab(1/120);
        assert.equal(physicsDiagnostics().windLevels,0);
        assert.equal(physicsDiagnostics().cells,0);
    }
});

test('G3/E05：带的邻接不能绕过风扇、水泵、宽平台的后接口', () => {
    for(const id of [P.FAN,P.PUMP,P.CARRIAGE]) {
        setup();setB(40,9,40,id);setB(41,9,40,C.beltId(1));
        setB(42,9,40,C.waterwheelId(C.AXIS_X));setB(42,10,40,B.WATER);
        initPhysicsLab();K.updateKineticNetwork();
        assert.equal(K.kineticInfoAt(40,9,40).rpm,0,`${id}正面有带不能充当背后传动`);
    }
});

test('G3/A03：落块封住红石下坡通路后，真实主循环立即更新灯与信号', () => {
    setup();setB(49,10,50,B.STONE);setB(50,10,50,B.STONE);setB(51,9,50,B.STONE);
    setB(49,11,50,C.leverId(0,1));setB(50,11,50,C.DUST_ITEM_ID);setB(51,10,50,C.DUST_ITEM_ID);setB(52,10,50,C.lampId(0));
    setB(51,12,50,P.FALLING);initPhysicsLab();updateRedstoneNetwork();
    assert.equal(C.lampLit(at(52,10,50)),1);
    advance(1);
    assert.equal(at(51,11,50),P.FALLING);
    assert.equal(C.lampLit(at(52,10,50)),0,'不能等待下一次玩家手动触发网络才熄灯');
});

test('G3/S01：导出旗标区域截断运动中平台时返回明确错误', async () => {
    setup();const p=carriage();advance(4.1);assert.equal(offset(p),4);
    setB(p.x,8,p.z,C.flagId(C.FLAG_START));setB(p.x+1,8,p.z,C.flagId(C.FLAG_GOAL));
    const result=await buildLevelCard({name:'截断平台',author:'QA',lockMetaProvider:()=>null});
    assert.match(result.error,/完整装置与当前平台/);
});

test('G3/A02：实心实验台直接换风车后，普通遮挡写入仍能触发停转与恢复', () => {
    setup();setB(40,12,40,P.RAMP);tickPhysicsLab(1/120);
    setB(40,12,40,P.WINDMILL);setB(40,11,40,C.shaftId(C.AXIS_Y));K.updateKineticNetwork();tickPhysicsLab(1/120);
    assert.equal(physicsDiagnostics().windLevels,1);
    assert.equal(K.kineticInfoAt(40,12,40).rpm,8);
    setB(40,13,40,B.STONE);tickPhysicsLab(1/120);
    assert.equal(K.kineticInfoAt(40,12,40).rpm,0);
    setB(40,13,40,B.AIR);tickPhysicsLab(1/120);
    assert.equal(K.kineticInfoAt(40,12,40).rpm,8);
});

test('G3/A02：床另一半被覆盖而连带清除风车范围内床半，也刷新遮挡', () => {
    setup();setB(40,12,40,P.WINDMILL);setB(40,11,40,C.shaftId(C.AXIS_Y));
    setB(42,12,40,B.STONE);setB(43,12,40,B.STONE);
    setB(42,13,40,C.bedId(0,1));setB(43,13,40,C.bedId(1,1));
    K.updateKineticNetwork();tickPhysicsLab(1/120);
    assert.equal(K.kineticInfoAt(40,12,40).rpm,0);
    setB(43,13,40,B.STONE);tickPhysicsLab(1/120);
    assert.equal(at(42,13,40),B.AIR,'双格床旧足被连带清理');
    assert.equal(physicsWindOpenAt(40,12,40),true);
    assert.equal(K.kineticInfoAt(40,12,40).rpm,8);
});
