# -*- coding: utf-8 -*-
"""G3 验收门（批次 L1：传送带/离合器/投料器）E2E。

冻结清单：docs/l1-logistics-plan.md §7（E01..E10 / N01..N23 / S01..S03 / P01..P04），
加协调代理指定的第二层边界攻击（投料器推动无残留/存档 key 集/TNT/拆水车收敛/六槽切换）
与 A5(a) 500 格蛇形带、第四层 20 轮泄漏审计。
铁律：断言只看行为（config.js 解码 + getBlock + kineticStatusAt/isBeltRunningAt +
state.player.inventory / state.itemDrops / tntEntities / renderer.info / scene）。

重跑：cd tests/e2e && python3 run_l1.py [用例名 …]（缺省全跑）
注意：P01..P04/A5a/ATK/LEAK 各自 fresh_page（世界只有 128×128，性能场景复用同一 z 带）。
"""

import json
import re
import sys

import lib

ORDER = []


def case(fn):
    ORDER.append(fn.__name__)
    return fn


def rpm_of(s):
    if not isinstance(s, str):
        return None
    m = re.search(r"转速\s*(\d+(?:\.\d+)?)\s*RPM", s)
    if m:
        return float(m.group(1))
    if "静止" in s or "过载" in s or "停" in s:
        return 0.0
    return None


# ================================================================ E 组
@case
def E01_E02(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(20,18,20,10,20); // x20..39, z18..27
// 干线（z=22）：wheel(22)+水 | 轴23..25 | 离合器26 | 轴27,28 | 粉碎轮对(29,22)+(29,23)；拉杆贴离合器北面
kn.placeKinetic(22,20,22, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(22,21,22,BT.WATER);
kn.placeKinetic(23,20,22, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(24,20,22, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(25,20,22, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(26,20,22, cfg.CLUTCH_ITEM_ID, N[3]);
kn.placeKinetic(27,20,22, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(28,20,22, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(29,20,22, cfg.CRUSHER_ITEM_ID, N[3]);
kn.placeKinetic(29,20,23, cfg.CRUSHER_ITEM_ID, N[3]);
rs.placeRedstone(26,20,21, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(4);
const eng_=cfg.clutchEngaged(gb(26,20,22));
const base={engaged:eng_, crusher:kn.kineticStatusAt(29,20,22), wheel:kn.kineticStatusAt(22,20,22)};
rs.toggleLeverAt(26,20,21); rs.updateRedstoneNetwork(); await tick(4);
const off={engaged:cfg.clutchEngaged(gb(26,20,22)), crusher:kn.kineticStatusAt(29,20,22), wheel:kn.kineticStatusAt(22,20,22)};
rs.toggleLeverAt(26,20,21); rs.updateRedstoneNetwork(); await tick(4);
const on={engaged:cfg.clutchEngaged(gb(26,20,22)), crusher:kn.kineticStatusAt(29,20,22)};
itm.clearItemDrops(); sb(29,21,22,BT.STONE);
let crushed=false;
for(let i=0;i<200;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);if(dropsOf(BT.COBBLESTONE)>0){crushed=true;break;}}
RESULT={base, off, on, crushed, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    b, o, n = d.get("base", {}), d.get("off", {}), d.get("on", {})
    checks = [
        ("初始：接合且粉碎轮 8 RPM", b.get("engaged") == 1 and rpm_of(b.get("crusher")) == 8, f"engaged={b.get('engaged')}, crusher={b.get('crusher')}"),
        ("E01 拉杆合 → 断开（engaged=0）", o.get("engaged") == 0, f"engaged={o.get('engaged')}"),
        ("E01 下游粉碎轮停转", rpm_of(o.get("crusher")) == 0, f"{o.get('crusher')}"),
        ("E01 水车侧照转（隔离非憋停）", rpm_of(o.get("wheel")) == 8, f"{o.get('wheel')}"),
        ("E02 拉杆断 → 恢复接合", n.get("engaged") == 1, f"engaged={n.get('engaged')}"),
        ("E02 下游恢复 8 RPM", rpm_of(n.get("crusher")) == 8, f"{n.get('crusher')}"),
        ("E02 恢复后投料可加工", d.get("crushed"), f"crushed={d.get('crushed')}"),
    ]
    return lib.report("L1-E01/E02 离合器一键启停", res, checks)


@case
def E03_E04_N12a(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(20,28,26,10,20); // x20..45, z28..37
// wheel(22,32)+水 | 离合器(23,32) | 轴24..38 | 带24..38（贴轴顶东向）；拉杆贴离合器北面
kn.placeKinetic(22,20,32, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(22,21,32,BT.WATER);
kn.placeKinetic(23,20,32, cfg.CLUTCH_ITEM_ID, N[3]);
for(let x=24;x<=38;x++){kn.placeKinetic(x,20,32, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,32,cfg.beltId(1));}
rs.placeRedstone(23,20,31, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(4);
const beltRun=kn.isBeltRunningAt(30,21,32);
itm.clearItemDrops(); itm.spawnItemDrop(24.5,22.6,32.5,BT.COBBLESTONE,1);
const posAfter=(frames)=>{for(let i=0;i<frames;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);}
  const dd=S.itemDrops[0];return dd?{x:+dd.x.toFixed(2),y:+dd.y.toFixed(2)}:null;};
const p1=posAfter(60), p2=posAfter(60);
const e03moved=p1&&p2&&p2.x>p1.x&&p1.x>25.0;
const onBeltY=p1&&Math.abs(p1.y-21.15)<0.3;
rs.toggleLeverAt(23,20,31); rs.updateRedstoneNetwork(); await tick(2);
const stop1=posAfter(30), stop2=posAfter(30);
const frozen=stop1&&stop2&&Math.abs(stop2.x-stop1.x)<0.02;
rs.toggleLeverAt(23,20,31); rs.updateRedstoneNetwork(); await tick(2);
const resume=posAfter(40);
const resumed=resume&&stop2&&resume.x>stop2.x+0.2;
RESULT={beltRun, p1, p2, e03moved, onBeltY, stop1, stop2, frozen, resume, resumed, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("带列通电运转", d.get("beltRun"), f"running={d.get('beltRun')}"),
        ("E03 圆石落带被带走（东移）", d.get("e03moved"), f"1s→{d.get('p1')}, 2s→{d.get('p2')}"),
        ("E03 骑行高度收敛（y≈21.15）", d.get("onBeltY"), f"y={d.get('p1')}"),
        ("E04 断电原地停住不消失", d.get("frozen"), f"{d.get('stop1')} → {d.get('stop2')}"),
        ("E04/N12a 复电从原地续走", d.get("resumed"), f"停点={d.get('stop2')} → {d.get('resume')}"),
    ]
    return lib.report("L1-E03/E04/N12a 传送带运送与断电续走", res, checks)


@case
def E05_E06_E08(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(50,20,24,8,20); // x50..73, z20..27
kn.placeKinetic(52,20,22, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(52,21,22,BT.WATER);
kn.placeKinetic(53,20,22, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(54,20,22, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(55,20,22, cfg.DEPLOYER_ITEM_ID, N[3]); // 朝东 T=(56,20,22)
kn.updateKineticNetwork(); await tick(4);
const T={x:56,y:20,z:22};
const pumpN=(n)=>{for(let i=0;i<n;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);}};
itm.clearItemDrops(); itm.spawnItemDrop(55.5,21.7,22.5,BT.COBBLESTONE,3);
let t1=null; const q0=performance.now();
while(performance.now()-q0<1500){pumpN(2); if(gb(T.x,T.y,T.z)===BT.COBBLESTONE){t1=performance.now()-q0;break;}}
const cnt1=S.itemDrops.length?S.itemDrops[0].count:0;
sb(T.x,T.y,T.z,BT.AIR);
let t2=null; const q1=performance.now();
while(performance.now()-q1<1500){pumpN(2); if(gb(T.x,T.y,T.z)===BT.COBBLESTONE){t2=performance.now()-q1;break;}}
const cnt2=S.itemDrops.length?S.itemDrops[0].count:0;
sb(T.x,T.y,T.z,BT.AIR);
itm.clearItemDrops();
itm.spawnItemDrop(55.5,21.7,22.4, IT.STICK,1);
itm.spawnItemDrop(55.5,21.7,22.7, cfg.ToolTypes.SWORD,1);
itm.spawnItemDrop(55.5,21.7,22.6, IT.APPLE,1);
for(let i=0;i<180;i++)pumpN(1);
const e06T=gb(T.x,T.y,T.z), e06n=S.itemDrops.length;
sb(T.x,T.y,T.z,BT.BRICK);
itm.clearItemDrops(); itm.spawnItemDrop(55.5,21.7,22.5,BT.COBBLESTONE,2);
for(let i=0;i<180;i++)pumpN(1);
const e08T=gb(T.x,T.y,T.z), e08cnt=S.itemDrops.length?S.itemDrops[0].count:0;
sb(T.x,T.y,T.z,BT.AIR);
let t3=null; const q2=performance.now();
while(performance.now()-q2<1500){pumpN(2); if(gb(T.x,T.y,T.z)===BT.COBBLESTONE){t3=performance.now()-q2;break;}}
RESULT={t1, cnt1, t2, cnt2, e06T, e06n, e08T, e08cnt, t3, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("E05 圆石变方块进朝向格（≤1s）", d.get("t1") is not None and d["t1"] <= 1000, f"t1={d.get('t1')}ms"),
        ("E05 count 3→2（数量-1）", d.get("cnt1") == 2, f"count={d.get('cnt1')}"),
        ("E05 清 T 后 0.5s 节拍连续投", d.get("t2") is not None and d.get("cnt2") == 1, f"t2={d.get('t2')}ms, count={d.get('cnt2')}"),
        ("E06 木棍/剑/苹果不放置", d.get("e06T") == 0, f"T={d.get('e06T')}"),
        ("E06 物品不消耗（3 实体在）", d.get("e06n") == 3, f"实体数={d.get('e06n')}"),
        ("E08 目标被占不放置不消耗", d.get("e08T") == 9 and d.get("e08cnt") == 2, f"T={d.get('e08T')}(9=砖), count={d.get('e08cnt')}"),
        ("E08 目标清空后恢复投料", d.get("t3") is not None, f"t3={d.get('t3')}ms"),
    ]
    return lib.report("L1-E05/E06/E08 投料器", res, checks)


@case
def E07(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(20,50,24,8,20); // x20..43, z50..57
// 收官摆位（§3.4）：wheel(27)+水|轴28..32|粉碎对(34,54)+(34,55)；投料器(33,21,54)朝东 T=(34,21,54)；
// 供电带(32,21,54)贴轴顶→邻投料器背面；投料带(33,22,54)骑投料器顶
kn.placeKinetic(25,20,54, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(25,21,54,BT.WATER);
kn.placeKinetic(26,20,54, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(27,20,54, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(27,21,54,BT.WATER);
for(let x=28;x<=33;x++) kn.placeKinetic(x,20,54, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(34,20,54, cfg.CRUSHER_ITEM_ID, N[3]);
kn.placeKinetic(34,20,55, cfg.CRUSHER_ITEM_ID, N[3]);
kn.placeKinetic(33,21,54, cfg.DEPLOYER_ITEM_ID, N[3]);
sb(32,21,54,cfg.beltId(1));
sb(33,22,54,cfg.beltId(1));
kn.updateKineticNetwork(); await tick(4);
const pre={beltFeed:kn.isBeltRunningAt(33,22,54), dep:kn.kineticStatusAt(33,21,54), crush:kn.kineticStatusAt(34,20,54)};
itm.clearItemDrops(); itm.spawnItemDrop(33.5,23.6,54.5,BT.COBBLESTONE,1);
let sawGravelBlock=false, sawSandItem=false; const hist=[];
for(let i=0;i<900;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);
  if(i%60===0)hist.push(`${(i/60).toFixed(0)}s:T=${gb(34,21,54)},drops=${S.itemDrops.map(dd=>dropId(dd)+'x'+(dd.count||1)).join('|')}`);
  if(gb(34,21,54)===BT.GRAVEL)sawGravelBlock=true;
  if(S.itemDrops.some(dd=>dropId(dd)===BT.SAND))sawSandItem=true;}
const Tfinal=gb(34,21,54);
const sand=S.itemDrops.find(dd=>dropId(dd)===BT.SAND);
const sandPos=sand?{x:+sand.x.toFixed(2),y:+sand.y.toFixed(2),z:+sand.z.toFixed(2)}:null;
RESULT={pre, sawGravelBlock, sawSandItem, Tfinal, sandPos, nDrops:S.itemDrops.length, hist, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    p = d.get("pre", {})
    checks = [
        ("摆位通电：投料带/投料器/粉碎轮全运行", p.get("beltFeed") and rpm_of(p.get("dep")) == 8 and rpm_of(p.get("crush")) == 8, f"belt={p.get('beltFeed')}, dep={rpm_of(p.get('dep'))}, crush={rpm_of(p.get('crush'))}"),
        ("途中出现沙砾方块（第 2 轮进料证据）", d.get("sawGravelBlock"), f"sawGravelBlock={d.get('sawGravelBlock')}"),
        ("≥2 轮粉碎产出沙物品", d.get("sawSandItem"), f"sawSandItem={d.get('sawSandItem')}"),
        ("终态：T 为空（沙被 N16 守卫拦截）", d.get("Tfinal") == 0, f"T={d.get('Tfinal')}"),
        ("终态：沙物品停驻投料口格", d.get("sandPos") is not None and abs(d["sandPos"]["x"] - 34.5) < 0.6 and abs(d["sandPos"]["z"] - 54.5) < 0.6, f"sandPos={d.get('sandPos')}"),
        ("链自然停在末端（仅剩 1 个掉落物）", d.get("nDrops") == 1, f"itemDrops={d.get('nDrops')}"),
    ]
    return lib.report("L1-E07 收官闭环（修正终态）", res, checks)


@case
def E09_E10(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(50,28,24,10,20); // x50..73, z28..37
kn.placeKinetic(52,20,30, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(52,21,30,BT.WATER);
kn.placeKinetic(53,20,30, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(54,20,30, cfg.CLUTCH_ITEM_ID, N[3]);
kn.placeKinetic(55,20,30, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(56,20,30, cfg.SHAFT_ITEM_ID, N[3]); sb(56,21,30,cfg.beltId(1));
kn.placeKinetic(57,20,30, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(58,20,30, cfg.DEPLOYER_ITEM_ID, N[3]);
kn.updateKineticNetwork(); await tick(4);
const sBelt=kn.kineticStatusAt(56,21,30);
const sDep=kn.kineticStatusAt(58,20,30);
const sClutch=kn.kineticStatusAt(54,20,30);
rs.placeRedstone(54,20,29, cfg.LEVER_ITEM_ID, N[2]);
rs.toggleLeverAt(54,20,29); rs.updateRedstoneNetwork(); await tick(2);
const sClutchOff=kn.kineticStatusAt(54,20,30);
rs.toggleLeverAt(54,20,29); rs.updateRedstoneNetwork(); await tick(2);
// E10：wheel(60,34)+水+轴(61,34)，带 16 格满载 → +1 过载
kn.placeKinetic(60,20,34, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(60,21,34,BT.WATER);
kn.placeKinetic(61,20,34, cfg.SHAFT_ITEM_ID, N[3]);
for(let i=0;i<16;i++){kn.placeKinetic(62+i,20,34, cfg.SHAFT_ITEM_ID, N[3]); sb(62+i,21,34,cfg.beltId(1));}
kn.updateKineticNetwork(); await tick(2);
const s16=kn.kineticStatusAt(60,20,34);
sb(78,19,34,BT.STONE); sb(78,20,34,BT.AIR); sb(78,20,34,cfg.beltId(1));
kn.updateKineticNetwork(); await tick(2);
const s17=kn.kineticStatusAt(60,20,34);
RESULT={sBelt, sDep, sClutch, sClutchOff, s16, s17, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("E09 带 HUD：运转中+带速", isinstance(d.get("sBelt"), str) and "运转" in d["sBelt"] and "1.5" in d["sBelt"], d.get("sBelt")),
        ("E09 投料器 HUD：转速+应力+节拍", isinstance(d.get("sDep"), str) and "8 RPM" in d["sDep"] and "应力 20/64" in d["sDep"] and "投料节拍" in d["sDep"], d.get("sDep")),
        ("E09 离合器 HUD：接合/断开随红石", isinstance(d.get("sClutch"), str) and "接合" in d["sClutch"] and isinstance(d.get("sClutchOff"), str) and "断开" in d["sClutchOff"], f"{d.get('sClutch')} → {d.get('sClutchOff')}"),
        ("E10 16 带 64/64 满载运转", isinstance(d.get("s16"), str) and "64/64" in d["s16"] and "转速 8" in d["s16"], d.get("s16")),
        ("E10 +1 带 → ⛔过载整网停", isinstance(d.get("s17"), str) and "过载" in d["s17"], d.get("s17")),
    ]
    return lib.report("L1-E09/E10 HUD 与应力", res, checks)


# ================================================================ N 组
@case
def N01(e2e):
    res = e2e.run(r"""
setDay(); ui.setGameMode('survival');
platform(20,58,10,6,20); // x20..29, z58..63
sb(24,20,60,BT.STONE); sb(24,21,60,cfg.beltId(1));
ps.placePiston(23,21,60, cfg.PISTON_ITEM_ID, N[3]); // 朝东推带（相邻）
rs.placeRedstone(23,21,59, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); await tick(2);
S.player.inventory[cfg.BELT_ITEM_ID]=0;
const before=gb(24,21,60);
rs.toggleLeverAt(23,21,59); rs.updateRedstoneNetwork(); await tick(10);
const after=gb(24,21,60);
const refund=inv(cfg.BELT_ITEM_ID);
RESULT={before, after, refund, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("带被压碎（原格变活塞头占位）", d.get("before") == 203 and d.get("after") == 131, f"{d.get('before')}(203=东向带) → {d.get('after')}(131=活塞头)"),
        ("生存返还 1 个传送带物品", d.get("refund") == 1, f"refund={d.get('refund')}"),
    ]
    return lib.report("L1-N01 活塞推带=压碎返还", res, checks)


@case
def N02(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(32,58,20,8,20); // x32..51, z58..65
// ---- A: 投料器冷却中被活塞顶走 1 格 → 原格重放节拍正常 ----
kn.placeKinetic(34,20,60, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(34,21,60,BT.WATER);
kn.placeKinetic(35,20,60, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(36,20,60, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(37,20,60, cfg.DEPLOYER_ITEM_ID, N[3]); // T=(38,20,60)
kn.updateKineticNetwork(); await tick(2);
itm.clearItemDrops(); itm.spawnItemDrop(37.5,21.7,60.5,BT.COBBLESTONE,5);
for(let i=0;i<30;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
const midT=gb(38,20,60), midCnt=S.itemDrops.length?S.itemDrops[0].count:0;
// 活塞在投料器正下方朝上顶走 1 格
sb(37,19,60,BT.AIR);
ps.placePiston(37,19,60, cfg.PISTON_ITEM_ID, N[0]);
rs.placeRedstone(38,19,60, cfg.LEVER_ITEM_ID, N[3]);
rs.updateRedstoneNetwork(); await tick(2);
rs.toggleLeverAt(38,19,60); rs.updateRedstoneNetwork(); await tick(10);
const depMoved=gb(37,21,60), depOld=gb(37,20,60);
rs.toggleLeverAt(38,19,60); rs.updateRedstoneNetwork(); await tick(10);
kn.breakKineticAt(37,21,60);
kn.placeKinetic(37,20,60, cfg.DEPLOYER_ITEM_ID, N[3]);
kn.updateKineticNetwork(); await tick(4);
const depSt=kn.kineticStatusAt(37,20,60);
sb(38,20,60,BT.AIR); itm.clearItemDrops();
itm.spawnItemDrop(37.5,21.7,60.5,BT.COBBLESTONE,2); // 补喂新料：验证无冷却残留（冷却归零后 ≤1.5s 投出）
let tRe=null; const q0=performance.now();
while(performance.now()-q0<1500){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);
  if(gb(38,20,60)===BT.COBBLESTONE){tRe=performance.now()-q0;break;}}
// ---- B1: 断开态离合器被推离充能区 → 自动接合 ----
// 石G(43,62)；拉杆(44,62)贴G东面；粉(45,62)贴地（拉杆点亮）；离合器(46,62)邻粉
sb(43,20,62,BT.STONE);
rs.placeRedstone(44,20,62, cfg.LEVER_ITEM_ID, N[3]);
rs.placeRedstone(45,20,62, cfg.DUST_ITEM_ID, N[0]);
kn.placeKinetic(46,20,62, cfg.CLUTCH_ITEM_ID, N[3]);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(2);
const clPre=cfg.clutchEngaged(gb(46,20,62));
rs.toggleLeverAt(44,20,62); rs.updateRedstoneNetwork(); await tick(4);
const clOff=cfg.clutchEngaged(gb(46,20,62));
// 活塞(46,61)朝南推离合器 → (46,63)
sb(46,19,61,BT.STONE);
ps.placePiston(46,20,61, cfg.PISTON_ITEM_ID, N[4]);
rs.placeRedstone(47,20,61, cfg.LEVER_ITEM_ID, N[3]);
rs.updateRedstoneNetwork(); await tick(2);
rs.toggleLeverAt(47,20,61); rs.updateRedstoneNetwork(); await tick(10);
const clMovedTo=gb(46,20,63), clMovedEng=cfg.clutchEngaged(clMovedTo);
rs.toggleLeverAt(47,20,61); rs.updateRedstoneNetwork(); await tick(10);
// ---- B2: 接合态离合器被推进充能区 → 自动断开 ----
sb(46,20,63,BT.AIR); sb(47,20,62,BT.AIR);
sb(47,20,62,cfg.clutchId(0,1)); // 手摆接合态（不邻粉）
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(2);
const clFar=cfg.clutchEngaged(gb(47,20,62));
// 活塞(48,62)朝西推 → (46,62)=邻粉位
ps.placePiston(48,20,62, cfg.PISTON_ITEM_ID, N[5]);
rs.placeRedstone(49,20,62, cfg.LEVER_ITEM_ID, N[3]);
rs.updateRedstoneNetwork(); await tick(2);
rs.toggleLeverAt(49,20,62); rs.updateRedstoneNetwork(); await tick(10);
const clIn=gb(46,20,62), clInEng=cfg.clutchEngaged(clIn);
RESULT={midT, midCnt, depMoved, depOld, depSt, tRe, clPre, clOff, clMovedTo, clMovedEng, clFar, clIn, clInEng, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    dep_ok = isinstance(d.get("depMoved"), int) and 206 <= d["depMoved"] <= 211
    checks = [
        ("A 前置：投料器已投放一次（冷却中）", d.get("midT") == 12 and d.get("midCnt") == 4, f"T={d.get('midT')}(12=圆石), count={d.get('midCnt')}"),
        ("A 冷却中被顶走 1 格成功（旧格=头）", dep_ok and d.get("depOld") == 128, f"新位={d.get('depMoved')}(206..211), 旧格={d.get('depOld')}(128=头)"),
        ("A 原格重放节拍正常（无进度残留）", d.get("tRe") is not None, f"tRe={d.get('tRe')}ms"),
        ("B1 前置：邻亮粉 → 断开", d.get("clPre") == 1 and d.get("clOff") == 0, f"{d.get('clPre')} → {d.get('clOff')}"),
        ("B1 推离充能区 → 自动恢复接合", isinstance(d.get("clMovedTo"), int) and 212 <= d["clMovedTo"] <= 217 and d.get("clMovedEng") == 1, f"新位 id={d.get('clMovedTo')}, engaged={d.get('clMovedEng')}"),
        ("B2 接合态推进充能区 → 自动断开", d.get("clFar") == 1 and d.get("clInEng") == 0, f"推前 engaged={d.get('clFar')} → 推入后={d.get('clInEng')}（落位 {d.get('clIn')}）"),
    ]
    return lib.report("L1-N02 活塞推动自愈", res, checks)


@case
def N03(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(20,64,10,6,20); // x20..29, z64..69
const t1=kn.placeKinetic(-1,20,66,cfg.BELT_ITEM_ID,N[0]);
const t2=kn.placeKinetic(128,20,66,cfg.BELT_ITEM_ID,N[0]);
const t3=kn.placeKinetic(30,64,66,cfg.BELT_ITEM_ID,N[0]);
const t4=kn.placeKinetic(-2,20,68,cfg.DEPLOYER_ITEM_ID,N[3]);
const t5=kn.placeKinetic(30,64,68,cfg.CLUTCH_ITEM_ID,N[0]);
sb(26,20,66,BT.STONE); S.player.yaw=-Math.PI/2;
const t6=kn.placeKinetic(26,21,66,cfg.BELT_ITEM_ID,N[0]);
RESULT={t1,t2,t3,t4,t5,t6, okBelt:gb(26,21,66), log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}

    def rejected(v):
        return isinstance(v, str)

    checks = [
        ("越界被拒：x=-1 带", rejected(d.get("t1")), f"ret={d.get('t1')}"),
        ("越界被拒：x=128 带", rejected(d.get("t2")), f"ret={d.get('t2')}"),
        ("越界被拒：y=64 带", rejected(d.get("t3")), f"ret={d.get('t3')}"),
        ("越界被拒：x=-2 投料器", rejected(d.get("t4")), f"ret={d.get('t4')}"),
        ("越界被拒：y=64 离合器", rejected(d.get("t5")), f"ret={d.get('t5')}"),
        ("界内合法格可放置", d.get("t6") is None and d.get("okBelt") == 203, f"ret={d.get('t6')}, id={d.get('okBelt')}(203=东向带)"),
    ]
    return lib.report("L1-N03 越界放置守卫", res, checks)


@case
def N04(e2e):
    res = e2e.run(r"""
setDay(); ui.setGameMode('survival');
platform(40,58,12,6,20); // x40..51, z58..63
sb(44,20,60,BT.STONE); sb(44,21,60,cfg.beltId(1));
S.player.inventory[cfg.BELT_ITEM_ID]=0;
// 向带格放石头：带占据其格（可被准星命中），placeBlock 的放置格只能是带的邻空格 → 带格不可被覆盖
S.player.selectedSlot=HB.indexOf(BT.STONE);
const aim=aimScan(44,21,60, 44.5,22.2,60.5); // 直接瞄准带本体
let placed=null, aimFace=null, aimBlock=null;
if(aim){aimFace=aim.hit.face; aimBlock=aim.hit.block; S.player.yaw=aim.yaw;S.player.pitch=aim.pitch;
  eng.camera.position.set(44.5,22.2+1.62,60.5);eng.camera.rotation.set(aim.pitch,aim.yaw,0,'YXZ');
  it.placeBlock(); placed=gb(44,21,60);}
const beltIntact=placed===cfg.beltId(1);
// 拆支撑（真实路径 breakBlockAt）
const aim2=aimScan(44,20,60, 46.5,20.5,60.5);
let broke=null;
if(aim2){S.player.yaw=aim2.yaw;S.player.pitch=aim2.pitch;
  eng.camera.position.set(46.5,20.5+1.62,60.5);eng.camera.rotation.set(aim2.pitch,aim2.yaw,0,'YXZ');
  it.breakBlockAt(aim2.hit); await tick(4); broke=gb(44,21,60);}
const refund=inv(cfg.BELT_ITEM_ID);
RESULT={aimFound:!!aim, aimBlock, aimFace, placed, beltIntact, aim2Found:!!aim2, broke, refund, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("带格不可被玩家路径覆盖（带可命中、放置落邻格）", d.get("beltIntact") and d.get("aimFound") and d.get("aimBlock") == 203, f"命中={d.get('aimBlock')}(203=带), 放置后带格={d.get('placed')}"),
        ("拆支撑后带连锁弹落（带格变空）", d.get("broke") == 0, f"broke={d.get('broke')}"),
        ("生存返还 1 传送带物品", d.get("refund") == 1, f"refund={d.get('refund')}"),
    ]
    return lib.report("L1-N04 带格不可覆盖+拆支撑弹落", res, checks)


@case
def N05(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative'; clearSaves();
platform(20,66,26,8,20); // x20..45, z66..73
kn.placeKinetic(22,20,68, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(22,21,68,BT.WATER);
kn.placeKinetic(23,20,68, cfg.CLUTCH_ITEM_ID, N[3]);
for(let x=24;x<=30;x++){kn.placeKinetic(x,20,68, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,68,cfg.beltId(1));}
rs.placeRedstone(23,20,67, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(2);
itm.clearItemDrops(); itm.spawnItemDrop(25.5,22.6,68.5,BT.COBBLESTONE,2);
for(let i=0;i<40;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
rs.toggleLeverAt(23,20,67); rs.updateRedstoneNetwork(); await tick(2); // 断电停驻
const line=[]; for(let x=22;x<=30;x++)line.push(gb(x,20,68));
const belts=[]; for(let x=24;x<=30;x++)belts.push(gb(x,21,68));
const dropsBefore=S.itemDrops.length;
const saved=sg.saveGame(); const loaded=sg.loadGame();
rs.initRedstone(); kn.initKinetic(); itm.clearItemDrops(); S.tntEntities.length=0; // 等价 main.js clearTransientEntities
await tick(4);
const line2=[]; for(let x=22;x<=30;x++)line2.push(gb(x,20,68));
const belts2=[]; for(let x=24;x<=30;x++)belts2.push(gb(x,21,68));
const dropsAfter=S.itemDrops.length;
const beltRunOff=kn.isBeltRunningAt(26,21,68);
rs.toggleLeverAt(23,20,67); rs.updateRedstoneNetwork(); await tick(2);
const beltRunOn=kn.isBeltRunningAt(26,21,68);
RESULT={saved, loaded, lineEq:line.join()===line2.join(), beltsEq:belts.join()===belts2.join(),
  clutchBefore:cfg.clutchEngaged(line[1]), clutchAfter:cfg.clutchEngaged(line2[1]),
  dropsBefore, dropsAfter, beltRunOff, beltRunOn, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("保存读档成功", d.get("saved") and d.get("loaded"), f"{d.get('saved')}/{d.get('loaded')}"),
        ("方块 ID 往返一致（含水车/离合器断开态/带 dir）", d.get("lineEq") and d.get("beltsEq"), f"engaged {d.get('clutchBefore')}→{d.get('clutchAfter')}"),
        ("带上物品读档后消失", d.get("dropsBefore") >= 1 and d.get("dropsAfter") == 0, f"{d.get('dropsBefore')} → {d.get('dropsAfter')}"),
        ("读档后按存档态恢复（断开→静止；复位→运转）", d.get("beltRunOff") is False and d.get("beltRunOn") is True, f"off={d.get('beltRunOff')} → on={d.get('beltRunOn')}"),
    ]
    return lib.report("L1-N05 带载物品存档处置", res, checks)


@case
def N06(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(50,38,26,8,20); // x50..75, z38..45
kn.placeKinetic(52,20,40, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(52,21,40,BT.WATER);
kn.placeKinetic(53,20,40, cfg.CLUTCH_ITEM_ID, N[3]);
for(let x=54;x<=66;x++){kn.placeKinetic(x,20,40, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,40,cfg.beltId(1));}
sb(63,21,40,BT.BRICK); // 墙替换带位
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(4);
const pumpN=(n)=>{for(let i=0;i<n;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}};
const pos=()=>{const dd=S.itemDrops[0];return dd?{x:+dd.x.toFixed(2),y:+dd.y.toFixed(2)}:null;};
// 悬空尽头
itm.clearItemDrops(); itm.spawnItemDrop(54.5,22.6,40.5,BT.COBBLESTONE,1);
// 先走西段（墙挡）→ 拆墙前用另一条无墙通道？改序：先测贴墙（墙在 63），再拆墙测续走+尽头坠落
let wp=null;
for(let i=0;i<400;i++){pumpN(1); const dd=S.itemDrops[0]; if(dd&&dd.x>62.4){wp=pos();break;}}
// 等停稳：连续 60 帧位移 <0.02
let wp2=null, prev=wp?wp.x:-99;
for(let i=0;i<600;i++){pumpN(1); const dd=S.itemDrops[0]; const xNow=dd?dd.x:prev;
  if(i%60===59){if(Math.abs(xNow-prev)<0.02){wp2=pos();break;} prev=xNow;}}
const held=wp&&wp2&&wp2.x<=63.01;
// 撤墙恢复带 → 续走至尽头（66 端）坠落落地
sb(63,21,40,cfg.beltId(1)); kn.updateKineticNetwork();
let wp3=null;
for(let i=0;i<300;i++){pumpN(1); const dd=S.itemDrops[0]; if(dd&&dd.x>66.6){wp3=pos();break;}}
let land=null; for(let i=0;i<120;i++)pumpN(1); land=pos();
const fell=land&&land.y<21.0&&land.y>19.5&&land.x>66.0;
RESULT={w:wp, w2:wp2, held, w3:wp3, land, fell, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("贴墙：抵墙停留不穿越（中心 ≤ 墙面）", d.get("held"), f"{d.get('w')} → {d.get('w2')}（墙 x=63）"),
        ("撤墙恢复带后继续走（越过原墙位）", d.get("w3") is not None and d["w3"]["x"] >= 66.55, f"{d.get('w3')}"),
        ("悬空尽头：恢复物理坠落落地", d.get("fell"), f"离带 {d.get('w3')} → 落地 {d.get('land')}"),
    ]
    return lib.report("L1-N06 带尽头悬空/贴墙", res, checks)


@case
def N07(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(20,74,20,6,20); // x20..39, z74..79
kn.placeKinetic(22,20,76, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(22,21,76,BT.WATER);
kn.placeKinetic(23,20,76, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(24,20,76, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(25,20,76, cfg.DEPLOYER_ITEM_ID, N[3]); // T=(26,20,76)
kn.updateKineticNetwork(); await tick(2);
itm.clearItemDrops();
itm.spawnItemDrop(25.5,21.7,76.4,BT.PLANKS,1);
itm.spawnItemDrop(25.5,21.7,76.7,cfg.DUST_ITEM_ID,1);
itm.spawnItemDrop(25.5,21.7,76.2,BT.TORCH,1);
for(let i=0;i<180;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);}
const T=gb(26,20,76);
const remain=S.itemDrops.map(dd=>dropId(dd));
RESULT={T, remain, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    rem = d.get("remain") or []
    checks = [
        ("木板（普通方块）被投放置", d.get("T") == 11, f"T={d.get('T')}(11=木板)"),
        ("红石粉/火把（贴面道具）不被投", rem.count(35) == 1 and rem.count(16) == 1, f"remain={rem}（35=红石粉,16=火把）"),
    ]
    return lib.report("L1-N07 只投普通方块", res, checks)


@case
def N08(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(40,66,30,10,20); // x40..69, z66..75
// 时钟：S(44,70)石，火把(44,69)北挂，粉(45,69)+(45,70)绕回；粉链延至干线离合器(46,73)：(46,70)(46,71)(46,72)
sb(44,20,70,BT.STONE);
rs.placeRedstone(44,20,69, cfg.RTORCH_ITEM_ID, N[2]);
rs.placeRedstone(45,20,69, cfg.DUST_ITEM_ID, N[0]);
rs.placeRedstone(45,20,70, cfg.DUST_ITEM_ID, N[0]);
rs.placeRedstone(46,20,70, cfg.DUST_ITEM_ID, N[0]);
rs.placeRedstone(46,20,71, cfg.DUST_ITEM_ID, N[0]);
rs.placeRedstone(46,20,72, cfg.DUST_ITEM_ID, N[0]);
// 下游干线 z=73：wheel(42)+水|轴43..45|离合(46)|轴47..66
kn.placeKinetic(42,20,73, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(42,21,73,BT.WATER);
for(let x=43;x<=45;x++)kn.placeKinetic(x,20,73, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(46,20,73, cfg.CLUTCH_ITEM_ID, N[3]);
for(let x=47;x<=66;x++)kn.placeKinetic(x,20,73, cfg.SHAFT_ITEM_ID, N[3]);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(4);
const rpmTxt=(s)=>/转速 8 RPM/.test(s)?8:(/静止|过载/.test(s)?0:-1);
let torchFlips=0, clutchFlips=0, lastT=gb(44,20,69), lastC=gb(46,20,73);
const samples=[];
for(let i=0;i<1800;i++){rs.updateRedstoneTick(1/60);ps.updatePistonTick(1/60);kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);
  const tN=gb(44,20,69), cN=gb(46,20,73);
  if(tN!==lastT)torchFlips++; if(cN!==lastC)clutchFlips++;
  lastT=tN;lastC=cN;
  if(i%300===0)samples.push(`e${cfg.clutchEngaged(cN)}:d${rpmTxt(kn.kineticStatusAt(66,20,73))}`);}
const finalEng=cfg.clutchEngaged(gb(46,20,73));
const finalDown=rpmTxt(kn.kineticStatusAt(66,20,73));
RESULT={torchFlips, clutchFlips, finalEng, finalDown, samples, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    tf, cf = d.get("torchFlips", 0), d.get("clutchFlips", 0)
    checks = [
        ("时钟振荡（30s 泵内 ≥20 翻转）", tf >= 20, f"torchFlips={tf}"),
        ("每次翻转恰好一次网络状态切换（离合器翻转≈火把翻转）", abs(tf - cf) <= 2, f"torch={tf} vs clutch={cf}"),
        ("下游同步无卡中间态（末态一致）", d.get("finalDown") == (8 if d.get("finalEng") == 1 else 0), f"finalEng={d.get('finalEng')}, 下游={d.get('finalDown')} RPM, 采样={d.get('samples')}"),
    ]
    return lib.report("L1-N08 时钟驱动离合器", res, checks)


@case
def N09(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(78,38,26,8,20); // x78..103, z38..45
// 五摆位（带全部东向）：
// 1) 贴轴顶：轴(84,20,40)，带(84,21,40)
// 2) 轴在带东：带(86,20,40)（贴地板支撑），轴(87,20,40)
// 3) 轴在带北(z-1)：带(89,20,41)，轴(89,20,40)
// 4) 轴在带南(z+1)：带(92,20,39)，轴(92,20,40)
// 5) 轴在带西：带(98,20,40)，轴(97,20,40)
kn.placeKinetic(80,20,40, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(80,21,40,BT.WATER);
const shaftCells=[81,82,83,84,85,87,88,89,90,91,92,93,94,95,96,97]; // 86=带位
for(const x of shaftCells) sb(x,20,40, cfg.shaftId(0));
sb(86,19,40,BT.STONE); sb(86,20,40,cfg.beltId(1));   // 轴在带东
sb(84,21,40,cfg.beltId(1));                          // 贴轴顶
sb(89,19,41,BT.STONE); sb(89,20,41,cfg.beltId(1));   // 轴北邻
sb(92,19,39,BT.STONE); sb(92,20,39,cfg.beltId(1));   // 轴南邻
sb(98,19,40,BT.STONE); sb(98,20,40,cfg.beltId(1));   // 轴在带西
kn.updateKineticNetwork(); await tick(4);
const cells=[[84,21,40,'轴顶'],[86,20,40,'轴东'],[89,20,41,'轴北'],[92,20,39,'轴南'],[98,20,40,'轴西']];
const runMap=cells.map(c=>`${c[3]}=${kn.isBeltRunningAt(c[0],c[1],c[2])}`);
itm.clearItemDrops();
const kinds=[BT.COBBLESTONE,BT.GRAVEL,BT.SAND,BT.BRICK,BT.PLANKS];
cells.forEach((c,i)=>itm.spawnItemDrop(c[0]+0.5, c[1]+1.6, c[2]+0.5, kinds[i],1));
for(let i=0;i<150;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
const moved=cells.map((c,i)=>{const dd=S.itemDrops.find(d=>dropId(d)===kinds[i]);
  return dd?`${c[3]}:+${(dd.x-(c[0]+0.5)).toFixed(2)}`:`${c[3]}:消失`;});
RESULT={runMap, moved, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    rm = " ".join(d.get("runMap") or [])
    mv = d.get("moved") or []
    moved_ok = len(mv) == 5 and all((":" in m) and (not m.endswith(":消失")) and (float(m.split(":+")[1]) > 0.2) for m in mv)
    checks = [
        ("五种摆位带全部运转（对称边锁定）", rm.count("=true") == 5, f"runMap: {rm}"),
        ("五种摆位物品均被带走（东移 >0.2 格）", moved_ok, f"moved={mv}"),
    ]
    return lib.report("L1-N09 带轴五摆位", res, checks)


@case
def N10(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(0,76,8,8,20); // x0..7, z76..83
kn.placeKinetic(4,20,80, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(4,21,80,BT.WATER);
kn.placeKinetic(3,20,80, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(2,20,80, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(1,20,80, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(0,20,80, cfg.DEPLOYER_ITEM_ID, N[5]); // 朝西 T=(-1) 界外；背面=东邻(1,20,80)轴
kn.updateKineticNetwork(); await tick(2);
const stTxt=kn.kineticStatusAt(0,20,80);
itm.clearItemDrops(); itm.spawnItemDrop(0.5,21.7,80.5,BT.COBBLESTONE,3);
for(let i=0;i<180;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);}
const cnt=S.itemDrops.length?S.itemDrops[0].count:null;
RESULT={st:stTxt, cnt, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("投料器供电正常（朝界外也接网）", isinstance(d.get("st"), str) and "8 RPM" in d["st"], d.get("st")),
        ("朝界外投料：不消耗、无方块", d.get("cnt") == 3, f"count={d.get('cnt')}"),
    ]
    return lib.report("L1-N10 越界投料守卫", res, checks)


@case
def N11(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(20,84,20,6,20); // x20..39, z84..89
kn.placeKinetic(22,20,86, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(22,21,86,BT.WATER);
kn.placeKinetic(23,20,86, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(24,20,86, cfg.CLUTCH_ITEM_ID, N[3]);
kn.placeKinetic(25,20,86, cfg.SHAFT_ITEM_ID, N[3]);
rs.placeRedstone(24,20,85, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(2);
rs.toggleLeverAt(24,20,85); rs.updateRedstoneNetwork(); await tick(4);
const offEng=cfg.clutchEngaged(gb(24,20,86));
rs.breakRedstoneAt(24,20,85); rs.updateRedstoneNetwork(); await tick(4);
const afterEng=cfg.clutchEngaged(gb(24,20,86));
const shaftTxt=kn.kineticStatusAt(25,20,86);
RESULT={offEng, afterEng, shaftTxt, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("前置：拉杆合 → 断开", d.get("offEng") == 0, f"engaged={d.get('offEng')}"),
        ("拆掉唯一拉杆 → 自动恢复接合（早退门）", d.get("afterEng") == 1, f"engaged={d.get('afterEng')}"),
        ("产线恢复转动", "转速 8" in str(d.get("shaftTxt")), f"下游={d.get('shaftTxt')}"),
    ]
    return lib.report("L1-N11 拆信号源自愈", res, checks)


@case
def N12b(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(40,84,26,6,20); // x40..65, z84..89
kn.placeKinetic(42,20,86, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(42,21,86,BT.WATER);
kn.placeKinetic(43,20,86, cfg.CLUTCH_ITEM_ID, N[3]);
for(let x=44;x<=52;x++){kn.placeKinetic(x,20,86, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,86,cfg.beltId(1));}
rs.placeRedstone(43,20,85, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(2);
itm.clearItemDrops(); itm.spawnItemDrop(45.5,22.6,86.5,BT.COBBLESTONE,1);
for(let i=0;i<30;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
rs.toggleLeverAt(43,20,85); rs.updateRedstoneNetwork(); await tick(2);
const stopX=S.itemDrops.length;
for(let i=0;i<7800;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
const after130=S.itemDrops.length;
rs.toggleLeverAt(43,20,85); rs.updateRedstoneNetwork(); await tick(2);
const afterOn=S.itemDrops.length;
RESULT={stopX, after130, afterOn, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("断电前物品在带停驻", d.get("stopX") == 1, f"{d.get('stopX')}"),
        ("断电 130s → 按寿命消失", d.get("after130") == 0, f"{d.get('after130')}"),
        ("复电后无幽灵物品", d.get("afterOn") == 0, f"{d.get('afterOn')}"),
    ]
    return lib.report("L1-N12b 断电超寿命衰减", res, checks)


@case
def N13(e2e):
    res = e2e.run(r"""
setDay(); ui.setGameMode('survival');
platform(20,90,24,8,20); // x20..43, z90..97
S.player.inventory[cfg.BELT_ITEM_ID]=0;
// 场1：粘液在带正上方，活塞水平推粘液 → 粘液走、带留原地
sb(26,19,92,BT.STONE); sb(26,20,92,cfg.beltId(1)); // 带(26,20,92)贴地
sb(26,21,92,BT.SLIME);                              // 粘悬在带上方（悬空）
ps.placePiston(25,21,92, cfg.PISTON_ITEM_ID, N[3]); // 朝东推粘液
rs.placeRedstone(25,21,91, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); await tick(2);
const beltBefore=gb(26,20,92);
rs.toggleLeverAt(25,21,91); rs.updateRedstoneNetwork(); await tick(10);
const slimeMoved=gb(27,21,92), beltAfter=gb(26,20,92);
rs.toggleLeverAt(25,21,91); rs.updateRedstoneNetwork(); await tick(10);
sb(27,21,92,BT.AIR); sb(26,21,92,BT.AIR);
// 场2：活塞推带的支撑块 → 支撑位移 → 带连锁弹落返还
// 搭建修正（2026-09-06）：支撑必须是孤立柱——原搭建把支撑嵌在连续平台层（24×8 连通 >12
// 推动上限），活塞实际从未动作，「支撑位移」是脚本预放石头的虚真、「带残留」是未发生任何
// 事的假象。孤立支撑悬在平台顶上方（y20），带坐其顶（y21），活塞水平推。
sb(30,20,92,BT.STONE);            // 孤立支撑（与平台不连通）
sb(30,21,92,cfg.beltId(1));       // 带在支撑(30,20,92)顶上
ps.placePiston(29,20,92, cfg.PISTON_ITEM_ID, N[3]); // 活塞贴支撑西侧朝东
rs.placeRedstone(29,20,91, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); await tick(2);
S.player.inventory[cfg.BELT_ITEM_ID]=0;
rs.toggleLeverAt(29,20,91); rs.updateRedstoneNetwork(); await tick(10);
const supMoved=gb(31,20,92), belt2=gb(30,21,92);
const refund=inv(cfg.BELT_ITEM_ID);
RESULT={beltBefore, slimeMoved, beltAfter, supMoved, belt2, refund, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("粘液被推走、带留原地", d.get("slimeMoved") == 97 and d.get("beltAfter") == d.get("beltBefore") == 203, f"粘液@27={d.get('slimeMoved')}(97), 带={d.get('beltBefore')}→{d.get('beltAfter')}"),
        ("推带下方支撑 → 支撑位移", d.get("supMoved") == 3, f"支撑@31={d.get('supMoved')}(3=石头)"),
        ("带连锁弹落返还", d.get("belt2") == 0 and d.get("refund") == 1, f"带={d.get('belt2')}, refund={d.get('refund')}"),
    ]
    return lib.report("L1-N13 粘液/支撑与带", res, checks)


@case
def N14(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(40,90,30,8,20); // x40..69, z90..97
kn.placeKinetic(42,20,92, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(42,21,92,BT.WATER);
kn.placeKinetic(43,20,92, cfg.CLUTCH_ITEM_ID, N[3]);
for(let x=44;x<=64;x++){kn.placeKinetic(x,20,92, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,92,cfg.beltId(1));}
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(2);
itm.clearItemDrops(); itm.spawnItemDrop(53.5,22.6,92.5,BT.COBBLESTONE,1);
for(let i=0;i<20;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
tn.spawnTntEntity(53,22,92);
for(let i=0;i<600;i++){tn.updateTnt(1/60);kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);if(S.tntEntities.length===0)break;}
const seg1=gb(47,21,92), seg2=gb(60,21,92);
const hole=gb(53,20,92)===0&&gb(53,21,92)===0;
const st1=kn.kineticStatusAt(47,21,92), st2=kn.kineticStatusAt(60,21,92);
const craterItem=S.itemDrops.length;
RESULT={seg1, seg2, hole, st1, st2, craterItem, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("爆坑形成（中段炸空）", d.get("hole"), f"hole={d.get('hole')}"),
        ("两段带各自存活", d.get("seg1") == 203 and d.get("seg2") == 203, f"seg1={d.get('seg1')}, seg2={d.get('seg2')}(203=带)"),
        ("两段状态各自可查（按分量定运转态）", isinstance(d.get("st1"), str) and isinstance(d.get("st2"), str), f"st1={d.get('st1')} | st2={d.get('st2')}"),
        ("爆坑物品恢复物理（不丢失）", d.get("craterItem") >= 1, f"itemDrops={d.get('craterItem')}"),
    ]
    return lib.report("L1-N14 TNT 炸带中段", res, checks)


@case
def N15(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(112,96,16,8,20); // x112..127, z96..103
kn.placeKinetic(117,20,100, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(117,21,100,BT.WATER);
for(let x=118;x<=126;x++)kn.placeKinetic(x,20,100, cfg.SHAFT_ITEM_ID, N[3]);
for(let x=120;x<=126;x++)sb(x,21,100,cfg.beltId(1));
sb(127,19,100,BT.STONE); sb(127,20,100,BT.AIR); sb(127,21,100,cfg.beltId(1)); // x=127 边缘带（自备支撑，y=21 与带行同层相接）
kn.updateKineticNetwork(); await tick(2);
const edgeRun=kn.isBeltRunningAt(127,21,100);
itm.clearItemDrops(); itm.spawnItemDrop(120.5,22.6,100.5,BT.COBBLESTONE,1);
let x=null,y=null,exited=false;
for(let i=0;i<420;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);
  const dd=S.itemDrops[0]; if(dd){x=+dd.x.toFixed(2);y=+dd.y.toFixed(2); if(dd.x>127.4||dd.y<10){exited=true;break;}}}
const gone=S.itemDrops.length===0;
RESULT={edgeRun, x, y, exited, gone, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("边缘格带照常运转", d.get("edgeRun"), f"running={d.get('edgeRun')}"),
        ("物品到尽头不卡死（越界坠虚或耗寿命）", d.get("exited") or d.get("gone"), f"轨迹 x={d.get('x')}, y={d.get('y')}, exited={d.get('exited')}, gone={d.get('gone')}"),
    ]
    return lib.report("L1-N15 带端出界", res, checks)


@case
def N16(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(20,98,20,8,20); // x20..39, z98..105
// wheel(22,102)+水|轴(23,102)|供电带(23,21,102)|投料器(24,21,102)朝东 T=(25,21,102)=粉碎对A(25,20,102)投料口
kn.placeKinetic(22,20,102, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(22,21,102,BT.WATER);
kn.placeKinetic(23,20,102, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(25,20,102, cfg.CRUSHER_ITEM_ID, N[3]);
kn.placeKinetic(25,20,103, cfg.CRUSHER_ITEM_ID, N[3]);
sb(23,21,102,cfg.beltId(1));
kn.placeKinetic(24,21,102, cfg.DEPLOYER_ITEM_ID, N[3]);
kn.updateKineticNetwork(); await tick(2);
const depSt=kn.kineticStatusAt(24,21,102);
itm.clearItemDrops(); itm.spawnItemDrop(24.5,22.7,102.5,BT.WOOL,2);
for(let i=0;i<180;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);}
const woolT=gb(25,21,102), woolCnt=S.itemDrops.length?S.itemDrops[0].count:0;
itm.clearItemDrops(); itm.spawnItemDrop(24.5,22.7,102.5,BT.COBBLESTONE,2);
let cobT=null; const q0=performance.now();
while(performance.now()-q0<1500){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);
  if(gb(25,21,102)===BT.COBBLESTONE){cobT=performance.now()-q0;break;}}
RESULT={depSt, woolT, woolCnt, cobT, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("投料器经带桥供电", isinstance(d.get("depSt"), str) and "8 RPM" in d["depSt"], d.get("depSt")),
        ("羊毛被投料口守卫拦截（不放置不消耗）", d.get("woolT") == 0 and d.get("woolCnt") == 2, f"T={d.get('woolT')}, count={d.get('woolCnt')}"),
        ("圆石正常投进投料口", d.get("cobT") is not None, f"t={d.get('cobT')}ms"),
    ]
    return lib.report("L1-N16 投料口配方守卫", res, checks)


@case
def N17(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(50,84,26,8,20); // x50..75, z84..91
kn.placeKinetic(52,20,86, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(52,21,86,BT.WATER);
kn.placeKinetic(53,20,86, cfg.CLUTCH_ITEM_ID, N[3]);
for(let x=54;x<=66;x++){kn.placeKinetic(x,20,86, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,86,cfg.beltId(1));}
sb(61,21,86,BT.BRICK);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(2);
itm.clearItemDrops(); itm.spawnItemDrop(54.5,22.6,86.5,BT.COBBLESTONE,1);
let p=null;
for(let i=0;i<400;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);
  const dd=S.itemDrops[0]; if(dd&&dd.x>60.2){p={x:+dd.x.toFixed(2),y:+dd.y.toFixed(2)};break;}}
// 等停稳（连续 60 帧位移 <0.02）
let p2=null, prev=p?p.x:-99;
for(let i=0;i<600;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);
  const dN=S.itemDrops[0]; const xN=dN?dN.x:prev;
  if(i%60===59){if(Math.abs(xN-prev)<0.02){p2={x:+xN.toFixed(2),y:+(dN?dN.y:0).toFixed(2)};break;} prev=xN;}}
const dd=S.itemDrops[0];
const noClip=p&&p2&&p2.x<=61.01;
RESULT={p, p2, noClip, alive:!!dd, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("被占格前停驻（不穿模，中心 ≤ 墙面 x=61）", d.get("noClip"), f"{d.get('p')} → {d.get('p2')}"),
        ("物品不丢失", d.get("alive"), f"alive={d.get('alive')}"),
    ]
    return lib.report("L1-N17 带前被占格", res, checks)


@case
def N18_N23(e2e):
    res = e2e.run(r"""
setDay(); ui.setGameMode('survival');
platform(50,92,26,8,20); // x50..75, z92..99
kn.placeKinetic(52,20,94, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(52,21,94,BT.WATER);
for(let x=53;x<=68;x++){kn.placeKinetic(x,20,94, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,94,cfg.beltId(1));}
kn.updateKineticNetwork(); await tick(2);
S.player.inventory[BT.COBBLESTONE]=0;
itm.clearItemDrops();
for(let i=0;i<10;i++)itm.spawnItemDrop(53.5,22.6,94.5,BT.COBBLESTONE,1);
let minGap=99;
for(let i=0;i<420;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);
  const xs=S.itemDrops.map(dd=>dd.x).sort((a,b)=>a-b);
  if(xs.length>=2&&xs[0]>54.5){let g=99;for(let k=1;k<xs.length;k++)g=Math.min(g,xs[k]-xs[k-1]);minGap=Math.min(minGap,g);}
  if(xs.length&&xs[0]>67.5)break;}
const nMid=S.itemDrops.length;
S.player.x=69.5;S.player.y=20.0;S.player.z=94.5;S.player.vx=S.player.vy=S.player.vz=0;
for(let i=0;i<600;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);pp.updatePlayerPhysics(1/60);}
const picked=inv(BT.COBBLESTONE);
const remain=S.itemDrops.length;
RESULT={nMid, minGap:+minGap.toFixed(3), picked, remain, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("10 实体独立运送无丢失", d.get("nMid") == 10, f"途中实体数={d.get('nMid')}"),
        ("N23 排队间距 >0（不叠成一点）", isinstance(d.get("minGap"), (int, float)) and 0 < d["minGap"] < 90, f"minGap={d.get('minGap')}"),
        ("尽头全数拾取 +10", d.get("picked") == 10 and d.get("remain") == 0, f"拾取={d.get('picked')}, 残留={d.get('remain')}"),
    ]
    return lib.report("L1-N18/N23 多实体运送与排队", res, checks)


@case
def N19(e2e):
    res = e2e.run(r"""
setDay(); ui.setGameMode('survival');
platform(20,106,26,8,20); // x20..45, z106..113
kn.placeKinetic(22,20,108, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(22,21,108,BT.WATER);
for(let x=23;x<=38;x++){kn.placeKinetic(x,20,108, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,108,cfg.beltId(1));}
kn.updateKineticNetwork(); await tick(2);
S.player.inventory[BT.COBBLESTONE]=0;
itm.clearItemDrops();
itm.spawnItemDrop(26.5,22.3,108.5,BT.COBBLESTONE,1,{pickupDelay:1.5});
for(let i=0;i<60;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
const during=S.itemDrops[0];
const x0=during?+during.x.toFixed(2):null;
S.player.x=28.5;S.player.y=20.0;S.player.z=108.5;S.player.vx=S.player.vy=S.player.vz=0;
for(let i=0;i<300;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);pp.updatePlayerPhysics(1/60);}
const picked=inv(BT.COBBLESTONE);
RESULT={x0, movedDuring:x0!==null&&x0>27.0, picked, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("冷却中丢弃物照走 carried", d.get("movedDuring"), f"1s 后 x={d.get('x0')}(起点 26.5)"),
        ("冷却结束后可拾回", d.get("picked") == 1, f"picked={d.get('picked')}"),
    ]
    return lib.report("L1-N19 冷却丢弃物上带", res, checks)


@case
def N20(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(50,106,10,8,20); // x50..59, z106..113
sb(54,20,108,BT.STONE); sb(54,21,108,cfg.beltId(1));
const r=bq.enqueueBuildOps('place_blocks', [[54,21,108,BT.STONE]]);
bq.setBuildSpeedByBps(Infinity);
for(let i=0;i<10;i++)bq.updateBuild(0.1);
const after=gb(54,21,108);
RESULT={ret:JSON.stringify(r), after, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("AI 施工直接替换带格（创造语义）", d.get("after") == 3, f"带(203) → {d.get('after')}(3=石头)"),
    ]
    return lib.report("L1-N20 AI 施工覆盖带格", res, checks)


@case
def N21(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(64,106,12,8,20); // x64..75, z106..113
kn.placeKinetic(66,20,108, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(66,21,108,BT.WATER);
kn.placeKinetic(67,20,108, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(68,20,108, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(69,20,108, cfg.DEPLOYER_ITEM_ID, N[3]); // T=(70,20,108)
sb(70,20,108,BT.WATER);
kn.updateKineticNetwork(); await tick(2);
itm.clearItemDrops(); itm.spawnItemDrop(69.5,21.7,108.5,BT.WATER,3);
for(let i=0;i<180;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);}
const cnt=S.itemDrops.length?S.itemDrops[0].count:null;
const T=gb(70,20,108);
RESULT={cnt, T, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("水投水守卫：不消耗无变化", d.get("cnt") == 3 and d.get("T") == 7, f"count={d.get('cnt')}, T={d.get('T')}(7=水)"),
    ]
    return lib.report("L1-N21 水投水守卫", res, checks)


@case
def N22(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(78,106,16,8,20); // x78..93, z106..113
kn.placeKinetic(80,20,108, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(80,21,108,BT.WATER);
for(let x=81;x<=86;x++){kn.placeKinetic(x,20,108, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,108,cfg.beltId(1));}
for(let x=88;x<=90;x++){sb(x,20,108,BT.STONE); sb(x,21,108,cfg.beltId(1));}
kn.updateKineticNetwork(); await tick(2);
const running=kn.isBeltRunningAt(83,21,108), still=kn.isBeltRunningAt(89,21,108);
S.player.flying=false;
S.player.x=83.5;S.player.y=21.0;S.player.z=108.5;S.player.vx=S.player.vy=S.player.vz=0;
const px0=S.player.x;
for(let i=0;i<90;i++){pp.updatePlayerPhysics(1/60);kn.updateKineticTick(1/60);}
const dxRun=S.player.x-px0;
S.player.x=89.5;S.player.y=21.0;S.player.z=108.5;S.player.vx=S.player.vy=S.player.vz=0;
const px1=S.player.x;
for(let i=0;i<90;i++){pp.updatePlayerPhysics(1/60);kn.updateKineticTick(1/60);}
const dxStill=S.player.x-px1;
RESULT={running, still, dxRun:+dxRun.toFixed(2), dxStill:+dxStill.toFixed(2), log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("一转一停两条带状态正确", d.get("running") is True and d.get("still") is False, f"running={d.get('running')}, still={d.get('still')}"),
        ("玩家站 running 带被带动", isinstance(d.get("dxRun"), (int, float)) and d["dxRun"] > 0.8, f"1.5s dx={d.get('dxRun')} 格"),
        ("玩家站静止带无移动", isinstance(d.get("dxStill"), (int, float)) and abs(d["dxStill"]) < 0.2, f"dx={d.get('dxStill')}"),
    ]
    return lib.report("L1-N22 玩家骑带", res, checks)


# ================================================================ S 组
@case
def S01(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative'; clearSaves();
platform(20,114,24,8,20); // x20..43, z114..121
kn.placeKinetic(22,20,116, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(22,21,116,BT.WATER);
kn.placeKinetic(23,20,116, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(24,20,116, cfg.CLUTCH_ITEM_ID, N[3]);
kn.placeKinetic(25,20,116, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(26,20,116, cfg.DEPLOYER_ITEM_ID, N[3]);
for(let x=27;x<=30;x++){kn.placeKinetic(x,20,116, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,116,cfg.beltId(1));}
rs.placeRedstone(24,20,115, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(2);
rs.toggleLeverAt(24,20,115); rs.updateRedstoneNetwork(); await tick(2); // 断开态入库
const line=[]; for(let x=22;x<=30;x++)line.push(gb(x,20,116));
const belts=[]; for(let x=27;x<=30;x++)belts.push(gb(x,21,116));
const stDepB=kn.kineticStatusAt(26,20,116);
const saved=sg.saveGame();                      // 先存（建索引）
const j0=JSON.parse(sg.exportSlotJson());
const keys0=Object.keys(j0).sort(), pkeys0=Object.keys(j0.player||{}).sort();
const loaded=sg.loadGame();
rs.initRedstone(); kn.initKinetic(); itm.clearItemDrops(); // 等价 main.js 切世界序列
await tick(4);
const line2=[]; for(let x=22;x<=30;x++)line2.push(gb(x,20,116));
const belts2=[]; for(let x=27;x<=30;x++)belts2.push(gb(x,21,116));
const stDepA=kn.kineticStatusAt(26,20,116);
sg.saveGame();                                   // 读档后再存一次
const j1=JSON.parse(sg.exportSlotJson());
const keys1=Object.keys(j1).sort(), pkeys1=Object.keys(j1.player||{}).sort();
const blocksEq=JSON.stringify(j0.blocks)===JSON.stringify(j1.blocks);
RESULT={saved, keys0, keys1, pkeys0, pkeys1, blocksEq, lineEq:line.join()===line2.join(), beltsEq:belts.join()===belts2.join(),
  stDepB, stDepA, clutch:[cfg.clutchEngaged(line[2]),cfg.clutchEngaged(line2[2])], log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    cl = d.get("clutch") or [None, None]
    checks = [
        ("方块 ID（dir/facing/断开态）往返一致", d.get("lineEq") and d.get("beltsEq"), f"engaged {cl[0]}→{cl[1]}"),
        ("重算后状态与存前一致（断开下游停）", d.get("stDepB") == d.get("stDepA"), f"{d.get('stDepB')} → {d.get('stDepA')}"),
        ("存档顶层 key 集逐次相等（无新字段）", d.get("keys0") == d.get("keys1"), f"{d.get('keys0')}"),
        ("player 子 key 集逐次相等", d.get("pkeys0") == d.get("pkeys1"), f"{len(d.get('pkeys0') or [])} 键"),
        ("RLE 后 blocks 结构逐字节不变", d.get("blocksEq"), f"blocksEq={d.get('blocksEq')}"),
    ]
    return lib.report("L1-S01 存档往返不变式", res, checks)


@case
def S02(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(40,114,20,8,20); // x40..59, z114..121
kn.placeKinetic(42,20,116, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(42,21,116,BT.WATER);
for(let x=43;x<=50;x++){kn.placeKinetic(x,20,116, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,116,cfg.beltId(1));}
kn.updateKineticNetwork(); await tick(2);
itm.clearItemDrops();
itm.spawnItemDrop(45.5,22.6,116.5,BT.COBBLESTONE,1);
itm.spawnItemDrop(46.5,22.6,116.5,BT.GRAVEL,1);
for(let i=0;i<40;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
const nBefore=S.itemDrops.length;
const saved=sg.saveGame(); const loaded=sg.loadGame();
rs.initRedstone(); kn.initKinetic(); itm.clearItemDrops(); // 等价 main.js 切世界序列
await tick(4);
const nAfter=S.itemDrops.length;
const beltRun=kn.isBeltRunningAt(47,21,116);
RESULT={nBefore, nAfter, beltRun, saved, loaded, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("运送中物品读档后消失", d.get("nBefore") == 2 and d.get("nAfter") == 0, f"{d.get('nBefore')} → {d.get('nAfter')}"),
        ("带恢复运转", d.get("beltRun"), f"running={d.get('beltRun')}"),
    ]
    return lib.report("L1-S02 带载物品读档处置", res, checks)


@case
def S03(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative'; clearSaves();
platform(60,114,16,8,20); // x60..75, z114..121
kn.placeKinetic(62,20,116, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(62,21,116,BT.WATER);
kn.placeKinetic(63,20,116, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(64,20,116, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(65,20,116, cfg.DEPLOYER_ITEM_ID, N[3]); // T=(66,20,116)
kn.updateKineticNetwork(); await tick(2);
sg.saveGame();                       // 槽 0 = L1 世界
S.saveSlot=1; sg.saveGame();         // 槽 1（切换目标）
const exported=sg.exportSlotJson(0);
sg.importSlotJson(exported, 2);                 // 导入到槽 2（import 无返回值，行为验证）
const imp2=sg.loadGame(2); rs.initRedstone(); kn.initKinetic();
const depInSlot2=gb(65,20,116);                 // 导入槽 2 加载后新 ID 方块在位
const l1=sg.loadGame(1); rs.initRedstone(); kn.initKinetic();
const l0=sg.loadGame(0); rs.initRedstone(); kn.initKinetic(); await tick(4);
const depId=gb(65,20,116);
itm.clearItemDrops(); itm.spawnItemDrop(65.5,21.7,116.5,BT.COBBLESTONE,4);
for(let i=0;i<40;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
const placed1=gb(66,20,116)===BT.COBBLESTONE;
sb(66,20,116,BT.AIR);
S.saveSlot=1; sg.saveGame(); sg.loadGame(1); S.saveSlot=0; sg.loadGame(0); // 0.2s 内切槽再切回
rs.initRedstone(); kn.initKinetic(); await tick(2);
let tFire=null; const q0=performance.now();
while(performance.now()-q0<1200){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);
  if(gb(66,20,116)===BT.COBBLESTONE){tFire=performance.now()-q0;break;}}
RESULT={expLen:exported.length, imp2, depInSlot2, l1, l0, depId, placed1, tFire, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("六槽切换来回 + 导出导入（槽 2 可加载出同世界）", d.get("imp2") and d.get("depInSlot2") == 209 and d.get("l1") and d.get("l0"), f"导入槽2 加载={d.get('imp2')}, 投料器@槽2={d.get('depInSlot2')}, 槽1={d.get('l1')}, 回0={d.get('l0')}, 导出 {d.get('expLen')} 字节"),
        ("切回后新 ID 方块状态一致", d.get("depId") == 209, f"depId={d.get('depId')}(209=朝东)"),
        ("切槽再切回后投料器冷却归零", d.get("placed1") and d.get("tFire") is not None, f"首投={d.get('placed1')}, 切回后 t={d.get('tFire')}ms"),
    ]
    return lib.report("L1-S03 六槽切换/导出导入", res, checks)


# ================================================================ P 组（各自 fresh_page；世界 128×128 复用 z=114..127 带）
def _perf_body(setup, frames=1200):
    return r"""
setDay(); S.gameMode='creative';
""" + setup + r"""
// 预热：300 帧 tick + 10 次双重算（JIT/缓存热身后才计量）
for(let i=0;i<300;i++){rs.updateRedstoneTick(1/60);ps.updatePistonTick(1/60);kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
for(let i=0;i<10;i++){rs.updateRedstoneNetwork(); kn.updateKineticNetwork();}
const times=[];
for(let i=0;i<""" + str(frames) + r""";i++){
  const t0=performance.now();
  rs.updateRedstoneTick(1/60); ps.updatePistonTick(1/60); kn.updateKineticTick(1/60); itm.updateItemDrops(1/60);
  times.push(performance.now()-t0);
}
const sorted=[...times].sort((a,b)=>a-b);
const mean=times.reduce((a,b)=>a+b,0)/times.length;
const p95=sorted[Math.ceil(0.95*times.length)-1];
const rsT=[], knT=[];
for(let i=0;i<50;i++){const t0=performance.now(); rs.updateRedstoneNetwork(); rsT.push(performance.now()-t0);
  const t1=performance.now(); kn.updateKineticNetwork(); knT.push(performance.now()-t1);}
const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
RESULT={mean, p95, mx:sorted[sorted.length-1], rsMean:avg(rsT), rsMax:Math.max(...rsT), knMean:avg(knT), knMax:Math.max(...knT), log:LOG};
return JSON.stringify(RESULT);
"""


@case
def P01(e2e):
    e2e.fresh_page()
    setup = r"""
platform(18,114,112,14,20); // x18..129(裁到127), z114..127
sb(18,19,121,BT.STONE);
kn.placeKinetic(18,20,121, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(18,21,121,BT.WATER);
for(let x=19;x<=118;x++) sb(x,20,121, cfg.shaftId(0)); // 100 轴
kn.updateKineticNetwork();
// 时钟：S(24,124)石，火把(24,123)北挂，粉(25,123)+(25,124)绕回
sb(24,20,124,BT.STONE);
rs.placeRedstone(24,20,123, cfg.RTORCH_ITEM_ID, N[2]);
rs.placeRedstone(25,20,123, cfg.DUST_ITEM_ID, N[0]);
rs.placeRedstone(25,20,124, cfg.DUST_ITEM_ID, N[0]);
rs.updateRedstoneNetwork(); await tick(4);
"""
    res = e2e.run(_perf_body(setup))
    d = res if isinstance(res, dict) else {}
    checks = [
        ("tick mean ≤0.58ms（L2 重定 2026-09-06，原 0.54：滑轮批次红石扫描分支细分 + 动力机器链挂 updatePulleys 的功能必需成本，新常态 0.54~0.56；分支形态回归 1.2ms 已由「pulleys 并入 CLUTCH 短路分支」消除，见 org-log 批次 L2）", isinstance(d.get("mean"), (int, float)) and d["mean"] <= 0.58, f"mean={d.get('mean')}ms"),
        ("tick p95 ≤4.4ms（联动重定基线 2026-09-06，原 3.72：p95 尾帧=时钟翻转时的红石全量重算帧，重算已重定新常态 3.5~3.7 ⇒ p95 新常态 3.6~3.8，见 org-log）", isinstance(d.get("p95"), (int, float)) and d["p95"] <= 4.4, f"p95={d.get('p95')}ms, max={d.get('mx')}ms"),
        ("红石重算 mean ≤4.3ms（重定基线 2026-09-06，原 3.6：离合器扫描分支为功能必需成本，新常态 3.3~3.6，G3 裁决见 org-log）", isinstance(d.get("rsMean"), (int, float)) and d["rsMean"] <= 4.3, f"mean={d.get('rsMean')}ms, max={d.get('rsMax')}ms"),
        ("动力重算 mean ≤2.5ms", isinstance(d.get("knMean"), (int, float)) and d["knMean"] <= 2.5, f"mean={d.get('knMean')}ms, max={d.get('knMax')}ms"),
    ]
    return lib.report("L1-P01 基线复跑（100轴+时钟）", res, checks)


@case
def P02(e2e):
    e2e.fresh_page()
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(18,114,112,14,20);
sb(18,19,121,BT.STONE);
kn.placeKinetic(18,20,121, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(18,21,121,BT.WATER);
for(let x=19;x<=45;x++) sb(x,20,121, cfg.shaftId(0));
sb(46,20,121, cfg.clutchId(0,1));
for(let x=47;x<=118;x++) sb(x,20,121, cfg.shaftId(0));
rs.placeRedstone(46,20,120, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(4);
const measure=(n)=>{const ts=[];for(let i=0;i<n;i++){const t0=performance.now();
  rs.updateRedstoneTick(1/60);ps.updatePistonTick(1/60);kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);
  ts.push(performance.now()-t0);} const s=[...ts].sort((a,b)=>a-b);
  return {mean:ts.reduce((a,b)=>a+b,0)/ts.length, p95:s[Math.ceil(0.95*ts.length)-1]};};
let clutchFlips=0; let lastC=gb(46,20,121);
const flip=()=>{const c=gb(46,20,121); if(c!==lastC){clutchFlips++;lastC=c;}};
measure(600); flip();
rs.toggleLeverAt(46,20,120); rs.updateRedstoneNetwork();
const on=measure(1200); flip();
rs.toggleLeverAt(46,20,120); rs.updateRedstoneNetwork();
const offM=measure(1200); flip();
// (b) 时钟驱动：拆拉杆 → 时钟（S(44,124)，火把(44,123)，粉(45,123)+(45,124)+(46,124) 邻离合器(46,121)?）
// 离合器在干线 (46,20,121)，其北邻 (46,20,120)=拉杆位已拆 → 摆粉 (46,20,120)：
rs.breakRedstoneAt(46,20,120); rs.updateRedstoneNetwork();
sb(44,20,124,BT.STONE);
rs.placeRedstone(44,20,123, cfg.RTORCH_ITEM_ID, N[2]);
rs.placeRedstone(45,20,123, cfg.DUST_ITEM_ID, N[0]);
rs.placeRedstone(45,20,124, cfg.DUST_ITEM_ID, N[0]);
rs.placeRedstone(46,20,124, cfg.DUST_ITEM_ID, N[0]); // 粉链延至 (46,124)
rs.placeRedstone(46,20,120, cfg.DUST_ITEM_ID, N[0]); // 接离合器北邻（由 (46,121)? 邻 (46,120)？粉邻粉沿 z：124→120 不相邻！）
// 改直接把干线离合器旁摆第二枚离合器 (46,20,120) 由粉 (46,124) 充能？距离太远——简化：粉 (46,120) 与 (45,123) 不通。
// 正确布线：粉链 (45,123)→(45,124)→(46,124)；再放离合器在 (46,124) 南邻 (46,125)？干线在 z=121 不经过。
// 最终方案：把一枚新离合器直接放在粉旁 (46,20,124) 的邻格 (47,20,124)——它属于另一分量（不串干线），仅用于计数重算行为。
sb(46,20,120,BT.AIR);
rs.updateRedstoneNetwork();
sb(47,20,124, cfg.clutchId(0,1)); // 接合态落位，邻粉 (46,124)
rs.updateRedstoneNetwork(); kn.updateKineticNetwork(); await tick(4);
let torchFlips=0, cFlips=0, lastT=gb(44,20,123); lastC=gb(47,20,124);
const ts=[];
for(let i=0;i<1200;i++){const t0=performance.now();
  rs.updateRedstoneTick(1/60);ps.updatePistonTick(1/60);kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);
  ts.push(performance.now()-t0);
  const tN=gb(44,20,123), cN=gb(47,20,124);
  if(tN!==lastT)torchFlips++; if(cN!==lastC)cFlips++; lastT=tN;lastC=cN;}
const s2=[...ts].sort((a,b)=>a-b);
const clk={mean:ts.reduce((a,b)=>a+b,0)/ts.length, p95:s2[Math.ceil(0.95*ts.length)-1]};
RESULT={on, offM, clutchFlips, clk, torchFlips, cFlips, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    on, offm, clk = d.get("on", {}), d.get("offM", {}), d.get("clk", {})
    checks = [
        ("(a) 稳态合闸段 mean ≤0.54 / p95 ≤3.72", on.get("mean", 99) <= 0.54 and on.get("p95", 99) <= 3.72, f"mean={on.get('mean')}ms, p95={on.get('p95')}ms"),
        ("(a) 稳态断开段 mean ≤0.54 / p95 ≤3.72", offm.get("mean", 99) <= 0.54 and offm.get("p95", 99) <= 3.72, f"mean={offm.get('mean')}ms, p95={offm.get('p95')}ms"),
        ("(a) 重算次数=翻转次数（合/断各一次 → 恰 2 次翻转变体）", d.get("clutchFlips") == 2, f"clutchFlips={d.get('clutchFlips')}"),
        ("(b) 时钟驱动：动力重算次数=时钟翻转次数（写出门生效）", abs((d.get("torchFlips") or 0) - (d.get("cFlips") or 0)) <= 2, f"torch={d.get('torchFlips')} vs clutch={d.get('cFlips')}"),
    ]
    print(f"  [RECORD][P02(b) 债务表] 时钟驱动离合器 1200 帧: mean={clk.get('mean')}ms, p95={clk.get('p95')}ms（不设门）")
    return lib.report("L1-P02 拆门语义", res, checks)


@case
def P03(e2e):
    e2e.fresh_page()
    setup = r"""
platform(18,114,112,14,20);
sb(18,19,120,BT.STONE);
kn.placeKinetic(18,20,120, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(18,21,120,BT.WATER);
for(let x=19;x<=124;x++){sb(x,20,120, cfg.shaftId(0)); sb(x,21,120, cfg.beltId(1));} // 106 带
kn.updateKineticNetwork();
itm.clearItemDrops();
for(let i=0;i<100;i++)itm.spawnItemDrop(19.5+i*1.0, 22.6, 120.5, BT.COBBLESTONE, 1);
for(let i=0;i<30;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}
"""
    res = e2e.run(_perf_body(setup))
    d = res if isinstance(res, dict) else {}
    checks = [
        ("100带+100物品 tick mean ≤0.54ms", isinstance(d.get("mean"), (int, float)) and d["mean"] <= 0.54, f"mean={d.get('mean')}ms"),
        ("100带+100物品 tick p95 ≤3.72ms", isinstance(d.get("p95"), (int, float)) and d["p95"] <= 3.72, f"p95={d.get('p95')}ms, max={d.get('mx')}ms"),
    ]
    return lib.report("L1-P03 百带百物", res, checks)


@case
def P04(e2e):
    e2e.fresh_page()
    setup = r"""
platform(18,114,60,14,20);
sb(18,19,120,BT.STONE);
kn.placeKinetic(18,20,120, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(18,21,120,BT.WATER);
for(let x=19;x<=59;x++) sb(x,20,120, cfg.shaftId(0));
// 10 投料器：z=119 朝南（背=(x,20,120)=轴，T=(x,20,118)=空），各头顶 20 实体
itm.clearItemDrops();
for(let i=0;i<10;i++){
  const x=22+i*4;
  kn.placeKinetic(x,20,119, cfg.DEPLOYER_ITEM_ID, N[4]);
  for(let k=0;k<20;k++)itm.spawnItemDrop(x+0.5, 21.7, 119.5+(k%3)*0.05, BT.COBBLESTONE, 1);
}
kn.updateKineticNetwork(); await tick(2);
"""
    res = e2e.run(_perf_body(setup))
    d = res if isinstance(res, dict) else {}
    checks = [
        ("10 投料器+200 物品 tick mean ≤0.54ms", isinstance(d.get("mean"), (int, float)) and d["mean"] <= 0.54, f"mean={d.get('mean')}ms"),
        ("10 投料器+200 物品 tick p95 ≤3.72ms", isinstance(d.get("p95"), (int, float)) and d["p95"] <= 3.72, f"p95={d.get('p95')}ms, max={d.get('mx')}ms"),
    ]
    print("  [NOTE] P04 持续供料语义：首拍 10 台齐投后目标格被占进入跳过-扫描循环（冷却照走、200 实体×3 捕获格扫描持续），即 P-3 攻击的成本主体。")
    return lib.report("L1-P04 十投料器持续供料", res, checks)


@case
def A5a(e2e):
    e2e.fresh_page()
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
// 500 格蛇形带：20 行(z=100..119) × 25 列(x=30..54)，同行相邻、行尾换列相接（对折）
for(let r=0;r<20;r++){const z=100+r;
  for(let i=0;i<25;i++){const x=30+i; sb(x,19,z,BT.STONE); sb(x,20,z,cfg.beltId((r%2===0)?1:3));}}
kn.placeKinetic(28,20,100, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(28,21,100,BT.WATER);
kn.placeKinetic(29,20,100, cfg.SHAFT_ITEM_ID, N[3]);
kn.updateKineticNetwork(); await tick(2);
const stNear=kn.kineticStatusAt(30,20,100);
const stFar=kn.kineticStatusAt(54,20,119);
const sameComp=String(stNear).includes('过载（应力 2000/64')&&String(stFar).includes('过载（应力 2000/64'); // 两端同过载应力=同一分量（带向文案随行向不同，属正常）
for(let i=0;i<10;i++)kn.updateKineticNetwork(); // 预热
const t=[]; for(let i=0;i<50;i++){const t0=performance.now(); kn.updateKineticNetwork(); t.push(performance.now()-t0);}
const mean=t.reduce((a,b)=>a+b,0)/t.length;
RESULT={stNear, stFar, sameComp, mean, max:Math.max(...t), log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("蛇形带单分量（两端同状态：2000SU/64 必然整网过载）", d.get("sameComp"), f"near={d.get('stNear')} | far={d.get('stFar')}"),
        ("500 带动力重算 mean ≤2.5ms", isinstance(d.get("mean"), (int, float)) and d["mean"] <= 2.5, f"mean={d.get('mean')}ms, max={d.get('max')}ms"),
    ]
    return lib.report("A5(a) 500 格蛇形带重算", res, checks)


# ================================================================ 第二层附加攻击
@case
def ATK_wheel_remove(e2e):
    e2e.fresh_page()
    res = e2e.run(r"""
setDay(); S.gameMode='creative'; clearSaves();
platform(20,100,30,8,20); // x20..49, z100..107
// 双水车（128 容量）+ 3 对粉碎轮（96 负载）：wheel(22,104)+wheel(26,104)，轴23..25，对列 x=27..29
kn.placeKinetic(22,20,104, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(22,21,104,BT.WATER);
kn.placeKinetic(23,20,104, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(24,20,104, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(25,20,104, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(26,20,104, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(26,21,104,BT.WATER);
for(let i=0;i<2;i++){kn.placeKinetic(27+i,20,104, cfg.CRUSHER_ITEM_ID, N[3]); kn.placeKinetic(27+i,20,105, cfg.CRUSHER_ITEM_ID, N[3]);}
kn.updateKineticNetwork(); await tick(2);
const st0=kn.kineticStatusAt(22,20,104);
sg.saveGame(); sg.loadGame(); rs.initRedstone(); kn.initKinetic(); await tick(2);
const st1=kn.kineticStatusAt(22,20,104);
sb(26,21,104,BT.STONE); kn.breakKineticAt(26,20,104);
sb(26,20,104, cfg.shaftId(0)); // 拆水车后补轴续链（碎轮原经水车格串接）
kn.updateKineticNetwork(); await tick(2);
const st2=kn.kineticStatusAt(22,20,104);
kn.breakKineticAt(28,20,104); kn.breakKineticAt(28,20,105); kn.updateKineticNetwork(); await tick(2);
const st3=kn.kineticStatusAt(22,20,104);
RESULT={st0, st1, st2, st3, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("存档往返后 128/128 运转一致", d.get("st0") == d.get("st1") and "128/128" in str(d.get("st1")), f"{d.get('st0')} → {d.get('st1')}"),
        ("拆一台水车 → 128/64 过载停转", "过载" in str(d.get("st2")), f"{d.get('st2')}"),
        ("减载 → 64/64 恢复运转", "64/64" in str(d.get("st3")) and "转速 8" in str(d.get("st3")), f"{d.get('st3')}"),
    ]
    return lib.report("ATK 读档后拆水车应力收敛", res, checks)


# ================================================================ 第四层：泄漏审计
@case
def LEAK(e2e):
    e2e.fresh_page()
    res = e2e.run(r"""
setDay(); S.gameMode='creative'; clearSaves();
platform(20,100,20,8,20); // 产线区 x20..39, z100..107
const metrics=()=>({geo:eng.renderer.info.memory.geometries, tex:eng.renderer.info.memory.textures,
  scene:eng.scene.children.length, drops:S.itemDrops.length, dropped:S.droppedItems.length});
const buildLine=()=>{
  kn.placeKinetic(22,20,102, cfg.WATERWHEEL_ITEM_ID, N[3]); sb(22,21,102,BT.WATER);
  kn.placeKinetic(23,20,102, cfg.CLUTCH_ITEM_ID, N[3]);
  for(let x=24;x<=30;x++){kn.placeKinetic(x,20,102, cfg.SHAFT_ITEM_ID, N[3]); sb(x,21,102,cfg.beltId(1));}
  kn.placeKinetic(31,20,102, cfg.DEPLOYER_ITEM_ID, N[3]);
  rs.placeRedstone(23,20,101, cfg.LEVER_ITEM_ID, N[2]);
  rs.updateRedstoneNetwork(); kn.updateKineticNetwork();
};
const teardown=()=>{
  rs.breakRedstoneAt(23,20,101);
  kn.breakKineticAt(31,20,102);
  for(let x=24;x<=30;x++){kn.breakKineticAt(x,21,102); kn.breakKineticAt(x,20,102);}
  kn.breakKineticAt(23,20,102); kn.breakKineticAt(22,20,102); sb(22,21,102,BT.AIR);
  itm.clearItemDrops(); rs.updateRedstoneNetwork(); kn.updateKineticNetwork();
};
const samples=[];
for(let round=0;round<20;round++){
  setDay();
  buildLine();
  itm.spawnItemDrop(26.5,22.6,102.5,BT.COBBLESTONE,1);
  for(let i=0;i<30;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);rs.updateRedstoneTick(1/60);}
  sg.saveGame();
  S.saveSlot=1; sg.saveGame();
  sg.loadGame(1); rs.initRedstone(); kn.initKinetic();
  S.saveSlot=0; sg.loadGame(0); rs.initRedstone(); kn.initKinetic();
  teardown();
  for(let i=0;i<30;i++){kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);} await sleep(300); // 静置：让分帧区块重建/销毁收敛后再采样
  samples.push(metrics());
}
const warm=samples[1], last=samples[19];
const delta={geo:last.geo-warm.geo, tex:last.tex-warm.tex, scene:last.scene-warm.scene, drops:last.drops-warm.drops, dropped:last.dropped-warm.dropped};
RESULT={first:samples[0], warm, last, delta, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    dl = d.get("delta", {})
    zero = all(isinstance(v, int) and v <= 1 for v in dl.values()) if dl else False
    checks = [
        ("20 轮零增长（几何/纹理/场景/物品，允许 ±预热差 1）", zero, f"delta={dl}"),
    ]
    return lib.report("LEAK 20 轮泄漏审计", res, checks)


ALL = {fn.__name__: fn for fn in [E01_E02, E03_E04_N12a, E05_E06_E08, E07, E09_E10,
                                  N01, N02, N03, N04, N05, N06, N07, N08, N09, N10, N11, N12b, N13, N14, N15, N16, N17,
                                  N18_N23, N19, N20, N21, N22, S01, S02, S03,
                                  P01, P02, P03, P04, A5a, ATK_wheel_remove, LEAK]}

if __name__ == "__main__":
    names = sys.argv[1:] or ORDER
    e2e = lib.E2E()
    e2e.fresh_page()
    results = {}
    for n in names:
        results[n] = ALL[n](e2e)
    e2e.close()
    print("\n==== L1 汇总 ====")
    for n in ORDER:
        if n in results:
            print(f"  {n}: {'PASS' if results[n] else 'FAIL'}")
