/* Study Desk: lets the assistant on social.html send friend requests and meeting invites.
 *
 * How it works, without changing planner.js or social.js:
 *  1. Before each question goes to the AI, this adds your Friends context (friends, requests,
 *     meetings, and busy TIMES for the next 7 days) and tells the AI how to ask for an action.
 *  2. When you ask it to, the AI ends its reply with lines like
 *       [[ACTION {"type":"meeting","title":"Calc review","with":["sam_k"],"start":"2026-10-22T16:00","minutes":60}]]
 *     Those lines are hidden from the chat and shown as cards. Nothing is sent until you click Send.
 *  3. Clicking Send uses the same friends server as the Friends section, then refreshes it.
 * Load after ai-providers.js and social.js. */
(function () {
"use strict";
const API = (function () { try { return localStorage.getItem("study-desk-social-api"); } catch (e) { return null; } })() || "https://study-desk-social.gc756325.workers.dev";
const AUTH = "study-desk-social";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const MARK = "[[ACTION";
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtT = ms => { const d = new Date(ms), h = d.getHours(); return (h % 12 || 12) + ":" + pad(d.getMinutes()) + (h < 12 ? " AM" : " PM"); };
const fmtDay = ms => { const d = new Date(ms); return DOW[d.getDay()] + " " + MON[d.getMonth()] + " " + d.getDate(); };
const localIso = ms => { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const token = () => { try { const a = JSON.parse(localStorage.getItem(AUTH) || "null"); return a && a.token; } catch (e) { return null; } };

/* ---------- friends server ---------- */
async function api(method, path, body) {
  const t = token(); if (!t) throw new Error("Sign in to Friends first.");
  let r;
  try { r = await fetch(API + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + t }, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new Error("Could not reach the Study Desk friends server."); }
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(j.error || "The server answered " + r.status + ".");
  return j;
}
let snap = null; // latest {me, busy:{id:blocks}, mine:[...]}
async function loadSnapshot() {
  if (!token()) return (snap = null);
  try {
    const me = await api("GET", "/api/me");
    const ids = me.friends.filter(f => f.sharesWithMe).map(f => f.id);
    const busy = {};
    if (ids.length) { const r = await api("POST", "/api/busy/query", { userIds: ids }); for (const id of ids) busy[id] = r.users[id] && r.users[id].shared ? r.users[id].blocks : null; }
    const mine = window.__social && window.__social.myBlocks ? window.__social.myBlocks(8) : [];
    return (snap = { me, busy, mine });
  } catch (e) { return (snap = null); }
}

/* ---------- what the AI is told ---------- */
function friendsContext(s) {
  if (!s) return "\n\n<friends>\nThe student is not signed in to Friends on this page, so you cannot send friend requests or meeting invites. If they ask, tell them to sign in or create an account in the Friends section first. Do not write ACTION lines.\n</friends>";
  const { me, busy, mine } = s, L = [];
  L.push("The student is signed in to Friends as " + me.user.displayName + " (@" + me.user.username + ").");
  L.push("Friends:"); if (!me.friends.length) L.push("- none yet");
  for (const f of me.friends) L.push("- " + f.displayName + " (@" + f.username + ")" + (f.sharesWithMe ? ", shares busy times" : ", does not share busy times with the student"));
  if (me.incoming.length) { L.push("Friend requests waiting for the student to accept:"); for (const p of me.incoming) L.push("- " + p.displayName + " (@" + p.username + ")"); }
  if (me.outgoing.length) { L.push("Requests the student sent that are still waiting:"); for (const p of me.outgoing) L.push("- " + p.displayName + " (@" + p.username + ")"); }
  const meets = me.meetings.filter(m => m.end > Date.now());
  if (meets.length) { L.push("Upcoming meetings:"); for (const m of meets) L.push("- " + m.title + ", " + fmtDay(m.start) + " " + fmtT(m.start) + "-" + fmtT(m.end) + ", with " + m.people.filter(p => p.id !== me.user.id).map(p => p.displayName + " (" + p.response + ")").join(", ")); }
  L.push("Busy times for the next 7 days (times only, no details). Anyone not listed on a day is free that day:");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const people = [{ name: "Student", blocks: mine }].concat(me.friends.filter(f => busy[f.id]).map(f => ({ name: "@" + f.username, blocks: busy[f.id] })));
  for (let n = 0; n < 7; n++) {
    const day = today.getTime() + n * 86400000, end = day + 86400000;
    const parts = people.map(p => { const bl = p.blocks.filter(b => b[0] < end && b[1] > day); return bl.length ? p.name + " busy " + bl.map(b => fmtT(Math.max(b[0], day)) + "-" + fmtT(Math.min(b[1], end))).join(", ") : null; }).filter(Boolean);
    L.push("- " + fmtDay(day) + " (" + localIso(day).slice(0, 10) + "): " + (parts.length ? parts.join("; ") : "everyone free"));
  }
  return "\n\n<friends>\n" + L.join("\n") + "\n</friends>\n\n" +
`You can also prepare friend requests and meeting invites for the student, but ONLY when the student asks you to send, invite, add, schedule or accept something. For each action, put one line at the very END of your reply, exactly in this form:
[[ACTION {"type":"friend_request","username":"their_username"}]]
[[ACTION {"type":"accept_friend","username":"their_username"}]]
[[ACTION {"type":"meeting","title":"Short title","with":["username1","username2"],"start":"YYYY-MM-DDTHH:MM","minutes":60}]]
Rules: use usernames exactly as written above, without @ (for a new friend request, use the username the student gives). Meetings are only with current friends. Pick a start time when the student and everyone invited are free, between 8 AM and 10 PM unless the student says otherwise; "start" is the student's local time in 24-hour form. Keep titles short. Before the ACTION lines, say in one or two sentences what you prepared and why that time works. The page shows each action as a card the student checks and sends, so say "I've prepared", never that it was already sent. Never invent usernames or friends.`;
}

/* ---------- reading ACTION lines out of a reply ---------- */
function scanBlock(text, from) { // from = index of "[[ACTION"; returns {end, json} or null if incomplete
  let i = text.indexOf("{", from + MARK.length);
  if (i < 0 || text.slice(from + MARK.length, i).trim()) return i < 0 ? null : { end: from + MARK.length, json: null };
  let depth = 0, inStr = false, escp = false, j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (inStr) { if (escp) escp = false; else if (c === "\\") escp = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) break;
  }
  if (j >= text.length) return null;
  const close = text.indexOf("]]", j);
  if (close < 0) return null;
  return { end: close + 2, json: text.slice(i, j + 1) };
}
function split(text, final) { // -> {visible, actions}
  let out = "", i = 0; const actions = [];
  for (;;) {
    const s = text.indexOf(MARK, i);
    if (s < 0) { out += text.slice(i); break; }
    out += text.slice(i, s);
    const b = scanBlock(text, s);
    if (!b) { if (final) out += ""; i = text.length; break; }
    if (b.json) { try { actions.push(JSON.parse(b.json)); } catch (e) {} }
    i = b.end;
  }
  if (!final) for (let k = Math.min(MARK.length, out.length); k > 0; k--) if (MARK.startsWith(out.slice(-k))) { out = out.slice(0, -k); break; }
  return { visible: out, actions };
}

/* ---------- the request/response hook ---------- */
const prevFetch = window.fetch.bind(window);
window.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : input && input.url;
  if (url !== MESSAGES_URL || !init || typeof init.body !== "string") return prevFetch(input, init);
  let body; try { body = JSON.parse(init.body); } catch (e) { return prevFetch(input, init); }
  const s = await loadSnapshot();
  body.system = (body.system || "") + friendsContext(s);
  body.max_tokens = Math.max(body.max_tokens || 0, 1500);
  const res = await prevFetch(input, Object.assign({}, init, { body: JSON.stringify(body) }));
  if (!res.ok || !res.body) return res;
  return new Response(filterStream(res.body), { status: res.status, headers: res.headers });
};
function filterStream(src) {
  const rd = src.getReader(), dec = new TextDecoder(), enc = new TextEncoder();
  let buf = "", full = "", sent = 0;
  const emit = (ctrl, text) => ctrl.enqueue(enc.encode("data: " + JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) + "\n\n"));
  const push = (ctrl, final) => { const v = split(full, final).visible; if (v.length > sent) { emit(ctrl, v.slice(sent)); sent = v.length; return true; } return false; };
  return new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await rd.read();
        if (done) {
          if (buf) handle(ctrl, buf);
          push(ctrl, true);
          const { actions } = split(full, true);
          ctrl.close();
          if (actions.length) setTimeout(() => showCards(actions), 60);
          return;
        }
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        let wrote = false;
        for (const l of lines) if (handle(ctrl, l)) wrote = true;
        if (wrote) return; // only stop once something was passed on, or the reader would wait forever
      }
    },
    cancel(r) { return rd.cancel(r); }
  });
  function handle(ctrl, line) {
    if (!line.startsWith("data:")) { ctrl.enqueue(enc.encode(line + "\n")); return true; }
    let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { ctrl.enqueue(enc.encode(line + "\n")); return true; }
    if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") { full += ev.delta.text; return push(ctrl, false); } // nothing new to show while an ACTION line is arriving
    ctrl.enqueue(enc.encode(line + "\n")); return true;
  }
}

/* ---------- action cards ---------- */
function parseStart(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(String(v || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN;
}
const norm = u => String(u || "").trim().replace(/^@/, "").toLowerCase();
function plan(a) { // -> {kind, text, warn, run} or {error}
  const s = snap, me = s && s.me;
  if (!me) return { error: "Sign in to Friends to send this." };
  const byUser = u => me.friends.find(f => norm(f.username) === norm(u) || norm(f.displayName) === norm(u));
  if (a.type === "friend_request") {
    const u = norm(a.username); if (!u) return { error: "The assistant didn't name a username." };
    if (u === norm(me.user.username)) return { error: "That's your own username." };
    if (byUser(u)) return { error: "@" + u + " is already your friend." };
    if (me.outgoing.some(p => norm(p.username) === u)) return { error: "You already sent @" + u + " a request." };
    return { kind: "Friend request", text: "Send a friend request to <strong>@" + esc(u) + "</strong>", run: () => api("POST", "/api/friends/request", { username: u }), done: "Request sent" };
  }
  if (a.type === "accept_friend") {
    const p = me.incoming.find(x => norm(x.username) === norm(a.username) || norm(x.displayName) === norm(a.username));
    if (!p) return { error: "There's no waiting request from @" + esc(norm(a.username)) + "." };
    return { kind: "Accept request", text: "Accept <strong>" + esc(p.displayName) + "</strong>'s friend request (@" + esc(p.username) + ")", run: () => api("POST", "/api/friends/respond", { requestId: p.requestId, accept: true }), done: "Accepted" };
  }
  if (a.type === "meeting") {
    const names = (Array.isArray(a.with) ? a.with : [a.with]).filter(Boolean);
    const people = [], missing = [];
    for (const n of names) { const f = byUser(n); if (f) people.push(f); else missing.push(norm(n)); }
    if (missing.length) return { error: "Not your friends yet: @" + missing.map(esc).join(", @") + ". Send a friend request first." };
    if (!people.length) return { error: "The assistant didn't say who to invite." };
    const start = parseStart(a.start), mins = Math.min(480, Math.max(15, Math.round(+a.minutes || 60))), end = start + mins * 60000;
    if (!isFinite(start)) return { error: "The assistant gave a time I couldn't read." };
    if (start < Date.now()) return { error: "That time (" + fmtDay(start) + ", " + fmtT(start) + ") has already passed." };
    const clash = b => b.some(x => x[0] < end && x[1] > start), warn = [];
    if (clash(s.mine)) warn.push("You're busy then");
    for (const f of people) { const bl = s.busy[f.id]; if (bl === undefined || bl === null) warn.push("Can't check " + f.displayName + "'s calendar (not shared)"); else if (clash(bl)) warn.push(f.displayName + " is busy then"); }
    const title = String(a.title || "Meeting").slice(0, 80);
    return { kind: "Meeting invite", text: "Invite <strong>" + people.map(f => esc(f.displayName)).join(", ") + "</strong> to <strong>" + esc(title) + "</strong><br>" + fmtDay(start) + ", " + fmtT(start) + "–" + fmtT(end),
      warn: warn.join(" · "), run: () => api("POST", "/api/meetings", { title, start, end, userIds: people.map(f => f.id) }), done: "Invite sent" };
  }
  return { error: "The assistant asked for something this page can't do." };
}
function showCards(actions) {
  const bubbles = document.querySelectorAll("#log .msg.a"), b = bubbles[bubbles.length - 1];
  if (!b) return;
  if (/^\s*\(no answer\)\s*$/.test(b.textContent)) b.innerHTML = "<p>Here's what I prepared for you:</p>";
  const wrap = document.createElement("div"); wrap.className = "ai-acts";
  for (const a of actions.slice(0, 6)) {
    const p = plan(a || {}), card = document.createElement("div");
    card.className = "ai-act" + (p.error ? " bad" : "");
    if (p.error) { card.innerHTML = '<div class="ai-act-k">Can\'t prepare this</div><div class="ai-act-t">' + p.error + "</div>"; wrap.appendChild(card); continue; }
    card.innerHTML = '<div class="ai-act-k">' + p.kind + '</div><div class="ai-act-t">' + p.text + "</div>" + (p.warn ? '<div class="ai-act-w">' + esc(p.warn) + "</div>" : "") +
      '<div class="ai-act-b"><button class="btn small primary" type="button">' + (p.warn ? "Send anyway" : "Send") + '</button><button class="btn small" type="button">Skip</button></div>';
    const [send, skip] = card.querySelectorAll("button");
    send.onclick = async () => {
      send.disabled = skip.disabled = true; send.textContent = "Sending…";
      try { await p.run(); card.querySelector(".ai-act-b").innerHTML = '<span class="ai-act-ok">' + p.done + "</span>"; card.classList.add("ok"); const r = $("#soRefresh"); if (r) r.click(); }
      catch (e) { send.disabled = skip.disabled = false; send.textContent = "Try again"; let w = card.querySelector(".ai-act-w"); if (!w) { w = document.createElement("div"); w.className = "ai-act-w"; card.insertBefore(w, card.querySelector(".ai-act-b")); } w.textContent = e.message; }
    };
    skip.onclick = () => { card.querySelector(".ai-act-b").innerHTML = '<span class="ai-act-skip">Skipped</span>'; card.classList.add("skipped"); };
    wrap.appendChild(card);
  }
  b.appendChild(wrap);
  const log = $("#log"); if (log) log.scrollTop = log.scrollHeight;
}

/* ---------- small additions to the assistant panel ---------- */
function addHints() {
  const chips = $("#chips");
  if (chips && !chips.querySelector("[data-fill]")) {
    const add = (label, text) => { const b = document.createElement("button"); b.type = "button"; b.dataset.fill = text; b.textContent = label; chips.appendChild(b); };
    add("Invite a friend", "Invite @ to a 1-hour study session this week at a time we're both free.");
    add("Add a friend", "Send a friend request to @");
    chips.addEventListener("click", e => {
      const b = e.target.closest("[data-fill]"); if (!b) return;
      e.stopPropagation();
      const q = $("#q"); if (!q) return;
      q.value = b.dataset.fill; q.focus(); const at = q.value.indexOf("@") + 1; q.setSelectionRange(at, at);
    }, true);
  }
  const fine = document.querySelector(".assistant .fine");
  if (fine && !fine.dataset.actions) { fine.dataset.actions = "1"; fine.textContent += " On this page it can also prepare friend requests and meeting invites when you ask; you check and send each one."; }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addHints); else addHints();

window.__aiActions = { split, plan, friendsContext, parseStart }; // for checking the logic
})();
