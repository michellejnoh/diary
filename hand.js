// My handwriting: draw letters and Korean jamo once, then write with them.
// Glyphs are strokes in a 0–1 box: { strokes: [[x, y, x, y, ...], ...] }.

export const HAND_SETS = [
  { key: "ko-c", name: "한글 자음", chars: "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ", kind: "ko" },
  { key: "ko-v", name: "한글 모음", chars: "ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ", kind: "ko" },
  { key: "en-l", name: "a–z", chars: "abcdefghijklmnopqrstuvwxyz", kind: "en" },
  { key: "en-u", name: "A–Z", chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", kind: "en" },
  { key: "num", name: "0–9", chars: "0123456789", kind: "en" },
  { key: "mark", name: "Marks", chars: ".,!?'\"-:;()~/&", kind: "en" },
];
export const ALL_CHARS = HAND_SETS.map(s => s.chars).join("");
export const kindOf = ch => HAND_SETS.find(s => s.chars.includes(ch))?.kind || "en";

// ---------- Korean composition ----------
const L = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const V = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const T = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const PAIRS = { ㄲ: "ㄱㄱ", ㄸ: "ㄷㄷ", ㅃ: "ㅂㅂ", ㅆ: "ㅅㅅ", ㅉ: "ㅈㅈ", ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ", ㄽ: "ㄹㅅ", ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ" };
const VERT_PAIRS = { ㅐ: "ㅏㅣ", ㅒ: "ㅑㅣ", ㅔ: "ㅓㅣ", ㅖ: "ㅕㅣ" };
const MIXED = { ㅘ: ["ㅗ", "ㅏ"], ㅙ: ["ㅗ", "ㅐ"], ㅚ: ["ㅗ", "ㅣ"], ㅝ: ["ㅜ", "ㅓ"], ㅞ: ["ㅜ", "ㅔ"], ㅟ: ["ㅜ", "ㅣ"], ㅢ: ["ㅡ", "ㅣ"] };
const HORIZ = "ㅗㅛㅜㅠㅡ";

const BOX = { // [x, y, w, h] inside a 1×1 syllable box
  v: { L: [.03, .1, .5, .8], V: [.53, .02, .44, .96] },
  h: { L: [.14, .02, .72, .52], V: [.03, .54, .94, .42] },
  m: { L: [.04, .03, .5, .5], Vh: [.02, .5, .68, .44], Vv: [.64, .01, .34, .98] },
  vT: { L: [.03, .05, .5, .5], V: [.53, .01, .44, .6], T: [.12, .62, .76, .36] },
  hT: { L: [.18, .01, .64, .34], V: [.05, .33, .9, .28], T: [.14, .62, .72, .36] },
  mT: { L: [.04, .02, .48, .32], Vh: [.02, .32, .64, .3], Vv: [.64, .01, .34, .62], T: [.12, .64, .72, .34] },
};

function bbox(strokes) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const s of strokes) for (let i = 0; i < s.length; i += 2) {
    x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]);
  }
  return [x0, y0, Math.max(.04, x1 - x0), Math.max(.04, y1 - y0)];
}
// fit strokes into a box: keep the shape, allow a little stretch so pieces fill their space
function fit(strokes, [bx, by, bw, bh]) {
  const [x0, y0, w, h] = bbox(strokes);
  const s = Math.min(bw / w, bh / h);
  const sx = Math.min(bw / w, s * 1.4), sy = Math.min(bh / h, s * 1.4);
  const ox = bx + (bw - w * sx) / 2, oy = by + (bh - h * sy) / 2;
  return strokes.map(st => st.map((v, i) => i % 2 ? oy + (v - y0) * sy : ox + (v - x0) * sx));
}
const split = ([x, y, w, h], r = .52) => [[x, y, w * r, h], [x + w * (1 - r), y, w * r, h]];

function jamo(ch, box, g) {
  if (PAIRS[ch]) { const [a, b] = split(box); return [...jamo(PAIRS[ch][0], a, g), ...jamo(PAIRS[ch][1], b, g)]; }
  if (VERT_PAIRS[ch]) {
    const [x, y, w, h] = box;
    return [...jamo(VERT_PAIRS[ch][0], [x, y, w * .64, h], g), ...jamo("ㅣ", [x + w * .62, y, w * .38, h], g)];
  }
  const glyph = g[ch];
  if (!glyph?.strokes?.length) throw 0;
  return fit(glyph.strokes, box);
}

export function composeSyllable(ch, g) {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  const l = L[Math.floor(code / 588)], v = V[Math.floor((code % 588) / 28)], t = T[code % 28];
  const type = MIXED[v] ? "m" : HORIZ.includes(v) ? "h" : "v";
  const B = BOX[type + (t ? "T" : "")];
  try {
    let out = jamo(l, B.L, g);
    if (type === "m") out = [...out, ...jamo(MIXED[v][0], B.Vh, g), ...jamo(MIXED[v][1], B.Vv, g)];
    else out = [...out, ...jamo(v, B.V, g)];
    if (t) out = [...out, ...jamo(t, B.T, g)];
    return out;
  } catch { return null; }
}

// ---------- rendering ----------
// Every glyph is drawn in a box 1.1em tall; the baseline sits at 72% of it, like the guide lines on the drawing pad.
const H = 1.1, BASE = .72, PEN = .06;
const pathOf = strokes => strokes.map(s => {
  if (s.length < 4) return `M${s[0]} ${s[1]}l0 0`;
  let d = `M${s[0].toFixed(3)} ${s[1].toFixed(3)}`;
  for (let i = 2; i < s.length - 2; i += 2) { // smooth through midpoints
    const mx = (s[i] + s[i + 2]) / 2, my = (s[i + 1] + s[i + 3]) / 2;
    d += `Q${s[i].toFixed(3)} ${s[i + 1].toFixed(3)} ${mx.toFixed(3)} ${my.toFixed(3)}`;
  }
  return d + `L${s[s.length - 2].toFixed(3)} ${s[s.length - 1].toFixed(3)}`;
}).join("");
const svg = (strokes, w, extra = "") =>
  `<svg class="hg" viewBox="0 0 ${w.toFixed(3)} 1" style="width:${(w * H).toFixed(3)}em${extra}" aria-hidden="true"><path d="${pathOf(strokes)}"/></svg>`;

function glyphSVG(ch, g) {
  if (/[가-힣]/.test(ch)) {
    const st = composeSyllable(ch, g); if (!st) return null;
    // syllable box sits on the baseline, 0.78 of the line box tall
    return svg(st.map(s => s.map((v, i) => i % 2 ? .02 + v * .76 : .04 + v * .78)), .86);
  }
  const glyph = g[ch];
  if (!glyph?.strokes?.length) return null;
  if (kindOf(ch) === "ko") return svg(glyph.strokes.map(s => s.map((v, i) => i % 2 ? .02 + v * .76 : .04 + v * .78)), .86);
  const [x0, , w] = bbox(glyph.strokes);
  const adv = w + .1;
  return svg(glyph.strokes.map(s => s.map((v, i) => i % 2 ? v : v - x0 + .05)), adv);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function hasGlyphs(g) { return g && Object.values(g).some(x => x?.strokes?.length); }

// text -> HTML in your handwriting; characters you haven't drawn fall back to the regular handwriting font
export function renderHand(text, g) {
  return String(text).split(/(\n| +)/).map(part => {
    if (part === "\n") return "<br>";
    if (/^ +$/.test(part)) return part.replace(/ /g, '<span class="hsp"> </span>');
    if (!part) return "";
    return `<span class="hw">${[...part].map(ch => glyphSVG(ch, g) || `<span class="hf">${esc(ch)}</span>`).join("")}</span>`;
  }).join("");
}

// ---------- drawing ----------
// Ramer–Douglas–Peucker: keep the shape, drop most points
function simplify(pts, eps = .004) {
  if (pts.length <= 4) return pts;
  const n = pts.length / 2;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2], py = pts[i * 2 + 1];
      // closed loops (start = end) measure from the start point instead of a line
      const d = len < 1e-6 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(+pts[i * 2].toFixed(3), +pts[i * 2 + 1].toFixed(3));
  return out;
}

export function handPageHTML(g, enabled) {
  const drawn = ALL_CHARS.split("").filter(c => g[c]?.strokes?.length).length;
  const tile = ch => {
    const glyph = g[ch];
    const inner = glyph?.strokes?.length
      ? `<svg viewBox="0 0 1 1" aria-hidden="true"><path d="${pathOf(glyph.strokes)}"/></svg>`
      : `<span class="hint-ch">${esc(ch)}</span>`;
    return `<button class="htile${glyph?.strokes?.length ? " done" : ""}" data-draw="${esc(ch)}" aria-label="Draw ${esc(ch)}">${inner}</button>`;
  };
  return `
    <p class="summary">Draw each letter once. Korean syllables are built from the consonants and vowels. ${drawn} of ${ALL_CHARS.length} drawn.</p>
    <div class="hand-use">
      <button class="chip" data-hand-use="on" aria-pressed="${!!enabled}">Use my handwriting</button>
      <button class="chip" data-hand-use="off" aria-pressed="${!enabled}">Use the font</button>
    </div>
    <div class="hand-try">
      <label class="sr" for="handTry">Try your handwriting</label>
      <input id="handTry" type="text" value="오늘은 맑음. a good day" autocomplete="off">
      <div class="hand-out" id="handOut">${renderHand("오늘은 맑음. a good day", g)}</div>
    </div>
    ${HAND_SETS.map(s => `<section class="hset"><h2 class="month-title">${s.name}</h2><div class="htiles">${[...s.chars].map(tile).join("")}</div></section>`).join("")}`;
}

// the drawing pad: returns a close function
export function openPad(ch, g, onSave) {
  const el = document.createElement("div");
  el.className = "pad"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  let cur = ch, strokes = [], live = null;
  const order = ALL_CHARS.split("");
  el.innerHTML = `
    <div class="pad-card">
      <div class="pad-head"><span class="pad-ch typed"></span><button class="link" data-pad="close">Close</button></div>
      <div class="pad-area"><canvas></canvas></div>
      <div class="pad-tools">
        <button class="chip" data-pad="undo">Undo</button>
        <button class="chip" data-pad="clear">Clear</button>
        <span class="spacer"></span>
        <button class="chip" data-pad="prev">Previous</button>
        <button class="chip save" data-pad="next">Save &amp; next</button>
      </div>
    </div>`;
  document.body.append(el);
  const area = el.querySelector(".pad-area"), cv = el.querySelector("canvas"), ctx = cv.getContext("2d");
  const size = () => area.clientWidth;
  function setup() {
    const s = size(), r = devicePixelRatio || 1;
    cv.width = cv.height = s * r; cv.style.width = cv.style.height = s + "px";
    ctx.setTransform(r, 0, 0, r, 0, 0);
    draw();
  }
  function draw() {
    const s = size();
    ctx.clearRect(0, 0, s, s);
    ctx.lineCap = ctx.lineJoin = "round"; ctx.strokeStyle = "#2C2B27"; ctx.lineWidth = Math.max(3, s * .045);
    for (const st of [...strokes, ...(live ? [live] : [])]) {
      ctx.beginPath();
      for (let i = 0; i < st.length; i += 2) { const x = st[i] * s, y = st[i + 1] * s; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      if (st.length === 2) ctx.lineTo(st[0] * s + .1, st[1] * s);
      ctx.stroke();
    }
  }
  function load(c) {
    cur = c; strokes = (g[c]?.strokes || []).map(s => [...s]); live = null;
    el.querySelector(".pad-ch").textContent = c;
    area.className = `pad-area guide-${kindOf(c)}`;
    draw();
  }
  const ptr = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  cv.addEventListener("pointerdown", e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); live = ptr(e); draw(); });
  cv.addEventListener("pointermove", e => { if (!live) return; const [x, y] = ptr(e); live.push(x, y); draw(); });
  const end = () => { if (live) { strokes.push(simplify(live)); live = null; draw(); } };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  const save = () => onSave(cur, strokes.length ? { strokes: strokes.map(s => s.map(v => +Math.min(1, Math.max(0, v)).toFixed(3))) } : null);
  const close = () => { el.remove(); removeEventListener("resize", setup); };
  el.addEventListener("click", e => {
    const a = e.target.closest("[data-pad]")?.dataset.pad; if (!a) return;
    if (a === "close") { save(); close(); }
    else if (a === "undo") { strokes.pop(); draw(); }
    else if (a === "clear") { strokes = []; draw(); }
    else if (a === "next" || a === "prev") {
      save();
      const i = order.indexOf(cur), n = order[(i + (a === "next" ? 1 : -1) + order.length) % order.length];
      load(n);
    }
  });
  addEventListener("resize", setup);
  setup(); load(ch);
  return close;
}
