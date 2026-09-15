// ==================== eduRewards.js（Edu M2，2026-09-08；P2 拉力回流增量 2026-09-15）====================
// 教学玩法共享：学习进度存取 + 奖励梯队发放 + 识字认领。
// 被 eduKeypad.js（答题机）与 eduMerchant.js（英语商人）共用；识字矿石的
// 记字逻辑也在这里（interaction.js 调 collectHanziAt）。
// P2 增量（契约 docs/edu-workshop-impl-contract.md §3.5）：学习进度 getProgress/setProgress、
// 错题本 addWrongQuestion（cap 50 滚动）、埋点 recordLevelPlay/recordReturnEvent/
// recordHelpRequest/recordEarlyUnlock/getWeeklyReport、题库单元序列 unitSequence
// （+ ensureUnitBanks/unitManifest/unitItemsOf/unitOrdinalOf 辅助，星辉门与设置页共用）。
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
// 单元序列加载（P2 星辉门超纲判定）复用答题机的同规格清洗。注意模块环：
// eduKeypad 也 import 本模块，但双方都只在运行期（函数体内）调对方的导出，
// 顶层求值互不触碰，且被引用的都是函数声明（实例化期即初始化），环是安全的。
import { sanitizeManifest, normalizeBank } from './eduKeypad.js';

// ---------- 进度存取（localStorage，跨存档槽累计） ----------
export const EDU_STORE_KEY = 'mcweb.edu.v1';

export function loadEduProgress() {
    try { return JSON.parse(localStorage.getItem(EDU_STORE_KEY)) || {}; } catch (e) { return {}; }
}

export function saveEduProgress(p) {
    try { localStorage.setItem(EDU_STORE_KEY, JSON.stringify(p)); } catch (e) {}
}

// >>> PURE-BEGIN
// —— P2 拉力与回流（2026-09-15）：学习进度 / 错题本 / 回流埋点（契约 §3.5）——
// 纯逻辑区（无 window/document/state/DOM 依赖）。整模块 import 会拉进 three.js 链，
// Node 测试（tools/test_edu_progress.mjs）按仓库惯例提取各 PURE 区文本剥 export 后 eval；
// 因此本区不直接调用文件头部的 loadEduProgress/saveEduProgress（提取时拿不到），
// 而用下面两个同语义的本地读写助手：同 key（EDU_STORE_KEY，Node eval 场景取兜底字面量）、
// 同 JSON 容错，浏览器内行为完全一致。
function eduKeyOf() {
    return (typeof EDU_STORE_KEY === 'string' && EDU_STORE_KEY) || 'mcweb.edu.v1';
}
function eduStoreRead() {
    try { return JSON.parse(localStorage.getItem(eduKeyOf())) || {}; } catch (e) { return {}; }
}
function eduStoreWrite(p) {
    try { localStorage.setItem(eduKeyOf(), JSON.stringify(p)); } catch (e) {}
}

// ---------- 学习进度（三上第 N 单元，全局进度；下拉数据源 = 数学单元序列） ----------
// 「还没学/超纲」= 学科单元序列中位于 progress.unit 之后的单元（星辉门据此抽题）
export function getProgress() {
    const p = eduStoreRead();
    const u = Math.floor(Number(p.progress && p.progress.unit));
    return { unit: u >= 1 ? u : 1 }; // 默认三上第 1 单元；脏数据一律拉回合法区间
}

export function setProgress(unit) {
    const p = eduStoreRead();
    const u = Math.floor(Number(unit));
    p.progress = { unit: u >= 1 ? u : 1 };
    eduStoreWrite(p);
    return p.progress;
}

// ---------- ISO 周键（埋点聚合的离散桶） ----------
// 'YYYY-Www'（周一为一周之始；含当年第一个周四的那周是第 1 周，ISO 8601）。
// 入参按「本地时区的年月日」取日历日——同一天在任何时区都得到同一个本地日历日的周键。
export function weekKeyOf(date) {
    // 平移到 UTC 再算，避免本地时区/夏令时干扰周差计算
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = (d.getUTCDay() + 6) % 7; // 周一=0 … 周日=6
    d.setUTCDate(d.getUTCDate() - day + 3); // 本 ISO 周的周四（周四所在年份即 ISO 年份）
    const isoYear = d.getUTCFullYear();
    const firstThu = new Date(Date.UTC(isoYear, 0, 4)); // 1 月 4 日必在第 1 周
    const fd = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - fd + 3); // 第 1 周的周四
    const week = 1 + Math.round((d - firstThu) / (7 * 86400000)); // 两个周四相距恒为整天数
    return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

// ---------- 单元序列（题库 items 的 unit 字段保序去重） ----------
// 纯函数：input/choice 混排的 items 都可以喂进来（只认 unit 字段，与题型无关）；
// 空 unit 丢弃（无法归入序列，超纲判定也不收）。
export function unitSequenceFromItems(items) {
    const seq = [];
    if (!Array.isArray(items)) return seq;
    const seen = new Set();
    for (const it of items) {
        const u = it && typeof it.unit === 'string' ? it.unit.trim() : '';
        if (!u || seen.has(u)) continue;
        seen.add(u);
        seq.push({ unit: u });
    }
    return seq;
}

// ---------- 错题本（仅关卡/预告场景登记；交接卡「本周带走」的数据源） ----------
const WRONG_BOOK_CAP = 50;   // 上限 50 条，滚动淘汰最旧（plan §4.5 决策点）
const RETURN_EVENTS_CAP = 200; // 回流/提前解锁事件列表上限（防长跑用户无限膨胀）

// entry = { t?, subject, unit, stem, answer?, options?, hint?, source }
//   answer：input=数值答案 / choice=正确下标（交接卡折叠区配 options 翻成文本展示）
//   source：'星辉门' 或 '关卡「名字」'（plan §4.4）
export function addWrongQuestion(entry) {
    const p = eduStoreRead();
    if (!Array.isArray(p.wrongBook)) p.wrongBook = [];
    const e = entry && typeof entry === 'object' ? entry : {};
    p.wrongBook.push({
        t: Number.isFinite(e.t) ? e.t : Date.now(),
        subject: typeof e.subject === 'string' ? e.subject : '',
        unit: typeof e.unit === 'string' ? e.unit : '',
        stem: typeof e.stem === 'string' ? e.stem : '',
        answer: Number.isFinite(e.answer) ? e.answer : undefined,
        options: Array.isArray(e.options) ? [...e.options] : undefined,
        hint: typeof e.hint === 'string' ? e.hint : undefined,
        source: typeof e.source === 'string' ? e.source : '',
    });
    if (p.wrongBook.length > WRONG_BOOK_CAP) p.wrongBook = p.wrongBook.slice(-WRONG_BOOK_CAP);
    eduStoreWrite(p);
}

// ---------- 埋点（全部 localStorage 聚合，家长页显示趋势） ----------
// p.metrics = { weekPlays:{'YYYY-Www':n}, returnEvents:[{t,unit}], helpRequests:n,
//               earlyUnlocks:[{t,unit}] }（earlyUnlocks 为本作追加字段，契约形状只增不改）
function metricsOf(p) {
    if (!p.metrics || typeof p.metrics !== 'object') {
        p.metrics = { weekPlays: {}, returnEvents: [], helpRequests: 0, earlyUnlocks: [] };
    }
    const m = p.metrics;
    if (!m.weekPlays || typeof m.weekPlays !== 'object') m.weekPlays = {};
    if (!Array.isArray(m.returnEvents)) m.returnEvents = [];
    if (!Array.isArray(m.earlyUnlocks)) m.earlyUnlocks = [];
    if (!Number.isFinite(m.helpRequests)) m.helpRequests = 0;
    return m;
}

// 周主动开玩：enterLevel 时 +1（由 levelRun 侧调用；七天内同卡重复进入也如实计）
export function recordLevelPlay() {
    const p = eduStoreRead();
    const m = metricsOf(p);
    const k = weekKeyOf(new Date());
    m.weekPlays[k] = (m.weekPlays[k] || 0) + 1;
    eduStoreWrite(p);
}

// 回流事件：星辉门错题入本后七天内在同一知识点开门=一次成功回流（plan §4.1 用户故事）。
// 简化口径：自由世界星辉门答对开门即记（窗口去重交给家长页趋势呈现，不在端上做复杂判定）。
export function recordReturnEvent(unit) {
    const p = eduStoreRead();
    const m = metricsOf(p);
    m.returnEvents.push({ t: Date.now(), unit: typeof unit === 'string' ? unit : '' });
    if (m.returnEvents.length > RETURN_EVENTS_CAP) m.returnEvents = m.returnEvents.slice(-RETURN_EVENTS_CAP);
    eduStoreWrite(p);
}

// 求助提示次数（P3 前记「打开助手要提示」；后续 docs.js 接线）
export function recordHelpRequest() {
    const p = eduStoreRead();
    const m = metricsOf(p);
    m.helpRequests += 1;
    eduStoreWrite(p);
}

// 提前解锁：超纲门答对开门（强激励，家长页展示成就感）
export function recordEarlyUnlock(unit) {
    const p = eduStoreRead();
    const m = metricsOf(p);
    m.earlyUnlocks.push({ t: Date.now(), unit: typeof unit === 'string' ? unit : '' });
    if (m.earlyUnlocks.length > RETURN_EVENTS_CAP) m.earlyUnlocks = m.earlyUnlocks.slice(-RETURN_EVENTS_CAP);
    eduStoreWrite(p);
}

// 近 4 周聚合（含本周）→ 家长页「回流趋势」简表的文案数据。
// now 可注入固定日期（测试确定性）；weeks 从旧到新共 4 桶，越窗事件不计入。
export function getWeeklyReport(now) {
    const ref = now instanceof Date ? now : new Date();
    const p = eduStoreRead();
    const m = metricsOf(p);
    const weeks = [];
    for (let i = 3; i >= 0; i--) {
        const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - i * 7);
        weeks.push({ key: weekKeyOf(d), plays: m.weekPlays[weekKeyOf(d)] || 0, returns: 0 });
    }
    const byKey = new Map(weeks.map((w) => [w.key, w]));
    let totalReturns = 0;
    for (const ev of m.returnEvents) {
        if (!ev || !Number.isFinite(ev.t)) continue;
        const w = byKey.get(weekKeyOf(new Date(ev.t)));
        if (w) { w.returns += 1; totalReturns += 1; }
    }
    return {
        weeks, // [{key, plays, returns}] 旧 → 新
        totalPlays: weeks.reduce((s, w) => s + w.plays, 0),
        totalReturns,
        helpRequests: m.helpRequests,
        earlyUnlocks: m.earlyUnlocks.length,
    };
}
// <<< PURE-END

// ---------- 题库单元序列加载（P2：星辉门超纲判定 + 设置页进度选择器的数据源） ----------
// 独立于答题机的题池懒加载：eduKeypad 的 subjectState 不外露，这里按同一契约另拉一份
//（借它的 sanitizeManifest/normalizeBank 做同规格清洗；文件是静态资源，多一次 fetch 走 HTTP 缓存）。
// 结构：unitBanks = { subject: [{kind, q, a, unit, hint, options?}, ...] }（input/choice 两个 bank 摊平合并）。
let unitBanks = null;          // null=未加载；{}=加载完成但全部失败（星辉门走降级文案）
let unitBanksRequested = false; // 只拉一次（与 eduKeypad banksRequested 同款防抖）
let unitManifestList = [];     // sanitizeManifest 清洗后的清单条目（weight/emoji/name 给星辉门加权用）

// 清单兜底（assets/edu/banks.json 缺失/损坏时；与该文件同内容，subject 为稳定 key 勿改）
const FALLBACK_UNIT_MANIFEST = [
    { subject: 'math', emoji: '🧮', name: '数学', file: 'grade3-math.json', weight: 2 },
    { subject: 'science', emoji: '🔬', name: '科学', file: 'grade3-science.json', weight: 1 },
    { subject: 'daofa', emoji: '🧭', name: '道法', file: 'grade3-daofa.json', weight: 1 },
    { subject: 'yuwen', emoji: '📖', name: '语文', file: 'grade3-yuwen.json', weight: 1 },
];

export async function ensureUnitBanks() {
    if (unitBanksRequested) return unitBanks || {};
    unitBanksRequested = true;
    let manifest = FALLBACK_UNIT_MANIFEST;
    try {
        const resp = await fetch('assets/edu/banks.json');
        if (resp.ok) {
            const list = sanitizeManifest(await resp.json());
            if (list) manifest = list;
        }
    } catch (e) { /* 清单缺失/损坏 → 代码内同内容兜底清单 */ }
    unitManifestList = manifest;
    const out = {};
    await Promise.all(manifest.map(async (entry) => {
        try {
            const resp = await fetch('assets/edu/' + entry.file);
            if (!resp.ok) return; // 单文件失败 → 该学科无序列（星辉门降级文案，静默同 eduKeypad）
            const norm = normalizeBank(await resp.json());
            if (!norm || norm.subject !== entry.subject) return;
            const items = [];
            for (const b of norm.banks) {
                for (const it of b.items) items.push({ kind: b.kind, ...it }); // kind 下沉到题级（关卡卡同款）
            }
            if (items.length) out[entry.subject] = items;
        } catch (e) { /* 静默：该学科降级 */ }
    }));
    unitBanks = out;
    return unitBanks;
}

// 清单条目（[{subject, emoji, name, weight, file}]）；未加载完成时为 []
export function unitManifest() {
    return unitManifestList;
}

// 某学科的摊平题目（含 kind 标记）；未加载/该学科缺失 → []
export function unitItemsOf(subject) {
    return (unitBanks && unitBanks[subject]) || [];
}

// 学科单元序列 [{unit}]（保序去重；contract §3.5。未加载完成时返回 []，调用方先 ensureUnitBanks）
export function unitSequence(subject) {
    return unitSequenceFromItems(unitItemsOf(subject));
}

// 单元在学科序列中的序数（1 起）；未知单元（含空 unit）→ 0（超纲判定不收）
export function unitOrdinalOf(subject, unit) {
    const seq = unitSequence(subject);
    const i = seq.findIndex((u) => u.unit === unit);
    return i + 1;
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
