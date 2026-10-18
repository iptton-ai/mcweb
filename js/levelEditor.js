import { resetAdventureData } from './adventureData.js';
import {resetLifeData} from './lifeData.js';
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
    input: './input.js',                 // clearKeys（进入退出流程即停用残留按键/鼠标按住态）
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
let editorEntryError = '';
export function getEditorEntryError() { return editorEntryError; }

export async function enterLevelEditor(card = null, options = {}) {
    editorEntryError = '';
    if (state.temporaryWorldTransition) return false;
    const transition = {};
    state.temporaryWorldTransition = transition;
    try { return await enterLevelEditorImpl(card, options); }
    finally { if (state.temporaryWorldTransition === transition) state.temporaryWorldTransition = null; }
}

async function enterLevelEditorImpl(card = null, { name, templateName } = {}) {
    if (state.levelRun || state.levelEdit) return false; // 已有临时世界会话时不能再清零世界

    // 1) 当前世界强制落盘（必须在挂 state.levelEdit 之前——saveGame 入口闸见 saveGame.js）
    {
        const sg = await modPromise('saveGame');
        let saved = false;
        try { saved = sg?.saveGame?.() === true; } catch { }
        if (!saved) {
            editorEntryError = '❌ 当前世界保存失败，请释放存储空间后再进入编辑器';
            void tip(editorEntryError);
            return false;
        }
        try { (await modPromise('buildQueue'))?.clearBuildQueue?.(); } catch { }
    }

    // 2) 锁题快照：编辑世界占住嵌入区坐标，清空全表防串扰，退编辑器时原样恢复
    const ek = await modPromise('eduKeypad');
    let lockSnapshot = [];
    try { lockSnapshot = ek?.listAuthoredLocks?.() || []; } catch { }
    try { ek?.restoreAuthoredLocks?.([]); } catch { }

    // 3) 仅「继续编辑」继承草稿身份；模板即使带 draft 标记，也应另开一份自己的稿。
    const continuingDraft = !!card?.meta?.draft && !templateName;
    const lw = await modPromise('levelWorkshop');
    const sourceDraftId = continuingDraft ? lw?.levelCardId?.(card) : null;
    let sourceSessionOnly = false;
    let persistentDraftId = null;
    if (sourceDraftId) {
        try {
            const row = (await lw?.listLevelCards?.())?.find((item) => item.id === sourceDraftId);
            sourceSessionOnly = row?.sessionOnly === true;
            if (!sourceSessionOnly || await lw.getPersistentLevelCard(sourceDraftId)) {
                persistentDraftId = sourceDraftId;
            }
        } catch { }
    }
    // 挂上 state 后 saveGame 全线拒写；持久备份与当前会话稿分开记，防降级写误删备份。
    const ed = {
        name: String(name ?? card?.name ?? '未命名关卡').trim() || '未命名关卡',
        templateName: String(templateName || ''),
        draftCard: continuingDraft ? card : null,
        lastDraftId: sourceDraftId,
        lastDraftSessionOnly: sourceSessionOnly,
        persistentDraftId,
        rules: card?.rules ? { ...card.rules } : undefined,
        lockSnapshot,
        examSnapshot: ek?.getExamIntent?.() || false,
        draftSaveError: '',
        autosaveT: 0,
        placing: null,
        restore: { time: state.time, gameMode: state.gameMode },
    };
    state.levelEdit = ed;
    // 编辑源卡的考核锁初始化到同一意图源，之后作者面板切换仍可即时生效。
    ek?.setExamIntent?.(card?.rules ? card.rules.lockAIHelp === false : false);

    // 4) 临时编辑世界：整体清零 + 地基层（闯关世界同款清零路径）
    resetLifeData();
    resetAdventureData();
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
            ek?.setExamIntent?.(ed.examSnapshot);
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
                // 缺省兼容旧正式卡；显式零次必须保留，避免续编绕过双通过。
                const passes = Math.max(0, Math.min(2, (q.meta?.verifiedPasses ?? (card.meta?.draft ? 0 : 2)) | 0));
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
        p.onGround = false;
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
function draftFailure(ed, reason, silent) {
    ed.draftSaveError = String(reason || '未知错误');
    if (!silent) void tip(`⚠️ 暂时存不了草稿：${ed.draftSaveError}`);
    return null;
}

export async function saveEditorDraft({ silent = false } = {}) {
    const ed = state.levelEdit;
    if (!ed || ed.exiting) return null;
    // 同一会话串行保存；退出存稿等待已在途的自动存稿，避免旧内容删除新草稿。
    const previous = ed.draftSavePending;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    ed.draftSavePending = pending;
    try {
        await previous;
        const lw = await modPromise('levelWorkshop');
        if (!lw?.buildLevelCard || !lw?.saveLevelCard) {
            return draftFailure(ed, '草稿保存模块不可用，请稍后重试', silent);
        }
        if (state.levelEdit !== ed) return draftFailure(ed, '编辑会话已切换，请重新保存', silent);
        let author = '我';
        try { author = localStorage.getItem('mcweb.level.author') || '我'; } catch { }
        const card = await lw.buildLevelCard({ name: ed.name, author, draft: true, rules: ed.rules });
        if (!card || card.error) {
            return draftFailure(ed, card?.error || '未能生成草稿卡', silent);
        }
        // 时间戳沿用首稿；内容 hash 改变时先写新卡、再删旧 id，保留单条草稿身份。
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
        if (state.levelEdit !== ed) return draftFailure(ed, '编辑会话已切换，请重新保存', silent);
        const saved = await lw.saveLevelCard(card, thumbBlob);
        if (!saved || !saved.ok) {
            return draftFailure(ed, saved?.error || '草稿保存失败：存储不可用，请检查存储空间后重试', silent);
        }
        const obsoleteIds = new Set();
        // 持久写成功才可替换持久旧稿；会话写成功只替换上一个会话版本。
        if (!saved.sessionOnly && ed.persistentDraftId && ed.persistentDraftId !== saved.id) {
            obsoleteIds.add(ed.persistentDraftId);
        }
        if (ed.lastDraftSessionOnly && ed.lastDraftId && ed.lastDraftId !== saved.id) {
            // 会话清理一律不碰磁盘；持久旧稿只能由上面的成功写分支替换。
            lw.deleteSessionLevelCard(ed.lastDraftId);
        }
        for (const id of obsoleteIds) {
            try { await lw.deleteLevelCard?.(id); } catch { }
        }
        if (!saved.sessionOnly) ed.persistentDraftId = saved.id;
        ed.lastDraftId = saved.id;
        ed.lastDraftSessionOnly = !!saved.sessionOnly;
        ed.draftCard = card;
        ed.draftSaveError = saved.sessionOnly
            ? `${saved.storageError || '持久存储不可用'}，最新草稿仅本次会话可用，刷新或关闭页面会丢失这次修改。继续编辑可稍后重试保存。`
            : '';
        if (!silent) void tip(`💾 草稿已保存「${ed.name}」${saved.sessionOnly ? '（仅本次会话，刷新会丢失这次修改）' : '（关卡列表可继续编辑）'}`);
        return card;
    } catch (error) {
        return draftFailure(ed, `草稿保存失败：${error?.message || String(error) || '未知错误'}`, silent);
    } finally {
        release();
        if (ed.draftSavePending === pending) ed.draftSavePending = null;
    }
}

// ==================== 退编辑器 ====================

// 退编辑器：持久末稿成功后恢复原世界；保存失败保留编辑世界，等待继续或明确放弃。
// toTitle=false 回到游戏（切世界守卫路径用，main.js 会再接手自己的编排）。
export async function exitLevelEditor({ saveDraft = true, toTitle = true } = {}) {
    const ed = state.levelEdit;
    if (!ed) return false;
    if (ed.exitPending) {
        // 显式不存稿退出可结算已显示的选择，也可在末稿仍在途时提前表明放弃意图。
        if (!saveDraft) {
            ed.discardExitRequested = true;
            resolveEditorExitDecision(true);
        }
        return ed.exitPending;
    }
    // saveDraft:false 只是不追加末稿，已开始的保存仍须在切世界前完成。
    // 同步封住新保存入口，并把并发退出合并成一次恢复，防旧退出覆盖下一会话。
    const lastSave = saveDraft ? saveEditorDraft({ silent: true }) : ed.draftSavePending;
    ed.exiting = true;
    ed.discardExitRequested = !saveDraft;
    try { mod('input')?.clearKeys?.(); } catch { }
    syncEditorPointerPolicy();
    let pending;
    pending = (async () => {
        try {
            try { (await modPromise('input'))?.clearKeys?.(); } catch { }
            let card = null;
            try { card = await lastSave; }
            catch (error) { ed.draftSaveError = `草稿保存失败：${error?.message || String(error)}`; }
            if (state.levelEdit !== ed) return false;
            if (saveDraft && !ed.discardExitRequested && (!card || ed.lastDraftSessionOnly)) {
                const reason = ed.draftSaveError || '末稿未能保存，请继续编辑后重试，或明确放弃未保存的修改。';
                const discard = await awaitEditorExitDecision(ed, reason);
                if (!discard && !ed.discardExitRequested) return false;
            }
            return await restoreEditorWorld(ed, toTitle);
        } finally {
            if (ed.exitPending === pending) ed.exitPending = null;
            ed.exiting = false;
            ed.discardExitRequested = false;
            // 继续编辑时不改 UI 状态（例如 pause）；只解除退出守卫并恢复当前指针策略。
            if (state.levelEdit === ed) syncEditorPointerPolicy();
        }
    })();
    ed.exitPending = pending;
    return pending;
}

function syncEditorPointerPolicy() {
    try { mod('uiModal')?.syncPointerPolicy?.(); } catch { }
}

async function awaitEditorExitDecision(ed, reason) {
    let resolve;
    const decision = new Promise(done => { resolve = done; });
    const prompt = { reason, resolve };
    ed.exitPrompt = prompt;
    state.editorExitOpen = true;
    syncEditorPointerPolicy();
    const ui = await modPromise('ui');
    // 等待模块期间可能有程序化显式放弃或继续，不能再把过时选择框弹出来。
    if (state.levelEdit !== ed || ed.exitPrompt !== prompt) return decision;
    let shown = false;
    try { shown = await ui?.openEditorExitDialog?.(reason) === true; } catch { }
    if (ed.exitPrompt !== prompt) {
        try { ui?.closeEditorExitDialog?.(); } catch { }
        return decision;
    }
    if (!shown) {
        void tip(`⚠️ ${reason} 退出选择框暂不可用，已保留修改，请继续编辑后重试。`);
        resolveEditorExitDecision(false);
    }
    return decision;
}

// UI 的继续/Esc/Q 传 false，明确放弃按钮传 true。无待决框时迟到点击无效。
export function resolveEditorExitDecision(discard = false) {
    const ed = state.levelEdit;
    const prompt = ed?.exitPrompt;
    if (!prompt) return false;
    ed.exitPrompt = null;
    state.editorExitOpen = false;
    try { mod('ui')?.closeEditorExitDialog?.(); } catch { }
    syncEditorPointerPolicy();
    prompt.resolve(discard === true);
    return true;
}

async function restoreEditorWorld(ed, toTitle) {
    // 在摘守卫前加载完恢复所需模块；摘守卫到原世界恢复之间不再 await，防下一会话插入。
    const [ek, rc, sg, w, um] = await Promise.all(
        ['eduKeypad', 'recording', 'saveGame', 'world', 'uiModal'].map(modPromise));
    if (state.levelEdit !== ed) return false;
    try { ek?.restoreAuthoredLocks?.(ed.lockSnapshot); } catch { }
    try {
        if (rc?.isLevelOwnedRecording?.()) rc.stopRecording?.();
    } catch { }
    // 恢复进关前时间与模式（loadGame 成功后会被存档值覆盖，这里是读档失败兜底）
    if (ed.restore) {
        if (typeof ed.restore.time === 'number') state.time = ed.restore.time;
        if (ed.restore.gameMode) state.gameMode = ed.restore.gameMode;
    }
    state.levelEdit = null;
    ek?.setExamIntent?.(ed.examSnapshot);
    let restored = false;
    try { restored = !!sg?.loadGame?.(state.saveSlot); } catch { }
    if (!restored) {
        try {
            if (w?.generateWorld) w.generateWorld();
        } catch { }
    }
    try { um?.setState?.(toTitle ? 'title' : 'playing'); } catch { }
    return true;
}

// ==================== 每帧驱动（main.js gameLoop 调） ====================

export function tickLevelEditor(dt) {
    const ed = state.levelEdit;
    if (!ed) return;
    // 时间锁正午：tick 每帧写回（编辑器要恒定亮堂的施工光；也顺带压掉夜间刷怪）
    state.time = state.dayLength / 2;
    if (ed.exiting) return; // 保存/选择待决时仍锁正午，但不启动额外自动存稿。
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
    if (state.editorExitOpen || state.levelEdit?.exiting) return false;
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
    const editSession = state.levelEdit;
    const blocks = state.blocks;
    if (state.editorExitOpen || editSession?.exiting) return false;
    const pf = getPrefab(prefabId);
    if (!pf || !hit) return false;
    const { cells, error } = buildPrefabCells(pf);
    if (error) {
        void tip(`⚠️ 组件几何错误：${error}`);
        return false;
    }
    const origin = prefabOrigin(pf, hit);
    const w = await modPromise('world');
    if (!w?.setBlockSafe || state.blocks !== blocks || state.levelEdit !== editSession
        || state.editorExitOpen || editSession?.exiting) return false;
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
