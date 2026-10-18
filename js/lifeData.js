// Serializable life state. No renderer/world imports: safe to call at voxel write boundary.
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
} from "./config.js";
import { state } from "./state.js";
export const lifeKey = (x, y, z) => `${x},${y},${z}`;
export function resetLifeData() {
  state.life = {
    v: 1,
    containers: {},
    plants: {},
    starter: false,
    nextAnimalId: 1,
  };
  state.lifePendingDrops = [];
  state.lifePendingAnimals = [];
  state.lifePanel = null;
}
export function lifeData() {
  if (!state.life) resetLifeData();
  return state.life;
}
export function emptyContainer(id) {
  return id === LifeBlocks.CHEST
    ? { kind: "chest", slots: Array(LIFE.chestSlots).fill(null) }
    : {
        kind: "furnace",
        input: null,
        fuel: null,
        output: null,
        processing: null,
        progress: 0,
        burnRemaining: 0,
      };
}
export function getContainer(x, y, z, id) {
  const k = lifeKey(x, y, z),
    l = lifeData();
  if (!isContainerId(id)) return null;
  if (!l.containers[k] && Object.keys(l.containers).length < LIFE.maxObjects)
    l.containers[k] = emptyContainer(id);
  return l.containers[k] || null;
}
export function stackLimit(id) {
  return BlockInfo[id]?.maxDurability ? 1 : LIFE.stackSize;
}
export function insertSlots(slots, stack) {
  if (
    !stack ||
    !Number.isInteger(stack.id) ||
    !BlockInfo[stack.id] ||
    !Number.isSafeInteger(stack.count) ||
    stack.count <= 0 ||
    stack.count > LIFE.maxInventory ||
    !validStack({
      ...stack,
      count: Math.min(stack.count, stackLimit(stack.id)),
    })
  )
    return 0;
  let left = stack.count;
  for (const slot of slots) {
    if (
      slot &&
      slot.id === stack.id &&
      (slot.wear || 0) === (stack.wear || 0)
    ) {
      const n = Math.min(left, stackLimit(slot.id) - slot.count);
      slot.count += n;
      left -= n;
      if (!left) return stack.count;
    }
  }
  for (let i = 0; i < slots.length && left; i++)
    if (!slots[i]) {
      const n = Math.min(left, stackLimit(stack.id));
      slots[i] = { ...stack, count: n };
      left -= n;
    }
  return stack.count - left;
}
export function onLifeBlockChanged(x, y, z, oldId, newId) {
  if (
    !isContainerId(oldId) &&
    !isCropId(oldId) &&
    oldId !== LifeBlocks.SAPLING &&
    !isCropId(newId) &&
    newId !== LifeBlocks.SAPLING
  )
    return;
  const l = lifeData(),
    k = lifeKey(x, y, z);
  if (isContainerId(oldId) && oldId !== newId) {
    const c = l.containers[k];
    delete l.containers[k];
    if (c) {
      for (const s of c.kind === "chest"
        ? c.slots
        : [c.input, c.fuel, c.output, c.processing])
        if (s)
          state.lifePendingDrops.push({
            x: x + 0.5,
            y: y + 0.5,
            z: z + 0.5,
            stack: { ...s },
          });
    }
  }
  if (isCropId(oldId) || oldId === LifeBlocks.SAPLING) delete l.plants[k];
  if (isCropId(newId) || newId === LifeBlocks.SAPLING) {
    if (Object.keys(l.plants).length < LIFE.maxObjects)
      l.plants[k] = { id: newId, elapsed: 0 };
  }
}
// 支撑失效只返还一次完整收获物；编辑/闯关世界移除外形但不发生活物资。
export function queuePlantRefund(x,y,z,id) {
  if(state.levelRun||state.levelEdit)return;
  const stacks=id===LifeBlocks.SAPLING?[{id,count:1}]:[{id:LifeItems.SEEDS,count:id===LifeBlocks.WHEAT_MATURE?2:1},...(id===LifeBlocks.WHEAT_MATURE?[{id:LifeItems.WHEAT,count:1}]:[])];
  for(const stack of stacks)state.lifePendingDrops.push({x:x+.5,y:y+.2,z:z+.5,stack});
}
export function plantHasSupport(id,below) {
  return isCropId(id)?below===LifeBlocks.FARMLAND:id===LifeBlocks.SAPLING?[BlockTypes.GRASS,BlockTypes.DIRT].includes(below):true;
}
const animalFields = [
  "animalId",
  "type",
  "x",
  "y",
  "z",
  "hp",
  "name",
  "woolTimer",
  "shorn",
  "fed",
  "feedCooldown",
];
// Saving loses visual velocity, never ownership or contents; clamp transient airborne edges.
function savedPosition(p) {
  return {
    ...p,
    x: Math.max(0, Math.min(WORLD_WIDTH - 0.001, p.x)),
    y: Math.max(0, Math.min(WORLD_HEIGHT - 0.001, p.y)),
    z: Math.max(0, Math.min(WORLD_DEPTH - 0.001, p.z)),
  };
}
export function captureLifeState() {
  const l = lifeData();
  const livestock = state.enemies
    .filter((e) => e.owned && e.hp > 0)
    .map((e) =>
      savedPosition(
        Object.fromEntries(
          animalFields.map((k) => [
            k,
            e[k] ??
              (k === "name" ? "" : k === "shorn" || k === "fed" ? false : 0),
          ]),
        ),
      ),
    );
  const drops = [
    ...(state.lifePendingDrops || []),
    ...state.itemDrops
      .filter((d) => d.lifePersistent)
      .map((d) => ({
        x: d.x,
        y: d.y,
        z: d.z,
        stack: {
          id: d.itemId,
          count: d.count,
          ...(BlockInfo[d.itemId]?.maxDurability
            ? { wear: d.toolWear || 0 }
            : {}),
        },
      })),
  ];
  return JSON.parse(
    JSON.stringify({
      ...l,
      livestock,
      drops: drops.map(savedPosition),
      rules: state.survivalRules || "standard",
    }),
  );
}
function validStack(s) {
  if (s === null) return true;
  if (
    !s ||
    !Number.isInteger(s.id) ||
    !BlockInfo[s.id] ||
    s.id === BlockTypes.AIR ||
    !Number.isInteger(s.count) ||
    s.count < 1 ||
    s.count > stackLimit(s.id)
  )
    return false;
  const max = BlockInfo[s.id].maxDurability;
  return max
    ? Number.isInteger(s.wear ?? 0) && (s.wear ?? 0) >= 0 && (s.wear ?? 0) < max
    : s.wear === undefined || s.wear === 0;
}
function validPos(p) {
  return (
    ["x", "y", "z"].every((k) => Number.isFinite(p[k])) &&
    p.x >= 0 &&
    p.x < WORLD_WIDTH &&
    p.y >= 0 &&
    p.y < WORLD_HEIGHT &&
    p.z >= 0 &&
    p.z < WORLD_DEPTH
  );
}
export function validateLifeState(
  raw,
  blocks,
  dims = [WORLD_WIDTH, WORLD_HEIGHT, WORLD_DEPTH],
  player = {},
) {
  // 兼容旧档缺耐久字段；一旦存在，数量与每一把当前/备用磨损都必须有效。
  const inventory=player.inventory??{};
  if(!inventory||typeof inventory!=='object'||Array.isArray(inventory))return '背包数据损坏';
  for(const [id,count]of Object.entries(inventory))if(BlockInfo[id]?.maxDurability&&(!Number.isSafeInteger(count)||count<0||count>LIFE.maxToolCount))return '工具数量损坏';
  for(const field of ['toolWear','toolReserveWear']) {
    const map=player[field];if(map===undefined)continue;
    if(!map||typeof map!=='object'||Array.isArray(map))return '工具耐久数据损坏';
    for(const [id,value]of Object.entries(map)) {
      const max=BlockInfo[id]?.maxDurability,count=inventory[id]||0;
      if(!max||!Number.isSafeInteger(count)||count<1||count>LIFE.maxToolCount)return '工具数量与耐久不匹配';
      const wears=field==='toolWear'?[value]:value;
      if(!Array.isArray(wears)||field==='toolReserveWear'&&wears.length>count-1||wears.some(w=>!Number.isInteger(w)||w<0||w>=max))return '工具耐久数据损坏';
    }
  }
  if (raw === undefined) return null;
  if (!raw || raw.v !== 1 || !raw.containers || !raw.plants)
    return "生活数据格式损坏";
  const [w, h, d] = dims;
  const readKey = (k) => {
    if (!/^\d+,\d+,\d+$/.test(k)) return null;
    const a = k.split(",").map(Number);
    return a[0] < w && a[1] < h && a[2] < d ? a : null;
  };
  for (const field of ["containers", "plants"]) {
    if (
      typeof raw[field] !== "object" ||
      Array.isArray(raw[field]) ||
      Object.keys(raw[field]).length > LIFE.maxObjects
    )
      return "生活对象数量超限";
    for (const [k, c] of Object.entries(raw[field])) {
      const a = readKey(k);
      if (!a || !c) return "生活对象坐标损坏";
      const id = blocks[a[0] + a[2] * w + a[1] * w * d];
      if (field === "plants") {
        if (
          c.id !== id ||
          (!isCropId(id) && id !== LifeBlocks.SAPLING) ||
          !Number.isFinite(c.elapsed) ||
          c.elapsed < 0 ||
          c.elapsed > 1e6
        )
          return "植物数据与地形不匹配";
      } else if (c.kind === "chest") {
        if (
          id !== LifeBlocks.CHEST ||
          !Array.isArray(c.slots) ||
          c.slots.length !== LIFE.chestSlots ||
          !c.slots.every(validStack)
        )
          return "箱子数据损坏";
      } else if (c.kind === "furnace") {
        if (
          id !== BlockTypes.FURNACE ||
          ![c.input, c.fuel, c.output, c.processing].every(validStack) ||
          !Number.isFinite(c.progress) ||
          c.progress < 0 ||
          c.progress > LIFE.furnaceSeconds ||
          !Number.isFinite(c.burnRemaining) ||
          c.burnRemaining < 0 ||
          c.burnRemaining > 64
        )
          return "熔炉数据损坏";
        if (
          c.processing &&
          (!SMELTING_RECIPES.some((r) => r.input === c.processing.id) ||
            c.processing.count !== 1)
        )
          return "熔炉加工中原料损坏";
        if (c.fuel && !FURNACE_FUELS[c.fuel.id]) return "熔炉燃料损坏";
      } else return "未知容器";
    }
  }
  if (
    !Array.isArray(raw.livestock || []) ||
    (raw.livestock || []).length > LIFE.maxAnimals
  )
    return "家畜数量超限";
  const ids = new Set();
  for (const e of raw.livestock || []) {
    if (
      !validPos(e) ||
      !["pig", "sheep", "cow"].includes(e.type) ||
      !Number.isSafeInteger(e.animalId) ||
      e.animalId < 1 ||
      ids.has(e.animalId) ||
      typeof e.name !== "string" ||
      e.name.length > 24 ||
      !Number.isFinite(e.hp) ||
      e.hp <= 0 ||
      e.hp > 100 ||
      !Number.isFinite(e.woolTimer) ||
      e.woolTimer < 0 ||
      e.woolTimer > 1e6 ||
      !Number.isFinite(e.feedCooldown) ||
      e.feedCooldown < 0 ||
      e.feedCooldown > 60 ||
      typeof e.shorn !== "boolean" ||
      typeof e.fed !== "boolean"
    )
      return "家畜数据损坏";
    ids.add(e.animalId);
  }
  if (
    !Array.isArray(raw.drops || []) ||
    (raw.drops || []).length > LIFE.maxObjects * LIFE.chestSlots + 4096
  )
    return "掉落物数量超限";
  for (const d of raw.drops || [])
    if (!validPos(d) || !validStack(d.stack) || !d.stack)
      return "掉落物数据损坏";
  return null;
}
export function restoreLifeState(raw) {
  resetLifeData();
  if (!raw) {
    state.survivalRules = "standard";
    return;
  }
  state.life = JSON.parse(
    JSON.stringify({
      v: 1,
      containers: raw.containers,
      plants: raw.plants,
      starter: raw.starter === true,
      nextAnimalId: Math.max(
        1,
        ...(raw.livestock || []).map((e) => e.animalId + 1),
      ),
    }),
  );
  state.lifePendingAnimals = raw.livestock || [];
  state.lifePendingDrops = raw.drops || [];
  state.survivalRules = raw.rules === "experiment" ? "experiment" : "standard";
}
