// ==================== assistant/snapshot.js ====================
// 世界快照：热重载前保存世界与玩家状态到 sessionStorage，页面刷新后完整恢复，
// 让「改游戏代码」对玩家无感（建筑、背包、位置都不丢）。

import { CHUNK_SIZE, PLAYER_EYE_HEIGHT, WORLD_DEPTH, WORLD_WIDTH, migrateLegacyGears } from '../config.js';
import { state } from '../state.js';
import { rleDecode, rleEncode } from '../saveGame.js'; // 快照同样压缩：世界扩容后 raw base64 会超出 sessionStorage 配额
import { buildChunkProps, updateChunkMeshes } from '../chunk.js';
import { updateHotbar } from '../ui.js';
import { updateHealthUI } from '../playerLife.js';
import { camera } from '../engine.js';

const SNAPSHOT_KEY = 'mcAssistant.snapshot';

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

// 热重载前调用：序列化世界方块 + 玩家/模式/时间（RLE 压缩——2026-09-06 世界扩容后
// raw base64 约 10.7MB 会超 sessionStorage 配额，热重载将丢世界；压缩后约 1~2MB）
export function saveSnapshotForReload() {
    try {
        const p = state.player;
        const rle = rleEncode(state.blocks);
        const useRle = rle.length < state.blocks.length;
        const snap = {
            v: 3, // 快照版本：v3 加 enc 压缩字段；无 v 旧快照含已移除的齿轮 ID，恢复时迁移
            enc: useRle ? 'rle' : 'raw',
            savedAt: Date.now(),
            blocks: u8ToBase64(useRle ? rle : state.blocks),
            player: {
                x: p.x, y: p.y, z: p.z,
                yaw: p.yaw, pitch: p.pitch,
                flying: p.flying, health: p.health,
                selectedSlot: p.selectedSlot,
                inventory: p.inventory,
            },
            gameMode: state.gameMode,
            viewMode: state.viewMode,
            time: state.time,
            spawn: { ...state.spawn },
        };
        sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
        return true;
    } catch (e) {
        console.error('世界快照保存失败：', e);
        return false;
    }
}

// 页面加载后调用：存在快照则恢复（在 main.js 初始化完成之后执行）
export function restoreSnapshotIfAny() {
    let snap = null;
    try {
        const raw = sessionStorage.getItem(SNAPSHOT_KEY);
        if (raw) {
            snap = JSON.parse(raw);
            sessionStorage.removeItem(SNAPSHOT_KEY);
        }
    } catch {
        snap = null;
    }
    if (!snap || !snap.blocks) return false;

    // 覆盖世界数据并重建全部区块网格（快照与当前页面同尺寸，无迁移路径）
    let u8 = base64ToU8(snap.blocks);
    if (snap.v >= 3 && snap.enc === 'rle') {
        u8 = rleDecode(u8, state.blocks ? state.blocks.length : 0);
        if (!u8) {
            console.error('世界快照解码失败，放弃恢复');
            return false;
        }
    }
    if (state.blocks && u8.length === state.blocks.length) {
        if (!snap.v) migrateLegacyGears(u8); // 旧快照：齿轮 ID 区间已改作红石组，清为空气
        state.blocks.set(u8);
    } else {
        console.error('世界快照尺寸不匹配，放弃恢复');
        return false;
    }
    updateChunkMeshes();

    // 重建火把光源与花等道具网格
    const cxCount = Math.ceil(WORLD_WIDTH / CHUNK_SIZE);
    const czCount = Math.ceil(WORLD_DEPTH / CHUNK_SIZE);
    for (let cx = 0; cx < cxCount; cx++) {
        for (let cz = 0; cz < czCount; cz++) {
            buildChunkProps(cx, cz);
        }
    }

    // 恢复玩家与全局状态
    const p = snap.player || {};
    Object.assign(state.player, {
        x: p.x, y: p.y, z: p.z,
        vx: 0, vy: 0, vz: 0,
        yaw: p.yaw || 0, pitch: p.pitch || 0,
        flying: !!p.flying,
        health: p.health ?? state.player.health,
        selectedSlot: p.selectedSlot || 0,
        inventory: p.inventory || {},
    });
    if (snap.gameMode) state.gameMode = snap.gameMode;
    if (typeof snap.time === 'number') state.time = snap.time;
    if (snap.spawn) state.spawn = snap.spawn;
    if (typeof snap.viewMode === 'number') state.viewMode = snap.viewMode;
    camera.position.set(state.player.x, state.player.y + PLAYER_EYE_HEIGHT, state.player.z);

    updateHotbar();
    updateHealthUI();
    return true;
}
