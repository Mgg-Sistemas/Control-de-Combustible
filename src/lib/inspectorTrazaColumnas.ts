// REPORTE POR INSPECTOR · columnas, pastillas y reglas de las tarjetas (14-sep-2026).
//
// Pedido del cliente: «ese reporte no me refleja la realidad» y, después, que tenga
// las opciones de columnas (placa, modelo, empresa…) como el Conteo de equipos.
//
// Por qué no la reflejaba: el reporte salía de los CHECK-IN del día, así que solo
// traía las máquinas que el inspector escaneó en persona. Las tarjetas de
// Inspecciones cuentan las ASIGNADAS con su estado y las horas del TURNO. Desde hoy
// el reporte cuenta igual que las tarjetas, y el check-in pasa a ser una columna.
//
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-reporte-inspector.mjs).
//    La pantalla y el PDF le preguntan acá qué columnas van y en qué orden, y arman
//    el encabezado y cada fila CON LA MISMA LISTA — así no pueden desalinearse.
//
// ⚠️ Las pastillas ocultan COLUMNAS, nunca máquinas: los totales no cambian.

export type OpcionesInspector = {
  sinMarca: boolean;
  sinModelo: boolean;
  sinPlaca: boolean;
  sinEmpresa: boolean;
  sinClasificacion: boolean;
  sinEncargado: boolean;
  sinSector: boolean;
  sinEdificio: boolean;
  /** Sin la hora del check-in (y quién lo hizo si fue otro inspector). */
  sinRevision: boolean;
  /** Sin quién inició y quién finalizó la jornada. */
  sinInicio: boolean;
  /** Sin el motivo de avería/parada o de cierre anticipado. */
  sinNota: boolean;
};

/**
 * Lo que sale si nadie toca nada. Clasificación, encargado y edificio entran
 * OCULTOS: con todo encendido la tabla no cabe legible en una hoja horizontal.
 */
export const OPCIONES_INSPECTOR_POR_DEFECTO: OpcionesInspector = {
  sinMarca: false,
  sinModelo: false,
  sinPlaca: false,
  sinEmpresa: false,
  sinClasificacion: true,
  sinEncargado: true,
  sinSector: false,
  sinEdificio: true,
  sinRevision: false,
  sinInicio: false,
  sinNota: false,
};

/** Las pastillas de la pantalla, en el orden en que se muestran y se nombran. */
export const PASTILLAS_INSPECTOR: { key: keyof OpcionesInspector; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinMarca', chip: '🚫 Marca', largo: 'marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🚫 Modelo', largo: 'modelo', archivo: 'sin modelo' },
  // Sin barra en el nombre del archivo: "/" no se puede usar ahí.
  { key: 'sinPlaca', chip: '🚫 Placa / Serial', largo: 'placa/serial', archivo: 'sin placa' },
  { key: 'sinEmpresa', chip: '🚫 Empresa', largo: 'empresa', archivo: 'sin empresa' },
  { key: 'sinClasificacion', chip: '🚫 Clasificación', largo: 'clasificación', archivo: 'sin clasificacion' },
  { key: 'sinEncargado', chip: '🚫 Encargado', largo: 'encargado', archivo: 'sin encargado' },
  { key: 'sinSector', chip: '🚫 Sector', largo: 'sector', archivo: 'sin sector' },
  { key: 'sinEdificio', chip: '🚫 Edificio', largo: 'edificio', archivo: 'sin edificio' },
  { key: 'sinRevision', chip: '🚫 Check-in', largo: 'check-in', archivo: 'sin checkin' },
  { key: 'sinInicio', chip: '🚫 Inició / finalizó', largo: 'quién inició', archivo: 'sin inicio' },
  { key: 'sinNota', chip: '🚫 Motivo', largo: 'motivo', archivo: 'sin motivo' },
];

/** Enciende o apaga UNA pastilla. Devuelve un objeto nuevo. */
export function alternarColumna(o: OpcionesInspector, key: keyof OpcionesInspector): OpcionesInspector {
  return { ...o, [key]: !o[key] };
}

/** Para que la pantalla diga qué va a salir ANTES de descargar. */
export function ocultosInspectorEnPalabras(o: OpcionesInspector): string {
  const l = PASTILLAS_INSPECTOR.filter((p) => !!o[p.key]).map((p) => p.largo);
  return l.length ? `Se oculta: ${l.join(' · ')}.` : 'Salen todas las columnas.';
}

/** Va en el NOMBRE DEL ARCHIVO, solo si se apartó de lo que sale por defecto. */
export function sufijoArchivoInspector(o: OpcionesInspector): string {
  const distintas = PASTILLAS_INSPECTOR.filter((p) => o[p.key] !== OPCIONES_INSPECTOR_POR_DEFECTO[p.key]);
  if (!distintas.length) return '';
  const l = PASTILLAS_INSPECTOR.filter((p) => !!o[p.key]).map((p) => p.archivo);
  return l.length ? ' ' + l.join(', ') : ' todas las columnas';
}

/** Cómo se titula la columna de marca y modelo, o null si las dos están ocultas. */
export function tituloMarcaModeloInspector(o: OpcionesInspector): string | null {
  if (o.sinMarca && o.sinModelo) return null;
  if (o.sinMarca) return 'Modelo';
  if (o.sinModelo) return 'Marca';
  return 'Marca / Modelo';
}

/** "CAT 320", o solo la mitad visible. Si la máquina es vieja y no tiene marca ni
 *  modelo separados, cae al `tipo` combinado, pero solo con las dos visibles. */
export function marcaModeloInspector(m: { marca?: unknown; modelo?: unknown; tipo?: unknown }, o: OpcionesInspector): string {
  const limpio = (v: unknown) => String(v ?? '').trim();
  const partes: string[] = [];
  if (!o.sinMarca) partes.push(limpio(m?.marca));
  if (!o.sinModelo) partes.push(limpio(m?.modelo));
  const txt = partes.filter(Boolean).join(' ');
  if (txt) return txt;
  if (!o.sinMarca && !o.sinModelo) {
    const t = limpio(m?.tipo);
    if (t && t !== '—') return t;
  }
  return '—';
}

export type ColumnaInspector =
  | 'n' | 'maquina' | 'marcaModelo' | 'placa' | 'empresa' | 'clasificacion' | 'encargado'
  | 'sector' | 'edificio' | 'estado' | 'revision' | 'horas' | 'inicio' | 'nota';

/**
 * Qué columnas lleva la tabla y en qué orden. Nº, máquina, estado y horas del turno
 * no se pueden quitar: sin ellas la fila no dice qué pasó ni cuánto trabajó.
 */
export function columnasInspector(o: OpcionesInspector): ColumnaInspector[] {
  const c: ColumnaInspector[] = ['n', 'maquina'];
  if (tituloMarcaModeloInspector(o)) c.push('marcaModelo');
  if (!o.sinPlaca) c.push('placa');
  if (!o.sinEmpresa) c.push('empresa');
  if (!o.sinClasificacion) c.push('clasificacion');
  if (!o.sinEncargado) c.push('encargado');
  if (!o.sinSector) c.push('sector');
  if (!o.sinEdificio) c.push('edificio');
  c.push('estado');
  if (!o.sinRevision) c.push('revision');
  c.push('horas');
  if (!o.sinInicio) c.push('inicio');
  if (!o.sinNota) c.push('nota');
  return c;
}

export function tituloColumnaInspector(c: ColumnaInspector, o: OpcionesInspector, turno: 'day' | 'night'): string {
  switch (c) {
    case 'n': return 'Nº';
    case 'maquina': return 'Máquina';
    case 'marcaModelo': return tituloMarcaModeloInspector(o) ?? '';
    case 'placa': return 'Placa / Serial';
    case 'empresa': return 'Empresa';
    case 'clasificacion': return 'Clasificación';
    case 'encargado': return 'Encargado';
    case 'sector': return 'Sector';
    case 'edificio': return 'Edificio';
    case 'estado': return 'Estado';
    case 'revision': return 'Check-in';
    case 'horas': return turno === 'night' ? 'Horas noche' : 'Horas día';
    case 'inicio': return 'Inició / finalizó';
    case 'nota': return 'Motivo';
  }
}

// ── LAS REGLAS DE LAS TARJETAS ──────────────────────────────────────────────

/** Estado tal como lo muestran las tarjetas de Inspecciones. */
export type EstadoTarjeta = 'encurso' | 'cerrada' | 'pendiente' | 'parada' | 'averia';

/**
 * Estado de la máquina COMO LA TARJETA.
 *
 * El reporte con firma tiene una regla propia (pedido del 19-ago-2026): si la
 * máquina trabajó y LUEGO se averió con la jornada aún abierta, sale «en curso».
 * Las tarjetas no: avería y parada ganan siempre. Este reporte cuenta como las
 * tarjetas, que es lo que se pidió; la nota del incidente se conserva aparte.
 */
export function estadoComoTarjeta(m: {
  estado: 'averia' | 'encurso' | 'parada' | 'finalizada' | 'pendiente';
  incidenteAveria?: { tipo: 'averia' | 'parada' } | null;
}): EstadoTarjeta {
  if (m.estado === 'encurso' && m.incidenteAveria) return m.incidenteAveria.tipo;
  if (m.estado === 'finalizada') return 'cerrada';
  return m.estado;
}

/**
 * ¿La máquina entra en el conteo del inspector para este turno? Mismas dos
 * exclusiones que `classifyInspectorMachines` y `assignmentCountsForShift`:
 *  · asignada DESPUÉS de cerrar la ventana del turno: no pudo trabajarlo;
 *  · pendiente en este turno pero trabajando en el OTRO: la cubre el otro turno.
 */
export function entraEnLasTarjetas(p: {
  estado: EstadoTarjeta;
  asignacionCuenta: boolean;
  horasOtroTurno: number;
}): boolean {
  if (!p.asignacionCuenta) return false;
  if (p.estado === 'pendiente' && p.horasOtroTurno > 0) return false;
  return true;
}

const RANGO_ESTADO: Record<EstadoTarjeta, number> = { averia: 0, parada: 1, encurso: 2, cerrada: 3, pendiente: 4 };

/** Orden de las filas: por estado (lo que necesita atención arriba) y luego por
 *  código y placa, porque muchas máquinas se llaman igual. */
export function ordenFilasInspector<T extends { estadoTarjeta: EstadoTarjeta; code: string; placa: string }>(filas: T[]): T[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
  return [...filas].sort((a, b) => RANGO_ESTADO[a.estadoTarjeta] - RANGO_ESTADO[b.estadoTarjeta] || cmp(a.code, b.code) || cmp(a.placa, b.placa));
}

export type ResumenEstados = { asignadas: number; encurso: number; cerradas: number; pendientes: number; paradas: number; averiadas: number; horas: number };

export function resumenEstadosInspector(filas: { estadoTarjeta: EstadoTarjeta; horas: number }[]): ResumenEstados {
  const r: ResumenEstados = { asignadas: filas.length, encurso: 0, cerradas: 0, pendientes: 0, paradas: 0, averiadas: 0, horas: 0 };
  filas.forEach((f) => {
    if (f.estadoTarjeta === 'encurso') r.encurso++;
    else if (f.estadoTarjeta === 'cerrada') r.cerradas++;
    else if (f.estadoTarjeta === 'pendiente') r.pendientes++;
    else if (f.estadoTarjeta === 'parada') r.paradas++;
    else r.averiadas++;
    r.horas += Number(f.horas) || 0;
  });
  r.horas = Math.round(r.horas * 100) / 100;
  return r;
}

/**
 * Texto de la columna Check-in: la PRIMERA revisión del día y, si la hizo otro
 * inspector, su nombre. Si hubo más, cuántas.
 *   "07:12 a. m."  ·  "10:43 a. m. · inspector dos"  ·  "07:12 a. m. (+2)"  ·  "Sin check-in"
 */
export function revisionInspectorTexto(
  visitas: { nombre: string; at: string }[],
  inspector: string,
  hora: (iso: string) => string,
): string {
  if (!visitas.length) return 'Sin check-in';
  const orden = [...visitas].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const primera = orden[0];
  const clave = (s: string) => String(s ?? '').trim().toLowerCase();
  const otro = clave(primera.nombre) && clave(primera.nombre) !== clave(inspector);
  const extra = orden.length > 1 ? ` (+${orden.length - 1})` : '';
  return `${hora(primera.at)}${otro ? ` · ${String(primera.nombre).trim()}` : ''}${extra}`;
}
