// ==================== ui.js ====================

import { BlockInfo, BlockTypes, CHUNK_SIZE, COGWHEEL_ITEM_ID, CRUSHER_ITEM_ID, GameModes, HotbarBlocks, OBSERVER_ITEM_ID, PISTON_ITEM_ID, SAW_ITEM_ID, SHAFT_ITEM_ID, STICKY_PISTON_ITEM_ID, ToolTypes, WATERWHEEL_ITEM_ID, WORLD_HEIGHT } from './config.js';
import { isCreative, isNight, state } from './state.js';
import { canvas, camera, renderer, scene } from './engine.js';
import { atlasCanvas, blockUVs, tileSize } from './textures.js';
import { raycastBlocks } from './interaction.js';
import { isSolid } from './chunk.js';
import { getBlock } from './world.js';
import { killEnemySilent, mobSpawnTick } from './entities.js';
import { updateHealthUI } from './playerLife.js';
import { adjustBuildSpeed, getBuildFocus, getBuildStatus, lastFinishedAgeMs, speedText, toggleBuildPaused } from './buildQueue.js';
import { camModeText, toggleBuildCam } from './cameraRig.js';
import { setState } from './uiModal.js';
import { audioCtx, getRecAudioStream } from './audio.js';
import { renderViewmodel } from './viewmodel.js';

// ==================== 游戏模式切换 ====================
export function setGameMode(mode) {
    state.gameMode = mode;
    const p = state.player;
    if (mode === GameModes.SURVIVAL) {
        p.flying = false;
        // 首次进入生存：赠送火把 + 铁质工具一套（原版靠「撸树→合成」获得工具，本作无合成系统，
        // 开局直配铁质一档：镐挖石、斧伐木、锹掘土、剑战斗——石头徒手挖极慢且无掉落，工具是生存刚需）
        if (Object.keys(state.player.inventory).length === 0) {
            state.player.inventory[BlockTypes.TORCH] = 10;
            state.player.inventory[ToolTypes.PICKAXE] = 1;
            state.player.inventory[ToolTypes.AXE] = 1;
            state.player.inventory[ToolTypes.SHOVEL] = 1;
            state.player.inventory[ToolTypes.SWORD] = 1;
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
        }
        // 切到生存时如果是夜晚，立即来一波怪（走正常生成规则，不会贴脸）
        if (isNight() && state.enemies.length === 0) {
            for (let i = 0; i < 3; i++) mobSpawnTick();
        }
    } else {
        // 切回建造：清空怪物
        for (let i = state.enemies.length - 1; i >= 0; i--) killEnemySilent(state.enemies[i]);
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
    // 生存模式：显示数量角标，数量为 0 灰显
    if (!isCreative()) {
        const count = state.player.inventory[blockType] || 0;
        const countSpan = document.createElement('span');
        countSpan.className = 'slot-count';
        countSpan.textContent = count;
        slot.appendChild(countSpan);
        if (count === 0) slot.classList.add('empty');
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
}

// 物品选择网格（E 打开）：全部物品一格一物，可滚动，点选即选中并自动收起。
// 每次打开重建，保证数量角标/选中高亮与当前状态一致。
export function buildInventoryGrid() {
    const grid = document.getElementById('inventory-grid');
    grid.innerHTML = '';
    HotbarBlocks.forEach((blockType, index) => {
        const slot = document.createElement('div');
        slot.className = 'inv-slot' + (index === state.player.selectedSlot ? ' selected' : '');
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        const uv = blockUVs[blockType] || blockUVs[BlockTypes.STONE];
        const tile = uv.top || { x: 0, y: 0 };
        ctx.drawImage(atlasCanvas, tile.x * tileSize, tile.y * tileSize, tileSize, tileSize, 0, 0, 24, 24);
        slot.appendChild(canvas);
        // 前 9 格标注数字键位（1-9 直达）
        if (index < 9) {
            const numSpan = document.createElement('span');
            numSpan.className = 'slot-number';
            numSpan.textContent = index + 1;
            slot.appendChild(numSpan);
        }
        const nameSpan = document.createElement('span');
        nameSpan.className = 'inv-name';
        nameSpan.textContent = BlockInfo[blockType].name;
        slot.appendChild(nameSpan);
        // 生存模式：显示数量角标，数量为 0 灰显
        if (!isCreative()) {
            const count = state.player.inventory[blockType] || 0;
            const countSpan = document.createElement('span');
            countSpan.className = 'slot-count';
            countSpan.textContent = count;
            slot.appendChild(countSpan);
            if (count === 0) slot.classList.add('empty');
        }
        slot.addEventListener('click', () => {
            state.player.selectedSlot = index;
            updateHotbar();
            setState('playing'); // 选中即收起，不需要再按 E（状态机负责恢复指针锁定）
            showTooltip(BlockInfo[blockType].name);
        });
        grid.appendChild(slot);
    });
}

// 打开物品选择网格的唯一入口（E 键与点击手持胶囊共用）
export function openItemPicker() {
    if (state.player.dead) return; // 死亡界面优先，不开背包
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

// ==================== 施工进度控件 + 游戏画面录制 ====================
// AI 渐进施工时顶部显示进度条；[ ] 调速、P 暂停（键位在 input.js），
// R 键用 MediaRecorder 把画布录成 webm 下载，方便记录 AI 建造过程。

const BUILD_WIDGET_STYLE = `
#build-widget{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:120;
/* z-index 120：盖过开始界面(100)/死亡界面(90)——AI 施工时在暂停菜单或死亡界面里也能暂停、调速、传送 */
  display:flex;align-items:center;gap:7px;padding:6px 10px;border-radius:8px;
  background:rgba(20,20,34,.85);border:2px solid #4a4a6a;color:#e8e8f4;
  font-size:12.5px;user-select:none;white-space:nowrap;}
#build-widget.hidden{display:none;}
#build-title{max-width:220px;overflow:hidden;text-overflow:ellipsis;}
#build-bar{width:130px;height:10px;border:1px solid #3d3d5c;border-radius:5px;background:#14142a;overflow:hidden;}
#build-fill{height:100%;width:0%;background:#7ec850;}
#build-widget button{background:#2d2d4a;border:1px solid #4a4a6a;border-radius:5px;color:#e0e0e0;
  cursor:pointer;font-size:12px;padding:2px 7px;font-family:inherit;}
#build-widget button:hover{border-color:#7ec850;}
#build-rec.rec-on{color:#ff7a6a;border-color:#a03030;}
#build-cam.cam-on{color:#8fd0ff;border-color:#3a70a0;}
#build-save{color:#ffd88f;}
#build-save.hidden{display:none;}
#build-hint{color:#8888a8;font-size:11px;}
`;

let buildEls = null;     // 控件 DOM 引用
let wasActive = false;   // 上一帧是否有施工任务（用于完成后延迟隐藏）
let rec = null;          // MediaRecorder 实例（null = 未在录；stop 即置空，收尾在闭包里）
let recStartAt = 0;
let recAutoStopTimer = null; // 录像时长上限计时器
const REC_MAX_SEC = 600;     // 录像数据块全攒在内存（约 60MB/分钟），超 10 分钟自动停录防内存失控
let lastRecUrl = null;       // 刚停的这条录像的 blob URL：自动下载可能被浏览器拦，60 秒内可手动重存
let lastRecName = '';
let recSaveTimer = null;
let saveWindow = false;      // 重存窗口是否开着（updateBuildWidget 据此保持控件可见）
const REC_SAVE_WINDOW_SEC = 60;
let recKeepalive = null;     // 录像补帧保活计时器（见 toggleBuildRecording 内注释）
let recStallWarn = null;     // 「没捕到帧」告警计时器
let recGotData = false;      // 本次录像是否已捕获到任何数据块

function stopRecTimers() {
    clearInterval(recKeepalive);
    recKeepalive = null;
    clearTimeout(recStallWarn);
    recStallWarn = null;
}

export function initBuildWidget() {
    if (buildEls) return;
    const style = document.createElement('style');
    style.textContent = BUILD_WIDGET_STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'build-widget';
    root.className = 'hidden';
    root.innerHTML = `
      <span id="build-title">🏗️ 施工</span>
      <div id="build-bar"><div id="build-fill"></div></div>
      <span id="build-count">0/0</span>
      <button id="build-goto" title="传送到施工现场（G 键）">📍</button>
      <button id="build-slower" title="减速（[ 键）">−</button>
      <span id="build-speed">极速</span>
      <button id="build-faster" title="加速（] 键）">＋</button>
      <button id="build-pause" title="暂停/继续施工（P 键）">⏸</button>
      <button id="build-cam" title="建造跟拍：俯视拍摄施工全过程，建完自动停录（C 键循环切换视角；无任务时先挂机位等待）">🎥</button>
      <button id="build-rec" title="录制游戏画面（R 键），含游戏声音、不含界面，停止后存为 webm">⏺</button>
      <button id="build-save" class="hidden" title="自动下载可能被浏览器拦截，点此重新保存刚才的录像（60 秒内有效）">⬇ 保存录像</button>
      <span id="build-hint">[ ]调速 · P暂停 · C视角 · R录像 · G前往</span>`;
    document.body.appendChild(root);
    // 面板内点击不冒泡，避免触发「点击重新锁定指针」
    root.addEventListener('click', (e) => e.stopPropagation());

    buildEls = {
        root,
        title: root.querySelector('#build-title'),
        fill: root.querySelector('#build-fill'),
        count: root.querySelector('#build-count'),
        speed: root.querySelector('#build-speed'),
        pause: root.querySelector('#build-pause'),
        camBtn: root.querySelector('#build-cam'),
        recBtn: root.querySelector('#build-rec'),
        saveBtn: root.querySelector('#build-save'),
    };
    buildEls.root.querySelector('#build-goto').addEventListener('click', () => teleportToBuildSite());
    buildEls.root.querySelector('#build-slower').addEventListener('click', () => adjustBuildSpeed(-1));
    buildEls.root.querySelector('#build-faster').addEventListener('click', () => adjustBuildSpeed(1));
    buildEls.pause.addEventListener('click', () => toggleBuildPaused());
    buildEls.camBtn.addEventListener('click', () => toggleBuildCam());
    buildEls.recBtn.addEventListener('click', () => toggleBuildRecording());
    buildEls.saveBtn.addEventListener('click', () => { if (lastRecUrl) downloadRecording(); });
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

// 是否正在录像（cameraRig.js 判断跟拍该不该自动停录用）
export function isRecording() {
    return !!rec;
}

// 录像文件名：任务名（buildQueue 的 label）+ 时间戳，多段录像好区分
function recFileName(container = 'webm') {
    const label = (getBuildStatus().label || '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `${label || '建造录像'}-${ts}.${container}`;
}

function downloadRecording() {
    if (!lastRecUrl) return;
    const a = document.createElement('a');
    a.href = lastRecUrl;
    a.download = lastRecName;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// 重存窗口：自动下载可能被浏览器的「多文件下载」拦截（尤其连续录停几条时），
// 60 秒内控件上保留 ⬇ 按钮，被拦的录像点一下就能补存，过期才释放 blob 内存
function openSaveWindow() {
    saveWindow = true;
    buildEls.saveBtn.classList.remove('hidden');
    clearTimeout(recSaveTimer);
    recSaveTimer = setTimeout(() => {
        saveWindow = false;
        buildEls.saveBtn.classList.add('hidden');
        if (lastRecUrl) URL.revokeObjectURL(lastRecUrl);
        lastRecUrl = null;
    }, REC_SAVE_WINDOW_SEC * 1000);
}

function closeSaveWindow() {
    saveWindow = false;
    clearTimeout(recSaveTimer);
    recSaveTimer = null;
    buildEls.saveBtn.classList.add('hidden');
    if (lastRecUrl) URL.revokeObjectURL(lastRecUrl);
    lastRecUrl = null;
}

// R 键 / 控件按钮共用：开始或停止录制游戏画布（视频含游戏声音，不含 DOM 界面）
export function toggleBuildRecording() {
    if (!buildEls) initBuildWidget();
    if (rec) {
        // 立即置空：stop 到 onstop 异步收尾之间再按 R 不会对已停止的 recorder 重复 stop；
        // 收尾（打包下载）用下方闭包捕获的实例，不依赖 rec
        const stopped = rec;
        rec = null;
        stopRecTimers();
        if (stopped.state !== 'inactive') stopped.stop();
        return;
    }
    if (typeof MediaRecorder === 'undefined') {
        showTooltip('⚠️ 当前浏览器不支持 MediaRecorder，无法录像');
        return;
    }
    closeSaveWindow(); // 上一条的重存窗口让位：释放旧 blob，避免两条录像同时在内存里
    const stream = canvas.captureStream(60);
    // 游戏 BGM/音效走 audio.js 的统一主输出，从这里分一条音轨合成进视频。
    // 只有音频上下文在运行时才合入：挂起的上下文不产样本，混进轨道会拖坏时长与兼容性
    let hasAudio = false;
    try {
        if (audioCtx && audioCtx.state === 'running') {
            const audioStream = getRecAudioStream();
            if (audioStream) audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
        }
    } catch (e) { /* 音频栈不可用：降级为无声视频 */ }
    hasAudio = stream.getAudioTracks().length > 0;
    // 优先 mp4（H.264）：文件自带时长元数据、QuickTime/微信等直接能播；
    // 不支持（旧浏览器/Safari 差异）再退回 webm
    const mimes = hasAudio
        ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        : ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = mimes.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const container = mime.includes('mp4') ? 'mp4' : 'webm';
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined);
    // 数据块/起始时间收进闭包：stop 与新一次录制并发时互不污染
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data.size) { chunks.push(e.data); recGotData = true; } };
    mr.onstop = () => {
        stopRecTimers();
        const totalBytes = chunks.reduce((s, c) => s + c.size, 0);
        if (totalBytes < 8192) {
            // 全程一帧都没捕到（页面后台/最小化时画布不重绘，captureStream 无帧可录）：
            // 不落 0 字节废片，直接丢弃并说明
            stream.getTracks().forEach((t) => t.stop());
            showTooltip('⚠️ 本次录像没有捕获到任何画面（页面在后台时画布不更新），已丢弃');
            return;
        }
        const blob = new Blob(chunks, { type: mime.split(';')[0] || 'video/webm' });
        chunks.length = 0; // 释放录像数据块（blob 已持有数据，数组别再占着）
        lastRecUrl = URL.createObjectURL(blob);
        lastRecName = recFileName(container);
        downloadRecording();
        // 停掉捕获轨道：MediaRecorder 停止后 track 仍是 live，不断开会一直占着画布捕获管线（泄漏）
        stream.getTracks().forEach((t) => t.stop());
        openSaveWindow();
        showTooltip(hasAudio ? `🎥 录像已保存（${container}，含游戏声音）` : `🎥 录像已保存（${container}，无声）`);
    };
    rec = mr;
    recGotData = false;
    recStartAt = Date.now();
    recAutoStopTimer = setTimeout(() => {
        if (rec !== mr) return; // 已被手动停止
        showTooltip(`⏺ 录像已达 ${REC_MAX_SEC / 60} 分钟上限，自动停止并保存`);
        toggleBuildRecording();
    }, REC_MAX_SEC * 1000);
    mr.start(1000); // 每秒落一个数据块，崩溃时最多丢 1 秒
    // 补帧保活：captureStream 只在画布重绘时出帧，而后台/最小化/遮挡时 rAF 停摆、画布不再
    // 重绘 → 整段无帧，成片只有开头几秒甚至 0 字节。录制期间低频手动重绘强制出帧
    // （可见时 2fps，后台被浏览器节流到 ~1fps），保证成片时长贴墙钟。
    recKeepalive = setInterval(() => {
        if (!rec) return;
        renderer.render(scene, camera);
        renderViewmodel(renderer);
    }, 500);
    recStallWarn = setTimeout(() => {
        if (rec === mr && !recGotData) showTooltip('⚠️ 还没捕获到画面帧——页面可能在后台/被遮挡，录到的时长会缩水');
    }, 3000);
    showTooltip(`🎥 开始录制游戏画面…（R 停止，最多 ${REC_MAX_SEC / 60} 分钟；${hasAudio ? '含游戏声音' : '无声'}，不含界面）`);
}

// 每帧刷新控件（main.js gameLoop 调用）：有任务或录像中常显，任务结束后停留 3 秒；
// 跟拍模式（含预挂待机）也常显——否则没任务时 🎥/暂停/调速按钮无处可点，挂机位没入口
export function updateBuildWidget() {
    if (!buildEls) return;
    const st = getBuildStatus();
    const recOn = !!rec;
    if (st.active) wasActive = true;
    const show = st.active || recOn || wasActive || saveWindow || state.camMode === 'build' || lastFinishedAgeMs() < 3000;
    if (!st.active && wasActive) {
        wasActive = false;
        if (!recOn) {
            showTooltip(`✅ 施工完成：${st.label}（${st.applied}/${st.total} 格）`);
        }
    }
    buildEls.root.classList.toggle('hidden', !show);
    if (!show) return;

    buildEls.title.textContent = st.label ? `🏗️ ${st.label}` : '🏗️ 施工';
    const pct = st.total ? Math.round((st.applied / st.total) * 100) : 0;
    buildEls.fill.style.width = pct + '%';
    buildEls.count.textContent = `${st.applied}/${st.total}`;
    buildEls.speed.textContent = speedText();
    buildEls.pause.textContent = st.paused ? '▶' : '⏸';
    buildEls.pause.title = st.paused ? '继续施工（P 键）' : '暂停施工（P 键）';
    buildEls.camBtn.classList.toggle('cam-on', state.camMode === 'build');
    buildEls.camBtn.textContent = state.camMode === 'build' ? '🎥 跟拍中' : '🎥';
    if (recOn) {
        const sec = Math.floor((Date.now() - recStartAt) / 1000);
        buildEls.recBtn.textContent = `⏹ ${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    } else {
        buildEls.recBtn.textContent = '⏺';
    }
    buildEls.recBtn.classList.toggle('rec-on', recOn);
}
