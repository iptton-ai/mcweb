# -*- coding: utf-8 -*-
"""出题面板指针策略探针（2026-09-16 鼠标修复回归）。

用户报告：出题笔出题时鼠标不出现，按 Q 弹暂停菜单把面板挡住。
修复：出题面板接入非暂停浮层模式（state.authorPanelOpen + syncPointerPolicy）——
面板打开即释放鼠标；Q/Esc 关面板；关闭走自动回锁。

AP-01 面板打开：authorPanelOpen=true、uiState 保持 playing、无暂停/首屏浮层遮挡
AP-02 编辑态按 Q：面板收起、不进 pause、标志复位
AP-03 试答校验态按 Q：同上（verify 分支）
AP-04 走远巡检收面板：标志同步复位（关闭路径统一走 closeAuthorPanel）
AP-05 关面板后停留在 playing（可继续游戏，无「点击继续」卡死态）

跑法：cd tests/e2e && CDP_PORT=19401 python3 probe_author_pointer.py
"""

import json

import lib

PX = r"""
// —— 探针助手（照 W 套件：pressWin→window 捕获，pressDoc→document 冒泡） ——
const ek = await import(B+'eduKeypad.js');
const pressWin=(code)=>window.dispatchEvent(new KeyboardEvent('keydown',{code}));
const pressDoc=(code)=>document.dispatchEvent(new KeyboardEvent('keydown',{code}));
const teleport=(x,y,z)=>{S.player.x=x;S.player.y=y;S.player.z=z;S.player.vx=0;S.player.vy=0;S.player.vz=0;S.player.fallStartY=null;};
const overlayCovering=()=>{
  const scr=document.getElementById('start-screen');
  return !scr.classList.contains('hidden');  // start-screen 显示 = title/pause 浮层在场
};
async function scrubAnchors(){
  if(S.levelRun) S.levelRun=null;
  const W=cfg.WORLD_WIDTH,D=cfg.WORLD_DEPTH,H=cfg.WORLD_HEIGHT;
  const anch=(b)=>(b>=cfg.FLAG_BASE&&b<cfg.FLAG_BASE+cfg.FLAG_COUNT)
    ||(b>=cfg.KEYPAD_BASE&&b<cfg.KEYPAD_BASE+cfg.KEYPAD_COUNT);
  let n=0;
  for(let y=0;y<H;y++){const yb=y*W*D;
    for(let z=0;z<D;z++){const rb=yb+z*W;
      for(let x=0;x<W;x++){if(anch(S.blocks[rb+x])){S.blocks[rb+x]=0;n++;}}}}
  return n;
}
async function scene(){
  await scrubAnchors();
  setDay();
  platform(70,70,6,6,20);
  sb(72,20,72,cfg.KEYPAD_BASE);
  teleport(72.5,21,74.5);  // 锁旁 5 格内（走远巡检不误收）
}
const panelVisible=()=>document.getElementById('edu-author')
  && document.getElementById('edu-author').style.display==='block';
"""


def ap_01(e2e):
    """AP-01 面板打开即释放指针策略：标志置位、uiState 保持 playing、无浮层遮挡。"""
    res = e2e.run(PX + r"""
await scene();
const opened = ek.interactKeypadAuthorAt(72,20,72);
await sleep(120);  // 给 pointerlockchange / 走远巡检一个周期
return JSON.stringify({
  opened, panel: panelVisible(),
  flag: S.authorPanelOpen,
  ui: um.getUIState(),
  covered: overlayCovering(),
});
""")
    if not isinstance(res, dict) or "opened" not in res:
        return lib.report("AP-01 面板打开即释放鼠标", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("右键答题机打开出题面板", res["opened"] is True and res["panel"] is True,
         f"opened={res['opened']} panel={res['panel']}"),
        ("authorPanelOpen 标志置位（指针策略据此释放鼠标）", res["flag"] is True, str(res["flag"])),
        ("uiState 保持 playing（不弹暂停菜单）", res["ui"] == "playing", str(res["ui"])),
        ("无暂停/首屏浮层遮挡面板", res["covered"] is False, str(res["covered"])),
    ]
    return lib.report("AP-01 面板打开即释放鼠标", res, checks)


def ap_02(e2e):
    """AP-02 编辑态按 Q：关面板、不进 pause、标志复位（修复核心回归）。"""
    res = e2e.run(PX + r"""
await scene();
ek.interactKeypadAuthorAt(72,20,72);
await sleep(80);
pressDoc('KeyQ');  // window 捕获的作者面板分支应拦截（stopImmediatePropagation），input.js 收不到
await sleep(120);
return JSON.stringify({
  panel: panelVisible(), flag: S.authorPanelOpen,
  ui: um.getUIState(), covered: overlayCovering(),
});
""")
    if not isinstance(res, dict) or "panel" not in res:
        return lib.report("AP-02 编辑态按 Q 关面板", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("按 Q 面板收起", res["panel"] is False, str(res["panel"])),
        ("authorPanelOpen 标志复位（自动回锁链路生效）", res["flag"] is False, str(res["flag"])),
        ("uiState 保持 playing（Q 不再弹暂停菜单挡面板）", res["ui"] == "playing", str(res["ui"])),
        ("无暂停/首屏浮层", res["covered"] is False, str(res["covered"])),
    ]
    return lib.report("AP-02 编辑态按 Q 关面板", res, checks)


def ap_03(e2e):
    """AP-03 试答校验态按 Q：verify 分支同样关面板不弹菜单。"""
    res = e2e.run(PX + r"""
await scene();
ek.interactKeypadAuthorAt(72,20,72);
await sleep(80);
// 填题保存 → 进入试答态（照 W16：真 input 事件驱动表单委托）
const q=(sel)=>document.querySelector('#edu-author '+sel);
q('[data-field="stem"]').value='12+13';
q('[data-field="stem"]').dispatchEvent(new Event('input',{bubbles:true}));
q('[data-act="calc"]').click(); await sleep(120);
q('[data-act="save"]').click(); await sleep(120);
const mode = ek.__test_authoredMode ? ek.__test_authoredMode() : null;
// verify 态无 mode 探针：直接看面板在（保存成功即翻 verify）
const inVerify = panelVisible();
pressDoc('KeyQ');
await sleep(120);
return JSON.stringify({
  inVerify, panel: panelVisible(), flag: S.authorPanelOpen,
  ui: um.getUIState(), covered: overlayCovering(),
});
""")
    if not isinstance(res, dict) or "panel" not in res:
        return lib.report("AP-03 试答态按 Q 关面板", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("保存后进入试答态（面板在）", res["inVerify"] is True, str(res["inVerify"])),
        ("试答态按 Q 面板收起", res["panel"] is False, str(res["panel"])),
        ("authorPanelOpen 标志复位", res["flag"] is False, str(res["flag"])),
        ("uiState 保持 playing", res["ui"] == "playing", str(res["ui"])),
        ("无暂停/首屏浮层", res["covered"] is False, str(res["covered"])),
    ]
    return lib.report("AP-03 试答态按 Q 关面板", res, checks)


def ap_04(e2e):
    """AP-04 走远巡检收面板：编辑态面板存活（500ms 巡检不误收），走远后收起且标志复位。"""
    res = e2e.run(PX + r"""
await scene();
ek.interactKeypadAuthorAt(72,20,72);
await sleep(800);  // 覆盖 ≥1 个 500ms 走远巡检周期
const survived = panelVisible() && S.authorPanelOpen === true;
teleport(72.5, 21, 82.5);  // z 方向拉开 8 格 > 5 阈值
await sleep(1500);         // 巡检间隔 500ms（后台 tab 节流，多等一轮）
return JSON.stringify({
  survived, panel: panelVisible(), flag: S.authorPanelOpen,
  ui: um.getUIState(),
});
""")
    if not isinstance(res, dict) or "survived" not in res:
        return lib.report("AP-04 走远巡检收面板", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("锁旁不动：面板存活（巡检不误收）", res["survived"] is True, str(res["survived"])),
        ("走远 >5 格：面板收起", res["panel"] is False, str(res["panel"])),
        ("收起路径同步复位 authorPanelOpen", res["flag"] is False, str(res["flag"])),
        ("uiState 保持 playing", res["ui"] == "playing", str(res["ui"])),
    ]
    return lib.report("AP-04 走远巡检收面板", res, checks)


def main():
    e2e = lib.E2E(nav=True)
    try:
        # 干净开局（创意模式即可拿笔出题；与 W 套件同款 fresh 世界）
        e2e.fresh_page()
        ok = True
        for case in (ap_01, ap_02, ap_03, ap_04):
            if case(e2e) is False:
                ok = False
        print("\n==== 出题面板指针策略探针：%s ====" % ("全部 PASS" if ok else "存在 FAIL"))
    finally:
        e2e.close()


if __name__ == "__main__":
    main()
