/**
 * Écriture des exports : classeur XLSX aux couleurs Optimum (logo, en-têtes
 * pétrole, formats € et dates français, volets figés) ou archive ZIP de CSV.
 * Les bibliothèques sont chargées à la demande.
 */
import { sheetName, sheetToCsv, type SheetSpec } from '@optimum/treso-engine';
import logoUrl from '../assets/brand/optimum-logo.svg';

const PETROL = 'FF114C5C';
const PETROL_50 = 'FFEEF3F4';
const MUTED = 'FF6B6B6B';
const HEADER_ROW = 6;

const EUR = '#,##0.00 "€";[Red]-#,##0.00 "€"';
const FORMATS = { eur: EUR, date: 'dd/mm/yyyy', month: EUR, pct: '0.0 %', number: '#,##0.##', text: '@' } as const;

/** Logo SVG → PNG (base64) pour l'insérer dans le classeur. */
async function logoPng(): Promise<string | null> {
  try {
    const img = new Image();
    img.src = logoUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 456;
    canvas.height = 108;
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const frDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export interface ExportMeta {
  companyName: string;
  from: string;
  to: string;
  today: string;
}

export async function writeXlsx(sheets: Omit<SheetSpec, 'name'>[], meta: ExportMeta): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tréso Optimum';
  wb.created = new Date();
  const logo = await logoPng();
  const logoId = logo ? wb.addImage({ base64: logo, extension: 'png' }) : null;
  const taken = new Set<string>();

  for (const spec of sheets) {
    const ws = wb.addWorksheet(sheetName(spec.title, taken), {
      views: [{ state: 'frozen', xSplit: spec.frozenColumns, ySplit: HEADER_ROW, showGridLines: false }],
      properties: { defaultRowHeight: 18 },
    });
    ws.columns = spec.columns.map((c) => ({ width: c.width ?? 14 }));
    if (logoId !== null) ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 152, height: 36 } });
    ws.getRow(1).height = 22;
    ws.getRow(2).height = 18;
    const title = ws.getCell(3, 1);
    title.value = spec.title;
    title.font = { name: 'Poppins', size: 14, bold: true, color: { argb: PETROL } };
    const sub = ws.getCell(4, 1);
    sub.value = `${meta.companyName} · du ${frDate(meta.from)} au ${frDate(meta.to)} · exporté le ${frDate(meta.today)} · montants TTC en euros`;
    sub.font = { name: 'Raleway', size: 9, color: { argb: MUTED } };

    const head = ws.getRow(HEADER_ROW);
    spec.columns.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      const isMonth = c.type === 'month' && /^\d{4}-\d{2}-\d{2}$/.test(c.header);
      cell.value = isMonth ? toDate(c.header) : c.header;
      if (isMonth) cell.numFmt = 'mmm yyyy';
      cell.font = { name: 'Raleway', bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PETROL } };
      cell.alignment = { vertical: 'middle', horizontal: c.type === 'text' || c.type === 'date' ? 'left' : 'right' };
    });
    head.height = 22;

    spec.rows.forEach((values, r) => {
      const row = ws.getRow(HEADER_ROW + 1 + r);
      const style = spec.rowStyles?.[r];
      values.forEach((v, i) => {
        const col = spec.columns[i];
        const cell = row.getCell(i + 1);
        const isoString = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
        if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) cell.value = null;
        else if ((col?.type === 'date' || col?.type === 'month') && isoString) cell.value = toDate(v);
        else cell.value = v;
        if (col) cell.numFmt = col.type === 'month' && isoString ? 'mmm yyyy' : FORMATS[col.type];
        cell.font = { name: 'Raleway', size: 10, bold: style === 'section' || style === 'total' || style === 'strong' };
        if (style === 'section') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PETROL_50 } };
        if (style === 'total') cell.border = { top: { style: 'thin', color: { argb: PETROL } } };
      });
    });
    if (spec.rows.length && !spec.rowStyles) ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: spec.columns.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Une archive ZIP avec un CSV par contenu. */
export async function writeCsvZip(sheets: Omit<SheetSpec, 'name'>[]): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  const taken = new Set<string>();
  for (const s of sheets) {
    let name = `${s.file}.csv`;
    for (let i = 2; taken.has(name); i++) name = `${s.file}-${i}.csv`;
    taken.add(name);
    files[name] = strToU8(sheetToCsv(s));
  }
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
