# -*- coding: utf-8 -*-
"""G0 修复批次回归验收（org-plan §5.1 清单）。

- R-R1 反相器 / R-R2 时钟 / R-R3 压力板自动门
- R-P1 活塞推拉 / R-P2 粘液拖动 / R-P3 观察者脉冲点灯 / R-P4 粘性往返（降级：粘性拉回验证）
- R-K1 拆水停转 / R-K2 齿轮啮合换向 / R-K3 过载停转 / R-K4 粉碎链 / R-K5 锯切 / R-K6 存档往返

重跑：cd tests/e2e && python3 run_regression.py [case ...]（如 R-R1 R-K3，缺省全跑）
"""

import json
import re
import sys

import lib

CASES_ORDER = []


def case(fn):
    CASES_ORDER.append(fn.__name__)
    return fn


def rpm_of(s):
    if not isinstance(s, str):
        return None
    m = re.search(r"转速\s*(\d+(?:\.\d+)?)\s*RPM", s)
    return float(m.group(1)) if m else (0.0 if ("静止" in s or "停" in s or "过载" in s) else None)


# ================================================================ 红石组
@case
def R_R1(e2e):
    """反相器（严格判别）：激活红石粉充能火把宿主 → 火把稳定熄灭（延迟后窗口 100% 灭）；
    撤销充能 → 稳定复亮（100% 亮）。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(58,36,10,8,20); // x58..67, z36..43
// S(60,40)石头，T 挂其北面(60,39)；粉(61,40)铺地；拉杆(62,40)贴地
sb(60,20,40,BT.STONE);
rs.placeRedstone(60,20,39, cfg.RTORCH_ITEM_ID, N[2]);
rs.placeRedstone(61,20,40, cfg.DUST_ITEM_ID, N[0]);
rs.placeRedstone(62,20,40, cfg.LEVER_ITEM_ID, N[0]);
rs.updateRedstoneNetwork(); await tick(8);
const tlit=()=>cfg.rtorchLit(gb(60,20,39));
const dustLit=()=>cfg.dustLit(gb(61,20,40));
const base={t:tlit(), dust:dustLit()};
// 合闸：粉亮 → S 充能 → 火把经 0.1s 延迟后应稳定熄灭
rs.toggleLeverAt(62,20,40); rs.updateRedstoneNetwork();
await sleep(300); // 火把翻转延迟 0.1s + 网络节拍余量
const dustOn=dustLit();
const offWin=await pollSample(tlit,500,25);
const steadyOff=offWin.length>0 && offWin.every(s=>s.v===0);
// 拉闸：粉灭 → S 解除 → 火把稳定复亮
rs.toggleLeverAt(62,20,40); rs.updateRedstoneNetwork();
await sleep(300);
const dustOff=dustLit();
const onWin=await pollSample(tlit,500,25);
const steadyOn=onWin.length>0 && onWin.every(s=>s.v===1);
RESULT={base, dustOn, steadyOff, offSamples:offWin.length, dustOff, steadyOn, onSamples:onWin.length, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("初始：火把常亮、粉灭", d.get("base", {}).get("t") == 1 and d.get("base", {}).get("dust") == 0, f"base={d.get('base')}"),
        ("拉杆合 → 红石粉亮（充能链有效）", d.get("dustOn") == 1, f"dustLit={d.get('dustOn')}"),
        ("拉杆合 → 火把稳定熄灭（延迟后 500ms 窗口 100% 灭）", d.get("steadyOff"), f"{d.get('offSamples')} 个采样全灭"),
        ("拉杆开 → 红石粉灭", d.get("dustOff") == 0, f"dustLit={d.get('dustOff')}"),
        ("拉杆开 → 火把稳定复亮（100% 亮）", d.get("steadyOn"), f"{d.get('onSamples')} 个采样全亮"),
    ]
    return lib.report("R-R1 反相器", res, checks)


@case
def R_R2(e2e):
    """时钟（双判别，消除真空通过）：闭环振荡 ≥4 次翻转；拆绕回粉开环零翻转常亮。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(58,44,10,6,20); // x58..67, z44..49
// S(60,46)石头；T 挂北面(60,45)；粉(61,45)与(61,46)，后者邻接 S 东侧 → 绕回
sb(60,20,46,BT.STONE);
rs.placeRedstone(60,20,45, cfg.RTORCH_ITEM_ID, N[2]);
rs.placeRedstone(61,20,45, cfg.DUST_ITEM_ID, N[0]);
rs.placeRedstone(61,20,46, cfg.DUST_ITEM_ID, N[0]);
rs.updateRedstoneNetwork();
const tlit=()=>cfg.rtorchLit(gb(60,20,45));
const closed=await pollSample(tlit,2000,25);
let trans=0; for(let i=1;i<closed.length;i++) if(closed[i].v!==closed[i-1].v) trans++;
// 拆绕回粉（61,46）→ 开环：火把复稳常亮
rs.breakRedstoneAt(61,20,46);
rs.updateRedstoneNetwork(); await tick(8);
const open_=await pollSample(tlit,1000,25);
let otrans=0; for(let i=1;i<open_.length;i++) if(open_[i].v!==open_[i-1].v) otrans++;
const alwaysLit=open_.every(s=>s.v===1);
const dustRemainLit=cfg.dustLit(gb(61,20,45));
RESULT={trans, otrans, alwaysLit, dustRemainLit, seq:closed.map(s=>s.v).join(''), log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("闭环：2s 内 ≥4 次翻转（≥2 周期）", d.get("trans", 0) >= 4, f"翻转 {d.get('trans')} 次"),
        ("开环：拆绕回粉后 1s 零翻转、常亮", d.get("otrans") == 0 and d.get("alwaysLit"), f"翻转 {d.get('otrans')} 次, alwaysLit={d.get('alwaysLit')}"),
        ("开环后残余粉保持亮（火把喂粉，正常）", d.get("dustRemainLit") == 1, f"dustRemainLit={d.get('dustRemainLit')}"),
    ]
    return lib.report("R-R2 时钟", res, checks)


@case
def R_R3(e2e):
    """自动门：压力板贴门，玩家站上 → 门开；离开 → 门关。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(64,50,10,8,20); // x64..73, z50..57
// 门(66,52)（上下两格），压力板(66,51)在门北侧贴地
door.tryPlaceDoor(66,20,52,0);
rs.placeRedstone(66,20,51, cfg.PLATE_ITEM_ID, N[0]);
rs.updateRedstoneNetwork(); await tick(4);
const doorOpenNow=()=>cfg.doorOpen(gb(66,20,52));
const plateNow=()=>cfg.platePressed(gb(66,20,51));
const base=doorOpenNow();
// 玩家站上压力板（脚部格=板同格）
S.player.x=66.5; S.player.y=20.0; S.player.z=51.5; S.player.vx=S.player.vy=S.player.vz=0;
await tick(6);
const plateOn=plateNow(), doorOpen1=doorOpenNow();
// 离开
S.player.x=70.5; S.player.y=25.0; S.player.z=55.5;
await tick(8);
const plateOff=plateNow(), doorClosed=doorOpenNow();
RESULT={base, plateOn, doorOpen1, plateOff, doorClosed, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("初始门关", d.get("base") == 0, f"base={d.get('base')}"),
        ("玩家站上 → 压力板压下", d.get("plateOn") == 1, f"platePressed={d.get('plateOn')}"),
        ("压力板压下 → 门开", d.get("doorOpen1") == 1, f"doorOpen={d.get('doorOpen1')}"),
        ("离开 → 压力板抬起", d.get("plateOff") == 0, f"platePressed={d.get('plateOff')}"),
        ("离开 → 门关", d.get("doorClosed") == 0, f"doorOpen={d.get('doorClosed')}"),
    ]
    return lib.report("R-R3 压力板自动门", res, checks)


# ================================================================ 活塞组
def _piston_rig(e2e, body):
    return e2e.run(body)


@case
def R_P1(e2e):
    """基本推拉：上升沿伸出推方块 1 格；下降沿收回；粘性收回拉回方块。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(76,48,12,12,20); // x76..87, z48..59
// 普通活塞：base(78,50) 朝东 N[3]；石头(79,50)；拉杆挂活塞北面(78,49)
ps.placePiston(78,20,50, cfg.PISTON_ITEM_ID, N[3]);
sb(79,20,50,BT.STONE);
rs.placeRedstone(78,20,49, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); await tick(2);
const ext0=cfg.pistonExtended(gb(78,20,50));
rs.toggleLeverAt(78,20,49); rs.updateRedstoneNetwork(); await tick(8);
const ext1=cfg.pistonExtended(gb(78,20,50));
const head1=gb(79,20,50), stone1=gb(80,20,50);
rs.toggleLeverAt(78,20,49); rs.updateRedstoneNetwork(); await tick(8);
const ext2=cfg.pistonExtended(gb(78,20,50));
const head2=gb(79,20,50), stone2=gb(80,20,50);
// 粘性活塞：base(78,54) 朝东；石头(79,54)；拉杆北面(78,53)
ps.placePiston(78,20,54, cfg.STICKY_PISTON_ITEM_ID, N[3]);
sb(79,20,54,BT.STONE);
rs.placeRedstone(78,20,53, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); await tick(2);
rs.toggleLeverAt(78,20,53); rs.updateRedstoneNetwork(); await tick(8);
const sExt1=cfg.pistonExtended(gb(78,20,54)), sStone1=gb(80,20,54);
rs.toggleLeverAt(78,20,53); rs.updateRedstoneNetwork(); await tick(8);
const sExt2=cfg.pistonExtended(gb(78,20,54)), sStoneBack=gb(79,20,54), sStoneOut=gb(80,20,54);
RESULT={ext0, ext1, head1, stone1, ext2, head2, stone2, sExt1, sStone1, sExt2, sStoneBack, sStoneOut, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("初始收回", d.get("ext0") == 0, f"ext={d.get('ext0')}"),
        ("上升沿伸出（头占据前方格）", d.get("ext1") == 1 and d.get("head1") == 131, f"ext={d.get('ext1')}, 头格={d.get('head1')}(131=朝东活塞头)"),
        ("伸出把石头推 1 格", d.get("stone1") == 3, f"(80,20,50)={d.get('stone1')}(3=石头)"),
        ("下降沿收回（头消失），石头留在新位", d.get("ext2") == 0 and d.get("head2") == 0 and d.get("stone2") == 3, f"ext={d.get('ext2')}, 头格={d.get('head2')}, 石头={d.get('stone2')}"),
        ("粘性：伸出同样推石头", d.get("sExt1") == 1 and d.get("sStone1") == 3, f"ext={d.get('sExt1')}, 石头@80={d.get('sStone1')}"),
        ("粘性：收回时把石头拉回 1 格", d.get("sExt2") == 0 and d.get("sStoneBack") == 3 and d.get("sStoneOut") == 0, f"ext={d.get('sExt2')}, 石头@79={d.get('sStoneBack')}, @80={d.get('sStoneOut')}"),
    ]
    return lib.report("R-P1 基本推拉", res, checks)


@case
def R_P2(e2e):
    """粘液拖动（悬空放置：粘液六邻不接触平台/地面，防整片平台被拖进推动集合——原版粘液语义）。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(90,48,8,8,20); // x90..97, z48..55
// 抬高一格悬空：活塞 (92,21,50) 朝东；粘液 (93,21,50)；载荷石 (93,22,50) 只粘粘液顶面
ps.placePiston(92,21,50, cfg.PISTON_ITEM_ID, N[3]);
sb(93,21,50,BT.SLIME);
sb(93,22,50,BT.STONE);
rs.placeRedstone(92,21,49, cfg.LEVER_ITEM_ID, N[2]); // 拉杆挂活塞北面
rs.updateRedstoneNetwork(); await tick(2);
rs.toggleLeverAt(92,21,49); rs.updateRedstoneNetwork(); await tick(10);
const slimeNew=gb(94,21,50), slimeOld=gb(93,21,50);
const stoneNew=gb(94,22,50), stoneOld=gb(93,22,50);
RESULT={slimeNew, slimeOld, stoneNew, stoneOld, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("粘液块被推 1 格（伸出后原格=活塞头）", d.get("slimeNew") == 97 and d.get("slimeOld") == 131, f"新位={d.get('slimeNew')}(97=粘液), 旧位={d.get('slimeOld')}(131=朝东活塞头)"),
        ("粘液上方粘着的载荷一起被拖走", d.get("stoneNew") == 3 and d.get("stoneOld") == 0, f"新位={d.get('stoneNew')}(3=石头), 旧位={d.get('stoneOld')}"),
    ]
    return lib.report("R-P2 粘液拖动", res, checks)


@case
def R_P3(e2e):
    """观察者脉冲：正前方方块变化 → 0.2s 脉冲，邻接红石灯点亮（邻接播种行为）。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(90,56,8,6,20); // x90..97, z56..61
// 观察者(92,58) 朝北；侦测格(92,57)=石头；红石灯(93,58) 在观察者东侧
ps.placePiston(92,20,58, cfg.OBSERVER_ITEM_ID, N[2]);
sb(92,20,57,BT.STONE);
rs.placeRedstone(93,20,58, cfg.LAMP_ITEM_ID, N[0]);
rs.updateRedstoneNetwork(); await tick(14); // 放灯/放石自身触发过一次脉冲，等其彻底结束
const lampLitNow=()=>cfg.lampLit(gb(93,20,58));
const base=lampLitNow();
sb(92,20,57,BT.COBBLESTONE); // ID 变化 → 脉冲
rs.updateRedstoneNetwork();
const win=await pollSample(()=>({lamp:lampLitNow(),obs:cfg.observerPowered(gb(92,20,58))}),700,20);
await tick(8);
const after=lampLitNow();
RESULT={base, everLit:win.some(s=>s.v.lamp===1), obsEver:win.some(s=>s.v.obs===1),
  timeline:win.filter((s,i)=>i%3===0).map(s=>`${s.t}ms lamp=${s.v.lamp} obs=${s.v.obs}`), after, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("初始灯灭", d.get("base") == 0, f"base={d.get('base')}"),
        ("观察者有脉冲", d.get("obsEver"), f"obsEver={d.get('obsEver')}"),
        ("脉冲期间邻接红石灯点亮", d.get("everLit"), f"timeline={'; '.join(d.get('timeline') or [])}"),
        ("脉冲结束灯灭", d.get("after") == 0, f"after={d.get('after')}"),
    ]
    return lib.report("R-P3 观察者脉冲点灯", res, checks)


@case
def R_P4(e2e):
    """飞行器最小闭环（降级方案：粘性拉回往返验证，任务允许并注明；悬空粘液防平台拖拽）。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(64,58,10,6,20); // x64..73, z58..63
// 悬空：粘性活塞 (66,21,60) 朝东；粘液 (67,21,60)；载荷石 (67,22,60)
ps.placePiston(66,21,60, cfg.STICKY_PISTON_ITEM_ID, N[3]);
sb(67,21,60,BT.SLIME);
sb(67,22,60,BT.STONE);
rs.placeRedstone(66,21,59, cfg.LEVER_ITEM_ID, N[2]);
rs.updateRedstoneNetwork(); await tick(2);
rs.toggleLeverAt(66,21,59); rs.updateRedstoneNetwork(); await tick(10);
const outSlime=gb(68,21,60), outStone=gb(68,22,60);
rs.toggleLeverAt(66,21,59); rs.updateRedstoneNetwork(); await tick(10);
const backSlime=gb(67,21,60), backStone=gb(67,22,60);
RESULT={outSlime, outStone, backSlime, backStone, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("伸出：粘液+载荷整体前移 1 格", d.get("outSlime") == 97 and d.get("outStone") == 3, f"粘液@68={d.get('outSlime')}, 载荷@68={d.get('outStone')}"),
        ("收回：粘性把粘液+载荷拉回原位（往返一次）", d.get("backSlime") == 97 and d.get("backStone") == 3, f"粘液@67={d.get('backSlime')}, 载荷@67={d.get('backStone')}"),
    ]
    print("  [NOTE] R-P4 为降级方案：以「粘性活塞+悬空粘液+载荷」的伸缩往返代替观察者自驱飞行器（任务明示允许，需注明）。")
    return lib.report("R-P4 粘性往返（降级）", res, checks)


# ================================================================ 动力组
@case
def R_K1(e2e):
    """拆掉水车顶的水 → 停转。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(20,60,8,6,20); // x20..27, z60..65
kn.placeKinetic(22,20,62, cfg.WATERWHEEL_ITEM_ID, N[3]);
sb(22,21,62,BT.WATER);
kn.updateKineticNetwork(); await tick(4);
const st1=kn.kineticStatusAt(22,20,62);
// 破坏水：水为非固体不可被准星选中，用等价驱动=清格+网络重算（G0-03 已覆盖真实放置覆盖路径）
sb(22,21,62,BT.AIR);
kn.updateKineticNetwork();
const st2=kn.kineticStatusAt(22,20,62);
RESULT={st1, st2, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("供水时转动", (rpm_of(d.get("st1")) or 0) > 0, f"st1={d.get('st1')}"),
        ("拆水后停转", rpm_of(d.get("st2")) == 0, f"st2={d.get('st2')}"),
    ]
    print("  [NOTE] R-K1 拆水用「清格+updateKineticNetwork」等价驱动（水非固体，准星不可选中）；真实放置覆盖路径由 G0-03 验证。")
    return lib.report("R-K1 拆水停转", res, checks)


@case
def R_K2(e2e):
    """齿轮啮合换向：水车→轴→齿轮，垂直轴啮合、转速数值传递、转向反转。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(30,60,10,6,20); // x30..39, z60..65
kn.placeKinetic(32,20,62, cfg.WATERWHEEL_ITEM_ID, N[3]); // X 轴水车
sb(32,21,62,BT.WATER);
kn.placeKinetic(33,20,62, cfg.SHAFT_ITEM_ID, N[3]);      // X 轴传动轴
kn.placeKinetic(34,20,62, cfg.COGWHEEL_ITEM_ID, N[3]);   // 齿轮A（轴X，与传动轴同轴串联）
kn.placeKinetic(34,20,63, cfg.COGWHEEL_ITEM_ID, N[2]);   // 齿轮B（轴Z，与齿轮A垂直啮合=换向）
kn.updateKineticNetwork(); await tick(6);
const stWheel=kn.kineticStatusAt(32,20,62);
const stShaft=kn.kineticStatusAt(33,20,62);
const stCogA=kn.kineticStatusAt(34,20,62);
const stCog=kn.kineticStatusAt(34,20,63);
// 转向断言（渲染状态）：采样两格附近 Object3D 的 rotation.y 增量符号
const duckV={x:0,y:0,z:0,setFromMatrixPosition(m){this.x=m.elements[12];this.y=m.elements[13];this.z=m.elements[14];return this},set(){return this},copy(o){this.x=o.x;this.y=o.y;this.z=o.z;return this}};
function rotsNear(cx,cy,cz){ const out=[]; eng.scene.traverse(o=>{ if(o&&o.isObject3D){ try{ const p=o.getWorldPosition(duckV);
  if(Math.abs(p.x-(cx+0.5))<0.6&&Math.abs(p.y-(cy+0.5))<0.6&&Math.abs(p.z-(cz+0.5))<0.6) out.push(o.rotation.y);}catch(e){} }}); return out; }
const a1=rotsNear(33,20,62), c1=rotsNear(34,20,63);
await sleep(300);
const a2=rotsNear(33,20,62), c2=rotsNear(34,20,63);
const delta=(x,y)=>{let m=0;for(let i=0;i<Math.min(x.length,y.length);i++){const d=y[i]-x[i]; if(Math.abs(d)>Math.abs(m))m=d;}return m;};
const dShaft=delta(a1,a2), dCog=delta(c1,c2);
RESULT={stWheel, stShaft, stCogA, stCog, dShaft, dCog, reversed: dShaft!==0&&dCog!==0&&Math.sign(dShaft)!==Math.sign(dCog), log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("水车 8 RPM", rpm_of(d.get("stWheel")) == 8, f"{d.get('stWheel')}"),
        ("传动轴数值传递（8 RPM）", rpm_of(d.get("stShaft")) == 8, f"{d.get('stShaft')}"),
        ("齿轮转速数值传递（8 RPM，非静止）", rpm_of(d.get("stCog")) == 8, f"{d.get('stCog')}"),
        ("齿轮转向反转（渲染 rotation.y 增量反号）", d.get("reversed"), f"Δshaft={d.get('dShaft'):.4f} rad, Δcog={d.get('dCog'):.4f} rad（300ms）"),
    ]
    return lib.report("R-K2 齿轮啮合换向", res, checks)


@case
def R_K3(e2e):
    """过载停转：负载超过水车应力容量 → 整网停转；减载恢复。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(40,60,14,8,20); // x40..53, z60..67
// wheel(42,62)+水 | 轴(43)(44) | 配对1=(45,62)+(45,63) | 配对2=(46,62)+(46,63) | 锯(47,62)朝东
kn.placeKinetic(42,20,62, cfg.WATERWHEEL_ITEM_ID, N[3]);
sb(42,21,62,BT.WATER);
kn.placeKinetic(43,20,62, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(44,20,62, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(45,20,62, cfg.CRUSHER_ITEM_ID, N[3]);
kn.placeKinetic(45,20,63, cfg.CRUSHER_ITEM_ID, N[3]);
kn.updateKineticNetwork(); await tick(4);
const stCap=kn.kineticStatusAt(45,20,62);       // 两对=64/64 满载运转
kn.placeKinetic(46,20,62, cfg.CRUSHER_ITEM_ID, N[3]);
kn.placeKinetic(46,20,63, cfg.CRUSHER_ITEM_ID, N[3]);
kn.updateKineticNetwork(); await tick(4);
const stOver=kn.kineticStatusAt(45,20,62);      // 4 轮 128 > 64 → 过载停转？
const stOverWheel=kn.kineticStatusAt(42,20,62);
// 减载：拆掉一对 → 恢复
kn.breakKineticAt(46,20,62); kn.breakKineticAt(46,20,63);
kn.updateKineticNetwork(); await tick(4);
const stRec=kn.kineticStatusAt(45,20,62);
RESULT={stCap, stOver, stOverWheel, stRec, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("两对粉碎轮（64/64 满载）仍在转", rpm_of(d.get("stCap")) == 8, f"stCap={d.get('stCap')}"),
        ("负载超容量（128>64）→ 整网停转", rpm_of(d.get("stOver")) == 0 and rpm_of(d.get("stOverWheel")) == 0, f"crusher={d.get('stOver')}, wheel={d.get('stOverWheel')}"),
        ("减载后恢复转动", rpm_of(d.get("stRec")) == 8, f"stRec={d.get('stRec')}"),
    ]
    return lib.report("R-K3 过载停转", res, checks)


@case
def R_K4(e2e):
    """粉碎链抽验：石头→圆石；圆石→沙砾。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(56,60,10,8,20); // x56..65, z60..67
kn.placeKinetic(58,20,62, cfg.WATERWHEEL_ITEM_ID, N[3]);
sb(58,21,62,BT.WATER);
kn.placeKinetic(59,20,62, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(60,20,62, cfg.CRUSHER_ITEM_ID, N[3]);
kn.placeKinetic(60,20,63, cfg.CRUSHER_ITEM_ID, N[3]);
kn.updateKineticNetwork(); await tick(4);
const firstTrue=a=>{const f=a.find(s=>s.v);return f?f.t:null};
const feed=async(block,out,ms)=>{ itm.clearItemDrops(); sb(60,21,62,block);
  const w=await pollSample(()=>dropsOf(out)>0,ms,20); const t=firstTrue(w);
  const ok=dropsOf(out)>0; await tick(4); return {ok,t}; };
const r1=await feed(BT.STONE, BT.COBBLESTONE, 3000);
const r2=await feed(BT.COBBLESTONE, BT.GRAVEL, 3000);
RESULT={r1, r2, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    r1 = (d.get("r1") or {})
    r2 = (d.get("r2") or {})
    checks = [
        ("石头 → 圆石", r1.get("ok") and r1.get("t") is not None, f"{r1.get('t')}ms 出圆石"),
        ("圆石 → 沙砾", r2.get("ok") and r2.get("t") is not None, f"{r2.get('t')}ms 出沙砾"),
    ]
    return lib.report("R-K4 粉碎链", res, checks)


@case
def R_K5(e2e):
    """锯切：机械锯通电锯原木 → 木板×4。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(68,60,12,8,20); // x68..79, z60..67
// wheel(70,62)+水 | 轴(71)(72) | 锯(73,62)朝东 → 目标(74,62)放原木
kn.placeKinetic(70,20,62, cfg.WATERWHEEL_ITEM_ID, N[3]);
sb(70,21,62,BT.WATER);
kn.placeKinetic(71,20,62, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(72,20,62, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(73,20,62, cfg.SAW_ITEM_ID, N[3]);   // 朝东（被锯方块方向）
sb(74,20,62,BT.LOG);
kn.updateKineticNetwork(); await tick(4);
const stSaw=kn.kineticStatusAt(73,20,62);
const firstTrue=a=>{const f=a.find(s=>s.v);return f?f.t:null};
itm.clearItemDrops();
const win=await pollSample(()=>dropsOf(BT.PLANKS)>=4, 6000, 40);
const t=firstTrue(win.map(s=>({v:s.v})));
const planks=dropsOf(BT.PLANKS), logNow=gb(74,20,62);
RESULT={stSaw, t, planks, logNow, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("机械锯接入网络（非静止）", (rpm_of(d.get("stSaw")) or 0) > 0, f"stSaw={d.get('stSaw')}"),
        ("原木被锯切（目标格清空）", d.get("logNow") == 0, f"目标格={d.get('logNow')}"),
        ("产出木板×4", d.get("planks") == 4, f"木板×{d.get('planks')}, {d.get('t')}ms"),
    ]
    return lib.report("R-K5 锯切", res, checks)


@case
def R_K6(e2e):
    """存档往返：动力网运行中保存→读档→重算，转速/应力与存前一致（单次求值内完成）。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
clearSaves();
platform(80,60,12,8,20); // x80..91, z60..67
// wheel(82,62)+水 | 轴(83) | 配对=(84,62)+(84,63)
kn.placeKinetic(82,20,62, cfg.WATERWHEEL_ITEM_ID, N[3]);
sb(82,21,62,BT.WATER);
kn.placeKinetic(83,20,62, cfg.SHAFT_ITEM_ID, N[3]);
kn.placeKinetic(84,20,62, cfg.CRUSHER_ITEM_ID, N[3]);
kn.placeKinetic(84,20,63, cfg.CRUSHER_ITEM_ID, N[3]);
kn.updateKineticNetwork(); await tick(4);
const before=kn.kineticStatusAt(84,20,62);
const beforeWheel=kn.kineticStatusAt(82,20,62);
const saved=sg.saveGame();
const loaded=sg.loadGame();
rs.initRedstone(); kn.initKinetic(); await tick(6);
const after=kn.kineticStatusAt(84,20,62);
const afterWheel=kn.kineticStatusAt(82,20,62);
const blocksKept = cfg.isWaterwheelId(gb(82,20,62)) && cfg.isShaftId(gb(83,20,62))
  && cfg.isCrusherId(gb(84,20,62)) && cfg.isCrusherId(gb(84,20,63)) && gb(82,21,62)===BT.WATER;
RESULT={saved, loaded, before, beforeWheel, after, afterWheel, blocksKept, log:LOG};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("保存与读档成功", d.get("saved") and d.get("loaded"), f"saved={d.get('saved')}, loaded={d.get('loaded')}"),
        ("方块布局完整恢复（含水）", d.get("blocksKept"), f"blocksKept={d.get('blocksKept')}"),
        ("重算后转速/应力文本一致", d.get("before") == d.get("after"), f"before={d.get('before')} → after={d.get('after')}"),
        ("水车侧一致", d.get("beforeWheel") == d.get("afterWheel"), f"{d.get('beforeWheel')} → {d.get('afterWheel')}"),
    ]
    return lib.report("R-K6 存档往返", res, checks)


ALL = {fn.__name__: fn for fn in [R_R1, R_R2, R_R3, R_P1, R_P2, R_P3, R_P4, R_K1, R_K2, R_K3, R_K4, R_K5, R_K6]}

if __name__ == "__main__":
    names = sys.argv[1:] or list(ALL)
    e2e = lib.E2E()
    e2e.fresh_page()
    results = {}
    for n in names:
        results[n] = ALL[n](e2e)
    e2e.close()
    print("\n==== 回归汇总 ====")
    for n, ok in results.items():
        print(f"  {n}: {'PASS' if ok else 'FAIL'}")
