// ==================== 红石火把双级反相（用户所称「双相开关」）====================
// 结构：拉杆 S → 方块 B1 → 火把 F1(B1)（第一级反相）→ 方块 B2 → 火把 F2(B2)（第二级反相）。
// 期望 F2 = NOT F1（S 开：F1 灭 F2 亮；S 关：F1 亮 F2 灭）。
//
// 结论（2026-09-25 用户报告「竖着行、平铺不行」的根因）：亮火把**只强充能正上方一格**
// 方块（js/redstone.js powerBlock(s.x, s.y+1, s.z)，对齐原版火把塔规则），不充能水平
// 邻块——水平充能是红石粉的职责（激活粉充能脚下+四邻水平）。
//   · 竖着放（B2 压在 F1 头顶）→ F1 亮时充能 B2 → F2 正常翻转 ✅
//   · 平铺（B2 与 F1 水平相邻）→ B2 永远不被充能 → F2 纹丝不动（原版同样如此，非 bug）
//   · 平铺 + 火把与 B2 之间垫一格红石粉 → 粉接力充能 B2 → F2 正常翻转 ✅（平铺正解）
// 本文件按上述**现行（正确）行为**断言，防将来误改火把充能规则引入自振荡
// （壁挂火把的挂靠块就是水平邻块，充能它 = 亮火把自己供能挂靠块 = 310ms 自振荡）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, pump, at, setB } from './kit.mjs';
import { placeRedstone, toggleLeverAt } from '../../js/redstone.js';
import {
    DUST_ITEM_ID, LEVER_ITEM_ID, RTORCH_ITEM_ID, BlockTypes, rtorchLit,
} from '../../js/config.js';

const STONE = BlockTypes.STONE;
const litOf = (x, y, z) => rtorchLit(at(x, y, z));

// 组装工具：S 贴 B1 西面（face 法线指向新格 = 从支撑指向元件）
function buildStage(x, y, z) {
    // B1 在 (x,y,z)，S 在 (x-1,y,z) 贴 B1 西面
    setB(x, y, z, STONE);
    assert.equal(placeRedstone(x - 1, y, z, LEVER_ITEM_ID, { dx: -1, dy: 0, dz: 0 }), null, '拉杆应贴 B1 西面放成功');
    return {
        S: [x - 1, y, z],
        B1: [x, y, z],
    };
}

test('火把双级反相：竖着放（B2 压 F1 头顶）F2 = NOT F1，两拍级联', () => {
    freshWorld();
    const y = 9;
    const { S, B1 } = buildStage(20, y, 20);
    // F1 贴地立在 B1 顶上（挂靠 = B1）
    assert.equal(placeRedstone(B1[0], y + 1, B1[2], RTORCH_ITEM_ID, { dx: 0, dy: 1, dz: 0 }), null);
    // B2 直接压在 F1 头顶（竖式火把塔：亮火把强充能正上方方块）
    setB(B1[0], y + 2, B1[2], STONE);
    // F2 贴地立在 B2 顶上（挂靠 = B2）
    assert.equal(placeRedstone(B1[0], y + 3, B1[2], RTORCH_ITEM_ID, { dx: 0, dy: 1, dz: 0 }), null);
    const F1 = [B1[0], y + 1, B1[2]];
    const F2 = [B1[0], y + 3, B1[2]];

    pump(0.05, 8); // 初始态收敛：F1 亮 → 充能 B2 → F2 应翻转为灭
    assert.equal(litOf(...F1), 1, 'S 关：F1 亮');
    assert.equal(litOf(...F2), 0, 'S 关：F1 亮 → B2 被充能 → F2 灭');

    // S 开 → F1 灭（0.1s 延迟）→ B2 解除充能 → F2 亮（再一拍 0.1s 延迟）
    toggleLeverAt(...S);
    pump(0.05, 3); // 0.15s：第一拍完成、第二拍未到
    assert.equal(litOf(...F1), 0, 'S 开：F1 先灭');
    assert.equal(litOf(...F2), 0, '级联第二拍未到，F2 暂时还灭');
    pump(0.05, 5);
    assert.equal(litOf(...F2), 1, 'S 开：F2 后亮（F2 = NOT F1）');

    // S 关 → F1 复亮 → B2 被充能 → F2 灭
    toggleLeverAt(...S);
    pump(0.05, 8);
    assert.equal(litOf(...F1), 1, 'S 关：F1 复亮');
    assert.equal(litOf(...F2), 0, 'S 关：F2 灭');
});

test('火把双级反相：平铺（B2 与 F1 水平相邻）F2 不受 F1 影响——火把不充能水平方块', () => {
    freshWorld();
    const y = 9;
    const { S, B1 } = buildStage(30, y, 30);
    // 一字排开：B1(30) F1(31) B2(33) F2(34)，F2 挂 B2 东面
    assert.equal(placeRedstone(31, y, 30, RTORCH_ITEM_ID, { dx: 1, dy: 0, dz: 0 }), null, 'F1 贴 B1 东面');
    setB(33, y, 30, STONE);
    assert.equal(placeRedstone(34, y, 30, RTORCH_ITEM_ID, { dx: 1, dy: 0, dz: 0 }), null, 'F2 贴 B2 东面');
    const F1 = [31, y, 30];
    const F2 = [34, y, 30];

    pump(0.05, 8);
    assert.equal(litOf(...F1), 1, 'S 关：F1 亮');
    assert.equal(litOf(...F2), 1, 'S 关：B2 未被充能（火把不充能水平邻块），F2 保持亮');

    toggleLeverAt(...S);
    pump(0.05, 8);
    assert.equal(litOf(...F1), 0, 'S 开：第一级反相正常，F1 灭');
    assert.equal(litOf(...F2), 1, 'S 开：F2 不受影响（用户观察到的现象）——B2 从未被充能');

    toggleLeverAt(...S);
    pump(0.05, 8);
    assert.equal(litOf(...F1), 1, 'S 关：F1 复亮');
    assert.equal(litOf(...F2), 1, 'S 关：F2 依旧不受影响');
});

test('火把双级反相：平铺正解——F1 与 B2 之间垫一格红石粉接力充能', () => {
    freshWorld();
    const y = 9;
    const { S, B1 } = buildStage(40, y, 40);
    // B1(40) F1(41) 粉(42) B2(43) F2(44)，粉坐在地面（y-1 为石头）
    assert.equal(placeRedstone(41, y, 40, RTORCH_ITEM_ID, { dx: 1, dy: 0, dz: 0 }), null, 'F1 贴 B1 东面');
    assert.equal(placeRedstone(42, y, 40, DUST_ITEM_ID, { dx: 0, dy: 1, dz: 0 }), null, '红石粉铺地面');
    setB(43, y, 40, STONE);
    assert.equal(placeRedstone(44, y, 40, RTORCH_ITEM_ID, { dx: 1, dy: 0, dz: 0 }), null, 'F2 贴 B2 东面');
    const F1 = [41, y, 40];
    const F2 = [44, y, 40];

    pump(0.05, 8);
    assert.equal(litOf(...F1), 1, 'S 关：F1 亮');
    assert.equal(litOf(...F2), 0, 'S 关：F1 亮 → 粉 15 级 → 充能 B2 → F2 灭');

    toggleLeverAt(...S);
    pump(0.05, 8);
    assert.equal(litOf(...F1), 0, 'S 开：F1 灭');
    assert.equal(litOf(...F2), 1, 'S 开：粉失电 → B2 解除充能 → F2 亮（平铺也能做成双相）');

    toggleLeverAt(...S);
    pump(0.05, 8);
    assert.equal(litOf(...F1), 1, 'S 关：F1 复亮');
    assert.equal(litOf(...F2), 0, 'S 关：F2 灭');
});
