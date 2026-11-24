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
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- storage ----------
// v1: days {date, photo, thumb, note}
// v2: days {date, note, updated} + photos {id, date, blob, thumb, added}
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("diary", 2);
    r.onupgradeneeded = (e) => {
      const db = r.result, t = r.transaction;
      if (!db.objectStoreNames.contains("days")) db.createObjectStore("days", { keyPath: "date" });
      if (!db.objectStoreNames.contains("photos")) {
        const ps = db.createObjectStore("photos", { keyPath: "id" });
        ps.createIndex("date", "date");
      }
      if (e.oldVersion === 1) {
        const days = t.objectStore("days"), photos = t.objectStore("photos");
        days.openCursor().onsuccess = ev => {
          const c = ev.target.result; if (!c) return;
          const v = c.value;
          if (v.photo) {
            photos.put({ id: newId(), date: v.date, blob: v.photo, thumb: v.thumb, added: v.updated || Date.now() });
          }
          c.update({ date: v.date, note: v.note || "", updated: v.updated || Date.now() });
          c.continue();
        };
      }
    };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => db.close(); res(db); };
    r.onerror = () => rej(r.error);
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
    addPhoto: p => run("photos", "readwrite", t => t.objectStore("photos").put(p)),
    delPhoto: id => run("photos", "readwrite", t => t.objectStore("photos").delete(id)),
    // per-day summary for the archive: count + first thumb
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

// ---------- backup ----------
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const dataToBlob = async d => (await fetch(d)).blob();
const LAST_BACKUP = "diary.lastBackup";
const lastBackup = () => { try { return Number(localStorage.getItem(LAST_BACKUP)) || 0; } catch { return 0; } };

// =====================================================================
export async function mount(root, state) {
  const db = await openDB();
  const store = makeStore(db);
  const ctl = new AbortController();
  const on = (el, ev, fn, opts = {}) => el.addEventListener(ev, fn, { ...opts, signal: ctl.signal });

  if (navigator.storage?.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist());

  let urls = [];
  const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const revoke = () => { urls.forEach(URL.revokeObjectURL); urls = []; };

  let noteTimer = null, pendingNote = null;
  const flushNote = async () => {
    clearTimeout(noteTimer);
    if (pendingNote) { const p = pendingNote; pendingNote = null; await store.setNote(p.k, p.text); }
  };

  // hidden inputs live outside the rendered page
  const fileInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", multiple: true, className: "sr", tabIndex: -1 });
  const importInput = Object.assign(document.createElement("input"), { type: "file", accept: "application/json,.json", className: "sr", tabIndex: -1 });
  document.body.append(fileInput, importInput);

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
    await flushNote();
    revoke();
    const r = route();
    state.date = r.date;
    if (r.page === "archive") await renderArchive(); else await renderDay(r.date);
    if (state.viewer && r.page === "day") openViewer(state.viewer, false);
  }

  // ---------- day page ----------
  async function renderDay(k) {
    const d = fromKey(k), isToday = k === todayKey();
    const [photos, note] = await Promise.all([store.photosOn(k), store.getNote(k)]);
    dayPhotos = photos;
    const title = isToday
      ? `<span class="soft">Today,</span> ${d.getDate()} ${MONTHS[d.getMonth()]}`
      : `<span class="soft">${WEEKDAYS[d.getDay()]},</span> ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const tilts = ["-0.6deg", "0.5deg", "-0.2deg", "0.7deg", "-0.4deg"];

    const prints = photos.map((p, i) => `
      <figure class="print">
        <button class="frame" data-open="${p.id}" style="--tilt:${tilts[i % tilts.length]}" aria-label="Open photo ${i + 1}">
          <div class="photo"><img src="${url(p.blob)}" alt="" class="${developIds.has(p.id) ? "developing" : ""}"><div class="stamp">${stampSVG(k)}</div></div>
        </button>
        ${keyOf(new Date(p.added)) === k ? `<figcaption>${timeOf(p.added)}</figcaption>` : ""}
      </figure>`).join("");
    developIds = new Set();

    const add = `<button class="add-tile${photos.length ? " more" : ""}" data-add><span><span class="plus">+</span>${photos.length ? "Add more" : (isToday ? "Add today’s first photo" : "Add a photo")}</span></button>`;

    const count = await store.count();
    const lb = lastBackup();
    const nudge = count > 0 && (!lb || Date.now() - lb > 7 * 864e5)
      ? `<p class="nudge">${lb ? `Last backup was ${Math.floor((Date.now() - lb) / 864e5)} days ago.` : "You haven’t saved a backup yet."} <button class="link" data-export>Save backup</button></p>`
      : "";

    root.innerHTML = `
      <div class="wrap">
        <header class="top">
          <a class="wordmark" href="#/">diary</a>
          ${isToday ? `<a class="link" href="#/archive">Archive</a>` : `<a class="link" href="#/archive">Back to archive</a>`}
        </header>
        <h1 class="page-title">${title}</h1>
        <div class="roll">${prints}<div>${add}</div></div>
        <div class="note-wrap">
          <label class="sr" for="note">Note for this day</label>
          <textarea class="note" id="note" rows="2" placeholder="Write a line about this day…">${esc(note)}</textarea>
          <span class="saved" id="saved" aria-live="polite">Saved</span>
        </div>
        ${nudge}
      </div>`;

    const ta = root.querySelector("#note");
    const grow = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
    grow();
    on(ta, "input", () => {
      grow();
      pendingNote = { k, text: ta.value };
      clearTimeout(noteTimer);
      noteTimer = setTimeout(async () => {
        await flushNote();
        const s = root.querySelector("#saved");
        if (s) { s.classList.add("show"); setTimeout(() => s.classList.remove("show"), 1200); }
      }, 500);
    });
    window.scrollTo(0, state.scroll?.[location.hash] || 0);
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
        const href = k === tKey ? "#/" : `#/day/${k}`;
        cells += `<a class="${cls}" href="${href}" aria-label="${day} ${MONTHS[m]}${s ? `, ${s.count} photo${s.count > 1 ? "s" : ""}` : ""}">
          ${s?.thumb ? `<img src="${url(s.thumb)}" alt="">` : ""}<span class="n">${day}</span>${s && s.count > 1 ? `<span class="k">${s.count}</span>` : ""}</a>`;
      }
      months += `
        <section class="month">
          <h2>${MONTHS[m]} ${y}${n ? `<span class="count">${n} of ${daysIn} days</span>` : ""}</h2>
          <div class="weekdays" aria-hidden="true"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
          <div class="grid">${cells}</div>
        </section>`;
    }

    const lb = lastBackup();
    root.innerHTML = `
      <div class="wrap">
        <header class="top">
          <a class="wordmark" href="#/">diary</a>
          <a class="link" href="#/">Today</a>
        </header>
        <h1 class="page-title">Archive</h1>
        <p class="summary">${photoTotal ? `${photoTotal} photo${photoTotal > 1 ? "s" : ""} over ${dates.length} day${dates.length > 1 ? "s" : ""}` : "Your days will collect here."}</p>
        <div class="months">${months}</div>
        <div class="keep">
          <p>Your diary is saved in this browser and stays there when you close it. A backup file keeps a copy safe and moves the diary to another device.${lb ? ` Last backup: ${new Date(lb).toLocaleDateString()}.` : ""}</p>
          <div class="row">
            <button class="link" data-export>Save backup</button>
            <button class="link" data-import>Restore from backup</button>
          </div>
        </div>
      </div>`;
    window.scrollTo(0, state.scroll?.[location.hash] || 0);
  }

  // ---------- viewer ----------
  let viewerEl = null;
  function openViewer(id, push = true) {
    const i = dayPhotos.findIndex(p => p.id === id);
    if (i < 0) { closeViewer(); return; }
    state.viewer = id;
    const p = dayPhotos[i];
    if (!viewerEl) {
      viewerEl = document.createElement("div");
      viewerEl.className = "viewer"; viewerEl.setAttribute("role", "dialog"); viewerEl.setAttribute("aria-modal", "true");
      document.body.append(viewerEl);
    }
    viewerEl.innerHTML = `
      <div class="bar">
        <button class="link" data-close>Close</button>
        <button class="link" data-delete="${p.id}">Delete photo</button>
      </div>
      <div class="stage"><div class="photo"><img src="${url(p.blob)}" alt="Photo ${i + 1} of ${dayPhotos.length}"><div class="stamp">${stampSVG(p.date)}</div></div></div>
      <div class="pager">
        <button data-step="-1" aria-label="Previous photo" ${i === 0 ? "disabled" : ""}>‹</button>
        <span>${i + 1} of ${dayPhotos.length}</span>
        <button data-step="1" aria-label="Next photo" ${i === dayPhotos.length - 1 ? "disabled" : ""}>›</button>
      </div>`;
    if (push) viewerEl.querySelector("[data-close]").focus();
  }
  function closeViewer() {
    state.viewer = null;
    if (viewerEl) { viewerEl.remove(); viewerEl = null; }
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
        await store.addPhoto({ id, date: k, blob, thumb, added: Date.now() });
        developIds.add(id);
      } catch (err) {
        alert(`${err.message} Try a JPEG, PNG or HEIC photo.`);
      } finally { URL.revokeObjectURL(src); }
    }
    render();
  }

  async function exportBackup() {
    const { days, photos } = await store.dump();
    const out = { app: "diary", version: 2, days, photos: [] };
    for (const p of photos) out.photos.push({ id: p.id, date: p.date, added: p.added, blob: await blobToData(p.blob), thumb: await blobToData(p.thumb) });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
    a.download = `diary-backup-${todayKey()}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    try { localStorage.setItem(LAST_BACKUP, String(Date.now())); } catch {}
    render();
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "diary") throw new Error();
      let n = 0;
      if (data.version === 1) { // one photo per day, note on the day
        for (const r of data.days) {
          if (r.note) await store.setNote(r.date, r.note);
          if (r.photo) { await store.addPhoto({ id: `${r.date}-v1`, date: r.date, blob: await dataToBlob(r.photo), thumb: await dataToBlob(r.thumb), added: r.updated || Date.now() }); n++; }
        }
      } else {
        for (const d of data.days || []) if (d.note) await store.setNote(d.date, d.note);
        for (const p of data.photos || []) { // same id = same photo, so nothing doubles up
          await store.addPhoto({ id: p.id, date: p.date, added: p.added, blob: await dataToBlob(p.blob), thumb: await dataToBlob(p.thumb) });
          n++;
        }
      }
      alert(`Restored ${n} photo${n === 1 ? "" : "s"}.`);
      render();
    } catch {
      alert("This file isn’t a diary backup. Choose a file named diary-backup-….json.");
    }
  }

  // ---------- events (all removed on unmount) ----------
  on(document, "click", async e => {
    const t = e.target.closest("[data-add],[data-open],[data-close],[data-step],[data-delete],[data-export],[data-import]");
    if (!t) { if (viewerEl && e.target.classList?.contains("stage")) closeViewer(); return; }
    if (t.hasAttribute("data-add")) { fileInput.value = ""; fileInput.click(); }
    else if (t.dataset.open) openViewer(t.dataset.open);
    else if (t.hasAttribute("data-close")) closeViewer();
    else if (t.dataset.step) step(Number(t.dataset.step));
    else if (t.hasAttribute("data-export")) exportBackup();
    else if (t.hasAttribute("data-import")) { importInput.value = ""; importInput.click(); }
    else if (t.dataset.delete) {
      if (!t.classList.contains("danger-armed")) {
        t.classList.add("danger-armed"); t.textContent = "Tap again to delete";
        setTimeout(() => { if (t.isConnected) { t.classList.remove("danger-armed"); t.textContent = "Delete photo"; } }, 3000);
        return;
      }
      const i = dayPhotos.findIndex(p => p.id === t.dataset.delete);
      await store.delPhoto(t.dataset.delete);
      const next = dayPhotos[i + 1] || dayPhotos[i - 1];
      state.viewer = next && next.id !== t.dataset.delete ? next.id : null;
      if (!state.viewer) closeViewer();
      render();
    }
  });
  on(fileInput, "change", () => fileInput.files.length && addFiles([...fileInput.files]));
  on(importInput, "change", () => importInput.files[0] && importBackup(importInput.files[0]));
  on(window, "hashchange", () => { closeViewer(); render(); });
  on(window, "scroll", () => { (state.scroll ||= {})[location.hash] = window.scrollY; }, { passive: true });
  on(document, "keydown", e => {
    if (!viewerEl) return;
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
  // date rolls over while open
  let lastToday = todayKey();
  on(document, "visibilitychange", () => {
    if (document.visibilityState === "visible" && todayKey() !== lastToday) { lastToday = todayKey(); render(); }
  });

  await render();

  return async function unmount() {
    await flushNote();
    ctl.abort();
    revoke();
    if (viewerEl) { viewerEl.remove(); viewerEl = null; }
    fileInput.remove(); importInput.remove();
    db.close();
  };
}
