// ==================== test_thumbnail.mjs ====================
// 关卡缩略图（js/levelPoster.js）Node 自测：node:test，直接 `node tools/test_thumbnail.mjs` 可跑。
// 覆盖 P1 · B6 的纯逻辑层 thumbnailColumns（「列 → 最高非空块 → 颜色」）：
//   取色与列序（x 最快）/ 全空列暗底 / 未知方块 '#888' / 确定性 / 损坏卡降级 [] 不抛 /
//   Node 无 DOM 时 renderRegionThumbnail 返回 null（canvas 绘制留浏览器侧）。
// levelPoster 的静态依赖链 config/state/world/rle + levelWorkshop 均无 three/DOM，Node 可直连。

import test from 'node:test';
import assert from 'node:assert/strict';

import { BlockTypes, WORLD_DEPTH, WORLD_HEIGHT, WORLD_WIDTH } from '../js/config.js';
import { state } from '../js/state.js';
import { rleEncode } from '../js/rle.js';
import { u8ToBase64 } from '../js/levelWorkshop.js';
import { renderRegionThumbnail, thumbnailColumns } from '../js/levelPoster.js';

const W = WORLD_WIDTH;
const H = WORLD_HEIGHT;
const D = WORLD_DEPTH;
const idx = (x, y, z) => x + z * W + y * W * D;

// 与 levelPoster.js 模块内 THUMB_BG 常量一致（未导出，测试侧固定字面量 + 注释锚定）
const THUMB_BG = '#20242e';

// 手工组卡：region {x0,y0,z0,w,h,d} + 当前方块快照 RLE 直出（同 test_level_workshop 夹具手法）
function makeCard(region) {
    const raw = new Uint8Array(region.w * region.h * region.d);
    let k = 0;
    for (let ly = 0; ly < region.h; ly++) {
        for (let lz = 0; lz < region.d; lz++) {
            for (let lx = 0; lx < region.w; lx++) {
                raw[k++] = state.blocks[idx(region.x0 + lx, region.y0 + ly, region.z0 + lz)];
            }
        }
    }
    return {
        format: 'mcweb.level.v1',
        name: '缩略图测试关',
        region: { ...region, enc: 'rle', blocks: u8ToBase64(rleEncode(raw)) },
    };
}

function resetWorld() {
    state.blocks = new Uint8Array(W * D * H);
}

// ---- 夹具：3×3×2 小区域，六个列覆盖 取色/空列/未知块/水/层序 五种情形 ----
// 列（局部 x,z）：(0,0) 草在土上→取草；(1,0) 只有石头；(2,0) 全空气→暗底；
//               (0,1) 顶面水；(1,1) 未知方块 id 250；(2,1) 树叶压基岩→取树叶
function makeFixture() {
    resetWorld();
    const r = { x0: 10, y0: 5, z0: 20, w: 3, h: 3, d: 2 };
    const put = (lx, ly, lz, id) => { state.blocks[idx(r.x0 + lx, r.y0 + ly, r.z0 + lz)] = id; };
    put(0, 0, 0, BlockTypes.DIRT);
    put(0, 1, 0, BlockTypes.GRASS);
    put(1, 0, 0, BlockTypes.STONE);
    put(0, 2, 1, BlockTypes.WATER);
    put(1, 2, 1, 250); // 未登记方块：BlockInfo 无色 → '#888'
    put(2, 0, 1, BlockTypes.BEDROCK);
    put(2, 2, 1, BlockTypes.LEAVES);
    return makeCard(r);
}

test('thumbnailColumns 逐列取最高非空方块颜色，下标 = lz*w+lx（x 最快）', () => {
    const card = makeFixture();
    const cols = thumbnailColumns(card);
    assert.equal(cols.length, 3 * 2); // w*d 个列
    assert.deepEqual(cols, [
        { color: '#5a9e3d' }, // (0,0) 草在土上：自顶向下先碰草
        { color: '#7a7a7a' }, // (1,0) 只有石头
        { color: THUMB_BG },  // (2,0) 全空气列 → 暗底（不是 '#888' 噪声灰）
        { color: '#3a6ea5' }, // (0,1) 顶面水照算（俯视图水麵可读）
        { color: '#888' },    // (1,1) 未知方块缺色兜底
        { color: '#3d7a2a' }, // (2,1) 树叶压基岩：取更高的树叶
    ]);
});

test('thumbnailColumns 确定性：同卡两次调用结果逐项一致', () => {
    const card = makeFixture();
    assert.deepEqual(thumbnailColumns(card), thumbnailColumns(card));
});

test('thumbnailColumns 损坏卡降级为空数组且不抛错', () => {
    assert.deepEqual(thumbnailColumns(null), []);
    assert.deepEqual(thumbnailColumns({}), []); // 缺 region
    assert.deepEqual(
        thumbnailColumns({ region: { x0: 0, y0: 0, z0: 0, w: 2, h: 2, d: 2, enc: 'rle', blocks: '%%%非法base64' } }),
        [],
    );
    // base64 合法但 RLE 解码长度与尺寸不符（数据损坏）
    assert.deepEqual(
        thumbnailColumns({ region: { x0: 0, y0: 0, z0: 0, w: 2, h: 2, d: 2, enc: 'rle', blocks: u8ToBase64(rleEncode(new Uint8Array(3))) } }),
        [],
    );
});

test('renderRegionThumbnail 在 Node（无 DOM）返回 null，不抛错', () => {
    assert.equal(renderRegionThumbnail(makeFixture(), 128), null);
    assert.equal(renderRegionThumbnail(null, 128), null);
});
