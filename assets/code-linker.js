// ===================== Approval Desk Code Linker v1 (2026-11-11; 2026-11-17 修订：代号形状可配置；2026-11-18：label / button / summary 里的代号不做成链接) =====================
// 让页面里出现的每个代号（D-009、M5、R03-07、INV-04、FR-TASK-04、N1……）都带悬浮解释，并汇总到"代号索引"。
// 依赖：CODES = { "代号": ["标题", "说明", "出处"] }（由 scripts/build_codes.py 生成，每轮再 Object.assign 补本地代号）。
// 可选：CODE_SHAPES = ["正则源码", …]（只有用 build_codes.py --shapes 时才写进 codes.js）。"像代号却不在 CODES 里"的判断按它来；
//       没有时用下面的默认形状（与 build_codes.py 的 DEFAULT_SHAPES 保持一致）。无效或能匹配空串的形状会被忽略并在控制台报错。
// 页面需提供：<div id="code-index"></div>（附录里）和一个悬浮框 #tip（或改 AD_TIP_ID）。
// 用法：每次渲染完一块内容后调用 adLinkCodes(该块根节点)；最后调用 adRenderCodeIndex()。
const AD_TIP_ID = "tip";
const adEsc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const AD_DEFAULT_SHAPES = ["[A-Z]{1,3}-[A-Z]+-\\d{2}", "[A-Z]{1,3}-\\d{2,3}", "R\\d{2}-\\d{2}", "[A-Z]{1,2}\\d{1,2}"];
const AD_SHAPES = (() => {
  const raw = (typeof CODE_SHAPES !== "undefined" && Array.isArray(CODE_SHAPES)) ? CODE_SHAPES : [];
  const ok = raw.filter(p => {
    if (typeof p !== "string" || !p) return false;
    try { new RegExp(p); if (!new RegExp("^(?:" + p + ")$").test("")) return true; } catch (e) {}
    console.error("[approval-desk] CODE_SHAPES 里有无效的形状，已忽略：" + p); return false;
  });
  return ok.length ? ok : AD_DEFAULT_SHAPES;
})();
const AD_CODE_KEYS = Object.keys(CODES).filter(k => k).sort((a, b) => b.length - a.length);
const AD_CODE_SRC = AD_CODE_KEYS.length ? "(?<![A-Za-z0-9-])(" + AD_CODE_KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![A-Za-z0-9-])" : null;
const AD_SUSPECT_SRC = "(?<![A-Za-z0-9-])(?:" + AD_SHAPES.join("|") + ")(?![A-Za-z0-9-])";
const adUsedCodes = new Set();
window.__unknownCodes = new Set();
function adLinkCodes(root) {
  if (!root) return;
  const known = AD_CODE_SRC ? new RegExp(AD_CODE_SRC) : null, suspect = new RegExp(AD_SUSPECT_SRC, "g");
  const skip = "a,script,style,textarea,svg,#code-index,#" + AD_TIP_ID + ",.no-code-link";
  const nodes = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && !n.parentElement.closest(skip)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach(n => {
    const t = n.nodeValue;
    (t.match(suspect) || []).forEach(s => { if (!CODES[s]) window.__unknownCodes.add(s); });
    if (!known || !known.test(t)) return;
    const frag = document.createDocumentFragment(); let last = 0; const re = new RegExp(AD_CODE_SRC, "g"); let m;
    while ((m = re.exec(t))) {
      if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
      /* 在 label、button、summary 里不做成链接（点选项、点折叠芯片时不该跳到附录）；悬浮解释照常，代号照常进索引 */
      const inert = n.parentElement && n.parentElement.closest("label,button,summary");
      const a = document.createElement(inert ? "span" : "a"); a.className = "code"; a.dataset.c = m[1]; if (!inert) a.href = "#c-" + m[1]; a.textContent = m[1];
      frag.appendChild(a); adUsedCodes.add(m[1]); last = m.index + m[1].length;
    }
    if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
    n.parentNode.replaceChild(frag, n);
  });
  // 已有的来源链接（a.src[data-s]）也计入索引
  root.querySelectorAll && root.querySelectorAll("a[data-s]").forEach(a => { if (CODES[a.dataset.s]) adUsedCodes.add(a.dataset.s); });
}
function adCodeOrder(a, b) { return a.localeCompare(b, "en", { numeric: true }); }
function adRenderCodeIndex() {
  const box = document.getElementById("code-index"); if (!box) return;
  const list = [...adUsedCodes].sort(adCodeOrder);
  box.innerHTML = list.length ? list.map(c => { const [t, d, s] = CODES[c]; return `<div class="ci" id="c-${adEsc(c)}"><b>${adEsc(c)}</b><span><strong>${adEsc(t)}</strong>${d ? "：" + adEsc(d) : ""}${s ? `<i>出处：${adEsc(s)}</i>` : ""}</span></div>`; }).join("") : "<p>本页没有使用代号。</p>";
}
function adCodeTip(el) { const v = CODES[el.dataset.c]; if (!v) return null; return `<b>${adEsc(el.dataset.c)} · ${adEsc(v[0])}</b>${adEsc(v[1] || "")}${v[2] ? `<i>出处：${adEsc(v[2])}</i>` : ""}`; }
// ===================== End Code Linker v1 =====================
