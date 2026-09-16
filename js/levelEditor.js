// ==================== levelEditor.js ====================
// 关卡编辑器（2026-09-16「界面化建关」批次）：独立编辑会话 + 预设组件放置。
// 需求来源：此前自建关卡只能「在自家世界里摆 + 导入卡」——现在首屏「🗺 关卡」可
//   ✏️ 新建空白关卡 / 从模板（官方卡·我的模板·草稿）新建，进入一个**临时编辑世界**
//   随便搭：允许挖掘放置与出题笔全流程（与闯关态的全面封锁相反），退出自动存草稿。
//
// 与 levelRun（闯关）同构的世界机制，守卫方向相反：
//   进编辑器 = 当前世界强制落盘 → 清 AI 施工队列 → state.blocks 清零铺地基层 →
//   （带卡时）embedLevelToWorld 嵌模板 → 重建网格 → 重置子系统 → 强制创造+正午。
//   退编辑器 = 草稿自动落盘（buildLevelCard draft:true，草稿容忍星辉门）→ 恢复锁题
//   快照 → loadGame 精确读回原世界 → 回首屏。
//
// 存档防线：saveGame 入口闸对 state.levelEdit 拒写（同 state.levelRun）——自动存/
// pagehide/手动保存都不会把临时编辑世界写进玩家槽位；草稿走 IndexedDB 关卡卡库。
//
// Node 可测性铁律（照 levelRun）：静态 import 只许 config/state/levelPrefabs（纯几何）；
// 浏览器模块（saveGame/chunk/redstone/kinetic/entities/…/levelWorkshop/eduKeypad/
// interaction/ui/levelPoster）一律动态 import() + 可选链，失败静默跳过。

import { BlockTypes, GameModes, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { isCreative, state } from './state.js';
import { buildPrefabCells, getPrefab, prefabOrigin } from './levelPrefabs.js';

// ---- 常量 ----

// 编辑世界地基层：y=0 基岩（防凿穿坠虚空）+ y=1..2 泥土 + y=3 草皮。
// 比闯关临时世界厚一层皮：锚点区域检测会把这层地基带进卡（官方关卡同款做法）。
const GROUND_TOP_Y = 3;
export const EDITOR_SPAWN = { x: 88.5, y: GROUND_TOP_Y + 1, z: 88.5 }; // 空白关出生点（世界中部）

const DRAFT_AUTOSAVE_SEC = 60; // 编辑中草稿自动保存间隔（退出时必存一次兜底）

// ---- 动态 import 注册表（levelRun 同款；缺失/失败安静降级为 null） ----
const MOD_PATHS = {
    levelWorkshop: './levelWorkshop.js', // buildLevelCard / embedLevelToWorld / localToWorld / saveLevelCard
    saveGame: './saveGame.js',           // saveGame / loadGame（进出世界切换）
    world: './world.js',                 // setBlockSafe / generateWorld（读档失败兜底）
    buildQueue: './buildQueue.js',       // clearBuildQueue（幽灵建筑防线）
    chunk: './chunk.js',                 // rebuildChunk / updateChunkMeshes
    redstone: './redstone.js',           // updateRedstoneNetwork / initRedstone
    kinetic: './kinetic.js',             // updateKineticNetwork / initKinetic
    items: './items.js',                 // clearItemDrops
    entities: './entities.js',           // clearAllEnemies / killEnemySilent
    tnt: './tnt.js',
    particles: './particles.js',
    eduKeypad: './eduKeypad.js',         // 锁题快照/种子（模板重嵌入免重出题）
    interaction: './interaction.js',     // raycastBlocks（组件放置拾取）
    ui: './ui.js',                       // showTooltip（放置反馈）
    uiModal: './uiModal.js',             // setState
    levelPoster: './levelPoster.js',     // renderRegionThumbnail（草稿缩略图）
    recording: './recording.js',         // isLevelOwnedRecording（退出收尾同款保险）
};

const MOD_CACHE = new Map();
const MOD_PROMISES = new Map();

function modPromise(name) {
    if (!MOD_PROMISES.has(name)) {
        MOD_PROMISES.set(name, import(MOD_PATHS[name]).then((m) => {
            MOD_CACHE.set(name, m);
            return m;
        }).catch(() => {
            MOD_CACHE.set(name, null);
            return null;
        }));
    }
    return MOD_PROMISES.get(name);
}

function mod(name) {
    return MOD_CACHE.get(name) ?? null;
}

for (const name of Object.keys(MOD_PATHS)) modPromise(name);

async function tip(text) {
    try { (await modPromise('ui'))?.showTooltip?.(text); } catch { }
}

// ==================== 基础查询 ====================

export function isLevelEditorActive() {
    return !!state.levelEdit;
}

// HUD 消费：{name, placing, isDraft, templateName}；非编辑态返回 null
export function getEditorInfo() {
    const ed = state.levelEdit;
    if (!ed) return null;
    return {
        name: ed.name,
        placing: ed.placing || null,
        isDraft: !!ed.draftCard,
        templateName: ed.templateName || '',
    };
}

// ==================== 进编辑器 ====================

// enterLevelEditor(card?, opts?)：card 为模板/草稿卡（deep copy 由调用方负责），
// null = 空白关。opts.name 覆盖默认名；opts.templateName 记「从哪个模板来」给 HUD 展示。
// 返回 true/false；任何模块缺失都不抛错（失败回读原世界）。
export async function enterLevelEditor(card = null, { name, templateName } = {}) {
    if (state.levelRun) return false; // 闯关态绝不可进编辑器（世界会被清零）

    // 1) 当前世界强制落盘（必须在挂 state.levelEdit 之前——saveGame 入口闸见 saveGame.js）
    {
        const sg = await modPromise('saveGame');
        try { sg?.saveGame?.(); } catch { /* 落盘失败不阻塞（配额满等） */ }
        try { (await modPromise('buildQueue'))?.clearBuildQueue?.(); } catch { }
    }

    // 2) 锁题快照：编辑世界占住嵌入区坐标，清空全表防串扰，退编辑器时原样恢复
    const ek = await modPromise('eduKeypad');
    let lockSnapshot = [];
    try { lockSnapshot = ek?.listAuthoredLocks?.() || []; } catch { }
    try { ek?.restoreAuthoredLocks?.([]); } catch { }

    // 3) 组装会话对象并挂上 state（此后 saveGame 全线拒写，见 saveGame.js 入口闸）
    const ed = {
        name: String(name ?? card?.name ?? '未命名关卡').trim() || '未命名关卡',
        templateName: String(templateName || ''),
        draftCard: card && card.meta && card.meta.draft ? card : null, // 草稿续编：created 沿用保证 id 稳定
        lastDraftId: null,
        lockSnapshot,
        autosaveT: 0,
        placing: null,
        restore: { time: state.time, gameMode: state.gameMode },
    };
    state.levelEdit = ed;

    // 4) 临时编辑世界：整体清零 + 地基层（闯关世界同款清零路径）
    state.blocks = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT * WORLD_DEPTH);
    for (let x = 0; x < WORLD_WIDTH; x++) {
        for (let z = 0; z < WORLD_DEPTH; z++) {
            const col = x + z * WORLD_WIDTH;
            state.blocks[col] = BlockTypes.BEDROCK; // y=0
            state.blocks[col + WORLD_WIDTH * WORLD_DEPTH] = BlockTypes.DIRT; // y=1
            state.blocks[col + 2 * WORLD_WIDTH * WORLD_DEPTH] = BlockTypes.DIRT; // y=2
            state.blocks[col + 3 * WORLD_WIDTH * WORLD_DEPTH] = BlockTypes.GRASS; // y=3
        }
    }

    // 5) 带卡时嵌模板（固定偏移 80,4,80——与闯关共用，坐标换算单点在 levelWorkshop）
    let spawn = { x: Math.floor(EDITOR_SPAWN.x), y: GROUND_TOP_Y + 1, z: Math.floor(EDITOR_SPAWN.z) };
    if (card) {
        const lw = await modPromise('levelWorkshop');
        let res = null;
        try { res = lw?.embedLevelToWorld?.(card) || null; } catch { }
        if (!res || res.error) {
            // 嵌入失败：回滚（世界已清零，读回落盘的槽位），锁题快照还原
            state.levelEdit = null;
            try { ek?.restoreAuthoredLocks?.(lockSnapshot); } catch { }
            const sg = await modPromise('saveGame');
            try { sg?.loadGame?.(state.saveSlot); } catch { }
            void tip(`❌ 模板嵌入失败：${(res && res.error) || '卡数据损坏'}`);
            return false;
        }
        if (res.spawn) spawn = { x: res.spawn.x, y: res.spawn.y, z: res.spawn.z };
        // 锁题种子：把卡内题目按世界坐标种回作者锁表（双通过免重做；改题才重新双通过）
        try {
            for (const q of card.questions || []) {
                if (!q || !Number.isInteger(q.x)) continue;
                const w = lw?.localToWorld?.(q.x, q.y, q.z) ||
                    { x: q.x + 80, y: q.y + 4, z: q.z + 80 };
                const passes = Math.min(2, ((q.meta && q.meta.verifiedPasses) | 0) || 2);
                ek?.seedAuthoredLock?.(w.x, w.y, w.z, q, passes);
            }
        } catch { }
    }

    // 6) 重建网格：世界被整体清零，全部区块都要重建（闯关 enterLevel 同款全扫）
    {
        const chunk = await modPromise('chunk');
        try {
            if (chunk?.updateChunkMeshes) chunk.updateChunkMeshes();
            else if (chunk?.rebuildChunk) {
                const nCx = Math.ceil(WORLD_WIDTH / 16);
                const nCz = Math.ceil(WORLD_DEPTH / 16);
                for (let cx = 0; cx < nCx; cx++) {
                    for (let cz = 0; cz < nCz; cz++) chunk.rebuildChunk(cx, cz);
                }
            }
        } catch { }
    }

    // 7) 重置子系统（红石/动力按新世界重算；清残留怪物与掉落物）
    {
        try { (await modPromise('redstone'))?.initRedstone?.(); } catch { }
        try { (await modPromise('kinetic'))?.initKinetic?.(); } catch { }
        const ent = await modPromise('entities');
        try {
            if (ent?.clearAllEnemies) ent.clearAllEnemies();
            else if (ent?.killEnemySilent) for (const e of [...state.enemies]) ent.killEnemySilent(e);
        } catch { }
        try { (await modPromise('items'))?.clearItemDrops?.(); } catch { }
        try { (await modPromise('tnt'))?.clearTntEntities?.(); } catch { }
        try { (await modPromise('particles'))?.clearParticles?.(); } catch { }
    }

    // 8) 玩家置出生点（起点旗 +0.5/+1 由 embed 返回的块坐标换算，同闯关）
    {
        const p = state.player;
        p.x = spawn.x + 0.5;
        p.y = spawn.y + 1;
        p.z = spawn.z + 0.5;
        p.vx = 0; p.vy = 0; p.vz = 0;
        p.flying = false;
        p.fallStartY = null;
        p.dead = false;
    }

    // 9) 编辑态强制：创造模式（随便挖随便放）+ 时间锁正午（tick 每帧锁，见下）
    state.gameMode = GameModes.CREATIVE;
    state.time = state.dayLength / 2;

    // 10) 进世界 → playing；给操作提示
    {
        const um = await modPromise('uiModal');
        try { um?.setState?.('playing'); } catch { }
    }
    void tip(card
        ? `✏️ 编辑中：${ed.name}——B 打开组件库，K 完成导出`
        : `✏️ 新关卡开工！B 打开组件库盖骨架，出题笔右键答题机出题`);

    // 首次进编辑器即存一版草稿骨架（带卡=模板副本立即落一份自己的草稿）
    void saveEditorDraft({ silent: true });
    return true;
}

// ==================== 草稿 ====================

// 草稿落盘：buildLevelCard(draft:true) 全图扫锚点（编辑世界 = 整张卡），星辉门容忍
//（草稿不拦，正式导出仍按契约拦）。失败（无锚点/超上限）静默或提示由 silent 决定。
export async function saveEditorDraft({ silent = false } = {}) {
    const ed = state.levelEdit;
    if (!ed) return null;
    const lw = await modPromise('levelWorkshop');
    if (!lw?.buildLevelCard) return null;
    let author = '我';
    try { author = localStorage.getItem('mcweb.level.author') || '我'; } catch { }
    const card = await lw.buildLevelCard({ name: ed.name, author, draft: true });
    if (!card || card.error) {
        if (!silent) void tip(`⚠️ 暂时存不了草稿：${(card && card.error) || '未知错误'}`);
        return null;
    }
    // 草稿 id 稳定：沿用首存时间戳（levelCardId = hash + created 短码）；hash 随编辑变化
    // 会让 id 漂移——保存后清掉旧 id 记录，列表里永远只有这一份草稿
    if (ed.draftCard && ed.draftCard.created) card.created = ed.draftCard.created;
    let thumbBlob = null;
    try {
        const lp = await modPromise('levelPoster');
        const cv = lp?.renderRegionThumbnail?.(card, 128);
        if (cv) {
            thumbBlob = await new Promise((resolve) => {
                try { cv.toBlob((b) => resolve(b || null), 'image/png'); } catch { resolve(null); }
            });
        }
    } catch { }
    const saved = await lw.saveLevelCard(card, thumbBlob).catch(() => null);
    if (!saved || !saved.ok) {
        if (!silent) void tip('⚠️ 草稿保存失败（存储不可用？）');
        return null;
    }
    if (ed.lastDraftId && ed.lastDraftId !== saved.id) {
        try { await lw.deleteLevelCard?.(ed.lastDraftId); } catch { }
    }
    ed.lastDraftId = saved.id;
    ed.draftCard = card;
    if (!silent) void tip(`💾 草稿已保存「${ed.name}」（关卡列表可继续编辑）`);
    return card;
}

// ==================== 退编辑器 ====================

// 退编辑器：草稿落盘 → 锁题快照恢复 → loadGame 读回原世界 → 回首屏。
// toTitle=false 回到游戏（切世界守卫路径用，main.js 会再接手自己的编排）。
export async function exitLevelEditor({ saveDraft = true, toTitle = true } = {}) {
    const ed = state.levelEdit;
    if (!ed) return false;
    if (saveDraft) await saveEditorDraft({ silent: true });
    try {
        const ek = await modPromise('eduKeypad');
        ek?.restoreAuthoredLocks?.(ed.lockSnapshot);
    } catch { }
    state.levelEdit = null; // 先摘守卫（loadGame 读档不受影响，自动存档闸恢复正常）
    try {
        const rc = await modPromise('recording');
        if (rc?.isLevelOwnedRecording?.()) rc.stopRecording?.();
    } catch { }
    // 恢复进关前时间与模式（loadGame 成功后会被存档值覆盖，这里是读档失败兜底）
    if (ed.restore) {
        if (typeof ed.restore.time === 'number') state.time = ed.restore.time;
        if (ed.restore.gameMode) state.gameMode = ed.restore.gameMode;
    }
    const sg = await modPromise('saveGame');
    let restored = false;
    try { restored = !!sg?.loadGame?.(state.saveSlot); } catch { }
    if (!restored) {
        try {
            const w = await modPromise('world');
            if (w?.generateWorld) w.generateWorld();
        } catch { }
    }
    const um = await modPromise('uiModal');
    try { um?.setState?.(toTitle ? 'title' : 'playing'); } catch { }
    return true;
}

// ==================== 每帧驱动（main.js gameLoop 调） ====================

export function tickLevelEditor(dt) {
    const ed = state.levelEdit;
    if (!ed) return;
    // 时间锁正午：tick 每帧写回（编辑器要恒定亮堂的施工光；也顺带压掉夜间刷怪）
    state.time = state.dayLength / 2;
    // 草稿自动保存（静默；无锚点时本轮跳过、下轮再试）
    ed.autosaveT += dt;
    if (ed.autosaveT >= DRAFT_AUTOSAVE_SEC) {
        ed.autosaveT = 0;
        void saveEditorDraft({ silent: true });
    }
}

// ==================== 预设组件放置 ====================

// 开始放置（组件库面板点选后调）：编辑态写进会话；普通创造世界用 freePlacing。
let freePlacing = null; // 非编辑态（普通建造世界）的放置态

export function startPlacing(prefabId) {
    const pf = getPrefab(prefabId);
    if (!pf) return false;
    if (state.levelEdit) state.levelEdit.placing = prefabId;
    else if (isCreative() && !state.levelRun) freePlacing = prefabId;
    else return false;
    void tip(`🧱 左键放置：${pf.name}——连放可多点，Esc/B 收工`);
    return true;
}

export function cancelPlacing() {
    if (state.levelEdit) state.levelEdit.placing = null;
    freePlacing = null;
}

export function getPlacing() {
    if (state.levelEdit) return state.levelEdit.placing || null;
    return freePlacing;
}

// 左键消费（input.js mousedown 最早处调）：正在放置 → 盖章并吞掉这次点击（不挖掘）。
// 返回 true = 已消费。
export function consumePlaceClick() {
    const id = getPlacing();
    if (!id) return false;
    void placePlacingNow(id);
    return true;
}

async function placePlacingNow(prefabId) {
    const pf = getPrefab(prefabId);
    if (!pf) return;
    const it = await modPromise('interaction');
    const hit = it?.raycastBlocks?.();
    if (!hit) {
        void tip('准星没对着方块——瞄准地面再放');
        return;
    }
    const ok = await stampPrefabAt(prefabId, hit);
    if (ok) {
        const remains = getPlacing();
        if (remains) void tip(`🧱 ${pf.name} 已放置——左键继续，Esc/B 收工`);
    }
}

// 盖章：组件几何写世界（AIR=雕刻）→ 重建受影响区块 → 红石/动力重算。
// 供 consumePlaceClick 与 E2E 烟雾直调；返回 true=成功落格。
export async function stampPrefabAt(prefabId, hit) {
    const pf = getPrefab(prefabId);
    if (!pf || !hit) return false;
    const { cells, error } = buildPrefabCells(pf);
    if (error) {
        void tip(`⚠️ 组件几何错误：${error}`);
        return false;
    }
    const origin = prefabOrigin(pf, hit);
    const w = await modPromise('world');
    if (!w?.setBlockSafe) return false;
    const dirty = new Set();
    for (const c of cells) {
        const bx = origin.x + c.x;
        const by = origin.y + c.y;
        const bz = origin.z + c.z;
        w.setBlockSafe(bx, by, bz, c.id);
        dirty.add(`${Math.floor(bx / 16)},${Math.floor(bz / 16)}`);
    }
    const chunk = await modPromise('chunk');
    if (chunk?.rebuildChunk) {
        for (const key of dirty) {
            const [cx, cz] = key.split(',').map(Number);
            try { chunk.rebuildChunk(cx, cz); } catch { }
        }
    }
    // 组件可能带红石/动力方块：整网重算（编辑世界不大，直接全量）
    try { (await modPromise('redstone'))?.updateRedstoneNetwork?.(); } catch { }
    try { (await modPromise('kinetic'))?.updateKineticNetwork?.(); } catch { }
    return true;
}
