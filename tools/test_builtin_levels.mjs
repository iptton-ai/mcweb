// ==================== test_builtin_levels.mjs ====================
// 内置关卡（assets/levels/*.level.json）Node 自测：node:test，`node tools/test_builtin_levels.mjs` 直跑。
// 除 schema 校验（validateLevelCard）外，重点验证「物理设计」不变量：
//   ① 每道门洞上方封死（不能跳门）②门墙整行无绕行漏洞 ③每把锁紧贴门（W04 供电接线）
//   ④旗组/题目坐标与区域快照逐格对得上 ⑤embedLevelToWorld 嵌入后出生点落在实体地面上
// 生成器：tools/gen_builtin_levels.mjs（改完关卡先重跑生成再跑本测试）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    BlockTypes,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    flagKind,
    isDoorId,
    isFlagId,
    isKeypadId,
    doorOpen,
    keypadSolved,
    lampId,
} from '../js/config.js';
import { state } from '../js/state.js';
import {
    LEVEL_CARD_FORMAT,
    cardHash,
    decodeRegionBlocks,
    embedLevelToWorld,
    listBuiltinLevelCards,
    localToWorld,
    reachabilityBFS,
    validateLevelCard,
} from '../js/levelWorkshop.js';
import { lockedSequenceCheck } from './builtin_levels/_lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets', 'levels');

const manifest = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
const cards = {}; // name -> card
for (const entry of manifest.levels) {
    const card = JSON.parse(readFileSync(join(DIR, entry.file), 'utf8'));
    cards[card.name] = card;
}
// 老四关显式点名（特化断言引用）；全部关卡以 index.json 为准动态覆盖
const NAMED = ['村口热身赛', '星辉城堡', '地牢寻宝记', '云间跳跳乐'];
const ALL_NAMES = manifest.levels.map((e) => e.name);
assert.ok(NAMED.every((n) => ALL_NAMES.includes(n)), 'index.json 必须包含老四关');

// ---- 画布读取助手：解码区域快照为带下标访问的视图 ----
function viewOf(card) {
    const dec = decodeRegionBlocks(card);
    assert.ok(!dec.error, `区域快照可解码：${dec.error || 'ok'}`);
    const { blocks } = dec;
    const r = card.region;
    return {
        r,
        get: (x, y, z) => {
            if (x < 0 || y < 0 || z < 0 || x >= r.w || y >= r.h || z >= r.d) return BlockTypes.AIR;
            return blocks[x + z * r.w + y * r.w * r.d];
        },
    };
}

const isSolidId = (id) => id !== BlockTypes.AIR && id !== BlockTypes.WATER && !isDoorId(id) && !isFlagId(id);

test('清单与文件：格式正确、确定性哈希稳定、无重名', () => {
    assert.ok(ALL_NAMES.length >= 14, `官方关卡至少 14 张（实为 ${ALL_NAMES.length}）`);
    assert.equal(new Set(ALL_NAMES).size, ALL_NAMES.length, '关卡名不得重复');
    for (const name of ALL_NAMES) {
        const card = cards[name];
        assert.equal(card.format, LEVEL_CARD_FORMAT);
        assert.equal(card.version, 1);
        // 重读同一文件两次哈希一致（cardHash 对 region.blocks+questions+rules+flags 稳定）
        assert.equal(cardHash(card), cardHash(JSON.parse(JSON.stringify(card))));
    }
});

for (const name of ALL_NAMES) {
    test(`schema 校验零错误零警告：${name}`, () => {
        const v = validateLevelCard(cards[name]);
        assert.deepEqual(v.errors, []);
        assert.deepEqual(v.warnings, []); // 官方关卡必须干净：连 BFS 警告都不许有
        const bfs = reachabilityBFS(cards[name]);
        assert.equal(bfs.reachable, true);
        assert.deepEqual(bfs.missing, []);
    });
}

for (const name of ALL_NAMES) {
    test(`全封锁防绕行 + 解锁序（重力感知站格 BFS）：${name}`, () => {
        const locked = lockedSequenceCheck(cards[name]);
        assert.deepEqual(locked.problems, [], '不答题不得直通终点；锁序不得死锁');
    });
}

test('运行时加载器：Node 无页面环境时安静降级为空数组', async () => {
    const list = await listBuiltinLevelCards(); // Node 里 fetch 相对 URL 会抛错 → 降级
    assert.deepEqual(list, []);
});

for (const name of ALL_NAMES) {
    test(`锁具接线与门墙防绕行：${name}`, () => {
        const card = cards[name];
        const v = viewOf(card);
        // ① 每把锁：锁定态答题机 + 头顶红石灯 + 紧贴一扇关门（W04 供电模式）+ 双通过
        //    （远程红石布线/活塞闸门锁例外：卡 meta.lockDoorHints 登记了 锁→门 映射，跳过贴门断言；
        //     hint 门位的正确性由 lockedSequenceCheck 的解锁序模拟覆盖）
        const doorHints = (card.meta && card.meta.lockDoorHints) || [];
        for (const q of card.questions) {
            const kp = v.get(q.x, q.y, q.z);
            assert.ok(isKeypadId(kp) && keypadSolved(kp) === 0,
                `锁 (${q.x},${q.y},${q.z}) 处应是锁定态答题机，实为 ${kp}`);
            assert.equal(v.get(q.x, q.y + 1, q.z), lampId(0), `锁头顶应有红石灯`);
            const hinted = doorHints.some((h) => h.key[0] === q.x && h.key[1] === q.y && h.key[2] === q.z);
            if (!hinted) {
                const adjDoor = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
                    .some(([dx, dy, dz]) => {
                        const id = v.get(q.x + dx, q.y + dy, q.z + dz);
                        return isDoorId(id) && doorOpen(id) === 0;
                    });
                assert.ok(adjDoor, `锁 (${q.x},${q.y},${q.z}) 必须紧贴一扇关门（答对→红石源→开门）`);
            }
            assert.ok((q.meta?.verifiedPasses | 0) >= 2, '官方锁必须自带双通过计数');
        }
        // ② 每扇门：上半格头顶封死（门口 2 格净高，上方不许是空气——防跳门）
        for (let y = 0; y < v.r.h - 1; y++) {
            for (let z = 0; z < v.r.d; z++) {
                for (let x = 0; x < v.r.w; x++) {
                    const id = v.get(x, y, z);
                    if (!isDoorId(id)) continue;
                    const above = v.get(x, y + 1, z);
                    assert.ok(above !== BlockTypes.AIR,
                        `门 (${x},${y},${z}) 上方漏空气，可被跳过`);
                }
            }
        }
    });
}

test('旗组与卡面坐标逐格对得上（含旗类型）', () => {
    for (const name of ALL_NAMES) {
        const card = cards[name];
        const v = viewOf(card);
        const kindAt = (p) => {
            const id = v.get(p.x, p.y, p.z);
            return isFlagId(id) ? flagKind(id) : -1;
        };
        assert.equal(kindAt(card.flags.start), FLAG_START, `${name} 起点旗`);
        assert.equal(kindAt(card.flags.goal), FLAG_GOAL, `${name} 终点旗`);
        for (const cp of card.flags.checkpoints) {
            assert.equal(kindAt(cp), FLAG_CHECKPOINT, `${name} 检查点旗 (${cp.x},${cp.y},${cp.z})`);
        }
        // 全区域只有卡面登记的这些旗
        let found = 0;
        for (let y = 0; y < v.r.h; y++)
            for (let z = 0; z < v.r.d; z++)
                for (let x = 0; x < v.r.w; x++)
                    if (isFlagId(v.get(x, y, z))) found++;
        assert.equal(found, 1 + 1 + card.flags.checkpoints.length, `${name} 旗总数`);
    }
});

test('关卡清单：锁数/检查点数与设计稿一致', () => {
    assert.equal(cards['村口热身赛'].questions.length, 2);
    assert.equal(cards['村口热身赛'].rules.timeLimit, null);
    assert.equal(cards['星辉城堡'].questions.length, 3);
    assert.equal(cards['星辉城堡'].rules.timeLimit, 600);
    assert.equal(cards['地牢寻宝记'].questions.length, 3);
    assert.equal(cards['云间跳跳乐'].questions.length, 1);
    for (const name of ALL_NAMES) {
        assert.ok(cards[name].questions.length >= 1, `${name} 至少一把锁`);
        assert.equal(cards[name].rules.lockAIHelp, true);
    }
});

// ---- 门墙整行防绕行断言：墙线上不允许出现「连续 2 格可穿」的洞（1 格高缺口人钻不过，
//      壁炬/箭窗所在的单元格不算漏洞；门洞格子由 gapCells 豁免）----
function assertWallLine(v, label, fixed, y0, y1, cells, gapCells) {
    const passable = (id) => !isSolidId(id);
    for (const c of cells) {
        for (let y = y0; y <= y1 - 1; y++) {
            const [x, z] = fixed.axis === 'x' ? [fixed.at, c] : [c, fixed.at];
            if (gapCells.some(([gx, gz]) => gx === x && gz === z)) continue;
            const a = v.get(x, y, z);
            const b = v.get(x, y + 1, z);
            assert.ok(!(passable(a) && passable(b)),
                `${label} (${x},${y},${z}) 连续 2 格可穿——绕行漏洞`);
        }
    }
}

test('星辉城堡：三道门墙无绕行 + 楼梯几何正确 + 星辉塔彩蛋存在', () => {
    const card = cards['星辉城堡'];
    const v = viewOf(card);
    // 城门墙（z=36）、主楼南墙（z=18）、一层隔墙（z=22）
    assertWallLine(v, '城墙z36', { axis: 'z', at: 36 }, 4, 5,
        [...Array(36).keys()].map((i) => i + 12), [[30, 36]]);
    assertWallLine(v, '主楼南墙z18', { axis: 'z', at: 18 }, 4, 5,
        [...Array(9).keys()].map((i) => i + 26), [[30, 18]]);
    assertWallLine(v, '隔墙z22', { axis: 'z', at: 22 }, 4, 9,
        [...Array(7).keys()].map((i) => i + 27), [[30, 22]]);
    // 一层→二层楼梯：六级台阶 +1，楼板洞在末两级头顶
    const steps = [[27, 4], [28, 5], [29, 6], [30, 7], [31, 8], [32, 9]];
    for (const [x, y] of steps) assert.equal(v.get(x, y, 23), BlockTypes.COBBLESTONE, `台阶 (${x},${y},23)`);
    for (const [x, y] of steps) assert.equal(v.get(x, y + 1, 23), BlockTypes.AIR, `台阶头顶净空 (${x},${y + 1},23)`);
    assert.equal(v.get(31, 10, 23), BlockTypes.AIR, '楼板洞①');
    assert.equal(v.get(32, 10, 23), BlockTypes.AIR, '楼板洞②');
    assert.equal(v.get(33, 10, 23), BlockTypes.PLANKS, '洞旁楼板可落足');
    // 星辉塔：锁定星辉门 + 上半格空气（半截门）+ 塔内钻石
    assert.equal(v.get(15, 4, 19), 232, '星辉门锁定变体（STARLIGHT_BASE）');
    assert.equal(v.get(15, 5, 19), BlockTypes.AIR, '半截门上半格留空');
    assert.equal(v.get(15, 4, 17), BlockTypes.DIAMOND_ORE, '塔内钻石彩蛋');
});

test('地牢寻宝记：三道门墙无绕行 + 星辉半截门存在', () => {
    const card = cards['地牢寻宝记'];
    const v = viewOf(card);
    assertWallLine(v, 'G1墙z26', { axis: 'z', at: 26 }, 4, 5,
        [...Array(9).keys()].map((i) => i + 22), [[26, 26]]);
    assertWallLine(v, 'G2墙z18', { axis: 'z', at: 18 }, 4, 5,
        [...Array(8).keys()].map((i) => i + 22), [[26, 18]]);
    // G3：甬道两壁夹门
    for (const [x, z] of [[25, 11], [27, 11]]) {
        for (let y = 4; y <= 5; y++) assert.ok(isSolidId(v.get(x, y, z)), `G3 侧壁 (${x},${y},${z})`);
    }
    assert.equal(v.get(30, 4, 22), 232, '星辉门锁定变体');
    assert.equal(v.get(30, 5, 22), BlockTypes.AIR, '半截门上半格留空');
});

test('村口热身赛：两道墙门贯穿全深防绕行', () => {
    const card = cards['村口热身赛'];
    const v = viewOf(card);
    for (const wx of [16, 30]) {
        assertWallLine(v, `墙x${wx}`, { axis: 'x', at: wx }, 4, 5,
            [...Array(card.region.d).keys()], [[wx, 15]]);
    }
});

test('云间跳跳乐：关卡墙门无绕行 + 终点蹦床存在', () => {
    const card = cards['云间跳跳乐'];
    const v = viewOf(card);
    assertWallLine(v, 'E岛墙x38', { axis: 'x', at: 38 }, 11, 12,
        [...Array(7).keys()].map((i) => i + 16), [[38, 19]]);
    assert.equal(v.get(45, 10, 22), BlockTypes.SLIME, '胜利蹦床（粘液块）');
});

// ---- 嵌入验证：清零+基岩 → embed → 出生点/落足面/关键块落位 ----
function resetWorld() {
    state.blocks = new Uint8Array(WORLD_WIDTH * WORLD_DEPTH * WORLD_HEIGHT);
    for (let x = 0; x < WORLD_WIDTH; x++)
        for (let z = 0; z < WORLD_DEPTH; z++)
            state.blocks[x + z * WORLD_WIDTH] = BlockTypes.BEDROCK; // y=0
}

for (const name of ALL_NAMES) {
    test(`嵌入临时世界：${name}`, () => {
        resetWorld();
        const card = cards[name];
        const res = embedLevelToWorld(card);
        assert.ok(!res.error, `嵌入成功：${res.error || 'ok'}`);
        const spawn = localToWorld(card.flags.start.x, card.flags.start.y, card.flags.start.z);
        assert.deepEqual(res.spawn, spawn);
        // 出生旗脚下一格是实心地面（enterLevel 把玩家放在旗位，落地后站在此面上）
        const gi = spawn.x + spawn.z * WORLD_WIDTH + (spawn.y - 1) * WORLD_WIDTH * WORLD_DEPTH;
        assert.ok(state.blocks[gi] !== BlockTypes.AIR && state.blocks[gi] !== BlockTypes.BEDROCK,
            `出生点旗下方应为实体地面，实为 ${state.blocks[gi]}`);
        // 区域外保持空气（四周空气带）；基岩层原样
        const oob = localToWorld(card.region.w + 1, 1, card.region.d + 1);
        assert.equal(state.blocks[oob.x + oob.z * WORLD_WIDTH + oob.y * WORLD_WIDTH * WORLD_DEPTH], BlockTypes.AIR, '区域外空气带');
        // 首把锁的世界坐标处就是答题机
        const q = card.questions[0];
        const qw = localToWorld(q.x, q.y, q.z);
        const qi = qw.x + qw.z * WORLD_WIDTH + qw.y * WORLD_WIDTH * WORLD_DEPTH;
        assert.ok(isKeypadId(state.blocks[qi]), '嵌入后锁位=答题机');
    });
}
