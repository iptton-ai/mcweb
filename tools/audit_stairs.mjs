// ==================== tools/audit_stairs.mjs ====================
// 全量楼梯净空审计：对 assets/levels/ 全部官方卡（门全开、不看锁），
// 用真实跳跃物理逐一检查所有「+1 台阶」能否爬上去——
//   跳上 1 格 = 起跳点头顶 2 格可通行 且 落点头顶 2 格可通行（顶头即 vy 归零）；
//   同层走   = 落点头顶 1 格可通行。
// 对「爬不上去的台阶」再区分它是不是死路：若落点仍可经其它路径到达则无碍；
// 若落点在「不考虑该台阶的净空约束时」可达、考虑后不可达 → 真实玩家上不去的地方。
// 用法：node tools/audit_stairs.mjs
import { readFileSync } from 'node:fs';
import { BlockTypes, BlockInfo, isDoorId, doorOpen } from '../js/config.js';
import { decodeRegionBlocks } from '../js/levelWorkshop.js';

const key3 = (x, y, z) => `${x},${y},${z}`;
const H4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const index = JSON.parse(readFileSync(new URL('../assets/levels/index.json', import.meta.url), 'utf8'));
const list = (index.levels || []).map((e) => e.file);

function makeView(card) {
    const dec = decodeRegionBlocks(card);
    const r = card.region;
    const get = (x, y, z) => {
        if (x < 0 || y < 0 || z < 0 || x >= r.w || y >= r.h || z >= r.d) return BlockTypes.AIR;
        return dec.blocks[x + z * r.w + y * r.w * r.d];
    };
    return { get, r };
}

function makePhysics(card) {
    const { get, r } = makeView(card);
    const inB = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < r.w && y < r.h && z < r.d;
    const passable = (x, y, z) => {
        const id = get(x, y, z);
        if (isDoorId(id)) return true; // 审计门全开（含锁着的门）
        const info = BlockInfo[id];
        return !info || !info.solid;
    };
    const solid = (x, y, z) => {
        const info = BlockInfo[get(x, y, z)];
        return !!(info && info.solid);
    };
    const water = (x, y, z) => get(x, y, z) === BlockTypes.WATER;
    const standable = (x, y, z) => passable(x, y, z) && solid(x, y - 1, z);
    const node = (x, y, z) => inB(x, y, z) && (water(x, y, z) || standable(x, y, z));
    const fallTarget = (x, y0, z) => {
        for (let y = y0; y >= 0; y--) {
            if (!passable(x, y, z)) return null;
            if (water(x, y, z) || solid(x, y - 1, z)) return [x, y, z];
        }
        return null;
    };
    return { get, r, inB, passable, solid, water, node, standable, fallTarget };
}

function flood(card, start, strict) {
    const ph = makePhysics(card);
    const { r, node, water, passable, standable, fallTarget } = ph;
    const seen = new Set();
    const stack = [];
    const seed = (x, y, z) => {
        const t = node(x, y, z) ? [x, y, z] : fallTarget(x, y, z);
        if (t) { const k = key3(...t); if (!seen.has(k)) { seen.add(k); stack.push(t); } }
    };
    seed(start.x, start.y, start.z);
    while (stack.length) {
        const [x, y, z] = stack.pop();
        if (water(x, y, z)) {
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
                const nx = x + dx, ny = y + dy, nz = z + dz;
                if (!ph.inB(nx, ny, nz) || !passable(nx, ny, nz)) continue;
                if (water(nx, ny, nz) || standable(nx, ny, nz)) {
                    const k = key3(nx, ny, nz);
                    if (!seen.has(k)) { seen.add(k); stack.push([nx, ny, nz]); }
                }
            }
            continue;
        }
        if (!passable(x, y + 1, z)) continue;
        for (const [dx, dz] of H4) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= r.w || nz >= r.d) continue;
            for (const ny of [y, y + 1]) {
                if (ny >= r.h) continue;
                if (strict) {
                    if (!passable(nx, ny + 1, nz)) continue;
                    if (ny === y + 1 && !passable(x, y + 2, z)) continue;
                }
                if (node(nx, ny, nz)) {
                    const k = key3(nx, ny, nz);
                    if (!seen.has(k)) { seen.add(k); stack.push([nx, ny, nz]); }
                }
            }
            for (const dist of [2, 3]) {
                for (const dy of [0, 1]) {
                    const fy = y + dy;
                    if (fy >= r.h) continue;
                    if (strict && dy === 1 && !passable(x, y + 2, z)) continue;
                    const ex = x + dist * dx, ez = z + dist * dz;
                    if (ex < 0 || ez < 0 || ex >= r.w || ez >= r.d) continue;
                    let clear = true;
                    for (let m = 1; m < dist && clear; m++) {
                        const mx = x + m * dx, mz = z + m * dz;
                        clear = passable(mx, fy, mz) && (fy + 1 >= r.h || passable(mx, fy + 1, mz));
                    }
                    if (!clear) continue;
                    if (strict && dy === 1 && fy + 1 < r.h && !passable(ex, fy + 1, ez)) continue;
                    if (node(ex, fy, ez)) {
                        const k = key3(ex, fy, ez);
                        if (!seen.has(k)) { seen.add(k); stack.push([ex, fy, ez]); }
                    }
                }
            }
            const ft = fallTarget(nx, y - 1, z);
            if (ft) {
                const k = key3(ft[0], ft[1], ft[2]);
                if (!seen.has(k)) { seen.add(k); stack.push(ft); }
            }
        }
    }
    return seen;
}

const audit = (label, card) => {
    const start = card.flags.start;
    const ph = makePhysics(card);
    const { get, passable, solid, standable, node } = ph;
    const loose = flood(card, start, false);
    const strict = flood(card, start, true);
    const lost = [...loose].filter((k) => !strict.has(k)).map((k) => k.split(',').map(Number));
    // 分类：爬不上去的台阶顶（有相邻 -1 台阶、且落点头顶可站=非爬行缝）vs 爬行缝（头顶被压，本来就站不了人）
    const blockedClimbs = [];
    const crawlCells = [];
    for (const [x, y, z] of lost) {
        let isStepTop = false;
        for (const [dx, dz] of H4) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= ph.r.w || nz >= ph.r.d) continue;
            if (solid(nx, y - 1, nz) && passable(nx, y, nz) && standable(nx, y - 1, nz) === false) continue;
            if (node(nx, y - 1, nz)) { isStepTop = true; break; } // 有一个低一格的邻格可站=这是台阶顶
        }
        if (passable(x, y + 1, z)) (isStepTop ? blockedClimbs : crawlCells).push([x, y, z]);
        else crawlCells.push([x, y, z]);
    }
    console.log(`${blockedClimbs.length ? '✗' : '✓'} ${label}: 宽松=${loose.size} 严格=${strict.size} 爬不上去的台阶顶=${blockedClimbs.length} 爬行缝格=${crawlCells.length}（1 格矮缝，真人本就进不去，无害）`);
    for (const [x, y, z] of blockedClimbs.slice(0, 12)) {
        console.log(`    台阶顶 (${x},${y},${z}) 此格=${nameof(get(x, y, z))} 头顶=${nameof(get(x, y + 1, z))} 头顶2=${nameof(get(x, y + 2, z))}`);
    }
    // 差集里所有「可站立」（头顶净空）的格子都列出来人工过目——理论上应与台阶顶并集
    const standableLost = lost.filter(([x, y, z]) => passable(x, y + 1, z));
    if (standableLost.length > blockedClimbs.length) {
        for (const [x, y, z] of standableLost.slice(0, 20)) {
            console.log(`    ? 可站差集格 (${x},${y},${z}) 此格=${nameof(get(x, y, z))} 脚下=${nameof(get(x, y - 1, z))} 头顶=${nameof(get(x, y + 1, z))}`);
        }
    }
    return blockedClimbs.length;
};

function nameof(id) {
    if (id === BlockTypes.AIR) return 'AIR';
    if (isDoorId(id)) return 'DOOR';
    const entries = Object.entries(BlockTypes).filter(([, v]) => v === id);
    return entries.length ? entries[0][0] : `id${id}`;
}

let total = 0;
for (const f of list) {
    const card = JSON.parse(readFileSync(new URL(`../assets/levels/${f}`, import.meta.url), 'utf8'));
    total += audit(card.name, card);
}
console.log(total === 0 ? '\n全部关卡无「爬不上去」的台阶' : `\n共 ${total} 处待处理`);
