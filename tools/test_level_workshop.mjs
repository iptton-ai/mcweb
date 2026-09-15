// ==================== test_level_workshop.mjs ====================
// 关卡工坊（js/levelWorkshop.js）Node 自测：node:test，直接 `node tools/test_level_workshop.mjs` 可跑。
// 覆盖契约 docs/edu-workshop-impl-contract.md §3.1 全部导出：
//   snapshotRegion↔RLE 回环 / computeAutoRegion 锚点与边缘 clamp / buildLevelCard（stub 锁题提供者）/
//   validateLevelCard 全分支 / cardHash 稳定 / embedLevelToWorld 落位与 dirtyChunks /
//   坐标换算 / isOutOfRunArea / 卡片会话存储回环 + importLevelCardFromJson 回环。
// Node 无 indexedDB → 存储自动走会话内存兜底（顺带覆盖 W17 降级路径）。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BlockTypes,
    DOOR_BASE,
    FLAG_BASE,
    KEYPAD_BASE,
    STARLIGHT_BASE,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
} from '../js/config.js';
import { state } from '../js/state.js';
import { rleDecode, rleEncode } from '../js/rle.js';
import {
    LEVEL_CARD_FORMAT,
    LEVEL_EMBED_OFFSET,
    LEVEL_REGION_MAX,
    base64ToU8,
    buildLevelCard,
    cardHash,
    computeAutoRegion,
    deleteLevelCard,
    embedLevelToWorld,
    exportLevelCardJson,
    getLevelCard,
    importLevelCardFromJson,
    isOutOfRunArea,
    listLevelCards,
    localKey,
    localToWorld,
    saveLevelCard,
    snapshotRegion,
    u8ToBase64,
    validateLevelCard,
    worldToLocal,
} from '../js/levelWorkshop.js';

// ---- 世界内存助手（真尺寸 256×256×128 ≈ 8MB，下标公式与 world.getBlockIndex 一致）----
const W = WORLD_WIDTH;
const H = WORLD_HEIGHT;
const D = WORLD_DEPTH;
const idx = (x, y, z) => x + z * W + y * W * D;
function setBlock(x, y, z, id) {
    state.blocks[idx(x, y, z)] = id;
}
function resetWorld() {
    state.blocks = new Uint8Array(W * D * H);
}

// ---- 固定夹具：小关卡（旗×3 + 答题机×2，其中一把有锁题）----
// 世界坐标：起点旗(100,30,100) 检查点(102,30,101) 终点旗(104,30,102)
//           答题机A(101,30,102)有锁、答题机B(103,30,100)无锁
// 自动区域 = 包围盒(100..104,30..30,100..102) +2 边距 = {x0:98,y0:28,z0:98,w:9,h:5,d:7}
const STUB_QUESTION = {
    subject: 'math',
    kind: 'choice',
    stem: '3 + 4 = ?',
    options: ['5', '6', '7', '8'],
    answer: 2,
    hint: '凑十法',
    unit: '第4单元',
};
function stubLockMetaProvider(x, y, z) {
    if (x === 101 && y === 30 && z === 102) return { question: STUB_QUESTION, verifiedPasses: 2 };
    return null; // 答题机 B：没题不进 questions
}
async function buildFixtureCard(overrides = {}) {
    resetWorld();
    setBlock(100, 30, 100, FLAG_BASE); // 起点旗（kind 0）
    setBlock(102, 30, 101, FLAG_BASE + 1); // 检查点旗
    setBlock(104, 30, 102, FLAG_BASE + 2); // 终点旗
    setBlock(101, 30, 102, KEYPAD_BASE); // 答题机 A（锁定态）
    setBlock(103, 30, 100, KEYPAD_BASE); // 答题机 B（锁定态）
    return buildLevelCard({ name: '测试关', author: '小明', lockMetaProvider: stubLockMetaProvider, ...overrides });
}
// 把卡片 region 的方块整体替换为给定局部数组（构造 BFS 不可达等定制场景用）
function withLocalBlocks(card, localBlocks) {
    const clone = structuredClone(card);
    clone.region.blocks = u8ToBase64(rleEncode(localBlocks));
    return clone;
}
function decodeCardBlocks(card) {
    return rleDecode(base64ToU8(card.region.blocks), card.region.w * card.region.h * card.region.d);
}
function errorsOf(v) {
    return v.errors.join('\n');
}

// ==================== 1. snapshotRegion ↔ RLE 回环 ====================
test('snapshotRegion 按世界内存序快照且 RLE 回环一致', () => {
    resetWorld();
    const region = { x0: 10, y0: 5, z0: 20, w: 4, h: 3, d: 2 };
    const expect = new Uint8Array(region.w * region.h * region.d);
    let k = 0;
    for (let ly = 0; ly < region.h; ly++) {
        for (let lz = 0; lz < region.d; lz++) {
            for (let lx = 0; lx < region.w; lx++) {
                const v = (ly * 24 + lz * 8 + lx * 3) % 255 + 1;
                setBlock(region.x0 + lx, region.y0 + ly, region.z0 + lz, v);
                expect[k++] = v;
            }
        }
    }
    const rle = snapshotRegion(region);
    assert.ok(rle instanceof Uint8Array);
    assert.deepEqual(rleDecode(rle, region.w * region.h * region.d), expect);
});

// ==================== 2. computeAutoRegion：锚点 / 边缘 clamp / 无锚点 / 超上限 ====================
test('computeAutoRegion 旗∪答题机∪星辉门∪门 联合包围盒 +2 边距', () => {
    resetWorld();
    setBlock(0, 0, 0, FLAG_BASE + 2); // 起点旗贴世界原点（边缘 clamp）
    setBlock(5, 10, 7, KEYPAD_BASE + 1); // 已解锁答题机也算锚点
    const r = computeAutoRegion();
    // 包围盒 x0..5/y0..10/z0..7，+2 后 x/z 负方向贴 0
    assert.deepEqual(r, { x0: 0, y0: 0, z0: 0, w: 8, h: 13, d: 10 });
});

test('computeAutoRegion 星辉门与门都是锚点，正方向 +2 吃满', () => {
    resetWorld();
    setBlock(3, 8, 5, STARLIGHT_BASE); // 星辉门（锁定）
    setBlock(6, 4, 9, DOOR_BASE); // 关门北向下半
    setBlock(1, 1, 1, FLAG_BASE);
    const r = computeAutoRegion();
    assert.deepEqual(r, { x0: 0, y0: 0, z0: 0, w: 9, h: 11, d: 12 }); // max(6,4,9)+3
});

test('computeAutoRegion 无锚点返回 null，超 96×64×96 返回 null', () => {
    resetWorld();
    assert.equal(computeAutoRegion(), null); // 空世界
    setBlock(0, 30, 0, FLAG_BASE);
    setBlock(150, 30, 0, FLAG_BASE + 1); // 横向拉开 150 格 → w=153 超上限
    assert.equal(computeAutoRegion(), null);
});

// ==================== 3. buildLevelCard（stub 锁题提供者）====================
test('buildLevelCard 组卡：region/题目/旗/rules 全字段与局部坐标', async () => {
    const card = await buildFixtureCard();
    assert.equal(card.error, undefined);
    assert.equal(card.format, LEVEL_CARD_FORMAT);
    assert.equal(card.version, 1);
    assert.equal(card.name, '测试关');
    assert.equal(card.author, '小明');
    assert.ok(typeof card.created === 'string' && !Number.isNaN(Date.parse(card.created)));
    assert.deepEqual(card.region, { x0: 98, y0: 28, z0: 98, w: 9, h: 5, d: 7, enc: 'rle', blocks: card.region.blocks });
    // 只有答题机 A 进 questions（B 没题不进），坐标为 region 局部坐标
    assert.equal(card.questions.length, 1);
    assert.deepEqual(card.questions[0], {
        lockType: 'keypad',
        x: 3, y: 2, z: 4, // 世界(101,30,102) - region 原点(98,28,98)
        subject: 'math',
        kind: 'choice',
        stem: '3 + 4 = ?',
        options: ['5', '6', '7', '8'],
        answer: 2,
        hint: '凑十法',
        unit: '第4单元',
        meta: { source: 'bank', verifiedPasses: 2 },
    });
    assert.deepEqual(card.flags, {
        start: { x: 2, y: 2, z: 2 },
        checkpoints: [{ x: 4, y: 2, z: 3 }],
        goal: { x: 6, y: 2, z: 4 },
    });
    assert.deepEqual(card.rules, { timeLimit: null, lockAIHelp: true });
    assert.equal(card.meta, undefined); // 非 draft 无 meta
});

test('buildLevelCard：draft 标记 / rules 覆盖 / 缺终点 / 缺名 / 无锚点 / 超上限', async () => {
    const draft = await buildFixtureCard({ draft: true, generator: 'ai', rules: { timeLimit: 300, lockAIHelp: false } });
    assert.deepEqual(draft.meta, { draft: true, generator: 'ai' });
    assert.deepEqual(draft.rules, { timeLimit: 300, lockAIHelp: false });

    resetWorld();
    setBlock(50, 30, 50, FLAG_BASE); // 只放起点
    const noGoal = await buildLevelCard({ name: 'x', lockMetaProvider: () => null });
    assert.match(noGoal.error, /终点旗/);

    resetWorld();
    setBlock(0, 30, 0, FLAG_BASE);
    setBlock(200, 30, 0, FLAG_BASE + 2);
    const tooBig = await buildLevelCard({ name: 'x', lockMetaProvider: () => null });
    assert.match(tooBig.error, /区域超出 96×64×96，请缩小关卡或减少装饰/);

    resetWorld();
    const noName = await buildLevelCard({ name: '  ', lockMetaProvider: () => null });
    assert.match(noName.error, /关卡名/);

    resetWorld();
    const noAnchor = await buildLevelCard({ name: 'x', lockMetaProvider: () => null });
    assert.match(noAnchor.error, /锚点/);
});

// ==================== 4. validateLevelCard 全分支 ====================
test('validateLevelCard：合法卡零错误零警告', async () => {
    const card = await buildFixtureCard();
    const v = validateLevelCard(card);
    assert.equal(v.ok, true);
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.warnings, []); // 双通过已达成 + BFS 可达
});

test('validateLevelCard：choice 选项重复 / 答案越界 / 缺项非空', async () => {
    const base = await buildFixtureCard();
    const dup = structuredClone(base);
    dup.questions[0].options[3] = dup.questions[0].options[0];
    assert.match(errorsOf(validateLevelCard(dup)), /选项内容重复/);

    const ans = structuredClone(base);
    ans.questions[0].answer = 9;
    assert.match(errorsOf(validateLevelCard(ans)), /answer 越界/);

    const empty = structuredClone(base);
    empty.questions[0].options[1] = '  ';
    assert.match(errorsOf(validateLevelCard(empty)), /非空字符串/);
});

test('validateLevelCard：input 答案必须 0..9999 整数', async () => {
    const base = await buildFixtureCard();
    for (const [answer, tag] of [[10000, '过大'], [-1, '负数'], [1.5, '小数']]) {
        const c = structuredClone(base);
        c.questions[0].kind = 'input';
        c.questions[0].answer = answer;
        delete c.questions[0].options;
        const v = validateLevelCard(c);
        assert.equal(v.ok, false, tag);
        assert.match(errorsOf(v), /0\.\.9999/, tag);
    }
});

test('validateLevelCard：缺起点/缺终点/旗越界 均报错', async () => {
    const base = await buildFixtureCard();
    const noGoal = structuredClone(base);
    noGoal.flags.goal = null;
    assert.match(errorsOf(validateLevelCard(noGoal)), /缺少终点旗/);

    const noStart = structuredClone(base);
    noStart.flags.start = undefined;
    assert.match(errorsOf(validateLevelCard(noStart)), /缺少起点旗/);

    const outside = structuredClone(base);
    outside.flags.goal = { x: 99, y: 0, z: 0 }; // 超出 w=9
    assert.match(errorsOf(validateLevelCard(outside)), /越出 region/);
});

test('validateLevelCard：未双通过 error，draft 降为 warning', async () => {
    const base = await buildFixtureCard();
    const unverified = structuredClone(base);
    unverified.questions[0].meta.verifiedPasses = 1;
    const v1 = validateLevelCard(unverified);
    assert.equal(v1.ok, false);
    assert.match(errorsOf(v1), /双通过/);

    const draftCard = withLocalBlocks(unverified, decodeCardBlocks(unverified));
    draftCard.meta = { draft: true };
    const v2 = validateLevelCard(draftCard);
    assert.equal(v2.ok, true);
    assert.equal(v2.warnings.length, 1);
    assert.match(v2.warnings[0], /双通过/);
});

test('validateLevelCard：BFS 不可达 ⇒ warning（ok 不受挫）', async () => {
    const base = await buildFixtureCard();
    const blocks = decodeCardBlocks(base); // w=9 h=5 d=7
    const at = (x, y, z) => x + z * base.region.w + y * base.region.w * base.region.d;
    const g = base.flags.goal;
    // 用石头封死终点旗六邻域
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        blocks[at(g.x + dx, g.y + dy, g.z + dz)] = BlockTypes.STONE;
    }
    const sealed = withLocalBlocks(base, blocks);
    const v = validateLevelCard(sealed);
    assert.equal(v.ok, true); // 可达性只降警告，不挡导出
    assert.equal(v.warnings.length, 1);
    assert.match(v.warnings[0], /可达/);
    assert.match(v.warnings[0], /终点旗/);
});

test('validateLevelCard：锁坐标越界 / 锁位重复 / stem / subject / 格式字段', async () => {
    const base = await buildFixtureCard();

    const far = structuredClone(base);
    far.questions[0].x = 100;
    assert.match(errorsOf(validateLevelCard(far)), /锁局部坐标 .* 越出 region/);

    const dupLock = structuredClone(base);
    dupLock.questions.push({ ...dupLock.questions[0] });
    assert.match(errorsOf(validateLevelCard(dupLock)), /锁位置 .* 重复/);

    const noStem = structuredClone(base);
    noStem.questions[0].stem = '';
    assert.match(errorsOf(validateLevelCard(noStem)), /题干/);

    const badSubject = structuredClone(base);
    badSubject.questions[0].subject = 'english2';
    assert.match(errorsOf(validateLevelCard(badSubject)), /subject/);

    const badFormat = structuredClone(base);
    badFormat.format = 'mcweb.level.v0';
    assert.match(errorsOf(validateLevelCard(badFormat)), /format/);

    const badVersion = structuredClone(base);
    badVersion.version = 2;
    assert.match(errorsOf(validateLevelCard(badVersion)), /version/);

    assert.equal(validateLevelCard(null).ok, false);
    assert.equal(validateLevelCard('x').ok, false);
});

test('validateLevelCard：region 超上限/越界/RLE 长度不符/rules 类型', async () => {
    const base = await buildFixtureCard();

    const big = structuredClone(base);
    big.region.w = 200;
    assert.match(errorsOf(validateLevelCard(big)), /超出 96×64×96/);

    const outWorld = structuredClone(base);
    outWorld.region.x0 = 250;
    assert.match(errorsOf(validateLevelCard(outWorld)), /世界边界/);

    const badRle = structuredClone(base);
    badRle.region.blocks = u8ToBase64(rleEncode(new Uint8Array(5)));
    assert.match(errorsOf(validateLevelCard(badRle)), /RLE 解码长度与尺寸不符/);

    const badEnc = structuredClone(base);
    badEnc.region.enc = 'raw';
    assert.match(errorsOf(validateLevelCard(badEnc)), /enc/);

    const badLimit = structuredClone(base);
    badLimit.rules.timeLimit = -5;
    assert.match(errorsOf(validateLevelCard(badLimit)), /timeLimit/);
    const badFlag2 = structuredClone(base);
    badFlag2.rules.lockAIHelp = 'yes';
    assert.match(errorsOf(validateLevelCard(badFlag2)), /lockAIHelp/);
    const goodLimit = structuredClone(base);
    goodLimit.rules.timeLimit = 120;
    assert.equal(validateLevelCard(goodLimit).ok, true);
});

// ==================== 5. cardHash 稳定 ====================
test('cardHash 对内容稳定（JSON 回环不变），内容变更即变', async () => {
    const card = await buildFixtureCard();
    const h1 = cardHash(card);
    const h2 = cardHash(JSON.parse(JSON.stringify(card)));
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]{8}$/);
    const moved = structuredClone(card);
    moved.questions[0].answer = (card.questions[0].answer + 1) % 4;
    assert.notEqual(cardHash(moved), h1);
});

// ==================== 6. 坐标换算与 isOutOfRunArea ====================
test('worldToLocal/localToWorld 以嵌入偏移为基准，localKey 出记账字符串', () => {
    assert.deepEqual(worldToLocal(83, 6, 84), { x: 3, y: 2, z: 4 });
    assert.deepEqual(localToWorld(3, 2, 4), { x: 83, y: 6, z: 84 });
    assert.deepEqual(localToWorld(0, 0, 0), LEVEL_EMBED_OFFSET);
    assert.equal(localKey({ x: 1, y: 2, z: 3 }), '1,2,3');
});

test('isOutOfRunArea：非闯关恒 false；y<1 或水平出 region±2 判掉界', async () => {
    const card = await buildFixtureCard(); // region w=9 d=7
    state.levelRun = null;
    assert.equal(isOutOfRunArea(0, 0, 0), false);
    state.levelRun = { card };
    assert.equal(isOutOfRunArea(83, 6, 84), false); // 场内
    assert.equal(isOutOfRunArea(83, 0, 84), true); // y<1（世界底）
    assert.equal(isOutOfRunArea(77, 6, 84), true); // lx=-3 出边距
    assert.equal(isOutOfRunArea(78, 6, 84), false); // lx=-2 在 ±2 边距内
    assert.equal(isOutOfRunArea(91, 6, 84), false); // lx=w+2=11 边距内
    assert.equal(isOutOfRunArea(92, 6, 84), true); // lx=w+3 出
    assert.equal(isOutOfRunArea(83, 6, 90), true); // lz=d+3 出
    state.levelRun = null;
});

// ==================== 7. embedLevelToWorld：落位 / dirtyChunks / spawn ====================
test('embedLevelToWorld：region 直写世界（+偏移），基岩层不受影响，spawn=起点旗', async () => {
    const card = await buildFixtureCard();
    resetWorld();
    for (let x = 0; x < W; x += 1) { // 模拟调用方铺 y=0 基岩
        for (let z = 0; z < D; z += 1) state.blocks[idx(x, 0, z)] = BlockTypes.BEDROCK;
    }
    const r = embedLevelToWorld(card);
    assert.equal(r.error, undefined);
    // 答题机 A 局部(3,2,4) → 世界(83,6,84)；起点旗局部(2,2,2) → 世界(82,6,82)
    assert.equal(state.blocks[idx(83, 6, 84)], KEYPAD_BASE);
    assert.equal(state.blocks[idx(82, 6, 82)], FLAG_BASE);
    assert.equal(state.blocks[idx(86, 6, 84)], FLAG_BASE + 2); // 终点旗
    // region 外仍是空气，基岩层未被触碰
    assert.equal(state.blocks[idx(79, 6, 79)], 0);
    assert.equal(state.blocks[idx(83, 0, 84)], BlockTypes.BEDROCK);
    assert.deepEqual(r.spawn, { x: 82, y: 6, z: 82 });
    // w=9/d=7 全落在区块 (5,5) 一个区块内
    assert.deepEqual(r.dirtyChunks, [{ cx: 5, cz: 5 }]);
});

test('embedLevelToWorld：跨区块 dirtyChunks 去重覆盖，方块逐格对位', async () => {
    resetWorld();
    // 手工造 18×2×18 卡（内容走 snapshotRegion，保证与快照字节布局一致）
    const region = { x0: 0, y0: 3, z0: 0, w: 18, h: 2, d: 18 };
    for (let ly = 0; ly < region.h; ly++) {
        for (let lz = 0; lz < region.d; lz++) {
            for (let lx = 0; lx < region.w; lx++) {
                setBlock(lx, region.y0 + ly, lz, (lx * 7 + ly * 3 + lz * 5) % 251 + 1);
            }
        }
    }
    const card = {
        format: LEVEL_CARD_FORMAT,
        name: '跨区块', author: 't', created: '2026-09-15T00:00:00.000Z', version: 1,
        region: { ...region, enc: 'rle', blocks: u8ToBase64(snapshotRegion(region)) },
        questions: [],
        rules: { timeLimit: null, lockAIHelp: true },
        flags: { start: { x: 0, y: 0, z: 0 }, checkpoints: [], goal: { x: 17, y: 1, z: 17 } },
    };
    resetWorld();
    const r = embedLevelToWorld(card);
    assert.equal(r.error, undefined);
    // 世界 x/z 80..97 → 区块 cx/cz 5..6，共 4 个
    assert.deepEqual(r.dirtyChunks.map((c) => `${c.cx},${c.cz}`).sort(), ['5,5', '5,6', '6,5', '6,6']);
    // 角落数据对位：局部(17,1,17) → 世界(97,5,97)
    const local = decodeCardBlocks(card);
    const li = 17 + 17 * region.w + 1 * region.w * region.d;
    assert.equal(state.blocks[idx(97, 5, 97)], local[li]);
    assert.equal(state.blocks[idx(80, 4, 80)], local[0]);
    // 嵌入后卡片校验依旧通过（该卡起终点均悬浮空气中=可达）
    assert.equal(validateLevelCard(card).ok, true);
});

// ==================== 8. 卡片存储：会话兜底回环 + 导入导出回环 ====================
test('saveLevelCard/list/get/delete：Node 无 IndexedDB 走会话兜底（W17）', async () => {
    assert.equal(globalThis.indexedDB, undefined); // 前提：Node 无 indexedDB
    const card = await buildFixtureCard();
    const saved = await saveLevelCard(card);
    assert.deepEqual(saved, { ok: true, id: saved.id, sessionOnly: true });
    assert.match(saved.id, /^[0-9a-f]{8}-[0-9a-z]+$/); // cardHash-created 短码

    const rows = await listLevelCards();
    const row = rows.find((r) => r.id === saved.id);
    assert.ok(row);
    assert.equal(row.name, '测试关');
    assert.equal(row.author, '小明');
    assert.equal(row.cardHash, cardHash(card));
    assert.equal(row.sessionOnly, true);

    assert.deepEqual(await getLevelCard(saved.id), card);
    assert.equal(await getLevelCard('missing'), null);
    assert.equal(await deleteLevelCard(saved.id), true);
    assert.equal(await getLevelCard(saved.id), null);
    assert.equal(await deleteLevelCard(saved.id), false); // 再删=false
    const bad = await saveLevelCard({ format: 'nope' });
    assert.equal(bad.ok, false);
});

test('importLevelCardFromJson：导出→导入逐字段一致；坏文件/坏卡被拒（W06）', async () => {
    const card = await buildFixtureCard();
    const text = exportLevelCardJson(card);
    const imp = await importLevelCardFromJson(text);
    assert.equal(imp.ok, true);
    assert.equal(imp.sessionOnly, true);
    assert.deepEqual(await getLevelCard(imp.id), JSON.parse(text)); // 经 JSON 回环逐字段一致
    await deleteLevelCard(imp.id);

    const garbage = await importLevelCardFromJson('{{{ 不是 JSON');
    assert.match(garbage.error, /JSON 解析失败/);

    const invalid = structuredClone(card);
    invalid.flags.goal = null; // 缺终点：校验门拦截
    const bad = await importLevelCardFromJson(JSON.stringify(invalid));
    assert.equal(bad.ok, undefined);
    assert.match(bad.error, /校验未通过/);
    assert.match(bad.error, /终点旗/);
});
