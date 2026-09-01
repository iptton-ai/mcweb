// ==================== textures.js ====================

import * as THREE from 'three';
import { BlockInfo, BlockTypes, BUTTON_BASE, BUTTON_COUNT, BUTTON_ITEM_ID, DUST_BASE, DUST_COUNT, DUST_ITEM_ID, DOOR_BASE, DOOR_COUNT, DOOR_ITEM_ID, LAMP_BASE, LEVER_BASE, LEVER_COUNT, LEVER_ITEM_ID, OBSERVER_BASE, OBSERVER_ITEM_ID, PISTON_BASE, PISTON_HEAD_BASE, PISTON_ITEM_ID, PLATE_BASE, PLATE_COUNT, PLATE_ITEM_ID, RTORCH_BASE, RTORCH_COUNT, RTORCH_ITEM_ID, STICKY_PISTON_BASE, STICKY_PISTON_ITEM_ID, ToolTypes } from './config.js';
import { hash2D } from './world.js';

// ==================== 纹理生成 ====================
export const textureCache = new Map();

export function createTexture(width, height, drawFn) {
    const cnv = document.createElement('canvas');
    cnv.width = width;
    cnv.height = height;
    const ctx = cnv.getContext('2d');
    drawFn(ctx, width, height);
    const tex = new THREE.CanvasTexture(cnv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// ==================== 纹理图集 ====================
export const atlasSize = 8;

// 8x8 图集（红石组之后又加了活塞组：粘液/活塞三面/机身/观察者，tile 33..38 追加在尾部保序）
export const tileSize = 16;

export const atlasCanvas = document.createElement('canvas');

atlasCanvas.width = atlasSize * tileSize;

atlasCanvas.height = atlasSize * tileSize;

export const atlasCtx = atlasCanvas.getContext('2d');

export const blockUVs = {};

export const tileMap = {};

export function generateAllTextures() {
    const tiles = [
        { type: BlockTypes.GRASS, top: 0, side: 1, bottom: 2, name: 'grass_top' },
        { type: BlockTypes.DIRT, top: 2, side: 2, bottom: 2, name: 'dirt' },
        { type: BlockTypes.STONE, top: 3, side: 3, bottom: 3, name: 'stone' },
        { type: BlockTypes.WOOD, top: 4, side: 5, bottom: 4, name: 'wood_side' },
        { type: BlockTypes.LEAVES, top: 6, side: 6, bottom: 6, name: 'leaves' },
        { type: BlockTypes.SAND, top: 7, side: 7, bottom: 7, name: 'sand' },
        { type: BlockTypes.WATER, top: 8, side: 8, bottom: 8, name: 'water' },
        { type: BlockTypes.BEDROCK, top: 9, side: 9, bottom: 9, name: 'bedrock' },
        { type: BlockTypes.BRICK, top: 10, side: 10, bottom: 10, name: 'brick' },
        { type: BlockTypes.GLASS, top: 11, side: 11, bottom: 11, name: 'glass' },
        { type: BlockTypes.PLANKS, top: 12, side: 12, bottom: 12, name: 'planks' },
        { type: BlockTypes.COBBLESTONE, top: 13, side: 13, bottom: 13, name: 'cobblestone' },
        { type: BlockTypes.GRAVEL, top: 14, side: 14, bottom: 14, name: 'gravel' },
        { type: BlockTypes.SNOW, top: 15, side: 15, bottom: 15, name: 'snow' },
        { type: BlockTypes.LOG, top: 4, side: 5, bottom: 4, name: 'log' },
        { type: BlockTypes.TORCH, top: 16, side: 16, bottom: 16, name: 'torch' },
        { type: BlockTypes.FLOWER, top: 17, side: 17, bottom: 17, name: 'flower' },
        { type: BlockTypes.TNT, top: 19, side: 18, bottom: 19, name: 'tnt' },
        { type: DOOR_ITEM_ID, top: 20, side: 20, bottom: 20, name: 'door_lower' }, // 门物品图标用下半 tile
        { type: DUST_ITEM_ID, top: 22, side: 22, bottom: 22, name: 'dust' }, // 红石粉物品图标（实际是贴地粉线道具）
        { type: RTORCH_ITEM_ID, top: 26, side: 26, bottom: 26, name: 'rtorch' }, // 红石火把（实际是 3D 道具）
        { type: BUTTON_ITEM_ID, top: 27, side: 27, bottom: 27, name: 'button' }, // 按钮（实际是 3D 道具）
        { type: PLATE_ITEM_ID, top: 28, side: 28, bottom: 28, name: 'plate' }, // 压力板（实际是 3D 道具）
        { type: LEVER_ITEM_ID, top: 23, side: 23, bottom: 23, name: 'lever' }, // 拉杆物品图标（实际是 3D 道具）
        { type: LAMP_BASE, top: 24, side: 24, bottom: 24, name: 'lamp_off' }, // 红石灯（灭）
        { type: LAMP_BASE + 1, top: 25, side: 25, bottom: 25, name: 'lamp_lit' }, // 红石灯（亮）
        { type: ToolTypes.PICKAXE, top: 29, side: 29, bottom: 29, name: 'pickaxe' }, // 铁镐图标（物品，非方块）
        { type: ToolTypes.AXE, top: 30, side: 30, bottom: 30, name: 'axe' },
        { type: ToolTypes.SHOVEL, top: 31, side: 31, bottom: 31, name: 'shovel' },
        { type: ToolTypes.SWORD, top: 32, side: 32, bottom: 32, name: 'sword' },
        { type: BlockTypes.SLIME, top: 33, side: 33, bottom: 33, name: 'slime' }, // 粘液块（普通立方体，活塞组基础组件）
        { type: PISTON_ITEM_ID, top: 35, side: 34, bottom: 36, name: 'piston' }, // 活塞图标露出正面
        { type: STICKY_PISTON_ITEM_ID, top: 33, side: 34, bottom: 36, name: 'sticky_piston' }, // 粘性活塞图标露出粘液面
        { type: OBSERVER_ITEM_ID, top: 38, side: 36, bottom: 36, name: 'observer' }, // 观察者图标露出「眼睛」面
    ];

    const drawFunctions = {
        0: (ctx, x, y, s) => { // 草顶部
            ctx.fillStyle = '#5a9e3d';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 30; i++) {
                const px = x + Math.floor(hash2D(i, 1, 5) * s);
                const py = y + Math.floor(hash2D(i, 2, 5) * s);
                ctx.fillStyle = hash2D(i, 3, 5) > 0.5 ? '#6aae4d' : '#4a8e2d';
                ctx.fillRect(px, py, 1 + Math.floor(hash2D(i, 4, 5) * 3), 1 + Math.floor(hash2D(i, 5, 5) *
                3));
            }
        },
        1: (ctx, x, y, s) => { // 草侧面
            ctx.fillStyle = '#8b5a2b';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 20; i++) {
                const px = x + Math.floor(hash2D(i, 6, 1) * s);
                const py = y + Math.floor(hash2D(i, 7, 1) * s);
                ctx.fillStyle = hash2D(i, 8, 1) > 0.5 ? '#7a4a1b' : '#9b6a3b';
                ctx.fillRect(px, py, 1, 1);
            }
            ctx.fillStyle = '#5a9e3d';
            ctx.fillRect(x, y, s, 4);
            for (let i = 0; i < 8; i++) {
                ctx.fillStyle = i % 2 === 0 ? '#6aae4d' : '#4a8e2d';
                ctx.fillRect(x + Math.floor(hash2D(i, 9, 1) * s), y + Math.floor(hash2D(i, 10, 1) * 3), 2,
                    2);
            }
        },
        2: (ctx, x, y, s) => { // 泥土
            ctx.fillStyle = '#8b5a2b';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 25; i++) {
                const px = x + Math.floor(hash2D(i, 11, 2) * s);
                const py = y + Math.floor(hash2D(i, 12, 2) * s);
                ctx.fillStyle = hash2D(i, 13, 2) > 0.5 ? '#7a4a1b' : '#9b6a3b';
                ctx.fillRect(px, py, 1 + Math.floor(hash2D(i, 14, 2) * 2), 1);
            }
        },
        3: (ctx, x, y, s) => { // 石头
            ctx.fillStyle = '#7a7a7a';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 20; i++) {
                const px = x + Math.floor(hash2D(i, 15, 3) * s);
                const py = y + Math.floor(hash2D(i, 16, 3) * s);
                ctx.fillStyle = hash2D(i, 17, 3) > 0.5 ? '#8a8a8a' : '#6a6a6a';
                ctx.fillRect(px, py, 2, 2);
            }
        },
        4: (ctx, x, y, s) => { // 木头顶部
            ctx.fillStyle = '#8a6a3a';
            ctx.fillRect(x, y, s, s);
            ctx.strokeStyle = '#6a4a2a';
            ctx.lineWidth = 1;
            for (let r = 2; r < s / 2; r += 3) {
                ctx.beginPath();
                ctx.arc(x + s / 2, y + s / 2, r, 0, Math.PI * 2);
                ctx.stroke();
            }
        },
        5: (ctx, x, y, s) => { // 木头侧面
            ctx.fillStyle = '#6b4423';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < s; i += 2) {
                ctx.fillStyle = i % 4 === 0 ? '#5a3a1a' : '#7b5433';
                ctx.fillRect(x + i, y, 2, s);
            }
        },
        6: (ctx, x, y, s) => { // 树叶
            ctx.fillStyle = '#3d7a2a';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 35; i++) {
                const px = x + Math.floor(hash2D(i, 18, 6) * s);
                const py = y + Math.floor(hash2D(i, 19, 6) * s);
                const shade = hash2D(i, 20, 6);
                ctx.fillStyle = shade > 0.6 ? '#4d8a3a' : shade > 0.3 ? '#3d7a2a' : '#2d6a1a';
                ctx.fillRect(px, py, 2, 2);
            }
        },
        7: (ctx, x, y, s) => { // 沙子
            ctx.fillStyle = '#dbc47a';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 20; i++) {
                const px = x + Math.floor(hash2D(i, 21, 7) * s);
                const py = y + Math.floor(hash2D(i, 22, 7) * s);
                ctx.fillStyle = hash2D(i, 23, 7) > 0.5 ? '#cbb46a' : '#ebd48a';
                ctx.fillRect(px, py, 1, 1);
            }
        },
        8: (ctx, x, y, s) => { // 水
            ctx.fillStyle = '#3a6ea5';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 15; i++) {
                const px = x + Math.floor(hash2D(i, 24, 8) * s);
                const py = y + Math.floor(hash2D(i, 25, 8) * s);
                ctx.fillStyle = hash2D(i, 26, 8) > 0.5 ? '#4a7eb5' : '#2a5e95';
                ctx.fillRect(px, py, 2, 1);
            }
        },
        9: (ctx, x, y, s) => { // 基岩
            ctx.fillStyle = '#3a3a3a';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 30; i++) {
                const px = x + Math.floor(hash2D(i, 27, 9) * s);
                const py = y + Math.floor(hash2D(i, 28, 9) * s);
                ctx.fillStyle = hash2D(i, 29, 9) > 0.5 ? '#4a4a4a' : '#2a2a2a';
                ctx.fillRect(px, py, 2, 2);
            }
        },
        10: (ctx, x, y, s) => { // 砖块
            ctx.fillStyle = '#a0522d';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#c8c8c8';
            const bh = Math.floor(s / 4);
            for (let row = 0; row < 4; row++) {
                const offset = row % 2 === 0 ? 0 : Math.floor(s / 4);
                ctx.fillRect(x + offset, y + row * bh, s / 2, 1);
            }
            for (let col = 0; col < 4; col++) {
                ctx.fillRect(x + col * Math.floor(s / 2), y, 1, bh);
            }
        },
        11: (ctx, x, y, s) => { // 玻璃
            ctx.fillStyle = 'rgba(200,216,232,0.6)';
            ctx.fillRect(x, y, s, s);
            ctx.strokeStyle = 'rgba(220,235,245,0.9)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, s, s);
            ctx.beginPath();
            ctx.moveTo(x + 1, y + s - 2);
            ctx.lineTo(x + 4, y + 3);
            ctx.lineTo(x + s - 1, y + 3);
            ctx.stroke();
        },
        12: (ctx, x, y, s) => { // 木板
            ctx.fillStyle = '#c8a050';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < s; i += 2) {
                ctx.fillStyle = i % 4 === 0 ? '#b89040' : '#d8b060';
                ctx.fillRect(x + i, y, 1, s);
            }
            for (let j = 0; j < s; j += 4) {
                ctx.fillStyle = '#a08030';
                ctx.fillRect(x, y + j, s, 1);
            }
        },
        13: (ctx, x, y, s) => { // 圆石
            ctx.fillStyle = '#6a6a6a';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 15; i++) {
                const px = x + Math.floor(hash2D(i, 30, 13) * s);
                const py = y + Math.floor(hash2D(i, 31, 13) * s);
                const r = 1 + Math.floor(hash2D(i, 32, 13) * 3);
                ctx.fillStyle = hash2D(i, 33, 13) > 0.5 ? '#7a7a7a' : '#5a5a5a';
                ctx.beginPath();
                ctx.arc(px, py, r, 0, Math.PI * 2);
                ctx.fill();
            }
        },
        14: (ctx, x, y, s) => { // 沙砾
            ctx.fillStyle = '#9a8a7a';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 25; i++) {
                const px = x + Math.floor(hash2D(i, 34, 14) * s);
                const py = y + Math.floor(hash2D(i, 35, 14) * s);
                ctx.fillStyle = hash2D(i, 36, 14) > 0.5 ? '#aa9a8a' : '#8a7a6a';
                ctx.fillRect(px, py, 2, 2);
            }
        },
        15: (ctx, x, y, s) => { // 雪
            ctx.fillStyle = '#f0f0f0';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 15; i++) {
                const px = x + Math.floor(hash2D(i, 37, 15) * s);
                const py = y + Math.floor(hash2D(i, 38, 15) * s);
                ctx.fillStyle = hash2D(i, 39, 15) > 0.5 ? '#ffffff' : '#e0e0e0';
                ctx.fillRect(px, py, 1, 1);
            }
        },
        16: (ctx, x, y, s) => { // 火把（图标用，实际游戏里是3D道具）
            ctx.fillStyle = '#2a2a3a';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#8a5a2a';
            ctx.fillRect(x + s / 2 - 1, y + s / 2 - 1, 3, s / 2);
            ctx.fillStyle = '#f8c040';
            ctx.fillRect(x + s / 2 - 2, y + 2, 5, 6);
            ctx.fillStyle = '#ffe890';
            ctx.fillRect(x + s / 2 - 1, y + 1, 3, 4);
        },
        17: (ctx, x, y, s) => { // 花
            ctx.fillStyle = '#2a3a2a';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#3d7a2a';
            ctx.fillRect(x + s / 2 - 1, y + s / 2, 2, s / 2 - 1);
            ctx.fillStyle = '#e04a5a';
            ctx.fillRect(x + s / 2 - 3, y + 2, 3, 3);
            ctx.fillRect(x + s / 2 + 1, y + 2, 3, 3);
            ctx.fillRect(x + s / 2 - 3, y + 5, 3, 3);
            ctx.fillRect(x + s / 2 + 1, y + 5, 3, 3);
            ctx.fillStyle = '#f8d840';
            ctx.fillRect(x + s / 2 - 1, y + 4, 3, 3);
        },
        18: (ctx, x, y, s) => { // TNT侧面
            ctx.fillStyle = '#c03020';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 15; i++) {
                const px = x + Math.floor(hash2D(i, 40, 18) * s);
                const py = y + Math.floor(hash2D(i, 41, 18) * s);
                ctx.fillStyle = hash2D(i, 42, 18) > 0.5 ? '#d04030' : '#a82818';
                ctx.fillRect(px, py, 2, 2);
            }
            ctx.fillStyle = '#f0e0c0';
            ctx.fillRect(x, y + s / 2 - 3, s, 6);
            ctx.fillStyle = '#1a1a1a';
            ctx.font = 'bold 6px monospace';
            ctx.fillText('TNT', x + 3, y + s / 2 + 2);
        },
        19: (ctx, x, y, s) => { // TNT顶/底
            ctx.fillStyle = '#a82818';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(x + s / 2 - 2, y + s / 2 - 2, 4, 4);
            ctx.fillStyle = '#d04030';
            ctx.fillRect(x, y, s, 2);
            ctx.fillRect(x, y + s - 2, s, 2);
            ctx.fillRect(x, y, 2, s);
            ctx.fillRect(x + s - 2, y, 2, s);
        },
        20: (ctx, x, y, s) => { // 门下半：竖木板 + 凹嵌板 + 把手
            ctx.fillStyle = '#b89040';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < s; i += 4) {
                ctx.fillStyle = '#8a6a30';
                ctx.fillRect(x + i, y, 1, s);
            }
            ctx.fillStyle = '#a07c34';
            ctx.fillRect(x + 3, y + 2, s - 6, s - 4);
            ctx.fillStyle = '#c8a050';
            ctx.fillRect(x + 4, y + 3, s - 8, s - 6);
            ctx.fillStyle = '#6a4a20';
            ctx.fillRect(x + 3, y + s - 2, s - 6, 1);
            ctx.fillStyle = '#4a4a4a';
            ctx.fillRect(x + s - 5, y + Math.floor(s / 2) - 1, 2, 2);
        },
        21: (ctx, x, y, s) => { // 门上半：竖木板 + 四格玻璃窗
            ctx.fillStyle = '#b89040';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < s; i += 4) {
                ctx.fillStyle = '#8a6a30';
                ctx.fillRect(x + i, y, 1, s);
            }
            ctx.fillStyle = '#9ec8e8';
            ctx.fillRect(x + 3, y + 3, 4, 4);
            ctx.fillRect(x + 9, y + 3, 4, 4);
            ctx.fillRect(x + 3, y + 9, 4, 4);
            ctx.fillRect(x + 9, y + 9, 4, 4);
            ctx.fillStyle = '#6a4a20';
            ctx.fillRect(x + 7, y + 2, 1, 12);
            ctx.fillRect(x + 2, y + 7, 12, 1);
        },
        22: (ctx, x, y, s) => { // 红石粉图标：中心粉堆 + 四向散落的红色晶粉
            ctx.fillStyle = '#3a2a1a';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#c02015';
            ctx.fillRect(x + 6, y + 6, 4, 4);
            ctx.fillStyle = '#ff3820';
            ctx.fillRect(x + 7, y + 7, 2, 2);
            ctx.fillStyle = '#a01812';
            ctx.fillRect(x + 2, y + 4, 3, 2);
            ctx.fillRect(x + 11, y + 4, 3, 2);
            ctx.fillRect(x + 2, y + 10, 3, 2);
            ctx.fillRect(x + 11, y + 10, 3, 2);
            ctx.fillStyle = '#d83020';
            ctx.fillRect(x + 5, y + 2, 2, 2);
            ctx.fillRect(x + 9, y + 2, 2, 2);
            ctx.fillRect(x + 5, y + 12, 2, 2);
            ctx.fillRect(x + 9, y + 12, 2, 2);
        },
        23: (ctx, x, y, s) => { // 拉杆图标：圆石底座 + 斜置木杆（红石尖端）
            ctx.fillStyle = '#6a6a6a';
            ctx.fillRect(x + 3, y + s - 6, s - 6, 4);
            ctx.fillStyle = '#7a7a7a';
            ctx.fillRect(x + 4, y + s - 5, s - 8, 2);
            ctx.strokeStyle = '#8a6a3a';
            ctx.lineWidth = 2;
            const cx0 = x + s / 2 - 1;
            ctx.beginPath();
            ctx.moveTo(cx0, y + s - 6);
            ctx.lineTo(cx0 + 3, y + 4);
            ctx.stroke();
            ctx.fillStyle = '#c03020';
            ctx.fillRect(cx0 + 2, y + 2, 3, 3);
        },
        24: (ctx, x, y, s) => { // 红石灯（灭）：暗棕底 + 网格
            ctx.fillStyle = '#5a3f22';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#6a4a2a';
            ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
            ctx.fillStyle = '#4a3218';
            for (let i = 2; i < s - 2; i += 4) {
                ctx.fillRect(x + i, y + 2, 1, s - 4);
                ctx.fillRect(x + 2, y + i, s - 4, 1);
            }
        },
        25: (ctx, x, y, s) => { // 红石灯（亮）：金黄辉光 + 网格
            ctx.fillStyle = '#c88a2a';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#ffd870';
            ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
            ctx.fillStyle = '#fff0b0';
            ctx.fillRect(x + 4, y + 4, s - 8, s - 8);
            ctx.fillStyle = '#c88a2a';
            for (let i = 2; i < s - 2; i += 4) {
                ctx.fillRect(x + i, y + 2, 1, s - 4);
                ctx.fillRect(x + 2, y + i, s - 4, 1);
            }
        },
        26: (ctx, x, y, s) => { // 红石火把图标：木杆 + 亮红头
            ctx.fillStyle = '#2a2a3a';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#6a4a2a';
            ctx.fillRect(x + s / 2 - 1, y + s / 2, 2, s / 2);
            ctx.fillStyle = '#ff4020';
            ctx.fillRect(x + s / 2 - 2, y + 3, 4, 5);
            ctx.fillStyle = '#ffa080';
            ctx.fillRect(x + s / 2 - 1, y + 4, 2, 2);
        },
        27: (ctx, x, y, s) => { // 按钮图标：石质圆角小方块 + 高光
            ctx.fillStyle = '#6a6a6a';
            ctx.fillRect(x + 3, y + 4, s - 6, s - 8);
            ctx.fillStyle = '#8a8a8a';
            ctx.fillRect(x + 4, y + 5, s - 8, s - 10);
            ctx.fillStyle = '#a8a8a8';
            ctx.fillRect(x + 5, y + 6, 3, 2);
        },
        28: (ctx, x, y, s) => { // 压力板图标：俯视扁平石板 + 边缘阴影
            ctx.fillStyle = '#4a4a4a';
            ctx.fillRect(x + 1, y + 3, s - 2, s - 6);
            ctx.fillStyle = '#7a7a7a';
            ctx.fillRect(x + 2, y + 4, s - 4, s - 8);
            ctx.fillStyle = '#9a9a9a';
            ctx.fillRect(x + 3, y + 5, s - 6, 2);
        },
        // 工具图标（29..32）：竖持姿态、透明背景（物品非方块；手模型/物品栏共用）
        29: (ctx, x, y) => { // 铁镐：横梁镐头两端下垂 + 竖直木柄
            ctx.fillStyle = '#8a5a2a';
            ctx.fillRect(x + 7, y + 4, 2, 10); // 柄
            ctx.fillStyle = '#6a4222';
            ctx.fillRect(x + 7, y + 4, 1, 10); // 柄背光侧
            ctx.fillStyle = '#6a4222';
            ctx.fillRect(x + 7, y + 13, 2, 1); // 柄尾
            ctx.fillStyle = '#e8e8e8';
            ctx.fillRect(x + 3, y + 2, 10, 2); // 镐头横梁
            ctx.fillStyle = '#b0b0b0';
            ctx.fillRect(x + 3, y + 3, 10, 1); // 横梁下沿
            ctx.fillStyle = '#909090';
            ctx.fillRect(x + 3, y + 2, 1, 2);
            ctx.fillRect(x + 12, y + 2, 1, 2); // 横梁两端
            ctx.fillStyle = '#e8e8e8';
            ctx.fillRect(x + 2, y + 4, 2, 3); // 左镐尖下垂
            ctx.fillRect(x + 12, y + 4, 2, 3); // 右镐尖下垂
            ctx.fillStyle = '#909090';
            ctx.fillRect(x + 2, y + 6, 2, 1);
            ctx.fillRect(x + 12, y + 6, 2, 1);
        },
        30: (ctx, x, y) => { // 铁斧：单侧斧刃 + 竖直木柄
            ctx.fillStyle = '#8a5a2a';
            ctx.fillRect(x + 7, y + 3, 2, 11); // 柄
            ctx.fillStyle = '#6a4222';
            ctx.fillRect(x + 7, y + 3, 1, 11); // 柄背光侧
            ctx.fillStyle = '#6a4222';
            ctx.fillRect(x + 7, y + 13, 2, 1); // 柄尾
            ctx.fillStyle = '#e8e8e8';
            ctx.fillRect(x + 5, y + 1, 7, 4); // 斧刃上半
            ctx.fillRect(x + 4, y + 4, 8, 2); // 斧刃下半（向刃口放宽）
            ctx.fillStyle = '#b0b0b0';
            ctx.fillRect(x + 5, y + 1, 1, 4); // 背光侧
            ctx.fillStyle = '#909090';
            ctx.fillRect(x + 4, y + 5, 8, 1); // 刃口
        },
        31: (ctx, x, y) => { // 铁锹：铲头 + 竖直木柄
            ctx.fillStyle = '#8a5a2a';
            ctx.fillRect(x + 7, y + 6, 2, 8); // 柄
            ctx.fillStyle = '#6a4222';
            ctx.fillRect(x + 7, y + 6, 1, 8); // 柄背光侧
            ctx.fillStyle = '#6a4222';
            ctx.fillRect(x + 7, y + 13, 2, 1); // 柄尾
            ctx.fillStyle = '#e8e8e8';
            ctx.fillRect(x + 5, y + 1, 6, 5); // 铲头
            ctx.fillStyle = '#b0b0b0';
            ctx.fillRect(x + 5, y + 1, 1, 5); // 背光侧
            ctx.fillStyle = '#909090';
            ctx.fillRect(x + 6, y + 6, 4, 1); // 铲尖
        },
        32: (ctx, x, y) => { // 铁剑：竖直剑身 + 横护手 + 剑柄
            ctx.fillStyle = '#e8e8e8';
            ctx.fillRect(x + 7, y + 0, 2, 10); // 剑身
            ctx.fillStyle = '#b0b0b0';
            ctx.fillRect(x + 8, y + 0, 1, 10); // 剑脊
            ctx.fillStyle = '#909090';
            ctx.fillRect(x + 7, y + 1, 1, 1); // 剑尖
            ctx.fillStyle = '#4a4a4a';
            ctx.fillRect(x + 5, y + 10, 6, 2); // 护手
            ctx.fillStyle = '#8a5a2a';
            ctx.fillRect(x + 7, y + 12, 2, 3); // 握柄
            ctx.fillStyle = '#6a4222';
            ctx.fillRect(x + 6, y + 15, 4, 1); // 柄首
        },
        // 活塞组 tile（33..38）：粘液 / 活塞侧 / 活塞正面 / 机身（活塞底·观察者身）/ 活塞内面 / 观察者正面
        33: (ctx, x, y, s) => { // 粘液块：外圈深绿 + 内芯亮绿（渲染不透明，靠色差做果冻感）
            ctx.fillStyle = '#4e9c38';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#6ec84e';
            ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
            for (let i = 0; i < 14; i++) {
                const px = x + 1 + Math.floor(hash2D(i, 60, 33) * (s - 4));
                const py = y + 1 + Math.floor(hash2D(i, 61, 33) * (s - 4));
                ctx.fillStyle = hash2D(i, 62, 33) > 0.5 ? '#8ee06a' : '#5ab03e';
                ctx.fillRect(px, py, 2, 2);
            }
            ctx.fillStyle = '#b8f0a0';
            ctx.fillRect(x + 3, y + 3, 3, 2); // 高光
        },
        34: (ctx, x, y, s) => { // 活塞侧：上端金属段 + 下段木质机身条纹
            ctx.fillStyle = '#8a8a8a';
            ctx.fillRect(x, y, s, 4); // 顶部金属带
            ctx.fillStyle = '#6a6a6a';
            ctx.fillRect(x, y + 3, s, 1);
            ctx.fillStyle = '#9c7a48';
            ctx.fillRect(x, y + 4, s, s - 4); // 木质机身
            for (let i = 0; i < s; i += 4) {
                ctx.fillStyle = '#8a6a3a';
                ctx.fillRect(x + i, y + 4, 1, s - 4);
            }
            ctx.fillStyle = '#7a5a2e';
            ctx.fillRect(x, y + 8, s, 1); // 横向加固线
            ctx.fillStyle = '#4a4a4a';
            ctx.fillRect(x + 2, y + 1, 2, 2); // 铆钉
            ctx.fillRect(x + s - 4, y + 1, 2, 2);
        },
        35: (ctx, x, y, s) => { // 活塞正面（推出面）：浅石面 + 中央方形凹孔
            ctx.fillStyle = '#b0b0b0';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#9a9a9a';
            ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
            ctx.fillStyle = '#c4c4c4';
            ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
            ctx.fillStyle = '#3a3a3a';
            ctx.fillRect(x + s / 2 - 2, y + s / 2 - 2, 4, 4); // 中央推杆孔
            ctx.fillStyle = '#7a7a7a';
            ctx.fillRect(x, y, s, 1);
            ctx.fillRect(x, y, 1, s);
        },
        36: (ctx, x, y, s) => { // 机身（活塞底面 / 观察者身体）：深石板 + 四角铆钉
            ctx.fillStyle = '#5a5a5a';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#6a6a6a';
            ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
            for (let i = 0; i < 10; i++) {
                const px = x + 1 + Math.floor(hash2D(i, 63, 36) * (s - 3));
                const py = y + 1 + Math.floor(hash2D(i, 64, 36) * (s - 3));
                ctx.fillStyle = hash2D(i, 65, 36) > 0.5 ? '#747474' : '#5e5e5e';
                ctx.fillRect(px, py, 2, 2);
            }
            ctx.fillStyle = '#4a4a4a';
            ctx.fillRect(x + 2, y + 2, 2, 2);
            ctx.fillRect(x + s - 4, y + 2, 2, 2);
            ctx.fillRect(x + 2, y + s - 4, 2, 2);
            ctx.fillRect(x + s - 4, y + s - 4, 2, 2);
        },
        37: (ctx, x, y, s) => { // 活塞内面（伸出后底座朝前的一面）：石面 + 中央木质推杆截面
            ctx.fillStyle = '#b0b0b0';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#9a9a9a';
            ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
            ctx.fillStyle = '#9c7a48';
            ctx.fillRect(x + s / 2 - 2, y + s / 2 - 2, 4, 4); // 推杆截面
            ctx.fillStyle = '#7a5a2e';
            ctx.fillRect(x + s / 2 - 2, y + s / 2 - 2, 4, 1);
        },
        38: (ctx, x, y, s) => { // 观察者正面：深石面 + 居中「眼睛」（暗眶红外圈）
            ctx.fillStyle = '#5a5a5a';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#4a4a4a';
            ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(x + 3, y + 3, s - 6, s - 6); // 眼眶
            ctx.fillStyle = '#c03020';
            ctx.fillRect(x + s / 2 - 2, y + s / 2 - 2, 4, 4); // 红外圈
            ctx.fillStyle = '#ff5040';
            ctx.fillRect(x + s / 2 - 1, y + s / 2 - 1, 2, 2); // 瞳
            ctx.fillStyle = '#7a7a7a';
            ctx.fillRect(x, y, s, 1);
        },
    };

    for (const tile of tiles) {
        const tx = (tile.top % atlasSize) * tileSize;
        const ty = Math.floor(tile.top / atlasSize) * tileSize;
        if (!tileMap[tile.name]) {
            if (drawFunctions[tile.top]) {
                drawFunctions[tile.top](atlasCtx, tx, ty, tileSize);
            } else {
                atlasCtx.fillStyle = BlockInfo[tile.type].color;
                atlasCtx.fillRect(tx, ty, tileSize, tileSize);
            }
            tileMap[tile.name] = { x: tile.top % atlasSize, y: Math.floor(tile.top / atlasSize) };
        }
        if (!tileMap[`${tile.name}_side`] && tile.side !== tile.top) {
            const sx = (tile.side % atlasSize) * tileSize;
            const sy = Math.floor(tile.side / atlasSize) * tileSize;
            if (drawFunctions[tile.side]) {
                drawFunctions[tile.side](atlasCtx, sx, sy, tileSize);
            } else {
                atlasCtx.fillStyle = BlockInfo[tile.type].color;
                atlasCtx.fillRect(sx, sy, tileSize, tileSize);
            }
            tileMap[`${tile.name}_side`] = { x: tile.side % atlasSize, y: Math.floor(tile.side / atlasSize) };
        }
        if (!tileMap[`${tile.name}_bottom`] && tile.bottom !== tile.top && tile.bottom !== tile.side) {
            const bx = (tile.bottom % atlasSize) * tileSize;
            const by = Math.floor(tile.bottom / atlasSize) * tileSize;
            if (drawFunctions[tile.bottom]) {
                drawFunctions[tile.bottom](atlasCtx, bx, by, tileSize);
            } else {
                atlasCtx.fillStyle = BlockInfo[tile.type].color;
                atlasCtx.fillRect(bx, by, tileSize, tileSize);
            }
            tileMap[`${tile.name}_bottom`] = { x: tile.bottom % atlasSize, y: Math.floor(tile.bottom /
                atlasSize) };
        }
        blockUVs[tile.type] = {
            top: tileMap[tile.name] || { x: 0, y: 0 },
            side: tileMap[`${tile.name}_side`] || tileMap[tile.name] || { x: 0, y: 0 },
            bottom: tileMap[`${tile.name}_bottom`] || tileMap[`${tile.name}_side`] || tileMap[tile.name] || { x: 0,
                y: 0 },
        };
    }

    // 水单独处理为透明
    if (!tileMap['water']) {
        const wx = 8 % atlasSize;
        const wy = Math.floor(8 / atlasSize);
        drawFunctions[8](atlasCtx, wx * tileSize, wy * tileSize, tileSize);
        tileMap['water'] = { x: wx, y: wy };
    }
    blockUVs[BlockTypes.WATER] = {
        top: tileMap['water'],
        side: tileMap['water'],
        bottom: tileMap['water'],
    };

    // 门 16 个变体共享物品图标（下半 tile）；实际门板渲染不走图集 UV（见 getDoorTileTexture）
    for (let i = 0; i < DOOR_COUNT; i++) {
        blockUVs[DOOR_BASE + i] = blockUVs[DOOR_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
    }

    // 红石元件全部变体共享物品图标 tile（实际是 3D 道具网格或按邻格现算的粉线，不走图集 UV）
    for (let i = 0; i < DUST_COUNT; i++) blockUVs[DUST_BASE + i] = blockUVs[DUST_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
    for (let i = 0; i < RTORCH_COUNT; i++) blockUVs[RTORCH_BASE + i] = blockUVs[RTORCH_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
    for (let i = 0; i < BUTTON_COUNT; i++) blockUVs[BUTTON_BASE + i] = blockUVs[BUTTON_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
    for (let i = 0; i < PLATE_COUNT; i++) blockUVs[PLATE_BASE + i] = blockUVs[PLATE_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
    for (let i = 0; i < LEVER_COUNT; i++) blockUVs[LEVER_BASE + i] = blockUVs[LEVER_ITEM_ID] || blockUVs[BlockTypes.PLANKS];

    // 活塞组全部变体共享物品图标 tile（实际是 3D 道具网格，手模型/物品栏走这里的 UV）
    for (let i = 0; i < 12; i++) {
        blockUVs[PISTON_BASE + i] = blockUVs[PISTON_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
        blockUVs[STICKY_PISTON_BASE + i] = blockUVs[STICKY_PISTON_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
        blockUVs[OBSERVER_BASE + i] = blockUVs[OBSERVER_ITEM_ID] || blockUVs[BlockTypes.STONE];
    }
    for (let i = 0; i < 6; i++) blockUVs[PISTON_HEAD_BASE + i] = blockUVs[PISTON_ITEM_ID] || blockUVs[BlockTypes.PLANKS];

    // 门上半 tile（21）没有对应的方块 ID，单独注册进 tileMap：
    // 覆盖加载器（TILE_OVERRIDES）与门板纹理裁取（getDoorTileTexture）都靠它定位
    if (!tileMap['door_upper'] && drawFunctions[21]) {
        const ux = (21 % atlasSize) * tileSize;
        const uy = Math.floor(21 / atlasSize) * tileSize;
        drawFunctions[21](atlasCtx, ux, uy, tileSize);
        tileMap['door_upper'] = { x: 21 % atlasSize, y: Math.floor(21 / atlasSize) };
    }

    // 活塞内面 tile（37）同样没有独立方块 ID（伸出底座朝前的一面 / 活塞头背面专用），
    // 单独注册进 tileMap 供 chunk.js 的活塞道具网格铺 UV
    if (!tileMap['piston_inner'] && drawFunctions[37]) {
        const ix = (37 % atlasSize) * tileSize;
        const iy = Math.floor(37 / atlasSize) * tileSize;
        drawFunctions[37](atlasCtx, ix, iy, tileSize);
        tileMap['piston_inner'] = { x: 37 % atlasSize, y: Math.floor(37 / atlasSize) };
    }

    const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.generateMipmaps = false;
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
    return atlasTexture;
}

export const atlasTexture = generateAllTextures();

// ==================== 自定义贴图覆盖（ComfyUI 生成） ====================
// assets/textures/<名>.png 若存在（16×16），加载后覆盖图集对应 tile 并通知
// 已派生的道具纹理重绘（门板）。没有这些文件时保持上面的程序化兜底纹理。
const TILE_OVERRIDES = [
    { file: 'assets/textures/door_lower.png', tile: 'door_lower' },
    { file: 'assets/textures/door_upper.png', tile: 'door_upper' },
    { file: 'assets/textures/lever.png', tile: 'lever' },
    { file: 'assets/textures/lamp_off.png', tile: 'lamp_off' },
    { file: 'assets/textures/lamp_lit.png', tile: 'lamp_lit' },
];

const tileOverrideListeners = [];

export function onTileOverride(fn) {
    tileOverrideListeners.push(fn);
}

for (const { file, tile } of TILE_OVERRIDES) {
    if (!tileMap[tile]) continue;
    const img = new Image();
    img.onload = () => {
        const t = tileMap[tile];
        atlasCtx.drawImage(img, t.x * tileSize, t.y * tileSize, tileSize, tileSize);
        atlasTexture.needsUpdate = true;
        for (const fn of tileOverrideListeners) fn();
    };
    img.onerror = () => { /* 无自定义贴图：保持程序化兜底 */ };
    img.src = file;
}

// ==================== 门道具纹理 ====================
// 门板是独立薄片网格（BoxGeometry 各面默认铺满整张纹理），
// 从图集裁出对应 tile 单独成纹理；自定义贴图加载完成后自动重绘。
const doorTileTextures = {};

function redrawDoorTile(entry) {
    const t = tileMap[entry.key];
    if (!t) return;
    entry.ctx.clearRect(0, 0, tileSize, tileSize);
    entry.ctx.drawImage(atlasCanvas, t.x * tileSize, t.y * tileSize, tileSize, tileSize, 0, 0, tileSize,
        tileSize);
    entry.tex.needsUpdate = true;
}

export function getDoorTileTexture(half) {
    const key = half ? 'door_upper' : 'door_lower';
    let entry = doorTileTextures[key];
    if (!entry) {
        const cnv = document.createElement('canvas');
        cnv.width = tileSize;
        cnv.height = tileSize;
        const ctx = cnv.getContext('2d');
        const tex = new THREE.CanvasTexture(cnv);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        entry = { cnv, ctx, tex, key };
        doorTileTextures[key] = entry;
        redrawDoorTile(entry);
        onTileOverride(() => redrawDoorTile(entry));
    }
    return entry.tex;
}

export function getUVForFace(blockType, face) {
    const uv = blockUVs[blockType] || blockUVs[BlockTypes.STONE];
    let tile;
    if (face === 'top') tile = uv.top;
    else if (face === 'bottom') tile = uv.bottom;
    else tile = uv.side;
    if (!tile) tile = { x: 0, y: 0 };
    const u0 = (tile.x / atlasSize);
    const v0 = 1 - ((tile.y + 1) / atlasSize);
    const u1 = ((tile.x + 1) / atlasSize);
    const v1 = 1 - (tile.y / atlasSize);
    return { u0, v0, u1, v1 };
}

// ==================== 通用单 tile 纹理（手模型持物/道具用） ====================
// 与 getDoorTileTexture 同思路：从图集裁出一个 tile 单独成纹理，透明背景保留
const tileTextureCache = {};

export function getTileTexture(name) {
    let entry = tileTextureCache[name];
    if (!entry) {
        const t = tileMap[name];
        if (!t) return null;
        const cnv = document.createElement('canvas');
        cnv.width = tileSize;
        cnv.height = tileSize;
        const ctx = cnv.getContext('2d');
        const tex = new THREE.CanvasTexture(cnv);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        entry = { cnv, ctx, tex };
        tileTextureCache[name] = entry;
        redrawTileTexture(entry, name);
        onTileOverride(() => redrawTileTexture(entry, name));
    }
    return entry.tex;
}

function redrawTileTexture(entry, name) {
    const t = tileMap[name];
    if (!t) return;
    entry.ctx.clearRect(0, 0, tileSize, tileSize);
    entry.ctx.drawImage(atlasCanvas, t.x * tileSize, t.y * tileSize, tileSize, tileSize, 0, 0, tileSize,
        tileSize);
    entry.tex.needsUpdate = true;
}

// ==================== 挖掘裂纹贴图（原版 destroy_stage 0..9） ====================
// 累进式裂纹：预生成固定线段并按「离中心由近到远」排序，阶段 s 绘制前 (s+1)/10 ——
// 早期是中心几条短裂纹，越挖越向外蔓延布满整面，直至碎裂（还原原版观感）。
// 叠在目标方块表面（js/mining.js 的 overlay 网格换贴图）。
let crackTextureList = null;

export function getCrackTextures() {
    if (crackTextureList) return crackTextureList;
    // 固定种子生成裂纹：每条是从中心向外的一小段「拐折线」（两段折线更像裂纹），
    // 共 16 条；按离中心的距离升序，早期只画中心两三条，后期才蔓延到整面。
    // 实测覆盖率约束：阶段 0 ≈ 4%、阶段 5 ≈ 20%、阶段 9 ≈ 30%（对齐原版观感，别糊成一片）
    const cracks = [];
    for (let i = 0; i < 16; i++) {
        const cx = 4 + hash2D(i, 1, 77) * 8;
        const cy = 4 + hash2D(i, 2, 77) * 8;
        const ang = hash2D(i, 3, 77) * Math.PI * 2;
        const bend = (hash2D(i, 4, 77) - 0.5) * 1.6; // 拐折角
        const len = 2.5 + hash2D(i, 5, 77) * 2.5; // 半长
        const mx = cx + Math.cos(ang) * len * 0.5;
        const my = cy + Math.sin(ang) * len * 0.5;
        cracks.push({
            cx,
            cy,
            x1: cx - Math.cos(ang) * len * 0.5,
            y1: cy - Math.sin(ang) * len * 0.5,
            x2: mx + Math.cos(ang + bend) * len * 0.5,
            y2: my + Math.sin(ang + bend) * len * 0.5,
            xm: mx,
            ym: my,
        });
    }
    // 按离中心的距离升序：先中心裂纹，后边缘蔓延
    cracks.sort((a, b) => Math.hypot(a.cx - 8, a.cy - 8) - Math.hypot(b.cx - 8, b.cy - 8));
    crackTextureList = [];
    for (let stage = 0; stage < 10; stage++) {
        const cnv = document.createElement('canvas');
        cnv.width = tileSize;
        cnv.height = tileSize;
        const ctx = cnv.getContext('2d');
        ctx.strokeStyle = 'rgba(16,12,10,0.85)';
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const n = Math.round((stage + 1) / 10 * cracks.length);
        for (let i = 0; i < n; i++) {
            const s = cracks[i];
            ctx.beginPath();
            ctx.moveTo(s.x1, s.y1);
            ctx.lineTo(s.xm, s.ym);
            ctx.lineTo(s.x2, s.y2);
            ctx.stroke();
        }
        const tex = new THREE.CanvasTexture(cnv);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        crackTextureList.push(tex);
    }
    return crackTextureList;
}
