// ==================== 动力组 × 物流组 × 电梯 × 物品 × 红石离合 跨模组集成测试 ====================
// 真实 import js/kinetic.js / js/items.js / js/redstone.js（拉杆）/ js/piston.js（平台载客/推平台），
// 覆盖两条自动化线的交界：水车供电 → 应力过载 → 齿轮转向冲突 → 离合器红石通断 →
// 传送带运物 → 粉碎轮/机械锯/投料器加工 → 滑轮电梯卷放绳/悬停/载客 → 活塞推平台脱绑重绑。
// 全部用 pump(dt) 推进逻辑时间（禁真实 sleep）；每条 test 一个 freshWorld（控制全图重算次数）。
//
// 运行：node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/kinetic-cross.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry } from 'three';
import { freshWorld, pump, at, setB, state } from './kit.mjs';
import {
    BELT_ITEM_ID, BlockTypes, CLUTCH_ITEM_ID, COGWHEEL_ITEM_ID, CRUSHER_ITEM_ID,
    CRUSHER_SU_LOAD, DEPLOYER_ITEM_ID, DEPLOYER_SEC, ItemTypes, LEVER_ITEM_ID,
    LIFT_SPEED, BELT_SPEED, PISTON_ITEM_ID, PLATFORM_ITEM_ID, PULLEY_ITEM_ID,
    SAW_ITEM_ID, SAW_SU_LOAD, SHAFT_ITEM_ID, WHEEL_RPM, WHEEL_SU_CAPACITY,
    WATERWHEEL_ITEM_ID,
} from '../../js/config.js';
import {
    breakKineticAt, crusherIntakeError, isBeltRunningAt, kineticStatusAt,
    placeKinetic, updateKineticNetwork,
} from '../../js/kinetic.js';
import { spawnItemDrop } from '../../js/items.js';
import { placeRedstone, toggleLeverAt } from '../../js/redstone.js';
import { placePiston } from '../../js/piston.js';

// ---- 面法线快捷方式（placeKinetic/placeRedstone 的 face 参数=所点击面的法线）----
const UP = { dx: 0, dy: 1, dz: 0 };
const DOWN = { dx: 0, dy: -1, dz: 0 };
const FX = { dx: 1, dy: 0, dz: 0 }; // 东
const FZ = { dx: 0, dy: 0, dz: 1 }; // 南

const findDrop = (itemId) => state.itemDrops.find((d) => d.itemId === itemId);

// ---- 底座缺口兜底（只在本测试进程内生效，不改共享桩文件）----
// tests/gamelogic/stubs/three-logic.mjs 有两处没覆盖到掉落物几何路径，js/items.js 的
// spawnItemDrop 在无头环境一调用就崩：
//   ① 桩的 BoxGeometry 只存参数、不带 uv 顶点属性 → items.js:38 `geo.attributes.uv` 为 undefined；
//   ② 桩的 BufferAttribute 没有 setXY 方法 → items.js:37 `uvAttr.setXY(...)` 不是函数。
// 这里在原型上补齐（逻辑测试不渲染，uv 数值无所谓，只要有可写的 attribute 对象）。
if (!Object.getOwnPropertyDescriptor(BufferGeometry.prototype, 'attributes')) {
    Object.defineProperty(BufferGeometry.prototype, 'attributes', {
        configurable: true,
        get() { return this.__attrs; },
        set(v) {
            if (v && !v.uv) v.uv = new BufferAttribute(new Float32Array(24 * 2), 2);
            this.__attrs = v;
        },
    });
}
if (typeof BufferAttribute.prototype.setXY !== 'function') {
    BufferAttribute.prototype.setXY = function (i, x, y) {
        this.array[i * this.itemSize] = x;
        this.array[i * this.itemSize + 1] = y;
        return this;
    };
}

// 贴支撑石放拉杆：face=支撑面法线（指向拉杆格），support=[x,y,z] 支撑石坐标（自动放置）
function placeLever(x, y, z, face, support) {
    setB(support[0], support[1], support[2], BlockTypes.STONE);
    assert.equal(placeRedstone(x, y, z, LEVER_ITEM_ID, face), null, '拉杆放置成功');
}

// 标准南北向动力线：先灌水再放水车（游戏里放置 WATER 是动力重算触发点，
// 先放水则水车放置自带的全网重算即可见水），水车 (24,9,28) + 沿 +Z 串 n 根传动轴
function buildZLine(n) {
    setB(24, 10, 28, BlockTypes.WATER);
    assert.equal(placeKinetic(24, 9, 28, WATERWHEEL_ITEM_ID, FZ), null, '水车放置（点击面法线定轴=南北向）');
    for (let i = 1; i <= n; i++) {
        assert.equal(placeKinetic(24, 9, 28 + i, SHAFT_ITEM_ID, FZ), null, '传动轴同轴串联');
    }
}

// 竖直电梯标准布局：水车(28,17,30)顶水(28,18,30) → 立轴(28,15..16,30) →
// 朝下垂挂滑轮(28,14,30，点底面放置) → 正下方 3 格绳长放平台(28,11,30)自动绑绳；
// 拉杆(28,14,29)贴支撑石(28,14,28)，与滑轮相邻（红石 6 邻充能=卷绳）
function buildPulleyLift() {
    setB(28, 18, 30, BlockTypes.WATER);
    assert.equal(placeKinetic(28, 17, 30, WATERWHEEL_ITEM_ID, UP), null, '立式水车');
    for (const y of [15, 16]) {
        assert.equal(placeKinetic(28, y, 30, SHAFT_ITEM_ID, UP), null, '立轴');
    }
    assert.equal(placeKinetic(28, 14, 30, PULLEY_ITEM_ID, DOWN), null, '滑轮点底面=朝下垂挂');
    assert.equal(placeKinetic(28, 11, 30, PLATFORM_ITEM_ID, UP), null, '平台任意空格可放');
    placeLever(28, 14, 29, { dx: 0, dy: 0, dz: 1 }, [28, 14, 28]);
}

test('1. 水车=动力源：顶面泡水 → 串联传动轴显示 8 RPM，抽水即停', () => {
    freshWorld();
    setB(24, 10, 30, BlockTypes.WATER); // 水车顶面灌水（守卫：WATER 直接 setB）
    assert.equal(placeKinetic(24, 9, 30, WATERWHEEL_ITEM_ID, FX), null, '水车点击面法线=东西轴');
    assert.equal(placeKinetic(25, 9, 30, SHAFT_ITEM_ID, FX), null, '传动轴同轴 1:1 串联');
    // 水车顶面接触静态水=全网 8 RPM 动力源；轴是纯传动件零负载 → 应力 0/64
    assert.match(kineticStatusAt(25, 9, 30), new RegExp(`转速 ${WHEEL_RPM} RPM`), '轴随水车在转');
    assert.ok(kineticStatusAt(25, 9, 30).includes(`应力 0/${WHEEL_SU_CAPACITY}`), '纯传动件不计应力负载');
    // 反证：抽掉水 → 无动力源。游戏里破坏 WATER 同样触发动力重算（interaction.js 触发点），
    // 无头测试 setB 后手动调用导出的 updateKineticNetwork 与之等价
    setB(24, 10, 30, BlockTypes.AIR);
    updateKineticNetwork();
    assert.ok(kineticStatusAt(25, 9, 30).includes('静止（需要水车驱动）'), '断水整网静止');
});

test('2. 应力容量与过载：两台粉碎轮恰好满载在转，第 3 台 → 整网停转带不运转', () => {
    freshWorld();
    buildZLine(2); // 水车(24,9,28) + 轴(24,9,29)(24,9,30)
    // 两台南北轴粉碎轮沿东西向相邻配对（连线垂直于轴）→ 2×32=64 恰好=单水车容量
    assert.equal(placeKinetic(23, 9, 31, CRUSHER_ITEM_ID, FZ), null, '粉碎轮 A');
    assert.equal(placeKinetic(24, 9, 31, CRUSHER_ITEM_ID, FZ), null, '粉碎轮 B（与 A 配对）');
    assert.ok(
        kineticStatusAt(23, 9, 31).includes(`转速 ${WHEEL_RPM} RPM · 应力 ${2 * CRUSHER_SU_LOAD}/${WHEEL_SU_CAPACITY}`),
        'load==capacity 不算过载（过载判据是严格大于），满载仍在转',
    );
    // 第 3 台与 B 相邻再成对 → 3×32=96 > 64 → 过载整网停转
    assert.equal(placeKinetic(25, 9, 31, CRUSHER_ITEM_ID, FZ), null, '粉碎轮 C（与 B 配对）');
    assert.ok(kineticStatusAt(23, 9, 31).includes('⛔ 过载'), '负载超容量整网停转');
    // 传送带接入同一分量：网络停 → isBeltRunningAt=false（items.js 骑带判定共用此查询）
    assert.equal(placeKinetic(25, 9, 30, BELT_ITEM_ID, FZ), null, '带贴实心顶面放置');
    assert.equal(isBeltRunningAt(25, 9, 30), false, '过载网络里的带不运转');
    assert.ok(kineticStatusAt(25, 9, 30).includes('过载'), '带文案同样报过载');
    // 解除过载：拆带(-4)再拆第 3 台(-32) → 64=64 恢复在转（破坏走 breakKineticAt 自带重算）
    breakKineticAt(25, 9, 30);
    breakKineticAt(25, 9, 31);
    assert.ok(kineticStatusAt(23, 9, 31).includes(`转速 ${WHEEL_RPM} RPM`), '负载回到容量内自动恢复');
});

test('3. 齿轮垂直啮合：一次换向的两水车对顶 → 转向冲突整网卡死，消除反向源恢复', () => {
    freshWorld();
    setB(24, 10, 30, BlockTypes.WATER);
    setB(26, 15, 30, BlockTypes.WATER);
    assert.equal(placeKinetic(24, 9, 30, WATERWHEEL_ITEM_ID, FX), null, '水车 W1（东西轴）');
    assert.equal(placeKinetic(25, 9, 30, SHAFT_ITEM_ID, FX), null);
    assert.equal(placeKinetic(26, 9, 30, COGWHEEL_ITEM_ID, FX), null, 'X 齿轮');
    assert.equal(placeKinetic(26, 10, 30, COGWHEEL_ITEM_ID, UP), null, 'Y 齿轮：与 X 齿轮垂直啮合=换向反转');
    for (const y of [11, 12, 13]) {
        assert.equal(placeKinetic(26, y, 30, SHAFT_ITEM_ID, UP), null, '立轴链');
    }
    assert.equal(placeKinetic(26, 14, 30, WATERWHEEL_ITEM_ID, UP), null, '水车 W2（上下轴，经奇数次啮合被反向到达）');
    // 转向符号无法从文案直读，但「同格被相反转向到达/有水水车被反向到达=卡死」是可观测面：
    // W2 被反向驱动 → 整网（含 W1 侧的轴）卡死停转
    assert.ok(kineticStatusAt(25, 9, 30).includes('卡死'), '两台有水水车经奇数次啮合对顶=转向冲突');
    setB(26, 15, 30, BlockTypes.AIR); // 抽掉 W2 的水：反向驱动源消失
    updateKineticNetwork();
    assert.ok(kineticStatusAt(25, 9, 30).includes(`转速 ${WHEEL_RPM} RPM`), '只剩 W1 供电：齿轮啮合边连通且全网正常在转');
});

test('4. 离合器红石通断：充能断开下游停/水车侧照转，断电恢复接合', () => {
    freshWorld();
    setB(24, 10, 30, BlockTypes.WATER);
    assert.equal(placeKinetic(24, 9, 30, WATERWHEEL_ITEM_ID, FX), null, '水车');
    assert.equal(placeKinetic(25, 9, 30, CLUTCH_ITEM_ID, FX), null, '离合器串进轴中段（同轴编码）');
    assert.equal(placeKinetic(26, 9, 30, BELT_ITEM_ID, FX), null, '带贴在离合器下游');
    placeLever(25, 9, 31, { dx: 0, dy: 0, dz: -1 }, [25, 9, 32]); // 拉杆与离合器相邻
    // 拉杆关：离合器接合 → 带随水车运转
    assert.equal(isBeltRunningAt(26, 9, 30), true, '接合态下游带运转');
    assert.ok(kineticStatusAt(25, 9, 30).includes('接合'), '离合器接合文案');
    // 拉杆开：红石充能=断开传动（电平语义回写变体并触发动力重算，redstone.js 电平写出门）
    toggleLeverAt(25, 9, 31);
    assert.equal(isBeltRunningAt(26, 9, 30), false, '断开后带自成无动力分量停转');
    assert.ok(kineticStatusAt(25, 9, 30).includes('断开'), '断开态优先提示');
    assert.ok(kineticStatusAt(24, 9, 30).includes(`转速 ${WHEEL_RPM} RPM`), '水车侧照转（断开=上下游各自成无动力/有动力分量）');
    // 拉杆再关：电平恢复接合 → 带恢复运转
    toggleLeverAt(25, 9, 31);
    assert.equal(isBeltRunningAt(26, 9, 30), true, '重新接合带恢复');
});

test('5. 传送带运物：1.5 格/秒沿带向移动、抵墙停留、断电原地停复电续走', () => {
    freshWorld();
    state.player.yaw = -Math.PI / 2; // 面朝东：带向=放置时玩家水平朝向量化（facingFromYaw）=+X
    setB(24, 10, 30, BlockTypes.WATER);
    assert.equal(placeKinetic(24, 9, 30, WATERWHEEL_ITEM_ID, FX), null, '水车');
    assert.equal(placeKinetic(25, 9, 30, CLUTCH_ITEM_ID, FX), null, '离合器（做带的电闸）');
    for (const x of [26, 27, 28]) {
        assert.equal(placeKinetic(x, 9, 30, BELT_ITEM_ID, FX), null, '三格带（向 +X）');
    }
    setB(29, 9, 30, BlockTypes.STONE);
    setB(29, 10, 30, BlockTypes.STONE); // 带尽头砌墙
    placeLever(25, 9, 31, { dx: 0, dy: 0, dz: -1 }, [25, 9, 32]);
    spawnItemDrop(26.5, 9.3, 30.5, BlockTypes.STONE, 1); // 落在带格上（feet=带格 y=9）
    pump(0.05, 20); // 1.0s × BELT_SPEED 1.5 = 1.5 格
    const d = state.itemDrops[0];
    assert.ok(Math.abs(d.x - 28.0) < 0.02, `carried 应沿 +X 匀速走 1.5 格（实测 x=${d.x}）`);
    assert.ok(Math.abs(d.y - 9.15) < 0.01, '骑行面收敛到带格底+BELT_RIDE_Y(0.15)');
    assert.equal(d.mesh.position.x, d.x, 'three 桩带真数值 position，可白盒断言');
    // 拉杆开 → 离合器断开 → 带停：物品原地停住（脚还踩在带上=停走不滑行）
    toggleLeverAt(25, 9, 31);
    pump(0.05, 10);
    const stopX = d.x;
    assert.equal(d.carried, false, '断电退出 carried 模式');
    assert.equal(d.x, stopX, '原地停不滑行');
    // 拉杆关 → 重新接合 → 带续走（寿命内复电再带走）
    toggleLeverAt(25, 9, 31);
    pump(0.05, 10);
    assert.ok(d.x > stopX, `复电续走（${stopX} → ${d.x}）`);
    // 走到带尽头：前方实心墙=抵墙停留不穿越
    pump(0.05, 40);
    assert.ok(d.x < 29 && d.x > 28.5, `抵墙停在末格内（x=${d.x}）`);
    const wallX = d.x;
    pump(0.05, 20);
    assert.equal(d.x, wallX, '继续泵帧不再前进（前方格实心）');
});

test('6. 传送带需邻动力：孤立带不运转，带上物品原地不动', () => {
    freshWorld();
    assert.equal(placeKinetic(30, 9, 30, BELT_ITEM_ID, FZ), null, '孤立带（周围无任何动力方块）');
    assert.equal(isBeltRunningAt(30, 9, 30), false, '无邻接通电动力 → 不运转');
    assert.ok(kineticStatusAt(30, 9, 30).includes('静止（需要水车驱动）'), '文案说明缺动力');
    spawnItemDrop(30.5, 9.3, 30.5, BlockTypes.STONE, 1);
    pump(0.05, 30);
    const d = state.itemDrops[0];
    assert.ok(!d.carried, '未进入 carried 模式（带没在转）');
    assert.equal(d.x, 30.5, 'x 不动');
    assert.equal(d.z, 30.5, 'z 不动');
});

test('7. 粉碎轮四级链：石头→圆石→沙砾，产出走真物品实体；非配方方块投不进', () => {
    freshWorld();
    buildZLine(2);
    assert.equal(placeKinetic(23, 9, 31, CRUSHER_ITEM_ID, FZ), null, '粉碎轮 A');
    assert.equal(placeKinetic(24, 9, 31, CRUSHER_ITEM_ID, FZ), null, '粉碎轮 B（配对后上方格=投料口）');
    // 投料口守卫 crusherIntakeError：只对「配对轮正上方」生效；泥土不在配方表 → 拦，石头放行
    assert.ok(typeof crusherIntakeError(23, 10, 31, BlockTypes.DIRT) === 'string', '泥土投不进（报错文案）');
    assert.equal(crusherIntakeError(23, 10, 31, BlockTypes.STONE), null, '石头可碾');
    assert.equal(crusherIntakeError(30, 10, 30, BlockTypes.DIRT), null, '非投料口位置不拦');
    // 一级：投料口放石头块 → CRUSH_SEC(1.2s) 后消失，产出圆石物品实体
    setB(23, 10, 31, BlockTypes.STONE);
    pump(0.05, 25); // 1.25s ≥ 1.2s
    assert.equal(at(23, 10, 31), BlockTypes.AIR, '投入的石头块被碾走');
    const cobble = findDrop(BlockTypes.COBBLESTONE);
    assert.ok(cobble, '产出圆石真物品实体（state.itemDrops）');
    assert.equal(cobble.count, 1, '石头→圆石数量 1');
    // 二级：圆石 → 沙砾
    setB(24, 10, 31, BlockTypes.COBBLESTONE);
    pump(0.05, 25);
    assert.equal(at(24, 10, 31), BlockTypes.AIR, '圆石块被碾走');
    assert.ok(findDrop(BlockTypes.GRAVEL), '圆石碾出沙砾（四级链第二级）');
});

test('8. 机械锯：锯切朝向格原木 → 变空气产出木板×4', () => {
    freshWorld();
    buildZLine(1); // 水车(24,9,28) + 轴(24,9,29)
    assert.equal(placeKinetic(24, 9, 30, SAW_ITEM_ID, FZ), null, '锯朝 +Z：朝向格(24,9,31)=被锯目标，背面接轴');
    assert.ok(
        kineticStatusAt(24, 9, 30).includes(`转速 ${WHEEL_RPM} RPM · 应力 ${SAW_SU_LOAD}/${WHEEL_SU_CAPACITY}`),
        '锯计负载 24，网络正常在转',
    );
    setB(24, 9, 31, BlockTypes.WOOD);
    pump(0.05, 12); // 0.6s ≥ 2.0×1.5÷SAW_SPEED(6)=0.5s
    assert.equal(at(24, 9, 31), BlockTypes.AIR, '朝向格原木被锯掉');
    const planks = findDrop(BlockTypes.PLANKS);
    assert.ok(planks, '产出木板物品实体');
    assert.equal(planks.count, 4, '锯切转换：原木→木板×4（不是原版掉落×1）');
});

test('9. 投料器：捕获格的方块类物品变方块塞进朝向格；材料/食物不投', () => {
    freshWorld();
    buildZLine(1);
    assert.equal(placeKinetic(24, 9, 30, DEPLOYER_ITEM_ID, FZ), null, '投料器朝 +Z：朝向格 T=(24,9,31)，背面接轴');
    assert.ok(kineticStatusAt(24, 9, 30).includes(`投料节拍 ${DEPLOYER_SEC}s`), '运转态文案附节拍');
    // 守卫先证：苹果是 item 材料（不可放置）→ 不被消耗、朝向格保持空气
    spawnItemDrop(24.5, 9.6, 31.5, ItemTypes.APPLE, 1);
    pump(0.05, 4);
    assert.ok(findDrop(ItemTypes.APPLE), '苹果仍留在物品实体列表');
    assert.equal(at(24, 9, 31), BlockTypes.AIR, '苹果没有被投成方块');
    // 方块类物品（石头）→ 首帧冷却为 0 立即投：物品被消耗、朝向格变石头
    spawnItemDrop(24.5, 9.6, 31.5, BlockTypes.STONE, 1);
    pump(0.05, 4); // 0.2s 内含首帧（DEPLOYER_SEC 节拍从 0 起步即投）
    assert.equal(at(24, 9, 31), BlockTypes.STONE, '可放置方块物品变回方块塞进朝向格');
    assert.equal(findDrop(BlockTypes.STONE), undefined, '该物品实体被消耗');
    assert.ok(findDrop(ItemTypes.APPLE), '苹果原样保留（守卫不拦整条扫描循环）');
});

test('10. 滑轮电梯：充能卷绳上升、行程端点停、断电放绳、无动力悬停', () => {
    freshWorld();
    buildPulleyLift();
    // 绑定是纯派生态，非白盒观测面=状态文案：已绑定+有动力+未充能 →「放绳·平台下降」且在转
    assert.ok(kineticStatusAt(28, 14, 30).includes('放绳·平台下降'), '平台已自动绑绳且网络在转');
    assert.ok(kineticStatusAt(28, 14, 30).includes(`升降 ${LIFT_SPEED} 格/秒`), '绑定滑轮计入负载后仍正常运转');
    toggleLeverAt(28, 14, 29); // 充能=卷绳：平台向滑轮收拢（朝下垂挂 → 平台上升）
    pump(0.05, 15); // 0.75s ≥ 跨格节拍 1/LIFT_SPEED≈0.667s
    assert.equal(at(28, 12, 30), PLATFORM_ITEM_ID, '平台跨格上升一格');
    pump(0.05, 15);
    assert.equal(at(28, 13, 30), PLATFORM_ITEM_ID, '再升一格');
    pump(0.05, 15);
    assert.equal(at(28, 13, 30), PLATFORM_ITEM_ID, '前方格=滑轮格非空气 → 行程端点停住');
    assert.ok(kineticStatusAt(28, 14, 30).includes('行程端点'), '端点态有 HUD 文案（滑轮空转不 jam 整网）');
    toggleLeverAt(28, 14, 29); // 断电=放绳：平台远离滑轮（受控下行，非坠落）
    pump(0.05, 15);
    assert.equal(at(28, 12, 30), PLATFORM_ITEM_ID, '放绳下行一格');
    // 无动力（断水）= 悬停：平台停在半空不坠落（照「停机冻结」语义）
    setB(28, 18, 30, BlockTypes.AIR);
    updateKineticNetwork();
    pump(0.05, 30);
    assert.equal(at(28, 12, 30), PLATFORM_ITEM_ID, '无动力悬停：phase 冻结一格都不走');
    assert.ok(kineticStatusAt(28, 14, 30).includes('悬停'), '悬停态文案');
});

test('11. 平台载客：卷绳平台升一格，站顶玩家跟着 +1（carryRiders 跨模块）', () => {
    freshWorld();
    buildPulleyLift();
    // P1 承载碰撞检查：原 y=11 平台升至 12 后玩家头顶进入 y=14 滑轮。
    // 将起始平台下移一格，保留「平台与玩家共同上升一格」的原验收目的。
    setB(28, 11, 30, BlockTypes.AIR);
    setB(28, 10, 30, PLATFORM_ITEM_ID);
    updateKineticNetwork();
    const p = state.player;
    p.x = 28.5; p.y = 11; p.z = 30.5; // 站在平台格 y=10 的顶面=11
    toggleLeverAt(28, 14, 29); // 卷绳
    pump(0.05, 15);
    assert.equal(at(28, 11, 30), PLATFORM_ITEM_ID, '平台跨格上升一格');
    assert.equal(at(28, 10, 30), BlockTypes.AIR, '旧格已清空');
    assert.equal(p.y, 12, '玩家被 carryRiders（piston.js 导出、kinetic.js 调用）载运 y+1');
});

test('12. 活塞推平台脱绑：推离绳路径卷绳不动，推回绳路径重新绑上可动', () => {
    freshWorld();
    buildPulleyLift();
    // 活塞 1 在平台西侧一格朝 +Z（正对平台），贴支撑石拉杆供电
    assert.equal(placePiston(28, 11, 29, PISTON_ITEM_ID, FZ), null, '活塞朝 +Z 正对平台');
    placeLever(28, 11, 28, { dx: 1, dy: 0, dz: 0 }, [27, 11, 28]);
    assert.ok(kineticStatusAt(28, 14, 30).includes('升降'), '初始平台已绑定');
    toggleLeverAt(28, 11, 28); // 活塞伸出：平台 (28,11,30)→(28,11,31)，推完自动触发动力重算
    pump(0.05, 8); // 0.4s ≥ 活塞延迟 0.15s
    assert.equal(at(28, 11, 31), PLATFORM_ITEM_ID, '平台被水平推离绳路径');
    assert.ok(kineticStatusAt(28, 14, 30).includes('未找到平台'), '绳路径上只剩活塞头 → 脱绑');
    // 脱绑后卷绳：滑轮空转、平台不再动
    toggleLeverAt(28, 14, 29);
    pump(0.05, 30);
    assert.equal(at(28, 11, 31), PLATFORM_ITEM_ID, '未绑定 → pulleyBinds 无此滑轮，平台一格不动');
    // 活塞 1 收回让出格（普通活塞收回：平台留在推达位置），活塞 2 从东侧把平台推回绳路径
    toggleLeverAt(28, 11, 28);
    pump(0.05, 8);
    assert.equal(at(28, 11, 30), BlockTypes.AIR, '活塞 1 头已撤回');
    assert.equal(placePiston(28, 11, 32, PISTON_ITEM_ID, { dx: 0, dy: 0, dz: -1 }), null, '活塞 2 朝 -Z 正对平台');
    placeLever(28, 11, 33, { dx: 0, dy: 0, dz: -1 }, [28, 11, 34]);
    toggleLeverAt(28, 11, 33); // 推回：平台 (28,11,31)→(28,11,30) 回到绳路径
    pump(0.05, 8);
    assert.equal(at(28, 11, 30), PLATFORM_ITEM_ID, '平台被推回绳路径格');
    assert.ok(kineticStatusAt(28, 14, 30).includes('升降'), '活塞推完的动力重算重建绳绑定 → 重新绑定');
    pump(0.05, 15); // 滑轮拉杆仍充能（卷绳） → 绑定恢复后平台应可动
    assert.equal(at(28, 12, 30), PLATFORM_ITEM_ID, '重新绑上后可动：卷绳上升一格');
});
