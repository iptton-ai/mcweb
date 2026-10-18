// 仅第三版地形调用；树木生成后铺可步行道路与缓坡。
import { BlockTypes as B, LADDER_BASE, WORLD_HEIGHT } from './config.js';
export function generateLandmarks(height, put) {
    const hub = { x: 128, y: height(128, 128), z: 128 };
    const level = (x, z, y, surface = B.GRAVEL) => {
        for (let k = 1; k <= y; k++) put(x, k, z, k === y ? surface : B.STONE);
        for (let k = y + 1; k < WORLD_HEIGHT; k++) put(x, k, z, B.AIR);
    };
    for (let x = 125; x <= 131; x++) for (let z = 125; z <= 131; z++) level(x, z, hub.y, B.GRASS);
    const sites = [];
    for (const [id, dx, dz] of [
        ['mine', 0, -1],
        ['tower', 1, 0],
        ['camp', -1, 0],
    ]) {
        let y = hub.y;
        for (let i = 4; i <= 48; i++) {
            const x = 128 + dx * i,
                z = 128 + dz * i;
            // 末六格道路与9×9地标地基持平，避免地基覆盖台阶后留下两格高墙。
            if (i <= 42 && i % 3 === 0) y += Math.sign(height(x, z) - y);
            for (let w = -1; w <= 1; w++) level(x + dz * w, z + dx * w, y);
        }
        sites.push({ id, x: 128 + dx * 48, y: y + 1, z: 128 + dz * 48 });
    }
    const mine = sites[0],
        C = mine.y - 1,
        depth = Math.max(6, C - 27),
        length = depth * 3 + 3;
    const columns = new Map();
    for (let i = 0; i <= length; i++) {
        const x = mine.x + Math.max(0, i - 24),
            z = mine.z - Math.min(24, i);
        const floor = C - Math.min(depth, Math.floor(i / 3));
        const radius = i === length ? 2 : 1;
        for (let dx = -radius; dx <= radius; dx++)
            for (let dz = -radius; dz <= radius; dz++) {
                const key = `${x + dx},${z + dz}`,
                    old = columns.get(key);
                columns.set(key, {
                    x: x + dx,
                    z: z + dz,
                    floor: Math.min(old?.floor ?? floor, floor),
                    ceiling: Math.max(old?.ceiling ?? floor + 4, floor + 4),
                });
            }
    }
    for (const { x, z, floor, ceiling } of columns.values()) {
        put(x, floor - 1, z, B.STONE);
        put(x, floor, z, B.COBBLESTONE);
        for (let y = floor + 1; y < ceiling; y++) put(x, y, z, B.AIR);
        put(x, ceiling, z, B.STONE);
    }
    // 洞门与火把标明路线；矿石在侧墙，不占唯一返程地板。
    for (let x = 126; x <= 130; x++)
        for (let y = C + 1; y <= C + 4; y++) {
            if (x === 126 || x === 130 || y === C + 4) put(x, y, 80, B.COBBLESTONE);
        }
    for (let i = 6; i <= length; i += 6) {
        const x = 128 + Math.max(0, i - 24),
            z = 80 - Math.min(24, i),
            f = C - Math.min(depth, Math.floor(i / 3));
        put(x, f + 1, z, B.TORCH);
        put(x - (i < 24 ? 2 : 0), f + 1, z - (i >= 24 ? 2 : 0), i % 12 ? B.COAL_ORE : B.IRON_ORE);
    }
    const tower = sites[1],
        T = tower.y - 1;
    for (let x = 172; x <= 180; x++) for (let z = 124; z <= 132; z++) level(x, z, T, B.COBBLESTONE);
    for (let y = T + 1; y <= T + 8; y++)
        for (let x = 172; x <= 180; x++)
            for (let z = 124; z <= 132; z++) {
                const wall = x === 172 || x === 180 || z === 124 || z === 132;
                if ((wall && y <= T + 6) || y === T + 7 || (wall && y === T + 8)) put(x, y, z, B.COBBLESTONE);
            }
    for (let y = T + 1; y <= T + 3; y++) for (let z = 127; z <= 129; z++) put(172, y, z, B.AIR);
    for (let y = T + 1; y <= T + 9; y++) put(176, y, 125, y <= T + 8 ? LADDER_BASE : B.AIR);
    for (let y = T + 8; y <= T + 10; y++)
        for (let x = 175; x <= 177; x++) for (let z = 126; z <= 128; z++) put(x, y, z, B.AIR);
    put(179, T + 8, 131, B.TORCH);
    const camp = sites[2],
        F = camp.y - 1;
    for (let x = 76; x <= 84; x++) for (let z = 124; z <= 132; z++) level(x, z, F, B.GRASS);
    for (const x of [76, 83])
        for (const z of [124, 131]) for (let y = F + 1; y <= F + 3; y++) put(x, y, z, B.WOOD);
    for (let x = 76; x <= 83; x++) for (let z = 124; z <= 127; z++) put(x, F + 4, z, B.PLANKS);
    put(77, F + 1, 125, B.CRAFTING_TABLE);
    put(82, F + 1, 125, B.FURNACE);
    put(77, F + 1, 130, B.TORCH);
    put(82, F + 1, 130, B.TORCH);
    return sites;
}
