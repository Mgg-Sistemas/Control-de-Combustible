import { Platform } from 'react-native';
import * as XLSX from 'xlsx-js-style';
import { DatosInformeConciliacion } from './combustiblePdf';

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function downloadWorkbook(wb: XLSX.WorkBook, fileName: string): boolean {
  if (Platform.OS !== 'web') return false;
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const d: any = (globalThis as any).document;
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a: any = d.createElement('a');
  a.href = url;
  a.download = `${safeName(fileName)}.xlsx`;
  d.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

const TITLE_STYLE = {
  font: { bold: true, sz: 14, color: { rgb: '1E3A5F' } },
  alignment: { horizontal: 'left', vertical: 'center' },
};

const SUBTITLE_STYLE = {
  font: { sz: 10, color: { rgb: '555555' } },
  alignment: { horizontal: 'left', vertical: 'center' },
};

const HEADER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '1E3A5F' } },
  font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 10 },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
};

const DATA_STYLE = {
  font: { sz: 10, color: { rgb: '222222' } },
  alignment: { horizontal: 'right', vertical: 'center' },
};

const DATA_LEFT_STYLE = {
  font: { sz: 10, color: { rgb: '222222' } },
  alignment: { horizontal: 'left', vertical: 'center' },
};

const TOTAL_STYLE = {
  font: { bold: true, sz: 10, color: { rgb: '000000' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'EAEFF5' } },
  alignment: { horizontal: 'right', vertical: 'center' },
};

const TOTAL_LEFT_STYLE = {
  font: { bold: true, sz: 10, color: { rgb: '000000' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'EAEFF5' } },
  alignment: { horizontal: 'left', vertical: 'center' },
};

const NUM_FMT = '#,##0';
const PCT_FMT = '0.0%';

export async function exportarConciliacionExcel(datos: DatosInformeConciliacion): Promise<boolean> {
  const wb = XLSX.utils.book_new();

  const headers = [
    'Tanque / Cisterna',
    'Combustible',
    'Capacidad (L)',
    'Saldo Inicial (L)',
    '(+) Entradas (L)',
    '(-) Despachos (L)',
    '(±) Traslados (L)',
    '(=) Saldo Teórico (L)',
    'Saldo Físico / Vara (L)',
    'Diferencia (L)',
    '% Variación',
    'Estado',
  ];

  const aoa: any[][] = [];

  // Fila 0: Título principal
  aoa.push(['ACTA DE CONCILIACIÓN Y CIERRE DE COMBUSTIBLE']);
  // Fila 1: Período
  aoa.push([`Período auditado: ${datos.periodoDesde} hasta ${datos.periodoHasta}`]);
  // Fila 2: Responsables
  aoa.push([`Elaborado por: ${datos.elaboradoPor} | Revisado por: ${datos.revisadoPor || 'Auditoría Interna'}`]);
  // Fila 3: Espacio en blanco
  aoa.push([]);
  // Fila 4: Encabezados de tabla
  aoa.push(headers);

  // Fila 5+: Filas de datos
  const startRow = 5;
  datos.filas.forEach((f) => {
    aoa.push([
      f.tanqueNombre,
      f.combustible || 'Gasoil / Diesel',
      f.capacidadL,
      f.saldoInicialL,
      f.entradasL,
      f.despachosL,
      f.trasladosNetosL,
      f.saldoTeoricoL,
      f.saldoFisicoVaraL,
      f.diferenciaL,
      f.pctDiferencia / 100,
      f.estado === 'merma' ? 'MERMA' : f.estado === 'sobrante' ? 'SOBRANTE' : 'CUADRADO',
    ]);
  });

  // Fila Totales
  const totCap = datos.filas.reduce((s, f) => s + f.capacidadL, 0);
  const totIni = datos.filas.reduce((s, f) => s + f.saldoInicialL, 0);
  const totEnt = datos.filas.reduce((s, f) => s + f.entradasL, 0);
  const totDes = datos.filas.reduce((s, f) => s + f.despachosL, 0);
  const totTra = datos.filas.reduce((s, f) => s + f.trasladosNetosL, 0);
  const totTeo = datos.filas.reduce((s, f) => s + f.saldoTeoricoL, 0);
  const totFis = datos.filas.reduce((s, f) => s + f.saldoFisicoVaraL, 0);
  const totDif = totFis - totTeo;
  const totPct = totTeo > 0 ? totDif / totTeo : 0;

  aoa.push([
    'TOTAL GENERAL',
    '',
    totCap,
    totIni,
    totEnt,
    totDes,
    totTra,
    totTeo,
    totFis,
    totDif,
    totPct,
    totDif < -50 ? 'MERMA GLOBAL' : totDif > 50 ? 'SOBRANTE GLOBAL' : 'CUADRADO',
  ]);

  if (datos.observaciones) {
    aoa.push([]);
    aoa.push([`Observaciones: ${datos.observaciones}`]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Anchos de columna
  ws['!cols'] = [
    { wch: 28 }, // Tanque
    { wch: 18 }, // Combustible
    { wch: 15 }, // Capacidad
    { wch: 16 }, // Saldo Inicial
    { wch: 16 }, // Entradas
    { wch: 16 }, // Despachos
    { wch: 16 }, // Traslados
    { wch: 18 }, // Saldo Teórico
    { wch: 20 }, // Saldo Físico
    { wch: 16 }, // Diferencia
    { wch: 14 }, // %
    { wch: 18 }, // Estado
  ];

  // Aplicar estilos
  const titleRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[titleRef]) (ws[titleRef] as any).s = TITLE_STYLE;

  const sub1Ref = XLSX.utils.encode_cell({ r: 1, c: 0 });
  if (ws[sub1Ref]) (ws[sub1Ref] as any).s = SUBTITLE_STYLE;

  const sub2Ref = XLSX.utils.encode_cell({ r: 2, c: 0 });
  if (ws[sub2Ref]) (ws[sub2Ref] as any).s = SUBTITLE_STYLE;

  // Header row (r=4)
  for (let c = 0; c < headers.length; c++) {
    const ref = XLSX.utils.encode_cell({ r: 4, c });
    if (ws[ref]) (ws[ref] as any).s = HEADER_STYLE;
  }

  // Data rows
  datos.filas.forEach((f, idx) => {
    const r = startRow + idx;
    for (let c = 0; c < headers.length; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref];
      if (!cell) continue;

      if (c === 0 || c === 1 || c === 11) {
        cell.s = DATA_LEFT_STYLE;
        if (c === 11) {
          // Color de estado
          const stColor = f.estado === 'merma' ? 'B91C1C' : f.estado === 'sobrante' ? '15803D' : '0369A1';
          cell.s = { ...DATA_LEFT_STYLE, font: { bold: true, sz: 10, color: { rgb: stColor } } };
        }
      } else {
        cell.s = DATA_STYLE;
        if (c === 10) {
          cell.z = PCT_FMT;
        } else {
          cell.z = NUM_FMT;
        }
        if (c === 9 && f.diferenciaL < 0) {
          cell.s = { ...DATA_STYLE, font: { bold: true, sz: 10, color: { rgb: 'B91C1C' } } };
        }
      }
    }
  });

  // Totales row
  const totalRowIdx = startRow + datos.filas.length;
  for (let c = 0; c < headers.length; c++) {
    const ref = XLSX.utils.encode_cell({ r: totalRowIdx, c });
    const cell = ws[ref];
    if (!cell) continue;
    if (c === 0 || c === 1 || c === 11) {
      cell.s = TOTAL_LEFT_STYLE;
    } else {
      cell.s = TOTAL_STYLE;
      if (c === 10) {
        cell.z = PCT_FMT;
      } else {
        cell.z = NUM_FMT;
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Conciliación');
  const fileName = `Conciliacion_Combustible_${datos.periodoDesde}_a_${datos.periodoHasta}`;
  return downloadWorkbook(wb, fileName);
}
