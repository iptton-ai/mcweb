// ==================== uiModal.js ====================
// UI 模态状态机：全游戏唯一的浮层显隐与指针锁管理者。
//
// 游戏状态（互斥，任一时刻处于其一）：
//   title     首屏（无可放弃的对局，或读档入口）
//   playing   游戏中（期望指针锁定）
//   pause     ESC 暂停菜单（游戏中按 Esc / 指针被系统夺走时进入）
//   inventory 背包（E 开关）
//   settings  设置浮层（首屏/暂停菜单的 ⚙️ 进入：音频与存档；关闭回到进入前的状态）
//   dead      死亡界面
// 另有一个独立于游戏状态的布尔：AI 助手面板可见（T 开关，侧栏浮层，不阻塞游戏——
// 面板打开时游戏键照常，只有鼠标归面板，指针锁因此让位）。
//
// 设计原则：
//   1. 只有本模块调用 requestPointerLock / exitPointerLock，其余模块只调 setState/setAssistantVisible；
//   2. 锁定失败不再静默：Chrome 在用户 Esc 退出后约 1.25s 内拒绝重入，
//      此时显示「点击画面继续」并自动重试，消灭「菜单关了但鼠标死了」的黑箱状态；
//   3. 浮层显隐与准星可见性由本模块统一驱动，其他模块经 onUIStateChange 订阅
//      （如 main.js 刷新暂停菜单文案、input.js 清空按键防粘滞）。

import { state } from './state.js';
import { canvas } from './engine.js';
import { hideItemInfo } from './itemInfo.js';

// 指针是否锁定（活绑定导出，main.js 每帧读取）
export let mouseLocked = false;

let uiState = 'title';
let assistantVisible = false;       // AI 助手面板可见（独立于游戏状态的侧栏）
let settingsReturn = 'title';       // 设置浮层的来路（只能从 title/pause 进入），关闭时回去
let expectUnlock = false;           // 本模块主动解锁时置位，用于区分「用户按 Esc 解锁」
let wantLock = false;               // playing 状态下等待锁定成功
let lockPending = false;            // 请求已在途，避免同一手势内重复请求
let retryTimer = null;
let hintEl = null;
const listeners = [];
const LOCK_RETRY_MS = 1300; // 略大于 Chrome 的重入冷却

export function getUIState() {
    return uiState;
}

// 指针锁期望策略：playing 且面板关闭时才要鼠标；面板打开时鼠标归面板
function wantLockNow() {
    return uiState === 'playing' && !assistantVisible && !state.recordingControlsOpen;
}

// 「正在操作游戏」= playing 且指针已锁定（供每帧鼠标相关门控用）
export function isPlaying() {
    return uiState === 'playing' && mouseLocked;
}

// 游戏状态层面是否活跃（键盘门控用：面板打开不影响游戏键）
export function isGameActive() {
    return uiState === 'playing' && !state.recordingControlsOpen;
}

export function isAssistantVisible() {
    return assistantVisible;
}

export function isTypingTarget(e) {
    const t = e.target;
    return t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function onUIStateChange(cb) {
    listeners.push(cb);
}

// ==================== 状态切换（唯一入口） ====================
export function setState(next) {
    if (next === 'playing' && state.player.dead) next = 'dead'; // 死亡时不可能回到 playing
    if (next !== 'playing') state.recordingControlsOpen = false;
    if (next !== uiState) {
        const prev = uiState;
        uiState = next;
        // 兼容镜像：老代码仍读这两个字段
        state.player.inventoryOpen = next === 'inventory';
        emit(prev, next);
    }
    syncOverlays();
    applyPointerPolicy();
}

// 拍摄面板是非暂停浮层：解锁鼠标但保持施工与录像继续。
export function setRecordingControlsOpen(open) {
    state.recordingControlsOpen = !!open;
    emit(uiState, uiState); // 清空按键，避免打开面板后仍在移动
    applyPointerPolicy();
    syncOverlays();
}

// 助手面板开关（不改变游戏状态：面板开着也能继续玩游戏）
export function setAssistantVisible(v) {
    if (v === assistantVisible) return;
    assistantVisible = v;
    state.assistantOpen = v;
    syncOverlays();
    applyPointerPolicy();
}

function applyPointerPolicy() {
    if (wantLockNow()) {
        if (!mouseLocked) requestLock();
    } else {
        stopRetry();
        wantLock = false;
        hideLockHint();
        if (mouseLocked) exitLock();
    }
}

// Esc 在面板打开时也能切换暂停菜单（由 assistant/ui.js 的 Esc 分支调用）
export function togglePauseMenu() {
    if (uiState === 'pause') setState('playing');
    else if (uiState === 'playing') setState('pause');
}

// 设置浮层（音频/存档，见 settingsUI.js）：只能从首屏/暂停菜单进入，关闭回原状态
export function openSettingsState() {
    if (uiState !== 'title' && uiState !== 'pause') return;
    settingsReturn = uiState;
    setState('settings');
}

export function closeSettingsState() {
    if (uiState === 'settings') setState(settingsReturn);
}

// Q 键（Esc 替代，见 input.js）：释放指针并弹暂停菜单，效果与用户按 Esc 一致。
// 指针锁定时按 Esc 会被浏览器/宿主截获（ZCode 内嵌浏览器里还会导致应用退出），
// 页面收不到也拦不住，只能提供一个不碰 Esc 的替代入口。
export function releasePointerToPause() {
    if (!mouseLocked) return;
    expectUnlock = true; // 主动释放：解锁事件不再自动弹菜单（这里直接切状态）
    document.exitPointerLock();
    setState('pause');
}

function emit(prev, next) {
    for (const cb of listeners) {
        try { cb(prev, next); } catch (e) { console.error(e); }
    }
}

// ==================== 浮层同步 ====================
function syncOverlays() {
    const menuVisible = uiState === 'title' || uiState === 'pause';
    const screen = document.getElementById('start-screen');
    if (screen) screen.classList.toggle('hidden', !menuVisible);
    const inv = document.getElementById('inventory-panel');
    if (inv) inv.classList.toggle('open', uiState === 'inventory');
    // 离开背包态时兜底隐藏物品说明条（面板 display:none 不一定触发 mouseleave）
    if (uiState !== 'inventory') hideItemInfo();
    // 设置浮层（DOM 由 settingsUI.js 注入，本模块只管显隐）
    const gs = document.getElementById('game-settings');
    if (gs) gs.classList.toggle('hidden', uiState !== 'settings');
    // 准星只在「正在操作」时显示，让玩家一眼看出当前能否操作
    const cross = document.getElementById('crosshair');
    if (cross) cross.style.display = isPlaying() ? '' : 'none';
}

// ==================== 指针锁管理（全游戏仅此处调用） ====================
export function requestLock() {
    state.recordingControlsOpen = false;
    if (mouseLocked || lockPending) return;
    lockPending = true;
    wantLock = true;
    const settle = () => { lockPending = false; };
    try {
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') {
            p.then(settle, () => { settle(); onLockRejected(); });
        } else {
            // 旧浏览器无 promise：靠 pointerlockchange / pointerlockerror 收尾
            setTimeout(settle, 100);
        }
    } catch {
        settle();
        onLockRejected();
    }
}

function onLockRejected() {
    if (!wantLockNow() || mouseLocked) {
        wantLock = false;
        return;
    }
    // 不再静默失败：提示玩家并自动重试（重试成功或玩家点击都会立即恢复）
    showLockHint();
    if (!retryTimer) {
        retryTimer = setTimeout(() => {
            retryTimer = null;
            if (wantLock && uiState === 'playing' && !mouseLocked) requestLock();
        }, LOCK_RETRY_MS);
    }
}

function exitLock() {
    if (!mouseLocked) return;
    expectUnlock = true;
    document.exitPointerLock();
}

function onPointerLockChange() {
    mouseLocked = document.pointerLockElement === canvas;
    state.player.mouseLocked = mouseLocked;
    lockPending = false;
    if (mouseLocked) {
        // 锁定请求异步返回期间可能已按 Tab 打开面板；迟到的成功不能抢回鼠标。
        if (state.recordingControlsOpen || uiState !== 'playing') {
            exitLock();
            syncOverlays();
            return;
        }
        wantLock = false;
        stopRetry();
        hideLockHint();
    } else if (!expectUnlock && uiState === 'playing' && !assistantVisible && !state.recordingControlsOpen) {
        // 用户按 Esc（锁定状态下浏览器截获 Esc，页面收不到 keydown）或系统夺走指针 → 暂停菜单
        // （面板开着时指针本就不该被锁定，此时解锁不弹菜单）
        setState('pause');
    }
    expectUnlock = false;
    syncOverlays();
}

function stopRetry() {
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
}

// ==================== 「点击继续」提示 ====================
function showLockHint() {
    hintEl?.classList.remove('hidden');
}

function hideLockHint() {
    hintEl?.classList.add('hidden');
}

// ==================== 初始化 ====================
export function initUIModal() {
    if (hintEl) return; // 已初始化
    const style = document.createElement('style');
    style.textContent = `
#lock-hint{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;
  pointer-events:none;background:rgba(0,0,0,.35);color:#fff;font-size:20px;
  text-shadow:0 2px 8px rgba(0,0,0,.9);}
#lock-hint.hidden{display:none;}
`;
    document.head.appendChild(style);
    hintEl = document.createElement('div');
    hintEl.id = 'lock-hint';
    hintEl.className = 'hidden';
    hintEl.textContent = '🖱 点击画面继续';
    document.body.appendChild(hintEl);

    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onLockRejected);
    syncOverlays();
}
