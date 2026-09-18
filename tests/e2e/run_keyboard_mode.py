# -*- coding: utf-8 -*-
"""纯键盘输入模式验收（2026-09-17）：鼠标不锁定、指针可见，游戏操作全走键盘。

前置：js/input.js 的键盘触发点与鼠标 mousedown 同源（primary/secondary 共享函数），
     js/main.js 的视角键盘分支与挖掘/放置门 gameplayActive = isPlaying() || isKeyboardPlayActive()。
用例（合成 KeyboardEvent/MouseEvent 派发 document/canvas，走真实监听器接线）：
  KB01 设置卡片切换输入方式（⚙️「🎛 画面」页 → #gs-input-grid，点选即生效+记忆）
  KB02 键盘模式不请求指针锁定：进 playing 后 mouseLocked 恒 false、准星可见、点画布不抢锁
  KB03 方向键转视角（rAF 自跑时：ArrowRight yaw 减、ArrowUp pitch 增、keyup 即停）
  KB04 Enter = 左键挖掘（创造即挖：miningPress 真实链路破坏方块 + mouseDown.left 按住态）
  KB05 Enter 生存蓄力（登记 mining 目标 → 蓄力进度 → 破坏）
  KB06 KeyX = 右键放置（secondaryAction → placeBlock 真实链路，面外格出现方块）
  KB07 KeyI = 中键吸取（创造：selectedSlot 跳到准星方块的 hotbar 槽）
  KB08 Esc/Q 弹暂停（键盘模式未锁定，Esc 能到达页面）+ E 背包不受影响
  KB09 闯关守卫继承：levelRun 态 Enter 挖掘 / KeyX 放置 / KeyI 吸取全被拦
  KB10 切回鼠标模式：键盘触发点停用（Enter/X 不再置 mouseDown）

跑法：server.py + chrome_login.py --launch --ephemeral --port 19401 后
     cd tests/e2e && CDP_PORT=19401 python3 run_keyboard_mode.py
"""

from lib import E2E, report

name = "run_keyboard_mode"
e2e = E2E()
checks = []
res = None
try:
    e2e.fresh_page()

    # 模块可用性自检（PREAMBLE 未含 input/mining/settingsUI，各用例体内动态 import）
    r0 = e2e.run("""
        const [ip, mn, sgu] = await Promise.all([
            import(B+'input.js'), import(B+'mining.js'), import(B+'settingsUI.js')]);
        return { ok: !!(ip.keys && ip.mouseDown && mn.getMiningState && sgu.getInputMode) };
    """)
    checks.append(("KB00 模块自检", bool(r0 and r0.get("ok")), str(r0)))

    # ---------- KB01 设置卡片切换输入方式 ----------
    r1 = e2e.run("""
        const sgu = await import(B+'settingsUI.js');
        um.setState('pause');
        sgu.openGameSettings();
        await sleep(150);
        const grid = document.querySelector('#gs-input-grid');
        const cards = grid ? grid.querySelectorAll('.bgm-style-card') : [];
        const kbCard = grid ? grid.querySelector('[data-mode="keyboard"]') : null;
        kbCard.click();
        await sleep(100);
        const r = {
            hasGrid: !!grid,
            cardCount: cards.length,
            switched: S.inputMode === 'keyboard',
            persisted: localStorage.getItem('mcweb.inputMode') === 'keyboard',
            activeMarked: kbCard.classList.contains('active'),
            getter: sgu.getInputMode() === 'keyboard',
        };
        document.querySelector('#game-settings .gs-close').click();
        await sleep(80);
        return { ...r, closed: um.getUIState() === 'pause' };
    """)
    ok1 = bool(r1) and all(r1.get(k) for k in
                           ("hasGrid", "switched", "persisted", "activeMarked", "getter", "closed")) \
        and r1.get("cardCount") == 2
    checks.append(("KB01 设置卡片切换输入方式", ok1, str(r1)))

    # ---------- KB02 不请求指针锁定 + 点画布不抢锁 ----------
    r2 = e2e.run("""
        const ip = await import(B+'input.js');
        um.setState('playing');
        await sleep(500); // 给 applyPointerPolicy 时间：键盘模式绝不发 requestPointerLock
        const lockBefore = um.mouseLocked;
        const pleBefore = document.pointerLockElement;
        // 鼠标点画布（mousedown 左键 + click）与 document click 兜底：都不该抢锁/触发游戏操作
        eng.canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(300);
        const cross = document.getElementById('crosshair');
        return {
            neverLocked: !lockBefore && !um.mouseLocked,
            noLockElement: !pleBefore && !document.pointerLockElement,
            noLockHint: document.getElementById('lock-hint').classList.contains('hidden'),
            clickNoOp: !ip.mouseDown.left,
            crosshairVisible: cross && cross.style.display !== 'none',
            uiStillPlaying: um.getUIState() === 'playing',
        };
    """)
    ok2 = bool(r2) and all(r2.get(k) for k in
                           ("neverLocked", "noLockElement", "noLockHint", "clickNoOp", "crosshairVisible", "uiStillPlaying"))
    checks.append(("KB02 不请求锁定·点画布不抢锁·准星可见", ok2, str(r2)))

    # ---------- KB03 方向键转视角（需要 rAF 自跑） ----------
    r3 = e2e.run("""
        const ip = await import(B+'input.js');
        const kd = (c) => document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        const ku = (c) => document.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
        const alive = await rafAlive();
        if (!alive) return { skipped: true };
        const y0 = S.player.yaw, p0 = S.player.pitch;
        kd('ArrowRight');
        await sleep(700);
        const yTurned = S.player.yaw;
        ku('ArrowRight');
        await sleep(250);
        const yStop = S.player.yaw;
        kd('ArrowUp');
        await sleep(500);
        const pTurned = S.player.pitch;
        ku('ArrowUp');
        return {
            skipped: false,
            yawDecreased: yTurned < y0 - 0.15,            // ArrowRight = 右转（yaw 减，与鼠标右移一致）
            yawStopped: Math.abs(yStop - yTurned) < 0.05,  // keyup 后静止
            pitchIncreased: pTurned > p0 + 0.1,            // ArrowUp = 抬头（pitch 增）
            keysReleased: !ip.keys['ArrowRight'] && !ip.keys['ArrowUp'],
        };
    """)
    if r3 and r3.get("skipped"):
        checks.append(("KB03 方向键转视角", True, "SKIP（rAF 被节流，gameLoop 停摆——前台跑可复验）"))
    else:
        ok3 = bool(r3) and all(r3.get(k) for k in ("yawDecreased", "yawStopped", "pitchIncreased", "keysReleased"))
        checks.append(("KB03 方向键转视角", ok3, str(r3)))

    # ---------- KB04 Enter = 左键挖掘（创造即挖，真实链路） ----------
    r4 = e2e.run("""
        const ip = await import(B+'input.js');
        const mn = await import(B+'mining.js');
        const kd = (c) => document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        const ku = (c) => document.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
        platform(70, 70, 6, 6, 40);
        S.gameMode = cfg.GameModes.CREATIVE;
        const tgt = { x: 72, y: 39, z: 72 }; // 平台石板格
        const aim = aimScan(tgt.x, tgt.y, tgt.z, 72, 40, 74);
        if (!aim) return { aimed: false };
        const before = gb(tgt.x, tgt.y, tgt.z);
        kd('Enter');
        const pressed = ip.mouseDown.left === true;
        const after = gb(tgt.x, tgt.y, tgt.z);
        const ms = mn.getMiningState();
        ku('Enter');
        return {
            aimed: true,
            hadBlock: before !== BT.AIR,
            pressed,
            broken: after === BT.AIR,   // 创造即挖：miningPress 同步破坏
            cooldown: ms.delay > 0,      // 连拆限速已挂上（真实 miningPress 路径）
            released: ip.mouseDown.left === false,
        };
    """)
    ok4 = bool(r4) and all(r4.get(k) for k in ("aimed", "hadBlock", "pressed", "broken", "cooldown", "released"))
    checks.append(("KB04 Enter 挖掘·创造即挖链路", ok4, str(r4)))

    # ---------- KB05 Enter 生存蓄力 ----------
    r5 = e2e.run("""
        const ip = await import(B+'input.js');
        const mn = await import(B+'mining.js');
        const kd = (c) => document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        const ku = (c) => document.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
        platform(80, 80, 6, 6, 40);
        // 徒手可快速挖的目标：泥土（0.75s 蓄力；石头要镐=7.5s 超出泵窗口）
        sb(82, 39, 82, BT.DIRT);
        S.gameMode = cfg.GameModes.SURVIVAL;
        const tgt = { x: 82, y: 39, z: 82 };
        const aim = aimScan(tgt.x, tgt.y, tgt.z, 82, 40, 84);
        if (!aim) return { aimed: false };
        const before = gb(tgt.x, tgt.y, tgt.z);
        mn.updateMining(5, false); // 清上一用例残留的连挖冷却（rAF 停摆时 delay 不自衰减）
        kd('Enter');
        const ms0 = mn.getMiningState();
        const registered = ms0.x === tgt.x && ms0.y === tgt.y && ms0.z === tgt.z;
        // 蓄力推进：rAF 活则 gameLoop 自己挖（顺带验证 main.js 的 gameplayActive 门），
        // 停则手动泵 updateMining（模拟 main.js 的每帧调用，holding 直读 mouseDown.left）
        let broken = false, progressSaw = false;
        const alive = await rafAlive();
        for (let i = 0; i < 80 && !broken; i++) {
            if (!alive) mn.updateMining(0.05, ip.mouseDown.left);
            await sleep(60);
            const ms = mn.getMiningState();
            if (ms.progress > 0) progressSaw = true;
            if (gb(tgt.x, tgt.y, tgt.z) === BT.AIR) broken = true;
        }
        ku('Enter');
        return { aimed: true, hadBlock: before !== BT.AIR, registered, progressSaw, broken };
    """)
    ok5 = bool(r5) and all(r5.get(k) for k in ("aimed", "hadBlock", "registered", "progressSaw", "broken"))
    checks.append(("KB05 Enter 生存蓄力挖掘", ok5, str(r5)))

    # ---------- KB06 KeyX = 右键放置 ----------
    r6 = e2e.run("""
        const ip = await import(B+'input.js');
        const kd = (c) => document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        const ku = (c) => document.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
        S.gameMode = cfg.GameModes.CREATIVE;
        S.player.selectedSlot = HB.indexOf(BT.STONE);
        ui.updateHotbar();
        platform(90, 90, 6, 6, 40);
        // 站平台中心瞄角落石板格：放置目标 = 命中面外一格（hit + face 法线）
        const aim = aimScan(90, 39, 90, 92, 40, 92);
        if (!aim) return { aimed: false };
        const px = aim.hit.x + aim.hit.face.dx, py = aim.hit.y + aim.hit.face.dy, pz = aim.hit.z + aim.hit.face.dz;
        const before = gb(px, py, pz);
        kd('KeyX');
        const pressed = ip.mouseDown.right === true;
        const after = gb(px, py, pz);
        ku('KeyX');
        return {
            aimed: true,
            wasAir: before === BT.AIR,
            pressed,
            placed: after !== BT.AIR,   // secondaryAction → placeBlock 真实链路
            released: ip.mouseDown.right === false,
        };
    """)
    ok6 = bool(r6) and all(r6.get(k) for k in ("aimed", "wasAir", "pressed", "placed", "released"))
    checks.append(("KB06 KeyX 放置链路", ok6, str(r6)))

    # ---------- KB07 KeyI = 中键吸取（创造） ----------
    r7 = e2e.run("""
        const kd = (c) => document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        platform(100, 100, 6, 6, 40);
        const tgt = { x: 102, y: 39, z: 102 };
        const aim = aimScan(tgt.x, tgt.y, tgt.z, 102, 40, 104);
        if (!aim) return { aimed: false };
        S.player.selectedSlot = 0; // 先选非目标槽（槽 0 = 草方块，目标格是石板）
        ui.updateHotbar();
        const before = gb(tgt.x, tgt.y, tgt.z);
        kd('KeyI');
        const after = gb(tgt.x, tgt.y, tgt.z);
        return {
            aimed: true,
            stone: before === BT.STONE,
            slotJumped: S.player.selectedSlot === HB.indexOf(BT.STONE),
            blockIntact: after === BT.STONE, // 吸取不破坏
        };
    """)
    ok7 = bool(r7) and all(r7.get(k) for k in ("aimed", "stone", "slotJumped", "blockIntact"))
    checks.append(("KB07 KeyI 吸取方块", ok7, str(r7)))

    # ---------- KB08 Esc/Q 弹暂停 + E 背包 ----------
    r8 = e2e.run("""
        const kd = (c) => document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        um.setState('playing');
        await sleep(100);
        kd('Escape');
        await sleep(100);
        const escPause = um.getUIState() === 'pause';
        um.setState('playing');
        await sleep(100);
        kd('KeyQ');
        await sleep(100);
        const qPause = um.getUIState() === 'pause';
        um.setState('playing');
        await sleep(100);
        kd('KeyE'); // E 背包照常（键盘模式不受影响）
        await sleep(100);
        const invOpen = um.getUIState() === 'inventory';
        um.setState('playing');
        return { escPause, qPause, invOpen, back: um.getUIState() === 'playing' };
    """)
    ok8 = bool(r8) and all(r8.get(k) for k in ("escPause", "qPause", "invOpen", "back"))
    checks.append(("KB08 Esc/Q 弹暂停·E 背包照常", ok8, str(r8)))

    # ---------- KB09 闯关守卫继承 ----------
    r9 = e2e.run("""
        const kd = (c) => document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        const ku = (c) => document.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
        platform(110, 110, 6, 6, 40);
        S.gameMode = cfg.GameModes.CREATIVE;
        S.player.selectedSlot = HB.indexOf(BT.STONE);
        ui.updateHotbar();
        const tgt = { x: 112, y: 39, z: 112 };
        const aim = aimScan(tgt.x, tgt.y, tgt.z, 112, 40, 114);
        if (!aim) return { aimed: false };
        // finished:true = isLevelRunActive 守卫激活 + tickLevelRun 安全跳过（测试钩子，非真实进关）
        S.levelRun = { finished: true };
        try {
            kd('Enter');
            await sleep(100);
            const mineBlocked = gb(tgt.x, tgt.y, tgt.z) !== BT.AIR;
            kd('KeyX');
            await sleep(100);
            let placedAny = false; // 放置被拦：平台上方整层不得出现新方块
            for (let x = 110; x < 116; x++) for (let z = 110; z < 116; z++) {
                if (gb(x, 40, z) !== BT.AIR) placedAny = true;
            }
            const slotBefore = S.player.selectedSlot;
            kd('KeyI');
            await sleep(100);
            const pickBlocked = S.player.selectedSlot === slotBefore;
            ku('Enter'); ku('KeyX');
            return { aimed: true, mineBlocked, placeBlocked: !placedAny, pickBlocked };
        } finally {
            S.levelRun = null;
        }
    """)
    ok9 = bool(r9) and all(r9.get(k) for k in ("aimed", "mineBlocked", "placeBlocked", "pickBlocked"))
    checks.append(("KB09 闯关守卫继承（Enter/X/I 全被拦）", ok9, str(r9)))

    # ---------- KB10 切回鼠标模式：键盘触发点停用 ----------
    r10 = e2e.run("""
        const ip = await import(B+'input.js');
        const sgu = await import(B+'settingsUI.js');
        const kd = (c) => document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        sgu.setInputMode('mouse');
        localStorage.removeItem('mcweb.inputMode'); // 清残留，别污染同 origin 的其他测试
        const modeOff = !um.isKeyboardPlayActive() && S.inputMode === 'mouse';
        kd('Enter');
        const enterDead = ip.mouseDown.left === false;  // 键盘路径停用：不再置位
        kd('KeyX');
        const xDead = ip.mouseDown.right === false;
        return { modeOff, enterDead, xDead };
    """)
    ok10 = bool(r10) and all(r10.get(k) for k in ("modeOff", "enterDead", "xDead"))
    checks.append(("KB10 切回鼠标模式键盘停用", ok10, str(r10)))

    res = {"cases": len(checks)}

finally:
    e2e.close()

passed = report(name, res, checks)
print("\n%s: %d/%d 用例通过" % (name, sum(1 for c in checks if c[1]), len(checks)))
raise SystemExit(0 if passed else 1)
