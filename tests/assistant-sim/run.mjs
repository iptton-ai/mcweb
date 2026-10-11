#!/usr/bin/env node
// ==================== assistant-sim 运行器 ====================
// 无界面驱动真实 AI 助手对话：真实 LLM（OpenAI 兼容流式）+ 真实 agent 循环 +
// 真实世界数据（地形生成/施工队列/红石/动力），只把渲染层垫掉（见 hooks.mjs）。
//
// 用法（Key 走环境变量，绝不落盘/入库）：
//   MCWEB_SIM_LLM_KEY=sk-xxx node tests/assistant-sim/run.mjs "帮我建一个电梯" [选项]
// 选项：
//   --seed N         世界种子（默认 20260921，可复现）
//   --model X        模型名（默认 gpt-5.5）
//   --base URL       OpenAI 兼容 baseUrl（默认 https://runanytime.hxi.me/v1）
//   --origin URL     本地 server.py 地址（文件类工具走它，默认 http://127.0.0.1:8000）
//   --iterations N   覆盖 maxToolIterations（默认用游戏默认 30）
//   --jev            启用 Jev 快速路由（走 api.typesafe.ai 官方端点，需要 TYPESAFE_API_KEY）
//   --out FILE       trace 输出路径（默认 tests/assistant-sim/out/<时间戳>-trace.json）
//   --quiet          不打印逐轮日志
import { register } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ---------- CLI ----------
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);
const message = argv.find((a) => !a.startsWith('--')) || '帮我建一个电梯';
const seed = Number(flag('seed', 20260921)) | 0;
const origin = flag('origin', 'http://127.0.0.1:8000');
const baseUrl = flag('base', process.env.MCWEB_SIM_LLM_BASE || 'https://runanytime.hxi.me/v1');
const model = flag('model', process.env.MCWEB_SIM_LLM_MODEL || 'gpt-5.5');
const apiKey = process.env.MCWEB_SIM_LLM_KEY || '';
const iterations = Number(flag('iterations', 0)) || undefined;
const quiet = has('quiet');

if (!apiKey) {
    console.error('缺少 MCWEB_SIM_LLM_KEY 环境变量（真实 LLM 的 API Key，只存在于本次进程环境）。');
    process.exit(1);
}

// 模块顶层 DOM 副作用（如 eduKeypad 的定时器）若有未捕获异常，记录但不让整个模拟崩掉
process.on('uncaughtException', (e) => {
    console.error('[uncaughtException]', e && e.message);
});

// ---------- 先垫平台、再挂钩子，之后才允许 import 游戏模块 ----------
const { installShims } = await import('./browser-shims.mjs');
installShims({ origin });
register('./hooks.mjs', import.meta.url);

const { state } = await import('../../js/state.js');
const config = await import('../../js/config.js');
const world = await import('../../js/world.js');
const { initRedstone } = await import('../../js/redstone.js');
const buildQueue = await import('../../js/buildQueue.js');
const { runAgentTurn } = await import('../../js/assistant/agent.js');
const { saveConfig } = await import('../../js/assistant/llm.js');
const toolsMod = await import('../../js/assistant/tools.js');
const docsMod = await import('../../js/assistant/docs.js');
const jevMod = await import('../../js/assistant/jev.js');
const uiMod = await import('../../js/assistant/ui.js');

// ---------- 初始化 LLM / Jev / 文件 API ----------
saveConfig({
    baseUrl, apiKey, model,
    temperature: 0.7,
    ...(iterations ? { maxToolIterations: iterations } : {}),
    ...(flag('extra', '') ? { extraInstructions: flag('extra', '') } : {}),
});
toolsMod.setFileApiOnline(true); // 本地 server.py 提供 /api/*（与真实浏览器场景一致）
let jevOn = false;
if (has('jev')) {
    const tsKey = process.env.TYPESAFE_API_KEY;
    if (!tsKey) { console.error('--jev 需要 TYPESAFE_API_KEY 环境变量'); process.exit(1); }
    jevMod.saveJevConfig({
        enabled: true, apiKey: tsKey, model: 'jev-1.13.0',
        // 无 CORS 限制的 Node 直连官方端点（浏览器侧才需要 CF Worker 网关补 CORS）
        gateway: flag('jev-gateway', 'https://api.typesafe.ai/v1/systemone'),
    });
    jevOn = true;
}

// ---------- 复刻 main.js freshWorld 的开局（固定种子可复现） ----------
state.worldSeed = seed;
world.generateWorld();
const { WORLD_WIDTH, WORLD_HEIGHT, WORLD_DEPTH } = config;
const spawnX = Math.floor(WORLD_WIDTH / 2);
const spawnZ = Math.floor(WORLD_DEPTH / 2);
let spawnY = 1;
for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
    const b = world.getBlock(spawnX, y, spawnZ);
    if (b !== config.BlockTypes.AIR && b !== config.BlockTypes.WATER) { spawnY = y + 1; break; }
}
state.player.x = spawnX;
state.player.y = spawnY;
state.player.z = spawnZ;
state.player.yaw = 0;
state.spawn = { x: spawnX, y: spawnY, z: spawnZ };
state.time = state.dayLength * 0.3; // 清晨开局（与真实新世界一致）
initRedstone();
uiMod.initUI(); // 真实助手 UI 初始化（DOM 落到垫片上）：els.toast 等就位，建造工具的提示不炸

// ---------- fetch 计量（真实请求原样透传，只记录字节与耗时） ----------
const httpLog = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const t0 = Date.now();
    const reqBytes = typeof init?.body === 'string' ? Buffer.byteLength(init.body) : 0;
    const res = await realFetch(input, init);
    httpLog.push({
        kind: url.includes('/systemone') ? 'jev' : url.includes('/api/') ? 'file-api' : 'llm',
        url: url.replace(/(key|apikey|authorization)[=:]?[^&]*/gi, '$1***'),
        reqBytes, status: res.status, ms: Date.now() - t0,
    });
    return res;
};

// ---------- 施工队列泵（等价游戏主循环每帧 updateBuild(dt)） ----------
const pump = setInterval(() => {
    try { buildQueue.updateBuild(0.05); } catch (e) { console.error('[updateBuild]', e.message); }
}, 8);

// ---------- 驱动一轮真实对话 ----------
const session = { id: 'assistant-sim', title: 'sim', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: message }] };
const trace = {
    message, seed, model, baseUrl, jev: jevOn, extra: flag('extra', '') || undefined,
    startedAt: new Date().toISOString(),
    systemPromptChars: docsMod.buildFinalSystemPrompt().length,
    toolSchemaChars: JSON.stringify(toolsMod.getToolSchemas()).length,
    rounds: [], finalText: '', reloading: false,
};
const log = (...a) => { if (!quiet) console.log(...a); };

let roundIdx = 0;
let lastMark = Date.now();
let curRound = null;
const t0 = Date.now();

try {
    const result = await runAgentTurn({
        session,
        signal: undefined,
        onStatus: (s) => { log(`  [status] ${s}`); },
        onReasoningText: () => { /* 思考流不落日志，长度记进轮次 */ },
        onAssistantDone: (msg) => {
            roundIdx++;
            curRound = {
                round: roundIdx, ms: Date.now() - lastMark, contentChars: (msg.content || '').length,
                reasoningChars: (msg.reasoning || '').length, tools: [],
            };
            trace.rounds.push(curRound);
            lastMark = Date.now();
            log(`\n== LLM 第 ${roundIdx} 轮（${curRound.ms}ms，正文 ${curRound.contentChars} 字符${curRound.reasoningChars ? `，思考 ${curRound.reasoningChars}` : ''}）`);
            if (msg.content) log('   说明: ' + msg.content.slice(0, 300).replace(/\n/g, ' '));
            for (const tc of msg.toolCalls || []) {
                let args = {};
                try { args = JSON.parse(tc.arguments || '{}'); } catch { /* 原样 */ }
                const brief = {};
                for (const [k, v] of Object.entries(args)) {
                    brief[k] = typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + `…(${v.length})`
                        : Array.isArray(v) ? `[${v.length} 项]` : v;
                }
                log(`   🔧 ${tc.name} ${JSON.stringify(brief)}`);
                const rec = { name: tc.name, argsChars: (tc.arguments || '').length, argsBrief: brief };
                if (tc.name === 'run_build_script') rec.codeFull = String(args.code || ''); // trace 留全码，供复现实验
                curRound.tools.push(rec);
            }
        },
        onToolCall: () => { /* 已在 onAssistantDone 记录 */ },
        onToolResult: (toolMsg) => {
            if (!curRound) return;
            const c = String(toolMsg.content || '');
            curRound.tools.push({ resultChars: c.length, isError: !!toolMsg.isError, resultPreview: c.slice(0, 500) });
            log(`      ↳ ${toolMsg.isError ? '❌' : '✅'} ${c.length} 字符: ${c.slice(0, 220).replace(/\n/g, ' ')}`);
            lastMark = Date.now();
        },
    });
    trace.finalText = result.finalText;
    trace.reloading = result.reloading;
} catch (e) {
    trace.error = String(e && e.stack || e);
    console.error('\n[对话异常]', e);
} finally {
    clearInterval(pump);
}

trace.totalMs = Date.now() - t0;
trace.http = httpLog;
trace.messages = session.messages.map((m) => ({
    role: m.role, name: m.name || undefined,
    contentChars: String(m.content || '').length,
    content: String(m.content || '').slice(0, 6000),
    toolCalls: m.toolCalls ? m.toolCalls.map((t) => ({ name: t.name, argumentsChars: (t.arguments || '').length })) : undefined,
    isError: m.isError,
}));

// ---------- 世界验收：统计电梯相关方块是否真的放下了 ----------
const tally = { 传动轴: 0, 水车: 0, 电梯平台: 0, 滑轮: 0 };
for (let i = 0; i < state.blocks.length; i++) {
    const id = state.blocks[i];
    if (id >= config.SHAFT_BASE && id < config.SHAFT_BASE + config.SHAFT_COUNT) tally.传动轴++;
    else if (id >= config.WATERWHEEL_BASE && id < config.WATERWHEEL_BASE + config.WATERWHEEL_COUNT) tally.水车++;
    else if (id === config.PLATFORM_BASE) tally.电梯平台++;
    else if (config.isPulleyId(id)) tally.滑轮++;
}
trace.worldCheck = { 玩家出生: { x: spawnX, y: spawnY, z: spawnZ }, 电梯相关方块: tally };
// 功能核检：对每个滑轮/水车/离合器查动力网络运行时状态（绳绑定了吗/在转吗/应力超载吗）
try {
    const kinetic = await import('../../js/kinetic.js');
    const found = [];
    for (let i = 0; i < state.blocks.length && found.length < 40; i++) {
        const id = state.blocks[i];
        if (config.isPulleyId(id) || (id >= config.WATERWHEEL_BASE && id < config.WATERWHEEL_BASE + config.WATERWHEEL_COUNT)) {
            const y = Math.floor(i / (config.WORLD_WIDTH * config.WORLD_DEPTH));
            const rem = i % (config.WORLD_WIDTH * config.WORLD_DEPTH);
            const z = Math.floor(rem / config.WORLD_WIDTH);
            const x = rem % config.WORLD_WIDTH;
            found.push({ kind: config.isPulleyId(id) ? '滑轮' : '水车', x, y, z });
        }
    }
    trace.worldCheck.动力状态 = found.map((p) => ({
        ...p,
        status: kinetic.kineticStatusAt(p.x, p.y, p.z) || '(无状态)',
    }));
} catch (e) { trace.worldCheck.动力状态 = '核检失败: ' + e.message; }

// ---------- 输出 ----------
const llmCalls = httpLog.filter((h) => h.kind === 'llm');
const summary = {
    轮数: trace.rounds.length, 总耗时秒: +(trace.totalMs / 1000).toFixed(1),
    LLM请求数: llmCalls.length, LLM上行字节: llmCalls.reduce((s, h) => s + h.reqBytes, 0),
    系统提示符: trace.systemPromptChars, 工具Schema符: trace.toolSchemaChars,
    世界验收: trace.worldCheck.电梯相关方块,
};
trace.summary = summary;

console.log('\n──────── 总结 ────────');
console.log(JSON.stringify(summary, null, 2));
console.log('\n最终回复：\n' + (trace.finalText || trace.error || '(空)').slice(0, 2000));

const outPath = flag('out', join(here, 'out', `${Date.now()}-${(message || 'sim').slice(0, 12).replace(/\s/g, '_')}${jevOn ? '-jev' : ''}-trace.json`));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(trace, null, 1));
console.log('\ntrace 已写入: ' + outPath);
process.exit(0);
