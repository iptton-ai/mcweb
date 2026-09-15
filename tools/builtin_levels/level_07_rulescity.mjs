// ==================== level_07_rulescity.mjs 「规矩小城」 ====================
// 内置官方关卡 L7：道法专场。街区式小城，一条南北大街串起三道锁：
//   城门起点（自由拱门）→ 交通安全街（锁①：daofa 交通规则）
//   → 求助热线巷（锁②：daofa 紧急求助·120 急救，检查点一）
//   → 文明礼仪院（锁③：daofa 礼仪情景两步判断，检查点二）→ 终点市民广场（羊毛野餐垫+花坛）。
// 彩蛋：广场西北角「礼让亭」——非必经奖励小亭，入口木门旁贴一块压力板，
//   踩板供能开门（redstone.js：门块下半 6 邻有激活源即开，踩下的压力板就是激活源）。
//   压力板门绝不在必经路上（全封锁 BFS 不懂「踩板」，必经会判死锁）。
// 布局自检要点（对应 _lib 校验器）：
//   - 四道横墙（z=50/43/35/26）全贯穿 64 宽、4 高+城齿，门洞上方封墙到顶；
//   - 街景装饰高度纪律：高 ≥3 的装饰（信号灯柱/电话亭/指路柱）距最近锁墙 ≥4 格，
//     跑跳（dist≤3、升≤1）够不到墙顶开口，锁墙不可翻越；
//   - 乔木只进市民广场，树冠外缘距锁墙 ≥4 格；城外乔木贴免费城门墙无害（城门本就不上锁）。

import {
    BlockTypes,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
    PLATE_BASE, // 压力板：ID = PLATE_BASE + pressed，抬起态直接用 PLATE_BASE
    doorId,
} from '../../js/config.js';
import {
    Canvas,
    borderWall,
    choiceQ,
    crenels,
    doorway,
    flagAt,
    ground,
    isDirectRun,
    runSpecSelfTest,
    torchPost,
    tree,
} from './_lib.mjs';

export const LEVEL_FILE = 'level_07_rulescity.level.json';

const {
    BRICK,
    COBBLESTONE,
    CRAFTING_TABLE,
    FLOWER,
    FURNACE,
    GLASS,
    GRAVEL,
    LEAVES,
    PLANKS,
    STONE,
    TORCH,
    WOOD,
    WOOL,
} = BlockTypes;

export function buildLevel() {
    const c = new Canvas(64, 14, 56);
    const gy = 3; // 地面顶面 y=gy，站立层 y=gy+1
    ground(c, gy);
    borderWall(c, gy, COBBLESTONE);

    // ---- 城外起点（z 51..54） ----
    flagAt(c, 32, gy, 52, FLAG_START);
    c.fill(30, gy, 51, 34, gy, 54, GRAVEL); // 进城石板道
    tree(c, 20, gy, 53); tree(c, 44, gy, 53);
    for (const [x, z] of [[26, 52], [38, 52], [28, 54], [36, 54]]) c.set(x, gy + 1, z, FLOWER);
    torchPost(c, 28, gy, 52); torchPost(c, 36, gy, 52);

    // ---- 城门（z=50，贯穿全宽 + 城齿；正中拱门 1 宽 2 高，上方封回，不上锁） ----
    c.fill(0, gy + 1, 50, 63, gy + 4, 50, COBBLESTONE);
    c.clear(32, gy + 1, 50, 32, gy + 2, 50);
    crenels(c, 0, 50, 63, 50, gy + 5);
    torchPost(c, 30, gy, 49); torchPost(c, 34, gy, 49);

    // ---- 交通安全街（z 44..49）：马路 + 斑马线 + 信号灯柱 + 临街小铺 ----
    c.fill(28, gy, 44, 36, gy, 49, GRAVEL);              // 马路
    for (let x = 28; x <= 36; x++) {                      // 斑马线：白条与路面交替
        c.set(x, gy, 46, x % 2 === 0 ? WOOL : GRAVEL);
    }
    // 信号灯柱（z=47，距锁墙 z=43 有 4 格，柱顶站立层也跳不上墙顶）
    c.fill(40, gy + 1, 47, 40, gy + 2, 47, STONE);
    c.set(40, gy + 3, 47, LEAVES); // 绿灯
    c.set(40, gy + 4, 47, WOOL);   // 白杆灯箱
    // 两间临街小铺（实心盒体 + 玻璃橱窗，屋顶火把招幌）
    c.fill(24, gy + 1, 47, 28, gy + 3, 48, PLANKS);
    c.fill(25, gy + 2, 47, 27, gy + 2, 47, GLASS);
    c.set(26, gy + 4, 47, TORCH);
    c.fill(36, gy + 1, 47, 40, gy + 3, 48, BRICK);
    c.fill(37, gy + 2, 47, 39, gy + 2, 47, GLASS);
    c.set(38, gy + 4, 48, TORCH);
    torchPost(c, 26, gy, 44); torchPost(c, 38, gy, 44);
    c.set(22, gy + 1, 48, FLOWER); c.set(42, gy + 1, 48, FLOWER);

    // ---- 锁① 交通安全街→热线巷（z=43）：daofa·交通规则 ----
    c.fill(0, gy + 1, 43, 63, gy + 4, 43, COBBLESTONE);
    c.clear(32, gy + 1, 43, 32, gy + 2, 43);
    doorway(c, { x: 32, z: 43, y0: gy + 1, facing: 2 }, { x: 31, y: gy + 1, z: 43 });
    crenels(c, 0, 43, 63, 43, gy + 5);
    c.set(33, gy + 1, 44, TORCH);

    // ---- 求助热线巷（z 36..42）：电话亭 + 指路柱 + 急救白十字 + 检查点一 ----
    c.fill(30, gy, 36, 34, gy, 42, GRAVEL);               // 巷内石板路
    c.fill(24, gy + 1, 39, 24, gy + 3, 39, BRICK);        // 电话亭：砖柱 + 玻璃亭身（z=39，
    c.fill(25, gy + 1, 39, 25, gy + 3, 39, GLASS);        //   距两侧锁墙 z=35/43 各 4 格）
    c.set(23, gy + 1, 39, TORCH);
    c.fill(40, gy + 1, 39, 40, gy + 2, 39, WOOD);         // 指路柱
    c.set(40, gy + 3, 39, WOOL);                          // 柱头白色「120」牌
    c.set(30, gy + 1, 38, WOOL); c.set(34, gy + 1, 38, WOOL); // 急救包白十字（地面摆设）
    torchPost(c, 28, gy, 41); torchPost(c, 36, gy, 41);
    for (const [x, z] of [[26, 37], [38, 37], [26, 42], [38, 42]]) c.set(x, gy + 1, z, FLOWER);
    flagAt(c, 32, gy, 38, FLAG_CHECKPOINT);               // 检查点一：热线巷正中

    // ---- 锁② 热线巷→礼仪院（z=35）：daofa·紧急求助 ----
    c.fill(0, gy + 1, 35, 63, gy + 4, 35, COBBLESTONE);
    c.clear(32, gy + 1, 35, 32, gy + 2, 35);
    doorway(c, { x: 32, z: 35, y0: gy + 1, facing: 2 }, { x: 31, y: gy + 1, z: 35 });
    crenels(c, 0, 35, 63, 35, gy + 5);
    c.set(33, gy + 1, 36, TORCH);

    // ---- 文明礼仪院（z 27..34，两侧院墙收成「院」）：讲坛 + 箴言墙 + 检查点二 ----
    c.fill(18, gy + 1, 27, 18, gy + 4, 34, COBBLESTONE);  // 西院墙
    c.fill(46, gy + 1, 27, 46, gy + 4, 34, COBBLESTONE);  // 东院墙
    crenels(c, 18, 27, 18, 34, gy + 5);
    crenels(c, 46, 27, 46, 34, gy + 5);
    c.fill(18, gy + 2, 29, 18, gy + 2, 32, WOOL);         // 西墙羊毛箴言带
    c.fill(46, gy + 2, 29, 46, gy + 2, 32, WOOL);         // 东墙羊毛箴言带
    c.fill(31, gy, 27, 33, gy, 34, GRAVEL);               // 院中甬路
    c.fill(29, gy + 1, 29, 31, gy + 2, 30, PLANKS);       // 礼仪讲坛（2 高，可登）
    c.set(30, gy + 3, 29, TORCH);
    for (const [x, z] of [[22, 28], [25, 28], [39, 28], [42, 28], [22, 33], [42, 33]]) {
        c.set(x, gy + 1, z, FLOWER);
    }
    torchPost(c, 24, gy, 33); torchPost(c, 40, gy, 33);
    flagAt(c, 32, gy, 31, FLAG_CHECKPOINT);               // 检查点二：礼仪院正中

    // ---- 锁③ 礼仪院→市民广场（z=26）：daofa·礼仪情景两步判断 ----
    c.fill(0, gy + 1, 26, 63, gy + 4, 26, COBBLESTONE);
    c.clear(32, gy + 1, 26, 32, gy + 2, 26);
    doorway(c, { x: 32, z: 26, y0: gy + 1, facing: 2 }, { x: 31, y: gy + 1, z: 26 });
    crenels(c, 0, 26, 63, 26, gy + 5);
    c.set(33, gy + 1, 27, TORCH);

    // ---- 市民广场（z 12..25）：石板广场 + 野餐垫 + 花坛 + 终点旗 ----
    c.fill(24, gy, 14, 40, gy, 24, GRAVEL);               // 广场石板
    c.fill(26, gy + 1, 16, 28, gy + 1, 17, WOOL);         // 羊毛野餐垫
    c.set(25, gy + 1, 16, CRAFTING_TABLE);                // 野餐篮（工作台）
    c.set(25, gy + 1, 17, FURNACE);                       // 小烤炉
    // 广场乔木：树冠外缘距锁墙 z=26 ≥4 格，跳不上城齿
    tree(c, 14, gy, 16); tree(c, 50, gy, 16);
    tree(c, 22, gy, 20); tree(c, 42, gy, 20);
    for (const [x, z] of [[20, 18], [44, 18], [32, 13], [32, 23]]) c.set(x, gy + 1, z, FLOWER);
    torchPost(c, 24, gy, 14); torchPost(c, 40, gy, 14);
    torchPost(c, 24, gy, 24); torchPost(c, 40, gy, 24);
    flagAt(c, 32, gy, 18, FLAG_GOAL);                     // 终点旗：广场正中

    // ---- 彩蛋「礼让亭」（广场西北角，非必经）：压力板贴门旁、踩板开门 ----
    //   四角砖柱 + 木亭顶；东侧墙段嵌木门，门外草地贴一块压力板：
    //   踩上 → 压力板变激活源 → 门块下半 6 邻有源 → 上升沿开门；走开后下降沿自动关门。
    c.fill(12, gy + 1, 14, 12, gy + 3, 14, BRICK);        // 西北柱
    c.fill(12, gy + 1, 18, 12, gy + 3, 18, BRICK);        // 西南柱
    c.fill(16, gy + 1, 14, 16, gy + 3, 14, BRICK);        // 东北柱
    c.fill(16, gy + 1, 18, 16, gy + 3, 18, BRICK);        // 东南柱
    c.fill(16, gy + 1, 15, 16, gy + 3, 17, BRICK);        // 东墙段（门洞开在正中，上封到亭顶）
    c.set(16, gy + 1, 16, doorId(0, 0, 3));               // 木门下半（墙沿 z 走向、沿 x 穿门=facing 3）
    c.set(16, gy + 2, 16, doorId(1, 0, 3));               // 木门上半
    c.fill(11, gy + 4, 13, 17, gy + 4, 19, PLANKS);       // 亭顶（出檐）
    c.set(17, gy + 1, 16, PLATE_BASE);                    // 门旁压力板（抬放态），踩板开门
    c.set(13, gy + 1, 16, WOOL);                          // 亭内羊毛坐垫
    c.set(14, gy + 1, 16, WOOL);
    c.set(14, gy + 1, 15, FLOWER);                        // 亭内供花
    c.set(14, gy + 1, 17, FLOWER);
    c.set(12, gy + 5, 16, TORCH);                         // 亭顶火把

    return {
        name: '规矩小城',
        canvas: c,
        rules: { timeLimit: 480, lockAIHelp: true },
        flags: {
            start: { x: 32, y: gy + 1, z: 52 },
            checkpoints: [
                { x: 32, y: gy + 1, z: 38 }, // 求助热线巷
                { x: 32, y: gy + 1, z: 31 }, // 文明礼仪院
            ],
            goal: { x: 32, y: gy + 1, z: 18 }, // 市民广场
        },
        questions: [
            // 锁① 交通安全街：红绿灯与斑马线
            choiceQ({ x: 31, y: gy + 1, z: 43 }, 'daofa',
                '过马路时，下面哪种做法是安全的？',
                ['从停着的汽车中间穿过去', '低头看手机，快步走过去',
                    '走斑马线，红灯停、绿灯行', '路上没车就跟着大人闯红灯'], 2,
                '三上·安全护我成长', '斑马线是行人的安全线：红灯停、绿灯行，专心走路不打闹'),
            // 锁② 求助热线巷：紧急求助（120 急救场景——老关卡的「火灾 119」不重复）
            choiceQ({ x: 31, y: gy + 1, z: 35 }, 'daofa',
                '在路上发现有人突然晕倒、伤得很重，你应该先怎么做？',
                ['赶快扶起来用力摇晃他', '拨打 120，说清地点和病人情况',
                    '围上去看热闹', '喂他喝几口水'], 1,
                '三上·安全护我成长', '120 是急救电话；随便摇晃、喂水反而会让伤员伤得更重'),
            // 锁③ 文明礼仪院：情景判断两步推理（既权衡「图书馆要安静」的规则，
            //   又要选出不伤朋友面子的做法，两条线索合起来才得出答案）
            choiceQ({ x: 31, y: gy + 1, z: 26 }, 'daofa',
                '图书馆里大家都在安静看书，好朋友悄悄叫你过去讲笑话，你最合适的做法是？',
                ['大声笑出来，笑话确实好笑', '叫更多同学一起过来听',
                    '马上大声告诉管理员，让他挨批评', '小声提醒他图书馆要保持安静，约他出去再说'], 3,
                '三上·我们的学校', '守规则也要顾朋友：先小声提醒，出了图书馆再一起说笑'),
        ],
    };
}

if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
