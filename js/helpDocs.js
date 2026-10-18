// ==================== helpDocs.js ====================
// 「📖 游戏说明」文档浮层（2026-09-23）：目录 + iframe 查看器。
// 把仓库 docs/ 下的图解文档（首篇：红石能源系统图解，内含可交互 SVG 演示）嵌进游戏里看——
// 首屏 / 暂停菜单共用的 #menu-actions「📖 说明」按钮进入。
//
// 指针策略照「📝 我的题库」的非暂停浮层模式：state.helpDocOpen + syncPointerPolicy
// ——打开即释放鼠标滚/点文档，关闭走既有自动回锁；Esc/Q 关闭（input.js 接线同题库）；
// uiKeys 范围表收录 #help-doc（方向键移焦 / Enter 激活）。
// 注意：进入 iframe 后键盘事件归 iframe 文档，父页 Esc 收不到——关闭靠头部常驻的 ✕ 按钮。

import { state } from './state.js';
import { syncPointerPolicy, clearStuckKeys, onUIStateChange } from './uiModal.js';
import { uiKick } from './uiKeys.js';
import { isLevelRunActive } from './levelRun.js'; // 闯关态隔离：与题库页同守卫

// 文档目录：新增图解只需在此加一行（src 相对仓库根，server.py / 静态托管都直读 docs/）
const DOCS = [
    { emoji:'🏠', title:'我有自己的家', desc:'常用栏 · 做门和床 · 安全暂停 · 睡觉与回家', src:'docs/home-survival-guide.html' },
    { emoji:'🧭', title:'出门探险，完成自己的作品', desc:'三条探索路线 · 地图路标 · 防护维修 · 机器入箱', src:'docs/adventure-survival-guide.html' },
    { emoji:'🌾', title:'让家每天都有收获', desc:'箱子收纳 · 熔炉烧制 · 种麦做面包 · 种树养羊', src:'docs/life-survival-guide.html' },
    { emoji:'⚙️', title:'让机关转起来', desc:'手摇动力 · 大小齿轮 · 红石换向 · 快慢与负载实验', src:'docs/physics-components-guide.html' },
    {
        emoji: '⚡',
        title: '红石能源系统图解',
        desc: '信号源 · 开关 · 脉冲 · 边沿 · 时钟 · 火把塔（可点击交互演示）',
        src: 'docs/redstone-energy-guide.html',
    },
];

const HELP_STYLE = `
/* 显隐自足（不依赖 .lvl-overlay 对齐规则，照题库页的教训） */
#help-doc.hidden{display:none !important;}
#help-doc:not(.hidden){display:flex;}
#help-doc{position:fixed;inset:0;z-index:74;align-items:center;justify-content:center;
 background:rgba(10,12,18,.72);}
#help-doc .help-panel{width:min(94vw,880px);height:min(88vh,760px);display:flex;flex-direction:column;
 background:#1d222b;border:1px solid #44475a;border-radius:14px;overflow:hidden;
 box-shadow:0 10px 40px #000a;color:#edf0f7;font:13px/1.6 system-ui,"PingFang SC",sans-serif;}
#help-doc .help-head{display:flex;align-items:center;gap:10px;padding:10px 14px;
 border-bottom:1px solid #414956;background:#232936;}
#help-doc .help-title{font-weight:650;letter-spacing:.06em;flex:1;}
#help-doc button{border:1px solid #565a67;border-radius:8px;background:#303541;color:#edf0f7;
 cursor:pointer;font:inherit;padding:5px 11px;}
#help-doc button:hover{border-color:#acd58c;background:#404958;}
#help-doc .hidden{display:none !important;}
#help-toc{overflow-y:auto;padding:14px;}
#help-doc .help-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;
 background:rgba(48,53,65,.6);border:1px solid #44475a;margin-bottom:8px;cursor:pointer;}
#help-doc .help-row:hover{border-color:#acd58c;background:#404958;}
#help-doc .help-emoji{font-size:22px;flex:none;}
#help-doc .help-main{flex:1;min-width:0;}
#help-doc .help-name{color:#edf0f7;font-size:14px;font-weight:600;}
#help-doc .help-desc{color:#9a9ab8;font-size:12px;margin-top:2px;}
#help-doc .help-open{color:#9ad24a;font-size:12px;flex:none;}
#help-frame{flex:1;border:0;background:#14171c;width:100%;}
#help-hint{color:#9a9ab8;font-size:12px;padding:0 14px 10px;}
`;

const HTML_SHELL = `
  <div class="help-panel">
    <div class="help-head">
      <span class="help-title">📖 游戏说明</span>
      <button id="help-back" class="hidden">← 返回目录</button>
      <button id="help-close">✕ 关闭</button>
    </div>
    <div id="help-toc"></div>
    <iframe id="help-frame" class="hidden" title="说明文档内容"></iframe>
    <div id="help-hint">提示：Esc / Q 也可关闭（焦点在文档内时点 ✕）。</div>
  </div>`;

let panel = null;
let toc = null;
let frame = null;
let backBtn = null;

function ensureDom() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'help-doc';
    panel.className = 'hidden';
    const style = document.createElement('style');
    style.textContent = HELP_STYLE;
    document.head.appendChild(style);
    panel.innerHTML = HTML_SHELL;
    document.body.appendChild(panel);

    toc = panel.querySelector('#help-toc');
    frame = panel.querySelector('#help-frame');
    backBtn = panel.querySelector('#help-back');
    toc.innerHTML = DOCS.map((d, i) => `
      <div class="help-row" data-idx="${i}">
        <span class="help-emoji">${d.emoji}</span>
        <span class="help-main"><span class="help-name">${d.title}</span>
          <div class="help-desc">${d.desc}</div></span>
        <span class="help-open">打开 →</span>
      </div>`).join('');
    toc.addEventListener('click', (e) => {
        const row = e.target.closest('.help-row');
        if (row) openDoc(DOCS[Number(row.dataset.idx)]);
    });
    backBtn.addEventListener('click', showToc);
    panel.querySelector('#help-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeHelpDocs();
    });
    panel.addEventListener('click', (e) => { if (e.target === panel) closeHelpDocs(); });

    // 离开可停留的界面态（进背包/设置/死亡/结算）自动收起，照题库页的联动惯例；
    // title/playing/pause 三个入口态保持打开
    onUIStateChange((_prev, next) => {
        if (['inventory', 'settings', 'dead', 'result'].includes(next) && state.helpDocOpen) closeHelpDocs();
    });

    // 入口按钮（首屏 / 暂停菜单共用的 #menu-actions）
    document.getElementById('btn-help')?.addEventListener('click', () => openHelpDocs());
    return panel;
}

function showToc() {
    frame.classList.add('hidden');
    frame.src = 'about:blank';
    backBtn.classList.add('hidden');
    toc.classList.remove('hidden');
}

function openDoc(doc) {
    toc.classList.add('hidden');
    backBtn.classList.remove('hidden');
    frame.classList.remove('hidden');
    frame.src = doc.src;
}

export function isHelpDocsOpen() {
    return !!state.helpDocOpen;
}

export function openHelpDocs() {
    if (isLevelRunActive()) {
        // 闯关模式隔离（同题库页的拒绝语义）：闯关中不开说明浮层
        import('./ui.js').then(({ showTooltip }) => showTooltip('🗺 闯关中不能看说明，退出关卡再来'));
        return;
    }
    ensureDom();
    showToc();
    panel.classList.remove('hidden');
    state.helpDocOpen = true;
    syncPointerPolicy(); // 打开即释放鼠标（标题屏本就未锁，无副作用）
    clearStuckKeys();
    uiKick(); // 键盘导航落焦：✕ 关闭按钮
}

export function closeHelpDocs() {
    if (!panel) return;
    panel.classList.add('hidden');
    state.helpDocOpen = false;
    syncPointerPolicy(); // 全关 → 走 uiModal 既有自动回锁链路
    clearStuckKeys();
}

// 启动时调用（main.js init）：提前建 DOM 并接好「📖 说明」入口按钮——
// 否则按钮监听要等第一次打开才挂上，永远点不开
export function initHelpDocs() {
    ensureDom();
}
