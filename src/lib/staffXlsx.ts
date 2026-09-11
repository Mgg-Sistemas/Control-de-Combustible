import { Platform } from 'react-native';
import * as XLSX from 'xlsx-js-style';
import { SIN_DEPARTAMENTO } from './nominaDepartamentos';

/**
 * EXPORTACIÓN A EXCEL — Nómina / Pago a personal.
 * Usa xlsx-js-style (igual que src/lib/inspeccionBulk.ts). NO usa el generador
 * artesanal src/lib/xlsx.ts (ese es específico de Inventario).
 *
 * La hoja lista, por PERSONA, lo trabajado y lo PAGADO/adeudado en el período de
 * nómina seleccionado (no las tarifas del empleado — eso se ve en "Empleados").
 * Los montos van SOLO en US$ (el sistema no muestra Bs ni la tasa BCV en los
 * reportes/documentos exportados, solo la usa internamente).
 */

export type PagoPersonalXlsxRow = {
  // DEPARTAMENTO al que pertenece la persona. Es lo que parte la hoja en
  // secciones. Viene ya resuelto y ya unificado desde `src/lib/nominaDepartamentos.ts`:
  // aquí NO se deduce nada ni se corrige ninguna escritura, porque el nombre de
  // una sección depende de todos los cargos del período, y este archivo solo ve
  // las filas que le pasan.
  departamento: string;
  nombre: string;
  cedula: string;
  cargo: string;
  cuenta: string;       // número de cuenta bancaria del trabajador (ficha de perfil)
  // TITULAR de la cuenta. Va aparte del trabajador A PROPÓSITO: muchas veces la
  // cuenta es de un familiar, y el banco rechaza la transferencia si el nombre y la
  // cédula no son los del dueño de la cuenta. Cuando la ficha no los trae, se
  // asume que el titular es el propio trabajador (misma regla que el recibo PDF).
  titular: string;
  cedulaTitular: string;
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
  cargoFiltro?: string;  // si el reporte respeta un filtro por cargo, se anota aquí
  deptoFiltro?: string;  // ídem para el filtro por departamento
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
const TOTAL_STYLE = {
  font: { bold: true, sz: 11 },
  fill: { patternType: 'solid', fgColor: { rgb: 'EEF2F7' } },
} as const;
/** Franja que abre cada DEPARTAMENTO. Mismo azul del encabezado, a lo ancho. */
const DEPTO_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '1E3A5F' } },
  font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 11 },
  alignment: { horizontal: 'left', vertical: 'center' },
} as const;
/** Subtotal de un departamento: gris claro, como la fila TOTAL pero más suave. */
const SUBTOTAL_STYLE = {
  font: { bold: true, sz: 10 },
  fill: { patternType: 'solid', fgColor: { rgb: 'DCE6F1' } },
} as const;
const MONEY_FMT = '#,##0.00';
const QTY_FMT = '#,##0.##';

const COLS = [
  'Ítem',
  'Nombre completo', 'Cédula', 'Cargo', 'Nº Cuenta', 'Titular de la cuenta', 'C.I. del titular',
  'Días', 'Noches', 'Horas', 'Semanas',
  'Devengado (US$)', 'Bonos (US$)', 'Deducciones (US$)', 'Total (US$)', 'Pagado (US$)', 'Saldo (US$)',
] as const;

// Columnas de texto de cada persona, en el orden de `COLS` después de "Ítem".
// Se declaran aparte para que la fila de datos no sea una hilera de valores sueltos
// que hay que contar con el dedo contra el encabezado.
const COL_ITEM = COLS.indexOf('Ítem');
const COL_NOMBRE = COLS.indexOf('Nombre completo');
// Primera columna de cantidad: hasta ahí llega el rótulo de los subtotales.
const COL_PRIMERA_CANTIDAD = COLS.indexOf('Días');

// ⚠️ Los índices de columna se DEDUCEN de `COLS`, no se escriben a mano. Antes eran
// listas de números sueltos (`[8,9,10,11,12,13]`) y un `c >= 7` perdido más abajo:
// agregar una columna obligaba a acordarse de correr cuatro sitios distintos, y si
// se olvidaba uno la hoja salía con los formatos cambiados de lugar sin avisar.
// Pasó justo al sumar el titular y su cédula (19-ago-2026).
const USD_COLS = COLS.map((h, i) => (h.includes('US$') ? i : -1)).filter((i) => i >= 0);
const QTY_COLS = (['Días', 'Noches', 'Horas', 'Semanas'] as const).map((h) => COLS.indexOf(h));

// Filas fijas del encabezado: 0 = contexto del período, 1 = blanco, 2 = encabezado de columnas.
const META_ROW = 0;
const HEADER_ROW = 2;
const FIRST_DATA_ROW = 3; // 0-indexed → fila 4 de Excel

/**
 * Genera y descarga el listado de PAGOS A PERSONAL del período dado: por cada
 * persona, lo trabajado (días/noches/horas/semanas), devengado, bonos,
 * deducciones, total, pagado y saldo — en US$.
 *
 * La hoja va PARTIDA POR DEPARTAMENTO, que es como la revisa quien la aprueba:
 * una franja azul abre cada departamento, su gente se numera desde 1, y cierra
 * con su propio subtotal. Al final, el TOTAL del período suma esos subtotales.
 *
 * ⚠️ EL ORDEN DE LAS SECCIONES LO DECIDE QUIEN LLAMA, no este archivo: los
 *    departamentos salen en el orden en que aparecen en `rows`. Es a propósito.
 *    El orden es una regla de negocio —la jerarquía de la empresa— y vive en
 *    `src/lib/nominaDepartamentos.ts` junto con la unificación de los nombres. Si
 *    aquí se reordenara por nuestra cuenta, la pantalla y el Excel mostrarían los
 *    mismos departamentos en distinto orden, y nadie sabría cuál de los dos manda.
 */
export function exportPagoPersonalXlsx(rows: PagoPersonalXlsxRow[], _bcvRate: number | null, meta: PagoPersonalXlsxMeta): boolean {
  const wb = XLSX.utils.book_new();
  const nCols = COLS.length;
  const blankRow = (n: number) => new Array(n).fill('');
  const esNumerica = (c: number) => QTY_COLS.includes(c) || USD_COLS.includes(c);

  const aoa: any[][] = [];
  const metaTxt = `${meta.periodo} · ${meta.tipo} · ${meta.desde} → ${meta.hasta} · ${meta.modo} · ${meta.estado} · ${meta.empresa}` +
    (meta.cargoFiltro ? ` · Cargo(s): ${meta.cargoFiltro}` : '') +
    (meta.deptoFiltro ? ` · Departamento(s): ${meta.deptoFiltro}` : '');
  aoa[META_ROW] = ['Período:', metaTxt, ...blankRow(nCols - 2)];
  aoa[1] = blankRow(nCols);
  aoa[HEADER_ROW] = [...COLS];

  // Agrupa por departamento CONSERVANDO EL ORDEN DE LLEGADA (ver la nota de arriba).
  const grupos: { depto: string; gente: PagoPersonalXlsxRow[] }[] = [];
  const porDepto = new Map<string, PagoPersonalXlsxRow[]>();
  rows.forEach((r) => {
    const depto = (r.departamento || '').trim() || SIN_DEPARTAMENTO;
    let gente = porDepto.get(depto);
    if (!gente) { gente = []; porDepto.set(depto, gente); grupos.push({ depto, gente }); }
    gente.push(r);
  });

  // Se recorre con un cursor de fila porque cada departamento aporta un número
  // distinto de filas (franja + su gente + subtotal): no hay cuenta que dé la
  // posición de una fila sin haber colocado antes todas las anteriores.
  const filasFranja: number[] = [];
  const filasDatos: number[] = [];
  const filasSubtotal: number[] = [];
  const rangos: [number, number][] = []; // primera y última fila de gente de cada grupo
  let fila = FIRST_DATA_ROW;
  for (const g of grupos) {
    filasFranja.push(fila);
    aoa[fila] = [`${g.depto} — ${g.gente.length} persona(s)`, ...blankRow(nCols - 1)];
    fila++;
    const desde = fila;
    g.gente.forEach((r, i) => {
      aoa[fila] = [
        i + 1, // el ítem REINICIA en 1 en cada departamento, como la nómina de siempre
        r.nombre, r.cedula || '', r.cargo || '', r.cuenta || '', r.titular || '', r.cedulaTitular || '',
        r.dias || 0, r.dias_noche || 0, r.horas || 0, r.semanas || 0,
        r.devengado || 0, r.bonos || 0, r.deducciones || 0, r.total || 0, r.pagado || 0, r.saldo || 0,
      ];
      filasDatos.push(fila);
      fila++;
    });
    rangos.push([desde, fila - 1]);
    aoa[fila] = COLS.map((_h, c) => (c === COL_NOMBRE ? `Subtotal ${g.depto}` : esNumerica(c) ? 0 : ''));
    filasSubtotal.push(fila);
    fila++;
  }

  const totalRow = fila;
  // Se arma DESDE `COLS` para que no se descuadre al agregar columnas (ver nota arriba).
  aoa[totalRow] = COLS.map((_h, c) =>
    c === COL_ITEM ? 'TOTAL'
    : c === COL_NOMBRE ? `${rows.length} persona(s)`
    : esNumerica(c) ? 0
    : '');

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  /**
   * Pinta una fila DE PUNTA A PUNTA. El estilo en esta librería se pone celda por
   * celda: no existe pintar una fila entera de un golpe, y si se pinta solo la
   * celda con texto la franja del departamento sale cortada donde acabó la palabra.
   *
   * Las filas de arriba se arman rellenas de cadenas vacías, así que todas sus
   * celdas existen. El `else` es el seguro para cuando no: a una celda que no
   * existe no se le puede poner estilo, hay que crearla.
   */
  const pintar = (r: number, estilo: any) => {
    for (let c = 0; c < nCols; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = (ws as any)[ref];
      if (cell) (cell as any).s = { ...(cell as any).s, ...estilo };
      else (ws as any)[ref] = { t: 's', v: '', s: estilo };
    }
  };

  // Encabezado de columnas (fila HEADER_ROW).
  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: HEADER_ROW, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = HEADER_STYLE;
  }
  // Contexto del período.
  const metaLabelRef = XLSX.utils.encode_cell({ r: META_ROW, c: 0 });
  if ((ws as any)[metaLabelRef]) (ws as any)[metaLabelRef].s = META_STYLE;

  // Cantidades y montos de cada persona: formato numérico.
  filasDatos.forEach((row) => {
    QTY_COLS.forEach((c) => {
      const cell = (ws as any)[XLSX.utils.encode_cell({ r: row, c })];
      if (cell) { cell.z = QTY_FMT; cell.t = 'n'; }
    });
    USD_COLS.forEach((c) => {
      const cell = (ws as any)[XLSX.utils.encode_cell({ r: row, c })];
      if (cell) { cell.z = MONEY_FMT; cell.t = 'n'; }
    });
  });

  // Subtotal de cada departamento: FÓRMULAS sobre su propio rango, no números
  // calculados aquí. Quien abra el Excel y borre una fila ve el subtotal
  // corregirse solo, en vez de quedarse con un número que ya no dice la verdad.
  filasSubtotal.forEach((row, i) => {
    const [desde, hasta] = rangos[i];
    [...QTY_COLS, ...USD_COLS].forEach((c) => {
      const letra = XLSX.utils.encode_col(c);
      (ws as any)[XLSX.utils.encode_cell({ r: row, c })] = {
        t: 'n', z: USD_COLS.includes(c) ? MONEY_FMT : QTY_FMT,
        f: `SUM(${letra}${desde + 1}:${letra}${hasta + 1})`,
      };
    });
  });

  // TOTAL del período: suma los SUBTOTALES, no las filas de gente. Un SUM del
  // rango completo contaría a cada persona dos veces, porque los subtotales están
  // metidos dentro de ese rango.
  if (filasSubtotal.length) {
    [...QTY_COLS, ...USD_COLS].forEach((c) => {
      const letra = XLSX.utils.encode_col(c);
      const refs = filasSubtotal.map((row) => `${letra}${row + 1}`).join(',');
      (ws as any)[XLSX.utils.encode_cell({ r: totalRow, c })] = {
        t: 'n', z: USD_COLS.includes(c) ? MONEY_FMT : QTY_FMT, f: `SUM(${refs})`,
      };
    });
  }

  filasFranja.forEach((row) => pintar(row, DEPTO_STYLE));
  filasSubtotal.forEach((row) => pintar(row, SUBTOTAL_STYLE));
  pintar(totalRow, TOTAL_STYLE);

  ws['!cols'] = [
    { wch: 6 },
    { wch: 26 }, { wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 26 }, { wch: 14 },
    { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 9 },
    { wch: 13 }, { wch: 11 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
  ];
  ws['!rows'] = [{ hpt: 20 }, { hpt: 6 }, { hpt: 30 }];
  ws['!merges'] = [
    { s: { r: META_ROW, c: 1 }, e: { r: META_ROW, c: nCols - 1 } },
    // La franja del departamento ocupa la fila entera; el rótulo del subtotal va
    // desde el nombre hasta justo antes de la primera cantidad.
    ...filasFranja.map((r) => ({ s: { r, c: 0 }, e: { r, c: nCols - 1 } })),
    ...filasSubtotal.map((r) => ({ s: { r, c: COL_NOMBRE }, e: { r, c: COL_PRIMERA_CANTIDAD - 1 } })),
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

const PERSONA_COLS = ['Período', 'Detalle', 'Método', 'Concepto', 'Monto (US$)'] as const;
const PERSONA_META_ROW = 0;
const PERSONA_HEADER_ROW = 2;
const PERSONA_FIRST_DATA_ROW = 3;

/**
 * Genera y descarga el historial de pagos de UN empleado (vista "Por persona"),
 * en US$ (el reporte no muestra Bs ni la tasa BCV).
 */
export function exportPersonaHistoricoXlsx(
  nombre: string,
  cedula: string,
  rows: PersonaXlsxRow[],
  _bcvRate: number | null,
  cuenta?: string | null,
  titular?: string | null,
  cedulaTitular?: string | null,
): boolean {
  const wb = XLSX.utils.book_new();
  const nCols = PERSONA_COLS.length;
  const blankRow = (n: number) => new Array(n).fill('');

  const aoa: any[][] = [];
  // El titular solo se nombra cuando NO es el propio trabajador: repetir su nombre
  // dos veces en la misma línea no aporta nada y estorba al leer.
  const otroTitular = !!(titular && titular.trim() && titular.trim().toUpperCase() !== nombre.trim().toUpperCase());
  const titularTxt = otroTitular
    ? ` · Titular ${titular!.trim()}${cedulaTitular ? ` (C.I. ${cedulaTitular})` : ''}`
    : '';
  aoa[PERSONA_META_ROW] = ['Trabajador:', `${nombre}${cedula ? ` · C.I. ${cedula}` : ''}${cuenta ? ` · Cuenta ${cuenta}` : ''}${titularTxt}`, ...blankRow(nCols - 2)];
  aoa[1] = blankRow(nCols);
  aoa[PERSONA_HEADER_ROW] = [...PERSONA_COLS];
  rows.forEach((r, i) => {
    const periodo = r.fechaHasta && r.fechaHasta !== r.fecha ? `${r.fecha} → ${r.fechaHasta}` : r.fecha;
    aoa[PERSONA_FIRST_DATA_ROW + i] = [periodo, r.detalle || '', r.metodo || '', r.concepto || '', r.monto || 0];
  });
  const totalRow = PERSONA_FIRST_DATA_ROW + rows.length;
  aoa[totalRow] = ['TOTAL', `${rows.length} pago(s)`, '', '', 0];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: PERSONA_HEADER_ROW, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = HEADER_STYLE;
  }
  const metaLabelRef = XLSX.utils.encode_cell({ r: PERSONA_META_ROW, c: 0 });
  if ((ws as any)[metaLabelRef]) (ws as any)[metaLabelRef].s = META_STYLE;

  // Monto US$ (col 4): formato de número.
  rows.forEach((_r, i) => {
    const row = PERSONA_FIRST_DATA_ROW + i;
    const usdRef = XLSX.utils.encode_cell({ r: row, c: 4 });
    const usdCell = (ws as any)[usdRef];
    if (usdCell) { usdCell.z = MONEY_FMT; usdCell.t = 'n'; }
  });

  // Fila TOTAL: suma de US$.
  if (rows.length) {
    const firstExcelRow = PERSONA_FIRST_DATA_ROW + 1;
    const lastExcelRow = PERSONA_FIRST_DATA_ROW + rows.length;
    const colLetter = XLSX.utils.encode_col(4);
    const ref = XLSX.utils.encode_cell({ r: totalRow, c: 4 });
    (ws as any)[ref] = { t: 'n', z: MONEY_FMT, f: `SUM(${colLetter}${firstExcelRow}:${colLetter}${lastExcelRow})` };
  }
  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: totalRow, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = { ...(cell as any).s, ...TOTAL_STYLE };
    else (ws as any)[ref] = { t: 's', v: '', s: TOTAL_STYLE };
  }

  ws['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 14 }, { wch: 22 }, { wch: 13 }];
  ws['!rows'] = [{ hpt: 20 }, { hpt: 6 }, { hpt: 30 }];
  ws['!merges'] = [
    { s: { r: PERSONA_META_ROW, c: 1 }, e: { r: PERSONA_META_ROW, c: nCols - 1 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Historial de pagos');
  return downloadWorkbook(wb, `Historial de pagos - ${nombre}`);
}

// ── Excel de un LOTE de personas seleccionadas ("Pago a Personal → Por persona") ──

export type PersonasSeleccionadasXlsxRow = {
  nombre: string;
  cedula: string;
  cargo: string;
  cuenta: string; // número de cuenta bancaria del trabajador (ficha de perfil)
  titular: string;        // dueño de la cuenta (puede NO ser el trabajador)
  cedulaTitular: string;
  total: number; // US$ — total pagado histórico de la persona
};

const SEL_COLS = ['Nombre completo', 'Cédula', 'Cargo', 'Nº Cuenta', 'Titular de la cuenta', 'C.I. del titular', 'Total pagado (US$)'] as const;
// Índice de la única columna de dinero, deducido de `SEL_COLS` (antes era un `4`
// escrito a mano en cuatro sitios: agregar columnas lo dejaba apuntando a otra).
const SEL_USD_COL = SEL_COLS.indexOf('Total pagado (US$)');
const SEL_META_ROW = 0;
const SEL_HEADER_ROW = 2;
const SEL_FIRST_DATA_ROW = 3;

/**
 * Genera y descarga el listado de personas SELECCIONADAS en la vista "Por persona",
 * con su total pagado histórico en US$.
 */
export function exportPersonasSeleccionadasXlsx(
  rows: PersonasSeleccionadasXlsxRow[],
  _bcvRate: number | null,
): boolean {
  const wb = XLSX.utils.book_new();
  const nCols = SEL_COLS.length;
  const blankRow = (n: number) => new Array(n).fill('');

  const aoa: any[][] = [];
  aoa[SEL_META_ROW] = ['Personas seleccionadas:', `${rows.length} persona(s)`, ...blankRow(nCols - 2)];
  aoa[1] = blankRow(nCols);
  aoa[SEL_HEADER_ROW] = [...SEL_COLS];
  rows.forEach((r, i) => {
    aoa[SEL_FIRST_DATA_ROW + i] = [r.nombre, r.cedula || '', r.cargo || '', r.cuenta || '', r.titular || '', r.cedulaTitular || '', r.total || 0];
  });
  const totalRow = SEL_FIRST_DATA_ROW + rows.length;
  aoa[totalRow] = SEL_COLS.map((_h, c) =>
    c === 0 ? 'TOTAL' : c === 1 ? `${rows.length} persona(s)` : c === SEL_USD_COL ? 0 : '');

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: SEL_HEADER_ROW, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = HEADER_STYLE;
  }
  const metaLabelRef = XLSX.utils.encode_cell({ r: SEL_META_ROW, c: 0 });
  if ((ws as any)[metaLabelRef]) (ws as any)[metaLabelRef].s = META_STYLE;

  // Total US$: formato de número.
  rows.forEach((_r, i) => {
    const row = SEL_FIRST_DATA_ROW + i;
    const usdRef = XLSX.utils.encode_cell({ r: row, c: SEL_USD_COL });
    const usdCell = (ws as any)[usdRef];
    if (usdCell) { usdCell.z = MONEY_FMT; usdCell.t = 'n'; }
  });

  // Fila TOTAL: suma de US$.
  if (rows.length) {
    const firstExcelRow = SEL_FIRST_DATA_ROW + 1;
    const lastExcelRow = SEL_FIRST_DATA_ROW + rows.length;
    const colLetter = XLSX.utils.encode_col(SEL_USD_COL);
    const ref = XLSX.utils.encode_cell({ r: totalRow, c: SEL_USD_COL });
    (ws as any)[ref] = { t: 'n', z: MONEY_FMT, f: `SUM(${colLetter}${firstExcelRow}:${colLetter}${lastExcelRow})` };
  }
  for (let c = 0; c < nCols; c++) {
    const ref = XLSX.utils.encode_cell({ r: totalRow, c });
    const cell = (ws as any)[ref];
    if (cell) (cell as any).s = { ...(cell as any).s, ...TOTAL_STYLE };
    else (ws as any)[ref] = { t: 's', v: '', s: TOTAL_STYLE };
  }

  ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 15 }];
  ws['!rows'] = [{ hpt: 20 }, { hpt: 6 }, { hpt: 30 }];
  ws['!merges'] = [
    { s: { r: SEL_META_ROW, c: 1 }, e: { r: SEL_META_ROW, c: nCols - 1 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Personas seleccionadas');
  return downloadWorkbook(wb, `Personas seleccionadas - ${rows.length}`);
}
