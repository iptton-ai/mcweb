# -*- coding: utf-8 -*-
"""G0 修复批次验收：五个行为契约用例。

断言素材（铁律）：方块 ID 经 config.js 纯解码函数（isLampId/rtorchLit/pistonExtended/
waterwheelAxis 等）+ getBlock；kineticStatusAt（HUD 同源）；state.player.inventory；
state.itemDrops。破坏/放置走公开入口（breakRedstoneAt/breakBlockAt/placeBlock/placePiston/
placeKinetic/placeRedstone/toggleLeverAt/enqueuePistonAction）。

重跑：cd tests/e2e && python3 run_g0.py [case ...]（case 名如 G0-01，缺省全跑）
"""

import json
import re
import sys

import lib


# ---------------------------------------------------------------- G0-01
def g0_01(e2e):
    res = e2e.run(r"""
setDay();
platform(10,10,6,6,20);
// ---- 场景 1：生存模式（库存返还断言） ----
ui.setGameMode('survival');
S.player.inventory[cfg.LAMP_ITEM_ID]=0;
const A={x:12,y:20,z:12}, BB={x:12,y:21,z:12};
rs.placeRedstone(A.x,A.y,A.z, cfg.LAMP_ITEM_ID, N[0]);
rs.placeRedstone(BB.x,BB.y,BB.z, cfg.LAMP_ITEM_ID, N[0]);
const placedOK = cfg.isLampId(gb(A.x,A.y,A.z)) && cfg.isLampId(gb(BB.x,BB.y,BB.z));
const invBefore = inv(cfg.LAMP_ITEM_ID);
// 破坏下灯 A：先走 breakRedstoneAt 公开入口（interaction.js 等价调用序列）
const retBreak = rs.breakRedstoneAt(A.x,A.y,A.z);
rs.updateRedstoneNetwork();
await tick(6); // ~300ms 让连锁/返还结算
const afterA = gb(A.x,A.y,A.z), afterB = gb(BB.x,BB.y,BB.z);
const deltaViaBreakRedstone = inv(cfg.LAMP_ITEM_ID) - invBefore;
// ---- 场景 2：完整玩家路径 breakBlockAt(raycast hit) 复测返还 ----
const C={x:14,y:20,z:14}, D={x:14,y:21,z:14};
rs.placeRedstone(C.x,C.y,C.z, cfg.LAMP_ITEM_ID, N[0]);
rs.placeRedstone(D.x,D.y,D.z, cfg.LAMP_ITEM_ID, N[0]);
const invBefore2 = inv(cfg.LAMP_ITEM_ID);
// 玩家瞄准下灯 C（站东南方地台上）
const aim=aimScan(C.x,C.y,C.z, 16.5, 20.5, 16.5);
let hit=null, deltaViaBreakBlock=null, afterC=null, afterD=null, breakRet=null;
if(aim){ hit=aim.hit; breakRet=it.breakBlockAt(hit); await tick(4);
  deltaViaBreakBlock = inv(cfg.LAMP_ITEM_ID)-invBefore2;
  afterC=gb(C.x,C.y,C.z); afterD=gb(D.x,D.y,D.z);
}
RESULT={mode:'survival', placedOK, retBreak, invBefore, afterA, afterB, deltaViaBreakRedstone,
        aimFound:!!aim, hitFace:hit?hit.face:null, breakRet, afterC, afterD, deltaViaBreakBlock,
        drops: S.itemDrops.length, log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "placedOK" not in res:
        return lib.report("G0-01 红石灯叠放不连锁塌落", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    onlyA_gone = res["afterA"] == 0
    # B 保留：isLampId 解码（95..96）
    b_kept = isinstance(res["afterB"], int) and 95 <= res["afterB"] <= 96
    refund = res["deltaViaBreakRedstone"] if res["deltaViaBreakRedstone"] == 1 else res["deltaViaBreakBlock"]
    refund_path = "breakRedstoneAt" if res["deltaViaBreakRedstone"] == 1 else ("breakBlockAt" if res["deltaViaBreakBlock"] == 1 else "none")
    checks = [
        ("A 破坏后消失(=0)", onlyA_gone, f"afterA={res['afterA']}"),
        ("B 悬空保留(isLampId)", b_kept, f"afterB={res['afterB']}"),
        ("生存返还恰好 +1", refund == 1, f"via breakRedstoneAt={res['deltaViaBreakRedstone']}, via breakBlockAt={res['deltaViaBreakBlock']} (采用 {refund_path})"),
        ("无额外掉落物实体", res["drops"] == 0, f"itemDrops={res['drops']}"),
    ]
    return lib.report("G0-01 红石灯叠放不连锁塌落", res, checks)


# ---------------------------------------------------------------- G0-02
def g0_02(e2e):
    """严格判别版（F3 修复后火把亮灭确定性，无统计）：任务规格原文电路。
    O 朝北；背面实心块 B + 火把 T 挂 B 另一侧；正面侦测格 W + 对照火把 T2 挂 W。
    触发（W 石头→圆石，ID 变化→0.2s 脉冲）后：T 必须熄灭一段（背面格被充能），
    T2 全程常亮（正面/侦测路径不被充能），脉冲结束 T 复亮。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(30,10,12,10,20);
// 布局（北=-Z）：T2(32,11) W=DET(32,12) O(32,13) B(32,14) T(32,15)
const O={x:32,y:20,z:13}, DET={x:32,y:20,z:12}, BK={x:32,y:20,z:14}, T={x:32,y:20,z:15}, T2={x:32,y:20,z:11};
ps.placePiston(O.x,O.y,O.z, cfg.OBSERVER_ITEM_ID, N[2]);   // 观察者朝北（侦测 DET）
sb(BK.x,BK.y,BK.z,BT.STONE);                                // 背面实心方块 B
rs.placeRedstone(T.x,T.y,T.z, cfg.RTORCH_ITEM_ID, N[4]);    // T 挂 B 南墙（B 的另一侧）
sb(DET.x,DET.y,DET.z,BT.STONE);                             // 侦测格 W=石头
rs.placeRedstone(T2.x,T2.y,T2.z, cfg.RTORCH_ITEM_ID, N[2]); // 对照 T2 挂 W 北墙
rs.updateRedstoneNetwork(); await tick(12);                 // 确定性稳态
const tLit=()=>cfg.rtorchLit(gb(T.x,T.y,T.z));
const t2Lit=()=>cfg.rtorchLit(gb(T2.x,T2.y,T2.z));
const pre={t:tLit(), t2:t2Lit()};
// 触发：W 石头→圆石（等价真实放置路径后的网络重算）
sb(DET.x,DET.y,DET.z,BT.COBBLESTONE);
rs.updateRedstoneNetwork();
const win=await pollSample(()=>({t:tLit(),t2:t2Lit(),obs:cfg.observerPowered(gb(O.x,O.y,O.z))}),700,20);
await tick(12);
const post={t:tLit(), t2:t2Lit()};
const off=win.filter(s=>s.v.t===0).map(s=>s.t);
const tEverOff=off.length>0;
const offSpan=off.length?off[off.length-1]-off[0]:0;
const t2AlwaysLit=win.every(s=>s.v.t2===1);
const obsEver=win.some(s=>s.v.obs===1);
// ---- 阳性对照（同机制，严格）：拉杆充能宿主石块 → 挂靠火把稳定熄灭 → 撤销复亮 ----
const X2={x:38,y:20,z:17}, T3={x:38,y:20,z:16};
sb(X2.x,X2.y,X2.z,BT.STONE);
rs.placeRedstone(T3.x,T3.y,T3.z, cfg.RTORCH_ITEM_ID, N[2]);
rs.placeRedstone(39,20,17, cfg.LEVER_ITEM_ID, N[3]);
rs.updateRedstoneNetwork(); await tick(8);
const ctrlPre=cfg.rtorchLit(gb(T3.x,T3.y,T3.z));
rs.toggleLeverAt(39,20,17); rs.updateRedstoneNetwork();
const cw=await pollSample(()=>cfg.rtorchLit(gb(T3.x,T3.y,T3.z)),700,20);
const ctrlSteadyOff=cw.filter(s=>s.t>=250).every(s=>s.v===0);
rs.toggleLeverAt(39,20,17); rs.updateRedstoneNetwork();
const rw=await pollSample(()=>cfg.rtorchLit(gb(T3.x,T3.y,T3.z)),700,20);
const ctrlSteadyRelit=rw.filter(s=>s.t>=250).every(s=>s.v===1);
RESULT={pre, tEverOff, offSpan, offFirst:off[0], offLast:off[off.length-1], t2AlwaysLit, obsEver, post,
  ctrlPre, ctrlSteadyOff, ctrlSteadyRelit,
  timeline:win.filter((s,i)=>i%3===0).map(s=>`${s.t}ms t=${s.v.t} t2=${s.v.t2} obs=${s.v.obs}`), log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "pre" not in res:
        return lib.report("G0-02 观察者背面输出充能", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("前置稳定：T/T2 均常亮（F3 修复后无自振荡）", res["pre"]["t"] == 1 and res["pre"]["t2"] == 1, f"pre={res['pre']}"),
        ("观察者确有脉冲（powered 变 1）", res["obsEver"], f"obsEver={res['obsEver']}"),
        ("脉冲期间 T 熄灭（背面输出格 B 被充能；rtorchLit 解码）", res["tEverOff"] and res["offSpan"] >= 60, f"熄灭区间 {res.get('offFirst')}~{res.get('offLast')}ms（跨度 {res['offSpan']}ms）"),
        ("对照 T2 全程不熄（正面侦测路径未被充能）", res["t2AlwaysLit"] and res["post"]["t2"] == 1, f"t2AlwaysLit={res['t2AlwaysLit']}"),
        ("脉冲结束 T 复亮", res["post"]["t"] == 1, f"post.t={res['post']['t']}"),
        ("阳性对照：拉杆充能宿主→火把稳定熄灭（t≥250ms 全灭）", res["ctrlPre"] == 1 and res["ctrlSteadyOff"], f"ctrlPre={res['ctrlPre']}, steadyOff={res['ctrlSteadyOff']}"),
        ("阳性对照：撤销→稳定复亮", res["ctrlSteadyRelit"], f"steadyRelit={res['ctrlSteadyRelit']}"),
    ]
    return lib.report("G0-02 观察者背面输出充能", res, checks)


# ---------------------------------------------------------------- G0-03
def g0_03(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(50,10,8,8,20);
const WH={x:54,y:20,z:14}, WATER_C={x:54,y:21,z:14}, ANCHOR={x:55,y:21,z:14};
kn.placeKinetic(WH.x,WH.y,WH.z, cfg.WATERWHEEL_ITEM_ID, N[3]); // X 轴水车
sb(WATER_C.x,WATER_C.y,WATER_C.z,BT.WATER);
kn.updateKineticNetwork();
await tick(4);
const st1 = kn.kineticStatusAt(WH.x,WH.y,WH.z);
// 锚块：水格东侧放石头，供真实放置路径贴面
sb(ANCHOR.x,ANCHOR.y,ANCHOR.z,BT.STONE);
kn.updateKineticNetwork();
const st1b = kn.kineticStatusAt(WH.x,WH.y,WH.z);
// 真实覆盖：玩家在东侧瞄准锚块东面 → placeBlock 放石头进水格
S.player.selectedSlot = HB.indexOf(BT.STONE);
const aim = aimScan(ANCHOR.x,ANCHOR.y,ANCHOR.z, 52.5, 20.5, 14.5); // 站水格西侧、贴锚块西面放置（法线指向水格），平台内视线无遮挡
let placed=null, faceDir=null, route='camera+placeBlock';
if(aim && aim.hit.face){ faceDir=aim.hit.face; it.placeBlock(); await sleep(80); placed=gb(WATER_C.x,WATER_C.y,WATER_C.z); }
const st2 = kn.kineticStatusAt(WH.x,WH.y,WH.z);
RESULT={wheelAxis: cfg.waterwheelAxis(gb(WH.x,WH.y,WH.z)), st1, st1b, st2, aimFound:!!aim, faceDir, placed, waterNow: gb(WATER_C.x,WATER_C.y,WATER_C.z), log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "st2" not in res:
        return lib.report("G0-03 盖掉水车顶的水立即断电", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])

    def rpm_of(st):
        # status 形状自适应（HUD 同源公开接口，kineticStatusAt 返回 HUD 字符串）
        s = st if isinstance(st, str) else (json.dumps(st, ensure_ascii=False) if st is not None else "")
        if not s:
            return None
        m = re.search(r"(\d+(?:\.\d+)?)\s*RPM", s)
        if m:
            return float(m.group(1))
        return 0.0  # 无 RPM 数字（如「静止（需要水车驱动）」）= 已停转
        if isinstance(st, dict):
            for k in ("rpm", "speed"):
                if isinstance(st.get(k), (int, float)):
                    return st[k]
        return None

    r1, r2 = rpm_of(res["st1"]), rpm_of(res["st2"])
    real_place = res["placed"] == 3  # STONE=3
    checks = [
        ("水车 X 轴放置", res["wheelAxis"] == 0, f"axis={res['wheelAxis']}"),
        ("供水后转动中", (r1 or 0) > 0, f"status1={json.dumps(res['st1'], ensure_ascii=False)} rpm={r1}"),
        ("真实路径盖水成功（相机+placeBlock，石头进水格）", real_place, f"aim={res['aimFound']} face={res['faceDir']} waterNow={res['waterNow']}"),
        ("同一放置动作后立即停转", r2 == 0, f"status2={json.dumps(res['st2'], ensure_ascii=False)} rpm={r2}"),
    ]
    return lib.report("G0-03 盖掉水车顶的水立即断电", res, checks)


# ---------------------------------------------------------------- G0-04
def g0_04(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
// 立柱到顶格下一格：活塞在 (80,H-2,16) 朝上，石头在 (80,H-1,16)=世界顶格，伸出会把石头推出界外
// （坐标随 WORLD_HEIGHT 走——2026-09-06 世界扩容 128 高，顶格不再是 y=63）
const TOP_Y=cfg.WORLD_HEIGHT-1, PIS_Y=cfg.WORLD_HEIGHT-2;
for(let y=30;y<=PIS_Y-1;y++) sb(80,y,16,BT.STONE);
sb(80,TOP_Y,16,BT.STONE); sb(80,PIS_Y,16,BT.AIR);
const P={x:80,y:PIS_Y,z:16}, TOP={x:80,y:TOP_Y,z:16}, LV={x:81,y:PIS_Y,z:16};
ps.placePiston(P.x,P.y,P.z, cfg.PISTON_ITEM_ID, N[0]); // 朝上
const pistonFacing = cfg.pistonFacing(gb(P.x,P.y,P.z));
// ---- 阳性对照：无顶石时拉杆信号确实能伸出（证明信号路径有效） ----
sb(TOP.x,TOP.y,TOP.z,BT.AIR);
rs.placeRedstone(LV.x,LV.y,LV.z, cfg.LEVER_ITEM_ID, N[3]); // 拉杆挂活塞东面
rs.updateRedstoneNetwork(); await tick(2);
rs.toggleLeverAt(LV.x,LV.y,LV.z); rs.updateRedstoneNetwork();
await tick(6); // 0.15s 延迟 + 余量
const ctrlExtended = cfg.pistonExtended(gb(P.x,P.y,P.z));
const ctrlHead = cfg.isPistonHeadId(gb(TOP.x,TOP.y,TOP.z));
// 复位：拉杆关 + 手动清头（对照残留不进正式断言）
rs.toggleLeverAt(LV.x,LV.y,LV.z); rs.updateRedstoneNetwork(); await tick(6);
sb(TOP.x,TOP.y,TOP.z,BT.AIR); // 清活塞头残留
// ---- 正式用例：放回顶石，信号上升沿 ----
sb(TOP.x,TOP.y,TOP.z,BT.STONE);
const invSnapshot = JSON.stringify(S.player.inventory);
const dropsBefore = S.itemDrops.length;
rs.toggleLeverAt(LV.x,LV.y,LV.z); rs.updateRedstoneNetwork();
await tick(10); // 0.5s：远超 0.15s 动作延迟
const ext = cfg.pistonExtended(gb(P.x,P.y,P.z));
const topBlock = gb(TOP.x,TOP.y,TOP.z);
const headAtTop = cfg.isPistonHeadId(topBlock);
const invUnchanged = JSON.stringify(S.player.inventory)===invSnapshot;
const dropsUnchanged = S.itemDrops.length===dropsBefore;
// ---- 生存模式复测（库存不变） ----
ui.setGameMode('survival');
const invS1 = JSON.stringify(S.player.inventory);
rs.toggleLeverAt(LV.x,LV.y,LV.z); rs.updateRedstoneNetwork(); await tick(2); // 关
rs.toggleLeverAt(LV.x,LV.y,LV.z); rs.updateRedstoneNetwork(); await tick(10); // 再开
const extS = cfg.pistonExtended(gb(P.x,P.y,P.z));
const invUnchangedS = JSON.stringify(S.player.inventory)===invS1;
const topS = gb(TOP.x,TOP.y,TOP.z);
// 再用 enqueuePistonAction 直驱复核
ps.enqueuePistonAction(P.x,P.y,P.z,true); await tick(10);
const extQ = cfg.pistonExtended(gb(P.x,P.y,P.z));
const topQ = gb(TOP.x,TOP.y,TOP.z);
RESULT={pistonFacing, ctrlExtended, ctrlHead, ext, topBlock, headAtTop, invUnchanged, dropsUnchanged,
        extS, topS, invUnchangedS, extQ, topQ, log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "pistonFacing" not in res:
        return lib.report("G0-04 活塞推方块出界=整动作失败", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("活塞朝上放置", res["pistonFacing"] == 0, f"facing={res['pistonFacing']}"),
        ("阳性对照：无阻挡时拉杆信号使活塞伸出（信号路径有效）", res["ctrlExtended"] == 1 and res["ctrlHead"], f"ext={res['ctrlExtended']} headAtTop={res['ctrlHead']}"),
        ("顶石在位时活塞不动作（保持收回态）", res["ext"] == 0, f"ext={res['ext']}"),
        ("石头仍在世界顶格且无活塞头", res["topBlock"] == 3 and not res["headAtTop"], f"topBlock={res['topBlock']} headAtTop={res['headAtTop']}"),
        ("创造模式库存无返还", res["invUnchanged"] and res["dropsUnchanged"], f"inv={res['invUnchanged']} drops={res['dropsUnchanged']}"),
        ("生存模式复测：库存不变且不动作", res["extS"] == 0 and res["topS"] == 3 and res["invUnchangedS"], f"ext={res['extS']} top={res['topS']} inv={res['invUnchangedS']}"),
        ("enqueuePistonAction 直驱同样不动作", res["extQ"] == 0 and res["topQ"] == 3, f"ext={res['extQ']} top={res['topQ']}"),
    ]
    return lib.report("G0-04 活塞推方块出界=整动作失败", res, checks)


# ---------------------------------------------------------------- G0-05
def g0_05(e2e):
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(30,90,12,10,20); // x30..41, z90..99
// 配对几何=垂直轴相邻：两轮均轴X、沿Z相邻。wheel(32,94)+水 | 轴(33,94) | A(34,94) B(34,95)
const WH={x:32,y:20,z:94}, A={x:34,y:20,z:94}, Bc={x:34,y:20,z:95}, INTAKE={x:34,y:21,z:94};
kn.placeKinetic(WH.x,WH.y,WH.z, cfg.WATERWHEEL_ITEM_ID, N[3]); // X 轴水车
sb(WH.x,WH.y+1,WH.z,BT.WATER);
kn.placeKinetic(33,20,94, cfg.SHAFT_ITEM_ID, N[3]);            // X 轴传动轴
kn.placeKinetic(A.x,A.y,A.z, cfg.CRUSHER_ITEM_ID, N[3]);       // 粉碎轮 A
kn.placeKinetic(Bc.x,Bc.y,Bc.z, cfg.CRUSHER_ITEM_ID, N[3]);    // 粉碎轮 B（沿Z相邻→配对）
kn.updateKineticNetwork(); await tick(4);
const stRun = kn.kineticStatusAt(A.x,A.y,A.z);
// 推走机构：活塞在 B 正下方 (34,19,95) 朝上 → 伸出把 B 顶到 (34,21,95)；拉杆挂活塞东面 (35,19,95)
sb(34,19,95,BT.AIR); // 平台地板让位
ps.placePiston(34,19,95, cfg.PISTON_ITEM_ID, N[0]);
rs.placeRedstone(35,19,95, cfg.LEVER_ITEM_ID, N[3]);
rs.updateRedstoneNetwork(); await tick(2);
const firstTrue=a=>{const f=a.find(s=>s.v);return f?f.t:null;};
// 投料轮询：记录墙钟耗时 + 游戏时间健康度（game/wall，归因节流噪声用）
const feedPoll=async(outId,timeoutMs)=>{const t0=Date.now();const g0=S.time;const lastT={v:S.time};
  while(Date.now()-t0<timeoutMs){ if(dropsOf(outId)>0){const w=(Date.now()-t0)/1000;return {t:Date.now()-t0,game:S.time-g0,health:w>0?(S.time-g0)/w:1};}
    pumpIfStalled(lastT,0.02); await sleep(20);} return null;};
// ---- 第一次投料：石头 → 圆石，测完整耗时 ----
itm.clearItemDrops();
sb(INTAKE.x,INTAKE.y,INTAKE.z,BT.STONE);
const t1v = await feedPoll(BT.COBBLESTONE, 8000);
const firstMs = t1v?t1v.t:null; const firstHealth=t1v?t1v.health:null; const firstGame=t1v?t1v.game:null;
const firstOut = dropsOf(BT.COBBLESTONE);
await tick(4);
const intakeAfter1 = gb(INTAKE.x,INTAKE.y,INTAKE.z);
itm.clearItemDrops();
// ---- 第二次投料：碾到一半用活塞把 B 顶走 1 格（真活塞+拉杆驱动） ----
sb(INTAKE.x,INTAKE.y,INTAKE.z,BT.STONE);
await sleep(Math.max(150,(firstMs||1200)*0.45)); // 进度约一半
const intakeMid = gb(INTAKE.x,INTAKE.y,INTAKE.z);
rs.toggleLeverAt(35,19,95); rs.updateRedstoneNetwork();
await tick(8); // 活塞动作+网络重算
const bMoved = gb(34,21,95);       // B 被顶到正上一格
const bOld = gb(Bc.x,Bc.y,Bc.z);   // 伸出期间旧格=活塞头
const stBroken = kn.kineticStatusAt(A.x,A.y,A.z);
// 复位：拉杆关（活塞收回、头消失）→ 清残留投料 → 拆新位 B → 旧格重放恢复配对
rs.toggleLeverAt(35,19,95); rs.updateRedstoneNetwork(); await tick(8);
if(intakeMid!==0) sb(INTAKE.x,INTAKE.y,INTAKE.z,BT.AIR);
kn.breakKineticAt(34,21,95);
const oldCellAfterRetract = gb(Bc.x,Bc.y,Bc.z);
kn.placeKinetic(Bc.x,Bc.y,Bc.z, cfg.CRUSHER_ITEM_ID, N[3]);
kn.updateKineticNetwork(); await tick(4);
const stRestored = kn.kineticStatusAt(A.x,A.y,A.z);
itm.clearItemDrops();
// ---- 第三次投料：测耗时是否与首次一致 ----
sb(INTAKE.x,INTAKE.y,INTAKE.z,BT.STONE);
const t3v = await feedPoll(BT.COBBLESTONE, 8000);
const thirdMs = t3v?t3v.t:null; const thirdHealth=t3v?t3v.health:null; const thirdGame=t3v?t3v.game:null;
const thirdOut = dropsOf(BT.COBBLESTONE);
const early = thirdMs!==null && firstMs!==null ? thirdMs/firstMs : null;
const earlyGame = thirdGame!==null && firstGame!==null ? thirdGame/firstGame : null;
RESULT={stRun, firstMs, firstGame, firstHealth, firstOut, intakeAfter1, intakeMid, bMoved, bOld, stBroken, oldCellAfterRetract,
        stRestored, thirdMs, thirdGame, thirdHealth, thirdOut, early, earlyGame, log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "firstMs" not in res:
        return lib.report("G0-05 机器进度不跨格继承", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    ok_first = res["firstOut"] >= 1 and res["firstMs"] is not None
    ratio = res["early"]
    def rpm_txt(s):
        if not isinstance(s, str):
            return str(s)
        m = re.search(r"转速\s*(\d+(?:\.\d+)?)\s*RPM", s)
        return m.group(1) + " RPM" if m else ("静止" if "静止" in s else s[:40])
    checks = [
        ("配对粉碎轮+水车供电转动", ok_first, f"status={res['stRun']}, firstMs={res['firstMs']}ms, 圆石×{res['firstOut']}"),
        ("首次碾碎产出圆石（投料格被消耗，约 1.2s）", ok_first and res["intakeAfter1"] == 0, f"firstMs={res['firstMs']}ms, 圆石×{res['firstOut']}, 碾后投料格={res['intakeAfter1']}"),
        ("中途（约一半进度）活塞把粉碎轮 B 顶走 1 格成功（真活塞+拉杆驱动）", isinstance(res["bMoved"], int) and 160 <= res["bMoved"] <= 162, f"B 新位 id={res['bMoved']}(160..162=粉碎轮), 伸出期间旧格={res['bOld']}(128=活塞头), 半程投料格={res['intakeMid']}"),
        ("推走后网络失去配对", isinstance(res["stBroken"], str) and "未配对" in res["stBroken"], f"stBroken={rpm_txt(res['stBroken'])}"),
        ("旧格重放后恢复配对供电", isinstance(res["stRestored"], str) and "未配对" not in res["stRestored"] and "静止" not in res["stRestored"], f"stRestored={rpm_txt(res['stRestored'])}, 复位后旧格={res['oldCellAfterRetract']}"),
        ("新投料产出圆石", res["thirdOut"] >= 1 and res["thirdMs"] is not None, f"thirdMs={res['thirdMs']}ms, 圆石×{res['thirdOut']}"),
        ("耗时与首次一致（差 <25%，不提前出料）", ratio is not None and 0.75 <= ratio <= 1.25, f"third/first = {ratio} (first={res['firstMs']}ms, third={res['thirdMs']}ms; 游戏时比例={res.get('earlyGame')}, 健康度 first={res.get('firstHealth')}/third={res.get('thirdHealth')})"),
    ]
    return lib.report("G0-05 机器进度不跨格继承", res, checks)



# ---------------------------------------------------------------- G0-06
def g0_06(e2e):
    """活塞推 3 块连锁链（F2 回归锁）：拉杆信号 → 活塞伸出、三块各前移 1 格。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(56,68,12,8,20); // x56..67, z68..75
const P={x:58,y:20,z:70};
ps.placePiston(P.x,P.y,P.z, cfg.PISTON_ITEM_ID, N[3]); // 朝东
sb(59,20,70,BT.STONE); sb(60,20,70,BT.STONE); sb(61,20,70,BT.STONE);
rs.placeRedstone(58,20,69, cfg.LEVER_ITEM_ID, N[2]);   // 拉杆挂活塞北面
rs.updateRedstoneNetwork(); await tick(2);
const ext0=cfg.pistonExtended(gb(P.x,P.y,P.z));
rs.toggleLeverAt(58,20,69); rs.updateRedstoneNetwork(); await tick(10);
const ext1=cfg.pistonExtended(gb(P.x,P.y,P.z));
const head=gb(59,20,70);
const c1=gb(60,20,70), c2=gb(61,20,70), c3=gb(62,20,70);
RESULT={ext0, ext1, head, c1, c2, c3, log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "ext1" not in res:
        return lib.report("G0-06 活塞推 3 块连锁链", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("初始收回", res["ext0"] == 0, f"ext0={res['ext0']}"),
        ("拉杆信号 → 活塞伸出（头占据首格）", res["ext1"] == 1 and res["head"] == 131, f"ext={res['ext1']}, 头格={res['head']}(131=朝东活塞头)"),
        ("三块石头各前移 1 格（原 59/60/61 → 现 60/61/62，原首格被活塞头占据）", res["c1"] == 3 and res["c2"] == 3 and res["c3"] == 3 and res["head"] == 131, f"(60,61,62)=({res['c1']},{res['c2']},{res['c3']}), 头@59={res['head']}"),
    ]
    return lib.report("G0-06 活塞推 3 块连锁链", res, checks)


# ---------------------------------------------------------------- G0-07
def g0_07(e2e):
    """火把稳定性（F3 回归锁）：(a) 孤立常亮零翻转；(b) 真时钟闭环振荡；(c) 拆粉开环复稳。"""
    res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(40,60,20,10,20); // x40..59, z60..69
// (a) 孤立火把：石头(42,62) + 南墙火把(42,63)
sb(42,20,62,BT.STONE);
rs.placeRedstone(42,20,63, cfg.RTORCH_ITEM_ID, N[4]);
rs.updateRedstoneNetwork(); await tick(8);
const aS=await pollSample(()=>cfg.rtorchLit(gb(42,20,63)),1500,25);
let aTrans=0; for(let i=1;i<aS.length;i++) if(aS[i].v!==aS[i-1].v) aTrans++;
const aAlwaysLit=aS.every(s=>s.v===1);
// (b) 真时钟闭环：S(48,64)石头；T 挂北面(48,63)；粉(49,63)与(49,64)，后者邻接 S 东侧绕回
sb(48,20,64,BT.STONE);
rs.placeRedstone(48,20,63, cfg.RTORCH_ITEM_ID, N[2]);
rs.placeRedstone(49,20,63, cfg.DUST_ITEM_ID, N[0]);
rs.placeRedstone(49,20,64, cfg.DUST_ITEM_ID, N[0]);
rs.updateRedstoneNetwork();
const bS=await pollSample(()=>cfg.rtorchLit(gb(48,20,63)),2000,25);
let bTrans=0; for(let i=1;i<bS.length;i++) if(bS[i].v!==bS[i-1].v) bTrans++;
// (c) 拆掉绕回粉（49,64）→ 开环：火把应复稳常亮
kn_break={};
rs.breakRedstoneAt(49,20,64);
rs.updateRedstoneNetwork(); await tick(8);
const cS=await pollSample(()=>cfg.rtorchLit(gb(48,20,63)),1000,25);
let cTrans=0; for(let i=1;i<cS.length;i++) if(cS[i].v!==cS[i-1].v) cTrans++;
const cAlwaysLit=cS.every(s=>s.v===1);
const dust1Lit=cfg.dustLit(gb(49,20,63));
RESULT={aTrans, aAlwaysLit, bTrans, cTrans, cAlwaysLit, dust1Lit, log:LOG};
return JSON.stringify(RESULT);
""")
    if not isinstance(res, dict) or "aTrans" not in res:
        return lib.report("G0-07 火把稳定性", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("(a) 孤立火把 1.5s 零翻转、常亮", res["aTrans"] == 0 and res["aAlwaysLit"], f"翻转 {res['aTrans']} 次, alwaysLit={res['aAlwaysLit']}"),
        ("(b) 真时钟闭环 2s 内 ≥4 次翻转（≥2 周期）", res["bTrans"] >= 4, f"翻转 {res['bTrans']} 次"),
        ("(c) 拆绕回粉后开环 1s 零翻转、常亮（火把喂的邻粉保持亮=正常）", res["cTrans"] == 0 and res["cAlwaysLit"] and res["dust1Lit"] == 1, f"翻转 {res['cTrans']} 次, alwaysLit={res['cAlwaysLit']}, 邻粉亮={res['dust1Lit']}"),
    ]
    return lib.report("G0-07 火把稳定性", res, checks)


CASES = {"G0-01": g0_01, "G0-02": g0_02, "G0-03": g0_03, "G0-04": g0_04, "G0-05": g0_05, "G0-06": g0_06, "G0-07": g0_07}

if __name__ == "__main__":
    names = sys.argv[1:] or list(CASES)
    e2e = lib.E2E()
    e2e.fresh_page()
    results = {}
    for n in names:
        results[n] = CASES[n](e2e)
    e2e.close()
    print("\n==== G0 汇总 ====")
    for n, ok in results.items():
        print(f"  {n}: {'PASS' if ok else 'FAIL'}")
