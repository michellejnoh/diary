// Draws a day as one picture shaped like the device screen.
// Photos, stickers and text keep their arrangement from the page, scaled to fit; the day note goes at the bottom.

const INK = "#2C2B27", PENCIL = "#67695F", CARD = "#D5D7CE", PAPER = "#F7F5EF", TAPE = "rgba(222,213,186,.92)";

const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
async function blobImg(blob) {
  let src = null;
  try { src = await createImageBitmap(blob); } catch {}
  if (!src) {
    const u = URL.createObjectURL(blob);
    try { src = await loadImg(u); await src.decode?.().catch(() => {}); } finally { setTimeout(() => URL.revokeObjectURL(u), 4000); }
  }
  // copy onto a plain canvas: Safari draws canvases reliably
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(src, 0, 0);
  c.naturalWidth = w; c.naturalHeight = h;
  return c;
}

function grainPattern(ctx, scale) {
  const n = document.createElement("canvas"); n.width = n.height = 160;
  const g = n.getContext("2d"), d = g.createImageData(160, 160);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 16;
  }
  g.putImageData(d, 0, 0);
  const p = ctx.createPattern(n, "repeat");
  p.setTransform?.(new DOMMatrix().scale(scale));
  return p;
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (ctx.measureText(test).width > maxW && line.trim()) { out.push(line.trimEnd()); line = word.trimStart(); }
      else line = test;
      while (ctx.measureText(line).width > maxW && line.length > 1) { // a very long word: break by letters
        let k = line.length; while (k > 1 && ctx.measureText(line.slice(0, k)).width > maxW) k--;
        out.push(line.slice(0, k)); line = line.slice(k);
      }
    }
    out.push(line);
  }
  return out;
}

function shadow(ctx, s, lift = 1) { ctx.shadowColor = "rgba(40,40,34,.32)"; ctx.shadowBlur = 14 * s * lift; ctx.shadowOffsetY = 5 * s * lift; }
function noShadow(ctx) { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
function tapeRect(ctx, cx, cy, w, h, rot) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot * Math.PI / 180);
  ctx.fillStyle = TAPE; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}
function drawCover(ctx, img, x, y, w, h, look) {
  const r = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / r, sh = h / r, sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
  const filters = { grain: "contrast(1.06) saturate(.88)", warm: "sepia(.28) saturate(1.12) contrast(.94) brightness(1.04)", bw: "grayscale(1) contrast(1.12)" };
  if ("filter" in ctx && filters[look]) ctx.filter = filters[look];
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.filter = "none";
}

export const PAPER_FILL = { card: "#EEE9DC", kraft: "#C4A57A", grid: "#F3F1EA", album: "#23221F", cream: "#EFE6D2", blush: "#E8D4CC", sage: "#C6CFBA", dots: "#F4F1E9", lined: "#F7F5EE", navy: "#222B3B" };

export async function renderDay(opt) {
  const { boardEl, items, photos, assets, note, titleSoft, titleMain, colors } = opt;
  await Promise.all([
    document.fonts.load('40px "Special Elite"'), document.fonts.load('40px "Caveat"', "a"), document.fonts.load('40px "Nanum Pen Script"', "가"),
  ].map(p => p.catch(() => {})));

  // seeded randomness: the same day always comes out the same
  let seed = [...(opt.seed || "diary")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  const W = 1170, H = 1560, u = W / 390; // 3:4 picture; u = one CSS pixel on a 390-wide phone
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  // ---- the table under the page: soft linen ----
  ctx.fillStyle = "#CBC3B2"; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = .07; ctx.strokeStyle = "#5B5244"; ctx.lineWidth = .8 * u;
  for (let i = 0; i < H; i += 2.2 * u) { ctx.beginPath(); ctx.moveTo(0, i + rand() * u); ctx.lineTo(W, i + rand() * u); ctx.stroke(); }
  for (let i = 0; i < W; i += 2.6 * u) { ctx.beginPath(); ctx.moveTo(i + rand() * u, 0); ctx.lineTo(i + rand() * u, H); ctx.stroke(); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = grainPattern(ctx, u * .6); ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W / 2, H / 2, W * .3, W / 2, H / 2, W * .85);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(40,32,20,.22)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // ---- the album page, torn out along its binding ----
  const paper = opt.paper || "card";
  const P = { x: 30 * u, y: 16 * u, w: W - 44 * u, h: H - 32 * u };
  const holeX = P.x + 9 * u, holes = [];
  for (let hy = P.y + 26 * u; hy < P.y + P.h - 16 * u; hy += 34 * u) holes.push(hy);
  const pagePath = new Path2D();
  pagePath.moveTo(P.x + 4 * u, P.y);
  pagePath.lineTo(P.x + P.w, P.y + 1 * u); pagePath.lineTo(P.x + P.w - 1 * u, P.y + P.h); pagePath.lineTo(P.x + 3 * u, P.y + P.h - 1 * u);
  for (let ty = P.y + P.h; ty > P.y; ty -= 4 * u + rand() * 5 * u) {           // ragged torn edge, nicking the punch holes
    pagePath.lineTo(P.x + (rand() < .12 ? 5 * u : 0) + rand() * 5 * u, ty);
  }
  pagePath.closePath();
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(-.7 * Math.PI / 180); ctx.translate(-W / 2, -H / 2); // the page lies a little crooked; everything on it follows
  ctx.save(); ctx.shadowColor = "rgba(30,24,14,.38)"; ctx.shadowBlur = 26 * u; ctx.shadowOffsetY = 8 * u;
  ctx.fillStyle = PAPER_FILL[paper] || PAPER_FILL.card; ctx.fill(pagePath); ctx.restore();
  ctx.save(); ctx.clip(pagePath);
  if (paper === "dots") { ctx.fillStyle = "rgba(80,90,100,.3)"; for (let gx = P.x + 18 * u; gx < P.x + P.w; gx += 18 * u) for (let gy = P.y + 18 * u; gy < P.y + P.h; gy += 18 * u) { ctx.beginPath(); ctx.arc(gx, gy, 1.2 * u, 0, 7); ctx.fill(); } }
  if (paper === "lined") {
    ctx.strokeStyle = "rgba(80,110,150,.24)"; ctx.lineWidth = 1 * u;
    for (let gy = P.y + 40 * u; gy < P.y + P.h; gy += 28 * u) { ctx.beginPath(); ctx.moveTo(P.x, gy); ctx.lineTo(P.x + P.w, gy); ctx.stroke(); }
    ctx.strokeStyle = "rgba(205,90,80,.45)"; ctx.lineWidth = 1.5 * u; ctx.beginPath(); ctx.moveTo(P.x + 40 * u, P.y); ctx.lineTo(P.x + 40 * u, P.y + P.h); ctx.stroke();
  }
  if (paper === "grid") {
    ctx.strokeStyle = "rgba(80,110,150,.2)"; ctx.lineWidth = 1 * u;
    for (let gx = P.x; gx <= P.x + P.w; gx += 22 * u) { ctx.beginPath(); ctx.moveTo(gx, P.y); ctx.lineTo(gx, P.y + P.h); ctx.stroke(); }
    for (let gy = P.y; gy <= P.y + P.h; gy += 22 * u) { ctx.beginPath(); ctx.moveTo(P.x, gy); ctx.lineTo(P.x + P.w, gy); ctx.stroke(); }
  }
  for (let i = 0; i < 7; i++) { // faint age spots
    const bx = P.x + rand() * P.w, by = P.y + rand() * P.h, br = (30 + rand() * 90) * u;
    const sp = ctx.createRadialGradient(bx, by, 0, bx, by, br); sp.addColorStop(0, "rgba(120,95,55,.06)"); sp.addColorStop(1, "rgba(120,95,55,0)");
    ctx.fillStyle = sp; ctx.fillRect(bx - br, by - br, 2 * br, 2 * br);
  }
  ctx.fillStyle = grainPattern(ctx, u * .6); ctx.fillRect(P.x, P.y, P.w, P.h);
  ctx.restore();

  // ---- top: the date typed on a strip of masking tape; "Diary" pencilled in the corner ----
  await document.fonts.load('40px "Homemade Apple"').catch(() => {});
  const M = P.x + 34 * u, innerR = P.x + P.w - 18 * u;
  ctx.font = `${17 * u}px "Special Elite", "Courier New", monospace`; ctx.textBaseline = "alphabetic";
  const dateTxt = `${titleSoft} ${titleMain}`, dW = ctx.measureText(dateTxt).width;
  ctx.save(); ctx.translate(M - 6 * u, P.y + 26 * u); ctx.rotate(-2.2 * Math.PI / 180);
  ctx.fillStyle = TAPE; ctx.shadowColor = "rgba(40,40,34,.18)"; ctx.shadowBlur = 3 * u; ctx.shadowOffsetY = 1 * u;
  ctx.fillRect(0, 0, dW + 34 * u, 30 * u); noShadow(ctx);
  ctx.fillStyle = INK; ctx.fillText(dateTxt, 17 * u, 21 * u); ctx.restore();
  ctx.font = `${20 * u}px "Homemade Apple", "Caveat", cursive`;
  const dark = paper === "album" || paper === "navy";
  ctx.fillStyle = dark ? "rgba(238,235,226,.75)" : "rgba(36,35,31,.72)";
  ctx.save(); ctx.translate(innerR - ctx.measureText("Diary").width, P.y + 44 * u); ctx.rotate(3 * Math.PI / 180); ctx.fillText("Diary", 0, 0); ctx.restore();
  const contentTop = P.y + 74 * u;

  // ---- day note size (bottom) ----
  const hasNote = !!(note && note.trim());
  const noteFont = `${20 * u}px "Caveat", "Nanum Pen Script", sans-serif`, lineH = 30 * u;
  const noteW = P.w * .62;
  let noteLines = [], noteH = 0;
  if (hasNote) {
    ctx.font = noteFont;
    noteLines = wrapLines(ctx, note, noteW - 40 * u).slice(0, 4);
    noteH = 20 * u + Math.max(1, noteLines.length) * lineH + 16 * u;
  }
  const bottom = P.y + P.h - 22 * u - (hasNote ? noteH + 6 * u : 0);

  // ---- geometry of everything on the board, from the page ----
  const els = [...boardEl.querySelectorAll(".ci[data-id]")];
  const geo = els.map(el => {
    const it = items.find(i => i.id === el.dataset.id); if (!it) return null;
    const g = { it, el, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, rot: it.kind === "photo" ? 0 : (it.rot || 0), z: it.z || 1 }; // photos start straight; the album layout tilts them
    const rad = Math.abs(g.rot) * Math.PI / 180, bw = g.w * Math.cos(rad) + g.h * Math.sin(rad), bh = g.w * Math.sin(rad) + g.h * Math.cos(rad);
    g.l = g.x + g.w / 2 - bw / 2; g.r = g.x + g.w / 2 + bw / 2; g.t = g.y + g.h / 2 - bh / 2; g.b = g.y + g.h / 2 + bh / 2;
    if (it.kind === "photo") { // only what shows: an empty caption box takes no room in the picture
      const fr = el.querySelector(".frame"), cap = el.querySelector(".cap"), txt = el.querySelector(".caption")?.value?.trim();
      if (fr && cap) g.b = g.y + Math.max(fr.offsetTop + fr.offsetHeight, cap.offsetTop + (txt ? cap.offsetHeight : 20));
    }
    return g;
  }).filter(Boolean);
  if (!geo.length) return cv;

  // stickers, text and tape go with the photo they sit on (or the nearest one)
  const photosG = geo.filter(g => g.it.kind === "photo");
  const groups = photosG.map(p => ({ members: [p] }));
  const loose = [];
  for (const g of geo) {
    if (g.it.kind === "photo") continue;
    const cx = (g.l + g.r) / 2, cy = (g.t + g.b) / 2;
    let best = -1, bd = Infinity;
    photosG.forEach((p, i) => {
      const inside = cx >= p.l && cx <= p.r && cy >= p.t && cy <= p.b;
      const d = inside ? -1 : Math.hypot(cx - (p.l + p.r) / 2, cy - (p.t + p.b) / 2);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) groups[best].members.push(g); else loose.push(g);
  }
  if (!groups.length) groups.push({ members: loose.splice(0) });
  else if (loose.length) groups[0].members.push(...loose);
  for (const gr of groups) {
    gr.l = Math.min(...gr.members.map(m => m.l)); gr.r = Math.max(...gr.members.map(m => m.r));
    gr.t = Math.min(...gr.members.map(m => m.t)); gr.b = Math.max(...gr.members.map(m => m.b));
    gr.w = gr.r - gr.l; gr.h = gr.b - gr.t;
  }
  groups.sort((a, b) => Math.abs(a.t - b.t) > 40 ? a.t - b.t : a.l - b.l); // page order

  // a loose album layout: balanced rows as a starting point, then every photo nudged, turned and
  // resized a little, so they overlap here and there like prints stuck down by hand
  const AX = M - 4 * u, AW = innerR + 6 * u - AX, AH = bottom - contentTop, gap = 6 * u;
  const pw = gr => (gr.members[0].it.kind === "photo" ? gr.members[0].w : gr.w);
  const layout = c => {
    const cw = (AW - gap * (c - 1)) / c, rows = [];
    const nRows = Math.ceil(groups.length / c), per = Math.ceil(groups.length / nRows);
    for (let i = 0; i < groups.length; i += per) rows.push(groups.slice(i, i + per));
    const rowH = rows.map(r => Math.max(...r.map(g => (g.b - g.t) * cw / pw(g))));
    return { c, cw, rows, rowH, total: rowH.reduce((a, b) => a + b, 0) + gap * (rows.length - 1) };
  };
  let plan = null, best = 0;
  for (let c = 1; c <= Math.min(5, groups.length); c++) {
    const L = layout(c), size = L.cw * Math.min(1.12, AH / (L.total * .96));
    if (size > best) { best = size; plan = L; }
  }
  const f = Math.min(1.12, AH / (plan.total * .96)); // photos may overlap a little
  const cw = plan.cw * f, g2 = gap * f;
  const avgPW = groups.reduce((a, g) => a + pw(g), 0) / groups.length, ts = cw / avgPW;
  const rowGap = (AH - plan.rowH.reduce((a, b) => a + b * f, 0)) / Math.max(1, plan.rows.length); // spread rows over the page
  let yy = contentTop + Math.max(-12 * u, rowGap / 2);
  plan.rows.forEach((r, ri) => {
    const rowW = r.length * cw + g2 * (r.length - 1);
    r.forEach((g, ci) => {
      const lead = g.members[0], k = .92 + rand() * .2;          // a little bigger or smaller
      let colX = AX + (AW - rowW) / 2 + ci * (cw + g2) + (rand() - .5) * cw * .3;
      { // keep clear of the torn edge (so writing under a photo stays readable) and of the right edge
        const sw = cw * k, tilt = (g.b - g.t) * cw / pw(g) * k * .09, left = colX + cw * (1 - k) / 2;
        const minL = P.x + 26 * u + tilt, maxR = P.x + P.w - 12 * u - tilt;
        if (left < minL) colX += minL - left; else if (left + sw > maxR) colX -= left + sw - maxR;
      }
      const rowY = yy + (rand() - .5) * plan.rowH[ri] * f * .2;
      g.s = cw / pw(g) * k;
      g.ox = colX + cw * (1 - k) / 2 - (lead.it.kind === "photo" ? lead.l : g.l) * g.s;
      g.oy = rowY - g.t * g.s;
      const rot = (rand() < .5 ? -1 : 1) * (2 + rand() * 6.5), cx = g.ox + (g.l + g.r) / 2 * g.s, cy = g.oy + (g.t + g.b) / 2 * g.s;
      const zb = (plan.rows.length - ri) + rand() * .9, corners = rand() < .4, cornerPair = rand() < .5;
      g.members.forEach(m => { m.s = g.s; m.ox = g.ox; m.oy = g.oy; m.ts = ts; m.grot = rot; m.gcx = cx; m.gcy = cy; m.zb = zb; m.corners = corners; m.cornerPair = cornerPair; });
    });
    yy += plan.rowH[ri] * f + rowGap;
  });

  // pictures first
  const imgs = {};
  await Promise.all(geo.map(async g => {
    if (g.it.kind === "photo" && photos[g.it.ref]) imgs[g.it.id] = await blobImg(photos[g.it.ref].blob).catch(() => null);
    if (g.it.kind === "image" && assets[g.it.ref]) imgs[g.it.id] = await blobImg(assets[g.it.ref].blob).catch(() => null);
  }));
  const cutImgs = {};
  for (const g of geo) if (g.it.kind === "text" && g.it.font === "cut")
    for (const ch of g.it.text.toLowerCase()) if (ch >= "a" && ch <= "z" && !cutImgs[ch]) cutImgs[ch] = await loadImg(`cutout/${ch}.webp`).catch(() => null);

  // ---- draw, back to front ----
  for (const g of geo.sort((a, b) => (a.zb - b.zb) || (a.z - b.z))) {
    const { it, el } = g, s = g.s, w = g.w * s, h = g.h * s;
    ctx.save();
    ctx.translate(g.gcx, g.gcy); ctx.rotate((g.grot || 0) * Math.PI / 180); ctx.translate(-g.gcx, -g.gcy); // the whole group turns together
    ctx.translate(g.ox + (g.x + g.w / 2) * s, g.oy + (g.y + g.h / 2) * s);
    ctx.rotate(g.rot * Math.PI / 180);
    ctx.translate(-w / 2, -h / 2);
    if (it.kind === "photo") drawPhoto(ctx, g, el, imgs[it.id], photos[it.ref], s, opt);
    else if (it.kind === "image" && imgs[it.id]) {
      if (it.outline) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 0; for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { ctx.shadowOffsetX = dx * s; ctx.shadowOffsetY = dy * s; ctx.drawImage(imgs[it.id], 0, 0, w, h); } }
      shadow(ctx, s, .6); ctx.shadowOffsetX = 0; ctx.drawImage(imgs[it.id], 0, 0, w, h);
    }
    else if (it.kind === "tape") { ctx.fillStyle = TAPE; ctx.fillRect(0, 0, w, h); }
    else if (it.kind === "scrap") drawScrap(ctx, it, w, h, s);
    else if (it.kind === "text") drawText(ctx, g, el, s, cutImgs, colors);
    ctx.restore();
  }

  // ---- day note: a torn-off slip in the lower right ----
  if (hasNote) {
    const nx = innerR - noteW - 4 * u, ny = P.y + P.h - 22 * u - noteH;
    ctx.save(); ctx.translate(nx + noteW / 2, ny + noteH / 2); ctx.rotate(1.8 * Math.PI / 180); ctx.translate(-noteW / 2, -noteH / 2);
    shadow(ctx, u); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, noteW, noteH); noShadow(ctx);
    tapeRect(ctx, noteW * .5, 0, noteW * .3, 16 * u, 4);
    ctx.strokeStyle = "rgba(80,110,150,.28)"; ctx.lineWidth = 1 * u;
    for (let r = 0; r < Math.max(1, noteLines.length); r++) { const ly = 20 * u + (r + 1) * lineH - 1 * u; ctx.beginPath(); ctx.moveTo(18 * u, ly); ctx.lineTo(noteW - 18 * u, ly); ctx.stroke(); }
    ctx.font = noteFont; ctx.fillStyle = INK;
    noteLines.forEach((t, r) => ctx.fillText(t, 20 * u, 20 * u + (r + 1) * lineH - 8 * u));
    ctx.restore();
  }
  ctx.restore(); // the page's tilt
  return cv;
}

function drawPhoto(ctx, g, el, img, p, s, opt) {
  const it = g.it, frame = el.querySelector(".frame"), cap = el.querySelector(".cap");
  const fx = frame.offsetLeft * s, fy = frame.offsetTop * s, fw = frame.offsetWidth * s, fh = frame.offsetHeight * s;
  const ph = el.querySelector(".photo");
  const px = fx + ph.offsetLeft * s, py = fy + ph.offsetTop * s, pw = ph.offsetWidth * s, phh = ph.offsetHeight * s;
  const lift = parseFloat(el.style.getPropertyValue("--lift")) || 1, kind = it.frame || "print";
  // card
  if (kind === "instant") { shadow(ctx, s, lift); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, g.w * s, g.h * s); noShadow(ctx); }
  else if (kind === "film") { shadow(ctx, s, lift); ctx.fillStyle = "#1D1C19"; ctx.fillRect(fx, fy, fw, fh); noShadow(ctx);
    ctx.fillStyle = "#DCD8CB"; const hole = fw * .034, step = fw * .072;
    for (let hx = fx + fw * .028; hx < fx + fw - hole; hx += step) { ctx.fillRect(hx, fy + fh * .03, hole, fh * .03); ctx.fillRect(hx, fy + fh - fh * .06, hole, fh * .03); } }
  else { shadow(ctx, s, lift); ctx.fillStyle = PAPER; ctx.fillRect(fx, fy, fw, fh); noShadow(ctx); }
  // photo
  ctx.fillStyle = "#1d1e1b"; ctx.fillRect(px, py, pw, phh);
  if (img) drawCover(ctx, img, px, py, pw, phh, it.look);
  // tape
  // what gets taped or cornered: the whole card for an instant print, the print itself otherwise
  const [bx, by, bw, bh] = kind === "instant" ? [0, 0, g.w * s, g.h * s] : [fx, fy, fw, fh];
  if (g.corners && kind !== "film") { // two big photo corners on opposite corners
    ctx.fillStyle = (opt.paper === "album" || opt.paper === "navy") ? "#D9D3C2" : "#24231F";
    const c = Math.min(bw, bh) * .3, o = 2 * s;
    const pairs = g.cornerPair ? [[bx + bw + o, by - o, -1, 1], [bx - o, by + bh + o, 1, -1]] : [[bx - o, by - o, 1, 1], [bx + bw + o, by + bh + o, -1, -1]];
    ctx.save(); ctx.shadowColor = "rgba(30,25,15,.3)"; ctx.shadowBlur = 2 * s; ctx.shadowOffsetY = .8 * s;
    for (const [x0, y0, dx, dy] of pairs) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + dx * c, y0); ctx.lineTo(x0, y0 + dy * c); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  } else if (kind !== "film") {
    const tx = parseFloat(el.style.getPropertyValue("--tape-x")) / 100 || .5, tr = parseFloat(el.style.getPropertyValue("--tape-r")) || -3;
    tapeRect(ctx, bx + bw * tx, by + 1 * s, bw * .42, 16 * s, tr);
  }
  // time + note
  if (cap && p) {
    const cx = cap.offsetLeft * s, cy = cap.offsetTop * s, cw = cap.offsetWidth * s;
    const timeEl = cap.querySelector(".time"); let ty = cy + 2 * s;
    const album = (opt.paper === "album" || opt.paper === "navy") && kind !== "instant"; // dark paper: light writing
    const t = g.ts || s; // same text size on every photo
    if (timeEl) { ctx.font = `${12 * t}px "Special Elite", monospace`; ctx.fillStyle = album ? "#A9A79E" : opt.paper === "kraft" && kind !== "instant" ? "#5E4B30" : PENCIL; ty += 12 * t; ctx.fillText(timeEl.textContent, cx + 4 * s, ty); ty += 4 * t; }
    if (p.caption) {
      const fs = 17 * t;
      ctx.font = `${fs}px "Caveat", "Nanum Pen Script", sans-serif`; ctx.fillStyle = album ? "#EEEBE2" : INK;
      wrapLines(ctx, p.caption, cw - 6 * s).forEach(t => { ty += fs * 1.15; ctx.fillText(t, cx + 4 * s, ty - fs * .2); });
    }
  }
}

function drawText(ctx, g, el, s, cutImgs, colors) {
  const it = g.it, span = el.querySelector(".ctext"); if (!span) return;
  const box = el.querySelector(".ctextbox"), fs = parseFloat(getComputedStyle(box).fontSize) * s;
  const fam = { hand: '"Caveat", "Nanum Pen Script"', type: '"Special Elite", monospace', press: '"Alfa Slab One", Georgia, serif', cut: '"Special Elite", monospace' }[it.font || "hand"] || '"Caveat", "Nanum Pen Script"';
  const size = it.font === "type" ? fs * .72 : it.font === "press" ? fs * .78 : fs;
  ctx.font = `${it.bold ? "700 " : ""}${size}px ${fam}`;
  const maxW = g.w * s - 8 * s, lines = it.font === "cut" ? String(it.text).split("\n") : wrapLines(ctx, it.text, maxW);
  const lh = size * 1.3; let y = 4 * s;
  for (const line of lines) {
    if (it.font === "cut") { // cut-out letters
      let x = 4 * s; const h = size * 1.15;
      [...line].forEach((ch, i) => {
        const img = cutImgs[ch.toLowerCase()];
        if (ch === " ") { x += size * .32; return; }
        const r = [-4, 3, -2, 5, -3, 2, -5, 4][i % 8] * Math.PI / 180;
        if (img) { const w = img.naturalWidth * h / img.naturalHeight; ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(r); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore(); x += w + size * .03; }
        else { ctx.save(); ctx.font = `700 ${size * .85}px Georgia, serif`; const w = ctx.measureText(ch).width + size * .4; ctx.translate(x + w / 2, y + h / 2); ctx.rotate(r); ctx.fillStyle = "#ECE9E0"; ctx.fillRect(-w / 2, -h * .45, w, h * .9); ctx.fillStyle = "#1F1E1B"; ctx.fillText(ch, -w / 2 + size * .2, h * .3); ctx.restore(); x += w + size * .03; }
      });
      y += h * 1.15; continue;
    }
    const tw = ctx.measureText(line).width;
    if (it.tape) { ctx.fillStyle = TAPE; ctx.fillRect(2 * s, y, tw + size * .8, lh); }
    if (it.hl) { ctx.globalAlpha = it.hl === "#2A2925" ? 1 : .85; ctx.fillStyle = it.hl; ctx.fillRect(2 * s + (it.tape ? size * .4 : 0), y + lh * .38, tw + size * .24, lh * .5); ctx.globalAlpha = 1; }
    ctx.fillStyle = it.color || colors[0];
    ctx.fillText(line, 4 * s + (it.tape ? size * .4 : 0), y + lh * .78);
    y += lh;
  }
}

function drawScrap(ctx, it, w, h, s) {
  const cq = w / 100, text = it.text || "";
  shadow(ctx, s, .6);
  if (it.type === "clip") {
    noShadow(ctx); ctx.strokeStyle = "#8E918A"; ctx.lineWidth = 2.2 * w / 20; ctx.lineCap = "round";
    const k = w / 20; ctx.beginPath();
    ctx.moveTo(14 * k, 18 * k); ctx.lineTo(14 * k, 44 * k); ctx.arc(9 * k, 44 * k, 5 * k, 0, Math.PI); ctx.lineTo(4 * k, 10 * k);
    ctx.arc(10.5 * k, 10 * k, 6.5 * k, Math.PI, 0); ctx.lineTo(17 * k, 44 * k); ctx.stroke(); return;
  }
  const fill = { ticket: "#D8C6A0", receipt: "#FBFAF5", stamp: "#FBFAF5", note: "#FBFAF5", label: "#1F1E1B" }[it.type] || PAPER;
  ctx.fillStyle = fill;
  if (it.type === "ticket") {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h / 2 - 6 * cq); ctx.arc(w, h / 2, 6 * cq, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.lineTo(0, h / 2 + 6 * cq); ctx.arc(0, h / 2, 6 * cq, Math.PI / 2, -Math.PI / 2, true); ctx.closePath(); ctx.fill();
  } else ctx.fillRect(0, 0, w, h);
  noShadow(ctx);
  const font = { ticket: `${9 * cq}px "Special Elite", monospace`, receipt: `${9.5 * cq}px "Special Elite", monospace`, stamp: `${15 * cq}px "Caveat", "Nanum Pen Script"`, note: `${9 * cq}px "Caveat", "Nanum Pen Script"`, label: `700 ${9 * cq}px "Courier New", monospace` }[it.type];
  if (it.type === "stamp") { ctx.fillStyle = "#A83D28"; ctx.fillRect(9 * cq, 9 * cq, w - 18 * cq, h - 18 * cq); }
  if (it.type === "note") { ctx.strokeStyle = "rgba(80,110,150,.3)"; ctx.lineWidth = .6 * cq; for (let ly = 18.4 * cq; ly < h; ly += 11 * cq) { ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w, ly); ctx.stroke(); } }
  ctx.font = font; ctx.fillStyle = it.type === "label" || it.type === "stamp" ? "#F2F0E8" : it.type === "ticket" ? "#4A3A22" : INK;
  const pad = { ticket: 12, receipt: 10, stamp: 14, note: 16, label: 6 }[it.type] * cq;
  const lines = wrapLines(ctx, it.type === "label" ? text.toUpperCase() : text, w - 2 * pad);
  const lh = (it.type === "note" ? 11 : it.type === "receipt" ? 13.8 : 12) * cq;
  let y0 = it.type === "ticket" || it.type === "stamp" || it.type === "label" ? h / 2 - (lines.length * lh) / 2 + lh * .75 : 16 * cq;
  ctx.textAlign = it.type === "ticket" || it.type === "stamp" ? "center" : "left";
  lines.forEach((t, i) => ctx.fillText(t, ctx.textAlign === "center" ? w / 2 : pad, y0 + i * lh));
  ctx.textAlign = "left";
}
