// ==================== audio.js ====================

// ==================== 音效生成 ====================
export let audioCtx = null;

export function initAudio() {
    try {
        audioCtx = new(window.AudioContext || window.webkitAudioContext)();
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
        gain.connect(audioCtx.destination);
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
        gain.connect(audioCtx.destination);
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
        gain.connect(audioCtx.destination);
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
        gain.connect(audioCtx.destination);
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
        ng.connect(audioCtx.destination);
        noise.start(t0);
        // 落位「嗒」
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.connect(gain);
        gain.connect(audioCtx.destination);
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
        gain.connect(audioCtx.destination);
        noise.start(audioCtx.currentTime);
    } catch (e) {}
}
