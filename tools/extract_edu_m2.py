#!/usr/bin/env python3
"""extract_edu_m2.py — M2 题库提取：英语单词表（沪教版三上）+ 语文识字表（统编版三上）。
输出 assets/edu/grade3-english.json 与 assets/edu/grade3-hanzi.json。

⚠️ 重跑会整文件覆盖这两份 JSON（2026-09-11 起它们含人工清洗/扩充内容）：
   - grade3-english.json 已修 15 条脏数据 + 去重 + 新增 sentences 50 句（契约 §5），
     重跑会全部回退到原始提取结果；
   - grade3-hanzi.json 已升级为 {ch,pinyin,word} 结构（契约 §3），重跑会退回裸字符串表。
   如需重新提取，请先备份并做 diff 合并，不要直接覆盖。
"""
import json
import re
from pathlib import Path

import fitz

BOOKS = Path.home() / ".dsh/smartedu-books"
OUT = Path(__file__).resolve().parent.parent / "assets" / "edu"

WORD_PAIR = re.compile(r'^\*?([A-Za-z][A-Za-z\' ()]+?)\s+([^\s*][^*]*)$')


def find_pdf(pat: str) -> Path:
    for d in sorted(BOOKS.iterdir()):
        if d.is_dir() and pat in d.name:
            pdfs = [p for p in d.glob("*.pdf")]
            if pdfs:
                return pdfs[0]
    raise SystemExit(f"找不到 {pat}")


def extract_english():
    pdf = find_pdf("英语")
    doc = fitz.open(pdf)
    words = []  # {unit, en, zh}
    unit = 0
    for i in range(94, 97):  # Word list 正文页（p93 是自评页，跳过）
        for raw in doc[i].get_text().splitlines():
            line = raw.strip()
            m = re.match(r'Unit\s+(\d+)', line)
            if m:
                unit = int(m.group(1))
                continue
            if not unit or '上海教育' in line or line.startswith('注：') or line == 'Word list':
                continue
            pm = WORD_PAIR.match(line)
            if pm:
                en = pm.group(1).strip()
                zh = pm.group(2).strip()
                # 中文侧必须是汉字释义（排除跨行续句/页码），英文侧至少 2 个字母
                has_cjk = any('\u4e00' <= c <= '\u9fff' for c in zh)
                if has_cjk and len(re.findall(r'[A-Za-z]', en)) >= 2 and 'p.' not in zh and len(en) < 40:
                    words.append({"unit": unit, "en": en, "zh": zh})
    # 去重（按 en 小写）
    seen, uniq = set(), []
    for w in words:
        k = w["en"].lower()
        if k not in seen:
            seen.add(k)
            uniq.append(w)
    return uniq


def extract_hanzi():
    pdf = find_pdf("语文")
    doc = fitz.open(pdf)
    chars = []
    for i in range(113, 116):  # 识字表页
        for line in doc[i].get_text().splitlines():
            # PDF 版式为「单字独占一行，拼音另一行」：只收长度 1 的整行汉字
            line = line.strip().replace('\t', '')
            if len(line) == 1 and '\u4e00' <= line <= '\u9fff' and line not in chars:
                chars.append(line)
    return chars


def main():
    words = extract_english()
    hanzi = extract_hanzi()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "grade3-english.json").write_text(json.dumps({
        "source": "沪教版（上教社）英语三年级上册·Word list（p94-96 提取）",
        "words": words,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "grade3-hanzi.json").write_text(json.dumps({
        "source": "统编版语文三年级上册·识字表（p113-115 提取，共 250 字）",
        "chars": hanzi,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✅ english words={len(words)}  hanzi={len(hanzi)}")
    print("样例:", words[:3], hanzi[:10])


if __name__ == "__main__":
    main()
