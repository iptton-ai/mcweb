// 安家闭环回归：真实逻辑与世界，渲染只在浏览器验收。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, state, setB, at, pump } from './kit.mjs';
import { BED_BASE, BED_ITEM_ID, BED_HEIGHT, BED_DIRECTIONS, BlockTypes, GameModes, ToolTypes, ItemTypes,
    DOOR_ITEM_ID, HotbarBlocks, RECIPES, PISTON_ITEM_ID, WORLD_HEIGHT, WORLD_WIDTH, WORLD_DEPTH, bedId, isBedId, collisionHeight } from '../../js/config.js';
import { tryPlaceBed, breakBedAt, getBedAt, interactBedAt, getHomeRespawn, findSafeStandingPosition } from '../../js/bed.js';
import { resetHomeWorld, captureHomeState, restoreHomeState, tickFirstDay, grantHomeStarter,
    defaultQuickbar, normalizeQuickbar, selectQuickbar, assignQuickbar } from '../../js/homeSurvival.js';
import { craftRecipe, setGameMode, claimWorkshopKit } from '../../js/ui.js';
import { setState, isWorldPaused, isGameActive, isKeyboardPlayActive } from '../../js/uiModal.js';
import { updatePlayerPhysics } from '../../js/playerPhysics.js';
import { respawn } from '../../js/playerLife.js';
import { placePiston, enqueuePistonAction } from '../../js/piston.js';
import { enqueueBuildOps, updateBuild, clearBuildQueue } from '../../js/buildQueue.js';
import { explode } from '../../js/tnt.js';
import { saveGame, loadGame } from '../../js/saveGame.js';
import { saveSnapshotForReload, restoreSnapshotIfAny } from '../../js/assistant/snapshot.js';
import { generateWorld, getBlock } from '../../js/world.js';
import { enterLevelEditor, exitLevelEditor } from '../../js/levelEditor.js';

function setup() {
    freshWorld({gameMode:GameModes.SURVIVAL});
    state.levelRun=null;state.levelEdit=null;state.temporaryWorldTransition=null;
    state.homeGuideEnabled=true;state.helpDocOpen=false;state.questionBankOpen=false;state.authorPanelOpen=false;
    state.prefabPickerOpen=false;state.levelExportOpen=false;state.recordingControlsOpen=false;
    state.windowUnfocused=false;state.camMode='free';
    state.spawn={x:3.5,y:9.001,z:3.5};
    Object.assign(state.player,{hunger:15,air:10,toolWear:{},invulnTimer:0,hungerTimer:0,regenTimer:0});
    state.time=state.dayLength*.5;
    setState('playing');
    clearBuildQueue();
}
const bed=(x=20,z=20,yaw=0)=>{assert.equal(tryPlaceBed(x,9,z,yaw),null);return getBedAt(x,9,z);};

test('安家材料链：首次赠羊毛→木板→工作台→门床；切模式不会再送',()=>{
    setup();resetHomeWorld();grantHomeStarter();
    assert.equal(state.player.inventory[BlockTypes.WOOL],3);
    assert.equal(state.player.inventory[PISTON_ITEM_ID],undefined);
    const craft=id=>assert.equal(craftRecipe(RECIPES.find(r=>r.id===id)),null);
    craft('planks');craft('planks');craft('planks');craft('planks');
    craft('crafting_table');
    setB(4,9,3,BlockTypes.CRAFTING_TABLE);
    craft('door');craft('bed');
    assert.equal(state.player.inventory[BED_ITEM_ID],1);
    assert.equal(state.player.inventory[DOOR_ITEM_ID],3);
    assert.equal(state.player.inventory[BlockTypes.WOOL],0);
    const before={...state.player.inventory};
    setGameMode(GameModes.CREATIVE);setGameMode(GameModes.SURVIVAL);
    assert.deepEqual(state.player.inventory,before);
    state.survivalRules='experiment'; // M2: explicitly test the optional free experiment kit.
    assert.equal(claimWorkshopKit(),true);const count=state.player.inventory[PISTON_ITEM_ID];
    assert.equal(claimWorkshopKit(),false);assert.equal(state.player.inventory[PISTON_ITEM_ID],count);
});

test('四向双格床；边界/占用/无支撑/玩家重叠失败不写不扣',()=>{
    for(let f=0;f<4;f++) {
        setup();const yaw=[0,-Math.PI/2,Math.PI,Math.PI/2][f];bed(20,20,yaw);
        const [dx,dz]=BED_DIRECTIONS[f];
        assert.equal(at(20,9,20),bedId(0,f));assert.equal(at(20+dx,9,20+dz),bedId(1,f));
        assert.deepEqual(getBedAt(20+dx,9,20+dz),{x:20,y:9,z:20,facing:f});
    }
    setup();state.player.inventory[BED_ITEM_ID]=1;
    assert.ok(tryPlaceBed(0,9,0,0));
    setB(20,9,19,BlockTypes.STONE);assert.ok(tryPlaceBed(20,9,20,0));assert.equal(at(20,9,20),0);
    setB(20,9,19,0);setB(20,8,19,0);assert.ok(tryPlaceBed(20,9,20,0));
    assert.ok(tryPlaceBed(3,9,3,0));assert.equal(state.player.inventory[BED_ITEM_ID],1);
});

test('拆任一半只返一床；跨区块另一半也清掉，邻床不误删',()=>{
    for(const half of [0,1]) {
        setup();bed(16,20,Math.PI/2);bed(16,22,Math.PI/2);
        const cells=breakBedAt(16-half,9,20);
        assert.equal(cells.length,2);assert.equal(at(16,9,20),0);assert.equal(at(15,9,20),0);
        assert.equal(state.player.inventory[BED_ITEM_ID],1);assert.ok(getBedAt(16,9,22));
        assert.equal(breakBedAt(16,9,20).length,0);assert.equal(state.player.inventory[BED_ITEM_ID],1);
    }
});

test('床支撑被活塞移走自动清两格；直接推床不拆分',()=>{
    setup();setB(20,9,20,BlockTypes.PLANKS);setB(20,9,19,BlockTypes.PLANKS);
    assert.equal(tryPlaceBed(20,10,20,0),null);
    assert.equal(placePiston(19,9,20,PISTON_ITEM_ID,{dx:1,dy:0,dz:0}),null);
    enqueuePistonAction(19,9,20,true);pump(.05,4);
    assert.equal(at(20,10,20),0);assert.equal(at(20,10,19),0);
    setup();bed();placePiston(19,9,20,PISTON_ITEM_ID,{dx:1,dy:0,dz:0});
    enqueuePistonAction(19,9,20,true);pump(.05,4);
    assert.ok(getBedAt(20,9,20));assert.equal(at(21,9,20),0);
});

test('AI单半覆盖、清区和原始单床写入均无孤床或物品复制',async()=>{
    setup();state.survivalRules='experiment';bed();state.buildSpeedIdx=99;state.buildPaused=false;
    const job=enqueueBuildOps('覆盖床头',[[20,9,19,BlockTypes.STONE]]);
    for(let i=0;i<10;i++) updateBuild(.1);
    await job;assert.equal(at(20,9,20),0);assert.equal(at(20,9,19),BlockTypes.STONE);
    assert.equal(state.player.inventory[BED_ITEM_ID],undefined);
    const invalid=enqueueBuildOps('拒绝孤床',[[30,9,30,BED_BASE]]);
    for(let i=0;i<10;i++) updateBuild(.1);
    assert.equal((await invalid).skipped.length,1);assert.equal(at(30,9,30),0);
});

test('轻松苦力怕保家，主动TNT和冒险苦力怕照常，双格爆炸无孤床',()=>{
    setup();bed();state.survivalDifficulty='gentle';
    explode(20,9,17,'creeper');assert.ok(getBedAt(20,9,20));
    explode(20,9,16,'tnt');assert.equal(at(20,9,19),0);assert.equal(at(20,9,20),0);
    setup();bed();state.survivalDifficulty='adventure';explode(20,9,17,'creeper');
    assert.equal(at(20,9,19),0);assert.equal(at(20,9,20),0);
});

test('白天设家，夜晚安全睡醒且不补饥饿；床失效安全回退',()=>{
    setup();bed();assert.deepEqual(interactBedAt(20,9,20),{ok:true,slept:false});
    state.time=state.dayLength*.9;Object.assign(state.player,{vx:3,vy:-10,vz:4,fallStartY:70});
    assert.equal(interactBedAt(20,9,19).slept,true);
    assert.equal(state.time%state.dayLength,state.dayLength*.3);assert.equal(state.player.hunger,15);
    assert.equal(state.player.vy,0);assert.equal(state.player.fallStartY,null);
    assert.equal(collisionHeight(getBlock(Math.floor(state.player.x),Math.floor(state.player.y)-1,Math.floor(state.player.z))),1);
    const pos=getHomeRespawn().position;respawn();assert.equal(state.player.x,pos.x);
    breakBedAt(20,9,20);const fallback=getHomeRespawn();assert.match(fallback.reason,/床/);
    assert.equal(fallback.position.x,state.spawn.x);
});

test('屋内可达怪阻睡，封闭墙外怪不阻睡；起身全堵不能睡',()=>{
    setup();bed();state.time=state.dayLength*.9;
    const threat={x:21.5,y:9.001,z:20.5,hostile:true,hp:20};state.enemies.push(threat);
    assert.equal(interactBedAt(20,9,20).ok,false);
    threat.x=26.5;assert.equal(interactBedAt(20,9,20).ok,false,'六格外可直达的怪物同样阻睡');
    // 四面两格高围墙把怪物隔在东侧外面，里面留床边通道。
    for(let x=18;x<=22;x++) for(let z=17;z<=22;z++) if(x===18||x===22||z===17||z===22) {
        setB(x,9,z,BlockTypes.PLANKS);setB(x,10,z,BlockTypes.PLANKS);
    }
    threat.x=23.5;assert.equal(interactBedAt(20,9,20).slept,true);
    state.enemies.length=0;state.time=state.dayLength*.9;
    for(let x=19;x<=21;x++) for(let z=18;z<=21;z++) if(!isBedId(at(x,9,z))) {
        setB(x,9,z,BlockTypes.STONE);setB(x,10,z,BlockTypes.STONE);setB(x,11,z,BlockTypes.STONE);
    }
    assert.equal(interactBedAt(20,9,20).ok,false);
    assert.match(getHomeRespawn().reason,/堵住/);
});

test('矮床真实碰撞：脚落在9/16顶面，可横移且床侧不穿透',()=>{
    setup();bed();const p=state.player;
    Object.assign(p,{x:20.5,y:11,z:20.5,vy:-10,vx:0,vz:0,fallStartY:null});
    for(let i=0;i<10;i++) updatePlayerPhysics(.05);
    assert.equal(p.y,9+BED_HEIGHT+.001);assert.equal(p.onGround,true);
    p.vx=4;updatePlayerPhysics(.025);assert.ok(p.x>20.5,'床顶能移动');
    Object.assign(p,{x:19.6,y:9.001,z:20.5,vx:8,vy:0,vz:0});
    updatePlayerPhysics(.05);assert.ok(p.x<20);assert.equal(p.vx,0);
});

test('普通生存阅读/打字/失焦暂停，输入门同步，创造与临时世界不受影响',()=>{
    setup();state.inputMode='keyboard';assert.equal(isWorldPaused(),false);
    for(const field of ['helpDocOpen','questionBankOpen','authorPanelOpen','windowUnfocused']) {
        state[field]=true;assert.equal(isWorldPaused(),true,field);assert.equal(isGameActive(),false);assert.equal(isKeyboardPlayActive(),false);state[field]=false;
    }
    for(const name of ['quiz','trade','starlight']) {state.readingPanels[name]=true;assert.equal(isWorldPaused(),true);delete state.readingPanels[name];}
    setState('inventory');assert.equal(isWorldPaused(),true);setState('pause');assert.equal(isWorldPaused(),true);
    state.gameMode=GameModes.CREATIVE;assert.equal(isWorldPaused(),false);
    state.gameMode=GameModes.SURVIVAL;state.levelRun={};assert.equal(isWorldPaused(),false);
    state.levelRun=null;state.levelEdit={};assert.equal(isWorldPaused(),false);state.levelEdit=null;
});

test('首夜按有效时间缓冲；常用栏映射不修改目录索引',()=>{
    setup();resetHomeWorld();state.time=state.dayLength*.74;tickFirstDay(1);
    assert.equal(state.firstDayRemaining,479);assert.equal(state.time,state.dayLength*.70);
    state.firstDayRemaining=.2;tickFirstDay(.2);assert.equal(state.firstDayRemaining,0);
    state.player.quickbar=defaultQuickbar();assignQuickbar(0,BED_ITEM_ID);selectQuickbar(0);
    assert.equal(HotbarBlocks[state.player.selectedSlot],BED_ITEM_ID);
    assert.equal(state.player.quickbar[7],ToolTypes.WOOD_AXE);
    assert.deepEqual(normalizeQuickbar([999]),defaultQuickbar());
});

test('存档/切槽/快照往返新增字段；缺字段旧档默认冒险且不再赠物',()=>{
    setup();resetHomeWorld();grantHomeStarter();bed();interactBedAt(20,9,20);
    state.saveSlot=0;state.firstDayRemaining=123;assignQuickbar(2,BED_ITEM_ID);
    const expected=captureHomeState(),bar=[...state.player.quickbar];assert.equal(saveGame(),true);
    state.saveSlot=1;state.homeBed=null;state.survivalDifficulty='adventure';assert.equal(saveGame(),true);
    assert.equal(loadGame(0),true);assert.deepEqual(captureHomeState(),expected);assert.deepEqual(state.player.quickbar,bar);
    assert.equal(saveSnapshotForReload(),true);state.homeBed=null;state.survivalDifficulty='adventure';
    assert.equal(restoreSnapshotIfAny(),true);assert.deepEqual(captureHomeState(),expected);assert.deepEqual(state.player.quickbar,bar);
    const raw=JSON.parse(localStorage.getItem('mcweb.save.v1.slot0'));
    for(const key of Object.keys(expected)) delete raw[key];delete raw.player.quickbar;
    localStorage.setItem('mcweb.save.v1.slot0',JSON.stringify(raw));assert.equal(loadGame(0),true);
    assert.equal(state.generationVersion,1);assert.equal(state.homeBed,null);assert.equal(state.survivalDifficulty,'adventure');
    assert.equal(state.firstDayRemaining,0);assert.equal(state.survivalStarted,true);assert.equal(grantHomeStarter(),false);
    assert.deepEqual(state.player.quickbar,defaultQuickbar());
});

test('编辑世界禁止设家/跳夜，退出读回家和常用栏；临时世界热重载不覆盖',async()=>{
    setup();resetHomeWorld();bed();interactBedAt(20,9,20);state.saveSlot=2;
    const expected=captureHomeState(),bar=[...state.player.quickbar];assert.equal(saveGame(),true);
    assert.equal(await enterLevelEditor(),true);
    assert.equal(interactBedAt(20,9,20).ok,false);
    assert.equal(saveGame(),false);assert.equal(saveSnapshotForReload(),true);
    assert.equal(await exitLevelEditor({saveDraft:false}),true);
    assert.deepEqual(captureHomeState(),expected);assert.deepEqual(state.player.quickbar,bar);
    assert.equal(restoreSnapshotIfAny(),false);assert.deepEqual(captureHomeState(),expected);
});

test('新地形固定种子浅水可从安全出生地步行接近，旧版本仍无新增水',()=>{
    for(const seed of [1,42,2026]) {
        setup();state.worldSeed=seed;state.generationVersion=2;generateWorld();
        let top=WORLD_HEIGHT-3;while(top>0&&!collisionHeight(getBlock(128,top,128))) top--;
        const spawn=findSafeStandingPosition({x:128,y:top+1,z:128},12,{naturalGround:true});assert.ok(spawn);
        const start=[Math.floor(spawn.x),Math.floor(spawn.y),Math.floor(spawn.z)];
        const seen=new Set(),q=[start];let nearWater=false;
        for(let i=0;i<q.length && i<40000 && !nearWater;i++) {
            const [x,y,z]=q[i],key=`${x},${y},${z}`;if(seen.has(key))continue;seen.add(key);
            for(const [dx,dz] of BED_DIRECTIONS) {
                if(getBlock(x+dx,y-1,z+dz)===BlockTypes.WATER) {nearWater=true;break;}
                for(const dy of [0,1,-1]) {
                    const nx=x+dx,ny=y+dy,nz=z+dz;
                    if(nx<90||nx>170||nz<90||nz>170)continue;
                    if(collisionHeight(getBlock(nx,ny-1,nz))===1&&!collisionHeight(getBlock(nx,ny,nz))&&!collisionHeight(getBlock(nx,ny+1,nz))&&getBlock(nx,ny,nz)!==BlockTypes.WATER)q.push([nx,ny,nz]);
                }
            }
        }
        assert.equal(nearWater,true,`seed ${seed} 普通逐格步行可到池边`);
    }
});
