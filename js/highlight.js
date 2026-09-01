// ==================== highlight.js ====================

import * as THREE from 'three';
import { BlockTypes } from './config.js';
import { state } from './state.js';
import { scene } from './engine.js';
import { raycastBlocks } from './interaction.js';

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

export function updateHighlight() {
    // 自由摄像头/建造跟拍视角下准星不再是玩家视线，不显示高亮框
    if (state.camMode !== 'player') {
        highlightLine.visible = false;
        return;
    }
    const hit = raycastBlocks();
    if (hit && hit.block !== BlockTypes.AIR && hit.block !== BlockTypes.WATER) {
        highlightLine.visible = true;
        highlightLine.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
        highlightLine.visible = false;
    }
}
