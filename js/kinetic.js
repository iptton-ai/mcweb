// ==================== kinetic.js ====================
// 有状态方块「动力组」（水车/传动轴/齿轮/粉碎轮/机械锯）的高层逻辑，分层与 redstone.js /
// piston.js 一致：config.js 把轴向/朝向编码进方块 ID，本模块负责放置、破坏、
// 动力网络求解 updateKineticNetwork() 与每帧驱动 updateKineticTick()（旋转动画 + 机器计时）。
//
// 动力模型（Create 模组的离散版，方案见 docs/create-lite-plan.md 阶段二）：
//   水车是唯一动力源：顶面接触静态水（湖/海里泡着，或创造放水）→ 全网 8 RPM、
//   每台水车 +64 SU 应力容量（多水车不叠 RPM 只叠容量）；
//   传动轴沿轴向直线布线（同轴相邻 1:1 传速）；齿轮与「轴互相垂直」的相邻齿轮啮合 =
//   换向反转（平行轴并排不连接，对齐 Create 直觉）；机械锯只从背面接传动（朝向那头是锯切目标）。
//   应力：负载 = Σ配对粉碎轮 32 + Σ机械锯 24；负载 > 容量 = 过载，整网停转；
//   同一格被相反转向到达 = 卡死，整网停转；无水车的分量 = 无动力静止。
// 求解照 updateRedstoneNetwork 的事件触发全量重算骨架，派生态写进本模块的运行时 Map
// （不占方块 ID、不进存档），读档/开新世界后 initKinetic() 重算。
//
// 触发点：动力方块放置/破坏（interaction.js）、活塞推拉后（piston.js）、
// 助手施工完成（buildQueue.js）、TNT 爆炸后（tnt.js）、放置 WATER（可能给水车供水）。

import {
    AXIS_DIRS,
    AXIS_X,
    AXIS_Y,
    AXIS_Z,
    BlockInfo,
    BlockTypes,
    COGWHEEL_ITEM_ID,
    CRUSHER_ITEM_ID,
    CRUSHER_SU_LOAD,
    KINETIC_SPIN_VIS,
    SAW_ITEM_ID,
    SAW_SU_LOAD,
    SHAFT_ITEM_ID,
    WATERWHEEL_ITEM_ID,
    WHEEL_RPM,
    WHEEL_SU_CAPACITY,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    FACING_NORMALS,
    cogAxis,
    crusherAxis,
    isCogId,
    isCrusherId,
    isKineticId,
    isSawId,
    isShaftId,
    isWaterwheelId,
    kineticAxisOf,
    kineticItemId,
    sawFacing,
    shaftAxis,
    waterwheelAxis,
} from './config.js';
import { isCreative, state } from './state.js';
import { getBlock, setBlockSafe } from './world.js';
import { refreshPropAt } from './chunk.js';

const keyOf = (x, y, z) => `${x},${y},${z}`;

// 水平四向（粉碎轮配对判定用），与 FACING_NORMALS 的 2..5 独立
const HORIZ_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 面法线 → 朝向编码（与 redstone.js 的 facingFromNormal 同规则，本地实现避免循环依赖）
function facingFromNormalLocal(dx, dy, dz) {
    if (dy > 0) return 0;
    if (dy < 0) return 1;
    if (dz < 0) return 2;
    if (dx > 0) return 3;
    if (dz > 0) return 4;
    return 5;
}

// 面法线 → 传动轴（点顶面 = 立轴 Y，贴墙 = 垂直于墙面的横轴）
function normalAxis(dx, dy, dz) {
    return dx !== 0 ? AXIS_X : dy !== 0 ? AXIS_Y : AXIS_Z;
}

// ==================== 派生态（求解结果） ====================
let kineticMap = new Map(); // key -> { compId, dir }（dir ±1 = 相对自身轴的转向，无动力时无意义）
let components = []; // 分量聚合：{ capacity, load, wheels, poweredWheels, jammed, overstressed, running, spin }
let crusherPaired = new Set(); // 配对成功的粉碎轮 key 集（负载/投料只算配对轮）

// ==================== 放置 ====================
// 轴类方块朝所点击面的法线方向放置（点顶面 = 立轴，贴墙 = 横轴垂直墙面）；
// 机械锯朝向 = 被锯方块方向（复用活塞的贴面朝向规则）。返回 null = 成功。
export function placeKinetic(bx, by, bz, itemId, face) {
    if (bx < 0 || bx >= WORLD_WIDTH || by < 0 || by >= WORLD_HEIGHT || bz < 0 || bz >= WORLD_DEPTH) {
        return '❌ 超出世界边界';
    }
    let id;
    if (itemId === SAW_ITEM_ID) {
        id = sawId(facingFromNormalLocal(face.dx, face.dy, face.dz));
    } else {
        const axis = normalAxis(face.dx, face.dy, face.dz);
        id = itemId === SHAFT_ITEM_ID ? shaftId(axis)
            : itemId === COGWHEEL_ITEM_ID ? cogId(axis)
                : itemId === WATERWHEEL_ITEM_ID ? waterwheelId(axis)
                    : crusherId(axis);
    }
    setBlockSafe(bx, by, bz, id);
    refreshPropAt(bx, by, bz);
    updateKineticNetwork();
    return null;
}

// ==================== 破坏 ====================
// 破坏动力方块：清格、机器进度作废、生存返还物品、网络重算。
// 返回被清除的格子列表（粒子/区块重建用，调用方负责 popUnsupportedRedstone）。
export function breakKineticAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isKineticId(id)) return [];
    setBlockSafe(x, y, z, BlockTypes.AIR);
    dropMachineProgressAt(x, y, z);
    if (!isCreative()) {
        const item = kineticItemId(id);
        state.player.inventory[item] = (state.player.inventory[item] || 0) + 1;
    }
    updateKineticNetwork();
    return [{ x, y, z, id }];
}

// ==================== 动力网络求解 ====================
// 全图扫一遍收集动力方块 → 邻接规则建图（同轴相邻 / 齿轮垂直啮合）→
// 连通分量统计（容量/负载）+ 从水车传播转向（啮合翻转，冲突 = 卡死）→
// 回写派生态。O(全图) 几毫秒，与红石同级，仅事件时执行。
export function updateKineticNetwork() {
    if (!state.blocks) return;
    const blocks = state.blocks;
    const cells = [];
    let idx = 0;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let z = 0; z < WORLD_DEPTH; z++) {
            for (let x = 0; x < WORLD_WIDTH; x++, idx++) {
                const id = blocks[idx];
                if (!isKineticId(id)) continue;
                cells.push({ x, y, z, id, axis: kineticAxisOf(id), saw: isSawId(id) });
            }
        }
    }

    // 水车产能判定：顶面接触静态水（湖/海里泡着转；创造模式可放置 WATER 自由选址）
    for (const c of cells) {
        if (isWaterwheelId(c.id)) c.powered = getBlock(c.x, c.y + 1, c.z) === BlockTypes.WATER;
    }

    // 粉碎轮配对：水平相邻两轮、轴向相同、连线方向垂直于该轴（单只不成对 = 无功能不计负载）
    crusherPaired = new Set();
    for (const c of cells) {
        if (!isCrusherId(c.id)) continue;
        for (const [dx, dz] of HORIZ_DIRS) {
            const nid = getBlock(c.x + dx, c.y, c.z + dz);
            if (!isCrusherId(nid) || crusherAxis(nid) !== c.axis) continue;
            if ((dx !== 0 ? AXIS_X : AXIS_Z) !== c.axis) {
                crusherPaired.add(keyOf(c.x, c.y, c.z));
                break;
            }
        }
    }

    const byKey = new Map(cells.map((c) => [keyOf(c.x, c.y, c.z), c]));
    const newMap = new Map();
    const comps = [];
    const visited = new Set();
    for (const seed of cells) {
        const seedKey = keyOf(seed.x, seed.y, seed.z);
        if (visited.has(seedKey)) continue;

        // 1) 连通性 BFS 收集成员（邻接的闭包即分量）
        const members = [];
        const queue = [seed];
        visited.add(seedKey);
        while (queue.length > 0) {
            const c = queue.pop();
            members.push(c);
            for (const other of neighborsOf(c, byKey)) {
                const k = keyOf(other.x, other.y, other.z);
                if (visited.has(k)) continue;
                visited.add(k);
                queue.push(other);
            }
        }

        // 2) 应力统计：容量 = Σ有水水车×64；负载 = Σ配对粉碎轮×32 + Σ锯×24
        let capacity = 0, load = 0, wheels = 0, poweredWheels = 0;
        for (const c of members) {
            if (isWaterwheelId(c.id)) {
                wheels++;
                if (c.powered) {
                    poweredWheels++;
                    capacity += WHEEL_SU_CAPACITY;
                }
            } else if (isCrusherId(c.id) && crusherPaired.has(keyOf(c.x, c.y, c.z))) {
                load += CRUSHER_SU_LOAD;
            } else if (isSawId(c.id)) {
                load += SAW_SU_LOAD;
            }
        }

        // 3) 转向传播：从第一台有水的水车出发（多水车不加速、方向以它为准），
        //    同轴传向不变、啮合翻转；同一格被相反转向到达 = 卡死（整网停转）
        let jammed = false;
        const dirMap = new Map();
        const src = members.find((c) => c.powered);
        if (src) {
            dirMap.set(keyOf(src.x, src.y, src.z), 1);
            const dq = [{ c: src, dir: 1 }];
            let qi = 0;
            while (qi < dq.length) {
                const { c, dir } = dq[qi++];
                for (const { other, mesh } of neighborsOf(c, byKey)) {
                    const nd = mesh ? -dir : dir;
                    const k = keyOf(other.x, other.y, other.z);
                    const prev = dirMap.get(k);
                    if (prev === undefined) {
                        dirMap.set(k, nd);
                        dq.push({ c: other, dir: nd });
                    } else if (prev !== nd) {
                        jammed = true;
                    }
                }
            }
        }

        const overstressed = capacity > 0 && load > capacity;
        const running = poweredWheels > 0 && !jammed && !overstressed;
        comps.push({
            capacity, load, wheels, poweredWheels, jammed, overstressed, running,
            spin: WHEEL_RPM / 60 * Math.PI * 2 * KINETIC_SPIN_VIS, // 视觉转速（rad/s，转向由 dir 决定）
        });
        for (const c of members) {
            newMap.set(keyOf(c.x, c.y, c.z), { compId: comps.length - 1, dir: dirMap.get(keyOf(c.x, c.y, c.z)) || 1 });
        }
    }
    kineticMap = newMap;
    components = comps;
}

// 邻接枚举：同轴相邻（沿轴向连线；锯只从背面接，正面是被锯目标）+ 齿轮垂直啮合。
// yield { other, mesh }：mesh = true 表示这是啮合边（转向翻转）。
function* neighborsOf(c, byKey) {
    for (const dir of [-1, 1]) {
        const [ax, ay, az] = AXIS_DIRS[c.axis];
        const nx = c.x + ax * dir, ny = c.y + ay * dir, nz = c.z + az * dir;
        const other = byKey.get(keyOf(nx, ny, nz));
        if (!other) continue;
        if (c.saw) {
            // 锯的正面（朝向邻格）是被锯目标，不参与传动
            const [fx, fy, fz] = FACING_NORMALS[sawFacing(c.id)];
            if (nx === c.x + fx && ny === c.y + fy && nz === c.z + fz) continue;
        }
        if (other.saw) {
            // 对方是锯：只有本格正好在它背面时才接通
            const [fx, fy, fz] = FACING_NORMALS[sawFacing(other.id)];
            if (other.x - fx === c.x && other.y - fy === c.y && other.z - fz === c.z) yield { other, mesh: false };
            continue;
        }
        if (other.axis === c.axis) yield { other, mesh: false };
    }
    // 齿轮啮合：相邻格是齿轮、两轴垂直、连线方向沿两者之一的轴（一以轮面贴、一以轮齿咬）
    if (!isCogId(c.id)) return;
    for (const [fx, fy, fz] of FACING_NORMALS) {
        const other = byKey.get(keyOf(c.x + fx, c.y + fy, c.z + fz));
        if (!other || !isCogId(other.id) || other.axis === c.axis) continue;
        const dirAxis = fx !== 0 ? AXIS_X : fy !== 0 ? AXIS_Y : AXIS_Z;
        if (dirAxis === c.axis || dirAxis === other.axis) yield { other, mesh: true };
    }
}

// ==================== 每帧驱动 ====================
// 旋转动画（零区块重建）+ 终端机器计时（粉碎/锯切，见文末）。
export function updateKineticTick(dt) {
    if (!state.blocks) return;
    for (const it of state.droppedItems) {
        if (!it.prop || !it.mesh.userData.kinetic) continue;
        const k = kineticMap.get(it.mesh.userData.propKey);
        const comp = k && components[k.compId];
        if (!comp || !comp.running) continue;
        // 层级约定见 chunk.js：root → orient → spinner（spinner 永远是 orient 的第一个子节点）
        const spinner = it.mesh.children[0]?.children[0];
        if (spinner) spinner.rotation.y += comp.spin * k.dir * dt;
    }
    updateCrushers(dt);
    updateSaws(dt);
}

// ==================== 外部查询（HUD / 交互提示用） ====================
// 准星对准动力方块时的状态文案；非动力方块返回 null。
export function kineticStatusAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isKineticId(id)) return null;
    const name = BlockInfo[id]?.name || '动力方块';
    const k = kineticMap.get(keyOf(x, y, z));
    const c = k && components[k.compId];
    const prefix = isCrusherId(id) && !crusherPaired.has(keyOf(x, y, z)) ? '未配对 · ' : '';
    if (!c) return `⚙️ ${name} · ${prefix}静止`;
    if (c.jammed) return `⚙️ ${name} · ${prefix}⛔ 卡死（传动转向冲突）`;
    if (c.overstressed) return `⚙️ ${name} · ${prefix}⛔ 过载（应力 ${c.load}/${c.capacity}，再加一台水车）`;
    if (c.poweredWheels === 0) return `⚙️ ${name} · ${prefix}静止（需要水车驱动）`;
    return `⚙️ ${name} · ${prefix}转速 ${WHEEL_RPM} RPM · 应力 ${c.load}/${c.capacity}`;
}

// ==================== 终端机器（粉碎轮 / 机械锯，后续提交落地） ====================
function updateCrushers(dt) { void dt; }

function updateSaws(dt) { void dt; }

// ==================== 外部兜底 ====================
// 该格机器进度作废（方块被破坏/读档时；由 breakKineticAt / initKinetic 调用）
function dropMachineProgressAt(x, y, z) {
    // 粉碎/锯进度表在阶段二 Commit B/C 落地时填充
    void x; void y; void z;
}

// 读档/开新世界后调用：清机器进度并重算全网（派生态不存档，现场恢复）
export function initKinetic() {
    dropAllMachineProgress();
    updateKineticNetwork();
}

function dropAllMachineProgress() {
    // 同上，Commit B/C 填充
}
