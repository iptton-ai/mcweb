# -*- coding: utf-8 -*-
"""选取形状（outline）验收：不满格道具按局部 AABB 精确命中，射线穿格空白处落到后方方块。

对齐原版 outlineShape 语义（raycast + 黑框都按小形状算，碰撞不变）：
- O1 压力板：瞄板身命中板 / 瞄板上空穿透命中后方石块
- O2 拉杆贴地：瞄杆身命中 / 瞄杆上方空白穿透
- O3 按钮贴墙：瞄按钮命中 / 瞄按钮格其余空白穿透命中更后方石块
- O4 红石火把贴墙：瞄杆命中 / 瞄杆侧空白穿透
- O5 门：瞄门板命中门 / 瞄门格空白穿透命中门后方块
- O6 黑框：压力板 outline 包围盒缩放 ≈(0.8,0.07,0.8)；整格方块 (1,1,1)
- O7 整格方块行为不变（对照组）：瞄格边/格心/掠角都命中
- O8 活塞头：瞄推板命中 / 瞄头格推杆侧下空白穿透命中后方
- O9 放置回归：透过压力板上空瞄准后方石块放置 → 目标格是板格，放置被拒（不覆盖板）

重跑：cd tests/e2e && python3 run_outline.py [case ...]（缺省全跑）
"""

import json
import sys

import lib

CASES_ORDER = []

# 页面侧通用前导片段：把玩家眼摆到 (ex,ey,ez) 直视 (tx,ty,tz)（借 camera+player 同步语义）
LOOK = r"""
const T = await import('three');
function lookAtEye(ex,ey,ez,tx,ty,tz){
  const d = new T.Vector3(tx-ex, ty-ey, tz-ez).normalize();
  aimPlayer(ex, ey-1.62, ez, Math.atan2(-d.x,-d.z), Math.asin(d.y));
}
"""


def case(fn):
    CASES_ORDER.append(fn.__name__)
    return fn


def cell(hit):
    return (hit or {}).get("x"), (hit or {}).get("y"), (hit or {}).get("z")


@case
def O1(e2e):
    """压力板：瞄板身命中；瞄板上空穿透命中后方石块。"""
    res = e2e.run(LOOK + r"""
setDay(); S.gameMode='creative';
platform(58,60,8,6,40); // 地板 y=39，目标层 y=40
sb(60,40,62,cfg.plateId(0));
sb(60,40,63,BT.STONE); // 板后挡
// 眼在 (60.5,40.62,61.5)：水平视线高于板 outline 顶 40.07 → 穿透命中 63；斜下瞄板面 → 命中板
lookAtEye(60.5,40.62,61.5, 60.5,40.62,62.5); const high=it.raycastBlocks();
lookAtEye(60.5,40.62,61.5, 60.5,40.035,62.5); const low=it.raycastBlocks();
RESULT={high:high&&{x:high.x,y:high.y,z:high.z}, low:low&&{x:low.x,y:low.y,z:low.z}};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("瞄板上空 → 穿透命中后方石块 (60,40,63)", cell(d.get("high")) == (60, 40, 63), f"high={d.get('high')}"),
        ("瞄板身 → 命中压力板 (60,40,62)", cell(d.get("low")) == (60, 40, 62), f"low={d.get('low')}"),
    ]
    return lib.report("O1 压力板", res, checks)


@case
def O2(e2e):
    """拉杆贴地：瞄杆身命中；瞄杆上方空白穿透。"""
    res = e2e.run(LOOK + r"""
setDay(); S.gameMode='creative';
platform(58,68,8,6,40);
rs.placeRedstone(60,40,70,cfg.LEVER_ITEM_ID,N[0]);
sb(60,40,71,BT.STONE);
lookAtEye(60.5,40.62,69.3, 60.5,40.3,70.5); const low=it.raycastBlocks();   // 杆中段
lookAtEye(60.5,40.62,69.3, 60.5,40.75,70.5); const high=it.raycastBlocks(); // 高于 outline 顶 0.6
RESULT={low:low&&{x:low.x,y:low.y,z:low.z},high:high&&{x:high.x,y:high.y,z:high.z}};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("瞄杆身 → 命中拉杆 (60,40,70)", cell(d.get("low")) == (60, 40, 70), f"low={d.get('low')}"),
        ("瞄杆上空 → 穿透命中后方石块 (60,40,71)", cell(d.get("high")) == (60, 40, 71), f"high={d.get('high')}"),
    ]
    return lib.report("O2 拉杆", res, checks)


@case
def O3(e2e):
    """按钮贴墙：瞄按钮命中；瞄按钮格其余空白穿透命中更后方石块。"""
    res = e2e.run(LOOK + r"""
setDay(); S.gameMode='creative';
platform(58,76,8,6,40);
sb(60,40,73,BT.STONE); // 支撑墙
sb(60,40,74,BT.STONE); // 更后挡
rs.placeRedstone(60,40,72,cfg.BUTTON_ITEM_ID,N[2]); // 贴北墙：按钮贴 z∈[0.9,1]
lookAtEye(60.5,40.5,71.3, 60.5,40.5,72.95); const onBtn=it.raycastBlocks();
// 偏出按钮横截面 (x 0.375..0.625) 的 +z 视线：穿过按钮格空白，命中按钮的挂靠墙本身
lookAtEye(60.15,40.5,71.3, 60.15,40.5,72.95); const thru=it.raycastBlocks();
RESULT={id72:gb(60,40,72),onBtn:onBtn&&{x:onBtn.x,y:onBtn.y,z:onBtn.z},thru:thru&&{x:thru.x,y:thru.y,z:thru.z}};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("按钮已放置 (60,40,72)", (d.get("id72") or 0) >= cfg_button_base(), f"id72={d.get('id72')}"),
        ("瞄按钮 → 命中按钮格", cell(d.get("onBtn")) == (60, 40, 72), f"onBtn={d.get('onBtn')}"),
        ("瞄按钮旁空白 → 穿透命中挂靠墙 (60,40,73)", cell(d.get("thru")) == (60, 40, 73), f"thru={d.get('thru')}"),
    ]
    return lib.report("O3 按钮贴墙", res, checks)


@case
def O4(e2e):
    """红石火把贴墙：瞄杆命中；瞄杆侧空白穿透。"""
    res = e2e.run(LOOK + r"""
setDay(); S.gameMode='creative';
platform(58,84,8,6,40);
sb(60,40,81,BT.STONE); // 支撑（火把格 z=80 贴其北面）
sb(60,40,82,BT.STONE);
rs.placeRedstone(60,40,80,cfg.RTORCH_ITEM_ID,N[2]);
// 火把杆：z∈[0.36,1]、横截面 x,y∈[0.42,0.58]
lookAtEye(60.5,40.5,79.3, 60.5,40.5,80.7); const onTorch=it.raycastBlocks();
// 偏出杆截面（x 与 y 都出带）的 +z 视线：穿透火把格命中挂靠墙本身
lookAtEye(60.2,40.9,79.3, 60.2,40.9,80.7); const thru=it.raycastBlocks();
RESULT={onTorch:onTorch&&{x:onTorch.x,y:onTorch.y,z:onTorch.z},thru:thru&&{x:thru.x,y:thru.y,z:thru.z}};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("瞄杆身 → 命中火把格 (60,40,80)", cell(d.get("onTorch")) == (60, 40, 80), f"onTorch={d.get('onTorch')}"),
        ("瞄杆侧空白 → 穿透命中挂靠墙 (60,40,81)", cell(d.get("thru")) == (60, 40, 81), f"thru={d.get('thru')}"),
    ]
    return lib.report("O4 红石火把贴墙", res, checks)


@case
def O5(e2e):
    """门：瞄门板命中；瞄门格空白穿透命中门后方块。"""
    res = e2e.run(LOOK + r"""
setDay(); S.gameMode='creative';
platform(58,92,8,6,40);
door.tryPlaceDoor(60,40,94,0); // facing 北：关门贴南边 z∈[0.813,1]（平台 z 92..97 内）
sb(61,40,95,BT.STONE); // 斜穿的接靶：在门格东侧后方
// 直瞄门板：+z 视线命中南边门板
lookAtEye(60.5,40.5,93.3, 60.5,40.5,94.9); const onDoor=it.raycastBlocks();
// 斜穿：门板满格宽，+z 必撞；斜向东北视线在到 z=0.813 前从东侧面出格 → 穿透命中接靶
lookAtEye(60.1,40.5,93.3, 60.9,40.5,94.2); const thru=it.raycastBlocks();
RESULT={doorId:gb(60,40,94),onDoor:onDoor&&{x:onDoor.x,y:onDoor.y,z:onDoor.z},thru:thru&&{x:thru.x,y:thru.y,z:thru.z}};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("门已放置", (d.get("doorId") or 0) > 0, f"doorId={d.get('doorId')}"),
        ("瞄门板 → 命中门 (60,40,94)", cell(d.get("onDoor")) == (60, 40, 94), f"onDoor={d.get('onDoor')}"),
        ("斜穿门格空白 → 穿透命中接靶 (61,40,95)", cell(d.get("thru")) == (61, 40, 95), f"thru={d.get('thru')}"),
    ]
    return lib.report("O5 门", res, checks)


@case
def O6(e2e):
    """黑框缩放：压力板 outline 包围盒；整格方块 (1,1,1)。"""
    res = e2e.run(LOOK + r"""
setDay(); S.gameMode='creative';
platform(58,100,8,6,40);
sb(60,40,102,cfg.plateId(0));
sb(62,40,102,BT.STONE);
const hl=await import(B+'highlight.js');
lookAtEye(60.5,40.62,101.3, 60.5,40.035,102.5); hl.updateHighlight();
const plateScale=[hl.highlightLine.scale.x,hl.highlightLine.scale.y,hl.highlightLine.scale.z];
lookAtEye(62.5,40.62,101.3, 62.5,40.5,102.5); hl.updateHighlight();
const stoneScale=[hl.highlightLine.scale.x,hl.highlightLine.scale.y,hl.highlightLine.scale.z];
const near=(a,b)=>Math.abs(a-b)<0.02;
RESULT={plateScale,stoneScale,
  plateOk:near(plateScale[0],0.8)&&near(plateScale[1],0.07)&&near(plateScale[2],0.8),
  stoneOk:near(stoneScale[0],1)&&near(stoneScale[1],1)&&near(stoneScale[2],1)};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("压力板黑框 ≈ (0.8, 0.07, 0.8)", d.get("plateOk"), f"plateScale={d.get('plateScale')}"),
        ("整格石块黑框 = (1, 1, 1)", d.get("stoneOk"), f"stoneScale={d.get('stoneScale')}"),
    ]
    return lib.report("O6 黑框缩放", res, checks)


@case
def O7(e2e):
    """整格方块对照：瞄格边/格心/掠角都命中（行为不变）。"""
    res = e2e.run(LOOK + r"""
setDay(); S.gameMode='creative';
platform(58,108,8,6,40);
sb(60,40,110,BT.STONE);
const hits=[];
for(const [tx,ty,tz] of [[60.05,40.05,110.05],[60.5,40.5,110.5],[60.95,40.95,110.95],[60.5,40.99,110.5]]){
  lookAtEye(60.5,40.62,109.3, tx,ty,tz);
  const h=it.raycastBlocks();
  hits.push(!!(h&&h.x===60&&h.y===40&&h.z===110));
}
RESULT={hits,all:hits.every(v=>v)};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("整格方块四处瞄准全部命中", d.get("all"), f"hits={d.get('hits')}"),
    ]
    return lib.report("O7 整格对照", res, checks)


@case
def O8(e2e):
    """活塞头：瞄推板命中；瞄头格推杆侧下空白穿透命中后方。"""
    res = e2e.run(LOOK + r"""
setDay(); S.gameMode='creative';
platform(58,116,8,6,40);
sb(60,40,120,cfg.pistonId(false,2,1)); // 底座朝北伸出（平台 z 116..121 内）
sb(60,40,119,cfg.pistonHeadId(2));     // 头格直接写入（只写伸出态底座不生成头）
// 头格局部：推板 z∈[0,0.25]（远端满幅），推杆 x,y∈[0.375,0.625] × z∈[0.25,1]
lookAtEye(60.5,40.5,117.5, 60.5,40.5,119.1); const onHead=it.raycastBlocks(); // 北面直瞄推板
// 从上方垂直下穿 x/z 都在推板带与推杆截面外 → 穿透头格命中地板
lookAtEye(60.15,42.5,119.5, 60.15,38.5,119.5); const thru=it.raycastBlocks();
RESULT={headId:gb(60,40,119),headExpect:cfg.pistonHeadId(2),onHead:onHead&&{x:onHead.x,y:onHead.y,z:onHead.z},thru:thru&&{x:thru.x,y:thru.y,z:thru.z}};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("活塞头已写入头格", d.get("headId") == d.get("headExpect"), f"headId={d.get('headId')} expect={d.get('headExpect')}"),
        ("瞄推板 → 命中活塞头格 (60,40,119)", cell(d.get("onHead")) == (60, 40, 119), f"onHead={d.get('onHead')}"),
        ("垂直穿头格空白 → 命中地板 (60,39,119)", cell(d.get("thru")) == (60, 39, 119), f"thru={d.get('thru')}"),
    ]
    return lib.report("O8 活塞头", res, checks)


@case
def O9(e2e):
    """放置回归：透过压力板上空瞄准后方石块放置 → 目标格是板格，放置被拒（不覆盖板）。"""
    res = e2e.run(LOOK + r"""
setDay(); S.gameMode='creative';
platform(58,124,8,6,40);
sb(60,40,126,cfg.plateId(0));
sb(60,40,127,BT.STONE);
HB[S.player.selectedSlot]=BT.BRICK;
S.player.inventory[BT.BRICK]=64;
// 高瞄：穿透板格上空命中 127 石块北面 → 放置目标 = (60,40,126) 被板占 → 拒绝放置
lookAtEye(60.5,40.62,125.3, 60.5,40.9,127.05);
const hit=it.raycastBlocks();
it.placeBlock();
RESULT={hit:hit&&{x:hit.x,y:hit.y,z:hit.z},plateStill:gb(60,40,126),plateId:cfg.plateId(0)};
return JSON.stringify(RESULT);
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("穿透板格命中后方石块 (60,40,127)", cell(d.get("hit")) == (60, 40, 127), f"hit={d.get('hit')}"),
        ("压力板不被放置覆盖（仍为板 ID）", d.get("plateStill") == d.get("plateId"), f"plateStill={d.get('plateStill')} plateId={d.get('plateId')}"),
    ]
    return lib.report("O9 放置回归", res, checks)


def cfg_button_base():
    return 49  # config.js BUTTON_ITEM_ID/BUTTON_BASE：按钮变体从 49 起


def cfg_piston_head_base():
    return 128


def main():
    only = sys.argv[1:]
    e2e = lib.E2E()
    ok = True
    for name in CASES_ORDER:
        if only and name not in only:
            continue
        fn = globals()[name]
        ok = fn(e2e) and ok
    e2e.close()
    print("\n==== run_outline 总结:", "ALL PASS" if ok else "HAS FAIL", "====")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
