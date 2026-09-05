// ==================== world.js ====================

import { BlockTypes, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { state } from './state.js';

export function hash2D(x, y, seed = 0) {
    let h = x * 374761393 + y * 668265263 + seed * 97531;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h & 0x7fffffff) / 0x7fffffff;
}

// 三维哈希（矿脉采样用：对 2×2×2 子格取同一随机值，形成 2 格宽的短矿脉）
export function hash3(x, y, z, seed = 0) {
    let h = x * 374761393 + y * 217645177 + z * 668265263 + seed * 97531;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h & 0x7fffffff) / 0x7fffffff;
}

export function valueNoise(x, y, seed = 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const v00 = hash2D(ix, iy, seed);
    const v10 = hash2D(ix + 1, iy, seed);
    const v01 = hash2D(ix, iy + 1, seed);
    const v11 = hash2D(ix + 1, iy + 1, seed);
    return v00 * (1 - sx) * (1 - sy) + v10 * sx * (1 - sy) + v01 * (1 - sx) * sy + v11 * sx * sy;
}

export function fbm(x, y, octaves = 4, seed = 0) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxVal = 0;
    for (let i = 0; i < octaves; i++) {
        value += valueNoise(x * frequency, y * frequency, seed + i * 100) * amplitude;
        maxVal += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    return value / maxVal;
}

// 世界种子：进存档（saveGame.js），所有噪声都混入它——同一种子生成同一片地形，
// 不同存档槽的world各不相同（开新世界时 main.js 随机取种）
function seedBase() {
    return state.worldSeed | 0;
}

export function generateTerrainHeight(x, z) {
    const s = seedBase();
    const continentNoise = fbm(x * 0.008, z * 0.008, 4, 42 + s);
    const hillNoise = fbm(x * 0.03, z * 0.03, 3, 1337 + s);
    const detailNoise = valueNoise(x * 0.08, z * 0.08, 777 + s);
    const baseHeight = 28 + continentNoise * 22;
    const hillVariation = (hillNoise - 0.5) * 14;
    const detail = (detailNoise - 0.5) * 4;
    let h = baseHeight + hillVariation + detail;
    h = Math.max(3, Math.min(WORLD_HEIGHT - 8, h));
    return Math.floor(h);
}

export function generateTree(x, y, z) {
    const treeHeight = 4 + Math.floor(hash2D(x, z, 999 + seedBase()) * 3);
    const trunkType = hash2D(x, z, 555 + seedBase()) > 0.7 ? BlockTypes.LOG : BlockTypes.WOOD;
    for (let dy = 0; dy < treeHeight; dy++) {
        setBlockSafe(x, y + dy, z, trunkType);
    }
    const leafStart = treeHeight - 2;
    for (let dy = leafStart; dy <= treeHeight + 1; dy++) {
        const radius = dy >= treeHeight ? 1 : 2;
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (dx === 0 && dz === 0 && dy < treeHeight) continue;
                if (Math.abs(dx) === radius && Math.abs(dz) === radius && hash2D(x + dx, z + dz, 777) >
                    0.5) continue;
                const bx = x + dx;
                const bz = z + dz;
                const by = y + dy;
                if (bx >= 0 && bx < WORLD_WIDTH && bz >= 0 && bz < WORLD_DEPTH && by >= 0 && by <
                    WORLD_HEIGHT) {
                    if (state.blocks[getBlockIndex(bx, by, bz)] === BlockTypes.AIR) {
                        setBlockSafe(bx, by, bz, BlockTypes.LEAVES);
                    }
                }
            }
        }
    }
}

export function getBlockIndex(x, y, z) {
    return x + z * WORLD_WIDTH + y * WORLD_WIDTH * WORLD_DEPTH;
}

export function getBlock(x, y, z) {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) return BlockTypes
        .AIR;
    return state.blocks[getBlockIndex(x, y, z)];
}

export function setBlockSafe(x, y, z, type) {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) return;
    state.blocks[getBlockIndex(x, y, z)] = type;
}

// ---- 矿脉（2026-09-05 对齐参考版）：对 2×2×2 采样子格取一次哈希，命中即整格成矿 ----
// 深度分布照参考版/原版直觉：钻石深藏（y≤12，~1.4%）、铁中层（y≤30，~2.5%）、煤广布（y≤44，~3%）。
// 区间互不重叠（同一次哈希分段），石头深处按此表替换。
function oreAt(x, y, z) {
    const h = hash3(x >> 1, y >> 1, z >> 1, 4242 + seedBase());
    if (y <= 12 && h > 0.986) return BlockTypes.DIAMOND_ORE;
    if (y <= 30 && h > 0.930 && h <= 0.955) return BlockTypes.IRON_ORE;
    if (y <= 44 && h > 0.900 && h <= 0.930) return BlockTypes.COAL_ORE;
    return BlockTypes.STONE;
}

export function generateWorld() {
    state.blocks = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT * WORLD_DEPTH);
    const s = seedBase();
    const treePositions = [];
    for (let x = 0; x < WORLD_WIDTH; x++) {
        for (let z = 0; z < WORLD_DEPTH; z++) {
            const height = generateTerrainHeight(x, z);
            const forestNoise = fbm(x * 0.015, z * 0.015, 3, 555 + s);
            const isForest = forestNoise > 0.55;
            const treeChance = isForest ? 0.12 : 0.015;
            const hasTree = hash2D(x, z, 222 + s) < treeChance;
            if (hasTree && height > 8 && height < WORLD_HEIGHT - 10) {
                treePositions.push({ x, y: height, z });
            }
            // 温度噪声（低频大片）：高温 + 不过分低洼 = 沙漠（沙丘地貌，表面与浅层都是沙）
            const tempNoise = fbm(x * 0.006, z * 0.006, 3, 909 + s);
            const isDesert = tempNoise > 0.62 && height >= 15;
            for (let y = 0; y <= height; y++) {
                let blockType;
                if (y === 0) {
                    blockType = BlockTypes.BEDROCK;
                } else if (y < height - 4) {
                    blockType = oreAt(x, y, z); // 深层石头按矿脉表替换
                } else if (y < height) {
                    blockType = isDesert && y >= height - 3 ? BlockTypes.SAND : BlockTypes.DIRT;
                } else if (y === height) {
                    if (height < 16) {
                        blockType = BlockTypes.SAND; // 湖畔/海底
                    } else if (isDesert) {
                        blockType = BlockTypes.SAND; // 沙漠表面
                    } else if (height > 40 && hash2D(x, z, 888 + s) > 0.6) {
                        blockType = BlockTypes.SNOW; // 高山积雪
                    } else if (height > 36 && hash2D(x, z, 444 + s) > 0.7) {
                        blockType = BlockTypes.GRAVEL; // 山地碎石
                    } else {
                        blockType = BlockTypes.GRASS;
                    }
                } else {
                    blockType = BlockTypes.AIR;
                }
                setBlockSafe(x, y, z, blockType);
            }
            // 水填充
            if (height < 14) {
                for (let y = height + 1; y <= 14; y++) {
                    setBlockSafe(x, y, z, BlockTypes.WATER);
                }
            }
        }
    }
    // 生成树木（沙漠不长树：只在草方块/沙上长是旧规则，收紧为草方块——沙漠贴湖的沙面不再长树）
    for (const t of treePositions) {
        if (getBlock(t.x, t.y, t.z) === BlockTypes.GRASS) {
            if (t.y + 6 < WORLD_HEIGHT) {
                generateTree(t.x, t.y + 1, t.z);
            }
        }
    }
}
