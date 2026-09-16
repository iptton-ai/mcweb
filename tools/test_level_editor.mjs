// ==================== test_level_editor.mjs ====================
// 关卡编辑器批次（2026-09-16）Node 自测：node:test，`node tools/test_level_editor.mjs` 可跑。
// 覆盖：
//   · levelPrefabs 组件注册表合法性与几何展开（边界/重复/非法 ID）
//   · 答题组件红石接线（贴门 6 邻 / 远程粉线 ≤13 级 / 滑轮电梯粉线到滑轮 6 邻）
//   · prefabOrigin 落点换算（grounded 嵌地 / props 立于面外）
//   · 模板存取回环（Node 无 IndexedDB → 会话内存兜底路径）
//   · buildLevelCard 草稿容忍星辉门 / 正式导出仍拦（契约行为回归）

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BlockTypes,
    FLAG_BASE,
    FLAG_GOAL,
    FLAG_START,
    KEYPAD_BASE,
    PLATFORM_BASE,
    PULLEY_BASE,
    STARLIGHT_BASE,
    WATERWHEEL_BASE,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    dustId,
    doorHalf,
    doorId,
    isDoorId,
    isKeypadId,
    starlightId,
} from '../js/config.js';
import { rleEncode } from '../js/rle.js';
import { state } from '../js/state.js';
import {
    PREFABS,
    buildPrefabCells,
    getPrefab,
    listPrefabCats,
    prefabOrigin,
    wireDistance,
} from '../js/levelPrefabs.js';
import {
    buildLevelCard,
    deleteLevelTemplate,
    getLevelTemplate,
    listLevelTemplates,
    saveLevelTemplate,
    u8ToBase64,
    validateLevelCard,
} from '../js/levelWorkshop.js';

const W = WORLD_WIDTH;
const D = WORLD_DEPTH;
const idx = (x, y, z) => x + z * W + y * W * D;
const H6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
const key3 = (x, y, z) => `${x},${y},${z}`;

// cells → 查表助手
function cellMap(cells) {
    const m = new Map();
    for (const c of cells) m.set(key3(c.x, c.y, c.z), c.id);
    return m;
}
const at = (m, x, y, z) => m.get(key3(x, y, z));

// ==================== 组件注册表与几何 ====================

test('组件注册表：id 唯一、尺寸为正、anchor 在界内、分类清单覆盖', () => {
    const ids = new Set();
    for (const p of PREFABS) {
        assert.ok(!ids.has(p.id), `组件 id 重复：${p.id}`);
        ids.add(p.id);
        assert.ok(p.w > 0 && p.h > 0 && p.d > 0, `${p.id} 尺寸必须为正`);
        assert.ok(typeof p.build === 'function', `${p.id} 缺 build`);
        assert.ok(typeof p.desc === 'string' && p.desc.length > 4, `${p.id} 缺描述`);
        const a = p.anchor || { x: 0, y: 0, z: 0 };
        assert.ok(a.x >= 0 && a.x < p.w && a.y >= 0 && a.y < p.h && a.z >= 0 && a.z < p.d,
            `${p.id} anchor 越界`);
    }
    assert.ok(ids.has('quiz_door') && ids.has('quiz_pulley_lift'), '锁具机关组件缺失');
    const cats = listPrefabCats();
    assert.ok(cats.includes('旗标') && cats.includes('锁具机关') && cats.includes('结构'),
        `分类异常：${cats.join('/')}`);
    for (const p of PREFABS) assert.ok(getPrefab(p.id) === p, `getPrefab 查不到 ${p.id}`);
    assert.equal(getPrefab('no_such'), null);
});

test('组件几何展开：全部格子界内、无重复、ID 合法；未知组件报错', () => {
    for (const p of PREFABS) {
        const { cells, error } = buildPrefabCells(p);
        assert.ok(!error, `${p.id} 展开报错：${error}`);
        assert.ok(cells.length > 0, `${p.id} 空几何`);
        const seen = new Set();
        for (const c of cells) {
            assert.ok(c.x >= 0 && c.x < p.w && c.y >= 0 && c.y < p.h && c.z >= 0 && c.z < p.d,
                `${p.id} 越界 (${c.x},${c.y},${c.z})`);
            const k = key3(c.x, c.y, c.z);
            assert.ok(!seen.has(k), `${p.id} 重复申报 ${k}`);
            seen.add(k);
            assert.ok(Number.isInteger(c.id) && c.id >= 0 && c.id <= 255, `${p.id} 非法 ID ${c.id}`);
        }
    }
    assert.ok(buildPrefabCells({}).error, '空对象应当报错');
});

test('答题门（贴门锁）：锁定答题机与关门下半 6 邻；答题机为锁定变体', () => {
    const p = getPrefab('quiz_door');
    const cells = buildPrefabCells(p).cells;
    const m = cellMap(cells);
    const doorLower = cells.find((c) => isDoorId(c.id) && doorHalf(c.id) === 0);
    assert.ok(doorLower, '应恰有门的下半扇');
    assert.equal(doorLower.id, doorId(0, 0, 2), '门应为 下半·关门 变体');
    const keypad = cells.find((c) => isKeypadId(c.id));
    assert.ok(keypad, '组件里应有答题机');
    assert.equal(keypad.id, KEYPAD_BASE, '答题机应为锁定变体');
    assert.ok(H6.some(([ax, ay, az]) =>
        keypad.x + ax === doorLower.x && keypad.y + ay === doorLower.y && keypad.z + az === doorLower.z),
        `答题机 (${keypad.x},${keypad.y},${keypad.z}) 与门下半必须 6 邻（贴门直开）`);
});

test('远程答题门：粉线源到尾 ≤13 级且尾与门 6 邻', () => {
    const p = getPrefab('quiz_door_remote');
    const cells = buildPrefabCells(p).cells;
    const kp = cells.find((c) => isKeypadId(c.id));
    assert.ok(kp, '应有锁定答题机');
    // 粉线：门上半 (1,1,0) 的 6 邻里必须有粉；源到每个粉的距离 ≤13（15 级源每格 -1）
    const dusts = cells.filter((c) => c.id === dustId(0));
    assert.ok(dusts.length >= 2, '应有红石粉线');
    let maxDist = 0;
    for (const du of dusts) {
        const d = wireDistance(p, kp, du);
        assert.ok(d > 0, `粉 (${du.x},${du.y},${du.z}) 与答题机不连通`);
        maxDist = Math.max(maxDist, d);
    }
    assert.ok(maxDist <= 13, `粉线过长：${maxDist} 格衰减后无信号`);
    const nearDoor = dusts.some((du) =>
        H6.some(([ax, ay, az]) => du.x + ax === 1 && du.y + ay === 1 && du.z + az === 0));
    assert.ok(nearDoor, '粉线末端没有贴到门（远程开门失效）');
});

test('答题滑轮电梯：粉线到滑轮 6 邻、井道畅通、机头水车水齐全', () => {
    const p = getPrefab('quiz_pulley_lift');
    const cells = buildPrefabCells(p).cells;
    const m = cellMap(cells);
    const kp = cells.find((c) => isKeypadId(c.id));
    assert.ok(kp, '应有锁定答题机');
    const pulley = cells.find((c) => c.id >= PULLEY_BASE && c.id < PULLEY_BASE + 4);
    assert.ok(pulley, '应有滑轮');
    // 平台在滑轮正下方且之间全为空气（绳路畅通）
    const platform = cells.find((c) => c.id === PLATFORM_BASE);
    assert.ok(platform && platform.x === pulley.x && platform.z === pulley.z && platform.y < pulley.y,
        '平台应挂在滑轮正下方');
    for (let y = platform.y + 1; y < pulley.y; y++) {
        assert.equal(at(m, pulley.x, y, pulley.z) ?? BlockTypes.AIR, BlockTypes.AIR,
            `绳路 (${pulley.x},${y},${pulley.z}) 被占用`);
    }
    // 水车顶面接触水（动力源）：水在水车正上方
    const wheel = cells.find((c) => c.id >= WATERWHEEL_BASE && c.id < WATERWHEEL_BASE + 3);
    assert.ok(wheel, '应有水车');
    assert.equal(at(m, wheel.x, wheel.y + 1, wheel.z), BlockTypes.WATER, '水车顶面必须接水');
    // 接线：答题机经粉线到「与滑轮 6 邻的粉」≤13 级
    const dusts = cells.filter((c) => c.id === dustId(0));
    assert.ok(dusts.length >= 3, '应有呼梯粉线');
    const nearPulley = dusts.filter((du) =>
        H6.some(([ax, ay, az]) =>
            du.x + ax === pulley.x && du.y + ay === pulley.y && du.z + az === pulley.z));
    assert.ok(nearPulley.length >= 1, '没有粉贴着滑轮（卷绳激活不了）');
    let best = Infinity;
    for (const du of nearPulley) best = Math.min(best, wireDistance(p, kp, du));
    assert.ok(best > 0 && best <= 13, `滑轮粉线异常：距离 ${best}`);
});

test('星辉门/旗标/弹跳垫：变体正确', () => {
    const sl = cellMap(buildPrefabCells(getPrefab('starlight_gate')).cells);
    assert.ok([...sl.values()].includes(starlightId(0)), '星辉门应为锁定变体');
    const fstart = cellMap(buildPrefabCells(getPrefab('flag_start')).cells);
    assert.equal([...fstart.values()][0], FLAG_BASE + FLAG_START);
    const fgoal = cellMap(buildPrefabCells(getPrefab('flag_goal')).cells);
    assert.equal([...fgoal.values()][0], FLAG_BASE + FLAG_GOAL);
    const slime = cellMap(buildPrefabCells(getPrefab('bounce_pad')).cells);
    assert.equal([...slime.values()][0], BlockTypes.SLIME);
});

test('prefabOrigin：grounded 嵌地 / props 立于命中面外', () => {
    const tower = getPrefab('castle_tower'); // grounded=true, anchor (3,0,3)
    const o1 = prefabOrigin(tower, { x: 50, y: 10, z: 60, face: { dx: 0, dy: 1, dz: 0 } });
    assert.deepEqual(o1, { x: 47, y: 10, z: 57 }, '结构件底排应落在被瞄方块一排');
    const flag = getPrefab('flag_start'); // props, anchor (0,0,0)
    const o2 = prefabOrigin(flag, { x: 50, y: 10, z: 60, face: { dx: 0, dy: 1, dz: 0 } });
    assert.deepEqual(o2, { x: 50, y: 11, z: 60 }, '道具件应立在命中面外邻格');
    const door = getPrefab('quiz_door'); // props, anchor (1,0,0)
    const o3 = prefabOrigin(door, { x: 50, y: 10, z: 60, face: { dx: 1, dy: 0, dz: 0 } });
    assert.deepEqual(o3, { x: 50, y: 10, z: 60 }, 'props+非零 anchor：门洞列对准命中邻格');
});

// ==================== 模板存取（会话内存兜底路径） ====================

// 合法空卡夹具（全空气 region，起终点旗俱全）
function fixtureCard(name) {
    const blocks = rleEncode(new Uint8Array(4 * 3 * 4));
    return {
        format: 'mcweb.level.v1',
        name,
        author: 'tester',
        created: '2026-09-16T00:00:00.000Z',
        version: 1,
        region: { x0: 0, y0: 0, z0: 0, w: 4, h: 3, d: 4, enc: 'rle', blocks: u8ToBase64(blocks) },
        questions: [],
        rules: { timeLimit: null, lockAIHelp: true },
        flags: { start: { x: 1, y: 1, z: 1 }, goal: { x: 2, y: 1, z: 2 }, checkpoints: [] },
    };
}

test('模板存取回环：save/list/get/delete（Node 走会话内存兜底）', async () => {
    const card = fixtureCard('模板一');
    const saved = await saveLevelTemplate(card);
    assert.ok(saved.ok, `保存失败：${saved.error || ''}`);
    assert.ok(saved.id.startsWith('tpl-'), `模板 id 应有 tpl- 前缀：${saved.id}`);
    // 同内容再存 = 同 id 覆盖，不产生第二条
    const again = await saveLevelTemplate(card);
    assert.equal(again.id, saved.id);
    const list = await listLevelTemplates();
    assert.equal(list.filter((t) => t.id === saved.id).length, 1);
    const got = await getLevelTemplate(saved.id);
    assert.equal(got.name, '模板一');
    const bad = await saveLevelTemplate({ foo: 1 });
    assert.equal(bad.ok, false, '非关卡卡应拒绝入库');
    assert.ok(await deleteLevelTemplate(saved.id));
    assert.equal(await getLevelTemplate(saved.id), null);
});

// ==================== buildLevelCard 草稿容忍星辉门 ====================

function resetWorld() {
    state.blocks = new Uint8Array(W * D * WORLD_HEIGHT);
}

test('buildLevelCard：草稿容忍星辉门，正式导出仍拦截（契约回归）', async () => {
    resetWorld();
    // 平台 + 起终点旗 + 一扇锁定星辉门
    for (let x = 40; x < 50; x++) {
        for (let z = 40; z < 50; z++) state.blocks[idx(x, 20, z)] = BlockTypes.STONE;
    }
    state.blocks[idx(42, 21, 42)] = FLAG_BASE + FLAG_START;
    state.blocks[idx(47, 21, 47)] = FLAG_BASE + FLAG_GOAL;
    state.blocks[idx(45, 21, 42)] = starlightId(0);

    const draft = await buildLevelCard({ name: '草稿关', author: 't', draft: true });
    assert.ok(!draft.error, `草稿不应被星辉门拦：${draft && draft.error}`);
    assert.ok(draft.meta && draft.meta.draft === true, '草稿卡应带 meta.draft');
    const dv = validateLevelCard(draft);
    assert.ok(dv.ok, `草稿卡校验应通过：${dv.errors.join('；')}`);

    const formal = await buildLevelCard({ name: '正式关', author: 't' });
    assert.ok(formal && formal.error && formal.error.includes('星辉门'),
        '正式导出必须继续拦星辉门（原契约行为）');
});

test('buildLevelCard 草稿：无锚点时报错不抛异常', async () => {
    resetWorld();
    const card = await buildLevelCard({ name: '空世界', draft: true });
    assert.ok(card && card.error, '无锚点应返回错误文案');
});
