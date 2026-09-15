#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""题库契约校验器（quiz-engine 提供，内容方交付前必跑，见 docs/edu-quiz-banks-contract.md）。

校验内容（契约 §2 统一 schema 硬性规则）：
  - JSON 可解析、UTF-8 无 BOM（§7.3）
  - subject 与文件名对应（grade3-<subject>.json ↔ 文件内 subject 字段）
  - kind 只能是 input | choice
  - input 题：a 为 0..9999 的整数（答题机数字输入上限 4 位）
  - choice 题：options 为 3~4 个互异字符串，a 为正确项下标（0-based）且在界内
  - 每题 unit / hint 非空
  - banks.json 清单与题库文件一致性：学科 key 对拍 / 缺文件警告 / 未收录文件警告

用法（兼容 Python 3.8+，不使用 3.12 的 f-string 嵌套同款引号语法）：
  python3 tools/validate_banks.py                       # 默认扫 <root>/assets/edu/grade3-*.json
  python3 tools/validate_banks.py f1.json f2.json       # 显式指定题库文件（清单校验照常进行）
  python3 tools/validate_banks.py --root /some/repo     # 指定项目根目录（默认取脚本上两级）

范围口径（固定不变）：grade3-english.json（契约 §5，words/sentences 自包含结构）与
grade3-hanzi.json（契约 §3，chars 识字表）**不适用 §2 题库 schema**——无论默认扫描还是
显式传入一律跳过并注明，绝不计入违规（由 english-bank / chinese-bank 各自负责）。

旧格式兼容（契约 §2.1 迁移期）：顶层 extracted/generated 的旧数学格式按宽松规则校验
（只查 q 与 a∈0..9999），输出迁移提醒，不算违规；新格式一律按 §2 严格校验。

退出码：存在违规（❌）→ exit 1；只有警告（⚠️）或全部通过 → exit 0。
题库文件缺失 / 未被清单收录只是 ⚠️ 警告不判负——引擎对该学科走内置兜底题，不阻塞玩法。
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent.parent  # 默认项目根（tools/ 的上一级）
SKIP_FILES = ('grade3-english.json', 'grade3-hanzi.json')  # 契约 §3/§5 独立 schema，固定跳过
VALID_KINDS = ('input', 'choice')


def is_int(v):
    """严格整数判断（Python 的 bool 是 int 子类，必须排除）。"""
    return isinstance(v, int) and not isinstance(v, bool)


def item_errors(kind, item, where):
    """单题校验（契约 §2 硬性规则），返回违规列表。"""
    errs = []
    if not isinstance(item, dict):
        return [f'{where}: 题目必须是对象，实际为 {type(item).__name__}']
    # 题面
    q = item.get('q')
    if not (isinstance(q, str) and q.strip()):
        errs.append(f'{where}: q 必须是非空字符串')
    # unit / hint 必填非空（契约 §2：每题必填）
    for key in ('unit', 'hint'):
        v = item.get(key)
        if not (isinstance(v, str) and v.strip()):
            errs.append(f'{where}: {key} 必须是非空字符串（契约 §2：每题必填）')
    # 答案 a
    a = item.get('a')
    if not is_int(a):
        errs.append(f'{where}: a 必须是整数，实际为 {a!r}')
    elif kind == 'input' and not (0 <= a <= 9999):
        errs.append(f'{where}: input 题 a 超出 0..9999（契约 §2）：{a}')
    # choice 专属：options 3~4 个互异字符串 + a 下标在界内
    if kind == 'choice':
        opts = item.get('options')
        if not (isinstance(opts, list) and 3 <= len(opts) <= 4):
            n = len(opts) if isinstance(opts, list) else type(opts).__name__
            errs.append(f'{where}: options 必须是 3~4 个的数组，实际 {n}')
        else:
            bad = [o for o in opts if not (isinstance(o, str) and o.strip())]
            if bad:
                errs.append(f'{where}: options 每项必须是非空字符串，异常项：{bad!r}')
            if len(set(map(str, opts))) != len(opts):
                errs.append(f'{where}: options 存在重复项（契约 §2：互不相同）：{opts!r}')
            if is_int(a) and not (0 <= a < len(opts)):
                errs.append(f'{where}: choice 题 a 下标越界：{a}（options 共 {len(opts)} 项）')
    return errs


def legacy_errors(items, path_name):
    """旧数学格式（extracted/generated）宽松校验：q 非空字符串 + a 可强转 0..9999 整数。"""
    errs = []
    for i, it in enumerate(items):
        where = f'{path_name} 旧格式题[{i}]'
        if not isinstance(it, dict):
            errs.append(f'{where}: 题目必须是对象')
            continue
        q = it.get('q')
        if not (isinstance(q, str) and q.strip()):
            errs.append(f'{where}: q 必须是非空字符串')
        a = it.get('a')
        try:
            ai = int(a)
        except (TypeError, ValueError):
            ai = None
        if ai is None or not (0 <= ai <= 9999):
            errs.append(f'{where}: a 必须能强转为 0..9999 的整数，实际 {a!r}')
    return errs


def validate_bank_file(path):
    """校验单个题库文件。返回 dict：errors / warnings / stats / subject / legacy。"""
    errors, warnings = [], []
    stats = defaultdict(lambda: defaultdict(int))  # kind -> unit -> 题数
    name = path.name

    raw = path.read_bytes()
    if raw.startswith(b'\xef\xbb\xbf'):
        errors.append('文件带 UTF-8 BOM（契约 §7.3：UTF-8 无 BOM）')
    try:
        data = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, ValueError) as e:
        errors.append(f'JSON 解析失败：{e}')
        return {'errors': errors, 'warnings': warnings,
                'stats': {}, 'subject': None, 'legacy': False}

    if not isinstance(data, dict):
        errors.append('顶层必须是 JSON 对象')
        return {'errors': errors, 'warnings': warnings,
                'stats': {}, 'subject': None, 'legacy': False}

    # 旧格式识别：顶层 extracted/generated 且无新格式 banks 数组（契约 §2.1 迁移期兼容）
    legacy = 'banks' not in data and ('extracted' in data or 'generated' in data)

    # subject 与文件名对应（旧格式可能无 subject 字段 → 按文件名推断并提醒）
    stem = path.stem
    fname_subject = stem[len('grade3-'):] if stem.startswith('grade3-') else stem
    subject = data.get('subject')
    if legacy:
        if not (isinstance(subject, str) and subject):
            warnings.append('旧格式无 subject 字段，按文件名推断为 '
                            f'「{fname_subject}」；迁移到 §2 格式后 subject 必填且须与文件名一致')
        subject = subject if isinstance(subject, str) and subject else fname_subject
        warnings.append('旧格式（顶层 extracted/generated）：契约 §2.1 迁移期兼容，'
                        '请尽快迁移为 §2 统一格式（subject/banks/kind/unit/hint）')
    else:
        if subject != fname_subject:
            errors.append(f'subject（{subject!r}）与文件名（grade3-{fname_subject}.json）不一致（契约 §2）')
        if not isinstance(data.get('subjectName'), str):
            warnings.append('缺少 subjectName 字段（契约 §2 schema 建议提供，供展示用）')
    if not isinstance(data.get('source'), str):
        warnings.append('缺少 source 字段（教材版本+页码，供家长/老师核对，建议提供）')

    total = 0
    if legacy:
        items = list(data.get('extracted') or []) + list(data.get('generated') or [])
        errors.extend(legacy_errors(items, name))
        unit = data.get('unit') if isinstance(data.get('unit'), str) and data.get('unit') else '未知单元'
        stats['input'][unit] = sum(
            1 for it in items if isinstance(it, dict) and isinstance(it.get('q'), str))
        total = stats['input'][unit]
    else:
        banks = data.get('banks')
        if not (isinstance(banks, list) and banks):
            errors.append('缺少非空 banks 数组（契约 §2：每个文件至少提供一个 banks 条目）')
        else:
            for bi, bank in enumerate(banks):
                where = f'{name} banks[{bi}]'
                if not isinstance(bank, dict):
                    errors.append(f'{where}: 必须是对象')
                    continue
                kind = bank.get('kind')
                if kind not in VALID_KINDS:
                    errors.append(f'{where}: kind 非法（{kind!r}），只能是 input | choice')
                    continue
                items = bank.get('items')
                if not (isinstance(items, list) and items):
                    errors.append(f'{where}（{kind}）: items 必须是非空数组')
                    continue
                for ii, item in enumerate(items):
                    errors.extend(item_errors(kind, item, f'{where}.items[{ii}]'))
                    if isinstance(item, dict):
                        unit = item.get('unit')
                        unit = unit if isinstance(unit, str) and unit else '?'
                        stats[kind][unit] += 1
                        total += 1
    return {'errors': errors, 'warnings': warnings, 'stats': dict(stats),
            'subject': subject, 'legacy': legacy}


def validate_manifest(root, edu_dir, manifest_path, results):
    """校验 banks.json 清单与题库文件一致性。返回 (errors, warnings, summary_lines)。"""
    errors, warnings, lines = [], [], []
    if not manifest_path.exists():
        try:
            rel = manifest_path.relative_to(root)
        except ValueError:
            rel = manifest_path
        errors.append(f'缺少清单 {rel}（引擎会回退代码内默认清单，但请随引擎交付）')
        return errors, warnings, lines
    try:
        data = json.loads(manifest_path.read_bytes().decode('utf-8'))
    except (UnicodeDecodeError, ValueError) as e:
        errors.append(f'banks.json 解析失败：{e}')
        return errors, warnings, lines
    banks = data.get('banks') if isinstance(data, dict) else None
    if not (isinstance(banks, list) and banks):
        errors.append('banks.json 缺少非空 banks 数组（契约 §1）')
        return errors, warnings, lines

    seen = set()
    for i, entry in enumerate(banks):
        where = f'banks.json banks[{i}]'
        if not isinstance(entry, dict):
            errors.append(f'{where}: 必须是对象')
            continue
        subject = entry.get('subject')
        fname = entry.get('file')
        weight = entry.get('weight')
        if not (isinstance(subject, str) and subject):
            errors.append(f'{where}: subject 必须是非空字符串（稳定 key，进度记账用）')
            continue
        if subject in seen:
            errors.append(f'{where}: subject「{subject}」重复（契约 §1 清单每学科一条）')
        seen.add(subject)
        if not (isinstance(fname, str) and fname):
            errors.append(f'{where}（{subject}）: file 必须是非空字符串（相对 assets/edu/）')
            continue
        expect = f'grade3-{subject}.json'
        if fname != expect:
            warnings.append(f'{where}（{subject}）: file 为 {fname}，契约惯例是 {expect}')
        if not is_int(weight) or weight <= 0:
            errors.append(f'{where}（{subject}）: weight 必须是正整数（抽题加权用），实际 {weight!r}')
        for key in ('emoji', 'name'):
            if not (isinstance(entry.get(key), str) and entry.get(key)):
                warnings.append(f'{where}（{subject}）: 缺少 {key} 字段（卡片徽标/展示用）')
        fpath = edu_dir / fname
        if not fpath.exists():
            warnings.append(f'{where}（{subject}）: 题库文件 {fname} 尚不存在，'
                            '引擎对该学科走内置兜底题（可稍后交付）')
            continue
        res = results.get(fpath.resolve())
        file_subject = res['subject'] if res else None
        if file_subject is not None and file_subject != subject:
            errors.append(f'{where}（{subject}）: 文件 {fname} 内 subject 为「{file_subject}」，'
                          '与清单不一致（契约 §2：须与 banks.json 一致）')

    # 反向：已扫描的题库文件未被清单收录 → 引擎不会加载
    for path, res in results.items():
        if path == manifest_path or res.get('subject') is None:
            continue
        subj = res['subject']
        if subj not in seen:
            warnings.append(f'{path.name}: subject「{subj}」未收录进 banks.json，'
                            '引擎不会加载该文件（清单为加载的唯一来源）')
    # 汇总行（提前取值再插值，兼容 3.10/3.11：f-string 内不嵌套同款引号）
    parts = []
    for e in banks:
        if isinstance(e, dict) and isinstance(e.get('subject'), str):
            parts.append(f"{e.get('subject')}(×{e.get('weight')})")
        else:
            parts.append('?')
    lines.append('清单学科：' + '、'.join(parts))
    return errors, warnings, lines


def fmt_stats(stats):
    """把 {kind -> {unit -> n}} 排版成一行统计文本。"""
    parts = []
    for kind in VALID_KINDS:
        units = stats.get(kind) or {}
        if not units:
            continue
        n = sum(units.values())
        detail = '、'.join(f'{u} {c}' for u, c in sorted(units.items()))
        parts.append(f'{kind} {n} 题（{detail}）')
    return '；'.join(parts) if parts else '无有效题'


def parse_args(argv):
    """极简参数解析：--root <dir> / --root=<dir> 与位置参数（题库文件）混排。"""
    root = SCRIPT_ROOT
    files = []
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == '--root':
            i += 1
            if i < len(argv):
                root = Path(argv[i])
        elif a.startswith('--root='):
            root = Path(a.split('=', 1)[1])
        else:
            files.append(a)
        i += 1
    return root, files


def main(argv):
    root, file_args = parse_args(argv)
    edu_dir = root / 'assets' / 'edu'
    manifest_path = edu_dir / 'banks.json'

    # 待校验文件：无位置参数 = 默认扫 assets/edu/grade3-*.json；
    # english/hanzi 无论来源一律跳过（契约 §3/§5 独立 schema，不在本题库校验范围）
    if file_args:
        paths = []
        for arg in file_args:
            p = Path(arg)
            if not p.is_absolute() and not p.exists():
                p = root / arg
            if p.name in SKIP_FILES:
                print(f'— 跳过 {p.name}（单词表/识字表，schema 见契约 §3/§5，不在本题库校验范围）')
                continue
            paths.append(p)
    else:
        paths = []
        for p in sorted(edu_dir.glob('grade3-*.json')):
            if p.name in SKIP_FILES:
                print(f'— 跳过 {p.name}（单词表/识字表，schema 见契约 §3/§5，不在本题库校验范围）')
                continue
            paths.append(p)

    results = {}
    total_violations = 0
    total_warnings = 0
    total_items = 0
    print(f'—— 题库文件校验（{len(paths)} 个）——')
    for path in paths:
        if not path.exists():
            print(f'❌ {path}: 文件不存在')
            total_violations += 1
            continue
        res = validate_bank_file(path)
        results[path.resolve()] = res
        n_err, n_warn = len(res['errors']), len(res['warnings'])
        total_violations += n_err
        total_warnings += n_warn
        items = sum(sum(u.values()) for u in res['stats'].values())
        total_items += items
        tag = '✅' if n_err == 0 else '❌'
        extra = f' / ⚠️ {n_warn}' if n_warn else ''
        print(f'{tag} {path.name}：{items} 题{extra}')
        line = fmt_stats(res['stats'])
        if line != '无有效题':
            print(f'   统计：{line}')
        for e in res['errors']:
            print(f'   [违规] {e}')
        for w in res['warnings']:
            print(f'   [提醒] {w}')

    print('—— banks.json 清单一致性 ——')
    m_errors, m_warnings, m_lines = validate_manifest(root, edu_dir, manifest_path, results)
    total_violations += len(m_errors)
    total_warnings += len(m_warnings)
    for line in m_lines:
        print(f'   {line}')
    for e in m_errors:
        print(f'   [违规] {e}')
    for w in m_warnings:
        print(f'   [提醒] {w}')
    if not m_errors and not m_warnings:
        print('✅ 清单一致')

    print(f'—— 汇总：{total_items} 题 · 违规 {total_violations} · 提醒 {total_warnings} ——')
    if total_violations:
        print('❌ 存在违规，请修复后重跑（契约 docs/edu-quiz-banks-contract.md）')
        return 1
    print('✅ 校验通过')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
