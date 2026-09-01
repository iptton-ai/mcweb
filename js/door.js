// ==================== door.js ====================
// 有状态方块（门）的高层逻辑：在 config.js 的 ID 编码之上，负责
// 放置（一格物品 → 上下两格、朝向取自玩家）、右键开关（上下两格联动）、
// 破坏（打掉任意半扇整扇消失、生存模式返还一个门物品）。

import { BlockTypes, DOOR_ITEM_ID, DOOR_THICKNESS, PLAYER_HEIGHT, PLAYER_WIDTH, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH, doorFacing, doorHalf, doorId, doorOpen, isDoorId } from './config.js';
import { isCreative, state } from './state.js';
import { getBlock, getBlockIndex, setBlockSafe } from './world.js';
import { refreshPropAt } from './chunk.js';
import { spawnBreakParticles } from './particles.js';
import { playDoorSound } from './audio.js';

// 由玩家水平朝向算门的 facing：视线向量 = (-sin(yaw), 0, -cos(yaw))，量化到四向
// （facing 记录放置时玩家的水平朝向，见 Minecraft Wiki Door/BS）
export function facingFromYaw(yaw) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (Math.abs(fx) >= Math.abs(fz)) return fx > 0 ? 1 : 3; // 东 / 西
    return fz > 0 ? 2 : 0; // 南 / 北
}

// 门板在某状态下贴着的格边（0=北 1=东 2=南 3=西）。
// 关门：贴 facing 反侧（原版规则：朝东的门关着占格子西侧）；
// 开门：绕固定左铰链转 90°，贴到闭合边顺时针（俯视）相邻的格边。
export function doorEdge(id) {
    const closedEdge = (doorFacing(id) + 2) % 4;
    return doorOpen(id) ? (closedEdge + 1) % 4 : closedEdge;
}

// 门板薄片在格内的尺寸与偏移（相对道具原点 = 格底面中心）
export function doorSlabTransform(id) {
    const t = DOOR_THICKNESS;
    switch (doorEdge(id)) {
        case 0: return { w: 1, d: t, ox: 0, oz: -0.5 + t / 2 };  // 北边
        case 1: return { w: t, d: 1, ox: 0.5 - t / 2, oz: 0 };   // 东边
        case 2: return { w: 1, d: t, ox: 0, oz: 0.5 - t / 2 };   // 南边
        default: return { w: t, d: 1, ox: -0.5 + t / 2, oz: 0 }; // 西边
    }
}

// 放置一扇门：需上下两格都为空气/水，且都不与玩家碰撞体重叠。
// 成功后写入两格方块并刷新道具网格，返回是否成功。
export function tryPlaceDoor(bx, by, bz, yaw) {
    if (bx < 0 || bx >= WORLD_WIDTH || by < 0 || by >= WORLD_HEIGHT - 1 || bz < 0 || bz >= WORLD_DEPTH) return false;
    const passable = (b) => b === BlockTypes.AIR || b === BlockTypes.WATER;
    if (!passable(getBlock(bx, by, bz)) || !passable(getBlock(bx, by + 1, bz))) return false;
    // placeBlock 只查了目标格与玩家的重叠，门还要保证上格也不卡住玩家
    const p = state.player;
    const halfW = PLAYER_WIDTH / 2;
    const hitsPlayer = (cy) => bx + 1 > p.x - halfW && bx < p.x + halfW &&
        cy + 1 > p.y && cy < p.y + PLAYER_HEIGHT && bz + 1 > p.z - halfW && bz < p.z + halfW;
    if (hitsPlayer(by) || hitsPlayer(by + 1)) return false;

    const facing = facingFromYaw(yaw);
    setBlockSafe(bx, by, bz, doorId(0, 0, facing));
    setBlockSafe(bx, by + 1, bz, doorId(1, 0, facing));
    refreshPropAt(bx, by, bz);
    refreshPropAt(bx, by + 1, bz);
    return true;
}

// 右键任意半扇：整扇门开/关状态取反并联动成对的另一半，局部刷新道具网格
// （门格是 customMesh 不参与立方体面剔除，无需重建区块网格）
export function toggleDoorAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isDoorId(id)) return;
    const open = doorOpen(id) ? 0 : 1;
    const half = doorHalf(id);
    const oy = half === 0 ? y + 1 : y - 1;
    setBlockSafe(x, y, z, doorId(half, open, doorFacing(id)));
    // 只联动真正成对的另一半（同 facing）；孤立的半扇门也能单独开关
    const otherId = getBlock(x, oy, z);
    if (isDoorId(otherId) && doorHalf(otherId) !== half && doorFacing(otherId) === doorFacing(id)) {
        setBlockSafe(x, oy, z, doorId(doorHalf(otherId), open, doorFacing(otherId)));
        refreshPropAt(x, oy, z);
    }
    refreshPropAt(x, y, z);
    playDoorSound(open === 1);
}

// 破坏任意半扇：清掉整扇两格，生存模式返还一个门物品。
// 返回被清除的格子列表（含原方块 ID），供调用方做粒子与区块重建；
// 道具网格的清理走 rebuildChunk → disposeChunkProps 的常规路径。
export function breakDoorAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isDoorId(id)) return [];
    const half = doorHalf(id);
    const oy = half === 0 ? y + 1 : y - 1;
    const cells = [{ x, y, z, id }];
    state.blocks[getBlockIndex(x, y, z)] = BlockTypes.AIR;
    const otherId = getBlock(x, oy, z);
    if (isDoorId(otherId) && doorHalf(otherId) !== half) {
        state.blocks[getBlockIndex(x, oy, z)] = BlockTypes.AIR;
        cells.push({ x, y: oy, z, id: otherId });
    }
    if (!isCreative()) {
        state.player.inventory[DOOR_ITEM_ID] = (state.player.inventory[DOOR_ITEM_ID] || 0) + 1;
    }
    return cells;
}
