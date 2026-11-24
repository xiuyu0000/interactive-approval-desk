#!/usr/bin/env python3
"""审批台 · 构建一轮（interactive-approval-desk v3.7）

用法（cfg 里的相对路径都相对 cfg 文件所在的文件夹，输出也写在那里）：
  python3 <skill>/round_template/build.py cfg_rXX.json

输出：
  {ROUND}_{TOPIC}_proposal.html   完整的 HTML 文档：本地副本，双击即可打开
  {ROUND}_{TOPIC}_artifact.html   同一页面去掉 doctype/html/head/body：用 Artifact 工具发布的是这个

模板 page.src.html、代号链接器 assets/code-linker.js、导出模块 assets/export-module.js 默认取自本 skill，
不需要复制到项目里；cfg 的 template / linker / export 可以改用别的文件。cfg 字段的完整说明见 round_template/README.md。
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
RUNTIME_KEYS = ["PROJECT", "REVIEW_DIR", "REVIEW_PATH_HINT", "TP", "TF", "AGENDA_TITLE", "TCOND_TITLE", "LEGEND_CHIPS", "PAGE_TEXT", "BUDGET", "ROUTE"]
BUILD_KEYS = ["ROUND", "TOPIC", "data", "codes", "PAGE_TITLE", "HEADER", "INTRO", "LEAD", "CSS_FILE", "CSS",
              "template", "linker", "export", "out_proposal", "out_artifact"]
DEFAULT_REVIEW_DIR = "interview/reviews"  # skill 的约定位置；项目不同就在 cfg 里写 REVIEW_DIR


def fail(msg):
    sys.exit("build.py：" + msg)


def note(msg):
    print("提示：" + msg, file=sys.stderr)


def read(path):
    try:
        with open(path, encoding="utf-8") as f: return f.read()
    except OSError as e: fail(f"读不到 {path}（{e.strerror}）")


def literal(data, name):
    """数据里 name = "…" 这样的字面值；没有或不是简单字面值时返回 None。"""
    m = re.search(r"\b" + name + r"\s*=\s*([\"'`])([^\"'`\n$]*)\1\s*(?=[,;\n])", data)
    return m.group(2) if m else None


def main():
    if len(sys.argv) != 2: sys.exit(__doc__)
    cfg_path = os.path.abspath(sys.argv[1]); base = os.path.dirname(cfg_path)
    try:
        cfg = json.loads(read(cfg_path))
    except ValueError as e: fail(f"{cfg_path} 不是合法的 JSON：{e}")
    at = lambda p: p if os.path.isabs(p) else os.path.join(base, p)
    for k in ("ROUND", "TOPIC", "data"):
        if not cfg.get(k): fail(f"cfg 缺少必填字段 {k}")
    if not cfg.get("PROJECT"):
        fail("cfg 缺少必填字段 PROJECT：项目标识（字母、数字、_、-，例如 weekly_report_demo）。它加在浏览器存储键前面，"
             "本地打开的不同项目的页面才不会互相串答案")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,24}", str(cfg["PROJECT"])):
        fail(f"cfg 的 PROJECT（{cfg['PROJECT']}）只能用字母、数字、_、-，最长 24 个字符")
    rnd, topic = str(cfg["ROUND"]), str(cfg["TOPIC"])
    if re.search(r"[\\/]", rnd + topic): fail("ROUND 和 TOPIC 会用在文件名里，不能含 / 或 \\")
    if not re.fullmatch(r"[A-Za-z0-9_.~:@+-]{1,200}", rnd) or rnd in (".", ".."):
        fail(f"ROUND（{rnd}）会用在数据库路径 feedback/{{ROUND}}、drafts/{{ROUND}} 里，只能用字母、数字和 _ . ~ : @ + -")
    unknown = [k for k in cfg if k not in BUILD_KEYS + RUNTIME_KEYS + ["N"]]
    if unknown: note("cfg 里这些字段 v3.7 不认识，没有用到：" + "、".join(unknown) + "（升级对照见 round_template/README.md）")
    if "BUDGET" in cfg and cfg["BUDGET"] not in ("fail", "warn"):
        fail(f"cfg 的 BUDGET 只能是 \"fail\"（默认：字数超预算、字太小或对比度不够时 test.js 不通过）或 \"warn\"（只提示，只用于重建 v3.7 之前的旧轮次），现在是 {cfg['BUDGET']!r}")
    if cfg.get("BUDGET") == "warn": note("cfg 的 BUDGET 是 \"warn\"：字数和读得清只提示。新的一轮不要这样写，按 references/review-cards.md 的低负担写法改到通过为止")
    if "ROUTE" in cfg and cfg["ROUTE"] is not False: fail("cfg 的 ROUTE 只能写 false（不显示审批路线）；要显示就不写")
    if "N" in cfg: note("cfg 的 N 不再需要，条目数按 ITEMS 计算")

    tpl = read(at(cfg["template"]) if cfg.get("template") else os.path.join(HERE, "page.src.html"))
    linker = read(at(cfg["linker"]) if cfg.get("linker") else os.path.join(SKILL, "assets", "code-linker.js")).strip()
    export = read(at(cfg["export"]) if cfg.get("export") else os.path.join(SKILL, "assets", "export-module.js")).strip()
    data_files = cfg["data"] if isinstance(cfg["data"], list) else [cfg["data"]]
    data = "\n".join(read(at(p)) for p in data_files)
    codes_path = at(cfg.get("codes", "codes.js"))
    if os.path.exists(codes_path): codes = read(codes_path)
    else:
        note(f"没有 {codes_path}，代号表为空（先运行 scripts/build_codes.py）")
        codes = "const CODES = {};\n"

    # 数据和 cfg 的轮次、主题必须一致（文件名、反馈里的提案路径都靠它们）
    for name, want in (("ROUND", rnd), ("TOPIC", topic)):
        if not re.search(r"\b" + name + r"\s*=", data): fail(f"数据里没有 {name}")
        got = literal(data, name)
        if got is not None and got != want: fail(f"cfg 的 {name}（{want}）和数据里的 {name}（{got}）不一致")
    if not re.search(r"\bITEMS\s*=", data): fail("数据里没有 ITEMS")

    name = f"{rnd}_{topic}"
    out_art = at(cfg.get("out_artifact") or f"{name}_artifact.html")
    out_full = at(cfg.get("out_proposal") or f"{name}_proposal.html")
    pf = literal(data, "PROPOSAL_FILE")
    if pf is not None and pf != os.path.basename(out_full):
        note(f"数据里的 PROPOSAL_FILE（{pf}）和输出文件名（{os.path.basename(out_full)}）不一样，反馈里写的提案路径会对不上")

    # 1) 先填模板里的 {{占位符}}（在插入数据之前做，数据里的花括号不受影响）
    tokens = {
        "PAGE_TITLE": cfg.get("PAGE_TITLE") or f"{rnd} · {topic} · 审批台",
        "ROUND": rnd, "TOPIC": topic,
        "HEADER": cfg.get("HEADER") or topic,
        "INTRO": cfg.get("INTRO", ""), "LEAD": cfg.get("LEAD", ""),
    }
    s = tpl
    for k, v in tokens.items(): s = s.replace("{{%s}}" % k, str(v))
    left = sorted(set(re.findall(r"\{\{([A-Za-z_]+)\}\}", s)))
    if left: fail("模板里还有没填的占位符：" + "、".join(left))

    # 2) 项目补充样式：CSS_FILE（文件）和 CSS（字符串），放在模板样式的最后
    css = (read(at(cfg["CSS_FILE"])) if cfg.get("CSS_FILE") else "") + ("\n" + cfg["CSS"] if cfg.get("CSS") else "")
    if css.strip():
        if s.count("</style>") != 1: fail("模板里 </style> 应该只出现一次")
        s = s.replace("</style>", "/* ===== 本项目补充（cfg 的 CSS_FILE / CSS） ===== */\n" + css.strip() + "\n</style>")

    # 3) 插入 cfg 的运行时设置、代号表、数据、代号链接器、导出模块
    runtime = {k: cfg[k] for k in RUNTIME_KEYS if k in cfg}
    if "REVIEW_DIR" not in cfg: note(f"cfg 没写 REVIEW_DIR，评审文件夹按 skill 的约定 {DEFAULT_REVIEW_DIR}")
    runtime["REVIEW_DIR"] = "/".join(p for p in re.split(r"[\\/]+", str(cfg.get("REVIEW_DIR", DEFAULT_REVIEW_DIR))) if p not in ("", "."))
    runtime["PROPOSAL_FILE"] = os.path.basename(out_full)
    head = "/* 由 build.py 从 cfg 注入 */\nconst AD_CFG = " + json.dumps(runtime, ensure_ascii=False) + ";\n"
    for marker, value in (("/*__DATA__*/", head + codes + "\n" + data), ("/*__CODELINKER__*/", linker), ("/*__EXPORT__*/", export)):
        if s.count(marker) != 1: fail(f"模板里 {marker} 应该只出现一次")
        s = s.replace(marker, value, 1)

    i = s.index('<div id="tip"')
    full = ('<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            + s[:i] + '</head>\n<body>\n' + s[i:] + '\n</body>\n</html>\n')
    with open(out_full, "w", encoding="utf-8") as f: f.write(full)
    with open(out_art, "w", encoding="utf-8") as f: f.write(s)
    print(f"{os.path.basename(out_full)}（{len(full)} 字符）\n{os.path.basename(out_art)}（{len(s)} 字符）")


if __name__ == "__main__":
    main()
