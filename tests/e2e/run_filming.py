# -*- coding: utf-8 -*-
"""拍摄交互回归：常驻入口、连续切镜、构图、自动会话边界与录像资源隔离。
运行：E2E_BASE=http://127.0.0.1:8046 CDP_PORT=19416 python3 tests/e2e/run_filming.py
"""
import json
import sys
import lib

BODY = r"""
const cam = await import(B+'cameraRig.js');
const rec = await import(B+'recording.js');
const audio = await import(B+'audio.js');
const THREE = await import('three');
const checks=[];
function check(name, ok, value=''){checks.push([name,!!ok,value]);}
function clean(){rec.stopRecording();cam.resetBuildFilming();bq.clearBuildQueue();bq.setAgentHold(false);S.buildPaused=false;S.buildAutoRecord=true;}
const click=id=>document.getElementById(id).click();
const key=(code,target=document)=>target.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,cancelable:true}));
clean();
um.setState('pause'); ui.updateBuildWidget();
check('无施工暂停菜单仍有录像入口',document.getElementById('recording-panel').getBoundingClientRect().width>0);
check('按钮明确显示开始录制',document.getElementById('build-rec').textContent.includes('开始录制'));
const textarea=document.createElement('textarea');document.body.appendChild(textarea);textarea.focus();
key('KeyR',textarea);check('聊天输入R不触发录像',!rec.isRecording());textarea.remove();
click('build-auto-record');
check('关闭施工自动录制持久化',!S.buildAutoRecord&&localStorage.getItem('mcweb.buildAutoRecord')==='false');
const ops=[[38,55,38,BT.STONE],[48,62,48,BT.STONE]];
S.buildPaused=true;bq.enqueueBuildOps('验收建筑',ops);cam.updateBuildFilming(0.05);
check('关闭自动录制后开工不抢镜不录',!rec.isRecording()&&S.camMode==='player');
clean();
S.buildPaused=true;
bq.enqueueBuildOps('验收建筑',ops);cam.updateBuildFilming(0.05);
check('AI开工自动全景开录',S.camMode==='build'&&rec.isCamOwnedRecording());
eng.camera.updateMatrixWorld();const q=eng.camera.quaternion.clone(), pos=eng.camera.position.clone();
click('camera-manual');cam.updateCameraRig(0);
check('手动接管位置连续',eng.camera.position.distanceTo(pos)<0.001,eng.camera.position.distanceTo(pos));
check('手动接管方向连续',Math.abs(eng.camera.quaternion.dot(q))>0.99999,eng.camera.quaternion.dot(q));
check('切手动保持同段自动录像',rec.isCamOwnedRecording());
click('camera-player');check('切玩家也不停录',rec.isCamOwnedRecording()&&S.camMode==='player');
click('camera-auto');check('可一键返回自动取景',rec.isCamOwnedRecording()&&S.camMode==='build');
rec.stopRecording();cam.updateBuildFilming(0.1);
check('手动停止后本次施工不强制重开',!rec.isRecording());
// 跨轮次等待：队列清空但 agentHold 为 true，即使超过旧 60 秒也不提前收尾。
bq.clearBuildQueue();bq.setAgentHold(true);cam.updateBuildFilming(61);
check('AI跨轮等待不算完成',cam.getBuildFilmingStatus().active&&cam.getBuildFilmingStatus().waiting);
bq.enqueueBuildOps('第二批',[[70,60,70,BT.STONE]]);cam.updateBuildFilming(0.1);
check('跨批次范围累积',cam.getBuildFilmingStatus().bounds.minX===38&&cam.getBuildFilmingStatus().bounds.maxX===70);
rec.toggleBuildRecording();
bq.clearBuildQueue();bq.setAgentHold(false);cam.setCamMode('free');
cam.updateBuildFilming(2);check('未满展示时间不收尾',cam.getBuildFilmingStatus().active);
cam.updateBuildFilming(2.1);
check('手动录像不被自动收尾停掉',rec.isRecording()&&!rec.isCamOwnedRecording());
check('用户选择手动镜头收尾后保留',S.camMode==='free');
rec.stopRecording();await sleep(300);
// 自动录像正常完成停止，无需用户手动结束。
clean();S.buildPaused=true;bq.enqueueBuildOps('自动收尾',ops);cam.updateBuildFilming(0.1);
bq.clearBuildQueue();cam.updateBuildFilming(4.1);
check('自动录像收尾停止并返回玩家',!rec.isRecording()&&S.camMode==='player');
await sleep(300);
// 高建筑与宽建筑使用真实投影，验证每个包围盒角都位于画面内。
const oldFov=eng.camera.fov,oldAspect=eng.camera.aspect;
for(const [name,pts,fov,aspect] of [
 ['宽建筑窄屏',[[8,52,8],[120,58,100]],45,0.65],
 ['高塔宽屏',[[50,2,50],[58,62,58]],95,1.9],
 ['常规建筑',[[30,35,30],[64,62,64]],65,1.6]]){
 clean();S.buildAutoRecord=false;S.buildPaused=true;
 bq.enqueueBuildOps(name,pts.map(v=>[...v,BT.STONE]));cam.updateBuildFilming(0.1);
 eng.camera.fov=fov;eng.camera.aspect=aspect;eng.camera.updateProjectionMatrix();cam.setCamMode('build');cam.updateCameraRig(0.1);
 const b=cam.getBuildFilmingStatus().bounds;let max=0;let depth=true;
 for(const x of [b.minX,b.maxX+1])for(const y of [b.minY,b.maxY+1])for(const z of [b.minZ,b.maxZ+1]){
  const p=new THREE.Vector3(x,y,z).project(eng.camera);max=Math.max(max,Math.abs(p.x),Math.abs(p.y));depth=depth&&p.z>-1&&p.z<1;
 }
 check(name+'八角在画面内',max<0.99&&depth,{max,depth});
}
eng.camera.fov=oldFov;eng.camera.aspect=oldAspect;eng.camera.updateProjectionMatrix();clean();
// Tab 解锁不暂停，第二次 Tab 回到操作，开关型键忽略自动重复。
um.setState('playing');key('Tab');
check('Tab释放鼠标且不切暂停状态',S.recordingControlsOpen&&um.getUIState()==='playing');
key('Tab');check('第二次Tab关闭面板操作',!S.recordingControlsOpen);
// 已经在录游戏时 AI 开工不能突然抢镜。
clean();S.buildPaused=true;cam.setCamMode('free');rec.toggleBuildRecording();
bq.enqueueBuildOps('不抢镜验证',ops);cam.updateBuildFilming(.1);
check('已有游戏录像时AI开工不抢镜',S.camMode==='free'&&rec.isRecording()&&!rec.isCamOwnedRecording());
clean();await sleep(200);
// 真实音轨副本：连续录两条不会 stop 掉共享音源。
if(audio.audioCtx?.state==='suspended')await Promise.race([audio.audioCtx.resume(),sleep(500)]);
const shared=audio.getRecAudioStream()?.getAudioTracks()[0];
rec.toggleBuildRecording();await sleep(500);rec.stopRecording();
rec.toggleBuildRecording();await sleep(600);
check('快速停开旧收尾不停止新录像',rec.isRecording());
check('连续录像共享音轨仍live',shared?.readyState==='live',shared?.readyState);
rec.stopRecording();await sleep(500);
check('完成后保留手动下载入口',rec.getRecordingStatus().hasDownload);
// 确认不支持环境能回退，启动失败不会把录制状态卡住。
const original=window.MediaRecorder;window.MediaRecorder=undefined;
check('不支持录像时安全返回',rec.toggleBuildRecording()===false&&!rec.isRecording());
window.MediaRecorder=original;
// 临时世界里的真实重开入口必须同时清理施工会话与游戏录像。
clean();S.buildPaused=true;bq.enqueueBuildOps('切世界清理',ops);cam.updateBuildFilming(.1);
rec.stopRecording();rec.toggleBuildRecording();um.setState('pause');click('btn-creative');click('btn-creative');
check('新世界结束录像并清空施工会话',!rec.isRecording()&&!cam.getBuildFilmingStatus().active&&!bq.getBuildStatus().active&&S.camMode==='player');
localStorage.setItem('mcweb.buildAutoRecord','true');clean();um.setState('pause');ui.updateBuildWidget();
return {checks};
"""

if __name__ == '__main__':
    e2e=lib.E2E()
    try:
        e2e.page.cmd('Browser.setDownloadBehavior',{'behavior':'deny'})
        e2e.fresh_page()
        result=e2e.run(BODY)
        checks=result.get('checks',[]) if isinstance(result,dict) else []
        ok=lib.report('FILM 拍摄交互回归',result,checks)
    finally:
        e2e.close()
    sys.exit(0 if ok else 1)
