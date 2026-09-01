// ==================== playerPhysics.js ====================

import * as THREE from 'three';
import { FLY_SPEED, GRAVITY, JUMP_VELOCITY, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_WIDTH, THIRD_PERSON_DIST, THIRD_PERSON_FOCUS, THIRD_PERSON_LIFT, WALK_SPEED, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { state } from './state.js';
import { camera } from './engine.js';
import { getBlock } from './world.js';
import { isSolid } from './chunk.js';
import { playerMesh } from './entities.js';
import { keys } from './input.js';
import { showTooltip } from './ui.js';

// ==================== 玩家物理 ====================
export function updatePlayerPhysics(dt) {
    const p = state.player;
    const speed = p.flying ? FLY_SPEED : WALK_SPEED;

    // 移动输入
    const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const moveDir = new THREE.Vector3(0, 0, 0);

    if (keys['KeyW']) moveDir.add(forward);
    if (keys['KeyS']) moveDir.sub(forward);
    if (keys['KeyA']) moveDir.sub(right);
    if (keys['KeyD']) moveDir.add(right);
    if (moveDir.length() > 0) moveDir.normalize();

    const targetVx = moveDir.x * speed;
    const targetVz = moveDir.z * speed;

    // 平滑加速
    const accel = p.flying ? 8 : 12;
    p.vx += (targetVx - p.vx) * Math.min(1, accel * dt);
    p.vz += (targetVz - p.vz) * Math.min(1, accel * dt);

    if (p.flying) {
        p.vy = 0;
        if (keys['Space']) p.vy = FLY_SPEED;
        if (keys['ShiftLeft'] || keys['ShiftRight']) p.vy = -FLY_SPEED;
        p.onGround = false;
    } else {
        p.vy += GRAVITY * dt;
        p.vy = Math.max(p.vy, -40);
        if (keys['Space'] && p.onGround) {
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
        for (let x = Math.floor(p.x - halfW); x < Math.floor(p.x + halfW + 1); x++) {
            for (let z = Math.floor(p.z - halfW); z < Math.floor(p.z + halfW + 1); z++) {
                const by = p.vy > 0 ? Math.floor(maxY) : Math.floor(minY);
                if (x < 0 || x >= WORLD_WIDTH || by < 0 || by >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH)
                    continue;
                const block = getBlock(x, by, z);
                if (isSolid(block)) {
                    if (p.vy > 0) {
                        p.y = by - PLAYER_HEIGHT - 0.001;
                    } else if (p.vy <= 0) {
                        p.y = by + 1 + 0.001;
                        hitGround = true;
                    }
                    p.vy = 0;
                    break;
                }
            }
            if (p.vy === 0) break;
        }
        if (p.vy !== 0) p.y = newY;
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

    // 第三人称（背后）：相机在眼睛后方并抬升越过头顶，注视眼睛前方焦点，
    // 使屏幕准星落在手触及的位置而不是人物头上
    const cp = Math.cos(p.pitch);
    const fx = -Math.sin(p.yaw) * cp, fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * cp;

    // 防穿墙：沿偏移方向步进（计入抬升高度），撞到实心方块就缩回
    let dist = THIRD_PERSON_DIST;
    for (let d = 0.3; d <= THIRD_PERSON_DIST; d += 0.2) {
        const bx = Math.floor(eyeX - fx * d);
        const by = Math.floor(eyeY - fy * d + THIRD_PERSON_LIFT);
        const bz = Math.floor(eyeZ - fz * d);
        if (isSolid(getBlock(bx, by, bz))) { dist = Math.max(0.3, d - 0.3); break; }
    }
    camera.position.set(eyeX - fx * dist, eyeY - fy * dist + THIRD_PERSON_LIFT, eyeZ - fz * dist);
    camera.lookAt(eyeX + fx * THIRD_PERSON_FOCUS, eyeY + fy * THIRD_PERSON_FOCUS, eyeZ + fz * THIRD_PERSON_FOCUS);
    camera.rotation.z = 0; // 清除 lookAt 残留的滚转，否则画面倾斜
}

// 玩家模型同步（仅第三人称可见），含行走摆臂动画
export function updatePlayerMesh(dt) {
    if (!playerMesh) return;
    const p = state.player;
    playerMesh.visible = state.viewMode !== 0;
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
