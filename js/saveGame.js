// ==================== saveGame.js ====================
// 游戏存档：世界方块 + 玩家/模式/时间写入 localStorage（单存档槽）。
// 自动存档：每 SAVE_AUTOSAVE_SEC 秒一次 + 页面隐藏/关闭时兜底；
// 手动存档：开始界面（Esc 菜单）的「保存进度」按钮；开始界面选模式 = 放弃当前存档开新世界。
// 存档结构对齐 assistant/snapshot.js 的热重载快照（怪物/掉落物/TNT 属瞬时实体，不保存）。

import {
    CHUNK_SIZE,
    MAX_HEALTH,
    PLAYER_EYE_HEIGHT,
    SAVE_AUTOSAVE_SEC,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    migrateLegacyGears,
} from './config.js';
import { state } from './state.js';
import { buildChunkProps, updateChunkMeshes } from './chunk.js';
import { updateHotbar } from './ui.js';
import { updateHealthUI } from './playerLife.js';
import { camera } from './engine.js';

const SAVE_KEY = 'mcweb.save.v1';
// v2（2026-09-01 红石组重做）：v1 的「齿轮」方块 ID 已改作红石组，读入时迁移清为空气。
// 存档结构本身未变，只有方块 ID 语义差异，所以结构字段保持兼容。
const SAVE_VERSION = 2;
const LOADABLE_VERSIONS = [1, 2];

function u8ToBase64(u8) {
    let s = '';
    const CH = 0x8000; // 分块转换，避免超出函数参数长度上限
    for (let i = 0; i < u8.length; i += CH) {
        s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
}

function base64ToU8(b64) {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
}

export function hasSave() {
    try {
        return !!localStorage.getItem(SAVE_KEY);
    } catch {
        return false;
    }
}

// 存档时间的可读文本，用于开始界面「继续游戏」按钮
export function saveTimeText() {
    try {
        const save = JSON.parse(localStorage.getItem(SAVE_KEY));
        if (!save?.savedAt) return '';
        const d = new Date(save.savedAt);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
        return '';
    }
}

export function saveGame() {
    if (!state.blocks) return false;
    try {
        const p = state.player;
        const save = {
            version: SAVE_VERSION,
            savedAt: Date.now(),
            blocks: u8ToBase64(state.blocks),
            player: {
                x: p.x, y: p.y, z: p.z,
                yaw: p.yaw, pitch: p.pitch,
                flying: p.flying,
                // 死亡状态下不把 0 血写进存档，读出来直接满血可玩
                health: p.dead ? MAX_HEALTH : p.health,
                selectedSlot: p.selectedSlot,
                inventory: p.inventory,
            },
            gameMode: state.gameMode,
            viewMode: state.viewMode,
            time: state.time,
            spawn: { ...state.spawn },
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(save));
        return true;
    } catch (e) {
        // 常见失败原因：localStorage 配额不足（隐私模式/已满）
        console.error('存档保存失败：', e);
        return false;
    }
}

export function deleteSave() {
    try {
        localStorage.removeItem(SAVE_KEY);
    } catch { /* 忽略 */ }
}

// 读档并恢复世界与玩家（重建全部区块网格），成功返回 true。
// 失败（无存档/数据损坏/世界尺寸不符）返回 false，调用方回退到生成新世界。
export function loadGame() {
    let save = null;
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) save = JSON.parse(raw);
    } catch {
        save = null;
    }
    if (!save || !LOADABLE_VERSIONS.includes(save.version) || !save.blocks) return false;

    let u8;
    try {
        u8 = base64ToU8(save.blocks);
    } catch {
        return false;
    }
    if (u8.length !== WORLD_WIDTH * WORLD_HEIGHT * WORLD_DEPTH) {
        console.error('存档世界尺寸不符，放弃恢复');
        return false;
    }
    // 旧版存档：齿轮 ID 区间已改作红石组，清为空气（拉杆/红石灯/门不受影响）
    if (save.version === 1) migrateLegacyGears(u8);

    // 覆盖世界数据并重建全部区块网格
    state.blocks = u8;
    updateChunkMeshes();
    const cxCount = Math.ceil(WORLD_WIDTH / CHUNK_SIZE);
    const czCount = Math.ceil(WORLD_DEPTH / CHUNK_SIZE);
    for (let cx = 0; cx < cxCount; cx++) {
        for (let cz = 0; cz < czCount; cz++) {
            buildChunkProps(cx, cz);
        }
    }

    // 恢复玩家与全局状态（不走 setGameMode：它有送火把/刷怪等副作用）
    const p = save.player || {};
    Object.assign(state.player, {
        x: p.x ?? state.player.x,
        y: p.y ?? state.player.y,
        z: p.z ?? state.player.z,
        vx: 0, vy: 0, vz: 0,
        yaw: p.yaw || 0,
        pitch: p.pitch || 0,
        flying: !!p.flying,
        health: p.health ?? MAX_HEALTH,
        dead: false,
        selectedSlot: p.selectedSlot || 0,
        inventory: p.inventory || {},
    });
    if (save.gameMode) state.gameMode = save.gameMode;
    if (typeof save.time === 'number') state.time = save.time;
    if (save.spawn) state.spawn = save.spawn;
    if (typeof save.viewMode === 'number') state.viewMode = save.viewMode;
    camera.position.set(state.player.x, state.player.y + PLAYER_EYE_HEIGHT, state.player.z);

    updateHotbar();
    updateHealthUI();
    return true;
}

// 自动存档：定时 + 页面隐藏/关闭兜底（开始界面停留时存的是当前世界，无害）
export function initAutoSave() {
    setInterval(() => {
        if (state.blocks && !state.player.dead) saveGame();
    }, SAVE_AUTOSAVE_SEC * 1000);

    window.addEventListener('pagehide', () => {
        if (state.blocks && !state.player.dead) saveGame();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && state.blocks && !state.player.dead) saveGame();
    });
}
