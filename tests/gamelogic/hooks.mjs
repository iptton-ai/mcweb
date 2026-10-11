// ==================== gamelogic 模块加载钩子 ====================
// 复用 assistant-sim 的钩子（engine.js/textures.js 整体桩 + chunk.js 纯函数源码提取），
// 只把 three 换成「带数值 position 的逻辑桩」stubs/three-logic.mjs——
// 物品掉落传送带骑行、活塞/电梯载客、TNT 引信都依赖坐标数值运算，
// assistant-sim 的万能桩会把坐标算成 NaN，逻辑断言无从下手。
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as simResolve, load as simLoad } from '../assistant-sim/hooks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const threeStub = pathToFileURL(join(here, 'stubs', 'three-logic.mjs')).href;

export async function resolve(specifier, context, next) {
    if (specifier === 'three' || specifier.startsWith('three/')) {
        return { url: threeStub, format: 'module', shortCircuit: true };
    }
    return simResolve(specifier, context, next);
}

export async function load(url, context, next) {
    return simLoad(url, context, next);
}
