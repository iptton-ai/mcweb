// ==================== main.js ====================

import { BlockTypes, CHUNK_SIZE, GameModes, MAX_HEALTH, PLAYER_EYE_HEIGHT, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { state } from './state.js';
import { camera, renderer, scene } from './engine.js';
import { generateWorld, getBlock, setBlockSafe } from './world.js';
import { isSolid, rebuildChunk, updateChunkMeshes } from './chunk.js';
import { placeBlock } from './interaction.js';
import { updateMining } from './mining.js';
import { initViewmodel, renderViewmodel, updateViewmodel } from './viewmodel.js';
import { initParticles, updateParticles } from './particles.js';
import { initAudio } from './audio.js';
import { initBGM, updateBGM } from './bgm.js';
import { initRedstone, updateRedstoneTick } from './redstone.js';
import { initKinetic, updateKineticTick } from './kinetic.js';
import { createPlayerMesh, initPlayerMesh, killEnemySilent, updateEnemies } from './entities.js';
import { updateTnt } from './tnt.js';
import { respawn, updateDroppedItems, updateHealthUI } from './playerLife.js';
import { updatePlayerMesh, updatePlayerPhysics } from './playerPhysics.js';
import { mouseDown, mouseMoveDelta, setupInput } from './input.js';
import { getUIState, initUIModal, mouseLocked, onUIStateChange, setState } from './uiModal.js';
import { setGameMode, showTooltip, updateBuildWidget, updateDebugInfo, updateHotbar, initBuildWidget } from './ui.js';
import { updateCameraRig } from './cameraRig.js';
import { updateDayNightCycle } from './daynight.js';
import { updateHighlight } from './highlight.js';
import { updateBuild } from './buildQueue.js';
import { resetCamMode } from './cameraRig.js';
import { initSaves, deleteSave, listSaves, loadGame, saveGame, savedAtText, initAutoSave } from './saveGame.js';

// ==================== 游戏循环 ====================
let lastTime = 0;

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

    // 视角更新（锁定即 playing，浮层状态下指针必然未锁定，由 uiModal 统一保证）。
    // 自由摄像头时鼠标转的是摄像头朝向（freeCam），玩家视角保持不动
    if (mouseLocked) {
        const sensitivity = 0.0022;
        if (state.camMode === 'free') {
            const fc = state.freeCam;
            fc.yaw -= mouseMoveDelta.x * sensitivity;
            fc.pitch -= mouseMoveDelta.y * sensitivity;
            const maxPitch = Math.PI / 2 - 0.01;
            fc.pitch = Math.max(-maxPitch, Math.min(maxPitch, fc.pitch));
        } else {
            state.player.yaw -= mouseMoveDelta.x * sensitivity;
            state.player.pitch -= mouseMoveDelta.y * sensitivity;
            const maxPitch = Math.PI / 2 - 0.01;
            state.player.pitch = Math.max(-maxPitch, Math.min(maxPitch, state.player.pitch));
        }
        mouseMoveDelta.x = 0;
        mouseMoveDelta.y = 0;
    }

    // 挖掘/放置（自由摄像头/跟拍视角下准星不再是玩家视线，禁用世界交互）。
    // 挖掘按 js/mining.js 的原版规则：生存按住蓄力（松手/换目标重置），创造即点即碎限速连拆
    updateMining(dt, mouseLocked && state.camMode === 'player' && mouseDown.left);
    if (mouseLocked && state.camMode === 'player' && mouseDown.right) {
        placeBlock();
        mouseDown.right = false; // 防止连续放置
    }

    // 玩家物理
    updatePlayerPhysics(dt);

    // 玩家模型（第三人称 / 自由·跟拍视角下可见）
    updatePlayerMesh(dt);

    // 第一人称手部视图模型（挥动/持物/摆动；渲染在主场景之后叠加）
    updateViewmodel(dt);

    // 摄像头模式（自由摄像头 / 建造跟拍；player 模式下相机已由 updatePlayerPhysics 更新）
    updateCameraRig(dt);

    // 昼夜循环
    updateDayNightCycle(dt);

    // 敌人 / TNT / 掉落物
    if (state.player.attackCooldown > 0) state.player.attackCooldown -= dt;
    if (state.player.invulnTimer > 0) state.player.invulnTimer -= dt;
    updateEnemies(dt);
    updateTnt(dt);
    updateDroppedItems(dt);

    // 红石组（按钮计时/火把延迟/压力板踩踏，状态变化时重算电路）
    updateRedstoneTick(dt);

    // 动力组（旋转动画 + 粉碎轮/机械锯计时，见 js/kinetic.js）
    updateKineticTick(dt);

    // 动态背景配乐（白天/黑夜/怪物接近/战斗交叉淡入淡出）
    updateBGM();

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

    // 渲染（先世界，再清深度叠加第一人称手部，见 js/viewmodel.js）
    renderer.render(scene, camera);
    renderViewmodel(renderer);
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

    // 红石组：清按钮/火把延迟队列与门/TNT 边沿基线（新世界不该残留旧世界电平）
    initRedstone();
    // 动力组：清机器进度并重算动力网络
    initKinetic();
}

// 清掉只存在于内存的瞬时实体（怪物/掉落物/点燃的TNT/机器产出的物品实体），切世界（读档/重开）时调用
function clearTransientEntities() {
    for (let i = state.enemies.length - 1; i >= 0; i--) killEnemySilent(state.enemies[i]);
    for (const it of state.droppedItems) scene.remove(it.mesh);
    state.droppedItems.length = 0;
    state.tntEntities.length = 0; // TNT 实体无独立网格（引用世界方块），直接清即可
}

// 放弃当前世界与存档，按所选模式开新世界（slot 省略 = 覆盖当前槽）
function startNewWorld(mode, tip, slot = state.saveSlot) {
    state.saveSlot = slot;
    resetCamMode(); // 摄像头可能停在自由/跟拍机位，新世界回到玩家视角
    freshWorld();
    // 清掉旧世界残留的怪物/掉落物/点燃的TNT
    clearTransientEntities();
    setGameMode(mode);
    // 新世界立即写入槽位：中途关页面不残留旧档，槽位列表即时更新
    saveGame();
    setState('playing');
    showTooltip(tip);
}

// 首屏切换到指定槽位的世界：当前世界先兜底保存，清瞬时实体后读档进入
function loadSlot(slot) {
    if (slot === state.saveSlot) {
        // 启动时已读入该槽世界（或已是当前世界），直接进入
        setState('playing');
        showTooltip('📂 已读取存档，欢迎回来');
        return;
    }
    saveGame(); // 旧世界进度兜底（失败也继续切换，最近一次自动存档仍在）
    resetCamMode();
    clearTransientEntities();
    if (!loadGame(slot)) {
        showTooltip('⚠️ 该槽位存档无法读取');
        return;
    }
    initRedstone(); // 重算供能网络与门/TNT 边沿基线（loadGame 不做红石恢复）
    initKinetic(); // 动力网络同为派生态，读档后重算
    setState('playing');
    showTooltip(`📂 已切换到世界 ${slot + 1}`);
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

// 暂停菜单 / 首屏文案：首屏以槽位列表为主操作（管所有世界），暂停态只管当前世界（隐藏列表避免游玩中换槽）
function refreshMenuTexts() {
    const pause = getUIState() === 'pause';
    document.getElementById('btn-continue').style.display = pause ? '' : 'none';
    document.getElementById('slot-list').style.display = pause ? 'none' : '';
    document.querySelector('#start-screen .click-hint').textContent = pause
        ? '🖱 点击空白处回到游戏'
        : '🖱 点击空白处可直接进入当前世界';
    // 模式按钮 = 在当前槽重开新世界（暂停态需二次确认）
    const curMeta = listSaves()[state.saveSlot];
    const reopenDesc = curMeta
        ? `覆盖世界 ${state.saveSlot + 1} · 重开新世界`
        : `在槽位 ${state.saveSlot + 1} 开新世界`;
    document.querySelector('#btn-creative .mode-desc').textContent = pause
        ? '放弃当前存档 · 重开新世界'
        : reopenDesc;
    document.querySelector('#btn-survival .mode-desc').textContent = pause
        ? '放弃当前存档 · 重开新世界'
        : reopenDesc;
    if (!pause) renderSlotList();
}

// 首屏槽位列表：有档槽点击进入，空槽选模式开新世界，✕ 删除（二次确认）
let delArm = null; // 删除确认状态：待确认的槽位号
function renderSlotList() {
    const list = document.getElementById('slot-list');
    if (!list) return;
    const metas = listSaves();
    list.innerHTML = '';
    delArm = null;
    metas.forEach((meta, i) => {
        const row = document.createElement('div');
        row.className = 'slot-row' + (i === state.saveSlot ? ' current' : '');
        if (meta) {
            const icon = meta.gameMode === GameModes.SURVIVAL ? '⚔️' : '🏗️';
            row.innerHTML =
                `<span class="slot-icon">${icon}</span>` +
                `<span class="slot-info"><span class="slot-name">世界 ${i + 1}${i === state.saveSlot ? ' · 当前' : ''}</span>` +
                `<span class="slot-time">上次保存：${savedAtText(meta.savedAt) || '未知时间'}</span></span>` +
                `<button class="slot-del" title="删除该存档">✕</button>`;
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                loadSlot(i);
            });
            row.querySelector('.slot-del').addEventListener('click', (e) => {
                e.stopPropagation();
                confirmDeleteSlot(i, row);
            });
        } else {
            row.classList.add('empty');
            row.innerHTML =
                `<span class="slot-icon">＋</span>` +
                `<span class="slot-info"><span class="slot-name">空槽位</span>` +
                `<span class="slot-time">开一个新世界</span></span>` +
                `<span class="slot-actions">` +
                `<button class="slot-start" data-mode="${GameModes.CREATIVE}">🏗️ 建造</button>` +
                `<button class="slot-start" data-mode="${GameModes.SURVIVAL}">⚔️ 生存</button></span>`;
            row.querySelectorAll('.slot-start').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const survival = btn.dataset.mode === GameModes.SURVIVAL;
                    const tip = survival
                        ? `⚔️ 新世界 ${i + 1} · 生存模式：小心夜晚的怪物！`
                        : `🏗️ 新世界 ${i + 1} · 建造模式：按 F 飞行，M 切换模式`;
                    startNewWorld(btn.dataset.mode, tip, i);
                });
            });
        }
        list.appendChild(row);
    });
}

// 删除槽位是危险操作：第一次点 ✕ 只做警示，再点一次才执行（4 秒后自动撤销）
function confirmDeleteSlot(i, row) {
    if (delArm === i) {
        delArm = null;
        deleteSave(i);
        showTooltip(`🗑️ 已删除世界 ${i + 1} 的存档`);
        // 删除的是当前槽：内存世界仍指向已删数据，切到别的有档槽（否则重生成为新世界），
        // 避免自动存档把已删的旧世界写回复活的槽位
        if (i === state.saveSlot) {
            const next = listSaves().findIndex((m) => m);
            resetCamMode();
            clearTransientEntities();
            if (next >= 0 && loadGame(next)) {
                initRedstone();
                initKinetic();
            } else {
                freshWorld(); // 内部已重置红石基线；空槽当前化，首次保存时落槽
                state.saveSlot = i;
            }
        }
        renderSlotList();
        refreshMenuTexts();
        return;
    }
    delArm = i;
    row.classList.add('confirm-del');
    row.querySelector('.slot-del').textContent = '确认删除？';
    setTimeout(() => {
        if (delArm === i) {
            delArm = null;
            renderSlotList();
        }
    }, 4000);
}

function init() {
    // UI 模态状态机最先初始化（统一管理浮层显隐与指针锁）
    initUIModal();

    // 初始化粒子
    initParticles();

    // 初始化音频
    initAudio();

    // 动态背景配乐（异步加载 assets/audio，音频上下文随用户手势解锁）
    initBGM();

    // 初始化存档（旧单槽自动迁入槽 0 + 槽位索引），读取上次游玩槽位的世界，失败则生成新世界
    initSaves();
    if (!loadGame()) {
        freshWorld();
    }

    // 创建玩家模型（第三人称用）：import 绑定是只读的，赋值必须走模块内的 initPlayerMesh
    initPlayerMesh();

    // 红石组：世界就绪后重算供能网络，恢复红石粉/红石灯派生态与门/TNT 边沿基线
    initRedstone();

    // 动力组：世界就绪后重算动力网络（水车转速/应力派生态），见 js/kinetic.js
    initKinetic();

    // UI
    updateHotbar();
    updateHealthUI();
    setupInput();
    initBuildWidget();
    initViewmodel(); // 第一人称手部视图模型（含窗口尺寸同步）

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
    // 回到游戏（仅暂停态显示；首屏的继续游戏由槽位列表承担）
    document.getElementById('btn-continue').addEventListener('click', (e) => {
        e.stopPropagation();
        setState('playing');
        showTooltip('▶ 回到游戏');
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

console.log('操作: WASD移动 | 鼠标破坏/放置 | E物品栏 | F飞行(建造) | M切换模式 | F5/V切换视角 | C自由摄像头/建造跟拍');
