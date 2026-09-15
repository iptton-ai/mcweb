// ==================== assistant/tools.js ====================
// AI 助手工具集：
//   世界类：get_game_context / scan_terrain / place_blocks / clear_area / read_blocks / run_build_script / set_build_speed
//   关卡类（P3 AI 三角色）：check_level / gen_level_draft（关卡工坊，见 docs/edu-workshop-impl-contract.md §6）
//   文件类：list_game_files / read_game_file / write_game_file / reload_game / get_runtime_errors
// 全部返回字符串（通常是 JSON），直接作为 tool 消息回传给 LLM。
// 建造类工具经 buildQueue 渐进放置（可调速/暂停，便于录制延时摄影），
// 工具会等施工任务全部应用完才返回结果，LLM 的「放置→校验」流程不受影响。

import { BlockInfo, BlockTypes, BUILD_SPEED_LEVELS, CHUNK_SIZE, COGWHEEL_BASE, COGWHEEL_ITEM_ID, CRUSHER_BASE, CRUSHER_ITEM_ID, doorId, flagId, HotbarBlocks, keypadId, SAW_BASE, SAW_ITEM_ID, SHAFT_BASE, SHAFT_ITEM_ID, WATERWHEEL_BASE, WATERWHEEL_ITEM_ID, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from '../config.js';
import { normalizeBank, sanitizeManifest } from '../eduKeypad.js'; // 题库归一化（纯函数，gen_level_draft 抽题用）
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

// ---------- 关卡草稿纯函数区（gen_level_draft 用；Node 可直接提取测试，禁引浏览器全局） ----------

// >>> DRAFT-PURE-BEGIN
// （无 window/document/state/fetch 依赖：tools/test_gen_draft.mjs 按区间切片 eval；
//   改动请保持区间内零外部引用，export 关键字照常写——测试侧会剥掉）

// 格子坐标 → 稳定哈希（无符号 32 位）。算法与 eduKeypad.hashCell 同族（imul 三轮+末位折叠），
// 盐独立（0x811c9dc5 起），与 M1 抽题互不干扰；不混世界种子=跨世界同格同题，草稿语义更稳定。
function draftHash(x, y, z) {
    let h = 0x811c9dc5;
    h = Math.imul(h ^ (x | 0), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (y | 0), 0xc2b2ae35) >>> 0;
    h = Math.imul(h ^ (z | 0), 0x27d4eb2f) >>> 0;
    h ^= h >>> 15;
    return h >>> 0; // 末位折叠可能出负 int32，归一回无符号再取模（M1 踩过的负下标坑）
}

// 确定性抽 count 道不重复题：从 hash(x,y,z) 决定的起点、固定步长环形扫描题池
// （步长与池长不互质会提前绕圈，末尾顺序补扫兜底凑满）；返回按选取顺序的题对象数组。
// 池空 / 计数非法 / 计数超过池长 → 返回实际能给出的数量（降级语义，调用方负责向用户说明）。
export function pickDraftQuestions(items, x, y, z, count = 1) {
    const pool = Array.isArray(items) ? items.filter(Boolean) : [];
    const n = pool.length;
    const want = Math.min(Math.max(0, Math.floor(Number(count) || 0)), n);
    if (!n || want <= 0) return [];
    const h = draftHash(x, y, z);
    const start = h % n;
    const stride = 1 + ((h >>> 16) % (n > 1 ? n - 1 : 1)); // 1..n-1，步长非 0 防原地踏步
    const out = [];
    const seen = new Set();
    for (let pass = 0; pass < 2 && out.length < want; pass++) {
        for (let i = 0; i < n && out.length < want; i++) {
            const idx = pass === 0 ? (start + i * stride) % n : i; // 第二遍顺序补扫
            if (seen.has(idx)) continue;
            seen.add(idx);
            out.push(pool[idx]);
        }
    }
    return out;
}

// 题库条目（eduKeypad.normalizeBank 归一后）→ 关卡卡题级 schema（契约 §2）：
// kind 在题级下沉（input/choice 与题库同名）、q→stem、a→answer，meta 标注来源为题库。
// 注意：answer 只进卡数据，任何对话回复都不得引用（AI 不代答红线）。
export function bankItemToCardQuestion(item, subject) {
    const kind = item && item.kind === 'choice' ? 'choice' : 'input';
    const q = {
        subject,
        kind,
        stem: String((item && item.q) || ''),
        answer: (item && item.a) | 0,
        meta: { source: 'bank' },
    };
    if (kind === 'choice' && Array.isArray(item.options)) q.options = item.options.slice();
    if (item && item.hint) q.hint = item.hint;
    if (item && item.unit) q.unit = item.unit;
    return q;
}
// <<< DRAFT-PURE-END

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

// ---------- 关卡工坊工具（P3 AI 三角色；接口契约 docs/edu-workshop-impl-contract.md §3.1/§6）----------

const DRAFT_SUBJECT_NAMES = { math: '数学', science: '科学', daofa: '道法', yuwen: '语文' };

// levelWorkshop.js 由并行批次（A1）提供：动态 import + 可选链，模块未就绪时给明确文案而不是抛错
async function loadLevelWorkshop() {
    try {
        const lw = await import('../levelWorkshop.js');
        if (lw && typeof lw.buildLevelCard === 'function') return lw;
    } catch { /* 模块尚未落地/加载失败 */ }
    return null;
}

// 警告文案 → 面向孩子的改进建议（关键词映射；未命中原样透出，让 LLM 复述）
function adviseWarning(w) {
    const t = String(w);
    if (/双通过|verified/.test(t)) return `${t} → 建议：手持出题笔右键这把锁，连续答对 2 次完成校验`;
    if (/可达|reach/.test(t)) return `${t} → 建议：检查门与通道走向，保证从起点旗能一路走到每把锁和终点旗`;
    if (/选项/.test(t)) return `${t} → 建议：选项不能互相重复，正确答案也不能与干扰项相同（出题笔面板里改）`;
    if (/9999|范围|答案/.test(t)) return `${t} → 建议：数字题答案需在 0..9999（四位输入上限）`;
    if (/门/.test(t)) return `${t} → 建议：把答题机贴着门放（答对直接开门），或接红石粉远程开锁——答对了要有可见效果`;
    if (/旗|起点|终点/.test(t)) return `${t} → 建议：从物品栏拿关卡旗补上（起点旗=出生点、终点旗=通关）`;
    return `${t} → 建议：按提示修好后，可以再叫我检查一次`;
}

// 可读检查报告。红线：只列 学科/题型/题干预览/位置，绝不输出 answer 字段（答案只活在卡数据里）
function formatLevelReport(card, v, lw, sourceLabel) {
    const lines = [];
    const qs = Array.isArray(card.questions) ? card.questions : [];
    const flags = card.flags || {};
    const cps = Array.isArray(flags.checkpoints) ? flags.checkpoints : [];
    const r = card.region;
    lines.push(`📋 关卡检查（${sourceLabel}）：「${card.name || '未命名'}」 作者：${card.author || '—'}`);
    if (r) lines.push(`区域：${r.w}×${r.h}×${r.d}（上限 96×64×96）`);
    lines.push(`锁（${qs.length} 把）：`);
    qs.forEach((q, i) => {
        const kindText = q.kind === 'input' ? '数字输入' : '选择题';
        lines.push(` ${i + 1}. (${q.x},${q.y},${q.z}) ${DRAFT_SUBJECT_NAMES[q.subject] || q.subject}·${kindText}「${truncateStr(String(q.stem || ''), 30)}」${q.unit ? `［${q.unit}］` : ''}`);
    });
    if (!qs.length) lines.push(' （还没有锁：放答题机、用出题笔出题，孩子才有门可开）');
    lines.push(`旗组：起点 ${flags.start ? '✓' : '✗ 缺'} · 检查点 ×${cps.length} · 终点 ${flags.goal ? '✓' : '✗ 缺'}`);
    // 考核锁状态（rules.lockAIHelp=false ⇒ 考核锁：闯关者向 AI 要提示时被拒绝）
    lines.push(card.rules && card.rules.lockAIHelp === false
        ? '考核锁：已开启——挑战这关时 AI 不提供任何提示'
        : '考核锁：未开启——挑战时可以向 AI 要梯度提示');
    try {
        const reach = lw.reachabilityBFS && lw.reachabilityBFS(card);
        if (reach) lines.push(`可达性：${reach.reachable ? '起点 → 全部锁与终点旗 联通 ✓' : '存在走不到的锁或终点旗 ✗（见警告）'}`);
    } catch { /* BFS 异常不阻塞报告 */ }
    const errors = (v && Array.isArray(v.errors)) ? v.errors : [];
    const warnings = (v && Array.isArray(v.warnings)) ? v.warnings : [];
    if (errors.length) {
        lines.push(`❌ 错误（${errors.length} 条，必须修复才能导出）：`);
        errors.forEach((e, i) => lines.push(` ${i + 1}. ${e}`));
    }
    if (warnings.length) {
        lines.push(`⚠️ 警告（${warnings.length} 条）：`);
        warnings.forEach((w) => lines.push(` - ${adviseWarning(w)}`));
    }
    lines.push(errors.length
        ? `结论：先修复上面 ${errors.length} 个错误，再试玩/导出。`
        : (warnings.length ? '结论：没有硬错误，可以试玩；按警告打磨后即可导出分享。' : '结论：检查全部通过，可以放心试玩与导出。'));
    return lines.join('\n');
}

// check_level（出题协作者）：当前世界锚点区域（或指定 id 的已存卡）→ 体检报告
async function toolCheckLevel({ cardId } = {}) {
    const lw = await loadLevelWorkshop();
    if (!lw) return '关卡工坊模块（js/levelWorkshop.js）尚未就绪，请刷新页面后重试。';

    // 指定 id：检查 IndexedDB/会话里已保存的关卡卡
    if (cardId) {
        const card = await lw.getLevelCard(String(cardId)).catch(() => null);
        if (!card) {
            let names = '';
            try {
                const list = (typeof lw.listLevelCards === 'function') ? await lw.listLevelCards() : [];
                names = list.map((c) => `${c.name}(${c.id})`).slice(0, 10).join('、');
            } catch { /* 列表不可用则忽略 */ }
            return `错误：找不到关卡卡 ${cardId}${names ? `。本机现有：${names}` : '（本机还没有已保存的关卡卡）'}`;
        }
        return formatLevelReport(card, lw.validateLevelCard(card), lw, '已存卡');
    }

    // 默认：把当前世界的锚点区域打包成草稿卡体检（draft=true：锁未双通过降为警告）
    const region = typeof lw.computeAutoRegion === 'function' ? lw.computeAutoRegion() : null;
    if (!region) {
        return '当前附近没有找到任何关卡锚点。想让我检查关卡，请先摆好：起点旗/终点旗（物品栏「关卡旗」）和至少一把锁（答题机），再用出题笔给锁出题，然后叫我检查。';
    }
    const card = await lw.buildLevelCard({ name: '当前区域检查', author: 'AI', draft: true });
    if (!card || card.error) {
        const why = (card && card.error) || '无法从当前区域生成关卡卡';
        return `错误：${why}。若提示超出上限（96×64×96），把旗子和锁摆紧凑些再试。`;
    }
    return formatLevelReport(card, lw.validateLevelCard(card), lw, '当前世界');
}

// 题池：fetch 清单 + 学科文件 → sanitizeManifest/normalizeBank 归一 →（可选）unit 精确过滤
async function loadDraftPool(subject, unit) {
    let manifest = null;
    try {
        const resp = await fetch('assets/edu/banks.json');
        if (resp.ok) manifest = sanitizeManifest(await resp.json());
    } catch { /* 走下方报错 */ }
    if (!manifest) return { error: '题库清单 assets/edu/banks.json 缺失或损坏，无法抽题' };
    const entry = manifest.find((e) => e.subject === subject);
    if (!entry) return { error: `题库清单里没有学科 ${subject}（现有：${manifest.map((e) => e.subject).join('/')}）` };
    let data = null;
    try {
        const resp = await fetch('assets/edu/' + entry.file);
        if (resp.ok) data = await resp.json();
    } catch { /* 走下方报错 */ }
    const norm = normalizeBank(data);
    if (!norm || norm.subject !== subject) return { error: `题库文件 assets/edu/${entry.file} 缺失、损坏或格式不合，无法抽题` };
    let items = [];
    for (const b of norm.banks) items.push(...b.items);
    if (unit) {
        const u = String(unit).trim();
        const hit = items.filter((it) => String((it && it.unit) || '').trim() === u);
        if (!hit.length) {
            const units = [...new Set(items.map((it) => String((it && it.unit) || '').trim()).filter(Boolean))];
            return { error: `学科「${entry.name}」里没有单元「${u}」的题（该学科共 ${items.length} 题可抽）。可用单元如：${units.slice(0, 5).join('、')}${units.length > 5 ? '…' : ''}` };
        }
        items = hit;
    }
    if (!items.length) return { error: `学科「${entry.name}」题池为空，无法抽题` };
    return { items, entry };
}

// 选址探测：dims.w×dims.d 地块逐 4 格采样地表，高差 ≤2 且无水面才算平地
function probeFlat(site, w, d) {
    let minY = Infinity, maxY = -Infinity;
    for (let dx = 0; dx < w; dx += 4) {
        for (let dz = 0; dz < d; dz += 4) {
            const gy = groundY(site.x0 + dx, site.z0 + dz);
            if (gy < 1) return null;
            if (getBlock(site.x0 + dx, gy + 1, site.z0 + dz) === BlockTypes.WATER) return null; // 湖面不算平地
            minY = Math.min(minY, gy);
            maxY = Math.max(maxY, gy);
        }
    }
    return maxY - minY <= 2 ? { refY: maxY } : null;
}

function clampSite(x, z, w, d) {
    return {
        x0: Math.max(0, Math.min(Math.round(x), WORLD_WIDTH - w)),
        z0: Math.max(0, Math.min(Math.round(z), WORLD_DEPTH - d)),
    };
}

// 选址：沿玩家朝向 ~20 格起步，正前/更远/左右横移/身后逐个候选；全不平整则退回架空平台
function findDraftSite(w, d) {
    const p = state.player;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const cands = [
        [p.x + fx * 20, p.z + fz * 20],
        [p.x + fx * 28, p.z + fz * 28],
        [p.x + fx * 20 - fz * 12, p.z + fz * 20 + fx * 12],
        [p.x + fx * 20 + fz * 12, p.z + fz * 20 - fx * 12],
        [p.x - fx * 24, p.z - fz * 24],
    ];
    for (const [cx, cz] of cands) {
        const site = clampSite(cx, cz, w, d);
        const flat = probeFlat(site, w, d);
        if (flat) return { site, refY: flat.refY, floating: false };
    }
    // 兜底：玩家头顶架空平台（平台面=施工基准面，任何地形都能出图）
    const gy = groundY(Math.round(p.x), Math.round(p.z));
    const refY = Math.max(2, Math.min(Math.max(gy, Math.round(p.y)) + 8, WORLD_HEIGHT - 10));
    return { site: clampSite(p.x + fx * 20, p.z + fz * 20, w, d), refY, floating: true };
}

// 三模板 buildOps。返回 { ops, keypads, layoutText }：keypads=各锁答题机世界坐标（按解题顺序）。
// 方块只用既有建材（石头/圆石/木板/火把）+ 旗组 + 答题机 + 门；答题机嵌在门旁墙柱底
// （实心方块防绕行，6 邻贴门=答对常供能直接开门，M1 语义），不布红石粉，保持草稿最简。
function buildDraftStructure(style, n, site, refY, floating, dims) {
    const ops = [];
    const seen = new Set(); // 同格去重（共享墙/先门后墙的重复写入只保留第一笔）
    const keypads = [];
    const COB = BlockTypes.COBBLESTONE, PLANK = BlockTypes.PLANKS, STONE = BlockTypes.STONE, TORCH = BlockTypes.TORCH;

    const put = (x, y, z, t) => {
        x = Math.round(x); y = Math.round(y); z = Math.round(z);
        if (x < 0 || x >= WORLD_WIDTH || y < 1 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) return;
        const k = `${x},${y},${z}`;
        if (seen.has(k)) return;
        seen.add(k);
        ops.push([x, y, z, t]);
    };
    // 把 (x,z) 列垫到基准面：自然地形补坑到 refY；架空模式只造支撑柱（板面另行铺设）
    const level = (x, z) => {
        const gy = groundY(x, z);
        if (gy < 0) return;
        const top = floating ? refY - 1 : refY;
        for (let y = gy + 1; y <= top; y++) put(x, y, z, COB);
    };
    if (floating) { // 头顶架空平台：木板面（配合 level() 的支撑柱，任何地形都能出图）
        for (let x = site.x0; x < site.x0 + dims.w; x++) {
            for (let z = site.z0; z < site.z0 + dims.d; z++) put(x, refY, z, PLANK);
        }
    }
    const flag = (x, z, kind) => { level(x, z); put(x, refY + 1, z, flagId(kind)); };
    const torch = (x, z) => { level(x, z); put(x, refY + 1, z, TORCH); };
    // 锁门组：跨 [a,b] 的一道 3 高墙（passage='x'=沿 X 通行、墙跨 Z 轴 a..b），门洞在 (gx,gz)，
    // 门旁（-1 侧，出 span 退 +1 侧）嵌答题机，柱顶火把示位。先于房间墙调用时靠去重集自动让位。
    const gate = (gx, gz, passage, a, b) => {
        const facing = passage === 'x' ? 1 : 2; // 门板朝通行来向（东/南）
        // 答题机格：门旁 -1 侧优先（出 span 或已被先前结构占用则换 +1 侧）
        const cands = [];
        for (const s of [-1, 1]) {
            const cx = passage === 'x' ? gx : gx + s;
            const cz = passage === 'x' ? gz + s : gz;
            const inSpan = passage === 'x' ? (cz >= a && cz <= b) : (cx >= a && cx <= b);
            if (inSpan) cands.push(passage === 'x' ? { x: gx, z: cz } : { x: cx, z: gz });
        }
        const kc = cands.find((c) => !seen.has(`${c.x},${refY + 1},${c.z}`)) || cands[0];
        const kx = kc.x, kz = kc.z;
        for (let w = a; w <= b; w++) {
            const x = passage === 'x' ? gx : w;
            const z = passage === 'x' ? w : gz;
            if ((x === gx && z === gz) || (x === kx && z === kz)) continue; // 门洞与答题机格另行处理
            level(x, z);
            put(x, refY + 1, z, COB); put(x, refY + 2, z, COB); put(x, refY + 3, z, COB);
        }
        level(gx, gz);
        put(gx, refY + 1, gz, doorId(0, 0, facing)); // 下半门（关）
        put(gx, refY + 2, gz, doorId(1, 0, facing)); // 上半门
        put(gx, refY + 3, gz, COB); // 楣
        level(kx, kz);
        put(kx, refY + 1, kz, keypadId(0)); // 答题机嵌墙底：贴门=答对直接开门，实心=防绕行
        put(kx, refY + 2, kz, COB); put(kx, refY + 3, kz, COB);
        put(kx, refY + 4, kz, TORCH);
        keypads.push({ x: kx, y: refY + 1, z: kz });
    };

    if (style === '跑酷') {
        const x0 = site.x0, zc = site.z0 + 5;
        const fA = zc - 3, fB = zc + 3; // 栅栏墙横跨关卡区域全宽（=锚点包围盒+2），防绕行
        flag(x0 + 1, zc, 0); // 起点旗
        for (let i = 0; i < 3; i++) { // 3 段跳台：2×2 石台、空隙 2 格（台面仅高 1，跳得上）
            const px = x0 + 3 + i * 4;
            for (let ax = 0; ax < 2; ax++) {
                for (let az = 0; az < 2; az++) {
                    level(px + ax, zc + az);
                    put(px + ax, refY + 1, zc + az, STONE);
                }
            }
        }
        const g0 = x0 + 15;
        for (let i = 0; i < n; i++) {
            const gx = g0 + i * 4;
            gate(gx, zc, 'x', fA, fB);
            if (i < n - 1) flag(gx + 2, zc, 1); // 锁间检查点旗
        }
        flag(g0 + n * 4 + 1, zc, 2); // 终点旗
        return { ops, keypads, layoutText: `起点旗→3 段跳台（间隔 2 格）→${n} 道答题机锁门（栅栏全宽防绕行）→终点旗${n > 1 ? '，锁间设检查点旗' : ''}` };
    }

    if (style === '地牢') {
        const x0 = site.x0 + 2, z0 = site.z0 + 2;
        const roomOrigin = (k) => { // 蛇形排房：每行最多 3 间（7×7、间距 6=共用单墙），行内方向交替
            const row = Math.floor(k / 3);
            const col = row % 2 === 0 ? k % 3 : 2 - (k % 3);
            return { x: x0 + col * 6, z: z0 + row * 6 };
        };
        const rooms = [];
        for (let k = 0; k < n; k++) rooms.push(roomOrigin(k));
        flag(rooms[0].x - 2, rooms[0].z + 3, 0); // 起点旗（入口门外；卡校验要求起点存在）
        // 先放门锁（占用门洞/答题机格），再砌房墙——去重集保证墙给门让位
        for (let k = 0; k < n; k++) {
            if (k === 0) {
                gate(rooms[0].x, rooms[0].z + 3, 'x', rooms[0].z + 1, rooms[0].z + 5); // 西墙入口
            } else if (rooms[k].z === rooms[k - 1].z) {
                gate(Math.max(rooms[k].x, rooms[k - 1].x), rooms[k].z + 3, 'x', rooms[k].z + 1, rooms[k].z + 5); // 同排共用墙列
            } else {
                gate(rooms[k].x + 3, Math.max(rooms[k].z, rooms[k - 1].z), 'z', rooms[k].x + 1, rooms[k].x + 5); // 换排共用墙行
            }
        }
        for (const r of rooms) { // 7×7 外墙 3 高 + 封顶（室内黑暗，靠火把照明）
            for (let i = 0; i < 7; i++) {
                for (const [wx, wz] of [[r.x + i, r.z], [r.x + i, r.z + 6], [r.x, r.z + i], [r.x + 6, r.z + i]]) {
                    level(wx, wz);
                    put(wx, refY + 1, wz, COB); put(wx, refY + 2, wz, COB); put(wx, refY + 3, wz, COB);
                    put(wx, refY + 4, wz, PLANK);
                }
            }
            torch(r.x + 1, r.z + 1); // 室内角火把
        }
        if (n >= 4) flag(rooms[2].x + 5, rooms[2].z + 1, 1); // 远角检查点：顺带把区域拉到东墙（W18 锚点包围盒）
        const last = rooms[n - 1];
        flag(last.x + 5, last.z + 5, 2); // 宝物位=终点旗（远角，顺带把区域拉满最后一间）
        torch(last.x + 4, last.z + 5);
        return { ops, keypads, layoutText: `${n} 间 7×7 圆石密室蛇形串联（入口+逐室锁门），尽头宝物位=终点旗+火把` };
    }

    // 寻宝：L 形 2 宽走廊（先 +X 再 +Z）。显式分区几何，避免两腿侧墙在转角互侵：
    //   第一腿走廊 x∈[x0+1,x0+10]×z∈{zc,zc+1}（入口开在 x0 列）；转角区 x∈{x0+11,x0+12}×z∈{zc..zc+1}；
    //   第二腿走廊 x∈{x0+11,x0+12}×z∈[zc+2,zc+12]。墙（2 高，站走廊地面跳不上）：
    //   上 z=zc-1（x0..x0+13）/ 右 x=x0+13（zc..zc+13）/ 下 z=zc+13（x0+10..x0+13）/
    //   第二腿左 x=x0+10（zc+2..zc+13）/ 第一腿下 z=zc+2（x0..x0+10）。
    const x0 = site.x0 + 2, zc = site.z0 + 4;
    const L1 = 10, TLEN = 23; // 第一腿路径长 / 全程路径长（格）
    const pathPos = (t) => {
        if (t <= L1 - 1) return { x: x0 + 1 + t, z: zc, passage: 'x' };
        if (t <= L1 + 1) return { x: x0 + 1 + t, z: zc, passage: 'x' }; // 转角上排（x0+11..12）
        return { x: x0 + 12, z: zc + (t - L1 - 1), passage: 'z' };     // 转角下排起沿 Z 下行
    };
    flag(x0 + 1, zc, 0); // 起点旗（卡校验要求起点存在）
    for (let x = x0; x <= x0 + 13; x++) { level(x, zc - 1); put(x, refY + 1, zc - 1, COB); put(x, refY + 2, zc - 1, COB); } // 上墙
    for (let x = x0; x <= x0 + 10; x++) { level(x, zc + 2); put(x, refY + 1, zc + 2, COB); put(x, refY + 2, zc + 2, COB); } // 第一腿下墙
    for (let z = zc + 2; z <= zc + 13; z++) { level(x0 + 10, z); put(x0 + 10, refY + 1, z, COB); put(x0 + 10, refY + 2, z, COB); } // 第二腿左墙
    for (let z = zc; z <= zc + 13; z++) { level(x0 + 13, z); put(x0 + 13, refY + 1, z, COB); put(x0 + 13, refY + 2, z, COB); } // 右墙
    for (let x = x0 + 10; x <= x0 + 13; x++) { level(x, zc + 13); put(x, refY + 1, zc + 13, COB); put(x, refY + 2, zc + 13, COB); } // 底帽
    let prevT = 0;
    for (let i = 0; i < n; i++) { // N 道锁门沿路径均匀分布，锁间检查点旗
        let t = Math.round(((i + 1) * TLEN) / (n + 1));
        if (t >= L1 && t <= L1 + 2) t = L1 + 3; // 避开转角（那里 2 宽封不严）：门位移到第二腿第一横排
        const p = pathPos(t);
        gate(p.x, p.z, p.passage, p.passage === 'x' ? p.z : p.x - 1, p.passage === 'x' ? p.z + 1 : p.x);
        if (i < n - 1) {
            const mid = pathPos(Math.round((prevT + t) / 2));
            flag(mid.x, mid.z, 1);
        }
        prevT = t;
    }
    const goal = pathPos(TLEN);
    flag(goal.x, goal.z, 2); // 尽头终点旗
    torch(goal.x - 1, goal.z);
    torch(x0 + 10, zc + 1); // 转角火把
    return { ops, keypads, layoutText: `L 形 2 宽走廊（石墙 2 高），${n} 道答题机锁门各守一段${n > 1 ? '，锁间检查点旗' : ''}，尽头终点旗+火把` };
}

// gen_level_draft（单元主题关卡草稿）：抽题 → 选址 → 三模板建造 → 草稿卡落库
async function toolGenLevelDraft(args = {}) {
    const subject = String(args.subject || '').trim();
    if (!DRAFT_SUBJECT_NAMES[subject]) return `错误：subject 需为 ${Object.keys(DRAFT_SUBJECT_NAMES).join('/')} 之一`;
    const style = ['跑酷', '地牢', '寻宝'].includes(args.style) ? args.style : '跑酷';
    const wantCount = Math.max(1, Math.min(5, Math.floor(Number(args.count)) || 3));
    const unit = typeof args.unit === 'string' ? args.unit.trim() : '';

    const lw = await loadLevelWorkshop();
    if (!lw) return '关卡工坊模块（js/levelWorkshop.js）尚未就绪，请刷新页面后重试。';

    // a) 题池：清单 + 学科文件 → 归一 →（可选）单元精确过滤；count 不足按实际数量降级
    const pool = await loadDraftPool(subject, unit);
    if (pool.error) return `错误：${pool.error}`;
    const n = Math.min(wantCount, pool.items.length);

    // b) 选址（按模板占地探测平整度；全不平整退回头顶架空平台）
    const dims = style === '跑酷'
        ? { w: 20 + n * 4, d: 10 }
        : style === '地牢'
            ? { w: 24, d: Math.min(24, 9 + Math.ceil(n / 3) * 6) }
            : { w: 18, d: 20 };
    const { site, refY, floating } = findDraftSite(dims.w, dims.d);

    // c) 三模板 buildOps → 渐进施工（等放完才继续）
    const { ops, keypads, layoutText } = buildDraftStructure(style, n, site, refY, floating, dims);
    notifyBuildStart(`关卡草稿·${style}`);
    const built = await enqueueBuildOps(`gen_level_draft·${style}`, ops);
    if (!built.applied) return '错误：世界建造失败（一格都没放上）——请换个空旷位置再试，或先让我 clear_area 清场。';

    // d) 抽题（同格同题确定性）→ 草稿卡（questionProvider 直接给锁题、verifiedPasses=2）→ 落库
    const picked = pickDraftQuestions(pool.items, site.x0, refY, site.z0, n);
    const qmap = new Map();
    picked.forEach((item, i) => {
        const kp = keypads[i];
        if (!kp) return;
        const meta = { question: bankItemToCardQuestion(item, subject), verifiedPasses: 2 };
        qmap.set(`${kp.x},${kp.y},${kp.z}`, meta); // 世界坐标键（默认 lockMetaProvider 语义）
        qmap.set(`${kp.x - 80},${kp.y - 4},${kp.z - 80}`, meta); // 局部坐标键兜底（EMBED_OFFSET 80/4/80）
    });
    const provider = (x, y, z) => qmap.get(`${x},${y},${z}`) || null;
    const name = (typeof args.name === 'string' && args.name.trim()) || `${DRAFT_SUBJECT_NAMES[subject]}·${style}关卡`;
    const card = await lw.buildLevelCard({
        name,
        author: 'AI 草稿',
        draft: true, // meta.draft=true：导出校验的双通过要求降级为警告，孩子仍可继续改
        lockMetaProvider: provider, // 契约 §3.1 参数名
        questionProvider: provider, // 任务口径参数名——两个都给，兼容并行实现的任一签名
    });
    if (!card || card.error) {
        return `错误：结构已建好（${built.applied} 格），但生成关卡卡失败：${(card && card.error) || '未知原因'}。可手动调整现场后再叫我「检查关卡」。`;
    }
    const saved = await lw.saveLevelCard(card).catch(() => null);
    if (!saved || !saved.ok) return '错误：关卡卡保存失败（本机存储不可用）。结构已建好，可用关卡列表的「试玩当前世界」直接游玩。';

    // e) 回执：绝不列出题目答案明文（答案只在卡数据里，孩子玩时才见）
    return [
        `✅ 关卡草稿已生成：「${name}」`,
        `模板：${style}（${layoutText}）`,
        `锁：${keypads.length} 把 · ${DRAFT_SUBJECT_NAMES[subject]}${unit ? `·${unit}` : ''} 题库抽题（同格同题，已代双通过）`,
        `关卡卡 id：${saved.id}${saved.sessionOnly ? '（⚠️ 本机存储不可用，仅本次会话有效，刷新即失）' : ''}`,
        ...(n < wantCount ? [`注意：题池只有 ${pool.items.length} 题，锁数从 ${wantCount} 降为 ${n}。`] : []),
        '下一步：到首屏「🗺 关卡」进入试玩；手持出题笔右键答题机可换题修改；也可以叫我「检查关卡」做体检。',
    ].join('\n');
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
        fn('check_level', '检查关卡搭建（只读，不改方块）：自动识别当前世界的旗子/答题机/门区域，生成体检报告——锁的学科/题型/题干预览、旗组、错误与警告逐条、可达性、考核锁状态与改进建议。孩子说「帮我检查我的关卡/锁」时用。也可传 cardId 检查已保存的关卡卡。', {
            type: 'object',
            properties: { cardId: { type: 'string', description: '可选：已保存关卡卡的 id；不给则检查当前世界区域' } },
        }),
        fn('gen_level_draft', '生成单元主题关卡草稿（AI 出草稿，作者位在孩子）：从题库抽题装锁 → 在玩家附近自动选址，按模板渐进施工（旗子+答题机锁门+火把）→ 保存为可编辑草稿卡。回复只报卡名/锁数/模板，绝不列出题目答案。建造会等放完才返回。', {
            type: 'object',
            properties: {
                subject: { type: 'string', enum: ['math', 'science', 'daofa', 'yuwen'], description: '题库学科' },
                unit: { type: 'string', description: '可选：按单元精确过滤（如「三上·古诗」）；不给则用该学科全部题' },
                count: { type: 'integer', description: '锁数量（=题数），1..5，默认 3；题池不足自动降级' },
                style: { type: 'string', enum: ['跑酷', '地牢', '寻宝'], description: '关卡模板，默认 跑酷' },
                name: { type: 'string', description: '可选：关卡卡名称，默认「学科·模板关卡」' },
            },
            required: ['subject'],
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
            case 'check_level': result = await toolCheckLevel(args); break;
            case 'gen_level_draft': result = await toolGenLevelDraft(args); break;
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
