// 第二三批浏览器验收。runM2Boundaries 使用内存场景，仅对独立测试 origin 执行。
// 实际游玩另用原生 click/keyboard 与截图，不将这里的场景注入计作采集过程。
export async function runM2Boundaries(taskSpace, spaceId, pageLabel = 'p1') {
    const page = (await taskSpace(spaceId)).page(pageLabel);
    return await page.evaluate(async () => {
        const [c, { state: s }, w, data, home, stacks, saves, snaps, modal, entities, bed, rules, queue, tools] = await Promise.all([
            import('/js/config.js'), import('/js/state.js'), import('/js/world.js'),
            import('/js/lifeData.js'), import('/js/homestead.js'), import('/js/inventoryStacks.js'),
            import('/js/saveGame.js'), import('/js/assistant/snapshot.js'), import('/js/uiModal.js'),
            import('/js/entities.js'), import('/js/bed.js'), import('/js/survivalRules.js'),
            import('/js/buildQueue.js'), import('/js/assistant/tools.js'),
        ]);
        const checks = [];
        const check = (name, passed, evidence = null) => {
            checks.push({ name, passed: !!passed, evidence });
            if (!passed) throw new Error(JSON.stringify(checks));
        };
        s.levelRun = null;
        s.levelEdit = null;
        s.gameMode = c.GameModes.SURVIVAL;
        s.camMode = 'free';
        document.activeElement?.blur?.();
        s.windowUnfocused = false;
        modal.setState('playing');
        queue.clearBuildQueue();
        entities.clearAllEnemies();
        s.itemDrops.length = 0;
        data.resetLifeData();
        Object.assign(s.player, {
            x: 78.5, y: 64.001, z: 78.5, health: 20, dead: false,
            inventory: {}, toolWear: {}, toolReserveWear: {}, vx: 0, vy: 0, vz: 0,
        });
        for (let x = 76; x < 102; x++) for (let z = 76; z < 102; z++) {
            w.setBlockSafe(x, 63, z, c.BlockTypes.STONE);
            for (let y = 64; y < 74; y++) w.setBlockSafe(x, y, z, c.BlockTypes.AIR);
        }

        w.setBlockSafe(80, 64, 80, c.LifeBlocks.CHEST);
        w.setBlockSafe(81, 64, 80, c.LifeItems.SEEDS);
        check('非方块大 ID 不截断写入世界', w.getBlock(81, 64, 80) === c.BlockTypes.AIR);
        const tool = c.ToolTypes.PICKAXE;
        stacks.addInventoryStack({ id: tool, count: 1, wear: 17 });
        stacks.addInventoryStack({ id: tool, count: 1, wear: 41 });
        stacks.addInventoryStack({ id: c.BlockTypes.WOOD, count: 128 });
        check('第一把工具入箱', home.depositToContainer(80, 64, 80, tool).count === 1);
        check('第二把工具入箱', home.depositToContainer(80, 64, 80, tool).count === 1);
        check('原木第一栈入箱', home.depositToContainer(80, 64, 80, c.BlockTypes.WOOD).count === 64);
        check('原木第二栈入箱', home.depositToContainer(80, 64, 80, c.BlockTypes.WOOD).count === 64);
        const chest = home.containerAt(80, 64, 80);
        const toolSlots = chest.slots.map((slot, i) => slot?.id === tool ? i : -1).filter(i => i >= 0);
        for (const i of toolSlots) home.withdrawFromContainer(80, 64, 80, i);
        check('两把不同磨损工具往返守恒', JSON.stringify(stacks.toolWears(tool).sort((a, b) => a - b)) === '[17,41]', stacks.toolWears(tool));

        w.setBlockSafe(82, 64, 80, c.BlockTypes.FURNACE);
        stacks.addInventoryStack({ id: c.BlockTypes.SAND, count: 3 });
        stacks.addInventoryStack({ id: c.ItemTypes.COAL, count: 2 });
        check('炉输入接收', home.depositToContainer(82, 64, 80, c.BlockTypes.SAND, 3, 'input').count === 3);
        check('炉燃料接收', home.depositToContainer(82, 64, 80, c.ItemTypes.COAL, 2, 'fuel').count === 2);
        for (let i = 0; i < Math.floor(c.LIFE.furnaceSeconds * 5); i++) home.tickHomestead(0.1);
        const progress = home.containerAt(82, 64, 80).progress;
        check('炉子先加工，不瞬时出成品', progress > 0 && !home.containerAt(82, 64, 80).output, progress);
        modal.setState('pause');
        home.tickHomestead(0.1);
        check('暂停时生产模块自身也拒绝推进', home.containerAt(82, 64, 80).progress === progress);
        modal.setState('playing');
        check('加工中保存', saves.saveGame());
        check('加工中读取', saves.loadGame(s.saveSlot));
        check('加工进度恢复', Math.abs(home.containerAt(82, 64, 80).progress - progress) < 1e-6);
        for (let i = 0; i < Math.ceil(c.LIFE.furnaceSeconds * 25); i++) home.tickHomestead(0.1);
        check('持续产出三块玻璃', home.containerAt(82, 64, 80).output?.count === 3, home.containerAt(82, 64, 80));

        w.setBlockSafe(86, 63, 80, c.LifeBlocks.FARMLAND);
        w.setBlockSafe(86, 63, 81, c.BlockTypes.WATER);
        stacks.addInventoryStack({ id: c.LifeItems.SEEDS, count: 2 });
        home.useFarmItem(c.LifeItems.SEEDS, { x: 86, y: 63, z: 80, block: c.LifeBlocks.FARMLAND, face: { dx: 0, dy: 1, dz: 0 } });
        check('真实播种入口落作物', w.getBlock(86, 64, 80) === c.LifeBlocks.WHEAT);
        w.setBlockSafe(86, 63, 81, c.BlockTypes.AIR);
        const elapsed = data.lifeData().plants['86,64,80'].elapsed;
        for (let i = 0; i < 20; i++) home.tickHomestead(0.1);
        check('断水停止生长', data.lifeData().plants['86,64,80'].elapsed === elapsed);
        w.setBlockSafe(86, 63, 81, c.BlockTypes.WATER);
        for (let i = 0; i < Math.ceil(c.LIFE.cropStageSeconds * 31); i++) home.tickHomestead(0.1);
        check('四阶段小麦成熟', w.getBlock(86, 64, 80) === c.LifeBlocks.WHEAT_MATURE);
        home.harvestPlant(86, 64, 80);
        check('收麦后可持续补种', s.player.inventory[c.LifeItems.WHEAT] === 1 && s.player.inventory[c.LifeItems.SEEDS] === 3);
        home.useFarmItem(c.LifeItems.SEEDS, { x: 86, y: 63, z: 80, block: c.LifeBlocks.FARMLAND, face: { dx: 0, dy: 1, dz: 0 } });
        check('收获后再播种', w.getBlock(86, 64, 80) === c.LifeBlocks.WHEAT);

        w.setBlockSafe(93, 63, 90, c.BlockTypes.DIRT);
        w.setBlockSafe(93, 64, 90, c.LifeBlocks.SAPLING);
        w.setBlockSafe(93, 65, 90, c.BlockTypes.GLASS);
        check('树苗不覆盖建筑', home.growTreeAt(93, 64, 90) === false && w.getBlock(93, 65, 90) === c.BlockTypes.GLASS);
        w.setBlockSafe(93, 65, 90, c.BlockTypes.AIR);
        check('清障后可长成树', home.growTreeAt(93, 64, 90) && w.getBlock(93, 64, 90) === c.BlockTypes.WOOD);

        w.setBlockSafe(80, 64, 80, c.BlockTypes.AIR);
        const destroyedCount = data.captureLifeState().drops.filter(d => d.stack.id === c.BlockTypes.WOOD).reduce((n, d) => n + d.stack.count, 0);
        check('拆箱完整保留内容', destroyedCount === 128, destroyedCount);
        check('刚拆箱立即保存', saves.saveGame());
        check('刚拆箱重新读取', saves.loadGame(s.saveSlot));
        check('重复读档', saves.loadGame(s.saveSlot));
        const reloadedCount = data.captureLifeState().drops.filter(d => d.stack.id === c.BlockTypes.WOOD).reduce((n, d) => n + d.stack.count, 0);
        check('销毁内容跨重载不丢不重复', reloadedCount === 128, reloadedCount);
        check('生活快照保存', snaps.saveSnapshotForReload());
        const beforeSnapshot = JSON.stringify(data.captureLifeState());
        data.resetLifeData();
        check('生活快照恢复', snaps.restoreSnapshotIfAny());
        check('生活快照内容相同', JSON.stringify(data.captureLifeState()) === beforeSnapshot);

        rules.setSurvivalRules('standard');
        check('标准生存免费建造关闭', !rules.canUseFreeBuild());
        const denied = await tools.executeTool('run_build_script', { code: 'globalThis.__m23UnexpectedBuild = true;' });
        check('建造脚本执行前拒绝', denied.isError && !globalThis.__m23UnexpectedBuild, denied);
        rules.setSurvivalRules('experiment');
        const job = queue.enqueueBuildOps('模式切换回归', [[99, 64, 99, c.BlockTypes.PLANKS]]);
        rules.setSurvivalRules('standard');
        queue.updateBuild(0.1);
        await job;
        check('切回标准生存取消待施工', w.getBlock(99, 64, 99) === c.BlockTypes.AIR);
        modal.setState('pause');
        return { method: '浏览器真实模块白盒边界', checks };
    });
}

export async function runtimeStatus(taskSpace, spaceId, pageLabel = 'p1') {
    const page = (await taskSpace(spaceId)).page(pageLabel);
    return await page.evaluate(() => ({
        url: location.href,
        errors: JSON.parse(sessionStorage.getItem('mcAssistant.runtimeErrors') || '[]'),
        fatal: !!document.getElementById('ai-fatal'),
    }));
}

// 真实浏览器键盘走路线：只读取姿态，不写坐标、资源、方块或游戏时间。
// 每段应小于 20 格；阻挡会超时并保留现场，不能跳过失败的路点。
export async function walkNativeRoute(page, waypoints, { jump = true, distance = 0.35 } = {}) {
    const { walkToward } = await import('./home_m1_ego.mjs');
    const trace = [];
    for (const target of waypoints) {
        const position = await walkToward(page, target, { jump, distance });
        const status = await page.evaluate(async () => {
            const s = (await import('/js/state.js')).state;
            return { mode: s.gameMode, flying: s.player.flying, dead: s.player.dead };
        });
        trace.push({ target, position, ...status });
        if (status.dead || status.flying || Math.hypot(position.x - target.x, position.z - target.z) > 1.1) {
            throw new Error('路线未真实到达：' + JSON.stringify(trace));
        }
    }
    return trace;
}

// 隔离测试槽的浏览器真实模块验证。调用方负责先存实际游玩槽，并在 finally 中恢复。
export async function runM3Boundaries(page) {
    return await page.evaluate(async () => {
        const [c,{state:s},w,stacks,home,data,ad,adData,life,ui,modal,kinetic,items,entities,saves] = await Promise.all([
            import('/js/config.js'),import('/js/state.js'),import('/js/world.js'),
            import('/js/inventoryStacks.js'),import('/js/homestead.js'),import('/js/lifeData.js'),
            import('/js/adventure.js'),import('/js/adventureData.js'),import('/js/playerLife.js'),
            import('/js/ui.js'),import('/js/uiModal.js'),import('/js/kinetic.js'),import('/js/items.js'),
            import('/js/entities.js'),import('/js/saveGame.js'),
        ]);
        const checks=[];
        const check=(name,passed,evidence=null)=>{checks.push({name,passed:!!passed,evidence});if(!passed)throw Error(JSON.stringify(checks));};
        document.activeElement?.blur?.();
        s.levelRun=null;s.levelEdit=null;s.windowUnfocused=false;s.gameMode=c.GameModes.SURVIVAL;
        modal.setState('playing');entities.clearAllEnemies();items.clearItemDrops();data.resetLifeData();adData.resetAdventureData();
        Object.assign(s.player,{x:78.5,y:64.001,z:78.5,yaw:0,pitch:0,health:20,hunger:15,dead:false,flying:false,
            vx:0,vy:0,vz:0,inventory:{},toolWear:{},toolReserveWear:{},xp:30,invulnTimer:0});
        for(let x=76;x<102;x++)for(let z=76;z<102;z++){
            w.setBlockSafe(x,63,z,c.BlockTypes.STONE);
            for(let y=64;y<76;y++)w.setBlockSafe(x,y,z,0);
        }
        // 清场可能正常触发旧测试田地的支撑退款；这些不属于本次产线输入。
        data.resetLifeData();items.clearItemDrops();
        w.setBlockSafe(79,64,78,c.BlockTypes.CRAFTING_TABLE);
        const give=(id,count=1,wear=0)=>stacks.addInventoryStack({id,count,wear});
        give(c.ItemTypes.IRON_INGOT,100);give(c.BlockTypes.PLANKS,100);give(c.BlockTypes.COBBLESTONE,100);
        give(c.ItemTypes.STICK,100);give(c.BlockTypes.WOOL,20);
        for(const id of ['armor','shield','wheel','shaft','saw','belt']){
            const r=c.RECIPES.find(r=>r.id===id);
            check(`配方可真实制作：${id}`,!!r && ui.craftRecipe(r)===null);
        }
        ad.toggleEquipment(c.AdventureItems.ARMOR);ad.toggleEquipment(c.AdventureItems.SHIELD);
        const damage=(source,origin,raised)=>{s.player.health=20;s.player.invulnTimer=0;s.player.shieldRaised=raised;life.damagePlayer(8,source,origin);return 20-s.player.health;};
        const front={x:78.5,y:64,z:77.5},back={x:78.5,y:64,z:79.5};
        check('铁护具降低真实近战伤害',damage('melee',front,false)===5);
        check('面向攻击举盾进一步减伤',damage('melee',front,true)===1);
        check('盾不挡背后攻击',damage('melee',back,true)===5);
        check('盾与护具不抵消摔落',damage('fall',front,true)===8);
        give(c.ToolTypes.WOOD_PICKAXE,1,30);give(c.ToolTypes.WOOD_PICKAXE,1,10);
        const xp=s.player.xp,planks=s.player.inventory[c.BlockTypes.PLANKS];
        const reply=ad.repairTool(c.ToolTypes.WOOD_PICKAXE);
        check('工作台维修花3经验和1木板',s.player.xp===xp-3&&s.player.inventory[c.BlockTypes.PLANKS]===planks-1,reply);
        check('维修只改当前工具，备用磨损保持10',stacks.toolWears(c.ToolTypes.WOOD_PICKAXE)[1]===10,stacks.toolWears(c.ToolTypes.WOOD_PICKAXE));
        ad.addMapMarker('我的试验工坊');ad.chooseProject('farm');
        check('路标名字与位置来自当前玩家',adData.adventureData().markers[0]?.name==='我的试验工坊'&&adData.adventureData().markers[0]?.x===78.5);

        // 重建真水车—轴—锯—带—箱链。玩家远离产出，不能把磁吸当作入箱。
        const X=82,Z=82,H=63;
        w.setBlockSafe(X,H+2,Z,c.waterwheelId(c.AXIS_X));
        w.setBlockSafe(X+1,H+2,Z,c.shaftId(c.AXIS_X));
        w.setBlockSafe(X+2,H+2,Z,c.sawId(3));
        for(let x=X+2;x<=X+5;x++)w.setBlockSafe(x,H+1,Z,c.beltId(1));
        w.setBlockSafe(X+6,H+1,Z,c.LifeBlocks.CHEST);w.setBlockSafe(X,H+3,Z,c.BlockTypes.WATER);
        kinetic.initKinetic();
        const pump=n=>{for(let i=0;i<n;i++){kinetic.updateKineticTick(.05);home.tickHomestead(.05);home.flushLifeDrops();items.updateItemDrops(.05);}};
        const count=()=>home.containerAt(X+6,H+1,Z).slots.reduce((n,t)=>n+(t?.id===c.BlockTypes.PLANKS?t.count:0),0);
        const backpackBefore=s.player.inventory[c.BlockTypes.PLANKS];
        for(let i=0;i<20;i++){w.setBlockSafe(X+3,H+2,Z,c.BlockTypes.WOOD);pump(120);}
        check('20原木经真实锯切与传送成为箱中80木板',count()===80,{box:count(),drops:s.itemDrops.length});
        check('玩家背包未代替箱子收货',s.player.inventory[c.BlockTypes.PLANKS]===backpackBefore);
        const chest=home.containerAt(X+6,H+1,Z);
        chest.slots=Array.from({length:c.LIFE.chestSlots},()=>({id:c.BlockTypes.PLANKS,count:64}));
        w.setBlockSafe(X+3,H+2,Z,c.BlockTypes.WOOD);pump(120);
        pump(2600);
        check('满箱超过物品寿命仍保留4木板',s.itemDrops.filter(d=>d.itemId===c.BlockTypes.PLANKS).reduce((n,d)=>n+d.count,0)===4);
        chest.slots[0].count=60;pump(40);
        check('腾出4件容量后恰好接收余量',count()===27*64 && s.itemDrops.length===0);
        check('产线与路标存档成功',saves.saveGame());
        check('产线与路标读取成功',saves.loadGame(s.saveSlot));
        check('读档后箱内物资和路标完整',count()===27*64&&adData.adventureData().markers[0]?.name==='我的试验工坊');
        modal.setState('pause');
        return {method:'浏览器真实模块白盒验证；包含20次锯切与实体传送，非自然采集',checks};
    });
}

// 原生 UI 合成/选取：只读取 DOM 决定目标，不用代码直接发成品或放方块。
export async function selectNativeItem(page, name) {
    const modal = await page.evaluate(async () => (await import('/js/uiModal.js')).getUIState());
    if (modal !== 'inventory') await page.keyboard.press('e');
    await page.fill('#inv-search', name);
    const entries = await page.evaluate(() => [...document.querySelectorAll('.inv-slot')].map(e => e.querySelector('.inv-name')?.textContent));
    const exact = entries.indexOf(name);
    const index = exact >= 0 ? exact : entries.findIndex(label => label?.startsWith(name));
    if (index < 0) throw new Error('背包里找不到 ' + name + ': ' + entries.join(','));
    await page.click('.inv-slot >> nth=' + index);
}
export async function craftNativeItem(page, name, times = 1, recipeIndex = 0) {
    const modal = await page.evaluate(async () => (await import('/js/uiModal.js')).getUIState());
    if (modal !== 'inventory') await page.keyboard.press('e');
    await page.fill('#inv-search', name);
    const labels = await page.evaluate(() => [...document.querySelectorAll('#inventory-panel button[aria-label]')].map(e => e.getAttribute('aria-label')));
    const label = labels.find(v => v === '制作' + name) || labels.find(v => v.startsWith('制作' + name));
    if (!label) throw new Error('配方不存在: ' + name + ': ' + labels.join(','));
    for (let i = 0; i < times; i++) await page.click('[aria-label="' + label + '"] >> nth=' + recipeIndex);
    return await page.evaluate(() => document.querySelector('#inventory-panel')?.textContent);
}
