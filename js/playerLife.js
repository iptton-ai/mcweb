// ==================== playerLife.js ====================

import { MAX_HEALTH } from './config.js';
import { isCreative, state } from './state.js';
import { scene } from './engine.js';
import { playHitSound } from './audio.js';
import { killEnemySilent } from './entities.js';
import { updateHotbar } from './ui.js';
import { setState } from './uiModal.js';
import { resetCamMode } from './cameraRig.js';

// ==================== 玩家伤害与重生 ====================
export function damagePlayer(dmg) {
    const p = state.player;
    if (isCreative() || p.dead || p.invulnTimer > 0) return;
    p.health -= dmg;
    p.invulnTimer = 0.5;
    updateHealthUI();
    playHitSound();
    const flash = document.getElementById('damage-flash');
    flash.classList.add('hit');
    setTimeout(() => flash.classList.remove('hit'), 80);
    if (p.health <= 0) {
        p.health = 0;
        die();
    }
}

export function die() {
    const p = state.player;
    p.dead = true;
    document.getElementById('death-screen').classList.add('visible');
    setState('dead'); // 状态机负责解锁指针，且死亡时不会误弹暂停菜单
}

export function respawn() {
    const p = state.player;
    p.dead = false;
    p.health = MAX_HEALTH;
    p.invulnTimer = 2;
    resetCamMode(); // 摄像头可能停在自由/跟拍机位，重生后回到玩家视角看重生点
    p.x = state.spawn.x;
    p.y = state.spawn.y;
    p.z = state.spawn.z;
    p.vx = p.vy = p.vz = 0;
    p.inventory = {}; // 死亡惩罚：清空背包
    document.getElementById('death-screen').classList.remove('visible');
    updateHealthUI();
    updateHotbar();
    // 清掉所有怪物
    for (let i = state.enemies.length - 1; i >= 0; i--) killEnemySilent(state.enemies[i]);
    setState('playing'); // 状态机负责重新锁定指针（失败时显示「点击继续」并自动重试）
}

export function updateHealthUI() {
    const bar = document.getElementById('health-bar');
    if (isCreative()) {
        bar.classList.remove('visible');
        bar.innerHTML = '';
    } else {
        bar.classList.add('visible');
        const full = Math.ceil(state.player.health / 2);
        const empty = 10 - full;
        bar.innerHTML = '❤️'.repeat(Math.max(0, full)) + '🖤'.repeat(Math.max(0, empty));
    }
    const badge = document.getElementById('mode-badge');
    badge.textContent = isCreative() ? '🏗️ 建造模式（按 M 切换为生存）' : '⚔️ 生存模式（按 M 切换为建造）';
}

// ==================== 掉落物更新 ====================
export function updateDroppedItems(dt) {
    for (let i = state.droppedItems.length - 1; i >= 0; i--) {
        const it = state.droppedItems[i];
        if (it.prop) continue; // 固定道具不消失
        it.life -= dt;
        if (it.life <= 0) {
            scene.remove(it.mesh);
            state.droppedItems.splice(i, 1);
            continue;
        }
        it.mesh.rotation.y += dt * 2;
    }
}
