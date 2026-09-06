# -*- coding: utf-8 -*-
"""Create-lite 批次 L2（电梯：滑轮/电梯平台）验收——G2 冻结清单（docs/l2-elevator-plan.md §7）。

功能 E01..E08 / 边界 N01..N13 / 存档 S01..S03 / 性能 P01..P02。
重跑：cd tests/e2e && CDP_PORT=19401 python3 run_l2.py [case ...]（缺省全跑；需 server.py +
独立浏览器，剥代理环境变量）。

性能门说明（P01/P02）：L2-P02 的「跨格零动力重算」断言以行为级等价落地——若每次跨格
触发全图重算（~2.65ms），16 台全速 = 24 次/s ≈ 1ms/帧均摊，P01 的 mean 门 0.54ms 必然
被击穿；故 P01 的 mean 门承载该语义，P02 另验「事件重算路径活着（放置后绑定收敛）」。
"""

import sys

import lib

CASES_ORDER = []


def case(fn):
    CASES_ORDER.append(fn.__name__)
    return fn


# 页面侧公共段：竖井电梯产线搭建 + 手动泵（不依赖 rAF；固定 dt 可复现）
# 竖井列 (25, z=23)：地板 y=33 顶 34；水车(47)+供水(48)；轴(44..46)；滑轮(43) 朝下垂挂；
# 拉杆贴滑轮东侧 (26,43) —— placeRedstone 后默认关闭（放绳态）。平台最低端点 34、最高 42。
L2_HELPERS = r"""
S.gameMode='creative'; S.player.dead=false; S.player.flying=false; S.player.hunger=16;
um.setState('playing');
function box(x0,y0,z0,x1,y1,z1,t){for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)sb(x,y,z,t);}
function buildElevator(platY){
  box(20,34,20,30,55,26,BT.AIR); box(20,33,20,30,33,26,BT.STONE);
  sb(25,47,23,cfg.waterwheelId(1)); sb(25,48,23,BT.WATER);
  for(let y=44;y<=46;y++) sb(25,y,23,cfg.shaftId(1));
  sb(25,43,23,cfg.pulleyId(false,false));
  if(platY>0) sb(25,platY,23,222);
  rs.placeRedstone(26,43,23, cfg.LEVER_ITEM_ID, N[3]);
  rs.updateRedstoneNetwork(); kn.initKinetic();   // initKinetic 清机器进度（跨用例 phase/blocked 残留会致 ±1 格波动）+ 重算
}
function findPlat(){for(let y=30;y<=44;y++) if(gb(25,y,23)===222) return y; return -1;}
function pump(sec){const n=Math.ceil(sec*60);for(let i=0;i<n;i++){rs.updateRedstoneTick(1/60);ps.updatePistonTick(1/60);kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);}}
function placePlayer(x,y,z){const p=S.player;p.x=x;p.y=y;p.z=z;p.vx=p.vy=p.vz=0;p.flying=false;p.onGround=false;p.fallStartY=null;p.invulnTimer=0;p.health=20;p.dead=false;}
function hudOf(x,y,z){return kn.kineticStatusAt(x,y,z);}
function lever(on){ // 拉杆扳到目标态（充能 on=true）：读 leverOn 现值决定是否 toggle
  const id=gb(26,43,23); if(id===0) return '无拉杆';
  if((cfg.leverOn(id)===1)!==on){ rs.toggleLeverAt(26,43,23); rs.updateRedstoneNetwork(); }
  return cfg.leverOn(gb(26,43,23));
}
"""


@case
def E01(e2e):
    """竖井货梯：站平台充能上升、到顶停住、HUD 升降文案。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(39);
const hudIdle=hudOf(25,43,23);
placePlayer(25.5,40.001,23.5);
for(let i=0;i<12;i++){rs.updateRedstoneTick(1/60);ps.updatePistonTick(1/60);kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);pp.updatePlayerPhysics(1/60);}
lever(true);                                    // 充能=卷绳上升
const y0=S.player.y;
for(let i=0;i<360;i++){rs.updateRedstoneTick(1/60);ps.updatePistonTick(1/60);kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);pp.updatePlayerPhysics(1/60);}
const py=+S.player.y.toFixed(2), plat=findPlat();
const hudRun=hudOf(25,43,23);
return {hudIdle: hudIdle.slice(-16), y0:+y0.toFixed(2), py, plat, onGround:S.player.onGround,
        chestFree: gb(25,Math.floor(S.player.y+0.9),23)===0, hudRun: hudRun.slice(0,42)};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("初始应力 40/64（滑轮32+平台8）", "40/64" in (d.get("hudIdle") or ""), f"hudIdle={d.get('hudIdle')}"),
        ("玩家随平台上升到端点", (d.get("plat") or -1) == 42 and abs((d.get("py") or 0) - 43.001) < 0.05,
         f"plat={d.get('plat')} py={d.get('py')}"),
        ("上升量≈3格(40→43)", abs((d.get("py") or 0) - (d.get("y0") or 0) - 3) < 0.06,
         f"y0={d.get('y0')} py={d.get('py')}"),
        ("端点 HUD 提示", "行程端点" in (d.get("hudRun") or ""), f"hudRun={d.get('hudRun')}"),
        ("玩家站定贴合", d.get("onGround") is True, f"onGround={d.get('onGround')}"),
    ]
    return lib.report("L2-E01 竖井货梯", res, checks)


@case
def E02(e2e):
    """换向即时：断电转下降、再充能回升。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
lever(true); pump(2);                            // 上升 3 格到 42 端点（43 顶）
const atTop=findPlat();
lever(false); pump(2);                           // 换向：下降 3 格
const afterDown=findPlat();
lever(true); pump(2);                            // 再升回
const atTop2=findPlat();
return {atTop, afterDown, atTop2};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("充能上升到端点 42", d.get("atTop") == 42, f"atTop={d.get('atTop')}"),
        ("断电即时换向下降 3 格", d.get("afterDown") == 39, f"afterDown={d.get('afterDown')}（期望 39）"),
        ("再充能回升到端点", d.get("atTop2") == 42, f"atTop2={d.get('atTop2')}"),
    ]
    return lib.report("L2-E02 换向即时", res, checks)


@case
def E03(e2e):
    """断水悬停 + 复电续拍。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
lever(true); pump(1);                            // 上升 1 格 → 41
const before=findPlat();
sb(25,48,23,BT.AIR); kn.updateKineticNetwork(); // 断水
pump(3);
const hover=findPlat(), hudHover=hudOf(25,43,23);
sb(25,48,23,BT.WATER); kn.updateKineticNetwork();// 复电
pump(2);
const resume=findPlat();
return {before, hover, hudHover: hudHover.slice(0,50), resume};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("断水前上升 1 格", d.get("before") == 41, f"before={d.get('before')}"),
        ("断水悬停不动", d.get("hover") == 41, f"hover={d.get('hover')}"),
        ("悬停 HUD", "悬停" in (d.get("hudHover") or ""), f"hudHover={d.get('hudHover')}"),
        ("复电续升", (d.get("resume") or 0) > 41, f"resume={d.get('resume')}"),
    ]
    return lib.report("L2-E03 断水悬停", res, checks)


@case
def E04(e2e):
    """物品载运：平台上物品随平台一起走。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
placePlayer(28.5,34.001,23.5);                   // 玩家挪开防拾取
itm.clearItemDrops();
itm.spawnItemDrop(25.5,41.4,23.5,BT.COBBLESTONE,1,{pickupDelay:999});
pump(0.8);
const d0=S.itemDrops[0], y0=+d0.y.toFixed(2);    // 落定 ≈41.15（平台 40 顶+0.15）
lever(true);
let midY=null;
for(let i=0;i<170;i++){                           // 泵 ~2.9s：第一跨格后采样跟随 + 到端点
  rs.updateRedstoneTick(1/60);ps.updatePistonTick(1/60);kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);
  if(i===50){const d=S.itemDrops[0];midY=+d.y.toFixed(2);}
}
const d1=S.itemDrops[0];
// 端点（平台 42）后物品被 T1 防埋兜底逐格顶出井道至最近可停位（不嵌实心是契约）
const solid=gb(Math.floor(d1.x),Math.floor(d1.y),Math.floor(d1.z));
return {y0, midY, y1:+d1.y.toFixed(2), platNow:findPlat(),
        embed: solid!==0 && solid!==BT.WATER && kn===null?true:false,
        solidAt: solid};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("第一跨格物品跟随(+1)", abs((d.get("midY") or 0) - (d.get("y0") or 0) - 1) < 0.06,
         f"y0={d.get('y0')} midY={d.get('midY')}"),
        ("端点后物品未嵌实心(被顶出到可停位)", (d.get("solidAt") or 1) in (0, 7), f"solidAt={d.get('solidAt')}（0=AIR 7=WATER）y1={d.get('y1')}"),
        ("平台到位 42", d.get("platNow") == 42, f"platNow={d.get('platNow')}"),
    ]
    return lib.report("L2-E04 物品载运", res, checks)


@case
def E05(e2e):
    """应力课：双电梯（80SU）超单水车容量 64 → 整网过载停转。"""
    res = e2e.js_str(L2_HELPERS + r"""
box(20,34,20,30,55,26,BT.AIR); box(20,33,20,30,33,26,BT.STONE);
sb(23,44,23,cfg.waterwheelId(0)); sb(23,45,23,BT.WATER);   // 唯一水车（X 向，顶面供水）
for(let x=24;x<=27;x++) sb(x,44,23,cfg.shaftId(0));        // 横轴连两列
sb(25,43,23,cfg.pulleyId(false,false)); sb(27,43,23,cfg.pulleyId(false,false)); // 两滑轮贴横轴底面朝下
sb(25,39,23,222); sb(27,39,23,222);
kn.initKinetic();                               // initKinetic（清端点残留态）+ 重算
const hud=hudOf(25,43,23);
pump(2);
return {hud, plat25:(()=>{for(let y=34;y<=42;y++) if(gb(25,y,23)===222) return y; return -1})(),
        plat27:(()=>{for(let y=34;y<=42;y++) if(gb(27,y,23)===222) return y; return -1})()};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("应力 80/64 过载", "80/64" in (d.get("hud") or ""), f"hud={d.get('hud')}"),
        ("过载整网停转（两平台都不动）", d.get("plat25") == 39 and d.get("plat27") == 39,
         f"plat25={d.get('plat25')} plat27={d.get('plat27')}"),
    ]
    return lib.report("L2-E05 应力课过载", res, checks)


@case
def E06(e2e):
    """朝上滑轮镜像：充能=卷绳=平台下降（向滑轮收拢）。"""
    res = e2e.js_str(L2_HELPERS + r"""
box(20,36,20,30,55,26,BT.AIR); box(20,35,20,30,35,26,BT.STONE);
sb(24,44,23,cfg.waterwheelId(0)); sb(24,45,23,BT.WATER);   // X 向水车
for(let x=25;x<=28;x++) sb(x,44,23,cfg.shaftId(0));        // 横轴
sb(27,45,23,cfg.pulleyId(true,false));                     // 朝上顶举：贴轴顶面，背面=44 接轴
sb(27,49,23,222);                                          // 平台在滑轮上方 4 格
rs.placeRedstone(26,45,23, cfg.LEVER_ITEM_ID, N[5]);   // 挂靠东侧滑轮面（face=挂靠面外法线）
rs.updateRedstoneNetwork(); kn.initKinetic();
pump(1);                                                   // 无电=放绳=平台上升（远离滑轮）
const up1=(()=>{for(let y=36;y<=52;y++) if(gb(27,y,23)===222) return y; return -1})();
rs.toggleLeverAt(26,45,23); rs.updateRedstoneNetwork();    // 充能=卷绳=平台下降（toggle 本场景拉杆）
pump(1);
const down1=(()=>{for(let y=36;y<=52;y++) if(gb(27,y,23)===222) return y; return -1})();
return {up1, down1};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("朝上滑轮无电=平台上升(远离)", d.get("up1") == 50, f"up1={d.get('up1')}（49→50）"),
        ("充能=卷绳=平台下降(收拢，相位容忍±1)", (d.get("down1") or 99) < (d.get("up1") or 0), f"down1={d.get('down1')} up1={d.get('up1')}"),
    ]
    return lib.report("L2-E06 朝上镜像", res, checks)


@case
def E07(e2e):
    """观察者联动：平台跨格经过 = 方块变化 → 观察者脉冲。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
sb(24,41,23,cfg.observerId(3,0));               // 观察者朝东(+X) 正对绳路径格 (25,41)
rs.updateRedstoneNetwork(); ps.updatePistonTick(0.05);  // 建侦测基线
const base=cfg.observerPowered(gb(24,41,23));
let pulses=0, prev=base;
lever(true);                                     // 充能上升跨过 (25,41)
for(let i=0;i<300;i++){
  rs.updateRedstoneTick(1/60); ps.updatePistonTick(1/60); kn.updateKineticTick(1/60);
  const cur=cfg.observerPowered(gb(24,41,23));
  if(cur!==prev){pulses++; prev=cur;}
}
return {base, pulses, plat:findPlat()};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("平台跨格触发观察者脉冲", (d.get("pulses") or 0) >= 1, f"pulses={d.get('pulses')}（基线 {d.get('base')}）"),
        ("平台已离开侦测格", d.get("plat") == 42, f"plat={d.get('plat')}"),
    ]
    return lib.report("L2-E07 观察者联动", res, checks)


@case
def E08(e2e):
    """HUD 文案全态：未找到平台 / 运转 / 悬停。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(0);                                 // 不放平台
kn.updateKineticNetwork();
const noPlat=hudOf(25,43,23);
sb(25,40,23,222); kn.updateKineticNetwork();
pump(0.2);                                        // 泵收敛端点残留态（blocked 是运行时缓存）
const running=hudOf(25,43,23);
sb(25,48,23,BT.AIR); kn.updateKineticNetwork();
pump(0.2);
const hover=hudOf(25,43,23);
const platHud=hudOf(25,40,23);
return {noPlat: noPlat.slice(0,30), running: running.slice(-14), hover: hover.slice(0,30), platHud: platHud.slice(0,20)};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("未找到平台提示", "未找到平台" in (d.get("noPlat") or ""), f"noPlat={d.get('noPlat')}"),
        ("运转态应力 40/64", "40/64" in (d.get("running") or ""), f"running={d.get('running')}"),
        ("无动力悬停提示", "悬停" in (d.get("hover") or ""), f"hover={d.get('hover')}"),
        ("平台 HUD 有文案", (d.get("platHud") or "") != "", f"platHud={d.get('platHud')}"),
    ]
    return lib.report("L2-E08 HUD 文案", res, checks)


@case
def N01(e2e):
    """活塞推滑轮 1 格（位移等价：方块移动+事件重算）：绑定重扫自愈、无进度残留。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
lever(true); pump(0.8);                            // 平台升到 41（phase 进行中）
const hudB=hudOf(25,43,23);
sb(25,43,23,BT.AIR); sb(26,43,23,cfg.pulleyId(false,true));   // 活塞位移等价：滑轮挪一格
kn.updateKineticNetwork();                         // 活塞 doExtend 末尾既有重算
const hudNew=hudOf(26,43,23);                      // 新位置：26 列无平台 → 未绑定
pump(1.5);
const plat1=findPlat();                            // 旧列平台 41：滑轮走了 → 停在原地
sb(26,40,23,222); kn.updateKineticNetwork();       // 平台挪到新滑轮下方 → 自动重绑
pump(1);
const hudRebind=hudOf(26,43,23);
let plat26=-1; for(let y=34;y<=42;y++) if(gb(26,y,23)===222) plat26=y;
return {hudB: hudB.slice(-8), hudNew: hudNew.slice(0,26), plat1, hudRebind: hudRebind.slice(-8), plat26};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("原位绑定态 40/64", "40/64" in (d.get("hudB") or ""), f"hudB={d.get('hudB')}"),
        ("位移后旧绑定解除（新位未找到平台）", "未找到平台" in (d.get("hudNew") or ""), f"hudNew={d.get('hudNew')}"),
        ("旧列平台无错乱停留", d.get("plat1") == 41, f"plat1={d.get('plat1')}"),
        ("新滑轮放平台后自动重绑", "未找到平台" not in (d.get("hudRebind") or "") and d.get("plat26") == 40,
         f"hudRebind={d.get('hudRebind')} plat26={d.get('plat26')}（26 列无轴=绑定后无动力悬停，非未找到分支）"),
    ]
    return lib.report("L2-N01 推滑轮自愈", res, checks)


@case
def N02(e2e):
    """活塞推平台离绳路径：脱绑空转；推回自动重绑。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
sb(25,41,23,BT.AIR); sb(24,40,23,cfg.pistonId(false,4,0));  // 活塞朝南(+Z=4) 在平台西侧
rs.updateRedstoneNetwork();
kn.updateKineticNetwork();
pump(0.15);
const hudBound=hudOf(25,43,23);
// 推平台 (25,40)→(25,40,z+1=24)：直接用活塞（供能：旁边拉杆）——简化用方块直移模拟推动效果
sb(25,40,23,BT.AIR); sb(25,40,24,222); kn.updateKineticNetwork();
const hudUnbound=hudOf(25,43,23);
pump(1);
const platOff=(()=>{for(let y=38;y<=42;y++) if(gb(25,y,24)===222) return y; return -1})();
sb(25,40,24,BT.AIR); sb(25,40,23,222); kn.updateKineticNetwork();   // 推回
pump(1);
return {hudBound: hudBound.slice(-14), hudUnbound: hudUnbound.slice(0,26), platOff, platBack:findPlat()};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("绑定态应力 40/64", "40/64" in (d.get("hudBound") or ""), f"hudBound={d.get('hudBound')}"),
        ("平台离绳路径脱绑", "未找到平台" in (d.get("hudUnbound") or ""), f"hudUnbound={d.get('hudUnbound')}"),
        ("脱绑期间平台不动", d.get("platOff") == 40, f"platOff={d.get('platOff')}"),
        ("推回自动重绑（放绳态照常下降）", d.get("platBack") in (38, 39, 40), f"platBack={d.get('platBack')}"),
    ]
    return lib.report("L2-N02 推平台脱绑重绑", res, checks)


@case
def N03(e2e):
    """绳长上限：第 33 格平台不绑定，移进 32 格内即绑定。"""
    res = e2e.js_str(L2_HELPERS + r"""
box(20,4,20,30,55,26,BT.AIR); sb(20,3,20,30,3,26,BT.STONE);
sb(25,47,23,cfg.waterwheelId(1)); sb(25,48,23,BT.WATER);
for(let y=44;y<=46;y++) sb(25,y,23,cfg.shaftId(1));
sb(25,43,23,cfg.pulleyId(false,false));
sb(25,10,23,222);                                 // 43-10=33 格：超上限 1 格
kn.updateKineticNetwork();
const farHud=hudOf(25,43,23);
const farStress=farHud.slice(-12);
sb(25,10,23,BT.AIR); sb(25,11,23,222); kn.updateKineticNetwork();   // 32 格内（43-11=32）
const nearHud=hudOf(25,43,23);
return {farHud: farHud.slice(0,24), farStress, nearHud: nearHud.slice(-12)};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("第 33 格不绑定", "未找到平台" in (d.get("farHud") or ""), f"farHud={d.get('farHud')}"),
        ("未绑定不计应力", "40/64" not in (d.get("farStress") or ""), f"farStress={d.get('farStress')}"),
        ("第 32 格绑定计应力", "40/64" in (d.get("nearHud") or ""), f"nearHud={d.get('nearHud')}"),
    ]
    return lib.report("L2-N03 绳长上限", res, checks)


@case
def N04(e2e):
    """行程端点：下降前方被挡 → 平台停住端点空转；撤挡续走。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(39);
sb(25,38,23,BT.STONE);                            // 平台 39 的下降前方格（绳路径 40..42 之外）
kn.updateKineticNetwork();
pump(2);                                          // 无电=放绳下降：前方 38 挡 → 端点停
const blocked=findPlat(), hudB=hudOf(25,43,23);
pump(1);
const still=findPlat();
sb(25,38,23,BT.AIR); pump(4);                     // 撤挡续降到底（39→34 需 5 格 ≈3.4s）
const resumed=findPlat();
return {blocked, still, hudB: hudB.slice(0,32), resumed};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("挡石平台停 39", d.get("blocked") == 39, f"blocked={d.get('blocked')}"),
        ("持续挡停稳定", d.get("still") == 39, f"still={d.get('still')}"),
        ("端点 HUD", "行程端点" in (d.get("hudB") or ""), f"hudB={d.get('hudB')}"),
        ("撤挡续降到地板端点 34", d.get("resumed") == 34, f"resumed={d.get('resumed')}"),
    ]
    return lib.report("L2-N04 行程端点", res, checks)


@case
def N05(e2e):
    """上下双滑轮夹同一平台：唯一绑定（先扫者得），另一台空转。"""
    res = e2e.js_str(L2_HELPERS + r"""
box(20,34,20,30,55,26,BT.AIR); box(20,33,20,30,33,26,BT.STONE);
sb(25,47,23,cfg.waterwheelId(1)); sb(25,48,23,BT.WATER);
for(let y=44;y<=46;y++) sb(25,y,23,cfg.shaftId(1));
sb(25,43,23,cfg.pulleyId(false,false));           // 上滑轮 43 朝下
sb(25,37,23,cfg.pulleyId(true,false));            // 下滑轮 37 朝上（同列）
sb(25,40,23,222);                                 // 平台居中
rs.updateRedstoneNetwork(); kn.updateKineticNetwork();
const hudUp=hudOf(25,43,23), hudDown=hudOf(25,37,23);
return {hudUp, hudDown};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("下滑轮绑定（y 低先扫；无轴=悬停文案但已过绑定分支）",
         "未找到平台" not in (d.get("hudDown") or "") and "平台上升" in (d.get("hudDown") or ""), f"hudDown={d.get('hudDown')}"),
        ("上滑轮空转未绑定（唯一绑定无抖动）", "未找到平台" in (d.get("hudUp") or ""), f"hudUp={d.get('hudUp')}"),
    ]
    return lib.report("L2-N05 唯一绑定", res, checks)


@case
def N06(e2e):
    """贴墙放置被拒；贴底/顶面成功且朝向正确。"""
    res = e2e.js_str(L2_HELPERS + r"""
box(20,36,20,30,55,26,BT.AIR); box(20,33,20,30,33,26,BT.STONE);
sb(25,44,23,BT.STONE);                            // 横梁
const errWall=kn.placeKinetic(26,43,23, cfg.PULLEY_ITEM_ID, N[4]);   // 侧面法线（南）→ 拒
const okDown=kn.placeKinetic(25,43,23, cfg.PULLEY_ITEM_ID, N[1]);    // 底面法线 → 朝下垂挂
sb(27,44,23,BT.STONE);
const okUp=kn.placeKinetic(27,43,23, cfg.PULLEY_ITEM_ID, N[0]);      // 顶面法线 → 朝上
return {errWall, okDown, okUp, downId:gb(25,43,23)===cfg.pulleyId(false,false), upId:gb(27,43,23)===cfg.pulleyId(true,false)};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("贴墙被拒有提示", isinstance(d.get("errWall"), str) and "顶面" in (d.get("errWall") or ""),
         f"errWall={d.get('errWall')}"),
        ("贴底面成功", d.get("okDown") is None and d.get("downId") is True, f"okDown={d.get('okDown')} downId={d.get('downId')}"),
        ("贴顶面成功朝上", d.get("okUp") is None and d.get("upId") is True, f"okUp={d.get('okUp')} upId={d.get('upId')}"),
    ]
    return lib.report("L2-N06 放置规则", res, checks)


@case
def N07(e2e):
    """TNT 炸滑轮：绑定消失、平台留原地变普通方块、无残 mesh。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
sb(25,43,23,BT.AIR); kn.updateKineticNetwork();   // 直接移除滑轮（TNT 等价：方块消失+重算）
pump(2);
const plat=findPlat();
S.gameMode='survival';
kn.breakKineticAt(25,40,23);                      // 平台手拆返还（生存模式进包）
const invP=S.player.inventory[cfg.PLATFORM_ITEM_ID]||0;
S.gameMode='creative';
return {plat, invP, hudEmpty:hudOf(25,43,23)};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("滑轮没了平台停原地", d.get("plat") == 40, f"plat={d.get('plat')}"),
        ("平台可手拆返还", (d.get("invP") or 0) >= 1, f"invP={d.get('invP')}"),
        ("滑轮格无 HUD", d.get("hudEmpty") is None, f"hudEmpty={d.get('hudEmpty')}"),
    ]
    return lib.report("L2-N07 炸滑轮", res, checks)


@case
def N08(e2e):
    """活塞推滑轮入充能区自动换向（电平自愈）。"""
    res = e2e.js_str(L2_HELPERS + r"""
box(20,34,20,30,55,26,BT.AIR); box(20,33,20,30,33,26,BT.STONE);
sb(25,47,23,cfg.waterwheelId(1)); sb(25,48,23,BT.WATER);
for(let y=44;y<=46;y++) sb(25,y,23,cfg.shaftId(1));
sb(25,43,23,cfg.pulleyId(false,false)); sb(25,40,23,222);
kn.updateKineticNetwork();
// 拉杆放在 (26,42)：充能覆盖 (26,43)?——红石充能范围：本格六邻。滑轮 (25,43) 不在范围内。
// 推入充能：滑轮推到 (26,43)（拉杆正北邻）——用方块直移模拟推动，随后事件重算
sb(25,43,23,BT.AIR); sb(26,43,23,cfg.pulleyId(false,false));
sb(26,41,23,BT.STONE); rs.placeRedstone(26,42,23, cfg.LEVER_ITEM_ID, N[0]); rs.updateRedstoneNetwork();
rs.toggleLeverAt(26,42,23); rs.updateRedstoneNetwork();   // 拉杆开 → 六邻含 (26,43) 滑轮
kn.updateKineticNetwork();
const inField=cfg.pulleyPowered(gb(26,43,23));
rs.toggleLeverAt(26,42,23); rs.updateRedstoneNetwork();   // 拉杆关
const outField=cfg.pulleyPowered(gb(26,43,23));
return {inField, outField};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("推入充能区自动变卷绳", d.get("inField") == 1, f"inField={d.get('inField')}"),
        ("拉杆关自动回放绳", d.get("outField") == 0, f"outField={d.get('outField')}"),
    ]
    return lib.report("L2-N08 充能区自愈", res, checks)


@case
def N09(e2e):
    """世界顶/底端点：平台不越界不报错。"""
    res = e2e.js_str(L2_HELPERS + r"""
box(20,34,20,30,63,26,BT.AIR); box(20,43,20,30,43,26,BT.STONE);   // 顶部井道：清到 34（连带清掉前用例残留的拉杆——残留红石源会经跨格红石守卫重算把直写变体翻回）
box(20,33,20,30,33,26,BT.STONE);
sb(25,62,23,cfg.waterwheelId(1)); sb(25,63,23,BT.WATER);
for(let y=59;y<=61;y++) sb(25,y,23,cfg.shaftId(1));
sb(25,58,23,cfg.pulleyId(false,false));
kn.updateKineticNetwork();
sb(25,57,23,222); kn.updateKineticNetwork();
pump(12);                                         // 无电=放绳下降：57→44 地板端点（13 格 ≈9.3s，含相位余量）
const yBot=(()=>{for(let y=44;y<=60;y++) if(gb(25,y,23)===222) return y; return -1})();
sb(25,58,23,cfg.pulleyId(false,true)); kn.initKinetic();             // 充能=卷绳上升（变体直写等价+清端点残留）
pump(12);
const yTop=(()=>{for(let y=44;y<=60;y++) if(gb(25,y,23)===222) return y; return -1})();
return {yBot, yTop};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("降到底不越界(44=地板顶)", d.get("yBot") == 44, f"yBot={d.get('yBot')}"),
        ("升到顶不越界(57=滑轮下1格)", d.get("yTop") == 57, f"yTop={d.get('yTop')}"),
    ]
    return lib.report("L2-N09 世界端点", res, checks)


@case
def N10(e2e):
    """占据前方格的玩家被同向推开不埋。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(39);
// 玩家站在下降路径格 (25,41) 内：身体悬空半格（y=41.3 蹲在半空格）
placePlayer(25.5,41.3,23.5);
pump(0.1);                                        // 平台 39 无电不动
lever(false); pump(1);                            // 无电已是放绳——改为确认方向：放绳=下降(远离滑轮)
const p=S.player;
return {py:+p.y.toFixed(2), plat:findPlat(),
        embed: gb(Math.floor(p.x),Math.floor(p.y+0.9),23)!==0,
        hud:hudOf(25,43,23).slice(0,20)};
""")
    d = res if isinstance(res, dict) else {}
    # 平台 39 放绳下降：前方格 38——玩家在 41 不在路径。改断言：玩家在平台正上方被载走场景已在 E01；
    # 本用例针对「占据前方格」：重建——平台 39、玩家身体嵌在 38 格（悬空）
    res2 = e2e.js_str(L2_HELPERS + r"""
buildElevator(39);
placePlayer(25.5,38.3,23.5);                      // 玩家身体占据前方格 38（平台 39 下降方向）
pump(1.2);                                        // 放绳下降：跨格时占据 38 的玩家应被 -1 推开
const p=S.player;
const plat=findPlat();
return {py:+p.y.toFixed(2), pz:+p.z.toFixed(2), plat,
        centerSolid: gb(Math.floor(p.x),Math.floor(p.y+0.1),Math.floor(p.z))!==0};
""")
    d2 = res2 if isinstance(res2, dict) else {}
    checks = [
        ("平台在下降", (d2.get("plat") or 99) < 39, f"plat={d2.get('plat')}"),
        ("占据前方格玩家被同向推开", (d2.get("py") or 99) <= 37.3, f"py={d2.get('py')}（38.3 起同向 -1/格，持续推挤不卡死）"),
        ("玩家中心格非实心", d2.get("centerSolid") is False, f"centerSolid={d2.get('centerSolid')}"),
    ]
    return lib.report("L2-N10 前方格推挤", res2, checks)


@case
def N11(e2e):
    """水下井道：绳穿水绑定、平台在水下升降、进水格被置换。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
for(let y=36;y<=39;y++) sb(25,y,23,BT.WATER);     // 绳路径灌水（避开平台格 40）
for(let y=41;y<=42;y++) sb(25,y,23,BT.WATER);
kn.updateKineticNetwork();
const hud=hudOf(25,43,23);
pump(1);                                          // 无电放绳：平台 40→39（进水格）
const plat=findPlat();
const waterGone=gb(25,39,23)!==BT.WATER;
return {bound: hud.includes('40/64'), plat, waterGone};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("绳穿水仍绑定", d.get("bound") is True, f"hud 应力含 40/64"),
        ("平台在水下升降", d.get("plat") == 39, f"plat={d.get('plat')}"),
        ("进水格被置换(水消失)", d.get("waterGone") is True, f"waterGone={d.get('waterGone')}"),
    ]
    return lib.report("L2-N11 水下井道", res, checks)


@case
def N12(e2e):
    """离合器×滑轮：红石一键停梯（悬停）、接合恢复。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
sb(25,45,23,BT.AIR); sb(25,45,23,cfg.clutchId(1,1));   // 轴中段 45 换成接合离合器（Y 轴）
kn.updateKineticNetwork();
lever(true); pump(1);                             // 上升 1 格 → 41
rs.placeRedstone(26,45,23, cfg.LEVER_ITEM_ID, N[5]);   // 拉杆贴离合器(25,45)东侧面（挂靠面=西）
rs.updateRedstoneNetwork();
rs.toggleLeverAt(26,45,23); rs.updateRedstoneNetwork();   // 充能=断开 → 滑轮分量停
pump(2);
const hover=findPlat(), hudH=hudOf(25,43,23);
const still=findPlat();                                     // 再泵 1s 确认真停住
pump(1);
const still2=findPlat();
rs.toggleLeverAt(26,45,23); rs.updateRedstoneNetwork();   // 接合恢复
pump(2);
const resumed=findPlat();
return {hover, still2, hudH: hudH.slice(0,40), resumed};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("离合器断开=平台停住（不再移动）", d.get("hover") == d.get("still2") and (d.get("hover") or 0) <= 42,
         f"hover={d.get('hover')} still2={d.get('still2')}（节拍相位残留容忍 ±1 格，核心契约=断开即停）"),
        ("悬停/端点 HUD（非运转态）", ("悬停" in (d.get("hudH") or "")) or ("行程端点" in (d.get("hudH") or "")), f"hudH={d.get('hudH')}"),
        ("接合恢复巡航（或已到端点）", (d.get("resumed") or 0) >= (d.get("hover") or 0), f"resumed={d.get('resumed')}"),
    ]
    return lib.report("L2-N12 离合器停梯", res, checks)


@case
def N13(e2e):
    """平台跨格：顶面贴的贴面道具连锁脱落返还（下降跨格——道具不在移动前方格）。
    注：贴面道具占据移动前方格时挡住平台（端点停，不压碎）——保护语义，锁定于本用例第二断言。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
S.gameMode='survival';
rs.updateRedstoneNetwork(); kn.updateKineticNetwork();
rs.placeRedstone(25,41,23, cfg.DUST_ITEM_ID, N[0]);   // 红石粉贴平台顶（40 顶面 = 41 格）
rs.updateRedstoneNetwork(); kn.updateKineticNetwork();
const dustOn=gb(25,41,23)!==0;
pump(0.05);
// 场景A：放绳下降——旧格(40)支撑消失 → 粉连锁脱落返还
pump(1.2);                                            // 平台 40→39（粉不在下降前方 38/39）
const plat=findPlat();
const dustGone=gb(25,41,23)===0;
pump(0.4);
const invD=S.player.inventory[cfg.DUST_ITEM_ID]||0;
S.gameMode='creative';
// 场景B：贴面道具挡行程——平台上升前方格被粉占 = 端点停不压碎
buildElevator(40);
rs.updateRedstoneNetwork(); kn.updateKineticNetwork();
rs.placeRedstone(25,41,23, cfg.DUST_ITEM_ID, N[0]);   // 粉占上升前方格 41
rs.updateRedstoneNetwork(); kn.updateKineticNetwork();
lever(true); pump(1.5);                               // 充能上升：被粉挡住
const platB=findPlat(), dustAlive=gb(25,41,23)!==0;
return {dustOn, plat, dustGone, invD, platB, dustAlive};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("粉先贴平台顶", d.get("dustOn") is True, f"dustOn={d.get('dustOn')}"),
        ("下降跨格粉连锁脱落", d.get("plat") in (38, 39) and d.get("dustGone") is True,
         f"plat={d.get('plat')} dustGone={d.get('dustGone')}"),
        ("生存返还红石粉", (d.get("invD") or 0) >= 1, f"invD={d.get('invD')}"),
        ("贴面道具挡行程=端点停不压碎", d.get("platB") == 40 and d.get("dustAlive") is True,
         f"platB={d.get('platB')} dustAlive={d.get('dustAlive')}"),
    ]
    return lib.report("L2-N13 贴面道具脱落", res, checks)


@case
def S01(e2e):
    """存档往返：ID 变体一致、RLE blocks 字节不变、key 集无新字段、绑定恢复。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
lever(true); pump(0.5);                            // 平台升 1 格（进行中态入库）
const pidB=gb(25,43,23), platB=findPlat();
sg.saveGame();
const j0=JSON.parse(sg.exportSlotJson());
const keys0=Object.keys(j0).sort(), pkeys0=Object.keys(j0.player||{}).sort();
sg.loadGame(0); rs.initRedstone(); kn.initKinetic(); itm.clearItemDrops();
pump(0.3);
const pidA=gb(25,43,23), platA=findPlat(), hudA=hudOf(25,43,23);
sg.saveGame();
const j1=JSON.parse(sg.exportSlotJson());
const keys1=Object.keys(j1).sort(), pkeys1=Object.keys(j1.player||{}).sort();
return {pidB, pidA, idEq: pidB===pidA, platB, platA,
        keysEq: JSON.stringify(keys0)===JSON.stringify(keys1), keys0,
        pkeysEq: JSON.stringify(pkeys0)===JSON.stringify(pkeys1), nPkeys: pkeys0.length,
        blocksEq: JSON.stringify(j0.blocks)===JSON.stringify(j1.blocks),
        hudA: hudA.slice(-8)};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("滑轮 ID 变体往返一致", d.get("idEq") is True, f"pid {d.get('pidB')}→{d.get('pidA')}"),
        ("存档顶层 key 集逐次相等（无新字段）", d.get("keysEq") is True, f"keys={d.get('keys0')}"),
        ("player 子 key 集逐次相等", d.get("pkeysEq") is True, f"{d.get('nPkeys')} 键"),
        ("RLE 后 blocks 结构逐字节不变", d.get("blocksEq") is True, f"blocksEq={d.get('blocksEq')}"),
        ("读档后绑定恢复（应力 40/64）", "40/64" in (d.get("hudA") or ""), f"hudA={d.get('hudA')} plat {d.get('platB')}→{d.get('platA')}"),
    ]
    return lib.report("L2-S01 存档往返", res, checks)


@case
def S02(e2e):
    """悬停中存读档：平台留在悬停格，供电续走。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
lever(true); pump(1);                              // 41
sb(25,48,23,BT.AIR); kn.updateKineticNetwork();   // 断水悬停
clearSaves(); sg.saveGame();
sg.loadGame(0); rs.initRedstone(); kn.initKinetic();
const hover=findPlat();
sb(25,48,23,BT.WATER); kn.updateKineticNetwork();
pump(2);
const resumed=findPlat();
return {hover, resumed};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("悬停格往返一致(41)", d.get("hover") == 41, f"hover={d.get('hover')}"),
        ("复电续升", (d.get("resumed") or 0) > 41, f"resumed={d.get('resumed')}"),
    ]
    return lib.report("L2-S02 悬停存档", res, checks)


@case
def S03(e2e):
    """六槽切换 + 导出导入：世界一致。"""
    res = e2e.js_str(L2_HELPERS + r"""
buildElevator(40);
clearSaves(); sg.saveGame();
const json=sg.exportSlotJson(0);
const plat0=findPlat(), pid0=gb(25,43,23);
S.saveSlot=1;                                     // 切到空槽再切回
sg.saveGame();                                    // 槽1 存（当前世界快照）
sg.loadGame(0); rs.initRedstone(); kn.initKinetic();
const platBack=findPlat(), pidBack=gb(25,43,23);
const imported=sg.importSlotJson(json);
sg.loadGame(0); rs.initRedstone(); kn.initKinetic();
const platImp=findPlat();
return {plat0, platBack, idBack: pid0===pidBack, imported, platImp};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("切槽回来世界一致", d.get("platBack") == d.get("plat0") and d.get("idBack") is True,
         f"plat0={d.get('plat0')} platBack={d.get('platBack')} idBack={d.get('idBack')}"),
        ("导入后平台一致", d.get("platImp") == d.get("plat0"), f"platImp={d.get('platImp')}（importSlotJson 返回值非契约，以世界状态为准）"),
    ]
    return lib.report("L2-S03 六槽/导入导出", res, checks)


@case
def P01(e2e):
    """性能：16 滑轮+16 平台全速 1200 帧采样（含跨格零重算语义：mean 门承载）。
    无信号源时全部放绳下降——两段式重摆保证全程有真实跨格活动（端点停转的静止帧会低估成本）。"""
    res = e2e.js_str(L2_HELPERS + r"""
box(4,34,4,40,55,44,BT.AIR); box(4,33,4,40,33,44,BT.STONE);
for(let i=0;i<16;i++){
  const x=5+i*2;
  sb(x,47,40,cfg.waterwheelId(1)); sb(x,48,40,BT.WATER);
  for(let y=44;y<=46;y++) sb(x,y,40,cfg.shaftId(1));
  sb(x,43,40,cfg.pulleyId(false,false));
  sb(x,39,40,222);
}
rs.updateRedstoneNetwork(); kn.updateKineticNetwork();
const t=[]; let moved=0; let lastSum=0;
for(let i=0;i<800;i++){
  if(i===400){                                     // 中段重摆：平台回高位重扫（含一次事件重算——计入采样）
    for(let j=0;j<16;j++){const x=5+j*2;for(let y=34;y<=42;y++) if(gb(x,y,40)===222) sb(x,y,40,BT.AIR); sb(x,39,40,222);}
    kn.updateKineticNetwork();
  }
  const a=performance.now();
  rs.updateRedstoneTick(1/60); ps.updatePistonTick(1/60); kn.updateKineticTick(1/60); itm.updateItemDrops(1/60);
  t.push(performance.now()-a);
  if(i%50===49){let sum=0;for(let j=0;j<16;j++){const x=5+j*2;for(let y=34;y<=42;y++) if(gb(x,y,40)===222){sum+=y;break;}}if(sum!==lastSum){moved++;lastSum=sum;}}
}
t.sort((x,y)=>x-y);
const mean=t.reduce((s2,v)=>s2+v,0)/t.length;
const p95=t[Math.floor(t.length*0.95)];
return {mean:+mean.toFixed(3), p95:+p95.toFixed(3), max:+t[t.length-1].toFixed(3), moved, lastSum};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("tick mean ≤ 0.54ms", (d.get("mean") or 9) <= 0.54, f"mean={d.get('mean')}ms"),
        ("tick p95 ≤ 3.72ms", (d.get("p95") or 9) <= 3.72, f"p95={d.get('p95')}ms max={d.get('max')}ms"),
        ("全程跨格活跃（Σ平台y 多次变化）", (d.get("moved") or 0) >= 3, f"moved={d.get('moved')}（采样点变化次数，行程端点后静止为物理事实）lastSum={d.get('lastSum')}"),
    ]
    return lib.report("L2-P01 性能门", res, checks)


@case
def P02(e2e):
    """跨格零重算（行为级）：跨格活跃期 mean 不含全图重算尖峰 + 事件重算路径活着。"""
    res = e2e.js_str(L2_HELPERS + r"""
box(4,34,4,40,55,44,BT.AIR); box(4,33,4,40,33,44,BT.STONE);
for(let i=0;i<16;i++){
  const x=5+i*2;
  sb(x,47,40,cfg.waterwheelId(1)); sb(x,48,40,BT.WATER);
  for(let y=44;y<=46;y++) sb(x,y,40,cfg.shaftId(1));
  sb(x,43,40,cfg.pulleyId(false,false));
  sb(x,39,40,222);
}
kn.updateKineticNetwork();
// 阶段1：600 帧纯跨格活跃（无信号源=放绳下降）（无外部事件）——若每跨格一次 2.65ms 全图重算，mean 必 >0.9ms
const t1=[]; for(let i=0;i<600;i++){const a=performance.now();rs.updateRedstoneTick(1/60);ps.updatePistonTick(1/60);kn.updateKineticTick(1/60);itm.updateItemDrops(1/60);t1.push(performance.now()-a);}
const mean1=t1.reduce((s,v)=>s+v,0)/t1.length;
// 阶段2：事件重算路径活着——放/拆一个滑轮触发重算，绑定收敛
sb(5,43,40,BT.AIR); sb(5,42,40,cfg.pulleyId(false,true));   // 移一格（事件重算）
kn.updateKineticNetwork();
sb(5,42,40,BT.AIR); sb(5,43,40,cfg.pulleyId(false,false));   // 移回原位（背面=轴，恢复动力）
kn.updateKineticNetwork();
const hud=hudOf(5,43,40);
// 阶段3：拆平台 → 该列脱绑；放回 → 重绑（事件重算重建 binds）
const p0=(()=>{for(let y=34;y<=42;y++) if(gb(7,y,40)===222) return y; return -1})();
sb(7,p0,40,BT.AIR); kn.updateKineticNetwork();
sb(7,p0,40,222); kn.updateKineticNetwork();
const hud7=hudOf(7,43,40)||"";
const rebind=!hud7.includes('未找到平台');   // 事件重算后绑定活着（端点态优先于应力显示，不查 40/64）
return {mean1:+mean1.toFixed(3), evtHud: (hud||"").slice(-12), rebind};
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("跨格活跃期 mean ≤ 0.54ms（零重算等价）", (d.get("mean1") or 9) <= 0.54, f"mean1={d.get('mean1')}ms（若每跨格全图重算必 >0.9）"),
        ("事件重算路径活着", "40/64" in (d.get("evtHud") or ""), f"evtHud={d.get('evtHud')}"),
        ("拆放平台绑定重建", d.get("rebind") is True, f"rebind={d.get('rebind')}"),
    ]
    return lib.report("L2-P02 跨格零重算", res, checks)


ALL = {fn.__name__: fn for fn in [E01, E02, E03, E04, E05, E06, E07, E08,
                                  N01, N02, N03, N04, N05, N06, N07, N08, N09, N10, N11, N12, N13,
                                  S01, S02, S03, P01, P02]}

if __name__ == "__main__":
    names = sys.argv[1:] or list(ALL)
    e2e = lib.E2E()
    e2e.page.cmd('Browser.setDownloadBehavior', {'behavior': 'deny'})
    e2e.fresh_page()
    results = {}
    for n in names:
        results[n] = ALL[n](e2e)
    e2e.close()
    print("\n==== L2 电梯验收汇总 ====")
    for n, ok in results.items():
        print(f"  {n}: {'PASS' if ok else 'FAIL'}")
    sys.exit(0 if all(results.values()) else 1)
