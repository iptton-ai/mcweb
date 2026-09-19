// ==================== ui.js ====================

import { BELT_ITEM_ID, BlockInfo, BlockTypes, CHUNK_SIZE, CLUTCH_ITEM_ID, COGWHEEL_ITEM_ID, CRUSHER_ITEM_ID, DEPLOYER_ITEM_ID, GameModes, HotbarBlocks, KEYPAD_ITEM_ID, LAMP_ITEM_ID, MERCHANT_ITEM_ID, OBSERVER_ITEM_ID, PISTON_ITEM_ID, PLATFORM_ITEM_ID, PULLEY_ITEM_ID, RECIPES, SAW_ITEM_ID, SHAFT_ITEM_ID, STICKY_PISTON_ITEM_ID, ToolTypes, WATERWHEEL_ITEM_ID, WORLD_HEIGHT, XP_PER_CRAFT, isToolId, ItemTypes, DUST_ITEM_ID } from './config.js';
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
import { clearStuckKeys, getUIState, mouseLocked, onUIStateChange, requestLock, setRecordingControlsOpen, setState, syncPointerPolicy } from './uiModal.js';
import { downloadRecording, getRecordingStatus, initRecording, isRecording, toggleBuildRecording } from './recording.js';
export { isCamOwnedRecording, isLevelOwnedRecording, isRecording, toggleBuildRecording } from './recording.js';
import { hideItemInfo, makeItemIcon, showItemInfo } from './itemInfo.js';
import { uiKick } from './uiKeys.js'; // 浮层键盘导航：打开面板后落焦（方向键移焦 / Enter 激活）
// 关卡工坊（批次 W · B4）：关卡卡存取（levelWorkshop）+ 闯关运行时（levelRun），见文件尾「关卡工坊 UI」段
import { buildLevelCard, cardHash, deleteLevelCard, deleteLevelTemplate, exportLevelCardJson, getLevelCard, getLevelTemplate, importLevelCardFromJson, listBuiltinLevelCards, listLevelCards, listLevelTemplates, saveLevelCard, saveLevelTemplate, validateLevelCard } from './levelWorkshop.js';
import { enterLevel, exitLevelRun, getBestScores, getHudState, isLevelRunActive } from './levelRun.js';
// 关卡编辑器（2026-09-16 界面化建关）：编辑会话 + 预设组件库，见「关卡编辑器 UI」段
import { PREFABS, getPrefab, listPrefabCats } from './levelPrefabs.js';
import { cancelPlacing, enterLevelEditor, exitLevelEditor, getEditorInfo, getPlacing, isLevelEditorActive, saveEditorDraft, startPlacing } from './levelEditor.js';
import { renderRegionThumbnail } from './levelPoster.js'; // P1 · B6：俯视缩略图（列表行 + 导出随卡入库）
import { openQuestionBank } from './questionBankUI.js'; // 📝 我的题库平铺录题页（关卡列表/编辑器 HUD 入口，2026-09-18）

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
            // 电梯组（Create-lite L2）：滑轮+平台 = 绳升降电梯（拉杆换向，见 js/kinetic.js）
            state.player.inventory[PULLEY_ITEM_ID] = 2;
            state.player.inventory[PLATFORM_ITEM_ID] = 8;
            // 教学组（Edu M1，2026-09-07）：答题机 + 红石件 = 「数学密码门」入门
            // （答对即变红石信号源：贴门放直接开门，接粉可远程解锁，见 js/eduKeypad.js）
            state.player.inventory[KEYPAD_ITEM_ID] = 3;
            state.player.inventory[DUST_ITEM_ID] = 8;
            state.player.inventory[LAMP_ITEM_ID] = 2;
            // 教学组（Edu M2）：英语商人（右键单词交易拿奖励）；识字矿石挖矿自然遇到
            state.player.inventory[MERCHANT_ITEM_ID] = 1;
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
    row.tabIndex = 0; // 键盘导航：方向键聚焦、Enter 合成（uiKeys.js）
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
            ? '<kbd>方向键</kbd> 选择 · <kbd>Enter</kbd> 确认 &nbsp;|&nbsp; 点物品 = 选中并关闭 &nbsp;|&nbsp; 点配方 = 合成一次 &nbsp;|&nbsp; <kbd>E</kbd> / <kbd>Esc</kbd> 收起'
            : '<kbd>方向键</kbd> 选择 · <kbd>Enter</kbd> 确认 &nbsp;|&nbsp; 点物品 = 选中并关闭 &nbsp;|&nbsp; <kbd>E</kbd> / <kbd>Esc</kbd> 收起';
    }
    // 物品格
    HotbarBlocks.forEach((blockType, index) => {
        const name = BlockInfo[blockType]?.name || '未知';
        if (invSearch && !name.includes(invSearch)) return;
        const slot = document.createElement('div');
        slot.className = 'inv-slot' + (index === state.player.selectedSlot ? ' selected' : '');
        slot.tabIndex = 0; // 键盘导航：方向键聚焦、Enter 选中（uiKeys.js）
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
        ? `● ${time} · ${rec.owner === 'cam' ? '施工自动录制' : rec.owner === 'level' ? '关卡宣传片' : '游戏录制'}${filming.finishing && rec.owner === 'cam' ? ' · 成品展示后保存' : ''}`
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

// ==================== 关卡工坊 UI（批次 W · B4） ====================
// 契约：docs/edu-workshop-impl-contract.md §5。DOM 外壳（#level-list / #level-hud / #result-panel
// 及按钮 id）由 B1 落地 index.html，本模块只接线——契约 id 优先引用，缺失时兜底自建（集成期防御，
// B1 落地后即走 B1 的外壳与样式）。导出（main.js / B2 以可选链调用，名字一字不能差）：
//   initLevelListUI()   绑导入/试玩/关闭按钮与文件选择（一次性，main.js init 时调）
//   openLevelList() / closeLevelList()   #level-list 显隐（#btn-levels 由 B2 接到 openLevelList）
//   renderLevelList()   关卡卡列表渲染（listLevelCards + 最佳成绩 + ▶/🎥/✕）
//   updateLevelHud()    每帧：闯关 HUD（main.js gameLoop 调，值变化才写 DOM）
//   updateResultPanel() 结算面板填充（main.js gameLoop 调 + onUIStateChange 兜底）

const LEVEL_UI_STYLE = `
/* ---- 显隐机制对齐兜底：B2 的 uiModal.syncOverlays 用 hidden class 驱动 #result-panel，
   B1 的 .lvl-overlay 骨架默认 display:none、靠 .open 显示——两套机制在此对齐：
   带 hidden 一律隐藏，不带 hidden 一律显示（初始 hidden 由 initLevelListUI 同步补上，无闪现）。
   B1/B2 后续任一方统一机制后本段冗余无害。 ---- */
.lvl-overlay.hidden { display: none !important; }
.lvl-overlay:not(.hidden) { display: flex; }
/* ---- 关卡列表行（列表行由 renderLevelList 动态渲染，B1 只给了容器与 .lvl-empty 空态） ---- */
.level-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;
 background:rgba(48,53,65,.6);border:1px solid #44475a;}
/* ---- 列表缩略图（P1 · B6 俯视色块图）：128px 源图按 64px 展示，object-fit 保形 ---- */
.level-row .level-thumb{width:64px;height:64px;flex:none;border-radius:8px;object-fit:cover;
 border:1px solid #44475a;background:#20242e;}
.level-row .level-main{flex:1;min-width:0;}
.level-row .level-name{font-weight:650;font-size:14px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.level-row .level-meta{color:#9a9ab8;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.level-row .level-badge{display:inline-block;margin-left:6px;padding:0 6px;border-radius:6px;
 font-size:11px;background:#5d4a1f;color:#ffd77a;letter-spacing:0;}
.level-row .level-btns{display:flex;gap:6px;flex:none;}
.level-row .level-btns button{border:1px solid #565a67;border-radius:8px;background:#303541;
 color:#edf0f7;cursor:pointer;font:inherit;padding:6px 9px;white-space:nowrap;}
.level-row .level-btns button:hover{border-color:#acd58c;background:#404958;}
.level-row .level-btns button.level-del-armed{background:#7f2933;border-color:#c95460;color:#fff;font-weight:650;}
/* ---- 结算面板锁明细表（#result-locks 容器由 B1 提供，表体 B4 填充） ---- */
#result-locks .result-lock-table{width:100%;border-collapse:collapse;font-size:13px;color:#e8e8f4;}
#result-locks .result-lock-table th,#result-locks .result-lock-table td{border-bottom:1px solid #2d2d44;padding:4px 6px;text-align:left;}
#result-locks .result-lock-table th{color:#9a9ab8;font-weight:500;}
#result-locks .result-lock-empty{color:#9a9ab8;font-size:12px;text-align:center;}
/* ---- 内置关卡与本机关卡之间的分区标签 ---- */
.lvl-section-label{margin:10px 4px 2px;color:#8f93a8;font-size:12px;text-align:center;}
/* ---- 关卡编辑器 HUD（#editor-hud，编辑态常显；指针释放后可点按钮/填名字） ---- */
#editor-hud{position:fixed;top:12px;left:12px;z-index:60;display:none;align-items:center;gap:8px;
 padding:8px 10px;border-radius:12px;background:rgba(28,32,42,.88);border:1px solid #5d4a1f;
 box-shadow:0 4px 16px rgba(0,0,0,.35);font-size:13px;color:#edf0f7;flex-wrap:wrap;max-width:62vw;}
#editor-hud.visible{display:flex;}
body.hud-hidden #editor-hud{display:none !important;}
#editor-hud .ed-title{font-weight:650;color:#ffd77a;white-space:nowrap;}
#editor-hud input{width:130px;padding:5px 8px;border-radius:8px;border:1px solid #565a67;
 background:#20242e;color:#edf0f7;font:inherit;}
#editor-hud button{border:1px solid #565a67;border-radius:8px;background:#303541;color:#edf0f7;
 cursor:pointer;font:inherit;padding:5px 9px;white-space:nowrap;}
#editor-hud button:hover{border-color:#acd58c;background:#404958;}
#editor-hud .ed-tip{color:#9adf9a;font-size:12px;}
/* ---- 组件库浮层（#prefab-picker，编辑器/建造模式 B 键开关） ---- */
#prefab-picker{z-index:70;}
#prefab-grid{display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow:auto;padding:2px;}
.prefab-cat{color:#ffd77a;font-size:12px;margin:4px 2px 0;}
.prefab-grid-row{display:flex;flex-wrap:wrap;gap:8px;}
.prefab-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:150px;
 padding:8px;border-radius:10px;border:1px solid #565a67;background:#303541;color:#edf0f7;
 cursor:pointer;font:inherit;text-align:left;}
.prefab-item:hover{border-color:#acd58c;background:#404958;}
.prefab-item .pf-name{font-weight:650;font-size:13px;}
.prefab-item .pf-desc{color:#9a9ab8;font-size:11px;line-height:1.35;display:-webkit-box;
 -webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
`;

let levelStylesInjected = false;

// 样式只注入一次（openLevelList / updateLevelHud 等入口都兜底调，防 main.js 未接 init 的阶段裸奔）
function ensureLevelStyles() {
    if (levelStylesInjected) return;
    levelStylesInjected = true;
    const style = document.createElement('style');
    style.textContent = LEVEL_UI_STYLE;
    document.head.appendChild(style);
}

function q(id) { return document.getElementById(id); }

// 秒 → mm:ss（HUD / 结算 / 列表最佳成绩共用）
function fmtSec(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ISO 时间 → 'YYYY-MM-DD HH:mm'（列表创建时间）
function fmtDate(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 卡名/作者等文本进 innerHTML 前转义
function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- #level-list 外壳与子元素的兜底保障（B1 的 index.html 已落地骨架；这里 id 优先引用，
//      缺失时按 B1 的 .lvl-panel 结构补建——集成期防御，命中 B1 骨架时全部 no-op）----
let levelListFallback = null;

function ensureLevelListDom() {
    let panel = q('level-list');
    if (!panel) {
        if (!levelListFallback) {
            // 兜底外壳：结构照 B1 的 .lvl-panel 骨架（B1 落地后不会走到）
            levelListFallback = document.createElement('div');
            levelListFallback.id = 'level-list';
            levelListFallback.className = 'lvl-overlay hidden';
            levelListFallback.innerHTML = `<div class="lvl-panel">
              <div class="lvl-head"><h3>🗺 关卡</h3>
                <button class="lvl-close" id="level-list-close" title="关闭">✕</button></div>
              <div class="lvl-sub">试玩/导入关卡卡，或 ✏️ 新建、改副本用组件库搭自己的关卡。</div>
              <div id="level-list-rows"></div>
              <div class="lvl-actions">
                <button class="save-btn" id="btn-level-new">✏️ 新建空白关卡</button>
                <button class="save-btn" id="btn-level-try">▶ 试玩当前世界</button>
                <button class="save-btn" id="btn-level-import">📥 导入关卡卡</button>
                <input type="file" id="level-file-input" accept=".json,application/json" hidden></div></div>`;
            document.body.appendChild(levelListFallback);
        }
        panel = levelListFallback;
    }
    // 关闭钮：B1 的 id 是 level-list-close（候选其余为历史/兜底变体），缺失才补建
    if (!panel.querySelector('#level-list-close,#btn-level-close,#level-close')) {
        const close = document.createElement('button');
        close.id = 'level-list-close';
        close.className = 'lvl-close';
        close.setAttribute('aria-label', '关闭关卡列表');
        close.textContent = '✕';
        (panel.querySelector('.lvl-head') || panel).appendChild(close);
    }
    // 行容器兜底
    let rows = q('level-list-rows');
    if (!rows) {
        rows = document.createElement('div');
        rows.id = 'level-list-rows';
        panel.appendChild(rows);
    }
    // 「✏️ 新建空白关卡」（编辑器批次 2026-09-16）：B1 骨架没有这个按钮，兜底补建
    if (!q('btn-level-new')) {
        const actions = panel.querySelector('.lvl-actions');
        if (actions) {
            const btn = document.createElement('button');
            btn.id = 'btn-level-new';
            btn.className = 'save-btn';
            btn.textContent = '✏️ 新建空白关卡';
            actions.insertBefore(btn, actions.firstChild);
        }
    }
    // 「📝 题目库」（平铺录题批次 2026-09-18）：B1 骨架没有这个按钮，兜底补建
    if (!q('btn-level-bank')) {
        const actions = panel.querySelector('.lvl-actions');
        if (actions) {
            const btn = document.createElement('button');
            btn.id = 'btn-level-bank';
            btn.className = 'save-btn';
            btn.textContent = '📝 题目库';
            actions.insertBefore(btn, actions.firstChild);
        }
    }
    return rows;
}

// ---- #result-panel 的四个按钮兜底保障（B1 骨架的按钮 id 已冻结且已落地；缺失时补建）----
function ensureResultDom() {
    let panel = q('result-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'result-panel';
        panel.className = 'lvl-overlay hidden';
        document.body.appendChild(panel);
    }
    const missing = ['btn-result-retry', 'btn-result-exit', 'btn-result-poster', 'btn-result-video']
        .filter((id) => !q(id));
    if (!missing.length) return panel; // B1 骨架齐全：no-op
    const actions = panel.querySelector('.lvl-actions') || (() => {
        const a = document.createElement('div');
        a.className = 'lvl-actions';
        panel.appendChild(a);
        return a;
    })();
    for (const [id, label] of [
        ['btn-result-retry', '🔄 重试'],
        ['btn-result-exit', '🚪 退出'],
        ['btn-result-poster', '📸 生成海报'],
        ['btn-result-video', '🎥 拍宣传片'],
    ]) {
        if (!q(id)) {
            const b = document.createElement('button');
            b.id = id;
            b.className = 'save-btn';
            b.textContent = label;
            actions.appendChild(b);
        }
    }
    return panel;
}

// ==================== 关卡列表 ====================

let levelListBound = false; // initLevelListUI 只绑一次
let renderSeq = 0;          // 列表渲染竞态令牌：await 期间的旧响应不得覆盖新列表

// 缩略图 dataURL 缓存（cardHash → dataURL，P1 · B6）：renderLevelList 每次重渲染都逐卡
// 重画的话，region 解码 + 逐列扫描不便宜（上限 96×64×96），缓存避免重复计算；超上限整清
const thumbCache = new Map();

// 关卡卡 → 俯视缩略图 dataURL（同步，无 await——不新增 renderSeq 竞态面）；失败返回 null
function levelThumbDataUrl(card, cardHash) {
    try {
        const key = cardHash || '';
        if (key && thumbCache.has(key)) return thumbCache.get(key);
        const cv = renderRegionThumbnail(card, 128);
        const url = cv ? cv.toDataURL() : null;
        if (key && url) {
            if (thumbCache.size > 60) thumbCache.clear(); // 列表建议 ≤50 张，超限整体换血防泄漏
            thumbCache.set(key, url);
        }
        return url;
    } catch {
        return null; // 缩略图失败不阻塞列表渲染（降级为无图行）
    }
}

// 列表行首列的缩略图 <img>（无图静默跳过，行布局照旧）
function appendLevelThumb(row, url) {
    if (!url) return;
    const img = document.createElement('img');
    img.className = 'level-thumb';
    img.alt = '关卡缩略图';
    img.src = url;
    row.appendChild(img);
}

export function initLevelListUI() {
    ensureLevelStyles();
    ensureLevelListDom();
    const rp = ensureResultDom();
    // 初始隐藏：注入的 `.lvl-overlay:not(.hidden)` 对齐规则生效后，骨架默认 display:none 不再兜底，
    // 必须在同一个同步任务里补上 hidden（无闪现）；此后 #level-list 归本模块、#result-panel 归
    // uiModal.syncOverlays（B2）统一 toggle hidden。
    const ll = q('level-list');
    if (ll && !ll.classList.contains('hidden') && !ll.classList.contains('open')) ll.classList.add('hidden');
    if (rp && !rp.classList.contains('hidden') && !rp.classList.contains('open')) rp.classList.add('hidden');
    if (levelListBound) return;
    levelListBound = true;

    // ---- 导入：#btn-level-import → 隐藏 file input；选完文件 → importLevelCardFromJson ----
    const importBtn = q('btn-level-import');
    const fileInput = q('level-file-input');
    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            const text = await file.text();
            // 卡名提前解出来给 toast 用（import 内部也会 parse，这里失败不阻塞校验流程）
            let name = '';
            try { name = String(JSON.parse(text)?.name || ''); } catch { /* 让 import 报错文案出场 */ }
            const r = await importLevelCardFromJson(text);
            if (r.error) {
                showTooltip(`❌ ${r.error}`);
            } else {
                const where = r.sessionOnly ? '仅本次会话' : '本机';
                const warn = r.warnings && r.warnings.length ? ` · ⚠️ ${r.warnings.length} 条警告` : '';
                showTooltip(`✅ 已导入 ${name || '关卡卡'}（存储：${where}）${warn}`);
                renderLevelList();
            }
            fileInput.value = ''; // 允许连续导入同一文件
        });
    }

    // ---- 试玩当前世界（G2 R4）：自动检测区域出卡（不落盘）→ 直接进关 ----
    const tryBtn = q('btn-level-try');
    if (tryBtn) {
        tryBtn.addEventListener('click', async () => {
            tryBtn.disabled = true;
            try {
                // buildLevelCard 是 async（A1）：全图扫描区域 + 逐锁取题
                const card = await buildLevelCard({ name: '我的试玩关', author: '我' });
                if (!card || card.error) {
                    showTooltip(`❌ ${card?.error || '生成试玩关卡失败'}`);
                    return;
                }
                const run = await enterLevel(card); // 不 saveLevelCard：试玩卡只存在内存
                if (!run) {
                    showTooltip('❌ 试玩失败：关卡嵌入世界出错');
                    return;
                }
                closeLevelList(); // enterLevel 内部已 setState('playing')，这里只收起列表
            } finally {
                tryBtn.disabled = false;
            }
        });
    }

    // ---- 📝 题目库（平铺录题批次 2026-09-18）：打开我的题库浮层（不关列表，返回即见） ----
    const bankBtn = q('btn-level-bank');
    if (bankBtn) {
        bankBtn.addEventListener('click', () => openQuestionBank());
    }

    // ---- ✏️ 新建空白关卡（编辑器批次）：进独立编辑世界（草稿自动保存） ----
    const newBtn = q('btn-level-new');
    if (newBtn) {
        newBtn.addEventListener('click', async () => {
            newBtn.disabled = true;
            try {
                const ok = await enterLevelEditor(null, { name: '未命名关卡' });
                if (ok) closeLevelList();
                else showTooltip('❌ 进入关卡编辑器失败');
            } finally {
                newBtn.disabled = false;
            }
        });
    }

    // ---- 关闭钮：契约未冻结 id，候选查找优先，兜底钮在 ensureLevelListDom 里补建 ----
    const closeBtn = q('btn-level-close') || q('level-list-close') || q('level-close');
    if (closeBtn) closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeLevelList();
    });

    // ---- 点空白（overlay 本体）关闭：照设置浮层「点空白关闭」惯例；面板内容点击不关 ----
    const listPanel = q('level-list');
    if (listPanel) {
        listPanel.addEventListener('click', (e) => {
            if (e.target === listPanel) closeLevelList();
        });
    }

    // ---- uiModal 状态联动：进入 result 态渲染一次结算面板（main.js 每帧调用之外的兜底）；
    //      离开首屏（进世界）自动收起关卡列表；编辑器 HUD 骨架就位（每帧 update 回写内容）----
    ensureEditorHudDom();
    onUIStateChange((_prev, next) => {
        if (next === 'result') updateResultPanel();
        if (next !== 'title') {
            const panel = q('level-list');
            if (panel && !panel.classList.contains('hidden')) closeLevelList();
            if (next !== 'playing' && isPrefabPickerOpen()) closePrefabPicker();
        }
    });
}

export function openLevelList() {
    initLevelListUI(); // 幂等（levelListBound 防重复绑）：兜底 main.js 只接 openLevelList 没接 init 的顺序
    const panel = q('level-list');
    if (!panel) return;
    panel.classList.remove('hidden'); // 显隐照首屏浮层惯例（hidden class，同 #start-screen）
    void renderLevelList().then(uiKick); // 行异步渲染，落焦 defer 到行就位后（键盘导航）
}

export function closeLevelList() {
    const panel = q('level-list');
    if (panel) panel.classList.add('hidden');
}

// 卡对象深拷贝（关卡卡是纯 JSON——改副本/存模板都必须拷贝，绝不动原卡）
function deepCopyCard(card) {
    return JSON.parse(JSON.stringify(card));
}

// 进入编辑器改副本（官方卡/模板/草稿共用）：拷贝进编辑世界，原卡永远不动
async function editCardCopy(card, templateName) {
    const copy = deepCopyCard(card);
    const name = templateName ? `副本·${templateName}` : (copy.name || '未命名关卡');
    const ok = await enterLevelEditor(copy, { name, templateName: templateName || '' });
    if (ok) {
        closeLevelList();
        showTooltip(templateName ? `✏️ 已按「${templateName}」开稿——原关卡不会动` : '✏️ 继续编辑草稿');
    } else {
        showTooltip('❌ 进入关卡编辑器失败');
    }
}

// 列表行：卡名/作者/锁数/最佳成绩（★与用时）+ ▶ 进入 / 🎥 拍宣传片 / ✏️ 改副本 /
// ⭐ 存为模板 / ✕ 删除（二次确认）。cardOverride：内置关卡直接带完整卡（不走 IndexedDB）；
// isBuiltin：官方卡=无删除钮、不显创建时间；rowKind='template'：模板行（试玩/用作模板/删模板）。
async function buildLevelRow(summary, cardOverride, isBuiltin = false, rowKind = 'card') {
    const isTemplate = rowKind === 'template';
    const card = cardOverride || (isTemplate ? await getLevelTemplate(summary.id) : await getLevelCard(summary.id)); // 摘要不含锁数，逐卡取完整卡（列表量小，可接受）
    const row = document.createElement('div');
    row.className = 'level-row';
    const main = document.createElement('div');
    main.className = 'level-main';

    if (!card) {
        // 数据损坏 / IndexedDB 记录缺 card：只保留删除出口（契约 §8「卡已不在本机」同类降级）
        main.innerHTML = `<div class="level-name">❓ ${escapeHtml(summary.name || '未知关卡')}</div>
          <div class="level-meta">卡数据缺失或损坏，仅可删除</div>`;
        row.appendChild(main);
        const del = document.createElement('button');
        del.textContent = '✕';
        bindDeleteButton(del, summary, isTemplate);
        const btns = document.createElement('div');
        btns.className = 'level-btns';
        btns.appendChild(del);
        row.appendChild(btns);
        return row;
    }

    const locks = (card.questions || []).length;
    const cps = (card.flags && card.flags.checkpoints || []).length;
    const limit = card.rules && card.rules.timeLimit;
    const isDraft = !!(card.meta && card.meta.draft);
    const best = isTemplate ? null : getBestScores(summary.cardHash); // {stars,timeSec,deaths,plays} | null
    // 缩略图（P1 · B6）：俯视色块图，同步绘制后行首插入（绘制在 await 之后的同步段，无竞态）
    const thumbUrl = levelThumbDataUrl(card, summary.cardHash);
    const bestText = best && best.stars > 0
        ? `${'★'.repeat(best.stars)}${'☆'.repeat(3 - best.stars)} ${fmtSec(best.timeSec)}`
        : (isTemplate ? '模板' : '尚未通关');
    const sessionBadge = isBuiltin ? '<span class="level-badge">🏰 官方关卡</span>'
        : isTemplate ? '<span class="level-badge">⭐ 模板</span>'
            : isDraft ? '<span class="level-badge">📝 草稿</span>'
                : summary.sessionOnly ? '<span class="level-badge">仅本次会话</span>' : '';
    const metaBits = [
        `作者：${escapeHtml(card.author || '匿名')}`,
        `🔒 ${locks} 锁`,
        cps ? `🚩 ${cps} 检查点` : '',
        limit ? `⏱ 限时 ${fmtSec(limit)}` : '',
        (!isBuiltin && card.created) ? fmtDate(card.created) : '',
        `最佳：${bestText}`,
        best && best.plays ? `第 ${best.plays + 1} 次挑战` : '',
    ].filter(Boolean);
    main.innerHTML = `<div class="level-name">${escapeHtml(card.name || '未命名关卡')}${sessionBadge}</div>
      <div class="level-meta">${metaBits.join(' · ')}</div>`;
    if (summary.sessionOnly && !isBuiltin) {
        // 会话卡说明：IndexedDB 不可用（隐私模式等）时的降级存储，刷新即失
        main.title = '此卡只保存在本次会话中（浏览器 IndexedDB 不可用），刷新页面后将丢失';
    }
    if (isDraft) {
        main.title = '草稿：编辑器自动保存的半成品——✏️ 继续编辑，▶ 也可以直接试玩';
    }
    appendLevelThumb(row, thumbUrl); // 缩略图先行插入（排在 .level-main 之前 = 行首列）
    row.appendChild(main);

    const btns = document.createElement('div');
    btns.className = 'level-btns';

    // ✏️ 官方卡/模板行「改副本」/ 草稿「继续编辑」：进编辑器，原件不动
    if (!isTemplate && (isBuiltin || isDraft)) {
        const edit = document.createElement('button');
        edit.textContent = isBuiltin ? '✏️ 改副本' : '✏️ 继续编辑';
        edit.addEventListener('click', () => { void editCardCopy(card, isBuiltin ? (card.name || '') : ''); });
        btns.appendChild(edit);
    }

    // ▶ 进入 / 模板行试玩：进关成功才收列表（enterLevel 内部负责存档/嵌世界/置出生点）
    const play = document.createElement('button');
    play.textContent = isTemplate ? '▶ 试玩' : '▶ 进入';
    play.addEventListener('click', async () => {
        play.disabled = true;
        const run = await enterLevel(card);
        play.disabled = false;
        if (!run) {
            showTooltip('❌ 进入关卡失败：卡片可能已损坏');
            return;
        }
        closeLevelList();
    });
    btns.appendChild(play);

    // 🎥 拍宣传片（P1）：进关后立即开 level 档录像；通关/退出由 levelRun 侧守卫自动停
    if (!isTemplate) {
        const film = document.createElement('button');
        film.textContent = '🎥 拍宣传片';
        film.addEventListener('click', async () => {
            film.disabled = true;
            const run = await enterLevel(card);
            film.disabled = false;
            if (!run) {
                showTooltip('❌ 进入关卡失败：卡片可能已损坏');
                return;
            }
            closeLevelList();
            if (!isRecording()) {
                toggleBuildRecording('level');
                showTooltip('🎥 宣传片录制中——通关或退出自动保存');
            }
        });
        btns.appendChild(film);
    }

    // ✏️ 模板行「用作模板」：进编辑器开新稿
    if (isTemplate) {
        const use = document.createElement('button');
        use.textContent = '✏️ 用作模板';
        use.addEventListener('click', () => { void editCardCopy(card, card.name || ''); });
        btns.appendChild(use);
    }

    // ⭐ 存为模板（本机关卡/草稿）：复制进模板库，随时改副本起稿
    if (!isTemplate && !isBuiltin) {
        const tpl = document.createElement('button');
        tpl.textContent = '⭐ 存为模板';
        tpl.addEventListener('click', async () => {
            tpl.disabled = true;
            const r = await saveLevelTemplate(deepCopyCard(card)).catch(() => null);
            tpl.disabled = false;
            if (r && r.ok) {
                showTooltip(`⭐ 已存为模板「${card.name || '未命名关卡'}」${r.sessionOnly ? '（仅本次会话）' : ''}`);
                renderLevelList();
            } else {
                showTooltip('⚠️ 模板保存失败');
            }
        });
        btns.appendChild(tpl);
    }

    // ✕ 删除（二次确认，照仓库「点两次」惯例）——内置关卡随包发布，不提供删除
    if (!isBuiltin) {
        const del = document.createElement('button');
        del.textContent = '✕';
        bindDeleteButton(del, summary, isTemplate);
        btns.appendChild(del);
    }

    row.appendChild(btns);
    return row;
}

// 删除按钮的二次确认接线（本机关卡行与模板行共用；isTemplate 决定删哪个库）
function bindDeleteButton(delBtn, summary, isTemplate = false) {
    let armed = false;
    let disarmTimer = null;
    delBtn.addEventListener('click', async () => {
        if (!armed) {
            armed = true;
            delBtn.textContent = '确认删除？';
            delBtn.classList.add('level-del-armed');
            disarmTimer = setTimeout(() => {
                armed = false;
                delBtn.textContent = '✕';
                delBtn.classList.remove('level-del-armed');
            }, 3000);
            return;
        }
        clearTimeout(disarmTimer);
        const removed = isTemplate
            ? await deleteLevelTemplate(summary.id)
            : await deleteLevelCard(summary.id);
        if (removed) showTooltip(`🗑 已删除「${summary.name || '关卡卡'}」`);
        renderLevelList(); // 删除后整体重渲染
    });
}

// 内置关卡 → 列表行摘要（id 仅作 DOM key 用途；卡对象已在手，不查 IndexedDB）
function builtinSummary(card) {
    const hash = cardHash(card);
    return {
        id: `builtin:${hash}`,
        name: card.name || '',
        author: card.author || '',
        created: card.created || '',
        cardHash: hash,
    };
}

export async function renderLevelList() {
    ensureLevelStyles();
    const rows = ensureLevelListDom();
    if (!rows) return;
    const seq = ++renderSeq;
    let cards = [];
    let builtins = [];
    let templates = [];
    try { cards = await listLevelCards(); } catch { cards = []; }
    try { builtins = await listBuiltinLevelCards(); } catch { builtins = []; }
    try { templates = await listLevelTemplates(); } catch { templates = []; }
    if (seq !== renderSeq) return; // await 期间有更新的渲染请求，丢弃本次
    rows.innerHTML = '';
    // 内置关卡区（官方随包发布，置于最前；assets/levels 缺失时自然跳过）
    for (const card of builtins) {
        const row = await buildLevelRow(builtinSummary(card), card, true);
        if (seq !== renderSeq) return; // 过期响应不再追加
        rows.appendChild(row);
    }
    // 模板区（编辑器批次 2026-09-16）：官方卡/我的关卡都能存进来当「改副本」的底稿
    if (templates.length) {
        const label = document.createElement('div');
        label.className = 'lvl-section-label';
        label.textContent = '—— ⭐ 模板（用作模板改副本，不动原件） ——';
        rows.appendChild(label);
        for (const summary of templates) {
            const row = await buildLevelRow(summary, null, false, 'template');
            if (seq !== renderSeq) return;
            rows.appendChild(row);
        }
    }
    if ((builtins.length || templates.length) && cards.length) {
        const label = document.createElement('div');
        label.className = 'lvl-section-label';
        label.textContent = '—— 我与本机的关卡 ——';
        rows.appendChild(label);
    }
    if (!cards.length && !builtins.length && !templates.length) {
        const empty = document.createElement('div');
        empty.className = 'lvl-empty'; // B1 的空态样式
        empty.textContent = '还没有关卡——✏️ 新建空白关卡用组件库搭一个，或让 🤖 帮你生成草稿';
        rows.appendChild(empty);
        return;
    }
    for (const summary of cards) {
        const row = await buildLevelRow(summary);
        if (seq !== renderSeq) return; // 过期响应不再追加
        rows.appendChild(row);
    }
}

// ==================== 闯关 HUD ====================
// B1 骨架：#level-hud 静态含 #level-hud-time / #level-hud-deaths / #level-hud-locks 三个 span，
// 显隐走 .visible class（F1 隐藏由 B1 的 body.hud-hidden 规则承担）。每帧被 main.js 调：
// 值（秒/死亡/锁）没变就只动 class、不写 DOM。

let lastHudKey = '';

export function updateLevelHud() {
    const hud = q('level-hud');
    if (!hud) return;
    const s = getHudState(); // levelRun 非激活 → null
    if (!s) {
        hud.classList.remove('visible');
        lastHudKey = '';
        return;
    }
    hud.classList.add('visible');
    const key = `${Math.floor(s.time)}|${s.deaths}|${s.solved}|${s.total}`;
    if (key === lastHudKey) return;
    lastHudKey = key;
    const t = q('level-hud-time');
    const d = q('level-hud-deaths');
    const l = q('level-hud-locks');
    if (t && d && l) { // 正常路径：只改三个 span 的文本
        t.textContent = fmtSec(s.time);
        d.textContent = String(s.deaths);
        l.textContent = `${s.solved}/${s.total}`;
    } else { // 骨架缺失的兜底：整体重建（保持同样的三个 id 供 CSS 命中）
        hud.innerHTML = `<span id="level-hud-time">${fmtSec(s.time)}</span>` +
            ` · 💀 <span id="level-hud-deaths">${s.deaths}</span>` +
            ` · 🔒 <span id="level-hud-locks">${s.solved}/${s.total}</span>`;
    }
}

// ==================== 结算面板 ====================
// B1 骨架（index.html 静态）：#result-title / #result-subtitle / #result-stars /
// #result-time / #result-deaths / #result-locks（明细容器）+ 四个按钮。
// 显隐由 B2 的 uiModal.syncOverlays 驱动（result 态 toggle hidden，openResultState 写
// state.levelResult）；本函数只做内容填充，值对象不变不重写。

let lastResultRef = null; // 同一结算对象只渲染一次（main.js 每帧调用 + onUIStateChange 兜底共用）
let resultBound = false;  // 四个结算按钮只绑一次

export function updateResultPanel() {
    const panel = q('result-panel');
    const result = state.levelResult;
    if (!panel) return;
    if (!result) {
        lastResultRef = null;
        return;
    }
    // 渲染时机：uiModal result 态，或面板已被显示（B2 任一先行调用方不空转）
    if (getUIState() !== 'result' && panel.classList.contains('hidden')) return;
    if (lastResultRef === result) return; // 同一对象且已渲染，跳过
    lastResultRef = result;

    ensureResultDom();
    bindResultButtons();

    const title = `${result.timeout ? '⏰ 超时 · ' : ''}${result.name || '未命名关卡'}`;
    const stars = Math.max(0, Math.min(3, result.stars | 0));
    const starText = result.timeout ? '☆☆☆' : '★'.repeat(stars) + '☆'.repeat(3 - stars);
    const subtitle = `作者：${result.author || '匿名'}${result.isNewBest ? ' · 🏆 新纪录' : ''}`;

    const t = q('result-title');
    if (t) { // 正常路径：逐 id 填 B1 骨架
        t.textContent = title;
        const sub = q('result-subtitle');
        if (sub) sub.textContent = subtitle;
        const st = q('result-stars');
        if (st) st.textContent = starText;
        const tm = q('result-time');
        if (tm) tm.textContent = fmtSec(result.timeSec);
        const dt = q('result-deaths');
        if (dt) dt.textContent = String(result.deaths | 0);
        renderLockTable(q('result-locks'), result.locks);
    } else { // 骨架缺失的兜底：自建内容区
        let body = panel.querySelector('#result-body');
        if (!body) {
            body = document.createElement('div');
            body.id = 'result-body';
            body.className = 'lvl-panel';
            panel.appendChild(body);
        }
        body.innerHTML = `<div class="lvl-head"><h3 id="result-title">${escapeHtml(title)}</h3></div>` +
            `<div id="result-subtitle">${escapeHtml(subtitle)}</div>` +
            `<div id="result-stars">${starText}</div>` +
            `<div class="result-stats"><span>⏱ <span id="result-time">${fmtSec(result.timeSec)}</span></span>` +
            `<span>💀 <span id="result-deaths">${result.deaths | 0}</span></span></div>` +
            `<div id="result-locks"></div>`;
        renderLockTable(body.querySelector('#result-locks'), result.locks);
    }
}

// 锁明细表（#result-locks 容器内）：每锁 序号 / 局部位置 / 尝试次数 / ✅❌
function renderLockTable(container, locks) {
    if (!container) return;
    if (!locks || !locks.length) {
        container.innerHTML = '<div class="result-lock-empty">本关没有锁（纯跑酷）</div>';
        return;
    }
    const rows = locks.map((l, i) =>
        `<tr><td>#${i + 1}</td><td>${escapeHtml(l.pos)}</td><td>${l.tries | 0} 次</td>` +
        `<td>${l.solved ? '✅' : '❌'}</td></tr>`).join('');
    container.innerHTML = `<table class="result-lock-table">` +
        `<thead><tr><th>锁</th><th>位置</th><th>尝试</th><th>结果</th></tr></thead>` +
        `<tbody>${rows}</tbody></table>`;
}

// 结算面板按钮（绑一次；state.levelResult 在点击时现读，避免闭包旧值）
function bindResultButtons() {
    if (resultBound) return;
    const retry = q('btn-result-retry');
    const exit = q('btn-result-exit');
    const poster = q('btn-result-poster');
    const video = q('btn-result-video');
    if (!retry || !exit) return; // 按钮一个都不在时放弃（ensureResultDom 已兜底，理论不可达）
    resultBound = true;

    // 🔄 重试：优先用运行时里的卡对象（试玩卡不在 IndexedDB，cardId 查库会落空），
    // levelRun 已置 null 时退 cardId；enterLevel 内部 setState('playing') 自动关结算面板
    retry.addEventListener('click', async () => {
        const target = state.levelRun?.card || state.levelResult?.cardId;
        if (!target) {
            showTooltip('❌ 关卡数据已不在本机，无法重试');
            return;
        }
        const run = await enterLevel(target);
        showTooltip(run ? '🔄 重试开始！计时已清零' : '❌ 重试失败：关卡数据已不在本机');
    });

    // 🚪 退出：回首屏（exitLevelRun 内部收 level 录像 → 恢复原世界 → setState('title') 关面板）
    exit.addEventListener('click', () => {
        exitLevelRun({ toTitle: true });
    });

    // 📸 海报（P1，B6 落地 levelPoster.js）：动态 import + 可选链，模块缺失时温和提示
    poster.addEventListener('click', async () => {
        try {
            const mod = await import('./levelPoster.js');
            if (mod?.generateResultPoster) mod.generateResultPoster(state.levelResult);
            else showTooltip('海报功能即将上线');
        } catch {
            showTooltip('海报功能即将上线');
        }
    });

    // 🎥 拍宣传片（已通关场景）：level 档录像；已在录（列表页开过）不重复开也不再停
    video.addEventListener('click', () => {
        if (isRecording()) {
            showTooltip('🎥 已在录制中');
            return;
        }
        if (toggleBuildRecording('level')) {
            showTooltip('🎥 宣传片录制中——通关或退出自动保存');
        }
    });
}

// ==================== 导出关卡卡面板（K 键，集成收口补齐） ====================
// 作者流程最后一步（plan §2.1「按 K 导出」）：出题笔双通过后，K 释放鼠标填名字/昵称，
// 导出 .level.json 文件（班级群分享）或存进本机关卡列表。考核锁意图来自
// eduKeypad.getExamIntent()（B3），rules.lockAIHelp 在这里落卡。

export function isLevelListOpen() {
    const el = document.getElementById('level-list');
    return !!el && !el.classList.contains('hidden');
}

export function openExportPanel() {
    let panel = document.getElementById('export-panel');
    if (!panel) {
        // DOM 兜底自建（index.html 缺失时仍可用，正常路径走骨架）
        panel = document.createElement('div');
        panel.id = 'export-panel';
        panel.className = 'lvl-overlay hidden';
        panel.innerHTML = '<div class="lvl-panel"><div class="lvl-head"><h3>📤 导出关卡卡</h3></div><div id="export-status"></div><div class="lvl-actions"><button class="save-btn" id="btn-export-download">📤 导出并下载</button><button class="save-btn" id="btn-export-save">💾 存进本机关卡列表</button></div></div>';
        document.body.appendChild(panel);
    }
    const name = document.getElementById('export-name');
    const author = document.getElementById('export-author');
    if (name && !name.value) name.value = '';
    if (author && !author.value) {
        try { author.value = localStorage.getItem('mcweb.level.author') || '我'; } catch { author.value = '我'; }
    }
    const status = document.getElementById('export-status');
    if (status) {
        try {
            import('./eduKeypad.js').then(ek => {
                const exam = ek?.getExamIntent?.();
                status.textContent = exam
                    ? '🔒 考核锁已开：这张卡在别人玩时 AI 助手会拒答提示。'
                    : '导出前请确认：每把答题机都已用 ✏️ 出题笔出题并连过两次。';
            }).catch(() => { });
        } catch { }
    }
    panel.classList.remove('hidden');
    state.levelExportOpen = true;
    syncPointerPolicy(); // 释放鼠标填名字/点按钮（关闭时自动回锁）
    // 绑一次按钮（幂等标记）
    if (!panel.dataset.bound) {
        panel.dataset.bound = '1';
        document.getElementById('btn-export-download')?.addEventListener('click', () => doLevelExport(true));
        document.getElementById('btn-export-save')?.addEventListener('click', () => doLevelExport(false));
        document.getElementById('export-panel-close')?.addEventListener('click', closeExportPanel);
    }
    clearStuckKeys(); // 清空移动键，避免开面板瞬间角色继续走
    uiKick(); // 键盘导航落焦：关卡名输入框（首个文本框）直接可打字
}

export function closeExportPanel() {
    const panel = document.getElementById('export-panel');
    if (panel) panel.classList.add('hidden');
    state.levelExportOpen = false;
    syncPointerPolicy(); // 回锁指针继续游戏
    clearStuckKeys();
}

async function doLevelExport(andDownload) {
    const nameEl = document.getElementById('export-name');
    const authorEl = document.getElementById('export-author');
    const name = (nameEl?.value || '').trim() || '我的关卡';
    const author = (authorEl?.value || '').trim() || '我';
    try { localStorage.setItem('mcweb.level.author', author); } catch { }
    let examIntent = false;
    try {
        const ek = await import('./eduKeypad.js');
        examIntent = !!ek?.getExamIntent?.();
    } catch { }
    const card = await buildLevelCard({
        name,
        author,
        rules: { lockAIHelp: !examIntent }, // 考核锁开 = 别人玩时 AI 拒答提示（P3 生效）
    });
    if (!card || card.error) {
        showTooltip('⚠️ ' + (card?.error || '当前世界没有可导出的关卡（先放旗子和答题机）'));
        return;
    }
    const check = validateLevelCard(card);
    if (check.errors && check.errors.length) {
        showTooltip('⚠️ 导出被拦：' + check.errors[0]);
        return;
    }
    // 缩略图随卡入库（P1 · B6）：俯视色块图转 Blob 作 saveLevelCard 第二参（列表/海报可靠图源，
    // 截帧方案只给海报用）。生成失败不传（saveLevelCard 对空参兜底），绝不阻塞导出主流程
    let thumbBlob = null;
    try {
        const tcv = renderRegionThumbnail(card, 128);
        if (tcv) {
            thumbBlob = await new Promise((resolve) => {
                try { tcv.toBlob((b) => resolve(b || null), 'image/png'); } catch { resolve(null); }
            });
        }
    } catch { }
    const saved = await saveLevelCard(card, thumbBlob);
    if (!saved || !saved.ok) {
        showTooltip('⚠️ 关卡卡保存失败');
        return;
    }
    if (andDownload) {
        try {
            const json = exportLevelCardJson(card);
            const blob = new Blob([json], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${name}.level.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        } catch { showTooltip('⚠️ 文件下载失败，卡已存进本机列表'); }
    }
    closeExportPanel();
    const warn = check.warnings && check.warnings.length ? `（${check.warnings.length} 条提示，建议先「试玩」）` : '';
    showTooltip(`✅ 已导出「${name}」${saved.sessionOnly ? '（仅本次会话）' : ''}${warn}`);
    renderLevelList().catch(() => { });
}

// ==================== 关卡编辑器 HUD + 组件库（2026-09-16 界面化建关） ====================
// 编辑态常显工具条（#editor-hud）：改名 / 组件库 / 存草稿 / 完成导出 / 退出；组件库
// 浮层（#prefab-picker）按分类列出 levelPrefabs 的组件，点选即进入放置态（左键盖章）。
// 按钮在指针释放（Esc/Q/面板打开）时点击——与拍摄面板同一套非暂停浮层交互。

let editorHudEl = null;
let editorHudBound = false;
let lastEditorName = ''; // 名字输入框只在变化时回写（防打断输入焦点）

function ensureEditorHudDom() {
    ensureLevelStyles();
    if (editorHudEl) return editorHudEl;
    editorHudEl = document.createElement('div');
    editorHudEl.id = 'editor-hud';
    editorHudEl.innerHTML = `
      <span class="ed-title">✏️ 编辑中</span>
      <input id="editor-name" placeholder="关卡名" maxlength="40">
      <button id="btn-editor-prefabs" title="B 键开关">🧱 组件库</button>
      <button id="btn-editor-bank" title="平铺录题：游戏内出题笔面板可直接选">📝 题目库</button>
      <button id="btn-editor-draft" title="退出时也会自动存">💾 存草稿</button>
      <button id="btn-editor-export" title="K 键同款">📤 完成导出</button>
      <button id="btn-editor-exit" title="草稿自动保存后回首屏">🚪 退出</button>
      <span class="ed-tip" id="editor-tip"></span>`;
    document.body.appendChild(editorHudEl);
    if (!editorHudBound) {
        editorHudBound = true;
        editorHudEl.addEventListener('input', (e) => {
            if (e.target && e.target.id === 'editor-name' && state.levelEdit) {
                state.levelEdit.name = e.target.value.trim() || '未命名关卡';
            }
        });
        editorHudEl.addEventListener('click', (e) => {
            const id = e.target && e.target.id;
            if (id === 'btn-editor-prefabs') {
                if (isPrefabPickerOpen()) closePrefabPicker();
                else openPrefabPicker();
            } else if (id === 'btn-editor-bank') {
                openQuestionBank(); // 平铺录题：录完拿 ✏️ 出题笔右键答题机「📋 我的题目」选入
            } else if (id === 'btn-editor-draft') {
                void saveEditorDraft({ silent: false });
            } else if (id === 'btn-editor-export') {
                openExportPanel(); // 复用 K 导出面板（名字/昵称/导出下载全流程一致）
            } else if (id === 'btn-editor-exit') {
                void exitLevelEditor({ saveDraft: true }); // 退出必存一版草稿
            }
        });
    }
    return editorHudEl;
}

// main.js 每帧调：编辑态显隐 + 名字/放置提示回写（值变化才写 DOM）
let lastEditorTip = '';
export function updateEditorHud() {
    const hud = ensureEditorHudDom();
    const info = getEditorInfo();
    if (!info) {
        hud.classList.remove('visible');
        lastEditorName = '';
        lastEditorTip = '';
        return;
    }
    hud.classList.add('visible');
    const nameInput = document.getElementById('editor-name');
    if (nameInput && document.activeElement !== nameInput && nameInput.value !== info.name) {
        nameInput.value = info.name;
    }
    const tipEl = document.getElementById('editor-tip');
    const tip = info.placing ? `放置中：${(getPrefab(info.placing) || {}).name || ''}（Esc 取消）` : '';
    if (tipEl && tip !== lastEditorTip) {
        lastEditorTip = tip;
        tipEl.textContent = tip;
    }
}

// ---- 组件库浮层 ----
let pickerEl = null;

function ensurePrefabPickerDom() {
    ensureLevelStyles();
    if (pickerEl) return pickerEl;
    pickerEl = document.createElement('div');
    pickerEl.id = 'prefab-picker';
    pickerEl.className = 'lvl-overlay hidden';
    pickerEl.innerHTML = `<div class="lvl-panel">
      <div class="lvl-head"><h3>🧱 组件库</h3>
        <button class="lvl-close" id="prefab-picker-close" title="关闭">✕</button></div>
      <div class="lvl-sub">点选组件 → 准星瞄准地面左键盖章。答题机放完记得手持 ✏️ 出题笔右键出题（连过两次才能导出）。</div>
      <div id="prefab-grid"></div></div>`;
    document.body.appendChild(pickerEl);
    renderPrefabGrid();
    pickerEl.addEventListener('click', (e) => {
        if (e.target === pickerEl) closePrefabPicker();
    });
    document.getElementById('prefab-picker-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closePrefabPicker();
    });
    return pickerEl;
}

function renderPrefabGrid() {
    const grid = document.getElementById('prefab-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const cat of listPrefabCats()) {
        const catEl = document.createElement('div');
        catEl.className = 'prefab-cat';
        catEl.textContent = cat;
        grid.appendChild(catEl);
        const rowEl = document.createElement('div');
        rowEl.className = 'prefab-grid-row';
        for (const p of PREFABS.filter((x) => x.cat === cat)) {
            const item = document.createElement('button');
            item.className = 'prefab-item';
            item.innerHTML = `<span class="pf-name">${escapeHtml(p.name)}</span>` +
                `<span class="pf-desc">${escapeHtml(p.desc)}</span>` +
                `<span class="pf-desc">${p.w}×${p.h}×${p.d}</span>`;
            item.addEventListener('click', () => {
                // 放置需要指针回画布（自动回锁）；keepPlacing：点选成功的放置态不能被
                // 收浮层的 cancelPlacing 抹掉（否则左键盖章变挖掘，2026-09-18 UK09 揪出）
                if (startPlacing(p.id)) closePrefabPicker(true);
                else closePrefabPicker();
            });
            rowEl.appendChild(item);
        }
        grid.appendChild(rowEl);
    }
}

export function isPrefabPickerOpen() {
    return !!state.prefabPickerOpen;
}

// B 键 / 编辑器 HUD 调。可用范围：编辑器会话内，或建造模式的普通世界（给自家世界
// 摆零件）；闯关态与生存模式不给（生存摸不到这些教学方块）。
export function openPrefabPicker() {
    if (isLevelRunActive()) {
        showTooltip('🔒 闯关中不能用组件库');
        return;
    }
    if (!isLevelEditorActive() && !isCreative()) {
        showTooltip('🧱 组件库在关卡编辑器或建造模式可用（按 M 切换）');
        return;
    }
    ensurePrefabPickerDom().classList.remove('hidden');
    state.prefabPickerOpen = true;
    syncPointerPolicy(); // 释放鼠标点选（关闭时自动回锁）
    uiKick(); // 键盘导航落焦：首个组件按钮，方向键选、Enter 进入放置
}

export function closePrefabPicker(keepPlacing = false) {
    if (pickerEl) pickerEl.classList.add('hidden');
    state.prefabPickerOpen = false;
    if (!keepPlacing) cancelPlacing(); // 收起组件库 = 结束放置态（不误触盖 prefab 的左键）；
    syncPointerPolicy(); // 回锁指针继续游戏（点选组件进放置态时 keepPlacing 保留放置态）
}
