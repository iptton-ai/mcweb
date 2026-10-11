// Ego 浏览器回归：隔离 server.py origin，真实 Three.js/DOM/IndexedDB 与键盘事件。
// 调用：ego-browser nodejs -e 'const m=await import("file:///…/gameplay_remediation_ego.mjs"); await m.run(taskSpace, 9);'
// 参数为当前任务的既有 TaskSpace；不创建额外浏览器或修改其他 origin 的用户存档。
export async function run(taskSpace, spaceId) {
    const task = await taskSpace(spaceId);
    const page = task.page('p1');
    const results = [];
    results.push(await page.evaluate(async () => {
        const [{ state }, cfg, world, physics, interaction, entities, engine, modal, settings, saves, snapshots, tnt] = await Promise.all([
            import('/js/state.js'), import('/js/config.js'), import('/js/world.js'), import('/js/playerPhysics.js'),
            import('/js/interaction.js'), import('/js/entities.js'), import('/js/engine.js'), import('/js/uiModal.js'),
            import('/js/settingsUI.js'), import('/js/saveGame.js'), import('/js/assistant/snapshot.js'), import('/js/tnt.js'),
        ]);
        const ok = (condition, message) => { if (!condition) throw new Error(message); };
        settings.setInputMode('keyboard'); modal.setState('pause');
        state.camMode = 'free'; state.levelRun = null; state.levelEdit = null;
        const setB = world.setBlockSafe;
        const clearArea = () => {
            entities.clearAllEnemies(); tnt.clearTntEntities();
            for (let y = 9; y < 45; y++) for (let z = 35; z < 49; z++) for (let x = 35; x < 49; x++) setB(x, y, z, cfg.BlockTypes.AIR);
            Object.assign(state.player, { x: 40.5, y: 20, z: 40.5, vx: 0, vy: 0, vz: 0,
                onGround: false, flying: false, dead: false, health: 20, invulnTimer: 0, fallStartY: null,
                yaw: 0, pitch: 0, attackCooldown: 0, inventory: {}, toolWear: {}, selectedSlot: 0 });
            state.gameMode = cfg.GameModes.SURVIVAL; state.viewMode = 0;
        };
        clearArea();
        Object.assign(state.player, { x: 40.8, vy: -40, fallStartY: 20 });
        setB(41, 18, 40, cfg.BlockTypes.STONE); setB(40, 16, 40, cfg.BlockTypes.STONE);
        physics.updatePlayerPhysics(0.1);
        ok(state.player.y === 19.001 && state.player.onGround, '浏览器高速落地应先碰近处薄平台');
        clearArea(); Object.assign(state.player, { x: 40.6, y: 10.4, vx: 8 });
        setB(41, 12, 40, cfg.BlockTypes.STONE); physics.updatePlayerPhysics(0.05);
        ok(state.player.vx === 0 && state.player.x < 40.7, '浏览器部分头部墙碰撞');
        clearArea(); Object.assign(state.player, { x: 40.5, y: 19, z: 41.5 });
        state.viewMode = 1; engine.camera.position.set(40.5, 20.62, 46); engine.camera.quaternion.set(0, 0, 0, 1);
        entities.spawnEnemy(40.5, 19, 43.5); entities.spawnEnemy(40.5, 19, 39.5);
        const [rear, front] = state.enemies, rearHp = rear.hp, frontHp = front.hp;
        ok(interaction.tryAttackEnemy(), '浏览器第三人称应命中前方');
        ok(rear.hp === rearHp && front.hp < frontHp, '浏览器第三人称不能抢身后目标');
        front.z = 39.5; state.player.attackCooldown = 0; const hp = front.hp;
        setB(40, 20, 40, cfg.BlockTypes.STONE);
        ok(!interaction.tryAttackEnemy() && front.hp === hp, '浏览器第三人称墙遮挡');
        clearArea(); setB(45, 30, 45, cfg.BlockTypes.TNT);
        tnt.spawnTntEntity(45, 30, 45); tnt.spawnTntEntity(45, 30, 45);
        ok(state.tntEntities.length === 1, '浏览器TNT引信去重');
        setB(45, 30, 45, cfg.BlockTypes.STONE); tnt.updateTnt(3);
        ok(state.tntEntities.length === 0 && world.getBlock(45, 30, 45) === cfg.BlockTypes.STONE, '浏览器替换TNT取消引信');
        setB(45, 30, 45, cfg.BlockTypes.TNT); tnt.spawnTntEntity(45, 30, 45); tnt.updateTnt(3);
        ok(world.getBlock(45, 30, 45) === cfg.BlockTypes.AIR, '浏览器孤立TNT爆炸');
        // 真存档入口，损坏导入不可覆盖原槽位。
        ok(saves.saveGame(), '浏览器存档落盘');
        const original = saves.exportSlotJson(state.saveSlot);
        const index = localStorage.getItem('mcweb.save.index');
        ok(typeof saves.importSlotJson(JSON.stringify({ version: 4, player: {}, dims: [256, 128, 256], enc: 'rle', blocks: 'AA==' })) === 'string', '浏览器拒损坏导入');
        ok(saves.exportSlotJson(state.saveSlot) === original && localStorage.getItem('mcweb.save.index') === index, '浏览器坏导入保留槽位索引');
        Object.assign(state.player, { hunger: 6, air: 3, xp: 19, toolWear: { 190: 28 }, inventory: { 190: 1 } });
        state.worldSeed = 123456;
        ok(snapshots.saveSnapshotForReload(), '浏览器快照保存');
        state.worldSeed = 999; state.player.toolWear = {}; state.player.xp = 0;
        ok(snapshots.restoreSnapshotIfAny(), '浏览器快照恢复');
        ok(state.worldSeed === 123456 && state.player.xp === 19 && state.player.toolWear[190] === 28, '浏览器快照种子经验耐久');
        clearArea();
        // 下一个场景由真实 rAF 下落，平台上方足够净空。
        for (let x = 38; x <= 43; x++) for (let z = 38; z <= 44; z++) setB(x, 18, z, cfg.BlockTypes.STONE);
        Object.assign(state.player, { y: 20, vy: -40, fallStartY: 20, x: 40.5, z: 41.5 });
        state.camMode = 'player'; state.viewMode = 0; modal.setState('playing');
        return { native: 'PASS', cases: 9 };
    }));
    await page.waitForFunction(async () => {
        const { state } = await import('/js/state.js');
        return state.player.onGround && Math.abs(state.player.y - 19.001) < 0.01;
    }, undefined, { timeout: 5000 });
    results.push({ rafFall: 'PASS' });
    await page.evaluate(async () => {
        const [{ state }, { setBlockSafe }, { BlockTypes }, { rebuildChunk }] = await Promise.all([
            import('/js/state.js'), import('/js/world.js'), import('/js/config.js'), import('/js/chunk.js'),
        ]);
        setBlockSafe(40, 19, 39, BlockTypes.STONE); setBlockSafe(40, 20, 39, BlockTypes.STONE);
        rebuildChunk(2, 2);
        state.player.z = 41.5;
    });
    await page.keyboard.down('w');
    try {
        await page.waitForFunction(async () => (await import('/js/state.js')).state.player.z < 40.5, undefined, { timeout: 5000 });
    } finally { await page.keyboard.up('w'); }
    const wall = await page.evaluate(async () => {
        const { state } = await import('/js/state.js');
        if (state.player.z < 40.3) throw new Error('真实W键移动穿墙');
        return { keyboardWall: 'PASS', z: state.player.z };
    });
    results.push(wall);
    await page.evaluate(async () => {
        const [{ state }, cfg, world, entities] = await Promise.all([
            import('/js/state.js'), import('/js/config.js'), import('/js/world.js'), import('/js/entities.js'),
        ]);
        world.setBlockSafe(40, 19, 39, cfg.BlockTypes.AIR); world.setBlockSafe(40, 20, 39, cfg.BlockTypes.AIR);
        entities.clearAllEnemies();
        Object.assign(state.player, { z: 41.5, yaw: 0, pitch: 0, attackCooldown: 0, selectedSlot: cfg.HotbarBlocks.indexOf(cfg.ToolTypes.SWORD), inventory: { [cfg.ToolTypes.SWORD]: 1 } });
        state.viewMode = 1;
        entities.spawnEnemy(40.5, 19, 43.5); entities.spawnEnemy(40.5, 19, 39.5);
        for (const e of state.enemies) { e.hostile = false; e.moving = false; e.moveTimer = 1e6; }
        globalThis.__remediationHp = state.enemies.map(e => e.hp);
    });
    await page.keyboard.press('Enter');
    results.push(await page.evaluate(async () => {
        const { state } = await import('/js/state.js');
        const [rear, front] = state.enemies, [rearHp, frontHp] = globalThis.__remediationHp;
        if (!rear || !front || rear.hp !== rearHp || front.hp >= frontHp) throw new Error('真实Enter第三人称选敌错误');
        return { keyboardAttack: 'PASS', rearHp: rear.hp, frontHp: front.hp };
    }));
    await page.evaluate(async () => {
        const [{ state }, entities, cfg] = await Promise.all([import('/js/state.js'), import('/js/entities.js'), import('/js/config.js')]);
        entities.clearAllEnemies(); state.gameMode = cfg.GameModes.CREATIVE;
        state.time = state.dayLength / 2; state.viewMode = 0;
    });
    console.log(JSON.stringify(results));
    return results;
}

export async function runLifecycle(taskSpace, spaceId) {
    const task = await taskSpace(spaceId), page = task.page('p1');
    const result = await page.evaluate(async () => {
        const [editor, workshop, keypad, world, cfg, { state }, modal, entities] = await Promise.all([
            import('/js/levelEditor.js'), import('/js/levelWorkshop.js'), import('/js/eduKeypad.js'),
            import('/js/world.js'), import('/js/config.js'), import('/js/state.js'), import('/js/uiModal.js'), import('/js/entities.js'),
        ]);
        const ok = (condition, message) => { if (!condition) throw new Error(message); };
        entities.clearAllEnemies(); state.gameMode = cfg.GameModes.CREATIVE;
        state.player.dead = false; state.player.health = 20; modal.setState('title');
        const oldIds = new Set((await workshop.listLevelCards()).map(r => r.id));
        const originalBlocks = state.blocks;
        ok(await editor.enterLevelEditor(null, { name: '浏览器草稿竞态回归' }), '浏览器编辑入口');
        const ed = state.levelEdit;
        ed.rules = { timeLimit: 90, lockAIHelp: false };
        world.setBlockSafe(84, 6, 84, cfg.FLAG_BASE + cfg.FLAG_START);
        world.setBlockSafe(92, 6, 84, cfg.FLAG_BASE + cfg.FLAG_GOAL);
        world.setBlockSafe(88, 6, 84, cfg.KEYPAD_BASE);
        keypad.seedAuthoredLock(88, 6, 84, { subject: 'math', kind: 'input', stem: '6+7=?', answer: 13, hint: '先凑十', meta: { source: 'custom' } }, 0);
        const first = await editor.saveEditorDraft({ silent: true });
        ok(first?.questions[0]?.meta.verifiedPasses === 0, '浏览器零次双通过保留');
        const formal = await workshop.buildLevelCard({ name: '未通过' });
        ok(!workshop.validateLevelCard(formal).ok, '浏览器正式导出仍拦零次');
        const created = first.created;
        ed.name = '浏览器草稿更新'; world.setBlockSafe(85, 6, 85, cfg.BlockTypes.DIAMOND_ORE);
        const saves = [editor.saveEditorDraft({ silent: true }), editor.saveEditorDraft({ silent: true })];
        const exits = [editor.exitLevelEditor({ saveDraft: false }), editor.exitLevelEditor({ saveDraft: false })];
        await Promise.all([...saves, ...exits]);
        const rows = (await workshop.listLevelCards()).filter(r => !oldIds.has(r.id));
        ok(rows.length === 1, '浏览器真IndexedDB草稿只有一条');
        const final = await workshop.getLevelCard(rows[0].id);
        ok(final.name === '浏览器草稿更新' && final.created === created, '浏览器草稿身份/created保留');
        ok(final.rules.timeLimit === 90 && final.rules.lockAIHelp === false, '浏览器草稿规则保留');
        ok(state.levelEdit === null && state.blocks !== originalBlocks, '浏览器退出已恢复独立世界');
        await workshop.deleteLevelCard(rows[0].id);
        return { lifecycle: 'PASS', cases: 6, indexedDB: !!globalThis.indexedDB };
    });
    console.log(JSON.stringify(result));
    return result;
}

// 准备真实导出 UI；下一轮按 snapshot 中的输入框和保存按钮操作。
export async function prepareExport(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    await page.evaluate(async () => {
        const [editor, workshop, keypad, world, cfg, { state }, modal, life, ui, entities] = await Promise.all([
            import('/js/levelEditor.js'), import('/js/levelWorkshop.js'), import('/js/eduKeypad.js'),
            import('/js/world.js'), import('/js/config.js'), import('/js/state.js'), import('/js/uiModal.js'),
            import('/js/playerLife.js'), import('/js/ui.js'), import('/js/entities.js'),
        ]);
        entities.clearAllEnemies(); life.respawn(); state.gameMode = cfg.GameModes.CREATIVE;
        modal.setState('title');
        globalThis.__remediationOldIds = (await workshop.listLevelCards()).map(r => r.id);
        if (!await editor.enterLevelEditor(null, { name: '浏览器持久备份' })) throw new Error('导出回归无法进入编辑器');
        await state.levelEdit.draftSavePending;
        state.levelEdit.rules = { timeLimit: 90, lockAIHelp: false }; keypad.setExamIntent(true);
        world.setBlockSafe(84, 4, 84, cfg.FLAG_BASE + cfg.FLAG_START);
        world.setBlockSafe(92, 4, 84, cfg.FLAG_BASE + cfg.FLAG_GOAL);
        world.setBlockSafe(88, 4, 84, cfg.KEYPAD_BASE);
        keypad.seedAuthoredLock(88, 4, 84, { subject: 'math', kind: 'input', stem: '6+7=?', answer: 13, hint: '先凑十', meta: { source: 'custom' } }, 2);
        await editor.saveEditorDraft({ silent: true });
        globalThis.__remediationBackupId = state.levelEdit.persistentDraftId;
        ui.openExportPanel();
    });
    console.log(await page.snapshot());
}

export async function runExport(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    await page.fill('#export-name', '浏览器正式规则保真');
    await page.click('#btn-export-save');
    await page.waitForFunction(async () => {
        const rows = await (await import('/js/levelWorkshop.js')).listLevelCards();
        return rows.some(r => r.name === '浏览器正式规则保真');
    }, undefined, { timeout: 10000 });
    const result = await page.evaluate(async () => {
        const [editor, workshop, world, cfg, { state }] = await Promise.all([
            import('/js/levelEditor.js'), import('/js/levelWorkshop.js'), import('/js/world.js'),
            import('/js/config.js'), import('/js/state.js'),
        ]);
        const ok = (condition, message) => { if (!condition) throw new Error(message); };
        const oldIds = new Set(globalThis.__remediationOldIds);
        const row = (await workshop.listLevelCards()).find(r => r.name === '浏览器正式规则保真');
        const formal = await workshop.getLevelCard(row.id);
        ok(formal.rules.timeLimit === 90 && formal.rules.lockAIHelp === false, '真实保存按钮丢失限时或考核锁');
        const backupId = globalThis.__remediationBackupId;
        const backup = await workshop.getPersistentLevelCard(backupId);
        ok(backup, '浏览器初稿未持久化');
        const put = IDBObjectStore.prototype.put;
        try {
            IDBObjectStore.prototype.put = function (...args) {
                if (this.name === 'cards') throw new DOMException('回归模拟配额耗尽', 'QuotaExceededError');
                return put.apply(this, args);
            };
            state.levelEdit.name = '浏览器同ID会话稿';
            await editor.saveEditorDraft({ silent: true });
            ok(state.levelEdit.lastDraftId === backupId, '仅改名应保持同身份');
            await editor.exitLevelEditor({ saveDraft: false });
            const latest = await workshop.getLevelCard(backupId);
            ok(latest.name === '浏览器同ID会话稿', '同ID会话稿未覆盖列表读取');
            ok(await editor.enterLevelEditor(latest), '浏览器会话稿无法续编');
            await state.levelEdit.draftSavePending;
            const start = workshop.localToWorld(latest.flags.start.x, latest.flags.start.y, latest.flags.start.z);
            world.setBlockSafe(start.x + 1, start.y + 1, start.z + 1, cfg.BlockTypes.DIAMOND_ORE);
            await editor.saveEditorDraft({ silent: true });
            ok(JSON.stringify(await workshop.getPersistentLevelCard(backupId)) === JSON.stringify(backup), '续编降级删除/改写持久备份');
            ok((await workshop.listLevelCards()).filter(r => !oldIds.has(r.id) && r.sessionOnly).length === 1, '多余旧会话稿');
            IDBObjectStore.prototype.put = put;
            await editor.saveEditorDraft({ silent: true });
            ok(await workshop.getPersistentLevelCard(backupId) === null, '成功持久化没有替换旧备份');
            ok((await workshop.listLevelCards()).filter(r => !oldIds.has(r.id)).length === 2, '正式卡加最新稿应只有两条');
            return { exportButton: 'PASS', rules: formal.rules, idbFallbackResume: 'PASS', cases: 7 };
        } finally {
            IDBObjectStore.prototype.put = put;
            if (state.levelEdit) await editor.exitLevelEditor({ saveDraft: false });
            for (const r of await workshop.listLevelCards()) if (!oldIds.has(r.id)) await workshop.deleteLevelCard(r.id);
        }
    });
    console.log(JSON.stringify(result));
    return result;
}

export async function prepareTrySaveFailure(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    await page.evaluate(async () => {
        const [world, cfg, keypad, ui, modal, { state }, settings, life] = await Promise.all([
            import('/js/world.js'), import('/js/config.js'), import('/js/eduKeypad.js'), import('/js/ui.js'),
            import('/js/uiModal.js'), import('/js/state.js'), import('/js/settingsUI.js'), import('/js/playerLife.js'),
        ]);
        settings.setInputMode('keyboard'); life.respawn(); modal.setState('title');
        for (let x = 38; x < 52; x++) for (let z = 38; z < 43; z++) {
            world.setBlockSafe(x, 8, z, cfg.BlockTypes.STONE);
            for (let y = 9; y < 14; y++) world.setBlockSafe(x, y, z, cfg.BlockTypes.AIR);
        }
        world.setBlockSafe(40, 9, 40, cfg.FLAG_BASE + cfg.FLAG_START);
        world.setBlockSafe(48, 9, 40, cfg.FLAG_BASE + cfg.FLAG_GOAL);
        world.setBlockSafe(44, 9, 40, cfg.KEYPAD_BASE);
        keypad.seedAuthoredLock(44, 9, 40, { subject: 'math', kind: 'input', stem: '6+7=?', answer: 13, hint: '先凑十', meta: { source: 'custom' } }, 2);
        ui.openLevelList();
        globalThis.__remediationBlocksBeforeTry = state.blocks;
        globalThis.__remediationStorageSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (...args) {
            if (this === localStorage) throw new DOMException('回归模拟存储失败', 'QuotaExceededError');
            return globalThis.__remediationStorageSet.apply(this, args);
        };
    });
    console.log(await page.snapshot());
}

export async function runTrySaveFailure(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    try {
        await page.click('#btn-level-try');
        await page.waitForFunction(() => !document.getElementById('btn-level-try').disabled && /保存失败.*存储空间/.test(document.getElementById('tooltip').textContent) && Number(getComputedStyle(document.getElementById('tooltip')).opacity) > 0.95, undefined, { timeout: 10000 });
        const result = await page.evaluate(async () => {
            const { state } = await import('/js/state.js');
            const el = document.getElementById('tooltip'), r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            // tooltip 不接鼠标，比较层级与可见性；下面仍应是关卡列表而非画布。
            if (state.levelRun || state.blocks !== globalThis.__remediationBlocksBeforeTry) throw new Error('试玩保存失败改变原世界');
            if (Number(getComputedStyle(el).zIndex) <= Number(getComputedStyle(document.getElementById('level-list')).zIndex) || !el.classList.contains('visible') || top?.id === 'gameCanvas') throw new Error('存储失败提示被浮层盖住');
            return { trySaveFailure: 'PASS', visibleReason: el.textContent };
        });
        console.log(JSON.stringify(result));
        await page.screenshot({ path: '/private/tmp/gameplay-remediation-save-error.png' });
        return result;
    } finally {
        await page.evaluate(async () => {
            Storage.prototype.setItem = globalThis.__remediationStorageSet;
            (await import('/js/ui.js')).closeLevelList();
        });
    }
}
