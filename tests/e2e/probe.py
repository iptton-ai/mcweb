# -*- coding: utf-8 -*-
"""驱动能力探针：页面启动 / rAF / 放置与瞄准 / 动力状态接口形状。"""

import json
import lib

e2e = lib.E2E()

# 1) 启动状态 + 进入 playing
boot = e2e.run(r"""
// 走真实 DOM 点击开始界面
const ss=document.getElementById('start-screen');
log('start-screen exists=', !!ss, 'uiState=', um.getUIState());
ss.click();
await sleep(200);
log('after click uiState=', um.getUIState());
log('blocks ready=', !!S.blocks, 'len=', S.blocks&&S.blocks.length, 'mode=', S.gameMode, 'player=', Math.floor(S.player.x), Math.floor(S.player.y), Math.floor(S.player.z));
const alive=await rafAlive();
log('rafAlive=', alive);
window.__rafAlive=alive;
return {uiState: um.getUIState(), hasBlocks: !!S.blocks, mode: S.gameMode, rafAlive: alive,
        px: S.player.x, py: S.player.y, pz: S.player.z};
""")
print("BOOT:", json.dumps(boot, ensure_ascii=False, indent=1))

# 2) 平台 + placeRedstone 语义 + 瞄准 + placeBlock
probe2 = e2e.run(r"""
platform(10,10,10,10,20);
log('platform done; ground(12,19,12)=', gb(12,19,12));
// placeRedstone(bx,by,bz,itemId,face)：先放一盏灯看 face 语义（灯是实心立方体，face 应无关）
const r1=rs.placeRedstone(12,20,12, cfg.LAMP_ITEM_ID, 0);
log('placeRedstone lamp ret=', r1, 'id=', gb(12,20,12), 'isLamp=', cfg.isLampId(gb(12,20,12)));
// 灯上叠灯
const r2=rs.placeRedstone(12,21,12, cfg.LAMP_ITEM_ID, 0);
log('stack lamp ret=', r2, 'id=', gb(12,21,12));
// 火把贴面：支撑块 (14,20,12)，火打算放它北面 (14,20,11) —— face=? 探两种
sb(14,20,12,BT.STONE); sb(14,20,11,BT.AIR);
const t1=rs.placeRedstone(14,20,11, cfg.RTORCH_ITEM_ID, 2);
log('rtorch@north face=2 ret=', t1, 'id=', gb(14,20,11), 'facing=', cfg.rtorchFacing(gb(14,20,11)), 'lit=', cfg.rtorchLit(gb(14,20,11)));
// 拉杆贴地
const l1=rs.placeRedstone(16,20,16, cfg.LEVER_ITEM_ID, 0);
log('lever@ground ret=', l1, 'id=', gb(16,20,16), 'on=', cfg.leverOn(gb(16,20,16)));
// 红石粉铺地
const d1=rs.placeRedstone(17,20,16, cfg.DUST_ITEM_ID, 0);
log('dust@ground ret=', d1, 'id=', gb(17,20,16));
// 活塞：朝上放 (18,20,16)（点顶面 face=0 → 朝向=外法线上）
const p1=ps.placePiston(18,20,16, cfg.PISTON_ITEM_ID, 0);
log('piston face0 ret=', p1, 'id=', gb(18,20,16), 'facing=', cfg.pistonFacing(gb(18,20,16)), 'ext=', cfg.pistonExtended(gb(18,20,16)));
return {ok:true};
""")
print("PROBE2:", json.dumps(probe2, ensure_ascii=False, indent=1))

# 3) 瞄准 + raycastBlocks 形状 + placeBlock 真实放置
probe3 = e2e.run(r"""
// 目标：往 (12,20,12) 灯的东邻 (13,20,12) 放石头（贴灯的东面放置）
// 玩家站 (18,21.5,12)，朝 -X 看。扫 yaw 找 raycast 命中 (12,20,12)
S.gameMode='creative';
let found=null;
for(let yaw=-3.2;yaw<=3.2;yaw+=0.1){
  aimPlayer(18,20.5,12.5,yaw,0);
  const hit=it.raycastBlocks();
  if(hit&&hit.x===12&&hit.y===20&&hit.z===12){found={yaw,hit};break;}
}
log('aim scan found=', JSON.stringify(found));
const hit0=it.raycastBlocks();
log('raycast keys=', hit0?Object.keys(hit0).join(','):'null', JSON.stringify(hit0));
let placed=null;
if(found){
  S.player.selectedSlot=HB.indexOf(BT.STONE);
  log('selectedSlot stone=', S.player.selectedSlot);
  it.placeBlock();
  placed=gb(13,20,12);
  log('after placeBlock gb(13,20,12)=', placed);
}
return {found, placed};
""")
print("PROBE3:", json.dumps(probe3, ensure_ascii=False, indent=1))

# 4) 动力：水车+水（setBlockSafe 直接摆，看是否自动重算）+ kineticStatusAt 形状
probe4 = e2e.run(r"""
platform(30,10,10,10,20);
// 水车 X 轴（贴东西墙面 face=3）→ placeKinetic
const k1=kn.placeKinetic(34,20,14, cfg.WATERWHEEL_ITEM_ID, 3);
log('wheel placed ret=', k1, 'id=', gb(34,20,14), 'axis=', cfg.waterwheelAxis(gb(34,20,14)));
log('status before water=', JSON.stringify(kn.kineticStatusAt(34,20,14)));
sb(34,21,14,BT.WATER);
log('water placed; status without manual recompute=', JSON.stringify(kn.kineticStatusAt(34,20,14)));
kn.updateKineticNetwork();
log('status after manual recompute=', JSON.stringify(kn.kineticStatusAt(34,20,14)));
// 掉落物形状
itm.spawnItemDrop(34,22,14, BT.COBBLESTONE, 1);
await sleep(100);
log('itemDrop sample=', JSON.stringify(S.itemDrops[S.itemDrops.length-1]));
itm.clearItemDrops();
return {ok:true};
""")
print("PROBE4:", json.dumps(probe4, ensure_ascii=False, indent=1))

e2e.close()
