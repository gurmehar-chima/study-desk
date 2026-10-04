// Fetches the calendar links stored in the CALENDAR_FEEDS secret and writes an
// encrypted copy to site/data/feeds.enc.json. The page decrypts it in the
// browser with the PLANNER_PASSPHRASE. Links are never printed to the log.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import crypto from "node:crypto";

const OUT_DIR = "site/data";
const OUT = `${OUT_DIR}/feeds.enc.json`;
const ITER = 310000;
const raw = (process.env.CALENDAR_FEEDS || "").trim();
const pass = process.env.PLANNER_PASSPHRASE || "";

rmSync(OUT, { force: true });

if (!raw || !pass) {
  console.log("CALENDAR_FEEDS or PLANNER_PASSPHRASE is not set. Publishing the site without linked calendars.");
  process.exit(0);
}
if (pass.length < 12) {
  console.error("PLANNER_PASSPHRASE must be at least 12 characters, because the encrypted file is public.");
  process.exit(1);
}

function guessLabel(url) {
  if (/instructure|canvas|\/feeds\/calendars\//i.test(url)) return "Canvas";
  if (/outlook|office365|office\.com|microsoft/i.test(url)) return "Microsoft 365";
  if (/google\.com/i.test(url)) return "Google Classroom";
  return "Calendar";
}

const seen = new Map();
const feeds = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(line => {
  const i = line.indexOf("|");
  let label = i > 0 ? line.slice(0, i).trim() : "";
  let url = (i > 0 ? line.slice(i + 1) : line).trim().replace(/^webcal:\/\//i, "https://");
  label = label || guessLabel(url);
  const n = (seen.get(label) || 0) + 1; seen.set(label, n);
  if (n > 1) label += " " + n;
  return { label, url };
});

const results = [];
for (const f of feeds) {
  try {
    if (!/^https:\/\//i.test(f.url)) throw new Error("Link must start with https://");
    const res = await fetch(f.url, { redirect: "follow", signal: AbortSignal.timeout(45000), headers: { "user-agent": "study-desk-sync" } });
    if (!res.ok) throw new Error("The calendar service answered " + res.status);
    const ics = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(ics)) throw new Error("The link did not return a calendar");
    results.push({ label: f.label, ics });
    console.log(`${f.label}: fetched ${(ics.match(/BEGIN:VEVENT/gi) || []).length} entries`);
  } catch (e) {
    const msg = e.name === "TimeoutError" ? "Timed out" : String(e.message || e).replace(/https?:\/\/\S+/g, "[link]");
    results.push({ label: f.label, error: msg });
    console.log(`${f.label}: FAILED (${msg})`);
  }
}

const plain = Buffer.from(JSON.stringify({ syncedAt: Date.now(), feeds: results }), "utf8");
const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(pass, salt, ITER, 32, "sha256");
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify({ v: 1, iter: ITER, salt: salt.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64") }));
console.log(`Wrote ${OUT} (${results.filter(r => r.ics).length} of ${results.length} calendars).`);
