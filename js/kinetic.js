// ==================== kinetic.js ====================
// 有状态方块「动力组」（水车/传动轴/齿轮/粉碎轮/机械锯 + 离合器）的高层逻辑，分层与 redstone.js /
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
//   离合器（Create-lite L1）串在轴中间当红石开关：断开（engaged=0）时动力传不过去——
//   下游停转、水车侧照转；engaged 由红石网络按电平语义回写（见 redstone.js 末段）。
//   传送带（L1 链 2）是贴顶面的静止薄板（solid false）：带↔带相邻与带↔动力邻接
//   （四邻水平 + 上下格）都进同一分量传导（对称边），但带边打 beltEdge 标记——
//   方向/转向 BFS 不穿越（相位绝缘，防两条独立产线经带桥被误判卡死）；每格带计入
//   应力负载 BELT_SU_LOAD。带上的物品转运（carried）在 js/items.js、玩家骑带在
//   js/playerPhysics.js，本模块只负责求解与 isBeltRunningAt 查询。
//   投料器（L1 链 3）是 solid 动力块，邻接照机械锯——正面（朝向邻格）是被投目标不
//   传动、只有背面接传动；负载 DEPLOYER_SU_LOAD/台。通电后每 DEPLOYER_SEC 秒把捕获
//   三格 {朝向格 T, T+up, 头顶 D+up} 里的可放置方块物品变回方块塞进 T（守卫全套与
//   帧末聚合见下方 updateDeployers），是「粉碎→产出→回流→再投料」无人值守闭环的钥匙。
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
    BELT_ITEM_ID,
    BELT_SPEED,
    BELT_SU_LOAD,
    BlockInfo,
    BlockTypes,
    CHUNK_SIZE,
    CLUTCH_ITEM_ID,
    COGWHEEL_ITEM_ID,
    CRUSH_SEC,
    CRUSHER_ITEM_ID,
    CRUSHER_SU_LOAD,
    DEPLOYER_ITEM_ID,
    DEPLOYER_SEC,
    DEPLOYER_SU_LOAD,
    FACING_NORMALS,
    KINETIC_RECIPES,
    KINETIC_SPIN_VIS,
    LIFT_SPEED,
    PLATFORM_BASE,
    PLATFORM_ITEM_ID,
    PLATFORM_SU_LOAD,
    PLAYER_HEIGHT,
    PLAYER_WIDTH,
    PULLEY_ITEM_ID,
    PULLEY_ROPE_MAX,
    PULLEY_SU_LOAD,
    SAW_ITEM_ID,
    SAW_SPEED,
    SAW_SU_LOAD,
    SHAFT_ITEM_ID,
    WATERWHEEL_ITEM_ID,
    WHEEL_RPM,
    WHEEL_SU_CAPACITY,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    beltId,
    clutchEngaged,
    clutchId,
    cogAxis,
    cogId,
    crusherAxis,
    crusherId,
    deployerFacing,
    deployerId,
    isBeltId,
    isClutchId,
    isCogId,
    isCrusherId,
    isDeployerId,
    isDoorId,
    isKineticId,
    isPlatformId,
    isPistonGroupId,
    isPistonHeadId,
    isPulleyId,
    isRedstoneId,
    isSawId,
    isShaftId,
    isToolId,
    isWaterwheelId,
    kineticAxisOf,
    kineticItemId,
    pulleyId,
    pulleyPowered,
    pulleyUp,
    sawFacing,
    sawId,
    shaftAxis,
    shaftId,
    waterwheelAxis,
    waterwheelId,
} from './config.js';
import { isCreative, state } from './state.js';
import { getBlock, setBlockSafe } from './world.js';
import { isCustomMesh, isSolid, refreshPropAt, rebuildChunk } from './chunk.js';
import { popUnsupportedRedstone, updateRedstoneNetwork } from './redstone.js';
import { carryRiders } from './piston.js'; // L2 滑轮电梯：平台跨格载客（电梯 T1 导出）；piston↔kinetic 双向运行时循环照 redstone↔piston 先例安全
import { spawnBreakParticles } from './particles.js';
import { playBlockSound, playCrushSound, playSawSound } from './audio.js';
import { spawnItemDrop } from './items.js';
import { facingFromYaw } from './door.js';
import { scene } from './engine.js'; // 消耗物品实体时 scene.remove（items.js 的 removeDrop 未导出，等价公开操作）

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
let crusherCells = []; // 配对成功的粉碎轮（机器 tick 与负载统计用）
const crusherPaired = new Set(); // 配对粉碎轮 key 集（投料口校验/HUD 未配对提示用）
let sawCells = []; // 全部机械锯（锯切 tick 用）
let deployerCells = []; // 全部投料器（Create-lite L1 链 3，投放 tick 用）
const deployerCool = new Map(); // 投料器 key -> 剩余冷却秒（照 crushProgress 模式，重算兜底清理）
let pulleyCells = []; // 全部滑轮（Create-lite L2 电梯，升降 tick 用）
let pulleyBinds = new Map(); // 滑轮 key -> { px,py,pz } 绑定的平台格（纯派生：事件重算全量重建 + 跨格本地同步，plan §3.1）
const pulleyState = new Map(); // 滑轮 key -> { phase, blocked } 跨格节拍与端点态（照 crushProgress 模式）

// front-blocked 方块（机械锯/投料器/滑轮）的正面朝向向量：正面（朝向邻格）是工作目标不参与传动，
// 只有「本格正好在它背面」才接通（neighborsOf 统一按 front 特判——投料器照锯，滑轮照两者，
// plan §3.1）
function frontNormalOf(id) {
    if (isSawId(id)) return FACING_NORMALS[sawFacing(id)];
    if (isDeployerId(id)) return FACING_NORMALS[deployerFacing(id)];
    if (isPulleyId(id)) return FACING_NORMALS[pulleyUp(id) ? 0 : 1]; // 0=朝上顶举 / 1=朝下垂挂
    return null;
}

// ==================== 放置 ====================
// 轴类方块朝所点击面的法线方向放置（点顶面 = 立轴，贴墙 = 横轴垂直墙面）；
// 机械锯朝向 = 被锯方块方向（复用活塞的贴面朝向规则）；离合器照轴定轴向、
// 初始 engaged=1（接合）直落——放进充能位会被随后的红石重算翻到断开（电平语义自愈）；
// 传送带贴实心方块顶面（照红石粉/压力板），带向 = 玩家水平朝向量化四向（door.js facingFromYaw）。
// 返回 null = 成功。
export function placeKinetic(bx, by, bz, itemId, face) {
    if (bx < 0 || bx >= WORLD_WIDTH || by < 0 || by >= WORLD_HEIGHT || bz < 0 || bz >= WORLD_DEPTH) {
        return '❌ 超出世界边界';
    }
    let id;
    if (itemId === BELT_ITEM_ID) {
        if (!isSolid(getBlock(bx, by - 1, bz))) return '❌ 传送带需要放在实心方块的顶面';
        id = beltId(facingFromYaw(state.player.yaw));
    } else if (itemId === SAW_ITEM_ID) {
        id = sawId(facingFromNormalLocal(face.dx, face.dy, face.dz));
    } else if (itemId === DEPLOYER_ITEM_ID) {
        // 投料器朝向 = 所点击面的外法线（照锯/活塞：贴着目标面放，面向「要投料的位置」）
        id = deployerId(facingFromNormalLocal(face.dx, face.dy, face.dz));
    } else if (itemId === PULLEY_ITEM_ID) {
        // 滑轮（L2 电梯）：点击面法线须竖直——点方块底面 = 朝下垂挂、点顶面 = 朝上顶举；
        // 初始 powered=0（放绳态），放进充能位由随后的红石重算电平自愈（照离合器先例）
        if (face.dy === 0) return '❌ 滑轮需要贴顶面或底面（绳竖直）';
        id = pulleyId(face.dy > 0, false);
    } else if (itemId === PLATFORM_ITEM_ID) {
        id = PLATFORM_BASE; // 电梯平台：普通实心立方体，任意空格可放（可当建材）
    } else {
        const axis = normalAxis(face.dx, face.dy, face.dz);
        id = itemId === SHAFT_ITEM_ID ? shaftId(axis)
            : itemId === COGWHEEL_ITEM_ID ? cogId(axis)
                : itemId === WATERWHEEL_ITEM_ID ? waterwheelId(axis)
                    : itemId === CLUTCH_ITEM_ID ? clutchId(axis, 1)
                        : crusherId(axis);
    }
    setBlockSafe(bx, by, bz, id);
    refreshPropAt(bx, by, bz);
    // 离合器：先重算红石建立 engaged 电平基线（放进充能位会在同一次重算中翻到断开；
    // 翻转时红石侧的电平写出门会带起一次动力重算），再常规重算动力拓扑。
    // 滑轮同款：放进充能位重算翻到卷绳变体（不触发动力重算）
    if (isClutchId(id) || isPulleyId(id)) updateRedstoneNetwork();
    updateKineticNetwork();
    if (isPulleyId(id)) updateRopeVisual({ x: bx, y: by, z: bz, id }); // 绳长按绑定即时校正
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
                // 空气早退（2026-09-06 世界扩容后空气中格占大头，一次比较替掉 isKineticId 多区间判断）
                if (id === 0) continue;
                if (!isKineticId(id)) continue;
                cells.push({ x, y, z, id, axis: kineticAxisOf(id), saw: isSawId(id), front: frontNormalOf(id) });
            }
        }
    }

    // 水车产能判定：顶面接触静态水（湖/海里泡着转；创造模式可放置 WATER 自由选址）
    for (const c of cells) {
        if (isWaterwheelId(c.id)) c.powered = getBlock(c.x, c.y + 1, c.z) === BlockTypes.WATER;
    }

    // 粉碎轮配对：水平相邻两轮、轴向相同、连线方向垂直于该轴（单只不成对 = 无功能不计负载）
    crusherCells = [];
    crusherPaired.clear();
    for (const c of cells) {
        if (!isCrusherId(c.id)) continue;
        for (const [dx, dz] of HORIZ_DIRS) {
            const nid = getBlock(c.x + dx, c.y, c.z + dz);
            if (!isCrusherId(nid) || crusherAxis(nid) !== c.axis) continue;
            if ((dx !== 0 ? AXIS_X : AXIS_Z) !== c.axis) {
                crusherPaired.add(keyOf(c.x, c.y, c.z));
                crusherCells.push(c);
                break;
            }
        }
    }
    sawCells = cells.filter((c) => c.saw);
    deployerCells = cells.filter((c) => isDeployerId(c.id));

    // 滑轮绳绑定扫描（Create-lite L2 电梯，plan §3.1）：沿朝向逐格扫（≤PULLEY_ROPE_MAX），
    // AIR/WATER 都是绳格（水可穿：水下电梯彩蛋，差异 7）；第一个平台即绑定（先扫描先得，
    // 唯一绑定——双滑轮夹同一平台时后来者视作挡绳未绑定，防双向拉抖动，差异 8）；
    // 其他方块挡绳 = 未绑定（HUD「未找到平台」）。绑定纯派生：本函数全量重建 +
    // updatePulleys 跨格时本地同步（跨格零动力重算，G2 裁决 R4-01）。
    pulleyCells = cells.filter((c) => isPulleyId(c.id));
    pulleyBinds = new Map();
    const boundPlatforms = new Set();
    for (const c of pulleyCells) {
        const dy = pulleyUp(c.id) ? 1 : -1;
        for (let s = 1; s <= PULLEY_ROPE_MAX; s++) {
            const ry = c.y + dy * s;
            if (ry < 0 || ry >= WORLD_HEIGHT) break;
            const rb = getBlock(c.x, ry, c.z);
            // 绳格：AIR/水/贴面道具（薄板悬在格缘，细绳从格中心穿过——平台顶贴着红石粉
            // 不该断绳，否则「跨格→支撑消失→粉脱落」链永远不触发，N13）；**移动前方格
            // 判定不含贴面**（平台面宽，贴面道具挡行程=端点停不压碎，保护语义）
            if (rb === BlockTypes.AIR || rb === BlockTypes.WATER || isCustomMesh(rb)) continue;
            const rk = keyOf(c.x, ry, c.z);
            if (isPlatformId(rb) && !boundPlatforms.has(rk)) {
                pulleyBinds.set(keyOf(c.x, c.y, c.z), { px: c.x, py: ry, pz: c.z });
                boundPlatforms.add(rk);
            }
            break; // 实心挡绳 / 平台已被先扫的滑轮绑定
        }
    }

    const byKey = new Map(cells.map((c) => [keyOf(c.x, c.y, c.z), c]));
    const newMap = new Map();
    const comps = [];
    const visited = new Set();
    for (const seed of cells) {
        // 电梯平台不当种子（L2）：它是纯被动格（neighborsOf 不外延），归属完全由滑轮侧的
        // 绳绑定边决定——y 主序扫描平台先于滑轮，若自己当种子会吸收成独立分量，滑轮的
        // 单向绑定边被全局 visited 吞掉（应力丢平台的 PLATFORM_SU_LOAD，L1 R1-01 同款单向
        // 边坑）。未被绑定的平台无分量：HUD 显示静止，无副作用
        if (isPlatformId(seed.id)) continue;
        const seedKey = keyOf(seed.x, seed.y, seed.z);
        if (visited.has(seedKey)) continue;

        // 1) 连通性 BFS 收集成员（邻接的闭包即分量）
        const members = [];
        const queue = [seed];
        visited.add(seedKey);
        while (queue.length > 0) {
            const c = queue.pop();
            members.push(c);
            for (const { other } of neighborsOf(c, byKey)) {
                const k = keyOf(other.x, other.y, other.z);
                if (visited.has(k)) continue;
                visited.add(k);
                queue.push(other);
            }
        }

        // 2) 应力统计：容量 = Σ有水水车×64；负载 = Σ配对粉碎轮×32 + Σ锯×24 + Σ带×4 +
        //    Σ投料器×16（传动轴与离合器是纯传动件不计负载，CLUTCH_SU_LOAD=0；带是分量内全部带格计数）
        let capacity = 0, load = 0, wheels = 0, poweredWheels = 0;
        for (const c of members) {
            if (isWaterwheelId(c.id)) {
                wheels++;
                if (c.powered) {
                    poweredWheels++;
                    capacity += WHEEL_SU_CAPACITY;
                }
            } else if (isBeltId(c.id)) {
                load += BELT_SU_LOAD;
            } else if (isPlatformId(c.id)) {
                load += PLATFORM_SU_LOAD; // 平台 8/格（绳绑定边进滑轮分量，差异 9）
            } else if (isCrusherId(c.id) && crusherPaired.has(keyOf(c.x, c.y, c.z))) {
                load += CRUSHER_SU_LOAD;
            } else if (isSawId(c.id)) {
                load += SAW_SU_LOAD;
            } else if (isDeployerId(c.id)) {
                load += DEPLOYER_SU_LOAD;
            } else if (isPulleyId(c.id) && pulleyBinds.has(keyOf(c.x, c.y, c.z))) {
                load += PULLEY_SU_LOAD; // 已绑定滑轮 32/台（未绑定不计，照「配对粉碎轮」先例）
            }
        }

        // 3) 转向传播：从第一台有水的水车出发（多水车不加速、方向以它为准），
        //    同轴传向不变、啮合翻转；同一格被相反转向到达，或有水水车被反向到达
        //    （水车的转向由水固定，两路传动冲突）= 卡死，整网停转。
        //    相位绝缘（G2 裁决 R1-01/R2-01）：带边（beltEdge）不穿越——带格不参与
        //    转向/卡死判定（带自身无转向语义），两条独立产线经带桥接不会被误判卡死合并
        let jammed = false;
        const dirMap = new Map();
        const src = members.find((c) => c.powered);
        if (src) {
            dirMap.set(keyOf(src.x, src.y, src.z), 1);
            const dq = [{ c: src, dir: 1 }];
            let qi = 0;
            while (qi < dq.length) {
                const { c, dir } = dq[qi++];
                for (const { other, mesh, beltEdge } of neighborsOf(c, byKey)) {
                    if (beltEdge) continue; // 带边绝缘：方向/卡死 BFS 不穿越
                    const nd = mesh ? -dir : dir;
                    const k = keyOf(other.x, other.y, other.z);
                    const prev = dirMap.get(k);
                    if (prev === undefined) {
                        dirMap.set(k, nd);
                        dq.push({ c: other, dir: nd });
                        if (other.powered && nd !== 1) jammed = true; // 水车被反向驱动
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

    // 机器进度兜底：机器被活塞推走/配对解除后，旧格子的进度 key 不再属于任何机器，清掉
    for (const k of crushProgress.keys()) if (!crusherPaired.has(k)) crushProgress.delete(k);
    const sawKeys = new Set(sawCells.map((c) => keyOf(c.x, c.y, c.z)));
    for (const k of sawProgress.keys()) if (!sawKeys.has(k)) sawProgress.delete(k);
    const deployerKeys = new Set(deployerCells.map((c) => keyOf(c.x, c.y, c.z)));
    for (const k of deployerCool.keys()) if (!deployerKeys.has(k)) deployerCool.delete(k);
    const pulleyKeys = new Set(pulleyCells.map((c) => keyOf(c.x, c.y, c.z)));
    for (const k of pulleyState.keys()) if (!pulleyKeys.has(k)) pulleyState.delete(k);
}

// 邻接枚举：同轴相邻（沿轴向连线；锯只从背面接，正面是被锯目标）+ 齿轮垂直啮合 +
// 粉碎轮配对（成对两轮本身就是一对啮合的轮：单驱任意一只，两只都反转着碾）。
// yield { other, mesh, beltEdge }：mesh = true 表示这是啮合边（转向翻转）；
// beltEdge = true 表示这是带相关边（带↔带 / 带↔动力）——连通性 BFS 照走（同分量：
// 应力归属合并），但方向/卡死 BFS 不穿越（相位绝缘：带只传播转/停与应力，不传播转向
// 符号与冲突，防两条独立产线经带桥接被误判卡死合并——G2 裁决 R1-01/R2-01）。
// 离合器（Create-lite L1）同轴相邻照轴传动，但 engaged=0（断开）时：自身不外延任何
// 传动边、且作为 other 时不可被跨过——BFS 遇断开离合器，该格仍是分量成员（可被应力
// 统计/HUD 查询）但动力传不过去，水车侧照转、下游静止。
// 传送带（链 2）：带↔动力为对称边——带侧与动力侧双向枚举同一组邻接对
// （带的四邻水平格 + 上下格），否则全局 visited BFS 下任一侧先被扫到都会把对向
// 掉进另一个分量（y/z/x 主序扫描时「轴在带的东侧/南侧」恰是带先种子——N09 锁定）。
function* neighborsOf(c, byKey) {
    if (isPlatformId(c.id)) {
        // 电梯平台（L2）：被动载荷，不外延任何传动边——只被滑轮侧的绳绑定边单向枚举
        // （绳绑定边打 beltEdge 绝缘标记：平台进滑轮分量=应力合并，但不参与转向/卡死传播）
        return;
    }
    if (isPulleyId(c.id)) {
        // 滑轮：绳绑定边（模块级 pulleyBinds，求解循环先建后用）——沿 Y 轴向传动照下方
        // 通用分支（front-blocked：正面=绳出口被 front 排除、背面接轴）
        const bind = pulleyBinds.get(keyOf(c.x, c.y, c.z));
        if (bind) {
            const other = byKey.get(keyOf(bind.px, bind.py, bind.pz));
            if (other) yield { other, mesh: false, beltEdge: true };
        }
        // 背面跨轴接传动：贴「横轴顶面」放置的朝上滑轮，其背面是横轴（AXIS_X/Z）——
        // 通用轴向分支只认同轴会漏接（E06 实证）。方案语义是「背面接传动」而非「背面接同轴」，
        // 故背面格是任意动力族（非带）即连通；同轴竖轴情形仍由通用分支覆盖（visited 防重）
        const [pfx, pfy, pfz] = FACING_NORMALS[pulleyUp(c.id) ? 0 : 1];
        const back = byKey.get(keyOf(c.x - pfx, c.y - pfy, c.z - pfz));
        if (back && !isBeltId(back.id)) yield { other: back, mesh: false };
    }
    if (isBeltId(c.id)) {
        // 带侧专属分支（不读 c.axis，带无传动轴）：四邻水平格 + 上下格里的动力族格
        // 都是同分量邻接（带↔带传导 = 整条带单点驱动的离散版，差异 9；带↔动力接入）
        for (const [dx, dz] of HORIZ_DIRS) {
            const other = byKey.get(keyOf(c.x + dx, c.y, c.z + dz));
            if (other) yield { other, mesh: false, beltEdge: true };
        }
        for (const dy of [-1, 1]) {
            const other = byKey.get(keyOf(c.x, c.y + dy, c.z));
            if (other) yield { other, mesh: false, beltEdge: true };
        }
        return;
    }
    if (isClutchId(c.id) && clutchEngaged(c.id) === 0) return; // 断开的离合器不外延传动边
    for (const dir of [-1, 1]) {
        const [ax, ay, az] = AXIS_DIRS[c.axis];
        const nx = c.x + ax * dir, ny = c.y + ay * dir, nz = c.z + az * dir;
        const other = byKey.get(keyOf(nx, ny, nz));
        if (!other) continue;
        if (isClutchId(other.id) && clutchEngaged(other.id) === 0) continue; // 对方断开：不可被跨过
        if (c.front) {
            // front-blocked 方块（锯/投料器）的正面（朝向邻格）是工作目标，不参与传动
            if (nx === c.x + c.front[0] && ny === c.y + c.front[1] && nz === c.z + c.front[2]) continue;
        }
        if (other.front) {
            // 对方是锯/投料器：只有本格正好在它背面时才接通
            if (other.x - other.front[0] === c.x && other.y - other.front[1] === c.y && other.z - other.front[2] === c.z) yield { other, mesh: false };
            continue;
        }
        if (other.axis === c.axis) yield { other, mesh: false }; // 带的 axis 为 null，不会走进同轴分支
    }
    // 齿轮啮合：相邻格是齿轮、两轴垂直、连线方向沿两者之一的轴（一以轮面贴、一以轮齿咬）
    if (isCogId(c.id)) {
        for (const [fx, fy, fz] of FACING_NORMALS) {
            const other = byKey.get(keyOf(c.x + fx, c.y + fy, c.z + fz));
            if (!other || !isCogId(other.id) || other.axis === c.axis) continue;
            const dirAxis = fx !== 0 ? AXIS_X : fy !== 0 ? AXIS_Y : AXIS_Z;
            if (dirAxis === c.axis || dirAxis === other.axis) yield { other, mesh: true };
        }
        // （原此处的 return 移除：isCogId 与 isCrusherId 互斥，继续走到下方带补充枚举）
    }
    // 粉碎轮配对边：水平相邻、同轴、连线垂直于轴（与 updateKineticNetwork 的配对判定同规则）
    if (isCrusherId(c.id)) {
        for (const [dx, dz] of HORIZ_DIRS) {
            if ((dx !== 0 ? AXIS_X : AXIS_Z) === c.axis) continue; // 连线沿轴 = 普通同轴传动，上面已处理
            const other = byKey.get(keyOf(c.x + dx, c.y, c.z + dz));
            if (other && isCrusherId(other.id) && other.axis === c.axis) yield { other, mesh: true };
        }
    }
    // 动力侧对向枚举（对称边的动力侧，G2 裁决 R1-01/R2-01）：四邻水平格 + 上下格是带 →
    // 与带同分量。补在既有轴向逻辑之外，不破坏上面的轴类邻接；没有这一侧，y/z/x 主序
    // 扫描下先建分量的动力格吸收不到后来种子的带（visited 单向边缺陷）
    for (const [dx, dz] of HORIZ_DIRS) {
        const other = byKey.get(keyOf(c.x + dx, c.y, c.z + dz));
        if (other && isBeltId(other.id)) yield { other, mesh: false, beltEdge: true };
    }
    for (const dy of [-1, 1]) {
        const other = byKey.get(keyOf(c.x, c.y + dy, c.z));
        if (other && isBeltId(other.id)) yield { other, mesh: false, beltEdge: true };
    }
    // 滑轮背面接传动的动力侧对向枚举（同款对称边闭合，L2 E05 实证）：上下格是滑轮且其
    // 背面正对本格 → 接通。没有这一侧，轴链被先种子的分量吸走后，后种子的滑轮会孤立成
    // 无动力分量（visited 单向边缺陷与带同构）——滑轮侧的单向背面边在 neighborsOf 开头
    for (const dy of [-1, 1]) {
        const other = byKey.get(keyOf(c.x, c.y + dy, c.z));
        if (!other || !isPulleyId(other.id)) continue;
        const [pfx, pfy, pfz] = FACING_NORMALS[pulleyUp(other.id) ? 0 : 1];
        if (c.x === other.x - pfx && c.y === other.y - pfy && c.z === other.z - pfz) {
            yield { other, mesh: false };
        }
    }
}

// ==================== 每帧驱动 ====================
// 旋转动画（零区块重建）+ 终端机器计时（粉碎/锯切/投料，见文末）。
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
    updateDeployers(dt);
    updatePulleys(dt);
}

// ==================== 外部查询（HUD / 交互提示用） ====================
// 准星对准动力方块时的状态文案；非动力方块返回 null。
// 该格传送带是否正在运转（查 kineticMap 派生态 + 分量 running）——js/items.js 的
// carried 判定与 js/playerPhysics.js 的玩家骑带共用（链 2 对既有模块的唯一新增导出）。
export function isBeltRunningAt(x, y, z) {
    const entry = kineticMap.get(keyOf(x, y, z));
    if (!entry) return false;
    const comp = components[entry.compId];
    return !!comp && comp.running;
}

export function kineticStatusAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isKineticId(id)) return null;
    const name = BlockInfo[id]?.name || '动力方块';
    // 离合器断开：优先提示断开态（断开后自成无动力分量，常规文案会误报「需要水车驱动」）
    if (isClutchId(id) && clutchEngaged(id) === 0) return `⚙️ ${name} · 断开（红石充能中，传动已切断）`;
    // 滑轮（L2 电梯）：未绑定/端点/悬停优先于常规文案（方向词写明防与离合器心智混淆，G2 R3-04）
    if (isPulleyId(id)) {
        const pk = kineticMap.get(keyOf(x, y, z));
        const pc = pk && components[pk.compId];
        if (!pulleyBinds.has(keyOf(x, y, z))) return `⚙️ ${name} · 未找到平台（${pulleyUp(id) ? '上方' : '下方'} ${PULLEY_ROPE_MAX} 格内需有电梯平台）`;
        // 全网态（卡死/过载/无动力）优先于端点提示（全网停转的因果更该先说；端点是运行时缓存）
        const dirTxt = pulleyPowered(id) ? (pulleyUp(id) ? '卷绳·平台下降' : '卷绳·平台上升') : (pulleyUp(id) ? '放绳·平台上升' : '放绳·平台下降');
        if (!pc) return `⚙️ ${name} · ${dirTxt} · 静止`;
        if (pc.jammed) return `⚙️ ${name} · ${dirTxt} · ⛔ 卡死（传动转向冲突）`;
        if (pc.overstressed) return `⚙️ ${name} · ${dirTxt} · ⛔ 过载（应力 ${pc.load}/${pc.capacity}，再加一台水车）`;
        if (pc.poweredWheels === 0) return `⚙️ ${name} · ${dirTxt} · 悬停（需要水车驱动）`;
        const st = pulleyState.get(keyOf(x, y, z));
        if (st?.blocked) return `⚙️ ${name} · 已到行程端点（平台停住，滑轮空转）`;
        return `⚙️ ${name} · ${dirTxt} · 升降 ${LIFT_SPEED} 格/秒 · 应力 ${pc.load}/${pc.capacity}`;
    }
    // 传送带：带本身是静止薄板，文案按运转/静止 + 应力报（差异 4：物品移动即方向反馈）
    if (isBeltId(id)) {
        const bk = kineticMap.get(keyOf(x, y, z));
        const bc = bk && components[bk.compId];
        if (!bc) return `⚙️ ${name} · 静止`;
        if (bc.jammed) return `⚙️ ${name} · ⛔ 卡死（传动转向冲突）`;
        if (bc.overstressed) return `⚙️ ${name} · ⛔ 过载（应力 ${bc.load}/${bc.capacity}，再加一台水车）`;
        if (bc.poweredWheels === 0) return `⚙️ ${name} · 静止（需要水车驱动）`;
        return `⚙️ ${name} · 运转中 · 带速 ${BELT_SPEED} 格/秒 · 应力 ${bc.load}/${bc.capacity}`;
    }
    const k = kineticMap.get(keyOf(x, y, z));
    const c = k && components[k.compId];
    let prefix = isCrusherId(id) && !crusherPaired.has(keyOf(x, y, z)) ? '未配对 · ' : '';
    if (isClutchId(id)) prefix += '接合 · ';
    if (!c) return `⚙️ ${name} · ${prefix}静止`;
    if (c.jammed) return `⚙️ ${name} · ${prefix}⛔ 卡死（传动转向冲突）`;
    if (c.overstressed) return `⚙️ ${name} · ${prefix}⛔ 过载（应力 ${c.load}/${c.capacity}，再加一台水车）`;
    if (c.poweredWheels === 0) return `⚙️ ${name} · ${prefix}静止（需要水车驱动）`;
    // 投料器：运转态附投料节拍（0.5s/次把捕获格物品变方块塞进朝向格，链 3 闭环的钥匙）
    const suffix = isDeployerId(id) ? ` · 投料节拍 ${DEPLOYER_SEC}s` : '';
    return `⚙️ ${name} · ${prefix}转速 ${WHEEL_RPM} RPM · 应力 ${c.load}/${c.capacity}${suffix}`;
}

// ==================== 终端机器 A：粉碎轮 ====================
// 配对粉碎轮的正上方格 = 投料口（玩家右键把方块「放置」进去，零新交互）。
// 网络正常转动 + 投料口有可粉碎方块 → CRUSH_SEC 秒倒计时（粒子点缀）→ 方块消失，
// 按配方表产出物品实体弹出（js/items.js）。无玩家在场照常工作。
// 网络停转（过载/卡死/断水）时进度冻结；投料被换走则进度作废。
const crushProgress = new Map(); // 粉碎轮 key -> { input, t, fx }

function updateCrushers(dt) {
    for (const c of crusherCells) {
        const k = keyOf(c.x, c.y, c.z);
        const comp = componentAt(k);
        const ix = c.x, iy = c.y + 1, iz = c.z; // 投料口
        const input = getBlock(ix, iy, iz);
        const pr = crushProgress.get(k);
        if (!comp?.running || !(input in KINETIC_RECIPES)) {
            if (pr && pr.input !== input) crushProgress.delete(k); // 换料作废；停机冻结
            continue;
        }
        let e = pr;
        if (!e || e.input !== input) {
            e = { input, t: 0, fx: 0 };
            crushProgress.set(k, e);
        }
        e.t += dt;
        e.fx += dt;
        if (e.fx > 0.45) {
            e.fx = 0;
            spawnBreakParticles(ix, iy, iz, input); // 碾碎中的碎屑点缀
        }
        if (e.t < CRUSH_SEC) continue;
        crushProgress.delete(k);
        setBlockSafe(ix, iy, iz, BlockTypes.AIR);
        rebuildChunk(Math.floor(ix / CHUNK_SIZE), Math.floor(iz / CHUNK_SIZE));
        // 投料方块上贴着的红石元件失去支撑，连锁脱落
        for (const cc of popUnsupportedRedstone(ix, iy, iz)) {
            spawnBreakParticles(cc.x, cc.y, cc.z, cc.id);
            rebuildChunk(Math.floor(cc.x / CHUNK_SIZE), Math.floor(cc.z / CHUNK_SIZE));
        }
        const recipe = KINETIC_RECIPES[input];
        spawnItemDrop(ix + 0.5, iy + 0.3, iz + 0.5, recipe.item, recipe.count);
        playCrushSound();
    }
}

// 投料口放置校验（interaction.js 放置分支调用）：目标格是配对粉碎轮的正上方、
// 且所放方块不在配方表 → 返回错误提示（推荐方案：投不进去，别让玩家白放）。
// 水放行（造水景常见动作，不算投料）。
export function crusherIntakeError(bx, by, bz, itemId) {
    const below = getBlock(bx, by - 1, bz);
    if (!isCrusherId(below) || !crusherPaired.has(keyOf(bx, by - 1, bz))) return null;
    if (itemId === BlockTypes.WATER || itemId in KINETIC_RECIPES) return null;
    return '❌ 这个方块不能粉碎（可投：石头/圆石/沙砾/玻璃/原木/树干）';
}

// 该格动力分量（无/未注册返回 null）
function componentAt(k) {
    const entry = kineticMap.get(k);
    return entry ? components[entry.compId] : null;
}

// ==================== 终端机器 B：机械锯 ====================
// 朝向格（SAW 的 facing 邻格）有可锯方块且网络正常 → 按挖掘公式推进：
// 耗时 = hardness × 1.5 ÷ SAW_SPEED（等效铁镐，不吃玩家的水中/悬空惩罚）。
// 完成 → 方块消失 + 掉落映射照原版（石头→圆石）；原木/树干特例 → 木板×4（锯切转换）。
// 朝向格变化（被挖/被推/变空气）→ 进度重置；挖完不自动寻找下一个目标；
// 进度表现用粒子+音效节拍（玩家的裂纹 overlay 绑定准星，不复用）。
const sawProgress = new Map(); // 机械锯 key -> { target, t, fx }

function updateSaws(dt) {
    for (const c of sawCells) {
        const k = keyOf(c.x, c.y, c.z);
        const comp = componentAt(k);
        const [fx, fy, fz] = FACING_NORMALS[sawFacing(c.id)];
        const tx = c.x + fx, ty = c.y + fy, tz = c.z + fz; // 锯切目标 = 朝向邻格
        const target = getBlock(tx, ty, tz);
        const pr = sawProgress.get(k);
        if (!comp?.running || !isSawable(target)) {
            if (pr && pr.target !== target) sawProgress.delete(k); // 换目标作废；停机冻结
            continue;
        }
        let e = pr;
        if (!e || e.target !== target) {
            e = { target, t: 0, fx: 0 };
            sawProgress.set(k, e);
        }
        e.t += dt;
        e.fx += dt;
        if (e.fx > 0.45) {
            e.fx = 0;
            spawnBreakParticles(tx, ty, tz, target); // 锯切木屑
            playSawSound();
        }
        if (e.t < sawSeconds(target)) continue;
        sawProgress.delete(k);
        finishSaw(tx, ty, tz, target);
    }
}

// 可锯目标：普通实心立方体（customMesh 的门/红石/活塞/动力道具走各自破坏逻辑，锯不动），
// 硬度 < 0（基岩）不可锯
function isSawable(id) {
    if (id === BlockTypes.AIR || id === BlockTypes.WATER) return false;
    const info = BlockInfo[id];
    if (!info) return false;
    if (info.customMesh) return false;
    return (info.hardness ?? 0) >= 0;
}

function sawSeconds(id) {
    return Math.max(0.05, (BlockInfo[id]?.hardness ?? 0) * 1.5 / SAW_SPEED);
}

// ==================== 终端机器 C：投料器（Create-lite L1 链 3）====================
// 部署器-lite：只做「放置」动词（plan §5 差异 5）。通电分量里的投料器每 DEPLOYER_SEC 秒
// 扫描捕获三格 {T=朝向格, T+up, D+up=投料器头顶} 内的物品实体（feet 探针 = floor(y-0.15)，
// 与 items.js 落地公式同源——静止物只会停在这三格：产出回流在 T、带送落料在 D+up，差异 10），
// 把第一个通过全套守卫的「可放置方块物品」变回方块塞进 T（count>1 减一保留实体）：
//   ① 可放置方块域：BlockInfo 注册 && 非 item 材料/食物 && 非工具 && 非 customMesh 贴面道具
//     （直放贴面道具会产出无支撑红石/半扇门等非法状态，差异 11；水可投——水车选址彩蛋）
//   ② T 界内（防界外格 getBlock=AIR 骗过守卫而 setBlockSafe 越界 no-op 的「静默销毁机」，N10）
//   ③ T 为 AIR 或 WATER（被占 = 跳过不消耗，冷却照走等待清空，E08）
//   ④ 水投水排除（N21）⑤ crusherIntakeError(T, itemId) 为空（投料口不收配方外方块，N16）
//   ⑥ T 不与玩家 AABB（照 placeBlock 先例）/怪物 AABB（照 piston.js 格内实体查找）重叠（差异 14）
// 停转（断水/过载/离合器断开）冷却冻结不动；未命中目标冷却保持 0（T 一空立即投）。
//
// 性能守卫（G2 裁决 R4-02/03——必然而非可选：D=10 台持续供料若无守卫会超性能门 5 倍）：
//   · 动力重算仅当投的是 WATER（普通方块不改动力图——水车供电判定读世界，水是唯一例外）；
//   · 红石重算仅当 T 的切比雪夫距离 2 内（5×5×5=125 格扫描）存在红石网络关心的方块；
//   · 帧末聚合：迭代循环内只置 dirty 标志 + 收集待重建区块（去重），循环结束后统一
//     重算一次 + rebuildChunk——消除 D 台同帧风暴与嵌套重算。
// 【不变量】迭代循环内绝不调用 updateKineticNetwork/updateRedstoneNetwork/rebuildChunk：
//   重算会整体 rebind deployerCells（cells 数组重建），正在遍历的引用全部作废（R4-06）。
function updateDeployers(dt) {
    if (deployerCells.length === 0 || state.itemDrops.length === 0) return; // 快速出零
    const chunksToRebuild = new Set();
    let redstoneDirty = false;
    let kineticDirty = false;
    const usedDrops = new Set(); // 本帧已被某台投料器消耗的实体（一帧一实体最多一次，防两台同帧复制消耗）
    for (const c of deployerCells) {
        const k = keyOf(c.x, c.y, c.z);
        const comp = componentAt(k);
        if (!comp || !comp.running) continue; // 分量停转：冷却冻结不动
        const cool = deployerCool.get(k) || 0;
        if (cool > 0) {
            deployerCool.set(k, Math.max(0, cool - dt));
            continue;
        }
        const [fx, fy, fz] = FACING_NORMALS[deployerFacing(c.id)];
        const tx = c.x + fx, ty = c.y + fy, tz = c.z + fz; // T = 朝向格
        const capT = keyOf(tx, ty, tz), capTU = keyOf(tx, ty + 1, tz), capD = keyOf(c.x, c.y + 1, c.z);
        const tIn = tx >= 0 && tx < WORLD_WIDTH && ty >= 0 && ty < WORLD_HEIGHT && tz >= 0 && tz < WORLD_DEPTH;
        if (!tIn) continue; // ② 界外：不扫描不消耗不放置（N10）——守卫与实体无关，前置出循环
        const cur = getBlock(tx, ty, tz);
        if (cur !== BlockTypes.AIR && cur !== BlockTypes.WATER) continue; // ③ T 被占：等待清空（E08）
        let hit = null;
        for (const d of state.itemDrops) {
            if (usedDrops.has(d)) continue;
            // feet 探针 = floor(y - 0.15)，与 items.js 落地公式同源（物品中心离支撑面 0.15）
            const feet = keyOf(Math.floor(d.x), Math.floor(d.y - 0.15), Math.floor(d.z));
            if (feet !== capT && feet !== capTU && feet !== capD) continue;
            if (!isDeployableItem(d.itemId)) continue; // ① 普通方块域（材料/食物/工具/贴面道具忽略）
            if (cur === BlockTypes.WATER && d.itemId === BlockTypes.WATER) continue; // ④ 水投水（N21）
            if (crusherIntakeError(tx, ty, tz, d.itemId)) continue; // ⑤ 投料口守卫（N16）
            if (cellOverlapsEntity(tx, ty, tz)) continue; // ⑥ 玩家/怪物 AABB（差异 14）
            hit = d;
            break; // 找第一个满足全部守卫的实体
        }
        if (!hit) continue; // 无可投目标：冷却保持 0，T 一清空/实体一进捕获格即投
        // 命中：消耗一个 + 放方块；重算/重建副作用只置标志，帧末统一 flush（见上方不变量）
        usedDrops.add(hit);
        hit.count -= 1; // count>1 减一保留实体；count 归 0 帧末移除
        setBlockSafe(tx, ty, tz, hit.itemId);
        markChunksAroundLocal(chunksToRebuild, tx, tz);
        if (hit.itemId === BlockTypes.WATER) kineticDirty = true; // 水例外：可能改变水车顶面供水
        if (!redstoneDirty && hasRedstoneNear(tx, ty, tz)) redstoneDirty = true; // 5×5×5 邻接守卫
        deployerCool.set(k, DEPLOYER_SEC);
    }
    // ---- 帧末聚合 flush：以下全部移出迭代循环（性能守卫第三条）----
    if (usedDrops.size > 0) {
        // 消耗实体：scene.remove + 移出 state.itemDrops（items.js 的 removeDrop 未导出，等价公开操作）
        for (let i = state.itemDrops.length - 1; i >= 0; i--) {
            const d = state.itemDrops[i];
            if (!usedDrops.has(d) || d.count > 0) continue;
            scene.remove(d.mesh);
            state.itemDrops.splice(i, 1);
        }
    }
    if (chunksToRebuild.size > 0) {
        for (const ck of chunksToRebuild) rebuildChunk(Math.floor(ck / 1000), ck % 1000);
    }
    if (redstoneDirty) updateRedstoneNetwork(); // 仅 T 附近有红石才重算（守卫二）
    if (kineticDirty) updateKineticNetwork();   // 仅投水才重算（守卫一）
}

// ==================== 终端机器 D：滑轮电梯（Create-lite L2）====================
// 绳升降（plan §3.2）：通电分量里已绑定的滑轮按方向做跨格节拍（1/LIFT_SPEED 秒一格）——
// powered=1 卷绳（平台向滑轮收拢）/ powered=0 放绳（远离滑轮）；无动力（停转/过载/卡死）
// = 平台悬停（phase 冻结，照「停机冻结」先例）；前方格非 AIR/WATER = 行程端点（平台停住、
// 滑轮照转空转、HUD 提示——差异 4 改判：不 jammed 整网）。
// 跨格提交（G2 裁决四处修订落点）：
//   · 前置校验 getBlock(平台格)===PLATFORM（防同帧其它滑轮/活塞干预下 bind 指向陈旧位置，R1-10）
//   · carryRiders cells = 旧平台格 ∪ 前方格（站顶±带宽载走 + 占据前方格实体同向推开防埋，R1-04）
//   · 旧格调 popUnsupportedRedstone 连锁脱落贴面道具（照活塞推方块先例，R1-03）
//   · **零动力重算**：bind 与 kineticMap 两条目本地同步（跨格不改动力拓扑、应力不变，
//     R4-01——16 台全速 24 跨格/s × 2.65ms 全图重算会超 tick 门近 3 倍；事件重算全量重建收敛）
// 帧末聚合：迭代内只收集区块 + 置 redstoneDirty（hasRedstoneNear 守卫），循环后统一 flush。
// 【不变量】迭代循环内不调 updateKineticNetwork/updateRedstoneNetwork/rebuildChunk（同 updateDeployers）。
function updatePulleys(dt) {
    if (pulleyCells.length === 0) return;
    const chunksToRebuild = new Set();
    let redstoneDirty = false;
    for (const c of pulleyCells) {
        const k = keyOf(c.x, c.y, c.z);
        const comp = componentAt(k);
        if (!comp || !comp.running) continue; // 无动力悬停：phase 冻结（恢复供电续拍）
        const bind = pulleyBinds.get(k);
        if (!bind) continue; // 未绑定空转（HUD「未找到平台」）
        // powered 现读世界（不读快照 c.id）：红石回写 powered 变体刻意不触发动力重算
        // （拓扑不变），快照 ID 会陈旧到下次事件重算——拉杆换向必须即时生效（E02）
        const curId = getBlock(c.x, c.y, c.z);
        if (!isPulleyId(curId)) continue; // 已被破坏/替换：本帧跳过待重算收敛
        const up = pulleyUp(curId);
        const dirY = pulleyPowered(curId) ? (up ? -1 : 1) : (up ? 1 : -1);
        // powered=卷绳：朝下垂挂的平台向上（+1）收拢 / 朝上顶举的平台向下（-1）；放绳反之
        const ny = bind.py + dirY;
        let st = pulleyState.get(k);
        if (ny < 0 || ny >= WORLD_HEIGHT) {
            if (st) st.blocked = true; // 行程端点（世界边界）
            continue;
        }
        const front = getBlock(bind.px, ny, bind.pz);
        const passable = front === BlockTypes.AIR || front === BlockTypes.WATER;
        if (!passable) {
            if (!st) { st = { phase: 0, blocked: false }; pulleyState.set(k, st); }
            st.blocked = true; // 行程端点：平台停住、滑轮照转空转（差异 4）
            continue;
        }
        if (!st) { st = { phase: 0, blocked: false }; pulleyState.set(k, st); }
        st.blocked = false;
        st.phase += dt;
        if (st.phase < 1 / LIFT_SPEED) continue;
        st.phase = 0;
        // ---- 跨格提交（节拍到）----
        if (getBlock(bind.px, bind.py, bind.pz) !== PLATFORM_BASE) continue; // 前置校验（R1-10）
        setBlockSafe(bind.px, bind.py, bind.pz, BlockTypes.AIR);
        // 旧格支撑连锁：平台顶/侧面贴着的红石元件/火把随平台离开而脱落（R1-03，照活塞先例）
        for (const cc of popUnsupportedRedstone(bind.px, bind.py, bind.pz)) {
            spawnBreakParticles(cc.x, cc.y, cc.z, cc.id);
            markChunksAroundLocal(chunksToRebuild, cc.x, cc.z);
        }
        setBlockSafe(bind.px, ny, bind.pz, PLATFORM_BASE);
        // 载客：站平台顶（站顶±带宽）+ 占据前方格（被方块写入=同向推开防埋）的实体一起走（R1-04）
        carryRiders(
            [{ x: bind.px, y: bind.py, z: bind.pz }, { x: bind.px, y: ny, z: bind.pz }],
            [0, dirY, 0],
        );
        markChunksAroundLocal(chunksToRebuild, bind.px, bind.pz);
        if (!redstoneDirty && hasRedstoneNear(bind.px, bind.py, bind.pz)) redstoneDirty = true;
        if (!redstoneDirty && hasRedstoneNear(bind.px, ny, bind.pz)) redstoneDirty = true;
        // 本地同步派生态（零动力重算，R4-01）：bind 指向新格 + kineticMap 两条目迁移（HUD 不退化）
        const entry = kineticMap.get(keyOf(bind.px, bind.py, bind.pz));
        if (entry) {
            kineticMap.delete(keyOf(bind.px, bind.py, bind.pz));
            kineticMap.set(keyOf(bind.px, ny, bind.pz), entry);
        }
        bind.py = ny;
        updateRopeVisual(c); // 绳线段长度跟随（chunk.js 滑轮 prop，零区块重建）
    }
    // ---- 帧末聚合 flush ----
    if (chunksToRebuild.size > 0) {
        for (const ck of chunksToRebuild) rebuildChunk(Math.floor(ck / 1000), ck % 1000);
    }
    if (redstoneDirty) updateRedstoneNetwork(); // 仅平台新旧格 5×5×5 内有红石元件才重算（守卫）
}

// 绳视觉更新：跨格后把滑轮 prop 的绳线段下端跟到平台新顶面（prop 结构归 chunk.js
// 构建——root.userData.rope 引用绳 mesh；此处只改 scale，零区块重建。为避免
// chunk↔kinetic 循环依赖，不注入回调：直接遍历 state.droppedItems 按 propKey 定位）
function updateRopeVisual(c) {
    const bind = pulleyBinds.get(keyOf(c.x, c.y, c.z));
    for (const it of state.droppedItems) {
        if (it.mesh?.userData?.propKey !== keyOf(c.x, c.y, c.z)) continue;
        const rope = it.mesh.getObjectByName?.('pulley_rope'); // name 定位（userData 只存纯数据约定）
        if (rope && bind) rope.scale.y = Math.max(0.1, Math.abs(bind.py - c.y));
        break;
    }
}

// 可放置方块域（差异 11）：普通方块（石/圆石/沙砾/沙/木板/原木/玻璃/TNT/水/羊毛…）。
// customMesh 的门/红石元件/火把/花/动力族一律排除；工具与材料/食物（item: true）排除
function isDeployableItem(id) {
    const info = BlockInfo[id];
    if (!info || info.item) return false;
    if (isToolId(id)) return false;
    return !info.customMesh;
}

// 目标格是否与玩家/怪物 AABB 重叠：玩家照 interaction.js placeBlock 先例（连续 AABB 相交测试），
// 怪物照 piston.js shoveEntities 的格内实体查找（feet/head 双探针，身高 1.8）——差异 14
function cellOverlapsEntity(tx, ty, tz) {
    const p = state.player;
    if (!p.dead) {
        const halfW = PLAYER_WIDTH / 2;
        if (tx + 1 > p.x - halfW && tx < p.x + halfW &&
            ty + 1 > p.y && ty < p.y + PLAYER_HEIGHT &&
            tz + 1 > p.z - halfW && tz < p.z + halfW) return true;
    }
    for (const e of state.enemies) {
        if (Math.floor(e.x) !== tx || Math.floor(e.z) !== tz) continue;
        if (Math.floor(e.y + 0.1) === ty || Math.floor(e.y + 1.8 - 0.1) === ty) return true;
    }
    return false;
}

// T 的切比雪夫距离 2 内（5×5×5）是否存在红石网络关心的方块（红石元件/门/活塞组——
// 观察者的侦测走 updatePistonTick 每帧 diff 不依赖重算，一并纳入保守正确且成本可忽略）
function hasRedstoneNear(x, y, z) {
    for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= WORLD_HEIGHT) continue;
        for (let dz = -2; dz <= 2; dz++) {
            const zz = z + dz;
            if (zz < 0 || zz >= WORLD_DEPTH) continue;
            for (let dx = -2; dx <= 2; dx++) {
                const xx = x + dx;
                if (xx < 0 || xx >= WORLD_WIDTH) continue;
                const id = getBlock(xx, yy, zz);
                if (isRedstoneId(id) || isDoorId(id) || isPistonGroupId(id) || isPistonHeadId(id)) return true;
            }
        }
    }
    return false;
}

// 收集受影响区块（含贴边相邻，照 piston.js markChunkAround），帧末统一重建（去重）
const CHUNKS_X_LOCAL = Math.ceil(WORLD_WIDTH / CHUNK_SIZE);
const CHUNKS_Z_LOCAL = Math.ceil(WORLD_DEPTH / CHUNK_SIZE);

function markChunksAroundLocal(set, x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const add = (a, b) => {
        if (a >= 0 && a < CHUNKS_X_LOCAL && b >= 0 && b < CHUNKS_Z_LOCAL) set.add(a * 1000 + b);
    };
    add(cx, cz);
    if (x % CHUNK_SIZE === 0) add(cx - 1, cz);
    if (x % CHUNK_SIZE === CHUNK_SIZE - 1) add(cx + 1, cz);
    if (z % CHUNK_SIZE === 0) add(cx, cz - 1);
    if (z % CHUNK_SIZE === CHUNK_SIZE - 1) add(cx, cz + 1);
}

// 锯完一格：清格、掉落（原版映射 + 原木特例）、支撑上的红石元件连锁脱落、网络刷新
function finishSaw(tx, ty, tz, target) {
    setBlockSafe(tx, ty, tz, BlockTypes.AIR);
    rebuildAroundLocal(tx, tz);
    for (const cc of popUnsupportedRedstone(tx, ty, tz)) {
        spawnBreakParticles(cc.x, cc.y, cc.z, cc.id);
        rebuildAroundLocal(cc.x, cc.z);
    }
    let item, count;
    if (target === BlockTypes.WOOD || target === BlockTypes.LOG) {
        item = BlockTypes.PLANKS;
        count = 4; // 锯切转换：原木/树干 → 木板×4
    } else {
        const info = BlockInfo[target];
        item = info.drop === null ? null : (info.drop ?? target); // 玻璃/树叶无掉落（原版规则）
        count = 1;
    }
    if (item !== null) spawnItemDrop(tx + 0.5, ty + 0.3, tz + 0.5, item, count);
    spawnBreakParticles(tx, ty, tz, target);
    playBlockSound(false);
    updateRedstoneNetwork(); // 目标方块可能是红石挂靠位，电平基线刷新
    updateKineticNetwork();  // 也可能是动力方块的支撑格（拓扑不变也幂等，图个安心）
}

// 重建 (x,z) 所在区块及贴边相邻区块（锯切清格用）
function rebuildAroundLocal(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    rebuildChunk(cx, cz);
    if (x % CHUNK_SIZE === 0 && cx > 0) rebuildChunk(cx - 1, cz);
    if (x % CHUNK_SIZE === CHUNK_SIZE - 1 && cx < Math.ceil(WORLD_WIDTH / CHUNK_SIZE) - 1) rebuildChunk(cx + 1, cz);
    if (z % CHUNK_SIZE === 0 && cz > 0) rebuildChunk(cx, cz - 1);
    if (z % CHUNK_SIZE === CHUNK_SIZE - 1 && cz < Math.ceil(WORLD_DEPTH / CHUNK_SIZE) - 1) rebuildChunk(cx, cz + 1);
}

// ==================== 外部兜底 ====================
// 该格机器进度作废（方块被破坏/换格时；由 breakKineticAt 调用）
function dropMachineProgressAt(x, y, z) {
    const k = keyOf(x, y, z);
    crushProgress.delete(k);
    sawProgress.delete(k);
    deployerCool.delete(k);
    pulleyState.delete(k);
}

// 读档/开新世界后调用：清机器进度并重算全网（派生态不存档，现场恢复）
export function initKinetic() {
    dropAllMachineProgress();
    updateKineticNetwork();
}

function dropAllMachineProgress() {
    crushProgress.clear();
    sawProgress.clear();
    deployerCool.clear();
    pulleyState.clear();
}
