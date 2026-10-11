// 存档导出/导入回环 + 导入竞态回归（2026-10-11 用户报告：跨电脑导入后「地图回到初始状态」）。
// 竞态：importSlotJson 写槽成功后 settingsUI 800ms 触发 reload，reload 引发的 pagehide/
// visibilitychange 兜底 saveGame() 会把内存里的旧世界（新电脑上=刚生成的初始世界）写回
// 同一槽位，覆盖刚导入的档——现由 importGuard 在 saveGame 入口闸住、loadGame 解除。
import './_preload.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../../js/state.js';
import { BlockTypes, GameModes } from '../../js/config.js';
import { getBlockIndex } from '../../js/world.js';
import { saveGame, loadGame, exportSlotJson, importSlotJson } from '../../js/saveGame.js';
import { freshWorld } from './kit.mjs';

const slotKey = (i) => `mcweb.save.v1.slot${i}`;

test('导入后 pagehide 兜底存档不再覆盖刚导入的档，loadGame 解除保护（竞态回归）', () => {
    // === 电脑 A：改动世界（立一根标记柱）→ 保存 → 导出 ===
    freshWorld({ seed: 111 });
    state.saveSlot = 0;
    state.blocks[getBlockIndex(5, 9, 5)] = BlockTypes.STONE;
    assert.ok(saveGame(), '电脑 A 保存成功');
    const exported = exportSlotJson(0);
    assert.ok(exported, '导出成功');

    // === 电脑 B：空存储 + 内存里是没有玩家改动的初始世界（首次打开自动生成） ===
    globalThis.localStorage.clear();
    state.blocks[getBlockIndex(5, 9, 5)] = BlockTypes.AIR;
    state.worldSeed = 999;

    // === 执行导入：写槽成功，进入 800ms reload 窗口（内存仍是电脑 B 的世界） ===
    assert.equal(importSlotJson(exported, 0), null, '导入应成功');
    const onDisk = globalThis.localStorage.getItem(slotKey(0));
    assert.equal(JSON.parse(onDisk).worldSeed, 111, '落盘的是电脑 A 的世界');

    // === reload 触发 pagehide 兜底：saveGame 必须拒写，槽位数据原样 ===
    assert.equal(saveGame(), false, '导入窗口内 saveGame 应拒写');
    assert.equal(globalThis.localStorage.getItem(slotKey(0)), onDisk, '刚导入的档未被覆盖');

    // === reload 后 loadGame：导入世界完整载入，玩家改动在场 ===
    assert.ok(loadGame(0), '读档成功');
    assert.equal(state.blocks[getBlockIndex(5, 9, 5)], BlockTypes.STONE, '玩家改动幸存');
    assert.equal(state.worldSeed, 111);

    // === 保护解除：此后照常自动存档（内存 = 导入世界，写回无损） ===
    assert.equal(saveGame(), true, 'loadGame 后恢复自动存档');
    assert.equal(JSON.parse(globalThis.localStorage.getItem(slotKey(0))).worldSeed, 111);
});

test('导出→导入→loadGame 回环：方块字节级一致 + 种子/模式/玩家位置还原', () => {
    freshWorld({ seed: 222, gameMode: GameModes.SURVIVAL });
    state.saveSlot = 1;
    // 铺几处可辨识的改动
    state.blocks[getBlockIndex(10, 9, 10)] = BlockTypes.STONE;
    state.blocks[getBlockIndex(20, 12, 20)] = BlockTypes.STONE;
    state.blocks[getBlockIndex(30, 5, 30)] = BlockTypes.AIR; // 挖掉的坑
    state.player.x = 12.5; state.player.y = 10; state.player.z = 13.5;
    assert.ok(saveGame(), '保存成功');
    const before = state.blocks.slice();
    const exported = exportSlotJson(1);
    assert.ok(exported, '导出成功');

    // 模拟目标电脑：清空存储后导入并读档
    globalThis.localStorage.clear();
    assert.equal(importSlotJson(exported, 1), null, '导入成功');
    assert.ok(loadGame(1), '读档成功');

    assert.equal(Buffer.compare(Buffer.from(state.blocks), Buffer.from(before)), 0,
        '方块数据应与导出前字节级一致');
    assert.equal(state.worldSeed, 222, '世界种子还原');
    assert.equal(state.gameMode, GameModes.SURVIVAL, '游戏模式还原');
    assert.equal(state.player.x, 12.5, '玩家位置还原');
});
