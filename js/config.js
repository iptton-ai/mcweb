// ==================== config.js ====================

// ==================== 常量定义 ====================
export const WORLD_WIDTH = 128;

// 世界宽度（方块数）
export const WORLD_DEPTH = 128;

// 世界深度（方块数）
export const WORLD_HEIGHT = 64;

// 世界高度（方块数）
export const CHUNK_SIZE = 16;

// 区块大小
export const GRAVITY = -28.0;

export const JUMP_VELOCITY = 8.8;

export const WALK_SPEED = 4.5;

export const FLY_SPEED = 10.0;

export const REACH_DISTANCE = 6.0;

export const PLAYER_WIDTH = 0.6;

export const PLAYER_HEIGHT = 1.8;

export const PLAYER_EYE_HEIGHT = 1.62;

export const TICK_RATE = 0.05;

// 50ms per tick
export const MAX_TORCH_LIGHTS = 24;

// 火把动态光源上限
// ---- 刷怪规则（对齐原版 Minecraft）----
export const MAX_ENEMIES = 15;

// 敌对生物容量：原版 cap = 70 × 加载区块/289，本世界 8×8=64 区块 ≈ 15
export const SPAWN_MIN_DIST = 24;

// 最小生成距离：24 格内不刷（防贴脸）
export const SPAWN_MAX_DIST = 128;

// 最大生成距离：超出立即消失
export const LAZY_DIST = 32;

// 懒惰距离：超出冻结 AI，并随机消失
export const DESPAWN_CHANCE = 1 / 800;

// 懒惰区每游戏刻消失概率（原版值）
export const PACK_SPAWN_TRIES = 3;

// 成群生成：首只之外最多再带 3 只
export const SPAWN_ATTEMPTS_PER_TICK = 2;

// 每游戏刻随机尝试的列数
export const TORCH_SPAWN_BLOCK_RADIUS = 6;

// 火把 6 格内不刷（近似原版"亮度≤7才刷"）
// ---- 视角 ----
export const THIRD_PERSON_DIST = 4.5;

// 第三人称相机距离
export const ENEMY_SPEED = 2.6;

export const ENEMY_DAMAGE = 2;

export const ENEMY_ATTACK_RANGE = 1.3;

export const MAX_HEALTH = 20;

// 20 = 10颗心

export const GameModes = { CREATIVE: 'creative', SURVIVAL: 'survival' };

// ==================== 方块类型 ====================
export const BlockTypes = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    WOOD: 4,
    LEAVES: 5,
    SAND: 6,
    WATER: 7,
    BEDROCK: 8,
    BRICK: 9,
    GLASS: 10,
    PLANKS: 11,
    COBBLESTONE: 12,
    GRAVEL: 13,
    SNOW: 14,
    LOG: 15,
    TORCH: 16,
    FLOWER: 17,
    TNT: 18,
};

export const BlockInfo = {
    [BlockTypes.AIR]: { name: '空气', solid: false, transparent: true, color: '#000000' },
    [BlockTypes.GRASS]: { name: '草方块', solid: true, transparent: false, color: '#5a9e3d' },
    [BlockTypes.DIRT]: { name: '泥土', solid: true, transparent: false, color: '#8b5a2b' },
    [BlockTypes.STONE]: { name: '石头', solid: true, transparent: false, color: '#7a7a7a' },
    [BlockTypes.WOOD]: { name: '原木', solid: true, transparent: false, color: '#6b4423' },
    [BlockTypes.LEAVES]: { name: '树叶', solid: true, transparent: true, color: '#3d7a2a' },
    [BlockTypes.SAND]: { name: '沙子', solid: true, transparent: false, color: '#dbc47a' },
    [BlockTypes.WATER]: { name: '水', solid: false, transparent: true, color: '#3a6ea5' },
    [BlockTypes.BEDROCK]: { name: '基岩', solid: true, transparent: false, color: '#3a3a3a' },
    [BlockTypes.BRICK]: { name: '砖块', solid: true, transparent: false, color: '#a0522d' },
    [BlockTypes.GLASS]: { name: '玻璃', solid: true, transparent: true, color: '#c8d8e8' },
    [BlockTypes.PLANKS]: { name: '木板', solid: true, transparent: false, color: '#c8a050' },
    [BlockTypes.COBBLESTONE]: { name: '圆石', solid: true, transparent: false, color: '#6a6a6a' },
    [BlockTypes.GRAVEL]: { name: '沙砾', solid: true, transparent: false, color: '#9a8a7a' },
    [BlockTypes.SNOW]: { name: '雪', solid: true, transparent: false, color: '#f0f0f0' },
    [BlockTypes.LOG]: { name: '树干', solid: true, transparent: false, color: '#5a3a1a' },
    [BlockTypes.TORCH]: { name: '火把', solid: false, transparent: true, customMesh: true, color: '#e8a030' },
    [BlockTypes.FLOWER]: { name: '花', solid: false, transparent: true, customMesh: true, color: '#e04a5a' },
    [BlockTypes.TNT]: { name: 'TNT', solid: true, transparent: false, tnt: true, color: '#c03020' },
};

export const HotbarBlocks = [
    BlockTypes.GRASS,
    BlockTypes.DIRT,
    BlockTypes.STONE,
    BlockTypes.WOOD,
    BlockTypes.LEAVES,
    BlockTypes.SAND,
    BlockTypes.BRICK,
    BlockTypes.GLASS,
    BlockTypes.PLANKS,
    BlockTypes.COBBLESTONE,
    BlockTypes.GRAVEL,
    BlockTypes.SNOW,
    BlockTypes.LOG,
    BlockTypes.BEDROCK,
    BlockTypes.TORCH,
    BlockTypes.FLOWER,
    BlockTypes.TNT,
];
