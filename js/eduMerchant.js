// ==================== eduMerchant.js（Edu M2，2026-09-08；多模式改版 2026-09-09）====================
// 教学玩法「英语商人」：右键商人方块 → 屏幕弹出交易卡作答 → 答对：交易达成音效 + 奖励掉落
// （梯队见 eduRewards.js）+ 词条入「已学会」图鉴；答错：错误音效 + 显示正确答案，同一题下次再来。
// 三种出题模式（契约 docs/edu-quiz-banks-contract.md §5）：
//   模式 A w2e ：看中文释义 → 选英文单词（3 选 1）；
//   模式 B e2z ：看英文单词 → 选中文释义（3 选 1）；
//   模式 C sent：看中文句子 → 选英文句子（3 选 1，句子情景对话）。
// 出题轮次按 3 题一循环 A→B→C：词:句 = 2:1，A:B 各半均衡；单词/句子均「未学会优先」
// 顺序推进（学习轮次），全部学会后随机复习。
// 学习进度（localStorage mcweb.edu.v1）：单词 key = en 小写（不变，兼容旧进度）；
// 句子 key = 's:' + en 小写，存入同一集合 p.words（契约 §5 规定的 s: 前缀方案）；
// 另挂 p.merchantModes = { w2e/e2z/sent: {solved, wrong} } 分模式计数（契约 §6 可选字段）。
// 题库 assets/edu/grade3-english.json（沪教版三上 Word list 150 词 + 情景句型 50 句）。
// 答题中不抢鼠标指针（数字键作答，窗口捕获阶段拦截 Digit1..3，先于 input.js 快捷栏切换）。

import { state } from './state.js';
import { getBlock } from './world.js';
import { getUIState } from './uiModal.js';
import { playEduCorrectSound, playEduWrongSound } from './audio.js';
import { isMerchantId } from './config.js';
import { loadEduProgress, saveEduProgress, grantEduReward } from './eduRewards.js';

// ---------- 题库（fetch 失败时的兜底，保证每种模式都有题可出） ----------
const FALLBACK_WORDS = [
    { en: 'happy', zh: '开心的' }, { en: 'sad', zh: '伤心的' }, { en: 'apple', zh: '苹果' },
    { en: 'banana', zh: '香蕉' }, { en: 'family', zh: '家庭' }, { en: 'mother', zh: '妈妈' },
    { en: 'father', zh: '爸爸' }, { en: 'sister', zh: '姐姐；妹妹' }, { en: 'milk', zh: '牛奶' },
    { en: 'juice', zh: '果汁' }, { en: 'fish', zh: '鱼；鱼肉' }, { en: 'cake', zh: '蛋糕' },
    { en: 'sun', zh: '太阳' }, { en: 'rain', zh: '雨；下雨' }, { en: 'gift', zh: '礼物' },
    { en: 'run', zh: '跑' }, { en: 'jump', zh: '跳' }, { en: 'help', zh: '帮助' },
];
const FALLBACK_SENTENCES = [
    { en: 'How are you?', zh: '你好吗？', unit: 1 },
    { en: 'Thank you.', zh: '谢谢你。', unit: 5 },
    { en: 'Happy birthday!', zh: '生日快乐！', unit: 8 },
];

let wordBank = FALLBACK_WORDS;
let sentenceBank = FALLBACK_SENTENCES;
let bankLoaded = false;

async function ensureBank() {
    if (bankLoaded) return;
    bankLoaded = true;
    try {
        const resp = await fetch('assets/edu/grade3-english.json');
        if (!resp.ok) return;
        const data = await resp.json();
        const ws = (data.words || []).filter((w) => w.en && w.zh && w.en.length <= 18);
        if (ws.length >= 30) wordBank = ws;
        const ss = (data.sentences || []).filter((s) => s.en && s.zh && s.en.length <= 60);
        if (ss.length >= 3) sentenceBank = ss;
    } catch (e) { /* 静默：保持兜底 */ }
}

// ---------- 选题主数据：三类模式的出题/判分配置 ----------
// prompt = 卡片上出示的题面文本；display = 选项展示的文本；key = 学习进度集合用的 key
const QUESTION = {
    w2e: { // 模式 A：看中文选英文
        pool: () => wordBank,
        prompt: (w) => w.zh,
        display: (w) => w.en,
        key: (w) => w.en.toLowerCase(),
    },
    e2z: { // 模式 B：看英文选中文
        pool: () => wordBank,
        prompt: (w) => w.en,
        display: (w) => w.zh,
        key: (w) => w.en.toLowerCase(),
    },
    sent: { // 模式 C：句子情景（看中文句子选英文句子）
        pool: () => sentenceBank,
        prompt: (w) => w.zh,
        display: (w) => w.en,
        key: (w) => 's:' + w.en.toLowerCase(),
    },
};

// ---------- 模式相关文案（卡片标题 / 按键提示 / 答错讲解，全部中文口语化） ----------
const MODES = {
    w2e: {
        title: '🛒 英语商人 · 选出正确英文',
        tip: '按 1 / 2 / 3 选择英文单词 · Esc 离开',
        newLabel: '🆕 学会新单词',
        reviewLabel: '🔁 复习成功',
        wrong: (w) => `❌ 正确答案是 ${w.en}（${w.zh}），别灰心，下次再来！`,
    },
    e2z: {
        title: '🛒 英语商人 · 选出中文意思',
        tip: '按 1 / 2 / 3 选择中文意思 · Esc 离开',
        newLabel: '🆕 学会新单词',
        reviewLabel: '🔁 复习成功',
        wrong: (w) => `❌ 正确答案是「${w.zh}」，${w.en} 就是这个意思，下次再来！`,
    },
    sent: {
        title: '🛒 英语商人 · 情景对话选一句',
        tip: '按 1 / 2 / 3 选择英文句子 · Esc 离开',
        newLabel: '🆕 学会新句子',
        reviewLabel: '🔁 复习成功',
        wrong: (w) => `❌ 正确答案是 ${w.en}（${w.zh}），多读两遍就记住啦！`,
    },
};

// 三个选项：正确项 + 2 个干扰项，保证展示文本互不相同（中文干扰项 zh 互异 / 英文干扰项 en 互异）
// displayFn 决定选项文本，keyFn 决定与正确项判重的 key；返回 { texts, answer }（answer = 正确项下标）
function makeOptions(item, pool, displayFn, keyFn) {
    const correctText = displayFn(item);
    const candidates = pool.filter((w) => keyFn(w) !== keyFn(item) && displayFn(w) !== correctText);
    const picks = [];
    while (picks.length < 2 && candidates.length) {
        const i = Math.floor(Math.random() * candidates.length);
        const picked = candidates.splice(i, 1)[0];
        const pickedText = displayFn(picked);
        picks.push(picked);
        // 与该干扰项展示文本相同的其它条目一并移出候选（如 mother/mum 同为「妈妈」）
        for (let k = candidates.length - 1; k >= 0; k--) {
            if (displayFn(candidates[k]) === pickedText) candidates.splice(k, 1);
        }
    }
    const texts = [correctText, ...picks.map(displayFn)];
    let answer = 0;
    // 洗牌（跟踪正确项下标随之移动）
    for (let i = texts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [texts[i], texts[j]] = [texts[j], texts[i]];
        if (j === answer) answer = i; else if (i === answer) answer = j;
    }
    return { texts, answer };
}

// ---------- 进度 ----------
// mode === 'sent' 时词条 key 加 s: 前缀入同一集合 p.words（契约 §5），其余字段照旧累加
function recordProgress(mode, item, streakNow) {
    const p = loadEduProgress();
    const key = mode === 'sent' ? 's:' + item.en.toLowerCase() : item.en.toLowerCase();
    const set = new Set(p.words || []);
    const isNew = !set.has(key);
    set.add(key);
    p.words = [...set];
    p.trades = (p.trades || 0) + 1;
    p.wordStreak = streakNow;
    // 契约 §6 merchantModes：分模式对错计数（家长报告可选展示）
    const modes = p.merchantModes || (p.merchantModes = {});
    const m = modes[mode] || (modes[mode] = { solved: 0, wrong: 0 });
    m.solved += 1;
    saveEduProgress(p);
    return isNew;
}

// ---------- UI ----------
let panel = null;
let session = null; // { x,y,z, mode, item, texts, answer, wrongShake }

const CSS = `
#edu-trade {
    position: fixed; left: 50%; top: 40%; transform: translate(-50%, -50%);
    z-index: 60; pointer-events: none; text-align: center;
    font-family: 'Courier New', monospace;
    animation: edu-pop .18s ease-out;
}
#edu-trade .t-card {
    background: rgba(26, 20, 14, .93); border: 3px solid #e0b84a; border-radius: 14px;
    padding: 16px 28px; box-shadow: 0 0 24px rgba(224, 184, 74, .45), inset 0 0 12px rgba(0,0,0,.5);
}
#edu-trade.wrong .t-card { border-color: #e05252; box-shadow: 0 0 24px rgba(224, 82, 82, .5); }
#edu-trade .t-title { color: #e8d9a0; font-size: 13px; letter-spacing: 2px; margin-bottom: 8px; }
#edu-trade .t-zh { color: #fff; font-size: 34px; font-weight: bold; text-shadow: 0 2px 0 #000; }
#edu-trade .t-opts { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
#edu-trade .t-opt { color: #ffe9a0; font-size: 20px; font-weight: bold; text-shadow: 0 1px 0 #000; }
#edu-trade .t-wrong { color: #ff9a9a; font-size: 15px; margin-top: 8px; font-weight: bold; }
#edu-trade .t-tip { color: #8a7a5a; font-size: 12px; margin-top: 10px; }
/* 句子情景模式：题面与选项都是整句，字号收小防溢出 */
#edu-trade.sent .t-zh { font-size: 24px; }
#edu-trade.sent .t-opt { font-size: 16px; }
@keyframes edu-pop2 { from { transform: translate(-50%,-50%) scale(.7); opacity: 0; } }
`;

function ensurePanel() {
    if (panel) return panel;
    if (!document.getElementById('edu-trade-style')) {
        const style = document.createElement('style');
        style.id = 'edu-trade-style';
        style.textContent = CSS;
        document.head.appendChild(style);
    }
    panel = document.createElement('div');
    panel.id = 'edu-trade';
    panel.style.display = 'none';
    panel.innerHTML = `
        <div class="t-card">
            <div class="t-title"></div>
            <div class="t-zh"></div>
            <div class="t-opts"></div>
            <div class="t-wrong" style="display:none"></div>
            <div class="t-tip"></div>
        </div>`;
    document.body.appendChild(panel);
    return panel;
}

function renderPanel() {
    if (!session || !panel) return;
    const q = QUESTION[session.mode];
    const cfg = MODES[session.mode];
    panel.className = (session.wrongShake ? 'wrong' : '') + (session.mode === 'sent' ? ' sent' : '');
    panel.querySelector('.t-title').textContent = cfg.title;
    panel.querySelector('.t-zh').textContent = q.prompt(session.item);
    panel.querySelector('.t-tip').textContent = cfg.tip;
    const box = panel.querySelector('.t-opts');
    box.innerHTML = '';
    session.texts.forEach((t, i) => {
        const div = document.createElement('div');
        div.className = 't-opt';
        div.textContent = `${i + 1}. ${t}`;
        box.appendChild(div);
    });
    const w = panel.querySelector('.t-wrong');
    w.style.display = session.wrongShake ? 'block' : 'none';
    w.textContent = session.wrongShake ? cfg.wrong(session.item) : '';
}

function openTrade(x, y, z, mode, item) {
    const q = QUESTION[mode];
    const { texts, answer } = makeOptions(item, q.pool(), q.display, q.key);
    session = { x, y, z, mode, item, texts, answer, wrongShake: false };
    ensurePanel();
    panel.style.display = 'block';
    renderPanel();
}

export function closeTrade() {
    session = null;
    if (panel) panel.style.display = 'none';
}

// ---------- 作答 ----------
function choose(idx) {
    if (!session || idx >= session.texts.length) return;
    const { x, y, z, mode, item } = session;
    if (idx === session.answer) {
        const p = loadEduProgress();
        const streak = (p.wordStreak || 0) + 1;
        const isNew = recordProgress(mode, item, streak);
        const cfg = MODES[mode];
        closeTrade();
        playEduCorrectSound();
        const rewardText = grantEduReward(x, y, z, { streak, totalKey: 'trades' });
        import('./ui.js').then(({ showTooltip }) => {
            showTooltip(`${isNew ? cfg.newLabel : cfg.reviewLabel}：${item.en} = ${item.zh}｜${rewardText}`);
        });
    } else {
        session.wrongShake = true;
        renderPanel();
        playEduWrongSound();
        const p = loadEduProgress();
        p.wordStreak = 0;
        p.wordWrong = (p.wordWrong || 0) + 1;
        // 分模式错误计数（契约 §6 merchantModes）
        const modes = p.merchantModes || (p.merchantModes = {});
        const m = modes[mode] || (modes[mode] = { solved: 0, wrong: 0 });
        m.wrong += 1;
        saveEduProgress(p);
        setTimeout(() => {
            if (session) { session.wrongShake = false; renderPanel(); }
        }, 1400);
    }
}

// ---------- 入口（interaction.js 右键路由） ----------
let askSeq = 0; // 出题序号：3 题一循环 A→B→C（词:句 = 2:1，模式 A:B 各半均衡）

export async function interactMerchantAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isMerchantId(id)) return false;
    await ensureBank();
    const learned = new Set(loadEduProgress().words || []);
    askSeq++;
    let mode;
    if (askSeq % 3 === 0) {
        mode = 'sent'; // 每三题一句子情景题（句子模式也有兜底题库，fetch 失败照常可玩）
    } else {
        mode = askSeq % 3 === 1 ? 'w2e' : 'e2z'; // 两个单词模式交替
    }
    const bank = QUESTION[mode].pool();
    // 未学会优先：单词按 en 小写、句子按 s:+en 小写在同一图鉴集合里判重
    const keyOf = QUESTION[mode].key;
    let item = bank.find((w) => !learned.has(keyOf(w)));
    if (!item) item = bank[Math.floor(Math.random() * bank.length)]; // 全学会了 → 随机复习
    openTrade(x, y, z, mode, item);
    return true;
}

// ---------- 键盘捕获（1/2/3/Esc；先于 input.js 的快捷栏切换） ----------
window.addEventListener('keydown', (e) => {
    if (!session) return;
    if (state.assistantOpen || getUIState() !== 'playing') { closeTrade(); return; }
    const m = /^(Digit|Numpad)([123])$/.exec(e.code);
    if (m) {
        choose(parseInt(m[2], 10) - 1);
        e.stopImmediatePropagation();
        e.preventDefault();
    } else if (e.code === 'Escape') {
        closeTrade();
        e.stopImmediatePropagation();
    }
}, true);

// 走远/方块被拆自动收起（500ms 巡检，同 eduKeypad）
setInterval(() => {
    if (!session) return;
    const p = state.player;
    // 走远 → 收起并立即返回：closeTrade 会把 session 置 null，继续往下读 session.x 会抛
    // TypeError（与 eduKeypad 同构的空指针，一并修复）
    if (Math.abs(p.x - (session.x + 0.5)) > 5 || Math.abs(p.y - (session.y + 0.5)) > 5 ||
        Math.abs(p.z - (session.z + 0.5)) > 5) { closeTrade(); return; }
    if (!isMerchantId(getBlock(session.x, session.y, session.z))) closeTrade();
}, 500);
