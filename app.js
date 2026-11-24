export const VERSION = "7"; // bump on every change; shown at the bottom of Archive
// diary — app code. Loaded (and hot-swapped) by index.html.
// mount(root, state) draws the app and returns an unmount function.

// ---------- dates ----------
const pad = n => String(n).padStart(2, "0");
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const timeOf = ms => {
  const d = new Date(ms); let h = d.getHours(); const ap = h < 12 ? "am" : "pm";
  h = h % 12 || 12; return `${h}:${pad(d.getMinutes())} ${ap}`;
};
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const touch = () => matchMedia("(pointer: coarse)").matches;

// ---------- storage ----------
// v1: days {date, photo, thumb, note}
// v2: days {date, note, updated} + photos {id, date, blob, thumb, added}
// v3: + photos.caption, meta store (backup folder handle)
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("diary", 3);
    r.onupgradeneeded = (e) => {
      const db = r.result, t = r.transaction;
      if (!db.objectStoreNames.contains("days")) db.createObjectStore("days", { keyPath: "date" });
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" }).createIndex("date", "date");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (e.oldVersion === 1) {
        const days = t.objectStore("days"), photos = t.objectStore("photos");
        days.openCursor().onsuccess = ev => {
          const c = ev.target.result; if (!c) return;
          const v = c.value;
          if (v.photo) photos.put({ id: newId(), date: v.date, blob: v.photo, thumb: v.thumb, added: v.updated || Date.now(), caption: "" });
          c.update({ date: v.date, note: v.note || "", updated: v.updated || Date.now() });
          c.continue();
        };
      }
    };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => db.close(); res(db); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => console.warn("diary: database upgrade waiting for another tab");
  });
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function makeStore(db) {
  const run = (stores, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out; const r = fn(t);
    if (r && "onsuccess" in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
  });
  return {
    getNote: k => run("days", "readonly", t => t.objectStore("days").get(k)).then(d => d?.note || ""),
    setNote: (k, note) => run("days", "readwrite", t =>
      note ? t.objectStore("days").put({ date: k, note, updated: Date.now() }) : t.objectStore("days").delete(k)),
    photosOn: k => run("photos", "readonly", t => t.objectStore("photos").index("date").getAll(k))
      .then(a => a.sort((x, y) => x.added - y.added)),
    putPhoto: p => run("photos", "readwrite", t => t.objectStore("photos").put(p)),
    setCaption: (id, caption) => run("photos", "readwrite", t => {
      const s = t.objectStore("photos");
      s.get(id).onsuccess = e => { const p = e.target.result; if (p) { p.caption = caption; s.put(p); } };
    }),
    delPhoto: id => run("photos", "readwrite", t => t.objectStore("photos").delete(id)),
    summary: () => new Promise((res, rej) => {
      const t = db.transaction("photos", "readonly"); const out = {};
      t.objectStore("photos").index("date").openCursor().onsuccess = e => {
        const c = e.target.result; if (!c) return;
        const v = c.value, s = out[v.date];
        if (!s) out[v.date] = { count: 1, thumb: v.thumb, added: v.added };
        else { s.count++; if (v.added < s.added) { s.thumb = v.thumb; s.added = v.added; } }
        c.continue();
      };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
    }),
    dump: () => new Promise((res, rej) => {
      const t = db.transaction(["days", "photos"], "readonly"); const box = {};
      t.objectStore("days").getAll().onsuccess = e => box.days = e.target.result;
      t.objectStore("photos").getAll().onsuccess = e => box.photos = e.target.result;
      t.oncomplete = () => res(box); t.onerror = () => rej(t.error);
    }),
    count: () => run("photos", "readonly", t => t.objectStore("photos").count()),
    getMeta: k => run("meta", "readonly", t => t.objectStore("meta").get(k)),
    setMeta: (k, v) => run("meta", "readwrite", t => v == null ? t.objectStore("meta").delete(k) : t.objectStore("meta").put(v, k)),
  };
}

// ---------- images ----------
const loadImage = src => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error("A file couldn't be read as a photo."));
  img.src = src;
});
const toBlob = (c, q) => new Promise(r => c.toBlob(r, "image/jpeg", q));
function resize(img, max) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return toBlob(c, 0.86);
}
function squareThumb(img, size) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const w = img.naturalWidth, h = img.naturalHeight, m = Math.min(w, h);
  c.getContext("2d").drawImage(img, (w - m) / 2, (h - m) / 2, m, m, 0, 0, size, size);
  return toBlob(c, 0.8);
}
async function thumbFromBlob(blob) {
  const u = URL.createObjectURL(blob);
  try { return await squareThumb(await loadImage(u), 240); } finally { URL.revokeObjectURL(u); }
}

// ---------- 7-segment date stamp ----------
const SEG = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
function segShapes(x) {
  const W = 10, H = 18, t = 2, g = .5;
  const r = (sx, sy, w, h) => `<rect x="${x + sx}" y="${sy}" width="${w}" height="${h}" rx="1"/>`;
  return {
    a: r(t / 2 + g, 0, W - t - 2 * g, t), g: r(t / 2 + g, H / 2 - t / 2, W - t - 2 * g, t), d: r(t / 2 + g, H - t, W - t - 2 * g, t),
    f: r(0, t / 2 + g, t, H / 2 - t - g), b: r(W - t, t / 2 + g, t, H / 2 - t - g),
    e: r(0, H / 2 + g, t, H / 2 - t - g), c: r(W - t, H / 2 + g, t, H / 2 - t - g),
  };
}
function stampSVG(k) {
  const [y, m, d] = k.split("-");
  let x = 5; const parts = [`<rect x="0" y="0" width="2" height="5" rx="1"/>`];
  [y.slice(2), m, d].forEach((grp, gi) => {
    for (const ch of grp) { const s = segShapes(x); parts.push(SEG[ch].split("").map(n => s[n]).join("")); x += 13; }
    if (gi < 2) x += 7;
  });
  return `<svg viewBox="-1 -1 ${x - 1} 20" fill="#FF7B22" aria-hidden="true"><g transform="skewX(-6) translate(1 0)">${parts.join("")}</g></svg>`;
}

const CAMERA = `<svg class="cam" viewBox="0 0 40 30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 8.5h8l3-4.5h12l3 4.5h8v18H3z"/><circle cx="20" cy="16.5" r="6.2"/><circle cx="20" cy="16.5" r="2.4"/><path d="M31 12h3"/></svg>`;

// ---------- backup bookkeeping ----------
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const dataToBlob = async d => (await fetch(d)).blob();
const ls = {
  get: k => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } },
  set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} },
};
const LAST_BACKUP = "diary.lastBackup", LAST_CHANGE = "diary.lastChange";
const photoFile = p => `${p.date}_${p.id}.jpg`;
const canFolder = "showDirectoryPicker" in window;

// ---------- handwriting fonts (Korean + English picked separately) ----------
const KO_FONTS = [
  { key: "nanumpenscript", family: "Nanum Pen Script", name: "나눔손글씨 펜" },
  { key: "gaegu", family: "Gaegu", name: "개구" },
  { key: "poorstory", family: "Poor Story", name: "푸어스토리" },
  { key: "gowunbatang", family: "Gowun Batang", name: "고운바탕" },
];
const EN_FONTS = [
  { key: "caveat", family: "Caveat", name: "Caveat" },
  { key: "patrickhand", family: "Patrick Hand", name: "Patrick Hand" },
  { key: "indieflower", family: "Indie Flower", name: "Indie Flower" },
  { key: "ebgaramond", family: "EB Garamond", name: "EB Garamond" },
];
const pickFont = (list, key) => list.find(f => f.key === key) || list[0];
const getPref = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const fontsNow = () => ({
  ko: pickFont(KO_FONTS, getPref("diary.hand.ko", getPref("diary.hand", ""))),
  en: pickFont(EN_FONTS, getPref("diary.hand.en", "")),
});
function applyHand() {
  const { ko, en } = fontsNow();
  delete document.documentElement.dataset.hand; // left over from older versions
  document.documentElement.style.setProperty("--hand", `"${en.family}", "${ko.family}", "Apple SD Gothic Neo", sans-serif`);
  document.fonts?.load(`20px "${ko.family}"`, "가"); // fetch the whole Korean font now, not mid-typing
  document.fonts?.load(`20px "${en.family}"`, "a");
}
function setBarColor(color) { // Safari top and bottom bars
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.append(m); }
  m.content = color;
}
const CARD = "#D5D7CE", DARK = "#1A1A17";

// =====================================================================
export async function mount(root, state) {
  const db = await openDB();
  const store = makeStore(db);
  const ctl = new AbortController();
  const on = (el, ev, fn, opts = {}) => el.addEventListener(ev, fn, { ...opts, signal: ctl.signal });

  applyHand();
  setBarColor(CARD);
  if (navigator.storage?.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist());

  let urls = [];
  const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const revoke = () => { urls.forEach(URL.revokeObjectURL); urls = []; };

  // ---------- automatic folder backup (Chrome / Edge on computers) ----------
  let dir = canFolder ? await store.getMeta("backupDir") : null;
  let dirOK = false;
  if (dir) { try { dirOK = (await dir.queryPermission({ mode: "readwrite" })) === "granted"; } catch { dir = null; } }
  let syncTimer = null, syncing = false, syncAgain = false;

  async function syncFolder() {
    if (!dir || !dirOK) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      const { days, photos } = await store.dump();
      const pdir = await dir.getDirectoryHandle("photos", { create: true });
      const have = new Set();
      for await (const name of pdir.keys()) have.add(name);
      const want = new Set();
      for (const p of photos) {
        const name = photoFile(p); want.add(name);
        if (!have.has(name)) {
          const w = await (await pdir.getFileHandle(name, { create: true })).createWritable();
          await w.write(p.blob); await w.close();
        }
      }
      for (const name of have) if (/^\d{4}-\d{2}-\d{2}_[a-z0-9-]+\.jpg$/.test(name) && !want.has(name)) await pdir.removeEntry(name);
      const index = {
        app: "diary", version: 3, saved: new Date().toISOString(),
        days: days.map(d => ({ date: d.date, note: d.note, updated: d.updated })),
        photos: photos.map(p => ({ id: p.id, date: p.date, added: p.added, caption: p.caption || "", file: `photos/${photoFile(p)}` })),
      };
      const w = await (await dir.getFileHandle("diary.json", { create: true })).createWritable();
      await w.write(JSON.stringify(index, null, 1)); await w.close();
      ls.set(LAST_BACKUP, Date.now());
    } catch (err) {
      console.error("diary: folder backup failed", err);
      if (err.name === "NotAllowedError") dirOK = false;
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; syncFolder(); }
    }
  }
  const changed = () => {
    ls.set(LAST_CHANGE, Date.now());
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncFolder, 2500);
  };
  if (dirOK && ls.get(LAST_CHANGE) > ls.get(LAST_BACKUP)) syncFolder();

  async function chooseFolder() {
    try {
      dir = await window.showDirectoryPicker({ id: "diary-backup", mode: "readwrite" });
      await store.setMeta("backupDir", dir); dirOK = true;
      await syncFolder(); render();
    } catch (err) { if (err.name !== "AbortError") alert("That folder can't be used. Choose another folder."); }
  }
  async function resumeFolder() {
    try { dirOK = (await dir.requestPermission({ mode: "readwrite" })) === "granted"; } catch { dirOK = false; }
    if (dirOK) await syncFolder();
    render();
  }

  // ---------- pending text (notes + captions), saved after a pause ----------
  const pending = new Map(); // key -> fn
  let textTimer = null;
  const flushText = async () => {
    clearTimeout(textTimer);
    if (!pending.size) return;
    const jobs = [...pending.values()]; pending.clear();
    for (const job of jobs) await job();
    changed();
  };
  const queueText = (key, job) => {
    pending.set(key, job);
    clearTimeout(textTimer);
    textTimer = setTimeout(flushText, 600);
  };

  // hidden inputs
  const mkInput = (props) => { const i = Object.assign(document.createElement("input"), { type: "file", className: "sr", tabIndex: -1, ...props }); document.body.append(i); return i; };
  const cameraInput = mkInput({ accept: "image/*" });
  cameraInput.setAttribute("capture", "environment");
  const libraryInput = mkInput({ accept: "image/*", multiple: true });
  const importInput = mkInput({ accept: "application/json,.json" });

  // ---------- routing ----------
  const route = () => {
    const h = location.hash;
    if (h === "#/archive") return { page: "archive" };
    const m = h.match(/^#\/day\/(\d{4}-\d{2}-\d{2})$/);
    if (m && m[1] < todayKey()) return { page: "day", date: m[1] };
    return { page: "day", date: todayKey() };
  };

  let dayPhotos = [];
  let developIds = new Set();

  async function render() {
    await flushText();
    revoke();
    const r = route();
    if (r.page === "archive") await renderArchive(); else await renderDay(r.date);
    if (state.viewer && r.page === "day") openViewer(state.viewer, false);
  }

  function backupLine() {
    if (dir && !dirOK) return `<p class="nudge">Backup paused. <button class="link" data-resume>Resume</button></p>`;
    if (dir) return "";
    if (ls.get(LAST_CHANGE) <= ls.get(LAST_BACKUP)) return "";
    return canFolder
      ? `<p class="nudge">Not backed up. <button class="link" data-folder>Choose backup folder</button></p>`
      : `<p class="nudge">Not backed up. <button class="link" data-export>Save backup</button></p>`;
  }

  // ---------- day page ----------
  async function renderDay(k) {
    const d = fromKey(k), isToday = k === todayKey();
    const [photos, note] = await Promise.all([store.photosOn(k), store.getNote(k)]);
    dayPhotos = photos;
    const title = isToday
      ? `<span class="soft">Today,</span> ${d.getDate()} ${MONTHS[d.getMonth()]}`
      : `<span class="soft">${WEEKDAYS[d.getDay()]},</span> ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

    const prints = photos.map((p, i) => `
      <figure class="print" style="--i:${i}">
        <span class="tape" aria-hidden="true"></span>
        <button class="frame" data-open="${p.id}" aria-label="Open photo ${i + 1}">
          <span class="photo"><img src="${url(p.blob)}" alt="" class="${developIds.has(p.id) ? "developing" : ""}"><span class="stamp">${stampSVG(k)}</span></span>
        </button>
        <figcaption>
          ${keyOf(new Date(p.added)) === k ? `<span class="time">${timeOf(p.added)}</span>` : ""}
          <label class="sr" for="cap-${p.id}">Note for photo ${i + 1}</label>
          <textarea class="caption" id="cap-${p.id}" data-cap="${p.id}" rows="1" placeholder="write about this one">${esc(p.caption)}</textarea>
        </figcaption>
      </figure>`).join("");
    developIds = new Set();

    const add = `
      <div class="add">
        <button class="add-tile" data-camera>${CAMERA}<span>${touch() ? "Take a photo" : "Add photos"}</span></button>
        ${touch() ? `<button class="link small" data-library>or choose from library</button>` : ""}
      </div>`;

    root.innerHTML = `
      <div class="wrap">
        <header class="top">
          <a class="wordmark press" href="#/">diary</a>
          <a class="link" href="#/archive">${isToday ? "Archive" : "Back to archive"}</a>
        </header>
        <h1 class="page-title press">${title}</h1>
        <div class="roll">${prints}${add}</div>
        <div class="slip">
          <span class="tape" aria-hidden="true"></span>
          <label class="sr" for="note">About the day</label>
          <textarea class="note" id="note" rows="3" placeholder="how was today?">${esc(note)}</textarea>
        </div>
        ${backupLine()}
      </div>`;

    root.querySelectorAll("textarea").forEach(grow);
    window.scrollTo(0, state.scroll?.[location.hash] || 0);
  }
  const grow = ta => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };

  // ---------- archive page ----------
  async function renderArchive() {
    const sum = await store.summary();
    const dates = Object.keys(sum).sort();
    const now = new Date(), tKey = todayKey();
    const first = dates.length ? fromKey(dates[0]) : now;
    const photoTotal = dates.reduce((n, k) => n + sum[k].count, 0);

    let months = "";
    for (let y = now.getFullYear(), m = now.getMonth(); y > first.getFullYear() || (y === first.getFullYear() && m >= first.getMonth()); m--) {
      if (m < 0) { m = 11; y--; continue; }
      const daysIn = new Date(y, m + 1, 0).getDate();
      const lead = (new Date(y, m, 1).getDay() + 6) % 7;
      let cells = "", n = 0;
      for (let i = 0; i < lead; i++) cells += `<span class="cell blank"></span>`;
      for (let day = 1; day <= daysIn; day++) {
        const k = `${y}-${pad(m + 1)}-${pad(day)}`, s = sum[k];
        if (s) n++;
        const cls = ["cell", s ? "has" : "", k > tKey ? "future" : "", k === tKey ? "today" : ""].join(" ");
        cells += `<a class="${cls}" href="${k === tKey ? "#/" : `#/day/${k}`}" aria-label="${day} ${MONTHS[m]}${s ? `, ${s.count} photo${s.count > 1 ? "s" : ""}` : ""}">
          ${s?.thumb ? `<img src="${url(s.thumb)}" alt="">` : ""}<span class="n">${day}</span>${s && s.count > 1 ? `<span class="k">${s.count}</span>` : ""}</a>`;
      }
      months += `
        <section class="month">
          <h2 class="press">${MONTHS[m]} ${y}${n ? `<span class="count">${n} of ${daysIn} days</span>` : ""}</h2>
          <div class="weekdays" aria-hidden="true"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
          <div class="grid">${cells}</div>
        </section>`;
    }

    const lb = ls.get(LAST_BACKUP);
    const when = lb ? new Date(lb).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
    let status, actions;
    if (dir && dirOK) {
      status = `Auto backup to “${esc(dir.name)}”.${when ? ` Last ${when}.` : ""}`;
      actions = `<button class="link" data-folder>Change folder</button><button class="link" data-stopfolder>Stop</button>`;
    } else if (dir) {
      status = `Backup to “${esc(dir.name)}” paused.`;
      actions = `<button class="link" data-resume>Resume</button><button class="link" data-stopfolder>Stop</button>`;
    } else if (canFolder) {
      status = `No auto backup yet.${when ? ` Last backup ${when}.` : ""}`;
      actions = `<button class="link" data-folder>Choose backup folder</button><button class="link" data-export>Save file</button>`;
    } else {
      status = when ? `Last backup ${when}.` : `Not backed up yet.`;
      actions = `<button class="link" data-export>Save backup</button>`;
    }

    root.innerHTML = `
      <div class="wrap">
        <header class="top">
          <a class="wordmark press" href="#/">diary</a>
          <a class="link" href="#/">Today</a>
        </header>
        <h1 class="page-title press">Archive</h1>
        <p class="summary">${photoTotal ? `${photoTotal} photo${photoTotal > 1 ? "s" : ""} over ${dates.length} day${dates.length > 1 ? "s" : ""}` : "Nothing here yet."}</p>
        <div class="months">${months}</div>
        <details class="fonts" ${state.fontsOpen ? "open" : ""}>
          <summary>Handwriting: <span id="handName">${fontsNow().ko.name} + ${fontsNow().en.name}</span></summary>
          <p class="font-group">한글</p>
          <div class="font-list">${KO_FONTS.map(f => `
            <button class="font-opt" data-font="${f.key}" data-lang="ko" aria-pressed="${f.key === fontsNow().ko.key}">
              <span class="sample" style="font-family:'${f.family}'">오늘의 기록</span><span class="name">${f.name}</span>
            </button>`).join("")}</div>
          <p class="font-group">English</p>
          <div class="font-list">${EN_FONTS.map(f => `
            <button class="font-opt" data-font="${f.key}" data-lang="en" aria-pressed="${f.key === fontsNow().en.key}">
              <span class="sample" style="font-family:'${f.family}'">Today’s page</span><span class="name">${f.name}</span>
            </button>`).join("")}</div>
        </details>
        <div class="keep">
          <p>${status}</p>
          <div class="row">${actions}</div>
          <div class="row">
            <button class="link" data-import>Restore from file</button>
            ${canFolder ? `<button class="link" data-importfolder>Restore from folder</button>` : ""}
          </div>
        </div>
        <p class="version typed">version ${VERSION}</p>
      </div>`;
    window.scrollTo(0, state.scroll?.[location.hash] || 0);
  }

  // ---------- viewer ----------
  let viewerEl = null;
  function openViewer(id, focus = true) {
    const i = dayPhotos.findIndex(p => p.id === id);
    if (i < 0) { closeViewer(); return; }
    state.viewer = id;
    const p = dayPhotos[i];
    if (!viewerEl) {
      viewerEl = document.createElement("div");
      viewerEl.className = "viewer"; viewerEl.setAttribute("role", "dialog"); viewerEl.setAttribute("aria-modal", "true");
      document.body.append(viewerEl);
      setBarColor(DARK);
    }
    viewerEl.innerHTML = `
      <div class="bar">
        <button class="link" data-close>Close</button>
        <button class="link" data-delete="${p.id}">Delete photo</button>
      </div>
      <div class="stage"><span class="photo"><img src="${url(p.blob)}" alt="Photo ${i + 1} of ${dayPhotos.length}"><span class="stamp">${stampSVG(p.date)}</span></span></div>
      ${p.caption ? `<p class="vcap">${esc(p.caption)}</p>` : ""}
      <div class="pager">
        <button data-step="-1" aria-label="Previous photo" ${i === 0 ? "disabled" : ""}>‹</button>
        <span>${i + 1} of ${dayPhotos.length}</span>
        <button data-step="1" aria-label="Next photo" ${i === dayPhotos.length - 1 ? "disabled" : ""}>›</button>
      </div>`;
    if (focus) viewerEl.querySelector("[data-close]").focus();
  }
  function closeViewer() {
    state.viewer = null;
    if (viewerEl) { viewerEl.remove(); viewerEl = null; }
    setBarColor(CARD);
  }
  const step = dir => {
    const i = dayPhotos.findIndex(p => p.id === state.viewer);
    const n = dayPhotos[i + dir]; if (n) openViewer(n.id);
  };

  // ---------- actions ----------
  async function addFiles(files) {
    const k = route().date;
    for (const file of files) {
      const src = URL.createObjectURL(file);
      try {
        const img = await loadImage(src);
        const [blob, thumb] = await Promise.all([resize(img, 1800), squareThumb(img, 240)]);
        const id = newId();
        await store.putPhoto({ id, date: k, blob, thumb, added: Date.now(), caption: "" });
        developIds.add(id);
      } catch (err) {
        alert(`${err.message} Try a JPEG, PNG or HEIC photo.`);
      } finally { URL.revokeObjectURL(src); }
    }
    changed();
    await render();
    const last = [...root.querySelectorAll(".caption")].pop();
    if (last && !touch()) last.focus({ preventScroll: true });
  }

  async function exportBackup() {
    await flushText();
    const { days, photos } = await store.dump();
    const out = { app: "diary", version: 3, days, photos: [] };
    for (const p of photos) out.photos.push({ id: p.id, date: p.date, added: p.added, caption: p.caption || "", blob: await blobToData(p.blob), thumb: await blobToData(p.thumb) });
    const name = `diary-backup-${todayKey()}.json`;
    const file = new File([JSON.stringify(out)], name, { type: "application/json" });
    try {
      if (touch() && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "diary backup" }); // Save to Files / iCloud Drive
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file); a.download = name;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
      ls.set(LAST_BACKUP, Date.now());
    } catch (err) { if (err.name !== "AbortError") alert("The backup couldn't be saved. Try again."); }
    render();
  }

  async function restoreRecords(days, photos) {
    for (const d of days) if (d.note) await store.setNote(d.date, d.note);
    for (const p of photos) await store.putPhoto(p); // same id = same photo, nothing doubles
    changed();
    alert(`Restored ${photos.length} photo${photos.length === 1 ? "" : "s"}.`);
    render();
  }

  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); if (data.app !== "diary") throw 0; }
    catch { alert("This file isn’t a diary backup. Choose a file named diary-backup-….json."); return; }
    const photos = [], days = [];
    if (data.version === 1) {
      for (const r of data.days) {
        if (r.note) days.push({ date: r.date, note: r.note });
        if (r.photo) photos.push({ id: `${r.date}-v1`, date: r.date, blob: await dataToBlob(r.photo), thumb: await dataToBlob(r.thumb), added: r.updated || Date.now(), caption: "" });
      }
    } else {
      days.push(...(data.days || []));
      for (const p of data.photos || []) photos.push({ id: p.id, date: p.date, added: p.added, caption: p.caption || "", blob: await dataToBlob(p.blob), thumb: await dataToBlob(p.thumb) });
    }
    restoreRecords(days, photos);
  }

  async function importFolder() {
    try {
      const src = await window.showDirectoryPicker({ id: "diary-backup", mode: "read" });
      const index = JSON.parse(await (await (await src.getFileHandle("diary.json")).getFile()).text());
      const pdir = await src.getDirectoryHandle("photos");
      const photos = [];
      for (const p of index.photos) {
        try {
          const blob = await (await pdir.getFileHandle(p.file.replace(/^photos\//, ""))).getFile();
          photos.push({ id: p.id, date: p.date, added: p.added, caption: p.caption || "", blob, thumb: await thumbFromBlob(blob) });
        } catch { /* missing file: skip */ }
      }
      restoreRecords(index.days || [], photos);
    } catch (err) {
      if (err.name !== "AbortError") alert("That folder isn’t a diary backup. Choose the folder that has diary.json in it.");
    }
  }

  // ---------- events (all removed on unmount) ----------
  on(document, "click", async e => {
    const t = e.target.closest("[data-camera],[data-library],[data-open],[data-close],[data-step],[data-delete],[data-export],[data-import],[data-folder],[data-resume],[data-stopfolder],[data-importfolder],[data-font]");
    if (!t) { if (viewerEl && e.target.classList?.contains("stage")) closeViewer(); return; }
    const has = a => t.hasAttribute(a);
    if (has("data-camera")) { (touch() ? cameraInput : libraryInput).value = ""; (touch() ? cameraInput : libraryInput).click(); }
    else if (has("data-library")) { libraryInput.value = ""; libraryInput.click(); }
    else if (t.dataset.open) openViewer(t.dataset.open);
    else if (has("data-close")) closeViewer();
    else if (t.dataset.step) step(Number(t.dataset.step));
    else if (has("data-export")) exportBackup();
    else if (has("data-import")) { importInput.value = ""; importInput.click(); }
    else if (t.dataset.font) {
      const lang = t.dataset.lang;
      try { localStorage.setItem(`diary.hand.${lang}`, t.dataset.font); } catch {}
      applyHand();
      root.querySelectorAll(`.font-opt[data-lang="${lang}"]`).forEach(b => b.setAttribute("aria-pressed", String(b === t)));
      const hn = root.querySelector("#handName"); if (hn) hn.textContent = `${fontsNow().ko.name} + ${fontsNow().en.name}`;
    }
    else if (has("data-folder")) chooseFolder();
    else if (has("data-resume")) resumeFolder();
    else if (has("data-importfolder")) importFolder();
    else if (has("data-stopfolder")) { await store.setMeta("backupDir", null); dir = null; dirOK = false; render(); }
    else if (t.dataset.delete) {
      if (!t.classList.contains("danger-armed")) {
        t.classList.add("danger-armed"); t.textContent = "Tap again to delete";
        setTimeout(() => { if (t.isConnected) { t.classList.remove("danger-armed"); t.textContent = "Delete photo"; } }, 3000);
        return;
      }
      const id = t.dataset.delete;
      const i = dayPhotos.findIndex(p => p.id === id);
      await store.delPhoto(id);
      changed();
      const next = dayPhotos[i + 1] || dayPhotos[i - 1];
      state.viewer = next ? next.id : null;
      if (!state.viewer) closeViewer();
      render();
    }
  });
  on(document, "input", e => {
    const t = e.target;
    if (t.matches?.(".caption")) { grow(t); const id = t.dataset.cap, v = t.value; queueText(`cap:${id}`, () => store.setCaption(id, v)); }
    else if (t.id === "note") { grow(t); const k = route().date, v = t.value; queueText(`note:${k}`, () => store.setNote(k, v)); }
  });
  on(cameraInput, "change", () => cameraInput.files.length && addFiles([...cameraInput.files]));
  on(libraryInput, "change", () => libraryInput.files.length && addFiles([...libraryInput.files]));
  on(importInput, "change", () => importInput.files[0] && importBackup(importInput.files[0]));
  on(document, "toggle", e => { if (e.target.matches?.(".fonts")) state.fontsOpen = e.target.open; }, { capture: true });
  on(window, "hashchange", () => { closeViewer(); render(); });
  on(window, "scroll", () => { (state.scroll ||= {})[location.hash] = window.scrollY; }, { passive: true });
  on(window, "pagehide", () => flushText());
  on(document, "keydown", e => {
    if (!viewerEl) return;
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
  let lastToday = todayKey();
  on(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") flushText();
    else if (todayKey() !== lastToday) { lastToday = todayKey(); render(); }
  });

  await render();

  return async function unmount() {
    await flushText();
    clearTimeout(syncTimer);
    ctl.abort();
    revoke();
    if (viewerEl) { viewerEl.remove(); viewerEl = null; }
    cameraInput.remove(); libraryInput.remove(); importInput.remove();
    db.close();
  };
}
