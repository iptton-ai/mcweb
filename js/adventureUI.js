import { state } from './state.js';
import { BlockInfo, AdventureItems } from './config.js';
import { adventureData, LANDMARK_NAMES, PROJECT_NAMES } from './adventureData.js';
import {
    addMapMarker,
    chooseProject,
    projectProgress,
    repairCost,
    repairTool,
    toggleEquipment,
    explorationHint,
} from './adventure.js';
import { getUIState, setState, setRecordingControlsOpen } from './uiModal.js';
import { uiKick } from './uiKeys.js';
import { openLevelList, showTooltip } from './ui.js';
import { takeScreenshot } from './input.js';
let root,
    activeTab = 'map',
    hud,
    stylesReady = false,
    elapsed = 0;
function node(tag, text, parent, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    parent?.appendChild(n);
    return n;
}
function button(label, action, parent) {
    const b = node('button', label, parent);
    b.type = 'button';
    b.onclick = action;
    return b;
}
function ensureStyles() {
    if (stylesReady) return;
    const style = node('style', undefined, document.head);
    style.textContent = `#adventure-panel{display:none;position:fixed;inset:0;padding:16px;background:#071523bb;z-index:135;align-items:center;justify-content:center;box-sizing:border-box}#adventure-panel.open{display:flex}.adv-card{width:min(870px,100%);max-height:90dvh;overflow:auto;padding:22px;border:2px solid #94bdad;border-radius:18px;background:#18312e;color:#f5f0d8;font:16px/1.55 system-ui;box-sizing:border-box}.adv-card h2,.adv-card h3{margin:8px 0}.adv-card button{font:inherit;background:#375e52;border:1px solid #9abc91;color:#fff;border-radius:8px;margin:4px;padding:9px 12px;cursor:pointer}.adv-card input,.adv-card textarea{font:inherit;padding:8px;width:min(380px,90%);box-sizing:border-box}.adv-card textarea{display:block;width:100%;min-height:85px}.adv-row{padding:10px 0;border-bottom:1px solid #ffffff22}.adv-map{position:relative;width:min(360px,80vw);aspect-ratio:1;background:repeating-linear-gradient(0deg,transparent 0 11.9%,#557b6d55 12% 12.5%),repeating-linear-gradient(90deg,#254c42 0 11.9%,#557b6d55 12% 12.5%);border:2px solid #8caa92;margin:18px auto}.adv-dot{position:absolute;transform:translate(-50%,-50%);white-space:nowrap;font-size:13px;text-shadow:0 1px 4px #000;background:#10271cbb;padding:2px 4px;border-radius:4px}.adv-status{color:#ffe298;min-height:1.6em}.adv-note{color:#c6d4c0}#adventure-hud{position:fixed;right:12px;top:94px;max-width:min(390px,55vw);padding:6px 10px;border-radius:7px;background:#112b25b8;color:#f2edc9;font:13px/1.4 system-ui;pointer-events:none;z-index:8}`;
    stylesReady = true;
}
function ensure() {
    ensureStyles();
    if (root) return;
    root = node('div', undefined, document.body);
    root.id = 'adventure-panel';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '探险手册');
}
export function openAdventurePanel(tab = 'map') {
    if (state.levelRun || state.levelEdit) {
        showTooltip('探险手册记录自己的生存世界，请先退出临时关卡');
        return false;
    }
    ensure();
    activeTab = tab;
    setState('adventure');
    root.classList.add('open');
    renderAdventurePanel();
    return true;
}
export function closeAdventurePanel() {
    if (root) root.classList.remove('open');
    if (getUIState() === 'adventure') setState('playing');
}
export function renderAdventurePanel(message = '') {
    ensure();
    root.innerHTML = '';
    const card = node('section', undefined, root, 'adv-card');
    button('收起 J / Esc', closeAdventurePanel, card).style.float = 'right';
    node('h2', '🧭 我的探险手册', card);
    const tabs = node('nav', undefined, card);
    for (const [id, label] of [
        ['map', '地图与路标'],
        ['gear', '装备与维修'],
        ['projects', '我的作品'],
    ])
        button(
            label,
            () => {
                activeTab = id;
                renderAdventurePanel();
            },
            tabs,
        ).setAttribute('aria-pressed', String(id === activeTab));
    const status = node('p', message, card, 'adv-status');
    status.setAttribute('role', 'status');
    const action = (fn) => () => renderAdventurePanel(fn());
    const a = adventureData(),
        p = state.player;
    if (activeTab === 'map') {
        node(
            'p',
            '北 ↑　西 ←　东 →　南 ↓　这是整片世界的简图；坐标是 X / Z。' +
                (state.generationVersion >= 3 ? '三条碎石路分别通向北方矿洞、东方旧塔、西方营地。' : ''),
            card,
        );
        if (state.generationVersion < 3)
            node(
                'p',
                '这是旧版地形，升级不会改动你的建筑。三处地标仅在新版新世界生成；这里仍可记路标、做作品。',
                card,
                'adv-note',
            );
        const map = node('div', undefined, card, 'adv-map');
        map.setAttribute('aria-label', '北向上的世界简图');
        const dot = (x, z, label) => {
            const d = node('span', label, map, 'adv-dot');
            d.style.left = `${(x / 256) * 100}%`;
            d.style.top = `${(z / 256) * 100}%`;
        };
        dot(p.x, p.z, '🧍我');
        if (state.homeBed) dot(state.homeBed.x, state.homeBed.z, '🏠家');
        for (const s of a.sites.filter((s) => a.discovered.includes(s.id)))
            dot(s.x, s.z, LANDMARK_NAMES[s.id]);
        for (const m of a.markers) dot(m.x, m.z, '📍' + m.name);
        node('p', `当前位置 ${Math.floor(p.x)} / ${Math.floor(p.z)} · ${explorationHint()}`, card);
        button(
            '方向指向我的家',
            action(() => {
                a.target = 'home';
                return state.homeBed ? '已指向家' : '先对床右键把家记住';
            }),
            card,
        );
        const input = node('input', undefined, card);
        input.maxLength = 24;
        input.placeholder = '路标名字，例如山脚入口';
        input.setAttribute('aria-label', '路标名字');
        button(
            '在脚下记路标',
            action(() => addMapMarker(input.value)),
            card,
        );
        for (const s of [...a.sites.filter((s) => a.discovered.includes(s.id)), ...a.markers]) {
            const row = node('div', undefined, card, 'adv-row');
            node('span', `${s.name || LANDMARK_NAMES[s.id]} · ${Math.floor(s.x)} / ${Math.floor(s.z)}`, row);
            button(
                '指向 ' + (s.name || LANDMARK_NAMES[s.id]),
                action(() => {
                    a.target = s.id;
                    return '方向提示已更新';
                }),
                row,
            );
            if (s.id.startsWith('mark-'))
                button(
                    '删除 ' + s.name,
                    action(() => {
                        a.markers = a.markers.filter((m) => m.id !== s.id);
                        if (a.target === s.id) a.target = 'home';
                        return '路标已删除';
                    }),
                    row,
                );
        }
        node(
            'p',
            `已发现 ${a.discovered.length}/3；必须亲自抵达，每处只获得一次探索纪念章与经验。木梯靠墙放，靠近后 Space / W 上爬，Shift 下爬，松手停住。`,
            card,
            'adv-note',
        );
    } else if (activeTab === 'gear') {
        node(
            'p',
            '铁护具减轻战斗与爆炸伤害 40%；盾需要面朝攻击方向、按住 O。选盾时也能按住右键 / X。饥饿、溺水和摔落仍需自己留心。',
            card,
        );
        for (const id of [AdventureItems.ARMOR, AdventureItems.SHIELD]) {
            const row = node('div', undefined, card, 'adv-row'),
                equipped = a[id === AdventureItems.ARMOR ? 'armor' : 'shield'] && p.inventory[id] > 0;
            node(
                'span',
                `${BlockInfo[id].name}：${p.inventory[id] > 0 ? `耐久 ${BlockInfo[id].maxDurability - (p.toolWear[id] || 0)} / ${BlockInfo[id].maxDurability}` : '还没有，可在工作台制作'}`,
                row,
            );
            button(
                (equipped ? '收起' : '装备') + BlockInfo[id].name,
                action(() => toggleEquipment(id)),
                row,
            );
        }
        node('h3', '工作台维修', card);
        node(
            'p',
            `现有经验：${p.xp || 0}。站在工作台旁，修当前使用的那一把，恢复最多四分之一耐久；备用工具不会被重置。`,
            card,
        );
        for (const [key, count] of Object.entries(p.inventory)) {
            const id = Number(key),
                cost = repairCost(id);
            if (!count || !cost) continue;
            const row = node('div', undefined, card, 'adv-row');
            node(
                'span',
                `${BlockInfo[id].name}：${BlockInfo[id].maxDurability - (p.toolWear[id] || 0)} / ${BlockInfo[id].maxDurability} · 花 ${cost.xp} 经验 + 1 ${BlockInfo[cost.material].name}，最多修 ${cost.restore}`,
                row,
            );
            button(
                '维修' + BlockInfo[id].name,
                action(() => repairTool(id)),
                row,
            );
        }
    } else {
        node(
            'p',
            '自己选一个想做的作品，也可以随时换。第一次选择的位置就是作品中心，检查附近 24 格；建筑要亲手完成。',
            card,
        );
        for (const [id, name] of Object.entries(PROJECT_NAMES))
            button(
                '选择' + name,
                action(() => chooseProject(id)),
                card,
            );
        const project = a.projects[a.project];
        if (project) {
            node('h3', PROJECT_NAMES[a.project], card);
            node(
                'p',
                `作品中心 ${Math.floor(project.x)} / ${Math.floor(project.z)}。这里展示当前真实方块与累计收获、入箱记录。`,
                card,
                'adv-note',
            );
            for (const goal of projectProgress())
                node('p', `${goal.done ? '✅' : '⬜'} ${goal.label}：${goal.value} / ${goal.need}`, card);
            const name = node('input', undefined, card);
            name.value = project.name;
            name.maxLength = 32;
            name.setAttribute('aria-label', '作品名字');
            const explanation = node('textarea', undefined, card);
            explanation.value = project.explanation;
            explanation.maxLength = 280;
            explanation.placeholder = '我做了什么？哪里最有意思？机器是怎样工作的？';
            explanation.setAttribute('aria-label', '作品讲解');
            button(
                '保存作品名字与讲解',
                action(() => {
                    project.name = name.value.trim().slice(0, 32) || PROJECT_NAMES[a.project];
                    project.explanation = explanation.value.trim().slice(0, 280);
                    return '名字和讲解已保存在这个世界';
                }),
                card,
            );
        }
        node('h3', '展示我的作品', card);
        button(
            '拍一张作品截图',
            () => {
                closeAdventurePanel();
                requestAnimationFrame(() => takeScreenshot());
            },
            card,
        );
        button(
            '打开录像面板',
            async () => {
                closeAdventurePanel();
                const { showAssistantPanel } = await import('./assistant/ui.js');
                if (!showAssistantPanel({ focusInput: false })) {
                    showTooltip('助手面板还在加载，请稍后再试');
                    return;
                }
                setRecordingControlsOpen(true);
                document.getElementById('build-rec')?.focus();
            },
            card,
        );
        button(
            '打开关卡工坊',
            () => {
                closeAdventurePanel();
                setState('pause');
                openLevelList();
            },
            card,
        );
        node(
            'p',
            '截图用 F2；录像面板可开始、结束并下载影片。工坊可以新建关卡或改副本，出题双通过后导出关卡卡。生存作品不会自动变成关卡。',
            card,
            'adv-note',
        );
        node('h3', '第一条产线提示', card);
        node(
            'p',
            '水车顶面放水 → 同轴传动轴 → 朝向原木的机械锯。机械锯正下方开始铺向箱子的传送带，末端贴箱子。锯一次原木产 4 木板；满箱时物品排队等待。机器都能在工作台制作。',
            card,
        );
        node('p', `这个世界已由传送带真正入箱 ${a.delivered} 件。`, card);
    }
    uiKick();
}
export function updateAdventureHUD(dt) {
    elapsed += dt;
    if (elapsed < 0.25) return;
    elapsed = 0;
    if (!hud) {
        ensureStyles();
        hud = node('div', undefined, document.body);
        hud.id = 'adventure-hud';
    }
    const hidden =
        state.levelRun ||
        state.levelEdit ||
        state.player.dead ||
        getUIState() !== 'playing' ||
        document.body.classList.contains('hud-hidden');
    hud.style.display = hidden ? 'none' : '';
    if (!hidden) hud.textContent = explorationHint();
}
