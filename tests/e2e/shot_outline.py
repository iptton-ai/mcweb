# -*- coding: utf-8 -*-
"""视觉验收截图：墙挂件贴墙 + 小道具黑框缩小。输出 /tmp/outline_shot_*.png"""

import base64

import lib

e2e = lib.E2E()
boot = e2e.run(r"""
clearSaves();
um.setState('playing');
S.player.x=58; S.player.y=41; S.player.z=60;
setDay(); S.gameMode='creative';
platform(58,60,10,8,40); // x58..67 z60..67
// 地面小件一排（z=62）：压力板/红石粉/拉杆/火把/按钮/传送带
sb(60,40,62,cfg.plateId(0));
rs.placeRedstone(61,40,62,cfg.DUST_ITEM_ID,N[0]);
rs.placeRedstone(62,40,62,cfg.LEVER_ITEM_ID,N[0]);
sb(63,40,62,BT.TORCH);
rs.placeRedstone(64,40,62,cfg.BUTTON_ITEM_ID,N[0]);
sb(65,40,62,cfg.beltId(0));
// 石墙 z=65，北面挂红石火把/按钮/拉杆；门一扇
for(let x=59;x<=65;x++) sb(x,40,65,BT.STONE);
rs.placeRedstone(60,40,64,cfg.RTORCH_ITEM_ID,N[2]);
rs.placeRedstone(61,40,64,cfg.BUTTON_ITEM_ID,N[2]);
rs.placeRedstone(62,40,64,cfg.LEVER_ITEM_ID,N[2]);
door.tryPlaceDoor(64,40,64,0);
return {ok:true};
""")


def shot(name):
    out = e2e.page.cmd("Page.captureScreenshot", {"format": "png"})
    data = out.get("data") or out.get("result", {}).get("data")
    with open(f"/tmp/{name}.png", "wb") as f:
        f.write(base64.b64decode(data))
    print(f"saved /tmp/{name}.png")


# 机位 1：斜俯视全景（墙挂件贴墙 + 地面小件）
e2e.run(r"""
const T=await import('three');
eng.camera.position.set(57.5,43.5,60.5);
eng.camera.rotation.set(-0.42, Math.atan2(-(62.5-57.5), -(64.5-60.5)), 0, 'YXZ');
S.player.x=57.5; S.player.y=41; S.player.z=60.5;
return {};
""")
shot("outline_shot_overview")

# 机位 2：玩家视点瞄准压力板（黑框应缩小为薄板框）
e2e.run(r"""
const T=await import('three');
function lookAtEye(ex,ey,ez,tx,ty,tz){
  const d=new T.Vector3(tx-ex,ty-ey,tz-ez).normalize();
  aimPlayer(ex,ey-1.62,ez,Math.atan2(-d.x,-d.z),Math.asin(d.y));
}
lookAtEye(60.5,40.62,61.0, 60.5,40.035,62.5);
await sleep(400);
return {};
""")
shot("outline_shot_plate")

# 机位 3：瞄准墙挂按钮
e2e.run(r"""
const T=await import('three');
function lookAtEye(ex,ey,ez,tx,ty,tz){
  const d=new T.Vector3(tx-ex,ty-ey,tz-ez).normalize();
  aimPlayer(ex,ey-1.62,ez,Math.atan2(-d.x,-d.z),Math.asin(d.y));
}
lookAtEye(61.5,40.62,62.5, 61.5,40.5,64.95);
await sleep(400);
return {};
""")
shot("outline_shot_button")
e2e.close()
