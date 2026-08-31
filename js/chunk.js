// ==================== chunk.js ====================

import * as THREE from 'three';
import { BlockInfo, BlockTypes, CHUNK_SIZE, MAX_TORCH_LIGHTS, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { state } from './state.js';
import { scene } from './engine.js';
import { atlasTexture, getUVForFace } from './textures.js';
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
    }
    if (mesh) propMeshCache.set(blockType, mesh);
    return mesh ? mesh.clone() : null;
}

// ==================== 火把光源 ====================
export function addTorchLight(x, y, z) {
    if (state.torchLights.size >= MAX_TORCH_LIGHTS) {
        // 达到上限：移除最早的一盏
        const firstKey = state.torchLights.keys().next().value;
        removeTorchLightByKey(firstKey);
    }
    const key = `${x},${y},${z}`;
    if (state.torchLights.has(key)) return;
    const light = new THREE.PointLight(0xffa030, 12, 11, 1.7);
    light.position.set(x + 0.5, y + 0.75, z + 0.5);
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

// 销毁区块内所有道具网格与火把光源
export function disposeChunkProps(chunkX, chunkZ) {
    const startX = chunkX * CHUNK_SIZE;
    const startZ = chunkZ * CHUNK_SIZE;
    const endX = Math.min(startX + CHUNK_SIZE, WORLD_WIDTH);
    const endZ = Math.min(startZ + CHUNK_SIZE, WORLD_DEPTH);
    for (let x = startX; x < endX; x++) {
        for (let z = startZ; z < endZ; z++) {
            for (let y = 0; y < WORLD_HEIGHT; y++) {
                const bt = getBlock(x, y, z);
                if (bt === BlockTypes.TORCH) removeTorchLightAt(x, y, z);
                else if (bt === BlockTypes.FLOWER) removeDroppedItemAt(x, y, z);
            }
        }
    }
}

// 依据世界数据重建区块内的道具（火把光源 + 花网格）
export function buildChunkProps(chunkX, chunkZ) {
    const startX = chunkX * CHUNK_SIZE;
    const startZ = chunkZ * CHUNK_SIZE;
    const endX = Math.min(startX + CHUNK_SIZE, WORLD_WIDTH);
    const endZ = Math.min(startZ + CHUNK_SIZE, WORLD_DEPTH);
    for (let x = startX; x < endX; x++) {
        for (let z = startZ; z < endZ; z++) {
            for (let y = 0; y < WORLD_HEIGHT; y++) {
                const bt = getBlock(x, y, z);
                if (bt === BlockTypes.TORCH) {
                    addTorchLight(x, y, z);
                    const m = getPropMesh(BlockTypes.TORCH);
                    if (m) {
                        m.position.set(x + 0.5, y, z + 0.5);
                        m.userData.propKey = `${x},${y},${z}`;
                        scene.add(m);
                        state.droppedItems.push({ x, y, z, mesh: m, prop: true });
                    }
                } else if (bt === BlockTypes.FLOWER) {
                    const m = getPropMesh(BlockTypes.FLOWER);
                    if (m) {
                        m.position.set(x + 0.5, y, z + 0.5);
                        m.userData.propKey = `${x},${y},${z}`;
                        scene.add(m);
                        state.droppedItems.push({ x, y, z, mesh: m, prop: true });
                    }
                }
            }
        }
    }
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
                if (child.material.map) child.material.map.dispose();
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
