// ==================== questionBankUI.js ====================
// 「📝 我的题库」平铺录题页（2026-09-18）：普通 2D 浮层（.lvl-overlay 骨架 + .qb- 专属样式），
// 出题不再必须在游戏内打字——首屏「🗺 关卡 → 📝 题目库」或编辑器 HUD 的「📝 题目库」进入，
// 批量录入/编辑/删除题目（数据在 js/questionBank.js，localStorage 全局共享）。
// 游戏内出题笔作者面板的「📋 我的题目」从这里选题（eduKeypad.js），双通过导出门槛不变。
//
// 指针策略照组件库/导出面板的非暂停浮层模式：state.questionBankOpen + syncPointerPolicy
// ——打开即释放鼠标点表单，关闭走既有自动回锁；Esc/Q 关面板（input.js 接线，同组件库）。
// 键盘导航：uiKeys.js 范围表首位的 #question-bank 范围（原生控件 + 几何导航，零特殊接线）。

import { state } from './state.js';
import { syncPointerPolicy, clearStuckKeys, onUIStateChange } from './uiModal.js';
import { uiKick } from './uiKeys.js';
import {
    BANK_SUBJECTS, BANK_SUBJECT_META, MAX_BANK_QUESTIONS,
    deleteBankQuestion, listBankQuestions, saveBankQuestion,
} from './questionBank.js';
import { isLevelRunActive } from './levelRun.js'; // 闯关态隔离：与出题面板同守卫（W11 同源）

const QB_STYLE = `
/* 显隐自足（不依赖 ui.js 先注入的 .lvl-overlay 对齐规则）：hidden 一律隐藏，否则显示 */
#question-bank.hidden{display:none !important;}
#question-bank:not(.hidden){display:flex;}
#question-bank{z-index:72;} /* 高于出题面板(62)/组件库(70)：从「📋 我的题目 → 打开题库页」进入时盖在游戏浮层上 */
#question-bank .lvl-panel{width:min(94vw,680px);max-height:86vh;display:flex;flex-direction:column;}
#qb-body{overflow-y:auto;min-height:120px;}
#qb-body::-webkit-scrollbar{width:8px;}
#qb-body::-webkit-scrollbar-thumb{background:#44475a;border-radius:4px;}
.qb-count{color:#9a9ab8;font-size:12px;margin:2px 4px 8px;}
.qb-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;
 background:rgba(48,53,65,.6);border:1px solid #44475a;margin-bottom:6px;}
.qb-row .qb-main{flex:1;min-width:0;}
.qb-row .qb-stem{color:#edf0f7;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.qb-row .qb-meta{color:#9a9ab8;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.qb-row .qb-btns{display:flex;gap:6px;flex:none;}
.qb-row button{border:1px solid #565a67;border-radius:8px;background:#303541;color:#edf0f7;
 cursor:pointer;font:inherit;padding:5px 9px;white-space:nowrap;}
.qb-row button:hover{border-color:#acd58c;background:#404958;}
.qb-row button.qb-del-armed{background:#7f2933;border-color:#c95460;color:#fff;font-weight:650;}
.qb-empty{color:#9a9ab8;font-size:13px;text-align:center;padding:22px 0;}
.qb-form .qb-frow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;font-size:13px;color:#b8c4d0;}
.qb-form input[type=text],.qb-form textarea,.qb-form select{
 background:#20242e;color:#edf0f7;border:1px solid #565a67;border-radius:8px;
 font:inherit;font-size:13px;padding:5px 8px;}
.qb-form textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:46px;}
.qb-form .qb-optrow{display:flex;gap:6px;align-items:center;width:100%;}
.qb-form .qb-optrow input{flex:1;}
.qb-form .qb-pick{min-width:34px;padding:5px 8px;}
.qb-form .qb-pick.ok{border-color:#39d353;color:#39d353;}
.qb-form .qb-msg{color:#ffd77a;font-size:13px;min-height:18px;margin:4px 0;}
.qb-form label{display:inline-flex;align-items:center;gap:4px;cursor:pointer;}
`;

let styleInjected = false;
let panel = null;          // #question-bank 根元素
let bound = false;

// 面板当前视图：list 列表 / form 表单（新建与编辑共用）
let view = { mode: 'list', editId: null, form: null, msg: '', delArmedId: null };

function escAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ensureDom() {
    if (!styleInjected) {
        styleInjected = true;
        const style = document.createElement('style');
        style.textContent = QB_STYLE;
        document.head.appendChild(style);
    }
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'question-bank';
        panel.className = 'lvl-overlay hidden';
        panel.innerHTML = `<div class="lvl-panel">
          <div class="lvl-head"><h3>📝 我的题库</h3>
            <button class="lvl-close" id="qb-close" title="关闭">✕</button></div>
          <div class="lvl-sub">在这里平铺录入题目（存进浏览器，跨世界共用）。游戏内手持 ✏️ 出题笔右键答题机 → 「📋 我的题目」直接选入；每把锁仍要连答对 2 次完成双通过才能导出。</div>
          <div id="qb-body"></div></div>`;
        document.body.appendChild(panel);
        // 事件委托到根元素（innerHTML 重渲染不丢监听）；文本只认 input、select/radio 只认 change
        panel.addEventListener('click', onQBClick);
        panel.addEventListener('input', onQBField);
        panel.addEventListener('change', onQBField);
        panel.addEventListener('click', (e) => { if (e.target === panel) closeQuestionBank(); });
        document.getElementById('qb-close')?.addEventListener('click', (e) => {
            e.stopPropagation();
            closeQuestionBank();
        });
        // 离开首屏/游戏态（进背包、暂停、结算等）自动收起，照关卡列表的联动惯例
        onUIStateChange((_prev, next) => {
            if (next !== 'title' && next !== 'playing' && state.questionBankOpen) closeQuestionBank();
        });
    }
    return panel;
}

export function isQuestionBankOpen() {
    return !!state.questionBankOpen;
}

export function openQuestionBank() {
    if (isLevelRunActive()) {
        // 闯关模式隔离（同出题面板 interactKeypadAuthorAt 的拒绝语义）：闯关中不开作者工具
        import('./ui.js').then(({ showTooltip }) => showTooltip('🗺 闯关中不能编辑题目，退出关卡再来'));
        return;
    }
    ensureDom();
    view = { mode: 'list', editId: null, form: null, msg: '', delArmedId: null };
    panel.classList.remove('hidden');
    state.questionBankOpen = true;
    syncPointerPolicy(); // 打开即释放鼠标（标题屏本就未锁，无副作用）
    clearStuckKeys();
    render();
    uiKick(); // 键盘导航落焦：首个非文本元素（➕ 新建题目）
}

export function closeQuestionBank() {
    if (panel) panel.classList.add('hidden');
    state.questionBankOpen = false;
    syncPointerPolicy(); // 全关 → 走 uiModal 既有自动回锁链路
    clearStuckKeys();
}

// ==================== 列表视图 ====================

function subjectLabel(subject) {
    const m = BANK_SUBJECT_META[subject] || { emoji: '📚', name: subject };
    return `${m.emoji} ${m.name}`;
}

function answerPreview(q) {
    if (q.kind === 'input') return `答：${q.answer}`;
    return `答：${'①②③④'[q.answer] || '?'} ${q.options[q.answer] || ''}`;
}

function renderList() {
    const bank = listBankQuestions();
    const rows = bank.map((q) => `
      <div class="qb-row" data-id="${escAttr(q.id)}">
        <div class="qb-main">
          <div class="qb-stem">${escAttr(q.stem)}</div>
          <div class="qb-meta">${subjectLabel(q.subject)} · ${q.kind === 'choice' ? '三~四选一' : '数字输入'} · ${escAttr(answerPreview(q))}${q.unit ? ' · ' + escAttr(q.unit) : ''}</div>
        </div>
        <div class="qb-btns">
          <button data-act="edit" data-id="${escAttr(q.id)}" title="编辑">✏️</button>
          <button data-act="del" data-id="${escAttr(q.id)}" class="${view.delArmedId === q.id ? 'qb-del-armed' : ''}">${view.delArmedId === q.id ? '确认删除？' : '✕'}</button>
        </div>
      </div>`).join('');
    return `
      <div class="qb-count">共 ${bank.length} 题${bank.length >= MAX_BANK_QUESTIONS ? '（已达上限）' : ''}</div>
      ${rows || '<div class="qb-empty">题库还是空的——点「➕ 新建题目」录入第一题</div>'}
      <div class="lvl-actions"><button class="save-btn" id="btn-qb-new">➕ 新建题目</button></div>`;
}

// ==================== 表单视图（新建 / 编辑共用） ====================

function blankForm() {
    return { subject: 'math', kind: 'input', stem: '', options: ['', '', ''], answerIdx: -1, ansRaw: '', hint: '', unit: '' };
}

// 库条目 → 表单形状（编辑回填）
function entryToForm(q) {
    const f = blankForm();
    f.subject = BANK_SUBJECTS.includes(q.subject) ? q.subject : 'math';
    f.kind = q.kind === 'choice' ? 'choice' : 'input';
    f.stem = q.stem || '';
    if (f.kind === 'choice') {
        f.options = (q.options || []).map(String).slice(0, 4);
        while (f.options.length < 3) f.options.push('');
        f.answerIdx = q.answer | 0;
    } else {
        f.ansRaw = String(q.answer ?? '');
    }
    f.hint = q.hint || '';
    f.unit = q.unit || '';
    return f;
}

function renderForm() {
    const f = view.form;
    const editing = !!view.editId;
    const subjectOpts = BANK_SUBJECTS.map((s) =>
        `<option value="${s}"${f.subject === s ? ' selected' : ''}>${subjectLabel(s)}</option>`).join('');
    const kindRadio = (val, label) =>
        `<label><input type="radio" name="qb-kind" data-field="kind" value="${val}"${f.kind === val ? ' checked' : ''}> ${label}</label>`;
    let body;
    if (f.kind === 'input') {
        body = `
        <div class="qb-frow">正确答案（0..9999）<input type="text" inputmode="numeric" maxlength="4"
            data-field="ansIn" value="${escAttr(f.ansRaw)}" style="width:90px" placeholder="0..9999"></div>`;
    } else {
        const rows = f.options.map((o, i) => `
          <div class="qb-optrow">
            <button class="qb-pick${f.answerIdx === i ? ' ok' : ''}" data-act="pickans" data-i="${i}"
                title="点选为正确项">${f.answerIdx === i ? '✓' : i + 1}</button>
            <input type="text" data-field="opt${i}" value="${escAttr(o)}" placeholder="选项 ${i + 1}">
            <button data-act="optdel" data-i="${i}"${f.options.length <= 3 ? ' disabled' : ''} title="删除该选项">✕</button>
          </div>`).join('');
        body = `
        <div class="qb-frow">选项 3~4 条（点左侧编号选定正确项，正确项与干扰项不能重名）</div>
        ${rows}
        <div class="qb-frow"><button data-act="optadd"${f.options.length >= 4 ? ' disabled' : ''}>＋ 添加选项</button></div>`;
    }
    return `
      <div class="qb-form">
        <div class="qb-frow">
          <label>学科 <select data-field="subject">${subjectOpts}</select></label>
          ${kindRadio('input', '数字输入')}
          ${kindRadio('choice', '三~四选一')}
        </div>
        <div class="qb-frow" style="width:100%"><textarea data-field="stem"
            placeholder="题干（数学算式直接写，如 3×4+5；选择题写完整问句）">${escAttr(f.stem)}</textarea></div>
        ${body}
        <div class="qb-frow" style="width:100%">
          <input type="text" data-field="hint" value="${escAttr(f.hint)}" placeholder="答错提示（选填）" style="flex:1">
          <input type="text" data-field="unit" value="${escAttr(f.unit)}" placeholder="单元标签（选填）" style="flex:1">
        </div>
        <div class="qb-msg">${escAttr(view.msg || '')}</div>
        <div class="lvl-actions">
          <button class="save-btn" data-act="save" style="font-size:14px">💾 保存题目</button>
          <button class="save-btn" data-act="back">↩ 返回列表</button>
        </div>
      </div>`;
}

function render() {
    if (!panel) return;
    const body = panel.querySelector('#qb-body');
    if (body) body.innerHTML = view.mode === 'list' ? renderList() : renderForm();
}

// ==================== 事件（委托） ====================

function onQBClick(e) {
    const btn = e.target.closest('[data-act], #btn-qb-new');
    if (!btn || btn.disabled) return;
    if (btn.id === 'btn-qb-new') {
        view = { mode: 'form', editId: null, form: blankForm(), msg: '', delArmedId: null };
        render();
        return;
    }
    const act = btn.dataset.act;
    if (act === 'edit') {
        const q = getBankQuestionSafe(btn.dataset.id);
        if (q) {
            view = { mode: 'form', editId: q.id, form: entryToForm(q), msg: '', delArmedId: null };
            render();
        }
    } else if (act === 'del') {
        const id = btn.dataset.id;
        if (view.delArmedId === id) {
            deleteBankQuestion(id);
            view.delArmedId = null;
        } else {
            view.delArmedId = id;
            setTimeout(() => { if (view.delArmedId === id) { view.delArmedId = null; render(); } }, 2500);
        }
        render();
    } else if (view.mode !== 'form') {
        return;
    } else if (act === 'back') {
        view.mode = 'list';
        view.msg = '';
        render();
    } else if (act === 'save') {
        saveForm();
    } else if (act === 'pickans') {
        const i = Number(btn.dataset.i);
        if (i >= 0 && i < view.form.options.length) {
            view.form.answerIdx = i;
            view.msg = '';
            render();
        }
    } else if (act === 'optadd') {
        if (view.form.options.length < 4) {
            view.form.options.push('');
            render();
        }
    } else if (act === 'optdel') {
        const i = Number(btn.dataset.i);
        const f = view.form;
        if (f.options.length > 3 && i >= 0 && i < f.options.length) {
            f.options.splice(i, 1);
            if (i < f.answerIdx) f.answerIdx--;           // 正确项索引随删项左移
            else if (i === f.answerIdx) f.answerIdx = -1; // 删的是正确项 → 必须重新点选
            render();
        }
    }
}

// 表单字段：文本只认 input、select/radio 只认 change（同出题面板，防一次操作触发两遍）
function onQBField(e) {
    if (view.mode !== 'form') return;
    const el = e.target;
    if (!el.dataset || !el.dataset.field) return;
    const isTextish = (el.tagName === 'INPUT' && el.type === 'text') || el.tagName === 'TEXTAREA';
    if ((e.type === 'input') !== isTextish) return;
    const f = view.form;
    switch (el.dataset.field) {
        case 'subject':
            f.subject = el.value;
            break;
        case 'kind': {
            const kind = el.value === 'choice' ? 'choice' : 'input';
            if (kind !== f.kind) {
                f.kind = kind;
                f.answerIdx = f.kind === 'choice' ? -1 : f.answerIdx;
                render();
            }
            break;
        }
        case 'stem':
            f.stem = el.value;
            break;
        case 'hint':
            f.hint = el.value;
            break;
        case 'unit':
            f.unit = el.value;
            break;
        case 'ansIn': {
            const clean = el.value.replace(/\D/g, '').slice(0, 4); // 只收数字、上限 4 位
            if (clean !== el.value) el.value = clean;
            f.ansRaw = clean;
            break;
        }
        default: {
            const m = /^opt(\d)$/.exec(el.dataset.field);
            if (m) {
                const i = Number(m[1]);
                if (i >= 0 && i < f.options.length) f.options[i] = el.value;
            }
        }
    }
}

function getBankQuestionSafe(id) {
    return listBankQuestions().find((q) => q.id === id) || null;
}

// 保存（校验在 questionBank.validateBankQuestion，与出题面板/导出校验同规则）
function saveForm() {
    const f = view.form;
    const payload = {
        id: view.editId || undefined,
        subject: f.subject,
        kind: f.kind,
        stem: f.stem,
        options: f.kind === 'choice' ? f.options : undefined,
        // 空串显式转 NaN（Number('')===0 会把没填答案静默当成 0 过校验）
        answer: f.kind === 'choice' ? f.answerIdx
            : (f.ansRaw.trim() === '' ? NaN : Number(f.ansRaw)),
        hint: f.hint,
        unit: f.unit,
    };
    const r = saveBankQuestion(payload);
    if (!r.ok) {
        view.msg = '❌ ' + (r.error || '保存失败');
        render();
        return;
    }
    view = { mode: 'list', editId: null, form: null, msg: '', delArmedId: null };
    render();
}
