// ==================== state.js ====================

import { GameModes, MAX_HEALTH, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';

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
    },
    gameMode: GameModes.CREATIVE,
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
    viewMode: 0, // 0=第一人称 1=第三人称(背后) 2=第三人称(正面)
};

export function isCreative() {
    return state.gameMode === GameModes.CREATIVE;
}

export function isNight() {
    const dayProgress = (state.time % state.dayLength) / state.dayLength;
    const sunHeight = Math.sin(dayProgress * Math.PI * 2 - Math.PI * 0.5);
    return sunHeight < -0.08;
}
