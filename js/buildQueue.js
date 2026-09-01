// ==================== buildQueue.js ====================
// 施工队列：把 AI 助手的大批量方块操作拆成逐帧渐进应用。
// 一来建造过程可见、可调速度/暂停，方便录制延时摄影；
// 二来网格重建按每帧预算分摊（BUILD_REBUILDS_PER_FRAME），建造时不再卡顿。
// 助手的 place_blocks / clear_area / run_build_script 经 enqueueBuildOps 入队；
// 游戏主循环每帧调用 updateBuild(dt)。速度/暂停状态挂在 state 上（HUD 与 [ ] P 键共用）。

import {
    BUILD_REBUILDS_PER_FRAME,
    BUILD_SPEED_LEVELS,
    CHUNK_SIZE,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
} from './config.js';
import { state } from './state.js';
import { isSolid, rebuildChunk } from './chunk.js';
import { getBlock, setBlockSafe } from './world.js';
import { updateRedstoneNetwork } from './redstone.js';
import { updateKineticNetwork } from './kinetic.js';

const CX_COUNT = Math.ceil(WORLD_WIDTH / CHUNK_SIZE);
const CZ_COUNT = Math.ceil(WORLD_DEPTH / CHUNK_SIZE);

// job = { label, ops: [[x,y,z,t],…], total, cursor, applied, skipped[], startedAt, resolve, bounds }
// ops 中 t=0（空气）表示清除；调用方负责边界与方块 ID 校验，玩家重叠在逐格应用时再判
let jobQueue = [];
let activeJob = null;
let budgetCarry = 0;                       // 速度积分的小数余额（bps*dt 累加，按整格扣除）
const dirtyChunks = new Set();             // 已写入但网格未重建的区块 key（跨帧分摊重建）
let finishedJob = null;                    // 刚完成的任务，供 HUD 短暂显示结果
let finishedAt = 0;

// 入队时一次性算出任务的操作范围（建造跟拍相机按它取景），避免每帧遍历大 ops
function computeBounds(ops) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [x, y, z] of ops) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
}

function currentLevel() {
    return BUILD_SPEED_LEVELS[state.buildSpeedIdx] || BUILD_SPEED_LEVELS[BUILD_SPEED_LEVELS.length - 1];
}

// 标记受影响区块（含边界邻块）；网格由 drainDirtyChunks 按帧预算统一重建
function markDirty(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    dirtyChunks.add(cx + ',' + cz);
    if (x % CHUNK_SIZE === 0 && cx > 0) dirtyChunks.add((cx - 1) + ',' + cz);
    if (x % CHUNK_SIZE === CHUNK_SIZE - 1 && cx < CX_COUNT - 1) dirtyChunks.add((cx + 1) + ',' + cz);
    if (z % CHUNK_SIZE === 0 && cz > 0) dirtyChunks.add(cx + ',' + (cz - 1));
    if (z % CHUNK_SIZE === CHUNK_SIZE - 1 && cz < CZ_COUNT - 1) dirtyChunks.add(cx + ',' + (cz + 1));
}

// 实心方块不放进玩家身体（与原 tools.js 同规则，但改为应用时逐格判断：
// 渐进施工期间玩家可能走动，入队时判定会过期）
function overlapsPlayer(x, y, z, t) {
    if (!isSolid(t)) return false;
    const p = state.player;
    const hw = 0.45;
    return x + 1 > p.x - hw && x < p.x + hw &&
        y + 1 > p.y && y < p.y + 1.9 &&
        z + 1 > p.z - hw && z < p.z + hw;
}

// 入队一批方块操作，返回的 Promise 在全部应用完成后 resolve：
// { label, total, applied, skipped[], 秒 }
export function enqueueBuildOps(label, ops) {
    return new Promise((resolve) => {
        if (ops.length === 0) {
            resolve({ label, total: 0, applied: 0, skipped: [], 秒: 0 });
            return;
        }
        jobQueue.push({ label, ops, total: ops.length, cursor: 0, applied: 0, skipped: [], startedAt: 0, resolve, bounds: computeBounds(ops) });
    });
}

// 每帧驱动：应用方块（受速度档/暂停控制）→ 按预算重建脏区块网格
export function updateBuild(dt) {
    drainDirtyChunks();

    if (state.buildPaused) return;
    let job = activeJob;
    if (!job) {
        if (jobQueue.length === 0) return;
        job = activeJob = jobQueue.shift();
        job.startedAt = performance.now();
        budgetCarry = 0;
    }

    const bps = currentLevel().bps;
    const remaining = job.ops.length - job.cursor;
    let n = bps === Infinity ? remaining : Math.min(Math.floor(budgetCarry + bps * dt), remaining);
    if (bps === Infinity) {
        budgetCarry = 0;
    } else {
        budgetCarry = Math.min(budgetCarry + bps * dt - n, 1);
    }
    while (n-- > 0) {
        const [x, y, z, t] = job.ops[job.cursor++];
        if (getBlock(x, y, z) === t) continue; // 已是目标方块，无需写入与重建
        if (overlapsPlayer(x, y, z, t)) {
            job.skipped.push(`与玩家重叠:${x},${y},${z}`);
            continue;
        }
        setBlockSafe(x, y, z, t);
        markDirty(x, z);
        job.applied++;
    }

    if (job.cursor >= job.ops.length) {
        activeJob = null;
        finishedJob = job;
        finishedAt = performance.now();
        // 施工可能放置/拆除红石元件与门、TNT：完成后重算一遍电路（灯亮、门开合、TNT 引爆）
        updateRedstoneNetwork();
        // 动力方块同理：施工可能增删轴/齿轮/水车，完成后重算动力拓扑
        updateKineticNetwork();
        job.resolve({
            label: job.label,
            total: job.total,
            applied: job.applied,
            skipped: job.skipped,
            秒: +((finishedAt - job.startedAt) / 1000).toFixed(1),
        });
    }
}

// 每帧最多重建 BUILD_REBUILDS_PER_FRAME 个区块；方块数据已就位，网格晚几帧出现无感知
function drainDirtyChunks() {
    let budget = BUILD_REBUILDS_PER_FRAME;
    for (const key of dirtyChunks) {
        if (budget <= 0) break;
        dirtyChunks.delete(key);
        const [cx, cz] = key.split(',').map(Number);
        rebuildChunk(cx, cz);
        budget--;
    }
}

// ---------- HUD / 工具共用的状态与控制 ----------

// 当前任务进度（HUD 每帧轮询 + set_build_speed 返回）
export function getBuildStatus() {
    const job = activeJob || jobQueue[0] || null;
    const lv = currentLevel();
    return {
        active: !!job,
        paused: state.buildPaused,
        label: job?.label || finishedJob?.label || '',
        total: job?.total || finishedJob?.total || 0,
        applied: job ? job.cursor : finishedJob?.applied || 0,
        speedIdx: state.buildSpeedIdx,
        speedLabel: lv.label,
        bps: lv.bps === Infinity ? '∞' : lv.bps,
    };
}

export function speedText() {
    const lv = currentLevel();
    return lv.bps === Infinity ? `${lv.label}（∞）` : `${lv.label}（${lv.bps} 格/秒）`;
}

export function setBuildSpeedIdx(idx) {
    state.buildSpeedIdx = Math.max(0, Math.min(BUILD_SPEED_LEVELS.length - 1, idx));
}

// 每秒格数 → 最接近的档位（对数距离），供 set_build_speed 工具用
export function setBuildSpeedByBps(bps) {
    let best = state.buildSpeedIdx;
    let bestD = Infinity;
    BUILD_SPEED_LEVELS.forEach((lv, i) => {
        if (lv.bps === bps) { best = i; bestD = 0; return; }
        if (lv.bps === Infinity || !(bps > 0)) return;
        const d = Math.abs(Math.log(bps / lv.bps));
        if (d < bestD) { bestD = d; best = i; }
    });
    setBuildSpeedIdx(best);
    return currentLevel();
}

export function adjustBuildSpeed(delta) {
    setBuildSpeedIdx(state.buildSpeedIdx + delta);
}

export function toggleBuildPaused() {
    state.buildPaused = !state.buildPaused;
    return state.buildPaused;
}

// HUD 判断「刚完成」用于延迟隐藏进度条
export function lastFinishedAgeMs() {
    return finishedJob ? performance.now() - finishedAt : Infinity;
}

// 当前施工焦点（正在/即将放置的方块坐标），供「前往施工现场」传送定位；无任务时返回 null。
// 刚完成的任务（HUD 停留展示期）焦点取最后一个操作，📍 按钮仍可用。
export function getBuildFocus() {
    const job = activeJob || jobQueue[0] || finishedJob || null;
    if (!job || job.ops.length === 0) return null;
    const [x, y, z] = job.ops[Math.min(job.cursor, job.ops.length - 1)];
    return { x, y, z, label: job.label };
}

// 全部待应用任务的操作范围（建造跟拍相机取景用）；没有任务时返回 null。
// 只含未完成任务：刚完成的任务不算，跟拍收尾靠 cameraRig 自己缓存的最后一次 bounds。
export function getBuildBounds() {
    let b = null;
    for (const job of [activeJob, ...jobQueue]) {
        if (!job) continue;
        if (!b) {
            b = { ...job.bounds };
            continue;
        }
        const o = job.bounds;
        b.minX = Math.min(b.minX, o.minX);
        b.minY = Math.min(b.minY, o.minY);
        b.minZ = Math.min(b.minZ, o.minZ);
        b.maxX = Math.max(b.maxX, o.maxX);
        b.maxY = Math.max(b.maxY, o.maxY);
        b.maxZ = Math.max(b.maxZ, o.maxZ);
    }
    return b;
}
