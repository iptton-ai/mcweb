// ==================== builtin_levels/level_09_clocktower.mjs ====================
// 「时光钟楼」（官方扩展关 L9，数学·时间与量感专场 + 活塞闸门奖励房）：
//   楼前广场（花坛+钟面装饰墙）→ 一层「时分秒厅」锁①（时间换算两步题）→ 楼梯上
//   二层「年月日厅」锁②（闰年/历法推算 + 检查点）→ 三层「量感厅」锁③（质量单位
//   两步题 + 检查点）→ 钟顶露台（终点，钟楼亭 + 火把）。
//   招牌机关「钟机房」奖励房（三层西北角，非必经）：入口 1×2 门洞的下格被**常供电
//   伸出的活塞头**堵死。电路（初始态＝活塞供电伸出）：
//     亮红石火把(反相器) → 红石粉中继(15 级) → 活塞底座 6 邻有激活粉 = 供电伸出；
//   答对机房外操作台上的答题机 → 翻转为常供能源 → 充能脚下方块（火把的挂靠块）→
//   火把熄灭 → 粉失电 → 活塞下降沿收回 → 活塞头消失 = 洞开（近路进机房拿钻石）。
//   楼梯主路才是必经通路（BFS 只验主路），lockDoorHints 给「机房锁→活塞头格」映射。
// 自测：node tools/builtin_levels/level_09_clocktower.mjs（schema/全解锁 BFS/全封锁防绕行/解锁序）

import {
    BlockTypes,
    KEYPAD_BASE,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
    dustId,
    lampId,
    pistonHeadId,
    pistonId,
    rtorchId,
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

const { AIR, BRICK, COBBLESTONE, GLASS, LOG, PLANKS, STONE, TORCH, FLOWER, WOOL,
    DIAMOND_ORE, IRON_ORE } = BlockTypes;

export const LEVEL_FILE = 'level_09_clocktower.level.json';

export function buildLevel() {
    const c = new Canvas(56, 30, 44);
    const gy = 3;
    // 楼层：楼板厚度 1，y 值为楼板所在层；站立面 = 楼板 y+1
    const F2T = gy + 6;  // 二层楼板 y=9（一层站立 y=4..8）
    const F3T = gy + 11; // 三层楼板 y=14
    const RT = gy + 16;  // 屋顶楼板 y=19

    ground(c, gy);
    borderWall(c, gy, COBBLESTONE);

    // ---- 塔体毛坯（x22..38, z10..26）+ 逐层内腔/楼板 ----
    c.fill(22, gy + 1, 10, 38, RT - 1, 26, COBBLESTONE);
    c.clear(23, gy + 1, 11, 37, F2T - 1, 25); // 一层内腔
    c.fill(22, F2T, 10, 38, F2T, 26, PLANKS);
    c.clear(23, F2T + 1, 11, 37, F3T - 1, 25); // 二层内腔
    c.fill(22, F3T, 10, 38, F3T, 26, PLANKS);
    c.clear(23, F3T + 1, 11, 37, RT - 1, 25); // 三层内腔
    c.fill(22, RT, 10, 38, RT, 26, PLANKS);

    // ---- 楼前广场（起点 + 花坛 + 树 + 火把柱） ----
    flagAt(c, 30, gy, 40, FLAG_START);
    for (const x of [26, 28, 32, 34]) c.set(x, gy + 1, 34, FLOWER);
    for (const x of [27, 29, 31, 33]) c.set(x, gy + 1, 33, WOOL); // 花坛羊毛镶边
    tree(c, 16, gy, 38);
    tree(c, 44, gy, 38);
    torchPost(c, 24, gy, 38);
    torchPost(c, 36, gy, 38);
    torchPost(c, 24, gy, 29);
    torchPost(c, 36, gy, 29);

    // ---- 一层南墙：敞开拱门（无门，门洞上方墙体封到顶防跳门）+ 玻璃窗 + 大钟面 ----
    c.clear(30, gy + 1, 26, 30, gy + 2, 26);
    for (const [wx, wy] of [[25, 6], [35, 6], [25, 11], [35, 11], [25, 16], [35, 16],
        [22, 6], [22, 11], [22, 16], [38, 6], [38, 11], [38, 16], [27, 6], [33, 6]]) {
        c.set(wx, wy, 26, GLASS);
        c.set(wx, wy, 10, GLASS);
    }
    // 大钟面（嵌在南墙 z=26 上，与墙齐平）：石环 + 玻璃盘 + 指针
    for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
            const d2 = dx * dx + dy * dy;
            if (d2 > 9) continue;
            c.set(30 + dx, 12 + dy, 26, d2 >= 5 ? STONE : GLASS);
        }
    }
    c.set(30, 12, 26, STONE); // 钟心
    c.set(30, 13, 26, COBBLESTONE); // 分针（向上）
    c.set(30, 14, 26, COBBLESTONE);
    c.set(31, 12, 26, COBBLESTONE); // 时针（向 3 点）

    // ---- 一层「时分秒厅」：地面钟盘镶花 + 隔墙 + 锁①（时间换算两步题） ----
    c.fill(29, gy + 1, 17, 31, gy + 1, 19, STONE); // 钟盘基座（1 高可跳上）
    c.set(30, gy + 1, 18, WOOL);
    c.set(24, gy + 1, 12, TORCH);
    c.set(33, gy + 1, 12, TORCH);
    c.set(24, gy + 1, 20, TORCH);
    c.fill(23, gy + 1, 23, 37, F2T - 1, 23, COBBLESTONE); // 一层隔墙（封到楼板）
    doorway(c, { x: 35, z: 23, y0: gy + 1, facing: 2 }, { x: 34, y: gy + 1, z: 23 }); // 锁①
    c.set(36, gy + 1, 24, TORCH);

    // ---- 一层→二层楼梯（z 向逐格 +1，楼板洞开在最后两级头顶） ----
    const stair1 = [[36, gy + 1, 22], [36, gy + 2, 21], [36, gy + 3, 20], [36, gy + 4, 19], [36, gy + 5, 18]];
    for (const [sx, sy, sz] of stair1) c.set(sx, sy, sz, COBBLESTONE);
    c.set(36, F2T, 18, AIR); // 楼板洞（最后两级头顶）
    c.set(36, F2T, 19, AIR);

    // ---- 二层「年月日厅」：检查点 + 隔墙 + 锁②（闰年/历法推算） ----
    flagAt(c, 33, F2T, 20, FLAG_CHECKPOINT);
    c.set(31, F2T + 1, 18, TORCH);
    c.set(35, F2T + 1, 23, TORCH);
    c.set(31, F2T + 1, 14, WOOL); // 「月历石碑」装饰
    c.set(33, F2T + 1, 14, WOOL);
    c.set(35, F2T + 1, 14, WOOL);
    c.fill(29, F2T + 1, 11, 29, F3T - 1, 25, COBBLESTONE); // 二层隔墙
    doorway(c, { x: 29, z: 12, y0: F2T + 1, facing: 3 }, { x: 29, y: F2T + 1, z: 11 }); // 锁②
    c.set(27, F2T + 1, 13, TORCH);

    // ---- 二层→三层楼梯（x 向逐格 +1，楼板洞开在最后两级头顶） ----
    //（放在 z=20：机房占 x23..27, z11..14，楼梯线必须避开它的东墙正上方）
    const stair2 = [[24, F2T + 1, 20], [25, F2T + 2, 20], [26, F2T + 3, 20], [27, F2T + 4, 20]];
    for (const [sx, sy, sz] of stair2) c.set(sx, sy, sz, COBBLESTONE);
    c.set(26, F3T, 20, AIR); // 楼板洞（最后两级头顶）
    c.set(27, F3T, 20, AIR);

    // ---- 三层「量感厅」：检查点 + 隔墙 + 锁③（质量单位两步题） ----
    flagAt(c, 26, F3T, 18, FLAG_CHECKPOINT);
    c.set(24, F3T + 1, 18, TORCH);
    c.set(28, F3T + 1, 16, TORCH);
    c.fill(33, F3T + 1, 11, 33, RT - 1, 25, COBBLESTONE); // 三层隔墙
    doorway(c, { x: 33, z: 20, y0: F3T + 1, facing: 3 }, { x: 33, y: F3T + 1, z: 21 }); // 锁③
    c.set(32, F3T + 1, 22, TORCH);

    // ---- 三层→钟顶楼梯（z 向逐格 +1，屋顶洞开在最后两级头顶） ----
    const stair3 = [[36, F3T + 1, 22], [36, F3T + 2, 21], [36, F3T + 3, 20], [36, F3T + 4, 19]];
    for (const [sx, sy, sz] of stair3) c.set(sx, sy, sz, COBBLESTONE);
    c.set(36, RT, 19, AIR); // 屋顶洞（最后两级头顶）
    c.set(36, RT, 20, AIR);

    // ---- 三层→屋顶隔墙东段的楼梯口照明 ----
    c.set(35, F3T + 1, 24, TORCH);

    // ---- 钟机房（奖励房，非必经）：三层西北角的砖房，钻石藏其中 ----
    c.fill(23, F3T + 1, 11, 27, RT - 1, 14, BRICK);      // 实心毛坯
    c.clear(24, F3T + 1, 12, 26, F3T + 3, 13);           // 房内腔（站立 y=F3T+1）
    c.set(24, F3T + 1, 12, DIAMOND_ORE);                 // 钻石堆
    c.set(25, F3T + 1, 12, DIAMOND_ORE);
    c.set(24, F3T + 2, 12, DIAMOND_ORE);
    c.set(26, F3T + 1, 12, TORCH);
    c.set(25, F3T + 2, 13, IRON_ORE);                    // 悬吊的「齿轮毛坯」装饰
    // 入口：东墙 1×2 门洞（下格 x=F3T+1 由活塞头堵死，上格为通行净空；上方墙体封到顶）
    c.set(27, F3T + 1, 13, AIR);
    c.set(27, F3T + 2, 13, AIR);

    // ---- 活塞闸门电路（初始态＝活塞供电伸出堵洞） ----
    // 底座在房外西侧、朝西（facing 5）伸出，活塞头占据门洞下格；
    // 亮红石火把（挂在操作台西侧）→ 红石粉中继 → 底座 6 邻有激活粉 = 供电。
    c.set(28, F3T + 1, 13, pistonId(false, 5, 1)); // 活塞底座（朝西·伸出）
    c.set(27, F3T + 1, 13, pistonHeadId(5));       // 活塞头＝门洞下格
    c.fill(31, F3T + 1, 12, 32, F3T + 1, 13, COBBLESTONE); // 操作台（2×2，1 高）
    c.set(31, F3T + 2, 13, KEYPAD_BASE);           // 机房答题机（操作台上）
    c.set(31, F3T + 3, 13, lampId(0));             // 解锁正反馈灯
    c.set(30, F3T + 1, 13, rtorchId(5, 1));        // 红石火把（亮），挂操作台西面＝反相器
    c.set(29, F3T + 1, 13, dustId(1));             // 红石粉中继（火把→活塞，15 级）

    // ---- 钟顶露台（终点）：城齿 + 钟楼亭 + 火把 ----
    crenels(c, 22, 10, 38, 26, RT + 1);
    // 城齿棋盘让出楼梯口：洞格头顶 + 上屋落点必须留空，否则泛洪卡死在楼梯洞里
    c.set(36, RT + 1, 19, AIR);
    c.set(36, RT + 1, 18, AIR);
    for (const [px, pz] of [[28, 16], [32, 16], [28, 20], [32, 20]]) {
        c.fill(px, RT + 1, pz, px, RT + 2, pz, LOG); // 钟楼亭四柱
    }
    c.fill(28, RT + 4, 16, 32, RT + 4, 20, PLANKS); // 亭顶（抬到 y23：城齿顶路径 y21 的头顶必须留空）
    c.set(30, RT + 5, 18, TORCH);
    c.set(23, RT + 1, 11, TORCH);
    c.set(37, RT + 1, 25, TORCH);
    flagAt(c, 30, RT, 18, FLAG_GOAL); // 终点旗立在亭中

    return {
        name: '时光钟楼',
        canvas: c,
        rules: { timeLimit: 480, lockAIHelp: true },
        flags: {
            start: { x: 30, y: gy + 1, z: 40 },
            checkpoints: [
                { x: 33, y: F2T + 1, z: 20 }, // 二层年月日厅（过锁②）
                { x: 26, y: F3T + 1, z: 18 }, // 三层量感厅（过锁③）
            ],
            goal: { x: 30, y: RT + 1, z: 18 },
        },
        questions: [
            // 答案复算：30+95=125 分=2 时 05 分；8 时+2 时=10 时 05 分 → 1005
            inputQ({ x: 34, y: gy + 1, z: 23 },
                '钟楼大钟 8 时 30 分再过 95 分钟是几时几分？按「时时分分」填数（如 9 时 20 分填 920）', 1005,
                '三上·时间计算', '先算 30+95=125 分，即 2 时 05 分，再往 8 时上加'),
            // 答案复算：2024 为闰年，2 月 29 天；31+29+31+30+31+30=182
            inputQ({ x: 29, y: F2T + 1, z: 11 },
                '2024 年是闰年，这一年上半年（1~6 月）一共有多少天？', 182,
                '三上·年月日', '闰年 2 月有 29 天：31+29+31+30+31+30'),
            // 答案复算：2500×4=10000 克=10 千克；10×4=40 千克
            choiceQ({ x: 33, y: F3T + 1, z: 21 }, 'math',
                '一袋矿石重 2500 克，一箱装 4 袋，4 箱矿石一共重多少千克？',
                ['20 千克', '40 千克', '100 千克', '400 千克'], 1,
                '三上·质量单位', '先算一箱 2500×4=10000 克=10 千克，再算 4 箱'),
            // 答案复算：8:00→9:30 经历 90 分钟；90÷15=6 圈
            inputQ({ x: 31, y: F3T + 2, z: 13 },
                '钟机房的老齿轮每 15 分钟转一圈，从 8 时整到 9 时 30 分一共转多少圈？', 6,
                '三上·时间计算', '先算经过 90 分钟，再看 90 里有几个 15'),
        ],
        // 机房锁非贴门接线（远程红石→活塞闸门）：必须显式给「锁→被控门格」映射
        //（door=活塞头格；主通路走楼梯，BFS 只验主路，此映射仅供解锁序模拟用）
        lockDoorHints: [
            { key: [31, F3T + 2, 13], door: [27, F3T + 1, 13] },
        ],
    };
}

if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
