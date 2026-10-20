// boot.js 链接期检查（2026-10-19 事故产物）：boot.js 是 type="module"，
// 顶层重复声明在 ESM 里属于「链接期错误」——node --check 只做解析检查会放行
// （事故实锤：RETRY_DELAYS 重复声明，--check 通过、浏览器整个 boot 死掉且无任何报错浮层）。
// 这里用真实 ESM 导入触发完整链接：链接错误（重复声明/导入不存在的导出）在此暴露；
// boot.js 顶层首句就访问 window，Node 里必然以 ReferenceError 收场——那恰好证明
// 链接已通过，按错误类型分类判定。
// 只查 boot.js 不查 index.js 整链：其余模块坏了会弹诊断浮层（设计内安全网），
// 唯独 boot.js 自身坏了=静默全死，才是必须零依赖可检的盲区；整链求值在 Node
// 里需要 gamelogic 垫片且判据会混入求值副作用，得不偿失。
const url = new URL('../js/assistant/boot.js', import.meta.url).href;

try {
    await import(url);
    console.error('❌ boot.js 在 Node 里完整执行了？顶层浏览器全局访问应先报错');
    process.exit(1);
} catch (e) {
    const msg = String(e?.message || e);
    if (e?.name === 'ReferenceError' || /ReferenceError: \w+ is not defined/.test(msg)) {
        console.log('✅ boot.js 语法与链接 OK（仅缺浏览器全局，属预期）→', msg);
        process.exit(0);
    }
    console.error('❌ boot.js 链接失败:', msg);
    process.exit(1);
}
