#!/usr/bin/env python3
"""Збирає одинарний index.html з частин у src/.

Джерела лишаються окремими файлами тільки для зручності розробки й тестів —
на виході завжди один самодостатній HTML без білд-кроку для користувача.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"
OUT = ROOT / "index.html"

JS_PARTS = [
    "01-imports.js",
    "10-data.js",
    "20-astro.js",
    "30-scale.js",
    "40-textures.js",
    "50-scene.js",
    "60-update.js",
    "70-ui.js",
    "90-main.js",
]

THREE = "https://cdn.jsdelivr.net/npm/three@0.160.1"
AE = "https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/astronomy.browser.min.js"

TAIL = f"""
<script src="{AE}"
  onerror="window.__aeFailed=true"></script>

<script type="importmap">
{{
  "imports": {{
    "three": "{THREE}/build/three.module.js",
    "three/addons/": "{THREE}/examples/jsm/"
  }}
}}
</script>

<script type="module">
{{JS}}
</script>

</body>
</html>
"""


def main() -> int:
    head = (SRC / "00-head.html").read_text(encoding="utf-8").rstrip()
    body = (SRC / "05-body.html").read_text(encoding="utf-8").rstrip()

    chunks = []
    for name in JS_PARTS:
        text = (SRC / name).read_text(encoding="utf-8").rstrip()
        if name != "01-imports.js":
            # Імпорти мусять лишитись угорі модуля; решта йде як є.
            if re.search(r"^\s*import\s", text, re.M):
                print(f"! {name}: import поза 01-imports.js", file=sys.stderr)
                return 1
        chunks.append(f"/* ── {name} ─────────────────────────────── */\n{text}")

    js = "\n\n".join(chunks)
    if "</script" in js:
        print("! у JS трапився рядок '</script' — розбийте його", file=sys.stderr)
        return 1

    html = head + "\n" + body + "\n" + TAIL.replace("{JS}", js)
    OUT.write_text(html, encoding="utf-8")
    kb = len(html.encode("utf-8")) / 1024
    print(f"index.html · {kb:.1f} КБ · {len(html.splitlines())} рядків")

    # Варіант для Artifact: doctype/head/body додає сама обгортка,
    # тож віддаємо тільки title, style і вміст body.
    inner = html[html.index("<head>") + 6:html.index("</head>")]
    body_html = html[html.index("<body>") + 6:html.rindex("</body>")]
    title = re.search(r"<title>.*?</title>", inner, re.S).group(0)
    style = re.search(r"<style>.*?</style>", inner, re.S).group(0)
    art = f"{title}\n{style}\n{body_html}\n"
    (ROOT / "artifact.html").write_text(art, encoding="utf-8")
    print(f"artifact.html · {len(art.encode('utf-8')) / 1024:.1f} КБ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
