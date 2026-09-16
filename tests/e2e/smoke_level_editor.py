# -*- coding: utf-8 -*-
"""关卡编辑器烟雾验证（2026-09-16 界面化建关批次）：
组件库几何落世界 / 新建空白关卡全链（存稿草稿·退出恢复）/ 官方卡改副本（锁题种子）/
模板库（真实 IndexedDB v2 store）/ 编辑·闯关互斥守卫。

跑法：cd tests/e2e && CDP_PORT=19401 python3 smoke_level_editor.py
"""

import json
import sys

import lib


# ---------------------------------------------------------------- ED-01 模块图与组件库
def ed_01(e2e):
    res = e2e.run(r"""
const [le, lp] = await Promise.all([import(B+'levelEditor.js'), import(B+'levelPrefabs.js')]);
const exp = {
  le: ['enterLevelEditor','exitLevelEditor','tickLevelEditor','saveEditorDraft',
       'startPlacing','consumePlaceClick','stampPrefabAt','isLevelEditorActive'].every(k=>typeof le[k]==='function'),
  lp: typeof lp.PREFABS === 'object' && typeof lp.buildPrefabCells === 'function',
};
// 组件库逐个展开成功且非空
const details = lp.PREFABS.map(p => {
  const r = lp.buildPrefabCells(p);
  return { id: p.id, ok: !r.error && r.cells.length > 0, err: r.error || '' };
});
const bad = details.filter(d => !d.ok);
return JSON.stringify({ exp, count: lp.PREFABS.length, bad, cats: lp.listPrefabCats() });
""")
    if not isinstance(res, dict):
        return lib.report("ED-01 模块图与组件库", {"__error__": str(res)[:500]}, [])
    checks = [
        ("levelEditor/levelPrefabs 导出齐全", res.get("exp", {}).get("le") is True and res.get("exp", {}).get("lp") is True, json.dumps(res.get("exp"))),
        ("组件数量 ≥ 10", res.get("count", 0) >= 10, str(res.get("count"))),
        ("全部组件几何展开无错", not res.get("bad"), json.dumps(res.get("bad"))[:200]),
        ("分类含 旗标/锁具机关/结构", set(res.get("cats", [])) >= {"旗标", "锁具机关", "结构"}, json.dumps(res.get("cats"))),
    ]
    return lib.report("ED-01 模块图与组件库", res, checks)


# ---------------------------------------------------------------- ED-02 新建空白关卡全链
def ed_02(e2e):
    res = e2e.run(r"""
const [le, lp, lws] = await Promise.all([
  import(B+'levelEditor.js'), import(B+'levelPrefabs.js'), import(B+'levelWorkshop.js')]);
// 原世界签名：记录一个块，退出编辑后必须恢复
const sig = { x: 64, y: 20, z: 64, v: gb(64, 20, 64) };
const origMode = S.gameMode;
const origTime = S.time;

// ---- 进编辑器（空白关） ----
const okEnter = await le.enterLevelEditor(null, { name: '烟雾测试关' });
await tick(2);
const during = {
  okEnter, active: le.isLevelEditorActive(),
  name: S.levelEdit && S.levelEdit.name,
  mode: S.gameMode,
  noon: S.time === S.dayLength / 2,
  ground: gb(88, 3, 88), grassConst: BT.GRASS,
  bedrock: gb(88, 0, 88),
  playerAt: { x: Math.round(S.player.x), y: Math.round(S.player.y) },
  hudVisible: document.getElementById('editor-hud') && document.getElementById('editor-hud').classList.contains('visible'),
};
// ---- 存档防线：编辑中 saveGame 拒写 ----
during.saveBlocked = sg.saveGame() === false;

// ---- 组件盖章：答题门（props，命中地面顶面） ----
const okDoor = await le.stampPrefabAt('quiz_door', { x: 90, y: 3, z: 90, face: { dx: 0, dy: 1, dz: 0 } });
await tick(2);
// origin = (90,4,90) - anchor(1,0,0) = (89,4,90)；门下半 (90,4,90)，答题机 (91,4,90)
during.door = {
  placed: !!okDoor,
  lower: gb(90, 4, 90), lowerExpect: cfg.doorId(0, 0, 2),
  keypad: gb(91, 4, 90), keypadConst: cfg.KEYPAD_BASE,
};
// 贴门锁联动：答题机翻成已解锁（答对）→ 红石重算 → 门开
sb(91, 4, 90, cfg.keypadId(1));
rs.updateRedstoneNetwork();
await tick(3);
during.door.openAfterSolve = cfg.doorOpen(gb(90, 4, 90)) === 1;
sb(91, 4, 90, cfg.keypadId(0)); // 还原锁定（不能把已解锁机留进草稿）
rs.updateRedstoneNetwork();

// ---- 放旗组 + 存草稿 ----
await le.stampPrefabAt('flag_start', { x: 86, y: 3, z: 86, face: { dx: 0, dy: 1, dz: 0 } });
await le.stampPrefabAt('flag_goal', { x: 94, y: 3, z: 86, face: { dx: 0, dy: 1, dz: 0 } });
await tick(1);
during.flags = {
  start: gb(86, 4, 86) === cfg.FLAG_BASE + cfg.FLAG_START,
  goal: gb(94, 4, 86) === cfg.FLAG_BASE + cfg.FLAG_GOAL,
};
const draft = await le.saveEditorDraft({ silent: true });
during.draftSaved = !!(draft && draft.meta && draft.meta.draft);
during.draftName = draft && draft.name;
// 列表接口返回摘要（无 meta 字段）：按名命中 + 全卡核对 draft 标记
const cards = await lws.listLevelCards();
const sum = cards.find(c => c.name === '烟雾测试关');
during.inList = !!sum;
if (sum) {
  const full = await lws.getLevelCard(sum.id);
  during.inListDraft = !!(full && full.meta && full.meta.draft);
}

// ---- 退出编辑器：恢复原世界 ----
const okExit = await le.exitLevelEditor({ saveDraft: true });
await sleep(600); await tick(2);
const after = {
  okExit, active: le.isLevelEditorActive(),
  restored: gb(sig.x, sig.y, sig.z) === sig.v,
  mode: S.gameMode, origMode,
  saveOk: sg.saveGame() === true,
};

// 闯关互斥：编辑态下 enterLevel 必须拒绝（先进编辑器放旗组造一张可进卡）
const reEnter = await le.enterLevelEditor(null, { name: '互斥验证' });
await le.stampPrefabAt('flag_start', { x: 86, y: 3, z: 86, face: { dx: 0, dy: 1, dz: 0 } });
await le.stampPrefabAt('flag_goal', { x: 94, y: 3, z: 86, face: { dx: 0, dy: 1, dz: 0 } });
await tick(1);
const lr = await import(B+'levelRun.js');
const card = await lws.buildLevelCard({ name: '互斥卡', author: 't', draft: true });
const enterRejected = card && !card.error ? (await lr.enterLevel(card)) === null : false;
const editorStill = le.isLevelEditorActive() && !S.levelRun;
await le.exitLevelEditor({ saveDraft: true });
await sleep(400);

return JSON.stringify({ during, after, mutual: { reEnter, enterRejected, editorStill } });
""")
    if not isinstance(res, dict) or "during" not in res:
        return lib.report("ED-02 新建空白关卡全链", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    d, a, m = res["during"], res["after"], res.get("mutual", {})
    door = d.get("door", {})
    checks = [
        ("进编辑器成功 + 会话激活", d.get("okEnter") is True and d.get("active") is True, json.dumps({k: d.get(k) for k in ('okEnter', 'active', 'name')})),
        ("强制创造 + 正午 + 地基层", d.get("mode") == "creative" and d.get("noon") is True and d.get("ground") == d.get("grassConst"), f"mode={d.get('mode')} noon={d.get('noon')} ground={d.get('ground')}"),
        ("编辑器 HUD 可见", d.get("hudVisible") is True, str(d.get("hudVisible"))),
        ("编辑中 saveGame 拒写", d.get("saveBlocked") is True, str(d.get("saveBlocked"))),
        ("答题门盖章落世界", door.get("placed") is True and door.get("lower") == door.get("lowerExpect") and door.get("keypad") == door.get("keypadConst"), f"lower={door.get('lower')} keypad={door.get('keypad')}"),
        ("贴门锁联动：答对门开", door.get("openAfterSolve") is True, str(door.get("openAfterSolve"))),
        ("旗组盖章 + 草稿落库", d.get("flags", {}).get("start") is True and d.get("flags", {}).get("goal") is True and d.get("draftSaved") is True and d.get("inList") is True and d.get("inListDraft") is True, json.dumps(d.get("flags")) + f" draft={d.get('draftSaved')} inList={d.get('inList')}/{d.get('inListDraft')}"),
        ("退出恢复原世界与写档", a.get("okExit") is True and a.get("active") is False and a.get("restored") is True and a.get("saveOk") is True, json.dumps(a)),
        ("编辑态下闯关进入被拒", m.get("enterRejected") is True and m.get("editorStill") is True, json.dumps(m)),
    ]
    return lib.report("ED-02 新建空白关卡全链", res, checks)


# ---------------------------------------------------------------- ED-03 官方卡改副本
def ed_03(e2e):
    res = e2e.run(r"""
const [le, lws, ek] = await Promise.all([
  import(B+'levelEditor.js'), import(B+'levelWorkshop.js'), import(B+'eduKeypad.js')]);
const builtins = await lws.listBuiltinLevelCards();
if (!builtins.length) return JSON.stringify({ __error__: 'assets/levels 缺失，无法验证改副本' });
const card = builtins[0];
const origName = card.name || '';
const copy = JSON.parse(JSON.stringify(card)); // 改副本 = 深拷贝，原卡不动
const okEnter = await le.enterLevelEditor(copy, { name: '副本·' + origName, templateName: origName });
// 出生点断言必须在物理 tick 之前：旗格非实心，玩家会被重力沉到地面
const spawnPos = { x: S.player.x, y: S.player.y, z: S.player.z };
await tick(2);
const run = {
  okEnter, active: le.isLevelEditorActive(),
  name: S.levelEdit && S.levelEdit.name,
  spawnFlag: null, spawn: S.levelEdit ? null : null,
};
// 出生点 = 起点旗世界块坐标（玩家进场时被放在旗格 +0.5/+1）
const spawn = { x: Math.floor(spawnPos.x), y: Math.round(spawnPos.y) - 1, z: Math.floor(spawnPos.z) };
run.spawnFlag = { id: gb(spawn.x, spawn.y, spawn.z), expect: cfg.FLAG_BASE + cfg.FLAG_START, at: spawn };
// 锁题种子：卡内第一把锁的题应已回到作者锁表（免重出题）
const q = (card.questions || [])[0];
if (q) {
  const wpt = lws.localToWorld(q.x, q.y, q.z);
  const got = ek.getAuthoredLock(wpt.x, wpt.y, wpt.z);
  run.seed = { has: !!(got && got.question), passes: got ? got.verifiedPasses : 0, stem: got && got.question ? got.question.stem.slice(0, 12) : '' };
}
// 草稿已自动保存为副本名
await sleep(300);
run.draftInList = (await lws.listLevelCards()).some(c => c.name === '副本·' + origName);
const okExit = await le.exitLevelEditor({ saveDraft: true });
await sleep(500);
run.exitOk = okExit && !le.isLevelEditorActive();
return JSON.stringify(run);
""")
    if not isinstance(res, dict) or "okEnter" not in res:
        return lib.report("ED-03 官方卡改副本", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    sf = res.get("spawnFlag", {})
    seed = res.get("seed")
    checks = [
        ("进编辑器嵌入官方卡", res.get("okEnter") is True and res.get("active") is True, json.dumps({k: res.get(k) for k in ('okEnter', 'name')})),
        ("出生点落在起点旗", sf.get("id") == sf.get("expect"), json.dumps(sf)),
    ]
    if seed is not None:
        checks.append(("锁题种子免重出题", seed.get("has") is True and seed.get("passes", 0) >= 2, json.dumps(seed)))
    checks += [
        ("副本草稿已入库", res.get("draftInList") is True, str(res.get("draftInList"))),
        ("退出恢复", res.get("exitOk") is True, str(res.get("exitOk"))),
    ]
    return lib.report("ED-03 官方卡改副本", res, checks)


# ---------------------------------------------------------------- ED-04 模板库（真实 IndexedDB）
def ed_04(e2e):
    res = e2e.run(r"""
const lws = await import(B+'levelWorkshop.js');
// 造一张合法小卡（起终点旗 + 平台）
for (let x = 40; x < 50; x++) for (let z = 40; z < 50; z++) sb(x, 20, z, BT.STONE);
sb(42, 21, 42, cfg.FLAG_BASE + cfg.FLAG_START);
sb(47, 21, 47, cfg.FLAG_BASE + cfg.FLAG_GOAL);
const card = await lws.buildLevelCard({ name: '模板源卡', author: 'smoke' });
if (!card || card.error) return JSON.stringify({ __error__: 'buildLevelCard: ' + (card && card.error) });
const saved = await lws.saveLevelTemplate(JSON.parse(JSON.stringify(card)));
const list1 = await lws.listLevelTemplates();
const got = await lws.getLevelTemplate(saved.id);
// 同内容再存 = 同 id 覆盖
const again = await lws.saveLevelTemplate(JSON.parse(JSON.stringify(card)));
const list2 = await lws.listLevelTemplates();
const del = await lws.deleteLevelTemplate(saved.id);
const list3 = await lws.listLevelTemplates();
return JSON.stringify({
  ok: saved.ok, idPrefix: saved.id.slice(0, 4), sessionOnly: !!saved.sessionOnly,
  listed: list1.some(t => t.id === saved.id),
  gotName: got && got.name,
  overwrite: again.id === saved.id && list2.filter(t => t.id === saved.id).length === 1,
  deleted: del === true && !list3.some(t => t.id === saved.id),
});
""")
    if not isinstance(res, dict) or "ok" not in res:
        return lib.report("ED-04 模板库", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("模板保存成功（真实 IndexedDB）", res.get("ok") is True, f"id={res.get('idPrefix')}… sessionOnly={res.get('sessionOnly')}"),
        ("list/get 回环命中", res.get("listed") is True and res.get("gotName") == "模板源卡", f"listed={res.get('listed')} name={res.get('gotName')}"),
        ("同内容覆盖不重复", res.get("overwrite") is True, str(res.get("overwrite"))),
        ("删除生效", res.get("deleted") is True, str(res.get("deleted"))),
    ]
    return lib.report("ED-04 模板库", res, checks)


# ---------------------------------------------------------------- ED-05 答题滑轮电梯组件
def ed_05(e2e):
    res = e2e.run(r"""
const [le] = await Promise.all([import(B+'levelEditor.js')]);
const okEnter = await le.enterLevelEditor(null, { name: '电梯组件验证' });
await tick(1);
// 盖电梯（grounded）：命中 (90,3,90) 顶面 → origin = (86,3,88)；平台世界位 = origin+(4,0,2) = (90,3,90)
const ok = await le.stampPrefabAt('quiz_pulley_lift', { x: 90, y: 3, z: 90, face: { dx: 0, dy: 1, dz: 0 } });
await tick(2);
const at = (x, y, z) => gb(90, y, 90);
const pf0 = at(90, 3, 90);
const structs = {
  platform0: pf0, pfConst: cfg.PLATFORM_BASE,
  pulley: at(90, 7, 90), wheel: at(90, 8, 90), water: at(90, 9, 90),
  keypad: gb(89, 7, 90),
};
// 求解答题机（答对 = 常供能源）→ 红石重算 → 滑轮回写 powered 变体 → 动力 tick 卷绳
sb(89, 7, 90, cfg.keypadId(1));
rs.updateRedstoneNetwork();
await tick(2);
structs.pulleyPowered = cfg.pulleyPowered(at(90, 7, 90)) === 1;
// 泵动力 tick ~4 秒（跨格节拍 1/1.5s ≈ 0.667s/格）：平台应向滑轮收拢升到井顶
for (let i = 0; i < 32; i++) { kn.updateKineticTick(0.125); await sleep(40); }
let pfUp = null;
for (let y = 3; y <= 6; y++) { if (at(90, y, 90) === cfg.PLATFORM_BASE) { pfUp = y; break; } }
await le.exitLevelEditor({ saveDraft: false });
await sleep(400);
return JSON.stringify({ okEnter, ok, structs, pfUp, rose: pfUp !== null && pfUp > 3 });
""")
    if not isinstance(res, dict) or "structs" not in res:
        return lib.report("ED-05 答题滑轮电梯组件", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    s = res.get("structs", {})
    checks = [
        ("组件盖章 + 机头齐全（平台/滑轮/水车/水）", res.get("ok") is True and s.get("platform0") == s.get("pfConst") and s.get("water") == 7, json.dumps(s)),
        ("答对后滑轮翻为卷绳态", s.get("pulleyPowered") is True, str(s.get("pulleyPowered"))),
        ("平台载人升井（3 → 更高）", res.get("rose") is True, f"pf0_y=3 pfUp_y={res.get('pfUp')}"),
    ]
    return lib.report("ED-05 答题滑轮电梯组件", res, checks)


CASES = {"ED-01": ed_01, "ED-02": ed_02, "ED-03": ed_03, "ED-04": ed_04, "ED-05": ed_05}

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
