// One keyboard-friendly life panel; opening pauses ordinary survival, as the backpack does.
import {
  BlockInfo,
  LifeItems,
  LIFE,
  SMELTING_RECIPES,
  FURNACE_FUELS,
} from "./config.js";
import { state } from "./state.js";
import { getUIState, setState } from "./uiModal.js";
import { uiKick } from "./uiKeys.js";
import { updateHotbar } from "./ui.js";
import {
  containerAt,
  depositToContainer,
  withdrawFromContainer,
  chestOrganize,
  furnaceStatus,
} from "./homestead.js";
import { feedFarmAnimal, shearFarmAnimal, nameFarmAnimal } from "./entities.js";
let root;
const label = (s) =>
  s
    ? `${BlockInfo[s.id]?.name || "物品"} ×${s.count}${BlockInfo[s.id]?.maxDurability ? `（耐久 ${BlockInfo[s.id].maxDurability - (s.wear || 0)}）` : ""}`
    : "空";
function button(text, fn, parent, accessibleLabel = text) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.setAttribute("aria-label", accessibleLabel);
  b.onclick = () => {
    const result = fn();
    updateHotbar();
    renderLifePanel(
      typeof result === "string"
        ? result
        : result?.error || `已移动 ${result?.count ?? result ?? 0} 件`,
    );
  };
  parent.appendChild(b);
  return b;
}
function ensure() {
  if (root) return;
  const style = document.createElement("style");
  style.textContent = `#life-panel{position:fixed;inset:0;z-index:130;display:none;background:#0b1624bb;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}#life-panel.open{display:flex}.life-card{color:#efeada;background:#20302b;border:2px solid #8da77f;border-radius:16px;padding:22px;width:min(850px,100%);max-height:88vh;overflow:auto;box-sizing:border-box;font:16px/1.55 system-ui}.life-card button{background:#425d45;color:#fff;border:1px solid #88a477;border-radius:7px;padding:10px 13px;margin:4px;cursor:pointer}.life-card button:hover{background:#5a7951}.life-row{border-bottom:1px solid #ffffff22;padding:7px 0;display:flex;align-items:center;flex-wrap:wrap;gap:6px}.life-row span{flex:1;min-width:160px}.life-card input{font:inherit;padding:9px;max-width:75%;color:#14251d}.life-note{color:#c6d9b5}.life-message{color:#ffe29a;min-height:1.6em}.life-card h2,.life-card h3{margin:8px 0}.life-close{float:right}`;
  document.head.appendChild(style);
  root = document.createElement("div");
  root.id = "life-panel";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  document.body.appendChild(root);
}
export function openLifePanel(target) {
  if (state.levelRun || state.levelEdit) return false;
  ensure();
  state.lifePanel = { ...target, world: state.blocks };
  setState("container");
  root.classList.add("open");
  renderLifePanel();
  uiKick();
  return true;
}
export function closeLifePanel() {
  state.lifePanel = null;
  if (root) root.classList.remove("open");
  if (getUIState() === "container") setState("playing");
}
export function syncLifePanel() {
  if (root && getUIState() !== "container") {
    root.classList.remove("open");
    state.lifePanel = null;
  }
}
export function renderLifePanel(message = "") {
  const t = state.lifePanel;
  if (!t || t.world !== state.blocks) {
    closeLifePanel();
    return;
  }
  ensure();
  root.innerHTML = "";
  const card = document.createElement("section");
  card.className = "life-card";
  root.appendChild(card);
  const close = button(
    "收起 E / Esc",
    () => {
      closeLifePanel();
      return "";
    },
    card,
  );
  close.className = "life-close";
  const h = document.createElement("h2");
  card.appendChild(h);
  const msg = document.createElement("p");
  msg.className = "life-message";
  msg.setAttribute("role", "status");
  msg.textContent = message;
  card.appendChild(msg);
  if (t.kind === "animal") {
    const e = t.animal;
    if (!state.enemies.includes(e)) {
      closeLifePanel();
      return;
    }
    h.textContent = `🐑 ${e.name || BlockInfo[LifeItems.WHEAT].name + "与动物"}`;
    const desc = document.createElement("p");
    desc.textContent = e.owned
      ? `你的家畜 · ${e.type === "sheep" ? (e.shorn ? `羊毛生长 ${Math.floor(((e.woolTimer || 0) / LIFE.woolSeconds) * 100)}%${e.fed ? "" : "（需要先喂小麦）"}` : "羊毛已经长好") : "会记得你"}`
      : "拿小麦靠近可以引诱；用 1 份小麦喂养后成为你的家畜。";
    card.appendChild(desc);
    button("喂 1 份小麦", () => feedFarmAnimal(e), card);
    if (e.type === "sheep")
      button("用剪刀剪羊毛", () => shearFarmAnimal(e), card);
    if (e.owned) {
      const input = document.createElement("input");
      input.maxLength = 24;
      input.value = e.name;
      input.setAttribute("aria-label", "家畜名字");
      card.appendChild(input);
      button("记住名字", () => nameFarmAnimal(e, input.value), card);
    }
  } else {
    const { x, y, z } = t,
      c = containerAt(x, y, z);
    if (!c) {
      closeLifePanel();
      return;
    }
    h.textContent = c.kind === "chest" ? "📦 家园箱子" : "🔥 持续熔炉";
    const note = document.createElement("p");
    note.className = "life-note";
    note.textContent =
      c.kind === "chest"
        ? `27 格，每格 64 件；工具单独保存耐久。存同类只存箱内已有的类型，取常用把常用栏材料补到 16、工具补到 1。`
        : "原料和燃料分开放。收起后继续烧制；看面板、暂停、睡眠跳时和离线不会增加产量。原木既可当原料烧炭，也可当燃料。";
    card.appendChild(note);
    if (c.kind === "chest") {
      button("存同类", () => chestOrganize(x, y, z, "same"), card);
      button("取常用", () => chestOrganize(x, y, z, "quick"), card);
    } else {
      const status = document.createElement("p");
      status.textContent = furnaceStatus(c);
      card.appendChild(status);
      const progress = document.createElement("progress");
      progress.max = LIFE.furnaceSeconds;
      progress.value = c.progress;
      progress.setAttribute("aria-label", "烧制进度");
      card.appendChild(progress);
      if (c.processing) {
        const work = document.createElement("p");
        work.textContent = "正在加工：" + label(c.processing);
        card.appendChild(work);
      }
    }
    const stored =
      c.kind === "chest"
        ? c.slots.map((s, i) => [i, s])
        : ["input", "fuel", "output"].map((k) => [k, c[k]]);
    for (const [slot, s] of stored) {
      if (!s && c.kind === "chest") continue;
      const row = document.createElement("div");
      row.className = "life-row";
      card.appendChild(row);
      const name = document.createElement("span");
      name.textContent =
        (c.kind === "furnace"
          ? { input: "原料", fuel: "燃料", output: "成品" }[slot] + ": "
          : "") + label(s);
      row.appendChild(name);
      if (s) {
        button(
          "取 1",
          () => withdrawFromContainer(x, y, z, slot, 1),
          row,
          `取出${BlockInfo[s.id]?.name}一个`,
        );
        button(
          "取整组",
          () => withdrawFromContainer(x, y, z, slot, 64),
          row,
          `取出${BlockInfo[s.id]?.name}整组`,
        );
      }
    }
    const sub = document.createElement("h3");
    sub.textContent = "我的背包 → 放进这里";
    card.appendChild(sub);
    for (const [idStr, count] of Object.entries(state.player.inventory)) {
      if (!count) continue;
      const id = Number(idStr);
      const canSmelt = SMELTING_RECIPES.some((recipe) => recipe.input === id);
      const canBurn = !!FURNACE_FUELS[id];
      if (c.kind === "furnace" && !canSmelt && !canBurn) continue;
      const row = document.createElement("div");
      row.className = "life-row";
      card.appendChild(row);
      const name = document.createElement("span");
      name.textContent = label({
        id,
        count,
        wear: state.player.toolWear[id] || 0,
      });
      row.appendChild(name);
      if (c.kind === "chest") {
        button(
          "存 1",
          () => depositToContainer(x, y, z, id, 1),
          row,
          `存入${BlockInfo[id]?.name}一个`,
        );
        button(
          "存一组",
          () => depositToContainer(x, y, z, id, 64),
          row,
          `存入${BlockInfo[id]?.name}一组`,
        );
      } else {
        if (canSmelt)
          button(
            "原料 +1",
            () => depositToContainer(x, y, z, id, 1, "input"),
            row,
            `放入${BlockInfo[id]?.name}原料`,
          );
        if (canBurn)
          button(
            "燃料 +1",
            () => depositToContainer(x, y, z, id, 1, "fuel"),
            row,
            `加入${BlockInfo[id]?.name}燃料`,
          );
      }
    }
  }
  uiKick();
}
