export const VERSION = "62"; // bump on every change; shown at the bottom of Archive
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
    putDay: d => run("days", "readwrite", t => t.objectStore("days").put(d)),
    delDay: k => run("days", "readwrite", t => t.objectStore("days").delete(k)),
    allOf: name => run(name, "readonly", t => t.objectStore(name).getAll()),
    getPhoto: id => run("photos", "readonly", t => t.objectStore("photos").get(id)).then(p => p || null),
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
      s.get(id).onsuccess = e => { const p = e.target.result; if (p) { p.caption = caption; p.updated = Date.now(); s.put(p); } };
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
const LAYER_ICONS = (() => {
  const sq = (y, on) => `<rect x="5" y="${y}" width="14" height="6" rx="1" ${on ? 'fill="currentColor"' : 'fill="none"'}/>`;
  const svg = inner => `<svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="1.5" fill="none">${inner}</svg>`;
  return {
    front: svg(`${sq(14, false)}${sq(9, false)}${sq(4, true)}`),
    up: svg(`${sq(14, false)}${sq(9, true)}<path d="M12 3.5v3M10.5 5l1.5-1.5L13.5 5" stroke-linecap="round"/>`),
    down: svg(`${sq(4, false)}${sq(9, true)}<path d="M12 17.5v3M10.5 19l1.5 1.5 1.5-1.5" stroke-linecap="round"/>`),
    back: svg(`${sq(4, false)}${sq(9, false)}${sq(14, true)}`),
  };
})();
// simple line icons for the Decorate menus
const ICONS = (() => {
  const svg = inner => `<svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return {
    add: svg(`<path d="M12 5v14M5 12h14"/>`),
    scraps: svg(`<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="1.5 2"/>`),
    page: svg(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>`),
    style: svg(`<path d="M5 19l5-14 5 14M7 14h6"/><path d="M19 12v7"/><circle cx="17.5" cy="16.5" r="2.5"/>`),
    color: svg(`<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor"/>`),
    marker: svg(`<path d="M14 4l6 6-8 8H8v-4z"/><path d="M4 21h9" stroke-width="3" opacity=".45"/>`),
    frame: svg(`<rect x="4" y="4" width="16" height="16" rx="1"/><rect x="7" y="7" width="10" height="10"/>`),
    look: svg(`<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>`),
    text: svg(`<path d="M5 6V4h14v2M12 4v16M9 20h6"/>`),
    photo: svg(`<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>`),
    paste: svg(`<rect x="5" y="5" width="14" height="16" rx="1"/><path d="M9 5V3h6v2M9 11h6M9 15h4"/>`),
    commons: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17"/>`),
    tidy: svg(`<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>`),
    outline: svg(`<path d="M12 4c4 0 7 3 7 7 0 5-4 9-7 9s-7-4-7-9c0-4 3-7 7-7z" stroke-dasharray="2 2.2"/>`),
    ticket: svg(`<path d="M3 8h18v2.5a1.5 1.5 0 0 0 0 3V16H3v-2.5a1.5 1.5 0 0 0 0-3z"/><path d="M15 8v8" stroke-dasharray="1.5 2"/>`),
    receipt: svg(`<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z"/><path d="M9 8h6M9 11h6M9 14h4"/>`),
    note: svg(`<path d="M5 5h14v9l-5 5H5z"/><path d="M14 19v-5h5"/>`),
    label: svg(`<path d="M3 8h13l5 4-5 4H3z"/>`),
    clip: svg(`<path d="M16 7v9a4 4 0 0 1-8 0V6a2.5 2.5 0 0 1 5 0v9a1 1 0 0 1-2 0V8"/>`),
    print: svg(`<rect x="4" y="5" width="16" height="14"/><rect x="6.5" y="7.5" width="11" height="9"/>`),
    instant: svg(`<rect x="5" y="3" width="14" height="18"/><rect x="7" y="5" width="10" height="10"/>`),
    film: svg(`<rect x="3" y="5" width="18" height="14"/><rect x="7" y="8" width="10" height="8"/><path d="M5 7.5v.01M5 11v.01M5 14.5v.01M19 7.5v.01M19 11v.01M19 14.5v.01" stroke-width="2"/>`),
    torn: svg(`<path d="M4 4h16v13l-2 1-2-2-2 2-2-1-2 2-2-2-2 2-2-1z"/>`),
    none: svg(`<circle cx="12" cy="12" r="7.5"/>`),
    grain: svg(`<circle cx="12" cy="12" r="7.5"/><path d="M9 9v.01M13 8v.01M15 12v.01M10 13v.01M12 16v.01M8 15.5v.01M16 15v.01M12 11v.01" stroke-width="2"/>`),
    warm: svg(`<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15" fill="currentColor" opacity=".35" stroke="none"/><path d="M12 4.5a7.5 7.5 0 0 0 0 15" fill="currentColor" opacity=".12" stroke="none"/>`),
    bw: svg(`<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 0 0 15z" fill="currentColor"/>`),
  };
})();
const UNDO_ICON = `<span class="glyph" aria-hidden="true">←</span>`;
const REDO_ICON = `<span class="glyph" aria-hidden="true">→</span>`;
// letters cut from magazines: one picture per letter in /cutout; anything else becomes a little paper scrap
const CUT_TILT = [-4, 3, -2, 5, -3, 2, -5, 4];
const cutHTML = text => { let i = 0; return String(text).split(/(\n| )/).map(part => {
  if (part === "\n") return "<br>";
  if (part === " ") { i++; return '<span class="cut-sp"> </span>'; }
  return `<span class="cutword">${[...part].map(ch => cutChar(ch, i++)).join("")}</span>`; // a word never breaks across lines
}).join(""); };
const cutChar = (ch, i) => {
  const c = ch.toLowerCase(), r = CUT_TILT[i % CUT_TILT.length], y = ((i * 37) % 7 - 3) * .02;
  if (c >= "a" && c <= "z") return `<img class="cut" src="cutout/${c}.webp" alt="${esc(ch)}" draggable="false" style="--r:${r}deg;--y:${y}em">`;
  return `<span class="cut cut-scrap" style="--r:${r}deg;--y:${y}em">${esc(ch)}</span>`;
};
// paper scraps for Decorate: [type, label]
const SCRAPS = [["ticket", "Ticket"], ["receipt", "Receipt"], ["note", "Note"], ["label", "Label"], ["clip", "Clip"]];
const SCRAP_SIZE = { ticket: .36, receipt: .24, stamp: .17, note: .32, label: .3, clip: .07 };
const SCRAP_HINT = { ticket: "ADMIT ONE", receipt: "write here", stamp: "", note: "write here", label: "label" };
const CLIP_SVG = `<svg viewBox="0 0 20 60" aria-hidden="true" fill="none" stroke="#8E918A" stroke-width="2.2" stroke-linecap="round"><path d="M14 18v26a5 5 0 0 1-10 0V10a6.5 6.5 0 0 1 13 0v34"/><path d="M7.5 16v26a2.5 2.5 0 0 0 5 0V18" opacity=".9"/></svg>`;
// papers for the day: [key, label]; dark ones get light writing
const PAPERS = [["card", "Card"], ["cream", "Cream"], ["kraft", "Kraft"], ["blush", "Blush"], ["sage", "Sage"], ["grid", "Grid"], ["dots", "Dots"], ["lined", "Lined"], ["album", "Album"], ["navy", "Navy"]];
const DARK_PAPERS = new Set(["album", "navy"]);
const paperClass = p => `pagewrap paper-${p}${DARK_PAPERS.has(p) ? " dark" : ""}`;
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
const pickFont = list => list[0]; // fixed pair: Caveat + Nanum Pen Script
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
const lookNow = () => "loose"; // one page look for everyone (the Neat/Loose switch was removed)
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
const CARD = "#EAE3D3", DARK = "#1A1A17";

// =====================================================================
export async function mount(root, state) {
  const db = await openDB();
  const raw = makeStore(db);
  const C = await import(`./cloud.js?v=${VERSION}`);
  let cloud = null, cloudStatus = null, cloudConfigured = false;
  const mark = (col, id) => cloud?.changed(col, id);
  // every change made in the app is also queued for the cloud
  const store = {
    ...raw,
    patchDay: (k, patch) => raw.patchDay(k, patch).then(() => mark("days", k)),
    putPhoto: p => { p.updated = Date.now(); return raw.putPhoto(p).then(() => mark("photos", p.id)); },
    setCaption: (id, c) => raw.setCaption(id, c).then(() => mark("photos", id)),
    delPhoto: id => raw.delPhoto(id).then(() => mark("photos", id)),
    putAsset: a => { a.updated = Date.now(); return raw.putAsset(a).then(() => mark("stickers", a.id)); },
    delAsset: id => raw.delAsset(id).then(() => mark("stickers", id)),
    setMeta: (k, v) => raw.setMeta(k, v),
  };
  // the cloud module talks to the browser copy through this (and never marks its own writes)
  const local = {
    get: async (col, id) => col === "days" ? (await raw.getDay(id)).updated ? raw.getDay(id) : null
      : col === "photos" ? raw.getPhoto(id)
      : col === "stickers" ? (await raw.getAssets([id]))[id] || null
      : null,
    put: async (col, r) => col === "days" ? raw.putDay(r) : col === "photos" ? raw.putPhoto(r) : col === "stickers" ? raw.putAsset(r)
      : null,
    del: async (col, id) => col === "days" ? raw.delDay(id) : col === "photos" ? raw.delPhoto(id) : col === "stickers" ? raw.delAsset(id) : col === "meta" ? raw.setMeta(id, null) : null,
    all: async col => col === "days" ? raw.allOf("days") : col === "photos" ? raw.allOf("photos") : col === "stickers" ? raw.allOf("assets")
      : [],
  };
  const handOn = () => false; // drawing your own handwriting was removed
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
    const oldH = root.offsetHeight;
    root.style.minHeight = oldH + "px"; // hold the page height so nothing jumps while swapping
    const flip = state.navDir;
    const r = route();
    if (r.page === "archive") await renderArchive(); else await renderDay(r.date);
    if (state.viewer && r.page === "day") openViewer(state.viewer, false);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (flip && !reduce && r.page === "day") {
      root.style.minHeight = Math.max(oldH, root.scrollHeight) + "px";
      root.querySelectorAll(".dayhead, .pagewrap").forEach(el => el.classList.add(`slide-${flip}`));
      if (scrollY > 0) window.scrollTo({ top: 0, behavior: "smooth" }); // glide up while it slides, so the release can't jump
      const release = () => { if (scrollY > 2) return setTimeout(release, 60); root.style.minHeight = ""; old.forEach(URL.revokeObjectURL); };
      setTimeout(release, 380);
    } else requestAnimationFrame(() => { root.style.minHeight = ""; old.forEach(URL.revokeObjectURL); });
  }

  // ---------- day page: one board. Grid by default; Decorate to move things freely ----------
  let pendingRemote = false;
  function accountHTML() {
    if (!cloudConfigured) return `<p>Cloud account isn’t connected yet.</p>`;
    const st = cloudStatus;
    if (!st || !st.user) return `<p>Sign in to keep your diary in your own account, on every device.</p><div class="row"><button class="chip" data-signin>Sign in with Google</button></div>`;
    const t = st.last ? new Date(st.last).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    const line = st.state === "syncing" ? "Syncing…" : st.state === "offline" ? "Offline. Changes sync when you’re back online."
      : st.state === "error" ? `Sync stopped (${esc(st.error || "error")}). Tap Sync now to try again.` : t ? `Synced at ${t}.` : "";
    return `<p>Signed in as ${esc(st.user.email || st.user.name || "you")}. ${line}</p><div class="row"><button class="link" data-syncnow>Sync now</button><button class="link" data-signout>Sign out</button></div>`;
  }
  function backupLine() {
    if (cloudStatus?.user) return "";
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
      : `<span class="soft">${WEEKDAYS[d.getDay()]},</span> <span class="nw">${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}</span>`;

    root.innerHTML = `
      <div class="wrap${editing ? " decorating" : ""}">
        <header class="top"><div class="barin">
          <a class="wordmark bigmark" href="#/">Diary</a>
          <a class="navtag" href="#/archive">Archive</a>
        </div></header>
        <div class="dayhead">
          <div class="daterow">
            <h1 class="page-title day-title big-date">${title}</h1>
          </div>
          ${editing ? `<div class="daysub"><span class="hint typed">Drag to move. Corner handle turns and resizes.</span></div>` : ""}
        </div>
        <div class="${paperClass(paper)}" id="pagewrap">
        <div class="board${editing ? " editing" : ""}" id="board"></div>
        <div class="slip">
          <span class="tape" aria-hidden="true"></span>
          <label class="sr" for="note">About the day</label>
          <textarea class="note" id="note" rows="3" placeholder="how was today?">${esc(day.note || "")}</textarea>
        </div>
        </div>
        ${editing ? "" : backupLine()}
      </div>
      ${editing ? "" : `<nav class="botbar" aria-label="Day">
        <div class="barin">
          <a class="daynav" href="${hrefOf(prevK)}" data-nav="prev" aria-label="Previous day">‹</a>
          <button class="barbtn" data-decorate>Decorate</button>
          <button class="barbtn" data-saveimg>Save image</button>
          ${isToday ? `<span class="daynav off" aria-hidden="true">›</span>` : `<a class="daynav" href="${hrefOf(nextK)}" data-nav="next" aria-label="Next day">›</a>`}
        </div>
      </nav>`}
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
    const cols = 3, gap = bw < 560 ? .04 : .035; // three photos per row on every screen
    const capH = 92 / bw;
    if (lookNow() !== "loose") {
      const w = (1 - gap * (cols - 1) - .02) / cols;
      const rowH = w * 1.34 + capH;
      return n => ({ x: .01 + (n % cols) * (w + gap), y: .035 + Math.floor(n / cols) * rowH, w, rot: TILTS[n % 4], row: Math.floor(n / cols), drop: 0 });
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
      return { x: R.xs[c], y: R.top + R.drops[c], w: R.ws[c], rot: (rnd(n, 5) - .5) * 6.5, row: Math.floor(n / cols), drop: R.drops[c] };
    };
  }
  const rowOf = new Map(); // auto-placed photo -> [row, drop], for spacing rows by their real height
  function layoutAuto() {
    rowOf.clear();
    // every photo has the spot Tidy up would give it (by the order it was added);
    // photos you placed stay where they are, new ones go straight to their Tidy up spot
    const slot = grid();
    const order = dayPhotos.map(p => p.id);
    col.items.filter(i => i.kind === "photo").forEach(i => {
      const sl = slot(Math.max(0, order.indexOf(i.ref)));
      if (i.auto) Object.assign(i, sl);
      rowOf.set(i.id, [sl.row, sl.drop]);
    });
    const add = slot(order.length);
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
        ? `<div class="frame">${img}</div><div class="cap">${time}<p class="ccap${p.caption ? "" : " empty"}">${esc(p.caption || "write about this one")}</p></div>`
        : `<button class="frame" data-open="${p.id}" aria-label="Open photo">${img}</button>
           <div class="cap">${time}<label class="sr" for="cap-${p.id}">Note for this photo</label><textarea class="caption" id="cap-${p.id}" data-cap="${p.id}" rows="1" placeholder="write about this one">${esc(p.caption)}</textarea></div>`);
    } else if (i.kind === "text") {
      const cls = ["ctext", `f-${i.font || "hand"}`, i.hl ? "hl" : "", i.tape ? "taped" : ""].join(" ");
      inner = `<div class="ctextbox" style="font-size:calc(var(--bw) * ${i.fs})"><span class="${cls}" style="${textStyle(i)}" spellcheck="false">${i.font === "cut" ? cutHTML(i.text) : esc(i.text)}</span></div>`;
    } else if (i.kind === "scrap") {
      inner = i.type === "clip" ? `<span class="scrap sc-clip">${CLIP_SVG}</span>`
        : `<div class="scrap sc-${i.type}"><span class="sctext" spellcheck="false" data-hint="${esc(SCRAP_HINT[i.type] || "")}">${esc(i.text || "")}</span></div>`;
    } else if (i.kind === "tape") {
      inner = `<span class="ctape"></span>`;
    } else if (i.kind === "image") {
      const a = assets[i.ref]; if (!a) return "";
      inner = `<img class="cimg" src="${url(a.blob)}" alt="" draggable="false">`;
    } else return "";
    const handles = editing ? `<span class="h-rot" data-h="t" title="Turn and resize">${ROTATE_ICON}</span>${i.kind !== "photo" ? `<button class="h-del" data-h="d" aria-label="Remove">×</button>` : ""}` : "";
    const extra = (i.kind === "image" && i.outline ? " outline" : "") + (i.kind === "photo" ? ` fr-${i.frame || "print"} lk-${i.look || "none"}` : "");
    const seed = [...i.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const vars = i.kind === "photo" ? `;--w:${i.w};--lift:${(.6 + rnd(seed, 6) * .9).toFixed(2)};--tape-x:${(35 + rnd(seed, 7) * 30).toFixed(0)}%;--tape-r:${((rnd(seed, 8) - .5) * 14).toFixed(1)}deg` : "";
    const rd = rowOf.has(i.id) ? ` data-vrow="${rowOf.get(i.id)[0]}" data-drop="${rowOf.get(i.id)[1]}"${i.auto ? ` data-row="${rowOf.get(i.id)[0]}"` : ""}` : "";
    return `<div class="ci ci-${i.kind}${extra}${i.id === selectedId ? " sel" : ""}" data-id="${i.id}"${rd} style="${pos(i)}${vars}">${inner}${handles}</div>`;
  }

  function drawBoard() {
    const addSlot = layoutAuto();
    const add = state.decorating ? "" : `
      <div class="ci ci-add" data-row="${addSlot.row}" data-vrow="${addSlot.row}" data-drop="${addSlot.drop}" style="${pos({ ...addSlot, rot: 0, z: 0 })}">
        <button class="add-tile" data-camera>${CAMERA}<span>${touch() ? "Take a photo" : "Add photos"}</span></button>
        <span class="add-more">${touch() ? `<button class="link small" data-library>library</button><span class="dot">·</span>` : ""}<button class="link small" data-pastephoto>paste</button></span>
      </div>`;
    boardEl.innerHTML = col.items.map(itemHTML).join("") + add;
    boardEl.querySelectorAll(".caption").forEach(grow);
    spaceRows();
    // heights can change once photos and fonts finish loading (slow on phones): lay out again then
    const again = () => { if (!boardEl || drag) return; boardEl.querySelectorAll(".caption").forEach(grow); spaceRows(); };
    boardEl.querySelectorAll("img").forEach(img => { if (!img.complete) img.addEventListener("load", again, { once: true }); });
    document.fonts?.ready.then(again);
    setTimeout(again, 400);
  }
  // rows sit right under the tallest thing in the row above (photo + its note), not at a fixed guess
  function spaceRows() {
    if (!boardEl) return;
    const bw = boardEl.clientWidth || 1, loose = lookNow() === "loose";
    const gap = loose ? 2 : 10, els = [...boardEl.querySelectorAll(".ci[data-row]")];
    const tall = [];
    // row heights come from every photo in its Tidy up row, placed or not, so rows match what Tidy up makes
    boardEl.querySelectorAll(".ci[data-vrow]").forEach(el => { const r = +el.dataset.vrow; tall[r] = Math.max(tall[r] || 0, el.offsetHeight + (+el.dataset.drop || 0) * bw); });
    const top = []; let y = .035 * bw;
    for (let r = 0; r < tall.length; r++) { top[r] = y; y += (tall[r] || 0) + gap; }
    els.forEach(el => {
      const yy = (top[+el.dataset.row] + (+el.dataset.drop || 0) * bw) / bw;
      el.style.top = `calc(var(--bw) * ${yy})`;
      const it = col.items.find(i => i.id === el.dataset.id); if (it) it.y = yy;
    });
    // the add button goes to the next free spot: if a moved photo covers its slot, it drops below everything
    const add = boardEl.querySelector(".ci-add");
    if (add) {
      const a = add.getBoundingClientRect();
      const hit = [...boardEl.querySelectorAll(".ci:not(.ci-add)")].some(el => {
        const b = el.getBoundingClientRect();
        return a.left < b.right - 8 && a.right > b.left + 8 && a.top < b.bottom - 8 && a.bottom > b.top + 8;
      });
      if (hit) {
        // try right after the last photo; if that's taken or off the page, go below everything
        const boxes = [...boardEl.querySelectorAll(".ci:not(.ci-add)")].map(el => ({ l: el.offsetLeft, t: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight }));
        const w = add.offsetWidth, h = add.offsetHeight;
        const free = (l, t) => l + w <= bw + 4 && !boxes.some(o => l < o.r - 8 && l + w > o.l + 8 && t < o.b - 8 && t + h > o.t + 8);
        const lastEl = boardEl.querySelector(`.ci-photo[data-id="${col.items.filter(i => i.kind === "photo").sort((x, y) => dayPhotos.findIndex(p => p.id === x.ref) - dayPhotos.findIndex(p => p.id === y.ref)).pop()?.id}"]`);
        let spot = null;
        if (lastEl) { const l = lastEl.offsetLeft + lastEl.offsetWidth + gap, t = lastEl.offsetTop; if (free(l, t)) spot = [l, t]; }
        if (!spot) spot = [.01 * bw, Math.max(0, ...boxes.map(o => o.b)) + gap + 14];
        add.style.left = `${spot[0]}px`; add.style.top = `${spot[1]}px`;
      }
    }
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
    if (items.some(i => i.kind !== "photo") && items.some(i => i.kind === "photo" && i.auto && i.x != null)) items.forEach(i => { if (i.kind === "photo" && i.x != null) delete i.auto; });
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
      boardEl.addEventListener("pointercancel", onCancel);
      boardEl.addEventListener("click", () => { const d = editOnClick; editOnClick = null; if (d && d.el.isConnected) startTextEdit(d.el, d.it); });
      boardEl.addEventListener("touchmove", e => { if (drag) e.preventDefault(); }, { passive: false }); // once a drag starts, the page stops scrolling
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
  function refreshUndo() {
    const u = root.querySelector('[data-deco="undo"]'), r = root.querySelector('[data-deco="redo"]');
    if (u) u.disabled = !undoStack.length; if (r) r.disabled = !redoStack.length;
  }
  function saveCollage(now = false) {
    refreshUndo();
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
  // ---------- undo / redo / cancel ----------
  // each change in Decorate first saves a copy of the page, so it can be stepped back
  let undoStack = [], redoStack = [];
  const snapNow = () => ({ items: structuredClone(col.items), paper: paperNow });
  function checkpoint() {
    if (!col) return;
    undoStack.push(snapNow()); if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }
  async function restoreSnap(sn) {
    col.items = structuredClone(sn.items);
    if (sn.paper !== paperNow) await setPaper(sn.paper, false);
    selectedId = null; drawBoard(); renderDecoBar(); saveCollage();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapNow()); restoreSnap(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapNow()); restoreSnap(redoStack.pop()); }
  // stickers are only deleted for good when you leave Decorate, so Undo can bring them back
  async function cleanAssets(keepItems) {
    const used = new Set(keepItems.filter(i => i.kind === "image").map(i => i.ref));
    for (const id of state.decoAssets || []) if (!used.has(id)) { await store.delAsset(id); delete assets[id]; }
    state.decoAssets = [];
  }

  async function removeItem(id) {
    checkpoint();
    const it = col.items.find(i => i.id === id);
    col.items = col.items.filter(i => i.id !== id);
    itemEl(id)?.remove();
    if (it?.kind === "image") (state.decoAssets ||= []).push(it.ref);
    select(null); fitBoard(); saveCollage();
  }
  const step5 = () => col.items.filter(i => i.kind !== "photo").length % 5; // new items step aside so they don't stack
  function dropY() {
    const bw = boardEl.clientWidth, top = boardEl.getBoundingClientRect().top;
    return clamp((innerHeight * .35 - top) / bw, .03, Math.max(.03, boardEl.clientHeight / bw - .2)) + step5() * .045;
  }
  function addScrap(type) {
    checkpoint();
    const it = { id: newId(), kind: "scrap", type, text: type === "ticket" ? "ADMIT ONE" : "", x: .3 + step5() * .05, y: dropY(), w: SCRAP_SIZE[type], rot: Math.round(Math.random() * 10 - 5), z: topZ() + 1 };
    col.items.push(it);
    boardEl.insertAdjacentHTML("beforeend", itemHTML(it));
    select(it.id); fitBoard(); saveCollage();
    if (type !== "clip") startTextEdit(itemEl(it.id), it);
  }
  function addItem(kind) {
    checkpoint();
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
      checkpoint();
      (state.decoAssets ||= []).push(id);
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
  // paste a copied image as a regular photo of the day
  async function pastePhoto() {
    let blobs = [];
    try {
      if (navigator.clipboard?.read) {
        for (const ci of await navigator.clipboard.read()) {
          const type = ci.types.find(t => t.startsWith("image/"));
          if (type) blobs.push(await ci.getType(type));
        }
      }
    } catch {}
    if (blobs.length) { addFiles(blobs.map((b, i) => new File([b], `pasted-${i}.png`, { type: b.type }))); return; }
    openPasteBox(); // the browser wouldn't hand over the clipboard: let the person paste by hand
  }
  function openPasteBox() {
    document.querySelector(".pastebox")?.remove();
    const box = document.createElement("div");
    box.className = "pastebox"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
    box.innerHTML = `<div class="pastebox-card">
      <p class="typed">${touch() ? "Touch and hold inside the box, then tap Paste." : "Press ⌘V (Ctrl+V) to paste."}</p>
      <div class="pastearea" contenteditable="true" aria-label="Paste a photo here"></div>
      <button class="link" data-pasteclose>Cancel</button></div>`;
    document.body.append(box);
    const area = box.querySelector(".pastearea");
    area.focus();
    area.addEventListener("paste", e => {
      const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
      e.preventDefault();
      if (!files.length) { box.querySelector("p").textContent = "That isn’t an image. Copy a photo first, then paste here."; return; }
      box.remove(); addFiles(files);
    });
    box.addEventListener("click", e => { if (e.target === box || e.target.closest("[data-pasteclose]")) box.remove(); });
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
    if (it.text) checkpoint(); // new text boxes already saved a step when added
    const t = el.querySelector(".ctext, .sctext"); if (!t) return;
    if (it.font === "cut") t.textContent = it.text; // type plain letters, they turn into cut-outs when you leave
    t.contentEditable = "true"; t.focus();
    const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    t.oninput = () => { it.text = t.innerText.replace(/\n$/, ""); fitBoard(); saveCollage(); };
    t.onblur = () => {
      t.contentEditable = "false";
      if (it.kind === "text" && !it.text.trim() && col.items.includes(it)) return removeItem(it.id);
      if (it.font === "cut") { t.innerHTML = cutHTML(it.text); fitBoard(); }
    };
  }

  // ---------- dragging ----------
  // On touch screens a finger that moves right away is scrolling, not picking.
  // A tap picks; holding still for a moment, then moving, drags.
  let held = null, editOnClick = null;
  function onDown(e) {
    if (e.pointerType === "touch" && !e.target.closest(".h-rot, .h-del") && e.target.closest(".ci:not(.ci-add)")
        && e.target.closest(".ci").dataset.id !== selectedId // a piece you already picked drags right away
        && !(e.target.closest(".ctext, .sctext")?.isContentEditable)) {
      clearTimeout(held?.timer);
      const fake = { target: e.target, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: "touch", preventDefault() {} };
      held = { fake, x: e.clientX, y: e.clientY, timer: setTimeout(() => { if (held?.fake === fake) { held = null; startDown(fake); } }, 260) };
      return;
    }
    startDown(e);
  }
  function onCancel(e) { if (held) { clearTimeout(held.timer); held = null; return; } onUp(e); }
  function startDown(e) {
    const el = e.target.closest(".ci");
    if (e.target.closest(".h-del")) { e.preventDefault(); removeItem(el.dataset.id); return; }
    if (!el || el.classList.contains("ci-add")) { if (document.activeElement?.isContentEditable) document.activeElement.blur(); select(null); return; }
    const t = el.querySelector(".ctext, .sctext");
    if (t && t.isContentEditable && e.target.closest(".ctext, .sctext")) return; // typing
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
    if (held) {
      if (Math.hypot(e.clientX - held.x, e.clientY - held.y) > 8) { clearTimeout(held.timer); held = null; } // it's a scroll
      return;
    }
    if (!drag) return;
    const { it, el } = drag;
    if (drag.mode === "m") {
      const dx = (e.clientX - drag.sx) / drag.bw, dy = (e.clientY - drag.sy) / drag.bw;
      if (Math.abs(dx) + Math.abs(dy) > .008) drag.moved = true;
      if (!drag.moved) return;
      if (!drag.cp) { drag.cp = true; checkpoint(); }
      it.x = clamp(drag.x0 + dx, -.15, .95); it.y = Math.max(-.05, drag.y0 + dy);
    } else {
      if (!drag.cp) { drag.cp = true; checkpoint(); }
      const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx), d = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
      it.rot = drag.rot0 + (a - drag.a0) * 180 / Math.PI;
      it.w = clamp(drag.w0 * d / drag.d0, .06, 1.1);
      if (drag.fs0) it.fs = drag.fs0 * it.w / drag.w0;
    }
    if (it.auto) delete it.auto; // the user placed it now
    applyPos(el, it);
  }
  function onUp() {
    if (held) { const f = held.fake; clearTimeout(held.timer); held = null; startDown(f); } // a quick tap still picks
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === "m" && !d.moved && d.wasSel && (d.it.kind === "text" || (d.it.kind === "scrap" && d.it.type !== "clip"))) editOnClick = d; // opened by the click that follows
    fitBoard(); saveCollage();
  }

  // ---------- decorate toolbar ----------
  let decoTab = null, decoKind = null;
  const tabMemory = {}; // the tab you last opened, per kind of piece
  function renderDecoBar() {
    const bar = root.querySelector(".decobar"); if (!bar) return;
    const it = col?.items.find(i => i.id === selectedId);
    const kind = it?.kind || "none";
    const tabsFor = { none: [["add", "Add"], ["scraps", "Scraps"], ["page", "Page"]], text: [["style", "Style"], ["color", "Color"], ["marker", "Marker"]], photo: [["frame", "Frame"], ["look", "Look"]], image: [], tape: [], scrap: [] }[kind];
    if (kind !== decoKind) { decoKind = kind; decoTab = kind in tabMemory ? tabMemory[kind] : (tabsFor[0]?.[0] || null); }
    const b = (attrs, label, pressed) => `<button ${attrs}${pressed != null ? ` aria-pressed="${!!pressed}"` : ""}>${label}</button>`;
    const ib = (attrs, icon, name, pressed) => b(`${attrs} class="ico" aria-label="${name}" title="${name}"`, ICONS[icon], pressed); // icon-only option
    const opt = {
      scraps: () => SCRAPS.map(([k, n]) => ib(`data-scrap="${k}"`, k, n)).join(""),
      add: () => `${ib('data-deco="text"', "text", "Text")}${ib('data-deco="photo"', "photo", "Photo")}${ib('data-deco="paste"', "paste", "Paste")}${ib('data-deco="commons"', "commons", "Wikimedia")}`,
      page: () => `${PAPERS.map(([f, n]) => b(`data-paper="${f}" class="paper-btn pb-${f}" aria-label="${n}" title="${n}"`, "", curPaper() === f)).join("")}<span class="group-sep"></span>
        ${ib('data-deco="tidy"', "tidy", "Tidy up")}`,
      style: () => `<span class="group">${[["hand", "Hand"], ["type", "Type"], ["press", "Press"], ["cut", "Cutout"]].map(([f, n]) => b(`data-tx="font" data-v="${f}" class="f-${f} fa" aria-label="${n}" title="${n}"`, "Aa", (it.font || "hand") === f)).join("")}</span>
        ${b('data-tx="tape" aria-label="Tape behind text"', `<span class="tape-swatch"></span>`, it.tape)}`,
      color: () => COLORS.map(c => b(`data-tx="color" data-v="${c}" class="dot" style="--c:${c}" aria-label="Color ${c}"`, "", (it.color || COLORS[0]) === c)).join(""),
      marker: () => b('data-tx="hl" data-v="" class="hl-none" aria-label="No highlighter"', "", !it.hl) + HILITES.map(c => b(`data-tx="hl" data-v="${c}" class="hl-dot" style="--c:${c}" aria-label="Highlighter ${c}"`, "", it.hl === c)).join(""),
      frame: () => [["print", "Print"], ["instant", "Instant"], ["film", "Film"], ["torn", "Torn"]].map(([f, n]) => ib(`data-ph="frame" data-v="${f}"`, f, n, (it.frame || "print") === f)).join(""),
      look: () => [["none", "Plain"], ["grain", "Grain"], ["warm", "Warm"], ["bw", "B&amp;W"]].map(([f, n]) => ib(`data-ph="look" data-v="${f}"`, f, n, (it.look || "none") === f)).join(""),
    };
    const actions = (it ? (it.kind === "image" ? ib('data-deco="outline"', "outline", "Outline", it.outline) : "") + `<span class="group" aria-label="Order">${[["front", "Front", LAYER_ICONS.front], ["up", "Forward", LAYER_ICONS.up], ["down", "Backward", LAYER_ICONS.down], ["back", "Back", LAYER_ICONS.back]].map(([k, n, ic]) => b(`data-layer="${k}" class="layer" aria-label="${n}" title="${n}"`, ic)).join("")}</span>` : "");
    const panel = (decoTab ? opt[decoTab]() : "") + (actions ? `<span class="group-sep"></span>${actions}` : "");
    // keep the option row where it was scrolled, as long as the same menu stays open
    const keyNow = `${kind}:${decoTab}`;
    const keep = bar.dataset.key === keyNow ? { p: bar.querySelector(".decoscroll")?.scrollLeft || 0, t: bar.querySelector(".decotabs")?.scrollLeft || 0 } : null;
    bar.dataset.key = keyNow;
    bar.innerHTML = `
      ${panel ? `<div class="decopanel"><div class="decoscroll">${panel}</div></div>` : ""}
      <div class="decorow">
        <div class="decotabs" role="tablist">${tabsFor.map(([k, n]) => `<button role="tab" class="dtab" data-dtab="${k}" aria-selected="${decoTab === k}" aria-label="${n}" title="${n}">${ICONS[k]}</button>`).join("") || `<span class="typed dt-note">${it?.kind === "image" ? "Photo sticker" : it?.kind === "tape" ? "Tape" : ""}</span>`}</div>
        <div class="deco-end">
          ${b(`data-deco="undo" class="icon" aria-label="Undo" title="Undo"${undoStack.length ? "" : " disabled"}`, UNDO_ICON)}
          ${b(`data-deco="redo" class="icon" aria-label="Redo" title="Redo"${redoStack.length ? "" : " disabled"}`, REDO_ICON)}
          ${b('class="cancel" data-deco="cancel"', "Cancel")}
          ${b('class="done" data-deco="done"', "Done")}
        </div>
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
      await cleanAssets(col.items);
      state.decorating = false; state.decoSnap = null; selectedId = null; undoStack = []; redoStack = []; render();
    }
    else if (a === "undo") undo();
    else if (a === "redo") redo();
    else if (a === "cancel") {
      const changedAny = undoStack.length || JSON.stringify(snapNow()) !== JSON.stringify(state.decoSnap);
      if (changedAny && !t.classList.contains("danger-armed")) {
        t.classList.add("danger-armed"); t.textContent = "Tap again to discard";
        setTimeout(() => { if (t.isConnected) { t.classList.remove("danger-armed"); t.textContent = "Cancel"; } }, 3000);
        return;
      }
      if (document.activeElement?.isContentEditable) document.activeElement.blur();
      clearTimeout(colTimer); // a pending save must not land after the discard
      const sn = state.decoSnap;
      if (sn) {
        col.items = structuredClone(sn.items);
        await store.patchDay(colKey, { collage: { items: col.items }, paper: sn.paper === "card" ? undefined : sn.paper });
        paperNow = sn.paper; changed();
      }
      await cleanAssets(col.items);
      state.decorating = false; state.decoSnap = null; selectedId = null; undoStack = []; redoStack = []; render();
    }
    else if (a === "text" || a === "tape") addItem(a);
    else if (a === "photo") { stickerInput.value = ""; stickerInput.click(); }
    else if (a === "paste") pasteFromClipboard();
    else if (a === "commons") openCommons();
    else if (a === "tidy") {
      checkpoint();
      col.items.forEach(i => { if (i.kind === "photo") i.auto = true; });
      drawBoard(); saveCollage();
    }
    else if (a === "outline" && it) { checkpoint(); it.outline = !it.outline; redrawItem(it); select(it.id); saveCollage(); }
  }
  function layerAction(how) {
    const it = col.items.find(i => i.id === selectedId); if (!it) return;
    checkpoint();
    const order = [...col.items].sort((a, b) => (a.z || 0) - (b.z || 0));
    const i = order.indexOf(it);
    order.splice(i, 1);
    const to = how === "front" ? order.length : how === "back" ? 0 : how === "up" ? Math.min(order.length, i + 1) : Math.max(0, i - 1);
    order.splice(to, 0, it);
    order.forEach((x, n) => { x.z = n + 1; const el = itemEl(x.id); if (el) el.style.zIndex = x.z; });
    saveCollage();
  }
  let paperNow = "card";
  const curPaper = () => paperNow;
  function photoAction(t) {
    const it = col.items.find(i => i.id === selectedId); if (!it) return;
    checkpoint();
    const before = itemEl(it.id), bw = boardEl.clientWidth;
    const oldH = before.offsetHeight, oldBottom = before.offsetTop + oldH, l = before.offsetLeft, r = l + before.offsetWidth;
    it[t.dataset.ph] = t.dataset.v;
    redrawItem(it); select(it.id);
    const delta = itemEl(it.id).offsetHeight - oldH;
    if (Math.abs(delta) > 1) {
      col.items.forEach(o => {
        if (o === it) return;
        const el = itemEl(o.id); if (!el) return;
        const ol = el.offsetLeft, or = ol + el.offsetWidth;
        if (el.offsetTop >= oldBottom - 12 && ol < r && or > l) { o.y += delta / bw; applyPos(el, o); }
      });
      fitBoard();
    }
    saveCollage();
  }
  async function setPaper(v, record = true) {
    if (record && v !== paperNow) checkpoint();
    paperNow = v;
    const pw = root.querySelector("#pagewrap"); if (pw) pw.className = paperClass(v);
    await store.patchDay(colKey, { paper: v === "card" ? undefined : v }); changed();
    renderDecoBar();
  }
  function textAction(t) {
    const it = col.items.find(i => i.id === selectedId); if (!it) return;
    checkpoint();
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

  // ---------- save the day as a picture ----------
  async function saveImage(btn) {
    const label = btn.textContent; btn.textContent = "Saving…"; btn.disabled = true;
    try {
      await flushText();
      const k = route().date, d = fromKey(k), isToday = k === todayKey();
      dayPhotos = await store.photosOn(k); // notes typed since the page was drawn
      const { renderDay } = await import(`./render.js?v=${VERSION}`);
      const cv = await renderDay({
        boardEl, items: col.items, photos: photoMap(), assets, note: root.querySelector("#note")?.value || "",
        titleSoft: isToday ? "Today," : `${WEEKDAYS[d.getDay()]},`,
        titleMain: `${d.getDate()} ${MONTHS[d.getMonth()]}${isToday || d.getFullYear() === new Date().getFullYear() ? "" : " " + d.getFullYear()}`,
        colors: COLORS, paper: curPaper(), seed: k,
      });
      const blob = await new Promise(r => cv.toBlob(r, "image/png"));
      const name = `diary-${k}.png`;
      showTornPage(new File([blob], name, { type: "image/png" }));
    } catch (err) {
      console.error(err); alert("The picture couldn’t be made. Try again.");
    } finally { btn.textContent = label; btn.disabled = false; }
  }

  // the page tears out of the album, then waits for Save (so the tap can open the share sheet)
  function showTornPage(file) {
    const url = URL.createObjectURL(file);
    const ov = document.createElement("div");
    ov.className = "tearbox";
    ov.innerHTML = `
      <div class="tear-album">
        <div class="tear-spine">${"<i></i>".repeat(12)}</div>
        <div class="tear-page"><img src="${url}" alt="Your day as an album page"></div>
      </div>
      <div class="tear-actions"><button class="link" data-tclose>Close</button><button class="tear-save" data-tsave>Save</button></div>`;
    document.body.append(ov);
    requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add("open")));
    setTimeout(() => ov.classList.add("torn"), 650);
    const close = () => { ov.classList.remove("open"); setTimeout(() => { ov.remove(); URL.revokeObjectURL(url); }, 300); };
    ov.addEventListener("click", async e => {
      if (e.target.closest("[data-tclose]") || e.target === ov) return close();
      if (!e.target.closest("[data-tsave]")) return;
      try {
        if (touch() && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] }); // choose "Save Image" to put it in Photos
        } else {
          const a = document.createElement("a");
          a.href = url; a.download = file.name;
          document.body.append(a); a.click(); a.remove();
        }
        close();
      } catch (err) { if (err?.name !== "AbortError") alert("The picture couldn’t be saved. Try again."); }
    });
  }

  // ---------- archive page ----------
  async function renderArchive() {
    const sum = await store.summary();
    const dates = Object.keys(sum).sort();
    const now = new Date(), tKey = todayKey();
    const first = dates.length ? fromKey(dates[0]) : now;
    const photoTotal = dates.reduce((n, k) => n + sum[k].count, 0);

    let months = "";
    // oldest month first, oldest day first
    for (let y = first.getFullYear(), m = first.getMonth(); y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth()); m++) {
      if (m > 11) { m = 0; y++; continue; }
      const prefix = `${y}-${pad(m + 1)}-`;
      const days = dates.filter(k => k.startsWith(prefix));
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
        <header class="top"><div class="barin">
          <a class="wordmark bigmark" href="#/">Diary</a>
          <a class="navtag" href="#/">Today</a>
        </div></header>
        <h1 class="page-title day-title big-date archive-title">Archive</h1>
        <p class="summary">${photoTotal ? `${photoTotal} photo${photoTotal > 1 ? "s" : ""} over ${dates.length} day${dates.length > 1 ? "s" : ""}` : "Nothing here yet."}</p>
        <div class="months">${months}</div>

        <section class="account keep" id="account">${accountHTML()}</section>
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
    const t = e.target.closest("[data-camera],[data-library],[data-open],[data-close],[data-step],[data-delete],[data-export],[data-import],[data-folder],[data-resume],[data-stopfolder],[data-importfolder],[data-font],[data-decorate],[data-deco],[data-tx],[data-sheet-close],[data-pick],[data-ph],[data-paper],[data-nav],[data-look],[data-dtab],[data-layer],[data-scrap],[data-pastephoto],[data-signin],[data-signout],[data-syncnow],[data-saveimg]");
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
    else if (has("data-decorate")) {
      await flushText();
      state.decoSnap = col ? { items: structuredClone(col.items), paper: paperNow } : null;
      state.decoAssets = [];
      undoStack = []; redoStack = [];
      // lock photos where they are now, so decorations line up the same on phone, iPad and computer
      if (col?.items.some(i => i.kind === "photo" && i.auto)) { col.items.forEach(i => { if (i.kind === "photo") delete i.auto; }); await saveCollage(true); }
      state.decorating = true; selectedId = null; render();
    }
    else if (t.dataset.deco) decoAction(t.dataset.deco, t);
    else if (t.dataset.tx) textAction(t);
    else if (t.dataset.ph) photoAction(t);
    else if (t.dataset.layer) layerAction(t.dataset.layer);
    else if (t.dataset.scrap) addScrap(t.dataset.scrap);
    else if (has("data-pastephoto")) pastePhoto();
    else if (has("data-signin")) { try { await cloud?.signIn(); } catch (err) { alert("Sign-in didn’t work. Check your connection and try again."); console.error(err); } }
    else if (has("data-signout")) { await cloud?.signOut(); }
    else if (has("data-syncnow")) cloud?.sync();
    else if (has("data-saveimg")) saveImage(t);
    else if (t.dataset.dtab) { decoTab = decoTab === t.dataset.dtab ? null : t.dataset.dtab; tabMemory[decoKind] = decoTab; renderDecoBar(); }
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
  // pasting an image on a day page adds it as a photo of the day (in Decorate: as a sticker)
  on(document, "paste", e => {
    if (route().page !== "day" || viewerEl || sheetEl || e.target.closest?.(".pastebox")) return;
    if (e.target.matches?.("textarea, input") || e.target.isContentEditable) return; // pasting text into a note
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    if (state.decorating) addImageBlob(files[0]); else addFiles(files);
  });
  on(stickerInput, "change", async () => { for (const f of [...stickerInput.files]) await addImageBlob(f); });
  on(document, "focusout", e => {
    if (pendingRemote) setTimeout(() => { if (pendingRemote && !document.activeElement?.matches?.("textarea, input, [contenteditable='true']") && !state.decorating) { pendingRemote = false; render(); } }, 300);
  });
  on(document, "input", e => {
    const t = e.target;
    if (t.matches?.(".caption")) { grow(t); spaceRows(); const id = t.dataset.cap, v = t.value; queueText(`cap:${id}`, () => store.setCaption(id, v)); }
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
    if (state.decorating && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !document.activeElement?.isContentEditable) {
      e.preventDefault(); e.shiftKey ? redo() : undo(); return;
    }
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

  try {
    const cfg = (await import(`./firebase-config.js?v=${VERSION}`)).default;
    cloudConfigured = !!cfg?.apiKey;
    if (cloudConfigured) {
      cloud = await C.startCloud(cfg, local, {
        onStatus: st => { cloudStatus = st; const a = root.querySelector("#account"); if (a) a.innerHTML = accountHTML(); },
        onRemoteChange: () => {
          const busy = state.decorating || document.activeElement?.matches?.("textarea, input, [contenteditable='true']") || sheetEl;
          if (busy) pendingRemote = true; else render();
        },
      });
    }
  } catch (e) { console.error("diary: cloud not started", e); }

  return async function unmount() {
    await flushText();
    if (col && colTimer) { clearTimeout(colTimer); await store.patchDay(colKey, { collage: { items: col.items } }); }
    closeCommons(); stickerInput.remove(); cloud?.stop();
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
