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

/**
 * Estado del día. Es la MISMA regla en la lista de la pantalla y en el PDF.
 *
 * `jornada` = la jornada sigue ABIERTA. Un camión con horas pero sin salida ni
 * jornada abierta es «— sin salida»: casi siempre son las 12 h que el sistema pone
 * solo a las 7:05 p. m. a las máquinas que nadie inició (`auto_iniciar_dia_12h`), o
 * horas cargadas a mano en Control. Hasta el 19-sep-2026 salían «🟠 En obra», que
 * decía que el camión estaba en la calle sin que nadie lo hubiera visto salir.
 */
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

// ── QUIÉN ENTRA A LA ASISTENCIA (18-sep-2026) ───────────────────────────────
//
// Decisión del cliente («debería ser la B»): un camión al que le QUITARON LAS HORAS
// en Control NO sale en la asistencia de ese día, aunque tenga una salida de patio.
// El caso real: el inspector le inicia la jornada (eso registra la SALIDA del patio),
// el camión en realidad no salió, y en Control le dejan 0 horas. Ese camión no hizo
// viajes: si siguiera en la asistencia, el reporte diría que sí.
//
// ⚠️ La jornada ABIERTA cuenta como «con horas»: las horas se suman al CERRAR, así
//    que un camión que está en obra ahora mismo tiene 0 h hasta la tarde. Si se
//    mirara solo el número, los «🟠 En obra» desaparecerían del reporte del día.
//    Por lo mismo, quitarle las horas en Control a una jornada que sigue abierta no
//    lo saca: al cerrarse vuelve a sumar. Hay que cerrarla (o marcarla Pendiente en
//    Inspecciones) y después dejarla en 0.

export type JornadaCamion = {
  machinery_id: string;
  code: string;
  companyName: string;
  plate?: string | null;
  serial?: string | null;
  marca?: string | null;
  modelo?: string | null;
  /** Inicio de la jornada si sigue abierta (ISO); null si ya cerró. */
  startAt: string | null;
  /** Horas de día + noche registradas en Control. */
  worked: number;
};

export type MovimientoPatio = {
  machinery_id: string;
  plate?: string | null;
  serial?: string | null;
  marca?: string | null;
  modelo?: string | null;
  direction: 'entrada' | 'salida';
  at: string;
};

export type CamionAsistencia = {
  code: string;
  companyName: string;
  plate: string | null;
  serial: string | null;
  marca: string | null;
  modelo: string | null;
  salida: string | null;
  entrada: string | null;
  jornada: boolean;
};

/** Entra si tiene horas en Control ese día o su jornada sigue abierta. */
export function entraEnAsistencia(j: { worked?: unknown; startAt?: unknown } | null | undefined): boolean {
  if (!j) return false;
  return (Number(j.worked) || 0) > 0 || !!j.startAt;
}

/**
 * La lista de la asistencia del día: una fila por camión CON JORNADA (ver arriba),
 * con la salida y la entrada exactas del patio cuando las hay. Un movimiento de
 * patio de un camión sin jornada con horas NO abre fila.
 */
export function armarAsistenciaCamiones(jornadas: readonly JornadaCamion[], patio: readonly MovimientoPatio[]): CamionAsistencia[] {
  const map = new Map<string, CamionAsistencia>();
  jornadas.filter(entraEnAsistencia).forEach((r) => {
    const cur = map.get(r.machinery_id) ?? {
      code: r.code, companyName: r.companyName, plate: null, serial: null, marca: null, modelo: null,
      salida: null, entrada: null, jornada: false,
    };
    // Jornada ABIERTA (ver `estadoAsistencia`): tener horas no es estar en obra.
    if (r.startAt) cur.jornada = true;
    // Jornada abierta: salió a esa hora (hasta que el patio diga la exacta).
    if (r.startAt && (!cur.salida || r.startAt < cur.salida)) cur.salida = r.startAt;
    cur.plate = r.plate ?? cur.plate; cur.serial = r.serial ?? cur.serial;
    cur.marca = r.marca ?? cur.marca; cur.modelo = r.modelo ?? cur.modelo;
    map.set(r.machinery_id, cur);
  });
  patio.forEach((l) => {
    const cur = map.get(l.machinery_id);
    if (!cur) return; // sin jornada con horas no entra (ver arriba)
    if (l.direction === 'salida') { if (!cur.salida || l.at < cur.salida) cur.salida = l.at; }
    else if (!cur.entrada || l.at > cur.entrada) cur.entrada = l.at;
    cur.plate = l.plate ?? cur.plate; cur.serial = l.serial ?? cur.serial;
    cur.marca = l.marca ?? cur.marca; cur.modelo = l.modelo ?? cur.modelo;
  });
  return ordenarCamionesAsistencia(Array.from(map.values()));
}

// ── QUÉ CAMIONES SALEN EN EL PAPEL (19-sep-2026) ────────────────────────────
//
// Pedido del cliente: poder imprimir solo los que tienen SALIDA (los que alguien
// inició o que pasaron por el patio) o todos los que tienen MOVIMIENTO (además, los
// que solo tienen horas: las 12 h automáticas o las cargadas a mano en Control).
//
// ⚠️ A diferencia de las pastillas de columnas, ESTO SÍ cambia cuántos camiones
//    salen. Por eso el papel lo dice en el subtítulo y en el nombre del archivo.

export type AlcanceAsistencia = 'movimiento' | 'salida';

export const ALCANCES_ASISTENCIA: { key: AlcanceAsistencia; chip: string; archivo: string }[] = [
  { key: 'movimiento', chip: '🚚 Todos con movimiento', archivo: '' },
  { key: 'salida', chip: '🟠 Solo con salida', archivo: ' solo con salida' },
];

/** ¿Tiene hora de salida registrada (jornada abierta o paso por el patio)? */
export const tieneSalida = (c: { salida?: string | null }): boolean => !!c.salida;

export function filtrarAsistencia<T extends { salida?: string | null }>(lista: readonly T[], alcance: AlcanceAsistencia): T[] {
  return alcance === 'salida' ? lista.filter(tieneSalida) : [...lista];
}

/** El subtítulo del PDF: dice cuántos salen y de cuántos, para que un papel corto no parezca el completo. */
export function subtituloAsistencia(alcance: AlcanceAsistencia, conSalida: number, conMovimiento: number): string {
  return alcance === 'salida'
    ? `SOLO CON SALIDA: ${conSalida} camión(es) con salida registrada, de ${conMovimiento} con movimiento`
    : `${conSalida} con salida (asistencia) de ${conMovimiento} con movimiento`;
}
