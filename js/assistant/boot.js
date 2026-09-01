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
window.addEventListener('load', () => {
    setTimeout(() => {
        import('./index.js')
            .then((m) => m.initAssistant())
            .catch((err) => {
                recordError('助手加载失败: ' + (err?.message || err));
                showFatalOverlay(
                    'AI 助手 / 游戏模块加载失败（很可能是最近修改的代码有语法或引用错误）',
                    (err?.stack || err) + '\n\n最近错误记录：\n' +
                    (sessionStorage.getItem(RUNTIME_ERR_KEY) || '无'),
                );
            });
    }, 0);
});
