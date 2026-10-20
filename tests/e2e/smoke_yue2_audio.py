#!/usr/bin/env python3
"""smoke_yue2_audio.py — YuE2 生成音频资产烟雾（2026-10-19）

验证新音频资产走游戏同款链路（fetch + audioCtx.decodeAudioData）可解码、时长正确，
且 bgm.js 的 orchestral 风格包注册与文件名映射成立。不进世界、不碰存档、
不导入游戏主模块链（避免 lib PREAMBLE 全量动态 import 的瞬时网络失败干扰）。

用法：CDP_PORT=19401 python3 tests/e2e/smoke_yue2_audio.py
前置：server.py 已跑（默认 8000）；Chrome CDP 端口由 CDP_PORT 指定（默认 19401）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, "/Users/zxnap/.agents/skills-archive/browser-cdp/scripts")
os.environ.setdefault("CDP_PORT", "19401")
from cdp import Page  # noqa: E402  与 lib.py 同源驱动

BGM = ["bgm_orchestral_day", "bgm_orchestral_night", "bgm_orchestral_approach", "bgm_orchestral_combat"]
SFX = ["edu_correct", "edu_wrong", "edu_unlock"]

JS = r"""
const BASE = 'http://127.0.0.1:8000';
const AC = window.AudioContext || window.webkitAudioContext;
const ctx = new AC();
const files = {};
for (const m of ['day', 'night', 'approach', 'combat']) {
  files['bgm_orchestral_' + m] = { path: `${BASE}/assets/audio/bgm_orchestral_${m}.m4a`, min: 58, max: 61 };
}
for (const k of ['correct', 'wrong', 'unlock']) {
  files['edu_' + k] = { path: `${BASE}/assets/audio/edu_${k}.wav`, min: 2.8, max: 3.2 };
}
const RESULT = {};
for (const [name, f] of Object.entries(files)) {
  try {
    const resp = await fetch(f.path);
    if (!resp.ok) { RESULT[name] = { ok: false, why: 'HTTP ' + resp.status }; continue; }
    const buf = await ctx.decodeAudioData(await resp.arrayBuffer());
    RESULT[name] = {
      ok: buf.duration >= f.min && buf.duration <= f.max,
      dur: Math.round(buf.duration * 100) / 100,
      rate: buf.sampleRate, ch: buf.numberOfChannels,
    };
  } catch (e) { RESULT[name] = { ok: false, why: String(e).slice(0, 120) }; }
}
try {
  // 先导 engine.js 再导 bgm.js（同 lib.py PREAMBLE 顺序）：uiModal 单独先导入会撞
  // 既有模块环的 TDZ（atlasTexture），与真实游戏从 main.js 进入的顺序一致即可
  await import(`${BASE}/js/engine.js`);
  const { BGM_PACKS } = await import(`${BASE}/js/bgm.js`);
  const pack = BGM_PACKS.find(p => p.id === 'orchestral');
  RESULT.__pack = pack ? { ok: true, name: pack.name }
                        : { ok: false, why: 'orchestral 未注册', packs: BGM_PACKS.map(p => p.id) };
} catch (e) { RESULT.__pack = { ok: false, why: String(e).slice(0, 120) }; }
try { ctx.close(); } catch (e) {}
return RESULT;
"""


def main():
    page = Page(port=int(os.environ["CDP_PORT"]))
    page.nav("http://127.0.0.1:8000/", settle=4.0)  # 随便一个同源页即可跑 fetch/decode
    out = page.cmd("Runtime.evaluate", {
        "expression": "(async () => {\n" + JS + "\n})()",
        "returnByValue": True, "awaitPromise": True,
    })
    if out.get("exceptionDetails"):
        print("EVAL ERROR:", out["exceptionDetails"].get("exception", {}).get("description", "")[:400])
        return 1
    res = out.get("result", {}).get("value") or {}
    fails = []
    for name in BGM + SFX + ["__pack"]:
        r = res.get(name)
        ok = bool(r and r.get("ok"))
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {r}")
        if not ok:
            fails.append(name)
    print(f"===== YuE2 音频资产烟雾: {'PASS' if not fails else 'FAIL'} =====")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
