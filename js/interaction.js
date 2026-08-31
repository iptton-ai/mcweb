// ==================== interaction.js ====================

import * as THREE from 'three';
import { BlockTypes, CHUNK_SIZE, HotbarBlocks, PLAYER_HEIGHT, PLAYER_WIDTH, REACH_DISTANCE, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { isCreative, state } from './state.js';
import { camera } from './engine.js';
import { getBlock, getBlockIndex } from './world.js';
import { isCustomMesh, rebuildChunk, removeDroppedItemAt, removeTorchLightAt } from './chunk.js';
import { spawnBreakParticles } from './particles.js';
import { playBlockSound } from './audio.js';
import { damageEnemy } from './entities.js';
import { spawnTntEntity } from './tnt.js';

// ==================== 方块交互 ====================
export function raycastBlocks() {
    const origin = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
    };
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(camera.quaternion);
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

    const maxDist = REACH_DISTANCE;
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
            return { x, y, z, block, face: { dx: lastX - x, dy: lastY - y, dz: lastZ - z } };
        }
        lastX = x;
        lastY = y;
        lastZ = z;
    }
}

export function breakBlock() {
    // 生存模式：左键优先攻击准星附近的怪物
    if (state.player.attackCooldown <= 0 && state.enemies.length > 0) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        let best = null;
        let bestScore = 0.65;
        for (const e of state.enemies) {
            const to = new THREE.Vector3(e.x - camera.position.x, e.y + 0.6 - camera.position.y, e.z -
                camera.position.z);
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
        const idx = getBlockIndex(hit.x, hit.y, hit.z);
        state.blocks[idx] = BlockTypes.AIR;
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
        state.blocks[getBlockIndex(bx, by, bz)] = selectedType;
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
