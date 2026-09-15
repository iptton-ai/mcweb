# -*- coding: utf-8 -*-
"""关卡工坊批次 W 验收（冻结清单 W01~W19，docs/edu-workshop-impl-contract.md §7，只增不改）。

断言素材铁律：方块 ID 经 config.js 纯解码函数（isFlagId/flagKind/keypadId/doorOpen 等）+ getBlock；
状态走 state.levelRun / getBestScores / getAuthoredLock 等公开导出；
交互走公开入口（breakBlockAt/placeBlock/interactKeypadAt/interactKeypadAuthorAt/pickBlockUnderCrosshair，
键盘一律 dispatch 真实 KeyboardEvent——作者面板/答题卡监听 window 捕获、input.js 监听 document，
故按目标分别用 pressWin/pressDoc）。锁题经 buildLevelCard 的 lockMetaProvider 注入（契约 §3.1 公开参数，
W16/W19 走真作者面板流）。绝不直调 setBlockSafe 翻转产品状态来伪造断言素材（布景除外）。

跑法：cd tests/e2e && env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY \
      -u ALL_PROXY CDP_PORT=19401 python3 run_workshop.py [case...]（case 名如 W01，缺省全跑）
"""

import json
import sys

import lib

# ---------------------------------------------------------------- 页面侧公共助手（接在 lib.PREAMBLE 之后）
WPX = r"""
// —— W 套件公共助手 ——
const [lr,lws,ek,pl]=await Promise.all([import(B+'levelRun.js'),import(B+'levelWorkshop.js'),
  import(B+'eduKeypad.js'),import(B+'playerLife.js')]);
const OFF=lws.LEVEL_EMBED_OFFSET;
const L2W=(p)=>lws.localToWorld(p.x,p.y,p.z);
// 作者世界坐标 → 关卡嵌入世界坐标（快照局部=作者坐标-region 原点；嵌入=局部+固定偏移 OFF）
const emb=(card,wx,wy,wz)=>({x:OFF.x+wx-card.region.x0,y:OFF.y+wy-card.region.y0,z:OFF.z+wz-card.region.z0});
const qkey=(q)=>q.x+','+q.y+','+q.z;
// 键盘：作者面板/答题卡监听 window 捕获 → pressWin；input.js 监听 document → pressDoc
const pressWin=(code)=>window.dispatchEvent(new KeyboardEvent('keydown',{code}));
const pressDoc=(code)=>document.dispatchEvent(new KeyboardEvent('keydown',{code}));
async function typeDigits(n){for(const ch of String(n)){pressWin('Digit'+ch);await sleep(40);}await sleep(60);pressWin('Enter');await sleep(120);}
// 防串台：上一用例若带着活跃 levelRun 被 fresh_page 导航，助手快照恢复可能把上一关世界带回来
//（实测把嵌入旗(y=6)带进作者世界 → region.y0 被拖到 4）。布景前先清 levelRun 并擦掉一切场景外锚点。
async function scrubAnchors(){
  if(S.levelRun) S.levelRun=null;
  const W=cfg.WORLD_WIDTH,D=cfg.WORLD_DEPTH,H=cfg.WORLD_HEIGHT;
  const anch=(b)=>(b>=cfg.FLAG_BASE&&b<cfg.FLAG_BASE+cfg.FLAG_COUNT)
    ||(b>=cfg.KEYPAD_BASE&&b<cfg.KEYPAD_BASE+cfg.KEYPAD_COUNT)
    ||(b>=cfg.STARLIGHT_BASE&&b<cfg.STARLIGHT_BASE+cfg.STARLIGHT_COUNT)
    ||(b>=cfg.DOOR_BASE&&b<cfg.DOOR_BASE+cfg.DOOR_COUNT);
  let n=0;
  for(let y=0;y<H;y++){const yb=y*W*D;
    for(let z=0;z<D;z++){const rb=yb+z*W;
      for(let x=0;x<W;x++){if(anch(S.blocks[rb+x])){S.blocks[rb+x]=0;n++;}}}}
  return n;
}
async function endCase(){ if(lr.isLevelRunActive()) await exitRun(true); }
// smoke_workshop 同款标准布景：平台(40,40 8x10, y=20) 起点旗(41,41) 锁(44,41) 门(45,41 上下一对) 终点旗(47,44)
async function scene(){
  await scrubAnchors();
  setDay();
  platform(40,40,8,10,20);
  sb(41,20,41,cfg.FLAG_BASE+cfg.FLAG_START);
  sb(44,20,41,cfg.KEYPAD_BASE);
  sb(45,20,41,cfg.doorId(0,0,3)); sb(45,21,41,cfg.doorId(1,0,3));
  sb(47,20,44,cfg.FLAG_BASE+cfg.FLAG_GOAL);
}
const provAt=(wx,wy,wz,q,passes)=>(x,y,z)=>(x===wx&&y===wy&&z===wz)?{question:q,verifiedPasses:(passes==null?2:passes)}:null;
const inQ=(ans)=>({subject:'math',kind:'input',stem:'3×4+5',answer:ans});
async function buildCard(name,prov,rules){return await lws.buildLevelCard(Object.assign({name:name,author:'e2e'},
  prov?{lockMetaProvider:prov}:{}, rules?{rules:rules}:{}));}
async function enter(card){const r=await lr.enterLevel(card);await sleep(500);await tick(2);return r;}
async function exitRun(toTitle){lr.exitLevelRun({toTitle:!!toTitle});await sleep(1000);await tick(2);}
const teleport=(x,y,z)=>{S.player.x=x;S.player.y=y;S.player.z=z;S.player.vx=0;S.player.vy=0;S.player.vz=0;S.player.fallStartY=null;};
"""


def w01(e2e):
    """W01 模式隔离：挖/放/E/M/F/F6/双击空格/中键全拒 + 退出后普通世界挖放回归。"""
    res = e2e.run(WPX + r"""
await scene();
S.gameMode='creative';
const card=await buildCard('W01');   // 锁无 authored lock → 纯装饰，不进 questions
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const run=await enter(card);
if(!run) return JSON.stringify({__error__:'enterLevel null'});
const fW=L2W(card.flags.start);
const flagId0=cfg.FLAG_BASE+cfg.FLAG_START;
const modeInLevel=S.gameMode;
// —— 挖（breakBlockAt 公开入口，fake hit 打起点旗）——
it.breakBlockAt({x:fW.x,y:fW.y,z:fW.z,block:flagId0,face:{dx:1,dy:0,dz:0}});
const breakRes=gb(fW.x,fW.y,fW.z)===flagId0?'blocked':'CHANGED';
// —— 放（aim+placeBlock 玩家路径，瞄旗旁石板顶面）——
const T={x:fW.x+1,y:fW.y-1,z:fW.z};   // 平台石板（嵌入后 y=5 层）
const aim=aimScan(T.x,T.y,T.z, T.x+1.6, T.y+2.2, T.z);
let placeRes='aim-miss', aimOK=!!aim;
if(aim){ it.placeBlock(); await tick(1);
  placeRes=(gb(T.x,T.y,T.z)===BT.STONE && gb(T.x,T.y+1,T.z)===BT.AIR)?'blocked':'PLACED(!)'; }
// —— E：不开背包 ——
pressDoc('KeyE'); await sleep(150);
const afterE=um.getUIState();
// —— M：不切模式 ——
pressDoc('KeyM'); await sleep(150);
const modeAfterM=S.gameMode;
// —— F：不飞行 ——
pressDoc('KeyF'); await sleep(150);
const flyingAfterF=S.player.flying;
// —— F6：不改昼夜 ——
const t0=S.time; pressDoc('F6'); await sleep(150);
const f6Delta=S.time-t0;
// —— 双击空格：不飞行 ——
pressDoc('Space'); pressDoc('Space'); await sleep(180);
const flyingAfterSpace=S.player.flying;
// —— 中键：不吸取（先把槽位拨到与准星方块不同的物品，被守卫则槽位不动）——
const slotKeep=S.player.selectedSlot;
S.player.selectedSlot=HB.indexOf(BT.PLANKS);
it.pickBlockUnderCrosshair();
const slotAfterPick=S.player.selectedSlot;
const pickBlocked=slotAfterPick===HB.indexOf(BT.PLANKS);
S.player.selectedSlot=slotKeep;
// —— 退出后普通世界挖/放回归 ——
await exitRun(true);
S.gameMode='creative';
for(let x=58;x<65;x++)for(let y=18;y<24;y++)for(let z=58;z<64;z++)sb(x,y,z,BT.AIR);
sb(60,20,60,BT.STONE); sb(61,20,60,BT.STONE);
it.breakBlockAt({x:60,y:20,z:60,block:BT.STONE,face:{dx:0,dy:1,dz:0}});
await tick(1);
const dugOK=gb(60,20,60)===BT.AIR;
S.player.selectedSlot=HB.indexOf(BT.STONE);
const aim2=aimScan(61,20,60, 64.0,21.5,60.5);   // 浅角瞄准（正下方超出 aimScan 俯仰范围 ±1.5rad）
let placedOK=false, aim2OK=!!aim2;
if(aim2){ it.placeBlock(); await tick(1);
  // 命中面法线随射线角度而定（顶面/侧面都可能）——六邻任一格变为 STONE 即证明放置成功
  placedOK=[[61,21,60],[62,20,60],[61,20,59],[61,20,61],[61,19,60],[60,20,60]]
    .some(p=>gb(p[0],p[1],p[2])===BT.STONE); }
return JSON.stringify({modeInLevel,breakRes,aimOK,placeRes,afterE,modeAfterM,flyingAfterF,f6Delta,
  flyingAfterSpace,pickBlocked,runNullAfter:!S.levelRun,uiAfter:um.getUIState(),dugOK,aim2OK,placedOK});
""")
    if not isinstance(res, dict) or "breakRes" not in res:
        return lib.report("W01 模式隔离", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("进关强制生存", res["modeInLevel"] == "survival", str(res["modeInLevel"])),
        ("挖被拒（起点旗原样）", res["breakRes"] == "blocked", str(res["breakRes"])),
        ("放被拒（瞄准+placeBlock 玩家路径）", res["aimOK"] and res["placeRes"] == "blocked", f"aim={res['aimOK']} {res['placeRes']}"),
        ("E 不开背包（uiState 仍 playing）", res["afterE"] == "playing", str(res["afterE"])),
        ("M 不切模式（仍生存）", res["modeAfterM"] == "survival", str(res["modeAfterM"])),
        ("F 不飞行", res["flyingAfterF"] is False, str(res["flyingAfterF"])),
        ("F6 不改昼夜（时间无跳变）", abs(res["f6Delta"]) < 1.0, f"Δt={res['f6Delta']:.3f}s"),
        ("双击空格不飞行", res["flyingAfterSpace"] is False, str(res["flyingAfterSpace"])),
        ("中键不吸取（槽位不动）", res["pickBlocked"], str(res["pickBlocked"])),
        ("退出后 levelRun 清空回首屏", res["runNullAfter"] and res["uiAfter"] == "title", f"ui={res['uiAfter']}"),
        ("普通世界可挖（回归面）", res["dugOK"], str(res["dugOK"])),
        ("普通世界可放（回归面）", res["aim2OK"] and res["placedOK"], f"aim={res['aim2OK']} placed={res['placedOK']}"),
    ]
    return lib.report("W01 模式隔离", res, checks)


def w02(e2e):
    """W02 检查点：死亡回最近激活旗、计时连续、deaths+1、重复踩旗刷新（换旗后再死回新旗）。"""
    res = e2e.run(WPX + r"""
await scene();
sb(43,20,43,cfg.FLAG_BASE+cfg.FLAG_CHECKPOINT);  // cp1
sb(46,20,46,cfg.FLAG_BASE+cfg.FLAG_CHECKPOINT);  // cp2
const card=await buildCard('W02');
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const run=await enter(card);
if(!run) return JSON.stringify({__error__:'enterLevel null'});
const cp1=L2W(card.flags.checkpoints[0]), cp2=L2W(card.flags.checkpoints[1]);
const respawn0=Object.assign({},run.respawn);
// 踩 cp1 → respawn 切到 cp1
teleport(cp1.x+0.5,cp1.y+1,cp1.z+0.5); lr.tickLevelRun(0.05);
const respawnCp1=Object.assign({},run.respawn);
const cpKey1=qkey(card.flags.checkpoints[0]);
const cp1Activated=run.activatedCheckpoints.has(cpKey1);
// 死亡 → deaths+1 / 计时不间断 / 回 cp1
const e1=run.elapsed;
S.player.invulnTimer=0; pl.damagePlayer(999);
const deadOK=S.player.dead, deaths1=run.deaths;
pl.respawn();
const pos1={x:S.player.x,y:S.player.y,z:S.player.z};
lr.tickLevelRun(0.3);
const elapsedCont=run.elapsed>=e1+0.29;
// 回踩起点 → respawn 刷回起点（重复踩旗刷新）
const stW=L2W(card.flags.start);
teleport(stW.x+0.5,stW.y+1,stW.z+0.5); lr.tickLevelRun(0.05);
const respawnStart=Object.assign({},run.respawn);
// 再踩 cp2 → 死亡 → 回新旗 cp2
teleport(cp2.x+0.5,cp2.y+1,cp2.z+0.5); lr.tickLevelRun(0.05);
const respawnCp2=Object.assign({},run.respawn);
S.player.invulnTimer=0; pl.damagePlayer(999); pl.respawn();
const pos2={x:S.player.x,y:S.player.y,z:S.player.z};
const deaths2=run.deaths;
const activatedSize=run.activatedCheckpoints.size;
await endCase();
return JSON.stringify({respawn0,stW:{x:stW.x,y:stW.y,z:stW.z},respawnCp1,cp1Activated,deadOK,deaths1,pos1,
  cp1Exp:{x:cp1.x,y:cp1.y,z:cp1.z},elapsedCont,respawnStart,respawnCp2,pos2,
  cp2Exp:{x:cp2.x,y:cp2.y,z:cp2.z},deaths2,activatedSize});
""")
    if not isinstance(res, dict) or "deaths2" not in res:
        return lib.report("W02 检查点", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = []
    r0, rc1, rs, rc2 = res["respawn0"], res["respawnCp1"], res["respawnStart"], res["respawnCp2"]
    sp, st = res["cp1Exp"], res["stW"]
    checks += [
        ("初始重生点=起点旗", r0 == st, f"respawn0={r0} 期望={st}"),
        ("踩 cp1 → respawn 切到 cp1", rc1 == sp, f"respawn={rc1} 期望={sp}"),
        ("cp1 记入 activatedCheckpoints", res["cp1Activated"] is True, str(res["cp1Activated"])),
        ("死亡生效（dead 态）", res["deadOK"] is True, str(res["deadOK"])),
        ("第一次死亡 deaths=1", res["deaths1"] == 1, str(res["deaths1"])),
        ("重生落点=cp1（+0.5/+1）", abs(res["pos1"]["x"] - (sp["x"] + 0.5)) < 0.01 and abs(res["pos1"]["z"] - (sp["z"] + 0.5)) < 0.01, str(res["pos1"])),
        ("死亡后计时连续（elapsed 不清零）", res["elapsedCont"], f"e1 后再走 0.3s 仍递增"),
        ("回踩起点 → respawn 刷回起点（重复踩旗刷新）", rs == st, f"respawnStart={rs} 期望={st}"),
        ("再踩 cp2 → respawn 切到 cp2", rc2 == res["cp2Exp"], f"respawn={rc2} 期望={res['cp2Exp']}"),
        ("换旗后再死回新旗（落点=cp2）", abs(res["pos2"]["x"] - (res["cp2Exp"]["x"] + 0.5)) < 0.01 and abs(res["pos2"]["z"] - (res["cp2Exp"]["z"] + 0.5)) < 0.01, str(res["pos2"])),
        ("两次死亡 deaths=2", res["deaths2"] == 2, str(res["deaths2"])),
        ("两个检查点都已激活", res["activatedSize"] == 2, str(res["activatedSize"])),
    ]
    return lib.report("W02 检查点", res, checks)


def w03(e2e):
    """W03 终点结算：结果字段全对/星级 3 与 2/timeLimit 超时失败面板。"""
    res = e2e.run(WPX + r"""
await scene();
const cardA=await buildCard('W03A');
const cardB=await buildCard('W03B', provAt(44,20,41,inQ(17),2));
const cardC=await buildCard('W03C', null, {timeLimit:3});
const out={};
// ---- A：零死亡全一次过（无锁）→ 3 星 ----
{
  const run=await enter(cardA);
  if(!run){ out.errA='enterLevel null'; }
  else{
    lr.tickLevelRun(1.2); lr.tickLevelRun(1.2);
    const inj=run.elapsed;                      // ≥2.4（注水值）
    const gW=L2W(cardA.flags.goal);
    teleport(gW.x+0.5,gW.y+1,gW.z+0.5);
    const r=lr.tickLevelRun(0.05);
    await sleep(300); await tick(1);
    out.A={inj, r: r&&{timeSec:r.timeSec,deaths:r.deaths,locks:r.locks,stars:r.stars,isNewBest:r.isNewBest,
                       name:r.name,hashMatch:r.cardHash===run.cardHash},
      ui:um.getUIState(), panelVisible:!document.getElementById('result-panel').classList.contains('hidden'),
      levelResultStars:S.levelResult&&S.levelResult.stars,
      best:lr.getBestScores(run.cardHash)};
    await exitRun(true);
  }
}
// ---- B：deaths=1 + 某锁 tries=2 → 2 星 ----
{
  const run=await enter(cardB);
  if(!run){ out.errB='enterLevel null'; }
  else{
    const kw=emb(cardB,44,20,41);
    teleport(kw.x+0.5,kw.y+1,kw.z+2.5);
    await ek.interactKeypadAt(kw.x,kw.y,kw.z);
    const quizOpen=document.getElementById('edu-quiz').style.display==='block';
    pressWin('Digit9'); await sleep(80); pressWin('Enter');   // 答错一次
    await sleep(1100);                                        // 等 900ms 清空重试
    await typeDigits(17); await sleep(150);
    const kpAfter=gb(kw.x,kw.y,kw.z);
    const ans=S.levelRun.answers[qkey(cardB.questions[0])];
    S.player.invulnTimer=0; pl.damagePlayer(999); pl.respawn();  // 死一次
    const gW=L2W(cardB.flags.goal);
    teleport(gW.x+0.5,gW.y+1,gW.z+0.5);
    const r=lr.tickLevelRun(0.05);
    out.B={quizOpen,kpSolved:kpAfter===cfg.keypadId(1),ans,
      r: r&&{timeSec:r.timeSec,deaths:r.deaths,stars:r.stars,locks:r.locks}};
    await exitRun(true);
  }
}
// ---- C：timeLimit=3 → 4s 后失败面板（timeout、stars=0） ----
{
  const run=await enter(cardC);
  if(!run){ out.errC='enterLevel null'; }
  else{
    let rc=null; for(let i=0;i<12&&!rc;i++) rc=lr.tickLevelRun(0.5);
    await sleep(200);
    out.C={timeout:!!(rc&&rc.timeout),stars:rc&&rc.stars,timeSec:rc&&rc.timeSec,
      ui:um.getUIState(),panelVisible:!document.getElementById('result-panel').classList.contains('hidden'),
      bestStars:(lr.getBestScores(run.cardHash)||{}).stars};
    await exitRun(true);
  }
}
return JSON.stringify(out);
""")
    if not isinstance(res, dict) or "A" not in res:
        return lib.report("W03 终点结算", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    a, b, c = res.get("A") or {}, res.get("B") or {}, res.get("C") or {}
    ra = a.get("r") or {}
    rb = b.get("r") or {}
    checks = []
    ok_a = (ra.get("stars") == 3 and ra.get("deaths") == 0 and ra.get("locks") == []
            and ra.get("isNewBest") is True and ra.get("hashMatch") is True
            and isinstance(ra.get("timeSec"), (int, float)) and ra["timeSec"] >= a.get("inj", 9e9) - 0.01
            and ra["timeSec"] <= a.get("inj", 0) + 1.5
            and a.get("ui") == "result" and a.get("panelVisible") and a.get("levelResultStars") == 3
            and (a.get("best") or {}).get("stars") == 3)
    checks.append(("A：零死亡全过 → 3 星 + 结算面板 + 最佳成绩落库", ok_a,
                   f"r={json.dumps(ra, ensure_ascii=False)} inj={a.get('inj')} ui={a.get('ui')} panel={a.get('panelVisible')} best={a.get('best')}"))
    checks.append(("B：答错一次再对（tries=2 solved）+ 锁翻转", b.get("quizOpen") is True and b.get("kpSolved") is True
                   and (b.get("ans") or {}).get("tries") == 2 and (b.get("ans") or {}).get("solved") is True,
                   f"quiz={b.get('quizOpen')} kp={b.get('kpSolved')} ans={b.get('ans')}"))
    ok_b = (rb.get("deaths") == 1 and rb.get("stars") == 2
            and rb.get("locks") and rb["locks"][0].get("tries") == 2 and rb["locks"][0].get("solved") is True)
    checks.append(("B：deaths=1+锁 tries=2 → 2 星，明细对", ok_b, f"r={json.dumps(rb, ensure_ascii=False)}"))
    ok_c = (c.get("timeout") is True and c.get("stars") == 0 and c.get("ui") == "result"
            and c.get("panelVisible") is True and (c.get("timeSec") or 0) >= 3
            and c.get("bestStars") == 0)
    checks.append(("C：timeLimit=3 超时 → 失败面板（timeout/stars=0/零星不刷新）", ok_c,
                   f"{json.dumps(c, ensure_ascii=False)}"))
    return lib.report("W03 终点结算", res, checks)


def w04(e2e):
    """W04 锁具联动：真键盘答对 → 锁翻转 → 红石开门 + recordLockAttempt 记账。"""
    res = e2e.run(WPX + r"""
await scene();
const card=await buildCard('W04', provAt(44,20,41,
  {subject:'math',kind:'input',stem:'3×4+5',answer:17,hint:'先乘后加'},2));
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const run=await enter(card);
if(!run) return JSON.stringify({__error__:'enterLevel null'});
const kw=emb(card,44,20,41), dw=emb(card,45,20,41);
const kp0=gb(kw.x,kw.y,kw.z);
const door0=cfg.doorOpen(gb(dw.x,dw.y,dw.z));
const doorUpper0=cfg.doorOpen(gb(dw.x,dw.y+1,dw.z));
// 真键盘流：右键答题机（公开入口 interactKeypadAt）→ window 键盘事件作答
teleport(kw.x+0.5,kw.y+1,kw.z+2.5);
await ek.interactKeypadAt(kw.x,kw.y,kw.z);
const quizOpen=document.getElementById('edu-quiz').style.display==='block';
await typeDigits(17); await sleep(150);
await tick(4);   // 红石 tick 翻门（上升沿开门）
const kp1=gb(kw.x,kw.y,kw.z);
const door1=cfg.doorOpen(gb(dw.x,dw.y,dw.z));
const doorUpper1=cfg.doorOpen(gb(dw.x,dw.y+1,dw.z));
const ans=S.levelRun.answers[qkey(card.questions[0])];
const quizClosed=document.getElementById('edu-quiz').style.display!=='block';
const uiNow=um.getUIState();
await endCase();
return JSON.stringify({kp0,door0,doorUpper0,quizOpen,kp1,door1,doorUpper1,ans,quizClosed,ui:uiNow});
""")
    if not isinstance(res, dict) or "kp1" not in res:
        return lib.report("W04 锁具联动", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("初始：锁锁定 + 门关", res["kp0"] == 224 and res["door0"] == 0 and res["doorUpper0"] == 0,
         f"kp={res['kp0']} door={res['door0']}/{res['doorUpper0']}"),
        ("右键答题机弹出卡题（真键盘流就绪）", res["quizOpen"] is True, str(res["quizOpen"])),
        ("答对 → 锁翻转 keypadId(1)=225", res["kp1"] == 225, f"{res['kp0']} → {res['kp1']}"),
        ("红石联动 → 门开（上下两扇）", res["door1"] == 1 and res["doorUpper1"] == 1,
         f"door={res['door1']}/{res['doorUpper1']}"),
        ("answers 记账 tries=1 solved=true", (res["ans"] or {}).get("tries") == 1 and (res["ans"] or {}).get("solved") is True,
         str(res["ans"])),
        ("答完卡收起 + 仍在游戏态", res["quizClosed"] and res["ui"] == "playing", f"closed={res['quizClosed']} ui={res['ui']}"),
    ]
    return lib.report("W04 锁具联动", res, checks)


def w05(e2e):
    """W05 出题校验：未双通过拒/选项重复拒/数字范围拒/meta.draft 降 warning。"""
    res = e2e.run(WPX + r"""
await scene();
const base=await buildCard('W05', provAt(44,20,41,inQ(17),2));
if(!base||base.error) return JSON.stringify({__error__:'buildCard:'+(base&&base.error||'null')});
const v0=lws.validateLevelCard(base);
// 未双通过（verifiedPasses=1）→ error
const c1=structuredClone(base); c1.questions[0].meta.verifiedPasses=1;
const v1=lws.validateLevelCard(c1);
// meta.draft=true → 双通过降 warning（errors 清空）
const c2=structuredClone(c1); c2.meta={draft:true};
const v2=lws.validateLevelCard(c2);
// 选项重复 → error
const c3=structuredClone(base); const q0=c3.questions[0];
c3.questions=[Object.assign({},q0,{kind:'choice',stem:'重复选项题',options:['甲','甲','乙'],answer:0})];
const v3=lws.validateLevelCard(c3);
// input 答案 10000 → error
const c4=structuredClone(base); c4.questions[0].answer=10000;
const v4=lws.validateLevelCard(c4);
const has=(v,kw)=>[].concat(v.errors,v.warnings).join('｜').indexOf(kw)>=0;
return JSON.stringify({
  v0ok:v0.ok,
  v1ok:v1.ok, v1err:v1.errors.join('｜'),
  v2ok:v2.ok, v2errN:v2.errors.length, v2warn:v2.warnings.join('｜'),
  v3ok:v3.ok, v3err:v3.errors.join('｜'),
  v4ok:v4.ok, v4err:v4.errors.join('｜')});
""")
    if not isinstance(res, dict) or "v0ok" not in res:
        return lib.report("W05 出题校验", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("基线卡（双通过）validate 通过", res["v0ok"] is True, str(res["v0ok"])),
        ("verifiedPasses=1 → errors 含双通过项", res["v1ok"] is False and "双通过" in res["v1err"], res["v1err"][:160]),
        ("meta.draft=true → 全部降 warning（errors=0 且 warning 含双通过）",
         res["v2ok"] is True and res["v2errN"] == 0 and "双通过" in res["v2warn"],
         f"errors={res['v2errN']} warn={res['v2warn'][:120]}"),
        ("选项重复 → errors 含重复项", res["v3ok"] is False and "重复" in res["v3err"], res["v3err"][:160]),
        ("input 答案 10000 → errors 含范围项", res["v4ok"] is False and ("0..9999" in res["v4err"] or "数字题" in res["v4err"]),
         res["v4err"][:160]),
    ]
    return lib.report("W05 出题校验", res, checks)


def w06(e2e):
    """W06 卡片回环：出卡→导出→删→导入→逐字段深比较 + 锁坐标映射。"""
    res = e2e.run(WPX + r"""
await scene();
const card=await buildCard('W06', provAt(44,20,41,inQ(17),2));
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const saved=await lws.saveLevelCard(card);
const text=lws.exportLevelCardJson(card);
const del=await lws.deleteLevelCard(saved.id);
const gone=await lws.getLevelCard(saved.id);
const imp=await lws.importLevelCardFromJson(text);
const card2=await lws.getLevelCard(imp.id);
const cmp = card2 ? {
  idSame: imp.id===saved.id,
  head: ['format','name','author','created','version'].every(k=>card[k]===card2[k]),
  region: ['x0','y0','z0','w','h','d','enc','blocks'].every(k=>card.region[k]===card2.region[k]),
  questions: JSON.stringify(card.questions)===JSON.stringify(card2.questions),
  rules: JSON.stringify(card.rules)===JSON.stringify(card2.rules),
  flags: JSON.stringify(card.flags)===JSON.stringify(card2.flags),
  full: text===JSON.stringify(card2),
} : null;
// 锁坐标映射：卡内局部 = 作者世界 - region 原点
const q=card.questions[0];
const mapOK = q && q.x===44-card.region.x0 && q.y===20-card.region.y0 && q.z===41-card.region.z0;
return JSON.stringify({savedId:saved.id, del, goneNull:gone===null, impOk:imp.ok, cmp, mapOK,
  qLocal:q&&{x:q.x,y:q.y,z:q.z}, rOrigin:{x0:card.region.x0,y0:card.region.y0,z0:card.region.z0}});
""")
    if not isinstance(res, dict) or "cmp" not in res:
        return lib.report("W06 卡片回环", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    c = res.get("cmp") or {}
    checks = [
        ("保存成功", bool(res.get("savedId")), str(res.get("savedId"))[:60]),
        ("删除命中", res.get("del") is True, str(res.get("del"))),
        ("删除后取卡为 null", res.get("goneNull") is True, str(res.get("goneNull"))),
        ("导入成功且 id 一致", res.get("impOk") is True and c.get("idSame"), f"impOk={res.get('impOk')} idSame={c.get('idSame')}"),
        ("头部字段逐一致（format/name/author/created/version）", c.get("head") is True, str(c.get("head"))),
        ("region 逐字段一致（含 RLE blocks 字节串）", c.get("region") is True, str(c.get("region"))),
        ("questions/rules/flags 深比较一致", c.get("questions") and c.get("rules") and c.get("flags"),
         f"q={c.get('questions')} rules={c.get('rules')} flags={c.get('flags')}"),
        ("整卡 JSON 字节级一致", c.get("full") is True, str(c.get("full"))),
        ("锁坐标映射（局部=作者-region 原点）", res.get("mapOK") is True,
         f"qLocal={res.get('qLocal')} origin={res.get('rOrigin')}"),
    ]
    return lib.report("W06 卡片回环", res, checks)


def w07(e2e):
    """W07 嵌入展开：固定偏移/坐标映射/四周空气/y=0 基岩/出生=起点旗。"""
    res = e2e.run(WPX + r"""
await scene();
const card=await buildCard('W07', provAt(44,20,41,inQ(17),2));
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const run=await enter(card);
if(!run) return JSON.stringify({__error__:'enterLevel null'});
const r=card.region, fW=L2W(card.flags.start), kw=emb(card,44,20,41);
// 作者平台任取一点（42,19,42）→ 嵌入位 stone，直接验证坐标映射链
const pw=emb(card,42,19,42);
const spawnOK = run.spawn.x===fW.x && run.spawn.y===fW.y && run.spawn.z===fW.z;
const flagOK = gb(fW.x,fW.y,fW.z)===cfg.FLAG_BASE+cfg.FLAG_START;
const keypadOK = gb(kw.x,kw.y,kw.z)===cfg.KEYPAD_BASE;
const stoneOK = gb(pw.x,pw.y,pw.z)===BT.STONE;
const bedrockY0 = gb(90,0,90)===BT.BEDROCK && gb(0,0,0)===BT.BEDROCK;
const air = {
  west:  gb(OFF.x-1, OFF.y+2, OFF.z+2),
  east:  gb(OFF.x+r.w+1, OFF.y+2, OFF.z+2),
  north: gb(OFF.x+2, OFF.y+2, OFF.z-1),
  south: gb(OFF.x+2, OFF.y+2, OFF.z+r.d+1),
  top:   gb(OFF.x+2, OFF.y+r.h+1, OFF.z+2),
};
const airAll = air.west===0&&air.east===0&&air.north===0&&air.south===0&&air.top===0;
await endCase();
return JSON.stringify({spawn:run.spawn, fW, spawnOK, flagOK, keypadOK, stoneOK, bedrockY0, air, airAll,
  off:OFF, region:{x0:r.x0,y0:r.y0,z0:r.z0,w:r.w,h:r.h,d:r.d}});
""")
    if not isinstance(res, dict) or "spawnOK" not in res:
        return lib.report("W07 嵌入展开", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("出生点=起点旗世界坐标", res["spawnOK"], f"spawn={res['spawn']} flag={res['fW']}"),
        ("起点旗落位（ID=229）", res["flagOK"], str(res["flagOK"])),
        ("作者锁→嵌入位坐标映射", res["keypadOK"], str(res["keypadOK"])),
        ("作者地形→嵌入位坐标映射（平台石板）", res["stoneOK"], str(res["stoneOK"])),
        ("y=0 全基岩层", res["bedrockY0"], str(res["bedrockY0"])),
        ("四周与顶部全空气", res["airAll"], json.dumps(res["air"])),
    ]
    return lib.report("W07 嵌入展开", res, checks)


def w08(e2e):
    """W08 性能门：enterLevel（含全量 rebuild）<3000ms（P01 门风格；基线×1.2 原则，按实测收紧）。"""
    res = e2e.run(WPX + r"""
await scene();
// 适当加料：半圈石墙让 region 内容更接近真实关卡
for(let x=40;x<=47;x++){ sb(x,20,40,BT.STONE); sb(x,21,40,BT.STONE); }
for(let z=40;z<=49;z+=9){ sb(40,20,z,BT.STONE); sb(40,21,z,BT.STONE); }
const card=await buildCard('W08', provAt(44,20,41,inQ(17),2));
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const t0=performance.now();
const run=await lr.enterLevel(card);
const ms=Math.round(performance.now()-t0);
await sleep(400); await tick(2);
await endCase();
return JSON.stringify({ms, active:!!run, region:card.region});
""")
    if not isinstance(res, dict) or "ms" not in res:
        return lib.report("W08 性能门", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("进关成功（run 激活）", res["active"] is True, str(res["active"])),
        ("enterLevel（含 rebuild）<3000ms（P01 门风格；实测见证据，后续按基线×1.2 收紧）",
         res["ms"] < 3000, f"实测 {res['ms']}ms，region={json.dumps(res['region'])}"),
    ]
    return lib.report("W08 性能门", res, checks)


def w09(e2e):
    """W09 成绩持久：通关→getBestScores 有值→整页重载→成绩仍在（hash 确定性重建 + IndexedDB 双证）。"""
    # 阶段 1：通关拿成绩（锁不答 → stars=2；W09 只验持久化，星级非重点）
    res1 = e2e.run("localStorage.removeItem('mcweb.levels.v1');\n" + WPX + r"""
await scene();
const card=await buildCard('W09', provAt(44,20,41,inQ(17),2));
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const saved=await lws.saveLevelCard(card);   // 卡落 IndexedDB（或会话），重载后借此找回 cardHash
const run=await enter(card);
if(!run) return JSON.stringify({__error__:'enterLevel null'});
const gW=L2W(card.flags.goal);
teleport(gW.x+0.5,gW.y+1,gW.z+0.5);
const r=lr.tickLevelRun(0.05);
const best=lr.getBestScores(run.cardHash);
const id=saved.id, so=!!saved.sessionOnly;
await endCase();
return JSON.stringify({id, so, hash:run.cardHash, stars:r&&r.stars, best});
""")
    if not isinstance(res1, dict) or "id" not in res1:
        return lib.report("W09 成绩持久", {"__error__": f"阶段1异常: {str(res1)[:300]}"}, [])
    e2e.page.nav(lib.BASE + "/", settle=6.0)  # 整页重载（别用 fresh_page：它只清 mcweb.save*）
    body = WPX + r"""
// 证 A：IndexedDB/会话里按 id 找回卡 → cardHash 一致
const card=await lws.getLevelCard(__ID__);
const foundHash=card?lws.cardHash(card):null;
// 证 B：hash 确定性——重载后世界由存档恢复（含同一布景），重建同卡必须得到同一 hash
const card2=await buildCard('W09', provAt(44,20,41,inQ(17),2));
const rebuiltHash=card2&&!card2.error?lws.cardHash(card2):null;
// IndexedDB 原始行（诊断用）
let rows=null, idbErr=null;
try{const req=indexedDB.open('mcweb-levels',1);
  const db=await new Promise((rs,rj)=>{req.onsuccess=()=>rs(req.result);req.onerror=()=>rj(req.error);});
  rows=(await new Promise((rs,rj)=>{const g=db.transaction('cards','readonly').objectStore('cards').getAll();
    g.onsuccess=()=>rs(g.result);g.onerror=()=>rj(g.error);})).map(r=>r.id);
  db.close();}catch(e){idbErr=String(e);}
const best=lr.getBestScores(rebuiltHash||foundHash);
return JSON.stringify({found:!!card, foundHash, rebuiltHash, idbErr, rows, best});
""".replace("__ID__", json.dumps(res1["id"]))
    res2 = e2e.run(body)
    if not isinstance(res2, dict) or "best" not in res2:
        return lib.report("W09 成绩持久", {"__error__": f"阶段2异常: {str(res2)[:300]}"}, [])
    b1, b2 = res1.get("best") or {}, res2.get("best") or {}
    checks = [
        ("通关（锁未答 → stars=2，≥1 即通关）", res1.get("stars") == 2, str(res1.get("stars"))),
        ("通关后 getBestScores 有值", b1.get("stars") == 2, json.dumps(b1)),
        ("重载后按 id 找回卡（IndexedDB 持久）", res2.get("found") is True,
         f"found={res2.get('found')} so={res1.get('so')} rows={res2.get('rows')} idbErr={res2.get('idbErr')}"),
        ("重载后 hash 一致（找回/重建 双证）",
         res2.get("foundHash") == res1.get("hash") and res2.get("rebuiltHash") == res1.get("hash"),
         f"原={res1.get('hash')} 找回={res2.get('foundHash')} 重建={res2.get('rebuiltHash')}"),
        ("重载后成绩仍在（逐字段一致）", b1 == b2 and b1.get("stars") == 2, f"前={json.dumps(b1)} 后={json.dumps(b2)}"),
    ]
    return lib.report("W09 成绩持久", {"phase1": res1, "phase2": res2}, checks)


def w10(e2e):
    """W10 存档防线：关卡中手动保存+pagehide 均不落盘；退出恢复进关前世界与玩家。"""
    res = e2e.run(WPX + r"""
// 玩家停到固定石台（防重力/摔落把坐标漂走）
sb(64,39,64,BT.STONE);
teleport(64.5,40,64.5);
sg.saveGame();
sb(60,20,60,BT.STONE);          // 进关前世界标记块
sg.saveGame();
const bytes1=localStorage.getItem('mcweb.save.v1.slot0');
const pBefore={x:S.player.x,y:S.player.y,z:S.player.z};
await scene();
const card=await buildCard('W10', provAt(44,20,41,inQ(17),2));
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
teleport(64.5,40,64.5);         // 紧贴进关前再钉一次位
const run=await enter(card);
if(!run) return JSON.stringify({__error__:'enterLevel null'});
const markerGone=gb(60,20,60)===BT.AIR;   // 关卡世界=清零重嵌，进关前标记必消失
const bytes2=localStorage.getItem('mcweb.save.v1.slot0');  // enterLevel 自己的合法落盘（进关前）
// —— 手动保存：拒写且字节不变 ——
const ret=sg.saveGame();
const bytes3=localStorage.getItem('mcweb.save.v1.slot0');
// —— pagehide 兜底通道：同样拒写 ——
window.dispatchEvent(new Event('pagehide'));
await sleep(300);
const bytes4=localStorage.getItem('mcweb.save.v1.slot0');
// —— 退出：loadGame 恢复进关前世界与玩家 ——
await exitRun(true);
const markerBack=gb(60,20,60)===BT.STONE;
const pAfter={x:S.player.x,y:S.player.y,z:S.player.z};
const restored=Math.abs(pAfter.x-pBefore.x)<0.01&&Math.abs(pAfter.y-pBefore.y)<0.05&&Math.abs(pAfter.z-pBefore.z)<0.01;
const ret2=sg.saveGame();
return JSON.stringify({bytes1Len:bytes1?bytes1.length:0, markerGone, ret, bytesSame:(bytes3===bytes2&&bytes4===bytes2),
  markerBack, pBefore, pAfter, restored, ret2, runNull:!S.levelRun});
""")
    if not isinstance(res, dict) or "ret" not in res:
        return lib.report("W10 存档防线", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("进关前存档在盘（字节非空）", res["bytes1Len"] > 0, str(res["bytes1Len"])),
        ("关卡世界已换（进关前标记块消失）", res["markerGone"], str(res["markerGone"])),
        ("关卡中手动保存拒写（返回 false）", res["ret"] is False, str(res["ret"])),
        ("手动保存+pagehide 后槽位字节不变", res["bytesSame"] is True, str(res["bytesSame"])),
        ("退出后标记块恢复（loadGame 回进关前世界）", res["markerBack"], str(res["markerBack"])),
        ("玩家坐标恢复一致", res["restored"], f"前={res['pBefore']} 后={res['pAfter']}"),
        ("退出后恢复正常写", res["ret2"] is True, str(res["ret2"])),
        ("levelRun 清空", res["runNull"], str(res["runNull"])),
    ]
    return lib.report("W10 存档防线", res, checks)


def w11(e2e):
    """W11 绕过通道全闭：右键门手开无效/M/F/F6/双击空格/中键全拒/正午锁/8s 无怪。"""
    res = e2e.run(WPX + r"""
await scene();
const card=await buildCard('W11', provAt(44,20,41,inQ(17),2));
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const run=await enter(card);
if(!run) return JSON.stringify({__error__:'enterLevel null'});
const noon0=S.time, half=S.dayLength/2;
const noonAtEnter=Math.abs(noon0-half)<3;   // enterLevel 锁正午；enter 助手的 settle 睡眠含 rAF 自然漂移
// —— 右键门手开（aim+placeBlock 玩家路径；斜对角机位=smoke 验证过的命中几何）——
const dw=emb(card,45,20,41);
const aim=aimScan(dw.x,dw.y,dw.z, dw.x+2.5, dw.y+0.5, dw.z+2.5);
let doorManual='aim-miss';
if(aim){ it.placeBlock(); await tick(2);
  doorManual=cfg.doorOpen(gb(dw.x,dw.y,dw.z))===0?'blocked':'OPENED(!)'; }
// —— M/F/F6/双击空格/中键 ——
pressDoc('KeyM'); await sleep(120); const modeAfterM=S.gameMode;
pressDoc('KeyF'); await sleep(120); const flyingF=S.player.flying;
const t0=S.time; pressDoc('F6'); await sleep(120);
const f6Delta=S.time-t0;
pressDoc('Space'); pressDoc('Space'); await sleep(160); const flyingSpace=S.player.flying;
S.player.selectedSlot=HB.indexOf(BT.PLANKS);
it.pickBlockUnderCrosshair();
const pickBlocked=S.player.selectedSlot===HB.indexOf(BT.PLANKS);
// —— 8s 观察：无怪生成 + 时间只自然漂移（无夜跳） ——
const samples=[];
for(let i=0;i<9;i++){ await sleep(900); samples.push(S.enemies.length); }
const enemiesMax=Math.max.apply(null,samples);
const drift=S.time-half;
await endCase();
return JSON.stringify({noonAtEnter,noon0,half,doorManual,modeAfterM,flyingF,f6Delta,flyingSpace,pickBlocked,
  enemiesMax,drift, samples});
""")
    if not isinstance(res, dict) or "doorManual" not in res:
        return lib.report("W11 绕过通道全闭", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("进关时间=正午（dayLength/2）", res["noonAtEnter"], f"time={res['noon0']:.1f} half={res['half']:.1f}"),
        ("右键门手开无效（玩家路径）", res["doorManual"] == "blocked", str(res["doorManual"])),
        ("M 不切模式", res["modeAfterM"] == "survival", str(res["modeAfterM"])),
        ("F 不飞行", res["flyingF"] is False, str(res["flyingF"])),
        ("F6 不改昼夜", abs(res["f6Delta"]) < 1.0, f"Δt={res['f6Delta']:.3f}s"),
        ("双击空格不飞行", res["flyingSpace"] is False, str(res["flyingSpace"])),
        ("中键不吸取", res["pickBlocked"], str(res["pickBlocked"])),
        ("8s 内无怪生成", res["enemiesMax"] == 0, f"max={res['enemiesMax']} samples={res['samples']}"),
        ("时间恒锁白昼（8s 后仍正午附近，无夜跳）", res["drift"] >= 0 and res["drift"] < 12, f"drift={res['drift']:.1f}s"),
    ]
    return lib.report("W11 绕过通道全闭", res, checks)


def w12(e2e):
    """W12 爆炸保护：TNT 炸锁/旗/门无效、普通方块照毁；普通世界同场景照常毁（回归面）。"""
    res = e2e.run(WPX + r"""
await scene();
sb(44,20,46,cfg.FLAG_BASE+cfg.FLAG_CHECKPOINT);  // cp 旗（TNT 北 2 格，保护对象）
sb(44,20,44,BT.TNT);                              // TNT： keypad(44,41)南3格 / cp 南2格 / 门斜3.2格
sb(44,23,44,BT.STONE);                            // 目击石（TNT 上方3格，必毁；region 内 y≤23）
const card=await buildCard('W12', provAt(44,20,41,inQ(17),2));
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const run=await enter(card);
if(!run) return JSON.stringify({__error__:'enterLevel null'});
const kw=emb(card,44,20,41), dw=emb(card,45,20,41), cw=emb(card,44,20,46),
      gw=emb(card,47,20,44), tw=emb(card,44,20,44), sw=emb(card,44,23,44);
const pre={kp:gb(kw.x,kw.y,kw.z), flag:gb(cw.x,cw.y,cw.z), door:gb(dw.x,dw.y,dw.z)};
// 玩家路径点燃：aim TNT → placeBlock（右键链 TNT 分支先于放置守卫）。
// 机位距 TNT 心 ~4.2 < 生存触及 4.5（闯关强制生存，5.2 不适用）
const aim=aimScan(tw.x,tw.y,tw.z, tw.x-2.2, tw.y+0.6, tw.z-2.2);
let ignited='aim-miss';
if(aim){ it.placeBlock(); ignited=S.tntEntities.length>0?'lit':'no-entity'; }
teleport(81.5,8,81.5);   // 撤到爆心 5 格外（region±2 内），免得被炸
for(let i=0;i<40&&S.tntEntities.length>0;i++){ tn.updateTnt(0.25); await sleep(30); }
await tick(2);
const post={
  kp:gb(kw.x,kw.y,kw.z), door:gb(dw.x,dw.y,dw.z), doorOpen:cfg.doorOpen(gb(dw.x,dw.y,dw.z)),
  cp:gb(cw.x,cw.y,cw.z), goal:gb(gw.x,gw.y,gw.z),
  tnt:gb(tw.x,tw.y,tw.z), stone:gb(sw.x,sw.y,sw.z)};
await exitRun(true);
// —— 普通世界同场景回归：无保护，锁与目击石照毁 ——
for(let x=24;x<27;x++)for(let z=44;z<47;z++)sb(x,29,z,BT.STONE);  // 安全看台
teleport(25.5,30,45.5);
tn.spawnTntEntity(44,20,44);
for(let i=0;i<40&&S.tntEntities.length>0;i++){ tn.updateTnt(0.25); await sleep(30); }
await tick(2);
const normal={kp:gb(44,20,41), stone:gb(44,23,44)};
return JSON.stringify({pre,ignited,post,normal});
""")
    if not isinstance(res, dict) or "post" not in res:
        return lib.report("W12 爆炸保护", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    pre, post, normal = res["pre"], res["post"], res["normal"]
    checks = [
        ("点燃成功（玩家右键路径）", res["ignited"] == "lit", str(res["ignited"])),
        ("爆炸前锁/旗/门在位", pre.get("kp") == 224 and pre.get("flag") == 230 and isinstance(pre.get("door"), int),
         json.dumps(pre)),
        ("锁免疫爆炸", post.get("kp") == 224, f"{pre.get('kp')} → {post.get('kp')}"),
        ("门免疫爆炸（仍关）", post.get("door") == pre.get("door") and post.get("doorOpen") == 0,
         f"door={pre.get('door')}→{post.get('door')} open={post.get('doorOpen')}"),
        ("检查点旗/终点旗免疫爆炸", post.get("cp") == 230 and post.get("goal") == 231,
         f"cp={post.get('cp')} goal={post.get('goal')}"),
        ("TNT 自身消耗", post.get("tnt") == 0, str(post.get("tnt"))),
        ("3 格外普通方块照毁（目击石）", post.get("stone") == 0, str(post.get("stone"))),
        ("普通世界同场景：锁被炸毁（保护仅限关卡）", normal.get("kp") == 0, str(normal.get("kp"))),
        ("普通世界同场景：目击石照毁（回归面）", normal.get("stone") == 0, str(normal.get("stone"))),
    ]
    return lib.report("W12 爆炸保护", res, checks)


def w13(e2e):
    """W13 幽灵建筑：buildQueue 残留不写进关卡世界，队列被清空。"""
    res = e2e.run(WPX + r"""
await scene();
const card=await buildCard('W13', provAt(44,20,41,inQ(17),2));
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
// 幽灵施工：189 格羊毛墙写作者坐标（入队后立刻进关，一格都不该落进关卡世界）
const ops=[];
for(let x=41;x<=47;x++)for(let z=40;z<=48;z++)for(let y=21;y<=23;y++)ops.push([x,y,z,BT.WOOL]);
const ghostP=bq.enqueueBuildOps('ghost',ops);
const run=await lr.enterLevel(card);   // 不等施工完成
await sleep(800); await tick(4);
let wool=0;
for(const op of ops){ if(gb(op[0],op[1],op[2])===BT.WOOL) wool++; }
const fW=L2W(card.flags.start);
const flagOK=gb(fW.x,fW.y,fW.z)===cfg.FLAG_BASE+cfg.FLAG_START;
const stt=bq.getBuildStatus();
const ghostRet=await ghostP;
await endCase();
return JSON.stringify({active:!!run, wool, flagOK, status:stt,
  ghostSkipped:ghostRet&&ghostRet.skipped&&ghostRet.skipped[0]});
""")
    if not isinstance(res, dict) or "wool" not in res:
        return lib.report("W13 幽灵建筑", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    stt = res.get("status") or {}
    checks = [
        ("进关成功", res["active"] is True, str(res["active"])),
        ("关卡世界无 ghost 方块（189 格羊毛 0 落地）", res["wool"] == 0, f"wool×{res['wool']}"),
        ("关卡内容完好（起点旗在位）", res["flagOK"], str(res["flagOK"])),
        ("getBuildStatus 队列已清（active=false）", stt.get("active") is False, json.dumps(stt)),
        ("挂起任务以「世界已切换」兑现（不悬死）", "世界已切换" in (res.get("ghostSkipped") or ""), str(res.get("ghostSkipped"))),
    ]
    return lib.report("W13 幽灵建筑", res, checks)


def w14(e2e):
    """W14 坐标映射：两把锁各自答题（一错一对/一直一对）→ answers 两 key 独立记账。"""
    res = e2e.run(WPX + r"""
await scrubAnchors();
setDay();
platform(40,38,10,10,20);
sb(40,20,38,cfg.FLAG_BASE+cfg.FLAG_START);
sb(48,20,46,cfg.FLAG_BASE+cfg.FLAG_GOAL);
sb(42,20,40,cfg.KEYPAD_BASE);   // 锁A
sb(46,20,44,cfg.KEYPAD_BASE);   // 锁B
const prov=(x,y,z)=>{
  if(x===42&&y===20&&z===40) return {question:{subject:'math',kind:'input',stem:'锁A：7+4',answer:11},verifiedPasses:2};
  if(x===46&&y===20&&z===44) return {question:{subject:'math',kind:'input',stem:'锁B：9+13',answer:22},verifiedPasses:2};
  return null; };
const card=await buildCard('W14', prov);
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const run=await enter(card);
if(!run) return JSON.stringify({__error__:'enterLevel null'});
const kA=emb(card,42,20,40), kB=emb(card,46,20,44);
// 锁A：错一次再对
teleport(kA.x+0.5,kA.y+1,kA.z+2.5);
await ek.interactKeypadAt(kA.x,kA.y,kA.z);
pressWin('Digit9'); await sleep(80); pressWin('Enter');
await sleep(1100);
await typeDigits(11); await sleep(150);
// 锁B：直接对
teleport(kB.x+0.5,kB.y+1,kB.z+2.5);
await ek.interactKeypadAt(kB.x,kB.y,kB.z);
await typeDigits(22); await sleep(150);
const keyA=qkey(card.questions.find(q=>q.stem.indexOf('锁A')===0));
const keyB=qkey(card.questions.find(q=>q.stem.indexOf('锁B')===0));
// 先在关卡态抓全断言素材，再收尾退出
const kpA=gb(kA.x,kA.y,kA.z), kpB=gb(kB.x,kB.y,kB.z);
const ansA=Object.assign({},S.levelRun.answers[keyA]), ansB=Object.assign({},S.levelRun.answers[keyB]);
await endCase();
return JSON.stringify({
  kpA, kpB, ansA, ansB, keyA, keyB, keysDistinct:keyA!==keyB});
""")
    if not isinstance(res, dict) or "ansA" not in res:
        return lib.report("W14 坐标映射", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    a, b = res.get("ansA") or {}, res.get("ansB") or {}
    checks = [
        ("两把锁都翻转为已解锁", res["kpA"] == 225 and res["kpB"] == 225,
         f"A={res['kpA']} B={res['kpB']}"),
        ("两把锁记账 key 独立", res["keysDistinct"], f"{res['keyA']} vs {res['keyB']}"),
        ("锁A（错+对）tries=2 solved=true", a.get("tries") == 2 and a.get("solved") is True, str(a)),
        ("锁B（一次对）tries=1 solved=true", b.get("tries") == 1 and b.get("solved") is True, str(b)),
    ]
    return lib.report("W14 坐标映射", res, checks)


def w15(e2e):
    """W15 重试重置：通关→再 enterLevel 同卡→锁回锁定/计时清零/deaths 清零/最佳成绩保留。"""
    res = e2e.run(WPX + r"""
await scene();
const card=await buildCard('W15', provAt(44,20,41,inQ(17),2));
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const hash=lws.cardHash(card);
let run=await enter(card);
if(!run) return JSON.stringify({__error__:'enterLevel null'});
const kw=emb(card,44,20,41);
teleport(kw.x+0.5,kw.y+1,kw.z+2.5);
await ek.interactKeypadAt(kw.x,kw.y,kw.z);
await typeDigits(17); await sleep(150);
const solvedId=gb(kw.x,kw.y,kw.z);
lr.tickLevelRun(1.4);                       // 计时注水
const gW=L2W(card.flags.goal);
teleport(gW.x+0.5,gW.y+1,gW.z+0.5);
const r1=lr.tickLevelRun(0.05);
const best1=lr.getBestScores(hash);
// —— 重试：同卡再进（运行中重入=重试式重嵌）。直调 enterLevel 并立即取值，
//      避开 enter 助手的 settle 睡眠——rAF 会在睡眠里推进 elapsed，污染「清零」断言 ——
run=await lr.enterLevel(card);
const elapsed0=run.elapsed, deaths0=run.deaths, answersN=Object.keys(run.answers).length;
const lockReset=gb(kw.x,kw.y,kw.z)===cfg.KEYPAD_BASE;
const best2=lr.getBestScores(hash);
await sleep(500); await tick(2);
await endCase();
return JSON.stringify({solvedId, r1Stars:r1&&r1.stars, best1, lockReset, elapsed0, deaths0, answersN, best2});
""")
    if not isinstance(res, dict) or "lockReset" not in res:
        return lib.report("W15 重试重置", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    b1, b2 = res.get("best1") or {}, res.get("best2") or {}
    checks = [
        ("首局答对翻转+3 星通关", res["solvedId"] == 225 and res["r1Stars"] == 3,
         f"solved={res['solvedId']} stars={res['r1Stars']}"),
        ("首局最佳成绩落库", b1.get("stars") == 3, json.dumps(b1)),
        ("重试后锁回锁定（KEYPAD_BASE）", res["lockReset"], str(res["lockReset"])),
        ("计时清零", res["elapsed0"] == 0, str(res["elapsed0"])),
        ("deaths 清零", res["deaths0"] == 0, str(res["deaths0"])),
        ("answers 清空", res["answersN"] == 0, str(res["answersN"])),
        ("最佳成绩保留（stars 不丢）", b2.get("stars") == 3, json.dumps(b2)),
        ("plays 累计到 2（进关计数）", b2.get("plays") == 2, str(b2.get("plays"))),
    ]
    return lib.report("W15 重试重置", res, checks)


def w16(e2e):
    """W16 出题可行性（真作者流）：算一算系统算答案→保存→双通过（真键盘）→默认 provider 出卡→validate ok。"""
    res = e2e.run(WPX + r"""
await scrubAnchors();
setDay();
platform(70,70,6,6,20);
sb(70,20,70,cfg.FLAG_BASE+cfg.FLAG_START);
sb(75,20,75,cfg.FLAG_BASE+cfg.FLAG_GOAL);
sb(72,20,72,cfg.KEYPAD_BASE);
teleport(72.5,21,74.5);   // 锁旁（走远巡检阈值 5 格内）
const opened=ek.interactKeypadAuthorAt(72,20,72);
const panelVisible=document.getElementById('edu-author').style.display==='block';
const q=(sel)=>document.querySelector('#edu-author '+sel);
// 填题干（真 input 事件驱动表单委托）
const stemEl=q('[data-field="stem"]');
stemEl.value='12+13'; stemEl.dispatchEvent(new Event('input',{bubbles:true}));
// 系统算答案（G2 P1-2：回显给作者）
q('[data-act="calc"]').click(); await sleep(120);
const ansShown=q('[data-field="ansIn"]') && q('[data-field="ansIn"]').value;
// 保存并校验 → 进入试答态
q('[data-act="save"]').click(); await sleep(120);
// 双通过（真键盘：数字+回车，作者面板 window 捕获语义）
pressWin('Digit2'); pressWin('Digit5'); pressWin('Enter'); await sleep(180);
pressWin('Digit2'); pressWin('Digit5'); pressWin('Enter'); await sleep(180);
const verified=ek.isLockVerified(72,20,72);
const meta=ek.getAuthoredLock(72,20,72);
// 默认锁题提供者（=getAuthoredLock）出卡 + 校验
const card=await lws.buildLevelCard({name:'W16',author:'e2e'});
const v=card&&card.error?null:lws.validateLevelCard(card);
const q0=card&&card.questions&&card.questions[0];
return JSON.stringify({opened,panelVisible,ansShown,verified,
  meta:meta&&{passes:meta.verifiedPasses,answer:meta.question.answer,stem:meta.question.stem},
  cardErr:card&&card.error||null, vOk:v&&v.ok, vErrs:v&&v.errors,
  q0:q0&&{stem:q0.stem,answer:q0.answer,passes:q0.meta&&q0.meta.verifiedPasses}});
""")
    if not isinstance(res, dict) or "verified" not in res:
        return lib.report("W16 出题可行性", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    m = res.get("meta") or {}
    q0 = res.get("q0") or {}
    checks = [
        ("作者面板打开（interactKeypadAuthorAt）", res["opened"] is True and res["panelVisible"],
         f"opened={res['opened']} panel={res['panelVisible']}"),
        ("「算一算」系统算答案并回显（12+13→25）", res["ansShown"] == "25", str(res["ansShown"])),
        ("双通过完成 isLockVerified=true", res["verified"] is True, str(res["verified"])),
        ("getAuthoredLock 带出 verifiedPasses=2/answer=25", m.get("passes") == 2 and m.get("answer") == 25,
         json.dumps(m, ensure_ascii=False)),
        ("默认 provider 出卡含该锁题", res["cardErr"] is None and q0.get("stem") == "12+13" and q0.get("answer") == 25,
         f"cardErr={res['cardErr']} q0={json.dumps(q0, ensure_ascii=False)}"),
        ("卡 questions[0].meta.verifiedPasses=2", q0.get("passes") == 2, str(q0.get("passes"))),
        ("validateLevelCard 通过", res["vOk"] is True, json.dumps(res.get("vErrs"), ensure_ascii=False)[:160]),
    ]
    return lib.report("W16 出题可行性", res, checks)


def w17(e2e):
    """W17 降级路径：IndexedDB 不可用 → saveLevelCard 会话兜底 sessionOnly=true，全程无异常。"""
    res = e2e.run(WPX + r"""
const realOpen=window.indexedDB.open;
window.indexedDB.open=function(){ throw new Error('w17 模拟 IndexedDB 不可用'); };
const card={format:'mcweb.level.v1',name:'W17降级卡',author:'e2e',created:new Date().toISOString(),version:1,
  region:{x0:0,y0:0,z0:0,w:1,h:1,d:1,enc:'rle',blocks:lws.u8ToBase64(new Uint8Array([1]))},
  questions:[],rules:{timeLimit:null,lockAIHelp:true},
  flags:{start:{x:0,y:0,z:0},checkpoints:[],goal:{x:0,y:0,z:0}}};
let saved=null, listed=null, fetched=null, threw=null, gotBack=null;
try{
  saved=await lws.saveLevelCard(card);
  listed=await lws.listLevelCards();
  fetched=await lws.getLevelCard(saved.id);
  gotBack=fetched&&fetched.name;
}catch(e){ threw=String(e&&(e.stack||e.message)||e); }
window.indexedDB.open=realOpen;
const inList=listed&&saved&&listed.some(r=>r.id===saved.id&&r.sessionOnly===true);
return JSON.stringify({threw, savedOk:saved&&saved.ok, sessionOnly:saved&&saved.sessionOnly,
  inList, gotBack, listedN:listed&&listed.length});
""")
    if not isinstance(res, dict) or "savedOk" not in res:
        return lib.report("W17 降级路径", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("全链无异常抛出", res["threw"] is None, str(res["threw"])[:200]),
        ("saveLevelCard ok=true + sessionOnly=true", res["savedOk"] is True and res["sessionOnly"] is True,
         f"ok={res['savedOk']} sessionOnly={res['sessionOnly']}"),
        ("listLevelCards 含该卡（标记仅本次会话）", res["inList"] is True, f"listedN={res['listedN']}"),
        ("getLevelCard 从会话取回", res["gotBack"] == "W17降级卡", str(res["gotBack"])),
    ]
    return lib.report("W17 降级路径", res, checks)


def w18(e2e):
    """W18 区域检测：噪声地形里旗+锁摆 8×6 → region=锚点包围盒+2（≤96/64/96）+ 贴边 clamp。"""
    res = e2e.run(WPX + r"""
// 默认噪声地形（fresh_page 后未动；先擦掉可能的快照串台锚点，本用例对「无锚点」强敏感）
await scrubAnchors();
const surf=(x,z)=>{for(let y=cfg.WORLD_HEIGHT-2;y>0;y--){const b=gb(x,y,z);
  if(b!==BT.AIR&&b!==BT.WATER)return y;}return 1;};
const X0=150,Z0=150;
const s1=surf(X0,Z0), s2=surf(X0+7,Z0+5), s3=surf(X0+3,Z0+2);
sb(X0,s1+1,Z0,cfg.FLAG_BASE+cfg.FLAG_START);
sb(X0+7,s2+1,Z0+5,cfg.FLAG_BASE+cfg.FLAG_GOAL);
sb(X0+3,s3+1,Z0+2,cfg.KEYPAD_BASE);
const ys=[s1+1,s2+1,s3+1];
const spanY=Math.max.apply(null,ys)-Math.min.apply(null,ys)+1;
const card=await lws.buildLevelCard({name:'W18',author:'e2e'});
if(!card||card.error) return JSON.stringify({__error__:'buildCard:'+(card&&card.error||'null')});
const r=card.region;
const dims={w:r.w,h:r.h,d:r.d};
const dimsOK = r.w<=8+4 && r.d<=6+4 && r.h<=spanY+4 && r.w<=96 && r.h<=64 && r.d<=96;
const containsAll = r.w>=8 && r.d>=6 && r.h>=spanY;
const v=lws.validateLevelCard(card);
// —— 边缘 clamp：贴世界 x=1 重摆 → region.x0 必须钳到 0 ——
sb(X0,s1+1,Z0,BT.AIR); sb(X0+7,s2+1,Z0+5,BT.AIR); sb(X0+3,s3+1,Z0+2,BT.AIR);
const s4=surf(1,64), s5=surf(4,67);
sb(1,s4+1,64,cfg.FLAG_BASE+cfg.FLAG_START);
sb(4,s5+1,67,cfg.FLAG_BASE+cfg.FLAG_GOAL);
const card2=await lws.buildLevelCard({name:'W18b',author:'e2e'});
const clampOK=card2&&card2.region&&card2.region.x0===0;
return JSON.stringify({dims,spanY,dimsOK,containsAll,vOk:v.ok,vWarn:v.warnings.length,
  clampOK, r2x0:card2&&card2.region&&card2.region.x0});
""")
    if not isinstance(res, dict) or "dims" not in res:
        return lib.report("W18 区域检测", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("region 尺寸 ≤ 锚点跨距+4（x:8→≤12, z:6→≤10, y:跨距+4）", res["dimsOK"] is True,
         f"dims={json.dumps(res['dims'])} spanY={res['spanY']}"),
        ("region 包含全部锚点（≥跨距）", res["containsAll"] is True, str(res["containsAll"])),
        ("region ≤ 96×64×96 上限", res["dims"]["w"] <= 96 and res["dims"]["h"] <= 64 and res["dims"]["d"] <= 96,
         json.dumps(res["dims"])),
        ("卡可校验（validate ok）", res["vOk"] is True, f"warnings={res['vWarn']}"),
        ("边缘 clamp：贴 x=1 锚点 → region.x0=0", res["clampOK"] is True, f"x0={res['r2x0']}"),
    ]
    return lib.report("W18 区域检测", res, checks)


def w19(e2e):
    """W19 试玩入口：作者出题→首屏 #btn-level-try→进关→答题→结算→Esc 退回首屏（G2 R4 全链）。"""
    res = e2e.run(WPX + r"""
await scene();
// —— 真作者流给锁出题（8+9=17），试玩卡才带题 ——
teleport(44.5,21,43.5);
ek.interactKeypadAuthorAt(44,20,41);
const qa=(sel)=>document.querySelector('#edu-author '+sel);
qa('[data-field="stem"]').value='8+9';
qa('[data-field="stem"]').dispatchEvent(new Event('input',{bubbles:true}));
qa('[data-act="calc"]').click(); await sleep(120);
qa('[data-act="save"]').click(); await sleep(120);
pressWin('Digit1');pressWin('Digit7');pressWin('Enter'); await sleep(160);
pressWin('Digit1');pressWin('Digit7');pressWin('Enter'); await sleep(160);
const authored=ek.isLockVerified(44,20,41);
// —— 首屏路径：title → 关卡列表 → ▶ 试玩当前世界 ——
um.setState('title'); await sleep(200);
ui.openLevelList(); await sleep(300);
const listShown=!document.getElementById('level-list').classList.contains('hidden');
document.getElementById('btn-level-try').click();
let active=false;
for(let i=0;i<60;i++){ await sleep(100); if(lr.isLevelRunActive()){active=true;break;} }
await sleep(500); await tick(2);
const tryName=S.levelRun&&S.levelRun.card.name;
const hasLock=S.levelRun&&S.levelRun.card.questions.length===1;
const uiIn=um.getUIState();
// —— 关卡内答题（嵌入坐标=局部+固定偏移）——
const q0=S.levelRun.card.questions[0];
const kw={x:q0.x+OFF.x,y:q0.y+OFF.y,z:q0.z+OFF.z};
teleport(kw.x+0.5,kw.y+1,kw.z+2.5);
await ek.interactKeypadAt(kw.x,kw.y,kw.z);
await typeDigits(17); await sleep(150);
const solved=gb(kw.x,kw.y,kw.z)===cfg.keypadId(1);
// —— 终点结算 ——
const g=S.levelRun.card.flags.goal;
teleport(g.x+OFF.x+0.5, g.y+OFF.y+1, g.z+OFF.z+0.5);
const r=lr.tickLevelRun(0.05);
await sleep(300); await tick(1);
const resultShown=um.getUIState()==='result';
const stars=r&&r.stars;
// —— Esc 退出回首屏（结算态退出语义）——
pressDoc('Escape'); await sleep(1000); await tick(2);
return JSON.stringify({authored,listShown,active,tryName,hasLock,uiIn,solved,stars,resultShown,
  uiAfter:um.getUIState(), runNullAfter:!S.levelRun});
""")
    if not isinstance(res, dict) or "active" not in res:
        return lib.report("W19 试玩入口", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("作者流出题双通过（锁可导出）", res["authored"] is True, str(res["authored"])),
        ("首屏关卡列表打开", res["listShown"] is True, str(res["listShown"])),
        ("#btn-level-try 点击 → levelRun 激活", res["active"] is True, str(res["active"])),
        ("试玩卡自动出卡（名=我的试玩关）且带锁题", res["tryName"] == "我的试玩关" and res["hasLock"] is True,
         f"name={res['tryName']} hasLock={res['hasLock']}"),
        ("进关回 playing 态", res["uiIn"] == "playing", str(res["uiIn"])),
        ("关卡内答题解锁", res["solved"] is True, str(res["solved"])),
        ("踩终点 → 结算面板（3 星：零死亡一次过）", res["resultShown"] and res["stars"] == 3,
         f"shown={res['resultShown']} stars={res['stars']}"),
        ("Esc → 退出关卡回首屏（levelRun 清空）", res["uiAfter"] == "title" and res["runNullAfter"],
         f"ui={res['uiAfter']} runNull={res['runNullAfter']}"),
    ]
    return lib.report("W19 试玩入口", res, checks)


CASES = {"W%02d" % i: fn for i, fn in enumerate(
    [w01, w02, w03, w04, w05, w06, w07, w08, w09, w10,
     w11, w12, w13, w14, w15, w16, w17, w18, w19], start=1)}

if __name__ == "__main__":
    names = sys.argv[1:] or list(CASES)
    e2e = lib.E2E()
    results = {}
    try:
        for n in names:
            e2e.fresh_page()   # 每用例独立世界+回 playing 态（作者面板/答题卡键盘语义依赖 playing）
            results[n] = CASES[n](e2e)
    finally:
        e2e.close()
    print("\n==== W 套件汇总（run_workshop 冻结清单 W01~W19）====")
    n_pass = 0
    for n, ok in results.items():
        n_pass += 1 if ok else 0
        print(f"  {n}: {'PASS' if ok else 'FAIL'}")
    print(f"  合计 {n_pass}/{len(results)} PASS，{len(results) - n_pass} FAIL")
    sys.exit(0 if n_pass == len(results) else 1)
