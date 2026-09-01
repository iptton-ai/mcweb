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

// ---- 摄像头模式（js/cameraRig.js：自由摄像头 + 建造跟拍）----
export const CAM_FOV = 75; // 与 engine.js 的相机视场角保持一致（跟拍高度按它反推）
export const FREE_CAM_BASE_SPEED = FLY_SPEED * 2.5; // 自由摄像头基础速度，滚轮可调倍速
export const FREE_CAM_SPEED_MIN = 0.25;
export const FREE_CAM_SPEED_MAX = 8;
export const BUILD_CAM_MARGIN = 8; // 跟拍画面四周预留余量（格）
export const BUILD_CAM_MIN_HEIGHT = 16; // 跟拍相机最低高度（格）
export const BUILD_CAM_DONE_DELAY = 2.5; // 建造完成后跟拍停留秒数，随后自动停录并回玩家视角

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
export const THIRD_PERSON_LIFT = 0.7;

// 第三人称相机抬升高度（越过头顶，准星不被人物头部遮挡）
export const THIRD_PERSON_FOCUS = 3.5;

// 第三人称相机注视点与眼睛的距离（视线方向上前方的焦点）
export const ENEMY_SPEED = 2.6;

export const ENEMY_DAMAGE = 2;

export const ENEMY_ATTACK_RANGE = 1.3;

export const MAX_HEALTH = 20;

// 20 = 10颗心

// ---- 施工队列（AI 建造渐进放置，便于录制延时摄影；见 js/buildQueue.js）----
// 速度档位：每秒放置的方块数，Infinity = 一次性放完（网格重建仍分帧）
export const BUILD_SPEED_LEVELS = [
    { label: '延时', bps: 20 },
    { label: '慢速', bps: 80 },
    { label: '中速', bps: 300 },
    { label: '快速', bps: 1200 },
    { label: '极速', bps: 6000 },
    { label: '瞬间', bps: Infinity },
];

// 默认速度档：极速（日常建造接近即时，又不会像瞬间档那样集中重建）
export const BUILD_DEFAULT_SPEED_IDX = 4;

// 每帧最多重建的区块网格数：把大量网格重建分摊到多帧，避免建造瞬间掉帧
export const BUILD_REBUILDS_PER_FRAME = 4;

// ---- 存档（见 js/saveGame.js）----
// 自动存档间隔（秒）；页面隐藏/关闭时也会兜底存一次
export const SAVE_AUTOSAVE_SEC = 30;

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

// ==================== 有状态方块：门 ====================
// 参考 Minecraft Wiki（Door/BS）：一扇门占上下两格，方块状态有
// half（下/上）、facing（放置时玩家水平朝向）、open（开/关）、hinge（铰链侧）。
// 本作把状态直接编码进方块 ID（省去逐格元数据数组），并简化为固定左铰链：
//   ID = DOOR_BASE + half*8 + open*4 + facing
//   facing：0=北(-Z) 1=东(+X) 2=南(+Z) 3=西(-X)，共 16 个变体（19..34）。
// 关门时门板贴在 facing 反侧的格边（原版规则：朝东的门关着占格子西侧），
// 开门时绕左铰链转 90°，贴到相邻格边。高层逻辑（放置/开关/破坏）见 js/door.js。
export const DOOR_BASE = 19;
export const DOOR_COUNT = 16;
export const DOOR_THICKNESS = 3 / 16; // 原版门板厚度：3/16 格
export const DOOR_ITEM_ID = DOOR_BASE; // 物品栏中的「橡木门」用下半关门北向变体代表

// 门 ID 编解码（纯函数，供 chunk.js / interaction.js / door.js 共用）
export function doorId(half, open, facing) {
    return DOOR_BASE + half * 8 + open * 4 + facing;
}

export function isDoorId(id) {
    return id >= DOOR_BASE && id < DOOR_BASE + DOOR_COUNT;
}

export function doorHalf(id) {
    return (id - DOOR_BASE) >> 3 & 1;
}

export function doorOpen(id) {
    return (id - DOOR_BASE) >> 2 & 1;
}

export function doorFacing(id) {
    return (id - DOOR_BASE) & 3;
}

// ==================== 有状态方块：机械组（齿轮/拉杆/红石灯） ====================
// 参考门的做法把状态直接编码进方块 ID（省去逐格元数据数组），高层逻辑见 js/machinery.js。
//   齿轮 ID = GEAR_BASE + facing*8 + powered*4 + jam*2 + manual
//     facing：0=贴地 1=贴顶 2=贴北墙(-Z) 3=贴东墙(+X) 4=贴南墙(+Z) 5=贴西墙(-X)，
//             记录的是挂靠面法线方向（放置时由所点击的面决定，背面必须有实心支撑）
//     powered：被电路供能（开着的拉杆 / 相邻转动齿轮链）——派生位，由 machinery.js 重算
//     manual：玩家右键手动开启——持久位（随方块 ID 自动存档）
//     jam：卡死——派生位。相邻齿轮必须反向咬合；两个齿轮面对面共轴（齿对齿顶死）
//           会锁死整个连通传动组，卡死的齿轮不转、轴心变红
//     齿轮实际转动 = (powered || manual) && !jam，转向（±1）由 machinery.js 运行时算
//   拉杆 ID = LEVER_BASE + facing*2 + on（右键开关，开=给 6 邻供能）
//   红石灯 ID = LAMP_BASE + lit（被相邻开着的拉杆或转动齿轮点亮，亮时发光）
// 共 48+12+2 = 62 个变体（35..96），齿轮复刻自 Minecraft 早期开发中被砍掉的 Gear 方块。
export const GEAR_BASE = 35;
export const GEAR_COUNT = 48;
export const LEVER_BASE = 83;
export const LEVER_COUNT = 12;
export const LAMP_BASE = 95;
export const LAMP_COUNT = 2;
export const GEAR_ITEM_ID = GEAR_BASE; // 物品栏「齿轮」用贴地·停转 变体代表
export const LEVER_ITEM_ID = LEVER_BASE; // 物品栏「拉杆」用贴地·关 变体代表
export const LAMP_ITEM_ID = LAMP_BASE; // 物品栏「红石灯」用熄灭 变体代表
export const GEAR_SPIN_SPEED = 0.8; // 齿轮转速（圈/秒）

// 机械 ID 编解码（纯函数，供 chunk.js / interaction.js / machinery.js 共用）
export function gearId(facing, powered, jam, manual) {
    return GEAR_BASE + facing * 8 + powered * 4 + jam * 2 + manual;
}

export function isGearId(id) {
    return id >= GEAR_BASE && id < GEAR_BASE + GEAR_COUNT;
}

export function gearFacing(id) {
    return (id - GEAR_BASE) >> 3;
}

export function gearPowered(id) {
    return (id - GEAR_BASE) >> 2 & 1;
}

export function gearJammed(id) {
    return (id - GEAR_BASE) >> 1 & 1;
}

export function gearManual(id) {
    return (id - GEAR_BASE) & 1;
}

export function leverId(facing, on) {
    return LEVER_BASE + facing * 2 + on;
}

export function isLeverId(id) {
    return id >= LEVER_BASE && id < LEVER_BASE + LEVER_COUNT;
}

export function leverFacing(id) {
    return (id - LEVER_BASE) >> 1;
}

export function leverOn(id) {
    return (id - LEVER_BASE) & 1;
}

export function lampId(lit) {
    return LAMP_BASE + lit;
}

export function isLampId(id) {
    return id >= LAMP_BASE && id < LAMP_BASE + LAMP_COUNT;
}

export function lampLit(id) {
    return (id - LAMP_BASE) & 1;
}

// 是否机械组任一方块（齿轮/拉杆/红石灯统称）
export function isMachineryId(id) {
    return isGearId(id) || isLeverId(id) || isLampId(id);
}

export function isLampLitId(id) {
    return isLampId(id) && lampLit(id) === 1;
}

// 挂靠面法线（facing 编码见上）：0贴地 1贴顶 2北墙(-Z) 3东墙(+X) 4南墙(+Z) 5西墙(-X)。
// config 持有这份纯数据：machinery.js（逻辑）与 chunk.js（网格摆放）共用，避免互相依赖
export const FACING_NORMALS = [
    [0, 1, 0], [0, -1, 0], [0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0],
];

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

// 门变体批量注册：solid 随开合变化（关门挡路、开门可通行，近似原版碰撞），
// transparent 使邻方面不被剔除，customMesh 走火把/花同款道具网格渲染路径
const DOOR_SUFFIX = [['N', '北'], ['E', '东'], ['S', '南'], ['W', '西']];
for (let half = 0; half < 2; half++) {
    for (let open = 0; open < 2; open++) {
        for (let facing = 0; facing < 4; facing++) {
            const id = doorId(half, open, facing);
            BlockTypes[`DOOR_${half === 0 ? 'LOWER' : 'UPPER'}_${open === 0 ? 'CLOSED' : 'OPEN'}_${DOOR_SUFFIX[facing][0]}`] = id;
            BlockInfo[id] = {
                name: `橡木门${half === 1 ? '（上半）' : ''}${open === 1 ? '（开）' : ''}`,
                solid: open === 0,
                transparent: true,
                customMesh: true,
                door: true,
                color: '#b89040',
            };
        }
    }
}

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
    DOOR_ITEM_ID, // 橡木门：有状态方块，放置时生成上下两格（见 js/door.js）
    GEAR_ITEM_ID, // 齿轮：有状态方块，右键手动转/停（见 js/machinery.js）
    LEVER_ITEM_ID, // 拉杆：右键开关，给相邻齿轮/红石灯供能
    LAMP_ITEM_ID, // 红石灯：被拉杆/转动齿轮点亮
];

// 机械变体批量注册（思路同上门）：齿轮/拉杆是贴墙道具（customMesh，非固体不挡路），
// 红石灯是实心立方体，亮的变体在 chunk.js 里挂点光源
const GEAR_ORIENT = ['贴地', '贴顶', '贴北墙', '贴东墙', '贴南墙', '贴西墙'];
for (let facing = 0; facing < 6; facing++) {
    for (let powered = 0; powered < 2; powered++) {
        for (let jam = 0; jam < 2; jam++) {
            for (let manual = 0; manual < 2; manual++) {
                const id = gearId(facing, powered, jam, manual);
                BlockInfo[id] = {
                    name: `齿轮（${GEAR_ORIENT[facing]}·${jam ? '卡死' : powered || manual ? '转' : '停'}）`,
                    solid: false,
                    transparent: true,
                    customMesh: true,
                    machinery: true,
                    color: jam ? '#c05040' : '#9a7a3a',
                };
            }
        }
    }
}
for (let facing = 0; facing < 6; facing++) {
    for (let on = 0; on < 2; on++) {
        BlockInfo[leverId(facing, on)] = {
            name: `拉杆（${GEAR_ORIENT[facing]}·${on ? '开' : '关'}）`,
            solid: false,
            transparent: true,
            customMesh: true,
            machinery: true,
            color: '#8a8a8a',
        };
    }
}
BlockInfo[LAMP_ITEM_ID] = { name: '红石灯', solid: true, transparent: false, machinery: true, color: '#6a4a2a' };
BlockInfo[lampId(1)] = { name: '红石灯（亮）', solid: true, transparent: false, machinery: true, color: '#ffd870' };
