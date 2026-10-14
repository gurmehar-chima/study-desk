// Study Desk: a tiny relay that lets the website use your free Ollama Cloud key.
//
// ollama.com does not accept requests made directly from web pages, so this
// Cloudflare Worker forwards the assistant's requests to ollama.com and adds
// your key on the server side. The key never reaches the browser.
//
// Settings (Cloudflare dashboard → your Worker → Settings → Variables and Secrets):
//   OLLAMA_API_KEY  (secret)  your key from https://ollama.com/settings/keys
//   ACCESS_CODE     (secret)  any long password; you type it into the site's Settings
//   ALLOWED_ORIGIN  (text)    optional; defaults to https://gurmehar-chima.github.io
//
// Setup steps: see STUDY-PLAN-AND-OLLAMA.md in this repository.

const UPSTREAM = "https://ollama.com";
const PATHS = new Set(["/api/chat", "/api/tags"]);

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || "https://gurmehar-chima.github.io";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const json = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const { pathname } = new URL(request.url);
    if (!PATHS.has(pathname)) return json(404, { error: "Not found" });
    if (request.method !== (pathname === "/api/chat" ? "POST" : "GET")) return json(405, { error: "Method not allowed" });
    if ((request.headers.get("Origin") || "") !== allowed) return json(403, { error: "This relay only serves " + allowed });
    if (!env.OLLAMA_API_KEY || !env.ACCESS_CODE) return json(500, { error: "The relay is missing OLLAMA_API_KEY or ACCESS_CODE." });

    const code = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!sameText(code, env.ACCESS_CODE)) return json(401, { error: "Wrong access code" });

    let body;
    if (pathname === "/api/chat") {
      body = await request.text();
      if (body.length > 200000) return json(413, { error: "Request too large" });
    }
    const upstream = await fetch(UPSTREAM + pathname, {
      method: request.method,
      headers: { Authorization: "Bearer " + env.OLLAMA_API_KEY, "Content-Type": "application/json" },
      body,
    });
    const headers = new Headers(cors);
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
