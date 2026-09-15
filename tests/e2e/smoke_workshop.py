# -*- coding: utf-8 -*-
"""关卡工坊烟雾验证（W 套件前的集成冒烟）：模块图加载 / 进关全链 / 守卫 / 结算 / 存档防线。

跑法：cd tests/e2e && CDP_PORT=19401 python3 smoke_workshop.py
"""

import json
import sys

import lib


# ---------------------------------------------------------------- SM-01 进关全链
def sm_01(e2e):
    res = e2e.run(r"""
const [lr, lws, ek] = await Promise.all([
  import(B+'levelRun.js'), import(B+'levelWorkshop.js'), import(B+'eduKeypad.js')]);
const expOK = {
  lr: ['enterLevel','exitLevelRun','tickLevelRun','isLevelRunActive'].every(k=>typeof lr[k]==='function'),
  lws: ['buildLevelCard','validateLevelCard','embedLevelToWorld'].every(k=>typeof lws[k]==='function'),
  ekAuthor: typeof ek.interactKeypadAuthorAt === 'function',
};
// ---- 作者世界：平台上放 起点旗/答题机/门(两格)/终点旗 ----
setDay();
platform(40,40,8,10,20);
sb(41,20,41, cfg.FLAG_BASE + cfg.FLAG_START);
sb(44,20,41, cfg.KEYPAD_BASE);
sb(45,20,41, cfg.doorId(0,0,3)); sb(45,21,41, cfg.doorId(1,0,3));
sb(47,20,44, cfg.FLAG_BASE + cfg.FLAG_GOAL);
await tick(2);
const card = await lws.buildLevelCard({name:'烟雾关', author:'t'});
if (!card || card.error) return JSON.stringify({__error__:'buildLevelCard: '+(card&&card.error||'null')});
const v = lws.validateLevelCard(card);
const enterRet = await lr.enterLevel(card);
await sleep(700); await tick(4);
const run = S.levelRun;
const mid = { runActive: !!run, enterRetNull: enterRet === null };
if (run) {
  mid.spawn = { ...run.spawn };
  mid.player = { x:S.player.x, y:S.player.y };
  mid.flagAtSpawn = gb(run.spawn.x, run.spawn.y, run.spawn.z);
  mid.flagExpect = cfg.FLAG_BASE + cfg.FLAG_START;
  mid.bedrock = gb(90,0,90); mid.bedrockConst = BT.BEDROCK;
  mid.airOutside = gb(70,30,70);
  // 破坏守卫（interaction.breakBlockAt 公开入口）
  try {
    it.breakBlockAt({x:run.spawn.x, y:run.spawn.y, z:run.spawn.z, face:{dx:1,dy:0,dz:0}});
    mid.breakBlocked = gb(run.spawn.x, run.spawn.y, run.spawn.z) === mid.flagExpect ? 'blocked' : 'CHANGED';
  } catch(e) { mid.breakBlocked = 'threw'; }
  // 嵌入区内扫门与锁
  let doorW=null, kw=null;
  for (let wx=78; wx<94 && !(doorW&&kw); wx++)
    for (let wy=3; wy<14 && !(doorW&&kw); wy++)
      for (let wz=78; wz<94 && !(doorW&&kw); wz++) {
        const idHere = gb(wx,wy,wz);
        if (!doorW && cfg.isDoorId(idHere) && cfg.doorHalf(idHere)===0) doorW = {x:wx,y:wy,z:wz};
        if (!kw && idHere===cfg.KEYPAD_BASE) kw = {x:wx,y:wy,z:wz};
      }
  mid.found = { door: !!doorW, keypad: !!kw };
  if (doorW) {
    // 门右键守卫（玩家路径）：aimScan 摆机位→placeBlock()（右键链入口），闯关中须拒
    const aim = aimScan(doorW.x, doorW.y, doorW.z, doorW.x+2.5, doorW.y+0.5, doorW.z+2.5);
    if (aim) {
      it.placeBlock();
      await tick(2);
      mid.doorManual = cfg.doorOpen(gb(doorW.x,doorW.y,doorW.z)) === 0 ? 'blocked' : 'OPENED(!)';
    } else mid.doorManual = 'aim-miss';
    // 答对锁 → 红石 → 门开（真答对流程归 W 套件，这里直翻变体验证联动）
    if (kw) {
      sb(kw.x,kw.y,kw.z, cfg.keypadId(1));
      rs.updateRedstoneNetwork();
      await tick(3);
      mid.doorAfterSolve = cfg.doorOpen(gb(doorW.x,doorW.y,doorW.z)) === 1 ? 'opened' : 'still-closed';
    }
  }
  // 终点结算
  const goalW = lws.localToWorld(card.flags.goal.x, card.flags.goal.y, card.flags.goal.z);
  S.player.x = goalW.x+0.5; S.player.y = goalW.y+1; S.player.z = goalW.z+0.5;
  S.player.vx = S.player.vy = S.player.vz = 0;
  lr.tickLevelRun(0.05); await sleep(400); await tick(2);
  mid.resultShown = !!S.levelResult && !document.getElementById('result-panel').classList.contains('hidden');
  mid.hudVisible = document.getElementById('level-hud').classList.contains('visible');
}
// ---- 退出恢复：只看 levelRun 清空与回存档世界 ----
await lr.exitLevelRun({toTitle:true});
await sleep(700); await tick(2);
const afterExit = { runNull: !S.levelRun, ui: um.getUIState(), playerRestored: {x:S.player.x, y:S.player.y} };
return JSON.stringify({ expOK, validate:{ok:v.ok, errors:v.errors, warnings:v.warnings}, mid, afterExit });
""")
    if not isinstance(res, dict) or "mid" not in res:
        return lib.report("SM-01 进关全链", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    mid = res["mid"]
    checks = [
        ("三模块导出齐全（含 B3 作者入口）", all(res["expOK"].values()), json.dumps(res["expOK"])),
        ("validateLevelCard 通过", res["validate"]["ok"] is True, json.dumps(res["validate"], ensure_ascii=False)[:120]),
        ("进关激活且出生在起点旗", mid.get("runActive") and not mid.get("enterRetNull") and mid.get("player", {}).get("x") == mid.get("spawn", {}).get("x", -1) + 0.5, f"spawn={mid.get('spawn')} player={mid.get('player')} enterRetNull={mid.get('enterRetNull')}"),
        ("嵌入落位（起点旗/基岩/界外空气）", mid.get("flagAtSpawn") == mid.get("flagExpect") and mid.get("bedrock") == mid.get("bedrockConst") and mid.get("airOutside") == 0, f"flag={mid.get('flagAtSpawn')}/{mid.get('flagExpect')} bed={mid.get('bedrock')}/{mid.get('bedrockConst')} air={mid.get('airOutside')}"),
        ("闯关中破坏被拒", mid.get("breakBlocked") == "blocked", str(mid.get("breakBlocked"))),
        ("门与锁都在嵌入区", all(mid.get("found", {}).values()), str(mid.get("found"))),
        ("门右键守卫（玩家路径）", mid.get("doorManual") == "blocked", str(mid.get("doorManual"))),
        ("答对锁→门开（红石联动）", mid.get("doorAfterSolve") == "opened", str(mid.get("doorAfterSolve"))),
        ("终点结算面板 + 计时 HUD", mid.get("resultShown") and mid.get("hudVisible"), f"result={mid.get('resultShown')} hud={mid.get('hudVisible')}"),
        ("退出后 levelRun 清空回首屏且玩家回原世界", res["afterExit"]["runNull"] and res["afterExit"]["ui"] == "title", str(res["afterExit"])),
    ]
    return lib.report("SM-01 进关全链", res, checks)


# ---------------------------------------------------------------- SM-02 存档防线
def sm_02(e2e):
    res = e2e.run(r"""
clearSaves();
S.saveSlot = 0;
sg.saveGame();
const key = 'mcweb.save.v1.slot0';
const before = localStorage.getItem(key);
// 模拟闯关激活：saveGame 必须拒写（G2 R2 唯一防线）
S.levelRun = { cardId: 'fake', card: {region:{x0:80,y0:4,z0:80,w:4,h:4,d:4}} };
const ret = sg.saveGame();
S.levelRun = null;
const after = localStorage.getItem(key);
// 恢复后正常写不受影响
const ret2 = sg.saveGame();
const after2 = localStorage.getItem(key);
return JSON.stringify({beforeLen: before ? before.length : 0, ret, afterLen: after ? after.length : 0,
                       unchanged: before === after, ret2, written: after2 !== after, log: LOG});
""")
    if not isinstance(res, dict) or "unchanged" not in res:
        return lib.report("SM-02 存档防线", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("闯关中 saveGame 拒写（返回 false）", res["ret"] is False, str(res["ret"])),
        ("槽位字节级不变", res["unchanged"] is True, f"{res['beforeLen']} -> {res['afterLen']}"),
        ("退出后恢复正常写（新内容落盘）", res["ret2"] is True and res["written"] is True, "ret2=%s changed=%s" % (res["ret2"], res["written"])),
    ]
    return lib.report("SM-02 存档防线", res, checks)


CASES = {"SM-01": sm_01, "SM-02": sm_02}

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
