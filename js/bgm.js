// ==================== bgm.js ====================
// 动态背景配乐：按游戏态势在四首循环曲之间切换（MusicGen 本地生成，
// assets/audio/bgm_*.m4a）。主循环每帧调 updateBGM()。
//
// 态势优先级（高→低）：
//   combat   战斗曲 —— 刚被攻击（HIT_HOLD_SEC 内）或怪物贴脸
//   approach 接近曲 —— 最近的怪物进入接近距离
//   night    黑夜曲 —— isNight()（有怪物但都在远处时也停留在此）
//   day      白天曲 —— 默认
// 另有怪物从无到有时叠放一次的「出现」警示句（bgm_alert，一次性，不循环）。
//
// 防重叠双保险：
//   1. 迟滞阈值——进入/退出用不同距离（如接近 18 格进、24 格才退），怪物在阈值边
//      附近徘徊不会来回切歌；非紧急曲另有最小切换间隔；
//   2. 单曲硬保证——startTrack 先掐掉活动列表里其它所有循环曲再起头，任何时刻
//      最多只有一首循环曲发声（旧曲 0.2s 快速淡出，不做长交叉淡化）。
// 音频上下文复用 audio.js 的 audioCtx，浏览器自动播放策略下在首个用户手势后自动
// 恢复。缺音频文件（如纯静态托管没带 assets/audio）时各曲加载失败被静默忽略。

import { audioCtx } from './audio.js';
import { isNight, state } from './state.js';
import { getUIState } from './uiModal.js';

const BGM_VOL = 0.42;
const FADE_IN_SEC = 1.2; // 新曲淡入
const FADE_OUT_SEC = 0.2; // 旧曲掐断前的快速淡出（避免叠歌）
const SWITCH_HOLD_SEC = 8; // 非紧急切换的最小间隔，让曲子有呼吸感
const CANDIDATE_STABLE_SEC = 1.2; // 候选曲需稳定该时长才真正切换
const STING_COOLDOWN_SEC = 20; // 出现警示句的最短间隔
const HIT_HOLD_SEC = 4; // 被攻击后战斗曲的保底时长
const APPROACH_ENTER = 18; // 怪物进入该距离 → 接近曲
const APPROACH_EXIT = 24; // 迟滞：接近曲退出距离
const COMBAT_ENTER = 8; // 怪物贴脸该距离 → 战斗曲
const COMBAT_EXIT = 12; // 迟滞：战斗曲退出距离

const TRACK_FILES = {
    day: 'assets/audio/bgm_day.m4a',
    night: 'assets/audio/bgm_night.m4a',
    approach: 'assets/audio/bgm_approach.m4a',
    combat: 'assets/audio/bgm_combat.m4a',
};
const STING_FILE = 'assets/audio/bgm_alert.m4a';

let master = null; // BGM 总线（音量统一在这里，不与音效混路）
let buffers = {}; // key -> AudioBuffer
let stingBuffer = null;
let initDone = false;

let active = new Set(); // 当前出声的循环曲（正常最多 1 首，掐断过渡期短暂 2 首）
let currentKey = null;
let targetKey = null; // 候选目标曲（稳定 CANDIDATE_STABLE_SEC 才切换）
let targetSince = 0;
let lastSwitchAt = -1e9;
let lastStingAt = -1e9;
let prevEnemyCount = 0;
let lastHitAt = -1e9;

function nowSec() {
    return performance.now() / 1000;
}

function loadOne(file) {
    return fetch(file)
        .then((res) => {
            if (!res.ok) throw new Error(`${res.status}`);
            return res.arrayBuffer();
        })
        .then((ab) => audioCtx.decodeAudioData(ab));
}

export function initBGM() {
    if (!audioCtx || initDone) return;
    initDone = true;
    master = audioCtx.createGain();
    master.gain.value = BGM_VOL;
    master.connect(audioCtx.destination);
    for (const [key, file] of Object.entries(TRACK_FILES)) {
        loadOne(file).then((buf) => { buffers[key] = buf; }).catch(() => { /* 无音频文件：静默降级 */ });
    }
    loadOne(STING_FILE).then((buf) => { stingBuffer = buf; }).catch(() => {});

    // 页面切后台时压低音乐（浏览器仍会播放），回前台恢复
    document.addEventListener('visibilitychange', () => {
        if (!master) return;
        const t = audioCtx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(document.hidden ? 0 : BGM_VOL, t + 0.6);
    });
}

// 玩家受伤时由 playerLife.damagePlayer 调用：战斗曲保底 HIT_HOLD_SEC
export function notifyPlayerHit() {
    lastHitAt = nowSec();
}

// 起一首循环曲。铁律：先把活动列表里其它循环曲全部快速掐断，保证不叠歌
function startTrack(key) {
    const t = audioCtx.currentTime;
    for (const a of active) {
        try {
            a.gain.gain.cancelScheduledValues(t);
            a.gain.gain.setValueAtTime(a.gain.gain.value, t);
            a.gain.gain.linearRampToValueAtTime(0.0001, t + FADE_OUT_SEC);
            a.source.stop(t + FADE_OUT_SEC + 0.05);
        } catch (e) { /* 已停止的源忽略 */ }
    }
    active.clear();

    const src = audioCtx.createBufferSource();
    src.buffer = buffers[key];
    src.loop = true;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(1, t + FADE_IN_SEC);
    const entry = { key, source: src, gain };
    src.onended = () => active.delete(entry);
    src.connect(gain).connect(master);
    src.start(t);
    active.add(entry);
    currentKey = key;
    lastSwitchAt = nowSec();
}

function stopAll(fade = 0.6) {
    if (active.size === 0) return;
    const t = audioCtx.currentTime;
    for (const a of active) {
        a.gain.gain.cancelScheduledValues(t);
        a.gain.gain.setValueAtTime(a.gain.gain.value, t);
        a.gain.gain.linearRampToValueAtTime(0.0001, t + fade);
        a.source.stop(t + fade + 0.05);
    }
    active.clear();
    currentKey = null;
    lastSwitchAt = nowSec();
}

// 一次性「怪物出现」警示句：叠放在当前循环曲之上（短促一次性，不算叠歌）
function playSting() {
    if (!stingBuffer) return;
    const t = audioCtx.currentTime;
    const src = audioCtx.createBufferSource();
    src.buffer = stingBuffer;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.9;
    src.connect(gain).connect(master);
    src.start(t);
    lastStingAt = nowSec();
}

// 主循环每帧调用
export function updateBGM() {
    if (!master) return;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {}); // 自动播放策略：首个用户手势后才会成功
        return;
    }
    const now = nowSec();

    // 首屏不播（进入世界才有配乐）
    if (getUIState() === 'title') {
        stopAll(0.4);
        targetKey = null;
        prevEnemyCount = state.enemies.length;
        return;
    }

    // 态势判定（带迟滞：进/出用不同阈值，防止在边界来回切歌）
    const p = state.player;
    let nearest = Infinity;
    for (const e of state.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z);
        if (d < nearest) nearest = d;
    }
    const combat = currentKey === 'combat'
        ? (now - lastHitAt < HIT_HOLD_SEC) || nearest <= COMBAT_EXIT
        : (now - lastHitAt < HIT_HOLD_SEC) || nearest <= COMBAT_ENTER;
    const approach = combat ? false
        : currentKey === 'approach' ? nearest <= APPROACH_EXIT : nearest <= APPROACH_ENTER;
    const key = combat ? 'combat' : approach ? 'approach' : (isNight() ? 'night' : 'day');

    // 怪物从无到有：叠放一次警示句（战斗/接近曲本身已是强提示，不叠加）
    if (state.enemies.length > 0 && prevEnemyCount === 0 && key !== 'combat' && key !== 'approach' &&
        now - lastStingAt > STING_COOLDOWN_SEC) {
        playSting();
    }
    prevEnemyCount = state.enemies.length;

    // 候选稳定后才切换；非紧急曲有最小间隔防抽搐
    if (key !== targetKey) {
        targetKey = key;
        targetSince = now;
    }
    const stable = now - targetSince >= CANDIDATE_STABLE_SEC;
    const urgent = key === 'combat' || key === 'approach';
    if (buffers[key] && currentKey !== key && stable &&
        (urgent || now - lastSwitchAt >= SWITCH_HOLD_SEC)) {
        startTrack(key);
    }
}
