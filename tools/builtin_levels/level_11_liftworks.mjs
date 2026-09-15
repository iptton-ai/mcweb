// ==================== builtin_levels/level_11_liftworks.mjs ====================
// 「电梯工厂」：动力组展示关（官方扩展关 L11）。
// 布局（画布 64×28×56，gy=3，西→东）：
//   厂前区(x2..9) → 工厂门脸(x10，全纵深墙+敞开大门) → 动力间(x11..21：水车×2+齿轮
//   展示+离合器+成对粉碎轮+拉杆，全部真机关) → 检查点1 → 电梯井塔(滑轮顶悬+电梯平台+
//   检修楼梯 Dust 呼梯线；井旁逐格+1 检修楼梯=主路) → 二层车间大厅(楼板 gy+6，传送带
//   运输段+旁步行道) → 锁① science·机械与动力 → 锁② math·水车转速两步 → 跨廊玻璃
//   地面锁③ science·简单机械 → 装配区锁④ math·两步应用题 → 装车站台(小传送带+羊毛
//   货箱+终点旗)。
// 机关设计对齐 js/kinetic.js / js/redstone.js 实机语义：
//   - 电梯：滑轮(朝下垂挂)上方直连竖轴水车，水车顶面放水=动力源；拉杆(默认关)经检修
//     楼梯踏步上的红石粉明线(11 格，末端 5 级>0)远程给滑轮充能=卷绳，平台从底层
//     (gy+1)升到楼板洞口(gy+6)与二层齐平——电梯是快线，检修楼梯才是 6 邻主路。
//   - 传送带两段（车间走廊 + 装车站台）：各配独立水车供能，带贴楼板、紧邻传动轴
//     (带↔动力 6 邻即入同一分量)，应力 8×4=32 / 3×4=12 ≤ 容量 64。
//   - 动力间展示线：水车×2(容量128) → 齿轮(垂直啮合反转展示) → 传动轴 → 离合器
//     (拉杆充能=断开) → 成对粉碎轮(负载64，反转着碾)。
import {
    BlockTypes,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
    PLATFORM_BASE,
    beltId,
    clutchId,
    cogId,
    crusherId,
    doorId,
    dustId,
    leverId,
    pulleyId,
    shaftId,
    waterwheelId,
} from '../../js/config.js';
import {
    Canvas,
    borderWall,
    crenels,
    doorway,
    flagAt,
    ground,
    inputQ,
    isDirectRun,
    choiceQ,
    runSpecSelfTest,
    torchPost,
    tree,
} from './_lib.mjs';

export const LEVEL_FILE = 'level_11_liftworks.level.json';

const { AIR, WATER, GLASS, PLANKS, COBBLESTONE, TORCH, WOOL, FLOWER, CRAFTING_TABLE, FURNACE } = BlockTypes;

export function buildLevel() {
    const c = new Canvas(64, 28, 56);
    const gy = 3;
    const F2 = gy + 6;  // 二层楼板所在 y（楼板块；二层步行面=F2+1）
    const AIR_ID = AIR;

    // ---- 地基与边框 ----
    ground(c, gy);
    borderWall(c, gy, COBBLESTONE);

    // ---- 厂前区（起点）----
    flagAt(c, 5, gy, 28, FLAG_START);
    tree(c, 4, gy, 20); tree(c, 4, gy, 36); tree(c, 8, gy, 14); tree(c, 8, gy, 42);
    torchPost(c, 6, gy, 24); torchPost(c, 6, gy, 32);
    for (const z of [18, 22, 34, 38]) c.set(7, gy + 1, z, FLOWER);

    // ---- 工厂门脸（x=10 全纵深墙 + 敞开大门对，装饰不挡路）----
    c.fill(10, gy + 1, 0, 10, gy + 4, c.d - 1, COBBLESTONE);
    c.clear(10, gy + 1, 28, 10, gy + 2, 28);
    c.set(10, gy + 1, 28, doorId(0, 1, 3)); // 敞开大门（open=1 保持可通行，关卡内禁手关）
    c.set(10, gy + 2, 28, doorId(1, 1, 3));
    crenels(c, 10, 0, 10, 26, gy + 5);
    crenels(c, 10, 30, 10, c.d - 1, gy + 5);
    torchPost(c, 8, gy, 26); torchPost(c, 8, gy, 30);

    // ---- 动力间（x11..21 露天工场）：水车×2 → 齿轮展示 → 轴 → 离合器 → 成对粉碎轮 ----
    for (const z of [16, 40]) c.fill(11, gy + 1, z, 19, gy + 2, z, COBBLESTONE); // 矮围墙（留东口）
    c.fill(12, gy + 2, 24, 13, gy + 2, 24, WATER);          // 水车顶面接水（动力源）
    c.fill(11, gy + 2, 23, 14, gy + 2, 23, COBBLESTONE);    // 水箱围沿
    c.fill(11, gy + 2, 25, 14, gy + 2, 25, COBBLESTONE);
    c.set(11, gy + 2, 24, COBBLESTONE);
    c.fill(12, gy + 3, 24, 13, gy + 3, 24, GLASS);          // 水箱玻璃顶（看得见水）
    c.set(12, gy + 1, 24, waterwheelId(0));                 // 水车×2（东西横轴）
    c.set(13, gy + 1, 24, waterwheelId(0));
    c.set(14, gy + 1, 24, cogId(0));                        // 齿轮展示：横轴齿轮
    c.set(14, gy + 2, 24, cogId(1));                        //   ↑垂直啮合齿轮（反转）
    c.set(15, gy + 1, 24, shaftId(0));                      // 传动轴串联
    c.set(16, gy + 1, 24, clutchId(0, true));               // 离合器（默认接合；拉杆充能=断开）
    c.set(17, gy + 1, 24, crusherId(0));                    // 成对粉碎轮（南北相邻=垂直于轴配对）
    c.set(17, gy + 1, 25, crusherId(0));
    c.set(16, gy + 1, 25, leverId(0, 0));                   // 拉杆（贴地·关）：充能离合器=停机
    torchPost(c, 18, gy, 23); torchPost(c, 18, gy, 26);
    flagAt(c, 21, gy, 28, FLAG_CHECKPOINT);                 // 检查点1：动力间后

    // ---- 二层楼板（车间大厅地面，x22..62 / z10..46）+ 厂房柱 ----
    c.fill(22, F2, 10, 62, F2, 46, PLANKS);
    for (const [px, pz] of [[22, 14], [22, 34], [22, 44], [34, 10], [48, 10], [58, 10],
    [34, 46], [48, 46], [58, 46], [62, 14], [62, 28], [62, 44]]) {
        c.fill(px, gy + 1, pz, px, gy + 5, pz, COBBLESTONE);
    }

    // ---- 楼下仓库（装饰）----
    c.fill(36, gy + 1, 30, 36, gy + 2, 32, PLANKS);
    c.fill(44, gy + 1, 36, 44, gy + 2, 38, PLANKS);
    c.fill(50, gy + 1, 20, 50, gy + 1, 21, WOOL);
    torchPost(c, 30, gy, 34); torchPost(c, 40, gy, 22); torchPost(c, 52, gy, 30); torchPost(c, 56, gy, 18);

    // ---- 电梯井塔（x26..30 / z26..30 外壳，井心 x28/z28）----
    for (const zz of [26, 30]) c.fill(26, gy + 1, zz, 30, gy + 5, zz, COBBLESTONE);
    for (const xx of [26, 30]) c.fill(xx, gy + 1, 26, xx, gy + 5, 30, COBBLESTONE);
    c.set(28, gy + 6, 28, AIR_ID);                          // 楼板电梯洞（平台升到与二层齐平）
    // 电梯机头：滑轮(朝下垂挂) ← 竖轴水车(顶面接水=动力) ← 水箱玻璃罩
    c.set(28, gy + 7, 28, pulleyId(false, false));
    c.set(28, gy + 8, 28, waterwheelId(1));
    c.set(28, gy + 9, 28, WATER);
    c.set(28, gy + 1, 28, PLATFORM_BASE);                   // 电梯轿厢（平台停底层，滑轮沿绳绑定）
    for (const zz of [27, 29]) c.fill(27, gy + 9, zz, 29, gy + 9, zz, GLASS);
    c.set(27, gy + 9, 28, GLASS); c.set(29, gy + 9, 28, GLASS);
    c.fill(27, gy + 10, 27, 29, gy + 10, 29, GLASS);

    // ---- 检修楼梯（主路：x24..28 逐格 +1）+ 楼板洞（最后两级头顶 2 宽）----
    for (let k = 0; k < 5; k++) c.set(24 + k, gy + 1 + k, 24, COBBLESTONE);
    c.set(27, F2, 24, AIR_ID); c.set(28, F2, 24, AIR_ID);
    // 呼梯红石粉明线：踏步顶 → 楼板 → 塔沿，末端粉紧邻滑轮（11 格，末端 4 级>0）
    const dustWire = [
        [23, gy + 1, 24], [24, gy + 2, 24], [25, gy + 3, 24], [26, gy + 4, 24],
        [27, gy + 5, 24], [28, F2, 24], [29, F2 + 1, 24], [29, F2 + 1, 25],
        [29, F2 + 1, 26], [29, F2 + 1, 27], [29, F2 + 1, 28],
    ];
    for (const [dx, dy, dz] of dustWire) c.set(dx, dy, dz, dustId(0));
    c.set(22, gy + 1, 24, leverId(0, 0));                   // 底层呼梯拉杆（默认关=平台停底层）

    // ---- 二层厂房墙 + 屋顶（含玻璃天窗）----
    c.fill(22, F2 + 1, 10, 22, F2 + 4, 46, COBBLESTONE);
    c.fill(62, F2 + 1, 10, 62, F2 + 4, 46, COBBLESTONE);
    c.fill(22, F2 + 1, 10, 62, F2 + 4, 10, COBBLESTONE);
    c.fill(22, F2 + 1, 46, 62, F2 + 4, 46, COBBLESTONE);
    c.fill(22, F2 + 5, 10, 62, F2 + 5, 46, COBBLESTONE);
    for (let x = 28; x <= 56; x += 4) c.fill(x, F2 + 5, 24, x, F2 + 5, 32, GLASS);
    for (const [tx, tz] of [[24, 12], [40, 12], [60, 12], [24, 44], [40, 44], [60, 44]]) {
        c.set(tx, F2 + 6, tz, TORCH);
    }

    // ---- 车间走廊：传送带运输段（贴楼板）+ 独立水车供能 + 步行道 ----
    c.set(32, F2 + 1, 19, waterwheelId(0));
    c.set(32, F2 + 2, 19, WATER);
    for (const zz of [18, 20]) c.fill(31, F2 + 2, zz, 33, F2 + 2, zz, GLASS);
    c.set(31, F2 + 2, 19, GLASS); c.set(33, F2 + 2, 19, GLASS);
    c.fill(31, F2 + 3, 18, 33, F2 + 3, 20, GLASS);
    for (let x = 33; x <= 41; x++) c.set(x, F2 + 1, 19, shaftId(0));   // 传动轴（带紧邻入网）
    for (let x = 34; x <= 41; x++) c.set(x, F2 + 1, 20, beltId(1));    // 8 格传送带（向东运）
    flagAt(c, 31, F2, 28, FLAG_CHECKPOINT);                 // 检查点2：二层走廊口
    c.set(26, F2 + 1, 36, CRAFTING_TABLE); c.set(27, F2 + 1, 36, FURNACE);
    c.fill(25, F2 + 1, 14, 25, F2 + 2, 15, PLANKS);
    torchPost(c, 24, F2, 40); torchPost(c, 38, F2, 40);

    // ---- 锁①（science·机械与动力）：隔墙 x=42，答题机嵌墙南侧（避开门洞行进线）----
    c.fill(42, F2 + 1, 10, 42, F2 + 4, 46, COBBLESTONE);
    c.clear(42, F2 + 1, 28, 42, F2 + 2, 28);
    doorway(c, { x: 42, z: 28, y0: F2 + 1, facing: 3 }, { x: 42, y: F2 + 1, z: 29 });
    torchPost(c, 40, F2, 26);

    // ---- 车间深处（x43..47）+ 锁②（math·水车转速两步）----
    c.fill(44, F2 + 1, 20, 44, F2 + 2, 21, PLANKS);
    c.set(46, F2 + 1, 40, FURNACE);
    torchPost(c, 45, F2, 36);
    c.fill(48, F2 + 1, 10, 48, F2 + 4, 46, COBBLESTONE);
    c.clear(48, F2 + 1, 28, 48, F2 + 2, 28);
    doorway(c, { x: 48, z: 28, y0: F2 + 1, facing: 3 }, { x: 48, y: F2 + 1, z: 29 });
    torchPost(c, 46, F2, 30);

    // ---- 跨廊（x49..52：玻璃地面 + 木栏）+ 锁③（science·简单机械）----
    c.fill(49, F2, 26, 52, F2, 30, GLASS);
    c.fill(49, F2 + 1, 25, 52, F2 + 1, 25, PLANKS);
    c.fill(49, F2 + 1, 31, 52, F2 + 1, 31, PLANKS);
    c.fill(53, F2 + 1, 10, 53, F2 + 4, 46, COBBLESTONE);
    c.clear(53, F2 + 1, 28, 53, F2 + 2, 28);
    doorway(c, { x: 53, z: 28, y0: F2 + 1, facing: 3 }, { x: 53, y: F2 + 1, z: 29 });
    torchPost(c, 51, F2, 26);

    // ---- 装配区（x54..57）+ 锁④（math·两步应用题）----
    c.set(55, F2 + 1, 20, CRAFTING_TABLE);
    c.fill(56, F2 + 1, 36, 56, F2 + 2, 38, PLANKS);
    torchPost(c, 54, F2, 40);
    c.fill(58, F2 + 1, 10, 58, F2 + 4, 46, COBBLESTONE);
    c.clear(58, F2 + 1, 28, 58, F2 + 2, 28);
    doorway(c, { x: 58, z: 28, y0: F2 + 1, facing: 3 }, { x: 58, y: F2 + 1, z: 29 });
    torchPost(c, 56, F2, 26);

    // ---- 装车站台（x59..61）：小传送带 + 羊毛货箱 + 终点旗 ----
    // （带/水车摆在 z=22 北侧装车线，远离 z=28 门洞行进线，防玻璃水箱罩压门洞头顶）
    c.set(59, F2 + 1, 23, waterwheelId(0));
    c.set(59, F2 + 2, 23, WATER);
    for (const zz of [22, 24]) c.fill(58, F2 + 2, zz, 60, F2 + 2, zz, GLASS);
    c.set(58, F2 + 2, 23, GLASS); c.set(60, F2 + 2, 23, GLASS);
    c.fill(58, F2 + 3, 23, 60, F2 + 3, 23, GLASS);
    for (let x = 59; x <= 61; x++) c.set(x, F2 + 1, 22, beltId(1));    // 装车带（向东=装车方向）
    c.fill(60, F2 + 1, 30, 60, F2 + 1, 31, WOOL);
    c.fill(61, F2 + 1, 22, 61, F2 + 1, 23, WOOL);
    flagAt(c, 60, F2, 28, FLAG_GOAL);
    c.set(59, F2 + 1, 30, TORCH); c.set(61, F2 + 1, 24, TORCH);
    // ---- 题目（自拟·答案已复算）----
    const questions = [
        choiceQ({ x: 42, y: F2 + 1, z: 29 }, 'science',
            '工厂里的水车能带着粉碎轮一起转，它的动力来自——',
            ['流水推动水车旋转，动力来自水', '风吹动水车旋转，动力来自风',
                '电动机带动水车旋转，动力来自电', '有人用手摇动水车，动力来自人'], 0,
            '三上·机械与动力', '水车顶面泡到水就会转——流水推轮子，力气顺着轴和齿轮传给机器'),
        inputQ({ x: 48, y: F2 + 1, z: 29 },
            '水车每分钟转 8 圈，传送带每转 1 圈就送出 2 块砖。水车转 6 分钟后，传送带一共送出多少块砖？', 96,
            '三上·混合运算', '先算圈数：8×6=48；再算砖数：48×2=96'),
        choiceQ({ x: 53, y: F2 + 1, z: 29 }, 'science',
            '装卸工用木板搭个斜面，把木桶沿斜面滚上卡车。这样比直接抬——',
            ['省力，但要多走斜面长的路', '费力，但速度更快', '一样费力', '木桶会变重'], 0,
            '三上·简单机械', '斜面能省力——高度不变时，斜坡越长越省力，代价是多走路'),
        inputQ({ x: 58, y: F2 + 1, z: 29 },
            '装配一台小电梯要用 1 个滑轮和 2 根传动轴。装好 5 台电梯，滑轮和传动轴一共用了多少个零件？', 15,
            '三上·解决问题', '先算一台的零件数：1+2=3；再算 5 台：3×5=15'),
    ];

    return {
        name: '电梯工厂',
        canvas: c,
        rules: { timeLimit: 600, lockAIHelp: true },
        flags: {
            start: { x: 5, y: gy + 1, z: 28 },
            checkpoints: [{ x: 21, y: gy + 1, z: 28 }, { x: 31, y: F2 + 1, z: 28 }],
            goal: { x: 60, y: F2 + 1, z: 28 },
        },
        questions,
    };
}

if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
