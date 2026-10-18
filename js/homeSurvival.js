import { captureAdventureState, restoreAdventureState } from './adventureData.js';
import {resetLifeData} from './lifeData.js';
// 安家规则与存档字段：纯数据，无 DOM/渲染依赖。
import { BED_ITEM_ID, BlockInfo, BlockTypes, DOOR_ITEM_ID, FIRST_DAY_SECONDS, GameModes, HotbarBlocks, ItemTypes, ToolTypes, WORLD_WIDTH, WORLD_HEIGHT, WORLD_DEPTH } from './config.js';
import { getBlock } from './world.js';
import { isBedId, bedId } from './config.js';
import { state, isCreative } from './state.js';
export function defaultQuickbar() {
    return [ToolTypes.WOOD_AXE, ToolTypes.WOOD_PICKAXE, ToolTypes.WOOD_SWORD, BlockTypes.PLANKS,
        BlockTypes.TORCH, ItemTypes.APPLE, DOOR_ITEM_ID, BED_ITEM_ID, BlockTypes.CRAFTING_TABLE];
}
export function normalizeQuickbar(ids) {
    const defaults = defaultQuickbar();
    return defaults.map((id, i) => Array.isArray(ids) && HotbarBlocks.includes(ids[i]) ? ids[i] : id);
}
export function selectQuickbar(i) {
    const bar = state.player.quickbar = normalizeQuickbar(state.player.quickbar);
    if (!Number.isInteger(i) || i < 0 || i >= 9) return false;
    state.player.selectedSlot = HotbarBlocks.indexOf(bar[i]);
    return true;
}
export function assignQuickbar(i, id) {
    if (!Number.isInteger(i) || i < 0 || i >= 9 || !HotbarBlocks.includes(id)) return false;
    state.player.quickbar = normalizeQuickbar(state.player.quickbar);
    const old = state.player.quickbar.indexOf(id);
    if (old >= 0) state.player.quickbar[old] = state.player.quickbar[i];
    state.player.quickbar[i] = id;
    return true;
}
export function captureHomeState() {
    return { adventure: captureAdventureState(), generationVersion: state.generationVersion, homeBed: state.homeBed ? { ...state.homeBed } : null,
        survivalDifficulty: state.survivalDifficulty, survivalStarted: state.survivalStarted,
        firstDayRemaining: state.firstDayRemaining, starterWorkshopClaimed: state.starterWorkshopClaimed,
        homeGuideEnabled: state.homeGuideEnabled };
}
export function restoreHomeState(data = {}) {
    restoreAdventureState(data.adventure);
    state.generationVersion = [2,3].includes(data.generationVersion) ? data.generationVersion : 1;
    state.survivalDifficulty = data.survivalDifficulty === 'gentle' ? 'gentle' : 'adventure';
    const legacyEmptyCreative = data.gameMode === GameModes.CREATIVE && data.player?.inventory &&
        typeof data.player.inventory === 'object' && Object.keys(data.player.inventory).length === 0;
    state.survivalStarted = typeof data.survivalStarted === 'boolean' ? data.survivalStarted : !legacyEmptyCreative;
    state.firstDayRemaining = Number.isFinite(data.firstDayRemaining) ? Math.max(0, Math.min(FIRST_DAY_SECONDS, data.firstDayRemaining)) : 0;
    state.starterWorkshopClaimed = data.starterWorkshopClaimed === true;
    state.homeGuideEnabled = data.homeGuideEnabled !== false;
    const h = data.homeBed;
    state.homeBed = h && ['x','y','z','facing'].every(k => Number.isInteger(h[k])) &&
        h.x >= 0 && h.x < WORLD_WIDTH && h.y > 0 && h.y < WORLD_HEIGHT - 2 &&
        h.z >= 0 && h.z < WORLD_DEPTH && h.facing >= 0 && h.facing < 4 ? {x:h.x,y:h.y,z:h.z,facing:h.facing} : null;
    state.player.quickbar = normalizeQuickbar(data.player?.quickbar);
    state.readingPanels = {};
    state.bedDirtyCells = [];
}
export function resetHomeWorld() {
    resetLifeData();state.survivalRules='standard';
    restoreHomeState({ generationVersion: 3, survivalDifficulty: 'gentle', survivalStarted: false,
        firstDayRemaining: FIRST_DAY_SECONDS });
}
// 前八分钟有效游玩时间内日落停在傍晚；菜单阅读不消耗缓冲。
export function tickFirstDay(dt) {
    if (isCreative() || state.levelRun || state.levelEdit || state.firstDayRemaining <= 0) return;
    state.firstDayRemaining = Math.max(0, state.firstDayRemaining - dt);
    if (state.firstDayRemaining > 0) state.time = Math.min(state.time, state.dayLength * 0.70);
}
export function grantHomeStarter() {
    if (state.survivalStarted) return false;
    state.survivalStarted = true;
    const items = { [ToolTypes.WOOD_AXE]:1, [ToolTypes.WOOD_PICKAXE]:1, [ToolTypes.WOOD_SWORD]:1,
        [ItemTypes.APPLE]:5, [BlockTypes.TORCH]:8, [BlockTypes.WOOD]:6, [BlockTypes.WOOL]:3 };
    for (const [id,count] of Object.entries(items)) state.player.inventory[id] = (state.player.inventory[id] || 0) + count;
    selectQuickbar(0);
    return true;
}
export function getHomeGuide() {
    const inv = state.player.inventory;
    if (!state.homeGuideEnabled || isCreative() || state.levelRun || state.levelEdit) return '';
    const home = state.homeBed;
    if (home && getBlock(home.x, home.y, home.z) === bedId(0, home.facing)) {
        return '家已记住：按 E 做箱子、木锄和水桶，开始种田养羊；出门带食物火把，夜里回床边。';
    }
    let nearbyTable = false, nearbyBed = false;
    const px = Math.floor(state.player.x), py = Math.floor(state.player.y), pz = Math.floor(state.player.z);
    for (let x = px - 4; x <= px + 4; x++) for (let y = py - 2; y <= py + 3; y++) for (let z = pz - 4; z <= pz + 4; z++) {
        const block = getBlock(x, y, z);
        nearbyTable ||= block === BlockTypes.CRAFTING_TABLE;
        nearbyBed ||= isBedId(block);
    }
    if (nearbyBed) return '下一步：对准身边的小床，右键（纯键盘 X）把这里设为家。';
    if (inv[BED_ITEM_ID] > 0) return '下一步：把小床放在两格平地，右键设为家。';
    if (!nearbyTable) {
        if (inv[BlockTypes.CRAFTING_TABLE] > 0) return '下一步：选中背包里的工作台，把它放在身边的地上。';
        if ((inv[BlockTypes.PLANKS] || 0) >= 4) return '下一步：按 E，用 4 木板制作工作台，然后把它放在身边。';
        return '下一步：按 E 把原木变成木板，用 4 木板制作工作台；如果已经放过工作台，可以回到它旁边继续。';
    }
    if ((inv[BlockTypes.PLANKS] || 0) < 3) return `工作台就在附近。下一步：再做木板，做床还差 ${3 - (inv[BlockTypes.PLANKS] || 0)} 木板。`;
    if ((inv[BlockTypes.WOOL] || 0) < 3) return `下一步：做床还差 ${3 - (inv[BlockTypes.WOOL] || 0)} 羊毛；检查开局赠品或寻找绵羊。`;
    return '下一步：在工作台旁按 E，用 3 羊毛和 3 木板制作小床；6 木板可做门。';
}
