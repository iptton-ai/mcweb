import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { freshWorld, state, setB } from './kit.mjs';
import { BlockTypes, GameModes, HotbarBlocks, ToolTypes, RECIPES, BlockInfo } from '../../js/config.js';
import { camera } from '../../js/engine.js';
import { spawnEnemy, damageEnemy, updateEnemies } from '../../js/entities.js';
import { tryAttackEnemy, dropHeldItem } from '../../js/interaction.js';
import { craftRecipe } from '../../js/ui.js';
import { damageHeldTool } from '../../js/mining.js';
import { updateItemDrops } from '../../js/items.js';

function setup() {
    freshWorld({ gameMode: GameModes.SURVIVAL });
    state.levelRun = null; state.levelEdit = null; state.viewMode = 0;
    Object.assign(state.player, { x: 10.5, y: 10, z: 10.5, yaw: 0, pitch: 0,
        attackCooldown: 0, invulnTimer: 0, toolWear: {}, selectedSlot: 0 });
}

test('玩家准星近战能命中前方实体，墙挡住后不扣血', () => {
    setup();
    spawnEnemy(10.5, 10, 8.5);
    const enemy = state.enemies[0];
    const hp = enemy.hp;
    assert.equal(tryAttackEnemy(), true);
    assert.ok(enemy.hp < hp);
    enemy.x = 10.5; enemy.z = 8.5;
    state.player.attackCooldown = 0;
    const after = enemy.hp;
    setB(10, 11, 9, BlockTypes.STONE);
    assert.equal(tryAttackEnemy(), false);
    assert.equal(enemy.hp, after);
});

test('玩家近战按实体碰撞盒命中，四格外目标不受伤', () => {
    setup();
    spawnEnemy(10.5, 10, 5.9);
    const enemy = state.enemies[0];
    const hp = enemy.hp;
    assert.equal(tryAttackEnemy(), false);
    assert.equal(enemy.hp, hp);
    enemy.z = 6.4; // 近侧面 z6.7 距眼睛3.8格，仍可命中。
    assert.equal(tryAttackEnemy(), true);
    assert.ok(enemy.hp < hp);
});

test('第三人称准星跳过身后实体，仍能攻击前方且受墙遮挡', () => {
    setup(); state.viewMode = 1;
    camera.position = new Vector3(10.5, 11.62, 15);
    camera.quaternion = { x: 0, y: 0, z: 0, w: 1 };
    spawnEnemy(10.5, 10, 12.5);
    spawnEnemy(10.5, 10, 8.5);
    const [rear, front] = state.enemies;
    const rearHp = rear.hp, frontHp = front.hp;
    assert.equal(tryAttackEnemy(), true);
    assert.equal(rear.hp, rearHp);
    assert.ok(front.hp < frontHp);
    front.x = 10.5; front.z = 8.5; state.player.attackCooldown = 0;
    setB(10, 11, 9, BlockTypes.STONE);
    const hp = front.hp;
    assert.equal(tryAttackEnemy(), false);
    assert.equal(front.hp, hp);
    assert.equal(rear.hp, rearHp);
    state.viewMode = 0;
});

test('僵尸隔墙近战不扣血，移走墙后同距离可以攻击', () => {
    setup(); state.player.y = 9; state.player.z = 10.9;
    spawnEnemy(10.5, 9, 12.1);
    setB(10, 10, 11, BlockTypes.STONE);
    updateEnemies(0.01);
    assert.equal(state.player.health, 20);
    setB(10, 10, 11, BlockTypes.AIR);
    updateEnemies(0.01);
    assert.ok(state.player.health < 20);
});

test('第三人称可攻击跨眼睛平面的贴脸目标，完全身后的仍不可攻击', () => {
    setup(); state.viewMode = 1;
    camera.position = new Vector3(10.5, 11.62, 15);
    camera.quaternion = { x: 0, y: 0, z: 0, w: 1 };
    spawnEnemy(10.5, 10, 10.4);
    const enemy = state.enemies[0]; const hp = enemy.hp;
    assert.equal(tryAttackEnemy(), true);
    assert.ok(enemy.hp < hp);
    enemy.z = 10.9; state.player.attackCooldown = 0;
    const after = enemy.hp;
    assert.equal(tryAttackEnemy(), false);
    assert.equal(enemy.hp, after);
    state.viewMode = 0;
});

test('零距离生物追击与受击不会污染坐标', () => {
    setup(); state.player.y = 9;
    spawnEnemy(state.player.x, state.player.y, state.player.z);
    const enemy = state.enemies[0];
    updateEnemies(0.01);
    damageEnemy(enemy, 1);
    assert.ok([enemy.x, enemy.y, enemy.z, enemy.vy].every(Number.isFinite));
    assert.ok(state.player.health < 20);
});

test('合成备用工具保留活动工具磨损，用坏后备用工具满耐久', () => {
    setup();
    const id = ToolTypes.WOOD_PICKAXE;
    const recipe = RECIPES.find(r => r.out === id);
    state.player.selectedSlot = HotbarBlocks.indexOf(id);
    state.player.inventory = { ...recipe.cost, [id]: 1 };
    state.player.toolWear[id] = BlockInfo[id].maxDurability - 1;
    setB(11, 10, 10, BlockTypes.CRAFTING_TABLE);
    assert.equal(craftRecipe(recipe), null);
    assert.equal(state.player.inventory[id], 2);
    assert.equal(state.player.toolWear[id], BlockInfo[id].maxDurability - 1);
    damageHeldTool();
    assert.equal(state.player.inventory[id], 1);
    assert.equal(state.player.toolWear[id] || 0, 0);
});

test('丢弃并拾回最后一把工具保留磨损，库存清零后新合成工具满耐久', () => {
    setup();
    const id = ToolTypes.WOOD_PICKAXE;
    state.player.selectedSlot = HotbarBlocks.indexOf(id);
    state.player.inventory[id] = 1; state.player.toolWear[id] = 24;
    dropHeldItem();
    assert.equal(state.player.inventory[id], 0);
    assert.equal(state.itemDrops.length, 1);
    const drop = state.itemDrops[0];
    assert.equal(drop.toolWear, 24);
    // 经过丢弃冷却并走近实体，走真实拾取入口。
    drop.age = drop.pickupDelay;
    Object.assign(state.player, { x: drop.x, y: drop.y - 0.9, z: drop.z });
    updateItemDrops(0.01);
    assert.equal(state.player.inventory[id], 1);
    assert.equal(state.player.toolWear[id], 24);
    assert.equal(state.itemDrops.length, 0);
    dropHeldItem();
    const recipe = RECIPES.find(r => r.out === id);
    Object.assign(state.player.inventory, recipe.cost);
    setB(Math.floor(state.player.x) + 1, Math.floor(state.player.y), Math.floor(state.player.z), BlockTypes.CRAFTING_TABLE);
    assert.equal(craftRecipe(recipe), null);
    assert.equal(state.player.toolWear[id] || 0, 0);
});

test('有备用工具时丢弃一把不洗活动工具耐久，拾回旧工具取较大磨损', () => {
    setup();
    const id = ToolTypes.WOOD_PICKAXE;
    state.player.selectedSlot = HotbarBlocks.indexOf(id);
    state.player.inventory[id] = 2; state.player.toolWear[id] = 28;
    dropHeldItem();
    assert.equal(state.player.inventory[id], 1);
    assert.equal(state.player.toolWear[id], 28);
    const drop = state.itemDrops[0];
    drop.toolWear = 35; drop.age = drop.pickupDelay;
    Object.assign(state.player, { x: drop.x, y: drop.y - 0.9, z: drop.z });
    updateItemDrops(0.01);
    assert.equal(state.player.inventory[id], 2);
    assert.equal(state.player.toolWear[id], 35);
});
