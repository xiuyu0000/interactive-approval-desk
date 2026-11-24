// 审批者视角冷读的材料（interactive-approval-desk v3.7.1）
// 用法：在页面所在的文件夹运行
//   NODE_PATH=<装有 playwright 的 node_modules> node <skill>/round_template/dumptext.js <out.txt> [页面.html | 轮次如 R03]
// 不给页面时取当前文件夹里修改时间最新的 *_proposal.html（给轮次时在 {轮次}_*_proposal.html 里取最新的）。
// 分两遍导出（v3.7 起）：第一遍是默认看到的，折叠都收着，按页面顺序：页面速览（或导语）、沙盘、审批路线、每张卡的四格、图和选项；
// 第二遍展开全部折叠（核对材料、点的说明、参考表、收起的图），卡片之后再列沙盘的每个视角；最后是悬浮解释。冷读先只读第一遍作答，再读第二遍核对。
// 沙盘（v3.7.1 起）：第一遍是标题、说明、有哪些视角、打开时那个视角的说明和对象表；第二遍是每个视角的说明和连线（谁连到谁、标签、相关条目）。
// 没有沙盘时，第一遍照抄页面“从零看懂”第 2 步（“这一轮没有沙盘”和理由，或“这一页没有写为什么”）。
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
(async () => {
  const out = process.argv[2], arg = process.argv[3];
  if (!out) { console.error('用法：node dumptext.js <out.txt> [页面.html | 轮次]'); process.exit(2); }
  let page = arg && fs.existsSync(arg) && fs.statSync(arg).isFile() ? arg : null;
  if (!page) page = fs.readdirSync('.').filter(f => /_proposal\.html$/.test(f) && (!arg || f.startsWith(arg + '_'))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!page) { console.error('找不到页面：' + (arg || '*_proposal.html')); process.exit(2); }
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); await p.goto(pathToFileURL(path.resolve(page)).href); await p.waitForTimeout(500);
  const t = await p.evaluate(() => {
    const txt = id => { const el = document.getElementById(id); return el && !el.hidden ? el.innerText.trim() : ''; };
    const lead = document.querySelector('#sec-start .lead'), folded = lead && lead.closest('details');
    const brief = txt('pbrief'), route = txt('route');
    /* 悬浮解释：从卡片、“从零看懂”、沙盘（每个视角的说明都收一遍）、对象表和审批路线里收集 */
    const terms = typeof AD_DATA !== 'undefined' ? AD_DATA.terms : (typeof TERMS !== 'undefined' ? TERMS : {});
    const tips = new Map(), SCOPE = '#items, #sec-start, #sec-sandbox, #sec-objs, #route';
    const collect = () => {
      document.querySelectorAll(SCOPE.split(', ').map(x => x + ' .term[data-t]').join(', ')).forEach(a => { const v = terms[a.dataset.t]; if (v) tips.set(a.dataset.t, v[0]); });
      document.querySelectorAll(SCOPE.split(', ').map(x => x + ' .code[data-c]').join(', ')).forEach(a => { const v = CODES[a.dataset.c]; if (v) tips.set(a.dataset.c, v[0] + (v[1] ? '：' + v[1] : '')); });
    };
    /* 沙盘 */
    const hasSb = typeof HAS_SB !== 'undefined' && HAS_SB, views = hasSb ? window.__views() : [];
    const vname = v => typeof adViewName === 'function' ? adViewName(v) : v;
    const oname = id => (typeof AD_DATA !== 'undefined' && AD_DATA.obj[id] ? AD_DATA.obj[id].name : id);
    /* 说明框：每段一行，同一段里的几个按钮用“、”隔开（不然会连成“R01-01R01-02”） */
    const spotText = () => [...(document.getElementById('spot') || { children: [] }).children].map(d => {
      const bs = [...d.querySelectorAll('button')];
      return bs.length && bs.length === d.children.length ? '相关：' + bs.map(x => x.innerText.trim()).join('、') : d.innerText.replace(/\s+/g, ' ').trim();
    }).filter(Boolean).join('\n  ') || '（无）';
    /* 连线：泳道里是这条流程的连线；对象视角里是它的上游和下游（全景的连线加流程的连线） */
    const links = v => {
      if (typeof AD_DATA === 'undefined') return '';
      if (v.startsWith('flow:')) { const f = AD_DATA.flows.find(x => 'flow:' + x.id === v); return f && f.links.length ? '\n  连线：' + f.links.map(l => `${oname(l[0])} → ${oname(l[1])}：${l[2]}${l[3] ? `（${l[3]}）` : ''}`).join('；') : ''; }
      if (v.startsWith('obj:') && typeof EDGES !== 'undefined') {
        const id = v.slice(4), up = EDGES.filter(e => e[1] === id), down = EDGES.filter(e => e[0] === id);
        return `\n  上游：${up.length ? up.map(e => `${oname(e[0])}（经由 ${e[2]}）`).join('、') : '没有'}；下游：${down.length ? down.map(e => `${oname(e[1])}（经由 ${e[2]}）`).join('、') : '没有'}`;
      }
      return v === 'all' && AD_DATA.pano.length ? '\n  全景里的连线：' + AD_DATA.pano.map(e => `${oname(e[0])} → ${oname(e[1])}${e[2] ? '：' + e[2] : ''}`).join('；') : '';
    };
    let sb;
    if (hasSb) {
      const tbl = document.querySelector('#sec-objs table');
      sb = `【沙盘】${txt('sb-title')}\n${txt('sb-lead')}\n视角：${views.map(vname).join('、')}\n打开时的视角（${vname(typeof VIEW !== 'undefined' ? VIEW : views[0])}）：\n  ${spotText()}\n\n【对象】${txt('obj-title')}\n${tbl ? tbl.innerText.trim() : ''}`;
    } else {
      const h2 = document.getElementById('howto-2');
      sb = `【沙盘】${h2 ? h2.innerText.replace(/^\s*\d+\s*/, '').replace(/\s+/g, ' ').trim() : '这一轮没有沙盘，页面也没写为什么'}`;
    }
    collect();
    /* 第一遍：默认看到的 */
    let s = '=== 第一遍：默认看到的（折叠都收着） ===\n\n';
    if (brief) s += brief + '\n\n' + (folded ? '（导语原文默认收起，第二遍里有）\n\n' : '');
    else if (lead) s += lead.innerText.trim() + '\n\n';
    s += sb + '\n\n';
    if (route) s += route + '\n\n';
    s += document.getElementById('items').innerText;
    /* 第二遍：展开全部 */
    if (typeof toggleOpenAll === 'function' && !OPEN_ALL) toggleOpenAll();
    document.querySelectorAll('#items details, #sec-start details, #route details').forEach(d => d.open = true);
    collect();
    s += '\n\n=== 第二遍：展开全部折叠（核对材料、点的说明、参考表、收起的图），卡片之后是沙盘的每个视角 ===\n\n';
    if (folded && lead) s += '【导语原文】\n' + lead.innerText.trim() + '\n\n';
    s += document.getElementById('items').innerText;
    if (hasSb) s += '\n\n【沙盘的每个视角】\n' + views.map(v => { setView(v); collect(); return `· ${vname(v)}\n  ${spotText()}${links(v)}`; }).join('\n');
    s += '\n\n=== 悬浮解释（读者把鼠标停在词上能看到） ===\n' + [...tips].map(([k, v]) => `${k}：${v}`).join('\n');
    return s;
  });
  fs.writeFileSync(out, t); await b.close();
  console.log(`${out}（来自 ${path.basename(page)}）`);
})().catch(e => { console.error(e); process.exit(1); });
