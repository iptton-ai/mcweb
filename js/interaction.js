// ==================== interaction.js ====================

import * as THREE from 'three';
import { BlockInfo, BlockTypes, CHUNK_SIZE, HotbarBlocks, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_WIDTH, REACH_DISTANCE, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH, isDoorId, isGearId, isLeverId, isMachineryId } from './config.js';
import { isCreative, state } from './state.js';
import { camera } from './engine.js';
import { getBlock, getBlockIndex } from './world.js';
import { isCustomMesh, rebuildChunk, removeDroppedItemAt, removeTorchLightAt } from './chunk.js';
import { breakDoorAt, toggleDoorAt, tryPlaceDoor } from './door.js';
import { breakMachineryAt, placeMachinery, popUnsupportedMachinery, toggleGearAt, toggleLeverAt, updatePowerNetwork } from './machinery.js';
import { spawnBreakParticles } from './particles.js';
import { playBlockSound } from './audio.js';
import { damageEnemy } from './entities.js';
import { spawnTntEntity } from './tnt.js';
// 注意：ui.js 也 import 本模块的 raycastBlocks，循环依赖均为运行时函数调用，安全
import { showTooltip, updateHotbar } from './ui.js';

// 视线方向：forward = (-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch))
function lookDirection() {
    const p = state.player;
    const cp = Math.cos(p.pitch);
    return new THREE.Vector3(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
}

// 拾取射线：第一人称从眼睛出发；第三人称从相机出发（与屏幕准星严格一致，
// 相机已抬升越过头顶），触及距离仍从玩家（手）算起
function getPickRay() {
    const p = state.player;
    const eye = new THREE.Vector3(p.x, p.y + PLAYER_EYE_HEIGHT, p.z);
    if (state.viewMode === 0) {
        return { origin: eye, dir: lookDirection(), eye };
    }
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    return { origin: camera.position.clone(), dir, eye };
}

// ==================== 方块交互 ====================
export function raycastBlocks() {
    const { origin: o, dir, eye } = getPickRay();
    const origin = { x: o.x, y: o.y, z: o.z };
    const direction = { x: dir.x, y: dir.y, z: dir.z };

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = direction.x > 0 ? 1 : -1;
    const stepY = direction.y > 0 ? 1 : -1;
    const stepZ = direction.z > 0 ? 1 : -1;

    const tDeltaX = Math.abs(1 / (direction.x || 0.0001));
    const tDeltaY = Math.abs(1 / (direction.y || 0.0001));
    const tDeltaZ = Math.abs(1 / (direction.z || 0.0001));

    let tMaxX = direction.x !== 0 ? ((stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX) : Infinity;
    let tMaxY = direction.y !== 0 ? ((stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY) : Infinity;
    let tMaxZ = direction.z !== 0 ? ((stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ) : Infinity;

    // 第三人称下射线要先走过相机到玩家的这一段距离
    const maxDist = REACH_DISTANCE + Math.hypot(origin.x - eye.x, origin.y - eye.y, origin.z - eye.z);
    let lastX = x,
        lastY = y,
        lastZ = z;

    while (true) {
        const dist = Math.min(tMaxX, tMaxY, tMaxZ);
        if (dist > maxDist) return null;
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
            x += stepX;
            tMaxX += tDeltaX;
        } else if (tMaxY < tMaxZ) {
            y += stepY;
            tMaxY += tDeltaY;
        } else {
            z += stepZ;
            tMaxZ += tDeltaZ;
        }
        const block = getBlock(x, y, z);
        if (block !== BlockTypes.AIR && block !== BlockTypes.WATER) {
            // 命中点必须落在手的触及范围内（从眼睛算起），否则视为够不着
            const hx = origin.x + direction.x * dist;
            const hy = origin.y + direction.y * dist;
            const hz = origin.z + direction.z * dist;
            if (Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z) > REACH_DISTANCE + 0.01) return null;
            return { x, y, z, block, face: { dx: lastX - x, dy: lastY - y, dz: lastZ - z } };
        }
        lastX = x;
        lastY = y;
        lastZ = z;
    }
}

// 重建 (x,z) 所在区块及贴边相邻区块（破坏/放置两格高的门时复用）
function rebuildAround(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    rebuildChunk(cx, cz);
    if (x % CHUNK_SIZE === 0 && cx > 0) rebuildChunk(cx - 1, cz);
    if (x % CHUNK_SIZE === CHUNK_SIZE - 1 && cx < Math.ceil(WORLD_WIDTH / CHUNK_SIZE) - 1) rebuildChunk(
        cx + 1, cz);
    if (z % CHUNK_SIZE === 0 && cz > 0) rebuildChunk(cx, cz - 1);
    if (z % CHUNK_SIZE === CHUNK_SIZE - 1 && cz < Math.ceil(WORLD_DEPTH / CHUNK_SIZE) - 1) rebuildChunk(
        cx, cz + 1);
}

export function breakBlock() {
    // 生存模式：左键优先攻击准星附近的怪物（沿准星射线判定，距离从玩家眼睛算起）
    if (state.player.attackCooldown <= 0 && state.enemies.length > 0) {
        const { dir, eye } = getPickRay();
        let best = null;
        let bestScore = 0.65;
        for (const e of state.enemies) {
            const to = new THREE.Vector3(e.x - eye.x, e.y + 0.6 - eye.y, e.z - eye.z);
            const dist = to.length();
            if (dist > 4) continue;
            to.normalize();
            const score = to.dot(dir);
            if (score > bestScore) { bestScore = score; best = e; }
        }
        if (best) {
            damageEnemy(best, isCreative() ? 10 : 3);
            state.player.attackCooldown = 0.4;
            return;
        }
    }
    const hit = raycastBlocks();
    if (hit && hit.block !== BlockTypes.BEDROCK) {
        // 机械组（齿轮/拉杆/红石灯）：破坏返还物品，失去支撑的相邻机械连锁脱落
        if (isMachineryId(hit.block)) {
            const cells = breakMachineryAt(hit.x, hit.y, hit.z);
            updatePowerNetwork();
            for (const c of cells) {
                spawnBreakParticles(c.x, c.y, c.z, c.id);
                rebuildAround(c.x, c.z);
            }
            playBlockSound(false);
            if (!isCreative()) updateHotbar();
            return;
        }
        // 门：打掉任意半扇，整扇消失，生存模式返还一个门物品
        if (isDoorId(hit.block)) {
            const cells = breakDoorAt(hit.x, hit.y, hit.z);
            for (const c of cells) {
                spawnBreakParticles(c.x, c.y, c.z, c.id);
                rebuildAround(c.x, c.z);
            }
            playBlockSound(false);
            if (!isCreative()) updateHotbar();
            return;
        }
        const idx = getBlockIndex(hit.x, hit.y, hit.z);
        state.blocks[idx] = BlockTypes.AIR;
        // 生存模式：采集进背包
        if (!isCreative()) {
            state.player.inventory[hit.block] = (state.player.inventory[hit.block] || 0) + 1;
            updateHotbar();
        }
        // 支撑被拆：贴在这个面上的齿轮/拉杆随之脱落
        for (const c of popUnsupportedMachinery(hit.x, hit.y, hit.z)) {
            spawnBreakParticles(c.x, c.y, c.z, c.id);
            rebuildAround(c.x, c.z);
        }
        spawnBreakParticles(hit.x, hit.y, hit.z, hit.block);
        playBlockSound(false);
        if (hit.block === BlockTypes.TORCH) removeTorchLightAt(hit.x, hit.y, hit.z);
        if (isCustomMesh(hit.block)) removeDroppedItemAt(hit.x, hit.y, hit.z);
        const cx = Math.floor(hit.x / CHUNK_SIZE);
        const cz = Math.floor(hit.z / CHUNK_SIZE);
        rebuildChunk(cx, cz);
        if (hit.x % CHUNK_SIZE === 0 && cx > 0) rebuildChunk(cx - 1, cz);
        if (hit.x % CHUNK_SIZE === CHUNK_SIZE - 1 && cx < Math.ceil(WORLD_WIDTH / CHUNK_SIZE) - 1) rebuildChunk(
            cx + 1, cz);
        if (hit.z % CHUNK_SIZE === 0 && cz > 0) rebuildChunk(cx, cz - 1);
        if (hit.z % CHUNK_SIZE === CHUNK_SIZE - 1 && cz < Math.ceil(WORLD_DEPTH / CHUNK_SIZE) - 1) rebuildChunk(
            cx, cz + 1);
    }
}

export function placeBlock() {
    const hit = raycastBlocks();
    // 右键门 = 开/关整扇门（原版交互），不放置方块
    if (hit && isDoorId(hit.block)) {
        toggleDoorAt(hit.x, hit.y, hit.z);
        return;
    }
    // 右键齿轮/拉杆 = 手动开关（红石灯没有手动开关，右键照常放置）
    if (hit && isGearId(hit.block)) {
        toggleGearAt(hit.x, hit.y, hit.z);
        return;
    }
    if (hit && isLeverId(hit.block)) {
        toggleLeverAt(hit.x, hit.y, hit.z);
        return;
    }
    if (hit && hit.face) {
        const bx = hit.x + hit.face.dx;
        const by = hit.y + hit.face.dy;
        const bz = hit.z + hit.face.dz;
        if (bx < 0 || bx >= WORLD_WIDTH || by < 0 || by >= WORLD_HEIGHT || bz < 0 || bz >= WORLD_DEPTH) return;
        // 检查是否与玩家重叠
        const px = state.player.x;
        const py = state.player.y;
        const pz = state.player.z;
        const halfW = PLAYER_WIDTH / 2;
        if (bx + 1 > px - halfW && bx < px + halfW &&
            by + 1 > py && by < py + PLAYER_HEIGHT &&
            bz + 1 > pz - halfW && bz < pz + halfW) return;
        const currentBlock = getBlock(bx, by, bz);
        if (currentBlock !== BlockTypes.AIR && currentBlock !== BlockTypes.WATER) return;
        const selectedType = HotbarBlocks[state.player.selectedSlot] || BlockTypes.GRASS;
        // 生存模式：数量不足不可放置
        if (!isCreative() && (state.player.inventory[selectedType] || 0) <= 0) {
            showTooltip(`❌ ${BlockInfo[selectedType].name}不足，先去采集吧`);
            return;
        }
        // 门：一格物品生成上下两格的有状态方块（facing 随玩家朝向）
        if (isDoorId(selectedType)) {
            if (!tryPlaceDoor(bx, by, bz, state.player.yaw)) return;
            if (!isCreative()) {
                state.player.inventory[selectedType]--;
                updateHotbar();
            }
            playBlockSound(true);
            rebuildAround(bx, bz);
            return;
        }
        // 机械组（齿轮/拉杆/红石灯）：按所点击的面贴靠放置（见 js/machinery.js）
        if (isMachineryId(selectedType)) {
            const err = placeMachinery(bx, by, bz, selectedType, hit.face);
            if (err) {
                showTooltip(err);
                return;
            }
            if (!isCreative()) {
                state.player.inventory[selectedType]--;
                updateHotbar();
            }
            playBlockSound(true);
            return;
        }
        state.blocks[getBlockIndex(bx, by, bz)] = selectedType;
        // 生存模式：消耗一个
        if (!isCreative()) {
            state.player.inventory[selectedType]--;
            updateHotbar();
        }
        if (selectedType === BlockTypes.TNT) {
            // TNT 是道具：放置后 2.5 秒引爆
            spawnTntEntity(bx, by, bz);
        } else {
            spawnBreakParticles(bx, by, bz, selectedType);
            playBlockSound(true);
        }
        const cx = Math.floor(bx / CHUNK_SIZE);
        const cz = Math.floor(bz / CHUNK_SIZE);
        rebuildChunk(cx, cz);
        if (bx % CHUNK_SIZE === 0 && cx > 0) rebuildChunk(cx - 1, cz);
        if (bx % CHUNK_SIZE === CHUNK_SIZE - 1 && cx < Math.ceil(WORLD_WIDTH / CHUNK_SIZE) - 1) rebuildChunk(cx +
            1, cz);
        if (bz % CHUNK_SIZE === 0 && cz > 0) rebuildChunk(cx, cz - 1);
        if (bz % CHUNK_SIZE === CHUNK_SIZE - 1 && cz < Math.ceil(WORLD_DEPTH / CHUNK_SIZE) - 1) rebuildChunk(cx,
            cz + 1);
    }
}
