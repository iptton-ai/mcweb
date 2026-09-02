// ==================== input.js ====================
// 键鼠输入。门控原则：游戏键只问「UI 状态机是否 playing」（uiModal.js）与
// 「焦点是否在输入框」，不再看指针是否锁定；施工控制键（[ ] P G R）在除首屏外的
// 任何状态都可用，便于 AI 施工时在暂停菜单/背包/助手面板/死亡界面里控制建造。

import { BlockInfo, HotbarBlocks } from './config.js';
import { isCreative, state } from './state.js';
import { canvas } from './engine.js';
import { placeBlock } from './interaction.js';
import { miningPress } from './mining.js';
import { swingViewmodel } from './viewmodel.js';
import { cycleViewMode } from './playerPhysics.js';
import { adjustBuildSpeed, speedText, toggleBuildPaused } from './buildQueue.js';
import { cycleCameraMode, adjustCamSpeed } from './cameraRig.js';
import { openItemPicker, showTooltip, teleportToBuildSite, toggleBuildRecording, toggleGameMode, updateHotbar } from './ui.js';
import { closeSettingsState, getUIState, isAssistantVisible, isPlaying, isTypingTarget, mouseLocked, onUIStateChange, releasePointerToPause, requestLock, setState } from './uiModal.js';

// ==================== 输入状态 ====================
export const keys = {};

export let mouseDown = { left: false, right: false };

export let mouseMoveDelta = { x: 0, y: 0 };

// 离开 playing / 窗口失焦时清空按键与鼠标按住态，防止角色粘滞移动
export function clearKeys() {
    for (const k in keys) keys[k] = false;
    mouseDown.left = false;
    mouseDown.right = false;
}

export function setupInput() {
    // 任何 UI 状态切换都清空输入（防止开关菜单/面板的瞬间粘滞移动）
    onUIStateChange(() => clearKeys());

    document.addEventListener('keydown', (e) => {
        if (isTypingTarget(e)) return; // 在助手聊天/设置等输入框打字时，游戏键全部让路
        keys[e.code] = true;

        const st = getUIState();
        if (e.code === 'Space' && st === 'playing') e.preventDefault();

        // Esc：指针锁定时浏览器截获 Esc（页面收不到 keydown），这里只处理浮层状态下的 Esc
        if (e.code === 'Escape') {
            if (st === 'settings') closeSettingsState(); // 设置浮层：回到进入前（首屏/暂停菜单）
            else if (st === 'pause' || st === 'inventory') setState('playing'); // 再按 Esc 回到游戏
            return;
        }
        // Q：Esc 的替代键（推荐在 ZCode 内嵌浏览器里用——Esc 会被宿主截获导致应用退出，Q 不会）：
        // 锁定时释放鼠标并弹暂停菜单；暂停/背包里回游戏；设置浮层里关闭浮层
        if (e.code === 'KeyQ') {
            if (st === 'settings') closeSettingsState();
            else if (st === 'pause' || st === 'inventory') setState('playing');
            else if (st === 'playing' && mouseLocked) releasePointerToPause();
            return;
        }
        // E：打开物品选择网格（openItemPicker 负责构建网格再进入 inventory 态）；
        // 背包开着时按 E 收起（点选物品也会自动收起，无需再按）
        if (e.code === 'KeyE' && (st === 'playing' || st === 'inventory')) {
            if (st === 'playing') openItemPicker();
            else setState('playing');
            return;
        }
        if (st !== 'playing') {
            // 暂停菜单/背包/助手面板/死亡界面里：只放行 AI 施工控制键
            if (st !== 'title') handleBuildKeys(e);
            return;
        }
        // ---- 以下为 playing 状态的游戏键 ----
        if (e.code === 'KeyF') {
            if (isCreative()) {
                state.player.flying = !state.player.flying;
                state.player.vy = 0;
                showTooltip(state.player.flying ? '🕊️ 飞行开启' : '🚶 飞行关闭');
            } else {
                showTooltip('⚠️ 只有建造模式才能飞行（按 M 切换）');
            }
        }
        if (e.code === 'KeyM') {
            toggleGameMode();
        }
        if (e.code === 'F5' || e.code === 'KeyV') {
            e.preventDefault(); // 阻止 F5 刷新页面
            cycleViewMode();
        }
        handleBuildKeys(e);
        if (e.code.startsWith('Digit')) {
            const num = parseInt(e.code.replace('Digit', ''));
            if (num >= 1 && num <= 9) {
                state.player.selectedSlot = num - 1;
                updateHotbar();
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        keys[e.code] = false;
    });

    // 窗口失焦/切走时清空按键（alt-tab 后角色不再漂移）
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearKeys();
    });

    canvas.addEventListener('mousedown', (e) => {
        if (getUIState() !== 'playing') return; // 浮层（菜单/背包/死亡）状态不响应游戏点击
        if (!isPlaying()) {
            // 未锁定（含助手面板打开时）：点击画面接管鼠标开始操作。
            // 面板保持打开；按 Esc 释放鼠标即回到面板操作。
            requestLock();
            return;
        }
        if (e.button === 0) {
            if (state.camMode === 'player') {
                mouseDown.left = true;
                // 按下瞬间：攻击怪物 / 开始挖掘（生存蓄力、创造与即挖方块直接破坏，见 js/mining.js）
                miningPress();
            }
        } else if (e.button === 2) {
            if (state.camMode === 'player') {
                mouseDown.right = true;
                placeBlock();
                swingViewmodel(); // 放置也挥一下手（照原版使用动画）
            }
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0) mouseDown.left = false;
        if (e.button === 2) mouseDown.right = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
        if (!isPlaying()) return;
        // 自由摄像头：滚轮调飞行速度（物品栏选择让位）
        if (state.camMode === 'free') {
            adjustCamSpeed(e.deltaY > 0 ? -1 : 1);
            return;
        }
        const delta = e.deltaY > 0 ? 1 : -1;
        state.player.selectedSlot = (state.player.selectedSlot + delta + HotbarBlocks.length) % HotbarBlocks
            .length;
        updateHotbar();
        showTooltip(BlockInfo[HotbarBlocks[state.player.selectedSlot]]?.name || '未知');
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPlaying()) return;
        mouseMoveDelta.x += e.movementX;
        mouseMoveDelta.y += e.movementY;
    });

    document.addEventListener('click', () => {
        // playing 但指针未锁定（如冷却期锁定失败）：任意点击重新锁定。
        // 助手面板打开时鼠标归面板，不在此抢锁。
        if (getUIState() === 'playing' && !isAssistantVisible() && !isPlaying()) requestLock();
    });
}

// AI 施工控制：[ ] 调速 / P 暂停 / G 传送 / R 录像 / C 摄像头（自由视角·建造跟拍）。
// 不依赖指针锁定：AI 建造时在暂停菜单或助手面板里也能暂停、调速、前往施工现场、切跟拍机位。
function handleBuildKeys(e) {
    if (e.code === 'BracketLeft') {
        adjustBuildSpeed(-1);
        showTooltip(`🏗️ 施工速度：${speedText()}`);
    } else if (e.code === 'BracketRight') {
        adjustBuildSpeed(1);
        showTooltip(`🏗️ 施工速度：${speedText()}`);
    } else if (e.code === 'KeyP') {
        showTooltip(toggleBuildPaused() ? '⏸ 施工已暂停（P 继续）' : '▶ 施工继续');
    } else if (e.code === 'KeyG') {
        teleportToBuildSite();
    } else if (e.code === 'KeyR') {
        toggleBuildRecording();
    } else if (e.code === 'KeyC') {
        cycleCameraMode();
    }
}
