// ==================== settingsUI.js ====================
// 游戏设置浮层（首屏 / Esc 暂停菜单的「⚙️ 设置」按钮进入）：
//   🎵 音频 —— 配乐风格包 + 音乐/音效音量（原在助手面板设置中心，迁来统一管理，改动即刻生效）
//   💾 存档 —— 当前世界信息 + 手动保存 + 六槽位管理（进入/开新/删除），槽位行渲染与首屏共用
//
// 浮层显隐由 uiModal.js 状态机的 settings 态统一驱动：只能从 title/pause 进入，
// 关闭（Esc/Q/✕/点空白）回到进入前的状态。本模块只管渲染与即时生效的设置项；
// 切世界/开新/删档等有副作用的动作经 initSettingsUI 注入的回调落到 main.js
// （世界切换编排：clearBuildQueue / initRedstone / clearTransientEntities 都在那里）。

import { GameModes } from './config.js';
import { state } from './state.js';
import { closeSettingsState, getUIState, openSettingsState } from './uiModal.js';
import { BGM_PACKS, getBgmStyle, getBgmVolume, setBgmStyle, setBgmVolume } from './bgm.js';
import { getSfxVolume, setSfxVolume } from './audio.js';
import { exportSlotJson, importSlotJson, listSaves, savedAtText } from './saveGame.js';
import { camera } from './engine.js';

const TAB_KEY = 'mcweb.gameSettings.tab'; // 记住上次停留的页签
const SENS_KEY = 'mcweb.mouseSensitivity';
const FOV_KEY = 'mcweb.fov';

export function getMouseSensitivity() {
    const v = Number(localStorage.getItem(SENS_KEY));
    return Number.isFinite(v) && v > 0 ? v : 1; // 倍率：1 = 默认手感
}

export function getFov() {
    const v = Number(localStorage.getItem(FOV_KEY));
    return Number.isFinite(v) && v >= 50 && v <= 110 ? v : 75;
}

function applyFov(v) {
    localStorage.setItem(FOV_KEY, String(v));
    camera.fov = v;
    camera.updateProjectionMatrix();
}

// ---------- 样式 ----------
const STYLE = `
#game-settings{position:fixed;inset:0;z-index:118;background:rgba(0,0,0,.62);
  display:flex;align-items:center;justify-content:center;cursor:default;}
#game-settings.hidden{display:none;}
.gs-panel{width:min(92vw,620px);max-height:84vh;display:flex;flex-direction:column;
  background:rgba(20,20,35,.98);border:4px solid #4a4a6a;border-radius:12px;
  box-shadow:0 10px 50px rgba(0,0,0,.8);
  font-family:'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;}
.gs-head{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:2px solid #2d2d44;flex:0 0 auto;}
.gs-head h3{margin:0;color:#fff;font-size:17px;letter-spacing:1px;}
.gs-tabs{display:flex;gap:4px;flex:1;}
.gs-tab{background:transparent;border:none;border-bottom:2px solid transparent;color:#8888a8;
  font-size:13.5px;padding:8px 12px;cursor:pointer;font-family:inherit;}
.gs-tab:hover{color:#c0c0d8;}
.gs-tab.active{color:#7ec850;border-bottom-color:#7ec850;}
.gs-close{background:transparent;border:none;color:#c0c0d8;font-size:16px;cursor:pointer;
  width:30px;height:30px;border-radius:6px;flex:0 0 auto;}
.gs-close:hover{background:#2d2d4a;color:#fff;}
.gs-body{flex:1 1 auto;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px;}
.gs-body.hidden{display:none;}
.gs-body::-webkit-scrollbar{width:8px;}
.gs-body::-webkit-scrollbar-thumb{background:#3d3d5c;border-radius:4px;}
.gs-card{background:rgba(30,30,50,.55);border:1px solid #2d2d44;border-radius:10px;padding:12px;}
.gs-card h4{margin:0 0 9px;font-size:13px;color:#cfe3b8;}
.gs-card .card-desc{margin:0 0 10px;color:#77779a;font-size:11.5px;line-height:1.5;}
.gs-hint{color:#77779a;font-size:11.5px;line-height:1.5;}
.gs-note{color:#7ec850;font-size:12px;margin:8px 0 0;min-height:14px;}
/* BGM 风格选择卡：2×2 网格，点选即生效 */
#gs-bgm-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.bgm-style-card{border:2px solid #3d3d5c;border-radius:9px;background:#1c1c30;padding:9px 10px;cursor:pointer;transition:border-color .12s;}
.bgm-style-card:hover{border-color:#5a7a3a;}
.bgm-style-card.active{border-color:#7ec850;background:rgba(60,90,40,.35);}
.bgm-style-card .nm{font-size:13px;color:#fff;}
.bgm-style-card.active .nm{color:#a8e07a;}
.bgm-style-card .ds{font-size:11px;color:#8888a8;margin-top:3px;line-height:1.45;}
.bgm-style-card.active .ds{color:#9ab88a;}
/* 音量滑块行 */
.vol-row{display:flex;align-items:center;gap:10px;}
.vol-row + .vol-row{margin-top:9px;}
.vol-row label{width:34px;color:#9ab;font-size:12px;margin:0;flex:0 0 auto;}
.vol-row input[type=range]{flex:1;accent-color:#7ec850;padding:0;border:none;background:transparent;}
.vol-row .val{width:42px;text-align:right;color:#c0c0d8;font-size:12px;flex:0 0 auto;}
/* 存档页 */
.gs-save-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.gs-save-row .cur{flex:1;min-width:200px;color:#c0c0d8;font-size:13px;}
.gs-btn{background:rgba(40,40,66,.9);color:#fff;border:2px solid #5a5a7a;border-radius:8px;
  padding:8px 16px;font-size:13px;cursor:pointer;transition:all .15s;font-family:inherit;}
.gs-btn:hover{border-color:#7ec850;background:rgba(60,70,90,.95);}
#gs-slot-list{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
@media (max-width:560px){#gs-slot-list{grid-template-columns:1fr;}}
`;

// ---------- 模块状态 ----------
let els = {};       // DOM 引用
let handlers = {};  // main.js 注入：{ onEnter(slot), onNew(mode, slot), onDelete(slot), onSave():bool }
let noteTimers = {}; // 各提示行的自动清空定时器

function flashNote(el, text, ms = 3200) {
    if (!el) return;
    el.textContent = text;
    clearTimeout(noteTimers[el.id]);
    noteTimers[el.id] = setTimeout(() => { el.textContent = ''; }, ms);
}

// ---------- DOM 构建 ----------
export function initSettingsUI(injected) {
    if (els.modal) return; // 已初始化
    handlers = injected || {};

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'game-settings';
    modal.className = 'hidden';
    modal.innerHTML = `
      <div class="gs-panel">
        <div class="gs-head">
          <h3>⚙️ 设置</h3>
          <div class="gs-tabs">
            <button class="gs-tab" data-tab="audio">🎵 音频</button>
            <button class="gs-tab" data-tab="video">🎛 画面</button>
            <button class="gs-tab" data-tab="saves">💾 存档</button>
          </div>
          <button class="gs-close" title="关闭（Esc）">✕</button>
        </div>
        <div class="gs-body" data-page="audio">
          <div class="gs-card">
            <h4>🎵 配乐风格</h4>
            <p class="card-desc">背景配乐按 白天 · 黑夜 · 怪物接近 · 战斗 四种态势自动切换，风格包决定整套编曲，点选即刻生效。</p>
            <div id="gs-bgm-grid"></div>
          </div>
          <div class="gs-card">
            <h4>🔊 音量</h4>
            <div class="vol-row"><label>音乐</label><input type="range" id="gs-vol-bgm" min="0" max="100" step="5"><span class="val" id="gs-vol-bgm-val"></span></div>
            <div class="vol-row"><label>音效</label><input type="range" id="gs-vol-sfx" min="0" max="100" step="5"><span class="val" id="gs-vol-sfx-val"></span></div>
            <p class="card-desc" style="margin:9px 0 0;">音效含挖掘/放置/机械/怪物等反馈声；录像自带这份混音。</p>
          </div>
          <div class="gs-hint">配乐为本地生成；若静态托管未附带音频文件，新包曲目会自动回退经典包，再缺则静默。
            <span class="gs-note" id="gs-audio-note"></span></div>
        </div>
        <div class="gs-body hidden" data-page="video">
          <div class="gs-card">
            <h4>🖱️ 鼠标灵敏度</h4>
            <p class="card-desc">倍率 1 = 默认手感；调大转视角更快。即时生效并记忆。</p>
            <div class="vol-row"><label>灵敏度</label><input type="range" id="gs-sens" min="20" max="300" step="10"><span class="val" id="gs-sens-val"></span></div>
          </div>
          <div class="gs-card">
            <h4>🔭 视野（FOV）</h4>
            <p class="card-desc">数值越大视野越广（原版默认 70，本作默认 75）。即时生效并记忆。</p>
            <div class="vol-row"><label>视野</label><input type="range" id="gs-fov" min="50" max="110" step="1"><span class="val" id="gs-fov-val"></span></div>
          </div>
          <div class="gs-hint">画面设置保存在本机浏览器（localStorage），换设备不跟随。</div>
        </div>
        <div class="gs-body hidden" data-page="saves">
          <div class="gs-card">
            <div class="gs-save-row">
              <span class="cur" id="gs-cur-world"></span>
              <button class="gs-btn" id="gs-btn-save">💾 保存进度</button>
            </div>
            <p class="gs-note" id="gs-save-note"></p>
          </div>
          <div class="gs-card">
            <h4>📦 世界备份（导出 / 导入）</h4>
            <p class="card-desc">导出 = 把当前世界存成 .json 文件（换浏览器/换电脑带走）；导入 = 用备份文件覆盖当前槽位（需再点一次确认，导入后自动刷新页面加载）。</p>
            <div class="gs-save-row">
              <button class="gs-btn" id="gs-btn-export">⬇ 导出当前世界</button>
              <button class="gs-btn" id="gs-btn-import">⬆ 导入存档到当前槽位</button>
              <input type="file" id="gs-import-file" accept=".json,application/json" style="display:none">
            </div>
            <p class="gs-note" id="gs-transfer-note"></p>
          </div>
          <div id="gs-slot-list"></div>
          <div class="gs-hint">点击有档槽位切换世界（当前世界会先自动保存）；空槽位可开新世界；✕ 删除需再点一次确认。</div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    els = {
        modal,
        curWorld: modal.querySelector('#gs-cur-world'),
        saveBtn: modal.querySelector('#gs-btn-save'),
        saveNote: modal.querySelector('#gs-save-note'),
        audioNote: modal.querySelector('#gs-audio-note'),
        slotList: modal.querySelector('#gs-slot-list'),
        transferNote: modal.querySelector('#gs-transfer-note'),
    };

    // 关闭：✕ / 点空白（面板内点击不受影响）
    modal.querySelector('.gs-close').addEventListener('click', closeSettingsState);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSettingsState();
    });
    // 页签切换
    for (const btn of modal.querySelectorAll('.gs-tab')) {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    }
    // 音量滑块：input 即时生效并写入 localStorage（拖动后滑块保持焦点，Esc 由下方捕获兜底）
    const bindVolume = (rangeId, valId, apply) => {
        const range = modal.querySelector(rangeId);
        const val = modal.querySelector(valId);
        range.addEventListener('input', () => {
            val.textContent = `${range.value}%`;
            apply(Number(range.value) / 100);
        });
    };
    bindVolume('#gs-vol-bgm', '#gs-vol-bgm-val', setBgmVolume);
    bindVolume('#gs-vol-sfx', '#gs-vol-sfx-val', setSfxVolume);
    // 画面页：灵敏度 / 视野滑块（即时生效 + localStorage 记忆）
    const sensRange = modal.querySelector('#gs-sens');
    const sensVal = modal.querySelector('#gs-sens-val');
    sensRange.addEventListener('input', () => {
        const v = Number(sensRange.value) / 100;
        sensVal.textContent = `${v.toFixed(1)}×`;
        localStorage.setItem(SENS_KEY, String(v));
    });
    const fovRange = modal.querySelector('#gs-fov');
    const fovVal = modal.querySelector('#gs-fov-val');
    fovRange.addEventListener('input', () => {
        fovVal.textContent = fovRange.value;
        applyFov(Number(fovRange.value));
    });
    // 导出当前世界：先保存最新进度，再下载槽位原始 JSON
    modal.querySelector('#gs-btn-export').addEventListener('click', () => {
        if (handlers.onSave) handlers.onSave(); // 落盘最新进度再导出
        const json = exportSlotJson();
        if (!json) {
            flashNote(els.transferNote, '⚠️ 当前槽位没有存档可导出');
            return;
        }
        const a = document.createElement('a');
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        a.download = `mcweb-世界${state.saveSlot + 1}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        flashNote(els.transferNote, '✅ 世界已导出为 JSON 文件（请留意浏览器的下载拦截面板）');
    });
    // 导入：选文件 → 校验 → 二次确认覆盖当前槽 → 写入并刷新页面
    const importBtn = modal.querySelector('#gs-btn-import');
    const importFile = modal.querySelector('#gs-import-file');
    let importArmed = false;
    importBtn.addEventListener('click', () => {
        if (!importArmed) {
            importArmed = true;
            importBtn.textContent = '⚠️ 再点一次：选择文件并覆盖当前槽';
            setTimeout(() => {
                if (importArmed) {
                    importArmed = false;
                    importBtn.textContent = '⬆ 导入存档到当前槽位';
                }
            }, 4000);
            return;
        }
        importArmed = false;
        importBtn.textContent = '⬆ 导入存档到当前槽位';
        importFile.click(); // 唤起文件选择（选择后走 change 事件）
    });
    importFile.addEventListener('change', () => {
        const file = importFile.files && importFile.files[0];
        importFile.value = ''; // 允许连续导入同一文件
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const err = importSlotJson(String(reader.result));
            if (err) {
                flashNote(els.transferNote, `❌ 导入失败：${err}`);
                return;
            }
            flashNote(els.transferNote, '✅ 导入成功，正在刷新页面加载新世界…');
            setTimeout(() => window.location.reload(), 800);
        };
        reader.onerror = () => flashNote(els.transferNote, '❌ 读取文件失败');
        reader.readAsText(file);
    });
    // 手动保存当前世界
    els.saveBtn.addEventListener('click', () => {
        const ok = handlers.onSave ? handlers.onSave() : false;
        flashNote(els.saveNote, ok
            ? `✅ 已保存到世界 ${state.saveSlot + 1}（每 30 秒也会自动存档）`
            : '⚠️ 存档失败：浏览器存储空间不足');
        renderCurWorld();
    });
    // Esc/Q 关闭浮层：捕获阶段自兜一手——音量滑块拖完保持焦点（INPUT），
    // input.js 的 isTypingTarget 会让路，浮层自己的关闭不能因此失灵
    document.addEventListener('keydown', (e) => {
        if (getUIState() !== 'settings') return;
        if (e.code === 'Escape' || e.code === 'KeyQ') {
            e.preventDefault();
            e.stopPropagation();
            closeSettingsState();
        }
    }, true);
}

// ---------- 页签 ----------
function switchTab(tab) {
    localStorage.setItem(TAB_KEY, tab);
    for (const btn of els.modal.querySelectorAll('.gs-tab')) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    }
    for (const page of els.modal.querySelectorAll('.gs-body')) {
        page.classList.toggle('hidden', page.dataset.page !== tab);
    }
}

// ---------- 打开（首屏 / 暂停菜单按钮调用） ----------
export function openGameSettings() {
    if (!els.modal) return;
    buildStyleCards();
    syncVolumeSliders();
    syncVideoSliders();
    renderSavesPage();
    switchTab(localStorage.getItem(TAB_KEY) === 'video' ? 'video' : localStorage.getItem(TAB_KEY) === 'saves' ? 'saves' : 'audio');
    openSettingsState(); // 非 title/pause 下是 no-op，显隐统一由状态机驱动
}

// ---------- 音频页 ----------
function buildStyleCards() {
    const grid = els.modal.querySelector('#gs-bgm-grid');
    grid.innerHTML = '';
    for (const p of BGM_PACKS) {
        const card = document.createElement('div');
        card.className = 'bgm-style-card' + (p.id === getBgmStyle() ? ' active' : '');
        card.dataset.pack = p.id;
        card.innerHTML = `<div class="nm">${p.icon} ${p.name}</div><div class="ds">${p.desc}</div>`;
        card.addEventListener('click', () => {
            setBgmStyle(p.id);
            for (const c of grid.children) c.classList.toggle('active', c.dataset.pack === p.id);
            flashNote(els.audioNote, `🎵 已切换：${p.name}（曲目加载后按当前态势自动接上）`);
        });
        grid.appendChild(card);
    }
}

function syncVideoSliders() {
    const sens = els.modal.querySelector('#gs-sens');
    const fov = els.modal.querySelector('#gs-fov');
    sens.value = Math.round(getMouseSensitivity() * 100);
    els.modal.querySelector('#gs-sens-val').textContent = `${getMouseSensitivity().toFixed(1)}×`;
    fov.value = getFov();
    els.modal.querySelector('#gs-fov-val').textContent = String(getFov());
}

function syncVolumeSliders() {
    const bgm = els.modal.querySelector('#gs-vol-bgm');
    const sfx = els.modal.querySelector('#gs-vol-sfx');
    bgm.value = Math.round(getBgmVolume() * 100);
    sfx.value = Math.round(getSfxVolume() * 100);
    els.modal.querySelector('#gs-vol-bgm-val').textContent = `${bgm.value}%`;
    els.modal.querySelector('#gs-vol-sfx-val').textContent = `${sfx.value}%`;
}

// ---------- 存档页 ----------
function renderCurWorld() {
    const cur = listSaves()[state.saveSlot];
    const mode = state.gameMode === GameModes.SURVIVAL ? '⚔️ 生存' : '🏗️ 建造';
    els.curWorld.textContent = cur
        ? `当前：世界 ${state.saveSlot + 1} · ${mode} · 上次保存：${savedAtText(cur.savedAt) || '未知时间'}`
        : `当前：世界 ${state.saveSlot + 1} · ${mode} · 尚未保存`;
}

function renderSavesPage() {
    renderCurWorld();
    renderSlotRows(els.slotList, {
        currentSlot: state.saveSlot,
        onEnter: (i) => handlers.onEnter?.(i),          // 进入/切换世界（状态机切 playing，浮层随之关闭）
        onNew: (mode, i) => handlers.onNew?.(mode, i),  // 空槽开新世界
        onDelete: (i) => {                              // 已二次确认的删除；重渲染本页槽位
            handlers.onDelete?.(i);
            renderSavesPage();
        },
    });
}

// ---------- 共用槽位行渲染（首屏 #slot-list 与设置浮层都用） ----------
// 有档槽 = 点击进入该世界 + ✕ 删除（行内二次确认，4 秒不点自动撤销）；
// 空槽 = 建造/生存两个开新按钮。进入/开新/删除的实际动作由 handlers 提供。
export function renderSlotRows(container, { currentSlot, onEnter, onNew, onDelete }) {
    if (!container) return;
    const metas = listSaves();
    container.innerHTML = '';
    let delArm = null; // 行内删除确认状态：待确认的槽位号
    metas.forEach((meta, i) => {
        const row = document.createElement('div');
        row.className = 'slot-row' + (i === currentSlot ? ' current' : '');
        if (meta) {
            const icon = meta.gameMode === GameModes.SURVIVAL ? '⚔️' : '🏗️';
            row.innerHTML =
                `<span class="slot-icon">${icon}</span>` +
                `<span class="slot-info"><span class="slot-name">世界 ${i + 1}${i === currentSlot ? ' · 当前' : ''}</span>` +
                `<span class="slot-time">上次保存：${savedAtText(meta.savedAt) || '未知时间'}</span></span>` +
                `<button class="slot-del" title="删除该存档">✕</button>`;
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                onEnter?.(i);
            });
            const del = row.querySelector('.slot-del');
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                if (delArm === i) {
                    onDelete?.(i);
                    return;
                }
                delArm = i;
                row.classList.add('confirm-del');
                del.textContent = '确认删除？';
                setTimeout(() => {
                    if (delArm === i) {
                        delArm = null;
                        row.classList.remove('confirm-del');
                        del.textContent = '✕';
                    }
                }, 4000);
            });
        } else {
            row.classList.add('empty');
            row.innerHTML =
                `<span class="slot-icon">＋</span>` +
                `<span class="slot-info"><span class="slot-name">空槽位</span>` +
                `<span class="slot-time">开一个新世界</span></span>` +
                `<span class="slot-actions">` +
                `<button class="slot-start" data-mode="${GameModes.CREATIVE}">🏗️ 建造</button>` +
                `<button class="slot-start" data-mode="${GameModes.SURVIVAL}">⚔️ 生存</button></span>`;
            row.querySelectorAll('.slot-start').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onNew?.(btn.dataset.mode, i);
                });
            });
        }
        container.appendChild(row);
    });
}
