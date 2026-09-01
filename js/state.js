// ==================== state.js ====================

import { BUILD_DEFAULT_SPEED_IDX, GameModes, MAX_HEALTH, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';

// ==================== 游戏状态 ====================
export const state = {
    blocks: null, // Uint8Array
    chunks: new Map(), // 区块渲染缓存
    chunkMeshes: new Map(),
    player: {
        x: WORLD_WIDTH / 2,
        y: WORLD_HEIGHT,
        z: WORLD_DEPTH / 2,
        vx: 0,
        vy: 0,
        vz: 0,
        yaw: 0,
        pitch: 0,
        onGround: false,
        flying: false,
        selectedSlot: 0,
        inventoryOpen: false,
        mouseLocked: false,
        health: MAX_HEALTH,
        dead: false,
        attackCooldown: 0,
        invulnTimer: 0,
        inventory: {}, // 生存模式物品计数：blockType -> 数量（创造模式不使用）
    },
    gameMode: GameModes.CREATIVE,
    saveSlot: 0, // 当前游玩的存档槽位（0..SAVE_SLOTS-1，读写均指向该槽，见 js/saveGame.js）
    enemies: [],
    torchLights: new Map(), // "x,y,z" -> PointLight
    droppedItems: [],
    tntEntities: [],
    time: 0, // 游戏时间(秒)
    dayLength: 600, // 一天的长度（秒）
    fps: 60,
    fpsCounter: 0,
    fpsTimer: 0,
    blockTarget: null,
    chunkUpdates: [],
    particles: [],
    sunAngle: 0,
    spawn: { x: WORLD_WIDTH / 2, y: 0, z: WORLD_DEPTH / 2 },
    enemySpawnTimer: 0, // 刷怪游戏刻累积计时器
    viewMode: 0, // 0=第一人称 1=第三人称(背后)
    camMode: 'player', // 摄像头模式（js/cameraRig.js）：'player'=跟随玩家 / 'free'=自由摄像头 / 'build'=建造跟拍
    freeCam: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, // 自由摄像头的位姿（进入时从玩家相机初始化）
    camSpeed: 1, // 自由摄像头速度倍率（滚轮调节）
    assistantOpen: false, // AI 助手会话面板是否打开（由 uiModal.js 状态机维护的镜像字段）
    buildSpeedIdx: BUILD_DEFAULT_SPEED_IDX, // 施工速度档位（BUILD_SPEED_LEVELS 下标，[ ] 键可调）
    buildPaused: false, // 施工暂停（录制时可暂停调整机位）
};

export function isCreative() {
    return state.gameMode === GameModes.CREATIVE;
}

export function isNight() {
    const dayProgress = (state.time % state.dayLength) / state.dayLength;
    const sunHeight = Math.sin(dayProgress * Math.PI * 2 - Math.PI * 0.5);
    return sunHeight < -0.08;
}
