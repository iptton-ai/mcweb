// 探索、装备、维修与作品事实。物资转移共用完整栈接口。
import { state, isCreative } from './state.js';
import {
    BlockInfo,
    BlockTypes as B,
    AdventureItems as I,
    ADVENTURE,
    LifeBlocks,
    ItemTypes,
    HotbarBlocks,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    WORLD_DEPTH,
    isLadderId,
    isLampLitId,
    isPulleyId,
    PLATFORM_ITEM_ID,
    ToolTypes,
} from './config.js';
import { getBlock } from './world.js';
import { adventureData, LANDMARK_NAMES, PROJECT_NAMES } from './adventureData.js';
import { addInventoryStack, damageInventoryTool } from './inventoryStacks.js';
import { addXp, updateHealthUI } from './playerLife.js';
import { showTooltip, updateHotbar } from './ui.js';
import { isWorldPaused } from './uiModal.js';
export function toggleEquipment(id) {
    if (state.levelRun || state.levelEdit) return '临时关卡不使用生存装备';
    if (![I.ARMOR, I.SHIELD].includes(id)) return null;
    if (!(state.player.inventory[id] > 0)) return `先在工作台制作${BlockInfo[id].name}`;
    const a = adventureData(),
        key = id === I.ARMOR ? 'armor' : 'shield';
    a[key] = !a[key];
    state.player.shieldRaised = false;
    return `${a[key] ? '已装备' : '已收起'}${BlockInfo[id].name}${id === I.SHIELD && a[key] ? '：按住 O 举盾；选中盾时也可按住右键 / X' : ''}`;
}
export function protectedDamage(amount, source = 'environment', origin = null) {
    if (state.levelRun || state.levelEdit || !['melee', 'explosion'].includes(source)) return amount;
    const a = adventureData(),
        p = state.player;
    let n = amount;
    if (a.armor && p.inventory[I.ARMOR] > 0) {
        n *= 1 - ADVENTURE.armorReduction;
        damageInventoryTool(I.ARMOR, Math.max(1, Math.ceil(amount / 2)));
    }
    if (a.shield && p.inventory[I.SHIELD] > 0 && p.shieldRaised && origin) {
        const dx = origin.x - p.x,
            dz = origin.z - p.z;
        const distance = Math.hypot(dx, dz);
        const facing = distance < 0.01 || (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz) / distance >= 0.25;
        if (facing) {
            n *= 1 - ADVENTURE.shieldReduction;
            damageInventoryTool(I.SHIELD, Math.max(1, Math.ceil(amount)));
            showTooltip('🛡️ 挡住前方攻击，盾消耗耐久');
        }
    }
    updateHotbar();
    return Math.max(1, Math.round(n));
}
export function repairCost(id) {
    const info = BlockInfo[id];
    if (!info?.maxDurability) return null;
    const tier = info.tool?.tier || 0;
    const material = [I.ARMOR, I.SHIELD, 262].includes(id)
        ? ItemTypes.IRON_INGOT
        : id === 261 || tier === 1
          ? B.PLANKS
          : tier === 2
            ? B.COBBLESTONE
            : tier === 3
              ? ItemTypes.IRON_INGOT
              : ItemTypes.DIAMOND;
    return {
        xp: ADVENTURE.repairXp,
        material,
        count: 1,
        restore: Math.max(1, Math.floor(info.maxDurability * ADVENTURE.repairFraction)),
    };
}
export function nearbyWorkbench() {
    const p = state.player;
    for (let x = Math.floor(p.x) - 4; x <= Math.floor(p.x) + 4; x++)
        for (let y = Math.floor(p.y) - 3; y <= Math.floor(p.y) + 3; y++)
            for (let z = Math.floor(p.z) - 4; z <= Math.floor(p.z) + 4; z++) {
                if (
                    Math.hypot(x + 0.5 - p.x, y - p.y, z + 0.5 - p.z) <= 4.5 &&
                    getBlock(x, y, z) === B.CRAFTING_TABLE
                )
                    return true;
            }
    return false;
}
export function repairTool(id) {
    const p = state.player,
        cost = repairCost(id);
    if (state.levelRun || state.levelEdit || !cost || !(p.inventory[id] > 0)) return '没有可以维修的工具';
    if (!nearbyWorkbench()) return '请站在工作台旁边 4 格内';
    const wear = p.toolWear[id] || 0;
    if (!wear) return '耐久已经是满的，不需要花费';
    if ((p.xp || 0) < cost.xp) return `需要 ${cost.xp} 经验，采矿或制作可以获得`;
    if ((p.inventory[cost.material] || 0) < cost.count) return `需要 1 个${BlockInfo[cost.material].name}`;
    // 只修当前使用的工具，备用工具的磨损保持不变。
    p.inventory[cost.material] -= cost.count;
    p.xp -= cost.xp;
    p.toolWear[id] = Math.max(0, wear - cost.restore);
    updateHealthUI();
    updateHotbar();
    return `修好了 ${Math.min(wear, cost.restore)} 点耐久（花费 ${cost.xp} 经验 + 1 ${BlockInfo[cost.material].name}）`;
}
export function addMapMarker(name) {
    if (state.levelRun || state.levelEdit) return '临时关卡不保存普通世界路标';
    const a = adventureData();
    if (a.markers.length >= 24) return '最多 24 个路标，请先删除不用的';
    const p = state.player,
        id = `mark-${a.nextMarker++}`;
    a.markers.push({
        id,
        name:
            String(name || '我的路标')
                .trim()
                .slice(0, 24) || '我的路标',
        x: p.x,
        y: p.y,
        z: p.z,
    });
    a.target = id;
    return '已在脚下记下路标';
}
export function mapTarget() {
    const a = adventureData();
    return a.target === 'home'
        ? state.homeBed && { ...state.homeBed, name: '我的家' }
        : [...a.markers, ...a.sites.filter((s) => a.discovered.includes(s.id))].find(
              (p) => p.id === a.target,
          );
}
export function explorationHint() {
    const p = state.player,
        a = adventureData(),
        target = mapTarget();
    const gear = [
        a.armor && p.inventory[I.ARMOR] > 0 ? '铁护具' : '',
        a.shield && p.inventory[I.SHIELD] > 0 ? (p.shieldRaised ? '🛡️ 举盾' : '盾：按住 O') : '',
    ]
        .filter(Boolean)
        .join(' · ');
    if (!target) return `J 探险手册 · 地图 / 装备 / 我的作品${gear ? ' · ' + gear : ''}`;
    const dx = target.x - p.x,
        dz = target.z - p.z,
        dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    const direction = dirs[(Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8];
    return `${target.name || LANDMARK_NAMES[target.id]}：${direction} ${Math.round(Math.hypot(dx, dz))} 格 · J 手册${gear ? ' · ' + gear : ''}`;
}
export function tickAdventure() {
    if (
        state.levelRun ||
        state.levelEdit ||
        isCreative() ||
        state.player.dead ||
        state.player.flying ||
        isWorldPaused()
    )
        return;
    const a = adventureData(),
        p = state.player;
    for (const s of a.sites)
        if (!a.discovered.includes(s.id) && Math.hypot(p.x - s.x, p.z - s.z) < 6 && Math.abs(p.y - s.y) < 5) {
            a.discovered.push(s.id);
            addInventoryStack({ id: I.SOUVENIR, count: 1 });
            addXp(ADVENTURE.discoveryXp);
            showTooltip(
                `🧭 发现${LANDMARK_NAMES[s.id]}！探索纪念章 +1，经验 +${ADVENTURE.discoveryXp}。按 J 记路标，随时找回家。`,
            );
        }
}
export function chooseProject(id) {
    if (state.levelRun || state.levelEdit || !PROJECT_NAMES[id]) return '请在自己的世界选择作品';
    const a = adventureData(),
        p = state.player;
    a.project = id;
    a.projects[id] ||= {
        x: p.x,
        y: p.y,
        z: p.z,
        name: PROJECT_NAMES[id],
        explanation: '',
        liftMoves: 0,
        harvestStart: a.harvests,
        deliveredStart: a.delivered,
    };
    return '已选择作品；检查范围以第一次选择时脚下为中心，24 格内。切换不会清掉作品。';
}
export function projectProgress(id = adventureData().project) {
    const a = adventureData(),
        project = a.projects[id];
    if (!project) return [];
    const counts = { crops: 0, fences: 0, chest: 0, ladder: 0, platform: 0, pulley: 0, lights: 0, tower: 0 };
    const cx = Math.floor(project.x),
        cy = Math.floor(project.y),
        cz = Math.floor(project.z);
    for (let x = Math.max(0, cx - 24); x <= Math.min(WORLD_WIDTH - 1, cx + 24); x++)
        for (let z = Math.max(0, cz - 24); z <= Math.min(WORLD_DEPTH - 1, cz + 24); z++)
            for (let y = Math.max(1, cy - 24); y <= Math.min(WORLD_HEIGHT - 1, cy + 32); y++) {
                const b = getBlock(x, y, z);
                if (b >= 244 && b <= 247) counts.crops++;
                if (b === LifeBlocks.FENCE || b === LifeBlocks.GATE || b === LifeBlocks.GATE_OPEN)
                    counts.fences++;
                if (b === LifeBlocks.CHEST) counts.chest++;
                if (isLadderId(b)) counts.ladder++;
                if (b === PLATFORM_ITEM_ID) counts.platform++;
                if (isPulleyId(b)) counts.pulley++;
                if (y >= cy + 5 && (b === B.TORCH || isLampLitId(b))) counts.lights++;
                if (y >= cy + 3 && [B.COBBLESTONE, B.PLANKS, B.BRICK].includes(b)) counts.tower++;
            }
    const entry = (label, value, need) => ({ label, value, need, done: value >= need });
    if (id === 'farm')
        return [
            entry('种下 6 格小麦', counts.crops, 6),
            entry('围栏与门 8 格', counts.fences, 8),
            entry('放一个仓库箱子', counts.chest, 1),
            entry('亲手收获 6 次成熟小麦', a.harvests - project.harvestStart, 6),
        ];
    if (id === 'lighthouse')
        return [
            entry('搭高处塔身 12 格（高出起点 3 格）', counts.tower, 12),
            entry('高处火把或亮灯（高出起点 5 格）', counts.lights, 1),
            entry('搭至少 5 格可攀爬木梯', counts.ladder, 5),
            entry('给作品写讲解', project.explanation.trim().length, 8),
        ];
    return [
        entry('放置滑轮', counts.pulley, 1),
        entry('放置电梯平台', counts.platform, 1),
        entry('备好返程木梯 5 格', counts.ladder, 5),
        entry('本作品范围内平台真实移动 3 格', project.liftMoves || 0, 3),
        entry('传送带真正入箱 16 件', a.delivered - project.deliveredStart, 16),
    ];
}
