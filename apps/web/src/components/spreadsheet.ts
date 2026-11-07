/**
 * Lecture d'un fichier de tableur pour les imports : CSV (UTF-8 ou Windows-1252,
 * séparateur détecté) ou XLSX. Renvoie les en-têtes et une ligne objet par ligne.
 */
import Papa from 'papaparse';

export interface SheetData {
  headers: string[];
  rows: Record<string, unknown>[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Valeur de cellule XLSX → texte lisible par les analyseurs (dates au format français). */
function cellText(v: unknown): unknown {
  if (v instanceof Date) return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  if (typeof v === 'number') return String(v);
  return v ?? '';
}

async function decode(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Les exports français sont souvent en Windows-1252
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** Erreurs de lecture CSV en français (« Guillemet non fermé ligne 12 »). */
function csvError(e: Papa.ParseError): string {
  const line = (e.row ?? 0) + 2;
  if (e.code === 'MissingQuotes') return `Guillemet non fermé ligne ${line}.`;
  if (e.code === 'InvalidQuotes') return `Guillemet mal placé ligne ${line}.`;
  if (e.code === 'TooManyFields' || e.code === 'TooFewFields') return `Nombre de colonnes inattendu ligne ${line}.`;
  return `Lecture impossible ligne ${line}.`;
}

export async function readSheet(file: File): Promise<SheetData> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import('read-excel-file');
    const table = await readXlsxFile(file);
    const [head, ...body] = table;
    if (!head) throw new Error('Le classeur est vide.');
    const headers = head.map((h, i) => String(h ?? '').trim() || `Colonne ${i + 1}`);
    const rows = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, cellText(r[i])])));
    return { headers, rows };
  }
  if (/\.xls$/i.test(file.name)) throw new Error('Ancien format Excel (.xls) : enregistrez le fichier en .xlsx ou en .csv.');
  const text = await decode(file);
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replace(/^﻿/, '').trim(),
      complete: (res) => {
        const quote = res.errors.find((e) => e.type === 'Quotes');
        if (quote) return reject(new Error(csvError(quote)));
        resolve({ headers: (res.meta.fields ?? []).filter(Boolean), rows: res.data });
      },
      error: (err: Error) => reject(new Error(`Lecture impossible : ${err.message}`)),
    });
  });
}

/** Télécharge un fichier texte (modèle CSV, export) avec BOM pour Excel. */
export function downloadText(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
