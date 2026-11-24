// ===================== Approval Desk Export Module v5 (2026-11-23) =====================
// 只导出 Markdown（不导出 JSON）。依赖页面里已有的：ROUND, TOPIC, buildMD(), showToast(msg)
// 可选：PROPOSAL_FILE；AD_CFG（build.py 从 cfg 注入：PROJECT、REVIEW_DIR、REVIEW_PATH_HINT、PROPOSAL_FILE）；
//       模板提供的 AD_KEY、adGetState()、adSetState(state)、adPersistState()（都有才在托管模式下存草稿）。
// 托管模式（页面作为 claude.ai Artifact 发布，声明 capabilities {db: {}, downloads: true}；查看器里才有 window.claude.use）：
//   - 「提交反馈」→ 把 Markdown 写入数据库 feedback/{ROUND}；用户在对话里说「反馈完成」→ Claude 读取它，写入评审文件夹。
//     托管模式里这个按钮只写数据库、不下载文件，所以按钮上不写“导出 md”（本地文件里才写）。
//   - v5：数据库的每次调用都要经过网络。网络断了或不稳时，调用会失败（unavailable）或迟迟没有回应。
//     · 同一文档一次只写一笔（契约：await each set before the next to the same document）：一笔写入没回应时不另发一笔，接着等它；
//       它失败了（会过去的错误）才隔一会儿重发：提交按 submitDelaysMs 的间隔，最多等 submitWaitMs；状态行写着为什么、在等什么。
//       等太久才说“没有提交成功”，并在原地给出「再试一次提交」「另存一份 md 到本机」「复制」；那一笔后来落地了，状态改成已提交。
//     · 会过去的错误：unavailable、resource_exhausted、超时、没有 code 的（TypeError 除外，那是路径写错）和不认识的 code（契约要求当作 unavailable）。
//       不会过去的：invalid_argument、quota_exceeded、revoked，以及运行时的 not_granted、capability_disabled、capability_removed、transform_error。
//     · 单个文档超过 256 KiB 数据库会拒收：提交前先量，超了直接说明并给出另存；草稿超了先去掉 md 那一段，还超就这次不存。
//     · 读（get）不写数据，可以超时后再读一次。
//   - 草稿 drafts/{ROUND}：{round, topic, key, rev, saved_at, answered, md, state}。打开页面时先读草稿（最多 draftReadMs，这段时间暂停作答），
//     草稿的修订号 rev 比这台设备上回答所依据的修订号新、且 key 与本页存储键相同，就接着用；之后每次表态停 draftDelayMs 存一次，
//     存之前再读一次：别的窗口或设备在这之后存过（rev 更大），就不覆盖，提示刷新。新旧只看 rev，不看设备时钟。
//     v5：打开时读不到或迟迟没回应，先放开作答、这次先不存草稿，那一次读的结果迟到了照样接上；读失败就按 draftRetryMs 在后台再读；
//     还没读到之前点提交，先核对一次草稿：别处有更新的就不提交，让审批人选“换成那份草稿”或“仍然提交这台设备上的回答”。
//     存草稿遇到会过去的错误，按 draftRetryMs 的间隔自动补存（之后一直按最后一个间隔），浏览器报告网络恢复时马上补存；
//     连续两次没存上（或打开时就读不到草稿），提交区提前提醒：草稿暂时存不上，提交也可能失败，可以先另存一份。
//     数据库拒绝写入就停止存草稿，并说明提交不会成功（只有 invalid_argument 才说“多半是只有查看权限”；revoked 不解释原因）。
//   - 「另存一份 md 到本机」用 downloads 能力（查看者确认后才保存，在本机完成，不经网络）；这个能力不可用时不显示按钮。
//   - 查看器里拿不到数据库（use("db") 给 null：网络不通、没有登录、在查看器外打开，或发布时没有声明 db）时明确说“没有提交成功”，
//     不假装已经下载；use() 的结果在这次打开页面期间不会变，网络恢复后要刷新页面。
//   - 数据库里的反馈可能不是最新的（之前提交过、后来再提交没成功、另存了一份）：提示审批人另存的那份更新；
//     Claude 取反馈时比较数据库和评审文件夹、“下载”文件夹里各份的“导出时间”，用最新的一份（SKILL.md 第 4 步）。
// 本地文件（没有 window.claude）：
//   - Chrome/Edge：File System Access API 写入记住的评审文件夹（第一次选一次）；
//   - 其他浏览器或预览窗口：下载 1 个 .md，同时复制到剪贴板。
// 记住的文件夹、文件夹选择框的记忆都带 AD_CFG.PROJECT 前缀；没有 PROJECT 的旧页面沿用旧键。
// window.__AD_TIMING 只给自检用（缩短等待），页面和数据里不要设它。
const AD_EXPORT_OPT = (typeof AD_CFG !== "undefined" && AD_CFG) || {};
const AD_EXPORT_PROJECT = String(AD_EXPORT_OPT.PROJECT || "");
const AD_TIMING = Object.assign({
  draftDelayMs: 1500,                                        // 表态后停多久存草稿
  attemptMs: 12000,                                          // 一次读写多久没回应就在状态行说明（写入不会因此另发一笔）
  draftReadMs: 8000,                                         // 打开页面读草稿最多等多久（这段时间作答区暂停）
  quickRetryMs: 500,                                         // 读草稿失败后，马上再读一次前大约等多久
  submitDelaysMs: [1000, 3000, 6000, 10000, 20000, 30000],   // 提交失败后，每次重发前等多久
  submitWaitMs: 90000,                                       // 一次提交最多等多久，过了才说没有提交成功
  draftRetryMs: [5000, 15000, 30000, 60000]                  // 草稿没存上或没读到时再试的间隔，之后一直按最后一个
}, (window.__AD_TIMING && typeof window.__AD_TIMING === "object") ? window.__AD_TIMING : {});
const AD_DOC_MAX = 256 * 1024 - 2048;   // 数据库单个文档最多 256 KiB（序列化后），留一点余量
const EXPORT_CFG = {
  dbName: "approval-desk", store: "handles",
  key: AD_EXPORT_PROJECT ? `${AD_EXPORT_PROJECT}/reviews-dir` : "reviews-dir",
  // 选择框的 id 只能用字母、数字、_、-，最长 32 个字符（build.py 把 PROJECT 限制在 24 个字符以内）
  pickerId: AD_EXPORT_PROJECT ? `${AD_EXPORT_PROJECT.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 24)}-reviews` : "approval-desk-reviews",
  // 评审文件夹：去掉 "."、空段和首尾斜杠；空串表示项目根目录（这时不核对文件夹名）
  reviewDir: (AD_EXPORT_OPT.REVIEW_DIR !== undefined ? String(AD_EXPORT_OPT.REVIEW_DIR) : "interview/reviews").split(/[\\/]+/).filter(p => p && p !== ".").join("/"),
  expectedDirName: "", expectedPathHint: "", proposalFile: AD_EXPORT_OPT.PROPOSAL_FILE || "",
  draftPath: `drafts/${ROUND}`, draftDelayMs: AD_TIMING.draftDelayMs
};
EXPORT_CFG.expectedDirName = EXPORT_CFG.reviewDir.split("/").pop() || "";
EXPORT_CFG.expectedPathHint = AD_EXPORT_OPT.REVIEW_PATH_HINT || EXPORT_CFG.reviewDir || "项目根目录";
const AD_VIEWER = !!(window.claude && typeof window.claude.use === "function");
const AD_DRAFTS = AD_VIEWER && typeof AD_KEY !== "undefined" && typeof adGetState === "function" && typeof adSetState === "function" && typeof adPersistState === "function";
let adHostedDb = null, adDbSettled = !AD_VIEWER, adDownloads = null, adNoWrite = "", adSubmitting = false;
let adDraftOn = false, adDraftBase = 0, adDraftTimer = null, adDraftBusy = false, adDraftAgain = false, adDraftAdopted = 0;
let adDraftFails = 0, adDraftRetryTimer = null, adDbTrouble = "", adDraftSent = null, adDraftTooBig = 0;
let adDraftReadOk = !AD_DRAFTS, adDraftReadTimer = null, adDraftReadFails = 0, adDraftOpenSavedAt = "", adDraftNewer = null;
let adSubmitView = null, adSubmitOk = false, adSubmitAt = "", adSubmitSeq = 0;
let adDraftCheckDone = null;
const adDraftChecked = new Promise(r => { adDraftCheckDone = r; });

// ---- 错误怎么分、怎么说给审批人听 ----
const AD_DB_CODES = ["invalid_argument", "resource_exhausted", "quota_exceeded", "unavailable", "revoked", "not_granted", "capability_disabled", "capability_removed", "transform_error"];
function adErrCode(e) { return e && typeof e === "object" && typeof e.code === "string" ? e.code : ""; }
function adErrLabel(e) { return adErrCode(e) || (e && e.name) || "unknown"; }
function adRetryable(e) {
  const c = adErrCode(e);
  if (!c) return !(e instanceof TypeError);
  return c === "unavailable" || c === "resource_exhausted" || c === "timeout" || !AD_DB_CODES.includes(c);
}
function adWhy(e) {
  const c = adErrCode(e);
  if (c === "timeout") return "数据库太久没有回应（多半是网络不通或很慢）";
  if (c === "resource_exhausted") return "数据库暂时太忙（请求太频繁）";
  if (c === "invalid_argument") return "数据库拒绝了这次写入（多半是你对这个页面只有查看权限）";
  if (c === "quota_exceeded") return "这个页面的数据库存满了";
  if (c === "revoked") return "现在不能把反馈存进本页的数据库";
  if (c === "not_granted" || c === "capability_disabled" || c === "capability_removed") return "这个查看器里用不了数据库";
  if (c === "transform_error" || (!c && e instanceof TypeError)) return "内容没能交给数据库（页面的问题）";
  return "连不上本页的数据库（多半是网络断了或不稳）";
}
function adExpEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function adBytes(o) { try { return new TextEncoder().encode(JSON.stringify(o)).length; } catch (e) { return 0; } }
function adTimer(ms) { return new Promise(r => setTimeout(() => r(null), ms)); }
// 等一个 promise 最多 ms 毫秒：{ok: true, value} / {ok: false, error} / null（还没结果）
function adWait(p, ms) { return Promise.race([p.then(value => ({ ok: true, value }), error => ({ ok: false, error })), adTimer(ms)]); }
function adStart(fn) { return new Promise((res, rej) => { try { Promise.resolve(fn()).then(res, rej); } catch (e) { rej(e); } }); }
// 等 ms 毫秒；浏览器报告网络恢复（online）时提前醒
function adSleep(ms) {
  return new Promise(r => { let t = 0; const done = () => { clearTimeout(t); window.removeEventListener("online", done); r(); }; t = setTimeout(done, ms); window.addEventListener("online", done); });
}
// 读：每次最多等 ms，没回应或失败（会过去的错误）就按 delays 等一会儿再读；读不写数据，丢下没回应的那次也无妨
async function adDbCall(fn, delays, onRetry, ms) {
  const waits = delays || [AD_TIMING.quickRetryMs * (0.6 + Math.random() * 0.8)];
  for (let i = 0; ; i++) {
    const r = await adWait(adStart(fn), ms || AD_TIMING.attemptMs);
    if (r && r.ok) return r.value;
    const e = r ? r.error : { code: "timeout", message: `no answer in ${ms || AD_TIMING.attemptMs} ms` };
    if (!adRetryable(e) || i >= waits.length) throw e;
    console.warn(`[approval-desk] db read failed (${adErrLabel(e)}), retry ${i + 1}/${waits.length} in ${Math.round(waits[i])} ms`, e && e.message);
    if (onRetry) onRetry(i + 1, waits.length, waits[i], e);
    await adSleep(waits[i]);
  }
}
// 写：同一文档一次只写一笔。前一笔还没落地（不论成败）就排在它后面，所以最新的内容总是最后写进去
const adInflight = {};
function adSet(path, body) {
  const prev = adInflight[path] || Promise.resolve();
  const run = prev.then(() => {}, () => {}).then(() => adHostedDb.doc(path).set(body));
  adInflight[path] = run;
  const clear = () => { if (adInflight[path] === run) delete adInflight[path]; };
  run.then(clear, clear);
  return run;
}

if (!AD_DRAFTS) adDraftCheckDone();
else { adGate(true); adDraftStatus("· 正在读取草稿…"); }
const adDbReady = (async () => {
  if (AD_VIEWER) { try { adHostedDb = await window.claude.use("db"); } catch (e) { adHostedDb = null; } }
  adDbSettled = true; adRefreshSaveTarget(); adDraftLoad();
  return adHostedDb;
})();
const adDownloadsReady = AD_VIEWER ? (async () => {
  try { adDownloads = await window.claude.use("downloads"); } catch (e) { adDownloads = null; }
  adRefreshLocalButton(); return adDownloads;
})() : Promise.resolve(null);
adRefreshLocalButton();   // 查看器里在 downloads 有结果之前先藏起第三个按钮
function adIdbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(EXPORT_CFG.dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(EXPORT_CFG.store);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function adIdbGet(k) { try { const db = await adIdbOpen(); return await new Promise((res, rej) => { const q = db.transaction(EXPORT_CFG.store, "readonly").objectStore(EXPORT_CFG.store).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { return null; } }
async function adIdbSet(k, v) { try { const db = await adIdbOpen(); await new Promise((res, rej) => { const t = db.transaction(EXPORT_CFG.store, "readwrite"); t.objectStore(EXPORT_CFG.store).put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) {} }
function adInFrame() { try { return window.self !== window.top; } catch (e) { return true; } }
function adFsSupported() { return typeof window.showDirectoryPicker === "function"; }
async function adEnsurePermission(h) { const o = { mode: "readwrite" }; if ((await h.queryPermission(o)) === "granted") return true; return (await h.requestPermission(o)) === "granted"; }
async function adPickReviewsDir() {
  const h = await window.showDirectoryPicker({ id: EXPORT_CFG.pickerId, mode: "readwrite", startIn: "documents" });
  if (EXPORT_CFG.expectedDirName && h.name !== EXPORT_CFG.expectedDirName && !confirm(`你选的文件夹是「${h.name}」，不是 ${EXPORT_CFG.expectedPathHint}。仍然保存到这里吗？`)) return null;
  await adIdbSet(EXPORT_CFG.key, h); return h;
}
async function adGetReviewsDir(forcePick) { if (!forcePick) { const h = await adIdbGet(EXPORT_CFG.key); if (h && await adEnsurePermission(h)) return h; } return await adPickReviewsDir(); }
async function adWriteFile(dir, name, text) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(text); await w.close(); }
function adDownload(name, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
async function adCopy(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; } }
function adSaveDirText() { return EXPORT_CFG.reviewDir ? EXPORT_CFG.reviewDir + "/" : "项目根目录"; }
function adSaveHint() { return adDownloads ? "点「💾 另存一份 md 到本机」或「📋 一键复制 Markdown 内容」" : "点「📋 一键复制 Markdown 内容」"; }
function adNow() { return new Date().toTimeString().slice(0, 5); }

// ---- 提交区的状态行：优先于下面的常规说明 ----
function adBtn(label, call, primary) { return `<button class="btn${primary ? " btn-primary" : ""}" type="button" onclick="${call}">${label}</button>`; }
function adRow(html) { return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">${html}</div>`; }
function adFileHint() {
  const name = adExpEsc(`${ROUND}_${TOPIC}_feedback.md`), hint = adExpEsc(EXPORT_CFG.expectedPathHint);
  return `${adDownloads ? "另存或复制" : "复制"}后把它存成 <b>${name}</b>，放进 <b>${hint}</b>，回到对话说「反馈完成」：我会对比数据库和这个文件夹、「下载」文件夹里各份的导出时间，用最新的一份。`;
}
function adSubmitHtml(v) {
  const name = adExpEsc(`${ROUND}_${TOPIC}_feedback.md`), hint = adExpEsc(EXPORT_CFG.expectedPathHint);
  const saveBtns = (adDownloads ? adBtn("💾 另存一份 md 到本机", "triggerFullExport(true)", false) : "") + adBtn("📋 复制 Markdown", "copyMarkdownToClipboard()", false);
  switch (v.kind) {
    case "busy": return adExpEsc(v.text || "☁️ 正在提交……");
    case "slow": return `⏳ <b>还没提交上</b>：数据库还没回应（已等 ${v.waited} 秒），正在接着等，不用再点。你的回答都在这台设备上；想先留一份，${adSaveHint()}。`;
    case "retry": return v.running
      ? `⏳ <b>还没提交上</b>：正在第 ${v.n} 次重试（最多 ${v.total} 次），不用再点。想先留一份，${adSaveHint()}。`
      : `⏳ <b>还没提交上</b>：${adExpEsc(v.why)}。${Math.max(1, Math.round(v.wait / 1000))} 秒后第 ${v.n} 次重试（最多 ${v.total} 次），不用再点。你的回答都在这台设备上；想先留一份，${adSaveHint()}。`;
    case "ok": return `✅ <b>已提交</b>（${v.at}${v.late ? "；先前没等到回应的那一笔后来送达了" : v.tries ? `；网络不稳，重试 ${v.tries} 次后送达` : ""}）。回到对话告诉我「反馈完成」，我会把 ${name} 写入 <b>${hint}</b>。` +
      (v.changed ? "<br>提交之后你又改过回答：改完请再点一次「📤 提交反馈」，我读到的是最后一次提交。" : "");
    case "newer": return `⚠️ <b>还没提交</b>：别的窗口或设备存了更新的草稿${v.answered ? `（${adExpEsc(v.answered)}）` : ""}，和这台设备上的回答不同。` +
      adRow(adBtn("换成那份草稿再核对", "adAdoptNewer()", true) + adBtn("仍然提交这台设备上的回答", "adSubmitAnyway()", false));
    case "unchecked": return `⚠️ <b>还没提交</b>：别的窗口或设备上存的草稿没能核对（${adExpEsc(v.why)}），直接提交可能盖过别处更新的回答。` +
      adRow(adBtn("仍然提交这台设备上的回答", "adSubmitAnyway()", true) + saveBtns) + adFileHint();
    default: return `⚠️ <b>没有提交成功</b>：${adExpEsc(v.why)}${v.code ? `（${adExpEsc(v.code)}）` : ""}${v.note ? "；" + adExpEsc(v.note) : ""}。你的回答都还在这台设备上，没有丢。` +
      (v.prev ? `<br>数据库里还是你 ${adExpEsc(v.prev)} 那次提交的旧版本；另存或复制的这一份更新。` : "") +
      adRow((v.canRetry ? adBtn("🔁 再试一次提交", "triggerFullExport(false)", true) : "") + saveBtns) + adFileHint();
  }
}
function adShowSubmit(v) { adSubmitView = v; adRefreshSaveTarget(); }
function adNoteChange() {
  if (adSubmitOk) adSubmitOk = false;   // 数据库里的反馈不再是最新的回答
  if (adSubmitView && adSubmitView.kind === "ok" && !adSubmitView.changed) { adSubmitView.changed = true; adRefreshSaveTarget(); }
}
async function adRefreshSaveTarget() {
  const el = document.getElementById("save-target"); if (!el) return;
  if (AD_VIEWER) {
    if (adSubmitView) { el.innerHTML = adSubmitHtml(adSubmitView); return; }
    const hint = adExpEsc(EXPORT_CFG.expectedPathHint);
    if (!adDbSettled) { el.innerHTML = "☁️ 正在连接本页的数据库……"; return; }
    if (adHostedDb && adNoWrite) {
      const why = adNoWrite === "invalid_argument" ? "数据库不让这个页面写入（多半是你对它只有查看权限）" : "现在不能把草稿和反馈存进本页的数据库";
      el.innerHTML = `⚠️ ${why}，<b>草稿存不了，提交也不会成功</b>。请${adSaveHint()}，把内容发给我。`; return;
    }
    if (adHostedDb && adDraftNewer) {
      el.innerHTML = `⚠️ 别的窗口或设备存了更新的草稿${adDraftNewer.answered ? `（${adExpEsc(adDraftNewer.answered)}）` : ""}，这台设备上的改动没有存进草稿。` + adRow(adBtn("换成那份草稿", "adAdoptNewer()", true)); return;
    }
    if (adHostedDb && adDraftTooBig) { el.innerHTML = `⚠️ 回答有 ${adDraftTooBig} KiB，超过数据库单条 256 KiB 的上限：草稿存不了，提交也会超限。请${adSaveHint()}，存进 <b>${hint}</b>。`; return; }
    if (adHostedDb && adDbTrouble) { el.innerHTML = `⚠️ <b>草稿暂时存不上</b>：${adExpEsc(adDbTrouble)}。${adDraftRetryTimer || adDraftBusy || adDraftReadTimer ? "页面开着会自动再试；" : ""}这时点「提交反馈」也可能失败（会自动重试一会儿）。想先留一份，${adSaveHint()}，存进 <b>${hint}</b>。`; return; }
    if (adHostedDb) { el.innerHTML = "☁️ 托管模式：" + (AD_DRAFTS ? "答到一半也会自动存成草稿，换台设备打开同一个链接能接着答。" : "") + "点「提交反馈」后，反馈保存在本页的数据库里；回到对话说<b>「反馈完成」</b>，Claude 会把 md 写入 <b>" + hint + "</b>。"; return; }
    el.innerHTML = `⚠️ 这个页面现在连不上它的数据库（常见原因是网络不通或没有登录，也可能是发布时没有声明 db 能力），<b>草稿存不了，提交也不会成功</b>。网络恢复后刷新页面再提交；或者现在${adSaveHint()}，存进 <b>${hint}</b> 后回对话说「反馈完成」。`;
    return;
  }
  if (!adInFrame() && adFsSupported()) {
    const h = await adIdbGet(EXPORT_CFG.key);
    el.innerHTML = h ? `📁 本地模式：已记住保存位置「<b>${h.name}</b>」，导出时直接写入 md。` : `📁 本地模式：首次导出时请选择 <b>${EXPORT_CFG.expectedPathHint}</b>，之后自动记住。`;
    return;
  }
  el.innerHTML = "⚠️ 当前环境不能直接写文件：导出会下载 1 个 md 到「下载」文件夹并复制到剪贴板。建议打开 Claude 发给你的<b>托管审批台链接</b>，即可保证落盘。";
}
function adRefreshLocalButton() {
  if (!AD_VIEWER) return;
  const b = document.getElementById("localExportBtn") || document.querySelector('button[onclick="triggerFullExport(true)"]');
  if (b) { if (adDownloads) { b.textContent = "💾 另存一份 md 到本机"; b.hidden = false; } else b.hidden = true; }
  adRefreshSaveTarget();   // 说明里提不提“另存”，看 downloads 能不能用
}

// ---- 草稿 ----
function adDraftStatus(t) { const el = document.getElementById("draft-state"); if (el) el.textContent = t; }
// 读草稿的几秒里暂停作答：这几秒的改动和别处的草稿无法判断谁新
function adGate(on) {
  ["items", "overall", "approveAllBtn"].forEach(id => { const el = document.getElementById(id); if (el) el.inert = on; });
  document.body.classList.toggle("ad-draft-loading", on);
}
function adAdopt(remote, unsynced) {
  const next = JSON.parse(JSON.stringify(remote.state));   // 数据库给的是冻结对象，复制一份再用
  next.draft_rev = Number(remote.rev || 0); next.draft_synced_at = next.saved_at || "";
  adDraftBase = Math.max(adDraftBase, Number(remote.rev || 0));
  adSetState(next); adDraftAdopted++; adDraftOn = true; adDraftNewer = null;
  adDraftStatus("· 已接着上次的草稿");
  showToast(`已接着你上次保存的草稿${remote.answered ? `（${remote.answered}）` : ""}${unsynced ? "；这台设备上有几处还没存进草稿的改动，以草稿为准" : ""}`);
  adRefreshSaveTarget();
}
// 用读到的草稿：atOpen 为 true 是打开页面那一次（这时还不能作答）
function adDraftApply(snap, atOpen) {
  const raw = snap && snap.exists ? snap.data() : null;
  const remote = raw && raw.key === AD_KEY && raw.state ? raw : null;   // 存储键不同（例如改了题目、升级了 KEY）的草稿当作没有
  const st = adGetState(), localRev = Number(st.draft_rev || 0), remoteRev = remote ? Number(remote.rev || 0) : 0;
  const unsynced = !!st.saved_at && st.saved_at !== st.draft_synced_at;
  adDraftReadOk = true; adDraftBase = raw ? Number(raw.rev || 0) : 0;
  if (adDraftReadTimer) { clearTimeout(adDraftReadTimer); adDraftReadTimer = null; }
  if (adDbTrouble && !adDraftFails) adDbTrouble = "";
  if (remote && remoteRev > localRev) {
    // 读得晚、审批人已经在这台设备上答过：不替他换掉，让他选
    if (!atOpen && (st.saved_at || "") !== adDraftOpenSavedAt) { adDraftNewer = remote; adDraftOn = false; adDraftStatus("· 别处有更新的草稿"); adRefreshSaveTarget(); return; }
    adAdopt(remote, unsynced); return;
  }
  adDraftOn = true;
  if (st.saved_at && (!remote || remoteRev < localRev || unsynced)) adDraftSchedule();
  else adDraftStatus(remote ? "· 草稿已同步" : "");
  adRefreshSaveTarget();
}
function adDraftLate(snap) { if (!adDraftReadOk) adDraftApply(snap, false); }
function adDraftReReadLater() {
  adDraftReadFails++;
  const list = AD_TIMING.draftRetryMs, wait = list[Math.min(adDraftReadFails - 1, list.length - 1)];
  clearTimeout(adDraftReadTimer);
  adDraftReadTimer = setTimeout(adDraftReRead, wait);
}
async function adDraftReRead() {
  adDraftReadTimer = null;
  if (adDraftReadOk || !adHostedDb) return;
  try { adDraftLate(await adDbCall(() => adHostedDb.doc(EXPORT_CFG.draftPath).get())); }
  catch (e) { if (adRetryable(e)) adDraftReReadLater(); }
}
async function adDraftLoad() {
  if (!AD_DRAFTS) return;
  if (!adHostedDb) { adDraftStatus("· 连不上数据库，草稿存不了"); adGate(false); adDraftCheckDone(); return; }
  adDraftOpenSavedAt = adGetState().saved_at || "";
  const read = adStart(() => adHostedDb.doc(EXPORT_CFG.draftPath).get());
  const r = await adWait(read, AD_TIMING.draftReadMs);
  if (r && r.ok) { adDraftApply(r.value, true); adGate(false); adDraftCheckDone(); return; }
  // 读不到或还没回应：先放开作答，这次先不存草稿；那一次读迟到的结果照样接上，失败就在后台再读；提交前还会核对一次
  adGate(false); adDraftCheckDone();
  const err = r ? r.error : null;
  console.warn("[approval-desk] draft read at open", err ? `failed (${adErrLabel(err)})` : `no answer in ${AD_TIMING.draftReadMs} ms`, err && err.message);
  adDraftStatus("· 草稿暂时读不到：别的设备上存的回答还没载入，这次先不存草稿；提交前会再核对一次");
  if (err && !adRetryable(err)) return;
  adDbTrouble = adWhy(err || { code: "timeout" });
  if (r) adDraftReReadLater();
  else read.then(adDraftLate, () => adDraftReReadLater());
  adRefreshSaveTarget();
}
function adDraftSchedule() {
  adNoteChange();   // 提交之后又改了回答：状态行提醒再提交一次
  if (!adDraftOn) return;
  clearTimeout(adDraftTimer); adDraftTimer = setTimeout(() => { adDraftTimer = null; adDraftWrite(); }, EXPORT_CFG.draftDelayMs);
  if (adDraftRetryTimer) { clearTimeout(adDraftRetryTimer); adDraftRetryTimer = null; }   // 新的一笔带着全部回答，不用另外补存
  adDraftStatus("· 草稿待保存");
}
function adDraftFlush() { if (adDraftTimer) { clearTimeout(adDraftTimer); adDraftTimer = null; adDraftWrite(); } }
// 网络问题造成的没存上：过一会儿自动补存；连续两次没存上就在提交区提前提醒
function adDraftRetryLater(e) {
  adDraftFails++;
  const list = AD_TIMING.draftRetryMs, wait = list[Math.min(adDraftFails - 1, list.length - 1)];
  clearTimeout(adDraftRetryTimer);
  adDraftRetryTimer = setTimeout(() => { adDraftRetryTimer = null; adDraftWrite(); }, wait);
  adDraftStatus(`· 草稿没存上（${adErrCode(e) === "timeout" ? "数据库没回应" : "网络不稳"}），${Math.max(1, Math.round(wait / 1000))} 秒后自动再存`);
  if (adDraftFails >= 2) adDbTrouble = adWhy(e);
  adRefreshSaveTarget();
}
async function adDraftWrite() {
  if (!adDraftOn) return;
  if (adDraftBusy) { adDraftAgain = true; return; }   // 同一文档一次只写一笔
  adDraftBusy = true;
  if (adDraftRetryTimer) { clearTimeout(adDraftRetryTimer); adDraftRetryTimer = null; }   // 这一笔带着全部回答；失败了会重新排补存
  try {
    const snap = await adDbCall(() => adHostedDb.doc(EXPORT_CFG.draftPath).get());
    const cur = snap && snap.exists ? snap.data() : null, curRev = cur ? Number(cur.rev || 0) : 0;
    // 上一笔报了错其实写进去了：认出是自己的，不当成别处的草稿
    if (cur && adDraftSent && curRev === adDraftSent.rev && cur.saved_at === adDraftSent.saved_at && cur.key === AD_KEY) adDraftBase = Math.max(adDraftBase, curRev);
    if (curRev > adDraftBase) {   // 别的窗口或设备在这之后存过草稿：不覆盖它
      adDraftOn = false; adDraftNewer = cur && cur.key === AD_KEY && cur.state ? cur : null; adDraftStatus("· 别处有更新的草稿");
      showToast("别的窗口或设备存了更新的草稿：刷新页面接着那份答。这台设备上的改动还在本机，没有覆盖草稿。");
      adRefreshSaveTarget();
      return;
    }
    const st = adGetState(), rev = curRev + 1, count = document.getElementById("count");
    const body = { round: ROUND, topic: TOPIC, key: AD_KEY, rev, saved_at: st.saved_at || new Date().toISOString(), answered: count ? count.textContent : "", md: buildMD(), state: JSON.parse(JSON.stringify(st)) };
    if (adBytes(body) > AD_DOC_MAX) body.md = "（草稿太大，没有带 md；提交时会生成完整的 md）";   // state 足够接着答
    const size = adBytes(body);
    if (size > AD_DOC_MAX) {   // 回答本身就超过单条上限：数据库会以 invalid_argument 拒收（会被当成没有写权限），所以不发
      adDraftTooBig = Math.ceil(size / 1024);
      adDraftStatus(`· 回答有 ${adDraftTooBig} KiB，超过数据库单条 256 KiB 的上限，草稿这次没存；改短后会自动再存`);
      adRefreshSaveTarget();
      return;
    }
    adDraftSent = { rev, saved_at: body.saved_at };
    const p = adSet(EXPORT_CFG.draftPath, body);
    let r = await adWait(p, AD_TIMING.attemptMs);
    if (!r) {   // 这一笔还没回应：不另发一笔，接着等它
      adDraftStatus("· 草稿还没存上（数据库没回应，正在接着等）");
      r = await p.then(() => ({ ok: true }), error => ({ ok: false, error }));
    }
    if (!r.ok) throw r.error;
    adDraftBase = rev; st.draft_rev = rev; st.draft_synced_at = body.saved_at; adPersistState();
    adDraftStatus("· 草稿已存 " + adNow());
    if (adDraftFails || adDbTrouble || adDraftTooBig) { adDraftFails = 0; adDbTrouble = ""; adDraftTooBig = 0; adRefreshSaveTarget(); }
  } catch (e) {
    console.warn("[approval-desk] draft write failed", adErrLabel(e), e && e.message);
    const c = adErrCode(e);
    if (["invalid_argument", "not_granted", "revoked", "capability_disabled", "capability_removed", "transform_error"].includes(c)) {
      adDraftOn = false; adNoWrite = c; adDraftStatus("· 草稿存不了"); adRefreshSaveTarget();
    } else if (c === "quota_exceeded") { adDraftOn = false; adDraftStatus("· 草稿存不了（数据库满了）"); }
    else if (adRetryable(e)) adDraftRetryLater(e);
    else adDraftStatus("· 草稿没存上");
  } finally {
    adDraftBusy = false;
    if (adDraftAgain) { adDraftAgain = false; if (adDraftOn) adDraftWrite(); }
  }
}
// 读晚了、审批人在别处存过更新的草稿：换成那一份（这台设备上没存进草稿的改动以草稿为准）
function adAdoptNewer() {
  const remote = adDraftNewer; if (!remote) return;
  adSubmitView = null; adAdopt(remote, true);
}
function adSubmitAnyway() { return triggerFullExport(false, true); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") adDraftFlush(); });
window.addEventListener("pagehide", adDraftFlush);
window.addEventListener("online", () => {
  if (adDraftRetryTimer) { clearTimeout(adDraftRetryTimer); adDraftRetryTimer = null; adDraftWrite(); }
  if (adDraftReadTimer) { clearTimeout(adDraftReadTimer); adDraftReadTimer = null; adDraftReRead(); }
});

// ---- 提交与另存 ----
// interactive：审批人刚点完就失败（没有自动重试），才把焦点移到 Markdown 预览；等了一阵才失败时不打断正在做的事
function adSubmitFailed(why, note, code, canRetry, interactive) {
  const prev = !adSubmitOk && adSubmitAt ? adSubmitAt : "";
  adSubmitOk = false;
  adShowSubmit({ kind: "fail", why, note, code, canRetry, prev });
  const pv = document.getElementById("md-preview") || document.getElementById("export-md-preview");
  if (pv) {
    pv.value = buildMD();
    if (interactive) { pv.scrollIntoView({ behavior: "smooth", block: "center" }); pv.focus(); pv.select(); }
  }
  showToast(`⚠️ 没有提交成功：${why}。${canRetry ? "可以再试一次，" : ""}${adDownloads ? "也可以另存一份 md" : "也可以复制 Markdown"}。`);
}
async function adSaveCopy(name, mdT) {
  const dl = adDownloads || await adDownloadsReady;
  if (!dl) { showToast("这里不能另存文件。请点「📋 一键复制 Markdown 内容」，把内容粘到别处保存。"); adRefreshLocalButton(); return; }
  try {
    const r = await dl.save({ filename: name, data: mdT });
    const stale = !adSubmitOk && adSubmitAt ? `数据库里还是 ${adSubmitAt} 那次提交的旧版本，这一份更新；` : "";
    showToast(r && r.status === "delivered" ? "✅ 已交出" : `✅ 已交给浏览器保存：${name}${adSubmitOk ? "" : `。${stale}放进 ${EXPORT_CFG.expectedPathHint} 后回对话说「反馈完成」即可`}`);
  } catch (e) {
    const c = e && e.code;
    showToast(c === "declined" ? "没有保存（确认框被取消了）" : c === "rate_limited" ? "已经有一个保存确认框开着，请先处理它" : `这里不能另存文件（${c || "unknown"}）`);
    if (c && c !== "declined" && c !== "rate_limited") { adDownloads = null; adRefreshLocalButton(); }
  }
}
// 还没读到草稿就点了提交：先核对一次（读不写数据，可以重试）；别处有更新的草稿时不提交
async function adCheckDraftBeforeSubmit(db) {
  adShowSubmit({ kind: "busy", text: "☁️ 提交前先核对别的设备上存的草稿……" });
  let snap;
  try {
    snap = await adDbCall(() => db.doc(EXPORT_CFG.draftPath).get(), AD_TIMING.submitDelaysMs, (n, total, wait, e) => adShowSubmit({ kind: "retry", n, total, wait, why: adWhy(e) }));
  } catch (e) { adShowSubmit({ kind: "unchecked", why: adWhy(e) }); return false; }
  const adopted = adDraftAdopted;
  adDraftLate(snap);
  if (adDraftNewer) { adShowSubmit({ kind: "newer", answered: adDraftNewer.answered || "" }); return false; }
  if (adDraftAdopted !== adopted) { adSubmitView = null; adRefreshSaveTarget(); showToast("已换成你在别处保存的更新草稿，请核对后再提交"); return false; }
  return true;
}
// 写反馈：一笔没回应就接着等它，失败了（会过去的错误）才隔一会儿重发；最多等 submitWaitMs
async function adSubmitWrite(body, seq) {
  const path = `feedback/${ROUND}`, delays = AD_TIMING.submitDelaysMs, started = Date.now();
  let tries = 0;
  for (let i = 0; ; i++) {
    if (i > 0) adShowSubmit({ kind: "retry", running: true, n: i, total: delays.length });
    const p = adSet(path, body);
    for (;;) {
      const left = AD_TIMING.submitWaitMs - (Date.now() - started);
      const r = await adWait(p, Math.max(1, Math.min(AD_TIMING.attemptMs, left)));
      if (r && r.ok) return tries;
      if (r) {
        const e = r.error;
        // 平台给的错误对象可能是冻结的，不往上面加字段，包一层再抛
        if (!adRetryable(e) || i >= delays.length || Date.now() - started + delays[i] > AD_TIMING.submitWaitMs) throw { adFail: true, error: e, tries };
        console.warn(`[approval-desk] feedback write failed (${adErrLabel(e)}), retry ${i + 1}/${delays.length}`, e && e.message);
        tries = i + 1;
        adShowSubmit({ kind: "retry", n: i + 1, total: delays.length, wait: delays[i], why: adWhy(e) });
        if (i === 0) showToast("⏳ 网络不稳，提交还没送达，正在自动重试……");
        await adSleep(delays[i]);
        break;
      }
      if (Date.now() - started >= AD_TIMING.submitWaitMs) {   // 等太久：说没有提交成功；那一笔后来落地了再改成已提交
        p.then(() => {
          if (seq !== adSubmitSeq || !adSubmitView || adSubmitView.kind !== "fail") return;
          adSubmitOk = true; adSubmitAt = adNow(); adDbTrouble = "";
          adShowSubmit({ kind: "ok", at: adSubmitAt, late: true });
          showToast("✅ 先前没等到回应的那一笔提交后来送达了");
        }, () => {});
        throw { adFail: true, error: { code: "timeout", message: `no answer in ${AD_TIMING.submitWaitMs} ms` }, tries };
      }
      adShowSubmit({ kind: "slow", waited: Math.round((Date.now() - started) / 1000) });
    }
  }
}
async function triggerFullExport(forcePick = false, skipDraftCheck = false) {
  const name = `${ROUND}_${TOPIC}_feedback.md`;
  if (AD_VIEWER) {
    if (forcePick) return adSaveCopy(name, buildMD());
    if (adSubmitting) { showToast("正在提交，请稍候"); return; }
    adSubmitting = true;
    const seq = ++adSubmitSeq;
    try {
      if (!adDbSettled) showToast("正在连接本页的数据库……");
      const db = adDbSettled ? adHostedDb : await adDbReady;   // 刚打开就点提交时，等数据库连上（最多 10 秒）
      if (!db) { adSubmitFailed("这个页面连不上它的数据库", "常见原因是网络不通或没有登录，也可能是发布时没有声明 db 能力；网络恢复后刷新页面再提交", "", false, true); return; }
      const adopted = adDraftAdopted;
      await adDraftChecked;   // 草稿还在读：等它读完，按最新的回答提交
      if (adDraftAdopted !== adopted) { showToast("已换成你在别处保存的更新草稿，请核对后再提交"); return; }
      // 别处有更新的草稿（读得晚，或存草稿时发现的）：先让审批人选，不直接提交这台设备上的旧回答
      if (adDraftNewer && !skipDraftCheck) { adShowSubmit({ kind: "newer", answered: adDraftNewer.answered || "" }); return; }
      if (AD_DRAFTS && !adDraftReadOk && !skipDraftCheck && !(await adCheckDraftBeforeSubmit(db))) return;
      const savedAt = typeof adGetState === "function" ? (adGetState().saved_at || "") : "";
      const mdT = buildMD();
      const proposal = (typeof PROPOSAL_FILE !== "undefined" && PROPOSAL_FILE) || EXPORT_CFG.proposalFile || `${ROUND}_${TOPIC}_proposal.html`;
      const body = { round: ROUND, topic: TOPIC, proposal, filename: name, submitted_at: new Date().toISOString(), md: mdT };
      const size = adBytes(body);
      if (size > AD_DOC_MAX) { adSubmitFailed(`反馈有 ${Math.ceil(size / 1024)} KiB，超过数据库单条 256 KiB 的上限`, "这一份只能另存或复制", "", false, true); return; }
      adShowSubmit({ kind: "busy" });
      try {
        const tries = await adSubmitWrite(body, seq);
        const changed = typeof adGetState === "function" ? (adGetState().saved_at || "") !== savedAt : false;   // 提交途中又改过回答
        adSubmitOk = !changed; adSubmitAt = adNow(); adDbTrouble = "";
        adShowSubmit({ kind: "ok", at: adSubmitAt, tries, changed });
        showToast(`✅ 已提交。回到对话告诉我「反馈完成」，我会把 ${name} 写入${EXPORT_CFG.reviewDir ? " " + adSaveDirText() : adSaveDirText()}。`);
      } catch (thrown) {
        const e = thrown && thrown.adFail ? thrown.error : thrown, tries = thrown && thrown.adFail ? thrown.tries : 0;
        console.error("[approval-desk] db write failed", adErrLabel(e), e && e.message);
        const again = adRetryable(e);
        adSubmitFailed(adWhy(e), again ? (tries ? `已经自动重试了 ${tries} 次` : "等了一阵还是没有回应") : "", adErrLabel(e), again, !again && !tries);
      }
    } finally { adSubmitting = false; }
    return;
  }
  const mdT = buildMD();
  let reason = "";
  if (adInFrame()) reason = "页面在预览窗口里打开，浏览器不允许写文件";
  else if (!adFsSupported()) reason = "当前浏览器不支持直接写入文件夹";
  if (!reason) {
    try { const dir = await adGetReviewsDir(forcePick); if (!dir) return; await adWriteFile(dir, name, mdT); adRefreshSaveTarget(); showToast(`✅ 已保存到「${dir.name}」：${name}。回到对话告诉我「反馈完成」即可。`); return; }
    catch (e) { if (e && e.name === "AbortError") return; console.error("[approval-desk] fs write failed", e); reason = `直接写入失败（${e && e.name}）`; }
  }
  const copied = await adCopy(mdT);
  adDownload(name, mdT);
  showToast(`⚠️ ${reason}。已下载 ${name}${copied ? "，并已复制到剪贴板" : ""}。`);
}
// 托管模式里提交只写数据库、不下载文件：按钮上不写“导出 md”（本地文件里的按钮照旧，那里会写出 md 文件）
if (AD_VIEWER) document.querySelectorAll('#exportBtn, button[onclick="triggerFullExport(false)"], button[onclick="triggerFullExport()"]').forEach(b => { b.textContent = "📤 提交反馈"; });
document.addEventListener("DOMContentLoaded", adRefreshSaveTarget);
setTimeout(adRefreshSaveTarget, 300);
// ===================== End Export Module v5 =====================
