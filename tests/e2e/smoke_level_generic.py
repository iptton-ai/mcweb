# -*- coding: utf-8 -*-
"""内置关卡通用烟雾验证（参数化，单关全链）：
首屏官方列表渲染该卡 → 点 ▶ 进入（闯关态/生存/出生=起点旗）→ 真键盘逐锁作答
（自动读卡内答案；断言答题机 224→225、门 0→1、解锁灯亮）→ 传终点 3 星结算 → 退出回首屏。
并行验收：各 agent 用独立 server 端口（E2E_BASE，不同 origin=localStorage 隔离）+
独立 tab（E2E_TAB_FILTER=端口子串）+ E2E_NO_FRONT=1 免抢前台。

用法（在 tests/e2e/ 下）：
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    E2E_BASE=http://127.0.0.1:8601 E2E_TAB_FILTER=8601 E2E_NO_FRONT=1 CDP_PORT=19401 \
    python3 smoke_level_generic.py --file level_05_academy.level.json [--extra extra_xxx.js]

--extra 指定一个 JS 片段文件，其中须定义 `async function runExtra(card){...return {...}}`，
在进入关卡后、逐锁作答前执行（机关专项断言，如电梯位移/TNT 炸墙），返回 dict 并入报告。
"""

import argparse
import json
import pathlib
import sys

import lib

ROOT = pathlib.Path(__file__).resolve().parents[2]

# 页面侧助手：真键盘事件 + 卡内答案自动作答 + 6 邻找门（锁向不限）
WPX = r"""
const [lr,lws,ek]=await Promise.all([import(B+'levelRun.js'),import(B+'levelWorkshop.js'),
  import(B+'eduKeypad.js')]);
const pressWin=(code)=>window.dispatchEvent(new KeyboardEvent('keydown',{code}));
async function typeDigits(n){for(const ch of String(n)){pressWin('Digit'+ch);await sleep(40);}await sleep(60);pressWin('Enter');await sleep(120);}
async function typeChoice(idx){pressWin('Digit'+(idx+1));await sleep(150);}
const teleport=(x,y,z)=>{S.player.x=x;S.player.y=y;S.player.z=z;S.player.vx=0;S.player.vy=0;S.player.vz=0;S.player.fallStartY=null;};
const findDoorOf=(kw)=>{for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
  const id=gb(kw.x+dx,kw.y+dy,kw.z+dz);if(cfg.isDoorId(id))return{x:kw.x+dx,y:kw.y+dy,z:kw.z+dz};}return null;};
// 答一把锁（读卡内 answer）并断言门开
async function solveLock(card,q){
  const kw=lws.localToWorld(q.x,q.y,q.z);
  const dw=findDoorOf(kw);
  const before={kp:gb(kw.x,kw.y,kw.z),door:dw?cfg.doorOpen(gb(dw.x,dw.y,dw.z)):-1};
  teleport(kw.x+0.5,kw.y+1,kw.z+2.5);
  await sleep(150);
  await ek.interactKeypadAt(kw.x,kw.y,kw.z);
  if(q.kind==='choice') await typeChoice(q.answer); else await typeDigits(q.answer);
  await tick(6); // 红石 tick 翻门
  return {key:q.x+','+q.y+','+q.z, subject:q.subject, kind:q.kind,
    before,
    after:{kp:gb(kw.x,kw.y,kw.z),door:dw?cfg.doorOpen(gb(dw.x,dw.y,dw.z)):-1,lamp:gb(kw.x,kw.y+1,kw.z)}};
}
"""


def smoke(e2e, card_file, extra_path):
    card = json.loads((ROOT / 'assets' / 'levels' / card_file).read_text())
    name = card['name']
    extra_def = ''
    if extra_path:
        extra_def = (ROOT / 'tests' / 'e2e' / extra_path).read_text() + \
            "\nEXTRA_OUT = await runExtra(card);\nout.EXTRA_OUT = EXTRA_OUT;\n"
    res = e2e.run(WPX + r"""
// ---- 1) 首屏打开关卡列表：内置区渲染该卡 ----
const ui2 = await import(B+'ui.js');
ui2.openLevelList();
await sleep(900);   // fetch 清单+全部卡
const rowsDom = document.getElementById('level-list-rows');
const rows = [...(rowsDom ? rowsDom.querySelectorAll('.level-row') : [])];
const rowText = rows.map(r=>r.textContent);
const targetRow = rows.find(r=>r.textContent.includes(__NAME__));
const builtinRows = rows.filter(r=>r.textContent.includes('官方关卡'));
// 内置行只有 ▶/🎥 两个钮（无删除 ✕）
const builtinNoDelete = builtinRows.length>0 && builtinRows.every(r=>r.querySelectorAll('button').length===2);
// ---- 2) 点该卡行的 ▶ 进入 ----
const enterBtn = targetRow ? [...targetRow.querySelectorAll('button')].find(b=>b.textContent.includes('进入')) : null;
if (enterBtn) { enterBtn.click(); await sleep(1500); await tick(4); }
const run=S.levelRun;
const out={target:__NAME__, listRows:rows.length, builtinCount:builtinRows.length,
  foundInList: !!targetRow, builtinNoDelete, entered: !!run, ui: um.getUIState()};
if (run) {
  const card=run.card;
  out.spawnOK = gb(run.spawn.x,run.spawn.y,run.spawn.z)===cfg.FLAG_BASE+cfg.FLAG_START;
  out.mode = S.gameMode;
  out.locksTotal = card.questions.length;
  // ---- 检查点旗都在世界 ----
  out.checkpoints = card.flags.checkpoints.map(cp=>{
    const w=lws.localToWorld(cp.x,cp.y,cp.z);return gb(w.x,w.y,w.z)===cfg.FLAG_BASE+cfg.FLAG_CHECKPOINT;});
  // ---- 3) 真键盘连过全部锁 ----
  out.solved=[];
  for (const q of card.questions) out.solved.push(await solveLock(card,q));
  // ---- 机关专项（可选，锁已答完：远程布线门/活塞/电梯等在此断言）----
  __EXTRA__
  // ---- 4) 传送到终点旗结算 ----
  const gw = lws.localToWorld(card.flags.goal.x, card.flags.goal.y, card.flags.goal.z);
  teleport(gw.x+0.5, gw.y+1.2, gw.z+0.5);
  lr.tickLevelRun(0.05); await sleep(600); await tick(2);
  const result = S.levelResult;
  out.finish = result ? {stars:result.stars, deaths:result.deaths,
    locksSolved:(result.locks||[]).filter(l=>l.solved).length,
    locksTotal:(result.locks||[]).length} : null;
  // ---- 5) 退出回首屏 ----
  lr.exitLevelRun({toTitle:true});
  await sleep(900); await tick(2);
  out.afterExit = {runActive: lr.isLevelRunActive(), ui: um.getUIState()};
}
return JSON.stringify(out);
""".replace('__NAME__', json.dumps(name)).replace('__EXTRA__', extra_def))
    if not isinstance(res, dict) or "foundInList" not in res:
        return lib.report(f"内置关卡烟雾·{name}", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])

    solved = res.get('solved') or []
    f = res.get('finish') or {}
    after = res.get('afterExit') or {}
    kp_ok = all(s['before']['kp'] == 224 and s['after']['kp'] == 225 for s in solved)
    # door==-1 = 锁 6 邻无门（远程布线/活塞闸门锁）：门断言由该关 extra 专项兜
    neighbor_locked = [s for s in solved if s['before']['door'] != -1]
    door_ok = all(s['before']['door'] == 0 and s['after']['door'] == 1 for s in neighbor_locked)
    no_door_keys = [s['key'] for s in solved if s['before']['door'] == -1]
    lamp_ok = all(s['after']['lamp'] == 96 for s in solved)
    n_locks = res.get('locksTotal', 0)
    checks = [
        (f"官方列表含「{name}」且内置行无删除钮", res['foundInList'] and res['builtinNoDelete'],
         f"rows={res['listRows']} builtin={res['builtinCount']} found={res['foundInList']}"),
        ("点 ▶ 进入成功（levelRun 激活 + 生存态）", res['entered'] and res.get('mode') == 'survival',
         f"entered={res['entered']} mode={res.get('mode')}"),
        ("出生点=起点旗", res.get('spawnOK') is True, str(res.get('spawnOK'))),
        ("检查点旗齐全", all(res.get('checkpoints') or [False]), str(res.get('checkpoints'))),
        (f"{n_locks} 把锁：224→225 翻转", len(solved) == n_locks and kp_ok,
         json.dumps([{'k': s['key'], 's': s['subject'], 'kp': s['after']['kp']} for s in solved], ensure_ascii=False)),
        (f"{len(neighbor_locked)} 扇邻门：关→开（红石联动）" + (f"；无邻门锁 {no_door_keys} 由 extra 兜" if no_door_keys else ""),
         door_ok,
         json.dumps([{'k': s['key'], 'door': s['after']['door']} for s in solved], ensure_ascii=False)),
        ("解锁灯全亮", lamp_ok, str([s['after']['lamp'] for s in solved])),
        (f"踩终点 3 星结算（{f.get('locksSolved')}/{f.get('locksTotal')} 锁、零死亡）",
         f.get('stars') == 3 and f.get('locksSolved') == n_locks and f.get('deaths') == 0,
         json.dumps(f, ensure_ascii=False)),
        ("退出回首屏 + levelRun 清空", after.get('runActive') is False and after.get('ui') == 'title', str(after)),
    ]
    if extra_path:
        extra_out = res.get('EXTRA_OUT') or {}
        for label, item in extra_out.items():
            ok, ev = item if isinstance(item, (list, tuple)) else (bool(item), str(item))
            checks.append((f"机关专项·{label}", bool(ok), str(ev)[:300]))
    return lib.report(f"内置关卡烟雾·{name}", res, checks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True, help='assets/levels/ 下的卡文件名')
    ap.add_argument('--extra', default=None, help='tests/e2e/ 下的机关专项 JS（定义 runExtra(card)）')
    args = ap.parse_args()
    from lib import E2E
    e2e = E2E()
    try:
        ok = smoke(e2e, args.file, args.extra)
    finally:
        e2e.close()
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
