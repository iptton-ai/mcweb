// Run in this task's dedicated test origin; no player-origin storage is touched.
// ego-browser nodejs < tests/e2e/physics_p1_resources_ego.mjs
const task=await taskSpace(161),page=task.page('p5');
const result=await page.evaluate(async()=>{
    const q=window.__p1visual,s=q.state.state,C=q.config;
    const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
    q.input.clearKeys();q.levelEditor.cancelPlacing();s.levelRun=s.levelEdit=null;
    s.gameMode=C.GameModes.SURVIVAL;q.uiModal.setState('pause');
    const blank=()=>{
        q.entities.clearAllEnemies();q.items.clearItemDrops();q.particles.clearParticles();
        for(const key of [...s.chunkMeshes.keys()])q.chunk.disposeChunk(...key.split(',').map(Number));
        s.blocks=new Uint8Array(C.WORLD_WIDTH*C.WORLD_HEIGHT*C.WORLD_DEPTH);
        for(let x=32;x<48;x++)for(let z=32;z<48;z++)q.world.setBlockSafe(x,8,z,C.BlockTypes.STONE);
        q.kinetic.initKinetic();q.redstone.initRedstone();q.chunk.rebuildChunk(2,2);
        q.engine.renderer.render(q.engine.scene,q.engine.camera);
    };
    const read=()=>({geometry:q.engine.renderer.info.memory.geometries,textures:q.engine.renderer.info.memory.textures,
        scene:q.engine.scene.children.length,props:s.droppedItems.length,drops:s.itemDrops.length,
        components:q.kinetic.kineticDiagnostics().components,progress:q.kinetic.kineticDiagnostics().progress});
    const samples=[];
    for(let cycle=0;cycle<23;cycle++){
        blank();
        for(let i=0;i<12;i++)q.world.setBlockSafe(34+i%6,9+Math.floor(i/6),35,63+i);
        for(const x of [35,37,39]){
            q.world.setBlockSafe(x,9,34,C.BlockTypes.STONE);
            q.world.setBlockSafe(x,10,34,C.leverId(0,1));
        }
        q.redstone.initRedstone();
        q.kinetic.initKinetic();q.kinetic.setCrankActive(34,9,35,true);
        q.chunk.rebuildChunk(2,2);
        for(const id of [63,66,69])q.items.spawnItemDrop(38.5,12,37.5,id,1,{lifePersistent:true});
        q.engine.renderer.render(q.engine.scene,q.engine.camera);
        assert(q.saveGame.saveGame(),'save fixture');assert(q.saveGame.loadGame(0),'reload fixture');
        assert(!s.handCrankPower&&!s.handCrankIntent,'reload clears manual operation');
        for(let i=0;i<12;i++)assert(q.world.getBlock(34+i%6,9+Math.floor(i/6),35)===63+i,'all variants survive load');
        blank();samples.push(read());
    }
    const stable=samples.slice(3),reference=JSON.stringify(stable[0]);
    assert(stable.length===20&&stable.every(v=>JSON.stringify(v)===reference),'resources must stabilize after warmup');
    return{warmupCycles:3,measuredCycles:20,samples,stable:true,scope:'real WebGL render + all variants + item drops + save/load + world reset'};
});
const fs=await import('node:fs/promises');
await fs.writeFile('/Users/zxnap/code/MyWorks/yltech.edu/game/docs/physics-p1-evidence/resources-20-cycles.json',JSON.stringify(result,null,2));
console.log(result);
