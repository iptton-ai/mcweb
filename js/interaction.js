import { isCrankId } from './config.js';
import { LADDER_BASE, isLadderId, AdventureItems } from './config.js';
import { toggleEquipment } from './adventure.js';
import { adventureData } from './adventureData.js';
import { LifeItems, LifeBlocks, isCropId, isContainerId } from './config.js';
import { useFarmItem, harvestPlant, flushLifeDrops } from './homestead.js';
import { openLifePanel } from './lifeUI.js';
import { addInventoryStack, takeInventoryStack } from './inventoryStacks.js';
// ==================== interaction.js ====================

import * as THREE from 'three';
import { BED_ITEM_ID, isBedId, BlockInfo, BlockTypes, CHUNK_SIZE, FIST_ATTACK, HotbarBlocks, LEAVES_APPLE_CHANCE, PEN_ID, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_WIDTH, REACH_CREATIVE, REACH_SURVIVAL, STARLIGHT_BASE, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH, isButtonId, isDustId, isDoorId, HANZI_ORE, isKeypadId, isKineticId, isLampId, isLeverId, isMerchantId, isObserverId, isPistonGroupId, isPistonHeadId, isPistonId, isPlateId, isRedstoneId, isRTorchId, isStarlightId, isToolId, kineticItemId, keypadSolved, ItemTypes, DUST_ITEM_ID, RTORCH_ITEM_ID, BUTTON_ITEM_ID, PLATE_ITEM_ID, LEVER_ITEM_ID, LAMP_ITEM_ID, DOOR_ITEM_ID, PISTON_ITEM_ID, STICKY_PISTON_ITEM_ID, OBSERVER_ITEM_ID, outlineOf, pistonSticky } from './config.js';
import { isCreative, state } from './state.js';
import { camera } from './engine.js';
import { getBlock, setBlockSafe } from './world.js';
import { isCustomMesh, rebuildChunk, removeDroppedItemAt, removeTorchLightAt } from './chunk.js';
import { tryPlaceBed, breakBedAt, interactBedAt, flushBedChanges, refundRemovedBeds } from './bed.js';
import { breakDoorAt, toggleDoorAt, tryPlaceDoor } from './door.js';
import { breakPistonGroupAt, placePiston } from './piston.js';
import { setCrankActive, breakKineticAt, crusherIntakeError, placeKinetic, updateKineticNetwork } from './kinetic.js';
import { breakRedstoneAt, placeRedstone, popUnsupportedRedstone, pressButtonAt, toggleLeverAt, updateRedstoneNetwork } from './redstone.js';
import { spawnBreakParticles } from './particles.js';
import { playBlockSound } from './audio.js';
import { damageEnemy } from './entities.js';
import { spawnTntEntity } from './tnt.js';
import { spawnItemDrop } from './items.js';
import { addXp, doEat } from './playerLife.js';
import { damageHeldTool, getHeldTool } from './mining.js';
import { swingViewmodel } from './viewmodel.js';
import { keys } from './input.js'; // Shift 绕过台/炉交互用（运行时读取，与 input.js 循环依赖安全）
// 注意：ui.js 也 import 本模块的 raycastBlocks，循环依赖均为运行时函数调用，安全
// （mining.js ↔ 本模块同理：本模块只运行时调用 getHeldTool）
import { openItemPicker, showTooltip, updateHotbar } from './ui.js';
import { interactKeypadAt, interactKeypadAuthorAt } from './eduKeypad.js'; // 答题机右键答题（Edu M1）；持出题笔右键 = 作者面板（B3）
import { interactMerchantAt } from './eduMerchant.js'; // 英语商人右键交易（Edu M2）
import { interactStarlightAt } from './eduStarlight.js'; // 星辉门右键答题（关卡工坊 P2）
import { ensureHanziBank, collectHanziAt } from './eduRewards.js'; // 识字矿石记字（Edu M2）
import { isLevelRunActive } from './levelRun.js'; // 闯关模式守卫（W11 绕过通道全闭）

ensureHanziBank(); // 预热识字表（异步，不阻塞；首次挖矿前通常已就绪，未就绪则该次只掉物不记字）

// 视线方向：forward = (-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch))
function lookDirection() {
    const p = state.player;
    const cp = Math.cos(p.pitch);
    return new THREE.Vector3(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
}

// 拾取射线：第一人称从眼睛出发；第三人称从相机出发（与屏幕准星严格一致，
// 相机在眼睛正后方同高度，照原版），触及距离仍从玩家（手）算起
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

// 射线与 AABB 的 slab 区间求交：命中返回参数 t（落在 [tMin,tMax] 内），未命中返回 -1。
// min/max 为世界坐标数组 [x0,y0,z0]/[x1,y1,z1]，o/d 为射线原点与方向。
function rayVsAABB(o, d, min, max, tMin, tMax) {
    let enter = tMin;
    let exit = tMax;
    const axes = ['x', 'y', 'z'];
    for (let k = 0; k < 3; k++) {
        const a = axes[k];
        const da = d[a];
        const oa = o[a];
        if (da === 0) {
            if (oa < min[k] || oa > max[k]) return -1;
            continue;
        }
        let t0 = (min[k] - oa) / da;
        let t1 = (max[k] - oa) / da;
        if (t0 > t1) {
            const s = t0;
            t0 = t1;
            t1 = s;
        }
        if (t0 > enter) enter = t0;
        if (t1 < exit) exit = t1;
        if (enter > exit) return -1;
    }
    return enter;
}

// ==================== 方块交互 ====================
export function raycastBlocks(includeWater=false) {
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
        // 当前格和下方伸入本格的高模型共同竞争最近命中（围栏高1.5格）。
        const tExit=Math.min(tMaxX,tMaxY,tMaxZ);
        let nearest=null;
        for(const by of [y,y-1]) {
            const block=getBlock(x,by,z);
            if(block===BlockTypes.AIR||(!includeWater&&block===BlockTypes.WATER))continue;
            const shape=outlineOf(block);
            if(by!==y && (!shape || !shape.some((v,i)=>i%6===4&&v>1)))continue;
            const boxes=shape||[0,0,0,1,1,1];
            for(let i=0;i<boxes.length;i+=6) {
                const lo=[x+boxes[i],by+boxes[i+1],z+boxes[i+2]];
                const hi=[x+boxes[i+3],by+boxes[i+4],z+boxes[i+5]];
                const t=rayVsAABB(origin,direction,lo,hi,dist,tExit);
                if(t<0||nearest&&t>=nearest.distance)continue;
                const point=[origin.x+direction.x*t,origin.y+direction.y*t,origin.z+direction.z*t];
                // 面法线取真实AABB边界，不能把上半格误当成斜向面。
                let axis=0,normal=-1,error=Infinity;
                for(let a=0;a<3;a++)for(const side of [-1,1]) {
                    const delta=Math.abs(point[a]-(side<0?lo[a]:hi[a]));
                    if(delta<error){error=delta;axis=a;normal=side;}
                }
                const face={dx:0,dy:0,dz:0};face[['dx','dy','dz'][axis]]=normal;
                nearest={x,y:by,z,block,distance:t,face};
            }
        }
        if(nearest) {
            const hx=origin.x+direction.x*nearest.distance,hy=origin.y+direction.y*nearest.distance,hz=origin.z+direction.z*nearest.distance;
            if(Math.hypot(hx-eye.x,hy-eye.y,hz-eye.z)>reach+.01)return null;
            return nearest;
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
    const { origin, dir, eye } = getPickRay();
    const wall = raycastBlocks();
    // 第三人称从玩家眼睛的射线平面开始选敌：完整身后目标跳过，跨平面的贴脸实体仍可打。
    const eyeT = Math.max(0, (eye.x - origin.x) * dir.x + (eye.y - origin.y) * dir.y + (eye.z - origin.z) * dir.z);
    let best = null;
    let nearest = Infinity;
    for (const e of state.enemies) {
        const t = rayVsAABB(origin, dir, [e.x - 0.3, e.y, e.z - 0.3],
            [e.x + 0.3, e.y + 1.8, e.z + 0.3], eyeT, 4 + origin.distanceTo(eye));
        if (t < 0 || t >= nearest) continue;
        const hit = origin.clone().addScaledVector(dir, t);
        if (hit.distanceTo(eye) > 4) continue;
        if (wall && wall.distance <= t) continue;
        nearest = t; best = e;
    }
    if (!best) return false;
    if (state.player.attackCooldown <= 0) {
        const tool = getHeldTool();
        damageEnemy(best, isCreative() ? 1000 : (tool?.damage ?? FIST_ATTACK.damage));
        state.player.attackCooldown = tool?.attackCd ?? FIST_ATTACK.attackCd;
        damageHeldTool(); // 武器打怪也磨损（徒手/创造无损耗）
    }
    return true;
}

// 破坏一格方块（mining.js 蓄力完成/即挖时调用，hit 来自 raycastBlocks）。
// 生存掉落规则照搬原版：石头→圆石、草方块→泥土、玻璃/树叶→无掉落（见 config.js BlockInfo.drop）。
export function breakBlockAt(hit) {
    // 闯关模式（W11）：关卡世界是作者搭好的谜题，破坏 = 拆锁/拆旗作弊，一律拒绝
    // （攻击路径在 tryAttackEnemy，不经本函数，不受影响；mining.js 蓄力路径另有短路）
    if (isLevelRunActive()) {
        showTooltip('🚫 闯关中不能破坏方块');
        return;
    }
    if (hit.block === BlockTypes.BEDROCK) return;
    if (isCropId(hit.block) || hit.block===LifeBlocks.SAPLING) { const msg=harvestPlant(hit.x,hit.y,hit.z);showTooltip(msg);updateHotbar();return; }
    const bedChangeStart = state.bedDirtyCells.length;
    try {
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
    if (isBedId(hit.block)) {
        for(const c of breakBedAt(hit.x,hit.y,hit.z)) { spawnBreakParticles(c.x,c.y,c.z,c.id); rebuildAround(c.x,c.z); }
        playBlockSound(false); updateHotbar(); return;
    }
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
    // 答题机（Edu M1）：普通立方体走默认掉落路径；已解锁态是信号源，清格后重算红石网络
    const brokeSolvedKeypad = isKeypadId(hit.block) && keypadSolved(hit.block) === 1;
    // 识字矿石（Edu M2）：挖开按格子哈希认领一个生字入图鉴 + 25% 概率附赠苹果
    let hanziToast = null;
    if (hit.block === HANZI_ORE) {
        const r = collectHanziAt(hit.x, hit.y, hit.z);
        if (r) hanziToast = r.isNew
            ? `🔤 认识新字：「${r.ch}」（识字图鉴 ${r.total} 字）`
            : `🔁 「${r.ch}」已经认识过啦（识字图鉴 ${r.total} 字）`;
        if (!isCreative() && Math.random() < 0.25) {
            state.player.inventory[ItemTypes.APPLE] = (state.player.inventory[ItemTypes.APPLE] || 0) + 1;
        }
    }
    setBlockSafe(hit.x,hit.y,hit.z,BlockTypes.AIR);
    if (brokeSolvedKeypad) updateRedstoneNetwork();
    if (hanziToast) showTooltip(hanziToast);
    // 生存模式按掉落映射采集（null=无掉落，缺省=自身；石头→圆石、草方块→泥土等原版规则）。
    // needsTool 方块（石头/圆石/砖/矿石）徒手或用错/低档工具挖开时「无掉落」——原版采集规则；
    // 树叶特例：不掉自身，12% 概率掉苹果（食物来源）；矿石采到给经验（煤/铁 +2、钻 +7）
    if (!isCreative()) {
        const info = BlockInfo[hit.block];
        let itemId = null;
        if (hit.block===BlockTypes.GRASS) addInventoryStack({id:LifeItems.SEEDS,count:1});
        if (hit.block === BlockTypes.LEAVES) {
            addInventoryStack({id:LifeBlocks.SAPLING,count:1});
            if (Math.random() < LEAVES_APPLE_CHANCE) itemId = ItemTypes.APPLE;
        } else {
            const tool = getHeldTool();
            const tierOk = !info?.minTier || (tool?.class === info.tool && (tool.tier || 0) >= info.minTier);
            const harvestBlocked = info?.drop === null ||
                (info?.needsTool && (!tool || tool.class !== info.tool || !tierOk));
            if (!harvestBlocked) itemId = info?.drop ?? hit.block;
        }
        if (itemId !== null) {
            state.player.inventory[itemId] = (state.player.inventory[itemId] || 0) + 1;
            if (info?.xp) addXp(info.xp);
        }
        damageHeldTool(); // 挖掘磨损工具（徒手/创造无损耗）
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
    } finally {
        flushLifeDrops();
        if (!isBedId(hit.block)) refundRemovedBeds(state.bedDirtyCells.slice(bedChangeStart));
        flushBedChanges({ dropAttachments: true });
        updateHotbar();
    }
}

export function placeBlock() {
    const heldLife=HotbarBlocks[state.player.selectedSlot];
    if ([AdventureItems.ARMOR,AdventureItems.SHIELD].includes(heldLife) && !state.levelRun && !state.levelEdit) {
        if (heldLife === AdventureItems.SHIELD && adventureData().shield) return;
        showTooltip(toggleEquipment(heldLife)); updateHotbar(); return;
    }
    const hit = raycastBlocks(heldLife===LifeItems.BUCKET);
    if(!state.levelRun && !state.levelEdit && !keys.ShiftLeft && !keys.ShiftRight) {
        const animal=raycastFarmAnimal();
        if(animal) { openLifePanel({kind:'animal',animalId:animal.animalId,animal}); return; }
        if(hit && isContainerId(hit.block)) {openLifePanel({kind:'block',x:hit.x,y:hit.y,z:hit.z});return;}
        if(hit && (hit.block===LifeBlocks.GATE || hit.block===LifeBlocks.GATE_OPEN)) {setBlockSafe(hit.x,hit.y,hit.z,hit.block===LifeBlocks.GATE?LifeBlocks.GATE_OPEN:LifeBlocks.GATE);rebuildAround(hit.x,hit.z);return;}
        if(hit && hit.block===LifeBlocks.WHEAT_MATURE) {showTooltip(harvestPlant(hit.x,hit.y,hit.z));updateHotbar();return;}
        const result=useFarmItem(heldLife,hit);if(result!==null){showTooltip(result);updateHotbar();return;}
    }
    // 右键手持食物 = 进食（饥饿未满才吃得下；创造模式没有饥饿，提示一下）
    const heldId = HotbarBlocks[state.player.selectedSlot];
    if (BlockInfo[heldId]?.food) {
        const eaten = doEat(heldId);
        if (eaten === 'full') showTooltip('🍖 你现在还不饿');
        else if (eaten) {
            swingViewmodel();
            showTooltip(`🍴 吃掉了${BlockInfo[heldId].name}（+${BlockInfo[heldId].food} 饱食）`);
        }
        return;
    }
    // 右键工作台/熔炉 = 打开合成面板（潜行+右键则照常放方块，对齐原版「Shift 绕过交互」）
    if (hit && !keys['ShiftLeft'] && !keys['ShiftRight']) {
        const station = BlockInfo[hit.block]?.station;
        if (station==='furnace') { showTooltip('临时关卡中的熔炉不加工生活库存'); return; }
        if (station) {
            openItemPicker(station);
            showTooltip(station === 'crafting' ? '▦ 已连接工作台 · 进阶配方已解锁' : '♨ 已连接熔炉 · 添加原料与燃料');
            return;
        }
    }
    if (hit && isBedId(hit.block) && !keys['ShiftLeft'] && !keys['ShiftRight']) { interactBedAt(hit.x,hit.y,hit.z); return; }
    if (hit && isCrankId(hit.block) && !keys.ShiftLeft && !keys.ShiftRight) {
        if (state.levelRun) { showTooltip('关卡中手摇动力不可操作'); return; }
        state.handCrankIntent={x:hit.x,y:hit.y,z:hit.z,id:hit.block,world:state.blocks,
            camMode:state.camMode,viewMode:state.viewMode};
        setCrankActive(hit.x,hit.y,hit.z,true);
        return;
    }
    // 右键门 = 开/关整扇门（原版交互），不放置方块。
    // 闯关模式拒绝手动开关（W11）：门只能由答题机/星辉门答对后的红石信号打开
    // （红石边沿驱动走 redstone.js applyDoorPower，不经此处，不受影响）
    if (hit && isDoorId(hit.block)) {
        if (isLevelRunActive()) {
            showTooltip('🚪 这扇门要用知识打开');
            return;
        }
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
    // 持出题笔右键答题机 = 作者面板（关卡工坊：自拟/抽题/双通过，见 eduKeypad.js B3）。
    // 放在答题分支之前：出题时按的是笔的身份，不是考生身份
    if (hit && heldId === PEN_ID && isKeypadId(hit.block)) {
        interactKeypadAuthorAt(hit.x, hit.y, hit.z);
        return;
    }
    // 右键答题机 = 开始答题（Edu M1：答对翻转为常供能信号源，数学密码门）
    if (hit && isKeypadId(hit.block)) {
        interactKeypadAt(hit.x, hit.y, hit.z);
        return;
    }
    // 右键英语商人 = 单词交易（Edu M2：中文释义三选一，答对拿奖励入图鉴）
    if (hit && isMerchantId(hit.block)) {
        interactMerchantAt(hit.x, hit.y, hit.z);
        return;
    }
    // 右键星辉门 = 超纲知识点答题（关卡工坊 P2：答对翻转为可通行 + 常供能信号源）
    if (hit && isStarlightId(hit.block)) {
        interactStarlightAt(hit.x, hit.y, hit.z);
        return;
    }
    if (hit && hit.face) {
        // 闯关模式（W11）：默认放置一律拒绝——关卡谜题不允许搭桥/垫脚绕过；
        // 上面的右键交互链（答题机/星辉门/门红石/TNT/拉杆等）不受影响
        if (isLevelRunActive()) {
            showTooltip('🚫 闯关中不能放置方块');
            return;
        }
        const bx = hit.x + hit.face.dx;
        const by = hit.y + hit.face.dy;
        const bz = hit.z + hit.face.dz;
        const bedItem = HotbarBlocks[state.player.selectedSlot];
        if (isBedId(bedItem)) {
            if(!isCreative() && !(state.player.inventory[bedItem]>0)) { showTooltip('还没有小床：在工作台用 3 羊毛和 3 木板制作'); return; }
            const error=tryPlaceBed(bx,by,bz,state.player.yaw);
            if(error) { showTooltip(error); return; }
            if(!isCreative()) state.player.inventory[bedItem]--;
            updateHotbar(); playBlockSound(true); return;
        }
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
        // 工具/材料/食物是「物品」不是方块，不能放置（照原版：右键持物品不与世界交互；
        // 食物在入口处已按进食处理，能走到这里说明刚才吃不下——提示换成去吃）
        if (isToolId(selectedType)) {
            showTooltip(`🛠️ ${BlockInfo[selectedType].name}是用来挖掘/战斗的，选个方块再放置`);
            return;
        }
        if (BlockInfo[selectedType]?.item) {
            showTooltip(`🎒 ${BlockInfo[selectedType].name}是材料/食物，不能放置`);
            return;
        }
        // 生存模式：数量不足不可放置
        if (!isCreative() && (state.player.inventory[selectedType] || 0) <= 0) {
            showTooltip(`❌ ${BlockInfo[selectedType].name}不足，先去采集吧`);
            return;
        }
        if (isLadderId(selectedType)) {
            if ((!hit.face.dx && !hit.face.dz) || !BlockInfo[hit.block]?.solid || BlockInfo[hit.block]?.customMesh) { showTooltip('木梯要贴在墙的侧面；靠近后按空格或 W 上爬，Shift 下降'); return; }
            const facing = hit.face.dz === 1 ? 0 : hit.face.dx === -1 ? 1 : hit.face.dz === -1 ? 2 : 3;
            setBlockSafe(bx,by,bz,LADDER_BASE+facing);
            if (!isCreative()) state.player.inventory[selectedType]--;
            rebuildAround(bx,bz); updateHotbar(); playBlockSound(true); return;
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
        // 粉碎轮投料口校验：配对粉碎轮的正上方只能放可粉碎方块（配方见 config.js KINETIC_RECIPES）
        const intakeErr = crusherIntakeError(bx, by, bz, selectedType);
        if (intakeErr) {
            showTooltip(intakeErr);
            return;
        }
        setBlockSafe(bx, by, bz, selectedType);
        // 生存模式：消耗一个
        if (!isCreative()) {
            state.player.inventory[selectedType]--;
            updateHotbar();
        }
        if (selectedType === BlockTypes.TNT) {
            // TNT 放置为惰性：右键点燃或红石信号引爆（配合压力板/拉杆可做陷阱）
            showTooltip('💣 TNT 已放置：右键点燃，或用红石信号引爆');
        }
        if (selectedType === BlockTypes.WATER || currentBlock === BlockTypes.WATER) {
            // 放水/盖掉水都可能改变水车顶面供水（顶面接触水判定），重算动力网络
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


// ==================== 丢弃与吸取（Z / 鼠标中键，键位在 input.js）====================
// 丢弃手持物品：沿视线抛出真物品实体（带 1.2s 拾取冷却与水平初速，对齐原版 Q 丢弃——
// 否则刚弹出就在自己 1.5 格入包圈内被立刻吸回，丢弃等于没丢）。
// 创造模式照原版：也丢出实体但不减库存（捡回时 !isCreative 保护不会多计数）。
export function dropHeldItem() {
    const p = state.player;
    const id = HotbarBlocks[p.selectedSlot];
    if (!id) return;
    let toolWear = 0;
    if (!isCreative()) {
        if ((p.inventory[id] || 0) <= 0) {
            showTooltip('手里没有这个物品');
            return;
        }
        toolWear = takeInventoryStack(id,1,p,true)?.wear || 0;
    }
    const dir = lookDirection();
    spawnItemDrop(p.x + dir.x * 0.6, p.y + 1.4, p.z + dir.z * 0.6, id, 1,
        { vx: dir.x * 4.5, vz: dir.z * 4.5, vy: 1.6 + dir.y * 2.5, pickupDelay: 1.2, toolWear });
    updateHotbar();
}

// 方块 ID → 物品栏对应物品（中键吸取用）：有状态方块映射回各自的 *_ITEM_ID 代表变体
export function pickBlockItem(blockId) {
    if (isBedId(blockId)) return BED_ITEM_ID;
    if (isDoorId(blockId)) return DOOR_ITEM_ID;
    if (isDustId(blockId)) return DUST_ITEM_ID;
    if (isRTorchId(blockId)) return RTORCH_ITEM_ID;
    if (isButtonId(blockId)) return BUTTON_ITEM_ID;
    if (isPlateId(blockId)) return PLATE_ITEM_ID;
    if (isLeverId(blockId)) return LEVER_ITEM_ID;
    if (isLampId(blockId)) return LAMP_ITEM_ID;
    if (isPistonId(blockId)) return pistonSticky(blockId) ? STICKY_PISTON_ITEM_ID : PISTON_ITEM_ID;
    if (isPistonHeadId(blockId)) return PISTON_ITEM_ID;
    if (isObserverId(blockId)) return OBSERVER_ITEM_ID;
    if (isKineticId(blockId)) return kineticItemId(blockId);
    // 星辉门：开启变体吸取回锁定代表变体（旗三变体本就映射自身，走默认 return）
    if (isStarlightId(blockId)) return STARLIGHT_BASE;
    return blockId;
}

// 创造模式中键吸取：准星方块对应的物品直接选中（物品栏没有的会提示）
export function pickBlockUnderCrosshair() {
    // 闯关模式（W11）：恒为生存且不许吸取（吸取会带出锁定变体等关卡方块，破坏谜题一致性）
    if (isLevelRunActive()) {
        showTooltip('🚫 闯关中不能吸取方块');
        return;
    }
    const hit = raycastBlocks();
    if (!hit) return;
    const itemId = pickBlockItem(hit.block);
    const idx = HotbarBlocks.indexOf(itemId);
    if (idx < 0) {
        showTooltip(`📦 ${BlockInfo[itemId]?.name || '该方块'}不在物品栏里`);
        return;
    }
    state.player.selectedSlot = idx;
    updateHotbar();
    showTooltip(`🖱️ 已吸取：${BlockInfo[itemId].name}`);
}

// Animal interaction uses the same screen ray, reach and voxel occlusion as mining.
export function raycastFarmAnimal() {
 const {origin,dir,eye}=getPickRay(),wall=raycastBlocks();let best=null,near=Infinity;
 const eyeT=Math.max(0,(eye.x-origin.x)*dir.x+(eye.y-origin.y)*dir.y+(eye.z-origin.z)*dir.z);
 for(const e of state.enemies){if(e.hostile)continue;const t=rayVsAABB(origin,dir,[e.x-.45,e.y,e.z-.8],[e.x+.45,e.y+1.15,e.z+.8],eyeT,4+origin.distanceTo(eye));if(t<0||t>=near||origin.clone().addScaledVector(dir,t).distanceTo(eye)>4||wall&&wall.distance<=t)continue;best=e;near=t;}
 return best;
}

// 按住态只用于手摇，不重复调用放置/开门等一次性交互。
export function updateCrankUse(held) {
    const use=state.handCrankIntent;
    const valid=held && use && !state.player.dead && !state.levelRun && use.world===state.blocks &&
        state.camMode===use.camMode && state.viewMode===use.viewMode && !keys.ShiftLeft && !keys.ShiftRight;
    const hit=valid ? raycastBlocks() : null;
    if (hit && hit.x===use.x && hit.y===use.y && hit.z===use.z && hit.block===use.id) {
        setCrankActive(use.x,use.y,use.z,true);
    } else {
        state.handCrankIntent=null;
        setCrankActive(0,0,0,false);
    }
}
