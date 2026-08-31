// ==================== ui.js ====================

import { BlockInfo, BlockTypes, GameModes, HotbarBlocks } from './config.js';
import { isCreative, isNight, state } from './state.js';
import { canvas } from './engine.js';
import { atlasCanvas, blockUVs, tileSize } from './textures.js';
import { raycastBlocks } from './interaction.js';
import { killEnemySilent, mobSpawnTick } from './entities.js';
import { updateHealthUI } from './playerLife.js';
import { closeInventory } from './input.js';

// ==================== 游戏模式切换 ====================
export function setGameMode(mode) {
    state.gameMode = mode;
    const p = state.player;
    if (mode === GameModes.SURVIVAL) {
        p.flying = false;
        // 切到生存时如果是夜晚，立即来一波怪（走正常生成规则，不会贴脸）
        if (isNight() && state.enemies.length === 0) {
            for (let i = 0; i < 3; i++) mobSpawnTick();
        }
    } else {
        // 切回建造：清空怪物
        for (let i = state.enemies.length - 1; i >= 0; i--) killEnemySilent(state.enemies[i]);
    }
    updateHealthUI();
}

export function toggleGameMode() {
    setGameMode(isCreative() ? GameModes.SURVIVAL : GameModes.CREATIVE);
    showTooltip(isCreative() ? '🏗️ 已切换到建造模式' : '⚔️ 已切换到生存模式');
}

// ==================== UI ====================
export function updateHotbar() {
    const hotbar = document.getElementById('hotbar');
    hotbar.innerHTML = '';
    HotbarBlocks.forEach((blockType, index) => {
        const slot = document.createElement('div');
        slot.className = 'hotbar-slot' + (index === state.player.selectedSlot ? ' selected' : '');
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        const uv = blockUVs[blockType] || blockUVs[BlockTypes.STONE];
        const tile = uv.top || { x: 0, y: 0 };
        const sx = tile.x * tileSize;
        const sy = tile.y * tileSize;
        ctx.drawImage(atlasCanvas, sx, sy, tileSize, tileSize, 0, 0, 16, 16);
        slot.appendChild(canvas);
        const numSpan = document.createElement('span');
        numSpan.className = 'slot-number';
        numSpan.textContent = index + 1;
        slot.appendChild(numSpan);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'block-name';
        nameSpan.textContent = BlockInfo[blockType].name;
        slot.appendChild(nameSpan);
        slot.addEventListener('click', () => {
            state.player.selectedSlot = index;
            updateHotbar();
            showTooltip(BlockInfo[blockType].name);
        });
        hotbar.appendChild(slot);
    });
}

export function buildInventoryGrid() {
    const grid = document.getElementById('inventory-grid');
    grid.innerHTML = '';
    HotbarBlocks.forEach((blockType) => {
        const slot = document.createElement('div');
        slot.className = 'inv-slot';
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        const uv = blockUVs[blockType] || blockUVs[BlockTypes.STONE];
        const tile = uv.top || { x: 0, y: 0 };
        const sx = tile.x * tileSize;
        const sy = tile.y * tileSize;
        ctx.drawImage(atlasCanvas, sx, sy, tileSize, tileSize, 0, 0, 24, 24);
        slot.appendChild(canvas);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'inv-name';
        nameSpan.textContent = BlockInfo[blockType].name;
        slot.appendChild(nameSpan);
        slot.addEventListener('click', () => {
            state.player.selectedSlot = HotbarBlocks.indexOf(blockType);
            updateHotbar();
            closeInventory();
            showTooltip(BlockInfo[blockType].name);
        });
        grid.appendChild(slot);
    });
}

export let tooltipTimeout = null;

export function showTooltip(text) {
    const tooltip = document.getElementById('tooltip');
    tooltip.textContent = text;
    tooltip.classList.add('visible');
    if (tooltipTimeout) clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => {
        tooltip.classList.remove('visible');
    }, 1200);
}

export function updateDebugInfo() {
    const p = state.player;
    document.getElementById('dbg-pos').textContent =
        `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    document.getElementById('dbg-chunk').textContent =
        `${Math.floor(p.x / CHUNK_SIZE)}, ${Math.floor(p.z / CHUNK_SIZE)}`;
    document.getElementById('dbg-fps').textContent = state.fps;
    const hours = Math.floor(state.time / 60) % 24;
    const mins = Math.floor(state.time % 60);
    document.getElementById('dbg-time').textContent =
        `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    const yawDeg = ((p.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const dirs = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
    const dirIndex = Math.round(yawDeg / 45) % 8;
    document.getElementById('dbg-dir').textContent = dirs[dirIndex];
    document.getElementById('dbg-mobs').textContent = state.enemies.length;
    document.getElementById('dbg-view').textContent = ['第一人称', '第三人称(背后)', '第三人称(正面)'][state.viewMode];
    const hit = raycastBlocks();
    if (hit) {
        document.getElementById('dbg-selected').textContent = BlockInfo[hit.block]?.name || '未知';
    } else {
        document.getElementById('dbg-selected').textContent = '-';
    }
}
