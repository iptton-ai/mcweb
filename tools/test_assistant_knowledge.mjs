// tools/test_assistant_knowledge.mjs —— 助手知识库单测（node:test）
// js/assistant/knowledge.js 纯数据+纯函数（数值 import 自 config.js/textureTiles.js），Node 可直连。
// 运行：cd <仓库根> && node --test tools/test_assistant_knowledge.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { KNOWLEDGE_SECTIONS, searchKnowledge, knowledgeIndexText } from '../js/assistant/knowledge.js';
import { TEXTURE_TILES, atlasSize, occupiedTiles, freeTileRanges } from '../js/textureTiles.js';

const EXPECTED_IDS = [
    'physics','hydraulics','physics-motion',
    'ids', 'mining', 'world', 'redstone', 'piston', 'kinetic', 'logistics', 'elevator',
    'home', 'homestead', 'adventure', 'survival', 'mobs', 'tnt', 'saves', 'modules', 'recipes', 'keys', 'media', 'edu',
];

// 空闲 tile 区间的渲染口径（与 knowledge.js / docs.js 文案生成保持同一格式）
const formatTileRanges = (ranges) => ranges.map(([a, b]) => (a === b ? String(a) : `${a}..${b}`)).join('、');

test('结构：章节齐全有序，id 唯一，字段非空，单节体量可控（检索结果不爆 token）', () => {
    assert.equal(KNOWLEDGE_SECTIONS.length, EXPECTED_IDS.length);
    assert.deepEqual(KNOWLEDGE_SECTIONS.map((s) => s.id), EXPECTED_IDS);
    for (const s of KNOWLEDGE_SECTIONS) {
        assert.ok(s.title && s.title.length >= 4, `${s.id} 标题缺失`);
        assert.ok(Array.isArray(s.keywords) && s.keywords.length >= 4, `${s.id} keywords 太少（检索靠它）`);
        assert.ok(s.text && s.text.length >= 200, `${s.id} 正文太短`);
        assert.ok(s.text.length <= 3000, `${s.id} 正文 ${s.text.length} 字符，超预算（精简手册不该这么长）`);
    }
});

test('检索：关键词查询命中正确章节且排在首位', () => {
    assert.equal(searchKnowledge('红石 时钟')[0].id, 'redstone');
    assert.equal(searchKnowledge('地图 路标 浅矿洞')[0].id, 'adventure');
    assert.equal(searchKnowledge('盾 护具 维修')[0].id, 'adventure');
    assert.equal(searchKnowledge('粉碎轮 应力')[0].id, 'kinetic');
    assert.equal(searchKnowledge('电梯 滑轮 卷绳')[0].id, 'elevator');
    assert.equal(searchKnowledge('传送带 投料器')[0].id, 'logistics');
    assert.equal(searchKnowledge('新增 方块 步骤')[0].id, 'recipes');
    assert.equal(searchKnowledge('活塞 粘液 推')[0].id, 'piston');
    assert.equal(searchKnowledge('存档 槽位')[0].id, 'saves');
    assert.equal(searchKnowledge('答题机 题库')[0].id, 'edu');
});

test('检索：tnt / media 新节命中（关键词「TNT/爆炸/引爆/苦力怕」与「录像/拍摄/镜头/BGM/配乐/音量」）', () => {
    assert.equal(searchKnowledge('TNT 爆炸')[0].id, 'tnt');
    assert.equal(searchKnowledge('怎么引爆 TNT')[0].id, 'tnt');
    assert.equal(searchKnowledge('苦力怕 自爆')[0].id, 'tnt');
    assert.equal(searchKnowledge('TNT 陷阱 压力板')[0].id, 'tnt');
    assert.equal(searchKnowledge('录像 BGM')[0].id, 'media');
    assert.equal(searchKnowledge('拍摄 镜头 自动取景')[0].id, 'media');
    assert.equal(searchKnowledge('音量 配乐')[0].id, 'media');
});

test('检索：口语长句（含填充词）仍能靠二字滑窗命中', () => {
    assert.equal(searchKnowledge('帮我看看红石时钟怎么搭')[0].id, 'redstone');
    assert.equal(searchKnowledge('水车的应力容量是多少')[0].id, 'kinetic');
    assert.equal(searchKnowledge('怎么加一个新方块')[0].id, 'recipes');
});

test('检索：空查询/纯填充词/乱码 返回空而不抛错', () => {
    assert.deepEqual(searchKnowledge(''), []);
    assert.deepEqual(searchKnowledge('   '), []);
    assert.deepEqual(searchKnowledge('帮我 看看 怎么'), []);
    assert.deepEqual(searchKnowledge('zzzz ffff'), []);
});

test('内容防漂移：正文数值来自 config.js 实际导出（抽查关键锚点）', () => {
    const textOf = (id) => KNOWLEDGE_SECTIONS.find((s) => s.id === id).text;
    const all = KNOWLEDGE_SECTIONS.map((s) => s.text).join('\n');
    assert.ok(textOf('kinetic').includes('8 RPM'), '水车转速应来自 WHEEL_RPM');
    assert.ok(textOf('kinetic').includes('64 SU'), '水车应力应来自 WHEEL_SU_CAPACITY');
    assert.ok(textOf('ids').includes('224'), '答题机基址应来自 KEYPAD_BASE');
    assert.ok(textOf('ids').includes('出题笔'), '出题笔应来自 PEN_ID 渲染');
    assert.ok(textOf('ids').includes('232'), '星辉门基址应来自 STARLIGHT_BASE');
    assert.ok(textOf('survival').includes('木板×4'), '合成表应由 RECIPES 渲染出木板配方');
    assert.ok(textOf('survival').includes('熟猪排+8'), '食物值应由 BlockInfo.food 渲染（+8 为进食回复）');
    assert.ok(textOf('kinetic').includes('石头→圆石'), '粉碎配方应由 KINETIC_RECIPES 渲染');
    assert.ok(/苦力怕/.test(textOf('mobs')), '生物表应由 MOB_TYPES 渲染');
    assert.ok(/挖掘|硬度/.test(all) && textOf('mining').includes('0.3s'), '挖掘节奏应来自 BREAK_DELAY');
    assert.ok(textOf('tnt').includes('2.5s'), 'TNT 引信时长应与 tnt.js spawnTntEntity 一致');
    assert.ok(textOf('tnt').includes('1.8s') && textOf('tnt').includes('2.8'), '苦力怕引信参数应来自 config.js MOB_TYPES');
    assert.ok(textOf('media').includes('10 分钟'), '单段录像上限应与 recording.js MAX_SECONDS=600 一致');
    assert.ok(textOf('media').includes('bgm_'), 'BGM 文件名规则应写明 bgm_<pack>_<mood> 前缀');
});

test('tile 对账：分配表自洽，knowledge.js / docs.js 的图集文案不漂移', () => {
    const total = atlasSize * atlasSize;
    const occupied = occupiedTiles();
    const ranges = freeTileRanges();
    // 分配表三面 tile 全部落在图集范围内
    for (const t of TEXTURE_TILES) {
        for (const n of [t.top, t.side, t.bottom]) {
            assert.ok(Number.isInteger(n) && n >= 0 && n < total, `tile ${n} 越出 ${total} 格图集（${t.name}）`);
        }
    }
    // 空闲区间互不重叠、不与占用集相交，且占用 ∪ 空闲 = 整张图集
    let freeCount = 0;
    for (const [a, b] of ranges) {
        assert.ok(a <= b, `空闲区间 ${a}..${b} 起止颠倒`);
        for (let n = a; n <= b; n++) assert.ok(!occupied.has(n), `tile ${n} 同时出现在占用集与空闲区间`);
        freeCount += b - a + 1;
    }
    assert.equal(freeCount + occupied.size, total, '占用 ∪ 空闲应恰好铺满整张图集');
    // 关键锚点：45..72 已占用（防旧文案「空闲 45..63」复辟）、孤儿 tile 21/37 计入占用、80 空闲
    assert.ok([45, 63, 72].every((n) => occupied.has(n)), '生存进度组 tile 45..72 应为已占用');
    assert.ok(occupied.has(21) && occupied.has(37), '门上半/活塞内面孤儿 tile 应计入占用');
    assert.ok(!occupied.has(80) && occupied.has(79) && occupied.has(81), 'tile 80 应空闲（79/81 已占用）');
    // knowledge.js recipes 节的「空闲 tile」文案 = freeTileRanges() 动态渲染，且旧手写区间已删
    const recipes = KNOWLEDGE_SECTIONS.find((s) => s.id === 'recipes');
    assert.ok(recipes.text.includes(`空闲 tile ${formatTileRanges(ranges)}`), 'recipes 节空闲 tile 文案应由 textureTiles.freeTileRanges() 生成');
    assert.ok(!recipes.text.includes('45..63'), 'recipes 节不应再出现手写旧区间 45..63');
    // docs.js 系统提示词同样动态注入（源码层面核对：不再手写 atlasSize=8 / 45..63）
    const docsSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'assistant', 'docs.js'), 'utf8');
    assert.ok(!docsSrc.includes('atlasSize=8'), 'docs.js 不应再手写 atlasSize=8');
    assert.ok(!docsSrc.includes('45..63'), 'docs.js 不应再手写空闲区间 45..63');
    assert.ok(docsSrc.includes('freeTileRanges'), 'docs.js 的空闲 tile 文案应从 textureTiles.js 生成');
});

test('sources：每节带真实 js/ 来源，全部章节覆盖（「带来源的结论」的数据基础）', () => {
    for (const s of KNOWLEDGE_SECTIONS) {
        assert.ok(Array.isArray(s.sources) && s.sources.length >= 1, `${s.id} 缺 sources`);
        for (const src of s.sources) {
            assert.ok(src.startsWith('js/'), `${s.id} 的来源 ${src} 不以 js/ 开头`);
            assert.ok(!src.includes('..'), `${s.id} 的来源 ${src} 不应是相对上跳路径`);
        }
    }
});

test('目录（注入系统提示词）：覆盖全部章节且每行含 id 与标题', () => {
    const idx = knowledgeIndexText();
    for (const s of KNOWLEDGE_SECTIONS) {
        assert.ok(idx.includes(`- ${s.id}｜${s.title}｜`), `目录缺章节 ${s.id}`);
    }
    // 目录行数 = 章节数（每节一行，保持提示词精简）
    assert.equal(idx.split('\n').length, KNOWLEDGE_SECTIONS.length);
});

test('排序稳定性：多命中时强词（整词命中关键词表）优先于弱词（二字滑窗命中正文）', () => {
    const hits = searchKnowledge('红石'); // redstone 应压过仅在正文提到「红石」的其他节
    assert.equal(hits[0].id, 'redstone');
});
