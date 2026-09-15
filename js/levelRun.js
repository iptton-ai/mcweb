// ==================== levelRun.js ====================
// 关卡运行时（关卡工坊批次 W / A2 独占文件，2026-09-15）。
// 接口契约：docs/edu-workshop-impl-contract.md §3.2（唯一接口事实源）；
// 运行时设计：docs/edu-level-workshop-plan.md §2.3 + §8（进关落盘 → 清队列 → 嵌世界 → 恢复）。
//
// 职责：把关卡卡（mcweb.level.v1）嵌入临时世界并驱动一局闯关——
//   · enterLevel：当前世界强制落盘 → 清 AI 施工队列 → state.blocks 清零 + 铺 y=0 基岩 →
//     levelWorkshop.embedLevelToWorld 嵌卡 → 重建网格 → 重置红石/动力/实体 → 玩家置出生点 →
//     强制 SURVIVAL + 时间锁正午 → setState('playing')
//   · tickLevelRun：每帧计时 / 起点检查点终点旗踩踏 / 掉界模拟死亡 / timeLimit 超时失败结算
//   · finishRun：踩终点结算（星级 + localStorage 最佳成绩 mcweb.levels.v1 + 结算浮层）
//   · exitLevelRun：关卡录像收尾 → 恢复 time/gameMode → loadGame 读回原世界
//
// Node 可测性铁律：静态 import 只许 config/state；其余浏览器模块（uiModal/saveGame/buildQueue/
// chunk/redstone/kinetic/items/entities/tnt/particles/eduRewards/recording/levelWorkshop——多由
// 并行代理同步编写）一律动态 import() + 可选链调用，缺失/加载失败静默跳过，绝不让浏览器专用
// 逻辑中断主流程。纯逻辑（星级/记账/踩踏/结算）抽成可导出函数供 tools/test_level_run.mjs 直测。

import {
    BlockTypes,
    CHUNK_SIZE,
    GameModes,
    MAX_HEALTH,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
} from './config.js';
import { state } from './state.js';

// ---- 常量 ----

// 嵌入偏移：契约 §2 冻结值（= levelWorkshop.LEVEL_EMBED_OFFSET）。仅作 levelWorkshop 模块
// 不可用（Node 自测 / 加载失败）时的兜底换算；浏览器路径优先走 levelWorkshop 的换算函数。
const EMBED_OFFSET = { x: 80, y: 4, z: 80 };

const LEVEL_CARD_FORMAT = 'mcweb.level.v1'; // 卡片格式（契约 §2，只增不改）

// 最佳成绩 localStorage key（契约 §3.2：{best:{[cardHash]:{stars,timeSec,deaths,plays}}}）
const BEST_KEY = 'mcweb.levels.v1';

// 踩踏判定阈值（契约 §3.2：水平距块中心 <1.2 且 y 差 <1.5）
const STEP_RADIUS = 1.2;
const STEP_Y_TOLERANCE = 1.5;

// ---- 动态 import 注册表（浏览器专用模块全部走这里）----
// 模块加载失败（Node 环境 / 并行代理尚未落地）记为 null，调用点全部可选链。
const MOD_PATHS = {
    levelWorkshop: './levelWorkshop.js', // A1：坐标换算 / 嵌世界 / 卡存取
    uiModal: './uiModal.js',             // setState / openResultState（B2 落地 result 态）
    saveGame: './saveGame.js',           // saveGame / loadGame（B2 加 levelRun 防线）
    world: './world.js',                 // generateWorld（G3 P2#7：读档失败的干净世界兜底）
    buildQueue: './buildQueue.js',       // clearBuildQueue（幽灵建筑防线）
    chunk: './chunk.js',                 // rebuildChunk
    redstone: './redstone.js',           // initRedstone
    kinetic: './kinetic.js',             // initKinetic
    items: './items.js',                 // clearItemDrops
    entities: './entities.js',           // clearAllEnemies（B2 补）/ killEnemySilent 兜底
    tnt: './tnt.js',                     // clear 导出 B2 会补；没有就跳过
    particles: './particles.js',         // 同上
    eduRewards: './eduRewards.js',       // recordLevelPlay（A3 落地）
    recording: './recording.js',         // isLevelOwnedRecording / stopRecording（B4 落地）
};

const MOD_CACHE = new Map(); // name -> 模块对象 | null（未加载/加载失败）
const MOD_PROMISES = new Map(); // name -> Promise<模块|null>

function modPromise(name) {
    if (!MOD_PROMISES.has(name)) {
        MOD_PROMISES.set(name, import(MOD_PATHS[name]).then((m) => {
            MOD_CACHE.set(name, m);
            return m;
        }).catch(() => {
            // Node 环境（three/DOM 缺失）或模块尚未落地：静默降级，可选链跳过
            MOD_CACHE.set(name, null);
            return null;
        }));
    }
    return MOD_PROMISES.get(name);
}

// 同步读缓存：模块加载完成后可用；未加载返回 null（调用点必须可选链）
function mod(name) {
    return MOD_CACHE.get(name) ?? null;
}

// 模块加载即预热全部动态依赖（浏览器里首帧前基本就绪；Node 里各自失败为 null）
for (const name of Object.keys(MOD_PATHS)) modPromise(name);

// ---- levelWorkshop 坐标换算（惰性优先，兜底为契约冻结偏移；浏览器路径行为一致）----

function toLocalPos(x, y, z) {
    const lw = mod('levelWorkshop');
    if (lw?.worldToLocal) return lw.worldToLocal(x, y, z);
    return { x: x - EMBED_OFFSET.x, y: y - EMBED_OFFSET.y, z: z - EMBED_OFFSET.z };
}

function toWorldPos(x, y, z) {
    const lw = mod('levelWorkshop');
    if (lw?.localToWorld) return lw.localToWorld(x, y, z);
    return { x: x + EMBED_OFFSET.x, y: y + EMBED_OFFSET.y, z: z + EMBED_OFFSET.z };
}

// 掉界判定（levelWorkshop.isOutOfRunArea 惰性；兜底按契约 §3.1：y<1 或水平超出 region±2）
function outOfRunArea(x, y, z) {
    const lw = mod('levelWorkshop');
    if (lw?.isOutOfRunArea) return !!lw.isOutOfRunArea(x, y, z);
    const r = state.levelRun?.card?.region;
    if (!r) return false;
    return y < 1 ||
        x < r.x0 - 2 || x >= r.x0 + r.w + 2 ||
        z < r.z0 - 2 || z >= r.z0 + r.d + 2;
}

// ---- 基础查询（契约 §3.2）----

export function isLevelRunActive() {
    return !!state.levelRun;
}

export function getLevelRun() {
    return state.levelRun || null;
}

// 重生点 = 最近激活检查点 | 起点（块坐标；玩家落点 +0.5/+1 由调用方换算，见 playerLife.respawn）
export function getRespawnPos() {
    const run = state.levelRun;
    if (!run) return null;
    return run.respawn || run.spawn || null;
}

// ==================== 进关 ====================

// enterLevel(cardOrId)：卡对象直用；字符串 id 走 levelWorkshop.getLevelCard。
// 返回运行时对象；失败返回 null（任何模块缺失都不得抛错中断）。
export async function enterLevel(cardOrId) {
    const prevRun = state.levelRun || null;
    const alreadyActive = !!prevRun; // 关卡中重入 = 重试式重嵌（不落盘、沿用 restore 暂存）

    // 1) 解析关卡卡
    let card = cardOrId;
    let cardId = null;
    if (typeof cardOrId === 'string') {
        cardId = cardOrId;
        const lw = await modPromise('levelWorkshop');
        card = lw?.getLevelCard ? await lw.getLevelCard(cardOrId) : null;
    }
    if (!card || typeof card !== 'object' || card.format !== LEVEL_CARD_FORMAT) return null;

    // 2) 首次进关：当前世界强制落盘 → 清 AI 施工队列（幽灵建筑防线，plan §8.2）。
    //    saveGame 必须在挂 state.levelRun 之前调——B2 会在 saveGame() 入口加
    //    「levelRun 激活即拒写」防线（W10 存档防线的唯一机制）。
    if (!alreadyActive) {
        const sg = await modPromise('saveGame');
        try { sg?.saveGame?.(); } catch { /* 落盘失败不阻塞进关（配额满等） */ }
    }
    {
        const bq = await modPromise('buildQueue');
        try { bq?.clearBuildQueue?.(); } catch { }
    }

    // 3) 组装运行时对象（契约 §3.2 结构；retry 重入沿用首次的 restore，绝不能把
    //    闯关中改过的 time/gameMode 当成「进关前状态」存进去）
    const lw = await modPromise('levelWorkshop');
    let cardHash = null;
    try { cardHash = lw?.cardHash?.(card) || null; } catch { }
    if (!cardHash) cardHash = fallbackCardHash(card);
    const run = {
        cardId: cardId || card.id || cardHash,
        cardHash,
        card,
        spawn: null,                     // embed 返回的起点旗世界块坐标
        respawn: null,                   // 当前重生点（世界块坐标，随检查点切换）
        activatedCheckpoints: new Set(), // 已激活检查点（局部 'x,y,z' key）
        timeStart: state.time,           // 进关时游戏时刻（时间锁正午，调试参考用）
        elapsed: 0,                      // 本局用时（秒），唯一计时源
        deaths: 0,
        answers: {},                     // 'lx,ly,lz' -> {tries, solved}
        rules: { timeLimit: null, lockAIHelp: true, ...(card.rules || {}) },
        restore: alreadyActive ? prevRun.restore : { time: state.time, gameMode: state.gameMode },
    };
    state.levelRun = run;

    // 4) 临时世界：整体清零 + 铺 y=0 基岩层（四周空气、底部基岩平台，plan §2.3），
    //    再由 levelWorkshop.embedLevelToWorld 只写 region 区（固定偏移 +80,+4,+80）
    state.blocks = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT * WORLD_DEPTH);
    for (let x = 0; x < WORLD_WIDTH; x++) {
        for (let z = 0; z < WORLD_DEPTH; z++) {
            state.blocks[x + z * WORLD_WIDTH] = BlockTypes.BEDROCK; // y=0
        }
    }
    let res = null;
    try { res = lw?.embedLevelToWorld?.(card) || null; } catch { }
    if (!res || !res.spawn) {
        // 嵌入失败：回滚运行时；首次进关世界已被清零，读回刚才落盘的槽位恢复原世界
        state.levelRun = prevRun;
        if (!alreadyActive) {
            const sg = await modPromise('saveGame');
            try { sg?.loadGame?.(state.saveSlot); } catch { }
        }
        return null;
    }
    run.spawn = { x: res.spawn.x, y: res.spawn.y, z: res.spawn.z };
    run.respawn = { ...run.spawn };

    // 5) 重建网格：嵌入区 dirtyChunks 逐个 rebuildChunk（契约路径）；其余区块因世界
    //    被整体清零同样网格过期，也要扫一遍——只重建嵌入区会残留旧地形网格
    const chunk = await modPromise('chunk');
    if (chunk?.rebuildChunk) {
        const dirty = new Set(normalizeChunkKeys(res.dirtyChunks));
        for (const key of dirty) {
            const [cx, cz] = key.split(',').map(Number);
            try { chunk.rebuildChunk(cx, cz); } catch { }
        }
        const nCx = Math.ceil(WORLD_WIDTH / CHUNK_SIZE);
        const nCz = Math.ceil(WORLD_DEPTH / CHUNK_SIZE);
        for (let cx = 0; cx < nCx; cx++) {
            for (let cz = 0; cz < nCz; cz++) {
                if (dirty.has(`${cx},${cz}`)) continue;
                try { chunk.rebuildChunk(cx, cz); } catch { }
            }
        }
    }

    // 6) 重置子系统：红石/动力网络按新世界重算；清残留怪物与掉落物
    {
        const rs = await modPromise('redstone');
        try { rs?.initRedstone?.(); } catch { }
        const kt = await modPromise('kinetic');
        try { kt?.initKinetic?.(); } catch { }
        const ent = await modPromise('entities');
        try {
            if (ent?.clearAllEnemies) ent.clearAllEnemies(); // B2 落地的正式出口
            else if (ent?.killEnemySilent) for (const e of [...state.enemies]) ent.killEnemySilent(e);
        } catch { }
        try { (await modPromise('items'))?.clearItemDrops?.(); } catch { }
        // TNT 与粒子暂无公开 clear 导出（B2 会补）：有则用，没有就跳过
        try { (await modPromise('tnt'))?.clearTntEntities?.(); } catch { }
        try { (await modPromise('particles'))?.clearParticles?.(); } catch { }
    }

    // 7) 玩家置出生点：起点旗块中心（x+0.5 / z+0.5），落在旗顶 +1；清摔落记账。
    //    dead/health 一并复位——死亡界面点「重试」直接重进时不能困在 dead 态
    //    （setState('playing') 对 dead 玩家会强制翻回 'dead'，见 uiModal.setState）。
    const p = state.player;
    p.x = run.spawn.x + 0.5;
    p.y = run.spawn.y + 1;
    p.z = run.spawn.z + 0.5;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.flying = false; // 创造飞行中进关必须落地（playerPhysics 只看 p.flying 不看 gameMode，W11）
    p.fallStartY = null;
    p.dead = false;
    p.health = MAX_HEALTH; // 满血复位（死亡后重试不被 0 血卡住）

    // 8) 模式与时间强制（W11 绕过通道全闭的运行时侧）：闯关恒为生存；
    //    时间锁正午——daynight.js:94 sunHeight = sin(dayProgress*2π − π/2) 在
    //    dayProgress=0.5 时取最大值 1（太阳最高=正午），即 time ≡ dayLength/2
    //    （dayLength=600 ⇒ 300 秒；state.js isNight 同式）。
    state.gameMode = GameModes.SURVIVAL;
    state.time = state.dayLength / 2;

    // 9) 进关播放数 +1（本地最佳成绩的 plays；结算/列表页显示用）
    bumpPlayCount(run.cardHash);

    // 10) 关全部浮层 → playing（uiModal 惰性；result 态由 B2 落地，这里只用 playing）
    {
        const um = await modPromise('uiModal');
        try { um?.setState?.('playing'); } catch { }
    }

    // 11) 埋点（P2）：recordLevelPlay 由 A3 落地，缺省跳过
    try { (await modPromise('eduRewards'))?.recordLevelPlay?.(); } catch { }

    return run;
}

// embedLevelToWorld 的 dirtyChunks 键归一化：契约给 [{cx,cz}]，容错兼容 'cx,cz' 字符串
function normalizeChunkKeys(dirtyChunks) {
    const keys = new Set();
    for (const c of dirtyChunks || []) {
        if (typeof c === 'string') keys.add(c);
        else if (c && typeof c.cx === 'number' && typeof c.cz === 'number') keys.add(`${c.cx},${c.cz}`);
    }
    return keys;
}

// cardHash 兜底：levelWorkshop.cardHash 不可用时按 region.blocks+questions+rules 拼一个
// djb2（与契约 §3.1 的稳定哈希同源同序，只是实现内联）
function fallbackCardHash(card) {
    const norm = JSON.stringify({
        b: card?.region?.blocks || '',
        q: card?.questions || [],
        r: card?.rules || {},
    });
    let h = 5381;
    for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
    return `h${(h >>> 0).toString(36)}`;
}

// ==================== 每帧驱动 ====================

// main.js 每帧调（updateItemDrops 附近，B2 接线）：取 state 包装成 tickRun 调用
export function tickLevelRun(dt) {
    const run = state.levelRun;
    if (!run || run.finished) return null;
    const p = state.player;
    return tickRun(run, dt, { x: p.x, y: p.y, z: p.z }, {
        toWorld: toWorldPos,
        isOOB: (x, y, z) => outOfRunArea(x, y, z),
        // 掉界 = 模拟死亡：deaths+1 + 传送回最近检查点/起点（计时不停；红屏可后置）
        onOOB: () => {
            const pos = getRespawnPos();
            if (!pos) return;
            p.x = pos.x + 0.5;
            p.y = pos.y + 1;
            p.z = pos.z + 0.5;
            p.vx = 0; p.vy = 0; p.vz = 0;
            p.fallStartY = null;
        },
        onFinish: (result) => finalizeFinish(run, result),
    });
}

// 纯逻辑核心（可导出直测）：计时 → 踩踏（起点/检查点/终点）→ 掉界 → 限时超时。
// run = 契约 §3.2 的运行时对象（state.levelRun 的同构替身）；hooks 全部可注入：
//   toWorld(lx,ly,lz)→{x,y,z}  isOOB(x,y,z)→bool  onOOB()  onFinish(result)
// 浏览器外（Node 自测）不注入 hooks 时按契约冻结偏移换算、跳过掉界检测。
export function tickRun(run, dt, playerPos, hooks = {}) {
    if (!run || run.finished) return null;
    run.elapsed += dt;

    const toWorld = hooks.toWorld || ((x, y, z) => toWorldPos(x, y, z));
    const flags = run.card?.flags;

    // —— 踩踏检测：水平距块中心 <1.2 且 y 差 <1.5（契约 §3.2）——
    if (flags) {
        // 起点旗：踩上即把重生点刷回起点（走回头路后可主动重置）
        if (flags.start) {
            const hit = hitFlag(playerPos, flags.start, toWorld);
            if (hit) run.respawn = { x: hit.x, y: hit.y, z: hit.z };
        }
        // 检查点旗：设 respawn + 记入 activatedCheckpoints；重复踩 = 刷新（重设，幂等）
        for (const cp of flags.checkpoints || []) {
            const hit = hitFlag(playerPos, cp, toWorld);
            if (hit) {
                run.respawn = { x: hit.x, y: hit.y, z: hit.z };
                run.activatedCheckpoints.add(`${cp.x},${cp.y},${cp.z}`);
            }
        }
        // 终点旗：结算（星级/明细在 buildResult），onFinish 交给浏览器层落最佳+开面板
        if (flags.goal && hitFlag(playerPos, flags.goal, toWorld)) {
            run.finished = true;
            const result = buildResult(run);
            hooks.onFinish?.(result);
            return result;
        }
    }

    // —— 掉界：模拟死亡（deaths+1 + onOOB 传送回重生点，计时不停）——
    if (hooks.isOOB && hooks.isOOB(playerPos.x, playerPos.y, playerPos.z)) {
        run.deaths += 1;
        hooks.onOOB?.();
    }

    // —— 限时超时：失败结算（stars=0，result 带 timeout:true；不再是通关，无 1 星保底）——
    const limit = run.rules?.timeLimit;
    if (limit != null && run.elapsed >= limit) {
        run.finished = true;
        const result = buildResult(run, { timeout: true });
        hooks.onFinish?.(result);
        return result;
    }
    return null;
}

// 踩踏命中：返回命中旗的世界块坐标，未命中返回 null
function hitFlag(playerPos, flag, toWorld) {
    if (!flag || typeof flag.x !== 'number') return null;
    const w = toWorld(flag.x, flag.y, flag.z);
    const dx = playerPos.x - (w.x + 0.5); // 块中心 = 块坐标 +0.5
    const dz = playerPos.z - (w.z + 0.5);
    if (dx * dx + dz * dz >= STEP_RADIUS * STEP_RADIUS) return null;
    if (Math.abs(playerPos.y - w.y) >= STEP_Y_TOLERANCE) return null;
    return { x: w.x, y: w.y, z: w.z };
}

// ==================== 结算与成绩 ====================

// 星级规则单点（契约 §3.2，追加导出供测试/展示复用）：
//   0 = 超时（失败，不通关不给星）；3 = 零死亡且全锁一次过且 solved；
//   2 = 通关且（零死亡 或 全锁最终答对）；1 = 通关。
// 无锁关卡（纯跑酷）两处「全锁」对空数组恒真 → 零死亡即 3 星。
export function computeStars({ deaths = 0, locks = [], timeout = false } = {}) {
    if (timeout) return 0;
    const allSolved = locks.every((l) => l && l.solved);
    const allFirstTry = locks.every((l) => l && l.solved && l.tries === 1);
    if (deaths === 0 && allSolved && allFirstTry) return 3;
    if (deaths === 0 || allSolved) return 2;
    return 1;
}

// 结算明细（locks 按 card.questions 顺序从 answers 汇总；pos 为局部 'x,y,z'）
function buildResult(run, extra = {}) {
    const qs = run.card?.questions || [];
    const locks = qs.map((q) => {
        const a = run.answers[`${q.x},${q.y},${q.z}`];
        return { pos: `${q.x},${q.y},${q.z}`, tries: a ? a.tries : 0, solved: !!(a && a.solved) };
    });
    return {
        cardId: run.cardId,
        cardHash: run.cardHash,
        name: run.card?.name || '',
        author: run.card?.author || '',
        timeSec: run.elapsed,
        deaths: run.deaths,
        locks,
        stars: computeStars({ deaths: run.deaths, locks, timeout: !!extra.timeout }),
        ...extra,
    };
}

// 踩终点结算（契约 §3.2 导出）：标记结束 → 落最佳成绩 → 开结算浮层。返回结算结果。
export function finishRun() {
    const run = state.levelRun;
    if (!run || run.finished) return null;
    run.finished = true;
    const result = buildResult(run);
    finalizeFinish(run, result);
    return result;
}

// 结算收尾（tickRun.onFinish 与 finishRun 共用）：recordBest + isNewBest + 结算面板
function finalizeFinish(run, result) {
    const rec = recordBest(run.cardHash, {
        stars: result.stars,
        timeSec: result.timeSec,
        deaths: result.deaths,
    });
    result.isNewBest = rec.isNewBest;
    result.best = rec.entry;
    // 宣传片「通关自动保存」（plan §3.3）：level 档录像在通关结算瞬间停（导出成片），
    // 不等用户点退出；isLevelOwnedRecording 守卫保证绝不误停用户/跟拍的会话
    try {
        const rc = mod('recording');
        if (rc?.isLevelOwnedRecording?.()) rc.stopRecording?.();
    } catch { }
    // 结算浮层：uiModal 的 result 态由 B2 落地——openResultState 优先，缺省退 setState('result')
    const um = mod('uiModal');
    try {
        (um?.openResultState?.(result)) ?? um?.setState?.('result');
    } catch { }
}

// recordBest：stars 高者优先、同星用时短者；零星（超时失败）不刷新最佳。
// 返回 {isNewBest, entry}；plays（进关次数）由 bumpPlayCount 维护，这里原样保留。
function recordBest(cardHash, rec) {
    const data = loadBestStore();
    const prev = data.best[cardHash] || null;
    const isNewBest = betterThan(rec, prev);
    const entry = isNewBest
        ? { stars: rec.stars, timeSec: rec.timeSec, deaths: rec.deaths, plays: prev?.plays || 0 }
        : { stars: prev.stars, timeSec: prev.timeSec, deaths: prev.deaths, plays: prev.plays || 0 };
    data.best[cardHash] = entry;
    saveBestStore(data);
    return { isNewBest, entry };
}

// 进关播放数 +1（enterLevel 调；追加导出便于 Node 直测）
export function bumpPlayCount(cardHash) {
    if (!cardHash) return;
    const data = loadBestStore();
    const prev = data.best[cardHash];
    data.best[cardHash] = prev
        ? { ...prev, plays: (prev.plays || 0) + 1 }
        : { stars: 0, timeSec: null, deaths: 0, plays: 1 };
    saveBestStore(data);
}

function betterThan(a, b) {
    if (!a || a.stars <= 0) return false; // 零星不刷新
    if (!b || !b.stars) return true;      // 此前无有效成绩（含只进关未通关的 plays 占位）
    if (a.stars !== b.stars) return a.stars > b.stars;
    return a.timeSec < b.timeSec;
}

// localStorage 'mcweb.levels.v1' 存取；localStorage 不存在（Node）⇒ 进程内内存兜底
let memBestStore = null;

function loadBestStore() {
    const ls = globalThis.localStorage;
    if (!ls) {
        if (!memBestStore) memBestStore = { best: {} };
        return memBestStore;
    }
    try {
        const raw = ls.getItem(BEST_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (data && typeof data === 'object' && data.best && typeof data.best === 'object') return data;
        }
    } catch { /* 损坏即重置（成绩非关键数据） */ }
    return { best: {} };
}

function saveBestStore(data) {
    const ls = globalThis.localStorage;
    if (!ls) { memBestStore = data; return; }
    try { ls.setItem(BEST_KEY, JSON.stringify(data)); } catch { /* 配额超限静默 */ }
}

// 按卡哈希查最佳成绩（关卡列表/结算面板展示用）；无则 null
export function getBestScores(cardHash) {
    if (!cardHash) return null;
    const e = loadBestStore().best[cardHash];
    if (!e) return null;
    // G3 P2#6：脏数据消毒——坏 stars 会让 ui.js '★'.repeat 抛 RangeError 炸掉整个列表
    const stars = Math.max(0, Math.min(3, e.stars | 0));
    const timeSec = typeof e.timeSec === 'number' && e.timeSec >= 0 ? e.timeSec : null;
    if (stars === e.stars && timeSec === e.timeSec) return e;
    return { ...e, stars, timeSec };
}

// ==================== 锁具记账（eduKeypad/星辉门作答均调，B3/A3 接线） ====================

// 作答记账：tries 无条件 +1；solved 一旦为真保持为真（最终答对即可，重试不降级）
export function recordLockAttempt(localKey, correct) {
    const run = state.levelRun;
    if (!run || !localKey) return;
    const prev = run.answers[localKey];
    run.answers[localKey] = {
        tries: (prev?.tries || 0) + 1,
        solved: !!(prev?.solved) || !!correct,
    };
}

// 世界坐标 → 局部坐标 → card.questions 匹配（按位置命中，不筛 lockType——
// 答题机与星辉门共用同一张题表，行为差异由调用方按 q.lockType 区分）
export function getCardQuestion(x, y, z) {
    const qs = state.levelRun?.card?.questions;
    if (!qs || !qs.length) return null;
    const l = toLocalPos(x, y, z);
    return qs.find((q) => q && q.x === l.x && q.y === l.y && q.z === l.z) || null;
}

// 考核锁：rules.lockAIHelp === false ⇒ AI 助手对锁题拒答提示（docs.js 苏格拉底约束用）
export function isLockAIHelpFrozen() {
    return state.levelRun?.card?.rules?.lockAIHelp === false;
}

// ==================== 死亡与退出 ====================

// playerLife.die() 调（B2 接线）：deaths+1，计时不停（elapsed 照走）
export function onPlayerDeath() {
    const run = state.levelRun;
    if (run) run.deaths += 1;
}

// 退出关卡：录像收尾（只停关卡自己的录像，绝不碰用户会话——run_rec.py 回归红线）→
// levelRun=null → 恢复 time/gameMode → loadGame 读回原世界 → 回 playing/title。
// 同步外壳 + 内部异步续段（动态 import 就绪后执行；浏览器里预热缓存即刻可用）。
export function exitLevelRun({ toTitle = false } = {}) {
    const run = state.levelRun;
    if (!run) return false;
    const rec = mod('recording');
    if (rec?.isLevelOwnedRecording?.()) {
        try { rec.stopRecording?.(); } catch { }
    }
    state.levelRun = null;
    void (async () => {
        // 恢复进关前的时间与模式（loadGame 成功后会被存档值覆盖，这里是读档失败兜底）
        const restore = run.restore;
        if (restore) {
            if (typeof restore.time === 'number') state.time = restore.time;
            if (restore.gameMode) state.gameMode = restore.gameMode;
        }
        const sg = await modPromise('saveGame');
        let restored = false;
        try { restored = !!sg?.loadGame?.(state.saveSlot); } catch { }
        if (!restored) {
            // G3 P2#7：读档失败（存档损坏/配额异常）时绝不能把关卡临时世界留驻内存——
            // levelRun 已置 null，30s 自动存档会把它写进槽位。freshWorld 兜底回到干净世界。
            try {
                const w = await modPromise('world');
                if (w?.generateWorld) w.generateWorld();
            } catch { }
        }
        const um = await modPromise('uiModal');
        try { um?.setState?.(toTitle ? 'title' : 'playing'); } catch { }
    })();
    return true;
}

// ==================== HUD ====================

// 闯关 HUD 数据（B4 的 updateLevelHud 每帧读）：{time, deaths, solved, total}；非关卡时 null
export function getHudState() {
    const run = state.levelRun;
    if (!run) return null;
    const qs = run.card?.questions || [];
    let solved = 0;
    for (const q of qs) {
        if (run.answers[`${q.x},${q.y},${q.z}`]?.solved) solved++;
    }
    return { time: run.elapsed, deaths: run.deaths, solved, total: qs.length };
}
