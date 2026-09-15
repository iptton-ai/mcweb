// ==================== eduStarlight.js（关卡工坊 P2「拉力与回流」，2026-09-15）====================
// 教学玩法「星辉门」：预告型密室锁具（「想要但还不会」，plan §4.3）。右键锁定态星辉门 →
// 弹出超纲知识点卡片出题（题池 = 当前学习进度之后的知识单元，settingsUI「📚 学习」页可选进度）；
// 答对 = 门翻转为开启变体（非实心可通行，并成为常供能红石信号源——redstone.js keypads 细分处）
// + 记「提前解锁」+ 记回流事件；答错 = 温和文案 + 入错题本（eduRewards.addWrongQuestion，
// 家长页「本周带走」交接卡数据源）+ 引导找 🤖 要提示。
//
// 与 eduKeypad 同族的既有模式（照抄骨架，差异点见各段注释）：
//   - 题库 fetch 静默降级：借 eduRewards.ensureUnitBanks（同一套 sanitizeManifest/normalizeBank
//     清洗）；题池空/题库缺失 → 面板降级文案，绝不报错阻塞玩法。
//   - 答题态不抢鼠标指针（WASD 移动照常）；窗口捕获阶段拦截按键
//     （stopImmediatePropagation + preventDefault，先于 input.js 的快捷栏切换）。
//   - 500ms 走远巡检自动收起（先 close 再 return，防 close 后继续读 session 的空指针——
//     eduKeypad.js:631-640 已修的同构写法）。
//   - 抽题确定性：世界种子+格子坐标+自定盐哈希（同格同题，M1 契约；盐常量独立于答题机，
//     同一个格子放答题机与星辉门互不相关）。
// 与答题机的关键差异：
//   - 抽题池不是全题库，而是「unitSequence(subject) 中 progress.unit 之后的单元」——超纲判定；
//   - 学科仍按清单 weight 加权哈希，但有超纲池的学科才参与；
//   - 关卡联动（P0 levelRun 可选依赖，动态 import 惰性加载——P0 未合入/加载失败时全走可选链）：
//       ① 关卡内题目优先 levelRun.getCardQuestion(x,y,z)（卡内自带题，超纲抽题退位）；
//       ② 作答对错上报 recordLockAttempt(localKey, correct)，localKey 用
//          levelWorkshop.worldToLocal 换算（'lx,ly,lz' 形制，契约 §2）；
//       ③ card.rules.lockAIHelp===false（考核锁）→ 答错文案改「这扇门要靠你自己」，
//          不引导找 🤖；关卡内不记「提前解锁/回流」（记账归 levelRun）。
// 导出：interactStarlightAt(x, y, z)（interaction.js 右键路由调用，返回 true 拦截放置链）/
//       closeStarlightPanel()。

import { CHUNK_SIZE, isStarlightId, starlightId, starlightOpen } from './config.js';
import { state } from './state.js';
import { getBlock, setBlockSafe } from './world.js';
import { rebuildChunk } from './chunk.js';
import { updateRedstoneNetwork } from './redstone.js';
import { getUIState } from './uiModal.js';
import { playEduWrongSound, playEduUnlockSound } from './audio.js';
import {
    getProgress, addWrongQuestion, recordEarlyUnlock, recordReturnEvent,
    ensureUnitBanks, unitManifest, unitItemsOf, unitSequence,
} from './eduRewards.js';

// ---------- 抽题哈希（与 eduKeypad.hashCell 同构；盐常量自定，用途间互不干扰） ----------
const SALT_SL_SUBJECT = 0x7f4a7c15; // 星辉门选学科
const SALT_SL_ITEM = 0x2545f491;    // 超纲池内选题

function hashCell(seed, x, y, z, salt) {
    let h = (seed >>> 0) ^ salt;
    h = Math.imul(h ^ x, 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ y, 0xc2b2ae35) >>> 0;
    h = Math.imul(h ^ z, 0x27d4eb2f) >>> 0;
    h ^= h >>> 15;
    h >>>= 0; // int32 异或可能为负，归一回无符号再取模（负下标取到 undefined，M1 踩过的坑）
    return h;
}

// 学科元信息兜底（清单缺失/卡内学科不在清单时显示用）
const SUBJECT_FALLBACK = {
    math: { emoji: '🧮', name: '数学' },
    science: { emoji: '🔬', name: '科学' },
    daofa: { emoji: '🧭', name: '道法' },
    yuwen: { emoji: '📖', name: '语文' },
    english: { emoji: '🛒', name: '英语' },
};
function subjectMetaOf(subject) {
    const m = unitManifest().find((e) => e.subject === subject);
    if (m) return { emoji: m.emoji, name: m.name };
    return SUBJECT_FALLBACK[subject] || { emoji: '📚', name: subject || '综合' };
}

// ---------- 关卡模块（P0 levelRun/levelWorkshop，可选依赖惰性加载） ----------
// undefined=未尝试 / null=尝试过且不可用 / namespace。失败也缓存（右键不反复打 404）。
let levelRunMod;
let levelWorkshopMod;
async function ensureLevelModules() {
    if (levelRunMod === undefined) {
        try { levelRunMod = await import('./levelRun.js'); } catch (e) { levelRunMod = null; }
    }
    if (levelRunMod && levelWorkshopMod === undefined) {
        try { levelWorkshopMod = await import('./levelWorkshop.js'); } catch (e) { levelWorkshopMod = null; }
    }
    return levelRunMod;
}

// 关卡上下文探测（全部可选链：P0 未合入时返回「不在关卡内」的空上下文）
async function levelContext(x, y, z) {
    const lr = await ensureLevelModules();
    if (!lr || !lr.isLevelRunActive?.()) {
        return { active: false, cardQ: null, localKey: null, frozen: false, cardName: '' };
    }
    const cardQ = lr.getCardQuestion?.(x, y, z) || null;
    let localKey = null;
    if (cardQ && levelWorkshopMod?.worldToLocal) {
        const l = levelWorkshopMod.worldToLocal(x, y, z);
        if (l && Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.z)) {
            localKey = `${l.x},${l.y},${l.z}`; // state.levelRun.answers 的 key 形制（契约 §2）
        }
    }
    return {
        active: true,
        cardQ,
        localKey,
        frozen: lr.isLockAIHelpFrozen?.() === true, // 考核锁：lockAIHelp===false
        cardName: lr.getLevelRun?.()?.card?.name || '',
    };
}

// ---------- 超纲抽题（自由世界；关卡内走 getCardQuestion 不经过这里） ----------
// 超纲池：unitSequence(subject) 中序数 > progress.unit 的单元题目；空 unit / 进度内 / 未知单元不收
function beyondPool(subject, progressUnit) {
    const ordOf = new Map(unitSequence(subject).map((u, i) => [u.unit, i + 1]));
    return unitItemsOf(subject).filter((it) => {
        const ord = ordOf.get(typeof it.unit === 'string' ? it.unit.trim() : '');
        return ord !== undefined && ord > progressUnit;
    });
}

// 按格哈希确定性抽题（同格同题）。返回题目对象；题池空/题库缺失 → { degraded: 文案 }。
function pickStarlightQuestion(x, y, z) {
    const manifest = unitManifest();
    if (!manifest.length) {
        return { degraded: '📭 题库暂时没有加载出来，稍后再来敲门吧' };
    }
    // 题库文件全挂（有清单但各学科题池全空）→ 走「暂不可用」而非「已学完」，文案要诚实
    if (!manifest.some((m) => unitItemsOf(m.subject).length > 0)) {
        return { degraded: '📭 题库暂时没有加载出来，稍后再来敲门吧' };
    }
    const progress = getProgress().unit;
    const usable = manifest
        .map((m) => ({ ...m, pool: beyondPool(m.subject, progress) }))
        .filter((m) => m.pool.length > 0);
    if (!usable.length) {
        return { degraded: '📖 你的学习进度已经覆盖全部单元，这扇门暂时没有新知识等你——继续加油！' };
    }
    // 1) 按 weight 加权选学科（与 eduKeypad.selectQuestion 同法：清单顺序累积权重）
    const weightOf = (m) => Math.max(1, Math.floor(Number(m.weight)) || 1);
    const totalW = usable.reduce((s, m) => s + weightOf(m), 0);
    let r = hashCell(state.worldSeed, x, y, z, SALT_SL_SUBJECT) % totalW;
    let entry = usable[usable.length - 1];
    for (const m of usable) {
        r -= weightOf(m);
        if (r < 0) { entry = m; break; }
    }
    // 2) 超纲池内选题（input/choice 已摊平在一个池里，kind 编在题上）
    const item = entry.pool[hashCell(state.worldSeed, x, y, z, SALT_SL_ITEM) % entry.pool.length];
    return {
        subject: entry.subject, emoji: entry.emoji, name: entry.name,
        kind: item.kind === 'choice' ? 'choice' : 'input',
        q: item.q, a: item.a,
        unit: typeof item.unit === 'string' ? item.unit : '',
        hint: typeof item.hint === 'string' ? item.hint : '',
        options: Array.isArray(item.options) ? item.options : undefined,
    };
}

// 关卡卡题目（契约 §2 schema）→ 会话题面：stem→q、answer→a，字段名对齐题库题
function cardQuestionToSession(cq) {
    const kind = cq.kind === 'choice' ? 'choice' : 'input';
    const opts = Array.isArray(cq.options) ? cq.options.filter((o) => typeof o === 'string') : [];
    const a = Number(cq.answer);
    if (!Number.isInteger(a) || a < 0) return null; // 坏卡 → 上层走降级文案
    if (kind === 'choice' && (opts.length < 3 || opts.length > 4 || a >= opts.length)) return null;
    const meta = subjectMetaOf(cq.subject);
    return {
        subject: cq.subject || 'math', emoji: meta.emoji, name: meta.name, kind,
        q: typeof cq.stem === 'string' ? cq.stem : '', a,
        unit: typeof cq.unit === 'string' ? cq.unit : '',
        hint: typeof cq.hint === 'string' ? cq.hint : '',
        options: kind === 'choice' ? opts : undefined,
    };
}

// ---------- 答题 UI（id 前缀 edu-starlight，不抢指针锁；紫夜配色区别于答题机的绿） ----------
let panel = null;   // #edu-starlight 卡片
let session = null;
// session = { x,y,z, subject, emoji, name, kind, question:{q,a,unit,hint,options?},
//             typed, wrongShake, inLevel, frozen, localKey, cardName, degraded, message }

const CSS = `
#edu-starlight {
    position: fixed; left: 50%; top: 38%; transform: translate(-50%, -50%);
    z-index: 60; pointer-events: none; text-align: center;
    font-family: 'Courier New', monospace;
    animation: edu-pop .18s ease-out;
}
#edu-starlight .es-card {
    background: rgba(24, 20, 38, .93); border: 3px solid #8a7dff; border-radius: 14px;
    padding: 18px 30px; box-shadow: 0 0 24px rgba(138, 125, 255, .5), inset 0 0 12px rgba(0,0,0,.5);
}
#edu-starlight.wrong .es-card { border-color: #e05252; box-shadow: 0 0 24px rgba(224, 82, 82, .5); animation: edu-shake .3s; }
#edu-starlight .es-title { color: #c9c0ff; font-size: 13px; letter-spacing: 2px; margin-bottom: 4px; }
#edu-starlight .es-unit { color: #8a7dff; font-size: 12px; margin-bottom: 6px; }
#edu-starlight .es-q { color: #fff; font-size: 32px; font-weight: bold; text-shadow: 0 2px 0 #000; }
#edu-starlight .es-q.choice { font-size: 25px; }
#edu-starlight .es-opts { display: none; margin-top: 10px; flex-direction: column; gap: 5px; }
#edu-starlight .es-opt { color: #d5cdff; font-size: 19px; font-weight: bold; text-shadow: 0 1px 0 #000; }
#edu-starlight .es-opt b { color: #ffd84a; margin-right: 6px; }
#edu-starlight .es-a { color: #ffd84a; font-size: 32px; font-weight: bold; min-height: 42px; margin-top: 6px;
    text-shadow: 0 2px 0 #000; }
#edu-starlight .es-a .cursor { display: inline-block; width: 18px; height: 32px; background: #ffd84a;
    vertical-align: middle; animation: edu-blink 1s steps(1) infinite; margin-left: 4px; }
#edu-starlight .es-wrong { color: #ffb1e0; font-size: 14px; margin-top: 8px; font-weight: bold; line-height: 1.55; }
#edu-starlight .es-hint { color: #9a8fd0; font-size: 12px; margin-top: 4px; }
#edu-starlight .es-tip { color: #8a84aa; font-size: 12px; margin-top: 10px; }
`;

function ensurePanel() {
    if (panel) return panel;
    if (!document.getElementById('edu-starlight-style')) {
        const style = document.createElement('style');
        style.id = 'edu-starlight-style';
        style.textContent = CSS;
        document.head.appendChild(style);
    }
    panel = document.createElement('div');
    panel.id = 'edu-starlight';
    panel.style.display = 'none';
    panel.innerHTML = `
        <div class="es-card">
            <div class="es-title"></div>
            <div class="es-unit"></div>
            <div class="es-q"></div>
            <div class="es-opts"></div>
            <div class="es-a"></div>
            <div class="es-wrong" style="display:none"></div>
            <div class="es-hint" style="display:none"></div>
            <div class="es-tip"></div>
        </div>`;
    document.body.appendChild(panel);
    return panel;
}

// 答错温和文案（考核锁换文案且不引导找助手——契约 §3.3）
function wrongCopy(s) {
    return s.frozen
        ? '🔒 考核关：这扇门要靠你自己'
        : '💭 这个还没学哦——想要提前解锁吗？找 🤖 要个提示，或练完这周回来。';
}

function renderPanel() {
    if (!session || !panel) return;
    const s = session;
    panel.className = s.wrongShake ? 'wrong' : '';
    if (s.wrongShake) {
        // 触发抖动动画重放
        panel.style.animation = 'none';
        void panel.offsetWidth;
        panel.style.animation = '';
    }
    const titleEl = panel.querySelector('.es-title');
    const unitEl = panel.querySelector('.es-unit');
    const qEl = panel.querySelector('.es-q');
    const optsEl = panel.querySelector('.es-opts');
    const aEl = panel.querySelector('.es-a');
    const wEl = panel.querySelector('.es-wrong');
    const hintEl = panel.querySelector('.es-hint');
    const tipEl = panel.querySelector('.es-tip');
    // 降级面板：只有标题 + 一句话 + 关闭提示（题池空/题库缺失，契约 §3.3 不报错）
    if (s.degraded) {
        titleEl.textContent = '✨ 星辉门';
        unitEl.style.display = 'none';
        qEl.className = 'es-q choice';
        qEl.textContent = s.message || '现在敲不开这扇门';
        optsEl.style.display = 'none';
        optsEl.innerHTML = '';
        aEl.style.display = 'none';
        wEl.style.display = 'none';
        hintEl.style.display = 'none';
        tipEl.textContent = 'Esc 关闭';
        return;
    }
    titleEl.textContent = `✨ 星辉门 · ${s.emoji} ${s.name}${s.inLevel ? ' · 关卡锁' : ''}`;
    // 知识点标签：自由世界=超纲知识点；关卡卡题=卡内 unit
    const unit = s.question.unit || '';
    unitEl.style.display = unit ? 'block' : 'none';
    unitEl.textContent = unit ? `${s.inLevel ? '知识点' : '超纲知识点'}：${unit}` : '';
    qEl.className = s.kind === 'choice' ? 'es-q choice' : 'es-q';
    qEl.textContent = s.kind === 'choice' ? s.question.q : `${s.question.q} = ?`;
    if (s.kind === 'choice') {
        optsEl.style.display = 'flex';
        optsEl.innerHTML = '';
        (s.question.options || []).forEach((o, i) => {
            const div = document.createElement('div');
            div.className = 'es-opt';
            const num = document.createElement('b');
            num.textContent = `${i + 1}.`;
            div.appendChild(num);
            div.appendChild(document.createTextNode(o));
            optsEl.appendChild(div);
        });
    } else {
        optsEl.style.display = 'none';
        optsEl.innerHTML = '';
    }
    aEl.style.display = s.kind === 'input' ? 'block' : 'none';
    if (s.kind === 'input') {
        aEl.innerHTML = s.typed === '' ? '<span class="cursor"></span>'
            : `${s.typed}<span class="cursor"></span>`;
    }
    wEl.style.display = s.wrongShake ? 'block' : 'none';
    wEl.textContent = s.wrongShake ? `❌ ${wrongCopy(s)}` : '';
    // 温和引导为主；非考核关且题面带 hint 时补一行知识点提示
    if (s.wrongShake && !s.frozen && s.question.hint) {
        hintEl.style.display = 'block';
        hintEl.textContent = `💡 ${s.question.hint}`;
    } else {
        hintEl.style.display = 'none';
    }
    tipEl.textContent = s.kind === 'choice'
        ? '按 1 ~ 4 选择答案 · Esc 取消'
        : '数字键输入 · ⌫ 退格 · ⏎ 提交 · Esc 取消';
}

function openStarlight(x, y, z, picked, lvl) {
    session = {
        x, y, z,
        subject: picked.subject, emoji: picked.emoji, name: picked.name,
        kind: picked.kind,
        question: { q: picked.q, a: picked.a, unit: picked.unit, hint: picked.hint, options: picked.options },
        typed: '', wrongShake: false,
        inLevel: !!lvl.active, frozen: !!lvl.frozen,
        localKey: lvl.localKey, cardName: lvl.cardName || '',
        degraded: false, message: '',
    };
    ensurePanel();
    panel.style.display = 'block';
    renderPanel();
}

function openDegraded(x, y, z, message, lvl) {
    session = {
        x, y, z, subject: '', emoji: '', name: '', kind: 'none',
        question: { q: '', a: NaN, unit: '', hint: '', options: undefined },
        typed: '', wrongShake: false,
        inLevel: !!lvl.active, frozen: !!lvl.frozen, localKey: null, cardName: '',
        degraded: true, message,
    };
    ensurePanel();
    panel.style.display = 'block';
    renderPanel();
}

export function closeStarlightPanel() {
    session = null;
    if (panel) panel.style.display = 'none';
}

// ---------- 提交 ----------
// 答对（契约 §3.3）：翻转为开启变体 + rebuildChunk + 重算红石网络（开启=常供能信号源）
// + 解锁音效 + 记「提前解锁」/回流事件（仅自由世界；关卡内记账归 levelRun）+ 庆祝文案
function solveStarlight(s) {
    closeStarlightPanel();
    setBlockSafe(s.x, s.y, s.z, starlightId(1));
    rebuildChunk(Math.floor(s.x / CHUNK_SIZE), Math.floor(s.z / CHUNK_SIZE));
    updateRedstoneNetwork();
    playEduUnlockSound();
    if (!s.inLevel) {
        const unit = s.question.unit || '';
        recordEarlyUnlock(unit);
        recordReturnEvent(unit);
    }
    import('./ui.js').then(({ showTooltip }) =>
        showTooltip(`🎉 提前解锁！这扇星辉门为你打开了${s.inLevel ? '（关卡锁已通过）' : ''}`));
}

// 答错：错误音效 + 抖动 + 温和文案 + 入错题本（来源：关卡名/星辉门，plan §4.4）+ 1.2s 后可重试
function failStarlight(s) {
    s.wrongShake = true;
    renderPanel();
    playEduWrongSound();
    addWrongQuestion({
        subject: s.subject,
        unit: s.question.unit || '',
        stem: s.question.q || '',
        answer: Number.isFinite(s.question.a) ? s.question.a : undefined,
        options: s.question.options,
        hint: s.question.hint || '',
        source: s.inLevel && s.cardName ? `关卡「${s.cardName}」` : '星辉门',
    });
    setTimeout(() => {
        if (session === s) { s.wrongShake = false; s.typed = ''; renderPanel(); }
    }, 1200);
}

// 判分入口：关卡内先记账（无论对错，contract §3.4 与答题机同款），再走对/错分支
function judge(correct) {
    const s = session;
    if (!s) return;
    if (s.localKey) levelRunMod?.recordLockAttempt?.(s.localKey, correct);
    if (correct) solveStarlight(s);
    else failStarlight(s);
}

// input 题：回车提交
function submitInput() {
    if (!session || session.kind !== 'input' || session.typed === '') return;
    judge(parseInt(session.typed, 10) === session.question.a);
}

// choice 题：按编号选择（0/越界下标忽略——防 Digit0 等误触被判错）
function chooseOption(idx) {
    if (!session || session.kind !== 'choice') return;
    const opts = session.question.options || [];
    if (!(idx >= 0 && idx < opts.length)) return;
    judge(idx === session.question.a);
}

// ---------- 入口（interaction.js 右键路由；返回 true = 已处理，拦截放置链） ----------
export async function interactStarlightAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isStarlightId(id)) return false;
    if (starlightOpen(id) === 1) {
        // 已开启态：提示其供能特性（与答题机已解锁提示同款）
        import('./ui.js').then(({ showTooltip }) =>
            showTooltip('✨ 这扇星辉门已开启：正在供能（可通行，接红石粉能远程开别的门）'));
        return true;
    }
    // 关卡联动：先探测（惰性动态 import，P0 未合入时全是可选链空操作）
    const lvl = await levelContext(x, y, z);
    let picked = null;
    if (lvl.cardQ) {
        // 关卡内：卡自带题优先（contract §3.2/§3.3），超纲抽题退位
        picked = cardQuestionToSession(lvl.cardQ);
        if (!picked) picked = { degraded: '📭 这把锁的题目卡坏了，找关卡作者修一修吧' };
    } else {
        // 自由世界：超纲抽题（题库懒加载静默降级，同 eduKeypad 的 ensureBanks 模式）
        await ensureUnitBanks();
        picked = pickStarlightQuestion(x, y, z);
    }
    if (picked && picked.degraded) {
        openDegraded(x, y, z, picked.degraded, lvl);
        return true;
    }
    openStarlight(x, y, z, picked, lvl);
    return true;
}

// ---------- 键盘捕获（window 捕获阶段，先于 input.js 的冒泡监听；同 eduKeypad） ----------
window.addEventListener('keydown', (e) => {
    if (!session) return;
    // 助手聊天框聚焦/非游戏中：收起不拦截（同 eduKeypad）
    if (state.assistantOpen || getUIState() !== 'playing') { closeStarlightPanel(); return; }
    if (session.degraded) {
        // 降级面板只拦 Esc 关闭，其余键放行给游戏（不无故吞 WASD）
        if (e.code === 'Escape') {
            closeStarlightPanel();
            e.stopImmediatePropagation();
        }
        return;
    }
    if (session.kind === 'choice') {
        // 选择题：Digit1..4 / Numpad1..4 选择；其余数字键吞掉不动作（防答题中切快捷栏）；Esc 关闭
        const m = /^(Digit|Numpad)(\d)$/.exec(e.code);
        if (m) {
            const d = parseInt(m[2], 10);
            if (d >= 1 && d <= 4) chooseOption(d - 1);
            e.stopImmediatePropagation();
            e.preventDefault();
        } else if (e.code === 'Escape') {
            closeStarlightPanel();
            e.stopImmediatePropagation();
        }
        return;
    }
    // input 题：数字/退格/回车/Esc（输入上限 4 位 = 答案 0..9999，契约 §2）
    if (e.code.startsWith('Digit') || (e.code.startsWith('Numpad') && /\d$/.test(e.code))) {
        const d = e.code.slice(-1);
        if (session.typed.length < 4) {
            session.typed += d;
            renderPanel();
        }
        e.stopImmediatePropagation();
        e.preventDefault();
    } else if (e.code === 'Backspace') {
        session.typed = session.typed.slice(0, -1);
        renderPanel();
        e.stopImmediatePropagation();
        e.preventDefault();
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        submitInput();
        e.stopImmediatePropagation();
        e.preventDefault();
    } else if (e.code === 'Escape') {
        closeStarlightPanel();
        e.stopImmediatePropagation();
    }
}, true);

// ---------- 玩家走远/方块变化自动收起（500ms 巡检，同 eduKeypad.js:631-640 已修写法） ----------
setInterval(() => {
    if (!session) return;
    const p = state.player;
    const dx = p.x - (session.x + 0.5), dy = p.y - (session.y + 0.5), dz = p.z - (session.z + 0.5);
    // 走远 → 收起并立即返回：closeStarlightPanel 会把 session 置 null，
    // 继续往下读 session.x 会抛 TypeError（先 close 再 return，与 eduKeypad 同款修复）
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5 || Math.abs(dz) > 5) { closeStarlightPanel(); return; }
    // 方块被挖掉/翻转也收起
    if (!isStarlightId(getBlock(session.x, session.y, session.z))) closeStarlightPanel();
}, 500);
