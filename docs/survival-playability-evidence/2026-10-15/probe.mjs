// 生存可玩性分析探针：只操作 Node 内存世界，不读写用户浏览器存档。
// 仓库根运行：node --import ./tests/gamelogic/_preload.mjs docs/survival-playability-evidence/2026-10-15/probe.mjs
import { freshWorld, state } from '../../../tests/gamelogic/kit.mjs';
import * as c from '../../../js/config.js';
import { generateWorld, generateTerrainHeight } from '../../../js/world.js';
import { setState, getUIState } from '../../../js/uiModal.js';
import { updateSurvivalStats } from '../../../js/playerLife.js';
import { updateDayNightCycle } from '../../../js/daynight.js';

const result = {
    date: '2026-10-15',
    method: '真实游戏逻辑，渲染及浏览器平台使用仓库现有垫片；不是浏览器试玩',
    config: {
        recipes: c.RECIPES.length,
        recipeOutputs: c.RECIPES.map(r => c.BlockInfo[r.out].name),
        doorId: c.DOOR_ITEM_ID,
        doorRecipe: c.RECIPES.some(r => r.out === c.DOOR_ITEM_ID),
        hotbarCount: c.HotbarBlocks.length,
        first9: c.HotbarBlocks.slice(0, 9).map(id => c.BlockInfo[id].name),
        foods: Object.entries(c.BlockInfo).filter(([, v]) => v.food)
            .map(([id, v]) => ({ id: Number(id), name: v.name, food: v.food })),
        registeredMaxId: Math.max(...Object.keys(c.BlockInfo).map(Number)),
    },
    terrain: [],
};
for (const seed of [1, 42, 2026]) {
    state.worldSeed = seed;
    generateWorld();
    let water = 0, minHeight = c.WORLD_HEIGHT, maxHeight = 0;
    for (const block of state.blocks) if (block === c.BlockTypes.WATER) water++;
    for (let x = 0; x < c.WORLD_WIDTH; x++) {
        for (let z = 0; z < c.WORLD_DEPTH; z++) {
            const h = generateTerrainHeight(x, z);
            minHeight = Math.min(minHeight, h);
            maxHeight = Math.max(maxHeight, h);
        }
    }
    result.terrain.push({ seed, water, minHeight, maxHeight });
}
freshWorld({ gameMode: c.GameModes.SURVIVAL });
Object.assign(state.player, { hunger: 20, air: 10, underwater: false, hungerTimer: 0, regenTimer: 0 });
setState('pause');
result.pauseBefore = { ui: getUIState(), hunger: state.player.hunger, time: state.time };
for (let i = 0; i < 2400; i++) {
    updateSurvivalStats(0.1);
    updateDayNightCycle(0.1);
}
result.pauseAfter240SimulationSeconds = { ui: getUIState(), hunger: state.player.hunger, time: state.time };
const evening = 1 - Math.acos(0.08) / (2 * Math.PI);
result.dayNight = {
    fullCycleSeconds: state.dayLength,
    firstNightAfterNewWorldSeconds: state.dayLength * (evening - 0.3),
    nightDurationSeconds: state.dayLength * Math.acos(0.08) / Math.PI,
};
console.log(JSON.stringify(result, null, 2));
