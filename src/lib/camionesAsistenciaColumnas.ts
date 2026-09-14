// CAMIONES (ASISTENCIA) · columnas del reporte (14-sep-2026).
//
// Pedido del cliente: que al reporte de asistencia de camiones se le puedan poner
// o quitar las columnas de placa, modelo, empresa y el enumerado, «como está en el
// de reportes conteo de equipos».
//
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-camiones-asistencia.mjs).
//    La pantalla y el PDF le preguntan acá qué columnas van y en qué orden, y arman
//    el encabezado y cada fila CON LA MISMA LISTA — así no pueden desalinearse.
//
// ⚠️ Las pastillas ocultan COLUMNAS, nunca camiones: los totales no cambian.

export type OpcionesAsistencia = {
  /** Sin el Nº de renglón. */
  sinNumero: boolean;
  sinMarca: boolean;
  sinModelo: boolean;
  sinPlaca: boolean;
  sinEmpresa: boolean;
};

/** Quien no toque nada saca el papel con todo. */
export const OPCIONES_ASISTENCIA_POR_DEFECTO: OpcionesAsistencia = {
  sinNumero: false,
  sinMarca: false,
  sinModelo: false,
  sinPlaca: false,
  sinEmpresa: false,
};

/** Las pastillas de la pantalla, en el orden en que se muestran y se nombran. */
export const PASTILLAS_ASISTENCIA: { key: keyof OpcionesAsistencia; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinNumero', chip: '🚫 Nº', largo: 'enumerado', archivo: 'sin numero' },
  { key: 'sinMarca', chip: '🚫 Marca', largo: 'marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🚫 Modelo', largo: 'modelo', archivo: 'sin modelo' },
  // Sin barra en el nombre del archivo: "/" no se puede usar ahí.
  { key: 'sinPlaca', chip: '🚫 Placa / Serial', largo: 'placa/serial', archivo: 'sin placa' },
  { key: 'sinEmpresa', chip: '🚫 Empresa', largo: 'empresa', archivo: 'sin empresa' },
];

/** Enciende o apaga UNA pastilla. Devuelve un objeto nuevo. */
export function alternarAsistencia(o: OpcionesAsistencia, key: keyof OpcionesAsistencia): OpcionesAsistencia {
  return { ...o, [key]: !o[key] };
}

/** Para que la pantalla diga qué va a salir ANTES de descargar. */
export function ocultosAsistenciaEnPalabras(o: OpcionesAsistencia): string {
  const l = PASTILLAS_ASISTENCIA.filter((p) => !!o[p.key]).map((p) => p.largo);
  return l.length ? `Se oculta: ${l.join(' · ')}.` : 'Sale completo.';
}

/** Va en el NOMBRE DEL ARCHIVO: dos PDF distintos no se pisan en la carpeta. */
export function sufijoArchivoAsistencia(o: OpcionesAsistencia): string {
  const l = PASTILLAS_ASISTENCIA.filter((p) => !!o[p.key]).map((p) => p.archivo);
  return l.length ? ' ' + l.join(', ') : '';
}

export type ColumnaAsistencia = 'n' | 'camion' | 'marcaModelo' | 'placa' | 'empresa' | 'salida' | 'entrada' | 'estado';

/** Camión, salida, entrada y estado no se pueden quitar: son la asistencia. */
export function columnasAsistencia(o: OpcionesAsistencia): ColumnaAsistencia[] {
  const c: ColumnaAsistencia[] = [];
  if (!o.sinNumero) c.push('n');
  c.push('camion');
  if (!(o.sinMarca && o.sinModelo)) c.push('marcaModelo');
  if (!o.sinPlaca) c.push('placa');
  if (!o.sinEmpresa) c.push('empresa');
  c.push('salida', 'entrada', 'estado');
  return c;
}

export function tituloColumnaAsistencia(c: ColumnaAsistencia, o: OpcionesAsistencia): string {
  switch (c) {
    case 'n': return 'Nº';
    case 'camion': return 'Camión';
    case 'marcaModelo': return o.sinMarca ? 'Modelo' : o.sinModelo ? 'Marca' : 'Marca / Modelo';
    case 'placa': return 'Placa / Serial';
    case 'empresa': return 'Empresa';
    case 'salida': return 'Salida';
    case 'entrada': return 'Entrada';
    case 'estado': return 'Estado';
  }
}

const limpio = (v: unknown) => String(v ?? '').trim();

/** "TORONTO T7", o solo la mitad visible, o '—'. */
export function marcaModeloAsistencia(m: { marca?: unknown; modelo?: unknown }, o: OpcionesAsistencia): string {
  const partes: string[] = [];
  if (!o.sinMarca) partes.push(limpio(m?.marca));
  if (!o.sinModelo) partes.push(limpio(m?.modelo));
  return partes.filter(Boolean).join(' ') || '—';
}

/** La placa; si no tiene, el serial; si tampoco, un guion. */
export function placaAsistencia(m: { plate?: unknown; serial?: unknown }): string {
  return limpio(m?.plate) || limpio(m?.serial) || '—';
}

/** Estado del día. Es la MISMA regla en la lista de la pantalla y en el PDF. */
export function estadoAsistencia(c: { salida: string | null; entrada: string | null; jornada: boolean }): string {
  if (c.salida && c.entrada) return '🟢 Regresó';
  if (c.salida || c.jornada) return '🟠 En obra';
  return '— sin salida';
}

/**
 * Orden: por código y DESPUÉS por placa. Casi todos los camiones se llaman
 * «CAMION VOLTEO TORONTO»: ordenados solo por código, el enumerado cambiaba de
 * camión cada vez que se sacaba el reporte.
 */
export function ordenarCamionesAsistencia<T extends { code: string; plate?: string | null; serial?: string | null }>(lista: T[]): T[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
  return [...lista].sort((a, b) => cmp(a.code, b.code) || cmp(placaAsistencia(a), placaAsistencia(b)));
}
