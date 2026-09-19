# -*- coding: utf-8 -*-
"""UI 键盘导航验收（2026-09-18 键盘化收尾）：浮层内方向键移焦 / Enter·Space 激活。

实现：js/uiKeys.js（document 捕获阶段空间导航引擎）+ 各面板 tabIndex 补齐。
用例（合成 KeyboardEvent 必须带 key 值——引擎按 e.key 分发；老测试只传 code，
key 为空串，天然不触发引擎，回归零风险）：
  UK01 背包（创造）：E 落焦首格 → 方向键移焦 → Enter 选中并收起（selectedSlot 对焦）
  UK02 背包搜索框：↑↓ 退出打字回导航；Esc 只退打字不关面板（再按才关）
  UK03 背包（生存）：落焦首条配方 → Enter 真实合成 + 焦点回补（连续合成不掉位）
  UK04 暂停菜单：落焦「回到游戏」→ ↓ 到 ⚙️ 设置 → Enter 进设置 → Esc 回暂停
  UK05 设置滑块：聚焦 range 后方向键不动焦（原生调节，导航不抢）
  UK06 首屏：↓ 到「🗺 关卡」→ Enter 开列表 → 列表按钮落焦 → Esc 关列表
  UK07 死亡界面：落焦「重生」→ Enter 真实重生回 playing
  UK08 结算面板：落焦「重试」→ 方向键在按钮间移动
  UK09 组件库：落焦首组件 → Enter 关浮层进放置态（startPlacing 真实链路）
  UK10 拍摄面板：Tab 开面板落焦 → 方向键移动 → Tab 关
  UK11 回归：playing 无浮层时方向键直达 input.js（导航零越权，转视角不受影响）

跑法：server.py + chrome_login.py --launch --ephemeral --port 19401 后
     cd tests/e2e && CDP_PORT=19401 python3 run_keyboard_ui.py
"""

from lib import E2E, report

name = "run_keyboard_ui"
e2e = E2E()
checks = []
res = None
try:
    e2e.fresh_page()

    # ---------- UK00 模块自检 ----------
    r0 = e2e.run("""
        const uk = await import(B+'uiKeys.js');
        return { ok: typeof uk.initUIKeys === 'function' && typeof uk.uiKick === 'function' };
    """)
    checks.append(("UK00 uiKeys 模块自检", bool(r0 and r0.get("ok")), str(r0)))

    # 公共小助手：带 key 的键盘事件（引擎按 e.key 分发）。
    # kd 派发到 document（模拟「焦点在非输入元素/面板」的真实按键）；
    # kdat 派发到元素本身（模拟「焦点在输入框里打字」——真实按键的 target 就是聚焦元素）
    HELPERS = """
        const kd=(code,key)=>document.dispatchEvent(new KeyboardEvent('keydown',{code,key:key||code,bubbles:true}));
        const ku=(code,key)=>document.dispatchEvent(new KeyboardEvent('keyup',{code,key:key||code,bubbles:true}));
        const kdat=(el,code,key)=>el.dispatchEvent(new KeyboardEvent('keydown',{code,key:key||code,bubbles:true}));
        const ae=()=>document.activeElement;
        const downUntil=(pred,max=15)=>{for(let i=0;i<max;i++){if(pred())return i;kd('ArrowDown','ArrowDown');}return pred()?max:-1;};
    """

    # ---------- UK01 背包（创造）：方向键移焦 + Enter 选中收起 ----------
    r1 = e2e.run(HELPERS + """
        S.gameMode = cfg.GameModes.CREATIVE;
        S.player.selectedSlot = 0;
        ui.openItemPicker();
        await sleep(120); // 落焦 defer 一跳
        const first = ae();
        const focusFirstSlot = first && first.classList.contains('inv-slot');
        kd('ArrowRight', 'ArrowRight');
        const movedOnce = ae() !== first && ae().classList.contains('inv-slot');
        kd('ArrowRight', 'ArrowRight');
        kd('ArrowLeft', 'ArrowLeft');
        const movedBack = ae() !== first && ae().classList.contains('inv-slot');
        // 记下当前聚焦格的 hotbar 下标，Enter 应选中它并收起面板
        const slots = [...document.querySelectorAll('#inventory-grid .inv-slot')];
        const idx = slots.indexOf(ae());
        kd('Enter', 'Enter');
        await sleep(80);
        return {
            focusFirstSlot, movedOnce, movedBack,
            idx: idx >= 0,
            closed: um.getUIState() === 'playing',
            selected: S.player.selectedSlot === idx,
        };
    """)
    ok1 = bool(r1) and all(r1.get(k) for k in ("focusFirstSlot", "movedOnce", "movedBack", "idx", "closed", "selected"))
    checks.append(("UK01 背包方向键移焦·Enter 选中收起", ok1, str(r1)))

    # ---------- UK02 背包搜索框：↑↓ 退打字 / Esc 只退打字 ----------
    r2 = e2e.run(HELPERS + """
        ui.openItemPicker(); // 创造模式
        await sleep(120);
        const search = document.getElementById('inv-search');
        search.focus();
        const inSearch = ae() === search;
        kdat(search, 'ArrowDown', 'ArrowDown'); // 上下键 = 退出打字回到导航（target=输入框，同真实按键）
        const outOfSearch = ae() !== search && ae().classList.contains('inv-slot');
        search.focus();
        kdat(search, 'Escape', 'Escape'); // 第一次 Esc：只退出打字，面板不关
        const blurOnly = ae() !== search && um.getUIState() === 'inventory';
        kd('Escape', 'Escape'); // 第二次 Esc（焦点已不在输入框）：才关面板（input.js）
        await sleep(60);
        return { inSearch, outOfSearch, blurOnly, closedNow: um.getUIState() === 'playing' };
    """)
    ok2 = bool(r2) and all(r2.get(k) for k in ("inSearch", "outOfSearch", "blurOnly", "closedNow"))
    checks.append(("UK02 搜索框↑↓/Esc 语义", ok2, str(r2)))

    # ---------- UK03 背包（生存）：Enter 合成 + 焦点回补 ----------
    r3 = e2e.run(HELPERS + """
        platform(60, 60, 6, 6, 40);
        aimPlayer(62, 40, 62, 0, 0); // 站到无工作台的石板平台上，配方走「徒手」
        S.gameMode = cfg.GameModes.SURVIVAL;
        S.player.inventory = { [BT.WOOD]: 4 };
        ui.openItemPicker();
        await sleep(150);
        const first = ae();
        const focusFirstRecipe = !!first && first.classList.contains('recipe-row');
        // 首条徒手配方 = 木板（RECIPES 首条，确定性）：Enter 合成 → 数量变化 + 焦点回到同一行位
        const rec = cfg.RECIPES.filter(r => !r.station)[0];
        const woodBefore = S.player.inventory[BT.WOOD] || 0;
        const outBefore = S.player.inventory[rec.out] || 0;
        kd('Enter', 'Enter');
        await sleep(80);
        const outAfter = S.player.inventory[rec.out] || 0;
        const woodAfter = S.player.inventory[BT.WOOD] || 0;
        const refocus = !!ae() && ae().classList.contains('recipe-row');
        kd('ArrowDown', 'ArrowDown'); // 回补后方向键继续可用
        const navStill = ae() !== document.body;
        um.setState('playing');
        return {
            focusFirstRecipe, isPlankRecipe: rec.id === 'planks',
            crafted: outAfter === outBefore + (rec.outCount || 1) && woodAfter === woodBefore - (rec.cost[BT.WOOD] || 0),
            refocus, navStill,
        };
    """)
    ok3 = bool(r3) and all(r3.get(k) for k in ("focusFirstRecipe", "isPlankRecipe", "crafted", "refocus", "navStill"))
    checks.append(("UK03 配方 Enter 合成·焦点回补", ok3, str(r3)))

    # ---------- UK04 暂停菜单：落焦回到游戏 → ↓ 到设置 → Enter 进设置 ----------
    r4 = e2e.run(HELPERS + """
        um.setState('pause');
        await sleep(120);
        const focusContinue = ae() && ae().id === 'btn-continue';
        const steps = downUntil(() => ae() && ae().id === 'btn-settings');
        kd('Enter', 'Enter');
        await sleep(120);
        const inSettings = um.getUIState() === 'settings';
        const focusTab = !!ae() && ae().classList.contains('gs-tab');
        kd('Escape', 'Escape');
        await sleep(80);
        return { focusContinue, foundSettings: steps >= 0, inSettings, focusTab, backPause: um.getUIState() === 'pause' };
    """)
    ok4 = bool(r4) and all(r4.get(k) for k in ("focusContinue", "foundSettings", "inSettings", "focusTab", "backPause"))
    checks.append(("UK04 暂停菜单键盘链路", ok4, str(r4)))

    # ---------- UK05 设置滑块：聚焦 range 方向键不动焦 ----------
    r5 = e2e.run(HELPERS + """
        um.setState('settings');
        await sleep(120);
        const slider = document.getElementById('gs-vol-bgm');
        slider.focus();
        const val0 = slider.value;
        kdat(slider, 'ArrowRight', 'ArrowRight'); // target=滑块（同真实按键）：原生接管，导航不得移动焦点
        const stay = ae() === slider;
        kdat(slider, 'ArrowDown', 'ArrowDown');
        const stillStay = ae() === slider;
        const v = parseFloat(slider.value);
        um.setState('pause');
        return { stay, stillStay, nativeInRange: v >= parseFloat(val0) };
    """)
    ok5 = bool(r5) and all(r5.get(k) for k in ("stay", "stillStay", "nativeInRange"))
    checks.append(("UK05 滑块方向键不越权", ok5, str(r5)))

    # ---------- UK06 首屏 → 关卡列表 ----------
    r6 = e2e.run(HELPERS + """
        um.setState('title');
        await sleep(150); // refreshMenuTexts 重渲染槽位列表
        const focusRow = !!ae() && ae().classList.contains('slot-row');
        // 菜单是纵向分区 + 横向按钮行：↓ 走分区、→ 走行内按钮，交替推进到「🗺 关卡」
        let found = false;
        for (let i = 0; i < 20 && !found; i++) {
            kd('ArrowDown', 'ArrowDown');
            if (ae() && ae().id === 'btn-levels') { found = true; break; }
            for (let j = 0; j < 4 && !found; j++) {
                kd('ArrowRight', 'ArrowRight');
                if (ae() && ae().id === 'btn-levels') found = true;
            }
        }
        kd('Enter', 'Enter');
        await sleep(900); // 列表行异步渲染 + 落焦
        const listOpen = !document.getElementById('level-list').classList.contains('hidden');
        const inList = !!ae() && !!ae().closest('#level-list');
        kd('Escape', 'Escape');
        await sleep(80);
        return { focusRow, found, listOpen, inList, listClosed: document.getElementById('level-list').classList.contains('hidden') };
    """)
    ok6 = bool(r6) and all(r6.get(k) for k in ("focusRow", "found", "listOpen", "inList", "listClosed"))
    checks.append(("UK06 首屏→关卡列表键盘链路", ok6, str(r6)))

    # ---------- UK07 死亡界面：Enter 重生 ----------
    r7 = e2e.run(HELPERS + """
        um.setState('playing');
        await sleep(50);
        document.getElementById('death-screen').classList.add('visible');
        um.setState('dead');
        await sleep(120);
        const focusRespawn = ae() && ae().id === 'respawn-btn';
        kd('Enter', 'Enter');
        await sleep(120);
        return {
            focusRespawn,
            alive: um.getUIState() === 'playing' && !S.player.dead,
            screenGone: !document.getElementById('death-screen').classList.contains('visible'),
        };
    """)
    ok7 = bool(r7) and all(r7.get(k) for k in ("focusRespawn", "alive", "screenGone"))
    checks.append(("UK07 死亡界面 Enter 重生", ok7, str(r7)))

    # ---------- UK08 结算面板：落焦重试 + 方向键移动 ----------
    r8 = e2e.run(HELPERS + """
        S.levelResult = { name: '测试关', author: '我', stars: 2, timeSec: 42, deaths: 1, locks: [], timeout: false };
        um.setState('result');
        await sleep(150);
        const focusRetry = ae() && ae().id === 'btn-result-retry';
        const a = ae();
        kd('ArrowRight', 'ArrowRight');
        const moved = ae() !== a && !!ae().closest('#result-panel');
        kd('ArrowLeft', 'ArrowLeft');
        const back = ae() === a;
        S.levelResult = null;
        um.setState('playing');
        return { focusRetry, moved, back };
    """)
    ok8 = bool(r8) and all(r8.get(k) for k in ("focusRetry", "moved", "back"))
    checks.append(("UK08 结算面板键盘导航", ok8, str(r8)))

    # ---------- UK09 组件库：Enter 选组件进放置态 ----------
    r9 = e2e.run(HELPERS + """
        const le = await import(B+'levelEditor.js');
        um.setState('playing');
        await sleep(50);
        S.gameMode = cfg.GameModes.CREATIVE;
        ui.openPrefabPicker();
        await sleep(120);
        const focusFirst = !!ae() && ae().classList.contains('prefab-item');
        kd('ArrowRight', 'ArrowRight');
        const moved = ae() !== null && ae().classList.contains('prefab-item');
        kd('Enter', 'Enter'); // 点选组件 = 关浮层 + 进入放置态
        await sleep(80);
        const placing = !!le.getPlacing();
        const pickerClosed = !ui.isPrefabPickerOpen(); // isPrefabPickerOpen 在 ui.js（非 uiModal）
        le.cancelPlacing();
        return { focusFirst, moved, placing, pickerClosed };
    """)
    ok9 = bool(r9) and all(r9.get(k) for k in ("focusFirst", "moved", "placing", "pickerClosed"))
    checks.append(("UK09 组件库 Enter 进放置态", ok9, str(r9)))

    # ---------- UK10 拍摄面板：Tab 开 → 方向键移动 → Tab 关 ----------
    r10 = e2e.run(HELPERS + """
        um.setState('playing');
        await sleep(80);
        kd('Tab', 'Tab'); // input.js：开拍摄面板（emit 同态事件 → uiKick 落焦）
        await sleep(150);
        const opened = S.recordingControlsOpen === true;
        const focusRec = !!ae() && !!ae().closest('#recording-panel');
        kd('ArrowRight', 'ArrowRight');
        const moved = !!ae() && !!ae().closest('#recording-panel,#build-widget');
        kd('Tab', 'Tab');
        await sleep(80);
        return { opened, focusRec, moved, closed: S.recordingControlsOpen === false };
    """)
    ok10 = bool(r10) and all(r10.get(k) for k in ("opened", "focusRec", "moved", "closed"))
    checks.append(("UK10 拍摄面板 Tab/方向键", ok10, str(r10)))

    # ---------- UK11 回归：playing 无浮层方向键零越权 ----------
    r11 = e2e.run(HELPERS + """
        const sgu = await import(B+'settingsUI.js');
        const ip = await import(B+'input.js');
        sgu.setInputMode('keyboard'); // 键盘模式下方向键转视角；无浮层时导航不得插手
        um.setState('playing');
        await sleep(100);
        kd('ArrowRight', 'ArrowRight');
        const recorded = ip.keys['ArrowRight'] === true; // 事件直达 input.js（未被引擎消费）
        const noFocusStyle = !document.querySelector('.uik-focus');
        ku('ArrowRight', 'ArrowRight');
        sgu.setInputMode('mouse');
        localStorage.removeItem('mcweb.inputMode'); // 清残留，别污染同 origin 的其他测试
        return { recorded, noFocusStyle };
    """)
    ok11 = bool(r11) and all(r11.get(k) for k in ("recorded", "noFocusStyle"))
    checks.append(("UK11 playing 无浮层导航零越权", ok11, str(r11)))

    res = {"cases": len(checks)}

finally:
    e2e.close()

passed = report(name, res, checks)
print("\n%s: %d/%d 用例通过" % (name, sum(1 for c in checks if c[1]), len(checks)))
raise SystemExit(0 if passed else 1)
