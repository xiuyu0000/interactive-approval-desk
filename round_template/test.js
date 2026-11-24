// 审批台自检（interactive-approval-desk v3.7.2）
// 用法：在页面所在的文件夹运行
//   NODE_PATH=<装有 playwright 的 node_modules> node <skill>/round_template/test.js [页面.html | 轮次如 R03] [对象ID]
// 不给参数时取当前文件夹里修改时间最新的 *_proposal.html；给轮次时在 {轮次}_*_proposal.html（也认旧的 {轮次}_proposal.html）里取最新的。
// 检查：沙盘每个视图零重叠、零越界；没有未解释的代号，每个代号都进了代号索引；存储键带项目前缀；
//       托管模式（读完草稿才能作答、自动草稿、接着上次的草稿、别处更新时不覆盖、键不同的草稿不用、提交、另存 md、连不上数据库时如实提示）、
//       本地文件夹、下载三条导出路径；
//       手机宽度（400px）不横向溢出；没有页面错误。
//       v3.7：数据检查（形状、诚实、数字出处）、每张卡默认看到的字数和预算、读得清（字号、浅色和深色下的对比度）、
//       推荐的选项不加重、没表态的点都显示“待你表态”、bulk: false 的分组一键通过不填、有简报的卡反馈 md 里有简报、
//       375px 和 360px 宽、折叠全开时图和表不溢出。
//       v3.7.1：审批路线在条目一节的开头；沙盘的视角画不出来、方框或标签跑出画布、标签的字比标签宽都算不通过；
//       没有沙盘时“从零看懂”第 2 步一定写“这一轮没有沙盘”（打印出来），写了 NO_SANDBOX 就要显示这句；
//       __lint() 的报错里有沙盘数据的形状，提示里有：没有沙盘也没写理由、沙盘一条连线都没有、view 写的视角不存在。
//       v3.7.2：托管模式网络断了或不稳——提交自动重试后送达、一直不通时如实说没提交成功并在原地给出再试 / 另存 / 复制（不下载）、
//       数据库不回应时不另发写入（同一文档同时最多一笔）、草稿自动补存并在提交区提前提醒、反馈超过 256 KiB 直接说明、
//       打开时读草稿迟到照样接上、别处有更新的草稿时不提交旧回答、再提交没成功时说明数据库里是旧版本、提交途中改了回答要提醒、
//       revoked 不解释权限、回答超过 256 KiB 时草稿不发；托管模式的提交按钮不写“导出”，本地文件里写“导出 md”。
//       任何一项不通过，退出码为 1。cfg 的 BUDGET 为 "warn" 时，字数和读得清只提示（只用于重建 v3.7 之前的旧轮次）。截图写在当前文件夹（shot_*.png）。
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');

function findPage(arg) {
  if (arg && fs.existsSync(arg) && fs.statSync(arg).isFile()) return path.resolve(arg);
  const files = fs.readdirSync('.').filter(f => /_proposal\.html$/.test(f));
  const hit = (arg ? files.filter(f => f.startsWith(arg + '_')) : files).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!hit.length) { console.error('找不到页面：' + (arg ? `${arg} 或 ${arg}_*_proposal.html` : '*_proposal.html')); process.exit(2); }
  if (hit.length > 1) console.log('有多个候选页面，取修改时间最新的；没有检查：' + hit.slice(1).join('、'));
  return path.resolve(hit[0]);
}

(async () => {
  const file = findPage(process.argv[2]), url = pathToFileURL(file).href, objArg = process.argv[3];
  const fails = [], check = (ok, msg) => { if (!ok) fails.push(msg); };
  const noFonts = p => p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  console.log('页面', path.basename(file));
  const b = await chromium.launch();
  try {
    // 1) 布局、代号、页面错误
    let p = await b.newPage({ viewport: { width: 1360, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(500);
    const views = await p.evaluate(() => typeof window.__views === 'function' ? window.__views() : null);
    if (!views) throw new Error('页面脚本在初始化时就出错了，后面的检查都做不了。页面报的错：' + (errs.join(' | ') || '（没有捕获到）'));
    let total = 0, soft = 0;
    // v3.7.1 新加的两项（方框或标签跑出画布、标签的字比标签宽）在 cfg 的 BUDGET 为 "warn" 时只提示：重建旧轮次不因后加的检查不通过
    const sbWarnOnly = await p.evaluate(() => typeof AD_BUDGET_MODE !== 'undefined' && AD_BUDGET_MODE === 'warn');
    for (const v of views) {
      // v3.7.1：一个视角画不出来（例如 viewAll() 画了不存在的对象）时记下来，后面的检查照做
      let e;
      try { e = await p.evaluate(v => { setView(v); return window.__check(); }, v); }
      catch (err) { e = ['画不出来：' + String(err && err.message || err).split('\n')[0]]; }
      const late = sbWarnOnly ? e.filter(x => /^(off-canvas|pill-text) /.test(x)) : [];
      e = e.filter(x => !late.includes(x));
      if (late.length) { console.log('   ! 提示：', v, late, '（cfg 的 BUDGET 是 "warn"：只提示）'); soft += late.length; }
      if (e.length) { console.log('  ', v, e); total += e.length; }
    }
    // v3.7.1：没有沙盘时打印页面上第 2 步实际写的（理由，或“这一页没有写为什么”）
    const sbInfo = await p.evaluate(() => { const h2 = document.getElementById('howto-2'); return { has: typeof HAS_SB === 'undefined' || HAS_SB, step2: h2 ? h2.innerText.replace(/\s+/g, ' ').trim() : '' }; });
    console.log(`沙盘：${views.length} 个视图，重叠 / 越界 ${total} 处${soft ? `（另有 ${soft} 处只提示）` : ''}${sbInfo.has ? '' : `（页面第 2 步：${sbInfo.step2 || '没有'}）`}`);
    check(total === 0, `沙盘有 ${total} 处重叠、越界或画不出来`);
    // v3.7.1：审批路线在条目一节的开头、卡片之前；没有沙盘时第 2 步一定在，写了 NO_SANDBOX 就要显示这句理由（页面上渲染后的字）
    const placed = await p.evaluate(() => {
      const r = document.getElementById('route'), items = document.getElementById('items'), h2 = document.getElementById('howto-2');
      const route = !r || r.hidden ? 'hidden' : (r.closest('#sec-items') && items && (r.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'ok' : 'misplaced');
      let nosb = 'n/a';
      if (typeof HAS_SB !== 'undefined' && !HAS_SB) {
        const flat = x => String(x || '').replace(/\s+/g, '');
        const want = typeof AD_NO_SB_SHOW === 'string' && AD_NO_SB_SHOW ? flat(adPlain(AD_NO_SB_SHOW)) : '';
        nosb = !h2 || !flat(h2.innerText).includes('没有沙盘') ? 'nostep' : (want && !flat(h2.innerText).includes(want) ? 'missing' : 'ok');
      }
      return { route, nosb };
    });
    check(placed.route !== 'misplaced', '审批路线不在条目一节的开头（v3.7.1 起放在卡片之前）');
    check(placed.nosb !== 'nostep', '没有沙盘，但“从零看懂”第 2 步没有写“这一轮没有沙盘”');
    check(placed.nosb !== 'missing', '写了 NO_SANDBOX，但“从零看懂”第 2 步显示的不是这句理由');
    const codes = await p.evaluate(() => {
      document.querySelectorAll('.fbtn[data-f]').forEach(b => b.click());
      const all = document.querySelector('.fbtn[data-f="all"]'); if (all) all.click();
      const idx = new Set([...document.querySelectorAll('#code-index .ci')].map(x => x.id.slice(2)));
      const links = [...document.querySelectorAll('.code[data-c]')].map(a => a.dataset.c);   // 选项和按钮里的代号是 span，也要进索引
      return { unknown: [...window.__unknownCodes], links: links.length, missing: [...new Set(links.filter(c => !idx.has(c)))] };
    });
    console.log(`代号：页面上 ${codes.links} 处，未解释 ${codes.unknown.length} 个，没进索引 ${codes.missing.length} 个`);
    check(!codes.unknown.length, '未解释的代号：' + codes.unknown.join('、'));
    check(!codes.missing.length, '没进代号索引的代号：' + codes.missing.join('、'));
    if (views.length) {
      await p.evaluate(v => setView(v), views[0]); await p.locator('#sec-sandbox').screenshot({ path: 'shot_sandbox.png' });
      const fv = views.find(v => v.startsWith('flow:'));
      if (fv) { await p.evaluate(v => setView(v), fv); await p.locator('#svg').screenshot({ path: 'shot_flow.png' }); }
      const ov = objArg ? 'obj:' + objArg : views.find(v => v.startsWith('obj:'));
      if (ov) { await p.evaluate(v => setView(v), ov); await p.locator('#svg').screenshot({ path: 'shot_ego.png' }); }
      await p.evaluate(v => setView(v), views[0]);
    }
    await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: 'shot_desktop.png' });
    const dupIds = await p.evaluate(() => { const seen = {}, dup = new Set(); document.querySelectorAll('[id]').forEach(e => { if (seen[e.id]) dup.add(e.id); seen[e.id] = 1; }); return [...dup]; });
    console.log('重复的元素 id：', dupIds.length ? dupIds.join('、') : '无');
    check(!dupIds.length, '页面里有重复的元素 id：' + dupIds.join('、'));
    // 折叠的键（data-pk）全页唯一：两个按钮同键会一起开合
    const dupPk = await p.evaluate(() => { const seen = new Set(), dup = new Set(); document.querySelectorAll('#items .mchip[data-pk]').forEach(b => { if (seen.has(b.dataset.pk)) dup.add(b.dataset.pk); seen.add(b.dataset.pk); }); return [...dup]; });
    check(!dupPk.length, '这些折叠按钮的键重复了（会一起开合）：' + dupPk.join('、'));

    // 1b) v3.7 低负担：__lint() 的 errors（形状、诚实、数字出处）一律不通过；budget（字数）在 cfg 的 BUDGET 为 "warn" 时只提示
    const lint = await p.evaluate(() => { if (typeof window.__lint !== 'function') return null; try { return window.__lint(); } catch (e) { return { crash: String(e && e.message || e) }; } });
    const warnOnly = !!(lint && lint.mode === 'warn');
    if (lint && lint.crash) check(false, '__lint() 自己出错了：' + lint.crash);
    else if (lint) {
      const m = x => x < 0.75 ? '不到 1' : String(Math.max(1, Math.round(x)));
      console.log('每张卡默认看到的字 / 预算（图里的字另算）· 估读：');
      lint.load.forEach(x => console.log(`   ${x.id}  ${x.prose}${x.vis ? ` + 图 ${x.vis}` : ''} / ${x.budget} · ${m(x.min)} 分钟（全部展开 ${m(x.allMin)} 分钟）`));
      lint.errors.forEach(e => console.log('   ✗', e));
      check(!lint.errors.length, `数据检查有 ${lint.errors.length} 处问题（见上）`);
      (lint.warnings || []).forEach(e => console.log('   ! 提示：', e));
      lint.budget.forEach(e => console.log(`   ${warnOnly ? '!' : '✗'}`, e));
      if (warnOnly) { if (lint.budget.length) console.log('   （cfg 的 BUDGET 是 "warn"：字数只提示，不算不通过）'); }
      else check(!lint.budget.length, `字数超预算 ${lint.budget.length} 处（见上）`);
    } else check(false, '页面没有 window.__lint：不是 v3.7 的模板');

    // 1c) 推荐不加重：没作答时，推荐的选项和别的选项样式相同，“我的推荐”标签没有底色；没表态的点都显示“待你表态”
    const neutral = await p.evaluate(() => {
      const out = [], sig = el => { const cs = getComputedStyle(el); return [cs.backgroundColor, cs.borderTopColor, cs.borderTopWidth, cs.fontWeight, cs.boxShadow, cs.opacity].join('|'); };
      ITEMS.filter(it => it.opts && recOf(it).length && recOf(it).length < it.opts.length).forEach(it => {
        const card = document.getElementById('card-' + it.id); if (!card) return;
        const rec = recOf(it), opts = [...card.querySelectorAll('.opts > .opt')].filter(o => !o.classList.contains('sel'));
        const isRec = o => rec.includes(o.querySelector('input').id.slice(it.id.length + 1));
        const r = opts.filter(isRec), o = opts.filter(x => !isRec(x));
        if (r.length && o.length && sig(r[0]) !== sig(o[0])) out.push(`${it.id}：推荐的选项样式和别的选项不一样`);
        card.querySelectorAll('.rec').forEach(t => { const bg = getComputedStyle(t).backgroundColor; if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') out.push(`${it.id}：“我的推荐”标签有底色`); });
      });
      const waits = [];
      ITEMS.filter(it => it.kind === 'group').forEach(it => it.points.forEach(pt => {
        const st = ST.items[it.id], v = st && st.points && st.points[pt.id] ? st.points[pt.id].v : null; if (v) return;
        const w = document.querySelector(`#pt-${it.id}-${pt.id} .pt-wait`);
        if (!w || !w.getBoundingClientRect().width || !/待你表态/.test(w.textContent)) waits.push(`${it.id}/${pt.id}`);
      }));
      return { out, waits };
    });
    console.log('推荐不加重：', neutral.out.length ? neutral.out.join('；') : '是', '；没表态的点都显示“待你表态”：', neutral.waits.length ? '缺 ' + neutral.waits.join('、') : '是');
    check(!neutral.out.length, neutral.out.join('；'));
    check(!neutral.waits.length, '这些没表态的点没有显示“待你表态”：' + neutral.waits.join('、'));
    // 点选项的补充或“原文”按钮不会误选这个选项（它们在可点的 label 外面）
    const oc = await p.evaluate(() => { const it = ITEMS.find(x => x._ox && !S(x.id).choice && !S(x.id).multi.length && Object.keys(x._ox).some(k => x._ox[k].more || x._ox[k].up || x._ox[k].then)); if (!it) return null;
      const k = Object.keys(it._ox).find(k => it._ox[k].more) || Object.keys(it._ox).find(k => it._ox[k].up || it._ox[k].then); return { id: it.id, k, more: !!it._ox[k].more }; });
    if (oc) {
      const box = `#card-${oc.id} .opt.optw:has(input[id="${oc.id}-${oc.k}"])`;
      if (await p.locator(`${box} .ox`).count()) await p.locator(`${box} .ox`).first().click();
      if (oc.more) await p.locator(`${box} .mchip`).first().click();
      await p.waitForTimeout(100);
      const r = await p.evaluate(o => ({ choice: S(o.id).choice || S(o.id).multi.join(''), open: [...document.querySelectorAll(`#card-${o.id} .opt.optw .pan`)].some(x => !x.hidden) }), oc);
      console.log(`点选项 ${oc.id} ${oc.k} 的补充${oc.more ? '和“原文”' : ''}：`, r.choice ? `误选了 ${r.choice}` : '没有误选', oc.more ? (r.open ? '；原文展开了' : '；原文没展开') : '');
      check(!r.choice, `点 ${oc.id} 选项 ${oc.k} 的补充或原文时误选了选项`); if (oc.more) check(r.open, `${oc.id} 选项 ${oc.k} 的“原文”按钮点了没展开`);
      if (oc.more) await p.locator(`${box} .mchip`).first().click();
    }

    // 1d) 读得清：条目区、页面速览、审批路线里的字不小于 12px，对比度不低于 4.5:1（大字 3:1）；浅色、深色各查一遍，折叠全开
    for (const scheme of ['light', 'dark']) {
      await p.emulateMedia({ colorScheme: scheme }); await p.waitForTimeout(120);
      const r = await p.evaluate(() => {
        if (typeof OPEN_ALL !== 'undefined' && !OPEN_ALL) toggleOpenAll();
        const rgb = x => { const m = String(x).match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
        const mix = (c, base) => ({ r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a), a: 1 });
        const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const bgOf = el => { const layers = []; for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) { const cs = getComputedStyle(cur); if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; const c = rgb(cs.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
          let base = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : (rgb(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 });
          for (let i = layers.length - 1; i >= 0; i--) base = mix(layers[i], base); return base; };
        const bad = new Set(), small = new Set(), seen = new Set();
        ['items', 'route', 'pbrief'].map(id => document.getElementById(id)).filter(el => el && !el.hidden).forEach(root => {
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          while (w.nextNode()) {
            const n = w.currentNode, el = n.parentElement, t = n.nodeValue.trim(); if (!t || !el || seen.has(el)) continue; seen.add(el);
            if (el.closest('svg,textarea,script,style,[hidden]')) continue;
            const rc = el.getBoundingClientRect(); if (!rc.width || !rc.height) continue;
            const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
            const fs = parseFloat(cs.fontSize), fw = +cs.fontWeight || 400;
            if (fs < 11.95) small.add(`${fs}px「${t.slice(0, 14)}」`);
            const bg = bgOf(el), fg0 = rgb(cs.color); if (!bg || !fg0) continue;
            const fg = fg0.a < 1 ? mix(fg0, bg) : fg0, L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
            if (ratio < ((fs >= 24 || (fs >= 18.66 && fw >= 700)) ? 3 : 4.5) - 0.005) bad.add(`${ratio.toFixed(2)}:1「${t.slice(0, 14)}」（${el.className || el.tagName.toLowerCase()}）`);
          }
        });
        if (OPEN_ALL) toggleOpenAll();
        return { bad: [...bad], small: [...small] };
      });
      const nm = scheme === 'light' ? '浅色' : '深色';
      console.log(`读得清（${nm}）：对比度不够 ${r.bad.length} 处，字小于 12px ${r.small.length} 处`);
      r.bad.slice(0, 10).forEach(x => console.log('   ', x)); r.small.slice(0, 10).forEach(x => console.log('   ', x));
      if (!warnOnly) check(!r.bad.length && !r.small.length, `${nm}下有 ${r.bad.length} 处对比度不够、${r.small.length} 处字小于 12px`);
    }
    await p.emulateMedia({ colorScheme: 'light' }); await p.waitForTimeout(80);
    await p.click('#approveAllBtn'); await p.waitForTimeout(200);
    console.log('一键通过之后：', await p.textContent('#count'));
    const bulk = await p.evaluate(() => {
      const it = ITEMS.find(x => x.kind !== 'group' && x.kind !== 'fill' && S(x.id).status === 'ok'); if (!it) return null;
      const md = buildMD(), i = md.indexOf('### ' + it.id + ' '), j = md.indexOf('\n### ', i + 4), sec = md.slice(i, j > 0 ? j : undefined);
      return { id: it.id, label: !!document.querySelector('#card-' + it.id + ' .how'), md: /全页一键通过/.test(sec) };
    });
    if (bulk) { console.log('一键通过的标记：', JSON.stringify(bulk)); check(bulk.label && bulk.md, `一键通过的 ${bulk.id} 在卡片或导出里没有标出“全页一键通过”`); }
    const v37 = await p.evaluate(() => {
      const nob = ITEMS.filter(it => it.kind === 'group' && it.bulk === false).map(it => ({ id: it.id, filled: it.points.filter(pt => { const st = ST.items[it.id]; return st && st.points && st.points[pt.id] && st.points[pt.id].v; }).length }));
      const md = buildMD(), sec = id => { const i = md.indexOf('### ' + id + ' '), j = md.indexOf('\n### ', i + 4); return md.slice(i, j > 0 ? j : undefined); };
      return { nob, noBrief: ITEMS.filter(it => it.brief && !/- 简报：/.test(sec(it.id))).map(it => it.id), noVis: ITEMS.filter(it => Array.isArray(it.vis) && it.vis.length && !/- 图：/.test(sec(it.id))).map(it => it.id) };
    });
    v37.nob.forEach(x => check(x.filled === 0, `${x.id} 写了 bulk: false，一键通过却填了 ${x.filled} 点`));
    if (v37.nob.length) console.log('bulk: false 的分组一键通过后：', v37.nob.map(x => `${x.id} 填了 ${x.filled} 点`).join('；'));
    check(!v37.noBrief.length, '这些卡有 brief，反馈 md 里却没有“简报”：' + v37.noBrief.join('、'));
    check(!v37.noVis.length, '这些卡有图，反馈 md 里却没有“图”：' + v37.noVis.join('、'));
    const card = p.locator('#items .card').first();
    if (await card.count()) await card.screenshot({ path: 'shot_card.png' });
    console.log('页面错误：', errs.length ? errs : '无');
    check(!errs.length, '页面错误：' + errs.join(' | '));
    const round = await p.evaluate(() => ROUND);
    const key = await p.evaluate(() => ({ key: typeof AD_KEY !== 'undefined' ? AD_KEY : null, project: typeof AD_OPT !== 'undefined' ? AD_OPT.PROJECT || '' : '' }));
    console.log('存储键：', key.key);
    check(key.project && key.key && key.key.startsWith(key.project + '/'), `存储键没有带项目前缀（${key.key}）`);
    await p.close();

    // 2) 托管模式（模拟查看器：window.claude.use 稍后才给出 db 和 downloads；db 按路径规则校验，读到的数据是冻结的）
    // 注入页面的脚本不能带闭包变量，种子数据作为参数传进去
    const hosted = seed => {
      window.__db = seed || {}; window.__saves = [];
      const okPath = p => { const s = String(p).split('/'); return s.length % 2 === 0 && s.every(x => /^[A-Za-z0-9_.~:@+-]+$/.test(x) && x !== '.' && x !== '..'); };
      const freeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } return o; };
      const db = { doc: path => { if (!okPath(path)) throw new TypeError('bad document path: ' + path);
        return { get: async () => ({ exists: path in window.__db, data: () => path in window.__db ? freeze(JSON.parse(JSON.stringify(window.__db[path]))) : undefined }),
                 set: async v => { window.__db[path] = JSON.parse(JSON.stringify(v)); } }; } };
      const downloads = { save: async r => { window.__saves.push(r.filename); return { status: 'saved' }; } };
      window.claude = { use: n => new Promise(res => setTimeout(() => res(n === 'db' ? db : n === 'downloads' ? downloads : null), 150)) };
    };
    const probe = await (async () => { const q = await b.newPage(); await noFonts(q); await q.goto(url); await q.waitForTimeout(300); const r = await q.evaluate(() => ({ id: ITEMS[0].id, key: typeof AD_KEY !== 'undefined' ? AD_KEY : '' })); await q.close(); return r; })();
    const seedDraft = (key, rev, comment) => ({ ['drafts/' + round]: { key, rev, saved_at: '2026-01-01T00:00:00.000Z', answered: '1/x', md: '# x', state: { items: { [probe.id]: { status: 'ok', choice: null, multi: [], comment } }, overall: comment + '（整体意见）', saved_at: '2026-01-01T00:00:00.000Z' } } });
    const readBack = q => q.evaluate(id => ({ overall: document.getElementById('overall').value, comment: (document.getElementById('cm-' + id) || {}).value || '', inert: !!document.getElementById('items').inert, state: (document.getElementById('draft-state') || {}).textContent || '' }), probe.id);
    // 2a) 读完草稿后才能作答；表态后自动存草稿（带本页存储键和修订号）；提交写进 feedback/{ROUND}；另存 md 走 downloads
    p = await b.newPage();
    await p.addInitScript(hosted, {});
    await noFonts(p); await p.goto(url); await p.waitForTimeout(700);
    const gate = await readBack(p);
    check(!gate.inert, '读完草稿后作答区仍然不能点');
    await p.click('#approveAllBtn'); await p.waitForTimeout(2200);
    const draft = await p.evaluate(r => window.__db['drafts/' + r], round);
    console.log('托管模式：草稿', draft ? `${draft.answered}，rev ${draft.rev}，md ${draft.md.length} 字` : '没有');
    check(draft && draft.state && draft.key === probe.key && draft.rev >= 1 && typeof draft.md === 'string' && draft.md.startsWith('# '), `托管模式没有把草稿（带存储键和修订号）存进 drafts/${round}`);
    await p.click('#exportBtn'); await p.waitForTimeout(500);
    const doc = await p.evaluate(r => window.__db['feedback/' + r], round);
    console.log('托管模式：提交', doc ? doc.filename : '没有');
    check(doc && typeof doc.md === 'string' && doc.md.startsWith('# '), `托管模式没有把 md 写进 feedback/${round}`);
    const lb = await p.evaluate(() => { const b = document.getElementById('localExportBtn'); return b ? { text: b.textContent, hidden: b.hidden } : null; });
    if (lb && !lb.hidden) { await p.click('#localExportBtn'); await p.waitForTimeout(300); }
    const saves = await p.evaluate(() => window.__saves);
    console.log('托管模式：另存按钮', lb ? lb.text : '（页面没有这个按钮）', '| 另存', saves);
    check(!lb || (/另存/.test(lb.text) && !lb.hidden && saves.length === 1 && /_feedback\.md$/.test(saves[0])), '托管模式的“另存一份 md”没有走 downloads');
    await p.close();
    // 2b) 换一台设备：数据库里有修订号更新、存储键相同的草稿，打开页面就接着用
    p = await b.newPage();
    await p.addInitScript(hosted, seedDraft(probe.key, 3, '来自草稿'));
    await noFonts(p); await p.goto(url); await p.waitForTimeout(900);
    const restored = await readBack(p);
    console.log('托管模式：接着草稿', JSON.stringify({ overall: restored.overall, comment: restored.comment }));
    check(restored.overall === '来自草稿（整体意见）' && restored.comment === '来自草稿', '托管模式没有接着数据库里更新的草稿');
    // 2c) 接着草稿之后，另一台设备又存了一版（修订号变大）：这台设备再表态时不覆盖它
    await p.evaluate(r => { const d = JSON.parse(JSON.stringify(window.__db['drafts/' + r])); d.rev = 9; d.answered = '别处'; window.__db['drafts/' + r] = d; }, round);
    await p.click('#approveAllBtn'); await p.waitForTimeout(2200);
    const after = await p.evaluate(r => window.__db['drafts/' + r], round), stale = await readBack(p);
    console.log('托管模式：别处有更新的草稿时', `rev ${after.rev}`, stale.state);
    check(after.rev === 9 && after.answered === '别处' && /别处有更新的草稿/.test(stale.state), '别处有更新的草稿时，这台设备仍然覆盖了它');
    await p.close();
    // 2d) 存储键不同的草稿（例如改了题目、升级了 KEY）不接着用
    p = await b.newPage();
    await p.addInitScript(hosted, seedDraft('other-project/R00-feedback-v1', 7, '别的键'));
    await noFonts(p); await p.goto(url); await p.waitForTimeout(900);
    const other = await readBack(p);
    console.log('托管模式：存储键不同的草稿', JSON.stringify({ overall: other.overall, comment: other.comment }));
    check(other.overall === '' && other.comment === '', '存储键不同的草稿也被接着用了');
    await p.close();
    // 2e) 查看器里连不上数据库：如实提示没提交成功，不下载
    p = await b.newPage({ acceptDownloads: true });
    await p.addInitScript(() => { window.claude = { use: async () => null }; });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(400);
    const dl0 = []; p.on('download', d => dl0.push(d.suggestedFilename()));
    await p.click('#exportBtn'); await p.waitForTimeout(800);
    const failMsg = await p.evaluate(() => (document.getElementById('save-target') || {}).textContent || '');
    console.log('托管模式：连不上数据库时', failMsg.slice(0, 40), '| 下载', dl0.length);
    check(/没有提交成功/.test(failMsg) && dl0.length === 0, '连不上数据库时没有如实提示，或者仍在下载');
    await p.close();
    // 2f–2q) v3.7.2 网络断了或不稳：数据库调用失败（unavailable）或迟迟不回应。等待时长用 window.__AD_TIMING 缩短（只给自检用）
    // opt：{feedback / drafts: 头几次写入失败的次数或 'all', hang: 失败改成一直不回应, code: 失败时的错误码, readDelay: 读要多久,
    //       setDelay: 写反馈要多久, seed: 数据库里预先有的文档}；window.__heal = true 表示网络恢复，window.__down = true 表示网络断开
    const flaky = opt => {
      window.__AD_TIMING = { draftDelayMs: 120, attemptMs: 300, draftReadMs: 300, quickRetryMs: 30, submitDelaysMs: [80, 80, 80], submitWaitMs: 1200, draftRetryMs: [150, 150] };
      window.__db = opt.seed ? JSON.parse(JSON.stringify(opt.seed)) : {}; window.__saves = []; window.__calls = {}; window.__heal = false; window.__down = false;
      window.__inflight = {}; window.__maxInflight = 0;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const db = { doc: path => ({
        get: async () => { if (opt.readDelay) await sleep(opt.readDelay); return { exists: path in window.__db, data: () => path in window.__db ? JSON.parse(JSON.stringify(window.__db[path])) : undefined }; },
        set: async v => {
          const kind = path.split('/')[0]; window.__calls[kind] = (window.__calls[kind] || 0) + 1;
          window.__inflight[path] = (window.__inflight[path] || 0) + 1; window.__maxInflight = Math.max(window.__maxInflight, window.__inflight[path]);
          try {
            const fail = window.__down || (!window.__heal && (opt[kind] === 'all' || window.__calls[kind] <= (opt[kind] || 0)));
            if (fail && opt.hang) await new Promise(() => {});
            if (opt.setDelay && kind === 'feedback') await sleep(opt.setDelay);
            if (fail) throw { code: opt.code || 'unavailable', message: 'network down (test)' };
            window.__db[path] = JSON.parse(JSON.stringify(v));
          } finally { window.__inflight[path]--; }
        } }) };
      const downloads = { save: async r => { window.__saves.push(r.filename); return { status: 'saved' }; } };
      window.claude = { use: n => new Promise(res => setTimeout(() => res(n === 'db' ? db : n === 'downloads' ? downloads : null), 50)) };
    };
    const netView = q => q.evaluate(r => ({ target: (document.getElementById('save-target') || {}).textContent || '', draft: (document.getElementById('draft-state') || {}).textContent || '', btn: document.getElementById('exportBtn').textContent, calls: window.__calls, fb: window.__db['feedback/' + r] || null, dr: window.__db['drafts/' + r] || null, saves: window.__saves.slice(), maxInflight: window.__maxInflight, overall: document.getElementById('overall').value }), round);
    let nv;
    // 2f) 提交头两次连不上：自动重试后送达，状态行说重试了几次；托管模式的提交按钮不写“导出”
    p = await b.newPage();
    await p.addInitScript(flaky, { feedback: 2 });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(500);
    await p.click('#exportBtn'); await p.waitForTimeout(900);
    nv = await netView(p);
    console.log('网络不稳（提交头两次失败）：', nv.fb ? '送达' : '没送达', `| 写了 ${nv.calls.feedback || 0} 次 |`, nv.target.slice(0, 36), '| 按钮', nv.btn);
    check(nv.fb && nv.calls.feedback === 3 && /已提交/.test(nv.target) && /重试 2 次/.test(nv.target), '网络不稳时提交没有自动重试送达（或者状态行没说重试了几次）');
    check(!/导出/.test(nv.btn), `托管模式的提交按钮仍写着“导出”（${nv.btn}）`);
    await p.close();
    // 2g) 一直连不上：重试完如实说没提交成功，原地给出再试、另存、复制，不下载；原地的另存走 downloads；网络恢复后点“再试一次”送达
    p = await b.newPage({ acceptDownloads: true });
    await p.addInitScript(flaky, { feedback: 'all' });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(500);
    const dlNet = []; p.on('download', d => dlNet.push(d.suggestedFilename()));
    await p.click('#exportBtn'); await p.waitForTimeout(1000);
    nv = await netView(p);
    const panelBtns = await p.evaluate(() => [...document.querySelectorAll('#save-target button')].map(x => x.textContent));
    console.log('网络一直不通：', nv.target.slice(0, 44), '| 原地按钮', panelBtns.join('、'), `| 写了 ${nv.calls.feedback || 0} 次 | 下载 ${dlNet.length}`);
    check(/没有提交成功/.test(nv.target) && !nv.fb && nv.calls.feedback === 4 && dlNet.length === 0, '网络一直不通时没有重试 3 次后如实说没提交成功，或者下载了文件');
    check(['再试一次', '另存', '复制'].every(k => panelBtns.some(t => t.includes(k))), '没提交成功时没有在原地给出“再试一次”“另存”“复制”');
    await p.locator('#save-target button', { hasText: '另存' }).click(); await p.waitForTimeout(300);
    nv = await netView(p);
    check(nv.saves.length === 1 && /_feedback\.md$/.test(nv.saves[0]), '没提交成功时原地的“另存”没有走 downloads');
    await p.evaluate(() => { window.__heal = true; });
    await p.locator('#save-target button', { hasText: '再试一次' }).click(); await p.waitForTimeout(500);
    nv = await netView(p);
    console.log('网络恢复后点“再试一次”：', nv.fb ? '送达' : '没送达', '|', nv.target.slice(0, 20));
    check(nv.fb && /已提交/.test(nv.target), '网络恢复后点“再试一次提交”没有送达');
    await p.close();
    // 2h) 数据库一直不回应（请求挂住）：不另发一笔（同一文档同时只有一笔写入），等够 submitWaitMs 才如实说明；再点“再试一次”也只排在后面
    p = await b.newPage();
    await p.addInitScript(flaky, { feedback: 'all', hang: true });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(500);
    await p.click('#exportBtn'); await p.waitForTimeout(600);
    nv = await netView(p);
    const slowText = nv.target;
    await p.waitForTimeout(1100);
    nv = await netView(p);
    console.log('数据库一直不回应：', slowText.slice(0, 24), '→', nv.target.slice(0, 40), `| 写了 ${nv.calls.feedback || 0} 次，同时最多 ${nv.maxInflight} 笔`);
    check(/接着等/.test(slowText) && /没有提交成功/.test(nv.target) && /没有回应/.test(nv.target), '数据库一直不回应时没有先说在接着等、最后如实说明');
    check(nv.calls.feedback === 1 && nv.maxInflight === 1, `数据库不回应时又另发了写入（写了 ${nv.calls.feedback} 次，同时最多 ${nv.maxInflight} 笔）`);
    await p.locator('#save-target button', { hasText: '再试一次' }).click(); await p.waitForTimeout(300);
    nv = await netView(p);
    check(nv.calls.feedback === 1 && nv.maxInflight === 1, '点“再试一次”时前一笔还没落地，却又同时发了一笔写入');
    await p.close();
    // 2i) 存草稿时连不上：不用再表态也会自动补存；连续两次没存上就在提交区提前提醒；网络恢复后补存成功、提醒消失
    p = await b.newPage();
    await p.addInitScript(flaky, { drafts: 'all' });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(500);
    await p.click('#approveAllBtn'); await p.waitForTimeout(1000);
    nv = await netView(p);
    console.log('存草稿时连不上：', nv.draft, '|', nv.target.slice(0, 20), `| 写了 ${nv.calls.drafts || 0} 次，同时最多 ${nv.maxInflight} 笔`);
    check(/自动再存/.test(nv.draft) && /草稿暂时存不上/.test(nv.target) && /自动再试/.test(nv.target) && !nv.dr, '草稿没存上时没有自动补存的提示，或者提交区没有提前提醒');
    check(nv.maxInflight <= 1, `存草稿时同一文档同时有 ${nv.maxInflight} 笔写入`);
    await p.evaluate(() => { window.__heal = true; });
    await p.waitForTimeout(800);
    nv = await netView(p);
    console.log('网络恢复后：', nv.draft, '|', nv.target.slice(0, 20));
    check(nv.dr && /草稿已存/.test(nv.draft) && !/草稿暂时存不上/.test(nv.target), '网络恢复后草稿没有自动补存，或者提前提醒没有消失');
    await p.close();
    // 2j) 反馈超过数据库单条 256 KiB 的上限：不写数据库，直接说明并给出另存
    p = await b.newPage();
    await p.addInitScript(flaky, {});
    await noFonts(p); await p.goto(url); await p.waitForTimeout(500);
    await p.evaluate(() => { const big = '字'.repeat(90000); window.buildMD = () => '# 很长的反馈\n' + big; });
    await p.click('#exportBtn'); await p.waitForTimeout(400);
    nv = await netView(p);
    console.log('反馈超过 256 KiB：', nv.target.slice(0, 44), `| 写了 ${nv.calls.feedback || 0} 次`);
    check(/没有提交成功/.test(nv.target) && /256 KiB/.test(nv.target) && !nv.calls.feedback, '反馈超过 256 KiB 时没有直接说明，或者仍然写了数据库');
    await p.close();
    // 2k) 打开时读草稿迟迟没回应：先放开作答；那一次读迟到的结果照样接上（别的设备存的更新草稿，审批人还没在这台设备上答）
    p = await b.newPage();
    await p.addInitScript(flaky, { seed: seedDraft(probe.key, 7, '设备B'), readDelay: 600 });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(400);
    const openGate = await readBack(p);
    await p.waitForTimeout(600);
    nv = await netView(p);
    console.log('读草稿迟到：', openGate.inert ? '作答区还锁着' : '作答区已放开', '|', openGate.state, '→', nv.draft, '|', nv.overall);
    check(!openGate.inert && /草稿暂时读不到/.test(openGate.state) && nv.overall === '设备B（整体意见）', '读草稿迟迟没回应时没有先放开作答，或者迟到的草稿没有接上');
    await p.close();
    // 2l) 读草稿迟到、审批人已在这台设备上答过，别处的草稿更新：不提交这台设备上的旧回答，让审批人选；换成那份草稿后再提交
    p = await b.newPage();
    await p.addInitScript(flaky, { seed: seedDraft(probe.key, 7, '设备B'), readDelay: 600 });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(450);
    await p.click('#approveAllBtn'); await p.waitForTimeout(500);
    await p.click('#exportBtn'); await p.waitForTimeout(300);
    nv = await netView(p);
    const newerBtns = await p.evaluate(() => [...document.querySelectorAll('#save-target button')].map(x => x.textContent));
    console.log('别处有更新的草稿时点提交：', nv.target.slice(0, 36), '| 原地按钮', newerBtns.join('、'), `| 反馈 ${nv.fb ? '写了' : '没写'}`);
    check(!nv.fb && /还没提交/.test(nv.target) && newerBtns.some(t => t.includes('换成那份草稿')) && newerBtns.some(t => t.includes('仍然提交')), '别处有更新的草稿时仍然提交了这台设备上的旧回答，或者没有让审批人选');
    await p.locator('#save-target button', { hasText: '换成那份草稿' }).click(); await p.waitForTimeout(300);
    await p.click('#exportBtn'); await p.waitForTimeout(500);
    nv = await netView(p);
    check(nv.fb && /设备B/.test(nv.fb.md) && /已提交/.test(nv.target), '换成别处的草稿后再提交，提交的不是那份草稿的回答');
    await p.close();
    // 2m) 之前提交成功、改了回答、再提交时网络断了：如实说数据库里还是上次的旧版本，另存的这份更新
    p = await b.newPage();
    await p.addInitScript(flaky, {});
    await noFonts(p); await p.goto(url); await p.waitForTimeout(500);
    await p.click('#exportBtn'); await p.waitForTimeout(400);
    await p.click('#approveAllBtn'); await p.waitForTimeout(300);
    const changedText = (await netView(p)).target;
    await p.evaluate(() => { window.__down = true; });
    await p.click('#exportBtn'); await p.waitForTimeout(1000);
    nv = await netView(p);
    console.log('再提交没成功：', changedText.slice(0, 20), '→', nv.target.slice(0, 60));
    check(/又改过回答/.test(changedText) && /没有提交成功/.test(nv.target) && /旧版本/.test(nv.target), '再提交没成功时没有说明数据库里还是上次的旧版本');
    await p.close();
    // 2n) 提交途中又改了回答：送达后提醒再提交一次
    p = await b.newPage();
    await p.addInitScript(flaky, { setDelay: 500 });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(500);
    await p.click('#exportBtn'); await p.waitForTimeout(150);
    await p.click('#approveAllBtn'); await p.waitForTimeout(700);
    nv = await netView(p);
    console.log('提交途中改了回答：', nv.target.slice(0, 50));
    check(/已提交/.test(nv.target) && /又改过回答/.test(nv.target), '提交途中改了回答，送达后没有提醒再提交一次');
    await p.close();
    // 2o) 草稿写入被 revoked 拒绝：停止存草稿、说提交不会成功，但不解释是什么权限（契约：不替外层解释）
    p = await b.newPage();
    await p.addInitScript(flaky, { drafts: 'all', code: 'revoked' });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(500);
    await p.click('#approveAllBtn'); await p.waitForTimeout(600);
    nv = await netView(p);
    console.log('草稿被 revoked：', nv.draft, '|', nv.target.slice(0, 40));
    check(/草稿存不了/.test(nv.draft) && /不会成功/.test(nv.target) && !/查看权限/.test(nv.target), 'revoked 时没有停止存草稿，或者解释了权限原因');
    await p.close();
    // 2p) 回答本身就超过单条 256 KiB：草稿不发（免得被当成没有写权限），改短后照常存
    p = await b.newPage();
    await p.addInitScript(flaky, {});
    await noFonts(p); await p.goto(url); await p.waitForTimeout(500);
    await p.evaluate(() => { ST.overall = '字'.repeat(90000); save(); });
    await p.waitForTimeout(500);
    nv = await netView(p);
    console.log('回答超过 256 KiB：', nv.draft.slice(0, 30), `| 草稿写了 ${nv.calls.drafts || 0} 次 |`, nv.target.slice(0, 30));
    check(!nv.calls.drafts && /256 KiB/.test(nv.draft) && !/查看权限/.test(nv.target), '回答超过 256 KiB 时仍然发了草稿，或者被说成没有写权限');
    await p.evaluate(() => { ST.overall = '短'; save(); });
    await p.waitForTimeout(500);
    nv = await netView(p);
    check(nv.dr && /草稿已存/.test(nv.draft), '回答改短后草稿没有照常存');
    await p.close();

    // 3) 本地模式：File System Access API 只写一个 md
    p = await b.newPage();
    await p.addInitScript(() => {
      window.__w = [];
      window.showDirectoryPicker = async () => ({ name: (typeof EXPORT_CFG !== 'undefined' ? EXPORT_CFG.expectedDirName : 'reviews'), queryPermission: async () => 'granted', requestPermission: async () => 'granted', getFileHandle: async n => ({ createWritable: async () => ({ write: async t => window.__w.push([n, t.length]), close: async () => {} }) }) });
    });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(400);
    const localLabel = await p.evaluate(() => document.getElementById('exportBtn').textContent);
    check(/导出 md/.test(localLabel), `本地模式的提交按钮应写“导出 md”（${localLabel}）`);
    await p.click('#exportBtn'); await p.waitForTimeout(400);
    const w = await p.evaluate(() => window.__w);
    console.log('本地模式：写入', JSON.stringify(w));
    check(w.length === 1 && /_feedback\.md$/.test(w[0][0]), '本地模式没有只写一个 md');
    await p.close();

    // 4) 兜底：恰好下载一个 md
    p = await b.newPage({ acceptDownloads: true });
    await p.addInitScript(() => { delete window.showDirectoryPicker; });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(400);
    const dls = []; p.on('download', d => dls.push(d.suggestedFilename()));
    await p.click('#exportBtn'); await p.waitForTimeout(1500);
    console.log('兜底下载：', dls.length ? dls.join('、') : '没有下载');
    check(dls.length === 1 && /_feedback\.md$/.test(dls[0]), `兜底应恰好下载 1 个 md，实际 ${dls.length} 个`);
    await p.close();

    // 5) 手机宽度：400px 不横向溢出；v3.7 起再看 375px 和 360px，折叠全开时图、四格、对照、参考表、路线里的字不溢出自己的框
    p = await b.newPage({ viewport: { width: 400, height: 860 } });
    await noFonts(p); await p.goto(url); await p.waitForTimeout(300);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    console.log(`手机宽度：横向溢出 ${over}px`);
    check(over <= 0, `手机宽度横向溢出 ${over}px`);
    await p.screenshot({ path: 'shot_mobile.png' });
    await p.close();
    for (const width of [375, 360]) {
      p = await b.newPage({ viewport: { width, height: 860 } });
      await noFonts(p); await p.goto(url); await p.waitForTimeout(300);
      const r = await p.evaluate(() => {
        if (typeof OPEN_ALL !== 'undefined' && !OPEN_ALL) toggleOpenAll();
        const spill = [];
        document.querySelectorAll('#items .card, #items .vis, #items .vis *, #items .frame *, #items .pdiff *, #items .rtbl, #items .opts *, #items .lmap, #route *, #pbrief *').forEach(el => {
          if (el.closest('[hidden]') || !el.getBoundingClientRect().width) return;
          const cs = getComputedStyle(el); if (cs.overflowX !== 'visible') return;
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) spill.push(`${el.className || el.tagName.toLowerCase()}「${(el.textContent || '').trim().slice(0, 12)}」`);
        });
        return { over: document.documentElement.scrollWidth - innerWidth, spill: [...new Set(spill)] };
      });
      console.log(`${width}px：横向溢出 ${r.over}px，框里溢出 ${r.spill.length} 处${r.spill.length ? '：' + r.spill.slice(0, 6).join('、') : ''}`);
      if (warnOnly) { if (r.over > 0 || r.spill.length) console.log('   （cfg 的 BUDGET 是 "warn"：375px / 360px 只提示）'); }
      else check(r.over <= 0 && !r.spill.length, `${width}px 宽时横向溢出 ${r.over}px，框里溢出 ${r.spill.length} 处`);
      if (width === 375) await p.screenshot({ path: 'shot_mobile_375.png', fullPage: true });
      await p.close();
    }
  } finally { await b.close(); }
  if (fails.length) { console.log('\n✗ 不通过：\n- ' + fails.join('\n- ')); process.exitCode = 1; }
  else console.log('\n✓ 全部通过');
})().catch(e => { console.error(e); process.exit(1); });
