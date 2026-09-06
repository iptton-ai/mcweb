// ==================== ui.js ====================

import { BELT_ITEM_ID, BlockInfo, BlockTypes, CHUNK_SIZE, CLUTCH_ITEM_ID, COGWHEEL_ITEM_ID, CRUSHER_ITEM_ID, DEPLOYER_ITEM_ID, GameModes, HotbarBlocks, OBSERVER_ITEM_ID, PISTON_ITEM_ID, RECIPES, SAW_ITEM_ID, SHAFT_ITEM_ID, STICKY_PISTON_ITEM_ID, ToolTypes, WATERWHEEL_ITEM_ID, WORLD_HEIGHT, XP_PER_CRAFT, isToolId, ItemTypes } from './config.js';
import { isCreative, isNight, state } from './state.js';
import { camera } from './engine.js';
import { atlasCanvas, blockUVs, tileSize } from './textures.js';
import { raycastBlocks } from './interaction.js';
import { isSolid } from './chunk.js';
import { getBlock } from './world.js';
import { killEnemySilent, mobSpawnTick } from './entities.js';
import { addXp, updateHealthUI } from './playerLife.js';
import { adjustBuildSpeed, getBuildFocus, getBuildStatus, lastFinishedAgeMs, speedText, toggleBuildPaused } from './buildQueue.js';
import { camModeText, getBuildFilmingStatus, setCamMode } from './cameraRig.js';
import { getUIState, mouseLocked, requestLock, setRecordingControlsOpen, setState } from './uiModal.js';
import { downloadRecording, getRecordingStatus, initRecording, toggleBuildRecording } from './recording.js';
export { isRecording, isCamOwnedRecording, toggleBuildRecording } from './recording.js';
import { hideItemInfo, makeItemIcon, showItemInfo } from './itemInfo.js';

// ==================== 游戏模式切换 ====================
export function setGameMode(mode) {
    state.gameMode = mode;
    const p = state.player;
    if (mode === GameModes.SURVIVAL) {
        p.flying = false;
        // 首次进入生存（2026-09-05 合成系统上线后对齐原版节奏）：木器三件 + 苹果 + 火把 + 原木，
        // 石器/铁器/钻石全靠「撸树→木板→木棍→工作台→挖矿→熔炉」逐级合成（config.js RECIPES）
        if (Object.keys(state.player.inventory).length === 0) {
            state.player.inventory[ToolTypes.WOOD_PICKAXE] = 1;
            state.player.inventory[ToolTypes.WOOD_AXE] = 1;
            state.player.inventory[ToolTypes.WOOD_SWORD] = 1;
            state.player.inventory[ItemTypes.APPLE] = 5;
            state.player.inventory[BlockTypes.TORCH] = 8;
            state.player.inventory[BlockTypes.WOOD] = 6; // 原木：开局就能搓木板/木棍/工作台
            // 活塞组套装（同上：无合成系统的补偿，够搭自动门/陷阱/飞行机器玩起来）
            state.player.inventory[BlockTypes.SLIME] = 16;
            state.player.inventory[PISTON_ITEM_ID] = 2;
            state.player.inventory[STICKY_PISTON_ITEM_ID] = 2;
            state.player.inventory[OBSERVER_ITEM_ID] = 2;
            // 动力组套装（同上：水车→轴/齿轮→粉碎轮/机械锯的自动化产线入门，见 js/kinetic.js）
            state.player.inventory[WATERWHEEL_ITEM_ID] = 2;
            state.player.inventory[SHAFT_ITEM_ID] = 16;
            state.player.inventory[COGWHEEL_ITEM_ID] = 8;
            state.player.inventory[CRUSHER_ITEM_ID] = 2;
            state.player.inventory[SAW_ITEM_ID] = 1;
            // 物流+控制组（Create-lite L1）：传送带搬产出 + 离合器拉杆启停 + 投料器回流投料
            state.player.inventory[BELT_ITEM_ID] = 16;
            state.player.inventory[CLUTCH_ITEM_ID] = 2;
            state.player.inventory[DEPLOYER_ITEM_ID] = 1;
        }
        // 切到生存时如果是夜晚，立即来一波怪（走正常生成规则，不会贴脸）
        if (isNight() && state.enemies.length === 0) {
            for (let i = 0; i < 3; i++) mobSpawnTick();
        }
    } else {
        // 切回建造：清掉敌对生物（猪/羊/牛这些被动家畜留着——风景与食物来源）
        for (let i = state.enemies.length - 1; i >= 0; i--) {
            if (state.enemies[i].hostile) killEnemySilent(state.enemies[i]);
        }
    }
    updateHealthUI();
    updateHotbar(); // 模式切换后刷新数量角标显示
}

export function toggleGameMode() {
    setGameMode(isCreative() ? GameModes.SURVIVAL : GameModes.CREATIVE);
    showTooltip(isCreative() ? '🏗️ 已切换到建造模式' : '⚔️ 已切换到生存模式');
}

// ==================== UI ====================
// 底部手持指示胶囊：HotbarBlocks 已达 38 项，单行平铺必溢出屏幕，
// 完整选择走 E 打开的可滚动网格（openItemPicker），这里只常显当前手持。
export function updateHotbar() {
    const hotbar = document.getElementById('hotbar');
    hotbar.innerHTML = '';
    const index = state.player.selectedSlot;
    const blockType = HotbarBlocks[index] ?? BlockTypes.GRASS;
    const slot = document.createElement('div');
    slot.className = 'hotbar-slot';
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const uv = blockUVs[blockType] || blockUVs[BlockTypes.STONE];
    const tile = uv.top || { x: 0, y: 0 };
    ctx.drawImage(atlasCanvas, tile.x * tileSize, tile.y * tileSize, tileSize, tileSize, 0, 0, 16, 16);
    slot.appendChild(canvas);
    const numSpan = document.createElement('span');
    numSpan.className = 'slot-number';
    numSpan.textContent = index + 1;
    slot.appendChild(numSpan);
    // 生存模式：显示数量角标，数量为 0 灰显；工具显示耐久条
    if (!isCreative()) {
        const count = state.player.inventory[blockType] || 0;
        const countSpan = document.createElement('span');
        countSpan.className = 'slot-count';
        countSpan.textContent = count;
        slot.appendChild(countSpan);
        if (count === 0) slot.classList.add('empty');
        appendDurabilityBar(slot, blockType, count);
    }
    hotbar.appendChild(slot);
    const info = document.createElement('div');
    info.className = 'hotbar-info';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'hotbar-name';
    nameSpan.textContent = BlockInfo[blockType].name;
    info.appendChild(nameSpan);
    const hintSpan = document.createElement('span');
    hintSpan.className = 'hotbar-hint';
    hintSpan.textContent = 'E 或点击 · 选择物品';
    info.appendChild(hintSpan);
    hotbar.appendChild(info);
    // 点击胶囊 = 打开选择网格（指针锁定时无光标点不到，主入口是 E 键；
    // 助手面板打开等指针自由的场景可直接点）
    hotbar.onclick = (e) => {
        e.stopPropagation(); // 不触发「点击重新锁定指针」兜底
        openItemPicker();
    };
    // 指针自由时（暂停菜单/助手面板开着）悬停胶囊也能看当前手持的说明
    slot.addEventListener('mouseenter', () => showItemInfo(blockType));
    slot.addEventListener('mouseleave', hideItemInfo);
}

// ==================== 背包 + 合成面板（E 打开；2026-09-05 对齐参考版）====================
// 创造模式 = 物品调色盘（可搜索）；生存模式 = 配方列表 + 物品网格：
//   徒手配方随时可做；工作台/熔炉配方需要「右键打开」或「站在旁边 4 格内按 E」（自动探测）。
// 点物品格 = 选中并收起；点配方 = 合成一次（消耗材料给产物 +1 经验）。

let craftStation = null; // 右键工作台/熔炉打开时强制的合成站（'crafting' | 'furnace' | null）
let invSearch = '';      // 搜索框关键字（按名称过滤物品与配方）

// 物品图标已移到 itemInfo.js（makeItemIcon，说明条与网格共用）

// 工具耐久条（剩余比例 <40% 黄、<15% 红）
function appendDurabilityBar(slotEl, id, count) {
    const max = BlockInfo[id]?.maxDurability;
    if (!max || count <= 0) return;
    const wear = state.player.toolWear[id] || 0;
    const frac = Math.max(0, 1 - wear / max);
    const bar = document.createElement('div');
    bar.className = 'dur-bar' + (frac < 0.15 ? ' crit' : frac < 0.4 ? ' low' : '');
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(frac * 100)}%`;
    bar.appendChild(fill);
    slotEl.appendChild(bar);
}

// 探测可用合成站：右键强制打开的算数 + 玩家周围 4 格内实际放置的工作台/熔炉
function availableStations() {
    const res = { crafting: craftStation === 'crafting', furnace: craftStation === 'furnace' };
    const p = state.player;
    const r = 4;
    for (let x = Math.floor(p.x) - r; x <= Math.floor(p.x) + r; x++) {
        for (let y = Math.max(0, Math.floor(p.y) - 2); y <= Math.floor(p.y) + 3; y++) {
            for (let z = Math.floor(p.z) - r; z <= Math.floor(p.z) + r; z++) {
                const b = getBlock(x, y, z);
                if (b === BlockTypes.CRAFTING_TABLE) res.crafting = true;
                else if (b === BlockTypes.FURNACE) res.furnace = true;
            }
        }
    }
    return res;
}

// 执行一次合成：校验材料与合成站 → 消耗 → 给产物（新工具满耐久）→ +1 经验。
// 返回错误文案（null = 成功），面板据此提示
export function craftRecipe(recipe) {
    const inv = state.player.inventory;
    const st = availableStations();
    if (recipe.station && !st[recipe.station]) {
        return recipe.station === 'crafting' ? '需要先放置并靠近工作台' : '需要先放置并靠近熔炉';
    }
    for (const idStr of Object.keys(recipe.cost)) {
        const id = Number(idStr);
        if ((inv[id] || 0) < recipe.cost[id]) return '材料不足';
    }
    for (const idStr of Object.keys(recipe.cost)) {
        const id = Number(idStr);
        inv[id] -= recipe.cost[id];
    }
    inv[recipe.out] = (inv[recipe.out] || 0) + recipe.outCount;
    if (BlockInfo[recipe.out]?.maxDurability) delete state.player.toolWear[recipe.out]; // 新工具满耐久
    addXp(XP_PER_CRAFT);
    return null;
}

// 配方一行：产物图标×数量 + 材料清单 + 站点徽标；灰显 = 当前做不了（点一下提示原因）
function buildRecipeRow(recipe, stations) {
    const inv = state.player.inventory;
    const outInfo = BlockInfo[recipe.out] || {};
    const enough = Object.keys(recipe.cost).every((idStr) => (inv[Number(idStr)] || 0) >= recipe.cost[Number(idStr)]);
    const stationOk = !recipe.station || stations[recipe.station];
    const row = document.createElement('div');
    row.className = 'recipe-row' + ((enough && stationOk) ? '' : ' disabled');
    const out = document.createElement('span');
    out.className = 'recipe-out';
    out.appendChild(makeItemIcon(recipe.out, 22));
    out.appendChild(document.createTextNode(`${outInfo.name || '?'} ×${recipe.outCount}`));
    row.appendChild(out);
    const ings = document.createElement('span');
    ings.className = 'recipe-ing';
    for (const idStr of Object.keys(recipe.cost)) {
        const id = Number(idStr);
        const ing = document.createElement('span');
        ing.className = 'recipe-ing-item';
        ing.appendChild(makeItemIcon(id, 16));
        ing.appendChild(document.createTextNode(`×${recipe.cost[id]}`));
        if ((inv[id] || 0) < recipe.cost[id]) ing.classList.add('lack');
        ings.appendChild(ing);
    }
    row.appendChild(ings);
    const st = document.createElement('span');
    st.className = 'recipe-station';
    st.textContent = !recipe.station ? '✋ 徒手' : recipe.station === 'crafting' ? '▦ 工作台' : '♨ 熔炉';
    row.appendChild(st);
    row.addEventListener('click', () => {
        const err = craftRecipe(recipe);
        if (err) {
            showTooltip(`❌ ${outInfo.name}：${err}`);
        } else {
            showTooltip(`✅ 已合成 ${outInfo.name} ×${recipe.outCount}（+1 ✨）`);
            buildInventoryGrid(); // 刷新数量角标与配方可用态
        }
    });
    // 悬停 = 底部说明条显示产物详情（数值/用途/合成关系）
    row.addEventListener('mouseenter', () => showItemInfo(recipe.out));
    row.addEventListener('mouseleave', hideItemInfo);
    return row;
}

// 物品网格（可被搜索框过滤）
export function buildInventoryGrid() {
    const grid = document.getElementById('inventory-grid');
    const panel = document.getElementById('inventory-panel');
    grid.innerHTML = '';
    const survival = !isCreative();
    const stations = survival ? availableStations() : null;
    // 标题与合成区（生存才有配方）
    const title = panel.querySelector('h2');
    if (survival) {
        const opened = craftStation === 'crafting' ? '（▦ 已连接工作台）' : craftStation === 'furnace' ? '（♨ 已连接熔炉）' : '';
        title.textContent = `🎒 背包与合成${opened}`;
        const section = document.getElementById('crafting-section');
        section.innerHTML = '';
        const groups = [
            ['✋ 徒手合成', (r) => !r.station],
            ['▦ 工作台配方', (r) => r.station === 'crafting'],
            ['♨ 熔炉烧制（煤炭 = 燃料）', (r) => r.station === 'furnace'],
        ];
        for (const [label, match] of groups) {
            const recipes = RECIPES.filter(match).filter((r) =>
                !invSearch || (BlockInfo[r.out]?.name || '').includes(invSearch));
            if (!recipes.length) continue;
            const h = document.createElement('div');
            h.className = 'recipe-group-title';
            h.textContent = label;
            section.appendChild(h);
            for (const r of recipes) section.appendChild(buildRecipeRow(r, stations));
        }
    } else {
        title.textContent = '🎒 选择物品（创造模式）';
        // 创造模式没有配方（物品无限），说明条替代配方区：告诉玩家合成玩法在生存模式
        const section = document.getElementById('crafting-section');
        section.innerHTML = '';
        const tip = document.createElement('div');
        tip.className = 'creative-note';
        tip.textContent = '🧪 创造模式：物品无限、任意选择，无需合成。按 M 切换到生存模式，E 面板就有合成配方（撸树 → 木板 → 工作台 → 工具 → 挖矿 → 熔炉）。';
        section.appendChild(tip);
    }
    // 底部提示随模式走：生存才有「点配方 = 合成一次」，创造模式别再误导
    const hint = document.getElementById('inventory-close-hint');
    if (hint) {
        hint.innerHTML = survival
            ? '点物品 = 选中并关闭 &nbsp;|&nbsp; 点配方 = 合成一次 &nbsp;|&nbsp; <kbd>E</kbd> / <kbd>Esc</kbd> 收起'
            : '点物品 = 选中并关闭 &nbsp;|&nbsp; <kbd>E</kbd> / <kbd>Esc</kbd> 收起';
    }
    // 物品格
    HotbarBlocks.forEach((blockType, index) => {
        const name = BlockInfo[blockType]?.name || '未知';
        if (invSearch && !name.includes(invSearch)) return;
        const slot = document.createElement('div');
        slot.className = 'inv-slot' + (index === state.player.selectedSlot ? ' selected' : '');
        slot.appendChild(makeItemIcon(blockType, 24));
        if (index < 9) {
            const numSpan = document.createElement('span');
            numSpan.className = 'slot-number';
            numSpan.textContent = index + 1;
            slot.appendChild(numSpan);
        }
        const nameSpan = document.createElement('span');
        nameSpan.className = 'inv-name';
        nameSpan.textContent = name;
        slot.appendChild(nameSpan);
        // 生存模式：数量角标 + 工具耐久条
        if (!isCreative()) {
            const count = state.player.inventory[blockType] || 0;
            const countSpan = document.createElement('span');
            countSpan.className = 'slot-count';
            countSpan.textContent = count;
            slot.appendChild(countSpan);
            if (count === 0) slot.classList.add('empty');
            appendDurabilityBar(slot, blockType, count);
        }
        slot.addEventListener('click', () => {
            // 生存模式数量 0 = 没有该物品，不可选中（对齐原版「用完即消失」，工具同理不得空手白嫖）
            if (!isCreative() && (state.player.inventory[blockType] || 0) <= 0) {
                showTooltip(`❌ ${name} ×0，先去收集吧`);
                return;
            }
            state.player.selectedSlot = index;
            updateHotbar();
            setState('playing'); // 选中即收起，不需要再按 E（状态机负责恢复指针锁定）
            showTooltip(BlockInfo[blockType].name);
        });
        // 悬停 = 底部说明条显示物品详情（工具数值/挖掘属性/特殊行为/合成关系）
        slot.addEventListener('mouseenter', () => showItemInfo(blockType));
        slot.addEventListener('mouseleave', hideItemInfo);
        grid.appendChild(slot);
    });
}

// 打开背包+合成面板的唯一入口（E 键与点击手持胶囊共用）。
// station：右键工作台/熔炉时传入，解锁对应站点的配方；普通打开传 null（自动探测附近有没有台/炉）
let invSearchInit = false; // 搜索框监听只挂一次（input 在 HTML 里，不随网格重建）

export function openItemPicker(station = null) {
    if (state.player.dead) return; // 死亡界面优先，不开背包
    craftStation = station;
    invSearch = '';
    const search = document.getElementById('inv-search');
    if (search) {
        search.value = '';
        if (!invSearchInit) {
            invSearchInit = true;
            search.addEventListener('input', (e) => {
                invSearch = e.target.value.trim();
                buildInventoryGrid();
            });
        }
    }
    buildInventoryGrid();
    setState('inventory');
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
    // 摄像头脱离玩家时优先显示摄像头模式，否则显示第一/第三人称
    const camText = camModeText();
    document.getElementById('dbg-view').textContent =
        camText || ['第一人称', '第三人称(背后)'][state.viewMode];
    const hit = raycastBlocks();
    if (hit) {
        document.getElementById('dbg-selected').textContent = BlockInfo[hit.block]?.name || '未知';
    } else {
        document.getElementById('dbg-selected').textContent = '-';
    }
}

// ==================== 施工进度与常驻拍摄面板 ====================
const BUILD_WIDGET_STYLE = `
#build-widget{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:120;
 display:flex;align-items:center;flex-wrap:wrap;gap:7px;padding:8px 10px;border-radius:10px;
 max-width:calc(100vw - 24px);box-sizing:border-box;background:rgba(20,20,34,.92);
 border:1px solid #55556a;color:#e8e8f4;font-size:12px;user-select:none;}
#build-widget.hidden,#recording-panel.hidden,#recording-panel .hidden{display:none;}
#build-title{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#build-bar{width:90px;height:6px;border-radius:5px;background:#37374a;overflow:hidden;}
#build-fill{height:100%;width:0%;background:#9bc879;}
#build-widget button,#recording-panel button{border:1px solid #565a67;border-radius:6px;
 background:#303541;color:#edf0f7;cursor:pointer;font:inherit;padding:6px 9px;}
#build-widget button:hover,#recording-panel button:hover{border-color:#acd58c;background:#404958;}
#recording-panel button:focus-visible,#recording-panel input:focus-visible{outline:2px solid #b9db98;outline-offset:3px;}
#recording-panel{position:fixed;bottom:18px;left:14px;z-index:120;width:326px;max-width:calc(100vw - 28px);
 box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #525968;background:rgba(19,25,34,.94);
 color:#edf0f7;font:12px/1.5 system-ui,sans-serif;box-shadow:0 4px 18px #0005;user-select:none;}
#recording-panel .record-row{display:flex;align-items:center;justify-content:space-between;gap:8px;}
#recording-panel .record-heading{font-weight:650;letter-spacing:.08em;}
#recording-panel #build-rec{background:#b43e47;border-color:#c95460;color:white;font-weight:650;min-width:144px;}
#recording-panel #build-rec.rec-on{background:#7f2933;}
#record-status{color:#bcc8d6;font-size:11px;min-height:17px;margin:6px 0;}
#camera-choices{display:flex;gap:5px;margin:8px 0;}
#camera-choices button{flex:1;padding:6px 2px;white-space:nowrap;}
#camera-choices button[aria-pressed="true"]{background:#354936;border-color:#a2c883;color:#d9efc9;}
#recording-options{border-top:1px solid #414956;padding-top:8px;}
#recording-panel label{display:flex;align-items:center;gap:5px;cursor:pointer;}
#recording-panel input{accent-color:#a2c883;}
#camera-help{color:#b2bdcb;font-size:11px;margin:7px 0 0;}
#recording-panel .record-shortcut{color:#bcc8d6;font-size:11px;}
#recording-panel #build-save{margin-top:8px;width:100%;color:#ffe1aa;}
#recording-panel.compact #recording-options{display:none;}
@media(min-width:1000px){#recording-panel.menu-mode{top:24%;bottom:auto;}}
#recording-panel.compact #camera-help{display:none;}
#recording-panel #record-controls{padding:2px 5px;font-size:11px;}
body.hud-hidden #recording-panel,body.hud-hidden #build-widget{display:none;}
@media(max-width:800px){
 #recording-panel{bottom:auto;top:12px;left:12px;width:310px;}
 #build-widget{top:auto;bottom:165px;left:12px;transform:none;max-width:310px;}
 #debug-info{top:270px;max-width:280px;}
}
`;
let buildEls = null;

export function initBuildWidget() {
    if (buildEls) return;
    initRecording({ notify: showTooltip });
    try { state.buildAutoRecord = localStorage.getItem('mcweb.buildAutoRecord') !== 'false'; } catch { /* 禁用存储仍可使用 */ }
    const style = document.createElement('style');
    style.textContent = BUILD_WIDGET_STYLE;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'build-widget';
    root.className = 'hidden';
    root.innerHTML = `
      <span id="build-title">施工</span>
      <div id="build-bar"><div id="build-fill"></div></div><span id="build-count"></span>
      <button id="build-goto" title="G：前往施工现场">前往</button>
      <button id="build-slower" title="[：施工减速">−</button><span id="build-speed"></span>
      <button id="build-faster" title="]：施工加速">＋</button>
      <button id="build-pause" title="P：暂停 / 继续施工">暂停</button>`;
    const panel = document.createElement('section');
    panel.id = 'recording-panel';
    panel.className = 'hidden';
    panel.setAttribute('aria-label', '游戏拍摄');
    panel.innerHTML = `
      <div class="record-row"><span class="record-heading">游戏拍摄</span>
        <button id="build-rec" title="R：开始录制 / 停止并保存">● 开始录制</button></div>
      <div id="record-status" role="status">随时录下当前游戏画面</div>
      <div id="camera-choices" role="group" aria-label="拍摄镜头">
        <button id="camera-player" aria-pressed="true">玩家视角</button>
        <button id="camera-auto" aria-pressed="false">自动取景</button>
        <button id="camera-manual" aria-pressed="false">手动调镜</button></div>
      <div class="record-row"><span class="record-shortcut">R 录制 / 停止 · Tab 操作面板</span>
        <button id="record-controls">设置</button></div>
      <div id="recording-options">
        <label><input id="build-auto-record" type="checkbox">AI 施工自动录制</label>
        <div id="camera-help"></div>
      </div>
      <button id="build-save" class="hidden">↓ 保存上一段</button>`;
    document.body.append(root, panel);
    for (const el of [root, panel]) el.addEventListener('click', e => e.stopPropagation());
    buildEls = { root, panel, title: root.querySelector('#build-title'), fill: root.querySelector('#build-fill'),
        count: root.querySelector('#build-count'), speed: root.querySelector('#build-speed'),
        pause: root.querySelector('#build-pause'), recBtn: panel.querySelector('#build-rec'),
        saveBtn: panel.querySelector('#build-save'), status: panel.querySelector('#record-status'),
        auto: panel.querySelector('#build-auto-record'), help: panel.querySelector('#camera-help'),
        controls: panel.querySelector('#record-controls') };
    root.querySelector('#build-goto').addEventListener('click', teleportToBuildSite);
    root.querySelector('#build-slower').addEventListener('click', () => adjustBuildSpeed(-1));
    root.querySelector('#build-faster').addEventListener('click', () => adjustBuildSpeed(1));
    buildEls.pause.addEventListener('click', toggleBuildPaused);
    buildEls.recBtn.addEventListener('click', () => { toggleBuildRecording(); updateBuildWidget(); });
    buildEls.saveBtn.addEventListener('click', downloadRecording);
    buildEls.controls.addEventListener('click', () => {
        if (mouseLocked) setRecordingControlsOpen(true);
        else {
            setRecordingControlsOpen(false);
            if (['pause', 'inventory', 'settings'].includes(getUIState())) setState('playing');
            if (getUIState() === 'playing') requestLock();
        }
        updateBuildWidget();
    });
    buildEls.auto.checked = state.buildAutoRecord;
    buildEls.auto.addEventListener('change', () => {
        state.buildAutoRecord = buildEls.auto.checked;
        try { localStorage.setItem('mcweb.buildAutoRecord', String(state.buildAutoRecord)); } catch { /* 本次会话仍然生效 */ }
        showTooltip(state.buildAutoRecord ? '下次施工将自动取景并录制' : '下次施工不再自动录制；当前录像可点停止并保存');
        buildEls.auto.blur();
    });
    for (const [id, mode] of [['camera-player', 'player'], ['camera-auto', 'build'], ['camera-manual', 'free']]) {
        panel.querySelector('#' + id).addEventListener('click', () => {
            setCamMode(mode);
            if (mode === 'free' || mode === 'player') {
                setRecordingControlsOpen(false);
                if (['pause', 'inventory', 'settings'].includes(getUIState())) setState('playing');
                if (getUIState() === 'playing') requestLock();
            }
            updateBuildWidget();
        });
    }
}

// 前往施工现场（G 键 / 📍 按钮）：把玩家传到施工焦点所在柱的地表上。
// 摄像机绑定玩家本体，AI 在远处选址时靠它一步到位观看建造。
export function teleportToBuildSite() {
    const focus = getBuildFocus();
    if (!focus) {
        showTooltip('🏗️ 当前没有施工任务');
        return;
    }
    const p = state.player;
    if (Math.hypot(focus.x + 0.5 - p.x, focus.z + 0.5 - p.z) < 6 && Math.abs(focus.y - p.y) < 6) {
        showTooltip('📍 已在施工现场附近');
        return;
    }
    // 沿焦点柱自上而下找落脚点（最高实心方块的上一格）
    let groundY = 0;
    for (let y = WORLD_HEIGHT - 1; y >= 1; y--) {
        if (isSolid(getBlock(focus.x, y, focus.z))) {
            groundY = y + 1;
            break;
        }
    }
    if (groundY <= 0) {
        showTooltip('⚠️ 施工位置下方没有地面，无法传送');
        return;
    }
    p.x = focus.x + 0.5;
    p.y = groundY;
    p.z = focus.z + 0.5;
    p.vy = 0;
    showTooltip(`📍 已前往施工现场：${focus.label}`);
}

// 常驻入口与施工状态各自更新，普通游玩时也能发现录像按钮。
export function updateBuildWidget() {
    if (!buildEls) return;
    const st = getBuildStatus();
    const rec = getRecordingStatus();
    const filming = getBuildFilmingStatus();
    const visible = getUIState() !== 'title' || st.active || rec.recording || rec.hasDownload;
    buildEls.panel.classList.toggle('hidden', !visible);
    buildEls.panel.classList.toggle('menu-mode', ['pause', 'inventory', 'settings'].includes(getUIState()));
    const expanded = state.recordingControlsOpen || !mouseLocked;
    buildEls.panel.classList.toggle('compact', !expanded);
    buildEls.controls.textContent = mouseLocked ? '设置' : '回到画面';
    buildEls.controls.setAttribute('aria-expanded', String(expanded));
    buildEls.root.classList.toggle('hidden', !(st.active || (filming.active && filming.waiting) || lastFinishedAgeMs() < 3000));
    buildEls.title.textContent = filming.waiting ? '等待 AI 继续施工' : st.label || '施工';
    buildEls.fill.style.width = (st.total ? Math.round(st.applied / st.total * 100) : 0) + '%';
    buildEls.count.textContent = `${st.applied}/${st.total}`;
    buildEls.speed.textContent = speedText();
    buildEls.pause.textContent = st.paused ? '继续' : '暂停';
    buildEls.auto.checked = state.buildAutoRecord;
    buildEls.saveBtn.classList.toggle('hidden', !rec.hasDownload);
    buildEls.saveBtn.title = rec.filename;
    buildEls.recBtn.textContent = rec.recording ? '■ 停止并保存' : '● 开始录制';
    buildEls.recBtn.classList.toggle('rec-on', rec.recording);
    const time = `${String(Math.floor(rec.elapsedSec / 60)).padStart(2, '0')}:${String(rec.elapsedSec % 60).padStart(2, '0')}`;
    buildEls.status.textContent = rec.recording
        ? `● ${time} · ${rec.owner === 'cam' ? '施工自动录制' : '游戏录制'}${filming.finishing && rec.owner === 'cam' ? ' · 成品展示后保存' : ''}`
        : rec.saving ? '正在生成录像…' : rec.error || (filming.active ? '施工进行中 · 可随时开始录制' : '随时录下当前游戏画面');
    for (const [id, mode] of [['camera-player', 'player'], ['camera-auto', 'build'], ['camera-manual', 'free']]) {
        document.getElementById(id).setAttribute('aria-pressed', String(state.camMode === mode));
    }
    buildEls.help.textContent = state.camMode === 'free'
        ? '点击画面调镜：鼠标转向 · WASD 移动 · 空格 / Shift 升降 · 滚轮调速；Tab 返回面板。'
        : state.camMode === 'build'
            ? (filming.bounds ? '已对准施工全景。切到手动调镜可调整位置，录像保持连续。' : '等待 AI 开工后自动对准施工范围。')
            : '录制当前视角与游戏声音，不含界面。AI 开工自动取景，完工展示 4 秒后保存。';
}
