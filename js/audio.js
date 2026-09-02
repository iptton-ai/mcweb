// ==================== audio.js ====================

// ==================== 音效生成 ====================
export let audioCtx = null;

// 全部声音（音效 + BGM）都接到这个主输出再出扬声器，录像从这里分一条音轨合成进 webm
let masterOut = null;
let recDest = null;

// 音效专用总线：与 BGM 分开调音量（设置浮层「🎵 音频」页），最终都汇入主输出，
// 录像分轨照常带上全部声音
let sfxBus = null;
const SFX_VOL_KEY = 'mcweb.sfx.vol';
const _storedSfx = localStorage.getItem(SFX_VOL_KEY);
let sfxVol = _storedSfx === null ? 1 : Number(_storedSfx); // Number(null)===0，需先判空
if (!Number.isFinite(sfxVol)) sfxVol = 1;
sfxVol = Math.min(1, Math.max(0, sfxVol));

export function getSfxOut() {
    if (!audioCtx) return null;
    if (!sfxBus) {
        sfxBus = audioCtx.createGain();
        sfxBus.gain.value = sfxVol;
        sfxBus.connect(getMasterOut());
    }
    return sfxBus;
}

export function getSfxVolume() {
    return sfxVol;
}

export function setSfxVolume(v) {
    sfxVol = Math.min(1, Math.max(0, Number(v) || 0));
    localStorage.setItem(SFX_VOL_KEY, String(sfxVol));
    if (sfxBus) sfxBus.gain.value = sfxVol;
}

export function getMasterOut() {
    if (!audioCtx) return null;
    if (!masterOut) {
        masterOut = audioCtx.createGain();
        masterOut.connect(audioCtx.destination);
    }
    return masterOut;
}

// 录像用音轨：MediaRecorder 把这条 MediaStream 合进 webm（音频栈不可用时返回 null，降级为无声视频）
export function getRecAudioStream() {
    const mo = getMasterOut();
    if (!mo) return null;
    if (!recDest) recDest = audioCtx.createMediaStreamDestination();
    mo.connect(recDest); // 同一对节点的重复 connect 按规范忽略，重复调用无副作用
    return recDest.stream;
}

export function initAudio() {
    try {
        audioCtx = new(window.AudioContext || window.webkitAudioContext)();
        getMasterOut(); // 主输出随上下文一起建好，后续 BGM/录像分轨直接取
    } catch (e) {
        audioCtx = null;
    }
}

export function playBlockSound(isPlace) {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(getSfxOut());
        if (isPlace) {
            osc.frequency.setValueAtTime(180, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(90, audioCtx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        } else {
            osc.frequency.setValueAtTime(120, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.06);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
        }
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.1);
    } catch (e) {}
}

export function playHitSound() {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(getSfxOut());
        osc.type = 'square';
        osc.frequency.setValueAtTime(300, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) {}
}

// 门开关音：短促「咔嗒」，开门音调上扬、关门下沉
export function playDoorSound(isOpen) {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.connect(gain);
        gain.connect(getSfxOut());
        const t0 = audioCtx.currentTime;
        if (isOpen) {
            osc.frequency.setValueAtTime(160, t0);
            osc.frequency.exponentialRampToValueAtTime(330, t0 + 0.09);
        } else {
            osc.frequency.setValueAtTime(330, t0);
            osc.frequency.exponentialRampToValueAtTime(160, t0 + 0.09);
        }
        gain.gain.setValueAtTime(0.12, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
        osc.start(t0);
        osc.stop(t0 + 0.13);
    } catch (e) {}
}

// 拉杆音：干脆的「咔哒」，开高闭低
export function playLeverSound(isOn) {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.connect(gain);
        gain.connect(getSfxOut());
        const t0 = audioCtx.currentTime;
        osc.frequency.setValueAtTime(isOn ? 520 : 300, t0);
        osc.frequency.exponentialRampToValueAtTime(isOn ? 760 : 180, t0 + 0.05);
        gain.gain.setValueAtTime(0.14, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
        osc.start(t0);
        osc.stop(t0 + 0.09);
    } catch (e) {}
}

// 活塞音：气动「嘶—嗒」，伸出上扬、收回下沉（原版是蒸汽嘶声 + 机械落位）
export function playPistonSound(isExtend) {
    if (!audioCtx) return;
    try {
        const t0 = audioCtx.currentTime;
        // 嘶声（短噪声）
        const bufferSize = Math.floor(audioCtx.sampleRate * 0.06);
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.5);
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        const ng = audioCtx.createGain();
        ng.gain.setValueAtTime(0.1, t0);
        ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
        noise.connect(ng);
        ng.connect(getSfxOut());
        noise.start(t0);
        // 落位「嗒」
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.connect(gain);
        gain.connect(getSfxOut());
        osc.frequency.setValueAtTime(isExtend ? 190 : 240, t0 + 0.04);
        osc.frequency.exponentialRampToValueAtTime(isExtend ? 130 : 110, t0 + 0.1);
        gain.gain.setValueAtTime(0.14, t0 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
        osc.start(t0 + 0.04);
        osc.stop(t0 + 0.13);
    } catch (e) {}
}

export function playExplosionSound() {
    if (!audioCtx) return;
    try {
        const bufferSize = audioCtx.sampleRate * 0.5;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2.2);
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
        noise.connect(gain);
        gain.connect(getSfxOut());
        noise.start(audioCtx.currentTime);
    } catch (e) {}
}

// 粉碎闷响：低通后的短噪声重击（粉碎轮吃下一格投料）
export function playCrushSound() {
    if (!audioCtx) return;
    try {
        const t0 = audioCtx.currentTime;
        const n = Math.floor(audioCtx.sampleRate * 0.14);
        const buffer = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < n; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
        }
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420; // 低通做「闷」
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.45, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(getSfxOut());
        src.start(t0);
    } catch (e) {}
}

// 锯木声：中频「嗤——」刮擦（机械锯工作中，节拍性播放）
export function playSawSound() {
    if (!audioCtx) return;
    try {
        const t0 = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, t0);
        osc.frequency.linearRampToValueAtTime(190, t0 + 0.16); // 吃进木头的「变钝」起伏
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 900;
        filter.Q.value = 2;
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.1, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(getSfxOut());
        osc.start(t0);
        osc.stop(t0 + 0.22);
    } catch (e) {}
}

// 物品拾取：短促上扬「啵」（机器产出入包）
export function playPickupSound() {
    if (!audioCtx) return;
    try {
        const t0 = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(480, t0);
        osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.07);
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.12, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
        osc.connect(gain);
        gain.connect(getSfxOut());
        osc.start(t0);
        osc.stop(t0 + 0.11);
    } catch (e) {}
}
