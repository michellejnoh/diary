export const VERSION = "18"; // bump on every change; shown at the bottom of Archive
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
    const r = indexedDB.open("diary", 4);
    r.onupgradeneeded = (e) => {
      const db = r.result, t = r.transaction;
      if (!db.objectStoreNames.contains("days")) db.createObjectStore("days", { keyPath: "date" });
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" }).createIndex("date", "date");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets", { keyPath: "id" }); // photo stickers
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
        if (!d.note && !d.collage && !d.paper) s.delete(k); else s.put(d);
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
        if (!s) out[v.date] = { count: 1, thumbs: [{ t: v.thumb, a: v.added }] };
        else { s.count++; s.thumbs.push({ t: v.thumb, a: v.added }); s.thumbs.sort((x, y) => x.a - y.a); s.thumbs.length = Math.min(3, s.thumbs.length); }
        c.continue();
      };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
    }),
    getAssets: ids => new Promise((res, rej) => {
      const t = db.transaction("assets", "readonly"), s = t.objectStore("assets"), out = {};
      for (const id of ids) s.get(id).onsuccess = e => { if (e.target.result) out[id] = e.target.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
    }),
    putAsset: a => run("assets", "readwrite", t => t.objectStore("assets").put(a)),
    delAsset: id => run("assets", "readwrite", t => t.objectStore("assets").delete(id)),
    dump: () => new Promise((res, rej) => {
      const t = db.transaction(["days", "photos", "assets"], "readonly"); const box = {};
      t.objectStore("days").getAll().onsuccess = e => box.days = e.target.result;
      t.objectStore("photos").getAll().onsuccess = e => box.photos = e.target.result;
      t.objectStore("assets").getAll().onsuccess = e => box.assets = e.target.result;
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
const CAMERA = `<svg class="cam" viewBox="0 0 40 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><g filter="url(#rough)"><path d="M3.5 6.5h9l2.2-3h10.6l2.2 3h9v14h-33z"/><circle cx="20" cy="13.5" r="4.6"/></g></svg>`;
const PENCIL = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><g filter="url(#rough)"><path d="M4 20l1.2-4.4L15.8 5a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.4 18.8z"/><path d="M13.8 7l3.2 3.2"/></g></svg>`;
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
const assetFile = a => `${a.id}.${a.blob.type === "image/png" ? "png" : "jpg"}`;
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
const LOOK = "diary.look";
const lookNow = () => getPref(LOOK, "loose");
function applyLook() {
  const l = lookNow();
  document.documentElement.classList.toggle("look-loose", l === "loose");
  document.documentElement.classList.toggle("look-neat", l !== "loose");
}
// stable "random" numbers so a loose layout looks the same every time
const rnd = (n, k) => { const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
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
  applyLook();
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
      const { days, photos, assets } = await store.dump();
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
      const sdir = await dir.getDirectoryHandle("stickers", { create: true });
      const haveS = new Set(); for await (const name of sdir.keys()) haveS.add(name);
      const wantS = new Set();
      for (const a of assets) {
        const name = assetFile(a); wantS.add(name);
        if (!haveS.has(name)) { const w = await (await sdir.getFileHandle(name, { create: true })).createWritable(); await w.write(a.blob); await w.close(); }
      }
      for (const name of haveS) if (!wantS.has(name)) await sdir.removeEntry(name);
      const index = {
        app: "diary", version: 4, saved: new Date().toISOString(),
        days: days.map(d => ({ date: d.date, note: d.note, view: d.view, collage: d.collage, updated: d.updated })),
        photos: photos.map(p => ({ id: p.id, date: p.date, added: p.added, caption: p.caption || "", file: `photos/${photoFile(p)}` })),
        stickers: assets.map(a => ({ id: a.id, source: a.source || null, file: `stickers/${assetFile(a)}` })),
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
  const stickerInput = mkInput({ accept: "image/*", multiple: true });

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
    const old = urls; urls = [];
    root.style.minHeight = root.offsetHeight + "px"; // hold the page height so nothing jumps while swapping
    const r = route();
    if (r.page === "archive") await renderArchive(); else await renderDay(r.date);
    if (state.viewer && r.page === "day") openViewer(state.viewer, false);
    requestAnimationFrame(() => { root.style.minHeight = ""; old.forEach(URL.revokeObjectURL); });
  }

  // ---------- day page: one board. Grid by default; Decorate to move things freely ----------
  function backupLine() {
    if (dir && !dirOK) return `<p class="nudge">Backup paused. <button class="link" data-resume>Resume</button></p>`;
    if (dir) return "";
    if (ls.get(LAST_CHANGE) <= ls.get(LAST_BACKUP)) return "";
    return canFolder
      ? `<p class="nudge">Not backed up. <button class="link" data-folder>Choose backup folder</button></p>`
      : `<p class="nudge">Not backed up. <button class="link" data-export>Save backup</button></p>`;
  }

  async function renderDay(k) {
    const d = fromKey(k), isToday = k === todayKey();
    const [photos, day] = await Promise.all([store.photosOn(k), store.getDay(k)]);
    const preAssets = await store.getAssets((day.collage?.items || []).filter(i => i.kind === "image").map(i => i.ref));
    const flipping = !!state.navDir;
    dayPhotos = photos;
    const editing = !!state.decorating;
    const prevK = keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
    const nextK = keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
    const hrefOf = k2 => k2 === todayKey() ? "#/" : `#/day/${k2}`;
    state.navDir = null;
    const paper = day.paper || "card";
    const title = isToday
      ? `<span class="soft">Today,</span> ${d.getDate()} ${MONTHS[d.getMonth()]}`
      : `<span class="soft">${WEEKDAYS[d.getDay()]},</span> ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

    root.innerHTML = `
      <div class="wrap${editing ? " decorating" : ""}">
        <header class="top">
          <a class="wordmark" href="#/">Diary</a>
          <a class="navtag" href="#/archive">Archive</a>
        </header>
        <div class="dayhead">
          <div class="daytitle">
            ${editing ? "" : `<a class="daynav" href="${hrefOf(prevK)}" data-nav="prev" aria-label="Previous day">‹</a>`}
            <h1 class="page-title day-title">${title}</h1>
            ${editing || isToday ? "" : `<a class="daynav" href="${hrefOf(nextK)}" data-nav="next" aria-label="Next day">›</a>`}
          </div>
          ${editing ? `<span class="hint typed">Drag to move. Corner handle turns and resizes.</span>` : `<button class="link" data-decorate>Decorate</button>`}
        </div>
        <div class="pagewrap paper-${paper}" id="pagewrap">
        <div class="board${editing ? " editing" : ""}" id="board"></div>
        <div class="slip">
          <span class="tape" aria-hidden="true"></span>
          <label class="sr" for="note">About the day</label>
          <textarea class="note" id="note" rows="3" placeholder="how was today?">${esc(day.note || "")}</textarea>
        </div>
        </div>
        ${editing ? "" : backupLine()}
      </div>
      ${editing ? `<div class="decobar" role="toolbar" aria-label="Decorate"></div>` : ""}`;

    mountBoard(k, day, photos, preAssets);
    root.querySelectorAll("textarea").forEach(grow);
    if (!flipping) window.scrollTo(0, state.scroll?.[location.hash] || 0);
  }
  const grow = ta => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };

  // ---------- board ----------
  let col = null, colKey = null, boardEl = null, ro = null, lastW = 0, selectedId = null, drag = null, colTimer = null;
  let assets = {}; // id -> asset
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const topZ = () => Math.max(0, ...col.items.map(i => i.z || 0));
  const botZ = () => Math.min(1, ...col.items.map(i => i.z || 1));
  const photoMap = () => Object.fromEntries(dayPhotos.map(p => [p.id, p]));
  const TILTS = [-1.1, .8, -.3, 1.3];
  const COLORS = ["#2C2B27", "#B9452E", "#2F4F8A", "#3F6B45", "#D9772B", "#F7F5EF"];
  const HILITES = ["#F4D84E", "#F2A0B4", "#9ED48F", "#97C3EC", "#2A2925"];

  // grid slots, in board-width units
  function grid() {
    const bw = boardEl.clientWidth || 360;
    const cols = bw < 560 ? 2 : bw < 900 ? 3 : 4, gap = bw < 560 ? .05 : .035;
    const capH = 92 / bw;
    if (lookNow() !== "loose") {
      const w = (1 - gap * (cols - 1) - .02) / cols;
      const rowH = w * 1.34 + capH;
      return n => ({ x: .01 + (n % cols) * (w + gap), y: .035 + Math.floor(n / cols) * rowH, w, rot: TILTS[n % 4] });
    }
    // loose: each row gets mixed sizes, uneven gaps, small drops and turns; rows nest into each other a little
    const rows = [];
    const row = r => {
      while (rows.length <= r) {
        const i = rows.length, top = i ? rows[i - 1].top + rows[i - 1].h : .03;
        const scales = Array.from({ length: cols }, (_, c) => .8 + rnd(i * 7 + c, 1) * .42);
        const gaps = Array.from({ length: cols - 1 }, (_, c) => -.012 + rnd(i * 7 + c, 2) * .06);
        const total = scales.reduce((a, b) => a + b, 0), room = .97 - gaps.reduce((a, b) => a + b, 0);
        const ws = scales.map(v => v / total * room);
        let x = .015 + (rnd(i, 3) - .5) * .02; const xs = [];
        ws.forEach((w, c) => { xs.push(x); x += w + (gaps[c] || 0); });
        const drops = ws.map((w, c) => rnd(i * 7 + c, 4) * .07);
        const h = Math.max(...ws.map((w, c) => w * 1.34 + drops[c])) * .9 + capH;
        rows.push({ top, h, ws, xs, drops });
      }
      return rows[r];
    };
    return n => {
      const R = row(Math.floor(n / cols)), c = n % cols;
      return { x: R.xs[c], y: R.top + R.drops[c], w: R.ws[c], rot: (rnd(n, 5) - .5) * 6.5 };
    };
  }
  function layoutAuto() {
    const slot = grid(); let n = 0;
    const order = dayPhotos.map(p => p.id);
    col.items.filter(i => i.kind === "photo" && i.auto)
      .sort((a, b) => order.indexOf(a.ref) - order.indexOf(b.ref))
      .forEach(i => { Object.assign(i, slot(n)); n++; });
    const add = slot(n);
    return lookNow() === "loose" ? { ...add, w: Math.min(add.w, .42), rot: 0 } : add; // where the add tile goes
  }

  const pos = i => `left:calc(var(--bw) * ${i.x});top:calc(var(--bw) * ${i.y});width:calc(var(--bw) * ${i.w});transform:rotate(${i.rot || 0}deg);z-index:${i.z || 1}`;
  function textStyle(i) {
    const st = [`color:${i.color || COLORS[0]}`];
    if (i.bold) st.push("font-weight:700");
    if (i.hl) st.push(`--hl:${i.hl}`);
    return st.join(";");
  }
  function itemHTML(i) {
    const editing = !!state.decorating;
    let inner = "";
    if (i.kind === "photo") {
      const p = photoMap()[i.ref]; if (!p) return "";
      const time = keyOf(new Date(p.added)) === p.date ? `<span class="time">${timeOf(p.added)}</span>` : "";
      const img = `<span class="photo"><img src="${url(p.blob)}" alt="" draggable="false" class="${developIds.has(p.id) ? "developing" : ""}"></span>`;
      inner = `<span class="tape" aria-hidden="true"></span>` + (editing
        ? `<div class="frame">${img}</div>${p.caption ? `<p class="ccap">${esc(p.caption)}</p>` : ""}`
        : `<button class="frame" data-open="${p.id}" aria-label="Open photo">${img}</button>
           <div class="cap">${time}<label class="sr" for="cap-${p.id}">Note for this photo</label><textarea class="caption" id="cap-${p.id}" data-cap="${p.id}" rows="1" placeholder="write about this one">${esc(p.caption)}</textarea></div>`);
    } else if (i.kind === "text") {
      const cls = ["ctext", `f-${i.font || "hand"}`, i.hl ? "hl" : "", i.tape ? "taped" : ""].join(" ");
      inner = `<div class="ctextbox" style="font-size:calc(var(--bw) * ${i.fs})"><span class="${cls}" style="${textStyle(i)}" spellcheck="false">${esc(i.text)}</span></div>`;
    } else if (i.kind === "tape") {
      inner = `<span class="ctape"></span>`;
    } else if (i.kind === "image") {
      const a = assets[i.ref]; if (!a) return "";
      inner = `<img class="cimg" src="${url(a.blob)}" alt="" draggable="false">`;
    } else return "";
    const handles = editing ? `<span class="h-rot" data-h="t" title="Turn and resize">${ROTATE_ICON}</span>${i.kind !== "photo" ? `<button class="h-del" data-h="d" aria-label="Remove">×</button>` : ""}` : "";
    const extra = (i.kind === "image" && i.outline ? " outline" : "") + (i.kind === "photo" ? ` fr-${i.frame || "print"} lk-${i.look || "none"}` : "");
    const seed = [...i.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const vars = i.kind === "photo" ? `;--lift:${(.6 + rnd(seed, 6) * .9).toFixed(2)};--tape-x:${(35 + rnd(seed, 7) * 30).toFixed(0)}%;--tape-r:${((rnd(seed, 8) - .5) * 14).toFixed(1)}deg` : "";
    return `<div class="ci ci-${i.kind}${extra}${i.id === selectedId ? " sel" : ""}" data-id="${i.id}" style="${pos(i)}${vars}">${inner}${handles}</div>`;
  }

  function drawBoard() {
    const addSlot = layoutAuto();
    const add = state.decorating ? "" : `
      <div class="ci ci-add" style="${pos({ ...addSlot, rot: 0, z: 0 })}">
        <button class="add-tile" data-camera>${CAMERA}<span>${touch() ? "Take a photo" : "Add photos"}</span></button>
        ${touch() ? `<button class="link small" data-library>or choose from library</button>` : ""}
      </div>`;
    boardEl.innerHTML = col.items.map(itemHTML).join("") + add;
    boardEl.querySelectorAll(".caption").forEach(grow);
    fitBoard();
  }

  function mountBoard(k, day, photos, preAssets) {
    teardownBoard();
    boardEl = root.querySelector("#board");
    colKey = k;
    let items = day.collage?.items ? structuredClone(day.collage.items) : [];
    const ids = new Set(photos.map(p => p.id));
    items = items.filter(i => (i.kind !== "photo" || ids.has(i.ref)) && i.kind !== "sticker");
    const have = new Set(items.filter(i => i.kind === "photo").map(i => i.ref));
    let z = Math.max(0, ...items.map(i => i.z || 0));
    for (const p of photos) if (!have.has(p.id)) items.push({ id: newId(), kind: "photo", ref: p.id, auto: true, z: ++z });
    col = { items };
    paperNow = day.paper || "card";
    assets = preAssets || {};
    boardEl.style.setProperty("--bw", boardEl.clientWidth + "px");
    lastW = boardEl.clientWidth;
    drawBoard();
    developIds = new Set();
    ro = new ResizeObserver(() => {
      if (!boardEl || boardEl.clientWidth === lastW) return;
      lastW = boardEl.clientWidth;
      boardEl.style.setProperty("--bw", lastW + "px");
      if (!drag && !boardEl.contains(document.activeElement)) drawBoard(); else fitBoard();
    });
    ro.observe(boardEl);
    if (state.decorating) {
      boardEl.addEventListener("pointerdown", onDown);
      boardEl.addEventListener("pointermove", onMove);
      boardEl.addEventListener("pointerup", onUp);
      boardEl.addEventListener("pointercancel", onUp);
      renderDecoBar();
    }
  }
  function teardownBoard() { if (ro) { ro.disconnect(); ro = null; } boardEl = null; }

  function fitBoard() {
    if (!boardEl) return;
    let max = 0;
    boardEl.querySelectorAll(".ci").forEach(el => { max = Math.max(max, el.offsetTop + el.offsetHeight); });
    boardEl.style.height = Math.max(max + 36, state.decorating ? boardEl.clientWidth * .9 : 120) + "px";
  }
  function saveCollage(now = false) {
    clearTimeout(colTimer);
    const k = colKey, items = structuredClone(col.items);
    const go = async () => { await store.patchDay(k, { collage: { items } }); changed(); };
    if (now) return go(); colTimer = setTimeout(go, 400);
  }
  function applyPos(el, i) {
    el.style.left = `calc(var(--bw) * ${i.x})`; el.style.top = `calc(var(--bw) * ${i.y})`;
    el.style.width = `calc(var(--bw) * ${i.w})`; el.style.transform = `rotate(${i.rot}deg)`; el.style.zIndex = i.z;
    const t = el.querySelector(".ctextbox"); if (t && i.fs) t.style.fontSize = `calc(var(--bw) * ${i.fs})`;
  }
  const itemEl = id => boardEl?.querySelector(`.ci[data-id="${id}"]`);
  function redrawItem(it) {
    const el = itemEl(it.id); if (!el) return;
    el.outerHTML = itemHTML(it);
    fitBoard();
  }
  function select(id) {
    selectedId = id;
    boardEl?.querySelectorAll(".ci").forEach(el => el.classList.toggle("sel", el.dataset.id === id));
    renderDecoBar();
  }
  async function removeItem(id) {
    const it = col.items.find(i => i.id === id);
    col.items = col.items.filter(i => i.id !== id);
    itemEl(id)?.remove();
    if (it?.kind === "image") await store.delAsset(it.ref);
    select(null); fitBoard(); saveCollage();
  }
  const step5 = () => col.items.filter(i => i.kind !== "photo").length % 5; // new items step aside so they don't stack
  function dropY() {
    const bw = boardEl.clientWidth, top = boardEl.getBoundingClientRect().top;
    return clamp((innerHeight * .35 - top) / bw, .03, Math.max(.03, boardEl.clientHeight / bw - .2)) + step5() * .045;
  }
  function addItem(kind) {
    const base = { id: newId(), kind, rot: Math.round(Math.random() * 8 - 4), z: topZ() + 1, y: dropY() };
    const it = kind === "text"
      ? { ...base, x: .14 + step5() * .05, w: .55, fs: .06, text: "", font: "hand", color: COLORS[0], bold: false, hl: null, tape: false }
      : { ...base, x: .3 + step5() * .05, w: .3 };
    col.items.push(it);
    boardEl.insertAdjacentHTML("beforeend", itemHTML(it));
    select(it.id); fitBoard(); saveCollage();
    if (kind === "text") startTextEdit(itemEl(it.id), it);
  }

  // photo stickers: from the library, the clipboard, or Wikimedia Commons
  async function addImageBlob(blob, source = null) {
    if (!state.decorating) { state.decorating = true; selectedId = null; await render(); }
    const src = URL.createObjectURL(blob);
    try {
      const img = await loadImage(src);
      const keepAlpha = /png|webp|gif/.test(blob.type) || !blob.type;
      const s = Math.min(1, 1100 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const out = await new Promise(r => c.toBlob(r, keepAlpha ? "image/png" : "image/jpeg", .88));
      const id = newId();
      const a = { id, blob: out, source, added: Date.now() };
      await store.putAsset(a); assets[id] = a;
      const ratio = c.height / c.width;
      const it = { id: newId(), kind: "image", ref: id, x: .28 + step5() * .05, y: dropY(), w: clamp(.32 / Math.max(1, ratio), .16, .4), rot: Math.round(Math.random() * 8 - 4), z: topZ() + 1, outline: keepAlpha };
      col.items.push(it);
      boardEl.insertAdjacentHTML("beforeend", itemHTML(it));
      select(it.id); fitBoard(); saveCollage();
    } catch { alert("That image couldn’t be added. Try another one."); }
    finally { URL.revokeObjectURL(src); }
  }
  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const ci of items) {
        const type = ci.types.find(t => t.startsWith("image/"));
        if (type) { await addImageBlob(await ci.getType(type)); return; }
      }
      alert("No image on the clipboard. Copy an image first, then tap Paste.");
    } catch { alert("No image on the clipboard. Copy an image first, then tap Paste."); }
  }

  function startTextEdit(el, it) {
    const t = el.querySelector(".ctext");
    t.contentEditable = "true"; t.focus();
    const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    t.oninput = () => { it.text = t.innerText.replace(/\n$/, ""); fitBoard(); saveCollage(); };
    t.onblur = () => { t.contentEditable = "false"; if (!it.text.trim() && col.items.includes(it)) removeItem(it.id); };
  }

  // ---------- dragging ----------
  function onDown(e) {
    const el = e.target.closest(".ci");
    if (e.target.closest(".h-del")) { e.preventDefault(); removeItem(el.dataset.id); return; }
    if (!el || el.classList.contains("ci-add")) { if (document.activeElement?.isContentEditable) document.activeElement.blur(); select(null); return; }
    const t = el.querySelector(".ctext");
    if (t && t.isContentEditable && e.target.closest(".ctext")) return; // typing
    e.preventDefault();
    if (document.activeElement?.isContentEditable) document.activeElement.blur();
    const it = col.items.find(i => i.id === el.dataset.id);
    if (!it) return;
    const wasSel = selectedId === it.id;
    if (!wasSel) select(it.id);
    it.z = topZ() + 1; el.style.zIndex = it.z;
    if (e.target.closest(".h-rot")) {
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      drag = { mode: "t", it, el, cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), d0: Math.max(10, Math.hypot(e.clientX - cx, e.clientY - cy)), rot0: it.rot || 0, w0: it.w, fs0: it.fs };
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
      if (!drag.moved) return;
      it.x = clamp(drag.x0 + dx, -.15, .95); it.y = Math.max(-.05, drag.y0 + dy);
    } else {
      const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx), d = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
      it.rot = drag.rot0 + (a - drag.a0) * 180 / Math.PI;
      it.w = clamp(drag.w0 * d / drag.d0, .06, 1.1);
      if (drag.fs0) it.fs = drag.fs0 * it.w / drag.w0;
    }
    if (it.auto) delete it.auto; // the user placed it now
    applyPos(el, it);
  }
  function onUp() {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === "m" && !d.moved && d.wasSel && d.it.kind === "text") startTextEdit(d.el, d.it);
    fitBoard(); saveCollage();
  }

  // ---------- decorate toolbar ----------
  let decoTab = null, decoKind = null;
  function renderDecoBar() {
    const bar = root.querySelector(".decobar"); if (!bar) return;
    const it = col?.items.find(i => i.id === selectedId);
    const kind = it?.kind || "none";
    const tabsFor = { none: [["add", "Add"], ["page", "Page"]], text: [["style", "Style"], ["color", "Color"], ["marker", "Marker"]], photo: [["frame", "Frame"], ["look", "Look"]], image: [], tape: [] }[kind];
    if (kind !== decoKind) { decoKind = kind; decoTab = tabsFor[0]?.[0] || null; }
    const b = (attrs, label, pressed) => `<button ${attrs}${pressed != null ? ` aria-pressed="${!!pressed}"` : ""}>${label}</button>`;
    const opt = {
      add: () => `${b('data-deco="text"', "Text")}${b('data-deco="tape" aria-label="Tape"', `<span class="tape-swatch"></span> Tape`)}${b('data-deco="photo"', "Photo")}${b('data-deco="paste"', "Paste")}${b('data-deco="commons"', "Wikimedia")}`,
      page: () => `<span class="group">${[["card", "Card"], ["kraft", "Kraft"], ["grid", "Grid"], ["album", "Album"]].map(([f, n]) => b(`data-paper="${f}" class="paper-btn pb-${f}"`, n, curPaper() === f)).join("")}</span>
        <span class="group">${[["neat", "Neat"], ["loose", "Loose"]].map(([f, n]) => b(`data-look="${f}"`, n, lookNow() === f)).join("")}</span>${b('data-deco="tidy"', "Tidy up")}`,
      style: () => `<span class="group">${[["hand", "Hand"], ["type", "Type"], ["press", "Press"]].map(([f, n]) => b(`data-tx="font" data-v="${f}" class="f-${f}"`, n, (it.font || "hand") === f)).join("")}</span>
        ${b('data-tx="bold" class="bold"', "B", it.bold)}${b('data-tx="tape" aria-label="Tape behind text"', `<span class="tape-swatch"></span>`, it.tape)}`,
      color: () => COLORS.map(c => b(`data-tx="color" data-v="${c}" class="dot" style="--c:${c}" aria-label="Color ${c}"`, "", (it.color || COLORS[0]) === c)).join(""),
      marker: () => b('data-tx="hl" data-v="" class="hl-none" aria-label="No highlighter"', "", !it.hl) + HILITES.map(c => b(`data-tx="hl" data-v="${c}" class="hl-dot" style="--c:${c}" aria-label="Highlighter ${c}"`, "", it.hl === c)).join(""),
      frame: () => [["print", "Print"], ["instant", "Instant"], ["film", "Film"], ["torn", "Torn"]].map(([f, n]) => b(`data-ph="frame" data-v="${f}"`, n, (it.frame || "print") === f)).join(""),
      look: () => [["none", "Plain"], ["grain", "Grain"], ["warm", "Warm"], ["bw", "B&amp;W"]].map(([f, n]) => b(`data-ph="look" data-v="${f}"`, n, (it.look || "none") === f)).join(""),
    };
    const actions = (it ? (it.kind === "image" ? b('data-deco="outline"', "Outline", it.outline) : "") + b('data-deco="back"', "Send back") : "");
    const panel = (decoTab ? opt[decoTab]() : "") + (actions ? `<span class="group-sep"></span>${actions}` : "");
    // keep the option row where it was scrolled, as long as the same menu stays open
    const keyNow = `${kind}:${decoTab}`;
    const keep = bar.dataset.key === keyNow ? { p: bar.querySelector(".decoscroll")?.scrollLeft || 0, t: bar.querySelector(".decotabs")?.scrollLeft || 0 } : null;
    bar.dataset.key = keyNow;
    bar.innerHTML = `
      ${panel ? `<div class="decopanel"><div class="decoscroll">${panel}</div></div>` : ""}
      <div class="decorow">
        <div class="decotabs" role="tablist">${tabsFor.map(([k, n]) => `<button role="tab" class="dtab" data-dtab="${k}" aria-selected="${decoTab === k}">${n}</button>`).join("") || `<span class="typed dt-note">${it?.kind === "image" ? "Photo sticker" : it?.kind === "tape" ? "Tape" : ""}</span>`}</div>
        ${b('class="done" data-deco="done"', "Done")}
      </div>`;
    if (keep) {
      const sc = bar.querySelector(".decoscroll"); if (sc) sc.scrollLeft = keep.p;
      const tb = bar.querySelector(".decotabs"); if (tb) tb.scrollLeft = keep.t;
    }
  }
  async function decoAction(a, t) {
    const it = col.items.find(i => i.id === selectedId);
    if (a === "done") {
      if (document.activeElement?.isContentEditable) document.activeElement.blur();
      await saveCollage(true);
      state.decorating = false; selectedId = null; render();
    }
    else if (a === "text" || a === "tape") addItem(a);
    else if (a === "photo") { stickerInput.value = ""; stickerInput.click(); }
    else if (a === "paste") pasteFromClipboard();
    else if (a === "commons") openCommons();
    else if (a === "tidy") {
      col.items.forEach(i => { if (i.kind === "photo") i.auto = true; });
      drawBoard(); saveCollage();
    }
    else if (a === "back" && it) {
      it.z = botZ() - 1; col.items.forEach(i => { i.z = (i.z || 1) - it.z + 1; }); // keep z positive
      col.items.forEach(i => { const el = itemEl(i.id); if (el) el.style.zIndex = i.z; });
      saveCollage();
    }
    else if (a === "outline" && it) { it.outline = !it.outline; redrawItem(it); select(it.id); saveCollage(); }
  }
  let paperNow = "card";
  const curPaper = () => paperNow;
  function photoAction(t) {
    const it = col.items.find(i => i.id === selectedId); if (!it) return;
    it[t.dataset.ph] = t.dataset.v;
    redrawItem(it); select(it.id); saveCollage();
  }
  async function setPaper(v) {
    paperNow = v;
    const pw = root.querySelector("#pagewrap"); if (pw) pw.className = `pagewrap paper-${v}`;
    await store.patchDay(colKey, { paper: v === "card" ? undefined : v }); changed();
    renderDecoBar();
  }
  function textAction(t) {
    const it = col.items.find(i => i.id === selectedId); if (!it) return;
    const k = t.dataset.tx, v = t.dataset.v;
    if (k === "font") it.font = v;
    else if (k === "bold") it.bold = !it.bold;
    else if (k === "color") it.color = v;
    else if (k === "hl") it.hl = v || null;
    else if (k === "tape") it.tape = !it.tape;
    redrawItem(it); select(it.id); saveCollage();
  }

  // ---------- Wikimedia Commons picker ----------
  let sheetEl = null;
  function openCommons() {
    closeCommons();
    sheetEl = document.createElement("div");
    sheetEl.className = "sheet"; sheetEl.setAttribute("role", "dialog"); sheetEl.setAttribute("aria-modal", "true"); sheetEl.setAttribute("aria-label", "Find images on Wikimedia Commons");
    sheetEl.innerHTML = `
      <div class="sheet-card">
        <div class="sheet-head">
          <form class="sheet-search" data-commons-form>
            <input type="search" name="q" placeholder="Search images, e.g. cat, flower, ticket" autocomplete="off" enterkeyhint="search">
            <button type="submit">Search</button>
          </form>
          <button class="link" data-sheet-close>Close</button>
        </div>
        <p class="sheet-note typed">From Wikimedia Commons, transparent PNGs. Each image has its own license. English words find more.</p>
        <div class="sheet-results" aria-live="polite"></div>
      </div>`;
    document.body.append(sheetEl);
    sheetEl.querySelector("input").focus();
  }
  function closeCommons() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }
  async function searchCommons(q) {
    const box = sheetEl.querySelector(".sheet-results");
    box.innerHTML = `<p class="sheet-msg typed">Searching…</p>`;
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    Object.entries({ action: "query", format: "json", origin: "*", generator: "search", gsrnamespace: "6", gsrsearch: `${q} filemime:png`, gsrlimit: "30", prop: "imageinfo", iiprop: "url|mime", iiurlwidth: "600" })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    try {
      const data = await (await fetch(u)).json();
      const pages = Object.values(data.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
      const found = pages.map(p => ({ title: p.title.replace(/^File:/, ""), thumb: p.imageinfo?.[0]?.thumburl, page: p.imageinfo?.[0]?.descriptionurl })).filter(r => r.thumb);
      if (!found.length) { box.innerHTML = `<p class="sheet-msg typed">Nothing found. Try another word, in English.</p>`; return; }
      box.innerHTML = found.map(r => `<button class="pick" data-pick="${esc(r.thumb)}" data-page="${esc(r.page)}" data-title="${esc(r.title)}" aria-label="${esc(r.title)}"><img src="${esc(r.thumb)}" alt="" loading="lazy"></button>`).join("");
    } catch {
      box.innerHTML = `<p class="sheet-msg typed">Can’t reach Wikimedia right now. Check your connection and search again.</p>`;
    }
  }
  async function pickCommons(t) {
    t.classList.add("loading");
    try {
      const blob = await (await fetch(t.dataset.pick, { mode: "cors" })).blob();
      const source = { from: "Wikimedia Commons", title: t.dataset.title, url: t.dataset.page };
      closeCommons();
      await addImageBlob(blob, source);
    } catch { t.classList.remove("loading"); alert("That image couldn’t be loaded. Pick another one."); }
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
      const prefix = `${y}-${pad(m + 1)}-`;
      const days = dates.filter(k => k.startsWith(prefix)).reverse();
      const daysIn = new Date(y, m + 1, 0).getDate();
      const piles = days.map(k => {
        const s2 = sum[k], dd = fromKey(k);
        const stack = s2.thumbs.map((th, i) => `<img src="${url(th.t)}" alt="" style="--r:${[-6, 4, -1][i]}deg;--x:${[0, 8, -6][i]}%;z-index:${3 - i}">`).reverse().join("");
        return `<a class="pile" href="${k === tKey ? "#/" : `#/day/${k}`}" aria-label="${dd.getDate()} ${MONTHS[m]}, ${s2.count} photo${s2.count > 1 ? "s" : ""}">
          <span class="stack">${stack}</span>
          <span class="pile-date">${dd.getDate()} <span class="soft">${WEEKDAYS[dd.getDay()].slice(0, 3)}</span>${s2.count > 1 ? `<span class="pile-n">${s2.count}</span>` : ""}</span>
        </a>`;
      }).join("");
      months += `
        <section class="month">
          <h2 class="month-title">${MONTHS[m]} ${y}${days.length ? `<span class="count">${days.length} of ${daysIn} days</span>` : ""}</h2>
          ${days.length ? `<div class="piles">${piles}</div>` : `<p class="month-empty typed">No photos this month yet.</p>`}
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
          <a class="wordmark" href="#/">Diary</a>
          <a class="navtag" href="#/">Today</a>
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
        <div class="lookpick">
          <span class="typed">Page look</span>
          ${[["neat", "Neat grid"], ["loose", "Loose"]].map(([f, n]) => `<button class="chip" data-look="${f}" aria-pressed="${lookNow() === f}">${n}</button>`).join("")}
        </div>
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
      <div class="stage"><span class="photo lk-${(col?.items.find(x => x.ref === p.id)?.look) || "none"}"><img src="${url(p.blob)}" alt="Photo ${i + 1} of ${dayPhotos.length}"></span></div>
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
    const { days, photos, assets } = await store.dump();
    const out = { app: "diary", version: 4, days, photos: [], stickers: [] };
    for (const a of assets) out.stickers.push({ id: a.id, source: a.source || null, blob: await blobToData(a.blob) });
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

  async function restoreRecords(days, photos, stickers = []) {
    for (const a of stickers) await store.putAsset(a);
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
    const stickers = [];
    for (const a of data.stickers || []) stickers.push({ id: a.id, source: a.source, blob: await dataToBlob(a.blob) });
    restoreRecords(days, photos, stickers);
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
      const stickers = [];
      try {
        const sdir = await src.getDirectoryHandle("stickers");
        for (const a of index.stickers || []) {
          try { stickers.push({ id: a.id, source: a.source, blob: await (await sdir.getFileHandle(a.file.replace(/^stickers\//, ""))).getFile() }); } catch {}
        }
      } catch {}
      restoreRecords(index.days || [], photos, stickers);
    } catch (err) {
      if (err.name !== "AbortError") alert("That folder isn’t a diary backup. Choose the folder that has diary.json in it.");
    }
  }

  // ---------- events (all removed on unmount) ----------
  on(document, "click", async e => {
    const t = e.target.closest("[data-camera],[data-library],[data-open],[data-close],[data-step],[data-delete],[data-export],[data-import],[data-folder],[data-resume],[data-stopfolder],[data-importfolder],[data-font],[data-decorate],[data-deco],[data-tx],[data-sheet-close],[data-pick],[data-ph],[data-paper],[data-nav],[data-look],[data-dtab]");
    if (!t) {
      if (viewerEl && e.target.classList?.contains("stage")) closeViewer();
      if (sheetEl && e.target === sheetEl) closeCommons();
      return;
    }
    const has = a => t.hasAttribute(a);
    if (has("data-camera")) { const inp = touch() ? cameraInput : libraryInput; inp.value = ""; inp.click(); }
    else if (has("data-library")) { libraryInput.value = ""; libraryInput.click(); }
    else if (t.dataset.open) openViewer(t.dataset.open);
    else if (has("data-close")) closeViewer();
    else if (t.dataset.step) step(Number(t.dataset.step));
    else if (has("data-export")) exportBackup();
    else if (has("data-import")) { importInput.value = ""; importInput.click(); }
    else if (has("data-decorate")) { await flushText(); state.decorating = true; selectedId = null; render(); }
    else if (t.dataset.deco) decoAction(t.dataset.deco, t);
    else if (t.dataset.tx) textAction(t);
    else if (t.dataset.ph) photoAction(t);
    else if (t.dataset.dtab) { decoTab = decoTab === t.dataset.dtab ? null : t.dataset.dtab; renderDecoBar(); }
    else if (t.dataset.paper) setPaper(t.dataset.paper);
    else if (t.dataset.look) {
      try { localStorage.setItem(LOOK, t.dataset.look); } catch {}
      applyLook();
      if (boardEl) { drawBoard(); renderDecoBar(); }
      root.querySelectorAll("[data-look].chip").forEach(c => c.setAttribute("aria-pressed", String(c === t)));
    }
    else if (t.dataset.nav) state.navDir = t.dataset.nav === "prev" ? "right" : "left"; // link does the rest
    else if (has("data-sheet-close")) closeCommons();
    else if (t.dataset.pick) pickCommons(t);
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
  on(document, "pointerdown", e => {
    if (!state.decorating || !boardEl || sheetEl) return;
    if (boardEl.contains(e.target) || e.target.closest(".decobar")) return;
    if (document.activeElement?.isContentEditable) document.activeElement.blur();
    if (selectedId) select(null);
  });
  // swipe left/right on a day page = next/previous day
  let touch0 = null;
  on(document, "touchstart", e => {
    if (route().page !== "day" || state.decorating || viewerEl || sheetEl || e.touches.length !== 1) { touch0 = null; return; }
    if (e.target.closest("textarea, input, .decobar")) { touch0 = null; return; }
    touch0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  on(document, "touchend", e => {
    if (!touch0) return;
    const dx = e.changedTouches[0].clientX - touch0.x, dy = e.changedTouches[0].clientY - touch0.y;
    const quick = Date.now() - touch0.t < 600; touch0 = null;
    if (!quick || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * .6) return;
    goDay(dx < 0 ? 1 : -1);
  }, { passive: true });
  function goDay(n) {
    const k = route().date; if (!k) return;
    const d = fromKey(k), k2 = keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
    if (k2 > todayKey()) return;
    state.navDir = n > 0 ? "left" : "right";
    location.hash = k2 === todayKey() ? "#/" : `#/day/${k2}`;
  }
  on(document, "submit", e => {
    if (!e.target.matches?.("[data-commons-form]")) return;
    e.preventDefault();
    const q = e.target.q.value.trim(); if (q) searchCommons(q);
  });
  // paste an image anywhere on a day page = add it as a photo sticker
  on(document, "paste", e => {
    if (route().page !== "day" || viewerEl || sheetEl) return;
    const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    addImageBlob(file);
  });
  on(stickerInput, "change", async () => { for (const f of [...stickerInput.files]) await addImageBlob(f); });
  on(document, "input", e => {
    const t = e.target;
    if (t.matches?.(".caption")) { grow(t); const id = t.dataset.cap, v = t.value; queueText(`cap:${id}`, () => store.setCaption(id, v)); }
    else if (t.id === "note") { grow(t); const k = route().date, v = t.value; queueText(`note:${k}`, () => store.patchDay(k, { note: v })); }
  });
  on(cameraInput, "change", () => cameraInput.files.length && addFiles([...cameraInput.files]));
  on(libraryInput, "change", () => libraryInput.files.length && addFiles([...libraryInput.files]));
  on(importInput, "change", () => importInput.files[0] && importBackup(importInput.files[0]));
  on(document, "toggle", e => { if (e.target.matches?.(".fonts")) state.fontsOpen = e.target.open; }, { capture: true });
  on(window, "hashchange", () => { closeViewer(); closeCommons(); state.decorating = false; render(); });
  on(window, "scroll", () => { (state.scroll ||= {})[location.hash] = window.scrollY; }, { passive: true });
  on(window, "pagehide", () => flushText());
  on(document, "keydown", e => {
    if (!viewerEl && (e.key === "Enter" || e.key === " ") && e.target.matches?.(".ci .frame[data-open]")) { e.preventDefault(); openViewer(e.target.dataset.open); return; }
    if (state.decorating && selectedId && (e.key === "Delete" || e.key === "Backspace") && !document.activeElement?.isContentEditable) {
      const it = col?.items.find(i => i.id === selectedId); if (it && it.kind !== "photo") removeItem(it.id);
    }
    if (sheetEl && e.key === "Escape") { closeCommons(); return; }
    if (!viewerEl) {
      const typing = e.target.closest?.("textarea, input, [contenteditable='true']");
      if (!typing && !sheetEl && !state.decorating && route().page === "day" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) goDay(e.key === "ArrowLeft" ? -1 : 1);
      return;
    }
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
    closeCommons(); stickerInput.remove();
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
