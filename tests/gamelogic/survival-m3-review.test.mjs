import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorld, setB, at, state, pump } from './kit.mjs';
import * as C from '../../js/config.js';
import { placeKinetic, updateKineticNetwork } from '../../js/kinetic.js';
import { placePiston, enqueuePistonAction, updatePistonTick } from '../../js/piston.js';
import { captureLifeState } from '../../js/lifeData.js';
import { containerAt } from '../../js/homestead.js';
import { saveGame, loadGame } from '../../js/saveGame.js';
import { getHomeGuide } from '../../js/homeSurvival.js';
import { setState, setAssistantVisible, isAssistantVisible } from '../../js/uiModal.js';
import { updateAdventureHUD, openAdventurePanel, closeAdventurePanel } from '../../js/adventureUI.js';
import { initUI, showAssistantPanel } from '../../js/assistant/ui.js';

const B = C.BlockTypes;
const FX = { dx: 1, dy: 0, dz: 0 };
const FZ = { dx: 0, dy: 0, dz: 1 };
const UP = { dx: 0, dy: 1, dz: 0 };

function setup() {
    freshWorld({ gameMode: C.GameModes.SURVIVAL });
    state.levelRun = state.levelEdit = state.temporaryWorldTransition = null;
    state.editorExitOpen = false;
    state.inputMode = 'keyboard';
    state.camMode = 'player';
    state.player.hunger = 20;
    state.player.air = 10;
    state.saveSlot = 5;
    setState('playing');
}

function firstMachineDrop() {
    for (let frame = 0; frame < 180 && !state.itemDrops.length; frame++) pump(1 / 60);
    assert.equal(state.itemDrops.length, 1, '真实机器必须先消耗原料并生成产物');
    const drop = state.itemDrops[0];
    assert.equal(drop.itemId, B.PLANKS);
    assert.equal(drop.count, 4);
    assert.ok(!drop.carried, '截取的是产物离机后、尚未落带的窗口');
    assert.ok(drop.y > 10, '产物仍在空中');
    assert.equal(
        captureLifeState().drops.reduce((n, d) => n + d.stack.count, 0),
        4,
    );
    assert.equal(saveGame(), true);
    assert.equal(loadGame(5), true);
    assert.equal(
        state.itemDrops.reduce((n, d) => n + d.count, 0),
        4,
        '读档恢复四件产物',
    );
}

test('M3 审查：锯切产物离机首帧存读档，原料与四木板到入箱全程守恒', () => {
    setup();
    setB(30, 11, 30, B.WATER);
    for (const [x, id] of [
        [30, C.WATERWHEEL_ITEM_ID],
        [31, C.SHAFT_ITEM_ID],
        [32, C.SAW_ITEM_ID],
    ]) {
        assert.equal(placeKinetic(x, 10, 30, id, FX), null);
    }
    state.player.yaw = -Math.PI / 2;
    for (let x = 32; x <= 35; x++) assert.equal(placeKinetic(x, 9, 30, C.BELT_ITEM_ID, UP), null);
    setB(36, 9, 30, C.LifeBlocks.CHEST);
    containerAt(36, 9, 30);
    updateKineticNetwork();
    setB(33, 10, 30, B.WOOD);
    firstMachineDrop();
    assert.equal(at(33, 10, 30), B.AIR, '原料没有随读档复活');
    pump(1 / 60, 600);
    assert.equal(
        containerAt(36, 9, 30).slots.reduce((n, s) => n + (s?.count || 0), 0),
        4,
    );
    assert.equal(state.itemDrops.length, 0);
    assert.equal(state.adventure.delivered, 4);
    assert.equal(state.player.inventory[B.PLANKS] || 0, 0);
});

test('M3 审查：粉碎轮产物弹出首帧存读档也不会丢失或再次加工', () => {
    setup();
    setB(24, 10, 28, B.WATER);
    assert.equal(placeKinetic(24, 9, 28, C.WATERWHEEL_ITEM_ID, FZ), null);
    for (const z of [29, 30]) assert.equal(placeKinetic(24, 9, z, C.SHAFT_ITEM_ID, FZ), null);
    for (const x of [23, 24]) assert.equal(placeKinetic(x, 9, 31, C.CRUSHER_ITEM_ID, FZ), null);
    setB(24, 10, 31, B.WOOD);
    firstMachineDrop();
    assert.equal(at(24, 10, 31), B.AIR);
    pump(1 / 60, 180);
    assert.equal(
        state.itemDrops.reduce((n, d) => n + d.count, 0),
        4,
    );
});

test('M3 审查：四向梯子被普通或粘性活塞推压只返一梯，不留下悬空可爬梯', () => {
    for (const piston of [C.PISTON_ITEM_ID, C.STICKY_PISTON_ITEM_ID]) {
        for (let facing = 0; facing < 4; facing++) {
            setup();
            const [wx, wz] = [
                [0, -1],
                [1, 0],
                [0, 1],
                [-1, 0],
            ][facing];
            const face = facing % 2 ? FZ : FX;
            const bx = 20 - face.dx,
                bz = 20 - face.dz;
            setB(20 + wx, 9, 20 + wz, B.STONE);
            setB(20, 9, 20, C.LADDER_BASE + facing);
            assert.equal(placePiston(bx, 9, bz, piston, face), null);
            enqueuePistonAction(bx, 9, bz, true);
            updatePistonTick(0.2);
            assert.ok(C.isPistonHeadId(at(20, 9, 20)));
            assert.equal(at(20 + face.dx, 9, 20 + face.dz), B.AIR);
            assert.equal(state.player.inventory[C.LADDER_BASE], 1);
            enqueuePistonAction(bx, 9, bz, false);
            updatePistonTick(0.2);
            assert.equal(at(20, 9, 20), B.AIR);
            assert.equal(state.player.inventory[C.LADDER_BASE], 1, '收回也不能重复返还');
            assert.equal(state.lifePendingDrops.length, 0, '直接压碎与失去支撑不可双重掉落');
        }
    }
});

test('M3 审查：只有原料的新玩家收到制作指引，远处营地工作台不被说成亲手放置', () => {
    setup();
    state.generationVersion = 3;
    state.player.inventory = { [B.WOOD]: 6, [B.WOOL]: 3 };
    setB(80, 9, 128, B.CRAFTING_TABLE);
    assert.match(getHomeGuide(), /按 E 把原木变成木板，用 4 木板制作工作台/);
    assert.doesNotMatch(getHomeGuide(), /回到你放好的工作台/);
    setB(4, 9, 3, B.CRAFTING_TABLE);
    assert.match(getHomeGuide(), /工作台就在附近/);
});

test('M3 审查：未打开 J 时 HUD 已安装定位样式，首次开面板不重复安装且暂停隐藏', () => {
    setup();
    const headStart = document.head.children.length;
    updateAdventureHUD(0.25);
    const styles = () => document.head.children.slice(headStart).filter((n) => n.tagName === 'STYLE');
    const hud = document.body.children.find((n) => n.id === 'adventure-hud');
    assert.ok(hud);
    assert.equal(styles().length, 1, 'HUD 自己安装样式，不依赖先打开手册');
    assert.match(styles()[0].textContent, /#adventure-hud\{position:fixed;[^}]*z-index:8/);
    assert.equal(hud.style.display, '');
    openAdventurePanel();
    updateAdventureHUD(0.25);
    assert.equal(hud.style.display, 'none');
    assert.equal(styles().length, 1);
    closeAdventurePanel();
    updateAdventureHUD(0.25);
    assert.equal(hud.style.display, '');
});

test('M3 审查：作品录像调用助手入口，初始化前安全拒绝、初始化后可见', () => {
    setup();
    setAssistantVisible(false);
    assert.equal(showAssistantPanel({ focusInput: false }), false);
    assert.equal(isAssistantVisible(), false);
    initUI();
    assert.equal(showAssistantPanel({ focusInput: false }), true);
    assert.equal(isAssistantVisible(), true);
    setAssistantVisible(false);
    state.editorExitOpen = true;
    assert.equal(showAssistantPanel({ focusInput: false }), false);
    assert.equal(isAssistantVisible(), false);
    state.editorExitOpen = false;
});
