// ==================== daynight.js ====================

import * as THREE from 'three';
import { state } from './state.js';
import { ambientLight, hemisphereLight, scene, sunLight } from './engine.js';

// ==================== 昼夜循环 ====================
export function updateDayNightCycle(dt) {
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

    state.sunAngle = sunAngle;
}
