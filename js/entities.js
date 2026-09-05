// ==================== entities.js ====================
// 生物系统（2026-09-05 类型化，对齐参考版）：
//   敌对（生存·夜晚刷新，白天着火消散）：僵尸（追击+近身攻击）、苦力怕（贴近引信→爆炸）
//   被动（白天在草地补充，创造模式也刷）：猪/绵阳/牛——游荡、被打就逃，掉落食物/羊毛
// 刷怪规则仍对齐原版：24~128 格环带、火把照亮处不刷、成群生成、>32 格冻结 AI 随机消失。
// 模型走「原型 clone 共享」防刷怪泄漏（几何体/材质全局一份，见 createMobProto）。

import * as THREE from 'three';
import { BlockTypes, DESPAWN_CHANCE, ENEMY_ATTACK_RANGE, ENEMY_DAMAGE, LAZY_DIST, MAX_ENEMIES, MAX_PASSIVE_MOBS, MOB_TYPES, PACK_SPAWN_TRIES, SPAWN_ATTEMPTS_PER_TICK, SPAWN_MAX_DIST, SPAWN_MIN_DIST, TICK_RATE, TORCH_SPAWN_BLOCK_RADIUS, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH, XP_PER_HOSTILE_KILL } from './config.js';
import { isCreative, isNight, state } from './state.js';
import { scene } from './engine.js';
import { getBlock } from './world.js';
import { isSolid } from './chunk.js';
import { spawnBreakParticles } from './particles.js';
import { playHitSound } from './audio.js';
import { spawnItemDrop } from './items.js';
import { addXp, damagePlayer } from './playerLife.js';
import { showTooltip } from './ui.js';
import { explode } from './tnt.js';

// ==================== 玩家模型（第三人称显示） ====================
export let playerMesh = null;

export function createPlayerMesh() {
    const group = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xd4a373 });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x00a8a8 });
    const pants = new THREE.MeshLambertMaterial({ color: 0x3a3ac8 });
    const hair = new THREE.MeshLambertMaterial({ color: 0x4a2f1a });
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const pupil = new THREE.MeshLambertMaterial({ color: 0x3030c0 });

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
    head.position.y = 1.45;
    const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.52), hair);
    hairTop.position.y = 1.66;
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.02), white);
    eyeL.position.set(-0.12, 1.5, -0.26);
    const pupilL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.01), pupil);
    pupilL.position.set(-0.12, 1.5, -0.27);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.12;
    const pupilR = pupilL.clone(); pupilR.position.x = 0.12;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), shirt);
    body.position.y = 0.85;
    // 手臂：旋转轴移到肩部，自然下垂
    const armGeoL = new THREE.BoxGeometry(0.18, 0.65, 0.18); armGeoL.translate(0, -0.25, 0);
    const armL = new THREE.Mesh(armGeoL, shirt);
    armL.position.set(-0.37, 1.15, 0);
    const armGeoR = new THREE.BoxGeometry(0.18, 0.65, 0.18); armGeoR.translate(0, -0.25, 0);
    const armR = new THREE.Mesh(armGeoR, shirt);
    armR.position.set(0.37, 1.15, 0);
    // 腿：旋转轴移到髋部
    const legGeoL = new THREE.BoxGeometry(0.22, 0.55, 0.22); legGeoL.translate(0, -0.24, 0);
    const legL = new THREE.Mesh(legGeoL, pants);
    legL.position.set(-0.14, 0.52, 0);
    const legGeoR = new THREE.BoxGeometry(0.22, 0.55, 0.22); legGeoR.translate(0, -0.24, 0);
    const legR = new THREE.Mesh(legGeoR, pants);
    legR.position.set(0.14, 0.52, 0);
    group.add(head, hairTop, eyeL, pupilL, eyeR, pupilR, body, armL, armR, legL, legR);
    group.traverse((c) => { c.castShadow = true; });
    group.userData.limbs = { armL, armR, legL, legR };
    group.visible = false; // 默认第一人称，隐藏
    return group;
}

// ==================== 生物模型（原型 clone 共享：每类一只原型，几何/材质不重复） ====================
// 四肢统一挂 userData.limbs（在克隆体上按下标补挂，clone 的 userData 是深拷贝不能存引用）
const mobProtos = new Map(); // type -> Group 原型

function boxMesh(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
}

function buildZombieProto() {
    const group = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x2a6a8a });
    const pants = new THREE.MeshLambertMaterial({ color: 0x3a3a8a });
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0xff2020, emissive: 0xaa0000, emissiveIntensity: 1 });
    const head = boxMesh(0.5, 0.5, 0.5, skin, 0, 1.45, 0);
    const eyeL = boxMesh(0.08, 0.08, 0.02, eyeMat, -0.12, 1.5, -0.26);
    const eyeR = boxMesh(0.08, 0.08, 0.02, eyeMat, 0.12, 1.5, -0.26);
    const body = boxMesh(0.55, 0.7, 0.3, shirt, 0, 0.85, 0);
    const armL = boxMesh(0.18, 0.65, 0.18, skin, -0.38, 1.0, -0.25);
    armL.rotation.x = -Math.PI / 2.2;
    const armR = boxMesh(0.18, 0.65, 0.18, skin, 0.38, 1.0, -0.25);
    armR.rotation.x = -Math.PI / 2.2;
    const legL = boxMesh(0.22, 0.55, 0.22, pants, -0.14, 0.28, 0);
    const legR = boxMesh(0.22, 0.55, 0.22, pants, 0.14, 0.28, 0);
    // 子节点固定顺序：头/左眼/右眼/躯干/左臂/右臂/左腿/右腿（克隆后按下标找回四肢）
    group.add(head, eyeL, eyeR, body, armL, armR, legL, legR);
    group.userData.legLIdx = 6;
    group.userData.legRIdx = 7;
    return group;
}

function buildCreeperProto() {
    const group = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0x5f9a47 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1a3014 });
    const legMat = new THREE.MeshLambertMaterial({ color: 0x4a7a38 });
    const head = boxMesh(0.55, 0.55, 0.55, skin, 0, 1.5, 0);
    // 苦力怕脸：双眼 + 垂泪嘴（原版标志性表情）
    const eyeL = boxMesh(0.12, 0.12, 0.02, dark, -0.13, 1.55, -0.28);
    const eyeR = boxMesh(0.12, 0.12, 0.02, dark, 0.13, 1.55, -0.28);
    const mouth = boxMesh(0.14, 0.2, 0.02, dark, 0, 1.42, -0.28);
    const body = boxMesh(0.5, 0.85, 0.3, skin, 0, 0.8, 0);
    const legFL = boxMesh(0.2, 0.38, 0.2, legMat, -0.14, 0.19, -0.18);
    const legFR = boxMesh(0.2, 0.38, 0.2, legMat, 0.14, 0.19, -0.18);
    const legBL = boxMesh(0.2, 0.38, 0.2, legMat, -0.14, 0.19, 0.18);
    const legBR = boxMesh(0.2, 0.38, 0.2, legMat, 0.14, 0.19, 0.18);
    group.add(head, eyeL, eyeR, mouth, body, legFL, legFR, legBL, legBR);
    group.userData.legLIdx = 5;
    group.userData.legRIdx = 6;
    return group;
}

// 四足被动生物通用原型：横向身体 + 头 + 四条腿（配色与细节各类型自定）
function buildQuadrupedProto(bodyColor, headColor, extras) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
    const headMat = new THREE.MeshLambertMaterial({ color: headColor });
    const legMat = new THREE.MeshLambertMaterial({ color: headColor });
    const body = boxMesh(0.6, 0.5, 0.9, bodyMat, 0, 0.65, 0);
    const head = boxMesh(0.45, 0.45, 0.4, headMat, 0, 0.78, -0.6);
    group.add(body, head);
    for (const extra of extras(headMat)) group.add(extra); // 鼻口/角等细节
    const legFL = boxMesh(0.16, 0.4, 0.16, legMat, -0.18, 0.2, -0.3);
    const legFR = boxMesh(0.16, 0.4, 0.16, legMat, 0.18, 0.2, -0.3);
    const legBL = boxMesh(0.16, 0.4, 0.16, legMat, -0.18, 0.2, 0.3);
    const legBR = boxMesh(0.16, 0.4, 0.16, legMat, 0.18, 0.2, 0.3);
    group.add(legFL, legFR, legBL, legBR);
    group.userData.legLIdx = group.children.length - 4;
    group.userData.legRIdx = group.children.length - 3;
    return group;
}

function buildMobProto(type) {
    switch (type) {
        case 'zombie': return buildZombieProto();
        case 'creeper': return buildCreeperProto();
        case 'pig':
            return buildQuadrupedProto(0xe99c9a, 0xe99c9a, (headMat) => {
                const snoutMat = new THREE.MeshLambertMaterial({ color: 0xde9090 });
                const snout = boxMesh(0.2, 0.14, 0.06, snoutMat, 0, 0.72, -0.82);
                const eyeMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
                const eyeL = boxMesh(0.06, 0.06, 0.02, eyeMat, -0.12, 0.86, -0.81);
                const eyeR = boxMesh(0.06, 0.06, 0.02, eyeMat, 0.12, 0.86, -0.81);
                return [snout, eyeL, eyeR];
            });
        case 'sheep':
            return buildQuadrupedProto(0xe9e6da, 0xd8c8b0, () => {
                const eyeMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
                const eyeL = boxMesh(0.06, 0.06, 0.02, eyeMat, -0.12, 0.86, -0.81);
                const eyeR = boxMesh(0.06, 0.06, 0.02, eyeMat, 0.12, 0.86, -0.81);
                return [eyeL, eyeR];
            });
        case 'cow':
            return buildQuadrupedProto(0x6c5343, 0x8a7362, (headMat) => {
                const patchMat = new THREE.MeshLambertMaterial({ color: 0xe8e2d8 });
                const patch = boxMesh(0.3, 0.2, 0.03, patchMat, 0, 0.7, -0.81); // 白鼻斑
                const hornMat = new THREE.MeshLambertMaterial({ color: 0xd8d0c0 });
                const hornL = boxMesh(0.06, 0.06, 0.06, hornMat, -0.18, 1.02, -0.6);
                const hornR = boxMesh(0.06, 0.06, 0.06, hornMat, 0.18, 1.02, -0.6);
                const eyeMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
                const eyeL = boxMesh(0.06, 0.06, 0.02, eyeMat, -0.12, 0.86, -0.81);
                const eyeR = boxMesh(0.06, 0.06, 0.02, eyeMat, 0.12, 0.86, -0.81);
                return [patch, hornL, hornR, eyeL, eyeR];
            });
        default: return buildZombieProto();
    }
}

export function createZombieMesh() {
    return createMobMesh('zombie');
}

export function createMobMesh(type) {
    let proto = mobProtos.get(type);
    if (!proto) {
        proto = buildMobProto(type);
        mobProtos.set(type, proto);
    }
    // 原型只构建一次，之后 clone()：克隆共享几何体与材质（防刷怪泄漏）。
    // clone 会对原型 userData 做 JSON 序列化，引用不能存原型里；四肢在克隆体上按下标补挂。
    const mesh = proto.clone();
    const limbs = { legL: mesh.children[proto.userData.legLIdx], legR: mesh.children[proto.userData.legRIdx] };
    if (type === 'zombie') {
        limbs.armL = mesh.children[4];
        limbs.armR = mesh.children[5];
    }
    mesh.userData.limbs = limbs;
    return mesh;
}

// ==================== 生成与消失 ====================
export function spawnMob(type, x, y, z) {
    const def = MOB_TYPES[type];
    if (!def) return;
    if (def.hostile && state.enemies.length >= MAX_ENEMIES) return;
    const mesh = createMobMesh(type);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    state.enemies.push({
        type,
        hostile: !!def.hostile,
        x, y, z,
        vy: 0,
        hp: def.hp,
        attackTimer: 0,
        animTime: Math.random() * 10,
        mesh,
        // 游荡/逃跑（被动）与引信（苦力怕）状态
        heading: Math.random() * Math.PI * 2,
        moveTimer: 1 + Math.random() * 3,
        moving: Math.random() > 0.5,
        flee: 0,
        fuse: 0,
    });
}

// 兼容旧入口：僵尸
export function spawnEnemy(x, y, z) {
    spawnMob('zombie', x, y, z);
}

// ---- 原版风格刷怪（生存模式 · 夜晚，敌对生物）----
// 规则要点：距玩家 24~128 格环带内生成；火把照亮处不刷（近似亮度≤7）；
// 地下洞穴也可生成；成群生成（pack spawn）；32 格外冻结 AI 并随机消失；128 格外立即消失。
export function isLitByTorch(x, y, z) {
    // 近似原版"方块光照 ≤ 7 才可生成"：火把光照随曼哈顿距离衰减，6 格内视为太亮
    for (const light of state.torchLights.values()) {
        const lp = light.position;
        const d = Math.abs(lp.x - x) + Math.abs(lp.y - y) + Math.abs(lp.z - z);
        if (d <= TORCH_SPAWN_BLOCK_RADIUS) return true;
    }
    return false;
}

// 扫描一列，收集所有合法生成高度（脚下实心、身体两格空气、不泡水、不太亮）
export function findSpawnSpotsInColumn(bx, bz) {
    const spots = [];
    for (let y = 1; y < WORLD_HEIGHT - 2; y++) {
        if (!isSolid(getBlock(bx, y - 1, bz))) continue;          // 脚下必须实心
        if (getBlock(bx, y, bz) !== BlockTypes.AIR) continue;     // 脚部必须空气（排除水/半埋）
        if (getBlock(bx, y + 1, bz) !== BlockTypes.AIR) continue; // 头部必须空气
        if (isLitByTorch(bx + 0.5, y, bz + 0.5)) continue;        // 火把照亮处不刷
        spots.push(y);
    }
    return spots;
}

// 在指定列尝试生成：随机选一个合法高度，成功后按原版 pack spawn 再带 0~3 只同伴
export function attemptSpawnAt(bx, bz) {
    const spots = findSpawnSpotsInColumn(bx, bz);
    if (spots.length === 0) return;
    const y0 = spots[Math.floor(Math.random() * spots.length)];
    spawnEnemy(bx + 0.5, y0, bz + 0.5);
    for (let i = 0; i < PACK_SPAWN_TRIES; i++) {
        if (state.enemies.length >= MAX_ENEMIES) return;
        const px = bx + Math.floor(Math.random() * 7) - 3;
        const pz = bz + Math.floor(Math.random() * 7) - 3;
        if (px < 2 || px >= WORLD_WIDTH - 2 || pz < 2 || pz >= WORLD_DEPTH - 2) continue;
        const pspots = findSpawnSpotsInColumn(px, pz);
        if (pspots.length === 0) continue;
        const py = pspots[Math.floor(Math.random() * pspots.length)];
        // 夜晚成群怪物里三成是苦力怕（混合威胁更好玩）
        spawnMob(Math.random() < 0.3 ? 'creeper' : 'zombie', px + 0.5, py, pz + 0.5);
    }
}

// 每游戏刻（50ms）调用：在 24~128 格环带内随机取列尝试生成敌对生物（生存·夜晚）
export function mobSpawnTick() {
    if (state.enemies.length >= MAX_ENEMIES) return;
    const p = state.player;
    for (let i = 0; i < SPAWN_ATTEMPTS_PER_TICK; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
        const bx = Math.floor(p.x + Math.cos(angle) * dist);
        const bz = Math.floor(p.z + Math.sin(angle) * dist);
        if (bx < 2 || bx >= WORLD_WIDTH - 2 || bz < 2 || bz >= WORLD_DEPTH - 2) continue;
        attemptSpawnAt(bx, bz);
        if (state.enemies.length >= MAX_ENEMIES) return;
    }
}

// 被动生物补充（白天·草地，创造模式也刷——风景与食物来源）：16~48 格环带
function passiveSpawnTick() {
    const passives = state.enemies.filter((e) => !e.hostile);
    if (passives.length >= MAX_PASSIVE_MOBS) return;
    const p = state.player;
    const angle = Math.random() * Math.PI * 2;
    const dist = 16 + Math.random() * 32;
    const bx = Math.floor(p.x + Math.cos(angle) * dist);
    const bz = Math.floor(p.z + Math.sin(angle) * dist);
    if (bx < 2 || bx >= WORLD_WIDTH - 2 || bz < 2 || bz >= WORLD_DEPTH - 2) return;
    // 脚下必须是草方块（不在沙漠/雪山/水边刷家畜）
    for (let y = WORLD_HEIGHT - 2; y >= 1; y--) {
        if (getBlock(bx, y, bz) === BlockTypes.GRASS &&
            getBlock(bx, y + 1, bz) === BlockTypes.AIR && getBlock(bx, y + 2, bz) === BlockTypes.AIR) {
            const types = ['pig', 'sheep', 'cow'];
            const type = types[Math.floor(Math.random() * types.length)];
            // 小群生成：1~3 只同种家畜
            const n = 1 + Math.floor(Math.random() * 3);
            for (let i = 0; i < n && state.enemies.filter((e) => !e.hostile).length < MAX_PASSIVE_MOBS; i++) {
                spawnMob(type, bx + 0.5 + (Math.random() - 0.5) * 2, y + 1, bz + 0.5 + (Math.random() - 0.5) * 2);
            }
            return;
        }
        if (getBlock(bx, y, bz) !== BlockTypes.AIR) return; // 撞到非草表面（沙/雪/水）就不刷
    }
}

// 消失逻辑（每游戏刻）：敌对 >128 格立即消失、>32 格每刻 1/800 概率消失；
// 被动生物离得太远（>96 格）静默回收，玩家走近会再补充
export function despawnTick() {
    const p = state.player;
    for (let i = state.enemies.length - 1; i >= 0; i--) {
        const e = state.enemies[i];
        const dist = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z);
        if (e.hostile) {
            if (dist > SPAWN_MAX_DIST || (dist > LAZY_DIST && Math.random() < DESPAWN_CHANCE)) {
                killEnemySilent(e);
            }
        } else if (dist > 96) {
            killEnemySilent(e);
        }
    }
}

// ==================== 受击与死亡 ====================
export function damageEnemy(e, dmg) {
    e.hp -= dmg;
    playHitSound();
    // 击退
    const dx = e.x - state.player.x;
    const dz = e.z - state.player.z;
    const len = Math.hypot(dx, dz) || 1;
    e.x += dx / len * 0.5;
    e.z += dz / len * 0.5;
    if (!e.hostile) e.flee = 3; // 被动生物被打就逃（远离玩家 3 秒）
    if (e.hp <= 0) killEnemy(e);
}

export function killEnemy(e, exploded = false) {
    scene.remove(e.mesh);
    const idx = state.enemies.indexOf(e);
    if (idx >= 0) state.enemies.splice(idx, 1);
    const def = MOB_TYPES[e.type] || {};
    // 掉落物走真物品实体（items.js：落地/磁吸/自动入包）；自爆的苦力怕不掉东西
    if (!exploded && def.drops && !isCreative()) {
        for (const [itemId, chance, extraMax] of def.drops) {
            if (Math.random() < chance) {
                const count = 1 + Math.floor(Math.random() * (extraMax + 1));
                spawnItemDrop(e.x, e.y + 0.5, e.z, itemId, count);
            }
        }
    }
    if (e.hostile) {
        addXp(XP_PER_HOSTILE_KILL);
        showTooltip(`💀 击杀了${def.name || '怪物'}！`);
    }
    spawnBreakParticles(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z),
        e.type === 'creeper' ? BlockTypes.SLIME : BlockTypes.LEAVES);
}

export function killEnemySilent(e) {
    scene.remove(e.mesh);
    const idx = state.enemies.indexOf(e);
    if (idx >= 0) state.enemies.splice(idx, 1);
}

// ==================== 每帧驱动 ====================
export function updateEnemies(dt) {
    const p = state.player;
    const night = isNight();

    // 白天：敌对生物着火消散（被动生物常驻）
    if (!night) {
        for (let i = state.enemies.length - 1; i >= 0; i--) {
            const e = state.enemies[i];
            if (!e.hostile) continue;
            spawnBreakParticles(Math.floor(e.x), Math.floor(e.y) + 1, Math.floor(e.z), BlockTypes.LOG);
            killEnemySilent(e);
        }
        state.enemySpawnTimer = 0;
    }

    // 刷怪与消失（按游戏刻 50ms 驱动）：敌对 = 生存·夜晚；被动 = 任意模式·白天草地
    if (!p.dead) {
        state.enemySpawnTimer += dt;
        while (state.enemySpawnTimer >= TICK_RATE) {
            state.enemySpawnTimer -= TICK_RATE;
            if (night && !isCreative()) {
                mobSpawnTick();
                despawnTick();
            } else {
                passiveSpawnTick();
                despawnTick();
            }
        }
    }

    // 快照遍历：苦力怕自爆会连环伤害/移除其它生物（explode→damageEnemy→killEnemy），原地 splices 会跳号
    for (const e of [...state.enemies]) {
        if (!state.enemies.includes(e)) continue; // 已被本帧的爆炸链带走
        const def = MOB_TYPES[e.type] || {};
        const dx = p.x - e.x;
        const dz = p.z - e.z;
        const dist = Math.hypot(dx, dz);
        // 懒惰距离（>32 格）：冻结 AI，原地站立（仍受重力、可被随机消失）
        const frozen = dist > LAZY_DIST;
        let stepX = 0, stepZ = 0;

        if (!frozen && !p.dead) {
            if (e.hostile) {
                // 敌对：追踪玩家（僵尸贴脸攻击，苦力怕贴脸引信后站定）
                const chasing = e.type === 'creeper' && e.fuse > 0 ? 0 : 1;
                stepX = dx / dist * def.speed * chasing;
                stepZ = dz / dist * def.speed * chasing;
                if (e.type === 'zombie' && dist < ENEMY_ATTACK_RANGE && Math.abs(p.y - e.y) < 2) {
                    e.attackTimer -= dt;
                    if (e.attackTimer <= 0) {
                        e.attackTimer = 1.0;
                        damagePlayer(ENEMY_DAMAGE);
                    }
                } else if (e.type === 'creeper') {
                    // 引信：贴近（fuseDist 内）持续充能，离开则缓慢泄压；充满即自爆
                    if (dist < def.fuseDist && Math.abs(p.y - e.y) < 2) {
                        e.fuse += dt;
                        // 引信视觉：膨胀闪烁 + 撕撕冒烟
                        const pulse = 1 + Math.sin(e.fuse * 24) * 0.12 + e.fuse * 0.06;
                        e.mesh.scale.setScalar(pulse);
                        if (Math.random() < dt * 8) {
                            spawnBreakParticles(Math.floor(e.x), Math.floor(e.y) + 1.2, Math.floor(e.z), BlockTypes.TNT);
                        }
                        if (e.fuse > def.fuseSec) {
                            const ex = e.x, ey = e.y + 0.7, ez = e.z;
                            killEnemy(e, true);
                            explode(Math.floor(ex), Math.floor(ey), Math.floor(ez)); // 复用 TNT 爆炸（破坏方块+伤害+重建网格）
                            showTooltip('💥 苦力怕爆炸了！');
                            continue;
                        }
                    } else if (e.fuse > 0) {
                        e.fuse = Math.max(0, e.fuse - dt * 0.8);
                        e.mesh.scale.setScalar(1);
                    }
                }
            } else {
                // 被动：随机游荡；被打（flee>0）时远离玩家快跑
                e.moveTimer -= dt;
                if (e.moveTimer <= 0) {
                    e.moveTimer = 1.5 + Math.random() * 4.5;
                    e.moving = Math.random() > 0.42;
                    if (e.moving) e.heading += (Math.random() - 0.5) * 2.5;
                }
                if (e.flee > 0) {
                    e.flee -= dt;
                    e.heading = Math.atan2(-dx, -dz); // 背向玩家逃跑
                    stepX = Math.sin(e.heading) * 1.9;
                    stepZ = Math.cos(e.heading) * 1.9;
                } else if (e.moving) {
                    stepX = Math.sin(e.heading) * def.speed * 0.5;
                    stepZ = Math.cos(e.heading) * def.speed * 0.5;
                }
            }
        }

        // 水平移动 + 前方有墙跳上去（游荡的被动生物撞墙就换向）
        if (stepX || stepZ) {
            const nx = e.x + stepX * dt;
            const nz = e.z + stepZ * dt;
            const bx = Math.floor(nx);
            const bz = Math.floor(nz);
            const by = Math.floor(e.y);
            if (isSolid(getBlock(bx, by, bz)) && !isSolid(getBlock(bx, by + 1, bz)) && !isSolid(getBlock(bx, by + 2, bz))) {
                e.vy = 6.5;
            } else if (!isSolid(getBlock(bx, by, bz)) && !isSolid(getBlock(bx, by + 1, bz))) {
                e.x = nx;
                e.z = nz;
            } else if (!e.hostile) {
                e.heading += Math.PI / 2 + Math.random(); // 撞墙：换向
            }
        }

        // 重力
        e.vy -= 22 * dt;
        const newY = e.y + e.vy * dt;
        if (e.vy <= 0) {
            let groundY = -1;
            for (let y = Math.floor(e.y); y >= Math.max(0, Math.floor(newY) - 1); y--) {
                if (isSolid(getBlock(Math.floor(e.x), y, Math.floor(e.z)))) { groundY = y + 1; break; }
            }
            if (groundY >= 0 && newY <= groundY) {
                e.y = groundY;
                e.vy = 0;
            } else {
                e.y = Math.max(0.5, newY);
            }
        } else {
            e.y = newY;
            e.vy = 0; // 顶头
        }

        // 动画与朝向
        const moving = !!(stepX || stepZ);
        e.animTime += frozen || !moving ? 0 : dt;
        const limbs = e.mesh.userData.limbs;
        if (limbs) {
            const swing = Math.sin(e.animTime * 8) * 0.5;
            limbs.legL.rotation.x = swing;
            limbs.legR.rotation.x = -swing;
            if (limbs.armL) { // 僵尸前平举的双手
                limbs.armL.rotation.x = -Math.PI / 2.2 + swing * 0.3;
                limbs.armR.rotation.x = -Math.PI / 2.2 - swing * 0.3;
            }
        }
        e.mesh.position.set(e.x, e.y, e.z);
        e.mesh.rotation.y = e.hostile ? Math.atan2(dx, dz) + Math.PI : (e.heading + Math.PI);
    }
}

// ---- 供 main.js 调用：创建玩家模型并加入场景（避免跨模块给 let 绑定赋值）----
export function initPlayerMesh() {
    playerMesh = createPlayerMesh();
    scene.add(playerMesh);
}
