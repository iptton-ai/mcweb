// ==================== machinery.js ====================
// 有状态方块「机械组」（齿轮/拉杆/红石灯）的高层逻辑，分层与 door.js 一致：
// config.js 把状态编码进方块 ID，本模块负责放置（按所点击面贴靠）、右键开关、
// 破坏（含失去支撑连锁脱落）、供能网络重算与齿轮转动动画。
//
// 供能规则（无红石的轻量电路）：
//   拉杆(开) → 给 6 邻的齿轮供能；转动中的齿轮 → 继续给相邻齿轮传动（BFS 链）；
//   齿轮转动 = powered(被供能) || manual(手动右键)；红石灯 lit = 6 邻有开着的拉杆或转动齿轮。
//   任何机械放置/开关/破坏后调 updatePowerNetwork() 全量重算（全图扫描约几毫秒，仅交互时执行）。

import {
    CHUNK_SIZE,
    FACING_NORMALS,
    GEAR_BASE,
    GEAR_ITEM_ID,
    GEAR_SPIN_SPEED,
    LAMP_BASE,
    LAMP_COUNT,
    LAMP_ITEM_ID,
    LEVER_COUNT,
    LEVER_ITEM_ID,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    gearFacing,
    gearId,
    gearJammed,
    gearManual,
    gearPowered,
    isGearId,
    isLampId,
    isLeverId,
    isMachineryId,
    lampId,
    lampLit,
    leverFacing,
    leverId,
    leverOn,
} from './config.js';
import { isCreative, state } from './state.js';
import { getBlock, getBlockIndex, setBlockSafe } from './world.js';
import { isSolid, rebuildChunk, refreshPropAt, removeTorchLightAt } from './chunk.js';
import { playGearSound, playLeverSound } from './audio.js';

// 齿轮转向表（key "x+z*W+y*layer" → ±1）：转向不进方块 ID，由 updatePowerNetwork
// 每次重算；相邻齿轮反向咬合，共轴同向。updateMachinery 每帧按它驱动动画。
let gearDirByKey = new Map();

export function facingFromNormal(dx, dy, dz) {
    if (dy > 0) return 0;
    if (dy < 0) return 1;
    if (dz < 0) return 2;
    if (dx > 0) return 3;
    if (dz > 0) return 4;
    return 5;
}

// 齿轮/拉杆是否被 (sx,sy,sz) 格支撑：支撑格 = 机械格 − 挂靠面法线（法线从支撑面指向机械格）
function isSupportedBy(id, sx, sy, sz, x, y, z) {
    const facing = isGearId(id) ? gearFacing(id) : leverFacing(id);
    const [nx, ny, nz] = FACING_NORMALS[facing];
    return x - sx === nx && y - sy === ny && z - sz === nz;
}

// ==================== 放置 ====================
// 按所点击的面贴靠放置机械方块。face 为 hit.face（指向新格的方向，即挂靠面法线）。
// 齿轮/拉杆需要背面有实心支撑，红石灯是立方体随处可放。返回 null=成功，否则为错误提示。
export function placeMachinery(bx, by, bz, itemId, face) {
    if (bx < 0 || bx >= WORLD_WIDTH || by < 0 || by >= WORLD_HEIGHT || bz < 0 || bz >= WORLD_DEPTH) {
        return '❌ 超出世界边界';
    }
    const facing = facingFromNormal(face.dx, face.dy, face.dz);
    const [nx, ny, nz] = FACING_NORMALS[facing];
    if (itemId !== LAMP_ITEM_ID && !isSolid(getBlock(bx - nx, by - ny, bz - nz))) {
        return '❌ 需要贴在实心方块的表面放置';
    }
    if (itemId === LAMP_ITEM_ID) {
        setBlockSafe(bx, by, bz, lampId(0));
        // 红石灯是标准立方体（贴图随亮灭变化），需要重建区块网格
        rebuildChunk(Math.floor(bx / CHUNK_SIZE), Math.floor(bz / CHUNK_SIZE));
    } else {
        setBlockSafe(bx, by, bz, itemId === GEAR_ITEM_ID ? gearId(facing, 0, 0, 0) : leverId(facing, 0));
        refreshPropAt(bx, by, bz); // 齿轮/拉杆是 customMesh 道具，无需重建区块网格
    }
    updatePowerNetwork();
    return null;
}

// ==================== 右键开关 ====================
export function toggleGearAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isGearId(id)) return;
    const manual = gearManual(id) ? 0 : 1;
    setBlockSafe(x, y, z, gearId(gearFacing(id), gearPowered(id), gearJammed(id), manual));
    refreshPropAt(x, y, z);
    playGearSound(manual === 1);
    updatePowerNetwork();
}

export function toggleLeverAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isLeverId(id)) return;
    const on = leverOn(id) ? 0 : 1;
    setBlockSafe(x, y, z, leverId(leverFacing(id), on));
    refreshPropAt(x, y, z);
    playLeverSound(on === 1);
    updatePowerNetwork();
}

// ==================== 破坏 ====================
// 破坏机械方块：清格、亮着的红石灯先撤光、生存模式返还物品；
// 随后检查相邻齿轮/拉杆是否失去支撑，是则连锁脱落（递归）。返回被清除的格子列表。
export function breakMachineryAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isMachineryId(id)) return [];
    const cells = [{ x, y, z, id }];
    state.blocks[getBlockIndex(x, y, z)] = 0;
    if (isLampId(id) && lampLit(id) === 1) removeTorchLightAt(x, y, z);
    if (!isCreative()) {
        const item = isGearId(id) ? GEAR_ITEM_ID : isLeverId(id) ? LEVER_ITEM_ID : LAMP_ITEM_ID;
        state.player.inventory[item] = (state.player.inventory[item] || 0) + 1;
    }
    for (const [nx, ny, nz] of FACING_NORMALS) {
        const mx = x + nx, my = y + ny, mz = z + nz;
        const mid = getBlock(mx, my, mz);
        if ((isGearId(mid) || isLeverId(mid)) && isSupportedBy(mid, x, y, z, mx, my, mz)) {
            cells.push(...breakMachineryAt(mx, my, mz));
        }
    }
    return cells;
}

// 普通方块被拆后调用：贴在它表面、失去支撑的齿轮/拉杆一并脱落
export function popUnsupportedMachinery(x, y, z) {
    const cells = [];
    for (const [nx, ny, nz] of FACING_NORMALS) {
        const mx = x + nx, my = y + ny, mz = z + nz;
        const mid = getBlock(mx, my, mz);
        if ((isGearId(mid) || isLeverId(mid)) && isSupportedBy(mid, x, y, z, mx, my, mz)) {
            cells.push(...breakMachineryAt(mx, my, mz));
        }
    }
    if (cells.length > 0) updatePowerNetwork();
    return cells;
}

// ==================== 供能网络重算 ====================
// 全图扫描机械方块 → 从开着的拉杆 BFS 传播齿轮供能 → 回写齿轮 powered 位与红石灯 lit 位。
// 网格刷新：齿轮/拉杆走 refreshPropAt（customMesh），红石灯走 rebuildChunk（立方体贴图变化）。
export function updatePowerNetwork() {
    if (!state.blocks) return;
    const blocks = state.blocks;
    const levers = [], gears = [], lamps = [];
    const layer = WORLD_WIDTH * WORLD_DEPTH;
    let idx = 0;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let z = 0; z < WORLD_DEPTH; z++) {
            for (let x = 0; x < WORLD_WIDTH; x++, idx++) {
                const id = blocks[idx];
                if (id < GEAR_BASE || id >= LAMP_BASE + LAMP_COUNT) continue;
                const cell = { x, y, z, id };
                if (isGearId(id)) gears.push(cell);
                else if (isLeverId(id)) levers.push(cell);
                else lamps.push(cell);
            }
        }
    }
    if (levers.length === 0 && gears.length === 0 && lamps.length === 0) return;

    // BFS：从开着的拉杆出发，穿过相邻齿轮传播供能
    const powered = new Set();
    const queue = [];
    const tryPowerGear = (x, y, z) => {
        if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) return;
        const k = x + z * WORLD_WIDTH + y * layer;
        if (powered.has(k) || !isGearId(blocks[k])) return;
        powered.add(k);
        queue.push([x, y, z]);
    };
    for (const lv of levers) {
        if (leverOn(lv.id) === 0) continue;
        for (const [nx, ny, nz] of FACING_NORMALS) tryPowerGear(lv.x + nx, lv.y + ny, lv.z + nz);
    }
    // 手动转起的齿轮同样是动力源（转动的齿轮都传动，见模块头注释）
    for (const g of gears) {
        if (gearManual(g.id) === 0) continue;
        for (const [nx, ny, nz] of FACING_NORMALS) tryPowerGear(g.x + nx, g.y + ny, g.z + nz);
    }
    while (queue.length > 0) {
        const [gx, gy, gz] = queue.pop();
        for (const [nx, ny, nz] of FACING_NORMALS) tryPowerGear(gx + nx, gy + ny, gz + nz);
    }

    // ==================== 齿轮转向分配 + 卡死检测 ====================
    // 物理规则：并排啮合的两个齿轮反向转（咬合）；面对面共轴的两个齿轮（法线相反、
    // 偏移沿轴，齿对齿顶死）卡死；一处卡死锁死整个连通的转动组件（动力被憋停）。
    // 转向（±1）不进方块 ID，挂在 gearDirByKey 供每帧动画取用。
    // 注意「转动中」必须用本次供能 BFS 的结果（powered ∪ manual）判定——gears 里
    // 的 id 是重算前扫出来的旧值，刚被供能的齿轮不在里面。
    const keyOf = (c) => c.x + c.z * WORLD_WIDTH + c.y * layer;
    const isSpinningCell = (g) => powered.has(keyOf(g)) || gearManual(g.id) === 1;
    const spinningGears = gears.filter(isSpinningCell);
    const gearByKey = new Map();
    for (const g of spinningGears) gearByKey.set(keyOf(g), g);
    const dirByKey = new Map();
    const jammedKeys = new Set();
    const visited = new Set();
    for (const seed of spinningGears) {
        const sk = keyOf(seed);
        if (visited.has(sk)) continue;
        visited.add(sk);
        dirByKey.set(sk, 1);
        const component = [seed];
        let jam = false;
        const queue = [seed];
        while (queue.length > 0) {
            const cur = queue.pop();
            const ck = keyOf(cur);
            const curDir = dirByKey.get(ck);
            const nc = FACING_NORMALS[gearFacing(cur.id)];
            for (const [dx, dy, dz] of FACING_NORMALS) {
                const nb = gearByKey.get(ck + dx + dz * WORLD_WIDTH + dy * layer);
                if (!nb) continue;
                const nn = FACING_NORMALS[gearFacing(nb.id)];
                const dot = nc[0] * nn[0] + nc[1] * nn[1] + nc[2] * nn[2]; // 法线点积
                const along = nc[0] * dx + nc[1] * dy + nc[2] * dz;        // 偏移在轴上的分量
                // 面对面顶死：法线相反且偏移沿轴 → 卡死，同向（锁死无所谓方向）
                // 并排咬合：法线相同且偏移垂直于轴 → 反向
                // 其余（异面不相触）→ 随邻同向
                const want = (dot === -1 && along !== 0) ? curDir
                    : (dot === 1 && along === 0) ? -curDir
                        : curDir;
                if (dot === -1 && along !== 0) jam = true;
                const nk = keyOf(nb);
                if (!visited.has(nk)) {
                    visited.add(nk);
                    dirByKey.set(nk, want);
                    component.push(nb);
                    queue.push(nb);
                } else if (dirByKey.get(nk) !== want) {
                    jam = true; // 环上转向冲突（反向边数为奇）
                }
            }
        }
        if (jam) for (const c of component) jammedKeys.add(keyOf(c));
    }
    gearDirByKey = dirByKey;

    // 回写齿轮 powered/jam 位（手动位不变；供能与卡死只影响转/停）
    for (const g of gears) {
        const p = powered.has(keyOf(g)) ? 1 : 0;
        const j = (isSpinningCell(g) && jammedKeys.has(keyOf(g))) ? 1 : 0;
        if (gearPowered(g.id) !== p || gearJammed(g.id) !== j) {
            setBlockSafe(g.x, g.y, g.z, gearId(gearFacing(g.id), p, j, gearManual(g.id)));
            refreshPropAt(g.x, g.y, g.z);
        }
    }

    // 红石灯：6 邻有开着的拉杆或转动中的齿轮 → 点亮（卡死的齿轮传动轴仍在被驱动，视作通电）
    for (const L of lamps) {
        let lit = 0;
        for (const [nx, ny, nz] of FACING_NORMALS) {
            const nid = getBlock(L.x + nx, L.y + ny, L.z + nz);
            if ((isLeverId(nid) && leverOn(nid) === 1) ||
                (isGearId(nid) && (gearPowered(nid) || gearManual(nid)) === 1)) {
                lit = 1;
                break;
            }
        }
        if (lampLit(L.id) !== lit) {
            if (lit === 0) removeTorchLightAt(L.x, L.y, L.z); // 先撤光，重建后由 buildChunkProps 重新挂光
            setBlockSafe(L.x, L.y, L.z, lampId(lit));
            rebuildChunk(Math.floor(L.x / CHUNK_SIZE), Math.floor(L.z / CHUNK_SIZE));
        }
    }
}

// 读档/开新世界后调用一次，恢复 powered/lit 派生位与灯光
export function initMachinery() {
    updatePowerNetwork();
}

// ==================== 每帧动画 ====================
// 转动场景里的齿轮道具。spinner 不能存进 mesh.userData（clone 会 JSON 序列化），
// 按构建时的固定层级取：root → mounted → spinner（见 chunk.js buildGearMesh）。
// 方向取 gearDirByKey（±1，相邻齿轮反向咬合）；卡死的齿轮不转。
export function updateMachinery(dt) {
    const layer = WORLD_WIDTH * WORLD_DEPTH;
    for (const it of state.droppedItems) {
        if (!it.prop || !it.mesh.userData.spinning || it.mesh.userData.jammed) continue;
        const spinner = it.mesh.children[0] && it.mesh.children[0].children[0];
        if (!spinner) continue;
        const dir = gearDirByKey.get(it.x + it.z * WORLD_WIDTH + it.y * layer) || 1;
        spinner.rotation.y += dt * GEAR_SPIN_SPEED * Math.PI * 2 * dir;
    }
}
