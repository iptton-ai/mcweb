// ==================== chunk.js ====================

import * as THREE from 'three';
import { BlockInfo, BlockTypes, CHUNK_SIZE, MAX_TORCH_LIGHTS, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH, FACING_NORMALS, doorHalf, gearFacing, gearJammed, gearManual, gearPowered, isDoorId, isGearId, isLampLitId, isLeverId, leverFacing, leverOn } from './config.js';
import { state } from './state.js';
import { scene } from './engine.js';
import { atlasTexture, getUVForFace, getDoorTileTexture } from './textures.js';
import { doorSlabTransform } from './door.js';
import { getBlock } from './world.js';

// ==================== 区块渲染 ====================
export function isTransparent(blockType) {
    return BlockInfo[blockType]?.transparent || blockType === BlockTypes.AIR || blockType === BlockTypes.WATER ||
        blockType === BlockTypes.GLASS || blockType === BlockTypes.LEAVES;
}

export function isCustomMesh(blockType) {
    return !!BlockInfo[blockType]?.customMesh;
}

// ==================== 道具网格（火把/花） ====================
export const propMeshCache = new Map();

export function createPropTexture(drawFn) {
    const cnv = document.createElement('canvas');
    cnv.width = 16;
    cnv.height = 16;
    const ctx = cnv.getContext('2d');
    drawFn(ctx);
    const tex = new THREE.CanvasTexture(cnv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

export function createCrossPlanes(texture) {
    const group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
    });
    for (let i = 0; i < 2; i++) {
        const plane = new THREE.Mesh(geo, mat);
        plane.rotation.y = Math.PI / 4 + i * Math.PI / 2;
        plane.position.y = 0.5;
        group.add(plane);
    }
    return group;
}

export function getPropMesh(blockType) {
    if (propMeshCache.has(blockType)) return propMeshCache.get(blockType).clone();
    let mesh = null;
    if (blockType === BlockTypes.TORCH) {
        const group = new THREE.Group();
        const stickMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2a });
        const flameMat = new THREE.MeshLambertMaterial({
            color: 0xffb830,
            emissive: 0xff9820,
            emissiveIntensity: 1.4,
        });
        const stick = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), stickMat);
        stick.position.y = 0.275;
        const flame = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.18), flameMat);
        flame.position.y = 0.64;
        group.add(stick);
        group.add(flame);
        mesh = group;
    } else if (blockType === BlockTypes.FLOWER) {
        const tex = createPropTexture((ctx) => {
            ctx.clearRect(0, 0, 16, 16);
            ctx.fillStyle = '#3d7a2a';
            ctx.fillRect(7, 8, 2, 8);
            ctx.fillRect(5, 10, 2, 2);
            ctx.fillRect(9, 11, 2, 2);
            ctx.fillStyle = '#e04a5a';
            ctx.fillRect(5, 1, 2, 3);
            ctx.fillRect(9, 1, 2, 3);
            ctx.fillRect(4, 3, 2, 2);
            ctx.fillRect(10, 3, 2, 2);
            ctx.fillStyle = '#f8d840';
            ctx.fillRect(6, 3, 4, 3);
        });
        mesh = createCrossPlanes(tex);
    } else if (isDoorId(blockType)) {
        // 门：3/16 格厚的薄片板，朝向/开合由方块 ID 决定（编码见 config.js）
        const { w, d, ox, oz } = doorSlabTransform(blockType);
        const mat = new THREE.MeshLambertMaterial({
            map: getDoorTileTexture(doorHalf(blockType)),
            transparent: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
        });
        const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), mat);
        slab.position.set(ox, 0.5, oz); // 道具原点在格底面中心，门板占满整格高
        const group = new THREE.Group();
        group.add(slab);
        mesh = group;
    } else if (isGearId(blockType)) {
        mesh = buildGearMesh(blockType);
    } else if (isLeverId(blockType)) {
        mesh = buildLeverMesh(blockType);
    }
    if (mesh) propMeshCache.set(blockType, mesh);
    return mesh ? mesh.clone() : null;
}

// 把「贴地朝向」构建的道具组摆到挂靠位：facing 见 config.js（0贴地 1贴顶 2..5四壁），
// t 为道具厚度。局部原点 = 格底面中心（addPropAt 会把整组摆到 (x+0.5, y, z+0.5)）。
function orientMounted(mounted, facing, t) {
    const [nx, ny, nz] = FACING_NORMALS[facing];
    if (ny === 1) {
        mounted.position.set(0, t / 2, 0); // 贴地：道具底面贴格底
    } else if (ny === -1) {
        mounted.rotation.x = Math.PI; // 贴顶：翻转后底面贴格顶
        mounted.position.set(0, 1 - t / 2, 0);
    } else {
        // 壁挂：+Y 法线旋转到墙法线，道具中心抬到格中部，贴靠面与墙面齐平
        mounted.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(nx, ny, nz),
        );
        mounted.position.set(0, 0.5, 0);
    }
}

// 齿轮：轮体 + 8 齿 + 轴心。转动中轴心泛橙光；卡死（与相邻齿轮面对面顶死）
// 轴心变红且不转。转向（±1）由 machinery.js 的转向表驱动，见 updateMachinery
function buildGearMesh(blockType) {
    const jammed = gearJammed(blockType) === 1;
    const powered = (gearPowered(blockType) || gearManual(blockType)) === 1;
    const spinning = powered && !jammed;
    const spinner = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.16, 12),
        new THREE.MeshLambertMaterial({ color: jammed ? 0x8a5a40 : 0x9a7a3a }),
    );
    spinner.add(body);
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const tooth = new THREE.Mesh(
            new THREE.BoxGeometry(0.16, 0.16, 0.14),
            new THREE.MeshLambertMaterial({ color: jammed ? 0x6a4430 : 0x7a5a28 }),
        );
        tooth.position.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4);
        tooth.rotation.y = -a;
        spinner.add(tooth);
    }
    const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8),
        new THREE.MeshLambertMaterial(jammed
            ? { color: 0xc05040, emissive: 0xaa2010, emissiveIntensity: 0.9 }
            : powered
                ? { color: 0x8a8a8a, emissive: 0xcc6620, emissiveIntensity: 0.7 }
                : { color: 0x6a6a6a }),
    );
    spinner.add(hub);

    const mounted = new THREE.Group();
    mounted.add(spinner);
    orientMounted(mounted, gearFacing(blockType), 0.16);
    const root = new THREE.Group();
    root.add(mounted);
    // userData 只放纯数据：propMeshCache 返回 mesh.clone()，而 three 的 clone 对 userData
    // 做 JSON 序列化，存 Object3D 引用（循环结构）会直接抛错。spinner 按固定层级找。
    root.userData.spinning = spinning;
    root.userData.jammed = jammed;
    return root;
}

// 拉杆：圆石底座 + 斜置木杆（开时尖端泛红光）
function buildLeverMesh(blockType) {
    const on = leverOn(blockType) === 1;
    const mounted = new THREE.Group();
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.375, 0.12, 0.375),
        new THREE.MeshLambertMaterial({ color: 0x7a7a7a }),
    );
    base.position.y = 0.06;
    mounted.add(base);
    const stickGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
    stickGeo.translate(0, 0.25, 0); // 枢轴移到杆底，rotation.x 直接就是倾斜角
    const stick = new THREE.Mesh(stickGeo, new THREE.MeshLambertMaterial({ color: 0x8a6a3a }));
    stick.position.y = 0.1;
    stick.rotation.x = on ? 0.6 : -0.6;
    const tip = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.08, 0.12),
        new THREE.MeshLambertMaterial(on
            ? { color: 0xc03020, emissive: 0x801010, emissiveIntensity: 0.8 }
            : { color: 0xc03020 }),
    );
    tip.position.y = 0.5;
    stick.add(tip);
    mounted.add(stick);
    orientMounted(mounted, leverFacing(blockType), 0.12);
    const root = new THREE.Group();
    root.add(mounted);
    return root;
}

// ==================== 火把光源 ====================
// opts 供红石灯复用（亮灯色温/距离略有差异），默认即火把参数
export function addTorchLight(x, y, z, opts = {}) {
    const { color = 0xffa030, intensity = 12, dist = 11, height = 0.75 } = opts;
    if (state.torchLights.size >= MAX_TORCH_LIGHTS) {
        // 达到上限：移除最早的一盏
        const firstKey = state.torchLights.keys().next().value;
        removeTorchLightByKey(firstKey);
    }
    const key = `${x},${y},${z}`;
    if (state.torchLights.has(key)) return;
    const light = new THREE.PointLight(color, intensity, dist, 1.7);
    light.position.set(x + 0.5, y + height, z + 0.5);
    scene.add(light);
    state.torchLights.set(key, light);
}

export function removeTorchLightByKey(key) {
    const light = state.torchLights.get(key);
    if (light) {
        scene.remove(light);
        light.dispose?.();
        state.torchLights.delete(key);
    }
}

export function removeTorchLightAt(x, y, z) {
    removeTorchLightByKey(`${x},${y},${z}`);
}

export function isSolid(blockType) {
    return BlockInfo[blockType]?.solid || false;
}

export function shouldRenderFace(x, y, z, face) {
    const neighbor = getBlock(x, y, z);
    if (neighbor === BlockTypes.AIR) return true;
    if (neighbor === BlockTypes.WATER) return getBlock(x - face.dx, y - face.dy, z - face.dz) !== BlockTypes
        .WATER;
    if (isTransparent(neighbor)) return getBlock(x, y, z) !== neighbor;
    return false;
}

export function buildChunkGeometry(chunkX, chunkZ) {
    const startX = chunkX * CHUNK_SIZE;
    const startZ = chunkZ * CHUNK_SIZE;
    const endX = Math.min(startX + CHUNK_SIZE, WORLD_WIDTH);
    const endZ = Math.min(startZ + CHUNK_SIZE, WORLD_DEPTH);

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const colors = [];
    const transparentPositions = [];
    const transparentNormals = [];
    const transparentUvs = [];
    const transparentIndices = [];
    const transparentColors = [];

    const faceDefs = [
        { dx: 0, dy: 0, dz: 1, normal: [0, 0, 1], face: 'side', vface: 'front', lightFactor: 0.8 },
        { dx: 0, dy: 0, dz: -1, normal: [0, 0, -1], face: 'side', vface: 'back', lightFactor: 0.8 },
        { dx: 1, dy: 0, dz: 0, normal: [1, 0, 0], face: 'side', vface: 'right', lightFactor: 0.7 },
        { dx: -1, dy: 0, dz: 0, normal: [-1, 0, 0], face: 'side', vface: 'left', lightFactor: 0.7 },
        { dx: 0, dy: 1, dz: 0, normal: [0, 1, 0], face: 'top', vface: 'top', lightFactor: 1.0 },
        { dx: 0, dy: -1, dz: 0, normal: [0, -1, 0], face: 'bottom', vface: 'bottom', lightFactor: 0.5 },
    ];

    for (let x = startX; x < endX; x++) {
        for (let z = startZ; z < endZ; z++) {
            for (let y = 0; y < WORLD_HEIGHT; y++) {
                const blockType = getBlock(x, y, z);
                if (blockType === BlockTypes.AIR) continue;
                if (isCustomMesh(blockType)) continue; // 火把/花用独立网格渲染
                const isTransp = isTransparent(blockType);
                const targetPositions = isTransp ? transparentPositions : positions;
                const targetNormals = isTransp ? transparentNormals : normals;
                const targetUvs = isTransp ? transparentUvs : uvs;
                const targetIndices = isTransp ? transparentIndices : indices;
                const targetColors = isTransp ? transparentColors : colors;

                for (const faceDef of faceDefs) {
                    const nx = x + faceDef.dx;
                    const ny = y + faceDef.dy;
                    const nz = z + faceDef.dz;
                    const neighborType = getBlock(nx, ny, nz);

                    let shouldRender = false;
                    if (neighborType === BlockTypes.AIR) {
                        shouldRender = true;
                    } else if (isTransparent(neighborType) && neighborType !== blockType) {
                        shouldRender = true;
                    } else if (isTransparent(blockType) && !isTransparent(neighborType)) {
                        shouldRender = false;
                    }

                    if (!shouldRender) continue;

                    const uv = getUVForFace(blockType, faceDef.face);
                    const light = faceDef.lightFactor;
                    const colorR = light;
                    const colorG = light;
                    const colorB = light;

                    // 顶点
                    const v0 = [x, y, z + 1];
                    const v1 = [x + 1, y, z + 1];
                    const v2 = [x + 1, y + 1, z + 1];
                    const v3 = [x, y + 1, z + 1];
                    const v4 = [x, y, z];
                    const v5 = [x + 1, y, z];
                    const v6 = [x + 1, y + 1, z];
                    const v7 = [x, y + 1, z];

                    const faceVerts = {
                        'top': [v3, v2, v6, v7],
                        'bottom': [v0, v4, v5, v1],
                        'front': [v0, v1, v2, v3],
                        'back': [v5, v4, v7, v6],
                        'right': [v1, v5, v6, v2],
                        'left': [v4, v0, v3, v7],
                    };

                    let verts;
                    const n = faceDef.normal;
                    if (n[2] === 1) verts = faceVerts.front;
                    else if (n[2] === -1) verts = faceVerts.back;
                    else if (n[0] === 1) verts = faceVerts.right;
                    else if (n[0] === -1) verts = faceVerts.left;
                    else if (n[1] === 1) verts = faceVerts.top;
                    else verts = faceVerts.bottom;

                    // 每个面顶点顺序对应的 UV（v1=贴图顶行 v0=贴图底行）
                    // 侧面四个面顶点顺序为 [底,底,顶,顶]，需把顶部顶点配 v1、底部顶点配 v0，
                    // 否则纹理上下颠倒（草皮跑到方块底部）
                    const faceUVs = {
                        'front': [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]],
                        'back': [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]],
                        'right': [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]],
                        'left': [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]],
                        'top': [[uv.u0, uv.v1], [uv.u1, uv.v1], [uv.u1, uv.v0], [uv.u0, uv.v0]],
                        'bottom': [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]],
                    };
                    const curUVs = faceUVs[faceDef.vface];

                    const baseIndex = targetPositions.length / 3;
                    const idx = baseIndex;

                    for (let vi = 0; vi < 4; vi++) {
                        targetPositions.push(verts[vi][0], verts[vi][1], verts[vi][2]);
                        targetNormals.push(n[0], n[1], n[2]);
                        targetColors.push(colorR, colorG, colorB);
                        targetUvs.push(curUVs[vi][0], curUVs[vi][1]);
                    }
                    targetIndices.push(idx, idx + 1, idx + 2, idx, idx + 2, idx + 3);
                }

            }
        }
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint32Array(indices),
        colors: new Float32Array(colors),
        transparentPositions: new Float32Array(transparentPositions),
        transparentNormals: new Float32Array(transparentNormals),
        transparentUvs: new Float32Array(transparentUvs),
        transparentIndices: new Uint32Array(transparentIndices),
        transparentColors: new Float32Array(transparentColors),
    };
}

export function createChunkMesh(chunkX, chunkZ) {
    const geoData = buildChunkGeometry(chunkX, chunkZ);
    if (geoData.indices.length === 0 && geoData.transparentIndices.length === 0) return null;

    const group = new THREE.Group();

    // 不透明部分
    if (geoData.indices.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(geoData.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(geoData.normals, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(geoData.uvs, 2));
        geo.setAttribute('color', new THREE.BufferAttribute(geoData.colors, 3));
        geo.setIndex(new THREE.BufferAttribute(geoData.indices, 1));
        const mat = new THREE.MeshLambertMaterial({
            map: atlasTexture,
            vertexColors: true,
            side: THREE.FrontSide,
            alphaTest: 0.5,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(0, 0, 0);
        mesh.matrixAutoUpdate = true;
        group.add(mesh);
    }

    // 透明部分
    if (geoData.transparentIndices.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(geoData.transparentPositions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(geoData.transparentNormals, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(geoData.transparentUvs, 2));
        geo.setAttribute('color', new THREE.BufferAttribute(geoData.transparentColors, 3));
        geo.setIndex(new THREE.BufferAttribute(geoData.transparentIndices, 1));
        const mat = new THREE.MeshLambertMaterial({
            map: atlasTexture,
            vertexColors: true,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.position.set(0, 0, 0);
        group.add(mesh);
    }

    return group;
}

export function updateChunkMeshes() {
    const totalChunksX = Math.ceil(WORLD_WIDTH / CHUNK_SIZE);
    const totalChunksZ = Math.ceil(WORLD_DEPTH / CHUNK_SIZE);
    for (let cx = 0; cx < totalChunksX; cx++) {
        for (let cz = 0; cz < totalChunksZ; cz++) {
            const key = `${cx},${cz}`;
            disposeChunk(cx, cz);
            const mesh = createChunkMesh(cx, cz);
            if (mesh) {
                scene.add(mesh);
                state.chunkMeshes.set(key, mesh);
            }
        }
    }
}

// 单格道具判定：返回该格是否为需要独立道具网格的方块（火把/花/门/齿轮/拉杆）
function isPropBlock(bt) {
    return bt === BlockTypes.TORCH || bt === BlockTypes.FLOWER || isDoorId(bt) ||
        isGearId(bt) || isLeverId(bt);
}

// 在 (x,y,z) 放置该格对应的道具网格（火把/亮灯含光源），挂入 state.droppedItems
function addPropAt(bt, x, y, z) {
    if (bt === BlockTypes.TORCH) {
        addTorchLight(x, y, z);
    } else if (isLampLitId(bt)) {
        // 亮着的红石灯：挂暖黄点光（无独立网格，立方体本体走区块几何）
        addTorchLight(x, y, z, { color: 0xffd070, intensity: 13, dist: 12, height: 0.5 });
    }
    const m = getPropMesh(bt);
    if (!m) return;
    m.position.set(x + 0.5, y, z + 0.5);
    m.userData.propKey = `${x},${y},${z}`;
    scene.add(m);
    state.droppedItems.push({ x, y, z, mesh: m, prop: true });
}

// 销毁区块内所有道具网格与火把光源
export function disposeChunkProps(chunkX, chunkZ) {
    const startX = chunkX * CHUNK_SIZE;
    const startZ = chunkZ * CHUNK_SIZE;
    const endX = Math.min(startX + CHUNK_SIZE, WORLD_WIDTH);
    const endZ = Math.min(startZ + CHUNK_SIZE, WORLD_DEPTH);
    // 清理本区块内的光源：方块还在（火把/亮灯）的保留，方块已没了的撤光。
    // 兜底覆盖一切「直接 setBlockSafe 清格」的路径（TNT 爆炸/助手清区），
    // 避免方块没了光还常亮的孤儿光源
    for (const key of [...state.torchLights.keys()]) {
        const [lx, ly, lz] = key.split(',').map(Number);
        if (lx < startX || lx >= endX || lz < startZ || lz >= endZ) continue;
        const bt = getBlock(lx, ly, lz);
        if (bt !== BlockTypes.TORCH && !isLampLitId(bt)) removeTorchLightByKey(key);
    }
    // 按坐标清掉本区块内的全部道具网格：方块先变空气再重建时（破坏门/花、
    // 助手工具直接清格）也要能清掉残留网格，所以不能只看当前方块类型
    for (let i = state.droppedItems.length - 1; i >= 0; i--) {
        const it = state.droppedItems[i];
        if (!it.prop) continue;
        if (it.x >= startX && it.x < endX && it.z >= startZ && it.z < endZ) {
            scene.remove(it.mesh);
            state.droppedItems.splice(i, 1);
        }
    }
}

// 依据世界数据重建区块内的道具（火把/灯光源 + 花/门/齿轮/拉杆网格）
export function buildChunkProps(chunkX, chunkZ) {
    const startX = chunkX * CHUNK_SIZE;
    const startZ = chunkZ * CHUNK_SIZE;
    const endX = Math.min(startX + CHUNK_SIZE, WORLD_WIDTH);
    const endZ = Math.min(startZ + CHUNK_SIZE, WORLD_DEPTH);
    for (let x = startX; x < endX; x++) {
        for (let z = startZ; z < endZ; z++) {
            for (let y = 0; y < WORLD_HEIGHT; y++) {
                const bt = getBlock(x, y, z);
                if (isPropBlock(bt) || isLampLitId(bt)) addPropAt(bt, x, y, z);
            }
        }
    }
}

// 局部刷新单格道具网格（门开关时用，避免整个区块重建）
export function refreshPropAt(x, y, z) {
    removeDroppedItemAt(x, y, z);
    addPropAt(getBlock(x, y, z), x, y, z);
}

export function removeDroppedItemAt(x, y, z) {
    const key = `${x},${y},${z}`;
    for (let i = state.droppedItems.length - 1; i >= 0; i--) {
        const it = state.droppedItems[i];
        if (it.prop && it.x === x && it.y === y && it.z === z) {
            scene.remove(it.mesh);
            state.droppedItems.splice(i, 1);
        }
    }
}

export function disposeChunk(cx, cz) {
    const key = `${cx},${cz}`;
    const existing = state.chunkMeshes.get(key);
    if (existing) {
        scene.remove(existing);
        existing.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                // 材质是区块私有的，正常释放；map 是全局共享的图集纹理（atlasTexture），
                // dispose 它只会逼渲染器下次渲染重新上传整张图集，不属于本区块的资源
                if (child.material.map && child.material.map !== atlasTexture) child.material.map.dispose();
                child.material.dispose();
            }
        });
        state.chunkMeshes.delete(key);
    }
    disposeChunkProps(cx, cz);
}

export function rebuildChunk(chunkX, chunkZ) {
    disposeChunk(chunkX, chunkZ);
    const mesh = createChunkMesh(chunkX, chunkZ);
    if (mesh) {
        scene.add(mesh);
        state.chunkMeshes.set(`${chunkX},${chunkZ}`, mesh);
    }
    buildChunkProps(chunkX, chunkZ);
}
