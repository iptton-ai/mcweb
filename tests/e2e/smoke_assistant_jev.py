# -*- coding: utf-8 -*-
"""助手 Jev 快速路由烟雾验证（2026-09-21 批次）：
JV-01 ⚙️ 助手设置「⚡ Jev 快速路由」卡片：字段回填/保存/localStorage 落盘 /
JV-02 免 LLM 直答：未配置主模型时高置信 FAQ 仍 ~1s 直答（零 chat/completions 请求，自定义头随网关请求发送）/
JV-03 建造类请求放行主路径：不直答、注入后照常走到 LLM（此处以「尚未配置 LLM」报错为证）/
JV-04 建造系统预取注入：mock 主模型抓请求体，验证 mod fan-out 命中的知识节进首轮 prompt。

前置（真实网关用例需要）：环境变量 TYPESAFE_API_KEY + JEV_GATEWAY（自建中转网关地址，
不硬编码入仓库）。跑法：source ~/.bashrc && export JEV_GATEWAY=https://… && \\
cd tests/e2e && CDP_PORT=19401 python3 smoke_assistant_jev.py
（缺任一环境变量时 JV-02~04 自动 SKIP，JV-01 照常跑）
"""

import json
import os
import sys

import lib

KEY = os.environ.get("TYPESAFE_API_KEY", "")
GATEWAY = os.environ.get("JEV_GATEWAY", "")
HAVE_RELAY = bool(KEY and GATEWAY)
UI_GATEWAY = GATEWAY or "https://relay.example.local/api/jev"  # 仅 UI 用例用的占位
if not KEY:
    print("需要环境变量 TYPESAFE_API_KEY（source ~/.bashrc 后再跑）")
    sys.exit(2)
if not HAVE_RELAY:
    print("未配置 JEV_GATEWAY：JV-02~04（真网关真模型）将 SKIP")


def inject_jev_config(e2e):
    """注入 Jev 配置（启用 + 真 key + 网关 + 自定义头），清掉主 LLM 配置以证明直答不依赖它"""
    e2e.run(r"""
localStorage.removeItem('mcAssistant.config.v1'); // 未配置 LLM：直答仍应可用
""")
    e2e.raw_js("localStorage.setItem('mcAssistant.jev.v1', %s);" % json.dumps(
        json.dumps({
            "enabled": True,
            "apiKey": KEY,
            "gateway": GATEWAY or UI_GATEWAY,
            "model": "jev-1.13.0",
            "customHeaders": "X-Mcweb-Smoke: 1",  # 验证自定义头随网关请求发送
        }, ensure_ascii=False),
    ))


def open_settings(e2e):
    return e2e.run(r"""
const fab = document.getElementById('ai-fab');
fab.click(); // 打开助手面板
await sleep(150);
document.getElementById('ai-btn-settings').click();
await sleep(100);
const card = document.querySelector('#ai-set-jev-enable');
return {
  panelShown: !document.getElementById('ai-panel').classList.contains('hidden'),
  cardExists: !!card,
  filled: {
    enable: card.checked,
    key: document.getElementById('ai-set-jev-key').value.length > 8,
    gateway: document.getElementById('ai-set-jev-gateway').value,
    headers: document.getElementById('ai-set-jev-headers').value,
    model: document.getElementById('ai-set-jev-model').value,
  },
};
""")


# ---------------------------------------------------------------- JV-01 设置卡片
def jv_01(e2e):
    inject_jev_config(e2e)
    res = open_settings(e2e)
    if not isinstance(res, dict) or not res.get("cardExists"):
        return lib.report("JV-01 Jev 设置卡片", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    # 修改字段并保存 → localStorage 落盘
    res2 = e2e.run(r"""
const panel = document.getElementById('ai-panel');
panel.querySelector('#ai-set-jev-headers').value = 'X-Mcweb-Smoke: 1';
panel.querySelector('#ai-set-jev-model').value = 'jev-1.13.0';
panel.querySelector('#ai-set-save').click();
await sleep(100);
const saved = JSON.parse(localStorage.getItem('mcAssistant.jev.v1') || '{}');
return {
  persisted: {
    enabled: saved.enabled === true,
    model: saved.model === 'jev-1.13.0',
    keyPresent: (saved.apiKey || '').length > 8,
    gateway: saved.gateway === %s,
    headers: saved.customHeaders === 'X-Mcweb-Smoke: 1',
  },
  settingsClosed: document.getElementById('ai-settings').classList.contains('hidden'),
};
""" % json.dumps(UI_GATEWAY))
    checks = [
        ("面板可开、卡片存在", res.get("cardExists") is True and res.get("panelShown") is True, ""),
        ("字段按 localStorage 回填（key/网关/自定义头/模型）",
         res["filled"]["key"] and res["filled"]["gateway"] == UI_GATEWAY
         and res["filled"]["headers"] == "X-Mcweb-Smoke: 1"
         and res["filled"]["model"] == "jev-1.13.0", json.dumps(res.get("filled"), ensure_ascii=False)),
        ("保存后落盘（enabled/model/key/gateway/headers）",
         all(res2.get("persisted", {}).values()), json.dumps(res2.get("persisted"), ensure_ascii=False)),
    ]
    return lib.report("JV-01 Jev 设置卡片", {"open": res, "save": res2}, checks)


# ---------------------------------------------------------------- JV-02 免 LLM 直答
def jv_02(e2e):
    inject_jev_config(e2e)
    res = e2e.run(r"""
const aui = await import(B+'assistant/ui.js');
const sessions = await import(B+'assistant/sessions.js');
sessions.getActiveSession().messages.length = 0; // 幂等：清空会话

// 统计 chat/completions 请求次数（直答应为 0）；顺带捕获首个非 chat POST 的请求头（= Jev 网关请求）
window.__chatCalls = 0;
window.__jevHeaders = null;
if (!window.__origFetch) {
  window.__origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = String(args[0] || '');
    const opts = args[1] || {};
    if (url.indexOf('chat/completions') >= 0) window.__chatCalls++;
    else if (opts.headers && !window.__jevHeaders) window.__jevHeaders = opts.headers;
    return window.__origFetch.apply(this, args);
  };
}

const t0 = Date.now();
aui.sendUserMessage('红石灯怎么点亮？');
let last = null;
for (let i = 0; i < 100; i++) { // 最多 20s
  await sleep(200);
  const msgs = sessions.getActiveSession().messages;
  last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') break;
}
const secs = (Date.now() - t0) / 1000;
const errEl = document.querySelector('#ai-messages .ai-msg.assistant.error');
return {
  elapsedSec: +secs.toFixed(1),
  gotAssistant: !!last && last.role === 'assistant',
  isFastAnswer: !!last && String(last.content || '').includes('⚡') && String(last.content || '').includes('快速回答'),
  chatCalls: window.__chatCalls,
  jevHeaderSmoke: window.__jevHeaders ? (window.__jevHeaders['X-Mcweb-Smoke'] || null) : null,
  cfgRaw: localStorage.getItem('mcAssistant.config.v1'),
  errText: errEl ? errEl.textContent.slice(0, 160) : null,
  preview: last ? String(last.content || '').slice(0, 120) : null,
};
""")
    if not isinstance(res, dict) or "gotAssistant" not in res:
        return lib.report("JV-02 免 LLM 直答", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("收到 assistant 直答（含 ⚡ 快速回答角标）", res["gotAssistant"] and res["isFastAnswer"],
         str(res.get("preview"))),
        ("全程零 chat/completions 请求（真·跳过主模型）", res["chatCalls"] == 0, str(res["chatCalls"])),
        ("自定义请求头随网关请求发送", res["jevHeaderSmoke"] == "1", str(res.get("jevHeaderSmoke"))),
        ("响应在 10s 内（含 Jev 路由 + 网络往返）", res["elapsedSec"] < 10, f"{res['elapsedSec']}s"),
    ]
    return lib.report("JV-02 免 LLM 直答", res, checks)


# ---------------------------------------------------------------- JV-03 建造类放行主路径
def jv_03(e2e):
    inject_jev_config(e2e)
    res = e2e.run(r"""
const aui = await import(B+'assistant/ui.js');
const sessions = await import(B+'assistant/sessions.js');
sessions.getActiveSession().messages.length = 0;

const t0 = Date.now();
aui.sendUserMessage('在我旁边盖一座小房子');
let last = null;
for (let i = 0; i < 60; i++) {
  await sleep(200);
  const msgs = sessions.getActiveSession().messages;
  last = msgs[msgs.length - 1];
  if (last && (last.role === 'assistant' || last.role === 'user')) {
    if (last.role === 'assistant') break;
  }
  const err = document.querySelector('#ai-messages .ai-msg.assistant.error');
  if (err) { last = { role: 'assistant', content: err.textContent }; break; }
}
const secs = (Date.now() - t0) / 1000;
return {
  elapsedSec: +secs.toFixed(1),
  notDirectAnswer: !(last && String(last.content || '').includes('快速回答')),
  reachedMainPath: !!(last && String(last.content || '').includes('尚未配置 LLM')),
  preview: last ? String(last.content || '').slice(0, 100) : null,
};
""")
    if not isinstance(res, dict) or "notDirectAnswer" not in res:
        return lib.report("JV-03 建造类放行主路径", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("建造类请求不触发直答", res["notDirectAnswer"] is True, str(res.get("preview"))),
        ("预取注入后照常走到主 LLM 路径（未配置 → 明确报错而非卡死）", res["reachedMainPath"] is True,
         str(res.get("preview"))),
    ]
    return lib.report("JV-03 建造类放行主路径", res, checks)


# ---------------------------------------------------------------- JV-04 建造系统预取注入（mock 主模型）
def jv_04(e2e):
    inject_jev_config(e2e)
    res = e2e.run(r"""
// 假主模型：拦截 chat/completions 抓请求体（不真发网络），回一段固定文本结束循环。
// 配置必须走公开 API saveConfig（同步更新 llm.js 的运行时缓存）——直接写 localStorage
// 会被启动期已缓存的 getConfig 挡住，出现「尚未配置 LLM」的假失败。
const llm = await import(B+'assistant/llm.js');
llm.saveConfig({ baseUrl: 'http://mock.llm/v1', apiKey: 'sk-mock', model: 'mock-chat' });
const aui = await import(B+'assistant/ui.js');
const sessions = await import(B+'assistant/sessions.js');
sessions.getActiveSession().messages.length = 0;
window.__llmBodies = [];
if (!window.__origFetch2) {
  window.__origFetch2 = window.fetch;
  window.fetch = function (url, opts) {
    if (String(url || '').indexOf('chat/completions') >= 0) {
      window.__llmBodies.push(JSON.parse(opts.body));
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: '收到（mock）' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return window.__origFetch2.apply(this, arguments);
  };
}

const t0 = Date.now();
aui.sendUserMessage('盖一座带红石灯自动门的小屋');
let last = null;
for (let i = 0; i < 100; i++) {
  await sleep(200);
  const msgs = sessions.getActiveSession().messages;
  last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') break;
  const errEl = document.querySelector('#ai-messages .ai-msg.assistant.error');
  if (errEl) { window.__errText = errEl.textContent.slice(0, 300); break; }
}
const bodies = window.__llmBodies;
const hintMsgs = bodies.flatMap((b) => (b.messages || [])).filter(
  (m) => m.role === 'user' && String(m.content || '').indexOf('[⚡ Jev 预取') >= 0
);
return {
  elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
  gotAssistant: !!(last && last.role === 'assistant'),
  llmCalls: bodies.length,
  errText: window.__errText || null,
  prefetchInjected: hintMsgs.length > 0,
  hintSections: hintMsgs.length ? (String(hintMsgs[0].content).match(/【([a-z_]+)｜/g) || []) : [],
  preview: last ? String(last.content || '').slice(0, 60) : null,
};
""")
    if not isinstance(res, dict) or "prefetchInjected" not in res:
        return lib.report("JV-04 建造系统预取注入", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("mock 主模型被调用且正常收尾", res["gotAssistant"] and res["llmCalls"] == 1,
         json.dumps({k: res.get(k) for k in ("gotAssistant", "llmCalls", "errText", "preview")}, ensure_ascii=False)),
        ("首轮请求带 [⚡ Jev 预取] 上下文", res["prefetchInjected"] is True, ""),
        ("预取含建造系统知识节（红石/动力等 fan-out 或本地检索命中）",
         len(res["hintSections"]) > 0, str(res["hintSections"])),
        ("端到端在 15s 内（Jev 路由 + mock 回复）", res["elapsedSec"] < 15, f"{res['elapsedSec']}s"),
    ]
    return lib.report("JV-04 建造系统预取注入", res, checks)


CASES = {"JV-01": jv_01, "JV-02": jv_02, "JV-03": jv_03, "JV-04": jv_04}
REAL_RELAY_CASES = {"JV-02", "JV-03", "JV-04"}  # 需要真网关 + 真模型

if __name__ == "__main__":
    want = sys.argv[1:] or list(CASES)
    e2e = lib.E2E()
    ok = True
    try:
        for name in want:
            if name in REAL_RELAY_CASES and not HAVE_RELAY:
                print(f"===== {name}: SKIP（未配置 TYPESAFE_API_KEY / JEV_GATEWAY）=====")
                continue
            e2e.fresh_page()
            ok = CASES[name](e2e) and ok
    finally:
        e2e.close()
    sys.exit(0 if ok else 1)
