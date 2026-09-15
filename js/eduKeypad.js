// ==================== eduKeypad.js（Edu 多学科答题引擎，2026-09-09 重写）====================
// 教学玩法「答题机」：右键答题机（锁定态）→ 弹出学科卡片 → 作答 → 答对翻转为已解锁变体
// （成为常供能红石信号源：贴门放=直接开门、接红石粉=远程解锁）；答错：错误音效 + 卡片抖动
// + 展示该题 hint（无 hint 用学科通用提示），可重试（同格同题直到答对——「这道题就是这扇门的钥匙」）。
//
// 多学科题库（契约 docs/edu-quiz-banks-contract.md 是唯一接口）：
//   - 启动后第一次右键时加载清单 assets/edu/banks.json（缺失/损坏 → 代码内同内容默认清单），
//     再并行 fetch 各学科题库文件；单文件失败/格式不合 → 该学科跳过继续用内置兜底题
//     （fetch 静默降级，绝不阻塞玩法）；全部失败也有内置兜底题池，引擎独立可玩。
//   - 两种题型：input（数字键作答，答案 0..9999，输入上限 4 位）与 choice（三~四选一，
//     按 1~4 选择）；一个学科文件里两种 kind 可混排，抽题时在学科内再哈希选 kind。
//   - 题库归一化 normalizeBank(data)（导出供测试）：新 schema 为主；兼容旧数学格式
//     （顶层 extracted/generated → 折叠为一个 input bank，迁移期兜底，契约 §2.1）。
//   - 确定性抽题 selectQuestion(loadedBanks, seed, x, y, z)（导出纯函数，供 E2E 注入测试）：
//     世界种子+格子坐标哈希 → 先按 weight 加权选学科（清单固定顺序累积权重）→ 学科内
//     （必要时）哈希选 kind → 池内哈希选题。每次哈希用不同盐常量。题目不进存档：
//     读档同格同题；破坏重放（换格子）换题。
//   - 学习进度（localStorage mcweb.edu.v1，跨存档槽）：保留 solved/wrong/streak 旧 key，
//     新增 p.subjects[subject] = { solved, wrong } 分学科计数（契约 §6，答错也记入）。
//   - ⚠️ 哈希末步 ^>>>15 产出有符号 int32，取模前必须 >>>0 归一无符号
//     （负下标 → undefined，edu-m1-keypad-plan §2 与 eduRewards hanziFor 都踩过/防过）。
//   - 纯函数约定：PURE-BEGIN..PURE-END 区间内无 window/document/state 等 DOM/全局依赖，
//     可在 Node 等无 DOM 环境直接提取 eval 测试。
// 答题态不抢鼠标指针（保持锁定，WASD 移动照常）；窗口捕获阶段拦截按键
// （stopImmediatePropagation + preventDefault，先于 input.js 的快捷栏切换）。
// 导出签名兼容 interaction.js 原样调用：interactKeypadAt(x, y, z) / closeQuiz() / eduStatus()。

import { keypadId, keypadSolved, isKeypadId, CHUNK_SIZE } from './config.js';
import { state } from './state.js';
import { getBlock, setBlockSafe } from './world.js';
import { rebuildChunk } from './chunk.js';
import { updateRedstoneNetwork } from './redstone.js';
import { getUIState } from './uiModal.js';
import { playEduCorrectSound, playEduWrongSound, playEduUnlockSound } from './audio.js';
import { loadEduProgress, saveEduProgress, grantEduReward } from './eduRewards.js';

// >>> PURE-BEGIN
// （无 DOM 依赖区：Node eval 可直接提取测试；改动请保持区间内零 window/document/state）

// ---------- 清单与学科元信息 ----------
// 清单默认值：与 assets/edu/banks.json 同内容（清单文件缺失/损坏时兜底，契约 §1）
const DEFAULT_MANIFEST = [
    { subject: 'math', emoji: '🧮', name: '数学', file: 'grade3-math.json', weight: 2 },
    { subject: 'science', emoji: '🔬', name: '科学', file: 'grade3-science.json', weight: 1 },
    { subject: 'daofa', emoji: '🧭', name: '道法', file: 'grade3-daofa.json', weight: 1 },
    { subject: 'yuwen', emoji: '📖', name: '语文', file: 'grade3-yuwen.json', weight: 1 },
];
// 已知学科的徽标/名称（自定义清单条目缺 emoji/name 时兜底显示）
const SUBJECT_META = {
    math: { emoji: '🧮', name: '数学' },
    science: { emoji: '🔬', name: '科学' },
    daofa: { emoji: '🧭', name: '道法' },
    yuwen: { emoji: '📖', name: '语文' },
};
// 学科通用答错提示（题面无 hint 时的兜底；数学保留 M1 的口诀）
const SUBJECT_HINTS = {
    math: '先算乘除，再算加减，有括号先算括号里！',
    science: '回想一下课堂实验和自然常识，再选一次！',
    daofa: '想一想安全与品德课上老师怎么讲的，再选一次！',
    yuwen: '回忆一下课文和日积月累，再选一次！',
};
const GENERIC_HINT = '再读一遍题，想一想再试一次！';

// ---------- 内置兜底题（题库文件全部缺失/未加载完成时引擎独立可玩） ----------
// 数学：复用 M1 的 FALLBACK_QUESTIONS（三年级上册「混合运算」20 题，input）。
// 科学/道法/语文：各 ≥5 道常识级 choice 题（答案对照课本常识与权威口径书写，
// 报警电话用途不可混——契约 §7 质量红线）。形状与 §2 schema 完全一致。
const FALLBACK_BANKS = {
    math: {
        banks: [{
            kind: 'input',
            items: [
                { q: '3×4+5', a: 17 }, { q: '20−3×5', a: 5 }, { q: '18÷2+7', a: 16 },
                { q: '(2+3)×6', a: 30 }, { q: '7×8', a: 56 }, { q: '45−5×7', a: 10 },
                { q: '6×6+14', a: 50 }, { q: '24÷3+9', a: 17 }, { q: '(4+5)×7', a: 63 },
                { q: '9×9', a: 81 }, { q: '32−4×6', a: 8 }, { q: '36÷4+20', a: 29 },
                { q: '5×8+12', a: 52 }, { q: '7×7−9', a: 40 }, { q: '54÷9+6', a: 12 },
                { q: '(7+8)×4', a: 60 }, { q: '8×6+25', a: 73 }, { q: '40−6×5', a: 10 },
                { q: '63÷7+15', a: 24 }, { q: '4×9+30', a: 66 },
            ].map((it) => ({ ...it, unit: '三上·混合运算' })), // hint 留空 → 走学科通用提示
        }],
    },
    science: {
        banks: [{
            kind: 'choice',
            items: [
                { q: '水沸腾时的温度大约是？', options: ['60℃', '80℃', '100℃', '120℃'], a: 2,
                  unit: '三上·水', hint: '标准大气压下水约 100℃ 沸腾' },
                { q: '声音不能在（　）中传播。', options: ['空气', '水', '钢铁', '真空'], a: 3,
                  unit: '三上·声音', hint: '声音的传播需要介质，真空中不能传声' },
                { q: '植物的生长一般不需要（　）。', options: ['阳光', '空气', '水分', '黑暗'], a: 3,
                  unit: '三上·植物', hint: '植物生长需要阳光、空气和水分' },
                { q: '磁铁能吸引下列哪种物品？', options: ['木片', '铁钉', '塑料尺', '橡皮'], a: 1,
                  unit: '三上·磁铁', hint: '磁铁能吸引铁一类的磁性材料' },
                { q: '水结冰后，体积会（　）。', options: ['变小', '不变', '变大', '消失'], a: 2,
                  unit: '三上·水', hint: '水结冰体积会膨胀，所以冰能浮在水面上' },
                { q: '测量气温要用（　）。', options: ['气温计', '卷尺', '秒表', '天平'], a: 0,
                  unit: '三上·天气', hint: '气温计是专门测量空气温度的工具' },
            ],
        }],
    },
    daofa: {
        banks: [{
            kind: 'choice',
            items: [
                { q: '发现火灾时，应拨打的火警电话是（　）。', options: ['110', '119', '120', '122'], a: 1,
                  unit: '三上·安全护我成长', hint: '火警 119；110 报警、120 急救，用途不能混' },
                { q: '遇到需要紧急救助的病人，应拨打的急救电话是（　）。', options: ['119', '110', '120', '114'], a: 2,
                  unit: '三上·安全护我成长', hint: '120 是医疗急救电话' },
                { q: '过马路时，正确的做法是（　）。', options: ['走斑马线、看信号灯', '翻越护栏', '低头看手机快跑过去', '红灯时抢行'], a: 0,
                  unit: '三上·安全护我成长', hint: '红灯停、绿灯行，走斑马线最安全' },
                { q: '捡到别人的东西，正确的做法是（　）。', options: ['据为己有', '交给老师或警察', '扔掉', '偷偷卖掉'], a: 1,
                  unit: '三上·道德修养', hint: '拾金不昧是传统美德' },
                { q: '同学不小心碰掉了你的文具盒，最好的做法是（　）。', options: ['马上推他一下', '原谅他，提醒他下次小心', '骂他一顿', '告状让他受罚'], a: 1,
                  unit: '三上·道德修养', hint: '同学间要互相宽容、友好相处' },
                { q: '垃圾分类中，废旧电池应投进（　）。', options: ['厨余垃圾', '可回收物', '有害垃圾', '其他垃圾'], a: 2,
                  unit: '三上·爱护环境', hint: '废电池含重金属，属于有害垃圾' },
            ],
        }],
    },
    yuwen: {
        banks: [{
            kind: 'choice',
            items: [
                { q: '《望天门山》的作者是（　）。', options: ['李白', '杜甫', '白居易', '苏轼'], a: 0,
                  unit: '三上·古诗', hint: '「天门中断楚江开」出自李白的《望天门山》' },
                { q: '「停车坐爱枫林晚，霜叶红于二月花」出自古诗（　）。', options: ['《山行》', '《所见》', '《采莲曲》', '《望洞庭》'], a: 0,
                  unit: '三上·古诗', hint: '这句是杜牧《山行》中的名句' },
                { q: '「湖光秋月两相和」描写的湖是（　）。', options: ['西湖', '洞庭湖', '太湖', '滇池'], a: 1,
                  unit: '三上·古诗', hint: '刘禹锡《望洞庭》写的是秋夜洞庭湖美景' },
                { q: '「一年好景君须记」的下一句是（　）。', options: ['最是橙黄橘绿时', '正是河豚欲上时', '霜叶红于二月花', '淡妆浓抹总相宜'], a: 0,
                  unit: '三上·古诗', hint: '出自苏轼《赠刘景文》：一年好景君须记，最是橙黄橘绿时' },
                { q: '「意欲捕鸣蝉」的上一句是（　）。', options: ['牧童骑黄牛', '歌声振林樾', '忽然闭口立', '儿童散学归来早'], a: 1,
                  unit: '三上·古诗', hint: '袁枚《所见》：牧童骑黄牛，歌声振林樾' },
                { q: '成语「守株待兔」告诉我们（　）。', options: ['要主动努力，不能心存侥幸', '兔子很可爱', '种树很重要', '要早点起床'], a: 0,
                  unit: '三上·积累', hint: '守株待兔讽刺不劳而获、心存侥幸的人' },
            ],
        }],
    },
};

// ---------- 确定性抽题的盐常量（每次哈希用途不同 → 盐不同，互不干扰） ----------
const SALT_SUBJECT = 0x51a7d3ed; // 选学科
const SALT_KIND = 0x27d4eb2f;    // 学科内选题型（input/choice 混排时）
const SALT_ITEM = 0x9e3779b9;    // 池内选题

// 格子坐标+世界种子+盐 → 稳定哈希（无符号 32 位）。纯函数。
function hashCell(seed, x, y, z, salt) {
    let h = (seed >>> 0) ^ salt;
    h = Math.imul(h ^ x, 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ y, 0xc2b2ae35) >>> 0;
    h = Math.imul(h ^ z, 0x27d4eb2f) >>> 0;
    h ^= h >>> 15;
    h >>>= 0; // int32 异或可能为负，归一回无符号再取模（否则负下标取到 undefined，M1 踩过的坑）
    return h;
}

// 清单清洗（纯函数）：从 banks.json 解析结果容错提取条目；非法条目丢弃、学科去重、
// weight 回退 1。整体不可用时返回 null（调用方回退 DEFAULT_MANIFEST）。
export function sanitizeManifest(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.banks) || !data.banks.length) return null;
    const seen = new Set();
    const list = [];
    for (const e of data.banks) {
        if (!e || typeof e !== 'object') continue;
        const subject = typeof e.subject === 'string' ? e.subject.trim() : '';
        const file = typeof e.file === 'string' ? e.file.trim() : '';
        if (!subject || !file || seen.has(subject)) continue;
        seen.add(subject);
        const meta = SUBJECT_META[subject] || { emoji: '📚', name: subject };
        list.push({
            subject,
            file,
            emoji: typeof e.emoji === 'string' && e.emoji ? e.emoji : meta.emoji,
            name: typeof e.name === 'string' && e.name ? e.name : meta.name,
            weight: Math.max(1, Math.floor(Number(e.weight))) || 1,
        });
    }
    return list.length ? list : null;
}

// 答案 a 强转（纯函数）：数字/非空数字字符串 → 整数；null/false/'' 等一律 NaN（随后被
// 过滤——防 Number(null)=0、Number(true)=1 把坏题洗成「合法」答案 0/1）
function coerceAnswer(v) {
    if (typeof v === 'number') return Math.trunc(v);
    if (typeof v === 'string' && v.trim() !== '') return Math.trunc(Number(v));
    return NaN;
}

// 题库文件归一化（纯函数，导出供测试）：任意 shape → { subject, source, banks: [{kind, items}] }。
//   - 新 schema（契约 §2）：data.banks[{kind, items}]，item 为 {q, a, unit, hint[, options]}；
//     input 的 a 强转整数后须 0..9999，choice 的 options 3~4 个互异字符串且 a 下标在界内，
//     不合规格的题直接丢弃（校验交给 tools/validate_banks.py，引擎侧只保证不崩）。
//   - 旧数学格式（契约 §2.1 迁移期兼容）：顶层 extracted/generated → 折叠为一个 input bank，
//     a 强转整数且 0..9999 过滤（沿用旧过滤逻辑、上限放宽到 4 位），unit 取文件级 unit。
// 完全不合规格返回 null。旧格式只可能是数学，subject 缺省推断为 'math'。
export function normalizeBank(data) {
    if (!data || typeof data !== 'object') return null;
    const legacy = !Array.isArray(data.banks) && (Array.isArray(data.extracted) || Array.isArray(data.generated));
    if (legacy) {
        const unit = typeof data.unit === 'string' && data.unit ? data.unit : '三上·数学';
        const items = [...(data.extracted || []), ...(data.generated || [])]
            .filter((it) => it && typeof it === 'object' && typeof it.q === 'string')
            .map((it) => ({ q: it.q, a: coerceAnswer(it.a), hint: it.hint }))
            .filter((it) => Number.isInteger(it.a) && it.a >= 0 && it.a <= 9999)
            .map((it) => ({ q: it.q, a: it.a, unit, hint: typeof it.hint === 'string' ? it.hint : '' }));
        return { subject: typeof data.subject === 'string' && data.subject ? data.subject : 'math',
                 source: typeof data.source === 'string' ? data.source : '', banks: [{ kind: 'input', items }] };
    }
    if (!Array.isArray(data.banks)) return null;
    const out = [];
    for (const bank of data.banks) {
        if (!bank || typeof bank !== 'object') continue;
        const kind = bank.kind;
        if (kind !== 'input' && kind !== 'choice') continue;
        if (!Array.isArray(bank.items)) continue;
        const items = [];
        for (const it of bank.items) {
            if (!it || typeof it !== 'object' || typeof it.q !== 'string' || !it.q) continue;
            const a = coerceAnswer(it.a);
            if (!Number.isInteger(a) || a < 0 || a > 9999) continue;
            const base = {
                q: it.q,
                a,
                unit: typeof it.unit === 'string' ? it.unit : '',
                hint: typeof it.hint === 'string' ? it.hint : '',
            };
            if (kind === 'choice') {
                const opts = Array.isArray(it.options) ? it.options.filter((o) => typeof o === 'string') : [];
                if (opts.length < 3 || opts.length > 4) continue;
                if (new Set(opts).size !== opts.length) continue;
                if (a >= opts.length) continue;
                base.options = opts;
            }
            items.push(base);
        }
        if (items.length) out.push({ kind, items });
    }
    if (!out.length) return null;
    return {
        subject: typeof data.subject === 'string' && data.subject ? data.subject : null,
        source: typeof data.source === 'string' ? data.source : '',
        banks: out,
    };
}

// 答错反馈文案（纯函数）：优先题面 hint，其次学科通用提示，最后万能兜底
function hintFor(question, subject) {
    const h = question && typeof question.hint === 'string' ? question.hint.trim() : '';
    return h || SUBJECT_HINTS[subject] || GENERIC_HINT;
}

// 确定性抽题（纯函数，导出供 E2E 注入测试）。
// banks：[{ subject, emoji, name, weight, pools: { input: [...], choice: [...] } }, ...]
//        （清单固定顺序；空池学科自动跳过）。seed：state.worldSeed。返回题目对象
//        { subject, emoji, name, kind, q, a, unit, hint, options? }；全部题池为空返回 null。
export function selectQuestion(banks, seed, x, y, z) {
    const usable = (banks || []).filter((b) => b && b.pools &&
        (b.pools.input.length + b.pools.choice.length) > 0);
    if (!usable.length) return null;
    // 1) 按 weight 加权选学科：清单固定顺序累积权重，同种子同坐标必同学科
    const weightOf = (b) => Math.max(1, Math.floor(Number(b.weight)) || 1);
    const totalW = usable.reduce((s, b) => s + weightOf(b), 0);
    let r = hashCell(seed, x, y, z, SALT_SUBJECT) % totalW;
    let bank = usable[usable.length - 1];
    for (const b of usable) {
        r -= weightOf(b);
        if (r < 0) { bank = b; break; }
    }
    // 2) 学科内选题型：只有一种直接用；input/choice 混排 → 再哈希
    const kinds = [];
    if (bank.pools.input.length) kinds.push('input');
    if (bank.pools.choice.length) kinds.push('choice');
    const kind = kinds.length === 1 ? kinds[0]
        : kinds[hashCell(seed, x, y, z, SALT_KIND) % kinds.length];
    // 3) 池内选题
    const pool = bank.pools[kind];
    const item = pool[hashCell(seed, x, y, z, SALT_ITEM) % pool.length];
    return { subject: bank.subject, emoji: bank.emoji, name: bank.name, kind, ...item };
}

// <<< PURE-END

// ---------- 运行时题库状态 ----------
// subject 稳定 key → { subject, emoji, name, weight, file, status, source, pools: {input, choice} }
// status：'builtin'=内置兜底题 | 'loaded'=题库文件已加载
const subjectState = new Map();

// 用清单初始化/重置各学科状态：有内置兜底题的学科立即注入兜底池（引擎独立可玩）
function applyManifest(manifest) {
    subjectState.clear();
    for (const entry of manifest) {
        const st = {
            subject: entry.subject, emoji: entry.emoji, name: entry.name,
            weight: entry.weight, file: entry.file,
            status: 'builtin', source: FALLBACK_BANKS[entry.subject] ? '内置兜底题' : '',
            pools: { input: [], choice: [] },
        };
        const fb = FALLBACK_BANKS[entry.subject];
        if (fb) for (const b of fb.banks) st.pools[b.kind].push(...b.items);
        subjectState.set(entry.subject, st);
    }
}
// 模块加载即按默认清单就位（未做任何 fetch 前引擎已可玩；清单文件加载后按需重放）
applyManifest(DEFAULT_MANIFEST);

// 加载单个学科题库文件：fetch 失败 / JSON 损坏 / 格式不合 / subject 与清单不符 →
// 静默跳过，该学科继续用内置兜底题（既有静默降级风格；schema 问题补一条 console.warn 便于内容方排查）
async function loadSubjectBank(entry) {
    const st = subjectState.get(entry.subject);
    if (!st) return;
    try {
        const resp = await fetch('assets/edu/' + entry.file);
        if (!resp.ok) return;
        const data = await resp.json();
        const norm = normalizeBank(data);
        if (!norm || norm.subject !== entry.subject) {
            console.warn(`[eduKeypad] ${entry.file} 格式不合或 subject 与清单不符，该学科暂用内置兜底题`);
            return;
        }
        const merged = { input: [], choice: [] };
        for (const b of norm.banks) merged[b.kind].push(...b.items);
        if (!merged.input.length && !merged.choice.length) {
            console.warn(`[eduKeypad] ${entry.file} 没有可用题目，该学科暂用内置兜底题`);
            return;
        }
        // 加载成功 → 替换该学科题池（内置兜底题只是文件缺席时的替身，不与正式题库混排）
        st.pools.input = merged.input;
        st.pools.choice = merged.choice;
        st.status = 'loaded';
        st.source = norm.source || entry.file;
    } catch (e) { /* 静默：保持兜底题库 */ }
}

// 题库懒加载：第一次右键答题机时拉取（清单 → 并行拉各学科文件）
let banksRequested = false;
let manifestSource = 'default'; // 'file'=assets/edu/banks.json | 'default'=代码内默认清单
async function ensureBanks() {
    if (banksRequested) return;
    banksRequested = true;
    let manifest = DEFAULT_MANIFEST;
    try {
        const resp = await fetch('assets/edu/banks.json');
        if (resp.ok) {
            const list = sanitizeManifest(await resp.json());
            if (list) { manifest = list; manifestSource = 'file'; }
        }
    } catch (e) { /* 清单缺失/损坏 → 代码内同内容默认清单 */ }
    applyManifest(manifest);
    await Promise.all(manifest.map(loadSubjectBank));
}

// ---------- 学习进度（eduRewards.js 共享存取；此处只管答题机自己的记账） ----------
const QUEST_M1_GOAL = 3; // M1 任务：解锁 3 台答题机

// 分学科记账（契约 §6）：p.subjects[subject] = { solved, wrong }；答错也计入对应学科
function bumpSubject(p, subject, field) {
    if (!p.subjects || typeof p.subjects !== 'object') p.subjects = {};
    const s = (typeof p.subjects[subject] === 'object' && p.subjects[subject]) || { solved: 0, wrong: 0 };
    s[field] = (s[field] || 0) + 1;
    p.subjects[subject] = s;
}

function onKeypadSolved(subject, x, y, z) {
    const p = loadEduProgress();
    p.solved = (p.solved || 0) + 1;
    p.streak = (p.streak || 0) + 1;
    bumpSubject(p, subject, 'solved');
    saveEduProgress(p);
    const rewardText = grantEduReward(x, y, z, { streak: p.streak, totalKey: 'solved' });
    import('./ui.js').then(({ showTooltip }) => {
        if (!p.quest1done && p.solved >= QUEST_M1_GOAL) {
            p.quest1done = true;
            saveEduProgress(p);
            playEduUnlockSound();
            showTooltip(`🏆 任务达成：解锁了 ${QUEST_M1_GOAL} 台答题机！全科学霸非你莫属`);
        } else {
            showTooltip(`✅ 答题机解锁！（累计 ${p.solved} 台${p.streak >= 3 ? ` · 连对 ${p.streak}` : ''}）｜${rewardText}`);
        }
    });
}

function onKeypadWrong(subject) {
    const p = loadEduProgress();
    p.streak = 0;
    p.wrong = (p.wrong || 0) + 1;
    bumpSubject(p, subject, 'wrong');
    saveEduProgress(p);
}

// ---------- 答题 UI ----------
let panel = null;   // #edu-quiz 卡片
let session = null; // { x,y,z, subject, emoji, name, kind, question, typed, wrongShake }

const CSS = `
#edu-quiz {
    position: fixed; left: 50%; top: 38%; transform: translate(-50%, -50%);
    z-index: 60; pointer-events: none; text-align: center;
    font-family: 'Courier New', monospace;
    animation: edu-pop .18s ease-out;
}
#edu-quiz .edu-card {
    background: rgba(20, 26, 34, .92); border: 3px solid #39d353; border-radius: 14px;
    padding: 18px 30px; box-shadow: 0 0 24px rgba(57, 211, 83, .45), inset 0 0 12px rgba(0,0,0,.5);
}
#edu-quiz.wrong .edu-card { border-color: #e05252; box-shadow: 0 0 24px rgba(224, 82, 82, .5); animation: edu-shake .3s; }
#edu-quiz .edu-title { color: #9ae6b4; font-size: 13px; letter-spacing: 2px; margin-bottom: 4px; }
#edu-quiz .edu-unit { color: #6a9a7a; font-size: 11px; margin-bottom: 6px; }
#edu-quiz .edu-q { color: #fff; font-size: 34px; font-weight: bold; text-shadow: 0 2px 0 #000; }
#edu-quiz .edu-q.choice { font-size: 26px; }
#edu-quiz .edu-opts { display: none; margin-top: 10px; flex-direction: column; gap: 5px; }
#edu-quiz .edu-opt { color: #b8f0c4; font-size: 20px; font-weight: bold; text-shadow: 0 1px 0 #000; }
#edu-quiz .edu-opt b { color: #ffd84a; margin-right: 6px; }
#edu-quiz .edu-a { color: #ffd84a; font-size: 34px; font-weight: bold; min-height: 44px; margin-top: 6px;
    text-shadow: 0 2px 0 #000; }
#edu-quiz .edu-a .cursor { display: inline-block; width: 18px; height: 34px; background: #ffd84a;
    vertical-align: middle; animation: edu-blink 1s steps(1) infinite; margin-left: 4px; }
#edu-quiz .edu-tip { color: #8aa; font-size: 12px; margin-top: 10px; }
#edu-quiz .edu-wrong { color: #ff9a9a; font-size: 15px; margin-top: 6px; font-weight: bold; }
@keyframes edu-pop { from { transform: translate(-50%,-50%) scale(.7); opacity: 0; } }
@keyframes edu-blink { 50% { opacity: 0; } }
@keyframes edu-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
`;

function ensurePanel() {
    if (panel) return panel;
    if (!document.getElementById('edu-quiz-style')) {
        const style = document.createElement('style');
        style.id = 'edu-quiz-style';
        style.textContent = CSS;
        document.head.appendChild(style);
    }
    panel = document.createElement('div');
    panel.id = 'edu-quiz';
    panel.style.display = 'none';
    panel.innerHTML = `
        <div class="edu-card">
            <div class="edu-title"></div>
            <div class="edu-unit"></div>
            <div class="edu-q"></div>
            <div class="edu-opts"></div>
            <div class="edu-a"></div>
            <div class="edu-wrong" style="display:none"></div>
            <div class="edu-tip"></div>
        </div>`;
    document.body.appendChild(panel);
    return panel;
}

function renderPanel() {
    if (!session || !panel) return;
    panel.className = session.wrongShake ? 'wrong' : '';
    if (session.wrongShake) {
        // 触发抖动动画重放
        panel.style.animation = 'none';
        void panel.offsetWidth;
        panel.style.animation = '';
    }
    // 标题：学科徽标 + 学科名 + 题型提示
    panel.querySelector('.edu-title').textContent =
        `${session.emoji} ${session.name}答题机 · ${session.kind === 'choice' ? '选出正确答案' : '输入答案解锁'}`;
    // 单元标签（题库文件里的 unit，空则隐藏）
    const unitEl = panel.querySelector('.edu-unit');
    const unit = session.question.unit || '';
    unitEl.style.display = unit ? 'block' : 'none';
    unitEl.textContent = unit;
    // 题面：input 拼「= ?」，choice 原样（字号收小适配长题干）
    const qEl = panel.querySelector('.edu-q');
    qEl.className = session.kind === 'choice' ? 'edu-q choice' : 'edu-q';
    qEl.textContent = session.kind === 'choice' ? session.question.q : `${session.question.q} = ?`;
    // choice：编号选项行「1. xxx」（按 1~4 作答）
    const optsEl = panel.querySelector('.edu-opts');
    if (session.kind === 'choice') {
        optsEl.style.display = 'flex';
        optsEl.innerHTML = '';
        (session.question.options || []).forEach((o, i) => {
            const div = document.createElement('div');
            div.className = 'edu-opt';
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
    // input：已输入数字 + 光标（choice 隐藏）
    const aEl = panel.querySelector('.edu-a');
    aEl.style.display = session.kind === 'input' ? 'block' : 'none';
    if (session.kind === 'input') {
        const typed = session.typed;
        aEl.innerHTML = typed === '' ? '<span class="cursor"></span>'
            : `${typed}<span class="cursor"></span>`;
    }
    // 答错反馈：优先题面 hint，其次学科通用提示
    const w = panel.querySelector('.edu-wrong');
    w.style.display = session.wrongShake ? 'block' : 'none';
    w.textContent = session.wrongShake ? `❌ 再想一想：${hintFor(session.question, session.subject)}` : '';
    // 操作提示随题型切换
    panel.querySelector('.edu-tip').textContent = session.kind === 'choice'
        ? '按 1 ~ 4 选择答案 · Esc 取消'
        : '数字键输入 · ⌫ 退格 · ⏎ 提交 · Esc 取消';
}

function openQuiz(x, y, z, picked) {
    session = {
        x, y, z,
        subject: picked.subject, emoji: picked.emoji, name: picked.name,
        kind: picked.kind, question: picked,
        typed: '', wrongShake: false,
    };
    ensurePanel();
    panel.style.display = 'block';
    renderPanel();
}

export function closeQuiz() {
    session = null;
    if (panel) panel.style.display = 'none';
}

// ---------- 提交 ----------
// 共同答对流程（与 M1 一致，不改）：翻转为 keypadId(1) + rebuildChunk + 重算红石网络
// （已解锁=常供能信号源）+ 答对音效 + 记进度发奖励
function solveKeypad() {
    const { x, y, z, subject } = session;
    closeQuiz();
    setBlockSafe(x, y, z, keypadId(1));
    rebuildChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    updateRedstoneNetwork();
    playEduCorrectSound();
    onKeypadSolved(subject, x, y, z);
}

// 共同答错流程：错误音效 + 抖动 + 记学科 wrong，900ms 后清空可重试
function failAttempt() {
    session.wrongShake = true;
    renderPanel();
    playEduWrongSound();
    onKeypadWrong(session.subject);
    setTimeout(() => {
        if (session) { session.wrongShake = false; session.typed = ''; renderPanel(); }
    }, 900);
}

// input 题：回车提交
function submitInput() {
    if (!session || session.kind !== 'input' || session.typed === '') return;
    if (parseInt(session.typed, 10) === session.question.a) solveKeypad();
    else failAttempt();
}

// choice 题：按编号选择（0/越界下标忽略——防 Digit0 等误触被判错）
function chooseOption(idx) {
    if (!session || session.kind !== 'choice') return;
    const opts = session.question.options || [];
    if (!(idx >= 0 && idx < opts.length)) return;
    if (idx === session.question.a) solveKeypad();
    else failAttempt();
}

// ---------- 入口（interaction.js 右键路由，签名不变） ----------
// 返回 true = 已处理（阻止放置）。已解锁态提示其供能特性。
export async function interactKeypadAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isKeypadId(id)) return false;
    if (keypadSolved(id) === 1) {
        import('./ui.js').then(({ showTooltip }) =>
            showTooltip('🔓 这台答题机已解锁：正在持续供能（接红石粉可远程开门）'));
        return true;
    }
    await ensureBanks();
    const picked = selectQuestion([...subjectState.values()], state.worldSeed, x, y, z);
    if (!picked) {
        // 理论不可达（内置兜底题池恒在）；自定义清单全空学科 + 文件全挂时的最后防线
        import('./ui.js').then(({ showTooltip }) => showTooltip('📭 题库暂不可用，稍后再来'));
        return true;
    }
    // 已在答这台 → 刷新；答别的 → 换到这台
    openQuiz(x, y, z, picked);
    return true;
}

// ---------- 键盘捕获（window 捕获阶段，先于 input.js 的冒泡监听） ----------
window.addEventListener('keydown', (e) => {
    if (!session) return;
    // 答题中才拦截；助手聊天框聚焦时不拦截（T 打字场景）
    if (state.assistantOpen || getUIState() !== 'playing') { closeQuiz(); return; }
    if (session.kind === 'choice') {
        // 选择题：Digit1..4 / Numpad1..4 选择；其余数字键吞掉不动作（防答题中切快捷栏）；Esc 关闭
        const m = /^(Digit|Numpad)(\d)$/.exec(e.code);
        if (m) {
            const d = parseInt(m[2], 10);
            if (d >= 1 && d <= 4) chooseOption(d - 1);
            e.stopImmediatePropagation();
            e.preventDefault();
        } else if (e.code === 'Escape') {
            closeQuiz();
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
        closeQuiz();
        e.stopImmediatePropagation();
    }
}, true);

// ---------- 玩家走远自动收起（每帧由 main.js 轻量调用亦可，这里用 tick 挂载） ----------
// 直接在交互时刻校验距离 + 走远检测放在 rAF 里成本高；改为答题时每 500ms 轮询一次
setInterval(() => {
    if (!session) return;
    const p = state.player;
    const dx = p.x - (session.x + 0.5), dy = p.y - (session.y + 0.5), dz = p.z - (session.z + 0.5);
    // 走远 → 收起并立即返回：closeQuiz 会把 session 置 null，继续往下读 session.x 会抛
    // TypeError（M1 原代码遗留的同构空指针，浏览器实测坐实）
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5 || Math.abs(dz) > 5) { closeQuiz(); return; }
    // 方块被挖掉/换掉也收起
    if (!isKeypadId(getBlock(session.x, session.y, session.z))) closeQuiz();
}, 500);

// 供 settingsUI/assistant/调试读取：各学科加载状态与题池大小、分学科答题计数
export function eduSubjects() {
    return [...subjectState.values()].map((s) => ({ subject: s.subject, emoji: s.emoji, name: s.name }));
}

export function eduStatus() {
    const p = loadEduProgress();
    const subjects = {};
    let poolSize = 0;
    for (const st of subjectState.values()) {
        const n = st.pools.input.length + st.pools.choice.length;
        poolSize += n;
        const cnt = (p.subjects && p.subjects[st.subject]) || {};
        subjects[st.subject] = {
            emoji: st.emoji, name: st.name, file: st.file,
            status: st.status, // 'loaded'=题库文件已加载 | 'builtin'=内置兜底题
            source: st.source,
            input: st.pools.input.length, choice: st.pools.choice.length, size: n,
            solved: cnt.solved || 0, wrong: cnt.wrong || 0,
        };
    }
    const loaded = Object.values(subjects).filter((s) => s.status === 'loaded').map((s) => s.name);
    return {
        ...p,
        bank: loaded.length ? `题库：${loaded.join('、')}（其余学科内置兜底题）` : '内置兜底题库',
        poolSize,
        manifestSource, // 'file'=banks.json | 'default'=代码内默认清单
        subjects,
        answering: !!session,
    };
}
