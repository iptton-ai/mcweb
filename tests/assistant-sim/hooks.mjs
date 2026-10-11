// ==================== assistant-sim 模块加载钩子 ====================
// 原则：只换「渲染叶子」，不碰任何游戏逻辑。
//   three        → 万能桩（渲染对象创建全部无害化）
//   engine.js    → 桩（真实文件顶层 new WebGLRenderer，需要真实 WebGL）
//   textures.js  → 桩（真实文件顶层绘制上千次 Canvas）
//   chunk.js     → 源码改写：纯逻辑函数（isSolid 等）从真实源码实时提取防漂移，
//                  网格/光源等渲染副作用替换为保留语义的 no-op
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stubUrl = (f) => pathToFileURL(join(here, 'stubs', f)).href;

export async function resolve(specifier, context, next) {
    if (specifier === 'three') return { url: stubUrl('three.mjs'), format: 'module', shortCircuit: true };
    return next(specifier, context);
}

// 从源码中按大括号配平提取 `export function NAME(...) {...}` 全文
function extractFn(src, name) {
    const m = src.match(new RegExp('export function ' + name + '\\s*\\('));
    if (!m) throw new Error('assistant-sim: chunk.js 提取失败，找不到函数 ' + name + '（chunk.js 结构变了请同步本文件）');
    const braceStart = src.indexOf('{', m.index);
    let depth = 0;
    for (let i = braceStart; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
    }
    throw new Error('assistant-sim: chunk.js 函数 ' + name + ' 大括号不配平？');
}

// 桩源码以 js/engine.js 的 URL 求值，其相对 import 会解析到 js/ 下——把 universal 的
// 相对路径改写成绝对 file URL
function stubSource(f) {
    return readFileSync(join(here, 'stubs', f), 'utf8')
        .replace(/'\.\/universal\.mjs'/, `'${stubUrl('universal.mjs')}'`);
}

export async function load(url, context, next) {
    if (url.endsWith('/js/engine.js')) {
        return { format: 'module', source: stubSource('engine.mjs'), shortCircuit: true };
    }
    if (url.endsWith('/js/textures.js')) {
        return { format: 'module', source: stubSource('textures.mjs'), shortCircuit: true };
    }
    if (url.endsWith('/js/chunk.js')) {
        const src = readFileSync(fileURLToPath(url), 'utf8');
        const fns = ['isTransparent', 'isCustomMesh', 'isSolid', 'shouldRenderFace']
            .map((n) => extractFn(src, n)).join('\n\n');
        const base = url.slice(0, url.lastIndexOf('/') + 1); // .../js/
        const out = `// ⚠️ 本文件由 tests/assistant-sim/hooks.mjs 在加载期生成（源码改写），不要写入仓库。
// 纯逻辑函数从 js/chunk.js 实时提取（防漂移）；渲染副作用按原语义 no-op 化。
import { BlockInfo, BlockTypes, MAX_TORCH_LIGHTS } from '${base}config.js';
import { getBlock } from '${base}world.js';
import { state } from '${base}state.js';

export const propMeshCache = new Map();

${fns}

// ---- 渲染副作用 no-op（无界面环境下网格构建没有意义，纯耗 CPU）----
export function createPropTexture() { return null; }
export function createCrossPlanes() { return null; }
export function getPropMesh() { return null; }
export function buildDustMesh() { return null; }
export function addTorchLight(x, y, z) {
    // 保留 torchLights 计数语义（红石灯/火把上限逻辑依赖 Map 尺寸），只是不创建 PointLight
    if (state.torchLights.size >= MAX_TORCH_LIGHTS) {
        const firstKey = state.torchLights.keys().next().value;
        removeTorchLightByKey(firstKey);
    }
    const key = x + ',' + y + ',' + z;
    if (!state.torchLights.has(key)) state.torchLights.set(key, null);
}
export function removeTorchLightByKey(key) { state.torchLights.delete(key); }
export function removeTorchLightAt(x, y, z) { removeTorchLightByKey(x + ',' + y + ',' + z); }
export function buildChunkGeometry() { return null; }
export function createChunkMesh() { return null; }
export function updateChunkMeshes() {}
export function disposeChunkProps() {}
export function buildChunkProps() {}
export function refreshPropAt() {}
export function removeDroppedItemAt() {}
export function disposeChunk() {}
export function rebuildChunk() {}
`;
        return { format: 'module', source: out, shortCircuit: true };
    }
    return next(url, context);
}
