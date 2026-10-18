// 安家独立审查的真实缺陷回归；覆盖生产入口而非复制判断实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, state, setB, at } from './kit.mjs';
import {
    BED_ITEM_ID, BED_HEIGHT, BlockTypes, GameModes, ItemTypes, ToolTypes, HotbarBlocks,
    LAMP_ITEM_ID, LEVER_ITEM_ID, WATERWHEEL_ITEM_ID, FLAG_BASE, RECIPES, isLampLitId,
} from '../../js/config.js';
import { tryPlaceBed, getBedAt, getHomeRespawn, interactBedAt, flushBedChanges } from '../../js/bed.js';
import { breakBlockAt } from '../../js/interaction.js';
import { updatePlayerPhysics } from '../../js/playerPhysics.js';
import { placeRedstone, toggleLeverAt } from '../../js/redstone.js';
import { enqueueBuildOps, updateBuild, clearBuildQueue } from '../../js/buildQueue.js';
import { explode } from '../../js/tnt.js';
import { restoreHomeState, getHomeGuide } from '../../js/homeSurvival.js';
import { materialSource, WORKSHOP_KIT } from '../../js/itemSources.js';
import { describeItem } from '../../js/itemInfo.js';
import { craftRecipe, setGameMode } from '../../js/ui.js';
import { saveGame, loadGame } from '../../js/saveGame.js';
import { damagePlayer } from '../../js/playerLife.js';

function setup() {
    freshWorld({ gameMode: GameModes.SURVIVAL });
    state.levelRun = null; state.levelEdit = null; state.camMode = 'free';
    state.homeBed = null; state.time = state.dayLength * .5;
    state.spawn = { x: 3.5, y: 9.001, z: 3.5 };
    Object.assign(state.player, { invulnTimer: 0, toolWear: {}, hunger: 15, air: 10 });
    clearBuildQueue();
}
function bed(x = 20, y = 9, z = 20) {
    assert.equal(tryPlaceBed(x, y, z, 0), null);
}
const hit = (x, y, z) => ({ x, y, z, block: at(x, y, z) });

test('致命伤害显示十颗空心，不把负血量画成超长心条', () => {
    setup();
    state.player.health = 2;
    damagePlayer(20);
    assert.equal(state.player.dead, true);
    assert.equal(state.player.health, 0);
    assert.equal((document.getElementById('health-bar').innerHTML.match(/🖤/gu) || []).length, 10);
});

test('审查 R1：同层脚印跨床与整块，两个扫描顺序都先落到较高顶面', () => {
    for (const bedOnLeft of [true, false]) {
        setup();
        const bedX = bedOnLeft ? 20 : 21;
        bed(bedX); setB(bedOnLeft ? 21 : 20, 9, 20, BlockTypes.STONE);
        Object.assign(state.player, { x: 20.8, y: 11, z: 20.5, vx: 0, vy: -15, vz: 0, onGround: false });
        updatePlayerPhysics(.1);
        assert.equal(state.player.y, 10.001, `床在${bedOnLeft ? '前' : '后'}扫描列`);
        assert.equal(state.player.onGround, true);
        updatePlayerPhysics(.05);
        assert.equal(state.player.y, 10.001, '不会卡入更高方块');
    }
    setup();setB(20, 9, 20, BlockTypes.STONE);
    Object.assign(state.player, { x:20.5, y:9.2, z:20.5, vx:0, vy:-1, vz:0 });
    updatePlayerPhysics(.05);
    assert.equal(state.player.y,10.001,'旧完整方块嵌入自救仍然生效');
});

test('审查 R2：真实挖红石灯/普通支撑都清双格并只返一床', () => {
    for (const support of [LAMP_ITEM_ID, BlockTypes.PLANKS]) {
        setup();setB(20, 9, 20, support);setB(20, 9, 19, BlockTypes.PLANKS);bed(20, 10, 20);
        const target = hit(20, 9, 20);
        breakBlockAt(target);
        assert.equal(at(20,10,20),0);assert.equal(at(20,10,19),0);
        assert.equal(state.player.inventory[BED_ITEM_ID],1);
        assert.equal(state.player.inventory[support],1);
        breakBlockAt(target);
        assert.equal(state.player.inventory[BED_ITEM_ID],1,'过时命中不会再返一床');
    }
});

function bedCircuit(y = 9) {
    if (y > 9) { setB(20, y-1, 20, BlockTypes.PLANKS);setB(20, y-1, 19, BlockTypes.PLANKS); }
    bed(20,y,20);
    assert.equal(placeRedstone(21,y,20,LEVER_ITEM_ID,{dx:1,dy:0,dz:0}),null);
    setB(22,y,20,LAMP_ITEM_ID);toggleLeverAt(21,y,20);
    assert.equal(isLampLitId(at(22,y,20)),true);
}

test('审查 R9：真实挖床任一半立即撤下开启拉杆、返挂件并让负载断电', () => {
    for (const z of [19,20]) {
        setup();bedCircuit();breakBlockAt(hit(20,9,z));
        assert.equal(at(21,9,20),0,'床尾挂件随整床移除');
        assert.equal(isLampLitId(at(22,9,20)),false);
        assert.equal(state.player.inventory[LEVER_ITEM_ID],1);
        assert.equal(state.player.inventory[BED_ITEM_ID],1);
        assert.equal(state.bedDirtyCells.length,0,'交互返回前已完成清理');
    }
});

test('审查 R9：AI拆支撑与爆炸半床撤挂件，环境清理不送物品进背包', async () => {
    setup();state.survivalRules='experiment';bedCircuit(10);state.buildSpeedIdx=99;state.buildPaused=false;
    const job=enqueueBuildOps('拆床支撑',[[20,9,20,0]]);
    for(let i=0;i<10;i++)updateBuild(.1);
    await job;flushBedChanges();
    assert.equal(at(21,10,20),0);assert.equal(isLampLitId(at(22,10,20)),false);
    assert.equal(state.player.inventory[BED_ITEM_ID],undefined);assert.equal(state.player.inventory[LEVER_ITEM_ID],undefined);
    setup();bedCircuit(10);explode(20,10,16,'tnt');flushBedChanges();
    assert.equal(at(20,10,20),0);assert.equal(at(21,10,20),0);
    assert.equal(isLampLitId(at(22,10,20)),false);
    assert.equal(state.player.inventory[BED_ITEM_ID],undefined);assert.equal(state.player.inventory[LEVER_ITEM_ID],undefined);
});

test('审查 R3：原木地板可睡觉/床重生/出生回退，不创建平台改坏建筑', () => {
    for(const floor of [BlockTypes.WOOD,BlockTypes.LOG]) {
        setup();state.blocks.fill(0);
        for(let x=17;x<=23;x++)for(let z=17;z<=23;z++)setB(x,8,z,floor);
        state.spawn={x:22.5,y:9.001,z:22.5};bed();state.time=state.dayLength*.9;
        assert.equal(interactBedAt(20,9,20).slept,true);
        const before=state.blocks.slice();const home=getHomeRespawn();
        assert.equal(home.reason,'');assert.deepEqual(state.blocks,before);
        breakBlockAt(hit(20,9,20));const withoutBed=state.blocks.slice();
        const fallback=getHomeRespawn();assert.match(fallback.reason,/原来的床/);
        assert.equal(fallback.position.x,state.spawn.x);assert.deepEqual(state.blocks,withoutBed);
    }
});

test('审查 R4：真实制作前后按木板→工作台→放置→补料→床阶段提示', () => {
    setup();state.player.inventory={ [BlockTypes.WOOD]:1, [BlockTypes.WOOL]:3 };
    assert.match(getHomeGuide(),/木板/);
    assert.equal(craftRecipe(RECIPES.find(r=>r.id==='planks')),null);
    assert.match(getHomeGuide(),/4 木板制作工作台/);
    assert.equal(craftRecipe(RECIPES.find(r=>r.id==='crafting_table')),null);
    assert.equal(state.player.inventory[BlockTypes.PLANKS],0);
    assert.match(getHomeGuide(),/选中背包里的工作台/);
    state.player.inventory[BlockTypes.CRAFTING_TABLE]--;setB(4,9,3,BlockTypes.CRAFTING_TABLE);
    assert.match(getHomeGuide(),/工作台就在附近/);assert.match(getHomeGuide(),/还差 3 木板/);
    state.player.inventory[BlockTypes.PLANKS]=3;assert.match(getHomeGuide(),/制作小床/);
    assert.equal(craftRecipe(RECIPES.find(r=>r.id==='bed')),null);assert.match(getHomeGuide(),/两格平地/);
});

test('审查 R5：所有物品共用真实来源，水/草/矿石不虚构可采物品，实验包与领取清单一致', () => {
    for(const id of HotbarBlocks) {
        assert.equal(typeof materialSource(id),'string');
        assert.ok(describeItem(id).includes(`来源：${materialSource(id)}`),`${id} 悬停与点击来源一致`);
        assert.doesNotMatch(materialSource(id),/^可在世界中采集/);
    }
    assert.match(materialSource(BlockTypes.WATER),/空桶.*取水.*水桶.*放水/); // M2 now has real buckets.
    assert.match(materialSource(BlockTypes.GRASS),/只掉泥土|只.*泥土|掉.*泥土/);
    assert.match(materialSource(BlockTypes.COAL_ORE),/挖下掉煤炭/);
    assert.match(materialSource(WATERWHEEL_ITEM_ID),/工作台制作：木板×8.*铁锭×1/); // M3 sustainable machine recipe.
    assert.ok(WORKSHOP_KIT[WATERWHEEL_ITEM_ID]>0);
    assert.match(materialSource(FLAG_BASE),/仅创造模式或关卡编辑器/);
});

test('审查 R7：旧空背包创造档首进生存可领一次；旧生存/非空创造不补发', () => {
    for(const [mode,inventory,eligible] of [
        [GameModes.CREATIVE,{},true],
        [GameModes.SURVIVAL,{},false],
        [GameModes.CREATIVE,{[ItemTypes.APPLE]:1},false],
    ]) {
        setup();state.gameMode=mode;state.player.inventory=inventory;state.saveSlot=4;assert.equal(saveGame(),true);
        const raw=JSON.parse(localStorage.getItem('mcweb.save.v1.slot4'));delete raw.survivalStarted;
        localStorage.setItem('mcweb.save.v1.slot4',JSON.stringify(raw));assert.equal(loadGame(4),true);
        assert.equal(state.survivalStarted,!eligible);setGameMode(GameModes.SURVIVAL);
        assert.equal(state.player.inventory[BlockTypes.WOOL]||0,eligible?3:0);
        const first={...state.player.inventory};setGameMode(GameModes.CREATIVE);setGameMode(GameModes.SURVIVAL);
        assert.deepEqual(state.player.inventory,first);
    }
});

test('审查 R8：二至四格高的平台敌人能走出边缘落到床边，应阻止睡觉', () => {
    for(const height of [2,3,4]) {
        setup();bed();setB(23,8+height,20,BlockTypes.STONE);
        state.enemies.push({x:23.5,y:9+height,z:20.5,hostile:true,hp:20});state.time=state.dayLength*.9;
        assert.equal(interactBedAt(20,9,20).ok,false,`${height} 格高台可落下`);
    }
});
