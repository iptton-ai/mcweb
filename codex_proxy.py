#!/usr/bin/env python3
# ==================== codex_proxy.py ====================
# 本地 Codex 订阅反代：把 OpenAI 兼容 /chat/completions 请求桥接到 ChatGPT
# Codex 后端（Responses API），让游戏内 AI 助手复用本机 Codex CLI 的订阅额度。
# 仅 Python 标准库；仅限本机开发使用（公网部署绝不暴露此路由）。
#
# 原理：
#   - 凭据来自 ~/.codex/auth.json（Codex CLI 登录态，auth_mode=chatgpt 的 OAuth token）
#   - access_token 临过期自动用 refresh_token 刷新并原子回写 auth.json（与 CLI 共存）
#   - 请求转换：chat completions 的 messages/tools → responses 的 instructions/input/tools
#   - SSE 转换：response.output_text.delta → delta.content
#               response.function_call_arguments.delta → delta.tool_calls 增量
#               response.reasoning_summary_text.delta → delta.reasoning_content（思考折叠展示）
#   - 上游端点/头部照 codex_cli_rs 0.147.0 的 wire format（originator / OpenAI-Beta /
#     session_id / chatgpt-account-id），值取自本机 codex 二进制提取，升级 CLI 后如
#     401/403 可先试 `codex login` 再核对 client_id 是否更换。
#
# 助手侧配置（js/assistant/llm.js 是标准 OpenAI 兼容客户端，零改动）：
#   baseUrl = http://localhost:8000/codex/v1   apiKey = 任意非空   model = gpt-5.5

import base64
import json
import os
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

CODEX_HOME = os.environ.get("CODEX_HOME", os.path.expanduser("~/.codex"))
AUTH_PATH = os.path.join(CODEX_HOME, "auth.json")
TOKEN_URL = "https://auth.openai.com/oauth/token"
RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses"
# codex-cli 0.147.0 的公开 OAuth client_id（codex login 用的同一应用）
CODEX_CLIENT_ID = "app_69a1d78e929881919bba0dbda1f6436d"
# version 头参与后端的模型门禁：新模型（如 gpt-6-astra）要求新版号才放行，门禁只看
# 这个字符串、与本地 CLI 实际版本无关。设为 npm @openai/codex 已知最新版（2026-09-06
# 为 0.153.4）；再遇到 "requires a newer version of Codex" 时查 npm 最新版把这里提上去
# （curl -s https://registry.npmjs.org/@openai/codex/latest）。
CODEX_VERSION = "0.153.4"
DEFAULT_MODEL = "gpt-5.5"
REASONING_EFFORT = "low"        # 默认推理深度：游戏建造任务够用且响应快
REASONING_EFFORTS = ("minimal", "low", "medium", "high")  # 请求可带 reasoning_effort 覆盖默认
REFRESH_MARGIN_S = 120          # access_token 剩余有效期低于此值先刷新
UPSTREAM_TIMEOUT_S = 300        # 上游连接/读超时（推理模型长思考也要兜住）


class CodexProxyError(Exception):
    """代理可向客户端报告的错误（status 用于 HTTP 响应码）"""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


# ---------------- OAuth 凭据管理 ----------------

_auth_lock = threading.Lock()   # 并发请求只允许一次刷新


def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _jwt_payload(token):
    """解 JWT payload（不校验签名，只取 exp / account claim）"""
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part))
    except Exception:  # noqa: BLE001 非法 token 当作无信息处理
        return {}


def _jwt_exp(token):
    return int(_jwt_payload(token).get("exp") or 0)


def _account_from_id_token(id_token):
    auth_claim = _jwt_payload(id_token).get("https://api.openai.com/auth") or {}
    return auth_claim.get("chatgpt_account_id") or ""


def _read_auth_file():
    if not os.path.isfile(AUTH_PATH):
        raise CodexProxyError(
            f"未找到 {AUTH_PATH}：请先安装 Codex CLI 并执行 `codex login`（ChatGPT 账号登录）", 500
        )
    try:
        with open(AUTH_PATH, "r", encoding="utf-8") as f:
            auth = json.load(f)
    except (OSError, ValueError) as e:
        raise CodexProxyError(f"读取 Codex 凭据失败：{e}", 500)
    if auth.get("auth_mode") != "chatgpt":
        raise CodexProxyError(
            "Codex 当前不是 ChatGPT 订阅登录态（auth_mode != chatgpt），"
            "本代理只桥接订阅额度，请 `codex login` 用 ChatGPT 账号登录", 500
        )
    return auth


def _save_auth_file(auth, tokens):
    """原子回写 auth.json（保留其他字段；与 Codex CLI 的写法共存）"""
    new_auth = dict(auth)
    new_auth["tokens"] = tokens
    new_auth["last_refresh"] = _now_iso()
    os.makedirs(CODEX_HOME, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=CODEX_HOME, prefix=".auth.json.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(new_auth, f)
        os.replace(tmp, AUTH_PATH)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _refresh_tokens(auth):
    tokens = auth.get("tokens") or {}
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        raise CodexProxyError("Codex 凭据缺 refresh_token，请重新 `codex login`", 401)
    body = json.dumps({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CODEX_CLIENT_ID,
    }).encode("utf-8")
    req = urllib.request.Request(TOKEN_URL, data=body, headers={
        "Content-Type": "application/json",
        "User-Agent": f"codex_cli_rs/{CODEX_VERSION}",
    }, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:200]
        except OSError:
            pass
        raise CodexProxyError(
            f"Codex token 刷新失败（{e.code} {detail}）：请在终端重新 `codex login`", 401
        )
    except OSError as e:
        raise CodexProxyError(f"连接 OpenAI 认证服务失败：{e}", 502)
    id_token = data.get("id_token") or tokens.get("id_token") or ""
    new_tokens = {
        "id_token": id_token,
        "access_token": data.get("access_token") or "",
        "refresh_token": data.get("refresh_token") or refresh_token,
        "account_id": data.get("account_id") or tokens.get("account_id")
        or _account_from_id_token(id_token),
    }
    if not new_tokens["access_token"]:
        raise CodexProxyError("Codex token 刷新响应异常（无 access_token）", 502)
    try:
        _save_auth_file(auth, new_tokens)
    except OSError as e:
        raise CodexProxyError(f"回写 Codex 凭据失败：{e}", 500)  # 内存里仍可用，但提示修复
    return new_tokens


def get_auth(force=False):
    """返回 {'access_token','account_id'}，临过期自动刷新"""
    with _auth_lock:
        auth = _read_auth_file()
        tokens = auth.get("tokens") or {}
        access = tokens.get("access_token") or ""
        if not force and access and _jwt_exp(access) > time.time() + REFRESH_MARGIN_S:
            return {"access_token": access, "account_id": tokens.get("account_id") or ""}
        tokens = _refresh_tokens(auth)
        return {"access_token": tokens["access_token"],
                "account_id": tokens.get("account_id") or ""}


# ---------------- 请求转换（chat completions → responses） ----------------

def _reasoning_effort(req):
    """请求带合法 reasoning_effort 则覆盖默认档（助手面板「推理深度」下拉的来源）"""
    v = str(req.get("reasoning_effort") or "").strip().lower()
    return v if v in REASONING_EFFORTS else REASONING_EFFORT


def _to_responses_payload(req):
    model = str(req.get("model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    instructions, input_items = [], []
    for m in req.get("messages") or []:
        role = m.get("role")
        content = m.get("content")
        if role in ("system", "developer"):
            if content:
                instructions.append(str(content))
        elif role == "user":
            input_items.append({"type": "message", "role": "user",
                                "content": [{"type": "input_text", "text": str(content or "")}]})
        elif role == "assistant":
            if content:
                input_items.append({"type": "message", "role": "assistant",
                                    "content": [{"type": "output_text", "text": str(content)}]})
            for tc in m.get("tool_calls") or []:
                fn = tc.get("function") or {}
                input_items.append({"type": "function_call",
                                    "name": str(fn.get("name") or ""),
                                    "arguments": str(fn.get("arguments") or "{}"),
                                    "call_id": str(tc.get("id") or "")})
        elif role == "tool":
            # 工具结果必须回传给同一 call_id，否则后端 400
            input_items.append({"type": "function_call_output",
                                "call_id": str(m.get("tool_call_id") or ""),
                                "output": str(content or "")})
    payload = {
        "model": model,
        "input": input_items,
        "stream": True,
        "store": False,
        "parallel_tool_calls": False,
        "reasoning": {
            "effort": _reasoning_effort(req),
            "summary": "auto",
        },
        "include": ["reasoning.encrypted_content"],
    }
    if instructions:
        payload["instructions"] = "\n\n".join(instructions)
    tools = []
    for t in req.get("tools") or []:
        fn = t.get("function") if isinstance(t, dict) else None
        if t.get("type") == "function" and fn:
            tools.append({
                "type": "function",
                "name": fn.get("name") or "",
                "description": str(fn.get("description") or ""),
                "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
                "strict": False,
            })
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    return payload, model


def _open_upstream(payload, auth):
    headers = {
        "Authorization": "Bearer " + auth["access_token"],
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "originator": "codex_cli_rs",
        "OpenAI-Beta": "responses=experimental",
        "session_id": str(uuid.uuid4()),
        "version": CODEX_VERSION,
        "User-Agent": f"codex_cli_rs/{CODEX_VERSION} (Mac OS 15.6.0; arm64)",    }
    if auth.get("account_id"):
        headers["chatgpt-account-id"] = auth["account_id"]
    req = urllib.request.Request(
        RESPONSES_URL, data=json.dumps(payload).encode("utf-8"),
        headers=headers, method="POST",
    )
    return urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT_S)


def _upstream_error_message(ev):
    err = ev.get("error") or {}
    if isinstance(err, dict) and err.get("message"):
        return f"{err.get('code') or 'error'}: {err['message']}"
    if isinstance(err, str) and err:
        return err
    return json.dumps(ev, ensure_ascii=False)[:300]


# ---------------- SSE 流式转换（responses 事件 → chat completion chunk） ----------------

def stream_chat_completions(req):
    """generator：yield chat.completion.chunk 字典（llm.js 按 OpenAI 流式增量解析消费）"""
    payload, model = _to_responses_payload(req)

    def attempt(auth):
        try:
            return _open_upstream(payload, auth)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                # token 可能已被吊销/轮换：强刷一次再试
                detail = b""
                try:
                    detail = e.read()
                except OSError:
                    pass
                retry_auth = get_auth(force=True)
                try:
                    return _open_upstream(payload, retry_auth)
                except urllib.error.HTTPError:
                    raise CodexProxyError(
                        f"Codex 上游拒绝访问（{e.code} {detail.decode('utf-8', 'replace')[:200]}）："
                        "请确认订阅有效，必要时 `codex login`", 401
                    )
            try:
                detail = e.read().decode("utf-8", "replace")[:300]
            except OSError:
                detail = ""
            raise CodexProxyError(f"Codex 上游返回 {e.code}：{detail}", 502)

    resp = attempt(get_auth())

    cid = "chatcmpl-codex-" + uuid.uuid4().hex[:12]
    created = int(time.time())

    def chunk(delta, finish=None, usage=None):
        obj = {"id": cid, "object": "chat.completion.chunk", "created": created,
               "model": model, "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
        if usage:
            obj["usage"] = usage
        return obj

    call_index = {}        # responses item_id → tool_calls index
    call_args_seen = {}    # index → 已发出的 arguments（兜底去重）
    try:
        for raw in resp:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            try:
                ev = json.loads(data)
            except ValueError:
                continue
            etype = ev.get("type")
            if etype == "response.output_text.delta":
                if ev.get("delta"):
                    yield chunk({"content": ev["delta"]})
            elif etype == "response.reasoning_summary_text.delta":
                if ev.get("delta"):
                    yield chunk({"reasoning_content": ev["delta"]})
            elif etype == "response.output_item.added":
                item = ev.get("item") or {}
                if item.get("type") == "function_call":
                    idx = len(call_index)
                    call_index[item.get("id")] = idx
                    call_args_seen[idx] = ""
                    yield chunk({"tool_calls": [{
                        "index": idx, "id": item.get("call_id") or "",
                        "type": "function",
                        "function": {"name": item.get("name") or "", "arguments": ""},
                    }]})
            elif etype == "response.function_call_arguments.delta":
                idx = call_index.get(ev.get("item_id"))
                d = ev.get("delta") or ""
                if idx is not None and d:
                    call_args_seen[idx] += d
                    yield chunk({"tool_calls": [{"index": idx, "function": {"arguments": d}}]})
            elif etype == "response.output_item.done":
                item = ev.get("item") or {}
                if item.get("type") == "function_call":
                    idx = call_index.get(item.get("id"))
                    full = item.get("arguments") or ""
                    # 兜底：参数没走增量通道（如空参被跳过）时一次性补发
                    if idx is not None and full and not call_args_seen.get(idx):
                        call_args_seen[idx] = full
                        yield chunk({"tool_calls": [{"index": idx, "function": {"arguments": full}}]})
            elif etype == "response.completed":
                usage_src = (ev.get("response") or {}).get("usage") or {}
                usage = None
                if usage_src.get("input_tokens") is not None:
                    usage = {"prompt_tokens": usage_src.get("input_tokens"),
                             "completion_tokens": usage_src.get("output_tokens"),
                             "total_tokens": usage_src.get("total_tokens")}
                finish = "tool_calls" if call_index else "stop"
                yield chunk({}, finish=finish, usage=usage)
            elif etype in ("response.failed", "error"):
                # 流中途失败：以正文形式透出原因（llm.js 会在面板渲染并停止）
                yield chunk({"content": f"\n⚠️ Codex 上游错误：{_upstream_error_message(ev)}"})
    finally:
        try:
            resp.close()
        except OSError:
            pass
