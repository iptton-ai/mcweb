// ==================== builtin_levels/level_08_mine.mjs ====================
// 「算术矿洞」（官方扩展关 L8，数学专场 + TNT 奖励房）：
//   矿山大门起点 → 前厅 → 锁①（第一巷道口，万以内加减法）→ 折返巷（西巷→北折返）
//   → 竖井厅（锁② 多位数乘一位数 + 检查点）→ 深巷（锁③ 两步混合运算 + 检查点）
//   → 出山口选矿场（终点院：熔炉/工作台/羊毛袋）。
//   招牌机关「封死矿室」：深巷东壁的 2×2 圆石假墙内埋 3 块 TNT，巷道地面拉杆右键合上
//   = 红石上升沿点燃，炸开矿室；房内深处藏钻石晶窟（离爆心 ≥4.2 格，爆炸波及不到）。
//   假墙/ TNT 对全封锁 BFS 都是实心墙 → 奖励房非必经，不进主通路校验。
// 自测：node tools/builtin_levels/level_08_mine.mjs（schema/全解锁 BFS/全封锁防绕行/解锁序）

import { BlockTypes, FLAG_CHECKPOINT, FLAG_GOAL, FLAG_START, leverId } from '../../js/config.js';
import {
    Canvas,
    borderWall,
    doorway,
    flagAt,
    ground,
    inputQ,
    isDirectRun,
    runSpecSelfTest,
    torchPost,
    tree,
} from './_lib.mjs';

const { STONE, COBBLESTONE, GRAVEL, LOG, PLANKS, TORCH, FLOWER, WOOL,
    COAL_ORE, IRON_ORE, DIAMOND_ORE, CRAFTING_TABLE, FURNACE, TNT } = BlockTypes;

export const LEVEL_FILE = 'level_08_mine.level.json';

export function buildLevel() {
    const c = new Canvas(52, 20, 52);
    const gy = 3;

    ground(c, gy);
    borderWall(c, gy, STONE);

    // ---- 环带山体（三环台阶山，照地牢手法；石壁嵌煤/铁/钻石矿脉与沙砾） ----
    const oreSpeck = (x, y, z) => {
        const h = (x * 7 + z * 13 + y * 5) % 23;
        if (h === 0) return COAL_ORE;
        if (h === 7) return GRAVEL;
        if (h === 11) return IRON_ORE;
        if (h === 17) return DIAMOND_ORE; // 稀有矿脉嵌壁，巷道里随处可见
        return STONE;
    };
    for (let x = 14; x <= 37; x++) for (let z = 10; z <= 38; z++) for (let y = gy + 1; y <= gy + 3; y++) c.set(x, y, z, oreSpeck(x, y, z));
    for (let x = 17; x <= 34; x++) for (let z = 13; z <= 35; z++) for (let y = gy + 1; y <= gy + 6; y++) c.set(x, y, z, oreSpeck(x, y, z));
    for (let x = 20; x <= 31; x++) for (let z = 16; z <= 32; z++) for (let y = gy + 1; y <= gy + 9; y++) c.set(x, y, z, oreSpeck(x, y, z));
    const cobbleFloor = (x0, z0, x1, z1) => c.fill(x0, gy, z0, x1, gy, z1, COBBLESTONE);

    // ---- 矿山大门起点（木架门楼 + 煤车 + 火把柱） ----
    flagAt(c, 26, gy, 44, FLAG_START);
    c.fill(24, gy + 1, 39, 24, gy + 3, 39, LOG);
    c.fill(28, gy + 1, 39, 28, gy + 3, 39, LOG);
    c.fill(24, gy + 4, 39, 28, gy + 4, 39, PLANKS);
    c.set(23, gy + 1, 39, TORCH);
    c.set(29, gy + 1, 39, TORCH);
    c.set(26, gy + 1, 42, COBBLESTONE); // 停着的矿车
    c.set(26, gy + 2, 42, COAL_ORE);
    tree(c, 16, gy, 44);
    tree(c, 36, gy, 45);
    torchPost(c, 20, gy, 43);
    torchPost(c, 32, gy, 43);
    for (const x of [22, 30]) c.set(x, gy + 1, 41, FLOWER);

    // ---- 入口甬道 + 前厅（山芯内，3~5 高巷道） ----
    c.clear(25, gy + 1, 34, 27, gy + 2, 38);
    cobbleFloor(25, 34, 27, 38);
    c.clear(22, gy + 1, 27, 30, gy + 4, 33);
    cobbleFloor(22, 27, 30, 33);
    c.set(23, gy + 1, 32, TORCH);
    c.set(29, gy + 1, 32, TORCH);

    // ---- 锁①（前厅→第一巷道，万以内加减法，贴门锁；门洞上方岩体封到结构顶） ----
    doorway(c, { x: 26, z: 26, y0: gy + 1, facing: 2 }, { x: 25, y: gy + 1, z: 26 });
    c.set(27, gy + 1, 26, TORCH);

    // ---- 第一巷道 ----
    c.clear(22, gy + 1, 19, 30, gy + 4, 25);
    cobbleFloor(22, 19, 30, 25);
    c.set(24, gy + 1, 20, TORCH);
    c.set(28, gy + 1, 24, TORCH);
    c.set(22, gy + 1, 22, COAL_ORE); // 壁嵌矿脉点缀（1 高，跨得过去）
    c.set(30, gy + 2, 23, IRON_ORE);

    // ---- 折返巷（西巷折向北，巷道弯折出「折返」感） ----
    c.clear(17, gy + 1, 21, 21, gy + 3, 23);
    cobbleFloor(17, 21, 21, 23);
    c.clear(17, gy + 1, 14, 18, gy + 4, 20);
    cobbleFloor(17, 14, 18, 20);
    c.set(18, gy + 1, 21, TORCH);

    // ---- 竖井厅（锁② + 检查点；中央装饰「封存竖井」井栏） ----
    c.clear(19, gy + 1, 14, 30, gy + 4, 18);
    cobbleFloor(19, 14, 30, 18);
    c.fill(23, gy + 1, 15, 25, gy + 1, 17, COBBLESTONE); // 井栏（1 高，可跳上）
    c.set(24, gy + 1, 16, IRON_ORE);                     // 井芯：一整块铁矿
    c.set(24, gy + 2, 16, TORCH);
    c.set(20, gy + 1, 15, TORCH);
    c.set(29, gy + 1, 17, TORCH);
    flagAt(c, 28, gy, 16, FLAG_CHECKPOINT);

    // ---- 锁②（竖井厅→深巷，多位数乘一位数，贴门锁） ----
    doorway(c, { x: 26, z: 13, y0: gy + 1, facing: 2 }, { x: 25, y: gy + 1, z: 13 });
    c.set(27, gy + 1, 14, TORCH);

    // ---- 深巷（2 高巷道，外环岩顶当天花；锁③ + 检查点） ----
    c.clear(22, gy + 1, 10, 30, gy + 2, 12);
    cobbleFloor(22, 10, 30, 12);
    c.set(24, gy + 1, 10, TORCH);
    c.set(29, gy + 1, 12, TORCH);
    flagAt(c, 23, gy, 12, FLAG_CHECKPOINT);
    // 锁③ 门嵌在 2 高巷道中段（上方就是外环岩顶，照地牢 G3 手法）
    doorway(c, { x: 26, z: 11, y0: gy + 1, facing: 2 }, { x: 25, y: gy + 1, z: 11 });

    // ---- 封死矿室（TNT 奖励房，招牌机关） ----
    // 深巷东壁 2×2 假墙封死岔路口：下排两块 + 右上一块为 TNT（共 3 块），左上圆石；
    // 巷道地面拉杆（贴地·关）与 TNT 六邻，右键合上 = 红石上升沿点燃，炸开矿室。
    c.clear(33, gy + 1, 11, 36, gy + 2, 14);
    c.set(31, gy + 1, 11, TNT);
    c.set(32, gy + 1, 11, TNT);
    c.set(32, gy + 2, 11, TNT);
    c.set(31, gy + 2, 11, COBBLESTONE);
    c.set(30, gy + 1, 11, leverId(0, 0));
    // 水晶窟：藏在房内最深处（距最近 TNT ≥4.2 格，半径 3.5 的爆炸毁不掉）
    c.set(36, gy + 1, 14, DIAMOND_ORE);
    c.set(36, gy + 2, 14, DIAMOND_ORE);
    c.set(35, gy + 1, 14, DIAMOND_ORE);
    c.set(36, gy + 1, 11, TORCH);
    c.set(34, gy + 1, 14, TORCH);

    // ---- 出山口（深巷北端破岩而出，坑口木架） + 选矿场终点院 ----
    c.fill(24, gy + 1, 9, 24, gy + 3, 9, LOG);
    c.fill(28, gy + 1, 9, 28, gy + 3, 9, LOG);
    c.fill(24, gy + 4, 9, 28, gy + 4, 9, PLANKS);
    c.fill(20, gy + 1, 3, 31, gy + 3, 3, COBBLESTONE); // 选矿场北墙
    c.fill(20, gy + 1, 4, 20, gy + 3, 9, COBBLESTONE); // 西墙
    c.fill(31, gy + 1, 4, 31, gy + 3, 9, COBBLESTONE); // 东墙（南面是山体岩壁）
    c.set(22, gy + 1, 5, FURNACE);        // 选矿场：熔炉
    c.set(23, gy + 1, 5, CRAFTING_TABLE); // 工作台
    c.fill(29, gy + 1, 7, 30, gy + 1, 8, WOOL); // 羊毛袋
    c.set(21, gy + 1, 8, TORCH);
    c.set(30, gy + 1, 5, TORCH);
    c.set(26, gy + 4, 3, TORCH);
    flagAt(c, 26, gy, 6, FLAG_GOAL);

    return {
        name: '算术矿洞',
        canvas: c,
        rules: { timeLimit: 480, lockAIHelp: true },
        flags: {
            start: { x: 26, y: gy + 1, z: 44 },
            checkpoints: [
                { x: 28, y: gy + 1, z: 16 }, // 竖井厅（过锁②）
                { x: 23, y: gy + 1, z: 12 }, // 深巷（锁③ 旁）
            ],
            goal: { x: 26, y: gy + 1, z: 6 },
        },
        questions: [
            // 答案复算：3872−985=2887；3872+2887=6759
            inputQ({ x: 25, y: gy + 1, z: 26 },
                '矿车上周运出 3872 块矿石，本周比上周少运 985 块，两周一共运出多少块？', 6759,
                '三上·万以内加减法', '先算本周 3872−985=2887，再算 3872+2887'),
            // 答案复算：128×24=128×20+128×4=2560+512=3072
            inputQ({ x: 25, y: gy + 1, z: 13 },
                '矿洞每箱装 24 块矿石，一天运出 128 箱，一天共运出多少块？', 3072,
                '三上·多位数乘一位数', '128×24 = 128×20 + 128×4'),
            // 答案复算：135×4=540；540−380=160
            inputQ({ x: 25, y: gy + 1, z: 11 },
                '矿车装了 4 筐矿石，每筐 135 块，运走 380 块后还剩多少块？', 160,
                '三上·混合运算', '先算 135×4=540，再算 540−380'),
        ],
    };
}

if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
