// tools/test_assistant_knowledge.mjs —— 助手知识库单测（node:test）
// js/assistant/knowledge.js 纯数据+纯函数（数值 import 自 config.js），Node 可直连。
// 运行：cd <仓库根> && node --test tools/test_assistant_knowledge.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWLEDGE_SECTIONS, searchKnowledge, knowledgeIndexText } from '../js/assistant/knowledge.js';

const EXPECTED_IDS = [
    'ids', 'mining', 'world', 'redstone', 'piston', 'kinetic', 'logistics', 'elevator',
    'survival', 'mobs', 'saves', 'modules', 'recipes', 'keys', 'edu',
];

test('结构：15 节齐全，id 唯一，字段非空，单节体量可控（检索结果不爆 token）', () => {
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
    assert.equal(searchKnowledge('粉碎轮 应力')[0].id, 'kinetic');
    assert.equal(searchKnowledge('电梯 滑轮 卷绳')[0].id, 'elevator');
    assert.equal(searchKnowledge('传送带 投料器')[0].id, 'logistics');
    assert.equal(searchKnowledge('新增 方块 步骤')[0].id, 'recipes');
    assert.equal(searchKnowledge('活塞 粘液 推')[0].id, 'piston');
    assert.equal(searchKnowledge('存档 槽位')[0].id, 'saves');
    assert.equal(searchKnowledge('答题机 题库')[0].id, 'edu');
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
