# -*- coding: utf-8 -*-
"""世界扩容验收（2026-09-06，256×256×128 + 存档 v4 dims + 老档迁移）。

断言素材（铁铁律）：state.blocks 字节级对比；getBlock / generateTerrainHeight /
saveGame / loadGame 公开入口；localStorage 原始存档 JSON 解析。
M1 用「当前世界盒提取 → 伪造成 v3 老档 → 读档迁移」做全量字节对比
（迁移结果应与同种子新生成完全一致，仅玩家改动格不同）——这是衔接性与保真度的最强校验。

重跑：cd tests/e2e && python3 run_migrate.py [case ...]（case 名如 MIG-01，缺省全跑）
"""

import sys

import lib

# 页面侧公共工具：RLE 编码（与 saveGame.js 同构）+ base64 + 老档构造器
TOOLBOX = r"""
function rleEnc(u8){const out=[];let i=0;while(i<u8.length){const v=u8[i];let run=1;
  while(run<0xFFFF&&i+run<u8.length&&u8[i+run]===v)run++;out.push(v,run>>8,run&0xFF);i+=run;}
  return new Uint8Array(out);}
function b64(u8){let s='';const CH=0x8000;for(let i=0;i<u8.length;i+=CH)
  s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));return btoa(s);}
// 从当前世界 (0,0,0) 起提取 [sw,sh,sd] 盒数据为老布局 Uint8Array
function extractBox(sw,sh,sd){const CW=cfg.WORLD_WIDTH,CD=cfg.WORLD_DEPTH;
  const u=new Uint8Array(sw*sh*sd);
  for(let y=0;y<sh;y++)for(let z=0;z<sd;z++)
    u.set(S.blocks.subarray((y*CD+z)*CW,(y*CD+z)*CW+sw),(y*sd+z)*sw);
  return u;}
// 合成分层老世界：y0 基岩 / 1..19 石 / 20..28 泥 / 29 草 / 其上空气
function layeredOld(sw,sh,sd){const u=new Uint8Array(sw*sh*sd);
  for(let y=0;y<sh;y++)for(let z=0;z<sd;z++)for(let x=0;x<sw;x++){
    let t=0; if(y===0)t=BT.BEDROCK; else if(y<20)t=BT.STONE; else if(y<29)t=BT.DIRT; else if(y===29)t=BT.GRASS;
    u[(y*sd+z)*sw+x]=t;}
  return u;}
const setOld=(u,sw,sd,x,y,z,t)=>{u[(y*sd+z)*sw+x]=t;};
function v3Save(u,seed){return {version:3,enc:'rle',savedAt:Date.now(),blocks:b64(rleEnc(u)),
  player:{x:30.5,y:40,z:30.5,yaw:1,pitch:0,flying:false,health:17,selectedSlot:2,
          inventory:{10:5},hunger:15,air:8,xp:7,toolWear:{}},
  gameMode:'survival',worldSeed:seed,viewMode:0,time:321,spawn:{x:30.5,y:40,z:30.5}};}
"""


# ---------------------------------------------------------------- MIG-01
def mig_01(e2e):
    """v3 老档迁移·字节级保真：同种子当前世界提取盒→改成 v3 档→迁移读回，
    结果应与原世界全量一致、仅玩家改动格不同；玩家/模式/种子恢复。"""
    res = e2e.js_str(TOOLBOX + r"""
clearSaves(); S.saveSlot=0;
const SEED=13579246; S.worldSeed=SEED;
w.generateWorld();
const ref=S.blocks.slice();
const sw=128, sh=64, sd=128;
const old=extractBox(sw,sh,sd);
setOld(old,sw,sd, 3,25,3, BT.DIAMOND_ORE);
setOld(old,sw,sd, 100,10,60, BT.TNT);
for(let y=12;y<=14;y++)for(let z=20;z<=24;z++)for(let x=20;x<=24;x++)setOld(old,sw,sd,x,y,z,BT.AIR);
setOld(old,sw,sd, 22,12,22, BT.TNT); // 房间地上一颗 TNT
// 预期差异格数（老盒数据 vs 原世界同区域）——动态计算，不假设地形
let expDiff=0; const CW=cfg.WORLD_WIDTH,CD=cfg.WORLD_DEPTH;
for(let y=0;y<sh;y++)for(let z=0;z<sd;z++){const nb=(y*sd+z)*sw, cb=(y*CD+z)*CW;
  for(let x=0;x<sw;x++) if(old[nb+x]!==ref[cb+x]) expDiff++;}
localStorage.setItem('mcweb.save.v1.slot0', JSON.stringify(v3Save(old,SEED)));
const ok=sg.loadGame(0);
let diff=0; const samples=[];
for(let i=0;i<S.blocks.length;i++) if(S.blocks[i]!==ref[i]){diff++; if(samples.length<6)samples.push(i);}
RESULT={ok, blocksLen:S.blocks.length, wantLen:256*128*256, seed:S.worldSeed, diff, expDiff,
  e1:gb(3,25,3)===BT.DIAMOND_ORE, e2:gb(100,10,60)===BT.TNT, e4:gb(22,12,22)===BT.TNT,
  roomAir:gb(21,13,21)===0, px:S.player.x, sel:S.player.selectedSlot, inv10:inv(10),
  hunger:S.player.hunger, xp:S.player.xp, mode:S.gameMode, samples, log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "ok" not in res:
        return lib.report("MIG-01 v3 老档迁移字节级保真", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("读档成功", res["ok"] is True, f"ok={res['ok']}"),
        ("世界尺寸 256×128×256", res["blocksLen"] == res["wantLen"], f"{res['blocksLen']} vs {res['wantLen']}"),
        ("种子已恢复", res["seed"] == 13579246, f"seed={res['seed']}"),
        ("全量差异格数 == 玩家改动格数（周边零漂移）", res["diff"] == res["expDiff"] and res["diff"] > 0, f"diff={res['diff']}, expDiff={res['expDiff']}"),
        ("改动格保留：钻矿/TNT/挖空房间", res["e1"] and res["e2"] and res["e4"] and res["roomAir"], f"{res['e1']},{res['e2']},{res['e4']},roomAir={res['roomAir']}"),
        ("玩家态恢复（坐标/手持/背包/饥饿/经验/模式）", res["px"] == 30.5 and res["sel"] == 2 and res["inv10"] == 5 and res["hunger"] == 15 and res["xp"] == 7 and res["mode"] == "survival", f"px={res['px']} sel={res['sel']} inv={res['inv10']} hunger={res['hunger']} xp={res['xp']} mode={res['mode']}"),
    ]
    return lib.report("MIG-01 v3 老档迁移字节级保真", res, checks)


# ---------------------------------------------------------------- MIG-02
def mig_02(e2e):
    """v3 合成档迁移（不依赖当前生成器）：老盒逐格保真 + 四周为存档种子生成的地形。"""
    res = e2e.js_str(TOOLBOX + r"""
clearSaves(); S.saveSlot=0;
const sw=128, sh=64, sd=128, SEED=24681357;
const old=layeredOld(sw,sh,sd);
setOld(old,sw,sd, 3,25,3, BT.DIAMOND_ORE);
setOld(old,sw,sd, 100,10,60, BT.TNT);
localStorage.setItem('mcweb.save.v1.slot0', JSON.stringify(v3Save(old,SEED)));
const ok=sg.loadGame(0);
// 老盒逐格比对（新数组按当前布局 stride 索引，老数据按老布局 stride）
let boxBad=0; const CW=cfg.WORLD_WIDTH, CD=cfg.WORLD_DEPTH;
for(let y=0;y<sh;y++)for(let z=0;z<sd;z++){const nb=(y*sd+z)*sw, cb=(y*CD+z)*CW;
  for(let x=0;x<sw;x++) if(S.blocks[cb+x]!==old[nb+x]) boxBad++;}
// 四周抽样：表高符合 generateTerrainHeight（种子已恢复）、y0 是基岩
let surOK=true; const surBad=[];
for(let k=0;k<40;k++){const x=130+((k*37)%121), z=130+((k*53)%121);
  const h=w.generateTerrainHeight(x,z);
  if(gb(x,h,z)===0 || gb(x,h-1,z)===0){surOK=false; if(surBad.length<5)surBad.push([x,z,h]);}}
const bedOK=[[150,150],[200,180],[240,130],[131,251]].every(([x,z])=>gb(x,0,z)===BT.BEDROCK);
RESULT={ok, blocksLen:S.blocks.length, boxBad, surOK, surBad, bedOK, seed:S.worldSeed,
  e1:gb(3,25,3)===BT.DIAMOND_ORE, log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "ok" not in res:
        return lib.report("MIG-02 v3 合成档迁移与周边衔接", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("读档成功", res["ok"] is True, f"ok={res['ok']}"),
        ("世界尺寸 256×128×256", res["blocksLen"] == 256 * 128 * 256, f"{res['blocksLen']}"),
        ("老盒 100 万格逐格保真", res["boxBad"] == 0, f"bad={res['boxBad']}"),
        ("四周 40 列表高符合同种子地形公式", res["surOK"], f"bad={res['surBad']}"),
        ("四周 y0 基岩", res["bedOK"], f"bedOK={res['bedOK']}"),
        ("改动格保留", res["e1"], f"e1={res['e1']}"),
    ]
    return lib.report("MIG-02 v3 合成档迁移与周边衔接", res, checks)


# ---------------------------------------------------------------- MIG-03
def mig_03(e2e):
    """v4 尺寸不符档走迁移（未来再扩容复用同一路径）+ 存回后落 v4/dims。"""
    res = e2e.js_str(TOOLBOX + r"""
clearSaves(); S.saveSlot=0;
const sw=192, sh=64, sd=192, SEED=11235813;
const old=layeredOld(sw,sh,sd);
setOld(old,sw,sd, 50,25,50, BT.DIAMOND_ORE);
const save=v3Save(old,SEED); save.version=4; save.dims=[sw,sh,sd];
localStorage.setItem('mcweb.save.v1.slot0', JSON.stringify(save));
const ok=sg.loadGame(0);
let boxBad=0; const CW=cfg.WORLD_WIDTH, CD=cfg.WORLD_DEPTH;
for(let y=0;y<sh;y++)for(let z=0;z<sd;z++){const nb=(y*sd+z)*sw, cb=(y*CD+z)*CW;
  for(let x=0;x<sw;x++) if(S.blocks[cb+x]!==old[nb+x]) boxBad++;}
const e1=gb(50,25,50)===BT.DIAMOND_ORE;
const saved=sg.saveGame();
const slot=JSON.parse(localStorage.getItem('mcweb.save.v1.slot'+S.saveSlot));
RESULT={ok, blocksLen:S.blocks.length, boxBad, e1, saved, v:slot.version, dims:slot.dims, log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "ok" not in res:
        return lib.report("MIG-03 v4 尺寸不符迁移 + 回写 v4", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("读档成功（走迁移）", res["ok"] is True, f"ok={res['ok']}"),
        ("老盒 192³ 逐格保真", res["boxBad"] == 0, f"bad={res['boxBad']}"),
        ("改动格保留", res["e1"], f"e1={res['e1']}"),
        ("存回后 version=4 且 dims=[256,128,256]", res["saved"] and res["v"] == 4 and res["dims"] == [256, 128, 256], f"saved={res['saved']} v={res['v']} dims={res['dims']}"),
    ]
    return lib.report("MIG-03 v4 尺寸不符迁移 + 回写 v4", res, checks)


# ---------------------------------------------------------------- MIG-04
def mig_04(e2e):
    """损坏防护：非法 dims / 截断 RLE 都返回 false，内存世界不被破坏。"""
    res = e2e.js_str(TOOLBOX + r"""
S.saveSlot=0;
const before=S.blocks.slice();
localStorage.setItem('mcweb.save.v1.slot1', JSON.stringify(
  {version:4,dims:[99999999,1,1],enc:'raw',blocks:b64(new Uint8Array([1,2,3])),
   player:{x:1,y:2,z:3},gameMode:'creative',worldSeed:1,time:0,spawn:{}}));
const ok1=sg.loadGame(1);
localStorage.setItem('mcweb.save.v1.slot1', JSON.stringify(
  {version:4,dims:[128,64,128],enc:'rle',blocks:b64(new Uint8Array([7,0,3,9,255,255])),
   player:{x:1,y:2,z:3},gameMode:'creative',worldSeed:1,time:0,spawn:{}}));
const ok2=sg.loadGame(1);
let same=true;
for(let i=0;i<S.blocks.length;i++) if(S.blocks[i]!==before[i]){same=false;break;}
localStorage.removeItem('mcweb.save.v1.slot1');
RESULT={ok1,ok2,same,len:S.blocks.length,log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "ok1" not in res:
        return lib.report("MIG-04 损坏防护", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("非法 dims 拒读", res["ok1"] is False, f"ok1={res['ok1']}"),
        ("截断 RLE 拒读", res["ok2"] is False, f"ok2={res['ok2']}"),
        ("内存世界原样未动", res["same"] is True, f"same={res['same']}"),
    ]
    return lib.report("MIG-04 损坏防护", res, checks)


# ---------------------------------------------------------------- MIG-05
def mig_05(e2e):
    """热重载快照 RLE 化：8MB 世界快照不超 sessionStorage 配额（体积断言），恢复字节级回滚。"""
    res = e2e.js_str(TOOLBOX + r"""
const snap=await import(B+'assistant/snapshot.js');
sb(10,50,10,BT.DIAMOND_ORE);
const okS=snap.saveSnapshotForReload();
const raw=sessionStorage.getItem('mcAssistant.snapshot');
const meta=raw?JSON.parse(raw):null;
const rawKB=raw?Math.round(raw.length/1024):0;
sb(10,50,10,BT.AIR);
sb(200,60,200,BT.TNT);
const okR=snap.restoreSnapshotIfAny();
RESULT={okS,okR,v:meta&&meta.v,enc:meta&&meta.enc,rawKB,
  a:gb(10,50,10)===BT.DIAMOND_ORE, b:gb(200,60,200)!==BT.TNT, log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "okS" not in res:
        return lib.report("MIG-05 热重载快照 RLE", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("快照保存成功", res["okS"] is True, f"okS={res['okS']}"),
        ("快照 v3 + RLE 编码", res["v"] == 3 and res["enc"] == "rle", f"v={res['v']} enc={res['enc']}"),
        ("快照体积 < 3.5MB（sessionStorage 配额内）", 0 < res["rawKB"] < 3584, f"rawKB={res['rawKB']}"),
        ("恢复成功且两处改动均回滚", res["okR"] is True and res["a"] and res["b"], f"okR={res['okR']} a={res['a']} b={res['b']}"),
    ]
    return lib.report("MIG-05 热重载快照 RLE", res, checks)


# ---------------------------------------------------------------- MIG-06
def mig_06(e2e):
    """新档 v4 常规路径：saveGame 落 v4/dims，刷新页面后启动自动读档、世界完整（含新区坐标）。"""
    res1 = e2e.js_str(TOOLBOX + r"""
clearSaves(); S.saveSlot=0;
sb(140,70,140,BT.DIAMOND_ORE); // 老盒之外的"新区"坐标
const saved=sg.saveGame();
const slot=JSON.parse(localStorage.getItem('mcweb.save.v1.slot0'));
sessionStorage.removeItem('mcAssistant.snapshot');
RESULT={saved, v:slot.version, dims:slot.dims, placed:gb(140,70,140), log:LOG};
return JSON.stringify(RESULT);
""")
    e2e.page.nav(lib.BASE + "/", settle=7.0)
    res2 = e2e.js_str(r"""
RESULT={len:S.blocks.length, placed:gb(140,70,140), ui:um.getUIState(), log:LOG};
return JSON.stringify(RESULT);
""")
    if not (isinstance(res1, dict) and "saved" in res1 and isinstance(res2, dict) and "placed" in res2):
        return lib.report("MIG-06 v4 常规存读回环", {"r1": res1, "r2": res2}, [])
    checks = [
        ("保存成功且落 v4 + dims=[256,128,256]", res1["saved"] and res1["v"] == 4 and res1["dims"] == [256, 128, 256], f"saved={res1['saved']} v={res1['v']} dims={res1['dims']}"),
        ("刷新后启动自动读档（尺寸正确）", res2["len"] == 256 * 128 * 256, f"len={res2['len']} ui={res2['ui']}"),
        ("新区坐标方块完整恢复", res2["placed"] == res1["placed"] and res1["placed"] != 0, f"placed={res2['placed']}"),
    ]
    return lib.report("MIG-06 v4 常规存读回环", res2, checks)


CASES = {"MIG-01": mig_01, "MIG-02": mig_02, "MIG-03": mig_03, "MIG-04": mig_04,
         "MIG-05": mig_05, "MIG-06": mig_06}

if __name__ == "__main__":
    names = sys.argv[1:] or list(CASES)
    e2e = lib.E2E()
    e2e.fresh_page()
    results = {}
    for n in names:
        results[n] = CASES[n](e2e)
    e2e.close()
    print("\n==== 世界扩容迁移 汇总 ====")
    for n, ok in results.items():
        print(f"  {n}: {'PASS' if ok else 'FAIL'}")
    sys.exit(0 if all(results.values()) else 1)
