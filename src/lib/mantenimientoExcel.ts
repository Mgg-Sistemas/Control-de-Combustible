// 📊 IMPORTACIÓN DE EXCEL / CSV DE MANTENIMIENTOS PREVENTIVOS (24-nov-2026).
//
// Lee la planilla multi-mes del cliente (bloques por empresa con columnas:
//   Equipo | Marca / Modelo | Serial / Placa |
//   Horometro Actual (HORAS) | Horometro Proximo Cambio (250H) | Fecha (MM/YYYY) | ... | LT | UBICACIÓN)
//
// Extrae cada servicio válido por fecha/horómetro, cruza por Serial / Placa contra
// el catálogo de `machinery`, detecta duplicados ya guardados en
// `machinery_preventive_services` y ordena cronológicamente para que el servicio
// más reciente quede como `horometro_base` vigente.
//
// ⭐ Módulo de parseo PURO (xlsx-js-style solo para leer bytes de .xlsx/.csv).
import * as XLSX from 'xlsx-js-style';
import { leerNumero } from './numeros';
import type { ServicioPreventivoRow } from './mantenimientoPreventivo';

export type MaquinaCatalogoExcel = {
  id: string;
  code: string;
  plate: string | null;
  serial: string | null;
  company: string;
  last_horometro: number | null;
  horometro_base: number | null;
};

export type ServicioExcelDetectado = {
  filaExcel: number;
  empresaPlanilla: string;
  equipoPlanilla: string;
  marcaPlanilla: string;
  serialPlacaPlanilla: string;
  machineryId: string;
  machineCode: string;
  machinePlate: string | null;
  machineCompany: string;
  lastHorometro: number | null;
  horometroBaseActual: number | null;
  horometroServicio: number;
  proximoCambioPlanilla: number | null;
  fechaServicio: string; // YYYY-MM-DD
  litros: number | null;
  ubicacion: string | null;
  mesEtiqueta: string;
  duplicado: boolean;
};

export type FilaOmitidaExcel = {
  filaExcel: number;
  equipo: string;
  serialPlaca: string;
  motivo: string;
};

export type ResultadoParseoMantenimientoExcel = {
  servicios: ServicioExcelDetectado[];
  nuevos: ServicioExcelDetectado[];
  duplicados: number;
  omitidas: FilaOmitidaExcel[];
  maquinasCoincidentes: number;
  error?: string;
};

function normAlnum(v: unknown): string {
  return String(v ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normTexto(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte serial numérico de Excel (ej. 46245) o texto YYYY-MM-DD / DD/MM/YYYY a YYYY-MM-DD. */
export function parsearFechaExcel(raw: unknown, mesFallback?: { year: string; month: string } | null): string | null {
  if (raw == null || String(raw).trim() === '') {
    return mesFallback ? `${mesFallback.year}-${mesFallback.month}-01` : null;
  }
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  // YYYY-MM-DD
  const mIso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (mIso) {
    const y = mIso[1];
    const mo = mIso[2].padStart(2, '0');
    const d = mIso[3].padStart(2, '0');
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${mo}-${d}`;
    }
  }
  // DD/MM/YYYY o DD-MM-YYYY
  const mLat = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mLat) {
    const d = mLat[1].padStart(2, '0');
    const mo = mLat[2].padStart(2, '0');
    const y = mLat[3];
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${mo}-${d}`;
    }
  }
  // Serial numérico de Excel (ej. 46245)
  const n = Number(s);
  if (Number.isFinite(n) && n > 30000 && n < 80000) {
    const ms = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return mesFallback ? `${mesFallback.year}-${mesFallback.month}-01` : null;
}

function parsearLitros(raw: unknown): number | null {
  const s = String(raw ?? '').trim().replace(/lt/gi, '').trim();
  if (!s) return null;
  const n = leerNumero(s);
  return n != null && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function parsearHorometroCelda(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null;
  }
  const s = String(raw).trim();
  if (!s || s.includes(':')) return null; // ignora horas HH:MM:SS de plantas sin lectura numérica
  const n = leerNumero(s);
  return n != null && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

type BloqueMesCols = {
  idxActual: number;
  idxProximo: number;
  idxFecha: number;
  etiqueta: string;
  mesFallback: { year: string; month: string } | null;
};

type HeaderBloque = {
  idxEquipo: number;
  idxMarca: number;
  idxSerial: number;
  idxLt: number;
  idxUbicacion: number;
  meses: BloqueMesCols[];
};

function detectarCabecera(row: unknown[]): HeaderBloque | null {
  const norms = row.map((c) => normTexto(c));
  const idxEquipo = norms.findIndex((c) => c === 'equipo' || c.startsWith('equipo '));
  const idxSerial = norms.findIndex((c) => c.includes('serial') || c.includes('placa'));
  if (idxEquipo < 0 || idxSerial < 0) return null;

  const idxMarca = norms.findIndex((c) => c.includes('marca'));
  const idxLt = norms.findIndex((c) => c === 'lt' || c === 'litros');
  const idxUbicacion = norms.findIndex((c) => c.includes('ubicacion'));

  const meses: BloqueMesCols[] = [];
  for (let i = 0; i < norms.length; i++) {
    const col = norms[i];
    if (col.includes('horometro') && col.includes('actual')) {
      const idxProximo = norms[i + 1]?.includes('proximo') ? i + 1 : -1;
      const idxFecha = norms[i + 2]?.includes('fecha') ? i + 2 : (norms[i + 1]?.includes('fecha') ? i + 1 : -1);
      const rawFechaHead = idxFecha >= 0 ? String(row[idxFecha] ?? '') : '';
      const mMes = rawFechaHead.match(/(\d{2})\/(\d{4})/);
      meses.push({
        idxActual: i,
        idxProximo,
        idxFecha,
        etiqueta: mMes ? `${mMes[1]}/${mMes[2]}` : `Bloque ${meses.length + 1}`,
        mesFallback: mMes ? { month: mMes[1], year: mMes[2] } : null,
      });
    }
  }

  if (meses.length === 0) return null;
  return { idxEquipo, idxMarca, idxSerial, idxLt, idxUbicacion, meses };
}

function buscarMaquinaPorSerialOPlaca(
  serialPlaca: string,
  catalogo: readonly MaquinaCatalogoExcel[]
): MaquinaCatalogoExcel | null {
  const target = normAlnum(serialPlaca);
  if (!target) return null;

  // 1. Coincidencia exacta por serial o placa normalizada
  const exact = catalogo.find(
    (m) => normAlnum(m.serial) === target || normAlnum(m.plate) === target
  );
  if (exact) return exact;

  // 2. Coincidencia por sufijo de >= 5 caracteres (ej. 03RHLTZ555570 vs FTC03RHLTZ555570)
  if (target.length >= 5) {
    const suffixMatches = catalogo.filter((m) => {
      const s = normAlnum(m.serial);
      const p = normAlnum(m.plate);
      return (s.length >= 5 && (s.endsWith(target) || target.endsWith(s))) ||
             (p.length >= 5 && (p.endsWith(target) || target.endsWith(p)));
    });
    if (suffixMatches.length === 1) return suffixMatches[0];
  }

  return null;
}

/**
 * Parsea la matriz de celdas (array de filas) del Excel/CSV de mantenimiento preventivo.
 */
export function parsearMatrizMantenimientoExcel(
  rows: unknown[][],
  catalogo: readonly MaquinaCatalogoExcel[],
  serviciosExistentes: readonly Pick<ServicioPreventivoRow, 'machinery_id' | 'horometro_servicio' | 'fecha_servicio' | 'anulado'>[] = []
): ResultadoParseoMantenimientoExcel {
  let header: HeaderBloque | null = null;
  let empresaActual = '';
  let ultimaUbicacion = '';

  const existentesSet = new Set<string>();
  serviciosExistentes.forEach((s) => {
    if (s.anulado) return;
    const f = String(s.fecha_servicio ?? '').slice(0, 10);
    const h = Math.round(Number(s.horometro_servicio) * 100) / 100;
    existentesSet.add(`${s.machinery_id}|${f}|${h}`);
  });

  const detectados: ServicioExcelDetectado[] = [];
  const omitidas: FilaOmitidaExcel[] = [];
  const maquinasSet = new Set<string>();

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const noVacios = row.filter((c) => String(c ?? '').trim() !== '');
    if (noVacios.length === 0) continue;

    // Detectar si esta fila es una cabecera de bloque
    const nuevaCab = detectarCabecera(row);
    if (nuevaCab) {
      header = nuevaCab;
      ultimaUbicacion = '';
      continue;
    }

    const col0 = String(row[0] ?? '').trim();
    const rowJoined = row.map((c) => String(c ?? '').trim()).join(' ');

    // Saltar filas de TOTALES o cabeceras de tablas resumen finales
    if (/^total\s*:/i.test(rowJoined) || /TOTAL:\s*\d+/i.test(rowJoined)) continue;
    if (/^equipo$/i.test(col0) && normTexto(row[1]).includes('marca')) {
      header = null; // entramos en las tablas resumen del final
      continue;
    }

    // Fila de título de empresa (solo col0 con texto, sin serial/placa en columna serial)
    if (noVacios.length === 1 && col0 && !/^(\/\/|-)$/.test(col0)) {
      empresaActual = col0;
      continue;
    }

    if (!header) continue;

    const equipo = String(row[header.idxEquipo] ?? '').trim();
    const serialPlaca = String(row[header.idxSerial] ?? '').trim();
    if (!equipo && !serialPlaca) continue;

    const marca = header.idxMarca >= 0 ? String(row[header.idxMarca] ?? '').trim() : '';
    const litros = header.idxLt >= 0 ? parsearLitros(row[header.idxLt]) : null;
    const rawUbi = header.idxUbicacion >= 0 ? String(row[header.idxUbicacion] ?? '').trim() : '';
    if (rawUbi === '//') {
      // Hereda ubicación de la fila anterior del mismo bloque
    } else if (rawUbi) {
      ultimaUbicacion = rawUbi;
    }
    const ubicacion = rawUbi === '//' ? (ultimaUbicacion || null) : (rawUbi || null);

    // Extraer los servicios de cada columna mensual de esta fila
    const serviciosFila: {
      horometro: number;
      proximo: number | null;
      fecha: string;
      etiqueta: string;
    }[] = [];

    for (const mes of header.meses) {
      const hAct = parsearHorometroCelda(row[mes.idxActual]);
      if (hAct == null) continue;
      const fecha = parsearFechaExcel(mes.idxFecha >= 0 ? row[mes.idxFecha] : null, mes.mesFallback);
      if (!fecha) continue;
      const prox = mes.idxProximo >= 0 ? parsearHorometroCelda(row[mes.idxProximo]) : null;
      serviciosFila.push({ horometro: hAct, proximo: prox, fecha, etiqueta: mes.etiqueta });
    }

    if (serviciosFila.length === 0) continue; // fila sin registros de horómetro (ej. equipo sin cambio aún)

    const mac = buscarMaquinaPorSerialOPlaca(serialPlaca, catalogo);
    if (!mac) {
      omitidas.push({
        filaExcel: r + 1,
        equipo: equipo || '—',
        serialPlaca: serialPlaca || 'Sin serial/placa',
        motivo: 'No se encontró ninguna máquina con ese serial o placa en el catálogo.',
      });
      continue;
    }

    maquinasSet.add(mac.id);

    for (const srv of serviciosFila) {
      const clave = `${mac.id}|${srv.fecha}|${srv.horometro}`;
      const duplicado = existentesSet.has(clave);
      existentesSet.add(clave); // evita duplicados internos dentro del mismo Excel
      detectados.push({
        filaExcel: r + 1,
        empresaPlanilla: empresaActual,
        equipoPlanilla: equipo,
        marcaPlanilla: marca,
        serialPlacaPlanilla: serialPlaca,
        machineryId: mac.id,
        machineCode: mac.code,
        machinePlate: mac.plate,
        machineCompany: mac.company,
        lastHorometro: mac.last_horometro,
        horometroBaseActual: mac.horometro_base,
        horometroServicio: srv.horometro,
        proximoCambioPlanilla: srv.proximo,
        fechaServicio: srv.fecha,
        litros,
        ubicacion,
        mesEtiqueta: srv.etiqueta,
        duplicado,
      });
    }
  }

  // Ordenar cronológicamente ascendente por fecha y horómetro para que al guardar en secuencia
  // el servicio más reciente quede al final como `horometro_base` vigente en `machinery`.
  detectados.sort(
    (a, b) => a.fechaServicio.localeCompare(b.fechaServicio) || a.horometroServicio - b.horometroServicio
  );

  const nuevos = detectados.filter((d) => !d.duplicado);
  const duplicados = detectados.length - nuevos.length;

  return {
    servicios: detectados,
    nuevos,
    duplicados,
    omitidas,
    maquinasCoincidentes: maquinasSet.size,
  };
}

/** Lee un ArrayBuffer de .xlsx / .xls / .csv con `xlsx-js-style` y devuelve su matriz de filas. */
export function leerFilasDesdeBufferExcel(data: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
}
