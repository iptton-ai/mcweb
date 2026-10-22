// 按ego-browser skill创建当前目标唯一空间，再执行：
// E2E_SPACE=<空间ID> E2E_BASE=http://127.0.0.1:18439 ego-browser nodejs < tests/e2e/physics_rest_ego.mjs
// 复用该空间p1；只占slot5，结束恢复原世界及原存储，最后由调用方finish空间。
// 注入仅准备场地/站位/已有物资和观察；游戏动作走真实键盘、鼠标和可见按钮。
const SPACE = Number(process.env.E2E_SPACE), ORIGIN = new URL(process.env.E2E_BASE || 'http://127.0.0.1:18439').origin;
if(!Number.isSafeInteger(SPACE)||SPACE<=0)throw new Error('请将当前目标唯一TaskSpace的ID传入E2E_SPACE；不要复用已经finish的空间');
const ROOT = process.env.E2E_ROOT || '/Users/zxnap/code/MyWorks/yltech.edu/game';
const EVIDENCE = ROOT + '/docs/physics-rest-evidence';
const BACKUP = '/tmp/mcweb-physics-rest-' + (new URL(ORIGIN).port || 'default') + '-storage-backup.json';
const task = await taskSpace(SPACE), page = task.page('p1');
const fs = await import('node:fs/promises');
await fs.mkdir(EVIDENCE, { recursive: true });
const results = [], observations = {};
const expect = (value, message) => { if (!value) throw new Error(message); };
const evaluate = (fn, arg) => arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg);
const shot = name => page.screenshot({ path: EVIDENCE + '/' + name + '.png' });
async function check(name, fn) {
    try { const evidence = await fn(); results.push({ name, ok: true, evidence }); console.log('PASS', name); }
    catch (error) {
        const item = { name, ok: false, error: String(error) };
        try { item.runtime = await evaluate(() => { const q=window.__restqa,s=q.state.state,e=document.activeElement;return{
            ui:q.uiModal.getUIState(),paused:q.uiModal.isWorldPaused(),focused:document.hasFocus(),hidden:document.hidden,
            active:e?{tag:e.tagName,id:e.id,label:e.getAttribute('aria-label'),text:e.textContent?.slice(0,120)}:null,
            windowUnfocused:s.windowUnfocused,readingPanels:s.readingPanels,gameMode:s.gameMode,physics:q.physicsLab.physicsDiagnostics(),
            lastTarget:q.lastTarget?q.physicsLab.physicsInfoAt(...q.lastTarget):null};}); } catch {}
        try { item.snapshot = (await page.snapshot()).slice(-7000); await shot('browser-failure-' + results.length); } catch {}
        results.push(item); console.log('FAIL', name, String(error));
        await evaluate(() => { const q = window.__restqa; q.input.clearKeys(); q.physicsUI.closePhysicsPanel(); q.state.state.levelRun = null; q.uiModal.setState('playing'); });
    }
}
async function aim(p, { y, z, x, held, mode } = {}) {
    await evaluate(({ p, y, z, x, held, mode }) => {
        const q = window.__restqa, s = q.state.state, C = q.config;
        q.lastTarget = p;
        q.input.clearKeys(); q.physicsUI.closePhysicsPanel(); q.levelEditor.cancelPlacing();
        s.inputMode = 'keyboard'; s.camMode = 'player'; s.viewMode = 0; s.windowUnfocused = false;
        if (mode) q.ui.setGameMode(mode);
        const px = x ?? p[0] + .5, py = y ?? p[1], pz = z ?? p[2] + 3.3;
        const dx = p[0] + .5 - px, dz = p[2] + .5 - pz;
        Object.assign(s.player, { x: px, y: py, z: pz, vx: 0, vy: 0, vz: 0, flying: false, onGround: true,
            dead: false, health: 20, hunger: 20, yaw: Math.atan2(-dx, -dz),
            pitch: Math.atan2(p[1] + .5 - (py + C.PLAYER_EYE_HEIGHT), Math.hypot(dx, dz)) });
        if (held !== undefined) s.player.selectedSlot = C.HotbarBlocks.indexOf(held);
        q.uiModal.setState('playing'); q.ui.updateHotbar();
    }, { p, y, z, x, held, mode });
}
async function openAt(p, options) {
    await aim(p, options); await page.keyboard.press('x');
    await page.waitForFunction(() => window.__restqa.uiModal.getUIState() === 'physics', undefined, { timeout: 4000 });
}
async function readAt(p) { return evaluate(p => window.__restqa.physicsLab.physicsInfoAt(...p), p); }
async function waitAt(p, expression) {
    await page.waitForFunction(({ p, expression }) => {
        const info = window.__restqa.physicsLab.physicsInfoAt(...p);
        return Function('info', 'return (' + expression + ')')(info);
    }, { p, expression }, { timeout: 7000 });
}

console.log({ space: SPACE, page: page.label, url: await page.url() });
expect((await page.url()).startsWith(ORIGIN + '/'), 'p1 must be the isolated test origin');
await evaluate(async () => { await import('/js/main.js'); });
console.log(await page.snapshot());
await page.cdp('Page.bringToFront');
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const backup = await evaluate(async () => {
    const previous = window.__restqa?.backupRestored ? null : window.__restqa?.backup;
    const names = ['state','config','world','kinetic','redstone','interaction','input','uiModal','ui','chunk',
        'saveGame','physicsLab','physicsData','physicsUI','levelEditor','levelPrefabs','levelWorkshop','levelRun',
        'engine','items','entities','particles','tnt','homeSurvival','lifeData','assistant/snapshot'];
    const modules = await Promise.all(names.map(n => import('/js/' + n + '.js')));
    const q = window.__restqa = Object.fromEntries(names.map((n, i) => [n === 'assistant/snapshot' ? 'snapshot' : n, modules[i]]));
    const s = q.state.state, C = q.config;
    q.backup = previous || { slot: s.saveSlot, slot5: localStorage.getItem('mcweb.save.v1.slot5'),
        index: localStorage.getItem('mcweb.save.index'), snapshot: sessionStorage.getItem('mcAssistant.snapshot'),
        ui: q.uiModal.getUIState(), inputMode: s.inputMode };
    if (!previous) {
        if (!q.snapshot.saveSnapshotForReload()) throw new Error('original world backup failed');
        q.backup.memorySnapshot = sessionStorage.getItem('mcAssistant.snapshot');
    }
    q.backup.levelBest ??= localStorage.getItem('mcweb.levels.v1');
    q.input.clearKeys(); q.physicsUI.closePhysicsPanel(); q.levelEditor.cancelPlacing();
    s.saveSlot = 5; s.levelRun = s.levelEdit = null; s.inputMode = 'keyboard'; s.camMode = 'player'; s.viewMode = 0;
    s.windowUnfocused = false; s.homeGuideEnabled = false; s.survivalStarted = true;
    s.readingPanels = {}; s.time = s.dayLength * .5;
    q.entities.clearAllEnemies(); q.items.clearItemDrops(); q.particles.clearParticles(); q.tnt.clearTntEntities(); q.lifeData.resetLifeData();
    for (const key of [...s.chunkMeshes.keys()]) q.chunk.disposeChunk(...key.split(',').map(Number));
    s.blocks = new Uint8Array(C.WORLD_WIDTH * C.WORLD_HEIGHT * C.WORLD_DEPTH);
    q.physicsData.restorePhysicsState(undefined);
    for (let x = 20; x <= 115; x++) for (let z = 20; z <= 90; z++) q.world.setBlockSafe(x, 8, z, C.BlockTypes.STONE);
    q.world.setBlockSafe(29, 9, 33, C.BlockTypes.CRAFTING_TABLE);
    q.physicsLab.initPhysicsLab(); q.redstone.initRedstone(); q.kinetic.initKinetic();
    for (let x = 1; x <= 7; x++) for (let z = 1; z <= 5; z++) q.chunk.rebuildChunk(x, z);
    q.ui.setGameMode(C.GameModes.SURVIVAL);
    const recipe = C.RECIPES.find(r => r.out === C.PhysicsBlocks.RAMP);
    s.player.inventory = { ...recipe.cost }; s.player.selectedSlot = C.HotbarBlocks.indexOf(C.BlockTypes.STONE);
    Object.assign(s.player, { x: 30.5, y: 9, z: 33.5, yaw: 0, pitch: Math.atan2(8.98 - (9 + C.PLAYER_EYE_HEIGHT), 3),
        vx: 0, vy: 0, vz: 0, flying: false, onGround: true, dead: false, health: 20, hunger: 20 });
    q.uiModal.setState('playing'); q.ui.updateHotbar();
    return q.backup;
});
await fs.writeFile(BACKUP, JSON.stringify(backup));

try {
    await check('BR01 生存真实合成并X放置新组件', async () => {
        await page.keyboard.press('e'); await page.fill('#inv-search', '斜坡');
        await page.click('loc=role:button[name="制作斜坡摩擦实验台"]', { label: '制作斜坡实验台' });
        await page.click('#inventory-grid .inv-slot', { label: '选中刚制作的实验台' });
        await page.keyboard.press('x');
        const r = await evaluate(() => { const q = window.__restqa; return { id: q.world.getBlock(30,9,30), stock: { ...q.state.state.player.inventory } }; });
        expect(r.id === 75 && r.stock[75] === 0 && [11,180,182].every(id => r.stock[id] === 0), JSON.stringify(r));
        return r;
    });
    await check('BR02 X开面板改坡度表面、真实开始与复位', async () => {
        await openAt([30,9,30]);
        console.log(await page.snapshot());
        await page.selectOption('select[aria-label="坡度"]', '1');
        await page.selectOption('select[aria-label="表面"]', '0');
        await shot('browser-ramp-panel');
        observations.rampBeforeStart=await readAt([30,9,30]);
        await page.click('loc=role:button[name="开始实验并观察"]', { label: '开始斜坡实验' });
        observations.rampAfterStart=await evaluate(()=>{const q=window.__restqa;return{info:q.physicsLab.physicsInfoAt(30,9,30),ui:q.uiModal.getUIState(),paused:q.uiModal.isWorldPaused(),active:document.activeElement?.tagName,focused:document.hasFocus(),windowUnfocused:q.state.state.windowUnfocused};});
        await waitAt([30,9,30], 'info.distance>.1');
        const running = await readAt([30,9,30]);
        await shot('browser-ramp-running');
        await page.keyboard.press('x');
        await page.click('loc=role:button[name="复位实验"]', { label: '复位斜坡实验' });
        const reset = await readAt([30,9,30]);
        expect(reset.distance === 0 && reset.elapsed === 0, JSON.stringify(reset));
        await page.keyboard.press('e');
        return { distance: running.distance, surface: running.config.surface, slope: running.config.slope, reset: reset.distance };
    });
    await check('BR03 面板方向键焦点、E/Q关闭与Shift+X绕过', async () => {
        await openAt([30,9,30]);
        await page.waitForFunction(() => document.activeElement?.closest('#physics-panel'), undefined, { timeout: 3000 });
        await page.keyboard.press('ArrowDown');
        expect(await evaluate(() => !!document.activeElement?.closest('#physics-panel')), 'arrow navigation must stay in physics panel');
        // 下拉框沿用全局导航语义：先Esc退出原生选择，再用Q关闭面板。
        if(await evaluate(()=>['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)))await page.keyboard.press('Escape');
        await page.keyboard.press('q');
        expect(await evaluate(() => window.__restqa.uiModal.getUIState()) === 'playing', 'Q closes physics panel');
        await openAt([30,9,30]); await page.keyboard.press('e');
        expect(await evaluate(() => window.__restqa.uiModal.getUIState()) === 'playing', 'E closes physics panel');
        await aim([30,9,30], { held: 3, mode: 'creative' });
        await page.keyboard.down('Shift'); await page.keyboard.press('x'); await page.keyboard.up('Shift');
        const r = await evaluate(() => ({ id: window.__restqa.world.getBlock(30,9,31), ui: window.__restqa.uiModal.getUIState() }));
        expect(r.id === 3 && r.ui === 'playing', JSON.stringify(r));
        await evaluate(() => { const q=window.__restqa;q.world.setBlockSafe(30,9,31,0);q.chunk.rebuildChunk(1,1); });
    });
    await check('BR04 弹簧真实压缩→释放并看到上升', async () => {
        await evaluate(() => { const q=window.__restqa;q.world.setBlockSafe(40,9,30,q.config.PhysicsBlocks.SPRING);q.chunk.rebuildChunk(2,1); });
        await openAt([40,9,30], { mode: 'survival' });
        await page.selectOption('select[aria-label="压缩档位"]', '3');
        await page.click('loc=role:button[name="手动压缩"]', { label: '手动压缩弹簧' });
        await page.click('loc=role:button[name="释放弹簧并观察"]', { label: '释放弹簧观察弹跳' });
        await waitAt([40,9,30], 'info.height>.1');
        const r=await readAt([40,9,30]); expect(r.height>.1, JSON.stringify(r)); return {height:r.height,elapsed:r.elapsed};
    });
    await check('BR05 B组件库十个新模板可见，真实选中并键盘盖章', async () => {
        await aim([30,8,50], { y:9, z:53.5, held:3, mode:'creative' });
        await evaluate(() => {const q=window.__restqa,s=q.state.state,C=q.config;s.player.pitch=Math.atan2(8.98-(9+C.PLAYER_EYE_HEIGHT),3);});
        await page.keyboard.press('b');
        const list=await evaluate(()=>[...document.querySelectorAll('#prefab-grid .pf-name')].map(e=>e.textContent));
        const expected=['三种摩擦对照台','杠杆与支点实验','弹簧压缩实验','定动滑轮对照台','风道运输与测速','定量水路与水闸','抽水与浮块实验','三格宽往返平台','风车动力站','落块与运动 TNT'];
        expect(expected.every(name=>list.some(text=>text.includes(name))), JSON.stringify(list));
        await page.click('#prefab-grid .prefab-item:has-text("三种摩擦对照台")', {label:'选择三种摩擦模板'});
        expect(await evaluate(()=>window.__restqa.levelEditor.getPlacing())==='physics_friction_lab','selected prefab placement must remain active');
        await page.keyboard.press('Enter');
        await page.waitForFunction(()=>window.__restqa.world.getBlock(28,9,49)===75,undefined,{timeout:5000});
        await page.keyboard.press('x');
        expect(await evaluate(()=>!window.__restqa.levelEditor.getPlacing()),'X ends prefab placement');
        return {newTemplates:expected.length};
    });
    await check('BR06 剩余模板盖章、真实模型显示与总览', async () => {
        const layouts=[['physics_lever_lab',45,50],['physics_spring_lab',60,50],['physics_teaching_pulleys',75,50],['physics_fan_lab',95,50],
            ['physics_water_gate',30,72],['physics_pump_float',48,72],['physics_wide_bridge',70,72],['physics_wind_station',90,72],['physics_falling_lab',105,72]];
        const r=await evaluate(async layouts=>{
            const q=window.__restqa,s=q.state.state,C=q.config;s.gameMode='survival';q.uiModal.setState('pause');
            q.layouts={};
            for(const [id,x,z]of layouts){const hit={x,y:8,z,block:C.BlockTypes.STONE,face:{dx:0,dy:1,dz:0}};
                if(!await q.levelEditor.stampPrefabAt(id,hit))throw new Error('stamp '+id);
                q.layouts[id]=q.levelPrefabs.prefabOrigin(q.levelPrefabs.getPrefab(id),hit);
            }
            q.ui.setGameMode('creative');Object.assign(s.player,{x:64,y:25,z:89,yaw:0,pitch:-.55,flying:true,vx:0,vy:0,vz:0});q.uiModal.setState('playing');
            return {props:s.droppedItems.filter(p=>p.prop&&C.isPhysicsId(q.world.getBlock(p.x,p.y,p.z))).length,devices:q.physicsLab.physicsDiagnostics().cells};
        },layouts);
        await page.waitForFunction(()=>window.__restqa.engine.camera.position.y>24,undefined,{timeout:4000});
        await shot('browser-physics-overview');expect(r.props>=20,JSON.stringify(r));return r;
    });
    await check('BR07 水桶连续真实X注水取水，水与库存守恒', async () => {
        await evaluate(()=>{const q=window.__restqa,s=q.state.state,C=q.config;q.world.setBlockSafe(40,9,36,C.troughId(0));q.chunk.rebuildChunk(2,2);s.player.inventory={[C.LifeItems.WATER_BUCKET]:1,[C.LifeItems.BUCKET]:2};});
        await aim([40,9,36],{held:260,mode:'survival'});
        await page.keyboard.press('x');
        let r=await evaluate(()=>{const q=window.__restqa;return{water:q.config.troughWater(q.world.getBlock(40,9,36)),held:q.config.HotbarBlocks[q.state.state.player.selectedSlot],stock:{...q.state.state.player.inventory}};});
        expect(r.water===4&&r.stock[260]===0&&r.stock[259]===3&&r.held===259,JSON.stringify(r));
        await page.keyboard.press('x');
        r=await evaluate(()=>{const q=window.__restqa;return{water:q.config.troughWater(q.world.getBlock(40,9,36)),held:q.config.HotbarBlocks[q.state.state.player.selectedSlot],stock:{...q.state.state.player.inventory}};});
        expect(r.water===0&&r.stock[260]===1&&r.stock[259]===2&&r.held===260,JSON.stringify(r));return r;
    });
    await check('BR08 真实水闸按钮改变水路，泵与浮块可见运行', async () => {
        const p=await evaluate(()=>{const o=window.__restqa.layouts.physics_water_gate;return[o.x+3,o.y+1,o.z+2];});
        await openAt(p,{mode:'survival',held:3});
        await page.click('loc=role:button[name="开关水闸"]',{label:'打开实验水闸'});await page.keyboard.press('e');
        await page.waitForFunction(p=>{const q=window.__restqa;return q.config.troughWater(q.world.getBlock(p[0]+1,p[1],p[2]))>0;},p,{timeout:4000});
        const pump=await evaluate(()=>{
            const q=window.__restqa,s=q.state.state,C=q.config,o=q.layouts.physics_pump_float;s.gameMode='survival';q.uiModal.setState('pause');
            const p=[o.x+4,o.y+1,o.z+2],input=[o.x+4,o.y+1,o.z+3],output=[o.x+5,o.y+2,o.z+2];
            q.world.setBlockSafe(...input,C.troughId(4));q.world.setBlockSafe(...output,C.troughId(0));q.chunk.rebuildChunk(Math.floor(p[0]/16),Math.floor(p[2]/16));
            return{p,input,output};
        });
        await aim(pump.p,{mode:'survival',held:3});
        await page.waitForFunction(p=>window.__restqa.physicsLab.physicsInfoAt(...p).water>0,pump.output,{timeout:5000});
        const r=await evaluate(s=>{const q=window.__restqa;return{pump:q.physicsLab.physicsInfoAt(...s.p),input:q.physicsLab.physicsInfoAt(...s.input),output:q.physicsLab.physicsInfoAt(...s.output)};},pump);
        expect(r.input.water+r.output.water===4&&r.output.height>0,JSON.stringify(r));
        await openAt(pump.output,{mode:'survival',held:3});await shot('browser-water-float-panel');await page.keyboard.press('e');
        return{rpm:r.pump.rpm,water:r.output.water,floatHeight:r.output.height};
    });
    await check('BR09 宽平台边缘真实玩家防夹、恢复载人、拉杆回程', async () => {
        const scene=await evaluate(()=>{
            const q=window.__restqa,s=q.state.state,C=q.config,o=q.layouts.physics_wide_bridge;s.gameMode='survival';q.uiModal.setState('pause');
            const p=[o.x+3,o.y+2,o.z+3];
            for(let x=p[0];x<=p[0]+8;x++)for(let z=p[2]-1;z<=p[2]+1;z++)if(q.world.getBlock(x,p[1]+1,z)===C.PLATFORM_BASE)q.world.setBlockSafe(x,p[1]+1,z,0);
            for(let z=p[2]-1;z<=p[2]+1;z++)q.world.setBlockSafe(p[0],p[1]+1,z,C.PLATFORM_BASE);
            q.physicsLab.configurePhysicsAt(...p,{dir:1,width:3,length:4,offset:0});
            const ceiling=[p[0]+1,p[1]+3,p[2]+1];q.world.setBlockSafe(...ceiling,C.BlockTypes.STONE);
            q.redstone.initRedstone();q.kinetic.initKinetic();q.physicsLab.initPhysicsLab();
            for(let x=Math.floor((p[0]-2)/16);x<=Math.floor((p[0]+8)/16);x++)q.chunk.rebuildChunk(x,Math.floor(p[2]/16));
            Object.assign(s.player,{x:p[0]+.5,y:p[1]+2,z:p[2]+1.65,yaw:0,pitch:0,vx:0,vy:0,vz:0,flying:false,onGround:true,dead:false,health:20});
            s.inputMode='keyboard';s.camMode='player';s.viewMode=0;q.input.clearKeys();q.uiModal.setState('playing');
            return{p,ceiling,startX:s.player.x};
        });
        await waitAt(scene.p,'info.blocked');
        const stopped=await readAt(scene.p);expect(stopped.config.offset===0,JSON.stringify(stopped));
        await evaluate(c=>{const q=window.__restqa;q.world.setBlockSafe(...c,0);q.chunk.rebuildChunk(Math.floor(c[0]/16),Math.floor(c[2]/16));},scene.ceiling);
        await waitAt(scene.p,'info.config.offset>=1');
        const carried=await evaluate(()=>({x:window.__restqa.state.state.player.x,y:window.__restqa.state.state.player.y}));
        expect(carried.x>scene.startX+.8,JSON.stringify(carried));
        await page.keyboard.press('v');await shot('browser-wide-platform-rider');
        await waitAt(scene.p,'info.config.offset===4');
        const lever=[scene.p[0],scene.p[1]-1,scene.p[2]];
        await aim(lever,{x:scene.p[0]-1.4,y:scene.p[1]-1,z:scene.p[2]+3.1,held:3,mode:'survival'});
        const hit=await evaluate(()=>window.__restqa.interaction.raycastBlocks());
        expect(hit&&hit.x===lever[0]&&hit.y===lever[1]&&hit.z===lever[2],JSON.stringify(hit));
        await page.keyboard.press('x');await waitAt(scene.p,'info.config.offset===0');
        return{startX:scene.startX,carriedX:carried.x,returnOffset:(await readAt(scene.p)).config.offset};
    });
    await check('BR10 游戏内说明入口可打开新帮助', async () => {
        await page.keyboard.press('q');await page.click('#btn-help',{label:'打开游戏说明目录'});
        await page.click('#help-toc .help-row:has-text("搭自己的物理实验室")',{label:'查看物理实验说明'});
        await page.waitForFunction(()=>document.getElementById('help-frame')?.contentDocument?.querySelector('h1')?.textContent==='把物理实验搭进世界',undefined,{timeout:5000});
        await page.click('#help-close',{label:'关闭物理实验说明'});await page.keyboard.press('q');
    });
    await check('BR11 真试玩关卡后，作者授权实验可玩、参数与桶不可越权', async () => {
        await evaluate(()=>{
            const q=window.__restqa,s=q.state.state,C=q.config;q.ui.setGameMode('creative');q.uiModal.setState('playing');
            for(const [x,z,kind]of [[26,26,C.FLAG_START],[40,36,C.FLAG_GOAL]])q.world.setBlockSafe(x,9,z,C.flagId(kind));
            for(const [x,allowRun]of [[30,false],[34,true]]){q.world.setBlockSafe(x,9,30,C.PhysicsBlocks.RAMP);q.physicsLab.configurePhysicsAt(x,9,30,{allowRun});}
            q.world.setBlockSafe(36,9,31,C.troughId(0));s.player.inventory[C.LifeItems.WATER_BUCKET]=1;
            for(let x=1;x<=2;x++)for(let z=1;z<=2;z++)q.chunk.rebuildChunk(x,z);
        });
        await page.keyboard.press('q');await page.click('#btn-levels',{label:'打开关卡试玩入口'});await page.click('#btn-level-try',{label:'试玩当前实验关卡'});
        await page.waitForFunction(()=>!!window.__restqa.state.state.levelRun,undefined,{timeout:7000});
        const targets=await evaluate(()=>{
            const q=window.__restqa,r=q.state.state.levelRun.card.region,o=q.levelWorkshop.LEVEL_EMBED_OFFSET;
            return [[30,9,30],[34,9,30],[36,9,31],[40,9,36]].map(p=>p.map((v,i)=>v-[r.x0,r.y0,r.z0][i]+[o.x,o.y,o.z][i]));
        });
        await openAt(targets[0],{held:3});
        const locked=await evaluate(()=>({selects:[...document.querySelectorAll('#physics-panel select')].every(e=>e.disabled),start:[...document.querySelectorAll('#physics-panel button')].find(e=>e.textContent==='开始实验并观察')?.disabled}));
        expect(locked.selects&&locked.start,JSON.stringify(locked));await page.keyboard.press('e');
        await openAt(targets[1],{held:3});await page.click('loc=role:button[name="开始实验并观察"]',{label:'启动作者开放的实验'});await waitAt(targets[1],'info.distance>.05');
        await aim(targets[2],{held:260});await page.keyboard.press('x');
        expect((await readAt(targets[2])).water===0,'level bucket action must be refused');
        const g=targets[3];await aim(g,{z:g[2]+2.3,y:g[1],held:3});
        await page.keyboard.down('w');
        try{await page.waitForFunction(()=>!!window.__restqa.state.state.levelResult,undefined,{timeout:6000});}finally{await page.keyboard.up('w');}
        await page.click('#btn-result-exit',{label:'退出实验试玩关卡'});
        await page.waitForFunction(()=>!window.__restqa.state.state.levelRun,undefined,{timeout:7000});
        return locked;
    });
    await check('BR12 真实WebGL预热3轮后20轮建拆/存读/清世界稳定', async () => {
        const models=await evaluate(()=>{
            const q=window.__restqa,s=q.state.state,C=q.config;
            q.input.clearKeys();q.physicsUI.closePhysicsPanel();q.levelEditor.cancelPlacing();s.levelRun=s.levelEdit=null;s.saveSlot=5;
            s.gameMode='survival';q.uiModal.setState('pause');
            const blank=()=>{
                q.entities.clearAllEnemies();q.items.clearItemDrops();q.particles.clearParticles();q.tnt.clearTntEntities();q.lifeData.resetLifeData();
                for(const key of [...s.chunkMeshes.keys()])q.chunk.disposeChunk(...key.split(',').map(Number));
                s.blocks=new Uint8Array(C.WORLD_WIDTH*C.WORLD_HEIGHT*C.WORLD_DEPTH);q.physicsData.restorePhysicsState(undefined);
                for(let x=32;x<48;x++)for(let z=32;z<48;z++)q.world.setBlockSafe(x,8,z,C.BlockTypes.STONE);
                q.redstone.initRedstone();q.kinetic.initKinetic();q.physicsLab.initPhysicsLab();q.chunk.rebuildChunk(2,2);
                q.engine.camera.position.set(38,16,44);q.engine.camera.lookAt(37,9,37);q.engine.camera.updateMatrixWorld(true);
                q.engine.renderer.render(q.engine.scene,q.engine.camera);
            };
            const read=()=>{const materials=new Set();q.engine.scene.traverse(m=>{for(const material of Array.isArray(m.material)?m.material:m.material?[m.material]:[])materials.add(material.uuid);});return{
                geometries:q.engine.renderer.info.memory.geometries,textures:q.engine.renderer.info.memory.textures,programs:q.engine.renderer.info.programs.length,
                materials:materials.size,scene:q.engine.scene.children.length,props:s.droppedItems.length,drops:s.itemDrops.length,
                cells:q.physicsLab.physicsDiagnostics().cells,runtime:q.physicsLab.physicsDiagnostics().runtime,
                windLevels:q.physicsLab.physicsDiagnostics().windLevels};};
            q.resourceHarness={blank,read,ids:[...Object.values(C.PhysicsBlocks),...C.TROUGH_IDS]};
            return q.resourceHarness.ids.length;
        });
        // 每轮独立执行，避开宿主14秒单次页面脚本时限；轮间世界保持暂停。
        const samples=[];
        for(let cycle=0;cycle<23;cycle++){
            samples.push(await evaluate(cycle=>{
                const q=window.__restqa,C=q.config,h=q.resourceHarness;h.blank();
                for(const[i,id]of h.ids.entries())q.world.setBlockSafe(34+i%6,9,34+Math.floor(i/6)*2,id);
                q.physicsLab.initPhysicsLab();q.redstone.initRedstone();q.kinetic.initKinetic();q.chunk.rebuildChunk(2,2);
                q.engine.renderer.render(q.engine.scene,q.engine.camera);
                if(!q.saveGame.saveGame()||!q.saveGame.loadGame(5))throw new Error('resource save/load failed at '+cycle);
                for(const[i,id]of h.ids.entries())if(q.world.getBlock(34+i%6,9,34+Math.floor(i/6)*2)!==id)throw new Error('model id failed '+id);
                h.blank();return h.read();
            },cycle));
            await fs.writeFile(EVIDENCE+'/browser-resources-progress.json',JSON.stringify({models,complete:cycle+1,samples},null,2));
        }
        const measured=samples.slice(3),reference=JSON.stringify(measured[0]);
        const resource={warmup:3,cycles:20,models,samples,stable:measured.every(s=>JSON.stringify(s)===reference),
            runtimeZero:measured.every(s=>s.cells===0&&s.runtime===0&&s.windLevels===0&&s.props===0&&s.drops===0)};
        await fs.writeFile(EVIDENCE+'/browser-resources-20-cycles.json',JSON.stringify(resource,null,2));
        expect(resource.stable&&resource.runtimeZero,JSON.stringify(resource));return{models:resource.models,cycles:resource.cycles,final:resource.samples.at(-1)};
    });
    await check('BR13 实际Three.Box3检查坡度、杠杆极值与四绳模型边界', async () => {
        const p=[40,9,40],bounds=[];
        const cases=[...[0,1,2,3].map(slope=>({name:'ramp-'+slope,id:75,config:{slope,surface:0},action:'start'})),
            ...[1,2,3].flatMap(pivot=>[0,1].map(side=>({name:`lever-${pivot}-${side}`,id:76,
                config:{pivot,leftArm:2,rightArm:2,leftMass:side?0:4,rightMass:side?4:0},action:'start'}))),
            {name:'pulley-four-ropes',id:78,config:{ropes:2,travel:3,mass:4},action:'pull'},
            {name:'fan',id:79,config:{dir:1}}, {name:'windmill',id:99,config:{}}];
        for(const spec of cases){
            await evaluate(({p,spec})=>{
                const q=window.__restqa,C=q.config;q.physicsUI.closePhysicsPanel();q.input.clearKeys();
                q.world.setBlockSafe(...p,spec.id);const configured=q.physicsLab.configurePhysicsAt(...p,spec.config);
                if(!configured.ok)throw new Error(JSON.stringify(configured));
                if(spec.id===79){q.world.setBlockSafe(38,9,40,C.waterwheelId(0));q.world.setBlockSafe(38,10,40,C.BlockTypes.WATER);q.world.setBlockSafe(39,9,40,C.shaftId(0));}
                q.chunk.rebuildChunk(2,2);q.kinetic.updateKineticNetwork();
            },{p,spec});
            if(spec.action){
                await openAt(p,{held:3,mode:'creative'});
                await page.click(spec.action==='pull'?'loc=role:button[name="拉绳并观察"]':'loc=role:button[name="开始实验并观察"]',{label:'运行模型边界样本'});
            }else await aim(p,{held:3,mode:'creative'});
            const result=await evaluate(async({p,name})=>{
                const q=window.__restqa,THREE=await import('three'),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
                const rotor=name==='fan'||name==='windmill',started=performance.now();let frames=0;
                await new Promise(resolve=>{const frame=()=>{
                    const prop=q.state.state.droppedItems.find(v=>v.prop&&v.x===p[0]&&v.y===p[1]&&v.z===p[2]);
                    if(prop){prop.mesh.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(prop.mesh,true);
                        const lo=[box.min.x-p[0],box.min.y-p[1],box.min.z-p[2]],hi=[box.max.x-p[0],box.max.y-p[1],box.max.z-p[2]];
                        for(let i=0;i<3;i++){min[i]=Math.min(min[i],lo[i]);max[i]=Math.max(max[i],hi[i]);}}
                    if(++frames>=35&&(!rotor||performance.now()-started>=8000))resolve();else requestAnimationFrame(frame);
                };requestAnimationFrame(frame);});
                return{name,min,max,frames,elapsedMs:performance.now()-started,info:q.physicsLab.physicsInfoAt(...p),withinCell:min.every(v=>v>=-.001)&&max.every(v=>v<=1.001)};
            },{p,name:spec.name});
            expect(result.min.every(Number.isFinite)&&result.max.every(Number.isFinite),'actual model must exist: '+spec.name);
            if(spec.name==='fan'||spec.name==='windmill')expect(result.info.rpm===8,'rotor must run through a full turn at 8 RPM: '+spec.name);
            bounds.push(result);
        }
        const report={samples:bounds,scope:'实际游戏场景prop、真实Three.Box3 precise=true、各姿态至少35个rAF帧；风扇风车各观察8秒覆盖8RPM完整旋转',outliers:bounds.filter(v=>!v.withinCell)};
        observations.modelBounds=report.outliers.map(v=>({name:v.name,min:v.min,max:v.max}));
        await fs.writeFile(EVIDENCE+'/browser-model-bounds.json',JSON.stringify(report,null,2));
        expect(report.outliers.length===0,JSON.stringify(observations.modelBounds));
        return{poses:bounds.length,withinCell:true};
    });
} finally {
    const restoration=await evaluate(()=>{
        const q=window.__restqa,s=q.state.state,b=q.backup;q.input.clearKeys();q.physicsUI.closePhysicsPanel();q.levelEditor.cancelPlacing();
        s.levelRun=s.levelEdit=null;s.saveSlot=b.slot;s.inputMode=b.inputMode;s.windowUnfocused=false;
        sessionStorage.setItem('mcAssistant.snapshot',b.memorySnapshot);
        const memoryRestored=q.snapshot.restoreSnapshotIfAny();
        const put=(store,key,value)=>value===null?store.removeItem(key):store.setItem(key,value);
        put(localStorage,'mcweb.save.v1.slot5',b.slot5);put(localStorage,'mcweb.save.index',b.index);put(localStorage,'mcweb.levels.v1',b.levelBest??null);
        put(sessionStorage,'mcAssistant.snapshot',b.snapshot);s.saveSlot=b.slot;q.uiModal.setState(b.ui);q.backupRestored=true;
        return{memoryRestored,slot5Restored:localStorage.getItem('mcweb.save.v1.slot5')===b.slot5,indexRestored:localStorage.getItem('mcweb.save.index')===b.index};
    });
    observations.restoration=restoration;expect(restoration.memoryRestored&&restoration.slot5Restored&&restoration.indexRestored,'original storage restoration failed');
    await page.cdp('Emulation.clearDeviceMetricsOverride');
    await fs.writeFile(EVIDENCE+'/browser-input.json',JSON.stringify({date:new Date().toISOString(),space:SPACE,page:page.label,origin:ORIGIN,results,observations},null,2));
}
console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,total:results.length,results,observations},null,2));
if(results.some(r=>!r.ok))process.exitCode=1;
