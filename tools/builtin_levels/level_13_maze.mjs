// ==================== level_13_maze.mjs ====================
// 「机关迷阵」：13×13 完美迷宫（确定性 DFS、以中心控制室为根生成——完美迷宫天然无环，
//   主径上每道门都是割边，关门即分区，BFS 防绕行天然成立）。绿篱（LEAVES）墙 3 高跳不上，
//   走廊 2 宽；主径蜿蜒（避免直通）。南门前广场起点旗，主径直廊上搭「观察者时钟灯廊」：
//   梁顶嵌红石灯 + 红石火把时钟（粉绕回挂靠方块）+ 观察者盯粉闪、背面输出点背灯，
//   全部按 redstone.js 判定摆成可真实运转的闪烁灯廊。
//   主径 3 道「岔路亭」门锁：①数学·两步计算 ②英语·词汇（亭=检查点）③道法·情景判断（亭=检查点）；
//   死路藏钻石矿与花；中心「控制室」= 终点（羊毛毯+旗+火把）。
// 运行自测：node tools/builtin_levels/level_13_maze.mjs

import {
    BlockTypes,
    FLAG_START,
    FLAG_CHECKPOINT,
    FLAG_GOAL,
    dustId,
    lampId,
    observerId,
    rtorchId,
} from '../../js/config.js';
import {
    Canvas,
    doorway,
    flagAt,
    ground,
    inputQ,
    choiceQ,
    torchPost,
    tree,
    isDirectRun,
    runSpecSelfTest,
} from './_lib.mjs';

const { LEAVES, LOG, TORCH, FLOWER, WOOL, PLANKS, DIAMOND_ORE } = BlockTypes;

export const LEVEL_FILE = 'level_13_maze.level.json';

export function buildLevel() {
    const c = new Canvas(60, 20, 60);
    const gy = 3; // 地面：0..gy-1 泥土，顶面 gy 草皮

    // ---- 迷宫参数：格 3×3（走廊 2 宽 + 绿篱 1 厚），13×13 格，外圈绿篱 ----
    const N = 13;
    const X0 = 9, Z0 = 9;
    const cellX = (i) => X0 + 3 * i;     // 格 (i,j) 走廊西北格 x
    const cellZ = (j) => Z0 + 3 * j;
    const wallX = (i) => X0 + 3 * i + 2; // 格 (i,j) 与 (i+1,j) 之间的竖墙 x
    const wallZ = (j) => Z0 + 3 * j + 2; // 格 (i,j) 与 (i,j+1) 之间的横墙 z
    const PERI_W = X0 - 1, PERI_N = Z0 - 1, PERI_E = wallX(N - 1), PERI_S = wallZ(N - 1);

    // ---- 完美迷宫：确定性 DFS，根=中心控制室 (6,6)（入口在树上远离根，主径才蜿蜒）----
    // V[i][j]=竖墙 (i,j)-(i+1,j) 存在；Hh[i][j]=横墙 (i,j)-(i,j+1) 存在；初始全存在。
    // 完美迷宫=生成树：任意两格路径唯一 ⇒ 主径上任何一条边都是割边，关门必断路。
    const V = Array.from({ length: N - 1 }, () => Array(N).fill(true));
    const Hh = Array.from({ length: N }, () => Array(N - 1).fill(true));
    const seen = Array.from({ length: N }, () => Array(N).fill(false));
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // 北 东 南 西（固定顺序=确定性输出）
    const stack = [[6, 6]];
    seen[6][6] = true;
    while (stack.length) {
        const [i, j] = stack[stack.length - 1];
        let advanced = false;
        for (const [di, dj] of DIRS) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= N || nj >= N || seen[nj][ni]) continue;
            if (di === 1) V[i][j] = false;        // 向东打通
            else if (di === -1) V[ni][j] = false; // 向西打通
            else if (dj === 1) Hh[i][j] = false;  // 向南打通
            else Hh[i][nj] = false;               // 向北打通
            seen[nj][ni] = true;
            stack.push([ni, nj]);
            advanced = true;
            break;
        }
        if (!advanced) stack.pop();
    }

    // ---- 主径：南门格 (6,12) → 中心控制室 (6,6) 的唯一路径（树上前缀）----
    const parent = Array.from({ length: N }, () => Array(N).fill(null));
    {
        const q = [[6, 12]];
        const vis = Array.from({ length: N }, () => Array(N).fill(false));
        vis[12][6] = true;
        while (q.length) {
            const [i, j] = q.shift();
            for (const [di, dj] of DIRS) {
                const ni = i + di, nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= N || nj >= N || vis[nj][ni]) continue;
                const open = di === 1 ? !V[i][j] : di === -1 ? !V[ni][j] : dj === 1 ? !Hh[i][j] : !Hh[i][nj];
                if (!open) continue;
                vis[nj][ni] = true;
                parent[nj][ni] = [i, j];
                q.push([ni, nj]);
            }
        }
    }
    const path = [];
    for (let cur = [6, 6]; cur; cur = parent[cur[1]][cur[0]]) {
        path.push(cur);
        if (cur[0] === 6 && cur[1] === 12) break;
    }
    path.reverse(); // path[0]=(6,12) 南门 → 末尾=(6,6) 控制室
    const onPath = new Set(path.map(([i, j]) => `${i},${j}`));

    // ---- 画布施工 ----
    ground(c, gy);
    const hedgeFill = (x0, z0, x1, z1) => c.fill(x0, gy + 1, z0, x1, gy + 3, z1, LEAVES);

    // 外圈绿篱（3 高跳不上），南门留 1 宽 2 高缺口（x=cellX(6)，gy+3 以上封住）
    hedgeFill(PERI_W, PERI_N, PERI_E, PERI_N);
    hedgeFill(PERI_W, PERI_S, cellX(6) - 1, PERI_S);
    hedgeFill(cellX(6) + 1, PERI_S, PERI_E, PERI_S);
    hedgeFill(PERI_W, PERI_N, PERI_W, PERI_S);
    hedgeFill(PERI_E, PERI_N, PERI_E, PERI_S);

    // 内部绿篱墙（整行无缝；门洞段随后补墙+嵌门）
    for (let i = 0; i < N - 1; i++)
        for (let j = 0; j < N; j++)
            if (V[i][j]) hedgeFill(wallX(i), cellZ(j), wallX(i), cellZ(j) + 1);
    for (let i = 0; i < N; i++)
        for (let j = 0; j < N - 1; j++)
            if (Hh[i][j]) hedgeFill(cellX(i), wallZ(j), cellX(i) + 1, wallZ(j));
    // 角柱补漏：绿篱行列只在格位 2 宽上铺，交点 (wallX(i), wallZ(j)) 谁都没铺——
    // 不补角柱，每个十字交点都是一个 1 格宽的对角绕行洞（全封锁 BFS 会抓到）。
    // 规则：四段邻墙任一存在就填角柱（角柱不在任何走廊通行格上，只加墙不堵路）。
    const vAt = (i, j) => (i >= 0 && i < N - 1 && j >= 0 && j < N) ? V[i][j] : false;
    const hAt = (i, j) => (i >= 0 && i < N && j >= 0 && j < N - 1) ? Hh[i][j] : false;
    for (let i = 0; i < N - 1; i++)
        for (let j = 0; j < N - 1; j++)
            if (vAt(i, j) || hAt(i, j) || hAt(i + 1, j) || vAt(i, j + 1))
                hedgeFill(wallX(i), wallZ(j), wallX(i), wallZ(j));

    // ---- 岔路亭门锁：主径取 3 条树边（天然割边），通道段补绿篱+嵌门+答题机 ----
    // 门洞 1 宽 2 高：占通道的一行/列，另一行/列整柱绿篱（嵌答题机+灯），门洞上方封到墙顶。
    const pick = (t) => Math.min(path.length - 2, Math.max(1, Math.round((path.length - 1) * t)));
    const doorIdx = [pick(0.3), pick(0.55), pick(0.8)];
    const pavilions = doorIdx.map((k) => path[k]); // 三座岔路亭=门所在格
    const keypads = doorIdx.map((k) => {
        const [i, j] = path[k];
        const [ni, nj] = path[k + 1];
        if (nj === j) {
            // 东西向通道（可向东也可向西，墙列取两格中靠西的）：竖墙位 x=wallX(min)；
            // 门占 z=cellZ(j) 行，z+1 行整柱绿篱+嵌答题机
            const wx = wallX(Math.min(i, ni)), wz = cellZ(j);
            hedgeFill(wx, wz + 1, wx, wz + 1);
            c.set(wx, gy + 3, wz, LEAVES); // 门洞上方封到墙顶
            doorway(c, { x: wx, z: wz, y0: gy + 1, facing: 3 }, { x: wx, y: gy + 1, z: wz + 1 });
            c.set(wx, gy + 4, wz, TORCH);  // 墙顶双火把
            c.set(wx, gy + 4, wz + 1, TORCH);
            c.set(wx - 1, gy, wz, WOOL);   // 门前羊毛地毯条（地面层，不挡路）
            c.set(wx + 1, gy, wz, WOOL);
            return { x: wx, y: gy + 1, z: wz + 1 }; // 答题机坐标
        }
        // 南北向通道（可向南也可向北，墙行取两格中靠北的）：横墙位 z=wallZ(min)；
        // 门占 x=cellX(i) 列，x+1 列整柱绿篱+嵌答题机
        const wz = wallZ(Math.min(j, nj)), wx = cellX(i);
        hedgeFill(wx + 1, wz, wx + 1, wz);
        c.set(wx, gy + 3, wz, LEAVES);
        doorway(c, { x: wx, z: wz, y0: gy + 1, facing: 2 }, { x: wx + 1, y: gy + 1, z: wz });
        c.set(wx, gy + 4, wz, TORCH);
        c.set(wx + 1, gy + 4, wz, TORCH);
        c.set(wx, gy, wz - 1, WOOL);
        c.set(wx, gy, wz + 1, WOOL);
        return { x: wx + 1, y: gy + 1, z: wz };
    });

    // ---- 观察者时钟灯廊：主径的东西向直廊段放两座 ----
    // 时钟原理（对齐 redstone.js 判定）：亮火把给邻粉供能 → 粉充能东邻挂靠方块 A → 火把目标态
    //   翻转熄灭 → 粉断电 → 火把复亮 = 振荡时钟；梁中嵌灯坐在粉正下方随钟闪烁；
    //   观察者面西盯粉（亮灭翻转即脉冲），背面输出点亮背灯。
    // 单元占地：梁 x ax-1..ax+3 / z za-1..za+2（搭在走廊两侧绿篱顶），构件在 gy+5 层。
    const galleryUnit = (ax, za) => {
        c.fill(ax - 1, gy + 4, za - 1, ax + 3, gy + 4, za + 2, PLANKS); // 梁
        c.set(ax, gy + 5, za, LOG);                          // A：火把挂靠方块（木柱造型）
        c.set(ax - 1, gy + 5, za, rtorchId(5, 1));           // 红石火把贴 A 西面（facing 5=西，亮）
        for (const [dx, dz] of [[-1, 1], [0, 1], [1, 1], [1, 0]]) {
            c.set(ax + dx, gy + 5, za + dz, dustId(0));      // 粉从火把绕回 A 东侧
        }
        c.set(ax + 1, gy + 4, za, lampId(0));                // 梁中嵌灯=粉正下方，随钟闪烁
        c.set(ax + 2, gy + 5, za, observerId(5, 0));         // 观察者面西盯粉
        c.set(ax + 3, gy + 4, za, lampId(0));                // 背灯=观察者背面输出格正下方
    };
    {
        const units = [];
        for (let k = 1; k + 1 < path.length && units.length < 2; k++) {
            if (doorIdx.some((dg) => Math.abs(dg - k) <= 2)) continue; // 避开门具
            const [i1, j1] = path[k], [i2, j2] = path[k + 1];
            if (j1 !== j2 || Math.abs(i2 - i1) !== 1) continue;        // 只挑东西向直廊
            const ax = cellX(Math.min(i1, i2)), za = cellZ(j1);
            if (units.some(([ux, uz]) => Math.abs(ux - ax) < 8 && Math.abs(uz - za) < 5)) continue;
            units.push([ax, za]);
        }
        if (units.length < 2) { // 兜底：南门行固定格（至少出门就能看见灯廊）
            const fallback = [[cellX(3), cellZ(12)], [cellX(5), cellZ(12)]];
            for (const f of fallback) {
                if (units.length >= 2) break;
                if (!units.some(([ux, uz]) => Math.abs(ux - f[0]) < 8 && Math.abs(uz - f[1]) < 5)) units.push(f);
            }
        }
        for (const [ax, za] of units) galleryUnit(ax, za);
    }

    // ---- 主径照明：每隔 3 格一束地面火把（跳过门后格）----
    const gateNext = new Set(doorIdx.map((k) => path[k + 1].join(',')));
    for (let k = 0; k < path.length; k += 3) {
        const [i, j] = path[k];
        if (gateNext.has(`${i},${j}`)) continue;
        c.set(cellX(i) + 1, gy + 1, cellZ(j), TORCH);
    }

    // ---- 死路奖励：度数 1 的格藏钻石矿+花（离中心越远越值得绕）----
    const degree = (i, j) => {
        let d = 0;
        if (i < N - 1 && !V[i][j]) d++;
        if (i > 0 && !V[i - 1][j]) d++;
        if (j < N - 1 && !Hh[i][j]) d++;
        if (j > 0 && !Hh[i][j - 1]) d++;
        return d;
    };
    const deadEnds = [];
    for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++)
            if (degree(i, j) === 1 && !onPath.has(`${i},${j}`)) deadEnds.push([i, j]);
    deadEnds.sort((a, b) => (Math.abs(b[0] - 6) + Math.abs(b[1] - 6)) - (Math.abs(a[0] - 6) + Math.abs(a[1] - 6)));
    for (const [i, j] of deadEnds.slice(0, 4)) {
        c.set(cellX(i), gy + 1, cellZ(j), DIAMOND_ORE);
        c.set(cellX(i) + 1, gy + 1, cellZ(j) + 1, FLOWER);
    }
    // 绿篱顶散点火把补光（确定性伪随机，只落在存在的墙段上）
    for (let i = 0; i < N - 1; i += 2)
        for (let j = 0; j < N; j += 3)
            if (V[i][j] && (i * 7 + j * 5) % 4 === 0) c.set(wallX(i), gy + 4, cellZ(j), TORCH);

    // ---- 中心控制室（终点）：羊毛毯 + 旗 + 角火把 ----
    c.fill(cellX(6), gy + 1, cellZ(6), cellX(6) + 1, gy + 1, cellZ(6) + 1, WOOL);
    flagAt(c, cellX(6), gy + 1, cellZ(6), FLAG_GOAL); // 旗立毯上（gy+2）
    c.set(cellX(6) + 1, gy + 2, cellZ(6) + 1, TORCH);

    // ---- 检查点旗：中段两座岔路亭格内 ----
    const cps = [pavilions[1], pavilions[2]].map(([i, j]) => {
        flagAt(c, cellX(i), gy, cellZ(j), FLAG_CHECKPOINT);
        return { x: cellX(i), y: gy + 1, z: cellZ(j) };
    });

    // ---- 迷宫外（南门前）：起点广场 ----
    flagAt(c, cellX(6), gy, PERI_S + 3, FLAG_START);
    tree(c, 18, gy, PERI_S + 5); tree(c, 38, gy, PERI_S + 5);
    torchPost(c, 21, gy, PERI_S + 3); torchPost(c, 33, gy, PERI_S + 3);
    for (const x of [25, 26, 28, 29]) c.set(x, gy + 1, PERI_S + 4, FLOWER);

    // ---- 题目（自拟·三上对齐，答案均已手算复算）----
    return {
        name: '机关迷阵',
        canvas: c,
        rules: { timeLimit: 420, lockAIHelp: true },
        flags: {
            start: { x: cellX(6), y: gy + 1, z: PERI_S + 3 },
            checkpoints: cps,
            goal: { x: cellX(6), y: gy + 2, z: cellZ(6) },
        },
        questions: [
            // 锁① 数学·两步计算（隐藏步：段数−1=刀数）：4 锯 × 2 分 = 8
            inputQ({ ...keypads[0] },
                '一根木头要锯成 5 段，每锯一次用 2 分钟。全部锯完一共要用多少分钟？', 8,
                '三上·两步计算应用', '先想一想：锯成 5 段其实要锯几刀？段数和刀数可不一样'),
            // 锁② 英语·词汇（主题词）
            choiceQ({ ...keypads[1] },
                'english', '「maze」是什么意思？',
                ['迷宫', '花园', '宝库', '钥匙'], 0,
                '英语·词汇', '你现在脚下这座绿篱大迷宫，就是一个 maze'),
            // 锁③ 道法·情景判断（走散求助）
            choiceQ({ ...keypads[2] },
                'daofa', '在游乐场迷宫里和爸爸妈妈走散了，最正确的做法是？',
                ['站在原地不乱走，找工作人员帮忙广播', '继续乱跑，比比谁先找到谁', '跟着刚认识的陌生人去找爸爸妈妈', '躲到角落大哭，谁来都不理'], 0,
                '三上·安全与自立', '走散了要待在原地附近，找穿制服、可以信任的大人帮忙'),
        ],
    };
}

if (isDirectRun(import.meta.url)) await runSpecSelfTest(buildLevel());
