#!/usr/bin/env python3
"""gen_yue2_audio.py — 用本机 ComfyUI 的 YuE2（yue2_3b_bf16 + MPS --gpu-only）生成
游戏背景音乐与教学音效。

产物：
  背景音乐（新风格包 orchestral，60s 循环曲 ×4 态势）
    → 中转 flac，转码后安装为 assets/audio/bgm_orchestral_{day,night,approach,combat}.m4a
  教学音效（替换 MusicGen 旧版，≤4s）
    → assets/audio/edu_{correct,wrong,unlock}.wav（32kHz 单声道 Int16，3s）

用法（需本机 ComfyUI 已带 --gpu-only 跑在 8188，模型 yue2_3b_bf16.safetensors）：
  python3 tools/gen_yue2_audio.py submit edu_correct          # 提交（可多个，空格分隔）
  python3 tools/gen_yue2_audio.py wait   edu_correct          # 轮询 history 直到完成（打印 flac 路径）
  python3 tools/gen_yue2_audio.py convert edu_correct         # flac → 游戏格式，落到 assets/audio/

坑位备忘（来自 comfyui skill #65/#66）：
  - MPS 必须 bf16 checkpoint；int8 convrot 走 _int_mm，MPS 未实现，提交即失败。
  - 轮询脚本超时 ≠ 服务端任务死，/history/<prompt_id> 继续查即可，勿重提。
"""
import json
import os
import random
import subprocess
import sys
import time
import urllib.request

HOST = os.environ.get("COMFY_HOST", "http://127.0.0.1:8188")
os.environ.setdefault("no_proxy", "*")

GAME_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(GAME_ROOT, "assets", "audio")
CKPT = "yue2_3b_bf16.safetensors"  # MPS 可用配置（int8 convrot 在 MPS 不可用）
REG_PATH = "/tmp/yue2_mcweb_jobs.json"

_INST = "[Vocal] None, fully instrumental, no singing"
JOBS = {
    # ---- 背景音乐：管弦冒险包（60s 循环曲）----
    "bgm_orchestral_day": dict(
        kind="bgm", max_duration=60.0, seed=20261019,
        style=(
            "[Genre] Warm uplifting orchestral adventure theme for a cozy sandbox video game, daylight exploration music\n"
            "[Tempo] Moderate, 96 BPM, relaxed flowing groove\n"
            "[Instruments] Warm strings, acoustic guitar strumming, gentle piano, flute, glockenspiel, soft hand percussion\n"
            f"{_INST}\n"
            "[Mix] Bright and airy, balanced dynamics, gentle hall reverb\n"
            "[Mood] Cheerful, curious, peaceful, sunny\n"
            "[Structure] Intro, Theme A, Theme B, Theme A variation, Outro\n"
        ),
    ),
    "bgm_orchestral_night": dict(
        kind="bgm", max_duration=60.0, seed=20261020,
        style=(
            "[Genre] Dark mysterious night-time ambient music for a sandbox video game, moonlit and eerie\n"
            "[Tempo] Slow, 60 BPM, sparse drifting pulse\n"
            "[Instruments] Deep cellos, sparse minor-key piano notes, dark pad, distant airy choir pad, music box, soft timpani swells\n"
            f"{_INST}\n"
            "[Mix] Dark spacious reverb, quiet distant dynamics\n"
            "[Mood] Eerie, mysterious, watchful, quiet tension\n"
            "[Structure] Intro, Theme A, Theme A variation, Outro\n"
        ),
    ),
    "bgm_orchestral_approach": dict(
        kind="bgm", max_duration=60.0, seed=20261021,
        style=(
            "[Genre] Tense suspense creeping-danger music for a video game, cinematic thriller cue\n"
            "[Tempo] Building, 84 BPM, ticking pulse\n"
            "[Instruments] Tremolo violins, pulsing low strings, ticking woodblock percussion, dissonant brass swells, deep bass drone\n"
            f"{_INST}\n"
            "[Mix] Tight and dark, slowly building intensity\n"
            "[Mood] Ominous, uneasy, alert, danger approaching\n"
            "[Structure] Intro, Build, Theme A, Build, Outro\n"
        ),
    ),
    "bgm_orchestral_combat": dict(
        kind="bgm", max_duration=60.0, seed=777,
        style=(
            "[Genre] Epic heroic battle music for a video game, orchestral action cue\n"
            "[Tempo] Fast, 140 BPM, driving aggressive groove\n"
            "[Instruments] Taiko drums, snare rolls, heroic brass fanfares, fast staccato strings, timpani\n"
            "[Mix] Loud punchy wide stereo, epic hall, purely instrumental\n"
            "[Mood] Heroic, urgent, triumphant, adrenaline\n"
            "[Structure] Intro, Theme A, Theme B, Climax, Outro\n"
        ),
    ),
    # ---- 教学音效（YuE2 重制版，替换 tools/gen_edu_sfx.py 的 MusicGen 旧版）----
    "edu_correct": dict(
        kind="sfx", max_duration=4.0, seed=20261101,
        style=(
            "[Genre] Short video game success jingle, quiz answer correct chime\n"
            "[Instruments] Bright marimba ascending arpeggio, sparkling bells, soft chime\n"
            f"{_INST}\n"
            "[Mood] Happy, rewarding, sparkling\n"
            "[Structure] One short phrase\n"
        ),
    ),
    "edu_wrong": dict(
        kind="sfx", max_duration=4.0, seed=20261102,
        style=(
            "[Genre] Short video game error sound, quiz answer wrong cue\n"
            "[Instruments] Two soft descending trombone notes, gentle muted buzzer, warm and short\n"
            f"{_INST}\n"
            "[Mood] Gentle disappointment, comedic, soft\n"
            "[Structure] One short phrase\n"
        ),
    ),
    "edu_unlock": dict(
        kind="sfx", max_duration=4.0, seed=20261103,
        style=(
            "[Genre] Short video game achievement unlock fanfare\n"
            "[Instruments] Triumphant brass chord, ascending harp glissando, shimmering bells\n"
            f"{_INST}\n"
            "[Mood] Triumphant, magical, bright\n"
            "[Structure] One short phrase\n"
        ),
    ),
}


def api(path, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{HOST}{path}", data=data,
        headers={"Content-Type": "application/json"} if data else {})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


LYRICS_INST = "[Intro]\n[Instrumental]\n[Break]\n[Instrumental]\n[Outro]\n[End]"


# 首发成品来源（2026-10-19，均过 ASR 无人声验收）：day=seed 20261019 空歌词版；
# night=seed 20261020、approach=seed 20261021 均标签歌词版；combat=seed 777 去唱诗班+标签歌词版。
# 重生成再遇人声就换 seed 重滚——combat 教训：style 里别写 choir/vocal 类乐器词
# （"epic wordless choir pad" 会引诱人声）。
def build_workflow(job, seed):
    """off 模式（不用 ABC）：风格驱动直出音乐 token。
    ⚠️ 器乐实测（2026-10-19，yue2_3b_bf16）：lyrics 用分段标签法
    "[Intro]\n[Instrumental]\n[Break]\n[Instrumental]\n[Outro]\n[End]"——
    "[inst]"/留空都会唱出幻觉人声（YuE2 本质是歌曲模型，HF 官方讨论确认无可靠器乐模式）；
    提 cfg_scale 只会更糟。此法在 day/night 两 mood 实证干净（ASR 0 词）。"""
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "YuE2GenerateMusic", "inputs": {
            "clip": ["1", 1], "style": job["style"], "lyrics": LYRICS_INST, "abc": "",
            "seed": seed, "mode": "full", "max_duration": job["max_duration"],
            "temperature": 1.0, "top_p": 0.95, "top_k": 100,
            "repetition_penalty": 1.15, "cfg_scale": 1.01,
        }},
        "3": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["2", 0]}},
        "4": {"class_type": "EmptyYuE2LatentAudio", "inputs": {"seconds": ["2", 1], "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0],
            "latent_image": ["4", 0], "seed": seed,
            "steps": 32, "cfg": 1.0, "sampler_name": "dpm_2",
            "scheduler": "sgm_uniform", "denoise": 1.0,
        }},
        "6": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveAudio", "inputs": {"audio": ["6", 0], "filename_prefix": "PLACEHOLDER"}},
    }


def load_reg():
    try:
        return json.load(open(REG_PATH))
    except Exception:
        return {}


def save_reg(reg):
    json.dump(reg, open(REG_PATH, "w"), ensure_ascii=False, indent=1)


def cmd_submit(names):
    reg = load_reg()
    for name in names:
        job = JOBS[name]
        seed = job["seed"]
        wf = build_workflow(job, seed)
        wf["7"]["inputs"]["filename_prefix"] = f"Audio/mcw_{name}"
        try:
            r = api("/prompt", {"prompt": wf})
        except urllib.error.HTTPError as e:
            print(f"[FAIL] {name}: HTTP {e.code} {e.read().decode()[:800]}")
            sys.exit(1)
        pid = r["prompt_id"]
        reg[name] = {"prompt_id": pid, "seed": seed, "submitted_at": time.time()}
        save_reg(reg)
        print(f"[submitted] {name} prompt_id={pid} seed={seed}", flush=True)


def cmd_wait(names, timeout=7200):
    reg = load_reg()
    deadline = time.time() + timeout
    pending = list(names)
    while pending and time.time() < deadline:
        for name in list(pending):
            pid = reg.get(name, {}).get("prompt_id")
            if not pid:
                print(f"[error] {name}: 未提交（先 submit）")
                pending.remove(name)
                continue
            try:
                h = api(f"/history/{pid}", timeout=10)
            except Exception as e:
                print(f"[poll] {name}: {e}", flush=True)
                continue
            entry = h.get(pid)
            if not entry:
                continue  # 还在队列/执行中
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                msgs = json.dumps(status.get("messages", []), ensure_ascii=False)[:1500]
                print(f"[error] {name}: 任务失败 {msgs}")
                pending.remove(name)
                continue
            outputs = entry.get("outputs", {})
            flacs = []
            for node_out in outputs.values():
                for au in node_out.get("audio", []):
                    flacs.append(os.path.join(au.get("subfolder", ""), au["filename"]))
            if flacs:
                reg[name]["flac"] = flacs[0]
                reg[name]["done_at"] = time.time()
                reg[name]["elapsed"] = round(reg[name]["done_at"] - reg[name]["submitted_at"])
                save_reg(reg)
                print(f"[done] {name}: {flacs[0]} （{reg[name]['elapsed']}s）", flush=True)
                pending.remove(name)
        if pending:
            time.sleep(20)
    if pending:
        print(f"[timeout] 未完成: {pending} —— 服务端仍在跑，/history 可继续查，勿重提")
        sys.exit(2)


def channel_mono_filter(src):
    """YuE2 输出的立体声常接近反相（实测相关系数 ≈ -0.9）：直接 -ac 1 平均下混会抵消
    掉十几 dB，单声道设备（很多教学机）播放几乎无声。按实测相关性自适应：
    负相关翻转右声道再合成单声道，正相关正常平均。"""
    out = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", src, "-f", "s16le", "-"],
        capture_output=True).stdout
    import array as _array
    data = _array.array("h")
    data.frombytes(out)
    step = max(1, len(data) // 2 // 200000) * 2  # 采样到 ~20 万对以内
    l = data[0::2][::step // 2 or 1]
    r = data[1::2][::step // 2 or 1]
    n = min(len(l), len(r))
    dot = sum(l[i] * r[i] for i in range(n))
    nl = (sum(x * x for x in l) + 1e-9) ** 0.5
    nr = (sum(x * x for x in r) + 1e-9) ** 0.5
    corr = dot / (nl * nr)
    filt = "pan=mono|c0=0.5*c0-0.5*c1" if corr < 0 else "pan=mono|c0=0.5*c0+0.5*c1"
    print(f"    声道相关系数 {corr:+.2f} → {filt}")
    return filt


def peak_gain_db(src, target_peak_db):
    """实测峰值 → 达到目标峰值所需的增益（dB）。现有包峰值≈-0.9dBFS、旧音效≈-6.5dB。"""
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", src, "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    for line in out.splitlines():
        if "max_volume:" in line:
            cur = float(line.split("max_volume:")[1].replace("dB", "").strip())
            return round(target_peak_db - cur, 2)
    raise RuntimeError(f"volumedetect 失败：{src}")


def cmd_convert(names):
    """flac → 游戏格式：bgm=m4af/aac/32kHz/单声道（对齐现有包），sfx=wav/32kHz/单声道/3s。
    响度策略=峰值归一（对齐既有资产的近满幅惯例），不用单遍 loudnorm（会把短音效压得过轻）。"""
    reg = load_reg()
    for name in names:
        src = os.path.join(
            "/Users/zxnap/code/MyWorks/yltech.media/musk-flying-car-2026-10-19/mv/comfy_out",
            reg.get(name, {}).get("flac", ""))
        if not os.path.isfile(src):
            print(f"[error] {name}: 找不到 {src}")
            sys.exit(1)
        job = JOBS[name]
        if job["kind"] == "bgm":
            dst = os.path.join(AUDIO_DIR, f"{name}.m4a")  # name 形如 bgm_orchestral_day
            mono = channel_mono_filter(src)
            gain = peak_gain_db(src, -1.0)
            # 20ms 首尾微淡入淡出消除循环接缝爆音 + 峰值归一 -1dBFS；
            # 终编码走 ffmpeg（afconvert 读 flac 报 -66564，-c 1 也不可靠），AAC-LC 32kHz 单声道对齐现有包
            subprocess.run([
                "ffmpeg", "-y", "-loglevel", "error", "-i", src,
                "-af", f"{mono},volume={gain}dB,afade=t=in:d=0.02,afade=t=out:st=59.8:d=0.2,aresample=32000",
                "-t", "60", "-c:a", "aac", "-b:a", "128k", dst], check=True)
        else:
            dst = os.path.join(AUDIO_DIR, f"{name}.wav")
            mono = channel_mono_filter(src)
            gain = peak_gain_db(src, -6.5)
            # 教学音效=3s 定长（与旧版一致）：掐 3s + 30ms 起音 / 250ms 收尾淡出 + 峰值归一 -6.5dB
            subprocess.run([
                "ffmpeg", "-y", "-loglevel", "error", "-i", src,
                "-af", f"{mono},volume={gain}dB,afade=t=in:d=0.03,afade=t=out:st=2.75:d=0.25,aresample=32000",
                "-t", "3", "-c:a", "pcm_s16le", dst], check=True)
        print(f"[installed] {dst} (gain {gain:+g}dB, {os.path.getsize(dst)} bytes)")


if __name__ == "__main__":
    cmd_name, names = sys.argv[1], sys.argv[2:]
    if cmd_name == "list":
        print("\n".join(JOBS))
    elif cmd_name == "submit":
        cmd_submit(names or list(JOBS))
    elif cmd_name == "retry":
        # retry <name> [seed]：同一 job 换 seed 重提（QC 不过时用，原 seed 仍记录在案可复现）
        name = names[0]
        if len(names) > 1:
            JOBS[name]["seed"] = int(names[1])
        cmd_submit([name])
    elif cmd_name == "wait":
        cmd_wait(names or list(load_reg()))
    elif cmd_name == "convert":
        cmd_convert(names)
    else:
        print(__doc__)
        sys.exit(1)
