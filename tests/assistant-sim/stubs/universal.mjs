// ==================== assistant-sim 通用桩 ====================
// 万能对象：任何属性读取返回新的万能对象、任何调用/构造返回新的万能对象、
// 任何属性写入照单全收。只用于渲染类叶子模块（three/engine/textures）的无头替身——
// 世界数据、工具逻辑、agent 循环、LLM 请求全部走真实代码，不经过这里。

export function universal(tag = 'stub') {
    const store = { __tag: tag };
    const fn = function () { return universal(tag + '()'); };
    try { Object.defineProperty(fn, 'name', { value: String(tag).replace(/[^\w$]/g, '_') }); } catch { /* 忽略 */ }
    return new Proxy(fn, {
        get(t, p) {
            if (p === Symbol.toPrimitive) return () => 0;
            if (p === 'toString') return () => '[stub ' + tag + ']';
            if (p === 'valueOf') return () => 0;
            if (p === 'then') return undefined;           // 绝不装 thenable（防 await 悬挂）
            if (p === 'nodejs.util.inspect.custom') return () => '[stub ' + tag + ']';
            if (typeof p === 'symbol') return undefined;  // Symbol.iterator 等：不假装可迭代
            if (!(p in store)) store[p] = universal(tag + '.' + String(p));
            return store[p];
        },
        set(t, p, v) { store[p] = v; return true; },
        has() { return true; },
        apply() { return universal(tag + '()'); },
        construct() { return universal('new(' + tag + ')'); },
    });
}
