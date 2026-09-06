# -*- coding: utf-8 -*-
"""拍摄功能截图与真键盘探针，使用隔离测试浏览器；生成 docs/qa/recording-20260906。"""
import base64
from pathlib import Path
import lib
out=Path(__file__).resolve().parents[2]/'docs/qa/recording-20260906'
out.mkdir(parents=True,exist_ok=True)
e=lib.E2E()
try:
 e.page.cmd('Browser.setDownloadBehavior',{'behavior':'deny'})
 e.page.cmd('Emulation.setDeviceMetricsOverride',{'width':1280,'height':800,'deviceScaleFactor':1,'mobile':False})
 e.fresh_page()
 print(e.run(r'''
 const cam=await import(B+'cameraRig.js');
 const rec=await import(B+'recording.js');
 um.setState('playing');um.setRecordingControlsOpen(true);S.player.flying=true;
 S.time=300;S.buildAutoRecord=false;
 const ops=[];const y=44;
 for(let x=43;x<=69;x++)for(let z=43;z<=64;z++)for(let yy=y;yy<64;yy++)w.setBlockSafe(x,yy,z,BT.AIR);
 (await import(B+'chunk.js')).updateChunkMeshes();
 for(let x=45;x<67;x++)for(let z=45;z<62;z++){
  ops.push([x,y,z,BT.STONE]);
  if(x<47||x>64||z<47||z>59)continue;
  for(let yy=y+1;yy<=y+7;yy++){
   const edge=x===47||x===64||z===47||z===59;
   if(edge)ops.push([x,yy,z,yy>=y+3&&yy<=y+5&&x%5!==0&&z%5!==0?BT.GLASS:BT.WOOD]);
  }
  ops.push([x,y+8,z,BT.COBBLESTONE]);
 }
 bq.enqueueBuildOps('林间观景屋',ops);S.buildPaused=false;bq.setBuildSpeedByBps(200);
 for(let i=0;i<100;i++)bq.updateBuild(.1);
 cam.resetBuildFilming();S.buildAutoRecord=true;bq.setAgentHold(true);
 const next=[];for(let x=47;x<=64;x++)for(let z=47;z<=59;z++)next.push([x,y+9,z,BT.WOOD]);
 bq.enqueueBuildOps('林间观景屋 · 屋顶',next);S.buildPaused=true;cam.updateBuildFilming(.1);
 // 合并房屋完整范围，保证截图体现完整建筑而非只取屋顶。
 bq.enqueueBuildOps('林间观景屋 · 外墙检查',[[45,y,45,BT.STONE],[66,y+9,61,BT.WOOD]]);cam.updateBuildFilming(.1);
 cam.updateCameraRig(.1);
 (await import(B+'daynight.js')).updateDayNightCycle(0);
 ui.updateBuildWidget();eng.renderer.render(eng.scene,eng.camera);await sleep(1800);
 return {mode:S.camMode,recording:rec.isRecording(),status:document.getElementById('record-status').textContent};
 '''))
 def shot(name):
  r=e.page.cmd('Page.captureScreenshot',{'format':'png'})
  (out/name).write_bytes(base64.b64decode(r['data']))
 shot('01-auto.png')
 # 真键盘验证：Tab 从面板回画面锁鼠标，再 Tab 解锁且不弹暂停菜单。
 def tab():
  e.page.cmd('Input.dispatchKeyEvent',{'type':'keyDown','key':'Tab','code':'Tab','windowsVirtualKeyCode':9})
  e.page.cmd('Input.dispatchKeyEvent',{'type':'keyUp','key':'Tab','code':'Tab','windowsVirtualKeyCode':9})
 tab()
 first=e.run('const until=Date.now()+3000;while(!um.mouseLocked&&Date.now()<until)await sleep(50);return {locked:um.mouseLocked,controls:S.recordingControlsOpen,state:um.getUIState()};')
 tab()
 second=e.run('await sleep(200);return {locked:um.mouseLocked,controls:S.recordingControlsOpen,state:um.getUIState()};')
 print({'realTabLock':first,'realTabUnlock':second})
 assert first['locked'] and not first['controls'] and second['controls'] and not second['locked'] and second['state']=='playing'

 print(e.run(r'''
 const cam=await import(B+'cameraRig.js');cam.setCamMode('free');cam.updateCameraRig(0);ui.updateBuildWidget();eng.renderer.render(eng.scene,eng.camera);
 return {mode:S.camMode,recording:ui.isRecording()};
 '''))
 shot('02-manual.png')
 print(e.run(r'''
 const rec=await import(B+'recording.js');const cam=await import(B+'cameraRig.js');
 rec.stopRecording();cam.resetBuildFilming();bq.clearBuildQueue();bq.setAgentHold(false);
 S.player.x=78;S.player.y=62;S.player.z=78;S.player.yaw=.7;S.player.pitch=-.3;
 um.setState('pause');ui.updateBuildWidget();await sleep(1800);return {ok:true};
 '''))
 shot('03-idle-menu.png')
 e.page.cmd('Emulation.setDeviceMetricsOverride',{'width':640,'height':800,'deviceScaleFactor':1,'mobile':False})
 print(e.run(r'''
 um.setState('playing');um.setRecordingControlsOpen(true);ui.updateBuildWidget();await sleep(1000);ui.updateBuildWidget();
 const r=document.getElementById('recording-panel').getBoundingClientRect();return {rect:{x:r.x,y:r.y,w:r.width,h:r.height},vw:innerWidth};
 '''))
 shot('04-narrow.png')
finally:e.close()
