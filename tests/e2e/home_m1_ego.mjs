// 安家第一批：真实浏览器中的边界回归。只能对本任务独立 origin 调用。
// 实际游玩另走真实 UI / 键盘，不将本文件的 fixture 注入计作自然游玩。
export async function runBoundaries(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    return await page.evaluate(async () => {
        const [cfg, { state: s }, w, bed, home, saves, snapshots, modal, entities, tnt, settings] = await Promise.all([
            import('/js/config.js'), import('/js/state.js'), import('/js/world.js'), import('/js/bed.js'),
            import('/js/homeSurvival.js'), import('/js/saveGame.js'), import('/js/assistant/snapshot.js'),
            import('/js/uiModal.js'), import('/js/entities.js'), import('/js/tnt.js'), import('/js/settingsUI.js'),
        ]);
        const checks = [];
        function check(name, value, evidence = null) {
            checks.push({ name, passed: !!value, evidence });
            if (!value) throw new Error(JSON.stringify(checks));
        }
        settings.setInputMode('keyboard'); modal.setState('pause');
        entities.clearAllEnemies(); tnt.clearTntEntities();
        s.levelRun = null; s.levelEdit = null; s.gameMode = cfg.GameModes.SURVIVAL;
        s.firstDayRemaining = 0; s.homeBed = null; s.time = s.dayLength * 0.5;
        const p = s.player;
        Object.assign(p, { x: 122.5, y: 64.001, z: 122.5, vx: 0, vy: 0, vz: 0,
            dead: false, health: 20, hunger: 13, air: 10, onGround: true, flying: false });
        for (let x = 120; x < 145; x++) for (let z = 120; z < 145; z++) {
            w.setBlockSafe(x, 63, z, cfg.BlockTypes.STONE);
            for (let y = 64; y < 71; y++) w.setBlockSafe(x, y, z, cfg.BlockTypes.AIR);
        }
        for (let i = 0; i < 4; i++) {
            const x = 128 + (i % 2) * 6, z = 128 + Math.floor(i / 2) * 6;
            const err = bed.tryPlaceBed(x, 64, z, i * Math.PI / 2);
            check(`四向床放置 ${i}`, !err, err);
            const cells = bed.breakBedAt(x, 64, z, { drop: false });
            check(`四向整床拆除 ${i}`, cells.length === 2 && !bed.getBedAt(x, 64, z), cells.length);
        }
        check('边界床拒绝', !!bed.tryPlaceBed(0, 64, 0, 0));
        check('安家床放置', !bed.tryPlaceBed(128, 64, 128, 0));
        Object.assign(p, { x: 127.5, y: 64.001, z: 128.5 });
        const daytime = bed.interactBedAt(128, 64, 128);
        check('白天设家', daytime.ok && !!s.homeBed, daytime);
        const hunger = p.hunger;
        s.time = s.dayLength * 0.9;
        const sleep = bed.interactBedAt(128, 64, 128);
        check('夜间睡眠', sleep.ok && sleep.slept, sleep);
        check('睡眠保留饥饿', p.hunger === hunger, p.hunger);
        check('醒来位置有限且不在实心整格', Number.isFinite(p.y) && p.y > 63 && p.y < 66);
        s.generationVersion = 2; s.survivalDifficulty = 'gentle'; s.firstDayRemaining = 123;
        p.quickbar = home.defaultQuickbar();
        home.assignQuickbar(0, cfg.BlockTypes.TORCH);
        const beforeQuickbar = JSON.stringify(p.quickbar);
        const before = JSON.stringify(home.captureHomeState());
        check('保存新家状态', saves.saveGame());
        s.homeBed = null; s.firstDayRemaining = 0; s.generationVersion = 1; p.quickbar = [];
        check('读档恢复', saves.loadGame(s.saveSlot));
        check('家常用栏规则回环', JSON.stringify(home.captureHomeState()) === before);
        check('自定义常用栏读档保真', JSON.stringify(p.quickbar) === beforeQuickbar);
        check('热重载保存', snapshots.saveSnapshotForReload());
        s.homeBed = null; s.firstDayRemaining = 0; p.quickbar = [];
        check('热重载恢复', snapshots.restoreSnapshotIfAny());
        check('热重载家字段回环', JSON.stringify(home.captureHomeState()) === before);
        check('自定义常用栏热重载保真', JSON.stringify(p.quickbar) === beforeQuickbar);
        // 同一建筑，只有爆炸来源改变：轻松苦力怕保护，主动 TNT 仍破坏。
        Object.assign(p, { x: 122.5, y: 64.001, z: 122.5 });
        w.setBlockSafe(138, 65, 138, cfg.BlockTypes.PLANKS);
        tnt.explode(138, 65, 138, 'creeper');
        check('轻松苦力怕保建筑', w.getBlock(138, 65, 138) === cfg.BlockTypes.PLANKS);
        tnt.explode(138, 65, 138);
        check('主动 TNT 仍破建筑', w.getBlock(138, 65, 138) === cfg.BlockTypes.AIR);
        modal.setState('pause');
        check('暂停谓词', modal.isWorldPaused());
        return { kind: 'browser-boundaries', checks };
    });
}

export async function startPauseObservation(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    return await page.evaluate(async () => {
        const [{ state: s }, modal] = await Promise.all([import('/js/state.js'), import('/js/uiModal.js')]);
        modal.setState('pause');
        globalThis.__homePauseEvidence = { started: performance.now(), time: s.time, hunger: s.player.hunger,
            health: s.player.health, xyz: [s.player.x, s.player.y, s.player.z], firstDayRemaining: s.firstDayRemaining };
        return globalThis.__homePauseEvidence;
    });
}

export async function finishPauseObservation(taskSpace, spaceId) {
    const page = (await taskSpace(spaceId)).page('p1');
    return await page.evaluate(async () => {
        const { state: s } = await import('/js/state.js');
        const before = globalThis.__homePauseEvidence;
        if (!before) throw new Error('缺少暂停前样本');
        const after = { time: s.time, hunger: s.player.hunger, health: s.player.health,
            xyz: [s.player.x, s.player.y, s.player.z], firstDayRemaining: s.firstDayRemaining };
        for (const key of Object.keys(after)) {
            if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`暂停期间 ${key} 改变`);
        }
        return { kind: 'browser-wallclock-pause', elapsedMs: performance.now() - before.started, passed: true, after };
    });
}

// 实玩辅助：只读位置／角度计算目标，所有转头、移动均通过真实键盘输入。
// 不修改玩家坐标、背包或世界；阻挡会超时并留下现场供检查。
export async function lookAt(page, target) {
    const aim = await page.evaluate(async target => {
        const [{ state }, cfg] = await Promise.all([import('/js/state.js'), import('/js/config.js')]);
        const p = state.player, dx = target.x - p.x, dz = target.z - p.z;
        const desired = Math.atan2(-dx, -dz);
        const delta = Math.atan2(Math.sin(desired - p.yaw), Math.cos(desired - p.yaw));
        return { yaw: p.yaw + delta, yawSign: Math.sign(delta), pitch: Math.atan2(target.y - p.y - cfg.PLAYER_EYE_HEIGHT, Math.hypot(dx, dz)), oldPitch: p.pitch };
    }, target);
    for (const [field, destination, sign, key] of [
        ['yaw', aim.yaw, aim.yawSign, aim.yawSign > 0 ? 'ArrowLeft' : 'ArrowRight'],
        ['pitch', aim.pitch, Math.sign(aim.pitch - aim.oldPitch), aim.pitch > aim.oldPitch ? 'ArrowUp' : 'ArrowDown'],
    ]) {
        if (!sign) continue;
        await page.keyboard.down(key);
        try {
            await page.waitForFunction(async ({ field, destination, sign }) => {
                const p = (await import('/js/state.js')).state.player;
                return sign * (p[field] - destination) >= -0.025;
            }, { field, destination, sign }, { timeout: 12000 });
        } finally { await page.keyboard.up(key); }
    }
    return await page.evaluate(async () => {
        const [{ state }, interaction] = await Promise.all([import('/js/state.js'), import('/js/interaction.js')]);
        return { yaw: state.player.yaw, pitch: state.player.pitch, hit: interaction.raycastBlocks() };
    });
}

export async function walkToward(page, target, { jump = false, distance = 0.7 } = {}) {
    const p = await page.evaluate(async () => {
        const p = (await import('/js/state.js')).state.player;
        return { x: p.x, y: p.y, z: p.z };
    });
    await lookAt(page, { ...target, y: p.y + 1.62 });
    await page.keyboard.down('w');
    if (jump) await page.keyboard.down('Space');
    try {
        await page.waitForFunction(async ({ target, distance, start }) => {
            const p = (await import('/js/state.js')).state.player;
            const dx=target.x-start.x,dz=target.z-start.z,len=Math.hypot(dx,dz);
            const progress=((p.x-start.x)*dx+(p.z-start.z)*dz)/(len||1);
            return Math.hypot(p.x - target.x, p.z - target.z) <= distance || progress>=len;
        }, { target, distance, start:p }, { timeout: 8000 });
    } finally {
        await page.keyboard.up('w');
        if (jump) await page.keyboard.up('Space');
    }
    return await page.evaluate(async () => {
        const p = (await import('/js/state.js')).state.player;
        return { x: p.x, y: p.y, z: p.z, health: p.health };
    });
}

// 只读地形规划一条从当前位置走到浅水岸边的路；执行仍由 walkToward 的真实按键完成。
export async function findWaterRoute(page, home = false) {
    return await page.evaluate(async home => {
        const [{ state }, w, c] = await Promise.all([import('/js/state.js'), import('/js/world.js'), import('/js/config.js')]);
        const p=state.player, start=[Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)];
        const key=a=>a.join(','), q=[start], seen=new Set([key(start)]), previous=new Map();
        const directions=[[1,0],[-1,0],[0,1],[0,-1]];
        const stand=(x,y,z)=>c.collisionHeight(w.getBlock(x,y-1,z))===1 &&
            ![c.BlockTypes.LEAVES,c.BlockTypes.WOOD,c.BlockTypes.LOG].includes(w.getBlock(x,y-1,z)) &&
            !c.collisionHeight(w.getBlock(x,y,z)) && !c.collisionHeight(w.getBlock(x,y+1,z)) &&
            w.getBlock(x,y,z)!==c.BlockTypes.WATER;
        for(let i=0;i<q.length && i<12000;i++) {
            const cur=q[i], [x,y,z]=cur;
            const arrived=home ? state.homeBed && Math.hypot(x-state.homeBed.x,z-state.homeBed.z)<=2 && Math.abs(y-state.homeBed.y)<=1 :
                directions.some(([dx,dz])=>w.getBlock(x+dx,y-1,z+dz)===c.BlockTypes.WATER);
            if(arrived) {
                const path=[cur];let back=key(cur);
                while(previous.has(back)){const prev=previous.get(back);path.push(prev);back=key(prev);}
                return path.reverse().map(([x,y,z])=>({x:x+.5,y:y+.001,z:z+.5}));
            }
            for(const [dx,dz] of directions) for(const dy of [0,1,-1,-2,-3]) {
                const next=[x+dx,y+dy,z+dz], k=key(next);
                if(Math.abs(next[0]-start[0])>32||Math.abs(next[2]-start[2])>32||seen.has(k))continue;
                if(dy>0 && c.collisionHeight(w.getBlock(x,y+2,z)))continue;
                if(!stand(...next))continue;
                seen.add(k);previous.set(k,cur);q.push(next);
            }
        }
        throw new Error('未找到可步行的池岸路径');
    }, home);
}

export function routeCorners(route) {
    const points=[];
    for(let i=1;i<route.length;i++) {
        const prev=route[i-1],cur=route[i],next=route[i+1];
        if(!next || Math.sign(cur.x-prev.x)!==Math.sign(next.x-cur.x) ||
            Math.sign(cur.z-prev.z)!==Math.sign(next.z-cur.z) || Math.abs(cur.y-prev.y)>.1 || Math.abs(next.y-cur.y)>.1) points.push(cur);
    }
    return points;
}
