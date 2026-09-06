# -*- coding: utf-8 -*-
"""一次性探针：量各不满格道具的世界包围盒（outline 数据的事实来源）。"""

import json

import lib

e2e = lib.E2E()

res = e2e.run(r"""
setDay(); S.gameMode='creative';
platform(58,48,26,10,40); // x58..83, z48..57，地板 y=39，上方清空
const T = await import('three');
const ch = await import(B+'chunk.js');
function measure(x,y,z){
  ch.rebuildChunk(Math.floor(x/16), Math.floor(z/16));
  const d = S.droppedItems.find(d=>d.prop&&d.x===x&&d.y===y&&d.z===z);
  if(!d) return {err:'no mesh'};
  d.mesh.updateWorldMatrix(true,true);
  const box = new T.Box3().setFromObject(d.mesh);
  return {min:[+(box.min.x-x).toFixed(3),+(box.min.y-y).toFixed(3),+(box.min.z-z).toFixed(3)],
          max:[+(box.max.x-x).toFixed(3),+(box.max.y-y).toFixed(3),+(box.max.z-z).toFixed(3)]};
}
const out=[];
const put=(label,x,y,z,id)=>{sb(x,y,z,id); out.push({label,id,box:measure(x,y,z)}); sb(x,y,z,BT.AIR);};
const wall=(label,x,y,z,itemId,f)=>{ // f=挂靠面法线索引（支撑块在 -N[f] 侧）
  const n=N[f]; sb(x-n.dx,y-n.dy,z-n.dz,BT.STONE);
  const r=rs.placeRedstone(x,y,z,itemId,n); out.push({label,id:gb(x,y,z),placeErr:r,box:measure(x,y,z)});
  sb(x-n.dx,y-n.dy,z-n.dz,BT.AIR); sb(x,y,z,BT.AIR);};
// 直放置（无支撑要求）
put('火把',58,40,48,BT.TORCH);
put('花',59,40,48,BT.FLOWER);
put('红石粉·灭',60,40,48,cfg.dustId(0));
put('红石粉·亮',61,40,48,cfg.dustId(1));
put('压力板',62,40,48,cfg.plateId(0));
put('压力板·踩下',63,40,48,cfg.plateId(1));
put('红石火把·贴地',64,40,48,cfg.rtorchId(0,1));
put('红石火把·贴地灭',65,40,48,cfg.rtorchId(0,0));
put('按钮·贴地',66,40,48,cfg.buttonId(0,0));
put('按钮·贴地按下',67,40,48,cfg.buttonId(0,1));
put('拉杆·贴地开',68,40,48,cfg.leverId(0,1));
put('拉杆·贴地关',69,40,48,cfg.leverId(0,0));
put('传送带',70,40,48,cfg.beltId(0));
// 墙挂/贴顶（placeRedstone 走真实入口，f=2北3东4南5西1顶）
wall('红石火把·北墙',58,40,50,cfg.RTORCH_ITEM_ID,2);
wall('红石火把·东墙',59,40,50,cfg.RTORCH_ITEM_ID,3);
wall('红石火把·南墙',60,40,50,cfg.RTORCH_ITEM_ID,4);
wall('红石火把·西墙',61,40,50,cfg.RTORCH_ITEM_ID,5);
wall('按钮·北墙',62,40,50,cfg.BUTTON_ITEM_ID,2);
wall('按钮·东墙按下',63,40,50,cfg.BUTTON_ITEM_ID,3); sb(63,40,50,cfg.buttonId(3,1)); out.push({label:'按钮·东墙按下(直写)',box:measure(63,40,50)}); sb(63,40,50,BT.AIR);
wall('按钮·贴顶',64,40,50,cfg.BUTTON_ITEM_ID,1);
wall('拉杆·北墙开',65,40,50,cfg.LEVER_ITEM_ID,2); sb(65,40,50,cfg.leverId(2,1)); out.push({label:'拉杆·北墙开(直写)',box:measure(65,40,50)}); sb(65,40,50,BT.AIR);
wall('拉杆·东墙',66,40,50,cfg.LEVER_ITEM_ID,3);
wall('拉杆·南墙',67,40,50,cfg.LEVER_ITEM_ID,4);
wall('拉杆·西墙',68,40,50,cfg.LEVER_ITEM_ID,5);
wall('拉杆·贴顶',69,40,50,cfg.LEVER_ITEM_ID,1);
// 门：上下两格各量一次
door.tryPlaceDoor(72,40,48,0);
out.push({label:'门·下半',id:gb(72,40,48),box:measure(72,40,48)});
out.push({label:'门·上半',box:measure(72,41,48)});
sb(72,40,48,BT.AIR); sb(72,41,48,BT.AIR);
door.tryPlaceDoor(74,40,48,Math.PI/2); // facing 东
out.push({label:'门·东向下半',id:gb(74,40,48),box:measure(74,40,48)});
sb(74,40,48,BT.AIR); sb(74,41,48,BT.AIR);
// 活塞头：底座 facing 2(北) 伸出 → 头在底座北格
sb(78,40,48,cfg.pistonId(false,2,1)); ch.rebuildChunk(4,3);
out.push({label:'活塞头·朝北',id:gb(78,40,47),box:measure(78,40,47)});
sb(78,40,48,BT.AIR); sb(78,40,47,BT.AIR);
sb(80,40,48,cfg.pistonId(false,0,1)); ch.rebuildChunk(5,3);
out.push({label:'活塞头·朝上',id:gb(80,41,48),box:measure(80,41,48)});
sb(80,40,48,BT.AIR); sb(80,41,48,BT.AIR);
ch.rebuildChunk(4,3); ch.rebuildChunk(5,3);
return out;
""")
print(json.dumps(res, ensure_ascii=False, indent=1))
