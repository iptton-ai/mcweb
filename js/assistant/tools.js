// ==================== assistant/tools.js ====================
// AI 助手工具集：
//   世界类：get_game_context / scan_terrain / place_blocks / clear_area / read_blocks / run_build_script / set_build_speed
//   文件类：list_game_files / read_game_file / write_game_file / reload_game / get_runtime_errors
// 全部返回字符串（通常是 JSON），直接作为 tool 消息回传给 LLM。
// 建造类工具经 buildQueue 渐进放置（可调速/暂停，便于录制延时摄影），
// 工具会等施工任务全部应用完才返回结果，LLM 的「放置→校验」流程不受影响。

import { BlockInfo, BlockTypes, BUILD_SPEED_LEVELS, CHUNK_SIZE, COGWHEEL_BASE, COGWHEEL_ITEM_ID, CRUSHER_BASE, CRUSHER_ITEM_ID, HotbarBlocks, SAW_BASE, SAW_ITEM_ID, SHAFT_BASE, SHAFT_ITEM_ID, WATERWHEEL_BASE, WATERWHEEL_ITEM_ID, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from '../config.js';
import { isCreative, isNight, state } from '../state.js';
import { getBlock } from '../world.js';
import { isSolid } from '../chunk.js';
import { enqueueBuildOps, getBuildStatus, setBuildSpeedByBps, setBuildSpeedIdx, speedText } from '../buildQueue.js';
import { getActiveSessionId } from './sessions.js';
import { saveSnapshotForReload } from './snapshot.js';
import { toast } from './ui.js'; // ESM 循环引用（ui→agent→tools→ui）：仅运行期调用，安全

const RUNTIME_ERR_KEY = 'mcAssistant.runtimeErrors';

// 施工开始时提示玩家：面板打开期间游戏输入被抑制（指针锁定与面板互斥），
// 建造是后台任务不依赖面板，关面板即可回到游戏边玩边看。
function notifyBuildStart(label) {
    toast(`🏗️ 「${label}」施工中：T 关面板即看。想录到建造全程，先按 🎥 挂机位（显示待机）再叫我建，跟拍自动降到延时档 · P 暂停 · [ ] 调速 · G 前往`, 6000);
}

// ---------- 文件 API 可用性（index.js 探测后设置） ----------
let fileApiOnline = false;
export function setFileApiOnline(v) { fileApiOnline = v; }
function fileApiHint() {
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    return local
        ? '本地文件 API 不可用：请停掉 http.server，改用 python3 server.py 启动（它提供文件读写与热加载）。'
        : '当前是公网静态部署，源码读写与热重载不可用（安全考虑，公网不开放写文件接口）；世界建造功能不受影响，请继续用世界类工具完成任务。';
}

// ---------- 通用小工具 ----------
function truncateStr(s, n) {
    s = String(s ?? '');
    return s.length > n ? s.slice(0, n) + `…（已截断，原长 ${s.length} 字符）` : s;
}

function nameOf(id) {
    return BlockInfo[id]?.name || `未知(${id})`;
}

// 地表最高实心方块的 y（跳过水/火把/花等非固体）
function groundY(x, z) {
    if (x < 0 || x >= WORLD_WIDTH || z < 0 || z >= WORLD_DEPTH) return -1;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        if (isSolid(getBlock(x, y, z))) return y;
    }
    return 0;
}

// ---------- 世界类工具实现 ----------

function toolGetGameContext() {
    const p = state.player;
    return JSON.stringify({
        世界: { W: WORLD_WIDTH, D: WORLD_DEPTH, H: WORLD_HEIGHT, 区块: CHUNK_SIZE },
        玩家: {
            x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1),
            yaw: +p.yaw.toFixed(2),
            flying: p.flying, health: p.health, onGround: p.onGround,
            模式: isCreative() ? '建造(创造)' : '生存',
            背包: isCreative() ? '创造模式无限' : Object.entries(p.inventory).map(([id, n]) => `${nameOf(+id)}×${n}`),
        },
        前方10格锚点: {
            x: Math.round(p.x - Math.sin(p.yaw) * 10),
            z: Math.round(p.z - Math.cos(p.yaw) * 10),
            groundY: groundY(Math.round(p.x - Math.sin(p.yaw) * 10), Math.round(p.z - Math.cos(p.yaw) * 10)),
        },
        出生点: state.spawn,
        时间: { 秒: Math.floor(state.time), 游戏小时: Math.floor(state.time / 60) % 24, 夜晚: isNight() },
        怪物数: state.enemies.length,
    });
}

function toolScanTerrain({ x, z, radius = 10 } = {}) {
    x = Math.round(Number(x));
    z = Math.round(Number(z));
    radius = Math.max(2, Math.min(30, Number(radius) || 10));
    if (!Number.isFinite(x) || !Number.isFinite(z)) return '错误：需要提供 x、z 参数';

    const offsets = [-radius, -radius / 2, 0, radius / 2, radius].map((v) => Math.round(v));
    const grid = [];
    for (const dx of offsets) {
        for (const dz of offsets) {
            const gx = x + dx;
            const gz = z + dz;
            const gy = groundY(gx, gz);
            grid.push({ x: gx, z: gz, groundY: gy, surface: gy >= 0 ? nameOf(getBlock(gx, gy, gz)) : '界外' });
        }
    }
    return JSON.stringify({ 中心: { x, z, groundY: groundY(x, z) }, 网格: grid, 说明: '5×5 采样，groundY 为地表最高实心方块 y，其上 1 格开始可放置建筑地板' });
}

async function toolPlaceBlocks({ blocks } = {}) {
    if (!Array.isArray(blocks) || blocks.length === 0) return '错误：blocks 需为 [[x,y,z,typeId], …] 数组';
    if (blocks.length > 4000) return `错误：单次最多 4000 格（收到 ${blocks.length}），请拆分多次调用`;

    const ops = [];
    const skipped = [];

    for (const item of blocks) {
        if (!Array.isArray(item) || item.length < 4) { skipped.push('格式错误:' + JSON.stringify(item)); continue; }
        const [bx, by, bz, bt] = item.map(Number);
        if (![bx, by, bz, bt].every(Number.isInteger)) { skipped.push('非整数:' + JSON.stringify(item)); continue; }
        if (bx < 0 || bx >= WORLD_WIDTH || by < 1 || by >= WORLD_HEIGHT || bz < 0 || bz >= WORLD_DEPTH) { skipped.push(`越界或 y=0(基岩层):${bx},${by},${bz}`); continue; }
        if (BlockInfo[bt] === undefined) { skipped.push(`未知方块ID:${bt}`); continue; }
        // 与玩家重叠的格子由施工队列在逐格应用时再判（渐进施工期间玩家可能移动）
        ops.push([bx, by, bz, bt]);
    }
    notifyBuildStart('place_blocks');
    const r = await enqueueBuildOps('place_blocks', ops);
    const allSkipped = skipped.concat(r.skipped); // 入队校验的跳过 + 施工时与玩家重叠的跳过
    return JSON.stringify({
        已放置: r.applied,
        跳过: allSkipped.slice(0, 20),
        跳过数: allSkipped.length,
        施工秒: r.秒,
    });
}

function normalizeRegion(args) {
    const v = ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].map((k) => Math.round(Number(args?.[k])));
    if (v.some((n) => !Number.isFinite(n))) return null;
    const [x1, y1, z1, x2, y2, z2] = v;
    return {
        xs: [Math.max(0, Math.min(x1, x2)), Math.min(WORLD_WIDTH - 1, Math.max(x1, x2))],
        ys: [Math.max(0, Math.min(y1, y2)), Math.min(WORLD_HEIGHT - 1, Math.max(y1, y2))],
        zs: [Math.max(0, Math.min(z1, z2)), Math.min(WORLD_DEPTH - 1, Math.max(z1, z2))],
    };
}

async function toolClearArea(args = {}) {
    const r = normalizeRegion(args);
    if (!r) return '错误：需要 x1,y1,z1,x2,y2,z2';
    const volume = (r.xs[1] - r.xs[0] + 1) * (r.ys[1] - r.ys[0] + 1) * (r.zs[1] - r.zs[0] + 1);
    if (volume > 32768) return `错误：区域过大（${volume} 格），上限 32768，请拆分`;
    const ops = [];
    for (let x = r.xs[0]; x <= r.xs[1]; x++) {
        for (let z = r.zs[0]; z <= r.zs[1]; z++) {
            for (let y = r.ys[0]; y <= r.ys[1]; y++) {
                const cur = getBlock(x, y, z);
                if (cur === BlockTypes.AIR || cur === BlockTypes.BEDROCK) continue;
                ops.push([x, y, z, BlockTypes.AIR]);
            }
        }
    }
    notifyBuildStart('clear_area');
    const res = await enqueueBuildOps('clear_area', ops);
    return JSON.stringify({
        已清除: res.applied,
        区域: 'x:' + r.xs.join('~') + ' y:' + r.ys.join('~') + ' z:' + r.zs.join('~'),
        施工秒: res.秒,
    });
}

function toolReadBlocks(args = {}) {
    const r = normalizeRegion(args);
    if (!r) return '错误：需要 x1,y1,z1,x2,y2,z2';
    const volume = (r.xs[1] - r.xs[0] + 1) * (r.ys[1] - r.ys[0] + 1) * (r.zs[1] - r.zs[0] + 1);
    const counts = {};
    const sparse = [];
    for (let x = r.xs[0]; x <= r.xs[1]; x++) {
        for (let z = r.zs[0]; z <= r.zs[1]; z++) {
            for (let y = r.ys[0]; y <= r.ys[1]; y++) {
                const bt = getBlock(x, y, z);
                if (bt === BlockTypes.AIR) continue;
                counts[nameOf(bt)] = (counts[nameOf(bt)] || 0) + 1;
                if (volume <= 4096) sparse.push(`${x},${y},${z}=${bt}`);
            }
        }
    }
    if (volume <= 4096) {
        return JSON.stringify({ 非空方块: sparse, 统计: counts });
    }
    return JSON.stringify({ 说明: '区域大于 4096 格，仅返回统计', 统计: counts });
}

async function toolRunBuildScript({ code } = {}) {
    if (typeof code !== 'string' || !code.trim()) return '错误：需要 code 参数（JS 代码）';
    const logs = [];
    const ops = [];
    let opsCount = 0;
    const OPS_LIMIT = 40000;
    // 动力组不在 BlockTypes 里（状态编码方块，同红石/活塞组惯例），
    // 暴露基址 + 各向变体：轴类 +axis(0..2)，机械锯 +facing(0..5)
    const BT = {
        ...BlockTypes,
        SHAFT: SHAFT_ITEM_ID, COGWHEEL: COGWHEEL_ITEM_ID, WATERWHEEL: WATERWHEEL_ITEM_ID,
        CRUSHER: CRUSHER_ITEM_ID, SAW: SAW_ITEM_ID,
        SHAFT_BASE, COGWHEEL_BASE, WATERWHEEL_BASE, CRUSHER_BASE, SAW_BASE,
    };

    function guard() {
        if (++opsCount > OPS_LIMIT) throw new Error(`超出单次写入上限 ${OPS_LIMIT} 格，请拆分多次调用`);
    }
    // 注意：脚本先同步执行完（生成操作清单），方块随后才按施工速度渐进放置，
    // 因此 ground() 读到的是施工前地形——请在生成方块前先取好锚点。
    const api = {
        BT,
        WORLD: { W: WORLD_WIDTH, D: WORLD_DEPTH, H: WORLD_HEIGHT },
        player: { x: Math.round(state.player.x), y: Math.round(state.player.y), z: Math.round(state.player.z), yaw: state.player.yaw },
        ground(x, z) { return groundY(Math.round(x), Math.round(z)); },
        block(x, y, z, t) {
            guard();
            x = Math.round(x); y = Math.round(y); z = Math.round(z);
            if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) return;
            if (BlockInfo[t] === undefined) throw new Error(`未知方块 ID：${t}`);
            ops.push([x, y, z, t]);
        },
        fill(x1, y1, z1, x2, y2, z2, t) {
            const [ax, bx2] = [Math.min(x1, x2), Math.max(x1, x2)];
            const [ay, by2] = [Math.min(y1, y2), Math.max(y1, y2)];
            const [az, bz2] = [Math.min(z1, z2), Math.max(z1, z2)];
            if ((bx2 - ax + 1) * (by2 - ay + 1) * (bz2 - az + 1) > OPS_LIMIT) throw new Error('fill 区域过大');
            for (let x = Math.round(ax); x <= Math.round(bx2); x++) {
                for (let y = Math.round(ay); y <= Math.round(by2); y++) {
                    for (let z = Math.round(az); z <= Math.round(bz2); z++) api.block(x, y, z, t);
                }
            }
        },
        clearArea(x1, y1, z1, x2, y2, z2) {
            const [ax, bx2] = [Math.min(x1, x2), Math.max(x1, x2)];
            const [ay, by2] = [Math.min(y1, y2), Math.max(y1, y2)];
            const [az, bz2] = [Math.min(z1, z2), Math.max(z1, z2)];
            for (let x = Math.round(ax); x <= Math.round(bx2); x++) {
                for (let y = Math.round(ay); y <= Math.round(by2); y++) {
                    for (let z = Math.round(az); z <= Math.round(bz2); z++) {
                        guard();
                        if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) continue;
                        if (getBlock(x, y, z) === BlockTypes.BEDROCK) continue;
                        ops.push([x, y, z, BlockTypes.AIR]);
                    }
                }
            }
        },
        log(msg) {
            if (logs.length < 50) logs.push(truncateStr(msg, 200));
        },
    };

    let error = null;
    try {
        new Function('api', '"use strict";\n' + code)(api);
    } catch (e) {
        error = e.message + (e.stack ? '\n' + String(e.stack).split('\n').slice(0, 3).join('\n') : '');
    }
    notifyBuildStart('build_script');
    const r = await enqueueBuildOps('build_script', ops);
    return JSON.stringify({
        写入格数: Math.min(r.applied, OPS_LIMIT),
        日志: logs,
        错误: error,
        施工秒: r.秒,
        说明: '方块已按当前施工速度渐进放置完毕',
    }, null, 1);
}

// ---------- 施工速度 ----------
function toolSetBuildSpeed({ speed } = {}) {
    const labels = BUILD_SPEED_LEVELS.map((lv) => lv.label);
    // 参数支持档位名（延时/慢速/…）或每秒格数（如 30，自动匹配最接近的档）
    const byName = BUILD_SPEED_LEVELS.findIndex((lv) => lv.label === speed);
    const n = Number(speed);
    if (byName >= 0) {
        setBuildSpeedIdx(byName);
    } else if (Number.isFinite(n) && n > 0) {
        setBuildSpeedByBps(n);
    } else {
        return `错误：speed 需为档位名（${labels.join('/')}）或每秒格数（如 30）`;
    }
    return JSON.stringify({
        已设置: speedText(),
        当前任务: getBuildStatus(),
        提示: '施工进行中也可随时调速；玩家可用 [ ] 键调速、P 键暂停、R 键录制游戏画面（存为 webm）',
    });
}

// ---------- 文件类工具实现 ----------

async function fileApiFetch(path, options) {
    let resp;
    try {
        resp = await fetch(path, options);
    } catch {
        throw new Error(fileApiHint());
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `接口 ${resp.status}`);
    return data;
}

async function toolListFiles() {
    if (!fileApiOnline) return fileApiHint();
    const data = await fileApiFetch('/api/files');
    return data.files.map((f) => `${f.path} (${f.size}B)`).join('\n');
}

async function toolReadFile({ path } = {}) {
    if (!fileApiOnline) return fileApiHint();
    if (!path) return '错误：需要 path 参数';
    const data = await fileApiFetch('/api/file?path=' + encodeURIComponent(path));
    return truncateStr(data.content, 60000);
}

async function toolWriteFile({ path, content } = {}) {
    if (!fileApiOnline) return fileApiHint();
    if (!path || typeof content !== 'string') return '错误：需要 path 与 content 参数';
    const data = await fileApiFetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
    });
    return JSON.stringify({
        ok: true,
        文件: data.path,
        字节: data.bytes,
        原文件备份: data.backup || '（原文件不存在，新建）',
        下一步: '所有文件改完后调用一次 reload_game 生效',
    });
}

function toolReloadGame() {
    const ok = saveSnapshotForReload();
    sessionStorage.setItem('mcAssistant.resumeTask', JSON.stringify({ sessionId: getActiveSessionId(), at: Date.now() }));
    setTimeout(() => location.reload(), 700);
    return ok
        ? '世界快照已保存，页面即将热重载（约 1 秒）。重载完成后世界与玩家状态自动恢复，本会话自动继续。'
        : '快照保存失败，仍将重载页面（世界会被重新生成）。';
}

function toolRuntimeErrors() {
    let errs = [];
    try {
        errs = JSON.parse(sessionStorage.getItem(RUNTIME_ERR_KEY)) || [];
    } catch { errs = []; }
    if (errs.length === 0) return '自页面加载以来没有记录到任何运行时错误（不代表逻辑正确，只代表无异常抛出/console.error）。';
    return errs.map((e) => `[${new Date(e.time).toLocaleTimeString()}] ${e.message}${e.source ? ' @ ' + e.source : ''}`).join('\n');
}

// ---------- 工具注册表 ----------

export function getToolSchemas() {
    const fn = (name, description, parameters) => ({ type: 'function', function: { name, description, parameters } });
    const int = { type: 'integer' };
    return [
        fn('get_game_context', '获取当前游戏状态：玩家位置/朝向/模式/生命、前方10格锚点、时间、怪物数。建造前先调用。', { type: 'object', properties: {} }),
        fn('scan_terrain', '扫描 (x,z) 附近 5×5 网格的地表高度与表面方块，用于选址与整平规划。', {
            type: 'object',
            properties: { x: int, z: int, radius: { type: 'integer', description: '采样半径，默认 10' } },
            required: ['x', 'z'],
        }),
        fn('place_blocks', '批量精确放置方块（渐进施工：按当前施工速度逐格出现，工具等放完才返回）。blocks 为 [[x,y,z,方块ID], …]，单次 ≤4000 格；y 需 ≥1（0 是基岩层）；实心方块不会放进玩家身体。', {
            type: 'object',
            properties: { blocks: { type: 'array', items: { type: 'array', items: { type: 'integer' } } } },
            required: ['blocks'],
        }),
        fn('clear_area', '把长方体区域清成空气（基岩除外），上限 32768 格。用于清场/拆建筑。渐进施工，等清完才返回。', {
            type: 'object',
            properties: {
                x1: int, y1: int, z1: int, x2: int, y2: int, z2: int,
            },
            required: ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'],
        }),
        fn('read_blocks', '读取长方体区域内容：≤4096 格返回逐块清单，否则只返回方块统计。用于校验建造结果。', {
            type: 'object',
            properties: { x1: int, y1: int, z1: int, x2: int, y2: int, z2: int },
            required: ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'],
        }),
        fn('run_build_script', '执行一段 JS 建造代码（推荐用于房屋等重复结构）。代码以 api 为参数：api.BT 方块ID表、api.block(x,y,z,t)、api.fill(x1,y1,z1,x2,y2,z2,t)、api.clearArea(...)、api.ground(x,z)、api.player{x,y,z,yaw}、api.WORLD、api.log(msg)。代码先执行完再按施工速度渐进放置，故 ground() 读到施工前地形，请先取好锚点。总写入 ≤4 万格。', {
            type: 'object',
            properties: { code: { type: 'string' } },
            required: ['code'],
        }),
        fn('set_build_speed', '设置施工速度（AI 建造是渐进放置，用户可能会录制建造过程）。档位：延时(20格/秒)、慢速(80)、中速(300)、快速(1200)、极速(6000)、瞬间。用户想录建造过程/延时摄影时，先调到延时或慢速再开始建造，结束后可调回极速。也可直接给每秒格数（如 30），自动匹配最接近档位。', {
            type: 'object',
            properties: { speed: { type: 'string', description: '档位名（延时/慢速/中速/快速/极速/瞬间）或每秒格数' } },
            required: ['speed'],
        }),
        fn('list_game_files', '列出项目全部源码文件（路径+大小）。', { type: 'object', properties: {} }),
        fn('read_game_file', '读取项目文件内容。修改前必须先读取最新内容。', {
            type: 'object',
            properties: { path: { type: 'string', description: '相对路径，如 js/config.js' } },
            required: ['path'],
        }),
        fn('write_game_file', '【整文件覆盖】写入项目文件（原文件自动备份到 assistant_backups/）。必须先 read_game_file 再做最小修改。所有文件写完后调用一次 reload_game。', {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
        }),
        fn('reload_game', '保存世界快照并热重载页面，使源码修改生效；重载后世界与玩家状态自动恢复、本会话自动继续。', { type: 'object', properties: {} }),
        fn('get_runtime_errors', '读取页面自加载以来的运行时错误（window.onerror/console.error）。热重载后用来检查修改有没有引入错误。', { type: 'object', properties: {} }),
    ];
}

// 执行入口：返回 {result, isError}
export async function executeTool(name, args) {
    try {
        let result;
        switch (name) {
            case 'get_game_context': result = toolGetGameContext(); break;
            case 'scan_terrain': result = toolScanTerrain(args); break;
            case 'place_blocks': result = await toolPlaceBlocks(args); break;
            case 'clear_area': result = await toolClearArea(args); break;
            case 'read_blocks': result = toolReadBlocks(args); break;
            case 'run_build_script': result = await toolRunBuildScript(args); break;
            case 'set_build_speed': result = toolSetBuildSpeed(args); break;
            case 'list_game_files': result = await toolListFiles(); break;
            case 'read_game_file': result = await toolReadFile(args); break;
            case 'write_game_file': result = await toolWriteFile(args); break;
            case 'reload_game': result = toolReloadGame(); break;
            case 'get_runtime_errors': result = toolRuntimeErrors(); break;
            default: return { result: `未知工具：${name}`, isError: true };
        }
        return { result: truncateStr(result, 30000), isError: false };
    } catch (e) {
        return { result: `工具执行出错：${e.message}`, isError: true };
    }
}
