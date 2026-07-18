// Generador MÍNIMO de archivos .xlsx (una hoja), SIN dependencias.
// Un .xlsx es un ZIP con varios XML; aquí se arma el ZIP (método STORE, sin
// comprimir) con los XML mínimos que Excel necesita para abrir el archivo.
// Uso: buildXlsx([['a','b'],[1,2]], 'Hoja') → Uint8Array lista para descargar.

type Cell = string | number;

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function xmlEsc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Letra(s) de columna: 0→A, 25→Z, 26→AA… */
function colName(i: number): string {
  let s = ''; i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// CRC32 (necesario para el ZIP STORE).
let CRC_TABLE: number[] | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** XML de la hoja. Las primeras `headerRows` filas usan el estilo 1 (encabezado azul). */
function sheetXml(rows: Cell[][], headerRows: number): string {
  const body = rows.map((row, r) => {
    const sAttr = r < headerRows ? ' s="1"' : '';
    const cells = row.map((cell, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (typeof cell === 'number' && isFinite(cell)) return `<c r="${ref}"${sAttr}><v>${cell}</v></c>`;
      return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(cell ?? ''))}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

// Estilos: fila de encabezado con relleno AZUL del sistema (#16324F) y letra
// blanca en negrita, centrada. (Los 2 primeros fills los exige Excel: none/gray.)
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16324F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Arma un ZIP (STORE, sin compresión) a partir de una lista de archivos. */
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const out: number[] = [];
  const central: number[] = [];
  const u16 = (arr: number[], v: number) => { arr.push(v & 0xFF, (v >>> 8) & 0xFF); };
  const u32 = (arr: number[], v: number) => { arr.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); };
  const pushBytes = (arr: number[], b: Uint8Array) => { for (let i = 0; i < b.length; i++) arr.push(b[i]); };

  for (const f of files) {
    const nameB = enc(f.name);
    const crc = crc32(f.data);
    const offset = out.length;
    // Local file header
    u32(out, 0x04034b50); u16(out, 20); u16(out, 0); u16(out, 0); u16(out, 0); u16(out, 0);
    u32(out, crc); u32(out, f.data.length); u32(out, f.data.length);
    u16(out, nameB.length); u16(out, 0);
    pushBytes(out, nameB); pushBytes(out, f.data);
    // Central directory record
    u32(central, 0x02014b50); u16(central, 20); u16(central, 20); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0);
    u32(central, crc); u32(central, f.data.length); u32(central, f.data.length);
    u16(central, nameB.length); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0); u32(central, 0);
    u32(central, offset);
    pushBytes(central, nameB);
  }
  const cdOffset = out.length;
  for (const b of central) out.push(b);
  // End of central directory
  u32(out, 0x06054b50); u16(out, 0); u16(out, 0); u16(out, files.length); u16(out, files.length);
  u32(out, central.length); u32(out, cdOffset); u16(out, 0);
  return new Uint8Array(out);
}

/** Construye un .xlsx de UNA hoja a partir de filas (array de arrays).
 *  Las primeras `headerRows` filas se pintan con el encabezado azul del sistema. */
export function buildXlsx(rows: Cell[][], sheetName = 'Hoja1', headerRows = 1): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zipStore([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: '_rels/.rels', data: enc(rels) },
    { name: 'xl/workbook.xml', data: enc(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc(wbRels) },
    { name: 'xl/styles.xml', data: enc(STYLES_XML) },
    { name: 'xl/worksheets/sheet1.xml', data: enc(sheetXml(rows, headerRows)) },
  ]);
}

// ── LECTURA de .xlsx (unzip + primera hoja → filas de texto) ──────────────────

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Descomprime DEFLATE crudo (entradas de ZIP) con el navegador. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const g: any = globalThis as any;
  if (typeof g.DecompressionStream !== 'function') {
    throw new Error('Este navegador no puede leer Excel comprimido. Actualiza el navegador o pega las filas.');
  }
  const ds = new g.DecompressionStream('deflate-raw');
  const stream = new g.Blob([data]).stream().pipeThrough(ds);
  const buf = await new g.Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Descomprime un ZIP en un mapa nombre→bytes (soporta STORE y DEFLATE). */
async function unzip(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  const dec = new TextDecoder();
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) { if (u32(bytes, i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('El archivo no es un Excel válido (.xlsx).');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out: Record<string, Uint8Array> = {};
  for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
    if (u32(bytes, p) !== 0x02014b50) break;
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOff = u32(bytes, p + 42);
    const name = dec.decode(bytes.slice(p + 46, p + 46 + nameLen));
    const lNameLen = u16(bytes, localOff + 26);
    const lExtraLen = u16(bytes, localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = bytes.slice(dataStart, dataStart + compSize);
    out[name] = method === 0 ? comp : await inflateRaw(comp);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIdx = (ref: string): number => {
  const m = ref.match(/^([A-Z]+)/); if (!m) return 0;
  let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1;
};

/** Lee un .xlsx y devuelve la PRIMERA hoja como filas de texto (string[][]). */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const get = (n: string) => (files[n] ? dec.decode(files[n]) : '');
  // Cadenas compartidas (Excel guarda el texto aquí).
  const shared: string[] = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) {
    const siList = ss.match(/<si\b[\s\S]*?<\/si>/g) || [];
    for (const si of siList) {
      const parts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1]));
      shared.push(parts.join(''));
    }
  }
  // Primera hoja (por defecto sheet1.xml; si no, la primera worksheet que exista).
  let sheet = get('xl/worksheets/sheet1.xml');
  if (!sheet) { const k = Object.keys(files).find((n) => /^xl\/worksheets\/.*\.xml$/.test(n)); if (k) sheet = dec.decode(files[k]); }
  if (!sheet) throw new Error('El Excel no tiene ninguna hoja.');
  const rows: string[][] = [];
  const rowMatches = sheet.match(/<row\b[\s\S]*?<\/row>/g) || [];
  for (const rowXml of rowMatches) {
    const cells: string[] = [];
    const cellMatches = [...rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)];
    for (const cm of cellMatches) {
      const attrs = cm[1] || ''; const inner = cm[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || '';
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || '';
      let val = '';
      if (type === 'inlineStr') {
        val = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');
      } else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? '';
        val = type === 's' ? (shared[parseInt(v, 10)] ?? '') : unesc(v);
      }
      const idx = ref ? colIdx(ref) : cells.length;
      cells[idx] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}
