/**
 * feldwerte.json — current field values stored invisibly in the PDF (embedded file).
 *
 * Once saved, values are baked into the page. This attachment remembers them so that a
 * re-opened PDF shows the fields as filled: the inline editor opens with the old text, and
 * only changed fields are white-covered and re-drawn on the next Sichern.
 * Written only by Sichern (and carried by Teilen/Verbinden); replaced on every save.
 * PDFs without the attachment behave as before.
 */
import { removeEmbeddedFiles, isoLocal, APP_VERSION } from './protokoll.js?v=1.57';

export const FELDWERTE_FILENAME = 'feldwerte.json';
export const FELDWERTE_FORMAT = 'geraete-laufzettel-feldwerte';
export const FELDWERTE_FORMAT_VERSION = 1;

const keyOf = (page, number) => `${page}:${number}`;

/** Normalise one stored row; returns null when unusable. */
function normRow(r) {
  if (!r || typeof r !== 'object') return null;
  const page = Number(r.page);
  const number = Number(r.number);
  const text = r.text == null ? '' : String(r.text);
  if (!Number.isInteger(page) || page < 1 || !Number.isFinite(number) || !text) return null;
  const out = { page, number, text };
  if (r.id != null) out.id = String(r.id);
  if (r.type != null) out.type = String(r.type);
  if (Number.isInteger(r.color_index)) out.color_index = r.color_index;
  if (r.template != null) out.template = String(r.template);
  return out;
}

/** @returns {object|null} validated data or null */
export function parseFeldwerte(data) {
  try {
    const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
    const j = JSON.parse(text);
    if (!j || j.format !== FELDWERTE_FORMAT || !Array.isArray(j.fields)) return null;
    return { ...j, fields: j.fields.map(normRow).filter(Boolean) };
  } catch (_) {
    return null;
  }
}

/**
 * Read feldwerte.json from a pdf.js document. Missing or unreadable → null (never throws).
 * @returns {Promise<object|null>}
 */
export async function readFeldwerteFromPdfJs(pdf) {
  try {
    const atts = (await pdf.getAttachments()) || {};
    for (const key of Object.keys(atts)) {
      const a = atts[key];
      const name = String(a?.filename || key || '');
      if (name.split(/[\\/]/).pop() !== FELDWERTE_FILENAME || !a?.content) continue;
      const data = parseFeldwerte(a.content);
      if (!data) console.warn('feldwerte.json nicht lesbar — wird ignoriert');
      return data;
    }
  } catch (err) {
    console.warn('feldwerte.json: Anhänge konnten nicht gelesen werden', err);
  }
  return null;
}

/** New container for the given rows. */
export function makeFeldwerte(rows, { template = '' } = {}) {
  const fields = [];
  const seen = new Set();
  for (const r of rows || []) {
    const n = normRow(r);
    if (!n) continue;
    const k = keyOf(n.page, n.number);
    if (seen.has(k)) continue; // first wins
    seen.add(k);
    fields.push(n);
  }
  fields.sort((a, b) => a.page - b.page || a.number - b.number);
  return {
    format: FELDWERTE_FORMAT,
    format_version: FELDWERTE_FORMAT_VERSION,
    template: template || null,
    updated: isoLocal(),
    app_version: APP_VERSION,
    fields,
  };
}

/**
 * Teilen: keep the rows of pages start..end, renumbered to 1..n. Rows of other pages are dropped.
 * @returns {object|null} null when nothing remains
 */
export function feldwerteForPageRange(data, start, end) {
  if (!data?.fields?.length) return null;
  const rows = data.fields
    .filter((r) => r.page >= start && r.page <= end)
    .map((r) => ({ ...r, page: r.page - start + 1 }));
  return rows.length ? makeFeldwerte(rows, { template: data.template || '' }) : null;
}

/**
 * Verbinden: inputs in output order with their page offset (pages before them in the output).
 * Page numbers are shifted; the template id is kept per row when inputs differ.
 * @param {{data:object|null, offset:number}[]} parts
 * @returns {object|null}
 */
export function mergeFeldwerte(parts) {
  const rows = [];
  const templates = new Set();
  for (const { data, offset } of parts || []) {
    if (!data?.fields?.length) continue;
    if (data.template) templates.add(data.template);
    for (const r of data.fields) {
      rows.push({ ...r, page: r.page + (offset || 0), ...(data.template && !r.template ? { template: data.template } : {}) });
    }
  }
  if (!rows.length) return null;
  const tpl = templates.size === 1 ? [...templates][0] : '';
  if (tpl) for (const r of rows) if (r.template === tpl) delete r.template;
  return makeFeldwerte(rows, { template: tpl });
}

/**
 * Replace (never duplicate) feldwerte.json in a pdf-lib document. data=null only removes it.
 * Never throws: on failure the PDF is saved without the attachment (console warning).
 * @returns {Promise<boolean>}
 */
export async function attachFeldwerteToPdfLib(pdfDoc, data, PDFLib = window.PDFLib) {
  try {
    removeEmbeddedFiles(pdfDoc, [FELDWERTE_FILENAME], PDFLib);
    if (!data?.fields?.length) return true;
    data.updated = isoLocal();
    const now = new Date();
    await pdfDoc.attach(new TextEncoder().encode(JSON.stringify(data, null, 1)), FELDWERTE_FILENAME, {
      mimeType: 'application/json',
      description: 'Feldwerte Geräte Laufzettel (zum Weiterbearbeiten)',
      creationDate: now,
      modificationDate: now,
    });
    return true;
  } catch (err) {
    console.warn('feldwerte.json konnte nicht angehängt werden — PDF wird ohne Feldwerte gespeichert', err);
    return false;
  }
}
