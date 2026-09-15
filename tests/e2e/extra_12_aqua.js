// tests/e2e/extra_12_aqua.js
// 「深海龙宫」(level_12_aqua) 机关专项断言 —— runExtra 契约：
//   文件定义 async function runExtra(card){ return {断言名: [ok布尔, 证据字符串], ...}; }
//   可用环境 = lib.py PREAMBLE 注入的 B/cfg/S/gb/sb/sleep/tick/lr/lws/ek 等；
//   card = 运行中的关卡卡对象（闯关已 enterLevel，水柱已按 EMBED_OFFSET 嵌入世界）。
// 断言：
//   ① 水柱结构：卡内最长竖向 WATER 柱（水柱电梯 x=31,z=20, y6..13 共 8 格）逐格全 WATER、
//      上下贯通无断格、1 宽（四邻无水）、井底有实心石座、井顶敞口可跨出；
//      并用 lws.localToWorld 逐格核对嵌入世界里的方块（卡 RLE 与实盘一致）。
//   ② 氧气冻结：闯关中把玩家潜入水下甬道（玻璃穹顶走廊内），等 1 秒、再等 1 秒两次读
//      S.player.air 必须相等（闯关冻结），且强灌 playerLife.updateSurvivalStats 也不掉氧、
//      不掉血（溺水伤害被冻结，health 不变且 > 0）。

async function runExtra(card) {
    const out = {};
    card = card || (S.levelRun && S.levelRun.card);
    const BT = cfg.BlockTypes;
    const WATER = BT.WATER;

    // ---------------- ① 水柱结构（全 WATER · 上下贯通） ----------------
    try {
        if (!card) throw new Error('card 为空且 S.levelRun 未激活');
        // 找柱：优先解码卡区域找「最长竖向水柱」；decodeRegionBlocks 不可用时回退
        // 到 level_12_aqua.mjs 的已知坐标（x=31, z=20, y=6..13）。
        let col = null, src = '';
        const dec = lws.decodeRegionBlocks ? lws.decodeRegionBlocks(card) : null;
        if (dec && !dec.error) {
            const r = card.region;
            const at = (x, y, z) => dec.blocks[x + z * r.w + y * r.w * r.d];
            for (let x = 0; x < r.w; x++) {
                for (let z = 0; z < r.d; z++) {
                    let run = 0;
                    for (let y = 0; y < r.h; y++) {
                        if (at(x, y, z) === WATER) {
                            run++;
                            if (!col || run > col.len) col = { x, z, y0: y - run + 1, y1: y, len: run };
                        } else run = 0;
                    }
                }
            }
            src = `卡内扫描(${col ? `${col.x},${col.z} y${col.y0}..${col.y1}` : '无水柱'})`;
        }
        if (!col) col = { x: 31, z: 20, y0: 6, y1: 13, len: 8 };
        const okLen = col.len >= 6; // 1 宽静态水柱电梯（池水/潜水井只有 4 格深，唯一长柱=水柱电梯）
        // 逐格核对嵌入世界：全 WATER 且上下贯通（相邻两格都查到=无断格）
        let gaps = 0, worldCells = [];
        for (let y = col.y0; y <= col.y1; y++) {
            const wpt = lws.localToWorld(col.x, y, col.z);
            const id = gb(wpt.x, wpt.y, wpt.z);
            worldCells.push(`${y}:${id}`);
            if (id !== WATER) gaps++;
        }
        // 1 宽：柱身中段四邻不得有水（井壁石封，防从池水横游进来）
        const midY = (col.y0 + col.y1) >> 1;
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => {
            const wpt = lws.localToWorld(col.x + dx, midY, col.z + dz);
            return gb(wpt.x, wpt.y, wpt.z);
        });
        const oneWide = nb.every((id) => id !== WATER);
        // 井底有座（下方非水非空）+ 井顶敞口（上方是空气，可浮出跨上殿面）
        const botW = lws.localToWorld(col.x, col.y0 - 1, col.z);
        const topW = lws.localToWorld(col.x, col.y1 + 1, col.z);
        const seat = gb(botW.x, botW.y, botW.z);
        const openTop = gb(topW.x, topW.y, topW.z) === BT.AIR;
        // 柱顶东面是拱门空气格（游到水面即可跨上龙宫殿面；水柱电梯=上行主路的出口）
        const sideW = lws.localToWorld(col.x + 1, col.y1, col.z);
        const exitSideId = gb(sideW.x, sideW.y, sideW.z);
        const exitOpen = exitSideId === BT.AIR;

        const ok = okLen && gaps === 0 && oneWide && exitOpen &&
            seat !== WATER && seat !== BT.AIR && openTop;
        out['水柱结构（全WATER·上下贯通）'] = [ok,
            `src=${src} col=(x${col.x},z${col.z}) y${col.y0}..${col.y1} len=${col.len} ` +
            `world=[${worldCells.join(',')}] oneWide=${oneWide} ` +
            `seat=${seat} openTop=${openTop} exitSide(${col.x + 1},${col.y1})=${exitSideId} gaps=${gaps}`];
    } catch (e) {
        out['水柱结构（全WATER·上下贯通）'] = [false, 'exception: ' + (e && e.message)];
    }

    // ---------------- ② 氧气冻结（水下不耗氧 · 不溺水） ----------------
    try {
        if (!S.levelRun) throw new Error('S.levelRun 未激活（需先 enterLevel）');
        const p = S.player;
        // 潜入水下甬道：卡内 (19,3,20) = 玻璃穹顶走廊内水格（两侧玻璃墙、顶 y5..6 玻璃）
        const tun = lws.localToWorld(19, 3, 20);
        p.x = tun.x + 0.5; p.y = tun.y + 0.2; p.z = tun.z + 0.5;
        p.vx = 0; p.vy = 0; p.vz = 0; p.fallStartY = null;
        await tick(6); // rAF 健康时让物理把 underwater 标志打上（被玻璃顶压住不会浮出）
        const inWater = gb(p.x, p.y + 0.5, p.z) === WATER;
        const air0 = p.air, hp0 = p.health;
        await sleep(1000);
        const air1 = p.air;
        await sleep(1000);
        const air2 = p.air;
        // 兜底强灌：rAF 节流时手动调生存结算（闯关冻结必须早退；若冻结失效这里会掉氧/掉血）
        p.underwater = true;
        let forced = 'skip';
        try {
            const pl = await import(B + 'playerLife.js');
            pl.updateSurvivalStats(0.5); pl.updateSurvivalStats(0.5); pl.updateSurvivalStats(1.0);
            forced = 'called';
        } catch (e) { forced = 'import-fail:' + (e && e.message); }
        const air3 = p.air, hp1 = p.health;
        const ok = inWater && air0 === air1 && air1 === air2 && air2 === air3 &&
            hp1 === hp0 && hp1 > 0;
        out['氧气冻结（水下不耗氧·不溺水）'] = [ok,
            JSON.stringify({ inWater, air0, air1, air2, air3, hp0, hp1, forced, run: !!S.levelRun })];
    } catch (e) {
        out['氧气冻结（水下不耗氧·不溺水）'] = [false, 'exception: ' + (e && e.message)];
    }

    return out;
}

// 挂到全局，方便不同加载方式（拼接执行 / module import）都能取到
try { (typeof globalThis !== 'undefined') && (globalThis.runExtra = runExtra); } catch (e) { }
