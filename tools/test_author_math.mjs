// tools/test_author_math.mjs —— evalMathExpr 纯函数单测（node:test，关卡工坊批次 W·B3）
// js/eduKeypad.js 顶层有浏览器依赖链（three/chunk/DOM），Node 无法整文件 import——
// 照 tools/test_gen_draft.mjs 的切片惯例：按 AUTHOR-PURE 区间标记切源码、剥 export、
// new Function 求值（求值器本身禁止 eval/Function，切片求值只是测试侧装载手段）。
// 运行：cd <仓库根> && node --test tools/test_author_math.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'eduKeypad.js'), 'utf8');
const m = src.match(/\/\/ >>> AUTHOR-PURE-BEGIN([\s\S]*?)\/\/ <<< AUTHOR-PURE-END/);
assert(m, 'eduKeypad.js 缺少 AUTHOR-PURE 纯函数区（标记被移动或改名？）');
const code = m[1].replace(/\bexport\s+function\b/g, 'function');
// 安全红线自检：求值器区间内不得出现 eval / Function 构造器（防「安全求值器」自己变后门）
assert.ok(!/\beval\s*\(/.test(code), 'AUTHOR-PURE 区不得调用 eval');
assert.ok(!code.includes('Function('), 'AUTHOR-PURE 区不得使用 Function 构造器');

const { evalMathExpr } = new Function(`${code}; return { evalMathExpr };`)();

// ---------- 优先级与结合性 ----------

test('乘加优先级：3×4+5 = 17', () => {
    assert.equal(evalMathExpr('3×4+5'), 17);
});

test('乘加优先级：2+3×4 = 14（先乘除后加减）', () => {
    assert.equal(evalMathExpr('2+3×4'), 14);
});

test('全角−与乘法优先：20−3×5 = 5', () => {
    assert.equal(evalMathExpr('20−3×5'), 5);
});

test('全角÷：18÷2+7 = 16', () => {
    assert.equal(evalMathExpr('18÷2+7'), 16);
});

test('同级左结合（乘除）：8÷2×3 = 12', () => {
    assert.equal(evalMathExpr('8÷2×3'), 12);
});

test('同级左结合（加减）：10−4−3 = 3', () => {
    assert.equal(evalMathExpr('10−4−3'), 3);
});

// ---------- 括号 ----------

test('括号改优先级：(2+3)×6 = 30', () => {
    assert.equal(evalMathExpr('(2+3)×6'), 30);
});

test('嵌套括号：(1+(2+3))×2 = 12', () => {
    assert.equal(evalMathExpr('(1+(2+3))×2'), 12);
});

test('两组括号：(2+3)×(7−5) = 10', () => {
    assert.equal(evalMathExpr('(2+3)×(7−5)'), 10);
});

// ---------- 全角符号 / 空白 / 一元负号 ----------

test('全角×÷−混用：9×9−18÷2 = 72', () => {
    assert.equal(evalMathExpr('9×9−18÷2'), 72);
});

test('全角括号：（2+3）×4 = 20', () => {
    assert.equal(evalMathExpr('（2+3）×4'), 20);
});

test('token 间空白：3 × 4 + 5 = 17', () => {
    assert.equal(evalMathExpr('3 × 4 + 5'), 17);
});

test('一元负号：−5+8 = 3', () => {
    assert.equal(evalMathExpr('−5+8'), 3);
});

// ---------- 小数与边界 ----------

test('除不尽保留小数：1÷2 = 0.5（0..9999 范围校验交给保存关卡）', () => {
    assert.equal(evalMathExpr('1÷2'), 0.5);
});

test('大数：9999×9999 = 99980001', () => {
    assert.equal(evalMathExpr('9999×9999'), 99980001);
});

// ---------- 除零 ----------

test('除零：5÷0 → null', () => {
    assert.equal(evalMathExpr('5÷0'), null);
});

test('除零藏在括号里：10÷(5−5) → null', () => {
    assert.equal(evalMathExpr('10÷(5−5)'), null);
});

// ---------- 非法输入一律 null ----------

test('空串 → null', () => {
    assert.equal(evalMathExpr(''), null);
});

test('非字符串输入 → null', () => {
    assert.equal(evalMathExpr(null), null);
    assert.equal(evalMathExpr(42), null);
    assert.equal(evalMathExpr(undefined), null);
});

test('尾缀残缺：3+ → null', () => {
    assert.equal(evalMathExpr('3+'), null);
});

test('前缀残缺：×3 → null（乘号不做一元）', () => {
    assert.equal(evalMathExpr('×3'), null);
});

test('字母混入：3+a → null', () => {
    assert.equal(evalMathExpr('3+a'), null);
});

test('小数点不支持：3.4 → null', () => {
    assert.equal(evalMathExpr('3.4'), null);
});

test('括号不配对：(1+2 → null', () => {
    assert.equal(evalMathExpr('(1+2'), null);
});

test('多余右括号：1+2) → null', () => {
    assert.equal(evalMathExpr('1+2)'), null);
});

test('数字被空白隔断：3 4 → null（不是 34）', () => {
    assert.equal(evalMathExpr('3 4'), null);
});
