// 📊 FLETES POR EXCEL (11-nov-2026, a pedido: «poder cargar todo un Excel y que me haga la
// validación de no repetir los viajes; así como puedo descargar el reporte, poder subir todo
// con un Excel, descargar la plantilla y subirlo, sin que se rompa nada… y que no se pierda
// la información»).
//
//   · PLANTILLA: las columnas de la Relación de viajes + tipo, precio, empresa, cliente y nota,
//     con hojas de referencia (vehículos y empresas válidos) e instrucciones.
//   · RELACIÓN EN EXCEL: los fletes filtrados en ESE MISMO formato (se pueden editar y subir).
//   · SUBIR: se lee y se VALIDA fila por fila ANTES de guardar nada. Cada fila sale como
//     ✅ nueva, 🔁 repetida (dos veces en el archivo o ya en el sistema) o ❌ con error. Solo
//     se guarda lo que la persona confirma; lo repetido NO se sube salvo que se marque a mano.
//   · Se guarda IGUAL que el formulario (mismas columnas y la misma nota con su metadato).
//
// La lógica es pura (sin pantalla ni base): se prueba en scripts/test-fletes-excel.mjs.
import { Platform } from 'react-native';
import * as XLSX from 'xlsx-js-style';
import { formatFleteNote, parseFleteNote, type FleteOperacionTipo } from './fletePdf';
import { normalizarPlaca, pedazosPlaca } from './fleteRutaTraslado';
import { leerNumero } from './numeros';

/** Las columnas, en orden (las 8 de la Relación de viajes primero). */
export const COLUMNAS_FLETES = [
  'FECHA',
  'NOMBRE Y APELLIDO',
  'VEHÍCULO (placa o código)',
  'EQUIPO',
  'ORIGEN',
  'DESTINO',
  'VIAJES',
  'QUIÉN LO AUTORIZA',
  'TIPO (POR PAGAR / POR COBRAR / EXENTO)',
  'PRECIO POR VIAJE ($)',
  'EMPRESA',
  'CLIENTE',
  'NOTA',
] as const;

type Campo = 'fecha' | 'chofer' | 'vehiculo' | 'equipo' | 'origen' | 'destino' | 'viajes' | 'autoriza' | 'tipo' | 'precio' | 'empresa' | 'cliente' | 'nota';

const sinAcentos = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** El encabezado (como lo haya escrito la persona) → el campo. Reconoce por palabra clave. */
export function campoDeEncabezado(h: unknown): Campo | null {
  const t = sinAcentos(h);
  if (!t) return null;
  if (t.startsWith('fecha')) return 'fecha';
  if (/autoriz/.test(t)) return 'autoriza';
  if (/^(nombre|chofer|conductor)/.test(t)) return 'chofer';
  if (/^(vehiculo|placa|camion|chuto)/.test(t)) return 'vehiculo';
  if (/^equipo/.test(t)) return 'equipo';
  if (/^origen/.test(t)) return 'origen';
  if (/^destino/.test(t)) return 'destino';
  if (/^(viajes|n.? de viajes|cantidad)/.test(t)) return 'viajes';
  if (/^tipo/.test(t)) return 'tipo';
  if (/^(precio|tarifa)/.test(t)) return 'precio';
  if (/^(empresa|contratista)/.test(t)) return 'empresa';
  if (/^cliente/.test(t)) return 'cliente';
  if (/^(nota|detalle|observ)/.test(t)) return 'nota';
  return null;
}

/** Una fila del Excel tal cual (texto), con su número de fila en la hoja. */
export type FilaCruda = { n: number } & Partial<Record<Campo, unknown>>;

/** Lee la PRIMERA hoja que tenga el encabezado FECHA (la plantilla o una relación bajada). */
export function leerExcelFletes(data: ArrayBuffer): { filas: FilaCruda[]; error: string | null } {
  let wb: XLSX.WorkBook;
  try { wb = XLSX.read(data, { type: 'array' }); } catch { return { filas: [], error: 'No se pudo leer el archivo: ¿es un Excel (.xlsx)?' }; }
  for (const nombre of wb.SheetNames) {
    const ws = wb.Sheets[nombre];
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as any;
    // El encabezado puede no estar en la fila 1 (un título encima): se busca en las primeras 10.
    const iEnc = aoa.slice(0, 10).findIndex((r) => (r ?? []).some((c) => campoDeEncabezado(c) === 'fecha') && (r ?? []).some((c) => campoDeEncabezado(c) === 'viajes'));
    if (iEnc < 0) continue;
    const mapa = (aoa[iEnc] ?? []).map(campoDeEncabezado);
    const filas: FilaCruda[] = [];
    for (let i = iEnc + 1; i < aoa.length; i++) {
      const r = aoa[i] ?? [];
      if (!r.some((c) => String(c ?? '').trim())) continue; // fila vacía
      const f: FilaCruda = { n: i + 1 };
      mapa.forEach((campo, j) => { if (campo && f[campo] === undefined) f[campo] = r[j]; });
      // La fila TOTAL de una relación bajada no es un flete.
      if (/^total/.test(sinAcentos(f.fecha)) || /^total/.test(sinAcentos(r[0]))) continue;
      filas.push(f);
    }
    return { filas, error: filas.length ? null : 'La hoja tiene el encabezado pero ninguna fila con datos.' };
  }
  return { filas: [], error: 'No encontré una hoja con las columnas FECHA y VIAJES. Usa la plantilla.' };
}

/** FECHA: número de Excel, «dd/mm/aaaa», «d-m-aaaa» o «aaaa-mm-dd» → AAAA-MM-DD; null si no sirve. */
export function fechaDeCelda(v: unknown): string | null {
  const ok = (a: number, m: number, d: number) => {
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d && a >= 2000 && a <= 2100
      ? `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  };
  if (typeof v === 'number' && Number.isFinite(v)) {
    const p = (XLSX as any).SSF?.parse_date_code?.(v);
    return p ? ok(p.y, p.m, p.d) : null;
  }
  if (v instanceof Date && !isNaN(v.getTime())) return ok(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})$/);
  if (m) return ok(+m[3], +m[2], +m[1]);
  return null;
}

/** TIPO: vacío = por pagar (como el formulario). null si no se entiende. */
export function tipoDeCelda(v: unknown): FleteOperacionTipo | null {
  const t = sinAcentos(v).replace(/[_\-]/g, ' ');
  if (!t) return 'pagar';
  if (/exent/.test(t)) return 'exento';
  if (/cobr/.test(t)) return 'cobrar';
  if (/pag/.test(t)) return 'pagar';
  return null;
}

const TIPO_TXT: Record<FleteOperacionTipo, string> = { pagar: 'POR PAGAR', cobrar: 'POR COBRAR', exento: 'EXENTO' };

export type VehiculoRef = { id: string; code: string; plate?: string | null; company_id?: string | null };
export type EmpresaRef = { id: string; name: string };

/** El vehículo del Catálogo por su placa (o un pedazo de «CHUTO/LOWBOY») o por su código. */
export function buscarVehiculo(txt: unknown, vehiculos: VehiculoRef[]): { v: VehiculoRef | null; varios: boolean } {
  const q = normalizarPlaca(String(txt ?? ''));
  if (!q) return { v: null, varios: false };
  const piezas = pedazosPlaca(String(txt ?? ''));
  const porPlaca = vehiculos.filter((m) => { const p = pedazosPlaca(m.plate); return p.includes(q) || piezas.some((x) => p.includes(x)); });
  const lista = porPlaca.length ? porPlaca : vehiculos.filter((m) => normalizarPlaca(m.code) === q);
  return { v: lista[0] ?? null, varios: lista.length > 1 };
}

export function buscarEmpresa(txt: unknown, empresas: EmpresaRef[]): EmpresaRef | null {
  const q = sinAcentos(txt);
  if (!q) return null;
  return empresas.find((e) => sinAcentos(e.name) === q) ?? empresas.find((e) => sinAcentos(e.name).replace(/[^a-z0-9]/g, '') === q.replace(/[^a-z0-9]/g, '')) ?? null;
}

/** Un flete que YA está en el sistema (para no repetirlo). */
export type FleteExistente = { flete_date: string; machinery_id: string | null; viajes: number; note?: string | null };

export type EstadoFila = 'nueva' | 'repetida_archivo' | 'repetida_sistema' | 'error';
export type FilaValidada = {
  n: number;
  estado: EstadoFila;
  errores: string[];
  avisos: string[];
  /** Lo que se ve en la vista previa. */
  ver: { fecha: string; vehiculo: string; chofer: string; origen: string; destino: string; viajes: number; tipo: string; precio: number; empresa: string };
  /** Lo que se inserta en `fletes` (solo si no es error). */
  insertar: { company_id: string; machinery_id: string | null; code: string; flete_date: string; viajes: number; precio: number; note: string } | null;
};

const iguales = (a: unknown, b: unknown) => { const x = sinAcentos(a); const y = sinAcentos(b); return !x || !y || x === y; };

/**
 * ¿Es el MISMO flete? Misma fecha, mismo vehículo (o los dos sin vehículo), mismos viajes, y
 * ruta y chofer que no se contradicen (si uno de los dos no los tiene, no cuenta como distinto:
 * así un flete importado de Viajes sin ruta también se detecta).
 */
export function esMismoFlete(
  a: { fecha: string; machineryId: string | null; viajes: number; origen?: string; destino?: string; chofer?: string },
  b: { fecha: string; machineryId: string | null; viajes: number; origen?: string; destino?: string; chofer?: string },
): boolean {
  return a.fecha === b.fecha && (a.machineryId ?? null) === (b.machineryId ?? null) && Number(a.viajes) === Number(b.viajes)
    && iguales(a.origen, b.origen) && iguales(a.destino, b.destino) && iguales(a.chofer, b.chofer);
}

const texto = (v: unknown, max = 240) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Valida TODAS las filas: errores, repetidas en el archivo y repetidas contra el sistema. */
export function validarFilasFletes(
  filas: FilaCruda[],
  ctx: { vehiculos: VehiculoRef[]; empresas: EmpresaRef[]; existentes: FleteExistente[] },
): FilaValidada[] {
  const vistos: { fecha: string; machineryId: string | null; viajes: number; origen: string; destino: string; chofer: string; n: number }[] = [];
  const existentes = (ctx.existentes ?? []).map((f) => {
    const p = parseFleteNote(f.note);
    return { fecha: String(f.flete_date), machineryId: f.machinery_id ?? null, viajes: Number(f.viajes) || 0, origen: p.origen ?? '', destino: p.destino ?? '', chofer: p.conductor ?? '' };
  });
  return filas.map((f) => {
    const errores: string[] = [];
    const avisos: string[] = [];
    const fecha = fechaDeCelda(f.fecha);
    if (!fecha) errores.push(`Fecha «${texto(f.fecha, 30) || 'vacía'}» no válida (usa dd/mm/aaaa).`);
    const viajesNum = leerNumero(f.viajes);
    const viajes = Math.round(viajesNum);
    if (!(viajes > 0) || Math.abs(viajesNum - viajes) > 1e-9) errores.push('VIAJES debe ser un número entero mayor que 0.');
    const tipo = tipoDeCelda(f.tipo);
    if (!tipo) errores.push(`TIPO «${texto(f.tipo, 30)}» no se entiende (POR PAGAR, POR COBRAR o EXENTO).`);
    const precioTxt = String(f.precio ?? '').trim();
    const precio = precioTxt ? leerNumero(f.precio) : 0;
    if (precioTxt && !(precio >= 0)) errores.push('PRECIO no válido.');
    if (tipo && tipo !== 'exento' && !(precio > 0)) errores.push('Falta el PRECIO POR VIAJE (solo un EXENTO puede ir en 0).');
    const vehTxt = texto(f.vehiculo, 60);
    const bv = buscarVehiculo(vehTxt, ctx.vehiculos);
    if (vehTxt && !bv.v) errores.push(`El vehículo «${vehTxt}» no está en el Catálogo (escribe su placa o su código; déjalo vacío para «General»).`);
    if (bv.varios) avisos.push(`Hay varios vehículos con «${vehTxt}»: se tomó ${bv.v?.code}${bv.v?.plate ? ` · ${bv.v.plate}` : ''}.`);
    const empTxt = texto(f.empresa, 120);
    let empresa = empTxt ? buscarEmpresa(empTxt, ctx.empresas) : null;
    if (empTxt && !empresa) errores.push(`La empresa «${empTxt}» no existe en el sistema (mira la hoja «Empresas»).`);
    if (!empTxt && bv.v?.company_id) empresa = ctx.empresas.find((e) => e.id === bv.v!.company_id) ?? null;
    if (!empTxt && !empresa) errores.push('Falta la EMPRESA (o un vehículo del Catálogo que la tenga).');

    const chofer = texto(f.chofer);
    const origen = texto(f.origen);
    const destino = texto(f.destino);
    const ver = {
      fecha: fecha ?? texto(f.fecha, 20), vehiculo: bv.v ? `${bv.v.code}${bv.v.plate ? ` · ${bv.v.plate}` : ''}` : (vehTxt || 'General'),
      chofer, origen, destino, viajes: viajes > 0 ? viajes : 0, tipo: tipo ? TIPO_TXT[tipo] : texto(f.tipo, 20), precio: precio >= 0 ? precio : 0, empresa: empresa?.name ?? empTxt,
    };
    if (errores.length || !fecha || !tipo || !empresa) return { n: f.n, estado: 'error' as EstadoFila, errores, avisos, ver, insertar: null };

    const yo = { fecha, machineryId: bv.v?.id ?? null, viajes, origen, destino, chofer };
    let estado: EstadoFila = 'nueva';
    const enArchivo = vistos.find((x) => esMismoFlete(x, yo));
    if (enArchivo) { estado = 'repetida_archivo'; avisos.push(`Repetida: es igual a la fila ${enArchivo.n} del archivo.`); }
    else if (existentes.some((x) => esMismoFlete(x, yo))) { estado = 'repetida_sistema'; avisos.push('Ya hay un flete igual en el sistema (misma fecha, vehículo y viajes).'); }
    vistos.push({ ...yo, n: f.n });

    const note = formatFleteNote({
      operacionTipo: tipo, operacionEstado: 'pendiente', conductor: chofer, origen, destino,
      equipo: texto(f.equipo), autoriza: texto(f.autoriza), cliente: texto(f.cliente),
      detalle: texto(f.nota, 500) || 'Cargado desde Excel',
    });
    return {
      n: f.n, estado, errores, avisos, ver,
      insertar: { company_id: empresa.id, machinery_id: bv.v?.id ?? null, code: bv.v?.code ?? 'General', flete_date: fecha, viajes, precio, note },
    };
  });
}

// ── Descargas ──────────────────────────────────────────────────────────────────

const HEADER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '1F3864' } },
  font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 10 },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: { top: { style: 'thin', color: { rgb: '1F3864' } }, bottom: { style: 'thin', color: { rgb: '1F3864' } }, left: { style: 'thin', color: { rgb: '1F3864' } }, right: { style: 'thin', color: { rgb: '1F3864' } } },
} as const;
const ANCHOS = [12, 22, 18, 22, 20, 20, 8, 22, 22, 14, 28, 20, 30];

function hojaConEncabezado(filas: (string | number)[][], encabezado: readonly string[], anchos: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([[...encabezado], ...filas]);
  (ws as any)['!cols'] = anchos.map((wch) => ({ wch }));
  (ws as any)['!rows'] = [{ hpt: 30 }];
  encabezado.forEach((_, c) => { const cell = (ws as any)[XLSX.utils.encode_cell({ r: 0, c })]; if (cell) cell.s = HEADER_STYLE; });
  return ws;
}

function descargar(wb: XLSX.WorkBook, nombre: string): boolean {
  if (Platform.OS !== 'web') return false;
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const d: any = (globalThis as any).document;
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a: any = d.createElement('a');
  a.href = url; a.download = `${nombre.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120)}.xlsx`;
  d.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

function hojasDeReferencia(wb: XLSX.WorkBook, vehiculos: VehiculoRef[], empresas: EmpresaRef[]) {
  const nombreEmp = new Map(empresas.map((e) => [e.id, e.name]));
  const veh = [...vehiculos].sort((a, b) => a.code.localeCompare(b.code, 'es')).map((v) => [v.code, v.plate ?? '', nombreEmp.get(v.company_id ?? '') ?? '']);
  XLSX.utils.book_append_sheet(wb, hojaConEncabezado(veh, ['CÓDIGO', 'PLACA', 'EMPRESA'], [30, 22, 34]), 'Vehículos');
  const emp = [...empresas].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((e) => [e.name]);
  XLSX.utils.book_append_sheet(wb, hojaConEncabezado(emp, ['EMPRESA'], [40]), 'Empresas');
  const inst = [
    ['1 fila = 1 flete. FECHA (dd/mm/aaaa) y VIAJES son obligatorios.'],
    ['VEHÍCULO: la placa (o un pedazo de «CHUTO/LOWBOY») o el código del Catálogo. Vacío = «General».'],
    ['EMPRESA: como sale en la hoja «Empresas». Vacía = la del vehículo.'],
    ['TIPO: POR PAGAR (si se deja vacío), POR COBRAR o EXENTO. El PRECIO POR VIAJE es obligatorio salvo en EXENTO.'],
    ['Antes de guardar, el sistema muestra cada fila: ✅ nueva, 🔁 repetida (en el archivo o ya en el sistema) o ❌ con error.'],
    ['Lo repetido NO se sube (salvo que lo marques). Nada se guarda hasta que confirmes.'],
  ];
  XLSX.utils.book_append_sheet(wb, hojaConEncabezado(inst, ['CÓMO LLENARLA'], [110]), 'Instrucciones');
}

/** 📥 La plantilla vacía (con referencias e instrucciones). */
export function descargarPlantillaFletes(vehiculos: VehiculoRef[], empresas: EmpresaRef[]): boolean {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaConEncabezado([], COLUMNAS_FLETES, ANCHOS), 'Fletes');
  hojasDeReferencia(wb, vehiculos, empresas);
  return descargar(wb, 'Plantilla - Carga de fletes');
}

/** Una fila de la relación en Excel (mismo formato que la plantilla). */
export type FilaExcelFlete = { fecha: string; chofer: string; vehiculo: string; equipo: string; origen: string; destino: string; viajes: number; autoriza: string; tipo: FleteOperacionTipo; precio: number; empresa: string; cliente: string; nota: string };

/** Las filas para la hoja (fecha dd/mm/aaaa), ordenadas por fecha; la última es TOTAL. */
export function filasRelacionExcel(filas: FilaExcelFlete[]): (string | number)[][] {
  const orden = [...filas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const dmy = (iso: string) => { const [a, m, d] = iso.split('-'); return a && m && d ? `${d}/${m}/${a}` : iso; };
  const cuerpo = orden.map((f) => [dmy(f.fecha), f.chofer, f.vehiculo, f.equipo, f.origen, f.destino, f.viajes, f.autoriza, TIPO_TXT[f.tipo], f.precio, f.empresa, f.cliente, f.nota]);
  return [...cuerpo, ['TOTAL', '', '', '', '', '', orden.reduce((s, f) => s + (Number(f.viajes) || 0), 0), '', '', '', '', '', '']];
}

/** 📊 La relación en Excel (mismas columnas que la plantilla: se puede editar y volver a subir). */
export function descargarRelacionExcel(filas: FilaExcelFlete[], vehiculos: VehiculoRef[], empresas: EmpresaRef[], titulo: string): boolean {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaConEncabezado(filasRelacionExcel(filas), COLUMNAS_FLETES, ANCHOS), 'Fletes');
  hojasDeReferencia(wb, vehiculos, empresas);
  return descargar(wb, titulo);
}

/** (WEB) Elegir el archivo Excel. */
export function elegirExcel(): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web') { resolve(null); return; }
    const d: any = (globalThis as any).document;
    const input: any = d.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
    input.style.display = 'none';
    let listo = false;
    const fin = (v: ArrayBuffer | null) => { if (listo) return; listo = true; try { input.remove(); } catch {} resolve(v); };
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) { fin(null); return; }
      const fr: any = new (globalThis as any).FileReader();
      fr.onload = () => fin(fr.result as ArrayBuffer);
      fr.onerror = () => fin(null);
      fr.readAsArrayBuffer(file);
    };
    d.body.appendChild(input);
    input.click();
  });
}
