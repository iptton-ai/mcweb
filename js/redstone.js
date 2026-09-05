// ==================== redstone.js ====================
// 有状态方块「红石组」（红石粉/红石火把/按钮/压力板/拉杆/红石灯）的高层逻辑，
// 分层与 door.js 一致：config.js 把状态编码进方块 ID，本模块负责放置（按所点击面贴靠）、
// 右键交互、破坏（含失去支撑连锁脱落）、供能网络重算 updateRedstoneNetwork() 与
// 每帧驱动 updateRedstoneTick()（按钮计时 / 火把延迟翻转 / 压力板踩踏检测）。
//
// 信号模型（对齐原版 Minecraft 红石的核心乐趣）：
//   信号源（强度 15）：开着的拉杆、按下的按钮、被踩住的压力板、亮着的红石火把。
//   布线：红石粉只铺在实心方块顶面，每过一格衰减 1 级（0 级断路）；
//         同层四向相连，也能沿斜上/斜下一格的粉上下台阶（斜下须无实心方块挡线）。
//   充能方块：激活的红石粉把它脚下与四邻水平的实心方块充能；
//             拉杆/按钮/压力板也把各自的挂靠（支撑）方块充能。
//   反相器：红石火把默认亮；挂靠的方块被充能则熄灭、解除后复亮，
//           切换有 RTORCH_DELAY 延迟——输出粉绕回挂靠方块即成时钟（闪烁灯）。
//   负载（6 邻有激活红石粉或激活源即动作）：
//     红石灯点亮；门在信号上升沿开、下降沿关（手动右键不受影响）；TNT 在上升沿点燃。
// 任何红石放置/交互/破坏后调 updateRedstoneNetwork() 全量重算（全图扫描约几毫秒，仅事件时执行）。

import {
    BUTTON_ITEM_ID,
    BUTTON_PULSE_SEC,
    CHUNK_SIZE,
    DUST_BASE,
    DUST_ITEM_ID,
    FACING_NORMALS,
    LAMP_BASE,
    LAMP_COUNT,
    LAMP_ITEM_ID,
    LEVER_ITEM_ID,
    PLATE_ITEM_ID,
    RTORCH_DELAY,
    RTORCH_ITEM_ID,
    RS_MAX_STRENGTH,
    BlockTypes,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    buttonFacing,
    buttonId,
    buttonPressed,
    doorFacing,
    doorHalf,
    doorId,
    doorOpen,
    dustId,
    dustLit,
    isButtonId,
    isDoorId,
    isDustId,
    isLampId,
    isLeverId,
    isObserverId,
    isPlateId,
    isPistonId,
    isRTorchId,
    isRedstoneId,
    lampId,
    lampLit,
    leverFacing,
    leverId,
    leverOn,
    observerFacing,
    observerPowered,
    plateId,
    platePressed,
    rtorchFacing,
    rtorchId,
    rtorchLit,
} from './config.js';
import { isCreative, state } from './state.js';
import { getBlock, getBlockIndex, setBlockSafe } from './world.js';
import { isSolid, rebuildChunk, refreshPropAt, removeTorchLightAt } from './chunk.js';
import { playDoorSound, playLeverSound } from './audio.js';
import { spawnTntEntity } from './tnt.js';
import { enqueuePistonAction, resetPistons, syncObserverRegistry, updatePistonTick } from './piston.js';

// 水平四向（红石粉布线/充能都用它），与 FACING_NORMALS 的 2..5 独立
const HORIZ_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const LAYER = WORLD_WIDTH * WORLD_DEPTH;

const keyOf = (x, y, z) => x + z * WORLD_WIDTH + y * LAYER;

const inBounds = (x, y, z) =>
    x >= 0 && x < WORLD_WIDTH && y >= 0 && y < WORLD_HEIGHT && z >= 0 && z < WORLD_DEPTH;

// 按钮计时队列（按下中）与红石火把延迟翻转队列（时钟节拍来源）
const buttonTimers = []; // {x,y,z,t}
let torchQueue = []; // {x,y,z,lit,t}
let plateRegistry = []; // 压力板位置缓存：updateRedstoneTick 每帧踩踏检测用
let doorPoweredPrev = new Map(); // 门位置 -> 上轮信号电平（边沿检测）
let tntPoweredPrev = new Map(); // TNT 位置 -> 上轮信号电平（边沿检测）
let pistonPoweredPrev = new Map(); // 活塞位置 -> 上轮信号电平（边沿检测，动作经 piston.js 延迟队列）

export function facingFromNormal(dx, dy, dz) {
    if (dy > 0) return 0;
    if (dy < 0) return 1;
    if (dz < 0) return 2;
    if (dx > 0) return 3;
    if (dz > 0) return 4;
    return 5;
}

// 红石元件的物品 ID（破坏返还用）
function redstoneItemId(id) {
    if (isDustId(id)) return DUST_ITEM_ID;
    if (isRTorchId(id)) return RTORCH_ITEM_ID;
    if (isButtonId(id)) return BUTTON_ITEM_ID;
    if (isPlateId(id)) return PLATE_ITEM_ID;
    if (isLeverId(id)) return LEVER_ITEM_ID;
    return LAMP_ITEM_ID;
}

// 元件是否被 (sx,sy,sz) 格支撑：支撑格 = 元件格 − 挂靠面法线（法线从支撑面指向元件格）。
// 红石粉/压力板只贴地（法线 +Y）；红石火把/按钮/拉杆按 facing。
function mountedFacing(id) {
    if (isRTorchId(id)) return rtorchFacing(id);
    if (isButtonId(id)) return buttonFacing(id);
    if (isLeverId(id)) return leverFacing(id);
    if (isObserverId(id)) return OBS_OUT_FACING[observerFacing(id)]; // 观察者从背面输出（facing 的反面）
    return 0;
}

// facing 反面查表（0上↔1下 2北↔5西 3东↔4南）
const OBS_OUT_FACING = [1, 0, 5, 4, 3, 2];

function isSupportedBy(id, sx, sy, sz, x, y, z) {
    if (isLampId(id)) return false; // 红石灯是实心立方体、随处可放，无挂靠依赖（亮灭两态一并排除）
    const [nx, ny, nz] = FACING_NORMALS[mountedFacing(id)];
    return x - sx === nx && y - sy === ny && z - sz === nz;
}

// ==================== 放置 ====================
// 按所点击的面贴靠放置红石元件。face 为 hit.face（指向新格的方向，即挂靠面法线）。
// 红石粉/压力板只放实心方块顶面；红石火把/按钮/拉杆需背面有实心支撑；红石灯随处可放。
// 返回 null=成功，否则为错误提示。
export function placeRedstone(bx, by, bz, itemId, face) {
    if (bx < 0 || bx >= WORLD_WIDTH || by < 0 || by >= WORLD_HEIGHT || bz < 0 || bz >= WORLD_DEPTH) {
        return '❌ 超出世界边界';
    }
    const facing = facingFromNormal(face.dx, face.dy, face.dz);
    const [nx, ny, nz] = FACING_NORMALS[facing];
    if (itemId === LAMP_ITEM_ID) {
        setBlockSafe(bx, by, bz, lampId(0));
        // 红石灯是标准立方体（贴图随亮灭变化），需要重建区块网格
        rebuildChunk(Math.floor(bx / CHUNK_SIZE), Math.floor(bz / CHUNK_SIZE));
    } else if (itemId === DUST_ITEM_ID || itemId === PLATE_ITEM_ID) {
        if (!isSolid(getBlock(bx, by - 1, bz))) {
            return `❌ ${itemId === DUST_ITEM_ID ? '红石粉' : '压力板'}需要放在实心方块的顶面`;
        }
        setBlockSafe(bx, by, bz, itemId === DUST_ITEM_ID ? dustId(0) : plateId(0));
        refreshPropAt(bx, by, bz);
    } else if (itemId === RTORCH_ITEM_ID) {
        if (facing === 1) return '❌ 红石火把不能贴在方块底面';
        if (!isSolid(getBlock(bx - nx, by - ny, bz - nz))) return '❌ 需要贴在实心方块的表面放置';
        setBlockSafe(bx, by, bz, rtorchId(facing, 1)); // 默认点亮
        refreshPropAt(bx, by, bz);
    } else {
        // 按钮 / 拉杆
        if (!isSolid(getBlock(bx - nx, by - ny, bz - nz))) return '❌ 需要贴在实心方块的表面放置';
        setBlockSafe(bx, by, bz, itemId === BUTTON_ITEM_ID ? buttonId(facing, 0) : leverId(facing, 0));
        refreshPropAt(bx, by, bz);
    }
    updateRedstoneNetwork();
    return null;
}

// ==================== 右键交互 ====================
export function toggleLeverAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isLeverId(id)) return;
    const on = leverOn(id) ? 0 : 1;
    setBlockSafe(x, y, z, leverId(leverFacing(id), on));
    refreshPropAt(x, y, z);
    playLeverSound(on === 1);
    updateRedstoneNetwork();
}

// 按钮：按下 → 计 BUTTON_PULSE_SEC 秒后自动弹出（updateRedstoneTick 驱动），期间是信号源
export function pressButtonAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isButtonId(id) || buttonPressed(id) === 1) return;
    setBlockSafe(x, y, z, buttonId(buttonFacing(id), 1));
    refreshPropAt(x, y, z);
    playLeverSound(true);
    buttonTimers.push({ x, y, z, t: BUTTON_PULSE_SEC });
    updateRedstoneNetwork();
}

// ==================== 破坏 ====================
// 破坏红石元件：清格、撤灯光、清同格计时/延迟、生存模式返还物品；
// 随后检查相邻元件是否失去支撑，是则连锁脱落（递归）。返回被清除的格子列表。
export function breakRedstoneAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isRedstoneId(id)) return [];
    const cells = [{ x, y, z, id }];
    state.blocks[getBlockIndex(x, y, z)] = 0;
    if (isLampId(id) && lampLit(id) === 1) removeTorchLightAt(x, y, z);
    if (isRTorchId(id) && rtorchLit(id) === 1) removeTorchLightAt(x, y, z);
    dropTimersAt(x, y, z);
    if (!isCreative()) {
        const item = redstoneItemId(id);
        state.player.inventory[item] = (state.player.inventory[item] || 0) + 1;
    }
    for (const [nx, ny, nz] of FACING_NORMALS) {
        const mx = x + nx, my = y + ny, mz = z + nz;
        const mid = getBlock(mx, my, mz);
        if (isRedstoneId(mid) && isSupportedBy(mid, x, y, z, mx, my, mz)) {
            cells.push(...breakRedstoneAt(mx, my, mz));
        }
    }
    return cells;
}

// 普通方块被拆后调用：贴在它表面、失去支撑的红石元件一并脱落
export function popUnsupportedRedstone(x, y, z) {
    const cells = [];
    for (const [nx, ny, nz] of FACING_NORMALS) {
        const mx = x + nx, my = y + ny, mz = z + nz;
        const mid = getBlock(mx, my, mz);
        if (isRedstoneId(mid) && isSupportedBy(mid, x, y, z, mx, my, mz)) {
            cells.push(...breakRedstoneAt(mx, my, mz));
        }
    }
    if (cells.length > 0) updateRedstoneNetwork();
    return cells;
}

// 该格的按钮计时/火把延迟作废（元件被破坏或换格时）
function dropTimersAt(x, y, z) {
    for (let i = buttonTimers.length - 1; i >= 0; i--) {
        if (buttonTimers[i].x === x && buttonTimers[i].y === y && buttonTimers[i].z === z) buttonTimers.splice(i, 1);
    }
    torchQueue = torchQueue.filter((q) => q.x !== x || q.y !== y || q.z !== z);
}

// ==================== 每帧驱动 ====================
// 按钮到时弹出 / 红石火把延迟翻转 / 压力板踩踏检测；有任何状态变化则重算一次网络。
// 挂在 gameLoop（main.js），与旧齿轮动画同位。
export function updateRedstoneTick(dt) {
    if (!state.blocks) return;
    let dirty = false;

    for (let i = buttonTimers.length - 1; i >= 0; i--) {
        const b = buttonTimers[i];
        b.t -= dt;
        if (b.t > 0) continue;
        buttonTimers.splice(i, 1);
        const id = getBlock(b.x, b.y, b.z);
        if (isButtonId(id) && buttonPressed(id) === 1) {
            setBlockSafe(b.x, b.y, b.z, buttonId(buttonFacing(id), 0));
            refreshPropAt(b.x, b.y, b.z);
            playLeverSound(false);
            dirty = true;
        }
    }

    // 火把翻转先撤旧光再换变体（refreshPropAt 只重建网格，不管光源）
    for (let i = torchQueue.length - 1; i >= 0; i--) {
        const q = torchQueue[i];
        q.t -= dt;
        if (q.t > 0) continue;
        torchQueue.splice(i, 1);
        const id = getBlock(q.x, q.y, q.z);
        if (isRTorchId(id) && rtorchLit(id) !== q.lit) {
            if (q.lit === 0) removeTorchLightAt(q.x, q.y, q.z);
            setBlockSafe(q.x, q.y, q.z, rtorchId(rtorchFacing(id), q.lit));
            refreshPropAt(q.x, q.y, q.z);
            dirty = true;
        }
    }

    // 压力板：玩家/怪物脚部所在格与板同格 = 踩下（脚部取 floor(y+0.1)，贴地站立时正好是板格）
    if (plateRegistry.length > 0) {
        const occ = new Set();
        const add = (fx, fy, fz) => occ.add(`${Math.floor(fx)},${Math.floor(fy + 0.1)},${Math.floor(fz)}`);
        const p = state.player;
        if (!p.dead) add(p.x, p.y, p.z);
        for (const e of state.enemies) add(e.x, e.y, e.z);
        for (const pl of plateRegistry) {
            const want = occ.has(`${pl.x},${pl.y},${pl.z}`) ? 1 : 0;
            if (platePressed(pl.id) !== want) {
                pl.id = plateId(want); // registry 同步，防同帧重复触发
                setBlockSafe(pl.x, pl.y, pl.z, plateId(want));
                refreshPropAt(pl.x, pl.y, pl.z);
                playLeverSound(want === 1);
                dirty = true;
            }
        }
    }

    if (dirty) updateRedstoneNetwork();

    // 活塞组：消费 0.15s 动作队列（伸出/收回）+ 观察者每帧侦测（js/piston.js）
    updatePistonTick(dt);
}

// ==================== 供能网络重算 ====================
// 全图扫描红石元件/门/TNT → 从激活源 BFS 沿红石粉传播强度（每格 -1）→
// 计算充能方块集合 → 红石火把目标态入延迟队列 → 回写红石粉亮灭与红石灯，
// 并对门/TNT 做信号边沿检测（门上升沿开/下降沿关，TNT 上升沿点燃）。
// 网格刷新：贴面元件与红石粉走 refreshPropAt（customMesh），红石灯走 rebuildChunk（立方体贴图变化）。
export function updateRedstoneNetwork() {
    if (!state.blocks) return;
    const blocks = state.blocks;

    const dusts = [], torches = [], levers = [], buttons = [], plates = [], lamps = [];
    const doors = [], tnts = [], pistons = [], observers = [];
    let idx = 0;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let z = 0; z < WORLD_DEPTH; z++) {
            for (let x = 0; x < WORLD_WIDTH; x++, idx++) {
                const id = blocks[idx];
                if (id >= DUST_BASE && id < LAMP_BASE + LAMP_COUNT) {
                    if (isDustId(id)) dusts.push({ x, y, z, id });
                    else if (isRTorchId(id)) torches.push({ x, y, z, id });
                    else if (isButtonId(id)) buttons.push({ x, y, z, id });
                    else if (isPlateId(id)) plates.push({ x, y, z, id });
                    else if (isLeverId(id)) levers.push({ x, y, z, id });
                    else lamps.push({ x, y, z, id });
                } else if (isDoorId(id)) {
                    doors.push({ x, y, z, id });
                } else if (id === BlockTypes.TNT) {
                    tnts.push({ x, y, z });
                } else if (isPistonId(id)) {
                    pistons.push({ x, y, z, id });
                } else if (isObserverId(id)) {
                    observers.push({ x, y, z, id });
                }
            }
        }
    }
    plateRegistry = plates;
    syncObserverRegistry(observers); // 活塞组：观察者注册进每帧侦测表（piston.js）
    if (dusts.length === 0 && torches.length === 0 && levers.length === 0 && buttons.length === 0 &&
        plates.length === 0 && lamps.length === 0 && doors.length === 0 && tnts.length === 0 &&
        pistons.length === 0 && observers.length === 0) {
        doorPoweredPrev = new Map();
        tntPoweredPrev = new Map();
        pistonPoweredPrev = new Map();
        return;
    }

    // ---- 激活的信号源（供红石粉播种与负载邻接判定）----
    const activeSources = [];
    for (const lv of levers) if (leverOn(lv.id) === 1) activeSources.push(lv);
    for (const bt of buttons) if (buttonPressed(bt.id) === 1) activeSources.push(bt);
    for (const pl of plates) if (platePressed(pl.id) === 1) activeSources.push(pl);
    for (const tc of torches) if (rtorchLit(tc.id) === 1) activeSources.push(tc);
    for (const ob of observers) if (observerPowered(ob.id) === 1) activeSources.push(ob); // 观察者脉冲
    const activeSourceKeys = new Set(activeSources.map((s) => keyOf(s.x, s.y, s.z)));

    // ---- 红石粉强度 BFS：源 15 级直接送进邻粉，粉与粉每格 -1 ----
    // FIFO 保证最短路径先到，取到的强度即最大值；斜上邻粉（必然坐在实心支撑上）相连，
    // 斜下须邻列上格非实心才不挡线（对齐原版上下台阶走线）。
    const strength = new Map(); // 粉格 key -> 强度（>0）
    const queue = [];
    let qi = 0;
    const seedDust = (x, y, z) => {
        if (!inBounds(x, y, z) || !isDustId(blocks[keyOf(x, y, z)])) return;
        const k = keyOf(x, y, z);
        if ((strength.get(k) || 0) >= RS_MAX_STRENGTH) return;
        strength.set(k, RS_MAX_STRENGTH);
        queue.push(x, y, z); // 平铺三元组，省内层小数组开销
    };
    for (const s of activeSources) {
        for (const [dx, dy, dz] of FACING_NORMALS) seedDust(s.x + dx, s.y + dy, s.z + dz);
    }
    while (qi < queue.length) {
        const x = queue[qi++], y = queue[qi++], z = queue[qi++];
        const s = strength.get(keyOf(x, y, z)) - 1;
        if (s <= 0) continue; // 衰减到 0：不再向前传导
        for (const [dx, dz] of HORIZ_DIRS) {
            const tryDust = (ty) => {
                if (!inBounds(x + dx, ty, z + dz) || !isDustId(blocks[keyOf(x + dx, ty, z + dz)])) return;
                const k = keyOf(x + dx, ty, z + dz);
                if ((strength.get(k) || 0) >= s) return;
                strength.set(k, s);
                queue.push(x + dx, ty, z + dz);
            };
            tryDust(y); // 同层
            tryDust(y + 1); // 斜上（邻列粉坐在实心上，天然可爬）
            if (!isSolid(getBlock(x + dx, y, z + dz))) tryDust(y - 1); // 斜下：邻列上格不挡线才连
        }
    }

    // ---- 充能方块集合（红石火把反相判定用）----
    // 激活红石粉充能脚下 + 四邻水平实心方块；激活源充能各自挂靠/支撑方块。
    const poweredBlocks = new Set();
    const powerBlock = (x, y, z) => {
        if (inBounds(x, y, z)) poweredBlocks.add(keyOf(x, y, z));
    };
    for (const [k] of strength) {
        const y = Math.floor(k / LAYER);
        const rem = k % LAYER;
        const z = Math.floor(rem / WORLD_WIDTH);
        const x = rem % WORLD_WIDTH;
        powerBlock(x, y - 1, z);
        for (const [dx, dz] of HORIZ_DIRS) powerBlock(x + dx, y, z + dz);
    }
    for (const s of activeSources) {
        if (isRTorchId(s.id)) continue; // 火把不充能自己的挂靠方块（原版行为）——否则亮火把自己供能挂靠块=310ms 自振荡
        const [dx, dy, dz] = FACING_NORMALS[mountedFacing(s.id)];
        // 观察者的 mountedFacing 是背面（输出面）：充能 s+法线 = 背面输出格；
        // 其余源的 mountedFacing 是挂靠方向：充能 s-法线 = 挂靠/支撑方块
        if (isObserverId(s.id)) powerBlock(s.x + dx, s.y + dy, s.z + dz);
        else powerBlock(s.x - dx, s.y - dy, s.z - dz);
    }

    // ---- 红石火把：目标态 = 挂靠方块未被充能；翻转走 RTORCH_DELAY 延迟队列 ----
    for (const tc of torches) {
        const [dx, dy, dz] = FACING_NORMALS[rtorchFacing(tc.id)];
        const lit = poweredBlocks.has(keyOf(tc.x - dx, tc.y - dy, tc.z - dz)) ? 0 : 1;
        if (rtorchLit(tc.id) !== lit) queueTorchFlip(tc.x, tc.y, tc.z, lit);
    }

    // ---- 负载判定：6 邻有激活红石粉（strength>0）或激活源 ----
    const isCellActive = (x, y, z) => {
        for (const [dx, dy, dz] of FACING_NORMALS) {
            if (!inBounds(x + dx, y + dy, z + dz)) continue;
            const k = keyOf(x + dx, y + dy, z + dz);
            if (strength.has(k) || activeSourceKeys.has(k)) return true;
        }
        return false;
    };

    // 红石粉亮灭回写（视觉反馈）
    for (const du of dusts) {
        const lit = strength.has(keyOf(du.x, du.y, du.z)) ? 1 : 0;
        if (dustLit(du.id) !== lit) {
            setBlockSafe(du.x, du.y, du.z, dustId(lit));
            refreshPropAt(du.x, du.y, du.z);
        }
    }

    // 红石灯：先撤光再换亮灭变体，重建后由 buildChunkProps 重新挂光
    for (const L of lamps) {
        const lit = isCellActive(L.x, L.y, L.z) ? 1 : 0;
        if (lampLit(L.id) !== lit) {
            if (lit === 0) removeTorchLightAt(L.x, L.y, L.z);
            setBlockSafe(L.x, L.y, L.z, lampId(lit));
            rebuildChunk(Math.floor(L.x / CHUNK_SIZE), Math.floor(L.z / CHUNK_SIZE));
        }
    }

    // 门：信号上升沿开、下降沿关（边沿表每轮重建；手动右键开关不受影响）。
    // 只对下半扇判定（上半格信号几乎总相同，避免同扇门双触发）。
    const doorPrev = new Map();
    for (const d of doors) {
        if (doorHalf(d.id) !== 0) continue;
        const k = keyOf(d.x, d.y, d.z);
        const powered = isCellActive(d.x, d.y, d.z) || isCellActive(d.x, d.y + 1, d.z);
        doorPrev.set(k, powered);
        if (powered !== (doorPoweredPrev.get(k) ?? false)) applyDoorPower(d.x, d.y, d.z, powered);
    }
    doorPoweredPrev = doorPrev;

    // TNT：信号上升沿点燃（放置为惰性，见 interaction.js；陷阱玩法）
    const tntPrev = new Map();
    for (const t of tnts) {
        const k = keyOf(t.x, t.y, t.z);
        const powered = isCellActive(t.x, t.y, t.z);
        tntPrev.set(k, powered);
        if (powered && !(tntPoweredPrev.get(k) ?? false) && getBlock(t.x, t.y, t.z) === BlockTypes.TNT) {
            spawnTntEntity(t.x, t.y, t.z);
        }
    }
    tntPoweredPrev = tntPrev;

    // 活塞：信号上升沿入队「伸出」、下降沿入队「收回」——动作在 piston.js 的
    // 0.15s 延迟队列里执行（对齐原版 3 游戏刻，也防飞行机器递归重算）
    const pistonPrev = new Map();
    for (const pi of pistons) {
        const k = keyOf(pi.x, pi.y, pi.z);
        const powered = isCellActive(pi.x, pi.y, pi.z);
        pistonPrev.set(k, powered);
        if (powered !== (pistonPoweredPrev.get(k) ?? false)) enqueuePistonAction(pi.x, pi.y, pi.z, powered);
    }
    pistonPoweredPrev = pistonPrev;
}

// 火把翻转入队：同格旧目标作废（后到覆盖），节拍重置为 RTORCH_DELAY
function queueTorchFlip(x, y, z, lit) {
    torchQueue = torchQueue.filter((q) => q.x !== x || q.y !== y || q.z !== z);
    torchQueue.push({ x, y, z, lit, t: RTORCH_DELAY });
}

// 整扇门随信号开/关（找成对的另一半联动，逻辑对齐 door.js 的 toggleDoorAt）
function applyDoorPower(x, y, z, open) {
    const id = getBlock(x, y, z);
    if (!isDoorId(id) || doorOpen(id) === open) return;
    const half = doorHalf(id);
    const oy = half === 0 ? y + 1 : y - 1;
    setBlockSafe(x, y, z, doorId(half, open, doorFacing(id)));
    refreshPropAt(x, y, z);
    const otherId = getBlock(x, oy, z);
    if (isDoorId(otherId) && doorHalf(otherId) !== half && doorFacing(otherId) === doorFacing(id)) {
        setBlockSafe(x, oy, z, doorId(doorHalf(otherId), open, doorFacing(otherId)));
        refreshPropAt(x, oy, z);
    }
    playDoorSound(open);
}

// 读档/开新世界后调用：清瞬时队列并重算一遍（恢复红石粉/红石灯派生态与门/TNT/活塞边沿基线）
export function initRedstone() {
    buttonTimers.length = 0;
    torchQueue = [];
    doorPoweredPrev = new Map();
    tntPoweredPrev = new Map();
    pistonPoweredPrev = new Map();
    resetPistons();
    updateRedstoneNetwork();
}
