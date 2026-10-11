// ==================== gamelogic 底座冒烟 ====================
// 验证无头测试底座本身：真实 redstone/door/piston 模块在 Node 里原样运行，
// 渲染层被垫掉而世界数据为真。这条链通了，其余跨模组测试才有地基。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, pump, at, setB, state } from './kit.mjs';
import { placeRedstone, toggleLeverAt, pressButtonAt, updateRedstoneTick } from '../../js/redstone.js';
import { tryPlaceDoor, toggleDoorAt } from '../../js/door.js';
import { placePiston, updatePistonTick } from '../../js/piston.js';
import {
    DUST_ITEM_ID, LEVER_ITEM_ID, LAMP_ITEM_ID, BUTTON_ITEM_ID, PISTON_ITEM_ID,
    BlockTypes, dustLit, isLampLitId, isDoorId, doorOpen, isPistonId, pistonExtended, isButtonId, buttonPressed,
} from '../../js/config.js';

test('底座冒烟：拉杆→红石粉点亮→远端灯亮', () => {
    freshWorld();
    const y = 9; // 站在 floorY=8 的石面上
    // 拉杆贴地放 (20,y,20)，向 +x 铺 3 格红石粉，末端放灯
    assert.equal(placeRedstone(20, y, 20, LEVER_ITEM_ID, { dx: 0, dy: 1, dz: 0 }), null);
    for (const x of [21, 22, 23]) {
        assert.equal(placeRedstone(x, y, 20, DUST_ITEM_ID, { dx: 0, dy: 1, dz: 0 }), null);
    }
    assert.equal(placeRedstone(24, y, 20, LAMP_ITEM_ID, { dx: 0, dy: 1, dz: 0 }), null);
    assert.equal(dustLit(at(21, y, 20)), 0, '拉杆没开，红石粉应熄灭');
    assert.equal(isLampLitId(at(24, y, 20)), false, '灯应灭');

    toggleLeverAt(20, y, 20);
    assert.equal(dustLit(at(21, y, 20)), 1, '拉杆开后红石粉点亮');
    assert.equal(dustLit(at(23, y, 20)), 1, '末端粉也点亮（衰减 15 级 >> 3 格）');
    assert.equal(isLampLitId(at(24, y, 20)), true, '灯亮');

    toggleLeverAt(20, y, 20);
    assert.equal(dustLit(at(21, y, 20)), 0, '拉杆关后粉灭');
    assert.equal(isLampLitId(at(24, y, 20)), false, '灯灭');
});

test('底座冒烟：红石信号上升沿自动开门、下降沿自动关门', () => {
    freshWorld();
    const y = 9;
    // 门（竖直占两格：y 与 y+1）+ 旁边一格拉杆，拉杆给门供能（门 6 邻有激活红石即开）
    assert.equal(tryPlaceDoor(30, y, 30, 0), true, '门放置成功');
    assert.equal(isDoorId(at(30, y, 30)), true);
    assert.equal(doorOpen(at(30, y, 30)), 0, '初始关');

    placeRedstone(29, y, 30, LEVER_ITEM_ID, { dx: 0, dy: 1, dz: 0 });
    toggleLeverAt(29, y, 30);
    pump(0.05, 2); // 门是边沿驱动：tick 一帧吃到上升沿
    assert.equal(doorOpen(at(30, y, 30)), 1, '信号上升沿门自动开');

    toggleLeverAt(29, y, 30);
    pump(0.05, 2);
    assert.equal(doorOpen(at(30, y, 30)), 0, '信号下降沿门自动关');

    // 手动右键开门仍可用（非锁定态）
    toggleDoorAt(30, y, 30);
    assert.equal(doorOpen(at(30, y, 30)), 1, '右键手动开门不受影响');
});

test('底座冒烟：按钮脉冲 → 活塞 0.15s 延迟伸出', () => {
    freshWorld();
    const y = 9;
    // 按钮贴地 + 相邻活塞（活塞朝 +x，指向面前方块）
    assert.equal(placeRedstone(40, y, 40, BUTTON_ITEM_ID, { dx: 0, dy: 1, dz: 0 }), null);
    assert.equal(placePiston(41, y, 40, PISTON_ITEM_ID, { dx: 1, dy: 0, dz: 0 }), null);
    setB(42, y, 40, 3); // 面前方一块石头（被推目标）
    assert.equal(pistonExtended(at(41, y, 40)), 0);

    pressButtonAt(40, y, 40);
    assert.equal(buttonPressed(at(40, y, 40)), 1, '按钮按下变体');
    // 信号已供能但活塞动作队列有 0.15s 延迟：立刻 tick 一小步还不应伸出
    updateRedstoneTick(0.05);
    assert.equal(pistonExtended(at(41, y, 40)), 0, '延迟窗口内未伸出');
    updatePistonTick(0.05);
    updateRedstoneTick(0.05);
    updatePistonTick(0.05);
    assert.equal(pistonExtended(at(41, y, 40)), 1, '0.15s 后伸出');
    assert.equal(pistonExtended(at(42, y, 40)), 1, '前方石头被推变活塞头');

    // 等 1 秒按钮弹出 → 下降沿收回
    pump(0.05, 30);
    assert.equal(buttonPressed(at(40, y, 40)), 0, '按钮自动弹出');
    assert.equal(isPistonId(at(41, y, 40)) && pistonExtended(at(41, y, 40)), 0, '活塞收回');
    assert.equal(at(42, y, 40), BlockTypes.AIR, '活塞头已撤回');
    assert.equal(at(43, y, 40), BlockTypes.STONE, '普通活塞收回：被推的石头留在推达位置');
    state; // 仅供调试断点
});
