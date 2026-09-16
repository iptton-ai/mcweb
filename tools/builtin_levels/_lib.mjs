// ==================== builtin_levels/_lib.mjs ====================
// 内置关卡生成公共库：从 tools/gen_builtin_levels.mjs 抽出的画布/结构/题目工具 +
// 「全封锁防绕行 + 解锁序」校验器（lockedSequenceBFS）。
// 新增关卡 = 本目录新建 level_<编号>_<slug>.mjs，export const LEVEL_FILE + export function buildLevel()
//（返回 spec：{name, canvas, rules, flags, questions, lockDoorHints?}），文件末尾挂自测入口：
//   if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
// 然后跑 `node tools/builtin_levels/level_<编号>_<slug>.mjs` 自测全绿、再 `node tools/gen_builtin_levels.mjs`。

import {
    BlockTypes,
    BlockInfo,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    FLAG_START,
    KEYPAD_BASE,
    STARLIGHT_BASE,
    flagId,
    doorId,
    lampId,
    isDoorId,
    isFlagId,
    isKeypadId,
    isStarlightId,
    doorOpen,
} from '../../js/config.js';
import { rleEncode } from '../../js/rle.js';
import {
    LEVEL_CARD_FORMAT,
    decodeRegionBlocks,
    reachabilityBFS,
    u8ToBase64,
    validateLevelCard,
} from '../../js/levelWorkshop.js';

export const AUTHOR = 'MCWeb 学院';
export const CREATED = '2026-09-15T09:00:00.000Z'; // 固定时间戳：确定性输出

const { AIR, WATER } = BlockTypes;

// ==================== 画布与结构小工具 ====================

// 局部方块画布：内存序与区域快照一致 decoded[lx + lz*w + ly*w*d]（x 最快）
export class Canvas {
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
export function ground(c, gy) {
    c.fill(0, 0, 0, c.w - 1, gy - 1, c.d - 1, BlockTypes.DIRT);
    c.fill(0, gy, 0, c.w - 1, gy, c.d - 1, BlockTypes.GRASS);
}

// 区域边框矮墙（2 高跳不上，防走出嵌入区域边缘摔进虚空）
export function borderWall(c, gy, mat) {
    c.fill(0, gy + 1, 0, c.w - 1, gy + 2, 0, mat);
    c.fill(0, gy + 1, c.d - 1, c.w - 1, gy + 2, c.d - 1, mat);
    c.fill(0, gy + 1, 0, 0, gy + 2, c.d - 1, mat);
    c.fill(c.w - 1, gy + 1, 0, c.w - 1, gy + 2, c.d - 1, mat);
}

// 树：原木杆 + 方球树冠（削角）
export function tree(c, x, gy, z) {
    const { LEAVES, LOG } = BlockTypes;
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
export function torchPost(c, x, gy, z) {
    c.set(x, gy + 1, z, BlockTypes.COBBLESTONE);
    c.set(x, gy + 2, z, BlockTypes.COBBLESTONE);
    c.set(x, gy + 3, z, BlockTypes.TORCH);
}

// 一排城齿（墙顶 alternating）
export function crenels(c, x0, z0, x1, z1, y, mat = BlockTypes.COBBLESTONE) {
    let alt = 0;
    for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
            c.set(x, y, z, (alt++ % 2 === 0) ? mat : AIR);
}

// 完整门洞（在既有墙体上开 1 宽 2 高 + 装门）+ 贴门答题机 + 头顶红石灯。
// opening = {x, z, y0, facing}：门洞列；keypad = {x,y,z}：洞旁 1 格（会覆写墙块）。
export function doorway(c, opening, keypad) {
    c.set(opening.x, opening.y0, opening.z, doorId(0, 0, opening.facing));
    c.set(opening.x, opening.y0 + 1, opening.z, doorId(1, 0, opening.facing));
    c.set(keypad.x, keypad.y, keypad.z, KEYPAD_BASE);
    c.set(keypad.x, keypad.y + 1, keypad.z, lampId(0));
}

// 旗：立在地面 gy 之上 1 格
export function flagAt(c, x, gy, z, kind) {
    c.set(x, gy + 1, z, flagId(kind));
}

// 星辉门（半截门）：锁定变体放门洞下半、上半留空=可答超纲题的彩蛋门
export function starlightHalfDoor(c, x, y, z) {
    c.set(x, y, z, STARLIGHT_BASE);
    c.set(x, y + 1, z, AIR);
}

// ==================== 题目助手（自拟·三上对齐，带双通过计数） ====================

export function inputQ(p, stem, answer, unit, hint) {
    return {
        lockType: 'keypad', x: p.x, y: p.y, z: p.z,
        subject: 'math', kind: 'input', stem, answer,
        hint, unit,
        meta: { source: 'custom', verifiedPasses: 2 },
    };
}
export function choiceQ(p, subject, stem, options, answer, unit, hint) {
    return {
        lockType: 'keypad', x: p.x, y: p.y, z: p.z,
        subject, kind: 'choice', stem, options, answer,
        hint, unit,
        meta: { source: 'custom', verifiedPasses: 2 },
    };
}

// ==================== spec → 卡片 ====================

export function buildCard(spec) {
    const c = spec.canvas;
    const region = {
        x0: 0, y0: 0, z0: 0, w: c.w, h: c.h, d: c.d,
        enc: 'rle',
        blocks: u8ToBase64(rleEncode(c.b)),
    };
    const card = {
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
    // 远程布线/活塞闸门等非贴门锁：锁→门映射持久化进卡 meta，测试与烟雾按卡回放解锁序
    if (spec.lockDoorHints && spec.lockDoorHints.length) card.meta = { lockDoorHints: spec.lockDoorHints };
    return card;
}

// ==================== 全封锁防绕行 + 解锁序校验 ====================
// reachabilityBFS 的语义是「假设所有锁都解开」——它验证不了防绕行。
// 这里补两个更严的检查（官方关全量必过）：
//   ① comp0（全封锁泛洪：关着的门/星辉门=墙，答题机格可站）：终点旗不可达——
//      否则玩家不答任何题就能踩终点（0 锁通关漏洞）。
//   ② 解锁序模拟：从 comp0 出发，每轮「当前可达的锁」逐一解锁其门（重跑泛洪），
//      直到终点可达且全部锁解锁；某轮无新锁可解 ⇒ 死锁设计（锁全在门后之类）。
// 锁→门映射：lockDoorHints 优先（远程红石布线/活塞门等非贴门锁必给），缺省=6 邻搜关着的门。

const key3 = (x, y, z) => `${x},${y},${z}`;
const H4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const H6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// mode='locked'：openDoors 里的门格可通行；其余关着的门=墙、锁定星辉门=墙、答题机/旗可站。
// mode='open'：门/星辉门恒可通行（对齐 levelWorkshop.reachabilityBFS 语义）。
//
// ⚠️ 与运行时 reachabilityBFS（纯 6 邻、无重力）不同，这里必须模拟真实移动——
// 否则 BFS 会沿墙顶空气层「飞」越高墙、横穿跑酷虚空，产生海量假阳性。移动模型：
//   站格 = passable 且脚下实心；水格 = 游泳节点（6 向游动，可上浮=水柱电梯）；
//   陆地边 = 同层走 / 跳 1 格上 / 沿列下落（路径无遮挡），无水平飞跃、无升空；
//   跳跃受真实净空约束（playerPhysics 顶头即 vy 归零）：跳升 1 格要求起跳与落点
//   头顶 2 格可通行，同层走要求落点头顶 1 格可通行——否则楼梯上到一半被楼板
//   压住跳不上去（诗文书院真实事故，2026-09-16 修复时补的模型）。
function decodeView(card) {
    const dec = decodeRegionBlocks(card);
    if (dec.error) throw new Error(`区域快照解码失败：${dec.error}`);
    const r = card.region;
    const get = (x, y, z) => {
        if (x < 0 || y < 0 || z < 0 || x >= r.w || y >= r.h || z >= r.d) return AIR;
        return dec.blocks[x + z * r.w + y * r.w * r.d];
    };
    return { get, r };
}

function makePhysics(card, mode, openDoors) {
    const { get, r } = decodeView(card);
    const inBounds = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < r.w && y < r.h && z < r.d;
    const passable = (x, y, z) => {
        const id = get(x, y, z);
        if (isFlagId(id)) return true;
        // 答题机是实心方块：玩家站在它旁边按键，不进它格子——照 BlockInfo.solid 走墙判定
        if (isDoorId(id)) return mode === 'open' || doorOpen(id) === 1 || openDoors.has(key3(x, y, z));
        if (isStarlightId(id)) return mode === 'open';
        const info = BlockInfo[id];
        return !info || !info.solid; // 水与未登记方块照 BFS 惯例可通行
    };
    const solid = (x, y, z) => {
        const info = BlockInfo[get(x, y, z)];
        return !!(info && info.solid);
    };
    const water = (x, y, z) => get(x, y, z) === WATER;
    const standable = (x, y, z) => passable(x, y, z) && solid(x, y - 1, z);
    const node = (x, y, z) => inBounds(x, y, z) && (water(x, y, z) || standable(x, y, z));
    // 从陆站格沿水平列下落：找第一个落点（站格或水面），路径须全程无遮挡
    const fallTarget = (x, y0, z) => {
        for (let y = y0; y >= 0; y--) {
            if (!passable(x, y, z)) return null;
            if (water(x, y, z) || solid(x, y - 1, z)) return [x, y, z];
        }
        return null;
    };
    return { get, r, inBounds, passable, solid, water, standable, node, fallTarget };
}

// floodFrom：也导出给测试/调试脚本用
export function flood(card, start, mode, openDoors) { return floodFrom(card, start, mode, openDoors); }
function floodFrom(card, start, mode, openDoors) {
    const ph = makePhysics(card, mode, openDoors);
    const { r, node, water, passable, standable, fallTarget } = ph;
    const seen = new Set();
    const stack = [];
    const seed = (x, y, z) => {
        // 起点沿自身列下落找初始节点（旗格应已可站；兜底防悬空旗）
        const t = node(x, y, z) ? [x, y, z] : fallTarget(x, y, z);
        if (t) { const k = key3(t[0], t[1], t[2]); if (!seen.has(k)) { seen.add(k); stack.push(t); } }
    };
    seed(start.x, start.y, start.z);
    while (stack.length) {
        const [x, y, z] = stack.pop();
        if (water(x, y, z)) {
            // 游泳：6 向游动（含上浮——水柱电梯）；游动目标只要求 passable（水中/可站）
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
                const nx = x + dx, ny = y + dy, nz = z + dz;
                if (!ph.inBounds(nx, ny, nz) || !passable(nx, ny, nz)) continue;
                if (water(nx, ny, nz) || standable(nx, ny, nz)) {
                    const k = key3(nx, ny, nz);
                    if (!seen.has(k)) { seen.add(k); stack.push([nx, ny, nz]); }
                }
            }
            continue;
        }
        // 陆地站格
        if (!passable(x, y + 1, z)) continue; // 头顶被封：连原地起跳都不行，更别谈走跳
        for (const [dx, dz] of H4) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= r.w || nz >= r.d) continue;
            for (const ny of [y, y + 1]) { // 同层走 / 跳 1 格上
                if (ny >= r.h) continue;
                // 净空约束（真实跳跃顶头即 vy 归零）：落点头顶 1 格须可通行；
                // 跳上 1 格时起跳点头顶 2 格也须可通行（只剩 1 格净空时跳跃上升
                // 不足 1 格——楼梯中段被楼板压住跳不上去的事故即此形态）
                if (!passable(nx, ny + 1, nz)) continue;
                if (ny === y + 1 && !passable(x, y + 2, z)) continue;
                if (node(nx, ny, nz)) {
                    const k = key3(nx, ny, nz);
                    if (!seen.has(k)) { seen.add(k); stack.push([nx, ny, nz]); }
                }
            }
            // 跑跳 2~3 格远（升 ≤1）：助跑跳的真实跨度（跑酷岛链间隙），弧线顶=中转列净空
            for (const dist of [2, 3]) {
                for (const dy of [0, 1]) {
                    const fy = y + dy;
                    if (fy >= r.h) continue;
                    if (dy === 1 && !passable(x, y + 2, z)) continue; // 升 1 格跑跳：起跳点头顶 2 格净空
                    const ex = x + dist * dx, ez = z + dist * dz;
                    if (ex < 0 || ez < 0 || ex >= r.w || ez >= r.d) continue;
                    let clear = true;
                    for (let m = 1; m < dist && clear; m++) {
                        const mx = x + m * dx, mz = z + m * dz;
                        clear = passable(mx, fy, mz) && (fy + 1 >= r.h || passable(mx, fy + 1, mz));
                    }
                    if (!clear) continue;
                    if (dy === 1 && fy + 1 < r.h && !passable(ex, fy + 1, ez)) continue; // 落点头顶 2 格净空
                    if (node(ex, fy, ez)) {
                        const k = key3(ex, fy, ez);
                        if (!seen.has(k)) { seen.add(k); stack.push([ex, fy, ez]); }
                    }
                }
            }
            const ft = fallTarget(nx, y - 1, z); // 走出边缘下落
            if (ft) {
                const k = key3(ft[0], ft[1], ft[2]);
                if (!seen.has(k)) { seen.add(k); stack.push(ft); }
            }
        }
    }
    return seen;
}

function doorOfLock(card, q, hints) {
    const hint = (hints || []).find((h) => h.key[0] === q.x && h.key[1] === q.y && h.key[2] === q.z);
    if (hint) return hint.door;
    // 缺省：6 邻找关着的门（W04 贴门接线）
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const x = q.x + dx, y = q.y + dy, z = q.z + dz;
        const { get } = decodeView(card);
        const id = get(x, y, z);
        if (isDoorId(id) && doorOpen(id) === 0) return [x, y, z];
    }
    return null;
}

// 返回 {ok, problems[]}：全封锁 comp0 防绕行 + 解锁序模拟。
// hints 缺省回落 card.meta.lockDoorHints（buildCard 已持久化，测试从卡即可回放）。
export function lockedSequenceCheck(card, lockDoorHints) {
    const hints = lockDoorHints || (card.meta && card.meta.lockDoorHints) || [];
    const problems = [];
    const start = card.flags.start;
    const goal = card.flags.goal;
    const goalKey = key3(goal.x, goal.y, goal.z);
    const comp0 = floodFrom(card, start, 'locked', new Set());
    if (comp0.has(goalKey)) {
        problems.push(`全封锁泛洪可达终点 (${goalKey})——存在不答题直通终点的绕行漏洞`);
    }
    const unlocked = new Set(); // 已解锁的锁下标
    let openDoors = new Set();
    for (let round = 0; round <= card.questions.length; round++) {
        const comp = floodFrom(card, start, 'locked', openDoors);
        if (comp.has(goalKey) && unlocked.size >= card.questions.length) return { ok: problems.length === 0, problems };
        // 当前可交互、尚未解锁的锁：泛洪能站到答题机 6 邻；或能站到「其关着的门」的
        // 6 邻——「锁贴门」接线时玩家站在门前侧身按墙上的锁（地牢甬道嵌壁锁即此形态）。
        // ⚠️ 不能只看「6 邻存在关着的门」：嵌墙锁贴着自己那扇门会被隔空判为可交互
        //（玩家根本没走到跟前），解锁序模拟失真——2026-09-16 修复。
        const newly = [];
        card.questions.forEach((q, i) => {
            if (unlocked.has(i)) return;
            const door = doorOfLock(card, q, hints);
            const atLock = H6.some(([dx, dy, dz]) => comp.has(key3(q.x + dx, q.y + dy, q.z + dz))) ||
                (door && H6.some(([dx, dy, dz]) => comp.has(key3(door[0] + dx, door[1] + dy, door[2] + dz))));
            if (atLock) newly.push(i);
        });
        if (!newly.length) {
            const rest = card.questions.filter((q, i) => !unlocked.has(i)).map((q) => key3(q.x, q.y, q.z));
            problems.push(`解锁序死锁：无新锁可达，剩余锁 [${rest.join('；')}]${comp.has(goalKey) ? '' : '，终点也不可达'}`);
            return { ok: false, problems };
        }
        for (const i of newly) {
            unlocked.add(i);
            const q = card.questions[i];
            const door = doorOfLock(card, q, hints);
            if (!door) {
                problems.push(`锁 (${key3(q.x, q.y, q.z)}) 找不到它控制的门：6 邻无关着的门，且 lockDoorHints 未给映射`);
                continue;
            }
            openDoors.add(key3(door[0], door[1], door[2]));
            openDoors.add(key3(door[0], door[1] + 1, door[2])); // 门 2 格高，上下都开
        }
    }
    if (unlocked.size < card.questions.length || !comp0.size) problems.push('解锁序模拟未收敛');
    return { ok: problems.length === 0, problems };
}

// ==================== 单关自测入口 ====================

export function isDirectRun(importMetaUrl) {
    return process.argv[1] && importMetaUrl === `file://${process.argv[1]}`;
}

// 生成器主流程同款校验 + 全封锁/解锁序。全绿打印摘要，任何问题标 ✗ 并置退出码 1。
export async function runSpecSelfTest(spec) {
    const card = buildCard(spec);
    const v = validateLevelCard(card);
    const bfs = reachabilityBFS(card);
    const locked = lockedSequenceCheck(card, spec.lockDoorHints);
    const problems = [
        ...v.errors.map((e) => `schema error: ${e}`),
        ...v.warnings.map((w) => `schema warning: ${w}`),
        ...(bfs.reachable ? [] : [`全解锁 BFS 不可达: ${bfs.missing.join('、')}`]),
        ...locked.problems,
    ];
    if (problems.length) {
        console.error(`✗ ${spec.name}：${problems.length} 个问题`);
        for (const p of problems) console.error(`   ${p}`);
        process.exitCode = 1;
        return false;
    }
    const kb = (JSON.stringify(card).length / 1024).toFixed(1);
    console.log(`✓ ${spec.name} locks=${card.questions.length} cps=${card.flags.checkpoints.length} ${kb}KB（schema/BFS/全封锁防绕行/解锁序 全绿）`);
    return true;
}
