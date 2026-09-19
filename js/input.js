// ==================== input.js ====================
// 键鼠输入。门控原则：游戏键只问「UI 状态机是否 playing」（uiModal.js）与
// 「焦点是否在输入框」，不再看指针是否锁定；施工控制键（[ ] P G R）在除首屏外的
// 任何状态都可用，便于 AI 施工时在暂停菜单/背包/助手面板/死亡界面里控制建造。

import { BlockInfo, HotbarBlocks } from './config.js';
import { isCreative, state } from './state.js';
import { canvas } from './engine.js';
import { dropHeldItem, pickBlockUnderCrosshair, placeBlock } from './interaction.js';
import { miningPress } from './mining.js';
import { swingViewmodel } from './viewmodel.js';
import { cycleViewMode } from './playerPhysics.js';
import { adjustBuildSpeed, speedText, toggleBuildPaused } from './buildQueue.js';
import { cycleCameraMode, adjustCamSpeed } from './cameraRig.js';
import { closeExportPanel, closeLevelList, closePrefabPicker, isLevelListOpen, isPrefabPickerOpen, openExportPanel, openItemPicker, openPrefabPicker, showTooltip, teleportToBuildSite, toggleBuildRecording, toggleGameMode, updateHotbar } from './ui.js';
import { closeQuestionBank, isQuestionBankOpen } from './questionBankUI.js'; // 📝 我的题库平铺录题页（Esc/Q 关闭，同组件库）
import { closeSettingsState, getUIState, isAssistantVisible, isKeyboardPlayActive, isPlaying, isTypingTarget, mouseLocked, onUIStateChange, releasePointerToPause, requestLock, setRecordingControlsOpen, setState } from './uiModal.js';
import { exitLevelRun, isLevelRunActive } from './levelRun.js'; // 闯关模式：绕过通道全闭（W11）+ 结算态退出
import { cancelPlacing, consumePlaceClick, getPlacing } from './levelEditor.js'; // 关卡编辑器：组件放置（2026-09-16）

// ==================== 输入状态 ====================
export const keys = {};

let lastSpaceAt = -Infinity; // 上次空格按下时间（创造模式双击 = 切换飞行）

// F2 截图：画布转 PNG 下载（纯净画面，不含 DOM 界面）
function takeScreenshot() {
    try {
        const a = document.createElement('a');
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        a.download = `截图-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
        showTooltip('📸 截图已保存');
    } catch (err) {
        showTooltip('⚠️ 截图失败：' + err.message);
    }
}

export let mouseDown = { left: false, right: false };

export let mouseMoveDelta = { x: 0, y: 0 };

// 离开 playing / 窗口失焦时清空按键与鼠标按住态，防止角色粘滞移动
export function clearKeys() {
    for (const k in keys) keys[k] = false;
    mouseDown.left = false;
    mouseDown.right = false;
    mouseMoveDelta.x = mouseMoveDelta.y = 0;
}

// ==================== 左右键共享触发点（鼠标 mousedown 与纯键盘模式 Enter/X 同源） ====================
// 走同一入口 = 编辑器组件盖章 / 闯关禁挖禁放等守卫全部自动继承，不存在「键盘绕过」通道
function primaryActionPress() {
    if (getUIState() !== 'playing' || state.camMode !== 'player') return;
    // 组件放置态：左键 = 盖章（吞掉这次按压，不进入挖掘/攻击）
    if (consumePlaceClick()) return;
    mouseDown.left = true;
    // 按下瞬间：攻击怪物 / 开始挖掘（生存蓄力、创造与即挖方块直接破坏，见 js/mining.js）；
    // 按住期间的蓄力推进 / 创造连拆由 main.js 每帧的 updateMining 消费 mouseDown.left
    miningPress();
}

function primaryActionRelease() {
    mouseDown.left = false;
}

// 右键链：食物→工作台/熔炉→门→TNT→按钮/拉杆→答题机→放置（优先级见 js/interaction.js placeBlock）
function secondaryAction() {
    if (getUIState() !== 'playing' || state.camMode !== 'player') return;
    // 组件放置态：右键 = 结束放置（不放方块，防误盖一手持块）
    if (getPlacing()) {
        cancelPlacing();
        showTooltip('🧱 已结束放置');
        return;
    }
    mouseDown.right = true; // 仅按住态镜像（与 mouseDown.left 对称）；行为已在上面 placeBlock 触发一次，别在 main.js 按帧再消费，否则一次点击放两次
    placeBlock();
    swingViewmodel(); // 放置也挥一下手（照原版使用动画）
}

export function setupInput() {
    // 任何 UI 状态切换都清空输入（防止开关菜单/面板的瞬间粘滞移动）
    onUIStateChange(() => clearKeys());

    document.addEventListener('keydown', (e) => {
        if (isTypingTarget(e)) return; // 在助手聊天/设置等输入框打字时，游戏键全部让路
        if (e.code === 'Tab' && getUIState() !== 'title') {
            e.preventDefault();
            if (!e.repeat) setRecordingControlsOpen(!state.recordingControlsOpen);
            return;
        }
        keys[e.code] = !state.recordingControlsOpen;

        const st = getUIState();
        if (e.code === 'Space' && st === 'playing') e.preventDefault();

        // Esc：指针锁定时浏览器截获 Esc（页面收不到 keydown），这里只处理浮层状态下的 Esc
        if (e.code === 'Escape') {
            if (isQuestionBankOpen()) closeQuestionBank(); // 题库页可能叠在关卡列表上：先关它
            else if (isPrefabPickerOpen()) closePrefabPicker(); // 组件库浮层：关闭并结束放置态
            else if (state.levelExportOpen) closeExportPanel(); // 导出面板：关面板回游戏
            else if (isLevelListOpen()) closeLevelList(); // 首屏关卡列表浮层：关闭（B1 关闭钮 title 承诺的行为）
            else if (st === 'settings') closeSettingsState(); // 设置浮层：回到进入前（首屏/暂停菜单）
            else if (st === 'result') exitLevelRun({ toTitle: true }); // 结算浮层：退出关卡回首屏
            else if (st === 'pause' || st === 'inventory') setState('playing'); // 再按 Esc 回到游戏
            else if (st === 'playing' && state.inputMode === 'keyboard') setState('pause'); // 纯键盘模式没锁定，Esc 能到达页面 = 暂停
            return;
        }
        // Q：Esc 的替代键（推荐在 ZCode 内嵌浏览器里用——Esc 会被宿主截获导致应用退出，Q 不会）：
        // 锁定时释放鼠标并弹暂停菜单；暂停/背包里回游戏；设置浮层里关闭浮层
        if (e.code === 'KeyQ') {
            if (isQuestionBankOpen()) closeQuestionBank();
            else if (isPrefabPickerOpen()) closePrefabPicker();
            else if (state.levelExportOpen) closeExportPanel();
            else if (isLevelListOpen()) closeLevelList();
            else if (st === 'settings') closeSettingsState();
            else if (st === 'result') exitLevelRun({ toTitle: true });
            else if (st === 'pause' || st === 'inventory') setState('playing');
            else if (st === 'playing' && state.inputMode === 'keyboard') setState('pause'); // 纯键盘模式没锁可放，直接弹暂停
            else if (st === 'playing' && mouseLocked) releasePointerToPause();
            return;
        }
        // B：组件库（关卡编辑器/建造模式）——点选预设组件后准星瞄准左键盖章
        if (e.code === 'KeyB' && st === 'playing' && !state.recordingControlsOpen && !state.levelExportOpen) {
            if (isPrefabPickerOpen()) closePrefabPicker();
            else openPrefabPicker();
            return;
        }
        // K：导出关卡卡（作者流程最后一步，plan §2.1「按 K 导出」）——非暂停浮层，
        // 释放鼠标填名字/作者昵称，导出 .level.json 或存进本机关卡列表
        if (e.code === 'KeyK' && st === 'playing' && !state.recordingControlsOpen) {
            if (isLevelRunActive()) showTooltip('📦 闯关中不能导出关卡卡');
            else if (state.levelExportOpen) closeExportPanel();
            else openExportPanel();
            return;
        }
        // E：打开物品选择网格（openItemPicker 负责构建网格再进入 inventory 态）；
        // 背包开着时按 E 收起（点选物品也会自动收起，无需再按）。
        // 闯关模式禁开背包（W11）——物品栏能摸到全部方块与工具，等于作弊入口
        if (e.code === 'KeyE' && (st === 'playing' || st === 'inventory')) {
            if (st === 'playing') {
                if (isLevelRunActive()) {
                    showTooltip('🎒 闯关中不能打开物品栏');
                    return;
                }
                openItemPicker();
            } else setState('playing');
            return;
        }
        if (st !== 'playing' || state.recordingControlsOpen || state.levelExportOpen) {
            // 暂停菜单/背包/助手面板/死亡界面里：只放行 AI 施工控制键
            if (st !== 'title') handleBuildKeys(e);
            return;
        }
        // ---- 以下为 playing 状态的游戏键 ----
        // 纯键盘输入模式（⚙️ 设置「🎛 画面」页切换）：鼠标不锁定只管 UI，游戏操作全走键盘。
        // Enter/X/I 与鼠标左右中键同源（primary/secondary 共享函数），守卫语义完全一致；
        // 面板开着（组件库/出题面板）时不触发——与鼠标模式下 isPlaying() 门对齐
        if (state.inputMode === 'keyboard') {
            // 方向键转视角：每帧由 main.js 消费 keys 积分 yaw/pitch，这里只挡掉页面滚动
            if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                e.preventDefault();
                return;
            }
            // 自动重复不重复触发按压：按住期间的蓄力/连拆由 updateMining 每帧驱动（与鼠标一致）
            if (e.code === 'Enter' && isKeyboardPlayActive()) {
                if (!e.repeat) primaryActionPress();
                return;
            }
            if (e.code === 'KeyX' && isKeyboardPlayActive()) {
                if (!e.repeat) secondaryAction();
                return;
            }
            if (e.code === 'KeyI' && !e.repeat && isKeyboardPlayActive()
                && state.camMode === 'player' && isCreative()) {
                pickBlockUnderCrosshair(); // 中键吸取等价（仅创造）
                return;
            }
        }
        // Z：丢弃手持物品（对齐参考版的 Q 键——本作 Q 被 Esc 替代键占用）
        if (e.code === 'KeyZ') {
            dropHeldItem();
        }
        // 空格双击（创造）：切换飞行。闯关中显式拒绝（W11；虽然闯关恒为生存、
        // 创造分支本就进不来，这里按守卫矩阵留一道明示的闸并给出提示）
        if (e.code === 'Space' && state.camMode === 'player' && !e.repeat &&
            (isCreative() || isLevelRunActive())) {
            const now = performance.now();
            if (isLevelRunActive()) {
                showTooltip('🕊️ 闯关中不能飞行');
            } else if (now - lastSpaceAt < 300) {
                state.player.flying = !state.player.flying;
                state.player.vy = 0;
                showTooltip(state.player.flying ? '🕊️ 飞行开启' : '🚶 飞行关闭');
            }
            lastSpaceAt = now;
        }
        // F1 隐藏界面（截图/录屏用）| F2 截图 | F3 调试信息开关 | F6 昼夜切换（创造）
        if (e.code === 'F1') {
            e.preventDefault();
            document.body.classList.toggle('hud-hidden');
            showTooltip(document.body.classList.contains('hud-hidden') ? '🙈 界面已隐藏（F1 恢复）' : '👁️ 界面已恢复');
        }
        if (e.code === 'F2') {
            e.preventDefault();
            takeScreenshot();
        }
        if (e.code === 'F3') {
            e.preventDefault();
            const dbg = document.getElementById('debug-info');
            const show = dbg.style.display === 'none';
            dbg.style.display = show ? '' : 'none';
            showTooltip(show ? '📊 调试信息已显示' : '📊 调试信息已隐藏');
        }
        if (e.code === 'F6') {
            e.preventDefault();
            if (isLevelRunActive()) {
                showTooltip('⏳ 闯关中不能调整昼夜');
            } else if (!isCreative()) {
                showTooltip('☀️ 只有建造模式可以调整昼夜');
            } else {
                const dayLen = state.dayLength;
                const progress = (state.time % dayLen) / dayLen;
                const sunUp = Math.sin(progress * Math.PI * 2 - Math.PI * 0.5) > 0;
                state.time = Math.floor(state.time / dayLen) * dayLen + (sunUp ? dayLen * 0.95 : dayLen * 0.5);
                showTooltip(sunUp ? '🌙 夜幕降临' : '☀️ 天亮了');
            }
        }
        if (e.code === 'KeyF') {
            if (isLevelRunActive()) {
                showTooltip('🕊️ 闯关中不能飞行');
            } else if (isCreative()) {
                state.player.flying = !state.player.flying;
                state.player.vy = 0;
                showTooltip(state.player.flying ? '🕊️ 飞行开启' : '🚶 飞行关闭');
            } else {
                showTooltip('⚠️ 只有建造模式才能飞行（按 M 切换）');
            }
        }
        if (e.code === 'KeyM') {
            if (isLevelRunActive()) {
                showTooltip('⚔️ 闯关中不能切换模式');
            } else {
                toggleGameMode();
            }
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
        // 纯键盘模式：松开键 = 松开左/右键（蓄力中断、连放结束）
        if (state.inputMode === 'keyboard') {
            if (e.code === 'Enter') primaryActionRelease();
            if (e.code === 'KeyX') mouseDown.right = false;
        }
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
            // 出题面板打开时鼠标归表单：点画布空白处不抢回指针（面板点 ✖/Q/Esc/走远关闭）
            if (state.authorPanelOpen) return;
            // 纯键盘模式：鼠标只管 UI 浮层，点画布不抢锁、无任何游戏操作（全键盘哲学）
            if (state.inputMode === 'keyboard') return;
            requestLock();
            // 组件放置态：准星固定在屏幕中心、不依赖鼠标位置——这一击不能只用来抢锁。
            // 刚从组件库选完组件时，关面板的自动回锁常被 Chrome 指针锁冷却期
            // （exitPointerLock 后 ~1.25s）拒绝，此时第一下左键若被「重新锁定」整口
            // 吞掉，用户看到的就是「按左键没反应、建不了」。抢锁的同时直接盖章。
            if (getPlacing() && state.camMode === 'player') consumePlaceClick();
            return;
        }
        if (e.button === 0) {
            primaryActionPress();
        } else if (e.button === 1) {
            e.preventDefault(); // 挡掉浏览器中键自动滚动
            if (state.camMode === 'player' && isCreative()) pickBlockUnderCrosshair();
        } else if (e.button === 2) {
            secondaryAction();
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
        // 助手面板/出题面板打开时鼠标归面板，不在此抢锁。
        // 纯键盘模式永不抢锁（鼠标专职 UI）
        if (state.inputMode === 'keyboard') return;
        if (getUIState() === 'playing' && !isAssistantVisible() && !state.recordingControlsOpen
            && !state.levelExportOpen && !state.authorPanelOpen && !isPlaying()) requestLock();
    });
}

// AI 施工控制：[ ] 调速 / P 暂停 / G 传送 / R 录像 / C 摄像头（自由视角·建造跟拍）。
// 不依赖指针锁定：AI 建造时在暂停菜单或助手面板里也能暂停、调速、前往施工现场、切跟拍机位。
function handleBuildKeys(e) {
    // 键盘自动重复对开关型施工键是灾难：按住 R 半秒会连发 keydown，
    // 录像被停开停开——每次停都落一个垃圾视频文件，还可能留下没人要的孤儿录像
    // （第二次按 R 反而变成开始录，两次按键之间的画面就丢了）。
    // 只放行 [ ]：调速的连续步进有意义；其余键只认首次按下。
    if (e.repeat && e.code !== 'BracketLeft' && e.code !== 'BracketRight') return;
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
