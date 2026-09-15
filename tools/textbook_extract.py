#!/usr/bin/env python3
"""
textbook_extract.py — 从教材 PDF 提取题目/字词，生成游戏题库 JSON（M1：数学·三年级上册）。

用法：
    python3 tools/textbook_extract.py                 # 默认提取数学三上第一单元
    python3 tools/textbook_extract.py --book <目录名>  # 指定 ~/.dsh/smartedu-books/ 下某本

输出：assets/edu/grade3-math.json
结构：{ source, unit, topics: [...], generated: [ {q, a} ... ], extracted: [ {q, a, hint} ... ] }
- generated：按单元知识点程序化生成的口算/混合运算题（答案 0..99，适配答题机两位输入）
- extracted：从 PDF 文本中启发式抽出的例题（人工校对前的 demo 用，标注 hint 来源页码）
"""
import argparse
import json
import random
import re
import sys
from pathlib import Path

BOOKS_DIR = Path.home() / ".dsh/smartedu-books"
OUT = Path(__file__).resolve().parent.parent / "assets" / "edu" / "grade3-math.json"


def find_book(name_pat: str) -> Path:
    for d in sorted(BOOKS_DIR.iterdir()):
        if d.is_dir() and name_pat in d.name:
            pdfs = list(d.glob("*.pdf"))
            if pdfs:
                return pdfs[0]
    raise SystemExit(f"找不到包含「{name_pat}」的书")


def extract_pdf_text(pdf: Path, first: int, last: int):
    import fitz
    doc = fitz.open(pdf)
    pages = []
    for i in range(first, min(last, len(doc))):
        pages.append((i, doc[i].get_text()))
    return pages


# 混合运算单元的算式模式：a×b＋c / a－b×c / a÷b＋c / (a＋b)×c 等
EXPR_RE = re.compile(
    r"(\d{1,3})\s*[×x*]\s*(\d{1,2})\s*[＋+]\s*(\d{1,3})"
    r"|(\d{1,3})\s*[－-]\s*(\d{1,2})\s*[×x*]\s*(\d{1,2})"
    r"|(\d{1,3})\s*[÷/]\s*(\d{1,2})\s*[＋+]\s*(\d{1,3})"
    r"|\((\d{1,3})\s*[＋+]\s*(\d{1,2})\)\s*[×x*]\s*(\d{1,2})"
)


def normalize(s: str) -> str:
    return (s.replace("×", "×").replace("＋", "+").replace("－", "−")
             .replace("÷", "÷"))


def extract_questions(pages):
    """启发式抽取：含混合运算算式且带问号的行 → 例题。demo 级别，M2 再人工校对。"""
    out = []
    for pageno, text in pages:
        for line in text.splitlines():
            line = line.strip()
            m = EXPR_RE.search(line)
            if not m:
                continue
            g = [x for x in m.groups() if x is not None]
            try:
                if m.group(1):  # a×b+c
                    a, b, c = map(int, g[:3])
                    q, ans = f"{a}×{b}+{c}", a * b + c
                elif m.group(4):  # a-b×c
                    a, b, c = map(int, g[:3])
                    q, ans = f"{a}−{b}×{c}", a - b * c
                elif m.group(7):  # a÷b+c
                    a, b, c = map(int, g[:3])
                    if b == 0 or a % b:
                        continue
                    q, ans = f"{a}÷{b}+{c}", a // b + c
                else:  # (a+b)×c
                    a, b, c = map(int, g[:3])
                    q, ans = f"({a}+{b})×{c}", (a + b) * c
            except Exception:
                continue
            if 0 <= ans <= 99:
                out.append({"q": normalize(q), "a": ans, "hint": f"课本第{pageno - 3}页（PDF p{pageno + 1}）"})
    # 去重
    seen, uniq = set(), []
    for it in out:
        if it["q"] not in seen:
            seen.add(it["q"])
            uniq.append(it)
    return uniq


def gen_questions(n=120, seed=20260907):
    """按第一单元知识点生成：乘加/减乘/除加/带括号乘/纯乘除口算。答案限 0..99。"""
    rng = random.Random(seed)
    out = []
    while len(out) < n:
        kind = rng.randrange(5)
        if kind == 0:
            a, b, c = rng.randrange(2, 10), rng.randrange(2, 10), rng.randrange(2, 20)
            q, a_ans = f"{a}×{b}+{c}", a * b + c
        elif kind == 1:
            a, b, c = rng.randrange(20, 80), rng.randrange(2, 9), rng.randrange(2, 9)
            q, a_ans = f"{a}−{b}×{c}", a - b * c
        elif kind == 2:
            b = rng.randrange(2, 10)
            a = b * rng.randrange(2, 10)
            c = rng.randrange(2, 20)
            q, a_ans = f"{a}÷{b}+{c}", a // b + c
        elif kind == 3:
            a, b, c = rng.randrange(2, 20), rng.randrange(2, 20), rng.randrange(2, 8)
            q, a_ans = f"({a}+{b})×{c}", (a + b) * c
        else:
            a, b = rng.randrange(2, 10), rng.randrange(2, 10)
            q, a_ans = f"{a}×{b}", a * b
        if 0 <= a_ans <= 99:
            out.append({"q": normalize(q), "a": a_ans})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", default="数学三年级上册")
    ap.add_argument("--pages", default="5:17", help="PDF 页区间（0 起，含头不含尾），第一单元")
    ap.add_argument("--count", type=int, default=120)
    args = ap.parse_args()

    pdf = find_book(args.book)
    f, l = map(int, args.pages.split(":"))
    pages = extract_pdf_text(pdf, f, l)
    extracted = extract_questions(pages)
    generated = gen_questions(args.count)

    data = {
        "source": f"北师大版数学三年级上册·第一单元「混合运算」（{pdf.parent.name}）",
        "unit": "一上·混合运算",
        "topics": ["乘加混合", "减乘混合", "除加混合", "带小括号", "表内乘除口算"],
        "note": "extracted 为 PDF 启发式抽题（demo 级，M2 人工校对）；generated 为同知识点程序化生成",
        "generated": generated,
        "extracted": extracted,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✅ {OUT}")
    print(f"   generated={len(generated)} extracted={len(extracted)}")
    for it in extracted[:8]:
        print("  例:", it["q"], "=", it["a"], "|", it["hint"])


if __name__ == "__main__":
    main()
