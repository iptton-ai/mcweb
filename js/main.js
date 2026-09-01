// ==================== main.js ====================

import { BlockTypes, CHUNK_SIZE, GameModes, MAX_HEALTH, PLAYER_EYE_HEIGHT, TICK_RATE, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { state } from './state.js';
import { camera, canvas, renderer, scene } from './engine.js';
import { generateWorld, getBlock, setBlockSafe } from './world.js';
import { isSolid, rebuildChunk, updateChunkMeshes } from './chunk.js';
import { breakBlock, placeBlock } from './interaction.js';
import { initParticles, updateParticles } from './particles.js';
import { initAudio } from './audio.js';
import { createPlayerMesh, initPlayerMesh, killEnemySilent, updateEnemies } from './entities.js';
import { updateTnt } from './tnt.js';
import { respawn, updateDroppedItems, updateHealthUI } from './playerLife.js';
import { updatePlayerMesh, updatePlayerPhysics } from './playerPhysics.js';
import { hideStartScreen, mouseDown, mouseLocked, mouseMoveDelta, setupInput } from './input.js';
import { setGameMode, showTooltip, updateBuildWidget, updateDebugInfo, updateHotbar, initBuildWidget } from './ui.js';
import { updateDayNightCycle } from './daynight.js';
import { updateHighlight } from './highlight.js';
import { updateBuild } from './buildQueue.js';
import { deleteSave, hasSave, initAutoSave, loadGame, saveGame, saveTimeText } from './saveGame.js';

// ==================== 游戏循环 ====================
let lastTime = 0;

let accumulator = 0;

function gameLoop(timestamp) {
    requestAnimationFrame(gameLoop);
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;

    // FPS计数
    state.fpsCounter++;
    state.fpsTimer += dt;
    if (state.fpsTimer >= 0.5) {
        state.fps = Math.round(state.fpsCounter / state.fpsTimer);
        state.fpsCounter = 0;
        state.fpsTimer = 0;
    }

    // 视角更新
    if (mouseLocked && !state.player.inventoryOpen) {
        const sensitivity = 0.0022;
        state.player.yaw -= mouseMoveDelta.x * sensitivity;
        state.player.pitch -= mouseMoveDelta.y * sensitivity;
        const maxPitch = Math.PI / 2 - 0.01;
        state.player.pitch = Math.max(-maxPitch, Math.min(maxPitch, state.player.pitch));
        mouseMoveDelta.x = 0;
        mouseMoveDelta.y = 0;
    }

    // 连续破坏/放置
    if (mouseLocked && !state.player.inventoryOpen) {
        if (mouseDown.left) {
            accumulator += dt;
            if (accumulator > TICK_RATE) {
                breakBlock();
                accumulator = 0;
            }
        } else {
            accumulator = 0;
        }
        if (mouseDown.right) {
            placeBlock();
            mouseDown.right = false; // 防止连续放置
        }
    }

    // 玩家物理
    updatePlayerPhysics(dt);

    // 玩家模型（第三人称）
    updatePlayerMesh(dt);

    // 昼夜循环
    updateDayNightCycle(dt);

    // 敌人 / TNT / 掉落物
    if (state.player.attackCooldown > 0) state.player.attackCooldown -= dt;
    if (state.player.invulnTimer > 0) state.player.invulnTimer -= dt;
    updateEnemies(dt);
    updateTnt(dt);
    updateDroppedItems(dt);

    // AI 施工队列（渐进放置 + 分帧重建网格）
    updateBuild(dt);

    // 粒子更新
    updateParticles(dt);

    // 高亮更新
    updateHighlight();

    // 调试信息
    updateDebugInfo();

    // 施工进度控件（AI 建造时顶部显示）
    updateBuildWidget();

    // 渲染
    renderer.render(scene, camera);
}

// ==================== 初始化 ====================
// 生成全新世界：地形 + 出生点 + 出生点火把（无存档启动、或开始界面选「新世界」时调用）
function freshWorld() {
    generateWorld();

    // 渲染所有区块
    updateChunkMeshes();

    // 设置玩家初始位置
    let spawnX = WORLD_WIDTH / 2;
    let spawnZ = WORLD_DEPTH / 2;
    let spawnY = 0;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const block = getBlock(Math.floor(spawnX), y, Math.floor(spawnZ));
        if (block !== BlockTypes.AIR && block !== BlockTypes.WATER) {
            spawnY = y + 1;
            break;
        }
    }
    state.player.x = spawnX;
    state.player.y = spawnY;
    state.player.z = spawnZ;
    state.spawn = { x: spawnX, y: spawnY, z: spawnZ };
    camera.position.set(spawnX, spawnY + PLAYER_EYE_HEIGHT, spawnZ);
    camera.lookAt(spawnX + 10, spawnY + PLAYER_EYE_HEIGHT, spawnZ + 10);
    camera.rotation.z = 0; // lookAt 可能引入滚转，立即清零

    // 在出生点旁插两支火把照明
    const torchOffsets = [[2, 0], [-2, 1]];
    for (const [ox, oz] of torchOffsets) {
        const tx = Math.floor(spawnX) + ox;
        const tz = Math.floor(spawnZ) + oz;
        for (let y = WORLD_HEIGHT - 1; y >= 1; y--) {
            if (isSolid(getBlock(tx, y, tz)) && getBlock(tx, y + 1, tz) === BlockTypes.AIR && getBlock(tx, y + 2, tz) === BlockTypes.AIR) {
                setBlockSafe(tx, y + 1, tz, BlockTypes.TORCH);
                break;
            }
        }
    }
    // 重建出生点所在区块让火把生效
    rebuildChunk(Math.floor(spawnX / CHUNK_SIZE), Math.floor(spawnZ / CHUNK_SIZE));

    // 重置到初始进度（可能刚从读档状态选择重开新世界）
    state.time = 0;
    const p = state.player;
    p.health = MAX_HEALTH;
    p.dead = false;
    p.flying = false;
    p.selectedSlot = 0;
    p.inventory = {};
}

// 放弃当前世界与存档，按所选模式开新世界
function startNewWorld(mode, tip) {
    deleteSave();
    freshWorld();
    // 清掉旧世界残留的怪物（网格与实体一起移除，避免残留场景）
    for (let i = state.enemies.length - 1; i >= 0; i--) killEnemySilent(state.enemies[i]);
    setGameMode(mode);
    hideStartScreen();
    canvas.requestPointerLock();
    showTooltip(tip);
}

function init() {
    // 初始化粒子
    initParticles();

    // 初始化音频
    initAudio();

    // 有存档则恢复世界与玩家，否则生成新世界
    if (!loadGame()) {
        freshWorld();
    }

    // 创建玩家模型（第三人称用）：import 绑定是只读的，赋值必须走模块内的 initPlayerMesh
    initPlayerMesh();

    // UI
    updateHotbar();
    updateHealthUI();
    setupInput();
    initBuildWidget();

    // 窗口大小调整
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // 开始界面：模式选择按钮（选模式 = 放弃当前存档开新世界）
    document.getElementById('btn-creative').addEventListener('click', (e) => {
        e.stopPropagation();
        startNewWorld(GameModes.CREATIVE, '🏗️ 新世界 · 建造模式：按 F 飞行，M 切换模式');
    });
    document.getElementById('btn-survival').addEventListener('click', (e) => {
        e.stopPropagation();
        startNewWorld(GameModes.SURVIVAL, '⚔️ 新世界 · 生存模式：小心夜晚的怪物！');
    });
    // 继续游戏：世界在启动时已从存档恢复，直接进入
    document.getElementById('btn-continue').addEventListener('click', (e) => {
        e.stopPropagation();
        hideStartScreen();
        canvas.requestPointerLock();
        showTooltip('📂 已读取存档，欢迎回来');
    });
    // 手动保存：停留在开始界面，方便存完直接关页面
    document.getElementById('btn-save').addEventListener('click', (e) => {
        e.stopPropagation();
        showTooltip(saveGame() ? '💾 进度已保存，可放心关闭页面' : '⚠️ 存档失败：浏览器存储空间不足');
    });
    document.getElementById('start-screen').addEventListener('click', () => {
        // 以当前世界进入（可能是读档恢复的，也可能是新世界）
        hideStartScreen();
        canvas.requestPointerLock();
        showTooltip('WASD 移动 | 左键破坏/攻击 | 右键放置');
    });
    document.getElementById('respawn-btn').addEventListener('click', () => {
        respawn();
    });

    // 存在存档时：显示「继续游戏」入口，并把模式按钮标注为开新世界
    if (hasSave()) {
        document.getElementById('btn-continue').style.display = '';
        const t = saveTimeText();
        if (t) document.getElementById('continue-desc').textContent = `上次保存：${t}`;
        document.querySelector('#btn-creative .mode-desc').textContent = '放弃当前存档 · 开新世界';
        document.querySelector('#btn-survival .mode-desc').textContent = '放弃当前存档 · 开新世界';
    }

    // 自动存档（定时 + 页面隐藏/关闭兜底）
    initAutoSave();

    // 启动游戏循环
    requestAnimationFrame(gameLoop);
}

init();

console.log('⛏ Minecraft 网页复刻版已启动！');

console.log('世界大小: ' + WORLD_WIDTH + 'x' + WORLD_DEPTH + 'x' + WORLD_HEIGHT);

console.log('方块类型: ' + Object.keys(BlockTypes).length);

console.log('操作: WASD移动 | 鼠标破坏/放置 | E物品栏 | F飞行(建造) | M切换模式 | F5/V切换视角');
