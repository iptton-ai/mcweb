// ==================== tnt.js ====================

import { BlockTypes, CHUNK_SIZE, WORLD_DEPTH, WORLD_WIDTH } from './config.js';
import { state } from './state.js';
import { getBlock, setBlockSafe } from './world.js';
import { isCustomMesh, rebuildChunk, removeDroppedItemAt, removeTorchLightAt } from './chunk.js';
import { spawnBreakParticles } from './particles.js';
import { playBlockSound, playExplosionSound } from './audio.js';
import { damageEnemy } from './entities.js';
import { damagePlayer } from './playerLife.js';
import { showTooltip } from './ui.js';
import { fixPistonAround } from './piston.js';
import { updateRedstoneNetwork } from './redstone.js';

// ==================== TNT 爆炸 ====================
export function spawnTntEntity(bx, by, bz) {
    state.tntEntities.push({ x: bx, y: by, z: bz, fuse: 2.5, flashTimer: 0 });
    showTooltip('💣 TNT 已点燃，快跑！');
    playBlockSound(true);
}

export function updateTnt(dt) {
    for (let i = state.tntEntities.length - 1; i >= 0; i--) {
        const t = state.tntEntities[i];
        t.fuse -= dt;
        t.flashTimer += dt;
        if (t.fuse <= 0) {
            state.tntEntities.splice(i, 1);
            if (getBlock(t.x, t.y, t.z) === BlockTypes.TNT) {
                setBlockSafe(t.x, t.y, t.z, BlockTypes.AIR);
            }
            explode(t.x, t.y, t.z);
        }
    }
}

export function explode(cx, cy, cz) {
    playExplosionSound();
    const R = 3;
    const chunksToRebuild = new Set();
    for (let dx = -R; dx <= R; dx++) {
        for (let dy = -R; dy <= R; dy++) {
            for (let dz = -R; dz <= R; dz++) {
                const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (d > R + 0.5) continue;
                const x = cx + dx, y = cy + dy, z = cz + dz;
                const bt = getBlock(x, y, z);
                if (bt === BlockTypes.AIR || bt === BlockTypes.BEDROCK) continue;
                if (bt === BlockTypes.TORCH) removeTorchLightAt(x, y, z);
                if (isCustomMesh(bt)) removeDroppedItemAt(x, y, z);
                setBlockSafe(x, y, z, BlockTypes.AIR);
                chunksToRebuild.add(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`);
                if (Math.random() < 0.3) {
                    spawnBreakParticles(x, y, z, bt);
                }
                // 爆炸炸掉活塞一半会留下孤儿（伸出底座没了头 / 头没了底座），就地修复
                for (const fc of fixPistonAround(x, y, z)) {
                    chunksToRebuild.add(`${Math.floor(fc.x / CHUNK_SIZE)},${Math.floor(fc.z / CHUNK_SIZE)}`);
                }
            }
        }
    }
    // 重建受影响区块（含相邻）
    const extra = new Set();
    for (const key of chunksToRebuild) {
        const [ccx, ccz] = key.split(',').map(Number);
        extra.add(`${ccx},${ccz}`);
        extra.add(`${ccx - 1},${ccz}`);
        extra.add(`${ccx + 1},${ccz}`);
        extra.add(`${ccx},${ccz - 1}`);
        extra.add(`${ccx},${ccz + 1}`);
    }
    for (const key of extra) {
        const [ccx, ccz] = key.split(',').map(Number);
        if (ccx >= 0 && ccz >= 0 && ccx < Math.ceil(WORLD_WIDTH / CHUNK_SIZE) && ccz < Math.ceil(WORLD_DEPTH / CHUNK_SIZE)) {
            rebuildChunk(ccx, ccz);
        }
    }
    // 爆炸后重算红石网络（方块增删改变供能拓扑；活塞边沿/观察者基线随之刷新）
    updateRedstoneNetwork();
    // 伤害玩家
    const p = state.player;
    const pd = Math.hypot(p.x - cx - 0.5, p.y - cy - 0.5, p.z - cz - 0.5);
    if (pd < 5 && !p.dead) {
        damagePlayer(Math.round((5 - pd) * 3));
        const kb = 8;
        p.vx += (p.x - cx - 0.5) / pd * kb;
        p.vz += (p.z - cz - 0.5) / pd * kb;
        p.vy += 5;
    }
    // 伤害怪物
    for (let i = state.enemies.length - 1; i >= 0; i--) {
        const e = state.enemies[i];
        const ed = Math.hypot(e.x - cx - 0.5, e.y - cy - 0.5, e.z - cz - 0.5);
        if (ed < 5) damageEnemy(e, Math.round((5 - ed) * 4));
    }
}
