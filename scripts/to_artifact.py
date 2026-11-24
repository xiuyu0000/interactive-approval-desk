#!/usr/bin/env python3
"""Convert a full approval-desk HTML document into an Artifact-publishable page
(the Artifact tool adds doctype/html/head/body and the charset/viewport metas itself).
Removes only the document skeleton (<!doctype>, <html>, <head>, <body>) and the charset / viewport /
content-type metas. Keeps <title>, <style>, <link>, every other <meta> (e.g. claude:viewport-fit-sides),
body content and scripts. Tag names are matched whole, so <header>, <thead>, <tbody> are left alone.
Pages built by round_template/build.py already come with {ROUND}_{TOPIC}_artifact.html; use this for hand-written pages.
Usage: python3 to_artifact.py <page.html> <out.html>
"""
import re, sys

if len(sys.argv) != 3: sys.exit(__doc__)
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'(?is)<!doctype[^>]*>', '', s)
for tag in ('html', 'head', 'body'):
    s = re.sub(r'(?is)</?' + tag + r'\b[^>]*>', '', s)
s = re.sub(r'''(?is)<meta\b(?=[^>]*\b(?:charset\s*=|name\s*=\s*["']?viewport\b|http-equiv\s*=\s*["']?content-type\b))[^>]*>''', '', s)
open(sys.argv[2], 'w', encoding='utf-8').write(s.strip() + '\n'); print('artifact page', sys.argv[2])
