// ==================== gamelogic 测试工具箱 ====================
// 无头逻辑测试的公共底座：
//   freshWorld()  手搓平地世界（跳过地形生成，快且确定性）+ 初始化红石/动力基线
//   pump(dt, n)   按 main.js 主循环顺序推进逻辑时间（TNT→红石(含活塞)→动力→物品）
//   setB/at/fill  方块读写快捷方式
//   dispatchKey   模拟键盘按键（驱动教学组答题面板，来自 _preload）
//
// ⚠️ 运行方式（hooks 必须先于游戏模块解析注册，只能走 --import 预载；
//    Node v22 的 --test 目录形式会当 ES 模块导入报 ERR_UNSUPPORTED_DIR_IMPORT，必须用 glob）：
//   node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs
import './_preload.mjs';
import { state } from '../../js/state.js';
import { WORLD_WIDTH, WORLD_HEIGHT, WORLD_DEPTH, BlockTypes, GameModes } from '../../js/config.js';
import { getBlock, setBlockSafe, getBlockIndex } from '../../js/world.js';
import { initRedstone, updateRedstoneTick } from '../../js/redstone.js';
import { initKinetic, updateKineticTick } from '../../js/kinetic.js';
import { resetPistons } from '../../js/piston.js';
import { updateTnt } from '../../js/tnt.js';
import { clearItemDrops, updateItemDrops } from '../../js/items.js';
import { initParticles } from '../../js/particles.js';
// textures 走 hooks 后是 assistant-sim 桩（blockUVs 空表）：补 tile 占位，
// 否则 loadGame 尾部的 updateHotbar（js/ui.js:103 读 blockUVs[id].top.x）会炸——
// 那条异常会连带触发 levelRun.exitLevelRun 的 generateWorld 兜底（恢复失效），必须垫平
import { blockUVs } from '../../js/textures.js';

for (let id = 0; id < 256; id++) blockUVs[id] ??= { top: { x: 0, y: 0 } };

export { state, getBlock, setBlockSafe };
export { dispatchKey, __listeners } from './_preload.mjs';

let particlesReady = false;

// 手搓一个「顶部平地」世界：y ∈ [floorY-3, floorY] 四层石头，上方全空气。
// 跳过 generateWorld 的地形/矿脉/树（快 + 零噪声），布线随处可行。
export function freshWorld({ seed = 20260923, floorY = 8, gameMode = GameModes.CREATIVE } = {}) {
    if (!globalThis.__mcwebGameLogicPreloaded) {
        throw new Error('gamelogic: 未检测到 _preload 预载。请用 node --test --import ./tests/gamelogic/_preload.mjs 运行');
    }
    state.worldSeed = seed;
    state.blocks = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT * WORLD_DEPTH);
    for (let x = 0; x < WORLD_WIDTH; x++) {
        for (let z = 0; z < WORLD_DEPTH; z++) {
            for (let y = floorY - 3; y <= floorY; y++) {
                state.blocks[getBlockIndex(x, y, z)] = BlockTypes.STONE;
            }
        }
    }
    // 玩家置于场地角落上方、状态归位（不参与多数逻辑，但压力板/磁吸/生物会读位置）
    const p = state.player;
    p.x = 3.5; p.y = floorY + 1; p.z = 3.5;
    p.vx = p.vy = p.vz = 0;
    p.yaw = 0; p.pitch = 0;
    p.dead = false; p.health = 20; p.onGround = true; p.flying = false;
    p.inWater = false; p.fallStartY = null;
    p.inventory = {}; // 活塞压碎返还直写背包（跨测试残留源），一并归零
    state.gameMode = gameMode;
    // 运行时态清零
    state.torchLights.clear();
    state.enemies.length = 0;
    state.tntEntities.length = 0;
    state.droppedItems.length = 0;
    state.itemDrops.length = 0;
    state.time = 0;
    state.enemySpawnTimer = 0;
    if (!particlesReady) { initParticles(); particlesReady = true; }
    resetPistons();
    initRedstone(); // 清红石边沿基线 + 全图重算（空世界很快）
    initKinetic();
}

// 按 main.js gameLoop 的顺序泵逻辑帧（红石 tick 末尾自带活塞 tick）
export function pump(dt = 0.05, frames = 1) {
    for (let i = 0; i < frames; i++) {
        updateTnt(dt);
        updateRedstoneTick(dt);
        updateKineticTick(dt);
        updateItemDrops(dt);
        state.time += dt;
    }
}

export function setB(x, y, z, id) { setBlockSafe(x, y, z, id); }
export const at = (x, y, z) => getBlock(Math.round(x), Math.round(y), Math.round(z));

export function fillBox(x1, y1, z1, x2, y2, z2, id) {
    for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++)
            for (let z = z1; z <= z2; z++)
                setBlockSafe(x, y, z, id);
}
