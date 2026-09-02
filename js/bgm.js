// ==================== bgm.js ====================
// 动态背景配乐：按游戏态势在四首循环曲之间切换（MusicGen 本地生成，
// assets/audio/bgm_*.m4a）。主循环每帧调 updateBGM()。
//
// 风格包：同一套态势（day/night/approach/combat）有多套编曲可选，
// 在游戏设置浮层「🎵 音频」页切换并记入 localStorage；新包单曲缺失（如静态托管
// 没带全 assets/audio）时自动回退经典包同名曲，保证总有配乐。
//
// 态势优先级（高→低）：
//   combat   战斗曲 —— 刚被攻击（HIT_HOLD_SEC 内）或怪物贴脸
//   approach 接近曲 —— 最近的怪物进入接近距离
//   night    黑夜曲 —— isNight()（有怪物但都在远处时也停留在此）
//   day      白天曲 —— 默认
// 另有怪物从无到有时叠放一次的「出现」警示句（bgm_alert，一次性，不循环，
// 警示句跨风格通用，不随包切换）。
//
// 防重叠双保险：
//   1. 迟滞阈值——进入/退出用不同距离（如接近 18 格进、24 格才退），怪物在阈值边
//      附近徘徊不会来回切歌；非紧急曲另有最小切换间隔；
//   2. 单曲硬保证——startTrack 先掐掉活动列表里其它所有循环曲再起头，任何时刻
//      最多只有一首循环曲发声（旧曲 0.2s 快速淡出，不做长交叉淡化）。
// 音频上下文复用 audio.js 的 audioCtx，浏览器自动播放策略下在首个用户手势后自动
// 恢复。缺音频文件（如纯静态托管没带 assets/audio）时各曲加载失败被静默忽略。

import { audioCtx, getMasterOut } from './audio.js';
import { isNight, state } from './state.js';
import { getUIState } from './uiModal.js';

const BGM_VOL = 0.42; // 100% 音量时的基准值（用户音量是它的乘数）
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

const MOODS = ['day', 'night', 'approach', 'combat'];

// 风格包注册表（设置浮层「🎵 音频」页据此渲染选择卡）。
// classic 沿用历史文件名 bgm_*.m4a；新包带包前缀 bgm_<pack>_<mood>.m4a。
export const BGM_PACKS = [
    { id: 'classic', name: '经典', icon: '🎮', desc: '初代配乐：轻快白天、阴森黑夜、紧张逼近与战斗' },
    { id: 'pastoral', name: '静谧田园', icon: '🌾', desc: '舒缓钢琴与弦乐，田园诗般悠长的白天与夜晚' },
    { id: 'lofi', name: 'Lo-Fi 慢拍', icon: '☕', desc: '慢节奏 chill beats，爵士钢琴与黑胶颗粒感' },
    { id: 'ambient', name: '环境冥想', icon: '🌫️', desc: '氛围铺底极简舒缓，几乎无节奏，最不打扰' },
];

const STYLE_KEY = 'mcweb.bgm.style';
const VOL_KEY = 'mcweb.bgm.vol';

const STING_FILE = 'assets/audio/bgm_alert.m4a';

function packFile(pack, mood) {
    return pack === 'classic' ? `assets/audio/bgm_${mood}.m4a` : `assets/audio/bgm_${pack}_${mood}.m4a`;
}

let packId = localStorage.getItem(STYLE_KEY) || 'classic';
if (!BGM_PACKS.some((p) => p.id === packId)) packId = 'classic';

const _storedVol = localStorage.getItem(VOL_KEY);
let userVol = _storedVol === null ? 1 : Number(_storedVol); // Number(null)===0，需先判空
if (!Number.isFinite(userVol)) userVol = 1;
userVol = Math.min(1, Math.max(0, userVol));

let master = null; // BGM 总线（音量统一在这里，不与音效混路）
let buffers = {}; // mood -> AudioBuffer（只装当前风格包的曲子）
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

// 装载当前风格包的整套曲目；单曲缺失回退经典包同名曲，再缺就静默（无配乐）
function loadPack() {
    buffers = {};
    for (const mood of MOODS) {
        loadOne(packFile(packId, mood))
            .catch(() => packId !== 'classic' ? loadOne(packFile('classic', mood)) : Promise.reject())
            .then((buf) => { buffers[mood] = buf; })
            .catch(() => { /* 无音频文件：静默降级 */ });
    }
}

function applyVolume(rampSec = 0.3) {
    if (!master) return;
    const t = audioCtx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(BGM_VOL * userVol, t + rampSec);
}

export function initBGM() {
    if (!audioCtx || initDone) return;
    initDone = true;
    master = audioCtx.createGain();
    master.gain.value = BGM_VOL * userVol;
    master.connect(getMasterOut()); // 与音效同走主输出，录像分轨才能带上 BGM
    loadPack();
    loadOne(STING_FILE).then((buf) => { stingBuffer = buf; }).catch(() => {});

    // 页面切后台时压低音乐（浏览器仍会播放），回前台恢复
    document.addEventListener('visibilitychange', () => {
        if (!master) return;
        if (document.hidden) applyVolume(0.6);
        else if (master.gain.value === 0) applyVolume(0.6);
    });
}

// ---------- 设置页调用的开关 ----------
export function getBgmStyle() {
    return packId;
}

export function getBgmVolume() {
    return userVol;
}

export function setBgmVolume(v) {
    userVol = Math.min(1, Math.max(0, Number(v) || 0));
    localStorage.setItem(VOL_KEY, String(userVol));
    applyVolume();
}

// 切风格包：旧曲快速淡出，新包加载完成后 updateBGM 会按当前态势自动接上
export function setBgmStyle(id) {
    if (!BGM_PACKS.some((p) => p.id === id) || id === packId) return;
    packId = id;
    localStorage.setItem(STYLE_KEY, id);
    if (!audioCtx || !master) return; // 音频栈未起时只记偏好，initBGM 时按它装载
    stopAll(0.5);
    loadPack();
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
