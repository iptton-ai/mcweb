// ==================== piston.js ====================
// 有状态方块「活塞组」（活塞/粘性活塞/活塞头/观察者）的高层逻辑，分层与 door.js /
// redstone.js 一致：config.js 把状态编码进方块 ID，本模块负责放置（朝向 = 所点击
// 面的外法线）、破坏（打头 = 拆整只活塞）、推动/拉动算法与 0.15s 延迟动作队列、
// 观察者每帧侦测（正前方方块变化 → 脉冲信号源）。
//
// 信号与动作（对齐原版核心玩法，简化点见 config.js 活塞组注释）：
//   活塞是红石负载：信号上升沿入队「伸出」、下降沿入队「收回」，PISTON_DELAY 秒后
//   执行（原版 3 游戏刻；延迟执行也切断飞行机器的递归重算风暴）。
//   伸出：沿朝向收集要推的方块（≤12 格，原版上限）整体前移一格，头占据前格；
//         不可推方块（基岩/伸出态活塞/活塞头）挡路 = 整个动作失败；
//         红石元件/门/火把/花被推 = 压碎并返还物品；粘液块会把它粘着的方块一起拖走。
//   收回：头消失；粘性活塞把头正前方那格拉回一格（粘液块 = 连通集合整体拉回）。
//   观察者：不接电路也能用——每帧 diff 正前方方块 ID，变化 = 侦测，变脉冲信号源
//         （OBSERVER_PULSE_SEC 秒后自动熄灭），活塞时钟/飞行机器的心跳来源。
//
// 与红石的接线在 redstone.js：updateRedstoneNetwork 扫描活塞/观察者并做边沿检测，
// updateRedstoneTick 每帧调用本模块的 updatePistonTick 消费队列与侦测观察者。

import {
    BlockInfo,
    BlockTypes,
    CHUNK_SIZE,
    FACING_NORMALS,
    OBSERVER_ITEM_ID,
    OBSERVER_PULSE_SEC,
    PISTON_DELAY,
    PISTON_HEAD_BASE,
    PISTON_ITEM_ID,
    PISTON_PUSH_LIMIT,
    PLAYER_HEIGHT,
    STICKY_PISTON_ITEM_ID,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    isDoorId,
    isObserverId,
    isPistonHeadId,
    isPistonId,
    isRedstoneId,
    observerFacing,
    observerId,
    observerPowered,
    pistonExtended,
    pistonFacing,
    pistonHeadId,
    pistonId,
    pistonSticky,
} from './config.js';
import { isCreative, state } from './state.js';
import { getBlock, setBlockSafe } from './world.js';
import { isCustomMesh, refreshPropAt, removeDroppedItemAt, removeTorchLightAt, rebuildChunk } from './chunk.js';
import { breakRedstoneAt, facingFromNormal, popUnsupportedRedstone, updateRedstoneNetwork } from './redstone.js';
import { updateKineticNetwork } from './kinetic.js';
import { breakDoorAt } from './door.js';
import { spawnBreakParticles } from './particles.js';
import { playPistonSound } from './audio.js';

const CHUNKS_X = Math.ceil(WORLD_WIDTH / CHUNK_SIZE);
const CHUNKS_Z = Math.ceil(WORLD_DEPTH / CHUNK_SIZE);

const inBounds = (x, y, z) =>
    x >= 0 && x < WORLD_WIDTH && y >= 0 && y < WORLD_HEIGHT && z >= 0 && z < WORLD_DEPTH;

// ==================== 放置 ====================
// 朝向 = 所点击面的外法线（点击方块顶面 → 活塞朝上；贴墙 → 垂直于墙面），照原版。
// 返回 null = 成功，否则为错误提示。
export function placePiston(bx, by, bz, itemId, face) {
    if (bx < 0 || bx >= WORLD_WIDTH || by < 0 || by >= WORLD_HEIGHT || bz < 0 || bz >= WORLD_DEPTH) {
        return '❌ 超出世界边界';
    }
    const facing = facingFromNormal(face.dx, face.dy, face.dz);
    const id = itemId === STICKY_PISTON_ITEM_ID
        ? pistonId(true, facing, 0)
        : itemId === OBSERVER_ITEM_ID
            ? observerId(facing, 0)
            : pistonId(false, facing, 0);
    setBlockSafe(bx, by, bz, id);
    refreshPropAt(bx, by, bz);
    // 新活塞可能已处在供能位（上升沿入队伸出）；观察者注册进每帧侦测表
    updateRedstoneNetwork();
    return null;
}

// ==================== 破坏 ====================
// 破坏活塞组任意部件：打头 = 反查底座整只拆掉（原版行为），生存模式返还一个物品。
// 返回被清除的格子列表（粒子/区块重建用，调用方负责 updateRedstoneNetwork）。
export function breakPistonGroupAt(x, y, z) {
    const id = getBlock(x, y, z);
    const cells = [];
    let itemId = null;
    if (isPistonHeadId(id)) {
        const f = id - PISTON_HEAD_BASE;
        const [nx, ny, nz] = FACING_NORMALS[f];
        const bx = x - nx, by = y - ny, bz = z - nz; // 头的身后必是底座
        const baseId = getBlock(bx, by, bz);
        cells.push({ x, y, z, id });
        setBlockSafe(x, y, z, BlockTypes.AIR);
        if (isPistonId(baseId) && pistonFacing(baseId) === f) {
            cells.push({ x: bx, y: by, z: bz, id: baseId });
            setBlockSafe(bx, by, bz, BlockTypes.AIR);
            itemId = pistonSticky(baseId) ? STICKY_PISTON_ITEM_ID : PISTON_ITEM_ID;
        }
    } else if (isPistonId(id)) {
        cells.push({ x, y, z, id });
        setBlockSafe(x, y, z, BlockTypes.AIR);
        if (pistonExtended(id) === 1) {
            const [nx, ny, nz] = FACING_NORMALS[pistonFacing(id)];
            const hx = x + nx, hy = y + ny, hz = z + nz;
            if (isPistonHeadId(getBlock(hx, hy, hz))) {
                cells.push({ x: hx, y: hy, z: hz, id: getBlock(hx, hy, hz) });
                setBlockSafe(hx, hy, hz, BlockTypes.AIR);
            }
        }
        itemId = pistonSticky(id) ? STICKY_PISTON_ITEM_ID : PISTON_ITEM_ID;
    } else if (isObserverId(id)) {
        cells.push({ x, y, z, id });
        setBlockSafe(x, y, z, BlockTypes.AIR);
        itemId = OBSERVER_ITEM_ID;
    }
    if (itemId !== null && !isCreative()) {
        state.player.inventory[itemId] = (state.player.inventory[itemId] || 0) + 1;
    }
    dropQueueAt(x, y, z);
    return cells;
}

// ==================== 推拉下的方块分类 ====================
// PUSH_EMPTY 空格/水（可通行）｜PUSH_POP 贴面道具（被推 = 压碎返还）｜
// PUSH_MOVE 可移动实体块 ｜PUSH_FIXED 不可推（基岩、伸出态活塞、活塞头）
const PUSH_EMPTY = 0, PUSH_POP = 1, PUSH_MOVE = 2, PUSH_FIXED = 3;

function pushKind(bt) {
    if (bt === BlockTypes.AIR || bt === BlockTypes.WATER) return PUSH_EMPTY;
    if (bt === BlockTypes.BEDROCK) return PUSH_FIXED;
    if (isPistonHeadId(bt)) return PUSH_FIXED;
    if (isPistonId(bt)) return pistonExtended(bt) === 1 ? PUSH_FIXED : PUSH_MOVE;
    if (isDoorId(bt) || isRedstoneId(bt) || bt === BlockTypes.TORCH || bt === BlockTypes.FLOWER) return PUSH_POP;
    return PUSH_MOVE; // 其余实心立方体（石头/木板/TNT/红石灯/粘液块…）
}

// 压碎一格贴面道具（红石元件/门走各自的破坏函数，火把/花走普通掉落），返回格子列表
function popBlockAt(x, y, z) {
    const bt = getBlock(x, y, z);
    if (bt === BlockTypes.AIR) return [];
    if (isRedstoneId(bt)) return breakRedstoneAt(x, y, z); // 掉落与失去支撑连锁脱落自理
    if (isDoorId(bt)) return breakDoorAt(x, y, z);
    setBlockSafe(x, y, z, BlockTypes.AIR);
    if (bt === BlockTypes.TORCH) removeTorchLightAt(x, y, z);
    if (isCustomMesh(bt)) removeDroppedItemAt(x, y, z);
    if (!isCreative() && BlockInfo[bt]?.drop !== null) {
        const itemId = BlockInfo[bt]?.drop ?? bt;
        state.player.inventory[itemId] = (state.player.inventory[itemId] || 0) + 1;
    }
    return [{ x, y, z, id: bt }];
}

// ==================== 区块重建收集 ====================
// 收集受影响区块（含贴边相邻），动作末尾一次性重建
function markChunkAround(set, x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const add = (a, b) => {
        if (a >= 0 && a < CHUNKS_X && b >= 0 && b < CHUNKS_Z) set.add(a * 1000 + b);
    };
    add(cx, cz);
    if (x % CHUNK_SIZE === 0) add(cx - 1, cz);
    if (x % CHUNK_SIZE === CHUNK_SIZE - 1) add(cx + 1, cz);
    if (z % CHUNK_SIZE === 0) add(cx, cz - 1);
    if (z % CHUNK_SIZE === CHUNK_SIZE - 1) add(cx, cz + 1);
}

function flushChunks(set) {
    for (const key of set) {
        rebuildChunk(Math.floor(key / 1000), key % 1000);
    }
}

// ==================== 被推的实体 ====================
// 推动方向上会被新方块占据的格子里站着玩家/怪 → 沿推力方向整体挪一格（简化：无挤压伤害）
function shoveEntities(destCells, n) {
    if (destCells.length === 0) return;
    const occ = new Set(destCells.map((c) => `${c.x},${c.y},${c.z}`));
    const shove = (e, height) => {
        const feet = `${Math.floor(e.x)},${Math.floor(e.y + 0.1)},${Math.floor(e.z)}`;
        const head = `${Math.floor(e.x)},${Math.floor(e.y + height - 0.1)},${Math.floor(e.z)}`;
        if (occ.has(feet) || occ.has(head)) {
            e.x += n[0];
            e.y += n[1];
            e.z += n[2];
        }
    };
    if (!state.player.dead) shove(state.player, PLAYER_HEIGHT);
    for (const en of state.enemies) shove(en, 1.8);
}

// ==================== 伸出（推动）====================
// 沿朝向收集要移动的方块集合：队列从活塞前格出发，普通块只沿推力方向连锁，
// 粘液块额外把六邻的可推块拖进来（飞行机器的基础）。返回 null = 推不动。
function planExtend(px, py, pz, f) {
    const [nx, ny, nz] = FACING_NORMALS[f];
    const front = { x: px + nx, y: py + ny, z: pz + nz };
    if (!inBounds(front.x, front.y, front.z)) return null; // 活塞头没地方放
    const moved = [];
    const popped = [];
    const seen = new Set();
    const queue = [front];
    while (queue.length > 0) {
        const c = queue.shift();
        const ck = `${c.x},${c.y},${c.z}`;
        if (seen.has(ck)) continue;
        seen.add(ck);
        const bt = getBlock(c.x, c.y, c.z);
        const kind = pushKind(bt);
        if (kind === PUSH_EMPTY) continue;
        if (kind === PUSH_POP) {
            popped.push(c);
            continue;
        }
        if (kind === PUSH_FIXED) return null;
        moved.push(c);
        if (moved.length > PISTON_PUSH_LIMIT) return null;
        // 目的格合法性：撞上不可推块 = 失败；贴面道具 = 压碎；实体块 = 连带一起推
        const dx = c.x + nx, dy = c.y + ny, dz = c.z + nz;
        if (inBounds(dx, dy, dz)) {
            const dk = pushKind(getBlock(dx, dy, dz));
            if (dk === PUSH_FIXED) return null;
            if (dk === PUSH_POP) popped.push({ x: dx, y: dy, z: dz });
            else if (dk === PUSH_MOVE) queue.push({ x: dx, y: dy, dz });
        } else {
            return null; // 目的格出界：这块会被推出世界 → 整个伸出动作失败（对齐原版，同上方活塞头格越界的语义）
        }
        if (bt === BlockTypes.SLIME) {
            // 粘液块拖动它粘着的方块（不含活塞自己），粘着不可推块 = 整体推不动
            for (const [mx, my, mz] of FACING_NORMALS) {
                const ax = c.x + mx, ay = c.y + my, az = c.z + mz;
                if (ax === px && ay === py && az === pz) continue;
                if (!inBounds(ax, ay, az)) continue;
                const ak = pushKind(getBlock(ax, ay, az));
                if (ak === PUSH_FIXED) return null;
                if (ak === PUSH_MOVE) queue.push({ x: ax, y: ay, z: az });
            }
        }
    }
    return { moved, popped };
}

function doExtend(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isPistonId(id) || pistonExtended(id) === 1) return false;
    const f = pistonFacing(id);
    const plan = planExtend(x, y, z, f);
    if (!plan) return false; // 推不动：保持收回态，等下一次信号边沿再试
    const [nx, ny, nz] = FACING_NORMALS[f];
    const chunks = new Set();
    const front = { x: x + nx, y: y + ny, z: z + nz };

    // 先压碎路径上的贴面道具（腾出目的格 + 返还物品）
    const poppedDone = new Set();
    for (const c of plan.popped) {
        const ck = `${c.x},${c.y},${c.z}`;
        if (poppedDone.has(ck)) continue;
        poppedDone.add(ck);
        for (const cc of popBlockAt(c.x, c.y, c.z)) {
            spawnBreakParticles(cc.x, cc.y, cc.z, cc.id);
            markChunkAround(chunks, cc.x, cc.z);
        }
    }

    // 被推的玩家/怪物整体位移一格（新方块即将占据的格子）
    shoveEntities(
        [...plan.moved.map((c) => ({ x: c.x + nx, y: c.y + ny, z: c.z + nz })), front],
        [nx, ny, nz],
    );

    // 方块位移：从最远端开始挪避免覆盖（目的格必在界内——planExtend 出界即失败已保证）
    const proj = (c) => (c.x - x) * nx + (c.y - y) * ny + (c.z - z) * nz;
    plan.moved.sort((a, b) => proj(b) - proj(a));
    for (const c of plan.moved) {
        const bt = getBlock(c.x, c.y, c.z);
        setBlockSafe(c.x, c.y, c.z, BlockTypes.AIR);
        const dx = c.x + nx, dy = c.y + ny, dz = c.z + nz;
        if (inBounds(dx, dy, dz)) {
            setBlockSafe(dx, dy, dz, bt);
            markChunkAround(chunks, dx, dz);
        }
        markChunkAround(chunks, c.x, c.z);
        // 原格支撑没了：贴在上面的红石元件连锁脱落
        for (const cc of popUnsupportedRedstone(c.x, c.y, c.z)) {
            spawnBreakParticles(cc.x, cc.y, cc.z, cc.id);
            markChunkAround(chunks, cc.x, cc.z);
        }
    }

    // 底座换伸出变体 + 活塞头占据前格
    setBlockSafe(x, y, z, pistonId(pistonSticky(id), f, 1));
    setBlockSafe(front.x, front.y, front.z, pistonHeadId(f));
    markChunkAround(chunks, x, z);
    markChunkAround(chunks, front.x, front.z);

    flushChunks(chunks);
    playPistonSound(true);
    updateRedstoneNetwork();
    updateKineticNetwork(); // 被推的可能是轴/齿轮/水车：位置变了，动力拓扑重算
    return true;
}

// ==================== 收回（粘性活塞拉动）====================
// 头正前方那格：普通可推块 = 单块拉回；粘液块 = 连通集合（互相连接的粘液 + 粘在
// 粘液上的可推块）整体拉回一格，集合粘着不可推块或超上限 = 全都不动（原版语义）。
function planRetract(px, py, pz, f) {
    const [nx, ny, nz] = FACING_NORMALS[f];
    const first = { x: px + 2 * nx, y: py + 2 * ny, z: pz + 2 * nz };
    if (!inBounds(first.x, first.y, first.z)) return null;
    const fb = getBlock(first.x, first.y, first.z);
    if (pushKind(fb) !== PUSH_MOVE) return null; // 空格/道具/不可推块都不拉
    const moved = [first];
    const popped = [];
    if (fb !== BlockTypes.SLIME) return { moved, popped }; // 普通块：只拉头前这一格

    const queue = [first];
    const seen = new Set([`${first.x},${first.y},${first.z}`]);
    while (queue.length > 0) {
        const c = queue.shift();
        for (const [mx, my, mz] of FACING_NORMALS) {
            const ax = c.x + mx, ay = c.y + my, az = c.z + mz;
            if (ax === px && ay === py && az === pz) continue; // 底座不跟着走
            if (!inBounds(ax, ay, az)) continue;
            const ak = `${ax},${ay},${az}`;
            if (seen.has(ak)) continue;
            seen.add(ak);
            const ab = getBlock(ax, ay, az);
            const kind = pushKind(ab);
            if (kind === PUSH_FIXED) return null; // 粘着不可推块：整体拉不动
            if (ab === BlockTypes.SLIME) {
                queue.push({ x: ax, y: ay, z: az });
                moved.push({ x: ax, y: ay, z: az });
            } else if (kind === PUSH_MOVE) {
                moved.push({ x: ax, y: ay, z: az }); // 粘在粘液上的普通方块跟着走
            }
        }
    }
    if (moved.length > PISTON_PUSH_LIMIT) return null;

    // 目的格（-n 方向）合法性：空/集合内格/贴面道具（压碎），其余 = 拉不动
    const movedKeys = new Set(moved.map((c) => `${c.x},${c.y},${c.z}`));
    for (const c of moved) {
        const dx = c.x - nx, dy = c.y - ny, dz = c.z - nz;
        if (!inBounds(dx, dy, dz)) return null;
        if (movedKeys.has(`${dx},${dy},${dz}`)) continue;
        const dk = pushKind(getBlock(dx, dy, dz));
        if (dk === PUSH_EMPTY) continue;
        if (dk === PUSH_POP) popped.push({ x: dx, y: dy, z: dz });
        else return null;
    }
    return { moved, popped };
}

function doRetract(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isPistonId(id) || pistonExtended(id) !== 1) return false;
    const f = pistonFacing(id);
    const sticky = pistonSticky(id);
    const [nx, ny, nz] = FACING_NORMALS[f];
    const chunks = new Set();
    const hx = x + nx, hy = y + ny, hz = z + nz;

    // 先摘活塞头（腾出即将被拉入的格）
    if (isPistonHeadId(getBlock(hx, hy, hz))) setBlockSafe(hx, hy, hz, BlockTypes.AIR);
    markChunkAround(chunks, hx, hz);

    if (sticky) {
        const plan = planRetract(x, y, z, f);
        if (plan) {
            const poppedDone = new Set();
            for (const c of plan.popped) {
                const ck = `${c.x},${c.y},${c.z}`;
                if (poppedDone.has(ck)) continue;
                poppedDone.add(ck);
                for (const cc of popBlockAt(c.x, c.y, c.z)) {
                    spawnBreakParticles(cc.x, cc.y, cc.z, cc.id);
                    markChunkAround(chunks, cc.x, cc.z);
                }
            }
            // 靠近活塞的先挪：让出的格子正好是下一块的目的地
            const proj = (c) => (c.x - x) * nx + (c.y - y) * ny + (c.z - z) * nz;
            plan.moved.sort((a, b) => proj(a) - proj(b));
            for (const c of plan.moved) {
                const bt = getBlock(c.x, c.y, c.z);
                setBlockSafe(c.x, c.y, c.z, BlockTypes.AIR);
                setBlockSafe(c.x - nx, c.y - ny, c.z - nz, bt);
                markChunkAround(chunks, c.x, c.z);
                markChunkAround(chunks, c.x - nx, c.z - nz);
                for (const cc of popUnsupportedRedstone(c.x, c.y, c.z)) {
                    spawnBreakParticles(cc.x, cc.y, cc.z, cc.id);
                    markChunkAround(chunks, cc.x, cc.z);
                }
            }
        }
    }

    setBlockSafe(x, y, z, pistonId(sticky, f, 0));
    markChunkAround(chunks, x, z);

    flushChunks(chunks);
    playPistonSound(false);
    updateRedstoneNetwork();
    updateKineticNetwork(); // 被拉的方块里可能有动力元件，拓扑重算
    return true;
}

// ==================== 动作队列 + 每帧驱动 ====================
// 0.15s 延迟队列：redstone.js 的信号边沿只入队，本函数消费（对齐原版 3 游戏刻）。
// 同格旧动作作废（后到覆盖），防时钟抖动攒队列。
const pistonQueue = []; // {x,y,z,extend,t}

export function enqueuePistonAction(x, y, z, extend) {
    dropQueueAt(x, y, z);
    pistonQueue.push({ x, y, z, extend, t: PISTON_DELAY });
}

function dropQueueAt(x, y, z) {
    for (let i = pistonQueue.length - 1; i >= 0; i--) {
        if (pistonQueue[i].x === x && pistonQueue[i].y === y && pistonQueue[i].z === z) {
            pistonQueue.splice(i, 1);
        }
    }
}

// 观察者注册表：updateRedstoneNetwork 扫描结果经 syncObserverRegistry 同步进来，
// 每帧 diff 正前方方块 ID。同格旧条目保留 frontId/litUntil（网络重算不打断脉冲节拍）。
let observerRegistry = []; // {x,y,z,frontId,litUntil}
let obsClock = 0; // 观察者共用时钟（秒）

export function syncObserverRegistry(observers) {
    const prev = new Map(observerRegistry.map((o) => [`${o.x},${o.y},${o.z}`, o]));
    observerRegistry = observers.map((o) => {
        const old = prev.get(`${o.x},${o.y},${o.z}`);
        if (old) return { x: o.x, y: o.y, z: o.z, frontId: old.frontId, litUntil: old.litUntil };
        const [nx, ny, nz] = FACING_NORMALS[observerFacing(o.id)];
        return {
            x: o.x,
            y: o.y,
            z: o.z,
            frontId: getBlock(o.x + nx, o.y + ny, o.z + nz), // 注册时的现值作基线，不误报
            litUntil: 0,
        };
    });
}

// redstone.js 的 updateRedstoneTick 每帧调用：消费活塞动作 + 观察者侦测
export function updatePistonTick(dt) {
    if (!state.blocks) return;
    for (let i = pistonQueue.length - 1; i >= 0; i--) {
        const q = pistonQueue[i];
        q.t -= dt;
        if (q.t > 0) continue;
        pistonQueue.splice(i, 1);
        if (!isPistonId(getBlock(q.x, q.y, q.z))) continue; // 已被破坏/移走：动作作废
        if (q.extend) doExtend(q.x, q.y, q.z);
        else doRetract(q.x, q.y, q.z);
    }
    updateObservers(dt);
}

function updateObservers(dt) {
    obsClock += dt;
    let dirty = false;
    for (let i = observerRegistry.length - 1; i >= 0; i--) {
        const ob = observerRegistry[i];
        const id = getBlock(ob.x, ob.y, ob.z);
        if (!isObserverId(id)) {
            observerRegistry.splice(i, 1); // 已消失（被破坏/爆炸）：自清理
            continue;
        }
        const [nx, ny, nz] = FACING_NORMALS[observerFacing(id)];
        const cur = getBlock(ob.x + nx, ob.y + ny, ob.z + nz);
        if (cur !== ob.frontId) {
            // 侦测到变化：发脉冲（点亮变体即信号源，redstone.js 扫描时取用）
            ob.frontId = cur;
            ob.litUntil = obsClock + OBSERVER_PULSE_SEC;
            if (observerPowered(id) !== 1) {
                setBlockSafe(ob.x, ob.y, ob.z, observerId(observerFacing(id), 1));
                refreshPropAt(ob.x, ob.y, ob.z);
                dirty = true;
            }
        } else if (observerPowered(id) === 1 && obsClock > ob.litUntil) {
            setBlockSafe(ob.x, ob.y, ob.z, observerId(observerFacing(id), 0));
            refreshPropAt(ob.x, ob.y, ob.z);
            dirty = true;
        }
    }
    if (dirty) updateRedstoneNetwork();
}

// ==================== 外部兜底 ====================
// TNT 爆炸等批量毁格后调用：修复孤儿状态——头没了的伸出底座收回、底座没了的头移除。
// 返回被修正的格子（调用方负责重建网格）。
export function fixPistonAround(x, y, z) {
    const changed = [];
    for (const [nx, ny, nz] of FACING_NORMALS) {
        const ax = x + nx, ay = y + ny, az = z + nz;
        const id = getBlock(ax, ay, az);
        if (isPistonId(id) && pistonExtended(id) === 1) {
            const f = pistonFacing(id);
            const [fx, fy, fz] = FACING_NORMALS[f];
            if (getBlock(ax + fx, ay + fy, az + fz) !== pistonHeadId(f)) {
                setBlockSafe(ax, ay, az, pistonId(pistonSticky(id), f, 0));
                changed.push({ x: ax, y: ay, z: az });
            }
        } else if (isPistonHeadId(id)) {
            const f = id - PISTON_HEAD_BASE;
            const [fx, fy, fz] = FACING_NORMALS[f];
            const baseId = getBlock(ax - fx, ay - fy, az - fz);
            if (!isPistonId(baseId) || pistonFacing(baseId) !== f || pistonExtended(baseId) !== 1) {
                setBlockSafe(ax, ay, az, BlockTypes.AIR);
                changed.push({ x: ax, y: ay, z: az });
            }
        }
    }
    return changed;
}

// 读档/开新世界后调用：清动作队列与观察者注册表（网络重算会重新注册并建基线）
export function resetPistons() {
    pistonQueue.length = 0;
    observerRegistry = [];
}
