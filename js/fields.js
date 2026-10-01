/**
 * Geräte Laufzettel field templates (geometry + capabilities).
 * Template key from DE-{article}-… in filename / PDF header / settings override.
 */

export const KNOWN_TEMPLATES = [
  { id: '200.420', label: '200.420', dataUrl: '../data/template-200.420.json' },
  { id: '200.433', label: '200.433', dataUrl: '../data/template-200.433.json' },
  { id: '200.483', label: '200.483', dataUrl: '../data/template-200.483.json' },
];

export const FIELD_HIGHLIGHT = {
  fill: '#ADD8E6',
  alpha: 0.59,
};

const DE_ARTICLE_RE = /\bDE-(\d{1,4}\.\d{1,4})\b/i;
const ARTICLE_LOOSE_RE = /\b(\d{1,4}\.\d{1,4})\b/;

/** @type {Map<string, object>} */
const templateCache = new Map();

export function extractArticleKey(text) {
  const s = String(text || '');
  const m = s.match(DE_ARTICLE_RE);
  if (m) return m[1];
  // FB-200.433-V1 style
  const fb = s.match(/\bFB-(\d{1,4}\.\d{1,4})\b/i);
  if (fb) return fb[1];
  return '';
}

export function extractArticleFromFilename(name) {
  return extractArticleKey(name || '');
}

/**
 * Resolve active template id.
 * @param {{ filename?: string, pdfText?: string, settings?: { fieldTemplateId?: string } }} opts
 */
export function resolveTemplateId(opts = {}) {
  const settings = opts.settings || {};
  const override = String(settings.fieldTemplateId || '').trim();
  if (override && override !== 'auto') return override;

  const fromFile = extractArticleFromFilename(opts.filename);
  if (fromFile && KNOWN_TEMPLATES.some((t) => t.id === fromFile)) return fromFile;

  const fromText = extractArticleKey(opts.pdfText || '');
  if (fromText && KNOWN_TEMPLATES.some((t) => t.id === fromText)) return fromText;

  // Auto fallback: only known template for now
  if (KNOWN_TEMPLATES.length === 1) return KNOWN_TEMPLATES[0].id;
  return fromText || fromFile || KNOWN_TEMPLATES[0]?.id || '';
}

export async function loadTemplate(templateId) {
  const id = String(templateId || '').trim();
  if (!id) return null;
  if (templateCache.has(id)) return templateCache.get(id);
  const meta = KNOWN_TEMPLATES.find((t) => t.id === id);
  if (!meta) return null;
  const url = new URL(meta.dataUrl, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Template ${id} nicht ladbar (${res.status})`);
  const data = await res.json();
  templateCache.set(id, data);
  return data;
}

export function fieldKey(page, number) {
  return `${page}:${number}`;
}

/** 1-based PDF page → fields (page index 0-based in fill.js). */
export function fieldsForPage(template, pageIndex0) {
  if (!template?.pages) return [];
  const page = pageIndex0 + 1;
  const block = template.pages[String(page)] || template.pages[page];
  return block?.fields || [];
}

/** rect_pt [x0,y0,x1,y1] top-left → CSS % for hit layer (optional content crop). */
export function rectCssPercent(rect, pageWidth, pageHeight, crop = null) {
  const [x0, y0, x1, y1] = rect;
  const l = crop?.left || 0;
  const t = crop?.top || 0;
  const w = crop?.width || pageWidth;
  const h = crop?.height || pageHeight;
  return {
    left: ((x0 - l) / w) * 100,
    top: ((y0 - t) / h) * 100,
    width: ((x1 - x0) / w) * 100,
    height: ((y1 - y0) / h) * 100,
  };
}

/** Draw semi-transparent blue highlights (UI only). */
export function drawFieldHighlights(ctx, fields, scaleX, scaleY) {
  ctx.save();
  ctx.fillStyle = FIELD_HIGHLIGHT.fill;
  ctx.globalAlpha = FIELD_HIGHLIGHT.alpha;
  for (const f of fields) {
    const [x0, y0, x1, y1] = f.rect_pt;
    ctx.fillRect(x0 * scaleX, y0 * scaleY, (x1 - x0) * scaleX, (y1 - y0) * scaleY);
  }
  ctx.restore();
}

/**
 * Fit + center text in a field rect (canvas, top-left origin).
 */
export function drawCenteredFieldText(ctx, text, rect, colorCss, scaleX, scaleY) {
  if (!text) return;
  const [x0, y0, x1, y1] = rect;
  const ix = x0 * scaleX;
  const iy = y0 * scaleY;
  const iw = (x1 - x0) * scaleX;
  const ih = (y1 - y0) * scaleY;
  if (iw < 1 || ih < 1) return;

  const pad = Math.max(1, Math.min(iw, ih) * 0.08);
  const maxW = Math.max(2, iw - pad * 2);
  const maxH = Math.max(2, ih - pad * 2);
  let size = Math.min(maxH * 0.85, 28);
  ctx.save();
  ctx.fillStyle = colorCss || 'rgb(20,51,140)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  while (size > 5) {
    ctx.font = `400 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    if (ctx.measureText(text).width <= maxW) break;
    size -= 0.5;
  }
  ctx.fillText(String(text), ix + iw / 2, iy + ih / 2 + size * 0.04, maxW);
  ctx.restore();
}

/**
 * Initials stamp with colored Umrandung (stroke box), matching fill.js stamp style.
 * Canvas top-left origin; rect_pt is PDF top-left.
 */
export function drawInitialsStampInRect(ctx, text, rect, colorCss, scaleX, scaleY) {
  if (!text) return;
  const [x0, y0, x1, y1] = rect;
  const ix = x0 * scaleX;
  const iy = y0 * scaleY;
  const iw = (x1 - x0) * scaleX;
  const ih = (y1 - y0) * scaleY;
  if (iw < 1 || ih < 1) return;

  const color = colorCss || 'rgb(20,51,140)';
  const inset = Math.max(0.6, Math.min(iw, ih) * 0.06);
  const cx = ix + iw / 2;
  const cy = iy + ih / 2;

  ctx.save();
  // Light plate so outline stays readable over blue highlight
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(ix + inset * 0.35, iy + inset * 0.35, iw - inset * 0.7, ih - inset * 0.7);

  const maxW = Math.max(2, iw - inset * 2);
  const maxH = Math.max(2, ih - inset * 2);
  let size = Math.min(maxH * 0.72, 22);
  ctx.font = `700 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let tw = ctx.measureText(String(text)).width;
  while (size > 5 && tw > maxW * 0.78) {
    size -= 0.35;
    ctx.font = `700 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    tw = ctx.measureText(String(text)).width;
  }

  const padX = Math.max(3, size * 0.32);
  const padY = Math.max(1.6, size * 0.18);
  let boxW = Math.min(maxW, tw + padX * 2);
  let boxH = Math.min(maxH, size + padY * 2);
  // Keep a clear outline even in short cells
  boxH = Math.max(boxH, Math.min(maxH, size * 1.15));
  const bx = cx - boxW / 2;
  const by = cy - boxH / 2;

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.1, Math.min(2.2, size * 0.12));
  ctx.strokeRect(bx, by, boxW, boxH);

  ctx.fillStyle = color;
  ctx.fillText(String(text), cx, cy + size * 0.04, maxW);
  ctx.restore();
}

/** Dialog title: prefer template label; SN rows use prefix „SN“ + full left designation. */
/** Short dialog title: „SN Endstufe“ from „… BG Endstufe …“ (first word after BG). */
/** „ATTINY.hex“ from „… BDA1300_LDS-ATTINY.hex“. */
export function hexDialogLabel(label) {
  const s = String(label || '');
  const m = s.match(/([A-Za-z][A-Za-z0-9]*)\.hex\b/i);
  return m ? `${m[1]}.hex` : '';
}

export function shortSnHintLabel(label) {
  const s = String(label || '').trim();
  if (!s) return '';
  const bg = s.match(/\bBG\s+(\S+)/i);
  if (bg) return `SN ${bg[1]}`;
  const art = s.match(/^(?:SN\s+)?(?:\d{2,3}\.\d{3}\s+)?(\S+)/i);
  if (art && art[1].toUpperCase() !== 'SN') return `SN ${art[1]}`;
  if (/^Seriennummer\b/i.test(s)) {
    return shortSnHintLabel(s.replace(/^Seriennummer\b/i, 'SN'));
  }
  return s;
}

export function fieldDialogTitle(field, fallback = 'Eingabe') {
  const label = String(field?.label || '').trim();
  if (label) {
    const hex = hexDialogLabel(label);
    if (hex) return hex;
    // Legacy labels „Seriennummer …“ → „SN …“
    if (/^Seriennummer\b/i.test(label)) {
      return shortSnHintLabel(label.replace(/^Seriennummer\b/i, 'SN').replace(/^SN\s+SN\b/, 'SN'));
    }
    // Scannable BG cells: never show full Baugruppe name on screen
    if (field?.type === 'scan_or_manual' || /\bBG\b/i.test(label) || /^SN\s+\d{2,3}\.\d{3}\b/i.test(label)) {
      return shortSnHintLabel(label);
    }
    return label;
  }
  const left = String(field?.left_ref || '').trim();
  if (left) {
    const isSn =
      String(field?.id || '').startsWith('sn_') ||
      field?.type === 'scan_or_manual' ||
      /^\d{2,3}\.\d{3}\b/.test(left);
    if (isSn) return left.startsWith('SN ') ? left : `SN ${left}`;
    return left;
  }
  return fallback;
}

/** DD.MM.YY in Europe/Berlin. */
export function todayStampDateYY(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

export function normalizeStampDateYY(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  // Accept DD.MM. or DD.MM.YY / DD.MM.YYYY
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?\.?$/);
  if (!m) return s.endsWith('.') ? s.slice(0, -1) : s;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  let yy = m[3] || '';
  if (yy.length === 4) yy = yy.slice(2);
  if (!yy) {
    // If only DD.MM. given, append current year
    yy = todayStampDateYY().slice(-2);
  }
  return `${dd}.${mm}.${yy}`;
}

export function stampDateForSettings(settings) {
  const override = settings?.dateOverride ? String(settings.dateOverride).trim() : '';
  if (override) return normalizeStampDateYY(override);
  return todayStampDateYY();
}

export function stampInitialsForSettings(settings) {
  return String(settings?.initials || '').trim();
}

export function stampLagerClerkForSettings(settings) {
  const t = String(settings?.sachbearbeiterLager || '').trim();
  return t || 'Adina';
}
