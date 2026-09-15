// RLE 压缩（零依赖独立模块）：[value, countHi, countLo] 三元组流，单段最长 65535。
// 2026-09-15 自 saveGame.js 抽出：关卡卡区域快照（levelWorkshop.js）要在 Node 测试里直连，
// 而 saveGame.js 的 import 链含 chunk.js（three.js CDN）无法在 Node 加载。
// 字节格式与迁移前完全一致；saveGame.js 与 assistant/snapshot.js 经再导出保持原引用路径。

export function rleEncode(u8) {
    const out = [];
    let i = 0;
    while (i < u8.length) {
        const v = u8[i];
        let run = 1;
        while (run < 0xFFFF && i + run < u8.length && u8[i + run] === v) run++;
        out.push(v, run >> 8, run & 0xFF);
        i += run;
    }
    return new Uint8Array(out);
}

// 解码到指定总长度的 Uint8Array；长度不符（数据损坏）返回 null
export function rleDecode(u8, total) {
    const out = new Uint8Array(total);
    let pos = 0;
    for (let i = 0; i + 2 < u8.length; i += 3) {
        const run = (u8[i + 1] << 8) | u8[i + 2];
        if (pos + run > total) return null;
        out.fill(u8[i], pos, pos + run);
        pos += run;
    }
    return pos === total ? out : null;
}
