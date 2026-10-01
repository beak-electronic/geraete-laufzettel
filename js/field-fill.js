/**
 * Geräte field overlay UI + save helpers (blue highlights stay on screen only).
 */
import {
  fieldsForPage,
  fieldKey,
  rectCssPercent,
  drawFieldHighlights,
  drawCenteredFieldText,
  drawInitialsStampInRect,
  fieldDialogTitle,
  stampDateForSettings,
  stampInitialsForSettings,
  stampLagerClerkForSettings,
  normalizeStampDateYY,
} from './fields.js';
import { colorCss, colorRgb01 } from './settings.js';

const { rgb, StandardFonts } = PDFLib;

/**
 * @param {object} ctx
 * @param {Map<string,{text:string,colorIndex:number}>} ctx.fieldValues
 * @param {object|null} ctx.template
 * @param {object} ctx.settings
 * @param {(msg:string)=>void} ctx.showToast
 * @param {()=>void} ctx.openSettings
 * @param {(pageIndex:number)=>void} ctx.redrawPage
 * @param {(entry:object)=>void} ctx.pushUndo
 * @param {()=>Array} ctx.snapshotFieldKeys
 * @param {(snap:Array)=>void} ctx.restoreFieldSnapshot
 * @param {(opts:object)=>Promise<string|null>} ctx.promptFieldInput
 * @param {(opts:object)=>Promise<string|null>} ctx.scanIntoField
 * @param {()=>boolean} ctx.shouldIgnoreStampClick
 * @param {(e:Event)=>void} ctx.markPenStampSuppress
 * @param {(e:Event)=>boolean} ctx.isPenPointer
 */

export function syncFieldsLayer(wrap, elLayer) {
  const pageCanvas = wrap.querySelector('canvas.page-canvas');
  if (!pageCanvas || !elLayer) return null;
  elLayer.style.left = `${pageCanvas.offsetLeft}px`;
  elLayer.style.top = `${pageCanvas.offsetTop}px`;
  elLayer.style.width = `${pageCanvas.offsetWidth}px`;
  elLayer.style.height = `${pageCanvas.offsetHeight}px`;
  elLayer.style.right = 'auto';
  elLayer.style.bottom = 'auto';
  return pageCanvas;
}

export function drawGeraetePage(wrap, pageWidth, pageHeight, api) {
  const pageIndex = Number(wrap.dataset.pageIndex);
  const fieldsLayer = wrap.querySelector('canvas.fields-layer');
  const overlay = wrap.querySelector('canvas.overlay');
  const hit = wrap.querySelector('.hit-layer');
  const inkCanvas = wrap.querySelector('canvas.ink-canvas');

  syncFieldsLayer(wrap, fieldsLayer);
  syncFieldsLayer(wrap, overlay);
  syncFieldsLayer(wrap, hit);
  syncFieldsLayer(wrap, inkCanvas);

  const { cssW, cssH, scaleX, scaleY, crop } = api.pageScales(wrap, pageWidth, pageHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const needW = Math.max(1, Math.round(cssW * dpr));
  const needH = Math.max(1, Math.round(cssH * dpr));

  const fields = fieldsForPage(api.template, pageIndex);

  // Blue highlights under stamps/ink
  if (fieldsLayer) {
    if (fieldsLayer.width !== needW || fieldsLayer.height !== needH) {
      fieldsLayer.width = needW;
      fieldsLayer.height = needH;
    }
    const fctx = fieldsLayer.getContext('2d');
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fieldsLayer.width, fieldsLayer.height);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.translate(-crop.left * scaleX, -crop.top * scaleY);
    drawFieldHighlights(fctx, fields, scaleX, scaleY);
  }

  // Values on overlay (above blue)
  if (overlay) {
    if (overlay.width !== needW || overlay.height !== needH) {
      overlay.width = needW;
      overlay.height = needH;
    }
    const ctx = overlay.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(-crop.left * scaleX, -crop.top * scaleY);

    for (const f of fields) {
      const key = fieldKey(f.page, f.number);
      const val = api.fieldValues.get(key);
      if (!val?.text) continue;
      const color = colorCss(val.colorIndex ?? api.settings.colorIndex);
      const typ = val.type || f.type;
      if (typ === 'tap_initials_stamp') {
        drawInitialsStampInRect(ctx, val.text, f.rect_pt, color, scaleX, scaleY);
      } else {
        drawCenteredFieldText(ctx, val.text, f.rect_pt, color, scaleX, scaleY);
      }
    }
  }

  if (hit) {
    hit.innerHTML = '';
    for (const f of fields) {
      const key = fieldKey(f.page, f.number);
      const filled = api.fieldValues.has(key) && !!api.fieldValues.get(key)?.text;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = filled ? 'hit-cell hit-field filled' : 'hit-cell hit-field';
      btn.dataset.fieldKey = key;
      btn.setAttribute('aria-label', f.label || `Feld ${f.number}`);
      const pct = rectCssPercent(f.rect_pt, pageWidth, pageHeight, crop);
      btn.style.left = `${pct.left}%`;
      btn.style.top = `${pct.top}%`;
      btn.style.width = `${pct.width}%`;
      btn.style.height = `${pct.height}%`;
      btn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'pen' || api.isPenPointer(e)) {
          api.markPenStampSuppress();
          e.preventDefault();
          e.stopPropagation();
        }
      });
      btn.addEventListener('click', (e) => {
        if (api.shouldIgnoreStampClick(e)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onFieldTap(f, pageIndex, api);
      });
      hit.appendChild(btn);
    }
  }
}

async function onFieldTap(field, pageIndex, api) {
  const key = fieldKey(field.page, field.number);
  const before = api.snapshotFieldKeys([key]);

  if (api.eraseMode?.()) {
    if (api.fieldValues.has(key)) {
      api.fieldValues.delete(key);
      api.pushUndo({ kind: 'fields', pageIndex, before });
      api.redrawPage(pageIndex);
    }
    return;
  }

  // Toggle clear if already filled (simple types)
  if (api.fieldValues.has(key) && api.fieldValues.get(key)?.text) {
    // For scan/manual/text/date — offer clear on second tap
    api.fieldValues.delete(key);
    api.pushUndo({ kind: 'fields', pageIndex, before });
    api.redrawPage(pageIndex);
    return;
  }

  const type = field.type;
  let text = null;

  if (type === 'tap_ok') {
    text = field.value || 'OK';
  } else if (type === 'tap_x') {
    text = field.value || 'X';
  } else if (type === 'tap_date_settings') {
    text = stampDateForSettings(api.settings);
  } else if (type === 'tap_initials_stamp') {
    text = stampInitialsForSettings(api.settings);
    if (!text) {
      api.showToast('Bitte Initialen in den Einstellungen setzen.');
      api.openSettings();
      return;
    }
  } else if (type === 'tap_lager_clerk') {
    text = stampLagerClerkForSettings(api.settings);
    if (!text) {
      api.showToast('Bitte Sachbearbeiter Lager in den Einstellungen setzen.');
      api.openSettings();
      return;
    }
  } else if (type === 'manual_text') {
    text = await api.promptFieldInput({
      title: fieldDialogTitle(field, 'Text'),
      kind: 'text',
      initial: '',
      placeholder: '',
      autocapitalize: 'sentences',
    });
    if (text == null) return;
    text = String(text).trim();
    if (!text) return;
  } else if (type === 'manual_date') {
    // Software-Datum etc.: never prefill with today's stamp date — always empty for manual entry.
    text = await api.promptFieldInput({
      title: fieldDialogTitle(field, 'Datum'),
      kind: 'date',
      initial: '',
      placeholder: 'TT.MM.JJ',
    });
    if (text == null) return;
    text = normalizeStampDateYY(text);
    if (!text) return;
  } else if (type === 'scan_or_manual') {
    text = await api.promptFieldInput({
      title: fieldDialogTitle(field, 'Scan / Eingabe'),
      kind: 'scan_or_manual',
      initial: '',
      placeholder: 'Wert oder scannen',
    });
    if (text == null) return;
    text = String(text).trim();
    if (!text) return;
  } else {
    api.showToast(`Feldtyp „${type}“ nicht unterstützt.`);
    return;
  }

  api.fieldValues.set(key, {
    page: field.page,
    number: field.number,
    id: field.id,
    type,
    text,
    colorIndex: api.settings.colorIndex,
    rect_pt: field.rect_pt,
  });
  api.pushUndo({ kind: 'fields', pageIndex, before });
  api.redrawPage(pageIndex);
}

/**
 * Write field values into pdf-lib document (no blue overlays).
 */
export async function embedFieldValuesInPdf(pdfDoc, pages, fieldValues, settings) {
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const [, val] of fieldValues) {
    if (!val?.text || !val.rect_pt) continue;
    const pageIndex = (val.page || 1) - 1;
    const page = pages[pageIndex];
    if (!page) continue;
    const { height: pageHeight, width: pageWidth } = page.getSize();
    const [x0, y0, x1, y1] = val.rect_pt;
    // rect is top-left origin → pdf-lib bottom-left
    const w = x1 - x0;
    const h = y1 - y0;
    const x = x0;
    const y = pageHeight - y1;

    const c = colorRgb01(val.colorIndex ?? settings.colorIndex);
    const textColor = rgb(c.r, c.g, c.b);
    const text = String(val.text);
    const isInitials = val.type === 'tap_initials_stamp';
    // OK / serials / dates share regular weight — only initials stamps stay bold.
    const font = isInitials ? helveticaBold : helvetica;

    let size = Math.min(h * 0.72, 14);
    const maxW = Math.max(2, w - 2);
    while (size > 4 && font.widthOfTextAtSize(text, size) > maxW) {
      size -= 0.25;
    }
    const tw = font.widthOfTextAtSize(text, size);

    if (isInitials) {
      // White plate + colored stroke box (Umrandung) around initials
      const inset = Math.max(0.5, Math.min(w, h) * 0.06);
      page.drawRectangle({
        x: x + inset * 0.35,
        y: y + inset * 0.35,
        width: Math.max(1, w - inset * 0.7),
        height: Math.max(1, h - inset * 0.7),
        color: rgb(1, 1, 1),
        borderWidth: 0,
        opacity: 0.92,
      });
      const padX = Math.max(2.5, size * 0.32);
      const padY = Math.max(1.2, size * 0.16);
      let boxW = Math.min(maxW, tw + padX * 2);
      let boxH = Math.min(h - inset * 2, Math.max(size * 1.1, size + padY * 2));
      const bx = x + Math.max(0, (w - boxW) / 2);
      const by = y + Math.max(0, (h - boxH) / 2);
      page.drawRectangle({
        x: bx,
        y: by,
        width: boxW,
        height: boxH,
        borderColor: textColor,
        borderWidth: Math.max(0.9, Math.min(1.8, size * 0.1)),
      });
    }

    // Vertical center approx: baseline ~ mid - size*0.35
    const tx = x + Math.max(0, (w - tw) / 2);
    const ty = y + h / 2 - size * 0.35;
    page.drawText(text, {
      x: tx,
      y: ty,
      size,
      font,
      color: textColor,
    });
  }
}

export function serializeFieldValues(fieldValues) {
  const arr = [];
  for (const [key, val] of fieldValues) {
    if (!val?.text) continue;
    arr.push([val.page, val.number, val.text, val.colorIndex ?? 0]);
  }
  return arr;
}

export function parseFieldValuesFromKeywords(keywords) {
  if (!keywords) return [];
  const str = Array.isArray(keywords) ? keywords.join(',') : String(keywords);
  const m = str.match(/glfill=([^;]*)/);
  if (!m) return [];
  try {
    const json = decodeURIComponent(m[1]);
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (_) {
    return [];
  }
}

export function applyParsedFieldValues(fieldValues, parsed, template) {
  fieldValues.clear();
  if (!parsed?.length || !template) return;
  const byKey = new Map();
  for (const pageKey of Object.keys(template.pages || {})) {
    for (const f of template.pages[pageKey].fields || []) {
      byKey.set(fieldKey(f.page, f.number), f);
    }
  }
  for (const row of parsed) {
    const [page, number, text, colorIndex] = row;
    const f = byKey.get(fieldKey(page, number));
    if (!f || !text) continue;
    fieldValues.set(fieldKey(page, number), {
      page,
      number,
      id: f.id,
      type: f.type,
      text: String(text),
      colorIndex: colorIndex ?? 0,
      rect_pt: f.rect_pt,
    });
  }
}
