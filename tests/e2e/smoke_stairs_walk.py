# -*- coding: utf-8 -*-
"""楼梯真实物理爬行验证（2026-09-16 楼梯净空事故回归门）：
烟雾脚本逐锁作答靠传送，不走楼梯——「楼板洞只开末两级、起跳级撞头」类 bug
曾全绿漏网。本脚本在闯关态里把玩家放到楼梯脚，真键盘按住 W+Space（游戏自动
连跳，即玩家爬楼的实时物理），断言 N 秒内爬升达标。

用法（在 tests/e2e/ 下，需先起 server 与 CDP Chrome）：
  python3 smoke_stairs_walk.py --file level_05_academy.level.json \
    --walks '[{"label":"主楼梯","l":[22,4,28],"yaw":0,"secs":8,"expectDy":5},
              {"label":"屋顶楼梯","l":[21,9,18],"yaw":0,"secs":7,"expectDy":5}]'
--walks 的 l=卡内局部坐标（站立格，脚下实心），yaw=朝向（0=-z 北，-π/2=+x 东），
expectDy=期望最小爬升（格）。进门流程与逐锁作答复用 smoke_level_generic 的链路。
"""

import argparse
import json
import pathlib
import sys

import lib

ROOT = pathlib.Path(__file__).resolve().parents[2]

# 与 smoke_level_generic 同款页面侧助手（真键盘作答+传送）。
# ⚠️ 按键监听挂 document：合成事件必须 document.dispatchEvent（window 派发不进路由）
WPX = r"""
const [lr,lws,ek]=await Promise.all([import(B+'levelRun.js'),import(B+'levelWorkshop.js'),
  import(B+'eduKeypad.js')]);
const pressWin=(code,up)=>document.dispatchEvent(new KeyboardEvent(up?'keyup':'keydown',{code}));
async function typeDigits(n){for(const ch of String(n)){pressWin('Digit'+ch);await sleep(40);}await sleep(60);pressWin('Enter');await sleep(120);}
async function typeChoice(idx){pressWin('Digit'+(idx+1));await sleep(150);}
const teleport=(x,y,z)=>{S.player.x=x;S.player.y=y;S.player.z=z;S.player.vx=0;S.player.vy=0;S.player.vz=0;S.player.fallStartY=null;};
const findDoorOf=(kw)=>{for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
  const id=gb(kw.x+dx,kw.y+dy,kw.z+dz);if(cfg.isDoorId(id))return{x:kw.x+dx,y:kw.y+dy,z:kw.z+dz};}return null;};
async function solveLock(card,q){
  const kw=lws.localToWorld(q.x,q.y,q.z);
  const dw=findDoorOf(kw);
  const before={kp:gb(kw.x,kw.y,kw.z),door:dw?cfg.doorOpen(gb(dw.x,dw.y,dw.z)):-1};
  teleport(kw.x+0.5,kw.y+1,kw.z+2.5);
  await sleep(150);
  await ek.interactKeypadAt(kw.x,kw.y,kw.z);
  if(q.kind==='choice') await typeChoice(q.answer); else await typeDigits(q.answer);
  await tick(6);
  return {key:q.x+','+q.y+','+q.z, kp:gb(kw.x,kw.y,kw.z)};
}
"""


def enter_and_solve(e2e, card):
    """进关 + 传送逐锁作答（与 smoke_level_generic 同链路）。返回结果 dict。"""
    name = card['name']
    return e2e.run(WPX + r"""
// ---- 打开关卡列表 → 点该卡 ▶ 进入 ----
const ui2 = await import(B+'ui.js');
ui2.openLevelList();
await sleep(900);
const rowsDom = document.getElementById('level-list-rows');
const rows = [...(rowsDom ? rowsDom.querySelectorAll('.level-row') : [])];
const targetRow = rows.find(r=>r.textContent.includes(__NAME__));
const enterBtn = targetRow ? [...targetRow.querySelectorAll('button')].find(b=>b.textContent.includes('进入')) : null;
if (enterBtn) { enterBtn.click(); await sleep(1500); await tick(4); }
const run=S.levelRun;
const out={foundInList: !!targetRow, entered: !!run};
if (run) {
  const card=run.card;
  out.solved=[];
  for (const q of card.questions) out.solved.push(await solveLock(card,q));
}
return JSON.stringify(out);
""".replace('__NAME__', json.dumps(name)))


def run_walk(e2e, card, walk):
    """一次爬楼验证：传送到楼梯脚 → 按住 W+Space → 断言爬升。"""
    body = WPX + r"""
const L=__L__, YAW=__YAW__, SECS=__SECS__;
const wp=lws.localToWorld(L[0],L[1],L[2]);
teleport(wp.x+0.5, wp.y+1.1, wp.z+0.5);
S.player.yaw=YAW; S.player.pitch=0;
await sleep(400); await tick(2);
const y0=S.player.y, p0=[+S.player.x.toFixed(2),+S.player.y.toFixed(2),+S.player.z.toFixed(2)];
pressWin('KeyW'); pressWin('Space');
let maxY=y0;
for(let i=0;i<Math.ceil(SECS*2);i++){await sleep(500);maxY=Math.max(maxY,S.player.y);}
pressWin('KeyW',true); pressWin('Space',true);
await sleep(400); await tick(2);
const dy=maxY-y0;
return {dy:+dy.toFixed(2), expectDy:__DY__, ok: dy>=__DY__-0.01,
  pos:[+S.player.x.toFixed(2),+S.player.y.toFixed(2),+S.player.z.toFixed(2)], from:p0};
""".replace('__L__', json.dumps(walk['l'])) \
       .replace('__YAW__', repr(float(walk.get('yaw', 0)))) \
       .replace('__SECS__', repr(float(walk.get('secs', 8)))) \
       .replace('__DY__', repr(float(walk.get('expectDy', 4))))
    return e2e.run(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True, help='assets/levels/ 下的卡文件名')
    ap.add_argument('--walks', required=True, help='JSON 数组：[{label,l:[x,y,z],yaw,secs,expectDy}]')
    args = ap.parse_args()
    card = json.loads((ROOT / 'assets' / 'levels' / args.file).read_text())
    walks = json.loads(args.walks)

    from lib import E2E
    e2e = E2E()
    try:
        boot = enter_and_solve(e2e, card)
        if not isinstance(boot, dict) or not boot.get('entered'):
            return lib.report(f"爬楼验证·{card['name']}", boot if isinstance(boot, dict) else {"__error__": str(boot)[:300]}, [])
        solved = boot.get('solved') or []
        checks = [
            (f"进关并真键盘过 {len(solved)}/{len(card['questions'])} 锁",
             len(solved) == len(card['questions']) and all(s['kp'] == 225 for s in solved),
             json.dumps(boot, ensure_ascii=False)[:300]),
        ]
        for w in walks:
            label = w.get('label', f"walk{w['l']}")
            res = run_walk(e2e, card, w)
            ok = bool(res.get('ok')) if isinstance(res, dict) else False
            checks.append((f"爬楼物理·{label}（按住 W+Space {w.get('secs',8)}s）",
                           ok, json.dumps(res, ensure_ascii=False)[:260]))
        return lib.report(f"爬楼验证·{card['name']}", boot, checks)
    finally:
        e2e.close()


if __name__ == '__main__':
    main()
