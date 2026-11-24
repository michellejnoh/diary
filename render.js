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

export async function renderDay(opt) {
  const { boardEl, items, photos, assets, note, titleSoft, titleMain, colors } = opt;
  await Promise.all([
    document.fonts.load('40px "Special Elite"'), document.fonts.load('40px "Caveat"', "a"), document.fonts.load('40px "Nanum Pen Script"', "가"),
  ].map(p => p.catch(() => {})));

  // canvas shaped like the screen (portrait)
  const sw = Math.min(screen.width, screen.height) || 390, sh = Math.max(screen.width, screen.height) || 844;
  const W = 1170, H = Math.round(W * sh / sw), u = W / 390; // u: one CSS pixel on a 390-wide phone
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = CARD; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = grainPattern(ctx, u * .6); ctx.fillRect(0, 0, W, H);

  // ---- header: cut-out "Diary" and the date ----
  const M = 22 * u; let y = 34 * u;
  const letters = await Promise.all([..."diary"].map(c => loadImg(`cutout/${c}.webp`).catch(() => null)));
  let x = M; const lh = 44 * u, tilts = [-4, 3, -2, 5, -3];
  letters.forEach((img, i) => {
    if (!img) return;
    const w = img.naturalWidth * lh / img.naturalHeight;
    ctx.save(); ctx.translate(x + w / 2, y + lh / 2); ctx.rotate(tilts[i] * Math.PI / 180);
    ctx.shadowColor = "rgba(30,30,25,.28)"; ctx.shadowBlur = 2 * u; ctx.shadowOffsetY = 1 * u;
    ctx.drawImage(img, -w / 2, -lh / 2, w, lh); ctx.restore();
    x += w + 1.5 * u;
  });
  y += lh + 22 * u;
  ctx.font = `${22 * u}px "Special Elite", "Courier New", monospace`; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = PENCIL; ctx.fillText(titleSoft, M, y);
  ctx.fillStyle = INK; ctx.fillText(titleMain, M + ctx.measureText(titleSoft + " ").width, y);
  const contentTop = y + 26 * u;

  // ---- day note size (bottom) ----
  const hasNote = !!(note && note.trim());
  const noteFont = `${21 * u}px "Caveat", "Nanum Pen Script", sans-serif`, lineH = 34 * u;
  let noteLines = [], noteH = 0;
  if (hasNote) {
    ctx.font = noteFont;
    noteLines = wrapLines(ctx, note, W - 2 * M - 44 * u).slice(0, 8);
    noteH = 22 * u + Math.max(1, noteLines.length) * lineH + 18 * u;
  }
  const bottom = H - 36 * u - (hasNote ? noteH + 30 * u : 0);

  // ---- geometry of everything on the board, from the page ----
  const els = [...boardEl.querySelectorAll(".ci[data-id]")];
  const geo = els.map(el => {
    const it = items.find(i => i.id === el.dataset.id); if (!it) return null;
    const g = { it, el, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, rot: it.rot || 0, z: it.z || 1 };
    const rad = Math.abs(g.rot) * Math.PI / 180, bw = g.w * Math.cos(rad) + g.h * Math.sin(rad), bh = g.w * Math.sin(rad) + g.h * Math.cos(rad);
    g.l = g.x + g.w / 2 - bw / 2; g.r = g.x + g.w / 2 + bw / 2; g.t = g.y + g.h / 2 - bh / 2; g.b = g.y + g.h / 2 + bh / 2;
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

  // try 1–4 columns; keep the one where pictures come out biggest while everything fits the screen
  const AW = W - 2 * M, AH = bottom - contentTop, gap = 16 * u, MAX = 3.2 * u;
  let plan = null;
  for (let c = 1; c <= Math.min(4, groups.length); c++) {
    const cellW = (AW - gap * (c - 1)) / c, rows = [];
    for (let i = 0; i < groups.length; i += c) rows.push(groups.slice(i, i + c));
    const rowH = rows.map(r => Math.max(...r.map(g => g.h * Math.min(cellW / g.w, MAX))));
    const total = rowH.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
    const f = Math.min(1, (AH - gap * (rows.length - 1)) / (total - gap * (rows.length - 1)));
    const area = groups.reduce((a, g) => a + g.w * g.h * (Math.min(cellW / g.w, MAX) * f) ** 2, 0);
    if (!plan || area > plan.area) plan = { c, cellW, rows, rowH, f, area };
  }
  const { c, cellW, rows, rowH, f } = plan;
  const usedH = rowH.reduce((a, b) => a + b * f, 0) + gap * (rows.length - 1);
  let yy = contentTop + Math.max(0, (AH - usedH) / 2);
  rows.forEach((r, ri) => {
    let xx = M + (AW - (c * cellW * f + gap * (c - 1))) / 2 + (c - r.length) * (cellW * f + gap) / 2;
    r.forEach(g => {
      g.s = Math.min(cellW / g.w, MAX) * f;
      g.ox = xx + (cellW * f - g.w * g.s) / 2 - g.l * g.s;
      g.oy = yy + (rowH[ri] * f - g.h * g.s) / 2 - g.t * g.s;
      g.members.forEach(m => { m.s = g.s; m.ox = g.ox; m.oy = g.oy; });
      xx += cellW * f + gap;
    });
    yy += rowH[ri] * f + gap;
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
  for (const g of geo.sort((a, b) => a.z - b.z)) {
    const { it, el } = g, s = g.s, w = g.w * s, h = g.h * s;
    ctx.save();
    ctx.translate(g.ox + (g.x + g.w / 2) * s, g.oy + (g.y + g.h / 2) * s);
    ctx.rotate(g.rot * Math.PI / 180);
    ctx.translate(-w / 2, -h / 2);
    if (it.kind === "photo") drawPhoto(ctx, g, el, imgs[it.id], photos[it.ref], s, opt);
    else if (it.kind === "image" && imgs[it.id]) {
      if (it.outline) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 0; for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { ctx.shadowOffsetX = dx * s; ctx.shadowOffsetY = dy * s; ctx.drawImage(imgs[it.id], 0, 0, w, h); } }
      shadow(ctx, s, .6); ctx.shadowOffsetX = 0; ctx.drawImage(imgs[it.id], 0, 0, w, h);
    }
    else if (it.kind === "tape") { ctx.fillStyle = TAPE; ctx.fillRect(0, 0, w, h); }
    else if (it.kind === "text") drawText(ctx, g, el, s, cutImgs, colors);
    ctx.restore();
  }

  // ---- day note slip ----
  if (hasNote) {
    const nx = M, ny = H - 36 * u - noteH, nw = W - 2 * M;
    ctx.save(); ctx.translate(nx + nw / 2, ny + noteH / 2); ctx.rotate(-.6 * Math.PI / 180); ctx.translate(-nw / 2, -noteH / 2);
    shadow(ctx, u); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, nw, noteH); noShadow(ctx);
    tapeRect(ctx, nw * .3, 0, nw * .28, 18 * u, -3);
    ctx.strokeStyle = "rgba(80,110,150,.28)"; ctx.lineWidth = 1 * u;
    const rows = Math.max(1, noteLines.length);
    for (let r = 0; r < rows; r++) { const ly = 22 * u + (r + 1) * lineH - 1 * u; ctx.beginPath(); ctx.moveTo(22 * u, ly); ctx.lineTo(nw - 22 * u, ly); ctx.stroke(); }
    ctx.font = noteFont; ctx.fillStyle = INK;
    noteLines.forEach((t, r) => ctx.fillText(t, 22 * u, 22 * u + (r + 1) * lineH - 9 * u));
    ctx.restore();
  }
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
  if (kind !== "film") {
    const tx = parseFloat(el.style.getPropertyValue("--tape-x")) / 100 || .5, tr = parseFloat(el.style.getPropertyValue("--tape-r")) || -3;
    tapeRect(ctx, g.w * s * tx, fy + 1 * s, g.w * s * .42, 16 * s, tr);
  }
  // time + note
  if (cap && p) {
    const cx = cap.offsetLeft * s, cy = cap.offsetTop * s, cw = cap.offsetWidth * s;
    const timeEl = cap.querySelector(".time"); let ty = cy + 2 * s;
    const album = opt.paper === "album" && kind !== "instant";
    if (timeEl) { ctx.font = `${12 * s}px "Special Elite", monospace`; ctx.fillStyle = album ? "#A9A79E" : PENCIL; ty += 12 * s; ctx.fillText(timeEl.textContent, cx + 4 * s, ty); ty += 4 * s; }
    if (p.caption) {
      const fs = Math.min(26, Math.max(16, g.w * .085)) * s;
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
