/**
 * XPS → PDF (offline, im Browser). Minimal-Renderer für MXDC-/Drucker-XPS:
 * FixedDocumentSequence → FixedDocument → FixedPage; Path (Data, Fill/Stroke solid),
 * Glyphs (obfuskierte .odttf-Fonts, Indices/Advance, Bold-/Italic-Simulation),
 * Canvas/RenderTransform (Matrix), ImageBrush (PNG/JPEG) für Rechteckflächen.
 * Glyphen werden als Vektorpfade gezeichnet (exakte Glyph-IDs und Positionen).
 * Benötigt: window.JSZip, window.PDFLib, window.fontkit.
 */

const U = 0.75; // 1/96 inch → pt

function partPath(base, target) {
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  const parts = (dir + target).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

function zipFile(zip, path) {
  if (!path) return null;
  const want = decodeURIComponent(path).toLowerCase();
  // XPS kann Teile als „Interleaved“-Pieces ablegen (Name/[0].piece …)
  let f = null;
  zip.forEach((rel, file) => {
    if (!f && rel.toLowerCase() === want) f = file;
  });
  return f;
}

async function readPieces(zip, path) {
  const f = zipFile(zip, path);
  if (f) return f.async('uint8array');
  const want = decodeURIComponent(path).toLowerCase() + '/';
  const pieces = [];
  zip.forEach((rel, file) => {
    if (rel.toLowerCase().startsWith(want)) pieces.push([rel, file]);
  });
  if (!pieces.length) throw new Error(`XPS-Teil fehlt: ${path}`);
  pieces.sort((a, b) => (parseInt(a[0].match(/\[(\d+)\]/)?.[1] || 0, 10)) - (parseInt(b[0].match(/\[(\d+)\]/)?.[1] || 0, 10)));
  const arrs = await Promise.all(pieces.map(([, f2]) => f2.async('uint8array')));
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

async function readXml(zip, path) {
  const bytes = await readPieces(zip, path);
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`XML-Fehler in ${path}`);
  return doc;
}

/* ---------- Fonts ---------- */

/** .odttf entschlüsseln: GUID aus Dateiname, erste 32 Bytes XOR. */
export function deobfuscateFont(bytes, fileName) {
  const m = String(fileName).match(/([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})/i);
  if (!m) return bytes;
  const hex = m.slice(1).join('');
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = parseInt(hex.substr(30 - i * 2, 2), 16);
  const out = new Uint8Array(bytes);
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[i % 16];
  return out;
}

/* ---------- Geometrie ---------- */

const IDENT = [1, 0, 0, 1, 0, 0];
function mul(a, b) {
  // a then b (XPS: child transform applied first, then parent): p' = b(a(p))
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}
function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function parseMatrix(s) {
  if (!s) return null;
  const n = s.split(/[\s,]+/).filter(Boolean).map(Number);
  return n.length === 6 && n.every(Number.isFinite) ? n : null;
}

function elTransform(el) {
  let m = parseMatrix(el.getAttribute('RenderTransform'));
  if (!m) {
    for (const c of el.children) {
      if (c.localName.endsWith('.RenderTransform')) {
        const mt = c.getElementsByTagName('MatrixTransform')[0];
        m = parseMatrix(mt?.getAttribute('Matrix'));
      }
    }
  }
  return m;
}

/** XPS Path-Data (Abkürzungssyntax) → Liste absoluter Kommandos (M/L/C/Q/Z). */
export function parsePathData(d) {
  const toks = String(d).match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const cmds = [];
  let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lc = null, fillRule = 'evenodd';
  const num = () => parseFloat(toks[i++]);
  const isNum = () => i < toks.length && !/^[A-Za-z]$/.test(toks[i]);
  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'F') { fillRule = num() === 1 ? 'nonzero' : 'evenodd'; continue; }
    if (C === 'Z') { cmds.push(['Z']); x = sx; y = sy; lc = null; continue; }
    do {
      if (C === 'M') { x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); sx = x; sy = y; cmds.push(['M', x, y]); cmd = rel ? 'l' : 'L'; lc = null; }
      else if (C === 'L') { x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); cmds.push(['L', x, y]); lc = null; }
      else if (C === 'H') { x = (rel ? x : 0) + num(); cmds.push(['L', x, y]); lc = null; }
      else if (C === 'V') { y = (rel ? y : 0) + num(); cmds.push(['L', x, y]); lc = null; }
      else if (C === 'C') {
        const a = [num(), num(), num(), num(), num(), num()];
        if (rel) { a[0] += x; a[1] += y; a[2] += x; a[3] += y; a[4] += x; a[5] += y; }
        cmds.push(['C', ...a]); lc = [a[2], a[3]]; x = a[4]; y = a[5];
      } else if (C === 'S') {
        const a = [num(), num(), num(), num()];
        if (rel) { a[0] += x; a[1] += y; a[2] += x; a[3] += y; }
        const c1 = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y];
        cmds.push(['C', c1[0], c1[1], ...a]); lc = [a[0], a[1]]; x = a[2]; y = a[3];
      } else if (C === 'Q') {
        const a = [num(), num(), num(), num()];
        if (rel) { a[0] += x; a[1] += y; a[2] += x; a[3] += y; }
        cmds.push(['Q', ...a]); x = a[2]; y = a[3]; lc = null;
      } else if (C === 'A') {
        // Bogen vereinfacht als Linie zum Endpunkt
        num(); num(); num(); num(); num();
        x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); cmds.push(['L', x, y]); lc = null;
      } else { i++; }
    } while (isNum());
  }
  return { cmds, fillRule };
}

function n(v) { return Math.round(v * 1000) / 1000; }

/** Kommandos → SVG-Pfad in PDF-Punkten (y nach unten, Ursprung oben links). */
function cmdsToSvg(cmds, m) {
  let s = '';
  for (const c of cmds) {
    if (c[0] === 'Z') { s += 'Z'; continue; }
    const pts = [];
    for (let k = 1; k < c.length; k += 2) {
      const [px, py] = apply(m, c[k], c[k + 1]);
      pts.push(n(px * U), n(py * U));
    }
    s += c[0] + pts.join(' ');
  }
  return s;
}

function parseColor(s) {
  if (!s) return null;
  s = s.trim();
  let m = s.match(/^#([0-9a-f]{8})$/i);
  if (m) {
    const v = m[1];
    return { a: parseInt(v.slice(0, 2), 16) / 255, r: parseInt(v.slice(2, 4), 16) / 255, g: parseInt(v.slice(4, 6), 16) / 255, b: parseInt(v.slice(6, 8), 16) / 255 };
  }
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const v = m[1];
    return { a: 1, r: parseInt(v.slice(0, 2), 16) / 255, g: parseInt(v.slice(2, 4), 16) / 255, b: parseInt(v.slice(4, 6), 16) / 255 };
  }
  m = s.match(/^sc#([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?$/i);
  if (m) {
    const v = m.slice(1).filter((x) => x != null).map(Number);
    return v.length === 4 ? { a: v[0], r: v[1], g: v[2], b: v[3] } : { a: 1, r: v[0], g: v[1], b: v[2] };
  }
  return null;
}

function brushOf(el, attr) {
  const direct = parseColor(el.getAttribute(attr));
  if (direct) return { color: direct };
  for (const c of el.children) {
    if (c.localName === `${el.localName}.${attr}`) {
      const sc = c.getElementsByTagName('SolidColorBrush')[0];
      if (sc) {
        const col = parseColor(sc.getAttribute('Color'));
        if (col) { col.a *= parseFloat(sc.getAttribute('Opacity') || '1'); return { color: col }; }
      }
      const ib = c.getElementsByTagName('ImageBrush')[0];
      if (ib) return { image: ib };
      const lg = c.getElementsByTagName('GradientStop')[0];
      if (lg) { const col = parseColor(lg.getAttribute('Color')); if (col) return { color: col }; }
    }
  }
  return null;
}

/* ---------- Renderer ---------- */

/**
 * @param {ArrayBuffer|Uint8Array} xpsBytes
 * @param {*} PDFLib  window.PDFLib
 * @param {{ outDoc?: any, onWarn?: (msg:string)=>void }} [opts]
 * @returns {Promise<any>} PDFDocument (neu oder outDoc) mit angehängten Seiten
 */
export async function xpsToPdf(xpsBytes, PDFLib, opts = {}) {
  const JSZip = window.JSZip;
  const fk = window.fontkit;
  if (!JSZip) throw new Error('JSZip fehlt');
  if (!fk) throw new Error('fontkit fehlt');
  const { rgb } = PDFLib;
  const warn = opts.onWarn || ((m) => console.warn('[xps]', m));
  const zip = await JSZip.loadAsync(xpsBytes);
  const doc = opts.outDoc || (await PDFLib.PDFDocument.create());

  // Einstieg: _rels/.rels → FixedDocumentSequence (Fallback: Datei suchen)
  let seqPath = null;
  try {
    const rels = await readXml(zip, '_rels/.rels');
    for (const r of rels.getElementsByTagName('Relationship')) {
      if (/fixedrepresentation$/i.test(r.getAttribute('Type') || '')) seqPath = partPath('', r.getAttribute('Target'));
    }
  } catch (_) {}
  if (!seqPath) zip.forEach((rel) => { if (!seqPath && /\.fdseq$/i.test(rel)) seqPath = rel; });
  if (!seqPath) throw new Error('Keine XPS-Datei (FixedDocumentSequence fehlt)');

  const pagePaths = [];
  const seq = await readXml(zip, seqPath);
  for (const dr of seq.getElementsByTagName('DocumentReference')) {
    const docPath = partPath(seqPath, dr.getAttribute('Source'));
    const fdoc = await readXml(zip, docPath);
    for (const pc of fdoc.getElementsByTagName('PageContent')) {
      pagePaths.push(partPath(docPath, pc.getAttribute('Source')));
    }
  }
  if (!pagePaths.length) throw new Error('XPS enthält keine Seiten');

  const fontCache = new Map();
  async function getFont(path) {
    if (fontCache.has(path)) return fontCache.get(path);
    let font = null;
    try {
      let bytes = await readPieces(zip, path);
      if (/\.odttf$/i.test(path)) bytes = deobfuscateFont(bytes, path.split('/').pop());
      font = fk.create(bytes);
      if (font.fonts) font = font.fonts[0]; // Collection
    } catch (err) {
      warn(`Schrift nicht lesbar: ${path} (${err.message})`);
    }
    fontCache.set(path, font);
    return font;
  }
  const glyphPathCache = new Map();
  function glyphCmds(font, path, gid) {
    const key = path + '#' + gid;
    if (glyphPathCache.has(key)) return glyphPathCache.get(key);
    let cmds = [];
    try {
      cmds = font.getGlyph(gid).path.commands;
    } catch (_) {}
    glyphPathCache.set(key, cmds);
    return cmds;
  }

  const imgCache = new Map();
  async function getImage(path) {
    if (imgCache.has(path)) return imgCache.get(path);
    let img = null;
    try {
      const bytes = await readPieces(zip, path);
      if (bytes[0] === 0x89 && bytes[1] === 0x50) img = await doc.embedPng(bytes);
      else if (bytes[0] === 0xff && bytes[1] === 0xd8) img = await doc.embedJpg(bytes);
      else warn(`Bildformat nicht unterstützt (nur PNG/JPEG): ${path}`);
    } catch (err) {
      warn(`Bild nicht lesbar: ${path} (${err.message})`);
    }
    imgCache.set(path, img);
    return img;
  }

  for (const pagePath of pagePaths) {
    const pxml = await readXml(zip, pagePath);
    const fp = pxml.documentElement;
    const W = parseFloat(fp.getAttribute('Width')) || 816;
    const H = parseFloat(fp.getAttribute('Height')) || 1056;
    const page = doc.addPage([W * U, H * U]);
    const PH = H * U;

    const drawCmds = (cmds, m, { fill, stroke, strokeWidth, fillRule, opacity }) => {
      const svg = cmdsToSvg(cmds, m);
      if (!svg) return;
      const o = {
        x: 0,
        y: PH,
      };
      if (fill) { o.color = rgb(fill.r, fill.g, fill.b); o.opacity = (fill.a ?? 1) * (opacity ?? 1); }
      if (stroke) {
        o.borderColor = rgb(stroke.r, stroke.g, stroke.b);
        o.borderWidth = strokeWidth;
        o.borderOpacity = (stroke.a ?? 1) * (opacity ?? 1);
      }
      if (!fill && !stroke) return;
      page.drawSvgPath(svg, o);
    };

    async function renderEl(el, parentM, parentOpacity) {
      const local = elTransform(el);
      const m = local ? mul(local, parentM) : parentM;
      const opacity = parentOpacity * parseFloat(el.getAttribute('Opacity') || '1');
      const name = el.localName;
      if (name === 'Canvas') {
        for (const c of el.children) if (!c.localName.includes('.')) await renderEl(c, m, opacity);
        return;
      }
      if (name === 'Path') {
        let data = el.getAttribute('Data');
        if (!data) {
          for (const c of el.children) {
            if (c.localName === 'Path.Data') {
              const figs = c.getElementsByTagName('PathFigure');
              data = '';
              for (const f of figs) {
                data += `M ${f.getAttribute('StartPoint')} `;
                for (const seg of f.children) {
                  if (seg.localName === 'PolyLineSegment') data += `L ${seg.getAttribute('Points')} `;
                  else if (seg.localName === 'PolyBezierSegment') data += `C ${seg.getAttribute('Points')} `;
                  else if (seg.localName === 'PolyQuadraticBezierSegment') data += `Q ${seg.getAttribute('Points')} `;
                  else if (seg.localName === 'ArcSegment') data += `L ${seg.getAttribute('Point')} `;
                }
                if (f.getAttribute('IsClosed') === 'true') data += 'Z ';
              }
            }
          }
        }
        if (!data) return;
        const { cmds, fillRule } = parsePathData(data);
        const fb = brushOf(el, 'Fill');
        const sb = brushOf(el, 'Stroke');
        if (fb?.image) {
          const ib = fb.image;
          const src = partPath(pagePath, ib.getAttribute('ImageSource'));
          const img = await getImage(src);
          const vp = (ib.getAttribute('Viewport') || '').split(/[\s,]+/).map(Number);
          const ibm = elTransform(ib);
          if (img && vp.length === 4) {
            const mm = ibm ? mul(ibm, m) : m;
            const [x0, y0] = apply(mm, vp[0], vp[1]);
            const [x1, y1] = apply(mm, vp[0] + vp[2], vp[1] + vp[3]);
            page.drawImage(img, {
              x: Math.min(x0, x1) * U,
              y: PH - Math.max(y0, y1) * U,
              width: Math.abs(x1 - x0) * U,
              height: Math.abs(y1 - y0) * U,
              opacity,
            });
          }
        }
        const sw = parseFloat(el.getAttribute('StrokeThickness') || '1') * Math.hypot(m[0], m[1]) * U;
        drawCmds(cmds, m, {
          fill: fb?.color,
          stroke: sb?.color,
          strokeWidth: sw,
          fillRule,
          opacity,
        });
        return;
      }
      if (name === 'Glyphs') {
        const fontPath = partPath(pagePath, el.getAttribute('FontUri'));
        const font = await getFont(fontPath);
        if (!font) return;
        const fill = brushOf(el, 'Fill')?.color || { r: 0, g: 0, b: 0, a: 1 };
        const em = parseFloat(el.getAttribute('FontRenderingEmSize') || '12');
        const ox = parseFloat(el.getAttribute('OriginX') || '0');
        const oy = parseFloat(el.getAttribute('OriginY') || '0');
        const sim = el.getAttribute('StyleSimulations') || 'None';
        const sideways = el.getAttribute('IsSideways') === 'true';
        const bidi = parseInt(el.getAttribute('BidiLevel') || '0', 10) % 2 === 1;
        const text = [...(el.getAttribute('UnicodeString') || '').replace(/^\{\}/, '')];
        const idxStr = el.getAttribute('Indices') || '';
        const scale = em / font.unitsPerEm;
        const italic = /Italic/.test(sim);
        const bold = /Bold/.test(sim);
        const skew = italic ? Math.tan((20 * Math.PI) / 180) : 0;

        // Indices: [(cc:gc)]gid[,adv[,uOff[,vOff]]] ; …
        const entries = idxStr ? idxStr.split(';') : [];
        const glyphs = [];
        let ci = 0;
        const count = Math.max(entries.length, text.length);
        for (let k = 0; k < count; k++) {
          let e = entries[k] ?? '';
          let cc = 1, gc = 1;
          const cm = e.match(/^\((\d+)(?::(\d+))?\)/);
          if (cm) { cc = parseInt(cm[1], 10); gc = parseInt(cm[2] || '1', 10); e = e.slice(cm[0].length); }
          const [g, a, u, v] = e.split(',');
          let gid = g !== undefined && g !== '' ? parseInt(g, 10) : null;
          const ch = text[ci];
          if (gid == null && ch != null) {
            try { gid = font.glyphForCodePoint(ch.codePointAt(0)).id; } catch (_) { gid = 0; }
          }
          if (gid == null) break;
          let adv;
          if (a !== undefined && a !== '') adv = (parseFloat(a) / 100) * em;
          else {
            try { adv = font.getGlyph(gid).advanceWidth * scale; } catch (_) { adv = 0; }
          }
          glyphs.push({ gid, adv, u: u ? (parseFloat(u) / 100) * em : 0, v: v ? (parseFloat(v) / 100) * em : 0 });
          if (k < entries.length || ch != null) ci += cc;
          void gc;
        }

        let pen = 0;
        let svgAll = '';
        for (const g of glyphs) {
          const cmds = glyphCmds(font, fontPath, g.gid);
          if (cmds.length) {
            const gx = ox + (bidi ? -pen - g.adv : pen) + g.u;
            const gy = oy - g.v;
            // Glyph-Raum (y nach oben, Font-Units) → Seite (y nach unten, 1/96")
            const gm = [scale, 0, scale * skew, -scale, gx, gy];
            const conv = cmds.map((c) => {
              switch (c.command) {
                case 'moveTo': return ['M', ...c.args];
                case 'lineTo': return ['L', ...c.args];
                case 'quadraticCurveTo': return ['Q', ...c.args];
                case 'bezierCurveTo': return ['C', ...c.args];
                case 'closePath': return ['Z'];
                default: return null;
              }
            }).filter(Boolean);
            svgAll += cmdsToSvg(conv, mul(gm, m));
          }
          pen += g.adv;
        }
        void sideways;
        if (svgAll) {
          const o = { x: 0, y: PH, color: rgb(fill.r, fill.g, fill.b), opacity: (fill.a ?? 1) * opacity };
          if (bold) {
            o.borderColor = o.color;
            o.borderWidth = em * U * 0.03 * Math.hypot(m[0], m[1]);
            o.borderOpacity = o.opacity;
          }
          page.drawSvgPath(svgAll, o);
        }
      }
    }

    for (const c of fp.children) {
      if (!c.localName.includes('.')) await renderEl(c, IDENT, 1);
    }
  }
  return doc;
}

export function isXpsFile(file) {
  return /\.(xps|oxps)$/i.test(file?.name || '') || /xps/i.test(file?.type || '');
}
