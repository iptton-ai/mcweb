// 游戏画布录像：逻辑会话独立于编码尝试，启动失败自动换格式，不影响镜头与施工。
import { canvas, camera, renderer, scene } from './engine.js';
import { audioCtx, getRecAudioStream } from './audio.js';
import { renderViewmodel } from './viewmodel.js';
import { getBuildStatus } from './buildQueue.js';

let current = null;
const pending = new Set();
let latest = null;
let lastError = '';
let notify = () => {};
const MAX_SECONDS = 600;
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

export function initRecording(options) { notify = options.notify; }
export function isRecording() { return current !== null; }
export function isCamOwnedRecording() { return current?.owner === 'cam'; }
export function getRecordingStatus() {
    return { recording: !!current, owner: current?.owner || null,
        elapsedSec: current ? Math.floor((Date.now() - current.startedAt) / 1000) : 0,
        saving: pending.size > 0, hasDownload: !!latest, filename: latest?.name || '', error: lastError };
}

export function downloadRecording() {
    if (!latest) return;
    const a = document.createElement('a');
    a.href = latest.url;
    a.download = latest.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function clearTimers(session) {
    clearInterval(session.keepalive);
    clearTimeout(session.limit);
    clearTimeout(session.warning);
}

// 游戏完成世界与手部渲染后同步复制，避免 WebGL 清缓冲后抓到黑帧。
// 录像尺寸固定且为偶数，窗口缩放只改变黑边，不会中途改变编码器配置。
export function captureRecordingFrame() {
    if (current) copyFrame(current);
}
function copyFrame(session) {
    const { surface, ctx } = session;
    const scale = Math.min(surface.width / canvas.width, surface.height / canvas.height);
    const w = canvas.width * scale, h = canvas.height * scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, surface.width, surface.height);
    ctx.drawImage(canvas, (surface.width - w) / 2, (surface.height - h) / 2, w, h);
}

function disposeAttempt(attempt) {
    if (!attempt) return;
    const mr = attempt.mr;
    if (mr) {
        mr.ondataavailable = mr.onerror = mr.onstop = null;
        try { if (mr.state !== 'inactive') mr.stop(); } catch { /* 失败的编码器可能已经停止 */ }
    }
    attempt.stream?.getTracks().forEach(t => t.stop());
    attempt.chunks.length = 0;
}

function failSession(session, error) {
    if (current === session) current = null;
    session.stopped = true;
    session.finished = true; // 失败后迟到的 stop 事件不能覆盖最终错误或触发保存
    clearTimers(session);
    pending.delete(session);
    disposeAttempt(session.attempt);
    lastError = '当前浏览器的录像编码器无法启动，请更新浏览器或换用 Chrome / Edge 后重试';
    console.warn('录像编码失败，已尝试所有可用格式：', error);
    notify('⚠️ ' + lastError);
}

function finish(session, attempt, error = null) {
    if (session.finished || attempt !== session.attempt) return;
    session.finished = true;
    if (current === session) current = null;
    clearTimers(session);
    pending.delete(session);
    const mime = (attempt.mr.mimeType || attempt.mime || attempt.chunks[0]?.type || 'video/webm').split(';')[0];
    const blob = new Blob(attempt.chunks, { type: mime });
    disposeAttempt(attempt);
    if (!blob.size) {
        if (error) {
            lastError = '录制中断，未能生成录像，请重新开始';
            notify('⚠️ ' + lastError);
        } else notify('⚠️ 本次没有捕获到画面，请保持游戏页面可见后重试');
        return;
    }
    if (latest) URL.revokeObjectURL(latest.url);
    latest = { url: URL.createObjectURL(blob), name: session.name + (mime.includes('mp4') ? '.mp4' : '.webm') };
    downloadRecording();
    if (error) {
        lastError = '编码器中断，已尝试保存中断前的片段，请检查文件后重新录制';
        notify('⚠️ ' + lastError);
    } else notify(`🎬 录像已生成（${attempt.hasAudio ? '含游戏声音' : '无声'}）；未下载可点「保存上一段」`);
}

export function stopRecording() {
    if (!current) return;
    const session = current;
    current = null;
    session.stopped = true; // 异步 error 迟到时不能重新开录
    clearTimers(session);
    const attempt = session.attempt;
    pending.add(session);
    try {
        if (attempt.mr.state !== 'inactive') attempt.mr.stop();
        // 已 inactive 时仍需等待标准事件顺序 error → dataavailable → stop，保留最后数据块。
    } catch (error) { finish(session, attempt, error); }
}

function tryNextAttempt(session) {
    if (current !== session || session.stopped) return false;
    while (session.next < session.candidates.length) {
        const mime = session.candidates[session.next++];
        const attempt = { mime, mr: null, stream: null, chunks: [], hasAudio: false, error: null };
        session.attempt = attempt;
        try {
            attempt.stream = session.surface.captureStream(30);
            // 每次编码尝试也使用音轨副本，失败重试不破坏全局声音输出。
            if (audioCtx?.state === 'running') {
                try { getRecAudioStream()?.getAudioTracks().forEach(t => attempt.stream.addTrack(t.clone())); }
                catch { /* 音频不可用时仍能录像 */ }
            }
            attempt.hasAudio = attempt.stream.getAudioTracks().length > 0;
            // 不固定 H.264 profile/level 或码率，让浏览器选择实际可用的编码配置。
            const mr = new MediaRecorder(attempt.stream, mime ? { mimeType: mime } : undefined);
            attempt.mr = mr;
            mr.ondataavailable = e => { if (e.data.size) attempt.chunks.push(e.data); };
            mr.onerror = e => {
                if (attempt !== session.attempt || session.finished) return;
                attempt.error = e.error || new Error('录像编码失败');
                if (session.stopped) return;
                if (!attempt.chunks.length) {
                    // isTypeSupported 只代表格式声明支持；实际编码可能到首帧才异步失败。
                    disposeAttempt(attempt);
                    if (tryNextAttempt(session)) notify('🎬 已自动切换兼容格式，继续录制');
                } else {
                    // 已录到画面后不静默丢弃整段去重试；等待 stop 的最后数据块后保存已有片段。
                    if (current === session) current = null;
                    session.stopped = true;
                    clearTimers(session);
                    pending.add(session);
                }
            };
            mr.onstop = () => finish(session, attempt, attempt.error);
            mr.start(1000);
            return true;
        } catch (error) {
            session.lastFailure = error;
            disposeAttempt(attempt);
        }
    }
    failSession(session, session.lastFailure || session.attempt?.error);
    return false;
}

export function toggleBuildRecording(source = 'user') {
    if (current) { stopRecording(); return false; }
    lastError = '';
    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
        lastError = '当前浏览器不支持游戏录像，请使用新版 Chrome、Edge 或 Safari';
        notify('⚠️ ' + lastError);
        return false;
    }
    let session;
    try {
        const surface = document.createElement('canvas');
        const scale = Math.min(1, MAX_WIDTH / canvas.width, MAX_HEIGHT / canvas.height);
        surface.width = Math.max(2, Math.floor(canvas.width * scale / 2) * 2);
        surface.height = Math.max(2, Math.floor(canvas.height * scale / 2) * 2);
        const ctx = surface.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('无法创建录像画布');
        // MP4 优先；失败后先试兼容性较好的 VP8，最后让浏览器自己选择。
        const hasAudio = audioCtx?.state === 'running';
        const formats = ['video/mp4', hasAudio ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8',
            'video/webm', hasAudio ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9'];
        const candidates = formats.filter(m => MediaRecorder.isTypeSupported(m));
        candidates.push('');
        const status = getBuildStatus();
        const label = (status.active ? status.label : '游戏录像') || '游戏录像';
        const name = label.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 32) + '-'
            + new Date().toISOString().replace(/[:.]/g, '-');
        session = { surface, ctx, name, candidates, next: 0, attempt: null, stopped: false, finished: false,
            owner: source === 'cam' ? 'cam' : 'user', startedAt: Date.now() };
        current = session;
        renderer.render(scene, camera);
        renderViewmodel(renderer);
        copyFrame(session);
        if (!tryNextAttempt(session)) return false;
        // 捕获流创建之后再送一帧，首帧足以触发编码器检查，无需等用户移动。
        copyFrame(session);
        session.keepalive = setInterval(() => {
            if (current !== session) return;
            renderer.render(scene, camera);
            renderViewmodel(renderer);
            copyFrame(session);
        }, 500);
        session.limit = setTimeout(() => {
            if (current !== session) return;
            stopRecording();
            notify('⏹ 已达到 10 分钟上限，正在保存录像');
        }, MAX_SECONDS * 1000);
        session.warning = setTimeout(() => {
            if (current === session && !session.attempt.chunks.length) notify('⚠️ 暂未捕获画面，请保持游戏页面可见');
        }, 4000);
        notify(`● 录制中 · R 停止并保存 · ${session.attempt.hasAudio ? '含游戏声音' : '无声'} · 最长 10 分钟`);
        return true;
    } catch (error) {
        if (session) failSession(session, error);
        else { lastError = '无法创建录像画面，请刷新页面后重试'; notify('⚠️ ' + lastError); }
        return false;
    }
}

window.addEventListener('pagehide', () => {
    stopRecording();
    if (latest) URL.revokeObjectURL(latest.url);
    latest = null;
});
