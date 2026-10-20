// ==================== assistant/boot.js ====================
// 助手引导脚本：不 import 任何游戏模块（零依赖），保证即使游戏代码被改坏
// （语法错误/加载失败导致黑屏），本脚本仍能：
//   1. 最早注册错误捕获，把错误写入 sessionStorage 供 get_runtime_errors 使用
//   2. 显示致命错误浮层，让用户/助手看到是哪个文件出了问题
//   3. 待页面加载完成后动态加载完整助手（游戏正常时才可加载成功）

const RUNTIME_ERR_KEY = 'mcAssistant.runtimeErrors';

function recordError(message, source = '') {
    let errs = [];
    try {
        errs = JSON.parse(sessionStorage.getItem(RUNTIME_ERR_KEY)) || [];
    } catch { errs = []; }
    errs.push({ time: Date.now(), message: String(message).slice(0, 500), source: String(source).slice(0, 200) });
    try {
        sessionStorage.setItem(RUNTIME_ERR_KEY, JSON.stringify(errs.slice(-40)));
    } catch { /* 配额不足则放弃 */ }
}

// 捕获阶段监听：脚本/资源加载失败（不冒泡，但捕获阶段能到达 window）
window.addEventListener('error', (e) => {
    if (e.target && (e.target.src || e.target.href)) {
        recordError('资源加载失败: ' + (e.target.src || e.target.href), 'resource');
    } else if (e.message) {
        recordError(e.message, (e.filename || '') + ':' + (e.lineno || ''));
    }
}, true);

window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason?.message || String(e.reason || 'unknown');
    recordError('UnhandledRejection: ' + reason);
});

// console.error 也计入
const origError = console.error.bind(console);
console.error = (...args) => {
    recordError(args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a)?.slice(0, 200) : String(a))).join(' '));
    origError(...args);
};

// 致命错误浮层：游戏模块加载失败、页面黑屏时给出可见信息
function showFatalOverlay(title, detail) {
    if (document.getElementById('ai-fatal')) return;
    const div = document.createElement('div');
    div.id = 'ai-fatal';
    div.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:200;background:rgba(50,10,10,.95);' +
        'border:2px solid #a03030;border-radius:10px;padding:14px 18px;color:#ffdcdc;font:13px/1.6 sans-serif;max-width:640px;';
    div.innerHTML = `<b>⚠ ${title}</b><br><pre style="white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto;margin:8px 0;">${String(detail).slice(0, 2000)}</pre>` +
        '<button style="background:#7ec850;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-weight:bold;">重试刷新</button>';
    div.querySelector('button').addEventListener('click', () => location.reload());
    document.body.appendChild(div);
}

// 页面加载完成后再拉起完整助手（此时游戏 main.js 已初始化完毕）
// 失败现场取证（2026-10-19）：Chrome 对嵌套 import 失败一律只报根模块
// "Failed to fetch dynamically imported module"，看不出断在哪一层。金丝雀 fetch
// 判定传输层死活（⚠️ 必须用 import.meta.url 解析——fetch 的相对路径按页面而非
// 本模块解析，第一版写 './index.js' 实际抓到了根路径 /index.js 的 404，乌龙取证）；
// 资源时间线尾部看最后加载到哪个文件，定位断点
async function diagnoseFailure() {
    const lines = [];
    try {
        const t0 = performance.now();
        const resp = await fetch(new URL('./index.js', import.meta.url).href, { cache: 'no-store' });
        lines.push('金丝雀 fetch: HTTP ' + resp.status + '，' + Math.round(performance.now() - t0) + 'ms'
            + '（成功而 import 失败 = 链上某模块被负缓存/内容问题，看下方尾部找断点）');
    } catch (e) {
        lines.push('金丝雀 fetch 同样失败: ' + (e?.message || e) + '（传输/请求管线问题）');
    }
    try {
        const tail = performance.getEntriesByType('resource')
            .filter((e) => e.name.includes('/js/'))
            .slice(-10)
            .map((e) => '  ' + e.name.split('/').pop() + ' ' + Math.round(e.duration) + 'ms'
                + (e.responseStatus != null ? ' HTTP' + e.responseStatus : ''));
        if (tail.length) lines.push('最后加载的模块:\n' + tail.join('\n'));
    } catch { /* 无资源时间线则略 */ }
    return lines.join('\n');
}

// 关键机制（2026-10-19 定案，实锤于真实事故的控制台：仅 1 条 ERR_CONNECTION_CLOSED
// 却 4 次重试全败、全程零网络活动）：浏览器模块 map 对拉取失败的模块做「负缓存」——
// 文档存活期内同一 import 不再真正发请求、直接秒败。所以就地重试只是走过场，
// 真正的自愈是整页刷新（清空模块 map；pagehide 触发游戏自动存档，世界状态不丢）。
// 刷新次数以 sessionStorage 计数防死循环，助手成功启动即清零。
const RETRY_DELAYS = [1000, 3000, 8000];
const AUTO_RELOAD_KEY = 'mcAssistant.autoReloads';
const MAX_AUTO_RELOADS = 2;

function clearAutoReloadCount() {
    try { sessionStorage.removeItem(AUTO_RELOAD_KEY); } catch { /* 忽略 */ }
}

function autoReloadToRecover() {
    let n = 0;
    try { n = parseInt(sessionStorage.getItem(AUTO_RELOAD_KEY) || '0', 10) || 0; } catch { /* 忽略 */ }
    if (n >= MAX_AUTO_RELOADS) return false;
    try { sessionStorage.setItem(AUTO_RELOAD_KEY, String(n + 1)); } catch { /* 忽略 */ }
    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:200;background:rgba(30,42,18,.95);' +
        'border:2px solid #6a8f3a;border-radius:10px;padding:12px 18px;color:#e4ffd0;font:13px/1.6 sans-serif;';
    tip.textContent = '⚠ 助手模块一次瞬时加载失败已被浏览器缓存（重试无效），正在自动刷新恢复（第 '
        + (n + 1) + '/' + MAX_AUTO_RELOADS + ' 次）…';
    document.body.appendChild(tip);
    setTimeout(() => location.reload(), 1200);
    return true;
}

function loadAssistant(attempt = 0) {
    import('./index.js')
        .then((m) => m.initAssistant())
        .then(() => clearAutoReloadCount())
        .catch(async (err) => {
            const diag = await diagnoseFailure();
            // 控制台镜像完整错误与诊断：用户贴 console 即可定位，不必开浮层
            console.error('[assistant/boot] 助手加载失败(第' + (attempt + 1) + '次):', err?.stack || err, '\n' + diag);
            recordError('助手加载失败(第' + (attempt + 1) + '次): ' + (err?.message || err)
                + ' | ' + diag.split('\n')[0]);
            if (attempt < RETRY_DELAYS.length) {
                setTimeout(() => loadAssistant(attempt + 1), RETRY_DELAYS[attempt]);
                return;
            }
            if (autoReloadToRecover()) return;
            showFatalOverlay(
                'AI 助手 / 游戏模块加载失败（自动重试与自动刷新仍未成功。诊断说明：金丝雀 fetch 成功而 import 失败 ≈ 链上某模块被浏览器负缓存或内容问题，看「最后加载的模块」找断点；金丝雀也失败 ≈ 请求管线故障；刚改过代码则也可能是代码错误）',
                (err?.stack || err) + '\n\n' + diag + '\n\n最近错误记录：\n' +
                (sessionStorage.getItem(RUNTIME_ERR_KEY) || '无'),
            );
        });
}

window.addEventListener('load', () => {
    setTimeout(() => loadAssistant(), 0);
});
