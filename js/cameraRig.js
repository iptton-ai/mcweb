// 施工拍摄会话与镜头互相独立：换镜头不切片，用户开始的录像只能由用户停止。
import * as THREE from 'three';
import { BUILD_CAM_CINEMATIC_IDX, BUILD_CAM_CINEMATIC_MAX_IDX, BUILD_CAM_DONE_DELAY,
    BUILD_CAM_MARGIN, BUILD_CAM_MIN_HEIGHT, BUILD_CAM_REVEAL_SCALE,
    FREE_CAM_BASE_SPEED, FREE_CAM_SPEED_MAX, FREE_CAM_SPEED_MIN,
    WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { state } from './state.js';
import { camera, scene } from './engine.js';
import { getBuildBounds, isAgentHold, setBuildSpeedIdx } from './buildQueue.js';
import { isCamOwnedRecording, isRecording, stopRecording, toggleBuildRecording } from './recording.js';
import { showTooltip } from './ui.js';
import { keys, clearKeys } from './input.js';
import { isGameActive } from './uiModal.js';
import { getBlock } from './world.js';
import { isSolid } from './chunk.js';

let bounds = null;
let active = false;
let doneTime = 0;
let savedSpeed = null;
let startedWithAuto = false;
let userChoseCamera = false;
let frame = null;
let frameKey = '';
const direction = new THREE.Vector3(0.65, 0.9, 1).normalize();
const freeRotation = new THREE.Euler(0, 0, 0, 'YXZ');

function rememberBounds(b) {
    if (!b) return;
    if (!bounds) bounds = { ...b };
    else for (const axis of ['X', 'Y', 'Z']) {
        bounds['min' + axis] = Math.min(bounds['min' + axis], b['min' + axis]);
        bounds['max' + axis] = Math.max(bounds['max' + axis], b['max' + axis]);
    }
}
function slowDown() {
    if (savedSpeed !== null || state.buildSpeedIdx <= BUILD_CAM_CINEMATIC_MAX_IDX) return;
    savedSpeed = state.buildSpeedIdx;
    setBuildSpeedIdx(BUILD_CAM_CINEMATIC_IDX);
}
function restoreSpeed() {
    // 用户在拍摄途中调整过速度时保留其选择。
    if (savedSpeed !== null && state.buildSpeedIdx === BUILD_CAM_CINEMATIC_IDX) setBuildSpeedIdx(savedSpeed);
    savedSpeed = null;
}

export function getBuildFilmingStatus() {
    return { active, waiting: active ? !getBuildBounds() && isAgentHold() : state.camMode === 'build' && !bounds,
        finishing: active && doneTime > 0, remaining: Math.max(0, BUILD_CAM_DONE_DELAY - doneTime),
        autoRecord: state.buildAutoRecord, bounds: bounds ? { ...bounds } : null };
}

// 必须在本帧施工消费队列之前调用，否则小任务会在镜头发现它前一帧建完。
export function updateBuildFilming(dt) {
    const b = getBuildBounds();
    if (b) {
        if (!active) {
            active = true;
            bounds = null;
            frameKey = '';
            doneTime = 0;
            userChoseCamera = false;
            startedWithAuto = state.buildAutoRecord && !isRecording();
            rememberBounds(b);
            if (startedWithAuto) {
                setCamMode('build', false);
                slowDown();
                updateBuildCamera(0); // 先就位，录像第一帧即是施工全景
                toggleBuildRecording('cam'); // 每个会话仅尝试一次；手动停录后不重开
            }
        }
        rememberBounds(b);
        doneTime = 0;
    } else if (active) {
        if (isAgentHold()) { doneTime = 0; return; }
        doneTime += dt;
        if (doneTime >= BUILD_CAM_DONE_DELAY) {
            if (isCamOwnedRecording()) stopRecording();
            active = false;
            restoreSpeed();
            // 主动切过镜头的用户保留所选镜头；手动录像也不被收尾切走。
            if (startedWithAuto && !userChoseCamera && !isRecording() && state.camMode === 'build') setCamMode('player', false);
            showTooltip('✅ 施工完成；可用「自动取景」查看成品');
        }
    }
}

export function cycleCameraMode() {
    const modes = ['player', 'build', 'free'];
    setCamMode(modes[(modes.indexOf(state.camMode) + 1) % modes.length]);
}
export function toggleBuildCam() { setCamMode(state.camMode === 'build' ? 'player' : 'build'); }
export function adjustCamSpeed(dir) {
    state.camSpeed = Math.max(FREE_CAM_SPEED_MIN, Math.min(FREE_CAM_SPEED_MAX, state.camSpeed * (dir > 0 ? 1.15 : 1 / 1.15)));
    showTooltip(`🎥 移动速度：${state.camSpeed.toFixed(2)}x`);
}
export function setCamMode(next, fromUser = true) {
    if (!['player', 'free', 'build'].includes(next)) return;
    if (fromUser && active) userChoseCamera = true;
    if (next === state.camMode) return;
    clearKeys();
    state.camMode = next;
    if (next === 'free') {
        // 相机可能刚从自动取景接管，真实姿态与玩家看向完全不同。
        freeRotation.setFromQuaternion(camera.quaternion, 'YXZ');
        Object.assign(state.freeCam, { x: camera.position.x, y: camera.position.y, z: camera.position.z,
            yaw: freeRotation.y, pitch: freeRotation.x });
    }
    if (next === 'build') {
        rememberBounds(getBuildBounds());
        frameKey = '';
        if (active) slowDown();
        updateBuildCamera(0);
    }
    applyEnvForMode(next);
    if (fromUser) showTooltip({ player: '玩家视角 · 录像继续由录制按钮控制',
        free: '手动调镜 · 鼠标转向，WASD 移动，空格 / Shift 升降，滚轮调速',
        build: bounds ? '自动取景 · 已框住施工范围' : '自动取景待机 · AI 开工后对准施工范围' }[next]);
}
function applyEnvForMode(mode) {
    const wide = mode !== 'player';
    scene.fog.near = wide ? 1200 : 40;
    scene.fog.far = wide ? 3000 : 120;
    const far = wide ? 4000 : 200;
    if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
}
export function resetCamMode() { setCamMode('player', false); }
export function resetBuildFilming() {
    if (isCamOwnedRecording()) stopRecording();
    restoreSpeed();
    active = false;
    bounds = null;
    frame = null;
    frameKey = '';
    doneTime = 0;
    startedWithAuto = false;
    userChoseCamera = false;
    resetCamMode();
}
export function updateCameraRig(dt) {
    if (state.camMode === 'free') updateFreeCam(dt);
    else if (state.camMode === 'build') updateBuildCamera(dt);
}

function updateFreeCam(dt) {
    const fc = state.freeCam;
    const k = isGameActive() && !state.recordingControlsOpen ? keys : {};
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
    fc.x = Math.max(-2000, Math.min(WORLD_WIDTH + 2000, fc.x));
    fc.z = Math.max(-2000, Math.min(WORLD_DEPTH + 2000, fc.z));
    fc.y = Math.max(1, Math.min(2000, fc.y));

    camera.rotation.order = 'YXZ';
    camera.position.set(fc.x, fc.y, fc.z);
    camera.rotation.y = fc.yaw;
    camera.rotation.x = fc.pitch;
    camera.rotation.z = 0;
}

// 根据 8 个包围盒角点在相机平面上的投影，同时覆盖建筑宽度、深度和高度。
function fitFrame(d) {
    const center = new THREE.Vector3((bounds.minX + bounds.maxX + 1) / 2,
        (bounds.minY + bounds.maxY + 1) / 2, (bounds.minZ + bounds.maxZ + 1) / 2);
    const right = new THREE.Vector3(d.z, 0, -d.x).normalize();
    const up = new THREE.Vector3().crossVectors(d, right);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanH = tanV * camera.aspect;
    let distance = BUILD_CAM_MIN_HEIGHT;
    for (const x of [bounds.minX, bounds.maxX + 1]) for (const y of [bounds.minY, bounds.maxY + 1]) for (const z of [bounds.minZ, bounds.maxZ + 1]) {
        const v = new THREE.Vector3(x, y, z).sub(center);
        distance = Math.max(distance, v.dot(d) + Math.max(Math.abs(v.dot(right)) / tanH, Math.abs(v.dot(up)) / tanV) * 1.15 + BUILD_CAM_MARGIN);
    }
    return { center, distance, direction: d.clone() };
}
function obstruction(f) {
    const pos = f.center.clone().addScaledVector(f.direction, f.distance);
    const targets = [f.center];
    for (const x of [bounds.minX + 0.25, bounds.maxX + 0.75])
        for (const y of [bounds.minY + 0.25, bounds.maxY + 0.75])
            for (const z of [bounds.minZ + 0.25, bounds.maxZ + 0.75]) targets.push(new THREE.Vector3(x, y, z));
    let hits = 0;
    const ray = new THREE.Vector3();
    const point = new THREE.Vector3();
    // 检查中心与八角的视线，只有中心通畅仍可能被近处树冠遮住整面外墙。
    for (const target of targets) {
        ray.subVectors(target, pos);
        const length = ray.length();
        ray.normalize();
        for (let t = 0; t < length; t += 2) {
            point.copy(pos).addScaledVector(ray, t);
            if (point.x >= bounds.minX && point.x <= bounds.maxX + 1 && point.y >= bounds.minY && point.y <= bounds.maxY + 1 && point.z >= bounds.minZ && point.z <= bounds.maxZ + 1) break;
            if (isSolid(getBlock(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z)))) hits++;
        }
    }
    return hits;
}
export function updateBuildCamera(dt) {
    if (!bounds) return;
    const key = Object.values(bounds).join(',') + ':' + camera.fov + ':' + camera.aspect;
    if (key !== frameKey) {
        frameKey = key;
        frame = fitFrame(direction);
        let best = obstruction(frame);
        if (best) {
            // 八个侧面与更高的俯角中选择较通畅的方向，只在范围变化时计算。
            for (const height of [0.9, 1.8, 3.5]) for (let a = 0; a < 8 && best > 0; a++) {
                const d = new THREE.Vector3(Math.sin(a * Math.PI / 4), height, Math.cos(a * Math.PI / 4)).normalize();
                const candidate = fitFrame(d);
                const score = obstruction(candidate);
                if (score < best) { frame = candidate; best = score; }
            }
        }
        direction.copy(frame.direction);
    }
    const reveal = Math.min(1, doneTime / BUILD_CAM_DONE_DELAY) * BUILD_CAM_REVEAL_SCALE;
    camera.position.copy(frame.center).addScaledVector(frame.direction, frame.distance * (1 + reveal));
    camera.rotation.order = 'YXZ';
    camera.lookAt(frame.center);
    camera.updateMatrixWorld();
}
export function camModeText() {
    return { player: '', free: '手动调镜', build: '自动取景' }[state.camMode] || '';
}
