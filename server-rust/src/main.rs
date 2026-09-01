// ==================== server-rust/src/main.rs ====================
// 「我的世界 - 网页复刻版」服务器 Rust 版（仅标准库，零第三方依赖）
//
// 与 server.py（Python 版）接口完全一致，前端 / 助手代码无需任何改动：
//   1. 静态文件服务（强制 .js/.mjs 返回 text/javascript，否则 ES Module 会被浏览器拒绝执行）
//   2. GET  /api/files            列出项目源码文件（供游戏内 AI 助手使用）
//      GET  /api/file?path=...    读取单个文件
//      POST /api/file             写入文件 {path, content}（写前自动备份）
//   3. GET  /api/events           SSE 事件流：文件被助手修改后推送 change 事件（热加载通知）
//
// LLM 请求不经本服务器：助手在浏览器内直连 OpenAI 兼容上游接口。
//
// 与 Python 版的差异（部署相关）：
//   - 新增 --no-api：公网部署时禁用全部 /api/*（写文件接口绝不能无鉴权暴露到公网）
//   - 新增 --root <dir>：站点根目录，默认取当前工作目录
//   - 备份文件名时间戳与 Last-Modified 均为 UTC（标准库无本地时区，备份戳仅用于去重，无影响）

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ---- 与 server.py 保持一致的常量 ----
const ENTRY_HTML: &str = "index.html";            // 唯一入口（重命名需同步 server.py 与 AGENTS.md）
const BACKUP_DIR: &str = "assistant_backups";                  // 助手写文件前的自动备份目录
const MAX_WRITE_BYTES: usize = 5 * 1024 * 1024;                // 单次写入上限 5MB
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;                // 请求体上限 32MB
const WRITE_EXTS: [&str; 6] = ["js", "html", "css", "json", "md", "txt"];
const SKIP_DIRS: [&str; 3] = [".git", "__pycache__", "assistant_backups"];

// ---- 全局状态 ----
static ROOT_DIR: OnceLock<PathBuf> = OnceLock::new();
static API_ON: OnceLock<bool> = OnceLock::new();
static SSE_CLIENTS: Mutex<Vec<Sender<(String, String)>>> = Mutex::new(Vec::new());

fn root_dir() -> &'static PathBuf {
    ROOT_DIR.get().expect("根目录未初始化")
}
fn api_on() -> bool {
    *API_ON.get().unwrap_or(&true)
}

// ==================== 请求 / 响应结构 ====================

struct Request {
    method: String,
    target: String, // 原始目标（含查询串）
    version: String,
    headers: Vec<(String, String)>, // 键已转小写
    body: Vec<u8>,
}

fn header<'a>(req: &'a Request, key: &str) -> Option<&'a str> {
    get_header(&req.headers, key)
}

fn get_header<'a>(headers: &'a [(String, String)], key: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

struct Resp {
    status: u16,
    reason: &'static str,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    close: bool, // 响应后强制断开
}

impl Resp {
    fn new(status: u16, reason: &'static str) -> Self {
        Resp { status, reason, headers: Vec::new(), body: Vec::new(), close: false }
    }
    fn with_header(mut self, k: &str, v: impl Into<String>) -> Self {
        self.headers.push((k.to_string(), v.into()));
        self
    }
    fn with_body(mut self, content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        self.headers.push(("Content-Type".into(), content_type.into()));
        self.body = body.into();
        self
    }
}

fn resp_json(status: u16, reason: &'static str, body: String) -> Resp {
    Resp::new(status, reason)
        .with_header("Cache-Control", "no-store")
        .with_header("Access-Control-Allow-Origin", "*")
        .with_body("application/json; charset=utf-8", body.into_bytes())
}

fn resp_json_error(status: u16, msg: &str) -> Resp {
    resp_json(status, reason_phrase(status), format!("{{\"error\":\"{}\"}}", escape_json(msg)))
}

fn resp_text(status: u16, msg: &str) -> Resp {
    Resp::new(status, reason_phrase(status))
        .with_body("text/plain; charset=utf-8", format!("{}\n", msg).into_bytes())
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        304 => "Not Modified",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        _ => "Unknown",
    }
}

// ==================== 连接处理 ====================

fn handle_conn(stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(120))); // 空闲 keep-alive 连接超时关闭
    let mut reader = match stream.try_clone() {
        Ok(s) => BufReader::with_capacity(8192, s),
        Err(_) => return,
    };
    let mut writer = stream;
    loop {
        let req = match read_request(&mut reader) {
            Ok(Some(r)) => r,
            _ => return, // 连接关闭 / 超时 / 请求损坏
        };
        let conn = header(&req, "connection").unwrap_or("").to_ascii_lowercase();
        let mut keep_alive = if req.version == "HTTP/1.0" {
            conn.contains("keep-alive")
        } else {
            !conn.contains("close")
        };
        let head_only = req.method == "HEAD";
        let path_only = req.target.split('?').next().unwrap_or("/").to_string();

        // SSE 长连接单独处理：独占该连接直到客户端断开
        if path_only == "/api/events" && req.method == "GET" && api_on() {
            api_log("GET", "/api/events", 200);
            sse_handler(&mut writer);
            return;
        }

        let resp = route(&req);
        if resp.close {
            keep_alive = false;
        }
        if write_response(&mut writer, &resp, head_only, keep_alive).is_err() {
            return;
        }
        if path_only.starts_with("/api/") {
            api_log(&req.method, &path_only, resp.status);
        }
        if !keep_alive {
            return;
        }
    }
}

fn read_request(reader: &mut BufReader<TcpStream>) -> std::io::Result<Option<Request>> {
    let mut line = String::new();
    let n = reader.read_line(&mut line)?;
    if n == 0 {
        return Ok(None); // 对端关闭
    }
    let line = line.trim_end();
    if line.is_empty() {
        return Ok(None);
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_ascii_uppercase();
    let target = parts.next().unwrap_or("/").to_string();
    let version = parts.next().unwrap_or("HTTP/1.1").to_string();

    let mut headers = Vec::new();
    loop {
        let mut h = String::new();
        let n = reader.read_line(&mut h)?;
        if n == 0 || h.trim_end().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
        if headers.len() > 100 {
            break; // 防御异常请求
        }
    }

    let content_length: usize = get_header(&headers, "content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "请求体过大",
        ));
    }
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }
    Ok(Some(Request { method, target, version, headers, body }))
}

fn write_response(
    w: &mut TcpStream,
    r: &Resp,
    head_only: bool,
    keep_alive: bool,
) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {} {}\r\n", r.status, r.reason);
    head.push_str(&format!("Date: {}\r\n", http_date(now_secs())));
    head.push_str("Server: mcweb-rs/0.1.0\r\n");
    head.push_str(&format!(
        "Connection: {}\r\n",
        if keep_alive { "keep-alive" } else { "close" }
    ));
    for (k, v) in &r.headers {
        head.push_str(k);
        head.push_str(": ");
        head.push_str(v);
        head.push_str("\r\n");
    }
    if r.status != 304 {
        head.push_str(&format!("Content-Length: {}\r\n", r.body.len()));
    }
    head.push_str("\r\n");
    w.write_all(head.as_bytes())?;
    if !head_only && r.status != 304 && !r.body.is_empty() {
        w.write_all(&r.body)?;
    }
    w.flush()
}

fn api_log(method: &str, path: &str, status: u16) {
    println!("[api] {} {} -> {}", method, path, status);
}

// ==================== 路由 ====================

fn route(req: &Request) -> Resp {
    let (path_raw, query) = match req.target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (req.target.as_str(), ""),
    };

    if req.method == "OPTIONS" {
        // 与 Python 版一致：预检请求统一放行
        return Resp::new(204, reason_phrase(204))
            .with_header("Access-Control-Allow-Origin", "*")
            .with_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            .with_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    match req.method.as_str() {
        "GET" | "HEAD" => {
            // If-Modified-Since 协商缓存：解析失败按未携带处理
            let ims = header(req, "if-modified-since").and_then(parse_http_date);
            route_get(path_raw, query, ims)
        }
        "POST" => route_post(path_raw, req),
        _ => resp_json_error(501, &format!("不支持的方法：{}", req.method)),
    }
}

fn route_get(path_raw: &str, query: &str, ims: Option<i64>) -> Resp {
    let comps = match url_path_components(path_raw) {
        Ok(c) => c,
        Err(msg) => return resp_text(400, &msg),
    };
    let path = "/".to_string() + &comps.join("/");

    if path == "/" {
        return serve_static(&[ENTRY_HTML.to_string()], ims);
    }
    if path == "/api/files" {
        return if api_on() { api_files() } else { api_disabled() };
    }
    if path == "/api/file" {
        return if api_on() { api_file_read(query) } else { api_disabled() };
    }
    if path == "/api/events" {
        return if api_on() {
            // 正常情况不会走到这里（SSE 在 handle_conn 中已拦截）；HEAD 请求落到这里
            let mut r = Resp::new(200, "OK")
                .with_header("Content-Type", "text/event-stream; charset=utf-8")
                .with_header("Cache-Control", "no-cache")
                .with_header("Access-Control-Allow-Origin", "*");
            r.close = true;
            r
        } else {
            api_disabled()
        };
    }
    serve_static(&comps, ims)
}

fn route_post(path_raw: &str, req: &Request) -> Resp {
    let path = path_raw.to_string();
    if path == "/api/file" {
        return if api_on() { api_file_write(req) } else { api_disabled() };
    }
    resp_json_error(404, &format!("未知接口：{}", path))
}

fn api_disabled() -> Resp {
    resp_json_error(404, "文件 API 已禁用（--no-api 公网部署模式）")
}

// ==================== 静态文件 ====================

/// 把 URL 路径拆成已解码的路径分量；拒绝路径穿越与非法字符
fn url_path_components(path_raw: &str) -> Result<Vec<String>, String> {
    let mut comps = Vec::new();
    for raw in path_raw.split('/') {
        let c = percent_decode(raw, false);
        if c.contains('\0') {
            return Err("路径含非法字符".into());
        }
        if c.is_empty() || c == "." {
            continue;
        }
        if c == ".." {
            return Err("路径越界".into());
        }
        if c.contains('/') || c.contains('\\') {
            return Err("路径非法".into());
        }
        comps.push(c);
    }
    Ok(comps)
}

fn serve_static(comps: &[String], ims: Option<i64>) -> Resp {
    let mut full = root_dir().clone();
    for c in comps {
        full.push(c);
    }
    if full.is_dir() {
        full.push("index.html"); // 目录请求尝试 index.html，没有则按不存在处理
    }
    let meta = match fs::metadata(&full) {
        Ok(m) if m.is_file() => m,
        _ => return resp_text(404, "404 Not Found：路径不存在"),
    };
    let mtime = mtime_secs(&meta);
    let last_modified = http_date(mtime);

    // 未变更返回 304（对齐 Python 版 SimpleHTTPRequestHandler 的协商缓存行为）
    if let Some(ims_secs) = ims {
        if mtime <= ims_secs {
            return Resp::new(304, reason_phrase(304)).with_header("Last-Modified", last_modified);
        }
    }

    match fs::read(&full) {
        Ok(bytes) => Resp::new(200, "OK")
            .with_header("Last-Modified", last_modified)
            .with_body(
                content_type_of(comps.last().map(|s| s.as_str()).unwrap_or("")),
                bytes,
            ),
        Err(_) => resp_text(500, "500 读取文件失败"),
    }
}

// ==================== /api/files ====================

fn api_files() -> Resp {
    let mut files: Vec<(String, u64, i64)> = Vec::new();
    walk_tree(root_dir(), &mut files);
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut body = String::from("{\"files\":[");
    for (i, (path, size, mtime)) in files.iter().enumerate() {
        if i > 0 {
            body.push(',');
        }
        body.push_str(&format!(
            "{{\"path\":\"{}\",\"size\":{},\"mtime\":{}}}",
            escape_json(path),
            size,
            mtime
        ));
    }
    body.push_str(&format!("],\"root\":\"{}\"}}", escape_json(ENTRY_HTML)));
    resp_json(200, "OK", body)
}

fn walk_tree(dir: &Path, out: &mut Vec<(String, u64, i64)>) {
    let mut entries: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).map(|e| e.path()).collect(),
        Err(_) => return,
    };
    entries.sort();
    for p in entries {
        let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let Ok(meta) = fs::metadata(&p) else { continue };
        if meta.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            walk_tree(&p, out);
        } else if meta.is_file() {
            if name.starts_with('.') || name.contains(".bak") {
                continue; // 排除隐藏文件与历史备份
            }
            let ext = p
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if !WRITE_EXTS.contains(&ext.as_str()) {
                continue;
            }
            let rel = p
                .strip_prefix(root_dir())
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, meta.len(), mtime_secs(&meta)));
        }
    }
}

// ==================== /api/file 读写 ====================

fn query_param<'a>(query: &'a str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let Some((k, v)) = pair.split_once('=') else { continue };
        if k == key {
            return Some(percent_decode(v, true));
        }
    }
    None
}

fn api_file_read(query: &str) -> Resp {
    let rel_raw = query_param(query, "path").unwrap_or_default();
    let (full, rel) = match resolve_safe(&rel_raw) {
        Ok(v) => v,
        Err(e) => return resp_json_error(400, &e),
    };
    let meta = match fs::metadata(&full) {
        Ok(m) => m,
        Err(_) => return resp_json_error(404, &format!("文件不存在：{}", rel)),
    };
    if !meta.is_file() {
        return resp_json_error(404, &format!("文件不存在：{}", rel));
    }
    let bytes = match fs::read(&full) {
        Ok(b) => b,
        Err(e) => return resp_json_error(400, &format!("读取失败：{}", e)),
    };
    let content = String::from_utf8_lossy(&bytes);
    resp_json(
        200,
        "OK",
        format!(
            "{{\"path\":\"{}\",\"content\":\"{}\"}}",
            escape_json(&rel),
            escape_json(&content)
        ),
    )
}

fn api_file_write(req: &Request) -> Resp {
    if req.body.is_empty() || req.body.len() > MAX_BODY_BYTES {
        return resp_json_error(400, "请求体大小异常");
    }
    let text = match std::str::from_utf8(&req.body) {
        Ok(t) => t,
        Err(_) => return resp_json_error(400, "请求体不是 UTF-8"),
    };
    let parsed = match JsonParser::new(text).parse() {
        Ok(v) => v,
        Err(e) => return resp_json_error(400, &e),
    };
    let rel_raw = json_get_str(&parsed, "path").unwrap_or("");
    let content = json_get_str(&parsed, "content").unwrap_or("");

    let (full, rel) = match resolve_safe(rel_raw) {
        Ok(v) => v,
        Err(e) => return resp_json_error(400, &e),
    };
    let ext = full
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !WRITE_EXTS.contains(&ext.as_str()) {
        return resp_json_error(403, &format!("不允许写入的文件类型：.{}", ext));
    }
    let basename = full.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    if basename.contains(".bak") {
        return resp_json_error(403, "备份文件（*.bak）不允许修改");
    }
    let bytes = content.as_bytes();
    if bytes.len() > MAX_WRITE_BYTES {
        return resp_json_error(413, "内容超过 5MB 上限");
    }

    // 写前备份：assistant_backups/<相对路径>.<时间戳>
    let mut backup: Option<String> = None;
    if full.exists() {
        let backup_rel = format!(
            "{}.{}",
            PathBuf::from(BACKUP_DIR).join(&rel).to_string_lossy(),
            stamp_utc(now_secs())
        );
        let backup_full = root_dir().join(&backup_rel);
        if let Some(dir) = backup_full.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if fs::copy(&full, &backup_full).is_ok() {
            backup = Some(backup_rel);
        }
    }

    if let Some(dir) = full.parent() {
        if let Err(e) = fs::create_dir_all(dir) {
            return resp_json_error(400, &format!("创建目录失败：{}", e));
        }
    }
    if let Err(e) = fs::write(&full, bytes) {
        return resp_json_error(400, &format!("写入失败：{}", e));
    }
    broadcast_event(
        "change",
        &format!(
            "{{\"path\":\"{}\",\"bytes\":{},\"backup\":{}}}",
            escape_json(&rel),
            bytes.len(),
            backup
                .as_ref()
                .map(|b| format!("\"{}\"", escape_json(b)))
                .unwrap_or_else(|| "null".into())
        ),
    );
    resp_json(
        200,
        "OK",
        format!(
            "{{\"ok\":true,\"path\":\"{}\",\"bytes\":{},\"backup\":{}}}",
            escape_json(&rel),
            bytes.len(),
            backup
                .as_ref()
                .map(|b| format!("\"{}\"", escape_json(b)))
                .unwrap_or_else(|| "null".into())
        ),
    )
}

/// 把相对路径解析为项目根目录内的绝对路径，越界即拒绝
/// 返回 (绝对路径, 清理后的相对路径)
fn resolve_safe(rel_raw: &str) -> Result<(PathBuf, String), String> {
    let rel = rel_raw.trim().trim_start_matches(|c| c == '/' || c == '\\');
    if rel.is_empty() {
        return Err("path 不能为空".into());
    }
    if rel.contains('\0') {
        return Err("路径含非法字符".into());
    }
    let mut comps: Vec<&str> = Vec::new();
    for c in rel.split(|c| c == '/' || c == '\\') {
        if c.is_empty() || c == "." {
            continue;
        }
        if c == ".." {
            return Err(format!("路径越界：{}", rel_raw));
        }
        comps.push(c);
    }
    if comps.is_empty() {
        return Err("path 不能为空".into());
    }
    let mut full = root_dir().clone();
    for c in &comps {
        full.push(c);
    }
    verify_inside(&full)?;
    let rel_clean = comps.join("/");
    Ok((full, rel_clean))
}

/// 对已存在的最深祖先做 canonicalize 校验，防止项目内符号链接指向根目录之外
fn verify_inside(p: &Path) -> Result<(), String> {
    let root = root_dir();
    let mut cur = p.to_path_buf();
    loop {
        match cur.canonicalize() {
            Ok(real) => {
                if real != *root && !real.starts_with(root) {
                    return Err("路径越界".into());
                }
                return Ok(()); // 其余分量不含 ".."，拼接结果必然仍在根内
            }
            Err(_) => match (cur.file_name(), cur.parent()) {
                (Some(_), Some(par)) => cur = par.to_path_buf(),
                _ => return Err("路径越界".into()),
            },
        }
    }
}

// ==================== SSE（/api/events） ====================

fn broadcast_event(name: &str, json: &str) {
    let mut clients = SSE_CLIENTS.lock().unwrap();
    clients.retain(|tx| tx.send((name.to_string(), json.to_string())).is_ok());
}

fn sse_handler(writer: &mut TcpStream) {
    let (tx, rx) = mpsc::channel::<(String, String)>();
    SSE_CLIENTS.lock().unwrap().push(tx);
    let _ = writer.set_write_timeout(Some(Duration::from_secs(30)));

    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\nDate: {}\r\nServer: mcweb-rs/0.1.0\r\n\r\n",
        http_date(now_secs())
    );
    let send = |w: &mut TcpStream, s: &str| -> bool { w.write_all(s.as_bytes()).and_then(|_| w.flush()).is_ok() };
    if !send(writer, &head) || !send(writer, ": connected\n\n") {
        return;
    }
    loop {
        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok((name, data)) => {
                if !send(writer, &format!("event: {}\ndata: {}\n\n", name, data)) {
                    return; // 客户端断开
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !send(writer, ": ping\n\n") {
                    return; // 心跳保活，防代理断开
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}

// ==================== 工具函数 ====================

fn percent_decode(s: &str, plus_as_space: bool) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                let hi = (b[i + 1] as char).to_digit(16);
                let lo = (b[i + 2] as char).to_digit(16);
                match (hi, lo) {
                    (Some(h), Some(l)) => {
                        out.push((h * 16 + l) as u8);
                        i += 3;
                    }
                    _ => {
                        out.push(b[i]);
                        i += 1;
                    }
                }
            }
            b'+' if plus_as_space => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn content_type_of(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "txt" | "md" => "text/plain; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn mtime_secs(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---- 日期换算（Howard Hinnant 算法，标准库无日期 API） ----

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

#[allow(dead_code)]
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

const DAY_NAMES: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// epoch 秒 -> "Tue, 15 Nov 1994 08:12:31 GMT"（HTTP 日期，恒为 GMT）
fn http_date(epoch: i64) -> String {
    let days = epoch.div_euclid(86400);
    let secs = epoch.rem_euclid(86400);
    let (y, m, d) = civil_from_days(days);
    let wd = (days + 4).rem_euclid(7) as usize; // 1970-01-01 是周四
    format!(
        "{}, {:02} {} {} {:02}:{:02}:{:02} GMT",
        DAY_NAMES[wd],
        d,
        MONTH_NAMES[(m - 1) as usize],
        y,
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

/// epoch 秒 -> "20260901-153000"（备份文件名时间戳，UTC）
fn stamp_utc(epoch: i64) -> String {
    let days = epoch.div_euclid(86400);
    let secs = epoch.rem_euclid(86400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        y,
        m,
        d,
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

/// 解析 If-Modified-Since（只支持 IMF-fixdate，解析失败按未携带处理）
fn parse_http_date(s: &str) -> Option<i64> {
    let s = s.split(';').next()?.trim();
    let rest = s.split_once(", ")?.1; // 丢弃星期前缀
    let mut tokens = rest.split_whitespace();
    let d: i64 = tokens.next()?.parse().ok()?;
    let mon_name = tokens.next()?;
    let mon = MONTH_NAMES
        .iter()
        .position(|m| m.eq_ignore_ascii_case(mon_name))?
        as i64
        + 1;
    let y: i64 = tokens.next()?.parse().ok()?;
    let mut hms = tokens.next()?.split(':');
    let h: i64 = hms.next()?.parse().ok()?;
    let mi: i64 = hms.next()?.parse().ok()?;
    let sec: i64 = hms.next()?.parse().ok()?;
    if !tokens.next()?.eq_ignore_ascii_case("GMT") {
        return None;
    }
    let days = days_from_civil(y, mon, d);
    Some(days * 86400 + h * 3600 + mi * 60 + sec)
}

// ==================== 极简 JSON 解析（POST /api/file 请求体） ====================

// 解析器是完整 JSON（数字/布尔/数组等仅解析不消费，写入接口只取字符串字段）
#[allow(dead_code)]
#[derive(Debug, Clone)]
enum Jv {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Jv>),
    Obj(Vec<(String, Jv)>),
}

struct JsonParser<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> JsonParser<'a> {
    fn new(s: &'a str) -> Self {
        JsonParser { b: s.as_bytes(), i: 0 }
    }
    fn err(&self, msg: &str) -> String {
        format!("JSON 解析失败（偏移 {}）：{}", self.i, msg)
    }
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }
    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }
    fn eat(&mut self, c: u8) -> Result<(), String> {
        if self.peek() == Some(c) {
            self.i += 1;
            Ok(())
        } else {
            Err(self.err(&format!("期望 '{}'", c as char)))
        }
    }
    fn parse(&mut self) -> Result<Jv, String> {
        let v = self.value(0)?;
        self.ws();
        Ok(v)
    }
    fn value(&mut self, depth: usize) -> Result<Jv, String> {
        if depth > 64 {
            return Err(self.err("嵌套过深"));
        }
        self.ws();
        match self.peek() {
            Some(b'{') => self.object(depth),
            Some(b'[') => self.array(depth),
            Some(b'"') => Ok(Jv::Str(self.string()?)),
            Some(b't') => self.lit("true", Jv::Bool(true)),
            Some(b'f') => self.lit("false", Jv::Bool(false)),
            Some(b'n') => self.lit("null", Jv::Null),
            Some(c) if c == b'-' || c.is_ascii_digit() => self.number(),
            _ => Err(self.err("意外的字符")),
        }
    }
    fn lit(&mut self, s: &str, v: Jv) -> Result<Jv, String> {
        if self.b[self.i..].starts_with(s.as_bytes()) {
            self.i += s.len();
            Ok(v)
        } else {
            Err(self.err("字面量格式错误"))
        }
    }
    fn number(&mut self) -> Result<Jv, String> {
        let start = self.i;
        if self.peek() == Some(b'-') {
            self.i += 1;
        }
        while self.i < self.b.len()
            && (self.b[self.i].is_ascii_digit()
                || matches!(self.b[self.i], b'.' | b'e' | b'E' | b'+' | b'-'))
        {
            self.i += 1;
        }
        let s = std::str::from_utf8(&self.b[start..self.i]).map_err(|_| self.err("数字格式错误"))?;
        s.parse::<f64>().map(Jv::Num).map_err(|_| self.err("数字格式错误"))
    }
    fn string(&mut self) -> Result<String, String> {
        self.eat(b'"')?;
        let mut out = String::new();
        loop {
            match self.peek() {
                None => return Err(self.err("字符串未闭合")),
                Some(b'"') => {
                    self.i += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.i += 1;
                    match self.peek() {
                        Some(b'"') => out.push('"'),
                        Some(b'\\') => out.push('\\'),
                        Some(b'/') => out.push('/'),
                        Some(b'b') => out.push('\u{8}'),
                        Some(b'f') => out.push('\u{c}'),
                        Some(b'n') => out.push('\n'),
                        Some(b'r') => out.push('\r'),
                        Some(b't') => out.push('\t'),
                        Some(b'u') => {
                            self.i += 1;
                            let hi = self.hex4()?;
                            let ch = if (0xD800..0xDC00).contains(&hi) {
                                if self.b[self.i..].starts_with(b"\\u") {
                                    self.i += 2;
                                    let lo = self.hex4()?;
                                    if !(0xDC00..0xE000).contains(&lo) {
                                        return Err(self.err("非法低位代理"));
                                    }
                                    let c = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00);
                                    char::from_u32(c).ok_or_else(|| self.err("非法码点"))?
                                } else {
                                    return Err(self.err("孤立的高位代理"));
                                }
                            } else {
                                char::from_u32(hi).ok_or_else(|| self.err("非法码点"))?
                            };
                            out.push(ch);
                            continue;
                        }
                        _ => return Err(self.err("非法转义")),
                    };
                    self.i += 1;
                }
                Some(_) => {
                    let s = std::str::from_utf8(&self.b[self.i..])
                        .map_err(|_| self.err("非 UTF-8 字节"))?;
                    let ch = s.chars().next().unwrap();
                    out.push(ch);
                    self.i += ch.len_utf8();
                }
            }
        }
    }
    fn hex4(&mut self) -> Result<u32, String> {
        if self.i + 4 > self.b.len() {
            return Err(self.err("\\u 转义截断"));
        }
        let s = std::str::from_utf8(&self.b[self.i..self.i + 4]).map_err(|_| self.err("\\u 截断"))?;
        let v = u32::from_str_radix(s, 16).map_err(|_| self.err("\\u 转义非法"))?;
        self.i += 4;
        Ok(v)
    }
    fn object(&mut self, depth: usize) -> Result<Jv, String> {
        self.eat(b'{')?;
        let mut out: Vec<(String, Jv)> = Vec::new();
        self.ws();
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Ok(Jv::Obj(out));
        }
        loop {
            self.ws();
            let k = self.string()?;
            self.ws();
            self.eat(b':')?;
            let v = self.value(depth + 1)?;
            out.push((k, v));
            self.ws();
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    return Ok(Jv::Obj(out));
                }
                _ => return Err(self.err("对象格式错误")),
            }
        }
    }
    fn array(&mut self, depth: usize) -> Result<Jv, String> {
        self.eat(b'[')?;
        let mut out: Vec<Jv> = Vec::new();
        self.ws();
        if self.peek() == Some(b']') {
            self.i += 1;
            return Ok(Jv::Arr(out));
        }
        loop {
            let v = self.value(depth + 1)?;
            out.push(v);
            self.ws();
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    return Ok(Jv::Arr(out));
                }
                _ => return Err(self.err("数组格式错误")),
            }
        }
    }
}

fn json_get_str<'a>(v: &'a Jv, key: &str) -> Option<&'a str> {
    if let Jv::Obj(map) = v {
        for (k, val) in map {
            if k == key {
                if let Jv::Str(s) = val {
                    return Some(s);
                }
            }
        }
    }
    None
}

// ==================== 启动 ====================

fn print_usage() {
    println!(
        "用法: game-server [--host 127.0.0.1] [--port 8000] [--root <dir>] [--no-api]\n\
         \x20 --host    监听地址（默认 127.0.0.1；公网部署建议 0.0.0.0 且配合 --no-api）\n\
         \x20 --port    监听端口（默认 8000）\n\
         \x20 --root    站点根目录（默认当前工作目录）\n\
         \x20 --no-api  禁用助手文件 API（/api/*），公网部署必用"
    );
}

fn main() {
    let mut host = "127.0.0.1".to_string();
    let mut port: u16 = 8000;
    let mut root = ".".to_string();
    let mut no_api = false;

    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--host" => host = args.next().unwrap_or(host),
            "--port" => port = args.next().and_then(|v| v.parse().ok()).unwrap_or(port),
            "--root" => root = args.next().unwrap_or(root),
            "--no-api" => no_api = true,
            "-h" | "--help" => {
                print_usage();
                return;
            }
            other => {
                eprintln!("未知参数：{}", other);
                print_usage();
                std::process::exit(2);
            }
        }
    }

    let root_path = match fs::canonicalize(&root) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("根目录无效：{}（{}）", root, e);
            std::process::exit(1);
        }
    };
    let _ = ROOT_DIR.set(root_path.clone());
    let _ = API_ON.set(!no_api);

    let listener = match TcpListener::bind((host.as_str(), port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("监听失败：{}:{}（{}）", host, port, e);
            std::process::exit(1);
        }
    };

    println!("⛏ 我的世界 - 网页复刻版 服务器（Rust 版）已启动");
    println!("   根目录: {}", root_path.display());
    println!("   游戏入口: http://{}:{}/", host, port);
    if no_api {
        println!("   助手 API: 已禁用（--no-api，公网部署模式，仅静态服务）");
    } else {
        println!("   助手 API: /api/files /api/file /api/events （LLM 由浏览器直连上游）");
    }
    println!("   文件备份目录: {}/  （Ctrl+C 退出）", BACKUP_DIR);

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                std::thread::spawn(move || handle_conn(s));
            }
            Err(_) => continue,
        }
    }
}
