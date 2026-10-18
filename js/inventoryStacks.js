// Count inventory compatibility + exact per-tool wear. Current tool first, reserves follow.
import { BlockInfo, LIFE } from "./config.js";
import { state } from "./state.js";
export function toolWears(id, p = state.player) {
  const n = Math.min(LIFE.maxToolCount, Math.max(0, p.inventory[id] || 0));
  if (!BlockInfo[id]?.maxDurability || !n) return [];
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? p.toolWear[id] || 0 : p.toolReserveWear?.[id]?.[i - 1] || 0,
  );
}
function putWears(id, wears, p) {
  p.toolWear ||= {};
  p.toolReserveWear ||= {};
  if (wears.length) {
    p.toolWear[id] = wears[0];
    p.toolReserveWear[id] = wears.slice(1);
  } else {
    delete p.toolWear[id];
    delete p.toolReserveWear[id];
  }
}
export function inventoryCapacity(id, p = state.player) {
  return Math.max(
    0,
    (BlockInfo[id]?.maxDurability ? LIFE.maxToolCount : LIFE.maxInventory) -
      (p.inventory[id] || 0),
  );
}
export function addInventoryStack(stack, p = state.player) {
  if (
    !stack ||
    !BlockInfo[stack.id] ||
    !Number.isInteger(stack.count) ||
    stack.count <= 0
  )
    return 0;
  const maxWear = BlockInfo[stack.id].maxDurability;
  if (
    maxWear &&
    (!Number.isInteger(stack.wear ?? 0) ||
      (stack.wear ?? 0) < 0 ||
      (stack.wear ?? 0) >= maxWear)
  )
    return 0;
  const { id } = stack,
    n = Math.min(stack.count, inventoryCapacity(id, p));
  if (!n) return 0;
  if (BlockInfo[id].maxDurability) {
    const wears = toolWears(id, p);
    for (let i = 0; i < n; i++) wears.push(stack.wear || 0);
    wears.sort((a, b) => b - a);
    putWears(id, wears, p);
  }
  p.inventory[id] = (p.inventory[id] || 0) + n;
  return n;
}
export function takeInventoryStack(
  id,
  count = 1,
  p = state.player,
  reserveFirst = false,
) {
  if (!Number.isInteger(count) || count <= 0) return null;
  const n = Math.min(
    count,
    p.inventory[id] || 0,
    BlockInfo[id]?.maxDurability ? 1 : count,
  );
  if (!n) return null;
  const stack = { id, count: n };
  if (BlockInfo[id]?.maxDurability) {
    const wears = toolWears(id, p);
    stack.wear =
      (reserveFirst && wears.length > 1 ? wears.pop() : wears.shift()) || 0;
    putWears(id, wears, p);
  }
  p.inventory[id] -= n;
  return stack;
}
export function damageInventoryTool(id, amount = 1, p = state.player) {
  const max = BlockInfo[id]?.maxDurability;
  if (!max || !p.inventory[id]) return false;
  const wears = toolWears(id, p);
  wears[0] += amount;
  const broken = wears[0] >= max;
  if (broken) {
    wears.shift();
    p.inventory[id]--;
  }
  putWears(id, wears, p);
  return broken;
}
export function peekInventoryStack(id, count = 64, p = state.player) {
  return {
    id,
    count: Math.min(
      count,
      p.inventory[id] || 0,
      BlockInfo[id]?.maxDurability ? 1 : count,
    ),
    ...(BlockInfo[id]?.maxDurability ? { wear: p.toolWear[id] || 0 } : {}),
  };
}
