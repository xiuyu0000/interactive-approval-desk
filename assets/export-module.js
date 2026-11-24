// ===================== Approval Desk Export Module v4 (2026-11-17) =====================
// 只导出 Markdown（不导出 JSON）。依赖页面里已有的：ROUND, TOPIC, buildMD(), showToast(msg)
// 可选：PROPOSAL_FILE；AD_CFG（build.py 从 cfg 注入：PROJECT、REVIEW_DIR、REVIEW_PATH_HINT、PROPOSAL_FILE）；
//       模板提供的 AD_KEY、adGetState()、adSetState(state)、adPersistState()（都有才在托管模式下存草稿）。
// 托管模式（页面作为 claude.ai Artifact 发布，声明 capabilities {db: {}, downloads: true}；查看器里才有 window.claude.use）：
//   - 「提交反馈」→ 把 Markdown 写入数据库 feedback/{ROUND}；用户在对话里说「反馈完成」→ Claude 读取它，写入评审文件夹。
//   - 草稿 drafts/{ROUND}：{round, topic, key, rev, saved_at, answered, md, state}。打开页面时先读草稿（这几秒里暂停作答），
//     草稿的修订号 rev 比这台设备上回答所依据的修订号新、且 key 与本页存储键相同，就接着用；之后每次表态停 1.5 秒存一次，
//     存之前再读一次：别的窗口或设备在这之后存过（rev 更大），就不覆盖，提示刷新。新旧只看 rev，不看设备时钟。
//     读草稿失败（重试一次后）就这次不存草稿；数据库拒绝写入（多半是只有查看权限）就停止存草稿，并说明提交不会成功。
//   - 「另存一份 md 到本机」用 downloads 能力（查看者确认后才保存）；这个能力不可用时不显示按钮。
//   - 数据库连不上或写入失败时明确说"没有提交成功"，并选中 Markdown 预览请用户复制；不假装已经下载。
// 本地文件（没有 window.claude）：
//   - Chrome/Edge：File System Access API 写入记住的评审文件夹（第一次选一次）；
//   - 其他浏览器或预览窗口：下载 1 个 .md，同时复制到剪贴板。
// 记住的文件夹、文件夹选择框的记忆都带 AD_CFG.PROJECT 前缀；没有 PROJECT 的旧页面沿用旧键。
const AD_EXPORT_OPT = (typeof AD_CFG !== "undefined" && AD_CFG) || {};
const AD_EXPORT_PROJECT = String(AD_EXPORT_OPT.PROJECT || "");
const EXPORT_CFG = {
  dbName: "approval-desk", store: "handles",
  key: AD_EXPORT_PROJECT ? `${AD_EXPORT_PROJECT}/reviews-dir` : "reviews-dir",
  // 选择框的 id 只能用字母、数字、_、-，最长 32 个字符（build.py 把 PROJECT 限制在 24 个字符以内）
  pickerId: AD_EXPORT_PROJECT ? `${AD_EXPORT_PROJECT.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 24)}-reviews` : "approval-desk-reviews",
  // 评审文件夹：去掉 "."、空段和首尾斜杠；空串表示项目根目录（这时不核对文件夹名）
  reviewDir: (AD_EXPORT_OPT.REVIEW_DIR !== undefined ? String(AD_EXPORT_OPT.REVIEW_DIR) : "interview/reviews").split(/[\\/]+/).filter(p => p && p !== ".").join("/"),
  expectedDirName: "", expectedPathHint: "", proposalFile: AD_EXPORT_OPT.PROPOSAL_FILE || "",
  draftPath: `drafts/${ROUND}`, draftDelayMs: 1500
};
EXPORT_CFG.expectedDirName = EXPORT_CFG.reviewDir.split("/").pop() || "";
EXPORT_CFG.expectedPathHint = AD_EXPORT_OPT.REVIEW_PATH_HINT || EXPORT_CFG.reviewDir || "项目根目录";
const AD_VIEWER = !!(window.claude && typeof window.claude.use === "function");
const AD_DRAFTS = AD_VIEWER && typeof AD_KEY !== "undefined" && typeof adGetState === "function" && typeof adSetState === "function" && typeof adPersistState === "function";
let adHostedDb = null, adDbSettled = !AD_VIEWER, adDownloads = null, adNoWrite = false, adSubmitting = false;
let adDraftOn = false, adDraftBase = 0, adDraftTimer = null, adDraftBusy = false, adDraftAgain = false, adDraftAdopted = 0;
let adDraftCheckDone = null;
const adDraftChecked = new Promise(r => { adDraftCheckDone = r; });
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
// 数据库调用：'unavailable' 是短暂的，隔一会儿重试一次；其他错误原样抛出
async function adDbCall(fn) {
  try { return await fn(); }
  catch (e) { if (e && e.code === "unavailable") { await new Promise(r => setTimeout(r, 300 + Math.random() * 500)); return await fn(); } throw e; }
}
async function adRefreshSaveTarget() {
  const el = document.getElementById("save-target"); if (!el) return;
  if (AD_VIEWER) {
    if (!adDbSettled) { el.innerHTML = "☁️ 正在连接本页的数据库……"; return; }
    if (adHostedDb && adNoWrite) { el.innerHTML = "⚠️ 数据库不让这个页面写入（多半是你对它只有查看权限），<b>草稿存不了，提交也不会成功</b>。请点「📋 一键复制 Markdown 内容」，把内容发给我。"; return; }
    if (adHostedDb) { el.innerHTML = "☁️ 托管模式：" + (AD_DRAFTS ? "答到一半也会自动存成草稿，换台设备打开同一个链接能接着答。" : "") + "点「提交反馈」后，反馈保存在本页的数据库里；回到对话说<b>「反馈完成」</b>，Claude 会把 md 写入 <b>" + EXPORT_CFG.expectedPathHint + "</b>。"; return; }
    el.innerHTML = "⚠️ 这个页面连不上数据库（可能是发布时没有声明 db 能力，或者你没有登录），<b>提交不会成功</b>。请点「📋 一键复制 Markdown 内容」，把内容发给我。";
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
  const b = document.getElementById("localExportBtn") || document.querySelector('button[onclick="triggerFullExport(true)"]'); if (!b) return;
  if (adDownloads) { b.textContent = "💾 另存一份 md 到本机"; b.hidden = false; } else b.hidden = true;
}
function adDraftStatus(t) { const el = document.getElementById("draft-state"); if (el) el.textContent = t; }
// 读草稿的几秒里暂停作答：这几秒的改动和别处的草稿无法判断谁新
function adGate(on) {
  ["items", "overall", "approveAllBtn"].forEach(id => { const el = document.getElementById(id); if (el) el.inert = on; });
  document.body.classList.toggle("ad-draft-loading", on);
}
async function adDraftLoad() {
  if (!AD_DRAFTS) return;
  try {
    if (!adHostedDb) { adDraftStatus(""); return; }
    let snap;
    try { snap = await adDbCall(() => adHostedDb.doc(EXPORT_CFG.draftPath).get()); }
    catch (e) { console.warn("[approval-desk] draft read failed", e); adDraftStatus("· 草稿暂时读不到（不影响提交）"); return; }
    const raw = snap && snap.exists ? snap.data() : null;
    adDraftBase = raw ? Number(raw.rev || 0) : 0;
    const remote = raw && raw.key === AD_KEY && raw.state ? raw : null;   // 存储键不同（例如改了题目、升级了 KEY）的草稿当作没有
    const st = adGetState(), localRev = Number(st.draft_rev || 0), remoteRev = remote ? Number(remote.rev || 0) : 0;
    const unsynced = !!st.saved_at && st.saved_at !== st.draft_synced_at;
    if (remote && remoteRev > localRev) {
      const next = JSON.parse(JSON.stringify(remote.state));   // 数据库给的是冻结对象，复制一份再用
      next.draft_rev = remoteRev; next.draft_synced_at = next.saved_at || "";
      adSetState(next); adDraftAdopted++; adDraftOn = true;
      adDraftStatus("· 已接着上次的草稿");
      showToast(`已接着你上次保存的草稿${remote.answered ? `（${remote.answered}）` : ""}${unsynced ? "；这台设备上有几处还没存进草稿的改动，以草稿为准" : ""}`);
      return;
    }
    adDraftOn = true;
    if (st.saved_at && (!remote || remoteRev < localRev || unsynced)) adDraftSchedule();
    else adDraftStatus(remote ? "· 草稿已同步" : "");
  } finally { adGate(false); adDraftCheckDone(); }
}
function adDraftSchedule() {
  if (!adDraftOn) return;
  clearTimeout(adDraftTimer); adDraftTimer = setTimeout(() => { adDraftTimer = null; adDraftWrite(); }, EXPORT_CFG.draftDelayMs);
  adDraftStatus("· 草稿待保存");
}
function adDraftFlush() { if (adDraftTimer) { clearTimeout(adDraftTimer); adDraftTimer = null; adDraftWrite(); } }
async function adDraftWrite() {
  if (!adDraftOn) return;
  if (adDraftBusy) { adDraftAgain = true; return; }   // 同一文档一次只写一笔
  adDraftBusy = true;
  try {
    const snap = await adDbCall(() => adHostedDb.doc(EXPORT_CFG.draftPath).get());
    const cur = snap && snap.exists ? snap.data() : null, curRev = cur ? Number(cur.rev || 0) : 0;
    if (curRev > adDraftBase) {   // 别的窗口或设备在这之后存过草稿：不覆盖它
      adDraftOn = false; adDraftStatus("· 别处有更新的草稿");
      showToast("别的窗口或设备存了更新的草稿：刷新页面接着那份答。这台设备上的改动还在本机，没有覆盖草稿。");
      return;
    }
    const st = adGetState(), rev = curRev + 1, count = document.getElementById("count");
    const body = { round: ROUND, topic: TOPIC, key: AD_KEY, rev, saved_at: st.saved_at || new Date().toISOString(), answered: count ? count.textContent : "", md: buildMD(), state: JSON.parse(JSON.stringify(st)) };
    await adDbCall(() => adHostedDb.doc(EXPORT_CFG.draftPath).set(body));
    adDraftBase = rev; st.draft_rev = rev; st.draft_synced_at = body.saved_at; adPersistState();
    adDraftStatus("· 草稿已存 " + new Date().toTimeString().slice(0, 5));
  } catch (e) {
    console.warn("[approval-desk] draft write failed", e);
    const c = e && e.code;
    if (["invalid_argument", "not_granted", "revoked", "capability_disabled", "capability_removed"].includes(c)) {
      adDraftOn = false; adNoWrite = true; adDraftStatus("· 草稿存不了"); adRefreshSaveTarget();
    } else adDraftStatus("· 草稿没存上，稍后再试");
  } finally {
    adDraftBusy = false;
    if (adDraftAgain) { adDraftAgain = false; if (adDraftOn) adDraftWrite(); }
  }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") adDraftFlush(); });
window.addEventListener("pagehide", adDraftFlush);
function adSubmitFailed(reason) {
  const el = document.getElementById("save-target");
  if (el) el.innerHTML = `⚠️ <b>没有提交成功</b>：${reason}。已选中下方的 Markdown，请复制后发给我。`;
  const pv = document.getElementById("md-preview") || document.getElementById("export-md-preview");
  if (pv) { pv.value = buildMD(); pv.scrollIntoView({ behavior: "smooth", block: "center" }); pv.focus(); pv.select(); }
  showToast(`⚠️ 没有提交成功：${reason}。请复制下方的 Markdown 发给我。`);
}
async function adSaveCopy(name, mdT) {
  const dl = adDownloads || await adDownloadsReady;
  if (!dl) { showToast("这里不能另存文件。请点「📋 一键复制 Markdown 内容」，把内容粘到别处保存。"); adRefreshLocalButton(); return; }
  try {
    const r = await dl.save({ filename: name, data: mdT });
    showToast(r && r.status === "delivered" ? "✅ 已交出" : `✅ 已交给浏览器保存：${name}`);
  } catch (e) {
    const c = e && e.code;
    showToast(c === "declined" ? "没有保存（确认框被取消了）" : c === "rate_limited" ? "已经有一个保存确认框开着，请先处理它" : `这里不能另存文件（${c || "unknown"}）`);
    if (c && c !== "declined" && c !== "rate_limited") { adDownloads = null; adRefreshLocalButton(); }
  }
}
async function triggerFullExport(forcePick = false) {
  const name = `${ROUND}_${TOPIC}_feedback.md`;
  if (AD_VIEWER) {
    if (forcePick) return adSaveCopy(name, buildMD());
    if (adSubmitting) { showToast("正在提交，请稍候"); return; }
    adSubmitting = true;
    try {
      if (!adDbSettled) showToast("正在连接本页的数据库……");
      const db = adDbSettled ? adHostedDb : await adDbReady;   // 刚打开就点提交时，等数据库连上（最多 10 秒）
      if (!db) { adSubmitFailed("页面连不上数据库（可能是发布时没有声明 db 能力，或者你没有登录）"); return; }
      const adopted = adDraftAdopted;
      await adDraftChecked;   // 草稿还在读：等它读完，按最新的回答提交
      if (adDraftAdopted !== adopted) { showToast("已换成你在别处保存的更新草稿，请核对后再提交"); return; }
      const mdT = buildMD();
      try {
        const proposal = (typeof PROPOSAL_FILE !== "undefined" && PROPOSAL_FILE) || EXPORT_CFG.proposalFile || `${ROUND}_${TOPIC}_proposal.html`;
        await adDbCall(() => db.doc(`feedback/${ROUND}`).set({ round: ROUND, topic: TOPIC, proposal, filename: name, submitted_at: new Date().toISOString(), md: mdT }));
        showToast(`✅ 已提交。回到对话告诉我「反馈完成」，我会把 ${name} 写入${EXPORT_CFG.reviewDir ? " " + adSaveDirText() : adSaveDirText()}。`);
      } catch (e) { console.error("[approval-desk] db write failed", e); adSubmitFailed(`写入数据库失败（${e && (e.code || e.name)}）`); }
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
document.addEventListener("DOMContentLoaded", adRefreshSaveTarget);
setTimeout(adRefreshSaveTarget, 300);
// ===================== End Export Module v4 =====================
