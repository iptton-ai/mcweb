// ==================== daynight.js ====================
// 昼夜循环与天空（2026-09-05 对齐参考版补齐夜空氛围）：
//   日光/环境光/天空色/雾随昼夜插值（原有逻辑），新增：
//   · 星空：550 颗星的球冠点云，夜晚淡入白天淡出，随相机平移（永远罩在头顶）
//   · 云层：40 块实例化薄板在高空缓慢漂移（世界坐标内循环，笼罩整个 128×128 世界）
//   · 日/月盘：两块自发光面片挂在太阳方向与反方向，始终朝向相机

import * as THREE from 'three';
import { state } from './state.js';
import { ambientLight, camera, hemisphereLight, scene, sunLight } from './engine.js';

let stars = null;
let clouds = null;
let cloudBase = []; // 每朵云的基准位形（x 漂移取模包裹，见 buildSky/update）
let cloudDrift = 0;
const cloudMatrix = new THREE.Matrix4();
let sunDisc = null;
let moonDisc = null;
let cloudMat = null;

function buildSky() {
    if (stars) return; // 只建一次

    // 星空：上半球均匀撒点，亮度随机（fog:false——星星不吃雾）
    const N = 550;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = Math.random() * 0.92 + 0.08; // 只放上半球
        const r = Math.sqrt(1 - v * v);
        pos[i * 3] = Math.cos(a) * r * 220;
        pos[i * 3 + 1] = v * 220;
        pos[i * 3 + 2] = Math.sin(a) * r * 220;
        const b = 0.45 + Math.random() * 0.55;
        col[i * 3] = b * 0.9;
        col[i * 3 + 1] = b * 0.95;
        col[i * 3 + 2] = b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
        size: 1.7,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
    }));
    stars.renderOrder = -90; // 先于一切画天空层
    scene.add(stars);

    // 云层：高空缓慢漂移的实例化薄板。每朵云的世界 X 逐帧取模包裹在 [-400,400)——
    // 视野内永远有云、回绕无缝（世界只有 128 宽，±400 的边界远在视野外）
    const cloudGeo = new THREE.BoxGeometry(1, 1, 1);
    cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, 40);
    clouds.frustumCulled = false;
    cloudBase = [];
    for (let i = 0; i < 40; i++) {
        cloudBase.push({
            x: (Math.random() - 0.5) * 800,
            z: (Math.random() - 0.5) * 500,
            y: 72 + Math.random() * 10, // 世界高 64，云在 72~82
            w: 14 + Math.random() * 18,
            d: 10 + Math.random() * 14,
        });
    }
    scene.add(clouds);

    // 日/月盘：自发光面片（不受光照、不吃雾），挂在太阳方向/反方向
    sunDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(26, 26),
        new THREE.MeshBasicMaterial({ color: 0xfff0a8, fog: false, depthWrite: false, transparent: true }),
    );
    moonDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(15, 15),
        new THREE.MeshBasicMaterial({ color: 0xd8dcee, fog: false, depthWrite: false, transparent: true }),
    );
    sunDisc.renderOrder = -89;
    moonDisc.renderOrder = -89;
    scene.add(sunDisc, moonDisc);
}

// ==================== 昼夜循环 ====================
export function updateDayNightCycle(dt) {
    buildSky();
    state.time += dt;
    const dayProgress = (state.time % state.dayLength) / state.dayLength;
    const sunAngle = dayProgress * Math.PI * 2;

    // 太阳位置
    const sunHeight = Math.sin(sunAngle - Math.PI * 0.5);
    const sunHorizontal = Math.cos(sunAngle - Math.PI * 0.5);
    const sunX = sunHorizontal;
    const sunY = sunHeight;
    const sunZ = Math.cos(sunAngle) * 0.3;

    sunLight.position.set(sunX * 80, sunY * 80, sunZ * 80);
    sunLight.target.position.set(0, 0, 0);
    sunLight.target.updateMatrixWorld();

    const dayFactor = Math.max(0, Math.min(1, sunHeight + 0.1));
    const nightFactor = 1 - dayFactor;

    sunLight.intensity = 0.2 + dayFactor * 1.3;
    ambientLight.intensity = 0.25 + dayFactor * 0.35;
    hemisphereLight.intensity = 0.2 + dayFactor * 0.25;

    // 天空颜色
    const daySky = new THREE.Color(0x87ceeb);
    const sunsetSky = new THREE.Color(0xff8855);
    const nightSky = new THREE.Color(0x0a0a2a);
    let skyColor;
    if (dayFactor > 0.5) {
        skyColor = daySky.clone().lerp(sunsetSky, (1 - dayFactor) * 2);
    } else {
        skyColor = sunsetSky.clone().lerp(nightSky, (0.5 - dayFactor) * 2);
    }
    scene.background = skyColor;
    scene.fog.color = skyColor;
    scene.fog.density = 0.008 + nightFactor * 0.01;

    // 星空：夜晚淡入（黎明/黄昏跟随余晖），罩在相机头顶随玩家走；缓慢自转
    stars.material.opacity = Math.max(0, Math.min(0.9, nightFactor * 1.4 - 0.15));
    stars.position.set(camera.position.x, 0, camera.position.z);
    stars.rotation.y += dt * 0.004;

    // 云层：白天雪白、夜里压暗，缓慢向东漂移（每朵独立在 ±400 内取模回绕）
    cloudMat.color.setScalar(0.55 + dayFactor * 0.45);
    cloudMat.opacity = 0.5 + dayFactor * 0.3;
    cloudDrift += dt * 1.4;
    for (let i = 0; i < cloudBase.length; i++) {
        const c = cloudBase[i];
        const wx = ((((c.x + cloudDrift) % 800) + 800) % 800) - 400;
        cloudMatrix.makeScale(c.w, 1.4, c.d);
        cloudMatrix.setPosition(wx, c.y, c.z + 64); // 世界 Z 中心 64
        clouds.setMatrixAt(i, cloudMatrix);
    }
    clouds.instanceMatrix.needsUpdate = true;

    // 日/月盘：沿太阳方向挂在远处（相机跟随），面片始终正对相机
    const discDist = 190;
    const cam = camera.position;
    sunDisc.position.set(cam.x + sunX * discDist, cam.y + sunY * discDist, cam.z + sunZ * discDist);
    sunDisc.lookAt(cam);
    sunDisc.material.opacity = Math.max(0, Math.min(1, sunHeight * 3 + 0.4)); // 地平线下隐没
    moonDisc.position.set(cam.x - sunX * discDist, cam.y - sunY * discDist, cam.z - sunZ * discDist);
    moonDisc.lookAt(cam);
    moonDisc.material.opacity = Math.max(0, Math.min(0.9, -sunHeight * 3));

    state.sunAngle = sunAngle;
}
