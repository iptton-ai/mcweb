// ==================== levelPrefabs.js ====================
// 关卡工坊·预设组件库（2026-09-16）：一键盖出的「半成品关卡零件」——旗标、答题门、
// 星辉门、答题滑轮电梯、城堡塔楼、检查点小屋等。组件只是几何（放完的答题机仍要
// 手持 ✏️ 出题笔双通过才能导出），把「搭骨架」的时间省下来留给出题与设计。
//
// 纯几何铁律：本模块只允许 import config（Node 直连可测，tools/test_level_editor.mjs
// 消费）；写世界（setBlockSafe + 区块重建）在 js/levelEditor.js 的浏览器侧完成。
//
// 组件接线全部照官方内置关卡已验证的红石形态抄（js/config.js ID 编码注释 + tools/
// builtin_levels/）：答题机答对 = 常供能红石信号源 → 贴门直接开 / 红石粉每格 -1 远程解锁 /
// 粉 6 邻激活滑轮 = 卷绳（level_11_liftworks 呼梯明线同款）。红石粉只在实心方块顶面、
// 粉线任意相邻两格 6 邻且步进 ≤1、末端到负载 ≤13 格（15 级起衰减）。

import {
    BlockTypes,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
    PLATFORM_BASE,
    PULLEY_BASE,
    KEYPAD_BASE,
    STARLIGHT_BASE,
    dustId,
    doorId,
    flagId,
    lampId,
    pulleyId,
    starlightId,
    waterwheelId,
} from './config.js';

const { AIR, COBBLESTONE, GLASS, PLANKS, SLIME, STONE, TORCH, WATER } = BlockTypes;

// ==================== 组件几何助手 ====================
// build(put) 向 put(x,y,z,id) 逐格申报；坐标 ∈ [0,w)×[0,h)×[0,d)（越界视为几何 bug，
// 测试兜底）。AIR = 显式雕刻（挖门洞/留空）——盖章时无条件覆写。

// 拱门墙排（quiz_door / quiz_door_remote 共用）：z=0 一排 x=0..3，y=0..3 圆石，
// 门洞 (1,0..1)、答题机嵌 (2,0)、红石灯 (2,1)、墙顶双火把。
function gateway(put) {
    for (let x = 0; x <= 3; x++) {
        for (let y = 0; y <= 3; y++) {
            if (x === 1 && y <= 1) continue; // 门洞（放门）
            if (x === 2 && y <= 1) continue; // 答题机 + 红石灯
            put(x, y, 0, COBBLESTONE);
        }
    }
    put(1, 0, 0, doorId(0, 0, 2)); // 下半扇·关门·南向
    put(1, 1, 0, doorId(1, 0, 2)); // 上半扇
    put(2, 0, 0, KEYPAD_BASE);     // 答题机嵌墙，与门下半 6 邻 = 贴门直开
    put(2, 1, 0, lampId(0));       // 头顶红石灯（答对点亮，doorway 同款）
    put(0, 4, 0, TORCH);
    put(3, 4, 0, TORCH);
}

// ==================== 组件注册表 ====================
// grounded=true：结构件，底排 y=0 落在「准星瞄准的方块」上（嵌地一圈，底面与地形齐平）；
// grounded=false：道具件，锚点落在「准星面外邻格」（旗/门/粘液垫立在地面之上）。
// anchor：组件内与放置点对齐的格子（默认底排中心，瞄准手感即「指哪盖哪」）。
export const PREFABS = [
    // ---- 旗标 ----
    {
        id: 'flag_start', name: '🚩 起点旗', cat: '旗标',
        desc: '出生/重生点。踩上即把重生点刷回起点。', w: 1, h: 1, d: 1,
        grounded: false, anchor: { x: 0, y: 0, z: 0 },
        build: (put) => put(0, 0, 0, flagId(FLAG_START)),
    },
    {
        id: 'flag_checkpoint', name: '🔄 检查点旗', cat: '旗标',
        desc: '踩过激活，死亡回到这里（计时不停）。', w: 1, h: 1, d: 1,
        grounded: false, anchor: { x: 0, y: 0, z: 0 },
        build: (put) => put(0, 0, 0, flagId(FLAG_CHECKPOINT)),
    },
    {
        id: 'flag_goal', name: '🏁 终点旗', cat: '旗标',
        desc: '踩上即结算星级（零死亡+全锁一次过=3 星）。', w: 1, h: 1, d: 1,
        grounded: false, anchor: { x: 0, y: 0, z: 0 },
        build: (put) => put(0, 0, 0, flagId(FLAG_GOAL)),
    },

    // ---- 锁具机关 ----
    {
        id: 'quiz_door', name: '🚪 答题门（贴门锁）', cat: '锁具机关',
        desc: '拱门+答题机嵌在门旁（贴门直开）。答对开门；盖完手持 ✏️ 出题笔右键答题机出题。',
        w: 4, h: 5, d: 1, grounded: false, anchor: { x: 1, y: 0, z: 0 },
        build: gateway,
    },
    {
        id: 'quiz_door_remote', name: '📡 远程答题门', cat: '锁具机关',
        desc: '门与答题机相隔 4 格红石粉明线（每格衰减 1 级，远程解锁）。',
        w: 6, h: 5, d: 2, grounded: false, anchor: { x: 1, y: 0, z: 0 },
        build: (put) => {
            gateway(put); // 门排占 x=0..3 / z=0
            // 石脊托粉线（z=1 排）：粉必须坐在实心方块顶面
            for (let x = 1; x <= 5; x++) put(x, 0, 1, STONE);
            // 粉线：门上半 6 邻 (1,1,1) 起 → 答题机 (5,1,1)，4 格衰减后仍有 11 级
            for (let x = 1; x <= 4; x++) put(x, 1, 1, dustId(0));
            put(5, 1, 1, KEYPAD_BASE); // 坐在石脊末端，与粉尾 6 邻
        },
    },
    {
        id: 'starlight_gate', name: '🌟 星辉门', cat: '锁具机关',
        desc: '「想要但还不会」预告锁：按玩家学习进度出超纲题，答对开门并记提前解锁。',
        w: 3, h: 3, d: 1, grounded: false, anchor: { x: 1, y: 0, z: 0 },
        build: (put) => {
            for (let y = 0; y <= 2; y++) {
                put(0, y, 0, STONE);
                put(2, y, 0, STONE);
            }
            put(1, 2, 0, STONE);      // 门楣
            put(1, 0, 0, starlightId(0)); // 锁定变体坐地，上半留空（halfDoor 同款）
        },
    },
    {
        id: 'quiz_pulley_lift', name: '🛗 答题滑轮电梯', cat: '锁具机关',
        desc: '4×4 塔式电梯：答对答题机 → 红石粉明线激活滑轮卷绳，平台载人升上塔沿（liftworks 呼梯明线同款）。',
        w: 7, h: 8, d: 5, grounded: true, anchor: { x: 4, y: 0, z: 2 },
        build: (put) => {
            // 塔身环墙（x=2..6 / z=0..4，y=0..3），东西各开 1×2 门洞（填墙时留空防重复申报）
            for (let y = 0; y <= 3; y++) {
                for (let x = 2; x <= 6; x++) {
                    put(x, y, 0, COBBLESTONE);
                    put(x, y, 4, COBBLESTONE);
                }
                for (let z = 1; z <= 3; z++) {
                    if (!(z === 2 && y >= 1 && y <= 2)) { // 门洞：x=2 / x=6 墙的 z=2 列
                        put(2, y, z, COBBLESTONE);
                        put(6, y, z, COBBLESTONE);
                    }
                }
            }
            // 塔内地板（嵌地排只替换环墙格，内部地板补齐），井心留电梯平台
            for (let x = 3; x <= 5; x++) {
                for (let z = 1; z <= 3; z++) {
                    if (!(x === 4 && z === 2)) put(x, 0, z, COBBLESTONE);
                }
            }
            put(4, 0, 2, PLATFORM_BASE); // 电梯平台与地板齐平
            // 机头：滑轮（朝下垂挂）← 立轴水车 ← 水源，玻璃罩顶（liftworks 同款）
            put(4, 4, 2, pulleyId(false, false));
            put(4, 5, 2, waterwheelId(1));
            put(4, 6, 2, WATER);
            for (const [gx, gz] of [[3, 1], [4, 1], [5, 1], [3, 2], [5, 2], [3, 3], [4, 3], [5, 3]]) {
                put(gx, 6, gz, GLASS);
            }
            for (let gx = 3; gx <= 5; gx++) {
                for (let gz = 1; gz <= 3; gz++) put(gx, 7, gz, GLASS);
            }
            // 呼梯立柱（井道两侧，底层架空可穿行）+ 柱顶答题机 / 粉线
            for (const [px, pz] of [[3, 1], [3, 2], [5, 1], [5, 2]]) {
                for (let y = 2; y <= 3; y++) put(px, y, pz, STONE);
            }
            put(3, 4, 2, KEYPAD_BASE); // 坐西柱顶：塔内地面右键可及（触及 4.5 格）
            // 粉线沿墙顶走：答题机 → 沿 z=0 墙顶 → 折向东墙内侧柱顶 → 滑轮 6 邻
            for (const [dx, dy, dz] of [[3, 4, 1], [3, 4, 0], [4, 4, 0], [5, 4, 0], [5, 4, 1], [5, 4, 2]]) {
                put(dx, dy, dz, dustId(0));
            }
        },
    },

    // ---- 结构 ----
    {
        id: 'castle_tower', name: '🏰 城堡塔楼', cat: '结构',
        desc: '7×7 圆石塔：门洞+箭窗+城齿，塔内跳台可一路跳上塔顶露台。',
        w: 7, h: 8, d: 7, grounded: true, anchor: { x: 3, y: 0, z: 3 },
        build: (put) => {
            // 环墙 y=0..6；南墙 (z=0) 留门洞 (3,1..2)，箭窗玻璃嵌在墙位（填墙时留空防重复）
            for (let y = 0; y <= 6; y++) {
                for (let x = 0; x <= 6; x++) {
                    if (!(x === 3 && y >= 1 && y <= 2)) put(x, y, 0, COBBLESTONE); // 门洞
                    if (!(x === 3 && y === 3)) put(x, y, 6, COBBLESTONE);          // 南箭窗
                }
                for (let z = 1; z <= 5; z++) {
                    if (!(z === 3 && y === 3)) {
                        put(0, y, z, COBBLESTONE); // 西箭窗
                        put(6, y, z, COBBLESTONE); // 东箭窗
                    }
                }
            }
            put(0, 3, 3, GLASS); // 箭窗
            put(6, 3, 3, GLASS);
            put(3, 3, 6, GLASS);
            // 塔内跳台（对角螺旋 +1）：y=2 → y=3 → y=4 → y=5，再跳上墙顶 y=7
            for (const [x, z] of [[1, 1], [2, 1], [1, 2], [2, 2]]) put(x, 2, z, PLANKS);
            for (const [x, z] of [[4, 4], [5, 4], [4, 5], [5, 5]]) put(x, 3, z, PLANKS);
            for (const [x, z] of [[1, 4], [2, 4], [1, 5], [2, 5]]) put(x, 4, z, PLANKS);
            for (const [x, z] of [[4, 1], [5, 1], [4, 2], [5, 2]]) put(x, 5, z, PLANKS);
            // 城齿（墙顶 y=7 隔格）+ 塔顶火把
            let alt = 0;
            for (let x = 0; x <= 6; x++) {
                put(x, 7, 0, alt++ % 2 === 0 ? COBBLESTONE : AIR);
                put(x, 7, 6, alt++ % 2 === 0 ? COBBLESTONE : AIR);
            }
            for (let z = 1; z <= 5; z++) {
                put(0, 7, z, alt++ % 2 === 0 ? COBBLESTONE : AIR);
                put(6, 7, z, alt++ % 2 === 0 ? COBBLESTONE : AIR);
            }
            put(3, 7, 3, TORCH);
        },
    },
    {
        id: 'checkpoint_hut', name: '🏠 检查点小屋', cat: '结构',
        desc: '木板小屋内置检查点旗+火把照明——长关卡中途歇脚点。',
        w: 5, h: 5, d: 5, grounded: true, anchor: { x: 2, y: 0, z: 2 },
        build: (put) => {
            // 环墙 y=0..2；南墙 (z=0) 门洞 (2,1..2)，侧窗玻璃嵌墙位
            for (let y = 0; y <= 2; y++) {
                for (let x = 0; x <= 4; x++) {
                    if (!(x === 2 && y >= 1 && y <= 2)) put(x, y, 0, PLANKS); // 门洞
                    put(x, y, 4, PLANKS);
                }
                for (let z = 1; z <= 3; z++) {
                    if (!(z === 2 && y === 2)) { // 侧窗玻璃嵌墙位
                        put(0, y, z, PLANKS);
                        put(4, y, z, PLANKS);
                    }
                }
            }
            put(0, 2, 2, GLASS); // 侧窗
            put(4, 2, 2, GLASS);
            for (let x = 0; x <= 4; x++) {
                for (let z = 0; z <= 4; z++) put(x, 3, z, PLANKS); // 平顶
            }
            put(2, 1, 2, flagId(FLAG_CHECKPOINT)); // 屋内检查点旗
            put(2, 4, 2, TORCH);                   // 屋顶火把
        },
    },
    {
        id: 'water_column', name: '💧 水柱电梯', cat: '结构',
        desc: '玻璃罩水柱：按住空格约 5 格/秒上浮，顶部北侧留内凹出口（深海龙宫同款）。',
        w: 3, h: 6, d: 3, grounded: true, anchor: { x: 1, y: 0, z: 1 },
        build: (put) => {
            for (let y = 0; y <= 4; y++) {
                for (const [x, z] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]) {
                    put(x, y, z, GLASS);
                }
                put(1, y, 1, WATER);
            }
            // 顶沿（y=5）：北侧留凹口爬出
            for (const [x, z] of [[0, 1], [0, 2], [1, 2], [2, 2], [2, 1]]) put(x, 5, z, GLASS);
        },
    },
    {
        id: 'bounce_pad', name: '🟢 弹跳垫', cat: '结构',
        desc: '粘液块：高速落下反弹 80% 免摔伤——垫在悬崖底当缓冲，或做弹跳跃层。',
        w: 1, h: 1, d: 1, grounded: false, anchor: { x: 0, y: 0, z: 0 },
        build: (put) => put(0, 0, 0, SLIME),
    },
    {
        id: 'torch_post', name: '💡 火把柱', cat: '结构',
        desc: '两格石柱+火把：给夜路照明（火把照到的格子不刷怪）。',
        w: 1, h: 3, d: 1, grounded: false, anchor: { x: 0, y: 0, z: 0 },
        build: (put) => {
            put(0, 0, 0, STONE);
            put(0, 1, 0, STONE);
            put(0, 2, 0, TORCH);
        },
    },
];

// ==================== 查询与纯几何展开 ====================

const PREFAB_MAP = new Map(PREFABS.map((p) => [p.id, p]));

export function getPrefab(id) {
    return PREFAB_MAP.get(id) || null;
}

// 按分类分组（组件库面板渲染顺序）：'旗标' | '锁具机关' | '结构'
export function listPrefabCats() {
    const cats = [];
    for (const p of PREFABS) {
        if (!cats.includes(p.cat)) cats.push(p.cat);
    }
    return cats;
}

// 展开组件几何 → {cells: [{x,y,z,id}], error?}。纯函数：Node 直测几何合法性与接线。
export function buildPrefabCells(prefab) {
    if (!prefab || typeof prefab.build !== 'function') return { error: '未知组件' };
    const cells = [];
    const seen = new Set();
    let err = null;
    try {
        prefab.build((x, y, z, id) => {
            if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)
                || x < 0 || y < 0 || z < 0 || x >= prefab.w || y >= prefab.h || z >= prefab.d) {
                err = `组件 ${prefab.id} 越界申报 (${x},${y},${z})，尺寸 ${prefab.w}×${prefab.h}×${prefab.d}`;
                throw err;
            }
            const key = `${x},${y},${z}`;
            if (seen.has(key)) {
                err = `组件 ${prefab.id} 重复申报 (${key})`;
                throw err;
            }
            seen.add(key);
            if (!Number.isInteger(id) || id < 0 || id > 255) {
                err = `组件 ${prefab.id} 非法方块 ID ${id} @ (${key})`;
                throw err;
            }
            cells.push({ x, y, z, id });
        });
    } catch (e) {
        return { error: err || String(e) };
    }
    return { cells };
}

// 盖章落点：hit = raycastBlocks 命中（{x,y,z,face:{dx,dy,dz}}）。返回组件 (0,0,0) 的世界原点。
//   grounded=true  → 底排嵌进被瞄方块那一排（origin = hit − anchor）
//   grounded=false → 锚点落在命中面外邻格（origin = hit+face − anchor）
export function prefabOrigin(prefab, hit) {
    const fx = hit.face ? hit.face.dx : 0;
    const fy = hit.face ? hit.face.dy : 0;
    const fz = hit.face ? hit.face.dz : 0;
    const a = prefab.anchor || { x: 0, y: 0, z: 0 };
    const bx = prefab.grounded ? 0 : fx;
    const by = prefab.grounded ? 0 : fy;
    const bz = prefab.grounded ? 0 : fz;
    return {
        x: hit.x + bx - a.x,
        y: hit.y + by - a.y,
        z: hit.z + bz - a.z,
    };
}

// 接线自检辅助（Node 测试用）：BFS「源格 → 6 邻步进」的最短激活距离（只走 cells 里的
// 粉/源格；粉与粉、源与粉 6 邻即连通）。返回 from → to 的步数，不通返回 -1。
export function wireDistance(prefab, from, to) {
    const { cells, error } = buildPrefabCells(prefab);
    if (error) return -1;
    const key = (x, y, z) => `${x},${y},${z}`;
    const wire = new Map();
    for (const c of cells) wire.set(key(c.x, c.y, c.z), c);
    if (!wire.has(key(from.x, from.y, from.z)) || !wire.has(key(to.x, to.y, to.z))) return -1;
    const seen = new Set([key(from.x, from.y, from.z)]);
    let frontier = [[from.x, from.y, from.z]];
    for (let dist = 0; frontier.length; dist++) {
        const next = [];
        for (const [x, y, z] of frontier) {
            if (x === to.x && y === to.y && z === to.z) return dist;
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
                const k = key(x + dx, y + dy, z + dz);
                if (wire.has(k) && !seen.has(k)) {
                    seen.add(k);
                    next.push([x + dx, y + dy, z + dz]);
                }
            }
        }
        frontier = next;
    }
    return -1;
}
