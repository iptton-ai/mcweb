// Run only after the coordinator releases exclusive Node performance sampling.
// ego-browser nodejs < tests/e2e/physics_p1_browser_perf_ego.mjs
// TaskSpace 161 / p5 is the dedicated 18438 test origin. Reload before importing
// its same-instance modules, so late source changes cannot mix with an old page.
// This is a current-build browser observation, not a frozen historical budget.
const root = '/Users/zxnap/code/MyWorks/yltech.edu/game';
const fs = await import('node:fs/promises');
const { createHash } = await import('node:crypto');
const sourcePaths = ['js/config.js', 'js/kineticGraph.js', 'js/kinetic.js', 'js/world.js',
    'js/chunk.js', 'js/items.js', 'js/particles.js', 'js/engine.js',
    'tests/e2e/physics_p1_browser_perf_ego.mjs'];
const sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
    [path, createHash('sha256').update(await fs.readFile(`${root}/${path}`)).digest('hex')])));
const task = await taskSpace(161), page = task.page('p5');
const pageUrl = await page.url();
if (!/^http:\/\/(localhost|127\.0\.0\.1):18438\//.test(pageUrl)) {
    throw new Error(`Refusing to replace a world outside the dedicated 18438 test origin: ${pageUrl}`);
}
await page.cdp('Page.setWebLifecycleState', { state: 'active' });
await page.goto(new URL('/', pageUrl).href);
await page.waitForFunction(() => !!document.querySelector('.slot-start'), undefined, { timeout: 20000 });

const environment = await page.evaluate(async () => {
    const names = ['config', 'kinetic', 'world', 'chunk', 'items', 'particles', 'engine',
        'state', 'uiModal', 'input', 'levelEditor', 'entities', 'redstone'];
    const modules = await Promise.all(names.map(name => import(`/js/${name}.js`)));
    const q = window.__p1visual = Object.fromEntries(names.map((name, i) => [name, modules[i]]));
    const s = q.state.state, C = q.config, B = C.BlockTypes;
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    check(q.engine.renderer.isWebGLRenderer, 'Real WebGL renderer required');
    check(q.particles.particleSystem.points?.isPoints, 'Real particle geometry required');
    q.input.clearKeys();
    q.levelEditor.cancelPlacing();
    s.levelRun = s.levelEdit = null;
    s.gameMode = C.GameModes.SURVIVAL;
    q.uiModal.setState('pause');
    check(q.uiModal.isWorldPaused(), 'Main-loop world ticking must stay paused');
    q.entities.clearAllEnemies();
    q.items.clearItemDrops();
    q.particles.clearParticles();
    for (const key of [...s.chunkMeshes.keys()]) q.chunk.disposeChunk(...key.split(',').map(Number));
    s.blocks = new Uint8Array(C.WORLD_WIDTH * C.WORLD_HEIGHT * C.WORLD_DEPTH);
    s.worldSeed = 20261018;
    s.bedDirtyCells.length = 0;
    s.lifePendingDrops.length = 0;
    s.lifePendingAnimals.length = 0;
    Object.assign(s.player, { x: 240, y: 100, z: 240, vx: 0, vy: 0, vz: 0 });
    const chunks = new Set(), targets = [], machines = [];
    const put = (x, y, z, id) => {
        q.world.setBlockSafe(x, y, z, id);
        chunks.add(`${Math.floor(x / C.CHUNK_SIZE)},${Math.floor(z / C.CHUNK_SIZE)}`);
    };
    // Same public drive geometry as physics-perf.mjs: six waterwheels per line,
    // with two genuine large-to-small contacts producing native 32 RPM.
    for (let i = 0; i < 10; i++) {
        const x = 31, y = 9, z = 20 + 18 * i;
        for (let fx = 16; fx <= 35; fx++) {
            for (let fz = z - 3; fz <= z + 1; fz++) put(fx, 8, fz, B.STONE);
        }
        for (let sx = x - 13; sx <= x - 8; sx++) {
            put(sx, y, z - 2, C.waterwheelId(0));
            put(sx, y + 1, z - 2, B.WATER);
        }
        put(x - 7, y, z - 2, C.largeCogId(0));
        put(x - 7, y, z - 1, C.cogId(0));
        put(x - 6, y, z - 1, C.shaftId(0));
        put(x - 5, y, z - 1, C.largeCogId(0));
        put(x - 5, y, z, C.cogId(0));
        for (let sx = x - 4; sx <= x; sx++) put(sx, y, z, C.shaftId(0));
        put(32, y, z, C.sawId(3));
        machines.push([32, y, z]);
        targets.push([33, y, z]);
    }
    q.redstone.initRedstone();
    q.kinetic.initKinetic();
    for (const key of chunks) q.chunk.rebuildChunk(...key.split(',').map(Number));
    for (const p of machines) {
        const info = q.kinetic.kineticInfoAt(...p);
        check(info?.running && Math.abs(info.rpm) === 32, `Machine ${p} must run at 32 RPM`);
    }
    const { renderer, camera, scene } = q.engine;
    renderer.setPixelRatio(1);
    renderer.setSize(1280, 720, false);
    camera.aspect = 1280 / 720;
    camera.fov = 75;
    camera.far = 300;
    camera.position.set(80, 85, 101);
    camera.lookAt(27, 9, 101);
    camera.updateProjectionMatrix();
    // All ten spaced lines fit in one view; remove distance fog for this fixture.
    scene.fog = null;
    renderer.render(scene, camera);
    check(renderer.info.render.calls > 0 && renderer.info.render.triangles > 0,
        'Actual scene geometry must be submitted to WebGL');
    let realChunkMeshes = 0;
    for (const group of s.chunkMeshes.values()) group.traverse(child => {
        if (child.isMesh && child.geometry?.attributes?.position?.count > 0) realChunkMeshes++;
    });
    check(realChunkMeshes > 0, 'Real chunk mesh geometry required');
    const markChunks = (set, x, z) => {
        const cx = Math.floor(x / C.CHUNK_SIZE), cz = Math.floor(z / C.CHUNK_SIZE);
        const add = (a, b) => {
            if (a >= 0 && b >= 0 && a < C.WORLD_WIDTH / C.CHUNK_SIZE && b < C.WORLD_DEPTH / C.CHUNK_SIZE) {
                set.add(`${a},${b}`);
            }
        };
        add(cx, cz);
        if (x % C.CHUNK_SIZE === 0) add(cx - 1, cz);
        if (x % C.CHUNK_SIZE === C.CHUNK_SIZE - 1) add(cx + 1, cz);
        if (z % C.CHUNK_SIZE === 0) add(cx, cz - 1);
        if (z % C.CHUNK_SIZE === C.CHUNK_SIZE - 1) add(cx, cz + 1);
    };
    const probe = window.__p1BrowserPerf = {
        frame: -120, endFrame: 600, dt: 1 / 60, seed: 20261018, all: [], completed: [],
        raw: [], completions: 0, outputItems: 0, refillChunkRebuilds: 0,
        maxParticles: 0, minParticles: Infinity, before: null, warmParticles: null,
        explicitRenders: 0, allRpmCorrect: true, actualOutputPlanks: true,
        completionChunksReplaced: true, collectorCount: 0,
    };
    probe.run = count => {
        check(q.uiModal.isWorldPaused() && q.uiModal.getUIState() === 'pause', 'Unexpected live main-loop world');
        const originalRandom = Math.random;
        // Only this synchronous batch owns the deterministic stream. Never alter the
        // browser's Math.random across calls or allow unrelated main ticks to consume it.
        Math.random = () => ((probe.seed = (Math.imul(probe.seed, 1664525) + 1013904223) >>> 0) / 4294967296);
        try {
            for (let j = 0; j < count && probe.frame < probe.endFrame; j++, probe.frame++) {
                if (probe.frame === 0) {
                    probe.before = q.kinetic.kineticDiagnostics();
                    probe.warmParticles = q.particles.particleSystem.particles.length;
                }
                const replenished = new Set();
                const t = performance.now();
                for (const p of targets) if (q.world.getBlock(...p) === B.AIR) {
                    q.world.setBlockSafe(...p, B.WOOD);
                    markChunks(replenished, p[0], p[2]);
                }
                // Replenishment mesh updates are counted too, so no new input is
                // visually omitted to make the sample cheaper.
                for (const key of replenished) q.chunk.rebuildChunk(...key.split(',').map(Number));
                const previousChunks = targets.map(p => s.chunkMeshes.get(`${Math.floor(p[0] / C.CHUNK_SIZE)},${Math.floor(p[2] / C.CHUNK_SIZE)}`));
                q.kinetic.updateKineticTick(probe.dt); // includes real completion rebuilds
                q.items.updateItemDrops(probe.dt);
                q.particles.updateParticles(probe.dt);
                renderer.render(scene, camera);
                const done = targets.filter(p => q.world.getBlock(...p) === B.AIR).length;
                let output = 0;
                for (const drop of s.itemDrops) {
                    probe.actualOutputPlanks &&= drop.itemId === B.PLANKS && drop.mesh.isMesh && drop.mesh.parent === scene;
                    output += drop.count;
                }
                q.items.clearItemDrops(); // bounded fixture collector, after actual output rendering
                const elapsed = performance.now() - t;
                if (probe.frame >= 0) {
                    probe.all.push(elapsed);
                    if (done) probe.completed.push(elapsed);
                    probe.completions += done;
                    probe.outputItems += output;
                    probe.collectorCount += output;
                    probe.refillChunkRebuilds += replenished.size;
                    probe.explicitRenders++;
                    const population = q.particles.particleSystem.particles.length;
                    probe.maxParticles = Math.max(probe.maxParticles, population);
                    probe.minParticles = Math.min(probe.minParticles, population);
                    probe.raw.push({ frame: probe.frame, elapsedMs: elapsed, completions: done,
                        outputItems: output, particlePopulation: population,
                        renderCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
                    if (done) {
                        for (let k = 0; k < targets.length; k++) {
                            const p = targets[k];
                            if (q.world.getBlock(...p) === B.AIR) {
                                const key = `${Math.floor(p[0] / C.CHUNK_SIZE)},${Math.floor(p[2] / C.CHUNK_SIZE)}`;
                                probe.completionChunksReplaced &&= previousChunks[k] !== s.chunkMeshes.get(key);
                            }
                        }
                    }
                }
            }
        } finally { Math.random = originalRandom; }
        for (const p of machines) {
            const info = q.kinetic.kineticInfoAt(...p);
            probe.allRpmCorrect &&= info?.running === true && Math.abs(info.rpm) === 32;
        }
        return { sampledFrames: Math.max(0, probe.frame), completions: probe.completions,
            outputItems: probe.outputItems, particlePopulation: q.particles.particleSystem.particles.length };
    };
    const gl = renderer.getContext();
    return { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
        devicePixelRatio: window.devicePixelRatio, rendererPixelRatio: renderer.getPixelRatio(),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        webglVersion: gl.getParameter(gl.VERSION), webglRenderer: gl.getParameter(gl.RENDERER),
        shadowMapEnabled: renderer.shadowMap.enabled, sceneFog: null,
        camera: { position: camera.position.toArray(), lookAt: [27, 9, 101], fov: 75, far: 300 },
        chunkGroups: s.chunkMeshes.size, realChunkMeshes, actualProps: s.droppedItems.length,
        worldPaused: q.uiModal.isWorldPaused(), uiState: q.uiModal.getUIState(),
        fixture: 'Ten separate 20 × 5 stone strips at y=8; z=20+18*i, saw=(32,9,z), log=(33,9,z)' };
});
console.log({ phase: 'setup', environment });

// Bounded synchronous calls: 120 warmup steps then 600 actual simulation steps.
// Pause mode blocks the ordinary game-loop world tick between calls. These are
// manual 1/60-s active steps, not requestAnimationFrame/presentation measurements.
for (let i = 0; i < 24; i++) {
    const progress = await page.evaluate(() => window.__p1BrowserPerf.run(30));
    if (i % 4 === 3) console.log({ phase: 'sampling', ...progress });
}
const production = await page.evaluate(() => {
    const q = window.__p1visual, p = window.__p1BrowserPerf;
    const stats = a => {
        const sorted = [...a].sort((x, y) => x - y);
        return { n: a.length, meanMs: a.reduce((x, y) => x + y, 0) / a.length,
            p95Ms: sorted[Math.ceil(a.length * 0.95) - 1], maxMs: sorted.at(-1) };
    };
    const after = q.kinetic.kineticDiagnostics();
    const diagnostics = Object.fromEntries(Object.keys(after).filter(k => typeof after[k] === 'number')
        .map(k => [k, after[k] - (p.before[k] ?? 0)]));
    const checks = {
        activeFrames600: p.all.length === 600, native32Rpm: p.allRpmCorrect,
        consumed800Logs: p.completions === 800, produced3200Planks: p.outputItems === 3200,
        realPlankEntities: p.actualOutputPlanks, collectorConservesOutput: p.collectorCount === p.outputItems,
        networkRebuildsZero: diagnostics.networkRebuilds === 0,
        diagnosticCompletionsAgree: diagnostics.machineCompletions === p.completions,
        actualCompletionChunkRebuilds: p.completionChunksReplaced,
        renderedEveryStep: p.explicitRenders === 600 && p.raw.every(f => f.renderCalls > 0 && f.triangles > 0),
        particlesHaveLiveLifecycle: p.minParticles > 0 && p.maxParticles < 2000,
        mainLoopWorldPaused: q.uiModal.isWorldPaused(),
    };
    return { machines: 10, rpm: 32, capacityPerLine: 384, warmFrames: 120, sampleFrames: 600,
        activeFrames: p.all.length, simulatedSeconds: 10, dt: p.dt, seed: 20261018,
        completions: p.completions, outputItems: p.outputItems,
        allFrames: stats(p.all), completionFrames: stats(p.completed),
        explicitRenders: p.explicitRenders, refillChunkRebuilds: p.refillChunkRebuilds,
        particlePopulation: { atSampleStart: p.warmParticles,
            atSampleEnd: q.particles.particleSystem.particles.length, min: p.minParticles,
            max: p.maxParticles, lifecycleAdvanced: true },
        diagnostics, checks, functionalChecksPassed: Object.values(checks).every(Boolean), rawFrames: p.raw };
});
const result = {
    schema: 'mcweb.physics-p1.browser-performance.v1', recordedAt: new Date().toISOString(),
    scene: 'P1-P03 real-browser continuous saw production', pageUrl, sourceSha256, environment,
    measurement: {
        unit: 'CPU wall milliseconds per manually advanced active step',
        includes: ['public block replenishment and deduplicated real chunk rebuilds',
            'native kinetic tick with real machine-completion chunk/prop rebuilds',
            'real output entity update, scene insertion, rendering and collector cleanup',
            'real particle lifetime/geometry updates', 'renderer.render WebGL CPU submission'],
        excludes: ['fixture setup and 120 warmup steps', 'GPU completion/presentation time',
            'browser bridge/IPC and idle time between bounded batches',
            'ordinary main-loop UI, survival, entities and player ticks'],
        gpuSynchronized: false,
        comparison: 'No historical browser threshold was frozen; Node 8 RPM and proxy32 budgets are not browser budgets.',
        performanceGate: 'UNASSESSED — current-build observation only; no historical browser pass/fail conclusion.',
    }, production,
};
const outputPath = `${root}/docs/physics-p1-evidence/browser-performance.json`;
await fs.mkdir(`${root}/docs/physics-p1-evidence`, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log({ outputPath, allFrames: production.allFrames, completionFrames: production.completionFrames,
    completions: production.completions, outputItems: production.outputItems,
    diagnostics: production.diagnostics, checks: production.checks,
    performanceGate: result.measurement.performanceGate });

// Release this page's animation/CPU load, retaining the shared task space for QA.
await page.evaluate(() => {
    const q = window.__p1visual;
    q.input.clearKeys();
    q.items.clearItemDrops();
    q.particles.clearParticles();
    q.state.state.blocks = null;
});
await page.goto('about:blank');
if (!production.functionalChecksPassed) throw new Error(`Browser activity checks failed; evidence saved to ${outputPath}`);
