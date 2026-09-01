// ==================== saveGame.js ====================
// 游戏存档：多槽位（每槽一个独立世界）写入 localStorage。
// 槽位 key：mcweb.save.v1.slotN（N=0..SAVE_SLOTS-1）；轻量索引 mcweb.save.index
// （各槽 savedAt/gameMode + 上次游玩槽位），槽位列表 UI 只解析索引、不解码大 payload。
// 方块数据 RLE 压缩后 base64（enc:'rle'），不可压缩时回退原始 base64（enc:'raw'）。
// 自动存档：每 SAVE_AUTOSAVE_SEC 秒一次 + 页面隐藏/关闭时兜底，写入当前槽（state.saveSlot）；
// 手动存档：开始界面（Esc 菜单）的「保存进度」按钮；首屏槽位列表可切换世界/在空槽开新世界。
// 存档字段对齐 assistant/snapshot.js 的热重载快照（快照不含 enc/槽位；
// 怪物/掉落物/TNT 属瞬时实体，不保存）。

import {
    CHUNK_SIZE,
    MAX_HEALTH,
    PLAYER_EYE_HEIGHT,
    SAVE_AUTOSAVE_SEC,
    SAVE_SLOTS,
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

const SLOT_KEY_PREFIX = 'mcweb.save.v1.slot';
const INDEX_KEY = 'mcweb.save.index';
const LEGACY_KEY = 'mcweb.save.v1'; // 旧单槽存档：发现时自动迁入槽 0
// v2（2026-09-01 红石组重做）：v1 的「齿轮」方块 ID 已改作红石组，读入时迁移清为空气。
// v3（2026-09-01 多存档位）：方块数据 RLE 压缩（enc 字段），槽位化 key。v1/v2 读入走原始 base64。
const SAVE_VERSION = 3;
const LOADABLE_VERSIONS = [1, 2, 3];

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

// RLE 压缩：[value, countHi, countLo] 三元组流，单段最长 65535。
// 体素世界大量连续（空气/石头），通常能压到原始体积的几分之一；是否采用由 saveGame 按体积取舍。
function rleEncode(u8) {
    const out = [];
    let i = 0;
    while (i < u8.length) {
        const v = u8[i];
        let run = 1;
        while (run < 0xFFFF && i + run < u8.length && u8[i + run] === v) run++;
        out.push(v, run >> 8, run & 0xFF);
        i += run;
    }
    return new Uint8Array(out);
}

// 解码到指定总长度的 Uint8Array；长度不符（数据损坏）返回 null
function rleDecode(u8, total) {
    const out = new Uint8Array(total);
    let pos = 0;
    for (let i = 0; i + 2 < u8.length; i += 3) {
        const run = (u8[i + 1] << 8) | u8[i + 2];
        if (pos + run > total) return null;
        out.fill(u8[i], pos, pos + run);
        pos += run;
    }
    return pos === total ? out : null;
}

// ==================== 槽位索引 ====================

// 读某槽的元数据（解析整个 payload；仅在索引丢失重建时用，平时列表走轻量索引）
function slotMetaFromKey(i) {
    try {
        const save = JSON.parse(localStorage.getItem(SLOT_KEY_PREFIX + i));
        if (save?.savedAt) return { savedAt: save.savedAt, gameMode: save.gameMode || null };
    } catch { /* 损坏的槽当作空槽 */ }
    return null;
}

function writeIndex(idx) {
    try {
        localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
    } catch { /* 配额不足写不进索引：槽位数据仍在，下次会扫描重建索引 */ }
}

// 索引丢失/损坏时扫描槽位 key 重建（首个非空槽作为默认 current）
function rebuildIndex() {
    const idx = { slots: new Array(SAVE_SLOTS).fill(null), current: 0 };
    for (let i = 0; i < SAVE_SLOTS; i++) idx.slots[i] = slotMetaFromKey(i);
    const first = idx.slots.findIndex((s) => s);
    if (first >= 0) idx.current = first;
    writeIndex(idx);
    return idx;
}

function readIndex() {
    try {
        const idx = JSON.parse(localStorage.getItem(INDEX_KEY));
        if (idx && Array.isArray(idx.slots)) {
            const slots = [];
            for (let i = 0; i < SAVE_SLOTS; i++) slots.push(idx.slots[i] || null);
            const currentOk = Number.isInteger(idx.current) && idx.current >= 0 && idx.current < SAVE_SLOTS;
            return { slots, current: currentOk ? idx.current : 0 };
        }
    } catch { /* 损坏则重建 */ }
    return rebuildIndex();
}

// 旧单槽存档（key mcweb.save.v1）迁入槽 0：仅在无新索引时执行一次，老玩家存档无感保留
function migrateLegacySave() {
    let raw = null;
    try { raw = localStorage.getItem(LEGACY_KEY); } catch { return; }
    if (!raw) return;
    try {
        if (localStorage.getItem(INDEX_KEY) || localStorage.getItem(SLOT_KEY_PREFIX + '0')) return;
        localStorage.setItem(SLOT_KEY_PREFIX + '0', raw);
        localStorage.removeItem(LEGACY_KEY);
    } catch { /* 迁移失败旧档留在原地，下次启动重试 */ }
}

// 存储初始化：旧单槽迁移 + 确保索引就绪，并把当前槽设为上次游玩的槽位。
// main.js 启动时在首次 loadGame 前调用一次。
export function initSaves() {
    migrateLegacySave();
    const idx = readIndex();
    state.saveSlot = idx.current;
}

// 各槽元数据（SAVE_SLOTS 长度数组，空槽为 null），供首屏槽位列表渲染
export function listSaves() {
    return readIndex().slots;
}

// 存档时间的可读文本（槽位列表 / 菜单文案用）
export function savedAtText(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function saveGame() {
    if (!state.blocks) return false;
    try {
        const p = state.player;
        // RLE 压缩；膨胀（不可压缩数据）时回退原始编码
        const rle = rleEncode(state.blocks);
        const useRle = rle.length < state.blocks.length;
        const save = {
            version: SAVE_VERSION,
            enc: useRle ? 'rle' : 'raw',
            savedAt: Date.now(),
            blocks: u8ToBase64(useRle ? rle : state.blocks),
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
        localStorage.setItem(SLOT_KEY_PREFIX + state.saveSlot, JSON.stringify(save));
        // 同步索引（失败不影响存档本身：索引可由扫描重建）
        const idx = readIndex();
        idx.slots[state.saveSlot] = { savedAt: save.savedAt, gameMode: state.gameMode };
        idx.current = state.saveSlot;
        writeIndex(idx);
        return true;
    } catch (e) {
        // 常见失败原因：localStorage 配额不足（隐私模式/已满）
        console.error('存档保存失败：', e);
        return false;
    }
}

// 删除指定槽的存档（不影响其他槽与内存中的世界）
export function deleteSave(slot) {
    const i = clampSlot(slot);
    try {
        localStorage.removeItem(SLOT_KEY_PREFIX + i);
    } catch { /* 忽略 */ }
    const idx = readIndex();
    idx.slots[i] = null;
    writeIndex(idx);
}

function clampSlot(slot) {
    const i = slot | 0;
    return Math.max(0, Math.min(SAVE_SLOTS - 1, Number.isNaN(i) ? 0 : i));
}

// 读档并恢复世界与玩家（重建全部区块网格），成功返回 true。
// 失败（无存档/数据损坏/世界尺寸不符）返回 false，调用方回退到生成新世界。
// 读档成功即把当前槽切换为该槽（state.saveSlot）。
export function loadGame(slot = state.saveSlot) {
    const i = clampSlot(slot);
    let save = null;
    try {
        const raw = localStorage.getItem(SLOT_KEY_PREFIX + i);
        if (raw) save = JSON.parse(raw);
    } catch {
        save = null;
    }
    if (!save || !LOADABLE_VERSIONS.includes(save.version) || !save.blocks) return false;

    const total = WORLD_WIDTH * WORLD_HEIGHT * WORLD_DEPTH;
    let u8;
    try {
        u8 = base64ToU8(save.blocks);
    } catch {
        return false;
    }
    if (save.version >= 3 && save.enc === 'rle') {
        u8 = rleDecode(u8, total);
        if (!u8) return false;
    } else if (u8.length !== total) {
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

    state.saveSlot = i;
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
