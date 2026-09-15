// ==================== levelPoster.js ====================
// 成绩海报 + 关卡缩略图（批次 W · B6，P1 炫耀回路收尾，2026-09-15）。
// 方案 docs/edu-level-workshop-plan.md §3.4；G2 裁决「海报渲染先截帧，效果不满意再升级」。
//
// 导出清单：
//   thumbnailColumns(card)          纯逻辑（Node 可测）：俯视图逐列取最高非空方块 → [{color}...]
//                                   （下标 = lz*w + lx，x 最快），canvas 绘制留浏览器侧。
//   renderRegionThumbnail(card,size) 俯视色块缩略图 → canvas（默认 128）。确定性、零 WebGL、
//                                   永不空白——关卡列表缩略图的可靠来源（截帧方案只给海报用）。
//   generateResultPoster(result)    结算面板「📸 生成海报」：720×960 canvas → PNG 下载。
//
// 截帧注意（§3.4 决策点）：engine.js 的 WebGLRenderer 未开 preserveDrawingBuffer（默认 false），
// 合成过后的画布读回是空白——所以先 renderer.render 同步重绘一帧再 toDataURL，并用 8×8 像素
// 探针判定「空/黑」；失败降级为程序化渐变 + 关卡名首字水印（两条路都实现，海报永不残缺）。
//
// Node 可测性：静态 import 只许 config/levelWorkshop（其链 config/state/world/rle 均无
// three/DOM，见 tools/test_thumbnail.mjs）；浏览器 API（document/canvas/Image）只在函数内
// 触碰且先判环境（Node 下 renderRegionThumbnail 返回 null、generateResultPoster 直接返回）。
// 防御铁律：所有导出不抛错（W 套件断言「失败降级不抛」）——drawImage/字体/下载全 try/catch。
// IP 红线：海报任何位置不得出现「我的世界」字样（待改名的商标风险项），落款只用「关卡工坊 · mcweb」。

import { BlockInfo, BlockTypes } from './config.js';
import { decodeRegionBlocks } from './levelWorkshop.js';

// 空列 / 兜底底色（贴近游戏 HUD 暗底浮层配色）；未知方块缺色才用 '#888'
const THUMB_BG = '#20242e';
// 海报字体栈：与游戏 HUD 同族的系统中文字体（canvas 无 CSS 回退链时逐个兜底）
const POSTER_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';

// ==================== 俯视缩略图：纯逻辑列颜色 ====================

// 解码卡片 region，逐列（x,z）自顶向下找最高非空方块（AIR=0 跳过；水/玻璃等照算——
// 俯视图里蓝色水麵/玻璃反白本身就是可读信息），取 BlockInfo[id].color（缺色 '#888'，
// 全空列用 THUMB_BG 暗底而不是噪声灰）。输出 [{color}...]，下标 lz*w+lx（与 region
// 内存序的 x/z 平面一致）。解码失败/卡片损坏返回 []——确定性、永不抛错。
export function thumbnailColumns(card) {
    const dec = decodeRegionBlocks(card);
    if (dec.error || !dec.blocks || !dec.region) return [];
    const blocks = dec.blocks;
    const { w, d, h } = dec.region;
    const out = new Array(w * d);
    for (let lz = 0; lz < d; lz++) {
        const zBase = lz * w;
        for (let lx = 0; lx < w; lx++) {
            let color = THUMB_BG;
            for (let ly = h - 1; ly >= 0; ly--) {
                const id = blocks[lx + zBase + ly * w * d];
                if (id !== BlockTypes.AIR) {
                    color = (BlockInfo[id] && BlockInfo[id].color) || '#888';
                    break;
                }
            }
            out[lz * w + lx] = { color };
        }
    }
    return out;
}

// '#rrggbb' → [r,g,b]；非法输入回退灰色（不抛错）
function hexToRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return [136, 136, 136];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 兜底绘制：暗底（调用方已铺）+ 关卡名首字大水印——缩略图与海报降级共用
function drawNameFallback(ctx, w, h, name) {
    try {
        const ch = [...String(name || '').trim()][0] || '关';
        ctx.font = `700 ${Math.floor(Math.min(w, h) * 0.5)}px ${POSTER_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.20)';
        ctx.fillText(ch, w / 2, h / 2);
        ctx.textBaseline = 'alphabetic'; // 还原默认，避免污染后续绘制
    } catch { /* 字体不可用就留纯色底，不抛 */ }
}

// ==================== 俯视缩略图：canvas 绘制（浏览器侧） ====================

// region 俯视色块图：w×d 每列 1 像素（x→横轴、z→纵轴，正交俯视、北朝上），整体等比缩放
// 居中贴到 size×size（imageSmoothing 关掉保住色块锐度）。返回 canvas；Node（无 DOM）
// 返回 null；任何绘制异常降级为「暗底 + 首字水印」画布——永不返回空值、永不抛错。
export function renderRegionThumbnail(card, size = 128) {
    if (typeof document === 'undefined') return null; // Node：无 canvas，纯逻辑层（thumbnailColumns）另行测试
    const s = Math.max(16, (size | 0) || 128);
    const cv = document.createElement('canvas');
    cv.width = s;
    cv.height = s;
    try {
        const ctx = cv.getContext('2d');
        if (!ctx) return cv; // 极端环境拿不到 2d：交一张空画布，不抛
        ctx.fillStyle = THUMB_BG;
        ctx.fillRect(0, 0, s, s); // 先铺底——任何后续失败都不是「空白」
        const r = card && card.region;
        const cols = thumbnailColumns(card);
        if (!cols.length || !r) {
            drawNameFallback(ctx, s, s, card && card.name);
            return cv;
        }
        // 离屏 w×d 画布：一像素一列（putImageData 不走缩放管线，色值零失真）
        const off = document.createElement('canvas');
        off.width = r.w;
        off.height = r.d;
        const octx = off.getContext('2d');
        if (!octx) {
            drawNameFallback(ctx, s, s, card && card.name);
            return cv;
        }
        const img = octx.createImageData(r.w, r.d);
        for (let i = 0; i < cols.length; i++) {
            const [rr, gg, bb] = hexToRgb(cols[i].color);
            img.data[i * 4] = rr;
            img.data[i * 4 + 1] = gg;
            img.data[i * 4 + 2] = bb;
            img.data[i * 4 + 3] = 255;
        }
        octx.putImageData(img, 0, 0);
        // 等比缩放居中（长边贴满 size）；关平滑 = 最近邻，色块边界保持锐利
        const scale = s / Math.max(r.w, r.d);
        const dw = Math.max(1, Math.round(r.w * scale));
        const dh = Math.max(1, Math.round(r.d * scale));
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, Math.floor((s - dw) / 2), Math.floor((s - dh) / 2), dw, dh);
    } catch { /* 绘制链路任何异常：保留已铺底的画布，不抛 */ }
    return cv;
}

// ==================== 海报：主画布截帧（尽量真实画面） ====================

// 抓 gameCanvas 当前帧。preserveDrawingBuffer=false 时合成后的画布读回是空白，因此
// 先 renderer.render(scene,camera) 同步重绘一帧再 toDataURL；再用 8×8 像素探针判定
// 「空/黑」（全透明或几乎全黑 = 判失败）。图片解码 1.5s 超时防悬挂。任何一步失败
// 返回 null（海报降级程序化渐变），绝不抛错。
async function captureGameFrame() {
    try {
        const eng = await import('./engine.js'); // three 链：只在浏览器可用，失败即降级
        const r = eng && eng.renderer;
        const dom = r && r.domElement;
        if (!r || !dom || typeof dom.toDataURL !== 'function' || !eng.scene || !eng.camera) return null;
        r.render(eng.scene, eng.camera); // 立即重绘一帧：绘制缓冲在合成前有效，读回非空
        const url = dom.toDataURL('image/png');
        if (!url || url.length < 200) return null; // 'data:,' 或极短串 = 没抓到
        const img = new Image();
        const loaded = new Promise((resolve, reject) => {
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('frame decode failed'));
        });
        img.src = url;
        const frame = await Promise.race([
            loaded,
            new Promise((_, reject) => setTimeout(() => reject(new Error('frame decode timeout')), 1500)),
        ]);
        // 像素探针：缩采 8×8，非透明且非纯黑像素 ≥4 才认为是真实画面（黑屏/空白判失败）
        const probe = document.createElement('canvas');
        probe.width = 8;
        probe.height = 8;
        const pctx = probe.getContext('2d');
        if (!pctx) return frame;
        pctx.drawImage(frame, 0, 0, 8, 8);
        const data = pctx.getImageData(0, 0, 8, 8).data;
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 10 && (data[i] > 16 || data[i + 1] > 16 || data[i + 2] > 16)) lit++;
        }
        return lit >= 4 ? frame : null;
    } catch {
        return null;
    }
}

// ==================== 海报：绘制与下载 ====================

// 文件名消毒：关卡名里的路径/非法字符换成下划线（download 属性对 / 等字符不可靠）
function safeFileName(name) {
    const s = String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 40);
    return s || '关卡';
}

// djb2 字符串哈希（渐变色相的确定性来源：同名关卡同一配色）
function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h >>> 0;
}

// 圆角矩形路径（ctx.roundRect 新 API 未必处处有，自绘兼容）
function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// 秒 → mm:ss（与 ui.js fmtSec 同式，海报侧独立不引入 UI 依赖）
function fmtSec(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// 顶部缩略图降级：程序化渐变（色相由关卡名哈希确定）+ 首字大水印
function drawPosterFallback(ctx, w, h, name) {
    try {
        const hue = hashStr(String(name || '')) % 360;
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, `hsl(${hue}, 42%, 34%)`);
        g.addColorStop(1, `hsl(${(hue + 50) % 360}, 48%, 20%)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        drawNameFallback(ctx, w, h, name);
    } catch { /* 渐变都不可用就留背景色，不抛 */ }
}

// 成绩海报（720×960 PNG 下载）。async 但绝不 reject（调用方 ui.js 不 await——
// 未处理 rejection 会炸控制台），全部异常吞掉只留 console.warn。
// 构图（自上而下）：缩略图区(340px) → 关卡名(大字) → 作者 → 星级(+超时/新纪录徽章)
//   → 用时/死亡 → 锁明细(≤8 行) → 落款「关卡工坊 · mcweb」（IP 红线：不出现「我的世界」）。
export async function generateResultPoster(result) {
    try {
        if (!result || typeof result !== 'object' || typeof document === 'undefined') return;
        const W = 720;
        const H = 960;
        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext('2d');
        if (!ctx) return;

        // ---- 背景：竖向暗渐变（贴 HUD 圆角暗底浮层配色）----
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#262b38');
        bg.addColorStop(1, '#15171e');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // ---- 顶部缩略图区（0..340）：先截帧，空/黑降级程序化渐变+首字水印 ----
        const THUMB_H = 340;
        let frame = null;
        try { frame = await captureGameFrame(); } catch { frame = null; }
        if (frame) {
            try {
                // cover 裁切铺满：按宽高取大缩放，居中裁掉溢出部分
                const iw = frame.naturalWidth || frame.width;
                const ih = frame.naturalHeight || frame.height;
                if (iw > 0 && ih > 0) {
                    const sc = Math.max(W / iw, THUMB_H / ih);
                    const dw = iw * sc;
                    const dh = ih * sc;
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(0, 0, W, THUMB_H);
                    ctx.clip();
                    ctx.drawImage(frame, (W - dw) / 2, (THUMB_H - dh) / 2, dw, dh);
                    ctx.restore();
                } else {
                    frame = null;
                }
            } catch {
                frame = null;
            }
        }
        if (!frame) drawPosterFallback(ctx, W, THUMB_H, result.name);
        // 顶部向海报底色渐隐 90px，衔接不生硬
        try {
            const fade = ctx.createLinearGradient(0, THUMB_H - 90, 0, THUMB_H);
            fade.addColorStop(0, 'rgba(21,23,30,0)');
            fade.addColorStop(1, 'rgba(21,23,30,1)');
            ctx.fillStyle = fade;
            ctx.fillRect(0, THUMB_H - 90, W, 90);
        } catch { }

        // ---- 文本区（居中排版）----
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        let y = THUMB_H + 64;

        // 关卡名（大字，超宽自动缩字号，最小 22px）
        const name = String(result.name || '未命名关卡');
        let nameSize = 42;
        for (;;) {
            try { ctx.font = `700 ${nameSize}px ${POSTER_FONT}`; } catch { break; }
            let wpx = 0;
            try { wpx = ctx.measureText(name).width; } catch { break; }
            if (wpx <= W - 96 || nameSize <= 22) break;
            nameSize -= 3;
        }
        ctx.fillStyle = '#ffffff';
        try { ctx.fillText(name, W / 2, y); } catch { }
        y += 36;

        // 作者
        ctx.font = `400 20px ${POSTER_FONT}`;
        ctx.fillStyle = '#9aa3b8';
        try { ctx.fillText(`作者：${String(result.author || '匿名')}`, W / 2, y); } catch { }
        y += 54;

        // 星级：超时 = ☆☆☆ +「⏰ 超时」；否则 ★实☆空
        const stars = Math.max(0, Math.min(3, result.stars | 0));
        const starText = result.timeout ? '☆☆☆  ⏰ 超时' : '★'.repeat(stars) + '☆'.repeat(3 - stars);
        ctx.font = `700 36px ${POSTER_FONT}`;
        ctx.fillStyle = result.timeout ? '#ffb14e' : '#ffd77a';
        try { ctx.fillText(starText, W / 2, y); } catch { }
        y += 48;

        // 🏆 新纪录徽章（金色胶囊，仅 isNewBest 时画）
        if (result.isNewBest) {
            try {
                ctx.font = `700 20px ${POSTER_FONT}`;
                const label = '🏆 新纪录';
                const tw = ctx.measureText(label).width;
                const bw = tw + 36;
                const bh = 34;
                ctx.fillStyle = 'rgba(255,215,122,0.16)';
                roundRectPath(ctx, (W - bw) / 2, y - 26, bw, bh, 17);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,215,122,0.65)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.fillStyle = '#ffd77a';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, W / 2, y - 26 + bh / 2 + 1);
                ctx.textBaseline = 'alphabetic';
            } catch { }
            y += 46;
        }

        // 用时 / 死亡
        ctx.font = `400 22px ${POSTER_FONT}`;
        ctx.fillStyle = '#e8ecf5';
        try { ctx.fillText(`⏱ 用时 ${fmtSec(result.timeSec)}　·　💀 死亡 ${result.deaths | 0}`, W / 2, y); } catch { }
        y += 34;

        // 分隔线
        try {
            ctx.strokeStyle = '#3a4152';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(64, y);
            ctx.lineTo(W - 64, y);
            ctx.stroke();
        } catch { }
        y += 30;

        // ---- 锁明细（最多 8 行，左右两栏对齐）----
        const locks = Array.isArray(result.locks) ? result.locks : [];
        ctx.textAlign = 'left';
        ctx.font = `400 16px ${POSTER_FONT}`;
        ctx.fillStyle = '#9aa3b8';
        try { ctx.fillText('锁明细', 88, y); } catch { }
        y += 28;
        if (!locks.length) {
            ctx.textAlign = 'center';
            ctx.font = `400 18px ${POSTER_FONT}`;
            ctx.fillStyle = '#7b8296';
            try { ctx.fillText('本关没有锁（纯跑酷）', W / 2, y); } catch { }
        } else {
            ctx.font = `400 18px ${POSTER_FONT}`;
            const rows = locks.slice(0, 8); // 最多列 8 行，余量折叠一行提示
            for (let i = 0; i < rows.length; i++) {
                const l = rows[i];
                ctx.fillStyle = '#e8ecf5';
                try { ctx.fillText(`#${i + 1}　(${String(l && l.pos || '?,?,?')})`, 88, y); } catch { }
                ctx.fillStyle = l && l.solved ? '#acd58c' : '#e08585';
                try { ctx.fillText(`${(l && l.tries) | 0} 次`, 320, y); } catch { }
                try { ctx.fillText(l && l.solved ? '✅' : '❌', W - 108, y); } catch { }
                y += 27;
            }
            if (locks.length > 8) {
                ctx.fillStyle = '#7b8296';
                try { ctx.fillText(`…其余 ${locks.length - 8} 把锁见结算面板`, 88, y); } catch { }
            }
        }

        // ---- 底部落款（IP 红线：只有「关卡工坊 · mcweb」，不出现「我的世界」）----
        ctx.textAlign = 'center';
        ctx.font = `400 16px ${POSTER_FONT}`;
        ctx.fillStyle = '#7b8296';
        try { ctx.fillText('关卡工坊 · mcweb', W / 2, H - 36); } catch { }

        // ---- 下载 PNG ----
        const url = cv.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeFileName(result.name)}-成绩.png`;
        document.body.appendChild(a); // 部分浏览器要求元素在 DOM 内 click 才生效
        a.click();
        a.remove();
    } catch (e) {
        // 降级铁律：海报失败绝不抛错（W 套件断言），只留日志
        try { console.warn('[levelPoster] 海报生成失败（已降级不抛错）', e); } catch { }
    }
}
