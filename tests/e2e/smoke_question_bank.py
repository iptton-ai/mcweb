# -*- coding: utf-8 -*-
"""我的题库（平铺录题）烟雾验证（2026-09-18 批次）：
QB-01 题库页 UI 全链（列表→新建→编辑→删除→Esc 关闭，localStorage 落盘）/
QB-02 游戏内「📋 我的题目」选题→双通过→题随草稿卡导出 /
QB-03 作者面板「📝 打开题库页」跳转与互斥（面板先收、题库页再开）。

跑法：cd tests/e2e && CDP_PORT=19401 python3 smoke_question_bank.py
"""

import json
import sys

import lib


# ---------------------------------------------------------------- QB-01 题库页 UI 全链
def qb_01(e2e):
    res = e2e.run(r"""
localStorage.removeItem('mcweb.authorQuestions.v1'); // 幂等：清掉上次运行的题库
const qb = await import(B+'questionBank.js');

// ---- 从首屏关卡列表进入题库页（ui 即前导注入的 ui.js 模块） ----
ui.openLevelList();
await sleep(100);
const bankBtn = document.getElementById('btn-level-bank');
bankBtn.click();
await sleep(100);
const panel = document.getElementById('question-bank');
const opened = {
  btnExists: !!bankBtn,
  visible: panel && !panel.classList.contains('hidden'),
  flag: S.questionBankOpen === true,
  emptyTip: panel && panel.textContent.indexOf('题库还是空的') >= 0,
};

// ---- 新建一题（选择题：science / 选项 3 条 / 点选第 2 项为正确项） ----
document.getElementById('btn-qb-new').click();
await sleep(50);
const setField = (sel, val, ev) => {
  const el = panel.querySelector(sel);
  el.value = val;
  el.dispatchEvent(new Event(ev, { bubbles: true }));
};
setField('[data-field="subject"]', 'science', 'change');
const choiceRadio = panel.querySelector('[data-field="kind"][value="choice"]');
choiceRadio.checked = true;
choiceRadio.dispatchEvent(new Event('change', { bubbles: true }));
await sleep(50);
setField('[data-field="stem"]', '水沸腾时的温度大约是？', 'input');
setField('[data-field="opt0"]', '60℃', 'input');
setField('[data-field="opt1"]', '100℃', 'input');
setField('[data-field="opt2"]', '120℃', 'input');
setField('[data-field="unit"]', '三上·水', 'input');
// 校验挡板：未点正确项直接保存 → 报错不落库
panel.querySelector('[data-act="save"]').click();
await sleep(50);
const blocked = {
  msgShown: panel.querySelector('.qb-msg').textContent.indexOf('正确项') >= 0,
  bankEmpty: qb.countBankQuestions() === 0,
};
// 点正确项后保存成功
panel.querySelector('[data-act="pickans"][data-i="1"]').click(); // 正确项 = 100℃
panel.querySelector('[data-act="save"]').click();
await sleep(50);
const saved = {
  backToList: panel.textContent.indexOf('➕ 新建题目') >= 0,
  rowShown: panel.textContent.indexOf('水沸腾时的温度大约是？') >= 0,
  count: qb.countBankQuestions(),
  lsRaw: !!localStorage.getItem('mcweb.authorQuestions.v1'),
};

// ---- 编辑：改题干保存 → 列表刷新 ----
panel.querySelector('[data-act="edit"]').click();
await sleep(50);
const prefilled = panel.querySelector('[data-field="stem"]').value;
setField('[data-field="stem"]', '标准大气压下，水沸腾时的温度大约是？', 'input');
panel.querySelector('[data-act="save"]').click();
await sleep(50);
const edited = {
  prefilled,
  rowUpdated: panel.textContent.indexOf('标准大气压下，水沸腾时的温度大约是？') >= 0,
};

// ---- 删除（二次确认；render 会重建行内按钮，每次重新查询） ----
panel.querySelector('[data-act="del"]').click();
await sleep(30);
const delBtn2 = panel.querySelector('[data-act="del"]');
const armed = delBtn2.textContent.indexOf('确认删除') >= 0;
delBtn2.click();
await sleep(30);
const deleted = {
  armed,
  gone: panel.textContent.indexOf('题库还是空的') >= 0 && qb.countBankQuestions() === 0,
  lsEmpty: JSON.parse(localStorage.getItem('mcweb.authorQuestions.v1') || '[]').length === 0,
};

// ---- Esc 关闭（input.js 分支）+ 标志位清零 ----
document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
await sleep(50);
const closed = {
  hidden: panel.classList.contains('hidden'),
  flag: S.questionBankOpen === false,
};
return JSON.stringify({ opened, blocked, saved, edited, deleted, closed });
""")
    if not isinstance(res, dict) or "opened" not in res:
        return lib.report("QB-01 题库页 UI 全链", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    o, b, s, ed, d, c = (res.get(k, {}) for k in ("opened", "blocked", "saved", "edited", "deleted", "closed"))
    checks = [
        ("关卡列表按钮进题库页", o.get("btnExists") and o.get("visible") and o.get("flag"), json.dumps(o)),
        ("空库提示展示", o.get("emptyTip") is True, str(o.get("emptyTip"))),
        ("校验挡板：未选正确项被拦", b.get("msgShown") and b.get("bankEmpty"), json.dumps(b)),
        ("新建保存：列表行 + localStorage 落盘", s.get("backToList") and s.get("rowShown") and s.get("count") == 1 and s.get("lsRaw"), json.dumps(s)),
        ("编辑回填 + 改后刷新", ed.get("prefilled") == "水沸腾时的温度大约是？" and ed.get("rowUpdated"), json.dumps(ed)),
        ("删除二次确认 + 删净", d.get("armed") and d.get("gone") and d.get("lsEmpty"), json.dumps(d)),
        ("Esc 关闭 + 标志位清零", c.get("hidden") and c.get("flag"), json.dumps(c)),
    ]
    return lib.report("QB-01 题库页 UI 全链", res, checks)


# ---------------------------------------------------------------- QB-02 游戏内选题→双通过→进卡
def qb_02(e2e):
    res = e2e.run(r"""
localStorage.removeItem('mcweb.authorQuestions.v1');
const [qb, le, ek] = await Promise.all([
  import(B+'questionBank.js'), import(B+'levelEditor.js'), import(B+'eduKeypad.js')]);
// 题库预置一题（模拟「平铺页录好的题」）
const seeded = qb.saveBankQuestion({ subject: 'math', kind: 'input', stem: '7×8', answer: 56, unit: '三上·烟雾' });

// ---- 进编辑器：答题门（答题机在 91,4,90）+ 旗组 ----
const okEnter = await le.enterLevelEditor(null, { name: '烟雾题库关' });
await tick(1);
await le.stampPrefabAt('quiz_door', { x: 90, y: 3, z: 90, face: { dx: 0, dy: 1, dz: 0 } });
await le.stampPrefabAt('flag_start', { x: 86, y: 3, z: 86, face: { dx: 0, dy: 1, dz: 0 } });
await le.stampPrefabAt('flag_goal', { x: 94, y: 3, z: 86, face: { dx: 0, dy: 1, dz: 0 } });
await tick(1);

// ---- 出题笔作者面板（直调右键入口）→ 📋 我的题目 → 选第 1 题 ----
ek.interactKeypadAuthorAt(91, 4, 90);
await sleep(80);
const panel = document.getElementById('edu-author');
const opened = {
  authorOpen: S.authorPanelOpen === true,
  mineBtn: !!panel.querySelector('[data-act="mine"]'),
};
panel.querySelector('[data-act="mine"]').click();
await sleep(50);
const pickView = {
  mode: ek && panel.textContent.indexOf('📋 我的题目') >= 0,
  rowShown: panel.textContent.indexOf('7×8') >= 0,
};
panel.querySelector('[data-act="pickmine"]').click();
await sleep(50);
const filled = {
  stem: panel.querySelector('[data-field="stem"]').value,
  ans: panel.querySelector('[data-field="ansIn"]').value,
  unit: panel.querySelector('[data-field="unit"]').value,
};

// ---- 保存并校验：数字题连对 2 次（5 6 ⏎ × 2） ----
panel.querySelector('[data-act="save"]').click();
await sleep(50);
const verifyMode = panel.textContent.indexOf('试答校验') >= 0;
const press = (code, key) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
press('Digit5', '5'); press('Digit6', '6'); press('Enter', 'Enter');
await sleep(60);
press('Digit5', '5'); press('Digit6', '6'); press('Enter', 'Enter');
await sleep(60);
const done = {
  verifyMode,
  doneView: panel.textContent.indexOf('已双通过') >= 0,
  lock: ek.getAuthoredLock(91, 4, 90),
};

// ---- 题随草稿卡导出（锁局部坐标 + verifiedPasses=2） ----
const card = await le.saveEditorDraft({ silent: true });
const cardQ = card && card.questions && card.questions[0];
const lws = await import(B+'levelWorkshop.js');
const draftInList = (await lws.listLevelCards()).some(c => c.name === '烟雾题库关');
// 清理：删掉本次草稿
if (draftInList) {
  const sum = (await lws.listLevelCards()).find(c => c.name === '烟雾题库关');
  await lws.deleteLevelCard(sum.id);
}
await le.exitLevelEditor({ saveDraft: false });
await sleep(400);
return JSON.stringify({
  seeded: seeded.ok,
  okEnter, opened, pickView, filled, done: {
    verifyMode: done.verifyMode, doneView: done.doneView,
    passes: done.lock && done.lock.verifiedPasses,
    stem: done.lock && done.lock.question.stem,
  },
  cardQ: cardQ ? { stem: cardQ.stem, answer: cardQ.answer, subject: cardQ.subject,
                   passes: cardQ.meta && cardQ.meta.verifiedPasses, source: cardQ.meta && cardQ.meta.source } : null,
  draftInList,
});
""")
    if not isinstance(res, dict) or "opened" not in res:
        return lib.report("QB-02 游戏内选题→双通过", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    o, p, f, dn, cq = (res.get(k) for k in ("opened", "pickView", "filled", "done", "cardQ"))
    checks = [
        ("题库预置 + 进编辑器", res.get("seeded") is True and res.get("okEnter") is True, f"seeded={res.get('seeded')} enter={res.get('okEnter')}"),
        ("作者面板 + 「📋 我的题目」按钮", o.get("authorOpen") and o.get("mineBtn"), json.dumps(o)),
        ("选择视图列出我的题", p.get("mode") and p.get("rowShown"), json.dumps(p)),
        ("选题回填表单（题干/答案/单元）", f.get("stem") == "7×8" and f.get("ans") == "56" and f.get("unit") == "三上·烟雾", json.dumps(f)),
        ("保存进试答校验态", dn.get("verifyMode") is True, str(dn.get("verifyMode"))),
        ("连对 2 次双通过", dn.get("doneView") is True and dn.get("passes") == 2, json.dumps(dn)),
        ("题随草稿卡（verifiedPasses=2, source=custom）", cq and cq.get("stem") == "7×8" and cq.get("answer") == 56 and cq.get("passes") == 2 and cq.get("source") == "custom", json.dumps(cq)),
    ]
    return lib.report("QB-02 游戏内选题→双通过", res, checks)


# ---------------------------------------------------------------- QB-03 作者面板 → 题库页跳转
def qb_03(e2e):
    res = e2e.run(r"""
localStorage.removeItem('mcweb.authorQuestions.v1');
const [le, ek] = await Promise.all([import(B+'levelEditor.js'), import(B+'eduKeypad.js')]);
const okEnter = await le.enterLevelEditor(null, { name: '跳转验证' });
await tick(1);
await le.stampPrefabAt('quiz_door', { x: 90, y: 3, z: 90, face: { dx: 0, dy: 1, dz: 0 } });
await tick(1);
ek.interactKeypadAuthorAt(91, 4, 90);
await sleep(80);
const panel = document.getElementById('edu-author');
panel.querySelector('[data-act="mine"]').click();
await sleep(50);
// 空库提示 + 「📝 打开题库页」按钮
const emptyPick = panel.textContent.indexOf('题库还是空的') >= 0;
const bankBtnInPick = !!panel.querySelector('[data-act="openbank"]');
panel.querySelector('[data-act="openbank"]').click();
await sleep(150);
const jumped = {
  authorClosed: S.authorPanelOpen === false,
  bankOpen: S.questionBankOpen === true,
  bankVisible: document.getElementById('question-bank') && !document.getElementById('question-bank').classList.contains('hidden'),
};
// 关题库页回编辑（Esc → input.js 分支）
document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q' }));
await sleep(50);
const backOut = { bankClosed: S.questionBankOpen === false };
await le.exitLevelEditor({ saveDraft: false });
await sleep(400);
return JSON.stringify({ okEnter, emptyPick, bankBtnInPick, jumped, backOut });
""")
    if not isinstance(res, dict) or "jumped" not in res:
        return lib.report("QB-03 作者面板→题库页跳转", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    j, b = res.get("jumped", {}), res.get("backOut", {})
    checks = [
        ("进编辑器 + 选择视图空库提示", res.get("okEnter") is True and res.get("emptyPick") is True, json.dumps({k: res.get(k) for k in ("okEnter", "emptyPick")})),
        ("「📝 打开题库页」按钮存在", res.get("bankBtnInPick") is True, str(res.get("bankBtnInPick"))),
        ("跳转：作者面板先收、题库页再开", j.get("authorClosed") and j.get("bankOpen") and j.get("bankVisible"), json.dumps(j)),
        ("Q 关题库页", b.get("bankClosed") is True, json.dumps(b)),
    ]
    return lib.report("QB-03 作者面板→题库页跳转", res, checks)


CASES = {"QB-01": qb_01, "QB-02": qb_02, "QB-03": qb_03}

if __name__ == "__main__":
    want = sys.argv[1:] or list(CASES)
    e2e = lib.E2E()
    ok = True
    try:
        for name in want:
            e2e.fresh_page()
            ok = CASES[name](e2e) and ok
    finally:
        e2e.close()
    sys.exit(0 if ok else 1)
