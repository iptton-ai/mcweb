import { test } from "node:test";
import assert from "node:assert/strict";
import { freshWorld, state, setB, at, pump } from "./kit.mjs";
import {
  BlockTypes as B,
  LifeBlocks as L,
  LifeItems as I,
  LIFE,
  GameModes,
  ToolTypes,
  HotbarBlocks,
  ItemTypes,
  RECIPES,
} from "../../js/config.js";
import {
  addInventoryStack,
  takeInventoryStack,
  toolWears,
  damageInventoryTool,
} from "../../js/inventoryStacks.js";
import {
  containerAt,
  depositToContainer,
  withdrawFromContainer,
  chestOrganize,
  tickHomestead,
  flushLifeDrops,
  useFarmItem,
  harvestPlant,
  growTreeAt,
  grantFarmStarter,
  insertChestStack,
} from "../../js/homestead.js";
import {
  lifeData,
  captureLifeState,
  validateLifeState,
} from "../../js/lifeData.js";
import {
  saveGame,
  loadGame,
  exportSlotJson,
  importSlotJson,
} from "../../js/saveGame.js";
import {
  saveSnapshotForReload,
  restoreSnapshotIfAny,
} from "../../js/assistant/snapshot.js";
import {
  spawnMob,
  feedFarmAnimal,
  shearFarmAnimal,
  nameFarmAnimal,
  despawnTick,
  updateEnemies,
} from "../../js/entities.js";
import { setState, isWorldPaused } from "../../js/uiModal.js";
import { craftRecipe } from "../../js/ui.js";
import {
  dropHeldItem,
  breakBlockAt,
  raycastFarmAnimal,
} from "../../js/interaction.js";
import { updateItemDrops } from "../../js/items.js";
import { respawn } from "../../js/playerLife.js";
import { keys } from "../../js/input.js";
import { updatePlayerPhysics } from "../../js/playerPhysics.js";
import { setSurvivalRules, canUseFreeBuild } from "../../js/survivalRules.js";
import { enqueueBuildOps, updateBuild } from "../../js/buildQueue.js";
import { grantEduReward, loadEduProgress } from "../../js/eduRewards.js";
import { explode } from "../../js/tnt.js";
function setup() {
  freshWorld({ gameMode: GameModes.SURVIVAL });
  state.levelRun = null;
  state.levelEdit = null;
  state.inputMode = "keyboard";
  state.camMode = "player";
  state.windowUnfocused = false;
  state.helpDocOpen = false;
  state.questionBankOpen = false;
  state.prefabPickerOpen = false;
  state.authorPanelOpen = false;
  state.recordingControlsOpen = false;
  state.levelExportOpen = false;
  setState("playing");
  for (const k of Object.keys(keys)) delete keys[k];
}
const give = (id, count = 1, wear = 0) =>
  addInventoryStack({ id, count, wear });
const advance = (s) => {
  for (let i = 0; i < s * 4; i++) tickHomestead(0.25);
};
function furnace() {
  setB(20, 9, 20, B.FURNACE);
  give(B.WOOD, 2);
  depositToContainer(20, 9, 20, B.WOOD, 1, "input");
  depositToContainer(20, 9, 20, B.WOOD, 1, "fuel");
  return containerAt(20, 9, 20);
}

test("M2 工具两把不同磨损存取／丢捡／损坏保持每把耐久", () => {
  setup();
  const id = ToolTypes.WOOD_PICKAXE;
  give(id, 1, 28);
  give(id, 1, 35);
  setB(20, 9, 20, L.CHEST);
  assert.equal(depositToContainer(20, 9, 20, id, 64).count, 1);
  assert.deepEqual(toolWears(id), [28]);
  assert.equal(depositToContainer(20, 9, 20, id, 64).count, 1);
  withdrawFromContainer(20, 9, 20, 0);
  withdrawFromContainer(20, 9, 20, 1);
  assert.deepEqual(toolWears(id), [35, 28]);
  state.player.selectedSlot = HotbarBlocks.indexOf(id);
  dropHeldItem();
  assert.deepEqual(toolWears(id), [35]);
  assert.equal(state.itemDrops[0].toolWear, 28);
  const d = state.itemDrops[0];
  d.age = d.pickupDelay;
  Object.assign(state.player, { x: d.x, y: d.y - 0.9, z: d.z });
  updateItemDrops(0.01);
  assert.deepEqual(toolWears(id), [35, 28]);
  damageInventoryTool(id, 24);
  assert.deepEqual(toolWears(id), [28]);
});
test("M2 满箱部分接收、不吞来源与工具备用磨损", () => {
  setup();
  setB(20, 9, 20, L.CHEST);
  const c = containerAt(20, 9, 20);
  c.slots = Array.from({ length: 27 }, () => ({ id: B.STONE, count: 64 }));
  c.slots[0].count = 63;
  give(B.STONE, 8);
  assert.equal(depositToContainer(20, 9, 20, B.STONE, 8).count, 1);
  assert.equal(state.player.inventory[B.STONE], 7);
  assert.equal(depositToContainer(20, 9, 20, B.STONE, 7).count, 0);
  assert.equal(
    insertChestStack(20, 9, 20, { id: B.STONE, count: 7 }).accepted,
    0,
  );
});
test("M2 所有世界写入口拒绝物品／越界／小数，不截断新ID", () => {
  setup();
  setB(20, 9, 20, B.STONE);
  for (const id of [256, 257, -1, 512, 1.5, ToolTypes.WOOD_PICKAXE]) {
    setB(20, 9, 20, id);
    assert.equal(at(20, 9, 20), B.STONE);
  }
});
test("M2 箱子销毁同步摘除，立即保存与热重载不丢不复制内容", () => {
  setup();
  setB(20, 9, 20, L.CHEST);
  give(ToolTypes.WOOD_AXE, 1, 22);
  depositToContainer(20, 9, 20, ToolTypes.WOOD_AXE);
  setB(20, 9, 20, 0);
  setB(20, 9, 20, 0);
  assert.equal(lifeData().containers["20,9,20"], undefined);
  assert.equal(state.lifePendingDrops.length, 1);
  assert.ok(saveGame());
  assert.ok(loadGame());
  assert.equal(state.itemDrops.filter((d) => d.lifePersistent).length, 1);
  assert.equal(state.itemDrops[0].toolWear, 22);
  assert.ok(saveSnapshotForReload());
  assert.ok(restoreSnapshotIfAny());
  assert.equal(state.itemDrops.length, 1);
  assert.equal(state.itemDrops[0].toolWear, 22);
});
test("M2 炉子原木烧炭：原料燃料独立、输出、未完拆炉退款", () => {
  setup();
  const c = furnace();
  advance(4);
  assert.equal(c.input, null);
  assert.equal(c.processing.id, B.WOOD);
  assert.equal(c.fuel, null);
  assert.equal(c.progress, 4);
  setB(20, 9, 20, 0);
  assert.equal(state.lifePendingDrops.length, 1);
  assert.equal(state.lifePendingDrops[0].stack.id, B.WOOD);
  flushLifeDrops();
  assert.equal(state.itemDrops[0].count, 1);
});
test("M2 炉子加工中普通档／文件导入／快照回环", () => {
  setup();
  furnace();
  advance(3);
  assert.ok(saveGame());
  const json = exportSlotJson();
  assert.equal(importSlotJson(json), null);
  assert.ok(loadGame());
  assert.equal(containerAt(20, 9, 20).progress, 3);
  assert.ok(saveSnapshotForReload());
  assert.ok(restoreSnapshotIfAny());
  advance(5);
  assert.deepEqual(containerAt(20, 9, 20).output, {
    id: ItemTypes.COAL,
    count: 1,
  });
});
test("M2 输出满暂停消耗，旧即时熔炉配方不能绕过", () => {
  setup();
  const c = furnace();
  c.output = { id: ItemTypes.COAL, count: 64 };
  advance(10);
  assert.equal(c.input.count, 1);
  assert.equal(c.fuel.count, 1);
  assert.equal(c.burnRemaining, 0);
  assert.match(
    craftRecipe(RECIPES.find((r) => r.id === "charcoal")),
    /右键.*熔炉/,
  );
});
test("M2 有效生产时钟：生活面板／暂停不走，跳天空不补算，大dt有界", () => {
  setup();
  const c = furnace();
  setState("container");
  assert.equal(isWorldPaused(), true);
  advance(20);
  assert.equal(c.progress, 0);
  setState("playing");
  state.time += 100000;
  tickHomestead(0.25);
  assert.equal(c.progress, 0.25);
  tickHomestead(10000);
  assert.equal(c.progress, 0.5);
});
test("M2 坏生活存档在写槽与覆盖世界前拒绝", () => {
  setup();
  setB(20, 9, 20, L.CHEST);
  containerAt(20, 9, 20);
  assert.ok(saveGame());
  const obj = JSON.parse(exportSlotJson());
  obj.life.containers["20,9,20"].slots[0] = { id: B.STONE, count: 65 };
  const before = exportSlotJson();
  assert.match(importSlotJson(JSON.stringify(obj)), /箱子/);
  assert.equal(exportSlotJson(), before);
  assert.equal(validateLifeState(obj.life, state.blocks), "箱子数据损坏");
});
test("M2 老档缺生活字段与工具备用耐久安全默认", () => {
  setup();
  furnace();
  assert.ok(saveGame());
  const obj = JSON.parse(exportSlotJson());
  delete obj.life;
  delete obj.player.toolReserveWear;
  assert.equal(importSlotJson(JSON.stringify(obj)), null);
  assert.ok(loadGame());
  assert.deepEqual(lifeData().containers, {});
  assert.deepEqual(state.player.toolReserveWear, {});
  assert.equal(state.survivalRules, "standard");
});
test("M2 耕种四期成熟返种，未熟返种，三麦面包", () => {
  setup();
  setB(20, 8, 20, B.GRASS);
  setB(21, 8, 20, B.WATER);
  give(I.HOE);
  give(I.SEEDS, 3);
  const hit = {
    x: 20,
    y: 8,
    z: 20,
    block: B.GRASS,
    face: { dx: 0, dy: 1, dz: 0 },
  };
  assert.match(useFarmItem(I.HOE, hit), /耕地/);
  hit.block = L.FARMLAND;
  assert.match(useFarmItem(I.SEEDS, hit), /播种/);
  advance(120);
  assert.equal(at(20, 9, 20), L.WHEAT_MATURE);
  harvestPlant(20, 9, 20);
  assert.equal(state.player.inventory[I.SEEDS], 4);
  assert.equal(state.player.inventory[I.WHEAT], 1);
  useFarmItem(I.SEEDS, hit);
  harvestPlant(20, 9, 20);
  assert.equal(state.player.inventory[I.SEEDS], 4);
  give(I.WHEAT, 2);
  assert.equal(craftRecipe(RECIPES.find((r) => r.id === "bread")), null);
  assert.equal(state.player.inventory[I.BREAD], 1);
});
test("M2 256株成长相同，不因数量变慢；无水冻结", () => {
  setup();
  for (let x = 20; x < 36; x++)
    for (let z = 20; z < 36; z++) {
      setB(x, 8, z, L.FARMLAND);
      setB(x, 9, z, L.WHEAT);
    }
  for (let x = 19; x < 37; x += 5)
    for (let z = 19; z < 37; z += 5) setB(x, 8, z, B.WATER);
  advance(40);
  assert.equal(at(20, 9, 20), 245);
  assert.equal(at(35, 9, 35), 245);
  setB(60, 8, 60, L.FARMLAND);
  setB(60, 9, 60, L.WHEAT);
  advance(40);
  assert.equal(at(60, 9, 60), 244);
});
test("M2 树苗全空间预检，不覆盖屋顶；拆障后完整长树", () => {
  setup();
  setB(20, 8, 20, B.DIRT);
  setB(20, 9, 20, L.SAPLING);
  setB(22, 13, 20, B.GLASS);
  const before = state.blocks.slice();
  assert.equal(growTreeAt(20, 9, 20), false);
  assert.deepEqual(state.blocks, before);
  setB(22, 13, 20, 0);
  assert.equal(growTreeAt(20, 9, 20), true);
  assert.equal(at(20, 9, 20), B.WOOD);
  assert.equal(at(22, 13, 20), B.LEAVES);
});
test("M2 水桶取放守恒、稳定种子树苗来源、一次种植包", () => {
  setup();
  give(I.BUCKET);
  setB(20, 9, 20, B.WATER);
  assert.match(
    useFarmItem(I.BUCKET, { x: 20, y: 9, z: 20, block: B.WATER }),
    /装满/,
  );
  assert.equal(at(20, 9, 20), 0);
  assert.equal(state.player.inventory[I.BUCKET], 0);
  assert.equal(state.player.inventory[I.WATER_BUCKET], 1);
  useFarmItem(I.WATER_BUCKET, {
    x: 21,
    y: 8,
    z: 20,
    block: B.STONE,
    face: { dx: 0, dy: 1, dz: 0 },
  });
  assert.equal(at(21, 9, 20), B.WATER);
  assert.equal(state.player.inventory[I.BUCKET], 1);
  setB(30, 9, 30, B.GRASS);
  breakBlockAt({ x: 30, y: 9, z: 30, block: B.GRASS });
  assert.equal(state.player.inventory[I.SEEDS], 1);
  setB(30, 9, 30, B.LEAVES);
  breakBlockAt({ x: 30, y: 9, z: 30, block: B.LEAVES });
  assert.equal(state.player.inventory[L.SAPLING], 1);
  assert.equal(grantFarmStarter(), true);
  assert.equal(grantFarmStarter(), false);
});
test("M2 羊喂养命名剪毛再生，远距／普通死亡／保存重进保持", () => {
  setup();
  const e = spawnMob("sheep", 20.5, 9, 20.5);
  give(I.WHEAT, 3);
  give(I.SHEARS);
  assert.match(feedFarmAnimal(e), /家畜/);
  nameFarmAnimal(e, "棉花糖");
  assert.match(shearFarmAnimal(e), /×3/);
  assert.equal(state.player.inventory[B.WOOL], 3);
  e.feedCooldown = 0;
  feedFarmAnimal(e);
  for (let i = 0; i < 480; i++) updateEnemies(0.25);
  assert.equal(e.shorn, false);
  state.player.x = 200;
  despawnTick();
  assert.ok(state.enemies.includes(e));
  respawn();
  assert.ok(state.enemies.includes(e));
  assert.ok(saveGame());
  assert.ok(loadGame());
  const restored = state.enemies.find((a) => a.owned);
  assert.equal(restored.name, "棉花糖");
  assert.equal(restored.animalId, e.animalId);
});
test("M2 动物射线遮挡：墙后不可打开喂养面板", () => {
  setup();
  Object.assign(state.player, { x: 20.5, y: 9, z: 24.5, yaw: 0, pitch: -0.25 });
  const e = spawnMob("sheep", 20.5, 9, 21.5);
  assert.equal(raycastFarmAnimal(), e);
  setB(20, 9, 23, B.STONE);
  setB(20, 10, 23, B.STONE);
  assert.equal(raycastFarmAnimal(), null);
});
test("M2 围栏真实跳跃碰撞与开门通过", () => {
  setup();
  Object.assign(state.player, {
    x: 20.5,
    y: 9.001,
    z: 24.5,
    yaw: 0,
    pitch: 0,
    onGround: true,
  });
  for (let x = 18; x <= 22; x++) setB(x, 9, 22, L.FENCE);
  keys.KeyW = true;
  keys.Space = true;
  for (let i = 0; i < 180; i++) updatePlayerPhysics(1 / 60);
  assert.ok(state.player.z > 23, "不能从1.5格围栏上跳穿");
  setB(20, 9, 22, L.GATE_OPEN);
  keys.Space = false;
  for (let i = 0; i < 60; i++) updatePlayerPhysics(1 / 60);
  assert.ok(state.player.z < 22, "打开门能穿过");
});
test("M2 标准生存队列入口与消费守卫、自由实验切回取消", async () => {
  setup();
  assert.equal(canUseFreeBuild(), false);
  assert.equal(
    (await enqueueBuildOps("blocked", [[20, 9, 20, B.STONE]])).applied,
    0,
  );
  setSurvivalRules("experiment");
  state.buildPaused = false;
  const task = enqueueBuildOps("cancel", [[20, 9, 20, B.STONE]]);
  setSurvivalRules("standard");
  updateBuild(0.25);
  await task;
  assert.equal(at(20, 9, 20), 0);
});
test("M2 学习统计保留，重复奖励不产钻铁或主食", () => {
  setup();
  localStorage.setItem(
    "mcweb.edu.v1",
    JSON.stringify({ solved: 50, trades: 20, streak: 10, hanzi: ["花"] }),
  );
  for (let i = 0; i < 10; i++)
    grantEduReward(20, 9, 20, { streak: 10, totalKey: "solved" });
  assert.equal(
    state.itemDrops.every((d) => d.itemId === I.MEMENTO),
    true,
  );
  assert.equal(loadEduProgress().solved, 50);
  assert.deepEqual(loadEduProgress().hanzi, ["花"]);
});
test("M2 爆炸箱仅一次退款，输出与输入持久化完整", () => {
  setup();
  const c = furnace();
  advance(4);
  setB(20, 9, 21, L.CHEST);
  give(B.PLANKS, 7);
  depositToContainer(20, 9, 21, B.PLANKS);
  explode(20, 9, 20, "tnt");
  const drops = captureLifeState().drops;
  assert.equal(
    drops
      .filter((d) => d.stack.id === B.PLANKS)
      .reduce((n, d) => n + d.stack.count, 0),
    7,
  );
  assert.equal(
    drops
      .filter((d) => d.stack.id === B.WOOD)
      .reduce((n, d) => n + d.stack.count, 0),
    1,
  );
});

test("M2 临时编辑世界隔离，退回完整箱炉动物与工具", async () => {
  setup();
  const { enterLevelEditor, exitLevelEditor } = await import(
    "../../js/levelEditor.js"
  );
  setB(30, 9, 20, L.CHEST);
  give(ToolTypes.WOOD_PICKAXE, 1, 17);
  depositToContainer(30, 9, 20, ToolTypes.WOOD_PICKAXE);
  furnace();
  advance(3);
  const e = spawnMob("sheep", 22.5, 9, 22.5);
  give(I.WHEAT);
  feedFarmAnimal(e);
  nameFarmAnimal(e, "小白");
  const before = captureLifeState();
  assert.ok(await enterLevelEditor());
  assert.deepEqual(lifeData().containers, {});
  assert.equal(state.enemies.filter((a) => a.owned).length, 0);
  assert.ok(saveSnapshotForReload());
  assert.equal(saveGame(), false);
  assert.ok(await exitLevelEditor({ saveDraft: false }));
  assert.deepEqual(captureLifeState(), before);
  assert.equal(restoreSnapshotIfAny(), false);
});
test("M2 AI标准生存执行前拦脚本副作用、文件写入和生成草稿", async () => {
  setup();
  const { executeTool } = await import("../../js/assistant/tools.js");
  globalThis.__m2ScriptRan = false;
  for (const [name, args] of [
    ["run_build_script", { code: "globalThis.__m2ScriptRan=true;" }],
    ["write_game_file", { path: "x.js", content: "x" }],
    ["place_blocks", { blocks: [[20, 9, 20, B.STONE]] }],
    ["clear_area", { x1: 1, y1: 1, z1: 1, x2: 2, y2: 2, z2: 2 }],
    ["gen_level_draft", {}],
  ]) {
    const r = await executeTool(name, args);
    assert.equal(r.isError, true);
    assert.match(r.result, /标准生存/);
  }
  assert.equal(globalThis.__m2ScriptRan, false);
  delete globalThis.__m2ScriptRan;
});
test("M2 关门挡住持麦引诱的羊，开门才通过", () => {
  setup();
  const e = spawnMob("sheep", 20.5, 9, 24.5);
  Object.assign(state.player, {
    x: 20.5,
    y: 9,
    z: 18.5,
    selectedSlot: HotbarBlocks.indexOf(I.WHEAT),
  });
  give(I.WHEAT, 2);
  for (let x = 18; x <= 22; x++) setB(x, 9, 22, L.FENCE);
  setB(20, 9, 22, L.GATE);
  for (let i = 0; i < 300; i++) updateEnemies(1 / 60);
  assert.ok(e.z >= 23.35, "羊没有越过关闭围栏");
  setB(20, 9, 22, L.GATE_OPEN);
  e.heading = Math.PI;
  e.moving = true;
  e.flee = 0;
  e.moveTimer = 100;
  for (let i = 0; i < 300; i++) updateEnemies(1 / 60);
  assert.ok(e.z < 22, "开门后持麦能领出");
});
