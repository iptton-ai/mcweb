// ==================== assistant/ui.js ====================
// AI 助手会话窗口：右侧滑入面板 + 会话列表 + 设置 + 消息/工具卡片渲染
// 全部 DOM 与样式由本模块注入，游戏 HTML 无需改动（只加载 boot.js）。

import { runAgentTurn } from './agent.js';
import { DEFAULT_CONFIG, getConfig, isConfigured, saveConfig } from './llm.js';
import {
    createSession, deleteSession, getActiveSession, listSessions, setActiveSession,
    autoTitle, touchSession,
} from './sessions.js';
import { setAssistantVisible, togglePauseMenu } from '../uiModal.js';

// ---------- 样式 ----------
const STYLE = `
#ai-fab{position:fixed;top:12px;right:12px;z-index:105;width:46px;height:46px;border-radius:10px;
  background:rgba(30,30,50,.92);border:2px solid #4a4a6a;color:#fff;font-size:22px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;transition:border-color .15s;}
#ai-fab:hover{border-color:#7ec850;}
#ai-fab.dirty::after{content:'';position:absolute;top:5px;right:5px;width:10px;height:10px;border-radius:50%;
  background:#7ec850;box-shadow:0 0 8px #7ec850;}
/* 面板层级高于开始界面(100)/死亡界面(90)：首屏或死亡时也能唤出助手 */
#ai-panel{position:fixed;top:0;right:0;bottom:0;width:min(430px,100vw);z-index:110;
  background:rgba(18,18,32,.97);border-left:3px solid #4a4a6a;display:flex;flex-direction:column;
  font-family:'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#e0e0e0;user-select:text;}
#ai-panel.hidden,#ai-sessions.hidden,#ai-settings.hidden,#ai-toast.hidden{display:none;}
#ai-header{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;
  border-bottom:2px solid #2d2d44;flex:0 0 auto;}
#ai-title{font-size:15px;font-weight:bold;}
#ai-model-badge{font-size:11px;color:#7ec850;border:1px solid #3a5a2a;padding:1px 7px;border-radius:9px;margin-left:8px;font-weight:normal;}
#ai-header-btns{display:flex;gap:4px;}
#ai-header button{background:transparent;border:none;color:#c0c0d8;font-size:16px;cursor:pointer;
  width:30px;height:30px;border-radius:6px;}
#ai-header button:hover{background:#2d2d4a;color:#fff;}
#ai-btn-reload.dirty{color:#7ec850;text-shadow:0 0 8px #7ec850;}
#ai-messages{flex:1 1 auto;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:9px;}
#ai-messages::-webkit-scrollbar{width:8px;}
#ai-messages::-webkit-scrollbar-thumb{background:#3d3d5c;border-radius:4px;}
.ai-msg{max-width:94%;line-height:1.55;font-size:13.5px;word-break:break-word;}
.ai-msg.user{align-self:flex-end;background:#2d4a2d;border:1px solid #4a7a3a;padding:8px 11px;
  border-radius:10px 10px 2px 10px;white-space:pre-wrap;}
.ai-msg.assistant{align-self:flex-start;display:flex;flex-direction:column;gap:4px;}
.ai-msg .ai-md{background:rgba(40,40,64,.6);border:1px solid #33334f;padding:8px 11px;border-radius:10px 10px 10px 2px;}
.ai-msg.error .ai-md{border-color:#a03030;background:rgba(64,20,20,.6);}
.ai-msg.system-event{align-self:center;font-size:12px;color:#9a9ab0;background:rgba(40,40,64,.5);
  padding:4px 12px;border-radius:10px;max-width:96%;}
.ai-md p{margin:3px 0;}
.ai-md h4{margin:6px 0 2px;color:#7ec850;}
.ai-md ul,.ai-md ol{margin:4px 0;padding-left:18px;}
.ai-md code{font-family:Consolas,monospace;font-size:12px;color:#a0d0ff;background:#14142a;padding:1px 4px;border-radius:4px;}
.ai-md pre{background:#111120;border:1px solid #33334f;padding:8px;border-radius:6px;overflow-x:auto;margin:6px 0;}
.ai-md pre code{background:transparent;color:#a8c8e8;padding:0;}
.ai-tool{width:100%;border:1px solid #3a3a58;border-radius:8px;background:rgba(30,30,50,.72);font-size:12px;}
.ai-tool summary{cursor:pointer;padding:6px 9px;color:#c8b070;list-style:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ai-tool summary::marker{content:'';}
.ai-tool.pending summary{color:#e0c060;}
.ai-tool pre{max-height:230px;overflow:auto;margin:0;padding:8px;border-top:1px solid #2d2d44;
  font-size:11px;color:#a8c8e8;white-space:pre-wrap;word-break:break-all;font-family:Consolas,monospace;}
.ai-tool .ok{color:#7ec850;}
.ai-tool .err{color:#ff7a6a;}
.ai-think{width:100%;border:1px solid #2d2d44;border-radius:8px;background:rgba(26,26,44,.72);font-size:12px;}
.ai-think summary{cursor:pointer;padding:5px 9px;color:#8f8fc8;list-style:none;user-select:none;}
.ai-think summary::marker{content:'';}
.ai-think.streaming summary{color:#b8a8f0;}
.ai-think.streaming summary::after{content:' …';animation:ai-think-pulse 1.2s infinite;}
@keyframes ai-think-pulse{0%,100%{opacity:.3;}50%{opacity:1;}}
.ai-think .think-body{max-height:230px;overflow-y:auto;margin:0;padding:7px 10px;border-top:1px solid #2d2d44;
  color:#9a9ab8;white-space:pre-wrap;word-break:break-word;line-height:1.5;font-size:11.5px;}
#ai-status{flex:0 0 auto;min-height:18px;padding:1px 12px 4px;font-size:12px;color:#8a8ab0;}
#ai-composer{flex:0 0 auto;display:flex;gap:8px;padding:10px;border-top:2px solid #2d2d44;}
#ai-input{flex:1;resize:none;background:#1c1c30;border:2px solid #3d3d5c;border-radius:8px;color:#fff;
  padding:8px 10px;font-size:13.5px;font-family:inherit;outline:none;line-height:1.5;}
#ai-input:focus{border-color:#7ec850;}
#ai-send{width:46px;border-radius:8px;background:#7ec850;border:none;color:#12300a;font-size:17px;
  cursor:pointer;font-weight:bold;}
#ai-send.stop{background:#e06050;color:#fff;}
#ai-sessions{position:absolute;top:50px;left:8px;right:8px;max-height:62%;min-height:120px;
  background:rgba(20,20,36,.99);border:2px solid #4a4a6a;border-radius:10px;z-index:6;
  display:flex;flex-direction:column;overflow:hidden;}
.ai-sessions-head{display:flex;justify-content:space-between;align-items:center;padding:9px 11px;
  border-bottom:2px solid #2d2d44;font-size:13px;font-weight:bold;}
.ai-sessions-head button{background:#2d2d4a;color:#fff;border:1px solid #4a4a6a;border-radius:6px;
  padding:3px 9px;cursor:pointer;font-size:12px;}
#ai-sessions-list{list-style:none;margin:0;padding:5px;overflow-y:auto;flex:1;}
.ai-session-item{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:7px 9px;
  border-radius:6px;cursor:pointer;font-size:13px;}
.ai-session-item:hover{background:#2d2d4a;}
.ai-session-item.active{background:#2d4a2d;}
.ai-session-item .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ai-session-item .d{font-size:11px;color:#8888a8;}
.ai-session-del{background:none;border:none;color:#8888a8;cursor:pointer;font-size:13px;}
.ai-session-del:hover{color:#ff7a6a;}
#ai-settings{position:absolute;inset:0;background:rgba(14,14,26,.99);z-index:7;padding:16px;
  overflow-y:auto;font-size:13px;display:flex;flex-direction:column;gap:11px;}
#ai-settings h3{margin:0;color:#fff;font-size:16px;}
#ai-settings label{color:#9ab;font-size:12px;display:block;margin-bottom:3px;}
#ai-settings input[type=text],#ai-settings input[type=password],#ai-settings input[type=number],
#ai-settings select,#ai-settings textarea{width:100%;background:#1c1c30;border:2px solid #3d3d5c;border-radius:6px;color:#fff;
  padding:7px 9px;font-size:13px;font-family:inherit;outline:none;}
#ai-settings select option{background:#1c1c30;color:#fff;}
#ai-settings input:focus,#ai-settings select:focus,#ai-settings textarea:focus{border-color:#7ec850;}
#ai-settings textarea{min-height:74px;resize:vertical;line-height:1.5;}
#ai-settings .row{display:flex;gap:10px;}
#ai-settings .row>div{flex:1;}
#ai-settings .check{display:flex;align-items:center;gap:6px;color:#c0c0d8;font-size:13px;cursor:pointer;}
#ai-settings .hint{color:#77779a;font-size:11.5px;line-height:1.5;}
.ai-settings-actions{display:flex;gap:8px;margin-top:4px;}
.ai-btn{background:#2d2d4a;color:#e0e0e0;border:1px solid #4a4a6a;border-radius:6px;padding:8px 16px;
  cursor:pointer;font-size:13px;font-family:inherit;}
.ai-btn:hover{border-color:#7ec850;}
.ai-btn.primary{background:#7ec850;color:#12300a;border-color:#7ec850;font-weight:bold;}
#ai-toast{position:fixed;left:14px;bottom:96px;z-index:120;background:rgba(30,30,50,.96);
  border:2px solid #4a4a6a;border-radius:8px;padding:8px 13px;color:#fff;font-size:13px;
  max-width:360px;transition:opacity .35s;pointer-events:none;}
`;

// ---------- 模块状态 ----------
let els = {};            // DOM 引用
let dirty = false;       // 是否有未应用的文件修改
let running = false;     // 是否正在执行 agent 轮次
let abortCtrl = null;    // 停止按钮用的控制器
let streamEl = null;     // 流式渲染中的气泡
let streamText = '';
let streamDirty = false; // 节流渲染标记
let pendingToolCards = []; // 等待结果的工具卡片队列
let thinkEl = null;      // 气泡内的「思考过程」折叠卡片（流式期间引用）
let thinkBody = null;
let thinkText = '';
let thinkDirty = false;
let thinkTouched = false;   // 用户手动点过折叠头，之后不再自动收起
let contentStarted = false; // 本条流式消息是否已开始输出正文（开始即收起思考卡）

// ---------- 工具函数 ----------
function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 极简 Markdown 渲染：代码块/行内代码/加粗/小标题/列表/段落
function renderMarkdown(src) {
    const codes = [];
    src = String(src ?? '').replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
        codes.push(code);
        return `\u0000C${codes.length - 1}\u0000`;
    });
    const lines = esc(src).split('\n');
    const out = [];
    let list = null; // 'ul' | 'ol' | null
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const line of lines) {
        const t = line.trim();
        if (!t) { closeList(); continue; }
        let m;
        if ((m = t.match(/^#{1,4}\s+(.+)$/))) { closeList(); out.push(`<h4>${m[1]}</h4>`); continue; }
        if ((m = t.match(/^[-*]\s+(.+)$/))) {
            if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
            out.push(`<li>${inline(m[1])}</li>`); continue;
        }
        if ((m = t.match(/^\d+[.、]\s+(.+)$/))) {
            if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
            out.push(`<li>${inline(m[1])}</li>`); continue;
        }
        closeList();
        out.push(`<p>${inline(t)}</p>`);
    }
    closeList();
    let html = out.join('');
    html = html.replace(/\u0000C(\d+)\u0000/g, (m, i) => `<pre><code>${esc(codes[+i])}</code></pre>`);
    return html;

    function inline(s) {
        return s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    }
}

function fmtTime(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function scrollBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
}

// ---------- LLM 预设服务商 ----------
// 仅作「快速填入」：选中后回填 API 地址与模型名，输入框仍可自由修改；
// 打开设置时按当前地址反向匹配高亮预设，对不上就显示「自定义」。
// 地址均为 OpenAI 兼容 baseUrl（llm.js 自动拼 /chat/completions）。
const PROVIDER_PRESETS = [
    { id: 'zhipu', name: '智谱 GLM Coding Plan', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'] },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner'] },
    { id: 'kimi', name: 'Kimi Code Plan（月之暗面）', baseUrl: 'https://api.kimi.com/coding/v1',
      models: ['kimi-k2-turbo-preview', 'kimi-k2-0905-preview', 'kimi-k2-thinking'] },
    { id: 'ollama', name: 'Ollama（本机）', baseUrl: 'http://localhost:11434/v1',
      models: ['qwen3:8b', 'llama3.1:8b', 'deepseek-r1:8b'] },
];

// ---------- DOM 构建 ----------
function buildDom() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'ai-fab';
    fab.title = 'AI 助手（按 T 打开）';
    fab.textContent = '🤖';

    const panel = document.createElement('aside');
    panel.id = 'ai-panel';
    panel.className = 'hidden';
    panel.innerHTML = `
      <header id="ai-header">
        <div id="ai-title">🤖 AI 助手<span id="ai-model-badge">未配置</span></div>
        <div id="ai-header-btns">
          <button id="ai-btn-new" title="新会话">＋</button>
          <button id="ai-btn-sessions" title="会话列表">🕘</button>
          <button id="ai-btn-reload" title="热重载游戏（应用文件修改）">🔄</button>
          <button id="ai-btn-settings" title="LLM 设置">⚙️</button>
          <button id="ai-btn-close" title="关闭（Esc / T）">✕</button>
        </div>
      </header>
      <div id="ai-sessions" class="hidden">
        <div class="ai-sessions-head">会话列表<button id="ai-btn-new2">＋ 新会话</button></div>
        <ul id="ai-sessions-list"></ul>
      </div>
      <main id="ai-messages"></main>
      <div id="ai-status"></div>
      <footer id="ai-composer">
        <textarea id="ai-input" rows="2" placeholder="让 AI 建造结构、修改游戏…（Enter 发送，Shift+Enter 换行）"></textarea>
        <button id="ai-send" title="发送">➤</button>
      </footer>
      <div id="ai-settings" class="hidden">
        <h3>⚙️ LLM 设置</h3>
        <div><label>预设服务商（快速填入地址与模型，之后仍可手动修改）</label>
          <select id="ai-set-preset"></select></div>
        <div><label>API 地址（OpenAI 兼容，填到 /v1）</label>
          <input type="text" id="ai-set-baseurl" placeholder="https://api.deepseek.com/v1"></div>
        <div><label>API Key</label>
          <input type="password" id="ai-set-key" placeholder="sk-…"></div>
        <div class="row">
          <div><label>模型</label><input type="text" id="ai-set-model" list="ai-model-list" placeholder="deepseek-chat"></div>
          <div><label>温度</label><input type="number" id="ai-set-temp" step="0.1" min="0" max="2"></div>
          <div><label>工具轮数上限</label><input type="number" id="ai-set-iters" step="1" min="1" max="100"></div>
        </div>
        <datalist id="ai-model-list"></datalist>
        <div><label>附加系统提示词（可选，追加在游戏档案之后）</label>
          <textarea id="ai-set-extra" placeholder="例如：回复尽量简短；建造风格偏好现代简约…"></textarea></div>
        <div class="hint">密钥仅保存在本机 localStorage；LLM 请求由浏览器直连上游接口（需上游允许跨域）。
        选 Ollama 无需真实 Key，填任意非空值即可（如 ollama）；HTTPS 页面无法直连本机 http 接口。
        文件读写/热重载依赖 server.py（python3 server.py 启动）。</div>
        <div class="ai-settings-actions">
          <button class="ai-btn primary" id="ai-set-save">保存</button>
          <button class="ai-btn" id="ai-set-cancel">取消</button>
        </div>
      </div>
    `;
    const toast = document.createElement('div');
    toast.id = 'ai-toast';
    toast.className = 'hidden';
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    document.body.appendChild(toast);

    els = {
        fab, panel, toast,
        modelBadge: panel.querySelector('#ai-model-badge'),
        messages: panel.querySelector('#ai-messages'),
        status: panel.querySelector('#ai-status'),
        input: panel.querySelector('#ai-input'),
        send: panel.querySelector('#ai-send'),
        sessions: panel.querySelector('#ai-sessions'),
        sessionsList: panel.querySelector('#ai-sessions-list'),
        settings: panel.querySelector('#ai-settings'),
        btnReload: panel.querySelector('#ai-btn-reload'),
    };

    // 事件绑定
    fab.addEventListener('click', togglePanel);
    panel.querySelector('#ai-btn-close').addEventListener('click', closePanel);
    panel.querySelector('#ai-btn-new').addEventListener('click', () => newSession());
    panel.querySelector('#ai-btn-new2').addEventListener('click', () => newSession());
    panel.querySelector('#ai-btn-sessions').addEventListener('click', toggleSessions);
    els.btnReload.addEventListener('click', manualReload);
    panel.querySelector('#ai-btn-settings').addEventListener('click', openSettings);
    panel.querySelector('#ai-set-cancel').addEventListener('click', () => els.settings.classList.add('hidden'));
    panel.querySelector('#ai-set-save').addEventListener('click', saveSettings);
    els.send.addEventListener('click', () => { running ? stopRun() : trySend(); });
    els.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!running) trySend();
        }
    });
    // 面板内点击不冒泡到游戏（游戏会抢指针锁定）
    panel.addEventListener('click', (e) => e.stopPropagation());

    // 预设服务商下拉：选中即回填地址与模型名（自定义选项不回填）
    const presetSel = panel.querySelector('#ai-set-preset');
    for (const p of PROVIDER_PRESETS) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name}（${p.baseUrl}）`;
        presetSel.appendChild(opt);
    }
    const optCustom = document.createElement('option');
    optCustom.value = 'custom';
    optCustom.textContent = '自定义（手动填写）';
    presetSel.appendChild(optCustom);
    presetSel.addEventListener('change', () => {
        const p = PROVIDER_PRESETS.find((x) => x.id === presetSel.value);
        if (!p) return;
        panel.querySelector('#ai-set-baseurl').value = p.baseUrl;
        panel.querySelector('#ai-set-model').value = p.models[0];
        fillModelSuggestions(p);
    });
}

// 模型输入框的下拉候选：跟随所选预设；自定义时给出全部预设模型的并集
function fillModelSuggestions(preset) {
    const dl = els.settings.querySelector('#ai-model-list');
    const models = preset ? preset.models : [...new Set(PROVIDER_PRESETS.flatMap((p) => p.models))];
    dl.innerHTML = models.map((m) => `<option value="${m}"></option>`).join('');
}

// ---------- 键盘（捕获阶段，优先于游戏输入） ----------
// 面板是「不阻塞游戏的侧栏」：只拦截 Esc 与 T，其余按键放行给游戏——
// AI 建造时面板开着也能用 WASD/E/M/1-9 继续玩；在聊天框打字时由输入焦点天然隔离。
export function handleKeydown(e) {
    if (els.panel.classList.contains('hidden')) {
        if (e.code === 'KeyT') {
            e.preventDefault();
            e.stopPropagation();
            openPanel();
        }
        return;
    }
    if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!els.settings.classList.contains('hidden')) els.settings.classList.add('hidden');
        else if (!els.sessions.classList.contains('hidden')) els.sessions.classList.add('hidden');
        else togglePauseMenu(); // Esc = 暂停/回到游戏，面板保持打开（z-index 高于菜单）
    } else if (e.code === 'KeyT' && document.activeElement !== els.input) {
        e.preventDefault();
        e.stopPropagation();
        closePanel();
    }
}

// ---------- 面板开关 ----------
function openPanel() {
    els.panel.classList.remove('hidden');
    // 状态机负责让指针锁让位（鼠标归面板）；游戏状态不受影响，关闭后照常继续
    setAssistantVisible(true);
    renderAll(getActiveSession());
    updateModelBadge();
    setTimeout(() => els.input.focus(), 50);
}

function closePanel() {
    els.panel.classList.add('hidden');
    els.sessions.classList.add('hidden');
    els.settings.classList.add('hidden');
    setAssistantVisible(false); // 面板关闭且处于 playing 时，状态机自动恢复指针锁
}

function togglePanel() {
    els.panel.classList.contains('hidden') ? openPanel() : closePanel();
}

// ---------- 渲染 ----------
function updateModelBadge() {
    els.modelBadge.textContent = isConfigured() ? getConfig().model : '未配置';
}

function toolCard(name, argsText) {
    const details = document.createElement('details');
    details.className = 'ai-tool pending';
    const summary = document.createElement('summary');
    summary.innerHTML = `🔧 ${esc(name)} <span class="st">执行中…</span>`;
    const pre = document.createElement('pre');
    pre.textContent = argsText;
    details.appendChild(summary);
    details.appendChild(pre);
    return details;
}

function setCardResult(card, resultText, isError) {
    card.classList.remove('pending');
    card.classList.add(isError ? 'err' : 'done');
    card.querySelector('.st').innerHTML = isError
        ? '<span class="err">✗ 失败</span>'
        : '<span class="ok">✓ 完成</span>';
    const pre = card.querySelector('pre');
    pre.textContent = (pre.textContent ? pre.textContent + '\n───── 结果 ─────\n' : '') + resultText;
    if (!card.open) card.open = isError; // 失败自动展开
}

// 思考过程折叠卡片（reasoning 本机展示用；streaming=true 表示思考仍在流式输出）
function buildThinkCard(reasoning, streaming = false) {
    const details = document.createElement('details');
    details.className = 'ai-think' + (streaming ? ' streaming' : '');
    details.open = streaming;
    const summary = document.createElement('summary');
    summary.textContent = streaming ? '💭 思考中' : '💭 思考过程';
    const body = document.createElement('div');
    body.className = 'think-body';
    if (reasoning) body.textContent = reasoning;
    details.appendChild(summary);
    details.appendChild(body);
    return { details, summary, body };
}

function renderMsg(msg) {
    const div = document.createElement('div');
    if (msg.role === 'user') {
        div.className = msg.meta === 'system' ? 'ai-msg system-event' : 'ai-msg user';
        div.textContent = msg.content;
    } else if (msg.role === 'assistant') {
        div.className = 'ai-msg assistant';
        if (msg.reasoning) div.appendChild(buildThinkCard(msg.reasoning).details);
        if (msg.content) {
            const md = document.createElement('div');
            md.className = 'ai-md';
            md.innerHTML = renderMarkdown(msg.content);
            div.appendChild(md);
        }
        for (const tc of msg.toolCalls || []) {
            const card = toolCard(tc.name, fmtArgs(tc.arguments));
            setCardResultFromToolMsg(card, tc.id);
            div.appendChild(card);
        }
    } else if (msg.role === 'tool') {
        return null; // 工具结果已并入上面的卡片
    }
    els.messages.appendChild(div);
    return div;
}

function fmtArgs(argsJson) {
    try {
        const obj = JSON.parse(argsJson || '{}');
        const s = JSON.stringify(obj, null, 1);
        return s.length > 2000 ? s.slice(0, 2000) + '…' : s;
    } catch {
        return String(argsJson || '').slice(0, 2000);
    }
}

// 重建历史时：把 tool 消息的结果回填到对应卡片的索引
let renderToolIndex = new Map();
function setCardResultFromToolMsg(card, toolCallId) {
    renderToolIndex.set(toolCallId, card);
}

function renderAll(session) {
    renderToolIndex = new Map();
    els.messages.innerHTML = '';
    // 先收集 tool 消息（id → 结果），供卡片回填
    const toolResults = new Map();
    for (const m of session.messages) {
        if (m.role === 'tool') toolResults.set(m.toolCallId, m);
    }
    // 顺序渲染（tool 消息的结果已并入 assistant 的工具卡片，不单独渲染）
    for (const m of session.messages) {
        if (m.role === 'tool') continue;
        renderMsg(m);
    }
    fillResults(toolResults);
    scrollBottom();
}

function fillResults(toolResults) {
    for (const [id, m] of toolResults) {
        const card = renderToolIndex.get(id);
        if (card) setCardResult(card, m.content, !!m.isError);
    }
}

// ---------- 会话列表 ----------
function renderSessions() {
    els.sessionsList.innerHTML = '';
    const active = getActiveSession();
    for (const s of listSessions()) {
        const li = document.createElement('li');
        li.className = 'ai-session-item' + (s.id === active.id ? ' active' : '');
        li.innerHTML = `<span class="t">${esc(s.title)}</span><span class="d">${fmtTime(s.updatedAt)}</span>`;
        const del = document.createElement('button');
        del.className = 'ai-session-del';
        del.textContent = '✕';
        del.title = '删除会话';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSession(s.id);
            renderSessions();
            renderAll(getActiveSession());
        });
        li.appendChild(del);
        li.addEventListener('click', () => {
            setActiveSession(s.id);
            renderSessions();
            renderAll(getActiveSession());
            els.sessions.classList.add('hidden');
        });
        els.sessionsList.appendChild(li);
    }
}

function toggleSessions() {
    els.sessions.classList.toggle('hidden');
    if (!els.sessions.classList.contains('hidden')) renderSessions();
}

function newSession() {
    createSession();
    renderSessions();
    renderAll(getActiveSession());
    els.sessions.classList.add('hidden');
    els.input.focus();
}

// ---------- 设置 ----------
// 地址按「去掉末尾斜杠」归一后比较，/v1 与 /v1/ 视为同一家
function matchPreset(baseUrl) {
    const norm = (u) => (u || '').trim().replace(/\/+$/, '');
    return PROVIDER_PRESETS.find((p) => norm(p.baseUrl) === norm(baseUrl));
}

function openSettings() {
    const c = getConfig();
    const hit = matchPreset(c.baseUrl);
    els.settings.querySelector('#ai-set-preset').value = hit ? hit.id : 'custom';
    els.settings.querySelector('#ai-set-baseurl').value = c.baseUrl;
    els.settings.querySelector('#ai-set-key').value = c.apiKey;
    els.settings.querySelector('#ai-set-model').value = c.model;
    els.settings.querySelector('#ai-set-temp').value = c.temperature;
    els.settings.querySelector('#ai-set-iters').value = c.maxToolIterations;
    els.settings.querySelector('#ai-set-extra').value = c.extraInstructions || '';
    fillModelSuggestions(hit);
    els.settings.classList.remove('hidden');
}

function saveSettings() {
    saveConfig({
        baseUrl: els.settings.querySelector('#ai-set-baseurl').value.trim() || DEFAULT_CONFIG.baseUrl,
        apiKey: els.settings.querySelector('#ai-set-key').value.trim(),
        model: els.settings.querySelector('#ai-set-model').value.trim() || DEFAULT_CONFIG.model,
        temperature: Number(els.settings.querySelector('#ai-set-temp').value) || 0.7,
        maxToolIterations: Number(els.settings.querySelector('#ai-set-iters').value) || 30,
        extraInstructions: els.settings.querySelector('#ai-set-extra').value,
    });
    els.settings.classList.add('hidden');
    updateModelBadge();
    toast('✅ 设置已保存');
}

// ---------- 提示条 / 状态 ----------
let toastTimer = null;
export function toast(text, ms = 2600) {
    els.toast.textContent = text;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

function setStatus(text) {
    els.status.textContent = text || '';
}

// ---------- 文件变更标记（热重载提示） ----------
export function setReloadDirty(v, path) {
    dirty = v;
    els.fab.classList.toggle('dirty', v);
    els.btnReload.classList.toggle('dirty', v);
    if (v && path) toast(`📝 文件已修改：${path}\n（调用 AI「重载」或点面板 🔄 生效）`, 3400);
}

// 手动热重载：存快照 → 刷新（恢复逻辑在 snapshot.js / index.js）
function manualReload() {
    import('./snapshot.js').then(({ saveSnapshotForReload }) => {
        saveSnapshotForReload();
        sessionStorage.setItem('mcAssistant.resumeTask', JSON.stringify({ sessionId: getActiveSession().id, at: Date.now() }));
        location.reload();
    });
}

// ---------- 消息发送与 agent 驱动 ----------
function setRunning(v) {
    running = v;
    els.send.textContent = v ? '⏹' : '➤';
    els.send.classList.toggle('stop', v);
    els.send.title = v ? '停止' : '发送';
    els.input.disabled = v;
}

function stopRun() {
    abortCtrl?.abort();
}

function ensureStreamBubble() {
    if (!streamEl) {
        streamEl = document.createElement('div');
        streamEl.className = 'ai-msg assistant';
        const md = document.createElement('div');
        md.className = 'ai-md';
        md.innerHTML = '<p></p>';
        streamEl.appendChild(md);
        els.messages.appendChild(streamEl);
        streamText = '';
        contentStarted = false;
        scrollBottom();
    }
}

// 流式思考卡片：插在正文前面，思考中自动展开，出正文/结束后收起（可手动点开）
function ensureThinkCard() {
    if (thinkEl || !streamEl) return;
    const { details, summary, body } = buildThinkCard('', true);
    summary.addEventListener('click', () => { thinkTouched = true; }); // 手动开合后不再自动收起
    streamEl.insertBefore(details, streamEl.querySelector('.ai-md'));
    thinkEl = details;
    thinkBody = body;
    thinkText = '';
    thinkTouched = false;
}

// 思考结束（正文开始或消息定型）：去掉流式动效，未手动操作则收起
function sealThinkCard() {
    if (!thinkEl) return;
    thinkEl.classList.remove('streaming');
    thinkEl.querySelector('summary').textContent = '💭 思考过程';
    if (!thinkTouched) thinkEl.open = false;
}

function flushStream() {
    if (!streamDirty && !thinkDirty) return;
    const needThink = thinkDirty;
    const needText = streamDirty;
    streamDirty = false;
    thinkDirty = false;
    if (needThink && thinkBody) {
        thinkBody.textContent = thinkText;
        thinkBody.scrollTop = thinkBody.scrollHeight; // 思考体内部滚动跟随
        scrollBottom();
    }
    if (needText && streamEl) {
        streamEl.querySelector('.ai-md').innerHTML = renderMarkdown(streamText) || '<p>…</p>';
        scrollBottom();
    }
}

// 定型流式气泡：思考卡收起、正文渲染最终 Markdown；正文为空则移除正文框（纯思考/纯工具回合）。
// 返回气泡元素（工具卡片等可直接并入其中），无气泡（如非流式上游）返回 null
function finishStreamBubble(content, reasoning) {
    if (!streamEl) return null;
    const el = streamEl;
    if (thinkEl) {
        sealThinkCard();
        if (reasoning) thinkBody.textContent = reasoning;
        thinkEl = null;
        thinkBody = null;
    }
    const md = el.querySelector('.ai-md');
    const html = renderMarkdown(content) || '';
    if (html) md.innerHTML = html;
    else md.remove();
    streamEl = null;
    scrollBottom();
    return el;
}

function dropStreamBubble() {
    streamEl?.remove();
    streamEl = null;
    thinkEl = null;
    thinkBody = null;
}

async function trySend() {
    const text = els.input.value.trim();
    if (!text) return;
    els.input.value = '';
    await sendUserMessage(text);
}

export async function sendUserMessage(text, { hidden = false } = {}) {
    if (running) return;
    const session = getActiveSession();
    session.messages.push({ role: 'user', content: text, meta: hidden ? 'system' : undefined });
    autoTitle(session);
    touchSession(session);
    if (!els.panel.classList.contains('hidden')) {
        renderMsg(session.messages[session.messages.length - 1]);
        scrollBottom();
    }
    await runTurn(session);
}

async function runTurn(session) {
    setRunning(true);
    pendingToolCards = [];
    abortCtrl = new AbortController();
    streamEl = null;
    thinkEl = null;
    thinkBody = null;
    // 状态栏附带耗时：请求慢/卡住时一眼可见，不会像冻结一样没反馈
    const turnStartAt = Date.now();
    let statusBase = '';
    const statusTimer = setInterval(() => {
        if (statusBase) els.status.textContent = `${statusBase} · ${Math.round((Date.now() - turnStartAt) / 1000)}s`;
    }, 1000);
    const reportStatus = (text) => {
        statusBase = text;
        els.status.textContent = text || '';
    };
    try {
        const res = await runAgentTurn({
            session,
            signal: abortCtrl.signal,
            onReasoningText: (full) => {
                ensureStreamBubble();
                ensureThinkCard();
                thinkText = full;
                thinkDirty = true;
                requestAnimationFrame(flushStream);
                setTimeout(flushStream, 300); // 兜底：webview 遮挡时 rAF 可能不触发
            },
            onStreamText: (full) => {
                ensureStreamBubble();
                if (!contentStarted) {
                    contentStarted = true;
                    sealThinkCard(); // 正文开始输出：思考卡收起（仍可点开回看）
                }
                streamText = full;
                streamDirty = true;
                requestAnimationFrame(flushStream);
                setTimeout(flushStream, 300); // 兜底：webview 遮挡时 rAF 可能不触发（streamDirty 防重复刷新）
            },
            onAssistantDone: (msg) => {
                const hadBubble = !!streamEl;
                const bubble = finishStreamBubble(msg.content, msg.reasoning);
                if (els.panel.classList.contains('hidden')) return;
                if (!hadBubble) {
                    // 非流式上游（整体 JSON）：没有流式气泡，整条消息按历史样式补渲染
                    renderMsg(msg);
                    scrollBottom();
                    return;
                }
                // 渲染该 assistant 消息（思考卡与正文已由流式气泡展示，这里补工具卡片）
                const div = document.createElement('div');
                for (const tc of msg.toolCalls || []) {
                    const card = toolCard(tc.name, fmtArgs(tc.arguments));
                    pendingToolCards.push({ id: tc.id, card });
                    div.appendChild(card);
                }
                if (div.childNodes.length > 0) {
                    (bubble || els.messages).appendChild(div);
                    scrollBottom();
                }
            },
            onToolResult: (toolMsg) => {
                const item = pendingToolCards.find((c) => c.id === toolMsg.toolCallId);
                if (item) setCardResult(item.card, toolMsg.content, !!toolMsg.isError);
                scrollBottom();
            },
            onStatus: reportStatus,
        });
        reportStatus('');
        if (res.reloading) {
            reportStatus('🔄 正在热重载页面…');
        }
    } catch (e) {
        dropStreamBubble(); // 出错/中止：丢弃半截流式气泡（含未定型的思考卡）
        if (e.name === 'AbortError') {
            const div = document.createElement('div');
            div.className = 'ai-msg system-event';
            div.textContent = '⏹ 已停止';
            els.messages.appendChild(div);
        } else {
            const div = document.createElement('div');
            div.className = 'ai-msg assistant error';
            const md = document.createElement('div');
            md.className = 'ai-md';
            md.innerHTML = renderMarkdown('**出错了：** ' + e.message);
            div.appendChild(md);
            els.messages.appendChild(div);
        }
        reportStatus('');
        scrollBottom();
    } finally {
        finishStreamBubble('');
        setRunning(false);
        abortCtrl = null;
        clearInterval(statusTimer);
        // 运行结束后把会话标题/顺序刷一下
        touchSession(session);
        if (!els.panel.classList.contains('hidden')) renderSessions();
    }
}

// ---------- 初始化 ----------
export function initUI() {
    if (els.fab) return; // 已初始化
    buildDom();
    renderAll(getActiveSession());
    updateModelBadge();
}
