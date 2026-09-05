// ==================== items.js ====================
// 物品实体：机器产出的真掉落物（粉碎轮/机械锯的产出走这里，见 js/kinetic.js），
// 区别于玩家挖掘的「直接进背包」——有简单重力、落地即停、玩家靠近磁吸、
// 1.5 格内自动入包、120 秒寿命防堆积。玩家挖掘掉落不改走物品实体（改动大，
// 动摇已验证行为，留给以后单独立项）。

import * as THREE from 'three';
import { BlockInfo, BlockTypes, ITEM_LIFETIME_SEC, ITEM_MAGNET_DIST, ITEM_PICKUP_DIST, isToolId } from './config.js';
import { isCreative, state } from './state.js';
import { scene } from './engine.js';
import { getBlock } from './world.js';
import { isSolid } from './chunk.js';
import { atlasSize, atlasTexture, blockUVs, getUVForFace } from './textures.js';
import { playPickupSound } from './audio.js';
import { updateHotbar } from './ui.js';

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
    });
}

// 切世界（读档/重开/换槽）时清光物品实体
export function clearItemDrops() {
    for (const d of state.itemDrops) scene.remove(d.mesh);
    state.itemDrops.length = 0;
}

function removeDrop(i) {
    scene.remove(state.itemDrops[i].mesh);
    state.itemDrops.splice(i, 1);
}

// ==================== 每帧驱动（main.js gameLoop 调用）====================
// 磁吸（4 格内飞向玩家胸口）→ 拾取（1.5 格入包）→ 简单重力（落地即停，不做碰撞弹跳）
export function updateItemDrops(dt) {
    const p = state.player;
    for (let i = state.itemDrops.length - 1; i >= 0; i--) {
        const d = state.itemDrops[i];
        d.age += dt;
        if (d.age > ITEM_LIFETIME_SEC) {
            removeDrop(i);
            continue;
        }
        const dx = p.x - d.x, dy = p.y + 0.9 - d.y, dz = p.z - d.z;
        const dist = Math.hypot(dx, dy, dz);
        const thrown = d.pickupDelay > 0; // 玩家丢弃的实体：冷却内不可拾取，且永不磁吸（捡回需走近 1.5 格）
        if (!p.dead && d.age >= d.pickupDelay && dist < ITEM_PICKUP_DIST) {
            if (!isCreative()) {
                state.player.inventory[d.itemId] = (state.player.inventory[d.itemId] || 0) + d.count;
                updateHotbar();
            }
            playPickupSound();
            removeDrop(i);
            continue;
        }
        if (!p.dead && !thrown && dist < ITEM_MAGNET_DIST) {
            // 机器产出磁吸：不用走过去捡（手感优先）
            const step = Math.min(6 * dt, dist);
            d.x += dx / dist * step;
            d.y += dy / dist * step;
            d.z += dz / dist * step;
        } else {
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
    }
}
