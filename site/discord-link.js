/* Study Desk: "Connect Discord" on social.html.
 * Links your Study Desk account to the Study Desk Discord app, and while linked, keeps a private
 * copy of your classes and upcoming deadlines on the Study Desk server so the Discord assistant
 * can answer. Disconnecting deletes that copy. Loaded after social.js. */
(function () {
"use strict";
const API = (function () { try { return localStorage.getItem("study-desk-social-api"); } catch (e) { return null; } })() || "https://study-desk-social.gc756325.workers.dev";
const AUTH = "study-desk-social", KEY = "study-desk-v1";
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const ago = ms => { if (!ms) return "never"; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
const token = () => { try { const a = JSON.parse(localStorage.getItem(AUTH) || "null"); return a && a.token; } catch (e) { return null; } };

let status = null, code = null, poll = null, upTimer = null, lastSig = "";
async function api(method, path, body) {
  const t = token(); if (!t) throw new Error("Sign in first.");
  let r;
  try { r = await fetch(API + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + t }, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new Error("Could not reach the Study Desk server."); }
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(j.error || "The server answered " + r.status + ".");
  return j;
}

/* ---------- the private schedule copy ---------- */
function snapshot() {
  let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  if (!s || s.v !== 1 || !s.started) return { tz, classes: [], items: [] };
  const today = new Date(), lo = ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14)), hi = ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 45));
  return {
    tz,
    classes: (s.classes || []).map(c => ({ title: c.title, course: c.course, days: c.days, start: c.start, end: c.end, from: c.from, until: c.until, interval: c.interval || 1 })),
    items: (s.items || []).filter(i => i.date >= lo && i.date <= hi).map(i => ({ title: i.title, course: i.course, date: i.date, time: i.time || "", end: i.end || "", kind: i.kind, done: !!i.done })),
  };
}
async function upload(force) {
  if (!status || !status.linked) return;
  const snap = snapshot(), sig = JSON.stringify(snap);
  if (!force && sig === lastSig) return;
  try { await api("PUT", "/api/schedule", snap); lastSig = sig; status.scheduleUpdatedAt = Date.now(); render(); }
  catch (e) { note(e.message, true); }
}

/* ---------- panel ---------- */
function ensurePanel() {
  if ($("#dcPanel")) return $("#dcPanel");
  const body = document.querySelector("#friends .so-body"), foot = $("#soFoot");
  if (!body) return null;
  const el = document.createElement("div");
  el.id = "dcPanel"; el.className = "dc"; el.hidden = true;
  body.insertBefore(el, foot || null);
  el.addEventListener("click", onClick);
  return el;
}
function note(msg, bad) { const n = $("#dcNote"); if (n) { n.textContent = msg || ""; n.hidden = !msg; n.classList.toggle("bad", !!bad); } }
function render() {
  const el = ensurePanel(); if (!el) return;
  const signedIn = !!token() && $("#soApp") && !$("#soApp").hidden;
  el.hidden = !signedIn || !status;
  if (el.hidden) return;
  const logo = '<svg class="dc-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 5.3A17 17 0 0 0 15.8 4l-.5 1a15.7 15.7 0 0 0-6.6 0l-.5-1A17 17 0 0 0 4 5.3C1.4 9.2.7 13 1 16.8a17 17 0 0 0 5.2 2.6l1.1-1.8c-.6-.2-1.2-.5-1.8-.9l.4-.3a12 12 0 0 0 12.2 0l.4.3c-.6.4-1.2.7-1.8.9l1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.4-.6-8.2-3-11.5ZM8.7 14.5c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Z"/></svg>';
  let h = '<div class="dc-head">' + logo + "<h3>Study Desk on Discord</h3></div>";
  if (!status.available) {
    h += '<p class="so-hint">The Discord app isn\'t set up on this Study Desk server yet.</p>';
  } else if (status.linked) {
    h += "<p>Connected as <strong>" + esc(status.discordName) + "</strong>. In Discord, type <code>/today</code> or <code>/ask</code> in a DM with the Study Desk app, or in any chat. Replies are only visible to you.</p>" +
      '<p class="so-hint">Schedule copy updated ' + ago(status.scheduleUpdatedAt) + ". It updates when you open this page or change your planner.</p>" +
      '<div class="row-btns"><button class="btn small" type="button" data-dc="sync">Update now</button><a class="btn small" href="' + esc(status.installUrl) + '" target="_blank" rel="noopener">Add the app again</a><button class="linkish so-rm" type="button" data-dc="unlink">Disconnect</button></div>';
  } else if (code) {
    h += '<ol class="steps dc-steps"><li><a href="' + esc(status.installUrl) + '" target="_blank" rel="noopener"><strong>Add Study Desk to your Discord account</strong></a> and choose <strong>Add to My Apps</strong>.</li>' +
      '<li>In Discord, open a DM with the Study Desk app (or any chat), type <code>/link</code>, and enter this code:</li></ol>' +
      '<div class="dc-code"><span id="dcCode">' + esc(code.code) + '</span><button class="btn small" type="button" data-dc="copy">Copy</button><span class="so-hint">expires in 10 minutes</span></div>' +
      '<p class="so-hint" id="dcWait">Waiting for Discord… this updates by itself.</p><button class="linkish" type="button" data-dc="cancel">Cancel</button>';
  } else {
    h += "<p>Ask the Study Desk assistant from Discord: what's due, plan your day, or invite friends to study. Type <code>/ask</code> or <code>/today</code> in a DM with the app or in any chat.</p>" +
      '<p class="so-hint">Connecting keeps a private copy of your classes and assignment titles for the next six weeks on the Study Desk server so the bot can answer. Friends can\'t see it, and disconnecting deletes it.</p>' +
      '<button class="btn primary" type="button" data-dc="connect">Connect Discord</button>';
  }
  h += '<div class="result" id="dcNote" hidden></div>';
  el.innerHTML = h;
}
async function onClick(e) {
  const b = e.target.closest("[data-dc]"); if (!b) return;
  const what = b.dataset.dc;
  try {
    if (what === "connect") { code = await api("POST", "/api/discord/code"); render(); startPoll(); }
    else if (what === "cancel") { code = null; stopPoll(); render(); }
    else if (what === "copy") { try { await navigator.clipboard.writeText(code.code); b.textContent = "Copied"; } catch (x) { const r = document.createRange(); r.selectNodeContents($("#dcCode")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } }
    else if (what === "sync") { await upload(true); note("Schedule copy updated."); }
    else if (what === "unlink") {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Disconnect and delete the copy?"; setTimeout(() => { b.dataset.confirm = ""; b.textContent = "Disconnect"; }, 4000); return; }
      await api("POST", "/api/discord/unlink"); status.linked = false; lastSig = ""; render(); note("Disconnected. Your schedule copy was deleted.");
    }
  } catch (x) { note(x.message, true); }
}
function startPoll() {
  stopPoll(); const until = Date.now() + 10 * 60000;
  poll = setInterval(async () => {
    if (Date.now() > until) { stopPoll(); code = null; render(); note("The code expired. Click Connect Discord to get a new one.", true); return; }
    try { const s = await api("GET", "/api/discord/status"); if (s.linked) { status = s; code = null; stopPoll(); await upload(true); render(); note("Connected! Try /today in Discord."); } } catch (x) {}
  }, 4000);
}
function stopPoll() { if (poll) clearInterval(poll); poll = null; }

async function refreshStatus() {
  if (!token()) { status = null; render(); return; }
  try { status = await api("GET", "/api/discord/status"); render(); if (status.linked) upload(false); }
  catch (e) { status = null; render(); }
}

/* Watch the Friends section: show the panel when signed in, refresh when the account changes. */
let wasSignedIn = null;
function watch() {
  const app = $("#soApp"); if (!app) return;
  const check = () => { const now = !!token() && !app.hidden; if (now !== wasSignedIn) { wasSignedIn = now; if (now) refreshStatus(); else { status = null; code = null; stopPoll(); render(); } } };
  new MutationObserver(check).observe(app, { attributes: true, attributeFilter: ["hidden"] });
  check();
}
const prevSet = Storage.prototype.setItem;
Storage.prototype.setItem = function (k, v) { prevSet.apply(this, arguments); if (this === window.localStorage && k === KEY && status && status.linked) { clearTimeout(upTimer); upTimer = setTimeout(() => upload(false), 3000); } };
setInterval(() => { if (status && status.linked && document.visibilityState === "visible") upload(false); }, 30 * 60000);

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
window.__discordLink = { snapshot };
})();
