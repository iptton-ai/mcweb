import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, pump, state, setB, at } from './kit.mjs';
import {
    BELT_ITEM_ID, BELT_SPEED, BlockTypes, GameModes, PISTON_ITEM_ID,
    PLAYER_HEIGHT, PLAYER_WIDTH, SHAFT_ITEM_ID, SLIME_BOUNCE_KEEP, WATERWHEEL_ITEM_ID,
} from '../../js/config.js';
import { updatePlayerPhysics } from '../../js/playerPhysics.js';
import { isBeltRunningAt, placeKinetic, updateKineticNetwork } from '../../js/kinetic.js';
import { enqueuePistonAction, placePiston } from '../../js/piston.js';

function physicsWorld(player = {}) {
    freshWorld({ gameMode: GameModes.SURVIVAL });
    state.levelRun = null;
    state.levelEdit = null;
    state.camMode = 'free'; // 本组只推进真实物理；不读取 UI 按键或更新相机。
    Object.assign(state.player, {
        x: 10.5, y: 20, z: 10.5,
        vx: 0, vy: 0, vz: 0, onGround: false,
        fallStartY: null, invulnTimer: 0, toolWear: {},
        hunger: 20, air: 10, xp: 0,
        ...player,
    });
    return state.player;
}

test('部分覆盖头部的高墙阻止 X/Z 方向移动', () => {
    for (const axis of ['x', 'z']) {
        const p = physicsWorld({ y: 10.4, [axis]: 10.6, ['v' + axis]: 8 });
        setB(axis === 'x' ? 11 : 10, 12, axis === 'z' ? 11 : 10, BlockTypes.STONE);
        updatePlayerPhysics(0.05);
        assert.equal(p['v' + axis], 0, `${axis} 速度被头部覆盖的墙归零`);
        assert.ok(p[axis] + PLAYER_WIDTH / 2 < 11, `${axis} 身体停在墙外`);
    }
});

test('高速下落扫过薄平台，并在整个脚印中选择最先触及的一层', () => {
    const p = physicsWorld({ x: 10.8, vy: -40, fallStartY: 20 });
    setB(11, 18, 10, BlockTypes.STONE); // 先碰到的薄平台在脚印后一列。
    setB(10, 16, 10, BlockTypes.STONE); // 终点所在层更低，不能优先落在它上面。
    updatePlayerPhysics(0.1); // 无碰撞时脚部将从 20 到 16。
    assert.equal(p.y, 19.001);
    assert.equal(p.vy, 0);
    assert.equal(p.onGround, true);
    assert.equal(p.health, 20);
});

test('高速上升按头部扫掠顺序停在最先触及的薄天花板下', () => {
    const p = physicsWorld({ x: 10.8, y: 10, vy: 42.8 });
    setB(11, 13, 10, BlockTypes.STONE);
    setB(10, 15, 10, BlockTypes.STONE);
    updatePlayerPhysics(0.1); // 重力后 vy=40，头顶原计划从 11.8 到 15.8。
    assert.ok(Math.abs(p.y - (13 - PLAYER_HEIGHT - 0.001)) < 1e-10);
    assert.equal(p.vy, 0);
    assert.equal(p.onGround, false);
    assert.ok(p.y + PLAYER_HEIGHT < 13);
});

test('扫掠落到粘液薄平台仍反弹、清旧落差且不扣血', () => {
    const p = physicsWorld({ vy: -40, fallStartY: 40 });
    setB(10, 18, 10, BlockTypes.SLIME);
    updatePlayerPhysics(0.1);
    assert.equal(p.y, 19.001);
    assert.equal(p.vy, 40 * SLIME_BOUNCE_KEEP);
    assert.equal(p.onGround, false);
    assert.equal(p.health, 20);
    assert.equal(p.fallStartY, p.y, '旧的 40 格摔落起点已经清除');
    for (let frame = 0; frame < 320; frame++) {
        p.invulnTimer = 0;
        updatePlayerPhysics(0.05);
    }
    assert.equal(p.onGround, true, '弹跳衰减后能稳定站住');
    assert.equal(p.y, 19.001);
    assert.equal(p.health, 20, '最终站住也不会按最初落差补扣血');
});

test('普通平台扫掠落地结算摔伤，落地后不会重复扣血', () => {
    const p = physicsWorld({ vy: -40, fallStartY: 27 });
    setB(10, 18, 10, BlockTypes.STONE);
    updatePlayerPhysics(0.1);
    assert.equal(p.y, 19.001);
    assert.equal(p.onGround, true);
    assert.equal(p.health, 16); // floor((27 - 19.001) - 3)=4。
    p.invulnTimer = 0;
    updatePlayerPhysics(0.1);
    assert.equal(p.health, 16);
    assert.equal(p.y, 19.001);
});

test('水中落地继续使用游泳阻尼并豁免原摔落伤害', () => {
    const p = physicsWorld({ y: 10, vy: -5, fallStartY: 40 });
    setB(10, 9, 10, BlockTypes.STONE);
    setB(10, 10, 10, BlockTypes.WATER);
    setB(10, 11, 10, BlockTypes.WATER);
    updatePlayerPhysics(0.1);
    assert.equal(p.y, 10.001);
    assert.equal(p.onGround, true);
    assert.equal(p.inWater, true);
    assert.equal(p.health, 20);
    assert.equal(p.fallStartY, null);
});

test('运转传送带仍载玩家水平移动，垂直扫掠保持脚下支撑', () => {
    const p = physicsWorld({ x: 26.5, y: 9, z: 30.5, onGround: true, yaw: -Math.PI / 2 });
    const east = { dx: 1, dy: 0, dz: 0 };
    setB(24, 10, 30, BlockTypes.WATER);
    assert.equal(placeKinetic(24, 9, 30, WATERWHEEL_ITEM_ID, east), null);
    assert.equal(placeKinetic(25, 9, 30, SHAFT_ITEM_ID, east), null);
    assert.equal(placeKinetic(26, 9, 30, BELT_ITEM_ID, east), null);
    assert.equal(isBeltRunningAt(26, 9, 30), true);
    updatePlayerPhysics(0.1);
    assert.ok(Math.abs(p.x - (26.5 + BELT_SPEED * 0.1)) < 1e-10);
    assert.equal(p.y, 9.001);
    assert.equal(p.onGround, true);
    setB(24, 10, 30, BlockTypes.AIR);
    updateKineticNetwork();
    const stoppedX = p.x;
    updatePlayerPhysics(0.1);
    assert.equal(p.x, stoppedX);
    assert.equal(p.onGround, true);
});

test('向上活塞载玩家升一格，下一物理帧仍站在被推平台上', () => {
    const p = physicsWorld({ y: 11, onGround: true, fallStartY: 11 });
    assert.equal(placePiston(10, 9, 10, PISTON_ITEM_ID, { dx: 0, dy: 1, dz: 0 }), null);
    setB(10, 10, 10, BlockTypes.STONE);
    enqueuePistonAction(10, 9, 10, true);
    pump(0.05, 4);
    assert.equal(at(10, 11, 10), BlockTypes.STONE);
    assert.equal(p.y, 12);
    updatePlayerPhysics(0.1);
    assert.equal(p.y, 12.001);
    assert.equal(p.onGround, true);
    assert.equal(p.health, 20);
});
