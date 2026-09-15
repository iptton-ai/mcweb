// ==================== eduRewards.js（Edu M2，2026-09-08）====================
// 教学玩法共享：学习进度存取 + 奖励梯队发放 + 识字认领。
// 被 eduKeypad.js（答题机）与 eduMerchant.js（英语商人）共用；识字矿石的
// 记字逻辑也在这里（interaction.js 调 collectHanziAt）。
//
// 奖励梯队设计（防「答 100 题只得到苹果」的疲劳）：
//   连对阶梯（streak）：8+ 传说（钻石×2+熟猪排×2）→ 5+ 史诗（钻石×1+铁锭×2）
//                      → 3+ 精良（铁锭×2+苹果×2）→ 基础 苹果×1
//   累计里程碑（solved/words 总数）：5 红石灯×2 → 10 粘液块×8 → 20 钻石×2 → 50 钻石×5
//   随机彩蛋：10% 追加熟猪排×1
// 奖励走 spawnItemDrop 真物品实体（从方块顶弹出→自动磁吸入包，看得见摸得着）。

import { BlockTypes, ItemTypes, LAMP_ITEM_ID, BlockInfo } from './config.js';
import { state } from './state.js';
import { spawnItemDrop } from './items.js';
import { playEduUnlockSound } from './audio.js';

// ---------- 进度存取（localStorage，跨存档槽累计） ----------
export const EDU_STORE_KEY = 'mcweb.edu.v1';

export function loadEduProgress() {
    try { return JSON.parse(localStorage.getItem(EDU_STORE_KEY)) || {}; } catch (e) { return {}; }
}

export function saveEduProgress(p) {
    try { localStorage.setItem(EDU_STORE_KEY, JSON.stringify(p)); } catch (e) {}
}

// ---------- 奖励梯队 ----------
const REWARD_TIERS = [ // 从高到低取第一个满足的 streak 门槛
    { min: 8, label: '🌟 传说', drops: [[ItemTypes.DIAMOND, 2], [ItemTypes.COOKED_PORK, 2]] },
    { min: 5, label: '💎 史诗', drops: [[ItemTypes.DIAMOND, 1], [ItemTypes.IRON_INGOT, 2]] },
    { min: 3, label: '⚒️ 精良', drops: [[ItemTypes.IRON_INGOT, 2], [ItemTypes.APPLE, 2]] },
    { min: 0, label: '🍎 普通', drops: [[ItemTypes.APPLE, 1]] },
];

// 累计里程碑（答对总数达到 → 一次性追加，progress.claimed 记已领里程碑）
const MILESTONES = [
    { at: 5, key: 'ms5', label: '红石灯×2', drops: [[LAMP_ITEM_ID, 2]] },
    { at: 10, key: 'ms10', label: '粘液块×8', drops: [[BlockTypes.SLIME, 8]] },
    { at: 20, key: 'ms20', label: '钻石×2', drops: [[ItemTypes.DIAMOND, 2]] },
    { at: 50, key: 'ms50', label: '钻石×5', drops: [[ItemTypes.DIAMOND, 5]] },
];

function itemName(id) {
    return BlockInfo[id]?.name || '物品';
}

// 发奖：返回描述文本（供调用方 toast）。totalKey 用 'solved'（答题机）或 'trades'（商人）
export function grantEduReward(x, y, z, { streak = 0, totalKey = 'solved' }) {
    const p = loadEduProgress();
    const total = p[totalKey] || 0;
    const tier = REWARD_TIERS.find((t) => streak >= t.min);
    const drops = [...tier.drops];
    const lines = [`${tier.label}奖励：`];
    for (const [id, n] of tier.drops) lines.push(`${itemName(id)}×${n}`);
    // 里程碑：总数过线且未领过 → 追加
    let milestoneHit = null;
    for (const ms of MILESTONES) {
        if (total >= ms.at && !(p.claimed || []).includes(ms.key)) {
            p.claimed = [...(p.claimed || []), ms.key];
            drops.push(...ms.drops);
            milestoneHit = ms;
            lines.push(`🏅 里程碑（累计 ${ms.at}）：${ms.label}`);
        }
    }
    // 随机彩蛋
    if (Math.random() < 0.1) {
        drops.push([ItemTypes.COOKED_PORK, 1]);
        lines.push('🥚 彩蛋：熟猪排×1');
    }
    saveEduProgress(p);
    // 真物品弹出（从方块上方喷出，磁吸自动入包）
    for (let i = 0; i < drops.length; i++) {
        const [id, n] = drops[i];
        spawnItemDrop(x + 0.5, y + 1.2, z + 0.5, id, n, {
            vx: (Math.random() - 0.5) * 1.5,
            vz: (Math.random() - 0.5) * 1.5,
            vy: 2.6 + Math.random(),
        });
    }
    if (milestoneHit) playEduUnlockSound();
    return lines.join(' ');
}

// ---------- 识字矿石：按格子哈希认领生字 ----------
// >>> PURE-BEGIN
// （无 DOM 依赖：识字表归一化纯函数，可在 Node 等无 window 环境直接 eval 测试）
// 识字表归一化（兼容新旧两种格式，契约 §3）：
//   旧：chars = ["绒", "昂", …]（字符串数组）
//   新：chars = [{ ch: "绒", pinyin: "róng", word: "绒毛" }, …]
// 返回 { chars: ["绒", …], info: { 绒: {pinyin, word} } }：
//   chars 保持原文件顺序，专供 hanziFor 哈希（对旧格式而言与旧版行为完全一致）；
//   info 只收新格式的注音/组词（ch 去重，首个生效），供图鉴 hanziInfo(ch) 查询。
export function normalizeHanziChars(rawChars) {
    const chars = [];
    const info = {};
    if (!Array.isArray(rawChars)) return { chars, info };
    for (const it of rawChars) {
        if (typeof it === 'string') { if (it) chars.push(it); continue; }
        if (it && typeof it === 'object' && typeof it.ch === 'string' && it.ch) {
            chars.push(it.ch);
            if (!info[it.ch]) {
                info[it.ch] = {
                    pinyin: typeof it.pinyin === 'string' ? it.pinyin : '',
                    word: typeof it.word === 'string' ? it.word : '',
                };
            }
        }
    }
    return { chars, info };
}
// <<< PURE-END

let hanziList = null;    // null=未加载（懒）；归一化后的字符数组（供 hanziFor 哈希）
let hanziInfoMap = {};   // 字 → { pinyin, word }（新格式才有内容；供图鉴注音）
let hanziLoaded = false;

export async function ensureHanziBank() {
    if (hanziLoaded) return;
    hanziLoaded = true;
    try {
        const resp = await fetch('assets/edu/grade3-hanzi.json');
        if (resp.ok) {
            const data = await resp.json();
            const norm = normalizeHanziChars(data.chars);
            if (norm.chars.length > 50) { hanziList = norm.chars; hanziInfoMap = norm.info; }
        }
    } catch (e) { /* 走兜底 */ }
    if (!hanziList) hanziList = '一二三四五天地人大小上下日月水火山林石田土米禾刀弓车马牛羊鸟虫鱼云雨风雪花草树木叶根江河湖海'.split('');
}

// 查询生字注音/组词（图鉴展示用；题库未加载或旧格式无注音时返回 null）
export function hanziInfo(ch) {
    return (hanziInfoMap && hanziInfoMap[ch]) || null;
}

// 格子 → 生字（同格同字）；返回 char 或 null（未加载完时）
export function hanziFor(x, y, z) {
    if (!hanziList) return null;
    let h = (state.worldSeed >>> 0) ^ 0x85ebca6b;
    h = Math.imul(h ^ x, 0xc2b2ae35) >>> 0;
    h = Math.imul(h ^ y, 0x27d4eb2f) >>> 0;
    h = Math.imul(h ^ z, 0x9e3779b9) >>> 0;
    h ^= h >>> 13;
    h >>>= 0; // 归一无符号防负下标（M1 踩过的坑）
    return hanziList[h % hanziList.length];
}

// 挖开识字矿石时调用：记字入图鉴（新字返回 true + toast 文案）
export function collectHanziAt(x, y, z) {
    const ch = hanziFor(x, y, z);
    if (!ch) return null;
    const p = loadEduProgress();
    const set = new Set(p.hanzi || []);
    const isNew = !set.has(ch);
    set.add(ch);
    p.hanzi = [...set];
    if (isNew) p.hanziNew = (p.hanziNew || 0) + 1;
    saveEduProgress(p);
    return { ch, isNew, total: set.size };
}
