import { AdventureItems, LADDER_BASE } from './config.js';
import {LifeBlocks,LifeItems} from './config.js';
// 物品来源统一表：背包空库存、材料问号和悬停说明共用，不能把未实现获取链说成可采集。
import {
    BlockInfo, BlockTypes, ItemTypes, RECIPES,
    DUST_ITEM_ID, LAMP_ITEM_ID, PISTON_ITEM_ID, STICKY_PISTON_ITEM_ID, OBSERVER_ITEM_ID,
    WATERWHEEL_ITEM_ID, SHAFT_ITEM_ID, COGWHEEL_ITEM_ID, CRUSHER_ITEM_ID, SAW_ITEM_ID,
    BELT_ITEM_ID, CLUTCH_ITEM_ID, DEPLOYER_ITEM_ID, PULLEY_ITEM_ID, PLATFORM_ITEM_ID,
    KEYPAD_ITEM_ID, MERCHANT_ITEM_ID, HANZI_ORE,
} from './config.js';

// 领取逻辑与来源提示读同一份清单，避免文案宣称赠送实际没有的物品。
export const WORKSHOP_KIT = {
    [BlockTypes.SLIME]: 16, [PISTON_ITEM_ID]: 2, [STICKY_PISTON_ITEM_ID]: 2, [OBSERVER_ITEM_ID]: 2,
    [WATERWHEEL_ITEM_ID]: 2, [SHAFT_ITEM_ID]: 16, [COGWHEEL_ITEM_ID]: 8, [CRUSHER_ITEM_ID]: 2, [SAW_ITEM_ID]: 1,
    [BELT_ITEM_ID]: 16, [CLUTCH_ITEM_ID]: 2, [DEPLOYER_ITEM_ID]: 1, [PULLEY_ITEM_ID]: 2, [PLATFORM_ITEM_ID]: 8,
    [KEYPAD_ITEM_ID]: 3, [DUST_ITEM_ID]: 8, [LAMP_ITEM_ID]: 2, [MERCHANT_ITEM_ID]: 1,
};
const HARVEST_SOURCES = {
    [AdventureItems.SOUVENIR]: '亲自到达新版世界的浅矿洞、旧石塔、林间营地，每处只给一次；按 J 看发现记录',
    [LifeItems.SEEDS]: '挖草地必得 1 种子；也可用 2 泥土筛出 1 种子；成熟小麦返 2 种子。设置 → 生存可领取一次种植包',
    [LifeItems.WHEAT]: '近水耕地播种，四期小麦成熟后右键或挖掘收获；拿在手上可引诱动物',
    [LifeBlocks.SAPLING]: '打树叶必得树苗；也可用原木 + 泥土制作。种在草地或泥土，留五格宽七格高空间',
    [LifeItems.MEMENTO]: '标准生存中答题获得的收藏纪念章，不用于制作食物或矿物',
    [LifeItems.WATER_BUCKET]: '空桶右键水面取水；旧世界无水可在工作台用空桶 + 4 沙 + 2 原木集水',

    [BlockTypes.DIRT]: '挖泥土或草方块获得；草方块挖下后变成泥土',
    [BlockTypes.WOOD]: '砍树获得原木；木斧更快（按住左键，纯键盘按住 Enter）',
    [BlockTypes.LOG]: '砍带深色树干的树获得；木斧更快',
    [BlockTypes.SAND]: '挖浅池岸边或沙漠的沙子获得，也可用粉碎轮把沙砾加工成沙子',
    [BlockTypes.COBBLESTONE]: '用木镐或更好的镐挖石头，掉落圆石',
    [BlockTypes.GRAVEL]: '在山地挖沙砾获得，也可用粉碎轮把圆石加工成沙砾',
    [BlockTypes.SNOW]: '在高处的积雪地面挖取',
    [BlockTypes.IRON_ORE]: '在 y<30 的岩层用石镐或更好的镐挖铁矿石，掉落矿石本身',
    [BlockTypes.WOOL]: '首次生存赠 3 羊毛；喂小麦认领绵羊后用剪刀每次剪 3 羊毛，喂养后两分钟再生',
    [ItemTypes.COAL]: '用木镐挖煤矿获得煤炭，或在熔炉原料格放原木、燃料格放原木或木板烧木炭',
    [ItemTypes.DIAMOND]: '用铁镐或更好的镐挖 y<12 的钻石矿',
    [ItemTypes.APPLE]: '树叶有机会掉苹果；首次生存赠 5 个',
    [ItemTypes.RAW_PORK]: '猪或牛被击败时掉落，可在熔炉烧成熟猪排',
    [ItemTypes.GUNPOWDER]: '击败尚未自爆的苦力怕会掉落火药',
};
const UNCOLLECTABLE_SOURCES = {
    [BlockTypes.GRASS]: '草方块挖下后只掉泥土；完整草方块目前仅创造模式可直接取用',
    [BlockTypes.LEAVES]: '树叶挖碎不会掉树叶方块，必返树苗，也可能掉苹果；完整树叶目前仅创造模式可直接取用',
    [BlockTypes.WATER]: '用空桶对准水面右键取水，再拿水桶右键放水；标准生存不直接拿水方块',
    [BlockTypes.BEDROCK]: '基岩不能挖取，仅创造模式物品栏可直接取用',
    [BlockTypes.COAL_ORE]: '天然煤矿挖下掉煤炭；完整煤矿石方块目前仅创造模式可直接取用',
    [BlockTypes.DIAMOND_ORE]: '天然钻石矿挖下掉钻石；完整钻石矿石方块目前仅创造模式可直接取用',
    [HANZI_ORE]: '挖识字矿石收集生字并获得煤炭；完整识字矿石方块目前仅创造模式可直接取用',
};
export function materialSource(id) {
    if (UNCOLLECTABLE_SOURCES[id]) return UNCOLLECTABLE_SOURCES[id];
    if (HARVEST_SOURCES[id]) return HARVEST_SOURCES[id];
    const recipe = RECIPES.find(r => r.out === id);
    if (recipe?.station==='furnace') return '右键熔炉放入原料和燃料，收起面板后烧制：原料、燃料分开放';
    if (recipe) {
        const station = recipe.station === 'crafting' ? '工作台' : recipe.station === 'furnace' ? '熔炉' : '徒手';
        return `${station}制作：` + Object.entries(recipe.cost).map(([item, n]) => `${BlockInfo[item]?.name}×${n}`).join(' + ');
    }
    if (WORKSHOP_KIT[id]) return '⚙️ 设置 → 🏠 生存：可选的一次性机械实验包；当前没有制作配方';
    return '当前没有普通生存的获取途径；仅创造模式或关卡编辑器可直接取用';
}
