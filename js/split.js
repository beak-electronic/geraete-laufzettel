/**
 * PDF Zerteiler – parse split field, chunk ranges, name extraction, zip build.
 * Pure-ish helpers; pdf.js / pdf-lib / JSZip come from the caller (browser or node test).
 */

import { readLogFromPdfJs, attachLogToPdfLib, derivedLog } from './protokoll.js?v=1.60';
import { readFeldwerteFromPdfJs, attachFeldwerteToPdfLib, feldwerteForPageRange } from './feldwerte.js?v=1.60';

/** @typedef {{ start: number, end: number }} PageRange  1-based inclusive */

const ID_RE = /DE-\d{1,4}\.\d{1,4}-[A-Z0-9]+/i;
/** Seite 1 von 3 / Seite 1/3 / Page 1 of 3 */
const PAGE_MARKER_RE =
  /(?:Seite|Blatt|Page)\s*(\d{1,4})\s*(?:von|of|\/)\s*(\d{1,4})/i;

/**
 * Whether the split field means automatic cut detection.
 * @param {string} raw
 */
export function isAutoSplitField(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return true;
  return /^(automatisch|auto|automatic)$/i.test(text);
}

/**
 * „Entfernen“ field means automatic removal (Caution pages): empty or „Automatisch“.
 * @param {string} raw
 */
export function isAutoRemoveField(raw) {
  return isAutoSplitField(raw);
}

/**
 * Parse „Entfernen von Seite(n)“ field → pages to discard after each part.
 * Empty / 0 / „Keine Seite(n) entfernen“ (and similar) → 0.
 * @param {string|number} raw
 * @returns {number}
 */
export function parseRemoveField(raw) {
  const text = String(raw ?? '').trim();
  if (!text || isAutoRemoveField(text)) return 0;
  // Accept „Keine“, „Keine Seite(n) entfernen“, „0“, etc.
  const normalized = text
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    /^(keine?( seite n?)?( entfernen)?|nichts|none|no|leer|0|-)$/i.test(
      normalized
    ) ||
    /^keine seiten? entfernen$/i.test(normalized)
  ) {
    return 0;
  }
  if (!/^\d+$/.test(text)) {
    throw new Error(
      'Ungültige Entfernen-Angabe – Automatisch, Zahl oder „Keine“'
    );
  }
  const n = parseInt(text, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Zu entfernende Seiten müssen ≥ 0 sein');
  }
  return n;
}

/**
 * Build page ranges from cut-after pages, optionally discarding M pages
 * after each cut before the next part starts.
 * @param {number[]} cuts  1-based cut-after pages (sorted unique, each < pageCount)
 * @param {number} pageCount
 * @param {number} [removeCount=0]
 * @returns {PageRange[]}
 */
export function rangesFromCuts(cuts, pageCount, removeCount = 0) {
  const n = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (n < 1) throw new Error('PDF hat keine Seiten');
  const m = Math.max(0, Math.floor(Number(removeCount) || 0));
  const sorted = [...new Set(
    (cuts || [])
      .map((x) => Math.floor(Number(x)))
      .filter((x) => Number.isFinite(x) && x >= 1 && x < n)
  )].sort((a, b) => a - b);

  if (!sorted.length) {
    return [{ start: 1, end: n }];
  }

  const ranges = [];
  let prev = 0; // last consumed page (kept or discarded)
  for (const cut of sorted) {
    const start = prev + 1;
    if (start > n) break;
    if (start > cut) {
      // Cut fell inside a discard zone – skip it
      continue;
    }
    ranges.push({ start, end: cut });
    prev = cut + m;
  }
  if (prev < n) {
    const start = prev + 1;
    if (start <= n) ranges.push({ start, end: n });
  }
  if (!ranges.length) {
    return [{ start: 1, end: n }];
  }
  return ranges;
}

/**
 * Fixed-count split: keep `step` pages, discard `removeCount`, repeat.
 * @param {number} step
 * @param {number} pageCount
 * @param {number} [removeCount=0]
 * @returns {PageRange[]}
 */
export function rangesEveryN(step, pageCount, removeCount = 0) {
  const n = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (n < 1) throw new Error('PDF hat keine Seiten');
  const keep = Math.floor(Number(step));
  if (!Number.isFinite(keep) || keep < 1) {
    throw new Error('Seitenanzahl muss ≥ 1 sein');
  }
  const m = Math.max(0, Math.floor(Number(removeCount) || 0));
  const ranges = [];
  let start = 1;
  while (start <= n) {
    const end = Math.min(start + keep - 1, n);
    ranges.push({ start, end });
    start = end + 1 + m;
  }
  return ranges;
}

/**
 * Parse „Teilen nach Seite(n)“ field (manual modes only).
 * - single integer N → every N pages (optionally discard M between parts)
 * - comma/space list of 1-based page numbers → split *after* those pages
 *   (with removeCount: skip M pages after each cut before the next part)
 * @param {string} raw
 * @param {number} pageCount
 * @param {number} [removeCount=0]
 * @returns {PageRange[]}
 */
export function parseSplitField(raw, pageCount, removeCount = 0) {
  const n = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (n < 1) throw new Error('PDF hat keine Seiten');

  if (isAutoSplitField(raw)) {
    throw new Error('Intern: Auto-Modus nicht über parseSplitField');
  }

  const text = String(raw ?? '').trim();
  const effective = text;
  const m = Math.max(0, Math.floor(Number(removeCount) || 0));

  // List of cut-after pages? (contains comma or multiple tokens)
  const listParts = effective
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const looksLikeList =
    /[,;]/.test(effective) ||
    (listParts.length > 1 && listParts.every((p) => /^\d+$/.test(p)));

  if (looksLikeList) {
    const cuts = listParts
      .map((p) => parseInt(p, 10))
      .filter((x) => Number.isFinite(x) && x >= 1 && x < n);
    return rangesFromCuts(cuts, n, m);
  }

  // Single integer N = every N pages (optionally discard M between parts)
  if (!/^\d+$/.test(effective)) {
    throw new Error('Ungültige Angabe – Automatisch, Zahl oder Liste wie 3,6,9');
  }
  const step = parseInt(effective, 10);
  return rangesEveryN(step, n, m);
}

/**
 * Extract "Seite X von Y" from pdf.js text items (prefer top-right).
 * @param {Array<{str?: string, transform?: number[]}>} items
 * @param {{width?: number, height?: number}} [viewport]
 * @returns {{ current: number, total: number } | null}
 */
export function extractPageMarkerFromTextItems(items, viewport) {
  const list = (items || []).filter((it) => it && String(it.str || '').length);
  if (!list.length) return null;

  const pageW = viewport?.width || 0;
  const pageH = viewport?.height || 0;
  const yMin = pageH ? pageH * 0.65 : null;
  const xMin = pageW ? pageW * 0.55 : null;

  /** @type {{ current: number, total: number, score: number }[]} */
  const hits = [];

  const consider = (str, x, y) => {
    const m = String(str || '').match(PAGE_MARKER_RE);
    if (!m) return;
    const current = parseInt(m[1], 10);
    const total = parseInt(m[2], 10);
    if (!Number.isFinite(current) || !Number.isFinite(total)) return;
    if (current < 1 || total < 1 || current > total) return;
    let score = y * 2 + x;
    if (yMin != null && y >= yMin) score += 10000;
    if (xMin != null && x >= xMin) score += 5000;
    hits.push({ current, total, score });
  };

  for (const it of list) {
    consider(
      it.str,
      it.transform?.[4] ?? 0,
      it.transform?.[5] ?? 0
    );
  }

  if (!hits.length) {
    // Join nearby top-right scraps (markers often split across text runs)
    const sorted = [...list].sort((a, b) => {
      const ay = a.transform?.[5] ?? 0;
      const by = b.transform?.[5] ?? 0;
      const ax = a.transform?.[4] ?? 0;
      const bx = b.transform?.[4] ?? 0;
      if (Math.abs(by - ay) > 2) return by - ay;
      return bx - ax;
    });
    const top = sorted.slice(0, 50).map((it) => String(it.str || '')).join(' ');
    const m = top.match(PAGE_MARKER_RE);
    if (m) {
      const current = parseInt(m[1], 10);
      const total = parseInt(m[2], 10);
      if (
        Number.isFinite(current) &&
        Number.isFinite(total) &&
        current >= 1 &&
        total >= 1 &&
        current <= total
      ) {
        return { current, total };
      }
    }
    // Also try full-page join (reading order)
    const all = [...list]
      .sort((a, b) => {
        const ay = a.transform?.[5] ?? 0;
        const by = b.transform?.[5] ?? 0;
        const ax = a.transform?.[4] ?? 0;
        const bx = b.transform?.[4] ?? 0;
        if (Math.abs(by - ay) > 3) return by - ay;
        return ax - bx;
      })
      .map((it) => String(it.str || ''))
      .join(' ');
    const m2 = all.match(PAGE_MARKER_RE);
    if (m2) {
      const current = parseInt(m2[1], 10);
      const total = parseInt(m2[2], 10);
      if (
        Number.isFinite(current) &&
        Number.isFinite(total) &&
        current >= 1 &&
        total >= 1 &&
        current <= total
      ) {
        return { current, total };
      }
    }
    return null;
  }

  hits.sort((a, b) => b.score - a.score);
  return { current: hits[0].current, total: hits[0].total };
}

/**
 * Build ranges by cutting after pages where marker says Seite X von X
 * (last page of a logical document).
 * @param {Array<{ current: number, total: number } | null>} markers 1-based page index
 * @param {number} pageCount
 * @returns {PageRange[]}
 */
export function rangesFromPageMarkers(markers, pageCount, removeCount = 0) {
  const n = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (n < 1) throw new Error('PDF hat keine Seiten');
  const discard = Math.max(0, Math.floor(Number(removeCount) || 0));

  /** @type {number[]} */
  const cuts = [];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (!marker) continue;
    if (marker.current === marker.total && marker.total >= 1) {
      const page = i + 1; // 1-based PDF page
      if (page >= 1 && page < n) cuts.push(page);
      // if last page of PDF is also last page of a doc, no cut needed after it
    }
  }

  const unique = [...new Set(cuts)].sort((a, b) => a - b);
  if (!unique.length) {
    if (n === 1) return [{ start: 1, end: 1 }];
    throw new Error(
      'Keine „Seite X von Y“-Markierungen gefunden – Zahl eintragen oder PDF prüfen'
    );
  }

  return rangesFromCuts(unique, n, discard);
}

/**
 * Detect a "Caution" cover/label page: the word CAUTION as large text,
 * horizontally centred near the top of the page.
 * @param {Array<{str?: string, transform?: number[], width?: number, height?: number}>} items
 * @param {{width?: number, height?: number}} viewport
 * @returns {boolean}
 */
export function isCautionPageFromTextItems(items, viewport) {
  const W = viewport?.width || 595;
  const H = viewport?.height || 842;
  for (const it of items || []) {
    const str = String(it?.str || '').trim();
    if (!/^caution[!:.]?$/i.test(str)) continue;
    const t = it.transform || [];
    const size = Math.max(Math.abs(t[3] || 0), Math.abs(t[0] || 0), it.height || 0);
    const x = t[4] ?? 0;
    const y = t[5] ?? 0; // PDF space: baseline from bottom
    const w = it.width || size * str.length * 0.6;
    const cx = x + w / 2;
    if (size >= 16 && y >= H * 0.8 && Math.abs(cx - W / 2) <= W * 0.2) return true;
  }
  return false;
}

/**
 * Remove given pages from ranges; a removed page inside a range splits it.
 * @param {PageRange[]} ranges
 * @param {Set<number>} drop 1-based pages
 * @returns {PageRange[]}
 */
export function dropPagesFromRanges(ranges, drop) {
  if (!drop || !drop.size) return ranges;
  const out = [];
  for (const { start, end } of ranges) {
    let s = null;
    for (let p = start; p <= end; p++) {
      if (drop.has(p)) {
        if (s != null) out.push({ start: s, end: p - 1 });
        s = null;
      } else if (s == null) s = p;
    }
    if (s != null) out.push({ start: s, end });
  }
  return out;
}

/** @returns {Promise<number[]>} 1-based Caution pages */
export async function findCautionPages(pdf, onStatus) {
  const found = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    onStatus?.(`Caution-Seiten prüfen ${p}/${pdf.numPages}…`, 'busy');
    try {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      if (isCautionPageFromTextItems(tc.items || [], { width: vp.width, height: vp.height })) found.push(p);
    } catch (_) {}
  }
  return found;
}

/**
 * Resolve split ranges: auto (Seite X von Y) or manual field.
 * @param {*} pdf pdf.js PDFDocumentProxy
 * @param {string} splitField
 * @param {(msg: string, kind?: string) => void} [onStatus]
 * @returns {Promise<PageRange[]>}
 */
export async function resolveSplitRanges(
  pdf,
  splitField,
  onStatus,
  removeCount = 0,
  autoCaution = true
) {
  const pageCount = pdf.numPages;
  const m = Math.max(0, Math.floor(Number(removeCount) || 0));
  if (isAutoSplitField(splitField)) {
    onStatus?.('Automatisch: Seitenmarkierungen lesen…', 'busy');
    /** @type {Array<{current:number,total:number}|null>} */
    const markers = [];
    for (let p = 1; p <= pageCount; p++) {
      onStatus?.(
        `Markierung Seite ${p}/${pageCount}…`,
        'busy'
      );
      try {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        markers.push(
          extractPageMarkerFromTextItems(tc.items || [], {
            width: viewport.width,
            height: viewport.height,
          })
        );
      } catch (_) {
        markers.push(null);
      }
    }
    const caution = autoCaution ? await findCautionPages(pdf, onStatus) : [];
    let ranges;
    try {
      ranges = rangesFromPageMarkers(markers, pageCount, m);
    } catch (err) {
      if (!caution.length) throw err;
      ranges = [{ start: 1, end: pageCount }]; // split only at Caution pages
    }
    ranges = dropPagesFromRanges(ranges, new Set(caution));
    ranges.cautionPages = caution;
    const discardNote =
      m > 0 ? ` (je ${m} Seite(n) nach Teil übersprungen)` : '';
    onStatus?.(
      `Automatisch: ${ranges.length} Teil(e) erkannt${discardNote}…`,
      'busy'
    );
    return ranges;
  }
  const caution = autoCaution ? await findCautionPages(pdf, onStatus) : [];
  const ranges = dropPagesFromRanges(parseSplitField(splitField, pageCount, m), new Set(caution));
  ranges.cautionPages = caution;
  return ranges;
}

/**
 * Sanitize for filesystem filename (no extension).
 * @param {string} name
 */
export function sanitizeFilename(name) {
  let s = String(name || '')
    .normalize('NFKC')
    .replace(/[\/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  if (!s) s = 'teil';
  if (s.length > 120) s = s.slice(0, 120);
  return s;
}

/**
 * Prefer text items high on the page (large y in PDF space) and far right (large x).
 * @param {Array<{str?: string, transform?: number[]}>} items
 * @param {{width?: number, height?: number}} [viewport]
 * @returns {string|null}
 */
export function extractIdFromTextItems(items, viewport) {
  const list = (items || []).filter((it) => it && String(it.str || '').length);
  if (!list.length) return null;

  const pageW = viewport?.width || 0;
  const pageH = viewport?.height || 0;
  const yMin = pageH ? pageH * 0.65 : null;
  const xMin = pageW ? pageW * 0.55 : null;

  /** @type {{id: string, x: number, y: number, score: number}[]} */
  const hits = [];

  for (const it of list) {
    const str = String(it.str || '');
    const m = str.match(ID_RE);
    if (!m) continue;
    const id = m[0].toUpperCase().replace(/^DE-/i, 'DE-');
    const normalized = id.replace(/^de-/i, 'DE-');
    const x = it.transform?.[4] ?? 0;
    const y = it.transform?.[5] ?? 0;
    let score = y * 2 + x;
    if (yMin != null && y >= yMin) score += 10000;
    if (xMin != null && x >= xMin) score += 5000;
    hits.push({ id: normalized, x, y, score });
  }

  if (!hits.length) {
    const sorted = [...list].sort((a, b) => {
      const ay = a.transform?.[5] ?? 0;
      const by = b.transform?.[5] ?? 0;
      const ax = a.transform?.[4] ?? 0;
      const bx = b.transform?.[4] ?? 0;
      if (Math.abs(by - ay) > 2) return by - ay;
      return bx - ax;
    });
    const top = sorted.slice(0, 40).map((it) => String(it.str || '')).join(' ');
    const m = top.match(ID_RE);
    if (m) {
      return m[0].replace(/^de-/i, 'DE-');
    }
    return null;
  }

  hits.sort((a, b) => b.score - a.score);
  return hits[0].id;
}

/**
 * Build unique filenames for chunks (with .pdf).
 * @param {(string|null)[]} ids  raw IDs per chunk (or null)
 * @returns {string[]}
 */
export function uniqueFilenames(ids) {
  const pad = String(Math.max(ids.length, 1)).length;
  const used = new Map();
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    let base = ids[i] ? sanitizeFilename(ids[i]) : null;
    if (!base) {
      base = String(i + 1).padStart(Math.max(2, pad), '0');
    }
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    const name = count === 0 ? `${base}.pdf` : `${base}-${count + 1}.pdf`;
    out.push(name);
  }
  return out;
}

/**
 * Extract device ID from first page of a range using pdf.js document.
 * @param {*} pdf  pdf.js PDFDocumentProxy
 * @param {number} pageNumber 1-based
 */
export async function extractIdFromPage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return extractIdFromTextItems(tc.items || [], {
    width: viewport.width,
    height: viewport.height,
  });
}

/**
 * Copy page ranges into separate PDF bytes with pdf-lib.
 * @param {Uint8Array} srcBytes
 * @param {PageRange[]} ranges
 * @param {*} PDFLib  window.PDFLib
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<Uint8Array[]>}
 */
export async function splitPdfBytes(srcBytes, ranges, PDFLib, onProgress, logOpts = null) {
  const { PDFDocument } = PDFLib;
  const src = await PDFDocument.load(srcBytes.slice());
  const out = [];
  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i];
    onProgress?.(`Teil ${i + 1}/${ranges.length}: Seiten ${start}–${end}…`);
    const doc = await PDFDocument.create();
    const indices = [];
    for (let p = start; p <= end; p++) indices.push(p - 1);
    const pages = await doc.copyPages(src, indices);
    for (const pg of pages) doc.addPage(pg);
    // Änderungsprotokoll der Quelle (falls vorhanden) in jeden Teil übernehmen.
    if (logOpts?.log) {
      const name = logOpts.filenames?.[i] || `Teil ${i + 1}`;
      await attachLogToPdfLib(doc, derivedLog([logOpts.log], {
        kind: 'split',
        action: 'split',
        fileName: name,
        details: { source_file: logOpts.originalName || '', source_pages: `${start}-${end}` },
      }), PDFLib);
    }
    // Gespeicherte Feldwerte der Quelle: nur die Seiten dieses Teils, neu nummeriert ab 1.
    const fw = feldwerteForPageRange(logOpts?.feldwerte, start, end);
    if (fw) await attachFeldwerteToPdfLib(doc, fw, PDFLib);
    const bytes = await doc.save();
    out.push(bytes);
  }
  return out;
}

/**
 * Full pipeline: parse → extract names → split → zip.
 * @param {object} opts
 * @param {Uint8Array} opts.pdfBytes
 * @param {string} opts.splitField
 * @param {string} [opts.removeField]
 * @param {number} [opts.removeCount]
 * @param {string} opts.originalName
 * @param {*} opts.pdfjsLib
 * @param {*} opts.PDFLib
 * @param {*} opts.JSZip
 * @param {(msg: string, kind?: string) => void} [opts.onStatus]
 * @returns {Promise<{ zipBlob: Blob, zipName: string, filenames: string[], ranges: PageRange[] }>}
 */
export async function buildSplitZip(opts) {
  const {
    pdfBytes,
    splitField,
    removeField,
    removeCount: removeCountOpt,
    originalName,
    pdfjsLib,
    PDFLib,
    JSZip,
    onStatus,
  } = opts;

  onStatus?.('PDF wird gelesen…', 'busy');
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;

  const removeCount =
    removeCountOpt != null
      ? Math.max(0, Math.floor(Number(removeCountOpt) || 0))
      : parseRemoveField(removeField ?? '');
  // Automatisch (Standard): Caution-Seiten entfernen; Zahl/„Keine“ überschreibt das.
  const autoCaution = removeCountOpt == null && isAutoRemoveField(removeField ?? '');
  const ranges = await resolveSplitRanges(
    pdf,
    splitField,
    onStatus,
    removeCount,
    autoCaution
  );
  const cautionPages = ranges.cautionPages || [];
  if (!ranges.length) throw new Error('Nach Entfernen der Caution-Seiten bleibt keine Seite übrig');
  onStatus?.(`${ranges.length} Teil(e) aus ${pageCount} Seiten…`, 'busy');

  const ids = [];
  for (let i = 0; i < ranges.length; i++) {
    onStatus?.(
      `Name aus Seite ${ranges[i].start} lesen (${i + 1}/${ranges.length})…`,
      'busy'
    );
    try {
      const id = await extractIdFromPage(pdf, ranges[i].start);
      ids.push(id);
    } catch (_) {
      ids.push(null);
    }
  }
  const { log: srcLog } = await readLogFromPdfJs(pdf);
  const srcFeldwerte = await readFeldwerteFromPdfJs(pdf);
  try {
    await pdf.destroy?.();
  } catch (_) {}

  const filenames = uniqueFilenames(ids);
  const parts = await splitPdfBytes(pdfBytes, ranges, PDFLib, (m) =>
    onStatus?.(m, 'busy'),
    srcLog || srcFeldwerte ? { log: srcLog, feldwerte: srcFeldwerte, filenames, originalName } : null
  );

  onStatus?.('ZIP wird erzeugt…', 'busy');
  const zip = new JSZip();
  for (let i = 0; i < parts.length; i++) {
    zip.file(filenames[i], parts[i]);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const stem = String(originalName || 'dokument').replace(/\.pdf$/i, '') || 'dokument';
  const zipName = `${sanitizeFilename(stem)}_geteilt.zip`;

  onStatus?.(
    `${filenames.length} PDF(s) in ${zipName}`,
    'ok'
  );
  return { zipBlob, zipName, filenames, ranges, ids, cautionPages, parts };
}
