// ==================== main.js ====================

import { BlockTypes, CHUNK_SIZE, GameModes, MAX_HEALTH, PLAYER_EYE_HEIGHT, TICK_RATE, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { state } from './state.js';
import { camera, renderer, scene } from './engine.js';
import { generateWorld, getBlock, setBlockSafe } from './world.js';
import { isSolid, rebuildChunk, updateChunkMeshes } from './chunk.js';
import { breakBlock, placeBlock } from './interaction.js';
import { initParticles, updateParticles } from './particles.js';
import { initAudio } from './audio.js';
import { createPlayerMesh, initPlayerMesh, killEnemySilent, updateEnemies } from './entities.js';
import { updateTnt } from './tnt.js';
import { respawn, updateDroppedItems, updateHealthUI } from './playerLife.js';
import { updatePlayerMesh, updatePlayerPhysics } from './playerPhysics.js';
import { mouseDown, mouseMoveDelta, setupInput } from './input.js';
import { getUIState, initUIModal, mouseLocked, onUIStateChange, setState } from './uiModal.js';
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

    // 视角更新（锁定即 playing，浮层状态下指针必然未锁定，由 uiModal 统一保证）
    if (mouseLocked) {
        const sensitivity = 0.0022;
        state.player.yaw -= mouseMoveDelta.x * sensitivity;
        state.player.pitch -= mouseMoveDelta.y * sensitivity;
        const maxPitch = Math.PI / 2 - 0.01;
        state.player.pitch = Math.max(-maxPitch, Math.min(maxPitch, state.player.pitch));
        mouseMoveDelta.x = 0;
        mouseMoveDelta.y = 0;
    }

    // 连续破坏/放置
    if (mouseLocked) {
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
    setState('playing');
    showTooltip(tip);
}

// 暂停菜单里「开新世界」是危险操作：第一次点击只做警示并高亮按钮文案，再点一次才执行
let newWorldArmed = null;
function confirmNewWorld(btnId) {
    if (getUIState() !== 'pause') return true; // 首屏没有可放弃的对局，直接进入
    if (newWorldArmed === btnId) {
        newWorldArmed = null;
        return true;
    }
    newWorldArmed = btnId;
    document.querySelector(`#${btnId} .mode-desc`).textContent = '⚠️ 再点一次：放弃当前存档并重开新世界';
    setTimeout(() => {
        if (newWorldArmed === btnId) {
            newWorldArmed = null;
            refreshMenuTexts();
        }
    }, 4000);
    return false;
}

// 暂停菜单 / 首屏文案：暂停态以「回到游戏」为主操作；文案随状态每次显示时刷新
function refreshMenuTexts() {
    const pause = getUIState() === 'pause';
    const btnContinue = document.getElementById('btn-continue');
    btnContinue.style.display = '';
    const desc = pause
        ? '回到当前世界 · 每 30 秒自动存档'
        : (hasSave() ? `上次保存：${saveTimeText() || '未知时间'}` : '读取上次保存的世界');
    btnContinue.innerHTML =
        `<span class="mode-icon">${pause ? '▶' : '📂'}</span>${pause ? '回到游戏' : '继续游戏'}` +
        `<span class="mode-desc">${desc}</span>`;
    if (!pause && !hasSave()) btnContinue.style.display = 'none';
    document.querySelector('#start-screen .click-hint').textContent = pause
        ? '🖱 点击空白处回到游戏'
        : '🖱 点击空白处可直接进入当前世界';
    document.querySelector('#btn-creative .mode-desc').textContent = pause
        ? '放弃当前存档 · 重开新世界'
        : (hasSave() ? '放弃当前存档 · 开新世界' : '无限方块 · 按 F 自由飞行 · 不会受伤');
    document.querySelector('#btn-survival .mode-desc').textContent = pause
        ? '放弃当前存档 · 重开新世界'
        : (hasSave() ? '放弃当前存档 · 开新世界' : '有生命值 · 夜晚会刷出怪物袭击');
}

function init() {
    // UI 模态状态机最先初始化（统一管理浮层显隐与指针锁）
    initUIModal();

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

    // 开始界面 / 暂停菜单：模式选择按钮（暂停态下开新世界需二次确认）
    document.getElementById('btn-creative').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirmNewWorld('btn-creative')) return;
        startNewWorld(GameModes.CREATIVE, '🏗️ 新世界 · 建造模式：按 F 飞行，M 切换模式');
    });
    document.getElementById('btn-survival').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirmNewWorld('btn-survival')) return;
        startNewWorld(GameModes.SURVIVAL, '⚔️ 新世界 · 生存模式：小心夜晚的怪物！');
    });
    // 继续游戏（首屏）/ 回到游戏（暂停菜单）：世界已就绪，直接进入
    document.getElementById('btn-continue').addEventListener('click', (e) => {
        e.stopPropagation();
        const fromPause = getUIState() === 'pause';
        setState('playing');
        showTooltip(fromPause ? '▶ 回到游戏' : '📂 已读取存档，欢迎回来');
    });
    // 手动保存：停留在菜单，方便存完直接关页面
    document.getElementById('btn-save').addEventListener('click', (e) => {
        e.stopPropagation();
        showTooltip(saveGame() ? '💾 进度已保存，可放心关闭页面' : '⚠️ 存档失败：浏览器存储空间不足');
    });
    document.getElementById('start-screen').addEventListener('click', () => {
        // 以当前世界进入（可能是读档恢复的，也可能是新世界）
        const fromTitle = getUIState() === 'title';
        setState('playing');
        if (fromTitle) showTooltip('WASD 移动 | 左键破坏/攻击 | 右键放置');
    });
    document.getElementById('respawn-btn').addEventListener('click', () => {
        respawn();
    });

    // 菜单文案随状态刷新（首次载入 + 每次进入 title/pause 时）
    refreshMenuTexts();
    onUIStateChange((prev, next) => {
        if (next === 'pause' || next === 'title') refreshMenuTexts();
    });

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
