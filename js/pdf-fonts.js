/**
 * PDF text fonts: Helvetica (WinAnsi) for normal text, Liberation Sans (Unicode,
 * subset via @pdf-lib/fontkit) when a string needs Greek / Ohm / similar symbols.
 *
 * Decision: keep Helvetica for WinAnsi-only text so everyday German labels look
 * identical to previous releases; switch only the strings that need it.
 *
 * Safety: characters neither font can encode become '?' with a console warning —
 * Sichern must never fail because of an unknown character.
 */

const REG_URL = new URL('../fonts/LiberationSans-Regular.ttf', import.meta.url).href;
const BOLD_URL = new URL('../fonts/LiberationSans-Bold.ttf', import.meta.url).href;

/** @type {{ reg: ArrayBuffer | null, bold: ArrayBuffer | null }} */
const bytesCache = { reg: null, bold: null };

function getPDFLib() {
  const L = typeof PDFLib !== 'undefined' ? PDFLib : globalThis.PDFLib;
  if (!L) throw new Error('PDFLib fehlt');
  return L;
}

async function fetchFontBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Unicode-Schrift nicht ladbar (${res.status}): ${url}`);
  return res.arrayBuffer();
}

export async function loadUnicodeFontBytes() {
  if (!bytesCache.reg) bytesCache.reg = await fetchFontBytes(REG_URL);
  if (!bytesCache.bold) bytesCache.bold = await fetchFontBytes(BOLD_URL);
  // Fresh copies: embedFont may detach/transfer the buffer.
  return { reg: bytesCache.reg.slice(0), bold: bytesCache.bold.slice(0) };
}

export function registerFontkit(pdfDoc) {
  const fk = typeof fontkit !== 'undefined' ? fontkit : globalThis.fontkit;
  if (!fk) throw new Error('fontkit fehlt (vendor/fontkit.umd.min.js)');
  try {
    pdfDoc.registerFontkit(fk);
  } catch (_) {
    // already registered on this document
  }
}


/** @param {any} font */
function charSetOf(font) {
  try {
    const raw = font.getCharacterSet();
    if (!raw) return null;
    if (raw instanceof Set) return raw;
    if (typeof raw.has === 'function') return raw;
    return new Set(raw);
  } catch (_) {
    return null;
  }
}

/** True if Helvetica/WinAnsi cannot encode every character in `text`. */
export function needsUnicodeFont(winAnsiFont, text) {
  const s = String(text ?? '');
  if (!s) return false;
  const set = charSetOf(winAnsiFont);
  if (!set) return true;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 10 || cp === 13 || cp === 9) continue;
    if (!set.has(cp)) return true;
  }
  return false;
}

/**
 * Replace characters missing from `font` with '?'. Never throws.
 * @returns {{ text: string, replaced: boolean }}
 */
export function sanitizeForFont(font, text) {
  const s = String(text ?? '');
  const set = charSetOf(font);
  if (!set) {
    return { text: s.replace(/[^\t\n\r\x20-\x7e\xA0-\xFF]/g, '?'), replaced: true };
  }
  let out = '';
  let replaced = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 10 || cp === 13 || cp === 9) {
      out += ch;
      continue;
    }
    if (set.has(cp)) out += ch;
    else {
      out += '?';
      replaced = true;
    }
  }
  if (replaced) {
    console.warn('[pdf-fonts] Zeichen nicht in Schrift enthalten, durch „?“ ersetzt:', s);
  }
  return { text: out, replaced };
}

/**
 * Build a font bag for one PDFDocument.
 * Call `preloadFor(texts)` (or `ensureUnicode`) before drawing strings that may
 * contain special characters.
 */
export async function createPdfFontBag(pdfDoc) {
  const { StandardFonts } = getPDFLib();
  registerFontkit(pdfDoc);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  /** @type {any | null} */
  let unicode = null;
  /** @type {any | null} */
  let unicodeBold = null;

  const ensureUnicode = async () => {
    if (unicode && unicodeBold) return;
    const bufs = await loadUnicodeFontBytes();
    unicode = await pdfDoc.embedFont(bufs.reg, { subset: true });
    unicodeBold = await pdfDoc.embedFont(bufs.bold, { subset: true });
  };

  const pick = (text, bold = false) => {
    const base = bold ? helveticaBold : helvetica;
    if (!needsUnicodeFont(base, text)) return base;
    const u = bold ? unicodeBold : unicode;
    return u || base;
  };

  const prepare = (text, bold = false) => {
    const font = pick(text, bold);
    return { font, text: sanitizeForFont(font, text).text };
  };

  const widthOf = (text, size, bold = false) => {
    const { font, text: safe } = prepare(text, bold);
    try {
      return font.widthOfTextAtSize(safe, size);
    } catch (err) {
      console.warn('[pdf-fonts] widthOfTextAtSize failed', err);
      return Math.max(0, String(safe).length * size * 0.5);
    }
  };

  /** Safe drawText: never throws on encoding. */
  const drawText = (page, text, opts = {}, bold = false) => {
    const { font, text: safe } = prepare(text, bold);
    if (!safe) return;
    try {
      page.drawText(safe, { ...opts, font });
    } catch (err) {
      console.warn('[pdf-fonts] drawText failed, retrying sanitized', err);
      try {
        const again = sanitizeForFont(font, safe).text.replace(/[^\t\n\r\x20-\x7e\xA0-\xFF]/g, '?');
        if (again) page.drawText(again, { ...opts, font: bold ? helveticaBold : helvetica });
      } catch (err2) {
        console.warn('[pdf-fonts] drawText gave up', err2);
      }
    }
  };

  return {
    helvetica,
    helveticaBold,
    get unicode() {
      return unicode;
    },
    get unicodeBold() {
      return unicodeBold;
    },
    pick,
    prepare,
    widthOf,
    drawText,
    ensureUnicode,
    async preloadFor(texts) {
      const list = Array.isArray(texts) ? texts : [texts];
      for (const t of list) {
        if (needsUnicodeFont(helvetica, t) || needsUnicodeFont(helveticaBold, t)) {
          await ensureUnicode();
          return;
        }
      }
    },
  };
}
