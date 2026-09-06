# -*- coding: utf-8 -*-
"""编码器回归：注入启动失败后使用真实后备编码器，验证成片、尺寸和取消重试。"""
import sys
import lib

BODY = r"""
const rec=await import(B+'recording.js');
S.buildAutoRecord=false;um.setState('playing');um.setRecordingControlsOpen(true);
const Native=window.MediaRecorder;
const originalURL=URL.createObjectURL;
const blobs=[];const calls=[];const failedTracks=[];const checks=[];
const check=(name,ok,value='')=>checks.push([name,!!ok,value]);
URL.createObjectURL=b=>{if(b.type?.startsWith('video/'))blobs.push(b);return originalURL.call(URL,b);};
let mode='async-mp4';
// 声明支持，但首帧初始化编码器时报错，模拟用户设备。
class RejectedRecorder {
 constructor(stream,options){this.stream=stream;this.mimeType=options?.mimeType||'';this.state='inactive';failedTracks.push(...stream.getTracks());}
 start(){
  if(mode==='sync-start')throw new DOMException('unsupported encoder configuration','NotSupportedError');
  this.state='recording';
  const lateStop=this.onstop;
  setTimeout(()=>{
   this.state='inactive';
   this.onerror?.({error:new DOMException('The given encoder configuration is not supported by the encoder.','NotSupportedError')});
   // 旧 stop 事件晚到，新录像仍应继续。
   setTimeout(()=>lateStop?.(),150);
  },80);
 }
 stop(){this.state='inactive';setTimeout(()=>this.onstop?.(),0);}
}
class Recorder {
 static isTypeSupported(){return true;}
 constructor(stream,options){
  const mime=options?.mimeType||'';calls.push(mime);
  if(mode==='sync-constructor'&&mime==='video/mp4')throw new DOMException('unsupported configuration','NotSupportedError');
  if(mode==='all-fail'||mode==='cancel'||((mode==='async-mp4'||mode==='sync-start')&&mime==='video/mp4'))return new RejectedRecorder(stream,options);
  return new Native(stream,options);
 }
}
async function stopAndBlob(){rec.stopRecording();for(let i=0;i<100&&rec.getRecordingStatus().saving;i++)await sleep(30);return blobs.at(-1);}
async function dimensions(blob){
 const url=originalURL.call(URL,blob),v=document.createElement('video');v.muted=true;v.src=url;
 await Promise.race([new Promise(r=>{v.onloadedmetadata=r;v.onerror=r;}),sleep(2000)]);
 if(!Number.isFinite(v.duration)){v.currentTime=1e9;await Promise.race([new Promise(r=>v.onseeked=r),sleep(1000)]);}
 const result={w:v.videoWidth,h:v.videoHeight,duration:v.duration,error:!!v.error};
 v.removeAttribute('src');v.load();URL.revokeObjectURL(url);return result;
}
try{
 window.MediaRecorder=Recorder;
 eng.renderer.setPixelRatio(2);eng.renderer.setSize(1601,901,false);
 check('用户开始自动录像',rec.toggleBuildRecording('cam'));
 await sleep(400);
 check('MP4异步初始化失败自动换WebM',calls[0]==='video/mp4'&&calls[1]?.includes('vp8'),calls.slice());
 check('重试仍保留自动录像所有权',rec.isCamOwnedRecording());
 check('失败尝试的轨道全部释放',failedTracks.every(t=>t.readyState==='ended'));
 // 已开始录像时改变画布尺寸，最终视频分辨率仍固定。
 eng.renderer.setPixelRatio(1);eng.renderer.setSize(777,555,false);
 await sleep(1400);
 check('旧stop回调及窗口缩放不停止新录像',rec.isRecording());
 const blob=await stopAndBlob();const video=await dimensions(blob);
 check('回退成片真实可解码',blob?.size>10000&&!video.error&&video.w>0,{size:blob?.size,...video});
 check('高DPI录像限制1080p并保持偶数固定尺寸',video.w===1918&&video.h===1080,video);
 check('成片扩展名跟随实际格式',rec.getRecordingStatus().filename.endsWith('.webm'));
 check('失败尝试没有额外废片',blobs.length===1,blobs.length);
 for(const kind of ['sync-constructor','sync-start']){
  mode=kind;calls.length=0;rec.toggleBuildRecording();await sleep(600);
  check(kind+'失败自动使用后备编码器',rec.isRecording()&&calls[1]?.includes('vp8'),calls.slice());
  await stopAndBlob();
 }
 mode='all-fail';calls.length=0;const before=blobs.length;rec.toggleBuildRecording();await sleep(900);
 check('所有候选失败后有界退出',!rec.isRecording()&&!rec.getRecordingStatus().saving&&calls.length===5,calls.slice());
 check('失败不产生垃圾下载',blobs.length===before);
 check('全部失败提供中文说明而非内部配置报错',rec.getRecordingStatus().error.includes('当前浏览器'));
 mode='cancel';calls.length=0;rec.toggleBuildRecording();rec.stopRecording();await sleep(350);
 check('用户停止后迟到错误不能重开录像',!rec.isRecording()&&!rec.getRecordingStatus().saving&&calls.length===1,calls.slice());
}finally{
 rec.stopRecording();window.MediaRecorder=Native;URL.createObjectURL=originalURL;
 eng.renderer.setPixelRatio(Math.min(devicePixelRatio,2));eng.renderer.setSize(innerWidth,innerHeight);
}
return {checks};
"""
if __name__=='__main__':
 e=lib.E2E()
 try:
  e.page.cmd('Browser.setDownloadBehavior',{'behavior':'deny'})
  e.fresh_page()
  result=e.run(BODY)
  ok=lib.report('ENCODER 编码器回退',result,result.get('checks',[]) if isinstance(result,dict) else [])
 finally:e.close()
 sys.exit(0 if ok else 1)
