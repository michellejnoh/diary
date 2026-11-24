export const VERSION = "9"; // bump on every change; shown at the bottom of Archive
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
    getDay: k => run("days", "readonly", t => t.objectStore("days").get(k)).then(d => d || { date: k }),
    patchDay: (k, patch) => run("days", "readwrite", t => {
      const s = t.objectStore("days");
      s.get(k).onsuccess = e => {
        const d = Object.assign(e.target.result || { date: k }, patch, { updated: Date.now() });
        if (!d.note && !d.collage && !d.view) s.delete(k); else s.put(d);
      };
    }),
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

const ROUGH = `<filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="2.6"/></filter>`;
const CAMERA = `<svg class="cam" viewBox="0 0 48 36" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><g filter="url(#rough)">
  <path d="M5.2 11.6c3.6-.5 7.4-.1 9.5-.7l2.9-4.4c.5-.7 1.1-.9 1.8-.9l9.5.3c.7 0 1.2.4 1.6 1l2.6 4.1c3.5.3 6.7-.2 9.9.3.9.2 1.4.9 1.4 1.9l-.5 17.2c0 1-.7 1.6-1.7 1.7-12.7.5-25.3.1-37.9-.2-1 0-1.6-.8-1.6-1.8l-.6-16.7c0-.9.6-1.7 1.6-1.9z"/>
  <path d="M24.4 14.3c4.3-.2 7.4 2.9 7.3 6.8-.1 4-3.4 6.9-7.4 6.8-4.2-.1-7.1-3.2-6.9-7.1.2-3.6 3-6.3 7-6.5z"/>
  <path d="M22.6 13.8c5.1-.9 9.4 2.4 9.5 7" opacity=".55"/>
  <path d="M24.2 18.1c1.7-.1 2.9 1.1 2.9 2.7 0 1.6-1.3 2.8-3 2.8-1.6 0-2.8-1.3-2.7-2.9.1-1.4 1.2-2.5 2.8-2.6z"/>
  <path d="M36.8 15.4l3.5-.2"/><path d="M8.9 11l.3-2.4 3.5-.1.2 2.2"/>
</g></svg>`;
const STICKERS = {
  star: { color: "#C08A26", path: "M30.5 6.5l6.2 15.2 16.6 1.6-12.8 10.6 4.4 16.4-14.6-9-14.3 9.3 3.9-16.6L7.4 23.5l16.8-1.4z" },
  heart: { color: "#B9452E", path: "M30 50.5C14.5 40 7.2 31 8.6 22c1.3-8.3 10.8-11.4 16.6-6.3 2.3 2 3.9 4.5 4.9 7.3 1.5-3.6 3.6-6.8 7.1-8.5 6.6-3.2 13.9 1 14.2 8.8.4 9.4-7.9 17.6-21.4 27.2z" },
  arrow: { color: "#2C2B27", path: "M8.5 41.5c9.5-11.8 24.6-19.6 41.4-20.4M50 21l-8.6-6.1M50 21l-6.2 8.6" },
  circle: { color: "#2C2B27", path: "M30 9.2c13.2-.9 22.6 8.1 21.9 20.4-.8 12.8-11.8 21.6-24.1 20.8C15 49.7 7.6 40.4 8.3 28.6 9.1 17.4 18.2 9.9 33.4 10.6c5.1.3 9.2 2 12.3 4.6" },
  sparkle: { color: "#C08A26", path: "M30 8.5c1.6 11.7 5.1 15.8 17.8 21.5-12.8 4.3-16.3 8.1-17.8 21.5-1.8-13.6-5.2-17.4-18-21.5 12.9-5.8 16.5-9.8 18-21.5z" },
  squiggle: { color: "#2C2B27", path: "M5 32.5c5.8-6.2 10.1 6.1 15.9-.1s10.3 6.2 16.1 0 10.2 6.1 16-.1" },
};
const stickerSVG = k => `<svg viewBox="0 0 60 60" fill="none" stroke="${STICKERS[k].color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${STICKERS[k].path}" filter="url(#rough)"/></svg>`;
const ROTATE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18.5 9.5a7 7 0 1 0 .8 5.6"/><path d="M19 4.5v5h-5"/></svg>`;

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
        days: days.map(d => ({ date: d.date, note: d.note, view: d.view, collage: d.collage, updated: d.updated })),
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

  // shared pencil-wobble filter for drawn icons and stickers
  const defsEl = document.createElement("div");
  defsEl.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${ROUGH}</defs></svg>`;
  document.body.append(defsEl);

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
    const [photos, day] = await Promise.all([store.photosOn(k), store.getDay(k)]);
    const note = day.note || "";
    dayPhotos = photos;
    const view = day.view || "grid";
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
        <h1 class="page-title day-title">${title}</h1>
        <div class="viewbar">
          ${state.decorating ? "" : `
          <button class="link ${view === "grid" ? "on" : ""}" data-view="grid" aria-pressed="${view === "grid"}">Grid</button>
          <button class="link ${view === "collage" ? "on" : ""}" data-view="collage" aria-pressed="${view === "collage"}">Collage</button>
          ${view === "collage" ? `<span class="spacer"></span><button class="link" data-decorate>Decorate</button><button class="link" data-camera>${touch() ? "Take a photo" : "Add photos"}</button>` : ""}`}
        </div>
        ${view === "collage" ? `<div class="board ${state.decorating ? "editing" : ""}" id="board"></div>` : `<div class="roll">${prints}${add}</div>`}
        <div class="slip">
          <span class="tape" aria-hidden="true"></span>
          <label class="sr" for="note">About the day</label>
          <textarea class="note" id="note" rows="3" placeholder="how was today?">${esc(note)}</textarea>
        </div>
        ${state.decorating ? "" : backupLine()}
      </div>
      ${state.decorating && view === "collage" ? decoBar() : ""}`;
    root.querySelector(".wrap").classList.toggle("decorating", !!state.decorating && view === "collage");

    if (view === "collage") await mountBoard(k, day, photos);
    else { state.decorating = false; teardownBoard(); }
    root.querySelectorAll("textarea").forEach(grow);
    window.scrollTo(0, state.scroll?.[location.hash] || 0);
  }
  const grow = ta => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };

  // ---------- collage ----------
  let col = null, colKey = null, boardEl = null, ro = null, selectedId = null, drag = null, colTimer = null;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const topZ = () => Math.max(0, ...col.items.map(i => i.z || 0));
  const byPhoto = () => Object.fromEntries(dayPhotos.map(p => [p.id, p]));

  function placePhotos(items, photos) {
    const have = new Set(items.filter(i => i.kind === "photo").map(i => i.ref));
    const ids = new Set(photos.map(p => p.id));
    let added = false;
    items = items.filter(i => i.kind !== "photo" || ids.has(i.ref));
    let n = items.filter(i => i.kind === "photo").length;
    const small = root.clientWidth < 640, cols = small ? 2 : 3, w = small ? .44 : .27;
    for (const p of photos) if (!have.has(p.id)) {
      const c = n % cols, r = Math.floor(n / cols), j = ((n * 37) % 11 - 5) / 100;
      items.push({ id: newId(), kind: "photo", ref: p.id, x: .03 + c * (.94 / cols) + j * .4, y: .05 + r * w * 1.42 + Math.abs(j) * .5,
        w, rot: ((n * 53) % 9 - 4) * 1.1, z: n + 1 });
      n++; added = true;
    }
    return { items, added };
  }

  const pos = i => `left:calc(var(--bw) * ${i.x});top:calc(var(--bw) * ${i.y});width:calc(var(--bw) * ${i.w});transform:rotate(${i.rot}deg);z-index:${i.z || 1}`;
  function itemHTML(i, photos) {
    let inner = "";
    if (i.kind === "photo") {
      const p = photos[i.ref];
      inner = `<span class="tape" aria-hidden="true"></span>
        <div class="frame"${state.decorating ? "" : ` data-open="${p.id}" role="button" tabindex="0" aria-label="Open photo"`}>
          <span class="photo"><img src="${url(p.blob)}" alt="" draggable="false" class="${developIds.has(p.id) ? "developing" : ""}"><span class="stamp">${stampSVG(p.date)}</span></span>
        </div>${p.caption ? `<p class="ccap">${esc(p.caption)}</p>` : ""}`;
    } else if (i.kind === "text") {
      inner = `<div class="ctext" style="font-size:calc(var(--bw) * ${i.fs})" spellcheck="false">${esc(i.text)}</div>`;
    } else if (i.kind === "tape") {
      inner = `<span class="ctape"></span>`;
    } else if (i.kind === "sticker") {
      inner = `<span class="csticker">${stickerSVG(i.shape)}</span>`;
    }
    const handles = state.decorating ? `<span class="h-rot" data-h="t" title="Turn and resize">${ROTATE_ICON}</span>${i.kind !== "photo" ? `<button class="h-del" data-h="d" aria-label="Remove">×</button>` : ""}` : "";
    return `<div class="ci ci-${i.kind}${i.id === selectedId ? " sel" : ""}" data-id="${i.id}" style="${pos(i)}">${inner}${handles}</div>`;
  }

  async function mountBoard(k, day, photos) {
    teardownBoard();
    boardEl = root.querySelector("#board");
    colKey = k;
    const placed = placePhotos(day.collage?.items ? structuredClone(day.collage.items) : [], photos);
    col = { items: placed.items };
    if (placed.added || !day.collage) saveCollage(true);
    const setBW = () => { boardEl.style.setProperty("--bw", boardEl.clientWidth + "px"); fitBoard(); };
    const pm = byPhoto();
    boardEl.innerHTML = col.items.map(i => itemHTML(i, pm)).join("") + (state.decorating ? "" : (photos.length ? "" : `<p class="board-empty">Add a photo to start.</p>`));
    setBW();
    ro = new ResizeObserver(setBW); ro.observe(boardEl);
    developIds = new Set();
    if (state.decorating) {
      boardEl.addEventListener("pointerdown", onDown);
      boardEl.addEventListener("pointermove", onMove);
      boardEl.addEventListener("pointerup", onUp);
      boardEl.addEventListener("pointercancel", onUp);
    }
  }
  function teardownBoard() { if (ro) { ro.disconnect(); ro = null; } boardEl = null; }

  function fitBoard() {
    if (!boardEl) return;
    let max = 0;
    boardEl.querySelectorAll(".ci").forEach(el => { max = Math.max(max, el.offsetTop + el.offsetHeight); });
    boardEl.style.height = Math.max(max + 48, boardEl.clientWidth * (state.decorating ? 1.1 : .5)) + "px";
  }
  function saveCollage(now = false) {
    clearTimeout(colTimer);
    const k = colKey, items = structuredClone(col.items);
    const go = async () => { await store.patchDay(k, { collage: { items } }); changed(); };
    if (now) go(); else colTimer = setTimeout(go, 400);
  }
  function applyPos(el, i) {
    el.style.left = `calc(var(--bw) * ${i.x})`; el.style.top = `calc(var(--bw) * ${i.y})`;
    el.style.width = `calc(var(--bw) * ${i.w})`; el.style.transform = `rotate(${i.rot}deg)`; el.style.zIndex = i.z;
    const t = el.querySelector(".ctext"); if (t && i.fs) t.style.fontSize = `calc(var(--bw) * ${i.fs})`;
  }
  function select(id) {
    selectedId = id;
    boardEl?.querySelectorAll(".ci").forEach(el => el.classList.toggle("sel", el.dataset.id === id));
  }
  function removeItem(id) {
    col.items = col.items.filter(i => i.id !== id);
    boardEl.querySelector(`.ci[data-id="${id}"]`)?.remove();
    select(null); fitBoard(); saveCollage();
  }
  function addItem(kind, extra = {}) {
    const bw = boardEl.clientWidth, top = boardEl.getBoundingClientRect().top;
    const cy = clamp((innerHeight * .4 - top) / bw, .04, boardEl.clientHeight / bw);
    const base = { id: newId(), kind, rot: (Math.random() * 10 - 5), z: topZ() + 1 };
    const it = kind === "text" ? { ...base, x: .2, y: cy, w: .5, fs: .06, text: "" }
      : kind === "tape" ? { ...base, x: .3, y: cy, w: .3 }
      : { ...base, x: .38, y: cy, w: .2, ...extra };
    col.items.push(it);
    boardEl.insertAdjacentHTML("beforeend", itemHTML(it, byPhoto()));
    select(it.id); fitBoard(); saveCollage();
    if (kind === "text") startTextEdit(boardEl.querySelector(`.ci[data-id="${it.id}"]`), it);
  }
  function startTextEdit(el, it) {
    const t = el.querySelector(".ctext");
    t.contentEditable = "true"; t.focus();
    const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    t.oninput = () => { it.text = t.innerText; fitBoard(); saveCollage(); };
    t.onblur = () => { t.contentEditable = "false"; if (!it.text.trim()) removeItem(it.id); };
  }

  function onDown(e) {
    const el = e.target.closest(".ci");
    if (e.target.closest(".h-del")) { e.preventDefault(); removeItem(el.dataset.id); return; }
    if (!el) { document.activeElement?.blur?.(); select(null); return; }
    const t = el.querySelector(".ctext");
    if (t && t.isContentEditable && e.target.closest(".ctext")) return; // typing in it
    e.preventDefault();
    const it = col.items.find(i => i.id === el.dataset.id);
    const wasSel = selectedId === it.id;
    select(it.id);
    it.z = topZ() + 1; el.style.zIndex = it.z;
    if (e.target.closest(".h-rot")) {
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      drag = { mode: "t", it, el, cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), d0: Math.max(10, Math.hypot(e.clientX - cx, e.clientY - cy)), rot0: it.rot, w0: it.w, fs0: it.fs };
    } else {
      drag = { mode: "m", it, el, sx: e.clientX, sy: e.clientY, x0: it.x, y0: it.y, bw: boardEl.clientWidth, moved: false, wasSel };
    }
    boardEl.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    if (!drag) return;
    const { it, el } = drag;
    if (drag.mode === "m") {
      const dx = (e.clientX - drag.sx) / drag.bw, dy = (e.clientY - drag.sy) / drag.bw;
      if (Math.abs(dx) + Math.abs(dy) > .008) drag.moved = true;
      it.x = clamp(drag.x0 + dx, -.15, .95); it.y = Math.max(-.05, drag.y0 + dy);
    } else {
      const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx), d = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
      it.rot = drag.rot0 + (a - drag.a0) * 180 / Math.PI;
      it.w = clamp(drag.w0 * d / drag.d0, .06, 1.1);
      if (drag.fs0) it.fs = drag.fs0 * it.w / drag.w0;
    }
    applyPos(el, it);
  }
  function onUp() {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === "m" && !d.moved && d.wasSel && d.it.kind === "text") startTextEdit(d.el, d.it);
    fitBoard(); saveCollage();
  }

  function decoBar() {
    return `<div class="decobar" role="toolbar" aria-label="Decorate">
      <button data-deco="text">Text</button>
      <button data-deco="tape" aria-label="Tape"><span class="tape-swatch"></span></button>
      ${Object.keys(STICKERS).map(k => `<button data-deco="sticker" data-shape="${k}" aria-label="${k}">${stickerSVG(k)}</button>`).join("")}
      <button class="done" data-deco="done">Done</button>
    </div>`;
  }

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
          <h2 class="month-title">${MONTHS[m]} ${y}${n ? `<span class="count">${n} of ${daysIn} days</span>` : ""}</h2>
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
        <h1 class="page-title day-title">Archive</h1>
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
    for (const d of days) await store.patchDay(d.date, { note: d.note || "", ...(d.collage ? { collage: d.collage } : {}), ...(d.view ? { view: d.view } : {}) });
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
    const t = e.target.closest("[data-camera],[data-library],[data-open],[data-close],[data-step],[data-delete],[data-export],[data-import],[data-folder],[data-resume],[data-stopfolder],[data-importfolder],[data-font],[data-view],[data-decorate],[data-deco]");
    if (!t) { if (viewerEl && e.target.classList?.contains("stage")) closeViewer(); return; }
    const has = a => t.hasAttribute(a);
    if (has("data-camera")) { (touch() ? cameraInput : libraryInput).value = ""; (touch() ? cameraInput : libraryInput).click(); }
    else if (has("data-library")) { libraryInput.value = ""; libraryInput.click(); }
    else if (t.dataset.open) openViewer(t.dataset.open);
    else if (has("data-close")) closeViewer();
    else if (t.dataset.step) step(Number(t.dataset.step));
    else if (has("data-export")) exportBackup();
    else if (has("data-import")) { importInput.value = ""; importInput.click(); }
    else if (t.dataset.view) {
      await store.patchDay(route().date, { view: t.dataset.view });
      changed(); render();
    }
    else if (has("data-decorate")) { state.decorating = true; selectedId = null; render(); }
    else if (t.dataset.deco) {
      const a = t.dataset.deco;
      if (a === "done") { document.activeElement?.blur?.(); clearTimeout(colTimer); if (col) await store.patchDay(colKey, { collage: { items: col.items } }); state.decorating = false; selectedId = null; changed(); render(); }
      else if (a === "sticker") addItem("sticker", { shape: t.dataset.shape });
      else addItem(a);
    }
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
    else if (t.id === "note") { grow(t); const k = route().date, v = t.value; queueText(`note:${k}`, () => store.patchDay(k, { note: v })); }
  });
  on(cameraInput, "change", () => cameraInput.files.length && addFiles([...cameraInput.files]));
  on(libraryInput, "change", () => libraryInput.files.length && addFiles([...libraryInput.files]));
  on(importInput, "change", () => importInput.files[0] && importBackup(importInput.files[0]));
  on(document, "toggle", e => { if (e.target.matches?.(".fonts")) state.fontsOpen = e.target.open; }, { capture: true });
  on(window, "hashchange", () => { closeViewer(); state.decorating = false; render(); });
  on(window, "scroll", () => { (state.scroll ||= {})[location.hash] = window.scrollY; }, { passive: true });
  on(window, "pagehide", () => flushText());
  on(document, "keydown", e => {
    if (!viewerEl && (e.key === "Enter" || e.key === " ") && e.target.matches?.(".ci .frame[data-open]")) { e.preventDefault(); openViewer(e.target.dataset.open); return; }
    if (state.decorating && selectedId && (e.key === "Delete" || e.key === "Backspace") && !document.activeElement?.isContentEditable) {
      const it = col?.items.find(i => i.id === selectedId); if (it && it.kind !== "photo") removeItem(it.id);
    }
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
    if (col && colTimer) { clearTimeout(colTimer); await store.patchDay(colKey, { collage: { items: col.items } }); }
    teardownBoard();
    defsEl.remove();
    clearTimeout(syncTimer);
    ctl.abort();
    revoke();
    if (viewerEl) { viewerEl.remove(); viewerEl = null; }
    cameraInput.remove(); libraryInput.remove(); importInput.remove();
    db.close();
  };
}
