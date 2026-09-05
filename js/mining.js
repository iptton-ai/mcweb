// ==================== mining.js ====================
// 挖掘系统（照搬原版 Minecraft 机制，防误触的核心）：
//   · 生存模式按住左键「蓄力」挖掘：方块有硬度，进度走完才破坏；松手或准星移开即恢复（裂纹消失）
//   · 破坏耗时 = 硬度 × (可采集 ? 1.5 : 5) ÷ 工具速度；水中/悬空各再 ×5
//   · needsTool 方块（石头/圆石/砖）徒手能挖开但无掉落——原版逼你做工具的进度曲线
//   · 每破坏一块后强制间隔 BREAK_DELAY（原版 6 tick），即挖方块（硬度 0）除外
//   · 创造模式即点即碎（原版预期），按住连续拆除限速分摊区块重建
//   · 准星上是怪物则优先挥击（攻击冷却与伤害照搬原版：徒手 1/0.25s，铁剑 6/0.6s）
// 挖掘进度可视化：目标方块表面叠加 destroy_stage 0..9 裂纹贴图（textures.getCrackTextures）。
// 手部反馈（挥动动画）在 js/viewmodel.js，本模块只发 swing 事件。

import * as THREE from 'three';
import { BREAK_DELAY, CREATIVE_BREAK_INTERVAL, FIST_ATTACK, INSTANT_BREAK_SEC, MINING_HIT_FX_SEC, BlockInfo, BlockTypes, HotbarBlocks, PLAYER_EYE_HEIGHT } from './config.js';
import { isCreative, state } from './state.js';
import { scene } from './engine.js';
import { getBlock } from './world.js';
import { breakBlockAt, raycastBlocks, tryAttackEnemy } from './interaction.js';
import { getCrackTextures } from './textures.js';
import { playHitSound } from './audio.js';
import { swingViewmodel } from './viewmodel.js';
import { showTooltip, updateHotbar } from './ui.js';

// 当前手持的工具（BlockInfo[id].tool，非工具返回 null；selectedSlot 指向 HotbarBlocks）
export function getHeldTool() {
    const info = BlockInfo[HotbarBlocks[state.player.selectedSlot]];
    return info?.tool || null;
}

// 当前手持工具的剩余耐久（0..maxDurability；非工具/全新返回 null = 无需显示）
export function getHeldDurability() {
    const id = HotbarBlocks[state.player.selectedSlot];
    const max = BlockInfo[id]?.maxDurability;
    if (!max) return null;
    return { left: max - (state.player.toolWear[id] || 0), max };
}

// 方块是否可「采集」（破坏有掉落）：needsTool 方块必须持对应类别工具且档位够高
// （原版 harvestLevels：铁矿要石镐+、钻石要铁镐+，工具档位见 config.js TOOL_TIER_*）
function canHarvest(blockId) {
    const info = BlockInfo[blockId];
    if (!info || !info.needsTool) return true;
    const tool = getHeldTool();
    if (!tool || tool.class !== info.tool) return false;
    return !info.minTier || (tool.tier || 0) >= info.minTier;
}

// 手持工具磨损 1 点（破坏方块/攻击生物后调用，仅生存）：
// 耐久按「该类型当前在用的这一把」计（toolWear = 已用次数），用坏扣 1 把并重置
export function damageHeldTool() {
    if (isCreative()) return;
    const id = HotbarBlocks[state.player.selectedSlot];
    const max = BlockInfo[id]?.maxDurability;
    if (!max) return;
    const wear = (state.player.toolWear[id] || 0) + 1;
    if (wear >= max) {
        delete state.player.toolWear[id];
        state.player.inventory[id] = Math.max(0, (state.player.inventory[id] || 0) - 1);
        showTooltip(`⚠️ ${BlockInfo[id].name}已经损坏`);
    } else {
        state.player.toolWear[id] = wear;
    }
    updateHotbar();
}

// 破坏一格方块需要的秒数（公式照搬原版，见文件头注释）。Infinity = 不可破坏，0 = 即挖。
export function getBreakSeconds(blockId) {
    const info = BlockInfo[blockId] || {};
    if (info.hardness < 0) return Infinity; // 基岩
    if (isCreative()) return 0; // 创造：即点即碎
    const hardness = info.hardness ?? 0;
    if (hardness <= 0) return 0; // 火把/花/TNT/红石元件等即挖方块
    const tool = getHeldTool();
    const speed = tool && tool.class === info.tool && tool.speed > 1 ? tool.speed : 1;
    let seconds = hardness * (canHarvest(blockId) ? 1.5 : 5) / speed;
    // 水中（头部没入）与悬空惩罚各 ×5（原版 speedMultiplier /= 5）
    const p = state.player;
    const head = getBlock(Math.floor(p.x), Math.floor(p.y + PLAYER_EYE_HEIGHT), Math.floor(p.z));
    if (head === BlockTypes.WATER) seconds *= 5;
    if (!p.onGround) seconds *= 5;
    return seconds;
}

// ==================== 挖掘状态 ====================
const mining = {
    x: null, // 当前目标格（准星移开/换目标时进度清零，照搬原版）
    y: null,
    z: null,
    progress: 0, // 0..1
    delay: 0,    // 破坏后的间隔（生存 = 连挖间隔；创造 = 连续拆除限速）
    hitFx: 0,    // 挖掘中撞击音效/挥动的循环计时
};

// 裂纹 overlay：比方块略大的立方体贴裂纹贴图，叠在目标方块表面
let crackMesh = null;

function ensureCrackMesh() {
    if (crackMesh) return crackMesh;
    const cracks = getCrackTextures();
    crackMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.004, 1.004, 1.004),
        new THREE.MeshBasicMaterial({
            map: cracks[0],
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
        }),
    );
    crackMesh.visible = false;
    crackMesh.renderOrder = 1; // 在方块表面之后、高亮框之前
    scene.add(crackMesh);
    return crackMesh;
}

function hideCrack() {
    if (crackMesh) crackMesh.visible = false;
}

function resetMining() {
    mining.x = mining.y = mining.z = null;
    mining.progress = 0;
    mining.hitFx = 0;
    hideCrack();
}

// 左键按下瞬间（input.js mousedown 调用）：先挥击，再开始挖掘。
// 创造模式与即挖方块（硬度 0）立即破坏；其余进入按住蓄力（updateMining 逐帧累积）。
export function miningPress() {
    swingViewmodel();
    if (tryAttackEnemy()) return; // 准星上是怪物：这一击是攻击，不是挖掘
    if (mining.delay > 0) return;
    const hit = raycastBlocks();
    if (!hit) return; // 打空气：只挥手
    const seconds = getBreakSeconds(hit.block);
    if (seconds === Infinity) return; // 基岩：纹丝不动
    if (seconds <= INSTANT_BREAK_SEC) {
        breakBlockAt(hit);
        // 即挖方块不受 0.3s 连挖间隔限制（原版规则），但仍限速到每游戏刻一块（20/s），
        // 避免按住扫射时每帧重建区块网格；创造维持拆除限速
        mining.delay = isCreative() ? CREATIVE_BREAK_INTERVAL : 0.05;
        return;
    }
    // 常规方块：登记目标开始蓄力
    mining.x = hit.x;
    mining.y = hit.y;
    mining.z = hit.z;
    mining.progress = 0;
    mining.hitFx = MINING_HIT_FX_SEC; // 下一帧立刻给一次撞击反馈
}

// 每帧驱动（main.js gameLoop 调用；holding = 左键按住且处于可交互状态）
export function updateMining(dt, holding) {
    mining.delay = Math.max(0, mining.delay - dt);
    if (!holding) {
        if (mining.x !== null) resetMining(); // 松手：进度作废，方块恢复（原版行为）
        return;
    }
    // 按住攻击键：准星扫过/停在人身上持续挥击（冷却由武器 attackCd 决定；
    // 冷却中也不隔着怪挖它身后的方块——原版对怪挥刀就是攻击意图）
    if (tryAttackEnemy()) {
        resetMining();
        return;
    }
    if (mining.delay > 0) return; // 间隔/限速中：不累积进度
    const hit = raycastBlocks();
    if (!hit) {
        if (mining.x !== null) resetMining();
        return;
    }
    const seconds = getBreakSeconds(hit.block);
    if (seconds === Infinity) {
        resetMining(); // 基岩
        return;
    }
    // 即挖方块（硬度 0）：破坏不受 0.3s 间隔限制，限速到每游戏刻一块（20/s，照原版）
    if (seconds <= INSTANT_BREAK_SEC) {
        breakBlockAt(hit);
        swingViewmodel();
        mining.delay = isCreative() ? CREATIVE_BREAK_INTERVAL : 0.05;
        return;
    }
    // 换目标：进度清零（照搬原版：准星移到别的方块，裂纹不带走）
    if (hit.x !== mining.x || hit.y !== mining.y || hit.z !== mining.z) {
        mining.x = hit.x;
        mining.y = hit.y;
        mining.z = hit.z;
        mining.progress = 0;
        mining.hitFx = MINING_HIT_FX_SEC;
    }
    mining.progress += dt / seconds;
    // 挖掘中的挥动/撞击声（原版边挖边「咚咚」+ 循环挥手）
    mining.hitFx += dt;
    if (mining.hitFx >= MINING_HIT_FX_SEC) {
        mining.hitFx = 0;
        swingViewmodel();
        playHitSound();
    }
    if (mining.progress >= 1) {
        breakBlockAt({ ...hit }); // 目标已破坏；hit 对象随后会被 reset 作废，复制一份防串
        resetMining();
        mining.delay = BREAK_DELAY; // 破坏后强制间隔（原版 6 tick）
        return;
    }
    // 裂纹进度 overlay：阶段 = floor(progress × 10)，0..9
    const mesh = ensureCrackMesh();
    const stage = Math.min(9, Math.floor(mining.progress * 10));
    if (mesh.material.map !== getCrackTextures()[stage]) {
        mesh.material.map = getCrackTextures()[stage];
        mesh.material.needsUpdate = true;
    }
    mesh.position.set(mining.x + 0.5, mining.y + 0.5, mining.z + 0.5);
    mesh.visible = true;
}

// 挖掘状态快照（E2E / 调试用）
export function getMiningState() {
    return { ...mining };
}
