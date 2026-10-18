// Deterministic, public-API-only physics P1 performance harness.
// node --import ./tests/gamelogic/_preload.mjs tests/gamelogic/physics-perf.mjs --rpm=8
// --rpm=proxy32 measures FOUR old 8-RPM simulation substeps per display frame;
// it is an implementation-independent new-work budget, NEVER a native 32-RPM result.
// --rpm=32 requires the new gears and reports the actual native fast scene.
// --particles=live advances the real particle lifecycle INSIDE timed production steps.
// Historical mode is retained solely to reproduce the original archived measurements.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { BufferAttribute, BufferGeometry } from 'three';
import { freshWorld, setB, at, state } from './kit.mjs';
import * as C from '../../js/config.js';
import * as K from '../../js/kinetic.js';
import { spawnItemDrop, clearItemDrops, updateItemDrops } from '../../js/items.js';
import { containerAt } from '../../js/homestead.js';
import { particleSystem, clearParticles, updateParticles } from '../../js/particles.js';

const arg = (name, fallback) => process.argv.find(x => x.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const mode = arg('rpm', '8');
assert.ok(['8', '32', 'proxy32'].includes(mode), '--rpm must be 8, 32 or proxy32');
const selected = arg('scene', 'all');
const particleMode = arg('particles', 'historical');
assert.ok(['historical', 'live'].includes(particleMode), '--particles must be historical or live');
const substeps = mode === 'proxy32' ? 4 : 1;
const dt = 1 / 60;
const B = C.BlockTypes;

// Local rendering-stub gap, matching existing public logic tests. No game code changes.
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
BufferAttribute.prototype.setXY ??= function (i, x, y) {
    this.array[i * this.itemSize] = x;
    this.array[i * this.itemSize + 1] = y;
    return this;
};

function stats(values) {
    if (!values.length) return { n: 0, meanMs: null, p95Ms: null, maxMs: null };
    const sorted = [...values].sort((a, b) => a - b);
    return { n: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length,
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) };
}
const diagnostics = () => typeof K.kineticDiagnostics === 'function' ? K.kineticDiagnostics() : null;
function diagnosticDelta(before, after) {
    if (!before || !after) return null;
    return Object.fromEntries(Object.keys(after).filter(k => typeof after[k] === 'number')
        .map(k => [k, after[k] - (before[k] ?? 0)]));
}
function verifiedDiagnostics(before, expected = {}) {
    const delta = diagnosticDelta(before, diagnostics());
    if (!delta) return null; // historical baseline has no public diagnostics
    assert.equal(delta.networkRebuilds, 0, 'continuous activity must not rebuild the whole kinetic network');
    for (const [name, value] of Object.entries(expected)) assert.equal(delta[name], value, `${name} agrees with actual activity`);
    return delta;
}
function requireRpm(x, y, z, expected = mode === '32' ? 32 : 8) {
    if (K.kineticInfoAt) assert.equal(Math.abs(K.kineticInfoAt(x, y, z)?.rpm), expected);
    else assert.match(K.kineticStatusAt(x, y, z), new RegExp(`转速 ${expected} RPM`));
}

// Six aligned sources provide 384 SU. Last drive shaft is (x,y,z), axis X.
// Native 32 RPM uses TWO genuine large→small contacts; no runtime-map injection.
function drive(x, y, z) {
    const sourceZ = z - (mode === '32' ? 2 : 0);
    for (let sx = x - 13; sx <= x - 8; sx++) {
        setB(sx, y, sourceZ, C.waterwheelId(0));
        setB(sx, y + 1, sourceZ, B.WATER);
    }
    if (mode === '32') {
        assert.equal(typeof C.largeCogId, 'function', 'native 32 RPM requires largeCogId');
        setB(x - 7, y, z - 2, C.largeCogId(0));
        setB(x - 7, y, z - 1, C.cogId(0));
        setB(x - 6, y, z - 1, C.shaftId(0));
        setB(x - 5, y, z - 1, C.largeCogId(0));
        setB(x - 5, y, z, C.cogId(0));
        for (let sx = x - 4; sx <= x; sx++) setB(sx, y, z, C.shaftId(0));
    } else {
        for (let sx = x - 7; sx <= x; sx++) setB(sx, y, z, C.shaftId(0));
    }
}

function shafts() {
    freshWorld({ seed: 20261018 });
    setB(19, 9, 20, C.waterwheelId(0));
    setB(19, 10, 20, B.WATER);
    for (let x = 20; x < 120; x++) {
        setB(x, 9, 20, C.shaftId(0));
        state.droppedItems.push({ prop: true, mesh: {
            userData: { kinetic: true, propKey: `${x},9,20` },
            children: [{ children: [{ rotation: { y: 0 } }] }],
        } });
    }
    K.updateKineticNetwork();
    requireRpm(20, 9, 20, 8);
    for (let i = 0; i < 10; i++) K.updateKineticNetwork();
    const rebuild = [];
    for (let i = 0; i < 50; i++) {
        const t = performance.now(); K.updateKineticNetwork(); rebuild.push(performance.now() - t);
    }
    for (let i = 0; i < 10000; i++) K.updateKineticTick(dt);
    const tick = [];
    for (let i = 0; i < 1000; i++) {
        const t = performance.now();
        for (let j = 0; j < 100; j++) K.updateKineticTick(dt);
        tick.push((performance.now() - t) / 100);
    }
    assert.ok(state.droppedItems.every(d => d.mesh.children[0].children[0].rotation.y !== 0), 'all 100 props actually rotate');
    return { components: 101, rotatingProps: 100, network: stats(rebuild), tick: stats(tick) };
}

function production() {
    if (particleMode === 'live') {
        // Particle lifetimes/velocities use Math.random, independently of worldSeed.
        // Fix this stream only for the new live experiment; historical modes stay reproducible.
        let randomState = 20261018;
        Math.random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296);
    }
    freshWorld({ seed: 20261018 });
    if (particleMode === 'live') clearParticles();
    const targets = [];
    for (let i = 0; i < 10; i++) {
        const z = 20 + 18 * i;
        drive(31, 9, z);
        setB(32, 9, z, C.sawId(3)); // east; FACING_NORMALS[3] = +X
        targets.push([33, 9, z]);
    }
    K.updateKineticNetwork(); requireRpm(32, 9, 20);
    const warmFrames = 120, sampleFrames = 600;
    const all = [], completed = [];
    let completions = 0, activeFrames = 0, outputItems = 0;
    let before, warmParticles;
    for (let frame = -warmFrames; frame < sampleFrames; frame++) {
        let frameMs = 0, done = 0, output = 0;
        if (frame === 0) { before = diagnostics(); warmParticles = particleSystem.particles.length; }
        for (let s = 0; s < substeps; s++) {
            for (const p of targets) if (at(...p) === B.AIR) setB(...p, B.WOOD);
            const t = performance.now();
            K.updateKineticTick(dt);
            if (particleMode === 'live') updateParticles(dt);
            frameMs += performance.now() - t;
            done += targets.filter(p => at(...p) === B.AIR).length;
            output += state.itemDrops.reduce((n, d) => n + d.count, 0);
            clearItemDrops(); // bounded output inventory; creation remains inside timed call
        }
        if (frame >= 0) {
            all.push(frameMs); activeFrames++; completions += done; outputItems += output;
            if (done) completed.push(frameMs);
        }
    }
    assert.ok(completions >= 150, `continuous production: got ${completions} completed logs`);
    assert.equal(outputItems, completions * 4, 'each completed log produces exactly 4 planks');
    return { machines: 10, capacityPerLine: 384, warmFrames, sampleFrames, activeFrames,
        simulatedSeconds: sampleFrames * dt * substeps, completions, outputItems,
        particlePopulation: { atSampleStart: warmParticles, atSampleEnd: particleSystem.particles.length,
            lifecycleAdvanced: particleMode === 'live' },
        allFrames: stats(all), completionFrames: stats(completed),
        diagnostics: verifiedDiagnostics(before, { machineCompletions: completions }) };
}

function lifts() {
    freshWorld({ seed: 20261018 });
    const lifts = [];
    for (let i = 0; i < 16; i++) {
        const x = 30 + (i % 4) * 48, z = 30 + Math.floor(i / 4) * 45;
        drive(x, 40, z);
        setB(x + 1, 40, z, C.cogId(0));
        setB(x + 1, 39, z, C.cogId(1));
        setB(x + 1, 38, z, C.shaftId(1));
        setB(x + 1, 37, z, C.pulleyId(false, true));
        setB(x + 1, 17, z, C.PLATFORM_ITEM_ID);
        const rider = { x: x + 1.5, y: 18, z: z + 0.5, hp: 20, vx: 0, vy: 0, vz: 0, onGround: true };
        state.enemies.push(rider);
        lifts.push({ x: x + 1, z, rider, up: true, reversals: 0 });
    }
    K.updateKineticNetwork(); requireRpm(31, 38, 30);
    const warmFrames = 120, sampleFrames = mode === 'proxy32' ? 600 : mode === '32' ? 600 : 2400;
    const all = [], moving = [];
    let crossedCells = 0, passengerCells = 0, before;
    for (let frame = -warmFrames; frame < sampleFrames; frame++) {
        let frameMs = 0, moved = 0;
        if (frame === 0) before = diagnostics();
        for (let s = 0; s < substeps; s++) {
            for (const l of lifts) {
                const py = Math.round(l.rider.y - 1);
                if ((l.up && py >= 33) || (!l.up && py <= 17)) {
                    l.up = !l.up; l.reversals++;
                    setB(l.x, 37, l.z, C.pulleyId(false, l.up));
                }
            }
            const old = lifts.map(l => l.rider.y);
            const t = performance.now(); K.updateKineticTick(dt); frameMs += performance.now() - t;
            for (let j = 0; j < lifts.length; j++) {
                const dy = Math.abs(lifts[j].rider.y - old[j]);
                moved += dy;
                assert.equal(at(lifts[j].x, Math.round(lifts[j].rider.y - 1), lifts[j].z), C.PLATFORM_ITEM_ID,
                    'passenger remains on its actual platform');
            }
        }
        if (frame >= 0) {
            all.push(frameMs); crossedCells += moved; passengerCells += moved;
            if (moved) moving.push(frameMs);
        }
    }
    assert.ok(crossedCells >= 512, `must measure >=512 actual crossings, got ${crossedCells}`);
    assert.ok(lifts.every(l => l.reversals >= 2), 'every lift really travels both ways');
    return { lifts: 16, passengers: 16, stroke: 16, warmFrames, sampleFrames,
        simulatedSeconds: sampleFrames * dt * substeps, crossedCells, passengerCells,
        directionChanges: lifts.reduce((n, l) => n + l.reversals, 0),
        allFrames: stats(all), movementFrames: stats(moving),
        msPerCrossing: moving.reduce((n, v) => n + v, 0) / crossedCells,
        diagnostics: verifiedDiagnostics(before, { pulleySteps: crossedCells }) };
}

function belts() {
    freshWorld({ seed: 20261018 });
    const lines = [];
    for (let i = 0; i < 4; i++) {
        const z = 30 + i * 45;
        drive(31, 9, z);
        for (let x = 32; x <= 44; x++) setB(x, 9, z, C.beltId(1));
        setB(45, 9, z, C.beltId(2));
        for (let zz = z + 1; zz <= z + 7; zz++) setB(45, 9, zz, C.beltId(2));
        setB(45, 9, z + 8, C.LifeBlocks.CHEST);
        lines.push({ z, chest: containerAt(45, 9, z + 8) });
    }
    K.updateKineticNetwork(); requireRpm(31, 9, 30);
    function seedItems() {
        clearItemDrops();
        for (let i = 0; i < lines.length; i++) for (let j = 0; j < 16; j++) {
            spawnItemDrop(32.25 + j * 0.65, 9.15, lines[i].z + 0.5, B.PLANKS, 1, { noScatter: true });
            state.itemDrops.at(-1).perfLine = i;
        }
    }
    seedItems();
    const warmFrames = 120;
    for (let f = 0; f < warmFrames; f++) {
        K.updateKineticTick(dt); updateItemDrops(dt);
    }
    seedItems(); // measure identical starting positions after JIT warm-up
    const sampleFrames = mode === '8' ? 1200 : 600;
    const all = [], active = [], blocked = [], deliveredTimes = [];
    let distance = 0, delivered = 0, turns = 0, replenished = 0, fullQueueStoppedEntityFrames = 0;
    const before = diagnostics();
    for (let frame = 0; frame < sampleFrames; frame++) {
        let frameMs = 0, moved = 0, accepted = 0;
        const fullStart = mode === '8' ? 300 : 75;
        const full = frame >= fullStart && frame < fullStart * 2;
        for (let s = 0; s < substeps; s++) {
            for (const l of lines) l.chest.slots = full
                ? Array.from({ length: 27 }, () => ({ id: B.DIRT, count: 64 })) : Array(27).fill(null);
            const old = state.itemDrops.map(d => [d, d.x, d.z]);
            const t = performance.now(); K.updateKineticTick(dt); updateItemDrops(dt); frameMs += performance.now() - t;
            for (const [d, x, z] of old) {
                if (!state.itemDrops.includes(d)) continue;
                const travelled = Math.hypot(d.x - x, d.z - z);
                moved += travelled;
                if (full && travelled < 1e-8 && d.x > 44.5 && d.z > lines[d.perfLine].z + 6.5)
                    fullQueueStoppedEntityFrames++;
                if (z < lines[d.perfLine].z + 1 && d.z >= lines[d.perfLine].z + 1) turns++;
            }
            for (let i = 0; i < lines.length; i++) {
                const l = lines[i];
                const n = l.chest.slots.reduce((n, stack) => n + (stack?.id === B.PLANKS ? stack.count : 0), 0);
                accepted += n;
                const missing = 16 - state.itemDrops.filter(d => d.perfLine === i).length;
                assert.equal(missing, n, 'only actual chest delivery removes a test item');
                for (let j = 0; j < missing; j++) {
                    spawnItemDrop(32.25 - 0.01 * j, 9.15, l.z + 0.5, B.PLANKS, 1, { noScatter: true });
                    state.itemDrops.at(-1).perfLine = i; replenished++;
                }
            }
            assert.equal(state.itemDrops.length, 64, 'exactly 64 moving/queued entities maintained');
            assert.equal(state.itemDrops.reduce((n, d) => n + d.count, 0), 64, 'fixed quantity remains conserved');
        }
        all.push(frameMs); distance += moved; delivered += accepted;
        if (moved > 0.001) active.push(frameMs);
        if (full) blocked.push(frameMs);
        if (accepted) deliveredTimes.push(frameMs);
    }
    assert.ok(active.length >= 600, `>=600 actual transport frames, got ${active.length}`);
    assert.ok(turns >= 64 && delivered >= 32, `real turns/delivery required: ${turns}/${delivered}`);
    assert.ok(fullQueueStoppedEntityFrames > 0, 'a real full-chest queue must stop moving before draining');
    assert.equal(replenished, delivered, 'refill count equals real accepted quantity');
    return { lines: 4, entities: 64, beltCells: 84, warmFrames, sampleFrames,
        simulatedSeconds: sampleFrames * dt * substeps, distance, turns, delivered, replenished, fullQueueStoppedEntityFrames,
        allFrames: stats(all), transportFrames: stats(active), fullChestFrames: stats(blocked), deliveryFrames: stats(deliveredTimes),
        diagnostics: verifiedDiagnostics(before) };
}

const cases = { shafts, production, lifts, belts };
assert.ok(selected === 'all' || selected in cases, 'unknown --scene');
// Frozen before first native 32-RPM run; do not derive gates from current measurements.
// P01 uses the main plan's earlier freeze; P03-P05 use the archived baseline/proxy × 1.2.
const commonBudgets = {
    'shafts/network': [12.174, 13.252],
    'shafts/tick': [0.001657, 0.001872],
};
const oldBudgets = {
    'production/allFrames': [8.768625862, 0.028050000],
    'production/completionFrames': [262.943762460, 268.749500400],
    'lifts/allFrames': [0.005472955, 0.004249200],
    'lifts/movementFrames': [0.104085800, 0.254950800],
    'belts/transportFrames': [0.044045301, 0.271350000],
    'belts/fullChestFrames': [0.071707996, 0.298550400],
};
const nativeBudgets = {
    'production/allFrames': [0.028620688, 0.116299200],
    'production/completionFrames': [0.138885086, 0.527098800],
    'lifts/allFrames': [0.021631030, 0.129601200],
    'lifts/movementFrames': [0.112317560, 0.156199200],
    'belts/transportFrames': [0.165985898, 0.161048400],
    'belts/fullChestFrames': [0.274834640, 1.884100800],
};
// Fair production supplement: archived pre-implementation source, fixed particle
// RNG, live lifecycle included, three-run median × 1.2; frozen before final live runs.
const liveProductionBudgets = {
    '8': {
        'production/allFrames': [7.198515440, 0.042000000],
        'production/completionFrames': [215.486469960, 222.839049600],
    },
    '32': {
        'production/allFrames': [0.069716006, 0.136452000],
        'production/completionFrames': [0.136883096, 0.255051600],
    },
};
const result = {
    schema: 'mcweb.physics.perf.v1', timestamp: new Date().toISOString(), mode,
    nativeRpm: mode === '32' ? 32 : 8, substepsPerMeasuredFrame: substeps, particleMode,
    particleRandomSeed: particleMode === 'live' ? 20261018 : null,
    timingScope: `Node: real gameplay logic; rendering stubbed; setup, refill and assertions excluded; particle lifecycle ${particleMode === 'live' ? 'included' : 'not advanced (historical)'}`,
    machine: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model },
    sourceSha256: Object.fromEntries(['config', 'kinetic', 'kineticGraph', 'items', 'piston', 'world', 'particles']
        .filter(name => existsSync(new URL(`../../js/${name}.js`, import.meta.url))).map(name => [name,
        createHash('sha256').update(readFileSync(new URL(`../../js/${name}.js`, import.meta.url))).digest('hex')])),
    scenes: {},
};
for (const [name, run] of Object.entries(cases)) {
    if (selected !== 'all' && selected !== name) continue;
    result.scenes[name] = run();
}
if (mode !== 'proxy32') {
    result.gates = [];
    const budgets = { ...commonBudgets, ...(mode === '32' ? nativeBudgets : oldBudgets),
        ...(particleMode === 'live' ? liveProductionBudgets[mode] : {}) };
    for (const [key, [mean, p95]] of Object.entries(budgets)) {
        const [scene, metric] = key.split('/');
        const measured = result.scenes[scene]?.[metric];
        if (!measured) continue;
        result.gates.push({ key, meanBudgetMs: mean, p95BudgetMs: p95,
            pass: measured.meanMs <= mean && measured.p95Ms <= p95,
            ...(scene === 'production' ? { method: particleMode === 'live' ? 'fair-live-v1' : 'historical-no-lifecycle',
                valid: particleMode === 'live' } : {}) });
    }
    if (mode === '32' && result.scenes.production) {
        result.gates.push({ key: 'production/actual-speed', expected: '790..810 logs in 10 s, 10 saws at 32 RPM',
            pass: result.scenes.production.completions >= 790 && result.scenes.production.completions <= 810 });
    }
    result.pass = result.gates.every(gate => gate.pass === true);
    if (process.argv.includes('--check') && !result.pass) process.exitCode = 1;
}
console.log(JSON.stringify(result, null, 2));
