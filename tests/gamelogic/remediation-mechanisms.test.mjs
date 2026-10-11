// 玩法审查修复：真实按钮/投料器/TNT 模块回归，渲染层仅观测重建入口。
// 运行：node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/remediation-mechanisms.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { BufferAttribute, BufferGeometry } from 'three';

// 本文件进程内的渲染观测器：沿用共享 loader 的真实纯函数与渲染桩，
// 只记录 rebuildChunk 调用。游戏模块必须在注册之后动态导入。
register('data:text/javascript,' + encodeURIComponent(`
export async function load(url, context, next) {
    const result = await next(url, context);
    if (!url.endsWith('/js/chunk.js')) return result;
    const source = String(result.source);
    const old = 'export function rebuildChunk() {}';
    if (!source.includes(old)) throw new Error('机关回归：chunk 渲染桩入口已变化');
    return { ...result, source: source.replace(old,
        'export function rebuildChunk(cx, cz) { globalThis.__remediationRebuiltChunks?.push([cx, cz]); }') };
}
`), import.meta.url);

const { freshWorld, pump, at, setB, state } = await import('./kit.mjs');
const {
    BlockTypes, BUTTON_ITEM_ID, BUTTON_PULSE_SEC, LAMP_ITEM_ID, CHUNK_SIZE,
    WATERWHEEL_ITEM_ID, SHAFT_ITEM_ID, BELT_ITEM_ID, DEPLOYER_ITEM_ID, WHEEL_RPM,
    PISTON_ITEM_ID, buttonId, leverId, buttonPressed, isLampLitId,
    doorOpen, pistonExtended,
} = await import('../../js/config.js');
const { initRedstone, placeRedstone, pressButtonAt } = await import('../../js/redstone.js');
const { tryPlaceDoor, toggleDoorAt } = await import('../../js/door.js');
const { placePiston } = await import('../../js/piston.js');
const { kineticStatusAt, isBeltRunningAt, placeKinetic } = await import('../../js/kinetic.js');
const { spawnItemDrop } = await import('../../js/items.js');
const { spawnTntEntity, explode } = await import('../../js/tnt.js');

// 掉落物渲染路径所需的 UV 可写桩，仅作用于本测试进程（同 kinetic-cross）。
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
if (typeof BufferAttribute.prototype.setXY !== 'function') {
    BufferAttribute.prototype.setXY = function (i, x, y) {
        this.array[i * this.itemSize] = x;
        this.array[i * this.itemSize + 1] = y;
        return this;
    };
}

const UP = { dx: 0, dy: 1, dz: 0 };
const FX = { dx: 1, dy: 0, dz: 0 };
const FZ = { dx: 0, dy: 0, dz: 1 };

test('机关恢复：按下按钮复位并熄灭负载，旧计时不能提前弹出新脉冲', () => {
    freshWorld();
    assert.equal(placeRedstone(20, 9, 20, BUTTON_ITEM_ID, UP), null);
    assert.equal(placeRedstone(21, 9, 20, LAMP_ITEM_ID, UP), null);
    pressButtonAt(20, 9, 20);
    pump(0.05, 16); // 恢复前旧脉冲仅剩 0.2 秒。
    assert.equal(buttonPressed(at(20, 9, 20)), 1);
    assert.equal(isLampLitId(at(21, 9, 20)), true);

    initRedstone();
    assert.equal(buttonPressed(at(20, 9, 20)), 0, '无剩余计时的存档按钮必须弹起');
    assert.equal(isLampLitId(at(21, 9, 20)), false, '网络恢复不保留永久供能');
    pressButtonAt(20, 9, 20);
    pump(0.05, 6);
    assert.equal(buttonPressed(at(20, 9, 20)), 1, '旧世界计时到期不能弹出新世界按钮');
    assert.equal(isLampLitId(at(21, 9, 20)), true);
    pump(0.05, Math.ceil(BUTTON_PULSE_SEC / 0.05));
    assert.equal(buttonPressed(at(20, 9, 20)), 0, '新按钮仍按正常节拍弹出');
    assert.equal(isLampLitId(at(21, 9, 20)), false);
});

test('按钮恢复下降沿：此前由按钮打开的门关闭、伸出的活塞延迟收回', () => {
    freshWorld();
    assert.equal(placeRedstone(50, 9, 50, BUTTON_ITEM_ID, UP), null);
    assert.equal(tryPlaceDoor(51, 9, 50, 0), true);
    assert.equal(placePiston(49, 9, 50, PISTON_ITEM_ID, { dx: -1, dy: 0, dz: 0 }), null);
    pressButtonAt(50, 9, 50);
    pump(0.05, 4);
    assert.equal(doorOpen(at(51, 9, 50)), 1);
    assert.equal(pistonExtended(at(49, 9, 50)), 1);

    initRedstone();
    assert.equal(buttonPressed(at(50, 9, 50)), 0);
    assert.equal(doorOpen(at(51, 9, 50)), 0, '按钮释放必须产生真实下降沿关门');
    pump(0.05, 4);
    assert.equal(pistonExtended(at(49, 9, 50)), 0, '按钮释放必须让伸出活塞收回');
    assert.equal(at(48, 9, 50), BlockTypes.AIR, '头不能残留');
});

test('红石初始化幂等：重复恢复不能丢失待收回活塞，也不能丢失合法伸出动作', () => {
    freshWorld();
    assert.equal(placeRedstone(50, 9, 50, BUTTON_ITEM_ID, UP), null);
    assert.equal(placePiston(49, 9, 50, PISTON_ITEM_ID, { dx: -1, dy: 0, dz: 0 }), null);
    pressButtonAt(50, 9, 50);
    pump(0.05, 4);
    assert.equal(pistonExtended(at(49, 9, 50)), 1);
    assert.equal(placePiston(91, 9, 90, PISTON_ITEM_ID, FX), null);
    setB(90, 9, 90, leverId(0, 1)); // 存档中收态活塞有电，恢复后应补伸出。
    initRedstone();
    initRedstone(); // 实际启动/切槽/退出关卡都会在帧消费前再次初始化。
    pump(0.05, 4);
    assert.equal(pistonExtended(at(49, 9, 50)), 0, '重置队列后须重建实际伸态活塞的收回动作');
    assert.equal(at(48, 9, 50), BlockTypes.AIR);
    assert.equal(pistonExtended(at(91, 9, 90)), 1, '重置队列后有电收态活塞仍应伸出');
});

test('按钮恢复基线不执行机关：无电手动门保持，按钮旁 TNT 不误点燃，拉杆 TNT 照常点燃', () => {
    freshWorld();
    assert.equal(tryPlaceDoor(60, 9, 60, 0), true);
    toggleDoorAt(60, 9, 60);
    assert.equal(doorOpen(at(60, 9, 60)), 1);
    // 直接种入存档变体，尚未运行供电求解；基线求解不能点燃即将被释放的按钮旁 TNT。
    setB(70, 9, 70, buttonId(0, 1));
    setB(71, 9, 70, BlockTypes.TNT);
    setB(80, 9, 80, leverId(0, 1));
    setB(81, 9, 80, BlockTypes.TNT);
    initRedstone();
    assert.equal(doorOpen(at(60, 9, 60)), 1, '无电手动门没有下降沿，不应关门');
    assert.equal(buttonPressed(at(70, 9, 70)), 0);
    assert.deepEqual(state.tntEntities.map(t => [t.x, t.y, t.z]), [[81, 9, 80]], '只点燃最终仍有电的拉杆 TNT');
    const fuse = state.tntEntities[0].fuse;
    initRedstone();
    assert.equal(doorOpen(at(60, 9, 60)), 1, '重复恢复仍保留手动开门');
    assert.equal(state.tntEntities.length, 1, '重复恢复不能复制合法 TNT 引信');
    assert.equal(state.tntEntities[0].fuse, fuse, '重复恢复不能重置合法引信');
    pump(0.05, 4);
    assert.equal(at(71, 9, 70), BlockTypes.TNT, '被释放按钮的 TNT 仍是惰性');
    assert.equal(state.tntEntities.length, 1, '合法拉杆引信没有被初始化取消');
});

test('自动投料：石头替换另一条动力线的水车顶水后，水车与带立即停转', () => {
    freshWorld();
    // 目标动力线：顶水 -> X 轴水车 -> 轴 -> 传送带。
    setB(24, 10, 30, BlockTypes.WATER);
    assert.equal(placeKinetic(24, 9, 30, WATERWHEEL_ITEM_ID, FX), null);
    assert.equal(placeKinetic(25, 9, 30, SHAFT_ITEM_ID, FX), null);
    assert.equal(placeKinetic(26, 9, 30, BELT_ITEM_ID, FX), null);
    assert.equal(isBeltRunningAt(26, 9, 30), true);
    // 独立供电的投料器正对上述顶水，两网不能因共用动力互相掩盖。
    setB(24, 11, 27, BlockTypes.WATER);
    assert.equal(placeKinetic(24, 10, 27, WATERWHEEL_ITEM_ID, FZ), null);
    assert.equal(placeKinetic(24, 10, 28, SHAFT_ITEM_ID, FZ), null);
    assert.equal(placeKinetic(24, 10, 29, DEPLOYER_ITEM_ID, FZ), null);
    assert.match(kineticStatusAt(24, 10, 29), new RegExp(`转速 ${WHEEL_RPM} RPM`));
    spawnItemDrop(24.5, 10.5, 30.5, BlockTypes.STONE, 1);
    pump(0.05);
    assert.equal(at(24, 10, 30), BlockTypes.STONE, '真实物品被自动投进水格');
    assert.equal(state.itemDrops.length, 0, '被投入的实体只消耗一次');
    assert.match(kineticStatusAt(25, 9, 30), /静止/);
    assert.equal(isBeltRunningAt(26, 9, 30), false, '被断水的带不能使用旧网络转速');
    assert.match(kineticStatusAt(24, 10, 29), new RegExp(`转速 ${WHEEL_RPM} RPM`), '独立投料器仍有动力');
});

test('TNT 点燃守卫：空气不能点燃，同位置重复点燃不复制或重置引信', () => {
    freshWorld();
    spawnTntEntity(40, 20, 40);
    assert.equal(state.tntEntities.length, 0);
    setB(40, 20, 40, BlockTypes.TNT);
    spawnTntEntity(40, 20, 40);
    pump(0.05, 10);
    const remaining = state.tntEntities[0].fuse;
    spawnTntEntity(40, 20, 40);
    assert.equal(state.tntEntities.length, 1);
    assert.equal(state.tntEntities[0].fuse, remaining, '重复点燃不能延长已有引信');
    pump(0.05, 42);
    assert.equal(state.tntEntities.length, 0);
    assert.equal(at(40, 20, 40), BlockTypes.AIR);
});

test('TNT 引信取消：点燃方块被替换后不炸替代块或周围结构', () => {
    freshWorld();
    setB(40, 20, 40, BlockTypes.TNT);
    setB(41, 20, 40, BlockTypes.PLANKS);
    spawnTntEntity(40, 20, 40);
    pump(0.05, 20);
    setB(40, 20, 40, BlockTypes.STONE);
    pump(0.05, 40);
    assert.equal(state.tntEntities.length, 0);
    assert.equal(at(40, 20, 40), BlockTypes.STONE);
    assert.equal(at(41, 20, 40), BlockTypes.PLANKS);
});

test('TNT 爆心重合：玩家和怪物位置与速度保持有限数值', () => {
    freshWorld();
    Object.assign(state.player, { x: 40.5, y: 20.5, z: 40.5, vx: 0, vy: 0, vz: 0 });
    const enemy = { x: 40.5, y: 20.5, z: 40.5, hp: 100, hostile: true };
    state.enemies.push(enemy);
    explode(40, 20, 40);
    assert.equal(state.player.vy, 5, '重合时仍产生向上冲量');
    assert.ok(['x', 'y', 'z', 'vx', 'vy', 'vz'].every(k => Number.isFinite(state.player[k])));
    assert.ok(['x', 'y', 'z', 'hp'].every(k => Number.isFinite(enemy[k])));
    assert.equal(enemy.hp, 80, '零距离伤害正常计算');
});

test('孤立 TNT：引信移除唯一方块后仍刷新爆心区块及相邻区块', () => {
    freshWorld();
    const x = CHUNK_SIZE * 2, y = 20, z = CHUNK_SIZE * 3;
    setB(x, y, z, BlockTypes.TNT); // 爆炸范围无其它方块，不能借旁边方块触发重建。
    spawnTntEntity(x, y, z);
    globalThis.__remediationRebuiltChunks = [];
    try {
        pump(0.05, 52);
        assert.equal(at(x, y, z), BlockTypes.AIR);
        assert.equal(state.tntEntities.length, 0);
        const rebuilt = new Set(globalThis.__remediationRebuiltChunks.map(([cx, cz]) => `${cx},${cz}`));
        for (const key of ['2,3', '1,3', '3,3', '2,2', '2,4']) {
            assert.ok(rebuilt.has(key), `爆心移除必须刷新区块 ${key}`);
        }
    } finally {
        delete globalThis.__remediationRebuiltChunks;
    }
});
