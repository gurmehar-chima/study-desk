// Study Desk social backend: accounts, friends, shared busy times and meeting invites.
//
// Runs as a Cloudflare Worker with a D1 (SQLite) database bound as DB.
// Privacy by design: the page only ever uploads busy START and END times. Class names,
// assignment titles and event details never leave the student's browser.
//
// Settings (Cloudflare dashboard → this Worker → Settings → Variables and Secrets):
//   ALLOWED_ORIGIN (text, optional) defaults to https://gurmehar-chima.github.io

const DEFAULT_ORIGIN = "https://gurmehar-chima.github.io";
const DAY = 86400000;
const SESSION_DAYS = 60;
const PBKDF2_ITER = 100000; // the maximum Cloudflare Workers allows

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     display_name TEXT NOT NULL, pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS friends (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
     status TEXT NOT NULL, from_shares INTEGER NOT NULL DEFAULT 1, to_shares INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL, UNIQUE(from_id, to_id))`,
  `CREATE INDEX IF NOT EXISTS friends_to ON friends(to_id)`,
  `CREATE TABLE IF NOT EXISTS busy (user_id TEXT PRIMARY KEY, blocks TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL, title TEXT NOT NULL,
     start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meeting_people (meeting_id TEXT NOT NULL, user_id TEXT NOT NULL, response TEXT NOT NULL,
     PRIMARY KEY (meeting_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS meeting_people_user ON meeting_people(user_id)`,
  `CREATE TABLE IF NOT EXISTS login_fail (username TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL)`,
];

let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) schemaReady = db.batch(SCHEMA.map(s => db.prepare(s))).catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/api/health") return json(200, { ok: true, service: "study-desk-social" });
    const origin = request.headers.get("Origin") || "";
    if (origin !== allowed) return json(403, { error: "This service only serves " + allowed });
    if (!env.DB) return json(500, { error: "The database is not connected to this Worker." });

    try {
      await ensureSchema(env.DB);
      const route = ROUTES[request.method + " " + url.pathname];
      if (!route) return json(404, { error: "Not found" });
      let body = {};
      if (request.method !== "GET") {
        const text = await request.text();
        if (text.length > 200000) fail(413, "Request too large.");
        if (text) { try { body = JSON.parse(text); } catch (e) { fail(400, "Request was not valid JSON."); } }
        if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "Request was not a JSON object.");
      }
      const ctx = { db: env.DB, body, request };
      if (!route.public) ctx.user = await authenticate(env.DB, request);
      return json(200, await route.run(ctx));
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.error(e && e.stack || e);
      return json(500, { error: "Something went wrong on the server. Try again." });
    }
  },
};

/* ---------------- helpers ---------------- */
const now = () => Date.now();
function b64url(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function randomId(n = 16) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }
async function sha256(text) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return b64url(new Uint8Array(d)); }
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITER }, key, 256);
  return b64url(new Uint8Array(bits));
}
function sameText(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const cleanName = s => String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
const USERNAME = /^[a-z0-9_.]{3,24}$/i;
const publicUser = u => ({ id: u.id, username: u.username, displayName: u.display_name });

async function authenticate(db, request) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token.length > 100) fail(401, "Please sign in.");
  const row = await db.prepare(`SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1`).bind(await sha256(token)).first();
  if (!row || row.expires_at < now()) fail(401, "Your session ended. Please sign in again.");
  return row;
}
async function newSession(db, userId) {
  const token = randomId(32);
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND expires_at < ?2`).bind(userId, now()),
    db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)`).bind(await sha256(token), userId, now() + SESSION_DAYS * DAY),
  ]);
  return token;
}
async function relation(db, a, b) {
  return db.prepare(`SELECT * FROM friends WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)`).bind(a, b).first();
}
const sharesWith = (rel, ownerId) => rel.from_id === ownerId ? !!rel.from_shares : !!rel.to_shares; // does ownerId share with the other person?
function str(v, max, what) { const s = cleanName(v); if (!s) fail(400, what + " is required."); if (s.length > max) fail(400, what + " must be " + max + " characters or fewer."); return s; }

/* ---------------- routes ---------------- */
const ROUTES = {
  "POST /api/signup": { public: true, async run({ db, body }) {
    const username = String(body.username || "").trim();
    if (!USERNAME.test(username)) fail(400, "Usernames are 3 to 24 letters, numbers, dots or underscores.");
    const password = String(body.password || "");
    if (password.length < 8 || password.length > 200) fail(400, "Use a password of at least 8 characters.");
    const displayName = str(body.displayName || username, 40, "Name");
    if (await db.prepare(`SELECT 1 FROM users WHERE username = ?1`).bind(username).first()) fail(409, "That username is taken. Try another.");
    const id = randomId(12), salt = randomId(16);
    await db.prepare(`INSERT INTO users (id, username, display_name, pass_hash, salt, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(id, username, displayName, await hashPassword(password, salt), salt, now()).run();
    return { token: await newSession(db, id), user: { id, username, displayName } };
  } },

  "POST /api/login": { public: true, async run({ db, body }) {
    const username = String(body.username || "").trim(), password = String(body.password || "");
    const lock = await db.prepare(`SELECT * FROM login_fail WHERE username = ?1 COLLATE NOCASE`).bind(username).first();
    if (lock && lock.count >= 8 && lock.until > now()) fail(429, "Too many wrong passwords. Wait 10 minutes and try again.");
    const u = await db.prepare(`SELECT * FROM users WHERE username = ?1`).bind(username).first();
    const ok = u && sameText(await hashPassword(password, u.salt), u.pass_hash);
    if (!ok) {
      const count = lock && lock.until > now() ? lock.count + 1 : 1;
      await db.prepare(`INSERT INTO login_fail (username, count, until) VALUES (?1, ?2, ?3) ON CONFLICT(username) DO UPDATE SET count = ?2, until = ?3`)
        .bind(username.toLowerCase(), count, now() + 10 * 60000).run();
      fail(401, "That username and password don't match.");
    }
    await db.prepare(`DELETE FROM login_fail WHERE username = ?1 COLLATE NOCASE`).bind(username).run();
    return { token: await newSession(db, u.id), user: publicUser(u) };
  } },

  "POST /api/logout": { async run({ db, request }) {
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    await db.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(await sha256(token)).run();
    return { ok: true };
  } },

  "GET /api/me": { async run({ db, user }) {
    const me = user.id;
    const rels = (await db.prepare(
      `SELECT f.*, u.username, u.display_name, b.updated_at AS busy_at FROM friends f
         JOIN users u ON u.id = CASE WHEN f.from_id = ?1 THEN f.to_id ELSE f.from_id END
         LEFT JOIN busy b ON b.user_id = u.id
       WHERE f.from_id = ?1 OR f.to_id = ?1 ORDER BY u.display_name COLLATE NOCASE`).bind(me).all()).results || [];
    const friends = [], incoming = [], outgoing = [];
    for (const r of rels) {
      const otherId = r.from_id === me ? r.to_id : r.from_id;
      const person = { id: otherId, username: r.username, displayName: r.display_name };
      if (r.status === "accepted") friends.push({ ...person, iShare: sharesWith(r, me), sharesWithMe: sharesWith(r, otherId), busyUpdatedAt: sharesWith(r, otherId) ? r.busy_at || null : null });
      else if (r.to_id === me) incoming.push({ ...person, requestId: r.id, sentAt: r.created_at });
      else outgoing.push({ ...person, requestId: r.id, sentAt: r.created_at });
    }
    const meetRows = (await db.prepare(
      `SELECT m.*, o.display_name AS organizer_name FROM meetings m JOIN users o ON o.id = m.organizer_id
       WHERE m.status = 'active' AND m.end_ms > ?2 AND m.id IN (SELECT meeting_id FROM meeting_people WHERE user_id = ?1)
       ORDER BY m.start_ms LIMIT 100`).bind(me, now() - DAY).all()).results || [];
    const meetings = [];
    for (const m of meetRows) {
      const people = (await db.prepare(`SELECT p.user_id, p.response, u.display_name, u.username FROM meeting_people p JOIN users u ON u.id = p.user_id WHERE p.meeting_id = ?1`).bind(m.id).all()).results || [];
      meetings.push({ id: m.id, title: m.title, start: m.start_ms, end: m.end_ms, organizerId: m.organizer_id, organizerName: m.organizer_name,
        people: people.map(p => ({ id: p.user_id, displayName: p.display_name, username: p.username, response: p.response })) });
    }
    const mine = await db.prepare(`SELECT updated_at FROM busy WHERE user_id = ?1`).bind(me).first();
    return { user: publicUser(user), friends, incoming, outgoing, meetings, myBusyUpdatedAt: mine ? mine.updated_at : null };
  } },

  "POST /api/friends/request": { async run({ db, user, body }) {
    const target = await db.prepare(`SELECT * FROM users WHERE username = ?1`).bind(String(body.username || "").trim().replace(/^@/, "")).first();
    if (!target) fail(404, "No one has that username. Check the spelling with your friend.");
    if (target.id === user.id) fail(400, "That's your own username.");
    const rel = await relation(db, user.id, target.id);
    if (rel && rel.status === "accepted") fail(409, "You're already friends.");
    if (rel && rel.from_id === user.id) fail(409, "You already sent a request. Waiting for them to accept.");
    if (rel) { // they had already asked me: accept it
      await db.prepare(`UPDATE friends SET status = 'accepted' WHERE id = ?1`).bind(rel.id).run();
      return { ok: true, accepted: true };
    }
    const outstanding = await db.prepare(`SELECT COUNT(*) AS n FROM friends WHERE from_id = ?1 AND status = 'pending'`).bind(user.id).first();
    if (outstanding.n >= 50) fail(429, "You have 50 requests waiting. Cancel some before sending more.");
    await db.prepare(`INSERT INTO friends (id, from_id, to_id, status, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)`).bind(randomId(), user.id, target.id, now()).run();
    return { ok: true, accepted: false };
  } },

  "POST /api/friends/respond": { async run({ db, user, body }) {
    const rel = await db.prepare(`SELECT * FROM friends WHERE id = ?1 AND to_id = ?2 AND status = 'pending'`).bind(String(body.requestId || ""), user.id).first();
    if (!rel) fail(404, "That request is no longer waiting.");
    if (body.accept) await db.prepare(`UPDATE friends SET status = 'accepted' WHERE id = ?1`).bind(rel.id).run();
    else await db.prepare(`DELETE FROM friends WHERE id = ?1`).bind(rel.id).run();
    return { ok: true };
  } },

  "POST /api/friends/cancel": { async run({ db, user, body }) {
    await db.prepare(`DELETE FROM friends WHERE id = ?1 AND from_id = ?2 AND status = 'pending'`).bind(String(body.requestId || ""), user.id).run();
    return { ok: true };
  } },

  "POST /api/friends/remove": { async run({ db, user, body }) {
    const rel = await relation(db, user.id, String(body.userId || ""));
    if (rel) await db.prepare(`DELETE FROM friends WHERE id = ?1`).bind(rel.id).run();
    return { ok: true };
  } },

  "POST /api/friends/share": { async run({ db, user, body }) {
    const rel = await relation(db, user.id, String(body.userId || ""));
    if (!rel || rel.status !== "accepted") fail(404, "You're not friends with that person.");
    const col = rel.from_id === user.id ? "from_shares" : "to_shares";
    await db.prepare(`UPDATE friends SET ${col} = ?1 WHERE id = ?2`).bind(body.share ? 1 : 0, rel.id).run();
    return { ok: true };
  } },

  "PUT /api/busy": { async run({ db, user, body }) {
    if (!Array.isArray(body.blocks)) fail(400, "blocks must be a list.");
    const lo = now() - 2 * DAY, hi = now() + 75 * DAY, clean = [];
    for (const b of body.blocks) {
      if (!Array.isArray(b) || b.length !== 2) fail(400, "Each block is [start, end].");
      const s = Math.round(+b[0]), e = Math.round(+b[1]);
      if (!isFinite(s) || !isFinite(e) || e <= s || e - s > DAY) fail(400, "A busy block has invalid times.");
      if (e < lo || s > hi) continue;
      clean.push([s, e]);
    }
    if (clean.length > 1500) fail(400, "Too many busy blocks.");
    clean.sort((a, b) => a[0] - b[0]);
    await db.prepare(`INSERT INTO busy (user_id, blocks, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET blocks = ?2, updated_at = ?3`)
      .bind(user.id, JSON.stringify(clean), now()).run();
    return { ok: true, count: clean.length };
  } },

  "POST /api/busy/query": { async run({ db, user, body }) {
    const ids = Array.isArray(body.userIds) ? body.userIds.slice(0, 20).map(String) : [];
    const out = {};
    for (const id of ids) {
      const rel = await relation(db, user.id, id);
      if (!rel || rel.status !== "accepted" || !sharesWith(rel, id)) { out[id] = { shared: false }; continue; }
      const row = await db.prepare(`SELECT blocks, updated_at FROM busy WHERE user_id = ?1`).bind(id).first();
      out[id] = { shared: true, blocks: row ? JSON.parse(row.blocks) : [], updatedAt: row ? row.updated_at : null };
    }
    return { users: out };
  } },

  "POST /api/meetings": { async run({ db, user, body }) {
    const title = str(body.title || "Meeting", 80, "Title");
    const start = Math.round(+body.start), end = Math.round(+body.end);
    if (!isFinite(start) || !isFinite(end) || end <= start || end - start > 8 * 3600000) fail(400, "Pick a meeting time up to 8 hours long.");
    if (start < now() - 5 * 60000 || start > now() + 120 * DAY) fail(400, "Pick a time in the next 120 days.");
    const ids = [...new Set((Array.isArray(body.userIds) ? body.userIds : []).map(String))].filter(id => id !== user.id);
    if (!ids.length) fail(400, "Invite at least one friend.");
    if (ids.length > 12) fail(400, "Invite at most 12 friends.");
    for (const id of ids) { const rel = await relation(db, user.id, id); if (!rel || rel.status !== "accepted") fail(403, "You can only invite friends."); }
    const id = randomId();
    await db.batch([
      db.prepare(`INSERT INTO meetings (id, organizer_id, title, start_ms, end_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(id, user.id, title, start, end, now()),
      db.prepare(`INSERT INTO meeting_people (meeting_id, user_id, response) VALUES (?1, ?2, 'accepted')`).bind(id, user.id),
      ...ids.map(pid => db.prepare(`INSERT INTO meeting_people (meeting_id, user_id, response) VALUES (?1, ?2, 'pending')`).bind(id, pid)),
    ]);
    return { ok: true, id };
  } },

  "POST /api/meetings/respond": { async run({ db, user, body }) {
    const response = body.accept ? "accepted" : "declined";
    const r = await db.prepare(`UPDATE meeting_people SET response = ?1 WHERE meeting_id = ?2 AND user_id = ?3`).bind(response, String(body.meetingId || ""), user.id).run();
    if (!r.meta || !r.meta.changes) fail(404, "That invite is no longer open.");
    return { ok: true };
  } },

  "POST /api/meetings/cancel": { async run({ db, user, body }) {
    const r = await db.prepare(`UPDATE meetings SET status = 'cancelled' WHERE id = ?1 AND organizer_id = ?2`).bind(String(body.meetingId || ""), user.id).run();
    if (!r.meta || !r.meta.changes) fail(404, "Only the person who proposed a meeting can cancel it.");
    return { ok: true };
  } },

  "POST /api/account/delete": { async run({ db, user, body }) {
    if (!sameText(await hashPassword(String(body.password || ""), user.salt), user.pass_hash)) fail(401, "That password is wrong.");
    const id = user.id;
    await db.batch([
      db.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id),
      db.prepare(`DELETE FROM friends WHERE from_id = ?1 OR to_id = ?1`).bind(id),
      db.prepare(`DELETE FROM busy WHERE user_id = ?1`).bind(id),
      db.prepare(`DELETE FROM meeting_people WHERE user_id = ?1`).bind(id),
      db.prepare(`UPDATE meetings SET status = 'cancelled' WHERE organizer_id = ?1`).bind(id),
      db.prepare(`DELETE FROM users WHERE id = ?1`).bind(id),
    ]);
    return { ok: true };
  } },
};
