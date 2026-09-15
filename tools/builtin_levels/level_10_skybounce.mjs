// ==================== level_10_skybounce.mjs ====================
// 「弹跳云梯」：仿云间跳跳乐的浮岛手法升级版——
//   起点岛（篝火+树）→ 岛链跑跳（间隙 2 格=BFS 认的 3 格助跑跳）→ 门墙锁①（数学·两步混合运算）
//   → 玻璃独木桥 → 中央主岛（检查点+门墙锁② 英语·情景句）→ 石板桥 → 弹跳塔：
//   塔内粘液垫连跳是捷径/彩蛋通路（观星台星辉门+钻石），塔外螺旋楼梯（逐格+1）是主路，
//   塔顶门墙锁③（数学·周长两步推理）→ 东侧跳台跳下「云池」（2 格深水池缓冲）→ 终点岛（蹦床+奖杯）。
// 主通路（3 锁/2 检查点/终点）全部 6 邻步行·跑跳可达；校验器不懂弹跳，粘液只出现在
// 校验盲区（塔内井与终点蹦床），且塔内井各层不构成任何锁的绕行通道。
// 运行自测：node tools/builtin_levels/level_10_skybounce.mjs

import { BlockTypes, FLAG_START, FLAG_CHECKPOINT, FLAG_GOAL } from '../../js/config.js';
import {
    Canvas,
    crenels,
    doorway,
    flagAt,
    inputQ,
    choiceQ,
    starlightHalfDoor,
    torchPost,
    tree,
    isDirectRun,
    runSpecSelfTest,
} from './_lib.mjs';

const { AIR, GRASS, DIRT, STONE, WATER, GLASS, PLANKS, COBBLESTONE, LOG, TORCH, FLOWER, WOOL, SLIME, DIAMOND_ORE } = BlockTypes;

export const LEVEL_FILE = 'level_10_skybounce.level.json';

export function buildLevel() {
    const c = new Canvas(64, 26, 40);
    const T = 10; // 岛体方块层（岛顶 Grass 在 y=T，站立面 y=T+1）

    // 浮岛：3 层（草皮/泥土/石头），悬浮于云海
    const island = (x0, z0, x1, z1) => {
        c.fill(x0, T, z0, x1, T, z1, GRASS);
        c.fill(x0, T - 1, z0, x1, T - 1, z1, DIRT);
        c.fill(x0, T - 2, z0, x1, T - 2, z1, STONE);
    };

    // ---- A 起点岛（篝火 + 树 + 教学粘液垫）----
    island(3, 16, 13, 24);
    c.set(8, T + 1, 20, STONE); // 起点旗台
    flagAt(c, 8, T + 1, 20, FLAG_START);
    c.set(6, T + 1, 18, LOG); // 篝火：原木 + 火把
    c.set(6, T + 2, 18, TORCH);
    c.fill(4, T, 21, 5, T, 22, SLIME); // 出发前的教学弹跳垫
    tree(c, 10, T, 22);
    torchPost(c, 4, T, 17); torchPost(c, 12, T, 17); torchPost(c, 4, T, 23);
    for (const [x, z] of [[9, 17], [11, 19], [7, 23]]) c.set(x, T + 1, z, FLOWER);

    // ---- 岛链：A→B 间隙 x14..15（2 格空隙=3 格助跑跳，校验 BFS 认）----
    island(16, 16, 22, 24); // B 岛
    // 门墙锁①（数学·两步混合运算）：贯穿岛宽防绕行，门洞上方墙体自然封死
    c.fill(19, T + 1, 16, 19, T + 3, 24, COBBLESTONE);
    crenels(c, 19, 16, 19, 18, T + 4);
    crenels(c, 19, 21, 19, 24, T + 4);
    doorway(c, { x: 19, z: 20, y0: T + 1, facing: 3 }, { x: 19, y: T + 1, z: 21 });
    c.set(17, T + 1, 17, TORCH); // 门迎宾火把
    c.set(17, T + 1, 22, TORCH);
    c.set(21, T + 1, 17, FLOWER);

    // ---- B→C 玻璃独木桥（1 宽 3 长，胆量考验）----
    c.fill(23, T, 20, 25, T, 20, GLASS);

    // ---- C 中央主岛（检查点① + 花园 + 门墙锁② 英语·情景句）----
    island(26, 14, 39, 26);
    flagAt(c, 29, T, 20, FLAG_CHECKPOINT);
    tree(c, 28, T, 24);
    torchPost(c, 30, T, 16); torchPost(c, 30, T, 24);
    for (const [x, z] of [[27, 17], [29, 17], [31, 22], [27, 22]]) c.set(x, T + 1, z, FLOWER);
    c.fill(33, T + 1, 14, 33, T + 3, 26, COBBLESTONE); // 门墙锁②：贯穿岛宽
    crenels(c, 33, 14, 33, 19, T + 4);
    crenels(c, 33, 21, 33, 26, T + 4);
    doorway(c, { x: 33, z: 20, y0: T + 1, facing: 3 }, { x: 33, y: T + 1, z: 19 });
    c.set(31, T + 1, 20, TORCH);
    c.set(35, T + 1, 20, TORCH); // 墙后迎宾

    // ---- C→E 石板桥（2 宽；其余方向 C↔E 间隙 4 格，跑跳跳不过=锁③前无法绕行）----
    c.fill(40, T, 19, 43, T, 20, PLANKS);

    // ---- E 弹跳塔岛 ----
    island(44, 14, 50, 26);
    flagAt(c, 44, T, 21, FLAG_CHECKPOINT); // 检查点②：塔基（摔下来回这里）
    torchPost(c, 45, T, 15); torchPost(c, 50, T, 15); torchPost(c, 44, T, 24); torchPost(c, 50, T, 24);

    // 塔身井壁：外圈 x45..49 / z17..22，y T+1..T+7；西面开两个进入口对准楼梯 3/4 级
    c.fill(45, T + 1, 17, 49, T + 7, 17, COBBLESTONE); // 北壁
    c.fill(45, T + 1, 22, 49, T + 7, 22, COBBLESTONE); // 南壁
    c.fill(45, T + 1, 18, 45, T + 7, 21, COBBLESTONE); // 西壁
    c.fill(49, T + 1, 18, 49, T + 7, 21, COBBLESTONE); // 东壁
    c.clear(45, T + 3, 19, 45, T + 5, 20);            // 西壁进入口（2 宽 3 高，对准楼梯）
    c.clear(46, T + 1, 18, 48, T + 7, 21);            // 井腔

    // 井内粘液弹跳层（捷径+彩蛋通路，BFS 盲区）：
    //   井底粘液垫 → 从楼梯 4/5 级跳进井里落上弹起 → P1 粘液台 → P2 粘液台 → 星辉门半截门进观星台
    c.fill(46, T, 19, 47, T, 20, SLIME);              // 井底垫
    c.fill(46, T + 2, 19, 48, T + 2, 19, STONE);      // P1 台体
    c.fill(46, T + 3, 19, 48, T + 3, 19, SLIME);
    c.fill(46, T + 4, 21, 48, T + 4, 21, STONE);      // P2 台体
    c.fill(46, T + 5, 21, 48, T + 5, 21, SLIME);

    // 观星台彩蛋房（南面贴塔）：唯一入口=南壁上的星辉半截门；玻璃天窗+钻石堆
    c.fill(46, T + 4, 23, 48, T + 4, 24, STONE);      // 房地板
    c.fill(45, T + 5, 23, 45, T + 6, 24, COBBLESTONE); // 西墙
    c.fill(49, T + 5, 23, 49, T + 6, 24, COBBLESTONE); // 东墙
    c.fill(46, T + 5, 25, 48, T + 6, 25, COBBLESTONE); // 南墙
    c.fill(45, T + 7, 23, 49, T + 7, 24, GLASS);      // 玻璃天窗
    c.set(46, T + 4, 24, DIAMOND_ORE);                // 钻石堆
    c.set(48, T + 4, 23, DIAMOND_ORE);
    c.set(48, T + 5, 24, TORCH);
    starlightHalfDoor(c, 47, T + 5, 22);              // 星辉门嵌在南壁（下半实心·上半留空）

    // ---- 塔外螺旋楼梯（主路，逐格 +1）：西壁一列向北再拐上塔顶平台角 ----
    const steps = [
        [44, T + 1, 22], [44, T + 2, 21], [44, T + 3, 20], [44, T + 4, 19],
        [44, T + 5, 18], [44, T + 6, 17], [44, T + 7, 16],
    ];
    for (const [sx, sy, sz] of steps) c.set(sx, sy, sz, COBBLESTONE);
    // 最后一级=塔顶平台西南角，平台在 y=T+8（x45..51 / z16..23，东探出 1 格压住云池护墙）
    c.fill(45, T + 8, 16, 51, T + 8, 23, COBBLESTONE);
    // 平台护栏（1 高）：西 z18..22 / 北 x47..50 / 南 x45..51 / 东 z16..18 与 z22..23；
    //   留三个口：西 z17=进门落点、北 x45..46=门与答题机、东 z19..21=跳台口（跳云池）
    c.fill(45, T + 9, 18, 45, T + 9, 22, COBBLESTONE);
    c.fill(47, T + 9, 16, 50, T + 9, 16, COBBLESTONE);
    c.fill(45, T + 9, 23, 51, T + 9, 23, COBBLESTONE);
    c.fill(51, T + 9, 16, 51, T + 9, 18, COBBLESTONE);
    c.fill(51, T + 9, 22, 51, T + 9, 23, COBBLESTONE);
    // 门墙锁③（数学·周长两步推理）：门洞在平台北沿 x45/z16，门洞上方封两级防跳门
    doorway(c, { x: 45, z: 16, y0: T + 9, facing: 2 }, { x: 46, y: T + 9, z: 16 });
    c.fill(45, T + 11, 16, 45, T + 11, 16, COBBLESTONE);
    c.set(45, T + 10, 22, TORCH); // 护栏角火把
    c.set(51, T + 10, 16, TORCH);

    // ---- 云池（塔东悬浮水池：2 格深水缓冲塔顶跳落）----
    c.fill(51, T - 2, 18, 51, T + 8, 22, COBBLESTONE); // 池西护墙：隔断塔基地面（防未答锁③绕进池）
    c.fill(52, T - 1, 18, 55, T - 1, 22, STONE);       // 池底
    c.fill(52, T, 18, 55, T + 1, 22, WATER);           // 2 格深水

    // ---- F 终点岛（胜利蹦床 + 奖杯火把柱）----
    island(56, 16, 62, 24);
    c.set(60, T + 1, 20, STONE); // 终点旗台
    flagAt(c, 60, T + 1, 20, FLAG_GOAL);
    c.fill(57, T, 22, 58, T, 23, SLIME); // 胜利蹦床
    c.fill(61, T + 1, 17, 61, T + 2, 17, PLANKS); // 奖杯火把柱
    c.set(61, T + 3, 17, TORCH);
    torchPost(c, 56, T, 17);
    c.set(57, T + 1, 16, FLOWER); c.set(61, T + 1, 23, FLOWER); c.set(62, T + 1, 21, WOOL);

    return {
        name: '弹跳云梯',
        canvas: c,
        rules: { timeLimit: 360, lockAIHelp: true },
        flags: {
            start: { x: 8, y: T + 2, z: 20 },
            checkpoints: [
                { x: 29, y: T + 1, z: 20 }, // 中央主岛花园
                { x: 44, y: T + 1, z: 21 }, // 弹跳塔塔基
            ],
            goal: { x: 60, y: T + 2, z: 20 },
        },
        questions: [
            // 锁① 数学·两步混合运算（先乘后减）：3×4=12，20−12=8
            inputQ({ x: 19, y: T + 1, z: 21 },
                '小明买了 3 支笔，每支 4 元。他付给售货员 20 元，应找回多少元？', 8,
                '三上·混合运算', '先算 3 支笔一共要多少钱，再用付出去的钱减掉它'),
            // 锁② 英语·情景句（三上 unit1 问候语）
            choiceQ({ x: 33, y: T + 1, z: 19 },
                'english', '早上到学校见到老师，最合适的问候是？',
                ['Good morning, Miss Li!', 'Good night, Miss Li!', 'Goodbye, Miss Li!', 'Thank you, Miss Li!'], 0,
                '英语·情景对话', '早上见面用 Good morning 打招呼；Good night 是晚上道别时说的'),
            // 锁③ 数学·周长两步推理（先边长×4 求周长，再×2 圈）：6×4=24，24×2=48
            choiceQ({ x: 46, y: T + 9, z: 16 },
                'math', '一个正方形花坛，边长 6 米。绕着它走 2 圈，一共要走多少米？',
                ['12 米', '24 米', '36 米', '48 米'], 3,
                '三上·周长', '先算绕一圈要走多少米（周长 = 边长×4），再乘要走的圈数'),
        ],
    };
}

if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
