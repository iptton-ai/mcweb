// ==================== chunk.js ====================

import * as THREE from 'three';
import { BlockInfo, BlockTypes, CHUNK_SIZE, MAX_TORCH_LIGHTS, PISTON_HEAD_BASE, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH, FACING_NORMALS, beltDir, buttonFacing, buttonPressed, clutchAxis, clutchEngaged, cogAxis, crusherAxis, deployerFacing, doorHalf, dustLit, isBeltId, isButtonId, isClutchId, isCogId, isCrusherId, isDeployerId, isDoorId, isDustId, isKineticId, isLampLitId, isLeverId, isObserverId, isPlateId, isPistonHeadId, isPistonId, isRTorchId, isRedstoneId, isRTorchLitId, isSawId, isShaftId, isWaterwheelId, leverFacing, leverOn, observerFacing, observerPowered, pistonExtended, pistonFacing, pistonSticky, platePressed, rtorchFacing, rtorchLit, sawFacing, shaftAxis, waterwheelAxis } from './config.js';
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
    } else if (isKineticId(blockType)) {
        mesh = buildKineticMesh(blockType);
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

// ==================== 动力组道具网格 ====================
// 层级结构：root（addPropAt 摆到格底面中心）→ orient（局部 +Y 旋到方块轴向/锯朝向）→
// spinner（旋转动画只累加它的 rotation.y，js/kinetic.js 每帧驱动）。
// 【约定】spinner 永远是 orient 的第一个子节点（kinetic.js 按 children[0].children[0] 定位），
// 机械锯的固定机身挂在 orient 的后续子节点上（随机身转的件才进 spinner）。
// userData 只存纯数据（kinetic: true），Object3D.clone 的 userData 浅复制安全。
const AXIS_TO_NORMAL = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function buildKineticMesh(blockType) {
    // 传送带：贴顶面的静止薄板（照压力板入缓存、按 dir 旋转箭头贴图）——不挂
    // userData.kinetic、不进 spinner 层级：带不转，物品移动本身就是方向反馈（差异 4）
    if (isBeltId(blockType)) return buildBeltMesh(blockType);
    // 投料器：无旋转件的静止机身（方箱+正面喷嘴），照锯的机身 orient 逻辑摆朝向——
    // 不挂 userData.kinetic、无 spinner（投料器不转，放置动作本身就是工作反馈，链 3）
    if (isDeployerId(blockType)) return buildDeployerMesh(blockType);
    const spinner = new THREE.Group(); // 几何一律沿局部 +Y 构建（= 旋转轴）
    const orient = new THREE.Group();
    orient.add(spinner); // spinner 必须是第一个子节点（见上方约定）
    orient.position.set(0, 0.5, 0); // 旋转中心 = 格中心
    const root = new THREE.Group();
    root.add(orient);
    root.userData.kinetic = true;

    let axisNormal;
    if (isSawId(blockType)) {
        axisNormal = FACING_NORMALS[sawFacing(blockType)];
        buildSawMesh(spinner, orient); // 圆锯片进 spinner，固定机身挂 orient
    } else {
        const axis = isShaftId(blockType) ? shaftAxis(blockType)
            : isCogId(blockType) ? cogAxis(blockType)
                : isWaterwheelId(blockType) ? waterwheelAxis(blockType)
                    : isClutchId(blockType) ? clutchAxis(blockType)
                        : crusherAxis(blockType);
        axisNormal = AXIS_TO_NORMAL[axis];
        if (isShaftId(blockType)) buildShaftMesh(spinner);
        else if (isCogId(blockType)) buildCogMesh(spinner);
        else if (isWaterwheelId(blockType)) buildWaterwheelMesh(spinner);
        else if (isClutchId(blockType)) buildClutchMesh(spinner, clutchEngaged(blockType) === 1);
        else buildCrusherMesh(spinner);
    }
    orient.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...axisNormal));
    return root;
}

// 传动轴：0.35 见方的木杆，贴图走图集（端面年轮 / 侧面木纹）
function buildShaftMesh(spinner) {
    const rod = new THREE.Mesh(
        makeTexturedBoxGeo(0.35, 1, 0.35, {
            py: 'shaft', ny: 'shaft',
            px: 'shaft_side', nx: 'shaft_side', pz: 'shaft_side', nz: 'shaft_side',
        }),
        pistonAtlasMat,
    );
    spinner.add(rod);
}

// 齿轮：木质轮盘 + 8 根方齿（啮合时齿对齿反转）
function buildCogMesh(spinner) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.32, 16), new THREE.MeshLambertMaterial({ color: 0x8f6c3a }));
    spinner.add(body);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 8), new THREE.MeshLambertMaterial({ color: 0x5a4222 }));
    spinner.add(hub);
    const toothGeo = new THREE.BoxGeometry(0.18, 0.34, 0.12);
    const toothMat = new THREE.MeshLambertMaterial({ color: 0x93703c });
    for (let i = 0; i < 8; i++) {
        const ang = i / 8 * Math.PI * 2;
        const tooth = new THREE.Mesh(toothGeo, toothMat);
        tooth.position.set(Math.cos(ang) * 0.46, 0, Math.sin(ang) * 0.46);
        tooth.rotation.y = -ang; // 齿长轴指向半径方向
        spinner.add(tooth);
    }
}

// 水车：双轮缘 + 三根通长辐条（六向）+ 周圈八片桨叶，视觉放大到 1.56 格直径（允许越界）
function buildWaterwheelMesh(spinner) {
    const rimMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
    for (const oy of [-0.15, 0.15]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 6, 18), rimMat);
        rim.rotation.x = Math.PI / 2; // 圆环面躺进 X-Z 平面（轴 = 局部 Y）
        rim.position.y = oy;
        spinner.add(rim);
    }
    const spokeMat = new THREE.MeshLambertMaterial({ color: 0x9c7a48 });
    for (let i = 0; i < 3; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.07, 0.09), spokeMat);
        spoke.rotation.y = i * Math.PI / 3;
        spinner.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0x5a4222 }));
    spinner.add(hub);
    const paddleMat = new THREE.MeshLambertMaterial({ color: 0x7a5a30 });
    for (let i = 0; i < 8; i++) {
        const ang = i / 8 * Math.PI * 2;
        const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.08), paddleMat);
        paddle.position.set(Math.cos(ang) * 0.62, 0, Math.sin(ang) * 0.62);
        paddle.rotation.y = -ang; // 桨叶面沿半径方向（水轮式）
        spinner.add(paddle);
    }
}

// 粉碎轮：厚重石盘（0.8 厚）+ 四道碾碎凹槽 + 深色轴套
function buildCrusherMesh(spinner) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.8, 18), new THREE.MeshLambertMaterial({ color: 0x9a9a9a }));
    spinner.add(wheel);
    const grooveGeo = new THREE.BoxGeometry(0.24, 0.82, 0.12);
    const grooveMat = new THREE.MeshLambertMaterial({ color: 0x5a5a5a });
    for (let i = 0; i < 4; i++) {
        const ang = i / 4 * Math.PI * 2;
        const groove = new THREE.Mesh(grooveGeo, grooveMat);
        groove.position.set(Math.cos(ang) * 0.38, 0, Math.sin(ang) * 0.38);
        groove.rotation.y = -ang;
        spinner.add(groove);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.86, 8), new THREE.MeshLambertMaterial({ color: 0x3a3a3a }));
    spinner.add(hub);
}

// 离合器（Create-lite L1）：中央通轴 + 两片法兰盘。接合 = 两盘贴合在格心传动力（木色，
// 随全网旋转动画转动）；断开 = 两盘各退向两端、中间露出红色指示点 + 盘面变暗灰——
// 断开后该格自成无动力分量不转，靠变色 + 红点一眼可辨「开关断开了」
function buildClutchMesh(spinner, engaged) {
    const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 1, 8),
        new THREE.MeshLambertMaterial({ color: 0x5a4222 }),
    );
    spinner.add(rod);
    const plateMat = new THREE.MeshLambertMaterial({ color: engaged ? 0x9c7a48 : 0x565049 });
    const gap = engaged ? 0 : 0.14;
    for (const s of [-1, 1]) {
        const plate = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.3, 0.14, 12),
            plateMat,
        );
        plate.position.y = s * (0.07 + gap);
        spinner.add(plate);
    }
    if (!engaged) {
        // 红色断开指示：比通轴宽的小方块嵌在两盘间隙里（断开态整格静止，指示不随之旋转）
        const dot = new THREE.Mesh(
            new THREE.BoxGeometry(0.26, 0.08, 0.26),
            new THREE.MeshLambertMaterial({ color: 0xff4030, emissive: 0xd02010, emissiveIntensity: 1.2 }),
        );
        spinner.add(dot);
    }
}

// 传送带（Create-lite L1 链 2）：1×0.12×1 贴图薄板——顶面 tile 73（箭头指向贴图上方
// = 局部 -Z=北 为基准），整板绕 Y 随 dir 旋转（北 0 / 东 -90° / 南 180° / 西 +90°），
// 侧面 tile 74 带沿。几何模块级共享，4 个 dir 变体各自入 propMeshCache（照压力板模式）。
const beltPlateGeo = makeTexturedBoxGeo(1, 0.12, 1, {
    py: 'belt', ny: 'belt_side',
    px: 'belt_side', nx: 'belt_side', pz: 'belt_side', nz: 'belt_side',
});

function buildBeltMesh(blockType) {
    const group = new THREE.Group();
    const plate = new THREE.Mesh(beltPlateGeo, pistonAtlasMat);
    plate.position.y = 0.06; // 原点在格底面中心，薄板贴地
    group.add(plate);
    // 基准 tile 的箭头指向贴图上方，BoxGeometry 顶面(+Y)的贴图上向对应局部 +Z（南）——
    // 故先转 π 再按 dir 旋转（北 180° / 东 90° / 南 0° / 西 -90°），使箭头 = BELT_DIRS[dir]
    group.rotation.y = Math.PI - beltDir(blockType) * Math.PI / 2;
    return group;
}

// 机械锯：圆锯片（进 spinner 随机旋转）+ 背面固定机身（挂 orient 不转）
function buildSawMesh(spinner, orient) {
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 20), new THREE.MeshLambertMaterial({ color: 0xb8bcc4 }));
    spinner.add(blade);
    const toothGeo = new THREE.BoxGeometry(0.1, 0.08, 0.05);
    const toothMat = new THREE.MeshLambertMaterial({ color: 0x989ca6 });
    for (let i = 0; i < 8; i++) {
        const ang = i / 8 * Math.PI * 2;
        const tooth = new THREE.Mesh(toothGeo, toothMat);
        tooth.position.set(Math.cos(ang) * 0.47, 0, Math.sin(ang) * 0.47);
        tooth.rotation.y = -ang;
        spinner.add(tooth);
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.34), new THREE.MeshLambertMaterial({ color: 0x6a5a3a }));
    body.position.set(0, -0.42, 0); // 机身在朝向的反侧（orient 的 +Y 指向被锯方块）
    orient.add(body);
}

// 投料器（Create-lite L1 链 3）：0.9 见方铜木机身（局部 +Y 面 = 正面，铺 tile 75 投料口、
// 其余五面 tile 76 机壳）+ 正面伸出的方形喷嘴——整组挂 orient 按朝向摆放（orient 的
// +Y 指向被投格，照锯的 orient 逻辑），无 spinner 旋转件（投料器不转）。
// 6 个 facing 变体各自入 propMeshCache（静态无逐格依赖，照压力板模式）。
function buildDeployerMesh(blockType) {
    const orient = new THREE.Group();
    orient.position.set(0, 0.5, 0); // 格中心
    const root = new THREE.Group();
    root.add(orient);
    const body = new THREE.Mesh(
        makeTexturedBoxGeo(0.9, 0.9, 0.9, {
            py: 'deployer', // 正面 = 投料口贴图（tile 75）
            ny: 'deployer_side',
            px: 'deployer_side', nx: 'deployer_side', pz: 'deployer_side', nz: 'deployer_side',
        }),
        pistonAtlasMat,
    );
    orient.add(body);
    // 正面喷嘴：中央小方柱沿局部 +Y 伸出机身面（越过 0.45 半高，指向投料目标）
    const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.3), new THREE.MeshLambertMaterial({ color: 0x5a5038 }));
    nozzle.position.y = 0.52;
    orient.add(nozzle);
    orient.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...FACING_NORMALS[deployerFacing(blockType)]));
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

// 单格道具判定：返回该格是否为需要独立道具网格的方块（火把/花/门/红石元件/活塞组/动力组）
function isPropBlock(bt) {
    return bt === BlockTypes.TORCH || bt === BlockTypes.FLOWER || isDoorId(bt) ||
        isLeverId(bt) || isDustId(bt) || isRTorchId(bt) || isButtonId(bt) || isPlateId(bt) ||
        isPistonId(bt) || isPistonHeadId(bt) || isObserverId(bt) || isKineticId(bt);
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
