// ==================== assistant/index.js ====================
// 助手装配入口：由 boot.js 在游戏主模块加载完成后动态 import 并调用 initAssistant()
// 职责：初始化 UI / 探测文件 API / 监听文件变更事件 / 恢复世界快照 / 自动续跑热重载前的任务

import { initUI, handleKeydown, sendUserMessage, setReloadDirty, toast } from './ui.js';
import { restoreSnapshotIfAny } from './snapshot.js';
import { setFileApiOnline } from './tools.js';
import { isConfigured } from './llm.js';

const RESUME_KEY = 'mcAssistant.resumeTask';

// ---------- 文件 API 探测 ----------
async function probeFileApi() {
    try {
        const resp = await fetch('/api/files', { method: 'GET' });
        if (resp.ok) {
            setFileApiOnline(true);
            return true;
        }
    } catch { /* 忽略 */ }
    // 静态托管上这次探测必然 404，浏览器会在控制台打一行网络日志——JS 无法抑制，
    // 只能跟一句说明防止误读为故障；世界建造工具不依赖文件 API，不受影响。
    console.info('[AI助手] 文件 API 不可用（静态托管属预期）：源码改码/热重载停用，世界建造不受影响');
    setFileApiOnline(false);
    return false;
}

// ---------- 文件变更监听（SSE） ----------
function connectFileEvents() {
    if (!location.protocol.startsWith('http')) return;
    // EventSource 断线会自动重连；服务端无此接口时静默失败
    const es = new EventSource('/api/events');
    es.addEventListener('change', (e) => {
        try {
            const data = JSON.parse(e.data);
            setReloadDirty(true, data.path);
        } catch { /* 忽略 */ }
    });
    es.onerror = () => { /* 静默：无 server.py 时属于正常情况 */ };
}

// ---------- 热重载后的任务续跑 ----------
function handleResumeTask() {
    let task = null;
    try {
        const raw = sessionStorage.getItem(RESUME_KEY);
        if (raw) {
            task = JSON.parse(raw);
            sessionStorage.removeItem(RESUME_KEY);
        }
    } catch { task = null; }
    if (!task) return;

    const note = '🔄 游戏已热重载完成，世界与玩家状态已恢复。';
    if (isConfigured()) {
        // 自动让 AI 继续之前的任务（先自查错误再汇报）
        setTimeout(() => {
            sendUserMessage(
                '（自动继续）页面热重载已完成。请先调用 get_runtime_errors 检查有无新错误；' +
                '若有错误则读取相关文件修复并再次 reload_game；若一切正常，请简要总结本次修改结果与使用方法。',
                { hidden: true },
            );
        }, 900);
    } else {
        toast(note + '（未配置 LLM，无法自动继续任务）');
    }
}

// ---------- 全局错误捕获（boot.js 早期已装基础版，这里补游戏内细节） ----------
export function recordRuntimeError(message, source = '') {
    let errs = [];
    try {
        errs = JSON.parse(sessionStorage.getItem('mcAssistant.runtimeErrors')) || [];
    } catch { errs = []; }
    errs.push({ time: Date.now(), message: String(message).slice(0, 500), source: String(source).slice(0, 200) });
    try {
        sessionStorage.setItem('mcAssistant.runtimeErrors', JSON.stringify(errs.slice(-40)));
    } catch { /* 配额不足则放弃 */ }
}

export function initAssistant() {
    // 1. 恢复热重载前的世界快照（必须在 UI 交互前完成）
    let restored = false;
    try {
        restored = restoreSnapshotIfAny();
    } catch (e) {
        console.error('世界快照恢复失败：', e);
        recordRuntimeError('快照恢复失败: ' + e.message);
    }

    // 2. 界面（含 T 键开关：捕获阶段监听，优先于游戏输入）
    initUI();
    document.addEventListener('keydown', handleKeydown, true);
    if (restored) {
        toast('🔄 已从热重载恢复世界与玩家状态', 3000);
    }

    // 3. 文件 API + 变更监听
    probeFileApi().then((online) => {
        if (online) connectFileEvents();
    });

    // 4. 热重载前的任务自动续跑
    handleResumeTask();
}
