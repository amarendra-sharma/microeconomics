#!/usr/bin/env python3
"""Build supabase/functions/im-grade-attempt/index.ts from the template and the site's
engine files, then check the result.

The exam function issues every question and figure itself, so it must carry the SAME
im-diagrams.js, im-generators.js and im-econ160.js that the website serves. Editing those
files without rebuilding the function changes nothing students see in an exam. The GitHub
Action (.github/workflows/deploy-im-grade-attempt.yml) runs this on every push that
touches them.

Usage, from the repo root:  python3 tools/build_im_grade_attempt.py
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "tools", "im-grade-attempt.template.ts")
OUT = os.path.join(ROOT, "supabase", "functions", "im-grade-attempt", "index.ts")
HEADER_END = "// ---- end of template header ----\n"
FILES = [("DIAGRAMS_SRC", "im-diagrams.js"),
         ("GENERATORS_SRC", "im-generators.js"),
         ("ECON160_SRC", "im-econ160.js")]


def read(path):
    with io.open(path, encoding="utf-8") as fh:
        return fh.read()


built = read(TPL)
if HEADER_END in built:
    built = built.split(HEADER_END, 1)[1]

for name, fn in FILES:
    marker = "@@" + name + "@@"
    if built.count(marker) != 1:
        sys.exit("template must contain %s exactly once" % marker)
    built = built.replace(marker, "const " + name + " = " + json.dumps(read(os.path.join(ROOT, fn))) + ";")
if "@@" in built.split("Deno.serve")[0]:
    sys.exit("a placeholder survived the build")

# Round-trip check: every embedded string decodes back to the exact file on disk.
dec = json.JSONDecoder()
for name, fn in FILES:
    start = built.index("const " + name + " = ") + len("const " + name + " = ")
    value, _ = dec.raw_decode(built[start:])
    if value != read(os.path.join(ROOT, fn)):
        sys.exit("embedded %s does not match %s" % (name, fn))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with io.open(OUT, "w", encoding="utf-8") as fh:
    fh.write(built)
print("built %s (%.2f MB); embeds match %s" % (
    os.path.relpath(OUT, ROOT), len(built.encode("utf-8")) / 1048576.0, ", ".join(fn for _, fn in FILES)))
