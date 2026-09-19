// ==================== uiKeys.js ====================
// UI 键盘导航（2026-09-18 键盘化收尾批次）：浮层打开时方向键在「可操作元素」之间
// 做二维空间导航——按几何最近移动焦点，网格 / 列表 / 按钮区 / 表单通吃，无需逐面板
// 配置；Enter / Space 激活；输入框内 Enter / Esc / 上下键退出打字回到导航。
// 纯键盘模式的「游戏操作」（Enter 挖 / X 放 / I 吸 / 方向键转视角）不归这里——
// 那套在 input.js 与鼠标同源；本模块只管 UI 浮层，两种输入模式（鼠标/键盘）下行为一致。
//
// 导航范围（按优先级，第一个可见者胜出；点击/Enter 直接走元素既有的 click 接线，
// 所以合成、选中、进出设置等行为与鼠标点击完全同一路径，无第二套逻辑）：
//   我的题库 > 导出面板 > 组件库 > 关卡列表 > 结算 > 设置 > 背包 > 死亡 > 首屏/暂停 > 拍摄面板(Tab)
// 答题对话框（#edu-quiz / 英语商人 / 出题面板试答态）刻意不进范围：它们已自带
// 数字键作答 + 回车提交（eduKeypad.js 在 window 捕获阶段独占按键），方向键导航
// 若把焦点放上选项按钮，回车会从「提交答案」变成「点选项」= 误答。
//
// 原则：
//   1. 只在浮层可见时活跃；playing 无浮层时零干预（方向键仍归转视角，回归零风险）。
//   2. document 捕获阶段监听，先于 input.js（冒泡）消费；答题卡在 window 捕获更早、
//      仍先于本模块——层级天然正确，无需互相知道对方存在。
//   3. 打字让路：焦点在范围外输入框（助手聊天框等）时整体不插手；范围内的单行
//      文本框左右键归光标、上下键 / Enter / Esc 退出打字（Esc 要按第二次才关面板）；
//      select / range / radio / checkbox / textarea 聚焦时方向键全归原生
//      （滑块调节、下拉换项、多行文本移动光标）。
//   4. 焦点样式用 .uik-focus 类（程序化 focus 不稳定触发 :focus-visible）；
//      聚焦时对元素派发合成 mouseenter / mouseleave，物品说明条等悬停联动免费获得。

import { state } from './state.js';
import { getUIState, isTypingTarget, onUIStateChange } from './uiModal.js';

let inited = false;
let focused = null;   // 当前被本模块聚焦的元素（挂 .uik-focus 类）
let restoreIdx = -1;  // 激活后焦点丢失（列表重建/面板收起）时的回焦下标，-1 = 无待回焦
let lastScopeKey = null; // 上次落焦的导航范围（范围切换 = 换了浮层，需强制移焦）

// —— 焦点样式（聚焦描边；!important 压过各面板的 hover/active 底色差异）——
const FOCUS_STYLE = `
.uik-focus{outline:3px solid #ffd77a !important;outline-offset:1px;border-radius:6px;}
`;

// —— 导航范围表：on() 判可见（用显隐标志或 class，别信 display 计算），sel 是容器选择器 ——
const SCOPES = [
    { sel: ['#question-bank'], on: () => !!state.questionBankOpen },               // 📝 我的题库（平铺录题页）
    { sel: ['#export-panel'], on: () => !!state.levelExportOpen },                 // K 导出关卡卡
    { sel: ['#prefab-picker'], on: () => !!state.prefabPickerOpen },               // B 组件库
    { sel: ['#level-list'], on: isLevelListVisible },                              // 🗺 关卡列表
    { sel: ['#result-panel'], on: () => getUIState() === 'result' },               // 关卡结算
    { sel: ['#game-settings'], on: () => getUIState() === 'settings' },            // ⚙️ 设置
    { sel: ['#inventory-panel'], on: () => getUIState() === 'inventory' },         // E 背包
    { sel: ['#death-screen'], on: () => getUIState() === 'dead' },                 // 死亡界面
    { sel: ['#start-screen'], on: () => getUIState() === 'title' || getUIState() === 'pause' }, // 首屏/暂停
    { sel: ['#recording-panel', '#build-widget'], on: () => !!state.recordingControlsOpen },    // Tab 拍摄
];

function isLevelListVisible() {
    const el = document.getElementById('level-list');
    return !!el && !el.classList.contains('hidden');
}

// 当前导航范围：{ key, containers } 或 null。容器本身还要再验一次真实可见
//（class 显隐与标志可能瞬时不一致）
function activeScope() {
    for (const s of SCOPES) {
        if (!s.on()) continue;
        const els = s.sel.map((q) => document.querySelector(q)).filter(Boolean).filter(isVisible);
        if (els.length) return { key: s.sel[0], containers: els };
    }
    return null;
}

function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

const FOCUSABLE_SEL = 'button, [href], input, select, textarea, [tabindex]';

// 范围内可导航元素：按 DOM 顺序去重，滤掉禁用/隐藏/文件与隐藏输入
function focusables(containers) {
    const out = [];
    const seen = new Set();
    for (const root of containers) {
        for (const el of root.querySelectorAll(FOCUSABLE_SEL)) {
            if (seen.has(el)) continue;
            seen.add(el);
            if (el.disabled) continue;
            if (el.type === 'hidden' || el.type === 'file') continue;
            if (!isVisible(el)) continue;
            out.push(el);
        }
    }
    return out;
}

function isTextEntry(el) {
    if (el.tagName === 'TEXTAREA') return false; // 多行文本：按键全归打字，导航不碰
    if (el.tagName !== 'INPUT') return false;
    return !['range', 'radio', 'checkbox', 'button', 'submit', 'file', 'color'].includes(el.type);
}

// 方向键要全归原生的控件：滑块调值、下拉换项、单选组移动、数字步进、多行文本光标
function isNativeArrowConsumer(el) {
    if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return ['range', 'radio', 'checkbox', 'number'].includes(el.type);
}

function applyFocus(el) {
    if (focused && focused !== el) {
        focused.classList.remove('uik-focus');
        focused.dispatchEvent(new MouseEvent('mouseleave'));
    }
    focused = el;
    el.classList.add('uik-focus');
    el.focus({ preventScroll: true });
    // 合成悬停联动：背包格/配方行的物品说明条等 mouseenter 依赖，键盘焦点同样触发
    el.dispatchEvent(new MouseEvent('mouseenter'));
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function clearFocus() {
    if (!focused) return;
    focused.classList.remove('uik-focus');
    focused.dispatchEvent(new MouseEvent('mouseleave'));
    focused = null;
}

// 空间导航：从当前元素中心出发，往 (dx,dy) 方向找「主轴距离 + 横向偏差加权」最小者；
// 没有当前焦点（刚打开面板 / 焦点在 body）则落在第一个元素。边缘找不到就不动。
function nav(dx, dy) {
    const scope = activeScope();
    if (!scope) return false;
    const items = focusables(scope.containers);
    if (!items.length) return false;
    const cur = items.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) {
        applyFocus(defaultTarget(items));
        return true;
    }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of items) {
        if (el === cur) continue;
        const b = el.getBoundingClientRect();
        const bx = b.left + b.width / 2;
        const by = b.top + b.height / 2;
        const main = dx !== 0 ? (bx - cx) * dx : (by - cy) * dy;
        if (main <= 1) continue; // 只找正方向（1px 容差滤掉互相重叠的元素）
        const cross = dx !== 0 ? Math.abs(by - cy) : Math.abs(bx - cx);
        const score = main + cross * 2.5;
        if (score < bestScore) {
            bestScore = score;
            best = el;
        }
    }
    if (!best) return false;
    applyFocus(best);
    return true;
}

// Enter/Space 激活：直接 click() 走既有接线。select（原生开下拉）与多行文本不代点
function activate(el) {
    if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'A') return false;
    const scope = activeScope();
    restoreIdx = scope ? focusables(scope.containers).indexOf(el) : -1;
    setTimeout(restoreFocus, 0);
    el.click();
    return true;
}

// 激活后的焦点回补：click 处理器常重建 DOM（buildInventoryGrid）或切状态；若焦点
// 落回 body 就聚焦同下标的新元素——连按 Enter 连续合成时方向键位置不掉
function restoreFocus() {
    if (restoreIdx < 0) return;
    const idx = restoreIdx;
    restoreIdx = -1;
    const scope = activeScope();
    if (!scope) return; // 面板已收起（如选中物品回游戏）：不回焦
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae !== document.documentElement && isVisible(ae)) return;
    const items = focusables(scope.containers);
    if (!items.length) return;
    applyFocus(items[Math.min(idx, items.length - 1)]);
}

// 聚焦范围内首个元素，跳过搜索/文本框（打开背包不想一上来就在搜索框里打字）
function focusFirstNonInput(containers) {
    const items = focusables(containers);
    const el = defaultTarget(items);
    if (el) applyFocus(el);
}

// 「默认落点」：首个非文本/搜索、非关闭钮的元素。无焦点时的首次方向键也用它——
// 第一下就落进内容区（配方行/物品格/组件），而不是飘到搜索框或右上角关闭钮
//（关闭钮常是 DOM 第一个可聚焦元素，落上去一按 Enter 就把面板关了）
const CHROME_SEL = '.lvl-close, .gs-close';

function defaultTarget(items) {
    return items.find((x) => !(isTextEntry(x)
        || x.type === 'search' || /search/i.test(x.id || '')
        || x.closest(CHROME_SEL))) || items[0];
}

// 面板打开后调用（状态切换自动调；非暂停浮层由 ui.js 的 open* 手动调）：下一跳聚焦。
// 采样全部放进 defer：uiModal.setState 是先 emit 后 syncOverlays——同步采样时面板
// 还没显示，scope 恒空（背包/结算进不去正是这个原因）；0ms 后显隐已同步、DOM 已重建。
// 范围切换（换了浮层）= 强制移焦进新浮层——旧浮层的聚焦元素可能仍可见（设置面板叠在
// 菜单上），不能靠「焦点有主就跳过」；同范围内才保守（焦点有主不打扰、无主则补落焦）。
function uiKick() {
    restoreIdx = -1; // 状态切换 = 旧范围内算出的回焦下标已作废（如 Enter 进设置换了浮层）
    setTimeout(() => {
        const scope = activeScope();
        const key = scope ? scope.key : null;
        const changed = key !== lastScopeKey;
        lastScopeKey = key;
        if (!scope) return;
        const ae = document.activeElement;
        const aeOk = !!ae && ae !== document.body && ae !== document.documentElement && isVisible(ae);
        const inScope = aeOk && scope.containers.some((c) => c.contains(ae));
        if (inScope) return;                       // 焦点已在本范围内：不重置（双 kick 幂等）
        if (!changed && aeOk) return;              // 同范围且焦点有主（浮层外）：不打扰
        focusFirstNonInput(scope.containers);
    }, 0);
}

// ==================== 键盘分发（document 捕获阶段） ====================
function onKeydown(e) {
    if (e.isComposing) return; // 输入法组词中的 Enter/方向键归输入法
    const scope = activeScope();
    if (!scope) return;
    const containers = scope.containers;
    const ae = document.activeElement;
    const inScope = !!ae && containers.some((c) => c.contains(ae));
    // 焦点在范围外的输入框（助手聊天框、搜索框打字中……）：整体让路
    if (isTypingTarget(e) && !inScope) return;
    const k = e.key;

    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
        if (isTypingTarget(e) && inScope) {
            if (isNativeArrowConsumer(ae)) return;   // 滑块/下拉/多行文本：方向键归原生
            if (k === 'ArrowLeft' || k === 'ArrowRight') return; // 单行文本：左右移光标
            nav(0, k === 'ArrowUp' ? -1 : 1);        // 上下键 = 退出打字，焦点落到几何相邻元素
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
        const dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
        nav(dx, dy);
        e.preventDefault(); // 消费掉：浮层里方向键永不滚动页面
        e.stopPropagation(); // 也不进 input.js（面板态本就不该记游戏键）
        return;
    }

    if (k === 'Enter') {
        if (isTypingTarget(e) && inScope) {
            if (ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT') return; // 换行 / 原生开下拉
            ae.blur();
            focusFirstNonInput(containers); // 搜索完回车 = 直接跳到结果（配方/物品格）
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (inScope && activate(ae)) {
            e.preventDefault(); // 拦掉原生 click 派发，避免与手动 click() 双触发
            e.stopPropagation();
        }
        return;
    }

    if (k === ' ') {
        if (isTypingTarget(e)) return;
        if (ae && inScope) {
            const native = ['BUTTON', 'INPUT', 'SELECT', 'A'].includes(ae.tagName);
            if (native) return; // 原生可激活元素：Space 自带点击，不插手
            activate(ae);       // div 网格格（背包格/槽位行）：Space 与 Enter 同效
            e.preventDefault(); // 且防页面滚动
        }
        return;
    }

    if (k === 'Escape') {
        if (isTypingTarget(e) && inScope) {
            ae.blur(); // 第一次 Esc 退出打字；再按一次才轮到 input.js 关面板
            e.preventDefault();
            e.stopPropagation();
        }
    }
}

// ==================== 初始化 ====================
export function initUIKeys() {
    if (inited) return;
    inited = true;
    const style = document.createElement('style');
    style.textContent = FOCUS_STYLE;
    document.head.appendChild(style);
    document.addEventListener('keydown', onKeydown, true);
    // 状态切换：清残留描边 + 新浮层自动落焦（defer 到 0ms：等 main.js 的
    // refreshMenuTexts 等订阅者把列表重渲染完再找元素）
    onUIStateChange(() => {
        clearFocus();
        uiKick();
    });
}

// 供 input.js（Tab 开拍摄面板）与 ui.js（open* 非暂停浮层）在打开面板后触发落焦
export { uiKick };
