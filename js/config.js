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

// ---- 触及距离（照搬原版：创造 5.2 格 / 生存 4.5 格，raycastBlocks 按模式取用）----
export const REACH_CREATIVE = 5.2;

export const REACH_SURVIVAL = 4.5;

// ---- 挖掘节奏（照搬原版，见 js/mining.js）----
export const BREAK_DELAY = 0.3; // 每破坏一块后的强制间隔（原版 6 tick = 0.3s，即挖方块除外）
export const CREATIVE_BREAK_INTERVAL = 0.1; // 创造模式按住连续拆除的节奏（原版即点即碎，限速是为区块重建分摊帧耗）
export const INSTANT_BREAK_SEC = 0.05; // ≤此值视为即挖（原版规则），不受连挖间隔限制
export const MINING_HIT_FX_SEC = 0.25; // 挖掘中撞击音效/粒子/挥动的循环周期（原版体感值）

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
// 存档槽数量：每槽一个独立世界（localStorage key mcweb.save.v1.slotN + 索引 mcweb.save.index）
export const SAVE_SLOTS = 6;

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
    SLIME: 97, // 粘液块（普通实心立方体，ID 排在红石组之后；活塞组的基础组件）
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

// ==================== 有状态方块：红石组（红石粉/红石火把/按钮/压力板/拉杆/红石灯） ====================
// 参考 Minecraft 红石设计原则重做（原「机械组」齿轮已移除，ID 35..82 空间复用）：
//   信号源(15 级) → 红石粉布线(每格 -1 级，0 级断) → 负载(红石灯/门/TNT)。
//   红石火把是反相器：默认亮；挂靠的实心方块被充能则熄灭、解除后复亮（延迟切换，可做时钟）。
//   激活红石粉会充能它脚下与四邻水平的实心方块；拉杆/按钮/压力板充能各自的挂靠/支撑方块。
//   门在信号上升沿开、下降沿关（手动右键不受影响）；TNT 在上升沿点燃（放置为惰性）。
// 参考门的做法把状态直接编码进方块 ID（省去逐格元数据数组），高层逻辑见 js/redstone.js：
//   红石粉 ID = DUST_BASE + lit（亮灭两态；连接形状由 chunk.js 按邻格现算，只放实心方块顶面）
//   红石火把 ID = RTORCH_BASE + facing*2 + lit（facing 同拉杆；贴顶(1)不允许放置）
//   按钮 ID = BUTTON_BASE + facing*2 + pressed（右键按下，BUTTON_PULSE_SEC 秒后自动弹出）
//   压力板 ID = PLATE_BASE + pressed（只放顶面；玩家/怪物脚部格与板同格 = 按下）
//   拉杆 ID = LEVER_BASE + facing*2 + on（右键开关）
//   红石灯 ID = LAMP_BASE + lit（6 邻有激活红石粉或激活源时点亮）
// 共 2+12+12+2+12+2 = 42 个变体（35..62、83..96），63..82 留空。
export const DUST_BASE = 35;
export const DUST_COUNT = 2;
export const RTORCH_BASE = 37;
export const RTORCH_COUNT = 12;
export const BUTTON_BASE = 49;
export const BUTTON_COUNT = 12;
export const PLATE_BASE = 61;
export const PLATE_COUNT = 2;
export const LEVER_BASE = 83;
export const LEVER_COUNT = 12;
export const LAMP_BASE = 95;
export const LAMP_COUNT = 2;
export const DUST_ITEM_ID = DUST_BASE; // 物品栏「红石粉」用熄灭变体代表
export const RTORCH_ITEM_ID = RTORCH_BASE; // 物品栏「红石火把」用贴地·亮 变体代表
export const BUTTON_ITEM_ID = BUTTON_BASE; // 物品栏「按钮」用贴地·弹出 变体代表
export const PLATE_ITEM_ID = PLATE_BASE; // 物品栏「压力板」用抬起 变体代表
export const LEVER_ITEM_ID = LEVER_BASE; // 物品栏「拉杆」用贴地·关 变体代表
export const LAMP_ITEM_ID = LAMP_BASE; // 物品栏「红石灯」用熄灭 变体代表

export const RS_MAX_STRENGTH = 15; // 信号源强度（红石粉每格 -1，0 级断路）
export const RTORCH_DELAY = 0.1; // 红石火把亮灭切换延迟（秒）——反相有节拍，粉绕回挂靠方块即成时钟
export const BUTTON_PULSE_SEC = 1.0; // 按钮按下到自动弹出的秒数

// 红石组 ID 编解码（纯函数，供 chunk.js / interaction.js / redstone.js 共用）
export function dustId(lit) {
    return DUST_BASE + lit;
}

export function isDustId(id) {
    return id >= DUST_BASE && id < DUST_BASE + DUST_COUNT;
}

export function dustLit(id) {
    return (id - DUST_BASE) & 1;
}

export function rtorchId(facing, lit) {
    return RTORCH_BASE + facing * 2 + lit;
}

export function isRTorchId(id) {
    return id >= RTORCH_BASE && id < RTORCH_BASE + RTORCH_COUNT;
}

export function rtorchFacing(id) {
    return (id - RTORCH_BASE) >> 1;
}

export function rtorchLit(id) {
    return (id - RTORCH_BASE) & 1;
}

export function isRTorchLitId(id) {
    return isRTorchId(id) && rtorchLit(id) === 1;
}

export function buttonId(facing, pressed) {
    return BUTTON_BASE + facing * 2 + pressed;
}

export function isButtonId(id) {
    return id >= BUTTON_BASE && id < BUTTON_BASE + BUTTON_COUNT;
}

export function buttonFacing(id) {
    return (id - BUTTON_BASE) >> 1;
}

export function buttonPressed(id) {
    return (id - BUTTON_BASE) & 1;
}

export function plateId(pressed) {
    return PLATE_BASE + pressed;
}

export function isPlateId(id) {
    return id >= PLATE_BASE && id < PLATE_BASE + PLATE_COUNT;
}

export function platePressed(id) {
    return (id - PLATE_BASE) & 1;
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

// 是否红石组任一方块（红石粉/红石火把/按钮/压力板/拉杆/红石灯统称）
export function isRedstoneId(id) {
    return (id >= DUST_BASE && id < DUST_BASE + DUST_COUNT) ||
        (id >= RTORCH_BASE && id < RTORCH_BASE + RTORCH_COUNT) ||
        (id >= BUTTON_BASE && id < BUTTON_BASE + BUTTON_COUNT) ||
        (id >= PLATE_BASE && id < PLATE_BASE + PLATE_COUNT) ||
        isLeverId(id) || isLampId(id);
}

export function isLampLitId(id) {
    return isLampId(id) && lampLit(id) === 1;
}

// 旧版本「机械组齿轮」占据 ID 35..82，该区间已改作红石组：读入旧存档/旧快照时清为空气
// （拉杆/红石灯/门的 ID 与编码未变，不受影响）
export function migrateLegacyGears(u8) {
    for (let i = 0; i < u8.length; i++) {
        if (u8[i] >= DUST_BASE && u8[i] < LEVER_BASE) u8[i] = 0;
    }
}

// 挂靠面法线（facing 编码见上）：0贴地 1贴顶 2北墙(-Z) 3东墙(+X) 4南墙(+Z) 5西墙(-X)。
// config 持有这份纯数据：redstone.js（逻辑）与 chunk.js（网格摆放）共用，避免互相依赖
export const FACING_NORMALS = [
    [0, 1, 0], [0, -1, 0], [0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0],
];

// ==================== 有状态方块：活塞组（活塞/粘性活塞/活塞头/观察者）====================
// 参考 Minecraft Wiki（Piston/BS、Observer/BS），照红石组惯例把状态直接编码进方块 ID：
//   活塞底座 ID = PISTON_BASE / STICKY_PISTON_BASE + facing*2 + extended（各 12 个变体）
//   活塞头   ID = PISTON_HEAD_BASE + facing（6 个；是否粘头由身后底座是否粘性决定，渲染时现查）
//   观察者   ID = OBSERVER_BASE + facing*2 + powered（12 个；正前方方块变化→脉冲信号源）
// facing 复用上方 FACING_NORMALS（0上 1下 2北 3东 4南 5西）。ID 区间避开 63..82 空洞与
// 100..103 工具。高层逻辑（放置/破坏/推动拉动/动作队列/观察者侦测）见 js/piston.js。
// 与原版的简化差异：无准连通性(QC)；推动撞玩家/怪=整体位移 1 格；粘液拉动=连通集合
// 整体移或全不动；伸出态活塞不可被推；粘液块渲染为不透明。
export const PISTON_BASE = 104; // 活塞（普通）
export const STICKY_PISTON_BASE = 116; // 粘性活塞
export const PISTON_HEAD_BASE = 128; // 伸出的活塞头（占据底座前方一格）
export const OBSERVER_BASE = 135; // 观察者
export const PISTON_ITEM_ID = PISTON_BASE; // 物品栏「活塞」用 朝上·收回 变体代表
export const STICKY_PISTON_ITEM_ID = STICKY_PISTON_BASE; // 物品栏「粘性活塞」
export const OBSERVER_ITEM_ID = OBSERVER_BASE; // 物品栏「观察者」

export const PISTON_PUSH_LIMIT = 12; // 推动上限（原版 12 格：超出整个动作失败）
export const PISTON_DELAY = 0.15; // 活塞动作延迟（原版 3 游戏刻；也防飞行机器递归风暴）
export const OBSERVER_PULSE_SEC = 0.2; // 观察者侦测到变化后的脉冲时长（原版 2gt=0.1s，放宽更顺手）

// 活塞组 ID 编解码（纯函数，供 chunk.js / interaction.js / piston.js 共用）
export function pistonId(sticky, facing, extended) {
    return (sticky ? STICKY_PISTON_BASE : PISTON_BASE) + facing * 2 + extended;
}

export function isPistonId(id) {
    return id >= PISTON_BASE && id < STICKY_PISTON_BASE + 12;
}

export function pistonSticky(id) {
    return id >= STICKY_PISTON_BASE;
}

export function pistonFacing(id) {
    return (id - (pistonSticky(id) ? STICKY_PISTON_BASE : PISTON_BASE)) >> 1;
}

export function pistonExtended(id) {
    return (id - (pistonSticky(id) ? STICKY_PISTON_BASE : PISTON_BASE)) & 1;
}

export function pistonHeadId(facing) {
    return PISTON_HEAD_BASE + facing;
}

export function isPistonHeadId(id) {
    return id >= PISTON_HEAD_BASE && id < PISTON_HEAD_BASE + 6;
}

export function observerId(facing, powered) {
    return OBSERVER_BASE + facing * 2 + powered;
}

export function isObserverId(id) {
    return id >= OBSERVER_BASE && id < OBSERVER_BASE + 12;
}

export function observerFacing(id) {
    return (id - OBSERVER_BASE) >> 1;
}

export function observerPowered(id) {
    return (id - OBSERVER_BASE) & 1;
}

// 活塞组物品（放置路由用；活塞头不是物品，无放置入口）
export function isPistonGroupId(id) {
    return isPistonId(id) || isObserverId(id);
}

// ==================== 有状态方块：动力组（传动轴/齿轮/水车/粉碎轮/机械锯）====================
// 参考 Create 模组「旋转动力」的离散版（方案见 docs/create-lite-plan.md 阶段二），与红石组并行的
// 第二条自动化科技线：水车泡水（顶面接触静态水）产出 8 RPM 旋转 + 64 SU 应力容量 →
// 传动轴同轴直线布线（1:1 传速）→ 齿轮垂直轴啮合换向（反转）/分流 → 终端机器加工产出。
// 传动只用 3 轴（区别于红石组的 6 向挂靠面）：AXIS_X=0(东西) AXIS_Y=1(上下) AXIS_Z=2(南北)，
// 轴向/朝向直接编码进方块 ID；转速/转向/应力/机器进度全是派生态——js/kinetic.js 事件触发的
// 全量求解（照 updateRedstoneNetwork 骨架）写进运行时 Map，不占 ID、存档零改动。
//   传动轴 ID = SHAFT_BASE + axis（3 变体）
//   齿轮     ID = COGWHEEL_BASE + axis（3；垂直轴相邻的两齿轮啮合反转，平行轴并排不连接）
//   水车     ID = WATERWHEEL_BASE + axis（3；顶面接触水 = 动力源，多水车不叠 RPM 只叠容量）
//   粉碎轮   ID = CRUSHER_BASE + axis（3；水平相邻两轮同轴配对工作，上方格 = 投料口）
//   机械锯   ID = SAW_BASE + facing(0..5)（朝向 = 被锯方块方向，复用 FACING_NORMALS）
export const SHAFT_BASE = 148;
export const SHAFT_COUNT = 3;
export const COGWHEEL_BASE = 152;
export const COGWHEEL_COUNT = 3;
export const WATERWHEEL_BASE = 156;
export const WATERWHEEL_COUNT = 3;
export const CRUSHER_BASE = 160;
export const CRUSHER_COUNT = 3;
export const SAW_BASE = 164;
export const SAW_COUNT = 6;
export const SHAFT_ITEM_ID = SHAFT_BASE; // 物品栏「传动轴」用 X 轴变体代表
export const COGWHEEL_ITEM_ID = COGWHEEL_BASE;
export const WATERWHEEL_ITEM_ID = WATERWHEEL_BASE;
export const CRUSHER_ITEM_ID = CRUSHER_BASE;
export const SAW_ITEM_ID = SAW_BASE;

// 三轴编码与轴法线表（chunk.js 网格朝向与 kinetic.js 邻接判定共用）
export const AXIS_X = 0; // 东西（±X）
export const AXIS_Y = 1; // 上下（±Y）
export const AXIS_Z = 2; // 南北（±Z）
export const AXIS_NAMES = ['东西', '上下', '南北'];
export const AXIS_DIRS = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// 数值常量（集中此处便于调平；对齐 Create 的直觉而非精确数值）
export const WHEEL_RPM = 8; // 全网转速（多水车不加速，对齐 Create）
export const WHEEL_SU_CAPACITY = 64; // 每台水车的应力容量（SU）
export const CRUSHER_SU_LOAD = 32; // 每只配对粉碎轮的应力负载（单只不成对 = 无功能不计负载）
export const SAW_SU_LOAD = 24; // 每台机械锯的应力负载
export const CRUSH_SEC = 1.2; // 粉碎轮处理一格投料的秒数
export const SAW_SPEED = 6; // 机械锯等效挖掘速度（喂给 hardness×1.5÷速度 公式，≈铁质工具）
export const KINETIC_SPIN_VIS = 2.0; // 旋转视觉放大系数（8 RPM 原速 7.5s/圈偏慢，×2 观感舒适）

// 物品实体（js/items.js）：机器产出的真掉落物，寿命/磁吸/拾取半径
export const ITEM_LIFETIME_SEC = 120;
export const ITEM_PICKUP_DIST = 1.5;
export const ITEM_MAGNET_DIST = 4.0;

// 动力组 ID 编解码（纯函数，供 chunk.js / interaction.js / kinetic.js 共用）
export function shaftId(axis) {
    return SHAFT_BASE + axis;
}

export function isShaftId(id) {
    return id >= SHAFT_BASE && id < SHAFT_BASE + 3;
}

export function shaftAxis(id) {
    return id - SHAFT_BASE;
}

export function cogId(axis) {
    return COGWHEEL_BASE + axis;
}

export function isCogId(id) {
    return id >= COGWHEEL_BASE && id < COGWHEEL_BASE + 3;
}

export function cogAxis(id) {
    return id - COGWHEEL_BASE;
}

export function waterwheelId(axis) {
    return WATERWHEEL_BASE + axis;
}

export function isWaterwheelId(id) {
    return id >= WATERWHEEL_BASE && id < WATERWHEEL_BASE + 3;
}

export function waterwheelAxis(id) {
    return id - WATERWHEEL_BASE;
}

export function crusherId(axis) {
    return CRUSHER_BASE + axis;
}

export function isCrusherId(id) {
    return id >= CRUSHER_BASE && id < CRUSHER_BASE + 3;
}

export function crusherAxis(id) {
    return id - CRUSHER_BASE;
}

export function sawId(facing) {
    return SAW_BASE + facing;
}

export function isSawId(id) {
    return id >= SAW_BASE && id < SAW_BASE + 6;
}

export function sawFacing(id) {
    return id - SAW_BASE;
}

// 是否动力组任一方块（ID 区间 148..169 连续，可直接范围判断）
export function isKineticId(id) {
    return id >= SHAFT_BASE && id < SAW_BASE + 6;
}

// 动力方块的传动轴：轴类方块取编码轴，机械锯取朝向法线所在轴
// （FACING_NORMALS：0/1=±Y→上下轴，2/4=±Z→南北轴，3/5=±X→东西轴）
export function kineticAxisOf(id) {
    if (isSawId(id)) {
        const f = sawFacing(id);
        return f <= 1 ? AXIS_Y : (f === 2 || f === 4) ? AXIS_Z : AXIS_X;
    }
    if (isShaftId(id)) return shaftAxis(id);
    if (isCogId(id)) return cogAxis(id);
    if (isWaterwheelId(id)) return waterwheelAxis(id);
    return crusherAxis(id);
}

// 动力组物品（破坏返还/放置路由用）
export function kineticItemId(id) {
    if (isShaftId(id)) return SHAFT_ITEM_ID;
    if (isCogId(id)) return COGWHEEL_ITEM_ID;
    if (isWaterwheelId(id)) return WATERWHEEL_ITEM_ID;
    if (isCrusherId(id)) return CRUSHER_ITEM_ID;
    return SAW_ITEM_ID;
}

// 粉碎配方表（纯数据：投料口里的方块 → 产出物品与数量；四级粉碎链是核心乐趣）
// 不在表内的方块投不进配对粉碎轮（放置时 toast 提示，见 interaction.js）
export const KINETIC_RECIPES = {
    [BlockTypes.STONE]: { item: BlockTypes.COBBLESTONE, count: 1 }, // 石头 → 圆石
    [BlockTypes.COBBLESTONE]: { item: BlockTypes.GRAVEL, count: 1 }, // 圆石 → 沙砾
    [BlockTypes.GRAVEL]: { item: BlockTypes.SAND, count: 1 }, // 沙砾 → 沙子
    [BlockTypes.GLASS]: { item: BlockTypes.SAND, count: 1 }, // 玻璃 → 沙子
    [BlockTypes.WOOD]: { item: BlockTypes.PLANKS, count: 4 }, // 原木 → 木板×4
    [BlockTypes.LOG]: { item: BlockTypes.PLANKS, count: 4 }, // 树干 → 木板×4
};

// ==================== 方块挖掘属性（照搬原版 hardness/工具类别/掉落）====================
// hardness：原版硬度值；-1 = 不可破坏（基岩）。tool：原版「最佳工具」类别（镐/斧/锹，徒手=无）。
// needsTool：true = 必须用对应类别工具挖才有掉落（原版石质方块的规则，如石头手挖 7.5s 还不掉落）。
// drop：生存模式破坏掉落的物品 ID；缺省 = 掉自身；null = 无掉落（玻璃/树叶，原版无精准采集时不掉落）。
// 破坏耗时 = 硬度 × (可采集 ? 1.5 : 5) ÷ 工具速度，水中/悬空各再 ×5（js/mining.js）。
export const BlockInfo = {
    [BlockTypes.AIR]: { name: '空气', solid: false, transparent: true, color: '#000000' },
    [BlockTypes.GRASS]: { name: '草方块', solid: true, transparent: false, color: '#5a9e3d', hardness: 0.6, tool: 'shovel', drop: BlockTypes.DIRT }, // 原版：草方块掉泥土
    [BlockTypes.DIRT]: { name: '泥土', solid: true, transparent: false, color: '#8b5a2b', hardness: 0.5, tool: 'shovel' },
    [BlockTypes.STONE]: { name: '石头', solid: true, transparent: false, color: '#7a7a7a', hardness: 1.5, tool: 'pickaxe', needsTool: true, drop: BlockTypes.COBBLESTONE }, // 原版：石头掉圆石，徒手挖无掉落
    [BlockTypes.WOOD]: { name: '原木', solid: true, transparent: false, color: '#6b4423', hardness: 2.0, tool: 'axe' },
    [BlockTypes.LEAVES]: { name: '树叶', solid: true, transparent: true, color: '#3d7a2a', hardness: 0.2, drop: null }, // 原版：树叶不掉落（树苗概率忽略）
    [BlockTypes.SAND]: { name: '沙子', solid: true, transparent: false, color: '#dbc47a', hardness: 0.5, tool: 'shovel' },
    [BlockTypes.WATER]: { name: '水', solid: false, transparent: true, color: '#3a6ea5' },
    [BlockTypes.BEDROCK]: { name: '基岩', solid: true, transparent: false, color: '#3a3a3a', hardness: -1 }, // 不可破坏
    [BlockTypes.BRICK]: { name: '砖块', solid: true, transparent: false, color: '#a0522d', hardness: 2.0, tool: 'pickaxe', needsTool: true },
    [BlockTypes.GLASS]: { name: '玻璃', solid: true, transparent: true, color: '#c8d8e8', hardness: 0.3, drop: null }, // 原版：玻璃碎了不掉落
    [BlockTypes.PLANKS]: { name: '木板', solid: true, transparent: false, color: '#c8a050', hardness: 2.0, tool: 'axe' },
    [BlockTypes.COBBLESTONE]: { name: '圆石', solid: true, transparent: false, color: '#6a6a6a', hardness: 2.0, tool: 'pickaxe', needsTool: true },
    [BlockTypes.GRAVEL]: { name: '沙砾', solid: true, transparent: false, color: '#9a8a7a', hardness: 0.6, tool: 'shovel' },
    [BlockTypes.SNOW]: { name: '雪', solid: true, transparent: false, color: '#f0f0f0', hardness: 0.5, tool: 'shovel' },
    [BlockTypes.LOG]: { name: '树干', solid: true, transparent: false, color: '#5a3a1a', hardness: 2.0, tool: 'axe' },
    [BlockTypes.TORCH]: { name: '火把', solid: false, transparent: true, customMesh: true, color: '#e8a030', hardness: 0 },
    [BlockTypes.FLOWER]: { name: '花', solid: false, transparent: true, customMesh: true, color: '#e04a5a', hardness: 0 },
    [BlockTypes.TNT]: { name: 'TNT', solid: true, transparent: false, tnt: true, color: '#c03020', hardness: 0 },
    [BlockTypes.SLIME]: { name: '粘液块', solid: true, transparent: false, color: '#6ec84e', hardness: 0 }, // 原版粘液块硬度 0（空手秒挖）；可被活塞推拉并拖动附着方块
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
                hardness: 3.0, // 原版橡木门硬度 3（斧头快挖；破坏返还走 breakDoorAt 特例）
                tool: 'axe',
            };
        }
    }
}

// ==================== 工具（P2：照搬原版工具策略，铁质一档）====================
// 原版工具分级（木2/石4/铁6/钻8/金12）依赖合成系统做出层级推进，本作没有合成台，
// 因此只引入铁质一档（速度×6，正好是原版中位），生存开局直接配备（见 ui.js setGameMode）。
// 工具是「物品」不是方块：ID 从 100 起、绝不写进 state.blocks，只出现在物品栏/HotbarBlocks
// （故本块必须定义在 HotbarBlocks 之前）。
// tool.class 命中方块的 BlockInfo.tool 才有速度加成；攻击数值照搬原版铁质武器
// （剑 6 伤害·冷却 0.6s；徒手 1 伤害·冷却 0.25s；创造模式一击必杀）。
export const TOOL_BASE = 100;

export const ToolTypes = {
    PICKAXE: 100, // 铁镐：石质方块（石头/圆石/砖）快速挖掘 + 采集掉落
    AXE: 101,     // 铁斧：木质方块（原木/木板/门）快速挖掘
    SHOVEL: 102,  // 铁锹：泥土/沙/沙砾/雪快速挖掘
    SWORD: 103,   // 铁剑：不加速挖掘，攻击 6 伤害
};

export function isToolId(id) {
    return id >= TOOL_BASE && id <= TOOL_BASE + 3;
}

BlockInfo[ToolTypes.PICKAXE] = { name: '铁镐', color: '#d8d8d8', tool: { class: 'pickaxe', speed: 6, damage: 4, attackCd: 0.9 } };
BlockInfo[ToolTypes.AXE] = { name: '铁斧', color: '#d8d8d8', tool: { class: 'axe', speed: 6, damage: 5, attackCd: 0.9 } };
BlockInfo[ToolTypes.SHOVEL] = { name: '铁锹', color: '#d8d8d8', tool: { class: 'shovel', speed: 6, damage: 3, attackCd: 0.9 } };
BlockInfo[ToolTypes.SWORD] = { name: '铁剑', color: '#d8d8d8', tool: { class: 'sword', speed: 1.5, damage: 6, attackCd: 0.6 } };

// 徒手攻击（原版拳头：1 伤害，攻击速度 4/s = 冷却 0.25s）
export const FIST_ATTACK = { damage: 1, attackCd: 0.25 };

// 怪物血量对齐原版僵尸（20 = 10 颗心）
export const ENEMY_HEALTH = 20;

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
    DUST_ITEM_ID, // 红石粉：铺在顶面布线，信号每格 -1 级（见 js/redstone.js）
    RTORCH_ITEM_ID, // 红石火把：默认亮的信号源；挂靠方块被充能则熄灭（反相器/时钟）
    BUTTON_ITEM_ID, // 按钮：右键按下 1 秒后自动弹出（脉冲信号源）
    PLATE_ITEM_ID, // 压力板：玩家/怪物踩住时是信号源（自动门/陷阱）
    LEVER_ITEM_ID, // 拉杆：右键开关，稳态信号源
    LAMP_ITEM_ID, // 红石灯：6 邻有信号点亮
    BlockTypes.SLIME, // 粘液块：被活塞推拉时拖动附着的方块（飞行机器的基础）
    PISTON_ITEM_ID, // 活塞：信号上升沿伸出、下降沿收回，可推动最多 12 格（见 js/piston.js）
    STICKY_PISTON_ITEM_ID, // 粘性活塞：收回时把头前方块拉回一格
    OBSERVER_ITEM_ID, // 观察者：正前方方块变化时发出一次脉冲（活塞时钟/飞行机器）
    WATERWHEEL_ITEM_ID, // 水车：顶面接触水 = 8 RPM 动力源（+64 应力容量），见 js/kinetic.js
    SHAFT_ITEM_ID, // 传动轴：同轴直线布线（1:1 传速）
    COGWHEEL_ITEM_ID, // 齿轮：垂直轴相邻啮合 = 换向反转/分流；平行并排不连接
    CRUSHER_ITEM_ID, // 粉碎轮：水平相邻两轮同轴配对，上方格投料碾碎（石头→圆石→沙砾→沙）
    SAW_ITEM_ID, // 机械锯：朝向格自动锯切（原木→木板×4）
    BlockTypes.WATER, // 水：静态水方块（无流动模拟），给水车供水/造水景（只能被方块覆盖，不可挖）
    ToolTypes.PICKAXE, // 铁镐：石质方块快速挖掘 + 采集掉落（物品，不能放置）
    ToolTypes.AXE, // 铁斧：木质方块快速挖掘
    ToolTypes.SHOVEL, // 铁锹：泥土/沙快速挖掘
    ToolTypes.SWORD, // 铁剑：攻击 6 伤害（原版铁剑数值）
];

// 红石组变体批量注册（思路同上门）：贴面/贴地元件都是 customMesh 道具（非固体不挡路），
// 红石灯是实心立方体，亮的变体在 chunk.js 里挂点光源
const MOUNT_ORIENT = ['贴地', '贴顶', '贴北墙', '贴东墙', '贴南墙', '贴西墙'];
for (let lit = 0; lit < 2; lit++) {
    BlockInfo[dustId(lit)] = {
        name: `红石粉${lit ? '（亮）' : ''}`,
        solid: false,
        transparent: true,
        customMesh: true,
        redstone: true,
        color: lit ? '#ff3820' : '#5a1010',
    };
}
for (let facing = 0; facing < 6; facing++) {
    for (let lit = 0; lit < 2; lit++) {
        BlockInfo[rtorchId(facing, lit)] = {
            name: `红石火把（${MOUNT_ORIENT[facing]}·${lit ? '亮' : '灭'}）`,
            solid: false,
            transparent: true,
            customMesh: true,
            redstone: true,
            color: lit ? '#ff4020' : '#701812',
        };
    }
}
for (let facing = 0; facing < 6; facing++) {
    for (let pressed = 0; pressed < 2; pressed++) {
        BlockInfo[buttonId(facing, pressed)] = {
            name: `按钮（${MOUNT_ORIENT[facing]}${pressed ? '·按下' : ''}）`,
            solid: false,
            transparent: true,
            customMesh: true,
            redstone: true,
            color: '#8a8a8a',
        };
    }
}
for (let pressed = 0; pressed < 2; pressed++) {
    BlockInfo[plateId(pressed)] = {
        name: `压力板${pressed ? '（踩下）' : ''}`,
        solid: false,
        transparent: true,
        customMesh: true,
        redstone: true,
        color: '#8a8a8a',
    };
}
for (let facing = 0; facing < 6; facing++) {
    for (let on = 0; on < 2; on++) {
        BlockInfo[leverId(facing, on)] = {
            name: `拉杆（${MOUNT_ORIENT[facing]}·${on ? '开' : '关'}）`,
            solid: false,
            transparent: true,
            customMesh: true,
            redstone: true,
            color: '#8a8a8a',
        };
    }
}
BlockInfo[LAMP_ITEM_ID] = { name: '红石灯', solid: true, transparent: false, redstone: true, color: '#6a4a2a', hardness: 0.3 };
BlockInfo[lampId(1)] = { name: '红石灯（亮）', solid: true, transparent: false, redstone: true, color: '#ffd870', hardness: 0.3 };

// ==================== 活塞组变体批量注册 ====================
// 活塞底座/活塞头/观察者是 customMesh 道具（伸出的部分不满一格，需独立网格），
// transparent 使邻方面不被剔除（伸出态/活塞头周围能看到后面的面）。
// 破坏返还走 piston.js 的 breakPistonGroupAt 特例（打头=拆整只活塞）。
const PISTON_ORIENT = ['朝上', '朝下', '朝北', '朝东', '朝南', '朝西'];
for (let sticky = 0; sticky < 2; sticky++) {
    for (let facing = 0; facing < 6; facing++) {
        for (let extended = 0; extended < 2; extended++) {
            BlockInfo[pistonId(!!sticky, facing, extended)] = {
                name: `${sticky ? '粘性活塞' : '活塞'}（${PISTON_ORIENT[facing]}${extended ? '·伸出' : ''}）`,
                solid: true,
                transparent: true,
                customMesh: true,
                piston: true,
                color: '#b08850',
                hardness: 1.5, // 原版活塞硬度 1.5
                tool: 'pickaxe',
            };
        }
    }
}
for (let facing = 0; facing < 6; facing++) {
    BlockInfo[pistonHeadId(facing)] = {
        name: `活塞头（${PISTON_ORIENT[facing]}）`,
        solid: true,
        transparent: true,
        customMesh: true,
        piston: true,
        color: '#c8a468',
        hardness: 1.5,
        tool: 'pickaxe',
        drop: null, // 打掉活塞头=拆整只活塞（返还走 breakPistonGroupAt），无独立掉落
    };
}
for (let facing = 0; facing < 6; facing++) {
    for (let powered = 0; powered < 2; powered++) {
        BlockInfo[observerId(facing, powered)] = {
            name: `观察者（${PISTON_ORIENT[facing]}${powered ? '·脉冲中' : ''}）`,
            solid: true,
            transparent: true,
            customMesh: true,
            color: '#6a6a6a',
            hardness: 3.0, // 原版观察者硬度 3，需镐采集
            tool: 'pickaxe',
            needsTool: true,
        };
    }
}

// ==================== 动力组变体批量注册 ====================
// 全部是 customMesh 道具（3D 轮盘/杆件网格，chunk.js 构建、kinetic.js 每帧旋转动画）；
// solid 参与物理碰撞（轴/齿轮能站上去），transparent 使邻方面不被剔除（网格不满格）。
// 破坏返还走 interaction.js 的动力组分支（掉物品 = kineticItemId，网络重算见 js/kinetic.js）。
for (let axis = 0; axis < 3; axis++) {
    BlockInfo[shaftId(axis)] = {
        name: `传动轴（${AXIS_NAMES[axis]}向）`,
        solid: true, transparent: true, customMesh: true, kinetic: true,
        color: '#9c7a48', hardness: 0.8, tool: 'axe',
    };
    BlockInfo[cogId(axis)] = {
        name: `齿轮（${AXIS_NAMES[axis]}向）`,
        solid: true, transparent: true, customMesh: true, kinetic: true,
        color: '#7a5a30', hardness: 1.0, tool: 'axe',
    };
    BlockInfo[waterwheelId(axis)] = {
        name: `水车（${AXIS_NAMES[axis]}向）`,
        solid: true, transparent: true, customMesh: true, kinetic: true,
        color: '#8a6a3a', hardness: 2.0, tool: 'axe',
    };
    BlockInfo[crusherId(axis)] = {
        name: `粉碎轮（${AXIS_NAMES[axis]}向）`,
        solid: true, transparent: true, customMesh: true, kinetic: true,
        color: '#8a8a8a', hardness: 2.0, tool: 'pickaxe',
    };
}
for (let facing = 0; facing < 6; facing++) {
    BlockInfo[sawId(facing)] = {
        name: `机械锯（${PISTON_ORIENT[facing]}）`,
        solid: true, transparent: true, customMesh: true, kinetic: true,
        color: '#b8bcc4', hardness: 1.5, tool: 'pickaxe',
    };
}
