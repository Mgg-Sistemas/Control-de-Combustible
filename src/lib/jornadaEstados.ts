import { paradaShiftOf } from './inspectorDaySets';

/**
 * ESTADOS de las máquinas que NO TRABAJARON en el INFORME POR JORNADA — función PURA.
 *
 * Pedido del cliente (19-ago-2026): «existen las averiadas y paradas, pero en esos
 * reportes las engloba en color rojo ambas… hazme la separación como corresponde…
 * y que salga también el esperando instrucciones, que se divida en renglones así como
 * el de por empresa… que se entienda si la máquina se paró o se averió para el día y
 * para la noche».
 *
 * Devuelve TRES grupos EXCLUYENTES (ninguna máquina sale en dos):
 *   · 🔴 averiadas — avería REAL pendiente.
 *   · 🟡 paradas   — solo el marcador genérico "MÁQUINA PARADA" (parada sin avería).
 *   · ⏳ espera    — `machinery.en_espera = true` (esperando instrucciones), SIN ticket.
 *
 * REGLAS (no se inventan acá, se reutilizan):
 *  1. Avería REAL = `maintenance_requests.material != 'MÁQUINA PARADA'`; parada = ese
 *     marcador exacto. La avería MANDA sobre la parada — mismo criterio que
 *     `machineLiveStatus.ts` (fetchAveriaCat, líneas 31-42) y `controlEstado.ts`
 *     (computeControlAveriadas, líneas 15 y 55-56). El teléfono guarda LOS DOS
 *     renglones (parada + avería) para la misma máquina, por eso hace falta la
 *     prioridad: si no, la misma máquina saldría en los dos bloques.
 *  2. Dentro de la misma clase gana la marca MÁS RECIENTE (created_at).
 *  3. Turno de cada marca = `paradaShiftOf` (día 7am–7pm), IMPORTADA de
 *     `inspectorDaySets.ts`. NO se copia: ya hubo un bug por tener tres copias de esa
 *     función con umbrales distintos.
 *  4. Prioridad ESPERA: avería/parada > espera (igual que `grupoEmpresaDe` en
 *     `empresaGrupo.ts`: activa > avería > espera > pendiente). Una máquina en espera
 *     con avería pendiente sale como averiada, no en el bloque de espera.
 *
 * QUIÉN ENTRA al informe y los totales de horas/dinero NO se deciden acá: el llamador
 * pasa por `excluir` las que ya trabajaron (van donde trabajaron) y las de inspector
 * SIEMPRE ACTIVO (SOS La Guaira, que nunca cuentan como avería/parada).
 *
 * Blindada por `npm run test:jornada-estados` (scripts/test-jornada-estados.mjs).
 */

/** Marcador genérico del teléfono para "parada sin avería". */
export const MARCADOR_PARADA = 'MÁQUINA PARADA';

/** Ficha de catálogo que acompaña a un ticket (`maintenance_requests.machinery`). */
export type FichaMaquina = {
  code?: string | null;
  tipo?: string | null;
  clasificacion?: string | null;
  serial?: string | null;
  plate?: string | null;
  encargado?: string | null;
  company?: { name?: string | null } | null;
} | null;

/** Solicitud de mantenimiento PENDIENTE (avería o parada). */
export type TicketNoTrabajo = {
  machinery_id?: string | null;
  material?: string | null;
  notes?: string | null;
  created_at?: string | null;
  machinery?: FichaMaquina;
};

/** Fila de `machinery` para el bloque de "esperando instrucciones". */
export type MaquinaEspera = {
  id?: string | null;
  code?: string | null;
  tipo?: string | null;
  clasificacion?: string | null;
  serial?: string | null;
  plate?: string | null;
  encargado?: string | null;
  en_espera?: boolean | null;
  company?: { name?: string | null } | null;
};

export type EstadoNoTrabajo = 'averia' | 'parada' | 'espera';
/** Qué le pasó a la máquina en UN turno (día o noche) y por qué. */
export type MarcaTurno = { estado: 'averia' | 'parada'; motivo: string };

export type MaquinaNoTrabajo = {
  machineryId: string;
  company: string;
  machine: string;
  tipo: string;          // marca / modelo
  clasificacion: string;
  serial: string | null;
  plate: string | null;
  // Responsable de la máquina. Sirve para PARTIR el informe por encargado en vez
  // de por empresa; sin esto, una máquina que NO trabajó desaparecería de ese
  // corte y el reporte mentiría por omisión.
  encargado: string;
  estado: EstadoNoTrabajo;
  motivo: string;        // motivo de la marca que MANDA (o "Esperando instrucciones")
  dia: MarcaTurno | null;    // qué pasó en el turno de DÍA (7am–7pm)
  noche: MarcaTurno | null;  // qué pasó en el turno de NOCHE
  sinTurno: MarcaTurno | null; // marca sin fecha válida: no se puede ubicar en un turno
  turnoResumen: string;  // rótulo listo para leer: "☀️ Día: 🔴 AVERÍA · Motor · 🌙 Noche: …"
};

export type NoTrabajaronResultado = {
  averiadas: MaquinaNoTrabajo[];
  paradas: MaquinaNoTrabajo[];
  espera: MaquinaNoTrabajo[];
};

const txt = (v: any): string => (v == null ? '' : String(v).trim());
/** Instante de la marca; sin fecha o fecha basura → -Infinity (pierde contra cualquiera). */
const instante = (iso: any): number => {
  if (!iso) return -Infinity;
  const t = new Date(String(iso)).getTime();
  return isFinite(t) ? t : -Infinity;
};

type Marca = { estado: 'averia' | 'parada'; motivo: string; ms: number; ficha: FichaMaquina };

/** ¿Cuál de las dos marcas MANDA? Avería REAL sobre parada; a igual clase, la más reciente. */
const mandaMarca = (a: Marca | null, b: Marca | null): Marca | null => {
  if (!a) return b;
  if (!b) return a;
  if (a.estado !== b.estado) return a.estado === 'averia' ? a : b;
  return b.ms > a.ms ? b : a;
};

const rotulo = (m: MarcaTurno): string =>
  `${m.estado === 'averia' ? '🔴 AVERÍA' : '🟡 PARADA'}${m.motivo ? ` · ${m.motivo}` : ''}`;

const soloTurno = (m: Marca | null): MarcaTurno | null => (m ? { estado: m.estado, motivo: m.motivo } : null);

/**
 * Reparte en 🔴 averiadas / 🟡 paradas / ⏳ esperando instrucciones las máquinas que no
 * trabajaron, con el detalle POR TURNO de cada avería/parada.
 */
export function clasificarNoTrabajaron(params: {
  /** `maintenance_requests` PENDIENTES (avería + parada). El orden no importa. */
  tickets?: TicketNoTrabajo[] | null;
  /** Filas de `machinery` (solo se usan las de `en_espera = true`). */
  espera?: MaquinaEspera[] | null;
  /** `true` = la máquina NO va a ninguno de los tres bloques (ya trabajó / SIEMPRE ACTIVO). */
  excluir?: (machineryId: string) => boolean;
}): NoTrabajaronResultado {
  const tickets = params.tickets ?? [];
  const enEspera = params.espera ?? [];
  const excluir = params.excluir ?? (() => false);

  type Acc = { dia: Marca | null; noche: Marca | null; sinTurno: Marca | null; manda: Marca | null };
  const acc = new Map<string, Acc>();

  tickets.forEach((r) => {
    if (!r) return;
    const mid = txt(r.machinery_id);
    if (!mid) return;                 // fila basura, fuera
    if (!r.machinery) return;         // sin ficha de catálogo, fuera (igual que antes)
    if (excluir(mid)) return;
    // Criterio avería vs parada: machineLiveStatus.ts:31-42 · controlEstado.ts:15,55-56.
    const esParada = r.material === MARCADOR_PARADA;
    const notes = txt(r.notes);
    const marca: Marca = {
      estado: esParada ? 'parada' : 'averia',
      motivo: esParada ? (notes || 'Parada') : (notes || txt(r.material) || 'Avería'),
      ms: instante(r.created_at),
      ficha: r.machinery,
    };
    const a = acc.get(mid) ?? { dia: null, noche: null, sinTurno: null, manda: null };
    // Turno de la marca: paradaShiftOf (día 7am–7pm). Sin fecha válida no se puede ubicar.
    if (marca.ms === -Infinity) a.sinTurno = mandaMarca(a.sinTurno, marca);
    else if (paradaShiftOf(String(r.created_at)) === 'day') a.dia = mandaMarca(a.dia, marca);
    else a.noche = mandaMarca(a.noche, marca);
    a.manda = mandaMarca(a.manda, marca);
    acc.set(mid, a);
  });

  const averiadas: MaquinaNoTrabajo[] = [];
  const paradas: MaquinaNoTrabajo[] = [];
  acc.forEach((a, mid) => {
    const manda = a.manda;
    if (!manda) return;
    const mm = manda.ficha || {};
    const dia = soloTurno(a.dia);
    const noche = soloTurno(a.noche);
    const sinTurno = soloTurno(a.sinTurno);
    const partes: string[] = [];
    if (dia) partes.push(`☀️ Día: ${rotulo(dia)}`);
    if (noche) partes.push(`🌙 Noche: ${rotulo(noche)}`);
    if (sinTurno) partes.push(`🕓 Sin hora: ${rotulo(sinTurno)}`);
    const item: MaquinaNoTrabajo = {
      machineryId: mid,
      company: txt(mm.company?.name) || 'Sin empresa',
      machine: txt(mm.code) || '—',
      tipo: txt(mm.tipo) || '—',
      clasificacion: txt(mm.clasificacion) || 'Sin clasificación',
      serial: mm.serial ?? null,
      plate: mm.plate ?? null,
      encargado: txt(mm.encargado),
      estado: manda.estado,
      motivo: manda.motivo,
      dia,
      noche,
      sinTurno,
      turnoResumen: partes.join(' · ') || '—',
    };
    if (item.estado === 'averia') averiadas.push(item);
    else paradas.push(item);
  });

  // ⏳ ESPERANDO INSTRUCCIONES: en_espera = true y SIN avería/parada pendiente (la
  // avería manda, igual que en el reporte por empresa). Van en 0 horas, no suman.
  const espera: MaquinaNoTrabajo[] = [];
  const yaListadas = new Set(acc.keys());
  enEspera.forEach((m) => {
    if (!m || m.en_espera !== true) return;
    const mid = txt(m.id);
    if (!mid || yaListadas.has(mid) || excluir(mid)) return;
    yaListadas.add(mid); // sin duplicados aunque la fila venga repetida
    espera.push({
      machineryId: mid,
      company: txt(m.company?.name) || 'Sin empresa',
      machine: txt(m.code) || '—',
      tipo: txt(m.tipo) || '—',
      clasificacion: txt(m.clasificacion) || 'Sin clasificación',
      serial: m.serial ?? null,
      plate: m.plate ?? null,
      encargado: txt(m.encargado),
      estado: 'espera',
      motivo: 'Esperando instrucciones',
      dia: null,
      noche: null,
      sinTurno: null,
      turnoResumen: '⏳ Esperando instrucciones (día y noche)',
    });
  });

  return { averiadas, paradas, espera };
}
