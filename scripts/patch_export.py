#!/usr/bin/env python3
"""Upgrade an approval-desk page to the export module in assets/export-module.js (idempotent).
Usage: python3 patch_export.py <page.html> <export-module.js>
- Replaces any existing 'Approval Desk Export Module vN' block (or the legacy dl()/triggerFullExport() pair).
- v3: markdown only — removes the JSON-only button and 'md + json' / 'md+json' wording, adds #save-target line.
"""
import re, sys
html_path, mod_path = sys.argv[1], sys.argv[2]
s = open(html_path, encoding='utf-8').read(); mod = open(mod_path, encoding='utf-8').read().strip()
m = re.search(r'// =+ Approval Desk Export Module v\d.*?// =+ End Export Module v\d =+', s, re.S)
if m:
    s = s[:m.start()] + mod + s[m.end():]
else:
    a = s.index('    function dl(name, text, type) {'); b = s.index('    function copyMarkdownToClipboard()')
    s = s[:a] + mod + '\n' + s[b:]
s = s.replace('document.getElementById("exportBtn").onclick = triggerFullExport;', 'document.getElementById("exportBtn").onclick = () => triggerFullExport(false);')
s = re.sub(r'\s*<button class="btn" onclick="downloadJsonOnly\(\)">[^<]*</button>', '', s)
s = s.replace('📤 导出反馈（md + json）', '📤 提交反馈（导出 md）').replace('导出反馈（md + json）', '提交反馈（导出 md）')
s = s.replace('（md + json）', '（md）').replace('md + json', 'md').replace(' 与 <code>.json</code>', '')
s = s.replace('导出反馈(md+json)', '提交反馈(md)').replace('(md+json)', '(md)').replace('md+json', 'md')
s = s.replace('<button class="btn" onclick="triggerFullExport(true)">📁 更换保存文件夹</button>', '<button class="btn" onclick="triggerFullExport(true)">📁 本地导出 / 更换保存文件夹</button>')
if 'id="save-target"' not in s:
    anchor = 'id="export-summary-cards"></div>'
    i = s.index(anchor); j = s.rfind('<div', 0, i)
    s = s[:j] + '<div id="save-target" style="background:#fff;border:1px dashed #93c5fd;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:14px;color:#1e3a8a;"></div>\n      ' + s[j:]
assert 'downloadJsonOnly()' not in s.split('<script>')[0]
open(html_path, 'w', encoding='utf-8').write(s); print('patched', html_path)
