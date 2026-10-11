// ==================== assistant-sim 浏览器平台垫片 ====================
// 只补「浏览器平台」（DOM/storage/location/fetch 相对地址），不补任何游戏逻辑。
// 游戏模块在此之上原样运行：顶层 import 不再抛 ReferenceError，
// 偶发的运行期 DOM 调用（如助手 toast、eduKeypad 顶层 keydown 监听）落到无害 no-op。

import { universal } from './stubs/universal.mjs';

export function installShims({ origin = 'http://127.0.0.1:8000' } = {}) {
    if (globalThis.__mcwebSimShims) return;
    globalThis.__mcwebSimShims = true;

    // ---- 存储（内存态：llm/jev 配置、会话、edu 进度都落这里） ----
    const mkStorage = () => {
        const m = new Map();
        return {
            getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
            setItem: (k, v) => m.set(String(k), String(v)),
            removeItem: (k) => m.delete(String(k)),
            clear: () => m.clear(),
            key: (i) => [...m.keys()][i] ?? null,
            get length() { return m.size; },
        };
    };
    globalThis.localStorage = mkStorage();
    globalThis.sessionStorage = mkStorage();

    // ---- location / navigator ----
    globalThis.location = {
        href: origin + '/', origin, protocol: 'http:', host: origin.replace(/^\w+:\/\//, ''),
        hostname: '127.0.0.1', port: origin.split(':').pop() || '8000', pathname: '/',
        reload() { /* 热重载在无头环境是 no-op（trace 会记录 reload_game 调用） */ },
    };
    Object.defineProperty(globalThis, 'navigator', {
        value: {
            userAgent: 'mcweb-headless-sim (assistant-sim)', language: 'zh-CN', languages: ['zh-CN'],
            clipboard: { writeText: async () => {} },
        },
        configurable: true,
    });

    // ---- window 即 globalThis + 视口常量 ----
    globalThis.window = globalThis;
    globalThis.innerWidth = 1280;
    globalThis.innerHeight = 720;
    globalThis.devicePixelRatio = 1;
    globalThis.addEventListener = globalThis.addEventListener || (() => {});
    globalThis.removeEventListener = globalThis.removeEventListener || (() => {});
    globalThis.matchMedia = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    globalThis.getComputedStyle = () => new Proxy({}, { get: () => '' });
    globalThis.CustomEvent = class CustomEvent extends Event {
        constructor(type, opts = {}) { super(type, opts); this.detail = opts.detail ?? null; }
    };
    globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

    // ---- DOM：够用的假元素（样式/子节点全 no-op，textContent/innerHTML 收进对象属性） ----
    const fakeCtx2d = () => {
        const gradient = { addColorStop() {} };
        return {
            fillStyle: '', strokeStyle: '', font: '', globalAlpha: 1, lineWidth: 1, lineCap: 'butt',
            textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0, imageSmoothingEnabled: true,
            fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {}, closePath() {},
            moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, rect() {}, roundRect() {}, arcTo() {},
            fill() {}, stroke() {}, clip() {}, fillText() {}, strokeText() {},
            measureText: () => ({ width: 0 }), drawImage() {}, putImageData() {},
            getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
            createLinearGradient: () => gradient, createRadialGradient: () => gradient, createPattern: () => null,
            save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, transform() {}, setTransform() {},
            setLineDash() {}, quadraticCurveTo() {}, bezierCurveTo() {}, isPointInPath: () => false,
        };
    };
    const fakeEl = (tag = 'div') => ({
        tagName: String(tag).toUpperCase(), id: '', className: '', title: '', value: '',
        textContent: '', innerHTML: '', style: {}, dataset: {}, width: 0, height: 0,
        children: [], childNodes: [],
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild(c) { this.children.push(c); this.childNodes.push(c); return c; },
        append() {}, prepend(c) { return c; }, insertBefore(c) { return c; },
        removeChild(c) { return c; }, remove() {}, replaceChild(c) { return c; },
        setAttribute() {}, getAttribute: () => null, removeAttribute() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
        // 永远返回假元素：真实页面里这些子节点都存在（buildDom 靠 querySelector 拿引用挂监听）
        querySelector: () => fakeEl('#q'), querySelectorAll: () => [],
        contains: () => false, closest: () => null,
        focus() {}, blur() {}, click() {}, select() {}, scrollIntoView() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
        getContext: (kind) => (kind === '2d' ? fakeCtx2d() : universal('ctx:' + kind)),
    });

    globalThis.document = {
        createElement: (tag) => fakeEl(tag),
        createElementNS: (ns, tag) => fakeEl(tag),
        createTextNode: (t) => ({ textContent: String(t) }),
        createDocumentFragment: () => fakeEl('#fragment'),
        // 返回假元素而不是 null：真实页面里这些 id 都存在（initUI 会拿到它们并正常读写）
        getElementById: (id) => fakeEl(id),
        querySelector: () => null, querySelectorAll: () => [],
        head: fakeEl('head'), body: fakeEl('body'), documentElement: fakeEl('html'),
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
        exitPointerLock() {}, pointerLockElement: null,
        activeElement: null, hidden: false, visibilityState: 'visible', title: '',
    };

    // ---- fetch 相对地址补全（浏览器行为：相对当前 origin 解析）----
    // 助手的文件类工具走 /api/files 等相对路径；无头环境统一补到本地 server.py。
    const realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
        if (typeof input === 'string' && input.startsWith('/')) input = origin + input;
        return realFetch(input, init);
    };
}
