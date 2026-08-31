// ==================== entities.js ====================

import * as THREE from 'three';
import { BlockTypes, DESPAWN_CHANCE, ENEMY_ATTACK_RANGE, ENEMY_DAMAGE, ENEMY_SPEED, LAZY_DIST, MAX_ENEMIES, PACK_SPAWN_TRIES, SPAWN_ATTEMPTS_PER_TICK, SPAWN_MAX_DIST, SPAWN_MIN_DIST, TICK_RATE, TORCH_SPAWN_BLOCK_RADIUS, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { isCreative, isNight, state } from './state.js';
import { scene } from './engine.js';
import { getBlock } from './world.js';
import { getPropMesh, isSolid } from './chunk.js';
import { spawnBreakParticles } from './particles.js';
import { playHitSound } from './audio.js';
import { damagePlayer } from './playerLife.js';
import { showTooltip } from './ui.js';

// ==================== 敌人系统（僵尸） ====================
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

export function createZombieMesh() {
    const group = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x2a6a8a });
    const pants = new THREE.MeshLambertMaterial({ color: 0x3a3a8a });
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0xff2020, emissive: 0xaa0000, emissiveIntensity: 1 });

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
    head.position.y = 1.45;
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), eyeMat);
    eyeL.position.set(-0.12, 1.5, -0.26);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), eyeMat);
    eyeR.position.set(0.12, 1.5, -0.26);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), shirt);
    body.position.y = 0.85;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.18), skin);
    armL.position.set(-0.38, 1.0, -0.25);
    armL.rotation.x = -Math.PI / 2.2;
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.18), skin);
    armR.position.set(0.38, 1.0, -0.25);
    armR.rotation.x = -Math.PI / 2.2;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 0.22), pants);
    legL.position.set(-0.14, 0.28, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 0.22), pants);
    legR.position.set(0.14, 0.28, 0);
    group.add(head, eyeL, eyeR, body, armL, armR, legL, legR);
    group.traverse((c) => { c.castShadow = true; });
    group.userData.limbs = { armL, armR, legL, legR };
    return group;
}

export function spawnEnemy(x, y, z) {
    if (state.enemies.length >= MAX_ENEMIES) return;
    const mesh = createZombieMesh();
    mesh.position.set(x, y, z);
    scene.add(mesh);
    state.enemies.push({
        x, y, z,
        vy: 0,
        hp: 10,
        attackTimer: 0,
        animTime: Math.random() * 10,
        mesh,
    });
}

// ---- 原版风格刷怪（生存模式 · 夜晚）----
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
        spawnEnemy(px + 0.5, py, pz + 0.5);
    }
}

// 每游戏刻（50ms）调用：在 24~128 格环带内随机取列尝试生成
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

// 消失逻辑（每游戏刻）：>128 格立即消失；>32 格每刻 1/800 概率消失；32 格内安全
export function despawnTick() {
    const p = state.player;
    for (let i = state.enemies.length - 1; i >= 0; i--) {
        const e = state.enemies[i];
        const dist = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z);
        if (dist > SPAWN_MAX_DIST) {
            killEnemySilent(e);
        } else if (dist > LAZY_DIST && Math.random() < DESPAWN_CHANCE) {
            killEnemySilent(e);
        }
    }
}

export function damageEnemy(e, dmg) {
    e.hp -= dmg;
    playHitSound();
    // 击退
    const dx = e.x - state.player.x;
    const dz = e.z - state.player.z;
    const len = Math.hypot(dx, dz) || 1;
    e.x += dx / len * 0.5;
    e.z += dz / len * 0.5;
    if (e.hp <= 0) killEnemy(e);
}

export function killEnemy(e) {
    scene.remove(e.mesh);
    const idx = state.enemies.indexOf(e);
    if (idx >= 0) state.enemies.splice(idx, 1);
    // 掉落物：花（3 秒后自动消失，纯装饰纪念）
    const key = `${Math.floor(e.x)},${Math.floor(e.y)},${Math.floor(e.z)}`;
    if (getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) === BlockTypes.AIR) {
        const m = getPropMesh(BlockTypes.FLOWER);
        if (m) {
            m.position.set(Math.floor(e.x) + 0.5, Math.floor(e.y), Math.floor(e.z) + 0.5);
            scene.add(m);
            state.droppedItems.push({ x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z), mesh: m, prop: false, life: 6 });
        }
    }
    spawnBreakParticles(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z), BlockTypes.LEAVES);
    showTooltip('💀 击杀怪物！');
}

export function updateEnemies(dt) {
    const p = state.player;
    const night = isNight();

    // 白天：怪物着火消散
    if (!night) {
        for (let i = state.enemies.length - 1; i >= 0; i--) {
            const e = state.enemies[i];
            spawnBreakParticles(Math.floor(e.x), Math.floor(e.y) + 1, Math.floor(e.z), BlockTypes.LOG);
            killEnemySilent(e);
        }
        state.enemySpawnTimer = 0;
        return;
    }

    // 夜晚刷怪与消失（仅生存模式）：按游戏刻（TICK_RATE = 50ms）驱动，对齐原版节奏
    if (!isCreative() && !p.dead) {
        state.enemySpawnTimer += dt;
        while (state.enemySpawnTimer >= TICK_RATE) {
            state.enemySpawnTimer -= TICK_RATE;
            mobSpawnTick();
            despawnTick();
        }
    }

    for (const e of state.enemies) {
        // 追踪玩家
        const dx = p.x - e.x;
        const dz = p.z - e.z;
        const dist = Math.hypot(dx, dz);
        // 懒惰距离（>32 格）：冻结 AI，原地站立（仍受重力、可被随机消失）
        const frozen = dist > LAZY_DIST;
        if (!frozen && dist > 0.3) {
            const step = ENEMY_SPEED * dt;
            const nx = e.x + dx / dist * step;
            const nz = e.z + dz / dist * step;
            const bx = Math.floor(nx);
            const bz = Math.floor(nz);
            const by = Math.floor(e.y);
            // 前方有墙则尝试跳上去
            if (isSolid(getBlock(bx, by, bz)) && !isSolid(getBlock(bx, by + 1, bz)) && !isSolid(getBlock(bx, by + 2, bz))) {
                e.vy = 6.5;
            } else if (!isSolid(getBlock(bx, by, bz)) && !isSolid(getBlock(bx, by + 1, bz))) {
                e.x = nx;
                e.z = nz;
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

        // 攻击玩家
        e.attackTimer -= dt;
        const dyPlayer = Math.abs(p.y - e.y);
        if (dist < ENEMY_ATTACK_RANGE && dyPlayer < 2 && e.attackTimer <= 0 && !p.dead) {
            e.attackTimer = 1.0;
            damagePlayer(ENEMY_DAMAGE);
        }

        // 动画与朝向
        e.animTime += frozen ? 0 : dt; // 冻结时不摆动手脚
        const limbs = e.mesh.userData.limbs;
        if (limbs) {
            const swing = Math.sin(e.animTime * 8) * 0.5;
            limbs.legL.rotation.x = swing;
            limbs.legR.rotation.x = -swing;
            limbs.armL.rotation.x = -Math.PI / 2.2 + swing * 0.3;
            limbs.armR.rotation.x = -Math.PI / 2.2 - swing * 0.3;
        }
        e.mesh.position.set(e.x, e.y, e.z);
        e.mesh.rotation.y = Math.atan2(dx, dz) + Math.PI;
    }
}

export function killEnemySilent(e) {
    scene.remove(e.mesh);
    const idx = state.enemies.indexOf(e);
    if (idx >= 0) state.enemies.splice(idx, 1);
}

// ---- 供 main.js 调用：创建玩家模型并加入场景（避免跨模块给 let 绑定赋值）----
export function initPlayerMesh() {
    playerMesh = createPlayerMesh();
    scene.add(playerMesh);
}
