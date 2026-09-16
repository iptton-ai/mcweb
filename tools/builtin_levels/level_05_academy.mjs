// ==================== level_05_academy.mjs 「诗文书院」 ====================
// 内置官方关卡 L5：语文·英语专场。三进院书院，中轴对称：
//   前庭（起点旗+照壁+花圃）→ 诗廊（墙门锁①：yuwen 古诗出处）
//   → 藏书楼一层大厅（锁②：english 情景对话，检查点一）
//   → 环廊楼梯上二层藏书阁（锁③：yuwen 字词两步推理，检查点二）→ 终点=二层露台书房。
// 彩蛋：楼顶小阁用星辉门当半截门（超纲题开门，不进卡 questions），阁内钻石矿堆+羊毛地毯。
// 布局自检要点（对应 _lib 校验器）：
//   - 主通路全部 6 邻可达：楼梯=逐格 +1 实心台阶，楼板洞 3×3 盖住起跳级头顶
//     （跳跃弧线撞头会卡死在中段——净空约束已进 _lib 移动模型）。
//   - 墙门 A 与藏书楼外墙把前庭/诗廊/楼内完全分隔；门洞上方一律封墙到结构顶。
//   - 楼梯间四面合围（x=20 西墙 + z=10 南封 + x=24 隔墙 + 北外墙 z=29），
//     唯一入口=锁②的门，唯一出口=楼板洞上二层——杜绝大厅绕行上楼。
//   - 锁③隔墙（x=34）贯穿 z 2..28 贴北外墙，藏书阁/书房二层完全分隔。
//   - 前庭乔木树冠边缘距分隔墙 ≥4 格（跑跳 dist≤3 + 升 ≤1 够不到墙顶/城齿），
//     杜绝「树冠跳墙顶」绕过锁①。

import {
    BlockTypes,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
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
    starlightHalfDoor,
    torchPost,
    tree,
} from './_lib.mjs';

export const LEVEL_FILE = 'level_05_academy.level.json';

const {
    AIR,
    BRICK,
    COBBLESTONE,
    DIAMOND_ORE,
    FLOWER,
    GLASS,
    GRAVEL,
    PLANKS,
    TORCH,
    WOOL,
} = BlockTypes;

export function buildLevel() {
    const c = new Canvas(60, 18, 44);
    const gy = 3; // 地面顶面 y=gy，站立层 y=gy+1
    ground(c, gy);
    borderWall(c, gy, COBBLESTONE);

    // ---- 前庭（z 36..42）：起点旗 + 照壁 + 花圃 + 树 ----
    flagAt(c, 30, gy, 41, FLAG_START);
    // 石板甬道：从起点到照壁分左右两股绕行，再汇到墙门
    c.fill(28, gy, 40, 32, gy, 42, GRAVEL);
    c.fill(25, gy, 37, 26, gy, 39, GRAVEL);
    c.fill(34, gy, 37, 35, gy, 39, GRAVEL);
    c.fill(28, gy, 36, 32, gy, 37, GRAVEL);
    // 照壁：3 高实心（1 厚立墙从地面跳不上），嵌白色羊毛花窗
    c.fill(27, gy + 1, 39, 33, gy + 3, 39, BRICK);
    c.set(30, gy + 2, 39, WOOL);
    c.set(28, gy + 1, 39, WOOL);
    c.set(32, gy + 1, 39, WOOL);
    // 乔木全部压在 z=41 一线：树冠南缘 z=39，距墙门 A（z=35）还有 4 格，跑跳（≤3 格）上不了墙
    tree(c, 12, gy, 41); tree(c, 20, gy, 41); tree(c, 40, gy, 41); tree(c, 48, gy, 41);
    for (const [x, z] of [[26, 40], [34, 40], [28, 42], [32, 42], [22, 38], [38, 38]]) {
        c.set(x, gy + 1, z, FLOWER);
    }
    torchPost(c, 24, gy, 41); torchPost(c, 36, gy, 41);
    torchPost(c, 24, gy, 37); torchPost(c, 36, gy, 37);

    // ---- 墙门 A（z=35，贯穿全宽防绕行）：锁① yuwen·古诗出处 ----
    c.fill(0, gy + 1, 35, 59, gy + 4, 35, COBBLESTONE);
    c.clear(30, gy + 1, 35, 30, gy + 2, 35); // 门洞 1 宽 2 高，上方 gy+3..4 留墙封顶
    doorway(c, { x: 30, z: 35, y0: gy + 1, facing: 2 }, { x: 29, y: gy + 1, z: 35 });
    crenels(c, 0, 35, 59, 35, gy + 5);
    c.set(31, gy + 1, 36, TORCH); // 门旁落地火把（脚下草皮支撑）

    // ---- 诗廊（z 30..34）：墙门 A 与藏书楼之间的封闭游廊 ----
    c.fill(28, gy, 30, 32, gy, 34, GRAVEL); // 廊中石板路
    c.fill(22, gy + 1, 30, 22, gy + 3, 30, PLANKS); // 廊柱（西）
    c.fill(38, gy + 1, 30, 38, gy + 3, 30, PLANKS); // 廊柱（东）
    c.fill(22, gy + 4, 30, 38, gy + 4, 30, PLANKS); // 檐枋（柱顶横梁，纯装饰）
    c.fill(26, gy + 1, 32, 28, gy + 1, 32, PLANKS); // 书案长凳（西）
    c.fill(32, gy + 1, 32, 34, gy + 1, 32, PLANKS); // 书案长凳（东）
    for (const [x, z] of [[24, 31], [30, 31], [36, 33], [27, 34], [33, 34]]) {
        c.set(x, gy + 1, z, FLOWER);
    }
    c.set(25, gy + 1, 33, TORCH);
    c.set(35, gy + 1, 31, TORCH);

    // ---- 藏书楼（x 0..59 全宽，z 1..29）：一层大厅 + 二层藏书阁/露台书房 ----
    // 外壳一次填实再掏腔，保证外墙无洞；楼板/屋顶满铺。
    c.fill(0, gy + 1, 1, 59, gy + 9, 29, COBBLESTONE);      // 实心毛坯（z 1..29 全宽）
    c.clear(1, gy + 1, 2, 58, gy + 4, 28);                  // 一层大厅内腔
    c.fill(0, gy + 5, 1, 59, gy + 5, 29, PLANKS);           // 二层楼板
    c.clear(1, gy + 6, 2, 58, gy + 9, 28);                  // 二层内腔
    c.fill(0, gy + 10, 1, 59, gy + 10, 29, PLANKS);         // 屋顶
    // 屋顶女儿墙（1 高实心围栏，防在楼顶散步时失足）
    c.fill(0, gy + 11, 1, 59, gy + 11, 1, COBBLESTONE);
    c.fill(0, gy + 11, 29, 59, gy + 11, 29, COBBLESTONE);
    c.fill(0, gy + 11, 1, 0, gy + 11, 29, COBBLESTONE);
    c.fill(59, gy + 11, 1, 59, gy + 11, 29, COBBLESTONE);
    // 一层铺木地板（大厅+诗廊侧墙根），楼梯间铺石
    c.fill(1, gy, 2, 58, gy, 28, PLANKS);
    c.fill(21, gy, 11, 23, gy, 28, COBBLESTONE);
    // 南墙（z=29，兼诗廊北侧封墙）：正中拱门 1 宽 2 高，上方封到结构顶
    c.clear(30, gy + 1, 29, 30, gy + 2, 29);
    // 一层南墙门脸+花窗（玻璃实心不算洞），东西山墙与北墙各开小窗
    c.set(24, gy + 3, 29, GLASS); c.set(36, gy + 3, 29, GLASS);
    c.set(24, gy + 8, 29, GLASS); c.set(36, gy + 8, 29, GLASS);
    c.set(30, gy + 8, 1, GLASS);
    c.set(0, gy + 3, 12, GLASS); c.set(0, gy + 3, 20, GLASS);
    c.set(0, gy + 8, 12, GLASS); c.set(0, gy + 8, 20, GLASS);
    c.set(59, gy + 3, 12, GLASS); c.set(59, gy + 3, 20, GLASS);
    c.set(59, gy + 8, 12, GLASS); c.set(59, gy + 8, 20, GLASS);

    // 一层大厅内饰：楹柱 + 讲案 + 蒲团 + 北墙书架
    for (const px of [10, 30, 50]) for (const pz of [8, 22]) {
        c.fill(px, gy + 1, pz, px, gy + 4, pz, BRICK);
    }
    c.fill(26, gy + 1, 12, 32, gy + 1, 12, PLANKS); // 长讲案
    c.set(29, gy + 2, 12, TORCH);
    for (const x of [26, 28, 30, 32]) c.set(x, gy + 1, 14, WOOL); // 蒲团
    c.fill(4, gy + 1, 2, 16, gy + 2, 2, PLANKS);   // 北墙书架（西）
    c.fill(44, gy + 1, 2, 56, gy + 2, 2, PLANKS);  // 北墙书架（东）
    c.set(6, gy + 3, 2, TORCH); c.set(10, gy + 3, 2, TORCH);
    c.set(48, gy + 3, 2, TORCH); c.set(52, gy + 3, 2, TORCH);
    c.set(5, gy + 1, 26, TORCH); c.set(55, gy + 1, 26, TORCH);
    c.set(18, gy + 1, 26, TORCH); c.set(42, gy + 1, 26, TORCH);
    // 检查点一：一层大厅正中
    flagAt(c, 30, gy, 16, FLAG_CHECKPOINT);

    // ---- 楼梯间（x 21..23，西墙内）：锁② english 门 + 逐格 +1 楼梯 ----
    // 四面合围：x=24 隔墙（东，带锁②门）+ x=20 西墙 + z=10 南封 + 北外墙 z=29；
    // 缺了西墙/南封时大厅可直接绕进门后上楼（2026-09-16 修复的绕行漏洞）
    c.fill(24, gy + 1, 11, 24, gy + 4, 28, BRICK);          // 楼梯间隔墙（封到楼板）
    c.fill(20, gy + 1, 11, 20, gy + 4, 28, BRICK);          // 楼梯间西墙（封到楼板）
    c.fill(20, gy + 1, 10, 24, gy + 4, 10, BRICK);          // 南端封墙（连隔墙与西墙）
    c.clear(24, gy + 1, 20, 24, gy + 2, 20);                // 门洞
    doorway(c, { x: 24, z: 20, y0: gy + 1, facing: 3 }, { x: 24, y: gy + 1, z: 19 });
    c.set(22, gy + 1, 13, TORCH);                           // 楼梯间壁火把
    // 楼梯：z 27→24 逐格 +1，最后一级顶面=楼板层
    c.set(22, gy + 1, 27, COBBLESTONE);
    c.set(22, gy + 2, 26, COBBLESTONE);
    c.set(22, gy + 3, 25, COBBLESTONE);
    c.set(22, gy + 4, 24, COBBLESTONE);
    // 楼板洞 3×3（x 21..23 × z 24..26）：盖住 z=26 起跳级的头顶——
    // 洞只有 1×2 时站在 z=26 级上头顶只剩 0.2 格，起跳即撞头卡死在中段
    c.clear(21, gy + 5, 24, 23, gy + 5, 26);

    // ---- 二层：藏书阁（x 21..33）| 锁③隔墙（x=34）| 露台书房（x 35..43） ----
    // 藏书阁内饰：北墙书架 + 长案 + 羊毛地毯 + 检查点二
    c.fill(26, gy + 6, 2, 32, gy + 7, 2, PLANKS);
    c.set(29, gy + 8, 2, TORCH);
    c.fill(27, gy + 6, 18, 31, gy + 6, 18, PLANKS);
    c.set(29, gy + 7, 18, TORCH);
    c.fill(27, gy + 6, 20, 31, gy + 6, 21, WOOL);           // 羊毛地毯
    torchPost(c, 24, gy + 5, 13);                            // 二层落地灯柱（火把柱）
    torchPost(c, 32, gy + 5, 25);
    flagAt(c, 29, gy + 6, 20, FLAG_CHECKPOINT);              // 检查点二：立于地毯上
    // 锁③隔墙（x=34，z 2..28 贴北外墙，封到屋顶）：yuwen 字词两步推理——
    // 只封 z 11..28 时可从北侧 z 2..10 绕过（2026-09-16 修复的绕行漏洞）
    c.fill(34, gy + 6, 2, 34, gy + 9, 28, BRICK);
    c.clear(34, gy + 6, 22, 34, gy + 7, 22);
    doorway(c, { x: 34, z: 22, y0: gy + 6, facing: 3 }, { x: 34, y: gy + 6, z: 23 });
    // 露台书房（终点间）
    c.fill(44, gy + 6, 11, 44, gy + 9, 28, BRICK);          // 东隔墙：书房到此为止，东侧封死
    c.fill(36, gy + 6, 17, 38, gy + 6, 21, WOOL);           // 书房地毯
    c.fill(36, gy + 6, 13, 38, gy + 6, 13, PLANKS);         // 书案
    c.set(37, gy + 7, 13, TORCH);
    c.fill(43, gy + 6, 12, 43, gy + 7, 16, PLANKS);         // 靠东墙书架
    c.fill(43, gy + 6, 22, 43, gy + 7, 26, PLANKS);
    torchPost(c, 36, gy + 5, 25);
    torchPost(c, 42, gy + 5, 25);
    flagAt(c, 37, gy + 6, 19, FLAG_GOAL);                    // 终点旗：立在书房地毯上

    // ---- 二层→屋顶楼梯（藏书阁西北角）+ 屋顶小阁彩蛋 ----
    c.set(21, gy + 6, 17, COBBLESTONE);
    c.set(21, gy + 7, 16, COBBLESTONE);
    c.set(21, gy + 8, 15, COBBLESTONE);
    c.set(21, gy + 9, 14, COBBLESTONE);
    // 屋顶洞 3×3（x 20..22 × z 14..16）：盖住 z=16 起跳级头顶（同主楼梯净空修正）
    c.clear(20, gy + 10, 14, 22, gy + 10, 16);
    // 楼顶小阁：星辉门当半截门（答超纲题开门，不进卡 questions），阁内藏钻石
    c.fill(35, gy + 11, 14, 38, gy + 13, 17, BRICK);
    c.clear(36, gy + 11, 15, 37, gy + 13, 16);              // 阁内腔
    c.fill(35, gy + 14, 14, 38, gy + 14, 17, BRICK);        // 阁顶
    starlightHalfDoor(c, 35, gy + 11, 15);                  // 西墙开门洞：下半星辉门、上半留空
    c.set(34, gy + 11, 15, TORCH);                          // 阁门口屋顶火把
    c.set(36, gy + 11, 16, WOOL);                           // 阁内羊毛毯
    c.set(36, gy + 12, 16, TORCH);                          // 毯上火把
    c.set(37, gy + 11, 16, DIAMOND_ORE);                    // 钻石矿堆
    c.set(37, gy + 12, 16, DIAMOND_ORE);

    return {
        name: '诗文书院',
        canvas: c,
        rules: { timeLimit: 420, lockAIHelp: true },
        flags: {
            start: { x: 30, y: gy + 1, z: 41 },
            checkpoints: [
                { x: 30, y: gy + 1, z: 16 },   // 一层大厅
                { x: 29, y: gy + 7, z: 20 },   // 二层藏书阁地毯上
            ],
            goal: { x: 37, y: gy + 7, z: 19 }, // 二层露台书房
        },
        questions: [
            // 锁① 诗廊墙门：古诗与出处（三上统编古诗目）
            choiceQ({ x: 29, y: gy + 1, z: 35 }, 'yuwen',
                '「荷尽已无擎雨盖，菊残犹有傲霜枝」出自哪首诗？',
                ['《赠刘景文》', '《山行》', '《夜书所见》', '《望洞庭》'], 0,
                '三上·古诗', '荷花枯尽、菊花傲霜——苏轼写给好友刘景文的深秋赠诗'),
            // 锁② 楼梯间：英语情景对话选英文句
            choiceQ({ x: 24, y: gy + 1, z: 19 }, 'english',
                '同学见面问你 "How are you?"，你应该回答：',
                ['Good morning.', 'Goodbye!', "I'm fine, thank you.", 'My name is Lily.'], 2,
                '英语·情景对话', 'How are you? 是在问「你好吗」，先回答自己的状态再道谢'),
            // 锁③ 藏书阁→书房：字词两步推理（先应用「坐=因为」，再串起全句语序）
            choiceQ({ x: 34, y: gy + 6, z: 23 }, 'yuwen',
                '《山行》里「停车坐爱枫林晚」的「坐」是「因为」的意思，这句诗的意思是：',
                ['坐在车里看傍晚的枫林', '停下车来，是因为喜爱这傍晚的枫林',
                    '停车以后坐下来欣赏枫林', '因为坐车累了，停在枫林边休息'], 1,
                '三上·字词', '「爱」是喜爱：因为喜爱傍晚的枫林景色，才停下车来'),
        ],
    };
}

if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
