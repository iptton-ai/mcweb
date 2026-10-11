// ==================== assistant-sim textures.js 桩 ====================
// 真实 textures.js 顶层创建 canvas 图集并逐 tile 绘制（上千行 Canvas 调用），
// 无头环境整体替换。导出面与 js/textures.js 对齐，供 chunk/items/ui/itemInfo 引用。
import { universal } from './universal.mjs';

export const textureCache = new Map();
export function createTexture(width, height, drawFn) { return universal('texture'); }
export const atlasSize = 16;
export const tileSize = 16;
export const atlasCanvas = { width: atlasSize * tileSize, height: atlasSize * tileSize, style: {}, getContext: () => universal('ctx2d') };
export const atlasCtx = atlasCanvas.getContext('2d');
export const blockUVs = {};   // 真实文件按 tiles 表填充；无头环境不渲染，空表即可
export const tileMap = {};
export function generateAllTextures() { return universal('atlasTexture'); }
export const atlasTexture = generateAllTextures();
export function onTileOverride() { /* 订阅贴图覆盖：无头无贴图 */ }
export function getDoorTileTexture(half) { return universal('doorTex'); }
export function getUVForFace(blockType, face) { return [0, 0, 1, 1]; }
export function getTileTexture(name) { return universal('tileTex'); }
export function getCrackTextures() { return []; }
