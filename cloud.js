// Cloud sync with Firebase: sign in with Google, keep the diary in your own account.
// The diary still lives in the browser first (works offline); changes are queued and sent when online.
// Firestore layout: users/{uid}/{days|photos|stickers|meta}/{id}, every doc has `updated` (ms) and
// deleted things leave a small { deleted: true } marker so other devices remove them too.

const FB = "./vendor/firebase.js";
const COLS = ["days", "photos", "stickers", "meta"];
const DIRTY = "diary.dirty", PULLED = "diary.pulled";
const MAX_DOC = 900 * 1024; // Firestore allows 1 MiB per document

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const dataToBlob = async d => (await fetch(d)).blob();

async function shrinkToFit(blob, maxBytes, keepAlpha) {
  let data = await blobToData(blob);
  if (data.length <= maxBytes) return data;
  const src = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    let w = img.naturalWidth, h = img.naturalHeight, q = .85;
    for (let tries = 0; tries < 8 && data.length > maxBytes; tries++) {
      w = Math.round(w * .8); h = Math.round(h * .8); q = Math.max(.6, q - .05);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      data = c.toDataURL(keepAlpha ? "image/png" : "image/jpeg", q);
    }
    return data;
  } finally { URL.revokeObjectURL(src); }
}

// local store adapter is passed in from app.js:
// local.get(col, id), local.put(col, record), local.del(col, id), local.all(col)
export async function startCloud(config, local, hooks) {
  const fb = await import(FB);
  const app = (window.__diaryFirebase ||= fb.initializeApp(config)); // live code swaps reuse the same app
  const auth = fb.getAuth(app);
  await fb.setPersistence(auth, fb.browserLocalPersistence).catch(() => {});
  const db = fb.getFirestore(app);
  let user = null, timer = null, busy = false, again = false, stopped = false;
  const status = { state: "signed-out", last: lsGet("diary.lastSync", 0), error: null };
  const emit = () => hooks.onStatus?.({ ...status, user: user && { name: user.displayName, email: user.email, photo: user.photoURL } });

  const ref = (col, id) => fb.doc(db, "users", user.uid, col, id);

  // ---- to the cloud ----
  async function toRemote(col, rec) {
    const base = { updated: rec.updated || Date.now() };
    if (col === "days") return { ...base, date: rec.date, note: rec.note || "", paper: rec.paper || null, collage: rec.collage ? JSON.stringify(rec.collage) : null };
    if (col === "photos") return { ...base, date: rec.date, added: rec.added, caption: rec.caption || "", img: await shrinkToFit(rec.blob, MAX_DOC - 60000, false), thumb: await blobToData(rec.thumb) };
    if (col === "stickers") return { ...base, img: await shrinkToFit(rec.blob, MAX_DOC - 20000, rec.blob.type === "image/png"), source: rec.source || null };
    if (col === "meta") return { ...base, value: JSON.stringify(rec.value) };
  }
  async function fromRemote(col, id, d) {
    if (col === "days") return { date: id, note: d.note || "", paper: d.paper || undefined, collage: d.collage ? JSON.parse(d.collage) : undefined, updated: d.updated };
    if (col === "photos") return { id, date: d.date, added: d.added, caption: d.caption || "", updated: d.updated, blob: await dataToBlob(d.img), thumb: await dataToBlob(d.thumb) };
    if (col === "stickers") return { id, blob: await dataToBlob(d.img), source: d.source || null, added: d.updated, updated: d.updated };
    if (col === "meta") return { id, value: JSON.parse(d.value || "null"), updated: d.updated };
  }

  async function push() {
    const dirty = lsGet(DIRTY, {});
    for (const key of Object.keys(dirty)) {
      if (stopped || !user) return;
      const [col, ...rest] = key.split("/"); const id = rest.join("/");
      const rec = await local.get(col, id);
      const data = rec ? await toRemote(col, rec) : { deleted: true, updated: dirty[key] || Date.now() };
      await fb.setDoc(ref(col, id), data);
      const now = lsGet(DIRTY, {}); if (now[key] === dirty[key]) { delete now[key]; lsSet(DIRTY, now); }
    }
  }

  // ---- from the cloud ----
  async function pull() {
    const pulled = lsGet(PULLED, {})[user.uid] || {};
    let changed = false;
    for (const col of COLS) {
      const q = fb.query(fb.collection(db, "users", user.uid, col), fb.where("updated", ">", pulled[col] || 0));
      const snap = await fb.getDocs(q);
      for (const docSnap of snap.docs) {
        const d = docSnap.data(), id = docSnap.id;
        pulled[col] = Math.max(pulled[col] || 0, d.updated || 0);
        if (lsGet(DIRTY, {})[`${col}/${id}`]) continue; // a newer local change is waiting to go up
        const mine = await local.get(col, id);
        if (mine && (mine.updated || 0) >= (d.updated || 0)) continue;
        if (d.deleted) { if (mine) { await local.del(col, id); changed = true; } }
        else { await local.put(col, await fromRemote(col, id, d)); changed = true; }
      }
    }
    const all = lsGet(PULLED, {}); all[user.uid] = pulled; lsSet(PULLED, all);
    return changed;
  }

  async function sync() {
    if (!user || stopped) return;
    if (busy) { again = true; return; }
    busy = true; status.state = "syncing"; emit();
    try {
      await push();
      const changed = await pull();
      status.state = "synced"; status.last = Date.now(); status.error = null; lsSet("diary.lastSync", status.last);
      if (changed) hooks.onRemoteChange?.();
    } catch (e) {
      console.error("diary: sync failed", e);
      status.state = navigator.onLine ? "error" : "offline"; status.error = e.code || e.message;
    } finally {
      busy = false; emit();
      if (again) { again = false; sync(); }
    }
  }

  // the first time an account is used on this device, send everything already here
  async function adoptLocal() {
    const seen = lsGet("diary.adopted", []);
    if (seen.includes(user.uid)) return;
    const dirty = lsGet(DIRTY, {});
    for (const col of COLS) for (const rec of await local.all(col)) dirty[`${col}/${rec.id ?? rec.date}`] = Date.now();
    lsSet(DIRTY, dirty);
    lsSet("diary.adopted", [...seen, user.uid]);
  }

  const unsub = fb.onAuthStateChanged(auth, async u => {
    user = u;
    if (!u) { status.state = "signed-out"; emit(); return; }
    await adoptLocal();
    emit(); sync();
  });
  fb.getRedirectResult(auth).catch(() => {});
  const onVis = () => { if (document.visibilityState === "visible") sync(); };
  const onOnline = () => sync();
  document.addEventListener("visibilitychange", onVis);
  addEventListener("online", onOnline);
  timer = setInterval(() => { if (document.visibilityState === "visible") sync(); }, 120000);

  let pushTimer = null;
  return {
    get user() { return user; },
    status: () => ({ ...status }),
    // call after any local change: col is days/photos/stickers/meta, id the record key
    changed(col, id) {
      const d = lsGet(DIRTY, {}); d[`${col}/${id}`] = Date.now(); lsSet(DIRTY, d);
      clearTimeout(pushTimer); pushTimer = setTimeout(sync, 1500);
    },
    sync,
    async signIn() {
      const p = new fb.GoogleAuthProvider();
      try { await fb.signInWithPopup(auth, p); }
      catch (e) {
        if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") await fb.signInWithRedirect(auth, p);
        else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") throw e;
      }
    },
    async signOut() { await fb.signOut(auth); },
    stop() { stopped = true; unsub(); clearInterval(timer); clearTimeout(pushTimer); document.removeEventListener("visibilitychange", onVis); removeEventListener("online", onOnline); },
  };
}
