/* Study Desk: assistant providers for plan.html.
 * app.js talks to Claude's Messages API. This file lets the same assistant use a free
 * Ollama model instead, without changing app.js:
 *   - "ollama"       Ollama running on this computer (http://localhost:11434), no key
 *   - "ollama-cloud" Ollama Cloud with your free key, through your own small relay
 *                    (ollama.com does not accept requests straight from web pages)
 *   - Claude         unchanged; requests pass through untouched
 * It works by answering app.js's request to the Claude API with an Ollama reply in
 * the same streaming format, when the chosen model starts with "ollama:" or "ollama-cloud:". */
(function () {
"use strict";
const CFG = "study-desk-ollama";
const DEFAULT_HOST = "http://localhost:11434";
const getCfg = () => { try { return JSON.parse(localStorage.getItem(CFG) || "{}") || {}; } catch (e) { return {}; } };
const setCfg = c => { try { localStorage.setItem(CFG, JSON.stringify(c)); } catch (e) {} };
const trim = u => String(u || "").trim().replace(/\/+$/, "");

/* ---------- request adapter ---------- */
const realFetch = window.fetch.bind(window);
function reply(status, message) {
  return new Response(JSON.stringify({ type: "error", error: { message } }), { status, headers: { "content-type": "application/json" } });
}
function headerValue(h, name) {
  if (!h) return "";
  if (typeof h.get === "function") return h.get(name) || "";
  for (const k of Object.keys(h)) if (k.toLowerCase() === name) return h[k];
  return "";
}
function toEventStream(src) {
  const rd = src.getReader(), dec = new TextDecoder(), enc = new TextEncoder();
  let buf = "";
  const out = (ctrl, line) => {
    line = line.trim(); if (!line) return false;
    let j; try { j = JSON.parse(line); } catch (e) { return false; }
    if (j.error) { ctrl.enqueue(enc.encode("data: " + JSON.stringify({ type: "error", error: { message: String(j.error) } }) + "\n")); return true; }
    const t = j.message && j.message.content;
    if (t) { ctrl.enqueue(enc.encode("data: " + JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: t } }) + "\n")); return true; }
    return false;
  };
  return new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await rd.read();
        if (done) { out(ctrl, buf); ctrl.close(); return; }
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        let sent = false; for (const l of lines) if (out(ctrl, l)) sent = true;
        if (sent) return;
      }
    },
    cancel(r) { return rd.cancel(r); }
  });
}
window.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : input && input.url;
  if (url !== "https://api.anthropic.com/v1/messages" || !init || typeof init.body !== "string") return realFetch(input, init);
  let body; try { body = JSON.parse(init.body); } catch (e) { return realFetch(input, init); }
  const m = /^(ollama|ollama-cloud):(.+)$/.exec(body.model || "");
  if (!m) return realFetch(input, init);
  const cloud = m[1] === "ollama-cloud", cfg = getCfg();
  const base = cloud ? trim(cfg.proxy) : trim(cfg.host || DEFAULT_HOST);
  if (!base) return reply(400, "Add your relay address under Settings.");
  const headers = { "content-type": "application/json" };
  const code = headerValue(init.headers, "x-api-key");
  if (cloud && code) headers.authorization = "Bearer " + code;
  const messages = [];
  if (body.system) messages.push({ role: "system", content: body.system });
  for (const x of body.messages || []) messages.push({ role: x.role, content: typeof x.content === "string" ? x.content : (x.content || []).map(p => p.text || "").join("") });
  let r;
  try {
    r = await realFetch(base + "/api/chat", { method: "POST", headers, body: JSON.stringify({ model: m[2], messages, stream: true }), signal: init.signal });
  } catch (e) {
    return reply(503, cloud ? "Could not reach your relay at " + base + ". Check the address under Settings."
      : "Could not reach Ollama at " + base + ". Make sure Ollama is running and allows this site (see the setup guide).");
  }
  if (!r.ok) {
    let msg = ""; try { msg = (await r.json()).error || ""; } catch (e) {}
    if (r.status === 403 && !cloud) msg = msg || "Ollama refused this site. Set OLLAMA_ORIGINS as the setup guide shows.";
    return reply(r.status, msg || "Ollama answered " + r.status);
  }
  return new Response(toEventStream(r.body), { status: 200, headers: { "content-type": "text/event-stream" } });
};

/* ---------- settings dialog ---------- */
const $ = s => document.querySelector(s);
function show() {
  const p = $("#pvProvider").value;
  $("#pvLocal").hidden = p !== "ollama"; $("#pvCloud").hidden = p !== "ollama-cloud"; $("#pvAnth").hidden = p !== "anthropic";
  $("#pvTest").hidden = p === "anthropic";
  const ph = { ollama: "llama3.2", "ollama-cloud": "gemma4:31b", anthropic: "claude-haiku-4-5-20251001" }[p];
  $("#pvModel").placeholder = ph;
  $("#pvResult").hidden = true;
}
function fill() {
  // app.js has just copied its saved key and model into the hidden #aiKey / #aiModel fields.
  const cfg = getCfg(), model = $("#aiModel").value || "", key = $("#aiKey").value || "";
  const m = /^(ollama|ollama-cloud):(.+)$/.exec(model);
  const p = m ? m[1] : (key ? "anthropic" : "ollama");
  $("#pvProvider").value = p;
  $("#pvModel").value = m ? m[2] : (key ? model : "");
  $("#pvHost").value = cfg.host || DEFAULT_HOST;
  $("#pvProxy").value = cfg.proxy || "";
  $("#pvCode").value = p === "ollama-cloud" ? key : "";
  $("#pvKey").value = p === "anthropic" ? key : "";
  show();
}
function result(msg, bad) { const r = $("#pvResult"); r.textContent = msg; r.hidden = false; r.classList.toggle("bad", !!bad); }
async function test() {
  const p = $("#pvProvider").value;
  const base = p === "ollama" ? trim($("#pvHost").value || DEFAULT_HOST) : trim($("#pvProxy").value);
  if (!base) return result("Enter the relay address first.", true);
  result("Checking…");
  const headers = p === "ollama-cloud" ? { authorization: "Bearer " + $("#pvCode").value.trim() } : {};
  try {
    const r = await realFetch(base + "/api/tags", { headers });
    if (r.status === 401) return result("The relay rejected the access code.", true);
    if (!r.ok) return result("Connected, but it answered " + r.status + ".", true);
    const names = ((await r.json()).models || []).map(x => x.name || x.model).filter(Boolean);
    $("#pvModels").innerHTML = names.map(n => '<option value="' + n.replace(/"/g, "&quot;") + '">').join("");
    if (!names.length) return result(p === "ollama" ? "Connected, but no models are installed. Run: ollama pull llama3.2" : "Connected, but no models were listed.", true);
    if (!$("#pvModel").value) $("#pvModel").value = names[0];
    result("Connected. Available models: " + names.slice(0, 8).join(", ") + (names.length > 8 ? ", …" : ""));
  } catch (e) {
    result(p === "ollama"
      ? "Could not reach Ollama at " + base + ". Check that Ollama is running and that OLLAMA_ORIGINS includes " + location.origin + ". In Chrome, allow local network access if asked."
      : "Could not reach the relay at " + base + ". Check the address.", true);
  }
}
function beforeSave(e) {
  // Runs before app.js's own save handler and fills in what it will store.
  if (e.target.id !== "aiForm") return;
  const p = $("#pvProvider").value, model = $("#pvModel").value.trim() || $("#pvModel").placeholder;
  const cfg = getCfg();
  if (p === "ollama") { cfg.host = trim($("#pvHost").value) || DEFAULT_HOST; $("#aiKey").value = "local"; $("#aiModel").value = "ollama:" + model; }
  else if (p === "ollama-cloud") {
    const proxy = trim($("#pvProxy").value), code = $("#pvCode").value.trim();
    if (!proxy || !code) { e.preventDefault(); e.stopPropagation(); return result("Enter the relay address and access code.", true); }
    cfg.proxy = proxy; $("#aiKey").value = code; $("#aiModel").value = "ollama-cloud:" + model;
  } else {
    const key = $("#pvKey").value.trim();
    if (!key) { e.preventDefault(); e.stopPropagation(); return result("Paste your Anthropic API key.", true); }
    $("#aiKey").value = key; $("#aiModel").value = model;
  }
  setCfg(cfg);
}
function init() {
  if (!$("#pvProvider")) return;
  $("#pvProvider").addEventListener("change", show);
  $("#pvTest").addEventListener("click", test);
  document.addEventListener("submit", beforeSave, true);
  for (const id of ["#btnAI", "#btnAIKey"]) { const b = $(id); if (b) b.addEventListener("click", fill); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
