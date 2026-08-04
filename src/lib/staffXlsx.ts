import { Platform } from 'react-native';
import * as XLSX from 'xlsx-js-style';

/**
 * EXPORTACIÓN A EXCEL — Nómina / Pago a personal.
 * Usa xlsx-js-style (igual que src/lib/inspeccionBulk.ts). NO usa el generador
 * artesanal src/lib/xlsx.ts (ese es específico de Inventario).
 *
 * La hoja lista, por PERSONA, lo trabajado y lo PAGADO/adeudado en el período de
 * nómina seleccionado (no las tarifas del empleado — eso se ve en "Empleados").
 * La tasa BCV del día va en una celda editable y los montos en Bs se calculan con
 * FÓRMULAS reales (no valores fijos), así que si el usuario cambia la tasa, todos
 * los Bs se recalculan solos.
 */

export type PagoPersonalXlsxRow = {
  nombre: string;
  cedula: string;
  cargo: string;
  dias: number;        // jornadas de DÍA (modo "Por día")
  dias_noche: number;   // jornadas de NOCHE (modo "Por día")
  horas: number;        // modo "Por hora"
  semanas: number;      // modo "Por semana"
  devengado: number;
  bonos: number;
  deducciones: number;
  total: number;
  pagado: number;
  saldo: number;
};

/** Datos del período que se muestran arriba del listado (contexto del reporte). */
export type PagoPersonalXlsxMeta = {
  periodo: string;   // nombre del período
  tipo: string;      // Día / Semana / Quincena
  desde: string;     // dd/mm/aaaa
  hasta: string;     // dd/mm/aaaa
  modo: string;      // Por hora / Por día / Por semana
  estado: string;    // Borrador / Aprobada / Pagada
  empresa: string;
  cargoFiltro?: string; // si el reporte respeta un filtro por cargo, se anota aquí
};

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

/** Estilo del encabezado: azul oscuro con letras blancas (como el resto del sistema). */
const HEADER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '1E3A5F' } },
  font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 11 },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
} as const;

const META_STYLE = {
  font: { bold: true, sz: 11, color: { rgb: '1E3A5F' } },
} as const;
const TASA_LABEL_STYLE = {
  font: { bold: true, sz: 11, color: { rgb: '1E3A5F' } },
} as const;
const TASA_VALUE_STYLE = {
  font: { bold: true, sz: 12, color: { rgb: '0F766E' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'ECFDF5' } },
  numFmt: '#,##0.00',
} as const;
const TOTAL_STYLE = {
  font: { bold: true, sz: 11 },
  fill: { patternType: 'solid', fgColor: { rgb: 'EEF2F7' } },
} as const;
const MONEY_FMT = '#,##0.00';
const QTY_FMT = '#,##0.##';

const COLS = [
  'Nombre completo', 'Cédula', 'Cargo',
  'Días', 'Noches', 'Horas', 'Semanas',
  'Devengado (US$)', 'Bonos (US$)', 'Deducciones (US$)', 'Total (US$)', 'Pagado (US$)', 'Saldo (US$)',
  'Devengado (Bs)', 'Bonos (Bs)', 'Deducciones (Bs)', 'Total (Bs)', 'Pagado (Bs)', 'Saldo (Bs)',
] as const;

// Columnas de MONTOS en US$ (para las que hay una fórmula en Bs, 6 posiciones a la derecha).
const USD_COLS = [7, 8, 9, 10, 11, 12];
// Columnas de CANTIDAD trabajada (sin equivalente en Bs).
const QTY_COLS = [3, 4, 5, 6];

// Filas fijas del encabezado: 0 = contexto del período, 1 = tasa BCV, 2 = blanco, 3 = encabezado de columnas.
const META_ROW = 0;
const TASA_ROW = 1;
const HEADER_ROW = 3;
const FIRST_DATA_ROW = 4; // 0-indexed → fila 5 de Excel

/**
 * Genera y descarga el listado de PAGOS A PERSONAL del período dado: por cada
 * persona, lo trabajado (días/noches/horas/semanas), devengado, bonos,
 * deducciones, total, pagado y saldo — en US$ y en Bs (fórmula = US$ × tasa BCV,
 * que se guarda en la celda B2 y se puede editar).
 */
export function exportPagoPersonalXlsx(rows: PagoPersonalXlsxRow[], bcvRate: number | null, meta: PagoPersonalXlsxMeta): boolean {
  const wb = XLSX.utils.book_new();
  const nCols = COLS.length;
  const blankRow = (n: number) => new Array(n).fill('');

  const aoa: any[][] = [];
  const metaTxt = `${meta.periodo} · ${meta.tipo} · ${meta.desde} → ${meta.hasta} · ${meta.modo} · ${meta.estado} · ${meta.empresa}` +
    (meta.cargoFiltro ? ` · Cargo(s): ${meta.cargoFiltro}` : '');
  aoa[META_ROW] = ['Período:', metaTxt, ...blankRow(nCols - 2)];
  aoa[TASA_ROW] = ['Tasa BCV del día (Bs/US$):', bcvRate ?? 0, ...blankRow(nCols - 2)];
  aoa[2] = blankRow(nCols);
  aoa[HEADER_ROW] = [...COLS];
  rows.forEach((r, i) => {
    aoa[FIRST_DATA_ROW + i] = [
      r.nombre, r.cedula || '', r.cargo || '',
      r.dias || 0, r.dias_noche || 0, r.horas || 0, r.semanas || 0,
      r.devengado || 0, r.bonos || 0, r.deducciones || 0, r.total || 0, r.pagado || 0, r.saldo || 0,
      0, 0, 0, 0, 0, 0, // Bs — se sobreescriben con fórmulas abajo
    ];
  });
  const totalRow = FIRST_DATA_ROW + rows.length;
  aoa[totalRow] = ['TOTAL', `${rows.length} persona(s)`, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Encabezado de columnas (fila HEADER_ROW).
  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: HEADER_ROW, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = HEADER_STYLE;
  }
  // Contexto del período.
  const metaLabelRef = XLSX.utils.encode_cell({ r: META_ROW, c: 0 });
  if ((ws as any)[metaLabelRef]) (ws as any)[metaLabelRef].s = META_STYLE;
  // Etiqueta y valor de la tasa BCV.
  const labelRef = XLSX.utils.encode_cell({ r: TASA_ROW, c: 0 });
  const rateRef = XLSX.utils.encode_cell({ r: TASA_ROW, c: 1 });
  if ((ws as any)[labelRef]) (ws as any)[labelRef].s = TASA_LABEL_STYLE;
  if ((ws as any)[rateRef]) { (ws as any)[rateRef].s = TASA_VALUE_STYLE; (ws as any)[rateRef].z = MONEY_FMT; }

  // Cantidades trabajadas: formato numérico simple.
  rows.forEach((_r, i) => {
    const row = FIRST_DATA_ROW + i;
    QTY_COLS.forEach((c) => {
      const ref = XLSX.utils.encode_cell({ r: row, c });
      const cell = (ws as any)[ref];
      if (cell) { cell.z = QTY_FMT; cell.t = 'n'; }
    });
  });

  // Montos US$ (formato de número) + fórmulas Bs (6 columnas a la derecha) referenciando
  // la tasa fija en $B$2 (fila 2 de Excel = índice 1, TASA_ROW).
  rows.forEach((_r, i) => {
    const row = FIRST_DATA_ROW + i;
    USD_COLS.forEach((c) => {
      const ref = XLSX.utils.encode_cell({ r: row, c });
      const cell = (ws as any)[ref];
      if (cell) { cell.z = MONEY_FMT; cell.t = 'n'; }
      const bsCol = c + 6;
      const usdColLetter = XLSX.utils.encode_col(c);
      const bsRef = XLSX.utils.encode_cell({ r: row, c: bsCol });
      (ws as any)[bsRef] = { t: 'n', z: MONEY_FMT, f: `${usdColLetter}${row + 1}*$B$${TASA_ROW + 1}` };
    });
  });

  // Fila de TOTAL: suma de cantidades, US$ y Bs (todas fórmulas, se recalculan solas).
  if (rows.length) {
    const firstExcelRow = FIRST_DATA_ROW + 1;
    const lastExcelRow = FIRST_DATA_ROW + rows.length;
    [...QTY_COLS, ...USD_COLS, ...USD_COLS.map((c) => c + 6)].forEach((c) => {
      const colLetter = XLSX.utils.encode_col(c);
      const ref = XLSX.utils.encode_cell({ r: totalRow, c });
      (ws as any)[ref] = { t: 'n', z: c >= 7 ? MONEY_FMT : QTY_FMT, f: `SUM(${colLetter}${firstExcelRow}:${colLetter}${lastExcelRow})` };
    });
  }
  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: totalRow, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = { ...(cell as any).s, ...TOTAL_STYLE };
    else (ws as any)[ref] = { t: 's', v: '', s: TOTAL_STYLE };
  }

  ws['!cols'] = [
    { wch: 26 }, { wch: 14 }, { wch: 20 },
    { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 9 },
    { wch: 13 }, { wch: 11 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 13 }, { wch: 11 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
  ];
  ws['!rows'] = [{ hpt: 20 }, { hpt: 20 }, { hpt: 6 }, { hpt: 30 }];
  ws['!merges'] = [
    { s: { r: META_ROW, c: 1 }, e: { r: META_ROW, c: nCols - 1 } },
    { s: { r: TASA_ROW, c: 2 }, e: { r: TASA_ROW, c: nCols - 1 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Pago de personal');
  return downloadWorkbook(wb, `Pago de personal - ${meta.periodo}`);
}

// ── Excel del historial de pagos de UNA persona ("Pago a Personal → Por persona") ──

export type PersonaXlsxRow = {
  fecha: string;       // dd/mm/aaaa (desde)
  fechaHasta: string;  // dd/mm/aaaa (hasta, o '' si es igual a fecha)
  detalle: string;     // ej. "Diario · ☀️ 3 × $45 · 🌙 2 × $50"
  metodo: string;
  concepto: string;
  monto: number;       // US$
};

const PERSONA_COLS = ['Período', 'Detalle', 'Método', 'Concepto', 'Monto (US$)', 'Monto (Bs)'] as const;
const PERSONA_META_ROW = 0;
const PERSONA_TASA_ROW = 1;
const PERSONA_HEADER_ROW = 3;
const PERSONA_FIRST_DATA_ROW = 4;

/**
 * Genera y descarga el historial de pagos de UN empleado (vista "Por persona"),
 * con el mismo patrón de tasa BCV editable + fórmula en Bs que el resto de los
 * Excel de este archivo.
 */
export function exportPersonaHistoricoXlsx(
  nombre: string,
  cedula: string,
  rows: PersonaXlsxRow[],
  bcvRate: number | null,
): boolean {
  const wb = XLSX.utils.book_new();
  const nCols = PERSONA_COLS.length;
  const blankRow = (n: number) => new Array(n).fill('');

  const aoa: any[][] = [];
  aoa[PERSONA_META_ROW] = ['Trabajador:', `${nombre}${cedula ? ` · C.I. ${cedula}` : ''}`, ...blankRow(nCols - 2)];
  aoa[PERSONA_TASA_ROW] = ['Tasa BCV del día (Bs/US$):', bcvRate ?? 0, ...blankRow(nCols - 2)];
  aoa[2] = blankRow(nCols);
  aoa[PERSONA_HEADER_ROW] = [...PERSONA_COLS];
  rows.forEach((r, i) => {
    const periodo = r.fechaHasta && r.fechaHasta !== r.fecha ? `${r.fecha} → ${r.fechaHasta}` : r.fecha;
    aoa[PERSONA_FIRST_DATA_ROW + i] = [periodo, r.detalle || '', r.metodo || '', r.concepto || '', r.monto || 0, 0];
  });
  const totalRow = PERSONA_FIRST_DATA_ROW + rows.length;
  aoa[totalRow] = ['TOTAL', `${rows.length} pago(s)`, '', '', 0, 0];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: PERSONA_HEADER_ROW, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = HEADER_STYLE;
  }
  const metaLabelRef = XLSX.utils.encode_cell({ r: PERSONA_META_ROW, c: 0 });
  if ((ws as any)[metaLabelRef]) (ws as any)[metaLabelRef].s = META_STYLE;
  const labelRef = XLSX.utils.encode_cell({ r: PERSONA_TASA_ROW, c: 0 });
  const rateRef = XLSX.utils.encode_cell({ r: PERSONA_TASA_ROW, c: 1 });
  if ((ws as any)[labelRef]) (ws as any)[labelRef].s = TASA_LABEL_STYLE;
  if ((ws as any)[rateRef]) { (ws as any)[rateRef].s = TASA_VALUE_STYLE; (ws as any)[rateRef].z = MONEY_FMT; }

  // Monto US$ (col 4) + fórmula en Bs (col 5) referenciando la tasa en $B$2.
  rows.forEach((_r, i) => {
    const row = PERSONA_FIRST_DATA_ROW + i;
    const usdRef = XLSX.utils.encode_cell({ r: row, c: 4 });
    const usdCell = (ws as any)[usdRef];
    if (usdCell) { usdCell.z = MONEY_FMT; usdCell.t = 'n'; }
    const bsRef = XLSX.utils.encode_cell({ r: row, c: 5 });
    (ws as any)[bsRef] = { t: 'n', z: MONEY_FMT, f: `E${row + 1}*$B$${PERSONA_TASA_ROW + 1}` };
  });

  // Fila TOTAL: suma de US$ y Bs.
  if (rows.length) {
    const firstExcelRow = PERSONA_FIRST_DATA_ROW + 1;
    const lastExcelRow = PERSONA_FIRST_DATA_ROW + rows.length;
    [4, 5].forEach((c) => {
      const colLetter = XLSX.utils.encode_col(c);
      const ref = XLSX.utils.encode_cell({ r: totalRow, c });
      (ws as any)[ref] = { t: 'n', z: MONEY_FMT, f: `SUM(${colLetter}${firstExcelRow}:${colLetter}${lastExcelRow})` };
    });
  }
  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: totalRow, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = { ...(cell as any).s, ...TOTAL_STYLE };
    else (ws as any)[ref] = { t: 's', v: '', s: TOTAL_STYLE };
  }

  ws['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 14 }, { wch: 22 }, { wch: 13 }, { wch: 13 }];
  ws['!rows'] = [{ hpt: 20 }, { hpt: 20 }, { hpt: 6 }, { hpt: 30 }];
  ws['!merges'] = [
    { s: { r: PERSONA_META_ROW, c: 1 }, e: { r: PERSONA_META_ROW, c: nCols - 1 } },
    { s: { r: PERSONA_TASA_ROW, c: 2 }, e: { r: PERSONA_TASA_ROW, c: nCols - 1 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Historial de pagos');
  return downloadWorkbook(wb, `Historial de pagos - ${nombre}`);
}

// ── Excel de un LOTE de personas seleccionadas ("Pago a Personal → Por persona") ──

export type PersonasSeleccionadasXlsxRow = {
  nombre: string;
  cedula: string;
  cargo: string;
  total: number; // US$ — total pagado histórico de la persona
};

const SEL_COLS = ['Nombre completo', 'Cédula', 'Cargo', 'Total pagado (US$)', 'Total pagado (Bs)'] as const;
const SEL_META_ROW = 0;
const SEL_TASA_ROW = 1;
const SEL_HEADER_ROW = 3;
const SEL_FIRST_DATA_ROW = 4;

/**
 * Genera y descarga el listado de personas SELECCIONADAS en la vista "Por persona",
 * con su total pagado histórico, siguiendo el mismo patrón de tasa BCV editable +
 * fórmula en Bs que el resto de los Excel de este archivo.
 */
export function exportPersonasSeleccionadasXlsx(
  rows: PersonasSeleccionadasXlsxRow[],
  bcvRate: number | null,
): boolean {
  const wb = XLSX.utils.book_new();
  const nCols = SEL_COLS.length;
  const blankRow = (n: number) => new Array(n).fill('');

  const aoa: any[][] = [];
  aoa[SEL_META_ROW] = ['Personas seleccionadas:', `${rows.length} persona(s)`, ...blankRow(nCols - 2)];
  aoa[SEL_TASA_ROW] = ['Tasa BCV del día (Bs/US$):', bcvRate ?? 0, ...blankRow(nCols - 2)];
  aoa[2] = blankRow(nCols);
  aoa[SEL_HEADER_ROW] = [...SEL_COLS];
  rows.forEach((r, i) => {
    aoa[SEL_FIRST_DATA_ROW + i] = [r.nombre, r.cedula || '', r.cargo || '', r.total || 0, 0];
  });
  const totalRow = SEL_FIRST_DATA_ROW + rows.length;
  aoa[totalRow] = ['TOTAL', `${rows.length} persona(s)`, '', 0, 0];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: SEL_HEADER_ROW, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = HEADER_STYLE;
  }
  const metaLabelRef = XLSX.utils.encode_cell({ r: SEL_META_ROW, c: 0 });
  if ((ws as any)[metaLabelRef]) (ws as any)[metaLabelRef].s = META_STYLE;
  const labelRef = XLSX.utils.encode_cell({ r: SEL_TASA_ROW, c: 0 });
  const rateRef = XLSX.utils.encode_cell({ r: SEL_TASA_ROW, c: 1 });
  if ((ws as any)[labelRef]) (ws as any)[labelRef].s = TASA_LABEL_STYLE;
  if ((ws as any)[rateRef]) { (ws as any)[rateRef].s = TASA_VALUE_STYLE; (ws as any)[rateRef].z = MONEY_FMT; }

  // Total US$ (col 3) + fórmula en Bs (col 4) referenciando la tasa en $B$2.
  rows.forEach((_r, i) => {
    const row = SEL_FIRST_DATA_ROW + i;
    const usdRef = XLSX.utils.encode_cell({ r: row, c: 3 });
    const usdCell = (ws as any)[usdRef];
    if (usdCell) { usdCell.z = MONEY_FMT; usdCell.t = 'n'; }
    const bsRef = XLSX.utils.encode_cell({ r: row, c: 4 });
    (ws as any)[bsRef] = { t: 'n', z: MONEY_FMT, f: `D${row + 1}*$B$${SEL_TASA_ROW + 1}` };
  });

  // Fila TOTAL: suma de US$ y Bs.
  if (rows.length) {
    const firstExcelRow = SEL_FIRST_DATA_ROW + 1;
    const lastExcelRow = SEL_FIRST_DATA_ROW + rows.length;
    [3, 4].forEach((c) => {
      const colLetter = XLSX.utils.encode_col(c);
      const ref = XLSX.utils.encode_cell({ r: totalRow, c });
      (ws as any)[ref] = { t: 'n', z: MONEY_FMT, f: `SUM(${colLetter}${firstExcelRow}:${colLetter}${lastExcelRow})` };
    });
  }
  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: totalRow, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = { ...(cell as any).s, ...TOTAL_STYLE };
    else (ws as any)[ref] = { t: 's', v: '', s: TOTAL_STYLE };
  }

  ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 22 }, { wch: 15 }, { wch: 15 }];
  ws['!rows'] = [{ hpt: 20 }, { hpt: 20 }, { hpt: 6 }, { hpt: 30 }];
  ws['!merges'] = [
    { s: { r: SEL_META_ROW, c: 1 }, e: { r: SEL_META_ROW, c: nCols - 1 } },
    { s: { r: SEL_TASA_ROW, c: 2 }, e: { r: SEL_TASA_ROW, c: nCols - 1 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Personas seleccionadas');
  return downloadWorkbook(wb, `Personas seleccionadas - ${rows.length}`);
}
