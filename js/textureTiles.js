import { CRANK_ITEM_ID, LARGE_COG_ITEM_ID, REVERSER_ITEM_ID } from './config.js';
import { AdventureItems, LADDER_BASE } from './config.js';
import {LifeBlocks,LifeItems} from './config.js';
// ==================== textureTiles.js ====================
// 纹理图集 tile 分配表（纯数据，Node 可 import）：textures.js 的 tiles 数组与
// atlasSize 常量下沉于此——textures.js 只消费这张表；知识库/系统提示词的
// 「图集尺寸 / 空闲 tile 区间」文案从这里动态生成（改分配表自动同步，不会漂移，
// 杜绝旧文案「atlasSize=8 / 空闲 45..63」误导新增方块覆盖已占用 tile 的事故）。
// 只 import config.js（无 three/DOM 依赖），tools/test_assistant_knowledge.mjs 可直连对账。
// 新增贴图：往 TEXTURE_TILES 追加条目并同步 textures.js 的 drawFunctions；
// 空闲 tile 号用 freeTileRanges() 查，别手写区间。

import {
    BELT_ITEM_ID,
    BlockTypes, BED_BASE,
    BUTTON_ITEM_ID,
    COGWHEEL_ITEM_ID,
    CRUSHER_ITEM_ID,
    DEPLOYER_ITEM_ID,
    DOOR_ITEM_ID,
    DUST_ITEM_ID,
    FLAG_BASE,
    HANZI_ORE_ITEM_ID,
    ItemTypes,
    KEYPAD_BASE,
    LAMP_BASE,
    LEVER_ITEM_ID,
    MERCHANT_ITEM_ID,
    OBSERVER_ITEM_ID,
    PEN_ID,
    PISTON_ITEM_ID,
    PLATE_ITEM_ID,
    PLATFORM_ITEM_ID,
    RTORCH_ITEM_ID,
    SAW_ITEM_ID,
    SHAFT_ITEM_ID,
    STARLIGHT_BASE,
    STICKY_PISTON_ITEM_ID,
    ToolTypes,
    WATERWHEEL_ITEM_ID,
} from './config.js';

// 图集边长（每行 tile 数）：2026-09-05 从 8×8 扩到 16×16（256 tile）。
// 全部 UV 计算动态读它；扩容会把所有 tile 索引整体换行平移，慎动。
export const atlasSize = 16;

// 与 textures.js generateAllTextures 的消费口径一致：top/side/bottom = 三面所用 tile
// 索引，name 供 tileMap/blockUVs 与 TILE_OVERRIDES 定位。改这里 = 改游戏贴图分配。
export const TEXTURE_TILES = [
    { type: CRANK_ITEM_ID, top:115, side:115, bottom:115, name:'crank' },
    { type: LARGE_COG_ITEM_ID, top:116, side:116, bottom:116, name:'large_cog' },
    { type: REVERSER_ITEM_ID, top:117, side:117, bottom:117, name:'reverser' },
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
    // ---- 电梯组（Create-lite L2）：电梯平台 tile 81（铁框格栅板，普通立方体三面同图；滑轮为 3D 纯色道具照离合器惯例不占 tile） ----
    { type: PLATFORM_ITEM_ID, top: 81, side: 81, bottom: 81, name: 'platform' },
    // ---- 教学组（Edu M1）：答题机 tile 77 锁定面（绿屏键盘）/ 78 已解锁面（金屏✓）/ 79 背面顶面（铜盖板） ----
    { type: KEYPAD_BASE, top: 79, side: 77, bottom: 79, name: 'keypad_locked' },
    { type: KEYPAD_BASE + 1, top: 79, side: 78, bottom: 79, name: 'keypad_solved' },
    // ---- 教学组（Edu M2）：英语商人 tile 82 正面（条纹雨棚货摊）/ 识字矿石 tile 83（金纹矿石） ----
    { type: MERCHANT_ITEM_ID, top: 84, side: 82, bottom: 84, name: 'merchant' },
    { type: HANZI_ORE_ITEM_ID, top: 83, side: 83, bottom: 83, name: 'hanzi_ore' },
    // ---- 关卡工坊（2026-09-15 P0）：旗面 tile 85..87（起点绿/检查点蓝黄/终点红白格）、
    //      星辉门 tile 88..89（锁定紫金暗心 / 开启框内亮星）、出题笔图标 tile 90（紫杆铅笔）。
    //      旗组与星辉门各变体在 tiles 里各自占一条，blockUVs 由烘焙循环逐 ID 自动生成；
    //      旗子本体是 3D 道具网格（chunk.js 的旗杆铺 planks / 旗面铺 flag_* tile）
    { type: FLAG_BASE, top: 85, side: 85, bottom: 85, name: 'flag_start' },
    { type: FLAG_BASE + 1, top: 86, side: 86, bottom: 86, name: 'flag_checkpoint' },
    { type: FLAG_BASE + 2, top: 87, side: 87, bottom: 87, name: 'flag_goal' },
    { type: STARLIGHT_BASE, top: 88, side: 88, bottom: 88, name: 'starlight_locked' },
    { type: STARLIGHT_BASE + 1, top: 89, side: 89, bottom: 89, name: 'starlight_open' },
    { type: PEN_ID, top: 90, side: 90, bottom: 90, name: 'pen_item' },
    { type: BED_BASE, top: 91, side: 91, bottom: 12, name: 'bed_foot' },
    { type: BED_BASE+4, top: 92, side: 91, bottom: 12, name: 'bed_head' },
];

for(const [i,id]of [LifeBlocks.CHEST,LifeBlocks.FARMLAND,244,245,246,247,LifeBlocks.SAPLING,LifeBlocks.FENCE,LifeBlocks.GATE,LifeBlocks.GATE_OPEN,...Object.values(LifeItems)].entries())TEXTURE_TILES.push({type:id,top:93+i,side:93+i,bottom:93+i,name:'life_'+id});

for (let f=0;f<4;f++) TEXTURE_TILES.push({type:LADDER_BASE+f,top:111,side:111,bottom:111,name:'adventure_ladder'});
for(const [i,id] of Object.values(AdventureItems).entries()) TEXTURE_TILES.push({type:id,top:112+i,side:112+i,bottom:112+i,name:'adventure_'+id});

// 图集里不走方块 ID 的「孤儿 tile」：门上半（door_upper 21，门板裁取/TILE_OVERRIDES 用）
// 与活塞内面（piston_inner 37，活塞头背面专用）——textures.js 单独注册进 tileMap，
// 不在 TEXTURE_TILES 里但同样画进了图集，必须计入已占用，否则新方块会盖掉它们。
const EXTRA_OCCUPIED_TILES = [21, 37];

// 已占用 tile 号集合（TEXTURE_TILES 三面并集 + 孤儿 tile）。每次调用新建，纯函数无副作用。
export function occupiedTiles() {
    const s = new Set(EXTRA_OCCUPIED_TILES);
    for (const t of TEXTURE_TILES) {
        s.add(t.top);
        s.add(t.side);
        s.add(t.bottom);
    }
    return s;
}

// 连续空闲区间（[[起, 止], …] 升序，含端点）：知识库/系统提示词的「空闲 tile」文案
// 从这里渲染（tools/test_assistant_knowledge.mjs 按同一口径对账）。
export function freeTileRanges() {
    const occupied = occupiedTiles();
    const total = atlasSize * atlasSize;
    const ranges = [];
    let start = null;
    for (let i = 0; i < total; i++) {
        if (occupied.has(i)) { start = null; continue; }
        if (start === null) start = i;
        const next = i + 1;
        if (next === total || occupied.has(next)) {
            ranges.push([start, i]);
            start = null;
        }
    }
    return ranges;
}
