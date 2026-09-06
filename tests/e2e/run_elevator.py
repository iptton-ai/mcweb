# -*- coding: utf-8 -*-
"""电梯 T1 验收（粘液块弹跳 + 活塞载人跟随 + 物品防埋，2026-09-06，蓝图 docs/elevator-plan.md §3）。

- E1 粘液弹跳动能：10 格落上粘液，反弹峰值 ≥4 格（KEEP=0.8 理论 6.4 格，宽容断言）
- E2 粘液免摔伤（对照）：生存 6 格落粘血脂量不变；同高落石头扣血（floor(6-3)=3）
- E3 低速站定：微落（触底落速 <SLIME_BOUNCE_MIN）上粘液不弹，onGround=true、y 稳定
- E4 顶升跟随：朝上活塞顶方块 ×3 轮（每轮拆旧底座在新方块正下方重摆），玩家 y 累计 +3、
  脚部贴合方块顶、头顶格非实心（未被埋）
- E5 边缘站立跟随：玩家 x 偏方块中心 0.7（中心列已离开方块格、身体仍压方块 0.1），
  顶升照常跟随不埋——旧「中心列格匹配」实现在此场景漏判被埋，AABB 升级的靶点用例
- E6 收回跟随：粘性活塞平台往复 2 轮，收回时平台与玩家同步降 1 格，不悬空坠落
- E7 物品防埋：物品在方块顶被活塞顶升跟随上移；物品中心格被直接填实心 → 兜底上浮到格顶
- E8 回归：run_regression.py（红石/活塞/动力 13 用例）+ run_g0.py（有状态方块修复锁 7 用例）不回归

注：WORLD_HEIGHT=64，测试区地板固定 y=38（顶面 39），上方 39..63 清空防天然地形干扰。
重跑：cd tests/e2e && CDP_PORT=19401 python3 run_elevator.py [case ...]（缺省全跑；需 server.py +
独立浏览器，剥代理环境变量）。
"""

import os
import subprocess
import sys

import lib

CASES_ORDER = []


def case(fn):
    CASES_ORDER.append(fn.__name__)
    return fn


# 页面侧公共段：可控环境搭建 + 手动物理/活塞泵（固定步长可复现；rAF 并行泵不影响断言——
# 两边按同套碰撞/落地公式收敛到同一落定值，carryRiders 为同步瞬移与帧时序无关）
ELEV_HELPERS = r"""
S.gameMode='creative'; S.player.dead=false; S.player.flying=false;
S.player.hunger=16;                          // 防 rAF 主循环回血/饿伤判定污染血量断言（16：<17 不回血、>0 不饿伤）
um.setState('playing');
// 大空腔 + 石板地板：测试区 (58..64, 地板 y=38, 58..64)，上方清到 y=63（世界高 64）
function box(x0,y0,z0,x1,y1,z1,t){for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)sb(x,y,z,t);}
box(58,39,58,64,63,64,BT.AIR); box(58,38,58,64,38,64,BT.STONE);
// 玩家物理泵：固定步长逐帧驱动（lib 的 pump() 只泵机器不泵玩家，玩家物理在此自泵）
function phys(steps,dt=0.05){for(let i=0;i<steps;i++)pp.updatePlayerPhysics(dt);}
// 放置玩家（脚部中心点坐标）并清速度/摔落/死亡记录
function placePlayer(x,y,z){const p=S.player;p.x=x;p.y=y;p.z=z;p.vx=p.vy=p.vz=0;p.flying=false;p.onGround=false;p.fallStartY=null;p.invulnTimer=0;p.health=20;p.dead=false;}
// 活塞脉冲：入队 + 消费（PISTON_DELAY=0.15s，一次 0.2s tick 必执行）
function pulse(x,y,z,extend){ps.enqueuePistonAction(x,y,z,extend);ps.updatePistonTick(0.2);}
// 朝上活塞（facing=0）+ 正上方方块
function setUpPiston(sticky,py){sb(60,py,60,cfg.pistonId(sticky,0,0));sb(60,py+1,60,BT.STONE);return {py,by:py+1};}
// 头顶格是否非实心（未埋判据：身高上沿所在格）
function headCellOf(){const p=S.player;return gb(Math.floor(p.x),Math.floor(p.y+cfg.PLAYER_HEIGHT-0.01),Math.floor(p.z));}
"""


@case
def E1(e2e):
    """粘液弹跳动能：10 格落上粘液反弹，峰值 ≥4 格。"""
    res = e2e.js_str(ELEV_HELPERS + r"""
sb(60,38,60,BT.SLIME);                       // 地板中心格换粘液（顶面 y=39）
placePlayer(60.5,49,60.5);                   // 脚部 y=49：10 格落高
let minY=99, bouncePeak=39, touched=false;
for(let i=0;i<160;i++){
  pp.updatePlayerPhysics(0.05);
  minY=Math.min(minY,S.player.y);
  if(S.player.y<=39.01) touched=true;        // 首次触底后开始记录反弹峰（起点高于反弹峰，不能全程取 max）
  if(touched) bouncePeak=Math.max(bouncePeak,S.player.y);
}
return {minY:+minY.toFixed(2), bouncePeak:+bouncePeak.toFixed(2),
        peak:+(bouncePeak-39).toFixed(2), rest:+S.player.y.toFixed(2)};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("确已触底(到方块顶带)", 38.5 < (d.get("minY") or 0) <= 39.01, f"minY={d.get('minY')}"),
        ("反弹峰值≥4格(理论6.4)", (d.get("peak") or 0) >= 4, f"peak={d.get('peak')}"),
        ("衰减后静定在粘液顶", abs((d.get("rest") or 0) - 39.0) < 0.1, f"rest={d.get('rest')}"),
    ]
    return lib.report("E1 粘液弹跳动能", res, checks)


@case
def E2(e2e):
    """粘液免摔伤（生存）+ 石头落地扣血对照。"""
    res = e2e.js_str(ELEV_HELPERS + r"""
S.gameMode='survival';
sb(60,38,60,BT.SLIME);                       // 粘液组：60 列
placePlayer(60.5,45,60.5);                   // 6 格落高
for(let i=0;i<130;i++)pp.updatePlayerPhysics(0.05);   // 弹跳衰减到静止（约 4.4s）
const hpSlime=S.player.health, restY=S.player.y;
// 对照组：石头（61 列，地板原本就是石头，顶面同高 y=39）
placePlayer(61.5,45,60.5);
for(let i=0;i<40;i++)pp.updatePlayerPhysics(0.05);
const hpStone=S.player.health;
S.gameMode='creative';
return {hpSlime, hpStone, restY:+restY.toFixed(2)};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("落粘血脂量不变", d.get("hpSlime") == 20, f"hpSlime={d.get('hpSlime')}"),
        ("同高落石头扣血(对照)", d.get("hpStone") == 18,
         f"hpStone={d.get('hpStone')}（落差≈5.999 → floor(5.999-3)=2，期望 20-2）"),
        ("粘液上静定不悬空", abs((d.get("restY") or 0) - 39.0) < 0.1, f"restY={d.get('restY')}"),
    ]
    return lib.report("E2 粘液免摔伤(对照)", res, checks)


@case
def E3(e2e):
    """低速站定：0.1 格微落上粘液不弹。"""
    res = e2e.js_str(ELEV_HELPERS + r"""
sb(60,38,60,BT.SLIME);
placePlayer(60.5,39.1,60.5);                 // 0.1 格微落：触底落速 √(2·28·0.1)≈2.37 < 3
for(let i=0;i<6;i++)pp.updatePlayerPhysics(0.05);
const y1=+S.player.y.toFixed(3), ground1=S.player.onGround;
for(let i=0;i<10;i++)pp.updatePlayerPhysics(0.05);   // 续泵确认无微弹
return {y1, ground1, y2:+S.player.y.toFixed(3), ground2:S.player.onGround};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("微落站定不弹(onGround)", d.get("ground1") is True, f"ground1={d.get('ground1')}"),
        ("y 稳定在方块顶", abs((d.get("y1") or 0) - 39.001) < 0.01, f"y1={d.get('y1')}"),
        ("续泵仍稳定无抖动", d.get("ground2") is True and abs((d.get("y2") or 0) - 39.001) < 0.01,
         f"y2={d.get('y2')} ground2={d.get('ground2')}"),
    ]
    return lib.report("E3 低速站定", res, checks)


@case
def E4(e2e):
    """顶升跟随：3 轮活塞顶方块，玩家累计 +3 格、贴合、不埋。"""
    res = e2e.js_str(ELEV_HELPERS + r"""
const s=setUpPiston(false,39);               // 活塞 y=39（贴地板 38），方块 y=40，玩家站 y=41
placePlayer(60.5,41,60.5);
phys(2); const y0=+S.player.y.toFixed(3);
const tops=[];
for(let round=0;round<3;round++){
  pulse(60,s.py+round,60,true);             // 伸出：方块+玩家各 +1
  tops.push(+S.player.y.toFixed(3));
  if(round<2){                              // 拆旧底座（连头），在新方块正下方重摆收回态活塞（前方=方块）
    ps.breakPistonGroupAt(60,s.py+round,60);
    sb(60,s.py+1+round,60,cfg.pistonId(false,0,0));
  }
}
phys(3);
const blockY=s.by+3;                        // 终态方块 y=43，玩家应站其顶 44
return {y0, tops, yEnd:+S.player.y.toFixed(3), blockY,
        blockAt: gb(60,blockY,60)===BT.STONE, onGround:S.player.onGround,
        headCell: headCellOf(), fit:+(S.player.y-(blockY+1)).toFixed(3)};
""")
    d = res if isinstance(res, dict) else {}
    tops = d.get("tops") or []
    y0, yEnd = d.get("y0") or 0, d.get("yEnd") or 0
    checks = [
        ("每轮恰好+1格", len(tops) == 3 and all(abs(tops[i] - (y0 + i + 1)) < 0.02 for i in range(3)),
         f"tops={tops} y0={y0}"),
        ("累计上升3格", abs(yEnd - (y0 + 3)) < 0.05, f"yEnd={yEnd} 期望≈{y0 + 3}"),
        ("终态方块到位(y=43)", d.get("blockAt") is True, f"gb(60,43,60)===STONE={d.get('blockAt')}"),
        ("脚部贴合方块顶", abs(d.get("fit") or 9) < 0.05, f"fit={d.get('fit')}（y-方块顶）"),
        ("头顶格非实心(未埋)", d.get("headCell") == 0, f"头顶格={d.get('headCell')}（0=AIR）"),
        ("静定 onGround", d.get("onGround") is True, f"onGround={d.get('onGround')}"),
    ]
    return lib.report("E4 顶升跟随", res, checks)


@case
def E5(e2e):
    """边缘站立跟随：x 偏方块中心 0.7（中心列离开方块格、身体仍压 0.1），顶升照常跟随不埋。"""
    res = e2e.js_str(ELEV_HELPERS + r"""
setUpPiston(false,39);                       // 方块在 60 列（x∈[60,61]），顶面 y=41
placePlayer(61.2,41,60.5);                   // 偏 0.7：中心列=61 不在方块格，AABB [60.9,61.5] 仍压方块 0.1
phys(2); const y0=+S.player.y.toFixed(3);
pulse(60,39,60,true);
phys(3);
return {y0, yEnd:+S.player.y.toFixed(3), dy:+(S.player.y-y0).toFixed(3),
        blockAt: gb(60,41,60)===BT.STONE, headCell: headCellOf(), onGround:S.player.onGround};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("顶升前站定在方块顶", abs((d.get("y0") or 0) - 41.001) < 0.02, f"y0={d.get('y0')}"),
        ("边缘站立仍跟随+1", abs((d.get("dy") or 0) - 1.0) < 0.05, f"dy={d.get('dy')}"),
        ("方块顶升到位(41)", d.get("blockAt") is True, f"gb(60,41,60)===STONE={d.get('blockAt')}"),
        ("头顶格非实心(未埋)", d.get("headCell") == 0, f"头顶格={d.get('headCell')}"),
        ("静定 onGround", d.get("onGround") is True, f"onGround={d.get('onGround')}"),
    ]
    return lib.report("E5 边缘站立跟随", res, checks)


@case
def E6(e2e):
    """收回跟随：粘性活塞平台往复 2 轮，玩家与平台同步降、不悬空。"""
    res = e2e.js_str(ELEV_HELPERS + r"""
setUpPiston(true,39);                        // 粘性活塞 y=39，平台方块 y=40，玩家站 y=41
placePlayer(60.5,41,60.5);
phys(2); const y0=+S.player.y.toFixed(3);
const steps=[];
for(let round=0;round<2;round++){
  pulse(60,39,60,true);  phys(2);            // 伸出：平台 40→41，玩家 →42
  const up=+S.player.y.toFixed(3), upBlock=gb(60,41,60)===BT.STONE;
  pulse(60,39,60,false); phys(2);            // 收回：粘性拉平台回 40，玩家跟随 →41
  const down=+S.player.y.toFixed(3), downBlock=gb(60,40,60)===BT.STONE;
  steps.push({up,upBlock,down,downBlock});
}
phys(8); const settle=+S.player.y.toFixed(3);   // 续泵：确认没有悬空坠落
return {y0, steps, settle, onGround:S.player.onGround};
""")
    d = res if isinstance(res, dict) else {}
    steps = d.get("steps") or []
    ok_rounds = len(steps) == 2 and all(
        abs(st.get("up", 0) - 42.001) < 0.05 and st.get("upBlock") is True
        and abs(st.get("down", 0) - 41.001) < 0.05 and st.get("downBlock") is True
        for st in steps
    )
    checks = [
        ("每轮伸出+1/收回-1贴合", ok_rounds, f"steps={steps}"),
        ("收回后方块回到原位(40)", all(st.get("downBlock") is True for st in steps),
         f"downBlock={[st.get('downBlock') for st in steps]}"),
        ("最终静定不悬空坠落", abs((d.get("settle") or 0) - 41.001) < 0.05,
         f"settle={d.get('settle')}"),
        ("静定 onGround", d.get("onGround") is True, f"onGround={d.get('onGround')}"),
    ]
    return lib.report("E6 收回跟随", res, checks)


@case
def E7(e2e):
    """物品防埋：顶升跟随上移 + 中心格填实兜底上浮。"""
    res = e2e.js_str(ELEV_HELPERS + r"""
itm.clearItemDrops();
placePlayer(62.5,39.001,62.5);               // 玩家挪开，防 1.5 格入包圈吸走物品
setUpPiston(false,39);                       // 方块 y=40
itm.spawnItemDrop(60.5,41.5,60.5,BT.STONE,1,{pickupDelay:999});   // 冷却内不拾取不磁吸
for(let i=0;i<30;i++)itm.updateItemDrops(0.05);   // 落定：中心离方块顶 0.15 → y≈41.15
const d0=S.itemDrops[0], y0=+d0.y.toFixed(3);
pulse(60,39,60,true);                        // 顶升：方块 40→41，物品应跟随 →42.15
for(let i=0;i<6;i++)itm.updateItemDrops(0.05);
const d1=S.itemDrops[0], y1=+d1.y.toFixed(3);
const embed1=(gb(Math.floor(d1.x),Math.floor(d1.y),Math.floor(d1.z))!==BT.AIR);
// 兜底：直接把物品中心格填实心（模拟方块移入/AI 放块）
const cy=Math.floor(S.itemDrops[0].y);
sb(60,cy,60,BT.STONE);
for(let i=0;i<10;i++)itm.updateItemDrops(0.05);
const d2=S.itemDrops[0], y2=+d2.y.toFixed(3);
const embed2=(gb(Math.floor(d2.x),Math.floor(d2.y),Math.floor(d2.z))!==BT.AIR);
return {y0, y1, dy:+(y1-y0).toFixed(3), embed1, cy, y2, embed2};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("顶升物品跟随+1", abs((d.get("dy") or 0) - 1.0) < 0.2, f"dy={d.get('dy')}（y0={d.get('y0')}→y1={d.get('y1')}）"),
        ("跟随后物品未嵌实心", d.get("embed1") is False, f"embed1={d.get('embed1')}"),
        ("中心格填实→兜底上浮", (d.get("y2") or 0) > (d.get("cy") or 0) + 0.9, f"cy={d.get('cy')} y2={d.get('y2')}"),
        ("兜底后物品未嵌实心", d.get("embed2") is False, f"embed2={d.get('embed2')}"),
    ]
    return lib.report("E7 物品防埋", res, checks)


@case
def E8(e2e):
    """回归：run_regression.py 13 用例 + run_g0.py 7 用例不回归（子进程串行跑，独立页面）。

    注意两脚本只打印汇总、不 sys.exit 非零，故以「输出无 FAIL 行 + 退出码 0」双判。"""
    env = dict(os.environ)
    results = []
    for script in ("run_regression.py", "run_g0.py"):
        proc = subprocess.run(
            [sys.executable, script], cwd=os.path.dirname(os.path.abspath(__file__)),
            env=env, capture_output=True, text=True, timeout=600,
        )
        out = proc.stdout or ""
        n_fail = out.count(": FAIL")
        tail = out.strip().splitlines()[-6:]
        results.append((script, proc.returncode == 0 and n_fail == 0, tail, n_fail))
    checks = []
    for script, ok, tail, n_fail in results:
        summary = " | ".join(tail[-2:]) if tail else "(无输出)"
        checks.append((f"{script} 全过", ok, f"FAIL行={n_fail}；{summary}"))
    return lib.report("E8 回归(regression+g0)", {"results": [(s, ok) for s, ok, _, _ in results]}, checks)


ALL = {fn.__name__: fn for fn in [E1, E2, E3, E4, E5, E6, E7, E8]}

if __name__ == "__main__":
    names = sys.argv[1:] or list(ALL)
    e2e = lib.E2E()
    e2e.page.cmd('Browser.setDownloadBehavior', {'behavior': 'deny'})
    e2e.fresh_page()
    results = {}
    for n in names:
        results[n] = ALL[n](e2e)
    e2e.close()
    print("\n==== 电梯 T1 验收汇总 ====")
    for n, ok in results.items():
        print(f"  {n}: {'PASS' if ok else 'FAIL'}")
    sys.exit(0 if all(results.values()) else 1)
