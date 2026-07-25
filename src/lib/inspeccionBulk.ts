import { Platform } from 'react-native';
import * as XLSX from 'xlsx';
import { norm } from './text';
import { equipCategory } from './equipos';
import type { InspectionItem } from '../types/database';

/**
 * CARGA MASIVA DE INSPECCIONES (por Excel).
 * Formato de plantilla: 1 FILA = 1 ÍTEM del inventario. Cada fila trae el
 * CÓDIGO/serial de la máquina; el sistema agrupa las filas por máquina y arma
 * UNA inspección por máquina. Al subir, se valida y se muestra el TIPO y el
 * INVENTARIO detectado por máquina para confirmar que la plantilla está bien.
 */

export type MachineRef = { id: string; code: string; plate: string | null; serial: string | null; tipo: string | null };

/** Columnas de la plantilla (en orden). El parser las reconoce por palabra clave,
 *  así que el usuario puede reordenarlas o cambiar mayúsculas/acentos. */
const COLS = [
  'Máquina (código o serial)',
  'Fecha (AAAA-MM-DD)',
  'Hora (HH:MM)',
  'Inspector',
  'Operador',
  'Condición general',
  'Ítem (descripción)',
  'Cantidad',
  'Unidad',
  'Serial / Especificación',
  'Estado',
  'Nivel (bien / regular / falla)',
] as const;

/** Mapea un encabezado del Excel a un campo interno (tolerante a acentos/orden). */
type Field = 'maquina' | 'fecha' | 'hora' | 'inspector' | 'operador' | 'condicion' | 'descripcion' | 'cantidad' | 'unidad' | 'serial' | 'estado' | 'nivel' | null;
function headerToField(h: string): Field {
  const n = norm(h);
  if (!n) return null;
  if (n.includes('maquina') || n.includes('codigo') || n.includes('equipo') || n.includes('placa')) {
    // "serial / especificacion" del ítem también contiene "serial"; la de máquina trae "maquina/codigo/equipo/placa".
    return 'maquina';
  }
  if (n.includes('fecha')) return 'fecha';
  if (n.includes('hora')) return 'hora';
  if (n.includes('inspector')) return 'inspector';
  if (n.includes('operador') || n.includes('chofer')) return 'operador';
  if (n.includes('condicion general') || n === 'condicion') return 'condicion';
  if (n.includes('item') || n.includes('descripcion')) return 'descripcion';
  if (n.includes('cantidad') || n === 'cant') return 'cantidad';
  if (n.includes('unidad') || n === 'unid') return 'unidad';
  if (n.includes('serial') || n.includes('especificacion')) return 'serial';
  if (n.includes('nivel') || n.includes('semaforo')) return 'nivel'; // antes que "estado"
  if (n.includes('estado') || n.includes('condicion')) return 'estado';
  return null;
}

/** Normaliza el texto de nivel a 'ok' | 'warn' | 'bad'. */
function parseNivel(v: string): 'ok' | 'warn' | 'bad' {
  const n = norm(v);
  if (!n) return 'ok';
  if (n.startsWith('reg') || n.includes('naranja') || n.includes('warn') || n.includes('amarill')) return 'warn';
  if (n.startsWith('fall') || n.includes('mal') || n.includes('rojo') || n.includes('bad') || n.includes('danad') || n.includes('malo')) return 'bad';
  return 'ok'; // bien / verde / ok / operativo
}

const nivelTxt = (n: 'ok' | 'warn' | 'bad') => (n === 'bad' ? 'Falla' : n === 'warn' ? 'Regular' : 'Bien');

/** Nombre de archivo válido. */
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Dispara la descarga de un workbook en web. */
function downloadWorkbook(wb: XLSX.WorkBook, fileName: string): boolean {
  if (Platform.OS !== 'web') return false;
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const d: any = (globalThis as any).document;
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a: any = d.createElement('a');
  a.href = url; a.download = `${safeName(fileName)}.xlsx`;
  d.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/**
 * Genera y descarga la PLANTILLA de carga masiva. Trae:
 *  - Hoja "Inspecciones": encabezados + 2 filas de ejemplo (misma máquina = 1 inspección con 2 ítems).
 *  - Hoja "Máquinas (referencia)": lista de códigos/serial/placa/tipo válidos para copiar.
 */
export function downloadInspeccionTemplate(machines: MachineRef[]): boolean {
  const wb = XLSX.utils.book_new();

  const ejemploMaq = machines[0]?.code || 'CÓDIGO-EQUIPO';
  const rows: (string | number)[][] = [
    [...COLS],
    [ejemploMaq, '2026-07-25', '08:00', 'Juan Pérez', 'Pedro Gómez', 'Equipo operativo, sin novedades', 'Extintor 10 lb', 1, 'Unid.', 'EXT-001', 'Operativo', 'Bien'],
    [ejemploMaq, '', '', '', '', '', 'Llave de rueda', 1, 'Unid.', '', 'Verificado', 'Bien'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 26 }, { wch: 26 }, { wch: 9 }, { wch: 8 }, { wch: 20 }, { wch: 16 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Inspecciones');

  const refRows: (string)[][] = [['Código', 'Serial', 'Placa', 'Tipo']];
  machines.forEach((m) => refRows.push([m.code, m.serial || '', m.plate || '', (m.tipo && m.tipo.trim()) || equipCategory(m.code) || m.code]));
  const refWs = XLSX.utils.aoa_to_sheet(refRows);
  refWs['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 16 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, refWs, 'Máquinas (referencia)');

  return downloadWorkbook(wb, 'Plantilla - Carga masiva de inspecciones');
}

/** Una inspección lista para insertar (agrupada por máquina), con su validación. */
export type BulkGroup = {
  input: string;                 // texto de máquina tal cual venía
  machine: MachineRef | null;    // máquina encontrada (o null)
  tipo: string;                  // tipo/categoría para mostrar
  fecha: string;                 // AAAA-MM-DD (o '')
  hora: string;                  // HH:MM (o '')
  inspector: string;
  operador: string;
  condicion: string;
  items: InspectionItem[];
  errors: string[];              // problemas de esta máquina
  ok: boolean;                   // sin errores → se puede cargar
};

export type BulkParse = {
  groups: BulkGroup[];
  totalItems: number;
  okCount: number;
  errorCount: number;
  fatal: string | null;          // error que impide todo (hoja vacía, sin columnas…)
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lee el workbook (ArrayBuffer), valida y AGRUPA por máquina.
 * Empareja la máquina por código / serial / placa (normalizados).
 */
export function parseInspeccionWorkbook(data: ArrayBuffer, machines: MachineRef[]): BulkParse {
  const empty: BulkParse = { groups: [], totalItems: 0, okCount: 0, errorCount: 0, fatal: null };
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: 'array' });
  } catch {
    return { ...empty, fatal: 'No se pudo leer el archivo. ¿Es un Excel (.xlsx) válido?' };
  }
  const wsName = wb.SheetNames.find((n) => norm(n).includes('inspeccion')) || wb.SheetNames[0];
  const ws = wsName ? wb.Sheets[wsName] : null;
  if (!ws) return { ...empty, fatal: 'El archivo no tiene hojas.' };

  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  if (!aoa.length) return { ...empty, fatal: 'La hoja está vacía.' };

  // Fila de encabezados = primera fila con al menos una celda con texto.
  const headerIdx = aoa.findIndex((r) => r.some((c) => String(c ?? '').trim()));
  if (headerIdx < 0) return { ...empty, fatal: 'No se encontró la fila de encabezados.' };
  const headers = aoa[headerIdx].map((h) => headerToField(String(h ?? '')));
  if (!headers.includes('maquina')) return { ...empty, fatal: 'Falta la columna de la máquina (código o serial). Usa la plantilla oficial.' };
  if (!headers.includes('descripcion')) return { ...empty, fatal: 'Falta la columna "Ítem (descripción)". Usa la plantilla oficial.' };

  const cell = (row: any[], f: Field): string => {
    const i = headers.indexOf(f);
    return i >= 0 ? String(row[i] ?? '').trim() : '';
  };

  // Índice de máquinas por clave normalizada (código, serial, placa).
  const byKey = new Map<string, MachineRef>();
  machines.forEach((m) => {
    [m.code, m.serial, m.plate].forEach((k) => { const nk = norm(String(k ?? '')); if (nk) if (!byKey.has(nk)) byKey.set(nk, m); });
  });

  // Recorre las filas de datos preservando el orden y agrupa por máquina (input).
  const order: string[] = [];
  const map = new Map<string, BulkGroup>();
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r];
    const inputRaw = cell(row, 'maquina');
    const desc = cell(row, 'descripcion');
    if (!inputRaw && !desc) continue; // fila vacía → se ignora

    const key = norm(inputRaw);
    let g = map.get(key);
    if (!g) {
      const machine = byKey.get(key) ?? null;
      g = {
        input: inputRaw || '(sin máquina)',
        machine,
        tipo: machine ? ((machine.tipo && machine.tipo.trim()) || equipCategory(machine.code) || machine.code) : '',
        fecha: '', hora: '', inspector: '', operador: '', condicion: '',
        items: [], errors: [], ok: false,
      };
      if (!inputRaw) g.errors.push('Fila sin máquina (código o serial).');
      else if (!machine) g.errors.push(`No existe una máquina con código/serial "${inputRaw}".`);
      map.set(key, g);
      order.push(key);
    }
    // Datos de cabecera de la inspección: se toman de la PRIMERA fila que los traiga.
    if (!g.fecha) { const f = cell(row, 'fecha'); if (f) { if (ISO_RE.test(f)) g.fecha = f; else g.errors.push(`Fecha inválida "${f}" (usa AAAA-MM-DD).`); } }
    if (!g.hora) g.hora = cell(row, 'hora');
    if (!g.inspector) g.inspector = cell(row, 'inspector');
    if (!g.operador) g.operador = cell(row, 'operador');
    if (!g.condicion) g.condicion = cell(row, 'condicion');
    // Ítem de esta fila (si trae descripción).
    if (desc) {
      const cantTxt = cell(row, 'cantidad').replace(/[^0-9.]/g, '');
      g.items.push({
        descripcion: desc,
        cantidad: Number(cantTxt) || 1,
        unidad: cell(row, 'unidad') || 'Unid.',
        serial: cell(row, 'serial') || null,
        estado: cell(row, 'estado') || '—',
        nivel: parseNivel(cell(row, 'nivel')),
      });
    }
  }

  const groups = order.map((k) => map.get(k)!).map((g) => {
    if (g.items.length === 0) g.errors.push('No tiene ítems (ninguna fila con descripción).');
    g.ok = g.errors.length === 0;
    return g;
  });

  const totalItems = groups.reduce((a, g) => a + g.items.length, 0);
  const okCount = groups.filter((g) => g.ok).length;
  const errorCount = groups.length - okCount;
  return { groups, totalItems, okCount, errorCount, fatal: groups.length === 0 ? 'No se encontraron filas con datos.' : null };
}

/** WEB: abre el selector de archivos y devuelve el Excel como ArrayBuffer (o null si cancela). */
export function pickWorkbookFile(): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web') { resolve(null); return; }
    const d: any = (globalThis as any).document;
    const input: any = d.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
    input.style.display = 'none';
    let done = false;
    const finish = (v: ArrayBuffer | null) => { if (done) return; done = true; try { input.remove(); } catch {} resolve(v); };
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) { finish(null); return; }
      const fr: any = new (globalThis as any).FileReader();
      fr.onload = () => finish(fr.result as ArrayBuffer);
      fr.onerror = () => finish(null);
      fr.readAsArrayBuffer(file);
    };
    // Si el usuario cierra el diálogo sin elegir, no dispara onchange; lo dejamos pendiente
    // (se resuelve al abrir otro o al recargar). Es el comportamiento estándar de <input file>.
    d.body.appendChild(input);
    input.click();
  });
}

/** Resumen legible del inventario de una máquina, para la vista previa. */
export function groupSummary(g: BulkGroup): string {
  const niveles = g.items.reduce((a, it) => { a[it.nivel] = (a[it.nivel] || 0) + 1; return a; }, {} as Record<string, number>);
  const partes = (['ok', 'warn', 'bad'] as const).filter((n) => niveles[n]).map((n) => `${niveles[n]} ${nivelTxt(n)}`);
  return `${g.items.length} ítem(s)${partes.length ? ` · ${partes.join(' · ')}` : ''}`;
}
