# -*- coding: utf-8 -*-
"""助手 Jev 快速路由烟雾验证（2026-09-21 批次）：
JV-01 ⚙️ 助手设置「⚡ Jev 快速路由」卡片：字段回填/保存/localStorage 落盘 /
JV-02 免 LLM 直答：未配置主模型时高置信 FAQ 仍 ~1s 直答（零 chat/completions 请求，自定义头随网关请求发送）/
JV-03 建造类请求放行主路径：不直答、注入后照常走到 LLM（此处以「尚未配置 LLM」报错为证）/
JV-04 建造系统预取注入：mock 主模型抓请求体，验证 mod fan-out 命中的知识节进首轮 prompt /
JV-05 证据 checkpoint（E3）：mock 主模型先 plan_conditions 登记条件再取证，本地 mock 网关抓
      checkpoint 请求体，断言 questions 含每条件 cond_* noul + ev_conflict/ev_missing，高分直接收束 /
JV-06 缺口续检（E3）：mock 网关返回低分 answers，断言下一次 LLM 请求的 messages 含缺口提示，
      续检预算受控（checkpoint ≤2），预算用尽后正常收束并尾注未核验项。

前置（真实网关用例 JV-02~04 需要）：环境变量 TYPESAFE_API_KEY + JEV_GATEWAY（自建中转网关地址，
不硬编码入仓库）。JV-05/06 用 python 标准库 http.server 起的本地 mock 网关，不依赖任何 env。
跑法：source ~/.bashrc && export JEV_GATEWAY=https://… && \\
cd tests/e2e && CDP_PORT=19401 python3 smoke_assistant_jev.py
（缺环境变量时 JV-02~04 自动 SKIP；JV-01/JV-05/JV-06 照常跑，JV-01 的 key 回填断言仍需真实 KEY）
"""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import lib

KEY = os.environ.get("TYPESAFE_API_KEY", "")
GATEWAY = os.environ.get("JEV_GATEWAY", "")
HAVE_RELAY = bool(KEY and GATEWAY)
UI_GATEWAY = GATEWAY or "https://relay.example.local/api/jev"  # 仅 UI 用例用的占位
if not HAVE_RELAY:
    print("未配置 TYPESAFE_API_KEY / JEV_GATEWAY：JV-02~04（真网关真模型）将 SKIP；JV-05/06 用本地 mock 网关照常跑")


def inject_jev_config(e2e):
    """注入 Jev 配置（启用 + 真 key + 网关 + 自定义头），并把主 LLM 配置复位为「未配置」。
    必须走 saveConfig 公开 API：只 removeItem 清不掉启动期已缓存的 getConfig（上个用例
    遗留的 mock 配置会经 JV-01 的设置保存回流，毒化后续用例）。"""
    e2e.run(r"""
const llm = await import(B+'assistant/llm.js');
llm.saveConfig({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', model: 'unconfigured' });
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
sessions.getActiveSession().messages.length = 0;
document.getElementById('ai-fab').click(); // 打开面板：Jev 路由卡片要渲染进会话
await sleep(100);

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
  const errEl = document.querySelector('#ai-messages .ai-msg.assistant.error');
  if (errEl) { last = { role: 'assistant', content: errEl.textContent }; break; }
}
const secs = (Date.now() - t0) / 1000;
const errEl = document.querySelector('#ai-messages .ai-msg.assistant.error');
const jevCard = [...document.querySelectorAll('#ai-messages details.ai-tool')].find(
  (d) => ((d.querySelector('summary') || {}).textContent || '').includes('⚡ Jev 路由')
);
return {
  elapsedSec: +secs.toFixed(1),
  gotAssistant: !!last && last.role === 'assistant',
  isFastAnswer: !!last && String(last.content || '').includes('⚡') && String(last.content || '').includes('快速回答'),
  chatCalls: window.__chatCalls,
  jevHeaderSmoke: window.__jevHeaders ? (window.__jevHeaders['X-Mcweb-Smoke'] || null) : null,
  jevCardShown: !!jevCard,
  jevCardAction: jevCard && jevCard.querySelector('pre').textContent.includes('直答（跳过主模型）') ? 'direct' : null,
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
        ("Jev 调用以工具卡片样式显示在会话里", res["jevCardShown"] is True and res["jevCardAction"] == "direct",
         f"shown={res.get('jevCardShown')} action={res.get('jevCardAction')}"),
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
document.getElementById('ai-fab').click(); // 打开面板：Jev 路由卡片要渲染进会话
await sleep(100);

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
const jevCard = [...document.querySelectorAll('#ai-messages details.ai-tool')].find(
  (d) => ((d.querySelector('summary') || {}).textContent || '').includes('⚡ Jev 路由')
);
return {
  elapsedSec: +secs.toFixed(1),
  notDirectAnswer: !(last && String(last.content || '').includes('快速回答')),
  reachedMainPath: !!(last && String(last.content || '').includes('尚未配置 LLM')),
  jevCardShown: !!jevCard,
  jevCardPrefetch: !!jevCard && jevCard.querySelector('pre').textContent.includes('预取知识注入首轮'),
  jevCardText: jevCard ? jevCard.querySelector('pre').textContent.slice(0, 300) : null,
  preview: last ? String(last.content || '').slice(0, 100) : null,
};
""")
    if not isinstance(res, dict) or "notDirectAnswer" not in res:
        return lib.report("JV-03 建造类放行主路径", res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
    checks = [
        ("建造类请求不触发直答", res["notDirectAnswer"] is True, str(res.get("preview"))),
        ("预取注入后照常走到主 LLM 路径（未配置 → 明确报错而非卡死）", res["reachedMainPath"] is True,
         str(res.get("preview"))),
        ("Jev 调用卡片显示且动作为预取", res["jevCardShown"] is True and res["jevCardPrefetch"] is True,
         f"shown={res.get('jevCardShown')} prefetch={res.get('jevCardPrefetch')}"),
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
document.getElementById('ai-fab').click(); // 打开面板：Jev 路由卡片要渲染进会话
await sleep(100);
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
const jevCard = [...document.querySelectorAll('#ai-messages details.ai-tool')].find(
  (d) => ((d.querySelector('summary') || {}).textContent || '').includes('⚡ Jev 路由')
);
return {
  elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
  gotAssistant: !!(last && last.role === 'assistant'),
  llmCalls: bodies.length,
  errText: window.__errText || null,
  prefetchInjected: hintMsgs.length > 0,
  hintSections: hintMsgs.length ? (String(hintMsgs[0].content).match(/【([a-z_]+)｜/g) || []) : [],
  jevCardShown: !!jevCard,
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
        ("Jev 调用卡片显示在会话里", res["jevCardShown"] is True, ""),
        ("端到端在 15s 内（Jev 路由 + mock 回复）", res["elapsedSec"] < 15, f"{res['elapsedSec']}s"),
    ]
    return lib.report("JV-04 建造系统预取注入", res, checks)


# ---------------------------------------------------------------- JV-05/06 本地 mock 网关（E3 证据回路）

MOCK = {"bodies": [], "errors": [], "responder": None}


class _MockJevHandler(BaseHTTPRequestHandler):
    """捕获 /api/jev POST body 并按 MOCK['responder'](body) 回构造好的 answers。
    浏览器跨域访问本服务器：必须补 CORS 响应头，且 Content-Type+Authorization 会触发预检 OPTIONS。"""

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            body = {}
        MOCK["bodies"].append(body)
        try:
            resp = MOCK["responder"](body)
        except Exception as e:  # responder 出错回空 answers：页面侧证据回路走 fail-open 降级
            MOCK["errors"].append(str(e))
            resp = {"answers": {}}
        data = json.dumps(resp).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # 静音：不污染烟雾输出
        pass


def start_mock_gateway(responder):
    """随机端口起本地 mock 网关，返回 (完整网关地址, httpd)。用完 httpd.shutdown()。"""
    MOCK["bodies"] = []
    MOCK["errors"] = []
    MOCK["responder"] = responder
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _MockJevHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_address[1]}/api/jev", httpd


def make_responder(evidence_high):
    """按请求类型分流：questions 含 intent = 入口路由（建造意图放行主路径）；
    含 ev_conflict/cond_* = 证据 checkpoint（按 evidence_high 回全条件高分或低分）。"""

    def respond(body):
        qs = body.get("questions") or {}
        if "ev_conflict" in qs or any(k.startswith("cond_") for k in qs):
            answers = {k: {"type": "noul", "noul": 0.92 if evidence_high else 0.15}
                       for k in qs if k.startswith("cond_")}
            answers["ev_conflict"] = {"type": "noul", "noul": 0.05 if evidence_high else 0.1}
            answers["ev_missing"] = {"type": "noul", "noul": 0.05 if evidence_high else 0.1}
            return {"answers": answers}
        # 入口路由：建造意图放行主路径（不直答），mod fan-out 全低
        answers = {
            "intent": {"type": "choice", "choice": "build", "confidence": 0.9},
            "section": {"type": "choice", "choice": "other", "confidence": 0.8},
            "is_quiz_answer": {"type": "noul", "noul": 0.01},
        }
        for mid in ("redstone", "piston", "kinetic", "logistics", "elevator", "mobs"):
            answers["mod_" + mid] = {"type": "noul", "noul": 0.05}
        return {"answers": answers}

    return respond


def inject_mock_jev_config(e2e, gateway):
    """注入指向本地 mock 网关的 Jev 配置，并把主 LLM 复位为「未配置」（用例体随后再 mock 主模型）。
    与 inject_jev_config 同纪律：fresh_page 后立刻注入（getJevConfig 运行时缓存尚未建立）。"""
    e2e.run(r"""
const llm = await import(B+'assistant/llm.js');
llm.saveConfig({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', model: 'unconfigured' });
""")
    e2e.raw_js("localStorage.setItem('mcAssistant.jev.v1', %s);" % json.dumps(
        json.dumps({
            "enabled": True,
            "apiKey": "apikey_mock_evidence",
            "gateway": gateway,
            "model": "jev-1.13.0",
        }, ensure_ascii=False),
    ))


E3_FLOW_JS = r"""
// 假主模型：按脚本逐次回复（plan_conditions → 实质工具 → 收束文本），抓全部请求体。
// 配置必须走公开 API saveConfig（直写 localStorage 会被运行时缓存挡住出假失败——见 JV-04 注释）。
const llm = await import(B+'assistant/llm.js');
llm.saveConfig({ baseUrl: 'http://mock.llm/v1', apiKey: 'sk-mock', model: 'mock-chat' });
const aui = await import(B+'assistant/ui.js');
const sessions = await import(B+'assistant/sessions.js');
sessions.getActiveSession().messages.length = 0;
document.getElementById('ai-fab').click(); // 打开面板：证据校验卡片要渲染进会话
await sleep(100);
window.__llmBodies = [];
window.__llmStep = 0;
window.__llmScript = [
  { toolCalls: [{ name: 'plan_conditions', args: { conditions: [
      { id: 'flat', text: '地基区域已清平' },
      { id: 'walls', text: '四面墙体完整无缺口' },
  ] } }] },
  { toolCalls: [{ name: 'get_game_context', args: {} }] },
  { text: '现场已核对：地基平整、四面墙体完整（mock 收束）。' },
];
if (!window.__origFetchE3) {
  window.__origFetchE3 = window.fetch;
  window.fetch = function (url, opts) {
    if (String(url || '').indexOf('chat/completions') >= 0) {
      window.__llmBodies.push(JSON.parse(opts.body));
      const i = Math.min(window.__llmStep, window.__llmScript.length - 1);
      window.__llmStep++;
      const step = window.__llmScript[i];
      const msg = {};
      if (step.toolCalls) {
        msg.content = '';
        msg.tool_calls = step.toolCalls.map((t, k) => ({
          id: 'call_' + window.__llmStep + '_' + k, type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.args) },
        }));
      } else {
        msg.content = step.text;
      }
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: msg }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return window.__origFetchE3.apply(this, arguments);
  };
}
const t0 = Date.now();
aui.sendUserMessage('盖一座测试小屋');
let last = null;
for (let i = 0; i < 100; i++) { // 最多 20s
  await sleep(200);
  const msgs = sessions.getActiveSession().messages;
  last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') break;
  const errEl = document.querySelector('#ai-messages .ai-msg.assistant.error');
  if (errEl) { window.__errText = errEl.textContent.slice(0, 300); break; }
}
const bodies = window.__llmBodies;
const hintMsgs = bodies.flatMap((b) => (b.messages || [])).filter(
  (m) => m.role === 'user' && String(m.content || '').indexOf('[⚡ 证据校验]') >= 0
);
const evCard = [...document.querySelectorAll('#ai-messages details.ai-tool')].find(
  (d) => ((d.querySelector('summary') || {}).textContent || '').includes('证据校验')
);
return {
  elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
  gotAssistant: !!(last && last.role === 'assistant'),
  finalText: last ? String(last.content || '').slice(0, 200) : null,
  llmCalls: bodies.length,
  errText: window.__errText || null,
  hintInjected: hintMsgs.length > 0,
  hintText: hintMsgs.length ? String(hintMsgs[0].content).slice(0, 200) : null,
  evCardShown: !!evCard,
  evCardText: evCard ? evCard.querySelector('pre').textContent.slice(0, 300) : null,
};
"""


def split_gateway_bodies():
    """把 mock 网关捕获的请求体按类型分流：入口路由（含 intent）/ 证据 checkpoint（含 ev_conflict）。"""
    bodies = list(MOCK["bodies"])
    route = [b for b in bodies if "intent" in (b.get("questions") or {})]
    evidence = [b for b in bodies if "ev_conflict" in (b.get("questions") or {})]
    return route, evidence


# ---------------------------------------------------------------- JV-05 条件登记与证据 checkpoint
def jv_05(e2e):
    url, httpd = start_mock_gateway(make_responder(evidence_high=True))
    try:
        e2e.fresh_page()
        inject_mock_jev_config(e2e, url)
        res = e2e.run(E3_FLOW_JS)
        if not isinstance(res, dict) or "gotAssistant" not in res:
            return lib.report("JV-05 条件登记与证据 checkpoint",
                              res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
        route_bodies, ev_bodies = split_gateway_bodies()
        qs = (ev_bodies[0].get("questions") or {}) if ev_bodies else {}
        state_text = (ev_bodies[0].get("state") or "") if ev_bodies else ""
        checks = [
            ("mock 主模型三次调用收束（登记→取证→收束）", res["gotAssistant"] and res["llmCalls"] == 3,
             json.dumps({k: res.get(k) for k in ("gotAssistant", "llmCalls", "errText")}, ensure_ascii=False)),
            ("入口路由请求照常发往网关", len(route_bodies) >= 1, f"route={len(route_bodies)}"),
            ("证据 checkpoint 请求体含每条件 cond_* noul + ev_conflict/ev_missing",
             bool(ev_bodies)
             and qs.get("cond_flat", {}).get("type") == "noul"
             and qs.get("cond_walls", {}).get("type") == "noul"
             and qs.get("ev_conflict", {}).get("type") == "noul"
             and qs.get("ev_missing", {}).get("type") == "noul",
             json.dumps(sorted(qs.keys()), ensure_ascii=False)),
            ("条件问题 instructions 携带条件原文",
             "地基区域已清平" in (qs.get("cond_flat", {}).get("instructions") or "")
             and "四面墙体完整无缺口" in (qs.get("cond_walls", {}).get("instructions") or ""), ""),
            ("state = 用户原话 + 证据摘要（≤4000，含工具结果）",
             "盖一座测试小屋" in state_text and "玩家" in state_text and len(state_text) <= 4000,
             f"len={len(state_text)} head={state_text[:80]}"),
            ("门通过：不注入缺口提示、直接收束", not res["hintInjected"], str(res.get("hintText"))),
            ("证据校验卡片显示在会话里", res["evCardShown"] is True, str(res.get("evCardText"))[:160]),
            ("端到端 15s 内（本地 mock 网关 + mock 主模型）", res["elapsedSec"] < 15, f"{res['elapsedSec']}s"),
        ]
        return lib.report("JV-05 条件登记与证据 checkpoint",
                          {"browser": res, "routeBodies": len(route_bodies), "evBodies": len(ev_bodies)}, checks)
    finally:
        httpd.shutdown()


# ---------------------------------------------------------------- JV-06 低分缺口注入与续检收束
def jv_06(e2e):
    url, httpd = start_mock_gateway(make_responder(evidence_high=False))
    try:
        e2e.fresh_page()
        inject_mock_jev_config(e2e, url)
        res = e2e.run(E3_FLOW_JS)
        if not isinstance(res, dict) or "gotAssistant" not in res:
            return lib.report("JV-06 低分缺口注入与续检收束",
                              res if isinstance(res, dict) else {"__error__": str(res)[:500]}, [])
        _, ev_bodies = split_gateway_bodies()
        checks = [
            ("低分 → 缺口提示注入下一次 LLM 请求（含条件原文）",
             res["hintInjected"] and "地基区域已清平" in (res["hintText"] or ""),
             str(res.get("hintText"))),
            ("提示指名补证工具（一句话模板）",
             "scan_terrain" in (res["hintText"] or "") or "read_blocks" in (res["hintText"] or ""),
             str(res.get("hintText"))[:160]),
            ("续检预算受控：checkpoint ≤2 次", 1 <= len(ev_bodies) <= 2, f"ev={len(ev_bodies)}"),
            ("缺口续跑后正常收束（续检 2 轮预算用尽放行）", res["gotAssistant"] and res["llmCalls"] == 4,
             json.dumps({k: res.get(k) for k in ("gotAssistant", "llmCalls", "errText")}, ensure_ascii=False)),
            ("收束文本尾注未核验项", "证据校验未全部通过" in (res["finalText"] or ""),
             str(res.get("finalText"))[:160]),
            ("证据校验卡片显示门控未过", res["evCardShown"] is True and "未过" in (res["evCardText"] or ""),
             str(res.get("evCardText"))[:160]),
            ("端到端 15s 内", res["elapsedSec"] < 15, f"{res['elapsedSec']}s"),
        ]
        return lib.report("JV-06 低分缺口注入与续检收束",
                          {"browser": res, "evBodies": len(ev_bodies)}, checks)
    finally:
        httpd.shutdown()


CASES = {"JV-01": jv_01, "JV-02": jv_02, "JV-03": jv_03, "JV-04": jv_04,
         "JV-05": jv_05, "JV-06": jv_06}
REAL_RELAY_CASES = {"JV-02", "JV-03", "JV-04"}  # 需要真网关 + 真模型
KEY_ONLY_CASES = {"JV-01"}  # 只断言 KEY 回填（网关用占位地址），有 KEY 即可跑
MOCK_CASES = {"JV-05", "JV-06"}  # 本地 mock 网关自闭环，不依赖任何 env

if __name__ == "__main__":
    want = sys.argv[1:] or list(CASES)
    e2e = lib.E2E()
    ok = True
    try:
        for name in want:
            if (name in REAL_RELAY_CASES and not HAVE_RELAY) or (name in KEY_ONLY_CASES and not KEY):
                print(f"===== {name}: SKIP（未配置 TYPESAFE_API_KEY / JEV_GATEWAY）=====")
                continue
            e2e.fresh_page()
            ok = CASES[name](e2e) and ok
    finally:
        e2e.close()
    sys.exit(0 if ok else 1)
