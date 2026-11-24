#!/usr/bin/env python3
r"""Approval Desk · 代号表生成器 (v2, 2026-11-17)

从项目的 Markdown 登记文件里收集"代号 → 含义"，输出 codes.js（const CODES = {...};）。
审批台页面里出现的每个代号都靠它显示悬浮解释，并列入"代号索引"附录。

用法：
  python3 build_codes.py --out codes.js [--shapes code_shapes.json] FILE.md [FILE.md ...]

识别规则（与具体项目无关）：
  1. 表格行：第一列是代号（如 D-009、F-001、S-08、Q-16、A-01、INV-04、M5、R3、T01、R01），
     第二列作为标题，其余列拼成说明。
  2. 粗体标题：**FR-TASK-04 预测完成日** → 代号 FR-TASK-04，标题为其后文字。
  3. 列表项：- N1 不采集…… → 代号 N1。
  4. 审批反馈标题：### R03-07 标题〔…〕 → 代号 R03-07。
同一代号出现多次时，保留先出现的（把权威文件放在前面）。
页面本地的代号（只在某张表里定义的 P1、X3 等）请在每轮数据里用 Object.assign(CODES, {...}) 补充。

代号形状（什么样的字符串算代号）：默认是 DEFAULT_SHAPES 里的四种。项目有别的形状（例如 GATE-01、DEC-1、ADR-0001）时，
用 --shapes 指定一个 JSON 文件。下面就是文件内容本身（JSON 里的反斜杠要写两个）：
  {"patterns": ["GATE-\\d{2}", "DEC-\\d+", "ADR-\\d{4}"],
   "kinds": [["^GATE-\\d{2}$", "关口"], ["^ADR-\\d{4}$", "架构决定"]],
   "only": false}
  - patterns：追加的形状，正则源码，不带 ^ 和 $。页面上的 JavaScript 也要用它，所以只写两边通用的写法：
    可以用 \d、[A-Z]、{2,3}、(?:…)；不要用 (?P<…>)、(?#…)、(?i) 这类内联标志、\A、\Z；形状不能匹配空串。
  - kinds：可选，追加的类别名 [正则, 类别名]，排在默认类别前面。
  - only：可选，true 表示只用 patterns，不要默认形状。
  --shapes 只扩大"什么样的字符串算代号"；能识别的仍只有上面四种行格式。用了 --shapes 时，codes.js 末尾还会写
  const CODE_SHAPES = [...]，页面的代号链接器按同一套形状找出"像代号却没有解释"的字符串；不用 --shapes 时不写这一行，
  输出与 v1 完全相同（有的项目脚本按 v1 的格式解析 codes.js），页面用默认形状。
"""
import argparse, json, os, re

DEFAULT_SHAPES = [r"[A-Z]{1,3}-[A-Z]+-\d{2}", r"[A-Z]{1,3}-\d{2,3}", r"R\d{2}-\d{2}", r"[A-Z]{1,2}\d{1,2}"]  # 与 assets/code-linker.js 的 AD_DEFAULT_SHAPES 保持一致
HEAD = re.compile(r"^###\s+(?P<code>R\d{2}-\d{2})\s+(?P<rest>.+?)(?:〔.*)?$")
PY_ONLY = re.compile(r"\(\?P|\(\?#|\(\?[aiLmsux]+[-:)]|\\A|\\Z")  # JavaScript 不认的写法

KINDS = [  # (正则, 类别名)：按顺序匹配第一个
    (r"^D-\d{3}$", "已批准决定"), (r"^F-\d{3}$", "来源事实"), (r"^S-\d{2}$", "调研来源"),
    (r"^Q-\d{2}$", "待决事项"), (r"^A-\d{2}$", "假设"), (r"^INV-\d{2}$", "不变量"),
    (r"^FR-[A-Z]+-\d{2}$", "功能需求"), (r"^NFR-\d{2}$", "非功能需求"), (r"^R\d{2}-\d{2}$", "审批条目"),
    (r"^R\d{2}$", "审批轮"), (r"^T\d{2}$", "对话轮次"), (r"^M\d$", "成功指标"), (r"^R\d$", "风险信号"),
    (r"^N\d$", "不做清单"),
]


def kind(code, kinds):
    for rx, name in kinds:
        if re.match(rx, code): return name
    return ""


def clean(t, n=180):
    t = re.sub(r"`|\*\*|\[推断[^\]]*\]", "", t).strip()
    t = re.sub(r"\s+", " ", t)
    return t if len(t) <= n else t[: n - 1] + "…"


def load_shapes(path):
    """返回 (形状列表, 类别列表, 追加的形状)。没有 --shapes 时就是默认值。"""
    if not path: return DEFAULT_SHAPES[:], KINDS[:], []
    try:
        with open(path, encoding="utf-8") as f: cfg = json.load(f)
    except (OSError, ValueError) as e:
        raise SystemExit(f"--shapes：读不了 {path}（{e}）")
    if not isinstance(cfg, dict): raise SystemExit("--shapes：文件内容应是一个 JSON 对象")
    extra = cfg.get("patterns", [])
    if not isinstance(extra, list) or not all(isinstance(p, str) and p for p in extra):
        raise SystemExit("--shapes：patterns 应是非空字符串的数组")
    for p in extra:
        if PY_ONLY.search(p): raise SystemExit(f"--shapes：{p} 用了 JavaScript 不认的写法（(?P…)、(?#…)、内联标志、\\A、\\Z）")
        try: rx = re.compile(p)
        except re.error as e: raise SystemExit(f"--shapes：{p} 不是合法的正则（{e}）")
        if rx.fullmatch(""): raise SystemExit(f"--shapes：{p} 能匹配空串")
    kinds_in = cfg.get("kinds", [])
    if not isinstance(kinds_in, list) or not all(isinstance(k, list) and len(k) == 2 and all(isinstance(x, str) for x in k) for k in kinds_in):
        raise SystemExit("--shapes：kinds 应是 [正则, 类别名] 的数组")
    for k in kinds_in:
        try: re.compile(k[0])
        except re.error as e: raise SystemExit(f"--shapes：kinds 里的 {k[0]} 不是合法的正则（{e}）")
    shapes = extra + ([] if cfg.get("only") else DEFAULT_SHAPES)
    if not shapes: raise SystemExit("--shapes：only 为 true 时 patterns 不能为空")
    return shapes, [(k[0], k[1]) for k in kinds_in] + KINDS, extra


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--shapes")
    ap.add_argument("files", nargs="+")
    a = ap.parse_args(); codes = {}
    shapes, kinds, extra = load_shapes(a.shapes)
    code = "(?:" + "|".join(shapes) + ")"
    # 用命名分组读代号和其余部分：--shapes 里的形状即使带分组也不会打乱编号
    row = re.compile(r"^\|\s*(?P<code>" + code + r")\s*\|(?P<rest>.+)\|\s*$")
    bold = re.compile(r"^\*\*(?P<code>" + code + r")\s+(?P<rest>[^*]+)\*\*")
    lst = re.compile(r"^-\s+(?P<code>" + code + r")\s+(?P<rest>.+)$")
    for f in a.files:
        src = os.path.basename(f)
        for line in open(f, encoding="utf-8"):
            line = line.rstrip("\n"); m = row.match(line)
            if m:
                cells = [c.strip() for c in m.group("rest").split("|")]
                first = cells[0] if cells else ""
                title = clean(first, 40)
                rest = cells if len(clean(first, 999)) > 40 else cells[1:]
                desc = clean(" · ".join(c for c in rest if c and c != "—"), 220)
                codes.setdefault(m.group("code"), [title, desc, " · ".join(x for x in (kind(m.group("code"), kinds), src) if x)]); continue
            for rx in (bold, lst, HEAD):
                m = rx.match(line)
                if m: codes.setdefault(m.group("code"), [clean(m.group("rest"), 60), "", " · ".join(x for x in (kind(m.group("code"), kinds), src) if x)]); break
    with open(a.out, "w", encoding="utf-8") as o:
        o.write("/* 由 build_codes.py 生成，勿手改 */\nconst CODES = " + json.dumps(codes, ensure_ascii=False, indent=0) + ";\n")
        # 只有用了 --shapes 才写 CODE_SHAPES：不用时输出与 v1 相同（有的项目脚本按 v1 的格式解析 codes.js）
        if a.shapes: o.write("const CODE_SHAPES = " + json.dumps(shapes, ensure_ascii=False) + ";\n")
    print(f"{len(codes)} codes -> {a.out}")
    for p in extra:  # 追加的形状各收进了几个代号；0 个多半是写错了
        n = sum(1 for c in codes if re.fullmatch(p, c))
        print(f"  --shapes {p}：{n} 个代号" + ("（一个也没有，检查一下写法）" if n == 0 else ""))


if __name__ == "__main__":
    main()
