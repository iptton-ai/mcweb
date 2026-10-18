// 普通世界的探索与自选作品：独立于渲染的持久化边界。
import { state } from './state.js';
import { WORLD_WIDTH, WORLD_HEIGHT, WORLD_DEPTH } from './config.js';
export const LANDMARK_NAMES = { mine: '浅矿洞', tower: '旧石塔', camp: '林间营地' };
export const PROJECT_NAMES = { farm: '丰收农庄', lighthouse: '回家灯塔', lift: '矿井电梯' };
const point = (p) =>
    p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.z) &&
    p.x >= 0 &&
    p.x < WORLD_WIDTH &&
    p.y >= 0 &&
    p.y < WORLD_HEIGHT &&
    p.z >= 0 &&
    p.z < WORLD_DEPTH;
const short = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
export function resetAdventureData() {
    state.adventure = {
        v: 1,
        sites: [],
        discovered: [],
        markers: [],
        nextMarker: 1,
        target: 'home',
        armor: false,
        shield: false,
        project: null,
        projects: {},
        delivered: 0,
        harvests: 0,
    };
    state.player.shieldRaised = false;
}
export function adventureData() {
    if (!state.adventure) resetAdventureData();
    return state.adventure;
}
export function captureAdventureState() {
    return JSON.parse(JSON.stringify(adventureData()));
}
export function restoreAdventureState(raw) {
    resetAdventureData();
    if (!raw || typeof raw !== 'object') return;
    const a = state.adventure;
    a.sites = Array.isArray(raw.sites)
        ? raw.sites
              .filter((p) => LANDMARK_NAMES[p?.id] && point(p))
              .slice(0, 3)
              .map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z }))
        : [];
    a.discovered = [
        ...new Set(Array.isArray(raw.discovered) ? raw.discovered.filter((id) => LANDMARK_NAMES[id]) : []),
    ];
    a.markers = Array.isArray(raw.markers)
        ? raw.markers
              .filter(
                  (p) =>
                      point(p) &&
                      /^mark-\d+$/.test(p.id) &&
                      Number.isSafeInteger(Number(p.id.slice(5))) &&
                      Number(p.id.slice(5)) < 1e9,
              )
              .slice(0, 24)
              .map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, name: short(p.name, 24) || '我的路标' }))
        : [];
    a.nextMarker = Math.max(1, ...a.markers.map((p) => Number(p.id.slice(5)) + 1));
    a.target =
        raw.target === 'home' || [...a.sites, ...a.markers].some((p) => p.id === raw.target)
            ? raw.target
            : 'home';
    a.armor = raw.armor === true;
    a.shield = raw.shield === true;
    a.project = PROJECT_NAMES[raw.project] ? raw.project : null;
    for (const id of Object.keys(PROJECT_NAMES)) {
        const p = raw.projects?.[id];
        if (!point(p)) continue;
        a.projects[id] = {
            x: p.x,
            y: p.y,
            z: p.z,
            name: short(p.name, 32) || PROJECT_NAMES[id],
            explanation: short(p.explanation, 280),
            liftMoves: Number.isSafeInteger(p.liftMoves) ? Math.max(0, Math.min(1e9, p.liftMoves)) : 0,
            harvestStart: Math.max(0, Number(p.harvestStart) || 0),
            deliveredStart: Math.max(0, Number(p.deliveredStart) || 0),
        };
    }
    for (const key of ['delivered', 'harvests'])
        a[key] = Number.isSafeInteger(raw[key]) ? Math.max(0, Math.min(1e9, raw[key])) : 0;
    for (const p of Object.values(a.projects)) {
        p.harvestStart = Number.isSafeInteger(p.harvestStart)
            ? Math.min(a.harvests, p.harvestStart)
            : a.harvests;
        p.deliveredStart = Number.isSafeInteger(p.deliveredStart)
            ? Math.min(a.delivered, p.deliveredStart)
            : a.delivered;
    }
}

// 只在动力模块已提交真实平台位移之后记账。
export function recordLiftMovement(x, y, z) {
    if (state.levelRun || state.levelEdit || state.gameMode !== 'survival') return;
    const p = adventureData().projects.lift;
    if (p && Math.abs(x - p.x) <= 24 && Math.abs(z - p.z) <= 24 && Math.abs(y - p.y) <= 32)
        p.liftMoves = Math.min(1e9, (p.liftMoves || 0) + 1);
}
