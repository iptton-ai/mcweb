// ==================== levelWorkshop.js ====================
// 关卡工坊（Level Workshop，P0 批次）：关卡卡 mcweb.level.v1 的构建 / 校验 / 存储 / 嵌入。
// 方案 docs/edu-level-workshop-plan.md §2.5/§8，接口契约 docs/edu-workshop-impl-contract.md（唯一事实源）。
//
// 职责边界（§0 文件归属，A1 独占本文件）：
//   - 卡内一律局部坐标（相对 region.x0/y0/z0）；世界↔局部换算只在本模块的
//     worldToLocal/localToWorld（运行期 = 嵌入偏移 LEVEL_EMBED_OFFSET 基准）。
//   - 区域自动检测（G2 R1 修订）：旗组∪答题机∪星辉门∪门 的联合包围盒 +2 格边距，
//     clamp 进世界边界；圈外装饰不进卡。超 96×64×96 上限报错。
//   - 区域快照复用 js/rle.js（saveGame 同款 RLE，零依赖可在 Node 直连）；base64 为
//     本模块自实现纯 JS（约 12 行，不依赖 btoa/Buffer）。
//   - 卡片存 IndexedDB（'mcweb-levels'/'cards'，keyPath 'id'）；不可用/写失败
//     （Node 测试/隐私模式/配额不足）自动降级会话内存 Map，标记 sessionOnly:true。
//   - Node 可测性铁律：静态 import 只许 config/state/world/rle（无 three/chunk/DOM）；
//     浏览器专用路径（默认锁题提供者 = eduKeypad.getAuthoredLock，由窗口 B3 提供）
//     用动态 import() 惰性加载 + 可选链，模块缺失/加载失败一律安静降级为 null。
// 运行期消费方 js/levelRun.js（A2）只调本模块，不自行解码卡片。

import {
    BlockInfo,
    BlockTypes,
    CHUNK_SIZE,
    DOOR_BASE,
    DOOR_COUNT,
    FLAG_BASE,
    FLAG_CHECKPOINT,
    FLAG_COUNT,
    FLAG_GOAL,
    FLAG_START,
    KEYPAD_BASE,
    KEYPAD_COUNT,
    STARLIGHT_BASE,
    STARLIGHT_COUNT,
    WORLD_DEPTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    flagKind,
    isDoorId,
    isFlagId,
    isKeypadId,
    keypadSolved,
    isStarlightId,
    starlightOpen,
} from './config.js';
import { state } from './state.js';
import { getBlockIndex } from './world.js';
import { rleDecode, rleEncode } from './rle.js';

// ==================== 契约常量（docs/edu-workshop-impl-contract.md §3.1）====================

export const LEVEL_CARD_FORMAT = 'mcweb.level.v1';
export const LEVEL_REGION_MAX = { w: 96, h: 64, d: 96 };
// 嵌入固定偏移：80+96=176≤256、4+64=68≤128，四周留出空气带（W07 嵌入展开）
export const LEVEL_EMBED_OFFSET = { x: 80, y: 4, z: 80 };

// ---- 锁题学科枚举（与题库契约一致）----
const SUBJECTS = ['math', 'science', 'daofa', 'yuwen', 'english'];

// ==================== base64（纯 JS 自实现，Node/浏览器双端一致）====================

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < B64_ALPHABET.length; i++) B64_LOOKUP[B64_ALPHABET.charCodeAt(i)] = i;

// Uint8Array → base64（带 = 填充；不依赖 btoa，供卡片 region.blocks 编解码）
export function u8ToBase64(u8) {
    let out = '';
    for (let i = 0; i < u8.length; i += 3) {
        const has1 = i + 1 < u8.length;
        const has2 = i + 2 < u8.length;
        const b0 = u8[i];
        const b1 = has1 ? u8[i + 1] : 0;
        const b2 = has2 ? u8[i + 2] : 0;
        out += B64_ALPHABET[b0 >> 2]
            + B64_ALPHABET[(b0 & 3) << 4 | b1 >> 4]
            + (has1 ? B64_ALPHABET[(b1 & 15) << 2 | b2 >> 6] : '=')
            + (has2 ? B64_ALPHABET[b2 & 63] : '=');
    }
    return out;
}

// base64 → Uint8Array；非法字符/长度残缺返回 null（按数据损坏处理，由调用方报错）
export function base64ToU8(b64) {
    if (typeof b64 !== 'string') return null;
    const n = b64.length;
    let pad = 0;
    if (n > 0 && b64.charCodeAt(n - 1) === 61) pad++; // '='
    if (n > 1 && b64.charCodeAt(n - 2) === 61) pad++;
    const out = new Uint8Array(Math.max(0, Math.floor((n - pad) * 3 / 4)));
    let buf = 0;
    let bits = 0;
    let k = 0;
    for (let i = 0; i < n; i++) {
        const c = b64.charCodeAt(i);
        if (c === 61) break; // '=' 填充符：有效数据到此为止
        const v = c < 128 ? B64_LOOKUP[c] : -1;
        if (v < 0) return null; // 非法字符
        buf = buf << 6 | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[k++] = buf >> bits & 0xFF;
        }
    }
    return k === out.length ? out : null;
}

// ==================== 坐标换算（全游戏唯一换算点，契约 §2 坐标铁律）====================
// 运行期（关卡嵌入后）世界坐标 = 局部坐标 + LEVEL_EMBED_OFFSET；
// 作者期（buildLevelCard 扫描）的换算走内部 region 基准，不经这对函数。

export function worldToLocal(x, y, z) {
    return {
        x: x - LEVEL_EMBED_OFFSET.x,
        y: y - LEVEL_EMBED_OFFSET.y,
        z: z - LEVEL_EMBED_OFFSET.z,
    };
}

export function localToWorld(x, y, z) {
    return {
        x: x + LEVEL_EMBED_OFFSET.x,
        y: y + LEVEL_EMBED_OFFSET.y,
        z: z + LEVEL_EMBED_OFFSET.z,
    };
}

// 局部坐标对象 → 'x,y,z' 字符串（state.levelRun.answers 的记账 key，契约 §3.2）
export function localKey(p) {
    return `${p.x},${p.y},${p.z}`;
}

// 掉界判定（A2 tickLevelRun 每帧调）：y<1（跌出世界，y=0 是基岩层）或
// 水平超出嵌入区域 ±2 格边距。非关卡运行（state.levelRun 未激活）恒 false。
export function isOutOfRunArea(x, y, z) {
    const run = state.levelRun;
    const r = run && run.card && run.card.region;
    if (!r) return false;
    if (y < 1) return true;
    const lx = x - LEVEL_EMBED_OFFSET.x;
    const lz = z - LEVEL_EMBED_OFFSET.z;
    return lx < -2 || lx > r.w + 2 || lz < -2 || lz > r.d + 2;
}

// ==================== 区域自动检测（G2 R1 修订版）====================

// 锚点判定查找表（模块加载时建好）：旗组∪答题机∪星辉门∪门——全图扫描热路径一次查表
const ANCHOR_LUT = new Uint8Array(256);
for (let i = 0; i < FLAG_COUNT; i++) ANCHOR_LUT[FLAG_BASE + i] = 1;
for (let i = 0; i < KEYPAD_COUNT; i++) ANCHOR_LUT[KEYPAD_BASE + i] = 1;
for (let i = 0; i < STARLIGHT_COUNT; i++) ANCHOR_LUT[STARLIGHT_BASE + i] = 1;
for (let i = 0; i < DOOR_COUNT; i++) ANCHOR_LUT[DOOR_BASE + i] = 1;

function clampI(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// 内部版：区分「无锚点」与「超上限」两种失败（buildLevelCard 据此给精确文案）
function computeAutoRegionDetailed() {
    const blocks = state.blocks;
    if (!blocks) return { error: '世界尚未加载，无法检测关卡区域' };
    let minX = 0;
    let minY = 0;
    let minZ = 0;
    let maxX = -1;
    let maxY = -1;
    let maxZ = -1;
    let found = false;
    // 直接三层循环 + 下标公式（x + z*W + y*W*D），不走 getBlock 函数调用（全图 8.4M 格）
    for (let y = 0; y < WORLD_HEIGHT; y++) {
        const yBase = y * WORLD_WIDTH * WORLD_DEPTH;
        for (let z = 0; z < WORLD_DEPTH; z++) {
            const rowBase = yBase + z * WORLD_WIDTH;
            for (let x = 0; x < WORLD_WIDTH; x++) {
                if (!ANCHOR_LUT[blocks[rowBase + x]]) continue;
                if (!found) {
                    found = true;
                    minX = maxX = x;
                    minY = maxY = y;
                    minZ = maxZ = z;
                    continue;
                }
                if (x < minX) minX = x;
                else if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                else if (y > maxY) maxY = y;
                if (z < minZ) minZ = z;
                else if (z > maxZ) maxZ = z;
            }
        }
    }
    if (!found) return { error: '未找到关卡锚点：请先放置旗组、答题机、星辉门或门' };
    // 联合包围盒 +2 格边距（含端坐标 +3 = 独占端），clamp 进世界边界（边缘锚点吃不满边距就贴边）
    const x0 = clampI(minX - 2, 0, WORLD_WIDTH - 1);
    const y0 = clampI(minY - 2, 0, WORLD_HEIGHT - 1);
    const z0 = clampI(minZ - 2, 0, WORLD_DEPTH - 1);
    const x1 = clampI(maxX + 3, x0 + 1, WORLD_WIDTH);
    const y1 = clampI(maxY + 3, y0 + 1, WORLD_HEIGHT);
    const z1 = clampI(maxZ + 3, z0 + 1, WORLD_DEPTH);
    const region = { x0, y0, z0, w: x1 - x0, h: y1 - y0, d: z1 - z0 };
    if (region.w > LEVEL_REGION_MAX.w || region.h > LEVEL_REGION_MAX.h || region.d > LEVEL_REGION_MAX.d) {
        return {
            error: `区域超出 ${LEVEL_REGION_MAX.w}×${LEVEL_REGION_MAX.h}×${LEVEL_REGION_MAX.d}，请缩小关卡或减少装饰`,
        };
    }
    return { region };
}

// 全图自动检测关卡区域（无锚点或超 96×64×96 上限都返回 null）
export function computeAutoRegion() {
    const det = computeAutoRegionDetailed();
    return det.region || null;
}

// ==================== 区域快照（RLE 直出，字节布局与存档一致）====================
// 快照内存序 = 世界内存序：decoded[lx + lz*w + ly*w*d]（x 最快），RLE 沿 x 行连续最易压。

export function snapshotRegion(region) {
    const blocks = state.blocks;
    if (!blocks || !region) return new Uint8Array(0);
    const { x0, y0, z0, w, h, d } = region;
    const out = new Uint8Array(w * h * d);
    let k = 0;
    for (let ly = 0; ly < h; ly++) {
        const yBase = (y0 + ly) * WORLD_WIDTH * WORLD_DEPTH;
        for (let lz = 0; lz < d; lz++) {
            const rowBase = yBase + (z0 + lz) * WORLD_WIDTH + x0;
            for (let lx = 0; lx < w; lx++) out[k++] = blocks[rowBase + lx];
        }
    }
    return rleEncode(out);
}

// 卡片 region.blocks（base64+RLE）解码回局部方块数组；布局同 snapshotRegion。
// 返回 { blocks } | { error }——validateLevelCard / reachabilityBFS / embedLevelToWorld 共用。
export function decodeRegionBlocks(card) {
    const r = card && card.region;
    if (!r || typeof r !== 'object') return { error: '卡片缺少 region' };
    const total = r.w * r.h * r.d;
    if (!Number.isInteger(total) || total <= 0) return { error: 'region 尺寸非法' };
    const raw = base64ToU8(r.blocks);
    if (!raw) return { error: 'region.blocks 不是有效的 base64' };
    const blocks = rleDecode(raw, total);
    if (!blocks) return { error: 'region 数据损坏：RLE 解码长度与尺寸不符' };
    return { blocks, region: r };
}

// ==================== 关卡卡构建（作者侧）====================

// 默认锁题提供者：取 eduKeypad 的作者面板锁（getAuthoredLock 由窗口 B3 提供）。
// 动态 import 惰性加载保持 Node 可测性（eduKeypad 链上有 three/chunk，Node 里加载失败
// 也必须安静降级）；可选链兼容 B3 尚未落地 exports 的阶段。
async function defaultLockMetaProvider(x, y, z) {
    try {
        const mod = await import('./eduKeypad.js');
        return mod.getAuthoredLock?.(x, y, z) ?? null;
    } catch {
        return null;
    }
}

// 扫描自动区域 → 组卡。返回 card | { error: 文案 }。
// lockMetaProvider(wx,wy,wz) → { question:{subject,kind,stem,options?,answer,hint?,unit?},
//   verifiedPasses:number } | null；没题的答题机只是装饰，不进 questions。
// 兼容 A4 文档里的 questionProvider 别名；draft=true ⇒ meta.draft=true（校验降级）。
export async function buildLevelCard({ name, author, lockMetaProvider, questionProvider, rules: rulesOverride, draft, generator } = {}) {
    const provider = lockMetaProvider || questionProvider || defaultLockMetaProvider;
    const nm = String(name ?? '').trim();
    if (!nm) return { error: '请先填写关卡名' };

    const det = computeAutoRegionDetailed();
    if (det.error) return { error: det.error };
    const region = det.region;

    // ---- 扫描 region：旗归类（起点/检查点/终点）、答题机问锁题 ----
    const blocks = state.blocks;
    const flags = { start: null, checkpoints: [], goal: null };
    const questions = [];
    for (let ly = 0; ly < region.h; ly++) {
        for (let lz = 0; lz < region.d; lz++) {
            for (let lx = 0; lx < region.w; lx++) {
                const wx = region.x0 + lx;
                const wy = region.y0 + ly;
                const wz = region.z0 + lz;
                const id = blocks[getBlockIndex(wx, wy, wz)];
                if (isFlagId(id)) {
                    const kind = flagKind(id);
                    if (kind === FLAG_START) {
                        if (!flags.start) flags.start = { x: lx, y: ly, z: lz }; // 多面起点旗取第一面
                    } else if (kind === FLAG_GOAL) {
                        if (!flags.goal) flags.goal = { x: lx, y: ly, z: lz };
                    } else if (kind === FLAG_CHECKPOINT) {
                        flags.checkpoints.push({ x: lx, y: ly, z: lz });
                    }
                } else if (isKeypadId(id)) {
                    // G3 P1#4：已解锁变体进卡=「天生开门」假锁（无题+常供能），数据面直接拒
                    if (keypadSolved(id) === 1) {
                        return { error: '发现已解锁的答题机：答对过的锁不能进卡——请把它拆掉换新的（或先出题再玩）' };
                    }
                    let meta = null;
                    try {
                        meta = await provider(wx, wy, wz);
                    } catch {
                        meta = null; // 提供者抛错视同无锁题，不阻塞出卡
                    }
                    if (!meta || !meta.question) continue;
                    const q = meta.question;
                    const source = (q.meta && q.meta.source === 'custom') || q.source === 'custom' ? 'custom' : 'bank';
                    // 字段顺序照契约 §2 schema，保证 cardHash 稳定
                    questions.push({
                        lockType: 'keypad',
                        x: lx,
                        y: ly,
                        z: lz,
                        subject: q.subject,
                        kind: q.kind,
                        stem: q.stem,
                        ...(Array.isArray(q.options) ? { options: q.options.slice() } : {}),
                        answer: q.answer,
                        ...(q.hint != null ? { hint: q.hint } : {}),
                        ...(q.unit != null ? { unit: q.unit } : {}),
                        meta: { source, verifiedPasses: meta.verifiedPasses | 0 },
                    });
                } else if (isStarlightId(id)) {
                    // G3 P1#4：星辉门题目依赖玩家学习进度（超纲判定），无法随卡自包含——
                    // 暂拒导出并明示；「预告关」锁具随卡导出登记为后续批次债务
                    return { error: starlightOpen(id) === 1
                        ? '发现已开启的星辉门：不能进卡（天生开门的假锁）——请拆掉换新的'
                        : '星辉门暂不随关卡卡导出（题目因人而异、无法自包含）——请改用答题机或把它移出关卡区域' };
                }
            }
        }
    }
    if (!flags.start) return { error: '缺少起点旗：请在关卡内放置一面起点旗' };
    if (!flags.goal) return { error: '缺少终点旗：请在关卡内放置一面终点旗' };

    const card = {
        format: LEVEL_CARD_FORMAT,
        name: nm,
        author: String(author ?? '').trim() || '匿名', // 本地填写的昵称，不采集真实信息
        created: new Date().toISOString(),
        version: 1,
        region: {
            x0: region.x0,
            y0: region.y0,
            z0: region.z0,
            w: region.w,
            h: region.h,
            d: region.d,
            enc: 'rle',
            blocks: u8ToBase64(snapshotRegion(region)),
        },
        questions,
        rules: {
            timeLimit: rulesOverride && 'timeLimit' in rulesOverride ? rulesOverride.timeLimit : null,
            lockAIHelp: rulesOverride && 'lockAIHelp' in rulesOverride ? !!rulesOverride.lockAIHelp : true,
        },
        flags: { start: flags.start, checkpoints: flags.checkpoints, goal: flags.goal },
    };
    const meta = {};
    if (draft) meta.draft = true;
    if (generator) meta.generator = generator;
    if (Object.keys(meta).length) card.meta = meta;
    return card;
}

// ==================== 关卡卡校验（导出/导入门槛）====================

// 全部分支：格式字段 / region 尺寸上限与边界 / RLE 解码长度吻合 / 题目 schema
// （kind 枚举、input 答案 0..9999 整数、choice 选项 3~4 条非空且互不重复、answer 索引合法、
// stem 非空、subject 枚举、锁局部坐标在 region 内且互不重复）/ 起终点旗存在 / rules 类型 /
// 锁 verifiedPasses<2 ⇒ error（meta.draft 时降 warning）/ reachabilityBFS 不可达 ⇒ warning。
export function validateLevelCard(card) {
    const errors = [];
    const warnings = [];
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
        return { ok: false, errors: ['不是有效的关卡卡对象'], warnings };
    }
    if (card.format !== LEVEL_CARD_FORMAT) errors.push(`format 必须为 '${LEVEL_CARD_FORMAT}'`);
    if (typeof card.name !== 'string' || !card.name.trim()) errors.push('关卡名（name）必须为非空字符串');
    if (typeof card.author !== 'string') errors.push('作者（author）必须为字符串');
    if (typeof card.created !== 'string' || !card.created) errors.push('created 必须为 ISO 时间字符串');
    if (card.version !== 1) errors.push('version 必须为 1');
    if (card.meta !== undefined && (typeof card.meta !== 'object' || card.meta === null)) {
        errors.push('meta 必须为对象');
    }

    // ---- region：整数 / 正尺寸 / 上限 96×64×96 / 世界边界 / RLE 长度吻合 ----
    let region = null;
    const r = card.region;
    if (!r || typeof r !== 'object') {
        errors.push('缺少 region');
    } else if (![r.x0, r.y0, r.z0, r.w, r.h, r.d].every(Number.isInteger)) {
        errors.push('region 坐标与尺寸必须为整数');
    } else if (r.w < 1 || r.h < 1 || r.d < 1) {
        errors.push('region 尺寸必须为正数');
    } else if (r.w > LEVEL_REGION_MAX.w || r.h > LEVEL_REGION_MAX.h || r.d > LEVEL_REGION_MAX.d) {
        errors.push(`region 超出 ${LEVEL_REGION_MAX.w}×${LEVEL_REGION_MAX.h}×${LEVEL_REGION_MAX.d} 上限`);
    } else if (r.x0 < 0 || r.y0 < 0 || r.z0 < 0
        || r.x0 + r.w > WORLD_WIDTH || r.y0 + r.h > WORLD_HEIGHT || r.z0 + r.d > WORLD_DEPTH) {
        errors.push('region 越出世界边界');
    } else if (r.enc !== 'rle') {
        errors.push('region.enc 必须为 rle');
    } else if (typeof r.blocks !== 'string') {
        errors.push('region.blocks 必须为 base64 字符串');
    } else {
        const decoded = decodeRegionBlocks(card);
        if (decoded.error) errors.push(decoded.error);
        else region = r;
    }

    // ---- 题目 schema ----
    if (Array.isArray(card.questions) && card.questions.length > 200) {
        errors.push(`锁数量超过上限（${card.questions.length} > 200）——坏卡防御`);
    }
    for (const q of (Array.isArray(card.questions) ? card.questions : [])) {
        if (q && typeof q.stem === 'string' && q.stem.length > 300) {
            errors.push('题干超过 300 字符——坏卡防御');
            break;
        }
        if (Array.isArray(q?.options) && q.options.some((o) => typeof o === 'string' && o.length > 100)) {
            errors.push('选项超过 100 字符——坏卡防御');
            break;
        }
    }
    const lockSeen = new Set();
    if (!Array.isArray(card.questions)) {
        errors.push('questions 必须为数组');
    } else {
        card.questions.forEach((q, qi) => {
            const at = `第 ${qi + 1} 题`;
            if (!q || typeof q !== 'object') {
                errors.push(`${at}：不是对象`);
                return;
            }
            const lockType = q.lockType ?? 'keypad'; // 缺省 keypad
            if (lockType !== 'keypad' && lockType !== 'starlight') {
                errors.push(`${at}：lockType 必须为 keypad|starlight`);
            }
            let inRegion = false;
            if (![q.x, q.y, q.z].every(Number.isInteger)) {
                errors.push(`${at}：锁局部坐标必须为整数`);
            } else if (region && (q.x < 0 || q.x >= region.w || q.y < 0 || q.y >= region.h || q.z < 0 || q.z >= region.d)) {
                errors.push(`${at}：锁局部坐标 (${q.x},${q.y},${q.z}) 越出 region`);
            } else {
                inRegion = true;
            }
            if (Number.isInteger(q.x) && Number.isInteger(q.y) && Number.isInteger(q.z)) {
                const key = `${q.x},${q.y},${q.z}`;
                if (lockSeen.has(key)) errors.push(`${at}：锁位置 (${key}) 重复`);
                lockSeen.add(key);
            }
            if (!SUBJECTS.includes(q.subject)) errors.push(`${at}：subject 必须为 ${SUBJECTS.join('/')}`);
            if (typeof q.stem !== 'string' || !q.stem.trim()) errors.push(`${at}：题干（stem）不能为空`);
            if (q.kind === 'input') {
                if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 9999) {
                    errors.push(`${at}：数字题答案必须为 0..9999 整数`);
                }
            } else if (q.kind === 'choice') {
                const opts = q.options;
                if (!Array.isArray(opts) || opts.length < 3 || opts.length > 4) {
                    errors.push(`${at}：选择题选项必须为 3~4 条`);
                } else {
                    if (opts.some((o) => typeof o !== 'string' || !o.trim())) {
                        errors.push(`${at}：选项必须为非空字符串`);
                    }
                    if (new Set(opts).size !== opts.length) errors.push(`${at}：选项内容重复（含与正确项相同）`);
                    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= opts.length) {
                        errors.push(`${at}：正确项索引 answer 越界`);
                    }
                }
            } else {
                errors.push(`${at}：kind 必须为 input|choice`);
            }
            if (q.hint !== undefined && q.hint !== null && typeof q.hint !== 'string') {
                errors.push(`${at}：hint 必须为字符串`);
            }
            if (q.unit !== undefined && q.unit !== null && typeof q.unit !== 'string') {
                errors.push(`${at}：unit 必须为字符串`);
            }
            if (q.meta !== undefined && (typeof q.meta !== 'object' || q.meta === null
                || (q.meta.source !== 'bank' && q.meta.source !== 'custom'))) {
                errors.push(`${at}：meta.source 必须为 bank|custom`);
            }
            // 双通过门槛：作者必须连过自己的锁两次（防手滑、防不会）；AI 草稿降为警告
            if (inRegion) {
                const passes = (q.meta && q.meta.verifiedPasses) | 0;
                if (passes < 2) {
                    const msg = `锁 (${q.x},${q.y},${q.z}) 未完成双通过校验（${passes}/2）`;
                    if (card.meta && card.meta.draft) warnings.push(msg);
                    else errors.push(msg);
                }
            }
        });
    }

    // ---- 旗：起终点存在 + 坐标在 region 内 ----
    const f = card.flags;
    if (!f || typeof f !== 'object') {
        errors.push('缺少 flags');
    } else {
        const checkFlag = (where, p) => {
            if (!p || typeof p !== 'object' || ![p.x, p.y, p.z].every(Number.isInteger)) {
                errors.push(`${where}：旗局部坐标必须为整数对象`);
                return;
            }
            if (region && (p.x < 0 || p.x >= region.w || p.y < 0 || p.y >= region.h || p.z < 0 || p.z >= region.d)) {
                errors.push(`${where}：旗局部坐标 (${p.x},${p.y},${p.z}) 越出 region`);
            }
        };
        if (!f.start) errors.push('缺少起点旗（flags.start）');
        else checkFlag('起点旗', f.start);
        if (!f.goal) errors.push('缺少终点旗（flags.goal）');
        else checkFlag('终点旗', f.goal);
        if (!Array.isArray(f.checkpoints)) errors.push('flags.checkpoints 必须为数组');
        else f.checkpoints.forEach((p, i) => checkFlag(`检查点旗 ${i + 1}`, p));
    }

    // ---- rules 类型 ----
    const ru = card.rules;
    if (!ru || typeof ru !== 'object') {
        errors.push('缺少 rules');
    } else {
        if (ru.timeLimit !== null
            && (typeof ru.timeLimit !== 'number' || !Number.isFinite(ru.timeLimit) || ru.timeLimit <= 0)) {
            errors.push('rules.timeLimit 必须为 null 或正数');
        }
        if (typeof ru.lockAIHelp !== 'boolean') errors.push('rules.lockAIHelp 必须为布尔值');
    }

    // ---- 静态可达性（不可达 ⇒ warning，不挡导出）----
    if (region && f && f.start && f.goal) {
        const bfs = reachabilityBFS(card);
        if (!bfs.reachable) warnings.push(`静态可达性检查未通过：从起点出发无法到达 ${bfs.missing.join('、')}`);
    }

    return { ok: errors.length === 0, errors, warnings };
}

// ==================== 静态可达性 BFS ====================
// 实心（BlockInfo[id]?.solid===true）= 墙；但 锁位/旗位/门/AIR（及一切非实心/未登记方块）恒可通行。
// 从起点旗六邻域泛洪，终点旗与每把锁都必须可达。返回 { reachable, missing:[] }。

export function reachabilityBFS(card) {
    const f = card && card.flags;
    const s = f && f.start;
    const g = f && f.goal;
    if (!s || !Number.isInteger(s.x)) return { reachable: false, missing: ['缺少起点旗'] };
    if (!g || !Number.isInteger(g.x)) return { reachable: false, missing: ['缺少终点旗'] };
    const dec = decodeRegionBlocks(card);
    if (dec.error) return { reachable: false, missing: ['区域数据不可解码'] };
    const blocks = dec.blocks;
    const r = card.region;
    const total = r.w * r.h * r.d;
    const idxOf = (lx, ly, lz) => lx + lz * r.w + ly * r.w * r.d;
    const lockKeys = new Set();
    for (const q of card.questions || []) {
        if (q && Number.isInteger(q.x)) lockKeys.add(`${q.x},${q.y},${q.z}`);
    }
    const passable = (lx, ly, lz) => {
        const id = blocks[idxOf(lx, ly, lz)];
        if (id === BlockTypes.AIR) return true;
        if (isDoorId(id) || isFlagId(id)) return true; // 门/旗恒可通行（门是通路，旗是踩点）
        if (BlockInfo[id] && BlockInfo[id].solid === true) return lockKeys.has(`${lx},${ly},${lz}`);
        return true; // 非实心与未登记方块（B1 的 BlockInfo 增量未落地也不误判）均可通行
    };
    const seen = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    seen[idxOf(s.x, s.y, s.z)] = 1;
    queue[tail++] = idxOf(s.x, s.y, s.z);
    const tryVisit = (lx, ly, lz) => {
        if (lx < 0 || lx >= r.w || ly < 0 || ly >= r.h || lz < 0 || lz >= r.d) return;
        const idx = idxOf(lx, ly, lz);
        if (seen[idx] || !passable(lx, ly, lz)) return;
        seen[idx] = 1;
        queue[tail++] = idx;
    };
    while (head < tail) {
        const idx = queue[head++];
        const lx = idx % r.w;
        const lz = ((idx - lx) / r.w) % r.d;
        const ly = (idx / (r.w * r.d)) | 0;
        tryVisit(lx + 1, ly, lz);
        tryVisit(lx - 1, ly, lz);
        tryVisit(lx, ly + 1, lz);
        tryVisit(lx, ly - 1, lz);
        tryVisit(lx, ly, lz + 1);
        tryVisit(lx, ly, lz - 1);
    }
    const missing = [];
    if (!seen[idxOf(g.x, g.y, g.z)]) missing.push(`终点旗（${g.x},${g.y},${g.z}）`);
    for (const q of card.questions || []) {
        if (!q || !Number.isInteger(q.x) || !Number.isInteger(q.y) || !Number.isInteger(q.z)) continue;
        if (q.x < 0 || q.x >= r.w || q.y < 0 || q.y >= r.h || q.z < 0 || q.z >= r.d) continue;
        if (!seen[idxOf(q.x, q.y, q.z)]) missing.push(`锁（${q.x},${q.y},${q.z}）`);
    }
    return { reachable: missing.length === 0, missing };
}

// ==================== 哈希与 id ====================

// djb2 over 稳定 JSON（region.blocks + questions + rules + flags 依构造序 stringify）→ 16 进制
export function cardHash(card) {
    const stable = JSON.stringify({
        region: card.region && card.region.blocks,
        questions: card.questions || [],
        rules: card.rules || null,
        flags: card.flags || null,
    });
    let h = 5381;
    for (let i = 0; i < stable.length; i++) {
        h = ((h << 5) + h + stable.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

// 卡片 id = cardHash + created 短码（base36 秒级时间戳，同卡重存同 id 即覆盖）
export function levelCardId(card) {
    const ts = Date.parse(card.created);
    return `${cardHash(card)}-${Number.isFinite(ts) ? ts.toString(36) : '0'}`;
}

// ==================== 卡片存储：IndexedDB + 会话内存兜底 ====================
// IndexedDB 'mcweb-levels' v1 / store 'cards'（keyPath 'id'），记录 {id, card, thumbnail?, savedAt}。
// 不可用（Node 测试/隐私模式）或写入失败（配额等）⇒ 内存 Map 兜底 + sessionOnly:true（W17 降级路径）。

const LEVELS_DB = 'mcweb-levels';
const LEVELS_STORE = 'cards';
const sessionCards = new Map(); // id -> {id, card, thumbnail?, savedAt}

function idbRequest(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB 请求失败'));
    });
}

async function idbRun(mode, op) {
    if (!globalThis.indexedDB) throw new Error('IndexedDB 不可用');
    const req = globalThis.indexedDB.open(LEVELS_DB, 1);
    req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LEVELS_STORE)) {
            db.createObjectStore(LEVELS_STORE, { keyPath: 'id' });
        }
    };
    const db = await idbRequest(req);
    try {
        const store = db.transaction(LEVELS_STORE, mode).objectStore(LEVELS_STORE);
        return await idbRequest(op(store)); // 单请求事务：请求挂起期间事务不会自动提交
    } finally {
        db.close();
    }
}

function summarizeCard(rec, sessionOnly) {
    return {
        id: rec.id,
        name: (rec.card && rec.card.name) || '',
        author: (rec.card && rec.card.author) || '',
        created: (rec.card && rec.card.created) || '',
        cardHash: rec.card ? cardHash(rec.card) : '',
        ...(sessionOnly ? { sessionOnly: true } : {}),
    };
}

// 保存卡片（thumbnailBlob 透传存记录，P1 海报用）。返回 {ok:true,id,sessionOnly?} | {ok:false,error}
export async function saveLevelCard(card, thumbnailBlob) {
    if (!card || card.format !== LEVEL_CARD_FORMAT) {
        return { ok: false, error: '不是有效的关卡卡（format 不符）' };
    }
    const id = levelCardId(card);
    const rec = { id, card, savedAt: Date.now() };
    if (thumbnailBlob) rec.thumbnail = thumbnailBlob;
    try {
        await idbRun('readwrite', (store) => store.put(rec));
        return { ok: true, id };
    } catch {
        sessionCards.set(id, rec);
        return { ok: true, id, sessionOnly: true };
    }
}

// 卡片列表（IndexedDB + 会话合并，新的在前）；会话卡带 sessionOnly:true
export async function listLevelCards() {
    const out = new Map();
    try {
        const rows = await idbRun('readonly', (store) => store.getAll());
        for (const rec of rows || []) {
            if (rec && rec.card) out.set(rec.id, summarizeCard(rec, false));
        }
    } catch { /* 降级：只列会话卡 */ }
    for (const [id, rec] of sessionCards) {
        if (!out.has(id)) out.set(id, summarizeCard(rec, true));
    }
    return [...out.values()].sort((a, b) => (a.created < b.created ? 1 : -1));
}

// 取卡片（IndexedDB 优先，未命中/不可用回会话）；无 → null
export async function getLevelCard(id) {
    try {
        const rec = await idbRun('readonly', (store) => store.get(id));
        if (rec && rec.card) return rec.card;
    } catch { /* 降级查会话 */ }
    const ses = sessionCards.get(id);
    return ses ? ses.card : null;
}

// 删卡片（两处都清）；命中过任一处返回 true
export async function deleteLevelCard(id) {
    let removed = false;
    try {
        const rec = await idbRun('readonly', (store) => store.get(id));
        if (rec) {
            await idbRun('readwrite', (store) => store.delete(id));
            removed = true;
        }
    } catch { /* 降级只清会话 */ }
    if (sessionCards.delete(id)) removed = true;
    return removed;
}

// 文件导入（B4 接线）：JSON.parse → 校验 → 落库。返回 {ok,id,sessionOnly?,warnings?} | {error,errors?,warnings?}
export async function importLevelCardFromJson(text) {
    if (typeof text === 'string' && text.length > 8 * 1024 * 1024) {
        return { error: '文件过大（>8MB），不是有效的关卡卡' }; // G3 P2#5：坏卡防御，先于 JSON.parse
    }
    let card;
    try {
        card = JSON.parse(text);
    } catch {
        return { error: '不是有效的关卡卡文件（JSON 解析失败）' };
    }
    const v = validateLevelCard(card);
    if (!v.ok) {
        return { error: `关卡卡校验未通过：${v.errors[0]}`, errors: v.errors, warnings: v.warnings };
    }
    const saved = await saveLevelCard(card);
    if (!saved.ok) return { error: saved.error || '关卡卡保存失败' };
    return { ok: true, id: saved.id, sessionOnly: !!saved.sessionOnly, warnings: v.warnings };
}

// 文件导出（B4 接线）：关卡卡 → JSON 字符串（自包含，RLE 直出体积可控）
export function exportLevelCardJson(card) {
    return JSON.stringify(card);
}

// ==================== 嵌入（闯关运行世界生成）====================
// 前置：调用方（levelRun.enterLevel）已把 state.blocks 清零并铺 y=0 基岩层。
// 本函数只把 region 区按 局部→世界（+LEVEL_EMBED_OFFSET）直写 state.blocks（不走 setBlockSafe，
// 纯批量写入零副作用），返回需重建的区块与出生点。数据损坏返回 { error }。

export function embedLevelToWorld(card) {
    const wb = state.blocks;
    if (!wb) return { error: '世界尚未初始化' };
    const dec = decodeRegionBlocks(card);
    if (dec.error) return { error: dec.error };
    const blocks = dec.blocks;
    const r = card.region;
    const ox = LEVEL_EMBED_OFFSET.x;
    const oy = LEVEL_EMBED_OFFSET.y;
    const oz = LEVEL_EMBED_OFFSET.z;
    let k = 0;
    for (let ly = 0; ly < r.h; ly++) {
        const yBase = (oy + ly) * WORLD_WIDTH * WORLD_DEPTH;
        for (let lz = 0; lz < r.d; lz++) {
            const rowBase = yBase + (oz + lz) * WORLD_WIDTH + ox;
            for (let lx = 0; lx < r.w; lx++) wb[rowBase + lx] = blocks[k++];
        }
    }
    // 受影响区块（CHUNK_SIZE=16 网格）：region 的世界水平覆盖范围
    const dirtyChunks = [];
    const seenChunks = new Set();
    const cx0 = Math.floor(ox / CHUNK_SIZE);
    const cx1 = Math.floor((ox + r.w - 1) / CHUNK_SIZE);
    const cz0 = Math.floor(oz / CHUNK_SIZE);
    const cz1 = Math.floor((oz + r.d - 1) / CHUNK_SIZE);
    for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
            const key = `${cx},${cz}`;
            if (!seenChunks.has(key)) {
                seenChunks.add(key);
                dirtyChunks.push({ cx, cz });
            }
        }
    }
    // 出生点 = 起点旗世界坐标（校验过的卡必有 start；损坏卡兜底区域原点）
    const s = (card.flags && card.flags.start) || { x: 0, y: 0, z: 0 };
    return { dirtyChunks, spawn: localToWorld(s.x, s.y, s.z) };
}
