// ==================== playerLife.js ====================
// 生命 + 生存进度组（2026-09-05 对齐参考版）：
//   饥饿：移动消耗（疾跑 ×2.7、站立 ×0.2），每 45 秒掉 1 点；≥17 每 5 秒回 1 血，=0 饿到只剩 1 血
//   氧气：头部没入水倒数 10 秒，归零每 1.5 秒扣 2 血；出水 3 倍速恢复
//   经验：合成 +1、挖矿按矿石、杀敌对生物 +3——纯计分（HUD 显示 ✨）
//   食物：右键进食（apple +4 / 生猪排 +3 / 熟猪排 +8，见 config.js BlockInfo.food）

import { BlockInfo, HUNGER_DRAIN_SEC, HUNGER_REGEN_MIN, HUNGER_REGEN_SEC, MAX_AIR, MAX_HEALTH, MAX_HUNGER } from './config.js';
import { isCreative, state } from './state.js';
import { scene } from './engine.js';
import { playHitSound } from './audio.js';
import { notifyPlayerHit } from './bgm.js';
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
    notifyPlayerHit(); // 喂给 bgm.js：切战斗配乐
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
    p.hunger = MAX_HUNGER;
    p.air = MAX_AIR;
    p.invulnTimer = 2;
    p.fallStartY = null;
    resetCamMode(); // 摄像头可能停在自由/跟拍机位，重生后回到玩家视角看重生点
    p.x = state.spawn.x;
    p.y = state.spawn.y;
    p.z = state.spawn.z;
    p.vx = p.vy = p.vz = 0;
    // 死亡不再清背包（2026-09-05 起工具有合成成本，清空惩罚过重；对齐参考版「在出生点重生」）
    document.getElementById('death-screen').classList.remove('visible');
    updateHealthUI();
    updateHotbar();
    // 清掉所有怪物
    for (let i = state.enemies.length - 1; i >= 0; i--) killEnemySilent(state.enemies[i]);
    setState('playing'); // 状态机负责重新锁定指针（失败时显示「点击继续」并自动重试）
}

// ==================== 经验 ====================
export function addXp(n) {
    state.player.xp = Math.max(0, (state.player.xp || 0) + n);
    updateXpUI();
}

// ==================== 进食 ====================
// interaction.js 右键手持食物时调用 doEat：返回 true=已吃，'full'=饱了吃不下，false=不是食物
export function doEat(itemId) {
    const p = state.player;
    const info = BlockInfo[itemId];
    if (!info?.food) return false;
    if (isCreative()) return false; // 创造模式没有饥饿条，吃不了（原版行为）
    if (p.hunger >= MAX_HUNGER) return 'full';
    if ((p.inventory[itemId] || 0) <= 0) return false;
    p.inventory[itemId]--;
    p.hunger = Math.min(MAX_HUNGER, p.hunger + info.food);
    updateHealthUI();
    updateHotbar();
    return true;
}

// ==================== 生存状态每帧驱动（main.js gameLoop 调用，仅生存模式）====================
export function updateSurvivalStats(dt) {
    const p = state.player;
    if (p.dead || isCreative()) return;
    // 「在移动」判定：实际产生水平位移且在地面（游泳消耗减半，原地划水不算）
    const moving = Math.hypot(p.vx, p.vz) > 0.6 && (p.onGround || p.inWater);

    // 饥饿消耗：移动 45 秒 / 点，疾跑 ×2.7，站立 ×0.2
    p.hungerTimer = (p.hungerTimer || 0) + dt * (moving ? (p.sprinting ? 2.7 : 1) : 0.2);
    if (p.hungerTimer > HUNGER_DRAIN_SEC) {
        p.hungerTimer = 0;
        p.hunger = Math.max(0, p.hunger - 1);
        updateHealthUI();
    }

    // 氧气：头部没入水（playerPhysics 置 underwater 标志）倒数；归零每 1.5 秒扣 2 血
    if (p.underwater) {
        p.air -= dt;
        if (p.air < 0) {
            p.air = 1.5; // 扣一次血后再给 1.5 秒（对齐参考版节奏）
            p.invulnTimer = 0; // 溺水无视无敌帧，否则和怪物伤害互相顶掉
            damagePlayer(2);
        }
        updateAirUI();
    } else if (p.air < MAX_AIR) {
        p.air = Math.min(MAX_AIR, p.air + dt * 3); // 出水恢复快
        updateAirUI();
    }

    // 每 5 秒一次判定：饱腹回血 / 饿肚子掉血（最低掉到 1 血，饿不死——对齐参考版）
    p.regenTimer = (p.regenTimer || 0) + dt;
    if (p.regenTimer > HUNGER_REGEN_SEC) {
        p.regenTimer = 0;
        if (p.hunger >= HUNGER_REGEN_MIN && p.health < MAX_HEALTH) {
            p.health = Math.min(MAX_HEALTH, p.health + 1);
            p.hungerTimer = (p.hungerTimer || 0) + 8; // 回血额外消耗饥饿
            updateHealthUI();
        } else if (p.hunger <= 0 && p.health > 1) {
            p.invulnTimer = 0;
            damagePlayer(1);
            showHungerWarn();
        }
    }
}

function showHungerWarn() {
    const tip = document.getElementById('tooltip');
    if (tip && !tip.classList.contains('visible')) {
        tip.textContent = '🍖 饿得发慌，赶紧吃点东西（打树叶找苹果 / 猎猪）';
        tip.classList.add('visible');
        setTimeout(() => tip.classList.remove('visible'), 1600);
    }
}

// ==================== HUD ====================
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
    updateHungerUI();
    updateAirUI();
    updateXpUI();
    const badge = document.getElementById('mode-badge');
    badge.textContent = isCreative() ? '🏗️ 建造模式（按 M 切换为生存）' : '⚔️ 生存模式（按 M 切换为建造）';
}

function updateHungerUI() {
    const bar = document.getElementById('hunger-bar');
    if (!bar) return;
    if (isCreative()) {
        bar.classList.remove('visible');
        bar.innerHTML = '';
        return;
    }
    bar.classList.add('visible');
    const full = Math.ceil(state.player.hunger / 2);
    const empty = 10 - full;
    bar.innerHTML = '🍗'.repeat(Math.max(0, full)) + '▫️'.repeat(Math.max(0, empty));
}

// 氧气泡：满氧时不显示，入水后按剩余秒数显示（10 泡 → 0）
function updateAirUI() {
    const bar = document.getElementById('air-bar');
    if (!bar) return;
    const p = state.player;
    if (isCreative() || p.air >= MAX_AIR) {
        bar.classList.remove('visible');
        bar.innerHTML = '';
        return;
    }
    bar.classList.add('visible');
    const bubbles = Math.ceil(Math.max(0, p.air));
    bar.innerHTML = '🫧'.repeat(bubbles);
}

export function updateXpUI() {
    const el = document.getElementById('xp-badge');
    if (!el) return;
    if (isCreative()) {
        el.classList.remove('visible');
        return;
    }
    el.classList.add('visible');
    el.textContent = `✨ ${state.player.xp || 0}`;
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
