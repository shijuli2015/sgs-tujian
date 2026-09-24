"""Build the static 三国杀 DIY 武将图鉴 site.

    python build.py                      # characters/ -> site/
    python build.py --src ../characters --out site --force

Input : sgsshap card exports, one ``*.json`` + same-named ``*.png`` per card.
Output: a dependency-free static site (any static host / GitHub Pages / Vercel):
    site/index.html                      list page (client-side search + filters)
    site/generals/<slug>/index.html      one pre-rendered page per card
    site/data/generals.json              data used by the list page
    site/img/{thumb,card}/<slug>.webp    resized card images
"""
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image
from pypinyin import Style, lazy_pinyin

ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"
STATIC = ROOT / "static"
TOOLS = ROOT / "tools"

KINGDOMS = {
    "WEI": ("wei", "魏"),
    "SHU": ("shu", "蜀"),
    "WU": ("wu", "吴"),
    "QUN": ("qun", "群"),
    "JIN": ("jin", "晋"),
    "SHEN": ("shen", "神"),
}
KINGDOM_ORDER = ["wei", "shu", "wu", "qun", "jin", "shen"]
SKILLCARD_MARKERS = ("技能卡", "技能池")
THUMB_W, CARD_W = 480, 900


# --------------------------------------------------------------------------- text

def esc(s: str) -> str:
    return html.escape(s or "", quote=True)


def render_desc(raw: str) -> str:
    """sgsshap skill text -> safe HTML. Only <b>, <i> and <full> survive; 【牌名】 is styled."""
    s = html.escape(raw or "", quote=False)
    s = re.sub(r"&lt;(/?)(b|i)&gt;", r"<\1\2>", s)
    s = re.sub(r"&lt;full&gt;(.*?)&lt;/full&gt;", r'<span class="fw">\1</span>', s)
    s = re.sub(r"&lt;/?[a-zA-Z][^&]*?&gt;", "", s)          # any other tag: drop
    s = re.sub(r"(【[^】\n]{1,12}】)", r'<span class="card-ref">\1</span>', s)
    s = re.sub(r"(「[^」\n]{1,12}」)", r'<span class="mark-ref">\1</span>', s)
    return s.replace("\n", "<br>")


def plain(raw: str) -> str:
    return re.sub(r"<[^>]+>", "", raw or "").replace("\n", " ").strip()


def skill_tags(raw: str) -> list[str]:
    """Leading bold keywords that end in 技 (锁定技, 限定技, 阵法技，锁定技 ...)."""
    tags: list[str] = []
    for chunk in re.findall(r"<b>(.*?)</b>", raw or ""):
        for part in re.split(r"[，,、\s]+", chunk):
            if part.endswith("技") and 2 <= len(part) <= 4 and part not in tags:
                tags.append(part)
    return tags


def py_full(s: str) -> list[str]:
    return [p for p in lazy_pinyin(s, errors="ignore") if p.isalpha()]


def py_initials(s: str) -> str:
    return "".join(p[0] for p in lazy_pinyin(s, style=Style.FIRST_LETTER, errors="ignore") if p and p[0].isalpha())


def clean_name(s: str) -> str:
    return re.sub(r"\d+$", "", (s or "").strip())


def glob_escape(s: str) -> str:
    return re.sub(r"([\[\]*?])", r"[\1]", s)


# --------------------------------------------------------------------------- load

def parse_filename(stem: str) -> dict:
    """老UI.QUN004.率盟伐董.袁绍技能池 -> template, code, title, tail."""
    parts = stem.split(".")
    tail = parts[-1] if parts else stem
    code = parts[1] if len(parts) > 2 else ""
    title = parts[2] if len(parts) > 3 else ""
    return {"code": code, "title": title, "tail": tail}


def load_overrides() -> dict:
    p = ROOT / "overrides.json"
    if not p.exists():
        return {}
    return {k: v for k, v in json.loads(p.read_text(encoding="utf-8")).items() if not k.startswith("_")}


def load_cards(src: Path) -> list[dict]:
    overrides = load_overrides()
    cards = []
    for jf in sorted(src.glob("*.json")):
        try:
            d = json.loads(jf.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            print(f"  ! skip {jf.name}: {e}", file=sys.stderr)
            continue
        b = d.get("baseInfo") or {}
        fn = parse_filename(jf.stem)
        tail = fn["tail"]

        is_skillcard = any(m in tail for m in SKILLCARD_MARKERS)
        if is_skillcard:
            # 李傕郭汜技能卡飞熊军 -> owner 李傕郭汜, label 飞熊军 ; 袁绍技能池 -> 袁绍, 技能池
            m = re.match(r"(.*?)(技能卡|技能池)(.*)", tail)
            owner = clean_name(m.group(1)) if m else clean_name(b.get("name"))
            label = (m.group(3) or m.group(2)) if m else "技能卡"
            name = clean_name(b.get("name")) or owner
            display = owner if name in (owner, "") else f"{owner}·{name}"
        else:
            owner, label = "", ""
            name = clean_name(b.get("name")) or clean_name(tail)
            display = name

        kingdom_key, kingdom_name = KINGDOMS.get((b.get("kingdom") or "").upper(), ("qun", "群"))
        code = fn["code"] or (b.get("legendId") or "").replace(" ", "")
        title = (b.get("title") or fn["title"] or "").strip()
        m = re.search(r"Illustration[:：]\s*(.+)$", b.get("copyright") or "")
        illustrator = m.group(1).strip() if m else ""

        skills = []
        for s in b.get("skills") or []:
            raw = s.get("desc") or ""
            skills.append({
                "name": (s.get("name") or "").strip(),
                "html": render_desc(raw),
                "text": plain(raw),
                "tags": skill_tags(raw),
                "derived": bool(s.get("derivedFlag")),
            })
        tags = []
        for s in skills:
            tags += [t for t in s["tags"] if t not in tags]
        lord = bool(b.get("masterFlag")) or "主公技" in tags

        png = jf.with_suffix(".png")
        if not png.exists():
            # the image may carry a version prefix the JSON lacks: 恤下媲子.吴懿.json + 恤下媲子.谋吴懿.png
            head = jf.stem[: len(jf.stem) - len(tail)]
            alts = [p for p in src.glob(f"{glob_escape(head)}*.png") if p.stem[len(head):].endswith(tail)]
            if len(alts) == 1:
                png = alts[0]
                prefix = png.stem[len(head):-len(tail)]
                if not is_skillcard and prefix:
                    display = prefix + name   # name stays bare so versions still group together
        # 鸿谋翼远.谋鲁肃.json whose JSON name is just 鲁肃 -> prefix 谋
        tail_name = clean_name(tail)
        file_prefix = (tail_name[: -len(name)]
                       if not is_skillcard and name and tail_name.endswith(name) else "")
        prefix = (overrides.get(jf.stem, {}).get("prefix") or (b.get("namePrefix") or "")
                  or file_prefix).strip()
        if prefix and not is_skillcard and not display.startswith(prefix):
            display = prefix + name
        cards.append({
            "file": jf.name,
            "png": png if png.exists() else None,
            "kind": "skillcard" if is_skillcard else "general",
            "name": name,
            "display": display,
            "owner": owner,
            "label": label,
            "title": title,
            "code": code,
            "kingdom": kingdom_key,
            "kingdomName": kingdom_name,
            "hp": int(b.get("hp") or 0),
            "maxHp": int(b.get("maxHp") or 0),
            "shield": int(b.get("shield") or 0),
            "lord": lord,
            "illustrator": illustrator,
            "quote": (b.get("quote") or "").strip(),
            "skills": skills,
            "tags": tags,
        })
    return cards


# --------------------------------------------------------------------------- link

def assign_slugs(cards: list[dict]) -> None:
    seen: dict[str, int] = defaultdict(int)
    for c in cards:
        base = "-".join(py_full(c["owner"] or c["name"])) or "wu-jiang"
        # 袁绍技能池 -> yuan-shao-jnc ; 李傕郭汜技能卡飞熊军 -> li-jue-guo-si-fxj
        suffix = py_initials(c["label"] if c["kind"] == "skillcard" else c["title"])
        slug = f"{base}-{suffix}" if suffix else base
        seen[slug] += 1
        c["slug"] = slug if seen[slug] == 1 else f"{slug}-{seen[slug]}"


def link_cards(cards: list[dict]) -> None:
    """variants = other generals sharing code+name; skill cards hang off their owner."""
    by_code_name: dict[tuple, list[dict]] = defaultdict(list)
    by_name: dict[str, list[dict]] = defaultdict(list)
    for c in cards:
        if c["kind"] == "general":
            by_code_name[(c["code"], c["name"])].append(c)
            by_name[c["name"]].append(c)
    for c in cards:
        c["variants"], c["skillcards"], c["parents"] = [], [], []
    for c in cards:
        if c["kind"] == "general":
            c["variants"] = [o["slug"] for o in by_code_name[(c["code"], c["name"])] if o is not c]
        else:
            same_code = [o for o in cards if o["kind"] == "general" and o["code"] == c["code"]]
            owners = [o for o in same_code if o["name"] == c["owner"]] or by_name.get(c["owner"], []) or same_code
            c["parents"] = [o["slug"] for o in owners]
            for o in owners:
                o["skillcards"].append(c["slug"])


def search_fields(c: dict) -> dict:
    names = [c["display"], c["name"], c["owner"], c["title"]]
    py = " ".join("".join(py_full(n)) for n in names if n)
    ini = " ".join(py_initials(n) for n in names if n)
    skill_py = " ".join("".join(py_full(s["name"])) + " " + py_initials(s["name"]) for s in c["skills"])
    return {"py": py, "ini": ini, "spy": skill_py}


# --------------------------------------------------------------------------- output

def make_images(cards: list[dict], out: Path, force: bool) -> None:
    live = {c["slug"] for c in cards}
    for sub in ("thumb", "card"):
        (out / "img" / sub).mkdir(parents=True, exist_ok=True)
        for f in (out / "img" / sub).glob("*.webp"):
            if f.stem not in live:
                f.unlink()
    for i, c in enumerate(cards, 1):
        if not c["png"]:
            c["img"] = None
            continue
        c["img"] = True
        targets = [(out / "img" / "thumb" / f"{c['slug']}.webp", THUMB_W, 78),
                   (out / "img" / "card" / f"{c['slug']}.webp", CARD_W, 85)]
        if not force and all(t.exists() and t.stat().st_mtime >= c["png"].stat().st_mtime for t, _, _ in targets):
            continue
        with Image.open(c["png"]) as im:
            im = im.convert("RGB")
            for path, w, q in targets:
                h = round(im.height * w / im.width)
                im.resize((w, h), Image.LANCZOS).save(path, "WEBP", quality=q, method=6)
        print(f"  img {i}/{len(cards)} {c['slug']}")


def load_tools() -> list[dict]:
    p = TOOLS / "tools.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


def link_tools(cards: list[dict], tools: list[dict]) -> None:
    """A simulator attaches to every card that has one of its skills."""
    by_skill = defaultdict(list)
    for t in tools:
        t["cards"] = []
        for s in t.get("skills", []):
            by_skill[s].append(t)
    for c in cards:
        c["tools"] = {}
        for s in c["skills"]:
            for t in by_skill.get(s["name"], []):
                c["tools"][s["name"]] = t
                if c["slug"] not in t["cards"]:
                    t["cards"].append(c["slug"])


# Fixed pill so it never disturbs a simulator's own layout (some centre <body> with flexbox).
BACKBAR = (
    '<nav id="sgs-backbar" style="position:fixed;top:10px;left:10px;z-index:2147483000;display:flex;gap:2px;'
    'font:13px/1 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;background:rgba(18,16,21,.82);'
    'backdrop-filter:blur(6px);border:1px solid rgba(214,170,85,.45);border-radius:999px;padding:3px;'
    'box-shadow:0 4px 14px rgba(0,0,0,.25)">'
    '<a href="../../" style="color:#f0cf85;text-decoration:none;padding:6px 10px;border-radius:999px">← 图鉴</a>'
    '<a href="../" style="color:#ece6da;text-decoration:none;padding:6px 10px;border-radius:999px">模拟器</a>'
    '</nav>'
    # below this width a simulator's own title starts under the pill, so push the page down
    '<style>@media (max-width:1000px){body{padding-top:52px !important}}</style>')


def publish_tools(tools: list[dict], idx: dict, out: Path) -> None:
    tdir = out / "tools"
    if tdir.exists():
        shutil.rmtree(tdir)
    tdir.mkdir(parents=True)
    for t in tools:
        src = (TOOLS / t["file"]).read_text(encoding="utf-8")
        page = re.sub(r"(<body[^>]*>)", lambda m: m.group(1) + BACKBAR, src, count=1, flags=re.I)
        if "sgs-backbar" not in page:
            raise SystemExit(f"tools/{t['file']}: no <body> tag to attach the back link to")
        d = tdir / t["slug"]
        d.mkdir()
        (d / "index.html").write_text(page, encoding="utf-8")

    items = []
    for t in tools:
        owners = "".join(
            f'<a class="tool-owner" href="../generals/{s}/">{esc(idx[s]["display"])}'
            f'<small>{esc(idx[s]["title"])}</small></a>' for s in t["cards"])
        skill = "".join(f'<span class="tag">{esc(s)}</span>' for s in t.get("skills", []))
        items.append(
            f'<article class="tool"><a class="tool-main" href="{t["slug"]}/">'
            f'<h2>{esc(t["name"])}<small>{esc(t["title"])}</small></h2>'
            f'<p>{esc(t["desc"])}</p><span class="tool-go">打开模拟器 →</span></a>'
            f'{"<div class=tool-meta>" + skill + owners + "</div>" if skill or owners else ""}</article>')
    page = (TEMPLATES / "tools.html").read_text(encoding="utf-8").replace("{{TOOLS}}", "".join(items))
    (tdir / "index.html").write_text(page, encoding="utf-8")


def list_record(c: dict) -> dict:
    return {
        "slug": c["slug"], "kind": c["kind"], "name": c["display"], "title": c["title"],
        "code": c["code"], "kingdom": c["kingdom"], "hp": c["hp"], "maxHp": c["maxHp"],
        "shield": c["shield"], "lord": c["lord"], "tags": c["tags"], "img": bool(c["img"]),
        "sim": bool(c["tools"]),
        "skills": [{"n": s["name"], "t": s["text"]} for s in c["skills"]],
        **search_fields(c),
    }


def hp_html(c: dict) -> str:
    if c["maxHp"] <= 0:
        return '<span class="muted">—</span>'
    val = f"{c['hp']}" if c["hp"] == c["maxHp"] else f"{c['hp']}/{c['maxHp']}"
    shield = f' <span class="shield" title="护甲">⛨{c["shield"]}</span>' if c["shield"] else ""
    return f'<span class="hp"><span class="heart">♥</span>{val}</span>{shield}'


def related_links(slugs: list[str], idx: dict[str, dict], prefix: str) -> str:
    out = []
    for s in slugs:
        o = idx[s]
        img = (f'<img src="{prefix}img/thumb/{s}.webp" alt="" loading="lazy">' if o["img"] else "")
        sub = (o["label"] if o["kind"] == "skillcard" else "") or o["title"]
        out.append(
            f'<a class="rel" href="{prefix}generals/{s}/">{img}'
            f'<span><b>{esc(o["display"])}</b><small>{esc(sub)}</small></span></a>')
    return "".join(out)


def render_detail(c: dict, idx: dict, order: list[str], tpl: str) -> str:
    p = "../../"
    i = order.index(c["slug"])
    prev_s, next_s = order[i - 1], order[(i + 1) % len(order)]

    skills = []
    for s in c["skills"]:
        badges = "".join(f'<span class="tag">{esc(t)}</span>' for t in s["tags"])
        derived = '<span class="tag tag-derived">衍生</span>' if s["derived"] else ""
        tool = c["tools"].get(s["name"])
        sim = (f'<a class="sim-btn" href="{p}tools/{tool["slug"]}/">▶ 模拟器</a>' if tool else "")
        skills.append(
            f'<section class="skill"><h3><span class="skill-name">{esc(s["name"])}</span>{badges}{derived}{sim}</h3>'
            f'<p>{s["html"]}</p></section>')

    meta = [("势力", f'<span class="kb k-{c["kingdom"]}">{c["kingdomName"]}</span>'),
            ("体力", hp_html(c))]
    if c["code"]:
        meta.append(("编号", esc(c["code"])))
    if c["title"]:
        meta.append(("称号", esc(c["title"])))
    meta.append(("类型", "技能卡" if c["kind"] == "skillcard" else "武将"))
    if c["lord"]:
        meta.append(("主公", "可选主公"))
    if c["illustrator"]:
        meta.append(("画师", esc(c["illustrator"])))
    meta_html = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in meta)

    rel = []
    if c["parents"]:
        rel.append(f'<h2>所属武将</h2><div class="rels">{related_links(c["parents"], idx, p)}</div>')
    if c["skillcards"]:
        rel.append(f'<h2>技能卡</h2><div class="rels">{related_links(c["skillcards"], idx, p)}</div>')
    if c["variants"]:
        rel.append(f'<h2>其他版本</h2><div class="rels">{related_links(c["variants"], idx, p)}</div>')

    image = (f'<a class="card-img" href="{p}img/card/{c["slug"]}.webp" target="_blank" rel="noopener">'
             f'<img src="{p}img/card/{c["slug"]}.webp" alt="{esc(c["display"])} 卡面" width="{CARD_W}" '
             f'height="{round(CARD_W * 1542 / 1098)}"></a>' if c["img"] else '<div class="card-img noimg">无卡面</div>')

    kind_label = "技能卡" if c["kind"] == "skillcard" else "武将"
    summary = "、".join(s["name"] for s in c["skills"] if s["name"])
    return (tpl
            .replace("{{ROOT}}", p)
            .replace("{{PAGE_TITLE}}", esc(f'{c["display"]}' + (f'「{c["title"]}」' if c["title"] else "")))
            .replace("{{DESCRIPTION}}", esc(f'{c["kingdomName"]}势力{kind_label}{c["display"]}，技能：{summary}'))
            .replace("{{NAME}}", esc(c["display"]))
            .replace("{{TITLE}}", esc(c["title"]))
            .replace("{{KINGDOM}}", c["kingdom"])
            .replace("{{KINGDOM_NAME}}", c["kingdomName"])
            .replace("{{KIND_BADGE}}", '<span class="tag tag-kind">技能卡</span>' if c["kind"] == "skillcard" else "")
            .replace("{{HP}}", hp_html(c))
            .replace("{{IMAGE}}", image)
            .replace("{{META}}", meta_html)
            .replace("{{SKILLS}}", "".join(skills) or '<p class="muted">无技能</p>')
            .replace("{{RELATED}}", "".join(rel))
            .replace("{{QUOTE}}", f'<blockquote>{esc(c["quote"])}</blockquote>' if c["quote"] else "")
            .replace("{{PREV}}", f'{p}generals/{prev_s}/')
            .replace("{{PREV_NAME}}", esc(idx[prev_s]["display"]))
            .replace("{{NEXT}}", f'{p}generals/{next_s}/')
            .replace("{{NEXT_NAME}}", esc(idx[next_s]["display"])))


def sort_key(c: dict):
    k = KINGDOM_ORDER.index(c["kingdom"]) if c["kingdom"] in KINGDOM_ORDER else 99
    num = int(re.sub(r"\D", "", c["code"]) or 9999)
    return (k, num, c["kind"] != "general", c["title"])


def build(srcs: list[Path], out: Path, force: bool) -> None:
    cards: dict[str, dict] = {}          # by source filename; a later --src wins
    for src in srcs:
        found = load_cards(src)
        dupes = [c["file"] for c in found if c["file"] in cards]
        print(f"reading {src}: {len(found)} cards" + (f", {len(dupes)} replacing earlier ones ({', '.join(dupes[:3])})" if dupes else ""))
        cards.update({c["file"]: c for c in found})
    cards = sorted(cards.values(), key=sort_key)
    assign_slugs(cards)
    link_cards(cards)
    tools = load_tools()
    link_tools(cards, tools)
    idx = {c["slug"]: c for c in cards}
    order = [c["slug"] for c in cards]
    print(f"  {len(cards)} cards "
          f"({sum(c['kind'] == 'general' for c in cards)} generals, "
          f"{sum(c['kind'] == 'skillcard' for c in cards)} skill cards)")

    out.mkdir(parents=True, exist_ok=True)
    make_images(cards, out, force)

    # static assets
    shutil.copytree(STATIC, out / "assets", dirs_exist_ok=True)

    # data
    (out / "data").mkdir(exist_ok=True)
    data = {"generated": __import__("datetime").date.today().isoformat(),
            "cards": [list_record(c) for c in cards]}
    (out / "data" / "generals.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # detail pages (stale ones removed so renamed slugs don't linger)
    gdir = out / "generals"
    if gdir.exists():
        for d in gdir.iterdir():
            if d.is_dir() and d.name not in idx:
                shutil.rmtree(d)
    tpl = (TEMPLATES / "general.html").read_text(encoding="utf-8")
    for c in cards:
        d = gdir / c["slug"]
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(render_detail(c, idx, order, tpl), encoding="utf-8")

    publish_tools(tools, idx, out)
    print(f"  {len(tools)} simulators")

    # list page, with a crawlable <noscript> index
    links = "".join(f'<li><a href="generals/{c["slug"]}/">{esc(c["display"])}'
                    f'{"「" + esc(c["title"]) + "」" if c["title"] else ""}</a></li>' for c in cards)
    index = (TEMPLATES / "index.html").read_text(encoding="utf-8").replace("{{NOSCRIPT_LINKS}}", links)
    (out / "index.html").write_text(index, encoding="utf-8")
    (out / "404.html").write_text(
        (TEMPLATES / "404.html").read_text(encoding="utf-8"), encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    print(f"done -> {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, nargs="+", default=[ROOT.parent / "characters", ROOT.parent / "character2"],
                    help="card folders, later ones win on duplicate file names")
    ap.add_argument("--out", type=Path, default=ROOT / "site")
    ap.add_argument("--force", action="store_true", help="re-encode every image")
    a = ap.parse_args()
    build([s.resolve() for s in a.src if s.exists()], a.out.resolve(), a.force)
