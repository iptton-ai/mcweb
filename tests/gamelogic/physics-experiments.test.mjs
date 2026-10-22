// 独立验收：仅依据 physics-rest-plan 的模型契约和公开 API，不读取求解器实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry } from 'three';
import { freshWorld, state, setB } from './kit.mjs';
import {
    BlockTypes, GameModes, PHYSICS, PhysicsBlocks, beltId, shaftId, waterwheelId,
} from '../../js/config.js';
import {
    initPhysicsLab, tickPhysicsLab, samplePhysicsSensors, configurePhysicsAt, physicsActionAt, physicsInfoAt,
} from '../../js/physicsLab.js';
import { setState } from '../../js/uiModal.js';
import { updatePlayerPhysics } from '../../js/playerPhysics.js';
import { keys } from '../../js/input.js';
import { spawnItemDrop, updateItemDrops } from '../../js/items.js';
import { kineticInfoAt, updateKineticNetwork } from '../../js/kinetic.js';
import { buildPhysicsMesh } from '../../js/physicsModels.js';

// 与既有 kinetic-cross 用例相同的纯渲染桩补齐；不替换掉落物或风力逻辑。
if (!Object.getOwnPropertyDescriptor(BufferGeometry.prototype, 'attributes')) {
    Object.defineProperty(BufferGeometry.prototype, 'attributes', {
        configurable:true,
        get() { return this.__attrs; },
        set(value) {
            if (value && !value.uv) value.uv = new BufferAttribute(new Float32Array(48), 2);
            this.__attrs = value;
        },
    });
}
BufferAttribute.prototype.setXY ||= function (i, x, y) {
    this.array[i * this.itemSize] = x;
    this.array[i * this.itemSize + 1] = y;
    return this;
};

const CELL = [30, 9, 30];
const near = (actual, expected, tolerance = 1e-7, message = '') => {
    assert.ok(Number.isFinite(actual), `${message}：读数必须有限，实际 ${actual}`);
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${message}：期望 ${expected} ± ${tolerance}，实际 ${actual}`);
};
const info = () => {
    const value = physicsInfoAt(...CELL);
    assert.ok(value, '已放置装置应可查询');
    return value;
};
const act = action => {
    const result = physicsActionAt(...CELL, action);
    assert.equal(result?.ok, true, `${action} 应成功：${JSON.stringify(result)}`);
    return result;
};
const configure = patch => {
    const result = configurePhysicsAt(...CELL, patch);
    assert.equal(result?.ok, true, `配置应成功：${JSON.stringify(result)}`);
};
function setup(id, patch = {}) {
    freshWorld();
    state.levelRun = state.levelEdit = null;
    state.inputMode = 'keyboard';
    state.camMode = 'player';
    state.windowUnfocused = false;
    state.helpDocOpen = state.questionBankOpen = state.authorPanelOpen = false;
    state.prefabPickerOpen = state.levelExportOpen = state.recordingControlsOpen = false;
    state.player.inventory = { [BlockTypes.PLANKS]:7, [BlockTypes.STONE]:3 };
    for (const key of Object.keys(keys)) keys[key] = false;
    setState('playing');
    setB(...CELL, id);
    initPhysicsLab();
    configure(patch);
}
function advance(seconds, hz = 60, sample = () => {}) {
    const frames = Math.round(seconds * hz);
    for (let frame = 0; frame < frames; frame++) {
        tickPhysicsLab(1 / hz);
        sample(physicsInfoAt(...CELL));
    }
}
function rampTrial(surface, hz = 60, patch = {}) {
    setup(PhysicsBlocks.RAMP, { mass:1, slope:1, surface, ...patch });
    act('start');
    advance(8, hz);
    return { ...info() };
}
function springPeak(compression, hz = 120, patch = {}) {
    setup(PhysicsBlocks.SPRING, { mass:1, compression, ...patch });
    act('compress');
    act('start');
    let peak = 0;
    advance(3, hz, current => { peak = Math.max(peak, current?.height || 0); });
    return { peak, final:{ ...info() } };
}
function pulleyTrial(ropes, hz = 60) {
    setup(PhysicsBlocks.TEACHING_PULLEY, { mass:2, ropes, travel:1 });
    act('start');
    advance(12, hz);
    return { ...info() };
}

test('E01：同起点三档摩擦得到光滑最远、粗糙最近，且物体不越实验轨道', () => {
    const results = [0, 1, 2].map(surface => rampTrial(surface));
    assert.ok(results[0].distance > results[1].distance + .05, '光滑面的滑行距离更远');
    assert.ok(results[1].distance > results[2].distance + .05, '粗糙面的滑行距离更短');
    for (const result of results) {
        assert.ok(result.distance >= 0 && result.distance <= PHYSICS.trackLength + 1e-7);
        near(result.velocity, 0, 1e-7, '停止后的速度');
    }
});

for (const surface of [0, 1, 2]) test(`E01：摩擦档 ${surface} 在30/60/120Hz结果一致`, () => {
    const results = [30, 60, 120].map(hz => rampTrial(surface, hz));
    for (const result of results.slice(1)) {
        near(result.distance, results[0].distance, 1e-7, '同一条件滑行距离');
        near(result.velocity, results[0].velocity, 1e-7, '同一条件末速度');
        assert.equal(result.running, results[0].running);
    }
});

test('E01：水平面从静止开始不会无输入自行加速', () => {
    setup(PhysicsBlocks.RAMP, { mass:2, slope:0, surface:0 });
    act('start');
    advance(4);
    near(info().distance, 0, 1e-9);
    near(info().velocity, 0, 1e-9);
});

test('E01：仅改变标准物体质量不会改变同一斜坡的摩擦滑行距离', () => {
    const light = rampTrial(1, 60, { mass:1 });
    const heavy = rampTrial(1, 60, { mass:4 });
    near(heavy.distance, light.distance, 1e-7, '重力与摩擦均正比于质量');
});

test('E01：一键复位可重复相同实验，不增加背包或真实掉落物', () => {
    setup(PhysicsBlocks.RAMP, { mass:2, slope:1, surface:1 });
    const inventory = structuredClone(state.player.inventory);
    const drops = state.itemDrops.length;
    act('start');
    advance(8);
    const distance = info().distance;
    for (let round = 0; round < 5; round++) {
        act('reset');
        near(info().distance, 0);
        near(info().velocity, 0);
        act('start');
        advance(8);
        near(info().distance, distance, 1e-7, '复位后的结果可重复');
    }
    assert.deepEqual(state.player.inventory, inventory);
    assert.equal(state.itemDrops.length, drops);
});

test('E02：等质量等力臂的杠杆保持平衡', () => {
    setup(PhysicsBlocks.LEVER, { pivot:2, leftMass:2, rightMass:2, leftArm:1, rightArm:1 });
    act('start');
    advance(2);
    near(info().torque, 0);
    near(info().angle, 0);
});

test('E02：交换左右负载会同时反转转矩与倾斜', () => {
    setup(PhysicsBlocks.LEVER, { pivot:2, leftMass:1, rightMass:3, leftArm:1, rightArm:1 });
    act('start');
    advance(2);
    const rightHeavy = { ...info() };
    assert.ok(Math.abs(rightHeavy.torque) > 0 && Math.abs(rightHeavy.angle) > 0);
    near(rightHeavy.torque, 2 * PHYSICS.gravity, 1e-7, '右侧净多2份单位力矩');
    configure({ leftMass:3, rightMass:1 });
    act('start');
    advance(2);
    const leftHeavy = info();
    near(leftHeavy.torque, -rightHeavy.torque, 1e-7, '交换负载反转转矩');
    near(leftHeavy.angle, -rightHeavy.angle, 1e-7, '交换负载反转倾斜');
});

test('E02：两倍质量配半长力臂可平衡，单改力臂即可打破平衡', () => {
    setup(PhysicsBlocks.LEVER, { pivot:2, leftMass:2, rightMass:1, leftArm:1, rightArm:2 });
    act('start');
    advance(2);
    near(info().torque, 0);
    near(info().angle, 0);
    configure({ leftArm:2 });
    act('start');
    advance(2);
    assert.ok(Math.abs(info().torque) > 0);
    assert.ok(Math.abs(info().angle) > 0);
});

test('E02：移动支点改变转矩，左右对称的支点位置得到相反结果', () => {
    setup(PhysicsBlocks.LEVER, { pivot:2, leftMass:1, rightMass:1, leftArm:2, rightArm:2 });
    act('start');
    advance(1);
    near(info().torque, 0);
    configure({ pivot:1 });
    act('start');
    advance(2);
    const leftPivot = { ...info() };
    assert.ok(Math.abs(leftPivot.torque) > 0);
    near(leftPivot.torque, 2 * PHYSICS.gravity, 1e-7, '槽0/4、支点1的净力矩');
    configure({ pivot:3 });
    act('start');
    advance(2);
    near(info().torque, -leftPivot.torque, 1e-7, '对称支点反转转矩');
    near(info().angle, -leftPivot.angle, 1e-7, '对称支点反转倾斜');
});

test('E02：虚拟砝码与杠杆不搬动台上的玩家，不变成可拾取物品', () => {
    setup(PhysicsBlocks.LEVER, { pivot:2, leftMass:4, rightMass:0, leftArm:2, rightArm:1 });
    Object.assign(state.player, { x:CELL[0] + .5, y:CELL[1] + 1.001, z:CELL[2] + .5 });
    const playerPosition = [state.player.x, state.player.y, state.player.z];
    const inventory = structuredClone(state.player.inventory);
    act('start');
    advance(2);
    assert.ok(Math.abs(info().angle) > 0);
    assert.deepEqual([state.player.x, state.player.y, state.player.z], playerPosition);
    assert.deepEqual(state.player.inventory, inventory);
    assert.equal(state.itemDrops.length, 0);
});

test('E03：未压缩的弹簧不能直接弹射', () => {
    setup(PhysicsBlocks.SPRING, { mass:1, compression:3 });
    physicsActionAt(...CELL, 'start');
    let peak = 0;
    advance(3, 120, current => { peak = Math.max(peak, current?.height || 0); });
    near(peak, 0, 1e-9);
    near(info().velocity, 0, 1e-9);
});

test('E03：手动压缩3档比1档弹高，且更重物体的弹高更低', () => {
    const low = springPeak(1).peak;
    const high = springPeak(3).peak;
    const heavy = springPeak(3, 120, { mass:4 }).peak;
    assert.ok(low > 0, '第一档也应真实弹起');
    assert.ok(high > low, '高档输入更多能量');
    assert.ok(heavy > 0 && heavy < high, '同能量提升较重物体的高度更低');
});

test('E03：释放后反复按开始不会凭空恢复压缩能量', () => {
    springPeak(3);
    near(info().height, 0, 1e-7, '物体已落回起点');
    let peak = 0;
    for (let frame = 0; frame < 240; frame++) {
        physicsActionAt(...CELL, 'start');
        tickPhysicsLab(1 / 120);
        peak = Math.max(peak, info().height);
    }
    near(peak, 0, 1e-9, '无额外压缩做功不能再次起飞');
});

test('E03：复位清除已手动储存的弹簧能量', () => {
    setup(PhysicsBlocks.SPRING, { mass:1, compression:3 });
    act('compress');
    act('reset');
    physicsActionAt(...CELL, 'start');
    let peak = 0;
    advance(3, 120, current => { peak = Math.max(peak, current?.height || 0); });
    near(peak, 0, 1e-9, '复位只归位，不自动做功');
});

test('E03：弹簧在30/60/120Hz的峰值与落地状态一致', () => {
    const results = [30, 60, 120].map(hz => springPeak(3, hz));
    // 各频率的观测采样不同；允许一个30Hz采样窗造成的峰值遗漏。
    for (const result of results.slice(1)) {
        near(result.peak, results[0].peak, PHYSICS.gravity / (2 * 30 ** 2) + .002, '弹道峰值');
        near(result.final.height, results[0].final.height, 1e-7, '落地高度');
        near(result.final.velocity, results[0].final.velocity, 1e-7, '落地速度');
    }
});

test('E03：外部低顶实际限制弹射高度，碰顶不能穿过或再次增能', () => {
    const openPeak = springPeak(3).peak;
    assert.ok(openPeak > 1.1, '最高档必须能触达低顶，保证此场景确实测到碰撞');
    setup(PhysicsBlocks.SPRING, { mass:1, compression:3 });
    setB(CELL[0], CELL[1] + 1, CELL[2], BlockTypes.STONE);
    act('compress');
    act('start');
    let peak = 0;
    advance(3, 120, current => {
        assert.ok(current.height <= 1 + 1e-7, '低顶行程限1，任何子帧都不能穿越');
        peak = Math.max(peak, current.height);
    });
    assert.ok(peak > .9 && peak < openPeak, '真实触顶，且峰值低于开放场地');
    const before = info().height;
    physicsActionAt(...CELL, 'start');
    advance(1, 120, current => {
        assert.ok(current.height <= Math.max(1, before) + 1e-7, '重复开始不能冲破低顶');
    });
});

test('E04：三种教学滑轮提升相同高度，拉力与费距离同步体现1/2/4倍率', () => {
    const results = [0, 1, 2].map(ropes => pulleyTrial(ropes));
    for (const [index, result] of results.entries()) {
        const ropes = PHYSICS.ropeCounts[index];
        near(result.height, 1, 1e-7, '同一提升行程');
        near(result.force, 2 * PHYSICS.gravity / ropes, 1e-7, '理想拉力');
        near(result.ropeDistance, result.height * ropes, 1e-7, '拉绳距离');
    }
});

test('E04：教学滑轮的手拉动作确实提升虚拟物体', () => {
    setup(PhysicsBlocks.TEACHING_PULLEY, { mass:1, ropes:1, travel:2 });
    act('pull');
    advance(12);
    assert.ok(info().height > 0 && info().height <= 2 + 1e-7);
    near(info().ropeDistance, info().height * 2, 1e-7);
});

test('E04：滑轮在30/60/120Hz的提升与拉绳读数一致', () => {
    const results = [30, 60, 120].map(hz => pulleyTrial(2, hz));
    for (const result of results.slice(1)) {
        near(result.height, results[0].height, 1e-7);
        near(result.ropeDistance, results[0].ropeDistance, 1e-7);
        near(result.force, results[0].force, 1e-7);
    }
});

test('S02：关卡未声明allowRun时，逻辑API拒绝手动开始与复位', () => {
    setup(PhysicsBlocks.RAMP, { slope:1, surface:1, allowRun:false });
    state.levelRun = { card:{ rules:{} } };
    try {
        assert.ok(physicsActionAt(...CELL, 'start')?.error);
        assert.ok(physicsActionAt(...CELL, 'reset')?.error);
        advance(1);
        near(info().distance, 0);
    } finally { state.levelRun = null; }
});

test('S02：关卡已声明allowRun仅开放开始/复位，参数写入仍被API拒绝', () => {
    setup(PhysicsBlocks.RAMP, { slope:1, surface:1, allowRun:true });
    const original = structuredClone(info().config);
    state.levelRun = { card:{ rules:{} } };
    try {
        assert.ok(configurePhysicsAt(...CELL, { slope:3, allowRun:false })?.error);
        assert.deepEqual(info().config, original);
        act('start');
        advance(1);
        assert.ok(info().distance > 0);
        act('reset');
        near(info().distance, 0);
    } finally { state.levelRun = null; }
});

test('S02：关卡未声明allowRun时，压缩和拉绳API同样被拒绝', () => {
    for (const [id, action] of [[PhysicsBlocks.SPRING, 'compress'], [PhysicsBlocks.TEACHING_PULLEY, 'pull']]) {
        setup(id, { allowRun:false });
        state.levelRun = { card:{ rules:{} } };
        try { assert.ok(physicsActionAt(...CELL, action)?.error, `${action} 必须经过作者声明`); }
        finally { state.levelRun = null; }
    }
});

test('S02/G2新增：声明allowRun的关卡弹簧可手动压缩再释放，不修改配置或库存', () => {
    setup(PhysicsBlocks.SPRING, { allowRun:true, mass:1, compression:3 });
    const config = structuredClone(info().config);
    const inventory = structuredClone(state.player.inventory);
    state.levelRun = { card:{ rules:{} } };
    try {
        act('compress');
        act('start');
        let peak = 0;
        advance(3, 120, current => { peak = Math.max(peak, current.height); });
        assert.ok(peak > 0, '关卡弹簧不会因禁止所有储能输入而不可玩');
        assert.deepEqual(info().config, config);
        assert.deepEqual(state.player.inventory, inventory);
        assert.equal(state.itemDrops.length, 0);
    } finally { state.levelRun = null; }
});

test('S02/G2新增：声明allowRun的关卡教学滑轮可手拉，参数写入仍拒绝', () => {
    setup(PhysicsBlocks.TEACHING_PULLEY, { allowRun:true, mass:2, ropes:1, travel:1 });
    const config = structuredClone(info().config);
    state.levelRun = { card:{ rules:{} } };
    try {
        act('pull');
        advance(12);
        assert.ok(info().height > 0);
        near(info().ropeDistance, info().height * 2, 1e-7);
        assert.ok(configurePhysicsAt(...CELL, { mass:1, ropes:0 })?.error);
        assert.deepEqual(info().config, config);
    } finally { state.levelRun = null; }
});

test('S02：拆除运行中的装置立即失效，重新放回同类没有遗留速度或压缩能量', () => {
    setup(PhysicsBlocks.RAMP, { slope:1, surface:0 });
    act('start');
    advance(.5);
    assert.ok(info().distance > 0);
    setB(...CELL, BlockTypes.AIR);
    assert.equal(physicsInfoAt(...CELL), null);
    assert.ok(physicsActionAt(...CELL, 'start')?.error);
    advance(.5);
    setB(...CELL, PhysicsBlocks.RAMP);
    near(info().distance, 0);
    near(info().velocity, 0);
    assert.equal(info().running, false);
    setB(...CELL, PhysicsBlocks.SPRING);
    near(info().height, 0);
    physicsActionAt(...CELL, 'start');
    advance(1);
    near(info().height, 0);
});

test('S02：切换到新世界后，旧装置和读数不会继续存在', () => {
    setup(PhysicsBlocks.RAMP, { slope:1, surface:0 });
    act('start');
    advance(.5);
    freshWorld();
    initPhysicsLab();
    assert.equal(physicsInfoAt(...CELL), null);
    advance(1);
    assert.equal(physicsInfoAt(...CELL), null);
    assert.equal(state.itemDrops.length, 0);
});

test('S02：普通生存暂停与失焦期间实验不推进，恢复后续跑', () => {
    setup(PhysicsBlocks.RAMP, { slope:1, surface:0 });
    state.gameMode = GameModes.SURVIVAL;
    act('start');
    advance(.25, 120);
    const beforePause = { ...info() };
    setState('pause');
    advance(1);
    near(info().distance, beforePause.distance, 1e-9);
    near(info().elapsed, beforePause.elapsed, 1e-9);
    setState('playing');
    state.windowUnfocused = true;
    advance(1);
    near(info().distance, beforePause.distance, 1e-9);
    state.windowUnfocused = false;
    advance(.5);
    assert.ok(info().distance > beforePause.distance);
});

test('E01–E04：非法参数被原子拒绝，不把已有配置改到半完成状态', () => {
    for (const [id, valid, invalid] of [
        [PhysicsBlocks.RAMP, { mass:2, slope:1, surface:1 }, { mass:3, slope:99 }],
        [PhysicsBlocks.LEVER, { pivot:2, leftMass:1, rightMass:1 }, { leftMass:4, pivot:0 }],
        [PhysicsBlocks.SPRING, { mass:2, compression:2 }, { mass:3, compression:NaN }],
        [PhysicsBlocks.TEACHING_PULLEY, { mass:2, ropes:1, travel:1 }, { travel:2, ropes:9 }],
    ]) {
        setup(id, valid);
        const original = structuredClone(info().config);
        assert.ok(configurePhysicsAt(...CELL, invalid)?.error);
        assert.deepEqual(info().config, original);
    }
});

for (const hz of [30, 60, 120]) test(`E05：${hz}Hz下真实键盘步行穿测速门得到实际速度`, () => {
    setup(PhysicsBlocks.SENSOR, { dir:1 });
    Object.assign(state.player, {
        x:28.5, y:9.001, z:30.5, yaw:0, pitch:0,
        vx:0, vy:0, vz:0, onGround:true, flying:false,
    });
    act('start');
    keys.KeyD = true;
    try {
        const crossings = [null, null];
        for (let frame = 0; frame < Math.round(1.2 * hz); frame++) {
            const before = state.player.x;
            updatePlayerPhysics(1 / hz);
            for (const [index, plane] of [CELL[0] + .1, CELL[0] + .9].entries()) {
                if (crossings[index] === null && before <= plane && state.player.x > plane) {
                    crossings[index] = (frame + (plane - before) / (state.player.x - before)) / hz;
                }
            }
            tickPhysicsLab(1 / hz);
        }
        assert.ok(state.player.x > 31.2, '通过真实碰撞与键盘路径，测速门必须可穿行');
        assert.ok(crossings.every(value => value !== null), '独立测得两平面的真实穿越时刻');
        const expected = .8 / (crossings[1] - crossings[0]);
        near(expected, 4.5, .08, '夹具已接近正常步行速度');
        near(info().velocity, expected, 1e-6, '0.8格两平面间实际耗时换算速度');
        assert.ok(info().elapsed > 0, '实际穿过两平面得到非零计时');
        act('reset');
        near(info().velocity, 0);
        near(info().elapsed, 0);
    } finally { keys.KeyD = false; }
});

test('E05：单帧高速跨过两平面也测得真实帧耗时，不按实验子步误报12倍速度', () => {
    setup(PhysicsBlocks.SENSOR, { dir:1 });
    Object.assign(state.player, {
        x:29.7, y:9.001, z:30.5, yaw:-Math.PI / 2, pitch:0,
        vx:15, vy:0, vz:0, onGround:false, flying:true,
    });
    act('start');
    keys.KeyW = keys.ControlLeft = true;
    try {
        const before = state.player.x;
        updatePlayerPhysics(.1);
        const actualSpeed = (state.player.x - before) / .1;
        assert.ok(before < CELL[0] + .1 && state.player.x > CELL[0] + .9,
            '这一帧真实运动穿过两测量平面');
        tickPhysicsLab(.1);
        near(info().velocity, actualSpeed, 1e-7, '用整帧位移插值两平面穿越时刻');
    } finally { keys.KeyW = keys.ControlLeft = false; }
});

test('E05：真实掉落物单帧穿过两平面也能计时测速', () => {
    setup(PhysicsBlocks.SENSOR, { dir:1 });
    spawnItemDrop(29.7, 9.15, 30.5, BlockTypes.STONE, 1,
        { vx:15, vy:0, vz:0, pickupDelay:0, lifePersistent:true });
    const drop = state.itemDrops.at(-1);
    act('start');
    const before = drop.x;
    updateItemDrops(.1);
    const actualSpeed = (drop.x - before) / .1;
    assert.ok(before < CELL[0] + .1 && drop.x > CELL[0] + .9,
        '这一帧真实物品运动穿过两平面');
    tickPhysicsLab(.1);
    near(info().velocity, actualSpeed, 1e-7, '掉落物实际位移换算速度');
});

function fanSetup(powered = true) {
    setup(PhysicsBlocks.FAN, { dir:1 });
    setB(28, 9, 30, waterwheelId(0));
    setB(29, 9, 30, shaftId(0));
    if (powered) setB(28, 10, 30, BlockTypes.WATER);
    updateKineticNetwork();
}
function spawnTestDrop(x, z = 30.5) {
    spawnItemDrop(x, 9.15, z, BlockTypes.STONE, 1,
        { vx:0, vy:0, vz:0, pickupDelay:0, lifePersistent:true });
    return state.itemDrops.at(-1);
}
function advanceDrops(seconds, hz = 60) {
    for (let frame = 0; frame < Math.round(seconds * hz); frame++) {
        tickPhysicsLab(1 / hz);
        updateItemDrops(1 / hz);
    }
}

test('E06：风扇必须后接真实轴动力才推动掉落物，基础负载计入动力网', () => {
    fanSetup(false);
    const drop = spawnTestDrop(32.5);
    advanceDrops(.5);
    near(drop.x, 32.5, 1e-7, '无动力没有风力位移');
    setB(28, 10, 30, BlockTypes.WATER);
    updateKineticNetwork();
    const kinetic = kineticInfoAt(...CELL);
    assert.equal(kinetic.running, true);
    near(Math.abs(kinetic.rpm), 8);
    near(kinetic.load, PHYSICS.fanLoad, 1e-7, '风扇基础SU负载');
    advanceDrops(.75);
    assert.ok(drop.x > 32.6, '真实物品沿风向移动');
    assert.equal(state.itemDrops.includes(drop), true);
});

test('E06：实心墙遮住风程，撤墙后同一物品继续被风推动', () => {
    fanSetup();
    setB(32, 9, 30, BlockTypes.STONE);
    const drop = spawnTestDrop(33.5);
    advanceDrops(.75);
    near(drop.x, 33.5, 1e-7, '墙后没有风力');
    setB(32, 9, 30, BlockTypes.AIR);
    advanceDrops(.75);
    assert.ok(drop.x > 33.6, '撤墙后无需重放物品即可送出');
});

test('E06：超过六格风程的物品不被风推动', () => {
    fanSetup();
    const drop = spawnTestDrop(CELL[0] + PHYSICS.windRange + 1.5);
    advanceDrops(1);
    near(drop.x, CELL[0] + PHYSICS.windRange + 1.5, 1e-7);
});

test('E06：风中掉落不被身边玩家抢吸，停机后恢复正常拾取且数量守恒', () => {
    fanSetup();
    Object.assign(state.player, { x:32.3, y:9.001, z:30.5 });
    const inventory = state.player.inventory[BlockTypes.STONE];
    const drop = spawnTestDrop(32.5);
    advanceDrops(.2);
    assert.equal(state.itemDrops.includes(drop), true, '风力运输暂时保护拾取');
    assert.equal(state.player.inventory[BlockTypes.STONE], inventory);
    setB(28, 10, 30, BlockTypes.AIR);
    updateKineticNetwork();
    advanceDrops(1);
    assert.equal(state.itemDrops.includes(drop), false, '断动力后保护不应永久残留');
    assert.equal(state.player.inventory[BlockTypes.STONE], inventory + 1);
});

test('E06：运转传送带优先接管物品，横向风不能把带上物品吹出轨道', () => {
    fanSetup();
    // 独立的Z轴水车驱动一格朝北的带；风扇仍朝东，方向相互垂直。
    setB(32, 9, 28, waterwheelId(2));
    setB(32, 10, 28, BlockTypes.WATER);
    setB(32, 9, 29, shaftId(2));
    setB(32, 9, 30, beltId(0));
    updateKineticNetwork();
    const drop = spawnTestDrop(32.5, 30.7);
    advanceDrops(.2);
    assert.equal(drop.carried, true, '真实传送带接管');
    near(drop.x, 32.5, 1e-7, '横向风不改变带上物品的X位置');
    assert.ok(drop.z < 30.6, '物品确实沿带向前进');
});

test('G3/E05：按真实主循环顺序，帧长变化不会把上一帧掉落位移除以本帧耗时', () => {
    setup(PhysicsBlocks.SENSOR, { dir:1 });
    spawnItemDrop(29.7, 9.15, 30.5, BlockTypes.STONE, 1,
        { vx:15, vy:0, vz:0, pickupDelay:0, lifePersistent:true });
    const drop = state.itemDrops.at(-1);
    act('start');
    // G3接口修订：主循环在风力与所有实体运动之后统一采样，不能挪用下一帧dt。
    tickPhysicsLab(.1,{deferSensors:true});
    const before = drop.x;
    updateItemDrops(.1);
    const actualSpeed = (drop.x - before) / .1;
    assert.ok(drop.x > CELL[0] + .9);
    samplePhysicsSensors(.1);
    tickPhysicsLab(1 / 120,{deferSensors:true});
    updateItemDrops(1 / 120);
    samplePhysicsSensors(1 / 120);
    near(info().velocity, actualSpeed, 1e-7, '跨门计时必须绑定实际运动帧');
});

function attachPhysicsModel() {
    const mesh = buildPhysicsMesh(info().id);
    state.droppedItems.push({ prop:true, x:CELL[0], y:CELL[1], z:CELL[2], mesh });
    tickPhysicsLab(.1);
    return mesh;
}
function modelPose(mesh) {
    const rows=[];
    const collect=(node,path)=>{
        rows.push([path,node.name,node.visible,
            node.position.x,node.position.y,node.position.z,
            node.rotation.x,node.rotation.y,node.rotation.z,
            node.scale.x,node.scale.y,node.scale.z]);
        for(const [index,child] of node.children.entries())collect(child,`${path}/${index}`);
    };
    collect(mesh,'root');
    return rows;
}

test('G3/E01：调整坡度会改变真实斜坡模型，水平档不能仍画成斜面', () => {
    setup(PhysicsBlocks.RAMP, { slope:0, surface:1 });
    const mesh=attachPhysicsModel(),ramp=mesh.getObjectByName('lab_ramp');
    assert.ok(ramp, '实际模型含斜坡表面');
    near(ramp.rotation.z,0,1e-9,'坡度0的视觉面保持水平');
    configure({slope:3});
    tickPhysicsLab(.1);
    assert.ok(Math.abs(ramp.rotation.z)>.05,'45°档与水平档应有可观察的几何差异');
});

test('G3/E02：移动砝码槽位会改变模型中的实际力臂，砝码不能只改变读数', () => {
    setup(PhysicsBlocks.LEVER, { pivot:2, leftMass:1, rightMass:1, leftArm:1, rightArm:1 });
    const mesh=attachPhysicsModel(),weight=mesh.getObjectByName('lab_left_weight');
    assert.ok(weight);
    const before=weight.position.x;
    configure({leftArm:2});
    tickPhysicsLab(.1);
    assert.ok(weight.position.x<before-.01,'左砝码移到较远槽位，视觉力臂应增长');
});

test('G3/E04：定滑轮与四段承重绳的模型绳路必须不同，不能仅改拉力读数', () => {
    setup(PhysicsBlocks.TEACHING_PULLEY, { ropes:0 });
    const mesh=attachPhysicsModel(),fixed=modelPose(mesh);
    configure({ropes:2});
    tickPhysicsLab(.1);
    assert.notDeepEqual(modelPose(mesh),fixed,'支承绳从1变4，真实绳轮几何/显隐应有变化');
});

test('G3/E06：风扇正面必须朝配置的真实风向，不能模型与送物方向相差90度', () => {
    setup(PhysicsBlocks.FAN, {dir:1});
    const mesh=attachPhysicsModel(),rotor=mesh.getObjectByName('lab_rotor');
    assert.ok(rotor);
    const directions=[[0,-1],[1,0],[0,1],[-1,0]];
    for(const [dir,[dx,dz]] of directions.entries()) {
        configure({dir});tickPhysicsLab(.1);
        const angle=mesh.rotation.y;
        const x=rotor.position.x*Math.cos(angle)+rotor.position.z*Math.sin(angle);
        const z=-rotor.position.x*Math.sin(angle)+rotor.position.z*Math.cos(angle);
        const forward=x*dx+z*dz,lateral=x*dz-z*dx;
        assert.ok(forward>.1,`朝向${dir}的转子正面位于风向一侧`);
        near(lateral,0,1e-7,`朝向${dir}没有横向错位`);
    }
});

test('G3/E05：斜向进入时，两道测速面的真实交点都要在测量范围内', () => {
    for(const outside of ['side','height']) {
        setup(PhysicsBlocks.SENSOR,{dir:1});
        Object.assign(state.player,{x:CELL[0]-.3,y:outside==='height'?CELL[1]+5:CELL[1],z:CELL[2]+.5+(outside==='side'?2:0)});
        act('start');
        Object.assign(state.player,{x:CELL[0]+.7,y:CELL[1],z:CELL[2]+.5});samplePhysicsSensors(.1);
        state.player.x=CELL[0]+1.3;samplePhysicsSensors(.1);
        near(info().velocity,0,1e-9,`${outside}：入口交点不在门内，不能生成完整测速`);
    }
});

test('G3/E06：逆风不能顺向加速斜坡小车，横风不能变成轴向推力', () => {
    for(const [dir,dx,dz] of [[0,0,-1],[3,-1,0]]) {
        setup(PhysicsBlocks.FAN,{dir});
        const axis=dx?0:2;
        setB(CELL[0]-dx*2,CELL[1],CELL[2]-dz*2,waterwheelId(axis));
        setB(CELL[0]-dx*2,CELL[1]+1,CELL[2]-dz*2,BlockTypes.WATER);
        setB(CELL[0]-dx,CELL[1],CELL[2]-dz,shaftId(axis));
        const target=[CELL[0]+dx*2,CELL[1],CELL[2]+dz*2];setB(...target,PhysicsBlocks.RAMP);
        assert.equal(configurePhysicsAt(...target,{slope:0,surface:0}).ok,true);
        updateKineticNetwork();assert.equal(kineticInfoAt(...CELL).rpm,8);
        tickPhysicsLab(.1);
        near(physicsInfoAt(...target).distance,0);near(physicsInfoAt(...target).velocity,0);
    }
});

test('G3/E06：风路穿入上一层时，该层挡板必须遮风', () => {
    fanSetup();setB(34,10,30,BlockTypes.STONE);
    spawnItemDrop(35.5,10.2,30.5,BlockTypes.STONE,1,{vx:0,vy:0,vz:0,lifePersistent:true});
    const drop=state.itemDrops.at(-1);
    tickPhysicsLab(.1);near(drop.vx,0);
    setB(34,10,30,BlockTypes.AIR);tickPhysicsLab(.1);
    assert.ok(drop.vx>0,'撤去实际风路的上层挡板后恢复推力');
});

test('G3/E06：停机传送带不接管物品，风扇仍可吹动带上掉落', () => {
    fanSetup();setB(32,9,30,beltId(0));updateKineticNetwork();
    assert.equal(kineticInfoAt(32,9,30).rpm,0);
    const drop=spawnTestDrop(32.5);advanceDrops(.2);
    assert.ok(drop.x>32.5,'只有运转且接管物品的带才优先');
});
