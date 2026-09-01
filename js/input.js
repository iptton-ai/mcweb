// ==================== input.js ====================

import { BlockInfo, HotbarBlocks } from './config.js';
import { isCreative, state } from './state.js';
import { canvas } from './engine.js';
import { breakBlock, placeBlock } from './interaction.js';
import { cycleViewMode } from './playerPhysics.js';
import { adjustBuildSpeed, getBuildStatus, speedText, toggleBuildPaused } from './buildQueue.js';
import { buildInventoryGrid, showTooltip, teleportToBuildSite, toggleBuildRecording, toggleGameMode, updateHotbar } from './ui.js';

// ==================== 输入处理 ====================
export const keys = {};

export let mouseDown = { left: false, right: false };

export let mouseMoveDelta = { x: 0, y: 0 };

export let mouseLocked = false;

export function setupInput() {
    document.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'Space') e.preventDefault();
        if (e.code === 'Escape' && state.player.inventoryOpen) {
            closeInventory();
        }
        if (e.code === 'KeyE' && mouseLocked) {
            toggleInventory();
        }
        if (e.code === 'KeyF' && mouseLocked) {
            if (isCreative()) {
                state.player.flying = !state.player.flying;
                state.player.vy = 0;
                showTooltip(state.player.flying ? '🕊️ 飞行开启' : '🚶 飞行关闭');
            } else {
                showTooltip('⚠️ 只有建造模式才能飞行（按 M 切换）');
            }
        }
        if (e.code === 'KeyM' && mouseLocked) {
            toggleGameMode();
        }
        if ((e.code === 'F5' || e.code === 'KeyV') && mouseLocked) {
            e.preventDefault(); // 阻止 F5 刷新页面
            cycleViewMode();
        }
        // 施工速度/暂停/录像（AI 渐进建造时用，键位仅在指针锁定时生效）
        if (e.code === 'BracketLeft' && mouseLocked) {
            adjustBuildSpeed(-1);
            showTooltip(`🏗️ 施工速度：${speedText()}`);
        }
        if (e.code === 'BracketRight' && mouseLocked) {
            adjustBuildSpeed(1);
            showTooltip(`🏗️ 施工速度：${speedText()}`);
        }
        if (e.code === 'KeyP' && mouseLocked) {
            showTooltip(toggleBuildPaused() ? '⏸ 施工已暂停（P 继续）' : '▶ 施工继续');
        }
        // G：传送到施工现场（AI 建在远处时快速过去观看）
        if (e.code === 'KeyG' && mouseLocked) {
            teleportToBuildSite();
        }
        if (e.code === 'KeyR' && mouseLocked) {
            toggleBuildRecording();
        }
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

    canvas.addEventListener('mousedown', (e) => {
        if (state.assistantOpen) return; // AI 会话面板打开时不响应游戏点击
        if (!mouseLocked && !state.player.inventoryOpen) {
            canvas.requestPointerLock();
            return;
        }
        if (state.player.inventoryOpen) return;
        if (e.button === 0) {
            mouseDown.left = true;
            breakBlock();
        } else if (e.button === 2) {
            mouseDown.right = true;
            placeBlock();
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0) mouseDown.left = false;
        if (e.button === 2) mouseDown.right = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
        if (!mouseLocked || state.player.inventoryOpen) return;
        const delta = e.deltaY > 0 ? 1 : -1;
        state.player.selectedSlot = (state.player.selectedSlot + delta + HotbarBlocks.length) % HotbarBlocks
            .length;
        updateHotbar();
        showTooltip(BlockInfo[HotbarBlocks[state.player.selectedSlot]]?.name || '未知');
    });

    document.addEventListener('mousemove', (e) => {
        if (!mouseLocked || state.player.inventoryOpen) return;
        mouseMoveDelta.x += e.movementX;
        mouseMoveDelta.y += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
        mouseLocked = document.pointerLockElement === canvas;
        state.player.mouseLocked = mouseLocked;
        // 死亡时退出锁定是为了点复活按钮，不要弹开始界面（其 z-index 高于死亡界面会挡住按钮）；
        // AI 助手面板打开时同理（面板需要鼠标和键盘）
        if (!mouseLocked && !state.player.inventoryOpen && !state.player.dead && !state.assistantOpen) {
            showStartScreen();
        }
    });

    document.addEventListener('click', () => {
        // 死亡时不要重新锁定指针，否则复活按钮点不到；AI 助手面板打开时同理
        if (!mouseLocked && !state.player.inventoryOpen && !state.player.dead && !state.assistantOpen) {
            canvas.requestPointerLock();
        }
    });
}

export function toggleInventory() {
    state.player.inventoryOpen = !state.player.inventoryOpen;
    const panel = document.getElementById('inventory-panel');
    if (state.player.inventoryOpen) {
        panel.classList.add('open');
        document.exitPointerLock();
        buildInventoryGrid();
    } else {
        panel.classList.remove('open');
        canvas.requestPointerLock();
    }
}

export function closeInventory() {
    if (state.player.inventoryOpen) {
        state.player.inventoryOpen = false;
        document.getElementById('inventory-panel').classList.remove('open');
        canvas.requestPointerLock();
    }
}

export function showStartScreen() {
    const screen = document.getElementById('start-screen');
    screen.classList.remove('hidden');
}

export function hideStartScreen() {
    const screen = document.getElementById('start-screen');
    screen.classList.add('hidden');
}
