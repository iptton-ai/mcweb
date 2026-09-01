// ==================== interaction.js ====================

import * as THREE from 'three';
import { BlockInfo, BlockTypes, CHUNK_SIZE, FIST_ATTACK, HotbarBlocks, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_WIDTH, REACH_CREATIVE, REACH_SURVIVAL, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH, isButtonId, isDoorId, isKineticId, isLeverId, isObserverId, isPistonGroupId, isPistonHeadId, isPistonId, isRedstoneId, isToolId } from './config.js';
import { isCreative, state } from './state.js';
import { camera } from './engine.js';
import { getBlock, getBlockIndex } from './world.js';
import { isCustomMesh, rebuildChunk, removeDroppedItemAt, removeTorchLightAt } from './chunk.js';
import { breakDoorAt, toggleDoorAt, tryPlaceDoor } from './door.js';
import { breakPistonGroupAt, placePiston } from './piston.js';
import { breakKineticAt, placeKinetic, updateKineticNetwork } from './kinetic.js';
import { breakRedstoneAt, placeRedstone, popUnsupportedRedstone, pressButtonAt, toggleLeverAt, updateRedstoneNetwork } from './redstone.js';
import { spawnBreakParticles } from './particles.js';
import { playBlockSound } from './audio.js';
import { damageEnemy } from './entities.js';
import { spawnTntEntity } from './tnt.js';
import { getHeldTool } from './mining.js';
// 注意：ui.js 也 import 本模块的 raycastBlocks，循环依赖均为运行时函数调用，安全
// （mining.js ↔ 本模块同理：本模块只运行时调用 getHeldTool）
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

// 触及距离（照搬原版：创造 5.2 格 / 生存 4.5 格）
function reachDistance() {
    return isCreative() ? REACH_CREATIVE : REACH_SURVIVAL;
}

// ==================== 方块交互 ====================
export function raycastBlocks() {
    const { origin: o, dir, eye } = getPickRay();
    const origin = { x: o.x, y: o.y, z: o.z };
    const direction = { x: dir.x, y: dir.y, z: dir.z };
    const reach = reachDistance();

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
    const maxDist = reach + Math.hypot(origin.x - eye.x, origin.y - eye.y, origin.z - eye.z);
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
            if (Math.hypot(hx - eye.x, hy - eye.y, hz - eye.z) > reach + 0.01) return null;
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

// 左键攻击：准星附近的怪物（沿准星射线判定，距离从玩家眼睛算起）。
// 伤害与冷却照搬原版：创造一击必杀；生存看手持武器（铁剑 6/0.6s，工具按各自数值，徒手 1/0.25s）。
// 返回 true = 准星被怪物占据（本次按键是攻击不是挖掘，冷却未到也只挥空刀，不隔着怪挖方块）；
// 由 mining.js 在按下与按住时调用。
export function tryAttackEnemy() {
    if (state.enemies.length === 0) return false;
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
    if (!best) return false;
    if (state.player.attackCooldown <= 0) {
        const tool = getHeldTool();
        damageEnemy(best, isCreative() ? 1000 : (tool?.damage ?? FIST_ATTACK.damage));
        state.player.attackCooldown = tool?.attackCd ?? FIST_ATTACK.attackCd;
    }
    return true;
}

// 破坏一格方块（mining.js 蓄力完成/即挖时调用，hit 来自 raycastBlocks）。
// 生存掉落规则照搬原版：石头→圆石、草方块→泥土、玻璃/树叶→无掉落（见 config.js BlockInfo.drop）。
export function breakBlockAt(hit) {
    if (hit.block === BlockTypes.BEDROCK) return;
    // 红石组：破坏返还物品，失去支撑的相邻元件连锁脱落
    if (isRedstoneId(hit.block)) {
        const cells = breakRedstoneAt(hit.x, hit.y, hit.z);
        updateRedstoneNetwork();
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
    // 活塞组：打头 = 反查底座整只拆掉（原版行为），生存模式返还一个活塞/观察者物品
    if (isPistonId(hit.block) || isPistonHeadId(hit.block) || isObserverId(hit.block)) {
        const cells = breakPistonGroupAt(hit.x, hit.y, hit.z);
        updateRedstoneNetwork();
        for (const c of cells) {
            spawnBreakParticles(c.x, c.y, c.z, c.id);
            rebuildAround(c.x, c.z);
        }
        playBlockSound(false);
        if (!isCreative()) updateHotbar();
        return;
    }
    // 动力组（轴/齿轮/水车/粉碎轮/锯）：清格返还物品并重算动力网络（见 js/kinetic.js）
    if (isKineticId(hit.block)) {
        const cells = breakKineticAt(hit.x, hit.y, hit.z);
        for (const c of cells) {
            spawnBreakParticles(c.x, c.y, c.z, c.id);
            rebuildAround(c.x, c.z);
        }
        for (const c of popUnsupportedRedstone(hit.x, hit.y, hit.z)) {
            spawnBreakParticles(c.x, c.y, c.z, c.id);
            rebuildAround(c.x, c.z);
        }
        playBlockSound(false);
        if (!isCreative()) updateHotbar();
        return;
    }
    const idx = getBlockIndex(hit.x, hit.y, hit.z);
    state.blocks[idx] = BlockTypes.AIR;
    // 生存模式按掉落映射采集（null=无掉落，缺省=自身；石头→圆石、草方块→泥土等原版规则）。
    // needsTool 方块（石头/圆石/砖）徒手或用错工具挖开时「无掉落」——原版采集规则
    if (!isCreative()) {
        const info = BlockInfo[hit.block];
        const tool = getHeldTool();
        const harvestBlocked = info?.drop === null ||
            (info?.needsTool && (!tool || tool.class !== info.tool));
        if (!harvestBlocked) {
            const itemId = info?.drop ?? hit.block;
            state.player.inventory[itemId] = (state.player.inventory[itemId] || 0) + 1;
        }
        updateHotbar();
    }
    // 支撑被拆：贴在这个面上的红石元件随之脱落
    for (const c of popUnsupportedRedstone(hit.x, hit.y, hit.z)) {
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

export function placeBlock() {
    const hit = raycastBlocks();
    // 右键门 = 开/关整扇门（原版交互），不放置方块
    if (hit && isDoorId(hit.block)) {
        toggleDoorAt(hit.x, hit.y, hit.z);
        return;
    }
    // 右键 TNT = 手动点燃（放置的 TNT 是惰性的，可配合红石做陷阱）
    if (hit && hit.block === BlockTypes.TNT) {
        spawnTntEntity(hit.x, hit.y, hit.z);
        return;
    }
    // 右键按钮 = 按下（1 秒后自动弹出）；右键拉杆 = 开关。红石粉/红石火把/红石灯没有右键动作
    if (hit && isButtonId(hit.block)) {
        pressButtonAt(hit.x, hit.y, hit.z);
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
        // 工具是「物品」不是方块，不能放置（照原版：右键持工具不与世界交互）
        if (isToolId(selectedType)) {
            showTooltip(`🛠️ ${BlockInfo[selectedType].name}是用来挖掘/战斗的，选个方块再放置`);
            return;
        }
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
        // 红石组（红石粉/红石火把/按钮/压力板/拉杆/红石灯）：按所点击的面贴靠放置（见 js/redstone.js）
        if (isRedstoneId(selectedType)) {
            const err = placeRedstone(bx, by, bz, selectedType, hit.face);
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
        // 活塞组（活塞/粘性活塞/观察者）：朝向 = 所点击面的外法线（见 js/piston.js）
        if (isPistonGroupId(selectedType)) {
            const err = placePiston(bx, by, bz, selectedType, hit.face);
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
        // 动力组（轴/齿轮/水车/粉碎轮/锯）：轴向 = 所点击面的法线方向（见 js/kinetic.js）
        if (isKineticId(selectedType)) {
            const err = placeKinetic(bx, by, bz, selectedType, hit.face);
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
            // TNT 放置为惰性：右键点燃或红石信号引爆（配合压力板/拉杆可做陷阱）
            showTooltip('💣 TNT 已放置：右键点燃，或用红石信号引爆');
        }
        if (selectedType === BlockTypes.WATER) {
            // 放水可能给下方水车供电（顶面接触水判定），重算动力网络
            updateKineticNetwork();
        }
        spawnBreakParticles(bx, by, bz, selectedType);
        playBlockSound(true);
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
