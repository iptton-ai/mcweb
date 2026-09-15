// ==================== gen_builtin_levels.mjs ====================
// 内置关卡（官方随包发布）生成器：程序化搭建 4 张关卡卡（mcweb.level.v1）写入 assets/levels/。
// 运行：node tools/gen_builtin_levels.mjs
// 产出：assets/levels/index.json + warmup/castle/dungeon/skypark 四个 .level.json。
//
// 设计约定（与运行时机制逐条对齐）：
//   - 锁具联动只用「答题机紧贴门」一种接线（run_workshop W04 已验证）：答题机答对翻转为
//     常供能红石源，门块（下半）6 邻有激活源即上升沿开门；答题机头顶放红石灯=解锁正反馈。
//   - 门洞一律 1 宽 2 高：doorId(0,0,facing)+doorId(1,0,facing)，门洞上方用墙体封到顶
//     （墙沿 x 走向、玩家沿 z 穿门用 facing 2；墙沿 z 走向、玩家沿 x 穿门用 facing 3）。
//   - 楼梯 = 逐格 +1 实心台阶；楼板洞开在最后两级头顶（2 宽），保证玩家每步头顶净空、
//     末级一步 +1 跳上楼板，同时 reachabilityBFS（6 邻泛洪）也能爬上去——校验零警告。
//   - 星辉门当「半截门」用：锁定变体实心挡住门洞下半、上半留空；答对（超纲题，因人而异
//     不进卡 questions）翻转为可通行。纯彩蛋房，不进 questions 不影响可达性判定。
//   - 题目全部自拟（meta.source custom），对齐北师大/统编三上知识点，答案已人工复算。
//   - 输出确定性：created 固定时间戳，重复生成字节一致（好 review、好回滚）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BlockTypes,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
    KEYPAD_BASE,
    STARLIGHT_BASE,
    flagId,
    doorId,
    lampId,
} from '../js/config.js';
import { rleEncode } from '../js/rle.js';
import {
    LEVEL_CARD_FORMAT,
    cardHash,
    reachabilityBFS,
    u8ToBase64,
    validateLevelCard,
} from '../js/levelWorkshop.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets', 'levels');
const AUTHOR = 'MCWeb 学院';
const CREATED = '2026-09-15T09:00:00.000Z'; // 固定时间戳：确定性输出

const { AIR, GRASS, DIRT, STONE, LEAVES, SAND, WATER, BRICK, GLASS, PLANKS, COBBLESTONE, GRAVEL, LOG, TORCH, FLOWER, WOOL, COAL_ORE, DIAMOND_ORE, CRAFTING_TABLE, FURNACE, SLIME } = BlockTypes;

// ==================== 画布与结构小工具 ====================

// 局部方块画布：内存序与区域快照一致 decoded[lx + lz*w + ly*w*d]（x 最快）
class Canvas {
    constructor(w, h, d) {
        this.w = w;
        this.h = h;
        this.d = d;
        this.b = new Uint8Array(w * h * d);
    }
    set(x, y, z, id) {
        if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.d) {
            throw new Error(`越界 set(${x},${y},${z}) 画布 ${this.w}×${this.h}×${this.d}`);
        }
        this.b[x + z * this.w + y * this.w * this.d] = id;
    }
    fill(x0, y0, z0, x1, y1, z1, id) { // 含两端
        for (let y = y0; y <= y1; y++)
            for (let z = z0; z <= z1; z++)
                for (let x = x0; x <= x1; x++) this.set(x, y, z, id);
    }
    clear(x0, y0, z0, x1, y1, z1) { this.fill(x0, y0, z0, x1, y1, z1, AIR); }
}

// 草地地基：0..gy-1 泥土 + 顶面 gy 草皮
function ground(c, gy) {
    c.fill(0, 0, 0, c.w - 1, gy - 1, c.d - 1, DIRT);
    c.fill(0, gy, 0, c.w - 1, gy, c.d - 1, GRASS);
}

// 区域边框矮墙（2 高跳不上，防走出嵌入区域边缘摔进虚空）
function borderWall(c, gy, mat) {
    c.fill(0, gy + 1, 0, c.w - 1, gy + 2, 0, mat);
    c.fill(0, gy + 1, c.d - 1, c.w - 1, gy + 2, c.d - 1, mat);
    c.fill(0, gy + 1, 0, 0, gy + 2, c.d - 1, mat);
    c.fill(c.w - 1, gy + 1, 0, c.w - 1, gy + 2, c.d - 1, mat);
}

// 树：原木杆 + 方球树冠（削角）
function tree(c, x, gy, z) {
    const top = gy + 4;
    for (let y = gy + 1; y <= top; y++) c.set(x, y, z, LOG);
    c.fill(x - 2, top - 1, z - 2, x + 2, top + 1, z + 2, LEAVES);
    for (const [cx, cz] of [[x - 2, z - 2], [x + 2, z - 2], [x - 2, z + 2], [x + 2, z + 2]]) {
        c.set(cx, top - 1, cz, AIR);
        c.set(cx, top + 1, cz, AIR);
    }
    c.set(x, top + 2, z, LEAVES);
}

// 火把柱：2 格石柱 + 顶火把
function torchPost(c, x, gy, z) {
    c.set(x, gy + 1, z, COBBLESTONE);
    c.set(x, gy + 2, z, COBBLESTONE);
    c.set(x, gy + 3, z, TORCH);
}

// 一排城齿（墙顶 alternating）
function crenels(c, x0, z0, x1, z1, y, mat = COBBLESTONE) {
    let alt = 0;
    for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
            c.set(x, y, z, (alt++ % 2 === 0) ? mat : AIR);
}

// 完整门洞（在既有墙体上开 1 宽 2 高 + 装门）+ 贴门答题机 + 头顶红石灯。
// opening = {x, z, y0, facing}：门洞列；keypad = {x,y,z}：洞旁 1 格（会覆写墙块）。
function doorway(c, opening, keypad) {
    c.set(opening.x, opening.y0, opening.z, doorId(0, 0, opening.facing));
    c.set(opening.x, opening.y0 + 1, opening.z, doorId(1, 0, opening.facing));
    c.set(keypad.x, keypad.y, keypad.z, KEYPAD_BASE);
    c.set(keypad.x, keypad.y + 1, keypad.z, lampId(0));
}

// 旗：立在地面 gy 之上 1 格
function flagAt(c, x, gy, z, kind) {
    c.set(x, gy + 1, z, flagId(kind));
}

// ==================== 题目助手（自拟·三上对齐，带双通过计数） ====================

function inputQ(p, stem, answer, unit, hint) {
    return {
        lockType: 'keypad', x: p.x, y: p.y, z: p.z,
        subject: 'math', kind: 'input', stem, answer,
        hint, unit,
        meta: { source: 'custom', verifiedPasses: 2 },
    };
}
function choiceQ(p, subject, stem, options, answer, unit, hint) {
    return {
        lockType: 'keypad', x: p.x, y: p.y, z: p.z,
        subject, kind: 'choice', stem, options, answer,
        hint, unit,
        meta: { source: 'custom', verifiedPasses: 2 },
    };
}

// ==================== L1 村口热身赛（教学关：两道墙门·数字与科学） ====================

function buildWarmup() {
    const c = new Canvas(44, 14, 30);
    const gy = 3;
    ground(c, gy);
    borderWall(c, gy, COBBLESTONE);
    // 装饰：树 + 花 + 火把柱
    tree(c, 8, gy, 8); tree(c, 8, gy, 22); tree(c, 36, gy, 9); tree(c, 37, gy, 22);
    for (const z of [10, 20]) for (const x of [10, 22, 34]) c.set(x, gy + 1, z, FLOWER);
    torchPost(c, 6, gy, 12); torchPost(c, 20, gy, 12); torchPost(c, 27, gy, 18); torchPost(c, 41, gy, 18);

    flagAt(c, 5, gy, 15, FLAG_START);

    // 第一道墙门（贯穿全深防绕行）：数学 2×6+3=15
    c.fill(16, gy + 1, 0, 16, gy + 3, c.d - 1, COBBLESTONE);
    c.clear(16, gy + 1, 15, 16, gy + 2, 15);
    doorway(c, { x: 16, z: 15, y0: gy + 1, facing: 3 }, { x: 16, y: gy + 1, z: 16 });
    crenels(c, 16, 0, 16, 14, gy + 4);
    crenels(c, 16, 16, 16, c.d - 1, gy + 4);

    flagAt(c, 24, gy, 15, FLAG_CHECKPOINT);
    tree(c, 24, gy, 11);

    // 第二道墙门：科学（水沸腾约 100℃）
    c.fill(30, gy + 1, 0, 30, gy + 3, c.d - 1, COBBLESTONE);
    c.clear(30, gy + 1, 15, 30, gy + 2, 15);
    doorway(c, { x: 30, z: 15, y0: gy + 1, facing: 3 }, { x: 30, y: gy + 1, z: 14 });
    crenels(c, 30, 0, 30, 14, gy + 4);
    crenels(c, 30, 16, 30, c.d - 1, gy + 4);

    // 终点野餐角
    flagAt(c, 38, gy, 15, FLAG_GOAL);
    c.set(37, gy + 1, 12, CRAFTING_TABLE);
    c.set(37, gy + 1, 18, FURNACE);
    c.set(40, gy + 1, 13, WOOL);
    c.set(40, gy + 1, 17, WOOL);
    c.set(38, gy + 1, 12, TORCH);
    c.set(38, gy + 1, 18, TORCH);

    return {
        name: '村口热身赛',
        canvas: c,
        rules: { timeLimit: null, lockAIHelp: true },
        flags: {
            start: { x: 5, y: gy + 1, z: 15 },
            checkpoints: [{ x: 24, y: gy + 1, z: 15 }],
            goal: { x: 38, y: gy + 1, z: 15 },
        },
        questions: [
            inputQ({ x: 16, y: gy + 1, z: 16 }, '2×6+3 = ?', 15, '三上·混合运算', '先算乘法：2×6=12，再加 3'),
            choiceQ({ x: 30, y: gy + 1, z: 14 }, 'science', '水烧开（沸腾）时，温度大约是多少？',
                ['大约 60℃', '大约 80℃', '大约 200℃', '大约 100℃'], 3,
                '三上·水', '标准大气压下水约 100℃ 沸腾'),
        ],
    };
}

// ==================== L2 星辉城堡（主关：城门→庭院→大厅→王座厅 + 星辉塔彩蛋） ====================

function buildCastle() {
    const c = new Canvas(60, 26, 52);
    const gy = 3;
    ground(c, gy);
    borderWall(c, gy, GRAVEL);

    // ---- 城外前庭 ----
    tree(c, 14, gy, 44); tree(c, 45, gy, 44); tree(c, 20, gy, 48); tree(c, 40, gy, 48);
    torchPost(c, 24, gy, 45); torchPost(c, 36, gy, 45); torchPost(c, 24, gy, 40); torchPost(c, 36, gy, 40);
    for (const x of [27, 28, 32, 33]) c.set(x, gy + 1, 44, FLOWER);
    flagAt(c, 30, gy, 47, FLAG_START);

    // ---- 护城河（环形 1 格深水带）+ 南面木桥 ----
    for (let x = 10; x <= 49; x++) for (const z of [10, 11, 34, 35]) { c.set(x, gy, z, WATER); c.set(x, gy - 1, z, DIRT); }
    for (let z = 10; z <= 35; z++) for (const x of [10, 11, 48, 49]) { c.set(x, gy, z, WATER); c.set(x, gy - 1, z, DIRT); }
    c.fill(29, gy, 34, 31, gy, 35, PLANKS); // 木桥

    // ---- 城墙圈 + 城齿 + 四角楼 ----
    const WY0 = gy + 1, WY1 = gy + 7;
    c.fill(12, WY0, 36, 47, WY1, 36, COBBLESTONE); // 南墙
    c.fill(12, WY0, 12, 47, WY1, 12, COBBLESTONE); // 北墙
    c.fill(12, WY0, 13, 12, WY1, 35, COBBLESTONE); // 西墙
    c.fill(47, WY0, 13, 47, WY1, 35, COBBLESTONE); // 东墙
    crenels(c, 12, 12, 47, 12, WY1 + 1);
    crenels(c, 12, 36, 47, 36, WY1 + 1);
    for (const [tx, tz] of [[12, 12], [45, 12], [12, 34], [45, 34]]) {
        c.fill(tx, WY0, tz, tx + 2, WY1 + 4, tz + 2, COBBLESTONE);
        c.clear(tx + 1, WY0 + 1, tz + 1, tx + 1, WY1 + 3, tz + 1); // 楼内腔
        c.set(tx + 1, WY1 + 5, tz + 1, TORCH); // 楼顶火把
        if (tz === 12) c.set(tx + 1, WY1 - 1, tz, GLASS);      // 箭窗
        if (tz === 34) c.set(tx + 1, WY1 - 1, tz + 2, GLASS);
    }

    // ---- 城门（南墙 1 宽门洞 + 门 + 答题机·数学） ----
    c.clear(30, WY0, 36, 30, WY1, 36);                 // 开 1 宽通顶缝
    c.fill(30, WY0 + 2, 36, 30, WY1, 36, COBBLESTONE); // 上部封回（净高 2）
    doorway(c, { x: 30, z: 36, y0: WY0, facing: 2 }, { x: 29, y: WY0, z: 36 });
    c.set(31, WY1 + 1, 36, TORCH); // 城门旁墙齿上的火把

    // ---- 庭院：水井、花园、演武场、检查点 ----
    flagAt(c, 30, gy, 33, FLAG_CHECKPOINT);
    c.fill(18, gy + 1, 18, 20, gy + 1, 20, COBBLESTONE); // 水井
    c.set(19, gy + 1, 19, WATER);
    c.set(19, gy + 2, 18, COBBLESTONE); c.set(19, gy + 2, 20, COBBLESTONE);
    c.set(19, gy + 3, 18, TORCH); c.set(19, gy + 3, 20, TORCH);
    for (const x of [24, 26, 34, 36]) { c.set(x, gy + 1, 28, FLOWER); c.set(x, gy + 1, 30, FLOWER); }
    tree(c, 16, gy, 30); tree(c, 43, gy, 30);
    c.fill(40, gy + 1, 22, 41, gy + 2, 22, PLANKS); // 演武木架
    c.set(41, gy + 2, 21, WOOL);
    torchPost(c, 22, gy, 24); torchPost(c, 38, gy, 24);

    // ---- 星辉塔（庭院西南，星辉门=半截门，内有钻石彩蛋） ----
    c.fill(14, gy + 1, 16, 17, gy + 12, 19, BRICK);
    c.clear(15, gy + 1, 17, 16, gy + 10, 18); // 塔内腔
    c.clear(15, gy + 1, 19, 15, gy + 2, 19);  // 南墙开口（1 宽 2 高）
    c.set(15, gy + 1, 19, STARLIGHT_BASE);    // 星辉门锁下半，上半留空=半截门
    c.set(14, gy + 3, 19, TORCH);             // 门口墙面火把
    c.set(16, gy + 6, 19, GLASS);             // 塔面小窗
    c.set(15, gy + 1, 17, DIAMOND_ORE);       // 塔内宝藏堆
    c.set(16, gy + 1, 17, DIAMOND_ORE);
    c.set(15, gy + 2, 17, DIAMOND_ORE);
    c.set(16, gy + 1, 18, TORCH);
    crenels(c, 14, 16, 17, 19, gy + 13, BRICK);

    // ---- 主楼（x26..34, z18..26：一层大厅 + 二层王座厅 + 可上屋顶） ----
    const K = { x0: 26, x1: 34, z0: 18, z1: 26 };
    const F1T = gy + 7;  // 一层楼板（y=10）
    const F2T = gy + 12; // 二层楼板/屋顶（y=15）
    c.fill(K.x0, gy + 1, K.z0, K.x1, F2T - 1, K.z1, COBBLESTONE);      // 实心毛坯
    c.clear(K.x0 + 1, gy + 1, K.z0 + 1, K.x1 - 1, F1T - 1, K.z1 - 1);  // 一层内腔
    c.fill(K.x0, F1T, K.z0, K.x1, F1T, K.z1, PLANKS);                  // 楼板
    c.clear(K.x0 + 1, F1T + 1, K.z0 + 1, K.x1 - 1, F2T - 1, K.z1 - 1); // 二层内腔
    c.fill(K.x0, F2T, K.z0, K.x1, F2T, K.z1, PLANKS);                  // 屋顶
    crenels(c, K.x0, K.z0, K.x1, K.z1, F2T + 1);
    // 一层南墙：门 + 答题机（科学）+ 窗；门前两支迎宾火把照亮门脸
    c.clear(30, gy + 1, K.z0, 30, gy + 2, K.z0);
    doorway(c, { x: 30, z: K.z0, y0: gy + 1, facing: 2 }, { x: 29, y: gy + 1, z: K.z0 });
    c.set(28, gy + 1, K.z0 - 1, TORCH);
    c.set(32, gy + 1, K.z0 - 1, TORCH);
    for (const x of [27, 28, 32, 33]) { c.set(x, gy + 3, K.z0, GLASS); c.set(x, gy + 3, K.z1, GLASS); }
    // 一层内饰：长桌、工作角、火把
    c.fill(29, gy + 1, 21, 31, gy + 1, 21, PLANKS);
    c.set(29, gy + 2, 21, TORCH);
    c.set(K.x0 + 1, gy + 1, K.z1 - 1, CRAFTING_TABLE);
    c.set(K.x0 + 2, gy + 1, K.z1 - 1, FURNACE);
    c.set(K.x1 - 1, gy + 1, K.z1 - 1, TORCH);
    c.set(K.x0 + 3, gy + 4, K.z0 + 1, TORCH); // 大厅吊壁火把
    // 一层隔墙（大厅→楼梯厅，封到楼板）：门 + 答题机（语文）
    c.fill(K.x0 + 1, gy + 1, 22, K.x1 - 1, F1T - 1, 22, BRICK);
    c.clear(30, gy + 1, 22, 30, gy + 2, 22);
    doorway(c, { x: 30, z: 22, y0: gy + 1, facing: 2 }, { x: 29, y: gy + 1, z: 22 });
    c.set(31, gy + 1, 22, TORCH);
    // 一层→二层楼梯（z=23 一排逐格 +1，楼板洞开在末两级头顶 2 宽）
    const stair1 = [[27, gy + 1], [28, gy + 2], [29, gy + 3], [30, gy + 4], [31, gy + 5], [32, gy + 6]];
    for (const [sx, sy] of stair1) c.set(sx, sy, 23, COBBLESTONE);
    c.set(31, F1T, 23, AIR); c.set(32, F1T, 23, AIR); // 楼板洞
    // 二层王座厅：红毯 + 王座 + 终点旗
    c.fill(29, F1T + 1, 22, 31, F1T + 1, 24, WOOL);
    c.set(30, F1T + 1, K.z1 - 1, COBBLESTONE);
    c.set(30, F1T + 2, K.z1 - 1, COBBLESTONE);
    c.set(29, F1T + 1, K.z1 - 1, TORCH);
    c.set(31, F1T + 1, K.z1 - 1, TORCH);
    c.set(27, F1T + 3, K.z0 + 1, TORCH);
    c.set(33, F1T + 3, K.z0 + 1, TORCH);
    flagAt(c, 30, F1T + 1, 23, FLAG_GOAL); // 旗立红毯上
    flagAt(c, 30, gy, 20, FLAG_CHECKPOINT); // 检查点：一层大厅（进主楼后）
    // 二层→屋顶楼梯（z=19 一排，屋顶洞 2 宽）
    const stair2 = [[27, F1T + 1], [28, F1T + 2], [29, F1T + 3], [30, F1T + 4]];
    for (const [sx, sy] of stair2) c.set(sx, sy, 19, COBBLESTONE);
    c.set(29, F2T, 19, AIR); c.set(30, F2T, 19, AIR); // 屋顶洞
    c.set(26, F2T + 1, 21, TORCH); // 屋顶火把

    // 检查点：一层楼梯厅（进主楼后）
    return {
        name: '星辉城堡',
        canvas: c,
        rules: { timeLimit: 600, lockAIHelp: true },
        flags: {
            start: { x: 30, y: gy + 1, z: 47 },
            checkpoints: [{ x: 30, y: gy + 1, z: 33 }, { x: 30, y: gy + 1, z: 20 }],
            goal: { x: 30, y: F1T + 2, z: 23 },
        },
        questions: [
            inputQ({ x: 29, y: WY0, z: 36 }, '6×7−12 = ?', 30, '三上·混合运算', '先算 6×7=42，再减 12'),
            choiceQ({ x: 29, y: gy + 1, z: K.z0 }, 'science', '空气也占据空间吗？',
                ['占据', '不占据', '只有在水中才占据', '空气看不见，没法研究'], 0,
                '三上·空气', '空气和石头一样占据空间——杯子倒扣压进水里，纸团不会湿'),
            choiceQ({ x: 29, y: gy + 1, z: 22 }, 'yuwen', '「停车坐爱枫林晚，霜叶红于二月花」出自哪首诗？',
                ['《山行》', '《望天门山》', '《采莲曲》', '《夜书所见》'], 0,
                '三上·古诗', '杜牧《山行》：秋天的枫叶红得比二月的花还艳'),
        ],
    };
}

// ==================== L3 地牢寻宝记（环带山体地道 + 岔路 + 出山宝藏院） ====================

function buildDungeon() {
    const c = new Canvas(52, 20, 52);
    const gy = 3;
    ground(c, gy);
    borderWall(c, gy, STONE);
    // 环带山体（三环台阶山，嵌入煤与沙砾）：外环 y≤6 / 中环 y≤9 / 山芯 y≤12
    const oreSpeck = (x, y, z) => {
        const h = (x * 7 + z * 13 + y * 5) % 23;
        return h === 0 ? COAL_ORE : h === 7 ? GRAVEL : STONE;
    };
    for (let x = 14; x <= 37; x++) for (let z = 10; z <= 38; z++) for (let y = gy + 1; y <= gy + 3; y++) c.set(x, y, z, oreSpeck(x, y, z));
    for (let x = 17; x <= 34; x++) for (let z = 13; z <= 35; z++) for (let y = gy + 1; y <= gy + 6; y++) c.set(x, y, z, oreSpeck(x, y, z));
    for (let x = 20; x <= 31; x++) for (let z = 16; z <= 32; z++) for (let y = gy + 1; y <= gy + 9; y++) c.set(x, y, z, oreSpeck(x, y, z));
    const cobbleFloor = (x0, z0, x1, z1) => c.fill(x0, gy, z0, x1, gy, z1, COBBLESTONE);

    flagAt(c, 26, gy, 44, FLAG_START);
    tree(c, 16, gy, 42); tree(c, 36, gy, 43);
    torchPost(c, 22, gy, 42); torchPost(c, 30, gy, 42);

    // ---- 入口甬道 + 前厅（山芯内） ----
    c.clear(25, gy + 1, 34, 27, gy + 3, 38);
    cobbleFloor(25, 34, 27, 38);
    c.clear(22, gy + 1, 27, 30, gy + 4, 33);
    cobbleFloor(22, 27, 30, 33);
    c.set(23, gy + 1, 32, TORCH);
    c.set(29, gy + 1, 32, TORCH);

    // ---- G1（前厅→岔路厅，年月日） ----
    doorway(c, { x: 26, z: 26, y0: gy + 1, facing: 2 }, { x: 25, y: gy + 1, z: 26 });
    c.set(27, gy + 1, 26, TORCH);

    // ---- 岔路厅 ----
    c.clear(22, gy + 1, 19, 29, gy + 4, 25);
    cobbleFloor(22, 19, 29, 25);
    flagAt(c, 26, gy, 22, FLAG_CHECKPOINT);
    c.set(23, gy + 1, 20, TORCH);
    c.set(28, gy + 1, 20, TORCH);

    // ---- 西支·补给房（检查点旗 + 羊毛补给，死路但值得绕） ----
    c.clear(17, gy + 1, 20, 21, gy + 4, 24);
    cobbleFloor(17, 20, 21, 24);
    flagAt(c, 18, gy, 22, FLAG_CHECKPOINT);
    c.fill(17, gy + 1, 20, 18, gy + 1, 21, WOOL);
    c.set(18, gy + 2, 20, TORCH);
    c.set(20, gy + 1, 23, TORCH);

    // ---- 东支·星辉彩蛋房（超纲题开半截门，第二堆钻石） ----
    c.clear(31, gy + 1, 20, 34, gy + 4, 24);
    cobbleFloor(31, 20, 34, 24);
    c.set(30, gy + 1, 22, STARLIGHT_BASE); // 山芯隔墙 x30 上的半截门
    c.clear(30, gy + 2, 22, 30, gy + 2, 22);
    c.set(32, gy + 1, 21, DIAMOND_ORE);
    c.set(33, gy + 1, 22, DIAMOND_ORE);
    c.set(32, gy + 2, 21, DIAMOND_ORE);
    c.set(34, gy + 1, 20, TORCH);
    c.set(33, gy + 1, 24, TORCH);

    // ---- G2（岔路厅→甬道，安全常识） ----
    // 甬道分两段挖：北段（z10..12）在外环带里只挖 2 高，保住 y6 层当屋顶（G3 门正好嵌在里面）；
    // 中段（z13..17）在中环带里挖 3 高
    c.clear(26, gy + 1, 10, 26, gy + 2, 12);
    c.clear(26, gy + 1, 13, 26, gy + 3, 17);
    cobbleFloor(26, 10, 26, 17);
    doorway(c, { x: 26, z: 18, y0: gy + 1, facing: 2 }, { x: 25, y: gy + 1, z: 18 });
    c.set(27, gy + 1, 18, TORCH);

    // ---- G3（甬道中段，英语词汇）——门在 2 高段里，上方是外环屋顶 ----
    doorway(c, { x: 26, z: 11, y0: gy + 1, facing: 2 }, { x: 25, y: gy + 1, z: 11 });

    // ---- 出山宝藏院（露天石墙院：钻石堆 + 终点旗） ----
    c.fill(20, gy + 1, 3, 31, gy + 3, 3, COBBLESTONE); // 北墙
    c.fill(20, gy + 1, 4, 20, gy + 3, 9, COBBLESTONE); // 西墙
    c.fill(31, gy + 1, 4, 31, gy + 3, 9, COBBLESTONE); // 东墙
    c.fill(22, gy + 1, 5, 23, gy + 2, 6, DIAMOND_ORE);
    c.fill(29, gy + 1, 5, 30, gy + 2, 6, DIAMOND_ORE);
    c.set(21, gy + 1, 8, TORCH);
    c.set(31, gy + 1, 8, TORCH);
    c.set(26, gy + 4, 3, TORCH);
    flagAt(c, 26, gy, 6, FLAG_GOAL);

    return {
        name: '地牢寻宝记',
        canvas: c,
        rules: { timeLimit: 480, lockAIHelp: true },
        flags: {
            start: { x: 26, y: gy + 1, z: 44 },
            checkpoints: [{ x: 26, y: gy + 1, z: 22 }, { x: 18, y: gy + 1, z: 22 }],
            goal: { x: 26, y: gy + 1, z: 6 },
        },
        questions: [
            inputQ({ x: 25, y: gy + 1, z: 26 }, '1 年有几个月？', 12, '三上·年月日', '1 年 = 12 个月'),
            choiceQ({ x: 25, y: gy + 1, z: 18 }, 'daofa', '发现火灾时，应该拨打的报警电话是？',
                ['110', '119', '120', '122'], 1,
                '三上·安全常识', '火警 119、匪警 110、急救 120，记牢别拨错'),
            choiceQ({ x: 25, y: gy + 1, z: 11 }, 'english', '「castle」的意思是？',
                ['城堡', '草地', '河流', '教室'], 0,
                '英语·词汇', 'castle = 城堡（星辉城堡里你刚见过一座）'),
        ],
    };
}

// ==================== L4 云间跳跳乐（浮岛跑酷：跳跳+玻璃桥+答题门+胜利蹦床） ====================

function buildSkypark() {
    const c = new Canvas(56, 24, 40);
    const T = 10; // 岛顶面高度（站立面 y=T+1）

    const island = (x0, z0, x1, z1) => {
        c.fill(x0, T, z0, x1, T, z1, GRASS);
        c.fill(x0, T - 1, z0, x1, T - 1, z1, DIRT);
        c.fill(x0, T - 2, z0, x1, T - 2, z1, STONE);
    };

    island(4, 16, 12, 24); // A 起点岛
    flagAt(c, 8, T, 20, FLAG_START);
    c.set(5, T + 1, 17, TORCH);
    tree(c, 11, T, 23);

    island(15, 17, 19, 23); // B
    c.set(17, T + 1, 18, FLOWER);

    island(22, 12, 26, 18); // C（北侧错位）
    c.set(24, T + 1, 14, FLOWER);
    torchPost(c, 25, T, 17);

    island(29, 16, 33, 22); // D 检查点岛
    flagAt(c, 31, T, 19, FLAG_CHECKPOINT);
    c.set(29, T + 1, 17, TORCH);

    // D→E 玻璃独木桥（1 宽 2 长）
    c.set(34, T, 19, GLASS);
    c.set(35, T, 19, GLASS);

    island(36, 16, 40, 22); // E 关卡岛：横墙 + 门 + 答题机
    c.fill(38, T + 1, 16, 38, T + 2, 22, COBBLESTONE);
    c.clear(38, T + 1, 19, 38, T + 2, 19);
    doorway(c, { x: 38, z: 19, y0: T + 1, facing: 3 }, { x: 38, y: T + 1, z: 18 });
    c.set(38, T + 3, 19, COBBLESTONE); // 门洞上方封一块（拱门，也防跳门）
    crenels(c, 38, 16, 38, 18, T + 3);
    crenels(c, 38, 20, 38, 22, T + 3);

    island(43, 15, 51, 25); // F 终点岛
    c.set(46, T + 1, 20, STONE); // 旗台
    flagAt(c, 46, T + 1, 20, FLAG_GOAL);
    c.fill(44, T, 22, 46, T, 23, SLIME); // 胜利蹦床
    c.fill(49, T + 1, 17, 49, T + 2, 17, PLANKS); // 奖杯火把柱
    c.set(49, T + 3, 17, TORCH);
    c.set(44, T + 1, 16, FLOWER);
    c.set(50, T + 1, 24, FLOWER);
    c.set(43, T + 1, 20, TORCH);

    return {
        name: '云间跳跳乐',
        canvas: c,
        rules: { timeLimit: 300, lockAIHelp: true },
        flags: {
            start: { x: 8, y: T + 1, z: 20 },
            checkpoints: [{ x: 31, y: T + 1, z: 19 }],
            goal: { x: 46, y: T + 2, z: 20 },
        },
        questions: [
            inputQ({ x: 38, y: T + 1, z: 18 }, '18÷3+4×2 = ?', 14, '三上·混合运算', '先乘除后加减：18÷3=6，4×2=8，6+8=14'),
        ],
    };
}

// ==================== 组卡 + 校验 + 落盘 ====================

function buildCard(spec) {
    const c = spec.canvas;
    const region = {
        x0: 0, y0: 0, z0: 0, w: c.w, h: c.h, d: c.d,
        enc: 'rle',
        blocks: u8ToBase64(rleEncode(c.b)),
    };
    return {
        format: LEVEL_CARD_FORMAT,
        name: spec.name,
        author: AUTHOR,
        created: CREATED,
        version: 1,
        region,
        questions: spec.questions,
        rules: spec.rules,
        flags: spec.flags,
    };
}

function main() {
    const specs = [
        ['warmup.level.json', buildWarmup()],
        ['castle.level.json', buildCastle()],
        ['dungeon.level.json', buildDungeon()],
        ['skypark.level.json', buildSkypark()],
    ];
    mkdirSync(OUT_DIR, { recursive: true });
    const manifest = [];
    let failed = 0;

    for (const [file, spec] of specs) {
        const card = buildCard(spec);
        const v = validateLevelCard(card);
        const bfs = reachabilityBFS(card);
        const problems = [
            ...v.errors.map((e) => `error: ${e}`),
            ...v.warnings.map((w) => `warning: ${w}`),
            ...(bfs.reachable ? [] : [`BFS 不可达: ${bfs.missing.join('、')}`]),
        ];
        if (problems.length) {
            failed++;
            console.error(`✗ ${spec.name}（${file}）`);
            for (const p of problems) console.error(`   ${p}`);
            continue;
        }
        writeFileSync(join(OUT_DIR, file), JSON.stringify(card), 'utf8');
        manifest.push({ file, name: card.name });
        const kb = (JSON.stringify(card).length / 1024).toFixed(1);
        console.log(`✓ ${spec.name}（${file}）locks=${card.questions.length} cps=${card.flags.checkpoints.length} ${kb}KB hash=${cardHash(card)}`);
    }
    if (failed) {
        console.error(`\n${failed} 张卡未通过校验，拒绝写出 index.json`);
        process.exit(1);
    }
    writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify({
        note: '内置关卡清单：file 相对 assets/levels/；顺序即首屏列表顺序。重新生成请跑 tools/gen_builtin_levels.mjs',
        levels: manifest,
    }, null, 2) + '\n', 'utf8');
    console.log(`\n共 ${manifest.length} 张卡 → assets/levels/index.json`);
}

main();
