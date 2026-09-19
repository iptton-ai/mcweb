// ==================== questionBank.js ====================
// 我的题库（2026-09-18「平铺录题」批次）：关卡作者在普通 2D 浮层（questionBankUI.js）
// 里批量录入题目，游戏内出题笔作者面板（eduKeypad.js「📋 我的题目」）直接选入表单——
// 把打字录题从游戏内对话框挪到平铺页面，锁上只剩「选题 → 双通过」两步。
//
// 题目 schema 与关卡卡题级契约完全一致（docs/edu-workshop-impl-contract.md §2：
// subject/kind/stem/options?/answer/hint?/unit?），选入后仍走原「保存并校验 → 连对 2 次」
// 流程，导出门槛（verifiedPasses≥2）不变；meta.source 记 'custom'（作者自录，非教材题库抽取）。
// 题库全局共享（跨存档槽/跨世界）：录一次，任何关卡里都能选。
//
// 纯模块：零 import、无 DOM 依赖；localStorage 缺失（Node / 隐私模式）自动降级为
// 内存态（仅本次会话），Node 可直接 import 测试（tools/test_question_bank.mjs）。

export const BANK_KEY = 'mcweb.authorQuestions.v1';
// 学科枚举照契约 §2（validateLevelCard 硬校验同款五枚举；「自拟」只是出题面板的来源
// 标记不是学科，题库条目必须落具体学科）
export const BANK_SUBJECTS = ['math', 'science', 'daofa', 'yuwen', 'english'];
export const BANK_SUBJECT_META = {
    math: { emoji: '🧮', name: '数学' },
    science: { emoji: '🔬', name: '科学' },
    daofa: { emoji: '🧭', name: '道法' },
    yuwen: { emoji: '📖', name: '语文' },
    english: { emoji: '🔤', name: '英语' },
};
// 容量上限：localStorage 单 key 保护（一道题 ~200 字节，500 道绰绰有余且远撞不了 5MB 配额）
export const MAX_BANK_QUESTIONS = 500;

// 内存镜像（读写全走它，localStorage 只在 load/persist 两处触达）
let cache = null;

function lsAvailable() {
    try {
        return typeof localStorage !== 'undefined' && !!localStorage;
    } catch {
        return false; // 隐私模式等访问即抛的环境
    }
}

function loadBank() {
    if (cache) return cache;
    cache = [];
    if (!lsAvailable()) return cache;
    try {
        const raw = localStorage.getItem(BANK_KEY);
        if (!raw) return cache;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
            // 逐条过校验：手改/旧版本的坏数据条目直接丢弃，不拖垮整个题库
            for (const it of arr) {
                if (it && typeof it === 'object' && validateBankQuestion(it).ok) cache.push(it);
            }
        }
    } catch {
        cache = []; // JSON 损坏：当空库（绝不抛错阻塞玩法）
    }
    return cache;
}

function persist() {
    if (!lsAvailable()) return false;
    try {
        localStorage.setItem(BANK_KEY, JSON.stringify(cache));
        return true;
    } catch {
        return false; // 配额满等：保存失败由调用方提示，内存态仍可用
    }
}

// ---------- 校验（与出题面板 saveAuthoredQuestion / 契约 §2 同规则） ----------

// validateBankQuestion(q) → { ok, errors[] }。hint/unit 可选字符串；其余必填。
export function validateBankQuestion(q) {
    const errors = [];
    if (!q || typeof q !== 'object' || Array.isArray(q)) {
        return { ok: false, errors: ['不是有效的题目对象'] };
    }
    if (!BANK_SUBJECTS.includes(q.subject)) errors.push('学科必须是：' + BANK_SUBJECTS.join('/'));
    const kind = q.kind === 'choice' ? 'choice' : (q.kind === 'input' ? 'input' : null);
    if (!kind) errors.push('题型必须是 input（数字输入）或 choice（选择）');
    if (typeof q.stem !== 'string' || !q.stem.trim()) errors.push('题干不能为空');
    if (q.hint !== undefined && q.hint !== null && typeof q.hint !== 'string') errors.push('hint 必须是字符串');
    if (q.unit !== undefined && q.unit !== null && typeof q.unit !== 'string') errors.push('unit 必须是字符串');
    if (kind === 'input') {
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 9999) {
            errors.push('数字题答案必须是 0..9999 的整数');
        }
    } else if (kind === 'choice') {
        const opts = q.options;
        if (!Array.isArray(opts) || opts.length < 3 || opts.length > 4) {
            errors.push('选项必须 3~4 条');
        } else {
            const clean = opts.map((o) => String(o ?? '').trim());
            if (clean.some((o) => !o)) errors.push('选项不能为空');
            if (new Set(clean).size !== clean.length) errors.push('选项内容重复');
            if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= opts.length) {
                errors.push('正确项索引非法');
            }
        }
    }
    return { ok: errors.length === 0, errors };
}

// 只保留已知字段并规范形状（trim 题干/选项/hint/unit），保证入库数据干净、cardHash 稳定
function normalizeQuestion(q) {
    const out = { subject: q.subject, kind: q.kind === 'choice' ? 'choice' : 'input', stem: q.stem.trim() };
    if (out.kind === 'choice') {
        out.options = q.options.map((o) => String(o).trim());
        out.answer = q.answer;
    } else {
        out.answer = q.answer;
    }
    const hint = typeof q.hint === 'string' ? q.hint.trim() : '';
    const unit = typeof q.unit === 'string' ? q.unit.trim() : '';
    if (hint) out.hint = hint;
    if (unit) out.unit = unit;
    return out;
}

// ---------- CRUD ----------

// 列表（新题在前；返回浅拷贝数组，条目为库内引用——调用方只读，改动请走 saveBankQuestion）
export function listBankQuestions() {
    return loadBank().slice();
}

export function countBankQuestions() {
    return loadBank().length;
}

export function getBankQuestion(id) {
    return loadBank().find((it) => it.id === id) || null;
}

// 新增或按 id 更新。返回 { ok, entry?, error?, persisted? }。
// 更新时保留 id 与 created，刷新 updated；新增时生成 id 并置队首（新题在前）。
export function saveBankQuestion(input) {
    const v = validateBankQuestion(input);
    if (!v.ok) return { ok: false, error: v.errors[0], errors: v.errors };
    const bank = loadBank();
    const now = new Date().toISOString();
    const clean = normalizeQuestion(input);
    if (input.id) {
        const old = bank.find((it) => it.id === input.id);
        if (!old) return { ok: false, error: '要编辑的题目不存在（可能已被删除）' };
        // 整条替换（不 Object.assign）：题型切换（choice↔input）或选填字段清空时，
        // 旧形状的键（options/hint/unit…）不能残留
        const entry = { ...clean, id: old.id, created: old.created, updated: now };
        bank[bank.indexOf(old)] = entry;
        persist();
        return { ok: true, entry, persisted: lsAvailable() };
    }
    if (bank.length >= MAX_BANK_QUESTIONS) {
        return { ok: false, error: `题库已满（上限 ${MAX_BANK_QUESTIONS} 条），请先清理不需要的题目` };
    }
    const entry = {
        ...clean,
        id: 'q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        created: now,
        updated: now,
    };
    bank.unshift(entry);
    persist();
    return { ok: true, entry, persisted: lsAvailable() };
}

// 删除；返回是否真的删了
export function deleteBankQuestion(id) {
    const bank = loadBank();
    const i = bank.findIndex((it) => it.id === id);
    if (i < 0) return false;
    bank.splice(i, 1);
    persist();
    return true;
}
