// ==================== viewmodel.js ====================
// 第一人称手部视图模型（照搬原版第一人称的手/持物渲染）：
//   · 空手 = Steve 风格手臂；持方块 = 手中的 3D 小立方体（贴图取自图集）；
//     持工具/道具（门/火把/红石元件等 customMesh 物品）= 原版风格的像素物品板
//   · 挥动动画：左键攻击/挖掘、右键放置时播放，时长 0.3s（原版 6 tick）
//   · 切换物品（滚轮/数字键/背包）触发 equip 举起动画 0.25s
//   · 走路摆动（view bobbing）：贴地移动时手臂随步伐晃动
// 渲染在独立的手部场景 + 相机：主场景渲染后 clearDepth 再叠加，手永远不会穿进墙里
// （原版同理）。第三人称/自由摄像头/跟拍/死亡时隐藏。

import * as THREE from 'three';
import { BlockInfo, HotbarBlocks, ToolTypes, isToolId } from './config.js';
import { state } from './state.js';
import { atlasCanvas, atlasTexture, blockUVs, getUVForFace, tileSize } from './textures.js';

// ==================== 手部场景 ====================
export const handScene = new THREE.Scene();

export const handCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 10);
handCamera.position.set(0, 0, 0);

// 手部打光（独立于世界昼夜，保证手部始终可读；原版手部也带最低亮度）
handScene.add(new THREE.AmbientLight(0xffffff, 0.85));
const handKeyLight = new THREE.DirectionalLight(0xffffff, 0.7);
handKeyLight.position.set(-0.6, 1, 0.8);
handScene.add(handKeyLight);

// rig：手臂 + 持物的总挂点，挥动/摆动/举起动画都作用在它上面
const rig = new THREE.Group();
handScene.add(rig);

// 基础姿态：手位于画面右下、朝前伸（照原版取景，略收进画面避免贴边裁切）
const BASE_POS = new THREE.Vector3(0.5, -0.48, -0.9);
const BASE_ROT = new THREE.Euler(0.32, -0.38, 0.12);

// Steve 风格手臂（空手时最显眼；持物时托在物品后下方）
const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.17, 0.62),
    new THREE.MeshLambertMaterial({ color: 0xe8b088 }),
);
arm.position.set(0.1, -0.16, 0.22);
arm.rotation.set(0.5, -0.3, 0.12);
rig.add(arm);

// 持物挂点（在手臂前端）
const heldPivot = new THREE.Group();
heldPivot.position.set(0, 0.04, -0.1);
rig.add(heldPivot);

// ==================== 持物网格构建 ====================
// 立方体方块 → 3D 小立方体（六面 UV 取图集对应 tile，45° 斜持照原版）
function buildHeldBlockMesh(blockType) {
    const geo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
    const uvAttr = geo.attributes.uv;
    // BoxGeometry 面序：+x,-x,+y(顶),-y(底),+z,-z；每面 4 顶点 uv 依次为 (0,1)(1,1)(0,0)(1,0)
    const faces = ['side', 'side', 'top', 'bottom', 'side', 'side'];
    for (let f = 0; f < 6; f++) {
        const { u0, v0, u1, v1 } = getUVForFace(blockType, faces[f]);
        const i = f * 4;
        uvAttr.setXY(i, u0, v1);
        uvAttr.setXY(i + 1, u1, v1);
        uvAttr.setXY(i + 2, u0, v0);
        uvAttr.setXY(i + 3, u1, v0);
    }
    uvAttr.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        map: atlasTexture,
        transparent: true,
        alphaTest: 0.1,
    }));
    mesh.rotation.set(0.08, Math.PI / 4 + 0.15, 0);
    return mesh;
}

// 物品板：工具与道具类物品（门/火把/红石元件等图标）用图集 tile 裁出的像素板，斜持
function makeSpriteTexture(tile) {
    const cnv = document.createElement('canvas');
    cnv.width = tileSize;
    cnv.height = tileSize;
    cnv.getContext('2d').drawImage(atlasCanvas, tile.x * tileSize, tile.y * tileSize, tileSize, tileSize, 0, 0,
        tileSize, tileSize);
    const tex = new THREE.CanvasTexture(cnv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function buildHeldItemMesh(itemId) {
    const tile = blockUVs[itemId]?.top || blockUVs[ToolTypes.SWORD]?.top;
    if (!tile) return null;
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4, 0.4),
        new THREE.MeshBasicMaterial({
            map: makeSpriteTexture(tile),
            transparent: true,
            alphaTest: 0.15,
            side: THREE.DoubleSide,
        }),
    );
    // 原版持物姿态：物品斜 45°+ 朝向画面，尖端朝右上
    mesh.rotation.set(0, -0.25, Math.PI * 0.72);
    mesh.position.set(0.02, 0.05, 0);
    return mesh;
}

function buildHeldMesh(itemId) {
    if (itemId == null) return null;
    const info = BlockInfo[itemId];
    if (!info) return null;
    // 工具与道具（customMesh 的门/火把/红石元件/花）用像素板；普通方块用 3D 立方体
    if (isToolId(itemId) || info.customMesh) return buildHeldItemMesh(itemId);
    return buildHeldBlockMesh(itemId);
}

// ==================== 动画状态 ====================
const anim = {
    swing: 1,     // 挥动进度 1=完成；触发一次挥动置 0，0.3s 走完（原版 6 tick）
    equip: 0,     // 切换物品的举起动画 1→0，0.25s 走完
    bobPhase: 0,  // 走路摆动相位（随水平速度推进）
};
let lastHeldId = undefined; // undefined = 尚未初始化（首帧不算切换）

export function swingViewmodel() {
    anim.swing = 0;
}

function updateHeldItem() {
    const heldId = HotbarBlocks[state.player.selectedSlot] ?? null;
    if (heldId !== lastHeldId) {
        if (lastHeldId !== undefined) anim.equip = 1; // 真切换才播举起动画（首帧静默就位）
        lastHeldId = heldId;
        heldPivot.clear();
        const mesh = buildHeldMesh(heldId);
        if (mesh) heldPivot.add(mesh);
    }
}

// 每帧更新姿态（main.js gameLoop 调用，在玩家物理之后——摆动要用最新的速度/落地状态）
export function updateViewmodel(dt) {
    updateHeldItem();

    if (anim.equip > 0) anim.equip = Math.max(0, anim.equip - dt / 0.25);
    if (anim.swing < 1) anim.swing = Math.min(1, anim.swing + dt / 0.3);

    // 走路摆动：贴地且有水平速度时相位推进（悬空/飞行不摆，照原版体感）
    const p = state.player;
    const hSpeed = Math.hypot(p.vx, p.vz);
    if (p.onGround && hSpeed > 0.5) anim.bobPhase += dt * (4 + hSpeed * 1.6);

    const s = Math.sin(anim.swing * Math.PI); // 挥动包络：起手→挥下→收回
    rig.position.set(
        BASE_POS.x + Math.sin(anim.bobPhase) * 0.022 - s * 0.12,
        BASE_POS.y - Math.abs(Math.cos(anim.bobPhase)) * 0.022 - s * 0.2 - anim.equip * 0.55,
        BASE_POS.z - s * 0.12,
    );
    rig.rotation.set(
        BASE_ROT.x - s * 1.15,
        BASE_ROT.y - s * 0.32,
        BASE_ROT.z + s * 0.28,
    );
}

// 是否显示手部：仅第一人称 + 跟随玩家视角 + 存活（第三人称/自由摄像头/跟拍/死亡都隐藏）
function isVisible() {
    return state.viewMode === 0 && state.camMode === 'player' && !state.player.dead;
}

// 主场景渲染后叠加渲染手部（main.js gameLoop 调用）：
// 关掉 autoClear 只清深度，手部画在世界之上，不会被近处方块裁掉
export function renderViewmodel(renderer) {
    if (!isVisible()) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(handScene, handCamera);
    renderer.autoClear = prevAutoClear;
}

// 窗口尺寸变化时同步手部相机宽高比（main.js init 后生效）
export function initViewmodel() {
    window.addEventListener('resize', () => {
        handCamera.aspect = window.innerWidth / window.innerHeight;
        handCamera.updateProjectionMatrix();
    });
}
