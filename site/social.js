/* Study Desk: friends, shared calendars and meeting finder (social.html).
 * Talks to the study-desk-social Worker. Only busy start/end times are ever uploaded;
 * class names, assignments and event titles stay in this browser.
 * Loaded after planner.js and study-plan.js. Does not change what they store. */
(function () {
"use strict";
const API = (function () { try { return localStorage.getItem("study-desk-social-api"); } catch (e) { return null; } })() || "https://study-desk-social.gc756325.workers.dev";
const KEY = "study-desk-v1", AUTH = "study-desk-social", PREF = "study-desk-social-prefs";
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const fromYmd = s => { const a = s.split("-").map(Number); return new Date(a[0], a[1] - 1, a[2]); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const toMin = t => { const a = (t || "0:0").split(":").map(Number); return a[0] * 60 + (a[1] || 0); };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtT = ms => { const d = new Date(ms), h = d.getHours(); return (h % 12 || 12) + ":" + pad(d.getMinutes()) + (h < 12 ? " AM" : " PM"); };
const fmtDay = ms => { const d = new Date(ms); return DOW[d.getDay()] + " " + MON[d.getMonth()] + " " + d.getDate(); };
const ago = ms => { if (!ms) return "never"; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
const colorOf = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return "var(--c" + (h % 6 + 1) + ")"; };

/* ---------- state ---------- */
let auth = null; try { auth = JSON.parse(localStorage.getItem(AUTH) || "null"); } catch (e) {}
let me = null;                 // last /api/me answer
let pref = { dur: 60, days: 7, from: "09:00", until: "21:00", buffer: 10, picked: [] };
try { pref = Object.assign(pref, JSON.parse(localStorage.getItem(PREF) || "{}")); } catch (e) {}
const friendBusy = {};         // id -> {shared, blocks, updatedAt, fetchedAt}
let slots = [], mode = "in", lastUpload = "", busyTimer = null;
const savePref = () => { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch (e) {} };

/* ---------- server ---------- */
async function api(method, path, body) {
  let r;
  try {
    r = await fetch(API + path, { method, headers: Object.assign({ "content-type": "application/json" }, auth ? { authorization: "Bearer " + auth.token } : {}), body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw new Error("Could not reach the Study Desk friends server. Check your connection and try again."); }
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (r.status === 401 && auth && path !== "/api/login" && path !== "/api/account/delete") { signOutLocal(); throw new Error(j.error || "Please sign in again."); }
  if (!r.ok) throw new Error(j.error || "The server answered " + r.status + ".");
  return j;
}

/* ---------- my busy times, from the planner on this device ---------- */
function planner() { try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.v === 1 && s.started) return s; } catch (e) {} return null; }
function meetsOn(c, date) {
  const k = ymd(date);
  if (!c.days || !c.days.includes(date.getDay()) || (c.from && k < c.from) || (c.until && k > c.until)) return false;
  const n = c.interval || 1; if (n === 1 || !c.from) return true;
  const a = fromYmd(c.from), a0 = addDays(a, -a.getDay()), d0 = addDays(date, -date.getDay());
  return Math.round((d0 - a0) / 6048e5) % n === 0;
}
function myBlocks(days) {
  const s = planner(), out = [], today = new Date(); today.setHours(0, 0, 0, 0);
  const at = (date, t) => date.getTime() + toMin(t) * 60000;
  if (s) for (let n = -1; n < days; n++) {
    const date = addDays(today, n), k = ymd(date);
    for (const c of s.classes || []) if (meetsOn(c, date) && c.start && c.end) out.push([at(date, c.start), at(date, c.end)]);
    for (const i of s.items || []) if (i.date === k && i.kind !== "due" && i.time) out.push([at(date, i.time), i.end ? at(date, i.end) : at(date, i.time) + 3600000]);
  }
  if (me) for (const m of me.meetings) { const p = m.people.find(x => x.id === me.user.id); if (p && p.response === "accepted") out.push([m.start, m.end]); }
  return merge(out.filter(b => b[1] > b[0]));
}
function merge(bl) {
  bl = bl.slice().sort((a, b) => a[0] - b[0]); const out = [];
  for (const b of bl) { const l = out[out.length - 1]; if (l && b[0] <= l[1]) l[1] = Math.max(l[1], b[1]); else out.push([b[0], b[1]]); }
  return out;
}
async function uploadBusy(force) {
  if (!auth) return;
  const blocks = myBlocks(60), sig = JSON.stringify(blocks);
  if (!force && sig === lastUpload) return;
  try { await api("PUT", "/api/busy", { blocks }); lastUpload = sig; $("#soShareNote").textContent = "Your busy times were shared with friends " + ago(Date.now()) + "."; }
  catch (e) { $("#soShareNote").textContent = e.message; }
}
function scheduleUpload() { clearTimeout(busyTimer); busyTimer = setTimeout(() => uploadBusy(false), 2000); }

/* ---------- finding times ---------- */
async function loadFriendBusy(ids) {
  const need = ids.filter(id => !friendBusy[id] || Date.now() - friendBusy[id].fetchedAt > 120000);
  if (!need.length) return;
  const r = await api("POST", "/api/busy/query", { userIds: need });
  for (const id of need) friendBusy[id] = Object.assign({ fetchedAt: Date.now() }, r.users[id] || { shared: false });
}
function people() {
  const list = [{ id: "me", name: "You", blocks: myBlocks(pref.days + 1) }];
  for (const id of pref.picked) {
    const f = me && me.friends.find(x => x.id === id), fb = friendBusy[id];
    if (f && fb && fb.shared) list.push({ id, name: f.displayName, blocks: fb.blocks });
  }
  return list;
}
function findSlots(ps) {
  const dur = pref.dur * 60000, buf = pref.buffer * 60000, step = 15 * 60000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lo = toMin(pref.from), hi = toMin(pref.until), nowMs = Date.now() + 30 * 60000;
  const found = [];
  for (let n = 0; n < pref.days; n++) {
    const day = addDays(today, n).getTime(), dayEnd = day + 86400000;
    const load = ps.reduce((s, p) => s + p.blocks.reduce((t, b) => t + Math.max(0, Math.min(b[1], dayEnd) - Math.max(b[0], day)), 0), 0) / 3600000;
    for (let t = day + lo * 60000; t + dur <= day + hi * 60000; t += step) {
      if (t < nowMs) continue;
      const s = t, e = t + dur;
      if (ps.some(p => p.blocks.some(b => b[0] < e + buf && b[1] > s - buf))) continue;
      let gap = Infinity;
      for (const p of ps) for (const b of p.blocks) { if (b[1] <= s && b[1] > day) gap = Math.min(gap, (s - b[1]) / 60000); if (b[0] >= e && b[0] < dayEnd) gap = Math.min(gap, (b[0] - e) / 60000); }
      const sm = (s - day) / 60000, em = (e - day) / 60000;
      let score = 100 - n * 0.6 - load * 0.8;
      if (sm < 600) score -= (600 - sm) / 20;
      if (em > 1200) score -= (em - 1200) / 20;
      if (gap < 30) score -= (30 - gap) / 6;
      if (sm % 30 === 0) score += 2;
      found.push({ s, e, score, gap, load, n });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const pick = [], perDay = {};
  for (const f of found) {
    if (pick.length >= 6) break;
    if ((perDay[f.n] || 0) >= 2 || pick.some(p => p.s < f.e + 3600000 && p.e > f.s - 3600000)) continue;
    pick.push(f); perDay[f.n] = (perDay[f.n] || 0) + 1;
  }
  return pick.sort((a, b) => a.s - b.s);
}
function why(f, ps) {
  const bits = [ps.length > 1 ? "Everyone is free" : "You're free"];
  bits.push(f.gap === Infinity ? "nothing else that day nearby" : f.gap >= 60 ? "at least an hour from other commitments" : Math.round(f.gap) + " min from the nearest commitment");
  if (f.load < 2) bits.push("a light day");
  return bits.join(" · ");
}

/* ---------- rendering ---------- */
function show(el, on) { el.hidden = !on; }
function renderAuth() {
  const signed = !!(auth && me);
  show($("#soAuth"), !auth); show($("#soApp"), signed); show($("#soLoading"), !!auth && !me);
  show($("#soFoot"), signed);
  $("#soWho").innerHTML = signed ? '<span>Signed in as <strong>' + esc(me.user.displayName) + "</strong> @" + esc(me.user.username) + '</span><button class="linkish" id="soOut" type="button">Sign out</button>' : "";
  const up = mode === "up";
  $("#soTabIn").setAttribute("aria-selected", !up); $("#soTabUp").setAttribute("aria-selected", up);
  show($("#soNameWrap"), up); $("#soAuthGo").textContent = up ? "Create account" : "Sign in";
  $("#soPass").autocomplete = up ? "new-password" : "current-password";
}
function personRow(p, extra) {
  return '<li class="so-person"><span class="so-av" style="--cc:' + colorOf(p.username) + '">' + esc((p.displayName || "?").slice(0, 1).toUpperCase()) + '</span><div class="so-pn"><strong>' + esc(p.displayName) + "</strong><span>@" + esc(p.username) + (extra ? " · " + extra : "") + "</span></div>";
}
function renderFriends() {
  if (!me) return;
  $("#soIncoming").innerHTML = me.incoming.length ? '<div class="eyebrow">Friend requests</div><ul class="so-list">' + me.incoming.map(p => personRow(p, "wants to share calendars") +
    '<div class="so-acts"><button class="btn small primary" data-accept="' + esc(p.requestId) + '">Accept</button><button class="btn small" data-decline="' + esc(p.requestId) + '">Decline</button></div></li>').join("") + "</ul>" : "";
  $("#soFriends").innerHTML = me.friends.length ? me.friends.map(f => personRow(f, f.sharesWithMe ? "busy times updated " + ago(f.busyUpdatedAt) : "not sharing with you") +
    '<div class="so-acts"><label class="so-share" title="Let ' + esc(f.displayName) + ' see when you are busy"><input type="checkbox" data-share="' + esc(f.id) + '"' + (f.iShare ? " checked" : "") + '>Share mine</label>' +
    '<button class="linkish so-rm" data-remove="' + esc(f.id) + '" data-name="' + esc(f.displayName) + '">Remove</button></div></li>').join("")
    : '<li class="empty">No friends yet. Send a request with their Study Desk username.</li>';
  $("#soOutgoing").innerHTML = me.outgoing.length ? '<div class="eyebrow">Waiting for them to accept</div><ul class="so-list">' + me.outgoing.map(p => personRow(p, "request sent") +
    '<div class="so-acts"><button class="linkish" data-cancel="' + esc(p.requestId) + '">Cancel</button></div></li>').join("") + "</ul>" : "";
}
function renderPicker() {
  if (!me) return;
  const sharing = me.friends.filter(f => f.sharesWithMe);
  pref.picked = pref.picked.filter(id => sharing.some(f => f.id === id));
  $("#soPick").innerHTML = '<span class="so-chip on" style="--cc:var(--accent)">You</span>' + (sharing.length ? sharing.map(f =>
    '<label class="so-chip' + (pref.picked.includes(f.id) ? " on" : "") + '" style="--cc:' + colorOf(f.username) + '"><input type="checkbox" data-pick="' + esc(f.id) + '"' + (pref.picked.includes(f.id) ? " checked" : "") + ">" + esc(f.displayName) + "</label>").join("")
    : '<span class="so-hint">Friends who share their calendar with you appear here.</span>');
}
async function renderFinder() {
  if (!me) return;
  $("#soSlots").innerHTML = '<li class="so-hint">Checking calendars…</li>';
  try { await loadFriendBusy(pref.picked); } catch (e) { $("#soSlots").innerHTML = '<li class="result bad">' + esc(e.message) + "</li>"; return; }
  const ps = people();
  const noPlanner = !planner();
  $("#soMine").hidden = !noPlanner;
  slots = findSlots(ps);
  renderHeat(ps);
  $("#soSlots").innerHTML = slots.length ? slots.map((f, i) =>
    '<li class="so-slot"><div><strong>' + fmtDay(f.s) + ", " + fmtT(f.s) + "–" + fmtT(f.e) + '</strong><span>' + esc(why(f, ps)) + '</span></div>' +
    (ps.length > 1 ? '<button class="btn small primary" data-propose="' + i + '">Propose</button>' : "") + "</li>").join("")
    : '<li class="so-hint">No time fits everyone. Try a shorter meeting, more days, or a wider time window.</li>';
  $("#soAsk").disabled = !slots.length;
}
function renderHeat(ps) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const h0 = Math.floor(toMin(pref.from) / 60), h1 = Math.ceil(toMin(pref.until) / 60);
  $("#soHeat").style.setProperty("--cols", h1 - h0);
  let html = '<div class="so-hrow so-hhead"><span></span>';
  for (let h = h0; h < h1; h++) html += "<span>" + (h % 12 || 12) + (h < 12 ? "a" : "p") + "</span>";
  html += "</div>";
  for (let n = 0; n < pref.days; n++) {
    const day = addDays(today, n).getTime();
    html += '<div class="so-hrow"><span class="so-hday">' + (n === 0 ? "Today" : fmtDay(day)) + "</span>";
    for (let h = h0; h < h1; h++) {
      const s = day + h * 3600000, e = s + 3600000;
      const free = ps.filter(p => !p.blocks.some(b => b[0] < e && b[1] > s)).length, past = e < Date.now();
      const all = free === ps.length;
      html += '<span class="so-cell' + (past ? " past" : all ? " all" : "") + '" style="--f:' + (free / ps.length).toFixed(2) + '" title="' + fmtDay(s) + " " + fmtT(s) + ": " + free + " of " + ps.length + ' free"></span>';
    }
    html += "</div>";
  }
  $("#soHeat").innerHTML = html;
  $("#soHeatKey").textContent = ps.length > 1 ? "Darker means more of you are free. Solid squares are hours when all " + ps.length + " of you are free." : "Solid squares are hours when you're free. Pick friends above to compare.";
}
function renderMeetings() {
  if (!me) return;
  const list = me.meetings.filter(m => m.end > Date.now());
  show($("#soMeetWrap"), list.length > 0);
  $("#soMeetings").innerHTML = list.map(m => {
    const mine = m.people.find(p => p.id === me.user.id), org = m.organizerId === me.user.id;
    const others = m.people.filter(p => p.id !== me.user.id).map(p => esc(p.displayName) + ' <span class="so-r ' + p.response + '">' + (p.response === "accepted" ? "going" : p.response === "declined" ? "can't make it" : "hasn't answered") + "</span>").join(", ");
    const acts = org ? '<button class="linkish so-rm" data-mcancel="' + esc(m.id) + '">Cancel meeting</button>'
      : mine.response === "pending" ? '<button class="btn small primary" data-maccept="' + esc(m.id) + '">Accept</button><button class="btn small" data-mdecline="' + esc(m.id) + '">Decline</button>'
      : '<span class="so-r ' + mine.response + '">' + (mine.response === "accepted" ? "You're going" : "You declined") + '</span>' + (mine.response === "accepted" ? '<button class="linkish" data-mdecline="' + esc(m.id) + '">Can\'t make it</button>' : '<button class="linkish" data-maccept="' + esc(m.id) + '">Accept</button>');
    return '<li class="so-meet"><div class="so-mt"><strong>' + esc(m.title) + "</strong><span>" + fmtDay(m.start) + ", " + fmtT(m.start) + "–" + fmtT(m.end) + (org ? " · you proposed" : " · from " + esc(m.organizerName)) + '</span><span class="so-mp">' + others + '</span></div><div class="so-acts">' + acts + "</div></li>";
  }).join("");
}
async function refresh(quiet) {
  if (!auth) { renderAuth(); return; }
  try {
    me = await api("GET", "/api/me");
    auth.user = me.user; try { localStorage.setItem(AUTH, JSON.stringify(auth)); } catch (e) {}
    renderAuth(); renderFriends(); renderPicker(); renderMeetings();
    await uploadBusy(false);
    if (!quiet) await renderFinder();
  } catch (e) { renderAuth(); if (auth) $("#soLoading").textContent = e.message; }
}
function signOutLocal() { auth = null; me = null; try { localStorage.removeItem(AUTH); } catch (e) {} lastUpload = ""; renderAuth(); }
function note(el, msg, bad) { el.textContent = msg; el.hidden = !msg; el.classList.toggle("bad", !!bad); }

/* ---------- events ---------- */
function bind() {
  const root = $("#friends"); if (!root) return;
  $("#soDur").value = String(pref.dur); $("#soDays").value = String(pref.days); $("#soFrom").value = pref.from; $("#soUntil").value = pref.until; $("#soBuf").value = String(pref.buffer);
  $("#soTabIn").onclick = () => { mode = "in"; renderAuth(); };
  $("#soTabUp").onclick = () => { mode = "up"; renderAuth(); };
  $("#soAuthForm").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("#soAuthErr"); note(err, "");
    const body = { username: $("#soUser").value.trim(), password: $("#soPass").value };
    if (mode === "up") body.displayName = $("#soName").value.trim() || body.username;
    $("#soAuthGo").disabled = true;
    try {
      const r = await api("POST", mode === "up" ? "/api/signup" : "/api/login", body);
      auth = { token: r.token, user: r.user }; try { localStorage.setItem(AUTH, JSON.stringify(auth)); } catch (x) {}
      $("#soPass").value = ""; await refresh(false);
    } catch (x) { note(err, x.message, true); }
    $("#soAuthGo").disabled = false;
  });
  $("#soAddForm").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = $("#soAddMsg"), u = $("#soAdd").value.trim(); if (!u) return;
    try { const r = await api("POST", "/api/friends/request", { username: u }); $("#soAdd").value = ""; note(msg, r.accepted ? "They had already asked you, so you're now friends." : "Request sent. Once they accept, you can see each other's busy times."); await refresh(true); }
    catch (x) { note(msg, x.message, true); }
  });
  root.addEventListener("click", async e => {
    const t = e.target.closest("button"); if (!t) return;
    const d = t.dataset;
    try {
      if (t.id === "soOut") { try { await api("POST", "/api/logout", {}); } catch (x) {} signOutLocal(); return; }
      if (d.accept || d.decline) { await api("POST", "/api/friends/respond", { requestId: d.accept || d.decline, accept: !!d.accept }); }
      else if (d.cancel) await api("POST", "/api/friends/cancel", { requestId: d.cancel });
      else if (d.remove) { if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Remove " + d.name + "?"; setTimeout(() => { t.dataset.confirm = ""; t.textContent = "Remove"; }, 4000); return; } await api("POST", "/api/friends/remove", { userId: d.remove }); }
      else if (d.maccept || d.mdecline) await api("POST", "/api/meetings/respond", { meetingId: d.maccept || d.mdecline, accept: !!d.maccept });
      else if (d.mcancel) { if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Cancel for everyone?"; setTimeout(() => { t.dataset.confirm = ""; t.textContent = "Cancel meeting"; }, 4000); return; } await api("POST", "/api/meetings/cancel", { meetingId: d.mcancel }); }
      else if (d.propose) { openPropose(slots[+d.propose]); return; }
      else if (t.id === "soAsk") { askAssistant(); return; }
      else if (t.id === "soRefresh") { for (const k in friendBusy) delete friendBusy[k]; await refresh(false); return; }
      else if (t.id === "soDelete") { $("#soDelPass").value = ""; note($("#soDelErr"), ""); $("#dlgDelete").showModal(); return; }
      else return;
      await refresh(!(d.accept || d.remove));
    } catch (x) { note($("#soAddMsg"), x.message, true); }
  });
  root.addEventListener("change", async e => {
    const t = e.target;
    if (t.dataset.share) { try { await api("POST", "/api/friends/share", { userId: t.dataset.share, share: t.checked }); await refresh(true); } catch (x) { t.checked = !t.checked; note($("#soAddMsg"), x.message, true); } return; }
    if (t.dataset.pick) { pref.picked = t.checked ? pref.picked.concat(t.dataset.pick) : pref.picked.filter(id => id !== t.dataset.pick); savePref(); renderPicker(); renderFinder(); return; }
    const map = { soDur: ["dur", Number], soDays: ["days", Number], soFrom: ["from", String], soUntil: ["until", String], soBuf: ["buffer", Number] }[t.id];
    if (map && t.value) { pref[map[0]] = map[1](t.value); if (toMin(pref.until) - toMin(pref.from) < pref.dur) { pref.until = pref.from === "21:00" ? "23:00" : "21:00"; $("#soUntil").value = pref.until; } savePref(); renderFinder(); }
  });
  // propose dialog
  $("#meetForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = $("#meetForm")._slot;
    try { await api("POST", "/api/meetings", { title: $("#meetTitle").value.trim() || "Meeting", start: f.s, end: f.e, userIds: pref.picked }); $("#dlgMeet").close(); await refresh(false); }
    catch (x) { note($("#meetErr"), x.message, true); }
  });
  $("#meetCancel").onclick = () => $("#dlgMeet").close();
  $("#delForm").addEventListener("submit", async e => {
    e.preventDefault();
    try { await api("POST", "/api/account/delete", { password: $("#soDelPass").value }); $("#dlgDelete").close(); signOutLocal(); }
    catch (x) { note($("#soDelErr"), x.message, true); }
  });
  $("#delCancel").onclick = () => $("#dlgDelete").close();
}
function openPropose(f) {
  const names = people().filter(p => p.id !== "me").map(p => p.name);
  $("#meetForm")._slot = f;
  $("#meetWhen").textContent = fmtDay(f.s) + ", " + fmtT(f.s) + "–" + fmtT(f.e) + " with " + names.join(", ");
  $("#meetTitle").value = ""; note($("#meetErr"), "");
  $("#dlgMeet").showModal();
}
function askAssistant() {
  const compose = $("#compose"), q = $("#q");
  if (!compose || compose.hidden) { const b = $("#btnAIKey") || $("#btnAI"); if (b) b.click(); return; }
  const ps = people(), today = new Date(); today.setHours(0, 0, 0, 0);
  const lines = [];
  lines.push("Help me choose the best time for a " + pref.dur + "-minute meeting with " + (ps.length > 1 ? ps.slice(1).map(p => p.name).join(", ") : "just me") + ". Times are my local time. These are busy times only, with no details.");
  for (let n = 0; n < pref.days; n++) {
    const day = addDays(today, n).getTime(), end = day + 86400000;
    const parts = ps.map(p => { const bl = p.blocks.filter(b => b[0] < end && b[1] > day); return bl.length ? p.name + " busy " + bl.map(b => fmtT(Math.max(b[0], day)) + "–" + fmtT(Math.min(b[1], end))).join(", ") : null; }).filter(Boolean);
    lines.push("- " + fmtDay(day) + ": " + (parts.length ? parts.join("; ") : "everyone free"));
  }
  lines.push("Times when everyone is free, as ranked by the planner:");
  slots.forEach((f, i) => lines.push((i + 1) + ". " + fmtDay(f.s) + " " + fmtT(f.s) + "–" + fmtT(f.e) + " (" + why(f, ps) + ")"));
  lines.push("Pick the best one or two for everyone and explain briefly: think about energy, back-to-back classes, travel time between commitments, and not overloading anyone's busiest day.");
  q.value = lines.join("\n");
  compose.requestSubmit();
  const a = $(".assistant"); if (a) a.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Re-share busy times when the planner changes on this device. */
const prevSet = Storage.prototype.setItem;
Storage.prototype.setItem = function (k, v) { prevSet.apply(this, arguments); if (this === window.localStorage && k === KEY && auth) scheduleUpload(); };
setInterval(() => { if (auth && document.visibilityState === "visible") refresh(true); }, 60000);
setInterval(() => { if (auth) uploadBusy(false); }, 15 * 60000);

window.__social = { findSlots, myBlocks, merge };
bind(); renderAuth(); refresh(false);
})();
