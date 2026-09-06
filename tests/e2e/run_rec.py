# -*- coding: utf-8 -*-
"""录像功能验收（R 键两段式录像的契约，2026-09-06 修复沉淀）。

- REC-1 两次 R 区间录像：第一次 R 开录、第二次 R 停止出片，成片时长 ≈ 两次按键间隔
- REC-2 键盘自动重复忽略：按住 R 触发 e.repeat 连发不得停开录像（修复前 0.5s 连发
  会落 3 个垃圾视频、把区间拦腰斩断，第二次真实按键反而变成开始录）
- REC-3 跟拍录像所有权：跟拍自动开的录像（'cam' 所有）建完自动停；用户手动 R 接管后
  （停 cam 录像再自己开录）跟拍收尾保留当前镜头、绝不误停用户录像（修复前 autoRecStarted
  残留 true 导致误停）

重跑：cd tests/e2e && python3 run_rec.py [case ...]（缺省全跑）
"""

import sys

import lib

CASES_ORDER = []


def case(fn):
    CASES_ORDER.append(fn.__name__)
    return fn


# 页面侧公共段：抓 blob（patch URL.createObjectURL）+ 真实 R 键派发 + 时长探测
REC_HELPERS = r"""
if (window.__recOriginalCreate) URL.createObjectURL = window.__recOriginalCreate;
window.__recOriginalCreate = URL.createObjectURL;
S.buildAutoRecord = true;
const blobs = [];
const origCreate = URL.createObjectURL.bind(URL);
URL.createObjectURL = (b) => { blobs.push({blob: b, size: b && b.size, type: b && b.type}); return origCreate(b); };
const pressR = (repeat=false) => document.dispatchEvent(
    new KeyboardEvent('keydown', {code: 'KeyR', key: 'r', bubbles: true, cancelable: true, repeat}));
async function durOf(b) {  // webm 无时长元数据时 seek 大值逼出真实 duration；全部兜底超时防挂
    const url = origCreate(b);
    const v = document.createElement('video'); v.src = url; v.muted = true;
    await new Promise((res) => { v.onloadedmetadata = res; v.onerror = res; setTimeout(res, 1500); });
    let dur = v.duration;
    if (!isFinite(dur)) { await new Promise((res) => { v.onseeked = res; v.currentTime = 1e9; setTimeout(res, 1500); }); dur = v.duration; }
    URL.revokeObjectURL(url);
    return isFinite(dur) ? +dur.toFixed(2) : null;
}
const waitBlob = async (n, capMs=10000) => { const t0=Date.now(); while (Date.now()-t0<capMs && blobs.length<n) await sleep(100); return blobs.length; };
"""


@case
def REC_1(e2e):
    """两次 R 区间录像：成片存在、容器合法、时长贴两次按键间隔。"""
    res = e2e.js_str(REC_HELPERS + r"""
const t0 = Date.now();
pressR();
await sleep(200);
const recAfter1 = ui.isRecording();
const yaw0 = S.player.yaw;
for (let i = 0; i < 6; i++) { S.player.yaw += 0.5; S.player.pitch = -0.4; await sleep(500); }  // 3s 画面变化
pressR();
const intervalMs = Date.now() - t0;
const recAfter2 = ui.isRecording();
const n = await waitBlob(1);
const dur = n ? await durOf(blobs[0].blob) : null;
return { recAfter1, recAfter2, blobCount: n, type: blobs[0] ? blobs[0].type : null,
         size: blobs[0] ? blobs[0].size : null, dur, intervalSec: +(intervalMs/1000).toFixed(2) };
""")
    d = res if isinstance(res, dict) else {}
    dur, interval = d.get("dur"), d.get("intervalSec") or 0
    checks = [
        ("第一次 R 开录", d.get("recAfter1") is True, f"recAfter1={d.get('recAfter1')}"),
        ("第二次 R 停录", d.get("recAfter2") is False, f"recAfter2={d.get('recAfter2')}"),
        ("恰好出一条成片", d.get("blobCount") == 1, f"blobCount={d.get('blobCount')}"),
        ("容器为视频类型", str(d.get("type", "")).startswith("video/"), f"type={d.get('type')}"),
        ("成片非空(>64KB)", (d.get("size") or 0) > 65536, f"size={d.get('size')}"),
        ("时长≈按键间隔(±1.2s)", dur is not None and abs(dur - interval) <= 1.2, f"dur={dur}s vs interval={interval}s"),
    ]
    return lib.report("REC-1 两次R区间录像", res, checks)


@case
def REC_2(e2e):
    """键盘自动重复（e.repeat）不得触发开关：按住 R 半秒后录像仍在录、全程只出一条成片。"""
    res = e2e.js_str(REC_HELPERS + r"""
pressR();                                     // 真实首按
for (let i = 0; i < 6; i++) { pressR(true); await sleep(80); }  // ~0.5s 自动重复连发
const recMid = ui.isRecording();              // 修复点：重复没把它停掉
const junkBefore = blobs.length;              // 修复点：连发期间不该有视频落盘
await sleep(1500);
pressR();                                     // 第二次真实按键 = 停止
const n = await waitBlob(1);
return { recMid, junkBefore, blobCount: n, recAfter: ui.isRecording(),
         size: blobs[0] ? blobs[0].size : null };
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("连发期间录像未被停", d.get("recMid") is True, f"recMid={d.get('recMid')}"),
        ("连发期间无垃圾成片", d.get("junkBefore") == 0, f"junkBefore={d.get('junkBefore')}"),
        ("停止后恰好一条成片", d.get("blobCount") == 1, f"blobCount={d.get('blobCount')}"),
        ("停止后不在录", d.get("recAfter") is False, f"recAfter={d.get('recAfter')}"),
    ]
    return lib.report("REC-2 自动重复忽略", res, checks)


@case
def REC_3(e2e):
    """跟拍录像所有权：跟拍自动开录→手动 R 接管→建完收尾不误停用户录像→手动停出片。"""
    res = e2e.js_str(REC_HELPERS + r"""
const cam = await import(B+'cameraRig.js');
const ops = [];
for (let i = 0; i < 8; i++) ops.push([40+i, 60, 40, BT.STONE]);
const jobP = bq.enqueueBuildOps('跟拍验证塔', ops);
cam.updateBuildFilming(0.05);                      // 有任务在队：开工自动取景并开录（'cam' 所有）
await sleep(400);
const camRec = ui.isRecording();
pressR(); await sleep(150); pressR();         // 手动停 cam 录像、再手动开 user 录像
await sleep(300);
const userRec = ui.isRecording();
await jobP;                                   // 施工完成
await sleep(4 * 1000 + 1500);                 // 等 BUILD_CAM_DONE_DELAY 收尾（config 默认 4s）
const recAfterFinish = ui.isRecording();      // 修复点：user 录像不被跟拍收尾误停
const cameraPreserved = S.camMode === 'build';
pressR();                                     // 手动停出片
const n = await waitBlob(2);
return { camRec, userRec, recAfterFinish, cameraPreserved, blobCount: n, recAfter: ui.isRecording() };
""")
    d = res if isinstance(res, dict) else {}
    checks = [
        ("进跟拍自动开录", d.get("camRec") is True, f"camRec={d.get('camRec')}"),
        ("手动接管后用户在录", d.get("userRec") is True, f"userRec={d.get('userRec')}"),
        ("跟拍收尾不误停用户录像", d.get("recAfterFinish") is True, f"recAfterFinish={d.get('recAfterFinish')}"),
        ("用户录像镜头不会被收尾切走", d.get("cameraPreserved") is True, f"cameraPreserved={d.get('cameraPreserved')}"),
        ("两条成片(cam+user)", d.get("blobCount") == 2, f"blobCount={d.get('blobCount')}"),
        ("手动停后不在录", d.get("recAfter") is False, f"recAfter={d.get('recAfter')}"),
    ]
    return lib.report("REC-3 跟拍录像所有权", res, checks)


ALL = {fn.__name__: fn for fn in [REC_1, REC_2, REC_3]}

if __name__ == "__main__":
    names = sys.argv[1:] or list(ALL)
    e2e = lib.E2E()
    e2e.page.cmd('Browser.setDownloadBehavior', {'behavior': 'deny'})
    e2e.fresh_page()
    results = {}
    for n in names:
        results[n] = ALL[n](e2e)
    e2e.close()
    print("\n==== 录像验收汇总 ====")
    for n, ok in results.items():
        print(f"  {n}: {'PASS' if ok else 'FAIL'}")
    sys.exit(0 if all(results.values()) else 1)
