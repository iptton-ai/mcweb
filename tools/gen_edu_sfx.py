#!/usr/bin/env python3
"""gen_edu_sfx.py — 用 tts-generation-webui 环境的 MusicGen small 生成本地教学音效（M1 答题机）。
输出 assets/audio/edu_{correct,wrong,unlock}.wav（32kHz 单声道，游戏经 WebAudio fetch+decode 播放）。"""
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "audio"
OUT.mkdir(parents=True, exist_ok=True)

SFX = {
    "edu_correct": "bright cheerful success chime, ascending xylophone arpeggio C E G, sparkling, short jingle, no drums, no vocals",
    "edu_wrong": "soft error buzz, two short low descending square-wave beeps, gentle negative feedback sound, no drums",
    "edu_unlock": "magical unlock fanfare, ascending harp glissando followed by triumphant three-note jingle, sparkles, short",
}

def main():
    import torch, torchaudio
    from audiocraft.models import MusicGen
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    model = MusicGen.get_pretrained("facebook/musicgen-small", device=dev)
    for name, prompt in SFX.items():
        model.set_generation_params(duration=3, top_k=200, temperature=0.9, cfg_coef=4.0)
        wav = model.generate([prompt])
        p = OUT / f"{name}.wav"
        torchaudio.save(str(p), wav[0].cpu(), sample_rate=32000)
        print("✅", p, p.stat().st_size, "bytes")

if __name__ == "__main__":
    main()
