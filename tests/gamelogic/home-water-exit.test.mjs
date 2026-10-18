// 安家浅池实际游玩回归：keys → playerPhysics，不能用传送模拟上岸。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, state, setB } from './kit.mjs';
import { BlockTypes, GameModes, PLAYER_HEIGHT } from '../../js/config.js';
import { updatePlayerPhysics } from '../../js/playerPhysics.js';
import { keys } from '../../js/input.js';
import { generateWorld } from '../../js/world.js';
import { setState } from '../../js/uiModal.js';

function pond() {
    freshWorld({gameMode:GameModes.SURVIVAL});
    state.levelRun=null;state.levelEdit=null;state.camMode='player';state.inputMode='keyboard';
    state.helpDocOpen=false;state.questionBankOpen=false;state.authorPanelOpen=false;
    state.prefabPickerOpen=false;state.levelExportOpen=false;state.recordingControlsOpen=false;
    state.windowUnfocused=false;
    for(const key of Object.keys(keys))keys[key]=false;
    // 平地岸顶 y=10；一格水 y=9，池底 y=8，和实机的水/岸相对高度一致。
    for(let x=10;x<=30;x++)for(let z=10;z<=30;z++) {
        setB(x,9,z,x>=18&&x<=22&&z>=18&&z<=21?BlockTypes.WATER:BlockTypes.GRASS);
    }
    Object.assign(state.player,{x:20.5,y:10.001,z:23.5,yaw:0,pitch:0,vx:0,vy:0,vz:0,
        onGround:true,fallStartY:null,invulnTimer:0,health:20});
    setState('playing');
}
function walkIntoWater(dt=1/60) {
    keys.KeyW=true;
    let entered=false;
    for(let frame=0;frame<180;frame++) {
        updatePlayerPhysics(dt);
        if(state.player.inWater && state.player.y<9.4) { entered=true; break; }
    }
    assert.equal(entered,true,'用 W 实际走下岸进入水中');
    keys.KeyW=false;
    // 只转身，不改位置；接下来用 W+Space 从刚下来的岸爬回去。
    state.player.yaw=Math.PI;
}
function release() { for(const key of Object.keys(keys))keys[key]=false; }

test('真实入水→Space+W爬上一格岸，30/60/120Hz均可，离岸停止跳跃后能站稳',()=>{
    try {
        for(const dt of [1/30,1/60,1/120]) {
            pond();walkIntoWater(dt);
            keys.Space=true;keys.KeyW=true;
            let crossed=false;
            for(let f=0;f<Math.ceil(3/dt);f++) {
                updatePlayerPhysics(dt);
                if(state.player.z>22.35 && state.player.y>=10) {crossed=true;break;}
            }
            assert.equal(crossed,true,`${Math.round(1/dt)}Hz 可爬上岸`);
            release();
            for(let f=0;f<Math.ceil(1/dt);f++)updatePlayerPhysics(dt);
            assert.equal(state.player.onGround,true);assert.equal(state.player.y,10.001);
            assert.equal(state.player.inWater,false);assert.equal(state.player.health,20);
        }
    } finally { release(); }
});

test('低顶盖住水与岸时Space+W不会穿顶或穿进岸墙，撤低顶后可上岸',()=>{
    try {
        pond();walkIntoWater();
        // 先落到池底再加低顶，避免测试夹具把天花板直接生成在玩家现有头部中。
        for(let f=0;f<120;f++)updatePlayerPhysics(1/60);
        for(let x=18;x<=22;x++)for(let z=18;z<=23;z++)setB(x,11,z,BlockTypes.STONE);
        keys.Space=true;keys.KeyW=true;
        for(let f=0;f<180;f++) {
            updatePlayerPhysics(1/60);
            assert.ok(state.player.y+PLAYER_HEIGHT<11,'头顶停在低顶下方');
            assert.ok(state.player.z<22,'没有穿进一格高的岸墙');
        }
        for(let x=18;x<=22;x++)for(let z=18;z<=23;z++)setB(x,11,z,BlockTypes.AIR);
        let crossed=false;
        for(let f=0;f<180;f++) {updatePlayerPhysics(1/60);if(state.player.z>22.35){crossed=true;break;}}
        assert.equal(crossed,true,'只撤障碍即可继续上岸，无需重置玩家');
    } finally { release(); }
});

test('两格高墙仍不能爬越；离水后持续按空格也不会无限空中跳',()=>{
    try {
        pond();walkIntoWater();
        for(let x=18;x<=22;x++) {setB(x,10,22,BlockTypes.STONE);setB(x,11,22,BlockTypes.STONE);}
        keys.Space=true;keys.KeyW=true;
        let maxY=0;
        for(let f=0;f<300;f++) {updatePlayerPhysics(1/60);maxY=Math.max(maxY,state.player.y);assert.ok(state.player.z<22);}
        assert.ok(maxY<11,'水面余速不会爬过两格高墙');
        // 独立真实离水过程：不改变坐标，掉到池中后只按空格上浮，观察在空气中会自然减速下落。
        keys.KeyW=false;
        let sawAir=false,sawFalling=false,peak=0;
        for(let f=0;f<300;f++) {
            updatePlayerPhysics(1/60);peak=Math.max(peak,state.player.y);
            if(!state.player.inWater) {sawAir=true;if(state.player.vy<0)sawFalling=true;}
        }
        assert.equal(sawAir,true);assert.equal(sawFalling,true);assert.ok(peak<11);
    } finally { release(); }
});

test('实机 seed 1287621887 岸前坐标回放：不改池几何即可用真实按键上岸', () => {
    try {
        pond();state.worldSeed=1287621887;state.generationVersion=2;generateWorld();
        Object.assign(state.player,{x:146.75,y:45.395,z:139.699,yaw:Math.PI,vx:0,vy:0.3,vz:0,onGround:false});
        keys.Space=true;keys.KeyW=true;
        let crossed=false;
        for(let f=0;f<180;f++) {
            updatePlayerPhysics(1/60);
            if(state.player.z>140.35 && state.player.y>=46){crossed=true;break;}
        }
        assert.equal(crossed,true,'从真实受阻位置爬上同一片岸');
    } finally { release(); }
});
