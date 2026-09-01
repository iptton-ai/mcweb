// ==================== chunk.js ====================

import * as THREE from 'three';
import { BlockInfo, BlockTypes, CHUNK_SIZE, MAX_TORCH_LIGHTS, PISTON_HEAD_BASE, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH, FACING_NORMALS, buttonFacing, buttonPressed, doorHalf, dustLit, isButtonId, isDoorId, isDustId, isLampLitId, isLeverId, isObserverId, isPlateId, isPistonHeadId, isPistonId, isRTorchId, isRedstoneId, isRTorchLitId, leverFacing, leverOn, observerFacing, observerPowered, pistonExtended, pistonFacing, pistonSticky, platePressed, rtorchFacing, rtorchLit } from './config.js';
import { state } from './state.js';
import { scene } from './engine.js';
import { atlasSize, atlasTexture, getUVForFace, getDoorTileTexture, tileMap } from './textures.js';
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
    } else if (isRTorchId(blockType)) {
        mesh = buildRedstoneTorchMesh(blockType);
    } else if (isButtonId(blockType)) {
        mesh = buildButtonMesh(blockType);
    } else if (isPlateId(blockType)) {
        mesh = buildPlateMesh(blockType);
    } else if (isLeverId(blockType)) {
        mesh = buildLeverMesh(blockType);
    } else if (isPistonId(blockType)) {
        mesh = buildPistonBaseMesh(blockType);
    } else if (isObserverId(blockType)) {
        mesh = buildObserverMesh(blockType);
    }
    // 活塞头不在缓存里：是否粘头取决于身后底座，逐格现算（addPropAt 特判）
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

// 红石火把：细木杆 + 红色辉光头（亮时），熄灭则头变暗红。
// 贴地（facing 0）原点即格底；贴墙（facing 2..5）把 +Y 旋到墙法线，杆底摆在墙面格心
function buildRedstoneTorchMesh(blockType) {
    const lit = rtorchLit(blockType) === 1;
    const group = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), new THREE.MeshLambertMaterial({ color: 0x6a4a2a }));
    stick.position.y = 0.25;
    group.add(stick);
    const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 0.16),
        new THREE.MeshLambertMaterial(lit
            ? { color: 0xff4020, emissive: 0xd02010, emissiveIntensity: 1.2 }
            : { color: 0x701812 }),
    );
    head.position.y = 0.56;
    group.add(head);
    const root = new THREE.Group();
    const facing = rtorchFacing(blockType);
    if (facing === 0) {
        root.add(group);
    } else {
        const [nx, , nz] = FACING_NORMALS[facing];
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz));
        group.position.set(0.5 + nx * 0.5, 0.5, 0.5 + nz * 0.5); // 杆底贴墙面格心
        root.add(group);
    }
    return root;
}

// 按钮：石质小方块，按下时变薄缩进（视觉反馈）
function buildButtonMesh(blockType) {
    const pressed = buttonPressed(blockType) === 1;
    const t = pressed ? 0.05 : 0.1;
    const mounted = new THREE.Group();
    const btn = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, t, 0.25),
        new THREE.MeshLambertMaterial({ color: pressed ? 0x6a6a6a : 0x8a8a8a }),
    );
    btn.position.y = t / 2;
    mounted.add(btn);
    orientMounted(mounted, buttonFacing(blockType), t);
    const root = new THREE.Group();
    root.add(mounted);
    return root;
}

// 压力板：贴地的扁平石板，被踩时更薄更低
function buildPlateMesh(blockType) {
    const pressed = platePressed(blockType) === 1;
    const h = pressed ? 0.03 : 0.07;
    const group = new THREE.Group();
    const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, h, 0.8),
        new THREE.MeshLambertMaterial({ color: pressed ? 0x6a6a6a : 0x8a8a8a }),
    );
    plate.position.y = h / 2;
    group.add(plate);
    return group; // 原点在格底面中心，贴地即可
}

// 红石粉：中心粉堆 + 按邻接伸出的四条臂。形状随邻居现算，不走 propMeshCache；
// 几何体与材质模块级共享，逐格只组装 Group，不产生需要 dispose 的逐格 GPU 资源。
const dustArmGeo = {
    px: new THREE.BoxGeometry(0.35, 0.05, 0.16), nx: new THREE.BoxGeometry(0.35, 0.05, 0.16),
    pz: new THREE.BoxGeometry(0.16, 0.05, 0.35), nz: new THREE.BoxGeometry(0.16, 0.05, 0.35),
};
const dustCenterGeo = new THREE.BoxGeometry(0.3, 0.05, 0.3);
const dustMats = [
    new THREE.MeshLambertMaterial({ color: 0x5a1010 }), // 灭
    new THREE.MeshLambertMaterial({ color: 0xff3820, emissive: 0xc02010, emissiveIntensity: 0.6 }), // 亮
];

// 四向是否伸出粉臂：邻格是红石粉（含斜上/斜下一格，与传导规则一致）或任意红石元件。
// 孤立粉四臂全伸（原版孤立粉显示为十字）。
function dustConnections(x, y, z) {
    const conn = { px: 0, nx: 0, pz: 0, nz: 0 };
    for (const [dx, dz, k] of [[1, 0, 'px'], [-1, 0, 'nx'], [0, 1, 'pz'], [0, -1, 'nz']]) {
        if (isDustId(getBlock(x + dx, y, z + dz)) || isDustId(getBlock(x + dx, y + 1, z + dz)) ||
            isDustId(getBlock(x + dx, y - 1, z + dz)) || isRedstoneId(getBlock(x + dx, y, z + dz))) conn[k] = 1;
    }
    if (!conn.px && !conn.nx && !conn.pz && !conn.nz) return { px: 1, nx: 1, pz: 1, nz: 1 };
    return conn;
}

export function buildDustMesh(x, y, z, lit) {
    const group = new THREE.Group();
    const mat = dustMats[lit ? 1 : 0];
    const center = new THREE.Mesh(dustCenterGeo, mat);
    center.position.y = 0.03;
    group.add(center);
    const conn = dustConnections(x, y, z);
    for (const [k, ox, oz] of [['px', 0.25, 0], ['nx', -0.25, 0], ['pz', 0, 0.25], ['nz', 0, -0.25]]) {
        if (!conn[k]) continue;
        const arm = new THREE.Mesh(dustArmGeo[k], mat);
        arm.position.set(ox, 0.03, oz);
        group.add(arm);
    }
    return group;
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

// ==================== 活塞组道具网格 ====================
// 用图集 tile 名给 BoxGeometry 六面铺 UV（面序 +x,-x,+y,-y,+z,-z，同 buildHeldBlockMesh 的 UV 摆法）
function makeTexturedBoxGeo(w, h, d, tiles) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uvAttr = geo.attributes.uv;
    const faces = [tiles.px, tiles.nx, tiles.py, tiles.ny, tiles.pz, tiles.nz];
    for (let f = 0; f < 6; f++) {
        const t = tileMap[faces[f]] || tileMap['piston'];
        const u0 = t.x / atlasSize;
        const v0 = 1 - (t.y + 1) / atlasSize;
        const u1 = (t.x + 1) / atlasSize;
        const v1 = 1 - t.y / atlasSize;
        const i = f * 4;
        uvAttr.setXY(i, u0, v1);
        uvAttr.setXY(i + 1, u1, v1);
        uvAttr.setXY(i + 2, u0, v0);
        uvAttr.setXY(i + 3, u1, v0);
    }
    uvAttr.needsUpdate = true;
    return geo;
}

const pistonAtlasMat = new THREE.MeshLambertMaterial({ map: atlasTexture });
const pistonArmMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a }); // 中央推杆（木质，不走图集）

// 把「朝上构建」的整格道具组摆到 facing 朝向：绕格中心旋转（局部原点 = 格底面中心）
function orientCellBox(g, facing) {
    const [nx, ny, nz] = FACING_NORMALS[facing];
    if (ny === 1) return; // 朝上：无需旋转
    if (ny === -1) {
        g.rotation.x = Math.PI;
        g.position.y = 1; // 绕格中心 (0,0.5,0) 翻转
        return;
    }
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, ny, nz));
    g.position.set(-nx * 0.5, 0.5, -nz * 0.5); // 平移补偿绕中心的旋转
}

// 活塞底座：收回 = 整格立方（局部 +Y 面 = 推出面，粘性活塞的推出面盖粘液贴图）；
// 伸出 = 后 1/4 底板 + 中央推杆（前格的活塞头网格补全视觉，两格拼起来是完整活塞）
function buildPistonBaseMesh(blockType) {
    const facing = pistonFacing(blockType);
    const extended = pistonExtended(blockType) === 1;
    const sticky = pistonSticky(blockType);
    const g = new THREE.Group();
    if (!extended) {
        const cube = new THREE.Mesh(
            makeTexturedBoxGeo(1, 1, 1, {
                py: sticky ? 'slime' : 'piston',
                ny: 'piston_bottom',
                px: 'piston_side', nx: 'piston_side', pz: 'piston_side', nz: 'piston_side',
            }),
            pistonAtlasMat,
        );
        cube.position.y = 0.5;
        g.add(cube);
    } else {
        const plate = new THREE.Mesh(
            makeTexturedBoxGeo(1, 0.25, 1, {
                py: 'piston_inner',
                ny: 'piston_bottom',
                px: 'piston_side', nx: 'piston_side', pz: 'piston_side', nz: 'piston_side',
            }),
            pistonAtlasMat,
        );
        plate.position.y = 0.125;
        g.add(plate);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), pistonArmMat);
        arm.position.y = 0.625;
        g.add(arm);
    }
    const root = new THREE.Group();
    root.add(g);
    orientCellBox(g, facing);
    return root;
}

// 活塞头：远端 1/4 推板 + 连回底座的推杆。粘头与否看身后底座（逐格现算，不入缓存）：
// 粘性推板外层是粘液贴图，普通是活塞推出面。
function buildPistonHeadMesh(blockType, x, y, z) {
    const facing = blockType - PISTON_HEAD_BASE;
    const [nx, ny, nz] = FACING_NORMALS[facing];
    const baseId = getBlock(x - nx, y - ny, z - nz);
    const sticky = isPistonId(baseId) && pistonSticky(baseId);
    const g = new THREE.Group();
    const plate = new THREE.Mesh(
        makeTexturedBoxGeo(1, 0.25, 1, {
            py: sticky ? 'slime' : 'piston',
            ny: 'piston_inner',
            px: 'piston_side', nx: 'piston_side', pz: 'piston_side', nz: 'piston_side',
        }),
        pistonAtlasMat,
    );
    plate.position.y = 0.875;
    g.add(plate);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), pistonArmMat);
    arm.position.y = 0.375;
    g.add(arm);
    const root = new THREE.Group();
    root.add(g);
    orientCellBox(g, facing);
    return root;
}

// 观察者：整格立方，局部 +Y 面 = 「眼睛」侦测面；脉冲中（powered）时背面亮红点
function buildObserverMesh(blockType) {
    const facing = observerFacing(blockType);
    const powered = observerPowered(blockType) === 1;
    const g = new THREE.Group();
    const cube = new THREE.Mesh(
        makeTexturedBoxGeo(1, 1, 1, {
            py: 'observer',
            ny: 'observer_side',
            px: 'observer_side', nx: 'observer_side', pz: 'observer_side', nz: 'observer_side',
        }),
        pistonAtlasMat,
    );
    cube.position.y = 0.5;
    g.add(cube);
    if (powered) {
        const dot = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.02, 0.3),
            new THREE.MeshLambertMaterial({ color: 0xff4030, emissive: 0xd02010, emissiveIntensity: 1.2 }),
        );
        dot.position.y = -0.01; // 背面（局部 -Y）微凸，背面是空气时可见
        g.add(dot);
    }
    const root = new THREE.Group();
    root.add(g);
    orientCellBox(g, facing);
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

// 单格道具判定：返回该格是否为需要独立道具网格的方块（火把/花/门/红石元件/活塞组）
function isPropBlock(bt) {
    return bt === BlockTypes.TORCH || bt === BlockTypes.FLOWER || isDoorId(bt) ||
        isLeverId(bt) || isDustId(bt) || isRTorchId(bt) || isButtonId(bt) || isPlateId(bt) ||
        isPistonId(bt) || isPistonHeadId(bt) || isObserverId(bt);
}

// 在 (x,y,z) 放置该格对应的道具网格（火把/亮灯/亮红石火把含光源），挂入 state.droppedItems
function addPropAt(bt, x, y, z) {
    if (bt === BlockTypes.TORCH) {
        addTorchLight(x, y, z);
    } else if (isLampLitId(bt)) {
        // 亮着的红石灯：挂暖黄点光（无独立网格，立方体本体走区块几何）
        addTorchLight(x, y, z, { color: 0xffd070, intensity: 13, dist: 12, height: 0.5 });
    } else if (isRTorchLitId(bt)) {
        // 亮着的红石火把：暗红微光（近似原版 7 级光照）
        addTorchLight(x, y, z, { color: 0xff4020, intensity: 4, dist: 7, height: 0.6 });
    }
    // 红石粉形状随邻居变化、活塞头粘与否看身后底座，都不走按方块类型缓存的
    // getPropMesh，逐格现算；其余道具（含活塞底座/观察者）走缓存
    const m = isDustId(bt)
        ? buildDustMesh(x, y, z, dustLit(bt))
        : isPistonHeadId(bt)
            ? buildPistonHeadMesh(bt, x, y, z)
            : getPropMesh(bt);
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
    // 清理本区块内的光源：方块还在（火把/亮灯/亮红石火把）的保留，方块已没了的撤光。
    // 兜底覆盖一切「直接 setBlockSafe 清格」的路径（TNT 爆炸/助手清区），
    // 避免方块没了光还常亮的孤儿光源
    for (const key of [...state.torchLights.keys()]) {
        const [lx, ly, lz] = key.split(',').map(Number);
        if (lx < startX || lx >= endX || lz < startZ || lz >= endZ) continue;
        const bt = getBlock(lx, ly, lz);
        if (bt !== BlockTypes.TORCH && !isLampLitId(bt) && !isRTorchLitId(bt)) removeTorchLightByKey(key);
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
