// ==================== assistant/sessions.js ====================
// 会话管理：多会话 + 消息持久化（localStorage）
// 消息统一结构：
//   { role:'user',      content }
//   { role:'assistant', content, reasoning?, toolCalls?: [{id, name, arguments}] }
//     reasoning = 思考模型返回的思考文本，仅供前端折叠展示，不回传 LLM
//   { role:'tool',      toolCallId, name, content, isError? }
//   { role:'user', meta:'system', content }  // 系统事件（重载恢复等），发给 LLM 时加前缀

const STORE_KEY = 'mcAssistant.sessions.v1';

// 持久化时截短超长文本：工具结果单条可达 3 万字符、思考文本同理，多会话长期积累会把
// localStorage 与每次 persist 的全量 JSON.stringify 撑大。内存里的消息保持完整
// （发给 LLM 的截断在 agent.js toApiMessage），只有落盘副本被截短。
const PERSIST_TEXT_MAX = 8000;

function slimMessageForPersist(m) {
    let content = m.content;
    if (typeof content === 'string' && content.length > PERSIST_TEXT_MAX) {
        content = content.slice(0, PERSIST_TEXT_MAX) + `…（已截短，原长 ${content.length} 字符）`;
    }
    let reasoning = m.reasoning;
    if (typeof reasoning === 'string' && reasoning.length > PERSIST_TEXT_MAX) {
        reasoning = reasoning.slice(0, PERSIST_TEXT_MAX) + `…（已截短，原长 ${reasoning.length} 字符）`;
    }
    if (content === m.content && reasoning === m.reasoning) return m;
    return { ...m, content, reasoning };
}

let store = null;

function loadStore() {
    if (store) return store;
    try {
        store = JSON.parse(localStorage.getItem(STORE_KEY));
    } catch {
        store = null;
    }
    if (!store || !Array.isArray(store.sessions)) {
        store = { activeId: null, sessions: [] };
    }
    if (store.sessions.length === 0) {
        createSession('新会话');
    }
    if (!store.sessions.find((s) => s.id === store.activeId)) {
        store.activeId = store.sessions[0].id;
    }
    return store;
}

function persist() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(slimStoreForPersist()));
    } catch {
        // 超出 localStorage 配额：丢弃最旧会话的消息后重试
        const sorted = [...store.sessions].sort((a, b) => a.updatedAt - b.updatedAt);
        for (const s of sorted) {
            if (store.sessions.length <= 3) break;
            s.messages = [];
        }
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(slimStoreForPersist()));
        } catch { /* 仍失败则放弃持久化，内存中可用 */ }
    }
}

// 落盘用的瘦身副本：截短超长工具结果/思考文本（原对象不动，内存与 LLM 侧不受影响）
function slimStoreForPersist() {
    return { ...store, sessions: store.sessions.map((s) => ({ ...s, messages: s.messages.map(slimMessageForPersist) })) };
}

function newId() {
    return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function createSession(title = '新会话') {
    const s = {
        id: newId(),
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
    };
    loadStore().sessions.unshift(s);
    store.activeId = s.id;
    persist();
    return s;
}

export function getActiveSession() {
    const st = loadStore();
    return st.sessions.find((s) => s.id === st.activeId) || st.sessions[0];
}

export function getSession(id) {
    return loadStore().sessions.find((s) => s.id === id) || null;
}

export function listSessions() {
    return loadStore().sessions;
}

export function setActiveSession(id) {
    const st = loadStore();
    if (st.sessions.find((s) => s.id === id)) {
        st.activeId = id;
        persist();
    }
}

export function deleteSession(id) {
    const st = loadStore();
    st.sessions = st.sessions.filter((s) => s.id !== id);
    if (st.sessions.length === 0) createSession('新会话');
    if (!st.sessions.find((s) => s.id === st.activeId)) {
        st.activeId = st.sessions[0].id;
    }
    persist();
}

export function getActiveSessionId() {
    return loadStore().activeId;
}

// 首条用户消息自动作为会话标题
export function autoTitle(session) {
    if (session.title && session.title !== '新会话') return;
    const firstUser = session.messages.find((m) => m.role === 'user' && m.meta !== 'system');
    if (firstUser) {
        session.title = firstUser.content.replace(/\s+/g, ' ').slice(0, 24) || '新会话';
    }
}

export function touchSession(session) {
    session.updatedAt = Date.now();
    persist();
}
