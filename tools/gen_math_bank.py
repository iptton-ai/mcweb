#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_math_bank.py —— 数学题库生成器（北师大版三年级上册全册 8 单元）

产出: assets/edu/grade3-math.json（契约 docs/edu-quiz-banks-contract.md §2 统一 schema）

用法:
    python3 tools/gen_math_bank.py            # 生成并写文件 + 全量自查
    python3 tools/gen_math_bank.py --check    # 只校验现有文件，不重写

设计要点:
  1. 固定随机种子，产物可复现（同一命令跑两次字节一致）；
  2. 每题生成时用真实算术求答案（公式直接算出，不是手填）；
  3. 独立第二通道校验 recheck_input()：对算式题用内置表达式求值器 eval_expr()
     重算比对；对文字题用正则提取参数后按独立公式重算比对；两通道必须一致，
     否则直接抛错终止——漏配校验器的题会显式失败，不会蒙混过关；
  4. 全局 q 去重；input 答案必须是 0..9999 整数；每题必带 unit + hint；
  5. 旧版 extracted 11 题（hint 含课本页码）原样保留，并入「三上·混合运算」。
"""

import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "assets" / "edu" / "grade3-math.json"

# 固定随机种子：产物可复现
SEED = 20260909

# ---------------------------------------------------------------------------
# 单元标签（item.unit 用）
# ---------------------------------------------------------------------------
U_HUNHE = "三上·混合运算"
U_GUANCHA = "三上·观察物体"
U_JIANJIAN = "三上·加与减"
U_CHENGCHU = "三上·乘与除"
U_ZHOUCHANG = "三上·周长"
U_CHENGFA = "三上·乘法"
U_NIANYUERI = "三上·年月日"
U_XIAOSHU = "三上·认识小数"

SOURCE = (
    "北师大版数学三年级上册（义务教育教科书·数学三年级上册_66e175c4）："
    "一混合运算 / 二观察物体 / 三加与减 / 四乘与除 / 五周长 / 六乘法 / 七年月日 / 八认识小数。"
    "其中 extracted 11 题为课本 PDF 启发式抽取（hint 含页码，人工逐题核验），"
    "其余为程序生成（tools/gen_math_bank.py，生成即重算 + 独立二次校验）。"
)

# ---------------------------------------------------------------------------
# 内置算式求值器（校验第二通道；除法必须整除，否则抛异常 = 生成端就拦住坏题）
# 题干运算符用全角数学符号：+ −(U+2212) × ÷ 与半角括号
# ---------------------------------------------------------------------------
_TOKEN_RE = re.compile(r"\s*(?:(\d+)|(.))")


def eval_expr(q):
    """把「78−3×5」「(14+5)×2」这类算式求值。除不尽 / 除 0 抛 ValueError。"""
    q = q.replace("（", "(").replace("）", ")")
    toks = []
    i = 0
    while i < len(q):
        m = _TOKEN_RE.match(q, i)
        if not m:
            raise ValueError(f"无法记号化: {q!r} 位置 {i}: {q[i:]!r}")
        if m.group(1):
            toks.append(int(m.group(1)))
        else:
            toks.append(m.group(2))
        i = m.end()
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else None

    def take(expect=None):
        t = peek()
        if expect is not None and t != expect:
            raise ValueError(f"期望 {expect!r} 实际 {t!r}: {q}")
        pos[0] += 1
        return t

    def factor():
        t = peek()
        if t == "(":
            take()
            v = expr()
            take(")")
            return v
        if isinstance(t, int):
            take()
            return t
        raise ValueError(f"意外记号 {t!r}: {q}")

    def term():
        v = factor()
        while peek() in ("×", "÷"):
            op = take()
            r = factor()
            if op == "×":
                v *= r
            else:
                if r == 0 or v % r != 0:
                    raise ValueError(f"除法不整除: {q}")
                v //= r
        return v

    def expr():
        v = term()
        while peek() in ("+", "−"):
            op = take()
            r = term()
            v = v + r if op == "+" else v - r
        return v

    v = expr()
    if pos[0] != len(toks):
        raise ValueError(f"多余记号: {q}")
    return v


# ---------------------------------------------------------------------------
# 工具：登记一道题（全局 q 去重 + 答案范围守卫）
# ---------------------------------------------------------------------------
_seen = {}  # q -> unit


def add_item(items, q, a, unit, hint):
    q = q.strip()
    if q in _seen:
        return False  # 重复题静默跳过（生成器会补量）
    if not isinstance(a, int):
        raise AssertionError(f"答案非整数: {q} -> {a!r}")
    if not (0 <= a <= 9999):
        raise AssertionError(f"答案越界 0..9999: {q} -> {a}")
    if not unit or not hint:
        raise AssertionError(f"unit/hint 缺失: {q}")
    _seen[q] = unit
    items.append({"q": q, "a": int(a), "unit": unit, "hint": hint})
    return True


def gen_until(rng, items, n, unit, maker):
    """反复调 maker 直到该单元凑够 n 题（maker 返回 (q, a, hint) 或 None）。"""
    guard = 0
    start = len(items)
    while len(items) - start < n:
        guard += 1
        if guard > 60000:
            raise AssertionError(f"{unit} 凑题失败：模板空间耗尽（已试 {guard} 次）")
        made = maker(rng)
        if made is None:
            continue
        q, a, hint = made
        add_item(items, q, a, unit, hint)
    return items


def pick(rng, lo, hi, exclude=()):
    """[lo, hi] 闭区间随机取整数，避开 exclude 中的值。"""
    for _ in range(200):
        v = rng.randint(lo, hi)
        if v not in exclude:
            return v
    raise AssertionError(f"pick 空间耗尽: {lo}..{hi}")


# ---------------------------------------------------------------------------
# 单元一：混合运算（乘加 / 减乘 / 除加 / 减除 / 带小括号）
# 生成即用真算式计算答案；hint 给「先算…再算…」两步讲解
# ---------------------------------------------------------------------------
def gen_hunhe(rng, n):
    items = []

    def maker(r):
        kind = r.choice([
            "add_mul", "sub_mul", "div_add", "mul_add", "sub_div",
            "paren_mul", "paren_sub", "paren_div", "mul_sub",
        ])
        if kind == "add_mul":                      # a + b×c
            b, c = r.randint(2, 9), r.randint(2, 9)
            bc = b * c
            a = r.randint(2, 90)
            q = f"{a}+{b}×{c}"
            ans = a + bc
            hint = f"先算乘法 {b}×{c}={bc}，再算 {a}+{bc}={ans}"
        elif kind == "sub_mul":                    # a − b×c（保证正）
            b, c = r.randint(2, 9), r.randint(2, 9)
            bc = b * c
            a = r.randint(bc + 1, bc + 60)
            q = f"{a}−{b}×{c}"
            ans = a - bc
            hint = f"先算乘法 {b}×{c}={bc}，再算 {a}−{bc}={ans}"
        elif kind == "div_add":                    # a÷b + c（整除）
            b, k = r.randint(2, 9), r.randint(2, 9)
            a = b * k
            c = r.randint(2, 60)
            q = f"{a}÷{b}+{c}"
            ans = k + c
            hint = f"先算除法 {a}÷{b}={k}，再算 {k}+{c}={ans}"
        elif kind == "mul_add":                    # a×b + c
            a, b = r.randint(2, 9), r.randint(2, 9)
            ab = a * b
            c = r.randint(2, 60)
            q = f"{a}×{b}+{c}"
            ans = ab + c
            hint = f"先算乘法 {a}×{b}={ab}，再算 {ab}+{c}={ans}"
        elif kind == "sub_div":                    # a − b÷c（整除且为正）
            c, k = r.randint(2, 9), r.randint(2, 9)
            b = c * k
            a = r.randint(k + 1, k + 60)
            q = f"{a}−{b}÷{c}"
            ans = a - k
            hint = f"先算除法 {b}÷{c}={k}，再算 {a}−{k}={ans}"
        elif kind == "paren_mul":                  # (a+b)×c
            a, b = r.randint(2, 40), r.randint(2, 40)
            c = r.randint(2, 9)
            s = a + b
            q = f"({a}+{b})×{c}"
            ans = s * c
            hint = f"先算小括号 {a}+{b}={s}，再算 {s}×{c}={ans}"
        elif kind == "paren_sub":                  # a − (b+c)
            b, c = r.randint(2, 40), r.randint(2, 40)
            s = b + c
            a = r.randint(s + 1, s + 50)
            q = f"{a}−({b}+{c})"
            ans = a - s
            hint = f"先算小括号 {b}+{c}={s}，再算 {a}−{s}={ans}"
        elif kind == "paren_div":                  # (a+b)÷c（整除）
            c, k = r.randint(2, 9), r.randint(2, 20)
            s = c * k
            a = r.randint(1, s - 1)
            b = s - a
            q = f"({a}+{b})÷{c}"
            ans = k
            hint = f"先算小括号 {a}+{b}={s}，再算 {s}÷{c}={k}"
        else:                                      # mul_sub: a×b − c
            a, b = r.randint(2, 9), r.randint(2, 9)
            ab = a * b
            c = r.randint(1, ab - 1)
            q = f"{a}×{b}−{c}"
            ans = ab - c
            hint = f"先算乘法 {a}×{b}={ab}，再算 {ab}−{c}={ans}"
        return q, ans, hint

    return gen_until(rng, items, n, U_HUNHE, maker)


# 旧版 extracted 11 题：q / a / hint 原样保留（hint 含课本页码），补 unit。
# 答案已人工逐题核验：6/19/49/5/20/30/33/57/38/3/25 全对。
EXTRACTED = [
    ("20−2×7", 6, "课本第4页（PDF p8）"),
    ("5×3+4", 19, "课本第4页（PDF p8）"),
    ("4×6+25", 49, "课本第5页（PDF p9）"),
    ("50−5×9", 5, "课本第5页（PDF p9）"),
    ("8×2+4", 20, "课本第5页（PDF p9）"),
    ("50−4×5", 30, "课本第5页（PDF p9）"),
    ("3×7+12", 33, "课本第7页（PDF p11）"),
    ("5×9+12", 57, "课本第8页（PDF p12）"),
    ("86−6×8", 38, "课本第8页（PDF p12）"),
    ("15−6×2", 3, "课本第8页（PDF p12）"),
    ("49−3×8", 25, "课本第12页（PDF p16）"),
]


def items_extracted():
    items = []
    for q, a, hint in EXTRACTED:
        # extracted 必须原样保留：q 撞车是严重事故，直接抛错而非静默跳过
        if q in _seen:
            raise AssertionError(f"extracted 题 q 与生成题撞车: {q!r}")
        add_item(items, q, a, U_HUNHE, hint)
    return items


# ---------------------------------------------------------------------------
# 单元二：观察物体（可数字化的计数题为主 + 5 道 choice）
# ---------------------------------------------------------------------------
def gen_guancha_input(rng, n):
    items = []

    def maker(r):
        kind = r.choice([
            "slab", "row_front", "stack_side", "tower", "grid_top", "lshape",
        ])
        if kind == "slab":                          # a×b 单层平板
            a, b = r.randint(2, 6), r.randint(2, 6)
            if a == b:
                return None                          # 避免与 cube 语义混淆的重复形态
            ans = a * b
            q = f"用小正方体搭一个{a}×{b}的单层平板（实心摆满一层），需要几个小正方体?"
            hint = f"一层摆 {a} 行、每行 {b} 个：{a}×{b}={ans}（个）"
        elif kind == "row_front":                   # 一排 n 个，从正面看
            a = r.randint(3, 9)
            ans = a
            q = f"用{a}个小正方体横着排成一排（单排单层），从正面看能看到几个小正方形?"
            hint = f"{a} 个排成一行，正面看就是一行 {a} 个小正方形"
        elif kind == "stack_side":                  # 一列 n 个，从侧面看
            a = r.randint(3, 9)
            ans = a
            q = f"用{a}个小正方体竖着叠成一列，从侧面看能看到几个小正方形?"
            hint = f"{a} 个叠成一列，侧面看就是竖着的 {a} 个小正方形"
        elif kind == "tower":                       # 三层塔：a×a / b×b / 1
            a = r.randint(2, 4)
            b = r.randint(1, a - 1)
            ans = a * a + b * b + 1
            q = (f"用小正方体搭一个三层图形：底层是{a}×{a}实心摆满，"
                 f"中层是{b}×{b}，顶层1个，一共用了几个小正方体?")
            hint = f"底层 {a}×{a}={a*a} 个，中层 {b}×{b}={b*b} 个，顶层 1 个：{a*a}+{b*b}+1={ans}（个）"
        elif kind == "grid_top":                    # 俯视 a×b，每格 1 层
            a, b = r.randint(2, 6), r.randint(2, 6)
            ans = a * b
            q = (f"一个立体图形从上面看是{a}×{b}的长方形阵列，"
                 f"每个位置只摆1层，一共用了几个小正方体?")
            hint = f"上面看到 {a}×{b}={ans} 个位置，每个位置 1 层，共 {ans} 个"
        else:                                       # lshape: 横排 a 个 + 竖列再往上 b 个
            a, b = r.randint(2, 6), r.randint(2, 5)
            ans = a + b - 1
            q = (f"用小正方体搭「L」形：横着排{a}个、竖列再往上叠{b}个"
                 f"（拐角处共用同1个），一共用了几个小正方体?")
            hint = f"拐角那个只算一次：横排 {a} 个 + 竖列另加 {b - 1} 个，{a}+{b - 1}={ans}（个）"
        return q, ans, hint

    gen_until(rng, items, n - 4, U_GUANCHA, maker)  # 预留 4 道固定题

    # 固定题（一次性、不可参数化），q 全局唯一由 add_item 保证
    add_item(items, "从正面看由4个小正方形拼成「田」字的立体图形，最少需要几个小正方体?",
             4, U_GUANCHA, "「田」字有 4 个小正方形：摆 2 行、每行 2 个，最少 4 个")
    add_item(items, "从上面看由9个小正方形拼成「九宫格」的一层图形，需要几个小正方体?",
             9, U_GUANCHA, "九宫格 9 个位置，每个位置摆 1 个，共 9 个")
    add_item(items, "把一个正方体礼盒放在桌上不动，从斜上方观察它，最多能同时看到几个面?",
             3, U_GUANCHA, "斜上方看 = 上面 + 前面 + 侧面，最多同时看到 3 个面")
    add_item(items, "用小正方体搭一个实心的2×2×2方块，需要几个小正方体?",
             8, U_GUANCHA, "每层 2×2=4 个，共 2 层：4×2=8（个）")
    return items


def gen_guancha_choice(rng):
    """观察物体 choice 题（数量观察三视图不易数字化的，转概念选择题）。"""

    def mc(q, correct, distractors, unit, hint):
        opts = [correct] + list(distractors)
        if len(set(opts)) != len(opts):
            raise AssertionError(f"选项重复: {q}")
        r = rng.random()  # 打乱选项顺序，正确项下标随机
        order = list(range(len(opts)))
        rng.shuffle(order)
        shuffled = [opts[i] for i in order]
        return {
            "q": q, "options": shuffled, "a": shuffled.index(correct),
            "unit": unit, "hint": hint,
        }

    items = [
        mc("一个球，从正面、上面、侧面任何一个方向看，看到的形状都是?",
           "圆形", ["正方形", "长方形", "三角形"], U_GUANCHA,
           "球在各个方向上的投影都是圆"),
        mc("正方体从正面、上面、侧面看到的形状?",
           "都是正方形", ["都是长方形", "各不相同", "有的是圆形"], U_GUANCHA,
           "正方体六个面都是正方形，各方向看到的都是正方形"),
        mc("观察一个长方体的牙膏盒，从它的侧面看到的形状是?",
           "长方形", ["圆形", "三角形", "正方体"], U_GUANCHA,
           "长方体的每个面都是长方形，侧面看到长方形"),
        mc("站在一个位置观察桌面上的正方体魔方，一次最多能看到它的几个面?",
           "3个", ["1个", "6个", "4个"], U_GUANCHA,
           "斜上方观察最多同时看到 3 个面"),
        mc("哪个物体从正面看是长方形、从上面看是圆形?",
           "圆柱形水杯", ["正方体魔方", "三角尺", "数学课本"], U_GUANCHA,
           "圆柱侧面投影是长方形，俯视是圆"),
    ]
    return items


# ---------------------------------------------------------------------------
# 单元三：加与减（万以内加减法，结果 ≤ 9999 且 ≥ 0）
# ---------------------------------------------------------------------------
def gen_jiajian(rng, n):
    items = []

    def maker(r):
        kind = r.choice(["add3", "sub3", "add3c", "sum3", "diff2", "mix"])
        if kind == "add3":                          # 三位数 + 三位数
            a, b = r.randint(100, 899), r.randint(100, 899)
            ans = a + b
            q = f"{a}+{b}"
            hint = (f"相同数位对齐从个位加起"
                    f"{'，个位满十向十位进一' if a % 10 + b % 10 >= 10 else ''}"
                    f"{'，十位满十向百位进一' if (a // 10 % 10 + b // 10 % 10 + (1 if a % 10 + b % 10 >= 10 else 0)) >= 10 else ''}")
        elif kind == "sub3":                        # 三位数 − 三位数
            a = r.randint(200, 999)
            b = r.randint(100, a - 1)
            ans = a - b
            q = f"{a}−{b}"
            hint = (f"相同数位对齐从个位减起"
                    f"{'，个位不够减向十位借一' if a % 10 < b % 10 else ''}"
                    f"{'，十位不够减向百位借一' if a // 10 % 10 - (1 if a % 10 < b % 10 else 0) < b // 10 % 10 else ''}")
        elif kind == "add3c":                       # 连续进位加法
            a = r.randint(350, 699)
            b = r.randint(350, 299 + a // 2)
            ans = a + b
            q = f"{a}+{b}"
            hint = f"哪一位相加满十就向前一位进一：{a}+{b}={ans}"
        elif kind == "sum3":                        # 连加
            a, b, c = r.randint(100, 700), r.randint(50, 200), r.randint(50, 200)
            if a + b + c > 9999:
                return None
            ans = a + b + c
            q = f"{a}+{b}+{c}"
            hint = f"从左往右依次算：{a}+{b}={a + b}，再加 {c} 得 {ans}"
        elif kind == "diff2":                       # 连减
            a = r.randint(500, 999)
            b = r.randint(100, 350)
            c = r.randint(100, a - b - 1)
            ans = a - b - c
            q = f"{a}−{b}−{c}"
            hint = f"从左往右依次算：{a}−{b}={a - b}，再减 {c} 得 {ans}"
        else:                                       # a − b + c（混合）
            a = r.randint(300, 900)
            b = r.randint(100, a - 1)
            c = r.randint(100, 400)
            ans = a - b + c
            q = f"{a}−{b}+{c}"
            hint = f"从左往右依次算：{a}−{b}={a - b}，再加 {c} 得 {ans}"
        return q, ans, hint

    return gen_until(rng, items, n, U_JIANJIAN, maker)


# ---------------------------------------------------------------------------
# 单元四：乘与除（口算：整十整百乘除一位数 / 两位数乘除一位数）
# ---------------------------------------------------------------------------
def gen_chengchu(rng, n):
    items = []

    def maker(r):
        kind = r.choice(["tens_mul", "hundreds_mul", "two_mul",
                         "tens_div", "hundreds_div", "two_div"])
        if kind == "tens_mul":                      # 整十数 × 一位数
            t = r.randint(1, 9) * 10
            b = r.randint(2, 9)
            ans = t * b
            q = f"{t}×{b}"
            hint = f"{t // 10}个十乘{b}是{t * b // 10}个十，就是{ans}"
        elif kind == "hundreds_mul":                # 整百数 × 一位数
            h = r.randint(1, 9) * 100
            b = r.randint(2, 9)
            if h * b > 9999:
                return None
            ans = h * b
            q = f"{h}×{b}"
            hint = f"{h // 100}个百乘{b}是{h * b // 100}个百，就是{ans}"
        elif kind == "two_mul":                     # 两位数 × 一位数（口算）
            a = r.randint(11, 49)
            b = r.randint(2, 5)
            ans = a * b
            q = f"{a}×{b}"
            ten, one = a // 10 * b, a % 10 * b
            hint = f"先算 {a // 10}0×{b}={ten}，再算 {a % 10}×{b}={one}，合起来是{ans}"
        elif kind == "tens_div":                    # 整十数 ÷ 一位数
            b = r.randint(2, 9)
            k = r.randint(2, 9)
            t = b * k * 10
            if t > 900:
                return None
            ans = k * 10
            q = f"{t}÷{b}"
            hint = f"{t // 10}个十除以{b}是{k}个十，就是{ans}"
        elif kind == "hundreds_div":                # 整百数 ÷ 一位数
            b = r.randint(2, 9)
            k = r.randint(2, 9)
            h = b * k
            if h % 100 != 0:
                return None
            h *= 100
            if h > 900:
                return None
            ans = k * 100
            q = f"{h}÷{b}"
            hint = f"{h // 100}个百除以{b}是{k}个百，就是{ans}"
        else:                                       # 两位数 ÷ 一位数（整除）
            b = r.randint(2, 9)
            k = r.randint(3, 19)
            a = b * k
            if a < 12 or a > 98:
                return None
            ans = k
            q = f"{a}÷{b}"
            hint = f"想乘法：{b}×{k}={a}，所以 {a}÷{b}={k}"
        return q, ans, hint

    return gen_until(rng, items, n, U_CHENGCHU, maker)


# ---------------------------------------------------------------------------
# 单元五：周长（长方形 / 正方形周长正逆向）
# ---------------------------------------------------------------------------
def gen_zhouchang(rng, n):
    items = []
    units_cm = [("厘米", "厘米"), ("分米", "分米"), ("米", "米")]

    def maker(r):
        kind = r.choice(["rect", "square", "square_inv", "rect_w"])
        u, _ = r.choice(units_cm)
        if kind == "rect":                          # 长方形正向
            l, w = r.randint(2, 40), r.randint(1, 30)
            if l == w:
                return None                          # 长等于宽就是正方形，改道
            ans = 2 * (l + w)
            q = f"长方形的长是{l}{u}，宽是{w}{u}，它的周长是多少{u}?"
            hint = f"长方形周长=(长+宽)×2=({l}+{w})×2={ans}（{u}）"
        elif kind == "square":                      # 正方形正向
            s = r.randint(1, 25)
            ans = 4 * s
            q = f"正方形的边长是{s}{u}，它的周长是多少{u}?"
            hint = f"正方形周长=边长×4={s}×4={ans}（{u}）"
        elif kind == "square_inv":                  # 正方形逆向：周长→边长
            s = r.randint(2, 25)
            p = 4 * s
            ans = s
            q = f"正方形的周长是{p}{u}，它的边长是多少{u}?"
            hint = f"边长=周长÷4={p}÷4={ans}（{u}）"
        else:                                       # 长方形逆向：周长+长→宽
            w = r.randint(1, 25)
            l = r.randint(w + 1, w + 25)
            p = 2 * (l + w)
            ans = w
            q = f"长方形的周长是{p}{u}，长是{l}{u}，它的宽是多少{u}?"
            hint = f"长+宽=周长÷2={p}÷2={l + w}，宽={l + w}−{l}={ans}（{u}）"
        return q, ans, hint

    return gen_until(rng, items, n, U_ZHOUCHANG, maker)


# ---------------------------------------------------------------------------
# 单元六：乘法（两三位数 × 一位数，积 ≤ 9999）
# ---------------------------------------------------------------------------
def gen_chengfa(rng, n):
    items = []

    def maker(r):
        kind = r.choice(["two", "three", "zero_mid", "zero_end", "carry9"])
        if kind == "two":                           # 两位数 × 一位数
            a = r.randint(12, 99)
            b = r.randint(2, 9)
            ans = a * b
            q = f"{a}×{b}"
            hint = f"从个位乘起：{a % 10}×{b}={a % 10 * b}，十位 {a // 10}×{b}={a // 10 * b}，得 {ans}"
        elif kind == "three":                       # 三位数 × 一位数
            a = r.randint(102, 999)
            b = r.randint(2, 9)
            if a * b > 9999:
                return None
            ans = a * b
            q = f"{a}×{b}"
            hint = f"从个位乘起，哪一位满几十就向前一位进几：{a}×{b}={ans}"
        elif kind == "zero_mid":                    # 中间有 0
            a = r.choice([101, 102, 103, 105, 106, 201, 203, 204, 205,
                          301, 304, 305, 402, 405, 501, 503, 602, 705])
            b = r.randint(2, 9)
            if a * b > 9999:
                return None
            ans = a * b
            q = f"{a}×{b}"
            hint = f"中间的 0 也要乘：0×{b}=0 占住十位，再加进位，{a}×{b}={ans}"
        elif kind == "zero_end":                    # 末尾有 0
            a = r.choice([120, 130, 140, 150, 210, 240, 250, 310, 320,
                          340, 420, 430, 510, 520, 610, 700, 800])
            b = r.randint(2, 9)
            if a * b > 9999:
                return None
            ans = a * b
            q = f"{a}×{b}"
            hint = f"先算 {a // 10}×{b}={a // 10 * b}，再在末尾补 1 个 0，得 {ans}"
        else:                                       # 连续进位
            a = r.choice([167, 178, 189, 237, 258, 269, 346, 358, 379,
                          456, 468, 479, 567, 578, 589, 678, 689, 789])
            b = r.choice([6, 7, 8, 9])
            if a * b > 9999:
                return None
            ans = a * b
            q = f"{a}×{b}"
            hint = f"每位相乘都满几十进几，细心进位：{a}×{b}={ans}"
        return q, ans, hint

    return gen_until(rng, items, n, U_CHENGFA, maker)


# ---------------------------------------------------------------------------
# 单元七：年月日（时分秒 / 年月日换算 + 经过时间 + 事实题）
# 事实题为常识记忆点（下表人工核验），换算题由公式生成 + 正则重算双通道校验
# ---------------------------------------------------------------------------
NIAN_FACTS = [
    # (题干, 答案, 讲解) —— 历法常识，人工核验
    ("平年二月有多少天?", 28, "平年二月 28 天，闰年二月 29 天"),
    ("闰年二月有多少天?", 29, "四年一闰，闰年二月 29 天"),
    ("一年有多少个月?", 12, "一年有 12 个月"),
    ("一年中有几个大月（31 天的月份）?", 7, "1、3、5、7、8、10、12 月是大月，共 7 个"),
    ("一年中有几个小月（30 天的月份）?", 4, "4、6、9、11 月是小月，共 4 个"),
    ("平年全年有多少天?", 365, "平年 365 天"),
    ("闰年全年有多少天?", 366, "闰年比平年多 1 天，共 366 天"),
    ("一年有几个季度?", 4, "一年分 4 个季度，每个季度 3 个月"),
    ("一个季度有多少个月?", 3, "3 个月为一个季度"),
    ("一个星期有多少天?", 7, "一星期 7 天：星期日、一、二、三、四、五、六"),
]


def gen_nianyueri(rng, n):
    items = []

    def maker(r):
        kind = r.choice([
            "h_to_m", "m_to_s", "hm_to_m", "ms_to_s", "s_to_m", "m_to_h",
            "y_to_m", "d_to_h", "w_to_d", "d_to_w", "elapsed",
        ])
        if kind == "h_to_m":                        # h 时 = ? 分
            h = r.randint(2, 12)
            ans = h * 60
            q = f"{h}时=?分"
            hint = f"1时=60分，{h}时就是 {h} 个 60 分：{h}×60={ans}（分）"
        elif kind == "m_to_s":                      # m 分 = ? 秒
            m = r.randint(2, 10)
            ans = m * 60
            q = f"{m}分=?秒"
            hint = f"1分=60秒，{m}分就是 {m} 个 60 秒：{m}×60={ans}（秒）"
        elif kind == "hm_to_m":                     # h时m分 = ? 分
            h = r.randint(1, 5)
            m = r.randint(5, 55)
            ans = h * 60 + m
            q = f"{h}时{m}分=?分"
            hint = f"{h}时={h * 60}分，再加 {m} 分：{h * 60}+{m}={ans}（分）"
        elif kind == "ms_to_s":                     # m分s秒 = ? 秒
            m = r.randint(1, 5)
            s = r.randint(5, 55)
            ans = m * 60 + s
            q = f"{m}分{s}秒=?秒"
            hint = f"{m}分={m * 60}秒，再加 {s} 秒：{m * 60}+{s}={ans}（秒）"
        elif kind == "s_to_m":                      # 秒 → 分（整分）
            m = r.randint(2, 10)
            sec = m * 60
            ans = m
            q = f"{sec}秒=?分"
            hint = f"{sec}÷60={m}，{sec}秒={m}分（60秒=1分）"
        elif kind == "m_to_h":                      # 分 → 时（整时）
            h = r.randint(2, 5)
            mi = h * 60
            ans = h
            q = f"{mi}分=?时"
            hint = f"{mi}÷60={h}，{mi}分={h}时（60分=1时）"
        elif kind == "y_to_m":                      # y 年 = ? 月
            y = r.randint(1, 9)
            ans = y * 12
            q = f"{y}年=?月"
            hint = f"1年=12月，{y}年就是 {y} 个 12 月：{y}×12={ans}（月）"
        elif kind == "d_to_h":                      # d 日 = ? 时
            d = r.randint(1, 5)
            ans = d * 24
            q = f"{d}日=?时"
            hint = f"1日=24时，{d}日就是 {d} 个 24 时：{d}×24={ans}（时）"
        elif kind == "w_to_d":                      # w 星期 = ? 天
            w = r.randint(1, 9)
            ans = w * 7
            q = f"{w}个星期=?天"
            hint = f"1个星期=7天：{w}×7={ans}（天）"
        elif kind == "d_to_w":                      # 天 → 星期
            w = r.randint(2, 9)
            days = w * 7
            ans = w
            q = f"{days}天=?个星期"
            hint = f"{days}÷7={w}，{days}天={w}个星期（7天=1星期）"
        else:                                       # 经过时间（24 时计时法）
            h1 = r.randint(8, 20)
            m1 = r.choice([0, 10, 15, 20, 25, 30, 40, 45, 50])
            total = h1 * 60 + m1 + r.randint(15, 180)
            h2, m2 = total // 60, total % 60
            if h2 > 23:
                return None
            ans = total - (h1 * 60 + m1)
            q = f"从{h1}:{m1:02d}到{h2}:{m2:02d}，经过了多少分钟?"
            hint = (f"结束 {h2}:{m2:02d} 化成 {h2 * 60 + m2} 分，开始化成 {h1 * 60 + m1} 分，"
                    f"相减得 {ans} 分钟")
        return q, ans, hint

    gen_until(rng, items, n - len(NIAN_FACTS), U_NIANYUERI, maker)
    for q, a, hint in NIAN_FACTS:
        add_item(items, q, a, U_NIANYUERI, hint)
    return items


# ---------------------------------------------------------------------------
# 单元八：认识小数（只考元角分互化类整数答案题）
# ---------------------------------------------------------------------------
def gen_xiaoshu(rng, n):
    items = []

    def maker(r):
        kind = r.choice(["yuanjiao_to_jiao", "yuanjiao_to_fen", "yuan_to_jiao",
                         "jiao_to_fen", "yuan_to_fen", "jiao_to_yuan",
                         "dec_to_jiao", "dec0_to_jiao"])
        if kind == "yuanjiao_to_jiao":              # x元y角 = ? 角
            x, y = r.randint(1, 9), r.randint(1, 9)
            ans = 10 * x + y
            q = f"{x}元{y}角=?角"
            if x == 1:
                hint = f"1元=10角，再加{y}角，共{ans}角"
            else:
                hint = f"1元=10角：{x}元={10 * x}角，再加{y}角共{ans}角"
        elif kind == "yuanjiao_to_fen":             # x元y角 = ? 分
            x, y = r.randint(1, 9), r.randint(1, 9)
            ans = 100 * x + 10 * y
            q = f"{x}元{y}角=?分"
            hint = f"1元=100分、1角=10分：{x}元={100 * x}分，{y}角={10 * y}分，共{ans}分"
        elif kind == "yuan_to_jiao":                # x元 = ? 角
            x = r.randint(1, 9)
            ans = 10 * x
            q = f"{x}元=?角"
            hint = f"1元=10角：{x}元就是 {x} 个 10 角，共{ans}角"
        elif kind == "jiao_to_fen":                 # y角 = ? 分
            y = r.randint(1, 9)
            ans = 10 * y
            q = f"{y}角=?分"
            hint = f"1角=10分：{y}角就是 {y} 个 10 分，共{ans}分"
        elif kind == "yuan_to_fen":                 # x元 = ? 分
            x = r.randint(1, 9)
            ans = 100 * x
            q = f"{x}元=?分"
            hint = f"1元=100分：{x}元就是 {x} 个 100 分，共{ans}分"
        elif kind == "jiao_to_yuan":                # 整十角 = ? 元
            t = r.randint(1, 9)
            ans = t
            q = f"{t * 10}角=?元"
            hint = f"10角=1元：{t * 10}角里有 {t} 个 10 角，就是{ans}元"
        elif kind == "dec_to_jiao":                 # x.y元 = ? 角（小数改写）
            x, y = r.randint(1, 9), r.randint(1, 9)
            ans = 10 * x + y
            q = f"{x}.{y}元=?角"
            hint = f"{x}.{y}元就是{x}元{y}角：{10 * x}角+{y}角={ans}角"
        else:                                       # 0.y元 = ? 角
            y = r.randint(1, 9)
            ans = y
            q = f"0.{y}元=?角"
            hint = f"0.{y}元就是{y}角（1元=10角，十分之几元就是几角）"
        return q, ans, hint

    return gen_until(rng, items, n, U_XIAOSHU, maker)


# ---------------------------------------------------------------------------
# 第二通道校验：与生成公式相互独立的重算实现
# 算式题 → eval_expr 重算；文字题 → 正则提取参数按公式重算；
# 每条 input 题必须命中其中一条规则，否则抛错（防漏配校验器）。
# ---------------------------------------------------------------------------
_PURE_EXPR = re.compile(r"^[\d+\-−×÷()\s]+$")


def recheck_input(item):
    """独立重算 input 答案；算不出来 / 不一致都抛 AssertionError。"""
    q, a = item["q"], item["a"]

    # 1) 纯算式
    if _PURE_EXPR.match(q) and re.search(r"[+\-−×÷]", q):
        v = eval_expr(q)
        if v != a:
            raise AssertionError(f"[算式重算不一致] {q}: 文件={a} 重算={v}")
        return

    # 2) 周长
    m = re.search(r"长方形的长是(\d+)(厘米|分米|米)，宽是(\d+)(厘米|分米|米)，它的周长是多少", q)
    if m:
        v = 2 * (int(m.group(1)) + int(m.group(3)))
        if v != a:
            raise AssertionError(f"[周长重算不一致] {q}: {a} vs {v}")
        return
    m = re.search(r"正方形的边长是(\d+)(厘米|分米|米)，它的周长是多少", q)
    if m:
        v = 4 * int(m.group(1))
        if v != a:
            raise AssertionError(f"[周长重算不一致] {q}: {a} vs {v}")
        return
    m = re.search(r"正方形的周长是(\d+)(厘米|分米|米)，它的边长是多少", q)
    if m:
        p = int(m.group(1))
        if p % 4 or p // 4 != a:
            raise AssertionError(f"[周长逆算不一致] {q}: {a} vs {p}/4")
        return
    m = re.search(r"长方形的周长是(\d+)(厘米|分米|米)，长是(\d+)\S+?，它的宽是多少", q)
    if m:
        p, l = int(m.group(1)), int(m.group(3))
        if p % 2 or p // 2 - l != a:
            raise AssertionError(f"[周长逆算不一致] {q}: {a} vs {p}/2−{l}")
        return

    # 3) 观察物体（与生成模板一一对应的独立公式）
    m = re.search(r"搭一个(\d+)×(\d+)的单层平板", q)
    if m:
        v = int(m.group(1)) * int(m.group(2))
        if v != a:
            raise AssertionError(f"[观察物体重算不一致] {q}")
        return
    m = re.search(r"实心的(\d+)×(\d+)×(\d+)方块", q)
    if m:
        v = int(m.group(1)) * int(m.group(2)) * int(m.group(3))
        if v != a:
            raise AssertionError(f"[观察物体重算不一致] {q}")
        return
    m = re.search(r"用(\d+)个小正方体横着排成一排", q)
    if m:
        if int(m.group(1)) != a:
            raise AssertionError(f"[观察物体重算不一致] {q}")
        return
    m = re.search(r"用(\d+)个小正方体竖着叠成一列", q)
    if m:
        if int(m.group(1)) != a:
            raise AssertionError(f"[观察物体重算不一致] {q}")
        return
    m = re.search(r"底层是(\d+)×(\d+)实心摆满，中层是(\d+)×(\d+)，顶层1个", q)
    if m:
        v = int(m.group(1)) * int(m.group(2)) + int(m.group(3)) * int(m.group(4)) + 1
        if v != a:
            raise AssertionError(f"[观察物体重算不一致] {q}")
        return
    m = re.search(r"从上面看是(\d+)×(\d+)的长方形阵列", q)
    if m:
        v = int(m.group(1)) * int(m.group(2))
        if v != a:
            raise AssertionError(f"[观察物体重算不一致] {q}")
        return
    m = re.search(r"横着排(\d+)个、竖列再往上叠(\d+)个", q)
    if m:
        v = int(m.group(1)) + int(m.group(2)) - 1
        if v != a:
            raise AssertionError(f"[观察物体重算不一致] {q}")
        return
    if "「田」字" in q and "最少需要几个小正方体" in q:
        if a != 4:
            raise AssertionError(f"[观察物体重算不一致] {q}")
        return
    if "「九宫格」" in q:
        if a != 9:
            raise AssertionError(f"[观察物体重算不一致] {q}")
        return
    if "最多能同时看到几个面" in q:
        if a != 3:
            raise AssertionError(f"[观察物体重算不一致] {q}")
        return

    # 4) 年月日换算
    m = re.fullmatch(r"(\d+)时=\?分", q)
    if m:
        v = int(m.group(1)) * 60
        if v != a:
            raise AssertionError(f"[年月日重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)分=\?秒", q)
    if m:
        v = int(m.group(1)) * 60
        if v != a:
            raise AssertionError(f"[年月日重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)时(\d+)分=\?分", q)
    if m:
        v = int(m.group(1)) * 60 + int(m.group(2))
        if v != a:
            raise AssertionError(f"[年月日重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)分(\d+)秒=\?秒", q)
    if m:
        v = int(m.group(1)) * 60 + int(m.group(2))
        if v != a:
            raise AssertionError(f"[年月日重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)秒=\?分", q)
    if m:
        s = int(m.group(1))
        if s % 60 or s // 60 != a:
            raise AssertionError(f"[年月日重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)分=\?时", q)
    if m:
        s = int(m.group(1))
        if s % 60 or s // 60 != a:
            raise AssertionError(f"[年月日重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)年=\?月", q)
    if m:
        v = int(m.group(1)) * 12
        if v != a:
            raise AssertionError(f"[年月日重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)日=\?时", q)
    if m:
        v = int(m.group(1)) * 24
        if v != a:
            raise AssertionError(f"[年月日重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)个星期=\?天", q)
    if m:
        v = int(m.group(1)) * 7
        if v != a:
            raise AssertionError(f"[年月日重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)天=\?个星期", q)
    if m:
        s = int(m.group(1))
        if s % 7 or s // 7 != a:
            raise AssertionError(f"[年月日重算不一致] {q}")
        return
    m = re.fullmatch(r"从(\d+):(\d+)到(\d+):(\d+)，经过了多少分钟\?", q)
    if m:
        h1, m1, h2, m2 = map(int, m.groups())
        v = (h2 * 60 + m2) - (h1 * 60 + m1)
        if v != a:
            raise AssertionError(f"[经过时间重算不一致] {q}")
        return

    # 5) 年月日事实题（白名单逐条比对）
    for fq, fa, _ in NIAN_FACTS:
        if q == fq:
            if a != fa:
                raise AssertionError(f"[事实题答案不一致] {q}")
            return

    # 6) 元角分互化
    m = re.fullmatch(r"(\d+)元(\d+)角=\?角", q)
    if m:
        v = int(m.group(1)) * 10 + int(m.group(2))
        if v != a:
            raise AssertionError(f"[元角分重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)元(\d+)角=\?分", q)
    if m:
        v = int(m.group(1)) * 100 + int(m.group(2)) * 10
        if v != a:
            raise AssertionError(f"[元角分重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)\.(\d+)元=\?角", q)
    if m:
        v = int(m.group(1)) * 10 + int(m.group(2))
        if v != a:
            raise AssertionError(f"[元角分重算不一致] {q}")
        return
    m = re.fullmatch(r"0\.(\d+)元=\?角", q)
    if m:
        if int(m.group(1)) != a:
            raise AssertionError(f"[元角分重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)元=\?角", q)
    if m:
        v = int(m.group(1)) * 10
        if v != a:
            raise AssertionError(f"[元角分重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)角=\?分", q)
    if m:
        v = int(m.group(1)) * 10
        if v != a:
            raise AssertionError(f"[元角分重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)元=\?分", q)
    if m:
        v = int(m.group(1)) * 100
        if v != a:
            raise AssertionError(f"[元角分重算不一致] {q}")
        return
    m = re.fullmatch(r"(\d+)角=\?元", q)
    if m:
        j = int(m.group(1))
        if j % 10 or j // 10 != a:
            raise AssertionError(f"[元角分重算不一致] {q}")
        return

    raise AssertionError(f"[未配置校验规则] {q!r}（unit={item.get('unit')}）——"
                         f"每个模板都必须有第二通道校验规则")


def validate(data):
    """契约硬性规则全量检查：schema / 范围 / 去重 / 每题第二通道重算。"""
    assert set(data) >= {"source", "subject", "subjectName", "banks"}, "顶层字段缺失"
    assert data["subject"] == "math", "subject 必须为 math"
    assert isinstance(data["banks"], list) and data["banks"], "banks 不能为空"
    seen = {}
    n_input = n_choice = 0
    by_unit = {}
    for bank in data["banks"]:
        kind = bank["kind"]
        assert kind in ("input", "choice"), f"未知 kind: {kind}"
        for it in bank["items"]:
            q = it["q"]
            assert it.get("unit") and it.get("hint"), f"unit/hint 缺失: {q!r}"
            assert q not in seen, f"题目重复: {q!r}"
            seen[q] = True
            by_unit[it["unit"]] = by_unit.get(it["unit"], 0) + 1
            if kind == "input":
                n_input += 1
                assert isinstance(it["a"], int) and not isinstance(it["a"], bool), \
                    f"a 必须是整数: {q!r}"
                assert 0 <= it["a"] <= 9999, f"a 越界: {q!r} -> {it['a']}"
                recheck_input(it)  # 第二通道重算
            else:
                n_choice += 1
                opts = it["options"]
                assert isinstance(opts, list) and 3 <= len(opts) <= 4, \
                    f"options 必须 3~4 个: {q!r}"
                assert len(set(opts)) == len(opts), f"options 重复: {q!r}"
                assert isinstance(it["a"], int) and 0 <= it["a"] < len(opts), \
                    f"a 下标越界: {q!r}"
    return n_input, n_choice, by_unit


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def build():
    _seen.clear()
    rng = random.Random(SEED)

    items_input = []
    items_input += items_extracted()           # extracted 最先注册：11 题原样保留（含页码 hint）
    items_input += gen_hunhe(rng, 49)          # 混合运算 49 生成 + 11 extracted = 60
    items_input += gen_guancha_input(rng, 28)  # 观察物体 28 input + 4 固定 = 32
    items_input += gen_jiajian(rng, 55)        # 加与减 55
    items_input += gen_chengchu(rng, 55)       # 乘与除 55
    items_input += gen_zhouchang(rng, 50)      # 周长 50
    items_input += gen_chengfa(rng, 55)        # 乘法 55
    items_input += gen_nianyueri(rng, 52)      # 年月日 52
    items_input += gen_xiaoshu(rng, 45)        # 认识小数 45

    items_choice = gen_guancha_choice(rng)

    return {
        "source": SOURCE,
        "subject": "math",
        "subjectName": "数学",
        "banks": [
            {
                "kind": "input",
                "note": "数字输入作答；答案 0..9999 整数",
                "items": items_input,
            },
            {
                "kind": "choice",
                "note": "观察物体概念题，三选一/四选一",
                "items": items_choice,
            },
        ],
    }


def main():
    if "--check" in sys.argv:
        data = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        n_input, n_choice, by_unit = validate(data)
        print(f"✔ 校验通过（--check，未改写文件）: input {n_input} + choice {n_choice} "
              f"= {n_input + n_choice} 题")
        for u in sorted(by_unit):
            print(f"  {u}: {by_unit[u]}")
        return

    data = build()
    n_input, n_choice, by_unit = validate(data)  # 写盘前全量自查

    total_target = 400
    total = n_input + n_choice
    assert total >= total_target, f"总题数 {total} 未达目标 {total_target}"
    small = [u for u, c in by_unit.items() if c < 30]
    assert not small, f"以下单元不足 30 题: {small}"

    OUT_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"✔ 已写入 {OUT_PATH.relative_to(ROOT)}")
    print(f"  总题数: {total}（input {n_input} + choice {n_choice}）")
    for u in sorted(by_unit):
        print(f"  {u}: {by_unit[u]}")
    print("  全部题目已过第二通道重算校验 ✔")


if __name__ == "__main__":
    main()
