// 编辑器失败退出：真实游戏模块、IndexedDB、退出按钮和键盘。
// 在同一个 ego-browser TaskSpace 的隔离 origin 调用 prepare -> snapshot -> exercise。
export async function prepare(taskSpace, spaceId, kind = 'no-anchors') {
    const page = (await taskSpace(spaceId)).page('p1');
    await page.evaluate(async kind => {
        const [editor, workshop, world, cfg, { state }, keypad, settings, life, modal, entities, saves] = await Promise.all([
            import('/js/levelEditor.js'), import('/js/levelWorkshop.js'), import('/js/world.js'), import('/js/config.js'),
            import('/js/state.js'), import('/js/eduKeypad.js'), import('/js/settingsUI.js'), import('/js/playerLife.js'),
            import('/js/uiModal.js'), import('/js/entities.js'), import('/js/saveGame.js'),
        ]);
        if (state.levelEdit) await editor.exitLevelEditor({ saveDraft: false });
        entities.clearAllEnemies(); settings.setInputMode('keyboard'); life.respawn(); modal.setState('playing');
        const oldIds = new Set((await workshop.listLevelCards()).map(r => r.id));
        if (!await editor.enterLevelEditor(null, { name: `退出保护-${kind}` })) throw new Error('无法进入编辑器');
        const ed = state.levelEdit; await ed.draftSavePending;
        ed.rules = { timeLimit: 90, lockAIHelp: false }; keypad.setExamIntent(true);
        world.setBlockSafe(85, 4, 85, cfg.BlockTypes.DIAMOND_ORE);
        if (kind !== 'no-anchors') {
            world.setBlockSafe(84, 4, 84, cfg.FLAG_BASE + cfg.FLAG_START);
            world.setBlockSafe(88, 4, 84, cfg.KEYPAD_BASE);
            keypad.seedAuthoredLock(88, 4, 84, { subject: 'math', kind: 'input', stem: '6+7=?', answer: 13, hint: '先凑十', meta: { source: 'custom' } }, 2);
            if (kind !== 'missing-goal') world.setBlockSafe(kind === 'oversize' ? 184 : 92, 4, 84, cfg.FLAG_BASE + cfg.FLAG_GOAL);
        }
        const fixture = globalThis.__editorExitFixture = {
            kind, ed, blocks: state.blocks, locks: keypad.listAuthoredLocks(), rules: { ...ed.rules },
            slot: state.saveSlot, slotJson: saves.exportSlotJson(state.saveSlot), oldIds: [...oldIds],
            inputFlags: { recording: state.recordingControlsOpen, export: state.levelExportOpen, prefab: state.prefabPickerOpen, bank: state.questionBankOpen },
        };
        if (kind === 'quota' || kind === 'commit-abort') {
            await editor.saveEditorDraft({ silent: true });
            fixture.backupId = ed.persistentDraftId;
            fixture.backup = await workshop.getPersistentLevelCard(fixture.backupId);
            world.setBlockSafe(86, 4, 85, cfg.BlockTypes.GLASS);
            fixture.put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (...args) {
                if (this.name === 'cards' && kind === 'quota') throw new DOMException('模拟配额耗尽', 'QuotaExceededError');
                const req = fixture.put.apply(this, args);
                if (this.name === 'cards' && kind === 'commit-abort') {
                    req.addEventListener('success', () => this.transaction.abort(), { once: true });
                }
                return req;
            };
        }
    }, kind);
    await page.waitForSelector('#btn-editor-exit', { state: 'visible' });
    console.log(await page.snapshot());
}

export async function openFailure(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    await page.click('#btn-editor-exit');
    await page.waitForSelector('#editor-exit-dialog', { state: 'visible' });
    console.log(await page.snapshot());
}

export async function exercise(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    const opening = await page.evaluate(async () => {
        const [{ state }, keypad, modal, saves] = await Promise.all([
            import('/js/state.js'), import('/js/eduKeypad.js'), import('/js/uiModal.js'), import('/js/saveGame.js'),
        ]);
        const f = globalThis.__editorExitFixture;
        const expected = { 'no-anchors': /锚点/, 'missing-goal': /终点旗/, oversize: /96×64×96/, quota: /存储空间不足.*会话/, 'commit-abort': /事务未能提交.*会话/ };
        const reason = document.getElementById('editor-exit-reason').textContent;
        if (!expected[f.kind].test(reason)) throw new Error(`未展示具体原因：${reason}`);
        if (state.levelEdit !== f.ed || state.blocks !== f.blocks || saves.exportSlotJson(f.slot) !== f.slotJson || JSON.stringify(keypad.listAuthoredLocks()) !== JSON.stringify(f.locks)) throw new Error('失败退出改变世界/锁题/原槽');
        if (modal.isGameActive() || document.pointerLockElement || document.activeElement.id !== 'btn-editor-exit-continue') throw new Error('失败选择没有安全默认焦点或仍激活游戏');
        return { kind: f.kind, reason, opening: 'PASS' };
    });
    const assistantBefore = await page.evaluate(async () => (await import('/js/state.js')).state.assistantOpen);
    for (const key of ['b', 'k', 'e', 'w', 't']) await page.keyboard.press(key);
    await page.evaluate(async assistantBefore => {
        const { state } = await import('/js/state.js'); const f = globalThis.__editorExitFixture;
        if (!state.editorExitOpen || state.assistantOpen !== assistantBefore || state.recordingControlsOpen !== f.inputFlags.recording || state.levelExportOpen !== f.inputFlags.export || state.prefabPickerOpen !== f.inputFlags.prefab || state.questionBankOpen !== f.inputFlags.bank) throw new Error('选择期间游戏快捷键穿透');
    }, assistantBefore);
    const kind = opening.kind;
    if (kind === 'oversize') {
        // Tab 锁在两按钮间：一遍到放弃、第二遍回安全选项，再明确选择放弃。
        await page.keyboard.press('Tab');
        await page.evaluate(() => { if (document.activeElement.id !== 'btn-editor-exit-discard') throw new Error('Tab 没进入放弃按钮'); });
        await page.keyboard.press('Tab');
        await page.evaluate(() => { if (document.activeElement.id !== 'btn-editor-exit-continue') throw new Error('Tab 跳出了选择框'); });
        await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
        await page.waitForFunction(async () => !(await import('/js/state.js')).state.levelEdit, undefined, { timeout: 10000 });
        console.log(JSON.stringify({ ...opening, explicitDiscardKeyboard: 'PASS' }));
    } else {
        if (kind === 'missing-goal') await page.keyboard.press('Escape');
        else if (kind === 'quota') await page.keyboard.press('q');
        else await page.click('#btn-editor-exit-continue');
        await page.waitForFunction(async () => {
            const { state } = await import('/js/state.js'); return !state.editorExitOpen && !state.levelEdit?.exiting;
        }, undefined, { timeout: 5000 });
        await page.evaluate(async () => {
            const [editor, world, cfg, { state }, workshop, keypad] = await Promise.all([
                import('/js/levelEditor.js'), import('/js/world.js'), import('/js/config.js'), import('/js/state.js'), import('/js/levelWorkshop.js'), import('/js/eduKeypad.js'),
            ]);
            const f = globalThis.__editorExitFixture;
            if (state.levelEdit !== f.ed || state.blocks !== f.blocks || world.getBlock(85, 4, 85) !== cfg.BlockTypes.DIAMOND_ORE) throw new Error('继续编辑丢失修改');
            if (f.put) {
                if (JSON.stringify(await workshop.getPersistentLevelCard(f.backupId)) !== JSON.stringify(f.backup)) throw new Error('降级误改持久备份');
                IDBObjectStore.prototype.put = f.put;
            }
            // 补齐旗标或存储后继续正常退出，不需要放弃有效稿。
            world.setBlockSafe(84, 4, 84, cfg.FLAG_BASE + cfg.FLAG_START);
            world.setBlockSafe(92, 4, 84, cfg.FLAG_BASE + cfg.FLAG_GOAL);
            if (f.kind === 'no-anchors') {
                world.setBlockSafe(88, 4, 84, cfg.KEYPAD_BASE);
                keypad.seedAuthoredLock(88, 4, 84, { subject: 'math', kind: 'input', stem: '6+7=?', answer: 13, hint: '先凑十', meta: { source: 'custom' } }, 2);
            }
        });
        await page.click('#btn-editor-exit');
        await page.waitForFunction(async () => !(await import('/js/state.js')).state.levelEdit, undefined, { timeout: 10000 });
        await page.evaluate(async () => {
            const workshop = await import('/js/levelWorkshop.js'); const cfg = await import('/js/config.js');
            const f = globalThis.__editorExitFixture;
            const rows = (await workshop.listLevelCards()).filter(r => !f.oldIds.includes(r.id));
            if (rows.length !== 1 || rows[0].sessionOnly) throw new Error('修正后末稿未持久保存或重复');
            const card = await workshop.getLevelCard(rows[0].id), decoded = workshop.decodeRegionBlocks(card).blocks;
            if (!decoded.includes(cfg.BlockTypes.DIAMOND_ORE) || card.rules.timeLimit !== 90 || card.rules.lockAIHelp !== false) throw new Error('修正保存丢修改/规则');
        });
        console.log(JSON.stringify({ ...opening, continueEditing: 'PASS', correctedSaveExit: 'PASS' }));
    }
    await cleanup(taskSpace, spaceId);
}

export async function cleanup(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    await page.evaluate(async () => {
        const f = globalThis.__editorExitFixture;
        if (!f) return;
        if (f.put) IDBObjectStore.prototype.put = f.put;
        const editor = await import('/js/levelEditor.js');
        if ((await import('/js/state.js')).state.levelEdit) await editor.exitLevelEditor({ saveDraft: false });
        const workshop = await import('/js/levelWorkshop.js');
        for (const row of await workshop.listLevelCards()) if (!f.oldIds.includes(row.id)) await workshop.deleteLevelCard(row.id);
        delete globalThis.__editorExitFixture;
    });
}

// 保存等待窗口内点击画布／作者表单，必须全部让位于已捕获的末稿。
export async function runPendingInput(taskSpace, spaceId, mode = 'mouse') {
    const page = (await taskSpace(spaceId)).page('p1');
    await prepare(taskSpace, spaceId, 'missing-goal');
    await page.evaluate(async mode => {
        const [editor, world, cfg, keypad, { state }, settings] = await Promise.all([
            import('/js/levelEditor.js'), import('/js/world.js'), import('/js/config.js'), import('/js/eduKeypad.js'), import('/js/state.js'), import('/js/settingsUI.js'),
        ]);
        const f = globalThis.__editorExitFixture;
        world.setBlockSafe(92, 4, 84, cfg.FLAG_BASE + cfg.FLAG_GOAL);
        if (mode === 'author') keypad.interactKeypadAuthorAt(88, 4, 84);
        editor.startPlacing('torch_post'); settings.setInputMode('mouse');
        state.player.pitch = -0.8;
        f.locks = keypad.listAuthoredLocks(); f.rules = { ...state.levelEdit.rules };
        f.blocksCopy = state.blocks.slice();
        f.toBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
            f.releaseThumbnail = () => f.toBlob.call(this, callback, ...args);
        };
    }, mode);
    try {
        await page.click('#btn-editor-exit');
        await page.waitForFunction(() => !!globalThis.__editorExitFixture?.releaseThumbnail, undefined, { timeout: 5000 });
        if (mode === 'mouse') {
            const height = await page.evaluate(() => document.getElementById('gameCanvas').getBoundingClientRect().height);
            await page.click('#gameCanvas', { position: { x: 40, y: height - 90 } });
        }
        await page.evaluate(async mode => {
            // 作者输入事件经过真实委托处理器；已开始保存后不能再改变卡内考核锁。
            if (mode === 'author') {
                const input = document.querySelector('#edu-author input[data-field="exam"]');
                const button = document.querySelector('#edu-author [data-act="save"]');
                if (!input || !button) throw new Error('未找到真实作者表单控件');
                input.checked = !input.checked; input.dispatchEvent(new Event('change', { bubbles: true }));
                button.click();
            }
            const [{ state }, keypad] = await Promise.all([import('/js/state.js'), import('/js/eduKeypad.js')]);
            const f = globalThis.__editorExitFixture;
            if (state.blocks.some((v, i) => v !== f.blocksCopy[i]) || JSON.stringify(keypad.listAuthoredLocks()) !== JSON.stringify(f.locks) || JSON.stringify(state.levelEdit.rules) !== JSON.stringify(f.rules)) throw new Error('保存等待期间鼠标/表单修改穿透');
            HTMLCanvasElement.prototype.toBlob = f.toBlob;
            f.releaseThumbnail();
        }, mode);
        await page.waitForFunction(async () => !(await import('/js/state.js')).state.levelEdit, undefined, { timeout: 10000 });
        console.log(JSON.stringify({ pendingInput: mode, result: 'PASS' }));
    } finally {
        await page.evaluate(() => {
            const f = globalThis.__editorExitFixture;
            if (f?.toBlob) { HTMLCanvasElement.prototype.toBlob = f.toBlob; f.releaseThumbnail?.(); }
        });
        await cleanup(taskSpace, spaceId);
    }
}

export async function runMainAndAssistant(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    await prepare(taskSpace, spaceId, 'no-anchors');
    try {
        await page.click('#ai-fab');
        await page.evaluate(async () => (await import('/js/uiModal.js')).setState('pause'));
        await page.click('#btn-creative');
        await page.click('#btn-creative'); // 暂停菜单现有二次确认后，走真正的开新世界守卫。
        await page.waitForSelector('#editor-exit-dialog', { state: 'visible' });
        await page.keyboard.press('t');
        await page.evaluate(async () => {
            const [{ state }, modal] = await Promise.all([import('/js/state.js'), import('/js/uiModal.js')]);
            const f = globalThis.__editorExitFixture;
            if (!state.editorExitOpen || !state.assistantOpen || modal.getUIState() !== 'pause' || state.blocks !== f.blocks || document.activeElement.id !== 'btn-editor-exit-continue') throw new Error('main/助手退出选择状态被穿透');
            if (/草稿已保存|已退出关卡编辑/.test(document.getElementById('tooltip').textContent)) throw new Error('世界操作提前宣称退出成功');
        });
        await page.keyboard.press('Escape');
        await page.waitForFunction(async () => !(await import('/js/state.js')).state.levelEdit?.exiting, undefined, { timeout: 5000 });
        await page.evaluate(async () => {
            const [{ state }, modal] = await Promise.all([import('/js/state.js'), import('/js/uiModal.js')]);
            if (!state.levelEdit || state.blocks !== globalThis.__editorExitFixture.blocks || modal.getUIState() !== 'pause' || !state.assistantOpen) throw new Error('Esc 继续状态异常：' + JSON.stringify({ edit: !!state.levelEdit, sameBlocks: state.blocks === globalThis.__editorExitFixture.blocks, ui: modal.getUIState(), assistant: state.assistantOpen }));
        });
        await page.click('#ai-btn-close');
        await page.evaluate(async () => (await import('/js/uiModal.js')).setState('playing'));
        await openFailure(taskSpace, spaceId);
        await page.click('#btn-editor-exit-discard');
        await page.waitForFunction(async () => !(await import('/js/state.js')).state.levelEdit, undefined, { timeout: 10000 });
        console.log(JSON.stringify({ mainWorldGuard: 'PASS', assistantOpenEsc: 'PASS', explicitDiscardMouse: 'PASS' }));
    } finally { await cleanup(taskSpace, spaceId); }
}
