// ==================== assistant-sim engine.js 桩 ====================
// 真实 engine.js 顶层会 new WebGLRenderer（需要真实 canvas/WebGL），无头环境必须整体替换。
// 导出面与 js/engine.js 对齐（scene/camera/renderer/canvas + 三盏灯），
// 其余模块（chunk/playerLife/saveGame/uiModal/snapshot/settingsUI）引用的名字全部在内。
import { universal } from './universal.mjs';

export const canvas = universal('engine.canvas');
export const renderer = universal('engine.renderer');
export const scene = universal('engine.scene');           // scene.add/remove 均为 no-op
export const camera = universal('engine.camera');
export const ambientLight = universal('engine.ambientLight');
export const sunLight = universal('engine.sunLight');
export const hemisphereLight = universal('engine.hemisphereLight');
