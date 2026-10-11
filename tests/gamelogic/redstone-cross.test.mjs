// ==================== 红石 × 跨模组集成测试（纯 Node 无头） ====================
// 覆盖「红石模组 × 门/活塞/TNT/观察者/压力板」的跨模块行为，全部断言世界数据
// （state.blocks 里的方块 ID 与实体坐标），不碰任何 DOM。
// 运行：node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/redstone-cross.test.mjs
//
// 布线总原则（照 js/redstone.js 顶部注释的信号模型）：
//   信号源 15 级（RS_MAX_STRENGTH）→ 红石粉每格 -1、0 级断路 → 负载（灯/门/TNT/活塞）。
// 每个 test 独立 freshWorld()，坐标系互不重叠（纯粹为了可读，世界本来就会重建）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, pump, at, setB, state } from './kit.mjs';
import {
    placeRedstone, toggleLeverAt, breakRedstoneAt, popUnsupportedRedstone, updateRedstoneNetwork,
} from '../../js/redstone.js';
import { placePiston, enqueuePistonAction, fixPistonAround } from '../../js/piston.js';
import { tryPlaceDoor } from '../../js/door.js';
import { explode } from '../../js/tnt.js';
import {
    BlockTypes, GameModes,
    DUST_ITEM_ID, LEVER_ITEM_ID, LAMP_ITEM_ID, PLATE_ITEM_ID, RTORCH_ITEM_ID,
    PISTON_ITEM_ID, STICKY_PISTON_ITEM_ID, OBSERVER_ITEM_ID, DOOR_ITEM_ID,
    RS_MAX_STRENGTH, OBSERVER_PULSE_SEC, PISTON_PUSH_LIMIT,
    dustLit, leverOn, rtorchLit, isLampLitId, platePressed, doorOpen,
    isPistonId, pistonExtended, pistonHeadId, observerPowered,
} from '../../js/config.js';

// 常用朝向（face = 挂靠面法线，从支撑方块指向元件格）
const UP = { dx: 0, dy: 1, dz: 0 };
const EAST = { dx: 1, dy: 0, dz: 0 }; // +X，facing=3
const WEST = { dx: -1, dy: 0, dz: 0 }; // -X，facing=5

// 活塞延迟 0.15s，泵 4 帧（0.2s）保证队列动作必然消费完
const PUMP_PISTON = () => pump(0.05, 4);

test('1. 信号衰减：拉杆 + 16 格粉线，第 15 格仍亮（剩 1 级）、第 16 格断路、远端灯不亮', () => {
    freshWorld();
    const y = 9;
    // 拉杆贴地在 (10,y,10)，向 +x 铺 16 格粉（x=11..26），末端 (27,y,10) 放灯
    assert.equal(placeRedstone(10, y, 10, LEVER_ITEM_ID, UP), null);
    for (let x = 11; x <= 26; x++) {
        assert.equal(placeRedstone(x, y, 10, DUST_ITEM_ID, UP), null);
    }
    assert.equal(placeRedstone(27, y, 10, LAMP_ITEM_ID, UP), null);
    assert.equal(leverOn(at(10, y, 10)), 0, '拉杆初始关');
    assert.equal(dustLit(at(11, y, 10)), 0, '未供能前粉全灭');

    toggleLeverAt(10, y, 10);
    // 源 15 级直接注入拉杆邻格粉，此后每格 -1：距源 d 格的粉强度 = 16-d，
    // 强度 ≥1 即点亮 → d=15 剩 1 级仍亮，d=16 强度 0 断路
    for (let d = 1; d <= RS_MAX_STRENGTH; d++) {
        assert.equal(dustLit(at(10 + d, y, 10)), 1,
            `距源 ${d} 格的粉应亮（强度 ${RS_MAX_STRENGTH + 1 - d} > 0）`);
    }
    assert.equal(dustLit(at(26, y, 10)), 0, '第 16 格强度归 0，断路熄灭');
    assert.equal(isLampLitId(at(27, y, 10)), false, '灯的 6 邻只有断路的粉 → 不亮');

    toggleLeverAt(10, y, 10);
    assert.equal(dustLit(at(11, y, 10)), 0, '拉杆关后全线熄灭');
});

test('2. 断路与连锁脱落：拆中间一格粉下游全灭；拆支撑方块贴面元件弹落', () => {
    freshWorld();
    const y = 9;
    // 拉杆 (10,y,20) + 粉 x=11..20 + 灯 (21,y,20)
    placeRedstone(10, y, 20, LEVER_ITEM_ID, UP);
    for (let x = 11; x <= 20; x++) placeRedstone(x, y, 20, DUST_ITEM_ID, UP);
    placeRedstone(21, y, 20, LAMP_ITEM_ID, UP);
    toggleLeverAt(10, y, 20);
    assert.equal(dustLit(at(20, y, 20)), 1, '供能后末端粉亮');
    assert.equal(isLampLitId(at(21, y, 20)), true, '灯亮');

    // 拆中间一格粉（interaction.js 的破坏路径在拆后调 updateRedstoneNetwork，这里照做）
    breakRedstoneAt(15, y, 20);
    updateRedstoneNetwork();
    assert.equal(at(15, y, 20), BlockTypes.AIR, '被拆的格子变空气');
    assert.equal(dustLit(at(14, y, 20)), 1, '上游 11..14 仍亮');
    for (let x = 16; x <= 20; x++) {
        assert.equal(dustLit(at(x, y, 20)), 0, `下游 x=${x} 失去供能全灭`);
    }
    assert.equal(isLampLitId(at(21, y, 20)), false, '远端灯灭');

    // ---- 失去支撑连锁脱落 ----
    // 悬空石块上贴火把（顶面）：支撑 = 正下方石块
    setB(30, y, 30, BlockTypes.STONE);
    assert.equal(placeRedstone(30, y + 1, 30, RTORCH_ITEM_ID, UP), null);
    assert.equal(rtorchLit(at(30, y + 1, 30)), 1, '火把默认亮');
    // 悬空石块上放压力板
    setB(33, y, 33, BlockTypes.STONE);
    assert.equal(placeRedstone(33, y + 1, 33, PLATE_ITEM_ID, UP), null);
    // 地面红石粉（支撑 = 脚下地板石）
    assert.equal(placeRedstone(36, y, 36, DUST_ITEM_ID, UP), null);

    setB(30, y, 30, BlockTypes.AIR);
    const poppedTorch = popUnsupportedRedstone(30, y, 30);
    assert.equal(at(30, y + 1, 30), BlockTypes.AIR, '支撑没了，火把连锁脱落变空气');
    assert.ok(poppedTorch.some((c) => c.x === 30 && c.y === y + 1 && c.z === 30),
        '返回的被清除格子列表应包含火把格');

    setB(33, y, 33, BlockTypes.AIR);
    popUnsupportedRedstone(33, y, 33);
    assert.equal(at(33, y + 1, 33), BlockTypes.AIR, '压力板随之脱落');

    setB(36, y - 1, 36, BlockTypes.AIR); // 拆掉脚下的地板石
    popUnsupportedRedstone(36, y - 1, 36);
    assert.equal(at(36, y, 36), BlockTypes.AIR, '地板没了，红石粉脱落');
});

test('3. 火把反相器：充能方块熄灭侧贴火把，两只串联还原信号（末端粉与拉杆同相）', () => {
    freshWorld();
    const y = 9;
    // 拉杆(10) → 粉(11) → 石块(12)【粉充能它的水平邻块】→ 火把A(13) 贴石块东面
    // 火把A 亮时强充能正上方石块(13,y+1,30) → 火把B(14) 贴该石块东面 = 二级反相
    // 火把B 旁边放粉 D(15) 读输出
    placeRedstone(10, y, 30, LEVER_ITEM_ID, UP);
    placeRedstone(11, y, 30, DUST_ITEM_ID, UP);
    setB(12, y, 30, BlockTypes.STONE);
    assert.equal(placeRedstone(13, y, 30, RTORCH_ITEM_ID, EAST), null);
    setB(13, y + 1, 30, BlockTypes.STONE);
    assert.equal(placeRedstone(14, y + 1, 30, RTORCH_ITEM_ID, EAST), null);
    setB(15, y, 30, BlockTypes.STONE);
    assert.equal(placeRedstone(15, y + 1, 30, DUST_ITEM_ID, UP), null);

    // 稳态基线：A 亮（挂靠块未被充能）→ A 充能上方石块 → B 灭 → D 灭
    pump(0.05, 4); // 放 B 时 B 已被排队翻转，先泵到稳态保证后续断言确定
    assert.equal(rtorchLit(at(13, y, 30)), 1, '基线：火把A 亮');
    assert.equal(rtorchLit(at(14, y + 1, 30)), 0, '基线：火把B 被A反相熄灭');
    assert.equal(dustLit(at(15, y + 1, 30)), 0, '基线：输出粉灭');

    // 拉杆开 → 粉亮 → 充能石块(12) → A 延迟 0.1s 熄灭 → B 延迟 0.1s 复明 → D 亮（与拉杆同相）
    toggleLeverAt(10, y, 30);
    pump(0.05, 6); // 0.3s ≥ 两级 RTORCH_DELAY 串联
    assert.equal(rtorchLit(at(13, y, 30)), 0, '拉杆开：A 被反相熄灭');
    assert.equal(rtorchLit(at(14, y + 1, 30)), 1, 'A 灭后其上方石块解除充能，B 复明');
    assert.equal(dustLit(at(15, y + 1, 30)), 1, '两只火把串联还原信号，输出粉与拉杆同相（亮）');

    // 拉杆关 → 全链翻转回来，仍同相（灭）
    toggleLeverAt(10, y, 30);
    pump(0.05, 6);
    assert.equal(rtorchLit(at(13, y, 30)), 1, '拉杆关：A 复明');
    assert.equal(rtorchLit(at(14, y + 1, 30)), 0, 'B 被复明的A再次反相');
    assert.equal(dustLit(at(15, y + 1, 30)), 0, '输出粉与拉杆同相（灭）');
});

test('4. 火把时钟：输出粉绕回挂靠方块，持续泵进后火把至少翻转 2 次（振荡）', () => {
    freshWorld();
    const y = 9;
    // 悬空石块 S(12,y,40)，火把 T(13,y,40) 贴东面；T 的输出粉 D2(13,y,41)→D1(12,y,41)
    // 绕回 S 旁：D1 与 S 水平相邻，亮粉充能 S → T 灭 → 粉灭 → S 解除 → T 亮 …… 成时钟
    setB(12, y, 40, BlockTypes.STONE);
    assert.equal(placeRedstone(13, y, 40, RTORCH_ITEM_ID, EAST), null);
    assert.equal(placeRedstone(13, y, 41, DUST_ITEM_ID, UP), null);
    assert.equal(placeRedstone(12, y, 41, DUST_ITEM_ID, UP), null);

    // 每帧采样火把亮灭（RTORCH_DELAY=0.1s，dt=0.05 → 每个半周期恰好 2 帧）
    const seq = [];
    for (let i = 0; i < 40; i++) {
        pump(0.05, 1);
        seq.push(rtorchLit(at(13, y, 40)));
    }
    let flips = 0;
    for (let i = 1; i < seq.length; i++) {
        if (seq[i] !== seq[i - 1]) flips++;
    }
    assert.ok(flips >= 2, `火把应持续振荡：40 帧内观测到 ${flips} 次翻转（序列 ${seq.join('')}）`);
    assert.ok(seq.includes(1) && seq.includes(0), '亮灭两态都出现过，说明不是卡死在某一态');
});

test('5. 压力板：玩家/怪物踩板 → 板按下门开，离开 → 弹起门关', () => {
    freshWorld();
    const y = 9;
    // 板(20,y,50) → 粉(21,y,50) → 门(22,y,50)：板按下即信号源，点亮邻粉驱动门
    assert.equal(placeRedstone(20, y, 50, PLATE_ITEM_ID, UP), null);
    assert.equal(placeRedstone(21, y, 50, DUST_ITEM_ID, UP), null);
    assert.equal(tryPlaceDoor(22, y, 50, 0), true, '门放置成功');
    assert.equal(doorOpen(at(22, y, 50)), 0, '初始门关');

    // 玩家站上板（脚部 y=9 与板同层，floor(9+0.1)=9 命中板格）
    state.player.x = 20.5; state.player.y = y; state.player.z = 50.5;
    pump(0.05, 2);
    assert.equal(platePressed(at(20, y, 50)), 1, '玩家踩住 → 压力板按下变体');
    assert.equal(doorOpen(at(22, y, 50)), 1, '板按下的上升沿自动开门');

    // 玩家离开
    state.player.x = 3.5; state.player.z = 3.5;
    pump(0.05, 2);
    assert.equal(platePressed(at(20, y, 50)), 0, '没人踩 → 板弹起');
    assert.equal(doorOpen(at(22, y, 50)), 0, '信号下降沿自动关门');

    // 怪物踩板同理（updateRedstoneTick 的踩踏检测对 state.enemies 逐个取脚部坐标）
    state.enemies.push({ x: 20.5, y: y, z: 50.5, hp: 20 });
    pump(0.05, 2);
    assert.equal(platePressed(at(20, y, 50)), 1, '怪物踩板同样按下');
    assert.equal(doorOpen(at(22, y, 50)), 1, '门再次打开');
    state.enemies.length = 0;
    pump(0.05, 2);
    assert.equal(platePressed(at(20, y, 50)), 0, '怪物移除后板弹起');
    assert.equal(doorOpen(at(22, y, 50)), 0, '门关闭');
});

test('6. 观察者：正前方方块变化 → 背面输出脉冲 0.2s 点亮粉与灯，随后自动熄灭', () => {
    freshWorld();
    const y = 9;
    // 观察者(40,y,60) 朝东 +X，正前方 (41,y,60) 先放石头作侦测基线；
    // 背面 (39,y,60) 接粉 → 灯(38,y,60)
    setB(41, y, 60, BlockTypes.STONE);
    assert.equal(placePiston(40, y, 60, OBSERVER_ITEM_ID, EAST), null);
    assert.equal(placeRedstone(39, y, 60, DUST_ITEM_ID, UP), null);
    assert.equal(placeRedstone(38, y, 60, LAMP_ITEM_ID, UP), null);
    assert.equal(observerPowered(at(40, y, 60)), 0, '放置时以现值建基线，不误报');

    setB(41, y, 60, BlockTypes.AIR); // 正前方方块变化 → 侦测
    pump(0.05, 1);
    assert.equal(observerPowered(at(40, y, 60)), 1, '侦测到变化 → 点亮变体（脉冲信号源）');
    assert.equal(dustLit(at(39, y, 60)), 1, '背面输出经邻粉传出');
    assert.equal(isLampLitId(at(38, y, 60)), true, '灯亮');

    pump(0.05, 6); // 再过 0.3s > OBSERVER_PULSE_SEC(0.2s)，脉冲结束
    assert.equal(observerPowered(at(40, y, 60)), 0, '脉冲到时自动熄灭');
    assert.equal(dustLit(at(39, y, 60)), 0, '粉灭');
    assert.equal(isLampLitId(at(38, y, 60)), false, '灯灭');
});

test('7. TNT 引爆链：拉杆上升沿点燃邻格 TNT，2.5s 引信后爆炸毁格', () => {
    freshWorld();
    const y = 9;
    // 玩家挪到远处角落，爆炸伤害判定（5 格内）不波及
    state.player.x = 3.5; state.player.z = 3.5;
    placeRedstone(50, y, 70, LEVER_ITEM_ID, UP);
    setB(51, y, 70, BlockTypes.TNT); // 放置的 TNT 是惰性方块
    assert.equal(state.tntEntities.length, 0, '放置后未点燃');

    toggleLeverAt(50, y, 70);
    assert.equal(state.tntEntities.length, 1, '信号上升沿点燃：TNT 实体入队');
    assert.equal(state.tntEntities[0].fuse, 2.5, '引信 2.5s');
    assert.equal(at(51, y, 70), BlockTypes.TNT, '点燃瞬间原方块还在（引信走完才消失）');

    pump(0.1, 30); // 3.0s > 2.5s 引信
    assert.equal(state.tntEntities.length, 0, '引信走完实体清空');
    assert.equal(at(51, y, 70), BlockTypes.AIR, 'TNT 方块消失');
    assert.equal(at(51, y - 1, 70), BlockTypes.AIR, '半径 3 球形毁格：脚下石头被炸空');
    assert.equal(at(50, y, 70), BlockTypes.AIR, '邻格拉杆也被炸毁');
    assert.equal(at(51, y - 1, 78), BlockTypes.STONE, '半径外的石头原样保留');
});

test('8. TNT×活塞孤儿修复：炸掉活塞头 → 底座自动收回；底座没了 → 孤头被摘除', () => {
    freshWorld();
    const y = 9;
    // ---- 场景 A：爆炸炸掉伸出的活塞头（底座在爆炸半径外）----
    assert.equal(placePiston(60, y, 80, PISTON_ITEM_ID, EAST), null);
    setB(61, y, 80, BlockTypes.STONE);
    enqueuePistonAction(60, y, 80, true);
    PUMP_PISTON();
    assert.equal(pistonExtended(at(60, y, 80)), 1, '前置：活塞已伸出');
    assert.equal(at(61, y, 80), pistonHeadId(3), '前置：头占据前格');

    // 爆心 (64,y,80)：头距 3（≤3.5 被炸），底座距 4（半径外幸存）——
    // explode 对每个毁格调 fixPistonAround：头没了的伸出底座应被收回
    explode(64, y, 80);
    assert.equal(at(61, y, 80), BlockTypes.AIR, '活塞头被炸毁');
    assert.equal(isPistonId(at(60, y, 80)) && pistonExtended(at(60, y, 80)), 0,
        '底座幸存且被 fixPistonAround 收回为未伸出变体');

    // ---- 场景 B：底座消失，孤立的活塞头应被摘除 ----
    assert.equal(placePiston(70, y, 80, PISTON_ITEM_ID, WEST), null);
    setB(69, y, 80, BlockTypes.STONE);
    enqueuePistonAction(70, y, 80, true);
    PUMP_PISTON();
    assert.equal(at(69, y, 80), pistonHeadId(5), '前置：朝西活塞的头在 (69)');
    setB(70, y, 80, BlockTypes.AIR); // 模拟底座被毁（只剩头）
    fixPistonAround(70, y, 80); // tnt.explode 对每个毁格调用的正是它
    assert.equal(at(69, y, 80), BlockTypes.AIR, '底座没了 → 孤立活塞头被摘除');
});

test('9. 粘液块拖拽：粘性活塞伸出拖走粘着的石头，收回连石头一起拉回', () => {
    freshWorld();
    // 整体抬到 y=10：若贴地放粘液块，会把脚下地板石也粘走，布局就不干净了
    const y = 10;
    assert.equal(placePiston(20, y, 90, STICKY_PISTON_ITEM_ID, EAST), null);
    setB(21, y, 90, BlockTypes.SLIME);
    setB(21, y, 91, BlockTypes.STONE); // 粘在粘液块南面的石头

    enqueuePistonAction(20, y, 90, true);
    PUMP_PISTON();
    assert.equal(at(21, y, 90), pistonHeadId(3), '活塞头占据前格');
    assert.equal(at(22, y, 90), BlockTypes.SLIME, '粘液块被推着一格前移');
    assert.equal(at(22, y, 91), BlockTypes.STONE, '粘液块把粘着的石头一起拖走');
    assert.equal(at(21, y, 91), BlockTypes.AIR, '石头原格腾空');

    enqueuePistonAction(20, y, 90, false);
    PUMP_PISTON();
    assert.equal(isPistonId(at(20, y, 90)) && pistonExtended(at(20, y, 90)), 0, '活塞收回');
    assert.equal(at(21, y, 90), BlockTypes.SLIME, '粘性活塞收回：粘液块被整体拉回');
    assert.equal(at(21, y, 91), BlockTypes.STONE, '粘着的石头跟着拉回原位');
    assert.equal(at(22, y, 90), BlockTypes.AIR, '远端格子清空');
});

test('10. 推动上限：13 格石头推不动（不伸出），12 格恰好成功', () => {
    freshWorld();
    const y = 9;
    // 13 格石头：超出 PISTON_PUSH_LIMIT=12，整个伸出动作失败
    assert.equal(placePiston(30, y, 100, PISTON_ITEM_ID, EAST), null);
    for (let x = 31; x <= 43; x++) setB(x, y, 100, BlockTypes.STONE);
    enqueuePistonAction(30, y, 100, true);
    PUMP_PISTON();
    assert.equal(isPistonId(at(30, y, 100)) && pistonExtended(at(30, y, 100)), 0,
        `${PISTON_PUSH_LIMIT + 1} 格超出推动上限 → 活塞保持收回`);
    assert.equal(at(31, y, 100), BlockTypes.STONE, '一格都没动');
    assert.notEqual(at(31, y, 100), pistonHeadId(3), '没有活塞头出现');

    // 对照组：恰好 12 格成功伸出
    assert.equal(placePiston(30, y, 104, PISTON_ITEM_ID, EAST), null);
    for (let x = 31; x <= 42; x++) setB(x, y, 104, BlockTypes.STONE);
    enqueuePistonAction(30, y, 104, true);
    PUMP_PISTON();
    assert.equal(pistonExtended(at(30, y, 104)), 1, '12 格 = 上限内，正常伸出');
    assert.equal(at(31, y, 104), pistonHeadId(3), '头占据前格');
    assert.equal(at(43, y, 104), BlockTypes.STONE, '整列石头前移一格');
});

test('11. 压碎贴面道具：推动路径上的门/红石粉被压碎，生存模式返还物品进背包', () => {
    // 压碎返还走 piston.popBlockAt → breakRedstoneAt/breakDoorAt，
    // 生存模式下直接写 state.player.inventory（不走 spawnItemDrop 掉落实体）
    freshWorld({ gameMode: GameModes.SURVIVAL });
    state.player.inventory = {}; // 清计数，断言才干净
    const y = 9;

    // 门立在推动路径正前方：被压碎（整扇两格消失），原格被活塞头占据
    assert.equal(placePiston(40, y, 110, PISTON_ITEM_ID, EAST), null);
    assert.equal(tryPlaceDoor(41, y, 110, 0), true);
    enqueuePistonAction(40, y, 110, true);
    PUMP_PISTON();
    assert.equal(at(41, y, 110), pistonHeadId(3), '门被压碎，活塞头占据原格');
    assert.equal(at(41, y + 1, 110), BlockTypes.AIR, '门的上半扇一并清除');
    assert.ok((state.player.inventory[DOOR_ITEM_ID] || 0) >= 1, '生存模式返还一个门物品');

    // 红石粉铺在路径上：同样被压碎返还
    assert.equal(placePiston(50, y, 110, PISTON_ITEM_ID, EAST), null);
    assert.equal(placeRedstone(51, y, 110, DUST_ITEM_ID, UP), null);
    enqueuePistonAction(50, y, 110, true);
    PUMP_PISTON();
    assert.equal(at(51, y, 110), pistonHeadId(3), '粉被压碎，活塞头占据原格');
    assert.ok((state.player.inventory[DUST_ITEM_ID] || 0) >= 1, '生存模式返还一份红石粉');
});

test('12. 活塞载客：站在被推石头顶上的玩家随方块平移一格', () => {
    freshWorld();
    const y = 9;
    assert.equal(placePiston(60, y, 120, PISTON_ITEM_ID, EAST), null);
    setB(61, y, 120, BlockTypes.STONE);
    // 玩家精确站在石头顶面中心（脚 y = 石顶 = y+1）
    state.player.x = 61.5; state.player.y = y + 1; state.player.z = 120.5;

    enqueuePistonAction(60, y, 120, true);
    PUMP_PISTON();
    assert.equal(at(61, y, 120), pistonHeadId(3), '头占据前格');
    assert.equal(at(62, y, 120), BlockTypes.STONE, '石头被推一格');
    assert.equal(state.player.x, 62.5, 'carryRiders 命中「站顶」判定：玩家随方块 +1 格');
    assert.equal(state.player.y, y + 1, '水平推动，高度不变');
});

test('13. 火把塔竖直传信号：亮火把强充能正上方方块→翻转贴附火把（每级反相）；被充能方块不直接喂粉（本作与原版差异）', () => {
    freshWorld();
    const y = 9; // 站在 floorY=8 石面上
    const NORTH = { dx: 0, dy: 0, dz: -1 }; // 挂靠面法线：从支撑方块指向火把格（-Z 方向）

    // ---- 布线（先放石头再放元件）：拉杆→D0→充能 B1→T1 反相；T1 强充能 S1→T2 反相；T2 输出灯
    setB(60, y, 80, BlockTypes.STONE); // B1：一级基座（T1 的挂靠方块）
    setB(60, y + 1, 79, BlockTypes.STONE); // S1：T1 正上方（被 T1 强充能，T2 的挂靠方块）
    assert.equal(placeRedstone(61, y, 80, DUST_ITEM_ID, UP), null); // D0：B1 的水平邻粉
    assert.equal(placeRedstone(62, y, 80, LEVER_ITEM_ID, UP), null); // 拉杆：信号源
    assert.equal(placeRedstone(60, y, 79, RTORCH_ITEM_ID, NORTH), null); // T1：贴 B1 北面，默认亮
    assert.equal(placeRedstone(60, y + 1, 78, RTORCH_ITEM_ID, NORTH), null); // T2：贴 S1 北面
    assert.equal(placeRedstone(60, y + 1, 77, LAMP_ITEM_ID, UP), null); // 灯：T2 的 6 邻负载
    // D1：坐在被强充能的 S1 顶面上——原版里它应亮，本作实现不喂粉（见下方差异断言）
    assert.equal(placeRedstone(60, y + 2, 79, DUST_ITEM_ID, UP), null);

    pump(0.05, 3); // 结算放置期火把延迟翻转（RTORCH_DELAY 0.1s）
    // 基线（拉杆关）：T1 亮 → S1 被强充能 → T2 反相熄灭 → 灯灭
    assert.equal(rtorchLit(at(60, y, 79)), 1, 'T1 默认亮');
    assert.equal(rtorchLit(at(60, y + 1, 78)), 0, 'T1 强充能正上方 S1 → 贴附的 T2 反相熄灭（竖直传信号的单级结构）');
    assert.equal(isLampLitId(at(60, y + 1, 77)), false, '上级未供能，灯灭');
    assert.equal(dustLit(at(60, y + 2, 79)), 0, '【差异锚点】被强充能方块不点亮顶面粉（poweredBlocks 唯一消费端是火把反相，redstone.js:472）');

    // 拉杆开 → D0 充能 B1 → T1 反相灭 → S1 解除充能 → T2 复明 → 灯亮（两级串联，输出与拉杆同相）
    toggleLeverAt(62, y, 80);
    pump(0.05, 8); // 两级火把延迟串联（0.1s × 2）+ 重算收敛，8 帧留足余量
    assert.equal(rtorchLit(at(60, y, 79)), 0, '拉杆开：D0 充能 B1 → T1 反相灭');
    assert.equal(rtorchLit(at(60, y + 1, 78)), 1, 'S1 解除充能 → T2 复明（第二级反相）');
    assert.equal(isLampLitId(at(60, y + 1, 77)), true, '末级火把作激活源点亮 6 邻灯');
    assert.equal(dustLit(at(60, y + 2, 79)), 0, '【差异锚点】拉杆开后 S1 仍未喂粉');

    // 拉杆关 → 全链还原（每级再反相一次）
    toggleLeverAt(62, y, 80);
    pump(0.05, 8);
    assert.equal(rtorchLit(at(60, y, 79)), 1, 'T1 复明');
    assert.equal(rtorchLit(at(60, y + 1, 78)), 0, 'T2 再反相熄灭');
    assert.equal(isLampLitId(at(60, y + 1, 77)), false, '灯灭');
});
