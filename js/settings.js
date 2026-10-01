const LS_INITIALS = 'bg.initials';
const LS_COLOR = 'bg.colorIndex';
const LS_LAST_COL_DATE_ONLY = 'bg.lastColDateOnly';
const LS_FIELD_TEMPLATE = 'gl.fieldTemplateId';
const LS_LAGER_CLERK = 'gl.sachbearbeiterLager';
export const DEFAULT_LAGER_CLERK = 'Adina';

export const DARK_COLORS = [
  { r: 0.08, g: 0.2, b: 0.55 }, // navy (default)
  { r: 0.1, g: 0.1, b: 0.12 }, // near black
  { r: 0.45, g: 0.12, b: 0.12 }, // dark red
  { r: 0.12, g: 0.38, b: 0.22 }, // forest
  { r: 0.35, g: 0.18, b: 0.45 }, // purple
  { r: 0.45, g: 0.28, b: 0.08 }, // brown
  { r: 0.08, g: 0.35, b: 0.4 }, // teal
  { r: 0.25, g: 0.25, b: 0.28 }, // charcoal
];

/** Column index for „Baugruppe gebucht“ (last process column). */
export const LAST_COLUMN_INDEX = 7;

function clampIndex(i) {
  return Math.max(0, Math.min(DARK_COLORS.length - 1, i | 0));
}

export function loadSettings() {
  let initials = localStorage.getItem(LS_INITIALS);
  if (!initials || !initials.trim()) initials = 'TK';
  const colorIndex = clampIndex(parseInt(localStorage.getItem(LS_COLOR) || '0', 10));
  const lastColRaw = localStorage.getItem(LS_LAST_COL_DATE_ONLY);
  // Default ON (date only) when unset
  const lastColumnDateOnly = lastColRaw === null ? true : lastColRaw === '1' || lastColRaw === 'true';
  const fieldTemplateId = localStorage.getItem(LS_FIELD_TEMPLATE) || 'auto';
  let sachbearbeiterLager = localStorage.getItem(LS_LAGER_CLERK);
  if (!sachbearbeiterLager || !sachbearbeiterLager.trim()) sachbearbeiterLager = DEFAULT_LAGER_CLERK;
  return {
    initials,
    colorIndex,
    lastColumnDateOnly,
    /** @type {string} 'auto' or template id e.g. 200.433 */
    fieldTemplateId,
    /** @type {string} default name for Sachbearbeiter Lager */
    sachbearbeiterLager: sachbearbeiterLager.trim(),
    /** @type {string|null} document-only, not persisted — stamp date TT.MM.JJ */
    dateOverride: null,
  };
}

export function saveInitials(initials) {
  localStorage.setItem(LS_INITIALS, initials);
}

export function saveColorIndex(index) {
  localStorage.setItem(LS_COLOR, String(clampIndex(index)));
}

export function saveLastColumnDateOnly(on) {
  localStorage.setItem(LS_LAST_COL_DATE_ONLY, on ? '1' : '0');
}

export function saveFieldTemplateId(id) {
  localStorage.setItem(LS_FIELD_TEMPLATE, String(id || 'auto'));
}

export function saveSachbearbeiterLager(name) {
  const v = String(name || '').trim() || DEFAULT_LAGER_CLERK;
  localStorage.setItem(LS_LAGER_CLERK, v);
  return v;
}

export function lagerClerkName(settings) {
  const n = settings && settings.sachbearbeiterLager;
  const t = String(n || '').trim();
  return t || DEFAULT_LAGER_CLERK;
}

/** Legacy BG short date dd.MM. (no year). */
export function todayShortGerman(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.`;
}

/** Stamp date DD.MM.YY in Europe/Berlin (Geräte fields). */
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

/** Save-day suffix (dd.MM.yy) in Europe/Berlin. */
export function todaySaveSuffixGerman(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `(${get('day')}.${get('month')}.${get('year')})`;
}

/**
 * Append or replace German short date suffix before .pdf
 * e.g. "BG Endstufe 2718 V2.pdf" → "BG Endstufe 2718 V2 (13.09.26).pdf"
 */
export function withSaveDateSuffix(filename) {
  let name = String(filename || 'Laufzettel.pdf');
  if (!/\.pdf$/i.test(name)) name = `${name}.pdf`;
  const stem = name.replace(/\.pdf$/i, '');
  const cleaned = stem.replace(/\s*\(\d{2}\.\d{2}\.\d{2}\)\s*$/, '').trim();
  return `${cleaned} ${todaySaveSuffixGerman()}.pdf`;
}

/** Legacy normalize ending with '.' */
export function normalizeDateString(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!s.endsWith('.')) s += '.';
  return s;
}

/**
 * Live input mask: digits → TT.MM.JJ (max 6 digits).
 * @param {string} raw
 * @returns {string}
 */
export function formatStampDateMask(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/**
 * Attach auto-dot TT.MM.JJ mask to an <input>. Safe to call once per element.
 * @param {HTMLInputElement|null|undefined} input
 * @param {{active?: () => boolean}} [opts] If active() returns false, skip formatting.
 */
export function attachStampDateMask(input, opts = {}) {
  if (!input || input.dataset.stampDateMask === '1') return;
  input.dataset.stampDateMask = '1';
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('maxlength', '8');
  input.addEventListener('input', () => {
    try {
      if (typeof opts.active === 'function' && !opts.active()) return;
    } catch (_) {}
    const formatted = formatStampDateMask(input.value);
    if (formatted === input.value) return;
    input.value = formatted;
    try {
      const pos = formatted.length;
      input.setSelectionRange(pos, pos);
    } catch (_) {}
  });
}

/** Normalize to DD.MM.YY */
export function normalizeStampDateYY(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 6) {
    s = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  } else if (digits.length === 8) {
    // TTMMYYYY → TT.MM.YY
    s = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(6)}`;
  }
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?\.?$/);
  if (!m) {
    return formatStampDateMask(s) || s.replace(/\.+$/, '');
  }
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  let yy = m[3] || '';
  if (yy.length === 4) yy = yy.slice(2);
  if (!yy) yy = todayStampDateYY().slice(-2);
  return `${dd}.${mm}.${yy}`;
}

export function stampDateString(settings) {
  const override = settings.dateOverride ? String(settings.dateOverride).trim() : '';
  if (override) return normalizeStampDateYY(override);
  return todayStampDateYY();
}

export function colorCss(index) {
  const c = DARK_COLORS[clampIndex(index)];
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export function colorRgb01(index) {
  return DARK_COLORS[clampIndex(index)];
}
