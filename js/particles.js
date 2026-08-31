// ==================== particles.js ====================

import * as THREE from 'three';
import { BlockInfo } from './config.js';
import { scene } from './engine.js';

// ==================== 粒子效果 ====================
export const particleSystem = {
    geometry: null,
    material: null,
    points: null,
    particles: [],
};

export function initParticles() {
    const maxParticles = 2000;
    particleSystem.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(maxParticles * 3);
    const colors = new Float32Array(maxParticles * 3);
    const sizes = new Float32Array(maxParticles);
    particleSystem.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleSystem.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particleSystem.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    particleSystem.material = new THREE.PointsMaterial({
        size: 0.08,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        sizeAttenuation: true,
    });
    particleSystem.points = new THREE.Points(particleSystem.geometry, particleSystem.material);
    particleSystem.points.visible = false;
    scene.add(particleSystem.points);
}

export function spawnBreakParticles(bx, by, bz, blockType) {
    const color = new THREE.Color(BlockInfo[blockType]?.color || '#888888');
    const blockColor = color.clone();
    for (let i = 0; i < 12; i++) {
        if (particleSystem.particles.length >= 2000) particleSystem.particles.shift();
        particleSystem.particles.push({
            x: bx + 0.5,
            y: by + 0.5,
            z: bz + 0.5,
            vx: (Math.random() - 0.5) * 3,
            vy: Math.random() * 4 + 1,
            vz: (Math.random() - 0.5) * 3,
            life: 0.4 + Math.random() * 0.4,
            maxLife: 0.8,
            color: blockColor,
            size: 0.05 + Math.random() * 0.06,
        });
    }
    particleSystem.points.visible = true;
}

export function updateParticles(dt) {
    const particles = particleSystem.particles;
    const positions = particleSystem.geometry.attributes.position.array;
    const colors = particleSystem.geometry.attributes.color.array;
    const sizes = particleSystem.geometry.attributes.size.array;

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        p.vy -= 15 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0) { p.y = 0;
            p.vy = -p.vy * 0.3; }
        const idx = i * 3;
        positions[idx] = p.x;
        positions[idx + 1] = p.y;
        positions[idx + 2] = p.z;
        const alpha = p.life / p.maxLife;
        colors[idx] = p.color.r * alpha;
        colors[idx + 1] = p.color.g * alpha;
        colors[idx + 2] = p.color.b * alpha;
        sizes[i] = p.size * alpha;
    }

    const count = particles.length;
    particleSystem.geometry.attributes.position.needsUpdate = true;
    particleSystem.geometry.attributes.color.needsUpdate = true;
    particleSystem.geometry.attributes.size.needsUpdate = true;
    particleSystem.geometry.setDrawRange(0, count);
    if (count === 0) particleSystem.points.visible = false;
}
