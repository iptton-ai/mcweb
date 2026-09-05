# -*- coding: utf-8 -*-
"""E2E 验收驱动库（白盒注入式，见 skill browser-inject-e2e）。

用法：
    from lib import E2E
    e2e = E2E()                # 连接 CDP Chrome（--port 可选，默认 19401），打开游戏页
    res = e2e.run(js_body)     # 注入 async IIFE（自带模块导入前导），返回 dict
    e2e.close()

页面侧约定：每个用例体是一段 async JS，可用前导注入的
cfg/st/w/rs/ps/kn/it/itm/eng/um/ui/sg 模块对象与 gb/sb/sleep/pump 等助手，
最后 `return RESULT`（对象），驱动侧 JSON 化后带回。
"""

import json
import re
import sys

sys.path.insert(0, "/Users/zxnap/.agents/skills/browser-cdp/scripts")
from cdp import Page  # noqa: E402

BASE = "http://127.0.0.1:8000"

# 页面侧公共前导：每次 evaluate 自包含（skill 坑：不假设 window.__xxx 还在）
PREAMBLE = r"""
const B='%s/js/';
const [cfg,st,w,rs,ps,kn,it,itm,eng,um,ui,sg,door,bq,tn,pp]=await Promise.all([
 import(B+'config.js'),import(B+'state.js'),import(B+'world.js'),
 import(B+'redstone.js'),import(B+'piston.js'),import(B+'kinetic.js'),
 import(B+'interaction.js'),import(B+'items.js'),import(B+'engine.js'),
 import(B+'uiModal.js'),import(B+'ui.js'),import(B+'saveGame.js'),import(B+'door.js'),
 import(B+'buildQueue.js'),import(B+'tnt.js'),import(B+'playerPhysics.js')]);
const S=st.state, BT=cfg.BlockTypes, HB=cfg.HotbarBlocks, IT=cfg.ItemTypes;
const gb=(x,y,z)=>w.getBlock(Math.floor(x),Math.floor(y),Math.floor(z));
const sb=(x,y,z,t)=>w.setBlockSafe(Math.floor(x),Math.floor(y),Math.floor(z),t);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const LOG=[]; const log=(...a)=>LOG.push(a.map(v=>{try{return typeof v==='object'?JSON.stringify(v):String(v)}catch(e){return String(v)}}).join(' '));
// 平台：在 (x0..x0+wd, z0..z0+dp) 铺石板地板（y-1 层），清空上方 5 层空气
function platform(x0,z0,wd,dp,y){for(let x=x0;x<x0+wd;x++)for(let z=z0;z<z0+dp;z++){sb(x,y-1,z,BT.STONE);for(let yy=y;yy<y+5;yy++)sb(x,yy,z,BT.AIR);}}
// 手动泵：后台标签 rAF 节流时驱动 tick（红石/活塞/动力/掉落物），每步附带真实睡眠
async function pump(steps=1,dt=0.05,gapMs=50){for(let i=0;i<steps;i++){rs.updateRedstoneTick(dt);ps.updatePistonTick(dt);kn.updateKineticTick(dt);itm.updateItemDrops(dt);if(gapMs)await sleep(gapMs);}}
// rAF 是否在自跑（决定驱动方式：真实时间观察 vs 手动泵）
async function rafAlive(){const t0=S.time;await sleep(400);return S.time>t0+0.05;}
// tick：活检测 rAF（S.time 不前进=停摆）→ 手动泵兜底；rAF 健康时不泵、保真实时序
async function tick(n=1){for(let i=0;i<n;i++){const t0=S.time;await sleep(55);if(S.time-t0<0.025){rs.updateRedstoneTick(0.055);ps.updatePistonTick(0.055);kn.updateKineticTick(0.055);itm.updateItemDrops(0.055);}}}
// pumpIfStalled：游戏时间落后墙钟一半（rAF 节流/停摆）即按墙钟间隔补泵，保机器按真实速率运转
function pumpIfStalled(lastTRef,wallSec){const dt=S.time-lastTRef.v;if(dt<wallSec*0.5){rs.updateRedstoneTick(wallSec);ps.updatePistonTick(wallSec);kn.updateKineticTick(wallSec);itm.updateItemDrops(wallSec);}lastTRef.v=S.time;return lastTRef.v;}
async function pollSample(fn,ms,intervalMs=25){const out=[];const t0=Date.now();const lastT={v:S.time};while(Date.now()-t0<ms){out.push({t:Date.now()-t0,v:fn()});pumpIfStalled(lastT,intervalMs/1000);await sleep(intervalMs);}return out;}
const inv=k=>S.player.inventory[k]||0;
// 挂靠面法线对象（与 raycastBlocks 返回的 face 同构；索引同 FACING_NORMALS：0上1下2北3东4南5西）
const N=[{dx:0,dy:1,dz:0},{dx:0,dy:-1,dz:0},{dx:0,dy:0,dz:-1},{dx:1,dy:0,dz:0},{dx:0,dy:0,dz:1},{dx:-1,dy:0,dz:0}];
const clearSaves=()=>{Object.keys(localStorage).filter(k=>k.indexOf('mcweb.save')===0).forEach(k=>localStorage.removeItem(k));};
const setDay=()=>{S.time=Math.floor(S.time/600)*600+5;};
// 瞄准扫描：玩家站 (px,py,pz)，扫 yaw/pitch 直到 raycastBlocks 命中 (tx,ty,tz)，返回真实 hit
function aimScan(tx,ty,tz,px,py,pz){
  for(let pitch=-1.5;pitch<=1.5;pitch+=0.15){
    for(let yaw=-3.3;yaw<=3.3;yaw+=0.1){
      aimPlayer(px,py,pz,yaw,pitch);
      const hit=it.raycastBlocks();
      if(hit&&hit.x===tx&&hit.y===ty&&hit.z===tz)return {hit,yaw,pitch};
    }
  }
  return null;
}
// 物品实体字段名探测（itemId/item/id 三选一）
function dropId(d){return d&&('itemId'in d?d.itemId:('item'in d?d.item:('id'in d?d.id:undefined)));}
function dropsOf(id){return S.itemDrops.filter(d=>dropId(d)===id).reduce((s,d)=>s+(d.count||1),0);}
// 相机+玩家瞄准：以玩家 yaw/pitch 为准（rAF 下 gameLoop 会同步相机），返回 raycastBlocks 命中
function aimPlayer(px,py,pz,yaw,pitch){S.player.x=px;S.player.y=py;S.player.z=pz;S.player.yaw=yaw;S.player.pitch=pitch;S.player.vx=S.player.vy=S.player.vz=0;
  eng.camera.position.set(px,py+1.62,pz);eng.camera.rotation.set(pitch,yaw,0,'YXZ');}
""" % BASE


class E2E:
    def __init__(self, port=19401, nav=True):
        self.page = Page(port=port)
        if nav:
            self.page.nav(BASE + "/", settle=6.0)

    def raw_js(self, expr):
        r = self.page.js(expr)
        if r is None:
            return None
        if isinstance(r, dict) and "result" in r:
            return r["result"]
        return r

    def _front(self):
        try:
            self.page.cmd("Page.bringToFront")
        except Exception:
            pass

    def run(self, body, timeout_note=""):
        """注入用例体（async JS 片段），return RESULT 的对象被带回。"""
        self._front()
        wrapped = (
            "(async () => {\n" + PREAMBLE + "\n" + body +
            "\n})()"
        )
        out = self.page.cmd("Runtime.evaluate", {
            "expression": wrapped,
            "returnByValue": True,
            "awaitPromise": True,
        })
        if out.get("exceptionDetails"):
            ed = out["exceptionDetails"]
            desc = json.dumps(ed, ensure_ascii=False)[:2000]
            return {"__error__": desc}
        val = out.get("result", {}).get("value")
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except Exception:
                pass
        return val

    def js_str(self, body):
        """同 run，但要求用例体最后 return JSON.stringify(RESULT)（字符串通道更稳）。"""
        wrapped = ("(async () => {\n" + PREAMBLE + "\n" + body + "\n})()")
        r = self.page.js(wrapped)
        if isinstance(r, str):
            try:
                return json.loads(r)
            except Exception:
                return {"__raw__": r}
        if isinstance(r, dict) and "exceptionDetails" in r:
            return {"__error__": json.dumps(r)[:2000]}
        return r

    def fresh_page(self):
        """导航后强制重生成全新世界。
        注意：清 localStorage 不够——助手快照机制会在页面卸载/重载间恢复最近世界
        （行为正常，见 l1 复验记录），故 nav 后必须换随机种子 generateWorld。"""
        self.run("clearSaves(); return {ok:true};")
        self.page.nav(BASE + "/", settle=6.0)
        res = self.run(r"""
        document.getElementById('start-screen').click();
        await sleep(300);
        clearSaves();
        S.worldSeed=(Math.random()*0x7fffffff)|0;
        w.generateWorld();
        rs.initRedstone(); kn.initKinetic(); itm.clearItemDrops();
        if(ps.resetPistons)ps.resetPistons();
        S.player.x=64;S.player.y=40;S.player.z=64;S.player.vx=S.player.vy=S.player.vz=0;
        setDay();
        return {uiState: um.getUIState(), seed: S.worldSeed};
        """)

    def close(self):
        try:
            self.page.close()
        except Exception:
            pass


def report(name, res, checks):
    """checks: list of (label, ok_bool, evidence)。打印 PASS/FAIL 摘要。"""
    if not checks:
        print(f"\n===== {name}: FAIL（用例体异常，无断言结果） =====")
        if isinstance(res, dict):
            print("    ERROR:", json.dumps(res, ensure_ascii=False)[:800])
        return False
    all_ok = all(c[1] for c in checks)
    status = "PASS" if all_ok else "FAIL"
    print(f"\n===== {name}: {status} =====")
    for label, ok, ev in checks:
        print(f"  [{'OK ' if ok else 'FAIL'}] {label} :: {ev}")
    if isinstance(res, dict):
        for line in res.get("log", [])[:40]:
            print("    |", line)
        if "__error__" in res:
            print("    ERROR:", res["__error__"][:800])
    return all_ok
