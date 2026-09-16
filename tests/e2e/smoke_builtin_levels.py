# -*- coding: utf-8 -*-
"""内置关卡烟雾验证：首屏列表渲染官方区 → 进星辉城堡 → 真键盘连过三把锁（红石开门×3）→
踩终点 3 星结算 → 退出回首屏。跑法：
cd tests/e2e && env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY \
  -u ALL_PROXY CDP_PORT=19401 python3 smoke_builtin_levels.py
"""

import json
import sys

import lib

# 与 run_workshop.WPX 同款页面侧助手（真键盘事件 + 嵌入坐标换算）
WPX = r"""
const [lr,lws,ek]=await Promise.all([import(B+'levelRun.js'),import(B+'levelWorkshop.js'),
  import(B+'eduKeypad.js')]);
const pressWin=(code)=>window.dispatchEvent(new KeyboardEvent('keydown',{code}));
async function typeDigits(n){for(const ch of String(n)){pressWin('Digit'+ch);await sleep(40);}await sleep(60);pressWin('Enter');await sleep(120);}
async function typeChoice(idx){pressWin('Digit'+(idx+1));await sleep(150);}
const teleport=(x,y,z)=>{S.player.x=x;S.player.y=y;S.player.z=z;S.player.vx=0;S.player.vy=0;S.player.vz=0;S.player.fallStartY=null;};
// 答一把锁并断言门开：q=卡内题目，choiceIdx/inputAns=正确答案
async function solveLock(card,q,ans,isChoice){
  const kw=lws.localToWorld(q.x,q.y,q.z);
  const dw={x:kw.x+1,y:kw.y,z:kw.z};           // 本批内置关：门都在锁东侧一格
  const before={kp:gb(kw.x,kw.y,kw.z),door:cfg.doorOpen(gb(dw.x,dw.y,dw.z))};
  teleport(kw.x+0.5,kw.y+1,kw.z+2.5);
  await ek.interactKeypadAt(kw.x,kw.y,kw.z);
  if(isChoice) await typeChoice(ans); else await typeDigits(ans);
  await tick(6); // 红石 tick 翻门
  return {before,
    after:{kp:gb(kw.x,kw.y,kw.z),door:cfg.doorOpen(gb(dw.x,dw.y,dw.z)),
      lamp:gb(kw.x,kw.y+1,kw.z),
      doorXY:{x:dw.x,y:dw.y,z:dw.z}}};
}
"""


def smoke(e2e):
    res = e2e.run(WPX + r"""
// ---- 1) 首屏打开关卡列表：内置区渲染 ----
const ui2 = await import(B+'ui.js');
ui2.openLevelList();
await sleep(900);   // fetch 清单+全部卡（官方卡已扩到 14 张，取足余量）
const rowsDom = document.getElementById('level-list-rows');
const rows = [...(rowsDom ? rowsDom.querySelectorAll('.level-row') : [])];
const rowText = rows.map(r=>r.textContent);
const builtinRows = rows.filter(r=>r.textContent.includes('官方关卡'));
const namesOK = ['村口热身赛','星辉城堡','地牢寻宝记','云间跳跳乐'].every(n=>rowText.some(t=>t.includes(n)));
// 内置行无删除钮 ✕（2026-09-16 起有 ▶/🎥/✏️改副本 三钮，按语义断言而非冻结数量）；
// 官方卡数量随批次增长，只要求≥4（老四关在列）
const builtinNoDelete = builtinRows.length>=4 && builtinRows.every(r =>
  [...r.querySelectorAll('button')].every(b => !b.textContent.includes('✕')) &&
  r.textContent.includes('改副本'));
// ---- 2) 点「星辉城堡」行的 ▶ 进入 ----
const castleRow = rows.find(r=>r.textContent.includes('星辉城堡'));
const enterBtn = castleRow ? [...castleRow.querySelectorAll('button')].find(b=>b.textContent.includes('进入')) : null;
if (enterBtn) { enterBtn.click(); await sleep(1200); await tick(4); }
const run=S.levelRun;
const out={listRows:rows.length, builtinCount:builtinRows.length, namesOK, builtinNoDelete,
  entered: !!run, ui: um.getUIState()};
if (run) {
  const card=run.card;
  out.spawnOK = gb(run.spawn.x,run.spawn.y,run.spawn.z)===cfg.FLAG_BASE+cfg.FLAG_START;
  out.mode = S.gameMode;
  // ---- 3) 连过三把锁：城门(数学·输入30) → 主楼门(科学·选1) → 隔墙门(语文·选1) ----
  out.gate = await solveLock(card, card.questions[0], 30, false);
  out.keep = await solveLock(card, card.questions[1], 0, true);
  out.hall = await solveLock(card, card.questions[2], 0, true);
  // ---- 4) 传送到终点旗结算（王座厅红毯）----
  const gw = lws.localToWorld(card.flags.goal.x, card.flags.goal.y, card.flags.goal.z);
  teleport(gw.x+0.5, gw.y+1.2, gw.z+0.5);
  lr.tickLevelRun(0.05); await sleep(500); await tick(2);
  const result = S.levelResult;
  out.finish = result ? {stars:result.stars, deaths:result.deaths,
    locksSolved:(result.locks||[]).filter(l=>l.solved).length,
    locksTotal:(result.locks||[]).length} : null;
  // ---- 5) 退出回首屏 ----
  lr.exitLevelRun({toTitle:true});
  await sleep(800); await tick(2);
  out.afterExit = {runActive: lr.isLevelRunActive(), ui: um.getUIState()};
}
return JSON.stringify(out);
""")
    if not isinstance(res, dict) or "namesOK" not in res:
        return lib.report("内置关卡烟雾", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    gate = res.get("gate") or {}
    keep = res.get("keep") or {}
    hall = res.get("hall") or {}
    f = res.get("finish") or {}
    after = res.get("afterExit") or {}

    lamp_ok = all((s.get("after") or {}).get("lamp") == 96 for s in (gate, keep, hall))
    door_ok = all((s.get("before") or {}).get("door") == 0 and (s.get("after") or {}).get("door") == 1
                  for s in (gate, keep, hall))
    kp_ok = all((s.get("before") or {}).get("kp") == 224 and (s.get("after") or {}).get("kp") == 225
                for s in (gate, keep, hall))
    checks = [
        ("列表渲染官方卡（≥4 张，含老四关）", res["namesOK"] and res["builtinCount"] >= 4,
         f"rows={res['listRows']} builtin={res['builtinCount']} namesOK={res['namesOK']}"),
        ("内置行无删除钮", res["builtinNoDelete"], str(res["builtinNoDelete"])),
        ("点 ▶ 进入城堡成功（levelRun 激活 + 生存态）", res["entered"] and res.get("mode") == "survival",
         f"entered={res['entered']} mode={res.get('mode')}"),
        ("出生点=起点旗", res.get("spawnOK") is True, str(res.get("spawnOK"))),
        ("三把锁：224→225 翻转", kp_ok, json.dumps([gate.get("before"), keep.get("after")], ensure_ascii=False)),
        ("三扇门：关→开（红石联动）", door_ok, json.dumps([gate.get("after"), keep.get("after"), hall.get("after")], ensure_ascii=False)),
        ("三盏解锁灯全亮", lamp_ok, str([(s.get("after") or {}).get("lamp") for s in (gate, keep, hall)])),
        ("踩终点 3 星结算（3/3 锁、零死亡）", f.get("stars") == 3 and f.get("locksSolved") == 3 and f.get("locksTotal") == 3,
         json.dumps(f, ensure_ascii=False)),
        ("退出回首屏 + levelRun 清空", after.get("runActive") is False and after.get("ui") == "title", str(after)),
    ]
    return lib.report("内置关卡烟雾", res, checks)


def main():
    from lib import E2E
    e2e = E2E()
    try:
        ok = smoke(e2e)
    finally:
        e2e.close()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
