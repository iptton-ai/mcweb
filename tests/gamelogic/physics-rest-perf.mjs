// 独立压力仪器：只通过公开 API 构造、启动和观察，不替代真实求解器。
// node --import ./tests/gamelogic/_preload.mjs tests/gamelogic/physics-rest-perf.mjs
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { freshWorld, setB, setBlockSafe, at, state } from './kit.mjs';
import * as C from '../../js/config.js';
import {
    initPhysicsLab, tickPhysicsLab, configurePhysicsAt,
    physicsActionAt, physicsInfoAt, physicsDiagnostics,
} from '../../js/physicsLab.js';

const dt = 1 / 120, waterCells = [], devices = [];
const samples = [], warmSteps = 120, sampleSteps = 1000, budgetP95Ms = 5;
freshWorld();
state.levelRun = state.levelEdit = null;
state.player.x = state.player.z = 3.5;
for (let ix = 0; ix < 16; ix++) for (let iz = 0; iz < 16; iz++) {
    const cell = [16 + ix, 9, 16 + iz];
    setB(...cell, C.troughId((ix + iz) % 2 ? 0 : 4));
    waterCells.push(cell);
}
for (let i = 0; i < 32; i++) {
    const cell = [60 + (i % 8) * 3, 9, 60 + Math.floor(i / 8) * 3];
    setB(...cell, C.PhysicsBlocks.RAMP);
    devices.push(cell);
}
initPhysicsLab();
for (const cell of devices) {
    const result = configurePhysicsAt(...cell, { slope: 3, surface: 0, mass: 1 });
    assert.equal(result?.ok, true, result?.error);
}
const waterTotal = () => waterCells.reduce((sum, cell) => sum + C.troughWater(at(...cell)), 0);
const initialWater = waterTotal();
assert.equal(waterCells.length, 256); assert.equal(devices.length, 32);
assert.equal(initialWater, 512, '封闭棋盘槽初始共有512份水');
let restarts = 0, waterPatternResets = 0, minRunning = Infinity, actualMovingUpdates = 0, before;
for (let frame = -warmSteps; frame < sampleSteps; frame++) {
    // 定期重排同样512份水，保持均衡求解有真实搬运；不增加总水量，搭建写入不计时。
    if (frame >= 0 && frame % warmSteps === 0) {
        for (let i = 0; i < waterCells.length; i++) {
            const ix = Math.floor(i / 16), iz = i % 16;
            setBlockSafe(...waterCells[i], C.troughId((ix + iz) % 2 ? 0 : 4), {physicsWaterTransfer:true});
        }
        waterPatternResets++;
        assert.equal(waterTotal(), initialWater);
    }
    // 复位和断言均在计时外；活动压力不能被实验早早结束后的静止帧稀释。
    for (const cell of devices) {
        if (physicsInfoAt(...cell)?.running) continue;
        for (const action of ['reset', 'start']) {
            const result = physicsActionAt(...cell, action);
            assert.equal(result?.ok, true, result?.error);
        }
        if (frame >= 0) restarts++;
    }
    const old = devices.map(cell => physicsInfoAt(...cell));
    assert.ok(old.every(value => value?.running), '每个采样步必须有32个正在运行的坡台');
    if (frame === 0) before = physicsDiagnostics();
    const t = performance.now();
    tickPhysicsLab(dt);
    const ms = performance.now() - t;
    if (frame < 0) continue;
    samples.push(ms);
    minRunning = Math.min(minRunning, old.filter(value => value.running).length);
    for (let i = 0; i < devices.length; i++) {
        const now = physicsInfoAt(...devices[i]);
        if (Math.abs((now?.distance || 0) - (old[i]?.distance || 0)) > 1e-12 ||
            Math.abs((now?.velocity || 0) - (old[i]?.velocity || 0)) > 1e-12) actualMovingUpdates++;
    }
}
const after = physicsDiagnostics();
assert.equal(samples.length, sampleSteps);
assert.equal(minRunning, 32);
assert.equal(actualMovingUpdates, sampleSteps * devices.length,
    '32000次物体更新均须实际改变位置或速度');
assert.equal(waterTotal(), initialWater, '压力运行不能复制或丢失水');
assert.equal(state.lifePendingDrops.length,0,'压力仪器的守恒重排不能额外返还湿槽');
assert.equal(typeof before.fullScans, 'number', '公开诊断必须提供全图扫描计数');
const sorted = [...samples].sort((a, b) => a - b);
const measured = {
    n: samples.length,
    meanMs: samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
    p95Ms: sorted[Math.ceil(samples.length * 0.95) - 1],
    maxMs: sorted.at(-1),
};
const fullScansDelta = after.fullScans - before.fullScans;
const waterTransfersDelta = after.waterTransfers - before.waterTransfers;
assert.ok(waterTransfersDelta > 0, '测量阶段必须实际发生水量搬运');
const result = {
    schema: 'mcweb.physics.rest-perf.v1', timestamp: new Date().toISOString(),
    sourceSha256:Object.fromEntries(['config','physicsData','physicsLab','physicsModels','world','kinetic','redstone','piston','items'].map(name=>
        [name,createHash('sha256').update(readFileSync(new URL(`../../js/${name}.js`,import.meta.url))).digest('hex')])),
    machine: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model },
    timingScope: 'Node真实tickPhysicsLab，渲染桩；不包含搭建、复位、公开读数及断言耗时；不推导浏览器FPS',
    dt, warmSteps, sampleSteps, waterCells: waterCells.length, experimentDevices: devices.length,
    initialWater, finalWater: waterTotal(), minRunning, actualMovingUpdates, restarts,
    waterPatternResets, waterTransfersDelta,
    measured, diagnosticsBefore: before, diagnosticsAfter: after, fullScansDelta,
    gates: { p95Ms: budgetP95Ms, p95Pass: measured.p95Ms <= budgetP95Ms,
        fullScansPass: fullScansDelta === 0, activeUpdatesPass: actualMovingUpdates === 32000 },
};
result.pass = result.gates.p95Pass && result.gates.fullScansPass && result.gates.activeUpdatesPass;
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
