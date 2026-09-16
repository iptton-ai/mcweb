// ==================== builtin_levels/level_14_grandtour.mjs ====================
// 「全能冠军试炼」：终极综合关（官方扩展关 L14），蛇形五段接力（画布 96×14×80，gy=3）。
//   段① 草原热身(x2..19)：锁① math·两步混合运算（x=20 隔墙）。
//   段② 水下涵洞(x21..43)：石丘(x28..34)全纵深拦路，唯一通道=灌水涵洞(z47..49)，
//        游过涵洞→丘顶水柱井上浮出丘（水格 BFS 可通行=合法主路）→东坡阶梯下丘。
//        检查点1 在丘顶。
//   段③ 弹跳峡谷(x35..59)：堑壕(x42..52/z20..76)+粘液垫=捷径玩具，栈道桥(z48)=主路；
//        堑壕两端有踏步能上下。检查点2 → 锁② science·水/空气（x=60 隔墙）。
//   段④ 电梯塔(x61..73)：塔北/南两道细环墙封死绕行，进塔=唯一通路；塔内楼梯=主路，
//        滑轮电梯（底层拉杆+踏步红石粉呼梯线）=上行快线；塔顶平台锁③ yuwen·古诗，
//        开东门沿塔外阶梯南下降塔。检查点3 → x=74 拱门(z=56)进段⑤。
//   段⑤ 布线大厅(x75..94)：招牌机关——锁④ english 答题机在大厅入口（x=76），答对后
//        红石粉沿玻璃导管明线（8 格，末端 8 级）点亮到大厅尽头，远程开王座厅门（x=85，
//        lockDoorHints 必给 锁→门 映射）；王座厅内锁⑤ math·周长两步题（x=91）开王座室，
//        终点王座（羊毛红毯+钻石装饰）。
import {
    BlockTypes,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
    KEYPAD_BASE,
    doorId,
    dustId,
    lampId,
    leverId,
    pulleyId,
    waterwheelId,
} from '../../js/config.js';
import {
    Canvas,
    borderWall,
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

export const LEVEL_FILE = 'level_14_grandtour.level.json';

const { AIR, WATER, GLASS, PLANKS, STONE, COBBLESTONE, SLIME, WOOL, TORCH, DIAMOND_ORE, FLOWER } = BlockTypes;

export function buildLevel() {
    const c = new Canvas(96, 14, 80);
    const gy = 3;

    // ---- 地基与边框 ----
    ground(c, gy);
    borderWall(c, gy, STONE);

    // ================= 段① 草原热身（x2..19）=================
    flagAt(c, 5, gy, 48, FLAG_START);
    tree(c, 8, gy, 38); tree(c, 8, gy, 58); tree(c, 14, gy, 30); tree(c, 14, gy, 66);
    torchPost(c, 11, gy, 42); torchPost(c, 11, gy, 54);
    for (const z of [40, 44, 52, 56]) c.set(9, gy + 1, z, FLOWER);

    // ---- 隔墙 x=20（3 高立面：跳 1 上不去；门洞上方封墙到顶防跳门）----
    // ---- 锁①（math·两步混合运算）----
    c.fill(20, gy + 1, 0, 20, gy + 3, c.d - 1, COBBLESTONE);
    c.clear(20, gy + 1, 48, 20, gy + 2, 48);
    doorway(c, { x: 20, z: 48, y0: gy + 1, facing: 3 }, { x: 20, y: gy + 1, z: 49 });

    // ================= 段② 水下涵洞（x21..43）=================
    // 石丘全纵深拦路（3 高立面不可攀；两端各留 2 格不贴边界，防顺丘顶走上边界墙头），
    // 唯一通道=灌水涵洞 + 丘顶水柱井
    c.fill(28, gy + 1, 2, 34, gy + 3, 77, STONE);
    c.clear(28, gy + 1, 47, 34, gy + 2, 49);              // 涵洞腔（2 高 3 宽）
    c.fill(28, gy + 1, 47, 34, gy + 2, 49, WATER);        // 灌满水
    // 水柱井（x=33）：水面顶到 gy+4，东侧留豁口上岸
    c.set(33, gy + 3, 48, WATER);
    c.set(33, gy + 4, 48, WATER);
    for (const dz of [47, 48, 49]) c.set(32, gy + 4, dz, STONE);  // 井口护栏（西/北/南）
    c.set(33, gy + 4, 47, STONE);
    c.set(33, gy + 4, 49, STONE);                          // （东面 34 留空=上岸豁口）
    // 东坡阶梯（丘顶→地面，上下双向）
    c.set(35, gy + 3, 48, STONE);
    c.set(36, gy + 2, 48, STONE);
    c.set(37, gy + 1, 48, STONE);
    flagAt(c, 30, gy + 3, 52, FLAG_CHECKPOINT);            // 检查点1：丘顶
    torchPost(c, 31, gy + 3, 44);

    // ================= 段③ 弹跳峡谷（x35..59）=================
    c.clear(42, gy - 1, 20, 52, gy, 76);                   // 堑壕（深 2）
    c.fill(44, gy - 2, 44, 50, gy - 2, 52, SLIME);         // 谷底粘液垫（捷径玩具）
    c.fill(42, gy, 48, 52, gy, 48, PLANKS);                // 栈道桥（主路，贴地面高度）
    for (const bx of [42, 44, 46, 48, 50, 52]) {           // 桥栏（不挡 z=48 行进线）
        c.set(bx, gy + 1, 47, PLANKS);
        c.set(bx, gy + 1, 49, PLANKS);
    }
    c.set(42, gy - 1, 30, STONE); c.set(41, gy, 30, STONE); // 谷底踏步（西岸上下）
    c.set(52, gy - 1, 30, STONE); c.set(53, gy, 30, STONE); // 谷底踏步（东岸上下）
    torchPost(c, 38, gy, 40); torchPost(c, 38, gy, 56);
    torchPost(c, 56, gy, 40); torchPost(c, 56, gy, 56);
    flagAt(c, 57, gy, 44, FLAG_CHECKPOINT);                // 检查点2：峡谷东岸

    // ---- 隔墙 x=60（3 高立面，门洞上方封墙到顶）+ 锁②（science·水/空气）----
    c.fill(60, gy + 1, 0, 60, gy + 3, c.d - 1, COBBLESTONE);
    c.clear(60, gy + 1, 48, 60, gy + 2, 48);
    doorway(c, { x: 60, z: 48, y0: gy + 1, facing: 3 }, { x: 60, y: gy + 1, z: 49 });

    // ================= 段④ 电梯塔（x61..73）=================
    // 塔北/南各一道细环墙（x61..70，贴塔身，2 高）把段④封成「穿塔」单通道：
    // 塔西口袋（x61）与塔东下客区（x71..73）互不相通，塔顶门（锁③）是唯一通路
    c.fill(61, gy + 1, 39, 70, gy + 2, 39, STONE);
    c.fill(61, gy + 1, 57, 70, gy + 2, 57, STONE);
    // 塔身（x62..70 / z40..56，墙到 gy+8）
    c.fill(62, gy + 1, 40, 70, gy + 8, 40, COBBLESTONE);
    c.fill(62, gy + 1, 56, 70, gy + 8, 56, COBBLESTONE);
    c.fill(62, gy + 1, 40, 62, gy + 8, 56, COBBLESTONE);
    c.fill(70, gy + 1, 40, 70, gy + 8, 56, COBBLESTONE);
    c.clear(63, gy + 1, 41, 69, gy + 8, 55);               // 塔内腔
    c.fill(63, gy + 5, 41, 69, gy + 5, 55, PLANKS);        // 塔顶平台楼板（gy+5）
    c.set(63, gy + 5, 48, AIR);                            // 电梯洞
    // 楼梯洞（3 宽：最后两级头顶 + 倒数第二级起跳级净空——
    //  只开 2 宽时站在 x=66 级起跳会撞平台楼板，楼梯中段卡死，2026-09-16 修复）
    c.set(66, gy + 5, 48, AIR);
    c.set(67, gy + 5, 48, AIR);
    c.set(68, gy + 5, 48, AIR);
    // 塔内楼梯（主路：x65..68 逐格 +1）
    c.set(65, gy + 1, 48, COBBLESTONE);
    c.set(66, gy + 2, 48, COBBLESTONE);
    c.set(67, gy + 3, 48, COBBLESTONE);
    c.set(68, gy + 4, 48, COBBLESTONE);
    // 电梯：底层平台 + 顶部滑轮（朝下垂挂）+ 竖轴水车（顶面接水=动力）+ 水箱玻璃罩
    c.set(63, gy + 1, 48, BlockTypes.PLATFORM_BASE);
    c.set(63, gy + 6, 48, pulleyId(false, false));
    c.set(63, gy + 7, 48, waterwheelId(1));
    c.set(63, gy + 8, 48, WATER);
    for (const dz of [47, 49]) { c.set(63, gy + 8, dz, GLASS); c.set(64, gy + 8, dz, GLASS); }
    c.set(64, gy + 8, 48, GLASS);
    c.fill(62, gy + 9, 47, 64, gy + 9, 49, GLASS);
    // 底层呼梯拉杆 + 踏步红石粉明线（11 格，末端紧邻滑轮）
    c.set(64, gy + 1, 48, dustId(0));
    c.set(64, gy + 1, 47, leverId(0, 0));
    const wire = [
        [65, gy + 2, 48], [66, gy + 3, 48], [67, gy + 4, 48], [68, gy + 5, 48],
        [68, gy + 6, 47], [67, gy + 6, 47], [66, gy + 6, 47], [65, gy + 6, 47],
        [64, gy + 6, 47], [64, gy + 6, 48],
    ];
    for (const [wx, wy, wz] of wire) c.set(wx, wy, wz, dustId(0));
    // 塔顶东门（锁③）+ 塔外下行阶梯
    c.clear(70, gy + 6, 48, 70, gy + 7, 48);
    doorway(c, { x: 70, z: 48, y0: gy + 6, facing: 3 }, { x: 70, y: gy + 6, z: 49 });
    // 下行阶梯（A→C 顶 feet 9/8/7，沿 z 南下远离 x=74 墙；从 C 落地跌 3 格无伤）
    c.set(71, gy + 5, 48, COBBLESTONE);
    c.set(71, gy + 4, 49, COBBLESTONE);
    c.set(71, gy + 3, 50, COBBLESTONE);
    // 塔门（西墙拱门，无锁自由进）+ 检查点3
    c.clear(62, gy + 1, 48, 62, gy + 2, 48);
    flagAt(c, 72, gy, 53, FLAG_CHECKPOINT);

    // ---- 隔墙 x=74（拱门在 z=56，无锁；2 高立面——拱门离下行阶梯 >3 格，墙头跳不上去）----
    c.fill(74, gy + 1, 0, 74, gy + 2, c.d - 1, COBBLESTONE);
    c.clear(74, gy + 1, 56, 74, gy + 2, 56);

    // ================= 段⑤ 布线大厅 + 王座厅（x75..94）=================
    // 锁④（english）答题机立在大厅入口
    c.set(76, gy + 1, 48, KEYPAD_BASE);
    c.set(76, gy + 2, 48, lampId(0));
    torchPost(c, 78, gy, 42); torchPost(c, 78, gy, 54);
    torchPost(c, 82, gy, 42); torchPost(c, 82, gy, 54);
    // 玻璃导管明线：8 格红石粉（答对后逐格点亮直到王座厅门）。
    // 导管 = 两侧玻璃壁（3 高）+ 玻璃顶，x=77 留敞口：玩家从答题机旁走进罩内，
    // 踩着红石粉明线走向王座厅门（罩体不能封死行进线，否则全封锁 BFS 判绕行死路）。
    for (let x = 77; x <= 84; x++) c.set(x, gy + 1, 48, dustId(0));
    for (let x = 78; x <= 84; x++) {
        for (const dy of [1, 2]) { c.set(x, gy + dy, 47, GLASS); c.set(x, gy + dy, 49, GLASS); }
        c.set(x, gy + 3, 47, GLASS); c.set(x, gy + 3, 48, GLASS); c.set(x, gy + 3, 49, GLASS);
    }
    // 王座厅门（x=85）：由锁④经红石粉远程开门（lockDoorHints 给映射）。3 高立面：
    // 门洞上方封墙到顶；玻璃导管顶（feet gy+4）经证明不可达（无 feet gy+2/3 邻格可借力）
    c.fill(85, gy + 1, 0, 85, gy + 3, c.d - 1, COBBLESTONE);
    c.clear(85, gy + 1, 48, 85, gy + 2, 48);
    c.set(85, gy + 1, 48, doorId(0, 0, 3));
    c.set(85, gy + 2, 48, doorId(1, 0, 3));
    // 王座厅（x86..90）：红毯 + 宝石柱
    c.fill(86, gy, 47, 90, gy, 49, WOOL);
    for (const dz of [44, 52]) {
        c.set(88, gy + 1, dz, COBBLESTONE);
        c.set(88, gy + 2, dz, DIAMOND_ORE);
    }
    torchPost(c, 86, gy, 44); torchPost(c, 86, gy, 52);
    // 隔墙 x=91（3 高立面，门洞上方封墙到顶）
    c.fill(91, gy + 1, 0, 91, gy + 3, c.d - 1, COBBLESTONE);
    c.clear(91, gy + 1, 48, 91, gy + 2, 48);
    doorway(c, { x: 91, z: 48, y0: gy + 1, facing: 3 }, { x: 91, y: gy + 1, z: 49 });
    // 王座室（x92..94）：红毯 + 王座 + 钻石 + 终点旗
    c.fill(92, gy, 47, 94, gy, 49, WOOL);
    c.fill(94, gy + 1, 48, 94, gy + 2, 48, COBBLESTONE);   // 王座
    c.set(94, gy + 1, 47, DIAMOND_ORE);
    c.set(94, gy + 1, 49, DIAMOND_ORE);
    flagAt(c, 93, gy, 48, FLAG_GOAL);
    c.set(92, gy + 1, 46, TORCH);
    c.set(92, gy + 1, 50, TORCH);

    // ---- 题目（自拟·答案已复算）----
    const questions = [
        inputQ({ x: 20, y: gy + 1, z: 49 },
            '仓库里有 4 箱齿轮，每箱装 6 个。拿 9 个去装水车后，仓库里还剩多少个齿轮？', 15,
            '三上·混合运算', '先算一共：4×6=24；再算剩下：24−9=15'),
        choiceQ({ x: 60, y: gy + 1, z: 49 }, 'science',
            '鱼能在水里呼吸，人在水下却很快憋不住，主要因为——',
            ['鱼有鳃，能吸取溶解在水里的空气', '鱼不用呼吸',
                '水里的空气对人有毒', '人游得没有鱼快'], 0,
            '三上·空气', '鱼的鳃能取用水中溶解的少量空气；人靠肺呼吸，憋气时间有限'),
        choiceQ({ x: 70, y: gy + 6, z: 49 }, 'yuwen',
            '「两岸猿声啼不住，轻舟已过万重山」里，载着诗人穿过三峡的是——',
            ['一只轻快的小船', '一匹奔跑的骏马', '一辆吱呀的牛车', '一顶晃悠悠的花轿'], 0,
            '三上·古诗', '李白《早发白帝城》：「轻舟」就是轻快的小船——猿声还在耳边，船已过了万重山'),
        choiceQ({ x: 76, y: gy + 1, z: 48 }, 'english',
            '车间师傅喊「Pull the lever, please.」，你该——',
            ['把拉杆拉下来', '把门关上', '把窗户擦干净', '把石头搬走'], 0,
            '英语·情景对话', 'pull=拉，lever=拉杆——「请拉一下拉杆」'),
        inputQ({ x: 91, y: gy + 1, z: 49 },
            '王座前的红毯是长方形，长 8 米、宽 3 米，四周要镶一圈金边。金边一共要多少米？', 22,
            '三上·周长', '长方形周长=（长+宽）×2=（8+3）×2=22'),
    ];

    return {
        name: '全能冠军试炼',
        canvas: c,
        rules: { timeLimit: 720, lockAIHelp: true },
        flags: {
            start: { x: 5, y: gy + 1, z: 48 },
            checkpoints: [
                { x: 30, y: gy + 4, z: 52 },
                { x: 57, y: gy + 1, z: 44 },
                { x: 72, y: gy + 1, z: 53 },
            ],
            goal: { x: 93, y: gy + 1, z: 48 },
        },
        questions,
        // 布线大厅：锁④远程开王座厅门（校验器不懂红石粉，必须显式给映射）
        lockDoorHints: [{ key: [76, gy + 1, 48], door: [85, gy + 1, 48] }],
    };
}

if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
