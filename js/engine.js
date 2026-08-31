// ==================== engine.js ====================

import * as THREE from 'three';
import { PLAYER_EYE_HEIGHT } from './config.js';
import { state } from './state.js';

// ==================== Three.js 初始化 ====================
export const canvas = document.getElementById('gameCanvas');

export const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

renderer.setSize(window.innerWidth, window.innerHeight);

renderer.shadowMap.enabled = true;

renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.outputColorSpace = THREE.SRGBColorSpace;

export const scene = new THREE.Scene();

scene.background = new THREE.Color(0x87ceeb);

scene.fog = new THREE.Fog(0x87ceeb, 40, 120);

export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

camera.position.set(state.player.x, state.player.y + PLAYER_EYE_HEIGHT, state.player.z);

// ==================== 光照 ====================
export const ambientLight = new THREE.AmbientLight(0x8899bb, 0.55);

scene.add(ambientLight);

export const sunLight = new THREE.DirectionalLight(0xffeedd, 1.4);

sunLight.castShadow = true;

sunLight.shadow.mapSize.width = 2048;

sunLight.shadow.mapSize.height = 2048;

sunLight.shadow.camera.near = 0.5;

sunLight.shadow.camera.far = 200;

sunLight.shadow.camera.left = -80;

sunLight.shadow.camera.right = 80;

sunLight.shadow.camera.top = 80;

sunLight.shadow.camera.bottom = -80;

sunLight.shadow.bias = -0.0005;

scene.add(sunLight);

export const hemisphereLight = new THREE.HemisphereLight(0x8899cc, 0x443322, 0.4);

scene.add(hemisphereLight);
