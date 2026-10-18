// Run with: ego-browser nodejs < /absolute/repo/tests/e2e/physics_p1_ego.mjs
// Resume the task's existing space; create/close one dedicated test tab per run.
// Adjust the space ID when adopting this script in a later task. Never clear the browser profile.
// All player actions use trusted browser keyboard/mouse; injection sets fixtures and observes results.
const task = await taskSpace(161);
const page = await task.newPage();
const results = [];
const expect = (v, message) => { if (!v) throw new Error(message); };
const evaluate = (fn, arg) => arg===undefined?page.evaluate(fn):page.evaluate(fn, arg);
async function check(name, fn) {
    try { await fn(); results.push({ name, ok: true }); console.log('PASS', name); }
    catch (error) { results.push({ name, ok: false, classification:String(error).includes('POINTER_LOCK_ENVIRONMENT')?'environment-blocked':'failure',error: String(error) }); console.log('FAIL', name, String(error)); }
}
async function aim() {
    await evaluate(() => {
        const q=window.__p1qa,s=q.state.state,C=q.config;
        q.input.clearKeys();s.inputMode='keyboard';s.camMode='player';s.viewMode=0;s.windowUnfocused=false;
        s.levelRun=null;s.player.dead=false;s.player.health=20;
        Object.assign(s.player,{x:30.5,y:9,z:33.3,yaw:0,pitch:Math.atan2(10.5-(9+C.PLAYER_EYE_HEIGHT),2.8),vx:0,vy:0,vz:0,flying:false,onGround:true});
        q.world.setBlockSafe(30,10,31,0);q.uiModal.setState('playing');
    });
}
async function waitRPM(value) {
    await page.waitForFunction(value => window.__p1qa.kinetic.kineticInfoAt(31,10,30).rpm===value, value, {timeout:4000});
}
async function pressCrank() { await page.keyboard.down('x'); await waitRPM(8); }
async function releaseCrank() { await page.keyboard.up('x'); await waitRPM(0); }
const storageBackup=await evaluate(()=>{const q=window.__p1qa;return q?{oldSaveSlot:q.oldSaveSlot,saveBefore:q.saveBefore}:null;});
await page.goto('http://127.0.0.1:18437/');
await page.waitForFunction(()=>!!document.querySelector('.slot-start'),undefined,{timeout:20000});
await page.cdp('Page.bringToFront');
console.log(await evaluate(async (before) => {
    const names=['state','config','world','kinetic','redstone','interaction','input','uiModal','ui','chunk','saveGame'];
    const modules=await Promise.all(names.map(n=>import('/js/'+n+'.js')));
    const q=window.__p1qa=Object.fromEntries(names.map((n,i)=>[n,modules[i]]));
    const s=q.state.state,C=q.config;
    q.oldSaveSlot=before?.oldSaveSlot ?? s.saveSlot;
    q.saveBefore=before && 'saveBefore' in before ? before.saveBefore : localStorage.getItem('mcweb.save.v1.slot5');
    q.indexBefore=localStorage.getItem('mcweb.save.v1.index');
    s.saveSlot=5;q.input.clearKeys();s.inputMode='keyboard';s.gameMode=C.GameModes.CREATIVE;s.camMode='player';s.viewMode=0;s.windowUnfocused=false;
    s.levelRun=s.levelEdit=null;s.player.dead=false;s.player.health=20;s.enemies.length=0;
    for(const key of [...s.chunkMeshes.keys()])q.chunk.disposeChunk(...key.split(',').map(Number));
    s.blocks=new Uint8Array(C.WORLD_WIDTH*C.WORLD_HEIGHT*C.WORLD_DEPTH);
    for(let x=20;x<=45;x++)for(let z=20;z<=45;z++)q.world.setBlockSafe(x,8,z,C.BlockTypes.STONE);
    q.world.setBlockSafe(30,10,30,C.crankId(0));q.world.setBlockSafe(31,9,30,C.BlockTypes.STONE);
    q.world.setBlockSafe(31,10,30,C.beltId(1));q.kinetic.initKinetic();q.redstone.initRedstone();
    s.player.selectedSlot=C.HotbarBlocks.indexOf(C.BlockTypes.STONE);
    q.uiModal.setState('playing');for(let x=1;x<=2;x++)for(let z=1;z<=2;z++)q.chunk.rebuildChunk(x,z);
    return {page:location.href,sourceAPI:typeof q.kinetic.kineticInfoAt};
},storageBackup));

await check('X hold/release and no repeated placement', async () => {
    await aim();await pressCrank();
    const r=await evaluate(async()=>{
        await new Promise(resolve=>{let n=0;function tick(){if(++n===15)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});
        const q=window.__p1qa;return {rpm:q.kinetic.kineticInfoAt(31,10,30).rpm,front:q.world.getBlock(30,10,31)};
    });
    expect(r.rpm===8&&r.front===0,'holding X must power once without placing blocks');await releaseCrank();
});
await check('inventory opening clears use; closing does not resume', async()=>{
    await aim();await pressCrank();await page.keyboard.press('e');await waitRPM(0);
    expect(await evaluate(()=>window.__p1qa.uiModal.getUIState())==='inventory','E must open inventory');
    await page.keyboard.press('Escape');await waitRPM(0);await page.keyboard.up('x');
});
await check('aiming away with arrow input cancels use until a new press', async()=>{
    await aim();await pressCrank();await page.keyboard.down('ArrowRight');await waitRPM(0);await page.keyboard.up('ArrowRight');
    await evaluate(()=>{const q=window.__p1qa; q.state.state.player.yaw=0;});
    await waitRPM(0);await page.keyboard.up('x');
});
await check('walking out of reach cancels held use', async()=>{
    await aim();await pressCrank();await page.keyboard.down('s');await waitRPM(0);await page.keyboard.up('s');await page.keyboard.up('x');
});
await check('camera-view key cancels use', async()=>{
    await aim();await pressCrank();await page.keyboard.press('v');await waitRPM(0);await page.keyboard.up('x');
});
await check('death cancels use', async()=>{
    await aim();await pressCrank();await evaluate(()=>{window.__p1qa.state.state.player.dead=true;});await waitRPM(0);await page.keyboard.up('x');
});
await check('world identity change cancels use', async()=>{
    await aim();await pressCrank();await evaluate(()=>{const s=window.__p1qa.state.state;s.blocks=s.blocks.slice();});await waitRPM(0);await page.keyboard.up('x');
});
await check('same-cell removal/replacement cannot inherit held use', async()=>{
    await aim();await pressCrank();await evaluate(()=>{const q=window.__p1qa;q.world.setBlockSafe(30,10,30,0);q.world.setBlockSafe(30,10,30,q.config.crankId(0));});await waitRPM(0);await page.keyboard.up('x');
});
await check('Shift+X places against crank instead of operating it', async()=>{
    await aim();await page.keyboard.down('Shift');await page.keyboard.press('x');await page.keyboard.up('Shift');
    const r=await evaluate(()=>{const q=window.__p1qa;return{block:q.world.getBlock(30,10,31),stone:q.config.BlockTypes.STONE,rpm:q.kinetic.kineticInfoAt(31,10,30).rpm};});
    expect(r.block===r.stone&&r.rpm===0,'Shift must preserve normal placement');
});
await check('level-run mode refuses manual crank power', async()=>{
    await aim();await evaluate(()=>{window.__p1qa.state.state.levelRun={};});
    await page.keyboard.down('x');
    const r=await evaluate(()=>{const q=window.__p1qa;return{intent:q.state.state.handCrankIntent,rpm:q.kinetic.kineticInfoAt(31,10,30).rpm};});
    expect(!r.intent&&r.rpm===0,'level mode may not acquire a crank source');
    await page.keyboard.up('x');await evaluate(()=>{window.__p1qa.state.state.levelRun=null;});
});
await check('save/load clears active manual power without changing component IDs', async()=>{
    await aim();await pressCrank();
    const r=await evaluate(()=>{const q=window.__p1qa;const saved=q.saveGame.saveGame();const loaded=q.saveGame.loadGame(5);return{saved,loaded,block:q.world.getBlock(30,10,30),rpm:q.kinetic.kineticInfoAt(31,10,30).rpm};});
    expect(r.saved&&r.loaded&&r.block===63&&r.rpm===0,JSON.stringify(r));await page.keyboard.up('x');
});
await check('creative inventory contains all three new component names', async()=>{
    await aim();await page.keyboard.press('e');
    const r=await evaluate(()=>{const q=window.__p1qa;const text=document.getElementById('inventory-grid').innerText;return [63,66,69].map(id=>({name:q.config.BlockInfo[id].name,found:text.includes(q.config.BlockInfo[id].name)}));});
    expect(r.every(r=>r.found),JSON.stringify(r));await page.keyboard.press('Escape');
});
await check('survival crafting UI consumes exact recipe materials for three components', async()=>{
    await aim();
    const names=await evaluate(()=>{const q=window.__p1qa,s=q.state.state,C=q.config;s.gameMode=C.GameModes.SURVIVAL;s.player.inventory={};q.world.setBlockSafe(29,9,33,C.BlockTypes.CRAFTING_TABLE);for(const id of [63,66,69]){const r=C.RECIPES.find(r=>r.out===id);for(const [material,n] of Object.entries(r.cost))s.player.inventory[material]=(s.player.inventory[material]||0)+n;}return[63,66,69].map(id=>C.BlockInfo[id].name);});
    await page.keyboard.press('e');
    for(const name of names)await page.click(`loc=role:button[name='制作${name}']`);
    const stock=await evaluate(()=>window.__p1qa.state.state.player.inventory);
    expect([63,66,69].every(id=>stock[id]===1),JSON.stringify(stock));
    expect(Object.entries(stock).filter(([id])=>![63,66,69].includes(+id)).every(([,n])=>n===0),'all recipe ingredients consumed exactly');
    await page.keyboard.press('Escape');await evaluate(()=>{const q=window.__p1qa;q.state.state.gameMode=q.config.GameModes.CREATIVE;});
});
await check('all three components place on X/Y/Z faces through keyboard X', async()=>{
    for(const item of [63,66,69])for(const axis of [0,1,2]){
        await aim();
        const expected=await evaluate(({item,axis})=>{
            const q=window.__p1qa,s=q.state.state,C=q.config;
            for(let x=33;x<=39;x++)for(let y=9;y<=14;y++)for(let z=33;z<=39;z++)q.world.setBlockSafe(x,y,z,0);
            q.world.setBlockSafe(36,10,36,C.BlockTypes.STONE);s.player.selectedSlot=C.HotbarBlocks.indexOf(item);
            if(axis===0)Object.assign(s.player,{x:33.3,y:9,z:36.5,yaw:-Math.PI/2,pitch:Math.atan2(10.5-(9+C.PLAYER_EYE_HEIGHT),3.2)});
            if(axis===1)Object.assign(s.player,{x:36.5,y:13,z:36.5,yaw:0,pitch:-Math.PI/2,flying:true});
            if(axis===2)Object.assign(s.player,{x:36.5,y:9,z:39.3,yaw:0,pitch:Math.atan2(10.5-(9+C.PLAYER_EYE_HEIGHT),2.8)});
            return{at:axis===0?[35,10,36]:axis===1?[36,11,36]:[36,10,37],id:item===63?C.crankId(axis):item===66?C.largeCogId(axis):C.reverserId(axis,0)};
        },{item,axis});
        await page.keyboard.press('x');
        const actual=await evaluate(pos=>window.__p1qa.world.getBlock(...pos),expected.at);
        expect(actual===expected.id,`item${item} axis${axis}: ${actual} != ${expected.id}`);
    }
});
await check('real tab blur cancels a held operation', async()=>{
    await aim();await pressCrank();const other=await task.newPage();await other.goto('about:blank');
    await waitRPM(0);await other.close();await page.cdp('Page.bringToFront');await page.keyboard.up('x');
});
await check('mouse right hold/release uses the real pointer-lock input path', async()=>{
    await aim();await evaluate(()=>{window.__p1qa.state.state.inputMode='mouse';});
    const rect=await evaluate(()=>{const r=document.getElementById('gameCanvas').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
    await evaluate(()=>{const c=document.getElementById('gameCanvas');window.__p1OriginalLock=c.requestPointerLock;window.__p1LockError=null;c.requestPointerLock=function(...args){const p=window.__p1OriginalLock.apply(this,args);if(p?.catch)p.catch(e=>window.__p1LockError={name:e.name,message:e.message});return p;};});
    await page.mouse.click(rect.x,rect.y,{label:'接管游戏鼠标'});
    await page.waitForFunction(()=>!!document.pointerLockElement||window.__p1LockError,undefined,{timeout:4000});
    const lockError=await evaluate(()=>{const c=document.getElementById('gameCanvas');c.requestPointerLock=window.__p1OriginalLock;return window.__p1LockError;});
    if(lockError)throw new Error('POINTER_LOCK_ENVIRONMENT: '+JSON.stringify(lockError));
    await page.mouse.down({button:'right'});await waitRPM(8);await page.mouse.up({button:'right'});await waitRPM(0);
});
await check('trusted right-button input works under an explicitly simulated pointer-lock precondition', async()=>{
    await aim();
    await evaluate(()=>{const q=window.__p1qa;q.state.state.inputMode='mouse';window.__p1PointerDescriptor=Object.getOwnPropertyDescriptor(document,'pointerLockElement');Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>document.getElementById('gameCanvas')});document.dispatchEvent(new Event('pointerlockchange'));});
    try {await page.mouse.down({button:'right'});await waitRPM(8);await page.mouse.up({button:'right'});await waitRPM(0);}
    finally {await evaluate(()=>{if(window.__p1PointerDescriptor)Object.defineProperty(document,'pointerLockElement',window.__p1PointerDescriptor);else delete document.pointerLockElement;document.dispatchEvent(new Event('pointerlockchange'));});}
});
await page.keyboard.press('Escape');
await evaluate(()=>{const q=window.__p1qa;q.input.clearKeys();q.state.state.levelRun=null;q.uiModal.setState('pause');});
const fs=await import('node:fs/promises');
await fs.mkdir('/Users/zxnap/code/MyWorks/yltech.edu/game/docs/physics-p1-evidence',{recursive:true});
await fs.writeFile('/Users/zxnap/code/MyWorks/yltech.edu/game/docs/physics-p1-evidence/browser-input.json',JSON.stringify({date:new Date().toISOString(),space:161,page:page.label,origin:'http://127.0.0.1:18437/',results},null,2));
await evaluate(()=>{
    const q=window.__p1qa;q.input.clearKeys();q.state.state.blocks=null; // Prevent pagehide/auto-save overwriting restored storage.
    if(q.saveBefore===null)q.saveGame.deleteSave(5);else localStorage.setItem('mcweb.save.v1.slot5',q.saveBefore);
    const raw=localStorage.getItem('mcweb.save.index');
    if(raw){const idx=JSON.parse(raw);idx.current=q.oldSaveSlot;if(q.saveBefore!==null){const saved=JSON.parse(q.saveBefore);idx.slots[5]={savedAt:saved.savedAt,gameMode:saved.gameMode};}localStorage.setItem('mcweb.save.index',JSON.stringify(idx));}
});
await page.close();
console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,total:results.length,results},null,2));
if(results.some(r=>!r.ok&&r.classification!=='environment-blocked'))process.exitCode=1;
