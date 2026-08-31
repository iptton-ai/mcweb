// ==================== main.js ====================

import { BlockTypes, CHUNK_SIZE, GameModes, PLAYER_EYE_HEIGHT, TICK_RATE, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { state } from './state.js';
import { camera, canvas, renderer, scene } from './engine.js';
import { generateWorld, getBlock, setBlockSafe } from './world.js';
import { isSolid, rebuildChunk, updateChunkMeshes } from './chunk.js';
import { breakBlock, placeBlock } from './interaction.js';
import { initParticles, updateParticles } from './particles.js';
import { initAudio } from './audio.js';
import { createPlayerMesh, playerMesh, updateEnemies } from './entities.js';
import { updateTnt } from './tnt.js';
import { respawn, updateDroppedItems, updateHealthUI } from './playerLife.js';
import { updatePlayerMesh, updatePlayerPhysics } from './playerPhysics.js';
import { hideStartScreen, mouseDown, mouseLocked, mouseMoveDelta, setupInput } from './input.js';
import { setGameMode, showTooltip, updateDebugInfo, updateHotbar } from './ui.js';
import { updateDayNightCycle } from './daynight.js';
import { updateHighlight } from './highlight.js';

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

    // 粒子更新
    updateParticles(dt);

    // 高亮更新
    updateHighlight();

    // 调试信息
    updateDebugInfo();

    // 渲染
    renderer.render(scene, camera);
}

// ==================== 初始化 ====================
function init() {
    // 生成世界
    generateWorld();

    // 初始化粒子
    initParticles();

    // 初始化音频
    initAudio();

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

    // 创建玩家模型（第三人称用）
    playerMesh = createPlayerMesh();
    scene.add(playerMesh);

    // UI
    updateHotbar();
    updateHealthUI();
    setupInput();

    // 窗口大小调整
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // 开始界面：模式选择按钮
    document.getElementById('btn-creative').addEventListener('click', (e) => {
        e.stopPropagation();
        setGameMode(GameModes.CREATIVE);
        hideStartScreen();
        canvas.requestPointerLock();
        showTooltip('🏗️ 建造模式：按 F 飞行，M 切换模式');
    });
    document.getElementById('btn-survival').addEventListener('click', (e) => {
        e.stopPropagation();
        setGameMode(GameModes.SURVIVAL);
        hideStartScreen();
        canvas.requestPointerLock();
        showTooltip('⚔️ 生存模式：小心夜晚的怪物！');
    });
    document.getElementById('start-screen').addEventListener('click', () => {
        hideStartScreen();
        canvas.requestPointerLock();
        showTooltip('WASD 移动 | 左键破坏/攻击 | 右键放置');
    });
    document.getElementById('respawn-btn').addEventListener('click', () => {
        respawn();
    });

    // 启动游戏循环
    requestAnimationFrame(gameLoop);
}

init();

console.log('⛏ Minecraft 网页复刻版已启动！');

console.log('世界大小: ' + WORLD_WIDTH + 'x' + WORLD_DEPTH + 'x' + WORLD_HEIGHT);

console.log('方块类型: ' + Object.keys(BlockTypes).length);

console.log('操作: WASD移动 | 鼠标破坏/放置 | E物品栏 | F飞行(建造) | M切换模式 | F5/V切换视角');
