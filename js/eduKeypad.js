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
//
// 关卡工坊 P0「出题模式」（批次 W·B3，2026-09-15，契约 docs/edu-workshop-impl-contract.md §3.4）：
//   - 闯关题覆盖：interactKeypadAt 开头查 levelRun.getCardQuestion 命中卡题则跳过题库抽题；
//     无论对错都调 levelRun.recordLockAttempt 记账；考核锁（isLockAIHelpFrozen）答错不展示 hint。
//   - 作者面板：interactKeypadAuthorAt（手持出题笔右键答题机，interaction.js 接线）——
//     自拟/「从题库抽」、数学算式「算一算」系统算答案（evalMathExpr，禁 eval/Function）、
//     保存后双通过试答校验、考核锁开关（getExamIntent 待导出意图 → buildLevelCard rules 覆盖参数）。
//   - 导出新增：getAuthoredLock / isLockVerified（levelWorkshop.buildLevelCard 默认锁题提供者消费）、
//     getExamIntent、interactKeypadAuthorAt、evalMathExpr。既有导出/行为/头 PURE 区一律不动。

import { keypadId, keypadSolved, isKeypadId, CHUNK_SIZE } from './config.js';
import { state } from './state.js';
import { getBlock, setBlockSafe } from './world.js';
import { rebuildChunk } from './chunk.js';
import { updateRedstoneNetwork } from './redstone.js';
import { clearStuckKeys, getUIState, isTypingTarget, syncPointerPolicy } from './uiModal.js';
import { playEduCorrectSound, playEduWrongSound, playEduUnlockSound } from './audio.js';
import { loadEduProgress, saveEduProgress, grantEduReward } from './eduRewards.js';
// 关卡工坊（批次 W）：闯关题覆盖与锁具记账。两模块只静态依赖 config/state/world/rle，
// 与本文件无环（levelWorkshop 对本模块是动态 import，见其 defaultLockMetaProvider）。
import { getCardQuestion, isLockAIHelpFrozen, isLevelRunActive, recordLockAttempt } from './levelRun.js';
import { localKey, worldToLocal } from './levelWorkshop.js';

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
    // 答错反馈：考核锁（关卡 rules.lockAIHelp=false）不展示 hint、换考核关专用文案（契约 §3.4）；
    // 普通题优先题面 hint，其次学科通用提示
    const w = panel.querySelector('.edu-wrong');
    w.style.display = session.wrongShake ? 'block' : 'none';
    w.textContent = session.wrongShake
        ? (session.exam ? '❌ 考核关：再想想'
                        : `❌ 再想一想：${hintFor(session.question, session.subject)}`)
        : '';
    // 操作提示随题型切换
    panel.querySelector('.edu-tip').textContent = session.kind === 'choice'
        ? '按 1 ~ 4 选择答案 · Esc 取消'
        : '数字键输入 · ⌫ 退格 · ⏎ 提交 · Esc 取消';
}

function openQuiz(x, y, z, picked, cardCtx = null) {
    if (authorSession) closeAuthorPanel(); // 作者面板与玩家答题卡互斥，同一时间只开一个 HUD
    session = {
        x, y, z,
        subject: picked.subject, emoji: picked.emoji, name: picked.name,
        kind: picked.kind, question: picked,
        typed: '', wrongShake: false,
        // 关卡题上下文（批次 W；普通世界题库抽题路径 cardCtx=null，三字段恒为假值——行为不变）：
        //   fromCard=卡题来源；lockKey=局部 'x,y,z' 记账 key；exam=考核锁（答错不展示 hint）
        fromCard: !!(cardCtx && cardCtx.fromCard),
        lockKey: (cardCtx && cardCtx.lockKey) || null,
        exam: !!(cardCtx && cardCtx.exam),
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
    const { x, y, z, subject, fromCard, lockKey } = session;
    closeQuiz();
    setBlockSafe(x, y, z, keypadId(1));
    rebuildChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    updateRedstoneNetwork();
    playEduCorrectSound();
    onKeypadSolved(subject, x, y, z);
    // 关卡记账（批次 W，W14 两把锁独立记账）：无论对错都调；solved 一旦为真保持
    //（levelRun.recordLockAttempt 语义），答对照旧翻转变体+红石重算（W04 锁具联动靠它）
    if (fromCard && lockKey) {
        try { recordLockAttempt(lockKey, true); } catch { }
    }
}

// 共同答错流程：错误音效 + 抖动 + 记学科 wrong，900ms 后清空可重试
function failAttempt() {
    // 关卡记账（批次 W）：答错也记一笔（tries+1、solved 保持），再走共同答错反馈
    if (session.fromCard && session.lockKey) {
        try { recordLockAttempt(session.lockKey, false); } catch { }
    }
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

// 契约 §2 题级 schema → 答题引擎题目形状（stem→q、answer→a 字段名归一，照既有两题型渲染）。
// 学科徽标取 CARD_SUBJECT_META（含 english——题库清单 SUBJECT_META 没有英语，英语题库归商人模块，
// 这里是卡题侧专用表，不动头 PURE 区）。
const CARD_SUBJECT_META = {
    math: { emoji: '🧮', name: '数学' },
    science: { emoji: '🔬', name: '科学' },
    daofa: { emoji: '🧭', name: '道法' },
    yuwen: { emoji: '📖', name: '语文' },
    english: { emoji: '🔤', name: '英语' },
};

function cardQuestionToPicked(cardQ) {
    const meta = CARD_SUBJECT_META[cardQ.subject] || { emoji: '📚', name: cardQ.subject || '学科' };
    return {
        subject: cardQ.subject,
        emoji: meta.emoji,
        name: meta.name,
        kind: cardQ.kind === 'choice' ? 'choice' : 'input',
        q: typeof cardQ.stem === 'string' ? cardQ.stem : String(cardQ.stem ?? ''),
        a: cardQ.answer,
        ...(Array.isArray(cardQ.options) ? { options: cardQ.options.map(String) } : {}),
        hint: typeof cardQ.hint === 'string' ? cardQ.hint : '',
        unit: typeof cardQ.unit === 'string' ? cardQ.unit : '',
    };
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
    // —— 关卡题覆盖（批次 W）：闯关模式此格命中 card.questions → 直接用卡题（题目随卡全量
    // 拷贝、不随题库版本漂移），跳过下方 ensureBanks/selectQuestion 题库抽题。无论对错都由
    // solveKeypad/failAttempt 调 levelRun.recordLockAttempt 记账（localKey 用 levelWorkshop
    // 的 worldToLocal+localKey 换算，契约 §2 坐标铁律）；答错时若为考核锁则不展示 hint。
    let cardQ = null;
    try { cardQ = getCardQuestion(x, y, z); } catch { cardQ = null; }
    if (cardQ) {
        openQuiz(x, y, z, cardQuestionToPicked(cardQ), {
            fromCard: true,
            lockKey: localKey(worldToLocal(x, y, z)),
            exam: isLockAIHelpFrozen(),
        });
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
    // 作者面板（出题模式）优先处理：返回 true = 该分支已独占处理，跳过下面的玩家答题分支
    if (authorSession && handleAuthorKeydown(e)) return;
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
    // 作者面板走远巡检（批次 W）：出题必须站在锁旁，走远/答题机被拆即收（同款空指针防线——
    // closeAuthorPanel 先把 authorSession 置 null，这一分支随后 return，绝不继续读它）。
    // 编辑态不因浮层收面板：助手面板打开等暂停态下面板存活，回来接着填
    //（指针已随面板打开而释放，不需要再借暂停菜单拿鼠标）。
    if (authorSession) {
        if (authorSession.mode === 'verify'
            && (state.assistantOpen || getUIState() !== 'playing')) {
            closeAuthorPanel(); // 试答校验态与玩家答题卡同款：浮层激活即收，键让给浮层
            return;
        }
        const pa = state.player;
        const dxa = pa.x - (authorSession.x + 0.5), dya = pa.y - (authorSession.y + 0.5), dza = pa.z - (authorSession.z + 0.5);
        if (Math.abs(dxa) > 5 || Math.abs(dya) > 5 || Math.abs(dza) > 5) { closeAuthorPanel(); return; }
        if (!isKeypadId(getBlock(authorSession.x, authorSession.y, authorSession.z))) closeAuthorPanel();
        return;
    }
    if (!session) return;
    const p = state.player;
    const dx = p.x - (session.x + 0.5), dy = p.y - (session.y + 0.5), dz = p.z - (session.z + 0.5);
    // 走远 → 收起并立即返回：closeQuiz 会把 session 置 null，继续往下读 session.x 会抛
    // TypeError（M1 原代码遗留的同构空指针，浏览器实测坐实）
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5 || Math.abs(dz) > 5) { closeQuiz(); return; }
    // 方块被挖掉/换掉也收起
    if (!isKeypadId(getBlock(session.x, session.y, session.z))) closeQuiz();
}, 500);

// ==================== 出题模式（作者面板，关卡工坊 P0·批次 W·B3） ====================
// 手持出题笔（config.js PEN_ID）右键答题机进入（interaction.js 右键链接线，B2）；
// 不持笔右键 = 玩家答题（M1 行为不变，语义：拿起笔=我要出题）。面板照 openQuiz 的卡片风格
//（#edu-author 前缀），但表单要点击：pointer-events 开启。指针策略照导出面板/组件库的
// 非暂停浮层模式（state.authorPanelOpen + syncPointerPolicy）：面板打开即释放鼠标点表单，
// 关闭走既有自动回锁；Q/Esc 关面板（锁的管理权仍全归 uiModal 状态机，本模块只置标志）。
//
// 双通过校验（G2 P1-2）：保存题目后作者必须以玩家视角连答对 2 次（答错清零重计）才标记
// verified——levelWorkshop.buildLevelCard 的默认锁题提供者 defaultLockMetaProvider 会动态
// import 本模块的 getAuthoredLock，把 {question, verifiedPasses} 写进关卡卡 questions 的
// meta.verifiedPasses；validateLevelCard 对 verifiedPasses<2 报错（防「出自己不会的题」与手滑坏锁）。
// 「🧮 算一算」把系统算的答案回显进答案框——作者亲眼看见答案才能完成双通过（否则死锁）。
//
// 考核锁链路（卡级字段，非单锁字段）：面板开关只改模块级待导出意图 examIntent（getExamIntent 读）
// → 导出方（B4 ui.js / A4 gen 工具）调 levelWorkshop.buildLevelCard(
//     { name, author, rules: { lockAIHelp: getExamIntent() } })
// ——buildLevelCard 的 rules 覆盖参数语义（见 levelWorkshop.js 源码）：
//     lockAIHelp: rulesOverride && 'lockAIHelp' in rulesOverride ? !!rulesOverride.lockAIHelp : true
// → 落进 card.rules.lockAIHelp → 闯关运行时 levelRun.isLockAIHelpFrozen() 读到 false
// ⇒ 本文件 renderPanel 答错走「考核关：再想想」（不展示 hint）+ P3 助手对此卡锁题拒答提示。
//
// 存储边界（P0 简化）：authoredLocks 是模块内存 Map（key='x,y,z' 世界坐标），不进存档——
// 页面刷新即失是已接受的对价；走远收面板/重开面板/切别的答题机都不会丢已保存的题。
// 「自拟」不是学科：契约 §2 的 subject 必须落在 math/science/daofa/yuwen/english 五枚举内
//（validateLevelCard 硬校验），下拉里的「✍️ 自拟」只表示题目来源是手写而非题库抽取，
// 导出时学科标签沿用上次所选的具体学科（默认 math），面板上有文案说明。

const SALT_AUTHOR_PICK = 0x1b873593; // 「从题库抽」专用盐（与头 PURE 区三个抽题盐互不干扰）

let authorPanel = null;          // #edu-author 根元素
let authorSession = null;        // { x,y,z, mode:'edit'|'verify'|'done', form, verify, msg }
const authoredLocks = new Map(); // 'x,y,z'（世界坐标）→ { question, verifiedPasses }（契约 §3.4）
let examIntent = false;          // 考核锁待导出意图（默认关；链路见上方注释）

function auKey(x, y, z) {
    return `${x},${y},${z}`;
}

// innerHTML 文本转义（题干/选项/hint 是作者自由输入，防 <、" 破坏面板结构）
function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- 契约 §3.4 导出 ----

// getAuthoredLock：buildLevelCard 默认锁题提供者消费；该锁没出过题返回 null
export function getAuthoredLock(x, y, z) {
    const e = authoredLocks.get(auKey(x, y, z));
    return e ? { question: e.question, verifiedPasses: e.verifiedPasses } : null;
}

// isLockVerified：双通过（连对 2 次）才算校验通过，导出校验的门槛
export function isLockVerified(x, y, z) {
    const e = authoredLocks.get(auKey(x, y, z));
    return !!e && e.verifiedPasses >= 2;
}

// ---- 锁题快照/种子（2026-09-16 编辑器批次，levelEditor.js 消费）----
// authoredLocks 按世界坐标记在内存（不进存档）；编辑器临时世界占住嵌入区坐标，
// 进编辑器前快照清空、退编辑器原样恢复，防与真实世界的锁互相串扰。

// 全表快照（levelEditor.enterLevelEditor 进场前调）
export function listAuthoredLocks() {
    return [...authoredLocks.entries()].map(([key, e]) => ({
        key, question: e.question, verifiedPasses: e.verifiedPasses,
    }));
}

// 整表恢复（传 [] 即清空）；levelEditor 进/退编辑器各调一次
export function restoreAuthoredLocks(list) {
    authoredLocks.clear();
    for (const e of list || []) {
        if (e && e.key && e.question) {
            authoredLocks.set(e.key, { question: e.question, verifiedPasses: e.verifiedPasses | 0 });
        }
    }
}

// 单锁种子：把关卡卡里的题按世界坐标种回作者锁表（模板/草稿重嵌入后双通过免重做；
// 作者用笔改题仍走原保存流程 → verifiedPasses 归零重考，语义不变）
export function seedAuthoredLock(x, y, z, question, verifiedPasses) {
    if (!question) return;
    authoredLocks.set(auKey(x, y, z), { question, verifiedPasses: Math.min(2, verifiedPasses | 0) });
}

// getExamIntent：考核锁待导出意图（导出方读走、塞进 buildLevelCard 的 rules 覆盖参数，见链路注释）
export function getExamIntent() {
    return examIntent;
}

// ---------- 作者面板样式与 DOM ----------
// 与玩家答题卡（#edu-quiz）同视觉语言，但选择器独立、id 前缀 edu-author；
// 关键差异 pointer-events:auto（表单要点击）与 z-index 62（同 HUD 层，低于暂停菜单 90+）。

const AUTHOR_CSS = `
#edu-author {
    position: fixed; left: 50%; top: 46%; transform: translate(-50%, -50%);
    z-index: 62; pointer-events: auto; text-align: center;
    width: min(92vw, 580px); font-family: 'Courier New', monospace;
    animation: au-pop .18s ease-out;
}
#edu-author .au-card {
    background: rgba(20, 26, 34, .95); border: 3px solid #ffd84a; border-radius: 14px;
    padding: 14px 18px; box-shadow: 0 0 24px rgba(255, 216, 74, .35), inset 0 0 12px rgba(0,0,0,.5);
    color: #fff; max-height: 84vh; overflow-y: auto;
}
#edu-author.au-shake .au-card { border-color: #e05252; animation: au-shake .3s; }
#edu-author .au-title { color: #ffd84a; font-size: 14px; letter-spacing: 2px; margin-bottom: 4px; }
#edu-author .au-status { color: #9ae6b4; font-size: 12px; margin-bottom: 8px; }
#edu-author .au-row { display: flex; gap: 8px; align-items: center; justify-content: center;
    flex-wrap: wrap; margin: 8px 0; font-size: 13px; color: #b8c4d0; }
#edu-author input[type=text], #edu-author textarea, #edu-author select {
    background: #0d1117; color: #fff; border: 2px solid #3a4a5a; border-radius: 6px;
    font-family: inherit; font-size: 14px; padding: 4px 8px;
}
#edu-author textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 42px; }
#edu-author button {
    background: #1c2733; color: #ffd84a; border: 2px solid #ffd84a; border-radius: 8px;
    padding: 5px 12px; font-family: inherit; font-size: 13px; cursor: pointer;
}
#edu-author button:hover { background: #2a3a4a; }
#edu-author button:disabled { opacity: .4; cursor: default; }
#edu-author .au-optrow { display: flex; gap: 6px; align-items: center; margin: 4px auto; width: 94%; }
#edu-author .au-optrow input { flex: 1; }
#edu-author .au-pick { min-width: 34px; padding: 4px 8px; }
#edu-author .au-pick.ok { border-color: #39d353; color: #39d353; }
#edu-author .au-msg { color: #ffd84a; font-size: 13px; min-height: 18px; margin: 4px 0; }
#edu-author .au-tip { color: #6a7a8a; font-size: 11px; margin-top: 8px; }
/* —— 试答校验/双通过态（照玩家答题卡的视觉语言） —— */
#edu-author .au-q { color: #fff; font-size: 26px; font-weight: bold; text-shadow: 0 2px 0 #000; }
#edu-author .au-unit { color: #6a9a7a; font-size: 11px; margin-bottom: 6px; }
#edu-author .au-opts { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; }
#edu-author .au-opt { color: #b8f0c4; font-size: 19px; font-weight: bold; text-shadow: 0 1px 0 #000; }
#edu-author .au-opt b { color: #ffd84a; margin-right: 6px; }
#edu-author .au-a { color: #ffd84a; font-size: 30px; font-weight: bold; min-height: 40px; margin-top: 6px;
    text-shadow: 0 2px 0 #000; }
#edu-author .au-a .cursor { display: inline-block; width: 16px; height: 30px; background: #ffd84a;
    vertical-align: middle; animation: au-blink 1s steps(1) infinite; margin-left: 4px; }
#edu-author .au-wrong { color: #ff9a9a; font-size: 14px; margin-top: 6px; font-weight: bold; }
@keyframes au-pop { from { transform: translate(-50%,-50%) scale(.7); opacity: 0; } }
@keyframes au-blink { 50% { opacity: 0; } }
@keyframes au-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
`;

function ensureAuthorPanel() {
    if (authorPanel) return authorPanel;
    if (!document.getElementById('edu-author-style')) {
        const style = document.createElement('style');
        style.id = 'edu-author-style';
        style.textContent = AUTHOR_CSS;
        document.head.appendChild(style);
    }
    authorPanel = document.createElement('div');
    authorPanel.id = 'edu-author';
    authorPanel.style.display = 'none';
    authorPanel.innerHTML = '<div class="au-card"></div>';
    // 事件一律委托到根元素（innerHTML 重渲染不丢监听）；文本框只认 input、
    // select/radio/checkbox 只认 change，避免同一次操作触发两遍
    authorPanel.addEventListener('click', onAuthorClick);
    authorPanel.addEventListener('input', onAuthorFormField);
    authorPanel.addEventListener('change', onAuthorFormField);
    document.body.appendChild(authorPanel);
    return authorPanel;
}

function closeAuthorPanel() {
    authorSession = null;
    if (authorPanel) authorPanel.style.display = 'none';
    if (state.authorPanelOpen) {
        state.authorPanelOpen = false;
        syncPointerPolicy(); // 面板全关 → 走 uiModal 既有自动回锁链路
        clearStuckKeys();
    }
}

// ---------- 面板渲染（edit 表单 / verify 试答 / done 双通过） ----------

function authorStatusLine() {
    const e = authoredLocks.get(auKey(authorSession.x, authorSession.y, authorSession.z));
    if (!e) return '🆕 这把锁还没出题——填表保存后连答对 2 次完成校验';
    return `🔒 已出题「${e.question.stem}」· 双通过 ${e.verifiedPasses}/2`
        + (e.verifiedPasses >= 2 ? '（✅ 可导出）' : '');
}

function renderEditForm() {
    const f = authorSession.form;
    const isMathInput = f.subject === 'math' && f.kind === 'input'; // 自拟数学也算（求值器不看来源）
    const subjectOpts = [
        ['math', '🧮 数学'], ['science', '🔬 科学'], ['daofa', '🧭 道法'],
        ['yuwen', '📖 语文'], ['english', '🔤 英语'], ['custom', '✍️ 自拟'],
    ].map(([v, label]) =>
        `<option value="${v}"${(f.custom ? v === 'custom' : v === f.subject) ? ' selected' : ''}>${label}</option>`
    ).join('');
    const kindRadio = (val, label) =>
        `<label><input type="radio" name="au-kind" data-field="kind" value="${val}"${f.kind === val ? ' checked' : ''}> ${label}</label>`;
    let body;
    if (f.kind === 'input') {
        body = `
        <div class="au-row">正确答案（0..9999）<input type="text" inputmode="numeric" maxlength="4"
            data-field="ansIn" value="${escAttr(f.ansRaw)}" style="width:90px" placeholder="0..9999"></div>`;
    } else {
        const rows = f.options.map((o, i) => `
            <div class="au-optrow">
                <button class="au-pick${f.answerIdx === i ? ' ok' : ''}" data-act="pickans" data-i="${i}"
                    title="点选为正确项">${f.answerIdx === i ? '✓' : i + 1}</button>
                <input type="text" data-field="opt${i}" value="${escAttr(o)}" placeholder="选项 ${i + 1}">
                <button data-act="optdel" data-i="${i}"${f.options.length <= 3 ? ' disabled' : ''} title="删除该选项">✕</button>
            </div>`).join('');
        body = `
        <div class="au-row">选项 3~4 条（点左侧编号选定正确项，正确项与干扰项不能重名）</div>
        ${rows}
        <div class="au-row"><button data-act="optadd"${f.options.length >= 4 ? ' disabled' : ''}>＋ 添加选项</button></div>`;
    }
    return `
        <div class="au-title">✍️ 出题笔 · 答题机作者面板</div>
        <div class="au-status">${escAttr(authorStatusLine())}</div>
        <div class="au-row">
            <label>学科 <select data-field="subject">${subjectOpts}</select></label>
            ${kindRadio('input', '数字输入')}
            ${kindRadio('choice', '三~四选一')}
        </div>
        <div class="au-row" style="width:94%"><textarea data-field="stem"
            placeholder="题干（数学算式直接写，如 3×4+5；选择题写完整问句）">${escAttr(f.stem)}</textarea></div>
        ${body}
        <div class="au-row" style="width:94%">
            <input type="text" data-field="hint" value="${escAttr(f.hint)}" placeholder="答错提示（选填）" style="flex:1">
            <input type="text" data-field="unit" value="${escAttr(f.unit)}" placeholder="单元标签（选填，抽题按前缀过滤）" style="flex:1">
        </div>
        <div class="au-row">
            <button data-act="pick">🎲 从题库抽</button>
            ${isMathInput ? '<button data-act="calc">🧮 算一算</button>' : ''}
            <label title="整张关卡卡的 rules.lockAIHelp 设置：开=导出后 AI 助手对此卡的锁题拒答提示">
                <input type="checkbox" data-field="exam"${examIntent ? ' checked' : ''}> 🔒 考核锁（整卡）</label>
        </div>
        <div class="au-msg">${escAttr(authorSession.msg || '')}</div>
        <div class="au-row"><button data-act="save" style="font-size:15px">✅ 保存并校验</button></div>
        <div class="au-tip">按 Q 释放鼠标点选表单 · Esc 关闭面板 · 保存后以玩家视角连答对 2 次完成校验（答错清零重计）</div>`;
}

function renderVerifyView() {
    const e = authoredLocks.get(auKey(authorSession.x, authorSession.y, authorSession.z));
    if (!e) { closeAuthorPanel(); return ''; } // 防御：校验态必有已存题
    const q = e.question;
    const v = authorSession.verify;
    const unitLine = q.unit ? `<div class="au-unit">${escAttr(q.unit)}</div>` : '';
    const qText = q.kind === 'choice' ? escAttr(q.stem) : `${escAttr(q.stem)} = ?`;
    let answerHtml;
    if (q.kind === 'choice') {
        const opts = (q.options || []).map((o, i) =>
            `<div class="au-opt"><b>${i + 1}.</b>${escAttr(o)}</div>`).join('');
        answerHtml = `<div class="au-opts">${opts}</div>`;
    } else {
        answerHtml = `<div class="au-a">${v.typed === ''
            ? '<span class="cursor"></span>'
            : `${escAttr(v.typed)}<span class="cursor"></span>`}</div>`;
    }
    const wrongHtml = v.wrongShake
        ? `<div class="au-wrong">❌ 再想一想：${escAttr(hintFor(q, q.subject))}</div>` : '';
    const passMsg = v.msg ? `<div class="au-msg">${escAttr(v.msg)}</div>` : '';
    return `
        <div class="au-title">✅ 试答校验 · 连对 2 次即可导出（${v.passStreak}/2）</div>
        ${unitLine}
        <div class="au-q">${qText}</div>
        ${answerHtml}
        ${wrongHtml}
        ${passMsg}
        <div class="au-tip">${q.kind === 'choice'
            ? '按 1 ~ 4 选择答案 · Esc 退出校验'
            : '数字键输入 · ⌫ 退格 · ⏎ 提交 · Esc 退出校验'}</div>`;
}

function renderDoneView() {
    return `
        <div class="au-title">✍️ 出题笔 · 答题机作者面板</div>
        <div class="au-status" style="font-size:16px">✅ 已双通过，可导出</div>
        <div class="au-row">锁 (${authorSession.x}, ${authorSession.y}, ${authorSession.z}) 的题目连对 2 次，
            导出关卡卡时会带 verifiedPasses=2</div>
        <div class="au-msg">${escAttr(authorSession.msg || '')}</div>
        <div class="au-row">
            <button data-act="edit">✏️ 重新编辑</button>
            <button data-act="close">✖ 关闭</button>
        </div>
        <div class="au-tip">重新编辑并再次「保存并校验」会把通过次数清零重考（防改题后忘验）</div>`;
}

function renderAuthorPanel() {
    if (!authorSession || !authorPanel) return;
    const card = authorPanel.querySelector('.au-card');
    // 抖动动画重放（照玩家答题卡的做法；抖动加在内层 .au-card 上，不破坏根元素居中 transform）
    if (authorSession.verify && authorSession.verify.wrongShake) {
        authorPanel.classList.add('au-shake');
        authorPanel.style.animation = 'none';
        void authorPanel.offsetWidth;
        authorPanel.style.animation = '';
    } else {
        authorPanel.classList.remove('au-shake');
    }
    if (authorSession.mode === 'edit') card.innerHTML = renderEditForm();
    else if (authorSession.mode === 'verify') card.innerHTML = renderVerifyView();
    else card.innerHTML = renderDoneView();
}

// ---------- 面板打开 / 入口 ----------

function openAuthorPanel(x, y, z) {
    const existing = authoredLocks.get(auKey(x, y, z));
    // 表单初值：出过题则回填已存题（走远/重开面板状态保留——Map 在模块内存，见存储边界注释）
    const form = {
        subject: 'math', custom: false, kind: 'input',
        stem: '', options: ['', '', ''], ansRaw: '', answerIdx: 0,
        hint: '', unit: '', pickedFromBank: false,
    };
    if (existing) {
        const q = existing.question;
        form.subject = CARD_SUBJECT_META[q.subject] ? q.subject : 'math';
        form.kind = q.kind === 'choice' ? 'choice' : 'input';
        form.stem = typeof q.stem === 'string' ? q.stem : '';
        form.options = Array.isArray(q.options) ? q.options.map(String).slice(0, 4) : ['', '', ''];
        while (form.options.length < 3) form.options.push('');
        if (form.kind === 'choice') form.answerIdx = q.answer | 0;
        else form.ansRaw = String(q.answer ?? '');
        form.hint = typeof q.hint === 'string' ? q.hint : '';
        form.unit = typeof q.unit === 'string' ? q.unit : '';
        form.pickedFromBank = !!(q.meta && q.meta.source === 'bank');
    }
    authorSession = {
        x, y, z,
        mode: 'edit', // 'edit' 表单 → 'verify' 试答双通过 → 'done' 可导出
        form,
        verify: { typed: '', wrongShake: false, passStreak: 0, msg: '' },
        msg: '',
    };
    ensureAuthorPanel();
    authorPanel.style.display = 'block';
    state.authorPanelOpen = true;
    // 打开即释放鼠标（照导出面板/组件库的非暂停浮层模式）：表单直接可点，
    // 不再要求作者先按 Q——旧流程按 Q 会弹暂停菜单把面板盖住，体验割裂
    syncPointerPolicy();
    clearStuckKeys(); // 清移动键，避免开面板瞬间角色继续走
    renderAuthorPanel();
}

// ---------- 入口（interaction.js 右键路由：手持出题笔右键答题机，B2 接线） ----------
// 返回 true = 已处理（签名风格同 interactKeypadAt）。防抖：同锁再点=收起（toggle）；
// 异锁=直接切换；玩家答题卡开着先收（openQuiz 侧也有互斥，双保险）。
export function interactKeypadAuthorAt(x, y, z) {
    const id = getBlock(x, y, z);
    if (!isKeypadId(id)) return false;
    if (isLevelRunActive()) {
        // 闯关模式不能出题：卡题随卡固定；且作者 Map 以世界坐标为 key，
        // 嵌入区（+80,+4,+80）的坐标若被写进 Map 会污染普通世界的同位锁
        import('./ui.js').then(({ showTooltip }) => showTooltip('🗺 闯关中不能出题，退出关卡再拿笔'));
        return true;
    }
    if (keypadSolved(id) === 1) {
        // 已解锁变体会原样嵌进关卡卡区域快照（锁天生是开的），直接挡下防坏卡
        import('./ui.js').then(({ showTooltip }) => showTooltip('✍️ 这台答题机已解锁，换一台锁定状态的来出题'));
        return true;
    }
    if (authorSession) {
        const same = authorSession.x === x && authorSession.y === y && authorSession.z === z;
        closeAuthorPanel();
        if (same) return true; // 同一把锁再点一次 = 收起
    }
    if (session) closeQuiz();
    openAuthorPanel(x, y, z);
    return true;
}

// ---------- 表单交互（事件委托，挂在 ensureAuthorPanel） ----------

function onAuthorClick(e) {
    if (!authorSession) return;
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'close') { closeAuthorPanel(); return; }
    if (act === 'edit') {
        authorSession.mode = 'edit';
        authorSession.msg = '';
        renderAuthorPanel();
        return;
    }
    if (authorSession.mode !== 'edit') return;
    if (act === 'pickans') {
        const i = Number(btn.dataset.i);
        const f = authorSession.form;
        if (i >= 0 && i < f.options.length) {
            f.answerIdx = i;
            f.pickedFromBank = false; // 手改即视为自拟（meta.source 跟随）
            authorSession.msg = '';
            renderAuthorPanel();
        }
    } else if (act === 'optadd') {
        const f = authorSession.form;
        if (f.options.length < 4) {
            f.options.push('');
            f.pickedFromBank = false;
            renderAuthorPanel();
        }
    } else if (act === 'optdel') {
        const f = authorSession.form;
        const i = Number(btn.dataset.i);
        if (f.options.length > 3 && i >= 0 && i < f.options.length) {
            f.options.splice(i, 1);
            if (i < f.answerIdx) f.answerIdx--;          // 正确项索引随删项左移
            else if (i === f.answerIdx) f.answerIdx = -1; // 删的是正确项 → 必须重新点选
            f.pickedFromBank = false;
            renderAuthorPanel();
        }
    } else if (act === 'pick') {
        void authorPickFromBank();
    } else if (act === 'calc') {
        authorCalcAnswer();
    } else if (act === 'save') {
        saveAuthoredQuestion();
    }
}

function onAuthorFormField(e) {
    const s = authorSession;
    if (!s || s.mode !== 'edit') return;
    const el = e.target;
    if (!el.dataset || !el.dataset.field) return;
    const isTextish = (el.tagName === 'INPUT' && el.type === 'text') || el.tagName === 'TEXTAREA';
    if ((e.type === 'input') !== isTextish) return; // 文本只认 input；select/radio/checkbox 只认 change
    const f = s.form;
    switch (el.dataset.field) {
        case 'subject':
            if (el.value === 'custom') {
                f.custom = true; // 学科标签沿用上次所选（导出必须落五枚举，见段首注释）
                s.msg = '✍️ 自拟：直接手写题目（学科标签沿用上次所选，导出校验要求落在五学科内）';
            } else {
                f.custom = false;
                f.subject = el.value;
                s.msg = '';
            }
            renderAuthorPanel();
            break;
        case 'kind': {
            const kind = el.value === 'choice' ? 'choice' : 'input';
            if (kind !== f.kind) {
                f.kind = kind;
                f.pickedFromBank = false;
                s.msg = '';
                renderAuthorPanel();
            }
            break;
        }
        case 'exam':
            // 只改待导出意图变量；真正的 rules.lockAIHelp 由导出方经 buildLevelCard 落（见链路注释）
            examIntent = !!el.checked;
            s.msg = examIntent
                ? '🔒 已标记考核锁：导出时 rules.lockAIHelp=false（整张卡生效，所有锁共享）'
                : '考核锁已取消（整卡）';
            renderAuthorPanel();
            break;
        case 'stem':
            f.stem = el.value;
            f.pickedFromBank = false;
            break;
        case 'hint':
            f.hint = el.value;
            f.pickedFromBank = false;
            break;
        case 'unit':
            f.unit = el.value;
            f.pickedFromBank = false;
            break;
        case 'ansIn': {
            const clean = el.value.replace(/\D/g, '').slice(0, 4); // 只收数字、上限 4 位
            if (clean !== el.value) el.value = clean; // 只回写过滤后的值，不打断输入
            f.ansRaw = clean;
            f.pickedFromBank = false;
            break;
        }
        default: {
            const m = /^opt(\d)$/.exec(el.dataset.field);
            if (m) {
                const i = Number(m[1]);
                if (i >= 0 && i < f.options.length) {
                    f.options[i] = el.value;
                    f.pickedFromBank = false;
                }
            }
        }
    }
}

// 「🎲 从题库抽」：按所选学科（+unit 前缀过滤）抽一题**填进表单**（作者可再改）。
// 复用 ensureBanks 与题库数据（fetch 失败静默降级内置兜底题，同玩家抽题路径）；
// 抽题哈希 hashCell(种子, x,y,z, 专用盐) ⇒ 同一台锁反复点抽到同一题（同锁同抽）。
async function authorPickFromBank() {
    const s = authorSession;
    const f = s.form;
    if (f.custom) {
        s.msg = '✍️ 自拟题请手写；要抽题先在学科下拉里选个具体学科';
        renderAuthorPanel();
        return;
    }
    await ensureBanks();
    const st = subjectState.get(f.subject);
    const kindPool = st ? st.pools[f.kind] : [];
    if (!kindPool.length) {
        s.msg = st
            ? `📭 该学科暂无${f.kind === 'choice' ? '选择题' : '数字题'}（题库未装载或为空），请自拟`
            : '📭 该学科不在答题机题库清单里（英语由商人模块装载），请自拟';
        renderAuthorPanel();
        return;
    }
    const prefix = f.unit.trim();
    let cands = prefix
        ? kindPool.filter((it) => typeof it.unit === 'string' && it.unit.startsWith(prefix))
        : kindPool;
    let degraded = false;
    if (!cands.length) { cands = kindPool; degraded = true; } // 前缀无命中 → 回退全学科（明示作者）
    const it = cands[hashCell(state.worldSeed, s.x, s.y, s.z, SALT_AUTHOR_PICK) % cands.length];
    f.stem = it.q;
    if (f.kind === 'choice') {
        f.options = (it.options || []).slice();
        while (f.options.length < 3) f.options.push('');
        f.answerIdx = it.a | 0;
        if (f.answerIdx < 0 || f.answerIdx >= f.options.length) f.answerIdx = 0;
    } else {
        f.ansRaw = String(it.a);
    }
    f.hint = typeof it.hint === 'string' ? it.hint : '';
    f.unit = typeof it.unit === 'string' ? it.unit : '';
    f.pickedFromBank = true;
    s.msg = degraded
        ? `📭 题库没有 unit 前缀「${prefix}」的题，已抽全学科（可再改）`
        : '🎲 已抽入表单——可再改（改动后按自拟计），确认无误就「保存并校验」';
    renderAuthorPanel();
}

// 「🧮 算一算」（仅数学+数字输入显示）：对题干做安全算式求值并回填答案框。
// G2 P1-2：系统算的答案必须回显给作者（作者亲眼确认后才能完成双通过），
// 否则「出题者不知道自己锁的答案」会造成双通过死锁。求值器 evalMathExpr 在文件尾 AUTHOR-PURE 区。
function authorCalcAnswer() {
    const s = authorSession;
    const f = s.form;
    if (f.subject !== 'math' || f.kind !== 'input') return;
    const val = evalMathExpr(f.stem);
    if (val === null) {
        s.msg = '🧮 算不出：题干不是纯算式（只支持 0-9 与 + − × ÷ ( )），请自填答案';
    } else if (!Number.isInteger(val) || val < 0 || val > 9999) {
        s.msg = `🧮 系统算得 ${val}：超出 0..9999（保存会被拒），请改题干或自填`;
    } else {
        f.ansRaw = String(val);
        f.pickedFromBank = false;
        s.msg = `🧮 系统算得 ${val}，已回填答案框——请亲眼核对后再保存`;
    }
    renderAuthorPanel();
}

// 「✅ 保存并校验」：题合法性校验（照 validateLevelCard 同规则先挡一道：题干非空、
// 选项非空且互不重复、input 答案 0..9999、choice 正确项索引合法）→ 存入作者 Map
//（key='x,y,z' 世界坐标，verifiedPasses 归零）→ 切试答校验模式。重新保存 = 改题，
// 之前的双通过一律作废重考。
function saveAuthoredQuestion() {
    const s = authorSession;
    const f = s.form;
    const stem = f.stem.trim();
    if (!stem) { s.msg = '❌ 题干不能为空'; renderAuthorPanel(); return; }
    const subject = f.subject; // 恒为五枚举之一（「自拟」只是来源，见段首注释）
    const source = f.pickedFromBank ? 'bank' : 'custom';
    let question;
    if (f.kind === 'input') {
        const ans = Number(f.ansRaw);
        if (f.ansRaw.trim() === '' || !Number.isInteger(ans) || ans < 0 || ans > 9999) {
            s.msg = '❌ 数字题答案必须是 0..9999 的整数';
            renderAuthorPanel();
            return;
        }
        question = { subject, kind: 'input', stem, answer: ans, meta: { source } };
    } else {
        const opts = f.options.map((o) => o.trim());
        if (opts.length < 3 || opts.length > 4) { s.msg = '❌ 选项必须 3~4 条'; renderAuthorPanel(); return; }
        if (opts.some((o) => !o)) { s.msg = '❌ 选项不能为空'; renderAuthorPanel(); return; }
        if (new Set(opts).size !== opts.length) {
            s.msg = '❌ 选项内容重复（正确项与干扰项也不能相同）';
            renderAuthorPanel();
            return;
        }
        if (!(f.answerIdx >= 0 && f.answerIdx < opts.length)) {
            s.msg = '❌ 请先点选正确项（选项左侧编号）';
            renderAuthorPanel();
            return;
        }
        question = { subject, kind: 'choice', stem, options: opts, answer: f.answerIdx, meta: { source } };
    }
    const hint = f.hint.trim();
    const unit = f.unit.trim();
    if (hint) question.hint = hint; // 选填字段空则不落（契约 §2 hint?/unit? 可选）
    if (unit) question.unit = unit;
    authoredLocks.set(auKey(s.x, s.y, s.z), { question, verifiedPasses: 0 });
    s.mode = 'verify';
    s.verify = { typed: '', wrongShake: false, passStreak: 0, msg: '' };
    renderAuthorPanel();
}

// ---------- 试答校验（双通过：连对 2 次，答错清零重计） ----------
// 判定照玩家答题（input 比数字、choice 比索引），但不翻方块、不记 M1 进度——只累计 verifiedPasses
//（存回作者 Map，buildLevelCard 导出时带出）。

function authorVerifyCorrect() {
    const s = authorSession;
    const entry = authoredLocks.get(auKey(s.x, s.y, s.z));
    s.verify.passStreak += 1;
    s.verify.typed = '';
    s.verify.wrongShake = false;
    playEduCorrectSound();
    if (entry) entry.verifiedPasses = Math.min(2, s.verify.passStreak);
    if (s.verify.passStreak >= 2) {
        s.mode = 'done';
        s.msg = '';
    } else {
        s.verify.msg = '第 1 次通过！再答对一次完成双通过（答错会清零重计）';
    }
    renderAuthorPanel();
}

function authorVerifyWrong() {
    const s = authorSession;
    const entry = authoredLocks.get(auKey(s.x, s.y, s.z));
    s.verify.passStreak = 0;
    s.verify.typed = '';
    if (entry) entry.verifiedPasses = 0; // 答错清零重计
    s.verify.wrongShake = true;
    playEduWrongSound();
    renderAuthorPanel();
    setTimeout(() => {
        if (authorSession) {
            authorSession.verify.wrongShake = false;
            renderAuthorPanel();
        }
    }, 900);
}

function submitAuthorVerifyInput() {
    const s = authorSession;
    const entry = authoredLocks.get(auKey(s.x, s.y, s.z));
    if (!s || !entry || entry.question.kind !== 'input' || s.verify.typed === '') return;
    if (parseInt(s.verify.typed, 10) === entry.question.answer) authorVerifyCorrect();
    else authorVerifyWrong();
}

function chooseAuthorVerifyOption(idx) {
    const s = authorSession;
    const entry = authoredLocks.get(auKey(s.x, s.y, s.z));
    if (!s || !entry || entry.question.kind !== 'choice') return;
    const opts = entry.question.options || [];
    if (!(idx >= 0 && idx < opts.length)) return; // 越界下标忽略（防 Digit0 等误触被判错）
    if (idx === entry.question.answer) authorVerifyCorrect();
    else authorVerifyWrong();
}

// ---------- 作者面板键盘处理（被上方 window 捕获监听优先调用） ----------
// 让路策略（最小改法）：编辑/done 态整体不抢键——表单是真 input 元素，input.js 对
// isTypingTarget 本来就让路，游戏快捷键照常；只接管「游戏中+非打字焦点」的 Esc=关面板。
// 试答校验态没有输入框，照玩家答题卡同款捕获（数字选择/输入、退格、回车、Esc）。
// 返回 true = 本分支独占处理（跳过玩家答题分支；未消费的键照常传给后续监听者）。
function handleAuthorKeydown(e) {
    const s = authorSession;
    if (s.mode === 'verify') {
        // 浮层激活即收（键让给浮层），与玩家答题卡同款守卫
        if (state.assistantOpen || getUIState() !== 'playing') { closeAuthorPanel(); return true; }
        const entry = authoredLocks.get(auKey(s.x, s.y, s.z));
        const kind = entry ? entry.question.kind : 'input';
        const m = /^(Digit|Numpad)(\d)$/.exec(e.code);
        if (kind === 'choice') {
            if (m) {
                const d = parseInt(m[2], 10);
                if (d >= 1 && d <= ((entry && entry.question.options) || []).length) {
                    chooseAuthorVerifyOption(d - 1);
                }
                e.stopImmediatePropagation();
                e.preventDefault();
            } else if (e.code === 'Escape' || e.code === 'KeyQ') {
                // Q 与 Esc 同效关面板（ZCode 内嵌浏览器里 Esc 会被宿主截获，Q 是页面内替代键）
                closeAuthorPanel();
                e.stopImmediatePropagation();
            }
            return true;
        }
        if (e.code.startsWith('Digit') || (e.code.startsWith('Numpad') && /\d$/.test(e.code))) {
            if (s.verify.typed.length < 4) {
                s.verify.typed += e.code.slice(-1);
                renderAuthorPanel();
            }
            e.stopImmediatePropagation();
            e.preventDefault();
        } else if (e.code === 'Backspace') {
            s.verify.typed = s.verify.typed.slice(0, -1);
            renderAuthorPanel();
            e.stopImmediatePropagation();
            e.preventDefault();
        } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            submitAuthorVerifyInput();
            e.stopImmediatePropagation();
            e.preventDefault();
        } else if (e.code === 'Escape' || e.code === 'KeyQ') {
            closeAuthorPanel();
            e.stopImmediatePropagation();
        }
        return true;
    }
    // 编辑/done 态：不抢任何游戏键；仅「游戏中 + 未在输入框打字」时 Esc/Q 关面板
    //（Q 是 Esc 的页面内替代键——ZCode 内嵌浏览器会把 Esc 截给宿主）
    if (getUIState() === 'playing' && !state.assistantOpen
        && (e.code === 'Escape' || e.code === 'KeyQ') && !isTypingTarget(e)) {
        closeAuthorPanel();
        e.stopImmediatePropagation();
        e.preventDefault();
        return true;
    }
    return false;
}


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

// >>> AUTHOR-PURE-BEGIN
// （作者面板纯函数区：与文件头部 PURE 区同款约定——区间内零 window/document/state 等
//  DOM/全局依赖，Node 可按区间标记切片、剥 export 后直接求值测试，见 tools/test_author_math.mjs）

// 安全算式求值（「🧮 算一算」后端，纯函数，导出供测试）：自实现 tokenizer + 递归下降，
// precedence = expr(±term 序) → term(×÷factor 序) → factor(整数 | (expr) | 一元±)。
// 禁止 eval / new Function——出题笔面向儿童，题干是不可信输入，绝不能走动态求值。
// 支持：0-9 整数、+ - * / ( )、全角 × ÷ −（U+00D7/U+00F7/U+2212）与全角（）、token 间空白。
// 除以 0、括号不配对、非法字符、尾缀残缺、空串/超长、非字符串输入 → null；
// 结果可为负数/小数（如 7÷2 → 3.5）——是否落在 0..9999 由调用方（保存校验/算一算回显）把关。
export function evalMathExpr(str) {
    if (typeof str !== 'string') return null;
    // 字符归一：全角运算符/括号 → ASCII。只做白名单映射，不做 NFKC（避免全角数字被悄悄放行）。
    const MAP = { '×': '*', '÷': '/', '−': '-', '（': '(', '）': ')', '＊': '*', '／': '/' };
    let src = '';
    for (const ch of str) src += MAP[ch] !== undefined ? MAP[ch] : ch;
    const n = src.length;
    if (n === 0 || n > 128) return null; // 空串 / 防御性超长上限（正常算式远到不了）
    let i = 0;
    const skipWs = () => {
        while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
    };
    function parseExpr() {
        let v = parseTerm();
        if (v === null) return null;
        for (;;) {
            skipWs();
            const op = src[i];
            if (op !== '+' && op !== '-') return v;
            i++;
            const r = parseTerm();
            if (r === null) return null;
            v = op === '+' ? v + r : v - r;
        }
    }
    function parseTerm() {
        let v = parseFactor();
        if (v === null) return null;
        for (;;) {
            skipWs();
            const op = src[i];
            if (op !== '*' && op !== '/') return v;
            i++;
            const r = parseFactor();
            if (r === null) return null;
            if (op === '/') {
                if (r === 0) return null; // 除零 → null（绝不产生 Infinity）
                v = v / r;
            } else {
                v = v * r;
            }
        }
    }
    function parseFactor() {
        skipWs();
        const c = src[i];
        if (c === '+') { i++; return parseFactor(); } // 一元 +（容错）
        if (c === '-') {
            i++;
            const v = parseFactor(); // 一元 −（如 −5+8）
            return v === null ? null : -v;
        }
        if (c === '(') {
            i++;
            const v = parseExpr();
            if (v === null) return null;
            skipWs();
            if (src[i] !== ')') return null; // 括号不配对
            i++;
            return v;
        }
        const start = i;
        while (i < n && src[i] >= '0' && src[i] <= '9') i++;
        if (i === start) return null; // 不是数字（非法字符 / 空 factor）
        return parseInt(src.slice(start, i), 10);
    }
    const v = parseExpr();
    if (v === null) return null;
    skipWs();
    if (i !== n) return null; // 有剩余未消费字符（尾缀残缺 / 多余右括号 / 数字被空白隔断）
    if (!Number.isFinite(v)) return null;
    return v;
}
// <<< AUTHOR-PURE-END
