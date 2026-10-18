import { adventureData } from './adventureData.js';
import { isWorldPaused } from "./uiModal.js";
import {
  BlockInfo,
  BlockTypes,
  LifeBlocks,
  LifeItems,
  LIFE,
  SMELTING_RECIPES,
  FURNACE_FUELS,
  isCropId,
  isContainerId,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  WORLD_DEPTH,
  HotbarBlocks,
  CHUNK_SIZE,
} from "./config.js";
import { state, isCreative } from "./state.js";
import { getBlock, setBlockSafe } from "./world.js";
import { lifeData, lifeKey, getContainer, insertSlots, plantHasSupport, queuePlantRefund } from "./lifeData.js";
import {
  peekInventoryStack,
  takeInventoryStack,
  addInventoryStack,
  damageInventoryTool,
  inventoryCapacity,
} from "./inventoryStacks.js";
import { spawnItemDrop } from "./items.js";
import { rebuildChunk } from "./chunk.js";
import { updateKineticNetwork } from "./kinetic.js";
import { updateRedstoneNetwork } from "./redstone.js";
const blocked = () => !!(state.levelRun || state.levelEdit);
// One refresh per touched chunk; trees may cross a chunk two cells away.
function refresh(x, z, radius = 1) {
  const chunks = new Set();
  for (const dx of [-radius, 0, radius])
    for (const dz of [-radius, 0, radius]) {
      const cx = Math.floor((x + dx) / CHUNK_SIZE),
        cz = Math.floor((z + dz) / CHUNK_SIZE);
      if (
        cx >= 0 &&
        cz >= 0 &&
        cx < WORLD_WIDTH / CHUNK_SIZE &&
        cz < WORLD_DEPTH / CHUNK_SIZE
      )
        chunks.add(`${cx},${cz}`);
    }
  for (const k of chunks) rebuildChunk(...k.split(",").map(Number));
}
function have(id) {
  return isCreative() || (state.player.inventory[id] || 0) > 0;
}
function swapHeldBucket(from, to) {
  if (HotbarBlocks[state.player.selectedSlot] !== from) return;
  const index = state.player.quickbar?.indexOf(from) ?? -1;
  if (index >= 0) state.player.quickbar[index] = to;
  state.player.selectedSlot = HotbarBlocks.indexOf(to);
}
function spend(id) {
  if (!isCreative()) takeInventoryStack(id);
}
export function grantFarmStarter() {
  const l = lifeData();
  if (blocked() || l.starter) return false;
  l.starter = true;
  addInventoryStack({ id: LifeItems.SEEDS, count: 8 });
  addInventoryStack({ id: LifeBlocks.SAPLING, count: 2 });
  return true;
}
export function containerAt(x, y, z) {
  return getContainer(x, y, z, getBlock(x, y, z));
}
export function depositToContainer(x, y, z, id, count = 64, slot = "input") {
  if (blocked()) return { count: 0, error: "临时关卡不使用生活库存" };
  const c = containerAt(x, y, z);
  if (!c) return { count: 0, error: "容器不存在或数量已达上限" };
  const stack = peekInventoryStack(id, count);
  if (!stack.count) return { count: 0, error: "背包没有这件物品" };
  let n = 0;
  if (c.kind === "chest") n = insertSlots(c.slots, stack);
  else {
    if (!["input", "fuel"].includes(slot))
      return { count: 0, error: "只能放入原料或燃料" };
    if (
      (slot === "fuel" && !FURNACE_FUELS[id]) ||
      (slot === "input" && !SMELTING_RECIPES.some((r) => r.input === id))
    )
      return {
        count: 0,
        error:
          slot === "fuel" ? "燃料可用煤炭、原木或木板" : "这个原料不能烧制",
      };
    const a = [c[slot]];
    n = insertSlots(a, stack);
    c[slot] = a[0];
  }
  if (n) takeInventoryStack(id, n);
  return { count: n, error: n ? null : "容器已满，物品仍在背包" };
}
export function withdrawFromContainer(x, y, z, slot, count = 64) {
  if (blocked()) return { count: 0, error: "临时关卡不使用生活库存" };
  const c = containerAt(x, y, z);
  if (!c) return { count: 0, error: "容器不存在" };
  if (
    (c.kind === "chest" &&
      (!Number.isInteger(slot) || slot < 0 || slot >= LIFE.chestSlots)) ||
    (c.kind === "furnace" && !["input", "fuel", "output"].includes(slot))
  )
    return { count: 0, error: "无效格子" };
  const s = c.kind === "chest" ? c.slots[slot] : c[slot];
  if (!s) return { count: 0, error: "这里是空的" };
  const n = addInventoryStack({ ...s, count: Math.min(count, s.count) });
  s.count -= n;
  if (!s.count) {
    if (c.kind === "chest") c.slots[slot] = null;
    else c[slot] = null;
  }
  return { count: n, error: n ? null : "背包已满" };
}
export function chestOrganize(x, y, z, mode) {
  const c = containerAt(x, y, z);
  if (!c || c.kind !== "chest") return 0;
  let n = 0;
  if (mode === "same") {
    const ids = new Set(c.slots.filter(Boolean).map((s) => s.id));
    for (const id of ids)
      for (
        let i = 0;
        i < LIFE.chestSlots && state.player.inventory[id] > 0;
        i++
      ) {
        const r = depositToContainer(x, y, z, id);
        n += r.count;
        if (!r.count) break;
      }
  } else if (mode === "quick") {
    for (const id of new Set(state.player.quickbar || [])) {
      let need =
        (BlockInfo[id]?.maxDurability ? 1 : 16) -
        (state.player.inventory[id] || 0);
      for (let i = 0; i < c.slots.length && need > 0; i++)
        if (c.slots[i]?.id === id) {
          const r = withdrawFromContainer(x, y, z, i, need);
          n += r.count;
          need -= r.count;
        }
    }
  }
  return n;
}
export function harvestPlant(x, y, z) {
  const id = getBlock(x, y, z);
  if (!isCropId(id) && id !== LifeBlocks.SAPLING) return null;
  if (state.levelRun) return "闯关中不能收获";
  setBlockSafe(x, y, z, BlockTypes.AIR);
  if (!isCreative() && !state.levelEdit) {
    if (id === LifeBlocks.SAPLING) addInventoryStack({ id, count: 1 });
    else {
      addInventoryStack({
        id: LifeItems.SEEDS,
        count: id === LifeBlocks.WHEAT_MATURE ? 2 : 1,
      });
      if (id === LifeBlocks.WHEAT_MATURE) {
        addInventoryStack({ id: LifeItems.WHEAT, count: 1 });
        adventureData().harvests++;
      }
    }
  }
  refresh(x, z);
  if(state.levelEdit)return "已移除植物（编辑器不发生活物资）";
  return id === LifeBlocks.WHEAT_MATURE
    ? "收获小麦 ×1、种子 ×2，可继续播种"
    : "已收回种子／树苗";
}
export function useFarmItem(id, hit) {
  if (
    ![
      LifeItems.HOE,
      LifeItems.SEEDS,
      LifeItems.BUCKET,
      LifeItems.WATER_BUCKET,
      LifeBlocks.SAPLING,
    ].includes(id)
  )
    return null;
  if (blocked()) return "临时关卡不能使用生活工具";
  if (!have(id)) return "背包没有这件物品";
  if (!hit) return "请对准近处的土地或水面";
  const { x, y, z, block } = hit;
  if (id === LifeItems.HOE) {
    if (
      ![BlockTypes.GRASS, BlockTypes.DIRT].includes(block) ||
      getBlock(x, y + 1, z) !== 0
    )
      return "请对准上方空着的草地或泥土";
    setBlockSafe(x, y, z, LifeBlocks.FARMLAND);
    if (!isCreative()) damageInventoryTool(id);
    refresh(x, z);
    return "耕地准备好了，在附近放水后播种";
  }
  if (id === LifeItems.BUCKET) {
    if (block !== BlockTypes.WATER)
      return "空桶要对准水面；旧世界无水可在工作台制作「集水」";
    if (inventoryCapacity(LifeItems.WATER_BUCKET) < 1) return "背包已满";
    setBlockSafe(x, y, z, 0);
    spend(id);
    addInventoryStack({ id: LifeItems.WATER_BUCKET, count: 1 });
    swapHeldBucket(id, LifeItems.WATER_BUCKET);
    refresh(x, z);
    updateKineticNetwork();
    updateRedstoneNetwork();
    return "装满水桶了";
  }
  const bx = x + hit.face.dx,
    by = y + hit.face.dy,
    bz = z + hit.face.dz;
  if (
    bx < 0 ||
    bz < 0 ||
    by < 1 ||
    bx >= WORLD_WIDTH ||
    bz >= WORLD_DEPTH ||
    by >= WORLD_HEIGHT - 8 ||
    getBlock(bx, by, bz) !== 0
  )
    return "这里没有可用的空间";
  if (id === LifeItems.WATER_BUCKET) {
    if (inventoryCapacity(LifeItems.BUCKET) < 1) return "背包已满";
    setBlockSafe(bx, by, bz, BlockTypes.WATER);
    spend(id);
    addInventoryStack({ id: LifeItems.BUCKET, count: 1 });
    swapHeldBucket(id, LifeItems.BUCKET);
    refresh(bx, bz);
    updateKineticNetwork();
    updateRedstoneNetwork();
    return "水已放好，空桶可以再用";
  }
  if (Object.keys(lifeData().plants).length >= LIFE.maxObjects)
    return "种植数量已达上限";
  if (id === LifeItems.SEEDS) {
    if (getBlock(bx, by - 1, bz) !== LifeBlocks.FARMLAND)
      return "种子要种在耕地上";
    if (!hasFarmWater(bx, by, bz)) return "耕地四格内需要水，先用水桶浇出水源";
    setBlockSafe(bx, by, bz, LifeBlocks.WHEAT);
  } else {
    if (![BlockTypes.DIRT, BlockTypes.GRASS].includes(getBlock(bx, by - 1, bz)))
      return "树苗要种在草地或泥土上";
    setBlockSafe(bx, by, bz, LifeBlocks.SAPLING);
  }
  spend(id);
  refresh(bx, bz);
  return id === LifeItems.SEEDS
    ? "播种完成，收起面板后小麦慢慢长大"
    : "树苗已种好，周围留出五格宽、七格高的空间";
}
export function hasFarmWater(x, y, z) {
  for (let dx = -4; dx <= 4; dx++)
    for (let dz = -4; dz <= 4; dz++)
      for (const dy of [-1, 0])
        if (getBlock(x + dx, y + dy, z + dz) === BlockTypes.WATER) return true;
  return false;
}
export function treeCells(x, y, z) {
  const cells = [];
  for (let h = 0; h < 5; h++)
    cells.push({ x, y: y + h, z, id: BlockTypes.WOOD });
  for (let h = 3; h <= 6; h++)
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        if (
          !(dx === 0 && dz === 0 && h < 5) &&
          Math.abs(dx) + Math.abs(dz) <= 3
        )
          cells.push({ x: x + dx, y: y + h, z: z + dz, id: BlockTypes.LEAVES });
  return cells;
}
export function growTreeAt(x, y, z) {
  if (
    getBlock(x, y, z) !== LifeBlocks.SAPLING ||
    ![BlockTypes.DIRT, BlockTypes.GRASS].includes(getBlock(x, y - 1, z))
  )
    return false;
  const cells = treeCells(x, y, z);
  if (
    cells.some(
      (c) =>
        c.x < 0 ||
        c.x >= WORLD_WIDTH ||
        c.y >= WORLD_HEIGHT ||
        c.z < 0 ||
        c.z >= WORLD_DEPTH ||
        (!(c.x === x && c.y === y && c.z === z) &&
          getBlock(c.x, c.y, c.z) !== 0),
    )
  )
    return false;
  for (const c of cells) setBlockSafe(c.x, c.y, c.z, c.id);
  refresh(x, z, 2);
  return true;
}
function dec(c, k) {
  if (--c[k].count === 0) c[k] = null;
}
export function furnaceStatus(c) {
  if (!c) return "熔炉不存在";
  const r = SMELTING_RECIPES.find(
    (r) => r.input === (c.processing || c.input)?.id,
  );
  if (!r) return "放入沙、圆石、铁矿、猪肉或原木";
  if (c.output && (c.output.id !== r.out || c.output.count >= 64))
    return "输出已满：请取出成品";
  if (c.burnRemaining <= 0 && !c.fuel) return "缺少燃料：可用原木、木板或煤";
  return `烧制中 ${Math.floor((c.progress / LIFE.furnaceSeconds) * 100)}% · 收起后继续烧制`;
}
export function tickHomestead(dt) {
  if (blocked() || isWorldPaused() || !Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 0.25);
  const l = lifeData();
  for (const [k, c] of Object.entries(l.containers)) {
    if (c.kind !== "furnace") continue;
    const r = SMELTING_RECIPES.find(
      (r) => r.input === (c.processing || c.input)?.id,
    );
    if (!r || (c.output && (c.output.id !== r.out || c.output.count >= 64)))
      continue;
    if (c.burnRemaining <= 0) {
      if (!c.fuel || !FURNACE_FUELS[c.fuel.id]) continue;
      c.burnRemaining = FURNACE_FUELS[c.fuel.id];
      dec(c, "fuel");
    }
    if (!c.processing) {
      c.processing = { id: c.input.id, count: 1 };
      dec(c, "input");
      c.progress = 0;
    }
    const work = Math.min(
      dt,
      c.burnRemaining,
      LIFE.furnaceSeconds - c.progress,
    );
    c.burnRemaining -= work;
    c.progress += work;
    if (c.progress >= LIFE.furnaceSeconds - 1e-8) {
      if (c.output) c.output.count++;
      else c.output = { id: r.out, count: 1 };
      c.processing = null;
      c.progress = 0;
    }
  }
  for (const [k, p] of Object.entries(l.plants)) {
    const [x, y, z] = k.split(",").map(Number);
    if (getBlock(x, y, z) !== p.id) {
      delete l.plants[k];
      continue;
    }
    if(!plantHasSupport(p.id,getBlock(x,y-1,z))) {
      queuePlantRefund(x,y,z,p.id);setBlockSafe(x,y,z,BlockTypes.AIR);refresh(x,z);continue;
    }
    if (p.id === LifeBlocks.SAPLING) {
      p.elapsed = Math.min(LIFE.treeSeconds, p.elapsed + dt);
      if (p.elapsed >= LIFE.treeSeconds) growTreeAt(x, y, z);
    } else if (p.id < LifeBlocks.WHEAT_MATURE && hasFarmWater(x, y, z)) {
      p.elapsed += dt;
      if (p.elapsed >= LIFE.cropStageSeconds) {
        setBlockSafe(x, y, z, p.id + 1);
        refresh(x, z);
      }
    }
  }
}
export function flushLifeDrops() {
  const pending = state.lifePendingDrops || [];
  state.lifePendingDrops = [];
  for (const d of pending)
    spawnItemDrop(d.x, d.y, d.z, d.stack.id, d.stack.count, {
      toolWear: d.stack.wear || 0,
      lifePersistent: true,
    });
}
export function insertChestStack(x, y, z, stack) {
  if (getBlock(x, y, z) !== LifeBlocks.CHEST || blocked())
    return { accepted: 0, remaining: { ...stack } };
  const c = containerAt(x, y, z);
  if (!c) return { accepted: 0, remaining: { ...stack } };
  const accepted = insertSlots(c.slots, stack);
  return {
    accepted,
    remaining:
      accepted === stack.count
        ? null
        : { ...stack, count: stack.count - accepted },
  };
}
