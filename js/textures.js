// ==================== textures.js ====================

import * as THREE from 'three';
import { BlockInfo, BlockTypes, BUTTON_BASE, ItemTypes, BUTTON_COUNT, BUTTON_ITEM_ID, BELT_BASE, BELT_COUNT, BELT_ITEM_ID, CLUTCH_BASE, CLUTCH_COUNT, COGWHEEL_BASE, COGWHEEL_ITEM_ID, CRUSHER_BASE, CRUSHER_ITEM_ID, DEPLOYER_BASE, DEPLOYER_COUNT, DEPLOYER_ITEM_ID, DUST_BASE, DUST_COUNT, DUST_ITEM_ID, DOOR_BASE, DOOR_COUNT, DOOR_ITEM_ID, LAMP_BASE, LEVER_BASE, LEVER_COUNT, LEVER_ITEM_ID, OBSERVER_BASE, OBSERVER_ITEM_ID, PISTON_BASE, PISTON_HEAD_BASE, PISTON_ITEM_ID, PLATE_BASE, PLATE_COUNT, PLATE_ITEM_ID, RTORCH_BASE, RTORCH_COUNT, RTORCH_ITEM_ID, SAW_BASE, SAW_ITEM_ID, SHAFT_BASE, SHAFT_ITEM_ID, STICKY_PISTON_BASE, STICKY_PISTON_ITEM_ID, ToolTypes, WATERWHEEL_BASE, WATERWHEEL_ITEM_ID } from './config.js';
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
// 2026-09-05 从 8×8 扩到 16×16（256 tile）：生存进度组的矿石/合成站/食物/四档工具
// 新增 28 个 tile（45..72），8×8 的 64 格已放不下。所有 UV 计算都动态读 atlasSize，
// 扩容对区块/物品/手部模型零影响；旧 tile 编号 0..44 不变（TILE_OVERRIDES 与存档无涉）。
export const atlasSize = 16;

export const tileSize = 16; // tile 像素尺寸（16×16）

export const atlasCanvas = document.createElement('canvas');

atlasCanvas.width = atlasSize * tileSize;

atlasCanvas.height = atlasSize * tileSize;

export const atlasCtx = atlasCanvas.getContext('2d');

export const blockUVs = {};

export const tileMap = {};

// ---- 生存进度组贴图辅助（tile 45..72 共用）：矿石 = 石底 + 彩斑，工具 = 木柄 + 换色工具头 ----
function drawStoneBase(ctx, x, y, s) {
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(x, y, s, s);
    for (let i = 0; i < 22; i++) {
        const px = x + Math.floor(hash2D(i, 31, 3) * s);
        const py = y + Math.floor(hash2D(i, 32, 3) * s);
        ctx.fillStyle = hash2D(i, 33, 3) > 0.5 ? '#6a6a6a' : '#8a8a8a';
        ctx.fillRect(px, py, 1 + Math.floor(hash2D(i, 34, 3) * 2), 1 + Math.floor(hash2D(i, 35, 3) * 2));
    }
}

function drawPlanksBase(ctx, x, y, s) {
    ctx.fillStyle = '#c8a050';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#a87c38';
    for (let i = 0; i < 4; i++) ctx.fillRect(x, y + i * 4 + 3, s, 1); // 板缝
    ctx.fillStyle = '#d8b060';
    for (let i = 0; i < 10; i++) {
        const px = x + Math.floor(hash2D(i, 41, 4) * s);
        const py = y + Math.floor(hash2D(i, 42, 4) * s);
        ctx.fillRect(px, py, 1 + Math.floor(hash2D(i, 43, 4) * 3), 1);
    }
}

function drawOre(ctx, x, y, s, main, hi, blobs) {
    drawStoneBase(ctx, x, y, s);
    for (let i = 0; i < blobs; i++) {
        const px = x + 2 + Math.floor(hash2D(i, 51, 7) * (s - 6));
        const py = y + 2 + Math.floor(hash2D(i, 52, 7) * (s - 6));
        ctx.fillStyle = main;
        ctx.fillRect(px, py, 3, 2);
        ctx.fillStyle = hi;
        ctx.fillRect(px, py, 1, 1);
    }
}

// 工具图标（形状与铁质 29..32 一致，工具头换色：木/石/钻三档）
function drawTool(ctx, x, y, kind, head, headDark) {
    const stick = '#8a5a2a', stickDark = '#6a4222';
    if (kind === 'pickaxe') {
        ctx.fillStyle = stick;
        ctx.fillRect(x + 7, y + 4, 2, 10);
        ctx.fillStyle = stickDark;
        ctx.fillRect(x + 7, y + 4, 1, 10);
        ctx.fillRect(x + 7, y + 13, 2, 1);
        ctx.fillStyle = head;
        ctx.fillRect(x + 3, y + 2, 10, 2);
        ctx.fillRect(x + 2, y + 4, 2, 3);
        ctx.fillRect(x + 12, y + 4, 2, 3);
        ctx.fillStyle = headDark;
        ctx.fillRect(x + 3, y + 3, 10, 1);
        ctx.fillRect(x + 2, y + 6, 2, 1);
        ctx.fillRect(x + 12, y + 6, 2, 1);
    } else if (kind === 'axe') {
        ctx.fillStyle = stick;
        ctx.fillRect(x + 7, y + 3, 2, 11);
        ctx.fillStyle = stickDark;
        ctx.fillRect(x + 7, y + 3, 1, 11);
        ctx.fillRect(x + 7, y + 13, 2, 1);
        ctx.fillStyle = head;
        ctx.fillRect(x + 5, y + 1, 7, 4);
        ctx.fillRect(x + 4, y + 4, 8, 2);
        ctx.fillStyle = headDark;
        ctx.fillRect(x + 5, y + 1, 1, 4);
        ctx.fillRect(x + 4, y + 5, 8, 1);
    } else if (kind === 'shovel') {
        ctx.fillStyle = stick;
        ctx.fillRect(x + 7, y + 6, 2, 8);
        ctx.fillStyle = stickDark;
        ctx.fillRect(x + 7, y + 6, 1, 8);
        ctx.fillRect(x + 7, y + 13, 2, 1);
        ctx.fillStyle = head;
        ctx.fillRect(x + 5, y + 1, 6, 5);
        ctx.fillStyle = headDark;
        ctx.fillRect(x + 5, y + 1, 1, 5);
        ctx.fillRect(x + 6, y + 6, 4, 1);
    } else { // sword
        ctx.fillStyle = stick;
        ctx.fillRect(x + 7, y + 10, 2, 4); // 柄
        ctx.fillStyle = stickDark;
        ctx.fillRect(x + 7, y + 13, 2, 1);
        ctx.fillStyle = '#5a3a1a';
        ctx.fillRect(x + 4, y + 9, 8, 1); // 护手
        ctx.fillStyle = head;
        ctx.fillRect(x + 7, y + 1, 2, 8); // 剑身
        ctx.fillRect(x + 6, y + 2, 1, 6);
        ctx.fillStyle = headDark;
        ctx.fillRect(x + 9, y + 2, 1, 6);
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(x + 7, y + 1, 1, 6); // 剑脊高光
    }
}

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
        { type: SHAFT_ITEM_ID, top: 40, side: 39, bottom: 40, name: 'shaft' }, // 传动轴：端面年轮 + 侧面木纹
        { type: COGWHEEL_ITEM_ID, top: 41, side: 41, bottom: 41, name: 'cog' }, // 齿轮（实际是 3D 轮盘道具）
        { type: WATERWHEEL_ITEM_ID, top: 42, side: 42, bottom: 42, name: 'waterwheel' }, // 水车（实际是 3D 大轮盘）
        { type: CRUSHER_ITEM_ID, top: 43, side: 43, bottom: 43, name: 'crusher' }, // 粉碎轮（实际是 3D 轮盘）
        { type: SAW_ITEM_ID, top: 44, side: 44, bottom: 44, name: 'saw' }, // 机械锯（实际是 3D 圆锯片）
        // ---- 生存进度组（2026-09-05）：矿石/合成站/羊毛/物品/四档工具，tile 45..72 ----
        { type: BlockTypes.COAL_ORE, top: 45, side: 45, bottom: 45, name: 'coal_ore' },
        { type: BlockTypes.IRON_ORE, top: 46, side: 46, bottom: 46, name: 'iron_ore' },
        { type: BlockTypes.DIAMOND_ORE, top: 47, side: 47, bottom: 47, name: 'diamond_ore' },
        { type: BlockTypes.CRAFTING_TABLE, top: 48, side: 49, bottom: 12, name: 'crafting_table' }, // 顶面网格 + 侧面工具痕
        { type: BlockTypes.FURNACE, top: 51, side: 50, bottom: 51, name: 'furnace' }, // 四面都是炉口（无朝向状态）
        { type: BlockTypes.WOOL, top: 52, side: 52, bottom: 52, name: 'wool' },
        { type: ItemTypes.STICK, top: 53, side: 53, bottom: 53, name: 'stick' },
        { type: ItemTypes.COAL, top: 54, side: 54, bottom: 54, name: 'coal' },
        { type: ItemTypes.IRON_INGOT, top: 55, side: 55, bottom: 55, name: 'iron_ingot' },
        { type: ItemTypes.DIAMOND, top: 56, side: 56, bottom: 56, name: 'diamond' },
        { type: ItemTypes.APPLE, top: 57, side: 57, bottom: 57, name: 'apple' },
        { type: ItemTypes.RAW_PORK, top: 58, side: 58, bottom: 58, name: 'raw_pork' },
        { type: ItemTypes.COOKED_PORK, top: 59, side: 59, bottom: 59, name: 'cooked_pork' },
        { type: ItemTypes.GUNPOWDER, top: 60, side: 60, bottom: 60, name: 'gunpowder' },
        { type: ToolTypes.WOOD_PICKAXE, top: 61, side: 61, bottom: 61, name: 'wood_pickaxe' },
        { type: ToolTypes.STONE_PICKAXE, top: 62, side: 62, bottom: 62, name: 'stone_pickaxe' },
        { type: ToolTypes.DIAMOND_PICKAXE, top: 63, side: 63, bottom: 63, name: 'diamond_pickaxe' },
        { type: ToolTypes.WOOD_AXE, top: 64, side: 64, bottom: 64, name: 'wood_axe' },
        { type: ToolTypes.STONE_AXE, top: 65, side: 65, bottom: 65, name: 'stone_axe' },
        { type: ToolTypes.DIAMOND_AXE, top: 66, side: 66, bottom: 66, name: 'diamond_axe' },
        { type: ToolTypes.WOOD_SHOVEL, top: 67, side: 67, bottom: 67, name: 'wood_shovel' },
        { type: ToolTypes.STONE_SHOVEL, top: 68, side: 68, bottom: 68, name: 'stone_shovel' },
        { type: ToolTypes.DIAMOND_SHOVEL, top: 69, side: 69, bottom: 69, name: 'diamond_shovel' },
        { type: ToolTypes.WOOD_SWORD, top: 70, side: 70, bottom: 70, name: 'wood_sword' },
        { type: ToolTypes.STONE_SWORD, top: 71, side: 71, bottom: 71, name: 'stone_sword' },
        { type: ToolTypes.DIAMOND_SWORD, top: 72, side: 72, bottom: 72, name: 'diamond_sword' },
        // ---- 物流+控制组（Create-lite L1）：传送带 tile 73..74（顶面箭头 / 带沿侧面）、投料器 tile 75..76（正面投料口 / 机身侧面） ----
        { type: BELT_ITEM_ID, top: 73, side: 74, bottom: 74, name: 'belt' }, // 传送带（实际是 3D 薄板道具，顶面箭头指北为基准、按 dir 旋转整板）
        { type: DEPLOYER_ITEM_ID, top: 75, side: 76, bottom: 76, name: 'deployer' }, // 投料器（实际是 3D 方箱+喷嘴道具，正面投料口 tile 75 按朝向旋转）
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
        // 动力组 tile（39..44）：轴侧面 / 轴端面 / 齿轮 / 水车 / 粉碎轮 / 锯片
        39: (ctx, x, y, s) => { // 轴侧面：纵向木纹条 + 加固箍
            ctx.fillStyle = '#9c7a48';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < s; i += 3) {
                ctx.fillStyle = i % 6 === 0 ? '#8a6a3a' : '#ac8a58';
                ctx.fillRect(x + i, y, 2, s);
            }
            ctx.fillStyle = '#6a4a26';
            ctx.fillRect(x, y + 2, s, 1);
            ctx.fillRect(x, y + s - 3, s, 1); // 两道加固箍
        },
        40: (ctx, x, y, s) => { // 轴端面：年轮圆环 + 中心方榫
            ctx.fillStyle = '#9c7a48';
            ctx.fillRect(x, y, s, s);
            ctx.strokeStyle = '#7a5a30';
            ctx.lineWidth = 1;
            for (let r = 2; r < s / 2; r += 2) {
                ctx.beginPath();
                ctx.arc(x + s / 2, y + s / 2, r, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.fillStyle = '#6a4a26';
            ctx.fillRect(x + s / 2 - 2, y + s / 2 - 2, 4, 4); // 方榫（与齿轮轴孔咬合）
        },
        41: (ctx, x, y, s) => { // 齿轮面：木质轮盘 + 周圈齿 + 中心轴孔
            const c = s / 2;
            ctx.fillStyle = '#7a5a30';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#8f6c3a';
            ctx.beginPath();
            ctx.arc(x + c, y + c, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#a07c44';
            ctx.beginPath();
            ctx.arc(x + c, y + c, 3.5, 0, Math.PI * 2);
            ctx.fill();
            // 周圈 8 齿（方块齿，像素风）
            ctx.fillStyle = '#93703c';
            for (let i = 0; i < 8; i++) {
                const ang = i / 8 * Math.PI * 2;
                const px = x + c + Math.cos(ang) * 6.2;
                const py = y + c + Math.sin(ang) * 6.2;
                ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
            }
            ctx.fillStyle = '#4a3418';
            ctx.fillRect(x + c - 1, y + c - 1, 2, 2); // 轴孔
            ctx.strokeStyle = '#6a4a26';
            ctx.lineWidth = 1;
            for (let i = 0; i < 4; i++) { // 四根辐条
                const ang = i / 4 * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(x + c, y + c);
                ctx.lineTo(x + c + Math.cos(ang) * 5, y + c + Math.sin(ang) * 5);
                ctx.stroke();
            }
        },
        42: (ctx, x, y, s) => { // 水车轮面：外圈轮缘 + 辐条 + 叶片刻痕 + 轴心
            const c = s / 2;
            ctx.fillStyle = '#6a4a26';
            ctx.fillRect(x, y, s, s);
            ctx.strokeStyle = '#8a6a3a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x + c, y + c, 6.5, 0, Math.PI * 2);
            ctx.stroke(); // 轮缘
            ctx.strokeStyle = '#9c7a48';
            ctx.lineWidth = 1;
            for (let i = 0; i < 6; i++) { // 六根辐条
                const ang = i / 6 * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(x + c, y + c);
                ctx.lineTo(x + c + Math.cos(ang) * 6.5, y + c + Math.sin(ang) * 6.5);
                ctx.stroke();
            }
            ctx.fillStyle = '#7a5a30';
            for (let i = 0; i < 8; i++) { // 周圈叶片
                const ang = i / 8 * Math.PI * 2;
                const px = x + c + Math.cos(ang) * 5.2;
                const py = y + c + Math.sin(ang) * 5.2;
                ctx.fillRect(px - 1, py - 1, 2, 2);
            }
            ctx.fillStyle = '#4a3418';
            ctx.fillRect(x + c - 1.5, y + c - 1.5, 3, 3); // 轴心
        },
        43: (ctx, x, y, s) => { // 粉碎轮面：厚重石盘 + 放射凹槽（碾碎纹）
            const c = s / 2;
            ctx.fillStyle = '#8a8a8a';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#9a9a9a';
            ctx.beginPath();
            ctx.arc(x + c, y + c, 6.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#5a5a5a';
            for (let i = 0; i < 6; i++) { // 放射状碾碎凹槽
                const ang = i / 6 * Math.PI * 2;
                ctx.save();
                ctx.translate(x + c, y + c);
                ctx.rotate(ang);
                ctx.fillRect(1, -1, 5, 2);
                ctx.restore();
            }
            ctx.strokeStyle = '#6a6a6a';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x + c, y + c, 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#3a3a3a';
            ctx.fillRect(x + c - 1.5, y + c - 1.5, 3, 3); // 轴孔
        },
        44: (ctx, x, y, s) => { // 锯片：金属圆盘 + 周圈锯齿 + 中心孔
            const c = s / 2;
            ctx.fillStyle = '#6a6e78';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#b8bcc4';
            ctx.beginPath();
            ctx.arc(x + c, y + c, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#d0d4dc';
            ctx.beginPath();
            ctx.arc(x + c, y + c - 1, 4.5, 0, Math.PI * 2);
            ctx.fill(); // 高光
            ctx.fillStyle = '#989ca6';
            for (let i = 0; i < 12; i++) { // 周圈细齿
                const ang = i / 12 * Math.PI * 2;
                const px = x + c + Math.cos(ang) * 6.8;
                const py = y + c + Math.sin(ang) * 6.8;
                ctx.fillRect(px - 0.5, py - 0.5, 1, 1);
            }
            ctx.fillStyle = '#3a3e48';
            ctx.fillRect(x + c - 1, y + c - 1, 2, 2); // 中心孔
        },
        // ---- 生存进度组 tile 45..72 ----
        45: (ctx, x, y, s) => drawOre(ctx, x, y, s, '#26262a', '#3c3c44', 9), // 窗煤矿石：石底 + 黑煤斑
        46: (ctx, x, y, s) => drawOre(ctx, x, y, s, '#c99e76', '#a87e58', 7), // 铁矿石：石底 + 铁锈斑
        47: (ctx, x, y, s) => drawOre(ctx, x, y, s, '#4fded0', '#8af5ea', 5), // 钻石矿石：石底 + 青钻斑
        48: (ctx, x, y, s) => { // 工作台顶面：木板底 + 深色网格 + 角落划痕
            drawPlanksBase(ctx, x, y, s);
            ctx.fillStyle = '#5a3c18';
            ctx.fillRect(x + 2, y + 2, s - 4, 1);
            ctx.fillRect(x + 2, y + s - 3, s - 4, 1);
            ctx.fillRect(x + 2, y + 2, 1, s - 4);
            ctx.fillRect(x + s - 3, y + 2, 1, s - 4);
            ctx.fillStyle = '#7a5228';
            ctx.fillRect(x + 4, y + 4, 4, 1);
            ctx.fillRect(x + 9, y + 8, 3, 1);
        },
        49: (ctx, x, y, s) => { // 工作台侧面：木板底 + 上沿台面 + 挂着的锯/锤轮廓
            drawPlanksBase(ctx, x, y, s);
            ctx.fillStyle = '#8a5f30';
            ctx.fillRect(x, y, s, 3); // 台面边
            ctx.fillStyle = '#4a3014';
            ctx.fillRect(x + 2, y + 6, 5, 2); // 工具横放痕迹
            ctx.fillRect(x + 9, y + 10, 4, 2);
        },
        50: (ctx, x, y, s) => { // 熔炉正面：石底 + 黑炉口 + 橙红火光
            drawStoneBase(ctx, x, y, s);
            ctx.fillStyle = '#1c1c1e';
            ctx.fillRect(x + 3, y + 7, s - 6, 6); // 炉口
            ctx.fillStyle = '#ff8830';
            ctx.fillRect(x + 4, y + 10, s - 8, 2); // 火光
            ctx.fillStyle = '#ffc040';
            ctx.fillRect(x + 6, y + 11, 2, 1);
            ctx.fillStyle = '#55555c';
            ctx.fillRect(x + 2, y + 2, s - 4, 2); // 顶部收边
        },
        51: (ctx, x, y, s) => { // 熔炉顶/底：石底 + 膛盖纹
            drawStoneBase(ctx, x, y, s);
            ctx.fillStyle = '#4c4c54';
            ctx.fillRect(x + 4, y + 4, s - 8, s - 8);
            ctx.fillStyle = '#6a6a72';
            ctx.fillRect(x + 5, y + 5, s - 10, s - 10);
        },
        52: (ctx, x, y, s) => { // 白色羊毛：卷曲噪点
            ctx.fillStyle = '#e8e6dc';
            ctx.fillRect(x, y, s, s);
            for (let i = 0; i < 26; i++) {
                const px = x + Math.floor(hash2D(i, 71, 5) * (s - 2));
                const py = y + Math.floor(hash2D(i, 72, 5) * (s - 2));
                ctx.fillStyle = hash2D(i, 73, 5) > 0.5 ? '#d8d5c8' : '#f6f4ec';
                ctx.fillRect(px, py, 2, 2);
            }
        },
        53: (ctx, x, y, s) => { // 木棍：斜放短棍
            ctx.fillStyle = '#9c6a30';
            for (let i = 0; i < 8; i++) ctx.fillRect(x + 3 + i, y + 12 - i, 2, 2);
            ctx.fillStyle = '#7a4e20';
            for (let i = 0; i < 8; i++) ctx.fillRect(x + 5 + i, y + 12 - i, 1, 1);
        },
        54: (ctx, x, y, s) => { // 煤炭：黑亮块煤
            ctx.fillStyle = '#26262a';
            ctx.fillRect(x + 3, y + 4, 10, 9);
            ctx.fillRect(x + 5, y + 2, 6, 2);
            ctx.fillStyle = '#3e3e46';
            ctx.fillRect(x + 4, y + 5, 3, 2);
            ctx.fillRect(x + 9, y + 9, 2, 2);
            ctx.fillStyle = '#101014';
            ctx.fillRect(x + 9, y + 5, 3, 2);
            ctx.fillRect(x + 4, y + 10, 2, 2);
        },
        55: (ctx, x, y, s) => { // 铁锭：梯形锭
            ctx.fillStyle = '#d3d9df';
            ctx.fillRect(x + 3, y + 6, 10, 6);
            ctx.fillRect(x + 5, y + 4, 6, 2);
            ctx.fillStyle = '#f0f4f8';
            ctx.fillRect(x + 4, y + 6, 8, 1);
            ctx.fillStyle = '#9aa4ae';
            ctx.fillRect(x + 3, y + 11, 10, 1);
        },
        56: (ctx, x, y, s) => { // 钻石：青色菱形宝石
            ctx.fillStyle = '#4fded0';
            ctx.fillRect(x + 6, y + 3, 4, 2);
            ctx.fillRect(x + 4, y + 5, 8, 4);
            ctx.fillRect(x + 6, y + 9, 4, 2);
            ctx.fillRect(x + 7, y + 11, 2, 1);
            ctx.fillStyle = '#8af5ea';
            ctx.fillRect(x + 6, y + 5, 2, 2);
            ctx.fillStyle = '#2aa89c';
            ctx.fillRect(x + 9, y + 7, 2, 2);
        },
        57: (ctx, x, y, s) => { // 苹果：红果 + 叶柄
            ctx.fillStyle = '#e04a3a';
            ctx.fillRect(x + 4, y + 5, 8, 8);
            ctx.fillRect(x + 3, y + 7, 10, 4);
            ctx.fillStyle = '#f07a5a';
            ctx.fillRect(x + 5, y + 6, 2, 3); // 高光
            ctx.fillStyle = '#5a3a1a';
            ctx.fillRect(x + 7, y + 2, 2, 3); // 柄
            ctx.fillStyle = '#4a9e3d';
            ctx.fillRect(x + 9, y + 3, 3, 2); // 叶
        },
        58: (ctx, x, y, s) => { // 生猪肉：粉红肉块
            ctx.fillStyle = '#e89c96';
            ctx.fillRect(x + 3, y + 5, 10, 7);
            ctx.fillStyle = '#f4c1bc';
            ctx.fillRect(x + 5, y + 6, 4, 3); // 脂肪纹
            ctx.fillStyle = '#c97a74';
            ctx.fillRect(x + 9, y + 9, 3, 2);
        },
        59: (ctx, x, y, s) => { // 熟猪排：焦褐排
            ctx.fillStyle = '#b06a3a';
            ctx.fillRect(x + 3, y + 5, 10, 7);
            ctx.fillStyle = '#d8925a';
            ctx.fillRect(x + 5, y + 6, 4, 3);
            ctx.fillStyle = '#8a4e26';
            ctx.fillRect(x + 9, y + 9, 3, 2);
        },
        60: (ctx, x, y, s) => { // 火药：灰粉堆
            ctx.fillStyle = '#5e5e66';
            ctx.fillRect(x + 4, y + 8, 8, 4);
            ctx.fillRect(x + 6, y + 6, 4, 2);
            ctx.fillStyle = '#8a8a94';
            for (let i = 0; i < 8; i++) {
                ctx.fillRect(x + 4 + Math.floor(hash2D(i, 81, 6) * 8), y + 6 + Math.floor(hash2D(i, 82, 6) * 6), 1, 1);
            }
        },
        61: (ctx, x, y, s) => drawTool(ctx, x, y, 'pickaxe', '#a8864c', '#7c5e2e'),
        62: (ctx, x, y, s) => drawTool(ctx, x, y, 'pickaxe', '#8a8d90', '#63666a'),
        63: (ctx, x, y, s) => drawTool(ctx, x, y, 'pickaxe', '#51dec7', '#2fa89c'),
        64: (ctx, x, y, s) => drawTool(ctx, x, y, 'axe', '#a8864c', '#7c5e2e'),
        65: (ctx, x, y, s) => drawTool(ctx, x, y, 'axe', '#8a8d90', '#63666a'),
        66: (ctx, x, y, s) => drawTool(ctx, x, y, 'axe', '#51dec7', '#2fa89c'),
        67: (ctx, x, y, s) => drawTool(ctx, x, y, 'shovel', '#a8864c', '#7c5e2e'),
        68: (ctx, x, y, s) => drawTool(ctx, x, y, 'shovel', '#8a8d90', '#63666a'),
        69: (ctx, x, y, s) => drawTool(ctx, x, y, 'shovel', '#51dec7', '#2fa89c'),
        70: (ctx, x, y, s) => drawTool(ctx, x, y, 'sword', '#a8864c', '#7c5e2e'),
        71: (ctx, x, y, s) => drawTool(ctx, x, y, 'sword', '#8a8d90', '#63666a'),
        72: (ctx, x, y, s) => drawTool(ctx, x, y, 'sword', '#51dec7', '#2fa89c'),
        // ---- 物流+控制组（Create-lite L1 链 2）：传送带 73 顶面（箭头指北=贴图上方向）/ 74 带沿侧面 ----
        73: (ctx, x, y, s) => { // 传送带顶面：深灰胶带底 + 纵向防滑纹 + 中央橙色人字箭头（指向北=贴图上方）
            ctx.fillStyle = '#4a4438';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#5a5344';
            for (let i = 1; i < s; i += 3) ctx.fillRect(x + i, y + 1, 1, s - 2); // 纵向防滑纹
            ctx.fillStyle = '#3a352c';
            ctx.fillRect(x, y, s, 1);
            ctx.fillRect(x, y + s - 1, s, 1); // 两端收边
            // 人字箭头：两道斜劈汇成向上（北）的尖
            ctx.fillStyle = '#e8a030';
            ctx.fillRect(x + 7, y + 2, 2, 7); // 箭杆
            ctx.fillRect(x + 7, y + 1, 2, 1);
            ctx.fillRect(x + 4, y + 4, 2, 2);
            ctx.fillRect(x + 3, y + 6, 2, 2); // 左翼
            ctx.fillRect(x + 10, y + 4, 2, 2);
            ctx.fillRect(x + 11, y + 6, 2, 2); // 右翼
            ctx.fillStyle = '#c88420';
            ctx.fillRect(x + 7, y + 9, 2, 3); // 箭杆根
        },
        74: (ctx, x, y, s) => { // 传送带侧面（带沿）：上下金属滚边 + 中段深色胶带
            ctx.fillStyle = '#6a6456';
            ctx.fillRect(x, y, s, 3); // 上滚边
            ctx.fillStyle = '#57503f';
            ctx.fillRect(x, y + 3, s, s - 6); // 胶带侧壁
            ctx.fillStyle = '#3a352c';
            for (let i = 0; i < s; i += 4) ctx.fillRect(x + i, y + 5, 2, s - 9); // 段接缝
            ctx.fillStyle = '#6a6456';
            ctx.fillRect(x, y + s - 3, s, 3); // 下滚边
            ctx.fillStyle = '#8a8474';
            ctx.fillRect(x, y, s, 1); // 上沿高光
        },
        // ---- 物流+控制组（Create-lite L1 链 3）：投料器 75 正面（方形投料口）/ 76 机身侧面 ----
        75: (ctx, x, y, s) => { // 投料器正面：铜木机身底 + 中央深色方形投料口（喷嘴口）+ 四角铆钉
            ctx.fillStyle = '#8a7a5a';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#9a8a68';
            for (let i = 1; i < s; i += 4) ctx.fillRect(x + i, y + 1, 1, s - 2); // 竖向刮痕
            ctx.fillStyle = '#6e6146';
            ctx.fillRect(x, y, s, 1);
            ctx.fillRect(x, y + s - 1, s, 1);
            ctx.fillRect(x, y, 1, s);
            ctx.fillRect(x + s - 1, y, 1, s); // 边框收边
            ctx.fillStyle = '#2c261c'; // 投料口：中央 6×6 深洞
            ctx.fillRect(x + 5, y + 5, 6, 6);
            ctx.fillStyle = '#4a4030';
            ctx.fillRect(x + 5, y + 5, 6, 1);
            ctx.fillRect(x + 5, y + 5, 1, 6); // 洞口内沿阴影
            ctx.fillStyle = '#d8a028'; // 四角铆钉
            ctx.fillRect(x + 2, y + 2, 2, 2);
            ctx.fillRect(x + s - 4, y + 2, 2, 2);
            ctx.fillRect(x + 2, y + s - 4, 2, 2);
            ctx.fillRect(x + s - 4, y + s - 4, 2, 2);
        },
        76: (ctx, x, y, s) => { // 投料器机身侧面：铜木机壳 + 两道横向散热格栅 + 中央接缝
            ctx.fillStyle = '#7e7052';
            ctx.fillRect(x, y, s, s);
            ctx.fillStyle = '#6e6146';
            for (let i = 2; i < s - 2; i += 3) ctx.fillRect(x + 1, y + i, s - 2, 1); // 横向条纹
            ctx.fillStyle = '#4a4030';
            ctx.fillRect(x, y + 3, s, 2); // 上散热格栅
            ctx.fillRect(x, y + s - 5, s, 2); // 下散热格栅
            ctx.fillStyle = '#93846a';
            for (let i = 3; i < s - 3; i += 4) { // 格栅镂空高光
                ctx.fillRect(x + i, y + 3, 2, 2);
                ctx.fillRect(x + i, y + s - 5, 2, 2);
            }
            ctx.fillStyle = '#5a5038';
            ctx.fillRect(x + 7, y, 2, s); // 中央竖向接缝
            ctx.fillStyle = '#8a8474';
            ctx.fillRect(x, y, s, 1); // 顶沿高光
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

    // 动力组全部变体共享物品图标 tile（实际是 3D 轮盘/杆件网格，手模型/物品栏/掉落物走这里的 UV）
    for (let i = 0; i < 3; i++) {
        blockUVs[SHAFT_BASE + i] = blockUVs[SHAFT_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
        blockUVs[COGWHEEL_BASE + i] = blockUVs[COGWHEEL_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
        blockUVs[WATERWHEEL_BASE + i] = blockUVs[WATERWHEEL_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
        blockUVs[CRUSHER_BASE + i] = blockUVs[CRUSHER_ITEM_ID] || blockUVs[BlockTypes.STONE];
    }
    for (let i = 0; i < 6; i++) blockUVs[SAW_BASE + i] = blockUVs[SAW_ITEM_ID] || blockUVs[BlockTypes.STONE];

    // 离合器（Create-lite L1）全部变体共享物品图标 tile：暂复用传动轴木纹——本体是 3D 网格
    // 不走图集，这里的 UV 只喂手模型像素板/物品栏图标/掉落物（专用 tile 由链 2/3 统一补画）
    for (let i = 0; i < CLUTCH_COUNT; i++) blockUVs[CLUTCH_BASE + i] = blockUVs[SHAFT_ITEM_ID] || blockUVs[BlockTypes.PLANKS];

    // 传送带（Create-lite L1 链 2）4 个 dir 变体共享物品图标 tile（本体是按 dir 旋转的 3D 薄板，
    // 顶面箭头 tile 73 由 chunk.js 的 makeTexturedBoxGeo 直接铺 UV，不走这里的 blockUVs）
    for (let i = 0; i < BELT_COUNT; i++) blockUVs[BELT_BASE + i] = blockUVs[BELT_ITEM_ID] || blockUVs[BlockTypes.PLANKS];
    // 投料器 6 变体共享物品图标 tile（实际是 3D 方箱+喷嘴道具，手模型/物品栏/掉落物走这里的 UV）
    for (let i = 0; i < DEPLOYER_COUNT; i++) blockUVs[DEPLOYER_BASE + i] = blockUVs[DEPLOYER_ITEM_ID] || blockUVs[BlockTypes.STONE];

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
