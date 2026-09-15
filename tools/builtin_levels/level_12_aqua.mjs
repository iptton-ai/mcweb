// ==================== builtin_levels/level_12_aqua.mjs ====================
// 「深海龙宫」（官方扩展关 L12，水下关 + 招牌机关「水柱电梯」）：
//   流程：沙滩起点（草地+树）→ 跳水点潜入方形水池 → 水下甬道下潜（玻璃穹顶走廊，
//   两侧水景，玩家游泳前进；闯关模式氧气冻结不会憋死）→「珊瑚气室」（水下玻璃穹顶
//   空气室，锁① science·水的性质，检查点；潜水井=室底 1×1 水口，从下方游入）→
//   水柱电梯上行：锁①门后是 1 宽静态水柱（x=31, y6..13 共 8 格，水格 BFS 可通行=
//   合法主路），柱顶与龙宫前殿楼面齐平，游出拱门上殿 →「龙宫前殿」（锁② yuwen·
//   与水相关的诗句，检查点）→「宝藏殿」（锁③ math·两步计算）→ 终点龙座
//   （羊毛红毯 + 矿石堆 + 夜明珠装饰）。整座龙宫沉在方形水池中：先灌水再在水中建
//   玻璃/石殿，殿体从池底一直封到殿顶（水下全封锁防绕行）。
// 自测：node tools/builtin_levels/level_12_aqua.mjs（schema/全解锁 BFS/全封锁防绕行/解锁序）

import {
    BlockTypes,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
    lampId,
} from '../../js/config.js';
import {
    Canvas,
    borderWall,
    choiceQ,
    crenels,
    doorway,
    flagAt,
    ground,
    inputQ,
    isDirectRun,
    runSpecSelfTest,
    torchPost,
    tree,
} from './_lib.mjs';

const { AIR, COBBLESTONE, GLASS, STONE, SAND, TORCH, FLOWER, WOOL, WATER,
    COAL_ORE, IRON_ORE, DIAMOND_ORE } = BlockTypes;

export const LEVEL_FILE = 'level_12_aqua.level.json';

export function buildLevel() {
    const c = new Canvas(66, 22, 40);
    const gy = 6; // 沙滩地面：泥土 0..5 + 草皮 6，站立面 y=7；池水面与沙滩齐平

    ground(c, gy);
    borderWall(c, gy, STONE);

    // ---- 沙滩起点（西岸草带）：树 + 火把柱 + 跳水点夜明珠 ----
    flagAt(c, 6, gy, 20, FLAG_START);
    tree(c, 4, gy, 10); tree(c, 4, gy, 30); tree(c, 10, gy, 8); tree(c, 10, gy, 32);
    torchPost(c, 8, gy, 14); torchPost(c, 8, gy, 26);
    for (const [fx, fz] of [[6, 12], [9, 24], [3, 16], [3, 24]]) c.set(fx, gy + 1, fz, FLOWER);
    c.set(13, gy + 1, 20, lampId(1)); // 跳水点标记（正对水下甬道入口，脚下的池沿 x=14）

    // ---- 方形水池（x15..60, z5..34，深 4 格，水面与沙滩齐平）：先铺水再建殿 ----
    c.fill(14, 2, 4, 14, 6, 35, STONE);  // 池沿（石砌，顶与草皮齐平，可走可跳）
    c.fill(61, 2, 4, 61, 6, 35, STONE);
    c.fill(14, 2, 4, 61, 6, 4, STONE);
    c.fill(14, 2, 35, 61, 6, 35, STONE);
    c.fill(15, 2, 5, 60, 2, 34, STONE);  // 池底
    c.fill(15, 3, 5, 60, 6, 34, WATER);  // 灌水（静态水）
    // 池底铺装：海沙 + 矿石点缀（确定性散布；后续结构会原样覆盖自己的 footprint）
    for (let x = 15; x <= 60; x++) {
        for (let z = 5; z <= 34; z++) {
            const h = (x * 7 + z * 13) % 17;
            if (h === 0) c.set(x, 2, z, SAND);
            else if (h === 5) c.set(x, 2, z, COAL_ORE);
            else if (h === 11) c.set(x, 2, z, IRON_ORE);
        }
    }
    // 池底夜明珠（龙宫灯光从水下透上来）
    for (const [lx, lz] of [[17, 7], [58, 7], [17, 32], [58, 32], [38, 5], [38, 34]]) c.set(lx, 3, lz, lampId(1));

    // ---- 水下甬道（玻璃穹顶走廊 x15..23, z=20）：两侧玻璃墙 + 玻璃顶，入口敞在 x=15 ----
    for (let x = 15; x <= 23; x++) {
        for (let y = 3; y <= 6; y++) { c.set(x, y, 19, GLASS); c.set(x, y, 21, GLASS); }
    }
    for (let x = 16; x <= 23; x++) for (let y = 5; y <= 6; y++) c.set(x, y, 20, GLASS);
    // 甬道口海草与珊瑚点缀
    c.set(15, 2, 17, SAND); c.set(16, 2, 23, SAND);
    c.set(15, 3, 18, WOOL); c.set(15, 3, 22, WOOL);

    // ================= 珊瑚气室（玻璃穹顶 x24..30, z16..24，水下空气室） =================
    // 楼板 y=5（玻璃）、墙体 y6..9、穹顶 y=10；内部空气 y6..9。
    // 潜水井 = 楼板 1×1 水口 (27,5..6,20)：从甬道潜到室底水层（y3..4，2 高可游），
    // 沿井上浮，井内水面与室内地面同高（y=6），游出即站上玻璃地板。
    c.fill(24, 5, 16, 30, 5, 24, GLASS);          // 玻璃楼板
    c.clear(25, 6, 17, 29, 9, 23);                // 室内空气（先清掉灌进来的水）
    for (const [px, pz] of [[24, 16], [24, 24], [30, 16], [30, 24]]) {
        c.set(px, 3, pz, GLASS); c.set(px, 4, pz, GLASS); // 角支柱（不挡 z=20 通道）
    }
    for (let y = 6; y <= 9; y++) {                 // 四面穹顶墙
        c.fill(24, y, 16, 30, y, 16, GLASS);
        c.fill(24, y, 24, 30, y, 24, GLASS);
        c.set(24, y, 16, GLASS); c.set(24, y, 24, GLASS);
        c.fill(24, y, 16, 24, y, 24, GLASS);
        c.fill(30, y, 16, 30, y, 24, GLASS);
    }
    c.fill(24, 10, 16, 30, 10, 24, GLASS);         // 玻璃穹顶
    c.set(27, 5, 20, WATER); c.set(27, 6, 20, WATER); // 潜水井（室内 1 格深水口）
    // 室内珊瑚与夜明珠
    c.set(25, 6, 22, WOOL); c.set(25, 7, 22, WOOL);
    c.set(29, 6, 23, WOOL);
    for (const [fx, fz] of [[26, 6, 17], [28, 6, 23]]) c.set(fx, 6, fz, FLOWER);
    c.set(29, 6, 17, lampId(1));
    c.set(28, 6, 18, TORCH);
    // 锁①（science·水的性质）：贴门锁，门在东墙 x=30 通向水柱井
    doorway(c, { x: 30, z: 20, y0: 6, facing: 3 }, { x: 30, y: 6, z: 19 });
    flagAt(c, 26, 5, 18, FLAG_CHECKPOINT); // 检查点：珊瑚气室

    // ================= 水柱电梯（x=31, z=20）：1 宽静态水柱 y6..13 =================
    // 井壁四面石封（防从池水横游进来）；井底 y2..5 石座；柱顶 y=13 与龙宫楼面齐平，
    // 东面 y13..14 开拱门通前殿（游到水面即跨出）。水格 BFS 可通行 = 合法主路。
    for (let y = 2; y <= 15; y++) { c.set(31, y, 19, STONE); c.set(31, y, 21, STONE); }
    c.fill(31, 2, 20, 31, 5, 20, STONE);  // 井底石座
    c.fill(31, 6, 20, 31, 13, 20, WATER); // 水柱本体（上下贯通 8 格）
    c.fill(30, 11, 20, 30, 15, 20, STONE); // 气室穹顶以上封死井的西面（门洞上方封到顶）

    // ================= 龙宫（石殿 x32..58, z8..32，从池底封到殿顶） =================
    c.fill(32, 2, 8, 58, 17, 32, STONE);           // 殿体毛坯（水下全封锁）
    c.clear(33, 13, 9, 40, 16, 31);                // 前殿（层高 4，楼面 y=13）
    c.clear(42, 13, 9, 49, 16, 31);                // 宝藏殿
    c.clear(51, 13, 9, 57, 16, 31);                // 龙座厅
    c.clear(32, 13, 20, 32, 14, 20);               // 水柱井顶拱门（无门，游出即入殿）
    // 前殿→宝藏殿（锁②）与 宝藏殿→龙座厅（锁③）：门洞上方封到殿顶
    c.clear(41, 13, 20, 41, 14, 20);
    doorway(c, { x: 41, z: 20, y0: 13, facing: 3 }, { x: 41, y: 13, z: 19 });
    c.clear(50, 13, 20, 50, 14, 20);
    doorway(c, { x: 50, z: 20, y0: 13, facing: 3 }, { x: 50, y: 13, z: 19 });
    // 殿顶城齿 + 四角夜明珠
    crenels(c, 32, 8, 58, 8, 18);
    crenels(c, 32, 32, 58, 32, 18);
    crenels(c, 32, 8, 32, 32, 18);
    crenels(c, 58, 8, 58, 32, 18);
    for (const [lx, lz] of [[33, 9], [57, 9], [33, 31], [57, 31]]) c.set(lx, 18, lz, lampId(1));

    // ---- 前殿（x33..40）：石柱长廊 + 红毯夹道 + 检查点 + 锁② ----
    for (const pz of [12, 16, 24, 28]) for (let y = 13; y <= 16; y++) c.set(36, y, pz, STONE);
    for (const [tx, tz] of [[35, 12], [37, 12], [35, 28], [37, 28]]) c.set(tx, 13, tz, TORCH);
    for (const [lx, lz] of [[33, 10], [40, 10], [33, 30], [40, 30]]) c.set(lx, 13, lz, lampId(1));
    c.fill(33, 13, 19, 40, 13, 19, WOOL); // 红毯（轴线 z=20 留空不垫，行走面平齐）
    c.fill(33, 13, 21, 40, 13, 21, WOOL);
    flagAt(c, 34, 12, 17, FLAG_CHECKPOINT); // 检查点：龙宫前殿

    // ---- 宝藏殿（x42..49）：矿石堆 + 珍珠袋 + 锁③ ----
    c.set(43, 13, 10, DIAMOND_ORE); c.set(44, 13, 10, DIAMOND_ORE); c.set(43, 13, 11, DIAMOND_ORE);
    c.set(48, 13, 29, IRON_ORE); c.set(49, 13, 29, IRON_ORE); c.set(48, 13, 30, IRON_ORE);
    c.set(43, 13, 30, COAL_ORE); c.set(44, 13, 30, COAL_ORE);
    c.set(46, 13, 11, WOOL); c.set(47, 13, 11, WOOL);
    for (const [tx, tz] of [[42, 12], [49, 12], [42, 28], [49, 28]]) c.set(tx, 13, tz, TORCH);

    // ---- 龙座厅（x51..57）：羊毛红毯 + 龙座 + 矿石堆 + 终点旗 ----
    c.fill(53, 13, 18, 56, 13, 22, WOOL); // 红毯
    c.set(57, 13, 20, COBBLESTONE); c.set(57, 14, 20, COBBLESTONE); // 龙座
    c.set(57, 13, 18, DIAMOND_ORE); c.set(57, 13, 22, DIAMOND_ORE);
    c.set(51, 13, 16, lampId(1)); c.set(51, 13, 24, lampId(1));
    c.set(52, 13, 18, TORCH); c.set(52, 13, 22, TORCH);
    flagAt(c, 55, 13, 20, FLAG_GOAL); // 终点旗立在红毯上

    // ---- 东岸与南北草带装饰（死路草滩，防毛坯感）----
    tree(c, 62, gy, 12); tree(c, 62, gy, 28);
    torchPost(c, 63, gy, 20); torchPost(c, 20, gy, 2); torchPost(c, 46, gy, 2);
    torchPost(c, 20, gy, 38); torchPost(c, 46, gy, 38);
    for (const [fx, fz] of [[64, 10], [64, 30], [24, 38], [52, 2], [8, 38]]) c.set(fx, gy + 1, fz, FLOWER);

    return {
        name: '深海龙宫',
        canvas: c,
        rules: { timeLimit: 480, lockAIHelp: true },
        flags: {
            start: { x: 6, y: gy + 1, z: 20 },
            checkpoints: [
                { x: 26, y: 6, z: 18 },  // 珊瑚气室（潜水井游入）
                { x: 34, y: 13, z: 17 }, // 龙宫前殿（水柱电梯上殿）
            ],
            goal: { x: 55, y: 14, z: 20 },
        },
        questions: [
            // 锁①（珊瑚气室·水的性质）答案复算：水蒸气不可见，「白气」= 液化小水滴
            choiceQ({ x: 30, y: 6, z: 19 }, 'science',
                '龙宫的灶台上烧着一壶开水，壶嘴不断冒出「白气」。这些「白气」其实是——',
                ['水蒸气本身——水蒸气看得见', '水蒸气遇冷变成的小水滴',
                    '壶里溅出来的滚烫小水珠', '灶火里冒出来的烟'], 1,
                '三上·水', '水蒸气是看不见的——看得见的「白气」，已经是遇冷变回的小水滴啦'),
            // 锁②（龙宫前殿·与水相关的诗句）答案复算：千尺潭水 < 汪伦情谊，以水深比情深
            choiceQ({ x: 41, y: 13, z: 19 }, 'yuwen',
                '「桃花潭水深千尺，不及汪伦送我情」——李白写千尺潭水，是为了比什么？',
                ['桃花开得格外鲜艳', '潭里的鱼虾又多又肥', '汪伦送别的情谊非常深', '自己游泳的本领非常高'], 2,
                '三上·古诗', '水深千尺也比不上——诗人拿潭水的深度，和情谊作比较'),
            // 锁③（宝藏殿·两步计算）答案复算：6×8=48，48+17=65，65−25=40
            inputQ({ x: 50, y: 13, z: 19 },
                '龙宫宝库里，上层摆着 6 个宝箱，每箱装 8 颗珍珠；下层还散放着 17 颗。龙王取走 25 颗去镶王冠后，宝库里还剩多少颗珍珠？', 40,
                '三上·混合运算', '先算清 6 箱珍珠一共有多少，再想想取走之后还剩多少'),
        ],
    };
}

if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
