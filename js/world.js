import { invalidateKineticCell } from './kinetic.js';
import { isLadderId, LADDER_BASE } from './config.js';
import { generateLandmarks } from './landmarks.js';
import { resetAdventureData, adventureData } from './adventureData.js';
import { onLifeBlockChanged, resetLifeData, queuePlantRefund, plantHasSupport } from './lifeData.js';
// ==================== world.js ====================

import { isToolId, BlockInfo, BED_DIRECTIONS, bedFacing, bedHalf, bedId, isBedId, BlockTypes, HANZI_ORE, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
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
    if (!Number.isInteger(type) || type<0 || type>255 || !BlockInfo[type] && type!==BlockTypes.AIR || BlockInfo[type]?.item || isToolId(type) || ![x,y,z].every(Number.isInteger)) return [];
    const previous = getBlock(x, y, z);
    if (previous === type) return [];
    invalidateKineticCell(x,y,z,previous);
    for (const field of ['handCrankIntent','handCrankPower']) {
        const use=state[field];
        if (use && use.x===x && use.y===y && use.z===z) state[field]=null;
    }
    onLifeBlockChanged(x,y,z,previous,type);
    const removed = [];
    const clearBed = (bx, by, bz) => {
        const id = getBlock(bx, by, bz);
        if (!isBedId(id)) return;
        const f = bedFacing(id), half = bedHalf(id), [dx, dz] = BED_DIRECTIONS[f];
        const ox = bx + dx * (half ? -1 : 1), oz = bz + dz * (half ? -1 : 1);
        const cells = [{x:bx,y:by,z:bz,id}];
        if (getBlock(ox, by, oz) === bedId(1-half, f)) cells.push({x:ox,y:by,z:oz,id:bedId(1-half,f)});
        for (const c of cells) {
            state.blocks[getBlockIndex(c.x,c.y,c.z)] = BlockTypes.AIR;
            removed.push(c);
            state.bedDirtyCells.push(c);
        }
    };
    if (isBedId(previous)) clearBed(x,y,z);
    state.blocks[getBlockIndex(x, y, z)] = type;
    if (!BlockInfo[type]?.solid || BlockInfo[type]?.customMesh) clearBed(x,y+1,z);
    const above=getBlock(x,y+1,z);
    if(!plantHasSupport(above,type)) {
        queuePlantRefund(x,y+1,z,above);
        setBlockSafe(x,y+1,z,BlockTypes.AIR);
        removed.push({x,y:y+1,z,id:above});
    }
    // 木梯背面贴墙：任意支撑移除路径都只清一次挂件并排入持久掉落。
    if (!BlockInfo[type]?.solid || BlockInfo[type]?.customMesh) {
        for (const [dx,dz,f] of [[0,1,0],[-1,0,1],[0,-1,2],[1,0,3]]) {
            const lx=x+dx,lz=z+dz,id=getBlock(lx,y,lz);
            if(id!==LADDER_BASE+f)continue;
            state.blocks[getBlockIndex(lx,y,lz)]=BlockTypes.AIR;
            const cell={x:lx,y,z:lz,id};removed.push(cell);state.bedDirtyCells.push(cell);
            if(!state.levelRun && !state.levelEdit) state.lifePendingDrops.push({x:lx+.5,y:y+.5,z:lz+.5,stack:{id:LADDER_BASE,count:1}});
        }
    }
    return removed;
}

// ---- 矿脉（2026-09-05 对齐参考版）：对 2×2×2 采样子格取一次哈希，命中即整格成矿 ----
// 深度分布照参考版/原版直觉：钻石深藏（y≤12，~1.4%）、铁中层（y≤30，~2.5%）、煤广布（y≤44，~3%）。
// 区间互不重叠（同一次哈希分段），石头深处按此表替换。
function oreAt(x, y, z) {
    const h = hash3(x >> 1, y >> 1, z >> 1, 4242 + seedBase());
    if (y <= 12 && h > 0.986) return BlockTypes.DIAMOND_ORE;
    if (y <= 30 && h > 0.930 && h <= 0.955) return BlockTypes.IRON_ORE;
    if (y <= 44 && h > 0.900 && h <= 0.930) return BlockTypes.COAL_ORE;
    if (y <= 44 && h > 0.890 && h <= 0.900) return HANZI_ORE; // 识字矿石（Edu M2）：~1% 独立分段，挖矿识字
    return BlockTypes.STONE;
}

export function generateWorld() {
    resetLifeData();
    resetAdventureData();
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
    // v2 浅池：靠近出生区域，水深一格，宽缓台阶岸边；v1 完全不走这里。
    if (state.generationVersion >= 2) {
        const cx = Math.floor(WORLD_WIDTH / 2) + 14 + Math.floor(hash2D(3, 7, s) * 6);
        const cz = Math.floor(WORLD_DEPTH / 2) + 8;
        const level = generateTerrainHeight(cx, cz);
        for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
            const r = Math.max(Math.abs(dx), Math.abs(dz));
            const x = cx + dx, z = cz + dz;
            const original = generateTerrainHeight(x,z);
            const top = r <= 4 ? level : level + Math.sign(original-level) * Math.min(r-4,Math.abs(original-level));
            for (let y = Math.min(original,top)-2; y <= Math.max(original,top)+1; y++) {
                setBlockSafe(x,y,z, y > top ? BlockTypes.AIR : y === top ? (r <= 3 ? BlockTypes.WATER : BlockTypes.GRASS) : y === top-1 ? BlockTypes.SAND : BlockTypes.DIRT);
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
    if (state.generationVersion >= 3) adventureData().sites = generateLandmarks(generateTerrainHeight, setBlockSafe);
}
