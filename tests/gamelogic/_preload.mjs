// ==================== gamelogic 测试预载 ====================
// 必须经 --import 预载（先于一切游戏模块的解析/求值）：
//   ① 装浏览器平台垫片（DOM/storage/location，复用 assistant-sim）
//   ② window.addEventListener 换成收集器（eduKeypad/eduStarlight/eduMerchant 顶层 keydown
//      注册进这里，测试用 dispatchKey 模拟玩家按键驱动答题链）
//   ③ setInterval 全部 unref（教学组顶层定时器不挂住测试进程）
//   ④ fetch 磁盘直读（assets/edu/banks.json 等本地静态资源离线可测，不必起 server.py）
//   ⑤ 挂模块加载钩子（three/engine/textures/chunk 渲染层垫掉，见 hooks.mjs）
//
// 用法：node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/
import { register } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installShims } from '../assistant-sim/browser-shims.mjs';

installShims({ origin: 'http://127.0.0.1:8000' });
globalThis.__mcwebGameLogicPreloaded = true; // kit.mjs 用它给出友好的用法提示

// ---- 升级版假元素工厂：browser-shims 的 fakeEl classList 是 no-op、getElementById 每次造新对象，
//      导致无头冒烟观察不了显隐（className 永远不变）。这里统一换成：
//      ① classList/className 真实维护同一个类串（toggle/add/remove/contains 可断言）
//      ② createElement 设置 id 时注册进 byId 表，getElementById 返回同一实例（与真 DOM 一致）
//      ③ 补 offsetWidth/getClientRects：uiKeys.isVisible 会读（缺了会 TypeError），
//        值给 0/[] = 对键盘导航呈现为「不可见」，scope 自动跳过、语义安全
const __byId = new Map();
const __realCreate = document.createElement.bind(document);
function __makeEl(tag = 'div') {
    const el = __realCreate(tag);
    let cls = '';
    let eid = '';
    Object.defineProperty(el, 'id', {
        get: () => eid,
        set: (v) => { eid = String(v); if (eid) __byId.set(eid, el); },
        configurable: true,
    });
    Object.defineProperty(el, 'className', { get: () => cls, set: (v) => { cls = String(v); }, configurable: true });
    el.classList = {
        add: (...cs) => {
            const parts = new Set(cls.split(/\s+/).filter(Boolean));
            for (const c of cs) parts.add(String(c));
            cls = [...parts].join(' ');
        },
        remove: (...cs) => {
            const rm = new Set(cs.map(String));
            cls = cls.split(/\s+/).filter((c) => c && !rm.has(c)).join(' ');
        },
        toggle: (c, force) => {
            const has = el.classList.contains(c);
            const want = force === undefined ? !has : !!force;
            if (want) el.classList.add(c); else el.classList.remove(c);
            return want;
        },
        contains: (c) => cls.split(/\s+/).includes(String(c)),
    };
    Object.defineProperty(el, 'offsetWidth', { value: 0, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: 0, configurable: true });
    el.getClientRects = () => [];
    return el;
}
document.createElement = (tag) => __makeEl(tag);
document.getElementById = (id) => {
    if (!__byId.has(id)) __byId.set(id, __makeEl('div'));
    return __byId.get(id);
};
document.querySelector = () => __makeEl('div');
document.querySelectorAll = () => [];

// ---- window 事件收集器（window===globalThis，覆盖垫片的 no-op）----
const __listeners = new Map();
globalThis.addEventListener = function (type, fn) {
    if (!__listeners.has(type)) __listeners.set(type, []);
    __listeners.get(type).push(fn);
};

// 测试派发按键：向所有 keydown 处理器投一个够用的事件对象
export function dispatchKey(key, extra = {}) {
    const ev = {
        key, code: extra.code ?? '',
        preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
        repeat: false,
        ...extra,
    };
    for (const fn of __listeners.get('keydown') || []) fn(ev);
}
export { __listeners };

// ---- 定时器 unref ----
const realSetInterval = globalThis.setInterval.bind(globalThis);
globalThis.setInterval = (fn, ms, ...args) => {
    const t = realSetInterval(fn, ms, ...args);
    t?.unref?.();
    return t;
};

// ---- fetch 磁盘直读：同源 http(s)://127.0.0.1|localhost 请求映射到仓库文件 ----
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
    let url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith('/')) url = 'http://127.0.0.1:8000' + url;
    let u;
    try { u = new URL(url); } catch { return realFetch(input, init); }
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
        const file = join(repoRoot, decodeURIComponent(u.pathname));
        if (u.pathname !== '/' && existsSync(file) && statSync(file).isFile()) {
            return new Response(readFileSync(file), {
                status: 200,
                headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' },
            });
        }
        return new Response('not found', { status: 404 });
    }
    return realFetch(input, init);
};

// ---- 挂加载钩子（必须在任何游戏模块解析之前）----
register('./hooks.mjs', import.meta.url);

// ---- 补 textures 桩的 blockUVs 占位（须在钩子注册后动态 import 才拿到桩的模块实例）：
//      ui.js updateHotbar 读 blockUVs[id].top（js/ui.js:103），空表会炸——而那条异常会在
//      loadGame/启动路径里被 levelRun.exitLevelRun 的 generateWorld 兜底放大成「恢复失效」
const { blockUVs } = await import('../../js/textures.js');
for (let id = 0; id < 256; id++) blockUVs[id] ??= { top: { x: 0, y: 0 } };
