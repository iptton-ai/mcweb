// ==================== playerPhysics.js ====================

import * as THREE from 'three';
import { BELT_DIRS, BELT_SPEED, BlockTypes, FALL_DAMAGE_MIN, FLY_SPEED, GRAVITY, JUMP_VELOCITY, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_WIDTH, SLIME_BOUNCE_KEEP, SLIME_BOUNCE_MIN, THIRD_PERSON_DIST, WALK_SPEED, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH, beltDir, isBeltId } from './config.js';
import { state } from './state.js';
import { camera } from './engine.js';
import { getBlock } from './world.js';
import { isSolid } from './chunk.js';
import { playerMesh } from './entities.js';
import { keys } from './input.js';
import { showTooltip } from './ui.js';
import { isGameActive } from './uiModal.js';
import { damagePlayer } from './playerLife.js';
import { isBeltRunningAt } from './kinetic.js';

// ==================== 玩家物理 ====================
export function updatePlayerPhysics(dt) {
    const p = state.player;

    // 移动输入（仅 playing 状态读取按键：暂停/背包/死亡时世界照常运行但玩家不响应按键；
    // 自由摄像头/建造跟拍视角下键位归摄像头，玩家原地站立；
    // AI 助手面板打开不影响——面板开着也能用键盘继续玩，聊天框打字由输入焦点天然隔离）
    const k = (isGameActive() && state.camMode === 'player') ? keys : {};

    // 水体判定（游泳物理与氧气系统，见下方与 playerLife.js）：
    // inWater = 腰腹泡水（浮力/减速）；underwater = 眼睛没入（氧气倒数 + 挖掘 ×5 惩罚）
    const waistBlock = getBlock(Math.floor(p.x), Math.floor(p.y + 0.6), Math.floor(p.z));
    const eyeBlock = getBlock(Math.floor(p.x), Math.floor(p.y + PLAYER_EYE_HEIGHT), Math.floor(p.z));
    p.inWater = !p.flying && (waistBlock === BlockTypes.WATER || eyeBlock === BlockTypes.WATER);
    p.underwater = !p.flying && eyeBlock === BlockTypes.WATER;

    // 潜行（Shift：×0.35，不飞行时）与疾跑（Ctrl+W：×1.5，饥饿消耗 ×2.7 见 playerLife.js）
    const sneak = !p.flying && !!(k['ShiftLeft'] || k['ShiftRight']);
    const sprint = !p.flying && !p.inWater && !!(k['ControlLeft'] || k['ControlRight']) && !!k['KeyW'];
    p.sprinting = sprint;
    const speed = p.flying ? FLY_SPEED : WALK_SPEED *
        (sneak ? 0.35 : 1) * (sprint ? 1.5 : 1) * (p.inWater ? 0.6 : 1);

    const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const moveDir = new THREE.Vector3(0, 0, 0);

    if (k['KeyW']) moveDir.add(forward);
    if (k['KeyS']) moveDir.sub(forward);
    if (k['KeyA']) moveDir.sub(right);
    if (k['KeyD']) moveDir.add(right);
    if (moveDir.length() > 0) moveDir.normalize();

    let targetVx = moveDir.x * speed;
    let targetVz = moveDir.z * speed;

    // 玩家骑带（Create-lite L1 链 2，G2 裁决 R3-17）：脚部格是运转中的传送带 →
    // 水平速度目标叠加带向 BELT_SPEED（Create 标志性体验；站静止带无移动；
    // 怪物 v1 不载——plan §5 差异 16）。走带向加速/逆带向减速，碰撞检测自然兜底
    if (!p.flying) {
        const fx = Math.floor(p.x), fy = Math.floor(p.y + 0.1), fz = Math.floor(p.z);
        const fb = getBlock(fx, fy, fz);
        if (isBeltId(fb) && isBeltRunningAt(fx, fy, fz)) {
            const [ux, , uz] = BELT_DIRS[beltDir(fb)];
            targetVx += ux * BELT_SPEED;
            targetVz += uz * BELT_SPEED;
        }
    }

    // 平滑加速
    const accel = p.flying ? 8 : 12;
    p.vx += (targetVx - p.vx) * Math.min(1, accel * dt);
    p.vz += (targetVz - p.vz) * Math.min(1, accel * dt);

    const wasOnGround = p.onGround;

    if (p.flying) {
        p.vy = 0;
        if (k['Space']) p.vy = FLY_SPEED;
        if (k['ShiftLeft'] || k['ShiftRight']) p.vy = -FLY_SPEED;
        p.onGround = false;
    } else if (p.inWater) {
        // 游泳：空格上浮、松手下沉，指数阻尼（水中不摔伤，fallStartY 清空）
        p.vy += ((k['Space'] ? 16 : -6) * dt);
        p.vy *= Math.exp(-3.2 * dt);
        p.fallStartY = null;
    } else {
        p.vy += GRAVITY * dt;
        p.vy = Math.max(p.vy, -40);
        if (k['Space'] && p.onGround) {
            p.vy = JUMP_VELOCITY;
            p.onGround = false;
        }
    }

    // 碰撞检测与位置更新
    const halfW = PLAYER_WIDTH / 2;
    const newX = p.x + p.vx * dt;
    const newY = p.y + p.vy * dt;
    const newZ = p.z + p.vz * dt;

    // X轴碰撞
    if (!p.flying) {
        const minX = newX - halfW;
        const maxX = newX + halfW;
        for (let y = Math.floor(p.y); y < Math.floor(p.y + PLAYER_HEIGHT); y++) {
            for (let z = Math.floor(p.z - halfW); z < Math.floor(p.z + halfW + 1); z++) {
                const bx = p.vx > 0 ? Math.floor(maxX) : Math.floor(minX);
                if (bx < 0 || bx >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH)
                    continue;
                const block = getBlock(bx, y, z);
                if (isSolid(block)) {
                    if (p.vx > 0) p.x = bx - halfW - 0.001;
                    else if (p.vx < 0) p.x = bx + 1 + halfW + 0.001;
                    p.vx = 0;
                    break;
                }
            }
            if (p.vx === 0) break;
        }
        if (p.vx !== 0) p.x = newX;
    } else {
        p.x = newX;
    }

    // Y轴碰撞
    if (!p.flying) {
        const minY = newY;
        const maxY = newY + PLAYER_HEIGHT;
        let hitGround = false;
        let bounced = false; // 粘液块弹跳（电梯 T1）：本帧已反弹，跳过落地归零与 newY 覆盖
        for (let x = Math.floor(p.x - halfW); x < Math.floor(p.x + halfW + 1); x++) {
            for (let z = Math.floor(p.z - halfW); z < Math.floor(p.z + halfW + 1); z++) {
                const by = p.vy > 0 ? Math.floor(maxY) : Math.floor(minY);
                if (x < 0 || x >= WORLD_WIDTH || by < 0 || by >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH)
                    continue;
                const block = getBlock(x, by, z);
                if (isSolid(block)) {
                    if (p.vy > 0) {
                        p.y = by - PLAYER_HEIGHT - 0.001;
                    } else if (block === BlockTypes.SLIME && p.vy < -SLIME_BOUNCE_MIN) {
                        // 落在粘液块上：反弹保留大部分垂直速度（电梯 T1，对齐原版）。
                        // 不置 hitGround → onGround 保持 false → 摸底这一次摔落结算不触发；
                        // 同时清 fallStartY（对齐原版 fallDistance 重置，蓝图代码片段的补全）：
                        // 否则衰减静止后的最终落地会按整段初始落差结算扣血，粘液免摔伤失效，
                        // 且后续弹跳后落在普通方块应按「弹后高度」重新起算
                        p.y = by + 1 + 0.001;
                        p.vy = -p.vy * SLIME_BOUNCE_KEEP;
                        p.fallStartY = null;
                        bounced = true;
                        break;
                    } else {
                        p.y = by + 1 + 0.001;
                        hitGround = true;
                    }
                    p.vy = 0;
                    break;
                }
            }
            if (bounced || p.vy === 0) break;
        }
        if (!bounced && p.vy !== 0) p.y = newY;
        p.onGround = p.vy === 0 && hitGround || p.vy === 0 && !p.flying && Math.abs(p.vy) < 0.01;
        if (p.vy === 0 && !hitGround) p.onGround = false;
    } else {
        p.y = newY;
    }

    // Z轴碰撞
    if (!p.flying) {
        const minZ = newZ - halfW;
        const maxZ = newZ + halfW;
        for (let y = Math.floor(p.y); y < Math.floor(p.y + PLAYER_HEIGHT); y++) {
            for (let x = Math.floor(p.x - halfW); x < Math.floor(p.x + halfW + 1); x++) {
                const bz = p.vz > 0 ? Math.floor(maxZ) : Math.floor(minZ);
                if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || bz < 0 || bz >= WORLD_DEPTH)
                    continue;
                const block = getBlock(x, y, bz);
                if (isSolid(block)) {
                    if (p.vz > 0) p.z = bz - halfW - 0.001;
                    else if (p.vz < 0) p.z = bz + 1 + halfW + 0.001;
                    p.vz = 0;
                    break;
                }
            }
            if (p.vz === 0) break;
        }
        if (p.vz !== 0) p.z = newZ;
    } else {
        p.z = newZ;
    }

    // 边界约束
    p.x = Math.max(halfW, Math.min(WORLD_WIDTH - halfW, p.x));
    p.y = Math.max(0, Math.min(WORLD_HEIGHT - 0.1, p.y));
    p.z = Math.max(halfW, Math.min(WORLD_DEPTH - halfW, p.z));

    // 摔落伤害（对齐参考版：落差 > 3.5 格开始扣血，damage = floor(落差 - 3)；水中/飞行豁免）：
    // 空中持续抬高 fallStartY 记录最高点，落地瞬间结算
    if (p.flying || p.inWater) {
        p.fallStartY = null;
    } else if (p.onGround) {
        if (!wasOnGround && p.fallStartY !== null) {
            const drop = p.fallStartY - p.y;
            if (drop > FALL_DAMAGE_MIN) damagePlayer(Math.floor(drop - 3));
        }
        p.fallStartY = p.y;
    } else {
        p.fallStartY = Math.max(p.fallStartY ?? p.y, p.y);
    }

    // 更新相机（含第一/第三人称）
    updateCamera();
}

// ==================== 视角系统 ====================
export function cycleViewMode() {
    state.viewMode = (state.viewMode + 1) % 2; // 第三人称只保留背后视角
    const names = ['🎥 第一人称', '🎥 第三人称（背后）'];
    showTooltip(names[state.viewMode]);
}

export function updateCamera() {
    if (state.camMode !== 'player') return; // 自由摄像头/建造跟拍：相机由 cameraRig.js 接管
    const p = state.player;
    const eyeX = p.x, eyeY = p.y + PLAYER_EYE_HEIGHT, eyeZ = p.z;
    camera.rotation.order = 'YXZ';
    camera.rotation.z = 0; // 清除 lookAt 残留的 180° 滚转，否则世界上下颠倒

    if (state.viewMode === 0) {
        // 第一人称：相机即眼睛
        camera.position.set(eyeX, eyeY, eyeZ);
        camera.rotation.y = p.yaw;
        camera.rotation.x = p.pitch;
        return;
    }

    // 第三人称（背后，照原版）：相机在眼睛正后方同高度后退（无抬升、无焦点），
    // 朝向即玩家视线本身——准星指着的就是人物正前方的方块，所见即所得
    const cp = Math.cos(p.pitch);
    const fx = -Math.sin(p.yaw) * cp, fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * cp;

    // 防穿墙：沿后退方向步进，撞到实心方块就缩回
    let dist = THIRD_PERSON_DIST;
    for (let d = 0.3; d <= THIRD_PERSON_DIST; d += 0.2) {
        const bx = Math.floor(eyeX - fx * d);
        const by = Math.floor(eyeY - fy * d);
        const bz = Math.floor(eyeZ - fz * d);
        if (isSolid(getBlock(bx, by, bz))) { dist = Math.max(0.3, d - 0.3); break; }
    }
    camera.position.set(eyeX - fx * dist, eyeY - fy * dist, eyeZ - fz * dist);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch;
}

// 玩家模型同步（第三人称 / 自由摄像头·跟拍视角下可见——相机离开身体后世界里能看到主角），
// 含行走摆臂动画
export function updatePlayerMesh(dt) {
    if (!playerMesh) return;
    const p = state.player;
    playerMesh.visible = state.viewMode !== 0 || state.camMode !== 'player';
    if (!playerMesh.visible) return;
    playerMesh.position.set(p.x, p.y, p.z);
    playerMesh.rotation.y = p.yaw; // 模型脸朝 -Z，与视线方向一致
    const speed = Math.hypot(p.vx, p.vz);
    p.walkAnim = (p.walkAnim || 0) + speed * dt * 2.2;
    const amp = Math.min(1, speed / WALK_SPEED) * 0.7;
    const swing = Math.sin(p.walkAnim) * amp;
    const limbs = playerMesh.userData.limbs;
    limbs.legL.rotation.x = swing;
    limbs.legR.rotation.x = -swing;
    limbs.armL.rotation.x = -swing;
    limbs.armR.rotation.x = swing;
}
