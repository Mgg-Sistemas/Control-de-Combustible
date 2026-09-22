// FILTRAR EL INFORME POR JORNADA POR CLASIFICACIÓN Y POR MÁQUINA (22-sep-2026).
//
// Pedido del cliente: «para jornada que está en reportes, poder filtrar por
// categoría, por maquinaria en específico; está actualmente solo para filtrar por
// empresa, pero si yo quiero filtrar una máquina en específico o una categoría o
// clasificación en específico no está».
//
// ⭐ FILTRAR ≠ AGRUPAR (misma regla que el resto de Reportes): esto SÍ deja máquinas
//    fuera y cambia los totales. Por eso el papel lo dice en el subtítulo y en el
//    nombre del archivo, y con el filtro puesto NO salen fletes ni abonos: son de la
//    EMPRESA entera, no de la máquina, y un «SALDO POR PAGAR» en un papel de dos
//    máquinas sería un saldo que nadie debe.
//
// ⚠️ LA MÁQUINA SE FILTRA POR SU `id`, NUNCA POR EL CÓDIGO: hay tres equipos que se
//    llaman RETROEXCAVADORA. Elegir «por código» metería (o sacaría) a los tres.
//
// Sin imports: la prueba (scripts/test-jornada-filtro-reporte.mjs) la carga sola.

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v: unknown) => limpio(v).toLowerCase();
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

export const SIN_CLASIFICACION = 'Sin clasificación';
export const SIN_EMPRESA = 'Sin empresa';

/** La clasificación tal como la muestra el informe (vacía → «Sin clasificación»). */
export const clasificacionDe = (v: unknown): string => limpio(v) || SIN_CLASIFICACION;

export type FiltroJornadaEquipo = {
  /** Clasificaciones marcadas (vacío = todas). */
  clasificaciones: string[];
  /** `id` de las máquinas marcadas (vacío = todas). */
  maquinas: string[];
};
export const FILTRO_JORNADA_TODO: FiltroJornadaEquipo = { clasificaciones: [], maquinas: [] };

export const hayFiltroJornada = (f: FiltroJornadaEquipo | null | undefined): boolean =>
  !!f && (f.clasificaciones.length > 0 || f.maquinas.length > 0);

/**
 * ¿Esta máquina entra al informe? Vacío = todas. Las dos listas se CRUZAN: con una
 * clasificación y una máquina marcadas, entra la máquina solo si es de esa clasificación.
 */
export function pasaFiltroJornada(
  m: { id: unknown; clasificacion: unknown },
  f: FiltroJornadaEquipo | null | undefined,
): boolean {
  if (!hayFiltroJornada(f)) return true;
  const fx = f as FiltroJornadaEquipo;
  if (fx.maquinas.length && !fx.maquinas.includes(limpio(m.id))) return false;
  if (fx.clasificaciones.length) {
    const c = norm(clasificacionDe(m.clasificacion));
    if (!fx.clasificaciones.some((x) => norm(clasificacionDe(x)) === c)) return false;
  }
  return true;
}

/** Una máquina del catálogo, con lo justo para ofrecerla en el selector. */
export type MaquinaCatalogoJornada = {
  id: string;
  code: string;
  plate: string | null;
  serial: string | null;
  clasificacion: string;
  company: string;
  activa: boolean;
};

/** «CÓDIGO · placa» (o serial). Lo que se lee en la pastilla y en el papel. */
export function etiquetaMaquinaJornada(m: { code: unknown; plate?: unknown; serial?: unknown }): string {
  const code = limpio(m.code) || '—';
  const idn = limpio(m.plate) || limpio(m.serial);
  return idn ? `${code} · ${idn}` : code;
}

const enEmpresas = (m: MaquinaCatalogoJornada, empresas: string[] | null | undefined) =>
  !empresas || empresas.length === 0 || empresas.includes(m.company);

/** Las clasificaciones que hay para marcar, con cuántos equipos tiene cada una. Salen del
 *  catálogo acotado a las empresas marcadas: no se ofrece una clasificación sin equipos. */
export function clasificacionesDisponibles(
  catalogo: readonly MaquinaCatalogoJornada[] | null | undefined,
  empresas: string[] | null | undefined,
): { name: string; count: number }[] {
  const m = new Map<string, number>();
  (catalogo ?? []).forEach((x) => { if (enEmpresas(x, empresas)) m.set(x.clasificacion, (m.get(x.clasificacion) ?? 0) + 1); });
  return Array.from(m, ([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === SIN_CLASIFICACION ? 1 : b.name === SIN_CLASIFICACION ? -1 : cmp(a.name, b.name)));
}

/** Las máquinas que se pueden marcar: de las empresas y clasificaciones marcadas, y que
 *  coincidan con lo escrito (código, placa o serial). Por código y después por placa. */
export function maquinasDisponibles(
  catalogo: readonly MaquinaCatalogoJornada[] | null | undefined,
  empresas: string[] | null | undefined,
  clasificaciones: string[] | null | undefined,
  texto: unknown,
): MaquinaCatalogoJornada[] {
  const q = norm(texto);
  const cls = (clasificaciones ?? []).map((c) => norm(clasificacionDe(c)));
  return (catalogo ?? [])
    .filter((m) => enEmpresas(m, empresas))
    .filter((m) => cls.length === 0 || cls.includes(norm(m.clasificacion)))
    .filter((m) => !q || norm(`${m.code} ${m.plate ?? ''} ${m.serial ?? ''}`).includes(q))
    .sort((a, b) => cmp(a.code, b.code) || cmp(a.plate ?? a.serial ?? '', b.plate ?? b.serial ?? ''));
}

/** Lo marcado que ya no está en el alcance (cambió la empresa) deja de filtrar sin verse. */
export function acotarFiltroJornada(
  f: FiltroJornadaEquipo,
  catalogo: readonly MaquinaCatalogoJornada[] | null | undefined,
  empresas: string[] | null | undefined,
): FiltroJornadaEquipo {
  const enAlcance = (catalogo ?? []).filter((m) => enEmpresas(m, empresas));
  const cls = new Set(enAlcance.map((m) => norm(m.clasificacion)));
  const ids = new Set(enAlcance.map((m) => m.id));
  return {
    clasificaciones: f.clasificaciones.filter((c) => cls.has(norm(clasificacionDe(c)))),
    maquinas: f.maquinas.filter((id) => ids.has(id)),
  };
}

/** El alcance, en criollo, para el subtítulo del papel y la pantalla. '' si no hay filtro. */
export function alcanceFiltroJornada(
  f: FiltroJornadaEquipo | null | undefined,
  nombreMaquina: (id: string) => string,
): string {
  if (!hayFiltroJornada(f)) return '';
  const fx = f as FiltroJornadaEquipo;
  const partes: string[] = [];
  if (fx.clasificaciones.length) partes.push(`Clasificación: ${fx.clasificaciones.map(clasificacionDe).join(', ')}`);
  if (fx.maquinas.length) {
    const n = fx.maquinas.map(nombreMaquina).filter(Boolean);
    partes.push(fx.maquinas.length <= 4 ? `Máquinas: ${n.join(', ')}` : `Máquinas: ${fx.maquinas.length} elegidas`);
  }
  return `FILTRADO POR EQUIPO · ${partes.join(' · ')} · sin fletes ni abonos`;
}

/** Va al nombre del archivo: dos papeles con filtros distintos no se pisan en Descargas. */
export function sufijoArchivoFiltroJornada(f: FiltroJornadaEquipo | null | undefined): string {
  if (!hayFiltroJornada(f)) return '';
  const fx = f as FiltroJornadaEquipo;
  const p: string[] = [];
  if (fx.clasificaciones.length) p.push(fx.clasificaciones.length === 1 ? clasificacionDe(fx.clasificaciones[0]).replace(/[\\/:*?"<>|]/g, ' ') : `${fx.clasificaciones.length} clasificaciones`);
  if (fx.maquinas.length) p.push(`${fx.maquinas.length} maquina(s)`);
  return ` - ${p.join(' - ')}`;
}
