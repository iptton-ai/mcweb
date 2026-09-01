// ==================== cameraRig.js ====================
// 摄像头模式机：三种互斥模式，state.camMode 承载，C 键（input.js）循环切换。
//   player = 跟随玩家（第一/第三人称由 viewMode 决定，相机逻辑仍在 playerPhysics.updateCamera）
//   free   = 自由摄像头：脱离玩家身体的观景机位，鼠标转视角、WASD 沿视线飞行、
//            Space/Shift 升降（与创造飞行一致）、滚轮调速；玩家物理与破坏/放置暂停
//   build  = 建造跟拍：俯视施工包围盒并随进度自动拉高拉远（AI 建造的「最佳拍摄角度」），
//            进入时自动开始录像、建造完成后停留片刻自动停录并回到玩家视角
// 自由/跟拍视角下放宽雾与远裁剪面（俯瞰距离超出玩家视野参数，不放宽会被雾染白）。

import {
    BUILD_CAM_DONE_DELAY,
    BUILD_CAM_MARGIN,
    BUILD_CAM_MIN_HEIGHT,
    CAM_FOV,
    FREE_CAM_BASE_SPEED,
    FREE_CAM_SPEED_MAX,
    FREE_CAM_SPEED_MIN,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
} from './config.js';
import { state } from './state.js';
import { camera, scene } from './engine.js';
import { getBuildBounds, getBuildStatus } from './buildQueue.js';
import { isRecording, showTooltip, toggleBuildRecording } from './ui.js';
import { keys } from './input.js';
import { isGameActive } from './uiModal.js';

const TAN_HALF_FOV = Math.tan(((CAM_FOV / 2) * Math.PI) / 180);

let buildBoundsCache = null;  // 跟拍取景用的最后一次施工范围（任务完成瞬间队列已空，靠它撑到收尾）
let buildDoneTimer = 0;       // >0 = 施工已全部完成，倒计时收尾
let autoRecStarted = false;   // 本次跟拍的录像是否由本模块开启（负责自动停止；手动 R 开的不动）

// ==================== 模式切换 ====================
export function cycleCameraMode() {
    // 有施工任务时循环里带上跟拍；否则只在玩家/自由间切换
    const order = ['player', 'free'];
    if (state.camMode === 'build' || getBuildBounds()) order.push('build');
    const next = order[(order.indexOf(state.camMode) + 1) % order.length];
    setCamMode(next);
}

// 施工控件 🎥 按钮：直接进出跟拍
export function toggleBuildCam() {
    setCamMode(state.camMode === 'build' ? 'player' : 'build');
}

// 自由摄像头滚轮调速（input.js 分流）
export function adjustCamSpeed(dir) {
    state.camSpeed = Math.max(FREE_CAM_SPEED_MIN,
        Math.min(FREE_CAM_SPEED_MAX, state.camSpeed * (dir > 0 ? 1.15 : 1 / 1.15)));
    showTooltip(`🎥 摄像头速度：${state.camSpeed.toFixed(2)}x`);
}

export function setCamMode(next) {
    if (next === state.camMode) return;
    if (next !== 'player' && next !== 'free' && next !== 'build') return;
    if (next === 'build' && !getBuildBounds()) {
        showTooltip('🏗️ 当前没有施工任务，无可跟拍');
        return;
    }
    const prev = state.camMode;
    state.camMode = next;

    if (next === 'free') {
        // 从当前相机（可能是第三人称机位）平滑起跳，朝向沿用玩家视线
        const fc = state.freeCam;
        fc.x = camera.position.x;
        fc.y = camera.position.y;
        fc.z = camera.position.z;
        fc.yaw = state.player.yaw;
        fc.pitch = state.player.pitch;
    }
    if (prev === 'build' || next === 'build') buildDoneTimer = 0;
    if (prev === 'build') buildBoundsCache = null;

    if (next === 'build') {
        buildBoundsCache = getBuildBounds();
        // 运镜起点 = 当前机位（玩家/自由视角平滑飞到俯拍位，而不是瞬移）
        camPos.x = camera.position.x;
        camPos.y = camera.position.y;
        camPos.z = camera.position.z;
        if (!isRecording()) {
            toggleBuildRecording();
            autoRecStarted = isRecording(); // 浏览器不支持 MediaRecorder 时为 false，不影响跟拍
        }
    } else if (prev === 'build' && autoRecStarted && isRecording()) {
        toggleBuildRecording(); // 跟拍结束（手动退出）自动停录
        autoRecStarted = false;
    }

    applyEnvForMode(next);
    showTooltip({
        player: '🎥 回到玩家视角',
        free: '🎥 自由视角：WASD飞行 · 空格/Shift升降 · 滚轮调速 · C返回',
        build: '🎥 建造跟拍：俯视施工进度，建完自动停录（C返回）',
    }[next]);
}

// 非玩家视角放宽雾与远裁剪面：跟拍高度/自由飞行距离远超玩家视野参数
function applyEnvForMode(mode) {
    const wide = mode !== 'player';
    scene.fog.near = wide ? 300 : 40;
    scene.fog.far = wide ? 900 : 120;
    const far = wide ? 600 : 200;
    if (camera.far !== far) {
        camera.far = far;
        camera.updateProjectionMatrix();
    }
}

// 重置回玩家视角（死亡重生 / 开新世界时调用，相机与玩家重新绑定）
export function resetCamMode() {
    if (state.camMode === 'player') return;
    const prev = state.camMode;
    state.camMode = 'player';
    buildDoneTimer = 0;
    buildBoundsCache = null;
    if (prev === 'build' && autoRecStarted && isRecording()) {
        toggleBuildRecording();
        autoRecStarted = false;
    }
    applyEnvForMode('player');
}

// ==================== 每帧更新（main.js gameLoop 调用） ====================
export function updateCameraRig(dt) {
    if (state.camMode === 'free') updateFreeCam(dt);
    else if (state.camMode === 'build') updateBuildCam(dt);
}

// 自由摄像头：沿视线飞行（含俯仰），空格升 / Shift 降，与创造飞行键位一致
function updateFreeCam(dt) {
    const fc = state.freeCam;
    const k = isGameActive() ? keys : {};
    const cp = Math.cos(fc.pitch);
    const fwd = { x: -Math.sin(fc.yaw) * cp, y: Math.sin(fc.pitch), z: -Math.cos(fc.yaw) * cp };
    const right = { x: Math.cos(fc.yaw), z: -Math.sin(fc.yaw) };
    let mx = 0, my = 0, mz = 0;
    if (k['KeyW']) { mx += fwd.x; my += fwd.y; mz += fwd.z; }
    if (k['KeyS']) { mx -= fwd.x; my -= fwd.y; mz -= fwd.z; }
    if (k['KeyA']) { mx -= right.x; mz -= right.z; }
    if (k['KeyD']) { mx += right.x; mz += right.z; }
    if (k['Space']) my += 1;
    if (k['ShiftLeft'] || k['ShiftRight']) my -= 1;
    const len = Math.hypot(mx, my, mz);
    const speed = FREE_CAM_BASE_SPEED * state.camSpeed;
    if (len > 0) {
        fc.x += (mx / len) * speed * dt;
        fc.y += (my / len) * speed * dt;
        fc.z += (mz / len) * speed * dt;
    }
    // 世界范围约束（略微超出边界也允许，便于环拍边缘建筑）
    fc.x = Math.max(-16, Math.min(WORLD_WIDTH + 16, fc.x));
    fc.z = Math.max(-16, Math.min(WORLD_DEPTH + 16, fc.z));
    fc.y = Math.max(1, Math.min(WORLD_HEIGHT * 2.5, fc.y));

    camera.rotation.order = 'YXZ';
    camera.position.set(fc.x, fc.y, fc.z);
    camera.rotation.y = fc.yaw;
    camera.rotation.x = fc.pitch;
    camera.rotation.z = 0;
}

// 建造跟拍：俯视施工包围盒中心，高度按 CAM_FOV 与画面宽高比反推，把整个施工范围收进画面。
// 位置用指数平滑跟随（任务范围变化/新任务入队时运镜自然），俯视方向固定朝北不旋转，适合延时摄影。
function updateBuildCam(dt) {
    const b = getBuildBounds();
    if (b) {
        buildBoundsCache = b;
        buildDoneTimer = 0;
    } else if (buildBoundsCache) {
        // 队列已空（建造完成或被清空）：停在最后范围上倒计时收尾
        buildDoneTimer += dt;
        if (buildDoneTimer >= BUILD_CAM_DONE_DELAY) {
            finishBuildCam(true);
            return;
        }
    } else {
        finishBuildCam(false);
        return;
    }
    const c = buildBoundsCache;
    const cx = (c.minX + c.maxX + 1) / 2;
    const cy = (c.minY + c.maxY + 1) / 2;
    const cz = (c.minZ + c.maxZ + 1) / 2;
    const spanX = c.maxX - c.minX + 1;
    const spanZ = c.maxZ - c.minZ + 1;
    // 纯俯视下画面竖向对应 Z 跨度、横向对应 X 跨度×宽高比；俯视透视压缩，再留 12% 余量
    let h = Math.max(
        (spanZ + BUILD_CAM_MARGIN) / (2 * TAN_HALF_FOV),
        (spanX + BUILD_CAM_MARGIN) / (2 * TAN_HALF_FOV * camera.aspect),
        BUILD_CAM_MIN_HEIGHT,
    ) * 1.12;

    const s = Math.min(1, 3 * dt);
    camPos.x += (cx - camPos.x) * s;
    camPos.y += (cy + h - camPos.y) * s;
    camPos.z += (cz - camPos.z) * s;
    camera.rotation.order = 'YXZ';
    camera.position.set(camPos.x, camPos.y, camPos.z);
    camera.rotation.set(-Math.PI / 2, 0, 0);
}

// 跟拍运镜机位（指数平滑跟随目标俯拍位）
const camPos = { x: 0, y: 0, z: 0 };

// 跟拍收尾：自动停录（仅限本模块开启的录像）并回到玩家视角；
// 「录像已保存」提示由 MediaRecorder onstop 自己弹，这里不重复
function finishBuildCam(completed) {
    buildDoneTimer = 0;
    buildBoundsCache = null;
    state.camMode = 'player';
    if (autoRecStarted && isRecording()) {
        toggleBuildRecording();
    }
    autoRecStarted = false;
    applyEnvForMode('player');
    showTooltip(completed ? '✅ 建造完成，跟拍结束' : '🏗️ 施工任务已清空，回到玩家视角');
}

// 供 UI 显示当前模式名（调试信息）
export function camModeText() {
    return { player: '', free: '自由视角', build: '建造跟拍' }[state.camMode] || '';
}
