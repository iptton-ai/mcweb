import { LifeBlocks } from './config.js';
import { insertChestStack } from './homestead.js';
import { adventureData } from './adventureData.js';
import { addInventoryStack } from './inventoryStacks.js';
// ==================== items.js ====================
// 物品实体：机器产出的真掉落物（粉碎轮/机械锯的产出走这里，见 js/kinetic.js），
// 区别于玩家挖掘的「直接进背包」——有简单重力、落地即停、玩家靠近磁吸、
// 1.5 格内自动入包、120 秒寿命防堆积。玩家挖掘掉落不改走物品实体（改动大，
// 动摇已验证行为，留给以后单独立项）。
// 另含传送带携带（carried，Create-lite L1 链 2）：feet 格是运转中的传送带时
// 豁免重力与磁吸，沿带向匀速平移（见下方 beltCarried 与 updateItemDrops）。

import * as THREE from 'three';
import {
    BELT_DIRS, BELT_RIDE_Y, BELT_SPEED, BlockInfo, BlockTypes, ITEM_LIFETIME_SEC,
    ITEM_MAGNET_DIST, ITEM_PICKUP_DIST, beltDir, isBeltId, isToolId,
} from './config.js';
import { isCreative, state } from './state.js';
import { scene } from './engine.js';
import { getBlock } from './world.js';
import { isSolid } from './chunk.js';
import { atlasSize, atlasTexture, blockUVs, getUVForFace } from './textures.js';
import { playPickupSound } from './audio.js';
import { updateHotbar } from './ui.js';
import { isBeltRunningAt, beltSpeedAt } from './kinetic.js';

// 几何/材质模块级共享（掉落物几十个上下，逐个 dispose 不值得；移除实体只 scene.remove）
const dropGeoCache = new Map(); // 方块 itemId -> 0.25 立方几何（六面图集 UV）
const dropSpriteCache = new Map(); // 道具/工具 itemId -> 像素板 Mesh 模板（clone 共享资源）
const dropCubeMat = new THREE.MeshLambertMaterial({ map: atlasTexture, transparent: true, alphaTest: 0.1 });

// 方块掉落物：0.25 尺寸小立方，六面 UV 取图集对应 tile（复用 viewmodel.js 持物立方的铺法）
function getDropGeo(itemId) {
    let geo = dropGeoCache.get(itemId);
    if (!geo) {
        geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
        const uvAttr = geo.attributes.uv;
        const faces = ['side', 'side', 'top', 'bottom', 'side', 'side']; // BoxGeometry 面序
        for (let f = 0; f < 6; f++) {
            const { u0, v0, u1, v1 } = getUVForFace(itemId, faces[f]);
            const i = f * 4;
            uvAttr.setXY(i, u0, v1);
            uvAttr.setXY(i + 1, u1, v1);
            uvAttr.setXY(i + 2, u0, v0);
            uvAttr.setXY(i + 3, u1, v0);
        }
        uvAttr.needsUpdate = true;
        dropGeoCache.set(itemId, geo);
    }
    return geo;
}

// 道具/工具掉落物：图集 tile 裁成像素板（门/火把/红石元件/工具类图标）
function getDropSprite(itemId) {
    let tpl = dropSpriteCache.get(itemId);
    if (!tpl) {
        const tile = blockUVs[itemId]?.top || blockUVs[BlockTypes.STONE]?.top || { x: 0, y: 0 };
        const u0 = tile.x / atlasSize, v0 = 1 - (tile.y + 1) / atlasSize, u1 = (tile.x + 1) / atlasSize, v1 = 1 - tile.y / atlasSize;
        const geo = new THREE.PlaneGeometry(0.35, 0.35);
        const uvAttr = geo.attributes.uv;
        for (let i = 0; i < uvAttr.count; i++) {
            uvAttr.setXY(i, u0 + uvAttr.getX(i) * (u1 - u0), v0 + uvAttr.getY(i) * (v1 - v0));
        }
        uvAttr.needsUpdate = true;
        const mat = new THREE.MeshBasicMaterial({
            map: atlasTexture,
            transparent: true,
            alphaTest: 0.15,
            side: THREE.DoubleSide,
        });
        tpl = new THREE.Mesh(geo, mat);
        dropSpriteCache.set(itemId, tpl);
    }
    return tpl.clone(); // Mesh.clone 共享 geometry/material 引用
}

function buildDropMesh(itemId) {
    const info = BlockInfo[itemId];
    if (isToolId(itemId) || info?.customMesh) return getDropSprite(itemId);
    return new THREE.Mesh(getDropGeo(itemId), dropCubeMat);
}

// ==================== 生成与清理 ====================
// 在 (x,y,z)（世界坐标，可带小数）弹出一个物品实体，向上小跳后落地。
// opts.vx/vz：水平初速（玩家丢弃=沿视线抛出）；opts.pickupDelay：拾取冷却秒数
// （丢弃物需要——否则刚弹出就在 1.5 格入包圈内被自己立刻吸回，丢弃等于没丢）。
export function spawnItemDrop(x, y, z, itemId, count = 1, opts = {}) {
    const mesh = buildDropMesh(itemId);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    state.itemDrops.push({
        x, y, z, itemId, count, mesh, age: 0,
        vy: opts.vy !== undefined ? opts.vy : 2.2 + Math.random() * 1.2,
        vx: opts.vx || 0,
        vz: opts.vz || 0,
        pickupDelay: opts.pickupDelay || 0,
        toolWear: opts.toolWear || 0,
        lifePersistent: opts.lifePersistent === true,
    });
}

// 切世界（读档/重开/换槽）时清光物品实体
export function clearItemDrops() {
    for (const d of state.itemDrops) scene.remove(d.mesh);
    state.itemDrops.length = 0;
}

function removeDrop(i) {
    if (beltBuckets) beltBuckets.get(beltBucketKey(state.itemDrops[i]))?.delete(state.itemDrops[i]);
    scene.remove(state.itemDrops[i].mesh);
    state.itemDrops.splice(i, 1);
}

// ==================== 传送带携带（carried，Create-lite L1 链 2）====================
// feet 探针与落地公式同源（y - BELT_RIDE_Y）：带 solid false（照压力板），物品落入
// 带格后落在带下方支撑面上，feet 恰好等于带格——carried 接管，无需改落地支撑判定。
// 扫掠捕获：本帧与上一帧位置之间的 feet 格逐格比较，防低帧率远坠整格跳过带格漏捕
// （G2 裁决 R1-08）。命中 → 豁免重力与磁吸（寿命照走、1.5 格拾取保留——带通向玩家
// = 免费的自动收集线，差异 13）；沿带向匀速平移；前方 ~0.35 格内有其它物品实体则
// 排队暂停（少量全扫、多量用格桶选候选）；前方实心墙抵墙停留；跨格自动接力——
// 新 feet 不是 running 带则恢复普通物理并保留残余带向速度（自然弹出/落地）。
// 断电（isBeltRunningAt false）判定不命中 → 普通物理，物品原地停住，寿命内复电再带走。
const BELT_QUEUE_DIST = 0.35; // 排队间距（前方有物品实体时保持的最小距离）
const BELT_SWEEP_MAX = 8; // 扫掠格数上限（防极端帧率下大区间扫列）

// 多物品只检查小步扫掠附近的格桶；仍使用实体的实时坐标判断队距。
// 帧内每次移动/删除都同步索引，避免拐弯跨格后漏看已处理的队首。
let beltBuckets = null;
const beltBucketKey = d => Math.floor(d.x) * 65536 + Math.floor(d.z);
function syncBeltBucket(d, oldKey) {
    if (!beltBuckets) return;
    const key = beltBucketKey(d);
    if (key === oldKey) return;
    beltBuckets.get(oldKey)?.delete(d);
    let bucket = beltBuckets.get(key);
    if (!bucket) beltBuckets.set(key, bucket = new Set());
    bucket.add(d);
}
function limitQueueFraction(d, o, dx, dz, fraction) {
    if (o===d || o.count<=0 || Math.abs(o.y-d.y)>0.3) return fraction;
    const rx=d.x-o.x, rz=d.z-o.z, toward=rx*dx+rz*dz;
    if (toward>=0) return fraction;
    const a=dx*dx+dz*dz, c=rx*rx+rz*rz-BELT_QUEUE_DIST*BELT_QUEUE_DIST;
    const disc=toward*toward-a*c;
    if (disc<=0 || a<1e-18) return fraction;
    return Math.min(fraction,Math.max(0,(-toward-Math.sqrt(disc))/a));
}
function queueFraction(d, dx, dz) {
    let fraction=1;
    if (!beltBuckets) {
        for (const o of state.itemDrops) {
            fraction=limitQueueFraction(d,o,dx,dz,fraction);
            if (fraction<1e-9) break;
        }
        return fraction;
    }
    const ex=d.x+dx, ez=d.z+dz;
    const x0=Math.floor(Math.min(d.x,ex)-BELT_QUEUE_DIST), x1=Math.floor(Math.max(d.x,ex)+BELT_QUEUE_DIST);
    const z0=Math.floor(Math.min(d.z,ez)-BELT_QUEUE_DIST), z1=Math.floor(Math.max(d.z,ez)+BELT_QUEUE_DIST);
    for (let x=x0; x<=x1; x++) for (let z=z0; z<=z1; z++) {
        const bucket=beltBuckets.get(x*65536+z);
        if (!bucket) continue;
        for (const o of bucket) {
            fraction=limitQueueFraction(d,o,dx,dz,fraction);
            if (fraction<1e-9) return fraction;
        }
    }
    return fraction;
}

function beltCarried(d, prevY, dt) {
    const colX = Math.floor(d.x), colZ = Math.floor(d.z);
    // 扫掠捕获：从上一帧位置到本帧位置的 feet 区间自上而下找第一格 running 带
    let beltY = -1, beltIdFound = 0, beltSpeedFound = 0;
    const yTop = Math.floor(Math.max(prevY, d.y) - BELT_RIDE_Y);
    const yBot = Math.max(Math.floor(Math.min(prevY, d.y) - BELT_RIDE_Y), yTop - BELT_SWEEP_MAX);
    for (let y = yTop; y >= yBot; y--) {
        const b = getBlock(colX, y, colZ);
        const speed=isBeltId(b) ? beltSpeedAt(colX,y,colZ) : 0;
        if (speed) {
            beltY = y;
            beltIdFound = b;
            beltSpeedFound = speed;
            break;
        }
    }
    if (beltY < 0) {
        // 离带瞬间：恢复普通物理。两种情形分开处理——
        // 脚还踩在带上（断电/过载停转）= 原地停住等复电（E04：停走不滑行）；
        // 真正走出带格（跨格接力的「否」分支/带尽头）= 保留残余带向速度自然弹出
        if (d.carried) {
            const feetOnBelt = isBeltId(getBlock(Math.floor(d.x), Math.floor(d.y - BELT_RIDE_Y), Math.floor(d.z)));
            if (feetOnBelt) {
                d.vx = 0;
                d.vz = 0;
            } else {
                d.vx = d.beltVX || 0;
                d.vz = d.beltVZ || 0;
            }
            d.vy = 0;
            d.carried = false;
        }
        return false;
    }
    d.carried = true;
    d.lifePersistent = true;
    let remaining=Math.min(dt,0.25);
    for (let step=0; step<8 && remaining>1e-9 && d.count>0; step++) {
        const bx=Math.floor(d.x), bz=Math.floor(d.z);
        const id=step===0 ? beltIdFound : getBlock(bx,beltY,bz);
        const speed=step===0 ? beltSpeedFound : beltSpeedAt(bx,beltY,bz);
        if (!isBeltId(id) || !speed) break;
        let [ux,,uz]=BELT_DIRS[beltDir(id)];
        let toTurn=Infinity;
        // 先沿来向走到转角中心再转弯，不能在格边提前折线并横向挤过队首。
        if (ux && d.beltVZ && (bz+0.5-d.z)*d.beltVZ>1e-9) {
            ux=0;uz=Math.sign(d.beltVZ);toTurn=Math.abs(bz+0.5-d.z);
        } else if (uz && d.beltVX && (bx+0.5-d.x)*d.beltVX>1e-9) {
            ux=Math.sign(d.beltVX);uz=0;toTurn=Math.abs(bx+0.5-d.x);
        }
        const stepTime=Math.min(remaining,0.2/speed,toTurn/speed);
        const distance=speed*stepTime;
        d.beltVX=ux*speed; d.beltVZ=uz*speed;
        const t=Math.min(1,10*stepTime);
        const dx=ux*distance+(ux?0:(bx+0.5-d.x)*t);
        const dz=uz*distance+(uz?0:(bz+0.5-d.z)*t);
        // 连横向回中一起扫掠，拐角队列也不能靠回中挤入另一物品。
        const fraction=queueFraction(d,dx,dz);
        const nx=d.x+dx*fraction, nz=d.z+dz*fraction;
        const tx=Math.floor(nx), tz=Math.floor(nz), front=getBlock(tx,beltY,tz);
        if (front===LifeBlocks.CHEST && !state.levelRun && !state.levelEdit) {
            const result=insertChestStack(tx,beltY,tz,{id:d.itemId,count:d.count,wear:d.toolWear||0});
            if (result.accepted) {
                d.count-=result.accepted;
                adventureData().delivered=Math.min(1e9,adventureData().delivered+result.accepted);
            }
        }
        if (!isSolid(front)) { d.x=nx; d.z=nz; }
        d.y+=(beltY+BELT_RIDE_Y-d.y)*t;
        remaining-=stepTime;
        if (isSolid(front) || fraction<1e-9) break;
    }
    d.vx = 0;
    d.vz = 0;
    d.vy = 0;
    return true;
}

// ==================== 每帧驱动（main.js gameLoop 调用）====================
// 磁吸（4 格内飞向玩家胸口）→ 拾取（1.5 格入包）→ 简单重力（落地即停，不做碰撞弹跳）；
// carried 判定插在拾取之后、磁吸/重力之前（传送带优先接管，见上方 beltCarried）
export function updateItemDrops(dt) {
    const p = state.player;
    beltBuckets = state.itemDrops.length >= 24 ? new Map() : null;
    if (beltBuckets) for (const d of state.itemDrops) syncBeltBucket(d, null);
    for (let i = state.itemDrops.length - 1; i >= 0; i--) {
        const d = state.itemDrops[i];
        d.windTimer=Math.max(0,(d.windTimer||0)-dt);
        const oldBucket = beltBuckets ? beltBucketKey(d) : null;
        const prevY = d.py ?? d.y;
        d.py = d.y;
        // 带先接管物品再判断拾取和磁吸，末端箱子也在这里先接收。
        const carried = beltCarried(d, prevY, dt);
        syncBeltBucket(d,oldBucket);
        const onBelt = carried || isBeltId(getBlock(Math.floor(d.x),Math.floor(d.y-BELT_RIDE_Y),Math.floor(d.z)));
        if(onBelt) d.lifePersistent=true;
        if(d.count<=0) { removeDrop(i); continue; }
        d.age += dt;
        if(carried) {
            d.mesh.position.set(d.x,d.y+Math.sin(d.age*2.2)*0.04,d.z);
            d.mesh.rotation.y+=dt*2;
            continue;
        }
        if (d.age > ITEM_LIFETIME_SEC && !d.lifePersistent) {
            removeDrop(i);
            continue;
        }
        const dx = p.x - d.x, dy = p.y + 0.9 - d.y, dz = p.z - d.z;
        const dist = Math.hypot(dx, dy, dz);
        const thrown = d.pickupDelay > 0; // 玩家丢弃的实体：冷却内不可拾取，且永不磁吸（捡回需走近 1.5 格）
        if (!p.dead && !d.windTimer && d.age >= d.pickupDelay && dist < ITEM_PICKUP_DIST) {
            if (!isCreative() || d.lifePersistent) {
                const accepted=addInventoryStack({id:d.itemId,count:d.count,wear:d.toolWear||0});
                d.count-=accepted;
                if(d.count>0) continue;
                updateHotbar();
            }
            playPickupSound();
            removeDrop(i);
            continue;
        }
        if (!p.dead && !d.windTimer && !thrown && !onBelt && dist < ITEM_MAGNET_DIST) {
            // 机器产出磁吸：不用走过去捡（手感优先）
            const step = Math.min(6 * dt, dist);
            d.x += dx / dist * step;
            d.y += dy / dist * step;
            d.z += dz / dist * step;
        } else {
            // 防埋兜底（电梯 T1）：物品中心所在格变为实心（活塞顶升/AI 放块/方块移入）
            // → 直接上浮到该格顶面 +0.001（与玩家 Y 轴自救同款语义），随后重力自然落回
            // 正常的离地 0.15 漂浮——防物品嵌进实心方块
            const embedY = Math.floor(d.y);
            if (isSolid(getBlock(Math.floor(d.x), embedY, Math.floor(d.z)))) {
                d.y = embedY + 1 + 0.001;
                d.vy = 0;
            }
            d.vy -= 18 * dt;
            const ny = d.y + d.vy * dt;
            if (d.vy < 0 && isSolid(getBlock(Math.floor(d.x), Math.floor(ny - 0.15), Math.floor(d.z)))) {
                d.vy = 0;
                d.y = Math.floor(ny - 0.15) + 1.15; // 落在方块顶面（中心离顶 0.15）
            } else {
                d.y = ny;
            }
            // 水平抛出（丢弃物沿视线飞一段）：目标格实心=撞墙停住，摩擦随时间衰减
            if (d.vx || d.vz) {
                const nx = d.x + d.vx * dt, nz = d.z + d.vz * dt;
                if (isSolid(getBlock(Math.floor(nx), Math.floor(d.y - 0.15), Math.floor(nz)))) {
                    d.vx = 0;
                    d.vz = 0;
                } else {
                    d.x = nx;
                    d.z = nz;
                    const fr = Math.max(0, 1 - 2.5 * dt);
                    d.vx *= fr;
                    d.vz *= fr;
                }
            }
        }
        d.mesh.position.set(d.x, d.y + Math.sin(d.age * 2.2) * 0.04, d.z); // 落地后轻微浮动
        d.mesh.rotation.y += dt * 2;
        syncBeltBucket(d,oldBucket);
    }
    beltBuckets = null; // 索引只活一帧，切世界不持有旧实体。
}
