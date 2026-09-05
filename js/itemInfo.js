// ==================== itemInfo.js ====================
// 物品说明条（屏幕底部对话式）：鼠标悬停 E 面板的物品格/配方行，或指针自由时的手持胶囊，
// 在屏幕最底下显示「左边 = 物品图标+名称，右边 = 说明行」的信息条（#item-info-strip）。
// 文案全部由数据推导（config.js 的 BlockInfo / RECIPES），少数特殊行为走 SPECIAL_HINTS 附加行。
// 工具的速度/耐久/伤害/采集门槛直接展示——把「四档工具真的有差异」变成看得见的事。
// 显隐由 ui.js 悬停接线与 uiModal.syncOverlays（离开 inventory 态兜底隐藏）驱动。

import {
    BlockInfo, BlockTypes, ItemTypes, RECIPES,
    DOOR_ITEM_ID, DUST_ITEM_ID, RTORCH_ITEM_ID, BUTTON_ITEM_ID, PLATE_ITEM_ID, LEVER_ITEM_ID, LAMP_ITEM_ID,
    PISTON_ITEM_ID, STICKY_PISTON_ITEM_ID, OBSERVER_ITEM_ID,
    WATERWHEEL_ITEM_ID, SHAFT_ITEM_ID, COGWHEEL_ITEM_ID, CRUSHER_ITEM_ID, SAW_ITEM_ID,
} from './config.js';
import { atlasCanvas, blockUVs, tileSize } from './textures.js';

// 四档工具的档名与类别名（与 config.js TOOL_TIER_* 对应）
const TIER_NAMES = ['木', '石', '铁', '钻'];
const TOOL_CLASS = {
    pickaxe: { label: '镐', mines: '石质/矿物', icon: '⛏️' },
    axe: { label: '斧', mines: '木质', icon: '🪓' },
    shovel: { label: '锹', mines: '泥土/沙/雪', icon: '🥄' },
    sword: { label: '剑', mines: null, icon: '⚔️' },
};

// 矿石采集门槛（blockId → 需要的镐档位），供镐类工具描述「可采什么/还差什么」
const ORE_GATES = [
    [BlockTypes.COAL_ORE, 1],
    [BlockTypes.IRON_ORE, 2],
    [BlockTypes.DIAMOND_ORE, 3],
];

// 特殊行为附加行（有状态方块/材料来源等数据表表达不了的信息）
const SPECIAL_HINTS = {
    [BlockTypes.TNT]: ['右键点燃（放置时是惰性的）· 红石信号上升沿也可引爆'],
    [DOOR_ITEM_ID]: ['放置生成两格高的门 · 右键开关整扇'],
    [DUST_ITEM_ID]: ['红石布线：铺在实心方块顶面 · 信号每格 -1 级，可上下爬坡'],
    [RTORCH_ITEM_ID]: ['信号源（15 级）· 挂靠方块被充能则熄灭 = 反相器/时钟'],
    [BUTTON_ITEM_ID]: ['右键按下 → 1 秒后自动弹出（脉冲信号源）'],
    [PLATE_ITEM_ID]: ['玩家/怪物踩住时供能（自动门/陷阱）'],
    [LEVER_ITEM_ID]: ['右键开关 · 稳态信号源'],
    [LAMP_ITEM_ID]: ['6 格邻域有红石信号即点亮（发光处不刷怪）'],
    [BlockTypes.SLIME]: ['被活塞推/拉时会拖走粘着的方块（飞行机器的基础）'],
    [PISTON_ITEM_ID]: ['红石上升沿伸出（最多推 12 格）· 下降沿收回'],
    [STICKY_PISTON_ITEM_ID]: ['同活塞 · 收回时把头前方块拉回一格'],
    [OBSERVER_ITEM_ID]: ['正前方方块变化 → 背面输出 0.2s 脉冲（可做时钟）'],
    [WATERWHEEL_ITEM_ID]: ['顶面接触水 = 动力源（8 RPM · 每台 +64 应力容量）'],
    [SHAFT_ITEM_ID]: ['沿轴向 1:1 传速 · 点顶面 = 立轴、贴墙 = 横轴'],
    [COGWHEEL_ITEM_ID]: ['与垂直轴的相邻齿轮啮合 = 换向反转（平行并排不连接）'],
    [CRUSHER_ITEM_ID]: ['两枚水平相邻配对 · 右键向轮子上方投料碾碎（石头→圆石→沙砾→沙）'],
    [SAW_ITEM_ID]: ['通电后自动锯切朝向格（原木→木板 ×4）'],
    [BlockTypes.WATER]: ['静态水：供水车/造水景 · 只能被方块覆盖，不可挖掘'],
    [BlockTypes.TORCH]: ['光源 · 照到的格子夜间不刷怪'],
    [BlockTypes.COAL_ORE]: ['生成于 y<44 的岩层'],
    [BlockTypes.IRON_ORE]: ['生成于 y<30 的岩层'],
    [BlockTypes.DIAMOND_ORE]: ['生成于 y<12 的深层'],
    [ItemTypes.STICK]: ['合成材料：工具手柄 / 火把'],
    [ItemTypes.COAL]: ['燃料与火把材料 · 挖煤矿石获得'],
    [ItemTypes.IRON_INGOT]: ['熔炉烧制铁矿石获得 · 铁器材料'],
    [ItemTypes.DIAMOND]: ['挖钻石矿石获得（需铁镐+）· 顶级材料'],
    [ItemTypes.GUNPOWDER]: ['苦力怕掉落 · 合成 TNT 的材料'],
};

// 合成关系反查（懒构建）：某物品被哪些配方当材料 / 本身可由哪条配方产出
let usageMap = null;   // id -> Set<产物名>
let sourceMap = null;  // id -> { label: 站点名, text: '材料 → 产物 ×N' }

function buildRecipeMaps() {
    usageMap = new Map();
    sourceMap = new Map();
    for (const r of RECIPES) {
        const outName = BlockInfo[r.out]?.name || '?';
        const label = !r.station ? '徒手合成' : r.station === 'crafting' ? '工作台合成' : '熔炉烧制';
        const costText = Object.keys(r.cost)
            .map((idStr) => `${BlockInfo[Number(idStr)]?.name || '?'}×${r.cost[Number(idStr)]}`)
            .join(' + ');
        sourceMap.set(r.out, { label, text: `${costText} → ${outName} ×${r.outCount}` });
        for (const idStr of Object.keys(r.cost)) {
            const id = Number(idStr);
            if (!usageMap.has(id)) usageMap.set(id, new Set());
            usageMap.get(id).add(outName);
        }
    }
}

const MAX_LINES = 5; // 说明条最多 5 行，超出的合并省略

// 生成一件物品的说明行（纯函数，供说明条与后续复用）
export function describeItem(id) {
    const info = BlockInfo[id];
    if (!info) return [];
    if (!usageMap) buildRecipeMaps();
    const lines = [];

    // ---- 工具/武器（BlockInfo[id].tool 是对象；方块的 .tool 是类别字符串，二者靠 typeof 区分）----
    const tool = typeof info.tool === 'object' ? info.tool : null;
    if (tool) {
        const cls = TOOL_CLASS[tool.class] || { label: '工具', mines: '', icon: '🔧' };
        if (tool.class === 'sword') {
            lines.push(`${cls.icon} 武器：攻击 ${tool.damage} 伤害 · 冷却 ${tool.attackCd}s（徒手 1 伤 / 0.25s）`);
            lines.push(`耐久 ${info.maxDurability} · 挖掘不加速，砍怪专用`);
        } else {
            lines.push(`${cls.icon} ${TIER_NAMES[tool.tier - 1]}${cls.label}：挖${cls.mines}方块速度 ×${tool.speed}（徒手 ×1 · 四档 = 木 2 / 石 4 / 铁 6 / 钻 8）`);
            lines.push(`耐久 ${info.maxDurability} · 攻击 ${tool.damage} 伤害 / ${tool.attackCd}s`);
            if (tool.class === 'pickaxe') {
                const can = ORE_GATES.filter(([, need]) => tool.tier >= need).map(([ore]) => BlockInfo[ore].name);
                const next = ORE_GATES.find(([, need]) => tool.tier < need);
                lines.push(
                    `⛏️ 可采集：${can.join('、')}` +
                    (next ? `（${BlockInfo[next[0]].name} 需 ${TIER_NAMES[next[1] - 1]}镐及以上）` : '（全部矿物）'),
                );
            }
        }
    }

    // ---- 食物 ----
    if (info.food) lines.push(`🍗 右键进食 · 恢复 ${info.food} 点饥饿`);

    // ---- 方块挖掘属性 ----
    const pref = typeof info.tool === 'string' ? TOOL_CLASS[info.tool]?.label : null;
    if (info.hardness > 0 && !tool) {
        let l = `硬度 ${info.hardness}` + (pref ? ` · 宜用${pref}` : '');
        if (info.needsTool) l += ` · 没有${pref}挖开无掉落`;
        if (info.minTier) l += ` · 需 ${TIER_NAMES[info.minTier - 1]}${pref}及以上`;
        lines.push(l);
    }
    if (info.drop != null && info.drop !== id) {
        lines.push(`掉落：${BlockInfo[info.drop]?.name || '?'}${info.xp ? `（+${info.xp} ✨）` : ''}`);
    } else if (info.xp) {
        lines.push(`掉落自身 · +${info.xp} ✨`);
    }
    if (info.station) {
        lines.push(`右键打开${info.station === 'crafting' ? '工作台' : '熔炉'}配方 · Shift+右键 = 直接放置`);
    }

    // ---- 特殊行为 ----
    for (const hint of SPECIAL_HINTS[id] || []) lines.push(hint);

    // ---- 合成关系 ----
    const src = sourceMap.get(id);
    if (src) lines.push(`合成可得（${src.label}）：${src.text}`);
    const uses = usageMap.get(id);
    if (uses && uses.size) {
        const names = [...uses];
        const more = names.length - 4;
        lines.push(`用于合成：${names.slice(0, 4).join('、')}${more > 0 ? ` 等 ${names.length} 项` : ''}`);
    }

    if (lines.length <= MAX_LINES) return lines;
    return [...lines.slice(0, MAX_LINES - 1), lines[lines.length - 1]]; // 特殊行为优先裁掉中段
}

// 画一个物品图标（从图集裁 tile 到 canvas；ui.js 的网格也复用）
export function makeItemIcon(id, size = 24) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const uv = blockUVs[id] || blockUVs[BlockTypes.STONE];
    const tile = uv.top || { x: 0, y: 0 };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlasCanvas, tile.x * tileSize, tile.y * tileSize, tileSize, tileSize, 0, 0, size, size);
    return c;
}

// ==================== 说明条的显示与隐藏 ====================

export function showItemInfo(id) {
    const strip = document.getElementById('item-info-strip');
    if (!strip || !BlockInfo[id]) return hideItemInfo();
    const item = strip.querySelector('.iis-item');
    item.innerHTML = '';
    item.appendChild(makeItemIcon(id, 40));
    const name = document.createElement('div');
    name.className = 'iis-name';
    name.textContent = BlockInfo[id].name;
    item.appendChild(name);
    const linesEl = strip.querySelector('.iis-lines');
    linesEl.innerHTML = '';
    for (const text of describeItem(id)) {
        const div = document.createElement('div');
        div.textContent = text;
        linesEl.appendChild(div);
    }
    strip.classList.add('show');
}

export function hideItemInfo() {
    document.getElementById('item-info-strip')?.classList.remove('show');
}
