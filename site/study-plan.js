/* Study Desk: per-class study plan.
 * Reads the planner's saved classes and deadlines (same browser storage as app.js),
 * then fits study sessions into the free time around classes for the next 7 days.
 * Loaded after app.js on plan.html. Does not change anything app.js stores. */
(function () {
"use strict";
const $ = (s, r) => (r || document).querySelector(s);
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const fromYmd = s => { const a = s.split("-").map(Number); return new Date(a[0], a[1] - 1, a[2]); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toMin = t => { const a = (t || "0:0").split(":").map(Number); return a[0] * 60 + (a[1] || 0); };
const toTime = m => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
const fmt = m => { const h = Math.floor(m / 60), mm = m % 60; return (h % 12 || 12) + ":" + pad(mm) + (h < 12 ? " AM" : " PM"); };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KEY = "study-desk-v1", PKEY = "study-desk-plan-v1";
const LEVELS = [{ name: "Not a class", per: 0, none: 0 }, { name: "Light", per: 1.5, none: 2 }, { name: "Standard", per: 2, none: 4 }, { name: "Heavy", per: 2.5, none: 6 }];

/* ---------- settings ---------- */
let P = { winStart: "09:00", winEnd: "22:00", maxPerDay: 5, block: 50, weekends: true, courses: {}, done: {}, filter: "" };
try { const s = JSON.parse(localStorage.getItem(PKEY) || "null"); if (s) P = Object.assign(P, s); } catch (e) {}
function saveP() { try { localStorage.setItem(PKEY, JSON.stringify(P)); } catch (e) {} }

/* ---------- planner data ---------- */
// Same made-up schedule app.js shows before the planner is started.
function examples() {
  const t = new Date(), d = n => ymd(addDays(t, n));
  const term = { from: d(-35), until: d(70) };
  const c = (title, course, days, start, end) => Object.assign({ title, course, days, start, end }, term);
  const i = (off, title, course, time, kind, done) => ({ title, course, date: d(off), time: time || "", kind: kind || "due", done: !!done });
  return { classes: [
    c("Biology lecture", "BIOL 1710", [1, 3, 5], "09:40", "10:35"),
    c("Writing and Rhetoric", "ENG 1510", [2, 4], "10:30", "11:50"),
    c("Calculus I", "MATH 2301", [1, 3, 5], "12:55", "13:50"),
    c("Intro Psychology", "PSY 1010", [2, 4], "14:00", "15:20")
  ], items: [
    i(-2, "Reading response 3", "ENG 1510", "23:59"), i(-1, "Homework 4: Limits", "MATH 2301", "23:59", "due", true),
    i(0, "Read chapter 6: Cellular respiration", "BIOL 1710", "23:59"), i(1, "Problem set 5: Chain rule", "MATH 2301", "23:59"),
    i(2, "Essay 2 draft: Rhetorical analysis", "ENG 1510", "17:00"), i(3, "Quiz 4: Memory and learning", "PSY 1010", "14:00"),
    i(5, "Lab report: Enzyme activity", "BIOL 1710", "23:59"), Object.assign(i(6, "Calculus study group", "MATH 2301", "18:00", "event"), { end: "19:00" }),
    i(8, "Midterm exam", "MATH 2301", "12:55"), i(10, "Discussion post: Week 7", "PSY 1010", "23:59")
  ] };
}
function loadPlanner() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.v === 1 && s.started) return { d: s, example: false }; } catch (e) {}
  return { d: examples(), example: true };
}
function meetsOn(c, date) {
  const k = ymd(date);
  if (!c.days || !c.days.includes(date.getDay()) || (c.from && k < c.from) || (c.until && k > c.until)) return false;
  const n = c.interval || 1; if (n === 1 || !c.from) return true;
  const a = fromYmd(c.from), a0 = addDays(a, -a.getDay()), d0 = addDays(date, -date.getDay());
  return Math.round((d0 - a0) / 6048e5) % n === 0;
}

/* ---------- how much prep a deadline needs ---------- */
function prepFor(title) {
  if (/\b(final|midterm|exam|test)\b/i.test(title)) return { hours: 5, days: 6, exam: true };
  if (/\bquiz\b/i.test(title)) return { hours: 1.5, days: 3 };
  if (/\b(essay|paper|report|project|lab|presentation)\b/i.test(title)) return { hours: 3, days: 5 };
  if (/\b(read|reading|chapter|discussion|post|response|reflection)\b/i.test(title)) return { hours: 1, days: 2 };
  return { hours: 2, days: 4 };
}

/* ---------- build the plan ---------- */
function build() {
  const { d, example } = loadPlanner();
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const H = 7, L = Number(P.block) || 50, GAP = L >= 50 ? 10 : 5;
  const win0 = toMin(P.winStart), win1 = toMin(P.winEnd);
  const cap = Math.max(0.5, Number(P.maxPerDay) || 4) * 60;

  // courses and their weekly class time
  const courses = new Map();
  const add = name => { if (name && !courses.has(name)) courses.set(name, { name, meetMin: 0, meetDays: new Set(), deadlines: [] }); return courses.get(name); };
  for (const c of d.classes || []) {
    const co = add(c.course || c.title); co.meetMin += (c.days || []).length * Math.max(0, toMin(c.end) - toMin(c.start));
    (c.days || []).forEach(x => co.meetDays.add(x));
  }
  const horizonEnd = ymd(addDays(today, H + 7));
  const termLo = ymd(addDays(today, -60)), termHi = ymd(addDays(today, 120));
  for (const i of d.items || []) {
    if (!i.course || i.date < termLo || i.date > termHi) continue;
    const co = add(i.course);   // every class seen this term gets a plan, even with nothing due this week
    if (i.kind !== "due" || i.done || i.date < ymd(today) || i.date > horizonEnd) continue;
    co.deadlines.push(i);
  }

  // free time per day
  const days = [];
  for (let n = 0; n < H; n++) {
    const date = addDays(today, n), k = ymd(date), off = !P.weekends && (date.getDay() === 0 || date.getDay() === 6);
    const busy = [];
    for (const c of d.classes || []) if (meetsOn(c, date)) busy.push([toMin(c.start) - 15, toMin(c.end) + 15, c.course || c.title, toMin(c.end)]);
    for (const i of d.items || []) if (i.date === k && i.kind !== "due" && i.time) busy.push([toMin(i.time), i.end ? toMin(i.end) : toMin(i.time) + 60]);
    busy.sort((a, b) => a[0] - b[0]);
    let start = win0;
    if (n === 0) start = Math.max(win0, Math.ceil((now.getHours() * 60 + now.getMinutes() + 5) / 15) * 15);
    let free = [];
    if (!off) {
      let cur = start;
      for (const b of busy) { if (b[0] > cur) free.push([cur, Math.min(b[0], win1)]); cur = Math.max(cur, b[1]); }
      if (cur < win1) free.push([cur, win1]);
      free = free.filter(f => f[1] - f[0] >= L);
    }
    days.push({ n, date, k, free, used: 0, per: {}, blocks: [], classEnds: busy.filter(b => b[2]).map(b => ({ course: b[2], end: b[3] })), off });
  }

  // tasks
  const tasks = [];
  for (const co of courses.values()) {
    const pc = P.courses[co.name] || {}, level = pc.level == null ? 2 : pc.level, lvl = LEVELS[level];
    co.level = level;
    if (level === 0) { co.target = 0; co.auto = 0; co.needMin = 0; continue; }
    const auto = co.meetMin ? Math.round(co.meetMin / 60 * lvl.per * 2) / 2 : lvl.none;
    co.target = Math.max(0.5, Math.min(20, Number(pc.hours) || auto));
    co.auto = auto;
    let prepMin = 0;
    for (const i of co.deadlines) {
      const p = prepFor(i.title), due = fromYmd(i.date);
      const hi = Math.round((due - today) / 864e5), lo = Math.max(0, hi - p.days);
      const dueMin = i.time ? toMin(i.time) : (p.exam ? 8 * 60 : 23 * 60 + 59);
      const nb = Math.ceil(p.hours * 60 / L);
      for (let b = 0; b < nb; b++) tasks.push({ course: co.name, kind: "deadline", exam: !!p.exam, item: i, lo, hi, dueMin, order: hi });
      prepMin += nb * L;
    }
    const reviewBlocks = Math.max(0, Math.ceil((co.target * 60 - prepMin) / L));
    for (let b = 0; b < reviewBlocks; b++) tasks.push({ course: co.name, kind: "review", lo: 0, hi: H - 1, order: 99 });
    co.needMin = prepMin + reviewBlocks * L;
  }
  tasks.sort((a, b) => a.order - b.order || (a.hi - a.lo) - (b.hi - b.lo));

  // place each session on the least crowded day that fits, spreading each class out
  const unplaced = {};
  for (const t of tasks) {
    let best = null;
    for (let n = Math.max(0, t.lo); n <= Math.min(H - 1, t.hi); n++) {
      const day = days[n];
      if (day.used + L > cap) continue;
      const latest = t.kind === "deadline" && n === t.hi ? t.dueMin - 60 : 24 * 60;
      const slot = day.free.find(f => f[1] - f[0] >= L && f[0] + L <= latest);
      if (!slot) continue;
      const co = courses.get(t.course);
      let score = day.used / 60 + (day.per[t.course] || 0) * 2;
      if (t.kind === "deadline") score += n * 0.15;
      if (t.kind === "review" && co.meetDays.size && !co.meetDays.has(day.date.getDay()) && !co.meetDays.has((day.date.getDay() + 6) % 7)) score += 0.6;
      if (!best || score < best.score) best = { n, slot, score };
    }
    if (!best) { unplaced[t.course] = (unplaced[t.course] || 0) + L; continue; }
    const day = days[best.n], s = best.slot[0];
    best.slot[0] = s + L + GAP;
    day.free = day.free.filter(f => f[1] - f[0] >= L);
    day.used += L; day.per[t.course] = (day.per[t.course] || 0) + 1;
    day.blocks.push({ start: s, end: s + L, course: t.course, kind: t.kind, exam: t.exam, item: t.item, key: day.k + "|" + toTime(s) + "|" + t.course });
  }

  // name each session with a study method
  const reviewCount = {};
  for (const day of days) {
    day.blocks.sort((a, b) => a.start - b.start);
    for (const b of day.blocks) {
      if (b.kind === "deadline") {
        const dl = relDay(b.item.date, today);
        b.title = b.exam ? "Exam prep for " + b.item.title + ": practice questions, then check weak spots" : "Work on " + b.item.title + " (due " + dl + ")";
      } else {
        reviewCount[b.course] = (reviewCount[b.course] || 0) + 1;
        const after = day.classEnds.some(c => c.course === b.course && c.end <= b.start);
        b.title = after ? "Review today's lecture, then quiz yourself from memory" : "Practice problems and active recall";
      }
    }
  }
  for (const name of Object.keys(reviewCount)) {
    if (reviewCount[name] < 3) continue;
    for (let n = H - 1; n >= 0; n--) {
      const b = days[n].blocks.filter(x => x.course === name && x.kind === "review").pop();
      if (b) { b.title = "Weekly recap: summarize the week on one page"; break; }
    }
  }
  for (const co of courses.values()) {
    co.plannedMin = days.reduce((s, dd) => s + dd.blocks.filter(b => b.course === co.name).length * L, 0);
    co.unplacedMin = unplaced[co.name] || 0;
    co.next = co.deadlines.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  }
  return { days, courses: [...courses.values()].sort((a, b) => a.name.localeCompare(b.name)), example, L };
}
function relDay(k, today) {
  const diff = Math.round((fromYmd(k) - today) / 864e5);
  if (diff === 0) return "today"; if (diff === 1) return "tomorrow";
  const d = fromYmd(k); return diff < 7 ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()] : DOW[d.getDay()] + " " + MON[d.getMonth()] + " " + d.getDate();
}
function colorOf(course) {
  if (!course) return "var(--muted)";
  let h = 0; for (const ch of course) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return "var(--c" + (h % 6 + 1) + ")";
}
const hrs = m => { const h = Math.round(m / 6) / 10; return (h % 1 ? h.toFixed(1) : h) + " h"; };

/* ---------- render ---------- */
let last = null;
function render() {
  const plan = last = build(), root = $("#studyPlan");
  if (!root) return;
  const totalPlanned = plan.courses.reduce((s, c) => s + c.plannedMin, 0), totalShort = plan.courses.reduce((s, c) => s + c.unplacedMin, 0);
  if (P.filter && !plan.courses.some(c => c.name === P.filter)) P.filter = "";

  $("#spSummary").innerHTML = plan.courses.length
    ? '<span class="pill">' + hrs(totalPlanned) + " planned</span><span class=\"pill\">" + plan.courses.filter(c => c.level !== 0).length + " classes</span>" + (totalShort ? '<span class="pill late">' + hrs(totalShort) + " did not fit</span>" : "")
    : "";
  $("#spExample").hidden = !plan.example;

  // per-class targets
  $("#spClasses").innerHTML = plan.courses.length ? plan.courses.map((c, idx) =>
    '<div class="sp-row" style="--cc:' + colorOf(c.name) + '">' +
      '<span class="swatch"></span>' +
      '<div class="sp-name"><strong>' + esc(c.name) + "</strong><span>" + (c.meetMin ? hrs(c.meetMin) + " of class a week" : "no class times entered") +
        (c.next ? " · next due: " + esc(c.next.title) + ", " + relDay(c.next.date, fromYmd(ymd(new Date()))) : "") + "</span></div>" +
      '<label class="sp-field">Workload<select id="spLevel' + idx + '" data-course="' + esc(c.name) + '" data-f="level">' +
        [1, 2, 3, 0].map(v => '<option value="' + v + '"' + (c.level === v ? " selected" : "") + ">" + LEVELS[v].name + "</option>").join("") + "</select></label>" +
      '<label class="sp-field">Hours a week<input id="spHours' + idx + '" type="number" min="0.5" max="20" step="0.5" value="' + (c.level === 0 ? "" : c.target) + '"' + (c.level === 0 ? " disabled" : "") + ' data-course="' + esc(c.name) + '" data-f="hours" title="Suggested: ' + c.auto + ' h"></label>' +
      (c.level === 0 ? '<div class="sp-meter"><span>Not planned</span></div>'
        : '<div class="sp-meter" title="' + hrs(c.plannedMin) + " of " + hrs(c.needMin) + ' scheduled"><i style="width:' + Math.min(100, c.needMin ? c.plannedMin / c.needMin * 100 : 100) + '%"></i><span>' + hrs(c.plannedMin) + (c.unplacedMin ? ' <b class="late">· ' + hrs(c.unplacedMin) + " short</b>" : "") + "</span></div>") +
    "</div>").join("")
    : '<p class="empty">No classes yet. Connect your calendars or add a class on the planner above, and a plan appears here.</p>';

  // class filter
  $("#spFilter").innerHTML = plan.courses.length > 1 ? ['<button data-filter="" aria-pressed="' + !P.filter + '">All classes</button>']
    .concat(plan.courses.filter(c => c.level !== 0).map(c => '<button data-filter="' + esc(c.name) + '" aria-pressed="' + (P.filter === c.name) + '" style="--cc:' + colorOf(c.name) + '">' + esc(c.name) + "</button>")).join("") : "";

  // week
  const todayK = ymd(new Date());
  $("#spWeek").innerHTML = plan.days.map(day => {
    const bl = day.blocks.filter(b => !P.filter || b.course === P.filter);
    return '<div class="sp-day' + (day.k === todayK ? " today" : "") + '"><div class="sp-dh"><span>' + (day.k === todayK ? "Today" : DOW[day.date.getDay()]) + "</span><b>" + MON[day.date.getMonth()] + " " + day.date.getDate() + "</b></div>" +
      (bl.length ? bl.map(b => '<label class="sp-block' + (P.done[b.key] ? " done" : "") + '" style="--cc:' + colorOf(b.course) + '"><input type="checkbox" data-key="' + esc(b.key) + '"' + (P.done[b.key] ? " checked" : "") + ">" +
        '<span class="sp-bt">' + fmt(b.start) + "–" + fmt(b.end) + "</span><span class=\"sp-bc\">" + esc(b.course) + "</span><span class=\"sp-bn\">" + esc(b.title) + "</span></label>").join("")
        : '<p class="sp-free">' + (day.off ? "Day off" : "Free") + "</p>") + "</div>";
  }).join("");
}

/* ---------- controls ---------- */
function syncControls() {
  $("#spStart").value = P.winStart; $("#spEnd").value = P.winEnd; $("#spMax").value = P.maxPerDay;
  $("#spBlock").value = String(P.block); $("#spWeekends").checked = !!P.weekends;
}
function bind() {
  const root = $("#studyPlan"); if (!root) return;
  syncControls();
  root.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.key) { if (t.checked) P.done[t.dataset.key] = true; else delete P.done[t.dataset.key]; }
    else if (t.dataset.course) {
      const c = P.courses[t.dataset.course] = P.courses[t.dataset.course] || {};
      if (t.dataset.f === "level") { c.level = Number(t.value); delete c.hours; }
      else c.hours = Number(t.value) || undefined;
    }
    else if (t.id === "spStart" && t.value) P.winStart = t.value;
    else if (t.id === "spEnd" && t.value) P.winEnd = t.value;
    else if (t.id === "spMax") P.maxPerDay = Math.min(12, Math.max(0.5, Number(t.value) || 4));
    else if (t.id === "spBlock") P.block = Number(t.value);
    else if (t.id === "spWeekends") P.weekends = t.checked;
    else return;
    if (toMin(P.winEnd) - toMin(P.winStart) < 60) { P.winEnd = toTime(Math.min(23 * 60 + 59, toMin(P.winStart) + 60)); syncControls(); }
    saveP(); render();
  });
  root.addEventListener("click", e => {
    const f = e.target.closest("[data-filter]");
    if (f) { P.filter = f.dataset.filter; saveP(); render(); }
  });
  $("#spAsk").addEventListener("click", askAssistant);
}

function planText() {
  const p = last || build(), lines = [];
  lines.push("Study window " + fmt(toMin(P.winStart)) + " to " + fmt(toMin(P.winEnd)) + ", at most " + P.maxPerDay + " h a day, " + p.L + "-minute sessions.");
  for (const c of p.courses) if (c.level !== 0) lines.push("- " + c.name + ": target " + c.target + " h, planned " + hrs(c.plannedMin) + (c.unplacedMin ? ", " + hrs(c.unplacedMin) + " did not fit" : ""));
  lines.push("Sessions:");
  for (const d of p.days) for (const b of d.blocks) lines.push("- " + DOW[d.date.getDay()] + " " + fmt(b.start) + " " + b.course + ": " + b.title);
  return lines.join("\n");
}
function askAssistant() {
  const compose = $("#compose"), q = $("#q");
  if (!compose || compose.hidden) { const b = $("#btnAIKey") || $("#btnAI"); if (b) b.click(); return; }
  q.value = "Here is my study plan for the next 7 days. Check it against my deadlines, tell me if anything is missing or unrealistic, and suggest the best study method for each class.\n\n" + planText();
  compose.requestSubmit();
  const a = $(".assistant"); if (a) a.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Re-plan whenever the planner above saves (import, check-off, new class). */
const origSet = Storage.prototype.setItem;
let pending = null;
Storage.prototype.setItem = function (k, v) {
  origSet.apply(this, arguments);
  if (this === window.localStorage && k === KEY && !pending) pending = setTimeout(() => { pending = null; render(); }, 50);
};
window.addEventListener("storage", e => { if (e.key === KEY || e.key === PKEY) { if (e.key === PKEY) { try { P = Object.assign(P, JSON.parse(e.newValue || "{}")); } catch (x) {} syncControls(); } render(); } });
setInterval(() => { if (document.visibilityState === "visible") render(); }, 5 * 60 * 1000);

window.__studyPlan = { build, prepFor }; // for checking the planner logic
bind(); render();
})();
