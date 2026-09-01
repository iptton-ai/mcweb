// ==================== highlight.js ====================

import * as THREE from 'three';
import { BlockTypes } from './config.js';
import { state } from './state.js';
import { scene } from './engine.js';
import { raycastBlocks } from './interaction.js';
import { kineticStatusAt } from './kinetic.js';

// ==================== 高亮选中方块 ====================
export const highlightGeometry = new THREE.BoxGeometry(1.005, 1.005, 1.005);

export const highlightEdges = new THREE.EdgesGeometry(highlightGeometry);

export const highlightLine = new THREE.LineSegments(highlightEdges, new THREE.LineBasicMaterial({
    color: 0x000000,
    linewidth: 2,
    transparent: true,
    opacity: 0.6,
}));

highlightLine.visible = false;

scene.add(highlightLine);

// 动力组状态 HUD：准星对准动力方块时常显转速/应力/故障（js/kinetic.js 的求解结果）
let kineticHud = null;

function ensureKineticHud() {
    if (kineticHud) return kineticHud;
    kineticHud = document.createElement('div');
    kineticHud.id = 'kinetic-hud';
    kineticHud.style.cssText =
        'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:50;' +
        'padding:4px 12px;border-radius:6px;background:rgba(20,20,34,.82);border:1px solid #4a4a6a;' +
        'color:#e8e8f4;font-size:13px;font-family:inherit;pointer-events:none;white-space:nowrap;';
    kineticHud.style.display = 'none';
    document.body.appendChild(kineticHud);
    return kineticHud;
}

export function updateHighlight() {
    // 自由摄像头/建造跟拍视角下准星不再是玩家视线，不显示高亮框
    if (state.camMode !== 'player') {
        highlightLine.visible = false;
        if (kineticHud) kineticHud.style.display = 'none';
        return;
    }
    const hit = raycastBlocks();
    if (hit && hit.block !== BlockTypes.AIR && hit.block !== BlockTypes.WATER) {
        highlightLine.visible = true;
        highlightLine.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
        highlightLine.visible = false;
    }
    const hud = ensureKineticHud();
    const status = hit ? kineticStatusAt(hit.x, hit.y, hit.z) : null;
    if (status) {
        hud.textContent = status;
        hud.style.display = '';
    } else {
        hud.style.display = 'none';
    }
}
