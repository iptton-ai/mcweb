// ==================== builtin_levels/level_06_lab.mjs ====================
// 「科学实验站」（官方扩展关 L6，科学专场 + 招牌机关「玻璃布线走廊」）：
//   流程：更衣间起点（羊毛垫+火把）→ 锁①「水实验室」（science·水的三态，贴门锁）→
//   玻璃布线走廊：锁②答题机立在走廊入口（science·空气占据空间），答对翻转为常供能源，
//   红石粉沿玻璃罩下的明线逐格点亮（9 格，源 15 级每格 -1，末端 7 级），远程打开走廊
//   尽头 x=35 的门（远程布线锁！lockDoorHints 必给 锁→门 映射；粉铺实心地板顶面，
//   两侧玻璃墙+玻璃顶罩住防绕踏，罩内 2 高净空=玩家踩着明线一路走到远端门）→
//   「空气实验室」（检查点）→ 锁③「热与温度实验室」（science·温度与热，两步推理
//   情景题，检查点）→ 终点「数据记录室」（工作台+熔炉+羊毛毯装饰）。
// 自测：node tools/builtin_levels/level_06_lab.mjs（schema/全解锁 BFS/全封锁防绕行/解锁序）

import {
    BlockTypes,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
    KEYPAD_BASE,
    doorId,
    dustId,
    lampId,
} from '../../js/config.js';
import {
    Canvas,
    borderWall,
    choiceQ,
    doorway,
    flagAt,
    ground,
    isDirectRun,
    runSpecSelfTest,
    torchPost,
    tree,
} from './_lib.mjs';

const { AIR, COBBLESTONE, GLASS, PLANKS, STONE, TORCH, FLOWER, WOOL, WATER,
    CRAFTING_TABLE, FURNACE } = BlockTypes;

export const LEVEL_FILE = 'level_06_lab.level.json';

export function buildLevel() {
    const c = new Canvas(64, 14, 32);
    const gy = 3; // 地面：泥土 0..2 + 草皮 3，站立面 y=4

    ground(c, gy);
    borderWall(c, gy, STONE);

    // ---- 实验楼主楼（x8..56, z8..24）：外墙 y4..7 + 板岩屋顶 y8 + 木地板 ----
    c.fill(8, gy + 1, 8, 8, gy + 4, 24, COBBLESTONE);   // 西外墙
    c.fill(56, gy + 1, 8, 56, gy + 4, 24, COBBLESTONE); // 东外墙
    c.fill(8, gy + 1, 8, 56, gy + 4, 8, COBBLESTONE);   // 北外墙
    c.fill(8, gy + 1, 24, 56, gy + 4, 24, COBBLESTONE); // 南外墙
    c.fill(8, gy + 5, 8, 56, gy + 5, 24, PLANKS);       // 屋顶（内墙一律封到 y7=结构顶）
    c.fill(9, gy, 9, 55, gy, 23, PLANKS);               // 室内木地板
    // 采光窗（玻璃是实心块，只装饰不通行）
    for (const wx of [12, 20, 28, 40, 48, 55]) { c.set(wx, gy + 2, 8, GLASS); c.set(wx, gy + 3, 8, GLASS); }
    for (const wx of [12, 20, 28, 40, 48, 52]) { c.set(wx, gy + 2, 24, GLASS); c.set(wx, gy + 3, 24, GLASS); }
    for (const wz of [12, 16, 20]) { c.set(8, gy + 2, wz, GLASS); c.set(8, gy + 3, wz, GLASS); c.set(56, gy + 2, wz, GLASS); c.set(56, gy + 3, wz, GLASS); }
    // 屋顶装饰：四角火把 + 两处「通风口」
    for (const [tx, tz] of [[10, 10], [54, 10], [10, 22], [54, 22]]) c.set(tx, gy + 6, tz, TORCH);
    c.fill(20, gy + 6, 12, 21, gy + 6, 12, COBBLESTONE);
    c.fill(44, gy + 6, 20, 45, gy + 6, 20, COBBLESTONE);

    // ---- 室外绿化（北/南/东三面草带）----
    tree(c, 4, gy, 10); tree(c, 4, gy, 22); tree(c, 60, gy, 10); tree(c, 60, gy, 22);
    torchPost(c, 10, gy, 4); torchPost(c, 30, gy, 4); torchPost(c, 50, gy, 4);
    torchPost(c, 10, gy, 28); torchPost(c, 30, gy, 28); torchPost(c, 50, gy, 28);
    for (const [fx, fz] of [[6, 6], [20, 28], [40, 4], [46, 28], [58, 26], [6, 26]]) c.set(fx, gy + 1, fz, FLOWER);

    // ================= 更衣间（x9..15）：羊毛垫 + 火把 + 起点 =================
    c.fill(10, gy + 1, 13, 14, gy + 1, 14, WOOL); // 更衣长凳（羊毛垫）
    c.fill(10, gy + 1, 18, 14, gy + 1, 19, WOOL);
    for (const [tx, tz] of [[9, 12], [15, 12], [9, 20], [15, 20]]) c.set(tx, gy + 1, tz, TORCH);
    flagAt(c, 12, gy, 16, FLAG_START);

    // ---- 隔墙 x=16 + 锁①「水实验室」门（贴门锁：门 + 锁 + 解锁灯） ----
    c.fill(16, gy + 1, 9, 16, gy + 4, 23, COBBLESTONE);
    doorway(c, { x: 16, z: 16, y0: gy + 1, facing: 3 }, { x: 16, y: gy + 1, z: 15 });

    // ================= 水实验室（x17..22）：观察水槽 + 实验台 =================
    // 观察水槽：石栏围出一格水面（烧杯里的「水」）
    for (const [sx, sz] of [[19, 11], [20, 11], [21, 11], [19, 12], [21, 12], [19, 13], [20, 13], [21, 13]]) {
        c.set(sx, gy + 1, sz, STONE);
    }
    c.set(20, gy + 1, 12, WATER);
    c.fill(17, gy + 1, 21, 22, gy + 1, 21, PLANKS); // 实验台
    for (const [tx, tz] of [[17, 10], [22, 22], [17, 22]]) c.set(tx, gy + 1, tz, TORCH);

    // ---- 隔墙 x=23（敞开拱门 z=16，门洞上方封到顶）----
    c.fill(23, gy + 1, 9, 23, gy + 4, 23, COBBLESTONE);
    c.clear(23, gy + 1, 16, 23, gy + 2, 16);

    // ================= 玻璃布线走廊（x24..34）：招牌机关 =================
    // 锁②答题机立在走廊入口（x=25 地面），头顶红石灯；
    // 明线 = 地板红石粉 x26..34（9 格，末端 7 级 > 0）；
    // 玻璃罩 = 两侧玻璃墙(x27..34, y4..5, z15/17) + 玻璃顶(y6)，罩内 2 高净空，
    // x26 留敞口：玩家从答题机旁走进罩内，踩着明线走向远端门。
    c.set(25, gy + 1, 16, KEYPAD_BASE); // 锁②（远程布线锁）
    c.set(25, gy + 2, 16, lampId(0));   // 解锁正反馈灯
    for (let x = 26; x <= 34; x++) c.set(x, gy + 1, 16, dustId(0));
    for (let x = 27; x <= 34; x++) {
        c.set(x, gy + 1, 15, GLASS); c.set(x, gy + 2, 15, GLASS);
        c.set(x, gy + 1, 17, GLASS); c.set(x, gy + 2, 17, GLASS);
    }
    for (let x = 27; x <= 34; x++) for (const dz of [15, 16, 17]) c.set(x, gy + 3, dz, GLASS);
    // 走廊两侧实验台（装饰）
    c.fill(25, gy + 1, 13, 34, gy + 1, 13, PLANKS);
    c.fill(25, gy + 1, 19, 34, gy + 1, 19, PLANKS);
    for (const [tx, tz] of [[24, 10], [24, 22], [34, 10], [34, 22]]) c.set(tx, gy + 1, tz, TORCH);

    // ---- 隔墙 x=35：远端门（由锁②经红石粉远程开门；门洞上方封到顶）----
    c.fill(35, gy + 1, 9, 35, gy + 4, 23, COBBLESTONE);
    c.set(35, gy + 1, 16, doorId(0, 0, 3));
    c.set(35, gy + 2, 16, doorId(1, 0, 3));

    // ================= 空气实验室（x36..43）：倒扣杯实验 + 检查点 =================
    c.fill(37, gy + 1, 11, 42, gy + 1, 11, PLANKS); // 实验台
    for (const cx of [38, 40, 42]) c.set(cx, gy + 2, 11, GLASS); // 倒扣的玻璃杯
    for (const [tx, tz] of [[36, 21], [43, 21], [36, 9], [43, 9]]) c.set(tx, gy + 1, tz, TORCH);
    flagAt(c, 39, gy, 16, FLAG_CHECKPOINT); // 检查点：过了布线走廊

    // ---- 隔墙 x=44 + 锁③「热与温度实验室」门（贴门锁） ----
    c.fill(44, gy + 1, 9, 44, gy + 4, 23, COBBLESTONE);
    doorway(c, { x: 44, z: 16, y0: gy + 1, facing: 3 }, { x: 44, y: gy + 1, z: 15 });

    // ================= 热与温度实验室（x45..50）：熔炉 + 温度柱 + 检查点 =================
    c.set(46, gy + 1, 12, FURNACE);
    c.set(46, gy + 1, 20, FURNACE);
    c.fill(48, gy + 1, 11, 48, gy + 3, 11, COBBLESTONE); // 「温度计柱」
    c.set(48, gy + 4, 11, TORCH);
    for (const [tx, tz] of [[45, 14], [50, 14], [45, 18], [50, 18]]) c.set(tx, gy + 1, tz, TORCH);
    flagAt(c, 47, gy, 16, FLAG_CHECKPOINT); // 检查点：过了热实验室锁

    // ---- 隔墙 x=51（敞开拱门 z=16，门洞上方封到顶）----
    c.fill(51, gy + 1, 9, 51, gy + 4, 23, COBBLESTONE);
    c.clear(51, gy + 1, 16, 51, gy + 2, 16);

    // ================= 数据记录室（x52..55）：工作台 + 熔炉 + 羊毛毯 + 终点 =================
    c.set(52, gy + 1, 13, CRAFTING_TABLE);
    c.set(52, gy + 1, 19, FURNACE);
    c.fill(53, gy + 1, 14, 55, gy + 1, 18, WOOL); // 羊毛毯
    for (const [tx, tz] of [[55, 12], [55, 20]]) c.set(tx, gy + 1, tz, TORCH);
    flagAt(c, 54, gy + 1, 16, FLAG_GOAL); // 终点旗立在羊毛毯上

    return {
        name: '科学实验站',
        canvas: c,
        rules: { timeLimit: 480, lockAIHelp: true },
        flags: {
            start: { x: 12, y: gy + 1, z: 16 },
            checkpoints: [
                { x: 39, y: gy + 1, z: 16 }, // 空气实验室（过布线走廊）
                { x: 47, y: gy + 1, z: 16 }, // 热与温度实验室（过锁③）
            ],
            goal: { x: 54, y: gy + 2, z: 16 },
        },
        questions: [
            // 锁①（水实验室·三态）答案复算：液态水受热 → 水蒸气（气态），质量不灭
            choiceQ({ x: 16, y: gy + 1, z: 15 }, 'science',
                '做汤时忘了关火，汤在锅里越煮越少。锅里的水变少，主要是因为——',
                ['水渗进锅底，被锅吃掉了', '水受热变成水蒸气，跑到空气里去了',
                    '水被火烧得什么都没剩下', '水变成冰，沉在锅底了'], 1,
                '三上·水', '水没有消失——想一想水受热会变成什么，飞进空气里'),
            // 锁②（布线走廊·空气占据空间）答案复算：空气让位 → 水补位 → 纸团变湿
            choiceQ({ x: 25, y: gy + 1, z: 16 }, 'science',
                '把倒扣的杯子竖直压进水里，杯里的纸团一点没湿。要是把杯子慢慢倾斜，让里面的空气跑掉一些，纸团会——',
                ['照样干燥，纸团有防水涂层', '漂出杯口，浮到水面上',
                    '变湿，水补进了空气让出来的空间', '变得更干，水把纸烘干了'], 2,
                '三上·空气', '纸团不湿，靠的是杯里那种看不见却占地方的气体'),
            // 锁③（热与温度·两步推理情景）答案复算：80℃ 与 20℃ 等量混合 → 热平衡居中 ≈ 50℃
            choiceQ({ x: 44, y: gy + 1, z: 15 }, 'science',
                '实验课上，把一杯 80℃ 的热水和一杯 20℃ 的凉水倒在一起混合（不算散热损失）。混合后的水温大约是——',
                ['大约 80℃，热水的温度不变', '大约 100℃，比两杯都烫',
                    '大约 20℃，凉水的温度不变', '大约 50℃，介于两杯之间'], 3,
                '三上·水', '热量总是从高温流向低温，混合后的温度会落在 20 到 80 之间'),
        ],
        // 锁②=远程红石布线锁（答题机 → 粉明线 → x=35 门），校验器不懂红石，必给映射
        lockDoorHints: [{ key: [25, gy + 1, 16], door: [35, gy + 1, 16] }],
    };
}

if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
