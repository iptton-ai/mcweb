#!/usr/bin/env python3
# ==================== server.py ====================
# 「我的世界 - 网页复刻版」本地开发服务器（仅用 Python 标准库，无第三方依赖）
#
# 功能：
#   1. 静态文件服务（等价 python3 -m http.server，但强制 .js 返回 text/javascript，
#      否则部分系统上 ES Module 会因 MIME 错误被浏览器拒绝执行）
#   2. GET  /api/files            列出项目源码文件（供游戏内 AI 助手使用）
#      GET  /api/file?path=...    读取单个文件
#      POST /api/file             写入文件 {path, content}（自动备份原文件）
#   3. GET  /api/events           SSE 事件流：文件被助手修改后推送 change 事件（热加载通知）
#   4. POST /codex/v1/chat/completions  本地 Codex 订阅反代（codex_proxy.py：把 OpenAI
#      兼容请求桥接到 ChatGPT Codex 后端，凭据复用 ~/.codex 的 CLI 登录态，详见该文件头）
#
# 公网 OpenAI 兼容上游仍由助手在浏览器内直连；Codex 订阅因 OAuth 凭据与协议差异必须经
# 本地桥接（同源无 CORS 问题）。server-rust 不实现此路由（纯本机开发功能）。
#
# 启动：python3 server.py [--port 8000] [--host 127.0.0.1]

import argparse
import json
import os
import queue
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import codex_proxy

ROOT = os.path.dirname(os.path.abspath(__file__))
ENTRY_HTML = "index.html"                         # 唯一入口（重命名需同步 server-rust 与 AGENTS.md）
BACKUP_DIR = "assistant_backups"                  # 助手写文件前的自动备份目录
MAX_WRITE_BYTES = 5 * 1024 * 1024                 # 单次写入上限 5MB
WRITE_EXTS = {".js", ".html", ".css", ".json", ".md", ".txt"}  # 允许助手写入的扩展名
SKIP_DIRS = {".git", "__pycache__", BACKUP_DIR}

# ---- SSE 客户端队列（多线程广播） ----
_sse_lock = threading.Lock()
_sse_queues = []


def broadcast_event(name, data):
    """向所有 /api/events 连接推送一条事件"""
    with _sse_lock:
        targets = list(_sse_queues)
    for q in targets:
        q.put((name, data))


def resolve_safe(rel):
    """把相对路径解析为项目根目录内的绝对路径，越界即拒绝"""
    rel = (rel or "").strip().lstrip("/\\")
    if not rel:
        raise ValueError("path 不能为空")
    p = os.path.realpath(os.path.join(ROOT, rel))
    if p != ROOT and not p.startswith(ROOT + os.sep):
        raise ValueError("路径越界：" + rel)
    return p


class GameRequestHandler(SimpleHTTPRequestHandler):

    # 强制正确的 MIME：macOS 等系统可能把 .js 映射成 text/plain，ES Module 会拒绝执行
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".html": "text/html; charset=utf-8",
    }

    # ---------- 基础 ----------

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 32 * 1024 * 1024:
            raise ValueError("请求体大小异常")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    # ---------- 路由 ----------

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path
        try:
            if route == "/":
                return self.send_entry()
            if route == "/api/files":
                return self.api_files()
            if route == "/api/file":
                return self.api_file_read(parsed)
            if route == "/api/events":
                return self.api_events()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            return
        except Exception as e:  # noqa: BLE001 统一转成 JSON 错误
            return self._send_json({"error": str(e)}, 400)
        return super().do_GET()  # 其余走静态文件

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path
        try:
            if route == "/api/file":
                return self.api_file_write()
            if route == "/codex/v1/chat/completions":
                return self.api_codex_chat()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            return
        except Exception as e:  # noqa: BLE001
            return self._send_json({"error": str(e)}, 400)
        self._send_json({"error": "未知接口：" + route}, 404)

    def end_headers(self):
        # 静态文件原本不发缓存头，浏览器启发式缓存会把旧 JS 混着新 JS 一起加载，
        # 改码后页面直接模块加载失败（线上 nginx 已按 HTML/JS/CSS no-cache 处理，
        # 见 AGENTS.md「缓存策略」；本地服务器行为对齐）。已有 Cache-Control 的
        # 响应（API JSON 的 no-store / SSE 的 no-cache）不重复注入。
        buf = b" ".join(getattr(self, "_headers_buffer", []) or [])
        if b"Cache-Control" not in buf:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---------- 静态 ----------

    def send_entry(self):
        """把 / 映射到入口 HTML，方便直接访问 http://localhost:8000/"""
        path = os.path.join(ROOT, ENTRY_HTML)
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---------- /api/files ----------

    def api_files(self):
        files = []
        for cur, dirs, names in os.walk(ROOT):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
            for name in names:
                if name.startswith(".") or ".bak" in name:
                    continue  # 排除隐藏文件与历史备份
                ext = os.path.splitext(name)[1].lower()
                if ext not in WRITE_EXTS:
                    continue
                full = os.path.join(cur, name)
                rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                files.append({"path": rel, "size": st.st_size, "mtime": int(st.st_mtime)})
        files.sort(key=lambda f: f["path"])
        self._send_json({"files": files, "root": ENTRY_HTML})

    # ---------- /api/file ----------

    def api_file_read(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        rel = (qs.get("path") or [""])[0]
        full = resolve_safe(rel)
        if not os.path.isfile(full):
            return self._send_json({"error": "文件不存在：" + rel}, 404)
        with open(full, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        self._send_json({"path": rel, "content": content})

    def api_file_write(self):
        data = self._read_json_body()
        rel = data.get("path", "")
        content = data.get("content", "")
        full = resolve_safe(rel)
        ext = os.path.splitext(full)[1].lower()
        if ext not in WRITE_EXTS:
            return self._send_json({"error": "不允许写入的文件类型：" + ext}, 403)
        if ".bak" in os.path.basename(full):
            return self._send_json({"error": "备份文件（*.bak）不允许修改"}, 403)
        body = content.encode("utf-8")
        if len(body) > MAX_WRITE_BYTES:
            return self._send_json({"error": "内容超过 5MB 上限"}, 413)

        # 写前备份：assistant_backups/<相对路径>.<时间戳>
        backup = None
        if os.path.exists(full):
            stamp = time.strftime("%Y%m%d-%H%M%S")
            backup_rel = os.path.join(BACKUP_DIR, rel + "." + stamp)
            backup_full = os.path.join(ROOT, backup_rel)
            os.makedirs(os.path.dirname(backup_full), exist_ok=True)
            with open(full, "rb") as src, open(backup_full, "wb") as dst:
                dst.write(src.read())
            backup = backup_rel.replace(os.sep, "/")

        os.makedirs(os.path.dirname(full) or ROOT, exist_ok=True)
        with open(full, "wb") as f:
            f.write(body)
        broadcast_event("change", {"path": rel, "bytes": len(body), "backup": backup})
        self._send_json({"ok": True, "path": rel, "bytes": len(body), "backup": backup})

    # ---------- /codex/v1/chat/completions（本地 Codex 订阅反代） ----------

    def api_codex_chat(self):
        body = self._read_json_body()
        gen = codex_proxy.stream_chat_completions(body)
        # 先取首块：连接/认证/协议错误在写 SSE 头之前抛出，前端能拿到正确的 HTTP 错误码
        try:
            first = next(gen)
        except StopIteration:
            return self._send_json({"error": "Codex 上游返回空响应"}, 502)
        except codex_proxy.CodexProxyError as e:
            return self._send_json({"error": str(e)}, e.status)

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        def write_chunk(obj):
            self.wfile.write(b"data: " + json.dumps(obj, ensure_ascii=False).encode("utf-8") + b"\n\n")
            self.wfile.flush()

        try:
            write_chunk(first)
            for obj in gen:
                write_chunk(obj)
        except codex_proxy.CodexProxyError as e:  # 流中途的桥接层错误，以错误块透出
            try:
                write_chunk({"error": {"message": str(e)}})
            except OSError:
                pass
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass  # 前端中止（用户点停止），无需处理
        finally:
            try:
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except OSError:
                pass
            self.close_connection = True

    # ---------- /api/events (SSE) ----------

    def api_events(self):
        q = queue.Queue()
        with _sse_lock:
            _sse_queues.append(q)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                try:
                    name, data = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")  # 心跳，防代理断开
                    self.wfile.flush()
                    continue
                payload = json.dumps(data, ensure_ascii=False)
                self.wfile.write(f"event: {name}\ndata: {payload}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with _sse_lock:
                if q in _sse_queues:
                    _sse_queues.remove(q)
            self.close_connection = True

    # ---------- 请求日志 ----------

    def log_message(self, fmt, *args):  # noqa: A003 静态请求日志降噪：仅 API 打印
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser(description="游戏本地服务器：静态 + 助手文件 API")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), GameRequestHandler)
    server.daemon_threads = True
    print(f"⛏ 我的世界 - 网页复刻版 服务器已启动")
    print(f"   游戏入口: http://{args.host}:{args.port}/")
    print(f"   助手 API: /api/files /api/file /api/events （LLM 由浏览器直连上游）")
    print(f"   Codex 反代: /codex/v1/chat/completions （助手配置 baseUrl=http://localhost:{args.port}/codex/v1 可复用本地 Codex 订阅）")
    print(f"   文件备份目录: {BACKUP_DIR}/  （Ctrl+C 退出）")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")


if __name__ == "__main__":
    main()
